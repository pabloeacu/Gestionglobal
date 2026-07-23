-- ============================================================================
-- 0380 · DGG-116 · Unificación de criterio de publicación de cursos
--        (reglas acordadas con Pablo, 2026-07-23)
--
-- MODELO NUEVO (3 estados en vez de 4):
--   · PUBLICADO   = check "Visible" puesto (activo=true) → el alumno lo ve.
--   · NO VISIBLE  = check apagado (activo=false) → el alumno no lo ve, pero
--                   la gerencia SÍ puede matricularlo (card de expectativa).
--                   (antes se llamaba "Borrador".)
--   · FINALIZADO  = pasó la fecha de fin (despublicar_at) → NO se matricula;
--                   los ya matriculados conservan su ventana de repaso (DGG-82).
--
-- DIFERENCIA CLAVE con DGG-115: el estado 'programado' DESAPARECE. En el
-- modelo de Pablo, tildar "Visible" hace visible el curso YA, sin importar la
-- fecha (permite anticipar la visibilidad). La fecha de inicio NO retiene la
-- visibilidad — solo sirve como DISPARADOR para auto-tildar el check.
--
-- La visibilidad se dispara de dos formas:
--   1. Manual: la gerencia tilda el check "Visible".
--   2. Automática: al llegar la fecha de inicio (reusamos la columna
--      `publicar_at`, re-etiquetada "Fecha de inicio" en el editor), un cron
--      a las 00:00 AR tilda el check. Idempotente y con salvaguarda: si la
--      gerencia oculta a mano un curso ya procesado, NO se re-abre.
--
-- Matriculación: SIN CAMBIOS de fondo — solo los FINALIZADOS se rechazan
-- (guards en curso_asignar_alumno/curso_matricular). Ya era así (DGG-115).
--
-- SEGURIDAD del cambio (auditado en BD viva antes de tocar):
--   · Ningún consumidor de curso_estado_publicacion compara con 'borrador'
--     ni 'programado' — todos usan IN ('publicado','finalizado') o
--     = 'finalizado'. Renombrar 'borrador'→'no_visible' y quitar 'programado'
--     es transparente para RLS/guards/crons.
--   · Ningún curso real usa publicar_at (todas las fechas vacías) → el estado
--     derivado de los 4 cursos existentes NO cambia con esta mig.
--   · La rama que aceptaba 'programado' en gg_encuentros_recordatorio_diario
--     (0375) queda inerte (el derivador ya no devuelve 'programado'); no se
--     toca esa función para no recrear ~100 líneas — el curso cuya fecha
--     llegó ya fue tildado por el cron a las 00:00 → es 'publicado' y lo
--     agarra la rama IN ('publicado','finalizado'). Deuda cosmética anotada.
-- ============================================================================

-- ── 1 · Marca anti-re-activación del cron ────────────────────────────────────
ALTER TABLE public.cursos ADD COLUMN IF NOT EXISTS visibilidad_auto_at timestamptz;
COMMENT ON COLUMN public.cursos.visibilidad_auto_at IS
  'DGG-116: cuándo el cron de visibilización procesó este curso por su fecha de inicio (publicar_at). NULL = pendiente. Una vez procesado, el cron no lo vuelve a tocar (si gerencia lo oculta después, queda oculto). Columna AUTO (R14): la setea el cron, sin editor.';

-- ── 2 · Derivador simplificado a 3 estados ───────────────────────────────────
--   (misma firma → CREATE OR REPLACE seguro, R16; las policies y RPCs que la
--    referencian por nombre toman la nueva definición automáticamente.)
CREATE OR REPLACE FUNCTION private.curso_estado_publicacion(
  p_activo boolean, p_publicar_at timestamp with time zone, p_despublicar_at timestamp with time zone
) RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  SELECT CASE
    WHEN p_despublicar_at IS NOT NULL AND p_despublicar_at <= now() THEN 'finalizado'
    WHEN COALESCE(p_activo, false) = false THEN 'no_visible'
    ELSE 'publicado'
  END
$function$;

-- ── 3 · Cron: visibilizar cursos cuya fecha de inicio llegó ──────────────────
--   Procesa TODOS los cursos con fecha ya cumplida y aún no procesados
--   (visibilidad_auto_at IS NULL): a los ocultos los tilda; a los que la
--   gerencia ya había tildado a mano (anticipado) solo los marca. En ambos
--   casos deja la marca → nunca los vuelve a tocar (respeta un ocultado
--   manual posterior). Nunca re-abre un curso ya finalizado.
CREATE OR REPLACE FUNCTION public.gg_cursos_visibilizar_por_fecha()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_tildados int := 0;
  v_procesados int := 0;
BEGIN
  WITH candidatos AS (
    SELECT c.id, COALESCE(c.activo, false) AS estaba_activo
    FROM public.cursos c
    WHERE c.publicar_at IS NOT NULL
      AND (c.publicar_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= v_hoy
      AND c.visibilidad_auto_at IS NULL
      AND (c.despublicar_at IS NULL OR c.despublicar_at > now())  -- nunca re-abrir finalizados
    FOR UPDATE
  ),
  upd AS (
    UPDATE public.cursos c
    SET activo = true, visibilidad_auto_at = now()
    FROM candidatos ca
    WHERE c.id = ca.id
    RETURNING ca.estaba_activo
  )
  SELECT count(*), count(*) FILTER (WHERE NOT estaba_activo)
    INTO v_procesados, v_tildados
  FROM upd;
  RETURN jsonb_build_object('ok', true, 'fecha', v_hoy,
    'cursos_procesados', v_procesados, 'cursos_tildados', v_tildados);
END; $$;

-- Mass-updater interno: sólo el cron lo ejecuta (postgres/owner). Sin GRANTs.
REVOKE ALL ON FUNCTION public.gg_cursos_visibilizar_por_fecha() FROM PUBLIC, anon, authenticated;

-- Cron a las 00:00 AR (03:00 UTC). Corre ANTES del cron de aviso "curso
-- publicado" (job 28, minuto 12 de cada hora): a las 00:12 el aviso ya
-- encuentra el curso recién visibilizado y notifica a los matriculados.
SELECT cron.schedule(
  'gg-cursos-visibilizar-por-fecha',
  '0 3 * * *',
  'SELECT public.gg_cursos_visibilizar_por_fecha();'
);
