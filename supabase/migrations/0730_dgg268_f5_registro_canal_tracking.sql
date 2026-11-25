-- 0730 · DGG-268 F5 (chunk 4) — Dashboard de envíos: etiqueta de CANAL + tracking entrega/apertura.
--
-- Pedido de Pablo: "todos los envíos, no importa el canal, registrados en correos enviados; con
-- una etiqueta del canal (@gestionglobal.ar vs @envios.gestionglobal.ar); y ver si llegó / si
-- abrió. Funcionalmente indistinto, informativamente distinto." Ambos carriles ya escriben en
-- sent_emails; acá SÓLO ampliamos la vista unificada v_email_registro para EXPONER:
--   · canal  → derivado del dominio del From real (ses = subdominio dedicado; workspace = Gmail).
--   · tracking → webhook_status + delivered_at/opened_at/bounced_at/complained_at (los llena el
--                webhook SES vía SNS; Gmail no da apertura — limitación conocida de su API).
-- CREATE OR REPLACE VIEW: se APPENDEAN columnas al final (no se reordena ni cambia tipo), para
-- no romper listEnvios/EmailQueuePage que consumen las columnas actuales.

create or replace view public.v_email_registro as
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
    -- DGG-268 F5 (nuevas):
    CASE
        WHEN se.from_email ILIKE '%@envios.gestionglobal.ar' THEN 'ses'::text
        ELSE 'workspace'::text
    END AS canal,
    se.from_email,
    se.webhook_status,
    se.delivered_at,
    se.opened_at,
    se.bounced_at,
    se.complained_at
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
    -- DGG-268 F5 (nuevas): la cola aún no salió → sin canal ni tracking.
    NULL::text AS canal,
    NULL::text AS from_email,
    NULL::text AS webhook_status,
    NULL::timestamp with time zone AS delivered_at,
    NULL::timestamp with time zone AS opened_at,
    NULL::timestamp with time zone AS bounced_at,
    NULL::timestamp with time zone AS complained_at
   FROM email_queue eq
     LEFT JOIN email_templates et ON et.slug = eq.template_slug
     LEFT JOIN administraciones adm ON adm.id = eq.administracion_id
  WHERE eq.status <> 'sent'::text;
