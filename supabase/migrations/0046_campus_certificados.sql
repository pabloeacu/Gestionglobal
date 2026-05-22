-- ============================================================================
-- 0046_campus_certificados · Campus Fase 2 (Punto 6 · DGG-10 / DGG-10bis)
--
-- El certificado verificable. Sobre la base de 0045_campus_fase1:
--   1. Tabla `certificados` (un cert por matrícula, código legible + hash HMAC
--      anti-falsificación, snapshot de datos, tema 1..4).
--   2. Bucket privado `certificados` (PDF servido por signed URL desde el portal).
--   3. RPC `emitir_certificado(p_matricula_id)` — staff/sistema; valida que TODAS
--      las condiciones activas estén cumplidas; idempotente.
--   4. Función motor `gg_campus_emitir_certificados_pendientes()` — barre
--      matrículas listas sin cert → emite + encola email. Cron cada 5 min.
--   5. Trigger: al tildar la última condición / aprobar el último examen, la
--      emisión se intenta en el acto (vía matricula_sync_examen y
--      matricula_tildar_condicion → emitir_certificado). El cron es backstop.
--   6. RPC pública `verificar_certificado(p_codigo)` — anon; datos NO sensibles.
--   7. Email `certificado-emitido`.
--
-- Reglas: 2 (RLS), 3 (secret del hash sólo server-side), 5 (RPC SD + search_path),
-- 6 (versionada), 8 (naming verificado: examen_intentos.nota es smallint,
-- curso_matriculas.inscripto_at), 11 (índice en cada FK), 12 (single-tenant; las
-- RPCs son staff o anon-públicas de sólo lectura).
--
-- El RENDER del PDF es client-side (jsPDF + qrcode): el QR codifica la URL
-- pública /verificar/:codigo; la AUTENTICIDAD la da verificar_certificado
-- validando contra la fila. `pdf_storage_path` queda NULL en el MVP (se genera
-- al vuelo al descargar). El bucket queda creado para una futura subida.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Secret para el hash de integridad (regla 3: sólo server-side).
-- Lo guardamos en una tabla del schema `private` (no expuesta por PostgREST).
-- Se genera una vez; si ya existe no se toca.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.campus_secrets (
  id      smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  hmac_key text NOT NULL
);
INSERT INTO private.campus_secrets (id, hmac_key)
VALUES (1, encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2 · Tabla certificados
-- ---------------------------------------------------------------------------
CREATE TABLE public.certificados (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula_id       uuid NOT NULL
                       REFERENCES public.curso_matriculas(id) ON DELETE RESTRICT,
  curso_id           uuid NOT NULL REFERENCES public.cursos(id) ON DELETE RESTRICT,
  administracion_id  uuid REFERENCES public.administraciones(id) ON DELETE SET NULL,
  alumno_profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  codigo             text NOT NULL UNIQUE,          -- legible: GG-RPAC-2026-XXXXXX
  verificacion_hash  text NOT NULL,                 -- HMAC(secret, codigo|...)
  nota_examen        numeric,                       -- null si el curso no exige examen
  instructor_nombre  text,
  tema               smallint NOT NULL DEFAULT 1 CHECK (tema BETWEEN 1 AND 4),
  -- Snapshot congelado al emitir (nombre alumno, curso, fecha) — independiente
  -- de cambios posteriores en el perfil o el curso.
  payload_snapshot   jsonb NOT NULL DEFAULT '{}'::jsonb,
  emitido_at         timestamptz NOT NULL DEFAULT now(),
  pdf_storage_path   text,                          -- null hasta render persistido
  enviado_email_at   timestamptz,
  revocado_at        timestamptz,
  revocado_motivo    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_certificado_matricula UNIQUE (matricula_id)
);

CREATE INDEX idx_certificados_matricula ON public.certificados(matricula_id);
CREATE INDEX idx_certificados_curso     ON public.certificados(curso_id);
CREATE INDEX idx_certificados_profile   ON public.certificados(alumno_profile_id);
CREATE INDEX idx_certificados_admin
  ON public.certificados(administracion_id) WHERE administracion_id IS NOT NULL;
-- codigo ya tiene índice por UNIQUE.

CREATE TRIGGER trg_certificados_touch
  BEFORE UPDATE ON public.certificados
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.certificados IS
  'DGG-10 Fase 2: certificado verificable por matrícula. codigo + verificacion_hash '
  'dan la autenticidad (verificar_certificado, público). payload_snapshot congela '
  'los datos al emitir. PDF se renderiza client-side (jsPDF+QR); pdf_storage_path '
  'queda null en el MVP.';

-- ---------------------------------------------------------------------------
-- RLS (regla 2): staff ve/maneja todo; el alumno ve los suyos (matrícula→profile).
-- La verificación pública NO usa RLS: pasa por verificar_certificado (SD, anon).
-- ---------------------------------------------------------------------------
ALTER TABLE public.certificados ENABLE ROW LEVEL SECURITY;

CREATE POLICY certificados_select ON public.certificados
  FOR SELECT TO authenticated
  USING (private.is_staff() OR alumno_profile_id = auth.uid());
CREATE POLICY certificados_cud ON public.certificados
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

-- ---------------------------------------------------------------------------
-- 3 · Bucket de Storage privado para los PDF (signed URL desde el portal).
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('certificados', 'certificados', false)
ON CONFLICT (id) DO NOTHING;

-- Acceso al bucket: staff total; el alumno lee los objetos de sus certificados.
-- (El path se modela como '<certificado_id>/<archivo>.pdf'.)
CREATE POLICY certificados_storage_staff ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'certificados' AND private.is_staff())
  WITH CHECK (bucket_id = 'certificados' AND private.is_staff());

