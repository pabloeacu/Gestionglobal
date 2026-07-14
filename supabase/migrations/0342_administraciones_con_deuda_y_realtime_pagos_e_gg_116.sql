-- 0342 · E-GG-116 (doc JL wave 6):
--  · P7-A: etiqueta "Con Deuda" en clientes/trámites con saldo pendiente. RPC
--    batched que devuelve los administracion_id con deuda NETA>0, reusando EXACTO
--    el cálculo de cuenta_corriente_morosos (deuda_bruta − créditos no imputados)
--    para que "Con Deuda" signifique lo MISMO que la Cta.Cte/ficha (consistencia
--    contable: no marcar deuda a quien tiene saldo a favor que compensa).
--  · P5-A (realtime): pagos_reportados no estaba en la publicación → el widget de
--    pagos informados y PagosInformadosPage no refrescaban "en vivo". Se agrega.

-- ── P7-A: administraciones con deuda neta (staff-only, batched) ────────────────
CREATE OR REPLACE FUNCTION public.administraciones_con_deuda()
 RETURNS SETOF uuid
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN RETURN; END IF;
  RETURN QUERY
  WITH deudas AS (
    SELECT c.administracion_id AS id, COALESCE(SUM(c.saldo_pendiente),0) AS deuda_bruta
    FROM public.comprobantes c
    WHERE c.administracion_id IS NOT NULL
      AND c.estado NOT IN ('anulado','borrador') AND c.saldo_pendiente > 0
    GROUP BY c.administracion_id
  ),
  creditos AS (
    SELECT m.administracion_id AS aid, SUM(m.monto - COALESCE(imp.aplicado,0)) AS credito
    FROM public.movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado FROM public.movimiento_imputaciones mi
       WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
    ) imp ON true
    WHERE m.administracion_id IS NOT NULL AND m.tipo='ingreso'
      AND m.estado='identificado' AND m.revertido_at IS NULL
      AND (m.monto - COALESCE(imp.aplicado,0)) > 0.001
    GROUP BY m.administracion_id
  )
  SELECT d.id
  FROM deudas d LEFT JOIN creditos cr ON cr.aid = d.id
  WHERE (d.deuda_bruta - COALESCE(cr.credito,0)) > 0;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.administraciones_con_deuda() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.administraciones_con_deuda() TO authenticated, service_role;

-- ── P5-A: pagos_reportados a la publicación realtime (respeta la RLS SELECT) ───
DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='pagos_reportados'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pagos_reportados;
  END IF;
END $mig$;
