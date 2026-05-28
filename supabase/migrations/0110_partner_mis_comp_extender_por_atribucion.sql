-- ============================================================================
-- Migration: 0110_partner_mis_comp_extender_por_atribucion
-- Fecha: 2026-05-28
-- DGG-XX · Walkthrough · partner ve comprobantes por atribución de cobranza.
-- Hasta ahora la visibilidad era SÓLO por emisor_id (partners con emisor
-- propio). Ampliamos para que también vean comprobantes en los que su
-- partner_id_atribucion aparece en algún movimiento de cobranza. Esto
-- soporta el caso común: partner sin emisor propio pero que participa de
-- la facturación con un % de convenio.
-- ============================================================================

-- RPC partner_mis_comprobantes ----------------------------------------------

DROP FUNCTION IF EXISTS public.partner_mis_comprobantes();

CREATE FUNCTION public.partner_mis_comprobantes()
RETURNS TABLE (
  id uuid, tipo text, numero integer, punto_venta integer,
  fecha date, vencimiento date, total numeric,
  estado text, estado_cobranza text, emitido_arca boolean,
  receptor_razon_social text,
  partner_facturado_at timestamptz,
  partner_numero_externo text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH yo AS (
    SELECT pr.partner_id, pa.emisor_id
      FROM public.profiles pr
      JOIN public.partners pa ON pa.id = pr.partner_id
     WHERE pr.id = auth.uid() AND pr.role = 'partner'
  )
  SELECT DISTINCT
         c.id, c.tipo, c.numero, c.punto_venta, c.fecha, c.vencimiento,
         c.total, c.estado, c.estado_cobranza, c.emitido_arca,
         c.receptor_razon_social,
         c.partner_facturado_at, c.partner_numero_externo
    FROM public.comprobantes c
    CROSS JOIN yo
    WHERE (
      yo.emisor_id IS NOT NULL AND c.emisor_id = yo.emisor_id
    ) OR (
      EXISTS (
        SELECT 1
          FROM public.movimiento_imputaciones mi
          JOIN public.movimientos m ON m.id = mi.movimiento_id
         WHERE mi.comprobante_id = c.id
           AND m.partner_id_atribucion = yo.partner_id
      )
    )
   ORDER BY c.fecha DESC, c.numero DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.partner_mis_comprobantes() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.partner_mis_comprobantes() TO authenticated;

-- Policy RLS extendida -----------------------------------------------------

DROP POLICY IF EXISTS comprobantes_partner_select ON public.comprobantes;
CREATE POLICY comprobantes_partner_select ON public.comprobantes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles pr
       WHERE pr.id = auth.uid() AND pr.role = 'partner'
         AND (
           EXISTS (
             SELECT 1 FROM public.partners pa
              WHERE pa.id = pr.partner_id
                AND pa.emisor_id = comprobantes.emisor_id
           )
           OR
           EXISTS (
             SELECT 1 FROM public.movimiento_imputaciones mi
               JOIN public.movimientos m ON m.id = mi.movimiento_id
              WHERE mi.comprobante_id = comprobantes.id
                AND m.partner_id_atribucion = pr.partner_id
           )
         )
    )
  );