CREATE POLICY certificados_storage_alumno_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'certificados'
    AND EXISTS (
      SELECT 1 FROM public.certificados c
       WHERE c.alumno_profile_id = auth.uid()
         AND storage.objects.name LIKE c.id::text || '/%'
    )
  );

-- ---------------------------------------------------------------------------
-- 4 · Helper: tema del certificado según el curso (categoría / año).
-- 1=marino+dorado (formación integral) · 2=dorado (actualización 2024) ·
-- 3=cyan-teal (act. 2025) · 4=violeta (act. 2026). Heurística simple sobre
-- el slug/título; staff puede overridear seteando certificados.tema.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gg_campus_tema_certificado(p_curso_id uuid)
RETURNS smallint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN c.slug ILIKE '%formacion%' OR c.titulo ILIKE '%formaci%' THEN 1::smallint
    WHEN c.titulo ILIKE '%2024%' THEN 2::smallint
    WHEN c.titulo ILIKE '%2026%' THEN 4::smallint
    WHEN c.titulo ILIKE '%actualizaci%' THEN 3::smallint
    ELSE 1::smallint
  END
  FROM public.cursos c WHERE c.id = p_curso_id;
$$;
REVOKE EXECUTE ON FUNCTION public.gg_campus_tema_certificado(uuid) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 5 · RPC emitir_certificado(p_matricula_id) — SD, staff/sistema.
-- Valida que TODAS las condiciones ACTIVAS del curso estén cumplidas.
-- Idempotente: si ya existe el cert, lo devuelve. Encola el email una sola vez.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emitir_certificado(p_matricula_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
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
  v_anio      text := to_char(now(), 'YYYY');
  v_sufijo    text;
  v_existe    public.certificados%ROWTYPE;
BEGIN
  -- Sólo staff (alcanzable directo). El motor/cron corre como SD y no chequea
  -- is_staff (no hay auth.uid); para llamadas directas exigimos staff.
  IF auth.uid() IS NOT NULL AND NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede emitir certificados' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_mat FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_mat.id IS NULL THEN
    RAISE EXCEPTION 'Matrícula inexistente' USING ERRCODE = '22023';
  END IF;

  -- Idempotencia: si ya existe, devolverlo.
  SELECT * INTO v_existe FROM public.certificados WHERE matricula_id = p_matricula_id;
  IF v_existe.id IS NOT NULL THEN
    RETURN v_existe.id;
  END IF;

  -- TODAS las condiciones activas deben estar cumplidas.
  SELECT count(*) FILTER (WHERE cc.activa),
         count(*) FILTER (WHERE cc.activa AND mc.cumplida)
    INTO v_total, v_cumplidas
    FROM public.matricula_condiciones mc
    JOIN public.curso_condiciones_config cc ON cc.id = mc.condicion_id
   WHERE mc.matricula_id = p_matricula_id;

  -- Si no hay condiciones activas, NO se emite automáticamente (un curso sin
  -- condiciones definidas no acredita nada). Esto evita certificados vacíos.
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

  -- Mejor nota aprobada (smallint en BD → numeric en el cert).
  SELECT max(ei.nota) INTO v_nota
    FROM public.examen_intentos ei
    JOIN public.curso_examenes ce ON ce.id = ei.examen_id
   WHERE ei.matricula_id = p_matricula_id
     AND ei.aprobado = true
     AND ce.curso_id = v_mat.curso_id;

  v_tema := public.gg_campus_tema_certificado(v_mat.curso_id);

  -- Código legible y único: GG-<token curso>-<año>-<6 hex>.
  v_sufijo := upper(substr(replace(regexp_replace(v_curso.slug, '[^a-zA-Z]', '', 'g'), '-', ''), 1, 4));
  IF v_sufijo IS NULL OR length(v_sufijo) = 0 THEN v_sufijo := 'CERT'; END IF;
  v_codigo := 'GG-' || v_sufijo || '-' || v_anio || '-'
              || upper(encode(extensions.gen_random_bytes(3), 'hex'));

  -- Hash de integridad (regla 3: el secret nunca sale al front).
  SELECT hmac_key INTO v_key FROM private.campus_secrets WHERE id = 1;
  v_hash := encode(
    extensions.hmac(
      v_codigo || '|' || v_mat.curso_id::text || '|' || v_mat.profile_id::text
        || '|' || to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'),
      v_key, 'sha256'),
    'hex');

  INSERT INTO public.certificados (
    matricula_id, curso_id, administracion_id, alumno_profile_id,
    codigo, verificacion_hash, nota_examen, instructor_nombre, tema,
    payload_snapshot
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
    )
  )
  RETURNING id INTO v_cert_id;

  -- Encolar el email una sola vez. administracion_id = NULL: la emisión corre
  -- también desde el cron/trigger SIN auth.uid(); encolar_email con un
  -- administracion_id no-null invoca assert_administracion_access, que en ese
  -- contexto (sin staff ni current_administracion_id) deniega y abortaría la
  -- emisión. La notificación es al alumno y no necesita el guard per-admin; el
  -- vínculo queda por related_table/related_id = certificados/id.
  v_email := (SELECT email FROM auth.users WHERE id = v_mat.profile_id);
  IF v_email IS NOT NULL THEN
    PERFORM public.encolar_email(
      'certificado-emitido', v_email, v_nombre,
      jsonb_build_object(
        'nombre', v_nombre,
        'nombre_curso', v_curso.titulo,
        'codigo', v_codigo
      ),
      NULL, NULL, 'certificados', v_cert_id, 4::smallint
    );
    UPDATE public.certificados SET enviado_email_at = now() WHERE id = v_cert_id;
  END IF;

  RETURN v_cert_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.emitir_certificado(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.emitir_certificado(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6 · emitir_certificado_si_corresponde — versión silenciosa (no levanta si
-- faltan condiciones). La usan los triggers / el motor: intenta emitir y
-- devuelve el id o NULL. NUNCA aborta la transacción del trigger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emitir_certificado_si_corresponde(p_matricula_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_total     integer;
  v_cumplidas integer;
  v_existe    uuid;
BEGIN
  SELECT id INTO v_existe FROM public.certificados WHERE matricula_id = p_matricula_id;
  IF v_existe IS NOT NULL THEN RETURN v_existe; END IF;

  SELECT count(*) FILTER (WHERE cc.activa),
         count(*) FILTER (WHERE cc.activa AND mc.cumplida)
    INTO v_total, v_cumplidas
    FROM public.matricula_condiciones mc
    JOIN public.curso_condiciones_config cc ON cc.id = mc.condicion_id
   WHERE mc.matricula_id = p_matricula_id;

  IF v_total IS NULL OR v_total = 0 OR v_cumplidas < v_total THEN
    RETURN NULL;  -- todavía no corresponde
  END IF;

  RETURN public.emitir_certificado(p_matricula_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.emitir_certificado_si_corresponde(uuid)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7 · Disparo por evento: extender matricula_sync_examen para que, tras tildar
-- la condición de examen, intente emitir. Y un AFTER UPDATE en
-- matricula_condiciones para cubrir el tilde manual (asistencia/pago/otra).
-- (matricula_tildar_condicion ya hace el UPDATE; el trigger lo levanta.)
-- ---------------------------------------------------------------------------
-- 7a · Re-crear matricula_sync_examen con el intento de emisión al final.
CREATE OR REPLACE FUNCTION public.matricula_sync_examen(p_matricula_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_curso_id uuid;
  v_cond record;
  v_aprobado boolean;
BEGIN
  SELECT curso_id INTO v_curso_id
    FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_curso_id IS NULL THEN RETURN; END IF;

  FOR v_cond IN
    SELECT cc.id, cc.examen_id
      FROM public.curso_condiciones_config cc
     WHERE cc.curso_id = v_curso_id AND cc.tipo = 'examen' AND cc.activa = true
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.examen_intentos ei
       JOIN public.curso_examenes ce ON ce.id = ei.examen_id
      WHERE ei.matricula_id = p_matricula_id
        AND ei.aprobado = true
        AND ce.curso_id = v_curso_id
        AND (v_cond.examen_id IS NULL OR ei.examen_id = v_cond.examen_id)
    ) INTO v_aprobado;

    IF v_aprobado THEN
      INSERT INTO public.matricula_condiciones
        (matricula_id, condicion_id, cumplida, cumplida_at, cumplida_por)
      VALUES (p_matricula_id, v_cond.id, true, now(), NULL)
      ON CONFLICT (matricula_id, condicion_id) DO UPDATE
        SET cumplida = true,
            cumplida_at = COALESCE(public.matricula_condiciones.cumplida_at, now())
      WHERE public.matricula_condiciones.cumplida = false;
    END IF;
  END LOOP;

  -- Fase 2: al sincronizar el examen puede quedar todo cumplido → emitir.
  PERFORM public.emitir_certificado_si_corresponde(p_matricula_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.matricula_sync_examen(uuid)
  FROM PUBLIC, anon, authenticated;

-- 7b · AFTER UPDATE OF cumplida en matricula_condiciones → intentar emitir.
CREATE OR REPLACE FUNCTION public.trg_condicion_cumplida_emitir()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.cumplida = true AND COALESCE(OLD.cumplida, false) = false THEN
    PERFORM public.emitir_certificado_si_corresponde(NEW.matricula_id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trg_condicion_cumplida_emitir()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_matricula_condiciones_emitir ON public.matricula_condiciones;
CREATE TRIGGER trg_matricula_condiciones_emitir
  AFTER INSERT OR UPDATE OF cumplida ON public.matricula_condiciones
  FOR EACH ROW EXECUTE FUNCTION public.trg_condicion_cumplida_emitir();

-- ---------------------------------------------------------------------------
-- 8 · Motor / backstop: barre matrículas listas sin cert. Cron cada 5 min.
-- Devuelve cuántos certificados emitió. Idempotente (emitir_certificado lo es).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gg_campus_emitir_certificados_pendientes()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_count integer := 0;
  v_id uuid;
BEGIN
  FOR r IN
    SELECT m.id AS matricula_id
      FROM public.curso_matriculas m
     WHERE m.estado IN ('activa','completada')
       AND NOT EXISTS (SELECT 1 FROM public.certificados c WHERE c.matricula_id = m.id)
       AND EXISTS (
         SELECT 1 FROM public.curso_condiciones_config cc
          WHERE cc.curso_id = m.curso_id AND cc.activa = true
       )
       -- todas las condiciones activas del curso están cumplidas para esta matrícula
       AND NOT EXISTS (
         SELECT 1
           FROM public.curso_condiciones_config cc
           LEFT JOIN public.matricula_condiciones mc
             ON mc.condicion_id = cc.id AND mc.matricula_id = m.id
          WHERE cc.curso_id = m.curso_id AND cc.activa = true
            AND COALESCE(mc.cumplida, false) = false
       )
  LOOP
    v_id := public.emitir_certificado_si_corresponde(r.matricula_id);
    IF v_id IS NOT NULL THEN v_count := v_count + 1; END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.gg_campus_emitir_certificados_pendientes()
  FROM PUBLIC, anon, authenticated;

-- Cron cada 5 min (backstop; el disparo por evento cubre el caso inmediato).
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gg-campus-certificados') THEN
    PERFORM cron.unschedule('gg-campus-certificados');
  END IF;
  PERFORM cron.schedule(
    'gg-campus-certificados',
    '*/5 * * * *',
    $cron$ SELECT public.gg_campus_emitir_certificados_pendientes(); $cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron schedule gg-campus-certificados: %', SQLERRM;
END $do$;

-- ---------------------------------------------------------------------------
-- 9 · RPC pública verificar_certificado(p_codigo) — anon, SD, sólo lectura.
-- Devuelve datos NO sensibles: nombre, curso, fecha, instructor, nota, estado.
-- NUNCA el hash ni el PDF. Es la prueba de autenticidad para el QR.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verificar_certificado(p_codigo text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v public.certificados%ROWTYPE;
BEGIN
  IF p_codigo IS NULL OR length(trim(p_codigo)) = 0 THEN
    RETURN jsonb_build_object('valido', false, 'estado', 'no_encontrado');
  END IF;

  SELECT * INTO v FROM public.certificados
   WHERE codigo = upper(trim(p_codigo));

  IF v.id IS NULL THEN
    RETURN jsonb_build_object('valido', false, 'estado', 'no_encontrado');
  END IF;

  IF v.revocado_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'valido', false, 'estado', 'revocado',
      'codigo', v.codigo,
      'alumno_nombre', v.payload_snapshot->>'alumno_nombre',
      'curso_titulo', v.payload_snapshot->>'curso_titulo',
      'revocado_motivo', v.revocado_motivo
    );
  END IF;

  RETURN jsonb_build_object(
    'valido', true, 'estado', 'valido',
    'codigo', v.codigo,
    'alumno_nombre', v.payload_snapshot->>'alumno_nombre',
    'curso_titulo', v.payload_snapshot->>'curso_titulo',
    'instructor_nombre', v.instructor_nombre,
    'nota_examen', v.nota_examen,
    'emitido_at', v.emitido_at
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.verificar_certificado(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.verificar_certificado(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10 · RPC revocar_certificado(p_id, p_motivo) — staff. Acción explícita.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revocar_certificado(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede revocar certificados' USING ERRCODE = '42501';
  END IF;
  UPDATE public.certificados
     SET revocado_at = now(), revocado_motivo = p_motivo
   WHERE id = p_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.revocar_certificado(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.revocar_certificado(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 11 · Email template `certificado-emitido` (casilla cursos).
-- ---------------------------------------------------------------------------
INSERT INTO public.email_templates (slug, nombre, asunto, body_html, body_text, from_casilla, descripcion, variables)
VALUES (
  'certificado-emitido',
  'Certificado emitido',
  '¡Tu certificado de {{nombre_curso}} está listo!',
  '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">'
    || '<div style="border-bottom:3px solid #009eca;padding:12px 0;font-weight:700;font-size:18px">Gestión Global</div>'
    || '<div style="padding:18px 0;line-height:1.6;font-size:15px">'
    || '<h2 style="margin:0 0 10px;font-size:20px">¡Felicitaciones, {{nombre}}!</h2>'
    || '<p>Cumpliste todas las condiciones del curso <strong>{{nombre_curso}}</strong>. '
    || 'Tu certificado ya está disponible y lo podés descargar desde el campus.</p>'
    || '<p style="margin:14px 0;background:#f1f5f9;border-radius:8px;padding:10px 14px;font-size:14px">'
    || 'Código de verificación: <strong>{{codigo}}</strong></p>'
    || '<p style="font-size:13px;color:#64748b">Cualquier persona puede verificar la autenticidad '
    || 'del certificado en <a href="https://gestionglobal.ar/verificar/{{codigo}}" style="color:#009eca">gestionglobal.ar/verificar/{{codigo}}</a>.</p>'
    || '</div>'
    || '<div style="border-top:1px solid #e2e8f0;padding-top:12px;color:#64748b;font-size:12px">'
    || 'Gestión Global · gestionglobal.ar — Campus virtual.</div>'
    || '</div>',
  E'¡Felicitaciones {{nombre}}! Tu certificado de {{nombre_curso}} está listo.\n\n'
    || E'Descargalo desde el campus. Código de verificación: {{codigo}}\n'
    || E'Verificá su autenticidad en gestionglobal.ar/verificar/{{codigo}}\n\n'
    || E'— Gestión Global · gestionglobal.ar',
  'cursos',
  'Aviso al alumno de que su certificado fue emitido y está disponible.',
  '["nombre","nombre_curso","codigo"]'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 12 · Realtime sobre certificados (UX premium: el portal refresca al emitir).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.certificados;
      EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;
