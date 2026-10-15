-- 0578 · DGG-224 §6 fixes — preservar la asimetría cliente/prospecto en el
-- hard-block, y coherencia del banner. (3 agentes adversariales.)
--
-- MAYOR #1: email-bounce-harvester auto-suprime (motivo 'bounce'/'queja',
-- origen='webhook') todo rebote que matchee un PROSPECTO (a propósito, por la
-- reputación del mailing en frío). Antes esa supresión sólo frenaba marketing.
-- Con el nuevo hard-block (dispatch 2b-bis) pasaría a cancelar TAMBIÉN el
-- transaccional — y como un cliente suele estar en el padrón PBA como prospecto
-- con el MISMO email, un rebote del cold-outreach apagaría en silencio los
-- comprobantes/reset/tracking del cliente. Eso es justo lo que 0576 declaró
-- querer evitar ("auto-suprimir cortaría el transaccional de un cliente válido").
-- FIX: email_bloqueado_total NO considera "hard" a un auto-bounce (origen webhook)
-- cuyo email sea un CLIENTE ACTIVO; para clientes sólo el DESCARTE explícito de
-- gerencia (descartado_gerencia) bloquea todo. El marketing igual se frena por el
-- bloque 2c (email_esta_suprimido = cualquier supresión).
--
-- MAYOR #2: el banner (emails_rebotados_recientes) excluía por CUALQUIER fila de
-- email_suppression → un cliente con baja SOFT (opt-out de marketing) cuya casilla
-- luego muere y rebota un transaccional quedaba oculto y seguía recibiendo a la
-- casilla muerta. FIX: el banner excluye exactamente lo que ya está "hard-manejado"
-- (NOT email_bloqueado_total) → vuelve a aparecer el rebote entregable para que el
-- gerente lo descarte.
--
-- MENOR: email_reactivar matcheaba el prospecto por email crudo vs lower(email)
-- del cliente → normalizar también el UPDATE de prospectos.

-- 1) hard-block: excluir auto-bounce (webhook) de clientes activos.
CREATE OR REPLACE FUNCTION public.email_bloqueado_total(p_email text)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.email_suppression s
    WHERE s.email = lower(btrim(p_email))
      AND s.motivo IN ('bounce', 'queja', 'descartado_gerencia')
      AND NOT (
        -- Un rebote/queja AUTOMÁTICO (harvester, origen webhook) NO hard-bloquea a
        -- un CLIENTE ACTIVO: su transaccional no se corta por un rebote del
        -- cold-outreach. Sólo el descarte explícito de gerencia lo hace.
        s.origen = 'webhook'
        AND EXISTS (
          SELECT 1 FROM public.administraciones a
          WHERE lower(a.email) = s.email AND a.estado <> 'baja'
        )
      )
  );
$function$;

-- 2) banner: excluir lo ya hard-manejado (no cualquier supresión).
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
    AND se.to_email NOT ILIKE '%.test'
    AND NOT public.email_bloqueado_total(se.to_email)
  ORDER BY se.bounced_at DESC NULLS LAST
  LIMIT 50;
$function$;

-- 3) reactivar: normalizar el match del prospecto.
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
   WHERE lower(btrim(email)) = v_email AND estado_captacion = 'baja';
  GET DIAGNOSTICS v_pro = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'email', v_email,
    'supresiones_borradas', v_sup, 'clientes_reactivados', v_cli, 'prospectos_reactivados', v_pro);
END $function$;
