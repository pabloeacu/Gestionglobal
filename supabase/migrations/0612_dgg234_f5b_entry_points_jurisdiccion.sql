-- 0612_dgg234_f5b_entry_points_jurisdiccion.sql
-- DGG-234 · Fase 5b — puntos de entrada rutean la matrícula por JURISDICCIÓN.
-- Ver DGG-234_matricula_multijurisdiccion.md §5 (F5) + §2.3 (ruteo por slug, NUNCA
-- por nombre del campo). Capitaliza la "trampa": el form curso-actualizacion-caba
-- (servicio rpa_actualizacion) capta un campo llamado `matricula_rpac` que, mal
-- ruteado, aterrizaba en `administraciones.matricula_rpac` → es_rpac=true → ofertas
-- RPAC a un CABA (2ª queja). Este fix evita que la trampa se re-dispare (incl. una
-- re-submission POST-cutover que re-poblaría la columna).
-- --------------------------------------------------------------------------
-- 0 REGRESIÓN PBA: para formularios PBA la jurisdicción resuelta es 'pba' y el
-- camino es byte-idéntico al previo (misma escritura a las columnas). Sólo el
-- form CABA (servicio 'rpa_actualizacion') cambia: su matrícula va a
-- `matricula_extra` (caba) y NO a la columna. Idem confirmar/declarar para
-- clientes con matrícula no-PBA.
-- CREATE OR REPLACE, mismas firmas (R16 ok). SECURITY DEFINER igual.
-- --------------------------------------------------------------------------

-- Helper local de mapeo servicio→jurisdicción (hoy sólo el curso CABA es no-PBA).
-- Se deja inline en cada función para no agregar dependencias; si mañana hay forms
-- Neuquén, extender el CASE. Clave: ruteo por SERVICIO/slug, no por nombre de campo.

-- ==========================================================================
-- 1) sync_submission_a_administracion (trigger en formulario_submissions)
-- ==========================================================================
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
  v_slug text; v_servicio text; v_jur_form text;   -- DGG-234 F5b
