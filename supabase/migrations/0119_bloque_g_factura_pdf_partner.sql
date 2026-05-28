-- ============================================================================
-- Migration: 0119_bloque_g_factura_pdf_partner
-- Fecha: 2026-05-28
-- DGG-XX · Bloque G / obs 11 · Adjuntar PDF de factura del partner al
-- comprobante. El partner sube el PDF que generó en su ARCA (o emisor
-- externo) y el sistema lo asocia. Queda disponible para descarga del
-- cliente (via /portal), del partner (su panel) y de la gerencia.
-- ============================================================================

ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS partner_factura_pdf_url text;

CREATE OR REPLACE FUNCTION public.partner_marcar_facturado(
  p_comprobante_id uuid,
  p_numero_externo text,
  p_observacion    text DEFAULT NULL,
  p_pdf_url        text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_partner_id uuid;
  v_comp public.comprobantes%ROWTYPE;
  v_admin_nombre text;
  v_visible boolean;
BEGIN
  SELECT pr.role, pr.partner_id INTO v_role, v_partner_id
    FROM public.profiles pr WHERE pr.id = auth.uid();
  IF v_role <> 'partner' THEN
    RAISE EXCEPTION 'Solo usuarios partner pueden marcar facturado' USING ERRCODE = '42501';
  END IF;
  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Tu usuario no tiene partner asociado' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_comp FROM public.comprobantes WHERE id = p_comprobante_id FOR UPDATE;
  IF v_comp.id IS NULL THEN
    RAISE EXCEPTION 'Comprobante no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_comp.estado = 'anulado' THEN
    RAISE EXCEPTION 'No se puede facturar un comprobante anulado' USING ERRCODE = '22023';
  END IF;
  IF v_comp.partner_facturado_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este comprobante ya fue marcado como facturado' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(trim(p_numero_externo), '') = '' THEN
    RAISE EXCEPTION 'Ingresá el número de factura externa' USING ERRCODE = '22023';
  END IF;

  v_visible := EXISTS (
    SELECT 1 FROM public.partners pa
    WHERE pa.id = v_partner_id AND pa.emisor_id = v_comp.emisor_id
  ) OR EXISTS (
    SELECT 1 FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
    WHERE mi.comprobante_id = p_comprobante_id
      AND m.partner_id_atribucion = v_partner_id
  );
  IF NOT v_visible THEN
    RAISE EXCEPTION 'Este comprobante no pertenece a tu partner'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.comprobantes
     SET partner_facturado_at = now(),
         partner_numero_externo = trim(p_numero_externo),
         partner_observacion = NULLIF(trim(COALESCE(p_observacion, '')), ''),
         partner_factura_pdf_url = NULLIF(trim(COALESCE(p_pdf_url, '')), '')
   WHERE id = p_comprobante_id;

  BEGIN
    SELECT a.nombre INTO v_admin_nombre
      FROM public.administraciones a WHERE a.id = v_comp.administracion_id;
    PERFORM private.notif_emitir_staff(
      'partner_facturo',
      'Partner facturó: ' || v_comp.tipo || ' · Nº ' || COALESCE(v_comp.numero::text, '—'),
      'Receptor: ' || v_comp.receptor_razon_social
        || ' · Total: $' || v_comp.total::text
        || ' · Nº externo: ' || trim(p_numero_externo)
        || CASE WHEN v_admin_nombre IS NOT NULL THEN ' · ' || v_admin_nombre ELSE '' END,
      '/gestion/facturacion/comprobantes/' || p_comprobante_id::text,
      jsonb_build_object(
        'comprobante_id', p_comprobante_id,
        'partner_id', v_partner_id,
        'numero_externo', trim(p_numero_externo),
        'pdf_url', NULLIF(trim(COALESCE(p_pdf_url, '')), '')
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN p_comprobante_id;
END;
$$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('partner-facturas', 'partner-facturas', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "partner_facturas_partner_upload" ON storage.objects;
CREATE POLICY "partner_facturas_partner_upload" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'partner-facturas'
  AND EXISTS (
    SELECT 1 FROM public.profiles pr
    WHERE pr.id = auth.uid() AND pr.role = 'partner'
  )
);

DROP POLICY IF EXISTS "partner_facturas_public_read" ON storage.objects;
CREATE POLICY "partner_facturas_public_read" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'partner-facturas');
