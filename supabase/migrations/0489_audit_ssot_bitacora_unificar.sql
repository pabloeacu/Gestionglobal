-- 0489 · Auditoría 2026-09 · ROBUSTEZ / SSOT de la bitácora de auditoría: unificar los DOS sistemas.
--
-- HALLAZGO: coexistían dos sistemas de audit-trail sobre las mismas tablas:
--   · Sistema A: trigger _audit_log_trg → tabla `audit_log` (2162 filas). Es la "bitácora unificada"
--     (DGG-35) que LEE la app (src/services/api/auditoria.ts vía audit_log_listar/audit_log_resumen).
--     Cubría 8 tablas.
--   · Sistema B: trigger audit_row → tabla `auditoria_cambios` (2834 filas). Cubría 16 tablas PERO es
--     WRITE-ONLY: NADIE la lee (0 referencias en front/edges/DB salvo el propio trigger). Es el sistema
--     legacy que quedó cuando se construyó la bitácora unificada.
-- Consecuencia: 7 tablas (administraciones, comprobantes, formularios, partners, servicios, tramites,
-- vencimientos) se auditaban DOS VECES (doble-write en tablas de dinero de alta frecuencia); y los cambios
-- de `movimientos` (¡dinero!) sólo iban al orphan B → invisibles en la bitácora que ve la gerencia.
--
-- FIX (SSOT, sin perder cobertura): se lleva TODO a Sistema A (audit_log, el que la app lee):
--   1) Se agrega el trigger _audit_log_trg a las 9 tablas que sólo cubría B (movimientos, cajas, consorcios,
--      curso_matriculas, cursos, formulario_submissions, lotes_facturacion, partner_convenios,
--      partner_rendiciones). _audit_log_trg es genérico (TG_TABLE_NAME + to_jsonb, pk 'id', saltea updates
--      no-op salvo updated_at) y todas tienen `id` → A queda cubriendo las 17 tablas (unión A∪B), sin perder
--      NADA de lo que B auditaba. Ahora los cambios de dinero (movimientos) SÍ entran a la bitácora que se lee.
--   2) Se DROPEAN los 16 triggers de Sistema B (audit_row) → fin del doble-write y del orphan.
--   3) Se DROPEA la función audit_row (ya sin triggers). Se CONSERVA la tabla auditoria_cambios con su
--      historial (2834 filas) — sólo deja de crecer; no se pierde historia.
--
-- Verificado: BEFORE — comprobante→audit_log+1 & auditoria_cambios+1 (doble), movimiento→audit_log+0 &
-- auditoria_cambios+1 (sólo orphan). AFTER esperado — comprobante→audit_log+1 & auditoria_cambios+0 (single),
-- movimiento→audit_log+1 & auditoria_cambios+0 (ahora en la bitácora). §6 + e2e con rollback.

-- (1) Sistema A a las 9 tablas que sólo cubría B
CREATE TRIGGER trg_audit_movimientos            AFTER INSERT OR UPDATE OR DELETE ON public.movimientos            FOR EACH ROW EXECUTE FUNCTION public._audit_log_trg();
CREATE TRIGGER trg_audit_cajas                  AFTER INSERT OR UPDATE OR DELETE ON public.cajas                  FOR EACH ROW EXECUTE FUNCTION public._audit_log_trg();
CREATE TRIGGER trg_audit_consorcios             AFTER INSERT OR UPDATE OR DELETE ON public.consorcios             FOR EACH ROW EXECUTE FUNCTION public._audit_log_trg();
CREATE TRIGGER trg_audit_curso_matriculas       AFTER INSERT OR UPDATE OR DELETE ON public.curso_matriculas       FOR EACH ROW EXECUTE FUNCTION public._audit_log_trg();
CREATE TRIGGER trg_audit_cursos                 AFTER INSERT OR UPDATE OR DELETE ON public.cursos                 FOR EACH ROW EXECUTE FUNCTION public._audit_log_trg();
CREATE TRIGGER trg_audit_formulario_submissions AFTER INSERT OR UPDATE OR DELETE ON public.formulario_submissions FOR EACH ROW EXECUTE FUNCTION public._audit_log_trg();
CREATE TRIGGER trg_audit_lotes_facturacion      AFTER INSERT OR UPDATE OR DELETE ON public.lotes_facturacion      FOR EACH ROW EXECUTE FUNCTION public._audit_log_trg();
CREATE TRIGGER trg_audit_partner_convenios      AFTER INSERT OR UPDATE OR DELETE ON public.partner_convenios      FOR EACH ROW EXECUTE FUNCTION public._audit_log_trg();
CREATE TRIGGER trg_audit_partner_rendiciones    AFTER INSERT OR UPDATE OR DELETE ON public.partner_rendiciones    FOR EACH ROW EXECUTE FUNCTION public._audit_log_trg();

-- (2) drop de los 16 triggers de Sistema B (audit_row → auditoria_cambios)
DROP TRIGGER IF EXISTS trg_administraciones_audit  ON public.administraciones;
DROP TRIGGER IF EXISTS trg_cajas_audit             ON public.cajas;
DROP TRIGGER IF EXISTS trg_comprobantes_audit      ON public.comprobantes;
DROP TRIGGER IF EXISTS trg_consorcios_audit        ON public.consorcios;
DROP TRIGGER IF EXISTS trg_curso_matriculas_audit  ON public.curso_matriculas;
DROP TRIGGER IF EXISTS trg_cursos_audit            ON public.cursos;
DROP TRIGGER IF EXISTS trg_subm_audit              ON public.formulario_submissions;
DROP TRIGGER IF EXISTS trg_formularios_audit       ON public.formularios;
DROP TRIGGER IF EXISTS trg_lotes_audit             ON public.lotes_facturacion;
DROP TRIGGER IF EXISTS trg_mov_audit               ON public.movimientos;
DROP TRIGGER IF EXISTS trg_pconv_audit             ON public.partner_convenios;
DROP TRIGGER IF EXISTS trg_prend_audit             ON public.partner_rendiciones;
DROP TRIGGER IF EXISTS trg_partners_audit          ON public.partners;
DROP TRIGGER IF EXISTS trg_servicios_audit         ON public.servicios;
DROP TRIGGER IF EXISTS trg_tramites_audit          ON public.tramites;
DROP TRIGGER IF EXISTS trg_venc_audit              ON public.vencimientos;

-- (3) drop de la función legacy (ya sin triggers). Se conserva la tabla auditoria_cambios (historial).
DROP FUNCTION IF EXISTS public.audit_row();
