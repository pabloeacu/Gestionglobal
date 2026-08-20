-- ============================================================================
-- 0430_jlr2_adjuntos_avance_al_cliente.sql
-- JL-R2 (reporte JL, doc 2026-08-19) · Caso Sardón (trámite a3b252a7, línea
-- f207aa7e con "FICHA_BOLETA_Y_PAGO.pdf" + "CIRCULAR_ANTECEDENTES.pdf"):
-- gestoría subió los adjuntos, gerencia los ve en las Líneas de Avance, pero
-- el MAIL al cliente salía SIN los adjuntos — y "No pude hacer desde el
-- Sistema un nuevo envío con los adjuntos que No le llegaron".
--
-- Causa raíz: private.tracking_notificar_avance_cliente encola
-- 'tracking-avance-cliente' con descripción + link al portal, pero NUNCA
-- setea email_queue.attachments_jsonb. Y no existía forma de re-disparar el
-- aviso al cliente para una línea ya publicada.
--
-- Fix (quirúrgico):
--  (1) Helper private.gestor_uploads_attachments(text[]) — mapea las URLs de
--      archivos de la línea (bucket privado gestor-uploads) a la forma que el
--      dispatcher entiende ({filename, storage_bucket, storage_path,
--      content_type}), con nombre limpio (sin el prefijo técnico del storage).
--  (2) tracking_notificar_avance_cliente: tras encolar, si la línea tiene
--      adjuntos de gestor-uploads, los adjunta al mail (UPDATE del row).
--  (3) RPC pública tracking_reenviar_avance_cliente(linea) — staff-only, sólo
--      líneas visibles al cliente — re-dispara el aviso (mail c/adjuntos +
--      push + campanita). Es el "nuevo envío" que pedía JL.
--
-- Seguridad (por qué se puede whitelistear gestor-uploads en el dispatcher):
-- email_queue tiene RLS INSERT/UPDATE gated por private.is_staff(); un cliente
-- NO puede encolar mails ni setear attachments_jsonb. Los únicos productores
-- de adjuntos gestor-uploads son estas RPCs SECURITY DEFINER (que derivan el
-- path de la propia línea y mandan al cliente del mismo tenant) o staff, que
-- ya tiene acceso total al bucket (gestor_up_staff_all). No hay vector nuevo.
-- ============================================================================

-- (1) Helper: URLs de archivos de la línea → attachments_jsonb del dispatcher.
-- Sólo considera archivos del bucket gestor-uploads (los que el dispatcher
-- podrá bajar tras whitelistear el bucket). Nombre = último segmento del path
-- sin el prefijo "<epoch>-<rand>-" que agrega el storage key.
CREATE OR REPLACE FUNCTION private.gestor_uploads_attachments(p_archivos text[])
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(jsonb_agg(x.att ORDER BY x.ord), '[]'::jsonb)
  FROM (
    SELECT ord,
      jsonb_build_object(
        'filename', regexp_replace(regexp_replace(sp, '^.*/', ''), '^[0-9]+-[a-z0-9]+-', ''),
        'storage_bucket', 'gestor-uploads',
        'storage_path', sp,
        'content_type', CASE lower(regexp_replace(sp, '^.*\.', ''))
          WHEN 'pdf'  THEN 'application/pdf'
          WHEN 'jpg'  THEN 'image/jpeg'
          WHEN 'jpeg' THEN 'image/jpeg'
          WHEN 'png'  THEN 'image/png'
          WHEN 'webp' THEN 'image/webp'
          WHEN 'heic' THEN 'image/heic'
          WHEN 'doc'  THEN 'application/msword'
          WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          WHEN 'xls'  THEN 'application/vnd.ms-excel'
          WHEN 'xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          ELSE 'application/octet-stream'
        END
      ) AS att
    FROM (
      SELECT ord, split_part(split_part(au, '?', 1), '/gestor-uploads/', 2) AS sp
      FROM unnest(p_archivos) WITH ORDINALITY AS t(au, ord)
      WHERE au LIKE '%/gestor-uploads/%'
    ) s
    WHERE sp <> ''
  ) x;
$function$;

