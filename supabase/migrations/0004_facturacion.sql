-- ============================================================================
-- 0004_facturacion · comprobantes + items + numeradores + lotes.
-- Cita el bagaje: doc 02 §3 (schema facturación), D04/D06 (snapshot receptor),
-- D09 (ARCA no se borra, NC; simple se borra si 100% pendiente), E40, E41
-- (CHECK regex 3 capas), E38 (parse coma decimal), origen para histórico.
-- Adaptación single-tenant: sin empresa_id; consorcio_id NULL permitido para
-- servicios personales del administrador (matrícula RPAC).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- lotes_facturacion · agrupador de emisión masiva
-- ---------------------------------------------------------------------------
CREATE TABLE public.lotes_facturacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo date NOT NULL,
  descripcion text,
  origen text NOT NULL DEFAULT 'manual'
    CHECK (origen IN ('planilla','activos','manual')),
  estado text NOT NULL DEFAULT 'abierto' CHECK (estado IN (
    'abierto','autorizando','autorizado','emitiendo','emitido','cerrado','anulado'
  )),
  total_comprobantes int NOT NULL DEFAULT 0,
  total_autorizados int NOT NULL DEFAULT 0,
  total_fallidos int NOT NULL DEFAULT 0,
  total_anulados int NOT NULL DEFAULT 0,
  envio_estado text CHECK (envio_estado IS NULL OR envio_estado IN
    ('idle','en_proceso','completado','con_errores')),
  log jsonb NOT NULL DEFAULT '[]'::jsonb,
  cerrado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_lotes_estado ON public.lotes_facturacion(estado);
CREATE INDEX idx_lotes_periodo ON public.lotes_facturacion(periodo DESC);

CREATE TRIGGER trg_lotes_touch
  BEFORE UPDATE ON public.lotes_facturacion
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_lotes_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.lotes_facturacion
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- ---------------------------------------------------------------------------
-- numeradores · correlativo por (punto_venta, tipo)
-- ---------------------------------------------------------------------------
CREATE TABLE public.numeradores (
  punto_venta int NOT NULL,
  tipo text NOT NULL CHECK (tipo IN
    ('A','B','C','X','NC_A','NC_B','NC_C','NC_X','ND_A','ND_B','ND_C','ND_X')),
  ultimo_numero int NOT NULL DEFAULT 0 CHECK (ultimo_numero >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (punto_venta, tipo)
);

-- ---------------------------------------------------------------------------
-- comprobantes · facturas, NC, ND. Vinculadas siempre a una administración
-- (snapshot D06). consorcio_id NULL permitido para servicios personales.
-- ---------------------------------------------------------------------------
CREATE TABLE public.comprobantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  administracion_id uuid NOT NULL
    REFERENCES public.administraciones(id) ON DELETE RESTRICT,
  consorcio_id uuid REFERENCES public.consorcios(id) ON DELETE RESTRICT,
  servicio_id uuid REFERENCES public.servicios(id) ON DELETE SET NULL,
  lote_id uuid REFERENCES public.lotes_facturacion(id) ON DELETE SET NULL,

  tipo text NOT NULL CHECK (tipo IN
    ('A','B','C','X','NC_A','NC_B','NC_C','NC_X','ND_A','ND_B','ND_C','ND_X')),
  punto_venta int NOT NULL,
  numero int,                              -- NULL hasta autorizar
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  periodo date NOT NULL DEFAULT date_trunc('month', CURRENT_DATE)::date,
  concepto text NOT NULL DEFAULT 'servicios'
    CHECK (concepto IN ('productos','servicios','productos_servicios')),

  -- Receptor SNAPSHOT (D04 / D06)
  receptor_tipo_documento text NOT NULL
    CHECK (receptor_tipo_documento IN ('cuit','dni','dni_ficticio','cf')),
  receptor_numero_documento text NOT NULL,
  receptor_razon_social text NOT NULL,
  receptor_condicion_iva text NOT NULL,
  receptor_domicilio text,
  receptor_doc_tipo_enviado smallint
    CHECK (receptor_doc_tipo_enviado IS NULL OR receptor_doc_tipo_enviado IN (80,96,99)),
  CONSTRAINT chk_comprobantes_receptor_formato CHECK (
    (receptor_tipo_documento = 'cuit'
       AND receptor_numero_documento ~ '^\d{11}$')
    OR (receptor_tipo_documento IN ('dni','dni_ficticio')
       AND receptor_numero_documento ~ '^\d{7,8}$')
    OR (receptor_tipo_documento = 'cf'
       AND receptor_numero_documento = '0')
  ),

  -- Importes
  neto numeric(14,2) NOT NULL DEFAULT 0 CHECK (neto >= 0),
  no_gravado numeric(14,2) NOT NULL DEFAULT 0 CHECK (no_gravado >= 0),
  exento numeric(14,2) NOT NULL DEFAULT 0 CHECK (exento >= 0),
  iva_21 numeric(14,2) NOT NULL DEFAULT 0 CHECK (iva_21 >= 0),
  iva_105 numeric(14,2) NOT NULL DEFAULT 0 CHECK (iva_105 >= 0),
  iva_27 numeric(14,2) NOT NULL DEFAULT 0 CHECK (iva_27 >= 0),
  total_iva numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_iva >= 0),
  impuestos_internos numeric(14,2) NOT NULL DEFAULT 0 CHECK (impuestos_internos >= 0),
  total numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  saldo_pendiente numeric(14,2) NOT NULL DEFAULT 0 CHECK (saldo_pendiente >= 0),

  moneda text NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS','USD')),
  cotizacion numeric(12,4) NOT NULL DEFAULT 1 CHECK (cotizacion > 0),

  estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN
    ('borrador','procesando','autorizado','observado','rechazado','anulado','compensado','error')),
  estado_cobranza text NOT NULL DEFAULT 'pendiente' CHECK (estado_cobranza IN
    ('pendiente','parcial','pagado','vencido','en_recupero','anulado')),
  vencimiento date,

  -- ARCA (plugin · D08)
  cae varchar(14),
  cae_vencimiento date,
  arca_observaciones jsonb,
  arca_request_xml text,
  arca_response_xml text,
  emitido_arca boolean NOT NULL DEFAULT false,

  -- NC/ND linkage
  comprobante_referencia_id uuid REFERENCES public.comprobantes(id) ON DELETE SET NULL,
  motivo_nc text,

  -- Origen (D09 + futura migración Excel)
  origen text NOT NULL DEFAULT 'gestion_global' CHECK (origen IN
    ('gestion_global','previo','lote','manual','migrado')),

  -- Email tracking
  email_enviado_at timestamptz,
  email_envios_count int NOT NULL DEFAULT 0 CHECK (email_envios_count >= 0),
  pdf_url text,

  observaciones text,
  motivo_rechazo text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Índices: toda FK con su índice (E48). CTE-friendly indexing.
