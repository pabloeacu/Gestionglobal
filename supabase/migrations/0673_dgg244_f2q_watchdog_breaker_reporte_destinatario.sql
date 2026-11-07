-- 0673 · DGG-244 F2q — cierre §6 del claim atómico (E-GG-266): watchdog con
-- circuit-breaker + reporte_tick a nivel-destinatario. Capitaliza los hallazgos
-- de la doble auditoría §6 (3 agentes) sobre 0672 + la edge dispatch-emails.
--
-- (1) RPC `public.email_queue_watchdog_reclaim`: reemplaza el watchdog inline
--     (UPDATE plano status='sending'→'pending'). El inline NO consumía `intento`
--     → un invocador que muriera DETERMINÍSTICAMENTE en cada intento (p.ej. envío
--     que cuelga hasta el tope de ~150s de la edge, matando el proceso antes de
--     failJob) loopearía claim→crash→reclaim→… SIN converger nunca a terminal, y
--     el "Informe final" (que dispara con pendientes=0) NUNCA se emitiría. Es la
--     clase exacta de E-GG-265 ("informe que nunca finaliza") alcanzada por otra
--     vía. Fix: el reclaim CONSUME un intento; al agotar max_intentos manda la
--     fila a 'failed' terminal. El universo converge SIEMPRE. (Hallazgo §6 C-B / A#9.)
--
-- (2) `reporte_tick` v2 (supera la v1 de 0672): cuenta a nivel DESTINATARIO
--     (distinct to_email) y PARTICIONA el universo terminal, así:
--       · No doble-cuenta cuando el reenvío manual #4 (lexph_newsletter_enviar_
--         especifico) crea una 2da fila (to_email,slug) para un address fallido
--         (hallazgo §6 B1 — hoy latente, el path lo activa).
--       · No deja huecos: todo destinatario no-entregado cae en cancelado o
--         fallido (hallazgo §6 B2 — una fila cancelada a mano por cancelar() que
--         dejó status='pending' igual se cuenta, vía ultimo_error ~ 'cancel%').
--     Mantiene el cruce con sent_emails como fuente de verdad de entrega (una
--     fila entregada que failJob pisó a 'failed' cuenta ENTREGADO), que era la
--     corrección pedida en la nota de E-GG-265.
--
-- R6: versionada. R16: 0 overloads (watchdog nombre nuevo; reporte_tick 0-args
-- CREATE OR REPLACE, misma firma). R12: la RPC del watchdog es mantenimiento
-- interno (sin p_administracion_id), EXECUTE revocado a anon/authenticated y
-- concedido sólo a service_role (la edge). R18: smoke e2e aparte (BEGIN/ROLLBACK).

-- (1) Watchdog con circuit-breaker ------------------------------------------
CREATE OR REPLACE FUNCTION public.email_queue_watchdog_reclaim(p_max_age_sec int DEFAULT 600)
 RETURNS TABLE(reclaimed int, exhausted int)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cut timestamptz := now() - make_interval(secs => greatest(p_max_age_sec, 60));
BEGIN
  -- (1a) huérfanas 'sending' que al consumir el intento AGOTAN max_intentos → failed terminal.
  WITH ex AS (
    UPDATE public.email_queue
       SET status='failed', enviado_at=now(), sending_started_at=null,
           intento = intento + 1,
           ultimo_error = 'watchdog: invocador muerto durante el envío (reintentos agotados)'
     WHERE kind='workflow' AND status='sending' AND sending_started_at < v_cut
       AND intento + 1 >= max_intentos
     RETURNING 1
  )
  SELECT count(*)::int INTO exhausted FROM ex;

  -- (1b) el resto de huérfanas 'sending' → pending, CONSUMIENDO un intento
  --      (clave anti-loop: converge aunque el invocador muera siempre).
  WITH re AS (
    UPDATE public.email_queue
       SET status='pending', sending_started_at=null,
           intento = intento + 1,
           ultimo_error = 'watchdog: invocador muerto durante el envío (reintentando)'
     WHERE kind='workflow' AND status='sending' AND sending_started_at < v_cut
     RETURNING 1
  )
  SELECT count(*)::int INTO reclaimed FROM re;

  RETURN NEXT;
END
$function$;

REVOKE ALL ON FUNCTION public.email_queue_watchdog_reclaim(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_queue_watchdog_reclaim(int) TO service_role;

-- (2) reporte_tick v2 — nivel destinatario + partición terminal ------------
CREATE OR REPLACE FUNCTION private.lexph_newsletter_reporte_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ed   record;
  v_slug text;
  v_tot int; v_sent int; v_fail int; v_canc int; v_bajas int; v_pend int;
begin
  for v_ed in
    select id, seq from public.lexph_ediciones
     where newsletter_enviado_at is not null and newsletter_reporte_at is null
  loop
    v_slug := 'lexph-newsletter-e' || coalesce(v_ed.seq::text, replace(v_ed.id::text, '-', ''));
    -- Agregá POR DESTINATARIO (colapsa reenvíos #4 que reusan el slug) y clasificá:
    --   entregado := alguna fila 'sent' O con registro en sent_emails (fuente de
    --                verdad de entrega, robusta aunque failJob pisara el status).
    --   cancelado := NO entregado y (status='cancelled' O ultimo_error ~ 'cancel%')
    --                (cubre el cancelar() de UI que deja status='pending').
    --   fallido   := NO entregado y NO cancelado (partición: sin huecos).
    --   baja      := cancelado con ultimo_error ~ 'baja'.
    --   pend      := el destinatario tiene alguna fila sin enviar (enviado_at null).
    with per_rec as (
      select eq.to_email,
             bool_or(eq.enviado_at is null) as any_pending,
             bool_or(eq.status = 'sent'
                     or exists (select 1 from public.sent_emails se
                                 where se.to_email = eq.to_email
                                   and se.template_slug = eq.template_slug)) as delivered,
             bool_or(eq.status = 'cancelled' or eq.ultimo_error ilike '%cancel%') as cancel_like,
             bool_or((eq.status = 'cancelled' or eq.ultimo_error ilike '%cancel%')
                     and eq.ultimo_error ilike '%baja%') as baja_like
        from public.email_queue eq
       where eq.template_slug = v_slug
       group by eq.to_email
    )
    select count(*),
           count(*) filter (where delivered),
           count(*) filter (where not delivered and not cancel_like),
           count(*) filter (where not delivered and cancel_like),
           count(*) filter (where not delivered and cancel_like and baja_like),
           count(*) filter (where any_pending)
      into v_tot, v_sent, v_fail, v_canc, v_bajas, v_pend
      from per_rec;

    if v_tot > 0 and v_pend = 0 then
      perform private.notif_emitir_staff(
        'lexph_suscriptor',
        'Informe final · Envío de LexPH completado',
        format('Edición N°%s: entregados %s · fallidos %s · cancelados %s (de ellos, bajas %s) · total %s.',
               coalesce(v_ed.seq::text, '—'), v_sent, v_fail, v_canc, v_bajas, v_tot),
        '/gerencia/contenidos/suscriptores',
        jsonb_build_object('edicion_id', v_ed.id, 'enviados', v_sent,
                           'fallidos', v_fail, 'cancelados', v_canc, 'bajas', v_bajas, 'total', v_tot)
      );
      update public.lexph_ediciones set newsletter_reporte_at = now() where id = v_ed.id;
    end if;
  end loop;
end
$function$;
