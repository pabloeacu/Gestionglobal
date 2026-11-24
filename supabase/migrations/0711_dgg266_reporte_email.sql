-- 0711 · DGG-266 — Email semanal integral + repunte del cron.
-- Reemplaza el "Reporte semanal · Captación PBA" (acotado) por un reporte semanal de
-- TODOS los correos automáticos con sus datos de interés. El detalle navegable completo
-- vive en el panel /gerencia/analitica/marketing (botón en el mail); el email es el
-- digest semanal con los KPIs. Fuente de datos: private._reporte_semanal_build (0710).
--
-- Engagement = visitas/clicks (UTM). NO aperturas (Gmail sin píxel, por entregabilidad).

-- (A) Template del digest (vars escalares; renderVars escapa, por eso sólo números/strings).
insert into public.email_templates (slug, nombre, asunto, body_html, body_text, from_casilla, activo, descripcion)
select
  'reporte-semanal-plataforma',
  'Reporte semanal · Automatización & Marketing',
  'Reporte semanal · Automatización & Marketing · Gestión Global',
  $html$<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#122230">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
  <tr><td style="background:#0b1f33;padding:28px 32px">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:#5fd0e6">Reporte semanal</p>
    <h1 style="margin:0;font-size:22px;color:#ffffff;font-weight:700">Automatización &amp; Marketing</h1>
    <p style="margin:6px 0 0;font-size:13px;color:#cfe0ef">Resumen de los últimos {{periodo}} · todos los correos automáticos de la plataforma</p>
  </td></tr>
  <tr><td style="padding:24px 32px 8px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="33%" style="padding:0 6px"><div style="background:#f3f7fb;border-radius:12px;padding:14px"><p style="margin:0;font-size:11px;color:#5d7284;text-transform:uppercase;letter-spacing:.04em">Correos enviados</p><p style="margin:4px 0 0;font-size:24px;font-weight:700;color:#122230">{{total_enviados}}</p></div></td>
      <td width="33%" style="padding:0 6px"><div style="background:#f3f7fb;border-radius:12px;padding:14px"><p style="margin:0;font-size:11px;color:#5d7284;text-transform:uppercase;letter-spacing:.04em">Tasa de rebote</p><p style="margin:4px 0 0;font-size:24px;font-weight:700;color:#122230">{{rebote_pct}}%</p></div></td>
      <td width="33%" style="padding:0 6px"><div style="background:#e7f1f9;border-radius:12px;padding:14px"><p style="margin:0;font-size:11px;color:#5d7284;text-transform:uppercase;letter-spacing:.04em">Visitas desde emails</p><p style="margin:4px 0 0;font-size:24px;font-weight:700;color:#009eca">{{visitas_email}}</p></div></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:16px 32px 4px">
    <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#122230">Por categoría</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse">
      <tr style="color:#5d7284;font-size:11px;text-transform:uppercase"><td style="padding:4px 0">Tipo</td><td align="right" style="padding:4px 0">Enviados</td><td align="right" style="padding:4px 0">Rebote</td></tr>
      <tr><td style="padding:7px 0;border-top:1px solid #eef2f6">📰 Newsletter LexPH</td><td align="right" style="border-top:1px solid #eef2f6;font-weight:600">{{nl_env}}</td><td align="right" style="border-top:1px solid #eef2f6;color:#5d7284">{{nl_reb}}%</td></tr>
      <tr><td style="padding:7px 0;border-top:1px solid #eef2f6">🎯 Captación PBA</td><td align="right" style="border-top:1px solid #eef2f6;font-weight:600">{{capt_env}}</td><td align="right" style="border-top:1px solid #eef2f6;color:#5d7284">{{capt_reb}}%</td></tr>
      <tr><td style="padding:7px 0;border-top:1px solid #eef2f6">📣 Ofrecimientos a clientes</td><td align="right" style="border-top:1px solid #eef2f6;font-weight:600">{{ofr_env}}</td><td align="right" style="border-top:1px solid #eef2f6;color:#5d7284">{{ofr_reb}}%</td></tr>
      <tr><td style="padding:7px 0;border-top:1px solid #eef2f6">🚀 Engagement / onboarding</td><td align="right" style="border-top:1px solid #eef2f6;font-weight:600">{{eng_env}}</td><td align="right" style="border-top:1px solid #eef2f6;color:#5d7284">{{eng_reb}}%</td></tr>
      <tr><td style="padding:7px 0;border-top:1px solid #eef2f6">🔔 Avisos automáticos a clientes</td><td align="right" style="border-top:1px solid #eef2f6;font-weight:600">{{avisos_env}}</td><td align="right" style="border-top:1px solid #eef2f6;color:#5d7284">{{avisos_reb}}%</td></tr>
      <tr><td style="padding:7px 0;border-top:1px solid #eef2f6">🧾 Transaccional / operativo</td><td align="right" style="border-top:1px solid #eef2f6;font-weight:600">{{trans_env}}</td><td align="right" style="border-top:1px solid #eef2f6;color:#5d7284">{{trans_reb}}%</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:14px 32px 4px">
    <div style="background:#f3f7fb;border-radius:12px;padding:14px 16px">
      <p style="margin:0 0 4px;font-size:12px;color:#5d7284">Campaña con más visitas</p>
      <p style="margin:0;font-size:15px;font-weight:700;color:#122230">{{top_camp}} <span style="color:#009eca">· {{top_camp_vis}} visitas</span></p>
      <p style="margin:10px 0 0;font-size:12px;color:#5d7284">Tráfico a /lexph: <b style="color:#122230">{{visitantes}}</b> visitantes · <b style="color:#122230">{{desde_newsletter}}</b> desde el newsletter · <b style="color:#122230">{{desde_email}}</b> desde emails.</p>
      <p style="margin:6px 0 0;font-size:12px;color:#5d7284">Captación PBA: <b style="color:#122230">{{conv_captacion}}</b> conversiones esta semana ({{conv_total}} en total) · {{en_cola}} en cola · motor {{motor_estado}}.</p>
    </div>
  </td></tr>
  <tr><td align="center" style="padding:20px 32px 8px">
    <a href="https://www.gestionglobal.ar{{url}}" style="display:inline-block;background:#009eca;color:#ffffff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">Ver el reporte completo →</a>
  </td></tr>
  <tr><td style="padding:12px 32px 28px">
    <p style="margin:0;font-size:11px;color:#8aa0b2;line-height:1.5">El <b>engagement se mide por clicks → visitas al sitio</b> (vía UTM), no por aperturas: enviamos por Gmail sin píxel de tracking, para cuidar la entregabilidad. {{supresiones}} supresiones nuevas en el período. Generado {{generado}}.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>$html$,
  $txt$Reporte semanal · Automatización & Marketing ({{periodo}})

