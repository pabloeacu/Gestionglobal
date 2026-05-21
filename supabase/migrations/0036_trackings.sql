-- ============================================================================
-- 0036_trackings · Sistema de Tracking (puntos 9-17 del Flujo Maestro)
--
-- Filosofía (BACKLOG.md / G2): un "Tracking" es la INSTANCIA del servicio en
-- una iteración. Distinto de "Solicitud" (submission cruda). Un mismo cliente
-- puede tener múltiples trackings históricos para el mismo servicio (DJ 2025
-- vs DJ 2026), enlazados via parent_tracking_id.
--
-- Decisión de diseño:
-- - Mantenemos la tabla física `tramites` (mig 0021) por compat con G1 (que
--   refactoriza el módulo de solicitudes encima). El "tracking" es un
--   *enriquecimiento* de tramites, no una tabla nueva: agregamos columnas
--   (servicio_id, periodo, parent_tracking_id, fechas, doc final) y dos
--   tablas complementarias (tracking_lineas, *_estados_config,
--   *_categorias_config).
-- - Regla 1: toda mutación pasa por RPC SECURITY DEFINER con search_path
--   fijo + tenancy guard (regla 12).
-- - Regla 11: índice por cada FK; partial index para alertas futuras.
-- - Categorías y estados son CONFIGURABLES por servicio: NULL = default
--   global; row con servicio_id = override por servicio.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columnas en tramites (no-destructivo)
-- ---------------------------------------------------------------------------
ALTER TABLE public.tramites
  ADD COLUMN IF NOT EXISTS servicio_id uuid REFERENCES public.servicios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS periodo text,
  ADD COLUMN IF NOT EXISTS parent_tracking_id uuid REFERENCES public.tramites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fecha_inicio date,
  ADD COLUMN IF NOT EXISTS fecha_fin date,
  ADD COLUMN IF NOT EXISTS documento_final_url text;

CREATE INDEX IF NOT EXISTS idx_tramites_servicio ON public.tramites(servicio_id) WHERE servicio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tramites_parent ON public.tramites(parent_tracking_id) WHERE parent_tracking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tramites_periodo ON public.tramites(servicio_id, periodo) WHERE servicio_id IS NOT NULL AND periodo IS NOT NULL;

COMMENT ON COLUMN public.tramites.servicio_id IS 'Qué servicio se está trackeando (DJ, matrícula, curso, etc).';
COMMENT ON COLUMN public.tramites.periodo IS 'Iteración del servicio: "2025", "2025-Q1", "2025-12". Distingue DJ 2025 vs DJ 2026.';
COMMENT ON COLUMN public.tramites.parent_tracking_id IS 'Tracking anterior (mismo cliente, mismo servicio, periodo previo) — recurrencia.';

