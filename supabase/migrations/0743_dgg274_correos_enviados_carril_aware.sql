-- 0743 · DGG-274 / E-GG-307 — La página "Correos enviados" (KPIs) consciente de carriles.
--
-- Hallazgo de la auditoría §6 (¿otros chequeos miden mal con SES?): la vista v_email_registro
-- clasificaba como 'fallido' TODA fila de email_queue con ultimo_error o intento>=max — lo que
-- barría los CANCELADOS (status='cancelled') junto con los fallos reales. Resultado en gerencia:
--   · "Fallidos": 10.240 — de los cuales 10.130 son CANCELADOS (marketing dado de baja / purgado)
--     y sólo 108 fallos reales. Un cancelado NO es un fallo de entrega. (bug de correctitud)
--   · "Pendientes": 16.248 — es el GOTEO de marketing SES por diseño, mostrado en tono ámbar de
--     alarma al lado de "Fallidos", cuando el carril transaccional está sano (~0-1). (encuadre)
--
-- Fix (mismo espíritu carril-aware de E-GG-306, ahora en la grilla de gerencia):
--   (1) vista: status='cancelled' → estado 'cancelado' (distinto de 'fallido'); + columna `carril`
--       (transaccional/marketing por slug, la MISMA fuente que rutea el dispatcher: marketingUtmFor).
--   (2) RPC KPIs: desglose honesto → pendientes (transaccional), en_goteo (marketing SES, informativo),
--       enviados, fallidos (reales), cancelados.
-- Lectores: sólo src/services/api/emails.ts (listEnvios + contarEnviosKpis) y EmailQueuePage.tsx
-- (fan-out §6a verificado). NULL slug → 'transaccional' (conservador).

-- ───────────── (1) Vista: 'cancelado' separado + columna carril ─────────────
CREATE OR REPLACE VIEW public.v_email_registro AS
 SELECT se.id,
    'historico'::text AS lane,
    se.enviado_at,
    NULL::timestamp with time zone AS programado_para,
    se.enviado_at AS fecha,
    se.template_slug,
    et.nombre AS template_nombre,
    se.to_email,
    NULL::text AS to_nombre,
    se.asunto AS subject,
        CASE
            WHEN se.estado = 'failed'::text THEN 'fallido'::text
            ELSE 'enviado'::text
        END AS estado,
    se.estado AS delivery_estado,
    se.error_msg AS delivery_error,
    se.from_casilla AS casilla,
    NULL::integer AS intento,
    NULL::integer AS max_intentos,
    se.error_msg AS ultimo_error,
    se.administracion_id,
    adm.nombre AS administracion_nombre,
    se.provider_msg_id,
        CASE
            WHEN se.from_email ~~* '%@envios.gestionglobal.ar'::text THEN 'ses'::text
            ELSE 'workspace'::text
        END AS canal,
    se.from_email,
    se.webhook_status,
    se.delivered_at,
    se.opened_at,
    se.bounced_at,
    se.complained_at,
        CASE
            WHEN se.template_slug LIKE 'lexph-newsletter%' OR se.template_slug LIKE 'captacion-%'
              OR se.template_slug LIKE 'federal-%' OR se.template_slug LIKE 'ofrecimiento-%'
              OR se.template_slug LIKE 'engagement-%' THEN 'marketing'::text
            ELSE 'transaccional'::text
        END AS carril
   FROM sent_emails se
     LEFT JOIN email_templates et ON et.slug = se.template_slug
     LEFT JOIN administraciones adm ON adm.id = se.administracion_id
UNION ALL
 SELECT eq.id,
    'cola'::text AS lane,
    eq.enviado_at,
    eq.programado_para,
    COALESCE(eq.enviado_at, eq.programado_para) AS fecha,
    eq.template_slug,
    et.nombre AS template_nombre,
    eq.to_email,
    eq.to_nombre,
    eq.subject,
        CASE
            WHEN eq.status = 'cancelled'::text THEN 'cancelado'::text
            WHEN eq.ultimo_error IS NOT NULL OR eq.intento >= eq.max_intentos THEN 'fallido'::text
            ELSE 'pendiente'::text
        END AS estado,
    NULL::text AS delivery_estado,
    NULL::text AS delivery_error,
    et.from_casilla AS casilla,
    eq.intento,
    eq.max_intentos,
    eq.ultimo_error,
    eq.administracion_id,
    adm.nombre AS administracion_nombre,
    NULL::text AS provider_msg_id,
    NULL::text AS canal,
    NULL::text AS from_email,
    NULL::text AS webhook_status,
    NULL::timestamp with time zone AS delivered_at,
    NULL::timestamp with time zone AS opened_at,
    NULL::timestamp with time zone AS bounced_at,
    NULL::timestamp with time zone AS complained_at,
        CASE
            WHEN eq.template_slug LIKE 'lexph-newsletter%' OR eq.template_slug LIKE 'captacion-%'
              OR eq.template_slug LIKE 'federal-%' OR eq.template_slug LIKE 'ofrecimiento-%'
              OR eq.template_slug LIKE 'engagement-%' THEN 'marketing'::text
            ELSE 'transaccional'::text
        END AS carril
   FROM email_queue eq
     LEFT JOIN email_templates et ON et.slug = eq.template_slug
     LEFT JOIN administraciones adm ON adm.id = eq.administracion_id
  WHERE eq.status <> 'sent'::text;

COMMENT ON VIEW public.v_email_registro IS
  'REG (DGG-274): registro unificado sent_emails ∪ email_queue(status<>sent). estado: '
  'enviado/pendiente/fallido/cancelado (cancelled ya NO es fallido). carril: transaccional/marketing '
  'por slug (marketingUtmFor). RLS de las tablas base aplica (SECURITY INVOKER).';

-- ───────────── (2) RPC KPIs: desglose carril-aware ─────────────
DROP FUNCTION IF EXISTS public.gerencia_email_registro_kpis();
CREATE FUNCTION public.gerencia_email_registro_kpis()
RETURNS TABLE(total bigint, pendientes bigint, en_goteo bigint, enviados bigint, fallidos bigint, cancelados bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    count(*)                                                                  AS total,
    count(*) FILTER (WHERE estado = 'pendiente' AND carril = 'transaccional') AS pendientes,
    count(*) FILTER (WHERE estado = 'pendiente' AND carril = 'marketing')     AS en_goteo,
    count(*) FILTER (WHERE estado = 'enviado')                               AS enviados,
    count(*) FILTER (WHERE estado = 'fallido')                               AS fallidos,
    count(*) FILTER (WHERE estado = 'cancelado')                             AS cancelados
  FROM public.v_email_registro;
$function$;

GRANT EXECUTE ON FUNCTION public.gerencia_email_registro_kpis() TO authenticated;

COMMENT ON FUNCTION public.gerencia_email_registro_kpis() IS
  'DGG-274/E-GG-307: KPIs carril-aware de "Correos enviados". pendientes=transaccional en cola; '
  'en_goteo=marketing SES por diseño (informativo, no alarma); fallidos=fallos reales (sin cancelados); '
  'cancelados aparte. RLS de v_email_registro aplica por rol.';
