-- 0550_dgg220_f5_fixes_sexto.sql
-- =============================================================================
-- DGG-220 · Fase 5 — fixes de la doble auditoría §6 (3 agentes).
--   #4 (C, regresión menor-media): `prospectos_listado` (grilla legacy de
--      prospectos de webinars) NO filtraba `origen` → quedó inundada por los
--      2457 del padrón PBA (tabla `prospectos` es compartida). Se excluye
--      `origen='padron_pba'` para restaurar la vista de leads de webinars/forms.
--   A#10 (consistencia preview↔enviar): `prospectos_preview_campana.en_gracia`
--      sólo miraba `prospecto_mails`; `enviar` también mira `email_queue`
--      pendiente en la ventana de gracia. Se agrega el mismo EXISTS → el preview
--      deja de sobreestimar `elegibles` (feedback_consistencia: mismo número en
--      todas las superficies).
--   C#9 (latente): `prospectos_captacion_list` no devolvía `telefono`, así que
--      el drawer de edición podía nular un teléfono de padrón al guardar.
--      Se agrega `telefono` a la grilla (blast radius hoy = 0, cierre preventivo).
--
-- Todo read-only salvo firmas; sin cambios de datos. R16: listado/preview sin
-- cambio de firma (CREATE OR REPLACE); el list cambia RETURNS TABLE → DROP+CREATE.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- #4 — excluir el padrón de la grilla legacy de prospectos de webinars.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prospectos_listado(p_webinar_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, nombre text, email text, telefono text, origen text, observaciones text, convertido_a_administracion_id uuid, convertido_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, eventos_total integer, eventos_asistidos integer, ultimo_evento_at timestamp with time zone, convertido boolean, cliente_activo boolean, cliente_estado text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.nombre,
    p.email,
    p.telefono,
    p.origen,
    p.observaciones,
    p.convertido_a_administracion_id,
    p.convertido_at,
    p.created_at,
    p.updated_at,
    COALESCE(agg.eventos_total, 0)::int      AS eventos_total,
    COALESCE(agg.eventos_asistidos, 0)::int  AS eventos_asistidos,
    agg.ultimo_evento_at,
    (p.convertido_a_administracion_id IS NOT NULL) AS convertido,
    a.activo  AS cliente_activo,
    a.estado  AS cliente_estado
  FROM public.prospectos p
  LEFT JOIN public.administraciones a ON a.id = p.convertido_a_administracion_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int                           AS eventos_total,
      COUNT(*) FILTER (WHERE wi.asistio)::int AS eventos_asistidos,
      MAX(w.fecha_hora)                       AS ultimo_evento_at
    FROM public.webinar_inscriptos wi
    JOIN public.webinars w ON w.id = wi.webinar_id
    WHERE wi.prospecto_id = p.id
  ) agg ON TRUE
  WHERE
    -- DGG-220 F5 #4: el padrón PBA vive en su propia página (/captacion);
    -- esta grilla es sólo leads de webinars/formularios.
    p.origen IS DISTINCT FROM 'padron_pba'
    AND (
      p_webinar_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.webinar_inscriptos wf
        WHERE wf.prospecto_id = p.id AND wf.webinar_id = p_webinar_id
      )
    )
  ORDER BY p.created_at DESC;
END;
$function$;

