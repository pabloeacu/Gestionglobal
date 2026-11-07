-- 0673 · E-GG-266 cont. — Cierre §6 (doble auditoría adversarial, 3 agentes) del fix
-- de las direcciones sintéticas del newsletter LexPH. Saldados los hallazgos DB-only:
--
--  C#7 (GAP) — `email_bloqueado_total` no reconocía motivo='invalida' → una sintética
--    ya rebotada (suprimida 'invalida' por 0672) SE FILTRABA al banner "Emails Rebotados"
--    del Inicio de gerencia (con el copy inútil "verificá la casilla del cliente"). Fix:
--    sumar 'invalida' a los motivos de bloqueo total. (Refuerza además el dispatcher:
--    cancela cualquier 'invalida' antes de enviar.)
--
--  A#5 (GAP defensa) — `lexph_suscribir` (opt-in anon) NO chequeaba supresión antes de
--    encolar: un .invalid en estado='baja' se "resucitaba" a 'pendiente' y encolaba el
--    confirm (fila muerta; el dispatcher la cancela, no rebota). Fix: guard temprano que
--    hace no-op silencioso para .invalid o destinatarios suprimidos.
--
--  B#4c (R6 drift) + B#4b — el cuerpo VIVO de `lexph_newsletter_reporte_tick` estaba
--    ADELANTADO al repo (0665/0667 stale; re-aplicar 0665 reportaría 147 "bajas" falsas).
--    Se versiona el cuerpo vivo verbatim + se excluye `%.invalid` del per_rec → el informe
--    final de la edición no cuenta las 147 sintéticas en total/cancelados (honesto).
--
--  B#2 (cosmético) — las 153 filas sintéticas quedaban como estado='baja' inflando el
--    contador "Bajas" del panel de suscriptores (no es churn real). No son suscriptores:
--    son placeholders sin email real, 100% reconstruibles desde `prospectos` + preservados
--    en `email_suppression`. Sin FK que las referencie → se ELIMINAN (panel honesto, cero
--    cambio de frontend). El guard del import (0672) + A#5 impiden la re-entrada.
--
-- NOTA: aperturas/clicks del newsletter NO se registran (envío por Workspace sin pixel;
--   sent_emails.opened_at/clicked_at/delivered_at = NULL para 140/140). El ruido de
--   rebotes de campaña masiva en el harvester (A/C #5/#8) sigue flaggeado R7 (edge).

-- ============================================================================
-- C#7 · email_bloqueado_total reconoce 'invalida'
-- ============================================================================
CREATE OR REPLACE FUNCTION public.email_bloqueado_total(p_email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.email_suppression s
    WHERE s.email = lower(btrim(p_email))
      AND s.motivo IN ('bounce', 'queja', 'descartado_gerencia', 'invalida')
      AND NOT (
        s.origen = 'webhook'
        AND EXISTS (
          SELECT 1 FROM public.administraciones a
          WHERE lower(a.email) = s.email AND a.estado <> 'baja'
        )
      )
  );
$function$;

-- ============================================================================
-- A#5 · lexph_suscribir: guard de supresión/.invalid antes de resucitar/encolar
--       (cuerpo VIVO verbatim + guard temprano)
-- ============================================================================
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
begin
  if v_norm !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_norm) > 254 then
    raise exception 'Email inválido.' using errcode = '22023';
  end if;

  -- E-GG-266 (A#5): no resucitar ni encolar para direcciones sin email real (.invalid)
  -- ni para destinatarios ya suprimidos. No-op silencioso (no filtra existencia).
  if v_norm like '%.invalid'
     or exists (select 1 from public.email_suppression s where s.email = v_norm) then
    return jsonb_build_object('ok', true);
  end if;

  select id, estado, last_email_at, confirm_token, baja_token, email
    into v_id, v_estado, v_last, v_confirm, v_baja, v_email
  from public.lexph_suscriptores where email_norm = v_norm;

  v_cooldown_ok := (v_last is null or v_last < now() - interval '10 minutes');

  if v_id is null then
    insert into public.lexph_suscriptores (email, email_norm, estado)
    values (btrim(p_email), v_norm, 'pendiente')
    on conflict (email_norm) do nothing
    returning id, confirm_token, baja_token, email into v_id, v_confirm, v_baja, v_email;

    if v_id is not null then
      v_tipo := 'confirmar';
    else
      select id, estado, last_email_at, confirm_token, baja_token, email
        into v_id, v_estado, v_last, v_confirm, v_baja, v_email
      from public.lexph_suscriptores where email_norm = v_norm;
      v_cooldown_ok := (v_last is null or v_last < now() - interval '10 minutes');
      if v_estado = 'confirmado' then
        if v_cooldown_ok then v_tipo := 'bienvenida'; end if;
      elsif v_estado = 'baja' then
        update public.lexph_suscriptores
           set estado = 'pendiente', baja_at = null, confirm_token = gen_random_uuid()
         where id = v_id
         returning confirm_token into v_confirm;
        v_tipo := 'confirmar';
      else
        if v_cooldown_ok then v_tipo := 'confirmar'; end if;
      end if;
    end if;
  elsif v_estado = 'confirmado' then
    if v_cooldown_ok then v_tipo := 'bienvenida'; end if;
  elsif v_estado = 'baja' then
    update public.lexph_suscriptores
       set estado = 'pendiente', baja_at = null, confirm_token = gen_random_uuid()
     where id = v_id
     returning confirm_token into v_confirm;
    v_tipo := 'confirmar';
  else
    if v_cooldown_ok then v_tipo := 'confirmar'; end if;
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

-- ============================================================================
-- B#4c + B#4b · reporte_tick: versionar el cuerpo VIVO + excluir sintéticas
--               del total/cancelados del informe de la edición
-- ============================================================================
CREATE OR REPLACE FUNCTION private.lexph_newsletter_reporte_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ed   record;
  v_slug text;
  v_tot int; v_sent int; v_fail int; v_canc int; v_bajas int; v_pend int;
begin
  for v_ed in
    select id, seq from public.lexph_ediciones
     where newsletter_enviado_at is not null and newsletter_reporte_at is null
  loop
    v_slug := 'lexph-newsletter-e' || coalesce(v_ed.seq::text, replace(v_ed.id::text, '-', ''));
    with per_rec as (
      select eq.to_email,
             bool_or(eq.enviado_at is null) as any_pending,
             bool_or(eq.status = 'sent'
                     or exists (select 1 from public.sent_emails se
                                 where se.to_email = eq.to_email
                                   and se.template_slug = eq.template_slug)) as delivered,
             bool_or(eq.status = 'cancelled' or eq.ultimo_error ilike '%cancel%') as cancel_like,
             bool_or((eq.status = 'cancelled' or eq.ultimo_error ilike '%cancel%')
                     and eq.ultimo_error ilike '%baja%') as baja_like
        from public.email_queue eq
       where eq.template_slug = v_slug
         and eq.to_email not like '%.invalid'   -- E-GG-266 (B#4b): no contar sintéticas
       group by eq.to_email
    )
    select count(*),
           count(*) filter (where delivered),
           count(*) filter (where not delivered and not cancel_like),
           count(*) filter (where not delivered and cancel_like),
           count(*) filter (where not delivered and cancel_like and baja_like),
           count(*) filter (where any_pending)
      into v_tot, v_sent, v_fail, v_canc, v_bajas, v_pend
      from per_rec;

    if v_tot > 0 and v_pend = 0 then
      perform private.notif_emitir_staff(
        'lexph_suscriptor',
        'Informe final · Envío de LexPH completado',
        format('Edición N°%s: entregados %s · fallidos %s · cancelados %s (de ellos, bajas %s) · total %s.',
               coalesce(v_ed.seq::text, '—'), v_sent, v_fail, v_canc, v_bajas, v_tot),
        '/gerencia/contenidos/suscriptores',
        jsonb_build_object('edicion_id', v_ed.id, 'enviados', v_sent,
                           'fallidos', v_fail, 'cancelados', v_canc, 'bajas', v_bajas, 'total', v_tot)
      );
      update public.lexph_ediciones set newsletter_reporte_at = now() where id = v_ed.id;
    end if;
  end loop;
end
$function$;

-- ============================================================================
-- B#2 · Eliminar las 153 filas sintéticas de la lista (no son suscriptores; preservadas
--        en prospectos + email_suppression). Idempotente.
-- ============================================================================
delete from public.lexph_suscriptores where lower(email) like '%.invalid';
