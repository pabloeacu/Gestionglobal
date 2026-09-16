-- 0496 · Auditoría 2026-09 · FASE C / C2: crons con latido real (des-cegar el monitoreo).
--
-- Hallazgo A6: pg_cron marca 'succeeded' aunque la edge devuelva 401/500 (net.http_post es
-- fire-and-forget: job_run_details registra el ENCOLADO, no el status HTTP). Caso concreto:
-- `notify-vencimientos-diario` (jobid 2) manda un token VIEJO hardcodeado
-- (Bearer myRhvg…) → 401 garantizado; 120 corridas "succeeded" que en realidad fallaron.
-- Es un DUPLICADO muerto: el aviso de vencimientos real lo hace `dispatch-vencimientos-diario`
-- (jobid 24, reescrito en 0494 para usar private.cron_bearer(), devuelve 200).
--
-- Fix:
-- (C2a) Retirar el cron roto `notify-vencimientos-diario`. Nunca funcionó (siempre 401,
--       0 efecto) → retirarlo no pierde funcionalidad; sólo elimina el falso-verde y un
--       token filtrado más en la definición del job.
-- (C2b) Des-cegar el monitoreo: `db_health_metrics()` (lo que ve el panel de Salud y lo que
--       chequea el cron db-health-alert-check) ahora cuenta las respuestas HTTP fallidas
--       (4xx/5xx/timeout) de las últimas 24 h desde net._http_response (dato que pg_net ya
--       guarda) y, si hay, agrega una alerta. Así un flujo automático que empiece a fallar en
--       silencio se vuelve VISIBLE. Cambio ADITIVO (nueva key + posible alerta nueva); el
--       resto del retorno queda idéntico.

-- (C2a) retirar el cron roto (replay-safe)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-vencimientos-diario') THEN
    PERFORM cron.unschedule('notify-vencimientos-diario');
  END IF;
END $$;

-- (C2b) db_health_metrics: sumar el conteo de fallas HTTP recientes + alerta.
CREATE OR REPLACE FUNCTION public.db_health_metrics()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_db_bytes bigint;
  v_db_limit_bytes bigint := 8::bigint * 1024 * 1024 * 1024;
  v_storage_limit_bytes bigint := 100::bigint * 1024 * 1024 * 1024;
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
  v_http_fallas int;  -- C2b: fallas HTTP de cron/edge en 24h
