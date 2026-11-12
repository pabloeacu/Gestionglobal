-- 0685 · DGG-249 · Egresos-obligación: el fundamento (tablas + triggers + RPCs).
--
-- Simetría con el modelo de ingresos (comprobante↔movimiento↔imputación) para
-- los EGRESOS: una obligación de pago de GG que puede, en el mismo acto, pagarse
-- total / parcial / quedar impaga (pasivo). Decisiones de Pablo (2026-11-12):
-- simetría completa · total interno (sin IVA/ARCA) · partner devengado+transparente
-- · sin backfill de los 128 egresos cash existentes.
--
-- QUIRÚRGICO Y AISLADO (premisa sagrada: no romper los asientos de ingresos):
-- entidad y camino de imputación PROPIOS. NO se reusa `comprobantes` (acoplado a
-- ARCA/receptor/fiscal) ni `movimiento_imputaciones` (su trigger recalcular_saldo
-- es TIPO-CIEGO: suma por comprobante_id sin mirar el tipo → un egreso ahí
-- corrompería el saldo de los ingresos). El único toque a lo existente es ampliar
-- (aditivo) el CHECK de movimientos.origen con 'pago_egreso'. El flujo de ingresos
-- y las guardas ingreso-only quedan 100% intactos.
--
-- El pago de una obligación SÍ emite un `movimientos tipo='egreso'` (toca caja, como
-- cualquier egreso) — así los reportes de CAJA lo ven. La obligación IMPAGA no toca
-- `movimientos` (igual que un comprobante devengado no toca caja), para no duplicar
-- el egreso al pagarlo. El pasivo y la rentabilidad devengada se leen de `egresos`.

-- ── (1) Ampliar (aditivo) el CHECK de origen: nuevo origen 'pago_egreso'.
ALTER TABLE public.movimientos DROP CONSTRAINT movimientos_origen_check;
ALTER TABLE public.movimientos ADD CONSTRAINT movimientos_origen_check
  CHECK (origen = ANY (ARRAY['manual','conciliacion_auto','facturacion','ajuste',
    'historico_banco','transferencia','reversion','historico_masivo','derivacion_gestoria',
    'pago_egreso']));

-- ── (2) Entidad: obligación de egreso (pasivo de GG).
CREATE TABLE public.egresos (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha                  date NOT NULL DEFAULT CURRENT_DATE,     -- devengamiento
  vencimiento            date,                                   -- fecha límite de pago (nullable)
  proveedor_nombre       text NOT NULL,                          -- acreedor (docente/proveedor)
  proveedor_id           uuid REFERENCES public.proveedores_frecuentes(id) ON DELETE SET NULL,
  concepto               text NOT NULL,
  categoria_id           uuid REFERENCES public.categorias_finanzas(id) ON DELETE SET NULL,
  total                  numeric(14,2) NOT NULL CHECK (total > 0),
  saldo_pendiente        numeric(14,2) NOT NULL DEFAULT 0 CHECK (saldo_pendiente >= 0),
  estado_pago            text NOT NULL DEFAULT 'pendiente'
                           CHECK (estado_pago IN ('pendiente','parcial','pagado','anulado')),
  estado                 text NOT NULL DEFAULT 'activo'
                           CHECK (estado IN ('activo','anulado')),
  administracion_id      uuid REFERENCES public.administraciones(id) ON DELETE SET NULL,  -- nullable: gasto de la casa
  consorcio_id           uuid REFERENCES public.consorcios(id) ON DELETE SET NULL,
  partner_id_atribucion  uuid REFERENCES public.partners(id) ON DELETE SET NULL,          -- costo devengado del partner
  curso_id               uuid REFERENCES public.cursos(id) ON DELETE SET NULL,            -- gasto de un curso (docente)
  tramite_id             uuid REFERENCES public.tramites(id) ON DELETE SET NULL,
  origen                 text NOT NULL DEFAULT 'manual',
  observaciones          text,
  motivo_anulacion       text,
  anulado_at             timestamptz,
  anulado_por            uuid,
  idempotency_key        uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid
);
CREATE UNIQUE INDEX uq_egresos_idempotency_key ON public.egresos (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_egresos_partner   ON public.egresos (partner_id_atribucion) WHERE partner_id_atribucion IS NOT NULL;
CREATE INDEX ix_egresos_admin     ON public.egresos (administracion_id) WHERE administracion_id IS NOT NULL;
CREATE INDEX ix_egresos_curso     ON public.egresos (curso_id) WHERE curso_id IS NOT NULL;
CREATE INDEX ix_egresos_tramite   ON public.egresos (tramite_id) WHERE tramite_id IS NOT NULL;
CREATE INDEX ix_egresos_categoria ON public.egresos (categoria_id);
CREATE INDEX ix_egresos_proveedor ON public.egresos (proveedor_id);
CREATE INDEX ix_egresos_pasivo    ON public.egresos (estado, estado_pago) WHERE estado='activo' AND saldo_pendiente > 0;

ALTER TABLE public.egresos ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.egresos TO authenticated;
CREATE POLICY egresos_staff_all ON public.egresos FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

-- ── (3) Imputación propia pago↔obligación (AISLADA de movimiento_imputaciones).
CREATE TABLE public.egreso_pagos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  egreso_id     uuid NOT NULL REFERENCES public.egresos(id) ON DELETE RESTRICT,
  movimiento_id uuid NOT NULL REFERENCES public.movimientos(id) ON DELETE CASCADE,
  monto_pagado  numeric(14,2) NOT NULL CHECK (monto_pagado > 0),
  nota          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid
);
CREATE INDEX ix_egreso_pagos_egreso ON public.egreso_pagos (egreso_id);
CREATE INDEX ix_egreso_pagos_mov    ON public.egreso_pagos (movimiento_id);

