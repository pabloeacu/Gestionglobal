-- ============================================================================
-- 0174 · JL-CAJA · 4 pedidos de José Luis sobre el módulo Cajas
--
-- (1) Editar tipo de caja post-alta. Hoy `fz_caja_actualizar` no recibe
--     `p_tipo`, sólo el alta lo setea. Lo agregamos. R16-compliant: DROP +
--     CREATE (no `CREATE OR REPLACE` porque cambia la firma).
--
-- (2) Eliminar caja (hard delete). Hoy sólo hay `fz_caja_archivar` (soft).
--     Pedido: si saldo = 0 → eliminar; si saldo > 0 → bloquear y pedir
--     que transfiera el saldo a otra caja antes. La RPC verifica saldo
--     inline desde `movimientos` (sin función helper de saldo — ver query
--     `SUM(CASE tipo WHEN 'ingreso' THEN monto ELSE -monto END)`
--     filtrando movimientos no anulados).
--
-- (3) Caja favorita / default. Nueva columna `es_default boolean NOT NULL
--     DEFAULT false` + unique partial index (solo 1 caja default a la vez,
--     single-tenant). RPC `fz_caja_marcar_default` la setea + desmarca las
--     demás en transacción.
--
-- (4) Campo "orden". La columna `orden int NOT NULL DEFAULT 0` ya existía
--     desde mig 0058 + el RPC `fz_caja_actualizar` ya recibía `p_orden`.
--     Sólo faltaba exponerlo en el frontend (lo hace el chunk JL-CAJA-4).
--     Esta mig agrega un índice para ORDER BY orden, nombre.
--
-- R12 (tenancy guard) no aplica: cajas es singleton global, no per-admin.
-- R16 (overloads ambiguos): se hace DROP de la firma vieja antes del CREATE.
-- ============================================================================

-- (3.a) Columna es_default
ALTER TABLE public.cajas
  ADD COLUMN IF NOT EXISTS es_default boolean NOT NULL DEFAULT false;

-- Unique partial index: a lo sumo 1 caja con es_default=true en el sistema.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cajas_es_default_unique
  ON public.cajas (es_default)
  WHERE es_default = true;

COMMENT ON COLUMN public.cajas.es_default IS
  'JL-CAJA · si true, esta caja se pre-selecciona en el modal de cobranza. Único partial index garantiza máximo 1 caja default por sistema.';

-- (4.a) Índice para orden de las cards.
CREATE INDEX IF NOT EXISTS idx_cajas_orden_nombre
  ON public.cajas (activo DESC, orden ASC, nombre ASC);

