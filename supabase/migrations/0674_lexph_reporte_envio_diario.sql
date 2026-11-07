-- 0674 · DGG-244 F2 — Informe diario por mail del envío del newsletter LexPH (pedido de
-- Pablo 2026-11-07): "mandame un reporte por mail hoy a las 19 y otro mañana y así hasta
-- que termine todo completo el envío".
--
-- Métricas pedidas y su medibilidad:
--   · Enviados / faltan                 → email_queue (sí)
--   · Rebotes REALES (sin las sintéticas `.invalid` mal importadas, E-GG-267) → sent_emails (sí)
--   · Bajas (hoy / total)               → lexph_suscriptores.baja_at (sí)
--   · Nuevos suscriptores (web)         → lexph_suscriptores origen='web_lexph' (sí)
--   · ETA + estimación de fin de día    → ritmo real observado (sí)
--   · APERTURAS/CLICS                   → NO medible (Workspace sin pixel; sent_emails.opened_at
--                                          /clicked_at = NULL 100%). Se informa que no se mide.
--   · Tráfico web de /lexph             → NO medible desde la plataforma (sin analítica propia;
--                                          el pixel de Meta no es consultable desde acá).
--
-- Mecanismo: pg_cron 22:00 UTC (= 19:00 ART) → `private.lexph_reporte_envio_diario()` encola
-- un mail HTML (template-based, path probado) a Pablo con prioridad 3 (sale antes que el goteo
-- prioridad 8). Idempotente por día. **Auto-termina** (se desagenda) cuando pendientes=0 y
-- manda un informe FINAL. Robusto: no depende de ninguna sesión ni de la máquina de Pablo.

-- ============================================================================
-- 1. Template del informe (layout propio, legacy = body_html as-is)
-- ============================================================================
insert into public.email_templates
  (slug, nombre, asunto, from_casilla, activo, layout_version, body_html, body_text, descripcion)
values
  ('lexph-reporte-diario', 'LexPH · Informe diario de envío',
   'LexPH · Informe del envío del newsletter', 'general', true, 'legacy',
   '<div style="font-family:Arial,Helvetica,sans-serif;color:#122230;max-width:600px;margin:0 auto;">'
   '<div style="background:#0B1F33;padding:22px 24px;">'
     '<div style="color:#9CC7E4;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;">Gestión Global</div>'
     '<div style="color:#ffffff;font-size:21px;font-weight:bold;margin-top:6px;">Informe del envío · LexPH</div>'
     '<div style="color:#9CC7E4;font-size:13px;margin-top:4px;">Newsletter · Edición N°{{edicion}} — {{fecha}}</div>'
   '</div>'
   '<div style="padding:22px 24px;background:#F3F7FB;">'
     '<table style="width:100%;border-collapse:collapse;font-size:15px;">'
       '<tr><td style="padding:9px 0;border-bottom:1px solid #e2e8f0;">📤 <b>Enviados</b></td><td style="padding:9px 0;border-bottom:1px solid #e2e8f0;text-align:right;"><b>{{enviados}}</b> de {{audiencia}} <span style="color:#5D7284;">({{pct}}%)</span></td></tr>'
       '<tr><td style="padding:9px 0;border-bottom:1px solid #e2e8f0;color:#5D7284;">&nbsp;&nbsp;↳ hoy</td><td style="padding:9px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#5D7284;">{{enviados_hoy}}</td></tr>'
       '<tr><td style="padding:9px 0;border-bottom:1px solid #e2e8f0;">⏳ <b>Faltan</b></td><td style="padding:9px 0;border-bottom:1px solid #e2e8f0;text-align:right;"><b>{{pendientes}}</b></td></tr>'
       '<tr><td style="padding:9px 0;border-bottom:1px solid #e2e8f0;">↩️ <b>Rebotes reales</b><br><span style="color:#5D7284;font-size:12px;">(sin las direcciones mal importadas)</span></td><td style="padding:9px 0;border-bottom:1px solid #e2e8f0;text-align:right;">{{rebotes}}</td></tr>'
       '<tr><td style="padding:9px 0;border-bottom:1px solid #e2e8f0;">🚫 <b>Bajas</b></td><td style="padding:9px 0;border-bottom:1px solid #e2e8f0;text-align:right;">{{bajas_hoy}} hoy · {{bajas_total}} total</td></tr>'
       '<tr><td style="padding:9px 0;">✨ <b>Nuevos suscriptores</b> <span style="color:#5D7284;font-size:12px;">(web)</span></td><td style="padding:9px 0;text-align:right;">{{nuevos_hoy}} hoy</td></tr>'
     '</table>'
     '<div style="margin-top:18px;padding:14px 16px;background:#E7F1F9;border-left:3px solid #009ECA;font-size:14px;line-height:1.5;">'
       '<b>Ritmo y estimación.</b> {{estimacion}}'
     '</div>'
     '<p style="margin:16px 0 0;font-size:12px;color:#5D7284;line-height:1.5;">{{nota_aperturas}}</p>'
     '<p style="margin:6px 0 0;font-size:12px;color:#5D7284;line-height:1.5;">{{nota_trafico}}</p>'
   '</div>'
   '<div style="padding:13px 24px;background:#0B1F33;color:#64748b;font-size:11px;">Informe automático · se envía cada día a las 19:00 hasta completar el envío · gestionglobal.ar</div>'
   '</div>',
   'LexPH · Informe del envío (Edición {{edicion}}, {{fecha}}). Enviados {{enviados}} de {{audiencia}} ({{pct}}%), hoy {{enviados_hoy}}. Faltan {{pendientes}}. Rebotes reales {{rebotes}}. Bajas {{bajas_hoy}} hoy/{{bajas_total}} total. Nuevos {{nuevos_hoy}}. {{estimacion}} {{nota_aperturas}} {{nota_trafico}}',
   'DGG-244 · informe diario del envío del newsletter LexPH a Pablo (cron 19:00 ART).')
