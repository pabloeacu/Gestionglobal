-- 0057_finanzas_conciliacion.sql — Finanzas Bloque 2 · Conciliación bancaria
--
-- Capitaliza MANAXER 0101 (conciliación chunked) con formato propio del
-- usuario: el banco entrega un Excel/CSV con columnas FIJAS (fecha,
-- descripción, ingreso, egreso, observaciones, saldo). El usuario completa
-- y sube; nosotros importamos a `historico_banco` con dedup hash,
-- sugerimos matches contra `movimientos` y permitimos:
--   1) Vincular línea con un movimiento existente.
--   2) Crear un movimiento nuevo desde la línea (auto-imputado si aplica).
--   3) Ignorar línea (no es un movimiento real · ej. saldo inicial).
--
-- Tablas:
--   - historico_banco_lotes  · cada importación (auditoría)
--   - historico_banco        · líneas del extracto
--   - patrones_conciliacion  · patrones aprendidos (descripcion → categoría)

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1) Tablas
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.historico_banco_lotes (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  caja_id uuid NOT NULL REFERENCES public.cajas(id) ON DELETE RESTRICT,
  archivo_nombre text,
  lineas_total integer NOT NULL DEFAULT 0,
  lineas_importadas integer NOT NULL DEFAULT 0,
  lineas_duplicadas integer NOT NULL DEFAULT 0,
  observaciones text,
  importado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  importado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_historico_banco_lotes_caja
  ON public.historico_banco_lotes(caja_id, importado_at DESC);

CREATE TABLE IF NOT EXISTS public.historico_banco (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  caja_id uuid NOT NULL REFERENCES public.cajas(id) ON DELETE RESTRICT,
  lote_id uuid REFERENCES public.historico_banco_lotes(id) ON DELETE SET NULL,
  fecha date NOT NULL,
  descripcion text NOT NULL,
  ingreso numeric(14,2) NOT NULL DEFAULT 0 CHECK (ingreso >= 0),
  egreso numeric(14,2) NOT NULL DEFAULT 0 CHECK (egreso >= 0),
  observaciones text,
  saldo numeric(14,2),
  hash_dedup text NOT NULL,
  -- Estado de conciliación
  movimiento_id uuid REFERENCES public.movimientos(id) ON DELETE SET NULL,
  conciliado_at timestamptz,
  ignorada_at timestamptz,
  ignorada_motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Una línea puede ser ingreso O egreso (no ambos > 0)
  CONSTRAINT historico_banco_signo_xor CHECK (
    NOT (ingreso > 0 AND egreso > 0)
  ),
  -- Dedup global por caja: si subís el mismo CSV dos veces no se duplica
  CONSTRAINT historico_banco_hash_unique UNIQUE (caja_id, hash_dedup)
);
CREATE INDEX IF NOT EXISTS idx_historico_banco_caja_fecha
  ON public.historico_banco(caja_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_historico_banco_pendientes
  ON public.historico_banco(caja_id, fecha DESC)
  WHERE conciliado_at IS NULL AND ignorada_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_historico_banco_lote
  ON public.historico_banco(lote_id) WHERE lote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_historico_banco_movimiento
  ON public.historico_banco(movimiento_id) WHERE movimiento_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.patrones_conciliacion (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  -- descripcion_pattern: substring ILIKE-friendly (ej. "DEBITO TARJETA VISA")
  descripcion_pattern text NOT NULL,
  categoria_id uuid REFERENCES public.categorias_finanzas(id) ON DELETE SET NULL,
  administracion_id uuid REFERENCES public.administraciones(id) ON DELETE SET NULL,
  usos_count integer NOT NULL DEFAULT 0,
  ultimo_uso_at timestamptz,
  creado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patrones_unique UNIQUE (descripcion_pattern, categoria_id, administracion_id)
);
CREATE INDEX IF NOT EXISTS idx_patrones_usos
  ON public.patrones_conciliacion(usos_count DESC);

-- ────────────────────────────────────────────────────────────────
-- 2) RLS
-- ────────────────────────────────────────────────────────────────

ALTER TABLE public.historico_banco_lotes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico_banco        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patrones_conciliacion  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS historico_lotes_staff ON public.historico_banco_lotes;
CREATE POLICY historico_lotes_staff ON public.historico_banco_lotes
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS historico_banco_staff ON public.historico_banco;
CREATE POLICY historico_banco_staff ON public.historico_banco
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS patrones_staff ON public.patrones_conciliacion;
CREATE POLICY patrones_staff ON public.patrones_conciliacion
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

-- ────────────────────────────────────────────────────────────────
-- 3) RPC · importar lote de historico banco
-- ────────────────────────────────────────────────────────────────
-- Recibe array de líneas (jsonb) con shape:
--   { fecha:'YYYY-MM-DD', descripcion, ingreso, egreso, observaciones, saldo }
-- Calcula hash_dedup en SQL, bulk insert con ON CONFLICT DO NOTHING.
-- Devuelve {lote_id, nuevas, duplicadas, total}.

