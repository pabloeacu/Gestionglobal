-- 0532_dgg218_vencimiento_matricula_en_origen.sql
-- DGG-218 · FASE 1 — Captura del vencimiento de matrícula EN ORIGEN.
--
-- Problema (Pablo): dejamos impecables las fichas con el backfill TRAMIX
-- (DGG-216), pero los clientes NUEVOS que entren de ahora en más volverían a
-- quedar sin fecha → habría que re-recorrer el backfill en un par de meses.
-- Solución: capturar la fecha de vencimiento de la matrícula en los DOS
-- formularios que sólo usan administradores con matrícula vigente — Renovación
-- (renovacion-rpac) y Certificado de acreditación (certificado-rpac). Formación,
-- inscripción y consultoría NO la piden (pueden no tener matrícula aún).
--
-- Flujo:
--   • LANDING (sin login): el cliente completa el campo (obligatorio) → viaja en
--     la submission → cuando gerencia vincula la submission a la ficha, el
--     trigger sync_submission_a_administracion la copia (FILL-ONLY) a la ficha
--     del cliente nuevo.
--   • PORTAL (logueado): el campo viene PRE-CARGADO desde la ficha
--     (cliente_perfil_datos_formulario). Si el cliente lo EDITA, el front le
--     pide confirmación (useConfirm, R13) y llama al RPC
--     cliente_confirmar_vencimiento_matricula → UPDATE de la ficha (OVERWRITE) →
--     el trigger trg_admin_matricula_venc_sync propaga a `vencimientos` (crea el
--     vigente con alarmas {45,30,15} y marca renovado el anterior) →
--     la agenda personalizada + el motor de ofrecimientos (DGG-217, YA VIVO)
--     quedan al día automáticamente.
--
-- Fuente única de verdad: administraciones.matricula_rpac_vencimiento. Nada
-- escribe `vencimientos` a mano por este flujo: siempre vía el trigger de la
-- ficha (consistencia contable/regulatoria absoluta).
--
-- Reglas: R4 (query en service), R5/R12 (RPC SECDEF + assert tenencia),
-- R6 (GRANT authenticated), R13 (useConfirm en el front), R16 (sin overloads —
-- firmas sin cambio / función nueva), R17 (trigger→RLS ya SECDEF),
-- R18 (smoke e2e ejecutado en el cierre §6), R19 (no aplica).

-- ───────────────────────────────────────────────────────────────────────────
-- A) SCHEMA DE LOS FORMULARIOS — nuevo campo `matricula_rpac_vencimiento`
--    (date, obligatorio). El trigger formulario_versionado snapshotea el schema
--    viejo automáticamente (regla de oro). Idempotente: no re-agrega si ya está.
-- ───────────────────────────────────────────────────────────────────────────

-- renovacion-rpac → sección "Identificación" (índice 1), después de legajo_rpac
UPDATE public.formularios f
SET schema = jsonb_set(
  f.schema,
  '{sections,1,fields}',
  (f.schema->'sections'->1->'fields') || jsonb_build_object(
    'name', 'matricula_rpac_vencimiento',
    'type', 'date',
    'label', 'Vencimiento de tu matrícula RPAC',
    'required', true,
    'hint', 'Fecha en la que vence tu matrícula de administrador (RPAC · Provincia de Buenos Aires). Con este dato armamos tu agenda personalizada de recordatorios. Desde el portal te la traemos ya cargada; si cambió, corregila.'
  )
)
WHERE f.slug = 'renovacion-rpac'
  AND f.schema->'sections'->1->>'title' = 'Identificación'
  AND NOT (f.schema->'sections'->1->'fields' @> '[{"name":"matricula_rpac_vencimiento"}]'::jsonb);

