-- 0365 · E-GG-126 (cierre) · hardening capitalizado de la doble auditoría §6.
--
-- Hallazgo A (menor · defensa en profundidad): cliente_puede_ver_adjunto_gestor
-- matcheaba `au LIKE '%' || p_name` — no anclado al bucket, con los '_' de los
-- filenames actuando como comodín LIKE, y TRUE espurio con p_name=''. No era
-- explotable cross-tenant (verificado e2e: el EXISTS sigue scoped a la admin
-- del caller), pero se reemplaza por igualdad exacta de la key extraída de la
-- URL persistida: sin wildcards, anclada a '/gestor-uploads/', vacío = FALSE.
--
-- Hallazgo B (menor · latente): la policy pre-existente partner_facturas_auth_read
-- daba SELECT sobre CUALQUIER objeto del bucket a cualquier profile con
-- role='partner' (sin scoping). Con el bucket ya privado (mig 0364) esa policy
-- es el gate real de las signed URLs → un partner podría firmar/enumerar
-- facturas de otro partner. Hoy 0 objetos y 0 partners activos (latente), pero
-- se cierra ANTES de que el flujo se use: helper que replica la atribución
-- partner↔comprobante de partner_mis_comprobantes (por emisor asignado O por
-- movimiento de cobranza atribuido — migs 0104/0106/0110).

-- ── A · igualdad exacta en el helper del cliente ────────────────────────────
CREATE OR REPLACE FUNCTION private.cliente_puede_ver_adjunto_gestor(p_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_name <> '' AND EXISTS (
    SELECT 1
    FROM public.tracking_lineas tl
    JOIN public.tramites t ON t.id = tl.tramite_id
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE t.administracion_id = p.administracion_id
      AND tl.visible_cliente
      AND EXISTS (
        SELECT 1 FROM unnest(tl.archivos_urls) au
        WHERE split_part(au, '/gestor-uploads/', 2) = p_name
      )
  );
$$;

-- ── B · scoping por partner en partner-facturas ─────────────────────────────
-- Misma atribución que partner_mis_comprobantes: (A) por emisor asignado al
-- partner, o (B) por movimiento de cobranza atribuido al partner.
CREATE OR REPLACE FUNCTION private.partner_puede_ver_factura(p_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles pr
    JOIN public.partners pa ON pa.id = pr.partner_id
    JOIN public.comprobantes c
      ON c.id::text = (storage.foldername(p_name))[1]
    WHERE pr.id = auth.uid() AND pr.role = 'partner'
      AND (
        (pa.emisor_id IS NOT NULL AND c.emisor_id = pa.emisor_id)
        OR EXISTS (
          SELECT 1
          FROM public.movimiento_imputaciones mi
          JOIN public.movimientos m ON m.id = mi.movimiento_id
          WHERE mi.comprobante_id = c.id
            AND m.partner_id_atribucion = pr.partner_id
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION private.partner_puede_ver_factura(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.partner_puede_ver_factura(text) TO authenticated;

-- La policy vieja daba: staff OR (cualquier) partner. La nueva: staff OR
-- partner ATRIBUIDO al comprobante de la carpeta. El cliente conserva su
-- policy propia de mig 0364 (partner_facturas_cliente_select).
DROP POLICY IF EXISTS partner_facturas_auth_read ON storage.objects;
CREATE POLICY partner_facturas_auth_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'partner-facturas'
    AND (private.is_staff() OR private.partner_puede_ver_factura(name))
  );
