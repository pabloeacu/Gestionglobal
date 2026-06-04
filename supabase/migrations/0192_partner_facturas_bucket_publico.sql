-- ============================================================================
-- 0192 · E-GG-49 (hallazgo auditoría) · Bucket partner-facturas público
--
-- Mismo bug latente que gestor-uploads (mig 0191): el bucket partner-facturas
-- se creó privado (mig 0119) pero subirFacturaPartner (partners.ts:146) usa
-- getPublicUrl() → URL rota. Esa URL se guarda en
-- comprobantes.partner_factura_pdf_url y el CLIENTE la descarga desde su
-- portal (PortalComprobanteDetailPage → fetch(url).blob()). El cliente NO es
-- staff ni partner, así que ni la RLS del bucket lo dejaría leer.
--
-- Hoy el bucket tiene 0 archivos → bug aún latente, pero rompería apenas un
-- partner suba su primera factura real.
--
-- Decisión (Pablo, 2026-06-04): hacer el bucket público, igual que
-- gestor-uploads y tramite-documento-final. Path no-adivinable
-- (comprobanteId + timestamp + random + safeStorageKey(nombre)). El cliente
-- recibe SU factura (la que se le emitió). Las policies de write existentes
-- (partner_facturas_partner_upload) siguen aplicando para escritura;
-- public=true sólo abre la LECTURA por /object/public/.
-- ============================================================================

UPDATE storage.buckets
SET public = true
WHERE id = 'partner-facturas';

-- Smoke: confirmar que quedó público.
DO $$
DECLARE v_public boolean;
BEGIN
  SELECT public INTO v_public FROM storage.buckets WHERE id = 'partner-facturas';
  IF v_public IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'SMOKE_FAIL: partner-facturas no quedó público (public=%)', v_public;
  END IF;
  RAISE NOTICE 'SMOKE_OK: partner-facturas público';
END $$;
