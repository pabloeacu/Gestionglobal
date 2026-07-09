-- 0296 · Copy sweep webinar→evento en los emails de inscripción (Pablo).
-- Los templates viven en public.email_templates (seed 0051). Reemplazamos SÓLO
-- la palabra suelta "webinar" (asunto/body_text/body_html) por "evento", para
-- que los correos sean abarcativos a cualquier tipo de evento (charla, jornada,
-- taller, presencial…). NO tocamos:
--   · los slugs (identificadores internos referenciados por el dispatcher),
--   · las variables {{webinar_titulo}}, {{webinar_*}} (el `\y...\y` de borde de
--     palabra NO matchea "webinar" seguido de "_", verificado en vivo),
--   · URLs (no hay literal "/webinar" en los cuerpos, verificado en vivo).
UPDATE public.email_templates
SET asunto    = regexp_replace(asunto,    '\ywebinar\y', 'evento', 'g'),
    body_text = regexp_replace(coalesce(body_text, ''), '\ywebinar\y', 'evento', 'g'),
    body_html = regexp_replace(coalesce(body_html, ''), '\ywebinar\y', 'evento', 'g')
WHERE slug LIKE 'webinar-%'
  AND (asunto ~ '\ywebinar\y' OR body_text ~ '\ywebinar\y' OR body_html ~ '\ywebinar\y');
