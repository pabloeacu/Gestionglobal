-- 0317 · Decisión Pablo · anular un comprobante NO se bloquea, pero se ofrece el
-- "paquete de blindaje contable" en el modal. El RPC ahora, además de borrar
-- imputaciones + marcar anulado, auto-corrige lo INEQUÍVOCO: cancela jobs ARCA
-- pendientes (no estampar CAE a un anulado) y cancela avisos de recupero
-- pendientes. El impacto sobre partners se REPORTA en anular_comprobante_preview
-- para que el modal lo muestre (borrador se regenera; pagada requiere ajuste
-- manual — el partner ya cobró). Misma firma → R16.
CREATE OR REPLACE FUNCTION public.anular_comprobante(p_comprobante_id uuid, p_motivo text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_comp public.comprobantes%ROWTYPE;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo gerencia/operación puede anular comprobantes'; END IF;
  SELECT * INTO v_comp FROM public.comprobantes WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comprobante no encontrado'; END IF;
  IF v_comp.estado = 'anulado' THEN RAISE EXCEPTION 'El comprobante ya está anulado'; END IF;
  IF v_comp.cae IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede anular un comprobante con CAE (%). Emití una nota de crédito.', v_comp.cae;
  END IF;
  DELETE FROM public.movimiento_imputaciones WHERE comprobante_id = p_comprobante_id;
  UPDATE public.comprobantes SET
    estado='anulado', estado_cobranza='anulado', saldo_pendiente=0,
    motivo_rechazo = COALESCE(NULLIF(trim(p_motivo), ''), 'Anulación manual')
  WHERE id = p_comprobante_id;
  UPDATE public.arca_emision_queue SET status='cancelled', updated_at=now()
   WHERE comprobante_id = p_comprobante_id AND status IN ('pending','sending');
  UPDATE public.email_queue SET status='cancelled', ultimo_error='Comprobante anulado'
   WHERE status IN ('pending','scheduled')
     AND id IN (SELECT email_queue_id FROM public.recupero_acciones
                 WHERE comprobante_id = p_comprobante_id AND email_queue_id IS NOT NULL);
  RETURN p_comprobante_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.anular_comprobante_preview(p_comprobante_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_comp public.comprobantes%ROWTYPE;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo staff'; END IF;
  SELECT * INTO v_comp FROM public.comprobantes WHERE id = p_comprobante_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comprobante no encontrado'; END IF;
  RETURN jsonb_build_object(
    'tiene_cae', (v_comp.cae IS NOT NULL),
    'cobrado_a_credito', GREATEST(COALESCE(v_comp.total,0) - COALESCE(v_comp.saldo_pendiente,0), 0),
    'arca_pendientes', (SELECT count(*) FROM public.arca_emision_queue
       WHERE comprobante_id=p_comprobante_id AND status IN ('pending','sending')),
    'recupero_pendientes', (SELECT count(*) FROM public.email_queue eq
       JOIN public.recupero_acciones ra ON ra.email_queue_id=eq.id
       WHERE ra.comprobante_id=p_comprobante_id AND eq.status IN ('pending','scheduled')),
    'partner_borrador', (SELECT jsonb_build_object('count',count(*),'monto',COALESCE(SUM(pa.monto_atribuido),0))
       FROM public.partner_atribuciones pa JOIN public.partner_rendiciones pr ON pr.id=pa.rendicion_id
       WHERE pa.comprobante_id=p_comprobante_id AND pr.estado='borrador'),
    'partner_pagada', (SELECT jsonb_build_object('count',count(*),'monto',COALESCE(SUM(pa.monto_atribuido),0))
       FROM public.partner_atribuciones pa JOIN public.partner_rendiciones pr ON pr.id=pa.rendicion_id
       WHERE pa.comprobante_id=p_comprobante_id AND pr.estado IN ('pagada','cerrada'))
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.anular_comprobante_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anular_comprobante_preview(uuid) TO authenticated;
