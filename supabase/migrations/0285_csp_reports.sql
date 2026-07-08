-- 0285 · E-GG-88 Etapa 2 (CSP report-only → medir → enforce): tabla donde la
-- edge fn `csp-report` acumula las violaciones de la Content-Security-Policy
-- reportadas por los browsers, para MEDIR qué rompería una CSP bloqueante antes
-- de activarla (Etapa 3). Dedup por (directiva, uri bloqueada) con contador de
-- hits para no inflar la tabla.
--
-- La escribe la edge fn con service_role (bypassa RLS). La lee sólo staff.
-- Sin grant a anon (consistente con el blindaje 0283/0284). R6: GRANT explícito.

CREATE TABLE IF NOT EXISTS public.csp_reports (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  violated_directive   text NOT NULL,
  effective_directive  text,
  blocked_uri          text NOT NULL DEFAULT '',
  document_uri         text,
  source_file          text,
  line_number          int,
  status_code          int,
  disposition          text,
  hits                 int NOT NULL DEFAULT 1,
  first_seen           timestamptz NOT NULL DEFAULT now(),
  last_seen            timestamptz NOT NULL DEFAULT now(),
  sample               jsonb
);

-- Dedup: una fila por (directiva violada, uri bloqueada) → la edge fn hace
-- ON CONFLICT incrementando hits + last_seen.
CREATE UNIQUE INDEX IF NOT EXISTS uq_csp_reports_dedup
  ON public.csp_reports (violated_directive, blocked_uri);
CREATE INDEX IF NOT EXISTS idx_csp_reports_last_seen
  ON public.csp_reports (last_seen DESC);

ALTER TABLE public.csp_reports ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.csp_reports TO authenticated;
-- (anon NO: los reportes los inserta la edge fn con service_role.)

-- Sólo staff lee las violaciones (regla 2 / 12). service_role bypassa RLS.
DROP POLICY IF EXISTS csp_reports_staff_select ON public.csp_reports;
CREATE POLICY csp_reports_staff_select ON public.csp_reports
  FOR SELECT TO authenticated
  USING (private.is_staff());

COMMENT ON TABLE public.csp_reports IS
  'E-GG-88 Etapa 2: violaciones de CSP (report-only) acumuladas por la edge fn csp-report para medir antes de enforce. Transitoria: se puede vaciar/dropear tras activar la CSP bloqueante.';

-- Upsert con incremento de hits (la edge fn csp-report la llama con service_role).
-- SECURITY DEFINER + search_path fijo (R5). Sólo service_role la ejecuta.
CREATE OR REPLACE FUNCTION public.csp_report_registrar(
  p_violated text, p_effective text, p_blocked text, p_document text,
  p_source text, p_line int, p_status int, p_disposition text, p_sample jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_updated int;
BEGIN
  IF COALESCE(p_violated, '') = '' THEN
    RETURN;  -- reporte inválido, se ignora
  END IF;
  -- Incrementar si la combinación ya existe (barato, siempre permitido).
  UPDATE public.csp_reports
     SET hits = hits + 1, last_seen = now()
   WHERE violated_directive = LEFT(p_violated, 200)
     AND blocked_uri = LEFT(COALESCE(p_blocked, ''), 500);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated > 0 THEN RETURN; END IF;
  -- Combinación nueva: sólo insertar si estamos bajo el cap (anti-bloat: el
  -- endpoint es público sin auth). Es tabla de medición transitoria.
  IF (SELECT count(*) FROM public.csp_reports) >= 5000 THEN
    RETURN;
  END IF;
  INSERT INTO public.csp_reports (
    violated_directive, effective_directive, blocked_uri, document_uri,
    source_file, line_number, status_code, disposition, sample
  ) VALUES (
    LEFT(p_violated, 200), LEFT(p_effective, 200), LEFT(COALESCE(p_blocked, ''), 500),
    LEFT(p_document, 500), LEFT(p_source, 500), p_line, p_status, LEFT(p_disposition, 40), p_sample
  )
  ON CONFLICT (violated_directive, blocked_uri)
  DO UPDATE SET hits = public.csp_reports.hits + 1, last_seen = now();
END;
$$;

REVOKE ALL ON FUNCTION public.csp_report_registrar(text,text,text,text,text,int,int,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.csp_report_registrar(text,text,text,text,text,int,int,text,jsonb) TO service_role;
