-- 0310 · Reporte JL (punto 4) · `sync_submission_a_administracion` sólo mapeaba 7
-- campos (padre, madre, legajo, clave ARCA, matrícula, cuit, teléfono). Los datos
-- que el cliente carga como RESPONSABLE nombre/apellido, DNI y DIRECCIÓN nunca se
-- copiaban a la ficha → salían "Sin asignar" / "Sin cargar" en gerencia (JL: pasa
-- en TODOS los clientes). Extendemos el mapeo a responsable_nombre/apellido/dni,
-- direccion (armada de calle+numero+piso+depto) y whatsapp. Sigue con COALESCE
-- (sólo rellena NULLs, nunca pisa datos ya cargados). Trigger fn → CREATE OR
-- REPLACE (R16, sin overloads).
CREATE OR REPLACE FUNCTION public.sync_submission_a_administracion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_padre    text;
  v_madre    text;
  v_legajo   text;
  v_clave    text;
  v_matric   text;
  v_cuit     text;
  v_tel      text;
  v_nombre   text;
  v_apellido text;
  v_dni      text;
  v_whatsapp text;
  v_direccion text;
BEGIN
  IF NEW.administracion_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.datos IS NULL OR jsonb_typeof(NEW.datos) <> 'object' THEN RETURN NEW; END IF;

  v_padre  := NULLIF(trim(NEW.datos->>'padre_apellido_nombre'), '');
  v_madre  := NULLIF(trim(NEW.datos->>'madre_apellido_nombre'), '');
  v_legajo := NULLIF(trim(NEW.datos->>'legajo_rpac'), '');
  v_clave  := NULLIF(trim(NEW.datos->>'clave_fiscal_arca'), '');
  v_matric := NULLIF(trim(NEW.datos->>'matricula_rpac'), '');
  v_cuit   := NULLIF(trim(NEW.datos->>'cuit'), '');
  v_tel    := COALESCE(
    NULLIF(trim(NEW.datos->>'celular'), ''),
    NULLIF(trim(NEW.datos->>'telefono'), '')
  );
  -- Nuevos (0310): responsable, DNI, whatsapp, dirección.
  v_nombre   := NULLIF(trim(NEW.datos->>'nombre'), '');
  v_apellido := NULLIF(trim(NEW.datos->>'apellido'), '');
  v_dni      := NULLIF(trim(NEW.datos->>'dni'), '');
  v_whatsapp := COALESCE(
    NULLIF(trim(NEW.datos->>'whatsapp'), ''),
    NULLIF(trim(NEW.datos->>'celular'), '')
  );
  v_direccion := NULLIF(trim(concat_ws(' ',
    NULLIF(trim(NEW.datos->>'calle'), ''),
    NULLIF(trim(NEW.datos->>'numero'), ''),
    CASE WHEN NULLIF(trim(NEW.datos->>'piso'), '') IS NOT NULL
      THEN 'Piso ' || trim(NEW.datos->>'piso') END,
    CASE WHEN NULLIF(trim(NEW.datos->>'depto'), '') IS NOT NULL
      THEN 'Depto ' || trim(NEW.datos->>'depto') END
  )), '');

  IF v_padre IS NULL AND v_madre IS NULL AND v_legajo IS NULL
     AND v_clave IS NULL AND v_matric IS NULL AND v_cuit IS NULL
     AND v_tel IS NULL AND v_nombre IS NULL AND v_apellido IS NULL
     AND v_dni IS NULL AND v_whatsapp IS NULL AND v_direccion IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.administraciones
  SET
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
    updated_at            = now()
  WHERE id = NEW.administracion_id;

  RETURN NEW;
END $function$;
