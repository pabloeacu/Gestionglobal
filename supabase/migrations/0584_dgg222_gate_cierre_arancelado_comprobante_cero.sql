-- 0584 · DGG-222 · El GATE de cierre también debe aceptar un comprobante BONIFICADO ($0)
--
-- Capitalizado del §6 de 0583 (Agente C): el mismo bug "$0 = comprobante inexistente"
-- vivía en DOS lugares. 0583 lo arregló en `agente_cierre_detectar` (la DETECCIÓN),
-- pero el GATE de cierre en la BD —el trigger BEFORE UPDATE
-- `public.tramite_cerrar_exige_cobrado` (DGG-161, mig 0466), rama (b)— seguía
-- exigiendo `COALESCE(c.total,0) > 0`. Resultado: en modo real el agente marcaría a
-- Calvento (TRM-2026-00171, consulta jurídica bonificada con comprobante X $0) como
-- `cerrar_limpio`, llamaría a `tracking_cerrar_auto` (UPDATE estado='cerrado'), y el
-- trigger LANZARÍA 'No se puede cerrar un servicio arancelado sin emitir el
-- comprobante…' → caería en `errores_cierre` y NUNCA cerraría. 0583 quedaba inerte
-- para el caso que vino a resolver. (Irónicamente el propio mensaje del trigger
-- sugiere "o emití uno bonificado" como solución, pero su lógica `total>0` rechazaba
-- justo eso — auto-contradicción.)
--
-- Además afectaba el cierre MANUAL desde el kanban (useAvanzarTramite): al chocar el
-- gate, la UI ofrecía "Cerrar sin cobrar" y degradaba un bonificado legítimo a cierre
-- NO satisfactorio ("frustrado").
--
-- Fix: quitar `AND COALESCE(c.total,0) > 0` SÓLO de la rama (b) del trigger, espejando
-- 0583 y `comprobante_pendiente` (0207). Así las TRES superficies coinciden en el
-- criterio de negocio "un comprobante no-anulado de $0 = facturación completa
-- (bonificación)":
--   · comprobante_pendiente (0207) — chip/filtro de la grilla  → $0 = emitido ✓
--   · agente_cierre_detectar (0583) — detección del agente      → $0 = emitido ✓
--   · tramite_cerrar_exige_cobrado rama (b) (0584) — gate cierre → $0 = emitido ✓
--
-- Rama (a) (cobro_pendiente / impago) y rama (c) (matrícula+legajo RPAC) quedan
-- EXACTAMENTE igual: el impago genuino (comprobante total>0 con saldo) y el
-- otorgamiento faltante siguen frenando el cierre. Un comprobante ANULADO sigue sin
-- contar (`estado <> 'anulado'`), y un servicio arancelado SIN ningún comprobante
-- sigue frenando. SECURITY DEFINER + search_path preservados; CREATE OR REPLACE
-- conserva la ACL y el binding del trigger (firma trigger () → R16 ok).

CREATE OR REPLACE FUNCTION public.tramite_cerrar_exige_cobrado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.estado = 'cerrado' AND OLD.estado IS DISTINCT FROM 'cerrado' THEN
    -- (a) impago genuino (comprobante total>0 con saldo pendiente) — intacto
    IF public.cobro_pendiente(NEW) THEN
      IF public.cobro_estado(NEW) = 'parcial' THEN
        RAISE EXCEPTION 'No se puede cerrar: el trámite tiene un pago a cuenta y queda saldo pendiente. Completá la cobranza (o anulá/bonificá el comprobante) antes de cerrar.' USING ERRCODE = 'check_violation';
      ELSE
        RAISE EXCEPTION 'No se puede cerrar: el trámite no tiene ninguna cobranza registrada (está impago). Registrá la cobranza (o anulá/bonificá el comprobante) antes de cerrar.' USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- (b) servicio arancelado sin NINGÚN comprobante emitido — un comprobante
    --     no-anulado de $0 (bonificación) SÍ cuenta como emitido (DGG-222, 0584).
    IF NEW.cierre_satisfactorio IS DISTINCT FROM false
       AND EXISTS (SELECT 1 FROM public.servicios sv WHERE sv.id = NEW.servicio_id
                   AND GREATEST(COALESCE(sv.precio_publico,0), COALESCE(sv.precio_cliente,0), COALESCE(sv.precio_base,0)) > 0)
       AND NOT EXISTS (SELECT 1 FROM public.comprobantes c
                       WHERE c.estado <> 'anulado'
                         AND (c.id = NEW.comprobante_id
                              OR c.id IN (SELECT s.comprobante_id FROM public.solicitudes s WHERE s.tramite_id = NEW.id AND s.comprobante_id IS NOT NULL)))
    THEN
      RAISE EXCEPTION 'No se puede cerrar un servicio arancelado sin emitir el comprobante (quedaría un ingreso sin registrar). Emití y cobrá el comprobante (o emití uno bonificado); si el trámite no prosperó, cerralo como rechazado/abandono desde el detalle.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- (c) DGG-161 · matrícula/renovación no se cierra CON ÉXITO sin la matrícula
    --     Y el legajo RPAC cargados en la ficha del cliente.
    IF NEW.cierre_satisfactorio IS DISTINCT FROM false
       AND NEW.categoria IN ('matricula','renovacion')
       AND NOT EXISTS (
         SELECT 1 FROM public.administraciones a
         WHERE a.id = NEW.administracion_id
           AND NULLIF(btrim(a.matricula_rpac), '') IS NOT NULL
           AND NULLIF(btrim(a.legajo_rpac), '')   IS NOT NULL
       )
    THEN
      RAISE EXCEPTION 'No se puede cerrar como otorgada una matrícula/renovación sin la matrícula y el legajo RPAC cargados en la ficha del cliente. Cargá el otorgamiento (o cerrá el trámite como rechazado/abandono).'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
