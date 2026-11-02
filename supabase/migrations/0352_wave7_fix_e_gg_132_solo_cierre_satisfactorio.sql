-- 0352 · WAVE 7 · E-GG-132 (refinamiento): el gate de "cerrar arancelado exige
-- comprobante" SÓLO debe aplicar al cierre SATISFACTORIO (matrícula otorgada /
-- servicio resuelto con éxito). Los cierres NO satisfactorios legítimos
-- ('Matrícula rechazada', 'Abandono del trámite' → cierre_satisfactorio=false) no
-- generan ingreso y deben poder cerrarse SIN comprobante. tracking_cerrar setea
-- estado='cerrado' + cierre_satisfactorio en el MISMO UPDATE, así que el BEFORE
-- UPDATE trigger ve NEW.cierre_satisfactorio. Descubierto en la QA en vivo antes de
-- romper el cierre por abandono/rechazo (Pablo: "no rompas circuitos ya testeados").
CREATE OR REPLACE FUNCTION public.tramite_cerrar_exige_cobrado()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.estado = 'cerrado' AND OLD.estado IS DISTINCT FROM 'cerrado' THEN
    -- (a) comprobante impago (comportamiento previo)
    IF public.cobro_pendiente(NEW) THEN
      IF public.cobro_estado(NEW) = 'parcial' THEN
        RAISE EXCEPTION 'No se puede cerrar: el trámite tiene un pago a cuenta y queda saldo pendiente. Completá la cobranza (o anulá/bonificá el comprobante) antes de cerrar.' USING ERRCODE = 'check_violation';
      ELSE
        RAISE EXCEPTION 'No se puede cerrar: el trámite no tiene ninguna cobranza registrada (está impago). Registrá la cobranza (o anulá/bonificá el comprobante) antes de cerrar.' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    -- (b) E-GG-132 refinado: sólo un cierre SATISFACTORIO de servicio arancelado
    -- exige comprobante. Rechazo/abandono (no satisfactorio) cierra sin comprobante.
    IF COALESCE(NEW.cierre_satisfactorio, false) = true
       AND EXISTS (SELECT 1 FROM public.servicios sv WHERE sv.id = NEW.servicio_id
                   AND GREATEST(COALESCE(sv.precio_publico,0), COALESCE(sv.precio_cliente,0), COALESCE(sv.precio_base,0)) > 0)
       AND NOT EXISTS (SELECT 1 FROM public.comprobantes c
                       WHERE c.estado <> 'anulado' AND COALESCE(c.total,0) > 0
                         AND (c.id = NEW.comprobante_id
                              OR c.id IN (SELECT s.comprobante_id FROM public.solicitudes s WHERE s.tramite_id = NEW.id AND s.comprobante_id IS NOT NULL)))
    THEN
      RAISE EXCEPTION 'No se puede cerrar como RESUELTO un servicio arancelado sin emitir el comprobante (quedaría un ingreso sin registrar). Emití y cobrá el comprobante (o emití uno bonificado); si el trámite no prosperó, cerralo como rechazado/abandono.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;