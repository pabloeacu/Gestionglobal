-- ============================================================================
-- 0398 · DGG-123 §6 — Hardening PF/PJ post-auditoría (agentes A/B/C)
--
-- B#1 (GAP serio): el veto por CUIT de 0397 en solicitud_match_cliente dejó
--   una contradicción con el bloqueo duro de solicitud_activar (E-GG-130 /
--   0351): el match ya NO sugiere al cliente PF cuando el email coincide pero
--   el CUIT difiere, pero al elegir "cliente nuevo" el guard reventaba con el
--   23505 genérico "Ya existe el cliente…" — flujo muerto sin explicación.
--   Doctrina DGG-123: CUIT distinto ⇒ cliente distinto. El email sigue sin
--   poder repetirse (es el usuario de login del portal), pero ahora el error
--   lo dice y explica qué hacer. Mismo caso con mismo CUIT ⇒ mensaje clásico
--   de "vinculá al existente".
-- B#2 (menor): p_crear_cliente_input ya viaja con responsable_nombre/apellido
--   (prefill del titular ARCA en PJ) pero el INSERT los ignoraba.
-- B#3 (menor): `domicilio_empresa` (renovación/certificado PJ) no entraba en
--   el armado de `direccion` de los 2 triggers de backfill (patrón E-GG-114).
-- B#4 (DUDA cerrada en conservador): un cliente PF logueado que envía un form
--   declarando "Persona jurídica" ya no backfillea el CUIT de la EMPRESA
--   sobre SU ficha (sync JWT-linked). El backfill vía trámite (gerencia eligió
--   la admin a mano) se mantiene intacto.
--
-- R16: todas las firmas quedan idénticas ⇒ CREATE OR REPLACE es seguro.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.solicitud_activar(p_solicitud_id uuid, p_cliente_id uuid DEFAULT NULL::uuid, p_crear_cliente_input jsonb DEFAULT NULL::jsonb, p_periodo text DEFAULT NULL::text, p_fecha_inicio date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sol public.solicitudes%ROWTYPE; v_cliente uuid; v_servicio public.servicios%ROWTYPE;
  v_tramite_id uuid; v_categoria text; v_titulo text; v_parent_tramite uuid;
  v_email_admin text; v_admin_nombre text; v_es_nuevo boolean := false;
  v_new_email text; v_new_cuit text; v_dup_id uuid; v_dup_nombre text; v_dup_cuit text;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_sol FROM public.solicitudes WHERE id = p_solicitud_id;
  IF v_sol.id IS NULL THEN RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF v_sol.estado = 'activada' THEN RAISE EXCEPTION 'La solicitud ya está activada' USING ERRCODE = '22023'; END IF;
  IF p_cliente_id IS NOT NULL THEN
    v_cliente := p_cliente_id;
    SELECT email, nombre INTO v_email_admin, v_admin_nombre FROM public.administraciones WHERE id = v_cliente;
  ELSIF p_crear_cliente_input IS NOT NULL THEN
    v_es_nuevo := true;
    v_new_email := lower(btrim(COALESCE(NULLIF(p_crear_cliente_input->>'email',''), v_sol.solicitante_email, '')));
    v_new_cuit  := regexp_replace(COALESCE(p_crear_cliente_input->>'cuit',''), '[^0-9]', '', 'g');
    v_dup_id := NULL;
    IF v_new_email <> '' THEN
      SELECT id, nombre, regexp_replace(COALESCE(cuit,''), '[^0-9]', '', 'g')
        INTO v_dup_id, v_dup_nombre, v_dup_cuit
        FROM public.administraciones
       WHERE activo AND email IS NOT NULL AND lower(email) = v_new_email LIMIT 1;
      -- DGG-123 · El CUIT decide la identidad: si ambos CUITs están completos
      -- y DIFIEREN, es OTRO cliente (titular PF vs su sociedad). El email
      -- igual no puede repetirse porque es el usuario de acceso al portal —
      -- pero el error ahora lo explica en vez del 23505 genérico.
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
      RAISE EXCEPTION 'Ya existe el cliente "%" con ese email o CUIT. Vinculá la solicitud a ese cliente existente en vez de crear uno nuevo (así evitás duplicar el cliente y que el portal no muestre sus trámites).', v_dup_nombre USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.administraciones (
      codigo, nombre, nombre_normalizado, cuit, email, telefono, direccion,
      localidad, provincia, codigo_postal, condicion_iva, domicilio_fiscal, observaciones,
      responsable_nombre, responsable_apellido, estado, activo
    ) VALUES (
      COALESCE(p_crear_cliente_input->>'codigo', 'AUTO-' || substring(p_solicitud_id::text,1,8)),
      COALESCE(p_crear_cliente_input->>'nombre', v_sol.solicitante_nombre, 'Cliente sin nombre'), '',
      NULLIF(p_crear_cliente_input->>'cuit',''),
      COALESCE(NULLIF(p_crear_cliente_input->>'email',''), v_sol.solicitante_email),
      COALESCE(NULLIF(p_crear_cliente_input->>'telefono',''), v_sol.solicitante_telefono),
      NULLIF(p_crear_cliente_input->>'direccion',''), NULLIF(p_crear_cliente_input->>'localidad',''),
      NULLIF(p_crear_cliente_input->>'provincia',''), NULLIF(p_crear_cliente_input->>'codigo_postal',''),
      NULLIF(p_crear_cliente_input->>'condicion_iva',''), NULLIF(p_crear_cliente_input->>'domicilio_fiscal',''),
      NULLIF(p_crear_cliente_input->>'observaciones',''),
      -- DGG-123 (B#2): en PJ estos vienen prefilleados con el titular ARCA.
      NULLIF(p_crear_cliente_input->>'responsable_nombre',''),
      NULLIF(p_crear_cliente_input->>'responsable_apellido',''),
      'activo', true
    ) RETURNING id, email, nombre INTO v_cliente, v_email_admin, v_admin_nombre;
  ELSE
    v_cliente := v_sol.cliente_id;
  END IF;
  IF v_sol.servicio_solicitado_id IS NOT NULL THEN
    SELECT * INTO v_servicio FROM public.servicios WHERE id = v_sol.servicio_solicitado_id;
  END IF;
  v_categoria := CASE COALESCE(v_sol.servicio_slug,'')
    WHEN 'matriculacion-rpac' THEN 'matricula' WHEN 'renovacion-rpac' THEN 'renovacion'
    WHEN 'certificado-rpac' THEN 'matricula' WHEN 'ddjj-anual' THEN 'dj'
    WHEN 'consultoria-juridica' THEN 'consulta_juridica' WHEN 'curso-formacion' THEN 'curso'
    WHEN 'curso-actualizacion' THEN 'curso' ELSE 'otro' END;
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
    v_sol.solicitante_nombre, v_sol.solicitante_email, v_sol.solicitante_telefono,
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
         activada_at = now(), asignada_a = COALESCE(asignada_a, auth.uid())
   WHERE id = p_solicitud_id;
  RETURN v_tramite_id;
END;
$function$;

-- ----------------------------------------------------------------------------
-- B#3 · backfill vía trámite: domicilio_empresa como fallback de direccion.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.backfill_admin_desde_tramite_submission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_datos jsonb;
  v_padre text; v_madre text; v_legajo text; v_clave text; v_matric text;
  v_cuit text; v_tel text; v_nombre text; v_apellido text; v_dni text;
  v_whatsapp text; v_direccion text;
  v_localidad text; v_provincia text; v_cp text; v_cond_iva text; v_dom_fiscal text;
BEGIN
  IF NEW.administracion_id IS NULL OR NEW.formulario_submission_id IS NULL THEN RETURN NEW; END IF;
  SELECT datos INTO v_datos FROM public.formulario_submissions WHERE id = NEW.formulario_submission_id;
  IF v_datos IS NULL OR jsonb_typeof(v_datos) <> 'object' THEN RETURN NEW; END IF;

  v_padre  := NULLIF(trim(v_datos->>'padre_apellido_nombre'), '');
  v_madre  := NULLIF(trim(v_datos->>'madre_apellido_nombre'), '');
  v_legajo := NULLIF(trim(v_datos->>'legajo_rpac'), '');
  v_clave  := NULLIF(trim(v_datos->>'clave_fiscal_arca'), '');
  v_matric := COALESCE(NULLIF(trim(v_datos->>'matricula_rpac'),''), NULLIF(trim(v_datos->>'matricula'),''));
  v_cuit   := regexp_replace(COALESCE(NULLIF(v_datos->>'cuit',''), v_datos->>'cuit_persona_juridica', ''), '[^0-9]', '', 'g');
  IF length(v_cuit) <> 11 THEN v_cuit := NULL; END IF;
  v_tel    := COALESCE(NULLIF(trim(v_datos->>'celular'), ''), NULLIF(trim(v_datos->>'telefono'), ''));
  v_nombre   := COALESCE(NULLIF(trim(v_datos->>'nombre'), ''), NULLIF(trim(v_datos->>'representante_legal_nombre'), ''));
  v_apellido := NULLIF(trim(v_datos->>'apellido'), '');
  v_dni      := regexp_replace(COALESCE(NULLIF(v_datos->>'dni',''), v_datos->>'representante_legal_dni', ''), '[^0-9]', '', 'g');
  IF length(v_dni) NOT BETWEEN 7 AND 8 THEN v_dni := NULL; END IF;
  v_whatsapp := COALESCE(NULLIF(trim(v_datos->>'whatsapp'), ''), NULLIF(trim(v_datos->>'celular'), ''));
  v_direccion := NULLIF(trim(concat_ws(' ',
    NULLIF(trim(v_datos->>'calle'), ''),
    NULLIF(trim(v_datos->>'numero'), ''),
    CASE WHEN NULLIF(trim(v_datos->>'piso'), '') IS NOT NULL THEN 'Piso ' || trim(v_datos->>'piso') END,
    CASE WHEN COALESCE(NULLIF(trim(v_datos->>'depto'),''), NULLIF(trim(v_datos->>'departamento'),'')) IS NOT NULL
      THEN 'Depto ' || COALESCE(NULLIF(trim(v_datos->>'depto'),''), trim(v_datos->>'departamento')) END
  )), '');
  -- DGG-123 (B#3): renovación/certificado PJ traen la sede social en un campo
  -- único `domicilio_empresa` (sin calle/numero) — mismo patrón E-GG-114.
  v_direccion := COALESCE(v_direccion, NULLIF(trim(v_datos->>'domicilio_empresa'), ''));
  v_localidad  := NULLIF(trim(v_datos->>'localidad'), '');
  v_provincia  := NULLIF(trim(v_datos->>'provincia'), '');
  v_cp         := NULLIF(trim(v_datos->>'codigo_postal'), '');
  v_cond_iva   := NULLIF(trim(v_datos->>'condicion_iva'), '');
  v_dom_fiscal := NULLIF(trim(v_datos->>'domicilio_fiscal'), '');

  BEGIN
    UPDATE public.administraciones SET
      padre_apellido_nombre = COALESCE(padre_apellido_nombre, v_padre),
      madre_apellido_nombre = COALESCE(madre_apellido_nombre, v_madre),
      legajo_rpac           = COALESCE(legajo_rpac, v_legajo),
      clave_fiscal_arca     = COALESCE(clave_fiscal_arca, v_clave),
      matricula_rpac        = COALESCE(matricula_rpac, v_matric),
      cuit                  = COALESCE(cuit, v_cuit),
      telefono              = COALESCE(telefono, v_tel),
      responsable_nombre    = COALESCE(responsable_nombre, v_nombre),
      responsable_apellido  = COALESCE(responsable_apellido, v_apellido),
      responsable_dni       = COALESCE(responsable_dni, v_dni),
      whatsapp              = COALESCE(whatsapp, v_whatsapp),
      direccion             = COALESCE(direccion, v_direccion),
      localidad             = COALESCE(localidad, v_localidad),
      provincia             = COALESCE(provincia, v_provincia),
      codigo_postal         = COALESCE(codigo_postal, v_cp),
      condicion_iva         = COALESCE(condicion_iva, v_cond_iva),
      domicilio_fiscal      = COALESCE(domicilio_fiscal, v_dom_fiscal),
      updated_at            = now()
    WHERE id = NEW.administracion_id;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END $function$;

-- ----------------------------------------------------------------------------
-- B#3 + B#4 · sync JWT-linked: domicilio_empresa como fallback + un cliente
-- logueado que declara "Persona jurídica" NO backfillea el CUIT de la empresa
-- sobre su propia ficha (podría ser la cuenta PF del titular con cuit NULL —
-- la identidad por CUIT es sagrada, DGG-123). Si la cuenta ES la PJ, su cuit
-- ya está cargado y el COALESCE era no-op igual.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_submission_a_administracion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_padre text; v_madre text; v_legajo text; v_clave text; v_matric text;
  v_cuit text; v_tel text; v_nombre text; v_apellido text; v_dni text;
  v_whatsapp text; v_direccion text;
  v_localidad text; v_provincia text; v_cp text; v_cond_iva text; v_dom_fiscal text;
BEGIN
  IF NEW.administracion_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.datos IS NULL OR jsonb_typeof(NEW.datos) <> 'object' THEN RETURN NEW; END IF;

  v_padre  := NULLIF(trim(NEW.datos->>'padre_apellido_nombre'), '');
  v_madre  := NULLIF(trim(NEW.datos->>'madre_apellido_nombre'), '');
  v_legajo := NULLIF(trim(NEW.datos->>'legajo_rpac'), '');
  v_clave  := NULLIF(trim(NEW.datos->>'clave_fiscal_arca'), '');
  v_matric := COALESCE(NULLIF(trim(NEW.datos->>'matricula_rpac'),''), NULLIF(trim(NEW.datos->>'matricula'),''));
  v_cuit   := regexp_replace(COALESCE(NULLIF(NEW.datos->>'cuit',''), NEW.datos->>'cuit_persona_juridica', ''), '[^0-9]', '', 'g');
  IF length(v_cuit) <> 11 THEN v_cuit := NULL; END IF;
  -- DGG-123 (B#4): submission declarada jurídica desde el portal → el CUIT
  -- que viaja es el de la EMPRESA; no se backfillea sobre la cuenta logueada.
  IF NEW.datos->>'tipo_persona_solicitante' = 'Persona jurídica' THEN
    v_cuit := NULL;
  END IF;
  v_tel    := COALESCE(NULLIF(trim(NEW.datos->>'celular'), ''), NULLIF(trim(NEW.datos->>'telefono'), ''));
  v_nombre   := COALESCE(NULLIF(trim(NEW.datos->>'nombre'), ''), NULLIF(trim(NEW.datos->>'representante_legal_nombre'), ''));
  v_apellido := NULLIF(trim(NEW.datos->>'apellido'), '');
  v_dni      := regexp_replace(COALESCE(NULLIF(NEW.datos->>'dni',''), NEW.datos->>'representante_legal_dni', ''), '[^0-9]', '', 'g');
  IF length(v_dni) NOT BETWEEN 7 AND 8 THEN v_dni := NULL; END IF;
  v_whatsapp := COALESCE(NULLIF(trim(NEW.datos->>'whatsapp'), ''), NULLIF(trim(NEW.datos->>'celular'), ''));
  v_direccion := NULLIF(trim(concat_ws(' ',
    NULLIF(trim(NEW.datos->>'calle'), ''),
    NULLIF(trim(NEW.datos->>'numero'), ''),
    CASE WHEN NULLIF(trim(NEW.datos->>'piso'), '') IS NOT NULL THEN 'Piso ' || trim(NEW.datos->>'piso') END,
    CASE WHEN COALESCE(NULLIF(trim(NEW.datos->>'depto'),''), NULLIF(trim(NEW.datos->>'departamento'),'')) IS NOT NULL
      THEN 'Depto ' || COALESCE(NULLIF(trim(NEW.datos->>'depto'),''), trim(NEW.datos->>'departamento')) END
  )), '');
  -- DGG-123 (B#3): sede social en campo único (renovación/certificado PJ).
  v_direccion := COALESCE(v_direccion, NULLIF(trim(NEW.datos->>'domicilio_empresa'), ''));
  v_localidad  := NULLIF(trim(NEW.datos->>'localidad'), '');
  v_provincia  := NULLIF(trim(NEW.datos->>'provincia'), '');
  v_cp         := NULLIF(trim(NEW.datos->>'codigo_postal'), '');
  v_cond_iva   := NULLIF(trim(NEW.datos->>'condicion_iva'), '');
  v_dom_fiscal := NULLIF(trim(NEW.datos->>'domicilio_fiscal'), '');

  IF v_padre IS NULL AND v_madre IS NULL AND v_legajo IS NULL AND v_clave IS NULL
     AND v_matric IS NULL AND v_cuit IS NULL AND v_tel IS NULL AND v_nombre IS NULL
     AND v_apellido IS NULL AND v_dni IS NULL AND v_whatsapp IS NULL AND v_direccion IS NULL
     AND v_localidad IS NULL AND v_provincia IS NULL AND v_cp IS NULL
     AND v_cond_iva IS NULL AND v_dom_fiscal IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    UPDATE public.administraciones SET
      padre_apellido_nombre = COALESCE(padre_apellido_nombre, v_padre),
      madre_apellido_nombre = COALESCE(madre_apellido_nombre, v_madre),
      legajo_rpac           = COALESCE(legajo_rpac, v_legajo),
      clave_fiscal_arca     = COALESCE(clave_fiscal_arca, v_clave),
      matricula_rpac        = COALESCE(matricula_rpac, v_matric),
      cuit                  = COALESCE(cuit, v_cuit),
      telefono              = COALESCE(telefono, v_tel),
      responsable_nombre    = COALESCE(responsable_nombre, v_nombre),
      responsable_apellido  = COALESCE(responsable_apellido, v_apellido),
      responsable_dni       = COALESCE(responsable_dni, v_dni),
      whatsapp              = COALESCE(whatsapp, v_whatsapp),
      direccion             = COALESCE(direccion, v_direccion),
      localidad             = COALESCE(localidad, v_localidad),
      provincia             = COALESCE(provincia, v_provincia),
      codigo_postal         = COALESCE(codigo_postal, v_cp),
      condicion_iva         = COALESCE(condicion_iva, v_cond_iva),
      domicilio_fiscal      = COALESCE(domicilio_fiscal, v_dom_fiscal),
      updated_at            = now()
    WHERE id = NEW.administracion_id;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END $function$;
