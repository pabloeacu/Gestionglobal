-- 0560_dgg221_nombre_pila.sql
-- =============================================================================
-- DGG-221 · Fix del saludo "nombre de pila" (E-GG-225).
-- El padrón PBA guarda el nombre mayormente como "Nombre [2do] Apellido(s)",
-- pero una minoría viene APELLIDO-FIRST ("Herrada Paola Andrea",
-- "Gencheff Silvia Meri Fabiana") o como razón social ("Administracion Nestor
-- M. Gonzalez S.R.L."). El motor saludaba con el PRIMER TOKEN
-- (initcap(split_part(...,1))) → en esos casos saludaba por el apellido/la
-- palabra "Administracion" ("Hola Herrada", asunto "Herrada, estás a tiempo...").
-- El primer envío real en frío cayó justo en uno de esos (herradapao@gmail.com)
-- antes del freno.
--
-- Fix: helper `prospecto_nombre_pila(text)` CONSERVADOR (estrictamente ≥ al
-- comportamiento previo, nunca regresiona un nombre-first correcto):
--   · mantiene el primer token por defecto;
--   · lo saltea sólo si es claramente apellido (termina en -ez), partícula
--     (de/di/la/los…), razón social (administracion/srl/sa/…) o inicial suelta;
--   · en modo "apellido-first" (una vez salteado el token1) prefiere el primer
--     token que sea nombre de pila conocido, recordando el primer token
--     desconocido como fallback → "Rizzo Corallo Laura"→Laura, "Administracion
--     Nestor Gonzalez SRL"→Nestor, "Marco Antonio Gomez"→Marco (intacto).
-- Diccionarios AR/ES/IT embebidos. Normaliza a minúsculas sin acentos.
-- Se reemplaza la línea v_pila en prospectos_campana_tick y
-- prospectos_enviar_campana (CREATE OR REPLACE, MISMA firma → sin overloads, R16).
-- Verificado §6 (3 agentes + e2e): 0 regresiones sobre las 2530 filas del padrón
-- (52 overrides, todos empresa/apellido; ningún token1-que-era-nombre cambió).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.prospecto_nombre_pila(p_nombre text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tokens text[];
  v_tok text;
  v_norm text;
  i int;
  v_skipped boolean := false;   -- ¿se salteó algún token (apellido/partícula/razón social/inicial) antes?
  v_cand text := NULL;          -- primer token desconocido-no-apellido en modo apellido-first (fallback)
  v_part text[] := ARRAY['de','del','la','las','los','di','da','della','delle','dello','lo',
                         'van','von','san','santa','santo','le','mac','mc','do','dos','y','e'];
  v_co text[] := ARRAY['administracion','administraciones','administradora','administrar','consorcio','consorcios',
                       'grupo','estudio','consultoria','consultores','asesoria','asesoramiento','asesores',
                       'desarrollos','desarrollo','edificadora','constructora','inmobiliario','inmobiliarios',
                       'inmobiliaria','emprendimientos','fideicomiso','cooperativa','club','nautico','country',
                       'torres','property','managers','management','business','group','asociados','asociado',
                       'compania','hijos','nietos','sociedad','responsabilidad','anonima','fiduciaria','servicios',
                       'vivienda','consumo','integracion','progreso','popular','srl','sa','sae','saf','ltda','ltd',
                       'scs','sca','sas','cia','sarl'];
  v_surn text[] := ARRAY[
    'herrada','gencheff','segovia','isaia','estigarribia','lopreiato','porreca','padilla',
    'turienzo','degiovani','giandinoto','iarussi','roussy','naso','bauk','barberis','ronconi',
    'mattaloni','loyola','garrera','rizzo','giordano','romano','greco','ferrari','rossi','russo',
    'esposito','colombo','castro','vargas','molina','navarro','ibarra','acosta','moyano','quiroga',
    'ocampo','ledesma','maidana','sosa','godoy','aguirre','carrizo','farias','cabrera','villalba',
    'paredes','cardozo','ferreyra','ferreira','cristaldo','peralta','ojeda','rojas','salinas','medina',
    'figueroa','romero','flores','bianchi','ferro','zarate','carrara','antonini','mamani','silva',
    'nuzzi','ghizzo','galguera','mendoza','carnero','sarsfield'];
  v_fn text[] := ARRAY[
    'maria','ana','laura','lucia','sofia','paula','julia','carla','sara','elena','clara','nora',
    'rosa','rita','eva','ines','irene','nadia','vera','lara','mia','emma','abril','alma','aldana',
    'agustina','antonella','araceli','ariana','ariadna','ayelen','belen','brenda','camila','carolina',
    'catalina','cecilia','celeste','celina','cintia','cinthia','claudia','constanza','cristina','daiana',
    'dana','debora','deborah','delfina','denise','denisa','diana','dolores','elisa','elizabeth','eliana',
    'emilia','erika','erica','estefania','estela','ester','esther','eugenia','evangelina','fabiana','fatima',
    'fernanda','flavia','florencia','francisca','gabriela','georgina','gimena','gisela','giselle','gladys',
    'gladis','gloria','graciela','guadalupe','ivana','jazmin','jesica','jessica','jaqueline','jacqueline',
    'jimena','johana','johanna','jorgelina','josefina','juana','karen','karina','leticia','lidia','liliana',
    'lorena','lourdes','luciana','lucrecia','ludmila','lujan','luz','magali','magdalena','malena','mara',
    'marcela','margarita','mariana','marianela','maricel','mariela','marina','marisa','marta','martina',
    'melania','melina','melisa','mercedes','micaela','milagros','miranda','mirta','monica','morena','nancy',
    'natalia','natasha','nayla','nelida','nicole','noelia','noemi','norma','nuria','olga','ornella','pamela',
    'paola','patricia','paz','pia','pilar','priscila','rafaela','ramona','raquel','rebeca','regina','renata',
    'roberta','rocio','romina','rosana','rosario','roxana','ruth','sabrina','salome','samanta','samantha',
    'sandra','selena','selene','silvana','silvia','sol','solange','soledad','sonia','stella','susana','tamara',
    'tatiana','teresa','trinidad','valentina','valeria','vanesa','vanessa','veronica','victoria','violeta',
    'viridiana','virginia','viviana','wanda','yamila','yanina','yesica','yohana','zoe','beatriz','berta',
    'betina','bettina','blanca','brisa','carmen','dora','edith','emilce','ethel','haydee','hilda','josefa',
    'juliana','miriam','myriam','perla','aurora','elsa','adriana','alicia','alejandra','andrea','analia',
    'mabel','marcia','nidia','ivonne','yolanda','griselda','elvira','nilda','teresita','lucila','isabel',
    'astrid','amalia','delma','elda','abigail','aixa','antonia','barbara','carmela','daniela','daniella',
    'elina','evelin','evelyn','fabiola','gilda','guillermina','ileana','ilda','julieta','laila','leonela',
    'lia','maia','maite','manuela','marcelina','mayra','milena','nahir','nerina','olivia','rosalia','susan',
    'vilma','xiomara','yael','zulma','mirna','marien','rosaura','marisol','fiorella','matilde','luisa',
    'juan','jose','luis','carlos','jorge','miguel','angel','pedro','pablo','diego','mario','raul','ruben',
    'hugo','oscar','hector','daniel','david','marcos','marco','martin','nestor','roberto','ricardo','rodolfo',
    'ramon','sergio','javier','fabian','fernando','gabriel','gaston','german','gonzalo','gustavo','horacio',
    'ignacio','ivan','joaquin','kevin','leandro','leonardo','lucas','luciano','marcelo','mariano','matias',
    'mauricio','mauro','maximiliano','nahuel','nicolas','octavio','omar','pascual','patricio','rafael','ramiro',
    'enzo','emanuel','emmanuel','emiliano','esteban','eduardo','elias','enrique','ezequiel','facundo','federico',
    'felipe','francisco','franco','bruno','benjamin','bautista','agustin','alan','alberto','aldo','alejandro',
    'alex','alexis','alfredo','alvaro','andres','antonio','ariel','arturo','augusto','aaron','abel','adrian',
    'adolfo','braian','brian','cesar','cristian','christian','cristobal','claudio','damian','dario','dante',
    'dylan','dilan','dionisio','domingo','dositeo','fabio','fabricio','favio','felix','fidel','fredy','gaspar',
    'genaro','geronimo','gino','guillermo','guido','heriberto','hernan','isaac','isidro','ismael','jairo',
    'jonas','jonatan','jonathan','josue','julian','julio','lautaro','lino','lisandro','lorenzo','manuel',
    'mateo','matheo','maximo','nazareno','nehuen','nelson','norberto','osvaldo','rodrigo','rolando','salvador',
    'samuel','santiago','santino','saul','sebastian','simon','teo','teodoro','thiago','tiziano','tomas',
    'ulises','uriel','valentin','valentino','vicente','victor','walter','walther','wilson','yago','abelardo',
    'anibal','aquiles','baltasar','camilo','ciro','conrado','edgar','edgardo','efrain','eloy',
    'ernesto','eugenio','evaristo','ezio','fausto','gerardo','gregorio','homero','humberto','ibrahim','jacinto',
    'jaime','jeremias','jesus','joel','justo','leon','leonel','lucio','marcial','marcelino','matteo','moises',
    'nicanor','orlando','placido','primo','reinaldo','remo','renato','rene','rogelio','romeo','santos','sixto',
    'teofilo','ubaldo','valerio','venancio','vidal','virgilio','wenceslao','zacarias'];
BEGIN
  IF p_nombre IS NULL OR btrim(p_nombre) = '' THEN RETURN NULL; END IF;
  v_tokens := string_to_array(btrim(regexp_replace(p_nombre, '\s+', ' ', 'g')), ' ');

  FOR i IN 1 .. array_length(v_tokens, 1) LOOP
    v_tok := v_tokens[i];
    v_norm := regexp_replace(
                translate(lower(v_tok),'áàäâãéèëêíìïîóòöôõúùüûñç','aaaaaeeeeiiiiooooouuuunc'),
                '[^a-z]', '', 'g');
    IF v_norm = '' OR length(v_norm) <= 1 THEN v_skipped := true; CONTINUE; END IF;   -- iniciales / basura
    IF v_norm = ANY (v_fn) THEN                                                        -- nombre de pila conocido → gana
      RETURN initcap(regexp_replace(v_tok, '[^[:alpha:]áàäâãéèëêíìïîóòöôõúùüûñçÁÉÍÓÚÑ]', '', 'g'));
    END IF;
    IF (length(v_norm) >= 4 AND v_norm LIKE '%ez')                                     -- apellido / partícula / razón social → saltar
       OR v_norm = ANY (v_surn) OR v_norm = ANY (v_part) OR v_norm = ANY (v_co) THEN
      v_skipped := true; CONTINUE;
    END IF;
    IF NOT v_skipped THEN                                                              -- token1 "limpio" → es el nombre (regresión-safe)
      RETURN initcap(regexp_replace(v_tok, '[^[:alpha:]áàäâãéèëêíìïîóòöôõúùüûñçÁÉÍÓÚÑ]', '', 'g'));
    END IF;
    IF v_cand IS NULL THEN v_cand := v_tok; END IF;                                    -- apellido-first: recordar y seguir buscando un nombre conocido
  END LOOP;

  RETURN initcap(regexp_replace(COALESCE(v_cand, v_tokens[1]), '[^[:alpha:]áàäâãéèëêíìïîóòöôõúùüûñçÁÉÍÓÚÑ]', '', 'g'));
END;
$$;

COMMENT ON FUNCTION public.prospecto_nombre_pila(text) IS
  'DGG-221/E-GG-225: nombre de pila conservador (maneja padron apellido-first y razones sociales). Estrictamente >= al primer-token; nunca regresiona.';

GRANT EXECUTE ON FUNCTION public.prospecto_nombre_pila(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Cablear el helper en las 2 RPCs del motor (único cambio: la línea v_pila).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prospectos_campana_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_activo boolean; v_pausado boolean; v_cap int;
  v_gracia int := 30;
  v_hoy_count int;
  v_rep_total int; v_rep_bad int; v_rep_rate numeric;
  v_target text; v_p record; v_asunto text; v_vars jsonb; v_dias int; v_pila text;
  v_bondades text[] := ARRAY['captacion-campus','captacion-agenda','captacion-tramites','captacion-capacitaciones'];
BEGIN
  SELECT prospectos_campanas_activo, prospectos_pausado_reputacion, prospectos_cap_diario
    INTO v_activo, v_pausado, v_cap FROM public.config_global LIMIT 1;

  IF NOT COALESCE(v_activo, false) THEN RETURN jsonb_build_object('ok', true, 'accion', 'gated', 'activo', false); END IF;
  IF COALESCE(v_pausado, false) THEN RETURN jsonb_build_object('ok', true, 'accion', 'pausado_reputacion'); END IF;

  SELECT count(*), count(*) FILTER (WHERE estado IN ('bounced','complained'))
    INTO v_rep_total, v_rep_bad
    FROM public.sent_emails
   WHERE template_slug LIKE 'captacion-%' AND enviado_at >= now() - interval '7 days';
  IF v_rep_total >= 20 THEN
    v_rep_rate := v_rep_bad::numeric / v_rep_total;
    IF v_rep_rate > 0.05 THEN
      UPDATE public.config_global
         SET prospectos_pausado_reputacion = true,
             prospectos_pausado_motivo = format('Auto-pausa %s: rebotes/quejas %s/%s (%s%%) en 7d supera el 5%%.',
               v_hoy, v_rep_bad, v_rep_total, round(v_rep_rate*100,1));
      PERFORM public.notify_all_gerentes('prospectos_motor_pausado', 'Motor de captación auto-pausado (reputación)',
        format('Rebotes/quejas: %s de %s envíos (%s%%) en 7 días. El motor se detuvo solo para proteger la entregabilidad. Revisá y reactivá cuando quieras.',
          v_rep_bad, v_rep_total, round(v_rep_rate*100,1)),
        '/gerencia/formularios/prospectos/captacion', '{}'::jsonb, false);
      RETURN jsonb_build_object('ok', true, 'accion', 'freno_reputacion', 'rate', round(v_rep_rate*100,1));
    END IF;
  END IF;

  SELECT count(*) INTO v_hoy_count FROM public.email_queue
   WHERE related_table = 'prospectos' AND (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = v_hoy;
  IF v_hoy_count >= v_cap THEN RETURN jsonb_build_object('ok', true, 'accion', 'cap_alcanzado', 'hoy', v_hoy_count, 'cap', v_cap); END IF;

  v_target := (ARRAY['urgente','vencida','bondad'])[(v_hoy_count % 3) + 1];

  SELECT * INTO v_p FROM (
    WITH elig AS (
      SELECT p.id, p.nombre, p.email, p.matricula_vencimiento,
             public.prospecto_segmento(p.matricula_vencimiento, v_hoy) AS seg
      FROM public.prospectos p
      WHERE p.origen='padron_pba' AND p.convertido_at IS NULL AND p.baja_at IS NULL
        AND p.email NOT LIKE '%@padron.invalid'
        AND NOT public.email_esta_suprimido(p.email)
        AND p.estado_captacion IS DISTINCT FROM 'no_interesado'
        AND NOT EXISTS (SELECT 1 FROM public.administraciones a WHERE a.legajo_rpac = p.legajo)
        AND NOT EXISTS (SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id=p.id AND pm.enviado_at >= (v_hoy - v_gracia)::timestamptz)
        AND NOT EXISTS (SELECT 1 FROM public.email_queue q WHERE q.related_table='prospectos' AND q.related_id=p.id AND q.enviado_at IS NULL AND q.created_at >= (v_hoy - v_gracia)::timestamptz)
    ), nx AS (
      SELECT e.*,
        CASE e.seg WHEN 'curso_reno_30' THEN 'captacion-curso-reno'
                   WHEN 'curso_31_90' THEN 'captacion-curso-3190'
                   WHEN 'vencida' THEN 'captacion-vencida' END AS venc_tpl,
        (SELECT count(*) FROM public.prospecto_mails pm WHERE pm.prospecto_id=e.id) AS n_mails
      FROM elig e
    ), nx2 AS (
      SELECT n.*,
        (n.venc_tpl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id=n.id AND pm.template_slug=n.venc_tpl)) AS venc_pending,
        (SELECT b FROM unnest(v_bondades) b WHERE NOT EXISTS (SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id=n.id AND pm.template_slug=b) LIMIT 1) AS next_bondad
      FROM nx n
    ), fin AS (
      SELECT id, nombre, email, matricula_vencimiento, seg, n_mails,
        CASE WHEN venc_pending THEN venc_tpl ELSE next_bondad END AS tpl,
        CASE WHEN venc_pending THEN (CASE WHEN seg='vencida' THEN 'vencida' ELSE 'urgente' END) ELSE 'bondad' END AS bucket
      FROM nx2 WHERE venc_pending OR next_bondad IS NOT NULL
    )
    SELECT * FROM fin
    WHERE EXISTS (SELECT 1 FROM public.email_templates et WHERE et.slug = fin.tpl AND et.activo)
    ORDER BY (bucket = v_target) DESC,
             CASE bucket WHEN 'urgente' THEN 1 WHEN 'vencida' THEN 2 ELSE 3 END,
             CASE WHEN bucket='urgente' THEN matricula_vencimiento END ASC NULLS LAST,
             CASE WHEN bucket='vencida' THEN matricula_vencimiento END DESC NULLS LAST,
             CASE WHEN bucket='bondad' THEN n_mails END ASC NULLS LAST, id
    LIMIT 1
  ) s;

  IF v_p.id IS NULL THEN RETURN jsonb_build_object('ok', true, 'accion', 'sin_candidatos', 'target', v_target); END IF;

  SELECT asunto INTO v_asunto FROM public.email_templates WHERE slug = v_p.tpl AND activo;
  IF v_asunto IS NULL THEN RETURN jsonb_build_object('ok', false, 'accion', 'template_inactivo', 'tpl', v_p.tpl); END IF;

  v_pila := public.prospecto_nombre_pila(v_p.nombre);
  v_vars := jsonb_build_object('nombre', v_pila);
  IF v_p.matricula_vencimiento IS NOT NULL THEN
    v_dias := GREATEST(0, (v_p.matricula_vencimiento - v_hoy));
    v_vars := v_vars || jsonb_build_object('fecha_vencimiento', to_char(v_p.matricula_vencimiento, 'DD/MM/YYYY'), 'dias_restantes', v_dias::text);
  END IF;

  INSERT INTO public.email_queue
    (kind, template_slug, to_email, to_nombre, variables, prioridad, programado_para, scheduled_at,
     related_table, related_id, subject, comprobante_ids, parte, partes_total)
  VALUES
    ('workflow', v_p.tpl, lower(trim(v_p.email)), initcap(v_p.nombre), v_vars, 8, now(), now(),
     'prospectos', v_p.id, v_asunto, '{}', 1, 1);

  RETURN jsonb_build_object('ok', true, 'accion', 'encolado', 'tpl', v_p.tpl,
    'bucket', v_p.bucket, 'target', v_target, 'prospecto', v_p.id, 'hoy', v_hoy_count + 1, 'cap', v_cap);
END $function$;

CREATE OR REPLACE FUNCTION public.prospectos_enviar_campana(p_template_slug text, p_segmento text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_forzar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_gracia int := 30; v_cooldown int := 90;
  v_lim int := LEAST(GREATEST(COALESCE(p_limite, 50), 1), 200);
  v_asunto text; v_toques int := 0; v_p record; v_vars jsonb; v_dias int; v_pila text;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT (SELECT COALESCE(prospectos_campanas_activo, false) FROM public.config_global LIMIT 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'motor_desactivado', 'gated', true, 'encolados', 0);
  END IF;
  IF (SELECT COALESCE(prospectos_pausado_reputacion, false) FROM public.config_global LIMIT 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'motor_pausado', 'pausado', true, 'encolados', 0);
  END IF;
  IF p_template_slug IN ('captacion-curso-3190','captacion-curso-reno','captacion-vencida')
     AND COALESCE(p_segmento,'') NOT IN ('vencida','curso_reno_30','curso_31_90') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'template_de_vencimiento_requiere_segmento');
  END IF;
  SELECT asunto INTO v_asunto FROM public.email_templates WHERE slug = p_template_slug AND activo;
  IF v_asunto IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'template_inexistente'); END IF;

  FOR v_p IN
    SELECT p.id, p.nombre, p.email, p.matricula_vencimiento
    FROM public.prospectos p
    WHERE p.origen = 'padron_pba'
      AND p.convertido_at IS NULL AND p.baja_at IS NULL
      AND p.email NOT LIKE '%@padron.invalid'
      AND p.estado_captacion IS DISTINCT FROM 'no_interesado'
      AND NOT EXISTS (SELECT 1 FROM public.administraciones a WHERE a.legajo_rpac = p.legajo)
      AND (p_segmento IS NULL OR public.prospecto_segmento(p.matricula_vencimiento, v_hoy) = p_segmento)
    ORDER BY p.matricula_vencimiento ASC NULLS LAST
  LOOP
    EXIT WHEN v_toques >= v_lim;
    CONTINUE WHEN public.email_esta_suprimido(v_p.email);
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.prospecto_mails pm
                           WHERE pm.prospecto_id = v_p.id AND pm.enviado_at >= (v_hoy - v_gracia)::timestamptz)
             OR EXISTS (SELECT 1 FROM public.email_queue q
                         WHERE q.related_table = 'prospectos' AND q.related_id = v_p.id
                           AND q.enviado_at IS NULL AND q.created_at >= (v_hoy - v_gracia)::timestamptz);
    CONTINUE WHEN NOT p_forzar AND EXISTS (SELECT 1 FROM public.prospecto_mails pm
                           WHERE pm.prospecto_id = v_p.id AND pm.template_slug = p_template_slug
                             AND pm.enviado_at >= (v_hoy - v_cooldown)::timestamptz);
    v_dias := CASE WHEN v_p.matricula_vencimiento IS NOT NULL THEN GREATEST(0, (v_p.matricula_vencimiento - v_hoy)) END;
    v_pila := public.prospecto_nombre_pila(v_p.nombre);
    v_vars := jsonb_build_object('nombre', v_pila);
    IF v_p.matricula_vencimiento IS NOT NULL THEN
      v_vars := v_vars || jsonb_build_object('fecha_vencimiento', to_char(v_p.matricula_vencimiento,'DD/MM/YYYY'), 'dias_restantes', v_dias::text);
    END IF;
    INSERT INTO public.email_queue
      (kind, template_slug, to_email, to_nombre, variables, prioridad, programado_para, scheduled_at,
       related_table, related_id, subject, comprobante_ids, parte, partes_total)
    VALUES
      ('workflow', p_template_slug, lower(trim(v_p.email)), initcap(v_p.nombre), v_vars, 8, now(), now(),
       'prospectos', v_p.id, v_asunto, '{}', 1, 1);
    v_toques := v_toques + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'encolados', v_toques, 'template', p_template_slug, 'segmento', p_segmento, 'forzado', p_forzar);
END $function$;
