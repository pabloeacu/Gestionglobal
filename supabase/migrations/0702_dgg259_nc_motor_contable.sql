-- 0702_dgg259_nc_motor_contable.sql
-- =============================================================================
-- DGG-259 · Chunk 1 — Motor contable de las Notas de Crédito (+ fan-out).
--
-- Pedido Pablo: emitir NC (totales/parciales) contra el SALDO PENDIENTE de un
-- comprobante, que lo "compensen". Modelo (ya previsto en el schema): la NC es un
-- comprobante propio (tipo NC_X / NC_A/B/C) con comprobante_referencia_id al
-- original + motivo_nc; TOPE = saldo_pendiente del original; descuenta del saldo del
-- original y aparece como HABER en la cuenta corriente; cuando lo cubre entero el
-- original pasa a estado 'compensado'.
--
-- Decisiones Pablo (AskUserQuestion 2026-11-19):
--   · "Eliminar" simple = anulación con rastro (ya existe anular_comprobante). [sin cambio acá]
--   · Alcance: NC simple (NC_X) completa AHORA; NC fiscal (NC_A/B/C) estructura-lista pero
--     emisión a ARCA diferida → emitir_nota_credito rebota 'habilitar al activar ARCA' para A/B/C
--     (el motor contable sí es fiscal-ready: trata NC_% de forma uniforme).
--   · "Revertir cobranzas y aplicar NC" (2 casos: anular el pago vs dejar a cuenta) → Chunk 2.
--
-- CONSISTENCIA (verificada con ejemplos): firmar la NC como cargo negativo (haber) en los
-- agregados Y reducir el saldo del original mantiene saldo_actual = deuda_total − saldo_a_favor
-- SIN doble conteo, porque: la NC propia aporta saldo 0 a la deuda, y aporta −total a los cargos.
--
-- Aditivo/seguro: hoy hay 235 comprobantes, todos X, 0 NC, 0 CAE, 0 anulados → para el universo
-- actual el recálculo es idéntico (nc_aplicado=0; estado_cobranza saldo-based == imputado-based).
--
-- R16: emitir_nota_credito es net-new (sin overload). R17: triggers SECURITY DEFINER.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) Fuente ÚNICA de verdad del saldo/estado de un comprobante (NC-aware).
--     NC_%  → crédito: saldo 0, estado_cobranza 'pagado' (inerte), y recomputa su original.
--     otros → saldo = total − cobranzas − NCs vigentes; estado_cobranza saldo-based;
--             estado autorizado↔compensado según cobertura por NC.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.recompute_comprobante_saldo(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  v_tipo text; v_total numeric; v_estado text; v_venc date; v_ref uuid;
  v_imputado numeric; v_nc numeric; v_saldo numeric; v_estado_cob text; v_new_estado text;
  v_today date := CURRENT_DATE;
BEGIN
  SELECT tipo, total, estado, vencimiento, comprobante_referencia_id
    INTO v_tipo, v_total, v_estado, v_venc, v_ref
    FROM public.comprobantes WHERE id = p_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_tipo LIKE 'NC\_%' THEN
    UPDATE public.comprobantes
       SET saldo_pendiente = 0,
           estado_cobranza = CASE WHEN v_estado = 'anulado' THEN 'anulado' ELSE 'pagado' END
     WHERE id = p_id
       AND (saldo_pendiente IS DISTINCT FROM 0
            OR estado_cobranza IS DISTINCT FROM (CASE WHEN v_estado = 'anulado' THEN 'anulado' ELSE 'pagado' END));
    IF v_ref IS NOT NULL THEN
      PERFORM private.recompute_comprobante_saldo(v_ref);
    END IF;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(monto_imputado), 0) INTO v_imputado
    FROM public.movimiento_imputaciones WHERE comprobante_id = p_id;

  SELECT COALESCE(SUM(total), 0) INTO v_nc
    FROM public.comprobantes
   WHERE comprobante_referencia_id = p_id
     AND tipo LIKE 'NC\_%'
     AND estado NOT IN ('anulado', 'borrador');

  v_saldo := GREATEST(0, round(v_total - v_imputado - v_nc, 2));

  v_estado_cob := CASE
    WHEN v_estado = 'anulado'                         THEN 'anulado'
    WHEN v_saldo <= 0                                 THEN 'pagado'
    WHEN v_imputado > 0                               THEN 'parcial'
    WHEN v_venc IS NOT NULL AND v_venc < v_today      THEN 'vencido'
    ELSE 'pendiente'
  END;

  IF v_estado IN ('autorizado', 'compensado') THEN
    v_new_estado := CASE
      WHEN v_nc > 0 AND round(v_imputado + v_nc, 2) >= v_total THEN 'compensado'
      ELSE 'autorizado'
    END;
  ELSE
    v_new_estado := v_estado;
  END IF;

  UPDATE public.comprobantes
     SET saldo_pendiente = v_saldo, estado_cobranza = v_estado_cob, estado = v_new_estado
   WHERE id = p_id
     AND (saldo_pendiente IS DISTINCT FROM v_saldo
          OR estado_cobranza IS DISTINCT FROM v_estado_cob
          OR estado IS DISTINCT FROM v_new_estado);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (2) Los dos triggers que ya mantenían el saldo ahora delegan en la fuente única.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recalcular_saldo_comprobante_imputado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE v_id uuid;
