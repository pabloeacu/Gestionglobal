-- 0487 · Auditoría 2026-09 · ROBUSTEZ / SSOT contable (Pieza B): deuda de curso = saldo del comprobante.
--
-- CORRECCIÓN DE PREMISA: la investigación inicial creyó que los cursos NO tenían comprobante. FALSO:
-- 94/95 matrículas YA tienen comprobante y los $3.010.000 de deuda del cta-cte SON cursos. Crear un
-- comprobante por matrícula (idea inicial) DUPLICARÍA cargos — Pablo: "no dupliques comprobantes". El
-- problema real es SINCRONÍA: `curso_matriculas.estado_pago` es una bandera PARALELA que se despega del
-- saldo real del comprobante. Hoy pagar el comprobante del curso por la vía normal (registrar_cobranza)
-- baja el saldo a 0 pero NO toca estado_pago → 4 matrículas dicen "pago_parcial" con el comprobante pago,
-- el chip "Con deuda" miente, y (peor) la condición 'pago' no se tilda → el certificado queda bloqueado.
--
-- REGLA CANÓNICA (Pablo): deuda = saldo_pendiente del comprobante. Fuente ÚNICA.
--
-- FIX (cero comprobantes nuevos, cero duplicación):
-- 1) Helper + trigger en `comprobantes`: cuando cambia el saldo (o el estado) de un comprobante ligado a
--    una matrícula de curso, sincroniza `estado_pago` desde el saldo. Anti-drift PERMANENTE, pagues por la
--    vía que pagues. Al setear 'pago_completo' cascada al downstream existente (matricula_sync_estado_pago)
--    que tilda la condición 'pago' → desbloquea el certificado. SIN BUCLE (matricula_sync_estado_pago NO
--    escribe comprobantes, verificado). SECURITY DEFINER + search_path (R17: escribe curso_matriculas RLS).
-- 2) Backfill de las matrículas existentes desde el saldo de su comprobante (arregla las 4). SEGURO: las 4
--    tienen 2 condiciones NO-pago pendientes y 0 condición 'pago' activa → tildar no completa egreso → NO
--    dispara certificado ni mails (verificado; e2e confirma 0 certificados/0 notificaciones nuevas).
-- 3) `tramite_tiene_deuda` = `cobro_pendiente(t)`: la deuda de curso pasa a leer el SALDO DEL COMPROBANTE
--    (fuente única), sin la rama divergente `estado_pago`. DB-safe: el gate DURO de cierre
--    (tramite_cerrar_exige_cobrado) ya usa cobro_pendiente; NINGUNA función de la BD usa tramite_tiene_deuda
--    (sólo el front: chip/filtro/soft-gate); para matrículas reales estado_pago ya refleja el comprobante
--    (equivalente); excluye "GG Cursos" (cuenta interna cursos@gestionglobal.ar, sin comprobante = sin cargo).
--    Firma idéntica → sin overload (R16).
--
-- Verificado: e2e antes/después + rollback (pago sube/baja el saldo → estado_pago sigue; 0 side effects) + §6.

-- 1a) helper: sincroniza estado_pago de las matrículas ligadas a un comprobante, desde su saldo
CREATE OR REPLACE FUNCTION private.matricula_estado_pago_desde_comprobante(p_comprobante_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_saldo numeric; v_total numeric; v_estado text; v_nuevo text;
BEGIN
  SELECT saldo_pendiente, total, estado INTO v_saldo, v_total, v_estado
    FROM public.comprobantes WHERE id = p_comprobante_id;
  -- comprobante inexistente o anulado: la deuda no existe (cobro_pendiente ya excluye anulado) → no tocar
  IF NOT FOUND OR v_estado = 'anulado' THEN RETURN; END IF;
  v_nuevo := CASE
    WHEN COALESCE(v_saldo,0) <= 0                     THEN 'pago_completo'
    WHEN COALESCE(v_saldo,0) >= COALESCE(v_total,0)   THEN 'adeudado'
    ELSE 'pago_parcial' END;
  UPDATE public.curso_matriculas cm
     SET estado_pago = v_nuevo
   WHERE cm.estado_pago IS DISTINCT FROM v_nuevo
     AND cm.tramite_id IN (
       SELECT t.id       FROM public.tramites t   WHERE t.comprobante_id = p_comprobante_id
       UNION
       SELECT s.tramite_id FROM public.solicitudes s WHERE s.comprobante_id = p_comprobante_id AND s.tramite_id IS NOT NULL
     );
END; $fn$;

-- 1b) trigger en comprobantes
CREATE OR REPLACE FUNCTION private.trg_comprobante_sync_matricula_pago()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
BEGIN
  PERFORM private.matricula_estado_pago_desde_comprobante(NEW.id);
  RETURN NEW;
END; $fn$;

DROP TRIGGER IF EXISTS trg_comprobante_sync_matricula_pago ON public.comprobantes;
CREATE TRIGGER trg_comprobante_sync_matricula_pago
  AFTER INSERT OR UPDATE OF saldo_pendiente, estado ON public.comprobantes
  FOR EACH ROW EXECUTE FUNCTION private.trg_comprobante_sync_matricula_pago();

-- 2) backfill de las matrículas existentes (arregla las 4 desincronizadas; no-op para las demás)
DO $bf$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT comp_id FROM (
      SELECT t.comprobante_id AS comp_id FROM public.tramites t
        WHERE t.comprobante_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.curso_matriculas cm WHERE cm.tramite_id = t.id)
      UNION
      SELECT s.comprobante_id FROM public.solicitudes s
        WHERE s.comprobante_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.curso_matriculas cm WHERE cm.tramite_id = s.tramite_id)
    ) x
  LOOP
    PERFORM private.matricula_estado_pago_desde_comprobante(r.comp_id);
  END LOOP;
END; $bf$;

-- 3) SSOT: la deuda de curso lee el saldo del comprobante (fuente única), sin la rama estado_pago divergente
CREATE OR REPLACE FUNCTION public.tramite_tiene_deuda(t tramites)
RETURNS boolean
LANGUAGE sql STABLE SET search_path TO 'public','pg_temp'
AS $fn$
  SELECT public.cobro_pendiente(t);
$fn$;

-- Defensa en profundidad (hallazgo §6, alineado con mig 0474): las funciones SECURITY DEFINER nuevas
-- no deben ser invocables por PUBLIC/authenticated directamente (el trigger las dispara igual, sin grant).
REVOKE EXECUTE ON FUNCTION private.matricula_estado_pago_desde_comprobante(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.trg_comprobante_sync_matricula_pago() FROM PUBLIC;
