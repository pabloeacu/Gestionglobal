-- ============================================================================
-- Migration: 0106_partner_marcar_facturado
-- Fecha: 2026-05-28
-- DGG-XX · #153: el partner registra en la plataforma que facturó el
-- comprobante asignado a su emisor. Mientras ARCA-Fundplata no esté
-- conectada, esto reemplaza al envío real: el partner marca el número de
-- factura propio (el del sistema externo) y queda trazable.
-- ============================================================================

ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS partner_facturado_at timestamptz,
  ADD COLUMN IF NOT EXISTS partner_numero_externo text,
  ADD COLUMN IF NOT EXISTS partner_observacion text;

CREATE INDEX IF NOT EXISTS idx_comprobantes_partner_facturado
  ON public.comprobantes(partner_facturado_at)
  WHERE partner_facturado_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.partner_marcar_facturado(
  p_comprobante_id uuid,
  p_numero_externo text,
  p_observacion    text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_partner_id uuid;
  v_emisor_id uuid;
  v_comp public.comprobantes%ROWTYPE;
  v_admin_nombre text;
BEGIN
  SELECT pr.role, pr.partner_id INTO v_role, v_partner_id
    FROM public.profiles pr WHERE pr.id = auth.uid();
  IF v_role <> 'partner' THEN
    RAISE EXCEPTION 'Solo usuarios partner pueden marcar facturado' USING ERRCODE = '42501';
  END IF;
  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Tu usuario no tiene partner asociado' USING ERRCODE = 'P0002';
  END IF;
  SELECT emisor_id INTO v_emisor_id FROM public.partners WHERE id = v_partner_id;
  IF v_emisor_id IS NULL THEN
    RAISE EXCEPTION 'Tu partner no tiene emisor asignado' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_comp FROM public.comprobantes WHERE id = p_comprobante_id FOR UPDATE;
  IF v_comp.id IS NULL THEN
    RAISE EXCEPTION 'Comprobante no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_comp.emisor_id IS DISTINCT FROM v_emisor_id THEN
    RAISE EXCEPTION 'Este comprobante no pertenece a tu emisor' USING ERRCODE = '42501';
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

  UPDATE public.comprobantes
     SET partner_facturado_at = now(),
         partner_numero_externo = trim(p_numero_externo),
         partner_observacion = NULLIF(trim(COALESCE(p_observacion, '')), '')
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
        'numero_externo', trim(p_numero_externo)
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN p_comprobante_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.partner_marcar_facturado(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.partner_marcar_facturado(uuid, text, text) TO authenticated;

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
  SELECT c.id, c.tipo, c.numero, c.punto_venta, c.fecha, c.vencimiento,
         c.total, c.estado, c.estado_cobranza, c.emitido_arca,
         c.receptor_razon_social,
         c.partner_facturado_at, c.partner_numero_externo
    FROM public.comprobantes c
    JOIN public.profiles pr ON pr.id = auth.uid()
    JOIN public.partners pa ON pa.id = pr.partner_id
   WHERE pr.role = 'partner'
     AND pa.emisor_id = c.emisor_id
   ORDER BY c.fecha DESC, c.numero DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.partner_mis_comprobantes() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.partner_mis_comprobantes() TO authenticated;
