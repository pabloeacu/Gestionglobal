-- 0752 · DGG-275 F4 · Helper compartido de alta de cliente (dup-check DGG-123)
-- ----------------------------------------------------------------------------
-- Extrae de `solicitud_activar` el bloque "resolver cliente existente o crear
-- uno nuevo con dup-check DGG-123 + INSERT en administraciones" a un helper
-- `private.administracion_resolver_o_crear`, para que el wizard autónomo de
-- F4 ("Presentación de DDJJ externa") consuma EXACTAMENTE la misma lógica de
-- identidad (una sola fuente de verdad). Plan DDJJ §5 (el helper se extrae en
-- F4, donde se consume) + R5 (multi-tabla → RPC SECURITY DEFINER).
--
-- IMPORTANTE (R7): este archivo refactoriza `solicitud_activar` a partir de su
-- definición VIVA (no de 0398, que había driftado: la versión viva ya traía
-- email/nombre en la rama "c", mapeaba `curso-actualizacion-caba`, hacía el
-- override de categoría por `v_servicio.codigo` y recomputaba `solicitante_email`).
-- Al re-versionar la versión viva cerramos ese drift. El refactor preserva el
-- comportamiento observable byte a byte salvo que la resolución de cliente ahora
-- pasa por el helper (verificado e2e en las 3 ramas: a/b/c). R16 OK: misma firma
-- (5 params) → CREATE OR REPLACE no crea overload.

-- ── Helper: resolver (linkear existente) o crear (con dup-check DGG-123) ──
CREATE OR REPLACE FUNCTION private.administracion_resolver_o_crear(
  p_cliente_id uuid,
  p_crear_input jsonb,
  p_fallback_nombre text DEFAULT NULL,
  p_fallback_email text DEFAULT NULL,
  p_fallback_tel text DEFAULT NULL,
  p_codigo_auto text DEFAULT NULL,
  OUT o_administracion_id uuid,
  OUT o_creado boolean,
  OUT o_email text,
  OUT o_nombre text
)
RETURNS record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_new_email text; v_new_cuit text;
  v_dup_id uuid; v_dup_nombre text; v_dup_cuit text;
BEGIN
  o_creado := false;

  -- (a)/(c) Linkear un cliente existente: devolver su email/nombre (idéntico a
  -- las dos ramas "existente" de solicitud_activar).
  IF p_cliente_id IS NOT NULL THEN
    o_administracion_id := p_cliente_id;
    SELECT email, nombre INTO o_email, o_nombre
      FROM public.administraciones WHERE id = o_administracion_id;
    RETURN;
  END IF;

  IF p_crear_input IS NULL THEN
    RAISE EXCEPTION 'administracion_resolver_o_crear: sin cliente ni datos para crear'
      USING ERRCODE = '22023';
  END IF;

  -- (b) Crear cliente nuevo + dup-check DGG-123.
  o_creado := true;
  v_new_email := lower(btrim(COALESCE(NULLIF(p_crear_input->>'email',''), p_fallback_email, '')));
  v_new_cuit  := regexp_replace(COALESCE(p_crear_input->>'cuit',''), '[^0-9]', '', 'g');
  v_dup_id := NULL;

  IF v_new_email <> '' THEN
    SELECT id, nombre, regexp_replace(COALESCE(cuit,''), '[^0-9]', '', 'g')
      INTO v_dup_id, v_dup_nombre, v_dup_cuit
      FROM public.administraciones
     WHERE activo AND email IS NOT NULL AND lower(email) = v_new_email LIMIT 1;
    -- DGG-123 · El CUIT decide la identidad: email igual + ambos CUIT completos
    -- y distintos ⇒ son clientes separados (titular PF vs su sociedad). El email
    -- no puede repetirse porque es el usuario de login del portal.
    IF v_dup_id IS NOT NULL AND length(v_new_cuit) = 11
       AND length(v_dup_cuit) = 11 AND v_dup_cuit <> v_new_cuit THEN
      RAISE EXCEPTION 'Ese email ya es el acceso al portal del cliente "%" (CUIT distinto: son clientes separados según DGG-123). Cargá un correo propio para este cliente — el email es su usuario de login y no puede repetirse.', v_dup_nombre
        USING ERRCODE = '23505';
    END IF;
  END IF;

  IF v_dup_id IS NULL AND length(v_new_cuit) >= 8 THEN
    SELECT id, nombre INTO v_dup_id, v_dup_nombre FROM public.administraciones
     WHERE activo AND cuit IS NOT NULL AND regexp_replace(cuit, '[^0-9]', '', 'g') = v_new_cuit LIMIT 1;
  END IF;

  IF v_dup_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ya existe el cliente "%" con ese email o CUIT. Vinculalo a ese cliente existente en vez de crear uno nuevo (así evitás duplicar el cliente y que el portal no muestre sus trámites).', v_dup_nombre
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.administraciones (
    codigo, nombre, nombre_normalizado, cuit, email, telefono, direccion,
    localidad, provincia, codigo_postal, condicion_iva, domicilio_fiscal, observaciones,
    responsable_nombre, responsable_apellido, estado, activo
  ) VALUES (
    COALESCE(p_crear_input->>'codigo', p_codigo_auto, 'AUTO-' || substring(gen_random_uuid()::text,1,8)),
    COALESCE(p_crear_input->>'nombre', p_fallback_nombre, 'Cliente sin nombre'), '',
    NULLIF(p_crear_input->>'cuit',''),
    COALESCE(NULLIF(p_crear_input->>'email',''), p_fallback_email),
    COALESCE(NULLIF(p_crear_input->>'telefono',''), p_fallback_tel),
    NULLIF(p_crear_input->>'direccion',''), NULLIF(p_crear_input->>'localidad',''),
    NULLIF(p_crear_input->>'provincia',''), NULLIF(p_crear_input->>'codigo_postal',''),
    NULLIF(p_crear_input->>'condicion_iva',''), NULLIF(p_crear_input->>'domicilio_fiscal',''),
    NULLIF(p_crear_input->>'observaciones',''),
    NULLIF(p_crear_input->>'responsable_nombre',''),
    NULLIF(p_crear_input->>'responsable_apellido',''),
    'activo', true
  ) RETURNING id, email, nombre INTO o_administracion_id, o_email, o_nombre;

  RETURN;