BEGIN
  IF NEW.administracion_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.datos IS NULL OR jsonb_typeof(NEW.datos) <> 'object' THEN RETURN NEW; END IF;

  -- DGG-234 F5b: jurisdicción del formulario por SERVICIO (no por el nombre del campo).
  SELECT f.slug, s.codigo INTO v_slug, v_servicio
    FROM public.formularios f LEFT JOIN public.servicios s ON s.id = f.servicio_id
    WHERE f.id = NEW.formulario_id;
  v_jur_form := CASE WHEN v_servicio = 'rpa_actualizacion' THEN 'caba' ELSE 'pba' END;

  v_padre  := NULLIF(trim(NEW.datos->>'padre_apellido_nombre'), '');
  v_madre  := NULLIF(trim(NEW.datos->>'madre_apellido_nombre'), '');
  v_legajo := NULLIF(trim(NEW.datos->>'legajo_rpac'), '');
  v_clave  := NULLIF(trim(NEW.datos->>'clave_fiscal_arca'), '');
  v_matric := COALESCE(NULLIF(trim(NEW.datos->>'matricula_rpac'),''), NULLIF(trim(NEW.datos->>'matricula'),''));
  v_cuit   := regexp_replace(COALESCE(NULLIF(NEW.datos->>'cuit',''), NEW.datos->>'cuit_persona_juridica', ''), '[^0-9]', '', 'g');
  IF length(v_cuit) <> 11 THEN v_cuit := NULL; END IF;
  IF NEW.datos->>'tipo_persona_solicitante' = 'Persona jurídica' THEN v_cuit := NULL; END IF;
  v_cuit_titular := regexp_replace(COALESCE(NEW.datos->>'cuit_titular_arca',''), '[^0-9]', '', 'g');
  IF length(v_cuit_titular) <> 11 THEN v_cuit_titular := NULL; END IF;
  v_tel    := COALESCE(NULLIF(trim(NEW.datos->>'celular'), ''), NULLIF(trim(NEW.datos->>'telefono'), ''));
  v_nombre   := COALESCE(NULLIF(trim(NEW.datos->>'nombre'), ''), NULLIF(trim(NEW.datos->>'representante_legal_nombre'), ''));
  v_apellido := NULLIF(trim(NEW.datos->>'apellido'), '');
  v_dni      := regexp_replace(COALESCE(NULLIF(NEW.datos->>'dni',''), NEW.datos->>'representante_legal_dni', ''), '[^0-9]', '', 'g');
  IF length(v_dni) NOT BETWEEN 7 AND 8 THEN v_dni := NULL; END IF;
  v_whatsapp := COALESCE(NULLIF(trim(NEW.datos->>'whatsapp'), ''), NULLIF(trim(NEW.datos->>'celular'), ''));
  v_direccion := NULLIF(trim(concat_ws(' ',
    NULLIF(trim(NEW.datos->>'calle'), ''), NULLIF(trim(NEW.datos->>'numero'), ''),
    CASE WHEN NULLIF(trim(NEW.datos->>'piso'), '') IS NOT NULL THEN 'Piso ' || trim(NEW.datos->>'piso') END,
    CASE WHEN COALESCE(NULLIF(trim(NEW.datos->>'depto'),''), NULLIF(trim(NEW.datos->>'departamento'),'')) IS NOT NULL
      THEN 'Depto ' || COALESCE(NULLIF(trim(NEW.datos->>'depto'),''), trim(NEW.datos->>'departamento')) END
  )), '');
  v_direccion := COALESCE(v_direccion, NULLIF(trim(NEW.datos->>'domicilio_empresa'), ''));
  v_direccion := COALESCE(v_direccion, NULLIF(trim(NEW.datos->>'direccion'), ''));
  v_localidad  := NULLIF(trim(NEW.datos->>'localidad'), '');
  v_provincia  := NULLIF(trim(NEW.datos->>'provincia'), '');
  v_cp         := NULLIF(trim(NEW.datos->>'codigo_postal'), '');
  v_cond_iva   := NULLIF(trim(NEW.datos->>'condicion_iva'), '');
  v_dom_fiscal := NULLIF(trim(NEW.datos->>'domicilio_fiscal'), '');
  v_venc_txt := NULLIF(trim(NEW.datos->>'matricula_rpac_vencimiento'), '');
  IF v_venc_txt ~ '^\d{4}-\d{2}-\d{2}$' THEN
    BEGIN v_venc := v_venc_txt::date; EXCEPTION WHEN OTHERS THEN v_venc := NULL; END;
  END IF;
  IF v_venc IS NOT NULL AND (v_venc < DATE '2000-01-01'
       OR v_venc > (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + INTERVAL '10 years') THEN
    v_venc := NULL;
  END IF;
  IF v_padre IS NULL AND v_madre IS NULL AND v_legajo IS NULL AND v_clave IS NULL
     AND v_matric IS NULL AND v_cuit IS NULL AND v_cuit_titular IS NULL AND v_tel IS NULL AND v_nombre IS NULL
     AND v_apellido IS NULL AND v_dni IS NULL AND v_whatsapp IS NULL AND v_direccion IS NULL
     AND v_localidad IS NULL AND v_provincia IS NULL AND v_cp IS NULL
     AND v_cond_iva IS NULL AND v_dom_fiscal IS NULL AND v_venc IS NULL THEN
    RETURN NEW;
  END IF;
  -- venc declarado sólo aplica al flujo PBA (la columna matricula_rpac_vencimiento).
  IF v_venc IS NOT NULL AND v_jur_form = 'pba' THEN
    PERFORM set_config('app.venc_declarado', 'on', true);
  END IF;
  BEGIN
    UPDATE public.administraciones SET
      padre_apellido_nombre = COALESCE(padre_apellido_nombre, v_padre),
      madre_apellido_nombre = COALESCE(madre_apellido_nombre, v_madre),
      legajo_rpac           = COALESCE(legajo_rpac, v_legajo),
      clave_fiscal_arca     = COALESCE(clave_fiscal_arca, v_clave),
      cuit_titular_arca     = COALESCE(cuit_titular_arca, CASE WHEN cuit ~ '^(30|33|34)' THEN v_cuit_titular END),
      -- DGG-234 F5b: la matrícula va a la columna SÓLO si el form es PBA.
      matricula_rpac        = COALESCE(matricula_rpac, CASE WHEN v_jur_form = 'pba' THEN v_matric END),
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
      matricula_rpac_vencimiento = COALESCE(matricula_rpac_vencimiento, CASE WHEN v_jur_form = 'pba' THEN v_venc END),
      matricula_rpac_vencimiento_origen = CASE
        WHEN v_jur_form = 'pba' AND matricula_rpac_vencimiento IS NULL AND v_venc IS NOT NULL
        THEN 'declarado_cliente' ELSE matricula_rpac_vencimiento_origen END,
      matricula_rpac_vencimiento_certeza = CASE
        WHEN v_jur_form = 'pba' AND matricula_rpac_vencimiento IS NULL AND v_venc IS NOT NULL
        THEN 'declarado'::public.certeza_dato ELSE matricula_rpac_vencimiento_certeza END,
      updated_at            = now()
    WHERE id = NEW.administracion_id;

    -- DGG-234 F5b: form NO-PBA con matrícula → va a la hija (sin pisar lo existente).
    IF v_jur_form <> 'pba' AND v_matric IS NOT NULL THEN
      INSERT INTO public.matricula_extra
        (administracion_id, jurisdiccion, matricula_nro, matricula_vencimiento, certeza, origen)
      VALUES (NEW.administracion_id, v_jur_form::public.jurisdiccion_matricula, v_matric, v_venc,
              'declarado', 'formulario:'||COALESCE(v_slug,'?'))
      ON CONFLICT (administracion_id, jurisdiccion) DO UPDATE SET
        matricula_nro = COALESCE(public.matricula_extra.matricula_nro, EXCLUDED.matricula_nro),
        matricula_vencimiento = COALESCE(public.matricula_extra.matricula_vencimiento, EXCLUDED.matricula_vencimiento),
        updated_at = now();
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END $function$;

-- ==========================================================================
-- 2) backfill_admin_desde_tramite_submission (trigger; misma trampa vía trámites)
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.backfill_admin_desde_tramite_submission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_datos jsonb;
  v_padre text; v_madre text; v_legajo text; v_clave text; v_matric text;
  v_cuit text; v_cuit_titular text; v_tel text; v_nombre text; v_apellido text; v_dni text;
  v_whatsapp text; v_direccion text;
  v_localidad text; v_provincia text; v_cp text; v_cond_iva text; v_dom_fiscal text;
  v_slug text; v_servicio text; v_jur_form text;   -- DGG-234 F5b