Correos enviados: {{total_enviados}} · rebote {{rebote_pct}}% · visitas desde emails: {{visitas_email}}

Por categoría (enviados):
- Newsletter LexPH: {{nl_env}}
- Captación PBA: {{capt_env}}
- Ofrecimientos: {{ofr_env}}
- Engagement: {{eng_env}}
- Avisos a clientes: {{avisos_env}}
- Transaccional: {{trans_env}}

Campaña top: {{top_camp}} ({{top_camp_vis}} visitas)
Captación: {{conv_captacion}} conversiones esta semana ({{conv_total}} total), {{en_cola}} en cola.

Ver el reporte completo: https://www.gestionglobal.ar{{url}}

— Gestión Global$txt$,
  'general', true,
  'DGG-266 · Digest semanal de automatización + marketing a gerencia. Lo arma reporte_semanal_enviar() desde _reporte_semanal_build(). El detalle navegable vive en /gerencia/analitica/marketing.'
where not exists (select 1 from public.email_templates where slug = 'reporte-semanal-plataforma');

-- (B) Sender: arma las variables desde el jsonb y dispara los 3 canales a gerencia.
drop function if exists public.reporte_semanal_enviar(int);
create function public.reporte_semanal_enviar(p_dias int default 7)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
set "TimeZone" to 'America/Argentina/Buenos_Aires'
as $fn$
declare
  v_data jsonb;
  v_catmap jsonb;
  v_top_camp text; v_top_vis int;
  v_vars jsonb;
  v_cuerpo text;
  v_enviados int;