ALTER TABLE public.egreso_pagos ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.egreso_pagos TO authenticated;
CREATE POLICY egreso_pagos_staff_all ON public.egreso_pagos FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

-- ── (4) Trigger: inicializa saldo_pendiente=total al crear la obligación.
CREATE OR REPLACE FUNCTION public.egreso_init_saldo()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $function$
BEGIN
  NEW.saldo_pendiente := NEW.total;
  IF NEW.estado = 'anulado' THEN NEW.estado_pago := 'anulado';
  ELSE NEW.estado_pago := 'pendiente'; END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_egreso_init_saldo BEFORE INSERT ON public.egresos
  FOR EACH ROW EXECUTE FUNCTION public.egreso_init_saldo();

-- ── (5) EL CORAZÓN (espejo de recalcular_saldo_comprobante_imputado): deriva
--        saldo_pendiente + estado_pago desde las imputaciones de pago. MISMA fórmula
--        que el lado ingreso: saldo = GREATEST(0, total − Σpagado). 'vencido' NO se
--        persiste (se deriva en lectura). Keyed por egreso_id (NUNCA toca comprobantes).
CREATE OR REPLACE FUNCTION public.egreso_recalcular_saldo()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_id uuid; v_total numeric; v_pagado numeric; v_estado text; v_estado_pago text;
BEGIN
  v_id := COALESCE(NEW.egreso_id, OLD.egreso_id);
  IF v_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT total, estado INTO v_total, v_estado FROM public.egresos WHERE id = v_id;
  SELECT COALESCE(SUM(monto_pagado), 0) INTO v_pagado FROM public.egreso_pagos WHERE egreso_id = v_id;
  v_estado_pago := CASE
    WHEN v_estado = 'anulado' THEN 'anulado'
    WHEN v_pagado >= v_total THEN 'pagado'
    WHEN v_pagado > 0 THEN 'parcial'
    ELSE 'pendiente'
  END;
  UPDATE public.egresos
     SET saldo_pendiente = GREATEST(0, v_total - v_pagado),
         estado_pago = v_estado_pago,
         updated_at = now()
   WHERE id = v_id;
  RETURN COALESCE(NEW, OLD);
END $function$;
CREATE TRIGGER trg_egreso_pago_recalc AFTER INSERT OR UPDATE OR DELETE ON public.egreso_pagos
  FOR EACH ROW EXECUTE FUNCTION public.egreso_recalcular_saldo();

