-- ============================================================================
-- 0245_dgg82_acceso_post_finalizacion.sql
-- DGG-82 · Ventana de acceso post-finalización de curso (30 días configurables)
--
-- Cuando un alumno TERMINA un curso (se emite su certificado — sea por la
-- emisión automática al cumplir condiciones, o porque gerencia adjunta el cert
-- y cierra el trámite: ambas crean una fila en `certificados`), su matrícula
-- pasa a 'completada' y conserva acceso por N días (cursos.dias_acceso_post,
-- default 30) para repasar contenido asincrónico / descargar material. Pasada
-- la ventana, un cron diario la marca 'vencida' y deja de verla en su campus.
--
-- Decisiones (Pablo, 2026-06-14):
--   · Ventana configurable por curso, default 30.
--   · El alumno que NO termina queda 'activa' indefinidamente (el reloj arranca
--     SOLO al finalizar). NO se toca vigencia_hasta para activas.
--   · Al vencer: estado='vencida' (registro + certificado se conservan; oculto).
--   · Sin email (solo leyenda en el card — frontend).
--
-- ZONA HORARIA: todos los límites de la ventana se calculan en
-- America/Argentina/Buenos_Aires (convención del repo — ver 0039/0054), NO en
-- UTC. Así la ventana vence a medianoche local y no a las 21:00 hora Argentina.
-- El frontend (diasAccesoRestantes) y la edge fn zoom-sdk-signature usan la
-- misma zona para mantener el espejo exacto.
--
-- No se hace backfill de matrículas viejas: las que ya tienen cert pero siguen
-- 'activa' quedan 'activa' (acceso pleno) — no expiramos retroactivamente.
-- ============================================================================

-- 1) Ventana configurable por curso ------------------------------------------
ALTER TABLE public.cursos
  ADD COLUMN IF NOT EXISTS dias_acceso_post integer NOT NULL DEFAULT 30;
COMMENT ON COLUMN public.cursos.dias_acceso_post IS
  'DGG-82: días de acceso del alumno tras finalizar el curso (emisión del cert). Default 30.';

-- 2) Marca temporal de finalización en la matrícula --------------------------
ALTER TABLE public.curso_matriculas
  ADD COLUMN IF NOT EXISTS completada_at timestamptz;
COMMENT ON COLUMN public.curso_matriculas.completada_at IS
  'DGG-82: cuándo se finalizó el curso (se emitió el cert). vigencia_hasta = completada_at (hora AR)::date + cursos.dias_acceso_post.';

-- Índice parcial para el cron diario de vencimiento (escanea sólo completadas).
CREATE INDEX IF NOT EXISTS idx_curso_matriculas_vigencia_completada
  ON public.curso_matriculas (vigencia_hasta)
  WHERE estado = 'completada';

-- 3) Trigger: cert emitido → matrícula completada + ventana de acceso --------
-- (Trigger SEPARADO del que cierra el trámite — 0181 — para no entrelazar
--  responsabilidades. AFTER INSERT en certificados, igual que aquél.)
CREATE OR REPLACE FUNCTION public.trg_certificado_marca_completada_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_dias int;
BEGIN
  -- Ventana del curso (vía la matrícula). Si el cert no es de un curso
  -- (matricula_id NULL — p.ej. cert de webinar — o sin fila), no hace nada.
  SELECT c.dias_acceso_post INTO v_dias
    FROM public.curso_matriculas m
    JOIN public.cursos c ON c.id = m.curso_id
   WHERE m.id = NEW.matricula_id;

  IF v_dias IS NULL THEN
    RETURN NEW; -- no es una matrícula de curso (o no existe): nada que hacer
  END IF;

  UPDATE public.curso_matriculas
     SET estado = CASE WHEN estado = 'anulada' THEN estado ELSE 'completada' END,
         completada_at = COALESCE(completada_at, now()),
         -- ventana desde la PRIMERA finalización (re-emitir no reinicia el reloj),
         -- en fecha local Argentina.
         vigencia_hasta = (
           (COALESCE(completada_at, now())
             AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + v_dias
         ),
         updated_at = now()
   WHERE id = NEW.matricula_id
     AND estado <> 'anulada';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_certificado_marca_completada ON public.certificados;
CREATE TRIGGER trg_certificado_marca_completada
  AFTER INSERT ON public.certificados
  FOR EACH ROW EXECUTE FUNCTION public.trg_certificado_marca_completada_fn();

REVOKE ALL ON FUNCTION public.trg_certificado_marca_completada_fn() FROM PUBLIC, anon, authenticated;

-- 4) Gating: acceso = activa O (completada dentro de la ventana) -------------
-- Una completada vencida (vigencia_hasta < hoy AR) o 'vencida' pierde el acceso.
-- NULL vigencia_hasta en completada = grandfather (matrículas previas al feature).
CREATE OR REPLACE FUNCTION private.curso_matriculado(p_curso_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.curso_matriculas
     WHERE curso_id = p_curso_id
       AND profile_id = auth.uid()
       AND (
         estado = 'activa'
         OR (estado = 'completada'
             AND (vigencia_hasta IS NULL
                  OR vigencia_hasta >= (now()
                       AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))
       )
  );
$$;

-- 5) Cron diario: auto-desvinculación (completada vencida → vencida) ----------
-- 04:17 UTC = 01:17 AR (ya pasada la medianoche local).
SELECT cron.unschedule('gg-campus-matriculas-vencer')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gg-campus-matriculas-vencer');

SELECT cron.schedule(
  'gg-campus-matriculas-vencer',
  '17 4 * * *',
  $cron$
    UPDATE public.curso_matriculas
       SET estado = 'vencida', updated_at = now()
     WHERE estado = 'completada'
       AND vigencia_hasta IS NOT NULL
       AND vigencia_hasta < (now()
             AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
  $cron$
);

-- ----------------------------------------------------------------------------
-- SMOKE e2e (R18) — corrido vía MCP con BEGIN/ROLLBACK (DO + RAISE EXCEPTION).
-- Verificado 2026-06-14: cert INSERT → estado='completada', completada_at set,
-- vigencia_hasta = hoy(AR)+dias; gate activa/completada-en-ventana = TRUE,
-- completada-vencida = FALSE; cron completada-vencida → 'vencida'; re-emisión
-- (DELETE+INSERT, bloqueada de hecho por uq_certificado_matricula) conserva
-- completada_at. Residuo 0.
-- ----------------------------------------------------------------------------