begin
  v_data := private._reporte_semanal_build(p_dias);

  select jsonb_object_agg(e->>'categoria', e) into v_catmap
  from jsonb_array_elements(v_data->'categorias') e;
  v_catmap := coalesce(v_catmap, '{}'::jsonb);

  select e->>'campana', coalesce((e->>'visitas')::int, 0) into v_top_camp, v_top_vis
  from jsonb_array_elements(v_data->'campanas') e
  order by coalesce((e->>'visitas')::int,0) desc, coalesce((e->>'enviados')::int,0) desc
  limit 1;

  v_enviados := coalesce((v_data->'totales'->>'enviados')::int, 0);

  v_vars := jsonb_build_object(
    'periodo', (v_data->>'dias') || ' días',
    'generado', to_char(now(), 'DD/MM/YYYY HH24:MI'),
    'total_enviados', v_enviados,
    'rebote_pct', coalesce(v_data->'totales'->>'rebote_pct', '0'),
    'supresiones', coalesce(v_data->'totales'->>'supresiones_nuevas', '0'),
    'visitas_email', (select coalesce(sum(coalesce((e->>'visitas')::int,0)),0)
                        from jsonb_array_elements(v_data->'campanas') e),
    'nl_env', coalesce((v_catmap->'newsletter'->>'enviados')::int, 0),
    'nl_reb', coalesce(v_catmap->'newsletter'->>'rebote_pct', '0'),
    'capt_env', coalesce((v_catmap->'captacion'->>'enviados')::int, 0),
    'capt_reb', coalesce(v_catmap->'captacion'->>'rebote_pct', '0'),
    'ofr_env', coalesce((v_catmap->'ofrecimiento'->>'enviados')::int, 0),
    'ofr_reb', coalesce(v_catmap->'ofrecimiento'->>'rebote_pct', '0'),
    'eng_env', coalesce((v_catmap->'engagement'->>'enviados')::int, 0),
    'eng_reb', coalesce(v_catmap->'engagement'->>'rebote_pct', '0'),
    'avisos_env', coalesce((v_catmap->'avisos_clientes'->>'enviados')::int, 0),
    'avisos_reb', coalesce(v_catmap->'avisos_clientes'->>'rebote_pct', '0'),
    'trans_env', coalesce((v_catmap->'transaccional'->>'enviados')::int, 0),
    'trans_reb', coalesce(v_catmap->'transaccional'->>'rebote_pct', '0'),
    'top_camp', coalesce(v_top_camp, '—'),
    'top_camp_vis', coalesce(v_top_vis, 0),
    'visitantes', coalesce(v_data->'trafico'->>'visitantes', 'n/d'),
    'desde_newsletter', coalesce(v_data->'trafico'->>'desde_newsletter', 'n/d'),
    'desde_email', coalesce(v_data->'trafico'->>'desde_email', 'n/d'),
    'conv_captacion', coalesce(v_data->'captacion'->>'conversiones_semana', '0'),
    'conv_total', coalesce(v_data->'captacion'->>'conversiones_total', '0'),
    'en_cola', coalesce(v_data->'captacion'->>'en_cola', '0'),
    'motor_estado', case when (v_data->'captacion'->>'motor_activo')::boolean then 'activo' else 'apagado' end,
    'url', '/gerencia/analitica/marketing'
  );

  v_cuerpo := format(
    'Semana: %s correos (%s%% rebote) · %s visitas desde emails · %s conversiones de captación. Ver el detalle completo en el panel.',
    v_enviados, coalesce(v_data->'totales'->>'rebote_pct','0'),
    (v_vars->>'visitas_email'), coalesce(v_data->'captacion'->>'conversiones_semana','0'));

  perform public.notify_all_gerentes(
    'reporte_semanal_plataforma',
    'Reporte semanal · Automatización & Marketing',
    v_cuerpo,
    '/gerencia/analitica/marketing',
    '{}'::jsonb,
    true,
    'reporte-semanal-plataforma',
    v_vars,
    5::smallint
  );

  return jsonb_build_object('ok', true, 'enviados', v_enviados, 'vars', v_vars);
end
$fn$;

revoke all on function public.reporte_semanal_enviar(int) from public, anon, authenticated;
grant execute on function public.reporte_semanal_enviar(int) to service_role;

-- (C) Cron: retirar el reporte acotado de captación, agendar el integral (lunes 12:00 UTC = 9 AR).
select cron.unschedule('prospectos-reporte-semanal')
  where exists (select 1 from cron.job where jobname = 'prospectos-reporte-semanal');
select cron.unschedule('reporte-semanal-plataforma')
  where exists (select 1 from cron.job where jobname = 'reporte-semanal-plataforma');
select cron.schedule('reporte-semanal-plataforma', '0 12 * * 1', $cron$ select public.reporte_semanal_enviar(7); $cron$);
