-- ============================================================================
-- 0188 · DGG-42 · Reapertura de trámites + dedup atribuciones partner
--
-- Pablo (2026-06-04): "Si se puede reabrir un trámite. Eso debe impactar en
-- todos los reportes, cards, status, etc. Podría ser un error de gerencia
-- que debemos tener previsto para resolver. Lo que haremos es advertir que
-- se está reabriendo y preguntar si desea informar la reapertura por mail
-- al cliente."
--
-- Esta mig:
--   1. ALTER tramites ADD reabierto_count + ultima_reapertura_at +
--      ultima_reapertura_motivo (registro de historia).
--   2. RPC tracking_reabrir(p_tramite_id, p_motivo, p_notificar_cliente).
--      Limpia fecha_fin / motivo_cierre / cierre_satisfactorio / resuelto_at,
--      incrementa reabierto_count, inserta línea automática de tracking,
--      opcionalmente encola email + push al cliente.
--   3. Template email "tramite-reabierto" estilo MANAXER.
--   4. Fix de auditoría: partner_crear_rendicion ahora excluye comprobantes
--      y movimientos que YA están atribuidos a OTRA rendición (cualquier
--      estado, incluido 'cancelada'). Previene doble contabilización y
--      cierra el GAP detectado en auditoría de E-GG-47.
-- ============================================================================

ALTER TABLE public.tramites
  ADD COLUMN IF NOT EXISTS reabierto_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultima_reapertura_at timestamptz,
  ADD COLUMN IF NOT EXISTS ultima_reapertura_motivo text;

COMMENT ON COLUMN public.tramites.reabierto_count IS
  'DGG-42 · Cantidad de veces que este trámite fue reabierto luego de cerrarse. >0 implica historia de reapertura.';
COMMENT ON COLUMN public.tramites.ultima_reapertura_at IS
  'DGG-42 · Timestamp de la última reapertura. NULL si nunca se reabrió.';
COMMENT ON COLUMN public.tramites.ultima_reapertura_motivo IS
  'DGG-42 · Motivo libre que el operador ingresó en la última reapertura.';

-- Template email curso-felicitacion (sólo si no existe), idempotente.
INSERT INTO public.email_templates (
  slug, nombre, asunto, body_html,
  titulo_visual, kicker, color_acento,
  cuerpo_html_visual, cta_text, cta_url, from_casilla, descripcion
) VALUES (
  'tramite-reabierto',
  'Trámite reabierto (DGG-42)',
  'Tu gestión {{tramite_titulo}} fue reabierta',
  '<p>Hola {{cliente_nombre}},</p>'
  '<p>Te avisamos que <strong>reabrimos la gestión {{tramite_codigo}} – {{tramite_titulo}}</strong> '
  'para continuar trabajándola.</p>'
  '<p><strong>Motivo:</strong> {{motivo_reapertura}}</p>'
  '<p>Vas a ver el trámite nuevamente en tu portal en estado en progreso.</p>',
  'Reabrimos tu gestión',
  'GESTIÓN ACTUALIZADA',
  '#0EA5E9',
  '<p>Hola {{cliente_nombre}},</p>'
  '<p>Te avisamos que <strong>reabrimos la gestión {{tramite_codigo}} – {{tramite_titulo}}</strong> '
  'para continuar trabajándola.</p>'
  '<blockquote style="border-left:4px solid #0EA5E9;background:#F0F9FF;padding:12px 16px;margin:16px 0;">'
  '<strong>Motivo de la reapertura:</strong><br>{{motivo_reapertura}}'
  '</blockquote>'
  '<p>Vas a ver el trámite nuevamente en tu portal en estado <strong>en progreso</strong>. '
  'Cuando termine de procesarse te avisaremos otra vez.</p>'
  '<p>Si tenés dudas, respondé este mismo correo y te respondemos directo desde gerencia.</p>',
  'Ver mi gestión',
  'https://gestionglobal.ar/portal/gestiones/{{tramite_id}}',
  'general',
  'DGG-42 · Aviso al cliente cuando gerencia reabre un trámite que había sido cerrado.'
)
ON CONFLICT (slug) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  asunto = EXCLUDED.asunto,
  body_html = EXCLUDED.body_html,
  titulo_visual = EXCLUDED.titulo_visual,
  kicker = EXCLUDED.kicker,
  color_acento = EXCLUDED.color_acento,
  cuerpo_html_visual = EXCLUDED.cuerpo_html_visual,
  cta_text = EXCLUDED.cta_text,
  cta_url = EXCLUDED.cta_url,
  descripcion = EXCLUDED.descripcion;

