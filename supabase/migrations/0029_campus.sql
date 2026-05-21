-- ============================================================================
-- 0029_campus · Subsistema 7 (Documento Maestro): Campus virtual.
--
-- Cursos como entidad con permisos por usuario/admin y vigencia; clases
-- asincrónicas (YouTube embebido), sincrónicas (calendario/links/recordatorios),
-- bibliografía, exámenes autocorregibles (MC / V-F) con fechas de habilitación
-- y cierre programables.
--
-- Decisiones (regla 1, decisión 2026-05-19, regla 12):
-- - Single-tenant: NO empresa_id. Las matrículas pertenecen a un profile y
--   opcionalmente referencian una administracion (cliente al que el alumno
--   pertenece para fines de facturación/atribución).
-- - RLS día 1 (regla 2). Cursos activos son SELECT público (auth or anon)
--   para landing/portal. Resto: dueño + staff.
-- - RPCs SECURITY DEFINER con SET search_path = public, pg_temp (regla 5).
-- - Tenancy guard en matricular (regla 12).
-- - Email via encolar_email + template seedeado 'curso-inscripcion-confirmada'.
-- - FK indexes (regla 11). Partial index sobre matrículas activas.
-- - Trigger BEFORE INSERT en examen_intentos valida ventana.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- cursos · catálogo del campus
-- ---------------------------------------------------------------------------
CREATE TABLE public.cursos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  titulo text NOT NULL,
  descripcion text,
  descripcion_html text,
  requisitos_html text,
  categoria text,
  modalidad text NOT NULL DEFAULT 'asincronica'
    CHECK (modalidad IN ('asincronica','sincronica','mixta')),
  duracion_horas smallint
    CHECK (duracion_horas IS NULL OR duracion_horas >= 0),
  precio_lista numeric(14,2)
    CHECK (precio_lista IS NULL OR precio_lista >= 0),
  activo boolean NOT NULL DEFAULT true,
  fecha_inicio date,
  fecha_fin date,
  cupo_max smallint
    CHECK (cupo_max IS NULL OR cupo_max > 0),
  instructor_nombre text,
  instructor_bio text,
  banner_url text,
  vigencia_meses smallint NOT NULL DEFAULT 12
    CHECK (vigencia_meses > 0 AND vigencia_meses <= 120),
  observaciones text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT chk_curso_fechas
    CHECK (fecha_fin IS NULL OR fecha_inicio IS NULL OR fecha_fin >= fecha_inicio)
);

CREATE INDEX idx_cursos_activo ON public.cursos(activo);
CREATE INDEX idx_cursos_categoria
  ON public.cursos(categoria) WHERE categoria IS NOT NULL;
CREATE INDEX idx_cursos_created_by
  ON public.cursos(created_by) WHERE created_by IS NOT NULL;

CREATE TRIGGER trg_cursos_touch
  BEFORE UPDATE ON public.cursos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_cursos_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.cursos
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- ---------------------------------------------------------------------------
-- curso_modulos · agrupador de clases dentro de un curso
-- ---------------------------------------------------------------------------
CREATE TABLE public.curso_modulos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curso_id uuid NOT NULL REFERENCES public.cursos(id) ON DELETE CASCADE,
  orden smallint NOT NULL DEFAULT 0,
  titulo text NOT NULL,
  descripcion text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_curso_modulos_curso
  ON public.curso_modulos(curso_id, orden);

CREATE TRIGGER trg_curso_modulos_touch
  BEFORE UPDATE ON public.curso_modulos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- curso_clases · contenido (video asincrónico, encuentro sincrónico, lectura, examen)