CREATE OR REPLACE FUNCTION public.fz_importar_historico_lote(
  p_caja_id uuid,
  p_lineas jsonb,
  p_archivo_nombre text DEFAULT NULL,
  p_observaciones text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lote_id uuid;
  v_total integer;
  v_nuevas integer := 0;
  v_existentes_pre integer;
  v_existentes_post integer;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cajas WHERE id = p_caja_id AND activo) THEN
    RAISE EXCEPTION 'caja_inexistente_o_inactiva' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_lineas) <> 'array' THEN
    RAISE EXCEPTION 'lineas_debe_ser_array' USING ERRCODE = '22023';
  END IF;

  v_total := jsonb_array_length(p_lineas);
  IF v_total = 0 THEN
    RAISE EXCEPTION 'lineas_vacias' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.historico_banco_lotes(caja_id, archivo_nombre, lineas_total, observaciones, importado_por)
  VALUES (p_caja_id, p_archivo_nombre, v_total, p_observaciones, auth.uid())
  RETURNING id INTO v_lote_id;

  SELECT COUNT(*) INTO v_existentes_pre FROM public.historico_banco WHERE caja_id = p_caja_id;

  INSERT INTO public.historico_banco (
    caja_id, lote_id, fecha, descripcion, ingreso, egreso, observaciones, saldo, hash_dedup
  )
  SELECT
    p_caja_id,
    v_lote_id,
    (linea->>'fecha')::date,
    COALESCE(linea->>'descripcion', ''),
    GREATEST(0, COALESCE((linea->>'ingreso')::numeric, 0)),
    GREATEST(0, COALESCE((linea->>'egreso')::numeric, 0)),
    linea->>'observaciones',
    NULLIF((linea->>'saldo')::text, '')::numeric,
    encode(extensions.digest(
      p_caja_id::text || '|' ||
      (linea->>'fecha') || '|' ||
      COALESCE(linea->>'descripcion', '') || '|' ||
      COALESCE(linea->>'ingreso', '0') || '|' ||
      COALESCE(linea->>'egreso', '0') || '|' ||
      COALESCE(linea->>'saldo', ''),
      'sha256'
    ), 'hex')
  FROM jsonb_array_elements(p_lineas) AS linea
  WHERE COALESCE(linea->>'fecha','') <> ''
    AND (
      COALESCE((linea->>'ingreso')::numeric, 0) > 0
      OR COALESCE((linea->>'egreso')::numeric, 0) > 0
    )
  ON CONFLICT (caja_id, hash_dedup) DO NOTHING;

  SELECT COUNT(*) INTO v_existentes_post FROM public.historico_banco WHERE caja_id = p_caja_id;
  v_nuevas := v_existentes_post - v_existentes_pre;

  UPDATE public.historico_banco_lotes
     SET lineas_importadas = v_nuevas,
         lineas_duplicadas = v_total - v_nuevas
   WHERE id = v_lote_id;

  RETURN jsonb_build_object(
    'lote_id', v_lote_id,
    'total', v_total,
    'nuevas', v_nuevas,
    'duplicadas', v_total - v_nuevas
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fz_importar_historico_lote(uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fz_importar_historico_lote(uuid, jsonb, text, text) TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- 4) RPC · listar líneas pendientes de conciliar con sugeridos
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fz_listar_historico_pendientes(
  p_caja_id uuid,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
) RETURNS TABLE (
  id uuid,
  caja_id uuid,
  caja_nombre text,
  fecha date,
  descripcion text,
  ingreso numeric,
  egreso numeric,
  observaciones text,
  saldo numeric,
  monto_efectivo numeric,
  tipo_efectivo text,
  conciliado_at timestamptz,
  ignorada_at timestamptz,
  total_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH filt AS (
    SELECT
      h.id, h.caja_id, c.nombre AS caja_nombre,
      h.fecha, h.descripcion, h.ingreso, h.egreso, h.observaciones, h.saldo,
      CASE WHEN h.ingreso > 0 THEN h.ingreso ELSE h.egreso END AS monto_efectivo,
      CASE WHEN h.ingreso > 0 THEN 'ingreso' ELSE 'egreso' END AS tipo_efectivo,
      h.conciliado_at, h.ignorada_at
    FROM public.historico_banco h
    JOIN public.cajas c ON c.id = h.caja_id
    WHERE private.is_staff()
      AND h.caja_id = p_caja_id
      AND h.conciliado_at IS NULL
      AND h.ignorada_at IS NULL
  ),
  cnt AS (
    SELECT *, COUNT(*) OVER() AS total_count FROM filt
  )
  SELECT * FROM cnt
  ORDER BY fecha DESC, id DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200))
  OFFSET GREATEST(0, p_offset);
