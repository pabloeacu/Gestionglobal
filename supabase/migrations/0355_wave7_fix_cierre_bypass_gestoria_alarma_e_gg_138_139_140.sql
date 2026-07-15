-- 0355 · wave 7 · E-GG-138 / E-GG-139 / E-GG-140
-- Tres hallazgos del mapeo doble §6 de GESTORÍA + ESTADOS/KANBAN/ALARMAS.
-- Todos CREATE OR REPLACE con firma idéntica → R16 sin DROP, GRANTs preservados.

-- ── E-GG-139 (CRÍTICA · contable) — el gate de cierre-con-comprobante era
-- BYPASSEABLE por el cierre rápido del kanban y por tracking_moderar_gestor_avance.
-- Raíz: la rama (b) exigía `COALESCE(NEW.cierre_satisfactorio,false)=true`, pero
-- un `UPDATE tramites SET estado='cerrado'` "pelado" (kanban / moderación) NUNCA
-- setea cierre_satisfactorio → queda NULL → COALESCE=false → la rama NO dispara →
-- un servicio ARANCELADO se cierra SIN comprobante (ingreso sin registrar).
-- e2e probado: bare-close NULL PASA (bug); abandono false PASA (ok); satisf true BLOQUEA.
-- Fix: `cierre_satisfactorio IS DISTINCT FROM false` → sólo un abandono/rechazo EXPLÍCITO
-- (=false, vía tracking_cerrar) puede cerrar un arancelado sin comprobante; NULL (cierre
-- pelado ambiguo) y true exigen comprobante. Un arancelado CON comprobante cierra igual
-- (el NOT EXISTS lo deja pasar). Los no-arancelados nunca se bloquean.
CREATE OR REPLACE FUNCTION public.tramite_cerrar_exige_cobrado()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.estado = 'cerrado' AND OLD.estado IS DISTINCT FROM 'cerrado' THEN
    -- (a) comprobante impago (comportamiento previo)
    IF public.cobro_pendiente(NEW) THEN
      IF public.cobro_estado(NEW) = 'parcial' THEN
        RAISE EXCEPTION 'No se puede cerrar: el trámite tiene un pago a cuenta y queda saldo pendiente. Completá la cobranza (o anulá/bonificá el comprobante) antes de cerrar.' USING ERRCODE = 'check_violation';
      ELSE
        RAISE EXCEPTION 'No se puede cerrar: el trámite no tiene ninguna cobranza registrada (está impago). Registrá la cobranza (o anulá/bonificá el comprobante) antes de cerrar.' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    -- (b) E-GG-132/E-GG-139: un cierre de servicio arancelado exige comprobante,
    -- salvo que sea un abandono/rechazo EXPLÍCITO (cierre_satisfactorio=false).
    IF NEW.cierre_satisfactorio IS DISTINCT FROM false
       AND EXISTS (SELECT 1 FROM public.servicios sv WHERE sv.id = NEW.servicio_id
                   AND GREATEST(COALESCE(sv.precio_publico,0), COALESCE(sv.precio_cliente,0), COALESCE(sv.precio_base,0)) > 0)
       AND NOT EXISTS (SELECT 1 FROM public.comprobantes c
                       WHERE c.estado <> 'anulado' AND COALESCE(c.total,0) > 0
                         AND (c.id = NEW.comprobante_id
                              OR c.id IN (SELECT s.comprobante_id FROM public.solicitudes s WHERE s.tramite_id = NEW.id AND s.comprobante_id IS NOT NULL)))
    THEN
      RAISE EXCEPTION 'No se puede cerrar un servicio arancelado sin emitir el comprobante (quedaría un ingreso sin registrar). Emití y cobrá el comprobante (o emití uno bonificado); si el trámite no prosperó, cerralo como rechazado/abandono desde el detalle.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── E-GG-138 (CRÍTICA · seguridad/consistencia) — el reaviso a la gestoría no
