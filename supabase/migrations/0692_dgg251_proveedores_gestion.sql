-- 0692 · DGG-251 · Gestión de "proveedores frecuentes": editar (retroactivo coherente),
-- desactivar/activar y eliminar (sólo si no tiene uso).
--
-- CONTEXTO (JL, 13-11): creó un proveedor y tipeó mal "fa"; no había dónde editar ni borrar.
-- NATURALEZA (mig 0394, DGG-120): `proveedores_frecuentes` es un CATÁLOGO DE NOMBRES para
-- autocompletar — NO una entidad con cuenta corriente. El nombre vive DENORMALIZADO como texto:
--   · egresos.proveedor_nombre (text) + egresos.proveedor_id (FK blanda ON DELETE SET NULL)
--   · caja: el nombre se concatena a movimientos.descripcion ("ARCA - Pago…")
-- La cuenta corriente/historial agrupa por ese TEXTO. Por eso editar/borrar es SEGURO (no rompe
-- integridad) pero un rename "sólo del catálogo" dejaría el historial partido → 3B renombra también
-- el texto retroactivamente (egresos siempre; caja opcional) para mantener la coherencia contable.
--
-- Diseño: mutaciones por RPC SECURITY DEFINER staff-gated (R5 multi-tabla; la tabla queda SELECT+
-- INSERT para authenticated, las RPC hacen el resto). Nombres nuevos → sin overloads (R16).

-- ── uso de un proveedor (para el preview del rename y el guard del borrado) ──
CREATE OR REPLACE FUNCTION public.proveedor_frecuente_uso(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_nombre text; v_eg int; v_caja int;
BEGIN
  IF private.is_staff() IS NOT TRUE THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
  SELECT nombre INTO v_nombre FROM public.proveedores_frecuentes WHERE id = p_id;
  IF v_nombre IS NULL THEN RAISE EXCEPTION 'Proveedor no encontrado' USING ERRCODE='P0002'; END IF;
  SELECT count(*) INTO v_eg FROM public.egresos
   WHERE proveedor_id = p_id OR lower(btrim(proveedor_nombre)) = lower(btrim(v_nombre));
  SELECT count(*) INTO v_caja FROM public.movimientos
   WHERE tipo='egreso'
     AND (lower(descripcion) = lower(v_nombre) OR starts_with(lower(descripcion), lower(v_nombre) || ' - '));
  RETURN jsonb_build_object('nombre', v_nombre, 'egresos', v_eg, 'caja', v_caja, 'total', v_eg + v_caja);
END $function$;

-- ── renombrar (retroactivo coherente) ──
CREATE OR REPLACE FUNCTION public.proveedor_frecuente_renombrar(
  p_id uuid, p_nombre_nuevo text, p_incluir_caja boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_old text; v_new text; v_eg int := 0; v_caja int := 0;
BEGIN
  IF private.is_staff() IS NOT TRUE THEN RAISE EXCEPTION 'Solo gerencia/operación puede editar proveedores' USING ERRCODE='42501'; END IF;
  v_new := btrim(p_nombre_nuevo);
  IF NULLIF(v_new,'') IS NULL THEN RAISE EXCEPTION 'El nombre no puede estar vacío'; END IF;
  SELECT nombre INTO v_old FROM public.proveedores_frecuentes WHERE id = p_id FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Proveedor no encontrado' USING ERRCODE='P0002'; END IF;
  IF lower(btrim(v_old)) = lower(v_new) THEN
    -- mismo nombre (sólo cambia mayúsculas/espacios): actualizar el catálogo y salir
    UPDATE public.proveedores_frecuentes SET nombre = v_new WHERE id = p_id;
    RETURN jsonb_build_object('egresos_renombrados', 0, 'caja_renombrados', 0, 'nombre', v_new);
  END IF;
  -- colisión con OTRO proveedor (índice único case/trim-insensitive)
  IF EXISTS (SELECT 1 FROM public.proveedores_frecuentes
             WHERE id <> p_id AND lower(btrim(nombre)) = lower(v_new)) THEN
    RAISE EXCEPTION 'Ya existe un proveedor con ese nombre' USING ERRCODE='23505';
  END IF;

  UPDATE public.proveedores_frecuentes SET nombre = v_new WHERE id = p_id;

  -- retroactivo en obligaciones (columna limpia)
  WITH upd AS (
    UPDATE public.egresos SET proveedor_nombre = v_new, proveedor_id = p_id, updated_at = now()
     WHERE proveedor_id = p_id OR lower(btrim(proveedor_nombre)) = lower(btrim(v_old))
     RETURNING 1)
  SELECT count(*) INTO v_eg FROM upd;

  -- retroactivo en caja (prefijo de descripción), opcional
  IF p_incluir_caja THEN
    WITH upd AS (
      UPDATE public.movimientos
         SET descripcion = v_new || substr(descripcion, length(v_old) + 1), updated_at = now()
       WHERE tipo='egreso'
         AND (lower(descripcion) = lower(v_old) OR starts_with(lower(descripcion), lower(v_old) || ' - '))
       RETURNING 1)
    SELECT count(*) INTO v_caja FROM upd;
  END IF;

  RETURN jsonb_build_object('egresos_renombrados', v_eg, 'caja_renombrados', v_caja, 'nombre', v_new);
END $function$;

-- ── activar / desactivar (soft) ──
CREATE OR REPLACE FUNCTION public.proveedor_frecuente_set_activo(p_id uuid, p_activo boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF private.is_staff() IS NOT TRUE THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
  UPDATE public.proveedores_frecuentes SET activo = p_activo WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proveedor no encontrado' USING ERRCODE='P0002'; END IF;
END $function$;

-- ── eliminar (sólo si NO tiene uso) ──
CREATE OR REPLACE FUNCTION public.proveedor_frecuente_eliminar(p_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_nombre text; v_uso int;
BEGIN
  IF private.is_staff() IS NOT TRUE THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
  SELECT nombre INTO v_nombre FROM public.proveedores_frecuentes WHERE id = p_id FOR UPDATE;
  IF v_nombre IS NULL THEN RAISE EXCEPTION 'Proveedor no encontrado' USING ERRCODE='P0002'; END IF;
  SELECT (COALESCE((SELECT count(*) FROM public.egresos
            WHERE proveedor_id = p_id OR lower(btrim(proveedor_nombre)) = lower(btrim(v_nombre))),0)
        + COALESCE((SELECT count(*) FROM public.movimientos
            WHERE tipo='egreso'
              AND (lower(descripcion) = lower(v_nombre) OR starts_with(lower(descripcion), lower(v_nombre) || ' - '))),0))
    INTO v_uso;
  IF v_uso > 0 THEN
    RAISE EXCEPTION 'No se puede eliminar: el proveedor tiene % movimiento(s). Desactivalo o renombralo.', v_uso
      USING ERRCODE='22023';
  END IF;
  DELETE FROM public.proveedores_frecuentes WHERE id = p_id;
END $function$;

-- grants (convención: sólo authenticated; nada a PUBLIC/anon)
DO $g$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('proveedor_frecuente_uso','proveedor_frecuente_renombrar','proveedor_frecuente_set_activo','proveedor_frecuente_eliminar')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
  END LOOP;
END $g$;

-- R16 smoke: sin overloads
DO $s$
DECLARE v text;
BEGIN
  SELECT string_agg(proname,', ') INTO v FROM (
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'proveedor_frecuente_%'
    GROUP BY p.proname HAVING count(*)>1) q;
  IF v IS NOT NULL THEN RAISE EXCEPTION 'overload duplicado: %', v; END IF;
END $s$;
