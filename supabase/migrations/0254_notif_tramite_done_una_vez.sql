-- ============================================================================
-- 0254_notif_tramite_done_una_vez.sql
-- DGG-88 · El aviso a gerencia "trámite terminado" se manda UNA sola vez, al
-- ENTRAR a "terminado" (resuelto o cerrado) desde un estado no-terminado. NO se
-- re-avisa en la progresión interna resuelto→cerrado → corta el doble aviso y el
-- ruido del cron de cursos. Copy según el estado real (antes decía siempre
-- "Trámite cerrado", aun en resuelto). Decisión de Pablo (opción 1).
-- Además: la línea visible al cliente toma el copy correcto, y se saltea en
-- cursos-a-resuelto (el trigger del certificado ya deja su propia línea).
-- ============================================================================
CREATE OR REPLACE FUNCTION public._notif_tracking_cerrado_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_resuelto boolean;
BEGIN
  v_resuelto := (NEW.estado = 'resuelto');

  IF (OLD.estado IS DISTINCT FROM NEW.estado)
     AND NEW.estado IN ('cerrado', 'resuelto')
     AND OLD.estado NOT IN ('cerrado', 'resuelto') THEN
    -- Push a gerencia: una vez, con copy según estado.
    PERFORM public.notify_all_gerentes(
      'tracking_cerrado',
      (CASE WHEN v_resuelto THEN 'Trámite resuelto · ' ELSE 'Trámite cerrado · ' END)
        || COALESCE(NEW.titulo, NEW.codigo),
      'Estado: ' || NEW.estado,
      '/gerencia/trackings/' || NEW.id::text,
      jsonb_build_object('tracking_id', NEW.id, 'estado_nuevo', NEW.estado),
      true, 'gerencia-notif-generica', NULL, 4::smallint,
      'tramites', NEW.id
    );
    -- Línea visible al cliente. Saltear si ya hay motivo de cierre (lo puso el
    -- modal de cierre con su línea) o si es un curso pasando a resuelto (la línea
    -- la deja el trigger del certificado).
    IF NEW.motivo_cierre IS NULL
       AND NOT (v_resuelto AND NEW.categoria = 'curso') THEN
      INSERT INTO public.tracking_lineas (
        tramite_id, categoria, descripcion, estado_asociado,
        archivos_urls, autor_id, visible_cliente
      ) VALUES (
        NEW.id,
        CASE WHEN v_resuelto THEN 'resuelto' ELSE 'cierre' END,
        CASE WHEN v_resuelto THEN 'Tu trámite fue resuelto.' ELSE 'Tu trámite fue cerrado.' END,
        'finalizado', '{}'::text[], auth.uid(), true
      );
    END IF;
  ELSIF (OLD.estado IS DISTINCT FROM NEW.estado)
        AND OLD.estado IN ('cerrado', 'resuelto')
        AND NEW.estado NOT IN ('cerrado', 'resuelto')
        AND NEW.reabierto_count = OLD.reabierto_count THEN
    INSERT INTO public.tracking_lineas (
      tramite_id, categoria, descripcion, estado_asociado,
      archivos_urls, autor_id, visible_cliente
    ) VALUES (
      NEW.id, 'reapertura',
      'Tu trámite fue reabierto: seguimos trabajando en él.',
      'reabierto', '{}'::text[], auth.uid(), true
    );
  END IF;
  RETURN NEW;
END;
$function$;
