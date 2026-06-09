-- 0213 · F6 (Lista JL · DGG-63) · RPC del webinar vigente: fallback al form compartido
--
-- Decisión de Pablo (chunk 3): FORM COMPARTIDO. El editor de gerencia NO tiene
-- selector de formulario; todos los webinars usan el form de categoría
-- 'evento' (hoy 'webinarios'). Pero el alta deja webinars.formulario_id = NULL,
-- así que la RPC devolvía formulario_slug = NULL y la página branded no sabía
-- qué formulario embeber.
--
-- Fix: la RPC resuelve el formulario como COALESCE(formulario propio del
-- webinar, el form 'evento' compartido). Espeja al trigger
-- inscribir_webinar_desde_submission(), que ya inscribe al vigente cuando el
-- form de evento no apunta a un webinar puntual (mig 0212). Así el formulario
-- que se MUESTRA y el que INSCRIBE son el mismo, de punta a punta.
--
-- Misma firma (sin args) → CREATE OR REPLACE, sin overload nuevo (R16).

CREATE OR REPLACE FUNCTION public.webinar_inscripcion_activa()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT to_jsonb(t) FROM (
    SELECT w.id,
           w.titulo,
           w.descripcion,
           w.banner_url,
           w.docentes,
           w.fecha_hora,
           w.duracion_min,
           w.plataforma,
           COALESCE(w.formulario_id, ev.id)     AS formulario_id,
           COALESCE(f.slug, ev.slug)            AS formulario_slug,
           COALESCE(f.activo, ev.activo)        AS formulario_activo
    FROM public.webinars w
    LEFT JOIN public.formularios f ON f.id = w.formulario_id
    LEFT JOIN LATERAL (
      -- El form de inscripción compartido: categoría 'evento', activo, el más
      -- antiguo (hoy 'webinarios' es el único).
      SELECT fe.id, fe.slug, fe.activo
      FROM public.formularios fe
      WHERE fe.categoria = 'evento' AND fe.activo
      ORDER BY fe.created_at ASC
      LIMIT 1
    ) ev ON true
    WHERE w.id = private.webinar_vigente_id()
  ) t;
$function$;

GRANT EXECUTE ON FUNCTION public.webinar_inscripcion_activa() TO anon, authenticated;

-- Smoke no mutante: hoy 0 webinars vigentes → NULL, sin reventar.
DO $smoke$
DECLARE v jsonb;
BEGIN
  SELECT public.webinar_inscripcion_activa() INTO v;
  RAISE NOTICE 'smoke 0213 OK · rpc=%', COALESCE(v::text, 'NULL');
END
$smoke$;
