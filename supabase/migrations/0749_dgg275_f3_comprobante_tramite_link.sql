-- 0749 · DGG-275 / DDJJ F3 — Vínculo N:1 comprobantes↔trámite + gate/señales de cobranza.
--
-- Problema (relevamiento F3, hallazgo crítico): el gate de cierre
-- `tramite_cerrar_exige_cobrado` y las señales de cobranza (`cobro_pendiente`,
-- `cobro_estado`, `comprobante_pendiente`, `tramite_cobro_resumen`) resuelven
-- "¿qué comprobantes son de este trámite?" por un vínculo SINGLE:
--   c.id = t.comprobante_id  OR  c.id IN (solicitudes.tramite_id→comprobante_id)
-- No existe `comprobantes.tramite_id`. La emisión DDJJ por-consorcio produce N
-- comprobantes (uno por consorcio: receptor=consorcio, deudor=administración);
-- sólo UNO puede sentarse en `tramites.comprobante_id` → los otros N-1 quedarían
-- INVISIBLES al gate: el trámite podría cerrarse con N-1 comprobantes impagos y
-- el chip `comprobante_pendiente` se apagaría con el primero (viola §6/R19).
--
-- Fix: columna `comprobantes.tramite_id` (N:1) + extender los 5 lectores de
-- cobranza con un tercer camino `OR c.tramite_id = <trámite>`.
--
-- SEGURIDAD POR CONSTRUCCIÓN: todo comprobante existente tiene `tramite_id = NULL`,
-- así que `OR c.tramite_id = t.id` NO matchea nada hoy → CERO cambio de
-- comportamiento para cualquier trámite actual. El camino sólo se activa para los
-- comprobantes de lote que emita F3 (que setean `tramite_id`). Firmas idénticas
-- (CREATE OR REPLACE, R16) — preservan ACL/GRANT/binding de computed columns y trigger.
--
-- NOTA de coherencia §6e (NO se toca a propósito): `private.agente_cierre_detectar`
-- (bot de cierre, OFF por `agente_cierre_activo`) usa `cobro_pendiente(t)` para su
-- flag `impago` → hereda este fix automáticamente; y un trámite DDJJ nunca alcanza
-- `cerrar_limpio` ahí (no mapea `exp_esperado` TRAMIX) → su `arancelado_sin_comp`
-- inline sólo afecta texto, no decisión, y el gate atrapa cualquier cierre. No
-- amerita re-escribir sus 150 líneas (riesgo de transcripción > beneficio en un bot OFF).

-- ───────────── Columna de vínculo N:1 ─────────────
ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS tramite_id uuid REFERENCES public.tramites(id) ON DELETE SET NULL;

-- FK con su índice (R11/E48) — parcial porque la gran mayoría queda NULL.
CREATE INDEX IF NOT EXISTS idx_comprobantes_tramite
  ON public.comprobantes(tramite_id) WHERE tramite_id IS NOT NULL;

COMMENT ON COLUMN public.comprobantes.tramite_id IS
  'DGG-275 F3: vínculo N:1 opcional al trámite que emitió este comprobante (lote DDJJ por-consorcio). NULL para la emisión histórica/single (que vincula por tramites.comprobante_id o solicitudes). Lo leen los 5 lectores de cobranza como tercer camino.';

-- ───────────── 1) cobro_pendiente (0194) + tramite_id ─────────────
CREATE OR REPLACE FUNCTION public.cobro_pendiente(t public.tramites)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.comprobantes c
    WHERE c.estado <> 'anulado'
      AND COALESCE(c.total, 0) > 0
      AND COALESCE(c.saldo_pendiente, 0) > 0
      AND (
        c.id = t.comprobante_id
        OR c.id IN (
          SELECT s.comprobante_id
          FROM public.solicitudes s
          WHERE s.tramite_id = t.id
            AND s.comprobante_id IS NOT NULL
        )
        OR c.tramite_id = t.id            -- DGG-275 F3: lote por-consorcio
      )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.cobro_pendiente(public.tramites) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobro_pendiente(public.tramites) TO authenticated;

-- ───────────── 2) cobro_estado (0255) + tramite_id ─────────────
CREATE OR REPLACE FUNCTION public.cobro_estado(t public.tramites)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN count(*) = 0 THEN NULL
    WHEN bool_or(c.saldo_pendiente < c.total) THEN 'parcial'
    ELSE 'sin_cobranza'
  END
  FROM public.comprobantes c
  WHERE c.estado <> 'anulado'
    AND COALESCE(c.total, 0) > 0
    AND COALESCE(c.saldo_pendiente, 0) > 0
    AND (
      c.id = t.comprobante_id
      OR c.id IN (
        SELECT s.comprobante_id FROM public.solicitudes s
         WHERE s.tramite_id = t.id AND s.comprobante_id IS NOT NULL
      )
      OR c.tramite_id = t.id               -- DGG-275 F3: lote por-consorcio
    );
