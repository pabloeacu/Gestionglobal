-- ============================================================================
-- 0058_finanzas_admin_cajas_categorias · DGG-23 Bloque 3.A
--
-- CRUD completo de cajas y categorías_finanzas para el panel de gerencia.
-- Soft-delete por flag `activo`. Sin hard-delete (FKs RESTRICT preservan
-- integridad histórica). Reglas 1-13 cumplidas: SECURITY DEFINER + search_path
-- explícito, guard staff, sin secretos en front, persistencia en BD.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- CAJAS · CRUD
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fz_caja_crear(
  p_nombre text,
  p_tipo text,
  p_moneda text DEFAULT 'ARS',
  p_color text DEFAULT NULL,
  p_icono text DEFAULT NULL,
  p_cbu text DEFAULT NULL,
  p_alias text DEFAULT NULL,
  p_numero_cuenta text DEFAULT NULL,
  p_banco_entidad text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caja_id uuid;
  v_next_orden int;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo personal autorizado puede crear cajas';
  END IF;

  IF p_nombre IS NULL OR length(btrim(p_nombre)) = 0 THEN
    RAISE EXCEPTION 'El nombre de la caja es obligatorio';
  END IF;

  IF p_tipo NOT IN ('banco','billetera_virtual','plazo_fijo','efectivo') THEN
    RAISE EXCEPTION 'Tipo de caja inválido: %', p_tipo;
  END IF;

  IF p_moneda NOT IN ('ARS','USD') THEN
    RAISE EXCEPTION 'Moneda inválida: %', p_moneda;
  END IF;

  SELECT COALESCE(MAX(orden), 0) + 10 INTO v_next_orden FROM public.cajas;

  INSERT INTO public.cajas (
    nombre, tipo, moneda, color, icono, orden, activo,
    cbu, alias, numero_cuenta, banco_entidad, created_by
  ) VALUES (
    btrim(p_nombre), p_tipo, p_moneda,
    NULLIF(btrim(COALESCE(p_color, '')), ''),
    NULLIF(btrim(COALESCE(p_icono, '')), ''),
    v_next_orden, true,
    NULLIF(btrim(COALESCE(p_cbu, '')), ''),
    NULLIF(btrim(COALESCE(p_alias, '')), ''),
    NULLIF(btrim(COALESCE(p_numero_cuenta, '')), ''),
    NULLIF(btrim(COALESCE(p_banco_entidad, '')), ''),
    auth.uid()
  ) RETURNING id INTO v_caja_id;

  RETURN v_caja_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fz_caja_actualizar(
  p_caja_id uuid,
  p_nombre text,
  p_color text DEFAULT NULL,
  p_icono text DEFAULT NULL,
  p_orden int DEFAULT NULL,
  p_cbu text DEFAULT NULL,
  p_alias text DEFAULT NULL,
  p_numero_cuenta text DEFAULT NULL,
  p_banco_entidad text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo personal autorizado puede modificar cajas';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cajas WHERE id = p_caja_id) THEN
    RAISE EXCEPTION 'Caja no encontrada';
  END IF;

  IF p_nombre IS NULL OR length(btrim(p_nombre)) = 0 THEN
    RAISE EXCEPTION 'El nombre de la caja es obligatorio';
  END IF;

  UPDATE public.cajas SET
    nombre = btrim(p_nombre),
    color = COALESCE(NULLIF(btrim(COALESCE(p_color, '')), ''), color),
    icono = COALESCE(NULLIF(btrim(COALESCE(p_icono, '')), ''), icono),
    orden = COALESCE(p_orden, orden),
    cbu = NULLIF(btrim(COALESCE(p_cbu, '')), ''),
    alias = NULLIF(btrim(COALESCE(p_alias, '')), ''),
    numero_cuenta = NULLIF(btrim(COALESCE(p_numero_cuenta, '')), ''),
    banco_entidad = NULLIF(btrim(COALESCE(p_banco_entidad, '')), '')
  WHERE id = p_caja_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fz_caja_archivar(
  p_caja_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo personal autorizado puede archivar cajas';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cajas WHERE id = p_caja_id) THEN
    RAISE EXCEPTION 'Caja no encontrada';
  END IF;

  UPDATE public.cajas SET activo = false WHERE id = p_caja_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fz_caja_reactivar(
  p_caja_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo personal autorizado puede reactivar cajas';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cajas WHERE id = p_caja_id) THEN
    RAISE EXCEPTION 'Caja no encontrada';
  END IF;

  UPDATE public.cajas SET activo = true WHERE id = p_caja_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fz_listar_cajas_admin(
  p_incluir_archivadas boolean DEFAULT true
) RETURNS TABLE (
  caja_id uuid,
  nombre text,
  tipo text,
  moneda text,
  color text,
  icono text,
  orden int,
  activo boolean,
  cbu text,
  alias text,
  numero_cuenta text,
  banco_entidad text,
  saldo numeric,
  cantidad_movimientos bigint,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo personal autorizado puede listar cajas';
  END IF;

  RETURN QUERY
  SELECT
    c.id AS caja_id,
    c.nombre,
    c.tipo,
    c.moneda,
    c.color,
    c.icono,
    c.orden,
    c.activo,
    c.cbu,
    c.alias,
    c.numero_cuenta,
    c.banco_entidad,
    COALESCE(saldo_calc.saldo, 0)::numeric AS saldo,
    COALESCE(saldo_calc.cantidad_movimientos, 0)::bigint AS cantidad_movimientos,
    c.created_at
  FROM public.cajas c
  LEFT JOIN LATERAL (
    SELECT
      SUM(CASE WHEN m.tipo IN ('ingreso','transferencia_in') THEN m.monto
               WHEN m.tipo IN ('egreso','transferencia_out') THEN -m.monto
               ELSE 0 END) AS saldo,
      COUNT(*) AS cantidad_movimientos
    FROM public.movimientos m
    WHERE m.caja_id = c.id AND m.estado <> 'anulado'
  ) saldo_calc ON true
  WHERE p_incluir_archivadas OR c.activo
  ORDER BY c.activo DESC, c.orden, c.nombre;
END;
$$;

-- ---------------------------------------------------------------------------
-- CATEGORÍAS · CRUD
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fz_categoria_crear(
  p_nombre text,
  p_tipo text,
  p_color text DEFAULT NULL,
  p_icono text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo personal autorizado puede crear categorías';
  END IF;

  IF p_nombre IS NULL OR length(btrim(p_nombre)) = 0 THEN
    RAISE EXCEPTION 'El nombre de la categoría es obligatorio';
  END IF;

  IF p_tipo NOT IN ('ingreso','egreso','ambos') THEN
    RAISE EXCEPTION 'Tipo de categoría inválido: %', p_tipo;
  END IF;

  INSERT INTO public.categorias_finanzas (
    nombre, tipo, color, icono, activo, created_by
  ) VALUES (
    btrim(p_nombre), p_tipo,
    NULLIF(btrim(COALESCE(p_color, '')), ''),
    NULLIF(btrim(COALESCE(p_icono, '')), ''),
    true,
    auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya existe una categoría con ese nombre';
END;
$$;

CREATE OR REPLACE FUNCTION public.fz_categoria_actualizar(
  p_categoria_id uuid,
  p_nombre text,
  p_tipo text,
  p_color text DEFAULT NULL,
  p_icono text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo personal autorizado puede modificar categorías';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.categorias_finanzas WHERE id = p_categoria_id) THEN
    RAISE EXCEPTION 'Categoría no encontrada';
  END IF;

  IF p_nombre IS NULL OR length(btrim(p_nombre)) = 0 THEN
    RAISE EXCEPTION 'El nombre de la categoría es obligatorio';
  END IF;

  IF p_tipo NOT IN ('ingreso','egreso','ambos') THEN
    RAISE EXCEPTION 'Tipo de categoría inválido: %', p_tipo;
  END IF;

  UPDATE public.categorias_finanzas SET
    nombre = btrim(p_nombre),
    tipo = p_tipo,
    color = NULLIF(btrim(COALESCE(p_color, '')), ''),
    icono = NULLIF(btrim(COALESCE(p_icono, '')), '')
  WHERE id = p_categoria_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya existe una categoría con ese nombre';
END;
$$;

CREATE OR REPLACE FUNCTION public.fz_categoria_archivar(
  p_categoria_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo personal autorizado puede archivar categorías';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.categorias_finanzas WHERE id = p_categoria_id) THEN
    RAISE EXCEPTION 'Categoría no encontrada';
  END IF;

  UPDATE public.categorias_finanzas SET activo = false WHERE id = p_categoria_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fz_categoria_reactivar(
  p_categoria_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo personal autorizado puede reactivar categorías';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.categorias_finanzas WHERE id = p_categoria_id) THEN
    RAISE EXCEPTION 'Categoría no encontrada';
  END IF;

  UPDATE public.categorias_finanzas SET activo = true WHERE id = p_categoria_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fz_listar_categorias_admin(
  p_incluir_archivadas boolean DEFAULT true
) RETURNS TABLE (
  categoria_id uuid,
  nombre text,
  tipo text,
  color text,
  icono text,
  activo boolean,
  cantidad_movimientos bigint,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo personal autorizado puede listar categorías';
  END IF;

  RETURN QUERY
  SELECT
    cf.id AS categoria_id,
    cf.nombre,
    cf.tipo,
    cf.color,
    cf.icono,
    cf.activo,
    COALESCE(uso.cantidad_movimientos, 0)::bigint AS cantidad_movimientos,
    cf.created_at
  FROM public.categorias_finanzas cf
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cantidad_movimientos
    FROM public.movimientos m
    WHERE m.categoria_id = cf.id AND m.estado <> 'anulado'
  ) uso ON true
  WHERE p_incluir_archivadas OR cf.activo
  ORDER BY cf.activo DESC, cf.tipo, cf.nombre;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.fz_caja_crear FROM public, anon;
REVOKE ALL ON FUNCTION public.fz_caja_actualizar FROM public, anon;
REVOKE ALL ON FUNCTION public.fz_caja_archivar FROM public, anon;
REVOKE ALL ON FUNCTION public.fz_caja_reactivar FROM public, anon;
REVOKE ALL ON FUNCTION public.fz_listar_cajas_admin FROM public, anon;
REVOKE ALL ON FUNCTION public.fz_categoria_crear FROM public, anon;
REVOKE ALL ON FUNCTION public.fz_categoria_actualizar FROM public, anon;
REVOKE ALL ON FUNCTION public.fz_categoria_archivar FROM public, anon;
REVOKE ALL ON FUNCTION public.fz_categoria_reactivar FROM public, anon;
REVOKE ALL ON FUNCTION public.fz_listar_categorias_admin FROM public, anon;

GRANT EXECUTE ON FUNCTION public.fz_caja_crear TO authenticated;
GRANT EXECUTE ON FUNCTION public.fz_caja_actualizar TO authenticated;
GRANT EXECUTE ON FUNCTION public.fz_caja_archivar TO authenticated;
GRANT EXECUTE ON FUNCTION public.fz_caja_reactivar TO authenticated;
GRANT EXECUTE ON FUNCTION public.fz_listar_cajas_admin TO authenticated;
GRANT EXECUTE ON FUNCTION public.fz_categoria_crear TO authenticated;
GRANT EXECUTE ON FUNCTION public.fz_categoria_actualizar TO authenticated;
GRANT EXECUTE ON FUNCTION public.fz_categoria_archivar TO authenticated;
GRANT EXECUTE ON FUNCTION public.fz_categoria_reactivar TO authenticated;
GRANT EXECUTE ON FUNCTION public.fz_listar_categorias_admin TO authenticated;
