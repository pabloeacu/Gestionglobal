-- 0697_dgg257_lexph_panel_suppression_aware.sql
-- =============================================================================
-- DGG-257 (cierre de la mitad DISPLAY de E-GG-281). El panel de Suscriptores
-- LexPH derivaba el estado de entregabilidad SÓLO de `lexph_suscriptores.estado`,
-- no de la supresión GLOBAL. Un suscriptor 'confirmado' cuyo email fue suprimido
-- por OTRA vía (baja en Captación, rebote, queja, descarte) se veía "Confirmado"
-- con botón "Dar de baja" aunque el newsletter NO le llega (envío fail-closed:
-- filtra `NOT EXISTS email_suppression`). El chip "mentía" (§6-e aviso↔display).
--
-- Fix de datos: RPC de SÓLO-LECTURA que, para los suscriptores LexPH cuyo email
-- está suprimido, devuelve {email_norm, motivo, es_hard}. El front la cruza en
-- memoria (R19) para pintar el badge "Suprimido" y ofrecer "Reactivar" en vez de
-- "Dar de baja". Scoped a LexPH (no todo el universo de supresión) y devuelta como
-- jsonb (no SETOF) → NO la corta db-max-rows ni el LIMIT 500 de email_suppression_list.
-- Reusa private.motivo_es_hard (mig 0696) para es_hard. Staff-gated (is_staff).
-- R5 (SECDEF + search_path) · R6 (REVOKE/GRANT) · R12 N/A (sin p_administracion_id).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.lexph_suscriptores_suprimidos()
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'email',   s.email_norm,
             'motivo',  sup.motivo,
             'es_hard', private.motivo_es_hard(sup.motivo)))
    FROM public.lexph_suscriptores s
    JOIN public.email_suppression sup ON lower(btrim(sup.email)) = s.email_norm
  ), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.lexph_suscriptores_suprimidos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lexph_suscriptores_suprimidos() TO authenticated;
