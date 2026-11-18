-- 0698_dgg257_lexph_confirmados_reciben.sql
-- =============================================================================
-- DGG-257 (cierre display E-GG-281, fan-out §6-a/e). La página de edición
-- (LexphEdicionPage) mostraba y confirmaba el envío del newsletter con el conteo
-- CRUDO de `confirmados` (getSuscriptoresStats), pero el envío real
-- (lexph_newsletter_enviar) descuenta los suprimidos → el estimado pre-envío
-- "mentía" (decía N, encolaba N - suprimidos). Mismo criterio que el panel.
--
-- RPC de conteo NETO (lo que realmente va a recibir): confirmados cuyo email NO
-- está suprimido por ninguna vía — exactamente el universo del INSERT del envío.
-- Staff-gated (WHERE is_staff() → 0 para no-staff, sin leak). R5/R6.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.lexph_confirmados_reciben()
 RETURNS integer
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT count(*)::int
  FROM public.lexph_suscriptores s
  WHERE private.is_staff()
    AND s.estado = 'confirmado'
    AND NOT EXISTS (
      SELECT 1 FROM public.email_suppression sup
      WHERE lower(btrim(sup.email)) = s.email_norm
    );
$fn$;
REVOKE ALL ON FUNCTION public.lexph_confirmados_reciben() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lexph_confirmados_reciben() TO authenticated;
