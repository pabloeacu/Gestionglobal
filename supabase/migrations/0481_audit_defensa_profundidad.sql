-- 0481 · Auditoría 2026-09 · Defensa en profundidad (BAJA, aditivo, sin cambio funcional).
--
-- (1) marcar_renovados_masivo: guard fail-fast propio. Hoy NO es explotable — el
--     inner marcar_renovado ya hace IF NOT private.is_staff() THEN RAISE 42501, y
--     todo corre en una transacción, así que un no-staff falla en la iteración 1 y
--     no se commitea nada. Agregamos el guard al tope para fallar rápido y explícito,
--     sin depender del guard transitivo del inner (R12, defensa en profundidad).
--     CREATE OR REPLACE (misma firma) → preserva grants, sin overload (R16).
--
-- (2) 2 tablas de log internas (gestor_uploads_huerfanos_alertados, ofrecimientos_log)
--     tenían el GRANT default amplio (ALL) a anon+authenticated. Son INERTES (RLS on
--     con 0 policies → todo read/write de anon/authenticated queda default-denied) y
--     los escritores reales son triggers/RPC SECURITY DEFINER (owner postgres, bypass
--     grant). El front no las referencia (verificado por grep). Revocamos por higiene
--     de mínimo privilegio (tema T1). Sin cambio funcional.

-- (1)
CREATE OR REPLACE FUNCTION public.marcar_renovados_masivo(p_ids uuid[], p_nuevas_fechas date[])
RETURNS TABLE(original_id uuid, nuevo_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  i int;
  total int;
  v_nuevo uuid;
BEGIN
  -- Defensa en profundidad (auditoría): fail-fast staff-gate al tope.
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede renovar vencimientos' USING ERRCODE = '42501';
  END IF;

  IF p_ids IS NULL OR p_nuevas_fechas IS NULL THEN
    RAISE EXCEPTION 'Parámetros vacíos';
  END IF;
  total := array_length(p_ids, 1);
  IF total IS NULL OR total = 0 THEN
    RAISE EXCEPTION 'No se enviaron IDs para renovar';
  END IF;
  IF array_length(p_nuevas_fechas, 1) <> total THEN
    RAISE EXCEPTION 'IDs y fechas deben tener la misma cantidad (%, %)',
      total, array_length(p_nuevas_fechas, 1);
  END IF;

  FOR i IN 1..total LOOP
    v_nuevo := public.marcar_renovado(p_ids[i], p_nuevas_fechas[i]);
    original_id := p_ids[i];
    nuevo_id := v_nuevo;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- (2)
REVOKE ALL ON public.gestor_uploads_huerfanos_alertados FROM anon, authenticated;
REVOKE ALL ON public.ofrecimientos_log FROM anon, authenticated;
