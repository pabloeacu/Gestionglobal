-- ============================================================================
-- 0005_ctacte_finanzas · cajas + categorias_finanzas + movimientos +
-- movimiento_imputaciones (corazón contable con XOR comprobante/admin e
-- invariante saldo_pendiente derivado, no almacenado).
-- Cita el bagaje: doc 03 §1, §4 (PACs · invariante SUM imputaciones == monto),
-- E48 (FK con índice), E50 (defensa naturaleza ingreso/egreso 3 capas), D09,
-- D10 (auditoría día 1).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- cajas · bancos, billeteras, plazo fijo, efectivo (pto 18 Documento Maestro)
-- ---------------------------------------------------------------------------
CREATE TABLE public.cajas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL UNIQUE,
  tipo text NOT NULL CHECK (tipo IN ('banco','billetera_virtual','plazo_fijo','efectivo')),
  moneda text NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS','USD')),
  cbu text,
  alias text,
  numero_cuenta text,
  banco_entidad text,
  color text,
  icono text,
  orden int NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  observaciones text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_cajas_activo_orden ON public.cajas(activo, orden);

CREATE TRIGGER trg_cajas_touch
  BEFORE UPDATE ON public.cajas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_cajas_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.cajas
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- Seed default (doc 03 §5.1)
INSERT INTO public.cajas (nombre, tipo, orden) VALUES
  ('Banco principal',     'banco',              10),
  ('Billetera virtual',   'billetera_virtual',  20),
  ('Plazo fijo',          'plazo_fijo',         30),
  ('Efectivo',            'efectivo',           40)
ON CONFLICT (nombre) DO NOTHING;

-- ---------------------------------------------------------------------------
-- categorias_finanzas · categorización contable de movimientos
-- ---------------------------------------------------------------------------
CREATE TABLE public.categorias_finanzas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL UNIQUE,
  tipo text NOT NULL CHECK (tipo IN ('ingreso','egreso','ambos')),
  color text,
  icono text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TRIGGER trg_categorias_finanzas_touch
  BEFORE UPDATE ON public.categorias_finanzas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed mínimo
INSERT INTO public.categorias_finanzas (nombre, tipo) VALUES
  ('Cobranza servicios', 'ingreso'),
  ('Ingreso vario',      'ingreso'),
  ('Gastos bancarios',   'egreso'),
  ('Sueldos',            'egreso'),
  ('Honorarios',         'egreso'),
  ('Servicios públicos', 'egreso'),
  ('Insumos',            'egreso'),
  ('Impuestos',          'egreso'),
  ('Transferencia',      'ambos'),
  ('Ajuste',             'ambos')
ON CONFLICT (nombre) DO NOTHING;

-- ---------------------------------------------------------------------------
-- movimientos · cada flujo de dinero por una caja. monto siempre POSITIVO;
-- la dirección la define `tipo`.
-- ---------------------------------------------------------------------------
CREATE TABLE public.movimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caja_id uuid NOT NULL REFERENCES public.cajas(id) ON DELETE RESTRICT,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  tipo text NOT NULL CHECK (tipo IN
    ('ingreso','egreso','transferencia_in','transferencia_out')),
  monto numeric(14,2) NOT NULL CHECK (monto > 0),
  categoria_id uuid REFERENCES public.categorias_finanzas(id) ON DELETE SET NULL,
  descripcion text,
  referencia text,
  adjunto_url text,

  -- Vínculos opcionales con clientes / comprobantes
  administracion_id uuid REFERENCES public.administraciones(id) ON DELETE SET NULL,
  consorcio_id uuid REFERENCES public.consorcios(id) ON DELETE SET NULL,
  comprobante_id uuid REFERENCES public.comprobantes(id) ON DELETE RESTRICT,

  -- Transferencias entre cajas (2 patas atadas)
  transferencia_pair_id uuid,

  -- Dedup conciliación bancaria
  hash_dedup text,

  estado text NOT NULL DEFAULT 'identificado'
    CHECK (estado IN ('pendiente_id','identificado','anulado')),
  motivo_pendiente text,

  origen text NOT NULL DEFAULT 'manual' CHECK (origen IN
    ('manual','conciliacion_auto','facturacion','ajuste',
     'historico_banco','transferencia','reversion')),

  -- Trazabilidad de reversión (contrasiento — pto 18)
  movimiento_revertido_id uuid REFERENCES public.movimientos(id) ON DELETE SET NULL,
  revertido_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_mov_caja_fecha
  ON public.movimientos(caja_id, fecha DESC);
