-- 0348 · WAVE 7 · E-GG-127: fix de REGRESIONES capitalizadas por la doble
-- auditoría §6 del propio wave 7. La mig 0346 endureció private.is_staff()
-- (NULL→false) para cerrar el fail-open de anon — correcto y necesario — pero
-- ese mismo cambio CERRÓ el "fail-open de service_role" del que dependían, sin
-- saberlo, tres callers de confianza que corren con SERVICE_ROLE_KEY y SIN JWT
-- de usuario (auth.uid()=NULL → is_staff()=false → los guards `IF NOT is_staff()`
-- ahora DISPARAN 42501):
--   • edge dispatch-recupero (cron diario 12:30): comprobantes_morosos(NULL)
--     + disparar_recupero_manual(...)  → la cobranza automática quedaba muerta.
--   • edge zoom-webinar-create: webinar_set_zoom(...) → el meeting de Zoom se
--     creaba pero el INSERT fallaba → meeting huérfano.
--   • edge db-health-alert-check (cron diario 12:00): db_health_metrics()
--     (su propio comentario dice "via service_role, bypassa is_staff").
--
-- FIX de mayor palanca y seguro: helper private.is_staff_or_service() que suma
-- al staff el rol service_role (que SÓLO vive server-side — R3 — y ya tiene
-- god-mode sobre la BD, así que permitirlo NO abre superficie nueva). Discrimina
-- del anónimo: auth.role()='service_role' para el edge vs 'anon' para anónimo.
-- COALESCE defensivo para que NUNCA devuelva NULL (misma clase de bug que 0346).
--
-- Además: (a) cert_marcar_celebracion_vista tenía un fail-open PRE-EXISTENTE
-- (la comparación auth.uid()=v_alumno propaga NULL para anon) → se blinda con
-- COALESCE + REVOKE anon; (b) fusionar_administraciones: la UPDATE de
-- patrones_conciliacion que sumé en 0347 podía abortar con 23505 si origen y
-- destino comparten un patrón → dedupe-delete antes del move (patrones no tiene
-- FKs entrantes, verificado, así que borrar el duplicado del origen es seguro).

-- ── (0) Helper: staff O edge de confianza (service_role) ─────────────────────
CREATE OR REPLACE FUNCTION private.is_staff_or_service()
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  -- is_staff() ya es non-NULL (0346). COALESCE del lado service_role para que
  -- un contexto sin auth.role() (p.ej. pg_cron directo) NO reintroduzca NULL.
  SELECT private.is_staff() OR COALESCE(auth.role() = 'service_role', false);
$function$;
COMMENT ON FUNCTION private.is_staff_or_service() IS
  'TRUE si el caller es staff (gerente/operador) o el service_role server-side (edge/cron). Nunca NULL. E-GG-127.';

