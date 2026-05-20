-- ============================================================================
-- 0025_vencimientos · Subsistema 9 (Documento Maestro): Datos estratégicos y
-- vencimientos con alertas configurables (30/20/10 d) + sugerencia automática
-- de servicios. Lo que diferencia a Gestión Global vs MANAXER (allá no
-- existía este registro proactivo).
--
-- Decisiones (regla 1, decisión 2026-05-19, regla 12):
-- - Single-tenant: NO empresa_id. Eje = administracion_id (NOT NULL).
-- - consorcio_id NULLABLE: hay vencimientos del administrador (matrícula,
--   DDJJ, cert ARCA) y otros del consorcio (seguro, habilitación municipal,
--   libros, ascensores).
-- - tipo y sujeto como CHECK enums simples (preferimos texto + check sobre
--   crear types pg, alineado a tramites.estado, formularios.estado, etc.).
-- - Cada vencimiento puede ser "renovado_por" otro vencimiento (cadena),
--   manteniendo histórico (E45 / regla 9: aprendizaje de un dato).
-- - Flags de dedup por umbral: alerta_30d_enviada / 20d / 10d como
--   timestamptz NULL (patrón comprobante_avisos_vencimiento, migración 0011).
-- - vencimientos_config: una fila por (administracion_id, tipo). NULL en
--   administracion_id = default global (lo que la gerencia configura para
--   "todos los clientes"). El edge function busca primero el override,
--   luego el default.
-- - RLS: staff full; administrador SELECT solo sus filas. RPCs SECURITY
--   DEFINER con tenancy guard (regla 12, E45/E49).
-- - Partial index sobre (fecha_vencimiento) WHERE estado='vigente' para que
--   el cron escanee O(log n) sólo los vivos (regla 11).
-- - dispatch_vencimientos_log: tabla de runs del cron diario (auditoría +
--   diagnóstico).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tabla principal · vencimientos
-- ---------------------------------------------------------------------------
CREATE TABLE public.vencimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  tipo text NOT NULL CHECK (tipo IN (
    'matricula_rpac',
    'ddjj_anual',
    'certificado_arca',
    'seguro_consorcio',
    'habilitacion_municipal',
    'libro_actas',
    'libro_administracion',
    'revision_ascensor',
    'otro'
  )),
  sujeto text NOT NULL CHECK (sujeto IN ('administracion','consorcio')),
  sujeto_id uuid NOT NULL,

  administracion_id uuid NOT NULL
    REFERENCES public.administraciones(id) ON DELETE CASCADE,
  consorcio_id uuid
    REFERENCES public.consorcios(id) ON DELETE CASCADE,

  fecha_vencimiento date NOT NULL,
  fecha_emision date,

  descripcion text,
  observaciones text,

  estado text NOT NULL DEFAULT 'vigente'
    CHECK (estado IN ('vigente','vencido','renovado','cancelado')),

  -- Cadena de renovación: el viejo apunta NULL; el nuevo apunta al viejo.
  renovado_por uuid REFERENCES public.vencimientos(id) ON DELETE SET NULL,

  -- Dedup de alertas (1 fila == 3 umbrales independientes).
  alerta_30d_enviada timestamptz,
  alerta_20d_enviada timestamptz,
  alerta_10d_enviada timestamptz,

  -- Servicio sugerido al cliente (slug). Cache opcional; si NULL, el cron
  -- usa el de vencimientos_config.sugerencia_servicio_slug.
  servicio_sugerido_id uuid,

  origen text NOT NULL DEFAULT 'gestion_global',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Consistencia: si sujeto='consorcio', consorcio_id NOT NULL. Si
  -- sujeto='administracion', consorcio_id puede ir NULL pero no es exigido.
  CONSTRAINT chk_venc_sujeto_consorcio CHECK (
    sujeto <> 'consorcio' OR consorcio_id IS NOT NULL
  )
);

-- FK indexes (regla 11: Postgres no los crea solo).
CREATE INDEX idx_venc_admin
  ON public.vencimientos(administracion_id);
CREATE INDEX idx_venc_consorcio
  ON public.vencimientos(consorcio_id)
  WHERE consorcio_id IS NOT NULL;
