-- 0627_dgg235_cierre_curso_consigna_unica_hallazgos_s6.sql
-- DGG-235 · Hallazgos de la auditoría transversal §6 sobre la mig 0626.
-- --------------------------------------------------------------------------
-- La auditoría §6 (3 agentes + EJERCITAR) confirmó que banner + agente quedaron
-- bien unificados por `private.curso_cert_mas30`, pero destapó 3 secuelas:
--  #1 (media, introducido por 0626): el email "🎓 Listo para cerrar" quedó MUDO.
--     El trigger `trg_matricula_completada_avisa` se evalúa SÓLO en la transición
--     de estado, pero el umbral +30d se cruza DESPUÉS, sin ningún evento
--     (`vigencia = egreso + ~30d ≈ el gate`), así que nunca dispara en el flujo
--     normal (0/54). Decisión de Pablo: RESTAURARLO como aviso diario por query
--     (misma fuente que el banner), no por trigger de transición.
--  #3 (menor, introducido por 0626): `dashboard_listo_para_cerrar.listo_desde`
--     usaba `updated_at`, que al pasar la elegibilidad de evento→tiempo quedó
--     ≥30d desacoplado del momento real de "listo" → el filtro de novedad del
--     banner (dismiss) podía ocultar PERMANENTEMENTE una fila recién elegible.
--  #4 (menor, pre-existente, expuesto por 0626): `tracking_cerrar_auto` cierra
--     sin guard de idempotencia → dos corridas solapadas del agente doble-cerraban
--     (línea visible al cliente + push duplicados).
-- (#2 — el asistente manual de TrackingDetailPage sigue permisivo a propósito;
--  sólo se corrige el comentario "espejo exacto" en el FE, decisión de Pablo.)
-- --------------------------------------------------------------------------

-- #1a · Marcador de dedupe para el aviso por-alumno.
ALTER TABLE public.curso_matriculas
  ADD COLUMN IF NOT EXISTS cierre_avisado_at timestamptz;

-- Backfill: las matrículas HOY elegibles+abiertas ya fueron avisadas por el
-- trigger viejo → marcarlas para que el cron nuevo no las re-emaile.
UPDATE public.curso_matriculas m
   SET cierre_avisado_at = now()
  FROM public.tramites t
 WHERE t.id = m.tramite_id
   AND m.cierre_avisado_at IS NULL
   AND t.estado NOT IN ('cerrado','cancelado','anulado')
   AND m.estado IN ('completada','vencida')
   AND private.curso_cert_mas30(m.id);

-- #1b · Retirar el email por-evento (lo reemplaza el cron por-query).
DROP TRIGGER IF EXISTS trg_matricula_completada_avisa ON public.curso_matriculas;
DROP FUNCTION IF EXISTS public.trg_matricula_completada_avisa_fn();

