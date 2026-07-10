-- 0321 · Blindaje de identidad del cliente (decisiones Pablo, 2ª tanda).
-- (A) Dedup por DNI de personas físicas SIN CUIT: índice único duro entre activos
--     sin CUIT (dup inequívoco). No se aplica a los que TIENEN CUIT para no
--     falso-bloquear a un representante responsable de varias administraciones
--     (cada una con su CUIT). Ese caso se cubre con el aviso blando del front.
-- (B) admin_precheck_identidad: el front lo llama antes de crear/editar para
--     detectar (1) un gemelo por CUIT dado de BAJA → el gerente decide reactivar
--     vs crear nueva (la baja pudo ser por un problema que no quiera heredar), y
--     (2) un gemelo por DNI activo → aviso "puede ser la misma persona".

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_dni_activo
  ON public.administraciones (regexp_replace(responsable_dni,'[^0-9]','','g'))
  WHERE activo
    AND responsable_dni IS NOT NULL
    AND (cuit IS NULL OR btrim(cuit) = '')
    AND length(regexp_replace(responsable_dni,'[^0-9]','','g')) BETWEEN 7 AND 8;

CREATE OR REPLACE FUNCTION public.admin_precheck_identidad(
  p_cuit text DEFAULT NULL, p_dni text DEFAULT NULL, p_excluir_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cuit text := regexp_replace(coalesce(p_cuit,''),'[^0-9]','','g');
  v_dni  text := regexp_replace(coalesce(p_dni,''),'[^0-9]','','g');
  v_cuit_twin jsonb; v_dni_twin jsonb;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo gerencia' USING ERRCODE='42501'; END IF;
  IF length(v_cuit) = 11 THEN
    SELECT jsonb_build_object('id',id,'nombre',nombre,'activo',activo,'estado',estado)
      INTO v_cuit_twin FROM public.administraciones
     WHERE regexp_replace(coalesce(cuit,''),'[^0-9]','','g') = v_cuit
       AND (p_excluir_id IS NULL OR id <> p_excluir_id)
     ORDER BY activo DESC, created_at ASC LIMIT 1;
  END IF;
  IF length(v_dni) BETWEEN 7 AND 8 THEN
    SELECT jsonb_build_object('id',id,'nombre',nombre)
      INTO v_dni_twin FROM public.administraciones
     WHERE activo AND regexp_replace(coalesce(responsable_dni,''),'[^0-9]','','g') = v_dni
       AND (p_excluir_id IS NULL OR id <> p_excluir_id)
     ORDER BY created_at ASC LIMIT 1;
  END IF;
  RETURN jsonb_build_object('cuit_twin', v_cuit_twin, 'dni_twin', v_dni_twin);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_precheck_identidad(text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_precheck_identidad(text,text,uuid) TO authenticated;
