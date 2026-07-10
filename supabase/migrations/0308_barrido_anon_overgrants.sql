-- 0308 · Barrido sistémico del over-grant a `anon` (deuda flag de PROJECT_STATUS,
-- lección E-GG-88/89/90/91/92). Pre-0130, `CREATE TABLE public.*` concede el set
-- completo (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) a anon,
-- authenticated y service_role por default. La RLS tapa el acceso real, pero el
-- grant es la sobre-exposición que venimos erradicando. Auditamos las 18 tablas/
-- vistas donde anon tenía privilegios y las cerramos:
--
--   • Objetos INTERNOS (sin flujo público): REVOKE ALL FROM anon. authenticated y
--     service_role conservan lo suyo (grants explícitos por rol, NO vía PUBLIC →
--     revocar anon no toca a los otros). Las 5 vistas son security_invoker
--     (respetan la RLS subyacente: anon ya no podía leerlas), pero igual sacamos
--     el grant. La verificación PÚBLICA de cert usa la RPC `verificar_certificado`
--     (SECURITY DEFINER) → NO lee certificado_esquemas directo → anon no lo
--     necesita.
--   • Tablas de FLUJO PÚBLICO (formularios, submissions, adjuntos, catálogo):
--     anon se reduce a su privilegio MÍNIMO (el que su policy RLS necesita):
--     SELECT para render/catálogo, INSERT para submit/upload. Se revoca el resto
--     (DELETE/UPDATE/TRUNCATE/TRIGGER/REFERENCES: ningún flujo público los usa).
--
-- Post-barrido, la superficie anon queda: formularios(SELECT),
-- formulario_submissions(INSERT), formulario_adjuntos(INSERT), servicios(SELECT),
-- categorias_servicio(SELECT), servicio_vouchers(SELECT). Nada más.

-- ===== Objetos internos: anon pierde TODO =====
REVOKE ALL ON public.audit_log                     FROM anon;
REVOKE ALL ON public.certificado_esquemas          FROM anon;
REVOKE ALL ON public.csp_reports                   FROM anon;
REVOKE ALL ON public.encuentro_sesiones_compartidas FROM anon;
REVOKE ALL ON public.errores_runtime               FROM anon;
REVOKE ALL ON public.notificaciones_internas       FROM anon;
REVOKE ALL ON public.vistas_guardadas              FROM anon;
-- Vistas (security_invoker, internas/financieras):
REVOKE ALL ON public.cajas_con_saldo               FROM anon;
REVOKE ALL ON public.vw_comprobantes_para_avisar   FROM anon;
REVOKE ALL ON public.vw_agenda_unificada           FROM anon;
REVOKE ALL ON public.vw_administracion_webinars    FROM anon;
REVOKE ALL ON public.vw_accesos_externos_aperturas FROM anon;

-- ===== Tablas de flujo público: anon reducido al privilegio mínimo =====
REVOKE ALL ON public.formularios            FROM anon;  GRANT SELECT ON public.formularios            TO anon;
REVOKE ALL ON public.formulario_submissions FROM anon;  GRANT INSERT ON public.formulario_submissions TO anon;
REVOKE ALL ON public.formulario_adjuntos    FROM anon;  GRANT INSERT ON public.formulario_adjuntos    TO anon;
REVOKE ALL ON public.servicios              FROM anon;  GRANT SELECT ON public.servicios              TO anon;
REVOKE ALL ON public.categorias_servicio    FROM anon;  GRANT SELECT ON public.categorias_servicio    TO anon;
REVOKE ALL ON public.servicio_vouchers      FROM anon;  GRANT SELECT ON public.servicio_vouchers      TO anon;
