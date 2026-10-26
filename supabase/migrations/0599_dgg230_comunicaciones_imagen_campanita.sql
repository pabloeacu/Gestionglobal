-- 0599_dgg230_comunicaciones_imagen_campanita.sql
-- DGG-230 · Comunicado oficial del RPAC en el portal del cliente.
--
-- El sistema de Comunicaciones/Novedades (mig 0156) ya cubre banner dismissible
-- por cliente (DB, cross-device, via comunicaciones_destinatarios.visto_at),
-- push y expiracion por fecha (visible_hasta). Para el comunicado del RPAC
-- faltan 3 cosas, todas ADITIVAS y con default que NO cambia el comportamiento
-- de las comunicaciones existentes:
--   1. imagen_url  -> una comunicacion puede traer una imagen; el banner del
--      portal abre un MODAL con esa imagen (ventana emergente) en vez de navegar.
--   2. canal_campanita -> ademas de banner/push/email, emitir una notificacion
--      in-app (campanita). Hoy comunicacion_enviar NO tocaba la campanita.
--   3. deep-link: cuando hay imagen, el push y la campanita llevan a
--      /portal?comunicado=<id> para que el portal abra el modal.
--
-- Reglas aplicadas:
--   R6  (GRANTs explicitos tras recrear la RPC de lectura).
--   R16 (comunicaciones_vigentes_cliente cambia su RETURNS TABLE -> DROP + CREATE,
--        no CREATE OR REPLACE; comunicacion_enviar NO cambia firma -> OR REPLACE ok).
--   R17 (el INSERT a notificaciones_internas -RLS sin policy de write- corre dentro
--        de comunicacion_enviar, que es SECURITY DEFINER -> permitido).
--   R18 (esta mig cambia el flujo INSERT de una RPC -> smoke e2e obligatorio, se
--        corre aparte con BEGIN; PERFORM comunicacion_enviar(...); ROLLBACK).
--   R19 no aplica (sin KPIs). R20 no aplica (sin upload de archivo aca).

BEGIN;

-- 1) Columnas nuevas (aditivas) -------------------------------------------------
ALTER TABLE public.comunicaciones
  ADD COLUMN IF NOT EXISTS imagen_url text,
  ADD COLUMN IF NOT EXISTS canal_campanita boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.comunicaciones.imagen_url IS
  'DGG-230: si no es NULL, el banner del portal abre un modal con esta imagen (ventana emergente) en vez de navegar al cta_url.';
COMMENT ON COLUMN public.comunicaciones.canal_campanita IS
  'DGG-230: ademas de banner/push/email, emite una notificacion in-app (campanita) al enviar.';

