-- ============================================================================
-- 0028_partners · Subsistema 6 (Documento Maestro): Partners + rendiciones
-- (caso Funplata).
--
-- Modelo de negocio:
-- - Un partner externo aporta clientes/proyectos al ecosistema Gestión Global.
-- - El convenio fija % de ingresos a rendir al partner y % de costos que el
--   partner soporta sobre la línea atribuible.
-- - Periódicamente se cierra una rendición: ∑ingresos × %ing − ∑costos × %cost
--   = neto a pagar/cobrar al partner. Se asocia a un comprobante (NC o factura).
--
-- Decisiones (regla 1, decisión 2026-05-19, regla 12):
-- - Single-tenant: NO empresa_id. Eje siempre = administracion del comprobante
--   o movimiento (no del partner).
-- - Atribución es polimórfica: comprobante_id XOR movimiento_id (CHECK).
-- - Se agrega movimientos.partner_id_atribucion (nullable). Default NULL para
--   no perturbar la contabilidad ni el FK index existente. Cuando un movimiento
--   tiene partner_id_atribucion seteado y categoria.tipo='egreso', la RPC lo
--   incluye en la rendición del periodo como costo del partner.
-- - partner_rendiciones.neto: GENERATED ALWAYS STORED (consistencia y query).
-- - RLS: solo staff (los partners no se loguean a la plataforma).
-- - Trigger bloquea ediciones de montos en rendiciones cerradas/pagadas.
-- - FK indexes (regla 11). Toda RPC SECURITY DEFINER, search_path fijado
--   (regla 5).
-- - Seed: partner Funplata + convenio 30/30% vigente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- partners · entidad legal del partner
-- ---------------------------------------------------------------------------
CREATE TABLE public.partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  nombre_legal text NOT NULL,
  cuit text,
  condicion_iva text
    CHECK (condicion_iva IS NULL OR condicion_iva IN (
      'responsable_inscripto','monotributo','exento','consumidor_final','no_alcanzado'
    )),
  email text,
  telefono text,
  domicilio text,
  activo boolean NOT NULL DEFAULT true,
  observaciones text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_partners_activo ON public.partners(activo);
CREATE INDEX idx_partners_created_by
  ON public.partners(created_by) WHERE created_by IS NOT NULL;

CREATE TRIGGER trg_partners_touch
  BEFORE UPDATE ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_partners_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- ---------------------------------------------------------------------------
-- partner_convenios · vigencia + porcentajes
-- ---------------------------------------------------------------------------
CREATE TABLE public.partner_convenios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL
    REFERENCES public.partners(id) ON DELETE CASCADE,
  vigencia_desde date NOT NULL,
  vigencia_hasta date,
  porc_ingresos numeric(5,2) NOT NULL
    CHECK (porc_ingresos >= 0 AND porc_ingresos <= 100),
  porc_costos numeric(5,2) NOT NULL
    CHECK (porc_costos >= 0 AND porc_costos <= 100),
  moneda text NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS','USD')),
  activo boolean NOT NULL DEFAULT true,
  observaciones text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT chk_convenio_vigencia
    CHECK (vigencia_hasta IS NULL OR vigencia_hasta >= vigencia_desde)
);

CREATE INDEX idx_pconv_partner
  ON public.partner_convenios(partner_id);
CREATE INDEX idx_pconv_partner_vigente
  ON public.partner_convenios(partner_id, vigencia_desde DESC)
  WHERE activo;
CREATE INDEX idx_pconv_created_by
  ON public.partner_convenios(created_by) WHERE created_by IS NOT NULL;

CREATE TRIGGER trg_pconv_touch
  BEFORE UPDATE ON public.partner_convenios
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_pconv_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.partner_convenios
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- ---------------------------------------------------------------------------
-- movimientos.partner_id_atribucion · vincula un egreso a la línea del partner
-- ---------------------------------------------------------------------------
ALTER TABLE public.movimientos
  ADD COLUMN partner_id_atribucion uuid
    REFERENCES public.partners(id) ON DELETE SET NULL;

CREATE INDEX idx_mov_partner_atribucion
  ON public.movimientos(partner_id_atribucion)
  WHERE partner_id_atribucion IS NOT NULL;

