-- ============================================================================
-- 0171 · DGG-34 · RPC actualizar_gerente (cierra GAP UI usuarios)
--
-- Antes: en /gerencia/configuracion/usuarios sólo había crear + eliminar.
-- Cambiar nombre o rol de un gerente/operador requería SQL manual.
--
-- Esta mig agrega `public.actualizar_gerente(user_id, full_name, role)` que
-- valida actor (gerente/superadmin), valida rol target (gerente|operador) y
-- valida nombre no vacío antes de tocar `public.profiles`.
--
-- Reglas: 4 (queries en services/), 5 (RPC SECURITY DEFINER), 6 (GRANT
-- explícito desde mig 0130), 12 (acá no aplica, es staff-only sin
-- p_administracion_id).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.actualizar_gerente(
  p_user_id    uuid,
  p_full_name  text,
  p_role       text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_role text;
BEGIN
  -- Solo gerente puede mutar otros gerentes/operadores
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = auth.uid();
  IF v_actor_role NOT IN ('gerente', 'superadmin') THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('gerente', 'operador') THEN
    RAISE EXCEPTION 'Rol inválido: %', p_role USING ERRCODE = '22023';
  END IF;
  IF p_full_name IS NULL OR length(trim(p_full_name)) = 0 THEN
    RAISE EXCEPTION 'Nombre requerido' USING ERRCODE = '22023';
  END IF;
  UPDATE public.profiles
    SET full_name = trim(p_full_name),
        role      = p_role
   WHERE id = p_user_id
     AND role IN ('gerente', 'operador');  -- no mutar clientes/partners/gestores
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o no editable' USING ERRCODE = 'P0002';
  END IF;
  RETURN p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.actualizar_gerente(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.actualizar_gerente(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.actualizar_gerente IS
  'DGG-34 · Edita nombre y rol de un gerente/operador. Sólo callable por gerente/superadmin.';
