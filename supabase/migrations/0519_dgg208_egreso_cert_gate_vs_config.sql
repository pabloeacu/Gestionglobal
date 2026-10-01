-- 0519_dgg208_egreso_cert_gate_vs_config.sql
-- DGG-208 / E-GG-222 — Los gates de egreso y de certificado contaban "todas las
-- condiciones cumplidas" sobre las FILAS existentes en matricula_condiciones
-- (JOIN), no sobre las condiciones activas del curso (curso_condiciones_config).
--
-- Al inscribir a mano con pago_completo, los triggers AFTER INSERT de
-- curso_matriculas corren alfabéticos: trg_matricula_estado_pago_sync (marca
-- "Pago" cumplida) corre ANTES que trg_matricula_seed_condiciones (siembra el
-- resto). Entonces el gate de egreso se dispara con UNA sola fila (Pago) → 1/1 →
-- "egresó" con 1 de 4 condiciones reales (bug: mail "Egresó del curso" a 1/4).
-- Mismo patrón latente en el gate de emisión de certificado (si cert_emite_auto
-- fuese true, emitiría un certificado real a un 1/N).
--
-- Fix: contar SIEMPRE contra curso_condiciones_config activas del curso
-- (LEFT JOIN a matricula_condiciones; fila ausente o no cumplida = pendiente).
-- Es estrictamente más estricto: sólo puede EVITAR falsos egresos/emisiones,
-- nunca causarlos. Resuelve el orden de triggers de raíz (en estado estable el
-- resultado es idéntico al anterior porque el seed garantiza una fila por
-- condición). CREATE OR REPLACE con misma firma (no overload, R16 ok);
-- SECURITY DEFINER + search_path preservados; grants persisten.

-- ============================================================================
-- 1) Gate de aviso de egreso sin certificado automático
-- ============================================================================
CREATE OR REPLACE FUNCTION private.matricula_avisar_egreso_sin_cert_auto(p_matricula_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_mat record;
  v_auto boolean;
  v_curso text;
  v_total int;
  v_pend int;
  v_alumno text;
BEGIN
  SELECT m.* INTO v_mat FROM public.curso_matriculas m WHERE m.id = p_matricula_id;
  IF v_mat.id IS NULL OR v_mat.egreso_sin_cert_avisado_at IS NOT NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.certificados ct WHERE ct.matricula_id = p_matricula_id) THEN
    RETURN;
  END IF;

  SELECT c.cert_emite_auto, c.titulo INTO v_auto, v_curso FROM public.cursos c WHERE c.id = v_mat.curso_id;
  IF COALESCE(v_auto, true) THEN
    RETURN;
  END IF;

  -- DGG-208: contar contra las condiciones ACTIVAS del curso, no contra las filas
  -- sembradas (si falta una fila o no está cumplida, cuenta como pendiente).
  SELECT count(*) FILTER (WHERE cc.activa),
         count(*) FILTER (WHERE cc.activa AND NOT COALESCE(mc.cumplida, false))
    INTO v_total, v_pend
    FROM public.curso_condiciones_config cc
    LEFT JOIN public.matricula_condiciones mc
      ON mc.condicion_id = cc.id AND mc.matricula_id = p_matricula_id
   WHERE cc.curso_id = v_mat.curso_id;
  IF v_total IS NULL OR v_total = 0 OR v_pend <> 0 THEN
    RETURN;
  END IF;
  IF NOT public.matricula_cumple_encuesta(p_matricula_id) THEN
    RETURN;
  END IF;

  SELECT p.full_name INTO v_alumno FROM public.profiles p WHERE p.id = v_mat.profile_id;

  PERFORM public.notify_all_gerentes(
    'egreso_sin_cert_auto',
    '🎓 Egresó del curso · ' || COALESCE(v_alumno, 'Alumno'),
    'Egresó del curso el alumno ' || COALESCE(v_alumno, '—') || ' («' || COALESCE(v_curso, 'su curso')
      || '»). La configuración del curso no emite el certificado automáticamente. Es tiempo de '
      || 'gestionarlo para completar el ciclo de la graduación.',
    '/gerencia/campus/' || v_mat.curso_id::text,
    jsonb_build_object('matricula_id', p_matricula_id, 'curso_id', v_mat.curso_id),
    true,
    'gerencia-notif-generica',
    NULL, 2::smallint,
    'curso_matriculas', p_matricula_id
  );

  UPDATE public.curso_matriculas
     SET egreso_sin_cert_avisado_at = now()
   WHERE id = p_matricula_id;
