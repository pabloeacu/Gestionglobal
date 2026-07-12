-- 0332 · Cierre de hallazgos de la doble auditoría §6 del wave 3 (doc JL).
--
-- A#4  Bucket pagos-reportados sin límites server-side → 10 MB + allowlist de
--      MIME (imagen/PDF), como sus pares form-adjuntos/tramite-adjuntos.
-- A#6  La policy FOR ALL dejaba al cliente UPDATE/DELETE de su comprobante
--      (evidencia de pago mutable). Se separa: staff = ALL; cliente = sólo
--      INSERT + SELECT bajo su carpeta.
-- A#5  pago_reportar aceptaba cualquier p_archivo_path (se podía citar el
--      archivo de otro admin o reciclar uno viejo → spoof de evidencia).
--      Guard: el path debe colgar de la carpeta del propio admin.
-- A#12 tramite_pedido_doc_crear exigía rol 'gerente' estricto, pero la ruta
--      y el resto del tracking admiten 'operador' (is_staff). Se alinea.
-- A#13 La categoría 'documentacion_incompleta' que insertan los pedidos no
--      existía en tracking_categorias_config → el timeline mostraba el slug
--      crudo. Se seedea con label humano.

-- ── A#4 · límites del bucket ────────────────────────────────────────────────
UPDATE storage.buckets
   SET file_size_limit = 10485760,  -- 10 MB
       allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf']
 WHERE id = 'pagos-reportados';

-- ── A#6 · policy: cliente sin UPDATE/DELETE ─────────────────────────────────
DROP POLICY IF EXISTS pagos_reportados_storage_rw ON storage.objects;

CREATE POLICY pagos_reportados_staff_all ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'pagos-reportados' AND private.is_staff())
  WITH CHECK (bucket_id = 'pagos-reportados' AND private.is_staff());

CREATE POLICY pagos_reportados_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'pagos-reportados'
    AND split_part(name, '/', 1) = private.current_administracion_id()::text
  );

CREATE POLICY pagos_reportados_owner_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'pagos-reportados'
    AND split_part(name, '/', 1) = private.current_administracion_id()::text
  );

-- ── A#5 · guard de pertenencia del adjunto en pago_reportar ─────────────────
-- (misma firma → CREATE OR REPLACE sin overload, R16)
CREATE OR REPLACE FUNCTION public.pago_reportar(
  p_comprobante_id    uuid,
  p_tramite_id        uuid,
  p_tracking_linea_id uuid,
  p_monto             numeric,
  p_fecha_pago        date,
  p_medio             text,
  p_referencia        text,
  p_archivo_path      text,
  p_nota              text
) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin uuid; v_pago_id uuid; v_nombre text; v_ger record; v_monto_txt text;
BEGIN
  IF p_comprobante_id IS NOT NULL THEN
    SELECT administracion_id INTO v_admin FROM public.comprobantes WHERE id = p_comprobante_id;
  ELSIF p_tramite_id IS NOT NULL THEN
    SELECT administracion_id INTO v_admin FROM public.tramites WHERE id = p_tramite_id;
  ELSE
    v_admin := private.current_administracion_id();
  END IF;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'No se pudo determinar la administración del pago'; END IF;
  PERFORM private.assert_administracion_access(v_admin);
  IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a 0'; END IF;

  -- A#5: el comprobante adjunto debe colgar de la carpeta del propio admin
  -- (evita citar archivos ajenos o paths arbitrarios).
  IF p_archivo_path IS NOT NULL AND btrim(p_archivo_path) <> ''
     AND NOT private.is_staff()
     AND split_part(btrim(p_archivo_path), '/', 1) <> v_admin::text THEN
    RAISE EXCEPTION 'El comprobante adjunto no corresponde a tu cuenta';
  END IF;

  INSERT INTO public.pagos_reportados (
    administracion_id, comprobante_id, tramite_id, tracking_linea_id,
    monto, fecha_pago, medio, referencia, archivo_path, nota, estado, reportado_por
  ) VALUES (
    v_admin, p_comprobante_id, p_tramite_id, p_tracking_linea_id,
    p_monto, coalesce(p_fecha_pago, current_date),
    coalesce(nullif(btrim(p_medio),''), 'transferencia'),
    nullif(btrim(p_referencia),''), nullif(btrim(p_archivo_path),''),
    nullif(btrim(p_nota),''), 'reportado', auth.uid()
  ) RETURNING id INTO v_pago_id;

  SELECT nombre INTO v_nombre FROM public.administraciones WHERE id = v_admin;
  v_monto_txt := '$' || trim(to_char(p_monto, 'FM999G999G990D00'));

  FOR v_ger IN SELECT id FROM public.profiles WHERE role IN ('gerente','operador') AND activo = true
  LOOP
    INSERT INTO public.notificaciones_internas (user_id, tipo, titulo, cuerpo, url, payload)
    VALUES (v_ger.id, 'pago_reportado', 'Cliente informó un pago',
            coalesce(v_nombre,'Un cliente') || ' informó un pago de ' || v_monto_txt || ' — pendiente de conciliar',
            '/gerencia/facturacion/pagos-informados',
            jsonb_build_object('pago_id', v_pago_id, 'administracion_id', v_admin, 'monto', p_monto, 'comprobante_id', p_comprobante_id));
    INSERT INTO public.push_notifications_queue (user_id, titulo, cuerpo, click_url)
    VALUES (v_ger.id, 'Cliente informó un pago',
            left(coalesce(v_nombre,'Un cliente') || ' · ' || v_monto_txt, 140),
            '/gerencia/facturacion/pagos-informados');
  END LOOP;

  RETURN v_pago_id;
END $function$;

-- ── A#12 · pedidos de doc creables por staff (gerente u operador) ───────────
-- Cambio puntual del guard; el resto de la función queda idéntico a prod.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.tramite_pedido_doc_crear'::regproc) INTO v_def;
  v_def := replace(v_def,
    'IF COALESCE(v_role,'''') <> ''gerente'' THEN
    RAISE EXCEPTION ''Solo gerencia puede crear pedidos de documentación'';
  END IF;',
    'IF NOT private.is_staff() THEN
    RAISE EXCEPTION ''Solo gerencia puede crear pedidos de documentación'';
  END IF;');
  EXECUTE v_def;
END $$;

-- ── A#13 · seed de la categoría del timeline ────────────────────────────────
INSERT INTO public.tracking_categorias_config (slug, label, color, orden)
SELECT 'documentacion_incompleta', 'Documentación solicitada', 'amber', 25
WHERE NOT EXISTS (
  SELECT 1 FROM public.tracking_categorias_config WHERE slug = 'documentacion_incompleta'
);
