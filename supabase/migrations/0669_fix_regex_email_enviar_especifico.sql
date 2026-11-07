-- 0669 · FIX regex de validación de email en lexph_newsletter_enviar_especifico
-- (E-GG-263). Bug PRE-EXISTENTE (desde PR #4, DGG-244 F2n) que destapó el smoke
-- R18 de la mig 0668.
--
-- CAUSA RAÍZ: el literal del regex era '…\\.…' (DOS backslashes). Con
-- standard_conforming_strings = on (default de PG17 y de PostgREST), el literal
-- SQL '\\.' son los 3 caracteres «\ \ .» → el motor POSIX lo lee como «backslash
-- literal» + «cualquier char», no como «punto literal». Ningún email tiene un
-- backslash → el regex NO matchea NUNCA → `enviar_especifico` encolaba 0
-- destinatarios SIEMPRE (y tampoco daba de alta los suscriptores pegados).
-- El feature #4 (envío a mails específicos) estaba muerto en silencio.
--
-- Por qué no se detectó: el QA de #4 sólo probó el parseo del FRONTEND
-- ("2 mails detectados"), nunca se ejercitó el INSERT del backend. R18
-- (smoke e2e real de la RPC) lo cazó al primer intento.
--
-- FIX: el literal correcto es '\.' (UN backslash) → con std_conforming on son
-- los 2 chars «\ .» → POSIX lo lee como «punto literal». Verificado e2e abajo.
-- No afecta a `lexph_newsletter_enviar` (campaña masiva): esa RPC no usa regex,
-- selecciona todos los confirmados — la campaña viva de 3027 está intacta.
--
-- Mantiene todo lo de 0668 (max_intentos=10 en el INSERT). Firma idéntica → sin
-- overload (R16). Smoke R18 e2e al cierre.

CREATE OR REPLACE FUNCTION public.lexph_newsletter_enviar_especifico(p_edicion_id uuid, p_emails text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_intro   text;
  v_seq     int;
  v_html    text;
  v_slug    text;
  v_count   int := 0;
  c_cap_dia constant int := 1500;
begin
  if not (select private.is_staff()) then
    raise exception 'Sólo el staff de gerencia puede enviar el newsletter.' using errcode = '42501';
  end if;
  if p_emails is null or array_length(p_emails, 1) is null then
    raise exception 'No pasaste ningún mail.' using errcode = '22023';
  end if;

  select e.intro, e.seq into v_intro, v_seq from public.lexph_ediciones e where e.id = p_edicion_id;
  if not found then raise exception 'Edición no encontrada.' using errcode = 'P0002'; end if;
  if coalesce(btrim(v_intro), '') = '' then
    raise exception 'Completá al menos la intro del digest antes de enviar.' using errcode = '22023';
  end if;

  v_html := public.lexph_newsletter_html(p_edicion_id);
  if v_html is null then raise exception 'No se pudo generar el HTML.' using errcode = 'P0002'; end if;
  v_slug := 'lexph-newsletter-e' || coalesce(v_seq::text, replace(p_edicion_id::text, '-', ''));

  insert into public.email_templates (slug, nombre, asunto, body_html, from_casilla, layout_version, activo)
  values (v_slug, 'LexPH Newsletter · Edición ' || coalesce(v_seq::text, '') || ' (auto-generado)',
          'Novedades de propiedad horizontal · LexPH', v_html, 'general', 'legacy', true)
  on conflict (slug) do update
    set body_html = excluded.body_html, asunto = excluded.asunto,
        layout_version = 'legacy', from_casilla = 'general', activo = true, updated_at = now();

  insert into public.lexph_suscriptores (email, email_norm, estado, origen, confirmed_at)
  select distinct on (lower(btrim(e))) btrim(e), lower(btrim(e)), 'confirmado', 'manual', now()
    from unnest(p_emails) e
   where lower(btrim(e)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     and not exists (select 1 from public.email_suppression s where s.email = lower(btrim(e)))
   order by lower(btrim(e))
  on conflict (email_norm) do nothing;

  insert into public.email_queue
    (kind, template_slug, to_email, variables, prioridad, related_table, related_id, programado_para, max_intentos)
  select 'workflow', v_slug, s.email,
         jsonb_build_object('baja_url', 'https://www.gestionglobal.ar/lexph/baja?token=' || s.baja_token),
         8, 'lexph_suscriptores', s.id,
         now() + (floor((row_number() over (order by s.email) - 1) / c_cap_dia))::int * interval '1 day',
         10
    from public.lexph_suscriptores s
   where s.email_norm = any (select distinct lower(btrim(e)) from unnest(p_emails) e
                             where lower(btrim(e)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
     and s.estado = 'confirmado'
     and not exists (select 1 from public.email_suppression sup where sup.email = s.email_norm)
     and not exists (select 1 from public.email_queue q2
                      where q2.template_slug = v_slug and q2.enviado_at is null
                        and lower(btrim(q2.to_email)) = s.email_norm);
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'enviados', v_count);
end
$function$;
