-- ============================================================================
-- 0045_campus_fase1 · Campus Fase 1 (Punto 6 · DGG-10 / DGG-10bis)
--
-- Rebuild incremental sobre 0029_campus.sql. Esta migración:
--   1. CIERRA EL AUTOSERVICIO (DGG-10): el catálogo deja de ser SELECT público
--      para anon; `curso_matricular` deja de permitir auto-matrícula del alumno.
--   2. Condiciones del certificado configurables por curso
--      (`curso_condiciones_config`) — el "3+1" (examen / asistencia / pago / otra).
--   3. Checklist por matrícula (`matricula_condiciones`) con tilde manual de
--      staff. La condición 'examen' se auto-tilda al aprobar (trigger).
--   4. Encuentros sincrónicos (`curso_encuentros` + `curso_encuentro_asistencias`)
--      con asistencia tildada por alumno por encuentro.
--   5. RPC `curso_asignar_alumno` (asignación manual, materializa condiciones).
--   6. RPC `matricula_tildar_condicion` (staff tilda/destilda).
--   7. RPC `curso_registrar_pago` (marca condición pago + asiento de ingreso en
--      `movimientos`, regla 5 multi-tabla).
--
-- Reglas: 2 (RLS), 5 (RPC SD + search_path), 6 (versionada), 8 (naming verificado
-- con information_schema), 11 (índice en cada FK), 12 (assert_administracion_access).
-- Certificado PDF + QR + verificación pública → FASE 2 (NO acá).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · CERRAR AUTOSERVICIO
-- ---------------------------------------------------------------------------
-- Catálogo: ya no es SELECT para anon. Solo staff y alumnos autenticados ven
-- cursos (los alumnos igual filtran por sus matrículas en el portal). Esto
-- mantiene el portal del alumno funcionando (sigue siendo `authenticated`)
-- pero cierra el catálogo abierto / landing pública de inscripción.
DROP POLICY IF EXISTS cursos_select_public ON public.cursos;
CREATE POLICY cursos_select_auth ON public.cursos
  FOR SELECT TO authenticated
  USING (private.is_staff() OR activo = true);
COMMENT ON POLICY cursos_select_auth ON public.cursos IS
  'DGG-10: catálogo cerrado a anon. Solo usuarios autenticados ven cursos '
  'activos; la inscripción es por asignación manual de gerencia '
  '(curso_asignar_alumno), no autoservicio.';

-- ---------------------------------------------------------------------------
-- 2 · curso_condiciones_config — qué exige cada curso (el "3+1")
-- ---------------------------------------------------------------------------
CREATE TABLE public.curso_condiciones_config (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curso_id    uuid NOT NULL REFERENCES public.cursos(id) ON DELETE CASCADE,
  tipo        text NOT NULL
                CHECK (tipo IN ('examen','asistencia','pago','otra')),
  etiqueta    text NOT NULL,
  -- 'examen' = automática (se tilda sola al aprobar). El resto: tilde manual.
  automatica  boolean NOT NULL DEFAULT false,
  examen_id   uuid REFERENCES public.curso_examenes(id) ON DELETE SET NULL,
  obligatoria boolean NOT NULL DEFAULT true,
  orden       smallint NOT NULL DEFAULT 0,
  activa      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_curso_condiciones_curso
  ON public.curso_condiciones_config(curso_id, orden);
CREATE INDEX idx_curso_condiciones_examen
  ON public.curso_condiciones_config(examen_id) WHERE examen_id IS NOT NULL;

CREATE TRIGGER trg_curso_condiciones_touch
  BEFORE UPDATE ON public.curso_condiciones_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.curso_condiciones_config IS
  'DGG-10: condiciones que exige cada curso para emitir certificado. '
  'tipo=examen es automática (auto-tilde al aprobar); el resto tilde manual.';

-- ---------------------------------------------------------------------------
-- 3 · matricula_condiciones — checklist por matrícula (qué se tildó, quién, cuándo)
-- ---------------------------------------------------------------------------
CREATE TABLE public.matricula_condiciones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula_id  uuid NOT NULL
                  REFERENCES public.curso_matriculas(id) ON DELETE CASCADE,
  condicion_id  uuid NOT NULL
                  REFERENCES public.curso_condiciones_config(id) ON DELETE CASCADE,
  cumplida      boolean NOT NULL DEFAULT false,
  cumplida_at   timestamptz,
  cumplida_por  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  observaciones text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_matricula_condicion UNIQUE (matricula_id, condicion_id)
);