BEGIN
  v_id := COALESCE(NEW.comprobante_id, OLD.comprobante_id);
  IF v_id IS NOT NULL THEN
    PERFORM private.recompute_comprobante_saldo(v_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.recalcular_totales_comprobante()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_id uuid;
BEGIN
  v_id := COALESCE(NEW.comprobante_id, OLD.comprobante_id);
  UPDATE public.comprobantes c SET
    neto       = sub.neto,
    exento     = sub.exento,
    no_gravado = sub.no_gravado,
    iva_21     = sub.iva_21,
    iva_105    = sub.iva_105,
    iva_27     = sub.iva_27,
    total_iva  = sub.total_iva,
    total      = sub.total
  FROM (
    SELECT
      COALESCE(SUM(CASE WHEN alicuota_iva IN ('21','10.5','27','0') THEN subtotal ELSE 0 END), 0) AS neto,
      COALESCE(SUM(CASE WHEN alicuota_iva = 'exento'     THEN subtotal ELSE 0 END), 0) AS exento,
      COALESCE(SUM(CASE WHEN alicuota_iva = 'no_gravado' THEN subtotal ELSE 0 END), 0) AS no_gravado,
      COALESCE(SUM(CASE WHEN alicuota_iva = '21'   THEN iva ELSE 0 END), 0) AS iva_21,
      COALESCE(SUM(CASE WHEN alicuota_iva = '10.5' THEN iva ELSE 0 END), 0) AS iva_105,
      COALESCE(SUM(CASE WHEN alicuota_iva = '27'   THEN iva ELSE 0 END), 0) AS iva_27,
      COALESCE(SUM(iva), 0)   AS total_iva,
      COALESCE(SUM(total), 0) AS total
    FROM public.items_comprobantes WHERE comprobante_id = v_id
  ) sub
  WHERE c.id = v_id;

  PERFORM private.recompute_comprobante_saldo(v_id);
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (3) Cuando nace/cambia/muere una NC, recomputar el comprobante que acredita.
--     (El INSERT inicial trae total=0; el UPDATE OF total tras cargar el ítem — y la
--     anulación vía UPDATE OF estado / el DELETE — disparan el recálculo del original.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.trg_comprobante_nc_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_ref uuid;
BEGIN
  v_ref := COALESCE(NEW.comprobante_referencia_id, OLD.comprobante_referencia_id);
  IF v_ref IS NOT NULL THEN
    PERFORM private.recompute_comprobante_saldo(v_ref);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS trg_comprobante_nc_sync_iu ON public.comprobantes;
CREATE TRIGGER trg_comprobante_nc_sync_iu
AFTER INSERT OR UPDATE OF total, estado, comprobante_referencia_id ON public.comprobantes
FOR EACH ROW WHEN (NEW.tipo LIKE 'NC\_%')
EXECUTE FUNCTION private.trg_comprobante_nc_sync();

DROP TRIGGER IF EXISTS trg_comprobante_nc_sync_del ON public.comprobantes;
CREATE TRIGGER trg_comprobante_nc_sync_del
AFTER DELETE ON public.comprobantes
FOR EACH ROW WHEN (OLD.tipo LIKE 'NC\_%')
EXECUTE FUNCTION private.trg_comprobante_nc_sync();

-- ─────────────────────────────────────────────────────────────────────────────
-- (4) Sync de matrícula: base COBRANZAS (plata recibida), no saldo.
--     Así un comprobante COMPENSADO por NC (saldo 0 pero sin cobro) NO figura "pagado".
--     Para datos sin NC es idéntico (saldo<=0 ⟺ imputado>=total).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.matricula_estado_pago_desde_comprobante(p_comprobante_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_total numeric; v_estado text; v_imputado numeric; v_nuevo text;
BEGIN
  SELECT total, estado INTO v_total, v_estado
    FROM public.comprobantes WHERE id = p_comprobante_id;
  IF NOT FOUND OR v_estado = 'anulado' THEN RETURN; END IF;

  SELECT COALESCE(SUM(monto_imputado), 0) INTO v_imputado
    FROM public.movimiento_imputaciones WHERE comprobante_id = p_comprobante_id;

  v_nuevo := CASE
    WHEN v_imputado >= COALESCE(v_total, 0) AND COALESCE(v_total,0) > 0 THEN 'pago_completo'
    WHEN v_imputado > 0                                                 THEN 'pago_parcial'
    ELSE 'adeudado' END;

  UPDATE public.curso_matriculas cm
     SET estado_pago = v_nuevo
   WHERE cm.estado_pago IS DISTINCT FROM v_nuevo
     AND cm.tramite_id IN (
       SELECT t.id        FROM public.tramites t    WHERE t.comprobante_id = p_comprobante_id
       UNION
       SELECT s.tramite_id FROM public.solicitudes s WHERE s.comprobante_id = p_comprobante_id AND s.tramite_id IS NOT NULL
     );
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (5) RPC de emisión de NC (sanctioned path, con TOPE al saldo). Sólo NC_X por ahora.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.emitir_nota_credito(
  p_comprobante_id uuid, p_monto numeric, p_motivo text, p_fecha date DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  v_orig public.comprobantes%ROWTYPE;
  v_tipo_nc text; v_next int; v_nc_id uuid; v_fecha date; v_monto numeric; v_label text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operación puede emitir notas de crédito' USING ERRCODE = '42501';
  END IF;

  v_monto := round(p_monto, 2);
  IF v_monto IS NULL OR v_monto <= 0 THEN
    RAISE EXCEPTION 'El monto de la nota de crédito debe ser mayor a 0 (recibido: %)', p_monto USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_orig FROM public.comprobantes WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comprobante no encontrado' USING ERRCODE = 'P0002'; END IF;
  PERFORM private.assert_administracion_access(v_orig.administracion_id);

  IF v_orig.tipo NOT IN ('A','B','C','X') THEN
    RAISE EXCEPTION 'Sólo se puede emitir una nota de crédito sobre una factura/comprobante (tipo recibido: %)', v_orig.tipo USING ERRCODE = '22023';
  END IF;
  IF v_orig.estado = 'anulado' THEN
    RAISE EXCEPTION 'El comprobante está anulado' USING ERRCODE = '22023';
  END IF;
  IF v_orig.estado NOT IN ('autorizado','compensado') THEN
    RAISE EXCEPTION 'Sólo se emite nota de crédito sobre un comprobante autorizado (estado actual: %)', v_orig.estado USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_orig.saldo_pendiente, 0) <= 0 THEN
    RAISE EXCEPTION 'El comprobante no tiene saldo pendiente para acreditar. Si querés acreditar un importe ya cobrado, primero revertí la cobranza.' USING ERRCODE = '22023';
  END IF;
  IF v_monto > v_orig.saldo_pendiente THEN
    RAISE EXCEPTION 'La nota de crédito (%) supera el saldo pendiente del comprobante (%). Para acreditar más, primero revertí cobranzas.', v_monto, v_orig.saldo_pendiente USING ERRCODE = '22023';
  END IF;

  -- NC fiscal (A/B/C) requiere emisión a ARCA (dormido) → diferida (decisión Pablo DGG-259).
  IF v_orig.tipo IN ('A','B','C') THEN
    RAISE EXCEPTION 'La nota de crédito fiscal (NC_%) se habilita al activar ARCA. Por ahora sólo NC de comprobantes simples (X).', v_orig.tipo USING ERRCODE = '22023';
  END IF;

  v_tipo_nc := 'NC_' || v_orig.tipo;              -- NC_X
  v_fecha   := COALESCE(p_fecha, hoy_ar());
  v_label   := 's/ ' || v_orig.tipo || ' ' || lpad(v_orig.punto_venta::text, 5, '0') || '-' ||
               COALESCE(lpad(v_orig.numero::text, 8, '0'), 's/n');

  INSERT INTO public.numeradores (punto_venta, tipo, ultimo_numero, updated_at)
  VALUES (v_orig.punto_venta, v_tipo_nc, 1, now())
  ON CONFLICT (punto_venta, tipo) DO UPDATE
    SET ultimo_numero = public.numeradores.ultimo_numero + 1, updated_at = now()
  RETURNING ultimo_numero INTO v_next;

  INSERT INTO public.comprobantes (
    administracion_id, consorcio_id, servicio_id, tipo, punto_venta, numero,
    fecha, periodo, concepto,
    receptor_tipo_documento, receptor_numero_documento, receptor_razon_social,
    receptor_condicion_iva, receptor_domicilio,
    estado, estado_cobranza, comprobante_referencia_id, motivo_nc,
    origen, created_by
  ) VALUES (
    v_orig.administracion_id, v_orig.consorcio_id, v_orig.servicio_id, v_tipo_nc, v_orig.punto_venta, v_next,
    v_fecha, date_trunc('month', v_fecha)::date, v_orig.concepto,
    v_orig.receptor_tipo_documento, v_orig.receptor_numero_documento, v_orig.receptor_razon_social,
    v_orig.receptor_condicion_iva, v_orig.receptor_domicilio,
    'autorizado', 'pagado', p_comprobante_id, NULLIF(trim(p_motivo), ''),
    'manual', auth.uid()
  ) RETURNING id INTO v_nc_id;

  INSERT INTO public.items_comprobantes (comprobante_id, orden, descripcion, cantidad, precio_unitario, bonificacion_porc, alicuota_iva)
  VALUES (v_nc_id, 1, 'Nota de crédito ' || v_label || COALESCE(' — ' || NULLIF(trim(p_motivo), ''), ''), 1, v_monto, 0, '0');

  -- El trigger de items recomputa el total del NC (=monto) + su saldo (0) y, por cascada,
  -- el saldo del comprobante original (lo reduce) y su estado (→ compensado si lo cubre entero).
  RETURN v_nc_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.emitir_nota_credito(uuid, numeric, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emitir_nota_credito(uuid, numeric, text, date) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- (6) FAN-OUT · lectores de la cuenta corriente NC-aware (NC = HABER, no cargo).
-- ─────────────────────────────────────────────────────────────────────────────

-- 6a) Extracto: la NC pasa a renglón HABER (acredita), no DEBE.
CREATE OR REPLACE FUNCTION public.cuenta_corriente_extracto(p_administracion_id uuid, p_desde date, p_hasta date)
 RETURNS TABLE(fecha date, tipo text, descripcion text, debe numeric, haber numeric, saldo numeric, comprobante_id uuid, movimiento_id uuid, imputacion_id uuid, consorcio_nombre text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_saldo_inicial numeric;
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);

  SELECT
    COALESCE((
      SELECT SUM(CASE WHEN c.tipo LIKE 'NC\_%' THEN -c.total ELSE c.total END)
        FROM public.comprobantes c
       WHERE c.administracion_id = p_administracion_id
         AND c.estado NOT IN ('anulado','borrador')
         AND c.fecha < p_desde
    ), 0)
    - COALESCE((
      SELECT SUM(mi.monto_imputado)
        FROM public.movimiento_imputaciones mi
        JOIN public.movimientos m ON m.id = mi.movimiento_id
        JOIN public.comprobantes c ON c.id = mi.comprobante_id
       WHERE c.administracion_id = p_administracion_id
         AND m.fecha < p_desde
         AND m.estado = 'identificado'
         AND m.revertido_at IS NULL
    ), 0)
    - COALESCE((
      SELECT SUM(m.monto - COALESCE(imp.aplicado, 0))
        FROM public.movimientos m
        LEFT JOIN LATERAL (
          SELECT SUM(mi.monto_imputado) AS aplicado
            FROM public.movimiento_imputaciones mi
           WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
        ) imp ON true
       WHERE m.administracion_id = p_administracion_id
         AND m.tipo = 'ingreso'
         AND m.estado = 'identificado'
         AND m.revertido_at IS NULL
         AND m.fecha < p_desde
         AND (m.monto - COALESCE(imp.aplicado, 0)) > 0.001
    ), 0)
  INTO v_saldo_inicial;

  RETURN QUERY
  WITH base AS (
    -- Cargos (facturas/X/ND) — DEBE. Las NC quedan fuera de este bloque (van como haber).
    SELECT
      c.fecha AS b_fecha, 'cargo'::text AS b_tipo, 0::int AS b_tipo_ord,
      (
        c.tipo
        || CASE WHEN c.numero IS NOT NULL
                THEN ' ' || lpad(c.punto_venta::text, 5, '0')
                  || '-' || lpad(c.numero::text, 8, '0') ELSE '' END
        || CASE WHEN det.detalle IS NOT NULL THEN ' · ' || det.detalle ELSE '' END
      ) AS b_descripcion,
      c.total::numeric AS b_debe, 0::numeric AS b_haber,
      c.id AS b_comprobante_id, NULL::uuid AS b_movimiento_id,
      NULL::uuid AS b_imputacion_id, cons.nombre AS b_consorcio_nombre,
      c.created_at::timestamptz AS b_ord
    FROM public.comprobantes c
    LEFT JOIN public.consorcios cons ON cons.id = c.consorcio_id
    LEFT JOIN LATERAL (
      SELECT CASE WHEN length(x.txt) > 160 THEN left(x.txt, 159) || '…' ELSE x.txt END AS detalle
      FROM (
        SELECT NULLIF(trim(COALESCE(
                 (SELECT NULLIF(trim(s.nombre), '') FROM public.servicios s WHERE s.id = c.servicio_id),
                 (SELECT string_agg(d.descripcion, ' + ' ORDER BY d.min_orden)
                    FROM (SELECT NULLIF(trim(ic.descripcion), '') AS descripcion,
                                 MIN(ic.orden) AS min_orden
                            FROM public.items_comprobantes ic
                           WHERE ic.comprobante_id = c.id
                           GROUP BY 1) d
                   WHERE d.descripcion IS NOT NULL),
                 (SELECT NULLIF(trim(t.titulo), '') FROM public.tramites t
                   WHERE t.comprobante_id = c.id
                     AND (t.administracion_id IS NULL OR t.administracion_id = c.administracion_id)
                   ORDER BY t.created_at, t.id LIMIT 1),
                 NULLIF(trim(c.concepto), '')
               )), '') AS txt
      ) x
    ) det ON true
    WHERE c.administracion_id = p_administracion_id
      AND c.estado NOT IN ('anulado','borrador')
      AND c.tipo NOT LIKE 'NC\_%'
      AND c.fecha BETWEEN p_desde AND p_hasta

    UNION ALL

    -- Notas de crédito — HABER (acreditan / compensan).
    SELECT
      c.fecha, 'nota_credito'::text, 3::int,
      (
        c.tipo
        || CASE WHEN c.numero IS NOT NULL
                THEN ' ' || lpad(c.punto_venta::text, 5, '0')
                  || '-' || lpad(c.numero::text, 8, '0') ELSE '' END
        || COALESCE(' · ' || NULLIF(trim(c.motivo_nc), ''), '')
      ),
      0::numeric, c.total::numeric,
      c.id, NULL::uuid, NULL::uuid, cons.nombre, c.created_at::timestamptz
    FROM public.comprobantes c
    LEFT JOIN public.consorcios cons ON cons.id = c.consorcio_id
    WHERE c.administracion_id = p_administracion_id
      AND c.estado NOT IN ('anulado','borrador')
      AND c.tipo LIKE 'NC\_%'
      AND c.fecha BETWEEN p_desde AND p_hasta

    UNION ALL

    -- Cobranzas imputadas — HABER.
    SELECT
      m.fecha, 'abono'::text, 1::int,
      (
        'Cobranza'
        || COALESCE(' · ' || NULLIF(regexp_replace(trim(m.descripcion), '^[Cc]obranza(\s*·\s*|\s+|$)', ''), ''), '')
        || COALESCE(' · ref ' || NULLIF(trim(m.referencia), ''), '')
      ),
      0::numeric, mi.monto_imputado::numeric,
      c.id, m.id, mi.id, cons.nombre, m.created_at::timestamptz
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
    JOIN public.comprobantes c ON c.id = mi.comprobante_id
    LEFT JOIN public.consorcios cons ON cons.id = c.consorcio_id
    WHERE c.administracion_id = p_administracion_id
      AND m.fecha BETWEEN p_desde AND p_hasta
      AND m.estado = 'identificado'
      AND m.revertido_at IS NULL

    UNION ALL

    -- Saldos a favor (ingresos no imputados) — HABER.
    SELECT
      m.fecha, 'saldo_favor'::text, 2::int,
      (
        'Saldo a favor'
        || COALESCE(' · ' || NULLIF(regexp_replace(trim(m.descripcion), '^[Cc]obranza(\s*·\s*|\s+|$)', ''), ''), ' · pago no imputado')
        || COALESCE(' · ref ' || NULLIF(trim(m.referencia), ''), '')
        || COALESCE(' · origen: ' || ori.detalle, '')
      ),
      0::numeric,
      (m.monto - COALESCE(imp.aplicado, 0))::numeric,
      NULL::uuid, m.id, NULL::uuid, NULL::text, m.created_at::timestamptz
    FROM public.movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado
        FROM public.movimiento_imputaciones mi
       WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
    ) imp ON true
    LEFT JOIN LATERAL (
      SELECT CASE WHEN length(x.txt) > 160 THEN left(x.txt, 159) || '…' ELSE x.txt END AS detalle
      FROM (
        SELECT NULLIF(trim(COALESCE(
                 (SELECT NULLIF(trim(s.nombre), '') FROM public.servicios s WHERE s.id = c.servicio_id),
                 (SELECT string_agg(d.descripcion, ' + ' ORDER BY d.min_orden)
                    FROM (SELECT NULLIF(trim(ic.descripcion), '') AS descripcion,
                                 MIN(ic.orden) AS min_orden
                            FROM public.items_comprobantes ic
                           WHERE ic.comprobante_id = c.id
                           GROUP BY 1) d
                   WHERE d.descripcion IS NOT NULL),
                 (SELECT NULLIF(trim(t.titulo), '') FROM public.tramites t
                   WHERE t.comprobante_id = c.id
                     AND (t.administracion_id IS NULL OR t.administracion_id = c.administracion_id)
                   ORDER BY t.created_at, t.id LIMIT 1),
                 NULLIF(trim(c.concepto), '')
               )), '') AS txt
          FROM public.comprobantes c
         WHERE c.id = m.comprobante_id
           AND c.administracion_id = p_administracion_id
      ) x
    ) ori ON true
    WHERE m.administracion_id = p_administracion_id
      AND m.tipo = 'ingreso'
      AND m.estado = 'identificado'
      AND m.revertido_at IS NULL
      AND m.fecha BETWEEN p_desde AND p_hasta
      AND (m.monto - COALESCE(imp.aplicado, 0)) > 0.001
  ),
  ordered AS (
    SELECT base.*,
      row_number() OVER (ORDER BY base.b_fecha ASC, base.b_tipo_ord ASC, base.b_ord ASC) AS rn
    FROM base
  ),
  final_q AS (
    SELECT
      p_desde AS f_fecha, 'saldo_inicial'::text AS f_tipo,
      'Saldo anterior'::text AS f_descripcion,
      0::numeric AS f_debe, 0::numeric AS f_haber, v_saldo_inicial AS f_saldo,
      NULL::uuid AS f_comprobante_id, NULL::uuid AS f_movimiento_id,
      NULL::uuid AS f_imputacion_id, NULL::text AS f_consorcio_nombre,
      0::bigint AS f_sort
    UNION ALL
    SELECT
      o.b_fecha, o.b_tipo, o.b_descripcion, o.b_debe, o.b_haber,
      v_saldo_inicial + SUM(o.b_debe - o.b_haber) OVER (ORDER BY o.rn),
      o.b_comprobante_id, o.b_movimiento_id, o.b_imputacion_id,
      o.b_consorcio_nombre, o.rn::bigint
    FROM ordered o
  )
  SELECT f_fecha, f_tipo, f_descripcion, f_debe, f_haber, f_saldo,
         f_comprobante_id, f_movimiento_id, f_imputacion_id, f_consorcio_nombre
  FROM final_q
  ORDER BY f_sort ASC;
END;
$fn$;

-- 6b) Resumen por administración: cargos firmados (NC negativa) → facturado neto + saldo consistente.
CREATE OR REPLACE FUNCTION public.cuenta_corriente_resumen(p_administracion_id uuid, p_desde date DEFAULT ((hoy_ar() - '1 year'::interval))::date, p_hasta date DEFAULT hoy_ar())
 RETURNS TABLE(saldo_inicial numeric, total_facturado numeric, total_cobrado numeric, saldo_actual numeric, comprobantes_pendientes integer, comprobantes_vencidos integer, deuda_total numeric, saldo_a_favor numeric, proximo_vencimiento date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);
  RETURN QUERY
  WITH
  cargos_prev AS (
    SELECT COALESCE(SUM(CASE WHEN tipo LIKE 'NC\_%' THEN -total ELSE total END), 0) AS x
    FROM public.comprobantes
    WHERE administracion_id = p_administracion_id
      AND estado NOT IN ('anulado','borrador') AND fecha < p_desde
  ),
  abonos_prev AS (
    SELECT COALESCE(SUM(mi.monto_imputado), 0) AS x
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
    JOIN public.comprobantes c ON c.id = mi.comprobante_id
    WHERE c.administracion_id = p_administracion_id
      AND m.fecha < p_desde AND m.estado = 'identificado' AND m.revertido_at IS NULL
  ),
  credito_prev AS (
    SELECT COALESCE(SUM(m.monto - COALESCE(imp.aplicado, 0)), 0) AS x
    FROM public.movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado FROM public.movimiento_imputaciones mi
       WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
    ) imp ON true
    WHERE m.administracion_id = p_administracion_id
      AND m.tipo='ingreso' AND m.estado='identificado' AND m.revertido_at IS NULL
      AND m.fecha < p_desde AND (m.monto - COALESCE(imp.aplicado, 0)) > 0.001
  ),
  cargos_rango AS (
    SELECT COALESCE(SUM(CASE WHEN tipo LIKE 'NC\_%' THEN -total ELSE total END), 0) AS x
    FROM public.comprobantes
    WHERE administracion_id = p_administracion_id
      AND estado NOT IN ('anulado','borrador') AND fecha BETWEEN p_desde AND p_hasta
  ),
  abonos_rango AS (
    SELECT COALESCE(SUM(mi.monto_imputado), 0) AS x
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
    JOIN public.comprobantes c ON c.id = mi.comprobante_id
    WHERE c.administracion_id = p_administracion_id
      AND m.fecha BETWEEN p_desde AND p_hasta
      AND m.estado = 'identificado' AND m.revertido_at IS NULL
  ),
  credito_rango AS (
    SELECT COALESCE(SUM(m.monto - COALESCE(imp.aplicado, 0)), 0) AS x
    FROM public.movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado FROM public.movimiento_imputaciones mi
       WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
    ) imp ON true
    WHERE m.administracion_id = p_administracion_id
      AND m.tipo='ingreso' AND m.estado='identificado' AND m.revertido_at IS NULL
      AND m.fecha BETWEEN p_desde AND p_hasta AND (m.monto - COALESCE(imp.aplicado, 0)) > 0.001
  ),
  credito_actual AS (
    SELECT COALESCE(SUM(m.monto - COALESCE(imp.aplicado, 0)), 0) AS x
    FROM public.movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado FROM public.movimiento_imputaciones mi
       WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
    ) imp ON true
    WHERE m.administracion_id = p_administracion_id
      AND m.tipo='ingreso' AND m.estado='identificado' AND m.revertido_at IS NULL
      AND (m.monto - COALESCE(imp.aplicado, 0)) > 0.001
  ),
  saldos_actuales AS (
    SELECT
      COALESCE(SUM(saldo_pendiente), 0) AS deuda_total,
      COUNT(*) FILTER (WHERE estado_cobranza IN ('pendiente','parcial'))::int AS pendientes,
      COUNT(*) FILTER (
        WHERE estado_cobranza IN ('pendiente','parcial')
          AND vencimiento IS NOT NULL AND vencimiento < current_date
      )::int AS vencidos,
      MIN(vencimiento) FILTER (
        WHERE estado_cobranza IN ('pendiente','parcial') AND vencimiento >= current_date
      ) AS proximo
    FROM public.comprobantes
    WHERE administracion_id = p_administracion_id AND estado NOT IN ('anulado','borrador')
  )
  SELECT
    (cargos_prev.x - abonos_prev.x - credito_prev.x)         AS saldo_inicial,
    cargos_rango.x                                           AS total_facturado,
    abonos_rango.x                                           AS total_cobrado,
    (cargos_prev.x - abonos_prev.x - credito_prev.x
      + cargos_rango.x - abonos_rango.x - credito_rango.x)   AS saldo_actual,
    saldos_actuales.pendientes,
    saldos_actuales.vencidos,
    saldos_actuales.deuda_total,
    credito_actual.x                                         AS saldo_a_favor,
    saldos_actuales.proximo
  FROM cargos_prev, abonos_prev, credito_prev, cargos_rango, abonos_rango,
       credito_rango, credito_actual, saldos_actuales;