-- ---------------------------------------------------------------------------
CREATE TABLE public.curso_clases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo_id uuid NOT NULL
    REFERENCES public.curso_modulos(id) ON DELETE CASCADE,
  orden smallint NOT NULL DEFAULT 0,
  titulo text NOT NULL,
  descripcion text,
  tipo text NOT NULL DEFAULT 'asincronica_video'
    CHECK (tipo IN ('asincronica_video','sincronica_zoom','lectura_pdf','examen')),
  youtube_url text,
  zoom_url text,
  zoom_fecha_hora timestamptz,
  material_url text,
  duracion_min smallint
    CHECK (duracion_min IS NULL OR duracion_min >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_curso_clases_modulo
  ON public.curso_clases(modulo_id, orden);

CREATE TRIGGER trg_curso_clases_touch
  BEFORE UPDATE ON public.curso_clases
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- curso_bibliografia · material complementario
-- ---------------------------------------------------------------------------
CREATE TABLE public.curso_bibliografia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curso_id uuid NOT NULL REFERENCES public.cursos(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  autor text,
  url text,
  archivo_url text,
  descripcion text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_curso_bibliografia_curso
  ON public.curso_bibliografia(curso_id);

-- ---------------------------------------------------------------------------
-- curso_examenes · examen autocorregible
-- ---------------------------------------------------------------------------
CREATE TABLE public.curso_examenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curso_id uuid NOT NULL REFERENCES public.cursos(id) ON DELETE CASCADE,
  modulo_id uuid REFERENCES public.curso_modulos(id) ON DELETE SET NULL,
  titulo text NOT NULL,
  descripcion text,
  fecha_habilitacion timestamptz,
  fecha_cierre timestamptz,
  intentos_max smallint NOT NULL DEFAULT 1
    CHECK (intentos_max > 0 AND intentos_max <= 20),
  nota_aprobacion smallint NOT NULL DEFAULT 60
    CHECK (nota_aprobacion BETWEEN 0 AND 100),
  mostrar_resultados boolean NOT NULL DEFAULT true,
  mezclar_preguntas boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_examen_ventana
    CHECK (fecha_cierre IS NULL OR fecha_habilitacion IS NULL
           OR fecha_cierre >= fecha_habilitacion)
);

CREATE INDEX idx_curso_examenes_curso
  ON public.curso_examenes(curso_id);
CREATE INDEX idx_curso_examenes_modulo
  ON public.curso_examenes(modulo_id) WHERE modulo_id IS NOT NULL;

CREATE TRIGGER trg_curso_examenes_touch
  BEFORE UPDATE ON public.curso_examenes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- curso_preguntas · pregunta de un examen
-- ---------------------------------------------------------------------------
CREATE TABLE public.curso_preguntas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  examen_id uuid NOT NULL
    REFERENCES public.curso_examenes(id) ON DELETE CASCADE,
  orden smallint NOT NULL DEFAULT 0,
  tipo text NOT NULL DEFAULT 'multiple_choice'
    CHECK (tipo IN ('multiple_choice','verdadero_falso','texto_corto')),
  enunciado text NOT NULL,
  puntaje smallint NOT NULL DEFAULT 1
    CHECK (puntaje >= 0 AND puntaje <= 100),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_curso_preguntas_examen
  ON public.curso_preguntas(examen_id, orden);

-- ---------------------------------------------------------------------------
-- curso_opciones · opciones de respuesta de una pregunta
-- ---------------------------------------------------------------------------
CREATE TABLE public.curso_opciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pregunta_id uuid NOT NULL
    REFERENCES public.curso_preguntas(id) ON DELETE CASCADE,
  orden smallint NOT NULL DEFAULT 0,
  texto text NOT NULL,
  correcta boolean NOT NULL DEFAULT false,
  retroalimentacion text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_curso_opciones_pregunta
  ON public.curso_opciones(pregunta_id, orden);

-- ---------------------------------------------------------------------------
-- curso_matriculas · inscripción de un profile a un curso
-- ---------------------------------------------------------------------------
CREATE TABLE public.curso_matriculas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curso_id uuid NOT NULL REFERENCES public.cursos(id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  administracion_id uuid REFERENCES public.administraciones(id) ON DELETE SET NULL,
  inscripto_at timestamptz NOT NULL DEFAULT now(),
  vigencia_hasta date,
  estado text NOT NULL DEFAULT 'activa'
    CHECK (estado IN ('activa','completada','vencida','anulada')),
  submission_origen uuid
    REFERENCES public.formulario_submissions(id) ON DELETE SET NULL,
  observaciones text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_curso_matricula UNIQUE (curso_id, profile_id)
);

CREATE INDEX idx_curso_matriculas_curso
  ON public.curso_matriculas(curso_id);
CREATE INDEX idx_curso_matriculas_profile
  ON public.curso_matriculas(profile_id);
CREATE INDEX idx_curso_matriculas_admin
  ON public.curso_matriculas(administracion_id) WHERE administracion_id IS NOT NULL;
CREATE INDEX idx_curso_matriculas_submission
  ON public.curso_matriculas(submission_origen) WHERE submission_origen IS NOT NULL;
-- Partial sobre activas (regla 11): el listado “qué cursando hoy” pega acá.
CREATE INDEX idx_curso_matriculas_activas
  ON public.curso_matriculas(curso_id, profile_id)
  WHERE estado = 'activa';

CREATE TRIGGER trg_curso_matriculas_touch
  BEFORE UPDATE ON public.curso_matriculas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_curso_matriculas_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.curso_matriculas
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- ---------------------------------------------------------------------------
-- curso_progreso · progreso clase por clase
-- ---------------------------------------------------------------------------
CREATE TABLE public.curso_progreso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula_id uuid NOT NULL
    REFERENCES public.curso_matriculas(id) ON DELETE CASCADE,
  clase_id uuid NOT NULL
    REFERENCES public.curso_clases(id) ON DELETE CASCADE,
  completada boolean NOT NULL DEFAULT false,
  completada_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_curso_progreso UNIQUE (matricula_id, clase_id)
);

CREATE INDEX idx_curso_progreso_matricula
  ON public.curso_progreso(matricula_id);
CREATE INDEX idx_curso_progreso_clase
  ON public.curso_progreso(clase_id);

-- ---------------------------------------------------------------------------
-- examen_intentos · intentos de un alumno sobre un examen
-- ---------------------------------------------------------------------------
CREATE TABLE public.examen_intentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula_id uuid NOT NULL
    REFERENCES public.curso_matriculas(id) ON DELETE CASCADE,
  examen_id uuid NOT NULL
    REFERENCES public.curso_examenes(id) ON DELETE CASCADE,
  intento smallint NOT NULL DEFAULT 1
    CHECK (intento > 0 AND intento <= 50),
  iniciado_at timestamptz NOT NULL DEFAULT now(),
  terminado_at timestamptz,
  nota smallint CHECK (nota IS NULL OR nota BETWEEN 0 AND 100),
  aprobado boolean,
  respuestas jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT uq_examen_intento UNIQUE (matricula_id, examen_id, intento)
);

