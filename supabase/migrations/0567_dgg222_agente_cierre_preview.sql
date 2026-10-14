-- 0567_dgg222_agente_cierre_preview.sql
-- =============================================================================
-- DGG-222 · Wrapper público READ-ONLY para el dashboard de gerencia.
-- `private.agente_cierre_detectar()` vive en el schema `private` (no la expone
-- PostgREST). El dashboard necesita mostrar "qué haría el bot ahora mismo" SIN
-- cerrar nada → esta RPC pública, staff-guarded, devuelve la clasificación en
-- vivo (es STABLE / sin efectos: sólo lee). Nombre nuevo → sin overload (R16).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agente_cierre_preview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN private.agente_cierre_detectar();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.agente_cierre_preview() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.agente_cierre_preview() TO authenticated, service_role;
