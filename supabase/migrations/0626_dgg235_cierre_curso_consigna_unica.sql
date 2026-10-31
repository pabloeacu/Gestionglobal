-- 0626_dgg235_cierre_curso_consigna_unica.sql
-- (Aplicada en prod con el slug "0626_dgg229_cierre_curso_consigna_unica" por
--  tipeo; DGG-229 ya era el reset de contraseña. El ID correcto es DGG-235.
--  La migración es idempotente, el slug viejo queda como artefacto en el tracking.)
-- DGG-235 · Unificar la consigna de "listo para cerrar" de cursos entre las 3
-- superficies + arreglar el punto ciego de `vencida` en el agente de cierre.
-- --------------------------------------------------------------------------
-- Caso (Pablo): el 30/10 el "Resumen de agentes · Cierre de trámites" decía
-- que ningún curso cumplía condiciones (0 cerrables, "18 esperando cert +30d",
-- "44 cursando"), pero el email "🎓 Listo para cerrar · <alumno>" y el banner
-- del dashboard de gerencia SÍ mostraban alumnos listos. Las superficies usaban
-- consignas DISTINTAS:
--   • Email (trigger trg_matricula_completada_avisa_fn, DGG-147) y
--     banner (dashboard_listo_para_cerrar, DGG-148): disparaban al EGRESAR
--     (matrícula 'completada' sin vigencia, o 'vencida') — SIN esperar el
--     certificado +30 días.
--   • Agente de cierre (private.agente_cierre_detectar, DGG-222/228): egresó
--     ('completada') + certificado no revocado con +30 días.
-- Además, DOS bugs en el agente:
--   (a) sólo miraba matrículas 'completada' → cuando una egresada envejece a
--       'vencida' (se le pasó la vigencia_hasta) el agente dejaba de verla como
--       egresada y la reclasificaba como "cursando" → NUNCA la cerraba solo
--       (quedaba para cierre manual). En prod las 34 'vencida' tienen TODAS
--       certificado vigente = egresaron; 'activa' (97) no tiene cert = cursando.
--
-- Decisión de Pablo (2026-10-31): consigna ÚNICA = "egresó + certificado +30
-- días" para las 3 superficies, y arreglar el punto ciego de 'vencida'.
--
-- Fix: un predicado COMPARTIDO `private.curso_cert_mas30(matricula_id)` (la regla
-- del certificado +30 días, descargado o emitido) que usan el agente, el banner
-- y el trigger del email — una sola fuente de verdad para no re-divergir. Y
-- egresado = matrícula IN ('completada','vencida') en los 3 lugares.
-- --------------------------------------------------------------------------

-- 1) Predicado compartido: certificado no revocado con +30 días disponible.
CREATE OR REPLACE FUNCTION private.curso_cert_mas30(p_matricula_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.certificados cert
    WHERE cert.matricula_id = p_matricula_id
      AND cert.revocado_at IS NULL
      AND ((cert.descargado_alumno_at IS NOT NULL AND now() - cert.descargado_alumno_at > interval '30 days')
           OR (cert.descargado_alumno_at IS NULL AND cert.emitido_at IS NOT NULL AND now() - cert.emitido_at > interval '30 days'))
  );
$fn$;
REVOKE ALL ON FUNCTION private.curso_cert_mas30(uuid) FROM PUBLIC, anon, authenticated;

-- 2) Agente de cierre: egresado = completada OR vencida; cerrable usa el helper.
--    (Cuerpo byte-idéntico salvo `curso_cerrable` y `curso_egresado`.)
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
            SELECT 1 FROM public.curso_matriculas cm
            WHERE cm.tramite_id=t.id AND cm.estado IN ('completada','vencida') AND private.curso_cert_mas30(cm.id)
         )) AS curso_cerrable,
         (t.categoria='curso' AND EXISTS (SELECT 1 FROM public.curso_matriculas cm WHERE cm.tramite_id=t.id AND cm.estado IN ('completada','vencida'))) AS curso_egresado,
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

-- 3) Banner del dashboard: misma consigna (egresado + cert +30 días + abierto).
CREATE OR REPLACE FUNCTION public.dashboard_listo_para_cerrar()
 RETURNS TABLE(matricula_id uuid, tramite_id uuid, curso_titulo text, cliente_nombre text, matricula_estado text, listo_desde timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT m.id,
         m.tramite_id,
         c.titulo,
         COALESCE(a.nombre, p.full_name, 'Alumno'),
         m.estado,
         COALESCE(m.updated_at, m.created_at)
    FROM public.curso_matriculas m
    JOIN public.cursos c    ON c.id = m.curso_id
    JOIN public.tramites t  ON t.id = m.tramite_id
    LEFT JOIN public.administraciones a ON a.id = m.administracion_id
    LEFT JOIN public.profiles p         ON p.id = m.profile_id
   WHERE m.tramite_id IS NOT NULL
     AND t.estado NOT IN ('cerrado', 'cancelado')
     AND m.estado IN ('completada', 'vencida')
     AND private.curso_cert_mas30(m.id)          -- DGG-229: consigna única (egresó + cert +30 días)
   ORDER BY COALESCE(m.updated_at, m.created_at) DESC;
END;
$function$;

-- 4) Trigger del email "🎓 Listo para cerrar": gateado a la misma consigna
--    (no dispara al egresar; sólo cuando el certificado ya tiene +30 días).
CREATE OR REPLACE FUNCTION public.trg_matricula_completada_avisa_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_curso text;
  v_admin text;
  v_url text;
  v_dispara boolean;
  v_cuerpo text;
BEGIN
  v_dispara :=
    ((NEW.estado = 'vencida' AND OLD.estado IS DISTINCT FROM 'vencida')
      OR (NEW.estado = 'completada' AND OLD.estado IS DISTINCT FROM 'completada'
          AND NEW.vigencia_hasta IS NULL))
    AND private.curso_cert_mas30(NEW.id);   -- DGG-229: no antes de que el certificado cumpla +30 días

  IF v_dispara AND NEW.tramite_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.tramites t
                 WHERE t.id = NEW.tramite_id AND t.estado IN ('cerrado', 'anulado')) THEN
    v_dispara := false;
  END IF;

  IF v_dispara THEN
    SELECT c.titulo INTO v_curso FROM public.cursos c WHERE c.id = NEW.curso_id;
    SELECT a.nombre INTO v_admin FROM public.administraciones a WHERE a.id = NEW.administracion_id;
    v_url := CASE WHEN NEW.tramite_id IS NOT NULL
                  THEN '/gerencia/trackings/' || NEW.tramite_id::text
                  ELSE '/gerencia/campus/' || NEW.curso_id::text END;

    v_cuerpo := COALESCE(v_admin, 'El alumno') || ' terminó «' || COALESCE(v_curso, 'su curso') || '»'
      || CASE WHEN NEW.estado = 'vencida'
              THEN ' y su plazo de gracia finalizó.'
              ELSE '.' END
      || ' Ya podés cerrar el trámite y programar el próximo vencimiento desde el detalle.';

    PERFORM public.notify_all_gerentes(
      'matricula_completada',
      '🎓 Listo para cerrar · ' || COALESCE(v_admin, 'Alumno'),
      v_cuerpo,
      v_url,
      jsonb_build_object('matricula_id', NEW.id, 'curso_id', NEW.curso_id,
                         'tramite_id', NEW.tramite_id),
      true,
      'gerencia-notif-generica',
      NULL, 2::smallint,
      'curso_matriculas', NEW.id
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_matricula_completada_avisa fallo: %', SQLERRM;
  RETURN NEW;
END;
$function$;
