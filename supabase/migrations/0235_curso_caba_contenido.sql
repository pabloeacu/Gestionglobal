-- 0235_curso_caba_contenido.sql
-- Carga de contenido del "Gestar: Curso de Actualización 2026 (RPA - CABA)"
-- (curso eaafb7af · slug curso-actualizacion-2026-rpa-caba) desde el docx provisto
-- por Pablo (2026-06-12). 5 módulos con docente (foto/CV del banco), clases (videos
-- YouTube + duración), bibliografía (2 carpetas Drive) y examen GESTAR.
--
-- Estilo (sin redundancias, acorde al curso de formación / DGG-70):
--  - Títulos de clase sin el sufijo "- Dra./Lic. X" (el módulo ya muestra el docente)
--    ni el número (lo da `orden`). Donde el docx sólo numera ("Clase N") se mantiene.
--  - Examen: se DROPEA la sección "Datos del alumno" (redundante: ya tenemos los datos
--    del matriculado), igual criterio que la encuesta DGG-74. Quedan las 5 secciones
--    temáticas (15 preguntas / 100 pts), V/F como `verdadero_falso` y el resto
--    `multiple_choice`; la justificación va en `explicacion`.
-- Huecos de banco (NO disponibles, quedan NULL): foto de Bercovsky, CV de Suken, CV de
-- Castro (coincide con "Sin CV: Castro/Suken" de DGG-73).
-- Idempotente: aborta si el curso ya tiene módulos (no duplica).

DO $mig$
DECLARE
  v_curso uuid := 'eaafb7af-5129-4d9c-a2a7-eeabd620b0e9';
  b text := 'https://kaoyhkebnidzqjixvchh.supabase.co/storage/v1/object/public/campus-media/';
  m uuid;        -- módulo actual
  v_examen uuid;
  sec uuid;      -- sección actual
  p uuid;        -- pregunta actual
