-- 0597_dgg228_cierre_reloj_desde_resuelto.sql
-- DGG-228 · El agente de cierre cuenta los días de espera desde que el trámite
-- pasó a RESUELTO (resuelto_at), no desde que se creó (created_at).
--
-- Problema (Pablo): el detector seleccionaba candidatos con
-- `estado='resuelto' AND (now() - created_at) > 25 días`. Un trámite creado hace
-- 42 días pero RESUELTO hace sólo 4 (caso Ayastuy TRM-2026-00139) entraba al
-- radar aunque TRAMIX razonablemente todavía no tiene la novedad. El reloj debe
-- arrancar en la resolución, no en la creación.
--
-- Fix quirúrgico (no altera el resto del agente "delicioso"):
--  1) Umbral de candidatura: created_at → COALESCE(resuelto_at, created_at).
--     resuelto_at ya existe (col de tramites, la setea tramite_on_update en la
--     transición, se limpia al reabrir) y está 100% poblado en los resueltos.
--  2) Umbral PARAMETRIZABLE: config_global.agente_cierre_dias (default 25), para
--     tunear la espera sin migrar (decisión de Pablo).
--  3) Se expone dias_resuelto en el output (además de dias_abierto) → el reporte
--     muestra "abierto Xd · resuelto hace Yd".
--  4) La ventana de matching del ACUSE TRAMIX (E-GG-231) SIGUE anclada a
--     created_at — a propósito: el expediente se inicia cuando se PRESENTA el
--     trámite, no cuando lo resolvemos; anclarla a resuelto_at reintroduciría el
--     cruce de ciclos. SÓLO cambia el reloj de candidatura.
--
-- Efecto: más conservador (espera más, nunca menos). Beneficio lateral: el
-- planner deja de encolar scrapes TRAMIX de trámites recién resueltos.
-- Reglas: R16 (CREATE OR REPLACE, firmas idénticas), R18 (smoke e2e en el cierre).

-- ───────────────────────────────────────────────────────────────────────────
-- A) Umbral parametrizable
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.config_global
  ADD COLUMN IF NOT EXISTS agente_cierre_dias int NOT NULL DEFAULT 25;

COMMENT ON COLUMN public.config_global.agente_cierre_dias IS
  'DGG-228: días que el agente de cierre espera DESDE resuelto_at antes de relevar un trámite (default 25).';

