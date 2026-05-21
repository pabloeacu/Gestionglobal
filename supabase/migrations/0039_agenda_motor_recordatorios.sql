-- ============================================================================
-- 0039_agenda_motor_recordatorios · Cadencia humana del cron (F2 del handoff
-- AGENDA_GERENCIAL_HANDOFF.md, adaptado a Gestión Global).
--
-- Cadencia (A2.6 del handoff, decisión firme — alarmas configurables tipo
-- Google descartadas, E13):
--   • 1er aviso a la hora del evento (09:00 si all_day)
--   • Re-alerta cada 5 h si sigue pendiente y es hoy
--   • A las 20:00 cierre (una sola vez)
--   • Pendientes de días anteriores → un solo push suave 09:00-09:20
--
-- Notificaciones: este proyecto NO tiene tabla `notifications` (la usa MDC);
-- usa directamente `push_notifications_queue` (cola Web Push VAPID) que
-- despacha la edge function `dispatch-push` cada 2 min via cron existente.
-- Encolamos directo ahí — los copys mantienen el tono rioplatense del handoff.
--
-- Idempotencia: agenda_reminders_log con UNIQUE (event_id, occurrence_date,
-- kind). E9 del handoff: cuidado con duplicados de cron — dropeamos el job
-- previo si existe antes de programar.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.gg_agenda_procesar_recordatorios()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count   integer := 0;
  r         record;
  v_now     timestamp := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires');
  v_today   date      := v_now::date;
  v_dow     integer   := EXTRACT(DOW FROM v_now)::integer;
  v_dom     integer   := EXTRACT(DAY FROM v_now)::integer;
  v_hhmm    time      := v_now::time;
  v_hora_ev time;
  v_ult     timestamptz;
  v_kind    text;
  v_titulo  text;
  v_cuerpo  text;
  v_titulo_push text;
  v_atras   integer;
