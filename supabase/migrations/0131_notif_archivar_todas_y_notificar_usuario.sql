-- ============================================================================
-- Migration: 0131_notif_archivar_todas_y_notificar_usuario
-- Fecha: 2026-05-29
-- (a) RPC notif_archivar_todas — "Limpiar campanita" (archiva todo del user).
-- (b) RPC notificar_usuario — helper central que dispara campanita + push
--     a la vez para garantizar coherencia push ↔ campanita.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notif_archivar_todas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_count int;
BEGIN
  WITH upd AS (
    UPDATE public.notificaciones_internas
       SET archivado_at = now(),
           leido_at = COALESCE(leido_at, now())
     WHERE user_id = auth.uid() AND archivado_at IS NULL
    RETURNING 1)
  SELECT COUNT(*)::int INTO v_count FROM upd;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.notif_archivar_todas() FROM public;
GRANT EXECUTE ON FUNCTION public.notif_archivar_todas() TO authenticated;

CREATE OR REPLACE FUNCTION public.notificar_usuario(
  p_user_id uuid, p_tipo text, p_titulo text, p_cuerpo text,
  p_url text DEFAULT NULL, p_payload jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_notif_id uuid;
BEGIN
  INSERT INTO public.notificaciones_internas (user_id, tipo, titulo, cuerpo, url, payload)
  VALUES (p_user_id, p_tipo, p_titulo, p_cuerpo, p_url, p_payload)
  RETURNING id INTO v_notif_id;

  INSERT INTO public.push_notifications_queue (user_id, titulo, cuerpo, click_url)
  VALUES (p_user_id, p_titulo, left(p_cuerpo, 240), p_url);

  RETURN v_notif_id;
END;
$$;
REVOKE ALL ON FUNCTION public.notificar_usuario(uuid, text, text, text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.notificar_usuario(uuid, text, text, text, text, jsonb) TO authenticated;