END;
$fn$;

-- 6c) Resumen global: cargos firmados (NC negativa).
CREATE OR REPLACE FUNCTION public.cuenta_corriente_resumen_global(p_desde date DEFAULT ((hoy_ar() - '1 year'::interval))::date, p_hasta date DEFAULT hoy_ar())
 RETURNS TABLE(administracion_id uuid, administracion_nombre text, total_facturado numeric, total_cobrado numeric, deuda_total numeric, saldo_a_favor numeric, comprobantes_vencidos integer, comprobantes_pendientes integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede consultar el resumen global';
  END IF;
  RETURN QUERY
  WITH cargos AS (
    SELECT c.administracion_id AS aid,
           SUM(CASE WHEN c.tipo LIKE 'NC\_%' THEN -c.total ELSE c.total END) AS x
    FROM public.comprobantes c
    WHERE c.estado NOT IN ('anulado','borrador') AND c.fecha BETWEEN p_desde AND p_hasta
    GROUP BY c.administracion_id
  ),
  abonos AS (
    SELECT c.administracion_id AS aid, SUM(mi.monto_imputado) AS x
    FROM public.movimiento_imputaciones mi
    JOIN public.movimientos m ON m.id = mi.movimiento_id
    JOIN public.comprobantes c ON c.id = mi.comprobante_id
    WHERE m.fecha BETWEEN p_desde AND p_hasta
      AND m.estado = 'identificado' AND m.revertido_at IS NULL
    GROUP BY c.administracion_id
  ),
  creditos AS (
    SELECT m.administracion_id AS aid, SUM(m.monto - COALESCE(imp.aplicado, 0)) AS x
    FROM public.movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado FROM public.movimiento_imputaciones mi
       WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
    ) imp ON true
    WHERE m.administracion_id IS NOT NULL
      AND m.tipo='ingreso' AND m.estado='identificado' AND m.revertido_at IS NULL
      AND (m.monto - COALESCE(imp.aplicado, 0)) > 0.001
    GROUP BY m.administracion_id
  ),
  deudas AS (
    SELECT c.administracion_id AS aid, SUM(c.saldo_pendiente) AS deuda,
      COUNT(*) FILTER (
        WHERE c.estado_cobranza IN ('pendiente','parcial')
          AND c.vencimiento IS NOT NULL AND c.vencimiento < current_date
      )::int AS vencidos,
      COUNT(*) FILTER (WHERE c.estado_cobranza IN ('pendiente','parcial'))::int AS pendientes
    FROM public.comprobantes c
    WHERE c.estado NOT IN ('anulado','borrador')
    GROUP BY c.administracion_id
  )
  SELECT
    a.id, a.nombre,
    COALESCE(cargos.x, 0)::numeric, COALESCE(abonos.x, 0)::numeric,
    COALESCE(deudas.deuda, 0)::numeric, COALESCE(creditos.x, 0)::numeric,
    COALESCE(deudas.vencidos, 0), COALESCE(deudas.pendientes, 0)
  FROM public.administraciones a
  LEFT JOIN cargos ON cargos.aid = a.id
  LEFT JOIN abonos ON abonos.aid = a.id
  LEFT JOIN creditos ON creditos.aid = a.id
  LEFT JOIN deudas ON deudas.aid = a.id
  WHERE a.activo = true
    AND (COALESCE(cargos.x, 0) <> 0 OR COALESCE(abonos.x, 0) > 0
         OR COALESCE(deudas.deuda, 0) > 0 OR COALESCE(creditos.x, 0) > 0)
  ORDER BY COALESCE(deudas.deuda, 0) DESC, a.nombre ASC;
END;
$fn$;
