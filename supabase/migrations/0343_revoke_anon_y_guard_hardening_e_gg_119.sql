-- 0343 · E-GG-119: regresión de postura de seguridad detectada por la auditoría
-- adversarial de wave 6 (idéntica a E-GG-109b/mig 0336, reintroducida).
--
-- CAUSA RAÍZ (misma que E-GG-109b): la mig 0339 reescribió
-- `registrar_cobranza_comprobante` con DROP FUNCTION + CREATE FUNCTION, y la
-- 0342 creó `administraciones_con_deuda` nueva. El proyecto tiene
-- ALTER DEFAULT PRIVILEGES que auto-otorga EXECUTE a anon/PUBLIC en toda
-- función nueva → ambas quedaron ejecutables por `anon` con la anon-key
-- pública. Ambas migraciones sólo hicieron `REVOKE … FROM PUBLIC`, que NO
-- saca el grant explícito de `anon` (hay que nombrar `anon` explícito).
--
-- AGRAVANTE (por qué es crítico y no "postura"): el backstop de ambas es
-- `IF NOT private.is_staff()`, que FALLA-ABIERTO para anon:
--   auth.uid()=NULL → get_user_role()=NULL → is_staff()=NULL
--   → `NOT NULL` = NULL → el IF no dispara el RAISE/RETURN.
-- Verificado en vivo: `private.is_staff()` sin auth devuelve NULL. Como ambas
-- son SECURITY DEFINER (bypassa RLS), un caller anónimo con un comprobante_id
-- + caja_id conocidos podría escribir un asiento contable
-- (`registrar_cobranza_comprobante` es el ÚNICO writer contable), y
-- enumerar el set de administraciones morosas (`administraciones_con_deuda`).
--
-- DOBLE FIX canónico (patrón 0336):
--   (1) guard `IS NOT TRUE` (rebota NULL/anon además de false) — defensa en
--       profundidad, safe-by-default ante futuros DROP+CREATE.
--   (2) REVOKE de anon/PUBLIC (defensa primaria) + GRANT sólo staff-roles.

-- ── (1) registrar_cobranza_comprobante ──────────────────────────────────────
-- Misma firma 9-arg → CREATE OR REPLACE (R16 ok, sin overload). Sólo cambia
-- el guard `IF NOT ...` → `IS NOT TRUE`; el resto es byte-idéntico a 0339.
CREATE OR REPLACE FUNCTION public.registrar_cobranza_comprobante(
  p_comprobante_id uuid, p_caja_id uuid, p_fecha date, p_monto numeric,
  p_descripcion text, p_referencia text, p_categoria_id uuid,
  p_partner_id_atribucion uuid DEFAULT NULL::uuid,
  p_permitir_excedente boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_comp public.comprobantes%ROWTYPE;
  v_mov_id uuid;
  v_imputar numeric;
BEGIN
  -- IS NOT TRUE rebota tanto false (rol no-staff) como NULL (anon sin rol).
  IF private.is_staff() IS NOT TRUE THEN
    RAISE EXCEPTION 'Solo gerencia/operacion puede registrar cobranzas' USING ERRCODE = '42501';
  END IF;
  p_monto := round(p_monto, 2);
  IF p_monto IS NULL OR NOT (p_monto > 0) THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0 (recibido: %)', p_monto;
  END IF;
  IF p_partner_id_atribucion IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.partners WHERE id = p_partner_id_atribucion AND activo) THEN
    RAISE EXCEPTION 'partner_inexistente_o_inactivo' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_comp FROM public.comprobantes WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comprobante no encontrado';
  END IF;
  IF v_comp.estado = 'anulado' THEN
    RAISE EXCEPTION 'No se puede cobrar un comprobante anulado';
  END IF;

  IF p_monto > v_comp.saldo_pendiente THEN
    IF NOT p_permitir_excedente THEN
      RAISE EXCEPTION 'El monto (%) supera el saldo pendiente (%) del comprobante',
        p_monto, v_comp.saldo_pendiente;
    END IF;
    v_imputar := v_comp.saldo_pendiente;
  ELSE
    v_imputar := p_monto;
  END IF;

  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, categoria_id, descripcion, referencia,
    administracion_id, consorcio_id, comprobante_id,
    estado, origen, created_by, partner_id_atribucion
  ) VALUES (
    p_caja_id, p_fecha, 'ingreso', p_monto, p_categoria_id,
    NULLIF(trim(p_descripcion), ''), NULLIF(trim(p_referencia), ''),
    v_comp.administracion_id, v_comp.consorcio_id, p_comprobante_id,
    'identificado', 'facturacion', auth.uid(), p_partner_id_atribucion
  ) RETURNING id INTO v_mov_id;

  INSERT INTO public.movimiento_imputaciones (
    movimiento_id, comprobante_id, monto_imputado
  ) VALUES (
    v_mov_id, p_comprobante_id, v_imputar
  );

  RETURN v_mov_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_cobranza_comprobante(uuid,uuid,date,numeric,text,text,uuid,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_cobranza_comprobante(uuid,uuid,date,numeric,text,text,uuid,uuid,boolean) TO authenticated, service_role;

-- ── (2) administraciones_con_deuda ──────────────────────────────────────────
-- Guard `IS NOT TRUE` para que anon reciba set vacío (no la lista de morosos).
CREATE OR REPLACE FUNCTION public.administraciones_con_deuda()
 RETURNS SETOF uuid
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF private.is_staff() IS NOT TRUE THEN RETURN; END IF;
  RETURN QUERY
  WITH deudas AS (
    SELECT c.administracion_id AS id, COALESCE(SUM(c.saldo_pendiente),0) AS deuda_bruta
    FROM public.comprobantes c
    WHERE c.administracion_id IS NOT NULL
      AND c.estado NOT IN ('anulado','borrador') AND c.saldo_pendiente > 0
    GROUP BY c.administracion_id
  ),
  creditos AS (
    SELECT m.administracion_id AS aid, SUM(m.monto - COALESCE(imp.aplicado,0)) AS credito
    FROM public.movimientos m
    LEFT JOIN LATERAL (
      SELECT SUM(mi.monto_imputado) AS aplicado FROM public.movimiento_imputaciones mi
       WHERE mi.movimiento_id = m.id AND mi.comprobante_id IS NOT NULL
    ) imp ON true
    WHERE m.administracion_id IS NOT NULL AND m.tipo='ingreso'
      AND m.estado='identificado' AND m.revertido_at IS NULL
      AND (m.monto - COALESCE(imp.aplicado,0)) > 0.001
    GROUP BY m.administracion_id
  )
  SELECT d.id
  FROM deudas d LEFT JOIN creditos cr ON cr.aid = d.id
  WHERE (d.deuda_bruta - COALESCE(cr.credito,0)) > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.administraciones_con_deuda() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.administraciones_con_deuda() TO authenticated, service_role;