BEGIN
  IF EXISTS (SELECT 1 FROM public.curso_modulos WHERE curso_id = v_curso) THEN
    RAISE EXCEPTION 'El curso CABA (%) ya tiene módulos; abortar para no duplicar', v_curso;
  END IF;

  -- ============================ MÓDULOS + CLASES ============================

  -- MÓDULO 1 · Dra. Diana Sevitz (foto + CV)
  INSERT INTO public.curso_modulos (curso_id, orden, titulo, descripcion, docente_nombre, docente_foto_url, docente_cv_url)
  VALUES (v_curso, 1,
    'Administrador y honorarios / Liquidación de expensas / Ruidos molestos y cuestiones convivenciales',
    'Aspectos jurídicos del mandato del administrador y sus honorarios (Art. 13 y 14 Ley 941 y modificatorias / CCyCN), la liquidación de expensas (Art. 10 Ley 941 / CCyCN) y la normativa sobre ruidos molestos y cuestiones convivenciales.',
    'Dra. Diana Sevitz',
    b || 'modulo-docente/banco-formacion/diana-sevitz.png',
    b || 'modulo-docente-cv/banco-formacion/diana-sevitz.pdf')
  RETURNING id INTO m;
  INSERT INTO public.curso_clases (modulo_id, orden, titulo, tipo, youtube_url, duracion_min) VALUES
    (m, 1, 'Infracciones · Ruidos molestos', 'asincronica_video', 'https://www.youtube.com/watch?v=33ZTsr21R1o', 23),
    (m, 2, '¿Cómo leer mis expensas?', 'asincronica_video', 'https://www.youtube.com/watch?v=f-anEk5XFIE', 31),
    (m, 3, 'Art. 14 · Honorarios', 'asincronica_video', 'https://www.youtube.com/watch?v=_aMn8bm9EVA', 3),
    (m, 4, 'Duración del mandato', 'asincronica_video', 'https://www.youtube.com/watch?v=VuY7jnintK8', 7),
    (m, 5, 'Implementación del QR', 'asincronica_video', 'https://www.youtube.com/watch?v=86btm7UJJCE', 15);

  -- MÓDULO 2 · Dra. Silvia Bercovsky (CV; SIN foto en banco → NULL)
  INSERT INTO public.curso_modulos (curso_id, orden, titulo, descripcion, docente_nombre, docente_foto_url, docente_cv_url)
  VALUES (v_curso, 2,
    'Obligaciones del administrador / Régimen de infracciones y sanciones / Procedimiento administrativo',
    'Obligaciones del Administrador (Art. 8 y 9 Ley 941 y modificatorias / CCyCN), el régimen de infracciones y sanciones (Art. 15 Ley 941) y el procedimiento administrativo (Art. 17 a 22 Ley 941).',
    'Dra. Silvia Bercovsky',
    NULL,
    b || 'modulo-docente-cv/banco-formacion/bercovsky-contacto.pdf')
  RETURNING id INTO m;
  INSERT INTO public.curso_clases (modulo_id, orden, titulo, tipo, youtube_url, duracion_min) VALUES
    (m, 1, 'Obligaciones del administrador', 'asincronica_video', 'https://www.youtube.com/watch?v=sOI_t3VLEkk', 13),
    (m, 2, 'Ley 941', 'asincronica_video', 'https://www.youtube.com/watch?v=nIpheE3nn7Y', 22),
    (m, 3, 'Derechos y obligaciones', 'asincronica_video', 'https://www.youtube.com/watch?v=qaGHAxYgqo0', 4),
    (m, 4, 'Conductas sancionables', 'asincronica_video', 'https://www.youtube.com/watch?v=JBqd3TlZM98', 13),
    (m, 5, 'Denuncia · Procedimiento administrativo', 'asincronica_video', 'https://www.youtube.com/watch?v=ePYySSqzEV0', 12);

  -- MÓDULO 3 · Dra. Tamara Suken (foto; SIN CV en banco → NULL)
  INSERT INTO public.curso_modulos (curso_id, orden, titulo, descripcion, docente_nombre, docente_foto_url, docente_cv_url)
  VALUES (v_curso, 3,
    'Auditoría interna y externa: cómo blindar tu gestión',
    'Control interno y externo en la administración de consorcios: cómo blindar la gestión del administrador a través de mecanismos de auditoría.',
    'Dra. Tamara Suken',
    b || 'modulo-docente/547c3695-f5dc-4db8-ab50-0dcc18ff6a61/suken.png',
    NULL)
  RETURNING id INTO m;
  INSERT INTO public.curso_clases (modulo_id, orden, titulo, tipo, youtube_url, duracion_min) VALUES
    (m, 1, 'Clase 1', 'asincronica_video', 'https://www.youtube.com/watch?v=7wf650knCuM', 6),
    (m, 2, 'Clase 2', 'asincronica_video', 'https://www.youtube.com/watch?v=A57DVG2z3yE', 6),
    (m, 3, 'Clase 3', 'asincronica_video', 'https://www.youtube.com/watch?v=C31M_8USGEM', 15),
    (m, 4, 'Clase 4', 'asincronica_video', 'https://www.youtube.com/watch?v=ymX5e97HY4E', 6),
    (m, 5, 'Clase 5', 'asincronica_video', 'https://www.youtube.com/watch?v=JOLXuimeT1w', 12),
    (m, 6, 'Clase 6', 'asincronica_video', 'https://www.youtube.com/watch?v=ZrQDqDigCbw', 10);

  -- MÓDULO 4 · Lic. Ximena González (foto + CV)
  INSERT INTO public.curso_modulos (curso_id, orden, titulo, descripcion, docente_nombre, docente_foto_url, docente_cv_url)
  VALUES (v_curso, 4,
    'Comunicación efectiva y resolución de conflictos en la propiedad horizontal',
    'Herramientas de comunicación efectiva para la gestión de conflictos en la propiedad horizontal.',
    'Lic. Ximena González',
    b || 'modulo-docente/660d4401-02d8-45cf-a400-fda79297cbd5/gonzalez.png',
    b || 'modulo-docente-cv/banco-formacion/ximena-gonzalez.pdf')
  RETURNING id INTO m;
  INSERT INTO public.curso_clases (modulo_id, orden, titulo, tipo, youtube_url, duracion_min) VALUES
    (m, 1, 'Clase 1', 'asincronica_video', 'https://www.youtube.com/watch?v=ozK1135ZJ3o', 7),
    (m, 2, 'Clase 2', 'asincronica_video', 'https://www.youtube.com/watch?v=YQo4g_VkaxY', 12),
    (m, 3, 'Clase 3', 'asincronica_video', 'https://www.youtube.com/watch?v=BKFSBn5e72s', 6),
    (m, 4, 'Clase 4', 'asincronica_video', 'https://www.youtube.com/watch?v=XhFT1qUu5q4', 20),
    (m, 5, 'Clase 5', 'asincronica_video', 'https://www.youtube.com/watch?v=WY6OJ0hUqQw', 16),
    (m, 6, 'Clase 6', 'asincronica_video', 'https://www.youtube.com/watch?v=VCMXvd59G9g', 15);

  -- MÓDULO 5 · Dr. Raúl Castro (foto; SIN CV en banco → NULL)
  INSERT INTO public.curso_modulos (curso_id, orden, titulo, descripcion, docente_nombre, docente_foto_url, docente_cv_url)
  VALUES (v_curso, 5,
    'Traspaso de administración (por renuncia, cese o remoción)',
    'Proceso legal y administrativo para el traspaso de la administración de un consorcio: supuestos de renuncia, cese y remoción según la normativa vigente.',
    'Dr. Raúl Castro',
    b || 'modulo-docente/14cb7ba8-ad11-45f5-87f1-58c0e74f8868/castro.png',
    NULL)
  RETURNING id INTO m;
  INSERT INTO public.curso_clases (modulo_id, orden, titulo, tipo, youtube_url, duracion_min) VALUES
    (m, 1, 'Clase 1', 'asincronica_video', 'https://www.youtube.com/watch?v=7S2JoX8IYA0', 23);

  -- ============================ BIBLIOGRAFÍA ============================
  INSERT INTO public.curso_bibliografia (curso_id, titulo, url) VALUES
    (v_curso, 'Material obligatorio', 'https://drive.google.com/drive/folders/1hI7zRRz9R_T_2fHfLDB02tZ9_mgY47g_?usp=drive_link'),
    (v_curso, 'Material complementario', 'https://drive.google.com/drive/folders/1q2JscB4WIJduAiJpokCrSke7OF6bpE97?usp=sharing');

  -- ============================ EXAMEN ============================
  INSERT INTO public.curso_examenes (curso_id, titulo, descripcion, intentos_max, nota_aprobacion, mostrar_resultados, mezclar_preguntas)
  VALUES (v_curso, 'RPA 2026: Examen Curso de Actualización GESTAR',
    E'Examen de actualización para la renovación de la matrícula RPA (CABA).\nSe aprueba con un mínimo de 60/100 puntos.\nLas respuestas correctas suman; las incorrectas no suman (tampoco restan).\nEl examen cuenta con una única chance para su presentación.\nImportante: el correo con el que rendís el examen debe coincidir con el de tu inscripción y el del campus.',
    1, 60, true, false)
  RETURNING id INTO v_examen;

  -- ----- Sección 1 · Liquidación y mandato (Dra. Sevitz · 21 pts) -----
  INSERT INTO public.curso_examen_secciones (examen_id, orden, titulo, descripcion)
  VALUES (v_examen, 1, 'Liquidación y mandato', 'Contenido de la clase de la Dra. Diana Sevitz.') RETURNING id INTO sec;

  INSERT INTO public.curso_preguntas (examen_id, seccion_id, orden, tipo, enunciado, puntaje, explicacion)
  VALUES (v_examen, sec, 1, 'verdadero_falso', 'El QR o enlace en las liquidaciones de expensas es obligatorio.', 7,
    'La implementación se basa en la disposición 1146 DGDyPC.') RETURNING id INTO p;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES (p,1,'Verdadero',true),(p,2,'Falso',false);

  INSERT INTO public.curso_preguntas (examen_id, seccion_id, orden, tipo, enunciado, puntaje, explicacion)
  VALUES (v_examen, sec, 2, 'verdadero_falso', 'En CABA no es necesario el consentimiento de la asamblea para establecer los honorarios.', 7,
    'El art. 14 de la Ley 941/02 establece que solo la asamblea puede dar el consentimiento respecto de los honorarios del administrador.') RETURNING id INTO p;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES (p,1,'Verdadero',false),(p,2,'Falso',true);

  INSERT INTO public.curso_preguntas (examen_id, seccion_id, orden, tipo, enunciado, puntaje, explicacion)
  VALUES (v_examen, sec, 3, 'verdadero_falso', 'En caso de violación de alguna norma del reglamento de propiedad horizontal, el propietario o el consorcio tienen una acción para hacer cesar la causa.', 7,
    'Está normado en el art. 2069 del CCyCN.') RETURNING id INTO p;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES (p,1,'Verdadero',true),(p,2,'Falso',false);

  -- ----- Sección 2 · Comunicación efectiva (Lic. González · 18 pts) -----
  INSERT INTO public.curso_examen_secciones (examen_id, orden, titulo, descripcion)
  VALUES (v_examen, 2, 'Comunicación efectiva', 'Contenido de la clase de la Lic. Ximena González.') RETURNING id INTO sec;

  INSERT INTO public.curso_preguntas (examen_id, seccion_id, orden, tipo, enunciado, puntaje, explicacion)
  VALUES (v_examen, sec, 1, 'multiple_choice', '¿Qué elemento transforma un simple envío de información en un proceso real de comunicación?', 6,
    'El feedback permite verificar el entendimiento mutuo. Sin él, el emisor no sabe si el receptor comprendió el mensaje correctamente.') RETURNING id INTO p;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES
    (p,1,'Un canal digital de alta tecnología',false),
    (p,2,'Un código complejo y técnico',false),
    (p,3,'La retroalimentación (feedback)',true),
    (p,4,'Un contexto formal',false);

  INSERT INTO public.curso_preguntas (examen_id, seccion_id, orden, tipo, enunciado, puntaje, explicacion)
  VALUES (v_examen, sec, 2, 'multiple_choice', 'Si una persona expresa sus ideas gritando y sin dejar hablar a los demás para imponer su punto de vista, ¿qué estilo de comunicación está utilizando?', 6,
    'La asertividad implica respeto mutuo. La agresividad se caracteriza por defender los derechos propios atropellando los de los demás, con imposición y sin escuchar.') RETURNING id INTO p;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES
    (p,1,'Comunicación pasiva',false),
    (p,2,'Comunicación asertiva',false),
    (p,3,'Comunicación agresiva',true),
    (p,4,'Escucha activa',false);

  INSERT INTO public.curso_preguntas (examen_id, seccion_id, orden, tipo, enunciado, puntaje, explicacion)
  VALUES (v_examen, sec, 3, 'verdadero_falso', 'Oír y escuchar son términos sinónimos en el contexto de la comunicación efectiva.', 6,
    'Oír es un proceso fisiológico (percibir sonidos). Escuchar es un proceso activo que implica atención, comprensión e interpretación del mensaje.') RETURNING id INTO p;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES (p,1,'Verdadero',false),(p,2,'Falso',true);

  -- ----- Sección 3 · Traspaso de administración (Dr. Castro · 21 pts) -----
  INSERT INTO public.curso_examen_secciones (examen_id, orden, titulo, descripcion)
  VALUES (v_examen, 3, 'Traspaso de administración', 'Contenido de la clase del Dr. Raúl Castro.') RETURNING id INTO sec;

  INSERT INTO public.curso_preguntas (examen_id, seccion_id, orden, tipo, enunciado, puntaje, explicacion)
  VALUES (v_examen, sec, 1, 'multiple_choice', '¿Cuál es el plazo legal que tiene el administrador saliente para entregar la documentación del consorcio?', 7,
    'Según el Código Civil y Comercial, el plazo es de 15 días hábiles, para asegurar la continuidad administrativa del edificio.') RETURNING id INTO p;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES
    (p,1,'48 horas',false),
    (p,2,'30 días corridos',false),
    (p,3,'15 días hábiles',true);

  INSERT INTO public.curso_preguntas (examen_id, seccion_id, orden, tipo, enunciado, puntaje, explicacion)
  VALUES (v_examen, sec, 2, 'multiple_choice', 'Si al recibir los libros notás que falta el Libro de Actas, ¿qué debés hacer según la clase?', 7,
    'El acta de traspaso es una foto de la realidad: si falta algo, se debe detallar para deslindar responsabilidades futuras. No firmar puede generar problemas legales.') RETURNING id INTO p;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES
    (p,1,'No firmar nada y retirarte',false),
    (p,2,'Firmar el acta dejando constancia expresa de que ese libro no fue entregado',true),
    (p,3,'Comprar un libro nuevo y olvidarse del anterior',false);

  INSERT INTO public.curso_preguntas (examen_id, seccion_id, orden, tipo, enunciado, puntaje, explicacion)
  VALUES (v_examen, sec, 3, 'verdadero_falso', 'El acta de traspaso y la aprobación de la rendición de cuentas son el mismo documento.', 7,
    'El acta de traspaso es un recibo/inventario. La aprobación de cuentas es un acto de la Asamblea de Propietarios que ocurre en otro momento.') RETURNING id INTO p;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES (p,1,'Verdadero',false),(p,2,'Falso',true);

  -- ----- Sección 4 · Obligaciones del administrador (Dra. Bercovsky · 21 pts) -----
  INSERT INTO public.curso_examen_secciones (examen_id, orden, titulo, descripcion)
  VALUES (v_examen, 4, 'Obligaciones del administrador', 'Contenido de la clase de la Dra. Silvia Bercovsky.') RETURNING id INTO sec;

  INSERT INTO public.curso_preguntas (examen_id, seccion_id, orden, tipo, enunciado, puntaje, explicacion)
  VALUES (v_examen, sec, 1, 'verdadero_falso', '¿Es infracción el incumplimiento a cualquier artículo de la Ley 941 y modificatorias de CABA?', 7,
    'Solo son infracciones las conductas enumeradas en el art. 15 de la Ley 941 y modificatorias.') RETURNING id INTO p;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES (p,1,'Verdadero',false),(p,2,'Falso',true);

  INSERT INTO public.curso_preguntas (examen_id, seccion_id, orden, tipo, enunciado, puntaje, explicacion)
  VALUES (v_examen, sec, 2, 'verdadero_falso', 'El administrador debe ejecutar las decisiones de la asamblea.', 7,
    'El administrador tiene esa obligación por el art. 2067 del CCyCN.') RETURNING id INTO p;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES (p,1,'Verdadero',true),(p,2,'Falso',false);

  INSERT INTO public.curso_preguntas (examen_id, seccion_id, orden, tipo, enunciado, puntaje, explicacion)
  VALUES (v_examen, sec, 3, 'verdadero_falso', 'El administrador debe pedir autorización al consejo de propietarios antes de realizar una reparación de partes comunes.', 7,
    'El administrador tiene obligación de mantenimiento de partes comunes (art. 9 Ley 941) y de conservación (art. 2067 CCyCN), sin necesidad de autorización previa del consejo para reparaciones.') RETURNING id INTO p;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES (p,1,'Verdadero',false),(p,2,'Falso',true);

  -- ----- Sección 5 · Control interno y externo (Dra. Suken · 19 pts) -----
  INSERT INTO public.curso_examen_secciones (examen_id, orden, titulo, descripcion)
  VALUES (v_examen, 5, 'Control interno y externo', 'Contenido de la clase de la Dra. Tamara Suken.') RETURNING id INTO sec;

  INSERT INTO public.curso_preguntas (examen_id, seccion_id, orden, tipo, enunciado, puntaje, explicacion)
  VALUES (v_examen, sec, 1, 'multiple_choice', '¿Qué es el control en la gestión de un consorcio?', 7,
    'El control es un proceso que acompaña toda la gestión, no un evento único; su fin es la eficiencia y la transparencia.') RETURNING id INTO p;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES
    (p,1,'Una inspección sorpresa que se hace una vez al año',false),
    (p,2,'Un proceso dinámico e integrado que ayuda a cumplir objetivos y dar transparencia',true),
    (p,3,'Un castigo para el administrador cuando comete errores',false);

  INSERT INTO public.curso_preguntas (examen_id, seccion_id, orden, tipo, enunciado, puntaje, explicacion)
  VALUES (v_examen, sec, 2, 'multiple_choice', '¿Cuál es el objetivo principal de la segregación de funciones?', 6,
    'Al dividir las tareas (quien compra no es quien paga), se crea una verificación cruzada natural que protege tanto al administrador como al patrimonio del edificio.') RETURNING id INTO p;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES
    (p,1,'Ahorrar dinero en sueldos de oficina',false),
    (p,2,'Que el administrador haga todo el trabajo solo para no delegar',false),
    (p,3,'Evitar que una sola persona tenga el control total de un proceso, reduciendo riesgos de error o fraude',true);

  INSERT INTO public.curso_preguntas (examen_id, seccion_id, orden, tipo, enunciado, puntaje, explicacion)
  VALUES (v_examen, sec, 3, 'verdadero_falso', 'La auditoría externa es una herramienta que reemplaza la responsabilidad del administrador de llevar sus propios controles.', 6,
    'La auditoría externa es un control sobre la gestión. El administrador sigue siendo responsable de sus controles internos; la auditoría sólo verifica si esos controles y resultados son correctos.') RETURNING id INTO p;
  INSERT INTO public.curso_opciones (pregunta_id, orden, texto, correcta) VALUES (p,1,'Verdadero',false),(p,2,'Falso',true);

END $mig$;
