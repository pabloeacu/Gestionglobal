-- ============================================================================
-- 0392 · E-GG-162 · El checklist de condiciones no se sembraba al matricular
--
-- Hallazgo CRÍTICO de la §6 de DGG-119 (probado e2e): el seed de 0390 fue
-- one-shot histórico — para toda matrícula NUEVA no se crean las filas de
-- matricula_condiciones, y el gate de emisión cuenta sobre las filas que
-- existen → un alta nueva con responder SOLO la encuesta emitía certificado
-- (sin examen, sin pago). El aviso de retención tampoco disparaba (es
-- AFTER UPDATE y las syncs insertan la fila ya cumplida).
--
-- Fix estructural:
--   1. Trigger AFTER INSERT en curso_matriculas: siembra TODAS las
--      condiciones activas en false + put-al-día con las syncs canónicas.
--   2. Trigger en curso_condiciones_config: al crear/activar una condición,
--      siembra la fila en todas las matrículas existentes del curso.
--   3. La rama "no pago_completo" del sync de estado de pago ahora también
--      UPSERTea la fila (cinturón extra).
--   4. §6 B#3: matricula_set_estado_pago al salir de 'pago_completo'
--      destilda la condición de pago SIN importar autoría — es la acción
--      explícita más reciente del gerente y no puede quedar muda.
--      Y curso_registrar_pago compara monto vs precio_lista: un pago
--      parcial ya no declara 'pago_completo'.
-- ============================================================================

