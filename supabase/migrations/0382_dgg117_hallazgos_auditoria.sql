-- ============================================================================
-- 0382 · DGG-117 · Hallazgos de la triple auditoría §6 (agentes A/B/C)
--
-- A#10 · Las passwords temporales quedaban EN CLARO en email_queue.variables
--   después del envío (legibles por cualquier staff sin dejar rastro, y en
--   backups). Redacción: one-shot de las filas ya enviadas + cron horario
--   que redacta todo lo enviado con password_temporal.
-- B#8 · sent_emails no estaba en la publicación realtime → el widget de
--   rebotes del Inicio no se enteraba de rebotes nuevos sin recargar.
-- ============================================================================

-- ── A#10 · one-shot: redactar passwords de envíos ya despachados ─────────────
UPDATE public.email_queue
SET variables = jsonb_set(variables, '{password_temporal}', '"***"')
WHERE enviado_at IS NOT NULL
  AND variables ? 'password_temporal'
  AND variables->>'password_temporal' <> '***';

-- ── A#10 · cron horario de redacción (minuto 40) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.gg_emails_redactar_passwords()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_n int;
BEGIN
  UPDATE public.email_queue
  SET variables = jsonb_set(variables, '{password_temporal}', '"***"')
  WHERE enviado_at IS NOT NULL
    AND variables ? 'password_temporal'
    AND variables->>'password_temporal' <> '***';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END; $$;

REVOKE ALL ON FUNCTION public.gg_emails_redactar_passwords() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'gg-emails-redactar-passwords',
  '40 * * * *',
  'SELECT public.gg_emails_redactar_passwords();'
);

-- ── B#8 · realtime para el widget de rebotes del Inicio ──────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.sent_emails;