-- #1c · Aviso "🎓 Listo para cerrar" nivel-disparado (query), misma consigna que
-- el banner y el agente (egresó + cert +30d), con dedupe por cierre_avisado_at.
CREATE OR REPLACE FUNCTION public.gg_cursos_avisar_listo_cerrar()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  r record; v_url text; v_cuerpo text; v_n int := 0;
BEGIN
  IF NOT (private.is_staff() OR (auth.uid() IS NULL AND COALESCE(auth.role(),'') <> 'anon')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT m.id AS mid, m.curso_id, m.tramite_id, m.estado,
           c.titulo AS curso, a.nombre AS admin
    FROM public.curso_matriculas m
    JOIN public.cursos c   ON c.id = m.curso_id
    JOIN public.tramites t ON t.id = m.tramite_id
    LEFT JOIN public.administraciones a ON a.id = m.administracion_id
    WHERE m.cierre_avisado_at IS NULL
      AND m.tramite_id IS NOT NULL
      AND t.estado NOT IN ('cerrado','cancelado','anulado')
      AND m.estado IN ('completada','vencida')
      AND private.curso_cert_mas30(m.id)
  LOOP
    v_url := '/gerencia/trackings/' || r.tramite_id::text;
    v_cuerpo := COALESCE(r.admin, 'El alumno') || ' terminó «' || COALESCE(r.curso, 'su curso') || '»'
      || CASE WHEN r.estado = 'vencida' THEN ' y su plazo de gracia finalizó.' ELSE '.' END
      || ' Ya podés cerrar el trámite y programar el próximo vencimiento desde el detalle.';
    BEGIN
      PERFORM public.notify_all_gerentes(
        'matricula_completada',
        '🎓 Listo para cerrar · ' || COALESCE(r.admin, 'Alumno'),
        v_cuerpo, v_url,
        jsonb_build_object('matricula_id', r.mid, 'curso_id', r.curso_id, 'tramite_id', r.tramite_id),
        true, 'gerencia-notif-generica', NULL, 2::smallint,
        'curso_matriculas', r.mid);
      UPDATE public.curso_matriculas SET cierre_avisado_at = now() WHERE id = r.mid;
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'gg_cursos_avisar_listo_cerrar fallo mid=%: %', r.mid, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.gg_cursos_avisar_listo_cerrar() FROM PUBLIC, anon, authenticated;

-- cron diario 12:00 UTC (09:00 ART) — antes de la corrida de cierre (19:10 UTC).
SELECT cron.schedule('gg-cursos-avisar-listo-cerrar', '0 12 * * *',
  $cron$ SELECT public.gg_cursos_avisar_listo_cerrar(); $cron$);

-- #3 · listo_desde = momento REAL de elegibilidad (cert+30d), para que el
-- dismiss/novedad del banner no oculte permanentemente una fila recién lista.
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
         GREATEST(
           COALESCE(m.updated_at, m.created_at),
           COALESCE(
             (SELECT COALESCE(cert.descargado_alumno_at, cert.emitido_at)
                FROM public.certificados cert
               WHERE cert.matricula_id = m.id AND cert.revocado_at IS NULL
               ORDER BY cert.emitido_at DESC NULLS LAST
               LIMIT 1),
             m.updated_at, m.created_at
           ) + interval '30 days'
         ) AS listo_desde
    FROM public.curso_matriculas m
    JOIN public.cursos c    ON c.id = m.curso_id
    JOIN public.tramites t  ON t.id = m.tramite_id
    LEFT JOIN public.administraciones a ON a.id = m.administracion_id
    LEFT JOIN public.profiles p         ON p.id = m.profile_id
   WHERE m.tramite_id IS NOT NULL
     AND t.estado NOT IN ('cerrado', 'cancelado')
     AND m.estado IN ('completada', 'vencida')
     AND private.curso_cert_mas30(m.id)
   ORDER BY GREATEST(
             COALESCE(m.updated_at, m.created_at),
             COALESCE(
               (SELECT COALESCE(cert.descargado_alumno_at, cert.emitido_at)
                  FROM public.certificados cert
                 WHERE cert.matricula_id = m.id AND cert.revocado_at IS NULL
                 ORDER BY cert.emitido_at DESC NULLS LAST
                 LIMIT 1),
               m.updated_at, m.created_at
             ) + interval '30 days'
           ) DESC;
END;
$function$;

-- #4 · tracking_cerrar_auto idempotente: no re-cierra ni duplica la línea/aviso
-- si el trámite ya está cerrado/anulado (protege contra corridas solapadas).
CREATE OR REPLACE FUNCTION public.tracking_cerrar_auto(p_tramite_id uuid, p_motivo_cierre text, p_satisfactorio boolean, p_observaciones text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE v_descripcion text; v_estado_linea text; v_servicio_codigo text; v_categoria_linea text; v_upd int;
BEGIN
  IF NOT (private.is_staff() OR (auth.uid() IS NULL AND COALESCE(auth.role(),'') <> 'anon')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  PERFORM set_config('app.skip_admin_assert', 'on', true);

  IF p_motivo_cierre IS NULL OR length(trim(p_motivo_cierre)) = 0 THEN
    RAISE EXCEPTION 'El motivo de cierre es obligatorio' USING ERRCODE = '23502'; END IF;
  IF p_satisfactorio IS NULL THEN
    RAISE EXCEPTION 'Debés indicar si el cierre fue satisfactorio' USING ERRCODE = '23502'; END IF;

  SELECT sv.codigo INTO v_servicio_codigo
    FROM public.tramites t LEFT JOIN public.servicios sv ON sv.id = t.servicio_id
   WHERE t.id = p_tramite_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trámite no encontrado' USING ERRCODE = 'P0002'; END IF;

  UPDATE public.tramites
    SET estado='cerrado', fecha_fin=CURRENT_DATE, motivo_cierre=p_motivo_cierre,
        cierre_satisfactorio=p_satisfactorio, resuelto_at=COALESCE(resuelto_at, now()), ultima_actividad_at=now()
   WHERE id = p_tramite_id
     AND estado NOT IN ('cerrado','anulado');   -- idempotencia: ya cerrado/anulado → no-op
  GET DIAGNOSTICS v_upd = ROW_COUNT;
  IF v_upd = 0 THEN
    RETURN;   -- ya estaba cerrado/anulado: no duplicar línea ni aviso al cliente
  END IF;

  v_descripcion := 'Trámite cerrado: ' || p_motivo_cierre || '.';
  IF p_observaciones IS NOT NULL AND length(trim(p_observaciones)) > 0 THEN
    v_descripcion := v_descripcion || ' ' || trim(p_observaciones); END IF;
  v_estado_linea := CASE WHEN p_satisfactorio THEN 'finalizado' ELSE 'frustrado' END;

  v_categoria_linea := CASE WHEN NOT p_satisfactorio THEN 'cierre_frustrado'
                            WHEN v_servicio_codigo = 'rpac_certificado' THEN 'certificado_emitido'
                            ELSE 'cierre' END;

  INSERT INTO public.tracking_lineas (tramite_id, categoria, descripcion, estado_asociado, archivos_urls, autor_id, visible_cliente)
  VALUES (p_tramite_id, v_categoria_linea, v_descripcion, v_estado_linea, '{}'::text[], NULL, true);
END; $function$;