CREATE INDEX idx_venc_renovado_por
  ON public.vencimientos(renovado_por)
  WHERE renovado_por IS NOT NULL;
CREATE INDEX idx_venc_tipo ON public.vencimientos(tipo);
CREATE INDEX idx_venc_estado ON public.vencimientos(estado);

-- Partial index para el cron: el 99% de lo que escanea está vigente.
CREATE INDEX idx_venc_proximos
  ON public.vencimientos(fecha_vencimiento)
  WHERE estado = 'vigente';

CREATE TRIGGER trg_venc_touch
  BEFORE UPDATE ON public.vencimientos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_venc_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.vencimientos
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- ---------------------------------------------------------------------------
-- Trigger auto_clasificar_vencido: marca como 'vencido' si pasó la fecha y
-- todavía está 'vigente'. Corre BEFORE INSERT/UPDATE de fila por fila.
-- (El cron del dispatch llama también a private.vencimientos_recompute_estado
-- para barrer todo de una vez por las dudas.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venc_auto_clasificar_vencido()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.estado = 'vigente' AND NEW.fecha_vencimiento < CURRENT_DATE THEN
    NEW.estado := 'vencido';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.venc_auto_clasificar_vencido()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_venc_auto_clasificar
  BEFORE INSERT OR UPDATE OF fecha_vencimiento, estado ON public.vencimientos
  FOR EACH ROW EXECUTE FUNCTION public.venc_auto_clasificar_vencido();

-- ---------------------------------------------------------------------------
-- Tabla config · ventana por tipo y opcionalmente por administración
-- ---------------------------------------------------------------------------
CREATE TABLE public.vencimientos_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL = default global (la gerencia define la política base por tipo).
  administracion_id uuid
    REFERENCES public.administraciones(id) ON DELETE CASCADE,

  tipo text NOT NULL CHECK (tipo IN (
    'matricula_rpac',
    'ddjj_anual',
    'certificado_arca',
    'seguro_consorcio',
    'habilitacion_municipal',
    'libro_actas',
    'libro_administracion',
    'revision_ascensor',
    'otro'
  )),

  dias_alerta_1 smallint NOT NULL DEFAULT 30
    CHECK (dias_alerta_1 BETWEEN 1 AND 365),
  dias_alerta_2 smallint NOT NULL DEFAULT 20
    CHECK (dias_alerta_2 BETWEEN 1 AND 365),
  dias_alerta_3 smallint NOT NULL DEFAULT 10
    CHECK (dias_alerta_3 BETWEEN 1 AND 365),

  activo boolean NOT NULL DEFAULT true,

  -- NULL => usar administraciones.email del cliente.
  email_destinatario text,

  -- Slug del servicio sugerido (catálogo del módulo de servicios — agente
  -- separado). NULL = sin sugerencia.
  sugerencia_servicio_slug text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_venc_cfg_orden
    CHECK (dias_alerta_1 > dias_alerta_2 AND dias_alerta_2 > dias_alerta_3)
);

-- Unicidad: una fila por (administracion_id, tipo). Para el "default global"
-- (administracion_id NULL) la unicidad se enforce con un partial index.
CREATE UNIQUE INDEX uq_venc_cfg_admin_tipo
  ON public.vencimientos_config(administracion_id, tipo)
  WHERE administracion_id IS NOT NULL;
CREATE UNIQUE INDEX uq_venc_cfg_global_tipo
  ON public.vencimientos_config(tipo)
  WHERE administracion_id IS NULL;

CREATE INDEX idx_venc_cfg_admin
  ON public.vencimientos_config(administracion_id)
  WHERE administracion_id IS NOT NULL;

CREATE TRIGGER trg_venc_cfg_touch
  BEFORE UPDATE ON public.vencimientos_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Tabla de auditoría del cron diario (P-CRON-LOG).
-- ---------------------------------------------------------------------------
CREATE TABLE public.dispatch_vencimientos_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corrida_at timestamptz NOT NULL DEFAULT now(),
  vencimientos_procesados int NOT NULL DEFAULT 0,
  emails_encolados int NOT NULL DEFAULT 0,
  errores jsonb NOT NULL DEFAULT '[]'::jsonb,
  duracion_ms int
);

