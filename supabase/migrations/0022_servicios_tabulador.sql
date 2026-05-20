-- ============================================================================
-- 0022_servicios_tabulador · completa el Subsistema 3 + 5 (Catálogo de
-- servicios + Tabulador de costos) sobre el schema base creado en 0003.
--
-- Decisiones:
--  * NO duplica las tablas de 0003. Capitaliza el bagaje (regla 8 / E43:
--    "antes de RPC sobre tabla existente, leer information_schema").
--  * Agrega lo que pedía el Documento Maestro y faltaba en 0003: alcance
--    por consorcio en `tabulador_precios`, modalidad `preferencial`,
--    bitácora `precio_audit`, RPCs `resolver_precio_servicio` y
--    `ajuste_masivo_precios`.
--  * Tenancy guard (regla 12): el resolver puede ser invocado por
--    administradores (portal), por eso valida administración.
--  * EXPLAIN ANALYZE friendly (regla 11): toda FK con índice; partial
--    unique para la regla base ya existía (uq_tabulador_base_vigente).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Alcance por consorcio + moneda + notas en tabulador_precios.
--    El brief original pedía `consorcio_id` para reglas a nivel edificio
--    (p.ej. plataforma SaaS por_unidad_funcional de un consorcio puntual).
-- ---------------------------------------------------------------------------
ALTER TABLE public.tabulador_precios
  ADD COLUMN IF NOT EXISTS consorcio_id uuid REFERENCES public.consorcios(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS moneda text NOT NULL DEFAULT 'ARS',
  ADD COLUMN IF NOT EXISTS notas text;

-- Un consorcio siempre pertenece a una administración: si vino consorcio_id
-- y no administracion_id, no rompemos el invariante pero forzamos coherencia
-- al insertar desde la app (chequeado en RPC). Igualmente sumamos un check
-- para evitar `administracion_id` y `convenio` y `consorcio_id` mezclados
-- en formas incoherentes:
ALTER TABLE public.tabulador_precios
  DROP CONSTRAINT IF EXISTS chk_tabulador_alcance;

ALTER TABLE public.tabulador_precios
  ADD CONSTRAINT chk_tabulador_alcance CHECK (
    -- A lo sumo un eje "especial": convenio, administracion o consorcio.
    (CASE WHEN administracion_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN convenio          IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN consorcio_id      IS NOT NULL THEN 1 ELSE 0 END)
    <= 1
  );

-- FK index (regla 11).
CREATE INDEX IF NOT EXISTS idx_tabulador_consorcio
  ON public.tabulador_precios(consorcio_id, servicio_id)
  WHERE consorcio_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Modalidad `preferencial` en el catálogo + en el tabulador.
--    `por_tramite` ya existe; agregamos `preferencial`.
-- ---------------------------------------------------------------------------
ALTER TABLE public.servicios
  DROP CONSTRAINT IF EXISTS servicios_precio_modo_check;

ALTER TABLE public.servicios
  ADD CONSTRAINT servicios_precio_modo_check CHECK (precio_modo IN (
    'fijo',
    'por_consorcio',
    'por_unidad_funcional',
    'por_tramite',
    'convenio',
    'preferencial'
  ));

-- `tabulador_precios.origen` ya contempla `preferencial`. Nada que tocar.

-- ---------------------------------------------------------------------------
-- 3) precio_audit · bitácora de cambios masivos / cierres (regla 1).
--    El historial fino ya vive en tabulador_precios (cada fila ES un cambio).
--    precio_audit es el "log de operaciones" para auditar quién hizo qué.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.precio_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id uuid REFERENCES public.servicios(id) ON DELETE SET NULL,
  tabulador_precio_anterior_id uuid REFERENCES public.tabulador_precios(id) ON DELETE SET NULL,
  tabulador_precio_nuevo_id uuid REFERENCES public.tabulador_precios(id) ON DELETE SET NULL,
  monto_anterior numeric(14,2),
  monto_nuevo numeric(14,2),
  accion text NOT NULL CHECK (accion IN ('alta','cierre','ajuste_masivo','baja')),
  motivo text,
  autor uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_precio_audit_servicio
  ON public.precio_audit(servicio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_precio_audit_anterior
  ON public.precio_audit(tabulador_precio_anterior_id);
CREATE INDEX IF NOT EXISTS idx_precio_audit_nuevo
  ON public.precio_audit(tabulador_precio_nuevo_id);

ALTER TABLE public.precio_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS precio_audit_select_staff ON public.precio_audit;
CREATE POLICY precio_audit_select_staff ON public.precio_audit
  FOR SELECT TO authenticated USING (private.is_staff());

DROP POLICY IF EXISTS precio_audit_write_gerente ON public.precio_audit;
CREATE POLICY precio_audit_write_gerente ON public.precio_audit
  FOR ALL TO authenticated
  USING (private.is_gerente())
  WITH CHECK (private.is_gerente());

-- ---------------------------------------------------------------------------
-- 4) RPC: resolver_precio_servicio · cascada de búsqueda del precio efectivo.
--    Orden de prioridad (más específico → más general):
--      1. tabulador para administración (preferencial / convenio) vigente.
--      2. tabulador para consorcio vigente.
--      3. regla base del servicio (administracion_id / consorcio_id / convenio NULL).
--      4. precio_base del catálogo (fallback).
--    Multiplica por unidades_funcionales cuando precio_modo='por_unidad_funcional'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolver_precio_servicio(
  p_servicio_id uuid,
  p_administracion_id uuid DEFAULT NULL,
  p_consorcio_id uuid DEFAULT NULL,
  p_fecha date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  precio_unitario numeric,
  precio_total numeric,
  modo text,
  origen text,
  unidades int,
  tabulador_precio_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $func$
DECLARE
  v_modo text;
  v_precio_base numeric(12,2);
  v_precio numeric(14,2);
  v_origen text;
  v_uf int := 1;
  v_tab_id uuid;
BEGIN
  -- Tenancy guard (regla 12): si lo invoca un administrador y pidió ver
  -- un precio para otra administración, cortamos.
  IF p_administracion_id IS NOT NULL THEN
    PERFORM private.assert_administracion_access(p_administracion_id);
  END IF;

  SELECT precio_modo, precio_base
    INTO v_modo, v_precio_base
  FROM public.servicios
  WHERE id = p_servicio_id AND activo;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Servicio inactivo o inexistente' USING ERRCODE = 'P0002';
  END IF;

  -- 1) Preferencial / convenio para la administración.
  IF p_administracion_id IS NOT NULL THEN
    SELECT tp.id, tp.precio, tp.origen
      INTO v_tab_id, v_precio, v_origen
    FROM public.tabulador_precios tp
    WHERE tp.servicio_id = p_servicio_id
      AND tp.administracion_id = p_administracion_id
      AND tp.vigente_desde <= p_fecha
      AND (tp.vigente_hasta IS NULL OR tp.vigente_hasta >= p_fecha)
    ORDER BY tp.vigente_desde DESC
    LIMIT 1;
  END IF;

  -- 2) Por consorcio.
  IF v_precio IS NULL AND p_consorcio_id IS NOT NULL THEN
    SELECT tp.id, tp.precio, tp.origen
      INTO v_tab_id, v_precio, v_origen
    FROM public.tabulador_precios tp
    WHERE tp.servicio_id = p_servicio_id
      AND tp.consorcio_id = p_consorcio_id
      AND tp.vigente_desde <= p_fecha
      AND (tp.vigente_hasta IS NULL OR tp.vigente_hasta >= p_fecha)
    ORDER BY tp.vigente_desde DESC
    LIMIT 1;
  END IF;

  -- 3) Regla base del tabulador (sin admin/consorcio/convenio).
  IF v_precio IS NULL THEN
    SELECT tp.id, tp.precio, tp.origen
      INTO v_tab_id, v_precio, v_origen
    FROM public.tabulador_precios tp
    WHERE tp.servicio_id = p_servicio_id
      AND tp.administracion_id IS NULL
      AND tp.consorcio_id IS NULL
      AND tp.convenio IS NULL
      AND tp.vigente_desde <= p_fecha
      AND (tp.vigente_hasta IS NULL OR tp.vigente_hasta >= p_fecha)
    ORDER BY tp.vigente_desde DESC
    LIMIT 1;
  END IF;

  -- 4) Fallback al precio_base del catálogo.
  IF v_precio IS NULL THEN
    v_precio := v_precio_base;
    v_origen := 'base';
  END IF;

  -- Multiplicador por modalidad.
  IF v_modo = 'por_unidad_funcional' AND p_consorcio_id IS NOT NULL THEN
    SELECT COALESCE(unidades_funcionales, 1) INTO v_uf
    FROM public.consorcios WHERE id = p_consorcio_id;
  END IF;

  precio_unitario := v_precio;
  precio_total := ROUND(v_precio * v_uf, 2);
  modo := v_modo;
  origen := COALESCE(v_origen, 'base');
  unidades := v_uf;
  tabulador_precio_id := v_tab_id;
  RETURN NEXT;
