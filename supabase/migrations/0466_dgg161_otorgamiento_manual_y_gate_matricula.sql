-- ============================================================================
-- 0466 · DGG-161 — Otorgamiento manual por gerencia + gate de cierre
-- ----------------------------------------------------------------------------
-- Pablo: la gestoría puede informar el otorgamiento (matrícula, legajo, emisión,
-- vencimiento) como aporte a moderar; gerencia debe poder cargarlo ELLA MISMA
-- desde el trámite cuando no vino por moderación, guardarlo en la ficha del
-- cliente, y encadenar (tracking visible + cierre + programación). Además:
--   Punto 5 — NO se puede cerrar CON ÉXITO un trámite de matrícula/renovación
--   si la ficha del cliente no tiene la matrícula y el legajo cargados.
--
-- Este archivo trae 2 piezas de BACKEND:
--   (A) gate: rama (c) en el trigger tramite_cerrar_exige_cobrado (único punto
--       que cubre detalle + kanban + lista + moderación).
--   (B) RPC tracking_cargar_otorgamiento: carga manual staff, escribe las mismas
--       4 columnas de la ficha que la gestoría (COALESCE), reusa el sanitizador
--       compartido private.gg_sanitizar_otorgamiento, y deja que el trigger
--       trg_admin_matricula_venc_sync_fn arme sola la alarma de renovación.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (A) Gate de cierre — se agrega la rama (c) preservando (a) cobro y (b) arancel.
--     Firma idéntica (trigger sin args) → CREATE OR REPLACE, sin DROP (R16 ok,
--     GRANTs preservados). SECURITY DEFINER ya presente → puede LEER
--     administraciones sin chocar RLS (R17: la rama nueva sólo LEE).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tramite_cerrar_exige_cobrado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.estado = 'cerrado' AND OLD.estado IS DISTINCT FROM 'cerrado' THEN
    -- (a) cobranza pendiente
    IF public.cobro_pendiente(NEW) THEN
      IF public.cobro_estado(NEW) = 'parcial' THEN
        RAISE EXCEPTION 'No se puede cerrar: el trámite tiene un pago a cuenta y queda saldo pendiente. Completá la cobranza (o anulá/bonificá el comprobante) antes de cerrar.' USING ERRCODE = 'check_violation';
      ELSE
        RAISE EXCEPTION 'No se puede cerrar: el trámite no tiene ninguna cobranza registrada (está impago). Registrá la cobranza (o anulá/bonificá el comprobante) antes de cerrar.' USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- (b) arancelado sin comprobante emitido (sólo bloquea el cierre con éxito)
    IF NEW.cierre_satisfactorio IS DISTINCT FROM false
       AND EXISTS (SELECT 1 FROM public.servicios sv WHERE sv.id = NEW.servicio_id
                   AND GREATEST(COALESCE(sv.precio_publico,0), COALESCE(sv.precio_cliente,0), COALESCE(sv.precio_base,0)) > 0)
       AND NOT EXISTS (SELECT 1 FROM public.comprobantes c
                       WHERE c.estado <> 'anulado' AND COALESCE(c.total,0) > 0
                         AND (c.id = NEW.comprobante_id
                              OR c.id IN (SELECT s.comprobante_id FROM public.solicitudes s WHERE s.tramite_id = NEW.id AND s.comprobante_id IS NOT NULL)))
    THEN
      RAISE EXCEPTION 'No se puede cerrar un servicio arancelado sin emitir el comprobante (quedaría un ingreso sin registrar). Emití y cobrá el comprobante (o emití uno bonificado); si el trámite no prosperó, cerralo como rechazado/abandono desde el detalle.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- (c) DGG-161 · matrícula/renovación no se cierra CON ÉXITO sin la matrícula
    --     Y el legajo RPAC cargados en la ficha del cliente. Un cierre NO
    --     satisfactorio (rechazo/abandono → cierre_satisfactorio=false) sí pasa.
    --     Sin administración vinculada, el NOT EXISTS también bloquea: una
    --     matrícula otorgada siempre es de alguien (decisión Pablo).
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