-- validaba el estado del trámite y, además de mandar el mail, REGENERA un token de
-- acceso externo vivo (14 días) si el anterior venció/estaba revocado → podía
-- revivir la capacidad de subida del gestor sobre un trámite CERRADO o CANCELADO.
-- Fix: bloquear si el trámite está en estado terminal.
CREATE OR REPLACE FUNCTION public.derivacion_reavisar_gestoria(p_tramite_id uuid, p_mensaje text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_deriv public.solicitud_derivaciones%ROWTYPE;
  v_tramite public.tramites%ROWTYPE;
  v_vence timestamptz; v_revocado timestamptz;
  v_token text; v_url text; v_mensaje text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_tramite FROM public.tramites WHERE id = p_tramite_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trámite no existe'; END IF;

  -- E-GG-138: no reavisar (ni revivir el token) sobre un trámite ya terminado.
  IF v_tramite.estado IN ('cerrado','cancelado') THEN
    RAISE EXCEPTION 'El trámite está % — no se puede reavisar a la gestoría ni reabrir su acceso.', v_tramite.estado
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT d.* INTO v_deriv
    FROM public.solicitud_derivaciones d
    JOIN public.solicitudes s ON s.id = d.solicitud_id
   WHERE s.tramite_id = p_tramite_id
   ORDER BY d.enviada_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este trámite no fue derivado a una gestoría' USING ERRCODE = 'P0002';
  END IF;

  SELECT vence_at, revocado_at INTO v_vence, v_revocado
    FROM public.accesos_externos WHERE token = v_deriv.acceso_externo_token;
  IF v_deriv.acceso_externo_token IS NULL OR v_vence IS NULL OR v_vence <= now() OR v_revocado IS NOT NULL THEN
    v_token := public.generar_acceso_externo('solicitud', v_deriv.solicitud_id,
                 v_deriv.destinatario_email, v_deriv.destinatario_nombre, 14, 'Reaviso: info nueva');
    v_url := 'https://www.gestionglobal.ar/externo/' || v_token;
    UPDATE public.solicitud_derivaciones
       SET acceso_externo_token = v_token, acceso_externo_url = v_url
     WHERE id = v_deriv.id;
  ELSE
    v_token := v_deriv.acceso_externo_token;
    v_url := COALESCE(v_deriv.acceso_externo_url, 'https://www.gestionglobal.ar/externo/' || v_token);
  END IF;

  v_mensaje := COALESCE(NULLIF(btrim(p_mensaje), ''),
    'El cliente completó la documentación que faltaba. Ya podés retomar el trámite con la información actualizada.');

  INSERT INTO public.email_queue (
    to_email, to_nombre, subject, kind, template_slug, variables, prioridad,
    programado_para, related_table, related_id
  ) VALUES (
    v_deriv.destinatario_email, v_deriv.destinatario_nombre,
    'Hay información nueva para retomar · Trámite ' || coalesce(v_tramite.codigo, ''),
    'workflow', 'gestoria-info-nueva-disponible',
    jsonb_build_object(
      'nombre', coalesce(v_deriv.destinatario_nombre, 'gestoría'),
      'tramite_codigo', v_tramite.codigo, 'tramite_titulo', v_tramite.titulo,
      'mensaje', v_mensaje, 'acceso_url', v_url),
    2, now(), 'tramites', p_tramite_id
  );

  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, archivos_urls, autor_id, visible_cliente, created_at
  ) VALUES (
    p_tramite_id, 'tramite_enviado',
    'Reaviso a la gestoría (' || v_deriv.destinatario_email || '): hay información nueva para retomar el trámite.'
      || CASE WHEN coalesce(btrim(p_mensaje), '') <> '' THEN ' · ' || btrim(p_mensaje) ELSE '' END,
    '{}'::text[], v_user, false, now()
  );

  RETURN jsonb_build_object('ok', true, 'email', v_deriv.destinatario_email, 'token_regenerado', (v_token <> COALESCE(v_deriv.acceso_externo_token,'')));
END;
$function$;

-- ── E-GG-140 (menor · alarma pegada) — el widget "Documentación del cliente ·
-- en vivo" del Inicio de gerencia (docs_cliente_pendientes) no filtraba el estado
-- del trámite. Como el cierre del trámite NO cierra los pedidos (E-GG-46, por
-- diseño), un pedido 'abierto' con ítems 'subido' sobre un trámite ya cerrado/
-- cancelado seguía apareciendo → alarma que no se limpia. Espejo del fix E-GG-46
-- que sólo se había aplicado del lado portal (listPedidosAbiertosCliente).
CREATE OR REPLACE FUNCTION public.docs_cliente_pendientes()
 RETURNS TABLE(pedido_id uuid, tramite_id uuid, tramite_codigo text, cliente_nombre text, descripcion text, items_subidos integer, creado_at timestamp with time zone)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN RETURN; END IF;
  RETURN QUERY
  SELECT p.id, t.id, t.codigo, a.nombre, p.descripcion,
         (SELECT count(*)::int FROM public.tramite_pedidos_doc_items i
           WHERE i.pedido_id = p.id AND i.estado = 'subido'),
         p.creado_at
  FROM public.tramite_pedidos_doc p
  JOIN public.tramites t              ON t.id = p.tramite_id
  LEFT JOIN public.administraciones a ON a.id = t.administracion_id
  WHERE p.estado = 'abierto'
    AND t.estado NOT IN ('cerrado','cancelado')   -- E-GG-140
    AND EXISTS (SELECT 1 FROM public.tramite_pedidos_doc_items i
                 WHERE i.pedido_id = p.id AND i.estado = 'subido')
  ORDER BY p.creado_at DESC
  LIMIT 20;
END
$function$;