-- ── (1) comprobantes_morosos: permitir service_role (dispatch-recupero) ──────
-- Semántica preservada: staff+p_admin NULL = todos; staff+p_admin = scoped con
-- assert; cliente autenticado = forzado a su propia administración; y AHORA el
-- edge de confianza (service_role) = todos (como staff, sin assert).
CREATE OR REPLACE FUNCTION public.comprobantes_morosos(p_administracion_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(comprobante_id uuid, comprobante_tipo text, comprobante_numero integer, punto_venta integer, fecha date, vencimiento date, total numeric, saldo_pendiente numeric, estado_cobranza text, administracion_id uuid, administracion_nombre text, consorcio_id uuid, consorcio_nombre text, dias_vencido integer, nivel_sugerido smallint, ultima_accion_at timestamp with time zone, ultima_accion_nivel smallint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_admin_filter uuid := p_administracion_id;
BEGIN
  IF private.is_staff_or_service() THEN
    -- staff / edge de confianza: filtro opcional por p_administracion_id.
    -- El assert de tenancy sólo aplica al staff humano (service_role es trusted).
    IF p_administracion_id IS NOT NULL AND private.is_staff() THEN
      PERFORM private.assert_administracion_access(p_administracion_id);
    END IF;
  ELSE
    -- cliente autenticado: se fuerza el scope a su propia administración.
    v_admin_filter := private.current_administracion_id();
    IF v_admin_filter IS NULL THEN
      RAISE EXCEPTION 'Sin administración asociada' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN QUERY
  WITH cfg_global AS (
    SELECT rc.dias_r1, rc.dias_r2, rc.dias_r3, rc.activo_r1, rc.activo_r2, rc.activo_r3
    FROM public.recupero_config rc WHERE rc.administracion_id IS NULL LIMIT 1
  ),
  ultimas AS (
    SELECT DISTINCT ON (ra.comprobante_id) ra.comprobante_id, ra.enviado_at, ra.nivel
    FROM public.recupero_acciones ra ORDER BY ra.comprobante_id, ra.enviado_at DESC
  )
  SELECT c.id, c.tipo, c.numero, c.punto_venta, c.fecha, c.vencimiento,
    c.total::numeric, c.saldo_pendiente::numeric, c.estado_cobranza,
    a.id, a.nombre, cs.id, cs.nombre,
    GREATEST(0, (CURRENT_DATE - c.vencimiento))::int AS dias_vencido,
    CASE
      WHEN c.vencimiento IS NULL OR c.vencimiento >= CURRENT_DATE THEN NULL
      WHEN (CURRENT_DATE - c.vencimiento) >= COALESCE(cfg_admin.dias_r3, cfg_g.dias_r3, 60)
           AND COALESCE(cfg_admin.activo_r3, cfg_g.activo_r3, true) THEN 3::smallint
      WHEN (CURRENT_DATE - c.vencimiento) >= COALESCE(cfg_admin.dias_r2, cfg_g.dias_r2, 30)
           AND COALESCE(cfg_admin.activo_r2, cfg_g.activo_r2, true) THEN 2::smallint
      WHEN (CURRENT_DATE - c.vencimiento) >= COALESCE(cfg_admin.dias_r1, cfg_g.dias_r1, 7)
           AND COALESCE(cfg_admin.activo_r1, cfg_g.activo_r1, true) THEN 1::smallint
      ELSE NULL
    END AS nivel_sugerido,
    u.enviado_at, u.nivel
  FROM public.comprobantes c
  JOIN public.administraciones a ON a.id = c.administracion_id
  LEFT JOIN public.consorcios cs ON cs.id = c.consorcio_id
  LEFT JOIN public.recupero_config cfg_admin ON cfg_admin.administracion_id = c.administracion_id
  LEFT JOIN cfg_global cfg_g ON true
  LEFT JOIN ultimas u ON u.comprobante_id = c.id
  WHERE c.estado NOT IN ('anulado','borrador')
    AND c.saldo_pendiente > 0
    AND c.vencimiento IS NOT NULL
    AND c.vencimiento < CURRENT_DATE
    AND (v_admin_filter IS NULL OR c.administracion_id = v_admin_filter)
  ORDER BY (CURRENT_DATE - c.vencimiento) DESC NULLS LAST, c.id;
END;
$function$;

-- ── (2) disparar_recupero_manual: permitir service_role (dispatch-recupero) ──
CREATE OR REPLACE FUNCTION public.disparar_recupero_manual(p_comprobante_id uuid, p_nivel smallint, p_observaciones text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_comp record; v_admin public.administraciones%ROWTYPE;
  v_cfg public.recupero_config%ROWTYPE; v_plantilla public.recupero_plantillas%ROWTYPE;
  v_email_dest text; v_email_queue uuid; v_accion_id uuid; v_dias_vencido int;
  v_nombre_contacto text; v_consorcio_nombre text;
BEGIN
  IF NOT private.is_staff_or_service() THEN
    RAISE EXCEPTION 'Solo gerentes/operadores pueden disparar recupero manual' USING ERRCODE='42501';
  END IF;
  IF p_nivel NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'Nivel inválido: debe ser 1, 2 o 3' USING ERRCODE='22023';
  END IF;
  SELECT c.id, c.administracion_id, c.consorcio_id, c.tipo, c.numero, c.punto_venta,
         c.total, c.saldo_pendiente, c.estado_cobranza, c.fecha, c.vencimiento, c.estado
    INTO v_comp FROM public.comprobantes c WHERE c.id = p_comprobante_id;
  IF v_comp.id IS NULL THEN
    RAISE EXCEPTION 'Comprobante no encontrado' USING ERRCODE='P0002';
  END IF;
  IF v_comp.estado IN ('anulado','borrador') THEN
    RAISE EXCEPTION 'Comprobante en estado % no admite recupero', v_comp.estado USING ERRCODE='22023';
  END IF;
  IF COALESCE(v_comp.saldo_pendiente, 0) <= 0 THEN
    RAISE EXCEPTION 'Comprobante sin saldo pendiente' USING ERRCODE='22023';
  END IF;
  v_dias_vencido := CASE
    WHEN v_comp.vencimiento IS NULL THEN 0
    WHEN v_comp.vencimiento < CURRENT_DATE THEN (CURRENT_DATE - v_comp.vencimiento)::int
    ELSE 0 END;
  SELECT * INTO v_plantilla FROM public.recupero_plantillas
   WHERE nivel = p_nivel AND activo = true ORDER BY id LIMIT 1;
  IF v_plantilla.slug IS NULL THEN
    RAISE EXCEPTION 'No hay plantilla activa para nivel R%', p_nivel USING ERRCODE='P0002';
  END IF;
  SELECT * INTO v_cfg FROM public.recupero_config WHERE administracion_id = v_comp.administracion_id;
  SELECT * INTO v_admin FROM public.administraciones WHERE id = v_comp.administracion_id;
  v_email_dest := COALESCE(NULLIF(trim(v_cfg.email_destinatario_override), ''),
                           NULLIF(trim(v_admin.email), ''));
  IF v_email_dest IS NULL THEN
    RAISE EXCEPTION 'La administración no tiene email cargado' USING ERRCODE='23502';
  END IF;
  v_nombre_contacto := COALESCE(
    NULLIF(trim(concat_ws(' ', v_admin.responsable_nombre, v_admin.responsable_apellido)), ''),
    v_admin.nombre);
  IF v_comp.consorcio_id IS NOT NULL THEN
    SELECT nombre INTO v_consorcio_nombre FROM public.consorcios WHERE id = v_comp.consorcio_id;
  END IF;
  v_email_queue := public.encolar_email(
    v_plantilla.slug, v_email_dest, v_nombre_contacto,
    jsonb_build_object(
      'nombre', v_nombre_contacto,
      'nombre_administracion', v_admin.nombre,
      'consorcio_nombre', v_consorcio_nombre,
      'comprobante_tipo', v_comp.tipo,
      'comprobante_numero', lpad(v_comp.punto_venta::text, 5, '0')||'-'||lpad(COALESCE(v_comp.numero,0)::text, 8, '0'),
      'comprobante_total', v_comp.total,
      'saldo_pendiente', v_comp.saldo_pendiente,
      'fecha_vencimiento', v_comp.vencimiento,
      'dias_vencido', v_dias_vencido,
      'nivel', p_nivel,
      'observaciones', p_observaciones),
    v_comp.administracion_id, v_comp.consorcio_id,
    'recupero_acciones', NULL,
    CASE WHEN p_nivel=3 THEN 1::smallint WHEN p_nivel=2 THEN 2::smallint ELSE 3::smallint END);
  INSERT INTO public.recupero_acciones (
    comprobante_id, administracion_id, consorcio_id, nivel, plantilla_slug,
    email_queue_id, autor, observaciones, monto_adeudado, dias_vencido
  ) VALUES (
    v_comp.id, v_comp.administracion_id, v_comp.consorcio_id, p_nivel, v_plantilla.slug,
    v_email_queue, auth.uid(), p_observaciones, v_comp.saldo_pendiente, v_dias_vencido::smallint
  ) RETURNING id INTO v_accion_id;
  UPDATE public.email_queue SET related_id = v_accion_id WHERE id = v_email_queue;
  UPDATE public.comprobantes SET estado_cobranza = 'en_recupero'
    WHERE id = v_comp.id AND estado_cobranza IN ('pendiente','parcial','vencido');
  RETURN v_accion_id;
END;
$function$;

-- ── (3) webinar_set_zoom: permitir service_role (zoom-webinar-create) ────────
-- El control de acceso real ya lo hace el edge (userClient verifica prof.role
-- ='gerente' ANTES de llamar con el admin client). Permitir service_role acá
-- sólo evita el meeting huérfano; no abre superficie a anon.
CREATE OR REPLACE FUNCTION public.webinar_set_zoom(p_webinar_id uuid, p_meeting_id bigint, p_join_url text, p_start_url text, p_password text, p_meeting_number text DEFAULT NULL::text, p_duracion_min integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff_or_service() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.webinars
     SET zoom_meeting_id = p_meeting_id,
         zoom_join_url = p_join_url,
         zoom_start_url = p_start_url,
         zoom_password = p_password,
         zoom_meeting_number = COALESCE(p_meeting_number, zoom_meeting_number),
         duracion_min = COALESCE(p_duracion_min, duracion_min),
         updated_at = now()
   WHERE id = p_webinar_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'webinar_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

-- ── (4) db_health_metrics: permitir service_role (db-health-alert-check) ─────
CREATE OR REPLACE FUNCTION public.db_health_metrics()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_db_bytes bigint;
  v_db_limit_bytes bigint := 8::bigint * 1024 * 1024 * 1024;          -- 8 GB Pro
  v_storage_limit_bytes bigint := 100::bigint * 1024 * 1024 * 1024;   -- 100 GB Pro
  v_storage_total bigint;
  v_cache_hit numeric;
  v_index_hit numeric;
  v_conn_active int;
  v_conn_max int;
  v_tables jsonb;
  v_buckets jsonb;
  v_alerts jsonb := '[]'::jsonb;
  v_db_pct numeric;
  v_storage_pct numeric;
  v_conn_pct numeric;
BEGIN
  IF NOT private.is_staff_or_service() THEN
    RAISE EXCEPTION 'no_access' USING ERRCODE = '42501';
  END IF;

  -- Tamaño BD
  v_db_bytes := pg_database_size(current_database());

  -- Storage total
  SELECT COALESCE(SUM((o.metadata->>'size')::bigint), 0)
    INTO v_storage_total
    FROM storage.objects o;

  -- Cache hits
  SELECT round(100.0 * sum(heap_blks_hit) / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0), 2)
    INTO v_cache_hit
    FROM pg_statio_user_tables;

  SELECT round(100.0 * sum(idx_blks_hit) / NULLIF(sum(idx_blks_hit) + sum(idx_blks_read), 0), 2)
    INTO v_index_hit
    FROM pg_statio_user_indexes;

  -- Connections
  SELECT count(*) INTO v_conn_active
    FROM pg_stat_activity WHERE state IS NOT NULL;
  v_conn_max := current_setting('max_connections')::int;

  -- Top 10 tablas
  SELECT jsonb_agg(jsonb_build_object(
    'tabla', schemaname || '.' || relname,
    'bytes', total_bytes,
    'pretty', pg_size_pretty(total_bytes),
    'filas_estimadas', n_live_tup
  ) ORDER BY total_bytes DESC)
    INTO v_tables
  FROM (
    SELECT s.schemaname, s.relname, s.n_live_tup,
           pg_total_relation_size(c.oid) AS total_bytes
    FROM pg_stat_user_tables s
    JOIN pg_class c ON c.relname = s.relname AND c.relnamespace = (
      SELECT oid FROM pg_namespace WHERE nspname = s.schemaname
    )
    WHERE s.schemaname = 'public'
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT 10
  ) t;

  -- Storage buckets
  SELECT jsonb_agg(jsonb_build_object(
    'bucket', name,
    'public', is_public,
    'file_count', file_count,
    'bytes', total_bytes,
    'pretty', pg_size_pretty(total_bytes)
  ) ORDER BY total_bytes DESC)
    INTO v_buckets
  FROM (
    SELECT b.name, b.public AS is_public,
           COUNT(o.id) AS file_count,
           COALESCE(SUM((o.metadata->>'size')::bigint), 0) AS total_bytes
    FROM storage.buckets b
    LEFT JOIN storage.objects o ON o.bucket_id = b.id
    GROUP BY b.name, b.public
  ) bb;

  -- % usados
  v_db_pct := round(100.0 * v_db_bytes / v_db_limit_bytes, 2);
  v_storage_pct := round(100.0 * v_storage_total / v_storage_limit_bytes, 2);
  v_conn_pct := round(100.0 * v_conn_active / v_conn_max, 2);

  -- Alertas (calculadas)
  IF v_db_pct >= 90 THEN
    v_alerts := v_alerts || jsonb_build_object(
      'kind','db_size','severity','critical',
      'message','Base de datos al ' || v_db_pct || '% — considerá subir de plan o limpiar datos viejos.'
    );
  ELSIF v_db_pct >= 80 THEN
    v_alerts := v_alerts || jsonb_build_object(
      'kind','db_size','severity','warning',
      'message','Base de datos al ' || v_db_pct || '% del plan.'
    );
  END IF;

  IF v_storage_pct >= 90 THEN
    v_alerts := v_alerts || jsonb_build_object(
      'kind','storage','severity','critical',
      'message','Storage al ' || v_storage_pct || '% — los adjuntos están llenando tu cuota.'
    );
  ELSIF v_storage_pct >= 80 THEN
    v_alerts := v_alerts || jsonb_build_object(
      'kind','storage','severity','warning',
      'message','Storage al ' || v_storage_pct || '% del plan.'
    );
  END IF;

  IF v_cache_hit IS NOT NULL AND v_cache_hit < 90 THEN
    v_alerts := v_alerts || jsonb_build_object(
      'kind','cache','severity','warning',
      'message','Cache hit ratio al ' || v_cache_hit || '% — debería estar > 95%. Posible falta de RAM.'
    );
  END IF;

  IF v_index_hit IS NOT NULL AND v_index_hit < 90 THEN
    v_alerts := v_alerts || jsonb_build_object(
      'kind','index','severity','warning',
      'message','Index hit ratio al ' || v_index_hit || '% — revisar índices o vacuum.'
    );
  END IF;

  IF v_conn_pct >= 80 THEN
    v_alerts := v_alerts || jsonb_build_object(
      'kind','connections','severity','warning',
      'message','Conexiones al ' || v_conn_pct || '% del máximo (' || v_conn_active || '/' || v_conn_max || ').'
    );
  END IF;

  RETURN jsonb_build_object(
    'captured_at', now(),
    'pro_plan', jsonb_build_object(
      'db_limit_bytes', v_db_limit_bytes,
      'storage_limit_bytes', v_storage_limit_bytes,
      'plan_name', 'Pro'
    ),
    'db', jsonb_build_object(
      'size_bytes', v_db_bytes,
      'size_pretty', pg_size_pretty(v_db_bytes),
      'usage_pct', v_db_pct,
      'cache_hit_pct', v_cache_hit,
      'index_hit_pct', v_index_hit,
      'connections_active', v_conn_active,
      'connections_max', v_conn_max,
      'connections_pct', v_conn_pct
    ),
    'storage_total', jsonb_build_object(
      'bytes', v_storage_total,
      'pretty', pg_size_pretty(v_storage_total),
      'usage_pct', v_storage_pct
    ),
    'tables_top10', COALESCE(v_tables, '[]'::jsonb),
    'storage_buckets', COALESCE(v_buckets, '[]'::jsonb),
    'alerts', v_alerts
  );
END;
$function$;

-- ── (5) cert_marcar_celebracion_vista: fail-open PRE-EXISTENTE (anon) ────────
-- La comparación auth.uid()=v_alumno propaga NULL para anon → `NULL OR is_staff()`
-- = NULL → `NOT NULL` = NULL → el IF no dispara → cualquier anónimo podía marcar
-- la celebración de cualquier certificado como vista. Bajo impacto (sólo un
-- timestamp) pero es fail-open. Se blinda con COALESCE + REVOKE anon (ningún
-- flujo público lo usa: lo llama el alumno autenticado).
CREATE OR REPLACE FUNCTION public.cert_marcar_celebracion_vista(p_cert_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_alumno uuid;
BEGIN
  SELECT alumno_profile_id INTO v_alumno FROM public.certificados WHERE id = p_cert_id;
  IF v_alumno IS NULL THEN RAISE EXCEPTION 'Certificado no encontrado' USING ERRCODE='P0002'; END IF;
  IF NOT (COALESCE(auth.uid() = v_alumno, false) OR private.is_staff()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  UPDATE public.certificados SET celebracion_vista_at = now()
   WHERE id = p_cert_id AND celebracion_vista_at IS NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.cert_marcar_celebracion_vista(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.cert_marcar_celebracion_vista(uuid) TO authenticated;

-- ── (6) fusionar_administraciones: dedupe patrones_conciliacion antes del move ─
-- La UPDATE de patrones que sumé en 0347 aborta con 23505 (patrones_unique:
-- descripcion_pattern, categoria_id, administracion_id) si origen y destino
-- comparten un patrón (muy probable: ambos suelen tener "TRANSFERENCIA", etc.).
-- Se borran primero los patrones del origen que colisionan con uno del destino
-- (categoria_id nullable → IS NOT DISTINCT FROM) y recién ahí se mueven los que
-- quedan. Sólo cambia ese bloque; el resto de la función queda idéntico.
CREATE OR REPLACE FUNCTION public.fusionar_administraciones(p_origen uuid, p_destino uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_dest_nombre text; v_orig_nombre text; v_res jsonb := '{}'::jsonb; v_n int; v_dup int;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo gerencia puede fusionar administraciones' USING ERRCODE='42501'; END IF;
  IF p_origen IS NULL OR p_destino IS NULL OR p_origen = p_destino THEN RAISE EXCEPTION 'Origen y destino deben ser distintos y no nulos' USING ERRCODE='22023'; END IF;
  SELECT nombre INTO v_dest_nombre FROM public.administraciones WHERE id=p_destino;
  IF v_dest_nombre IS NULL THEN RAISE EXCEPTION 'Destino inexistente' USING ERRCODE='P0002'; END IF;
  SELECT nombre INTO v_orig_nombre FROM public.administraciones WHERE id=p_origen;
  IF v_orig_nombre IS NULL THEN RAISE EXCEPTION 'Origen inexistente' USING ERRCODE='P0002'; END IF;
  UPDATE public.comprobantes SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('comprobantes',v_n);
  UPDATE public.movimientos SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('movimientos',v_n);
  UPDATE public.movimiento_imputaciones SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('imputaciones',v_n);
  UPDATE public.pagos_reportados SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('pagos_reportados',v_n);
  UPDATE public.tramites SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('tramites',v_n);
  UPDATE public.solicitudes SET cliente_id=p_destino WHERE cliente_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('solicitudes',v_n);
  UPDATE public.certificados SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('certificados',v_n);
  UPDATE public.curso_matriculas SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('matriculas',v_n);
  UPDATE public.webinar_inscriptos SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('inscriptos',v_n);
  UPDATE public.consorcios SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('consorcios',v_n);
  UPDATE public.formulario_submissions SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('submissions',v_n);
  UPDATE public.vencimientos SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('vencimientos',v_n);
  UPDATE public.recupero_acciones SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('recupero_acciones',v_n);
  UPDATE public.cliente_oportunidad_eventos SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('oportunidad_eventos',v_n);
  UPDATE public.comunicaciones_destinatarios SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('comunicaciones',v_n);
  UPDATE public.sent_emails SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('sent_emails',v_n);
  UPDATE public.email_queue SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('email_queue',v_n);
  UPDATE public.administracion_emails SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('emails_extra',v_n);
  -- E-GG-127: dedupe antes de mover patrones (evita 23505 en patrones_unique).
  DELETE FROM public.patrones_conciliacion po
   WHERE po.administracion_id = p_origen
     AND EXISTS (
       SELECT 1 FROM public.patrones_conciliacion pd
        WHERE pd.administracion_id = p_destino
          AND pd.descripcion_pattern = po.descripcion_pattern
          AND pd.categoria_id IS NOT DISTINCT FROM po.categoria_id);
  GET DIAGNOSTICS v_dup=ROW_COUNT;
  UPDATE public.patrones_conciliacion SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT;
  v_res:=v_res||jsonb_build_object('patrones_conciliacion',v_n,'patrones_duplicados_descartados',v_dup);
  UPDATE public.profiles SET administracion_id=p_destino WHERE administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('profiles',v_n);
  UPDATE public.prospectos SET convertido_a_administracion_id=p_destino WHERE convertido_a_administracion_id=p_origen; GET DIAGNOSTICS v_n=ROW_COUNT; v_res:=v_res||jsonb_build_object('prospectos',v_n);
  UPDATE public.administraciones SET activo=false, estado='baja',
    nombre=v_orig_nombre||' [fusionado → '||v_dest_nombre||']', updated_at=now() WHERE id=p_origen;
  RETURN jsonb_build_object('ok',true,'origen',p_origen,'destino',p_destino,'movido',v_res);
END; $function$;

-- ── (7) Re-afirmar grants de las 4 RPC de service_role (idempotente) ─────────
GRANT EXECUTE ON FUNCTION public.comprobantes_morosos(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.disparar_recupero_manual(uuid, smallint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.webinar_set_zoom(uuid, bigint, text, text, text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.db_health_metrics() TO authenticated, service_role;
