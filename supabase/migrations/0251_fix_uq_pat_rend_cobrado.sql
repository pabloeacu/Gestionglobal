-- ============================================================================
-- 0251_fix_uq_pat_rend_cobrado.sql
-- DGG-86 fix (hallazgo §6) · El índice único `uq_pat_rend_comprobante`
-- (rendicion_id, comprobante_id, tipo) venía del modelo FACTURADO (1 fila por
-- comprobante por rendición). Con el modelo COBRADO de 0250 (1 fila por
-- CObranza/imputación), un comprobante cobrado en VARIAS partes dentro del mismo
-- período genera N filas con el MISMO comprobante_id ⇒ unique_violation ⇒ la RPC
-- `partner_crear_rendicion` aborta y NO crea la rendición. Es justo el caso de
-- cobro parcial (DGG-84). Lo cazó el agente §6 ejercitando 2 cobranzas parciales
-- del mismo comprobante en el período (mi e2e usó 1 por período y no lo vio).
--
-- Fix: la unicidad de ingresos pasa a ser por IMPUTACIÓN (una atribución por
-- cobranza por rendición) — el guard correcto del modelo cobrado, que además
-- respalda el dedup. Los egresos siguen con `uq_pat_rend_movimiento` (1 por
-- egreso, sin parcialidad). Las filas viejas facturado (imputacion_id NULL) no
-- entran al índice parcial (son históricas, no se reinsertan).
-- ============================================================================

DROP INDEX IF EXISTS public.uq_pat_rend_comprobante;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pat_rend_imputacion
  ON public.partner_atribuciones (rendicion_id, imputacion_id)
  WHERE imputacion_id IS NOT NULL AND rendicion_id IS NOT NULL;
