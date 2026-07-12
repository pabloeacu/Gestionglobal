-- 0330 · Hilo 6 del doc JL (2026-07-12): adjuntar el comprobante de
-- transferencia al "Informar un pago" del portal.
--
-- Caso de negocio: los cursos se pagan por transferencia a la cuenta de la
-- FUNDACIÓN (no nuestra), así que gerencia no ve la acreditación en su banco
-- y necesita el comprobante para verificar. Hoy se lo mandan por WhatsApp.
-- `pagos_reportados.archivo_path` y `pago_reportar(p_archivo_path)` ya
-- existían (mig 0328, follow-up documentado en DGG-103); esto agrega el
-- bucket + policies para que el cliente pueda subirlo desde el portal.
--
-- Patrón espejo de `pedidos-doc-cliente` (bucket privado + policy por rol):
--   · path = <administracion_id>/<timestamp>-<filename-sanitizado>  (R20)
--   · staff (gerente/operador): lectura/escritura total
--   · administrador: sólo bajo su propia carpeta (primer segmento del path
--     = su administracion_id vía private.current_administracion_id())

INSERT INTO storage.buckets (id, name, public)
VALUES ('pagos-reportados', 'pagos-reportados', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY pagos_reportados_storage_rw ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'pagos-reportados'
    AND (
      private.is_staff()
      OR split_part(name, '/', 1) = private.current_administracion_id()::text
    )
  )
  WITH CHECK (
    bucket_id = 'pagos-reportados'
    AND (
      private.is_staff()
      OR split_part(name, '/', 1) = private.current_administracion_id()::text
    )
  );
