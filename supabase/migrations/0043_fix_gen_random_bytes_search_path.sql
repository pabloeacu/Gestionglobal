-- 0043 · E-GG-05 · Fix generar_acceso_externo: "function gen_random_bytes(integer)
-- does not exist".
--
-- Causa: pgcrypto vive en el schema `extensions` (default de Supabase), pero el
-- RPC tenía `SET search_path TO 'public', 'pg_temp'` y llamaba gen_random_bytes
-- sin calificar. Resultado: el token nunca se generaba y "Compartir externo" /
-- toda generación de acceso externo fallaba.
--
-- Fix (defensa en profundidad): (1) schema-calificar la llamada como
-- extensions.gen_random_bytes, y (2) incluir `extensions` en el search_path.

CREATE OR REPLACE FUNCTION public.generar_acceso_externo(
  p_recurso_tipo text, p_recurso_id uuid, p_email_destinatario text,
  p_nombre_destinatario text DEFAULT NULL::text, p_dias_validez integer DEFAULT 14,
  p_observaciones text DEFAULT NULL::text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_token text; v_dias int;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF p_recurso_tipo NOT IN ('tramite','solicitud','tracking','documento') THEN
    RAISE EXCEPTION 'recurso_tipo invalido: %', p_recurso_tipo USING ERRCODE='22023'; END IF;
  v_dias := COALESCE(p_dias_validez, 14);
  IF v_dias < 1 OR v_dias > 365 THEN
    RAISE EXCEPTION 'dias_validez fuera de rango' USING ERRCODE='22023'; END IF;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.accesos_externos(token, recurso_tipo, recurso_id, email_destinatario, nombre_destinatario, vence_at, created_by, observaciones)
  VALUES (v_token, p_recurso_tipo, p_recurso_id, p_email_destinatario, p_nombre_destinatario,
          now() + (v_dias || ' days')::interval, auth.uid(), p_observaciones);
  RETURN v_token;
END $function$;
