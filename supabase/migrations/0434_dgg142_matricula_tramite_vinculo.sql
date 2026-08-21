-- 0434_dgg142_matricula_tramite_vinculo.sql
-- DGG-142 · Etapa 1 del circuito de ofrecimientos continuos (Pablo, 2026-08-21).
--
-- CONTEXTO (investigación 2026-08-21, caso Selalle/JL): el auto-cierre de
-- trámites de curso (DGG-88, mig 0253) dependía de
-- `curso_matriculas.submission_origen = tramites.formulario_submission_id`,
-- pero `submission_origen` NUNCA tuvo un escritor en todo el codebase
-- (56/56 NULL en prod) → 40 trámites de curso "resueltos" que jamás podrán
-- cerrarse solos. Además el wizard de activación SÍ matricula (53/56) y tiene
-- el trámite recién creado EN LA MANO (ctx.trackingId), pero la RPC no tenía
-- parámetro para recibirlo.
--
-- DECISIÓN (DGG-142): vínculo DIRECTO matrícula→trámite (`tramite_id`),
-- 1 salto en vez de 2, para TRAZABILIDAD (no para re-automatizar cierres:
-- doctrina Pablo "resuelto es manual, los automatismos avisan, el humano
-- decide"). Semántica: "el trámite VIGENTE que esta matrícula satisface".
-- NULL = sin vínculo (matrícula manual sin trámite en contexto). En
-- re-matriculación, un p_tramite_id nuevo PISA al viejo (trámite vigente);
-- si no viene, se conserva el existente (COALESCE).
--
-- Backfill: hoy la relación matrícula↔trámite-de-curso es 1:1 perfecta por
-- administración (verificado: 0 administraciones con 2+ matrículas o 2+
-- trámites de curso). El backfill sólo linkea los pares INEQUÍVOCOS
-- (exactamente 1 matrícula y exactamente 1 trámite de curso en la admin);
-- cualquier caso ambiguo futuro queda NULL — jamás adivinamos.

-- 1) Columna + FK + índice --------------------------------------------------
ALTER TABLE public.curso_matriculas
  ADD COLUMN IF NOT EXISTS tramite_id uuid REFERENCES public.tramites(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.curso_matriculas.tramite_id IS
  'DGG-142: trámite VIGENTE que esta matrícula satisface (vínculo directo, reemplaza al nunca-poblado submission_origen). NULL = sin vínculo. Re-matricular con otro trámite lo pisa. Sólo trazabilidad: ningún automatismo cierra trámites por esto (doctrina "resuelto es manual").';

CREATE INDEX IF NOT EXISTS idx_curso_matriculas_tramite
  ON public.curso_matriculas (tramite_id) WHERE tramite_id IS NOT NULL;

-- 2) Backfill determinístico (sólo pares 1:1 inequívocos) --------------------
WITH pares AS (
  SELECT m.id AS matricula_id, t.id AS tramite_id
  FROM public.curso_matriculas m
  JOIN public.tramites t
    ON t.administracion_id = m.administracion_id AND t.categoria = 'curso'
  WHERE m.tramite_id IS NULL
    AND (SELECT count(*) FROM public.curso_matriculas m2
          WHERE m2.administracion_id = m.administracion_id) = 1
    AND (SELECT count(*) FROM public.tramites t2
          WHERE t2.administracion_id = m.administracion_id
            AND t2.categoria = 'curso') = 1
)
UPDATE public.curso_matriculas m
   SET tramite_id = p.tramite_id
  FROM pares p
 WHERE m.id = p.matricula_id;

-- 3) RPC curso_asignar_alumno + p_tramite_id ---------------------------------
-- R16: la firma CAMBIA (4 → 5 params) → DROP explícito de la vieja, jamás
-- CREATE OR REPLACE solo (evita el overload ambiguo de PostgREST, E-GG-37).
DROP FUNCTION IF EXISTS public.curso_asignar_alumno(uuid, uuid, uuid, text);

