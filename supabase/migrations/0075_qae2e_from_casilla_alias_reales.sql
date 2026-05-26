-- 0075 · EGG-QA-06 · Re-mapear from_casilla a categorías que tienen alias real
-- (aplicada el 2026-05-26 via apply_migration; copia versionada).
--
-- Contexto: las casillas info@/facturacion@/tramites@/recupero@ NO existen
-- en Workspace (confirmado por el usuario). Workspace tiene 4 alias REALES:
--   cursos@gestionglobal.ar              → from_casilla='cursos'
--   webinar@gestionglobal.ar             → from_casilla='webinar'
--   consultoriajuridica@gestionglobal.ar → from_casilla='juridico'
--   contacto@gestionglobal.ar            → from_casilla='general' (default)
-- Cualquier envío con From de alias inexistente lo descartaba Gmail
-- silenciosamente (la API devolvía provider_msg_id pero el delivery final
-- no entregaba al inbox).

ALTER TABLE public.email_templates DROP CONSTRAINT IF EXISTS email_templates_from_casilla_check;

UPDATE public.email_templates SET from_casilla = 'webinar'
WHERE slug IN ('webinar-bienvenida', 'webinar-recordatorio-1h', 'webinar-recordatorio-24h');

UPDATE public.email_templates SET from_casilla = 'general'
WHERE from_casilla IN ('info', 'facturacion', 'tramites', 'recupero');

ALTER TABLE public.email_templates
  ADD CONSTRAINT email_templates_from_casilla_check
  CHECK (from_casilla = ANY (ARRAY['cursos','webinar','juridico','general']));

COMMENT ON COLUMN public.email_templates.from_casilla IS
  'EGG-QA-06 (2026-05-26): categoria que mapea a alias real en Workspace. cursos→cursos@, webinar→webinar@, juridico→consultoriajuridica@, general→contacto@. dispatch-emails.ts/aliasFor() hace el mapeo.';
