-- ============================================================================
-- 0458 · E-GG-196 — Asistencia por ACCESO desde el campus (click = presente).
-- ----------------------------------------------------------------------------
-- SÍNTOMA (reporte Pablo, 3ª clase sincrónica sin ningún presente): el panel de
-- asistencia mostraba 0 aunque entraron 30+ alumnos.
--
-- CAUSA RAÍZ real (aclarada por Pablo): NO usamos el reproductor Zoom embebido
-- (se descartó: no se podía compartir pantalla). El alumno entra por un LINK
-- DIRECTO a Zoom. Cuando entra por ese link, Zoom lo trata como invitado: manda
-- sólo el nombre que tipea (mail vacío, sin customer_key). Toda la asistencia
-- dependía entonces de matchear ese nombre libre contra el inscripto — frágil y
-- tardío (post-clase). Resultado: 0 en vivo y matcheo parcial al cierre.
--
-- SOLUCIÓN sólida (idea de Pablo): el campus YA sabe quién es el alumno logueado.
-- El propio CLICK en el acceso, desde adentro del campus, marca su asistencia con
-- su MATRÍCULA — identidad dura, en tiempo real, sin depender de Zoom. La
-- reconciliación por webhook/nombre queda como red secundaria (no primaria).
--
-- Esta migración: (1) agrega la fuente 'campus_acceso' al CHECK; (2) crea la RPC
-- que el front llama al hacer click en "Entrar". Marca presente al caller en el
-- encuentro (y en los espejos de una sesión compartida donde tenga matrícula
-- activa → su presente cuenta en sus dos cursos). Gate temporal server-side.
-- ============================================================================

-- 1) permitir la nueva fuente
ALTER TABLE public.curso_encuentro_asistencias
  DROP CONSTRAINT curso_encuentro_asistencias_fuente_check;
ALTER TABLE public.curso_encuentro_asistencias
  ADD CONSTRAINT curso_encuentro_asistencias_fuente_check
  CHECK (fuente = ANY (ARRAY['manual','zoom_auto','mixto','zoom_report','campus_acceso']));

-- 2) RPC: el click del alumno logueado marca su asistencia
CREATE OR REPLACE FUNCTION public.curso_encuentro_registrar_acceso(p_encuentro_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_curso_id uuid;
  v_fecha_hora timestamptz;
  v_duracion int;
  v_sesion_id uuid;
  v_iniciado_at timestamptz;
  v_marcadas int := 0;
  r record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitás estar logueado para registrar tu asistencia' USING ERRCODE = '42501';
  END IF;

  SELECT e.curso_id, e.fecha_hora, COALESCE(e.duracion_min, 120), e.sesion_compartida_id, e.iniciado_at
    INTO v_curso_id, v_fecha_hora, v_duracion, v_sesion_id, v_iniciado_at
    FROM public.curso_encuentros e
   WHERE e.id = p_encuentro_id;
  IF v_curso_id IS NULL THEN
    RAISE EXCEPTION 'Encuentro no encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Gate temporal (espejo del gate del front, F9-ter): sólo cuenta el acceso en
  -- [inicio − 10 min, fin], o si el host ya inició la sala (iniciado_at). Antes o
  -- mucho después no marca (evita que un click viejo/cacheado falsee asistencia).
  IF v_iniciado_at IS NULL AND (
       v_fecha_hora IS NULL
       OR now() < v_fecha_hora - interval '10 minutes'
       OR now() > v_fecha_hora + make_interval(mins => v_duracion)
     ) THEN
    RAISE EXCEPTION 'El acceso se registra desde 10 minutos antes y hasta el final del encuentro'
      USING ERRCODE = '22023';
  END IF;

  -- Marca presente al caller en este encuentro y en los espejos de la sesión
  -- compartida donde tenga matrícula activa (su presente cuenta en sus 2 cursos).
  FOR r IN
    SELECT e.id AS enc_id, m.id AS matricula_id
      FROM public.curso_encuentros e
      JOIN public.curso_matriculas m
        ON m.curso_id = e.curso_id
       AND m.profile_id = v_uid
       AND m.estado IN ('activa','completada')
     WHERE e.id = p_encuentro_id
        OR (v_sesion_id IS NOT NULL AND e.sesion_compartida_id = v_sesion_id)
  LOOP
    INSERT INTO public.curso_encuentro_asistencias (
      encuentro_id, matricula_id, presente, fuente,
      unido_at, umbral_cumplido, auto_presente, marcada_at
    ) VALUES (
      r.enc_id, r.matricula_id, true, 'campus_acceso',
      now(), true, true, now()
    )
    ON CONFLICT (encuentro_id, matricula_id) DO UPDATE SET
      presente        = true,
      auto_presente   = true,
      umbral_cumplido = true,
      unido_at        = LEAST(COALESCE(curso_encuentro_asistencias.unido_at, EXCLUDED.unido_at), EXCLUDED.unido_at),
      fuente          = CASE
                          WHEN curso_encuentro_asistencias.fuente IN ('campus_acceso') THEN 'campus_acceso'
                          ELSE 'mixto'
                        END,
      marcada_at      = now();
    v_marcadas := v_marcadas + 1;
  END LOOP;

  IF v_marcadas = 0 THEN
    RAISE EXCEPTION 'No tenés una matrícula activa en este curso' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object('ok', true, 'marcadas', v_marcadas);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.curso_encuentro_registrar_acceso(uuid) TO authenticated;