-- ── (6) Guardas de tope (espejo de las 2 validaciones de ingreso).
--        (a) Σ pagado de una obligación ≤ su total. (b) Σ pagado por un movimiento ≤ su monto.
CREATE OR REPLACE FUNCTION public.egreso_pago_validar_topes()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_total numeric; v_sum_eg numeric; v_monto_mov numeric; v_sum_mov numeric;
BEGIN
  SELECT total INTO v_total FROM public.egresos WHERE id = NEW.egreso_id FOR UPDATE;
  SELECT COALESCE(SUM(monto_pagado),0) INTO v_sum_eg FROM public.egreso_pagos
    WHERE egreso_id = NEW.egreso_id AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  IF v_sum_eg + NEW.monto_pagado > v_total + 0.001 THEN
    RAISE EXCEPTION 'El pago (Σ %) supera el total de la obligación (%).', v_sum_eg + NEW.monto_pagado, v_total
      USING ERRCODE = '23514';
  END IF;

  SELECT monto INTO v_monto_mov FROM public.movimientos WHERE id = NEW.movimiento_id;
  SELECT COALESCE(SUM(monto_pagado),0) INTO v_sum_mov FROM public.egreso_pagos
    WHERE movimiento_id = NEW.movimiento_id AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  IF v_sum_mov + NEW.monto_pagado > v_monto_mov + 0.001 THEN
    RAISE EXCEPTION 'El pago imputado (Σ %) supera el monto del movimiento (%).', v_sum_mov + NEW.monto_pagado, v_monto_mov
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_egreso_pago_topes BEFORE INSERT OR UPDATE ON public.egreso_pagos
  FOR EACH ROW EXECUTE FUNCTION public.egreso_pago_validar_topes();

-- ── (7) RPC: registrar un pago contra una obligación (crea movimiento egreso + imputación).
--        Espejo de registrar_cobranza_comprobante (tipo='egreso', origen='pago_egreso').
CREATE OR REPLACE FUNCTION public.registrar_pago_egreso(
  p_egreso_id uuid, p_caja_id uuid, p_fecha date, p_monto numeric,
  p_descripcion text DEFAULT NULL, p_referencia text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_eg public.egresos%ROWTYPE; v_mov_id uuid; v_desc text; v_existing uuid;
BEGIN
  IF private.is_staff() IS NOT TRUE THEN
    RAISE EXCEPTION 'Solo gerencia/operación puede registrar pagos de egreso' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.movimientos WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;
  p_monto := round(p_monto, 2);
  IF p_monto IS NULL OR NOT (p_monto > 0) THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0 (recibido: %)', p_monto;
  END IF;
  SELECT * INTO v_eg FROM public.egresos WHERE id = p_egreso_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Obligación de egreso no encontrada'; END IF;
  IF v_eg.estado = 'anulado' THEN RAISE EXCEPTION 'No se puede pagar una obligación anulada'; END IF;
  IF p_monto > v_eg.saldo_pendiente THEN
    RAISE EXCEPTION 'El monto (%) supera el saldo pendiente (%) de la obligación', p_monto, v_eg.saldo_pendiente;
  END IF;

  v_desc := COALESCE(NULLIF(trim(p_descripcion), ''),
                     'Pago · ' || v_eg.proveedor_nombre || ' · ' || left(v_eg.concepto, 80));

  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, categoria_id, descripcion, referencia,
    administracion_id, consorcio_id, estado, origen, created_by, partner_id_atribucion, idempotency_key
  ) VALUES (
    p_caja_id, p_fecha, 'egreso', p_monto, v_eg.categoria_id, v_desc, NULLIF(trim(p_referencia), ''),
    v_eg.administracion_id, v_eg.consorcio_id, 'identificado', 'pago_egreso', auth.uid(),
    v_eg.partner_id_atribucion, p_idempotency_key
  ) RETURNING id INTO v_mov_id;

  INSERT INTO public.egreso_pagos (egreso_id, movimiento_id, monto_pagado, created_by)
  VALUES (p_egreso_id, v_mov_id, p_monto, auth.uid());

  RETURN v_mov_id;
EXCEPTION WHEN unique_violation THEN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.movimientos WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;
  RAISE;
END $function$;
GRANT EXECUTE ON FUNCTION public.registrar_pago_egreso(uuid,uuid,date,numeric,text,text,uuid) TO authenticated;

