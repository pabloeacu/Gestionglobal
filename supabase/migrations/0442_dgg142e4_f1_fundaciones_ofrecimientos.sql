-- 0442_dgg142e4_f1_fundaciones_ofrecimientos.sql
-- DGG-142 · Etapa 4 · F1 — Fundaciones del motor de ofrecimientos (matriz
-- DGG-143). Cuatro piezas:
--   (1) `ofrecimientos_log`: registro de toques con UNIQUE por
--       (administracion, codigo, ciclo_ancla, canal) → idempotencia dura:
--       "aviso X a admin Y en la ventana Z, UNA sola vez por canal" aunque el
--       cron corra dos veces. El dedupe es por ancla determinista de ciclo,
--       NUNCA por "now() - N días" del envío (drift).
--   (2) `administraciones.ofrecimientos_habilitados` (default ON — decisión E
--       de Pablo): switch por cliente, editable en la ficha (R14 en F5).
--   (3) `cursos.jurisdiccion` ('pba'|'caba') + seed: mata la fragilidad de
--       los slugs con año (`actualizacion2026-rpac`) — misma clase de bug que
--       el §6 de DGG-143 eliminó con servicios.codigo vs nombre ILIKE.
--   (4) Helpers `private.gg_admin_*`: predicados de elegibilidad
--       centralizados (universo RPAC / hizo curso CABA / SOLO-CABA) para que
--       motor, banners y KPIs usen EXACTAMENTE la misma definición.

-- (1) ------------------------------------------------------------------
CREATE TABLE public.ofrecimientos_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  administracion_id uuid NOT NULL REFERENCES public.administraciones(id) ON DELETE CASCADE,
  codigo text NOT NULL,                -- certificado_90 | cj_120 | curso_actualizacion_60 | ddjj_ciclo | capacitacion_oneshot | ...
  ciclo_ancla date NOT NULL,           -- ancla determinista de la ventana (ver motor F4)
  canal text NOT NULL CHECK (canal IN ('banner','push','email')),
  template_slug text,
  resultado text NOT NULL DEFAULT 'ok' CHECK (resultado IN ('ok','skipped','error')),
  detalle text,
  enviado_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ofrecimientos_log ENABLE ROW LEVEL SECURITY;
-- Regla 6 (post mig 0130): GRANT explícito. Sólo lectura para el staff; la
-- escritura es EXCLUSIVA del motor SECURITY DEFINER (R17: tabla RLS con
-- policy sólo-SELECT → todo escritor debe ser SECURITY DEFINER).
GRANT SELECT ON public.ofrecimientos_log TO authenticated;
CREATE POLICY ofrecimientos_log_select_staff ON public.ofrecimientos_log
  FOR SELECT TO authenticated USING (private.is_staff());

CREATE UNIQUE INDEX uq_ofrecimientos_toque
  ON public.ofrecimientos_log (administracion_id, codigo, ciclo_ancla, canal);
CREATE INDEX idx_ofrecimientos_admin ON public.ofrecimientos_log (administracion_id);
CREATE INDEX idx_ofrecimientos_codigo_fecha ON public.ofrecimientos_log (codigo, enviado_at DESC);

COMMENT ON TABLE public.ofrecimientos_log IS
  'DGG-142 E4 · Toques del motor de ofrecimientos (matriz DGG-143). UNIQUE (admin, codigo, ciclo_ancla, canal) = idempotencia por ventana.';

-- (2) ------------------------------------------------------------------
ALTER TABLE public.administraciones
  ADD COLUMN IF NOT EXISTS ofrecimientos_habilitados boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.administraciones.ofrecimientos_habilitados IS
  'DGG-143 (decisión E: prendido por defecto). OFF = el motor de ofrecimientos no le manda banner/push/email a este cliente.';

-- (3) ------------------------------------------------------------------
ALTER TABLE public.cursos
  ADD COLUMN IF NOT EXISTS jurisdiccion text CHECK (jurisdiccion IN ('pba','caba'));
COMMENT ON COLUMN public.cursos.jurisdiccion IS
  'DGG-142 E4 · Jurisdicción del curso para predicados de elegibilidad (los slugs llevan año y no sirven como identidad estable).';

UPDATE public.cursos SET jurisdiccion = 'caba' WHERE slug = 'curso-actualizacion-2026-rpa-caba' AND jurisdiccion IS NULL;
UPDATE public.cursos SET jurisdiccion = 'pba'
 WHERE slug IN ('formacion-inicial-administradores','formacion-inicial-administradores-copia','actualizacion2026-rpac')
   AND jurisdiccion IS NULL;

-- (4) ------------------------------------------------------------------
-- Universo "cliente RPAC": tiene matrícula asentada (número o vencimiento en
-- ficha) o un trámite de inscripción/renovación cerrado. Amplía el
-- v_matriculado del dashboard (0440) con el vencimiento y la renovación.
CREATE OR REPLACE FUNCTION private.gg_admin_es_rpac(p_admin uuid)
RETURNS boolean LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.administraciones a
    WHERE a.id = p_admin
      AND (a.matricula_rpac IS NOT NULL OR a.matricula_rpac_vencimiento IS NOT NULL)
  ) OR EXISTS (
    SELECT 1 FROM public.tramites t
    JOIN public.servicios s ON s.id = t.servicio_id
    WHERE t.administracion_id = p_admin AND t.estado = 'cerrado'
      AND s.codigo IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion')
  );
$$;

CREATE OR REPLACE FUNCTION private.gg_admin_hizo_curso_caba(p_admin uuid)
RETURNS boolean LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.curso_matriculas cm
    JOIN public.cursos c ON c.id = cm.curso_id
    LEFT JOIN public.profiles p ON p.id = cm.profile_id
    WHERE COALESCE(cm.administracion_id, p.administracion_id) = p_admin
      AND cm.estado <> 'anulada'
      AND c.jurisdiccion = 'caba'
  ) OR EXISTS (
    SELECT 1 FROM public.tramites t
    JOIN public.servicios s ON s.id = t.servicio_id
    WHERE t.administracion_id = p_admin AND t.estado <> 'cancelado'
      AND s.codigo = 'rpa_actualizacion'
  );
$$;

-- SOLO-CABA (decisión F de Pablo): hizo el curso CABA y JAMÁS tocó el
-- circuito PBA (ni matrícula en ficha, ni trámites PBA, ni cursos PBA).
-- Sólo recibe: Consultoría Jurídica + Plataforma de gestión + Capacitación
-- gratuita.
CREATE OR REPLACE FUNCTION private.gg_admin_es_solo_caba(p_admin uuid)
RETURNS boolean LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT private.gg_admin_hizo_curso_caba(p_admin)
    AND NOT EXISTS (
      SELECT 1 FROM public.administraciones a
      WHERE a.id = p_admin
        AND (a.matricula_rpac IS NOT NULL OR a.matricula_rpac_vencimiento IS NOT NULL)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.tramites t
      JOIN public.servicios s ON s.id = t.servicio_id
      WHERE t.administracion_id = p_admin AND t.estado <> 'cancelado'
        AND s.codigo IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion',
                         'rpac_certificado','rpac_ddjj','curso_formacion_rpac','curso_actualizacion_rpac')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.curso_matriculas cm
      JOIN public.cursos c ON c.id = cm.curso_id
      LEFT JOIN public.profiles p ON p.id = cm.profile_id
      WHERE COALESCE(cm.administracion_id, p.administracion_id) = p_admin
        AND cm.estado <> 'anulada'
        AND c.jurisdiccion = 'pba'
    );
$$;
