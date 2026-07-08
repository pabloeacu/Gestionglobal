-- 0281 · E-GG-91 · tracking_lineas en realtime para el widget "Aportes de gestoría"
-- del inicio de gerencia (que aparezca en vivo cuando la gestoría manda un aporte,
-- no sólo al recargar). Idempotente. RLS de tracking_lineas ya filtra por staff.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='tracking_lineas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tracking_lineas;
  END IF;
END $$;
