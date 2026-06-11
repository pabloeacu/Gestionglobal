-- F10 · Encuentros sincrónicos como MÓDULOS (chunk 1 · backend).
-- ============================================================================
-- Un "módulo sincrónico" = una condición de tipo 'asistencia' (curso_condiciones_config)
-- enriquecida con: modalidad (unico/alternativos/serie), docente (nombre+foto+CV) y
-- descripción. Cada curso_encuentro pertenece a un módulo vía condicion_id.
-- La condición se AUTO-computa por modalidad desde curso_encuentro_asistencias:
--   - unico / alternativos → basta 1 encuentro con presente=true
--   - serie               → presente en TODOS los encuentros del módulo
-- El gate de emisión del certificado (mig 0139) lee matricula_condiciones.cumplida
-- igual que para cualquier condición → se integra sin tocarlo.
-- (BACKLOG F10; aclaración de Pablo: 3 modalidades por módulo, varios por curso.)

-- 1) Metadata del módulo sincrónico sobre la condición de asistencia ----------
ALTER TABLE public.curso_condiciones_config
  ADD COLUMN IF NOT EXISTS modalidad text
    CHECK (modalidad IS NULL OR modalidad IN ('unico','alternativos','serie')),
  ADD COLUMN IF NOT EXISTS descripcion text,
  ADD COLUMN IF NOT EXISTS docente_nombre text,
  ADD COLUMN IF NOT EXISTS docente_foto_url text,
  ADD COLUMN IF NOT EXISTS docente_cv_url text;

-- 2) Cada encuentro pertenece a un módulo sincrónico --------------------------
ALTER TABLE public.curso_encuentros
  ADD COLUMN IF NOT EXISTS condicion_id uuid
    REFERENCES public.curso_condiciones_config(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_curso_encuentros_condicion
  ON public.curso_encuentros(condicion_id) WHERE condicion_id IS NOT NULL;

-- 3) Evaluación de cumplimiento por modalidad (pura) --------------------------
CREATE OR REPLACE FUNCTION private.eval_asistencia_cumplida(
  p_matricula_id uuid, p_condicion_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH enc AS (
    SELECT id FROM public.curso_encuentros WHERE condicion_id = p_condicion_id
  ),
  pres AS (
    SELECT count(*) AS n FROM public.curso_encuentro_asistencias a
    WHERE a.matricula_id = p_matricula_id AND a.presente = true
      AND a.encuentro_id IN (SELECT id FROM enc)
  )
  SELECT CASE
    WHEN (SELECT count(*) FROM enc) = 0 THEN false
    WHEN (SELECT modalidad FROM public.curso_condiciones_config WHERE id = p_condicion_id) = 'serie'
      THEN (SELECT n FROM pres) >= (SELECT count(*) FROM enc)
    ELSE (SELECT n FROM pres) >= 1   -- unico / alternativos
  END;
$function$;

-- 4) Recomputar + persistir en matricula_condiciones (sólo módulos sincrónicos) --
CREATE OR REPLACE FUNCTION private.recompute_asistencia(
  p_matricula_id uuid, p_condicion_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tipo text; v_modalidad text; v_ok boolean;
BEGIN
  SELECT tipo, modalidad INTO v_tipo, v_modalidad
    FROM public.curso_condiciones_config WHERE id = p_condicion_id;
  -- Sólo auto-gestionamos condiciones de asistencia que SON módulos sincrónicos
  -- (tienen modalidad). Las asistencia manuales (sin modalidad) las tilda gerencia.
  IF v_tipo IS DISTINCT FROM 'asistencia' OR v_modalidad IS NULL THEN
    RETURN;
  END IF;
  v_ok := private.eval_asistencia_cumplida(p_matricula_id, p_condicion_id);
  INSERT INTO public.matricula_condiciones (matricula_id, condicion_id, cumplida, cumplida_at)
  VALUES (p_matricula_id, p_condicion_id, v_ok, CASE WHEN v_ok THEN now() ELSE NULL END)
  ON CONFLICT (matricula_id, condicion_id) DO UPDATE
    SET cumplida = EXCLUDED.cumplida,
        cumplida_at = CASE
          WHEN EXCLUDED.cumplida AND matricula_condiciones.cumplida = false THEN now()
          WHEN NOT EXCLUDED.cumplida THEN NULL
          ELSE matricula_condiciones.cumplida_at END,
        updated_at = now();
END;
$function$;

-- 5) Trigger: al cambiar una asistencia, recomputar la condición de su encuentro
CREATE OR REPLACE FUNCTION public.tg_asistencia_recompute()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_cond uuid;
BEGIN
  SELECT condicion_id INTO v_cond FROM public.curso_encuentros WHERE id = NEW.encuentro_id;
  IF v_cond IS NOT NULL THEN
    PERFORM private.recompute_asistencia(NEW.matricula_id, v_cond);
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_asistencia_recompute ON public.curso_encuentro_asistencias;
CREATE TRIGGER trg_asistencia_recompute
  AFTER INSERT OR UPDATE OF presente ON public.curso_encuentro_asistencias
  FOR EACH ROW EXECUTE FUNCTION public.tg_asistencia_recompute();

-- 6) Trigger: el conteo de 'serie' depende del total de encuentros del módulo →
--    si se agrega/quita/reasigna un encuentro, recomputar todas sus matrículas.
CREATE OR REPLACE FUNCTION public.tg_encuentro_cond_recompute()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record;
BEGIN
  IF COALESCE(NEW.condicion_id, OLD.condicion_id) IS NOT NULL THEN
    FOR r IN SELECT DISTINCT matricula_id FROM public.matricula_condiciones
             WHERE condicion_id = COALESCE(NEW.condicion_id, OLD.condicion_id) LOOP
      PERFORM private.recompute_asistencia(r.matricula_id, COALESCE(NEW.condicion_id, OLD.condicion_id));
    END LOOP;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.condicion_id IS DISTINCT FROM OLD.condicion_id
     AND OLD.condicion_id IS NOT NULL THEN
    FOR r IN SELECT DISTINCT matricula_id FROM public.matricula_condiciones
             WHERE condicion_id = OLD.condicion_id LOOP
      PERFORM private.recompute_asistencia(r.matricula_id, OLD.condicion_id);
    END LOOP;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;
DROP TRIGGER IF EXISTS trg_encuentro_cond_recompute ON public.curso_encuentros;
CREATE TRIGGER trg_encuentro_cond_recompute
  AFTER INSERT OR DELETE OR UPDATE OF condicion_id ON public.curso_encuentros
  FOR EACH ROW EXECUTE FUNCTION public.tg_encuentro_cond_recompute();

REVOKE EXECUTE ON FUNCTION private.eval_asistencia_cumplida(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.recompute_asistencia(uuid, uuid) FROM PUBLIC, anon, authenticated;
