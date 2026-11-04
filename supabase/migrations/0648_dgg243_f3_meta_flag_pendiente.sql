-- 0648 · DGG-243 · F3 — credencial_reg_meta expone `pendiente` (propuesta en curso) sin el secreto.
--
-- Hallazgo §6 F3 (A#2/C#2, menor): para el CLIENTE, el meta devuelve existe:false cuando la credencial
-- está sólo 'propuesto' (gestoría propuso, gerencia no publicó). La sección DDJJ del portal infería
-- "en curso" por un trámite 'dj' abierto; si la propuesta colgaba de un trámite ya cerrado o de otra
-- categoría, el cliente veía el CTA comercial ("Quiero el servicio") pese a tener gestión en marcha.
--
-- Fix: el meta agrega `pendiente` = (prop_at IS NOT NULL) para TODOS. El cliente lo mapea a "estamos
-- preparando tu acceso" SIN ver usuario/contraseña propuestos (el secreto sigue sólo en reveal/moderación).
-- Aditivo: nueva clave jsonb; los consumidores existentes (modal F2a) leen existe/usuario/tiene_password
-- y no se afectan. Misma firma (CREATE OR REPLACE in-place, cero overload R16).

CREATE OR REPLACE FUNCTION public.credencial_reg_meta(p_administracion_id uuid, p_plataforma text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_staff boolean := private.is_staff(); r record;
BEGIN
  IF p_plataforma NOT IN ('ddjj','arca') THEN
    RAISE EXCEPTION 'plataforma inválida: %', p_plataforma USING ERRCODE = '22023';
  END IF;
  PERFORM private.assert_administracion_access(p_administracion_id);                       -- gate primario (R12)
  IF NOT v_staff AND private.current_administracion_id() IS DISTINCT FROM p_administracion_id THEN
    RAISE EXCEPTION 'acceso denegado' USING ERRCODE = '42501';                             -- defensa en profundidad (sin GUC)
  END IF;
  SELECT usuario, (password_cifrada IS NOT NULL) AS tiene_password, estado, updated_at,
         (prop_at IS NOT NULL) AS pendiente
    INTO r FROM public.credenciales_regulatorias
    WHERE administracion_id = p_administracion_id AND plataforma = p_plataforma;
  IF NOT FOUND THEN RETURN jsonb_build_object('existe', false, 'pendiente', false); END IF;
  IF NOT v_staff AND r.estado <> 'publicado' THEN
    -- Propuesto/borrador: el cliente no ve la credencial, pero sí sabe que está en curso.
    RETURN jsonb_build_object('existe', false, 'pendiente', r.pendiente);
  END IF;
  RETURN jsonb_build_object('existe', true, 'usuario', r.usuario, 'tiene_password', r.tiene_password,
                            'estado', r.estado, 'updated_at', r.updated_at, 'pendiente', r.pendiente);
END $fn$;
