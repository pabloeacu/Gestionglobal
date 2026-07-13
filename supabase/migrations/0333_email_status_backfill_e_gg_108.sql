-- 0333 · E-GG-108: backfill de `status` en email_queue.
--
-- Causa raíz: dispatch-emails (pre-fix) marcaba `enviado_at` en el envío
-- exitoso pero NUNCA avanzaba `status` a 'sent' (ni `sent_at`). Los emails
-- entregados quedaban 'pending' para siempre → el health check los contaba
-- como "N emails atascados (cron caído?)" (falsa alarma que vio JL).
--
-- El fix que PREVIENE la acumulación va en el edge function (deploy aparte).
-- Esta migración corrige el estado de las filas ya procesadas, con verdad:
--   (a) las que tienen registro real en sent_emails → 'sent' (se entregaron).
--   (b) las que agotaron reintentos sin entrega → 'failed'.
-- Idempotente: al cambiar el status ya no matchean `status='pending'`.
-- NO toca las 'cancelled' (residuo QA) ni las genuinamente pendientes
-- (enviado_at IS NULL, todavía en cola).

-- (a) Entregados: enviado_at seteado + sent_emails correlativo → 'sent'.
UPDATE public.email_queue q
   SET status = 'sent',
       sent_at = COALESCE(q.sent_at, q.enviado_at),
       updated_at = now()
 WHERE q.status = 'pending'
   AND q.enviado_at IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.sent_emails se
     WHERE se.to_email = q.to_email
       AND se.template_slug = q.template_slug
       AND se.created_at BETWEEN q.enviado_at - interval '2 min'
                             AND q.enviado_at + interval '2 min'
   );

-- (b) Agotados sin entrega: enviado_at como stop-marker + reintentos agotados.
UPDATE public.email_queue q
   SET status = 'failed',
       updated_at = now()
 WHERE q.status = 'pending'
   AND q.enviado_at IS NOT NULL
   AND q.intento >= q.max_intentos
   AND NOT EXISTS (
     SELECT 1 FROM public.sent_emails se
     WHERE se.to_email = q.to_email
       AND se.template_slug = q.template_slug
       AND se.created_at BETWEEN q.enviado_at - interval '2 min'
                             AND q.enviado_at + interval '2 min'
   );
