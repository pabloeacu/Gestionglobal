-- 0738 · DGG-270 — Fixes de la auditoría §6 del sistema de envíos federal (4 hallazgos confirmados).
-- Ninguno dispara envíos; blindan el chunk ANTES del disparo real de RPA.
--
-- FIX 1 (CRÍTICO, E-GG-300) — La RPC prospectos_federal_enviar_campana encolaba federal-rpa-caba en
--   prioridad 8 (igual que el backlog LexPH), y NADA prendía federal_consultoria_armada. Resultado:
--   (a) la secuencia "LexPH(8) < RPA(9)" del diseño NO existía (sólo se sostenía por el programado_para
--   más viejo de LexPH — frágil ante una edición e4 posterior); (b) el goteo de consultoría nunca
--   arrancaba (tick siempre 'no_armada'). Fix: encolar RPA en prioridad 9 (CASE por slug; el resto
--   de federal-% sigue en 8) y, al disparar RPA con >0 encolados, armar consultoría en la misma
--   transacción. Queda cableado en la RPC → vale igual si Pablo dispara desde la UI. R16: misma firma,
--   CREATE OR REPLACE (sin overload).
--
-- FIX 2 (CRÍTICO, E-GG-301) — prospectos_captacion_kpis contaba encolados_hoy/cola_pendiente/
--   enviados_total sobre TODAS las filas related_table='prospectos' sin filtrar 'captacion-%'. Al
--   disparar la Captación Federal (también related_table='prospectos'), la página PBA mostraría la
--   cola/envíos federales como si fueran PBA (cap "reventado"). Fix: scopear los 3 contadores a
--   'captacion-%' (espejo del tick 0734 y del hermano prospectos_federal_kpis).
--
-- FIX 3 (CRÍTICO, E-GG-302) — federal_consultoria_tick quedó ejecutable por anon/authenticated: el
--   'REVOKE ... FROM public' de 0735 no saca los EXECUTE explícitos que Supabase adosa por default a
--   anon/authenticated. Es un mutador SECURITY DEFINER (bypassa RLS, inserta en email_queue) → un
--   usuario del portal podría llamarlo en loop y quemar el cap. Fix: REVOKE explícito de anon+authenticated
--   (el cron corre como postgres/owner → sigue funcionando; el front nunca lo invoca).
--
-- FIX 4 (menor, E-GG-303) — ses_warmup_cap_hoy con un warmup_inicio FUTURO devolvía 500 (no 0) por no
--   tener rama v_dia<1. Inerte hoy (inicio=hoy) y heredado de 0728, pero se blinda para permitir
--   programar un arranque futuro sin drenado anticipado.