BEGIN
  IF NOT private.is_staff_or_service() THEN
    RAISE EXCEPTION 'no_access' USING ERRCODE = '42501';
  END IF;
  v_db_bytes := pg_database_size(current_database());
  SELECT COALESCE(SUM((o.metadata->>'size')::bigint), 0) INTO v_storage_total FROM storage.objects o;
  SELECT round(100.0 * sum(heap_blks_hit) / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0), 2)
    INTO v_cache_hit FROM pg_statio_user_tables;
  SELECT round(100.0 * sum(idx_blks_hit) / NULLIF(sum(idx_blks_hit) + sum(idx_blks_read), 0), 2)
    INTO v_index_hit FROM pg_statio_user_indexes;
  SELECT count(*) INTO v_conn_active FROM pg_stat_activity WHERE state IS NOT NULL;
  v_conn_max := current_setting('max_connections')::int;
  SELECT jsonb_agg(jsonb_build_object('tabla', schemaname || '.' || relname, 'bytes', total_bytes,
    'pretty', pg_size_pretty(total_bytes), 'filas_estimadas', n_live_tup) ORDER BY total_bytes DESC)
    INTO v_tables
  FROM (SELECT s.schemaname, s.relname, s.n_live_tup, pg_total_relation_size(c.oid) AS total_bytes
        FROM pg_stat_user_tables s
        JOIN pg_class c ON c.relname = s.relname AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = s.schemaname)
        WHERE s.schemaname = 'public' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 10) t;
  SELECT jsonb_agg(jsonb_build_object('bucket', name, 'public', is_public, 'file_count', file_count,
    'bytes', total_bytes, 'pretty', pg_size_pretty(total_bytes)) ORDER BY total_bytes DESC)
    INTO v_buckets
  FROM (SELECT b.name, b.public AS is_public, COUNT(o.id) AS file_count,
               COALESCE(SUM((o.metadata->>'size')::bigint), 0) AS total_bytes
        FROM storage.buckets b LEFT JOIN storage.objects o ON o.bucket_id = b.id
        GROUP BY b.name, b.public) bb;
  -- C2b: fallas HTTP recientes (net._http_response ya lo guarda). Fully-qualified (SD owner).
  SELECT count(*) INTO v_http_fallas FROM net._http_response
    WHERE created > now() - interval '24 hours' AND (status_code >= 400 OR timed_out);
  v_db_pct := round(100.0 * v_db_bytes / v_db_limit_bytes, 2);
  v_storage_pct := round(100.0 * v_storage_total / v_storage_limit_bytes, 2);
  v_conn_pct := round(100.0 * v_conn_active / v_conn_max, 2);
  IF v_db_pct >= 90 THEN
    v_alerts := v_alerts || jsonb_build_object('kind','db_size','severity','critical',
      'message','Base de datos al ' || v_db_pct || '% — considerá subir de plan o limpiar datos viejos.');
  ELSIF v_db_pct >= 80 THEN
    v_alerts := v_alerts || jsonb_build_object('kind','db_size','severity','warning',
      'message','Base de datos al ' || v_db_pct || '% del plan.');
  END IF;
  IF v_storage_pct >= 90 THEN
    v_alerts := v_alerts || jsonb_build_object('kind','storage','severity','critical',
      'message','Storage al ' || v_storage_pct || '% — los adjuntos están llenando tu cuota.');
  ELSIF v_storage_pct >= 80 THEN
    v_alerts := v_alerts || jsonb_build_object('kind','storage','severity','warning',
      'message','Storage al ' || v_storage_pct || '% del plan.');
  END IF;
  IF v_cache_hit IS NOT NULL AND v_cache_hit < 90 THEN
    v_alerts := v_alerts || jsonb_build_object('kind','cache','severity','warning',
      'message','Cache hit ratio al ' || v_cache_hit || '% — debería estar > 95%. Posible falta de RAM.');
  END IF;
  IF v_index_hit IS NOT NULL AND v_index_hit < 90 THEN
    v_alerts := v_alerts || jsonb_build_object('kind','index','severity','warning',
      'message','Index hit ratio al ' || v_index_hit || '% — revisar índices o vacuum.');
  END IF;
  IF v_conn_pct >= 80 THEN
    v_alerts := v_alerts || jsonb_build_object('kind','connections','severity','warning',
      'message','Conexiones al ' || v_conn_pct || '% del máximo (' || v_conn_active || '/' || v_conn_max || ').');
  END IF;
  IF v_http_fallas > 0 THEN
    v_alerts := v_alerts || jsonb_build_object('kind','cron_http','severity','warning',
      'message', v_http_fallas || ' llamada(s) HTTP automáticas (cron/edge) fallaron (4xx/5xx/timeout) en las últimas 24 h — revisá los flujos automáticos.');
  END IF;
  RETURN jsonb_build_object(
    'captured_at', now(),
    'pro_plan', jsonb_build_object('db_limit_bytes', v_db_limit_bytes, 'storage_limit_bytes', v_storage_limit_bytes, 'plan_name', 'Pro'),
    'db', jsonb_build_object('size_bytes', v_db_bytes, 'size_pretty', pg_size_pretty(v_db_bytes), 'usage_pct', v_db_pct,
      'cache_hit_pct', v_cache_hit, 'index_hit_pct', v_index_hit, 'connections_active', v_conn_active,
      'connections_max', v_conn_max, 'connections_pct', v_conn_pct),
    'storage_total', jsonb_build_object('bytes', v_storage_total, 'pretty', pg_size_pretty(v_storage_total), 'usage_pct', v_storage_pct),
    'cron_http_fallas_24h', v_http_fallas,
    'tables_top10', COALESCE(v_tables, '[]'::jsonb),
    'storage_buckets', COALESCE(v_buckets, '[]'::jsonb),
    'alerts', v_alerts);
END;
$function$;