$function$;

-- ───────────── 3) comprobante_pendiente (0207) + tramite_id ─────────────
CREATE OR REPLACE FUNCTION public.comprobante_pendiente(t public.tramites)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    t.estado NOT IN ('cerrado', 'cancelado')
    AND NOT EXISTS (
      SELECT 1
      FROM public.comprobantes c
      WHERE c.estado <> 'anulado'
        AND (
          c.id = t.comprobante_id
          OR c.id IN (
            SELECT s.comprobante_id
            FROM public.solicitudes s
            WHERE s.tramite_id = t.id
              AND s.comprobante_id IS NOT NULL
          )
          OR c.tramite_id = t.id           -- DGG-275 F3: lote por-consorcio
        )
    );
$$;
REVOKE EXECUTE ON FUNCTION public.comprobante_pendiente(public.tramites) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comprobante_pendiente(public.tramites) TO authenticated;

-- ───────────── 4) tramite_cobro_resumen (0270) + tramite_id ─────────────
CREATE OR REPLACE FUNCTION public.tramite_cobro_resumen(p_tramite_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia/operación' USING ERRCODE='42501';
  END IF;
  WITH comps AS (
    SELECT c.id, c.cae, c.total, c.saldo_pendiente
      FROM public.comprobantes c
      JOIN public.tramites t ON t.id = p_tramite_id
     WHERE c.estado <> 'anulado'
       AND ( c.id = t.comprobante_id
             OR c.id IN (SELECT s.comprobante_id FROM public.solicitudes s
                          WHERE s.tramite_id = p_tramite_id AND s.comprobante_id IS NOT NULL)
             OR c.tramite_id = p_tramite_id )   -- DGG-275 F3: lote por-consorcio
  )
  SELECT jsonb_build_object(
    'tiene_comprobante', EXISTS(SELECT 1 FROM comps),
    'tiene_anulable',    EXISTS(SELECT 1 FROM comps WHERE cae IS NULL),
    'tiene_cae',         EXISTS(SELECT 1 FROM comps WHERE cae IS NOT NULL),
    'pagado_anulable',   COALESCE((SELECT sum(GREATEST(0, COALESCE(total,0) - COALESCE(saldo_pendiente,0))) FROM comps WHERE cae IS NULL), 0),
    'saldo_pendiente',   COALESCE((SELECT sum(saldo_pendiente) FROM comps), 0)
  ) INTO v_out;
  RETURN v_out;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.tramite_cobro_resumen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tramite_cobro_resumen(uuid) TO authenticated;

-- ───────────── 5) tramite_cerrar_exige_cobrado (0584) rama (b) + tramite_id ─────────────
CREATE OR REPLACE FUNCTION public.tramite_cerrar_exige_cobrado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.estado = 'cerrado' AND OLD.estado IS DISTINCT FROM 'cerrado' THEN
    -- (a) impago genuino — usa cobro_pendiente/cobro_estado (ya extendidos a tramite_id)
    IF public.cobro_pendiente(NEW) THEN
      IF public.cobro_estado(NEW) = 'parcial' THEN
        RAISE EXCEPTION 'No se puede cerrar: el trámite tiene un pago a cuenta y queda saldo pendiente. Completá la cobranza (o anulá/bonificá el comprobante) antes de cerrar.' USING ERRCODE = 'check_violation';
      ELSE
        RAISE EXCEPTION 'No se puede cerrar: el trámite no tiene ninguna cobranza registrada (está impago). Registrá la cobranza (o anulá/bonificá el comprobante) antes de cerrar.' USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- (b) servicio arancelado sin NINGÚN comprobante emitido — $0 bonificado cuenta.
    --     DGG-275 F3: también cuenta un comprobante de lote vinculado por tramite_id.
    IF NEW.cierre_satisfactorio IS DISTINCT FROM false
       AND EXISTS (SELECT 1 FROM public.servicios sv WHERE sv.id = NEW.servicio_id
                   AND GREATEST(COALESCE(sv.precio_publico,0), COALESCE(sv.precio_cliente,0), COALESCE(sv.precio_base,0)) > 0)
       AND NOT EXISTS (SELECT 1 FROM public.comprobantes c
                       WHERE c.estado <> 'anulado'
                         AND (c.id = NEW.comprobante_id
                              OR c.id IN (SELECT s.comprobante_id FROM public.solicitudes s WHERE s.tramite_id = NEW.id AND s.comprobante_id IS NOT NULL)
                              OR c.tramite_id = NEW.id))
    THEN
      RAISE EXCEPTION 'No se puede cerrar un servicio arancelado sin emitir el comprobante (quedaría un ingreso sin registrar). Emití y cobrá el comprobante (o emití uno bonificado); si el trámite no prosperó, cerralo como rechazado/abandono desde el detalle.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- (c) matrícula/renovación sin otorgamiento — intacto (no aplica a 'dj').
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
