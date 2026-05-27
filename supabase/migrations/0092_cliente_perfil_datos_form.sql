-- ============================================================================
-- Migration: 0092_cliente_perfil_datos_form
-- Fecha: 2026-05-27
-- DGG-XX · Auto-fill de formularios públicos para usuarios logueados
--
-- Cuando un cliente (admin) ingresa a un formulario desde su portal, no tiene
-- sentido pedirle datos que ya tenemos (nombre, email, DNI, CUIT, matrícula,
-- teléfono, dirección). Esta RPC devuelve un dict con todos los datos
-- disponibles, agregados de:
--   - profiles (full_name, phone)
--   - auth.users (email)
--   - administraciones (cuit, matricula_rpac, direccion, telefono, etc.)
--   - tramites previos (DNI / CUIT en formulario_submissions.datos)
--
-- El frontend hace el matching por nombre del campo (con un mapping de
-- aliases conocidos: 'nombre', 'apellido_nombre', 'email', 'correo',
-- 'cuit', 'dni', 'telefono', 'matricula_rpac', etc.).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cliente_perfil_datos_formulario()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
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

  -- Email de auth.users
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  -- Profile: full_name, phone, administracion_id
  SELECT full_name, phone, administracion_id, role
    INTO v_profile
    FROM public.profiles
   WHERE id = v_user_id;

  -- Si está vinculado a una administración, traer sus datos
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
      a.matricula_rpa
    INTO v_admin
    FROM public.administraciones a
    WHERE a.id = v_profile.administracion_id;
  END IF;

  -- DNI y CUIT pueden venir de tramites previos del cliente:
  -- buscar en formulario_submissions.datos cualquier key que parezca DNI/CUIT.
  -- Tomamos el más reciente.
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

  -- Armar el dict con TODOS los datos disponibles, en aliases común
  RETURN jsonb_strip_nulls(jsonb_build_object(
    -- Identidad básica
    'nombre',              v_profile.full_name,
    'apellido_nombre',     v_profile.full_name,
    'nombre_completo',     v_profile.full_name,
    'nombre_apellido',     v_profile.full_name,

    -- Email
    'email',               v_email,
    'correo',              v_email,
    'correo_electronico',  v_email,
    'mail',                v_email,

    -- Teléfono
    'telefono',            COALESCE(v_profile.phone, v_admin.admin_telefono),
    'tel',                 COALESCE(v_profile.phone, v_admin.admin_telefono),
    'celular',             COALESCE(v_profile.phone, v_admin.admin_telefono),
    'whatsapp',            COALESCE(v_admin.whatsapp, v_profile.phone),

    -- Documentos
    'dni',                 v_dni_previo,
    'documento',           v_dni_previo,
    'cuit',                COALESCE(v_admin.cuit, v_cuit_previo),
    'cuit_cuil',           COALESCE(v_admin.cuit, v_cuit_previo),
    'cuit_persona_juridica', COALESCE(v_admin.cuit, v_cuit_previo),

    -- Datos de administración
    'razon_social',        v_admin.nombre,
    'condicion_iva',       v_admin.condicion_iva,
    'domicilio_fiscal',    v_admin.domicilio_fiscal,
    'direccion',           v_admin.direccion,
    'localidad',           v_admin.localidad,
    'provincia',           v_admin.provincia,
    'codigo_postal',       v_admin.codigo_postal,
    'cp',                  v_admin.codigo_postal,

    -- Matrículas
    'matricula',           COALESCE(v_admin.matricula_rpac, v_admin.matricula_rpa),
    'matricula_rpac',      v_admin.matricula_rpac,
    'numero_matricula_rpac', v_admin.matricula_rpac,
    'matricula_rpa',       v_admin.matricula_rpa,

    -- Responsable (puede diferir del usuario logueado)
    'responsable_nombre',  v_admin.responsable_nombre,
    'responsable_apellido', v_admin.responsable_apellido,

    -- Meta
    '_user_id',            v_user_id,
    '_origen',             'portal'
  ));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cliente_perfil_datos_formulario() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_perfil_datos_formulario() TO authenticated;

COMMENT ON FUNCTION public.cliente_perfil_datos_formulario() IS
  'Devuelve un dict con todos los datos del perfil del usuario logueado (profiles + administraciones + tramites previos) en aliases conocidos. El frontend hace matching por nombre de campo del formulario para auto-fill.';
