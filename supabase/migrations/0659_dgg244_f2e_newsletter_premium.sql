-- DGG-244 · F2e — Newsletter premium "tipo revista" (render dinámico por edición)
-- ---------------------------------------------------------------------------
-- Feedback de Pablo: el newsletter por mail debe ser un VISTAZO ESTÉTICO de la
-- edición (hero LexPH protagonista en blanco sobre navy, resumen ejecutivo 01-N,
-- tendencias por materia, nota de tapa CON FOTO, logo GG "en el medio" y un
-- bloque "Hay mucho más"), con la piel de marca GG.
--
-- Arquitectura (sin tocar el edge money-crítico `dispatch-emails`, R7):
--  · `lexph_newsletter_html(edicion)` compone el documento HTML completo email-safe
--    desde los datos de la edición (intro, resumen[], tendencias[], editorial,
--    nota de tapa + imagen_url). `{{baja_url}}` queda como única variable (la
--    rellena el dispatcher por-suscriptor vía renderVars).
--  · `lexph_newsletter_enviar(edicion)` compone el HTML, hace UPSERT de un template
--    POR-EDICIÓN (`lexph-newsletter-e<seq>`, layout legacy = documento verbatim) y
--    encola a los confirmados no suprimidos. Template por-edición = inmutable
--    durante el drenado ⇒ sin race entre ediciones (el dispatcher renderiza al
--    enviar, no al encolar). Historial preservado en `sent_emails.html`.
--
-- R18: esta mig cambia el INSERT de una RPC ⇒ smoke e2e obligatorio (abajo del
-- apply, en el chunk). R16: firma de `lexph_newsletter_enviar` sin cambios
-- (CREATE OR REPLACE, 0 overloads nuevos).

-- helper: escape HTML de contenido dinámico (staff-authored, pero defensivo)
create or replace function private.lexph_esc(t text)
returns text language sql immutable as $$
  select replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
$$;

