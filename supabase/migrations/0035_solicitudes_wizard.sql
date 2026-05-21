-- ============================================================================
-- 0035_solicitudes_wizard · Centro de Solicitudes + Wizard Operativo
--
-- Documento "Flujo Maestro de Solicitudes" puntos 1-8, 18-22.
--
-- Una `solicitud` es la submission del formulario público en su estado
-- pre-procesado (lo que históricamente se llamaba "submission cruda" +
-- el `tramite` que se creaba automáticamente). El wizard de activación
-- la convierte en un tracking real (= `tramites`), opcionalmente creando
-- el cliente y derivando a una gestoría externa.
--
-- Decisiones / referencias:
-- - Regla 1 · toda mutación persistida → RPC SD.
-- - Regla 2 · RLS staff-only (los gestores externos acceden via token de F).
-- - Regla 5 · operaciones multi-tabla en plpgsql.
-- - Regla 6 · cambios de schema versionados.
-- - Regla 8 / E43 · reusamos columnas existentes de `tramites` para vincular
--   (formulario_submission_id, administracion_id, etc.) — no duplicamos.
-- - Regla 11 · índices sobre todas las FKs.
-- - Regla 12 · tenancy: staff-only no requiere assert_administracion_access,
--   pero las RPCs validan `private.is_staff()` antes de operar.
--
-- Contrato con agentes paralelos:
-- - G2 (trackings): si `tracking_agregar_linea` / columnas extra existen
--   cuando se ejecuta esto, las llamamos. Si no, fallback a INSERT directo.
-- - F (acceso externo): si `generar_acceso_externo(p_recurso_tipo, p_recurso_id,
--   p_email_destinatario, p_dias_validez)` existe, lo invocamos. Si no,
--   guardamos token=NULL y placeholder URL — F backfilleará después.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tabla `solicitudes`
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.solicitudes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formulario_submission_id uuid REFERENCES public.formulario_submissions(id) ON DELETE SET NULL,
  tramite_id uuid REFERENCES public.tramites(id) ON DELETE SET NULL,
  cliente_id uuid REFERENCES public.administraciones(id) ON DELETE SET NULL,
  servicio_solicitado_id uuid REFERENCES public.servicios(id) ON DELETE SET NULL,
  estado text NOT NULL DEFAULT 'recibida'
    CHECK (estado IN ('recibida','en_revision','derivada','activada','descartada')),
  solicitante_nombre text,
  solicitante_email text,
  solicitante_telefono text,
  servicio_slug text,
  observaciones text,
  asignada_a uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  derivada_at timestamptz,
  activada_at timestamptz,
  motivo_descarte text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sol_submission ON public.solicitudes(formulario_submission_id) WHERE formulario_submission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sol_tramite    ON public.solicitudes(tramite_id) WHERE tramite_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sol_cliente    ON public.solicitudes(cliente_id) WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sol_servicio   ON public.solicitudes(servicio_solicitado_id) WHERE servicio_solicitado_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sol_asignada   ON public.solicitudes(asignada_a) WHERE asignada_a IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sol_estado     ON public.solicitudes(estado, created_at DESC);
-- Index parcial para la bandeja: lo que aún no se cerró.
CREATE INDEX IF NOT EXISTS idx_sol_bandeja
  ON public.solicitudes(created_at DESC)
  WHERE estado IN ('recibida','en_revision','derivada');

CREATE OR REPLACE FUNCTION public.solicitudes_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_sol_touch ON public.solicitudes;
CREATE TRIGGER trg_sol_touch BEFORE UPDATE ON public.solicitudes
  FOR EACH ROW EXECUTE FUNCTION public.solicitudes_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Tabla `solicitud_derivaciones`
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.solicitud_derivaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id uuid NOT NULL REFERENCES public.solicitudes(id) ON DELETE CASCADE,
  destinatario_email text NOT NULL,
  destinatario_nombre text,
  plantilla_email_slug text,
  observaciones text,
  acceso_externo_token text,
  acceso_externo_url text,
  enviada_at timestamptz NOT NULL DEFAULT now(),
  email_queue_id uuid REFERENCES public.email_queue(id) ON DELETE SET NULL,
  creada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_solder_solicitud ON public.solicitud_derivaciones(solicitud_id, enviada_at DESC);