CREATE INDEX idx_comprobantes_administracion_fecha
  ON public.comprobantes(administracion_id, fecha DESC);
CREATE INDEX idx_comprobantes_consorcio_periodo
  ON public.comprobantes(consorcio_id, periodo)
  WHERE consorcio_id IS NOT NULL;
CREATE INDEX idx_comprobantes_servicio
  ON public.comprobantes(servicio_id) WHERE servicio_id IS NOT NULL;
CREATE INDEX idx_comprobantes_lote
  ON public.comprobantes(lote_id) WHERE lote_id IS NOT NULL;
CREATE INDEX idx_comprobantes_estado
  ON public.comprobantes(estado, estado_cobranza);
CREATE INDEX idx_comprobantes_pendientes
  ON public.comprobantes(administracion_id, vencimiento)
  WHERE estado = 'autorizado'
    AND estado_cobranza IN ('pendiente','parcial','vencido');
CREATE INDEX idx_comprobantes_referencia
  ON public.comprobantes(comprobante_referencia_id)
  WHERE comprobante_referencia_id IS NOT NULL;

-- Unique sobre (punto_venta, tipo, numero) excluyendo `previo` (histórico Excel).
CREATE UNIQUE INDEX uq_comprobantes_pv_tipo_numero
  ON public.comprobantes(punto_venta, tipo, numero)
  WHERE numero IS NOT NULL AND origen <> 'previo';

CREATE TRIGGER trg_comprobantes_touch
  BEFORE UPDATE ON public.comprobantes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_comprobantes_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.comprobantes
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- ---------------------------------------------------------------------------
-- items_comprobantes · líneas de detalle. Triggers calculan subtotal/iva/total
-- del ítem y recalculan totales del comprobante (doc 01 §3 + E38).
-- ---------------------------------------------------------------------------
CREATE TABLE public.items_comprobantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comprobante_id uuid NOT NULL
    REFERENCES public.comprobantes(id) ON DELETE CASCADE,
  orden smallint NOT NULL DEFAULT 1,
  descripcion text NOT NULL,
  cantidad numeric(14,4) NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unitario numeric(14,4) NOT NULL CHECK (precio_unitario >= 0),
  bonificacion_porc numeric(5,2) NOT NULL DEFAULT 0
    CHECK (bonificacion_porc BETWEEN 0 AND 100),
  alicuota_iva text NOT NULL DEFAULT '21'
    CHECK (alicuota_iva IN ('0','10.5','21','27','exento','no_gravado')),
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  iva numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  -- Trazabilidad opcional (multi-consorcio en un mismo lote/factura)
  servicio_id uuid REFERENCES public.servicios(id) ON DELETE SET NULL,
  consorcio_id uuid REFERENCES public.consorcios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_items_subtotal_no_negativo CHECK (subtotal >= 0)
);

