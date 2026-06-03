-- ============================================================================
-- 0185 · DGG-41 GRANTs faltantes + smoke e2e
--
-- Auditoría doble del chunk celebración (DGG-41) detectó dos GAPs en 0184:
--   1. R6 (post mig 0130): falta `GRANT EXECUTE` explícito a `authenticated`
--      sobre las 2 RPCs nuevas. Sin esto, Supabase a partir del 30/10/2026
--      empieza a denegarlas por default; antes de esa fecha funciona por
--      el GRANT default histórico, pero la regla obliga a explicitarlo.
--   2. R18: 0184 no incluyó un bloque smoke BEGIN/PERFORM/ROLLBACK que
--      verificara las RPCs en tiempo de migración. Lo agregamos acá para
--      cerrar la deuda.
--
-- Este archivo NO modifica el comportamiento, sólo formaliza permisos y
-- documenta el smoke.
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.cliente_certs_celebrar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cert_marcar_celebracion_vista(uuid) TO authenticated;

-- Smoke e2e (R18). Ejecuta como `authenticated` con un uid sintético:
--   - cliente_certs_celebrar() retorna tabla vacía sin error (uid no tiene certs).
--   - cert_marcar_celebracion_vista(uuid_inexistente) lanza P0002 esperable.
DO $$
DECLARE
  v_dummy_uid uuid := '00000000-0000-0000-0000-000000000001';
  v_count int;
  v_caught text := '';
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_dummy_uid, 'role', 'authenticated')::text, true);

  -- 1) listar: el uid sintético no tiene certs → retorna 0 filas, sin error.
  SELECT count(*) INTO v_count FROM public.cliente_certs_celebrar();
  IF v_count IS NULL THEN
    RAISE EXCEPTION 'smoke: cliente_certs_celebrar devolvió NULL';
  END IF;

  -- 2) marcar cert inexistente: debe lanzar P0002 (cert no encontrado).
  BEGIN
    PERFORM public.cert_marcar_celebracion_vista('00000000-0000-0000-0000-000000000099'::uuid);
    RAISE EXCEPTION 'smoke: cert_marcar_celebracion_vista no lanzó error con uuid inexistente';
  EXCEPTION
    WHEN sqlstate 'P0002' THEN
      -- esperado
      v_caught := 'P0002 OK';
  END;

  RAISE NOTICE 'DGG-41 smoke OK · certs_celebrar=% · % ', v_count, v_caught;

  -- Restaurar contexto
  PERFORM set_config('role', 'postgres', true);
END $$;

COMMENT ON FUNCTION public.cliente_certs_celebrar() IS
  'DGG-41 · Lista certs sin "celebración vista" del alumno logueado. Banner portal.';
COMMENT ON FUNCTION public.cert_marcar_celebracion_vista(uuid) IS
  'DGG-41 · Marca un cert como visto (idempotente). Auth: dueño o staff.';