COMMENT ON COLUMN public.movimientos.partner_id_atribucion IS
  'Atribuye el movimiento (típicamente egreso) a la línea de un partner. ' ||
  'La RPC partner_crear_rendicion lo lee como costo dentro del periodo.';

-- ---------------------------------------------------------------------------
-- partner_rendiciones · cierre periódico
-- ---------------------------------------------------------------------------
CREATE TABLE public.partner_rendiciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL
    REFERENCES public.partners(id) ON DELETE RESTRICT,
  periodo_desde date NOT NULL,
  periodo_hasta date NOT NULL,
  estado text NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador','cerrada','pagada','cancelada')),
  total_ingresos_brutos numeric(14,2) NOT NULL DEFAULT 0,
  total_ingresos_atribuidos numeric(14,2) NOT NULL DEFAULT 0,
  total_costos_brutos numeric(14,2) NOT NULL DEFAULT 0,
  total_costos_atribuidos numeric(14,2) NOT NULL DEFAULT 0,
  neto numeric(14,2) GENERATED ALWAYS AS
    (total_ingresos_atribuidos - total_costos_atribuidos) STORED,
  comprobante_id uuid REFERENCES public.comprobantes(id) ON DELETE SET NULL,
  cerrada_at timestamptz,
  cerrada_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancelada_at timestamptz,
  cancelada_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  motivo_cancelacion text,
  observaciones text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT chk_rend_periodo
    CHECK (periodo_hasta >= periodo_desde)
);

CREATE INDEX idx_prend_partner
  ON public.partner_rendiciones(partner_id, periodo_desde DESC);
CREATE INDEX idx_prend_estado
  ON public.partner_rendiciones(estado);
CREATE INDEX idx_prend_comprobante
  ON public.partner_rendiciones(comprobante_id) WHERE comprobante_id IS NOT NULL;
CREATE INDEX idx_prend_cerrada_por
  ON public.partner_rendiciones(cerrada_por) WHERE cerrada_por IS NOT NULL;
CREATE INDEX idx_prend_cancelada_por
  ON public.partner_rendiciones(cancelada_por) WHERE cancelada_por IS NOT NULL;
CREATE INDEX idx_prend_created_by
  ON public.partner_rendiciones(created_by) WHERE created_by IS NOT NULL;

CREATE TRIGGER trg_prend_touch
  BEFORE UPDATE ON public.partner_rendiciones
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_prend_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.partner_rendiciones
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- ---------------------------------------------------------------------------
-- partner_atribuciones · línea de detalle de cada rendición / partner
-- (comprobante XOR movimiento)
-- ---------------------------------------------------------------------------
CREATE TABLE public.partner_atribuciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL
    REFERENCES public.partners(id) ON DELETE CASCADE,
  convenio_id uuid NOT NULL
    REFERENCES public.partner_convenios(id) ON DELETE RESTRICT,
  rendicion_id uuid
    REFERENCES public.partner_rendiciones(id) ON DELETE SET NULL,
  comprobante_id uuid REFERENCES public.comprobantes(id) ON DELETE CASCADE,
  movimiento_id uuid REFERENCES public.movimientos(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('ingreso','costo')),
  porcentaje numeric(5,2) NOT NULL
    CHECK (porcentaje >= 0 AND porcentaje <= 100),
  monto_base numeric(14,2) NOT NULL CHECK (monto_base >= 0),
  monto_atribuido numeric(14,2) NOT NULL CHECK (monto_atribuido >= 0),
  observaciones text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT chk_pat_xor CHECK (
    (comprobante_id IS NOT NULL AND movimiento_id IS NULL)
    OR (comprobante_id IS NULL AND movimiento_id IS NOT NULL)
  )
);

CREATE INDEX idx_pat_partner
  ON public.partner_atribuciones(partner_id, tipo);
CREATE INDEX idx_pat_convenio
  ON public.partner_atribuciones(convenio_id);
CREATE INDEX idx_pat_rendicion
  ON public.partner_atribuciones(rendicion_id) WHERE rendicion_id IS NOT NULL;