CREATE FUNCTION public.curso_asignar_alumno(
  p_curso_id uuid,
  p_administracion_id uuid,
  p_profile_id uuid DEFAULT NULL::uuid,
  p_estado_pago text DEFAULT NULL,
  p_tramite_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_profile_id uuid;
  v_matricula_id uuid;
  v_estado text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede asignar alumnos a un curso' USING ERRCODE = '42501';
  END IF;
  PERFORM private.assert_administracion_access(p_administracion_id);

  IF p_estado_pago IS NOT NULL
     AND p_estado_pago NOT IN ('adeudado','pago_parcial','pago_completo') THEN
    RAISE EXCEPTION 'Estado de pago inválido' USING ERRCODE = '22023';
  END IF;

  -- DGG-142: si viene trámite, debe existir, ser de la MISMA administración y
  -- de categoría 'curso' (§6: el invariante vive en la API, no sólo en el
  -- front; cualquier estado es vinculable — el backfill linkea 'resuelto').
  IF p_tramite_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tramites
       WHERE id = p_tramite_id AND administracion_id = p_administracion_id
         AND categoria = 'curso'
    ) THEN
      RAISE EXCEPTION 'El trámite no existe, no es de curso o no pertenece a este cliente'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT private.curso_estado_publicacion(activo, publicar_at, despublicar_at)
    INTO v_estado FROM public.cursos WHERE id = p_curso_id;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'Curso inexistente' USING ERRCODE = 'P0002';
  END IF;
  IF v_estado = 'finalizado' THEN
    RAISE EXCEPTION 'El curso está finalizado; no admite nuevas matrículas' USING ERRCODE = '22023';
  END IF;

  v_profile_id := COALESCE(p_profile_id,
    (SELECT user_id FROM public.administraciones WHERE id = p_administracion_id));
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'La administración no tiene usuario de portal; creá el acceso primero'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_matricula_id FROM public.curso_matriculas
   WHERE curso_id = p_curso_id AND administracion_id = p_administracion_id
     AND profile_id = v_profile_id;
  IF v_matricula_id IS NOT NULL THEN
    -- idempotente; si viene un estado de pago, se actualiza (el trigger sincroniza).
    IF p_estado_pago IS NOT NULL THEN
      UPDATE public.curso_matriculas SET estado_pago = p_estado_pago
       WHERE id = v_matricula_id AND estado_pago IS DISTINCT FROM p_estado_pago;
    END IF;
    -- DGG-142: el trámite nuevo pisa al viejo (semántica "trámite vigente");
    -- si no viene, se conserva el existente.
    IF p_tramite_id IS NOT NULL THEN
      UPDATE public.curso_matriculas SET tramite_id = p_tramite_id
       WHERE id = v_matricula_id AND tramite_id IS DISTINCT FROM p_tramite_id;
    END IF;
    RETURN v_matricula_id;
  END IF;

  INSERT INTO public.curso_matriculas
    (curso_id, administracion_id, profile_id, fuente, estado_pago, tramite_id)
  VALUES (p_curso_id, p_administracion_id, v_profile_id, 'gerencia_manual',
          COALESCE(p_estado_pago, 'adeudado'), p_tramite_id)
  RETURNING id INTO v_matricula_id;

  RETURN v_matricula_id;
END;
$$;

REVOKE ALL ON FUNCTION public.curso_asignar_alumno(uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.curso_asignar_alumno(uuid, uuid, uuid, text, uuid) TO authenticated;

-- 4) Deprecaciones (§6 DGG-142) ----------------------------------------------
COMMENT ON COLUMN public.curso_matriculas.submission_origen IS
  'DEPRECADA (DGG-142, 2026-08-21): sin escritor desde su nacimiento (mig 0029), 0/56 poblada; reemplazada por tramite_id. NO dropear sin reescribir en la misma mig gg_campus_vencer_matriculas y trg_certificado_cierra_tramite_curso_fn (la referencian; patrón E-GG-42).';

COMMENT ON FUNCTION public.curso_matricular(uuid, uuid, uuid) IS
  'DEPRECADA (DGG-142, 2026-08-21): no conoce tramite_id ni fuente. Todo alta staff debe usar curso_asignar_alumno. 0 callers en src/ y functions/. Candidata a DROP en Etapa 2.';

-- ----------------------------------------------------------------------------
-- SMOKES (corridos vía MCP tras aplicar — R16 y R18):
--   · R16: SELECT proname ... GROUP BY HAVING count(*)>1 → 0 filas.
--   · R18: DO $$ ... asignar con p_tramite_id → fila con tramite_id; re-asignar
--     con otro trámite → pisa; sin trámite → conserva; trámite ajeno → excepción;
--     ROLLBACK. Verificación backfill: pares 1:1 linkeados, ambiguos NULL.
-- ----------------------------------------------------------------------------