CREATE INDEX IF NOT EXISTS idx_solder_email_q   ON public.solicitud_derivaciones(email_queue_id) WHERE email_queue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_solder_creada_por ON public.solicitud_derivaciones(creada_por) WHERE creada_por IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) RLS · staff-only (regla 2)
-- ---------------------------------------------------------------------------
ALTER TABLE public.solicitudes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitud_derivaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sol_staff_all ON public.solicitudes;
CREATE POLICY sol_staff_all ON public.solicitudes
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS solder_staff_all ON public.solicitud_derivaciones;
CREATE POLICY solder_staff_all ON public.solicitud_derivaciones
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

-- ---------------------------------------------------------------------------
-- 4) Trigger nuevo: form_submission → solicitud (NO más trámite auto)
--
-- Reemplaza el comportamiento de `crear_tramite_desde_submission_auto` (mig
-- 0021 + 0023): ahora crea una **solicitud** en estado 'recibida' que el
-- gerente convierte en tracking via el wizard.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_tramite_desde_submission_auto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_form record;
  v_apellido text;
  v_nombre text;
  v_nombre_completo text;
BEGIN
  SELECT id, slug, titulo, categoria, servicio_id
    INTO v_form
    FROM public.formularios
   WHERE id = NEW.formulario_id;

  -- Solo procesamos categorías que requieren acción operativa.
  IF v_form.categoria NOT IN ('tramite','servicio','consulta') THEN
    RETURN NEW;
  END IF;

  v_apellido := NULLIF(trim(COALESCE(NEW.datos->>'apellido', '')), '');
  v_nombre   := NULLIF(trim(COALESCE(NEW.datos->>'nombre', '')), '');
  v_nombre_completo := COALESCE(
    NEW.nombre_contacto,
    NULLIF(trim(concat_ws(' ', v_apellido, v_nombre)), ''),
    NEW.email_contacto,
    'sin contacto'
  );

  INSERT INTO public.solicitudes (
    formulario_submission_id, servicio_solicitado_id,
    solicitante_nombre, solicitante_email, solicitante_telefono,
    servicio_slug, estado, cliente_id
  )
  VALUES (
    NEW.id, v_form.servicio_id,
    v_nombre_completo, NEW.email_contacto, NEW.telefono_contacto,
    v_form.slug, 'recibida', NEW.administracion_id
  );

  RETURN NEW;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.crear_tramite_desde_submission_auto() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.crear_tramite_desde_submission_auto() IS
  '0035 · Reemplaza el trigger original (0021/0023). Ahora crea SOLICITUDES '
  'en estado recibida en vez de trámites. El gerente activa via wizard.';

-- El trigger trg_subm_auto_tramite (0021) sigue apuntando a esta función.

-- ---------------------------------------------------------------------------
-- 5) Backfill: convertir trámites pre-existentes en solicitudes activadas
-- ---------------------------------------------------------------------------
INSERT INTO public.solicitudes (
  formulario_submission_id, tramite_id, cliente_id,
  solicitante_nombre, solicitante_email, solicitante_telefono,
  estado, activada_at, created_at
)
SELECT t.formulario_submission_id, t.id, t.administracion_id,
       t.solicitante_nombre, t.solicitante_email, t.solicitante_telefono,
       'activada', t.created_at, t.created_at
FROM public.tramites t
WHERE t.formulario_submission_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.solicitudes s
     WHERE s.tramite_id = t.id OR s.formulario_submission_id = t.formulario_submission_id
  );

-- ---------------------------------------------------------------------------
-- 6) Seed email templates · solicitud-derivada-gestoria + nuevo-servicio-activado
-- ---------------------------------------------------------------------------
INSERT INTO public.email_templates
  (slug, nombre, asunto, body_html, body_text, from_casilla, descripcion, variables)