CREATE INDEX idx_pat_comprobante
  ON public.partner_atribuciones(comprobante_id) WHERE comprobante_id IS NOT NULL;
CREATE INDEX idx_pat_movimiento
  ON public.partner_atribuciones(movimiento_id) WHERE movimiento_id IS NOT NULL;
CREATE INDEX idx_pat_created_by
  ON public.partner_atribuciones(created_by) WHERE created_by IS NOT NULL;

-- Unicidad: un comprobante / movimiento no puede atribuirse dos veces dentro
-- de una misma rendición.
CREATE UNIQUE INDEX uq_pat_rend_comprobante
  ON public.partner_atribuciones(rendicion_id, comprobante_id, tipo)
  WHERE comprobante_id IS NOT NULL AND rendicion_id IS NOT NULL;
CREATE UNIQUE INDEX uq_pat_rend_movimiento
  ON public.partner_atribuciones(rendicion_id, movimiento_id, tipo)
  WHERE movimiento_id IS NOT NULL AND rendicion_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Trigger: bloquear ediciones de rendiciones cerradas/pagadas.
-- Permite sólo cambios de comprobante_id, motivo_cancelacion, observaciones,
-- y la transición estado: cerrada → pagada / cancelada (con metadata).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_rendicion_bloquear_cierre()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.estado IN ('cerrada','pagada') THEN
    -- No se pueden tocar montos ni periodos.
    IF NEW.total_ingresos_brutos      IS DISTINCT FROM OLD.total_ingresos_brutos
       OR NEW.total_ingresos_atribuidos IS DISTINCT FROM OLD.total_ingresos_atribuidos
       OR NEW.total_costos_brutos     IS DISTINCT FROM OLD.total_costos_brutos
       OR NEW.total_costos_atribuidos IS DISTINCT FROM OLD.total_costos_atribuidos
       OR NEW.periodo_desde           IS DISTINCT FROM OLD.periodo_desde
       OR NEW.periodo_hasta           IS DISTINCT FROM OLD.periodo_hasta
       OR NEW.partner_id              IS DISTINCT FROM OLD.partner_id THEN
      RAISE EXCEPTION 'Rendición % está %, no se pueden modificar sus montos ni periodo',
        OLD.id, OLD.estado USING ERRCODE = '42501';
    END IF;
    -- Sólo permitimos transición a 'pagada' o 'cancelada'.
    IF NEW.estado IS DISTINCT FROM OLD.estado
       AND NEW.estado NOT IN ('pagada','cancelada')
       AND OLD.estado = 'cerrada' THEN
      RAISE EXCEPTION 'Transición inválida % → %',
        OLD.estado, NEW.estado USING ERRCODE = '42501';
    END IF;
    IF OLD.estado = 'pagada'
       AND NEW.estado IS DISTINCT FROM OLD.estado
       AND NEW.estado <> 'cancelada' THEN
      RAISE EXCEPTION 'Una rendición pagada sólo puede pasar a cancelada (revertir manualmente)'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.partner_rendicion_bloquear_cierre()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_prend_bloquear_cierre
  BEFORE UPDATE ON public.partner_rendiciones
  FOR EACH ROW EXECUTE FUNCTION public.partner_rendicion_bloquear_cierre();

-- ---------------------------------------------------------------------------
-- RLS · solo staff (los partners no tienen sesión).
-- ---------------------------------------------------------------------------
ALTER TABLE public.partners               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_convenios      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_rendiciones    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_atribuciones   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partners_staff_all ON public.partners;
CREATE POLICY partners_staff_all ON public.partners
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS pconv_staff_all ON public.partner_convenios;
CREATE POLICY pconv_staff_all ON public.partner_convenios
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS prend_staff_all ON public.partner_rendiciones;
CREATE POLICY prend_staff_all ON public.partner_rendiciones
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS pat_staff_all ON public.partner_atribuciones;
CREATE POLICY pat_staff_all ON public.partner_atribuciones
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

