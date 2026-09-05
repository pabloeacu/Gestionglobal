-- ============================================================================
-- 0464 · DGG-157 (deuda §6 A#4b) — swap de orden: lock FOR UPDATE anti-carrera
-- ----------------------------------------------------------------------------
-- Las RPCs de swap (mig 0463) leían el `orden` con SELECT plano. Bajo dos swaps
-- concurrentes SOLAPADOS (READ COMMITTED) podían usar valores capturados y dejar
-- dos filas con el mismo `orden` — justo el invariante que el swap busca evitar.
-- Fix: lockear AMBAS filas con `FOR UPDATE`, ordenadas por `id` (orden estable →
-- sin deadlock entre transacciones cruzadas), ANTES de leer/escribir. Así un swap
-- concurrente que toque una de esas filas espera y lee el valor ya committeado.
-- Baja probabilidad real (staff = 2 personas) pero cierra el hueco del todo.
-- ============================================================================

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

  -- Lock de ambas filas en orden de id (evita deadlock) antes de leer/escribir.
  PERFORM 1 FROM public.curso_modulos WHERE id IN (p_a, p_b) ORDER BY id FOR UPDATE;

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

  PERFORM 1 FROM public.curso_clases WHERE id IN (p_a, p_b) ORDER BY id FOR UPDATE;

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
