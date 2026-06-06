-- 0201 · El cierre por kanban / cambio de estado también notifica al cliente (E-GG-53)
--
-- Bug (caso JL, 05/06/2026 · trámite "Certificado de acreditación RPAC" de
-- Estudio Save): al cerrar un trámite moviéndolo en el kanban (UPDATE directo
-- estado='cerrado'), sólo se disparaba `_notif_tracking_cerrado_trg` → mail a
-- gerentes. El cliente NUNCA se enteraba. La notificación al cliente vivía
-- ÚNICAMENTE en el modal `tracking_cerrar`, que inserta una línea visible →
-- `tracking_linea_on_insert` → email + push + campanita. Resultado: el gerente
-- recibió "Trámite cerrado…" pero estudio.saveriano@gmail.com no recibió nada.
-- No era DNS/DMARC (esa casilla venía recibiendo todo `sent`): el mail NUNCA
-- se encoló porque el cierre no pasó por el modal.
--
-- Fix (decisión Pablo "avisar siempre al cliente", 2026-06-06): el trigger
-- universal de cierre — que ya corre para CUALQUIER vía que cambie el estado —
-- inserta la línea de cierre visible cuando el cierre NO vino del modal. Así el
-- cliente recibe email + push + campanita + la ve en el portal, idéntico al
-- modal, sin importar cómo cerró el gerente.
--
-- Discriminador anti-duplicado: `motivo_cierre IS NULL`. El modal
-- `tracking_cerrar` setea `motivo_cierre` (NOT NULL) en el MISMO UPDATE, por lo
-- que el trigger AFTER lo ve y NO duplica (la línea del modal ya notifica).
-- `tracking_reabrir` limpia `motivo_cierre`, así que un re-cierre por kanban
-- tras reabrir sí notifica. Además sólo en la 1ª transición a terminal
-- (OLD.estado no terminal) para no duplicar en resuelto→cerrado.
--
-- R16: CREATE OR REPLACE de función trigger (misma firma) → sin overloads.
-- R17: ya es SECURITY DEFINER con search_path fijo (escribe en tabla con RLS).
-- R18: smoke e2e BEGIN/ROLLBACK ejecutado por separado (ver chunk).

CREATE OR REPLACE FUNCTION public._notif_tracking_cerrado_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (OLD.estado IS DISTINCT FROM NEW.estado)
     AND NEW.estado IN ('cerrado', 'resuelto') THEN
    -- Notificación a gerencia (sin cambios respecto del comportamiento previo).
    PERFORM public.notify_all_gerentes(
      'tracking_cerrado',
      'Trámite cerrado · ' || COALESCE(NEW.titulo, NEW.codigo),
      'Estado: ' || NEW.estado,
      '/gerencia/trackings/' || NEW.id::text,
      jsonb_build_object('tracking_id', NEW.id, 'estado_nuevo', NEW.estado),
      true, 'gerencia-notif-generica', NULL, 4::smallint,
      'tramites', NEW.id
    );

    -- E-GG-53: si el cierre NO pasó por el modal `tracking_cerrar` (que ya
    -- crea su propia línea visible y notifica al cliente), generamos nosotros
    -- la línea de cierre visible para que el cliente reciba email + push +
    -- campanita igual que por el modal. `tracking_linea_on_insert` hace el
    -- fan-out. Sólo en la 1ª transición a terminal (evita doble resuelto→cerrado).
    IF NEW.motivo_cierre IS NULL
       AND OLD.estado NOT IN ('cerrado', 'resuelto') THEN
      INSERT INTO public.tracking_lineas (
        tramite_id, categoria, descripcion, estado_asociado,
        archivos_urls, autor_id, visible_cliente
      ) VALUES (
        NEW.id, 'cierre',
        'Tu trámite fue cerrado.',
        'finalizado', '{}'::text[], auth.uid(), true
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
