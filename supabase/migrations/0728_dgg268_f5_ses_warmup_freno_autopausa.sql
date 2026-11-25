-- 0728 · DGG-268 F5 — Gobernanza del carril SES: rampa de warm-up + freno con AUTO-PAUSA.
--
-- Capitaliza la auditoría integral del gate (Ángulo 3 BLOQUEADO): el subdominio
-- envios.gestionglobal.ar es NUEVO (0 reputación) y el único freno que había
-- (private.lexph_freno_rebotes_check, mig 0714) sólo ALERTA, sólo mira el newsletter y
-- corre 1×/hora. Para encender el carril SES sin arriesgar la suspensión de la cuenta
-- (bounce>5% → AWS pausa) hacen falta tres cosas, todas acá:
--   (1) RAMPA de warm-up: cupo diario que arranca bajo y sube gradual hasta la cuota 50k.
--   (2) FRENO con AUTO-PAUSA: si el rebote/queja REAL supera el umbral, PAUSA el carril
--       (no sólo avisa), cubriendo TODO lo que sale por SES; corre cada 10'.
--   (3) LECTURA de estado para el dispatcher (service_role) y la gerencia (panel).
--
-- Fail-closed (mandato Pablo, [[reference_mass_send_gate]]): pausa ⇒ cupo 0 ⇒ el dispatcher
-- DIFIERE el envío SES; NUNCA lo cruza a Gmail. NO auto-despausa: reanudar es decisión humana
-- tras investigar la causa (mismo criterio que prospectos_pausado_reputacion del motor PBA).
--
-- Discriminador de "envío SES" SIN tocar el edge money-crítico: sent_emails.from_email termina
-- en @envios.gestionglobal.ar (el subdominio verificado; el dispatcher ya lo estampa así en el
-- carril SES, línea 624 de dispatch-emails). Rebotes/quejas REALES = public.ses_feedback_events
-- (SNS autoritativo, F4 mig 0721): tipo ∈ {bounce,complaint,delivery}, es_permanente marca el
-- hard bounce, recibido_at default now().

-- =====================================================================================
-- (1) Estado de gobernanza en el singleton config_global (id=1).
-- =====================================================================================
alter table public.config_global
  add column if not exists ses_pausado_reputacion boolean not null default false,
  add column if not exists ses_pausado_motivo text,
  add column if not exists ses_pausado_at timestamptz,
  add column if not exists ses_warmup_inicio date,
  add column if not exists ses_warmup_cap_override int;

comment on column public.config_global.ses_pausado_reputacion is
  'Freno del carril SES: true ⇒ el dispatcher DIFIERE todo envío SES (no cruza a Gmail). Lo prende private.ses_freno_check(); se apaga a mano tras investigar.';
comment on column public.config_global.ses_warmup_inicio is
  'Fecha de arranque del warm-up SES. null ⇒ carril aún no encendido (cupo diario = 0). La setea el encendido del masivo.';
comment on column public.config_global.ses_warmup_cap_override is
  'Override manual del cupo diario SES (null ⇒ usar el cronograma de ses_warmup_cap_hoy). Se topa igual a la cuota 50k.';

-- =====================================================================================
-- (2) Cupo diario del warm-up — rampa estándar AWS hasta la cuota (50k/día).
-- =====================================================================================
create or replace function public.ses_warmup_cap_hoy()
returns int
language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $fn$
declare v_cfg record; v_dia int;
begin
  select ses_pausado_reputacion, ses_warmup_inicio, ses_warmup_cap_override
    into v_cfg from public.config_global where id = 1;
  -- Pausado por reputación ⇒ sin presupuesto (fail-closed).
  if coalesce(v_cfg.ses_pausado_reputacion, false) then return 0; end if;
  -- Override manual (topado a la cuota).
  if v_cfg.ses_warmup_cap_override is not null then
    return greatest(0, least(v_cfg.ses_warmup_cap_override, 50000));
  end if;
  -- Carril no encendido todavía.
  if v_cfg.ses_warmup_inicio is null then return 0; end if;
  v_dia := (current_date - v_cfg.ses_warmup_inicio) + 1;   -- día 1 = fecha de inicio
  return case
    when v_dia <= 2  then 500
    when v_dia <= 4  then 1000
    when v_dia <= 6  then 2500
    when v_dia <= 9  then 5000
    when v_dia <= 12 then 10000
    when v_dia <= 15 then 20000
    else 50000 end;                                        -- tope = cuota SES
end $fn$;
revoke all on function public.ses_warmup_cap_hoy() from public, anon, authenticated;
grant execute on function public.ses_warmup_cap_hoy() to service_role;

-- =====================================================================================
-- (3) Lectura de estado del carril — dispatcher (service_role) + panel gerencia (staff).
-- =====================================================================================
create or replace function public.ses_lane_estado()
returns jsonb
language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_cfg record; v_cap int; v_hoy int; v_sent24 int;
  v_hard int; v_trans int; v_quej int; v_pct numeric;
  c_dom constant text := '%@envios.gestionglobal.ar';