-- -----------------------------------------------------------------------------
-- A#10 — preview.en_gracia incluye también la cola pendiente (paridad c/ enviar).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prospectos_preview_campana(
  p_template_slug text, p_segmento text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_gracia int := 30; v_cooldown int := 90;
  v_tpl_ok boolean; v_es_venc boolean; v_bloqueado boolean;
  v_en_seg int; v_sin_email int; v_suprimidos int; v_en_gracia int; v_en_cooldown int; v_elegibles int;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.email_templates WHERE slug = p_template_slug AND activo) INTO v_tpl_ok;
  v_es_venc := p_template_slug IN ('captacion-curso-3190','captacion-curso-reno','captacion-vencida');
  v_bloqueado := v_es_venc AND COALESCE(p_segmento,'') NOT IN ('vencida','curso_reno_30','curso_31_90');

  WITH pool AS (
    SELECT p.id, p.email,
           (p.email LIKE '%@padron.invalid') AS no_email,
           public.email_esta_suprimido(p.email) AS supr,
           -- paridad con enviar: gracia = mail enviado (prospecto_mails) O encolado
           -- pendiente (email_queue) en los últimos 30 días.
           (EXISTS(SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id = p.id
                     AND pm.enviado_at >= (v_hoy - v_gracia)::timestamptz)
            OR EXISTS(SELECT 1 FROM public.email_queue q WHERE q.related_table = 'prospectos'
                     AND q.related_id = p.id AND q.enviado_at IS NULL
                     AND q.created_at >= (v_hoy - v_gracia)::timestamptz)) AS en_gracia,
           EXISTS(SELECT 1 FROM public.prospecto_mails pm WHERE pm.prospecto_id = p.id
                    AND pm.template_slug = p_template_slug
                    AND pm.enviado_at >= (v_hoy - v_cooldown)::timestamptz) AS en_cd
    FROM public.prospectos p
    WHERE p.origen = 'padron_pba' AND p.convertido_at IS NULL AND p.baja_at IS NULL
      AND (p_segmento IS NULL OR public.prospecto_segmento(p.matricula_vencimiento, v_hoy) = p_segmento)
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE no_email),
    count(*) FILTER (WHERE NOT no_email AND supr),
    count(*) FILTER (WHERE NOT no_email AND NOT supr AND en_gracia),
    count(*) FILTER (WHERE NOT no_email AND NOT supr AND NOT en_gracia AND en_cd),
    count(*) FILTER (WHERE NOT no_email AND NOT supr AND NOT en_gracia AND NOT en_cd)
  INTO v_en_seg, v_sin_email, v_suprimidos, v_en_gracia, v_en_cooldown, v_elegibles
  FROM pool;

  RETURN jsonb_build_object(
    'template', p_template_slug, 'template_existe', COALESCE(v_tpl_ok, false),
    'segmento', p_segmento, 'es_de_vencimiento', v_es_venc, 'bloqueado_guard', v_bloqueado,
    'en_segmento', COALESCE(v_en_seg, 0),
    'sin_email', COALESCE(v_sin_email, 0),
    'suprimidos', COALESCE(v_suprimidos, 0),
    'en_gracia', COALESCE(v_en_gracia, 0),
    'en_cooldown', COALESCE(v_en_cooldown, 0),
    'elegibles', CASE WHEN v_bloqueado OR NOT COALESCE(v_tpl_ok, false) THEN 0 ELSE COALESCE(v_elegibles, 0) END
  );
END $fn$;
REVOKE EXECUTE ON FUNCTION public.prospectos_preview_campana(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospectos_preview_campana(text, text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- C#9 — la grilla de captación ahora devuelve `telefono` (para que el drawer de
-- edición no lo nule). Cambia RETURNS TABLE → DROP + CREATE (R16: sin overload).
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.prospectos_captacion_list(text, text, text, boolean, boolean, int, int);
CREATE FUNCTION public.prospectos_captacion_list(
  p_segmento text DEFAULT NULL,
  p_estado text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_solo_sancionados boolean DEFAULT false,
  p_solo_con_email boolean DEFAULT false,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0)
 RETURNS TABLE(
   id uuid, nombre text, email text, telefono text, cuit text, matricula text, legajo text,
   matricula_vencimiento date, ultima_renovacion date, segmento text,
   estado_captacion text, sanciones boolean, sin_email boolean, suprimido boolean,
   ultimo_mail_slug text, ultimo_mail_asunto text, ultimo_mail_at timestamptz,
   convertido_at timestamptz, baja_at timestamptz, padron_count bigint, total_count bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_lim int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_off int := GREATEST(COALESCE(p_offset, 0), 0);
  v_q text := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT p.*,
           public.prospecto_segmento(p.matricula_vencimiento, v_hoy) AS seg,
           (p.email LIKE '%@padron.invalid') AS no_email
    FROM public.prospectos p
    WHERE p.origen = 'padron_pba'
  ), filtered AS (
    SELECT * FROM base b
    WHERE (p_segmento IS NULL OR b.seg = p_segmento)
      AND (p_estado IS NULL OR b.estado_captacion = p_estado)
      AND (NOT p_solo_sancionados OR b.sanciones)
      AND (NOT p_solo_con_email OR NOT b.no_email)
      AND (v_q IS NULL
           OR b.nombre ILIKE '%'||v_q||'%' OR b.email ILIKE '%'||v_q||'%'
           OR b.cuit ILIKE '%'||v_q||'%'   OR b.legajo ILIKE '%'||v_q||'%'
           OR b.matricula ILIKE '%'||v_q||'%')
  ), counted AS (
    SELECT *, count(*) OVER() AS tc FROM filtered
  )
  SELECT c.id, c.nombre, c.email, c.telefono, c.cuit, c.matricula, c.legajo,
         c.matricula_vencimiento, c.ultima_renovacion, c.seg,
         c.estado_captacion, c.sanciones, c.no_email,
         public.email_esta_suprimido(c.email),
         c.ultimo_mail_slug, c.ultimo_mail_asunto, c.ultimo_mail_at,
         c.convertido_at, c.baja_at,
         (SELECT count(*) FROM public.prospecto_padron pp WHERE pp.prospecto_id = c.id),
         c.tc
  FROM counted c
  ORDER BY c.matricula_vencimiento ASC NULLS LAST, c.nombre ASC
  LIMIT v_lim OFFSET v_off;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.prospectos_captacion_list(text, text, text, boolean, boolean, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospectos_captacion_list(text, text, text, boolean, boolean, int, int) TO authenticated, service_role;