-- 1 · seed al matricular
CREATE OR REPLACE FUNCTION private.trg_matricula_seed_condiciones()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE r record;
BEGIN
  INSERT INTO public.matricula_condiciones (matricula_id, condicion_id, cumplida)
  SELECT NEW.id, cc.id, false
    FROM public.curso_condiciones_config cc
   WHERE cc.curso_id = NEW.curso_id AND cc.activa
  ON CONFLICT (matricula_id, condicion_id) DO NOTHING;

  -- put-al-día: si el alumno ya tiene examen aprobado / encuesta respondida /
  -- asistencias (re-asignación), las syncs canónicas lo acreditan.
  BEGIN
    PERFORM public.matricula_sync_examen(NEW.id);
    PERFORM public.matricula_sync_encuesta(NEW.id);
    FOR r IN
      SELECT cc.id FROM public.curso_condiciones_config cc
       WHERE cc.curso_id = NEW.curso_id AND cc.activa
         AND cc.tipo = 'asistencia' AND cc.modalidad IS NOT NULL
    LOOP
      PERFORM private.recompute_asistencia(NEW.id, r.id);
    END LOOP;
    PERFORM private.matricula_sync_estado_pago(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'seed_condiciones put-al-dia falló (best-effort): %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_matricula_seed_condiciones ON public.curso_matriculas;
CREATE TRIGGER trg_matricula_seed_condiciones
AFTER INSERT ON public.curso_matriculas
FOR EACH ROW EXECUTE FUNCTION private.trg_matricula_seed_condiciones();

-- 2 · seed al crear/activar una condición del curso
CREATE OR REPLACE FUNCTION private.trg_condicion_config_seed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.activa THEN
    INSERT INTO public.matricula_condiciones (matricula_id, condicion_id, cumplida)
    SELECT cm.id, NEW.id, false
      FROM public.curso_matriculas cm
     WHERE cm.curso_id = NEW.curso_id
    ON CONFLICT (matricula_id, condicion_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_condicion_config_seed ON public.curso_condiciones_config;
CREATE TRIGGER trg_condicion_config_seed
AFTER INSERT OR UPDATE OF activa ON public.curso_condiciones_config
FOR EACH ROW EXECUTE FUNCTION private.trg_condicion_config_seed();

-- 3 · sync estado_pago: rama no-completo también upsertea (cinturón)
CREATE OR REPLACE FUNCTION private.matricula_sync_estado_pago(p_matricula_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado text;
  v_curso uuid;
  r record;
BEGIN
  SELECT m.estado_pago, m.curso_id INTO v_estado, v_curso
    FROM public.curso_matriculas m WHERE m.id = p_matricula_id;
  IF v_estado IS NULL THEN RETURN; END IF;

  FOR r IN
    SELECT cc.id FROM public.curso_condiciones_config cc
     WHERE cc.curso_id = v_curso AND cc.tipo = 'pago' AND cc.activa
  LOOP
    IF v_estado = 'pago_completo' THEN
      INSERT INTO public.matricula_condiciones (matricula_id, condicion_id, cumplida, cumplida_at, cumplida_por, observaciones)
      VALUES (p_matricula_id, r.id, true, now(), NULL, 'Pago completo (estado de pago de la matrícula)')
      ON CONFLICT (matricula_id, condicion_id) DO UPDATE
        SET cumplida = true, cumplida_at = now(), cumplida_por = NULL,
            observaciones = 'Pago completo (estado de pago de la matrícula)'
        WHERE NOT matricula_condiciones.cumplida;
    ELSE
      INSERT INTO public.matricula_condiciones (matricula_id, condicion_id, cumplida)
      VALUES (p_matricula_id, r.id, false)
      ON CONFLICT (matricula_id, condicion_id) DO UPDATE
        SET cumplida = false, cumplida_at = NULL,
            observaciones = 'Destildada: estado de pago pasó a ' || v_estado
        WHERE matricula_condiciones.cumplida AND matricula_condiciones.cumplida_por IS NULL;
    END IF;
  END LOOP;
END;
$$;

-- 4a · set explícito del gerente: salir de pago_completo destilda SIEMPRE
CREATE OR REPLACE FUNCTION public.matricula_set_estado_pago(p_matricula_id uuid, p_estado text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia' USING ERRCODE = '42501';
  END IF;
  IF p_estado NOT IN ('adeudado','pago_parcial','pago_completo') THEN
    RAISE EXCEPTION 'Estado de pago inválido' USING ERRCODE = '22023';
  END IF;
  UPDATE public.curso_matriculas
     SET estado_pago = p_estado
   WHERE id = p_matricula_id AND estado_pago IS DISTINCT FROM p_estado;

  -- §6 B#3: la decisión explícita del gerente manda — al salir de
  -- pago_completo se destilda la condición aunque el tilde fuera manual
  -- (queda auditado en observaciones).
  IF p_estado <> 'pago_completo' THEN
    UPDATE public.matricula_condiciones mc
       SET cumplida = false, cumplida_at = NULL, cumplida_por = NULL,
           observaciones = 'Destildada por gerencia: estado de pago → ' || p_estado
      FROM public.curso_condiciones_config cc
     WHERE cc.id = mc.condicion_id
       AND mc.matricula_id = p_matricula_id
       AND cc.tipo = 'pago' AND mc.cumplida;
  END IF;
END;
$$;

-- 4b · registrar pago: monto parcial ya no declara pago completo
CREATE OR REPLACE FUNCTION public.curso_registrar_pago(
  p_matricula_id uuid,
  p_monto numeric,
  p_caja_id uuid,
  p_observaciones text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_matricula record;
  v_curso record;
  v_categoria_id uuid;
  v_movimiento_id uuid;
  v_cond_id uuid;
  v_completo boolean;
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

  SELECT id INTO v_categoria_id
    FROM public.categorias_finanzas WHERE nombre = 'Cursos / Campus';
  IF v_categoria_id IS NULL THEN
    INSERT INTO public.categorias_finanzas (nombre, tipo, icono)
    VALUES ('Cursos / Campus', 'ingreso', 'graduation-cap')
    ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
    RETURNING id INTO v_categoria_id;
  END IF;

  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, categoria_id, descripcion, referencia,
    administracion_id, estado, origen, created_by
  ) VALUES (
    p_caja_id, CURRENT_DATE, 'ingreso', p_monto, v_categoria_id,
    'Campus · pago curso ' || COALESCE(v_curso.titulo, ''),
    COALESCE(p_observaciones, NULL),
    v_matricula.administracion_id, 'identificado', 'manual', auth.uid()
  ) RETURNING id INTO v_movimiento_id;

  -- §6 B#3: sólo un pago >= precio de lista (o curso sin precio) es COMPLETO.
  v_completo := COALESCE(v_curso.precio_lista, 0) <= 0
                OR p_monto >= v_curso.precio_lista - 0.009;

  IF v_completo THEN
    UPDATE public.matricula_condiciones mc
       SET cumplida = true, cumplida_at = now(), cumplida_por = auth.uid(),
           observaciones = COALESCE(p_observaciones, mc.observaciones)
      FROM public.curso_condiciones_config cc
     WHERE mc.condicion_id = cc.id
       AND mc.matricula_id = p_matricula_id
       AND cc.tipo = 'pago'
    RETURNING mc.id INTO v_cond_id;
    UPDATE public.curso_matriculas
       SET estado_pago = 'pago_completo'
     WHERE id = p_matricula_id AND estado_pago <> 'pago_completo';
  ELSE
    UPDATE public.curso_matriculas
       SET estado_pago = 'pago_parcial'
     WHERE id = p_matricula_id AND estado_pago <> 'pago_parcial';
  END IF;

  RETURN jsonb_build_object(
    'movimiento_id', v_movimiento_id,
    'condicion_pago_id', v_cond_id,
    'pago_completo', v_completo
  );
END;
$$;
