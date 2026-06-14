-- ============================================================================
-- 0238_f11_compartir_descompartir.sql
-- F11 · RPCs para compartir / des-compartir encuentros (DGG-79) — Fase 3
--
-- compartir: promueve un encuentro a SESIÓN compartida (creando la sesión y
--   MOVIENDO su sala Zoom — sin llamar a la API de Zoom, la sala ya existe) y
--   engancha el curso destino creando SU participación + SU propio módulo
--   (condición de asistencia clonada) → requisito independiente por curso (R: la
--   modalidad de cada curso se edita por separado). Idempotente y N-cursos.
--
-- descompartir: saca un curso de la sesión. Si queda 1 solo curso, "demote":
--   le devuelve la sala y la sesión se borra (vuelve a ser encuentro normal).
--
-- R5 (multi-tabla → RPC SD + search_path). R16 (nombres nuevos, sin overloads).
-- ============================================================================

-- 1) COMPARTIR ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.encuentro_compartir_con_curso(
  p_encuentro_id     uuid,
  p_curso_destino_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enc          record;
  v_cond_src     record;
  v_sesion_id    uuid;
  v_cond_dest_id uuid;
  v_enc_dest_id  uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden: solo staff puede compartir encuentros';
  END IF;

  SELECT * INTO v_enc FROM public.curso_encuentros WHERE id = p_encuentro_id;
  IF v_enc.id IS NULL THEN
    RAISE EXCEPTION 'encuentro % no existe', p_encuentro_id;
  END IF;
  IF v_enc.curso_id = p_curso_destino_id THEN
    RAISE EXCEPTION 'el curso destino no puede ser el mismo del encuentro';
  END IF;
  IF v_enc.condicion_id IS NULL THEN
    RAISE EXCEPTION 'asigná el encuentro a un módulo sincrónico antes de compartirlo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cursos WHERE id = p_curso_destino_id) THEN
    RAISE EXCEPTION 'curso destino % no existe', p_curso_destino_id;
  END IF;

  SELECT * INTO v_cond_src FROM public.curso_condiciones_config WHERE id = v_enc.condicion_id;

  -- Promover a sesión (si aún no lo es): crear la sesión moviendo la sala.
  IF v_enc.sesion_compartida_id IS NULL THEN
    INSERT INTO public.encuentro_sesiones_compartidas(
      titulo, descripcion, fecha_hora, duracion_min,
      docente_nombre, docente_foto_url, docente_cv_url,
      plataforma, zoom_meeting_id, zoom_join_url, zoom_start_url, zoom_password,
      zoom_status, iniciado_at, finalizado_at, grabacion_url, grabacion_play_url,
      webex_meeting_id, webex_join_url, webex_start_url, webex_password,
      webex_status, webex_meeting_number, created_by
    ) VALUES (
      v_enc.titulo, v_enc.descripcion, v_enc.fecha_hora, COALESCE(v_enc.duracion_min,60),
      v_cond_src.docente_nombre, v_cond_src.docente_foto_url, v_cond_src.docente_cv_url,
      v_enc.plataforma, v_enc.zoom_meeting_id, v_enc.zoom_join_url, v_enc.zoom_start_url, v_enc.zoom_password,
      v_enc.zoom_status, v_enc.iniciado_at, v_enc.finalizado_at, v_enc.grabacion_url, v_enc.grabacion_play_url,
      v_enc.webex_meeting_id, v_enc.webex_join_url, v_enc.webex_start_url, v_enc.webex_password,
      v_enc.webex_status, v_enc.webex_meeting_number, auth.uid()
    ) RETURNING id INTO v_sesion_id;

    -- La sala se movió a la sesión: el encuentro origen ya no la tiene en su fila.
    UPDATE public.curso_encuentros
       SET sesion_compartida_id = v_sesion_id,
           zoom_meeting_id = NULL, zoom_join_url = NULL, zoom_start_url = NULL,
           zoom_password = NULL, zoom_status = 'programado',
           iniciado_at = NULL, finalizado_at = NULL,
           grabacion_url = NULL, grabacion_play_url = NULL,
           webex_meeting_id = NULL, webex_join_url = NULL, webex_start_url = NULL,
           webex_password = NULL, webex_status = NULL, webex_meeting_number = NULL
     WHERE id = p_encuentro_id;
  ELSE
    v_sesion_id := v_enc.sesion_compartida_id;
  END IF;

  -- ¿El curso destino ya está enganchado? (idempotencia)
  SELECT e.id, e.condicion_id INTO v_enc_dest_id, v_cond_dest_id
    FROM public.curso_encuentros e
   WHERE e.sesion_compartida_id = v_sesion_id AND e.curso_id = p_curso_destino_id
   LIMIT 1;
  IF v_enc_dest_id IS NOT NULL THEN
    RETURN jsonb_build_object('sesion_id', v_sesion_id, 'encuentro_destino_id', v_enc_dest_id,
                              'condicion_destino_id', v_cond_dest_id, 'ya_existia', true);
  END IF;

  -- Clonar el módulo (condición) al curso destino → requisito INDEPENDIENTE por curso.
  INSERT INTO public.curso_condiciones_config(
    curso_id, tipo, etiqueta, descripcion, modalidad, obligatoria, automatica,
    docente_nombre, docente_foto_url, docente_cv_url, orden
  ) VALUES (
    p_curso_destino_id, 'asistencia', v_cond_src.etiqueta, v_cond_src.descripcion,
    v_cond_src.modalidad, v_cond_src.obligatoria, true,
    v_cond_src.docente_nombre, v_cond_src.docente_foto_url, v_cond_src.docente_cv_url,
    COALESCE((SELECT max(orden)+1 FROM public.curso_condiciones_config WHERE curso_id = p_curso_destino_id), 0)
  ) RETURNING id INTO v_cond_dest_id;

  -- Participación del curso destino (sin sala propia; deriva de la sesión).
  INSERT INTO public.curso_encuentros(
    curso_id, titulo, descripcion, fecha_hora, duracion_min, plataforma,
    condicion_id, sesion_compartida_id, orden
  ) VALUES (
    p_curso_destino_id, v_enc.titulo, v_enc.descripcion, v_enc.fecha_hora,
    COALESCE(v_enc.duracion_min,60), v_enc.plataforma,
    v_cond_dest_id, v_sesion_id, 0
  ) RETURNING id INTO v_enc_dest_id;

  RETURN jsonb_build_object('sesion_id', v_sesion_id, 'encuentro_destino_id', v_enc_dest_id,
                            'condicion_destino_id', v_cond_dest_id, 'ya_existia', false);
END;
$$;

REVOKE ALL ON FUNCTION public.encuentro_compartir_con_curso(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encuentro_compartir_con_curso(uuid,uuid) TO authenticated;

COMMENT ON FUNCTION public.encuentro_compartir_con_curso(uuid,uuid) IS
  'F11/DGG-79: promueve un encuentro a sesión compartida (mueve la sala) y engancha el curso destino con su propio módulo (condición clonada). Idempotente, N-cursos.';

-- 2) DESCOMPARTIR ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.encuentro_descompartir(
  p_encuentro_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enc        record;
  v_sesion_id  uuid;
  v_restantes  int;
  v_last_id    uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden: solo staff puede des-compartir encuentros';
  END IF;

  SELECT * INTO v_enc FROM public.curso_encuentros WHERE id = p_encuentro_id;
  IF v_enc.id IS NULL THEN RAISE EXCEPTION 'encuentro % no existe', p_encuentro_id; END IF;
  IF v_enc.sesion_compartida_id IS NULL THEN
    RAISE EXCEPTION 'el encuentro no está compartido';
  END IF;
  v_sesion_id := v_enc.sesion_compartida_id;

  -- Saca este curso de la sesión (CASCADE borra sus asistencias + eventos).
  DELETE FROM public.curso_encuentros WHERE id = p_encuentro_id;

  -- Limpia el módulo clonado si quedó SIN encuentros: un módulo de asistencia
  -- obligatorio con 0 encuentros haría eval_asistencia_cumplida=false para
  -- siempre → bloquearía el certificado de ese curso. (No toca módulos que aún
  -- tengan encuentros: el gerente pudo agregarle otros.)
  IF v_enc.condicion_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.curso_encuentros WHERE condicion_id = v_enc.condicion_id) THEN
    DELETE FROM public.curso_condiciones_config WHERE id = v_enc.condicion_id;
  END IF;

  SELECT count(*) INTO v_restantes
    FROM public.curso_encuentros WHERE sesion_compartida_id = v_sesion_id;

  IF v_restantes = 1 THEN
    -- DEMOTE: el último encuentro recupera la sala y vuelve a ser standalone.
    SELECT id INTO v_last_id FROM public.curso_encuentros WHERE sesion_compartida_id = v_sesion_id;
    UPDATE public.curso_encuentros e
       SET sesion_compartida_id = NULL,
           fecha_hora = s.fecha_hora, duracion_min = COALESCE(s.duracion_min,60),
           plataforma = s.plataforma,
           zoom_meeting_id = s.zoom_meeting_id, zoom_join_url = s.zoom_join_url,
           zoom_start_url = s.zoom_start_url, zoom_password = s.zoom_password,
           zoom_status = s.zoom_status, iniciado_at = s.iniciado_at, finalizado_at = s.finalizado_at,
           grabacion_url = s.grabacion_url, grabacion_play_url = s.grabacion_play_url,
           webex_meeting_id = s.webex_meeting_id, webex_join_url = s.webex_join_url,
           webex_start_url = s.webex_start_url, webex_password = s.webex_password,
           webex_status = s.webex_status, webex_meeting_number = s.webex_meeting_number
      FROM public.encuentro_sesiones_compartidas s
     WHERE e.id = v_last_id AND s.id = v_sesion_id;
    DELETE FROM public.encuentro_sesiones_compartidas WHERE id = v_sesion_id;
    RETURN jsonb_build_object('demoted', true, 'encuentro_restante', v_last_id);
  ELSIF v_restantes = 0 THEN
    DELETE FROM public.encuentro_sesiones_compartidas WHERE id = v_sesion_id;
    RETURN jsonb_build_object('demoted', false, 'sesion_borrada', true);
  END IF;

  RETURN jsonb_build_object('demoted', false, 'restantes', v_restantes);
END;
$$;

REVOKE ALL ON FUNCTION public.encuentro_descompartir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encuentro_descompartir(uuid) TO authenticated;

COMMENT ON FUNCTION public.encuentro_descompartir(uuid) IS
  'F11/DGG-79: saca un curso de la sesión compartida; si queda 1, le devuelve la sala y borra la sesión (demote a encuentro normal).';
