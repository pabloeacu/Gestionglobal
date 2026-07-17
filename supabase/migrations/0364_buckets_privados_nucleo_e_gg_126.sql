-- 0364 · E-GG-126 (núcleo) · buckets públicos → privados con signed URLs.
-- Decisión Pablo 2026-07-17: cerrar ya el núcleo sensible — gestor-uploads (5
-- docs reales de clientes accesibles por link sin login) + partner-facturas y
-- tramite-documento-final (vacíos: cerrarlos ANTES de que se usen, sin backfill).
-- Los buckets públicos POR DISEÑO (formulario-descargas, formulario-previews,
-- campus-media, avatars, emisor-logos, encuesta-testimonios) quedan como están
-- (lectores anónimos reales verificados para los 3 primeros; los otros 3
-- anotados como candidatos futuros en DGG-110).
--
-- REVIERTE la decisión de migs 0191/0192 (E-GG-49: "bucket público para que el
-- cliente pueda leer") — ahora el cliente lee vía policies SELECT scoped +
-- createSignedUrl, y el gestor externo anónimo vía la edge fn
-- gestor-firmar-adjunto v3 (candado por token).
--
-- Identificador persistido: se SIGUE guardando la URL pública completa en
-- archivos_urls/documento_final_url/partner_factura_pdf_url (formato único,
-- compatible con datos históricos y con las columnas polimórficas que mezclan
-- URLs externas y /verificar/). Los LECTORES resuelven a signed URL con el
-- helper src/lib/storageUrls.ts. getPublicUrl sobre bucket privado no falla:
-- genera el identificador; la URL directa da 400 (correcto: nadie sin permiso).

-- ── 1 · Flip a privado ───────────────────────────────────────────────────────
UPDATE storage.buckets SET public = false
WHERE id IN ('gestor-uploads', 'partner-facturas', 'tramite-documento-final');

-- ── 2 · Helpers SECURITY DEFINER para las policies del cliente ───────────────
-- (patrón E-GG-70: la policy de storage corre como el caller y los subqueries
-- pasarían por la RLS de las tablas internas — el helper evita esa dependencia)

-- Cliente puede firmar un adjunto de gestor-uploads si está en una línea de
-- tracking VISIBLE de un trámite de SU administración. Nota LIKE: los nombres
-- pasaron por safeStorageKey ([a-zA-Z0-9._-]); un '_' actúa como comodín de un
-- carácter — matcheo laxo aceptable (el path incluye token 64-hex + timestamp).
CREATE OR REPLACE FUNCTION private.cliente_puede_ver_adjunto_gestor(p_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tracking_lineas tl
    JOIN public.tramites t ON t.id = tl.tramite_id
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE t.administracion_id = p.administracion_id
      AND tl.visible_cliente
      AND EXISTS (
        SELECT 1 FROM unnest(tl.archivos_urls) au
        WHERE au LIKE '%' || p_name
      )
  );
$$;

-- Cliente puede firmar la factura del partner de un comprobante de SU admin
-- (el path arranca con el comprobanteId).
CREATE OR REPLACE FUNCTION private.cliente_puede_ver_factura_partner(p_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.comprobantes c
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE c.id::text = (storage.foldername(p_name))[1]
      AND c.administracion_id = p.administracion_id
  );
$$;

-- Cliente puede firmar el documento final de un trámite de SU admin
-- (el path arranca con el tramiteId).
CREATE OR REPLACE FUNCTION private.cliente_puede_ver_doc_final(p_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tramites t
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE t.id::text = (storage.foldername(p_name))[1]
      AND t.administracion_id = p.administracion_id
  );
$$;

REVOKE ALL ON FUNCTION private.cliente_puede_ver_adjunto_gestor(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.cliente_puede_ver_factura_partner(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.cliente_puede_ver_doc_final(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.cliente_puede_ver_adjunto_gestor(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.cliente_puede_ver_factura_partner(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.cliente_puede_ver_doc_final(text) TO authenticated;

-- ── 3 · Policies SELECT del cliente (staff ya tiene las suyas) ───────────────
-- gestor-uploads: staff = gestor_up_staff_all/select (intactas); gestor externo
-- anónimo = edge fn con service_role (sin policy); cliente = scoped:
CREATE POLICY gestor_up_cliente_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'gestor-uploads' AND private.cliente_puede_ver_adjunto_gestor(name));

-- partner-facturas: partner_facturas_auth_read (staff+partner) intacta; cliente:
CREATE POLICY partner_facturas_cliente_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'partner-facturas' AND private.cliente_puede_ver_factura_partner(name));

-- tramite-documento-final: tramite_doc_final_staff_rw intacta; cliente:
CREATE POLICY tramite_doc_final_cliente_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'tramite-documento-final' AND private.cliente_puede_ver_doc_final(name));
