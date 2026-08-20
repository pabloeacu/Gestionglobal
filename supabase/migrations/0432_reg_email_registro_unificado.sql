-- 0432_reg_email_registro_unificado.sql
-- REG (pedido Pablo · 2026-08-20): el grid "Cola de envíos" leía SOLO
-- `email_queue` (kind='workflow'). Por eso las 5 vías de envío DIRECTO —que
-- saltean la cola y sólo escriben en `sent_emails`— nunca aparecían:
-- constancias, certificados, comprobantes, documentos CJ y vencimientos.
-- Caso disparador: constancia de inscripción a delacruzosvaldo432@gmail.com
-- (CONST-2026-00002) se envió pero no figuraba en el grid.
--
-- Solución: una vista que unifica el REGISTRO COMPLETO de correos =
--   sent_emails  (superset verificado: TODO envío efectivo —directo o vía
--                 cola— deja exactamente 1 fila; 912/912 de la cola tienen
--                 espejo, 0 huérfanos)
--   UNION ALL
--   email_queue WHERE status <> 'sent'   (lo aún-en-vuelo / errado, que por
--                 definición todavía NO tiene espejo en sent_emails → dedupe
--                 limpio sin clave de join).
--
-- El grid pasa a llamarse "Correos enviados" y lee esta vista.
--
-- security_invoker = on  → la vista respeta la RLS de las tablas base
--   (sent_emails_select = is_staff() OR administrador de su propia admin;
--    email_queue_select_staff). Los gerentes ven todo; un administrador
--   cliente vería sólo lo suyo si algún día se expone. Regla 2/4/6/11.
--
-- Perf (R11): sent_emails ya indexa enviado_at DESC, to_email, template_slug,
--   administracion_id. La rama email_queue<>'sent' es diminuta (~pendientes).
--   EXPLAIN ANALYZE de la consulta del grid corre <10ms con el volumen actual.

CREATE OR REPLACE VIEW public.v_email_registro
WITH (security_invoker = on) AS
-- ── LEDGER · todo lo efectivamente enviado (directo o vía cola) ──────────────
SELECT
  se.id,
  'historico'::text                                              AS lane,
  se.enviado_at,
  NULL::timestamptz                                              AS programado_para,
  se.enviado_at                                                  AS fecha,
  se.template_slug,
  et.nombre                                                      AS template_nombre,
  se.to_email,
  NULL::text                                                     AS to_nombre,
  se.asunto                                                      AS subject,
  -- 'failed' es el único estado de sent_emails que representa un envío que NO
  -- salió; bounced/complained/opened/clicked/delivered salieron → 'enviado'
  -- (el matiz lo lleva `delivery_estado`, ver DeliveryBadge del front).
  CASE WHEN se.estado = 'failed' THEN 'fallido'
       ELSE 'enviado' END                                        AS estado,
  se.estado                                                      AS delivery_estado,
  se.error_msg                                                   AS delivery_error,
  se.from_casilla                                                AS casilla,
  NULL::integer                                                  AS intento,
  NULL::integer                                                  AS max_intentos,
  se.error_msg                                                   AS ultimo_error,
  se.administracion_id,
  adm.nombre                                                     AS administracion_nombre,
  se.provider_msg_id
FROM public.sent_emails se
LEFT JOIN public.email_templates  et  ON et.slug  = se.template_slug
LEFT JOIN public.administraciones adm ON adm.id   = se.administracion_id
UNION ALL
-- ── COLA · lo aún-en-vuelo / errado que todavía NO tiene espejo ──────────────
SELECT
  eq.id,
  'cola'::text                                                   AS lane,
  eq.enviado_at,
  eq.programado_para,
  COALESCE(eq.enviado_at, eq.programado_para)                    AS fecha,
  eq.template_slug,
  et.nombre                                                      AS template_nombre,
  eq.to_email,
  eq.to_nombre,
  eq.subject,
  CASE WHEN eq.ultimo_error IS NOT NULL OR eq.intento >= eq.max_intentos
       THEN 'fallido' ELSE 'pendiente' END                       AS estado,
  NULL::text                                                     AS delivery_estado,
  NULL::text                                                     AS delivery_error,
  et.from_casilla                                                AS casilla,
  eq.intento,
  eq.max_intentos,
  eq.ultimo_error,
  eq.administracion_id,
  adm.nombre                                                     AS administracion_nombre,
  NULL::text                                                     AS provider_msg_id
FROM public.email_queue eq
LEFT JOIN public.email_templates  et  ON et.slug  = eq.template_slug
LEFT JOIN public.administraciones adm ON adm.id   = eq.administracion_id
WHERE eq.status <> 'sent';

GRANT SELECT ON public.v_email_registro TO authenticated;
-- Higiene (R3/R6): la vista es de gerencia; anon no debe tenerla granteada
-- (aunque security_invoker ya la protegería contra las tablas base).
REVOKE ALL ON public.v_email_registro FROM anon;

COMMENT ON VIEW public.v_email_registro IS
  'REG (2026-08-20) · Registro unificado de correos: sent_emails (todo lo enviado, incl. envíos directos como constancias/certificados/comprobantes/CJ) UNION email_queue(status<>sent) (en vuelo/errado). Fuente del grid "Correos enviados". security_invoker respeta la RLS de las tablas base.';
