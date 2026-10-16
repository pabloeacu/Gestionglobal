-- 0586 · DGG-225 · Detector del cierre: frescura POR INTENTO + normalización + guard multi-trámite
--
-- Tres cambios aditivos en private.agente_cierre_detectar (misma firma, R16 OK), que
-- habilitan el rediseño de re-scrapeo encolado (migs 0585 + edge tramix-cierre-scrape):
--
-- (a) FRESCURA POR INTENTO (requisito de Pablo): antes `fresco = consultado_at >=
--     tramite.created_at` (sólo "scrapeado después de abrir el trámite", sin cota de
--     recencia) → podía cerrar sobre cache de hace semanas. Ahora `fresco = consultado_at
--     >= medianoche de HOY (hora Argentina)`: sólo cierra lo que se re-scrapeó ESTA
--     mañana. Cualquier legajo no refrescado hoy (breaker/not-found/flag/cola no drenada)
--     cae a 'reportar_revision' y reintenta mañana. Imposible cerrar con cache añeja.
--
-- (b) NORMALIZACIÓN DEL JOIN DE LEGAJO: tramix_cache.legajo siempre está normalizado a
--     dígitos (lo escriben tramix-consulta y la nueva edge con replace(/[^0-9]/g)), pero
--     el detector joinaba contra a.legajo_rpac CRUDO → si un legajo trae guiones/espacios,
--     el join fallaba aun con cache fresca. Se normaliza el lado del detector.
--
-- (c) GUARD MULTI-TRÁMITE MISMO TIPO (correctitud): si un legajo tiene 2+ candidatos
--     principales abiertos del MISMO servicio/exp_esperado (caso real: Calvento 277078,
--     2 certificados simultáneos), el matching "expediente más reciente de exp_esperado"
--     NO empareja 1:1 → cerrarían ambos citando el mismo expediente (falso positivo).
--     Esos casos NO se auto-cierran: van a 'reportar_revision' para cierre manual. Un
--     solo scrape sigue sirviendo a todos sus trámites; sólo se inhibe el auto-cierre.
--
-- es_cerrable para juridica/curso, curso_no_listo, curso_estado, impago, arancelado,
-- sin_otorg, bloqueos, decision y el resto quedan EXACTAMENTE igual.