-- certificado-rpac → sección "Datos del solicitante" (índice 1), tras legajo_rpac
UPDATE public.formularios f
SET schema = jsonb_set(
  f.schema,
  '{sections,1,fields}',
  (f.schema->'sections'->1->'fields') || jsonb_build_object(
    'name', 'matricula_rpac_vencimiento',
    'type', 'date',
    'label', 'Vencimiento de tu matrícula RPAC',
    'required', true,
    'hint', 'Fecha en la que vence tu matrícula de administrador (RPAC · Provincia de Buenos Aires). Con este dato armamos tu agenda personalizada de recordatorios. Desde el portal te la traemos ya cargada; si cambió, corregila.'
  )
)
WHERE f.slug = 'certificado-rpac'
  AND f.schema->'sections'->1->>'title' = 'Datos del solicitante'
  AND NOT (f.schema->'sections'->1->'fields' @> '[{"name":"matricula_rpac_vencimiento"}]'::jsonb);

-- ───────────────────────────────────────────────────────────────────────────
-- B) PREFILL del portal — cliente_perfil_datos_formulario() emite el alias
--    `matricula_rpac_vencimiento` (YYYY-MM-DD) para que el runner lo precargue.
--    (CREATE OR REPLACE, misma firma sin args → sin overload, R16.)
-- ───────────────────────────────────────────────────────────────────────────
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
      a.responsable_dni,
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
      a.clave_fiscal_arca,
      a.matricula_rpac_vencimiento
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
    'nombre',              COALESCE(v_admin.responsable_nombre, v_profile.full_name),
    'apellido',            v_admin.responsable_apellido,
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
    'dni',                 COALESCE(v_admin.responsable_dni, v_dni_previo),
    'documento',           COALESCE(v_admin.responsable_dni, v_dni_previo),
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
    'matricula_rpac_vencimiento', to_char(v_admin.matricula_rpac_vencimiento, 'YYYY-MM-DD'),
    'responsable_nombre',  v_admin.responsable_nombre,
    'responsable_apellido', v_admin.responsable_apellido,
    'padre_apellido_nombre', v_admin.padre_apellido_nombre,
    'apellido_nombre_padre', v_admin.padre_apellido_nombre,
    'madre_apellido_nombre', v_admin.madre_apellido_nombre,
    'apellido_nombre_madre', v_admin.madre_apellido_nombre,
    'legajo_rpac',         v_admin.legajo_rpac,
    'numero_legajo_rpac',  v_admin.legajo_rpac,
    'numero_legajo',       v_admin.legajo_rpac,
    'clave_fiscal_arca',   v_admin.clave_fiscal_arca,
    '_cuit_ficha',         v_admin.cuit,
    '_user_id',            v_user_id,
    '_origen',             'portal'
  ));
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- C) SYNC submission → ficha (FILL-ONLY) — para clientes de LANDING nuevos.
--    Agrega matricula_rpac_vencimiento con COALESCE (no pisa dato existente).
--    El parseo es defensivo: sólo castea si matchea YYYY-MM-DD.
--    (CREATE OR REPLACE, misma firma trigger → sin overload, R16. Ya es SECDEF, R17.)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_submission_a_administracion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_padre text; v_madre text; v_legajo text; v_clave text; v_matric text;
  v_cuit text; v_cuit_titular text; v_tel text; v_nombre text; v_apellido text; v_dni text;
  v_whatsapp text; v_direccion text;
  v_localidad text; v_provincia text; v_cp text; v_cond_iva text; v_dom_fiscal text;
  v_venc_txt text; v_venc date;
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
  IF NEW.datos->>'tipo_persona_solicitante' = 'Persona jurídica' THEN
    v_cuit := NULL;
  END IF;
  v_cuit_titular := regexp_replace(COALESCE(NEW.datos->>'cuit_titular_arca',''), '[^0-9]', '', 'g');
  IF length(v_cuit_titular) <> 11 THEN v_cuit_titular := NULL; END IF;
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
  v_direccion := COALESCE(v_direccion, NULLIF(trim(NEW.datos->>'domicilio_empresa'), ''));
  -- DGG-127: renovación releva el domicilio en la key `direccion`.
  v_direccion := COALESCE(v_direccion, NULLIF(trim(NEW.datos->>'direccion'), ''));
  v_localidad  := NULLIF(trim(NEW.datos->>'localidad'), '');
  v_provincia  := NULLIF(trim(NEW.datos->>'provincia'), '');
  v_cp         := NULLIF(trim(NEW.datos->>'codigo_postal'), '');
  v_cond_iva   := NULLIF(trim(NEW.datos->>'condicion_iva'), '');
  v_dom_fiscal := NULLIF(trim(NEW.datos->>'domicilio_fiscal'), '');
  -- DGG-218: vencimiento de matrícula (renovacion-rpac / certificado-rpac).
  -- Parseo defensivo: sólo castea si matchea YYYY-MM-DD; cualquier basura → NULL
  -- (sin abortar el resto del sync).
  v_venc_txt := NULLIF(trim(NEW.datos->>'matricula_rpac_vencimiento'), '');
  IF v_venc_txt ~ '^\d{4}-\d{2}-\d{2}$' THEN
    BEGIN v_venc := v_venc_txt::date; EXCEPTION WHEN OTHERS THEN v_venc := NULL; END;
  END IF;

  IF v_padre IS NULL AND v_madre IS NULL AND v_legajo IS NULL AND v_clave IS NULL
     AND v_matric IS NULL AND v_cuit IS NULL AND v_cuit_titular IS NULL AND v_tel IS NULL AND v_nombre IS NULL
     AND v_apellido IS NULL AND v_dni IS NULL AND v_whatsapp IS NULL AND v_direccion IS NULL
     AND v_localidad IS NULL AND v_provincia IS NULL AND v_cp IS NULL
     AND v_cond_iva IS NULL AND v_dom_fiscal IS NULL AND v_venc IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    UPDATE public.administraciones SET
      padre_apellido_nombre = COALESCE(padre_apellido_nombre, v_padre),
      madre_apellido_nombre = COALESCE(madre_apellido_nombre, v_madre),
      legajo_rpac           = COALESCE(legajo_rpac, v_legajo),
      clave_fiscal_arca     = COALESCE(clave_fiscal_arca, v_clave),
      -- 0400 (§6 B#7): el titular solo se backfillea sobre fichas JURÍDICAS
      -- (cuit 30/33/34). En la cuenta PF del titular sería su propio CUIT
      -- duplicado, contra la convención del COMMENT de la columna.
      cuit_titular_arca     = COALESCE(cuit_titular_arca,
        CASE WHEN cuit ~ '^(30|33|34)' THEN v_cuit_titular END),
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
      -- DGG-218: FILL-ONLY (no pisa). El overwrite del portal va por el RPC
      -- cliente_confirmar_vencimiento_matricula (con confirmación del cliente).
      matricula_rpac_vencimiento = COALESCE(matricula_rpac_vencimiento, v_venc),
      updated_at            = now()
    WHERE id = NEW.administracion_id;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END $function$;

-- ───────────────────────────────────────────────────────────────────────────
-- D) RPC de confirmación del PORTAL — OVERWRITE de la ficha con tenencia (R12).
--    El front sólo lo llama tras confirmación explícita del cliente (R13).
--    Escribe SOLO administraciones; `vencimientos` se actualiza por el trigger
--    trg_admin_matricula_venc_sync (fuente única de verdad).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cliente_confirmar_vencimiento_matricula(p_fecha date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin uuid;
  v_hoy   date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
BEGIN
  v_admin := private.current_administracion_id();
  IF v_admin IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'No encontramos tu administración activa.';
  END IF;
  PERFORM private.assert_administracion_access(v_admin);  -- R12 (cinturón)

  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'La fecha de vencimiento es obligatoria.';
  END IF;
  -- Rango de cordura (evita typos tipo año 0202 o 9999).
  IF p_fecha < DATE '2000-01-01' OR p_fecha > v_hoy + INTERVAL '10 years' THEN
    RAISE EXCEPTION 'La fecha de vencimiento (%) está fuera del rango válido.', p_fecha;
  END IF;

  UPDATE public.administraciones
     SET matricula_rpac_vencimiento = p_fecha,
         updated_at = now()
   WHERE id = v_admin;  -- trigger trg_admin_matricula_venc_sync → vencimientos

  RETURN jsonb_build_object(
    'ok', true,
    'administracion_id', v_admin,
    'vencimiento', to_char(p_fecha, 'YYYY-MM-DD')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cliente_confirmar_vencimiento_matricula(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_confirmar_vencimiento_matricula(date) TO authenticated;
