-- ============================================================================
-- 0060_finanzas_importador_historico · DGG-23 Bloque 3.C
--
-- Importador masivo de movimientos históricos desde plantilla Excel/CSV propia
-- de Gestión Global. Diferente a la conciliación bancaria (que importa líneas
-- crudas a `historico_banco` para vincular después): este importador CREA
-- DIRECTAMENTE movimientos en `movimientos` con todos los metadatos.
--
-- Formato plantilla (columnas):
--   fecha (DD/MM/YYYY o YYYY-MM-DD)
--   tipo (ingreso | egreso)
--   caja (nombre exacto)
--   categoria (nombre exacto · opcional)
--   monto (positivo)
--   descripcion (texto)
--   administracion_codigo (opcional)
--   consorcio_codigo (opcional)
--   referencia (opcional)
--
-- Lote auditable + dedup por hash (caja, fecha, tipo, monto, descripcion).
-- ============================================================================

-- Agregar 'historico_masivo' al CHECK de movimientos.origen
ALTER TABLE public.movimientos DROP CONSTRAINT IF EXISTS movimientos_origen_check;
ALTER TABLE public.movimientos ADD CONSTRAINT movimientos_origen_check
  CHECK (origen IN (
    'manual','conciliacion_auto','facturacion','ajuste',
    'historico_banco','transferencia','reversion','historico_masivo'
  ));

-- Tabla de lotes (auditoría de cada importación masiva)
CREATE TABLE IF NOT EXISTS public.movimientos_lotes_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archivo_nombre text,
  observaciones text,
  total_lineas int NOT NULL DEFAULT 0,
  total_importadas int NOT NULL DEFAULT 0,
  total_duplicadas int NOT NULL DEFAULT 0,
  total_errores int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.movimientos_lotes_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS movimientos_lotes_staff_all ON public.movimientos_lotes_historico;
CREATE POLICY movimientos_lotes_staff_all ON public.movimientos_lotes_historico
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

