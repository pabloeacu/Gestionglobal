-- ============================================================================
-- 0463 · DGG-157 (deuda §6 A#3/C#4b) — reorden por SWAP ATÓMICO
-- ----------------------------------------------------------------------------
-- El reorden de módulos/clases del editor hacía DOS UPDATE por separado (front,
-- Promise.all). Ante un fallo parcial (1 sale, 1 no) quedaban dos filas con el
-- mismo `orden` → sort inestable. Se reemplaza por una RPC que swapea el `orden`
-- de dos filas EN UNA TRANSACCIÓN (todo-o-nada). Como el badge del editor ya es
-- por posición, el `orden` es sólo clave de sort; intercambiarlo mueve un lugar.
--
-- Gate: `private.is_staff()` — espeja EXACTO la policy de write (*_cud) de ambas
-- tablas (curso_modulos_cud / curso_clases_cud USING/CHECK private.is_staff()).
-- SECURITY DEFINER (bypassa RLS) → el gate interno es obligatorio. R12 no aplica
-- (no recibe administracion_id; es edición de contenido, staff-only). El trigger
-- BEFORE UPDATE de estas tablas (touch_updated_at) sólo setea NEW.updated_at, no
-- escribe en otra tabla RLS → R17 no aplica.
--
-- Rendimiento (R11): 2 UPDATE por PK sobre ≤N filas → trivial (<1ms). Sin EXPLAIN.
-- ============================================================================

-- ── Módulos ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.curso_modulos_swap_orden(p_a uuid, p_b uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_orden_a int; v_curso_a uuid;
  v_orden_b int; v_curso_b uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo el equipo de gestión puede reordenar módulos.'
      USING ERRCODE = '42501';
  END IF;

  SELECT orden, curso_id INTO v_orden_a, v_curso_a FROM public.curso_modulos WHERE id = p_a;
  SELECT orden, curso_id INTO v_orden_b, v_curso_b FROM public.curso_modulos WHERE id = p_b;

  IF v_curso_a IS NULL OR v_curso_b IS NULL THEN
    RAISE EXCEPTION 'Módulo inexistente.' USING ERRCODE = 'P0002';
  END IF;
  IF v_curso_a IS DISTINCT FROM v_curso_b THEN
    RAISE EXCEPTION 'Los módulos no pertenecen al mismo curso.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.curso_modulos SET orden = v_orden_b WHERE id = p_a;
  UPDATE public.curso_modulos SET orden = v_orden_a WHERE id = p_b;
END;
$$;

REVOKE ALL ON FUNCTION public.curso_modulos_swap_orden(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.curso_modulos_swap_orden(uuid, uuid) TO authenticated;

-- ── Clases ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.curso_clases_swap_orden(p_a uuid, p_b uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_orden_a int; v_modulo_a uuid;
  v_orden_b int; v_modulo_b uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo el equipo de gestión puede reordenar clases.'
      USING ERRCODE = '42501';
  END IF;

  SELECT orden, modulo_id INTO v_orden_a, v_modulo_a FROM public.curso_clases WHERE id = p_a;
  SELECT orden, modulo_id INTO v_orden_b, v_modulo_b FROM public.curso_clases WHERE id = p_b;

  IF v_modulo_a IS NULL OR v_modulo_b IS NULL THEN
    RAISE EXCEPTION 'Clase inexistente.' USING ERRCODE = 'P0002';
  END IF;
  IF v_modulo_a IS DISTINCT FROM v_modulo_b THEN
    RAISE EXCEPTION 'Las clases no pertenecen al mismo módulo.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.curso_clases SET orden = v_orden_b WHERE id = p_a;
  UPDATE public.curso_clases SET orden = v_orden_a WHERE id = p_b;
END;
$$;

REVOKE ALL ON FUNCTION public.curso_clases_swap_orden(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.curso_clases_swap_orden(uuid, uuid) TO authenticated;