-- 2) comunicacion_enviar: deep-link por imagen + canal campanita ----------------
--    Firma SIN cambios (p_id uuid) -> CREATE OR REPLACE conserva GRANTs (R16 ok).
CREATE OR REPLACE FUNCTION public.comunicacion_enviar(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_com record;
  v_user_id uuid := auth.uid();
  v_total int := 0;
  v_emails int := 0;
  v_pushes int := 0;
  v_campanita int := 0;
  v_dest record;
  v_click_url text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_com FROM public.comunicaciones WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'comunicacion no encontrada'; END IF;
  IF v_com.estado = 'enviado' THEN RAISE EXCEPTION 'comunicacion ya enviada'; END IF;

  -- DGG-230: si la comunicacion trae imagen, el push/campanita deep-linkean al
  -- modal (/portal?comunicado=<id>); si no, se respeta el cta_url historico.
  v_click_url := CASE
    WHEN v_com.imagen_url IS NOT NULL THEN '/portal?comunicado=' || v_com.id::text
    ELSE COALESCE(v_com.cta_url, '/portal')
  END;

  INSERT INTO public.comunicaciones_destinatarios (comunicacion_id, administracion_id, user_id, email_to)
  SELECT p_id, a.id, a.user_id, a.email
  FROM public.administraciones a
  WHERE a.id IN (SELECT r.administracion_id FROM public._comunicacion_resolver_audiencia(v_com.audiencia) r)
  ON CONFLICT (comunicacion_id, administracion_id) DO NOTHING;
  GET DIAGNOSTICS v_total = ROW_COUNT;

  FOR v_dest IN
    SELECT d.id, d.administracion_id, d.user_id, d.email_to, a.nombre AS admin_nombre
    FROM public.comunicaciones_destinatarios d
    JOIN public.administraciones a ON a.id = d.administracion_id
    WHERE d.comunicacion_id = p_id
  LOOP
    IF v_com.canal_email AND v_dest.email_to IS NOT NULL AND v_dest.email_to <> '' THEN
      PERFORM public.encolar_email(
        'comunicacion-novedad'::text,
        v_dest.email_to,
        v_dest.admin_nombre,
        jsonb_build_object(
          'nombre_administracion', v_dest.admin_nombre,
          'titulo', v_com.titulo,
          'cuerpo_html', COALESCE(v_com.cuerpo_html, replace(v_com.cuerpo_md, E'\n', '<br>')),
          'cta_label', v_com.cta_label,
          'cta_url', v_com.cta_url
        ),
        NULL::uuid, NULL::uuid,
        'comunicaciones'::text, p_id, 5::smallint
      );
      UPDATE public.comunicaciones_destinatarios SET email_enqueued_at = now() WHERE id = v_dest.id;
      v_emails := v_emails + 1;
    END IF;

    IF v_com.canal_push AND v_dest.user_id IS NOT NULL THEN
      PERFORM public.encolar_push(
        v_dest.user_id, v_com.titulo, left(v_com.cuerpo_md, 140),
        '/icons/icon-192.png', v_click_url
      );
      UPDATE public.comunicaciones_destinatarios SET push_enqueued_at = now() WHERE id = v_dest.id;
      v_pushes := v_pushes + 1;
    END IF;

    -- DGG-230: campanita in-app. INSERT directo (NO notificar_usuario/notif_emitir)
    -- a proposito, para NO duplicar el push -que ya se encolo arriba-. Esta RPC es
    -- SECURITY DEFINER, asi que el INSERT pasa la RLS de notificaciones_internas (R17).
    IF v_com.canal_campanita AND v_dest.user_id IS NOT NULL THEN
      INSERT INTO public.notificaciones_internas (user_id, tipo, titulo, cuerpo, url, payload)
      VALUES (
        v_dest.user_id,
        'comunicado',
        v_com.titulo,
        left(v_com.cuerpo_md, 240),
        v_click_url,
        jsonb_build_object('comunicacion_id', v_com.id)
      );
      v_campanita := v_campanita + 1;
    END IF;
  END LOOP;

  UPDATE public.comunicaciones SET estado = 'enviado', enviado_at = now(), enviado_por = v_user_id, total_destinatarios = v_total
  WHERE id = p_id;

  RETURN jsonb_build_object(
    'comunicacion_id', p_id,
    'destinatarios', v_total,
    'emails_encolados', v_emails,
    'pushes_encolados', v_pushes,
    'campanita_encoladas', v_campanita
  );
END $function$;

-- 3) comunicaciones_vigentes_cliente: sumar imagen_url al retorno (R16: DROP+CREATE)
DROP FUNCTION IF EXISTS public.comunicaciones_vigentes_cliente();

CREATE FUNCTION public.comunicaciones_vigentes_cliente()
 RETURNS TABLE(
   id uuid,
   titulo text,
   cuerpo_md text,
   cta_label text,
   cta_url text,
   imagen_url text,
   banner_estilo text,
   enviado_at timestamp with time zone,
   visto_at timestamp with time zone
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT c.id, c.titulo, c.cuerpo_md, c.cta_label, c.cta_url, c.imagen_url,
           c.banner_estilo, c.enviado_at, d.visto_at
    FROM public.comunicaciones c
    JOIN public.comunicaciones_destinatarios d ON d.comunicacion_id = c.id
    JOIN public.administraciones a ON a.id = d.administracion_id
    WHERE c.estado = 'enviado' AND c.canal_banner = true
      AND c.visible_desde <= now()
      AND (c.visible_hasta IS NULL OR c.visible_hasta > now())
      AND a.user_id = v_uid
    ORDER BY c.enviado_at DESC;
END $function$;

GRANT EXECUTE ON FUNCTION public.comunicaciones_vigentes_cliente() TO authenticated, service_role;
-- R6: el DROP+CREATE restaura el EXECUTE default a PUBLIC; re-aplicamos el REVOKE
-- que la mig 0156 tenía (no es fuga -la fn filtra por auth.uid()- pero mantiene
-- la postura de grants sin drift). (§6 DGG-230, hallazgo mig n5.)
REVOKE EXECUTE ON FUNCTION public.comunicaciones_vigentes_cliente() FROM PUBLIC, anon;

COMMIT;
