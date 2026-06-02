-- ============================================================================
-- 0179 · E-GG-38 · Fix RLS de tramite_eventos vía SECURITY DEFINER en triggers
--
-- BUG: la tabla `tramite_eventos` tiene RLS habilitada y SOLO policies SELECT.
-- Los 4 triggers que escriben en ella (tramite_on_insert/update y
-- tramite_on_adjunto_insert/comentario_insert) NO eran SECURITY DEFINER →
-- corrían con los permisos del usuario invoker → bloqueados por RLS con 42501.
--
-- Síntoma en producción (reportado por José Luis, 2026-06-02):
-- mover trámite en el kanban → "No tenés permisos para realizar esta acción".
-- En realidad afectaba a TODOS los authenticated users (gerentes incluidos),
-- no solo a JL.
--
-- FIX: convertir los 4 triggers a SECURITY DEFINER. Es lo correcto:
--   - Los logs de eventos son automáticos, no son una operación del usuario.
--   - auth.uid() sigue retornando el usuario original (queremos el actor real).
--   - No hace falta abrir policy INSERT en tramite_eventos (mantiene cero
--     superficie de escritura directa desde el cliente).
--
-- search_path explícito mantiene la práctica de seguridad (R12 lookalike).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tramite_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_nombre text;
BEGIN
  SELECT full_name INTO v_actor_nombre FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.tramite_eventos (tramite_id, tipo, data, actor_id, actor_nombre)
  VALUES (
    NEW.id, 'creado',
    jsonb_build_object('categoria', NEW.categoria, 'origen',
      CASE WHEN NEW.formulario_submission_id IS NOT NULL THEN 'formulario'
           WHEN auth.uid() IS NULL THEN 'sistema'
           ELSE 'manual' END),
    auth.uid(), COALESCE(v_actor_nombre, 'Sistema')
  );
  RETURN NEW;
END;
$function$;

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

CREATE OR REPLACE FUNCTION public.tramite_on_adjunto_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.tramites
    SET total_adjuntos = total_adjuntos + 1,
        ultima_actividad_at = now()
   WHERE id = NEW.tramite_id;

  INSERT INTO public.tramite_eventos (tramite_id, tipo, data, actor_id)
  VALUES (
    NEW.tramite_id,
    'adjunto',
    jsonb_build_object('adjunto_id', NEW.id, 'filename', NEW.filename_original),
    NEW.subido_por
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tramite_on_comentario_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.tramites
    SET total_comentarios = total_comentarios + 1,
        ultima_actividad_at = now()
   WHERE id = NEW.tramite_id;

  INSERT INTO public.tramite_eventos (tramite_id, tipo, data, actor_id, actor_nombre)
  VALUES (
    NEW.tramite_id,
    'comentario',
    jsonb_build_object('visible_para', NEW.visible_para, 'comentario_id', NEW.id),
    NEW.autor_id,
    NEW.autor_nombre
  );
  RETURN NEW;
END;
$function$;