-- ───────────────────────────────────────────────────────────────────────────
-- B) Detector — reloj desde resuelto_at + dias_resuelto expuesto
--    (verbatim de 0589 salvo: cand.resuelto_at/dias_resuelto, el WHERE, y el
--     campo 'dias_resuelto' del jsonb final; la ventana de acuse NO cambia.)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.agente_cierre_detectar()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH cand AS (
  SELECT t.id AS tramite_id, t.categoria, t.servicio_id, sv.codigo AS servicio_codigo,
         t.administracion_id, t.comprobante_id, t.created_at, t.resuelto_at,
         (now()::date - t.created_at::date) AS dias_abierto,
         (now()::date - COALESCE(t.resuelto_at, t.created_at)::date) AS dias_resuelto,
         sv.nombre AS servicio, a.nombre AS cliente, a.legajo_rpac AS legajo, a.matricula_rpac AS matricula,
         a.matricula_rpac_vencimiento AS venc_ficha,
         CASE WHEN t.categoria='consulta_juridica' THEN 'juridica'
              WHEN t.categoria='curso' THEN 'curso'
              ELSE 'principal' END AS track,
         public.cobro_pendiente(t) AS impago,
         (EXISTS (SELECT 1 FROM public.servicios s2 WHERE s2.id=t.servicio_id
                    AND GREATEST(COALESCE(s2.precio_publico,0),COALESCE(s2.precio_cliente,0),COALESCE(s2.precio_base,0))>0)
          AND NOT EXISTS (SELECT 1 FROM public.comprobantes c WHERE c.estado<>'anulado'
                    AND (c.id=t.comprobante_id OR c.id IN (SELECT so.comprobante_id FROM public.solicitudes so
                                      WHERE so.tramite_id=t.id AND so.comprobante_id IS NOT NULL)))) AS arancelado_sin_comp,
         (t.categoria IN ('matricula','renovacion') AND NOT (NULLIF(btrim(a.matricula_rpac),'') IS NOT NULL
                   AND NULLIF(btrim(a.legajo_rpac),'') IS NOT NULL)) AS sin_otorg,
         CASE sv.codigo WHEN 'rpac_inscripcion' THEN 'ADMINISTRADOR DE CONSORCIOS'
           WHEN 'rpac_inscripcion_juridica' THEN 'ADMINISTRADOR DE CONSORCIOS'
           WHEN 'rpac_renovacion' THEN 'RENOVACION DE MATRICULA'
           WHEN 'rpac_certificado' THEN 'CERTIFICADO DE ACREDITACION' ELSE NULL END AS exp_esperado,
         CASE sv.codigo WHEN 'rpac_certificado' THEN 'NOTIFICADO OFICIOS' WHEN 'rpac_inscripcion' THEN 'INSCRIPTO'
           WHEN 'rpac_inscripcion_juridica' THEN 'INSCRIPTO' WHEN 'rpac_renovacion' THEN 'INSCRIPTO' ELSE NULL END AS estado_ok,
         CASE WHEN sv.codigo='rpac_certificado' THEN 25 ELSE 300 END AS acuse_cap_dias,
         (t.categoria='curso' AND EXISTS (
            SELECT 1 FROM public.curso_matriculas cm JOIN public.certificados cert ON cert.matricula_id=cm.id
            WHERE cm.tramite_id=t.id AND cm.estado='completada' AND cert.revocado_at IS NULL
              AND ((cert.descargado_alumno_at IS NOT NULL AND now()-cert.descargado_alumno_at > interval '30 days')
                   OR (cert.descargado_alumno_at IS NULL AND cert.emitido_at IS NOT NULL AND now()-cert.emitido_at > interval '30 days'))
         )) AS curso_cerrable,
         (t.categoria='curso' AND EXISTS (SELECT 1 FROM public.curso_matriculas cm WHERE cm.tramite_id=t.id AND cm.estado='completada')) AS curso_egresado,
         (t.categoria='consulta_juridica' AND EXISTS (
            SELECT 1 FROM public.tracking_lineas tl
            WHERE tl.tramite_id=t.id AND tl.visible_cliente=true AND tl.categoria='gestor_avance'
         )) AS juridica_respondida
  FROM public.tramites t JOIN public.administraciones a ON a.id = t.administracion_id
  LEFT JOIN public.servicios sv ON sv.id = t.servicio_id
  WHERE t.estado = 'resuelto'
    AND (now() - COALESCE(t.resuelto_at, t.created_at))
        > (COALESCE((SELECT agente_cierre_dias FROM public.config_global LIMIT 1), 25) * interval '1 day')
    AND (t.categoria <> 'curso' OR sv.codigo IN ('curso_actualizacion_rpac','curso_formacion_rpac'))
),
tx AS (
  SELECT c.tramite_id, (tc.legajo IS NOT NULL) AS tiene_cache, tc.consultado_at,
    (SELECT jsonb_build_object('estado', e->>'estado', 'tramite', e->>'tramite', 'fecha', e->>'fecha', 'numero', e->>'numero')
       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(tc.payload->'expedientes')='array' THEN tc.payload->'expedientes' ELSE '[]'::jsonb END) e
      WHERE c.exp_esperado IS NOT NULL AND e->>'tramite' = c.exp_esperado
        AND private.tramix_fecha(e->>'fecha') IS NOT NULL
        AND private.tramix_fecha(e->>'fecha') BETWEEN (c.created_at::date - 7)
            AND LEAST(now()::date + 7, c.created_at::date + c.acuse_cap_dias)
      ORDER BY abs(private.tramix_fecha(e->>'fecha') - c.created_at::date) ASC,
               private.tramix_fecha(e->>'fecha') DESC NULLS LAST, (e->>'numero') DESC NULLS LAST
      LIMIT 1) AS ult
  FROM cand c
  LEFT JOIN public.tramix_cache tc
    ON tc.legajo = regexp_replace(COALESCE(c.legajo,''), '[^0-9]', '', 'g') AND c.track='principal'
),
ev AS (
  SELECT c.*, x.tiene_cache, x.consultado_at, x.ult, (x.ult->>'estado' = c.estado_ok) AS estado_confirma,
    (x.consultado_at IS NOT NULL
       AND x.consultado_at >= (date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires')) AS fresco,
    (x.ult IS NOT NULL) AS anclado
  FROM cand c JOIN tx x ON x.tramite_id=c.tramite_id
),
evw AS (
  SELECT ev.*,
    (exp_esperado IS NOT NULL AND (ult->>'numero') IS NOT NULL
     AND count(*) FILTER (WHERE track='principal' AND (ult->>'numero') IS NOT NULL)
         OVER (PARTITION BY regexp_replace(COALESCE(legajo,''), '[^0-9]', '', 'g'), exp_esperado, (ult->>'numero')) > 1) AS ambiguo_multi
  FROM ev
),
dec AS (
  SELECT evw.*,
    (NOT(impago OR arancelado_sin_comp OR sin_otorg) AND (
       (track='principal' AND exp_esperado IS NOT NULL AND NOT ambiguo_multi AND tiene_cache AND estado_confirma AND fresco)
       OR (track='juridica' AND juridica_respondida)
       OR (track='curso' AND curso_cerrable)
    )) AS es_cerrable,
    (track='curso' AND NOT curso_cerrable) AS curso_no_listo
  FROM evw
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'tramite_id', tramite_id, 'track', track, 'categoria', categoria, 'servicio', servicio,
  'servicio_codigo', servicio_codigo, 'cliente', cliente, 'administracion_id', administracion_id,
  'legajo', legajo, 'matricula', matricula, 'venc_ficha', venc_ficha,
  'dias_abierto', dias_abierto, 'dias_resuelto', dias_resuelto,
  'curso_estado', CASE WHEN track='curso' AND NOT curso_egresado THEN 'cursando'
                       WHEN track='curso' AND NOT curso_cerrable THEN 'espera_cert'
                       ELSE NULL END,
  'bloqueos', CASE WHEN curso_no_listo THEN '[]'::jsonb ELSE
    ((CASE WHEN impago THEN jsonb_build_array('impago') ELSE '[]'::jsonb END)
     || (CASE WHEN arancelado_sin_comp THEN jsonb_build_array('arancelado_sin_comprobante') ELSE '[]'::jsonb END)
     || (CASE WHEN sin_otorg THEN jsonb_build_array('sin_otorgamiento') ELSE '[]'::jsonb END)) END,
  'tramix', CASE WHEN track<>'principal' THEN jsonb_build_object('estado','n/a')
                 WHEN exp_esperado IS NULL THEN jsonb_build_object('estado','servicio_no_mapeado')
                 WHEN NOT tiene_cache THEN jsonb_build_object('estado','sin_cache')
                 WHEN ult IS NULL THEN jsonb_build_object('estado','sin_expediente')
                 ELSE ult || jsonb_build_object('fresco',fresco) END,
  'decision', CASE WHEN es_cerrable THEN 'cerrar_limpio'
     WHEN curso_no_listo THEN 'reportar_revision'
     WHEN impago OR arancelado_sin_comp OR sin_otorg THEN 'reportar_bloqueo'
     ELSE 'reportar_revision' END,
  'cierre', CASE WHEN es_cerrable THEN CASE track
      WHEN 'juridica' THEN jsonb_build_object('satisfactorio', true, 'motivo', 'Consulta jurídica resuelta',
        'observaciones', 'Tu consulta jurídica fue resuelta: nuestro Equipo de Consultoría Jurídica te envió la respuesta (podés verla en el detalle de este trámite, dentro de tu portal). Quedamos a disposición para lo que necesites. ¡Gracias por confiar en Gestión Global!')
      WHEN 'curso' THEN jsonb_build_object('satisfactorio', true, 'motivo', 'Curso finalizado',
        'observaciones', 'Creemos que la jerarquización de la profesión va de la mano de la capacitación y la excelencia académica. Estamos muy contentos de que hayas cursado con nosotros. Esperamos que hayas disfrutado el contenido y quedamos a tu disposición para seguir trabajando codo a codo. ¡Gracias por confiar en Gestión Global!')
      ELSE jsonb_build_object('satisfactorio', true,
        'motivo', CASE servicio_codigo WHEN 'rpac_certificado' THEN 'Certificado de acreditación emitido'
                                       WHEN 'rpac_renovacion' THEN 'Matrícula renovada' ELSE 'Matrícula otorgada' END,
        'observaciones', 'Verificamos en la Mesa de Entradas (RPAC · Pcia. de Bs. As.) que tu '||
          CASE servicio_codigo WHEN 'rpac_certificado' THEN 'Certificado de Acreditación fue EMITIDO'
                               WHEN 'rpac_renovacion' THEN 'renovación de matrícula fue OTORGADA'
                               ELSE 'matrícula fue OTORGADA' END ||
          ' el '||COALESCE(ult->>'fecha','')||'. El RPAC te lo notifica por correo a tu casilla declarada; '||
          'además podés consultarlo desde nuestro acceso a la Mesa de Entradas, en tu portal. '||
          '¡Gracias por confiar en Gestión Global! Quedamos a disposición para seguir trabajando juntos.')
      END ELSE NULL END,
  'motivo', (CASE
     WHEN es_cerrable AND track='juridica' THEN 'Resuelto + respuesta del Equipo de Consultoría Jurídica visible en el portal → cerrable'
     WHEN es_cerrable AND track='curso' THEN 'Egresó + certificado disponible hace +30 días → cerrable'
     WHEN es_cerrable THEN 'TRAMIX confirma '||exp_esperado||' = '||estado_ok||' (exp. '||COALESCE(ult->>'numero','?')||') → cerrable'
     WHEN track='curso' AND NOT curso_egresado THEN 'Curso aún no egresado (matrícula no completada) — en marcha'
     WHEN track='curso' AND NOT curso_cerrable THEN 'Egresó pero el certificado es reciente (<30 días) o fue revocado — esperar/revisar'
     WHEN impago THEN 'Cobro pendiente (impago/parcial)'
     WHEN arancelado_sin_comp THEN 'Servicio arancelado sin comprobante emitido'
     WHEN sin_otorg THEN 'Falta matrícula+legajo RPAC en la ficha (cargar otorgamiento)'
     WHEN track='juridica' AND NOT juridica_respondida THEN 'Resuelto pero sin respuesta visible al cliente en el tracking — revisar antes de cerrar'
     WHEN track='principal' AND ambiguo_multi THEN '2+ trámites del mismo tipo mapean al MISMO expediente de TRAMIX ('||COALESCE(ult->>'numero','?')||') — cerrar a mano para no cruzar expedientes'
     WHEN track='principal' AND exp_esperado IS NULL THEN 'Servicio sin regla TRAMIX definida — revisar manual'
     WHEN track='principal' AND NOT tiene_cache THEN 'Sin verificación TRAMIX (falta scrapear el legajo)'
     WHEN track='principal' AND ult IS NULL THEN 'TRAMIX sin expediente de '||exp_esperado||' en la ventana del trámite — revisar (puede ser de otro ciclo o aún no emitido)'
     WHEN track='principal' AND NOT estado_confirma AND ult->>'estado'='OBSERVADO' THEN 'TRAMIX: '||exp_esperado||' OBSERVADO — revisar'
     WHEN track='principal' AND NOT estado_confirma THEN 'TRAMIX: '||exp_esperado||' en estado "'||(ult->>'estado')||'" (no terminal) — revisar'
     WHEN track='principal' AND NOT fresco THEN 'Verificación TRAMIX vencida (hay que re-scrapear el legajo hoy)'
     ELSE 'Revisar' END)
   || CASE WHEN track='curso' AND curso_cerrable AND (impago OR arancelado_sin_comp)
           THEN ' · el curso ya egresó y tiene certificado +30 días (sólo falta resolver el bloqueo para cerrar)'
           ELSE '' END
) ORDER BY (CASE WHEN es_cerrable THEN 0 WHEN curso_no_listo THEN 1 WHEN impago OR arancelado_sin_comp OR sin_otorg THEN 2 ELSE 1 END), track, cliente), '[]'::jsonb)
FROM dec;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- C) Reporte — muestra "abierto Xd · resuelto hace Yd" + umbral dinámico.
--    (verbatim salvo: v_dias, el SELECT del config, el header de "Detectados",
--     y el format() del detalle por ítem.)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.agente_cierre_correr(p_origen text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_items jsonb; v_total int; v_limpios int; v_bloqueos int; v_revision int;
  v_resumen jsonb; v_run_id uuid; v_modo text; v_activo boolean; v_cap int; v_dias int;
  v_cerrados int := 0; v_errores jsonb := '[]'::jsonb; v_it jsonb; v_err_txt text;
  v_hoy text := to_char((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, 'DD/MM/YYYY');
  v_lista text; v_cuerpo text; v_titulo text;
  v_tp int; v_tj int; v_tc int; v_lp int; v_lj int; v_lc int;
  v_rp int; v_rj int; v_rc int; v_bp int; v_bj int; v_bc int;
  v_cur_espera int; v_cur_cursando int;
  v_cerrados_p int := 0; v_cerrados_j int := 0; v_cerrados_c int := 0;
BEGIN
  IF NOT (private.is_staff() OR (auth.uid() IS NULL AND COALESCE(auth.role(),'') <> 'anon')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.skip_admin_assert', 'on', true);

  SELECT COALESCE(agente_cierre_activo,false), COALESCE(agente_cierre_cap,25), COALESCE(agente_cierre_dias,25)
    INTO v_activo, v_cap, v_dias FROM public.config_global LIMIT 1;
  v_modo := CASE WHEN v_activo THEN 'real' ELSE 'seco' END;

  v_items := private.agente_cierre_detectar();
  v_total := jsonb_array_length(v_items);
  SELECT count(*) FILTER (WHERE it->>'decision'='cerrar_limpio'),
         count(*) FILTER (WHERE it->>'decision'='reportar_bloqueo'),
         count(*) FILTER (WHERE it->>'decision'='reportar_revision')
    INTO v_limpios, v_bloqueos, v_revision FROM jsonb_array_elements(v_items) it;

  SELECT count(*) FILTER (WHERE it->>'track'='principal'),
         count(*) FILTER (WHERE it->>'track'='juridica'),
         count(*) FILTER (WHERE it->>'track'='curso'),
         count(*) FILTER (WHERE it->>'track'='principal' AND it->>'decision'='cerrar_limpio'),
         count(*) FILTER (WHERE it->>'track'='juridica'  AND it->>'decision'='cerrar_limpio'),
         count(*) FILTER (WHERE it->>'track'='curso'     AND it->>'decision'='cerrar_limpio'),
         count(*) FILTER (WHERE it->>'track'='principal' AND it->>'decision'='reportar_revision'),
         count(*) FILTER (WHERE it->>'track'='juridica'  AND it->>'decision'='reportar_revision'),
         count(*) FILTER (WHERE it->>'track'='curso'     AND it->>'decision'='reportar_revision'),
         count(*) FILTER (WHERE it->>'track'='principal' AND it->>'decision'='reportar_bloqueo'),
         count(*) FILTER (WHERE it->>'track'='juridica'  AND it->>'decision'='reportar_bloqueo'),
         count(*) FILTER (WHERE it->>'track'='curso'     AND it->>'decision'='reportar_bloqueo'),
         count(*) FILTER (WHERE it->>'curso_estado'='espera_cert'),
         count(*) FILTER (WHERE it->>'curso_estado'='cursando')
    INTO v_tp,v_tj,v_tc, v_lp,v_lj,v_lc, v_rp,v_rj,v_rc, v_bp,v_bj,v_bc, v_cur_espera, v_cur_cursando
    FROM jsonb_array_elements(v_items) it;

  IF v_modo = 'real' THEN
    FOR v_it IN SELECT e FROM jsonb_array_elements(v_items) e WHERE e->>'decision'='cerrar_limpio' LOOP
      EXIT WHEN v_cerrados >= v_cap;
      BEGIN
        PERFORM public.tracking_cerrar_auto(
          (v_it->>'tramite_id')::uuid, v_it->'cierre'->>'motivo',
          (v_it->'cierre'->>'satisfactorio')::boolean, v_it->'cierre'->>'observaciones');
        v_cerrados := v_cerrados + 1;
        IF    (v_it->>'track')='principal' THEN v_cerrados_p := v_cerrados_p + 1;
        ELSIF (v_it->>'track')='juridica'  THEN v_cerrados_j := v_cerrados_j + 1;
        ELSIF (v_it->>'track')='curso'     THEN v_cerrados_c := v_cerrados_c + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_err_txt := SQLERRM;
        v_errores := v_errores || jsonb_build_object('cliente', v_it->>'cliente',
                      'tramite_id', v_it->>'tramite_id', 'error', v_err_txt);
      END;
    END LOOP;
  END IF;

  v_resumen := jsonb_build_object('total', v_total, 'cerrar_limpio', v_limpios,
     'reportar_revision', v_revision, 'reportar_bloqueo', v_bloqueos, 'modo', v_modo,
     'cerrados', v_cerrados, 'errores_cierre', jsonb_array_length(v_errores), 'cap', v_cap, 'dias', v_dias,
     'por_track', jsonb_build_object(
        'principal', jsonb_build_object('total',v_tp,'limpios',v_lp,'revision',v_rp,'bloqueos',v_bp,'cerrados',v_cerrados_p),
        'juridica',  jsonb_build_object('total',v_tj,'limpios',v_lj,'revision',v_rj,'bloqueos',v_bj,'cerrados',v_cerrados_j),
        'curso',     jsonb_build_object('total',v_tc,'limpios',v_lc,'revision',v_rc,'bloqueos',v_bc,'cerrados',v_cerrados_c,
                                        'espera_cert',v_cur_espera,'cursando',v_cur_cursando)));

  INSERT INTO public.agente_cierre_runs (origen, modo, overall, resumen, items)
  VALUES (p_origen, v_modo, CASE WHEN v_total=0 THEN 'sin_candidatos' ELSE 'ok' END,
          v_resumen || jsonb_build_object('errores_detalle', v_errores), v_items)
  RETURNING id INTO v_run_id;

  IF v_total > 0 OR p_origen <> 'cron' THEN
    SELECT string_agg(format('%s %s — %s (%s) · %s · abierto %sd / resuelto hace %sd',
             CASE e->>'decision' WHEN 'cerrar_limpio' THEN (CASE WHEN v_modo='real' THEN '✓ CERRADO:' ELSE '✓ cerraría:' END)
                                 WHEN 'reportar_bloqueo' THEN '⛔ bloqueado:' ELSE '🔎 a revisar:' END,
             e->>'cliente', initcap(e->>'categoria'), COALESCE(e->>'servicio','—'),
             CASE e->>'decision' WHEN 'cerrar_limpio' THEN COALESCE(e->'cierre'->>'motivo', e->>'motivo') ELSE e->>'motivo' END,
             e->>'dias_abierto', e->>'dias_resuelto'),
             E'\n' ORDER BY e->>'decision', e->>'track', e->>'cliente')
      INTO v_lista FROM jsonb_array_elements(v_items) e
      WHERE NOT (e->>'track'='curso' AND e->>'decision'='reportar_revision');

    v_titulo := CASE WHEN v_modo='real' THEN 'Resumen de agentes · Cierre de trámites'
                     ELSE 'Resumen de agentes · Cierre de trámites (SIMULACIÓN)' END;
    v_cuerpo :=
      CASE WHEN v_modo='real' THEN 'Equipo de cierre de trámites · ' || v_hoy || E'\n' ||
             'Cerré ' || v_cerrados || ' trámite(s) y avisé a sus clientes.'
           ELSE 'SIMULACIÓN — equipo de cierre de trámites · ' || v_hoy || E'\n' ||
             '(No cerré nada ni escribí a ningún cliente.)' END || E'\n\n' ||
      'Detectados (resueltos hace +' || v_dias || ' días): ' || v_total || ' en 3 tracks.' || E'\n' ||
      '• Principal (matrícula/renovación/certificado, con verificación TRAMIX): ' || v_tp ||
        '  →  ' || (CASE WHEN v_modo='real' THEN 'cerré ' || v_cerrados_p ELSE 'limpios ' || v_lp END) ||
        ' · a revisar ' || v_rp || ' · bloqueados ' || v_bp || E'\n' ||
      '• Jurídica (consultas resueltas, con respuesta visible al cliente): ' || v_tj ||
        '  →  ' || (CASE WHEN v_modo='real' THEN 'cerré ' || v_cerrados_j ELSE 'limpios ' || v_lj END) ||
        ' · a revisar ' || v_rj || ' · bloqueados ' || v_bj || E'\n' ||
      '• Cursos (RPAC/PBA, egresado + certificado +30 días): ' || v_tc ||
        '  →  ' || (CASE WHEN v_modo='real' THEN 'cerré ' || v_cerrados_c ELSE 'limpios ' || v_lc END) ||
        ' · en marcha ' || v_rc || ' · bloqueados ' || v_bc || E'\n\n' ||
      CASE WHEN v_modo='real'
        THEN 'Cerrados efectivamente: ' || v_cerrados || ' de ' || v_limpios || ' limpios (tope por corrida: ' || v_cap || ')' ||
             (CASE WHEN jsonb_array_length(v_errores)>0 THEN ' · No se pudo cerrar: '||jsonb_array_length(v_errores) ELSE '' END) || E'\n'
        ELSE 'Total limpios que cerraría al activar: ' || v_limpios || E'\n' END ||
      'A revisar (te quedan a vos): ' || (v_revision - v_rc) || '  ·  Total bloqueados (amortiguador, no se fuerzan): ' || v_bloqueos || E'\n\n' ||
      'Detalle (accionable):' || E'\n' || COALESCE(v_lista, '(sin ítems accionables)') ||
      CASE WHEN v_tc > v_lc + v_bc
        THEN E'\n• Cursos en marcha (no requieren acción): ' || (v_cur_espera + v_cur_cursando) ||
             ' — ' || v_cur_espera || ' egresados esperando que el certificado cumpla 30 días · ' ||
             v_cur_cursando || ' aún cursando.'
        ELSE '' END ||
      CASE WHEN jsonb_array_length(v_errores)>0
        THEN E'\n\n⚠ No se pudieron cerrar (los dejo para revisión):\n' ||
             (SELECT string_agg('• '||(x->>'cliente')||': '||(x->>'error'), E'\n') FROM jsonb_array_elements(v_errores) x)
        ELSE '' END || E'\n\n' ||
      CASE WHEN v_modo='real' THEN 'Los bloqueados y los "a revisar" quedan para vos.'
           ELSE 'Cuando valides, habilito el cierre automático de los limpios. Los bloqueados y "a revisar" siempre quedan para vos.' END;

    INSERT INTO public.email_queue (kind, template_slug, to_email, to_nombre, variables,
                                    prioridad, intento, max_intentos, programado_para)
    VALUES ('workflow', 'gerencia-notif-generica', 'pabloeacu@gmail.com', 'Pablo',
            jsonb_build_object('titulo_evento', v_titulo, 'url', '/gerencia/tramites', 'cuerpo', v_cuerpo),
            3, 0, 3, now());
  END IF;

  RETURN jsonb_build_object('ok', true, 'run_id', v_run_id, 'resumen', v_resumen);
END;
$function$;
