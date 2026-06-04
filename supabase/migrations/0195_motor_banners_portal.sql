-- ============================================================================
-- 0195 · DGG-45 · Motor de reglas de banners ("oportunidades") del portal
--
-- Pablo (2026-06-04): Estudio Save ya se matriculó (trámite "Inscripción al
-- RPAC" cerrado) pero seguía viendo "Matriculate como administrador". Causa:
-- el motor definía "matriculado" SÓLO como administraciones.matricula_rpac
-- IS NOT NULL, y gerencia nunca cargó el número.
--
-- Esta mig agrega la infra (tabla de tracking + RPCs); la mig 0196 reescribe
-- el bloque de oportunidades de cliente_portal_dashboard.
-- ============================================================================

-- ── 1. Tabla de tracking (recurrencia + posponer) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.cliente_oportunidad_eventos (
  administracion_id uuid NOT NULL REFERENCES public.administraciones(id) ON DELETE CASCADE,
  codigo            text NOT NULL,
  last_shown_at     timestamptz,
  snoozed_until     timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (administracion_id, codigo)
);

ALTER TABLE public.cliente_oportunidad_eventos ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cliente_oportunidad_eventos TO authenticated;

DROP POLICY IF EXISTS coe_select ON public.cliente_oportunidad_eventos;
CREATE POLICY coe_select ON public.cliente_oportunidad_eventos
  FOR SELECT TO authenticated
  USING (administracion_id = private.current_administracion_id() OR private.is_staff());

DROP POLICY IF EXISTS coe_write ON public.cliente_oportunidad_eventos;
CREATE POLICY coe_write ON public.cliente_oportunidad_eventos
  FOR ALL TO authenticated
  USING (administracion_id = private.current_administracion_id())
  WITH CHECK (administracion_id = private.current_administracion_id());

COMMENT ON TABLE public.cliente_oportunidad_eventos IS
  'DGG-45 · Tracking por (administración, código de banner) para recurrencia ("desde la última vez mostrado") y posponer (snooze) los banners promocionales del portal.';

-- ── 2. RPCs marcar mostrada / posponer ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cliente_oportunidad_marcar_mostrada(p_codigos text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := private.current_administracion_id();
  v_cod text;
BEGIN
  IF v_admin_id IS NULL OR p_codigos IS NULL THEN RETURN; END IF;
  FOREACH v_cod IN ARRAY p_codigos LOOP
    INSERT INTO public.cliente_oportunidad_eventos (administracion_id, codigo, last_shown_at, updated_at)
    VALUES (v_admin_id, v_cod, now(), now())
    ON CONFLICT (administracion_id, codigo)
    DO UPDATE SET last_shown_at = now(), updated_at = now();
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.cliente_oportunidad_posponer(p_codigo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := private.current_administracion_id();
BEGIN
  IF v_admin_id IS NULL OR p_codigo IS NULL THEN RETURN; END IF;
  INSERT INTO public.cliente_oportunidad_eventos (administracion_id, codigo, snoozed_until, updated_at)
  VALUES (v_admin_id, p_codigo, now() + interval '30 days', now())
  ON CONFLICT (administracion_id, codigo)
  DO UPDATE SET snoozed_until = now() + interval '30 days', updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cliente_oportunidad_marcar_mostrada(text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cliente_oportunidad_posponer(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_oportunidad_marcar_mostrada(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cliente_oportunidad_posponer(text) TO authenticated;
