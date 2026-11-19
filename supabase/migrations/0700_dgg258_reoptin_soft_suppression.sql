-- 0700_dgg258_reoptin_soft_suppression.sql
-- =============================================================================
-- DGG-258 · Cierre del ÍTEM (4) de E-GG-281 (ver E-GG-284).
--
-- El re-opt-in self-service de LexPH trataba "suprimido" como binario y sólo
-- reconocía 'baja_usuario'. Dos agujeros:
--
--   (A) lexph_suscripcion_confirmar(token): al confirmar borraba SÓLO
--       `motivo='baja_usuario'`. Un suscriptor bajado a mano por gerencia
--       (motivo='manual') confirmaba → estado='confirmado' PERO la supresión
--       'manual' sobrevivía → quedaba "Confirmado" swithout recibir (el mismo
--       mismatch que cerró el display de E-GG-281, pero ahora auto-inflingido
--       por el propio flujo de confirmación).
--
--   (B) lexph_suscribir(email): el early-return bloqueaba el alta ante CUALQUIER
--       supresión. Resultado: quien se dio de baja (baja_usuario) o fue bajado a
--       mano (manual) NO podía volver a suscribirse desde el form — el form
--       respondía ok genérico ("revisá tu casilla") pero no mandaba nada.
--
-- CRITERIO (idéntico al guard de reactivar de DGG-257 · private.motivo_es_hard):
--   · Supresión DURA (bounce/queja/invalida/descartado_gerencia = casilla muerta):
--     NO se levanta por self-service. El override consciente vive sólo en
--     Config → Correos suprimidos (gerencia, email_reactivar directo, sin guarda).
--   · Supresión BLANDA (baja_usuario/manual = "pará de mandarme", reversible):
--     un alta genuina por DOBLE OPT-IN la levanta. Clave de seguridad: el borrado
--     de la supresión ocurre SÓLO en el confirmar (click en el mail = prueba de
--     control de la casilla), NUNCA por tipear un email en el form (si no, un
--     tercero podría re-suscribir a una víctima tipeando su casilla).
--
-- Por qué el mail de confirmación SÍ sale a una casilla soft-suprimida: el gate
-- soft de dispatch-emails (sección 2c, email_esta_suprimido) aplica SÓLO a
-- related_table 'prospectos' y 'administraciones' (slugs ofrecimiento-/engagement-).
-- Los mails de LexPH usan related_table='lexph_suscriptores' → sólo pasan por el
-- gate DURO (2b-bis, email_bloqueado_total). Verificado leyendo el edge; no se
-- toca ninguna edge function (R7-safe).
--
-- R16: ambas son CREATE OR REPLACE con la MISMA firma (sin overload nuevo).
-- R17: ya eran SECURITY DEFINER (escriben en email_suppression, RLS select-only).
-- =============================================================================

-- (A) ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lexph_suscripcion_confirmar(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id uuid; v_estado text; v_email text; v_baja uuid;
  v_motivo text; v_cleared int := 0; v_activado boolean;
begin
  select id, estado, email, baja_token into v_id, v_estado, v_email, v_baja
  from public.lexph_suscriptores where confirm_token = p_token;
  if v_id is null then
    return jsonb_build_object('ok', false, 'estado', 'invalido');
  end if;

  -- DGG-258: casilla DURA-suprimida no se resucita por self-service.
  select motivo into v_motivo
    from public.email_suppression where email = lower(btrim(v_email));
  if private.motivo_es_hard(v_motivo) then
    return jsonb_build_object('ok', false, 'estado', 'bloqueado');
  end if;

  -- DGG-258: levantar la supresión BLANDA (baja_usuario / manual). El click en el
  -- mail es la prueba de control de la casilla. Antes borraba SÓLO 'baja_usuario'.
  delete from public.email_suppression
   where email = lower(btrim(v_email))
     and not coalesce(private.motivo_es_hard(motivo), false);
  get diagnostics v_cleared = row_count;

  -- Activación genuina = alta/re-alta (no estaba confirmado) o se levantó una
  -- supresión blanda. En re-clicks idempotentes de un confirmado ya limpio: no-op.
  v_activado := (v_estado is distinct from 'confirmado') or v_cleared > 0;

  update public.lexph_suscriptores
     set estado = 'confirmado', confirmed_at = coalesce(confirmed_at, now()), baja_at = null
   where id = v_id;

  if v_activado then
    insert into public.email_queue
      (kind, template_slug, to_email, variables, prioridad, related_table, related_id, programado_para)
    values ('workflow', 'lexph-bienvenida', v_email,
      jsonb_build_object(
        'url',      'https://www.gestionglobal.ar/lexph',
        'baja_url', 'https://www.gestionglobal.ar/lexph/baja?token=' || v_baja),
      5, 'lexph_suscriptores', v_id, now());
    update public.lexph_suscriptores set last_email_at = now() where id = v_id;
  end if;

  return jsonb_build_object('ok', true, 'estado', 'confirmado');
end;
$function$;

-- (B) ───────────────────────────────────────────────────────────────────────
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

  -- DGG-258: sólo las supresiones DURAS bloquean el alta. Una supresión BLANDA
  -- (baja_usuario/manual) es reversible por doble opt-in (se levanta en el confirmar).
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
        -- confirmado + supresión blanda: re-confirmar para levantarla (no bienvenida).
        if v_cooldown_ok then
          v_tipo := case when v_soft then 'confirmar' else 'bienvenida' end;
        end if;
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
    if v_cooldown_ok then
      v_tipo := case when v_soft then 'confirmar' else 'bienvenida' end;
    end if;
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