BEGIN
  IF NEW.administracion_id IS NULL OR NEW.formulario_submission_id IS NULL THEN RETURN NEW; END IF;
  SELECT fs.datos, f.slug, s.codigo INTO v_datos, v_slug, v_servicio
    FROM public.formulario_submissions fs
    LEFT JOIN public.formularios f ON f.id = fs.formulario_id
    LEFT JOIN public.servicios s ON s.id = f.servicio_id
    WHERE fs.id = NEW.formulario_submission_id;
  IF v_datos IS NULL OR jsonb_typeof(v_datos) <> 'object' THEN RETURN NEW; END IF;
  v_jur_form := CASE WHEN v_servicio = 'rpa_actualizacion' THEN 'caba' ELSE 'pba' END;

  v_padre  := NULLIF(trim(v_datos->>'padre_apellido_nombre'), '');
  v_madre  := NULLIF(trim(v_datos->>'madre_apellido_nombre'), '');
  v_legajo := NULLIF(trim(v_datos->>'legajo_rpac'), '');
  v_clave  := NULLIF(trim(v_datos->>'clave_fiscal_arca'), '');
  v_matric := COALESCE(NULLIF(trim(v_datos->>'matricula_rpac'),''), NULLIF(trim(v_datos->>'matricula'),''));
  v_cuit   := regexp_replace(COALESCE(NULLIF(v_datos->>'cuit',''), v_datos->>'cuit_persona_juridica', ''), '[^0-9]', '', 'g');
  IF length(v_cuit) <> 11 THEN v_cuit := NULL; END IF;
  v_cuit_titular := regexp_replace(COALESCE(v_datos->>'cuit_titular_arca',''), '[^0-9]', '', 'g');
  IF length(v_cuit_titular) <> 11 THEN v_cuit_titular := NULL; END IF;
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
  v_direccion := COALESCE(v_direccion, NULLIF(trim(v_datos->>'domicilio_empresa'), ''));
  v_direccion := COALESCE(v_direccion, NULLIF(trim(v_datos->>'direccion'), ''));
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
      cuit_titular_arca     = COALESCE(cuit_titular_arca, v_cuit_titular),
      matricula_rpac        = COALESCE(matricula_rpac, CASE WHEN v_jur_form = 'pba' THEN v_matric END),  -- DGG-234 F5b
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

    IF v_jur_form <> 'pba' AND v_matric IS NOT NULL THEN
      INSERT INTO public.matricula_extra
        (administracion_id, jurisdiccion, matricula_nro, certeza, origen)
      VALUES (NEW.administracion_id, v_jur_form::public.jurisdiccion_matricula, v_matric,
              'declarado', 'formulario:'||COALESCE(v_slug,'?'))
      ON CONFLICT (administracion_id, jurisdiccion) DO UPDATE SET
        matricula_nro = COALESCE(public.matricula_extra.matricula_nro, EXCLUDED.matricula_nro),
        updated_at = now();
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END $function$;

