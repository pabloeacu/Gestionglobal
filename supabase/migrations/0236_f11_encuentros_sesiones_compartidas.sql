-- ============================================================================
-- 0236_f11_encuentros_sesiones_compartidas.sql
-- F11 · Encuentros sincrónicos COMPARTIDOS entre cursos (DGG-79)
--
-- Contexto: Gestar (RPA-CABA · eaafb7af) y FUNDPLATA (RPAC-PBA · 488b58c3)
-- comparten encuentros sincrónicos: UNA sola sala Zoom, y el alumno que se
-- conecta tiene presente en TODOS sus cursos enganchados a esa sesión.
--
-- Modelo (DGG-79): "sesión compartida desacoplada".
--   · encuentro_sesiones_compartidas = LA sesión real (UNA sala Zoom, fecha,
--     duración, docente). Verdad única. Sin curso "dueño" (simétrico).
--   · curso_encuentros.sesion_compartida_id (nullable) = cada curso "engancha"
--     la sesión con SU fila, conservando su condicion_id (modalidad propia),
--     su curso_id y SUS asistencias. FK NULL = encuentro normal de hoy
--     (CERO cambio para lo existente → 100% retrocompatible).
--   · La asistencia sigue siendo por (encuentro_id, matricula_id) → el cómputo
--     de la condición (private.eval_asistencia_cumplida) y la emisión del
--     certificado siguen funcionando POR CURSO sin tocarse. El fan-out
--     (Fase 1) solo agrega una fila de asistencia por curso enganchado.
--
-- ¿Por qué no "dos encuentros espejo que se sincronizan"? Porque choca con el
-- índice UNIQUE de curso_encuentros.zoom_meeting_id (dos filas no pueden llevar
-- el mismo meeting), obliga a un curso dueño (asimétrico) y duplica la verdad.
--
-- Esta migración es ADITIVA: no modifica ninguna fila ni conducta existente.
-- El fan-out (Fase 1) y la sala centralizada (Fase 2) van en migs separadas.
-- ============================================================================

-- 1) Tabla de sesiones compartidas ------------------------------------------
CREATE TABLE IF NOT EXISTS public.encuentro_sesiones_compartidas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo        text NOT NULL,
  descripcion   text,
  fecha_hora    timestamptz,
  duracion_min  integer NOT NULL DEFAULT 60,

  -- Docente de la sesión (es UNA sesión real → un docente). Verdad central.
  docente_nombre   text,
  docente_foto_url text,
  docente_cv_url   text,

  -- Plataforma + sala única
  plataforma    text NOT NULL DEFAULT 'zoom'
                 CHECK (plataforma IN ('zoom','webex')),

  -- Zoom (la sala vive ACÁ para las sesiones compartidas)
  zoom_meeting_id    bigint,
  zoom_join_url      text,
  zoom_start_url     text,
  zoom_password      text,
  zoom_status        text NOT NULL DEFAULT 'programado'
                      CHECK (zoom_status IN ('programado','en_curso','finalizado','cancelado')),
  iniciado_at        timestamptz,
  finalizado_at      timestamptz,
  grabacion_url      text,
  grabacion_play_url text,

  -- Webex (paridad con curso_encuentros)
  webex_meeting_id     text,
  webex_join_url       text,
  webex_start_url      text,
  webex_password       text,
  webex_status         text,
  webex_meeting_number text,

  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.encuentro_sesiones_compartidas IS
  'F11/DGG-79: sesión sincrónica real compartida por 2+ cursos. UNA sala Zoom. Los cursos la enganchan vía curso_encuentros.sesion_compartida_id. Verdad única de fecha/sala/docente.';

-- meeting_id único (igual que en curso_encuentros): una sala = una sesión.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sesiones_compartidas_zoom_meeting_id
  ON public.encuentro_sesiones_compartidas(zoom_meeting_id)
  WHERE zoom_meeting_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sesiones_compartidas_webex_meeting_id
  ON public.encuentro_sesiones_compartidas(webex_meeting_id)
  WHERE webex_meeting_id IS NOT NULL;

-- updated_at automático (estándar del repo: public.touch_updated_at)
CREATE TRIGGER trg_sesiones_compartidas_touch
  BEFORE UPDATE ON public.encuentro_sesiones_compartidas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS (regla 2)
ALTER TABLE public.encuentro_sesiones_compartidas ENABLE ROW LEVEL SECURITY;

-- GRANTs explícitos (regla 6 — default post-0130). Campus auth-gated → solo authenticated.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.encuentro_sesiones_compartidas TO authenticated;

-- 2) Enganche por curso ------------------------------------------------------
ALTER TABLE public.curso_encuentros
  ADD COLUMN IF NOT EXISTS sesion_compartida_id uuid
    REFERENCES public.encuentro_sesiones_compartidas(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.curso_encuentros.sesion_compartida_id IS
  'F11/DGG-79: si NO es NULL, este encuentro es la participación de un curso en una sesión compartida (sala/fecha/docente derivadas de la sesión). NULL = encuentro standalone (conducta histórica).';

-- Índice de la FK (regla 11: Postgres no los crea solo)
CREATE INDEX IF NOT EXISTS idx_curso_encuentros_sesion_compartida
  ON public.curso_encuentros(sesion_compartida_id)
  WHERE sesion_compartida_id IS NOT NULL;

-- 3) Policies ----------------------------------------------------------------
-- SELECT: staff o un matriculado de CUALQUIER curso enganchado a la sesión
--   (necesita ver la sala/fecha para unirse). Espejo de curso_encuentros_select.
CREATE POLICY sesiones_compartidas_select
  ON public.encuentro_sesiones_compartidas FOR SELECT
  USING (
    private.is_staff()
    OR EXISTS (
      SELECT 1
        FROM public.curso_encuentros e
       WHERE e.sesion_compartida_id = encuentro_sesiones_compartidas.id
         AND private.curso_matriculado(e.curso_id)
    )
  );

-- CUD: solo staff (igual que curso_encuentros / curso_condiciones).
CREATE POLICY sesiones_compartidas_cud
  ON public.encuentro_sesiones_compartidas FOR ALL
  USING (private.is_staff())
  WITH CHECK (private.is_staff());