END;
$fn$;

-- ============================================================================
-- 2) Gate de emisión automática de certificado (si corresponde)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.emitir_certificado_si_corresponde(p_matricula_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_total integer; v_cumplidas integer; v_existe uuid;
  v_curso_id uuid; v_auto boolean;
BEGIN
  SELECT id INTO v_existe FROM public.certificados WHERE matricula_id = p_matricula_id;
  IF v_existe IS NOT NULL THEN RETURN v_existe; END IF;

  SELECT m.curso_id INTO v_curso_id FROM public.curso_matriculas m WHERE m.id = p_matricula_id;
  SELECT cert_emite_auto INTO v_auto FROM public.cursos WHERE id = v_curso_id;
  IF NOT COALESCE(v_auto, true) THEN
    RETURN NULL;
  END IF;

  -- DGG-208: contar contra las condiciones ACTIVAS del curso.
  SELECT count(*) FILTER (WHERE cc.activa),
         count(*) FILTER (WHERE cc.activa AND COALESCE(mc.cumplida, false))
    INTO v_total, v_cumplidas
    FROM public.curso_condiciones_config cc
    LEFT JOIN public.matricula_condiciones mc
      ON mc.condicion_id = cc.id AND mc.matricula_id = p_matricula_id
   WHERE cc.curso_id = v_curso_id;
  IF v_total IS NULL OR v_total = 0 OR v_cumplidas < v_total THEN
    RETURN NULL;
  END IF;

  -- Mig 0137: gate de encuesta. Si requiere encuesta y no respondió, NO emitir.
  IF NOT public.matricula_cumple_encuesta(p_matricula_id) THEN
    RETURN NULL;
  END IF;

  RETURN public.emitir_certificado(p_matricula_id);
END;
$fn$;

-- ============================================================================
-- 3) Emisión real del certificado (gate de respaldo, también para emisión manual)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.emitir_certificado(p_matricula_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_mat       public.curso_matriculas%ROWTYPE;
  v_curso     public.cursos%ROWTYPE;
  v_nombre    text;
  v_email     text;
  v_total     integer;
  v_cumplidas integer;
  v_cert_id   uuid;
  v_codigo    text;
  v_hash      text;
  v_key       text;
  v_nota      numeric;
  v_tema      smallint;
  v_anio      text := to_char(public.hoy_ar(), 'YYYY');
  v_sufijo    text;
  v_existe    public.certificados%ROWTYPE;
  v_esquema   jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede emitir certificados' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_mat FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_mat.id IS NULL THEN
    RAISE EXCEPTION 'Matricula inexistente' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existe FROM public.certificados WHERE matricula_id = p_matricula_id;
  IF v_existe.id IS NOT NULL THEN
    RETURN v_existe.id;
  END IF;

  -- Mig 0137/0139: gate de encuesta. Si requiere encuesta y no respondió, bloquear.
  IF NOT public.matricula_cumple_encuesta(p_matricula_id) THEN
    RAISE EXCEPTION 'No se puede emitir: el alumno todavía no respondió la encuesta de satisfacción (requerida para este curso).'
      USING ERRCODE = '22023';
  END IF;

  -- DGG-208: contar contra las condiciones ACTIVAS del curso.
  SELECT count(*) FILTER (WHERE cc.activa),
         count(*) FILTER (WHERE cc.activa AND COALESCE(mc.cumplida, false))
    INTO v_total, v_cumplidas
    FROM public.curso_condiciones_config cc
    LEFT JOIN public.matricula_condiciones mc
      ON mc.condicion_id = cc.id AND mc.matricula_id = p_matricula_id
   WHERE cc.curso_id = v_mat.curso_id;
  IF v_total IS NULL OR v_total = 0 THEN
    RAISE EXCEPTION 'El curso no tiene condiciones activas configuradas; no se puede emitir certificado'
      USING ERRCODE = '22023';
  END IF;
  IF v_cumplidas < v_total THEN
    RAISE EXCEPTION 'Faltan condiciones por cumplir (%/%)', v_cumplidas, v_total
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_curso FROM public.cursos WHERE id = v_mat.curso_id;
  SELECT COALESCE(full_name, 'Alumno') INTO v_nombre
    FROM public.profiles WHERE id = v_mat.profile_id;
  SELECT max(ei.nota) INTO v_nota
    FROM public.examen_intentos ei
    JOIN public.curso_examenes ce ON ce.id = ei.examen_id
   WHERE ei.matricula_id = p_matricula_id
     AND ei.aprobado = true
     AND ce.curso_id = v_mat.curso_id;
  v_tema := public.gg_campus_tema_certificado(v_mat.curso_id);
  v_sufijo := upper(substr(replace(regexp_replace(v_curso.slug, '[^a-zA-Z]', '', 'g'), '-', ''), 1, 4));
  IF v_sufijo IS NULL OR length(v_sufijo) = 0 THEN v_sufijo := 'CERT'; END IF;
  v_codigo := 'GG-' || v_sufijo || '-' || v_anio || '-'
              || upper(encode(extensions.gen_random_bytes(3), 'hex'));
  SELECT hmac_key INTO v_key FROM private.campus_secrets WHERE id = 1;
  v_hash := encode(
    extensions.hmac(
      v_codigo || '|' || v_mat.curso_id::text || '|' || v_mat.profile_id::text
        || '|' || to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'),
      v_key, 'sha256'),
    'hex');

  v_esquema := public.resolver_esquema_curso(v_mat.curso_id);

  INSERT INTO public.certificados (
    matricula_id, curso_id, administracion_id, alumno_profile_id,
    codigo, verificacion_hash, nota_examen, instructor_nombre, tema,
    payload_snapshot, esquema_snapshot
  ) VALUES (
    p_matricula_id, v_mat.curso_id, v_mat.administracion_id, v_mat.profile_id,
    v_codigo, v_hash, v_nota, v_curso.instructor_nombre, v_tema,
    jsonb_build_object(
      'alumno_nombre', v_nombre,
      'curso_titulo', v_curso.titulo,
      'instructor_nombre', v_curso.instructor_nombre,
      'duracion_horas', v_curso.duracion_horas,
      'nota_examen', v_nota,
      'emitido_at', now()
    ),
    v_esquema
  )
  RETURNING id INTO v_cert_id;

  v_email := (SELECT email FROM auth.users WHERE id = v_mat.profile_id);
  IF v_email IS NOT NULL THEN
    PERFORM public.encolar_email(
      'certificado-emitido', v_email, v_nombre,
      jsonb_build_object('nombre', v_nombre, 'nombre_curso', v_curso.titulo, 'codigo', v_codigo),
      NULL, NULL, 'certificados', v_cert_id, 4::smallint
    );
    UPDATE public.certificados SET enviado_email_at = now() WHERE id = v_cert_id;
  END IF;
  RETURN v_cert_id;
END;
$fn$;

-- ============================================================================
-- 4) Gate de aviso "certificado retenido por pago"
-- ============================================================================
CREATE OR REPLACE FUNCTION private.matricula_avisar_cert_retenido(p_matricula_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_mat record;
  v_total int; v_ok int; v_pend_pago int;
  v_alumno text; v_curso text;
BEGIN
  SELECT m.* INTO v_mat FROM public.curso_matriculas m WHERE m.id = p_matricula_id;
  IF v_mat.id IS NULL OR v_mat.cert_retenido_avisado_at IS NOT NULL
     OR v_mat.estado_pago = 'pago_completo' THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.certificados ct WHERE ct.matricula_id = p_matricula_id) THEN
    RETURN;
  END IF;

  -- DGG-208: contar contra las condiciones ACTIVAS del curso.
  SELECT count(*) FILTER (WHERE cc.activa),
         count(*) FILTER (WHERE cc.activa AND COALESCE(mc.cumplida, false)),
         count(*) FILTER (WHERE cc.activa AND NOT COALESCE(mc.cumplida, false) AND cc.tipo = 'pago')
    INTO v_total, v_ok, v_pend_pago
    FROM public.curso_condiciones_config cc
    LEFT JOIN public.matricula_condiciones mc
      ON mc.condicion_id = cc.id AND mc.matricula_id = p_matricula_id
   WHERE cc.curso_id = v_mat.curso_id;

  IF v_total IS NULL OR v_total = 0 OR v_pend_pago = 0 OR (v_total - v_ok) <> v_pend_pago THEN
    RETURN;
  END IF;

  SELECT p.full_name INTO v_alumno FROM public.profiles p WHERE p.id = v_mat.profile_id;
  SELECT c.titulo INTO v_curso FROM public.cursos c WHERE c.id = v_mat.curso_id;

  PERFORM public.notify_all_gerentes(
    'cert_retenido_pago',
    '🎓 Certificado retenido por pago · ' || COALESCE(v_alumno, 'Alumno'),
    COALESCE(v_alumno, 'El alumno') || ' completó todas las condiciones de «'
      || COALESCE(v_curso, 'su curso') || '» pero su estado de pago es «'
      || replace(v_mat.estado_pago, '_', ' ')
      || '». Cambiá el estado de pago o acreditá la condición para que el certificado se emita.',
    '/gerencia/campus/' || v_mat.curso_id::text,
    jsonb_build_object('matricula_id', p_matricula_id, 'curso_id', v_mat.curso_id),
    true,
    'gerencia-notif-generica',
    NULL, 2::smallint,
    'curso_matriculas', p_matricula_id
  );

  UPDATE public.curso_matriculas
     SET cert_retenido_avisado_at = now()
   WHERE id = p_matricula_id;
