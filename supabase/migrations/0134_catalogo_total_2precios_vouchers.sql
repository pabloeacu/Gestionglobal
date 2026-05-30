-- ============================================================================
-- Migration: 0134_catalogo_total_2precios_vouchers
-- Fecha: 2026-05-29
-- DGG-XX · Refactor catálogo (causa de errores graves en MANAXER):
--
-- (1) PRECIO = TOTAL SIEMPRE. El precio del catálogo es el monto que paga el
--     cliente. La discriminación IVA, si corresponde, se calcula al convertir
--     comprobante simple a factura A según condición fiscal emisor/receptor.
--     `iva_alicuota` queda DEPRECATED en la UI (no se borra para no romper
--     queries existentes; la columna se mantiene en BD).
--
-- (2) DOS PRECIOS por servicio: `precio_publico` (landing) + `precio_cliente`
--     (portal). Cada uno opcional: NULL bloquea ese canal. Si un servicio
--     sólo tiene precio_publico → no aparece en portal cliente. Y viceversa.
--     `precio_base` queda como columna deprecated, sincronizada por trigger
--     con el primer valor no-null entre público/cliente (compat queries).
--
-- (3) VOUCHERS por servicio (tabla nueva `servicio_vouchers`): código +
--     descuento_pct + alcance (publico|cliente|ambos) + expira_at nullable
--     + max_usos opcional + usos_count.
--
-- (4) `solicitudes` extendida: voucher_id + snapshots + precio_aplicado +
--     precio_final + origen_canal + bonificacion_100 generada.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1 · DOS PRECIOS en servicios
-- ----------------------------------------------------------------------------
ALTER TABLE public.servicios
  ADD COLUMN IF NOT EXISTS precio_publico numeric NULL,
  ADD COLUMN IF NOT EXISTS precio_cliente numeric NULL;

-- Backfill: todos los servicios pre-existentes mantienen su precio actual
-- como ambos (público + cliente). El operador después podrá diferenciar.
UPDATE public.servicios
SET precio_publico = COALESCE(precio_publico, precio_base),
    precio_cliente = COALESCE(precio_cliente, precio_base)
WHERE precio_publico IS NULL OR precio_cliente IS NULL;

-- Trigger: mantener precio_base sincronizado para no romper queries que
-- todavía lo lean (RPCs ARCA, comprobante pre-fill, tabulador). El valor
-- de referencia es el público; si no hay público, usa el cliente.
CREATE OR REPLACE FUNCTION public._servicios_sync_precio_base()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.precio_base := COALESCE(NEW.precio_publico, NEW.precio_cliente, NEW.precio_base, 0);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_servicios_sync_precio_base ON public.servicios;
CREATE TRIGGER trg_servicios_sync_precio_base
  BEFORE INSERT OR UPDATE OF precio_publico, precio_cliente ON public.servicios
  FOR EACH ROW EXECUTE FUNCTION public._servicios_sync_precio_base();

COMMENT ON COLUMN public.servicios.precio_base IS
  'DEPRECATED 2026-05-29 (mig 0134): sincronizado vía trigger con precio_publico/precio_cliente. Usar las dos columnas nuevas. El precio es TOTAL siempre — no se discrimina IVA.';
COMMENT ON COLUMN public.servicios.iva_alicuota IS
  'DEPRECATED 2026-05-29 (mig 0134): el precio del catálogo es TOTAL. El IVA, si corresponde, se calcula al convertir comprobante simple a factura A según condición fiscal del emisor y receptor.';
COMMENT ON COLUMN public.servicios.precio_publico IS
  'Precio TOTAL para solicitudes desde landing pública. NULL = servicio NO se ofrece por landing.';
COMMENT ON COLUMN public.servicios.precio_cliente IS
  'Precio TOTAL para solicitudes desde portal cliente. NULL = servicio NO se ofrece por portal cliente.';