begin
  -- Gate: cron/service (sin JWT ⇒ auth.uid() null) o staff; nadie más.
  if auth.uid() is not null and not coalesce(private.is_staff(), false) then
    raise exception 'Sólo gerencia.' using errcode = '42501';
  end if;

  select ses_pausado_reputacion, ses_pausado_motivo, ses_pausado_at, ses_warmup_inicio, ses_warmup_cap_override
    into v_cfg from public.config_global where id = 1;
  v_cap := public.ses_warmup_cap_hoy();

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
                       else (current_date - v_cfg.ses_warmup_inicio) + 1 end,
    'cap_override', v_cfg.ses_warmup_cap_override,
    'cap_hoy', v_cap,
    'enviados_hoy', v_hoy,
    'restante_hoy', greatest(0, v_cap - v_hoy),
    'sent_24h', v_sent24,
    'hard_24h', v_hard, 'transitorios_24h', v_trans, 'quejas_24h', v_quej,
    'pct_24h', v_pct
  );
end $fn$;
revoke all on function public.ses_lane_estado() from public, anon;
grant execute on function public.ses_lane_estado() to authenticated, service_role;

-- =====================================================================================
-- (4) FRENO con AUTO-PAUSA del carril SES. Corre cada 10'. Secundario a CloudWatch (AWS),
--     pero es el tripwire rápido del lado nuestro. Ventana trailing 24h (suaviza el lag
--     envío→rebote). Pisos ABSOLUTOS además de % para no pausar por ruido de muestra chica.
-- =====================================================================================
create or replace function private.ses_freno_check()
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_sent int; v_hard int; v_trans int; v_quej int;
  v_pct_hard numeric; v_pct_total numeric; v_pct_quej numeric;
  v_breach boolean; v_motivo text; v_ya_pausado boolean;
  c_dom constant text := '%@envios.gestionglobal.ar';
  c_min constant int := 100;   -- piso de envíos SES/24h para evaluar tasas
begin
  select coalesce(ses_pausado_reputacion, false) into v_ya_pausado
    from public.config_global where id = 1;

  select count(*) into v_sent from public.sent_emails
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

  v_pct_hard  := case when v_sent > 0 then round(v_hard::numeric / v_sent * 100, 2) else 0 end;
  v_pct_total := case when v_sent > 0 then round((v_hard + v_trans)::numeric / v_sent * 100, 2) else 0 end;
  v_pct_quej  := case when v_sent > 0 then round(v_quej::numeric / v_sent * 100, 2) else 0 end;

  -- Breach si: hard>5% (pisos 100 envíos + 10 hard) · total>8% (16 rebotes) · queja>0.3% (3 quejas).
  v_breach :=
       (v_sent >= c_min and v_hard  >= 10 and v_pct_hard  > 5.0)
    or (v_sent >= c_min and (v_hard + v_trans) >= 16 and v_pct_total > 8.0)
    or (v_sent >= 50     and v_quej  >= 3  and v_pct_quej  > 0.3);

  if v_breach and not v_ya_pausado then
    v_motivo := format(
      'Auto-pausa SES por reputación: rebote duro %s%% (%s), rebote total %s%% (%s), quejas %s%% (%s) sobre %s envíos SES/24h.',
      v_pct_hard, v_hard, v_pct_total, (v_hard + v_trans), v_pct_quej, v_quej, v_sent);
    update public.config_global
       set ses_pausado_reputacion = true,
           ses_pausado_motivo = v_motivo,
           ses_pausado_at = now()
     where id = 1;
    -- Notificar aparte: una falla del aviso NO debe abortar la pausa (la pausa ya quedó escrita).
    begin
      perform public.notify_all_gerentes(
        'ses_pausa_reputacion',
        'Carril SES PAUSADO por reputación',
        v_motivo || ' El carril masivo quedó frenado automáticamente; lo transaccional (Gmail) sigue intacto. Revisá la causa antes de reanudar.',
        '/gerencia/analitica/marketing', '{}'::jsonb, true);
    exception when others then
      raise warning 'ses_freno_check: notify_all_gerentes falló: %', sqlerrm;
    end;
  end if;

  return jsonb_build_object(
    'sent_24h', v_sent, 'hard', v_hard, 'transitorios', v_trans, 'quejas', v_quej,
    'pct_hard', v_pct_hard, 'pct_total', v_pct_total, 'pct_quej', v_pct_quej,
    'breach', v_breach, 'ya_pausado', v_ya_pausado,
    'pausa_aplicada', (v_breach and not v_ya_pausado));
end $fn$;
revoke all on function private.ses_freno_check() from public, anon, authenticated;
grant execute on function private.ses_freno_check() to service_role;

-- Cron: cada 10 minutos (tripwire rápido del warm-up).
select cron.unschedule('ses-freno-reputacion') where exists (select 1 from cron.job where jobname='ses-freno-reputacion');
select cron.schedule('ses-freno-reputacion', '*/10 * * * *', $cron$ select private.ses_freno_check(); $cron$);
