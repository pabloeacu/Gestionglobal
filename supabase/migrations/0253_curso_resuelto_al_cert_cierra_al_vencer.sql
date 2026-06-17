-- ============================================================================
-- 0253_curso_resuelto_al_cert_cierra_al_vencer.sql
-- DGG-88 (decisión #2) · El trámite de un curso: RESUELTO al emitir el certificado
-- (trabajo hecho); CERRADO recién cuando vence el acceso del alumno Y está cobrado.
-- Antes: el cert lo cerraba directo. Realineado al criterio de Pablo. (certs_total=0
-- al aplicar → sin data que migrar.) El gate DGG-88 (mig 0252) protege igual: un
-- impago nunca llega a cerrado.
-- ============================================================================

-- (A) El certificado RESUELVE el trámite del curso (no lo cierra). Mantiene el
-- nexo cert.matricula_id → matrícula.submission_origen → tramites.formulario_submission_id.
CREATE OR REPLACE FUNCTION public.trg_certificado_cierra_tramite_curso_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_submission_id uuid;
  v_tramite_id    uuid;
  v_url           text;
BEGIN
  SELECT submission_origen INTO v_submission_id
  FROM public.curso_matriculas WHERE id = NEW.matricula_id;
  IF v_submission_id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_tramite_id
  FROM public.tramites
  WHERE formulario_submission_id = v_submission_id
    AND categoria = 'curso'
    AND estado NOT IN ('cerrado', 'cancelado')
  ORDER BY created_at DESC LIMIT 1;
  IF v_tramite_id IS NULL THEN RETURN NEW; END IF;

  v_url := 'https://gestionglobal.ar/verificar/' || NEW.codigo;

  -- DGG-88: RESUELTO (no cerrado). El cierre lo hace gg_campus_vencer_matriculas
  -- al vencer el acceso, si está cobrado. resuelto_at lo setea tramite_on_update.
  UPDATE public.tramites
     SET estado = 'resuelto',
         documento_final_url = v_url,
         ultima_actividad_at = now()
   WHERE id = v_tramite_id;

  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, estado_asociado,
    archivos_urls, autor_id, visible_cliente
  ) VALUES (
    v_tramite_id,
    'certificado_emitido',
    'Curso aprobado y certificado emitido — trámite resuelto. Cerrará al vencer el acceso del alumno (si está cobrado).',
    'finalizado',
    ARRAY[v_url]::text[],
    NULL, true
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_certificado_cierra_tramite_curso fallo: %', SQLERRM;
  RETURN NEW;
END;
$function$;

-- (B) Vencer acceso + cerrar el trámite del curso si está resuelto y COBRADO.
CREATE OR REPLACE FUNCTION public.gg_campus_vencer_matriculas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- 1) vencer el acceso (igual que el cron previo)
  UPDATE public.curso_matriculas
     SET estado = 'vencida', updated_at = now()
   WHERE estado = 'completada'
     AND vigencia_hasta IS NOT NULL
     AND vigencia_hasta < (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;

  -- 2) DGG-88: cerrar el trámite del curso si está RESUELTO y COBRADO (acceso ya
  -- vencido). Si está impago, queda resuelto (cola de cobranza; el gate igual lo
  -- bloquearía). El filtro NOT cobro_pendiente es CLAVE: evita que el RAISE del
  -- gate aborte el batch.
  UPDATE public.tramites t
     SET estado = 'cerrado',
         motivo_cierre = 'Concluyó el curso (acceso vencido)',
         cierre_satisfactorio = true,
         fecha_fin = CURRENT_DATE,
         ultima_actividad_at = now()
   WHERE t.categoria = 'curso'
     AND t.estado = 'resuelto'
     AND NOT public.cobro_pendiente(t)
     AND EXISTS (
       SELECT 1 FROM public.curso_matriculas m
        WHERE m.estado = 'vencida'
          AND m.submission_origen = t.formulario_submission_id
     );
END;
$function$;

-- (C) El cron diario pasa a llamar la función (antes era un UPDATE inline).
SELECT cron.schedule('gg-campus-matriculas-vencer', '17 4 * * *',
  $$SELECT public.gg_campus_vencer_matriculas();$$);