-- ----------------------------------------------------------------------------
-- 2 · TABLA `servicio_vouchers`
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.servicio_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id uuid NOT NULL REFERENCES public.servicios(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  descuento_pct numeric NOT NULL CHECK (descuento_pct > 0 AND descuento_pct <= 100),
  alcance text NOT NULL DEFAULT 'ambos'
    CHECK (alcance IN ('publico','cliente','ambos')),
  expira_at timestamptz NULL,  -- null = nunca expira
  max_usos integer NULL CHECK (max_usos IS NULL OR max_usos > 0),  -- null = ilimitado
  usos_count integer NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  observaciones text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.servicio_vouchers ENABLE ROW LEVEL SECURITY;
-- Regla 6 (post mig 0130): GRANTs explícitos
GRANT SELECT, INSERT, UPDATE, DELETE ON public.servicio_vouchers TO authenticated;
GRANT SELECT ON public.servicio_vouchers TO anon;

-- Código único por servicio (case insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS uq_servicio_vouchers_codigo
  ON public.servicio_vouchers (servicio_id, lower(codigo));
CREATE INDEX IF NOT EXISTS idx_servicio_vouchers_codigo_activo
  ON public.servicio_vouchers (lower(codigo)) WHERE activo;
CREATE INDEX IF NOT EXISTS idx_servicio_vouchers_servicio
  ON public.servicio_vouchers (servicio_id);

-- updated_at automático
CREATE OR REPLACE FUNCTION public._servicio_vouchers_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_servicio_vouchers_updated_at ON public.servicio_vouchers;
CREATE TRIGGER trg_servicio_vouchers_updated_at
  BEFORE UPDATE ON public.servicio_vouchers
  FOR EACH ROW EXECUTE FUNCTION public._servicio_vouchers_set_updated_at();

-- RLS · gerencia gestiona, anon/authenticated leen para validar.
DROP POLICY IF EXISTS vouchers_gerencia_full ON public.servicio_vouchers;
CREATE POLICY vouchers_gerencia_full ON public.servicio_vouchers
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

-- Lectura · anon y authenticated ven sólo los vigentes y activos.
-- La validación efectiva (con alcance público/cliente según el caller) la
-- hace el RPC SECURITY DEFINER `voucher_validar`. Esta policy permite
-- listar vouchers vigentes desde formularios públicos si fuera necesario.
DROP POLICY IF EXISTS vouchers_lectura_vigentes ON public.servicio_vouchers;
CREATE POLICY vouchers_lectura_vigentes ON public.servicio_vouchers
  FOR SELECT TO authenticated, anon
  USING (
    activo
    AND (expira_at IS NULL OR expira_at > NOW())
    AND (max_usos IS NULL OR usos_count < max_usos)
  );

-- ----------------------------------------------------------------------------
-- 3 · `solicitudes` extendida con voucher + precio_aplicado + origen_canal
-- ----------------------------------------------------------------------------
ALTER TABLE public.solicitudes
  ADD COLUMN IF NOT EXISTS voucher_id uuid NULL
    REFERENCES public.servicio_vouchers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voucher_codigo text NULL,
  ADD COLUMN IF NOT EXISTS voucher_descuento_pct numeric NULL,
  ADD COLUMN IF NOT EXISTS precio_aplicado numeric NULL,   -- precio del catálogo (público o cliente) al momento
  ADD COLUMN IF NOT EXISTS precio_final numeric NULL,      -- con descuento aplicado
  ADD COLUMN IF NOT EXISTS origen_canal text NOT NULL DEFAULT 'publico'
    CHECK (origen_canal IN ('publico','cliente'));

-- Bonificación 100% = derivada (boolean generated). Útil para UI badges.
ALTER TABLE public.solicitudes
  ADD COLUMN IF NOT EXISTS bonificacion_100 boolean
    GENERATED ALWAYS AS (voucher_descuento_pct = 100) STORED;

CREATE INDEX IF NOT EXISTS idx_solicitudes_voucher
  ON public.solicitudes(voucher_id) WHERE voucher_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_solicitudes_bonificacion_100
  ON public.solicitudes(bonificacion_100) WHERE bonificacion_100;

COMMENT ON COLUMN public.solicitudes.voucher_id IS
  'FK al voucher aplicado en esta solicitud (NULL si no usó voucher).';
COMMENT ON COLUMN public.solicitudes.voucher_codigo IS
  'Snapshot del código usado (para conservar trazabilidad si el voucher se elimina o cambia).';
COMMENT ON COLUMN public.solicitudes.voucher_descuento_pct IS
  'Snapshot del % de descuento al momento del envío.';
COMMENT ON COLUMN public.solicitudes.precio_aplicado IS
  'Precio TOTAL del catálogo al momento del envío (público o cliente según origen_canal).';
COMMENT ON COLUMN public.solicitudes.precio_final IS
  'Precio TOTAL final con descuento del voucher aplicado. Es el monto del comprobante.';
COMMENT ON COLUMN public.solicitudes.origen_canal IS
  'De dónde llegó la solicitud: ''publico'' (landing) o ''cliente'' (portal).';

-- ----------------------------------------------------------------------------
-- 4 · RPC `voucher_validar` (anon + authenticated)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.voucher_validar(
  p_codigo text,
  p_servicio_id uuid,
  p_es_cliente boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_voucher RECORD;
BEGIN
  IF p_codigo IS NULL OR length(trim(p_codigo)) = 0 THEN
    RETURN jsonb_build_object('valido', false, 'mensaje', 'Ingresá un código.');
  END IF;
  IF p_servicio_id IS NULL THEN
    RETURN jsonb_build_object('valido', false, 'mensaje', 'Servicio no identificado.');
  END IF;

  SELECT * INTO v_voucher
  FROM public.servicio_vouchers v
  WHERE v.servicio_id = p_servicio_id
    AND lower(v.codigo) = lower(trim(p_codigo))
    AND v.activo
    AND (v.expira_at IS NULL OR v.expira_at > NOW())
    AND (v.max_usos IS NULL OR v.usos_count < v.max_usos)
    AND (
      v.alcance = 'ambos'
      OR (v.alcance = 'publico' AND NOT p_es_cliente)
      OR (v.alcance = 'cliente' AND p_es_cliente)
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'valido', false,
      'mensaje', 'Código no válido o no aplicable a este servicio.'
    );
  END IF;

  RETURN jsonb_build_object(
    'valido', true,
    'voucher_id', v_voucher.id,
    'codigo', v_voucher.codigo,
    'descuento_pct', v_voucher.descuento_pct,
    'es_100', v_voucher.descuento_pct = 100,
    'mensaje', CASE
      WHEN v_voucher.descuento_pct = 100 THEN '¡Felicitaciones! Este será un servicio gratuito.'
      ELSE 'Voucher aplicado · ' || v_voucher.descuento_pct || '% de descuento.'
    END
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.voucher_validar(text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voucher_validar(text, uuid, boolean) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5 · RPC `voucher_incrementar_uso`
-- Idempotente · llamado al CREAR la solicitud (no antes, para evitar
-- inflados por validaciones de prueba).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.voucher_incrementar_uso(p_voucher_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_voucher_id IS NULL THEN RETURN; END IF;
  UPDATE public.servicio_vouchers
  SET usos_count = usos_count + 1, updated_at = NOW()
  WHERE id = p_voucher_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.voucher_incrementar_uso(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voucher_incrementar_uso(uuid) TO anon, authenticated;