-- (2) Notificar avance al cliente: ahora adjunta los archivos de la línea.
CREATE OR REPLACE FUNCTION private.tracking_notificar_avance_cliente(p_linea_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_linea public.tracking_lineas%ROWTYPE; v_tramite record; v_svc text;
  v_to_email text; v_to_nombre text; v_admin_user_id uuid; v_portal_url text;
  v_email_id uuid; v_att jsonb;
BEGIN
  SELECT * INTO v_linea FROM public.tracking_lineas WHERE id = p_linea_id;
  IF v_linea.id IS NULL THEN RETURN; END IF;
  SELECT t.*, s.nombre AS svc_nombre INTO v_tramite
    FROM public.tramites t LEFT JOIN public.servicios s ON s.id = t.servicio_id WHERE t.id = v_linea.tramite_id;
  v_svc := COALESCE(v_tramite.svc_nombre, v_tramite.titulo, 'Trámite');
  v_to_nombre := COALESCE(v_tramite.solicitante_nombre, '');
  IF v_tramite.administracion_id IS NOT NULL THEN
    v_to_email := public.admin_login_email(v_tramite.administracion_id);
  END IF;
  v_to_email := COALESCE(NULLIF(v_to_email,''), NULLIF(v_tramite.solicitante_email,''));
  IF v_to_email IS NULL AND v_tramite.administracion_id IS NOT NULL THEN
    SELECT email, nombre INTO v_to_email, v_to_nombre FROM public.administraciones WHERE id = v_tramite.administracion_id;
  END IF;
  IF v_tramite.administracion_id IS NOT NULL THEN
    SELECT user_id INTO v_admin_user_id FROM public.administraciones WHERE id = v_tramite.administracion_id;
  END IF;
  v_portal_url := 'https://www.gestionglobal.ar/portal/gestiones/' || v_linea.tramite_id::text;
  IF v_to_email IS NOT NULL THEN
    BEGIN
      v_email_id := public.encolar_email('tracking-avance-cliente', v_to_email, v_to_nombre,
        jsonb_build_object('destinatario_nombre', COALESCE(NULLIF(v_to_nombre, ''), 'cliente'),
          'tipo', v_svc, 'descripcion', v_linea.descripcion, 'portal_url', v_portal_url),
        v_tramite.administracion_id, v_tramite.consorcio_id, 'tracking_lineas', v_linea.id, 3::smallint);
      -- JL-R2: adjuntar los archivos de la línea (bucket privado gestor-uploads)
      -- para que el cliente los reciba en el mail, no sólo en el portal.
      v_att := private.gestor_uploads_attachments(v_linea.archivos_urls);
      IF v_email_id IS NOT NULL AND v_att IS NOT NULL AND v_att <> '[]'::jsonb THEN
        UPDATE public.email_queue SET attachments_jsonb = v_att WHERE id = v_email_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF v_admin_user_id IS NOT NULL THEN
    BEGIN
      PERFORM public.encolar_push(v_admin_user_id, 'Nuevo avance: ' || v_svc, substring(v_linea.descripcion, 1, 140), NULL, v_portal_url);
    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN
      PERFORM private.notif_emitir(v_admin_user_id, 'tracking_avance', 'Nuevo avance: ' || v_svc,
        substring(v_linea.descripcion, 1, 200), '/portal/gestiones/' || v_linea.tramite_id::text,
        jsonb_build_object('tramite_id', v_linea.tramite_id, 'linea_id', v_linea.id, 'servicio', v_svc));
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END;
$function$;

-- (3) Reenvío manual (staff) del aviso al cliente — el "nuevo envío" de JL.
DROP FUNCTION IF EXISTS public.tracking_reenviar_avance_cliente(uuid);
CREATE FUNCTION public.tracking_reenviar_avance_cliente(p_linea_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_linea public.tracking_lineas%ROWTYPE;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede reenviar al cliente' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_linea FROM public.tracking_lineas WHERE id = p_linea_id;
  IF v_linea.id IS NULL THEN RAISE EXCEPTION 'La línea no existe'; END IF;
  IF NOT v_linea.visible_cliente THEN
    RAISE EXCEPTION 'Esta línea no está publicada al cliente; publicala antes de reenviar';
  END IF;
  PERFORM private.tracking_notificar_avance_cliente(p_linea_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.tracking_reenviar_avance_cliente(uuid) TO authenticated;

-- Smoke R16: sin overloads ambiguos en las funciones tocadas.
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM (
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='public' AND p.proname IN ('tracking_reenviar_avance_cliente'))
       OR (n.nspname='private' AND p.proname IN ('tracking_notificar_avance_cliente','gestor_uploads_attachments'))
    GROUP BY p.proname HAVING count(*) > 1
  ) t;
  IF v_n > 0 THEN RAISE EXCEPTION 'JL-R2: overload ambiguo (R16)'; END IF;
END $$;
