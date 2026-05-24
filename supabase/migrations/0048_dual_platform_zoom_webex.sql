-- DGG-19: Dual platform support for synchronous encuentros.
-- Zoom: external link only (simplificada). Webex: embedded widget.
-- Asistencia tracking via webhooks de cada plataforma.

ALTER TABLE public.curso_encuentros
  ADD COLUMN IF NOT EXISTS plataforma text NOT NULL DEFAULT 'zoom'
    CHECK (plataforma IN ('zoom', 'webex')),
  ADD COLUMN IF NOT EXISTS webex_meeting_id text,
  ADD COLUMN IF NOT EXISTS webex_join_url text,
  ADD COLUMN IF NOT EXISTS webex_start_url text,
  ADD COLUMN IF NOT EXISTS webex_password text,
  ADD COLUMN IF NOT EXISTS webex_status text,
  ADD COLUMN IF NOT EXISTS webex_meeting_number text;

COMMENT ON COLUMN public.curso_encuentros.plataforma IS
  'Plataforma de la clase sincrónica. zoom = link externo (simplificada). webex = widget embebido.';

CREATE INDEX IF NOT EXISTS idx_curso_encuentros_webex_meeting_id
  ON public.curso_encuentros (webex_meeting_id)
  WHERE webex_meeting_id IS NOT NULL;
