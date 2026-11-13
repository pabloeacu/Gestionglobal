-- 0687 · DGG-249 chunk 3/3 (apoyo) · RPC de listado de obligaciones de egreso para la UI.
-- R4 (no supabase.from en componentes) + R19 (universo completo, filtros en memoria):
-- devuelve TODAS las obligaciones activas (y anuladas opcionalmente) con los campos
-- derivados que la UI necesita; el front filtra tabs (pendiente/parcial/pagado) en memoria.
-- 'vencido' es DERIVADO (saldo>0 AND vencimiento<hoy), nunca almacenado.

CREATE OR REPLACE FUNCTION public.listar_egresos(
  p_incluir_anulados boolean DEFAULT false,
  p_desde date DEFAULT NULL,
  p_hasta date DEFAULT NULL)
 RETURNS TABLE(
   id uuid, fecha date, vencimiento date, proveedor_nombre text, concepto text,
   total numeric, saldo_pendiente numeric, estado_pago text, estado text,
   vencido boolean, categoria_id uuid, categoria_nombre text,
   partner_id_atribucion uuid, partner_nombre text,
   administracion_id uuid, admin_nombre text, curso_id uuid, tramite_id uuid,
   observaciones text, created_at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT e.id, e.fecha, e.vencimiento, e.proveedor_nombre, e.concepto,
      e.total, e.saldo_pendiente, e.estado_pago, e.estado,
      (e.estado='activo' AND e.saldo_pendiente > 0 AND e.vencimiento IS NOT NULL AND e.vencimiento < CURRENT_DATE) AS vencido,
      e.categoria_id, cf.nombre AS categoria_nombre,
      e.partner_id_atribucion, pt.nombre_legal AS partner_nombre,
      e.administracion_id, a.nombre AS admin_nombre, e.curso_id, e.tramite_id,
      e.observaciones, e.created_at
    FROM public.egresos e
    LEFT JOIN public.categorias_finanzas cf ON cf.id = e.categoria_id
    LEFT JOIN public.partners pt ON pt.id = e.partner_id_atribucion
    LEFT JOIN public.administraciones a ON a.id = e.administracion_id
    WHERE (p_incluir_anulados OR e.estado = 'activo')
      AND (p_desde IS NULL OR e.fecha >= p_desde)
      AND (p_hasta IS NULL OR e.fecha <= p_hasta)
    ORDER BY (e.saldo_pendiente > 0) DESC, e.vencimiento ASC NULLS LAST, e.fecha DESC;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.listar_egresos(boolean, date, date) TO authenticated;
