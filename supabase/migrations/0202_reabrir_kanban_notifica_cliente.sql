-- 0202 · Reabrir por kanban: limpia metadata + notifica al cliente (E-GG-54)
--
-- Bug espejo de E-GG-53, encontrado por la doble auditoría (3 agentes):
--   #1) Reabrir un trámite arrastrando la tarjeta en el kanban
--       ('cerrado'/'resuelto' → 'abierto'/'en_progreso', UPDATE directo de
--       estado) NO avisaba a NADIE. Solo el modal `tracking_reabrir` notifica.
--   #2) Ese reabrir por kanban NO limpiaba `motivo_cierre` (solo lo hace la
--       RPC). Como el fix de E-GG-53 usa `motivo_cierre IS NULL` para decidir
--       si notifica al cliente en el cierre, un RE-cierre posterior por kanban
--       quedaba "envenenado" por el motivo_cierre viejo → suprimía el aviso.
--       Hueco en el propio fix 0201.
--
-- Fix (decisión Pablo "limpiar metadata + avisar al cliente", simetría total
-- con el cierre): el reabrir por kanban ahora (a) limpia la metadata de cierre
-- en `tramite_on_update` (BEFORE) — lo que también desactiva el envenenamiento
-- de #2 — y (b) inserta una línea 'reapertura' visible en
-- `_notif_tracking_cerrado_trg` (AFTER) → fan-out al cliente (email + push +
-- campanita) por `tracking_linea_on_insert`, igual que el modal.
--
-- Discriminador anti-duplicado: `NEW.reabierto_count = OLD.reabierto_count`.
-- La RPC `tracking_reabrir` incrementa `reabierto_count` en el MISMO UPDATE que
-- cambia el estado (y ya limpia metadata + inserta su propia línea 'reapertura'
-- visible), así que ambos triggers la detectan y NO duplican. El kanban (UPDATE
-- pelado de estado) no toca el contador → es nuestro caso.
--
-- + Cosmético: seed de las categorías 'cierre' y 'reapertura' en
--   `tracking_categorias_config` (no estaban → el chip mostraba el slug crudo).
--
-- R16: CREATE OR REPLACE (misma firma) → sin overloads.
-- R17: ambas funciones ya son SECURITY DEFINER con search_path fijo.
-- R18: smokes e2e BEGIN/ROLLBACK ejecutados aparte (kanban-reopen notifica,
--      RPC-reopen no duplica, re-cierre tras reabrir vuelve a notificar).

-- ── Catálogo: etiquetas lindas para las líneas de cierre/reapertura ──────────
INSERT INTO public.tracking_categorias_config (id, slug, label, color, icono, orden, servicio_id)
SELECT gen_random_uuid(), v.slug, v.label, v.color, v.icono, v.orden, NULL
FROM (VALUES
  ('cierre',     'Cierre del trámite', 'emerald', 'check', 115),
  ('reapertura', 'Trámite reabierto',  'cyan',    'bell',  118)
) AS v(slug, label, color, icono, orden)
WHERE NOT EXISTS (
  SELECT 1 FROM public.tracking_categorias_config c WHERE c.slug = v.slug
);

-- ── BEFORE UPDATE: limpiar metadata de cierre al reabrir por kanban ──────────
CREATE OR REPLACE FUNCTION public.tramite_on_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_nombre text;
BEGIN
  SELECT full_name INTO v_actor_nombre FROM public.profiles WHERE id = auth.uid();

  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    INSERT INTO public.tramite_eventos (tramite_id, tipo, data, actor_id, actor_nombre)
    VALUES (
      NEW.id,
      CASE
        WHEN NEW.estado IN ('resuelto','cerrado') THEN 'resuelto'
        WHEN OLD.estado IN ('resuelto','cerrado') AND NEW.estado NOT IN ('resuelto','cerrado') THEN 'reabierto'
        ELSE 'cambio_estado'
      END,
      jsonb_build_object('desde', OLD.estado, 'hasta', NEW.estado),
      auth.uid(),
      v_actor_nombre
    );
    NEW.ultima_actividad_at := now();
    IF NEW.estado IN ('resuelto','cerrado') AND OLD.estado NOT IN ('resuelto','cerrado') THEN
      NEW.resuelto_at := now();
      NEW.resuelto_por := auth.uid();
    END IF;
    -- E-GG-54: reapertura por kanban (no por `tracking_reabrir`, que incrementa
    -- reabierto_count y limpia la metadata él mismo). Limpiamos la metadata de
    -- cierre acá → un re-cierre posterior por kanban vuelve a tener
    -- motivo_cierre IS NULL y por ende vuelve a notificar al cliente (cierra el
    -- hueco #2 del fix 0201).
    IF OLD.estado IN ('resuelto','cerrado')
       AND NEW.estado NOT IN ('resuelto','cerrado')
       AND NEW.reabierto_count = OLD.reabierto_count THEN
      NEW.motivo_cierre        := NULL;
      NEW.fecha_fin            := NULL;
      NEW.cierre_satisfactorio := NULL;
      NEW.documento_final_url  := NULL;
      NEW.resuelto_at          := NULL;
      NEW.resuelto_por         := NULL;
      NEW.ultima_reapertura_at := now();
    END IF;
  END IF;

  IF NEW.prioridad IS DISTINCT FROM OLD.prioridad THEN
    INSERT INTO public.tramite_eventos (tramite_id, tipo, data, actor_id, actor_nombre)
    VALUES (
      NEW.id, 'cambio_prioridad',
      jsonb_build_object('desde', OLD.prioridad, 'hasta', NEW.prioridad),
      auth.uid(), v_actor_nombre
    );
    NEW.ultima_actividad_at := now();
  END IF;

  IF NEW.asignado_a IS DISTINCT FROM OLD.asignado_a THEN
    INSERT INTO public.tramite_eventos (tramite_id, tipo, data, actor_id, actor_nombre)
    VALUES (
      NEW.id,
      CASE WHEN NEW.asignado_a IS NULL THEN 'desasignado' ELSE 'asignado' END,
      jsonb_build_object('desde', OLD.asignado_a, 'hasta', NEW.asignado_a),
      auth.uid(), v_actor_nombre
    );
    NEW.ultima_actividad_at := now();
  END IF;

  RETURN NEW;
END;
$function$;

-- ── AFTER UPDATE: notificar al cliente (cierre Y reapertura por kanban) ──────
CREATE OR REPLACE FUNCTION public._notif_tracking_cerrado_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- CIERRE (cualquier vía) → gerentes; + cliente si no vino del modal (mig 0201)
  IF (OLD.estado IS DISTINCT FROM NEW.estado)
     AND NEW.estado IN ('cerrado', 'resuelto') THEN
    PERFORM public.notify_all_gerentes(
      'tracking_cerrado',
      'Trámite cerrado · ' || COALESCE(NEW.titulo, NEW.codigo),
      'Estado: ' || NEW.estado,
      '/gerencia/trackings/' || NEW.id::text,
      jsonb_build_object('tracking_id', NEW.id, 'estado_nuevo', NEW.estado),
      true, 'gerencia-notif-generica', NULL, 4::smallint,
      'tramites', NEW.id
    );
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

  -- E-GG-54: REAPERTURA por kanban (no por `tracking_reabrir`, que ya inserta
  -- su propia línea 'reapertura' visible). Insertamos la línea visible para que
  -- el cliente reciba email + push + campanita por `tracking_linea_on_insert`.
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