-- ----------------------------------------------------------------------------
-- (B) RPC de carga manual del otorgamiento (staff). Escribe la ficha con la
--     MISMA semántica que la gestoría (COALESCE: campo vacío conserva el actual).
--     Setear matricula_rpac_vencimiento dispara trg_admin_matricula_venc_sync_fn
--     → alarma renovacion_rpac {45,30,15}. Reusa el sanitizador compartido.
--     Gate is_staff (edición de gestión, no recibe p_administracion_id del cliente
--     → R12 no aplica; los gerentes bypassan). SECURITY DEFINER + search_path.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tracking_cargar_otorgamiento(
  p_tramite_id uuid,
  p_matricula text DEFAULT NULL,
  p_legajo text DEFAULT NULL,
  p_fecha_emision date DEFAULT NULL,
  p_fecha_vencimiento date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_tramite record;
  v_admin uuid;
  v_ot jsonb;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo el equipo de gestión puede cargar el otorgamiento.' USING ERRCODE = '42501';
  END IF;

  SELECT t.* INTO v_tramite FROM public.tramites t WHERE t.id = p_tramite_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trámite no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_tramite.categoria NOT IN ('matricula', 'renovacion') THEN
    RAISE EXCEPTION 'El otorgamiento sólo aplica a trámites de matriculación o renovación (categoría: %).', v_tramite.categoria
      USING ERRCODE = '22023';
  END IF;

  v_admin := v_tramite.administracion_id;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'El trámite no tiene un cliente (administración) vinculado; no hay dónde asentar la matrícula.'
      USING ERRCODE = '22023';
  END IF;

  -- El vencimiento es SIEMPRE obligatorio (pedido Pablo).
  IF p_fecha_vencimiento IS NULL THEN
    RAISE EXCEPTION 'La fecha de vencimiento de la matrícula es obligatoria.' USING ERRCODE = '22023';
  END IF;

  -- Validación compartida con la gestoría (largo ≤40, fechas finitas 1900-2200,
  -- vencimiento >= emisión). Levanta 22023 si algo no valida.
  v_ot := private.gg_sanitizar_otorgamiento(jsonb_build_object(
    'matricula', p_matricula,
    'legajo', p_legajo,
    'fecha_emision', p_fecha_emision,
    'fecha_vencimiento', p_fecha_vencimiento
  ));
  IF v_ot IS NULL THEN
    -- No debería pasar (vencimiento no es NULL), pero por las dudas.
    RAISE EXCEPTION 'No se cargó ningún dato del otorgamiento.' USING ERRCODE = '22023';
  END IF;

  -- Escritura a la ficha (COALESCE: un campo vacío conserva el valor actual).
  UPDATE public.administraciones a SET
    matricula_rpac             = COALESCE(v_ot->>'matricula', a.matricula_rpac),
    legajo_rpac                = COALESCE(v_ot->>'legajo', a.legajo_rpac),
    matricula_rpac_fecha       = COALESCE((v_ot->>'fecha_emision')::date, a.matricula_rpac_fecha),
    matricula_rpac_vencimiento = COALESCE((v_ot->>'fecha_vencimiento')::date, a.matricula_rpac_vencimiento),
    updated_at = now()
  WHERE a.id = v_admin;

  UPDATE public.tramites SET ultima_actividad_at = now() WHERE id = p_tramite_id;

  RETURN (SELECT jsonb_build_object(
    'administracion_id', a.id,
    'matricula_rpac', a.matricula_rpac,
    'legajo_rpac', a.legajo_rpac,
    'matricula_rpac_fecha', a.matricula_rpac_fecha,
    'matricula_rpac_vencimiento', a.matricula_rpac_vencimiento
  ) FROM public.administraciones a WHERE a.id = v_admin);
END;
$function$;

REVOKE ALL ON FUNCTION public.tracking_cargar_otorgamiento(uuid, text, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_cargar_otorgamiento(uuid, text, text, date, date) TO authenticated;
