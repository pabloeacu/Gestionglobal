-- ============================================================================
-- Migration: 0117_bloque_a_alarmas_tracking
-- Fecha: 2026-05-28
-- DGG-XX · Bloque A · Sistema alarmas tracking (obs 3-7)
-- (a) Helper días hábiles
-- (b) tracking_lineas.postergada_veces + postergada_motivo
-- (c) solicitud_derivar setea alerta_en = +5 días hábiles en la línea inicial
-- (d) RPC postergar_alarma_tracking (staff)
-- (e) RPC gerencia_alarmas_hoy para dashboard
-- ============================================================================

CREATE OR REPLACE FUNCTION private.dias_habiles_add(
  p_desde timestamptz, p_dias integer
) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_cur timestamptz := p_desde;
  v_left int := COALESCE(p_dias, 0);
BEGIN
  WHILE v_left > 0 LOOP
    v_cur := v_cur + interval '1 day';
    IF extract(dow FROM v_cur) NOT IN (0, 6) THEN
      v_left := v_left - 1;
    END IF;
  END LOOP;
  RETURN v_cur;
END;
$$;

ALTER TABLE public.tracking_lineas
  ADD COLUMN IF NOT EXISTS postergada_veces integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS postergada_motivo text;

CREATE OR REPLACE FUNCTION public.solicitud_derivar(
  p_solicitud_id        uuid,
  p_destinatario_email  text,
  p_destinatario_nombre text,
  p_plantilla_slug      text DEFAULT 'solicitud-derivada-gestoria',
  p_observaciones       text DEFAULT NULL,
  p_dias_validez        integer DEFAULT 14
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_sol     public.solicitudes%ROWTYPE;
  v_servicio_nombre text;
  v_token   text;
  v_url     text;
  v_email_id uuid;
  v_der_id  uuid;
  v_vars    jsonb;
  v_destinatario_label text;
  v_dias    int;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501';
  END IF;
  v_dias := COALESCE(p_dias_validez, 14);
  IF v_dias < 1 OR v_dias > 365 THEN
    RAISE EXCEPTION 'dias_validez fuera de rango (1..365)' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_sol FROM public.solicitudes WHERE id = p_solicitud_id;
  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_sol.servicio_solicitado_id IS NOT NULL THEN
    SELECT nombre INTO v_servicio_nombre FROM public.servicios WHERE id = v_sol.servicio_solicitado_id;
  END IF;
  v_servicio_nombre := COALESCE(v_servicio_nombre, v_sol.servicio_slug, 'Servicio');
  BEGIN
    v_token := public.generar_acceso_externo(
      'solicitud'::text, p_solicitud_id, p_destinatario_email,
      p_destinatario_nombre, v_dias, NULL::text
    );
    v_url := 'https://gestionglobal.ar/externo/' || v_token;
  EXCEPTION WHEN OTHERS THEN
    v_token := NULL;
    v_url   := 'https://gestionglobal.ar/externo/pendiente?solicitud=' || p_solicitud_id::text;
  END;
  v_vars := jsonb_build_object(
    'destinatario_nombre', COALESCE(p_destinatario_nombre, split_part(p_destinatario_email,'@',1)),
    'servicio',            v_servicio_nombre,
    'solicitante_nombre',  COALESCE(v_sol.solicitante_nombre, ''),
    'solicitante_email',   COALESCE(v_sol.solicitante_email, ''),
    'observaciones',       COALESCE(p_observaciones, ''),
    'acceso_url',          v_url,
    'dias_validez',        v_dias::text
  );
  BEGIN
    v_email_id := public.encolar_email(
      p_plantilla_slug, p_destinatario_email, p_destinatario_nombre,
      v_vars, NULL, NULL, 'solicitudes', p_solicitud_id, 3::smallint
    );
  EXCEPTION WHEN OTHERS THEN
    v_email_id := NULL;
  END;
  INSERT INTO public.solicitud_derivaciones (
    solicitud_id, destinatario_email, destinatario_nombre,
    plantilla_email_slug, observaciones,
    acceso_externo_token, acceso_externo_url,
    email_queue_id, creada_por
  ) VALUES (
    p_solicitud_id, p_destinatario_email, p_destinatario_nombre,
    p_plantilla_slug, p_observaciones,
    v_token, v_url, v_email_id, auth.uid()
  ) RETURNING id INTO v_der_id;
  UPDATE public.solicitudes
     SET estado = 'derivada',
         derivada_at = COALESCE(derivada_at, now()),
         asignada_a = COALESCE(asignada_a, auth.uid())
   WHERE id = p_solicitud_id;
  IF v_sol.tramite_id IS NOT NULL THEN
    v_destinatario_label := COALESCE(NULLIF(p_destinatario_nombre, ''), p_destinatario_email);
    INSERT INTO public.tracking_lineas (
      tramite_id, categoria, descripcion, archivos_urls,
      autor_id, visible_cliente, alerta_en
    ) VALUES (
      v_sol.tramite_id, 'tramite_enviado',
      'Envío a sector de gestoría — destinatario: ' || v_destinatario_label
        || CASE WHEN COALESCE(p_observaciones, '') <> ''
                THEN E'\n\nObservaciones: ' || p_observaciones
                ELSE '' END,
      '{}'::text[], auth.uid(), true,
      private.dias_habiles_add(now(), 5)
    );
  END IF;
  RETURN v_der_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.postergar_alarma_tracking(
  p_linea_id uuid,
  p_dias integer,
  p_motivo text DEFAULT NULL
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_alerta_actual timestamptz;
  v_nueva timestamptz;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede postergar alarmas' USING ERRCODE = '42501';
  END IF;
  IF p_dias IS NULL OR p_dias < 1 OR p_dias > 90 THEN
    RAISE EXCEPTION 'dias debe estar entre 1 y 90' USING ERRCODE = '22023';
  END IF;
  SELECT alerta_en INTO v_alerta_actual FROM public.tracking_lineas WHERE id = p_linea_id;
  IF v_alerta_actual IS NULL THEN
    v_alerta_actual := now();
  END IF;
  v_nueva := private.dias_habiles_add(v_alerta_actual, p_dias);
  UPDATE public.tracking_lineas
     SET alerta_en = v_nueva,
         postergada_veces = COALESCE(postergada_veces, 0) + 1,
         postergada_motivo = NULLIF(trim(COALESCE(p_motivo, '')), '')
   WHERE id = p_linea_id;
  RETURN v_nueva;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.postergar_alarma_tracking(uuid, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.postergar_alarma_tracking(uuid, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.gerencia_alarmas_hoy()
RETURNS TABLE(
  linea_id uuid,
  tramite_id uuid,
  tramite_codigo text,
  tramite_titulo text,
  categoria text,
  descripcion text,
  alerta_en timestamptz,
  vencida boolean,
  postergada_veces integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT
      tl.id, t.id, t.codigo, t.titulo,
      tl.categoria, tl.descripcion,
      tl.alerta_en,
      (tl.alerta_en < CURRENT_DATE) AS vencida,
      tl.postergada_veces
      FROM public.tracking_lineas tl
      JOIN public.tramites t ON t.id = tl.tramite_id
     WHERE tl.alerta_en IS NOT NULL
       AND tl.alerta_en::date <= CURRENT_DATE
       AND t.estado NOT IN ('resuelto','cerrado','cancelado')
     ORDER BY tl.alerta_en ASC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.gerencia_alarmas_hoy() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.gerencia_alarmas_hoy() TO authenticated;