-- ── (8) RPC: emitir una obligación de egreso, con pago opcional EN EL MISMO ACTO (atómico).
CREATE OR REPLACE FUNCTION public.emitir_egreso(
  p_proveedor_nombre text, p_concepto text, p_total numeric,
  p_fecha date DEFAULT CURRENT_DATE, p_vencimiento date DEFAULT NULL,
  p_categoria_id uuid DEFAULT NULL, p_proveedor_id uuid DEFAULT NULL,
  p_administracion_id uuid DEFAULT NULL, p_consorcio_id uuid DEFAULT NULL,
  p_partner_id_atribucion uuid DEFAULT NULL, p_curso_id uuid DEFAULT NULL, p_tramite_id uuid DEFAULT NULL,
  p_observaciones text DEFAULT NULL,
  p_pago_caja_id uuid DEFAULT NULL, p_pago_monto numeric DEFAULT NULL, p_pago_fecha date DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_id uuid; v_existing uuid; v_total numeric; v_pago numeric;
BEGIN
  IF private.is_staff() IS NOT TRUE THEN
    RAISE EXCEPTION 'Solo gerencia/operación puede emitir egresos' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.egresos WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;
  v_total := round(p_total, 2);
  IF v_total IS NULL OR NOT (v_total > 0) THEN
    RAISE EXCEPTION 'El total debe ser mayor a 0 (recibido: %)', p_total;
  END IF;
  IF NULLIF(trim(p_proveedor_nombre), '') IS NULL THEN
    RAISE EXCEPTION 'El proveedor/acreedor es obligatorio';
  END IF;
  IF NULLIF(trim(p_concepto), '') IS NULL THEN
    RAISE EXCEPTION 'El concepto es obligatorio';
  END IF;
  IF p_partner_id_atribucion IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.partners WHERE id = p_partner_id_atribucion AND activo) THEN
    RAISE EXCEPTION 'partner_inexistente_o_inactivo' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.egresos (
    fecha, vencimiento, proveedor_nombre, proveedor_id, concepto, categoria_id, total,
    administracion_id, consorcio_id, partner_id_atribucion, curso_id, tramite_id,
    observaciones, origen, idempotency_key, created_by
  ) VALUES (
    COALESCE(p_fecha, CURRENT_DATE), p_vencimiento, trim(p_proveedor_nombre), p_proveedor_id,
    trim(p_concepto), p_categoria_id, v_total,
    p_administracion_id, p_consorcio_id, p_partner_id_atribucion, p_curso_id, p_tramite_id,
    NULLIF(trim(p_observaciones), ''), 'manual', p_idempotency_key, auth.uid()
  ) RETURNING id INTO v_id;

  -- Pago en el mismo acto (atómico): total / parcial. Clamp al total.
  IF p_pago_monto IS NOT NULL AND p_pago_caja_id IS NOT NULL THEN
    v_pago := LEAST(round(p_pago_monto, 2), v_total);
    IF v_pago > 0 THEN
      PERFORM public.registrar_pago_egreso(
        v_id, p_pago_caja_id, COALESCE(p_pago_fecha, p_fecha, CURRENT_DATE), v_pago,
        'Pago en emisión', NULL, NULL);
    END IF;
  END IF;

  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.egresos WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;
  RAISE;
END $function$;
GRANT EXECUTE ON FUNCTION public.emitir_egreso(text,text,numeric,date,date,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,numeric,date,uuid) TO authenticated;

-- ── (9) RPC: anular una obligación (v1: sólo si no tiene pagos; con pagos → revertir primero).
CREATE OR REPLACE FUNCTION public.anular_egreso(p_egreso_id uuid, p_motivo text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_eg public.egresos%ROWTYPE;
BEGIN
  IF private.is_staff() IS NOT TRUE THEN
    RAISE EXCEPTION 'Solo gerencia/operación puede anular egresos' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_eg FROM public.egresos WHERE id = p_egreso_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Obligación de egreso no encontrada'; END IF;
  IF v_eg.estado = 'anulado' THEN RAISE EXCEPTION 'La obligación ya está anulada'; END IF;
  IF v_eg.saldo_pendiente < v_eg.total THEN
    RAISE EXCEPTION 'No se puede anular una obligación con pagos registrados. Revertí el/los pago(s) primero.'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.egresos
     SET estado = 'anulado', estado_pago = 'anulado', saldo_pendiente = 0,
         motivo_anulacion = NULLIF(trim(p_motivo), ''), anulado_at = now(), anulado_por = auth.uid(),
         updated_at = now()
   WHERE id = p_egreso_id;
END $function$;
GRANT EXECUTE ON FUNCTION public.anular_egreso(uuid, text) TO authenticated;
