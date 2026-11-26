-- 0733 · DGG-268 / E-GG-299 — El cupo diario de warm-up SES contaba el "día" en UTC.
-- `ses_lane_estado()` medía `enviados_hoy` con `date_trunc('day', now())` y
-- `ses_warmup_cap_hoy()` el día de rampa con `current_date`. Ambas sin SET TimeZone →
-- usaban el huso del server (UTC). La medianoche UTC cae a las 21:00 AR, así que todas
-- las noches, entre 21:00 y 23:59 AR, el contador `enviados_hoy` se reseteaba y salía un
-- SEGUNDO cupo completo el mismo día calendario argentino. Efecto medido 2026-11-25
-- (warm-up día 1, cap 500): salieron ~1.002 `lexph-e3` — el doble del cap — en dos bursts
-- (502 a las 18–20h AR, 500 a partir de las 21h AR). En pleno warm-up y con lista fría
-- (27 rebotes duros/24h, 2,7%) duplicar el caudal es exactamente lo que erosiona la
-- reputación del dominio `envios.gestionglobal.ar`.
--
-- Fix quirúrgico: fijar `SET "TimeZone" TO 'America/Argentina/Buenos_Aires'` en ambas
-- funciones (mismo patrón que `prospectos_campana_tick` / `prospectos_federal_enviar_campana`).
-- Con eso `current_date` y `date_trunc('day', now())` quedan en día calendario AR y el cupo
-- es UNO por día argentino. No cambia NADA de la lógica de rampa ni de los umbrales; sólo
-- el huso del "día". El freno reputacional (`private.ses_freno_check`) ya usaba ventanas
-- rodantes de 24h → no lo toca este bug y no se modifica.
-- Regla 16: no se extienden firmas (misma firma, CREATE OR REPLACE directo, sin overloads).

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
  v_dia := (current_date - v_cfg.ses_warmup_inicio) + 1;  -- current_date ahora en AR
  return case
    when v_dia <= 2  then 500
    when v_dia <= 4  then 1000
    when v_dia <= 6  then 2500
    when v_dia <= 9  then 5000
    when v_dia <= 12 then 10000
    when v_dia <= 15 then 20000
    else 50000 end;
end $function$;

CREATE OR REPLACE FUNCTION public.ses_lane_estado()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
declare
  v_cfg record; v_cap int; v_hoy int; v_sent24 int;
  v_hard int; v_trans int; v_quej int; v_pct numeric;
  c_dom constant text := '%@envios.gestionglobal.ar';
begin
  if auth.uid() is not null and not coalesce(private.is_staff(), false) then
    raise exception 'Solo gerencia.' using errcode = '42501';
  end if;

  select ses_pausado_reputacion, ses_pausado_motivo, ses_pausado_at, ses_warmup_inicio, ses_warmup_cap_override
    into v_cfg from public.config_global where id = 1;
  v_cap := public.ses_warmup_cap_hoy();

  -- date_trunc('day', now()) ahora trunca en AR → ventana = día calendario argentino.
  select count(*) into v_hoy from public.sent_emails
    where from_email ilike c_dom and enviado_at >= date_trunc('day', now());
  select count(*) into v_sent24 from public.sent_emails
    where from_email ilike c_dom and enviado_at >= now() - interval '24 hours';

  select coalesce(sum(greatest(coalesce(array_length(emails,1),1),1)),0) into v_hard
    from public.ses_feedback_events
   where tipo = 'bounce' and es_permanente and recibido_at >= now() - interval '24 hours';
  select coalesce(sum(greatest(coalesce(array_length(emails,1),1),1)),0) into v_trans
    from public.ses_feedback_events
   where tipo = 'bounce' and not es_permanente and recibido_at >= now() - interval '24 hours';
  select coalesce(sum(greatest(coalesce(array_length(emails,1),1),1)),0) into v_quej
    from public.ses_feedback_events
   where tipo = 'complaint' and recibido_at >= now() - interval '24 hours';

  v_pct := case when v_sent24 > 0 then round((v_hard + v_quej)::numeric / v_sent24 * 100, 2) else 0 end;

  return jsonb_build_object(
    'pausado', coalesce(v_cfg.ses_pausado_reputacion, false),
    'motivo', v_cfg.ses_pausado_motivo,
    'pausado_at', v_cfg.ses_pausado_at,
    'warmup_inicio', v_cfg.ses_warmup_inicio,
    'warmup_dia', case when v_cfg.ses_warmup_inicio is null then null
                       else (current_date - v_cfg.ses_warmup_inicio) + 1 end,  -- current_date ahora en AR
    'cap_override', v_cfg.ses_warmup_cap_override,
    'cap_hoy', v_cap,
    'enviados_hoy', v_hoy,
    'restante_hoy', greatest(0, v_cap - v_hoy),
    'sent_24h', v_sent24,
    'hard_24h', v_hard, 'transitorios_24h', v_trans, 'quejas_24h', v_quej,
    'pct_24h', v_pct
  );
end $function$;