$$;
REVOKE EXECUTE ON FUNCTION public.fz_listar_historico_pendientes(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fz_listar_historico_pendientes(uuid, integer, integer) TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- 5) RPC · sugerir matches para una línea
-- ────────────────────────────────────────────────────────────────
-- Algoritmo:
--   - Mismo signo (ingreso → tipo='ingreso', egreso → tipo='egreso')
--   - Mismo monto exacto (CRÍTICO)
--   - Fecha dentro de ventana ±5 días (score por proximidad)
--   - Misma caja
--   - Excluye movs ya vinculados a otra linea historica
--   - Excluye reversiones, anulados, revertidos
-- Devuelve sorted por proximidad de fecha.

CREATE OR REPLACE FUNCTION public.fz_sugerir_matches(
  p_historico_id uuid
) RETURNS TABLE (
  movimiento_id uuid,
  fecha date,
  tipo text,
  monto numeric,
  descripcion text,
  categoria_nombre text,
  administracion_nombre text,
  dias_diff integer,
  score numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hist record;
  v_tipo_buscar text;
  v_monto numeric;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_hist FROM public.historico_banco WHERE id = p_historico_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_hist.ingreso > 0 THEN
    v_tipo_buscar := 'ingreso';
    v_monto := v_hist.ingreso;
  ELSE
    v_tipo_buscar := 'egreso';
    v_monto := v_hist.egreso;
  END IF;

  RETURN QUERY
  SELECT
    m.id AS movimiento_id,
    m.fecha,
    m.tipo,
    m.monto,
    m.descripcion,
    cat.nombre AS categoria_nombre,
    a.nombre AS administracion_nombre,
    ABS((m.fecha - v_hist.fecha)::int) AS dias_diff,
    -- Score: 100 - dias_diff * 5 (con cap a 0)
    GREATEST(0, 100 - ABS((m.fecha - v_hist.fecha)::int) * 5)::numeric AS score
  FROM public.movimientos m
  LEFT JOIN public.categorias_finanzas cat ON cat.id = m.categoria_id
  LEFT JOIN public.administraciones a ON a.id = m.administracion_id
  WHERE m.caja_id = v_hist.caja_id
    AND m.tipo = v_tipo_buscar
    AND m.monto = v_monto
    AND m.estado = 'identificado'
    AND m.revertido_at IS NULL
    AND m.origen <> 'reversion'
    AND ABS((m.fecha - v_hist.fecha)::int) <= 5
    AND NOT EXISTS (
      SELECT 1 FROM public.historico_banco hb
      WHERE hb.movimiento_id = m.id AND hb.id <> p_historico_id
    )
  ORDER BY dias_diff ASC, m.fecha DESC
  LIMIT 10;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fz_sugerir_matches(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fz_sugerir_matches(uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- 6) RPC · conciliar manual (vincular línea con movimiento existente)
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fz_conciliar_manual(
  p_historico_id uuid,
  p_movimiento_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hist record;
  v_mov record;
  v_monto_hist numeric;
  v_tipo_hist text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_hist FROM public.historico_banco WHERE id = p_historico_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'historico_inexistente' USING ERRCODE = 'P0002'; END IF;
  IF v_hist.conciliado_at IS NOT NULL THEN RAISE EXCEPTION 'historico_ya_conciliado' USING ERRCODE = '22023'; END IF;
  IF v_hist.ignorada_at IS NOT NULL THEN RAISE EXCEPTION 'historico_ya_ignorado' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_mov FROM public.movimientos WHERE id = p_movimiento_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'movimiento_inexistente' USING ERRCODE = 'P0002'; END IF;
  IF v_mov.caja_id <> v_hist.caja_id THEN
    RAISE EXCEPTION 'caja_no_coincide' USING ERRCODE = '22023';
  END IF;
  IF v_mov.estado <> 'identificado' OR v_mov.revertido_at IS NOT NULL THEN
    RAISE EXCEPTION 'movimiento_no_valido' USING ERRCODE = '22023';
  END IF;

  IF v_hist.ingreso > 0 THEN
    v_tipo_hist := 'ingreso'; v_monto_hist := v_hist.ingreso;
  ELSE
    v_tipo_hist := 'egreso'; v_monto_hist := v_hist.egreso;
  END IF;
  IF v_mov.tipo <> v_tipo_hist OR v_mov.monto <> v_monto_hist THEN
    RAISE EXCEPTION 'tipo_o_monto_no_coincide' USING ERRCODE = '22023';
  END IF;

  UPDATE public.historico_banco
     SET movimiento_id = p_movimiento_id,
         conciliado_at = now()
   WHERE id = p_historico_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fz_conciliar_manual(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fz_conciliar_manual(uuid, uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- 7) RPC · crear movimiento desde línea histórica
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fz_crear_mov_desde_historico(
  p_historico_id uuid,
  p_categoria_id uuid DEFAULT NULL,
  p_administracion_id uuid DEFAULT NULL,
  p_descripcion_custom text DEFAULT NULL,
  p_guardar_patron boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hist record;
  v_mov_id uuid;
  v_tipo text;
  v_monto numeric;
  v_pattern text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_hist FROM public.historico_banco WHERE id = p_historico_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'historico_inexistente' USING ERRCODE = 'P0002'; END IF;
  IF v_hist.conciliado_at IS NOT NULL THEN RAISE EXCEPTION 'historico_ya_conciliado' USING ERRCODE = '22023'; END IF;
  IF v_hist.ignorada_at IS NOT NULL THEN RAISE EXCEPTION 'historico_ya_ignorado' USING ERRCODE = '22023'; END IF;

  IF v_hist.ingreso > 0 THEN
    v_tipo := 'ingreso'; v_monto := v_hist.ingreso;
  ELSE
    v_tipo := 'egreso'; v_monto := v_hist.egreso;
  END IF;

  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, categoria_id,
    descripcion, referencia, administracion_id,
    estado, origen, created_by
  ) VALUES (
    v_hist.caja_id, v_hist.fecha, v_tipo, v_monto, p_categoria_id,
    COALESCE(NULLIF(p_descripcion_custom, ''), v_hist.descripcion),
    v_hist.observaciones, p_administracion_id,
    'identificado', 'conciliacion_auto', auth.uid()
  )
  RETURNING id INTO v_mov_id;

  UPDATE public.historico_banco
     SET movimiento_id = v_mov_id,
         conciliado_at = now()
   WHERE id = p_historico_id;

  -- Guardar patrón aprendido (substring distinguible de la descripción)
  IF p_guardar_patron AND p_categoria_id IS NOT NULL THEN
    -- Usar primeras 30 chars de la descripción como pattern
    v_pattern := upper(trim(substring(v_hist.descripcion FROM 1 FOR 30)));
    IF length(v_pattern) >= 3 THEN
      INSERT INTO public.patrones_conciliacion(
        descripcion_pattern, categoria_id, administracion_id, usos_count, ultimo_uso_at, creado_por
      ) VALUES (
        v_pattern, p_categoria_id, p_administracion_id, 1, now(), auth.uid()
      )
      ON CONFLICT (descripcion_pattern, categoria_id, administracion_id) DO UPDATE
        SET usos_count = patrones_conciliacion.usos_count + 1,
            ultimo_uso_at = now();
    END IF;
  END IF;

  RETURN v_mov_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fz_crear_mov_desde_historico(uuid, uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fz_crear_mov_desde_historico(uuid, uuid, uuid, text, boolean) TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- 8) RPC · ignorar línea (no es un movimiento real)
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fz_ignorar_linea_historico(
  p_historico_id uuid,
  p_motivo text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.historico_banco
     SET ignorada_at = now(),
         ignorada_motivo = p_motivo
   WHERE id = p_historico_id
     AND conciliado_at IS NULL
     AND ignorada_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'historico_no_modificable' USING ERRCODE = 'P0002';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fz_ignorar_linea_historico(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fz_ignorar_linea_historico(uuid, text) TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- 9) RPC · KPIs de conciliación
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fz_conciliacion_kpis(
  p_caja_id uuid DEFAULT NULL
) RETURNS TABLE (
  total_lineas integer,
  pendientes integer,
  conciliadas integer,
  ignoradas integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE conciliado_at IS NULL AND ignorada_at IS NULL)::int,
    COUNT(*) FILTER (WHERE conciliado_at IS NOT NULL)::int,
    COUNT(*) FILTER (WHERE ignorada_at IS NOT NULL)::int
  FROM public.historico_banco
  WHERE private.is_staff()
    AND (p_caja_id IS NULL OR caja_id = p_caja_id);
$$;
REVOKE EXECUTE ON FUNCTION public.fz_conciliacion_kpis(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fz_conciliacion_kpis(uuid) TO authenticated;

COMMIT;
