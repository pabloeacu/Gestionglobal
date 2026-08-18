-- ============================================================================
-- 0427_dgg140_intento_fantasma_retomar_y_tope.sql
-- DGG-140 / E-GG-181 (caso Mercerat, 2026-08-18) · Un intento ABIERTO y vacío
-- (iniciado y nunca entregado: refresh, pestaña cerrada, caída de conexión)
-- consumía la única chance del examen: el front contaba TODOS los intentos
-- contra intentos_max y no había forma de retomar (el intento en curso vivía
-- sólo en memoria). La alumna quedaba con "Intentos restantes: 0" y el botón
-- bloqueado sin haber respondido nada.
--
-- Fix server-side (este archivo) — curso_iniciar_intento pasa a ser:
--  (1) IDEMPOTENTE/RETOMABLE: si hay un intento abierto (terminado_at NULL)
--      del par matrícula+examen, lo DEVUELVE en vez de crear otro.
--  (2) TOPE POR ENTREGADOS y SERVER-SIDE: sólo los intentos con terminado_at
--      NOT NULL cuentan contra intentos_max (antes el tope vivía únicamente
--      en el disabled del front — la RPC no lo validaba).
--  (3) VENTANA server-side: fecha_habilitacion / fecha_cierre también se
--      validan acá (defensa en profundidad; antes sólo en el front).
-- El fix de front (ExamenRunner) cuenta entregados, ofrece "Continuar examen"
-- y confirma antes de gastar un intento (useConfirm, R13).
--
-- R16: misma firma → CREATE OR REPLACE no genera overloads (smoke al pie).
-- ============================================================================

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

  -- DGG-140 (3): ventana del examen también server-side.
  IF v_examen.fecha_habilitacion IS NOT NULL AND v_examen.fecha_habilitacion > now() THEN
    RAISE EXCEPTION 'El examen todavía no está habilitado.' USING ERRCODE = '22023';
  END IF;
  IF v_examen.fecha_cierre IS NOT NULL AND v_examen.fecha_cierre < now() THEN
    RAISE EXCEPTION 'El examen ya cerró.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_matricula_id::text || ':' || p_examen_id::text));

  -- DGG-140 (1): intento abierto → RETOMAR (idempotente), no crear otro.
  SELECT * INTO v_row FROM public.examen_intentos
   WHERE matricula_id = p_matricula_id AND examen_id = p_examen_id
     AND terminado_at IS NULL
   ORDER BY intento DESC LIMIT 1;
  IF v_row.id IS NOT NULL THEN
    RETURN v_row;
  END IF;

  -- DGG-140 (2): el tope cuenta SOLO intentos ENTREGADOS, y se valida acá.
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
  IF v_n > 0 THEN RAISE EXCEPTION 'DGG-140: overload ambiguo (R16)'; END IF;
END $$;