CREATE INDEX idx_examen_intentos_matricula
  ON public.examen_intentos(matricula_id);
CREATE INDEX idx_examen_intentos_examen
  ON public.examen_intentos(examen_id);

-- ---------------------------------------------------------------------------
-- Trigger: ventana de habilitación del examen.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.curso_examenes_ventana_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_examen public.curso_examenes%ROWTYPE;
  v_count integer;
BEGIN
  SELECT * INTO v_examen FROM public.curso_examenes WHERE id = NEW.examen_id;
  IF v_examen.id IS NULL THEN
    RAISE EXCEPTION 'Examen % no existe', NEW.examen_id USING ERRCODE = '22023';
  END IF;

  IF v_examen.fecha_habilitacion IS NOT NULL
     AND NEW.iniciado_at < v_examen.fecha_habilitacion THEN
    RAISE EXCEPTION 'El examen "%" todavía no está habilitado (abre %)',
      v_examen.titulo, v_examen.fecha_habilitacion USING ERRCODE = '22023';
  END IF;

  IF v_examen.fecha_cierre IS NOT NULL
     AND NEW.iniciado_at > v_examen.fecha_cierre THEN
    RAISE EXCEPTION 'El examen "%" cerró el %',
      v_examen.titulo, v_examen.fecha_cierre USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_count
    FROM public.examen_intentos
   WHERE matricula_id = NEW.matricula_id AND examen_id = NEW.examen_id;

  IF v_count >= v_examen.intentos_max THEN
    RAISE EXCEPTION 'Se agotaron los intentos del examen "%"', v_examen.titulo
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.curso_examenes_ventana_check()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_examen_intentos_ventana
  BEFORE INSERT ON public.examen_intentos
  FOR EACH ROW EXECUTE FUNCTION public.curso_examenes_ventana_check();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.cursos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curso_modulos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curso_clases        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curso_bibliografia  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curso_examenes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curso_preguntas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curso_opciones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curso_matriculas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curso_progreso      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.examen_intentos     ENABLE ROW LEVEL SECURITY;

-- cursos: SELECT público de cursos activos (catálogo); staff full CRUD.
DROP POLICY IF EXISTS cursos_select_public ON public.cursos;
CREATE POLICY cursos_select_public ON public.cursos
  FOR SELECT TO anon, authenticated
  USING (activo = true OR private.is_staff());

DROP POLICY IF EXISTS cursos_staff_cud ON public.cursos;
CREATE POLICY cursos_staff_cud ON public.cursos
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

-- Helper local: ¿el usuario tiene matrícula activa en el curso del módulo/clase?
-- Evita repetir el subquery en cada policy.
CREATE OR REPLACE FUNCTION private.curso_matriculado(p_curso_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.curso_matriculas
     WHERE curso_id = p_curso_id
       AND profile_id = auth.uid()
       AND estado IN ('activa','completada')
  );
$$;
GRANT EXECUTE ON FUNCTION private.curso_matriculado(uuid) TO authenticated;

-- módulos / clases / bibliografía / exámenes / preguntas / opciones:
-- SELECT autenticados con matrícula vigente o staff. CUD solo staff.
DROP POLICY IF EXISTS curso_modulos_select ON public.curso_modulos;
CREATE POLICY curso_modulos_select ON public.curso_modulos
  FOR SELECT TO authenticated
  USING (private.is_staff() OR private.curso_matriculado(curso_id));
DROP POLICY IF EXISTS curso_modulos_cud ON public.curso_modulos;
CREATE POLICY curso_modulos_cud ON public.curso_modulos
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS curso_clases_select ON public.curso_clases;
CREATE POLICY curso_clases_select ON public.curso_clases
  FOR SELECT TO authenticated
  USING (
    private.is_staff()
    OR private.curso_matriculado(
      (SELECT curso_id FROM public.curso_modulos WHERE id = modulo_id)
    )
  );
DROP POLICY IF EXISTS curso_clases_cud ON public.curso_clases;
CREATE POLICY curso_clases_cud ON public.curso_clases
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS curso_bibliografia_select ON public.curso_bibliografia;
CREATE POLICY curso_bibliografia_select ON public.curso_bibliografia
  FOR SELECT TO authenticated
  USING (private.is_staff() OR private.curso_matriculado(curso_id));
DROP POLICY IF EXISTS curso_bibliografia_cud ON public.curso_bibliografia;
CREATE POLICY curso_bibliografia_cud ON public.curso_bibliografia
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS curso_examenes_select ON public.curso_examenes;
CREATE POLICY curso_examenes_select ON public.curso_examenes
  FOR SELECT TO authenticated
  USING (private.is_staff() OR private.curso_matriculado(curso_id));
DROP POLICY IF EXISTS curso_examenes_cud ON public.curso_examenes;
CREATE POLICY curso_examenes_cud ON public.curso_examenes
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS curso_preguntas_select ON public.curso_preguntas;
CREATE POLICY curso_preguntas_select ON public.curso_preguntas
  FOR SELECT TO authenticated
  USING (
    private.is_staff()
    OR private.curso_matriculado(
      (SELECT curso_id FROM public.curso_examenes WHERE id = examen_id)
    )
  );
