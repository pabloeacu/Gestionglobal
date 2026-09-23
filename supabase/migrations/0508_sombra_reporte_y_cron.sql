-- 0508 · Agenda · reporte del modo sombra + registro del cron (DGG-199).
-- RPC de reporte (staff-only) que resume el log de `ofrecimientos_sombra`, y el cron diario
-- que corre el motor sombra (registrado acá para que un replay lo re-agende).

CREATE OR REPLACE FUNCTION public.gg_ofrecimientos_sombra_reporte()
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE r jsonb;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff.' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'ventana_desde', min(corrida_fecha),
    'ventana_hasta', max(corrida_fecha),
    'dias_corridos', count(DISTINCT corrida_fecha),
    'clientes_unicos', count(DISTINCT administracion_id) FILTER (WHERE codigo <> 'caba_venc'),
    'toques_totales', count(*) FILTER (WHERE codigo <> 'caba_venc'),
    'sin_email', count(*) FILTER (WHERE codigo <> 'caba_venc' AND email IS NULL),
    'por_regla', (SELECT jsonb_object_agg(codigo, n)
                  FROM (SELECT codigo, count(*) n FROM public.ofrecimientos_sombra
                        WHERE codigo <> 'caba_venc' GROUP BY codigo) x),
    'por_dia', (SELECT jsonb_agg(jsonb_build_object('fecha', d, 'toques', n) ORDER BY d)
                FROM (SELECT corrida_fecha d, count(*) n FROM public.ofrecimientos_sombra
                      WHERE codigo <> 'caba_venc' GROUP BY corrida_fecha) y),
    'caba_seed_intencion', count(*) FILTER (WHERE codigo = 'caba_venc'),
    'generado_at', now()
  ) INTO r FROM public.ofrecimientos_sombra;
  RETURN COALESCE(r, jsonb_build_object('toques_totales', 0));
END $fn$;
REVOKE ALL ON FUNCTION public.gg_ofrecimientos_sombra_reporte() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gg_ofrecimientos_sombra_reporte() TO authenticated;

-- cron diario del motor sombra (09:00 AR = 12:00 UTC). Idempotente por jobname (pg_cron upsert).
SELECT cron.schedule('gg-ofrecimientos-sombra', '0 12 * * *', 'SELECT public.gg_ofrecimientos_diario_sombra();');
