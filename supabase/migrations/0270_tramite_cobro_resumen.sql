-- DGG-95: resumen de cobro de un trámite para el diálogo de cancelación
-- (¿tiene comprobante? ¿cuánto se pagó y quedaría como saldo a favor? ¿hay CAE fiscal?).
CREATE OR REPLACE FUNCTION public.tramite_cobro_resumen(p_tramite_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operación' USING ERRCODE='42501';
  END IF;
  WITH comps AS (
    SELECT c.id, c.cae, c.total, c.saldo_pendiente
      FROM public.comprobantes c
      JOIN public.tramites t ON t.id = p_tramite_id
     WHERE c.estado <> 'anulado'
       AND ( c.id = t.comprobante_id
             OR c.id IN (SELECT s.comprobante_id FROM public.solicitudes s
                          WHERE s.tramite_id = p_tramite_id AND s.comprobante_id IS NOT NULL) )
  )
  SELECT jsonb_build_object(
    'tiene_comprobante', EXISTS(SELECT 1 FROM comps),
    'tiene_anulable',    EXISTS(SELECT 1 FROM comps WHERE cae IS NULL),
    'tiene_cae',         EXISTS(SELECT 1 FROM comps WHERE cae IS NOT NULL),
    'pagado_anulable',   COALESCE((SELECT sum(GREATEST(0, COALESCE(total,0) - COALESCE(saldo_pendiente,0))) FROM comps WHERE cae IS NULL), 0),
    'saldo_pendiente',   COALESCE((SELECT sum(saldo_pendiente) FROM comps), 0)
  ) INTO v_out;
  RETURN v_out;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.tramite_cobro_resumen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tramite_cobro_resumen(uuid) TO authenticated;
