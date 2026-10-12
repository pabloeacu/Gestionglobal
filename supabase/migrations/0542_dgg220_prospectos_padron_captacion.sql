-- 0542_dgg220_prospectos_padron_captacion.sql
-- =============================================================================
-- DGG-220 · Fase 1a — Extender el subsistema de `prospectos` (hoy leads de webinars)
-- a un CRM de captación sobre el padrón PBA, SIN romper el flujo existente.
--
-- Decisiones (Pablo): un prospecto por email (dedup); sancionados incluidos con flag;
-- la matrícula sale del padrón (col A), TRAMIX sólo aporta la última renovación → vencimiento.
--
-- Aditivo: se agregan columnas a `prospectos` (nullable / con default) y una tabla hija
-- `prospecto_padron` (una fila por matriculado detrás de un email — maneja casillas
-- compartidas por estudios/familias). El padre deriva su vencimiento = min(hijos).
-- =============================================================================

-- ---- prospectos: campos de captación / CRM ----
ALTER TABLE public.prospectos
  ADD COLUMN IF NOT EXISTS cuit text,
  ADD COLUMN IF NOT EXISTS matricula text,
  ADD COLUMN IF NOT EXISTS legajo text,
  ADD COLUMN IF NOT EXISTS matricula_vencimiento date,   -- = min(prospecto_padron.vencimiento) (más urgente)
  ADD COLUMN IF NOT EXISTS ultima_renovacion date,
  ADD COLUMN IF NOT EXISTS sanciones boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS estado_captacion text NOT NULL DEFAULT 'nuevo',  -- nuevo/contactado/interesado/no_interesado (manual); convertido/baja se derivan de los timestamps
  ADD COLUMN IF NOT EXISTS baja_at timestamptz,          -- opt-out (Fase 2)
  ADD COLUMN IF NOT EXISTS ultimo_mail_slug text,
  ADD COLUMN IF NOT EXISTS ultimo_mail_asunto text,
  ADD COLUMN IF NOT EXISTS ultimo_mail_at timestamptz;

COMMENT ON COLUMN public.prospectos.matricula_vencimiento IS 'DGG-220: vencimiento más urgente (min) de los matriculados de este email; base del segmento de campaña. El segmento se deriva en memoria/consulta (vencimiento - hoy), no se persiste (cambia cada día).';

-- índices para match de clientes + segmentación por vencimiento
CREATE INDEX IF NOT EXISTS idx_prospectos_cuit ON public.prospectos(cuit) WHERE cuit IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospectos_legajo ON public.prospectos(legajo) WHERE legajo IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospectos_vencimiento ON public.prospectos(matricula_vencimiento) WHERE matricula_vencimiento IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospectos_origen ON public.prospectos(origen);

-- ---- prospecto_padron: una fila por matriculado (persona) detrás de un email ----
CREATE TABLE IF NOT EXISTS public.prospecto_padron (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospecto_id uuid NOT NULL REFERENCES public.prospectos(id) ON DELETE CASCADE,
  matricula text,
  legajo text,
  cuit text,
  nombre text NOT NULL,
  sanciones boolean NOT NULL DEFAULT false,
  -- enriquecimiento TRAMIX (Fase 1c)
  ultima_renovacion date,
  vencimiento date,
  tramix_estado text NOT NULL DEFAULT 'pendiente',  -- pendiente/ok/flag/error/sin_legajo
  tramix_flag text,
  tramix_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.prospecto_padron ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prospecto_padron TO authenticated;  -- R6

DROP POLICY IF EXISTS prospecto_padron_staff_all ON public.prospecto_padron;
CREATE POLICY prospecto_padron_staff_all ON public.prospecto_padron
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

CREATE INDEX IF NOT EXISTS idx_prospecto_padron_prospecto ON public.prospecto_padron(prospecto_id);  -- R11 (FK)
CREATE INDEX IF NOT EXISTS idx_prospecto_padron_legajo ON public.prospecto_padron(legajo) WHERE legajo IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospecto_padron_tramix ON public.prospecto_padron(tramix_estado);

-- unicidad defensiva: no duplicar un mismo legajo bajo el mismo prospecto
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospecto_padron_legajo ON public.prospecto_padron(prospecto_id, legajo) WHERE legajo IS NOT NULL;
