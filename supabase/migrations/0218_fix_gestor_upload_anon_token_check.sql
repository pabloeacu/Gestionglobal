-- E-GG-64 (2ª capa): el upload del gestor externo (anon) a gestor-uploads nunca
-- funcionó. La policy gestor_up_anon_insert validaba el token con un EXISTS inline
-- sobre accesos_externos, pero esa tabla tiene RLS staff-only (sin policy anon) →
-- el EXISTS, evaluado como anon, NO ve la fila → "new row violates RLS".
-- Fix: helper SECURITY DEFINER en public (bypassa la RLS de accesos_externos,
-- devuelve sólo boolean, ejecutable por anon) que valida que el primer segmento
-- del path sea un token de solicitud vigente; la policy lo usa en vez del EXISTS.

CREATE OR REPLACE FUNCTION public.gestor_upload_path_ok(p_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.accesos_externos
    WHERE token = split_part(p_name, '/', 1)
      AND recurso_tipo = 'solicitud'
      AND revocado_at IS NULL
      AND vence_at > now()
  );
$function$;
REVOKE EXECUTE ON FUNCTION public.gestor_upload_path_ok(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gestor_upload_path_ok(text) TO anon, authenticated;

DROP POLICY IF EXISTS gestor_up_anon_insert ON storage.objects;
CREATE POLICY gestor_up_anon_insert ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'gestor-uploads'
    AND public.gestor_upload_path_ok(name)
  );