-- ==========================================================================
-- 3) cliente_confirmar_vencimiento_matricula — a la hija si el cliente es no-PBA
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.cliente_confirmar_vencimiento_matricula(p_fecha date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin uuid;
  v_hoy   date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_jur   public.jurisdiccion_matricula;   -- DGG-234 F5b
BEGIN
  v_admin := private.current_administracion_id();
  IF v_admin IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'No encontramos tu administración activa.';
  END IF;
  PERFORM private.assert_administracion_access(v_admin);
  IF p_fecha IS NULL THEN RAISE EXCEPTION 'La fecha de vencimiento es obligatoria.'; END IF;
  IF p_fecha < DATE '2000-01-01' OR p_fecha > v_hoy + INTERVAL '10 years' THEN
    RAISE EXCEPTION 'La fecha de vencimiento (%) está fuera del rango válido.', p_fecha;
  END IF;

  -- DGG-234 F5b: si el cliente tiene matrícula NO-PBA (y no PBA en columna), la
  -- confirmación de vencimiento va a la hija; si es PBA, a la columna (como antes).
  SELECT me.jurisdiccion INTO v_jur FROM public.matricula_extra me
    WHERE me.administracion_id = v_admin ORDER BY me.jurisdiccion LIMIT 1;

  IF v_jur IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.administraciones a
                     WHERE a.id=v_admin AND a.matricula_rpac IS NOT NULL) THEN
    UPDATE public.matricula_extra
       SET matricula_vencimiento = p_fecha, certeza = 'declarado', updated_at = now()
     WHERE administracion_id = v_admin AND jurisdiccion = v_jur;
    PERFORM private.perfil_declarado_sync_venc(v_admin);
    RETURN jsonb_build_object('ok', true, 'administracion_id', v_admin,
      'jurisdiccion', v_jur, 'vencimiento', to_char(p_fecha, 'YYYY-MM-DD'));
  END IF;

  PERFORM set_config('app.venc_declarado', 'on', true);
  UPDATE public.administraciones
     SET matricula_rpac_vencimiento = p_fecha,
         matricula_rpac_vencimiento_origen = 'declarado_cliente',
         matricula_rpac_vencimiento_certeza = 'declarado',
         matricula_rpac_vencimiento_verificado_at = NULL,
         updated_at = now()
   WHERE id = v_admin;
  RETURN jsonb_build_object('ok', true, 'administracion_id', v_admin, 'vencimiento', to_char(p_fecha, 'YYYY-MM-DD'));
END;
$function$;

