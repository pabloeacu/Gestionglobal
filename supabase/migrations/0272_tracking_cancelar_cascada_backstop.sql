-- DGG-95 §6 (segunda pasada) · La página VIVA de detalle es TrackingDetailPage
-- (la ruta /gerencia/tramites/:id redirige a /gerencia/trackings/:id). Ahí el estado
-- se cambiaba vía tracking_agregar_linea / tracking_moderar_gestor_avance con un
-- UPDATE tramites SET estado='cancelado' CRUDO → saltaba la cascada tramite_cancelar
-- (deuda fantasma, el bug que reportó JL). El UI ahora cancela por el botón dedicado
-- (useCancelarTramite → tramite_cancelar), pero acá dejamos el BACKSTOP en BD: cualquier
-- caller que intente setear 'cancelado' pasa por tramite_cancelar (anula el comprobante
-- no-fiscal → saldo a favor; omite CAE). Ningún camino deja deuda silenciosa.

CREATE OR REPLACE FUNCTION public.tracking_agregar_linea(
  p_tramite_id uuid, p_categoria text, p_descripcion text,
  p_estado_asociado text DEFAULT NULL::text, p_archivos_urls text[] DEFAULT '{}'::text[],
  p_alerta_en timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_visible_cliente boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin uuid;
  v_id uuid;
BEGIN
  SELECT administracion_id INTO v_admin FROM public.tramites WHERE id = p_tramite_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tracking no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT private.is_staff() THEN
    IF v_admin IS NULL THEN
      RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
    PERFORM private.assert_administracion_access(v_admin);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tracking_categorias_config WHERE slug = p_categoria
  ) THEN
    RAISE EXCEPTION 'Categoría inválida: %', p_categoria USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, estado_asociado, archivos_urls,
    alerta_en, autor_id, visible_cliente
  ) VALUES (
    p_tramite_id, p_categoria, p_descripcion, p_estado_asociado,
    COALESCE(p_archivos_urls, '{}'::text[]), p_alerta_en, auth.uid(),
    COALESCE(p_visible_cliente, false)
  )
  RETURNING id INTO v_id;

  IF p_estado_asociado IS NOT NULL AND private.is_staff() THEN
    IF p_estado_asociado = 'cancelado' THEN
      -- DGG-95 backstop: cancelar cascadea (anula comprobante no-fiscal → saldo a favor).
      PERFORM public.tramite_cancelar(p_tramite_id, true, 'Cancelado desde tracking');
    ELSE
      UPDATE public.tramites
        SET estado = CASE
          WHEN p_estado_asociado IN ('abierto','en_progreso','esperando_cliente','resuelto','cerrado')
            THEN p_estado_asociado
          ELSE estado
        END,
        ultima_actividad_at = now()
       WHERE id = p_tramite_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tracking_moderar_gestor_avance(
  p_linea_id uuid, p_accion text, p_descripcion text DEFAULT NULL::text,
  p_archivos_urls text[] DEFAULT NULL::text[], p_estado_asociado text DEFAULT NULL::text,
  p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_linea public.tracking_lineas%ROWTYPE;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Sólo gerencia puede moderar' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_linea FROM public.tracking_lineas WHERE id = p_linea_id;
  IF v_linea.id IS NULL THEN
    RAISE EXCEPTION 'Línea no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_linea.categoria <> 'gestor_avance' OR v_linea.moderacion_estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La línea no está pendiente de moderación' USING ERRCODE = '22023';
  END IF;

  IF p_estado_asociado IS NOT NULL
     AND p_estado_asociado NOT IN ('abierto','en_progreso','esperando_cliente','resuelto','cerrado','cancelado') THEN
    RAISE EXCEPTION 'Estado asociado inválido: %', p_estado_asociado USING ERRCODE = '22023';
  END IF;
  IF p_descripcion IS NOT NULL AND trim(p_descripcion) = '' THEN
    RAISE EXCEPTION 'La descripción no puede quedar vacía' USING ERRCODE = '22023';
  END IF;

  IF p_descripcion IS NOT NULL THEN
    UPDATE public.tracking_lineas SET descripcion = trim(p_descripcion) WHERE id = p_linea_id;
  END IF;
  IF p_archivos_urls IS NOT NULL THEN
    UPDATE public.tracking_lineas SET archivos_urls = p_archivos_urls WHERE id = p_linea_id;
  END IF;

  IF p_accion = 'publicar' THEN
    UPDATE public.tracking_lineas
       SET visible_cliente = true, moderacion_estado = 'publicado',
           estado_asociado = COALESCE(p_estado_asociado, estado_asociado),
           moderada_at = now(), moderada_por = auth.uid()
     WHERE id = p_linea_id;
    IF p_estado_asociado = 'cancelado' THEN
      -- DGG-95 backstop: cancelar cascadea (anula comprobante no-fiscal → saldo a favor).
      PERFORM public.tramite_cancelar(v_linea.tramite_id, true, 'Cancelado desde moderación');
    ELSIF p_estado_asociado IS NOT NULL THEN
      UPDATE public.tramites SET estado = p_estado_asociado, ultima_actividad_at = now()
       WHERE id = v_linea.tramite_id;
    END IF;
    PERFORM private.tracking_notificar_avance_cliente(p_linea_id);

  ELSIF p_accion = 'interno' THEN
    UPDATE public.tracking_lineas
       SET visible_cliente = false, moderacion_estado = 'interno',
           moderada_at = now(), moderada_por = auth.uid()
     WHERE id = p_linea_id;

  ELSIF p_accion = 'descartar' THEN
    UPDATE public.tracking_lineas
       SET visible_cliente = false, moderacion_estado = 'descartado',
           descarte_motivo = NULLIF(trim(COALESCE(p_motivo, '')), ''),
           moderada_at = now(), moderada_por = auth.uid()
     WHERE id = p_linea_id;

  ELSE
    RAISE EXCEPTION 'Acción inválida: %', p_accion USING ERRCODE = '22023';
  END IF;
END;
$function$;
