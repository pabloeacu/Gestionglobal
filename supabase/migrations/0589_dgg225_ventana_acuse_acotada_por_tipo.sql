-- 0589 · DGG-225 · Acotar la ventana del acuse hacia adelante (anti cross-cycle) — E-GG-231
--
-- Hallazgo §6 (MAYOR, ya disparó): en 0588 la ventana en la que un trámite busca SU
-- acuse de TRAMIX era (created-7 .. now+7). El borde SUPERIOR (now+7) NO estaba atado a
-- la apertura del trámite → para un trámite viejo cuyo acuse propio falta en la cache,
-- la ventana incluía TODA la historia posterior y podía enganchar el acuse del CICLO
-- SIGUIENTE. Caso real: MASSON TRM-2026-00035 (certificado abierto 06/08, sin acuse
-- propio en TRAMIX) matcheó el acuse del 01/10 (56 días después) — que es el de su
-- trámite siguiente TRM-00186 (abierto 29/09) — y se auto-cerró citando el certificado
-- del ciclo equivocado. (El certificado tiene vigencia 30 días y el siguiente se pide
-- antes de cerrar el anterior → patrón recurrente.)
--
-- Fix: acotar el borde superior relativo a la apertura, con un cap por TIPO menor al
-- ciclo del servicio (certificado: ciclo ~30d → cap 25d; renovación: ciclo anual →
-- cap 300d; inscripción: sin ciclo → cap 300d). Así un acuse de otro ciclo queda fuera
-- de rango: si el trámite no tiene su acuse propio dentro de su ventana → `ult=null` →
-- "sin expediente en la ventana" → reportar_revision (se FRENA, no se mis-cierra).
-- Datos reales que lo respaldan: demora apertura→acuse de los certificados legítimos =
-- 2..5 días (avg 9 con el outlier de 56 que era justo este mis-match); renovaciones 9..13.
-- Un cap de 25 (cert) / 300 (resto) no frena ningún caso legítimo observado.
--
-- Además se poda la rama de motivo `NOT anclado` (quedó inalcanzable: como `ult` ya se
-- prefiltra a la ventana, `anclado` es siempre true cuando `ult` existe; el caso
-- sin-acuse-en-ventana lo toma la rama `ult IS NULL`). Resto idéntico a 0588.

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
         -- cap de la ventana del acuse hacia adelante (días), menor al ciclo del servicio
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
  WHERE t.estado = 'resuelto' AND (now() - t.created_at) > interval '25 days'
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
