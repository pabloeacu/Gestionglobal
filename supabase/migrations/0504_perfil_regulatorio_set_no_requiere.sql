-- 0504 · Agenda · progressive profiling (form del cliente) — RPC de REEMPLAZO de `no_requiere`.
-- `perfil_regulatorio_declarar` mergea `no_requiere` shallow con `||` (agrega/pisa, NO quita claves).
-- El form del cliente necesita poder DESTILDAR un "no requiero X" → hace falta reemplazar el objeto
-- entero. Esta RPC setea `no_requiere` wholesale (el caller manda el set COMPLETO de opt-outs vigentes).
-- SECURITY DEFINER + R12 (tenencia) + upsert (crea la fila si no existía). R16: nombre nuevo, sin overload.

CREATE OR REPLACE FUNCTION public.perfil_regulatorio_set_no_requiere(
  p_administracion_id uuid,
  p_no_requiere jsonb
) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);  -- R12
  IF p_no_requiere IS NULL OR jsonb_typeof(p_no_requiere) <> 'object' THEN
    RAISE EXCEPTION 'no_requiere debe ser un objeto jsonb' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.perfil_regulatorio AS pr (administracion_id, no_requiere, updated_by)
  VALUES (p_administracion_id, p_no_requiere, auth.uid())
  ON CONFLICT (administracion_id) DO UPDATE SET
    no_requiere = EXCLUDED.no_requiere,   -- REEMPLAZO wholesale (permite quitar claves)
    updated_by = auth.uid();
END $fn$;
REVOKE ALL ON FUNCTION public.perfil_regulatorio_set_no_requiere(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perfil_regulatorio_set_no_requiere(uuid,jsonb) TO authenticated;
