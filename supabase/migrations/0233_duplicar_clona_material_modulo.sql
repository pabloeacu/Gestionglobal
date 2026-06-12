-- ============================================================================
-- 0233 · curso_duplicar: clonar también el "Material extra" por módulo
-- ----------------------------------------------------------------------------
-- DGG-72 agregó curso_modulo_material (mig 0232) DESPUÉS de curso_duplicar
-- (mig 0222). El clon enumera columnas/tablas EXPLÍCITAS, así que un curso
-- duplicado perdía TODO el material extra de sus módulos (GAP de paridad hallado
-- por la §6). Se agrega el paso 3b: clona curso_modulo_material remapeando
-- modulo_id vía _clone_cmap (kind='modulo'). Firma intacta → CREATE OR REPLACE
-- (R16, sin overload ambiguo). El resto de la función queda IDÉNTICO.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.curso_duplicar(p_curso_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_new uuid := gen_random_uuid();
  v_base text; v_slug text; v_n int := 1;
BEGIN
  -- ⚠ MANTENIMIENTO: este clon enumera columnas EXPLÍCITAS. Si agregás una columna de
  -- contenido/config a cursos o a cualquier curso_*, actualizá el INSERT correspondiente
  -- o el clon la pierde en silencio (mismo riesgo latente que E-GG-42 / R18).
  IF private.is_staff() IS NOT TRUE THEN
    RAISE EXCEPTION 'Sólo gerencia puede duplicar cursos' USING ERRCODE='42501';
  END IF;
  SELECT slug INTO v_base FROM public.cursos WHERE id = p_curso_id;
  IF v_base IS NULL THEN
    RAISE EXCEPTION 'Curso no encontrado' USING ERRCODE='P0002';
  END IF;

  -- Serializa duplicaciones del MISMO curso-base (lock por-transacción) para evitar el
  -- TOCTOU del slug entre el WHILE y el INSERT. Cursos distintos no se bloquean entre sí.
  PERFORM pg_advisory_xact_lock(hashtext('curso_duplicar'), hashtext(v_base));

  v_slug := v_base || '-copia';
  WHILE EXISTS (SELECT 1 FROM public.cursos WHERE slug = v_slug) LOOP
    v_n := v_n + 1; v_slug := v_base || '-copia-' || v_n;
  END LOOP;

  CREATE TEMP TABLE IF NOT EXISTS _clone_cmap (kind text, old_id uuid, new_id uuid);
  TRUNCATE _clone_cmap;

  -- 1) curso (borrador, slug nuevo)
  INSERT INTO public.cursos
    (id, slug, titulo, descripcion, descripcion_html, requisitos_html, categoria, modalidad,
     duracion_horas, precio_lista, activo, fecha_inicio, fecha_fin, cupo_max, instructor_nombre,
     instructor_bio, banner_url, vigencia_meses, observaciones, presencia_minima_pct,
     cert_esquema_id, cert_emite_auto, instructor_foto_url, publicar_at, despublicar_at, created_by)
  SELECT v_new, v_slug, titulo || ' (copia)', descripcion, descripcion_html, requisitos_html, categoria, modalidad,
     duracion_horas, precio_lista, false, fecha_inicio, fecha_fin, cupo_max, instructor_nombre,
     instructor_bio, banner_url, vigencia_meses, observaciones, presencia_minima_pct,
     cert_esquema_id, cert_emite_auto, instructor_foto_url, NULL, NULL, auth.uid()
  FROM public.cursos WHERE id = p_curso_id;

  -- 2) módulos
  INSERT INTO _clone_cmap SELECT 'modulo', id, gen_random_uuid() FROM public.curso_modulos WHERE curso_id = p_curso_id;
  INSERT INTO public.curso_modulos
    (id, curso_id, orden, titulo, descripcion, icono_url, publicado, publicar_at, despublicar_at,
     docente_nombre, docente_foto_url, docente_bio, docente_cv_url)
  SELECT m.new_id, v_new, o.orden, o.titulo, o.descripcion, o.icono_url, o.publicado, o.publicar_at, o.despublicar_at,
     o.docente_nombre, o.docente_foto_url, o.docente_bio, o.docente_cv_url
  FROM public.curso_modulos o JOIN _clone_cmap m ON m.kind='modulo' AND m.old_id=o.id;

  -- 3) clases (remap modulo_id; NULL zoom_url/zoom_fecha_hora → sala se recrea, igual que encuentros)
  INSERT INTO public.curso_clases
    (id, modulo_id, orden, titulo, descripcion, tipo, youtube_url, zoom_url, zoom_fecha_hora,
     material_url, duracion_min, instructor_foto_url, publicado, publicar_at, despublicar_at)
  SELECT gen_random_uuid(), m.new_id, c.orden, c.titulo, c.descripcion, c.tipo, c.youtube_url, NULL, NULL,
     c.material_url, c.duracion_min, c.instructor_foto_url, c.publicado, c.publicar_at, c.despublicar_at
  FROM public.curso_clases c JOIN _clone_cmap m ON m.kind='modulo' AND m.old_id=c.modulo_id;

  -- 3b) material extra por módulo (DGG-72): remap modulo_id vía el clone-map.
  --     Sin created_at en el INSERT → default now() (igual criterio que clases).
  INSERT INTO public.curso_modulo_material
    (id, modulo_id, titulo, url, archivo_url, descripcion)
  SELECT gen_random_uuid(), m.new_id, mat.titulo, mat.url, mat.archivo_url, mat.descripcion
  FROM public.curso_modulo_material mat JOIN _clone_cmap m ON m.kind='modulo' AND m.old_id=mat.modulo_id;

  -- 4) exámenes (remap modulo_id; map examen)
  INSERT INTO _clone_cmap SELECT 'examen', id, gen_random_uuid() FROM public.curso_examenes WHERE curso_id = p_curso_id;
  INSERT INTO public.curso_examenes
    (id, curso_id, modulo_id, titulo, descripcion, fecha_habilitacion, fecha_cierre, intentos_max,
     nota_aprobacion, mostrar_resultados, mezclar_preguntas)
  SELECT e.new_id, v_new, mm.new_id, o.titulo, o.descripcion, o.fecha_habilitacion, o.fecha_cierre, o.intentos_max,
     o.nota_aprobacion, o.mostrar_resultados, o.mezclar_preguntas
  FROM public.curso_examenes o
  JOIN _clone_cmap e ON e.kind='examen' AND e.old_id=o.id
  LEFT JOIN _clone_cmap mm ON mm.kind='modulo' AND mm.old_id=o.modulo_id;

  -- 5) secciones (map seccion; remap examen)
  INSERT INTO _clone_cmap SELECT 'seccion', s.id, gen_random_uuid()
    FROM public.curso_examen_secciones s JOIN _clone_cmap e ON e.kind='examen' AND e.old_id=s.examen_id;
  INSERT INTO public.curso_examen_secciones (id, examen_id, orden, titulo, descripcion)
  SELECT sm.new_id, e.new_id, s.orden, s.titulo, s.descripcion
  FROM public.curso_examen_secciones s
  JOIN _clone_cmap e ON e.kind='examen' AND e.old_id=s.examen_id
  JOIN _clone_cmap sm ON sm.kind='seccion' AND sm.old_id=s.id;

  -- 6) preguntas (map pregunta; remap examen + seccion)
  INSERT INTO _clone_cmap SELECT 'pregunta', q.id, gen_random_uuid()
    FROM public.curso_preguntas q JOIN _clone_cmap e ON e.kind='examen' AND e.old_id=q.examen_id;
  INSERT INTO public.curso_preguntas (id, examen_id, orden, tipo, enunciado, puntaje, seccion_id, explicacion)
  SELECT qm.new_id, e.new_id, q.orden, q.tipo, q.enunciado, q.puntaje, sm.new_id, q.explicacion
  FROM public.curso_preguntas q
  JOIN _clone_cmap e ON e.kind='examen' AND e.old_id=q.examen_id
  JOIN _clone_cmap qm ON qm.kind='pregunta' AND qm.old_id=q.id
  LEFT JOIN _clone_cmap sm ON sm.kind='seccion' AND sm.old_id=q.seccion_id;

  -- 7) opciones (remap pregunta)
  INSERT INTO public.curso_opciones (id, pregunta_id, orden, texto, correcta, retroalimentacion)
  SELECT gen_random_uuid(), qm.new_id, op.orden, op.texto, op.correcta, op.retroalimentacion
  FROM public.curso_opciones op JOIN _clone_cmap qm ON qm.kind='pregunta' AND qm.old_id=op.pregunta_id;

  -- 8) condiciones (map condicion; remap examen_id)
  INSERT INTO _clone_cmap SELECT 'condicion', id, gen_random_uuid() FROM public.curso_condiciones_config WHERE curso_id = p_curso_id;
  INSERT INTO public.curso_condiciones_config
    (id, curso_id, tipo, etiqueta, automatica, examen_id, obligatoria, orden, activa,
     modalidad, descripcion, docente_nombre, docente_foto_url, docente_cv_url)
  SELECT cm.new_id, v_new, o.tipo, o.etiqueta, o.automatica, em.new_id, o.obligatoria, o.orden, o.activa,
     o.modalidad, o.descripcion, o.docente_nombre, o.docente_foto_url, o.docente_cv_url
  FROM public.curso_condiciones_config o
  JOIN _clone_cmap cm ON cm.kind='condicion' AND cm.old_id=o.id
  LEFT JOIN _clone_cmap em ON em.kind='examen' AND em.old_id=o.examen_id;

  -- 9) encuentros (remap condicion_id; NULL salas Zoom/Webex; WHERE de scope incluido)
  INSERT INTO public.curso_encuentros
    (id, curso_id, titulo, descripcion, fecha_hora, link_zoom, orden, duracion_min, plataforma, condicion_id, zoom_status)
  SELECT gen_random_uuid(), v_new, o.titulo, o.descripcion, o.fecha_hora, NULL, o.orden, o.duracion_min, o.plataforma, cm.new_id, 'programado'
  FROM public.curso_encuentros o
  LEFT JOIN _clone_cmap cm ON cm.kind='condicion' AND cm.old_id=o.condicion_id
  WHERE o.curso_id = p_curso_id;

  -- 10) bibliografía
  INSERT INTO public.curso_bibliografia (id, curso_id, titulo, autor, url, archivo_url, descripcion, publicado, publicar_at, despublicar_at)
  SELECT gen_random_uuid(), v_new, titulo, autor, url, archivo_url, descripcion, publicado, publicar_at, despublicar_at
  FROM public.curso_bibliografia WHERE curso_id = p_curso_id;

  -- 11) encuestas (config; sin respuestas)
  INSERT INTO public.curso_encuestas (id, curso_id, titulo, descripcion, schema, activa, requerida_para_cert, created_by)
  SELECT gen_random_uuid(), v_new, titulo, descripcion, schema, activa, requerida_para_cert, auth.uid()
  FROM public.curso_encuestas WHERE curso_id = p_curso_id;

  RETURN v_new;
END;
$function$;
