-- ============================================================================
-- 0021_tramites · Sistema de Trámites (expedientes/tickets) - Phase 2D.
--
-- Convierte cada solicitud (formulario público, portal del administrador o
-- alta manual de gerencia) en un trámite con estado, asignación, SLA,
-- comentarios, eventos (historial) y adjuntos.
--
-- Decisiones:
-- - Código humano TRM-YYYY-NNNNN generado por trigger con sequence anual.
-- - Single-tenant (regla 1 / decisión 2026-05-19): NO empresa_id; el eje es
--   administracion_id (puede ser NULL en trámites de origen público sin
--   asociar a cliente).
-- - tramite_eventos: append-only, history audit del trámite.
-- - RLS: staff full; administrador SELECT solo donde administracion_id =
--   private.current_administracion_id(). Administrador puede INSERT
--   comentarios visibles en sus trámites (visible_para='todos').
-- - Trigger AFTER INSERT en formulario_submissions crea trámite automático
--   para categoría 'consulta' (slug consultoria-juridica). Otras categorías
--   quedan a discreción de gerencia.
-- - Storage bucket 'tramite-adjuntos' privado; path
--   <tramite_id>/<filename>. Para administrador, el path debe empezar con
--   el administracion_id de su perfil.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- tramites · expediente principal
-- ---------------------------------------------------------------------------
CREATE TABLE public.tramites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  titulo text NOT NULL,
  descripcion text,
  categoria text NOT NULL CHECK (categoria IN (
    'matricula','dj','consulta_juridica','renovacion','curso','reclamo','otro'
  )),
  prioridad text NOT NULL DEFAULT 'normal'
    CHECK (prioridad IN ('baja','normal','alta','urgente')),
  estado text NOT NULL DEFAULT 'abierto'
    CHECK (estado IN ('abierto','en_progreso','esperando_cliente','resuelto','cerrado','cancelado')),

  -- Vínculos
  formulario_submission_id uuid REFERENCES public.formulario_submissions(id) ON DELETE SET NULL,
  administracion_id uuid REFERENCES public.administraciones(id) ON DELETE SET NULL,
  consorcio_id uuid REFERENCES public.consorcios(id) ON DELETE SET NULL,
  comprobante_id uuid REFERENCES public.comprobantes(id) ON DELETE SET NULL,

  -- Asignación
  asignado_a uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- SLA
  vence_at timestamptz,
  resuelto_at timestamptz,
  resuelto_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Solicitante (snapshot para origen externo sin admin asociado)
  solicitante_nombre text,
  solicitante_email text,
  solicitante_telefono text,

  -- Metadatos denormalizados
  total_comentarios int NOT NULL DEFAULT 0,
  total_adjuntos int NOT NULL DEFAULT 0,
  total_vistas int NOT NULL DEFAULT 0,
  ultima_actividad_at timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_tramites_estado ON public.tramites(estado, ultima_actividad_at DESC);
CREATE INDEX idx_tramites_admin ON public.tramites(administracion_id) WHERE administracion_id IS NOT NULL;
CREATE INDEX idx_tramites_asignado ON public.tramites(asignado_a) WHERE asignado_a IS NOT NULL;
CREATE INDEX idx_tramites_categoria ON public.tramites(categoria, estado);
CREATE INDEX idx_tramites_submission ON public.tramites(formulario_submission_id) WHERE formulario_submission_id IS NOT NULL;
CREATE INDEX idx_tramites_consorcio ON public.tramites(consorcio_id) WHERE consorcio_id IS NOT NULL;
CREATE INDEX idx_tramites_comprobante ON public.tramites(comprobante_id) WHERE comprobante_id IS NOT NULL;
CREATE INDEX idx_tramites_resuelto_por ON public.tramites(resuelto_por) WHERE resuelto_por IS NOT NULL;
CREATE INDEX idx_tramites_created_by ON public.tramites(created_by) WHERE created_by IS NOT NULL;

