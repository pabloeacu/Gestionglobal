-- DGG-164 · Imputar un PAGO A CUENTA (o cualquier crédito) a un comprobante debe
-- reescribir la descripción del movimiento como cobranza del servicio.
--
-- Caso (reporte Pablo): la cobranza de Ayastuy Martin se cargó como "Pago a Cuenta"
-- porque el trámite todavía no había ingresado (movimiento ingreso, identificado,
-- SIN descripción). Cuando el trámite ingresó y se le imputó ese pago a cuenta, la
-- descripción NO cambió → quedó "Sin descripción". El caso correcto (DEBERNARDI)
-- muestra "Cobranza · Inscripción al RPAC" porque pasó por `fz_identificar_movimiento`,
-- que SÍ deriva la descripción "Cobranza · <item>" antes de imputar.
--
-- Causa raíz: la vía DIRECTA de imputación (`imputar_credito_a_comprobante`, que
-- `fz_identificar_movimiento` también invoca) inserta en `movimiento_imputaciones`
-- pero NUNCA toca `movimientos.descripcion`. Un pago a cuenta ya identificado (no
-- pasa por identificar) se imputa por esta vía y conserva su descripción vacía.
--
-- Fix: tras imputar, si el movimiento NO tiene descripción propia, dársela como
-- "Cobranza · <primer item del comprobante>" (o el número de comprobante como
-- fallback), MISMO formato que `fz_identificar_movimiento`. Sólo cuando está vacía:
-- no pisa una descripción escrita a mano (p. ej. un crédito por anulación ya rotulado).
-- La imputación real (monto/imputaciones) no se toca: es sólo el texto de display,
-- que así queda consistente en las 3 superficies (movimientos, caja, cta.cte).
--
-- Firma idéntica → CREATE OR REPLACE (sin overload, R16). GRANTs preservados.

CREATE OR REPLACE FUNCTION public.imputar_credito_a_comprobante(p_movimiento_id uuid, p_comprobante_id uuid, p_monto numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_mov public.movimientos%ROWTYPE;
  v_comp public.comprobantes%ROWTYPE;
  v_saldo_credito numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a 0'; END IF;

  SELECT * INTO v_mov FROM public.movimientos WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El saldo a favor no existe'; END IF;
  IF v_mov.tipo <> 'ingreso' OR v_mov.estado <> 'identificado' OR v_mov.revertido_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ese movimiento no es un ingreso disponible';
  END IF;

  SELECT * INTO v_comp FROM public.comprobantes WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El comprobante no existe'; END IF;
  IF v_comp.estado = 'anulado' THEN RAISE EXCEPTION 'El comprobante está anulado'; END IF;
  IF COALESCE(v_comp.saldo_pendiente, 0) <= 0 THEN RAISE EXCEPTION 'El comprobante no tiene saldo pendiente'; END IF;

  IF v_mov.administracion_id IS DISTINCT FROM v_comp.administracion_id THEN
    RAISE EXCEPTION 'El saldo a favor y el comprobante pertenecen a administraciones distintas';
  END IF;

  v_saldo_credito := v_mov.monto - COALESCE((SELECT sum(mi.monto_imputado) FROM public.movimiento_imputaciones mi
                                              WHERE mi.movimiento_id = p_movimiento_id), 0);
  IF v_saldo_credito <= 0 THEN RAISE EXCEPTION 'Ese saldo a favor ya fue aplicado'; END IF;
  IF p_monto > v_saldo_credito THEN
    RAISE EXCEPTION 'El monto (%) supera el saldo a favor disponible (%)', p_monto, v_saldo_credito;
  END IF;
  IF p_monto > v_comp.saldo_pendiente THEN
    RAISE EXCEPTION 'El monto (%) supera el saldo del comprobante (%)', p_monto, v_comp.saldo_pendiente;
  END IF;

  INSERT INTO public.movimiento_imputaciones
    (movimiento_id, comprobante_id, administracion_id, monto_imputado, nota, created_by)
  VALUES (p_movimiento_id, p_comprobante_id, NULL, p_monto,
          'Saldo a favor aplicado (crédito por anulación/pago a cuenta)', v_user);

  -- DGG-164 · si el movimiento no tenía descripción propia (típico de un pago a
  -- cuenta), al imputarlo le damos la de la cobranza del servicio, espejando el
  -- formato de fz_identificar_movimiento. Sólo si está vacía (no pisa lo escrito).
  UPDATE public.movimientos m
     SET descripcion = COALESCE(
           (SELECT 'Cobranza · ' || i.descripcion
              FROM public.items_comprobantes i
             WHERE i.comprobante_id = p_comprobante_id
               AND NULLIF(trim(i.descripcion), '') IS NOT NULL
             ORDER BY i.orden ASC, i.created_at ASC LIMIT 1),
           (SELECT 'Cobranza · ' || c.tipo || ' ' || lpad(c.punto_venta::text, 4, '0')
                   || '-' || COALESCE(lpad(c.numero::text, 8, '0'), 's/n')
              FROM public.comprobantes c WHERE c.id = p_comprobante_id)
         )
   WHERE m.id = p_movimiento_id
     AND NULLIF(btrim(m.descripcion), '') IS NULL;

  RETURN jsonb_build_object('ok', true,
    'credito_restante', v_saldo_credito - p_monto,
    'comprobante_saldo', (SELECT saldo_pendiente FROM public.comprobantes WHERE id = p_comprobante_id));
END;
$function$;

-- Backfill de la clase completa: todo ingreso con descripción vacía que ya tiene
-- imputación toma la cobranza del PRIMER comprobante imputado (por fecha de imputación).
-- Cubre los casos vivos (Ayastuy Martin, Mercerat Virginia) sin parche puntual.
UPDATE public.movimientos m
   SET descripcion = sub.desc_cobranza
  FROM (
    SELECT mi.movimiento_id,
           COALESCE(
             (SELECT 'Cobranza · ' || i.descripcion
                FROM public.items_comprobantes i
               WHERE i.comprobante_id = mi.comprobante_id
                 AND NULLIF(trim(i.descripcion), '') IS NOT NULL
               ORDER BY i.orden ASC, i.created_at ASC LIMIT 1),
             (SELECT 'Cobranza · ' || c.tipo || ' ' || lpad(c.punto_venta::text, 4, '0')
                     || '-' || COALESCE(lpad(c.numero::text, 8, '0'), 's/n')
                FROM public.comprobantes c WHERE c.id = mi.comprobante_id)
           ) AS desc_cobranza
    FROM public.movimiento_imputaciones mi
    JOIN (
      SELECT movimiento_id, min(created_at) AS first_at
      FROM public.movimiento_imputaciones GROUP BY movimiento_id
    ) f ON f.movimiento_id = mi.movimiento_id AND f.first_at = mi.created_at
  ) sub
 WHERE m.id = sub.movimiento_id
   AND m.tipo = 'ingreso'
   AND NULLIF(btrim(m.descripcion), '') IS NULL
   AND sub.desc_cobranza IS NOT NULL;
