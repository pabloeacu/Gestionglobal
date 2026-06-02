-- 0167 · Cambios pedidos por José Luis (E-GG-32):
--   • administraciones: 4 columnas nuevas (padre, madre, legajo RPAC, clave fiscal ARCA).
--   • config_global: 4 columnas nuevas (cuenta Mercado Pago) + bump WhatsApp si vacío.
--   • cliente_perfil_datos_formulario: exponer los nuevos campos para autofill.
--
-- La clave fiscal ARCA se trata como texto común (decisión usuario 2026-06-02:
-- el front la oculta con "***" + ojito; no cifrada en BD porque tiene que
-- pasarse a la gestoría para trámites futuros).

ALTER TABLE public.administraciones
  ADD COLUMN IF NOT EXISTS padre_apellido_nombre text,
  ADD COLUMN IF NOT EXISTS madre_apellido_nombre text,
  ADD COLUMN IF NOT EXISTS legajo_rpac text,
  ADD COLUMN IF NOT EXISTS clave_fiscal_arca text;

COMMENT ON COLUMN public.administraciones.padre_apellido_nombre IS
  'Apellido y nombres del padre del administrador. RPAC lo pide en matriculación.';
COMMENT ON COLUMN public.administraciones.madre_apellido_nombre IS
  'Apellido y nombres de la madre del administrador.';
COMMENT ON COLUMN public.administraciones.legajo_rpac IS
  'Número de legajo asignado por el RPAC al matricularse. NO confundir con matrícula.';
COMMENT ON COLUMN public.administraciones.clave_fiscal_arca IS
  'Clave fiscal ARCA del administrador. Texto común; UI con dots+ojito (no cifrada).';

ALTER TABLE public.config_global
  ADD COLUMN IF NOT EXISTS pago_mp_cvu text,
  ADD COLUMN IF NOT EXISTS pago_mp_alias text,
  ADD COLUMN IF NOT EXISTS pago_mp_cuit_cuil text,
  ADD COLUMN IF NOT EXISTS pago_mp_titular text;

UPDATE public.config_global SET
  pago_mp_cvu       = COALESCE(pago_mp_cvu, '0000003100053534352305'),
  pago_mp_alias     = COALESCE(pago_mp_alias, 'GestionGlobal.ar'),
  pago_mp_cuit_cuil = COALESCE(pago_mp_cuit_cuil, '27225982746'),
  pago_mp_titular   = COALESCE(pago_mp_titular, 'Mercado Pago')
WHERE id = 1;

UPDATE public.config_global SET
  whatsapp = COALESCE(whatsapp, '+5492214317914')
WHERE id = 1;

-- Update RPC autofill para exponer los 4 campos nuevos al FormularioRunner.
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
    INTO v_profile FROM public.profiles WHERE id = v_user_id;

  IF v_profile.administracion_id IS NOT NULL THEN
    SELECT
      a.nombre, a.responsable_nombre, a.responsable_apellido,
      a.cuit, a.condicion_iva, a.domicilio_fiscal, a.direccion,
      a.localidad, a.provincia, a.codigo_postal,
      a.telefono AS admin_telefono, a.whatsapp, a.email AS admin_email,
      a.matricula_rpac, a.matricula_rpa,
      a.padre_apellido_nombre, a.madre_apellido_nombre,
      a.legajo_rpac, a.clave_fiscal_arca
    INTO v_admin FROM public.administraciones a WHERE a.id = v_profile.administracion_id;
  END IF;

  SELECT
    COALESCE(datos->>'dni', datos->>'dni_solicitante', datos->>'dni_persona_fisica', datos->>'documento') AS dni,
    COALESCE(datos->>'cuit', datos->>'cuit_persona_juridica', datos->>'cuit_solicitante') AS cuit
  INTO v_dni_previo, v_cuit_previo
  FROM public.formulario_submissions fs
  WHERE fs.email_contacto = v_email
  ORDER BY fs.created_at DESC LIMIT 1;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'nombre', v_profile.full_name,
    'apellido_nombre', v_profile.full_name,
    'nombre_completo', v_profile.full_name,
    'nombre_apellido', v_profile.full_name,
    'email', v_email, 'correo', v_email, 'correo_electronico', v_email, 'mail', v_email,
    'telefono', COALESCE(v_profile.phone, v_admin.admin_telefono),
    'tel',      COALESCE(v_profile.phone, v_admin.admin_telefono),
    'celular',  COALESCE(v_profile.phone, v_admin.admin_telefono),
    'whatsapp', COALESCE(v_admin.whatsapp, v_profile.phone),
    'dni', v_dni_previo, 'documento', v_dni_previo,
    'cuit', COALESCE(v_admin.cuit, v_cuit_previo),
    'cuit_cuil', COALESCE(v_admin.cuit, v_cuit_previo),
    'cuit_persona_juridica', COALESCE(v_admin.cuit, v_cuit_previo),
    'razon_social', v_admin.nombre,
    'condicion_iva', v_admin.condicion_iva,
    'domicilio_fiscal', v_admin.domicilio_fiscal,
    'direccion', v_admin.direccion,
    'localidad', v_admin.localidad,
    'provincia', v_admin.provincia,
    'codigo_postal', v_admin.codigo_postal,
    'cp', v_admin.codigo_postal,
    'matricula', COALESCE(v_admin.matricula_rpac, v_admin.matricula_rpa),
    'matricula_rpac', v_admin.matricula_rpac,
    'numero_matricula_rpac', v_admin.matricula_rpac,
    'matricula_rpa', v_admin.matricula_rpa,
    'responsable_nombre', v_admin.responsable_nombre,
    'responsable_apellido', v_admin.responsable_apellido,
    -- E-GG-32 (Jose Luis):
    'padre_apellido_nombre', v_admin.padre_apellido_nombre,
    'apellido_nombre_padre', v_admin.padre_apellido_nombre,
    'madre_apellido_nombre', v_admin.madre_apellido_nombre,
    'apellido_nombre_madre', v_admin.madre_apellido_nombre,
    'legajo_rpac', v_admin.legajo_rpac,
    'numero_legajo_rpac', v_admin.legajo_rpac,
    'clave_fiscal_arca', v_admin.clave_fiscal_arca,
    '_user_id', v_user_id,
    '_origen', 'portal'
  ));
END;
$function$;
