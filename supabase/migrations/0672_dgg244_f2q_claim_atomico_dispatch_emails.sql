-- 0672 · DGG-244 F2q — Claim atómico anti doble-envío en dispatch-emails
-- (E-GG-261 hallazgo [1]) · lado DB de un fix mayormente de edge.
--
-- CONTEXTO: el dispatcher (supabase/functions/dispatch-emails/index.ts) ahora
-- reclama la fila (UPDATE ... status='sending', sending_started_at=now() WHERE
-- enviado_at IS NULL AND status<>'sending' RETURNING) ANTES del fetch a Gmail,
-- con un watchdog que devuelve a 'pending' las 'sending' colgadas > 10 min. El
-- estado 'sending' y la columna sending_started_at ya existían desde mig 0006,
-- sin uso. Esta migración NO cambia el schema de email_queue (la columna y el
-- CHECK de status ya admiten 'sending'); sólo agrega:
--
--   (1) un índice parcial que hace O(1) el barrido del watchdog (si no, un
--       seq-scan de ~9k filas por minuto buscando status='sending').
--
--   (2) corrige private.lexph_newsletter_reporte_tick para derivar
--       ENTREGADOS/FALLIDOS cruzando sent_emails (fuente de verdad de entrega),
--       no el status crudo de email_queue (nota de E-GG-265): en la carrera [1]
--       —hoy cerrada por el claim, pero el informe queda robusto igual— una fila
--       ENTREGADA que failJob pisó a 'failed' se contaba como fallido. sent_emails
--       sólo recibe fila tras un send EXITOSO, así que es el testigo independiente
--       del status que failJob puede haber pisado.
--
-- R6: versionada. R16: reporte_tick es 0-args void → CREATE OR REPLACE no crea
-- overload (misma firma). R18: smoke e2e aparte (BEGIN/ROLLBACK) tras aplicar.

-- (1) Índice del watchdog. Parcial sobre las (poquísimas, idealmente 0-1) filas
-- en vuelo; el watchdog filtra kind='workflow' AND status='sending' AND
-- sending_started_at < cutoff.
CREATE INDEX IF NOT EXISTS idx_email_queue_sending
  ON public.email_queue (sending_started_at)
  WHERE status = 'sending' AND kind = 'workflow';

-- (2) reporte_tick: entregados/fallidos por sent_emails como fuente de verdad.
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
    -- ENTREGADO := status='sent' O hay fila en sent_emails (to_email+template_slug).
    -- sent_emails sólo se escribe tras un send exitoso (dispatch-emails), así que
    -- es la prueba POSITIVA e independiente de entrega: aunque failJob pise el
    -- status a 'failed' en una carrera, la fila entregada se cuenta como entregada.
    -- FALLIDO := status='failed' Y NO entregada (ni por status ni por sent_emails).
    select
      count(*),
      count(*) filter (
        where eq.status = 'sent'
           or exists (select 1 from public.sent_emails se
                       where se.to_email = eq.to_email
                         and se.template_slug = eq.template_slug)
      ),
      count(*) filter (
        where eq.status = 'failed'
          and eq.status <> 'sent'
          and not exists (select 1 from public.sent_emails se
                           where se.to_email = eq.to_email
                             and se.template_slug = eq.template_slug)
      ),
      count(*) filter (where eq.status = 'cancelled'),
      count(*) filter (where eq.status = 'cancelled' and eq.ultimo_error ilike '%baja%'),
      count(*) filter (where eq.enviado_at is null)
      into v_tot, v_sent, v_fail, v_canc, v_bajas, v_pend
      from public.email_queue eq where eq.template_slug = v_slug;

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