-- ---------------------------------------------------------------------------
-- RPC · partner_crear_rendicion
-- Genera una rendición en estado 'borrador' con todas las atribuciones del
-- periodo. La aplica con el convenio vigente del partner para el desde/hasta.
-- Sólo staff (gerencia/operadores) — regla 12.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_crear_rendicion(
  p_partner_id uuid,
  p_desde date,
  p_hasta date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rend_id uuid;
  v_convenio record;
  v_ing_brutos numeric(14,2);
  v_ing_atrib numeric(14,2);
  v_cos_brutos numeric(14,2);
  v_cos_atrib numeric(14,2);
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede crear rendiciones de partner'
      USING ERRCODE = '42501';
  END IF;

  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'Periodo inválido (desde=%, hasta=%)', p_desde, p_hasta
      USING ERRCODE = '22023';
  END IF;

  -- Tomamos el convenio activo vigente para "p_desde" (o el más reciente
  -- vigente en el periodo). Si no hay, error.
  SELECT *
    INTO v_convenio
    FROM public.partner_convenios
   WHERE partner_id = p_partner_id
     AND activo
     AND vigencia_desde <= p_hasta
     AND (vigencia_hasta IS NULL OR vigencia_hasta >= p_desde)
   ORDER BY vigencia_desde DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay convenio activo del partner % en el periodo % – %',
      p_partner_id, p_desde, p_hasta USING ERRCODE = 'P0002';
  END IF;

  -- Crear cabecera en borrador.
  INSERT INTO public.partner_rendiciones (
    partner_id, periodo_desde, periodo_hasta, estado, created_by
  )
  VALUES (
    p_partner_id, p_desde, p_hasta, 'borrador', auth.uid()
  )
  RETURNING id INTO v_rend_id;

  -- Atribuciones de INGRESO: comprobantes autorizados del partner en periodo.
  -- "del partner" = el comprobante pertenece a una administración referida
  -- por el partner — pero no tenemos esa relación en el schema; por defecto
  -- atribuimos TODOS los comprobantes autorizados del periodo que se hayan
  -- marcado vía items_comprobantes.partner_id_atribucion (futuro) o, hasta
  -- entonces, los comprobantes cuyo movimiento de cobranza tenga
  -- partner_id_atribucion = partner. Implementación simple ahora: el operador
  -- los marca vía movimientos.partner_id_atribucion (cobranzas) — por eso
  -- aceptamos también comprobantes que tengan al menos una imputación de
  -- movimientos atribuidos al partner. Conservador y trazable.
  INSERT INTO public.partner_atribuciones (
    partner_id, convenio_id, rendicion_id,
    comprobante_id, movimiento_id,
    tipo, porcentaje, monto_base, monto_atribuido,
    created_by
  )
  SELECT DISTINCT
    p_partner_id, v_convenio.id, v_rend_id,
    c.id, NULL,
    'ingreso',
    v_convenio.porc_ingresos,
    c.total,
    ROUND(c.total * v_convenio.porc_ingresos / 100, 2),
    auth.uid()
  FROM public.comprobantes c
  WHERE c.estado = 'autorizado'
    AND c.fecha BETWEEN p_desde AND p_hasta
    AND c.tipo IN ('A','B','C','X')
    AND EXISTS (
      SELECT 1
        FROM public.movimiento_imputaciones mi
        JOIN public.movimientos m ON m.id = mi.movimiento_id
       WHERE mi.comprobante_id = c.id
         AND m.partner_id_atribucion = p_partner_id
    );

  -- Atribuciones de COSTO: movimientos egreso con partner_id_atribucion
  -- dentro del periodo. Excluimos transferencias y anulados.
  INSERT INTO public.partner_atribuciones (
    partner_id, convenio_id, rendicion_id,
    comprobante_id, movimiento_id,
    tipo, porcentaje, monto_base, monto_atribuido,
    created_by
  )
  SELECT
    p_partner_id, v_convenio.id, v_rend_id,
    NULL, m.id,
    'costo',
    v_convenio.porc_costos,
    m.monto,
    ROUND(m.monto * v_convenio.porc_costos / 100, 2),
    auth.uid()
  FROM public.movimientos m
  WHERE m.partner_id_atribucion = p_partner_id
    AND m.fecha BETWEEN p_desde AND p_hasta
    AND m.tipo = 'egreso'
    AND m.estado <> 'anulado';

  -- Totales en la cabecera (sumamos lo recién insertado).
  SELECT
    COALESCE(SUM(CASE WHEN tipo='ingreso' THEN monto_base END), 0),
    COALESCE(SUM(CASE WHEN tipo='ingreso' THEN monto_atribuido END), 0),
    COALESCE(SUM(CASE WHEN tipo='costo'   THEN monto_base END), 0),
    COALESCE(SUM(CASE WHEN tipo='costo'   THEN monto_atribuido END), 0)
    INTO v_ing_brutos, v_ing_atrib, v_cos_brutos, v_cos_atrib
    FROM public.partner_atribuciones
   WHERE rendicion_id = v_rend_id;

  UPDATE public.partner_rendiciones
     SET total_ingresos_brutos     = v_ing_brutos,
         total_ingresos_atribuidos = v_ing_atrib,
         total_costos_brutos       = v_cos_brutos,
         total_costos_atribuidos   = v_cos_atrib,
         updated_at = now()
   WHERE id = v_rend_id;

  RETURN v_rend_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.partner_crear_rendicion(uuid, date, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_crear_rendicion(uuid, date, date)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC · partner_cerrar_rendicion
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_cerrar_rendicion(
  p_rendicion_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede cerrar rendiciones' USING ERRCODE = '42501';
  END IF;

  SELECT estado INTO v_estado
    FROM public.partner_rendiciones
   WHERE id = p_rendicion_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rendición no encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF v_estado <> 'borrador' THEN
    RAISE EXCEPTION 'Sólo se pueden cerrar rendiciones en borrador (actual: %)', v_estado
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.partner_rendiciones
     SET estado = 'cerrada',
         cerrada_at = now(),
         cerrada_por = auth.uid(),
         updated_at = now()
   WHERE id = p_rendicion_id;

  RETURN p_rendicion_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.partner_cerrar_rendicion(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_cerrar_rendicion(uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC · partner_anular_rendicion  (sólo si está en borrador)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_anular_rendicion(
  p_rendicion_id uuid,
  p_motivo text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede anular rendiciones' USING ERRCODE = '42501';
  END IF;

  IF p_motivo IS NULL OR length(btrim(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'Indicá un motivo de anulación' USING ERRCODE = '22023';
  END IF;

  SELECT estado INTO v_estado
    FROM public.partner_rendiciones
   WHERE id = p_rendicion_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rendición no encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF v_estado <> 'borrador' THEN
    RAISE EXCEPTION 'Sólo se pueden anular rendiciones en borrador (actual: %)', v_estado
      USING ERRCODE = '42501';
  END IF;

  -- Las atribuciones eran creadas por esta rendición — al cancelar borramos
  -- todo el detalle (queda la cabecera con motivo + estado='cancelada').
  -- La próxima rendición recalcula desde cero.
  DELETE FROM public.partner_atribuciones
   WHERE rendicion_id = p_rendicion_id;

  UPDATE public.partner_rendiciones
     SET estado = 'cancelada',
         cancelada_at = now(),
         cancelada_por = auth.uid(),
         motivo_cancelacion = p_motivo,
         updated_at = now()
   WHERE id = p_rendicion_id;

  RETURN p_rendicion_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.partner_anular_rendicion(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_anular_rendicion(uuid, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Seed · Funplata + convenio 30/30%
-- ---------------------------------------------------------------------------
INSERT INTO public.partners (slug, nombre_legal, cuit, condicion_iva, activo, observaciones)
VALUES (
  'funplata',
  'Funplata S.A.',
  '30-00000000-0',
  'responsable_inscripto',
  true,
  'Partner fundacional (placeholder). Reemplazar CUIT y datos legales reales.'
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.partner_convenios (
  partner_id, vigencia_desde, vigencia_hasta,
  porc_ingresos, porc_costos, moneda, activo, observaciones
)
SELECT p.id, CURRENT_DATE, NULL, 30.00, 30.00, 'ARS', true,
  'Convenio fundacional 30% ingresos / 30% costos.'
  FROM public.partners p
 WHERE p.slug = 'funplata'
   AND NOT EXISTS (
     SELECT 1 FROM public.partner_convenios pc
      WHERE pc.partner_id = p.id AND pc.activo
   );
