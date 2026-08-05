-- ============================================================================
-- 0405 · DGG-126 §6 — el preset PF/PJ del portal se decide SOLO con el CUIT
-- de la FICHA del cliente.
--
-- La clave `cuit` de cliente_perfil_datos_formulario cae a la última
-- submission histórica cuando la ficha no tiene CUIT (COALESCE(v_admin.cuit,
-- v_cuit_previo)) — útil para pre-llenar el campo, pero NO determina la
-- categoría del cliente. Se agrega la clave meta `_cuit_ficha` (el prefijo _
-- hace que el runner la ignore como campo de formulario) con el CUIT crudo de
-- administraciones; el front la usa para inyectar tipo_persona_solicitante.
--
-- Misma firma (sin parámetros) → CREATE OR REPLACE no genera overload (R16).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cliente_perfil_datos_formulario()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id     uuid;
  v_email       text;
  v_profile     record;
  v_admin       record;
  v_dni_previo  text;
  v_cuit_previo text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  SELECT full_name, phone, administracion_id, role
    INTO v_profile
    FROM public.profiles
   WHERE id = v_user_id;

  IF v_profile.administracion_id IS NOT NULL THEN
    SELECT
      a.nombre,
      a.responsable_nombre,
      a.responsable_apellido,
      a.cuit,
      a.condicion_iva,
      a.domicilio_fiscal,
      a.direccion,
      a.localidad,
      a.provincia,
      a.codigo_postal,
      a.telefono       AS admin_telefono,
      a.whatsapp,
      a.email          AS admin_email,
      a.matricula_rpac,
      a.matricula_rpa,
      a.padre_apellido_nombre,
      a.madre_apellido_nombre,
      a.legajo_rpac,
      a.clave_fiscal_arca
    INTO v_admin
    FROM public.administraciones a
    WHERE a.id = v_profile.administracion_id;
  END IF;

  SELECT
    COALESCE(
      datos->>'dni',
      datos->>'dni_solicitante',
      datos->>'dni_persona_fisica',
      datos->>'documento'
    ) AS dni,
    COALESCE(
      datos->>'cuit',
      datos->>'cuit_persona_juridica',
      datos->>'cuit_solicitante'
    ) AS cuit
  INTO v_dni_previo, v_cuit_previo
  FROM public.formulario_submissions fs
  WHERE fs.email_contacto = v_email
  ORDER BY fs.created_at DESC
  LIMIT 1;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'nombre',              v_profile.full_name,
    'apellido_nombre',     v_profile.full_name,
    'nombre_completo',     v_profile.full_name,
    'nombre_apellido',     v_profile.full_name,
    'email',               v_email,
    'correo',              v_email,
    'correo_electronico',  v_email,
    'mail',                v_email,
    'telefono',            COALESCE(v_profile.phone, v_admin.admin_telefono),
    'tel',                 COALESCE(v_profile.phone, v_admin.admin_telefono),
    'celular',             COALESCE(v_profile.phone, v_admin.admin_telefono),
    'whatsapp',            COALESCE(v_admin.whatsapp, v_profile.phone),
    'dni',                 v_dni_previo,
    'documento',           v_dni_previo,
    'cuit',                COALESCE(v_admin.cuit, v_cuit_previo),
    'cuit_cuil',           COALESCE(v_admin.cuit, v_cuit_previo),
    'cuit_persona_juridica', COALESCE(v_admin.cuit, v_cuit_previo),
    'razon_social',        v_admin.nombre,
    'condicion_iva',       v_admin.condicion_iva,
    'domicilio_fiscal',    v_admin.domicilio_fiscal,
    'direccion',           v_admin.direccion,
    'localidad',           v_admin.localidad,
    'provincia',           v_admin.provincia,
    'codigo_postal',       v_admin.codigo_postal,
    'cp',                  v_admin.codigo_postal,
    'matricula',           COALESCE(v_admin.matricula_rpac, v_admin.matricula_rpa),
    'matricula_rpac',      v_admin.matricula_rpac,
    'numero_matricula_rpac', v_admin.matricula_rpac,
    'matricula_rpa',       v_admin.matricula_rpa,
    'responsable_nombre',  v_admin.responsable_nombre,
    'responsable_apellido', v_admin.responsable_apellido,
    -- DGG-33 (Jose Luis):
    'padre_apellido_nombre', v_admin.padre_apellido_nombre,
    'apellido_nombre_padre', v_admin.padre_apellido_nombre,
    'madre_apellido_nombre', v_admin.madre_apellido_nombre,
    'apellido_nombre_madre', v_admin.madre_apellido_nombre,
    'legajo_rpac',         v_admin.legajo_rpac,
    'numero_legajo_rpac',  v_admin.legajo_rpac,
    'clave_fiscal_arca',   v_admin.clave_fiscal_arca,
    -- DGG-126 §6: CUIT crudo de la FICHA (sin fallback a submissions) —
    -- única fuente válida para derivar la categoría PF/PJ del cliente.
    '_cuit_ficha',         v_admin.cuit,
    '_user_id',            v_user_id,
    '_origen',             'portal'
  ));
END;
$function$;