CREATE INDEX idx_dispatch_venc_corrida
  ON public.dispatch_vencimientos_log(corrida_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.vencimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vencimientos_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_vencimientos_log ENABLE ROW LEVEL SECURITY;

-- vencimientos: staff full; administrador SELECT de sus filas.
DROP POLICY IF EXISTS venc_staff_all ON public.vencimientos;
CREATE POLICY venc_staff_all ON public.vencimientos
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS venc_admin_select ON public.vencimientos;
CREATE POLICY venc_admin_select ON public.vencimientos
  FOR SELECT TO authenticated
  USING (
    private.is_administrador()
    AND administracion_id = private.current_administracion_id()
  );

-- vencimientos_config: staff full; administrador SELECT (para ver su política).
DROP POLICY IF EXISTS venc_cfg_staff_all ON public.vencimientos_config;
CREATE POLICY venc_cfg_staff_all ON public.vencimientos_config
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS venc_cfg_admin_select ON public.vencimientos_config;
CREATE POLICY venc_cfg_admin_select ON public.vencimientos_config
  FOR SELECT TO authenticated
  USING (
    private.is_administrador()
    AND (administracion_id IS NULL
         OR administracion_id = private.current_administracion_id())
  );

-- dispatch_vencimientos_log: sólo staff.
DROP POLICY IF EXISTS dvl_staff_all ON public.dispatch_vencimientos_log;
CREATE POLICY dvl_staff_all ON public.dispatch_vencimientos_log
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

-- ---------------------------------------------------------------------------
-- RPC · proximos_vencimientos
-- Lista los vencimientos vigentes ordenados por fecha. Si quien llama es
-- staff: respeta filtro p_administracion_id si viene. Si es administrador:
-- fuerza administracion_id = current_administracion_id (tenancy guard).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proximos_vencimientos(
  p_administracion_id uuid DEFAULT NULL,
  p_dias smallint DEFAULT 90
)
RETURNS TABLE (
  id uuid,
  tipo text,
  sujeto text,
  sujeto_id uuid,
  administracion_id uuid,
  administracion_nombre text,
  consorcio_id uuid,
  consorcio_nombre text,
  fecha_vencimiento date,
  fecha_emision date,
  dias_restantes int,
  descripcion text,
  observaciones text,
  estado text,
  sugerencia_servicio_slug text,
  alerta_30d_enviada timestamptz,
  alerta_20d_enviada timestamptz,
  alerta_10d_enviada timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_filter uuid := p_administracion_id;
BEGIN
  IF NOT private.is_staff() THEN
    -- Administrador: forzamos su propio admin id (regla 12, tenancy guard).
    v_admin_filter := private.current_administracion_id();
    IF v_admin_filter IS NULL THEN
      RAISE EXCEPTION 'Sin administración asociada' USING ERRCODE = '42501';
    END IF;
  ELSIF p_administracion_id IS NOT NULL THEN
    PERFORM private.assert_administracion_access(p_administracion_id);
  END IF;

  RETURN QUERY
  SELECT
    v.id,
    v.tipo,
    v.sujeto,
    v.sujeto_id,
    v.administracion_id,
    a.nombre AS administracion_nombre,
    v.consorcio_id,
    c.nombre AS consorcio_nombre,
    v.fecha_vencimiento,
    v.fecha_emision,
    (v.fecha_vencimiento - CURRENT_DATE)::int AS dias_restantes,
    v.descripcion,
    v.observaciones,
    v.estado,
    COALESCE(
      cfg_override.sugerencia_servicio_slug,
      cfg_global.sugerencia_servicio_slug
    ) AS sugerencia_servicio_slug,
    v.alerta_30d_enviada,
    v.alerta_20d_enviada,
    v.alerta_10d_enviada
  FROM public.vencimientos v
  JOIN public.administraciones a ON a.id = v.administracion_id
  LEFT JOIN public.consorcios c ON c.id = v.consorcio_id
  LEFT JOIN public.vencimientos_config cfg_override
    ON cfg_override.administracion_id = v.administracion_id
   AND cfg_override.tipo = v.tipo
  LEFT JOIN public.vencimientos_config cfg_global
    ON cfg_global.administracion_id IS NULL
   AND cfg_global.tipo = v.tipo
  WHERE v.estado IN ('vigente','vencido')
    AND v.fecha_vencimiento <= CURRENT_DATE + p_dias
    AND (v_admin_filter IS NULL OR v.administracion_id = v_admin_filter)
  ORDER BY v.fecha_vencimiento ASC, v.id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.proximos_vencimientos(uuid, smallint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proximos_vencimientos(uuid, smallint)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC · marcar_renovado
-- Marca un vencimiento como 'renovado' y crea uno nuevo con la misma
-- definición pero nueva fecha_vencimiento. El nuevo apunta al viejo en
-- renovado_por (no al revés; mantenemos la cadena hacia atrás).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marcar_renovado(
  p_vencimiento_id uuid,
  p_nueva_fecha_vencimiento date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old record;
  v_new_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede renovar vencimientos' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_old FROM public.vencimientos WHERE id = p_vencimiento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vencimiento no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF p_nueva_fecha_vencimiento <= v_old.fecha_vencimiento THEN
    RAISE EXCEPTION 'La nueva fecha debe ser posterior a la actual'
      USING ERRCODE = '22023';
  END IF;

  -- Crear el nuevo apuntando al viejo.
  INSERT INTO public.vencimientos (
    tipo, sujeto, sujeto_id,
    administracion_id, consorcio_id,
    fecha_vencimiento, fecha_emision,
    descripcion, observaciones,
    estado, renovado_por, origen
  )
  VALUES (
    v_old.tipo, v_old.sujeto, v_old.sujeto_id,
    v_old.administracion_id, v_old.consorcio_id,
    p_nueva_fecha_vencimiento, CURRENT_DATE,
    v_old.descripcion, v_old.observaciones,
    'vigente', v_old.id, v_old.origen
  )
  RETURNING id INTO v_new_id;

  -- Marcar el viejo como renovado.
  UPDATE public.vencimientos
     SET estado = 'renovado',
         updated_at = now()
   WHERE id = p_vencimiento_id;

  RETURN v_new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.marcar_renovado(uuid, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_renovado(uuid, date)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Seed · vencimientos_config global (administracion_id NULL = política base).
-- Slugs asumidos del catálogo de servicios (otro agente):
--   - renovacion-rpac          (matrícula RPAC / RPA → curso/renovación)
--   - ddjj-anual               (DDJJ anual)
--   - curso-actualizacion      (varios usos)
-- Los slugs faltantes quedan NULL — el cron simplemente no incluye sugerencia.
-- ---------------------------------------------------------------------------
INSERT INTO public.vencimientos_config (
  administracion_id, tipo,
  dias_alerta_1, dias_alerta_2, dias_alerta_3,
  activo, email_destinatario, sugerencia_servicio_slug
)
VALUES
  (NULL, 'matricula_rpac',          30, 20, 10, true, NULL, 'renovacion-rpac'),
  (NULL, 'ddjj_anual',              30, 20, 10, true, NULL, 'ddjj-anual'),
  (NULL, 'certificado_arca',        30, 20, 10, true, NULL, 'curso-actualizacion'),
  (NULL, 'seguro_consorcio',        30, 20, 10, true, NULL, NULL),
  (NULL, 'habilitacion_municipal',  30, 20, 10, true, NULL, NULL),
  (NULL, 'libro_actas',             30, 20, 10, true, NULL, NULL),
  (NULL, 'libro_administracion',    30, 20, 10, true, NULL, NULL),
  (NULL, 'revision_ascensor',       30, 20, 10, true, NULL, NULL)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Cron diario: 09:00 AR = 12:00 UTC. Dispara la edge function
-- `dispatch-vencimientos`. Las settings (URL + secret) se cargan vía
-- `alter database postgres set ...` igual que el cron de notify-vencimientos
-- (migración 0011), reusando `app.settings.cron_secret`.
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('dispatch-vencimientos-diario')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'dispatch-vencimientos-diario'
  );

SELECT cron.schedule(
  'dispatch-vencimientos-diario',
  '0 12 * * *',
  $cron$
    SELECT net.http_post(
      url := current_setting('app.settings.dispatch_vencimientos_url', true),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret', true)
      ),
      body := '{}'::jsonb
    );
  $cron$
);
