-- 0478 · Auditoría 2026-09 · MEDIO (abuso): voucher_incrementar_uso era anon-callable
-- y mutante sin ninguna autorización → DoS de descuentos.
--
-- HALLAZGO (barrido blast-radius de la auditoría): public.voucher_incrementar_uso(uuid)
-- es SECURITY DEFINER, ejecutable por anon+authenticated, y hace ciegamente
-- `UPDATE servicio_vouchers SET usos_count = usos_count + 1 WHERE id = p_voucher_id`
-- sin validar nada. Cualquier visitante podía spamear la RPC con un voucher_id para
-- agotar su max_usos (bloqueando el descuento a usuarios legítimos) o inflar los
-- contadores/analytics. No es fuga de datos ni robo de dinero, pero sí abuso.
--
-- POR QUÉ ES SEGURO REVOCAR: la RPC NO tiene caller vivo. El wrapper del front
-- (src/services/api/vouchers.ts `incrementarUsoVoucher`) es DEAD CODE (definido, nunca
-- invocado; verificado por grep). Ninguna edge fn la llama. El incremento REAL del
-- contador ocurre server-side en el trigger SECURITY DEFINER
-- `crear_tramite_desde_submission_auto()` (mig 0135), al crear la submission que aplica
-- el voucher — ese trigger corre como owner y NO depende de este GRANT. Revocar la RPC
-- standalone cierra el vector de abuso sin afectar el conteo legítimo.
--
-- (Espeja el patrón de mig 0474: REVOKE de SECURITY DEFINER expuestas sin caller de front.)

REVOKE EXECUTE ON FUNCTION public.voucher_incrementar_uso(uuid) FROM anon, authenticated;

-- Rollback (si alguna vez se re-cablea un flujo público que la necesite, mejor moverla
-- server-side al submit): GRANT EXECUTE ON FUNCTION public.voucher_incrementar_uso(uuid) TO authenticated;