CREATE OR REPLACE FUNCTION public.tracking_reabrir(
  p_tramite_id        uuid,
  p_motivo            text,
  p_notificar_cliente boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tramite     record;
  v_admin       record;
  v_email_to    text;
  v_email_name  text;
  v_motivo_clean text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'solo_staff_puede_reabrir' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_tramite FROM public.tramites WHERE id = p_tramite_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tramite_inexistente' USING ERRCODE = 'P0002';
  END IF;

  IF v_tramite.estado <> 'cerrado' THEN
    RAISE EXCEPTION 'tramite_no_cerrado_no_se_reabre' USING ERRCODE = '22023';
  END IF;

  v_motivo_clean := COALESCE(trim(p_motivo), '');
  IF length(v_motivo_clean) = 0 THEN
    RAISE EXCEPTION 'motivo_reapertura_requerido' USING ERRCODE = '23502';
  END IF;

  UPDATE public.tramites
    SET estado                  = 'en_progreso',
        fecha_fin               = NULL,
        motivo_cierre           = NULL,
        cierre_satisfactorio    = NULL,
        resuelto_at             = NULL,
        resuelto_por            = NULL,
        reabierto_count         = reabierto_count + 1,
        ultima_reapertura_at    = now(),
        ultima_reapertura_motivo= v_motivo_clean,
        ultima_actividad_at     = now()
   WHERE id = p_tramite_id;

  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, estado_asociado,
    archivos_urls, autor_id, visible_cliente
  ) VALUES (
    p_tramite_id,
    'reapertura',
    'Trámite reabierto. Motivo: ' || v_motivo_clean,
    'reabierto',
    '{}'::text[],
    auth.uid(),
    true
  );

  IF p_notificar_cliente THEN
    SELECT a.* INTO v_admin FROM public.administraciones a
      WHERE a.id = v_tramite.administracion_id;

    IF v_admin.id IS NOT NULL THEN
      v_email_to := v_admin.email;
      v_email_name := v_admin.nombre;

      IF v_email_to IS NOT NULL AND length(trim(v_email_to)) > 0 THEN
        PERFORM public.encolar_email(
          'tramite-reabierto',
          v_email_to,
          v_email_name,
          jsonb_build_object(
            'cliente_nombre',    v_email_name,
            'tramite_codigo',    v_tramite.codigo,
            'tramite_titulo',    v_tramite.titulo,
            'tramite_id',        v_tramite.id::text,
            'motivo_reapertura', v_motivo_clean
          ),
          v_admin.id,
          NULL,
          'tramites',
          v_tramite.id,
          1
        );
      END IF;

      INSERT INTO public.push_notifications_queue (
        user_id, title, body, click_url, related_table, related_id
      )
      SELECT
        p.id,
        'Reabrimos tu gestión',
        v_tramite.titulo || ' · Motivo: ' || left(v_motivo_clean, 120),
        '/portal/gestiones/' || v_tramite.id::text,
        'tramites',
        v_tramite.id
      FROM public.profiles p
      WHERE p.administracion_id = v_admin.id
        AND p.rol = 'cliente'
        AND p.activo;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tracking_reabrir(uuid, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.tracking_reabrir(uuid, text, boolean) IS
  'DGG-42 · Reabre un trámite cerrado. Limpia fecha_fin/motivo_cierre, incrementa reabierto_count, inserta línea de tracking, opcionalmente notifica al cliente por mail + push.';

-- partner_crear_rendicion · dedup atribuciones previas (auditoría E-GG-47).
CREATE OR REPLACE FUNCTION public.partner_crear_rendicion(
  p_partner_id uuid,
  p_desde date,
  p_hasta date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rend_id uuid;
  v_convenio record;
  v_ing_brutos numeric(14,2);
  v_ing_atrib numeric(14,2);
  v_cos_brutos numeric(14,2);
  v_cos_atrib numeric(14,2);
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede crear rendiciones de partner'
      USING ERRCODE = '42501';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'Periodo inválido (desde=%, hasta=%)', p_desde, p_hasta
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_convenio
    FROM public.partner_convenios
   WHERE partner_id = p_partner_id
     AND activo
     AND vigencia_desde <= p_hasta
     AND (vigencia_hasta IS NULL OR vigencia_hasta >= p_desde)
   ORDER BY vigencia_desde DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay convenio activo del partner % en el periodo % – %',
      p_partner_id, p_desde, p_hasta USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.partner_rendiciones (
    partner_id, periodo_desde, periodo_hasta, estado, created_by
  )
  VALUES (
    p_partner_id, p_desde, p_hasta, 'borrador', auth.uid()
  )
  RETURNING id INTO v_rend_id;

  INSERT INTO public.partner_atribuciones (
    partner_id, convenio_id, rendicion_id,
    comprobante_id, movimiento_id,
    tipo, porcentaje, monto_base, monto_atribuido,
    created_by
  )
  SELECT DISTINCT
    p_partner_id, v_convenio.id, v_rend_id,
    c.id, NULL,
    'ingreso',
    v_convenio.porc_ingresos,
    c.total,
    ROUND(c.total * v_convenio.porc_ingresos / 100, 2),
    auth.uid()
  FROM public.comprobantes c
  WHERE c.estado = 'autorizado'
    AND c.fecha BETWEEN p_desde AND p_hasta
    AND c.tipo IN ('A','B','C','X')
    AND EXISTS (
      SELECT 1
        FROM public.movimiento_imputaciones mi
        JOIN public.movimientos m ON m.id = mi.movimiento_id
       WHERE mi.comprobante_id = c.id
         AND m.partner_id_atribucion = p_partner_id
    )
    -- DGG-42 dedup: no incluir comprobantes ya atribuidos a otra rendición.
    AND NOT EXISTS (
      SELECT 1 FROM public.partner_atribuciones pa
       WHERE pa.partner_id = p_partner_id
         AND pa.comprobante_id = c.id
         AND pa.rendicion_id <> v_rend_id
    );

  INSERT INTO public.partner_atribuciones (
    partner_id, convenio_id, rendicion_id,
    comprobante_id, movimiento_id,
    tipo, porcentaje, monto_base, monto_atribuido,
    created_by
  )
  SELECT
    p_partner_id, v_convenio.id, v_rend_id,
    NULL, m.id,
    'costo',
    v_convenio.porc_costos,
    m.monto,
    ROUND(m.monto * v_convenio.porc_costos / 100, 2),
    auth.uid()
  FROM public.movimientos m
  WHERE m.partner_id_atribucion = p_partner_id
    AND m.fecha BETWEEN p_desde AND p_hasta
    AND m.tipo = 'egreso'
    AND m.estado <> 'anulado'
    AND NOT EXISTS (
      SELECT 1 FROM public.partner_atribuciones pa
       WHERE pa.partner_id = p_partner_id
         AND pa.movimiento_id = m.id
         AND pa.rendicion_id <> v_rend_id
    );

  SELECT
    COALESCE(SUM(CASE WHEN tipo='ingreso' THEN monto_base END), 0),
    COALESCE(SUM(CASE WHEN tipo='ingreso' THEN monto_atribuido END), 0),
    COALESCE(SUM(CASE WHEN tipo='costo'   THEN monto_base END), 0),
    COALESCE(SUM(CASE WHEN tipo='costo'   THEN monto_atribuido END), 0)
    INTO v_ing_brutos, v_ing_atrib, v_cos_brutos, v_cos_atrib
    FROM public.partner_atribuciones
   WHERE rendicion_id = v_rend_id;

  UPDATE public.partner_rendiciones
     SET total_ingresos_brutos     = v_ing_brutos,
         total_ingresos_atribuidos = v_ing_atrib,
         total_costos_brutos       = v_cos_brutos,
         total_costos_atribuidos   = v_cos_atrib,
         updated_at = now()
   WHERE id = v_rend_id;

  RETURN v_rend_id;
END;
$$;

COMMENT ON FUNCTION public.partner_crear_rendicion(uuid, date, date) IS
  'DGG-42 audit · Excluye comprobantes/movimientos ya atribuidos a OTRA rendición (cualquier estado) para evitar doble contabilización.';
