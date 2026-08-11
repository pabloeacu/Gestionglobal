-- ============================================================================
-- 0414 · E-GG-177 — Red de seguridad: subidas de gestoría huérfanas
--
-- Caso Spotti (06/08/2026): el gestor eligió el archivo (se sube al bucket al
-- instante, con tilde verde) pero recargó la página antes de apretar "Enviar"
-- → el borrador murió en el browser, el PDF quedó huérfano en `gestor-uploads`
-- y la gerencia jamás se enteró (el aviso de moderación nace recién con la
-- línea de tracking). La gestoría insistía con razón: el archivo ESTABA.
--
-- Fix frontend (mismo chunk): banner "cargado pero NO enviado" + beforeunload.
-- Fix server (esta mig): cron horario que detecta objetos del bucket
-- `gestor-uploads` con >2 horas de antigüedad no referenciados por ninguna
-- línea de tracking, y avisa a TODA la gerencia por el canal estándar
-- (notify_all_gerentes → campanita + email gerencia-notif-generica), con
-- dedupe persistente para no re-alertar cada hora.
--
-- R2: RLS en la tabla nueva. R6: GRANTs explícitos. R16: función nueva sin
-- overloads (smoke al cierre). R18: smoke e2e ejecutando la función real.
-- ============================================================================

-- Dedupe: un aviso por objeto huérfano, para siempre.
CREATE TABLE public.gestor_uploads_huerfanos_alertados (
  object_name text PRIMARY KEY,
  tramite_id uuid,
  alertado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gestor_uploads_huerfanos_alertados ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.gestor_uploads_huerfanos_alertados TO authenticated;
-- Escritura SOLO vía la función SECURITY DEFINER del cron (sin policy de write).
CREATE POLICY huerfanos_alertados_staff_select
  ON public.gestor_uploads_huerfanos_alertados FOR SELECT
  USING (private.is_staff());

-- Detector + alertador. SECURITY DEFINER: lee storage.objects y escribe en
-- notificaciones/email_queue (RLS sin policies de write → R17) y en la tabla
-- dedupe. Idempotente: correrla dos veces no duplica avisos.
CREATE FUNCTION public.gestor_uploads_alertar_huerfanos()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_obj record;
  v_alertados int := 0;
  v_tramite public.tramites%ROWTYPE;
  v_titulo text;
BEGIN
  FOR v_obj IN
    SELECT o.name, o.created_at,
           split_part(o.name, '/', 1) AS token,
           split_part(o.name, '/', 2) AS filename
    FROM storage.objects o
    WHERE o.bucket_id = 'gestor-uploads'
      -- Umbral 2h: le da tiempo de sobra al flujo normal (subir → describir →
      -- enviar toma minutos) sin alertar por borradores en curso.
      AND o.created_at < now() - interval '2 hours'
      AND length(split_part(o.name, '/', 2)) > 0
      -- strpos (literal, sin comodines LIKE): el nombre de objeto es único por
      -- el prefijo <timestamp>-<random>- que agrega subirAdjuntoGestor.
      AND NOT EXISTS (
        SELECT 1 FROM public.tracking_lineas tl
        WHERE strpos(tl.archivos_urls::text, split_part(o.name, '/', 2)) > 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.gestor_uploads_huerfanos_alertados a
        WHERE a.object_name = o.name
      )
  LOOP
    -- Resolver token → solicitud → trámite para un aviso con contexto.
    v_tramite := NULL;
    SELECT t.* INTO v_tramite
    FROM public.accesos_externos ae
    JOIN public.solicitudes s ON s.id = ae.recurso_id AND ae.recurso_tipo = 'solicitud'
    JOIN public.tramites t ON t.id = s.tramite_id
    WHERE ae.token = v_obj.token;

    v_titulo := 'Archivo de gestoría SIN ENVIAR'
      || COALESCE(' · ' || v_tramite.codigo, '');
    BEGIN
      PERFORM public.notify_all_gerentes(
        'gestor_upload_huerfano',
        v_titulo,
        'La gestoría cargó "' || regexp_replace(v_obj.filename, '^\d+-[a-z0-9]+-', '')
          || '" el ' || to_char(v_obj.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI')
          || ' pero nunca completó el envío (no hay línea de tracking). '
          || COALESCE('Trámite ' || v_tramite.codigo || ' — ' || COALESCE(v_tramite.solicitante_nombre, '') || '. ', '')
          || 'Conviene reclamarle el envío o revisar el archivo.',
        CASE WHEN v_tramite.id IS NOT NULL
             THEN '/gerencia/trackings/' || v_tramite.id::text
             ELSE '/gerencia' END,
        jsonb_build_object(
          'object_name', v_obj.name, 'token', v_obj.token,
          'tramite_id', v_tramite.id, 'subido_at', v_obj.created_at
        ),
        true, 'gerencia-notif-generica', NULL, 2::smallint,
        'tramites', v_tramite.id
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    INSERT INTO public.gestor_uploads_huerfanos_alertados (object_name, tramite_id)
    VALUES (v_obj.name, v_tramite.id)
    ON CONFLICT (object_name) DO NOTHING;
    v_alertados := v_alertados + 1;
  END LOOP;

  RETURN v_alertados;
END;
$$;

REVOKE ALL ON FUNCTION public.gestor_uploads_alertar_huerfanos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gestor_uploads_alertar_huerfanos() TO service_role;

-- Cron horario (minuto 22 para no apilarse con los crons de :00/:15).
DO $$
BEGIN
  PERFORM cron.unschedule('gestor-uploads-huerfanos-hourly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gestor-uploads-huerfanos-hourly');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'gestor-uploads-huerfanos-hourly',
  '22 * * * *',
  $$SELECT public.gestor_uploads_alertar_huerfanos()$$
);