-- ============================================================================
-- (1) DROP + CREATE fz_caja_actualizar para extender con p_tipo + p_es_default
-- ============================================================================
DROP FUNCTION IF EXISTS public.fz_caja_actualizar(
  uuid, text, text, text, integer, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.fz_caja_actualizar(
  p_caja_id        uuid,
  p_nombre         text,
  p_tipo           text DEFAULT NULL,         -- NUEVO (JL-CAJA #1)
  p_color          text DEFAULT NULL,
  p_icono          text DEFAULT NULL,
  p_orden          integer DEFAULT NULL,
  p_cbu            text DEFAULT NULL,
  p_alias          text DEFAULT NULL,
  p_numero_cuenta  text DEFAULT NULL,
  p_banco_entidad  text DEFAULT NULL,
  p_es_default     boolean DEFAULT NULL       -- NUEVO (JL-CAJA #3)
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caja public.cajas%ROWTYPE;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Sólo gerencia puede editar cajas' USING ERRCODE = '42501';
  END IF;
  IF p_nombre IS NULL OR length(trim(p_nombre)) = 0 THEN
    RAISE EXCEPTION 'Nombre requerido' USING ERRCODE = '22023';
  END IF;
  IF p_tipo IS NOT NULL AND p_tipo NOT IN ('banco','billetera_virtual','plazo_fijo','efectivo') THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_caja FROM public.cajas WHERE id = p_caja_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caja no encontrada' USING ERRCODE = 'P0002';
  END IF;

  -- Si quiere marcar como default, desmarcar las demás en la misma tx.
  IF p_es_default = true AND COALESCE(v_caja.es_default, false) = false THEN
    UPDATE public.cajas SET es_default = false WHERE es_default = true;
  END IF;

  UPDATE public.cajas
     SET nombre         = trim(p_nombre),
         tipo           = COALESCE(p_tipo, tipo),
         color          = COALESCE(p_color, color),
         icono          = COALESCE(p_icono, icono),
         orden          = COALESCE(p_orden, orden),
         cbu            = COALESCE(NULLIF(trim(p_cbu), ''), cbu),
         alias          = COALESCE(NULLIF(trim(p_alias), ''), alias),
         numero_cuenta  = COALESCE(NULLIF(trim(p_numero_cuenta), ''), numero_cuenta),
         banco_entidad  = COALESCE(NULLIF(trim(p_banco_entidad), ''), banco_entidad),
         es_default     = COALESCE(p_es_default, es_default),
         updated_at     = now()
   WHERE id = p_caja_id;

  RETURN p_caja_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.fz_caja_actualizar(uuid,text,text,text,text,integer,text,text,text,text,boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fz_caja_actualizar(uuid,text,text,text,text,integer,text,text,text,text,boolean) TO authenticated;

COMMENT ON FUNCTION public.fz_caja_actualizar IS
  'JL-CAJA (mig 0174) · extendido con p_tipo (editar tipo post-alta) y p_es_default (marcar favorita, desmarca las demás).';

-- ============================================================================
-- (2) NUEVA RPC fz_caja_eliminar(p_caja_id) — hard delete con check de saldo
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fz_caja_eliminar(
  p_caja_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caja      public.cajas%ROWTYPE;
  v_saldo     numeric;
  v_n_movs    integer;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Sólo gerencia puede eliminar cajas' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caja FROM public.cajas WHERE id = p_caja_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caja no encontrada' USING ERRCODE = 'P0002';
  END IF;

  -- Calcular saldo: SUM(ingresos) - SUM(egresos) ignorando movs anulados.
  SELECT
    COALESCE(SUM(CASE
      WHEN tipo = 'ingreso' THEN monto
      WHEN tipo = 'egreso'  THEN -monto
      ELSE 0
    END), 0),
    COUNT(*)
  INTO v_saldo, v_n_movs
  FROM public.movimientos
  WHERE caja_id = p_caja_id
    AND COALESCE(estado, '') NOT IN ('anulado', 'revertido');

  IF v_saldo <> 0 THEN
    RAISE EXCEPTION
      'caja_con_saldo: la caja tiene saldo $%. Para eliminarla, primero hacé una transferencia a otra caja.',
      v_saldo
      USING ERRCODE = '22023';
  END IF;

  -- Saldo es 0 pero pueden quedar movimientos históricos. Si hay movimientos,
  -- bloqueamos por seguridad histórica: el dato de cajas se referencia en
  -- reportes y balances. Sugerimos archivar en su lugar.
  IF v_n_movs > 0 THEN
    RAISE EXCEPTION
      'caja_con_historial: la caja tiene % movimientos históricos. No se puede eliminar (rompería el balance histórico). Archivá la caja en lugar de eliminarla.',
      v_n_movs
      USING ERRCODE = '22023';
  END IF;

  -- Sin movimientos y sin saldo → safe to delete.
  DELETE FROM public.cajas WHERE id = p_caja_id;
  RETURN p_caja_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.fz_caja_eliminar(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fz_caja_eliminar(uuid) TO authenticated;

COMMENT ON FUNCTION public.fz_caja_eliminar IS
  'JL-CAJA #2 · hard delete con check de saldo (≠ 0 bloquea + pide transferencia previa) y check de historial (si tiene movs, sugiere archivar).';

-- ============================================================================
-- (3) NUEVA RPC fz_caja_marcar_default — set 1 + unset todos los demás en tx
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fz_caja_marcar_default(
  p_caja_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_existe boolean;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Sólo gerencia puede marcar cajas como default' USING ERRCODE = '42501';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.cajas WHERE id = p_caja_id AND activo = true) INTO v_existe;
  IF NOT v_existe THEN
    RAISE EXCEPTION 'Caja no encontrada o archivada' USING ERRCODE = 'P0002';
  END IF;

  -- Unset todas las demás primero (single-tenant → solo 1 caja default).
  UPDATE public.cajas SET es_default = false, updated_at = now()
   WHERE es_default = true AND id <> p_caja_id;

  -- Set ésta.
  UPDATE public.cajas SET es_default = true, updated_at = now()
   WHERE id = p_caja_id;

  RETURN p_caja_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.fz_caja_marcar_default(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fz_caja_marcar_default(uuid) TO authenticated;

COMMENT ON FUNCTION public.fz_caja_marcar_default IS
  'JL-CAJA #3 · setea es_default=true en una caja y desmarca las demás en transacción.';