CREATE INDEX idx_mov_admin
  ON public.movimientos(administracion_id, fecha DESC)
  WHERE administracion_id IS NOT NULL;
CREATE INDEX idx_mov_consorcio
  ON public.movimientos(consorcio_id) WHERE consorcio_id IS NOT NULL;
CREATE INDEX idx_mov_comprobante
  ON public.movimientos(comprobante_id) WHERE comprobante_id IS NOT NULL;
CREATE INDEX idx_mov_transferencia
  ON public.movimientos(transferencia_pair_id)
  WHERE transferencia_pair_id IS NOT NULL;
CREATE INDEX idx_mov_pendientes
  ON public.movimientos(fecha DESC) WHERE estado = 'pendiente_id';
CREATE UNIQUE INDEX uq_mov_hash_dedup
  ON public.movimientos(hash_dedup) WHERE hash_dedup IS NOT NULL;

CREATE TRIGGER trg_mov_touch
  BEFORE UPDATE ON public.movimientos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_mov_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.movimientos
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- ---------------------------------------------------------------------------
-- movimiento_imputaciones · cómo se distribuye un movimiento entre
-- comprobantes y/o crédito a admin (PACs). Invariante:
--   SUM(imputaciones del mov) <= movimiento.monto  (validación blanda;
--   el contable se mantiene con triggers en saldo_pendiente).
-- XOR estricto: el destino es comprobante O administración, nunca ambos.
-- ---------------------------------------------------------------------------
CREATE TABLE public.movimiento_imputaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movimiento_id uuid NOT NULL
    REFERENCES public.movimientos(id) ON DELETE CASCADE,
  comprobante_id uuid REFERENCES public.comprobantes(id) ON DELETE RESTRICT,
  administracion_id uuid REFERENCES public.administraciones(id) ON DELETE RESTRICT,
  monto_imputado numeric(14,2) NOT NULL CHECK (monto_imputado > 0),
  nota text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT chk_imp_destino_xor CHECK (
    (comprobante_id IS NOT NULL AND administracion_id IS NULL)
    OR (comprobante_id IS NULL AND administracion_id IS NOT NULL)
  )
);

CREATE INDEX idx_imp_movimiento ON public.movimiento_imputaciones(movimiento_id);
CREATE INDEX idx_imp_comprobante
  ON public.movimiento_imputaciones(comprobante_id)
  WHERE comprobante_id IS NOT NULL;
CREATE INDEX idx_imp_admin
  ON public.movimiento_imputaciones(administracion_id, created_at DESC)
  WHERE administracion_id IS NOT NULL;

CREATE TRIGGER trg_imp_touch
  BEFORE UPDATE ON public.movimiento_imputaciones
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Trigger: recalcular saldo_pendiente y estado_cobranza del comprobante
-- cuando cambian sus imputaciones (D09 + pto 17 Documento Maestro).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalcular_saldo_comprobante_imputado()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_total numeric;
  v_imputado numeric;
  v_estado text;
  v_estado_cob text;
  v_today date := CURRENT_DATE;
  v_venc date;
