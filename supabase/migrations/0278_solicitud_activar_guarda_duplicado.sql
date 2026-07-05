-- 0278 · E-GG-87 · Bloqueo duro de cliente duplicado al activar una solicitud
-- ============================================================================
-- Reporte JL: el formulario público del Curso RPAC creó un cliente NUEVO
-- ("Est Sav.") en vez de vincularlo al existente ("Estudio Save"), que ya tenía
-- el MISMO email. Consecuencia: el trámite/comprobante/saldo-a-favor quedaron en
-- el duplicado, y como auth.users.email es único, el portal-user del duplicado
-- nunca se creó → el cliente entra con su login (→ original) y no ve nada.
--
-- Causa: `solicitud_activar`, en la rama "crear cliente nuevo"
-- (p_crear_cliente_input), hacía `INSERT INTO administraciones` SIN chequear si
-- ya existía un cliente activo con ese email/CUIT. El match consultivo
-- (`solicitud_match_cliente`) se mostraba en la UI pero era fácil de ignorar.
--
-- Fix (decisión Pablo: bloqueo duro): antes de crear, si existe un admin ACTIVO
-- con el mismo email o CUIT → RAISE, obligando a la gerencia a vincular al
-- existente. El email es además el login único del portal, así que compartirlo
-- entre dos clientes nunca es válido. Misma firma → CREATE OR REPLACE (sin
-- overload, R16). La UI complementa poniendo "vincular" por defecto ante un match.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.solicitud_activar(
  p_solicitud_id uuid, p_cliente_id uuid DEFAULT NULL::uuid,
  p_crear_cliente_input jsonb DEFAULT NULL::jsonb, p_periodo text DEFAULT NULL::text,
  p_fecha_inicio date DEFAULT NULL::date
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sol public.solicitudes%ROWTYPE;
  v_cliente uuid;
  v_servicio public.servicios%ROWTYPE;
  v_tramite_id uuid;
  v_categoria text;
  v_titulo text;
  v_parent_tramite uuid;
  v_email_admin text;
  v_admin_nombre text;
  v_es_nuevo boolean := false;
  -- E-GG-87
  v_new_email text;
  v_new_cuit  text;
  v_dup_id uuid;
  v_dup_nombre text;
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

    -- E-GG-87 · BLOQUEO DURO de duplicados: no crear si ya existe un cliente
    -- ACTIVO con el mismo email o CUIT — hay que vincular al existente.
    v_new_email := lower(btrim(COALESCE(NULLIF(p_crear_cliente_input->>'email',''), v_sol.solicitante_email, '')));
    v_new_cuit  := regexp_replace(COALESCE(p_crear_cliente_input->>'cuit',''), '[^0-9]', '', 'g');
    v_dup_id := NULL;
    IF v_new_email <> '' THEN
      SELECT id, nombre INTO v_dup_id, v_dup_nombre
        FROM public.administraciones
       WHERE activo AND email IS NOT NULL AND lower(email) = v_new_email
       LIMIT 1;
    END IF;
    IF v_dup_id IS NULL AND length(v_new_cuit) >= 8 THEN
      SELECT id, nombre INTO v_dup_id, v_dup_nombre
        FROM public.administraciones
       WHERE activo AND cuit IS NOT NULL AND regexp_replace(cuit, '[^0-9]', '', 'g') = v_new_cuit
       LIMIT 1;
    END IF;
    IF v_dup_id IS NOT NULL THEN
      RAISE EXCEPTION 'Ya existe el cliente "%" con ese email o CUIT. Vinculá la solicitud a ese cliente existente en vez de crear uno nuevo (así evitás duplicar el cliente y que el portal no muestre sus trámites).', v_dup_nombre
        USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.administraciones (
      codigo, nombre, nombre_normalizado, cuit, email, telefono, direccion,
      localidad, provincia, codigo_postal, observaciones, estado, activo
    ) VALUES (
      COALESCE(p_crear_cliente_input->>'codigo', 'AUTO-' || substring(p_solicitud_id::text,1,8)),
      COALESCE(p_crear_cliente_input->>'nombre', v_sol.solicitante_nombre, 'Cliente sin nombre'),
      '',
      NULLIF(p_crear_cliente_input->>'cuit',''),
      COALESCE(NULLIF(p_crear_cliente_input->>'email',''), v_sol.solicitante_email),
      COALESCE(NULLIF(p_crear_cliente_input->>'telefono',''), v_sol.solicitante_telefono),
      NULLIF(p_crear_cliente_input->>'direccion',''), NULLIF(p_crear_cliente_input->>'localidad',''),
      NULLIF(p_crear_cliente_input->>'provincia',''), NULLIF(p_crear_cliente_input->>'codigo_postal',''),
      NULLIF(p_crear_cliente_input->>'observaciones',''), 'activo', true
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
    WHEN 'curso-actualizacion' THEN 'curso' ELSE 'otro'
  END;

  v_titulo := COALESCE(v_servicio.nombre, v_sol.servicio_slug, 'Servicio')
    || ' · ' || COALESCE(v_sol.solicitante_nombre, v_admin_nombre, v_sol.solicitante_email, 'sin contacto');

  IF v_cliente IS NOT NULL AND v_sol.servicio_solicitado_id IS NOT NULL THEN
    SELECT t.id INTO v_parent_tramite FROM public.tramites t
     WHERE t.administracion_id = v_cliente AND t.categoria = v_categoria
     ORDER BY t.created_at DESC LIMIT 1;
  END IF;

  INSERT INTO public.tramites (
    titulo, descripcion, categoria, prioridad, estado,
    formulario_submission_id, administracion_id,
    solicitante_nombre, solicitante_email, solicitante_telefono,
    servicio_id, periodo, fecha_inicio, parent_tracking_id, created_by
  ) VALUES (
    v_titulo,
    'Tracking activado desde solicitud ' || p_solicitud_id::text
      || COALESCE(' · período ' || p_periodo, '') || COALESCE(' · inicio ' || p_fecha_inicio::text, '')
      || COALESCE(' · continuación de ' || v_parent_tramite::text, ''),
    v_categoria, 'normal', 'abierto',
    v_sol.formulario_submission_id, v_cliente,
    v_sol.solicitante_nombre, v_sol.solicitante_email, v_sol.solicitante_telefono,
    v_sol.servicio_solicitado_id, p_periodo, p_fecha_inicio, v_parent_tramite, auth.uid()
  ) RETURNING id INTO v_tramite_id;

  BEGIN
    EXECUTE 'SELECT public.tracking_agregar_linea($1,$2,$3,$4,$5)'
      USING v_tramite_id, v_sol.servicio_solicitado_id, p_periodo, p_fecha_inicio, v_parent_tramite;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF v_sol.formulario_submission_id IS NOT NULL THEN
    UPDATE public.formulario_submissions SET estado = 'procesado', procesado_at = now(), procesado_por = auth.uid()
     WHERE id = v_sol.formulario_submission_id AND estado <> 'procesado';
  END IF;

  IF v_cliente IS NOT NULL AND NOT v_es_nuevo AND v_email_admin IS NOT NULL AND v_email_admin <> '' THEN
    BEGIN
      PERFORM public.encolar_email('nuevo-servicio-activado', v_email_admin, v_admin_nombre,
        jsonb_build_object('nombre', v_admin_nombre,
          'servicio', COALESCE(v_servicio.nombre, v_sol.servicio_slug, 'Servicio'),
          'link_portal', 'https://gestionglobal.ar/portal'),
        v_cliente, NULL, 'tramites', v_tramite_id, 3::smallint);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  UPDATE public.solicitudes
     SET estado = 'activada', tramite_id = v_tramite_id, cliente_id = v_cliente,
         activada_at = now(), asignada_a = COALESCE(asignada_a, auth.uid())
   WHERE id = p_solicitud_id;

  RETURN v_tramite_id;
END;
$function$;
