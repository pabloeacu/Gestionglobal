-- 0211 · F6 (Lista JL) · Webinars: esquema rico + disposición condicional
--
-- JL/Pablo: los webinars deben tener un esquema tipo curso (banner + docente(s)
-- con foto) y la inscripción es CONDICIONAL a que exista un webinar publicado y
-- vigente. Reglas (decisiones de Pablo):
--   · "Activo" = publicado AND status<>'cancelado' AND now() < fecha_hora +
--     duración (la inscripción se mantiene HASTA que el webinar termina).
--   · "El más próximo gana": si hay varios activos, manda el de fecha_hora más
--     cercana aún no terminado (no se bloquea publicar otro).
--   · Si NO hay webinar activo → la landing y el portal muestran una página de
--     texto (no un formulario).
--
-- Este chunk agrega el schema (aditivo, sin backfill: hoy hay 0 webinars) y la
-- RPC pública que el front usa para decidir form-vs-texto y traer la identidad
-- del webinar vigente. La UI de gerencia (banner + roster de docentes +
-- publicar) y la disposición condicional en landing/portal van en chunks
-- siguientes.

-- ---------------------------------------------------------------------------
-- 1 · Schema rico.
-- ---------------------------------------------------------------------------
ALTER TABLE public.webinars
  ADD COLUMN IF NOT EXISTS banner_url text,
  ADD COLUMN IF NOT EXISTS publicado  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS docentes   jsonb   NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.webinars.docentes IS
  'Roster del webinar: [{"nombre":"...","foto_url":"..."}] (F6 · DGG-63).';
COMMENT ON COLUMN public.webinars.publicado IS
  'El gerente lo publicó. Sólo un publicado+vigente se muestra en la inscripción (F6).';

-- Índice parcial para la búsqueda del webinar vigente (publicados, por fecha).
CREATE INDEX IF NOT EXISTS idx_webinars_publicado_fecha
  ON public.webinars (fecha_hora)
  WHERE publicado AND status <> 'cancelado';

-- ---------------------------------------------------------------------------
-- 2 · RPC pública: el webinar VIGENTE para inscripción (form-vs-texto).
--     Anon-callable (la landing es pública). SECURITY DEFINER para saltar la
--     RLS de webinars y devolver SÓLO los campos públicos (sin secretos Zoom).
-- ---------------------------------------------------------------------------
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
           w.formulario_id,
           f.slug  AS formulario_slug,
           f.activo AS formulario_activo
    FROM public.webinars w
    LEFT JOIN public.formularios f ON f.id = w.formulario_id
    WHERE w.publicado
      AND w.status <> 'cancelado'
      AND now() < (w.fecha_hora + make_interval(mins => w.duracion_min))
    ORDER BY w.fecha_hora ASC          -- el más próximo / en curso primero
    LIMIT 1
  ) t;
$function$;

GRANT EXECUTE ON FUNCTION public.webinar_inscripcion_activa() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3 · Smoke (R18): la RPC compila y corre sin error (hoy devuelve NULL: 0
--     webinars publicados vigentes). No referencia columnas inexistentes.
-- ---------------------------------------------------------------------------
DO $smoke$
DECLARE v jsonb;
BEGIN
  SELECT public.webinar_inscripcion_activa() INTO v;
  -- v puede ser NULL (sin webinar vigente) — lo que importa es que no reviente.
  RAISE NOTICE 'smoke F6 OK · webinar_inscripcion_activa() devolvió: %', COALESCE(v::text, 'NULL (sin webinar vigente)');
END
$smoke$;
