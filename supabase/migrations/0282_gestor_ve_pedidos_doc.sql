-- 0282 · Panel del gestor externo: sumar los documentos que el cliente sube
-- por "Pedido de Documentación" (bucket pedidos-doc-cliente), no sólo los del
-- formulario original. Pieza 2 de E-GG-91 (e) — reporte JL.
--
-- Contexto: el gestor externo entra por token (sin login) y veía SÓLO
-- `formulario_adjuntos` (lo que el cliente subió en el formulario inicial).
-- Cuando gerencia le pide MÁS documentación al cliente (tramite_pedidos_doc /
-- _items) esos archivos no aparecían en el panel del gestor, aunque son
-- exactamente lo que la gestoría necesita para avanzar. Este es el hueco que
-- reportó JL (parte 2 del circuito e).
--
-- R16: MISMA firma (p_token text) → CREATE OR REPLACE seguro, sin overload
--      (verificado antes de esta migración: 1 sola firma en el catálogo).
--      Sólo se AGREGA la clave `pedidos_doc` al jsonb de retorno; el resto
--      del contrato (adjuntos, datos, etc.) queda intacto.
-- Se muestran sólo items subido/aprobado con archivo (excluye 'pendiente' =
-- sin archivo, y 'rechazado' = invalidado por gerencia, que no debe ofrecerse
-- a un tercero externo).
-- Los grants a anon/authenticated se re-afirman explícitos (el gestor es anon).

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
  v_pedidos_doc jsonb;   -- NUEVO (0282): docs subidos por el cliente a pedido
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
    -- Adjuntos del formulario con la consigna (label) que completa cada uno.
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

  -- NUEVO (0282): documentos que el cliente subió a los "Pedidos de
  -- Documentación" de ESTE trámite. Se firman aparte (bucket
  -- pedidos-doc-cliente) vía la edge fn gestor-firmar-adjunto v2.
  IF v_sol.tramite_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'descripcion', it.descripcion,
        'filename_original', COALESCE(it.archivo_nombre, 'archivo'),
        'storage_path', it.archivo_path,
        'estado', it.estado,
        'subido_at', it.subido_at
      ) ORDER BY it.subido_at NULLS LAST), '[]'::jsonb)
      INTO v_pedidos_doc
      FROM public.tramite_pedidos_doc pd
      JOIN public.tramite_pedidos_doc_items it ON it.pedido_id = pd.id
     WHERE pd.tramite_id = v_sol.tramite_id
       AND it.archivo_path IS NOT NULL
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
    'pedidos_doc',        COALESCE(v_pedidos_doc, '[]'::jsonb),  -- NUEVO (0282)
    'created_at',         v_sol.created_at
  );
END;
$function$;

-- El gestor entra como anon; re-afirmamos los grants explícitos (idempotente).
GRANT EXECUTE ON FUNCTION public.gestor_obtener_info_solicitud(text) TO anon, authenticated;

-- Smoke (R18-lite): la función compila y la firma sigue siendo única.
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='gestor_obtener_info_solicitud';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'smoke 0282: se esperaba 1 firma de gestor_obtener_info_solicitud, hay %', v_n;
  END IF;
  RAISE NOTICE 'smoke 0282 OK: gestor_obtener_info_solicitud única, pedidos_doc agregado';
END $$;
