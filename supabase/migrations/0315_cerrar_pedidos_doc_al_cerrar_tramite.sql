-- 0315 · Auditoría proactiva (ciclo de vida) · pedidos de documentación abiertos
-- sobre un trámite cancelado/cerrado quedaban VIVOS (JL lo vio en TRM-2026-00051).
-- Trigger que los cierra al cambiar el estado del trámite a cancelado/cerrado.
-- SECURITY DEFINER (escribe en tabla con RLS — R17). Incluye limpieza de los
-- huérfanos ya existentes.
CREATE OR REPLACE FUNCTION public.cerrar_pedidos_doc_al_cerrar_tramite()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.estado IN ('cancelado','cerrado') AND OLD.estado IS DISTINCT FROM NEW.estado THEN
    UPDATE public.tramite_pedidos_doc
       SET estado = 'cancelado', cerrado_at = COALESCE(cerrado_at, now())
     WHERE tramite_id = NEW.id AND estado = 'abierto';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_tramite_cerrar_pedidos ON public.tramites;
CREATE TRIGGER trg_tramite_cerrar_pedidos
  AFTER UPDATE OF estado ON public.tramites
  FOR EACH ROW EXECUTE FUNCTION public.cerrar_pedidos_doc_al_cerrar_tramite();

UPDATE public.tramite_pedidos_doc pd
   SET estado = 'cancelado', cerrado_at = COALESCE(cerrado_at, now())
  FROM public.tramites t
 WHERE t.id = pd.tramite_id AND t.estado IN ('cancelado','cerrado') AND pd.estado = 'abierto';