END;
$$;

COMMENT ON FUNCTION private.administracion_resolver_o_crear(uuid, jsonb, text, text, text, text)
  IS 'DGG-275 F4 · Fuente única del dup-check DGG-123 + alta de administración. Consumido por solicitud_activar y tramite_ddjj_externa_iniciar. No crea usuario de auth (eso es el edge alta-cliente-portal).';

-- ── Refactor: solicitud_activar usa el helper para resolver el cliente ──
-- (idéntico a la versión viva salvo las 3 ramas de resolución de cliente, que
--  ahora delegan en el helper; el resto del cuerpo queda igual).
CREATE OR REPLACE FUNCTION public.solicitud_activar(
  p_solicitud_id uuid,
  p_cliente_id uuid DEFAULT NULL::uuid,
  p_crear_cliente_input jsonb DEFAULT NULL::jsonb,
  p_periodo text DEFAULT NULL::text,
  p_fecha_inicio date DEFAULT NULL::date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sol public.solicitudes%ROWTYPE; v_cliente uuid; v_servicio public.servicios%ROWTYPE;
  v_tramite_id uuid; v_categoria text; v_titulo text; v_parent_tramite uuid;
  v_email_admin text; v_admin_nombre text; v_es_nuevo boolean := false;
  v_codigo_auto text;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_sol FROM public.solicitudes WHERE id = p_solicitud_id;
  IF v_sol.id IS NULL THEN RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF v_sol.estado = 'activada' THEN RAISE EXCEPTION 'La solicitud ya está activada' USING ERRCODE = '22023'; END IF;

  v_codigo_auto := 'AUTO-' || substring(p_solicitud_id::text,1,8);

  -- Resolución de cliente (3 ramas, ahora vía helper · DGG-123 fuente única):
  --   (a) p_cliente_id → linkear existente
  --   (b) p_crear_cliente_input → crear nuevo con dup-check
  --   (c) ninguno → linkear el cliente pre-asociado de la solicitud
  IF p_cliente_id IS NOT NULL THEN
    SELECT o_administracion_id, o_creado, o_email, o_nombre
      INTO v_cliente, v_es_nuevo, v_email_admin, v_admin_nombre
      FROM private.administracion_resolver_o_crear(
        p_cliente_id, NULL,
        v_sol.solicitante_nombre, v_sol.solicitante_email, v_sol.solicitante_telefono, v_codigo_auto);
  ELSIF p_crear_cliente_input IS NOT NULL THEN
    SELECT o_administracion_id, o_creado, o_email, o_nombre
      INTO v_cliente, v_es_nuevo, v_email_admin, v_admin_nombre
      FROM private.administracion_resolver_o_crear(
        NULL, p_crear_cliente_input,
        v_sol.solicitante_nombre, v_sol.solicitante_email, v_sol.solicitante_telefono, v_codigo_auto);
  ELSE
    -- Rama (c): cliente pre-asociado de la solicitud. Preservamos EXACTO el
    -- comportamiento pre-refactor: si la solicitud no tiene cliente (cliente_id
    -- NULL), se abría el trámite con administracion_id NULL sin error (no se
    -- delega al helper, que exige cliente o datos para crear). E-GG-317.
    IF v_sol.cliente_id IS NOT NULL THEN
      SELECT o_administracion_id, o_creado, o_email, o_nombre
        INTO v_cliente, v_es_nuevo, v_email_admin, v_admin_nombre
        FROM private.administracion_resolver_o_crear(
          v_sol.cliente_id, NULL,
          v_sol.solicitante_nombre, v_sol.solicitante_email, v_sol.solicitante_telefono, v_codigo_auto);
    ELSE
      v_cliente := NULL; v_es_nuevo := false; v_email_admin := NULL; v_admin_nombre := NULL;
    END IF;
  END IF;

  IF v_sol.servicio_solicitado_id IS NOT NULL THEN
    SELECT * INTO v_servicio FROM public.servicios WHERE id = v_sol.servicio_solicitado_id;
  END IF;
  v_categoria := CASE COALESCE(v_sol.servicio_slug,'')
    WHEN 'matriculacion-rpac' THEN 'matricula' WHEN 'renovacion-rpac' THEN 'renovacion'
    WHEN 'certificado-rpac' THEN 'matricula' WHEN 'ddjj-anual' THEN 'dj'
    WHEN 'consultoria-juridica' THEN 'consulta_juridica' WHEN 'curso-formacion' THEN 'curso'
    WHEN 'curso-actualizacion' THEN 'curso' WHEN 'curso-actualizacion-caba' THEN 'curso' ELSE 'otro' END;
  IF v_categoria = 'otro' AND v_servicio.codigo IN ('rpa_actualizacion','curso_actualizacion_rpac','curso_formacion_rpac') THEN v_categoria := 'curso'; END IF;
  v_titulo := COALESCE(v_servicio.nombre, v_sol.servicio_slug, 'Servicio')
    || ' · ' || COALESCE(v_sol.solicitante_nombre, v_admin_nombre, v_sol.solicitante_email, 'sin contacto');
  IF v_cliente IS NOT NULL AND v_sol.servicio_solicitado_id IS NOT NULL THEN
    SELECT t.id INTO v_parent_tramite FROM public.tramites t
     WHERE t.administracion_id = v_cliente AND t.categoria = v_categoria ORDER BY t.created_at DESC LIMIT 1;
  END IF;
  INSERT INTO public.tramites (
    titulo, descripcion, categoria, prioridad, estado, formulario_submission_id, administracion_id,
    solicitante_nombre, solicitante_email, solicitante_telefono, servicio_id, periodo, fecha_inicio, parent_tracking_id, created_by
  ) VALUES (
    v_titulo,
    'Tracking activado desde solicitud ' || p_solicitud_id::text
      || COALESCE(' · período ' || p_periodo, '') || COALESCE(' · inicio ' || p_fecha_inicio::text, '')
      || COALESCE(' · continuación de ' || v_parent_tramite::text, ''),
    v_categoria, 'normal', 'abierto', v_sol.formulario_submission_id, v_cliente,
    v_sol.solicitante_nombre, COALESCE(NULLIF(btrim(v_email_admin),''), v_sol.solicitante_email), v_sol.solicitante_telefono,
    v_sol.servicio_solicitado_id, p_periodo, p_fecha_inicio, v_parent_tramite, auth.uid()
  ) RETURNING id INTO v_tramite_id;
  -- E-GG-130: línea semilla con firma real (7 args) + visible al cliente
  BEGIN
    PERFORM public.tracking_agregar_linea(
      v_tramite_id, 'seguimiento_interno',
      'Trámite iniciado desde tu solicitud. Vamos a ir cargando acá cada avance.'
        || COALESCE(' · Período ' || p_periodo, '') || COALESCE(' · Inicio ' || p_fecha_inicio::text, ''),
      NULL, '{}'::text[], NULL, true);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'seed tracking_linea al activar falló: %', SQLERRM; END;
  IF v_sol.formulario_submission_id IS NOT NULL THEN
    UPDATE public.formulario_submissions SET estado = 'procesado', procesado_at = now(), procesado_por = auth.uid()
     WHERE id = v_sol.formulario_submission_id AND estado <> 'procesado';
  END IF;
  -- E-GG-133: email de activación también al cliente nuevo
  IF v_cliente IS NOT NULL AND v_email_admin IS NOT NULL AND v_email_admin <> '' THEN
    BEGIN
      PERFORM public.encolar_email('nuevo-servicio-activado', v_email_admin, v_admin_nombre,
        jsonb_build_object('nombre', v_admin_nombre,
          'servicio', COALESCE(v_servicio.nombre, v_sol.servicio_slug, 'Servicio'),
          'link_portal', 'https://gestionglobal.ar/portal'),
        v_cliente, NULL, 'tramites', v_tramite_id, 3::smallint);
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'encolar email nuevo-servicio-activado falló: %', SQLERRM; END;
  END IF;
  UPDATE public.solicitudes
     SET estado = 'activada', tramite_id = v_tramite_id, cliente_id = v_cliente,
         solicitante_email = COALESCE(NULLIF(btrim(v_email_admin),''), solicitante_email),
         activada_at = now(), asignada_a = COALESCE(asignada_a, auth.uid())
   WHERE id = p_solicitud_id;
  RETURN v_tramite_id;
END;
$function$;
