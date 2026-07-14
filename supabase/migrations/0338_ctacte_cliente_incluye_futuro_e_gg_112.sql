-- 0338 · E-GG-112 (doc JL wave 6 · P5-B): la Cta.Cte. del portal del cliente
-- oculta movimientos con fecha FUTURA, desincronizándose del saldo del inicio.
--
-- Causa raíz: cliente_ctacte_extracto capa el extracto con
-- `v_hasta := COALESCE(p_hasta, CURRENT_DATE)`. Un pago (o comprobante) con fecha
-- futura (ej. valor diferido cargado el 14/07 estando a 13/07, o por desfase UTC)
-- queda EXCLUIDO del extracto — pero el saldo del inicio del portal
-- (cliente_deuda_neta = SUM(saldo_pendiente), sin filtro de fecha) ya bajó al
-- imputarse el pago. Resultado: el cliente ve "pagado" en el inicio y "debe" en
-- su Cta.Cte. (y el caso espejo con un comprobante de fecha futura).
--
-- Fix quirúrgico: cuando el portal NO pasa tope (p_hasta NULL, único caller sin
-- tope junto a la ficha de gerencia), usar 'infinity' como tope para incluir
-- movimientos/comprobantes futuros → el saldo acumulado final del extracto
-- reconcilia con el saldo del inicio. Para cualquier fecha pasada/actual,
-- 'infinity' >= esa fecha, así que el BETWEEN devuelve exactamente lo mismo que
-- antes (no rompe flujos ya probados con movimientos de fecha pasada/actual).
-- NO se toca cuenta_corriente_extracto (compartida) ni cliente_deuda_neta.
-- Misma firma (date,date,uuid) → CREATE OR REPLACE, sin overload (R16 ok);
-- preserva el REVOKE anon histórico.

CREATE OR REPLACE FUNCTION public.cliente_ctacte_extracto(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_admin_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(fecha date, tipo text, descripcion text, debe numeric, haber numeric, saldo numeric, comprobante_id uuid, movimiento_id uuid, imputacion_id uuid, consorcio_nombre text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin_id uuid;
  v_desde    date;
  v_hasta    date;
BEGIN
  IF p_admin_id IS NOT NULL THEN
    IF NOT private.is_staff() THEN
      RAISE EXCEPTION 'Solo staff puede consultar CC de otra administración'
        USING ERRCODE = '42501';
    END IF;
    v_admin_id := p_admin_id;
  ELSE
    v_admin_id := private.current_administracion_id();
  END IF;
  IF v_admin_id IS NULL THEN
    RETURN;
  END IF;
  v_desde := COALESCE(p_desde, (CURRENT_DATE - INTERVAL '1 year')::date);
  -- E-GG-112: tope 'infinity' cuando no se pasa p_hasta, para incluir movimientos
  -- y comprobantes con fecha futura y reconciliar con el saldo del inicio.
  v_hasta := COALESCE(p_hasta, 'infinity'::date);
  RETURN QUERY
  SELECT * FROM public.cuenta_corriente_extracto(v_admin_id, v_desde, v_hasta);
END;
$function$;
