-- 0576 · DGG-224 cont. — "Descartar mail" de casillas muertas + reactivación +
-- resolución de las 2 deudas del §6.
--
-- Pedido Pablo: cuando un mail rebota (casilla muchas veces inexistente), el
-- gerente debe poder DESCARTARLO para no gastar envíos/tiempo/reputación. La
-- persistencia de envío (max_intentos=5) está bien para fallos transitorios,
-- pero no debe insistir con una casilla muerta.
--
-- Modelo: email_suppression.motivo distingue supresión:
--   · "hard" (casilla muerta): 'bounce' | 'queja' | 'descartado_gerencia'
--       → bloquea TODO envío (transaccional + marketing). No se gasta nada.
--   · "soft" (opt-out de marketing): 'baja_usuario'
--       → bloquea SÓLO marketing (el transaccional sigue).
--
-- Deuda 1 (rebote de cliente no suprimía): se resuelve dándole al gerente la
-- POTESTAD de descartar (botón en el banner). Asimetría intencional vs prospectos
-- (que se auto-suprimen en el harvester): un rebote de cliente puede ser un typo
-- a CORREGIR en la ficha, no siempre una baja → decisión humana, más seguro que
-- auto-suprimir (que cortaría también el transaccional de un cliente válido).
-- Deuda 2 (re-subscribe tocaba 2 fuentes sin UI): RPC email_reactivar + vista.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) ¿La casilla está "hard-bloqueada" (muerta)? → la consulta el dispatch para
--    TODO envío. STABLE SECDEF. Sólo la llama el edge (service_role).
CREATE OR REPLACE FUNCTION public.email_bloqueado_total(p_email text)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.email_suppression s
    WHERE s.email = lower(btrim(p_email))
      AND s.motivo IN ('bounce', 'queja', 'descartado_gerencia')
  );
$function$;
REVOKE EXECUTE ON FUNCTION public.email_bloqueado_total(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.email_bloqueado_total(text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Descartar una casilla (gerencia) → supresión HARD. Si ya existía una baja
--    soft, la "sube" a hard. Guard staff.
CREATE OR REPLACE FUNCTION public.email_descartar(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_email text := lower(btrim(coalesce(p_email, '')));
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501'; END IF;
  IF v_email = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'email_vacio'); END IF;
  INSERT INTO public.email_suppression (email, motivo, origen)
  VALUES (v_email, 'descartado_gerencia', 'gerencia')
  ON CONFLICT (email) DO UPDATE SET motivo = 'descartado_gerencia', origen = 'gerencia';
  RETURN jsonb_build_object('ok', true, 'email', v_email);
END $function$;
REVOKE EXECUTE ON FUNCTION public.email_descartar(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.email_descartar(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Reactivar (re-alta limpia, deuda 2): deshace las DOS fuentes en una op —
--    borra la supresión + re-habilita marketing del cliente dueño de la casilla
--    (si estaba apagado y la cuenta no está de baja) + revierte estado del
--    prospecto. Guard staff.
CREATE OR REPLACE FUNCTION public.email_reactivar(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_sup int; v_cli int; v_pro int;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501'; END IF;
  IF v_email = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'email_vacio'); END IF;

  DELETE FROM public.email_suppression WHERE email = v_email;
  GET DIAGNOSTICS v_sup = ROW_COUNT;

  UPDATE public.administraciones
     SET ofrecimientos_habilitados = true, updated_at = now()
   WHERE lower(email) = v_email AND estado <> 'baja' AND ofrecimientos_habilitados = false;
  GET DIAGNOSTICS v_cli = ROW_COUNT;

  UPDATE public.prospectos
     SET estado_captacion = 'contactado', baja_at = NULL, updated_at = now()
   WHERE email = v_email AND estado_captacion = 'baja';
  GET DIAGNOSTICS v_pro = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'email', v_email,
    'supresiones_borradas', v_sup, 'clientes_reactivados', v_cli, 'prospectos_reactivados', v_pro);
END $function$;
REVOKE EXECUTE ON FUNCTION public.email_reactivar(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.email_reactivar(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Rebotes recientes PENDIENTES (para el banner) = últimos 7d, EXCLUYENDO los
--    ya suprimidos (una vez descartado/auto-suprimido, no hay nada que accionar).
CREATE OR REPLACE FUNCTION public.emails_rebotados_recientes()
 RETURNS TABLE(id uuid, to_email text, asunto text, template_slug text, estado text,
               bounced_at timestamptz, error_msg text, administracion_id uuid, administracion_nombre text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT se.id, se.to_email, se.asunto, se.template_slug, se.estado,
         se.bounced_at, se.error_msg, se.administracion_id, a.nombre
  FROM public.sent_emails se
  LEFT JOIN public.administraciones a ON a.id = se.administracion_id
  WHERE private.is_staff()
    AND se.estado IN ('bounced', 'complained')
    AND COALESCE(se.bounced_at, se.enviado_at) > now() - interval '7 days'
    AND NOT EXISTS (SELECT 1 FROM public.email_suppression s WHERE s.email = lower(btrim(se.to_email)))
  ORDER BY se.bounced_at DESC NULLS LAST
  LIMIT 50;
$function$;
REVOKE EXECUTE ON FUNCTION public.emails_rebotados_recientes() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.emails_rebotados_recientes() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Listado de supresiones (vista de gerencia "Correos suprimidos").
CREATE OR REPLACE FUNCTION public.email_suppression_list()
 RETURNS TABLE(email text, motivo text, origen text, created_at timestamptz,
               administracion_id uuid, administracion_nombre text, prospecto_id uuid, es_hard boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT s.email, s.motivo, s.origen, s.created_at,
         a.id, a.nombre, s.prospecto_id,
         (s.motivo IN ('bounce', 'queja', 'descartado_gerencia')) AS es_hard
  FROM public.email_suppression s
  LEFT JOIN public.administraciones a ON lower(a.email) = s.email
  WHERE private.is_staff()
  ORDER BY s.created_at DESC
  LIMIT 500;
$function$;
REVOKE EXECUTE ON FUNCTION public.email_suppression_list() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.email_suppression_list() TO authenticated;