CREATE OR REPLACE FUNCTION private.agente_cierre_detectar()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH cand AS (
  SELECT t.id AS tramite_id, t.categoria, t.servicio_id, sv.codigo AS servicio_codigo,
         t.administracion_id, t.comprobante_id, t.created_at, (now()::date - t.created_at::date) AS dias_abierto,
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
  WHERE t.estado = 'resuelto' AND (now() - t.created_at) > interval '25 days'
    AND (t.categoria <> 'curso' OR sv.codigo IN ('curso_actualizacion_rpac','curso_formacion_rpac'))
),
tx AS (
  SELECT c.tramite_id, (tc.legajo IS NOT NULL) AS tiene_cache, tc.consultado_at,
    (SELECT jsonb_build_object('estado', e->>'estado', 'tramite', e->>'tramite', 'fecha', e->>'fecha', 'numero', e->>'numero')
       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(tc.payload->'expedientes')='array' THEN tc.payload->'expedientes' ELSE '[]'::jsonb END) e
      WHERE c.exp_esperado IS NOT NULL AND e->>'tramite' = c.exp_esperado
      ORDER BY private.tramix_fecha(e->>'fecha') DESC NULLS LAST, (e->>'numero') DESC NULLS LAST LIMIT 1) AS ult
  FROM cand c
  LEFT JOIN public.tramix_cache tc
    ON tc.legajo = regexp_replace(COALESCE(c.legajo,''), '[^0-9]', '', 'g') AND c.track='principal'
),
ev AS (
  SELECT c.*, x.tiene_cache, x.consultado_at, x.ult, (x.ult->>'estado' = c.estado_ok) AS estado_confirma,
    (x.consultado_at IS NOT NULL
       AND x.consultado_at >= (date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires')) AS fresco,
    (private.tramix_fecha(x.ult->>'fecha') IS NOT NULL
       AND private.tramix_fecha(x.ult->>'fecha') BETWEEN (c.created_at::date - 7) AND (now()::date + 7)) AS anclado
  FROM cand c JOIN tx x ON x.tramite_id=c.tramite_id
),
evw AS (
  SELECT ev.*,
    (exp_esperado IS NOT NULL
     AND count(*) FILTER (WHERE track='principal' AND exp_esperado IS NOT NULL)
         OVER (PARTITION BY regexp_replace(COALESCE(legajo,''), '[^0-9]', '', 'g'), exp_esperado) > 1) AS ambiguo_multi
  FROM ev
),
dec AS (
  SELECT evw.*,
    (NOT(impago OR arancelado_sin_comp OR sin_otorg) AND (
       (track='principal' AND exp_esperado IS NOT NULL AND NOT ambiguo_multi AND tiene_cache AND estado_confirma AND fresco AND anclado)
       OR (track='juridica' AND juridica_respondida)
       OR (track='curso' AND curso_cerrable)
    )) AS es_cerrable,
    (track='curso' AND NOT curso_cerrable) AS curso_no_listo
  FROM evw
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'tramite_id', tramite_id, 'track', track, 'categoria', categoria, 'servicio', servicio,
  'servicio_codigo', servicio_codigo, 'cliente', cliente, 'administracion_id', administracion_id,
  'legajo', legajo, 'matricula', matricula, 'venc_ficha', venc_ficha, 'dias_abierto', dias_abierto,
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
                 ELSE ult || jsonb_build_object('fresco',fresco,'anclado',anclado) END,
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
     WHEN es_cerrable THEN 'TRAMIX confirma '||exp_esperado||' = '||estado_ok||' → cerrable'
     WHEN track='curso' AND NOT curso_egresado THEN 'Curso aún no egresado (matrícula no completada) — en marcha'
     WHEN track='curso' AND NOT curso_cerrable THEN 'Egresó pero el certificado es reciente (<30 días) o fue revocado — esperar/revisar'
     WHEN impago THEN 'Cobro pendiente (impago/parcial)'
     WHEN arancelado_sin_comp THEN 'Servicio arancelado sin comprobante emitido'
     WHEN sin_otorg THEN 'Falta matrícula+legajo RPAC en la ficha (cargar otorgamiento)'
     WHEN track='juridica' AND NOT juridica_respondida THEN 'Resuelto pero sin respuesta visible al cliente en el tracking — revisar antes de cerrar'
     WHEN track='principal' AND ambiguo_multi THEN 'Hay 2+ trámites del mismo tipo abiertos en este legajo — cerrar a mano para no cruzar expedientes'
     WHEN track='principal' AND exp_esperado IS NULL THEN 'Servicio sin regla TRAMIX definida — revisar manual'
     WHEN track='principal' AND NOT tiene_cache THEN 'Sin verificación TRAMIX (falta scrapear el legajo)'
     WHEN track='principal' AND ult IS NULL THEN 'TRAMIX sin expediente de '||exp_esperado
     WHEN track='principal' AND NOT estado_confirma AND ult->>'estado'='OBSERVADO' THEN 'TRAMIX: '||exp_esperado||' OBSERVADO — revisar'
     WHEN track='principal' AND NOT estado_confirma THEN 'TRAMIX: '||exp_esperado||' en estado "'||(ult->>'estado')||'" (no terminal) — revisar'
     WHEN track='principal' AND NOT fresco THEN 'Verificación TRAMIX vencida (hay que re-scrapear el legajo hoy)'
     WHEN track='principal' AND NOT anclado THEN 'TRAMIX: el expediente confirmante es de un ciclo anterior — revisar manual'
     ELSE 'Revisar' END)
   || CASE WHEN track='curso' AND curso_cerrable AND (impago OR arancelado_sin_comp)
           THEN ' · el curso ya egresó y tiene certificado +30 días (sólo falta resolver el bloqueo para cerrar)'
           ELSE '' END
) ORDER BY (CASE WHEN es_cerrable THEN 0 WHEN curso_no_listo THEN 1 WHEN impago OR arancelado_sin_comp OR sin_otorg THEN 2 ELSE 1 END), track, cliente), '[]'::jsonb)
FROM dec;
$function$;