VALUES
  ('solicitud-derivada-gestoria',
   'Derivación a gestoría externa',
   'Nueva derivación de Gestión Global: {{servicio}}',
   '<h2>Hola {{destinatario_nombre}}</h2>'
   '<p>Te derivamos una nueva solicitud desde Gestión Global.</p>'
   '<p><strong>Servicio:</strong> {{servicio}}<br>'
   '<strong>Solicitante:</strong> {{solicitante_nombre}}<br>'
   '<strong>Email:</strong> {{solicitante_email}}</p>'
   '<p>{{observaciones}}</p>'
   '<p>Accedé a la documentación completa con este link seguro: '
   '<a href="{{acceso_url}}">{{acceso_url}}</a></p>'
   '<p>Cualquier duda, respondé este correo.</p>'
   '<p><strong>Gestión Global</strong></p>',
   'Hola {{destinatario_nombre}}, te derivamos una solicitud: {{servicio}} '
   'para {{solicitante_nombre}}. Accedé con: {{acceso_url}}',
   'tramites',
   'Email a gestoría externa con link seguro de acceso (token F).',
   '["destinatario_nombre","servicio","solicitante_nombre","solicitante_email","observaciones","acceso_url"]'::jsonb
  ),
  ('nuevo-servicio-activado',
   'Nuevo servicio activado para cliente existente',
   'Activamos un nuevo servicio: {{servicio}}',
   '<h2>Hola {{nombre}}</h2>'
   '<p>Te confirmamos que activamos un nuevo servicio en tu cuenta:</p>'
   '<p><strong>{{servicio}}</strong></p>'
   '<p>Podés ver el tracking completo desde tu portal: '
   '<a href="{{link_portal}}">{{link_portal}}</a></p>'
   '<p>Cualquier consulta, respondé este correo.</p>'
   '<p><strong>Gestión Global</strong></p>',
   'Hola {{nombre}}, activamos el servicio {{servicio}}. Tracking: {{link_portal}}',
   'tramites',
   'Aviso al cliente existente cuando se activa un servicio adicional.',
   '["nombre","servicio","link_portal"]'::jsonb
  )
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7) RPC · solicitud_marcar_en_revision
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.solicitud_marcar_en_revision(
  p_solicitud_id uuid,
  p_observaciones text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501';
  END IF;
  UPDATE public.solicitudes
     SET estado = 'en_revision',
         asignada_a = COALESCE(asignada_a, auth.uid()),
         observaciones = COALESCE(p_observaciones, observaciones)
   WHERE id = p_solicitud_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.solicitud_marcar_en_revision(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.solicitud_marcar_en_revision(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8) RPC · solicitud_derivar
--
-- Crea una fila en `solicitud_derivaciones`, intenta generar token de acceso
-- externo (RPC de F, opcional), encola el email y marca la solicitud como
-- 'derivada'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.solicitud_derivar(
  p_solicitud_id        uuid,
  p_destinatario_email  text,
  p_destinatario_nombre text,
  p_plantilla_slug      text DEFAULT 'solicitud-derivada-gestoria',
  p_observaciones       text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_sol     public.solicitudes%ROWTYPE;
  v_servicio_nombre text;
  v_token   text;
  v_url     text;
  v_email_id uuid;
  v_der_id  uuid;
  v_vars    jsonb;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sol FROM public.solicitudes WHERE id = p_solicitud_id;
  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;

  -- Servicio (nombre) para variables del email.
  IF v_sol.servicio_solicitado_id IS NOT NULL THEN
    SELECT nombre INTO v_servicio_nombre FROM public.servicios WHERE id = v_sol.servicio_solicitado_id;
  END IF;
  v_servicio_nombre := COALESCE(v_servicio_nombre, v_sol.servicio_slug, 'Servicio');

  -- Intentamos generar el token de acceso externo (F). Si la RPC no existe
  -- todavía, dejamos token NULL y placeholder URL — F backfilleará luego.
  BEGIN
    EXECUTE 'SELECT public.generar_acceso_externo($1,$2,$3,$4)'
      INTO v_token
      USING 'solicitud', p_solicitud_id, p_destinatario_email, 7;
    v_url := 'https://gestionglobal.ar/acceso/' || v_token;
  EXCEPTION WHEN OTHERS THEN
    v_token := NULL;
    v_url   := 'https://gestionglobal.ar/acceso/pendiente?solicitud=' || p_solicitud_id::text;
  END;

  v_vars := jsonb_build_object(
    'destinatario_nombre', COALESCE(p_destinatario_nombre, split_part(p_destinatario_email,'@',1)),
    'servicio',            v_servicio_nombre,
    'solicitante_nombre',  COALESCE(v_sol.solicitante_nombre, ''),
    'solicitante_email',   COALESCE(v_sol.solicitante_email, ''),
    'observaciones',       COALESCE(p_observaciones, ''),
    'acceso_url',          v_url
  );

  BEGIN
    v_email_id := public.encolar_email(
      p_plantilla_slug, p_destinatario_email, p_destinatario_nombre,
      v_vars, NULL, NULL, 'solicitudes', p_solicitud_id, 3::smallint
    );
  EXCEPTION WHEN OTHERS THEN
    v_email_id := NULL;
  END;

  INSERT INTO public.solicitud_derivaciones (
    solicitud_id, destinatario_email, destinatario_nombre,
    plantilla_email_slug, observaciones,
    acceso_externo_token, acceso_externo_url,
    email_queue_id, creada_por
  )
  VALUES (
    p_solicitud_id, p_destinatario_email, p_destinatario_nombre,
    p_plantilla_slug, p_observaciones,
    v_token, v_url, v_email_id, auth.uid()
  )
  RETURNING id INTO v_der_id;

  UPDATE public.solicitudes
     SET estado = 'derivada',
         derivada_at = COALESCE(derivada_at, now()),
         asignada_a = COALESCE(asignada_a, auth.uid())
   WHERE id = p_solicitud_id;

  RETURN v_der_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.solicitud_derivar(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.solicitud_derivar(uuid, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9) RPC · solicitud_descartar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.solicitud_descartar(
  p_solicitud_id uuid,
  p_motivo text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501';
  END IF;
  UPDATE public.solicitudes
     SET estado = 'descartada',
         motivo_descarte = p_motivo,
         asignada_a = COALESCE(asignada_a, auth.uid())
   WHERE id = p_solicitud_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.solicitud_descartar(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.solicitud_descartar(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10) RPC · solicitud_activar
--
-- Crea (o vincula) cliente, crea el tracking (`tramites`) y marca la
-- solicitud como 'activada'. Encola email de bienvenida o de servicio nuevo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.solicitud_activar(
  p_solicitud_id        uuid,
  p_cliente_id          uuid    DEFAULT NULL,
  p_crear_cliente_input jsonb   DEFAULT NULL,
  p_periodo             text    DEFAULT NULL,
  p_fecha_inicio        date    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_sol     public.solicitudes%ROWTYPE;
  v_subm    public.formulario_submissions%ROWTYPE;
  v_cliente uuid;
  v_servicio public.servicios%ROWTYPE;
  v_tramite_id uuid;
  v_categoria text;
  v_titulo text;
  v_parent_tramite uuid;
  v_email_admin text;
  v_admin_nombre text;
  v_es_nuevo boolean := false;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sol FROM public.solicitudes WHERE id = p_solicitud_id;
  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_sol.estado = 'activada' THEN
    RAISE EXCEPTION 'La solicitud ya está activada' USING ERRCODE = '22023';
  END IF;

  -- A) Cliente (existente o nuevo)
  IF p_cliente_id IS NOT NULL THEN
    v_cliente := p_cliente_id;
    SELECT email, nombre INTO v_email_admin, v_admin_nombre
      FROM public.administraciones WHERE id = v_cliente;
  ELSIF p_crear_cliente_input IS NOT NULL THEN
    v_es_nuevo := true;
    INSERT INTO public.administraciones (
      codigo, nombre, nombre_normalizado, cuit, email, telefono, direccion,
      localidad, provincia, codigo_postal, observaciones, estado, activo
    )
    VALUES (
      COALESCE(p_crear_cliente_input->>'codigo', 'AUTO-' || substring(p_solicitud_id::text,1,8)),
      COALESCE(p_crear_cliente_input->>'nombre', v_sol.solicitante_nombre, 'Cliente sin nombre'),
      '',
      NULLIF(p_crear_cliente_input->>'cuit',''),
      COALESCE(NULLIF(p_crear_cliente_input->>'email',''), v_sol.solicitante_email),
      COALESCE(NULLIF(p_crear_cliente_input->>'telefono',''), v_sol.solicitante_telefono),
      NULLIF(p_crear_cliente_input->>'direccion',''),
      NULLIF(p_crear_cliente_input->>'localidad',''),
      NULLIF(p_crear_cliente_input->>'provincia',''),
      NULLIF(p_crear_cliente_input->>'codigo_postal',''),
      NULLIF(p_crear_cliente_input->>'observaciones',''),
      'activo', true
    )
    RETURNING id, email, nombre INTO v_cliente, v_email_admin, v_admin_nombre;
  ELSE
    -- Activación sin cliente (caso "consulta puntual sin cliente").
    v_cliente := v_sol.cliente_id;
  END IF;

  -- B) Servicio + categoria del trámite
  IF v_sol.servicio_solicitado_id IS NOT NULL THEN
    SELECT * INTO v_servicio FROM public.servicios WHERE id = v_sol.servicio_solicitado_id;
  END IF;

  v_categoria := CASE COALESCE(v_sol.servicio_slug,'')
    WHEN 'matriculacion-rpac'    THEN 'matricula'
    WHEN 'renovacion-rpac'       THEN 'renovacion'
    WHEN 'certificado-rpac'      THEN 'matricula'
    WHEN 'ddjj-anual'            THEN 'dj'
    WHEN 'consultoria-juridica'  THEN 'consulta_juridica'
    WHEN 'curso-formacion'       THEN 'curso'
    WHEN 'curso-actualizacion'   THEN 'curso'
    ELSE 'otro'
  END;

  v_titulo := COALESCE(v_servicio.nombre, v_sol.servicio_slug, 'Servicio')
            || ' · '
            || COALESCE(v_sol.solicitante_nombre, v_admin_nombre, v_sol.solicitante_email, 'sin contacto');

  -- C) Detectar parent tracking (mismo cliente + mismo servicio, último)
  IF v_cliente IS NOT NULL AND v_sol.servicio_solicitado_id IS NOT NULL THEN
    SELECT t.id INTO v_parent_tramite
      FROM public.tramites t
     WHERE t.administracion_id = v_cliente
       AND t.categoria = v_categoria
     ORDER BY t.created_at DESC
     LIMIT 1;
  END IF;

  -- D) Crear el tracking (= `tramites`)
  INSERT INTO public.tramites (
    titulo, descripcion, categoria, prioridad, estado,
    formulario_submission_id, administracion_id,
    solicitante_nombre, solicitante_email, solicitante_telefono,
    created_by
  )
  VALUES (
    v_titulo,
    'Tracking activado desde solicitud ' || p_solicitud_id::text
      || COALESCE(' · período ' || p_periodo, '')
      || COALESCE(' · inicio ' || p_fecha_inicio::text, '')
      || COALESCE(' · continuación de ' || v_parent_tramite::text, ''),
    v_categoria, 'normal', 'abierto',
    v_sol.formulario_submission_id, v_cliente,
    v_sol.solicitante_nombre, v_sol.solicitante_email, v_sol.solicitante_telefono,
    auth.uid()
  )
  RETURNING id INTO v_tramite_id;

  -- E) Opcional: si G2 ya creó `tracking_agregar_linea`, agregamos línea con
  --    el detalle (periodo / fecha_inicio). Si no, dejamos pasar.
  BEGIN
    EXECUTE 'SELECT public.tracking_agregar_linea($1,$2,$3,$4,$5)'
      USING v_tramite_id,
            v_sol.servicio_solicitado_id,
            p_periodo,
            p_fecha_inicio,
            v_parent_tramite;
  EXCEPTION WHEN OTHERS THEN
    -- contrato no existe aún · noop
    NULL;
  END;

  -- F) Marcar submission como procesada
  IF v_sol.formulario_submission_id IS NOT NULL THEN
    UPDATE public.formulario_submissions
       SET estado = 'procesado',
           procesado_at = now(),
           procesado_por = auth.uid()
     WHERE id = v_sol.formulario_submission_id
       AND estado <> 'procesado';
  END IF;

  -- G) Email: bienvenida (cliente nuevo) o nuevo-servicio (existente)
  IF v_cliente IS NOT NULL AND v_email_admin IS NOT NULL AND v_email_admin <> '' THEN
    BEGIN
      IF v_es_nuevo THEN
        PERFORM public.encolar_email(
          'bienvenida-administracion',
          v_email_admin,
          v_admin_nombre,
          jsonb_build_object(
            'nombre_administracion', v_admin_nombre,
            'email_user', v_email_admin
          ),
          v_cliente, NULL, 'administraciones', v_cliente, 3::smallint
        );
      ELSE
        PERFORM public.encolar_email(
          'nuevo-servicio-activado',
          v_email_admin,
          v_admin_nombre,
          jsonb_build_object(
            'nombre',       v_admin_nombre,
            'servicio',     COALESCE(v_servicio.nombre, v_sol.servicio_slug, 'Servicio'),
            'link_portal',  'https://gestionglobal.ar/portal'
          ),
          v_cliente, NULL, 'tramites', v_tramite_id, 3::smallint
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- mail opcional · no rompemos la activación
      NULL;
    END;
  END IF;

  -- H) Cerrar la solicitud
  UPDATE public.solicitudes
     SET estado     = 'activada',
         tramite_id = v_tramite_id,
         cliente_id = v_cliente,
         activada_at = now(),
         asignada_a = COALESCE(asignada_a, auth.uid())
   WHERE id = p_solicitud_id;

  RETURN v_tramite_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.solicitud_activar(uuid, uuid, jsonb, text, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.solicitud_activar(uuid, uuid, jsonb, text, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 11) Realtime · publicar la tabla solicitudes para refresh en UI
-- ---------------------------------------------------------------------------
DO $do$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='solicitudes'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.solicitudes';
  END IF;
EXCEPTION WHEN OTHERS THEN NULL; END $do$;
