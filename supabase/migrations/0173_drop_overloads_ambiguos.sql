-- ============================================================================
-- 0173 · E-GG-37 · DROP overloads viejos ambiguos
--
-- BUG reportado por José Luis (2026-06-02): al confirmar el paso 3 del
-- modal de cobranza ("Registrar pago"), el toast tira:
--   "Could not choose the best candidate function between:
--    public.registrar_cobranza_comprobante(p_comprobante_id ⇒ uuid, ...,
--      p_categoria_id ⇒ uuid),
--    public.registrar_cobranza_comprobante(p_comprobante_id ⇒ uuid, ...,
--      p_categoria_id ⇒ uuid, p_partner_id_atribucion ⇒ uuid)"
--
-- Causa raíz: cuando una mig extiende una RPC agregando un parámetro nuevo
-- con `DEFAULT NULL`, Postgres NO reemplaza la firma vieja — crea OTRO
-- overload. PostgREST (el cliente Supabase) no puede resolver la ambigüedad
-- y devuelve este error. El frontend pierde la capacidad de llamar la RPC.
--
-- DEEP-AUDIT-D (2026-06-02) detectó UNO de estos casos
-- (`fz_crear_movimiento_manual`) y lo limpió en mig 0172, pero NO fue
-- transversal. Esta mig es la versión transversal: borra los 3 overloads
-- ambiguos del schema public detectados con la query:
--
--   SELECT p.proname, count(*) FROM pg_proc p JOIN pg_namespace n
--     ON n.oid=p.pronamespace
--   WHERE n.nspname='public' GROUP BY p.proname HAVING count(*) > 1;
--
-- Los 3 casos comparten el mismo patrón "viejo + extendido con DEFAULT":
--   1) registrar_cobranza_comprobante (7 vs 8 args + p_partner_id_atribucion).
--      → es el que rompió a José Luis hoy.
--   2) partner_marcar_facturado (3 vs 4 args + p_pdf_url).
--   3) solicitud_derivar (5 vs 6 args + p_dias_validez).
--
-- Estrategia: el overload "extendido" tiene TODOS los args nuevos con
-- DEFAULT, así que es backwards-compatible con llamadas viejas. Dropeamos
-- el "viejo" y queda solo el "extendido".
--
-- Prevención (a partir de hoy): cuando una mig agrega un parámetro a una
-- RPC, debe DROP + CREATE explícito (no `CREATE OR REPLACE FUNCTION` solo,
-- porque eso preserva el viejo). Sumar como regla candidata a CLAUDE.md.
-- ============================================================================

-- 1) registrar_cobranza_comprobante: rompió la cobranza de José Luis.
DROP FUNCTION IF EXISTS public.registrar_cobranza_comprobante(
  uuid,    -- p_comprobante_id
  uuid,    -- p_caja_id
  date,    -- p_fecha
  numeric, -- p_monto
  text,    -- p_descripcion
  text,    -- p_referencia
  uuid     -- p_categoria_id  (sin p_partner_id_atribucion)
);

-- 2) partner_marcar_facturado: el frontend ya usa la versión con p_pdf_url
--    (DGG-19 / Bloque G obs 11 — adjuntar PDF de factura).
DROP FUNCTION IF EXISTS public.partner_marcar_facturado(
  uuid,    -- p_comprobante_id
  text,    -- p_numero_externo
  text     -- p_observacion (sin p_pdf_url)
);

-- 3) solicitud_derivar: extendida con p_dias_validez (Bloque K · TTL
--    configurable / mig 0117).
DROP FUNCTION IF EXISTS public.solicitud_derivar(
  uuid,    -- p_solicitud_id
  text,    -- p_destinatario_email
  text,    -- p_destinatario_nombre
  text,    -- p_plantilla_slug
  text     -- p_observaciones (sin p_dias_validez)
);
