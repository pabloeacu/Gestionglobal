-- 0625_dgg221_captacion_list_en_tramite.sql
-- DGG-221 · Fase 5 UI: exponer `en_tramite` en la grilla de captación de gerencia.
-- --------------------------------------------------------------------------
-- El rollup `prospectos.en_tramite` (mig 0620) no llegaba al frontend: el RPC
-- de la grilla (`prospectos_captacion_list`, definido en mig 0572 ANTES de 0620)
-- no lo devolvía. Sin eso, un gerente ve "Vencida" en rojo sin saber que esa
-- persona ya está renovando y que por eso el motor NO le manda el mail de
-- regularizar (R14: toda columna/estado persistido que se muestra debe tener
-- su correlato visible; acá es AUTO = derivado de TRAMIX, no editable a mano).
--
-- Agregar una columna al RETURNS TABLE es un cambio de tipo de retorno → NO se
-- puede con CREATE OR REPLACE, hay que DROP + CREATE (y por R16 se mantiene la
-- MISMA firma de parámetros, así PostgREST sigue resolviendo sin ambigüedad).
-- `base` ya hace SELECT p.* → `en_tramite` está disponible; sólo se expone.
-- Cuerpo byte-idéntico salvo la columna nueva. Grants replicados exactos
-- (anon/public sin EXECUTE; authenticated + service_role con EXECUTE; el guard
-- interno `private.is_staff()` sigue filtrando a no-staff).
-- --------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.prospectos_captacion_list(text, text, text, boolean, boolean, integer, integer);

CREATE FUNCTION public.prospectos_captacion_list(
  p_segmento text DEFAULT NULL::text,
  p_estado text DEFAULT NULL::text,
  p_search text DEFAULT NULL::text,
  p_solo_sancionados boolean DEFAULT false,
  p_solo_con_email boolean DEFAULT false,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, nombre text, email text, telefono text, cuit text, matricula text, legajo text,
  matricula_vencimiento date, ultima_renovacion date, segmento text, estado_captacion text,
  sanciones boolean, sin_email boolean, suprimido boolean,
  ultimo_mail_slug text, ultimo_mail_asunto text, ultimo_mail_at timestamp with time zone,
  convertido_at timestamp with time zone, baja_at timestamp with time zone,
  en_tramite boolean,
  campanas_enviadas jsonb, padron_count bigint, total_count bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
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
         c.en_tramite,
         (SELECT jsonb_object_agg(x.template_slug, x.ult)
            FROM (SELECT pm.template_slug, max(pm.enviado_at) AS ult
                  FROM public.prospecto_mails pm
                  WHERE pm.prospecto_id = c.id AND pm.template_slug LIKE 'captacion-%'
                  GROUP BY pm.template_slug) x) AS campanas_enviadas,
         (SELECT count(*) FROM public.prospecto_padron pp WHERE pp.prospecto_id = c.id),
         c.tc
  FROM counted c
  ORDER BY c.matricula_vencimiento ASC NULLS LAST, c.nombre ASC
  LIMIT v_lim OFFSET v_off;
END $function$;

REVOKE ALL ON FUNCTION public.prospectos_captacion_list(text, text, text, boolean, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospectos_captacion_list(text, text, text, boolean, boolean, integer, integer) TO authenticated, service_role;
