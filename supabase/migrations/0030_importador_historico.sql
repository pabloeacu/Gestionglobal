-- ============================================================================
-- 0030_importador_historico · Subsistema Reportes/Importador.
-- ----------------------------------------------------------------------------
-- Habilita carga masiva de comprobantes históricos desde Excel.
-- - `comprobantes.origen` ya acepta 'previo' (definido en 0004_facturacion.sql,
--   línea 130-131) y el unique index `uq_comprobantes_pv_tipo_numero` excluye
--   `origen='previo'` para no chocar con la numeración fiscal nativa.
-- - Sumamos tabla `import_log` para trazabilidad (auditoría regla 9).
-- - RPC `import_comprobantes_batch(p_filas jsonb)` para insertar lote en una
--   transacción (regla 5: 2+ tablas → RPC SECURITY DEFINER).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- import_log · una fila por archivo importado.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archivo text NOT NULL,
  total_filas int NOT NULL DEFAULT 0 CHECK (total_filas >= 0),
  insertados int NOT NULL DEFAULT 0 CHECK (insertados >= 0),
  saltados int NOT NULL DEFAULT 0 CHECK (saltados >= 0),
  errores jsonb NOT NULL DEFAULT '[]'::jsonb,
  autor uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_log_created
  ON public.import_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_log_autor
  ON public.import_log(autor) WHERE autor IS NOT NULL;

-- RLS día 1 (regla 2). Sólo gerentes/operadores leen; sólo gerente crea.
ALTER TABLE public.import_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_log_select_staff ON public.import_log;
CREATE POLICY import_log_select_staff ON public.import_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('gerente','operador')
    )
  );

DROP POLICY IF EXISTS import_log_insert_gerente ON public.import_log;
CREATE POLICY import_log_insert_gerente ON public.import_log
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'gerente'
    )
  );

-- ----------------------------------------------------------------------------
-- RPC · import_comprobantes_batch
-- ----------------------------------------------------------------------------
-- Recibe un arreglo JSON de filas validadas. Sólo gerentes (single-tenant,
-- regla 12). Inserta con `origen='previo'`. Devuelve resumen.
--
-- Cada fila debe tener (camelCase JSON):
--   administracionId (uuid, requerido)
--   fecha (date, requerido)
--   tipo  (text en X/A/B/C, requerido)
--   puntoVenta (int, default 1)
--   numero (int, opcional)
--   receptorRazonSocial (text, requerido)
--   receptorCuit (text, requerido — CUIT/CUIL o DNI)
--   receptorCondicionIva (text, default 'consumidor_final')
--   total (numeric >= 0, requerido)
--   periodo (date — primer día del mes, opcional → fecha)
--   observaciones (text, opcional)
--   concepto (text, default 'servicios')
--
-- Errores no abortan: se acumulan en el resumen para mostrar al usuario.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_comprobantes_batch(
  p_archivo text,
  p_filas jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_uid uuid := auth.uid();
  v_total int := 0;
  v_insertados int := 0;
  v_saltados int := 0;
  v_errores jsonb := '[]'::jsonb;
  v_log_id uuid;
  v_row jsonb;
  v_admin_id uuid;
  v_fecha date;
  v_tipo text;
  v_pv int;
  v_numero int;
  v_razon text;
  v_doc text;
  v_total_monto numeric(14,2);
  v_periodo date;
  v_obs text;
  v_concepto text;
  v_cond_iva text;
  v_idx int := 0;
BEGIN
  -- Guard: sólo gerentes
  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role IS DISTINCT FROM 'gerente' THEN
    RAISE EXCEPTION 'Sólo gerentes pueden importar histórico';
  END IF;

  v_total := jsonb_array_length(p_filas);

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_filas) LOOP
    v_idx := v_idx + 1;
    BEGIN
      v_admin_id := (v_row->>'administracionId')::uuid;
      v_fecha := (v_row->>'fecha')::date;
      v_tipo := upper(coalesce(v_row->>'tipo','X'));
      v_pv := coalesce(NULLIF(v_row->>'puntoVenta','')::int, 1);
      v_numero := NULLIF(v_row->>'numero','')::int;
      v_razon := v_row->>'receptorRazonSocial';
      v_doc := v_row->>'receptorCuit';
      v_total_monto := (v_row->>'total')::numeric;
      v_periodo := coalesce(NULLIF(v_row->>'periodo','')::date, date_trunc('month', v_fecha)::date);
      v_obs := v_row->>'observaciones';
      v_concepto := coalesce(NULLIF(v_row->>'concepto',''), 'servicios');
      v_cond_iva := coalesce(NULLIF(v_row->>'receptorCondicionIva',''), 'consumidor_final');

      IF v_admin_id IS NULL OR v_fecha IS NULL OR v_razon IS NULL OR v_doc IS NULL OR v_total_monto IS NULL THEN
        v_saltados := v_saltados + 1;
        v_errores := v_errores || jsonb_build_object(
          'fila', v_idx, 'motivo', 'Campos requeridos vacíos'
        );
        CONTINUE;
      END IF;

      IF v_tipo NOT IN ('X','A','B','C') THEN
        v_saltados := v_saltados + 1;
        v_errores := v_errores || jsonb_build_object(
          'fila', v_idx, 'motivo', 'Tipo de comprobante inválido: '||v_tipo
        );
        CONTINUE;
      END IF;

      INSERT INTO public.comprobantes (
        administracion_id, fecha, tipo, punto_venta, numero,
        receptor_razon_social, receptor_numero_documento,
        receptor_tipo_documento, receptor_condicion_iva,
        concepto, periodo, total, saldo_pendiente,
        observaciones, origen, estado, estado_cobranza,
        created_by
      ) VALUES (
        v_admin_id, v_fecha, v_tipo, v_pv, v_numero,
        v_razon, v_doc,
        CASE WHEN length(v_doc) = 11 THEN 'cuit'
             WHEN length(v_doc) = 8  THEN 'dni'
             ELSE 'otro' END,
        v_cond_iva,
        v_concepto, v_periodo, v_total_monto, 0,
        v_obs, 'previo', 'autorizado', 'pagado',
        v_uid
      );
      v_insertados := v_insertados + 1;
    EXCEPTION WHEN OTHERS THEN
      v_saltados := v_saltados + 1;
      v_errores := v_errores || jsonb_build_object(
        'fila', v_idx, 'motivo', SQLERRM
      );
    END;
  END LOOP;

  INSERT INTO public.import_log (archivo, total_filas, insertados, saltados, errores, autor)
  VALUES (p_archivo, v_total, v_insertados, v_saltados, v_errores, v_uid)
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'logId', v_log_id,
    'total', v_total,
    'insertados', v_insertados,
    'saltados', v_saltados,
    'errores', v_errores
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_comprobantes_batch(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_comprobantes_batch(text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.import_comprobantes_batch(text, jsonb) IS
  'Importa lote de comprobantes históricos (origen=previo). Sólo gerentes.';
COMMENT ON TABLE public.import_log IS
  'Registro de cada importación de histórico desde Excel.';