CREATE INDEX idx_items_comprobante ON public.items_comprobantes(comprobante_id, orden);
CREATE INDEX idx_items_consorcio
  ON public.items_comprobantes(consorcio_id)
  WHERE consorcio_id IS NOT NULL;

-- Trigger: calcular subtotal/iva/total del ítem antes de persistir.
CREATE OR REPLACE FUNCTION public.calcular_item_comprobante()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_factor_iva numeric;
BEGIN
  NEW.subtotal := round(
    NEW.cantidad * NEW.precio_unitario * (1 - NEW.bonificacion_porc / 100.0),
    2
  );
  v_factor_iva := CASE NEW.alicuota_iva
    WHEN '21'   THEN 0.21
    WHEN '10.5' THEN 0.105
    WHEN '27'   THEN 0.27
    ELSE 0
  END;
  NEW.iva := round(NEW.subtotal * v_factor_iva, 2);
  NEW.total := NEW.subtotal + NEW.iva;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.calcular_item_comprobante() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_items_calcular
  BEFORE INSERT OR UPDATE ON public.items_comprobantes
  FOR EACH ROW EXECUTE FUNCTION public.calcular_item_comprobante();

-- Trigger: recalcular totales del comprobante cuando cambian sus ítems.
-- saldo_pendiente se sincroniza con el total mientras el estado_cobranza sea
-- 'pendiente' (no hay cobranzas registradas todavía). Una vez aplicada una
-- cobranza, deja de recalcularse desde acá para no pisar el saldo real.
CREATE OR REPLACE FUNCTION public.recalcular_totales_comprobante()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
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
    total      = sub.total,
    saldo_pendiente = CASE
      WHEN c.estado_cobranza = 'pendiente' THEN sub.total
      ELSE c.saldo_pendiente
    END
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
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.recalcular_totales_comprobante() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_items_recalcular
  AFTER INSERT OR UPDATE OR DELETE ON public.items_comprobantes
  FOR EACH ROW EXECUTE FUNCTION public.recalcular_totales_comprobante();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.comprobantes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comprobantes_select ON public.comprobantes;
CREATE POLICY comprobantes_select ON public.comprobantes
  FOR SELECT TO authenticated USING (
    private.is_staff()
    OR (private.is_administrador()
        AND administracion_id = private.current_administracion_id())
  );

DROP POLICY IF EXISTS comprobantes_write_staff ON public.comprobantes;
CREATE POLICY comprobantes_write_staff ON public.comprobantes
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

ALTER TABLE public.items_comprobantes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS items_comprobantes_select ON public.items_comprobantes;
CREATE POLICY items_comprobantes_select ON public.items_comprobantes
  FOR SELECT TO authenticated USING (
    private.is_staff()
    OR EXISTS (
      SELECT 1 FROM public.comprobantes c
      WHERE c.id = comprobante_id
        AND private.is_administrador()
        AND c.administracion_id = private.current_administracion_id()
    )
  );

DROP POLICY IF EXISTS items_comprobantes_write_staff ON public.items_comprobantes;
CREATE POLICY items_comprobantes_write_staff ON public.items_comprobantes
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

ALTER TABLE public.numeradores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS numeradores_select_staff ON public.numeradores;
CREATE POLICY numeradores_select_staff ON public.numeradores
  FOR SELECT TO authenticated USING (private.is_staff());

DROP POLICY IF EXISTS numeradores_write_staff ON public.numeradores;
CREATE POLICY numeradores_write_staff ON public.numeradores
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

ALTER TABLE public.lotes_facturacion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lotes_select_staff ON public.lotes_facturacion;
CREATE POLICY lotes_select_staff ON public.lotes_facturacion
  FOR SELECT TO authenticated USING (private.is_staff());

DROP POLICY IF EXISTS lotes_write_staff ON public.lotes_facturacion;
CREATE POLICY lotes_write_staff ON public.lotes_facturacion
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());
