-- ============================================================================
-- 0061_landing_cover · DGG-27
--
-- Toggle de la landing pública para la fase pre-lanzamiento. Cuando está
-- activo, todo visitante anónimo a `/` ve la página "Proyectando mejoras
-- extraordinarias". Los usuarios con sesión activa (gerentes/admins)
-- bypassean y ven la landing real. Las rutas /ingresar, /gerencia, /portal,
-- /externo, /webinar, /verificar siempre quedan accesibles.
-- ============================================================================

ALTER TABLE public.config_global
  ADD COLUMN IF NOT EXISTS landing_cover_enabled boolean NOT NULL DEFAULT true;

-- RPC anon-callable que devuelve si la cortina está activa.
CREATE OR REPLACE FUNCTION public.get_landing_cover_status()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT COALESCE(landing_cover_enabled, false)
  FROM public.config_global
  WHERE id = 1;
$$;

REVOKE ALL ON FUNCTION public.get_landing_cover_status() FROM public;
GRANT EXECUTE ON FUNCTION public.get_landing_cover_status() TO anon, authenticated;

-- RPC staff-only para encender/apagar la cortina desde la UI.
CREATE OR REPLACE FUNCTION public.set_landing_cover(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo personal autorizado puede cambiar el estado de la cortina';
  END IF;
  UPDATE public.config_global SET landing_cover_enabled = p_enabled WHERE id = 1;
  RETURN p_enabled;
END;
$$;

REVOKE ALL ON FUNCTION public.set_landing_cover(boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_landing_cover(boolean) TO authenticated;