-- Vincular movimientos a su lote de importación
ALTER TABLE public.movimientos
  ADD COLUMN IF NOT EXISTS lote_historico_id uuid
  REFERENCES public.movimientos_lotes_historico(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_movimientos_lote_historico
  ON public.movimientos(lote_historico_id) WHERE lote_historico_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RPC importar_historico_masivo · acepta jsonb array de líneas
-- Devuelve resumen detallado + lista de errores por fila
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fz_importar_historico_masivo(
  p_lineas jsonb,
  p_archivo_nombre text DEFAULT NULL,
  p_observaciones text DEFAULT NULL,
  p_dry_run boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lote_id uuid;
  v_linea jsonb;
  v_idx int := 0;
  v_total int := 0;
  v_importadas int := 0;
  v_duplicadas int := 0;
  v_errores int := 0;
  v_errores_arr jsonb := '[]'::jsonb;

  v_fecha date;
  v_tipo text;
  v_caja_nombre text;
  v_caja_id uuid;
  v_categoria_nombre text;
  v_categoria_id uuid;
  v_monto numeric;
  v_descripcion text;
  v_admin_codigo text;
  v_admin_id uuid;
  v_consorcio_codigo text;
  v_consorcio_id uuid;
  v_referencia text;
  v_hash text;
  v_error_msg text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo personal autorizado puede importar movimientos';
  END IF;

  IF jsonb_array_length(p_lineas) = 0 THEN
    RAISE EXCEPTION 'El archivo no tiene líneas';
  END IF;

  -- Crear lote (incluso en dry_run para mantener auditoría; lo borramos al final si dry)
  INSERT INTO public.movimientos_lotes_historico (
    archivo_nombre, observaciones, total_lineas, created_by
  ) VALUES (
    p_archivo_nombre, p_observaciones,
    jsonb_array_length(p_lineas), auth.uid()
  ) RETURNING id INTO v_lote_id;

  -- Iterar líneas
  FOR v_linea IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    v_idx := v_idx + 1;
    v_total := v_total + 1;
    v_error_msg := NULL;
    v_caja_id := NULL;
    v_categoria_id := NULL;
    v_admin_id := NULL;
    v_consorcio_id := NULL;

    BEGIN
      -- fecha (acepta DD/MM/YYYY o YYYY-MM-DD)
      DECLARE
        v_fecha_str text := btrim(v_linea->>'fecha');
      BEGIN
        IF v_fecha_str IS NULL OR length(v_fecha_str) = 0 THEN
          v_error_msg := 'Fecha vacía';
        ELSIF v_fecha_str ~ '^\d{4}-\d{2}-\d{2}$' THEN
          v_fecha := v_fecha_str::date;
        ELSIF v_fecha_str ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN
          v_fecha := to_date(v_fecha_str, 'DD/MM/YYYY');
        ELSE
          v_error_msg := 'Fecha inválida: ' || v_fecha_str;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_error_msg := 'Fecha inválida: ' || COALESCE(v_fecha_str, '(nula)');
      END;

      IF v_error_msg IS NULL THEN
        -- tipo
        v_tipo := lower(btrim(COALESCE(v_linea->>'tipo', '')));
        IF v_tipo NOT IN ('ingreso','egreso') THEN
          v_error_msg := 'Tipo inválido (esperado ingreso|egreso): ' || v_tipo;
        END IF;
      END IF;

      IF v_error_msg IS NULL THEN
        -- caja
        v_caja_nombre := btrim(COALESCE(v_linea->>'caja', ''));
        IF length(v_caja_nombre) = 0 THEN
          v_error_msg := 'Caja vacía';
        ELSE
          SELECT id INTO v_caja_id FROM public.cajas
          WHERE lower(nombre) = lower(v_caja_nombre);
          IF v_caja_id IS NULL THEN
            v_error_msg := 'Caja no encontrada: ' || v_caja_nombre;
          END IF;
        END IF;
      END IF;

      IF v_error_msg IS NULL THEN
        -- categoria (opcional)
        v_categoria_nombre := NULLIF(btrim(COALESCE(v_linea->>'categoria', '')), '');
        IF v_categoria_nombre IS NOT NULL THEN
          SELECT id INTO v_categoria_id FROM public.categorias_finanzas
          WHERE lower(nombre) = lower(v_categoria_nombre);
          IF v_categoria_id IS NULL THEN
            v_error_msg := 'Categoría no encontrada: ' || v_categoria_nombre;
          END IF;
        END IF;
      END IF;

      IF v_error_msg IS NULL THEN
        -- monto (positivo)
        BEGIN
          v_monto := (v_linea->>'monto')::numeric;
          IF v_monto IS NULL OR v_monto <= 0 THEN
            v_error_msg := 'Monto debe ser > 0';
          END IF;
        EXCEPTION WHEN OTHERS THEN
          v_error_msg := 'Monto inválido: ' || COALESCE(v_linea->>'monto', '(nulo)');
        END;
      END IF;

      IF v_error_msg IS NULL THEN
        v_descripcion := NULLIF(btrim(COALESCE(v_linea->>'descripcion', '')), '');
        v_referencia := NULLIF(btrim(COALESCE(v_linea->>'referencia', '')), '');

        -- administracion (opcional)
        v_admin_codigo := NULLIF(btrim(COALESCE(v_linea->>'administracion_codigo', '')), '');
        IF v_admin_codigo IS NOT NULL THEN
          SELECT id INTO v_admin_id FROM public.administraciones
          WHERE lower(codigo) = lower(v_admin_codigo);
          IF v_admin_id IS NULL THEN
            v_error_msg := 'Administración no encontrada: ' || v_admin_codigo;
          END IF;
        END IF;
      END IF;

      IF v_error_msg IS NULL THEN
        -- consorcio (opcional · code es único por administración)
        v_consorcio_codigo := NULLIF(btrim(COALESCE(v_linea->>'consorcio_codigo', '')), '');
        IF v_consorcio_codigo IS NOT NULL THEN
          IF v_admin_id IS NULL THEN
            v_error_msg := 'Para asignar consorcio, debe indicar también la administración';
          ELSE
            SELECT id INTO v_consorcio_id FROM public.consorcios
            WHERE administracion_id = v_admin_id
              AND lower(codigo) = lower(v_consorcio_codigo);
            IF v_consorcio_id IS NULL THEN
              v_error_msg := 'Consorcio no encontrado en esa administración: ' || v_consorcio_codigo;
            END IF;
          END IF;
        END IF;
      END IF;

      IF v_error_msg IS NULL THEN
        -- hash dedup
        v_hash := encode(extensions.digest(
          v_caja_id::text || '|' || v_fecha::text || '|' || v_tipo || '|' ||
          v_monto::text || '|' || COALESCE(v_descripcion, ''),
          'sha256'
        ), 'hex');

        -- Verificar duplicado (movimiento ya importado con el mismo hash)
        IF EXISTS (SELECT 1 FROM public.movimientos WHERE hash_dedup = v_hash) THEN
          v_duplicadas := v_duplicadas + 1;
        ELSE
          IF NOT p_dry_run THEN
            INSERT INTO public.movimientos (
              caja_id, fecha, tipo, monto, categoria_id, descripcion, referencia,
              administracion_id, consorcio_id, origen, estado, lote_historico_id,
              hash_dedup, created_by
            ) VALUES (
              v_caja_id, v_fecha, v_tipo, v_monto, v_categoria_id, v_descripcion, v_referencia,
              v_admin_id, v_consorcio_id, 'historico_masivo', 'identificado', v_lote_id,
              v_hash, auth.uid()
            );
          END IF;
          v_importadas := v_importadas + 1;
        END IF;
      ELSE
        v_errores := v_errores + 1;
        v_errores_arr := v_errores_arr || jsonb_build_object(
          'fila', v_idx,
          'error', v_error_msg,
          'linea', v_linea
        );
      END IF;
    END;
  END LOOP;

  -- Actualizar conteos del lote (o borrar si dry_run)
  IF p_dry_run THEN
    DELETE FROM public.movimientos_lotes_historico WHERE id = v_lote_id;
    v_lote_id := NULL;
  ELSE
    UPDATE public.movimientos_lotes_historico SET
      total_importadas = v_importadas,
      total_duplicadas = v_duplicadas,
      total_errores = v_errores
    WHERE id = v_lote_id;
  END IF;

  RETURN jsonb_build_object(
    'lote_id', v_lote_id,
    'total', v_total,
    'importadas', v_importadas,
    'duplicadas', v_duplicadas,
    'errores', v_errores,
    'detalles_errores', v_errores_arr,
    'dry_run', p_dry_run
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fz_listar_lotes_historico(
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
) RETURNS TABLE (
  lote_id uuid,
  archivo_nombre text,
  observaciones text,
  total_lineas int,
  total_importadas int,
  total_duplicadas int,
  total_errores int,
  created_at timestamptz,
  created_by_nombre text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo personal autorizado';
  END IF;

  RETURN QUERY
  SELECT
    l.id AS lote_id,
    l.archivo_nombre,
    l.observaciones,
    l.total_lineas,
    l.total_importadas,
    l.total_duplicadas,
    l.total_errores,
    l.created_at,
    p.nombre AS created_by_nombre
  FROM public.movimientos_lotes_historico l
  LEFT JOIN public.profiles p ON p.id = l.created_by
  ORDER BY l.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.fz_importar_historico_masivo FROM public, anon;
REVOKE ALL ON FUNCTION public.fz_listar_lotes_historico FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fz_importar_historico_masivo TO authenticated;
GRANT EXECUTE ON FUNCTION public.fz_listar_lotes_historico TO authenticated;
