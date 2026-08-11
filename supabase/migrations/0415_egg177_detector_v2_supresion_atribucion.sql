-- ============================================================================
-- 0415 · §6 E-GG-177 — Detector de huérfanos v2: supresión + atribución
--
-- Tres falsos positivos confirmados por la auditoría del chunk 0414:
--  1. Gestor que QUITA un adjunto ya subido (quitarAdjunto solo toca estado
--     React; anon no tiene DELETE en el bucket) y después envía el correcto
--     → el objeto descartado alertaba "nunca completó el envío" (falso).
--  2. Gerencia que quita un adjunto al MODERAR (tracking_moderar_gestor_avance
--     reemplaza archivos_urls in-place) → alerta culpando a la gestoría.
--  3. Segundo writer del bucket: subirAdjuntoTracking (staff) usa prefijo
--     'tracking-<tramiteId>/' — sin token en accesos_externos, la v1 alertaba
--     "La gestoría cargó…" (atribución falsa) sin código de trámite.
--
-- v2:
--  (a) SUPRESIÓN por actividad posterior: si el trámite tiene una línea
--      'gestor_avance' (caso gestor) o CUALQUIER línea (caso staff) creada
--      DESPUÉS del objeto, el archivo fue descartado/reemplazado a conciencia
--      → dedupe silencioso, sin notificar. El caso Spotti (subió y nunca
--      envió, cero líneas posteriores) sigue alertando.
--  (b) ATRIBUCIÓN: branch 'tracking-%' resuelve el trámite desde el path y
--      usa copy neutro de gerencia; el copy "gestoría" queda solo para
--      tokens que resuelven por accesos_externos.
--
-- R16: misma firma () → CREATE OR REPLACE no crea overload (smoke al cierre).
-- R18: smoke e2e con los 4 casos (alerta gestor / suprimido / alerta staff /
--      idempotencia) al cierre del chunk.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.gestor_uploads_alertar_huerfanos()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_obj record;
  v_alertados int := 0;
  v_tramite public.tramites%ROWTYPE;
  v_es_staff boolean;
  v_titulo text;
  v_cuerpo text;
BEGIN
  FOR v_obj IN
    SELECT o.name, o.created_at,
           split_part(o.name, '/', 1) AS token,
           split_part(o.name, '/', 2) AS filename
    FROM storage.objects o
    WHERE o.bucket_id = 'gestor-uploads'
      AND o.created_at < now() - interval '2 hours'
      AND length(split_part(o.name, '/', 2)) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.tracking_lineas tl
        WHERE strpos(tl.archivos_urls::text, split_part(o.name, '/', 2)) > 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.gestor_uploads_huerfanos_alertados a
        WHERE a.object_name = o.name
      )
  LOOP
    v_tramite := NULL;
    v_es_staff := v_obj.token LIKE 'tracking-%';

    IF v_es_staff THEN
      -- Prefijo 'tracking-<tramiteId>' de subirAdjuntoTracking (gerencia).
      BEGIN
        SELECT t.* INTO v_tramite FROM public.tramites t
        WHERE t.id = substring(v_obj.token FROM 10)::uuid;
      EXCEPTION WHEN OTHERS THEN v_tramite := NULL; END;
    ELSE
      SELECT t.* INTO v_tramite
      FROM public.accesos_externos ae
      JOIN public.solicitudes s ON s.id = ae.recurso_id AND ae.recurso_tipo = 'solicitud'
      JOIN public.tramites t ON t.id = s.tramite_id
      WHERE ae.token = v_obj.token;
    END IF;

    -- (a) Supresión: hubo un envío/actividad POSTERIOR en el mismo trámite →
    -- el archivo fue descartado o reemplazado a conciencia. Dedupe sin aviso.
    IF v_tramite.id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tracking_lineas tl
      WHERE tl.tramite_id = v_tramite.id
        AND tl.created_at > v_obj.created_at
        AND (v_es_staff OR tl.categoria = 'gestor_avance')
    ) THEN
      INSERT INTO public.gestor_uploads_huerfanos_alertados (object_name, tramite_id)
      VALUES (v_obj.name, v_tramite.id)
      ON CONFLICT (object_name) DO NOTHING;
      CONTINUE;
    END IF;

    -- (b) Copy según quién subió.
    IF v_es_staff THEN
      v_titulo := 'Archivo del tracking sin línea asociada'
        || COALESCE(' · ' || v_tramite.codigo, '');
      v_cuerpo := 'Se subió "' || regexp_replace(v_obj.filename, '^\d+-[a-z0-9]+-', '')
        || '" el ' || to_char(v_obj.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI')
        || ' desde la gerencia pero no quedó asociado a ninguna línea de tracking '
        || '(probable borrador cancelado). '
        || COALESCE('Trámite ' || v_tramite.codigo || ' — ' || COALESCE(v_tramite.solicitante_nombre, '') || '. ', '')
        || 'Revisá si corresponde re-cargarlo o descartarlo.';
    ELSE
      v_titulo := 'Archivo de gestoría SIN ENVIAR'
        || COALESCE(' · ' || v_tramite.codigo, '');
      v_cuerpo := 'La gestoría cargó "' || regexp_replace(v_obj.filename, '^\d+-[a-z0-9]+-', '')
        || '" el ' || to_char(v_obj.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI')
        || ' pero nunca completó el envío (no hay línea de tracking). '
        || COALESCE('Trámite ' || v_tramite.codigo || ' — ' || COALESCE(v_tramite.solicitante_nombre, '') || '. ', '')
        || 'Conviene reclamarle el envío o revisar el archivo.';
    END IF;

    BEGIN
      PERFORM public.notify_all_gerentes(
        'gestor_upload_huerfano',
        v_titulo,
        v_cuerpo,
        CASE WHEN v_tramite.id IS NOT NULL
             THEN '/gerencia/trackings/' || v_tramite.id::text
             ELSE '/gerencia' END,
        jsonb_build_object(
          'object_name', v_obj.name, 'token', v_obj.token,
          'tramite_id', v_tramite.id, 'subido_at', v_obj.created_at,
          'origen', CASE WHEN v_es_staff THEN 'gerencia' ELSE 'gestoria' END
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