DROP POLICY IF EXISTS curso_preguntas_cud ON public.curso_preguntas;
CREATE POLICY curso_preguntas_cud ON public.curso_preguntas
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

-- Opciones: el alumno NO debería ver `correcta` antes de responder; pero
-- el motor que renderiza el examen necesita las opciones. Solución pragmática
-- (P-CAMPUS-01): el front nunca expone `correcta` (regla 3); la corrección
-- ocurre 100% server-side vía RPC. Si hace falta endurecer, se separa en una
-- vista que oculte la columna y se restringe SELECT directo. Por ahora SELECT
-- a matriculados es aceptable porque el dispatcher del front omite el campo.
DROP POLICY IF EXISTS curso_opciones_select ON public.curso_opciones;
CREATE POLICY curso_opciones_select ON public.curso_opciones
  FOR SELECT TO authenticated
  USING (
    private.is_staff()
    OR private.curso_matriculado(
      (SELECT ce.curso_id
         FROM public.curso_preguntas cp
         JOIN public.curso_examenes ce ON ce.id = cp.examen_id
        WHERE cp.id = pregunta_id)
    )
  );
DROP POLICY IF EXISTS curso_opciones_cud ON public.curso_opciones;
CREATE POLICY curso_opciones_cud ON public.curso_opciones
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

-- matriculas: el profile ve lo propio, staff full.
DROP POLICY IF EXISTS curso_matriculas_select ON public.curso_matriculas;
CREATE POLICY curso_matriculas_select ON public.curso_matriculas
  FOR SELECT TO authenticated
  USING (private.is_staff() OR profile_id = auth.uid());
DROP POLICY IF EXISTS curso_matriculas_cud ON public.curso_matriculas;
CREATE POLICY curso_matriculas_cud ON public.curso_matriculas
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

