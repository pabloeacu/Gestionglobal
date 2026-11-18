-- 0699_dgg257_reporte_diario_audiencia_neta.sql
-- =============================================================================
-- DGG-257 (cierre display E-GG-281 · fan-out §6-a/e). Último lector del conteo de
-- 'confirmado' con métrica de entregabilidad: el informe diario del envío
-- (private.lexph_reporte_envio_diario, mail interno a Pablo). `v_audiencia` se
-- calculaba con `estado='confirmado'` CRUDO, pero `v_enviados` ya es neto de
-- supresión → cuando hay confirmados suprimidos el informe mostraba
-- `audiencia=2870 / enviados=2832 / 99%` Y a la vez "✅ ¡Envío COMPLETO!"
-- (incoherente: parece que faltó entregar a ~38 que fueron excluidos a propósito).
--
-- Fix de 1 línea: `v_audiencia` NETA (mismo filtro que lexph_confirmados_reciben /
-- el INSERT de lexph_newsletter_enviar). NO se reusa lexph_confirmados_reciben()
-- porque gatea is_staff() y el cron no tiene JWT → se inlinea el NOT EXISTS. El
-- resto de la función queda idéntico. CREATE OR REPLACE (misma firma, R16 OK).
-- =============================================================================
CREATE OR REPLACE FUNCTION private.lexph_reporte_envio_diario()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
declare
  v_ed_id      uuid;
  v_seq        int;
  v_slug       text;
  v_dest       constant text := 'pabloeacu@gmail.com';
  v_art_today  date        := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_art_now    timestamp   := now() at time zone 'America/Argentina/Buenos_Aires';
  v_enviados   int; v_enviados_hoy int; v_pend int; v_rebotes int;
  v_bajas_hoy  int; v_bajas_tot int; v_nuevos_hoy int; v_audiencia int;
  v_pct        int;
  v_rate_h     numeric; v_hrs_mid numeric; v_est_eod int; v_eta_dias int;
  v_estim      text; v_final boolean;
begin
  select id, seq into v_ed_id, v_seq
    from public.lexph_ediciones
   where newsletter_enviado_at is not null
   order by newsletter_enviado_at desc limit 1;
  if not found then return; end if;
  v_slug := 'lexph-newsletter-e' || coalesce(v_seq::text, replace(v_ed_id::text, '-', ''));

  if exists (
    select 1 from public.email_queue
     where related_table = 'lexph_reporte_diario'
       and (created_at at time zone 'America/Argentina/Buenos_Aires')::date = v_art_today
  ) then
    return;
  end if;

  select count(*) filter (where status='sent'),
         count(*) filter (where status='sent'
                          and (sent_at at time zone 'America/Argentina/Buenos_Aires')::date = v_art_today),
         count(*) filter (where status='pending' and enviado_at is null)
    into v_enviados, v_enviados_hoy, v_pend
    from public.email_queue where template_slug = v_slug;

  select count(*) into v_rebotes from public.sent_emails
   where template_slug = v_slug and estado='bounced' and lower(to_email) not like '%.invalid';

  select count(*) filter (where (baja_at at time zone 'America/Argentina/Buenos_Aires')::date = v_art_today),
         count(*) filter (where estado='baja')
    into v_bajas_hoy, v_bajas_tot
    from public.lexph_suscriptores where lower(email) not like '%.invalid';

  select count(*) into v_nuevos_hoy from public.lexph_suscriptores
   where origen='web_lexph'
     and (created_at at time zone 'America/Argentina/Buenos_Aires')::date = v_art_today;

  -- DGG-257: audiencia NETA (descuenta suprimidos) para cerrar en 100% y no mostrar
  -- "COMPLETO" con pct<100 (mismo criterio que lexph_confirmados_reciben / el envío).
  select count(*) into v_audiencia
    from public.lexph_suscriptores s
   where s.estado='confirmado'
     and not exists (select 1 from public.email_suppression sup
                      where lower(btrim(sup.email)) = s.email_norm);

  v_audiencia := greatest(v_audiencia, v_enviados);
  v_pct := case when v_audiencia > 0 then round(100.0 * v_enviados / v_audiencia) else 0 end;
  v_final := (v_pend = 0);

  select count(*)::numeric / 6.0 into v_rate_h
    from public.email_queue
   where template_slug = v_slug and status='sent' and sent_at > now() - interval '6 hours';
  v_hrs_mid := extract(epoch from ((v_art_today + 1)::timestamp - v_art_now)) / 3600.0;

  if v_final then
    v_estim := format('✅ ¡Envío COMPLETO! Se enviaron %s correos en total a la base de suscriptores. '
                      'Este es el informe final; no se envían más.', v_enviados);
  elsif coalesce(v_rate_h,0) <= 0 then
    v_estim := format('⚠️ No hubo envíos en las últimas 6 horas — puede que el dispatcher esté frenado. '
                      'Quedan %s pendientes. Conviene revisar la cola de correo.', v_pend);
  else
    v_est_eod := least(v_enviados_hoy + round(v_rate_h * v_hrs_mid)::int, v_enviados_hoy + v_pend);
    v_eta_dias := ceil(v_pend / (v_rate_h * 24.0));
    v_estim := format('El envío gotea a ~%s correos/hora (no se detiene: corre las 24 h). '
                      'Hoy habría mandado ~%s para la medianoche. A este ritmo, los %s pendientes '
                      'se completan alrededor del %s (~%s día%s más).',
                      round(v_rate_h), v_est_eod, v_pend,
                      to_char(v_art_today + v_eta_dias, 'DD/MM'),
                      v_eta_dias, case when v_eta_dias = 1 then '' else 's' end);
  end if;

  insert into public.email_queue
    (kind, template_slug, to_email, to_nombre, subject, variables, prioridad,
     related_table, related_id, programado_para)
  values
    ('workflow', 'lexph-reporte-diario', v_dest, 'Pablo',
     format('LexPH · Informe del envío — %s', to_char(v_art_today, 'DD/MM')),
     jsonb_build_object(
       'edicion',   coalesce(v_seq::text, '—'),
       'fecha',     to_char(v_art_now, 'DD/MM/YYYY HH24:MI') || ' hs',
       'enviados',  v_enviados::text,
       'audiencia', v_audiencia::text,
       'pct',       v_pct::text,
       'enviados_hoy', v_enviados_hoy::text,
       'pendientes', v_pend::text,
       'rebotes',   v_rebotes::text,
       'bajas_hoy', v_bajas_hoy::text,
       'bajas_total', v_bajas_tot::text,
       'nuevos_hoy', v_nuevos_hoy::text,
       'estimacion', v_estim,
       'nota_aperturas', '📭 Aperturas y clics: no se registran. El newsletter sale por Google Workspace, que no inserta pixel de seguimiento.',
       'nota_trafico', '🌐 Tráfico web de la sección LexPH: no medible desde la plataforma (sin analítica propia de la sección).'),
     3, 'lexph_reporte_diario', v_ed_id, now());

  if v_final then
    begin perform cron.unschedule('lexph-reporte-diario'); exception when others then null; end;
  end if;
end
$fn$;
