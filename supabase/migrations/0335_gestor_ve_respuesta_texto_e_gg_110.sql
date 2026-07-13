-- 0335 · E-GG-110 (doc JL wave 5): la gestoría no veía la Nota de texto del cliente.
--
-- Reporte JL: al gestor le llega el mail "info nueva disponible" cuando el
-- cliente completa un pedido de documentación, pero si respondió con una NOTA
-- de texto (no un archivo), en el panel de gestoría no aparecía nada. Causa:
-- gestor_obtener_info_solicitud agregaba los items del pedido con
-- `AND it.archivo_path IS NOT NULL` → sólo los que tenían archivo; las
-- respuestas de texto (respuesta_texto, sin archivo) quedaban excluidas.
--
-- Fix: incluir items con archivo O con respuesta_texto, y devolver el texto.
-- Misma firma → CREATE OR REPLACE (R16 ok, sin overload).

CREATE OR REPLACE FUNCTION public.gestor_obtener_info_solicitud(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_acc public.accesos_externos%ROWTYPE;
  v_sol public.solicitudes%ROWTYPE;
  v_servicio_nombre text;
  v_datos jsonb;
  v_form_titulo text;
  v_form_categoria text;
  v_form_schema jsonb;
  v_adjuntos jsonb;
  v_pedidos_doc jsonb;
BEGIN
  SELECT * INTO v_acc FROM public.accesos_externos WHERE token = p_token;
  IF v_acc.token IS NULL THEN
    RAISE EXCEPTION 'Token inválido' USING ERRCODE = '42501';
  END IF;
  IF v_acc.revocado_at IS NOT NULL OR v_acc.vence_at < now() THEN
    RAISE EXCEPTION 'Token revocado o vencido' USING ERRCODE = '42501';
  END IF;
  IF v_acc.recurso_tipo NOT IN ('solicitud','tramite') THEN
    RAISE EXCEPTION 'Token no asociado a una solicitud' USING ERRCODE = '22023';
  END IF;

  IF v_acc.recurso_tipo = 'solicitud' THEN
    SELECT * INTO v_sol FROM public.solicitudes WHERE id = v_acc.recurso_id;
  ELSE
    SELECT * INTO v_sol FROM public.solicitudes WHERE tramite_id = v_acc.recurso_id LIMIT 1;
  END IF;
  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF v_sol.servicio_solicitado_id IS NOT NULL THEN
    SELECT nombre INTO v_servicio_nombre FROM public.servicios WHERE id = v_sol.servicio_solicitado_id;
  END IF;

  IF v_sol.formulario_submission_id IS NOT NULL THEN
    SELECT fs.datos, f.titulo, f.categoria, f.schema
      INTO v_datos, v_form_titulo, v_form_categoria, v_form_schema
      FROM public.formulario_submissions fs
      JOIN public.formularios f ON f.id = fs.formulario_id
     WHERE fs.id = v_sol.formulario_submission_id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'field_name', fa.field_name,
        'label', private.form_field_label(v_form_schema, fa.field_name),
        'filename_original', fa.filename_original,
        'storage_path', fa.storage_path
      ) ORDER BY fa.uploaded_at), '[]'::jsonb)
      INTO v_adjuntos
      FROM public.formulario_adjuntos fa
      WHERE fa.submission_id = v_sol.formulario_submission_id;
  ELSE
    v_datos := '{}'::jsonb;
    v_adjuntos := '[]'::jsonb;
  END IF;

  IF v_sol.tramite_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'descripcion', it.descripcion,
        'filename_original', COALESCE(it.archivo_nombre, 'archivo'),
        'storage_path', it.archivo_path,
        'respuesta_texto', it.respuesta_texto,
        'estado', it.estado,
        'subido_at', it.subido_at
      ) ORDER BY it.subido_at NULLS LAST), '[]'::jsonb)
      INTO v_pedidos_doc
      FROM public.tramite_pedidos_doc pd
      JOIN public.tramite_pedidos_doc_items it ON it.pedido_id = pd.id
     WHERE pd.tramite_id = v_sol.tramite_id
       AND (it.archivo_path IS NOT NULL OR it.respuesta_texto IS NOT NULL)
       AND it.estado IN ('subido','aprobado');
  ELSE
    v_pedidos_doc := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'solicitud_id', v_sol.id,
    'servicio',           COALESCE(v_servicio_nombre, v_sol.servicio_slug, 'Servicio'),
    'solicitante_nombre', COALESCE(v_sol.solicitante_nombre, ''),
    'solicitante_email',  COALESCE(v_sol.solicitante_email, ''),
    'solicitante_telefono', COALESCE(v_sol.solicitante_telefono, ''),
    'formulario_titulo',  v_form_titulo,
    'formulario_categoria', v_form_categoria,
    'datos',              COALESCE(v_datos, '{}'::jsonb),
    'adjuntos',           v_adjuntos,
    'pedidos_doc',        COALESCE(v_pedidos_doc, '[]'::jsonb),
    'created_at',         v_sol.created_at
  );
END;
$function$;