BEGIN
  -- ---- 1) Recordatorios del día -------------------------------------------
  FOR r IN
    SELECT e.* FROM public.agenda_events e
     WHERE e.start_at IS NOT NULL
       AND (
         (e.recurrence = 'none'
            AND (e.start_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = v_today
            AND e.is_done = false)
         OR
         (e.recurrence <> 'none'
            AND (e.start_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= v_today
            AND (e.recurrence_until IS NULL OR e.recurrence_until >= v_today)
            AND (
              e.recurrence = 'daily'
              OR (e.recurrence = 'weekly' AND (
                    (e.recurrence_weekdays IS NOT NULL
                     AND COALESCE(array_length(e.recurrence_weekdays,1),0) > 0
                     AND v_dow = ANY(e.recurrence_weekdays))
                    OR (COALESCE(array_length(e.recurrence_weekdays,1),0) = 0
                        AND EXTRACT(DOW FROM (e.start_at AT TIME ZONE 'America/Argentina/Buenos_Aires'))::int = v_dow)))
              OR (e.recurrence = 'monthly' AND v_dom =
                    COALESCE(e.recurrence_monthday,
                             EXTRACT(DAY FROM (e.start_at AT TIME ZONE 'America/Argentina/Buenos_Aires'))::int))
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.agenda_event_overrides o
               WHERE o.parent_id = e.id AND o.original_date = v_today
                 AND o.status IN ('done','skipped')
            ))
       )
  LOOP
    v_hora_ev := CASE WHEN r.all_day THEN time '09:00'
                      ELSE (r.start_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::time END;
    IF v_hhmm < v_hora_ev THEN CONTINUE; END IF;

    SELECT max(sent_at) INTO v_ult
      FROM public.agenda_reminders_log l
     WHERE l.event_id = r.id AND l.occurrence_date = v_today;

    v_kind := NULL;
    IF v_ult IS NULL THEN
      v_kind := 'inicial';
    ELSIF v_hhmm >= time '20:00' THEN
      IF NOT EXISTS (SELECT 1 FROM public.agenda_reminders_log l
                      WHERE l.event_id = r.id AND l.occurrence_date = v_today AND l.kind = 'cierre')
      THEN v_kind := 'cierre'; END IF;
    ELSIF (now() - v_ult) >= interval '5 hours' THEN
      v_kind := 'realerta';
    END IF;
    IF v_kind IS NULL THEN CONTINUE; END IF;

    v_titulo := r.title;
    IF v_kind = 'inicial' THEN
      v_titulo_push := '👀 Te toca esto';
      v_cuerpo := '👀 No te cuelgues: «' || v_titulo || '»'
                  || CASE WHEN r.all_day THEN ''
                          ELSE ' (' || to_char(v_hora_ev,'HH24:MI') || ')' END;
    ELSIF v_kind = 'realerta' THEN
      v_titulo_push := '⏰ Sigue pendiente';
      v_cuerpo := '⏰ Te marco de nuevo: «' || v_titulo || '». ¿La encarás ahora o la movés?';
    ELSE
      v_titulo_push := '🌙 Última del día';
      v_cuerpo := '🌙 Última por hoy. Si ya no llegás con «' || v_titulo
                  || '», al menos agendala para mañana así no se te escapa.';
    END IF;

    INSERT INTO public.push_notifications_queue(user_id, titulo, cuerpo, click_url)
    VALUES (r.owner_id, v_titulo_push, v_cuerpo, '/gerencia/agenda');

    INSERT INTO public.agenda_reminders_log (event_id, occurrence_date, kind)
    VALUES (r.id, v_today, v_kind);

    v_count := v_count + 1;
  END LOOP;

  -- ---- 2) Pendientes de días anteriores (un push suave 09:00-09:20) ------
  IF v_hhmm BETWEEN time '09:00' AND time '09:20' THEN
    FOR r IN
      SELECT DISTINCT e.owner_id
        FROM public.agenda_events e
       WHERE e.recurrence = 'none'
         AND e.is_done = false
         AND e.start_at IS NOT NULL
         AND (e.start_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date < v_today
    LOOP
      -- Dedup: un solo push por owner por día con click_url + título único.
      IF NOT EXISTS (
        SELECT 1 FROM public.push_notifications_queue q
         WHERE q.user_id = r.owner_id
           AND q.titulo = '📌 Tenés pendientes de antes'
           AND (q.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = v_today
      ) THEN
        SELECT count(*) INTO v_atras
          FROM public.agenda_events e
         WHERE e.owner_id = r.owner_id
           AND e.recurrence = 'none'
           AND e.is_done = false
           AND e.start_at IS NOT NULL
           AND (e.start_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date < v_today;

        INSERT INTO public.push_notifications_queue(user_id, titulo, cuerpo, click_url)
        VALUES (
          r.owner_id,
          '📌 Tenés pendientes de antes',
          'Quedaron ' || v_atras || ' cosa(s) atrasada(s) en tu agenda. Cuando puedas, reprogramalas o marcalas hechas.',
          '/gerencia/agenda'
        );
        v_count := v_count + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN v_count;
END $$;
REVOKE EXECUTE ON FUNCTION public.gg_agenda_procesar_recordatorios() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.gg_agenda_procesar_recordatorios() TO authenticated;

COMMENT ON FUNCTION public.gg_agenda_procesar_recordatorios() IS
  'Motor de recordatorios de agenda. Cadencia humana (F2 del handoff): inicial a la hora del evento + realerta cada 5h + cierre 20:00 + atrasados 09:00-09:20. Idempotente vía agenda_reminders_log. Encola en push_notifications_queue (la edge dispatch-push despacha).';

-- ---------------------------------------------------------------------------
-- CRON · cada 15 minutos. Dropeamos primero si ya existía (E9).
-- ---------------------------------------------------------------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gg-agenda-recordatorios') THEN
    PERFORM cron.unschedule('gg-agenda-recordatorios');
  END IF;
END $do$;

SELECT cron.schedule(
  'gg-agenda-recordatorios',
  '*/15 * * * *',
  $cron$ SELECT public.gg_agenda_procesar_recordatorios(); $cron$
);