-- ---------------------------------------------------------------------------
-- 2. tracking_lineas · avances/comentarios/eventos categorizables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tracking_lineas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tramite_id uuid NOT NULL REFERENCES public.tramites(id) ON DELETE CASCADE,
  categoria text NOT NULL,
  descripcion text NOT NULL,
  estado_asociado text,
  archivos_urls text[] NOT NULL DEFAULT '{}',
  alerta_en timestamptz,
  autor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracking_lineas_tramite ON public.tracking_lineas(tramite_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_lineas_categoria ON public.tracking_lineas(categoria);
CREATE INDEX IF NOT EXISTS idx_tracking_lineas_autor ON public.tracking_lineas(autor_id) WHERE autor_id IS NOT NULL;
-- Partial index para el cron de alertas futuras (regla 11)
CREATE INDEX IF NOT EXISTS idx_tracking_lineas_alerta_pendiente
  ON public.tracking_lineas(alerta_en)
  WHERE alerta_en IS NOT NULL;

COMMENT ON TABLE public.tracking_lineas IS 'Líneas de avance del tracking (timeline categorizado). Cada línea opcionalmente cambia el estado del tramite_id padre y puede disparar una alerta futura via trigger.';

-- ---------------------------------------------------------------------------
-- 3. tracking_estados_config · estados por servicio (servicio_id NULL = default)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tracking_estados_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id uuid REFERENCES public.servicios(id) ON DELETE CASCADE,
  slug text NOT NULL,
  label text NOT NULL,
  color text NOT NULL DEFAULT 'slate',
  orden smallint NOT NULL DEFAULT 0,
  es_final boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tracking_estados_config_unique UNIQUE (servicio_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_tracking_estados_servicio ON public.tracking_estados_config(servicio_id);

-- Cuando servicio_id es NULL la unicidad sobre slug no funciona vía UNIQUE
-- (NULLs distintos). Garantizamos slugs default únicos via partial unique:
CREATE UNIQUE INDEX IF NOT EXISTS uq_tracking_estados_default_slug
  ON public.tracking_estados_config(slug)
  WHERE servicio_id IS NULL;

-- ---------------------------------------------------------------------------
-- 4. tracking_categorias_config · categorías de líneas por servicio
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tracking_categorias_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id uuid REFERENCES public.servicios(id) ON DELETE CASCADE,
  slug text NOT NULL,
  label text NOT NULL,
  icono text,
  color text NOT NULL DEFAULT 'slate',
  orden smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tracking_categorias_config_unique UNIQUE (servicio_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_tracking_categorias_servicio ON public.tracking_categorias_config(servicio_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tracking_categorias_default_slug
  ON public.tracking_categorias_config(slug)
  WHERE servicio_id IS NULL;

-- ---------------------------------------------------------------------------
-- 5. Seed estados default (servicio_id = NULL)
-- ---------------------------------------------------------------------------
INSERT INTO public.tracking_estados_config (servicio_id, slug, label, color, orden, es_final) VALUES
  (NULL, 'recibido',                  'Recibido',                  'slate',   10, false),
  (NULL, 'pendiente_revision',        'Pendiente de revisión',     'amber',   20, false),
  (NULL, 'documentacion_incompleta',  'Documentación incompleta',  'amber',   30, false),
  (NULL, 'enviado_gestoria',          'Enviado a gestoría',        'cyan',    40, false),
  (NULL, 'en_proceso',                'En proceso',                'cyan',    50, false),
  (NULL, 'observado',                 'Observado',                 'red',     60, false),
  (NULL, 'pendiente_cliente',         'Pendiente del cliente',     'amber',   70, false),
  (NULL, 'aprobado',                  'Aprobado',                  'emerald', 80, false),
  (NULL, 'finalizado',                'Finalizado',                'emerald', 90, true),
  (NULL, 'cancelado',                 'Cancelado',                 'slate',  100, true)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Seed categorías default (12, punto 14 del documento)
-- ---------------------------------------------------------------------------
INSERT INTO public.tracking_categorias_config (servicio_id, slug, label, icono, color, orden) VALUES
  (NULL, 'documentacion_recibida',   'Documentación recibida',   'file-check',   'emerald', 10),
  (NULL, 'documentacion_observada',  'Documentación observada',  'alert-circle', 'amber',   20),
  (NULL, 'tramite_enviado',          'Trámite enviado',          'send',         'cyan',    30),
  (NULL, 'pendiente_cliente',        'Pendiente del cliente',    'user-clock',   'amber',   40),
  (NULL, 'respuesta_organismo',      'Respuesta del organismo',  'mail',         'cyan',    50),
  (NULL, 'aprobacion',               'Aprobación',               'check',        'emerald', 60),
  (NULL, 'rechazo',                  'Rechazo',                  'x-circle',     'red',     70),
  (NULL, 'recordatorio',             'Recordatorio',             'bell',         'amber',   80),
  (NULL, 'vencimiento',              'Vencimiento',              'calendar',     'red',     90),
  (NULL, 'seguimiento_interno',      'Seguimiento interno',      'eye',          'slate',  100),
  (NULL, 'certificado_emitido',      'Certificado emitido',      'award',        'emerald',110),
  (NULL, 'diploma_emitido',          'Diploma emitido',          'graduation-cap','emerald',120),
  (NULL, 'custom',                   'Personalizado',            'tag',          'slate',  200)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. Seed template de email 'tracking-recordatorio'
-- ---------------------------------------------------------------------------
INSERT INTO public.email_templates (slug, nombre, asunto, body_html, body_text, descripcion, activo, variables)
VALUES (
  'tracking-recordatorio',
  'Recordatorio del trámite',
  'Recordatorio del trámite — {{tipo}}',
  '<p>Hola,</p><p>Te recordamos que tu trámite <strong>{{tipo}}</strong> tiene una acción pendiente:</p><blockquote>{{descripcion}}</blockquote><p>Fecha del recordatorio: <strong>{{fecha}}</strong></p><p>Saludos,<br/>Gestión Global</p>',
  'Hola,\n\nTe recordamos que tu trámite {{tipo}} tiene una acción pendiente:\n\n{{descripcion}}\n\nFecha del recordatorio: {{fecha}}\n\nSaludos,\nGestión Global',
  'Recordatorio automático disparado por una línea de tracking con alerta_en futura.',
  true,
  '["tipo","descripcion","fecha"]'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. Trigger: si tracking_linea.alerta_en es futuro, encolar email
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tracking_linea_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tramite  record;
  v_servicio_nombre text;
  v_to_email text;
  v_to_nombre text;
BEGIN
  -- Actualizar actividad del tramite y, si corresponde, el estado.
  IF NEW.estado_asociado IS NOT NULL THEN
    UPDATE public.tramites
      SET ultima_actividad_at = now()
     WHERE id = NEW.tramite_id;
  ELSE
    UPDATE public.tramites
      SET ultima_actividad_at = now()
     WHERE id = NEW.tramite_id;
  END IF;

  -- Encolar email sólo si hay alerta futura
  IF NEW.alerta_en IS NULL OR NEW.alerta_en <= now() THEN
    RETURN NEW;
  END IF;

  SELECT t.*, s.nombre AS svc_nombre
    INTO v_tramite
    FROM public.tramites t
    LEFT JOIN public.servicios s ON s.id = t.servicio_id
   WHERE t.id = NEW.tramite_id;

  v_servicio_nombre := COALESCE(v_tramite.svc_nombre, v_tramite.titulo, 'Trámite');

  -- Destinatario: solicitante_email o, si no hay, email de la administración
  v_to_email := v_tramite.solicitante_email;
  v_to_nombre := COALESCE(v_tramite.solicitante_nombre, '');
  IF v_to_email IS NULL AND v_tramite.administracion_id IS NOT NULL THEN
    SELECT email, nombre INTO v_to_email, v_to_nombre
      FROM public.administraciones
     WHERE id = v_tramite.administracion_id;
  END IF;

  IF v_to_email IS NULL THEN
    RETURN NEW;  -- no hay a quien avisar
  END IF;

  PERFORM public.encolar_email(
    'tracking-recordatorio',
    v_to_email,
    v_to_nombre,
    jsonb_build_object(
      'tipo', v_servicio_nombre,
      'descripcion', NEW.descripcion,
      'fecha', to_char(NEW.alerta_en AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
    ),
    v_tramite.administracion_id,
    v_tramite.consorcio_id,
    'tracking_lineas',
    NEW.id,
    5::smallint
  );

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tracking_linea_on_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tracking_linea_on_insert ON public.tracking_lineas;
CREATE TRIGGER trg_tracking_linea_on_insert
  AFTER INSERT ON public.tracking_lineas
  FOR EACH ROW EXECUTE FUNCTION public.tracking_linea_on_insert();

-- ---------------------------------------------------------------------------
-- 9. RPC: tracking_agregar_linea
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tracking_agregar_linea(
  p_tramite_id uuid,
  p_categoria text,
  p_descripcion text,
  p_estado_asociado text DEFAULT NULL,
  p_archivos_urls text[] DEFAULT '{}',
  p_alerta_en timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin uuid;
  v_id uuid;
BEGIN
  SELECT administracion_id INTO v_admin FROM public.tramites WHERE id = p_tramite_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tracking no encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Tenancy guard (regla 12)
  IF NOT private.is_staff() THEN
    IF v_admin IS NULL THEN
      RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
    PERFORM private.assert_administracion_access(v_admin);
  END IF;

  -- Validar categoría: debe existir como default o override del servicio
  IF NOT EXISTS (
    SELECT 1 FROM public.tracking_categorias_config WHERE slug = p_categoria
  ) THEN
    RAISE EXCEPTION 'Categoría inválida: %', p_categoria USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, estado_asociado, archivos_urls, alerta_en, autor_id
  ) VALUES (
    p_tramite_id, p_categoria, p_descripcion, p_estado_asociado,
    COALESCE(p_archivos_urls, '{}'::text[]), p_alerta_en, auth.uid()
  )
  RETURNING id INTO v_id;

  -- Si la línea trae estado_asociado, propagar al tramite (sólo staff puede
  -- cambiar estados; el administrador puede agregar líneas pero sin mover
  -- el estado).
  IF p_estado_asociado IS NOT NULL AND private.is_staff() THEN
    UPDATE public.tramites
      SET estado = CASE
        WHEN p_estado_asociado IN ('abierto','en_progreso','esperando_cliente','resuelto','cerrado','cancelado')
          THEN p_estado_asociado
        ELSE estado
      END,
      ultima_actividad_at = now()
     WHERE id = p_tramite_id;
  END IF;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tracking_agregar_linea(uuid, text, text, text, text[], timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_agregar_linea(uuid, text, text, text, text[], timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. RPC: tracking_cerrar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tracking_cerrar(
  p_tramite_id uuid,
  p_documento_final_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede cerrar trackings' USING ERRCODE = '42501';
  END IF;

  SELECT administracion_id INTO v_admin FROM public.tramites WHERE id = p_tramite_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tracking no encontrado' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.tramites
    SET estado = 'cerrado',
        fecha_fin = CURRENT_DATE,
        documento_final_url = p_documento_final_url,
        ultima_actividad_at = now()
   WHERE id = p_tramite_id;

  -- Línea automática de cierre
  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, estado_asociado, archivos_urls, autor_id
  ) VALUES (
    p_tramite_id,
    'certificado_emitido',
    'Tracking cerrado. Documento final adjunto.',
    'finalizado',
    CASE WHEN p_documento_final_url IS NOT NULL
         THEN ARRAY[p_documento_final_url]::text[]
         ELSE '{}'::text[] END,
    auth.uid()
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tracking_cerrar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_cerrar(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 11. RPC: tracking_historial_cliente (recurrencia)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tracking_historial_cliente(
  p_administracion_id uuid,
  p_servicio_slug text
)
RETURNS SETOF public.tramites
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Tenancy guard
  IF NOT private.is_staff() THEN
    PERFORM private.assert_administracion_access(p_administracion_id);
  END IF;

  RETURN QUERY
    SELECT t.*
      FROM public.tramites t
      JOIN public.servicios s ON s.id = t.servicio_id
     WHERE t.administracion_id = p_administracion_id
       AND s.codigo = p_servicio_slug
     ORDER BY COALESCE(t.fecha_inicio, t.created_at::date) DESC,
              t.created_at DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tracking_historial_cliente(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_historial_cliente(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 12. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.tracking_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_estados_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_categorias_config ENABLE ROW LEVEL SECURITY;

-- tracking_lineas
DROP POLICY IF EXISTS tl_staff_all ON public.tracking_lineas;
CREATE POLICY tl_staff_all ON public.tracking_lineas
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS tl_admin_select ON public.tracking_lineas;
CREATE POLICY tl_admin_select ON public.tracking_lineas
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tramites t
       WHERE t.id = tracking_lineas.tramite_id
         AND t.administracion_id IS NOT NULL
         AND t.administracion_id = private.current_administracion_id()
    )
  );

DROP POLICY IF EXISTS tl_admin_insert ON public.tracking_lineas;
CREATE POLICY tl_admin_insert ON public.tracking_lineas
  FOR INSERT TO authenticated
  WITH CHECK (
    autor_id = auth.uid()
    AND estado_asociado IS NULL  -- el admin no mueve estados, sólo agrega notas
    AND EXISTS (
      SELECT 1 FROM public.tramites t
       WHERE t.id = tracking_lineas.tramite_id
         AND t.administracion_id IS NOT NULL
         AND t.administracion_id = private.current_administracion_id()
    )
  );

-- tracking_estados_config: SELECT autenticado, CUD staff
DROP POLICY IF EXISTS tec_select_auth ON public.tracking_estados_config;
CREATE POLICY tec_select_auth ON public.tracking_estados_config
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS tec_staff_cud ON public.tracking_estados_config;
CREATE POLICY tec_staff_cud ON public.tracking_estados_config
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

-- tracking_categorias_config
DROP POLICY IF EXISTS tcc_select_auth ON public.tracking_categorias_config;
CREATE POLICY tcc_select_auth ON public.tracking_categorias_config
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS tcc_staff_cud ON public.tracking_categorias_config;
CREATE POLICY tcc_staff_cud ON public.tracking_categorias_config
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

-- ============================================================================
-- Fin 0036_trackings
-- ============================================================================
