-- ============================================================================
-- 0249_movimiento_adjuntos_partner_rls_fix.sql
-- E-GG-44 · Las policies partner de movimiento_adjuntos (tabla + storage) hacían
-- un subquery a public.movimientos, que tiene RLS staff-only (SELECT = is_staff()).
-- Una USING-expr evaluada por el rol del partner ejecuta ese subquery TAMBIÉN bajo
-- la RLS de movimientos → 0 filas → el predicado SIEMPRE da false. Resultado: el
-- partner no veía NI descargaba sus PROPIAS constancias en su portal (gerencia sí,
-- porque is_staff() corta por la staff-policy). Aislamiento cross-partner intacto,
-- pero la mitad-partner de la Fase A quedaba rota.
--
-- Fix sin ampliar el acceso directo a movimientos: helpers SECURITY DEFINER que
-- resuelven la pertenencia esquivando la RLS de movimientos, y recrear ambas
-- policies partner para que llamen al helper. (Mismo patrón que current_partner_id.)
-- ============================================================================

-- ¿El partner actual (JWT) es el atribuido del movimiento?
CREATE OR REPLACE FUNCTION private.partner_owns_movimiento(p_movimiento_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.movimientos m
     WHERE m.id = p_movimiento_id
       AND m.partner_id_atribucion IS NOT NULL
       AND m.partner_id_atribucion = private.current_partner_id()
  );
$$;

-- ¿El partner actual (JWT) es dueño del adjunto cuyo storage_path es p_path?
CREATE OR REPLACE FUNCTION private.partner_owns_adjunto_path(p_path text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.movimiento_adjuntos a
      JOIN public.movimientos m ON m.id = a.movimiento_id
     WHERE a.storage_path = p_path
       AND m.partner_id_atribucion IS NOT NULL
       AND m.partner_id_atribucion = private.current_partner_id()
  );
$$;

REVOKE ALL ON FUNCTION private.partner_owns_movimiento(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.partner_owns_adjunto_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.partner_owns_movimiento(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.partner_owns_adjunto_path(text) TO authenticated;

-- Recrear policy partner de la TABLA usando el helper SD.
DROP POLICY IF EXISTS mov_adj_partner_select ON public.movimiento_adjuntos;
CREATE POLICY mov_adj_partner_select ON public.movimiento_adjuntos
  FOR SELECT TO authenticated
  USING (private.partner_owns_movimiento(movimiento_id));

-- Recrear policy partner de STORAGE usando el helper SD.
DROP POLICY IF EXISTS mov_adj_obj_partner_select ON storage.objects;
CREATE POLICY mov_adj_obj_partner_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'movimiento-adjuntos'
    AND private.partner_owns_adjunto_path(name)
  );