CREATE TRIGGER trg_tramites_touch
  BEFORE UPDATE ON public.tramites
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_tramites_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.tramites
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- ---------------------------------------------------------------------------
-- tramite_comentarios · timeline de comentarios
-- ---------------------------------------------------------------------------
CREATE TABLE public.tramite_comentarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tramite_id uuid NOT NULL REFERENCES public.tramites(id) ON DELETE CASCADE,
  contenido text NOT NULL,
  visible_para text NOT NULL DEFAULT 'todos'
    CHECK (visible_para IN ('cliente','staff','todos')),
  autor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  autor_nombre text NOT NULL,
  autor_role text NOT NULL
    CHECK (autor_role IN ('gerente','operador','administrador','sistema')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_com_tramite ON public.tramite_comentarios(tramite_id, created_at);
CREATE INDEX idx_com_autor ON public.tramite_comentarios(autor_id) WHERE autor_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- tramite_eventos · historial (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE public.tramite_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tramite_id uuid NOT NULL REFERENCES public.tramites(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN (
    'creado','asignado','desasignado','cambio_estado','cambio_prioridad',
    'comentario','adjunto','resuelto','reabierto'
  )),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_nombre text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_eventos_tramite ON public.tramite_eventos(tramite_id, created_at DESC);
CREATE INDEX idx_eventos_actor ON public.tramite_eventos(actor_id) WHERE actor_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- tramite_adjuntos · archivos del trámite
-- ---------------------------------------------------------------------------
CREATE TABLE public.tramite_adjuntos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tramite_id uuid NOT NULL REFERENCES public.tramites(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  filename_original text NOT NULL,
  mime_type text,
  size_bytes int,
  subido_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tadj_tramite ON public.tramite_adjuntos(tramite_id, uploaded_at DESC);
CREATE INDEX idx_tadj_subido_por ON public.tramite_adjuntos(subido_por) WHERE subido_por IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Sequence anual + función para generar código TRM-YYYY-NNNNN
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.tramite_codigo_seq;

CREATE OR REPLACE FUNCTION public.tramites_set_codigo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_year text;
  v_n int;
BEGIN
  IF NEW.codigo IS NOT NULL AND length(NEW.codigo) > 0 THEN
    RETURN NEW;
  END IF;
  v_year := to_char(now(), 'YYYY');
  v_n := nextval('public.tramite_codigo_seq');
  NEW.codigo := 'TRM-' || v_year || '-' || lpad(v_n::text, 5, '0');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tramites_set_codigo() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_tramites_codigo
  BEFORE INSERT ON public.tramites
  FOR EACH ROW EXECUTE FUNCTION public.tramites_set_codigo();

-- ---------------------------------------------------------------------------
-- Triggers de mantenimiento de contadores y actividad
-- ---------------------------------------------------------------------------

-- Cuando se inserta un comentario: ++total_comentarios + ultima_actividad_at
CREATE OR REPLACE FUNCTION public.tramite_on_comentario_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.tramites
    SET total_comentarios = total_comentarios + 1,
        ultima_actividad_at = now()
   WHERE id = NEW.tramite_id;

  INSERT INTO public.tramite_eventos (tramite_id, tipo, data, actor_id, actor_nombre)
  VALUES (
    NEW.tramite_id,
    'comentario',
    jsonb_build_object('visible_para', NEW.visible_para, 'comentario_id', NEW.id),
    NEW.autor_id,
    NEW.autor_nombre
  );
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tramite_on_comentario_insert() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_tramite_com_insert
  AFTER INSERT ON public.tramite_comentarios
  FOR EACH ROW EXECUTE FUNCTION public.tramite_on_comentario_insert();

-- Cuando se inserta un adjunto: ++total_adjuntos + actividad
CREATE OR REPLACE FUNCTION public.tramite_on_adjunto_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.tramites
    SET total_adjuntos = total_adjuntos + 1,
        ultima_actividad_at = now()
   WHERE id = NEW.tramite_id;

  INSERT INTO public.tramite_eventos (tramite_id, tipo, data, actor_id)
  VALUES (
    NEW.tramite_id,
    'adjunto',
    jsonb_build_object('adjunto_id', NEW.id, 'filename', NEW.filename_original),
    NEW.subido_por
  );
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tramite_on_adjunto_insert() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_tramite_adj_insert
  AFTER INSERT ON public.tramite_adjuntos
  FOR EACH ROW EXECUTE FUNCTION public.tramite_on_adjunto_insert();

-- Cuando se elimina un adjunto: --total_adjuntos
CREATE OR REPLACE FUNCTION public.tramite_on_adjunto_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.tramites
    SET total_adjuntos = greatest(total_adjuntos - 1, 0)
   WHERE id = OLD.tramite_id;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tramite_on_adjunto_delete() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_tramite_adj_delete
  AFTER DELETE ON public.tramite_adjuntos
  FOR EACH ROW EXECUTE FUNCTION public.tramite_on_adjunto_delete();

-- Cuando cambian estado/prioridad/asignación: registrar evento
CREATE OR REPLACE FUNCTION public.tramite_on_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_nombre text;
BEGIN
  -- snapshot del nombre del autor (puede ser sistema si auth.uid() es null)
  SELECT full_name INTO v_actor_nombre FROM public.profiles WHERE id = auth.uid();

  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    INSERT INTO public.tramite_eventos (tramite_id, tipo, data, actor_id, actor_nombre)
    VALUES (
      NEW.id,
      CASE
        WHEN NEW.estado IN ('resuelto','cerrado') THEN 'resuelto'
        WHEN OLD.estado IN ('resuelto','cerrado') AND NEW.estado NOT IN ('resuelto','cerrado') THEN 'reabierto'
        ELSE 'cambio_estado'
      END,
      jsonb_build_object('desde', OLD.estado, 'hasta', NEW.estado),
      auth.uid(),
      v_actor_nombre
    );
    NEW.ultima_actividad_at := now();
    IF NEW.estado IN ('resuelto','cerrado') AND OLD.estado NOT IN ('resuelto','cerrado') THEN
      NEW.resuelto_at := now();
      NEW.resuelto_por := auth.uid();
    END IF;
  END IF;

  IF NEW.prioridad IS DISTINCT FROM OLD.prioridad THEN
    INSERT INTO public.tramite_eventos (tramite_id, tipo, data, actor_id, actor_nombre)
    VALUES (
      NEW.id, 'cambio_prioridad',
      jsonb_build_object('desde', OLD.prioridad, 'hasta', NEW.prioridad),
      auth.uid(), v_actor_nombre
    );
    NEW.ultima_actividad_at := now();
  END IF;

  IF NEW.asignado_a IS DISTINCT FROM OLD.asignado_a THEN
    INSERT INTO public.tramite_eventos (tramite_id, tipo, data, actor_id, actor_nombre)
    VALUES (
      NEW.id,
      CASE WHEN NEW.asignado_a IS NULL THEN 'desasignado' ELSE 'asignado' END,
      jsonb_build_object('desde', OLD.asignado_a, 'hasta', NEW.asignado_a),
      auth.uid(), v_actor_nombre
    );
    NEW.ultima_actividad_at := now();
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tramite_on_update() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_tramite_on_update
  BEFORE UPDATE ON public.tramites
  FOR EACH ROW EXECUTE FUNCTION public.tramite_on_update();

-- Al crear: insertar evento 'creado'
CREATE OR REPLACE FUNCTION public.tramite_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_nombre text;
BEGIN
  SELECT full_name INTO v_actor_nombre FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.tramite_eventos (tramite_id, tipo, data, actor_id, actor_nombre)
  VALUES (
    NEW.id, 'creado',
    jsonb_build_object('categoria', NEW.categoria, 'origen',
      CASE WHEN NEW.formulario_submission_id IS NOT NULL THEN 'formulario'
           WHEN auth.uid() IS NULL THEN 'sistema'
           ELSE 'manual' END),
    auth.uid(), COALESCE(v_actor_nombre, 'Sistema')
  );
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tramite_on_insert() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_tramite_on_insert
  AFTER INSERT ON public.tramites
  FOR EACH ROW EXECUTE FUNCTION public.tramite_on_insert();

-- ---------------------------------------------------------------------------
-- RPC: crear_tramite_desde_submission
-- Genera un trámite a partir de un submission, snapshoteando los datos
-- de contacto. Disponible para staff.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_tramite_desde_submission(
  p_submission_id uuid,
  p_categoria text,
  p_asignado_a uuid DEFAULT NULL,
  p_titulo text DEFAULT NULL,
  p_prioridad text DEFAULT 'normal'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_subm record;
  v_form record;
  v_id uuid;
  v_titulo text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede crear trámites desde submissions' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_subm
    FROM public.formulario_submissions
   WHERE id = p_submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submission no encontrado' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_form FROM public.formularios WHERE id = v_subm.formulario_id;

  v_titulo := COALESCE(
    p_titulo,
    v_form.titulo || ' · ' || COALESCE(v_subm.nombre_contacto, v_subm.email_contacto, 'sin contacto')
  );

  INSERT INTO public.tramites (
    titulo, descripcion, categoria, prioridad,
    formulario_submission_id, administracion_id,
    asignado_a, solicitante_nombre, solicitante_email, solicitante_telefono,
    created_by
  )
  VALUES (
    v_titulo,
    NULL,
    p_categoria,
    p_prioridad,
    p_submission_id,
    v_subm.administracion_id,
    p_asignado_a,
    v_subm.nombre_contacto,
    v_subm.email_contacto,
    v_subm.telefono_contacto,
    auth.uid()
  )
  RETURNING id INTO v_id;

  -- Marcamos el submission como en revisión
  UPDATE public.formulario_submissions
     SET estado = 'en_revision', updated_at = now()
   WHERE id = p_submission_id AND estado = 'pendiente';

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crear_tramite_desde_submission(uuid, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_tramite_desde_submission(uuid, text, uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: incrementar contador de vistas (administrador o staff)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tramite_incrementar_vistas(p_tramite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin uuid;
BEGIN
  SELECT administracion_id INTO v_admin FROM public.tramites WHERE id = p_tramite_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trámite no encontrado' USING ERRCODE = 'P0002';
  END IF;
  -- staff bypassa; administrador debe ser dueño del trámite
  IF NOT private.is_staff() THEN
    IF v_admin IS NULL OR v_admin <> private.current_administracion_id() THEN
      RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
  END IF;
  UPDATE public.tramites SET total_vistas = total_vistas + 1 WHERE id = p_tramite_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tramite_incrementar_vistas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tramite_incrementar_vistas(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Trigger automático: submission → trámite para categoría 'consulta'
-- (formulario consultoria-juridica). Otros formularios quedan pendientes
-- de procesamiento manual.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_tramite_desde_submission_auto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slug text;
  v_categoria text;
  v_titulo text;
BEGIN
  SELECT slug, titulo INTO v_slug, v_titulo
    FROM public.formularios
   WHERE id = NEW.formulario_id;

  -- Map slug → categoria de trámite (extensible)
  v_categoria := CASE
    WHEN v_slug = 'consultoria-juridica' THEN 'consulta_juridica'
    ELSE NULL
  END;

  IF v_categoria IS NULL THEN
    RETURN NEW;  -- no auto-creamos
  END IF;

  INSERT INTO public.tramites (
    titulo, categoria, prioridad,
    formulario_submission_id, administracion_id,
    solicitante_nombre, solicitante_email, solicitante_telefono
  )
  VALUES (
    v_titulo || ' · ' || COALESCE(NEW.nombre_contacto, NEW.email_contacto, 'sin contacto'),
    v_categoria,
    'normal',
    NEW.id,
    NEW.administracion_id,
    NEW.nombre_contacto,
    NEW.email_contacto,
    NEW.telefono_contacto
  );

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crear_tramite_desde_submission_auto() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_subm_auto_tramite
  AFTER INSERT ON public.formulario_submissions
  FOR EACH ROW EXECUTE FUNCTION public.crear_tramite_desde_submission_auto();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.tramites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tramite_comentarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tramite_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tramite_adjuntos ENABLE ROW LEVEL SECURITY;

-- tramites: staff full; administrador SELECT/UPDATE de sus trámites
DROP POLICY IF EXISTS tramites_staff_all ON public.tramites;
CREATE POLICY tramites_staff_all ON public.tramites
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS tramites_admin_select ON public.tramites;
CREATE POLICY tramites_admin_select ON public.tramites
  FOR SELECT TO authenticated
  USING (
    administracion_id IS NOT NULL
    AND administracion_id = private.current_administracion_id()
  );

-- comentarios
DROP POLICY IF EXISTS com_staff_all ON public.tramite_comentarios;
CREATE POLICY com_staff_all ON public.tramite_comentarios
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

-- administrador SELECT solo si visible_para in ('cliente','todos') y trámite es suyo
DROP POLICY IF EXISTS com_admin_select ON public.tramite_comentarios;
CREATE POLICY com_admin_select ON public.tramite_comentarios
  FOR SELECT TO authenticated
  USING (
    visible_para IN ('cliente','todos')
    AND EXISTS (
      SELECT 1 FROM public.tramites t
       WHERE t.id = tramite_id
         AND t.administracion_id IS NOT NULL
         AND t.administracion_id = private.current_administracion_id()
    )
  );

-- administrador INSERT (forzando visible_para='todos' y autor_role='administrador')
DROP POLICY IF EXISTS com_admin_insert ON public.tramite_comentarios;
CREATE POLICY com_admin_insert ON public.tramite_comentarios
  FOR INSERT TO authenticated
  WITH CHECK (
    visible_para = 'todos'
    AND autor_role = 'administrador'
    AND autor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tramites t
       WHERE t.id = tramite_id
         AND t.administracion_id IS NOT NULL
         AND t.administracion_id = private.current_administracion_id()
    )
  );

-- eventos: lectura como tramites; INSERT solo desde triggers (no policy de INSERT
-- para roles autenticados — el trigger corre con privilegios de SECURITY DEFINER /
-- bypassa RLS porque inserta como propietario de la función).
DROP POLICY IF EXISTS eventos_staff_select ON public.tramite_eventos;
CREATE POLICY eventos_staff_select ON public.tramite_eventos
  FOR SELECT TO authenticated
  USING (private.is_staff());

DROP POLICY IF EXISTS eventos_admin_select ON public.tramite_eventos;
CREATE POLICY eventos_admin_select ON public.tramite_eventos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tramites t
       WHERE t.id = tramite_id
         AND t.administracion_id IS NOT NULL
         AND t.administracion_id = private.current_administracion_id()
    )
  );

-- adjuntos: igual que comentarios
DROP POLICY IF EXISTS adj_staff_all ON public.tramite_adjuntos;
CREATE POLICY adj_staff_all ON public.tramite_adjuntos
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS adj_admin_select ON public.tramite_adjuntos;
CREATE POLICY adj_admin_select ON public.tramite_adjuntos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tramites t
       WHERE t.id = tramite_id
         AND t.administracion_id IS NOT NULL
         AND t.administracion_id = private.current_administracion_id()
    )
  );

DROP POLICY IF EXISTS adj_admin_insert ON public.tramite_adjuntos;
CREATE POLICY adj_admin_insert ON public.tramite_adjuntos
  FOR INSERT TO authenticated
  WITH CHECK (
    subido_por = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tramites t
       WHERE t.id = tramite_id
         AND t.administracion_id IS NOT NULL
         AND t.administracion_id = private.current_administracion_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Storage bucket 'tramite-adjuntos'
-- Path: <tramite_id>/<filename>
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tramite-adjuntos',
  'tramite-adjuntos',
  false,
  10485760,  -- 10MB
  ARRAY['image/jpeg','image/png','image/webp','application/pdf','application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS tramite_adj_staff_all ON storage.objects;
CREATE POLICY tramite_adj_staff_all ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'tramite-adjuntos' AND private.is_staff())
  WITH CHECK (bucket_id = 'tramite-adjuntos' AND private.is_staff());

-- administrador: puede SELECT/INSERT en sus carpetas (storage_path empieza con
-- un tramite_id de su administracion). Como la verificación per-fila es cara,
-- delegamos la validación al INSERT row de tramite_adjuntos + el cliente sube
-- a path = <tramite_id>/<filename>; verificamos vía join en la policy.
DROP POLICY IF EXISTS tramite_adj_admin_select ON storage.objects;
CREATE POLICY tramite_adj_admin_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'tramite-adjuntos'
    AND EXISTS (
      SELECT 1
        FROM public.tramite_adjuntos a
        JOIN public.tramites t ON t.id = a.tramite_id
       WHERE a.storage_path = storage.objects.name
         AND t.administracion_id IS NOT NULL
         AND t.administracion_id = private.current_administracion_id()
    )
  );

DROP POLICY IF EXISTS tramite_adj_admin_insert ON storage.objects;
CREATE POLICY tramite_adj_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'tramite-adjuntos'
    AND EXISTS (
      SELECT 1 FROM public.tramites t
       WHERE t.id::text = split_part(storage.objects.name, '/', 1)
         AND t.administracion_id IS NOT NULL
         AND t.administracion_id = private.current_administracion_id()
    )
  );