CREATE INDEX idx_matricula_condiciones_matricula
  ON public.matricula_condiciones(matricula_id);
CREATE INDEX idx_matricula_condiciones_condicion
  ON public.matricula_condiciones(condicion_id);
CREATE INDEX idx_matricula_condiciones_cumplida_por
  ON public.matricula_condiciones(cumplida_por) WHERE cumplida_por IS NOT NULL;

CREATE TRIGGER trg_matricula_condiciones_touch
  BEFORE UPDATE ON public.matricula_condiciones
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.matricula_condiciones IS
  'DGG-10: checklist de condiciones por matrícula. cumplida_por NULL = la tildó '
  'el sistema (examen aprobado). El resto las tilda staff.';

-- ---------------------------------------------------------------------------
-- 4 · curso_encuentros — encuentros sincrónicos (registro formal por encuentro)
-- ---------------------------------------------------------------------------
CREATE TABLE public.curso_encuentros (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curso_id    uuid NOT NULL REFERENCES public.cursos(id) ON DELETE CASCADE,
  titulo      text NOT NULL,
  descripcion text,
  fecha_hora  timestamptz,
  link_zoom   text,
  orden       smallint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_curso_encuentros_curso
  ON public.curso_encuentros(curso_id, fecha_hora);

CREATE TRIGGER trg_curso_encuentros_touch
  BEFORE UPDATE ON public.curso_encuentros
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.curso_encuentro_asistencias (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encuentro_id  uuid NOT NULL
                  REFERENCES public.curso_encuentros(id) ON DELETE CASCADE,
  matricula_id  uuid NOT NULL
                  REFERENCES public.curso_matriculas(id) ON DELETE CASCADE,
  presente      boolean NOT NULL DEFAULT true,
  marcada_por   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  marcada_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_encuentro_asistencia UNIQUE (encuentro_id, matricula_id)
);

CREATE INDEX idx_encuentro_asistencias_encuentro
  ON public.curso_encuentro_asistencias(encuentro_id);
CREATE INDEX idx_encuentro_asistencias_matricula
  ON public.curso_encuentro_asistencias(matricula_id);
CREATE INDEX idx_encuentro_asistencias_marcada_por
  ON public.curso_encuentro_asistencias(marcada_por) WHERE marcada_por IS NOT NULL;

COMMENT ON TABLE public.curso_encuentros IS
  'DGG-10bis: encuentros sincrónicos del curso (fecha, link Zoom, tema).';
COMMENT ON TABLE public.curso_encuentro_asistencias IS
  'DGG-10bis: asistencia tildada por alumno por encuentro.';

-- ---------------------------------------------------------------------------
-- RLS de las tablas nuevas (regla 2)
-- ---------------------------------------------------------------------------
ALTER TABLE public.curso_condiciones_config      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matricula_condiciones         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curso_encuentros              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curso_encuentro_asistencias   ENABLE ROW LEVEL SECURITY;

-- condiciones_config: matriculados-o-staff leen; CUD solo staff.
CREATE POLICY curso_condiciones_select ON public.curso_condiciones_config
  FOR SELECT TO authenticated
  USING (private.is_staff() OR private.curso_matriculado(curso_id));
CREATE POLICY curso_condiciones_cud ON public.curso_condiciones_config
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

-- matricula_condiciones: dueño-de-matrícula-o-staff lee; CUD solo staff.
CREATE POLICY matricula_condiciones_select ON public.matricula_condiciones
  FOR SELECT TO authenticated
  USING (
    private.is_staff()
    OR EXISTS (
      SELECT 1 FROM public.curso_matriculas m
       WHERE m.id = matricula_id AND m.profile_id = auth.uid()
    )
  );
CREATE POLICY matricula_condiciones_cud ON public.matricula_condiciones
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

-- encuentros: matriculados-o-staff leen; CUD solo staff.
CREATE POLICY curso_encuentros_select ON public.curso_encuentros
  FOR SELECT TO authenticated
  USING (private.is_staff() OR private.curso_matriculado(curso_id));
CREATE POLICY curso_encuentros_cud ON public.curso_encuentros
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

-- asistencias: dueño-de-matrícula-o-staff lee; CUD solo staff.
CREATE POLICY encuentro_asistencias_select ON public.curso_encuentro_asistencias
  FOR SELECT TO authenticated
  USING (
    private.is_staff()
    OR EXISTS (
      SELECT 1 FROM public.curso_matriculas m
       WHERE m.id = matricula_id AND m.profile_id = auth.uid()
    )
  );
CREATE POLICY encuentro_asistencias_cud ON public.curso_encuentro_asistencias
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

-- ---------------------------------------------------------------------------
-- 5 · RPC curso_asignar_alumno — asignación manual (reemplaza autoservicio)
-- Solo staff. Resuelve el profile del administrador cliente (si no se pasa
-- p_profile_id explícito), crea la matrícula sin duplicar e inicializa las
-- filas de matricula_condiciones según condiciones activas del curso.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.curso_asignar_alumno(
  p_curso_id uuid,
  p_administracion_id uuid,
  p_profile_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_curso public.cursos%ROWTYPE;
  v_profile_id uuid := p_profile_id;
  v_matricula_id uuid;
  v_vigencia_hasta date;
  v_email text;
  v_nombre text;
  v_cond record;
BEGIN
  -- Solo staff puede asignar (DGG-10: no autoservicio).
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede asignar alumnos' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_curso FROM public.cursos WHERE id = p_curso_id;
  IF v_curso.id IS NULL THEN
    RAISE EXCEPTION 'Curso inexistente' USING ERRCODE = '22023';
  END IF;

  -- Resolver el profile del administrador cliente si no vino explícito.
  IF v_profile_id IS NULL THEN
    SELECT p.id INTO v_profile_id
      FROM public.profiles p
     WHERE p.administracion_id = p_administracion_id
       AND p.role = 'administrador'
       AND p.activo = true
     ORDER BY p.created_at
     LIMIT 1;
    IF v_profile_id IS NULL THEN
      RAISE EXCEPTION 'La administración no tiene un usuario alumno asociado. '
        'Creá primero el acceso del administrador.' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_vigencia_hasta := (now() + (v_curso.vigencia_meses || ' months')::interval)::date;

  INSERT INTO public.curso_matriculas (
    curso_id, profile_id, administracion_id, vigencia_hasta, estado
  ) VALUES (
    p_curso_id, v_profile_id, p_administracion_id, v_vigencia_hasta, 'activa'
  )
  ON CONFLICT (curso_id, profile_id) DO UPDATE
    SET estado = CASE WHEN public.curso_matriculas.estado = 'anulada'
                      THEN 'activa' ELSE public.curso_matriculas.estado END,
        vigencia_hasta = EXCLUDED.vigencia_hasta,
        administracion_id = COALESCE(EXCLUDED.administracion_id,
                                     public.curso_matriculas.administracion_id),
        updated_at = now()
  RETURNING id INTO v_matricula_id;

  -- Materializar el checklist según condiciones activas del curso (idempotente).
  FOR v_cond IN
    SELECT id, tipo, automatica FROM public.curso_condiciones_config
     WHERE curso_id = p_curso_id AND activa = true
  LOOP
    INSERT INTO public.matricula_condiciones (matricula_id, condicion_id)
    VALUES (v_matricula_id, v_cond.id)
    ON CONFLICT (matricula_id, condicion_id) DO NOTHING;
  END LOOP;

  -- Re-evaluar examen por si el alumno ya tenía un intento aprobado (re-asignación).
  PERFORM public.matricula_sync_examen(v_matricula_id);

  -- Email de asignación (reusa el template de inscripción confirmada).
  SELECT email INTO v_email FROM auth.users WHERE id = v_profile_id;
  SELECT COALESCE(full_name, 'Alumno') INTO v_nombre
    FROM public.profiles WHERE id = v_profile_id;
  IF v_email IS NOT NULL THEN
    PERFORM public.encolar_email(
      'curso-inscripcion-confirmada', v_email, v_nombre,
      jsonb_build_object(
        'nombre', v_nombre,
        'curso_titulo', v_curso.titulo,
        'nombre_curso', v_curso.titulo,
        'vigencia_hasta', to_char(v_vigencia_hasta, 'DD/MM/YYYY'),
        'fecha_inicio', to_char(COALESCE(v_curso.fecha_inicio, CURRENT_DATE), 'DD/MM/YYYY')
      ),
      p_administracion_id, NULL, 'curso_matriculas', v_matricula_id, 5::smallint
    );
  END IF;

  RETURN v_matricula_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.curso_asignar_alumno(uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.curso_asignar_alumno(uuid, uuid, uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 6 · Auto-tilde de la condición 'examen' al aprobar
-- matricula_sync_examen(matricula): si existe alguna condición tipo='examen'
-- activa para el curso y la matrícula tiene un intento aprobado del examen
-- referenciado (o cualquier examen del curso si la condición no fija examen_id),
-- marca la fila matricula_condiciones como cumplida (sistema).
-- ---------------------------------------------------------------------------
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
END;
$$;
REVOKE EXECUTE ON FUNCTION public.matricula_sync_examen(uuid)
  FROM PUBLIC, anon, authenticated;

-- Trigger AFTER UPDATE en examen_intentos: cuando un intento queda aprobado,
-- sincroniza la condición de examen de esa matrícula.
-- Dispara en UPDATE (flujo normal: curso_responder_examen actualiza aprobado)
-- y también en INSERT con aprobado=true (cargas/re-grading directos).
CREATE OR REPLACE FUNCTION public.trg_examen_aprobado_sync_condicion()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.aprobado = true AND (TG_OP = 'INSERT' OR COALESCE(OLD.aprobado, false) = false) THEN
    PERFORM public.matricula_sync_examen(NEW.matricula_id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trg_examen_aprobado_sync_condicion()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_examen_intentos_sync_condicion ON public.examen_intentos;
CREATE TRIGGER trg_examen_intentos_sync_condicion
  AFTER INSERT OR UPDATE OF aprobado ON public.examen_intentos
  FOR EACH ROW EXECUTE FUNCTION public.trg_examen_aprobado_sync_condicion();

-- ---------------------------------------------------------------------------
-- 7 · RPC matricula_tildar_condicion — staff tilda/destilda una condición manual
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.matricula_tildar_condicion(
  p_matricula_condicion_id uuid,
  p_cumplida boolean,
  p_observaciones text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tipo text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede tildar condiciones' USING ERRCODE = '42501';
  END IF;

  SELECT cc.tipo INTO v_tipo
    FROM public.matricula_condiciones mc
    JOIN public.curso_condiciones_config cc ON cc.id = mc.condicion_id
   WHERE mc.id = p_matricula_condicion_id;
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'Condición inexistente' USING ERRCODE = '22023';
  END IF;
  IF v_tipo = 'examen' THEN
    RAISE EXCEPTION 'La condición de examen se acredita automáticamente al aprobar'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.matricula_condiciones
     SET cumplida = p_cumplida,
         cumplida_at = CASE WHEN p_cumplida THEN now() ELSE NULL END,
         cumplida_por = CASE WHEN p_cumplida THEN auth.uid() ELSE NULL END,
         observaciones = COALESCE(p_observaciones, observaciones)
   WHERE id = p_matricula_condicion_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.matricula_tildar_condicion(uuid, boolean, text)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.matricula_tildar_condicion(uuid, boolean, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 8 · RPC curso_registrar_pago — marca condición 'pago' + asiento de ingreso
-- (regla 5: multi-tabla → RPC SD). DGG-10bis: NO factura necesariamente, pero
-- SÍ registra un movimiento de ingreso vinculado a la administración.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.curso_registrar_pago(
  p_matricula_id uuid,
  p_monto numeric,
  p_caja_id uuid,
  p_observaciones text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_matricula public.curso_matriculas%ROWTYPE;
  v_curso public.cursos%ROWTYPE;
  v_categoria_id uuid;
  v_movimiento_id uuid;
  v_cond_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede registrar pagos' USING ERRCODE = '42501';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser positivo' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_matricula FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_matricula.id IS NULL THEN
    RAISE EXCEPTION 'Matrícula inexistente' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_curso FROM public.cursos WHERE id = v_matricula.curso_id;

  -- Categoría de ingreso "Cursos / Campus" (idempotente).
  SELECT id INTO v_categoria_id
    FROM public.categorias_finanzas WHERE nombre = 'Cursos / Campus';
  IF v_categoria_id IS NULL THEN
    INSERT INTO public.categorias_finanzas (nombre, tipo, icono)
    VALUES ('Cursos / Campus', 'ingreso', 'graduation-cap')
    ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
    RETURNING id INTO v_categoria_id;
  END IF;

  -- Asiento de ingreso en movimientos (monto positivo, tipo ingreso,
  -- estado identificado). Vinculado opcionalmente a la administración.
  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, categoria_id, descripcion, referencia,
    administracion_id, estado, origen, created_by
  ) VALUES (
    p_caja_id, CURRENT_DATE, 'ingreso', p_monto, v_categoria_id,
    'Campus · pago curso ' || COALESCE(v_curso.titulo, ''),
    COALESCE(p_observaciones, NULL),
    v_matricula.administracion_id, 'identificado', 'manual', auth.uid()
  ) RETURNING id INTO v_movimiento_id;

  -- Marcar la condición 'pago' como cumplida (si el curso la exige).
  UPDATE public.matricula_condiciones mc
     SET cumplida = true, cumplida_at = now(), cumplida_por = auth.uid(),
         observaciones = COALESCE(p_observaciones, mc.observaciones)
    FROM public.curso_condiciones_config cc
   WHERE mc.condicion_id = cc.id
     AND mc.matricula_id = p_matricula_id
     AND cc.tipo = 'pago'
  RETURNING mc.id INTO v_cond_id;

  RETURN jsonb_build_object(
    'movimiento_id', v_movimiento_id,
    'condicion_pago_id', v_cond_id
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.curso_registrar_pago(uuid, numeric, uuid, text)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.curso_registrar_pago(uuid, numeric, uuid, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 9 · curso_matricular: cerrar autoservicio (DGG-10).
-- Ahora SOLO staff puede matricular. La RPC de asignación es curso_asignar_alumno;
-- esta se mantiene para compat pero deja de permitir auto-matrícula del alumno.
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
  -- DGG-10: solo staff matricula. Se cerró el autoservicio.
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'La inscripción la habilita la gerencia (acceso por asignación)'
      USING ERRCODE = '42501';
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
    curso_id, profile_id, administracion_id, vigencia_hasta, estado
  ) VALUES (
    p_curso_id, p_profile_id, p_administracion_id, v_vigencia_hasta, 'activa'
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
  v_email := (SELECT email FROM auth.users WHERE id = p_profile_id);
  v_nombre := COALESCE(v_profile.full_name, 'Alumno');

  IF v_email IS NOT NULL THEN
    PERFORM public.encolar_email(
      'curso-inscripcion-confirmada', v_email, v_nombre,
      jsonb_build_object(
        'nombre', v_nombre,
        'curso_titulo', v_curso.titulo,
        'nombre_curso', v_curso.titulo,
        'vigencia_hasta', to_char(v_vigencia_hasta, 'DD/MM/YYYY'),
        'fecha_inicio', to_char(COALESCE(v_curso.fecha_inicio, CURRENT_DATE), 'DD/MM/YYYY')
      ),
      p_administracion_id, NULL, 'curso_matriculas', v_matricula_id, 5::smallint
    );
  END IF;

  RETURN v_matricula_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Realtime sobre las tablas nuevas (UX premium, mismo patrón que 0029).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.matricula_condiciones;
      EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.curso_encuentro_asistencias;
      EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.curso_encuentros;
      EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.curso_condiciones_config;
      EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;