BEGIN
  v_id := COALESCE(NEW.comprobante_id, OLD.comprobante_id);
  IF v_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT total, estado, vencimiento INTO v_total, v_estado, v_venc
    FROM public.comprobantes WHERE id = v_id;

  SELECT COALESCE(SUM(monto_imputado), 0) INTO v_imputado
    FROM public.movimiento_imputaciones
   WHERE comprobante_id = v_id;

  v_estado_cob := CASE
    WHEN v_estado = 'anulado' THEN 'anulado'
    WHEN v_imputado >= v_total THEN 'pagado'
    WHEN v_imputado > 0 THEN 'parcial'
    WHEN v_venc IS NOT NULL AND v_venc < v_today THEN 'vencido'
    ELSE 'pendiente'
  END;

  UPDATE public.comprobantes SET
    saldo_pendiente = GREATEST(0, v_total - v_imputado),
    estado_cobranza = v_estado_cob
  WHERE id = v_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.recalcular_saldo_comprobante_imputado()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_imp_recalcular_saldo
  AFTER INSERT OR UPDATE OR DELETE ON public.movimiento_imputaciones
  FOR EACH ROW EXECUTE FUNCTION public.recalcular_saldo_comprobante_imputado();

-- ---------------------------------------------------------------------------
-- Vista cajas_con_saldo · saldo de cada caja a partir de movimientos
-- identificados (doc 03 §5.2).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cajas_con_saldo AS
SELECT
  c.id AS caja_id,
  c.nombre, c.tipo, c.moneda, c.color, c.icono, c.orden, c.activo,
  COALESCE(SUM(CASE
    WHEN m.estado = 'identificado' THEN
      CASE WHEN m.tipo IN ('ingreso','transferencia_in') THEN m.monto
           WHEN m.tipo IN ('egreso','transferencia_out') THEN -m.monto
           ELSE 0
      END
    ELSE 0
  END), 0) AS saldo,
  COUNT(*) FILTER (WHERE m.estado = 'pendiente_id') AS movs_pendientes
FROM public.cajas c
LEFT JOIN public.movimientos m ON m.caja_id = c.id
GROUP BY c.id, c.nombre, c.tipo, c.moneda, c.color, c.icono, c.orden, c.activo;

-- La vista hereda RLS de las tablas subyacentes; no necesita policy propia.

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.cajas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cajas_select_staff ON public.cajas;
CREATE POLICY cajas_select_staff ON public.cajas
  FOR SELECT TO authenticated USING (private.is_staff());
DROP POLICY IF EXISTS cajas_write_staff ON public.cajas;
CREATE POLICY cajas_write_staff ON public.cajas
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

ALTER TABLE public.categorias_finanzas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS categorias_finanzas_select_staff ON public.categorias_finanzas;
CREATE POLICY categorias_finanzas_select_staff ON public.categorias_finanzas
  FOR SELECT TO authenticated USING (private.is_staff());
DROP POLICY IF EXISTS categorias_finanzas_write_gerente ON public.categorias_finanzas;
CREATE POLICY categorias_finanzas_write_gerente ON public.categorias_finanzas
  FOR ALL TO authenticated
  USING (private.is_gerente()) WITH CHECK (private.is_gerente());

ALTER TABLE public.movimientos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS movimientos_select_staff ON public.movimientos;
CREATE POLICY movimientos_select_staff ON public.movimientos
  FOR SELECT TO authenticated USING (private.is_staff());
DROP POLICY IF EXISTS movimientos_write_staff ON public.movimientos;
CREATE POLICY movimientos_write_staff ON public.movimientos
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

ALTER TABLE public.movimiento_imputaciones ENABLE ROW LEVEL SECURITY;
-- staff ve todo · administrador ve las imputaciones de sus propios comprobantes
DROP POLICY IF EXISTS imp_select ON public.movimiento_imputaciones;
CREATE POLICY imp_select ON public.movimiento_imputaciones
  FOR SELECT TO authenticated USING (
    private.is_staff()
    OR EXISTS (
      SELECT 1 FROM public.comprobantes c
      WHERE c.id = comprobante_id
        AND private.is_administrador()
        AND c.administracion_id = private.current_administracion_id()
    )
    OR (private.is_administrador()
        AND administracion_id = private.current_administracion_id())
  );
DROP POLICY IF EXISTS imp_write_staff ON public.movimiento_imputaciones;
CREATE POLICY imp_write_staff ON public.movimiento_imputaciones
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());