-- composer: documento HTML completo del newsletter de una edición
create or replace function public.lexph_newsletter_html(p_edicion_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_ed       record;
  v_dest     record;
  v_item     jsonb;
  v_meses    text[] := array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  v_fecha    text;
  v_photo    text := '';
  v_nota     text := '';
  v_res_rows text := '';
  v_res_sec  text := '';
  v_tend_rows text := '';
  v_tend_more text := '';
  v_tend_sec text := '';
  v_tend_extra text := '';
  v_n_tend   int;
  v_idx      int := 0;
  v_txt      text;
  v_ed_tit   text;
  v_masmas   text;
  v_html     text;
begin
  select e.intro, e.seq, e.resumen, e.tendencias, e.editorial, e.publicado_at, e.destacado_articulo_id
    into v_ed
    from public.lexph_ediciones e where e.id = p_edicion_id;
  if not found then return null; end if;

  -- fecha en español (o "Nueva edición" si no está publicada)
  if v_ed.publicado_at is not null then
    v_fecha := extract(day from v_ed.publicado_at)::int::text || ' de '
            || v_meses[extract(month from v_ed.publicado_at)::int] || ' de '
            || extract(year from v_ed.publicado_at)::int::text;
  else
    v_fecha := 'Esta edición';
  end if;

  -- nota de tapa (artículo destacado publicado)
  select a.titulo, a.resumen, a.slug, a.imagen_url, a.imagen_alt
    into v_dest
    from public.lexph_articulos a
   where a.id = v_ed.destacado_articulo_id and a.estado = 'publicado';

  if v_dest.titulo is not null then
    if v_dest.imagen_url is not null and v_dest.imagen_url ~* '^https?://' then
      v_photo := '<tr><td style="font-size:0;line-height:0;"><a href="https://www.gestionglobal.ar/lexph/'
        || v_dest.slug || '"><img src="' || replace(v_dest.imagen_url, '&', '&amp;')
        || '" width="536" alt="' || private.lexph_esc(coalesce(v_dest.imagen_alt, v_dest.titulo))
        || '" style="display:block;width:100%;max-width:536px;height:auto;border:0;" /></a></td></tr>';
    end if;
    v_nota := '<tr><td style="padding:26px 32px 4px;"><p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:#009eca;">Nota de tapa</p>'
      || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f7fb;border-top:3px solid #0b1f33;">'
      || v_photo
      || '<tr><td style="padding:20px 22px;"><h2 style="margin:0 0 10px;font-size:21px;line-height:1.25;font-weight:800;color:#0b1f33;">'
      || private.lexph_esc(v_dest.titulo) || '</h2>'
      || '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#5d7284;">'
      || private.lexph_esc(coalesce(v_dest.resumen, '')) || '</p>'
      || '<a href="https://www.gestionglobal.ar/lexph/' || v_dest.slug
      || '" style="display:inline-block;background:#009eca;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-decoration:none;padding:11px 20px;">Leer la nota &nbsp;&rsaquo;</a>'
      || '</td></tr></table></td></tr>';
  end if;

  -- resumen ejecutivo (01..N, todos)
  v_idx := 0;
  for v_item in select jsonb_array_elements(coalesce(v_ed.resumen, '[]'::jsonb)) loop
    v_idx := v_idx + 1;
    v_res_rows := v_res_rows
      || '<tr><td style="'
      || case when v_idx = 1 then 'padding:0 0 14px;' else 'border-top:1px solid #e2e8f0;padding:14px 0;' end
      || '" valign="top"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
      || '<td width="34" valign="top" style="font-size:15px;font-weight:800;color:#009eca;">'
      || lpad(v_idx::text, 2, '0')
      || '</td><td valign="top" style="font-size:14.5px;line-height:1.55;color:#1e293b;"><strong style="color:#0b1f33;">'
      || private.lexph_esc(v_item->>'titulo')
      || case when right(btrim(coalesce(v_item->>'titulo', '')), 1) ~ '[.!?:…]' then '' else '.' end
      || '</strong> '
      || private.lexph_esc(v_item->>'texto')
      || '</td></tr></table></td></tr>';
  end loop;
  if v_res_rows <> '' then
    v_res_sec := '<tr><td style="padding:30px 32px 4px;"><p style="margin:0;font-size:13px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:#159aa6;">Resumen ejecutivo</p>'
      || '<p style="margin:3px 0 16px;font-size:13px;color:#5d7284;">El scan rápido de la edición</p>'
      || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' || v_res_rows || '</table></td></tr>';
  end if;

  -- tendencias por materia (hasta 3 como teaser + "N más")
  v_idx := 0;
  for v_item in select jsonb_array_elements(coalesce(v_ed.tendencias, '[]'::jsonb)) loop
    v_idx := v_idx + 1;
    if v_idx <= 3 then
      v_txt := v_item->>'texto';
      if length(v_txt) > 180 then
        v_txt := regexp_replace(left(v_txt, 180), '\s+\S*$', '') || '…';
      end if;
      v_tend_rows := v_tend_rows
        || '<tr><td style="'
        || case when v_idx = 1 then 'padding:0 0 14px;' else 'border-top:1px solid #e2e8f0;padding:14px 0;' end
        || '"><span style="display:inline-block;background:#e7f1f9;color:#2e6fb0;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;padding:4px 9px;margin:0 0 7px;">'
        || private.lexph_esc(v_item->>'materia') || '</span>'
        || '<p style="margin:0;font-size:14px;line-height:1.55;color:#475569;">'
        || private.lexph_esc(v_txt) || '</p></td></tr>';
    else
      v_tend_extra := v_tend_extra || case when v_tend_extra = '' then '' else ' · ' end || coalesce(v_item->>'materia', '');
    end if;
  end loop;
  v_n_tend := jsonb_array_length(coalesce(v_ed.tendencias, '[]'::jsonb));
  if v_n_tend > 3 then
    v_tend_more := '<p style="margin:16px 0 0;font-size:13px;color:#5d7284;">+ ' || (v_n_tend - 3)::text
      || ' materias más (' || private.lexph_esc(v_tend_extra) || ') en la web.</p>';
  end if;
  if v_tend_rows <> '' then
    v_tend_sec := '<tr><td style="padding:30px 32px 4px;"><p style="margin:0 0 16px;font-size:13px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:#159aa6;">Tendencias por materia</p>'
      || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' || v_tend_rows || '</table>' || v_tend_more || '</td></tr>';
  end if;

  -- teaser "hay mucho más" (nombra el editorial si lo hay)
  v_ed_tit := v_ed.editorial->>'titulo';
  if coalesce(v_ed_tit, '') <> '' then
    v_masmas := 'El insight editorial completo —«' || private.lexph_esc(v_ed_tit) || '»—, las tendencias por materia y todas las notas te esperan en la web.';
  else
    v_masmas := 'El insight editorial, las tendencias por materia y todas las notas te esperan en la web.';
  end if;

  -- documento completo
  v_html :=
     $x$<!doctype html>
<html lang="es"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>LexPH</title></head>
<body style="margin:0;padding:0;background:#eef3f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#122230;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#eef3f8;font-size:1px;line-height:1px;">Resumen ejecutivo, tendencias por materia y la nota de tapa de la nueva edición de LexPH.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef3f8;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;">
<tr><td style="background:#0b1f33;background:linear-gradient(135deg,#0b1f33 0%,#122f4c 55%,#13596b 100%);padding:40px 24px 34px;" align="center">
<img src="https://www.gestionglobal.ar/brand/lexph-logo-white.png" width="240" alt="LexPH" style="display:block;width:240px;max-width:240px;height:auto;margin:0 auto;" />
<p style="margin:22px 0 0;font-size:12px;font-weight:700;letter-spacing:2.4px;text-transform:uppercase;color:#9cc7e4;">Nueva edición &nbsp;·&nbsp; $x$ || v_fecha || $x$</p>
<p style="margin:6px 0 0;font-size:12px;letter-spacing:1px;color:#6f93b4;text-transform:uppercase;">Inteligencia jurídica en propiedad horizontal</p>
</td></tr>
<tr><td style="height:4px;background:#009eca;line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:4px solid #009eca;padding:2px 0 2px 16px;"><p style="margin:0;font-size:16px;line-height:1.6;color:#1e293b;">$x$ || private.lexph_esc(v_ed.intro) || $x$</p></td></tr></table></td></tr>
$x$
     || v_nota
     || v_res_sec
     || v_tend_sec
     || $x$<tr><td style="padding:28px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f7fb;"><tr><td align="center" style="padding:22px 20px;"><img src="https://www.gestionglobal.ar/brand/logo-h.png" width="150" alt="Gestión Global" style="display:block;width:150px;max-width:150px;height:auto;margin:0 auto 8px;" /><p style="margin:0;font-size:12px;letter-spacing:0.6px;color:#5d7284;text-transform:uppercase;">LexPH es un servicio de Gestión Global</p></td></tr></table></td></tr>
<tr><td style="padding:0 32px 34px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b1f33;"><tr><td align="center" style="padding:30px 26px;"><p style="margin:0 0 8px;font-size:20px;font-weight:800;color:#ffffff;line-height:1.3;">Hay mucho más en esta edición</p><p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#9cc7e4;">$x$ || v_masmas || $x$</p><a href="https://www.gestionglobal.ar/lexph" style="display:inline-block;background:#009eca;color:#ffffff;font-size:14px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;text-decoration:none;padding:14px 30px;">Leer la edición completa</a></td></tr></table></td></tr>
<tr><td style="padding:18px 32px 30px;border-top:1px solid #e2e8f0;"><p style="margin:0;font-size:11px;line-height:1.6;color:#94a3b8;text-align:center;">Enviado por <strong style="color:#475569;">Gestión Global</strong> · <a href="https://www.gestionglobal.ar" style="color:#009eca;text-decoration:none;">gestionglobal.ar</a><br />Recibís esto porque te suscribiste a LexPH. <a href="{{baja_url}}" style="color:#94a3b8;text-decoration:underline;">Darme de baja</a>.</p></td></tr>
</table></td></tr></table></body></html>$x$;

  return v_html;
end
$fn$;

revoke all on function public.lexph_newsletter_html(uuid) from public;

-- RPC de envío: compone + upsert template por-edición + encola a confirmados
create or replace function public.lexph_newsletter_enviar(p_edicion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_intro   text;
  v_seq     int;
  v_already timestamptz;
  v_html    text;
  v_slug    text;
  v_count   int := 0;
begin
  if not (select private.is_staff()) then
    raise exception 'Sólo el staff de gerencia puede enviar el newsletter.' using errcode = '42501';
  end if;

  select e.intro, e.seq, e.newsletter_enviado_at
    into v_intro, v_seq, v_already
    from public.lexph_ediciones e where e.id = p_edicion_id;
  if not found then
    raise exception 'Edición no encontrada (id=%).', p_edicion_id using errcode = 'P0002';
  end if;
  if coalesce(btrim(v_intro), '') = '' then
    raise exception 'Completá al menos la intro del digest antes de enviar el newsletter.' using errcode = '22023';
  end if;

  v_html := public.lexph_newsletter_html(p_edicion_id);
  if v_html is null then
    raise exception 'No se pudo generar el HTML del newsletter.' using errcode = 'P0002';
  end if;

  v_slug := 'lexph-newsletter-e' || coalesce(v_seq::text, replace(p_edicion_id::text, '-', ''));

  -- template POR-EDICIÓN (legacy = documento verbatim; estable ⇒ sin race)
  insert into public.email_templates (slug, nombre, asunto, body_html, from_casilla, layout_version, activo)
  values (v_slug,
          'LexPH Newsletter · Edición ' || coalesce(v_seq::text, '') || ' (auto-generado)',
          'Novedades de propiedad horizontal · LexPH',
          v_html, 'general', 'legacy', true)
  on conflict (slug) do update
    set body_html = excluded.body_html,
        asunto = excluded.asunto,
        layout_version = 'legacy',
        from_casilla = 'general',
        activo = true,
        updated_at = now();

  -- encolar a confirmados no suprimidos
  insert into public.email_queue
    (kind, template_slug, to_email, variables, prioridad, related_table, related_id, programado_para)
  select 'workflow', v_slug, s.email,
         jsonb_build_object('baja_url', 'https://www.gestionglobal.ar/lexph/baja?token=' || s.baja_token),
         5, 'lexph_suscriptores', s.id, now()
    from public.lexph_suscriptores s
   where s.estado = 'confirmado'
     and not exists (
       select 1 from public.email_suppression sup
        where lower(btrim(sup.email)) = s.email_norm
     );
  get diagnostics v_count = row_count;

  update public.lexph_ediciones set newsletter_enviado_at = now() where id = p_edicion_id;

  return jsonb_build_object('ok', true, 'enviados', v_count, 'reenvio', v_already is not null);
end
$fn$;