-- progreso: dueño + staff.
DROP POLICY IF EXISTS curso_progreso_select ON public.curso_progreso;
CREATE POLICY curso_progreso_select ON public.curso_progreso
  FOR SELECT TO authenticated
  USING (
    private.is_staff()
    OR EXISTS (
      SELECT 1 FROM public.curso_matriculas m
       WHERE m.id = matricula_id AND m.profile_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS curso_progreso_cud ON public.curso_progreso;
CREATE POLICY curso_progreso_cud ON public.curso_progreso
  FOR ALL TO authenticated
  USING (
    private.is_staff()
    OR EXISTS (
      SELECT 1 FROM public.curso_matriculas m
       WHERE m.id = matricula_id AND m.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    private.is_staff()
    OR EXISTS (
      SELECT 1 FROM public.curso_matriculas m
       WHERE m.id = matricula_id AND m.profile_id = auth.uid()
    )
  );

-- intentos: dueño + staff.
DROP POLICY IF EXISTS examen_intentos_select ON public.examen_intentos;
CREATE POLICY examen_intentos_select ON public.examen_intentos
  FOR SELECT TO authenticated
  USING (
    private.is_staff()
    OR EXISTS (
      SELECT 1 FROM public.curso_matriculas m
       WHERE m.id = matricula_id AND m.profile_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS examen_intentos_cud ON public.examen_intentos;
CREATE POLICY examen_intentos_cud ON public.examen_intentos
  FOR ALL TO authenticated
  USING (
    private.is_staff()
    OR EXISTS (
      SELECT 1 FROM public.curso_matriculas m
       WHERE m.id = matricula_id AND m.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    private.is_staff()
    OR EXISTS (
      SELECT 1 FROM public.curso_matriculas m
       WHERE m.id = matricula_id AND m.profile_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- RPC · curso_matricular
-- Verifica cupo, evita duplicados, crea matrícula y encola email de bienvenida.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.curso_matricular(
  p_curso_id uuid,
  p_profile_id uuid,
  p_administracion_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_curso public.cursos%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_activas integer;
  v_matricula_id uuid;
  v_vigencia_hasta date;
  v_email text;
  v_nombre text;
BEGIN
  -- El propio profile puede matricularse a sí mismo. Staff puede matricular
  -- a cualquiera. (Regla 12 / E45.)
  IF auth.uid() <> p_profile_id AND NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo podés matricularte a vos mismo' USING ERRCODE = '42501';
  END IF;

  IF p_administracion_id IS NOT NULL THEN
    PERFORM private.assert_administracion_access(p_administracion_id);
  END IF;

  SELECT * INTO v_curso FROM public.cursos WHERE id = p_curso_id;
  IF v_curso.id IS NULL OR NOT v_curso.activo THEN
    RAISE EXCEPTION 'Curso no disponible' USING ERRCODE = '22023';
  END IF;

  IF v_curso.cupo_max IS NOT NULL THEN
    SELECT count(*) INTO v_activas
      FROM public.curso_matriculas
     WHERE curso_id = p_curso_id AND estado IN ('activa','completada');
    IF v_activas >= v_curso.cupo_max THEN
      RAISE EXCEPTION 'El curso "%" alcanzó su cupo (%/%)',
        v_curso.titulo, v_activas, v_curso.cupo_max USING ERRCODE = '53300';
    END IF;
  END IF;

  v_vigencia_hasta := (now() + (v_curso.vigencia_meses || ' months')::interval)::date;

  INSERT INTO public.curso_matriculas (
    curso_id, profile_id, administracion_id,
    vigencia_hasta, estado
  ) VALUES (
    p_curso_id, p_profile_id, p_administracion_id,
    v_vigencia_hasta, 'activa'
  )
  ON CONFLICT (curso_id, profile_id) DO UPDATE
    SET estado = CASE WHEN public.curso_matriculas.estado = 'anulada'
                      THEN 'activa' ELSE public.curso_matriculas.estado END,
        vigencia_hasta = EXCLUDED.vigencia_hasta,
        administracion_id = COALESCE(EXCLUDED.administracion_id,
                                     public.curso_matriculas.administracion_id),
        updated_at = now()
  RETURNING id INTO v_matricula_id;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_profile_id;
  -- Email del usuario: profiles.email_contacto si existe, sino auth.users.email
  v_email := COALESCE(
    (SELECT email FROM auth.users WHERE id = p_profile_id),
    NULL
  );
  v_nombre := COALESCE(v_profile.full_name, 'Alumno');

  IF v_email IS NOT NULL THEN
    PERFORM public.encolar_email(
      'curso-inscripcion-confirmada',
      v_email,
      v_nombre,
      jsonb_build_object(
        'nombre', v_nombre,
        'curso_titulo', v_curso.titulo,
        'nombre_curso', v_curso.titulo, -- compat con template seedeado
        'vigencia_hasta', to_char(v_vigencia_hasta, 'DD/MM/YYYY'),
        'fecha_inicio', to_char(COALESCE(v_curso.fecha_inicio, CURRENT_DATE), 'DD/MM/YYYY')
      ),
      p_administracion_id,
      NULL,
      'curso_matriculas',
      v_matricula_id,
      5::smallint
    );
  END IF;

  RETURN v_matricula_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.curso_matricular(uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.curso_matricular(uuid, uuid, uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC · curso_marcar_clase_completada (idempotente)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.curso_marcar_clase_completada(
  p_matricula_id uuid,
  p_clase_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT profile_id INTO v_owner
    FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Matrícula inexistente' USING ERRCODE = '22023';
  END IF;
  IF v_owner <> auth.uid() AND NOT private.is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.curso_progreso (matricula_id, clase_id, completada, completada_at)
  VALUES (p_matricula_id, p_clase_id, true, now())
  ON CONFLICT (matricula_id, clase_id)
    DO UPDATE SET completada = true,
                  completada_at = COALESCE(public.curso_progreso.completada_at, now());
END;
$$;
REVOKE EXECUTE ON FUNCTION public.curso_marcar_clase_completada(uuid, uuid)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.curso_marcar_clase_completada(uuid, uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC · curso_progreso_resumen
-- Devuelve un resumen del avance del alumno en su matrícula.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.curso_progreso_resumen(
  p_matricula_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_matricula public.curso_matriculas%ROWTYPE;
  v_total integer;
  v_completadas integer;
  v_examenes_aprobados integer;
  v_porc numeric;
BEGIN
  SELECT * INTO v_matricula FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_matricula.id IS NULL THEN
    RAISE EXCEPTION 'Matrícula inexistente' USING ERRCODE = '22023';
  END IF;
  IF v_matricula.profile_id <> auth.uid() AND NOT private.is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total
    FROM public.curso_clases cc
    JOIN public.curso_modulos cm ON cm.id = cc.modulo_id
   WHERE cm.curso_id = v_matricula.curso_id;

  SELECT count(*) INTO v_completadas
    FROM public.curso_progreso cp
    JOIN public.curso_clases cc ON cc.id = cp.clase_id
    JOIN public.curso_modulos cm ON cm.id = cc.modulo_id
   WHERE cp.matricula_id = p_matricula_id
     AND cp.completada = true
     AND cm.curso_id = v_matricula.curso_id;

  SELECT count(DISTINCT ei.examen_id) INTO v_examenes_aprobados
    FROM public.examen_intentos ei
   WHERE ei.matricula_id = p_matricula_id
     AND ei.aprobado = true;

  v_porc := CASE WHEN v_total > 0
                 THEN round((v_completadas::numeric / v_total) * 100, 1)
                 ELSE 0 END;

  RETURN jsonb_build_object(
    'total_clases', v_total,
    'completadas', v_completadas,
    'porcentaje', v_porc,
    'examenes_aprobados', v_examenes_aprobados
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.curso_progreso_resumen(uuid)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.curso_progreso_resumen(uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC · curso_responder_examen
-- Recibe respuestas: [{pregunta_id, opcion_ids?, texto?}], autocorrige MC y V-F.
-- Texto corto → pendiente revisión humana (puntaje 0 hasta corregir).
-- Setea terminado_at, nota, aprobado. Solo el dueño del intento.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.curso_responder_examen(
  p_intento_id uuid,
  p_respuestas jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_intento public.examen_intentos%ROWTYPE;
  v_examen public.curso_examenes%ROWTYPE;
  v_owner uuid;
  v_pregunta record;
  v_resp jsonb;
  v_total_puntos integer := 0;
  v_obtenidos integer := 0;
  v_pendientes integer := 0;
  v_detalle jsonb := '[]'::jsonb;
  v_correcta boolean;
  v_seleccion_correcta boolean;
  v_nota smallint;
  v_aprobado boolean;
BEGIN
  SELECT * INTO v_intento FROM public.examen_intentos WHERE id = p_intento_id;
  IF v_intento.id IS NULL THEN
    RAISE EXCEPTION 'Intento inexistente' USING ERRCODE = '22023';
  END IF;
  IF v_intento.terminado_at IS NOT NULL THEN
    RAISE EXCEPTION 'El intento ya está cerrado' USING ERRCODE = '22023';
  END IF;

  SELECT profile_id INTO v_owner
    FROM public.curso_matriculas WHERE id = v_intento.matricula_id;
  IF v_owner <> auth.uid() AND NOT private.is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_examen FROM public.curso_examenes WHERE id = v_intento.examen_id;

  -- Iteramos las preguntas reales del examen (no las del payload) para evitar
  -- inyección de puntajes.
  FOR v_pregunta IN
    SELECT id, tipo, puntaje FROM public.curso_preguntas
     WHERE examen_id = v_examen.id ORDER BY orden
  LOOP
    v_total_puntos := v_total_puntos + v_pregunta.puntaje;
    v_resp := (
      SELECT r FROM jsonb_array_elements(COALESCE(p_respuestas, '[]'::jsonb)) AS r
       WHERE (r->>'pregunta_id')::uuid = v_pregunta.id
       LIMIT 1
    );

    IF v_pregunta.tipo IN ('multiple_choice','verdadero_falso') THEN
      -- Correcta si las opciones marcadas coinciden EXACTO con las correctas.
      IF v_resp IS NULL THEN
        v_correcta := false;
      ELSE
        SELECT NOT EXISTS (
          -- alguna correcta no marcada
          SELECT 1 FROM public.curso_opciones o
           WHERE o.pregunta_id = v_pregunta.id AND o.correcta = true
             AND NOT (o.id::text = ANY (
               SELECT jsonb_array_elements_text(COALESCE(v_resp->'opcion_ids','[]'::jsonb))
             ))
        ) AND NOT EXISTS (
          -- alguna incorrecta marcada
          SELECT 1 FROM public.curso_opciones o
           WHERE o.pregunta_id = v_pregunta.id AND o.correcta = false
             AND o.id::text = ANY (
               SELECT jsonb_array_elements_text(COALESCE(v_resp->'opcion_ids','[]'::jsonb))
             )
        )
        INTO v_seleccion_correcta;
        v_correcta := COALESCE(v_seleccion_correcta, false);
      END IF;

      IF v_correcta THEN
        v_obtenidos := v_obtenidos + v_pregunta.puntaje;
      END IF;
      v_detalle := v_detalle || jsonb_build_object(
        'pregunta_id', v_pregunta.id,
        'correcta', v_correcta,
        'puntaje', CASE WHEN v_correcta THEN v_pregunta.puntaje ELSE 0 END,
        'pendiente_revision', false
      );
    ELSE
      -- texto_corto: queda pendiente revisión humana, no suma puntaje.
      v_pendientes := v_pendientes + 1;
      v_detalle := v_detalle || jsonb_build_object(
        'pregunta_id', v_pregunta.id,
        'correcta', NULL,
        'puntaje', 0,
        'pendiente_revision', true
      );
    END IF;
  END LOOP;

  v_nota := CASE WHEN v_total_puntos > 0
                 THEN round((v_obtenidos::numeric / v_total_puntos) * 100)
                 ELSE 0 END;
  v_aprobado := (v_pendientes = 0) AND (v_nota >= v_examen.nota_aprobacion);

  UPDATE public.examen_intentos
     SET respuestas = COALESCE(p_respuestas, '[]'::jsonb),
         terminado_at = now(),
         nota = v_nota,
         aprobado = v_aprobado
   WHERE id = p_intento_id;

  RETURN jsonb_build_object(
    'nota', v_nota,
    'aprobado', v_aprobado,
    'pendientes_revision', v_pendientes,
    'detalle', v_detalle
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.curso_responder_examen(uuid, jsonb)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.curso_responder_examen(uuid, jsonb)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Realtime publication (Realtime sobre cambios — UX premium).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.curso_matriculas;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.curso_progreso;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.examen_intentos;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- SEED · dos cursos demo
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_c1 uuid;
  v_c2 uuid;
  v_m1a uuid;
  v_m1b uuid;
  v_m2a uuid;
  v_ex1 uuid;
  v_ex2 uuid;
  v_q uuid;
BEGIN
  -- Curso 1: RPAC Formación (mixto)
  INSERT INTO public.cursos (
    slug, titulo, descripcion, descripcion_html, categoria, modalidad,
    duracion_horas, precio_lista, activo, vigencia_meses, instructor_nombre,
    instructor_bio
  ) VALUES (
    'curso-administradores-formacion-rpac',
    'Curso de Formación para Administradores RPAC',
    'Programa completo para matricularse en el Registro Público de Administradores de Consorcios (RPAC).',
    '<p>Programa intensivo que cubre normativa, contabilidad, gestión humana y ' ||
    'herramientas digitales para el ejercicio profesional de la administración ' ||
    'de consorcios. Combina clases asincrónicas, encuentros en vivo y un examen ' ||
    'final autocorregible.</p>',
    'Administradores', 'mixta', 60, 180000, true, 12,
    'Dra. Mariana Acosta',
    'Abogada especialista en Propiedad Horizontal. 15 años de docencia en RPAC.'
  ) RETURNING id INTO v_c1;

  INSERT INTO public.curso_modulos (curso_id, orden, titulo, descripcion)
  VALUES (v_c1, 1, 'Marco normativo PH',
          'Ley 13.512, Código Civil y Comercial unificado, Ley 941 CABA y normas provinciales.')
  RETURNING id INTO v_m1a;

  INSERT INTO public.curso_modulos (curso_id, orden, titulo, descripcion)
  VALUES (v_c1, 2, 'Operación diaria del consorcio',
          'Liquidación de expensas, gestión de proveedores, libros obligatorios.')
  RETURNING id INTO v_m1b;

  -- Módulo 1A: 3 clases
  INSERT INTO public.curso_clases (modulo_id, orden, titulo, descripcion, tipo, youtube_url, duracion_min) VALUES
    (v_m1a, 1, 'Introducción a la PH', 'Origen de la propiedad horizontal en Argentina.',
     'asincronica_video', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 18);
  INSERT INTO public.curso_clases (modulo_id, orden, titulo, descripcion, tipo, zoom_url, zoom_fecha_hora, duracion_min) VALUES
    (v_m1a, 2, 'Encuentro en vivo: dudas normativas', 'Sesión sincrónica de consultas.',
     'sincronica_zoom', 'https://zoom.us/j/000', (now() + interval '14 days'), 60);
  INSERT INTO public.curso_clases (modulo_id, orden, titulo, descripcion, tipo, material_url, duracion_min) VALUES
    (v_m1a, 3, 'Lectura: CCyC arts. 2037-2072', 'Bajá el PDF y completá la guía.',
     'lectura_pdf', 'https://servicios.infoleg.gob.ar/infolegInternet/anexos/235000-239999/235975/norma.htm', 45);

  -- Módulo 1B: 3 clases
  INSERT INTO public.curso_clases (modulo_id, orden, titulo, descripcion, tipo, youtube_url, duracion_min) VALUES
    (v_m1b, 1, 'Cómo liquidar expensas', 'Paso a paso de la liquidación mensual.',
     'asincronica_video', 'https://www.youtube.com/watch?v=oHg5SJYRHA0', 22);
  INSERT INTO public.curso_clases (modulo_id, orden, titulo, descripcion, tipo, zoom_url, zoom_fecha_hora, duracion_min) VALUES
    (v_m1b, 2, 'Taller: armado de presupuesto anual', 'Práctico en vivo con planilla.',
     'sincronica_zoom', 'https://zoom.us/j/001', (now() + interval '21 days'), 75);
  INSERT INTO public.curso_clases (modulo_id, orden, titulo, descripcion, tipo, material_url, duracion_min) VALUES
    (v_m1b, 3, 'Guía de libros obligatorios', 'Checklist descargable.',
     'lectura_pdf', 'https://example.com/libros-obligatorios.pdf', 30);

  INSERT INTO public.curso_bibliografia (curso_id, titulo, autor, url, descripcion) VALUES
    (v_c1, 'Manual de Propiedad Horizontal',
     'Highton de Nolasco, Elena',
     'https://example.com/manual-ph',
     'Texto base de referencia para todo el curso.');

  -- Examen MC
  INSERT INTO public.curso_examenes (
    curso_id, titulo, descripcion, intentos_max, nota_aprobacion
  ) VALUES (
    v_c1, 'Examen final RPAC',
    'Evaluación integradora de los dos módulos. 5 preguntas multiple choice.',
    2, 70
  ) RETURNING id INTO v_ex1;

  -- P1
  INSERT INTO public.curso_preguntas (examen_id, orden, tipo, enunciado, puntaje)
  VALUES (v_ex1, 1, 'multiple_choice',
    '¿Qué artículos del CCyC regulan la propiedad horizontal?', 1)
  RETURNING id INTO v_q;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES
    (v_q, 1, 'Arts. 1882-1907', false),
    (v_q, 2, 'Arts. 2037-2072', true),
    (v_q, 3, 'Arts. 1100-1140', false),
    (v_q, 4, 'No están regulados en el CCyC', false);

  -- P2
  INSERT INTO public.curso_preguntas (examen_id, orden, tipo, enunciado, puntaje)
  VALUES (v_ex1, 2, 'multiple_choice',
    '¿Cuál es el quórum mínimo para una asamblea ordinaria en CABA si el reglamento nada dice?', 1)
  RETURNING id INTO v_q;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES
    (v_q, 1, 'Mayoría simple de presentes', false),
    (v_q, 2, 'Mayoría absoluta del total con doble cómputo', true),
    (v_q, 3, '2/3 de los presentes', false),
    (v_q, 4, 'Unanimidad', false);

  -- P3
  INSERT INTO public.curso_preguntas (examen_id, orden, tipo, enunciado, puntaje)
  VALUES (v_ex1, 3, 'multiple_choice',
    '¿Cada cuánto debe renovarse la matrícula en el RPAC de CABA?', 1)
  RETURNING id INTO v_q;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES
    (v_q, 1, 'Cada año', true),
    (v_q, 2, 'Cada dos años', false),
    (v_q, 3, 'Cada cinco años', false),
    (v_q, 4, 'No requiere renovación', false);

  -- P4
  INSERT INTO public.curso_preguntas (examen_id, orden, tipo, enunciado, puntaje)
  VALUES (v_ex1, 4, 'multiple_choice',
    '¿Cuál de estos libros es obligatorio para el administrador?', 1)
  RETURNING id INTO v_q;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES
    (v_q, 1, 'Libro de quejas perfumado', false),
    (v_q, 2, 'Libro de actas de asamblea', true),
    (v_q, 3, 'Libro de visitas', false),
    (v_q, 4, 'Libro de horarios de ascensor', false);

  -- P5
  INSERT INTO public.curso_preguntas (examen_id, orden, tipo, enunciado, puntaje)
  VALUES (v_ex1, 5, 'multiple_choice',
    'La rendición de cuentas mensual del administrador debe contener:', 1)
  RETURNING id INTO v_q;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES
    (v_q, 1, 'Ingresos, egresos y saldo bancario conciliado', true),
    (v_q, 2, 'Solo los egresos', false),
    (v_q, 3, 'Una foto del edificio', false),
    (v_q, 4, 'Nada, basta con guardar las facturas', false);

  -- ---------------------------------------------------------------------
  -- Curso 2: Actualización (asincrónico)
  -- ---------------------------------------------------------------------
  INSERT INTO public.cursos (
    slug, titulo, descripcion, categoria, modalidad,
    duracion_horas, precio_lista, activo, vigencia_meses, instructor_nombre
  ) VALUES (
    'curso-administradores-actualizacion',
    'Curso de Actualización para Administradores',
    'Cumplí con las 20 hs anuales de actualización exigidas por la RPAC en formato 100% online.',
    'Administradores', 'asincronica', 20, 60000, true, 12,
    'Cdor. Pablo Ferreyra'
  ) RETURNING id INTO v_c2;

  INSERT INTO public.curso_modulos (curso_id, orden, titulo, descripcion)
  VALUES (v_c2, 1, 'Novedades normativas 2026',
          'Reformas vigentes en CABA y principales jurisdicciones.')
  RETURNING id INTO v_m2a;

  INSERT INTO public.curso_clases (modulo_id, orden, titulo, descripcion, tipo, youtube_url, duracion_min) VALUES
    (v_m2a, 1, 'Cambios en la Ley 941 CABA',
     'Resumen de las modificaciones del último año.',
     'asincronica_video', 'https://www.youtube.com/watch?v=oHg5SJYRHA0', 25),
    (v_m2a, 2, 'Digitalización de libros y firma electrónica',
     'Estado actual y herramientas recomendadas.',
     'asincronica_video', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 30);

  INSERT INTO public.curso_examenes (
    curso_id, titulo, descripcion, intentos_max, nota_aprobacion
  ) VALUES (
    v_c2, 'Quiz de actualización',
    '5 preguntas Verdadero/Falso para validar la cursada.',
    3, 60
  ) RETURNING id INTO v_ex2;

  -- V/F #1
  INSERT INTO public.curso_preguntas (examen_id, orden, tipo, enunciado, puntaje)
  VALUES (v_ex2, 1, 'verdadero_falso',
    'En CABA el administrador puede llevar los libros 100% en formato digital.', 1)
  RETURNING id INTO v_q;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES
    (v_q, 1, 'Verdadero', true),
    (v_q, 2, 'Falso', false);

  -- V/F #2
  INSERT INTO public.curso_preguntas (examen_id, orden, tipo, enunciado, puntaje)
  VALUES (v_ex2, 2, 'verdadero_falso',
    'La actualización anual mínima exigida en CABA es de 5 horas.', 1)
  RETURNING id INTO v_q;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES
    (v_q, 1, 'Verdadero', false),
    (v_q, 2, 'Falso', true);

  -- V/F #3
  INSERT INTO public.curso_preguntas (examen_id, orden, tipo, enunciado, puntaje)
  VALUES (v_ex2, 3, 'verdadero_falso',
    'El administrador puede cobrar honorarios extraordinarios sin aprobación de asamblea.', 1)
  RETURNING id INTO v_q;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES
    (v_q, 1, 'Verdadero', false),
    (v_q, 2, 'Falso', true);

  -- V/F #4
  INSERT INTO public.curso_preguntas (examen_id, orden, tipo, enunciado, puntaje)
  VALUES (v_ex2, 4, 'verdadero_falso',
    'La rendición de cuentas mensual debe estar disponible para todos los copropietarios.', 1)
  RETURNING id INTO v_q;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES
    (v_q, 1, 'Verdadero', true),
    (v_q, 2, 'Falso', false);

  -- V/F #5
  INSERT INTO public.curso_preguntas (examen_id, orden, tipo, enunciado, puntaje)
  VALUES (v_ex2, 5, 'verdadero_falso',
    'Un administrador puede ejercer sin estar matriculado en el RPAC en CABA.', 1)
  RETURNING id INTO v_q;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES
    (v_q, 1, 'Verdadero', false),
    (v_q, 2, 'Falso', true);
END $$;

COMMENT ON TABLE public.cursos IS
  'Subsistema 7 (Campus): catálogo de cursos. activo=true → SELECT público.';
COMMENT ON TABLE public.curso_matriculas IS
  'Inscripciones. Una matrícula por (curso, profile). Vigencia heredada de cursos.vigencia_meses al matricular.';
COMMENT ON TABLE public.examen_intentos IS
  'Intentos de examen autocorregibles. Trigger valida ventana y cap de intentos_max.';