-- ==========================================================================
-- 4) perfil_regulatorio_declarar — acepta enum nuevo (pba/caba/neuquen) y rutea
--    la matrícula NO-PBA a `matricula_extra`. Firma IGUAL (R16 ok).
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.perfil_regulatorio_declarar(
  p_administracion_id uuid, p_jurisdiccion text DEFAULT NULL::text,
  p_matricula_fecha date DEFAULT NULL::date, p_matricula_nro text DEFAULT NULL::text,
  p_legajo_nro text DEFAULT NULL::text, p_ultima_renovacion date DEFAULT NULL::date,
  p_ultimo_curso_actualizacion date DEFAULT NULL::date, p_ultima_ddjj date DEFAULT NULL::date,
  p_ultima_consultoria date DEFAULT NULL::date, p_ultimo_certificado date DEFAULT NULL::date,
  p_no_requiere jsonb DEFAULT NULL::jsonb, p_notas text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_jur_norm public.jurisdiccion_matricula;  -- pba/caba/neuquen (fuente de verdad)
  v_jur_legacy text;                          -- 'rpac'/'rpa' para perfil_regulatorio.jurisdiccion (back-compat)
  v_es_pba boolean;
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);

  -- DGG-234 F5b: acepta el enum viejo ('rpac'/'rpa') Y el nuevo ('pba'/'caba'/'neuquen').
  IF p_jurisdiccion IS NOT NULL AND lower(p_jurisdiccion) NOT IN ('rpac','rpa','pba','caba','neuquen') THEN
    RAISE EXCEPTION 'jurisdiccion inválida' USING ERRCODE = '22023';
  END IF;
  v_jur_norm := CASE lower(COALESCE(p_jurisdiccion,''))
                  WHEN 'rpac' THEN 'pba' WHEN 'pba' THEN 'pba'
                  WHEN 'rpa'  THEN 'caba' WHEN 'caba' THEN 'caba'
                  WHEN 'neuquen' THEN 'neuquen' ELSE NULL END::public.jurisdiccion_matricula;
  v_jur_legacy := CASE WHEN v_jur_norm = 'pba' THEN 'rpac'
                       WHEN v_jur_norm IN ('caba','neuquen') THEN 'rpa' ELSE NULL END;
  v_es_pba := (v_jur_norm IS NULL OR v_jur_norm = 'pba');  -- sin jurisdicción declarada = comportamiento PBA previo

  INSERT INTO public.perfil_regulatorio AS pr (
    administracion_id, jurisdiccion, matricula_fecha_declarada, matricula_nro_declarada,
    legajo_nro_declarado, ultima_renovacion_declarada, ultimo_curso_actualizacion_declarado,
    ultima_ddjj_declarada, ultima_consultoria_declarada, ultimo_certificado_declarado,
    no_requiere, notas, updated_by
  ) VALUES (
    p_administracion_id, v_jur_legacy,
    -- la matrícula NO-PBA NO vive en perfil_regulatorio (va a la hija); PBA sí (como antes)
    CASE WHEN v_es_pba THEN p_matricula_fecha END,
    CASE WHEN v_es_pba THEN p_matricula_nro END,
    CASE WHEN v_es_pba THEN p_legajo_nro END,   -- legajo: sólo PBA
    p_ultima_renovacion, p_ultimo_curso_actualizacion,
    p_ultima_ddjj, p_ultima_consultoria, p_ultimo_certificado,
    COALESCE(p_no_requiere,'{}'::jsonb), p_notas, auth.uid()
  )
  ON CONFLICT (administracion_id) DO UPDATE SET
    jurisdiccion = COALESCE(EXCLUDED.jurisdiccion, pr.jurisdiccion),
    matricula_fecha_declarada = CASE WHEN v_es_pba THEN COALESCE(EXCLUDED.matricula_fecha_declarada, pr.matricula_fecha_declarada) ELSE pr.matricula_fecha_declarada END,
    matricula_nro_declarada = CASE WHEN v_es_pba THEN COALESCE(EXCLUDED.matricula_nro_declarada, pr.matricula_nro_declarada) ELSE pr.matricula_nro_declarada END,
    legajo_nro_declarado = CASE WHEN v_es_pba THEN COALESCE(EXCLUDED.legajo_nro_declarado, pr.legajo_nro_declarado) ELSE pr.legajo_nro_declarado END,
    ultima_renovacion_declarada = COALESCE(EXCLUDED.ultima_renovacion_declarada, pr.ultima_renovacion_declarada),
    ultimo_curso_actualizacion_declarado = COALESCE(EXCLUDED.ultimo_curso_actualizacion_declarado, pr.ultimo_curso_actualizacion_declarado),
    ultima_ddjj_declarada = COALESCE(EXCLUDED.ultima_ddjj_declarada, pr.ultima_ddjj_declarada),
    ultima_consultoria_declarada = COALESCE(EXCLUDED.ultima_consultoria_declarada, pr.ultima_consultoria_declarada),
    ultimo_certificado_declarado = COALESCE(EXCLUDED.ultimo_certificado_declarado, pr.ultimo_certificado_declarado),
    no_requiere = CASE WHEN p_no_requiere IS NULL THEN pr.no_requiere ELSE pr.no_requiere || p_no_requiere END,
    notas = COALESCE(EXCLUDED.notas, pr.notas),
    updated_by = auth.uid();

  -- DGG-234 F5b: matrícula NO-PBA declarada → hija (regla +12m sobre la fecha declarada).
  IF NOT v_es_pba AND (p_matricula_nro IS NOT NULL OR p_matricula_fecha IS NOT NULL) THEN
    INSERT INTO public.matricula_extra
      (administracion_id, jurisdiccion, matricula_nro, matricula_fecha, matricula_vencimiento, certeza, origen, updated_by)
    VALUES (p_administracion_id, v_jur_norm, p_matricula_nro, p_matricula_fecha,
            CASE WHEN p_matricula_fecha IS NOT NULL THEN (p_matricula_fecha + INTERVAL '12 months')::date END,
            'declarado', 'cliente', auth.uid())
    ON CONFLICT (administracion_id, jurisdiccion) DO UPDATE SET
      matricula_nro = COALESCE(EXCLUDED.matricula_nro, public.matricula_extra.matricula_nro),
      matricula_fecha = COALESCE(EXCLUDED.matricula_fecha, public.matricula_extra.matricula_fecha),
      matricula_vencimiento = COALESCE(EXCLUDED.matricula_vencimiento, public.matricula_extra.matricula_vencimiento),
      updated_by = auth.uid(), updated_at = now();
  END IF;

  BEGIN
    PERFORM private.perfil_declarado_sync_venc(p_administracion_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'perfil_regulatorio_declarar sync_venc admin %: %', p_administracion_id, SQLERRM;
  END;
END $function$;
