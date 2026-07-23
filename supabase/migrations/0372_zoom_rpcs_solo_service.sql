-- 0372 · E-GG-145 (adyacencia) — RPCs del circuito webhook Zoom: solo service
--
-- Las 7 RPCs que alimentan asistencia/estado/grabación desde los webhooks
-- estaban con EXECUTE para PUBLIC (default de Postgres): cualquier usuario
-- autenticado podía invocarlas por PostgREST e inyectarse eventos de
-- asistencia, pisar el estado de una sala o plantar una URL de grabación.
-- Pre-existente desde sus migraciones de origen (0047/0239/…), detectado en
-- el sweep de E-GG-145. Ningún componente del front las llama (verificado):
-- sus únicos callers son zoom-webhook/webex-webhook con SERVICE_ROLE.
--
-- Cierre por privilegios (sin tocar cuerpos → cero riesgo de regresión):
-- nota: curso_encuentro_zoom_evento_por_email y curso_encuentro_reconciliar_
-- asistencia (mig 0371) ya nacieron con guard is_staff_or_service adentro;
-- acá se les alinea además el privilegio.

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'curso_encuentro_zoom_evento(bigint,uuid,text,timestamptz,jsonb)',
    'curso_encuentro_zoom_evento_por_email(bigint,text,text,timestamptz,jsonb)',
    'curso_encuentro_zoom_estado(bigint,text,timestamptz)',
    'curso_encuentro_zoom_grabacion(bigint,text,text)',
    'curso_encuentro_reconciliar_asistencia(uuid,jsonb)',
    'zoom_encuentros_pendientes_reconciliar()',
    'encuentro_sesion_zoom_evento(bigint,uuid,text,timestamptz,jsonb)',
    'encuentro_sesion_zoom_estado(bigint,text,timestamptz)',
    'encuentro_sesion_zoom_grabacion(bigint,text,text)',
    'webinar_zoom_evento(bigint,uuid,text,timestamptz,jsonb)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC', f);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon', f);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;
