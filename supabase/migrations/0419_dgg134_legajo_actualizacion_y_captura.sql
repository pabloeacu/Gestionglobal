-- ============================================================================
-- 0419 · DGG-134 — Número de legajo en Actualización PBA + captura a la ficha
--
-- Pedido Pablo: (1) campo "Número de legajo" obligatorio bajo la matrícula en
-- el form del Curso de Actualización RPAC (Pcia. de Bs. As.); (2) los datos
-- "constantes" (DNI, CUIT, matrícula, legajo…) deben venir auto-rellenos al
-- inscribirse desde el portal, y capturarse a la ficha cuando se completan
-- por primera vez, para reutilizarlos después (UX premium).
--
-- Lo que YA existía: prefill portal (?origen=portal + cliente_perfil_datos_
-- formulario + matching por nombre en FormularioRunner con badge), ficha con
-- administraciones.legajo_rpac (mig 0167), y DOS triggers de captura (mig
-- 0340) que ya leen datos->>'legajo_rpac' con COALESCE (nunca pisan).
--
-- El HUECO (hipótesis remota confirmada con datos): las inscripciones a
-- cursos desde la landing llegan SIN administracion_id (30/31 reales) y no
-- crean trámite → NINGÚN trigger de captura corría jamás para cursos. La
-- activación (solicitud_activar) vincula la solicitud al cliente
-- (solicitudes.cliente_id, 52/59) y marca la submission 'procesado', pero
-- nunca le escribía administracion_id.
--
-- Fix (aditivo, sin tocar solicitud_activar):
--  a) Campo legajo_rpac en el schema del form PBA (idempotente). El name
--     matchea EXACTO la clave del prefill y la clave que los triggers de
--     captura ya leen → prefill y captura se enchufan solos.
--  b) Trigger: submission pasa a 'procesado' sin admin → se vincula con el
--     cliente_id de su solicitud.
--  c) Trigger: administracion_id NULL→valor → corre el sync existente
--     (mig 0340) → matrícula/legajo/DNI/CUIT llegan a la ficha.
--  d) Prefill v2: + 'apellido' (responsable_apellido), 'nombre' prefiere
--     responsable_nombre (los forms de cursos separan nombre/apellido — el
--     full_name en 'nombre' quedaba mal), + alias 'numero_legajo'.
--  e) Backfill histórico: submissions procesadas sin admin cuya solicitud sí
--     tiene cliente → se vinculan (dispara c → las fichas se completan solas
--     con lo ya declarado; COALESCE = jamás pisa un valor cargado).
--
-- R2/R6: sin tablas nuevas. R16: misma firma en la RPC (smoke al cierre).
-- R18: smoke e2e ejecutando el circuito completo al cierre del chunk.
-- CABA intacto (pedido explícito: solo PBA).
-- ============================================================================

-- (a) Campo en el schema, debajo de matricula_rpac (idempotente)
UPDATE public.formularios f
SET schema = jsonb_set(
  f.schema, '{sections,0,fields}',
  (
    SELECT jsonb_agg(elem ORDER BY ord)
    FROM (
      SELECT campo.value AS elem, campo.ordinality * 10 AS ord
      FROM jsonb_array_elements(f.schema->'sections'->0->'fields') WITH ORDINALITY campo
      UNION ALL
      SELECT '{"hint":"Tal como figura en tu legajo del RPAC.","name":"legajo_rpac","type":"text","label":"Número de legajo","required":true}'::jsonb,
             campo2.ordinality * 10 + 5
      FROM jsonb_array_elements(f.schema->'sections'->0->'fields') WITH ORDINALITY campo2
      WHERE campo2.value->>'name' = 'matricula_rpac'
    ) x
  )
)
WHERE f.slug = 'curso-actualizacion'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(f.schema->'sections'->0->'fields') c
    WHERE c.value->>'name' = 'legajo_rpac'
  );

-- (b) Vincular la submission al cliente cuando se procesa (activación)
CREATE FUNCTION public.subm_vincular_admin_al_procesar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_admin uuid;
BEGIN
  SELECT s.cliente_id INTO v_admin
  FROM public.solicitudes s
  WHERE s.formulario_submission_id = NEW.id AND s.cliente_id IS NOT NULL
  ORDER BY s.created_at DESC LIMIT 1;
  IF v_admin IS NOT NULL THEN
    UPDATE public.formulario_submissions
       SET administracion_id = v_admin
     WHERE id = NEW.id AND administracion_id IS NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.subm_vincular_admin_al_procesar() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_subm_vincular_admin
AFTER UPDATE OF estado ON public.formulario_submissions
FOR EACH ROW
WHEN (NEW.estado = 'procesado' AND NEW.administracion_id IS NULL)
EXECUTE FUNCTION public.subm_vincular_admin_al_procesar();

-- (c) El sync de mig 0340 también en la transición NULL→valor de admin
-- (solo usa NEW → sirve para UPDATE tal cual; sin recursión: b excluye
-- admin no-nulo y c solo corre en la transición).
CREATE TRIGGER trg_subm_sync_admin_update
AFTER UPDATE OF administracion_id ON public.formulario_submissions
FOR EACH ROW
WHEN (OLD.administracion_id IS NULL AND NEW.administracion_id IS NOT NULL)
EXECUTE FUNCTION public.sync_submission_a_administracion();

-- (d) Prefill v2: apellido/nombre desde la ficha + alias numero_legajo
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
    -- DGG-134: los forms de cursos separan nombre/apellido — la ficha manda
    -- cuando la tiene; full_name queda de fallback para 'nombre'.
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
    'responsable_nombre',  v_admin.responsable_nombre,
    'responsable_apellido', v_admin.responsable_apellido,
    -- DGG-33 (Jose Luis):
    'padre_apellido_nombre', v_admin.padre_apellido_nombre,
    'apellido_nombre_padre', v_admin.padre_apellido_nombre,
    'madre_apellido_nombre', v_admin.madre_apellido_nombre,
    'apellido_nombre_madre', v_admin.madre_apellido_nombre,
    'legajo_rpac',         v_admin.legajo_rpac,
    'numero_legajo_rpac',  v_admin.legajo_rpac,
    'numero_legajo',       v_admin.legajo_rpac,
    'clave_fiscal_arca',   v_admin.clave_fiscal_arca,
    -- DGG-126 §6: CUIT crudo de la FICHA (sin fallback a submissions) —
    -- única fuente válida para derivar la categoría PF/PJ del cliente.
    '_cuit_ficha',         v_admin.cuit,
    '_user_id',            v_user_id,
    '_origen',             'portal'
  ));
END;
$function$;

-- (e) Backfill histórico: submissions procesadas sin admin, con solicitud
-- vinculada → se linkean (dispara el sync → fichas se completan con lo ya
-- declarado; COALESCE nunca pisa).
UPDATE public.formulario_submissions fs
SET administracion_id = s.cliente_id
FROM public.solicitudes s
WHERE s.formulario_submission_id = fs.id
  AND fs.administracion_id IS NULL
  AND s.cliente_id IS NOT NULL
  AND fs.estado = 'procesado';
