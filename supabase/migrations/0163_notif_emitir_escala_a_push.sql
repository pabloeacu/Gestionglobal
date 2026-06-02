-- 0163 · E-GG-28 · escalar private.notif_emitir a push_notifications_queue
--
-- Aplicada el 2026-06-01.
--
-- Causa raíz: notif_emitir solo insertaba a public.notificaciones_internas
-- (campanita in-app). Los usuarios con push web activado NUNCA recibían
-- push de eventos críticos (solicitud nueva, tracking avance, derivar,
-- factura partner, rechazo, etc) porque la cadena nunca se cableó.
--
-- Fix: si el user destinatario tiene al menos una entrada en
-- public.push_subscriptions, encolar también a public.push_notifications_queue.
-- dispatch-push-2min lo procesa en el próximo tick.
--
-- Resultado: 1 cambio propaga push a TODOS los eventos que usan notif_emitir
-- (notif_emitir_staff, notif a clientes específicos, etc).

CREATE OR REPLACE FUNCTION private.notif_emitir(
  p_user_id uuid,
  p_tipo text,
  p_titulo text,
  p_cuerpo text DEFAULT NULL::text,
  p_url text DEFAULT NULL::text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_tiene_push boolean;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  -- 1) Campanita in-app (siempre).
  INSERT INTO public.notificaciones_internas(user_id, tipo, titulo, cuerpo, url, payload)
  VALUES (p_user_id, p_tipo, p_titulo, p_cuerpo, p_url, COALESCE(p_payload, '{}'::jsonb))
  RETURNING id INTO v_id;

  -- 2) Push web si el user tiene al menos una suscripción activa.
  SELECT EXISTS (
    SELECT 1 FROM public.push_subscriptions WHERE user_id = p_user_id
  ) INTO v_tiene_push;

  IF v_tiene_push THEN
    BEGIN
      INSERT INTO public.push_notifications_queue(
        user_id, titulo, cuerpo,
        icono_url, click_url, intento, max_intentos
      )
      VALUES (
        p_user_id, p_titulo, COALESCE(p_cuerpo, ''),
        'https://www.gestionglobal.ar/logo-color.png',
        COALESCE(p_url, NULL),
        0, 3
      );
    EXCEPTION WHEN OTHERS THEN
      -- No bloquear la notif principal si falla el push.
      RAISE WARNING 'notif_emitir: push encolado falló para user % (%): %',
        p_user_id, p_tipo, SQLERRM;
    END;
  END IF;

  RETURN v_id;
END;
$function$;
