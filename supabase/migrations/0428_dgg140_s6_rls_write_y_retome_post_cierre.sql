-- ============================================================================
-- 0428_dgg140_s6_rls_write_y_retome_post_cierre.sql
-- DGG-140 §6 · 2 hallazgos de la auditoría de cierre (workflow 8 agentes):
--
-- (1) CRÍTICO (E-GG-182, pre-existente desde 0029/0045, verificado con exploit
--     e2e bajo JWT de alumno + rollback): la policy `examen_intentos_cud`
--     (FOR ALL por ownership) + grants INSERT/UPDATE/DELETE a authenticated
--     permitían al alumno escribir la tabla DIRECTO por PostgREST sin pasar
--     por las RPCs: auto-aprobarse (nota=100/aprobado=true → el trigger
--     SECURITY DEFINER propaga la condición → certificado), resucitar un
--     intento entregado (terminado_at=NULL → anula el tope de 0427), borrar
--     reprobados para liberar cupo, o insertar con nota pre-seteada.
--     Fix: TODA mutación de examen_intentos pasa por RPC SECURITY DEFINER
--     (R4/R5): se dropea la policy de write y se revocan los grants de
--     escritura. Queda `examen_intentos_select` (ownership + staff) para las
--     lecturas legítimas (listIntentos / listMejoresNotas — verificado que
--     ninguna superficie escribe la tabla directo).
--
-- (2) MENOR: la ventana (fecha_cierre) corría ANTES del retome en
--     curso_iniciar_intento → quien refrescaba con el examen ya cerrado no
--     podía retomar su intento abierto, pero quien dejaba la pestaña abierta
--     entregaba post-cierre (curso_responder_examen no valida cierre). Misma
--     situación, dos resultados según un refresh. Política elegida (opción a):
--     el cierre impide CREAR intentos nuevos; RETOMAR uno iniciado en ventana
--     se permite siempre — coherente con que la entrega del intento abierto
--     ya se aceptaba. La ventana se movió DESPUÉS del retome.
-- ============================================================================

-- (1) Cerrar el write directo. R2: la tabla queda con RLS y sólo policy SELECT.
DROP POLICY IF EXISTS examen_intentos_cud ON public.examen_intentos;
REVOKE INSERT, UPDATE, DELETE ON public.examen_intentos FROM authenticated, anon;
-- Las RPCs (curso_iniciar_intento / curso_responder_examen, SECURITY DEFINER
-- con owner postgres) y los triggers SECURITY DEFINER siguen operando normal.

COMMENT ON TABLE public.examen_intentos IS
  'Intentos de examen. E-GG-182: mutación SOLO vía RPCs (curso_iniciar_intento/curso_responder_examen); authenticated no tiene write directo. SELECT por ownership/staff (policy examen_intentos_select).';

-- (2) curso_iniciar_intento: la ventana se valida DESPUÉS del retome.
CREATE OR REPLACE FUNCTION public.curso_iniciar_intento(p_examen_id uuid, p_matricula_id uuid)
RETURNS examen_intentos
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_owner uuid; v_next smallint; v_row public.examen_intentos; v_curso_id uuid;
  v_examen public.curso_examenes%ROWTYPE;
  v_entregados int;
BEGIN
  SELECT profile_id INTO v_owner FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Matrícula inexistente' USING ERRCODE = '22023'; END IF;
  IF v_owner <> auth.uid() AND NOT private.is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;
  IF NOT private.is_staff() AND NOT EXISTS (
    SELECT 1 FROM public.curso_matriculas m WHERE m.id = p_matricula_id
      AND (m.estado='activa' OR (m.estado='completada' AND (m.vigencia_hasta IS NULL
            OR m.vigencia_hasta >= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)))
  ) THEN
    RAISE EXCEPTION 'Tu acceso a este curso no está vigente (matrícula vencida o dada de baja).' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_examen FROM public.curso_examenes WHERE id = p_examen_id;
  IF v_examen.id IS NULL THEN RAISE EXCEPTION 'Examen inexistente' USING ERRCODE = '22023'; END IF;
  v_curso_id := v_examen.curso_id;
  IF NOT private.is_staff() AND NOT private.curso_contenido_accesible(v_curso_id) THEN
    RAISE EXCEPTION 'El contenido de este curso todavía no está disponible.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_matricula_id::text || ':' || p_examen_id::text));

  -- DGG-140: intento abierto → RETOMAR SIEMPRE (aunque la ventana haya
  -- cerrado mientras tanto: nació en ventana y la entrega ya se aceptaba).
  SELECT * INTO v_row FROM public.examen_intentos
   WHERE matricula_id = p_matricula_id AND examen_id = p_examen_id
     AND terminado_at IS NULL
   ORDER BY intento DESC LIMIT 1;
  IF v_row.id IS NOT NULL THEN
    RETURN v_row;
  END IF;

  -- La ventana sólo gobierna la CREACIÓN de intentos nuevos (0428 §6-2).
  IF v_examen.fecha_habilitacion IS NOT NULL AND v_examen.fecha_habilitacion > now() THEN
    RAISE EXCEPTION 'El examen todavía no está habilitado.' USING ERRCODE = '22023';
  END IF;
  IF v_examen.fecha_cierre IS NOT NULL AND v_examen.fecha_cierre < now() THEN
    RAISE EXCEPTION 'El examen ya cerró.' USING ERRCODE = '22023';
  END IF;

  -- Tope por ENTREGADOS, server-side (0427).
  SELECT count(*) INTO v_entregados FROM public.examen_intentos
   WHERE matricula_id = p_matricula_id AND examen_id = p_examen_id
     AND terminado_at IS NOT NULL;
  IF v_entregados >= COALESCE(v_examen.intentos_max, 1) THEN
    RAISE EXCEPTION 'No te quedan intentos disponibles para este examen.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(max(intento), 0) + 1 INTO v_next
    FROM public.examen_intentos WHERE matricula_id = p_matricula_id AND examen_id = p_examen_id;
  INSERT INTO public.examen_intentos (matricula_id, examen_id, intento)
  VALUES (p_matricula_id, p_examen_id, v_next) RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

-- Smoke R16
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM (
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='curso_iniciar_intento'
    GROUP BY p.proname HAVING count(*) > 1
  ) t;
  IF v_n > 0 THEN RAISE EXCEPTION 'DGG-140 0428: overload ambiguo (R16)'; END IF;
END $$;

-- Smoke R17-style: la tabla queda sin policy de write para authenticated.
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_policy
   WHERE polrelid = 'public.examen_intentos'::regclass AND polcmd IN ('a','w','d','*');
  IF v_n > 0 THEN RAISE EXCEPTION 'DGG-140 0428: quedó una policy de write (%)', v_n; END IF;
END $$;