END;
$fn$;

-- ============================================================================
-- 5) Limpieza de flags falsos: matrículas marcadas con aviso de egreso que NO
--    cumplen todas las condiciones activas del curso (falsos positivos del bug).
--    Preserva las legítimas (todas cumplidas, p.ej. SANCLAUDIO 4/4).
-- ============================================================================
UPDATE public.curso_matriculas m
   SET egreso_sin_cert_avisado_at = NULL
 WHERE m.egreso_sin_cert_avisado_at IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.curso_condiciones_config cc
     LEFT JOIN public.matricula_condiciones mc
       ON mc.condicion_id = cc.id AND mc.matricula_id = m.id
     WHERE cc.curso_id = m.curso_id AND cc.activa
       AND NOT COALESCE(mc.cumplida, false)
   );

-- Mismo criterio para el aviso de "certificado retenido" (por si quedó algún
-- falso positivo del mismo patrón): resetear donde NO está "todo cumplido menos el pago".
UPDATE public.curso_matriculas m
   SET cert_retenido_avisado_at = NULL
 WHERE m.cert_retenido_avisado_at IS NOT NULL
   AND NOT EXISTS (
     -- debe cumplirse: hay pago pendiente y lo ÚNICO pendiente es el pago
     SELECT 1 FROM (
       SELECT count(*) FILTER (WHERE cc.activa AND NOT COALESCE(mc.cumplida,false)) AS pend,
              count(*) FILTER (WHERE cc.activa AND NOT COALESCE(mc.cumplida,false) AND cc.tipo='pago') AS pend_pago
       FROM public.curso_condiciones_config cc
       LEFT JOIN public.matricula_condiciones mc
         ON mc.condicion_id = cc.id AND mc.matricula_id = m.id
       WHERE cc.curso_id = m.curso_id
     ) q
     WHERE q.pend_pago > 0 AND q.pend = q.pend_pago
   );