-- ───────────── FIX 1: RPC federal — prioridad 9 para RPA + arma consultoría ─────────────
CREATE OR REPLACE FUNCTION public.prospectos_federal_enviar_campana(
  p_template_slug text, p_jurisdiccion text DEFAULT NULL::text,
  p_limite_diario integer DEFAULT 1500, p_forzar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_gracia int := 30; v_cooldown int := 90;
  v_cap int := least(greatest(coalesce(p_limite_diario,1500),1),5000);
  v_asunto text; v_toques int := 0; v_p record; v_rn int := 0; v_pila text;
  v_prio int := case when p_template_slug = 'federal-rpa-caba' then 9 else 8 end;  -- DGG-270: RPA debajo de LexPH(8)
begin
  if not private.is_staff() then raise exception 'forbidden' using errcode='42501'; end if;
  if p_template_slug is null or p_template_slug not like 'federal-%' then
    return jsonb_build_object('ok', false, 'error', 'template_no_federal');
  end if;
  if not (select coalesce(federal_campanas_activo, false) from public.config_global limit 1) then
    return jsonb_build_object('ok', false, 'error', 'federal_desactivado', 'gated', true, 'encolados', 0);
  end if;
  if not (select coalesce(bulk_via_ses, false) from public.config_global limit 1) then
    return jsonb_build_object('ok', false, 'error', 'requiere_ses', 'gated', true, 'encolados', 0,
      'detalle', 'Captación Federal (lista fría nacional) sólo sale por el carril SES. Activá bulk_via_ses (reputación aislada) antes de enviar; nunca por Gmail.');
  end if;
  select asunto into v_asunto from public.email_templates where slug = p_template_slug and activo;
  if v_asunto is null then return jsonb_build_object('ok', false, 'error', 'template_inexistente'); end if;

  for v_p in
    select p.id, p.nombre, p.email
    from public.prospectos p
    where p.origen = 'import_nacional'
      and (p_jurisdiccion is null or p.jurisdiccion = p_jurisdiccion)
      and p.convertido_at is null and p.baja_at is null
      and p.estado_captacion is distinct from 'no_interesado'
      and p.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and p.email not like '%.invalid'
    order by p.email
  loop
    continue when public.email_esta_suprimido(v_p.email);
    continue when exists (select 1 from public.prospecto_mails pm
                           where pm.prospecto_id = v_p.id and pm.enviado_at >= (v_hoy - v_gracia)::timestamptz)
             or exists (select 1 from public.email_queue q
                         where q.related_table = 'prospectos' and q.related_id = v_p.id
                           and q.created_at >= (v_hoy - v_gracia)::timestamptz);
    continue when not p_forzar and exists (select 1 from public.prospecto_mails pm
                           where pm.prospecto_id = v_p.id and pm.template_slug = p_template_slug
                             and pm.enviado_at >= (v_hoy - v_cooldown)::timestamptz);
    v_pila := coalesce(public.nombre_pila_federal(v_p.nombre), 'colega');
    insert into public.email_queue
      (kind, template_slug, to_email, to_nombre, variables, prioridad, programado_para, scheduled_at,
       related_table, related_id, subject, comprobante_ids, parte, partes_total)
    values
      ('workflow', p_template_slug, lower(trim(v_p.email)), initcap(v_p.nombre),
       jsonb_build_object('nombre', v_pila), v_prio,
       now() + (floor(v_rn / v_cap))::int * interval '1 day',
       now() + (floor(v_rn / v_cap))::int * interval '1 day',
       'prospectos', v_p.id, v_asunto, '{}', 1, 1);
    v_toques := v_toques + 1; v_rn := v_rn + 1;
  end loop;

  -- DGG-270: disparar la campaña RPA CABA (con >0 encolados) ARMA el goteo de consultoría.
  -- El tick federal_consultoria_tick recién encola cuando armada=true Y RPA drenó (0 pendientes).
  if p_template_slug = 'federal-rpa-caba' and v_toques > 0 then
    update public.config_global set federal_consultoria_armada = true where id = 1;
  end if;

  return jsonb_build_object('ok', true, 'encolados', v_toques,
    'dias', ceil(v_toques::numeric / v_cap)::int, 'template', p_template_slug,
    'jurisdiccion', p_jurisdiccion, 'cap_diario', v_cap, 'forzado', p_forzar,
    'prioridad', v_prio, 'consultoria_armada', (p_template_slug = 'federal-rpa-caba' and v_toques > 0));
end $function$;

-- ───────────── FIX 2: prospectos_captacion_kpis — scopear los 3 contadores a 'captacion-%' ─────────────
CREATE OR REPLACE FUNCTION public.prospectos_captacion_kpis()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_activo boolean; v_pausado boolean; v_motivo text; v_cap int;
  v_rep_total int; v_rep_bad int;
  v_res jsonb;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(prospectos_campanas_activo,false), COALESCE(prospectos_pausado_reputacion,false),
         prospectos_pausado_motivo, COALESCE(prospectos_cap_diario,50)
    INTO v_activo, v_pausado, v_motivo, v_cap FROM public.config_global LIMIT 1;

  SELECT count(*), count(*) FILTER (WHERE estado IN ('bounced','complained'))
    INTO v_rep_total, v_rep_bad
    FROM public.sent_emails
   WHERE template_slug LIKE 'captacion-%' AND enviado_at >= now() - interval '7 days';

  SELECT jsonb_build_object(
    'total',             count(*),
    'con_email_real',    count(*) FILTER (WHERE email NOT LIKE '%@padron.invalid'),
    'sin_email',         count(*) FILTER (WHERE email LIKE '%@padron.invalid'),
    'sancionados',       count(*) FILTER (WHERE sanciones),
    'convertidos',       count(*) FILTER (WHERE convertido_at IS NOT NULL),
    'bajas',             count(*) FILTER (WHERE baja_at IS NOT NULL),
    'contactados',       count(*) FILTER (WHERE ultimo_mail_at IS NOT NULL),
    'seg_vencida',       count(*) FILTER (WHERE public.prospecto_segmento(matricula_vencimiento, v_hoy) = 'vencida'),
    'seg_curso_reno_30', count(*) FILTER (WHERE public.prospecto_segmento(matricula_vencimiento, v_hoy) = 'curso_reno_30'),
    'seg_curso_31_90',   count(*) FILTER (WHERE public.prospecto_segmento(matricula_vencimiento, v_hoy) = 'curso_31_90'),
    'seg_vigente_lejos', count(*) FILTER (WHERE public.prospecto_segmento(matricula_vencimiento, v_hoy) = 'vigente_lejos'),
    'seg_sin_dato',      count(*) FILTER (WHERE public.prospecto_segmento(matricula_vencimiento, v_hoy) = 'sin_dato')
  ) INTO v_res
  FROM public.prospectos WHERE origen = 'padron_pba';

  RETURN COALESCE(v_res, '{}'::jsonb) || jsonb_build_object(
    'activo',            v_activo,
    'pausado',           v_pausado,
    'pausado_motivo',    v_motivo,
    'cap_diario',        v_cap,
    -- DGG-270 (E-GG-301): scopear a 'captacion-%' para no contaminarse con filas federales.
    'encolados_hoy',     (SELECT count(*) FROM public.email_queue WHERE related_table='prospectos'
                            AND template_slug LIKE 'captacion-%'
                            AND (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = v_hoy),
    'cola_pendiente',    (SELECT count(*) FROM public.email_queue WHERE related_table='prospectos'
                            AND template_slug LIKE 'captacion-%' AND enviado_at IS NULL),
    'enviados_total',    (SELECT count(*) FROM public.prospecto_mails WHERE template_slug LIKE 'captacion-%'),
    'hoy',               v_hoy,
    'enriquecidos',      (SELECT count(*) FROM public.prospecto_padron WHERE tramix_at IS NOT NULL),
    'enrich_pendientes', (SELECT count(*) FROM public.prospecto_tramix_queue WHERE estado = 'pendiente'),
    'padron_total',      (SELECT count(*) FROM public.prospecto_padron),
    'rep_7d_total',      v_rep_total,
    'rep_7d_bad',        v_rep_bad,
    'rep_7d_pct',        CASE WHEN v_rep_total > 0 THEN round(v_rep_bad::numeric / v_rep_total * 100, 1) ELSE 0 END,
    'rep_umbral_pct',    5,
    'rep_min_muestra',   20
  );
END $function$;

-- ───────────── FIX 3: ACL del tick de consultoría — sacar anon/authenticated ─────────────
REVOKE EXECUTE ON FUNCTION public.federal_consultoria_tick() FROM anon, authenticated;
-- service_role mantiene su grant (0735); el cron corre como owner/postgres.

-- ───────────── FIX 4: rampa — guard de warmup_inicio futuro (v_dia < 1 ⇒ 0) ─────────────
CREATE OR REPLACE FUNCTION public.ses_warmup_cap_hoy()
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
declare v_cfg record; v_dia int;
begin
  select ses_pausado_reputacion, ses_warmup_inicio, ses_warmup_cap_override
    into v_cfg from public.config_global where id = 1;
  if coalesce(v_cfg.ses_pausado_reputacion, false) then return 0; end if;
  if v_cfg.ses_warmup_cap_override is not null then
    return greatest(0, least(v_cfg.ses_warmup_cap_override, 50000));
  end if;
  if v_cfg.ses_warmup_inicio is null then return 0; end if;
  v_dia := (current_date - v_cfg.ses_warmup_inicio) + 1;
  return case
    when v_dia <  1  then 0       -- inicio futuro: aún no arranca (fail-closed)
    when v_dia <= 2  then 500
    when v_dia <= 4  then 1000
    when v_dia <= 6  then 1500
    when v_dia <= 8  then 2500
    when v_dia <= 10 then 3000
    when v_dia <= 12 then 3500
    when v_dia <= 14 then 4000
    when v_dia <= 16 then 4500
    else 5000 end;
end $function$;