END;
$func$;

REVOKE EXECUTE ON FUNCTION public.resolver_precio_servicio(uuid, uuid, uuid, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_precio_servicio(uuid, uuid, uuid, date)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) RPC: ajuste_masivo_precios · cierra precios vigentes (vigente_hasta=hoy)
--    e inserta nuevos con monto * (1 + porcentaje/100) a partir de mañana.
--    Alcance: por categoría (todos los servicios activos) o servicio puntual.
--    Loguea en precio_audit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ajuste_masivo_precios(
  p_categoria_codigo text DEFAULT NULL,
  p_servicio_id uuid DEFAULT NULL,
  p_porcentaje numeric DEFAULT 0,
  p_motivo text DEFAULT NULL
)
RETURNS TABLE (
  servicio_id uuid,
  precio_anterior numeric,
  precio_nuevo numeric,
  tabulador_anterior_id uuid,
  tabulador_nuevo_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $func$
DECLARE
  r record;
  v_factor numeric;
  v_nuevo numeric(12,2);
  v_nuevo_id uuid;
  v_categoria_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT private.is_gerente() THEN
    RAISE EXCEPTION 'Solo gerentes pueden aplicar ajustes masivos.' USING ERRCODE = '42501';
  END IF;

  IF p_porcentaje IS NULL THEN
    RAISE EXCEPTION 'Porcentaje requerido.' USING ERRCODE = '22023';
  END IF;

  v_factor := 1 + (p_porcentaje::numeric / 100.0);

  IF p_categoria_codigo IS NOT NULL THEN
    SELECT id INTO v_categoria_id
    FROM public.categorias_servicio
    WHERE codigo = p_categoria_codigo;
    IF v_categoria_id IS NULL THEN
      RAISE EXCEPTION 'Categoría no encontrada: %', p_categoria_codigo
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  FOR r IN
    SELECT tp.id AS tab_id,
           tp.servicio_id,
           tp.precio,
           s.precio_modo
    FROM public.tabulador_precios tp
    JOIN public.servicios s ON s.id = tp.servicio_id
    WHERE tp.administracion_id IS NULL
      AND tp.consorcio_id IS NULL
      AND tp.convenio IS NULL
      AND tp.vigente_hasta IS NULL
      AND s.activo
      AND (v_categoria_id IS NULL OR s.categoria_id = v_categoria_id)
      AND (p_servicio_id IS NULL OR s.id = p_servicio_id)
  LOOP
    v_nuevo := ROUND(r.precio * v_factor, 2);

    -- Cierre del vigente.
    UPDATE public.tabulador_precios
       SET vigente_hasta = CURRENT_DATE
     WHERE id = r.tab_id;

    -- Alta del nuevo a partir de mañana.
    INSERT INTO public.tabulador_precios (
      servicio_id, precio, vigente_desde, vigente_hasta,
      origen, precio_anterior, porcentaje_aplicado, motivo, created_by
    ) VALUES (
      r.servicio_id, v_nuevo, CURRENT_DATE + 1, NULL,
      'ajuste_porcentual', r.precio, p_porcentaje, p_motivo, v_uid
    )
    RETURNING id INTO v_nuevo_id;

    -- Audit.
    INSERT INTO public.precio_audit (
      servicio_id, tabulador_precio_anterior_id, tabulador_precio_nuevo_id,
      monto_anterior, monto_nuevo, accion, motivo, autor
    ) VALUES (
      r.servicio_id, r.tab_id, v_nuevo_id,
      r.precio, v_nuevo, 'ajuste_masivo', p_motivo, v_uid
    );

    servicio_id := r.servicio_id;
    precio_anterior := r.precio;
    precio_nuevo := v_nuevo;
    tabulador_anterior_id := r.tab_id;
    tabulador_nuevo_id := v_nuevo_id;
    RETURN NEXT;
  END LOOP;
END;
$func$;

REVOKE EXECUTE ON FUNCTION public.ajuste_masivo_precios(text, uuid, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajuste_masivo_precios(text, uuid, numeric, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Seed mínimo de tabulador base para los servicios cargados en 0003.
--    Precios indicativos (gerencia los reemplaza desde la UI antes de operar).
--    No tocamos servicios.activo (siguen en false hasta revisión manual).
-- ---------------------------------------------------------------------------
INSERT INTO public.tabulador_precios
  (servicio_id, precio, vigente_desde, origen, motivo)
SELECT s.id, p.precio, CURRENT_DATE, 'base', 'Seed inicial 0022'
FROM (VALUES
  ('rpac_inscripcion',         150000),
  ('rpac_renovacion',           90000),
  ('rpac_certificado',          25000),
  ('rpac_ddjj',                 18000),
  ('rpa_actualizacion',         80000),
  ('curso_formacion_rpac',     220000),
  ('curso_actualizacion_rpac', 120000),
  ('administracion_global',       650),
  ('juridico_consulta',         45000),
  ('capacitacion_gratuita',         0)
) AS p(codigo, precio)
JOIN public.servicios s ON s.codigo = p.codigo
-- Sólo si todavía no hay regla base abierta (uq_tabulador_base_vigente).
WHERE NOT EXISTS (
  SELECT 1 FROM public.tabulador_precios tp
   WHERE tp.servicio_id = s.id
     AND tp.administracion_id IS NULL
     AND tp.consorcio_id IS NULL
     AND tp.convenio IS NULL
     AND tp.vigente_hasta IS NULL
);

-- ---------------------------------------------------------------------------
-- Smoke checks (silencian si todo OK).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.tabulador_precios) >= 1,
    'tabulador_precios vacío tras seed';
END$$;