on conflict (slug) do update set
  asunto=excluded.asunto, from_casilla=excluded.from_casilla, activo=true,
  layout_version='legacy', body_html=excluded.body_html, body_text=excluded.body_text, updated_at=now();

-- ============================================================================
-- 2. Función del informe (cómputo + encolado + auto-término)
-- ============================================================================
create or replace function private.lexph_reporte_envio_diario()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
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
  -- Edición activa en envío
  select id, seq into v_ed_id, v_seq
    from public.lexph_ediciones
   where newsletter_enviado_at is not null
   order by newsletter_enviado_at desc limit 1;
  if not found then return; end if;
  v_slug := 'lexph-newsletter-e' || coalesce(v_seq::text, replace(v_ed_id::text, '-', ''));

  -- Idempotencia: ¿ya se encoló un informe HOY (ART)?
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

  select count(*) into v_audiencia from public.lexph_suscriptores where estado='confirmado';

  v_audiencia := greatest(v_audiencia, v_enviados);  -- nunca % > 100
  v_pct := case when v_audiencia > 0 then round(100.0 * v_enviados / v_audiencia) else 0 end;
  v_final := (v_pend = 0);

  -- Ritmo real (últimas 6h) y proyección
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

  -- Auto-término: cuando el envío terminó, desagendar el cron (el informe final ya salió).
  if v_final then
    begin perform cron.unschedule('lexph-reporte-diario'); exception when others then null; end;
  end if;
end
$fn$;

comment on function private.lexph_reporte_envio_diario() is
  'DGG-244 · Encola el informe diario del envío del newsletter LexPH a Pablo (prioridad 3). '
  'Idempotente por día. Auto-desagenda el cron al completar el envío (pendientes=0).';

-- ============================================================================
-- 3. Cron diario 22:00 UTC = 19:00 ART
-- ============================================================================
do $$ begin perform cron.unschedule('lexph-reporte-diario'); exception when others then null; end $$;
select cron.schedule('lexph-reporte-diario', '0 22 * * *',
  $$select private.lexph_reporte_envio_diario();$$);
