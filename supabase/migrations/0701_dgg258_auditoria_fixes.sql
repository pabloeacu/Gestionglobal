-- 0701_dgg258_auditoria_fixes.sql
-- =============================================================================
-- DGG-258 · Cierre de hallazgos de la doble auditoría §6 de E-GG-284.
--
-- (1) private.motivo_es_hard: pasa de BLACKLIST (hard = lista explícita) a
--     WHITELIST-de-soft (hard = todo lo que NO es 'manual'/'baja_usuario').
--     No-op con los 5 motivos vivos (bounce/queja/invalida/descartado_gerencia →
--     hard; manual/baja_usuario → soft), pero FAIL-CLOSED ante un motivo nuevo:
--     cualquier motivo desconocido se trata como DURO → NO lo levanta el
--     self-service ni el reactivar. Es la fuente única de verdad hard/soft de
--     todo el circuito (confirmar/suscribir + los 3 reactivar + el panel), así
--     que el default seguro es no-resucitar-ante-la-duda. Preserva el NULL
--     (sin fila de supresión) devolviendo NULL, igual que antes.
--
-- (2) public.lexph_suscribir: endurece la rama de un suscriptor en estado='baja'
--     (hallazgo #1b de E-GG-284). Antes, un request ANÓNIMO al form con el email
--     de una víctima flipeaba su fila (estado→pendiente, baja_at→NULL, token
--     regenerado) SIN cooldown. Ahora NINGUNA rama muta el estado: tipear un
--     email no prueba control de la casilla; el ÚNICO que transiciona es el click
--     en el confirmar (lexph_suscripcion_confirmar). El form sólo (re)encola el
--     mail de doble opt-in, gateado por cooldown de 10'. La supresión soft sigue
--     sin levantarse hasta el click. No muta nada de la víctima.
--
-- (3) public.email_suppression_list: `es_hard` usaba una lista literal SIN
--     'invalida' → las 150 casillas motivo='invalida' (el motivo más numeroso) se
--     mostraban "Baja de marketing" (soft) en Config → Correos suprimidos y los
--     KPIs contaban mal, aunque el gate de envío (email_bloqueado_total) SÍ las
--     bloquea. Se unifica con private.motivo_es_hard (fuente única). (GAP #14.)
--
-- R16: las 3 son CREATE OR REPLACE misma firma (sin overload). R17 N/A (sin
-- triggers nuevos; lexph_suscribir ya era SECDEF).
-- =============================================================================

-- (1) ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.motivo_es_hard(p_motivo text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
           WHEN p_motivo IS NULL THEN NULL
           ELSE p_motivo NOT IN ('manual', 'baja_usuario')
         END;
$function$;

-- (3) ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.email_suppression_list()
 RETURNS TABLE(email text, motivo text, origen text, created_at timestamp with time zone, administracion_id uuid, administracion_nombre text, prospecto_id uuid, es_hard boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT s.email, s.motivo, s.origen, s.created_at,
         a.id, a.nombre, s.prospecto_id,
         coalesce(private.motivo_es_hard(s.motivo), false) AS es_hard
  FROM public.email_suppression s
  LEFT JOIN public.administraciones a ON lower(a.email) = s.email
  WHERE private.is_staff()
  ORDER BY s.created_at DESC
  LIMIT 500;
$function$;

-- (2) ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lexph_suscribir(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_norm    text := lower(btrim(coalesce(p_email, '')));
  v_id      uuid;
  v_estado  text;
  v_last    timestamptz;
  v_confirm uuid;
  v_baja    uuid;
  v_email   text;
  v_tipo    text := null;
  v_cooldown_ok boolean;
  v_soft    boolean;
begin
  if v_norm !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_norm) > 254 then
    raise exception 'Email inválido.' using errcode = '22023';
  end if;

  -- sólo las supresiones DURAS bloquean el alta (la soft es reversible por doble opt-in)
  if v_norm like '%.invalid'
     or exists (
       select 1 from public.email_suppression s
        where s.email = v_norm and private.motivo_es_hard(s.motivo)
     ) then
    return jsonb_build_object('ok', true);
  end if;

  v_soft := exists (select 1 from public.email_suppression s where s.email = v_norm);

  select id, estado, last_email_at, confirm_token, baja_token, email
    into v_id, v_estado, v_last, v_confirm, v_baja, v_email
  from public.lexph_suscriptores where email_norm = v_norm;

  if v_id is null then
    insert into public.lexph_suscriptores (email, email_norm, estado)
    values (btrim(p_email), v_norm, 'pendiente')
    on conflict (email_norm) do nothing
    returning id, confirm_token, baja_token, email into v_id, v_confirm, v_baja, v_email;

    if v_id is not null then
      v_tipo := 'confirmar';                 -- alta nueva
    else
      -- carrera con otro insert: re-leer la fila existente
      select id, estado, last_email_at, confirm_token, baja_token, email
        into v_id, v_estado, v_last, v_confirm, v_baja, v_email
      from public.lexph_suscriptores where email_norm = v_norm;
    end if;
  end if;

  -- Fila existente (pendiente / baja / confirmado). DGG-258 (#1b): NO se muta el
  -- estado acá; el click en el confirmar es lo único que transiciona.
  if v_id is not null and v_tipo is null then
    v_cooldown_ok := (v_last is null or v_last < now() - interval '10 minutes');
    if v_estado = 'confirmado' then
      -- confirmado + supresión blanda → re-confirmar para levantarla (no bienvenida)
      if v_cooldown_ok then
        v_tipo := case when v_soft then 'confirmar' else 'bienvenida' end;
      end if;
    else
      -- pendiente o baja: (re)mandar confirmación sin tocar la fila
      if v_cooldown_ok then v_tipo := 'confirmar'; end if;
    end if;
  end if;

  if v_tipo = 'confirmar' then
    insert into public.email_queue
      (kind, template_slug, to_email, variables, prioridad, related_table, related_id, programado_para)
    values ('workflow', 'lexph-confirmar-suscripcion', v_email,
      jsonb_build_object(
        'confirm_url', 'https://www.gestionglobal.ar/lexph/confirmar?token=' || v_confirm,
        'baja_url',    'https://www.gestionglobal.ar/lexph/baja?token=' || v_baja),
      5, 'lexph_suscriptores', v_id, now());
    update public.lexph_suscriptores set last_email_at = now() where id = v_id;
  elsif v_tipo = 'bienvenida' then
    insert into public.email_queue
      (kind, template_slug, to_email, variables, prioridad, related_table, related_id, programado_para)
    values ('workflow', 'lexph-bienvenida', v_email,
      jsonb_build_object(
        'url',      'https://www.gestionglobal.ar/lexph',
        'baja_url', 'https://www.gestionglobal.ar/lexph/baja?token=' || v_baja),
      5, 'lexph_suscriptores', v_id, now());
    update public.lexph_suscriptores set last_email_at = now() where id = v_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;
