-- 0745 · DGG-274 / E-GG-309 — Freno de reputación SES por COHORTE del envío + next_email_slot carril-aware.
--
-- Hallazgo de la auditoría §6 (freno de autopausa, #5): `ses_freno_check` (y el panel `ses_lane_estado`)
-- medían la tasa de rebote/queja con DOS ventanas temporales distintas:
--   · denominador = envíos HECHOS en 24h (sent_emails.enviado_at)
--   · numerador   = eventos RECIBIDOS en 24h (ses_feedback_events.recibido_at)
-- No son los mismos mails. Hoy coincide (goteo reciente y continuo: 1503 envíos / 49 hard / 3.26% —
-- idéntico por cohorte), pero estructuralmente: (a) diluye la tasa durante una ráfaga (envíos ya
-- contados, rebotes aún sin llegar) y (b) la INFLA tras reanudar de una pausa (rebotes viejos del lote
-- pre-pausa, recibido_at reciente, contra un denominador chico de warmup) → RE-PAUSA ESPURIA. La tasa
-- HARD (gatillo real de suspensión AWS) ya era casi tiempo real, así que el riesgo práctico es la
-- re-pausa espuria (sobre-pausa = molesto pero SEGURO), no dejar pasar un lote tóxico.
--
-- Fix (como el freno de LexPH, R19/consistencia): medir por COHORTE del ENVÍO — join
-- ses_feedback_events → sent_emails por provider_msg_id, numerador ⊆ denominador. No puede inflar
-- (se auto-sana) y los rebotes viejos quedan atribuidos a sus envíos viejos (fuera de ventana), matando
-- la re-pausa espuria. Helper único usado por el freno Y el panel (coherencia aviso↔display, §6e).
-- Un envío con rebote transitorio Y luego permanente se cuenta UNA vez como hard (is_trans AND NOT is_hard).
--
-- Además (#6): `private.next_email_slot` (throttle legacy, 0 callers hoy — mig 0379 lo marcó descartado)
-- tomaba MAX(enviado_at) sobre TODO sent_emails, así que el goteo SES le clavaría el slot en now+5min si
-- se reactivara. Se scopea al carril transaccional (NOT @envios) para que quede correcto si vuelve a usarse.

-- ───────────── Helper de reputación por cohorte (fuente única) ─────────────
CREATE OR REPLACE FUNCTION private.ses_reputacion_cohorte(p_desde timestamptz)
RETURNS TABLE(sent int, hard int, trans int, quej int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH win AS (
    SELECT se.provider_msg_id
    FROM public.sent_emails se
    WHERE se.from_email ILIKE '%@envios.gestionglobal.ar'
      AND se.enviado_at >= p_desde
  ),
  ev AS (
    -- Eventos de los envíos de la ventana. recibido_at >= p_desde sólo PODA el scan: un evento
    -- de un envío de la ventana siempre llega DESPUÉS del envío (>= p_desde), así que no cambia el
    -- resultado (los eventos de envíos fuera de ventana no joinean con win de todos modos).
    SELECT e.provider_msg_id,
           bool_or(e.tipo = 'bounce' AND e.es_permanente)       AS is_hard,
           bool_or(e.tipo = 'bounce' AND NOT e.es_permanente)   AS is_trans,
           bool_or(e.tipo = 'complaint')                        AS is_quej
    FROM public.ses_feedback_events e
    WHERE e.provider_msg_id IS NOT NULL
      AND e.recibido_at >= p_desde
    GROUP BY e.provider_msg_id
  )
  SELECT
    count(*)::int                                                 AS sent,
    count(*) FILTER (WHERE ev.is_hard)::int                       AS hard,
    count(*) FILTER (WHERE ev.is_trans AND NOT ev.is_hard)::int   AS trans,
    count(*) FILTER (WHERE ev.is_quej)::int                       AS quej
  FROM win
  LEFT JOIN ev ON ev.provider_msg_id = win.provider_msg_id;
$function$;

COMMENT ON FUNCTION private.ses_reputacion_cohorte(timestamptz) IS
  'DGG-274/E-GG-309: reputación SES por COHORTE del envío (numerador ⊆ denominador, join por '
  'provider_msg_id). Fuente única de ses_freno_check (gate) y ses_lane_estado (panel). Evita la '
  'dilución en ráfaga y la re-pausa espuria post-reanudar.';

-- ───────────── Freno de autopausa: usa el helper ─────────────
CREATE OR REPLACE FUNCTION private.ses_freno_check()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_sent int; v_hard int; v_trans int; v_quej int;
  v_pct_hard numeric; v_pct_total numeric; v_pct_quej numeric;
  v_breach boolean; v_motivo text; v_ya_pausado boolean;
  c_min constant int := 100;
begin
  select coalesce(ses_pausado_reputacion, false) into v_ya_pausado
    from public.config_global where id = 1;

  -- DGG-274/E-GG-309: numerador y denominador sobre la MISMA cohorte (envíos de la ventana).
  select sent, hard, trans, quej into v_sent, v_hard, v_trans, v_quej
    from private.ses_reputacion_cohorte(now() - interval '24 hours');

  v_pct_hard  := case when v_sent > 0 then round(v_hard::numeric / v_sent * 100, 2) else 0 end;
  v_pct_total := case when v_sent > 0 then round((v_hard + v_trans)::numeric / v_sent * 100, 2) else 0 end;
  v_pct_quej  := case when v_sent > 0 then round(v_quej::numeric / v_sent * 100, 2) else 0 end;

  v_breach :=
       (v_sent >= c_min and v_hard  >= 10 and v_pct_hard  > 5.0)
    or (v_sent >= c_min and (v_hard + v_trans) >= 16 and v_pct_total > 8.0)
    or (v_sent >= 50     and v_quej  >= 3  and v_pct_quej  > 0.3);

  if v_breach and not v_ya_pausado then
    v_motivo := format(
      'Auto-pausa SES por reputacion: rebote duro %s%% (%s), rebote total %s%% (%s), quejas %s%% (%s) sobre %s envios SES/24h.',
      v_pct_hard, v_hard, v_pct_total, (v_hard + v_trans), v_pct_quej, v_quej, v_sent);
    update public.config_global
       set ses_pausado_reputacion = true,
           ses_pausado_motivo = v_motivo,
           ses_pausado_at = now()
     where id = 1;
    begin
      perform public.notify_all_gerentes(
        'ses_pausa_reputacion',
        'Carril SES PAUSADO por reputacion',
        v_motivo || ' El carril masivo quedo frenado automaticamente; lo transaccional (Gmail) sigue intacto. Revisa la causa antes de reanudar.',
        '/gerencia/analitica/marketing', '{}'::jsonb, true);
    exception when others then
      raise warning 'ses_freno_check: notify_all_gerentes fallo: %', sqlerrm;
    end;
  end if;

  return jsonb_build_object(
    'sent_24h', v_sent, 'hard', v_hard, 'transitorios', v_trans, 'quejas', v_quej,
    'pct_hard', v_pct_hard, 'pct_total', v_pct_total, 'pct_quej', v_pct_quej,
    'breach', v_breach, 'ya_pausado', v_ya_pausado,
    'pausa_aplicada', (v_breach and not v_ya_pausado));
end $function$;

-- ───────────── Panel (ses_lane_estado): misma cohorte (coherencia §6e) ─────────────
CREATE OR REPLACE FUNCTION public.ses_lane_estado()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
declare
  v_cfg record; v_cap int; v_hoy int; v_sent24 int;
  v_hard int; v_trans int; v_quej int; v_pct numeric;
  c_dom constant text := '%@envios.gestionglobal.ar';
begin
  if auth.uid() is not null and not coalesce(private.is_staff(), false) then
    raise exception 'Solo gerencia.' using errcode = '42501';
  end if;

  select ses_pausado_reputacion, ses_pausado_motivo, ses_pausado_at, ses_warmup_inicio, ses_warmup_cap_override
    into v_cfg from public.config_global where id = 1;
  v_cap := public.ses_warmup_cap_hoy();

  -- Cupo diario: conteo de envíos del día (sin cohorte; es volumen, no reputación).
  select count(*) into v_hoy from public.sent_emails
    where from_email ilike c_dom and enviado_at >= date_trunc('day', now());

  -- DGG-274/E-GG-309: reputación 24h por COHORTE (mismo helper que el freno → display == gate).
  select sent, hard, trans, quej into v_sent24, v_hard, v_trans, v_quej
    from private.ses_reputacion_cohorte(now() - interval '24 hours');

  v_pct := case when v_sent24 > 0 then round((v_hard + v_quej)::numeric / v_sent24 * 100, 2) else 0 end;

  return jsonb_build_object(
    'pausado', coalesce(v_cfg.ses_pausado_reputacion, false),
    'motivo', v_cfg.ses_pausado_motivo,
    'pausado_at', v_cfg.ses_pausado_at,
    'warmup_inicio', v_cfg.ses_warmup_inicio,
    'warmup_dia', case when v_cfg.ses_warmup_inicio is null then null
                       else (current_date - v_cfg.ses_warmup_inicio) + 1 end,
    'cap_override', v_cfg.ses_warmup_cap_override,
    'cap_hoy', v_cap,
    'enviados_hoy', v_hoy,
    'restante_hoy', greatest(0, v_cap - v_hoy),
    'sent_24h', v_sent24,
    'hard_24h', v_hard, 'transitorios_24h', v_trans, 'quejas_24h', v_quej,
    'pct_24h', v_pct
  );
end $function$;

-- ───────────── #6 · next_email_slot (legacy, dead) scopeado al transaccional ─────────────
CREATE OR REPLACE FUNCTION private.next_email_slot()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT GREATEST(
    now() + interval '1 minute',
    COALESCE((
      SELECT MAX(scheduled_at) FROM public.email_queue
       WHERE status IN ('pending','scheduled','sending')
    ) + interval '5 minutes', now()),
    -- DGG-274/E-GG-309: sólo el carril transaccional sella este throttle legacy; el goteo SES
    -- (@envios) NO debe arrastrar el slot (si esta fn se reactivara para pacear lotes/comprobantes).
    COALESCE((
      SELECT MAX(enviado_at) FROM public.sent_emails
       WHERE from_email IS NULL OR from_email NOT ILIKE '%@envios.gestionglobal.ar'
    ) + interval '5 minutes', now())
  );
$function$;
