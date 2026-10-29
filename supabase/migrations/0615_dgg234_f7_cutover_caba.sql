-- 0615_dgg234_f7_cutover_caba.sql
-- DGG-234 · Fase 7 — CUTOVER de los 3 CABA + reversión de la contención.
-- Ver DGG-234_matricula_multijurisdiccion.md §5 (F7) + notas §6-C.
-- --------------------------------------------------------------------------
-- Mueve la matrícula CABA de la columna legacy `administraciones.matricula_rpac`
-- a la tabla hija `matricula_extra` (jurisdiccion='caba'), nula la columna, y así
-- `gg_admin_es_rpac` → false solo → el motor deja de ofrecerles servicios PBA (2ª
-- queja cerrada ESTRUCTURALMENTE). Luego revierte la contención
-- (ofrecimientos_habilitados=true), SÓLO tras verificar es_rpac=false en la misma tx.
--
-- SNAPSHOT (para reversibilidad): Avolio 2cb1a3e3 matricula_rpac=20014 (sin venc);
-- Baldonccini 6da2fbb8 =18427 (declarada añeja 2024-12-15, pausada); SANCLAUDIO
-- 3131981f =20143 (declarada 2026-10-17, pausada). Ninguno tiene legajo_rpac ni
-- matricula_rpac_fecha/_vencimiento en columna.
--
-- Por-admin (§6-C): el venc de la hija se toma SÓLO de una declarada RECIENTE
-- (fecha >= hoy-90) → SANCLAUDIO sí (2026-10-17), Baldonccini NO (2024 añeja → venc
-- NULL, su declarada queda pausada para no mostrar un card "vencida 2024" engañoso;
-- re-declara su fecha real luego), Avolio no tiene. Despausamos sólo las recientes.
-- Reconciliación: perfil_declarado_sync_venc explícito al final (no esperar al cron).
-- --------------------------------------------------------------------------

DO $$
DECLARE
  v_ids uuid[] := ARRAY[
    '3131981f-0185-4490-9982-56d1393913ea',  -- SANCLAUDIO
    '6da2fbb8-146e-400c-aba2-df91a260400a',  -- Baldonccini
    '2cb1a3e3-a8f1-4770-8049-16b3dad20a9c'   -- Avolio
  ]::uuid[];
  v_id uuid;
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_venc date;
  v_nro text; v_fecha date;
  v_es_rpac boolean;
BEGIN
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT matricula_rpac, matricula_rpac_fecha INTO v_nro, v_fecha
    FROM public.administraciones WHERE id = v_id;
    IF v_nro IS NULL THEN CONTINUE; END IF;  -- ya migrado (idempotencia)

    -- venc de la hija: sólo de una declarada RECIENTE (>= hoy-90); si no, NULL.
    SELECT max(fecha_vencimiento) INTO v_venc
    FROM public.vencimientos
    WHERE administracion_id = v_id AND tipo = 'renovacion_matricula_declarada'
      AND fecha_vencimiento >= v_hoy - 90;

    -- 1) alta en la hija (CABA). matricula_fecha de la columna si la hubiera.
    INSERT INTO public.matricula_extra
      (administracion_id, jurisdiccion, matricula_nro, matricula_fecha, matricula_vencimiento, certeza, origen, notas)
    VALUES (v_id, 'caba', v_nro, v_fecha, v_venc, 'declarado', 'backfill:cutover-dgg234',
            'Cutover DGG-234 F7: matrícula CABA movida desde administraciones.matricula_rpac')
    ON CONFLICT (administracion_id, jurisdiccion) DO NOTHING;

    -- 2) vaciar la columna legacy → es_rpac se vuelve false para este admin.
    UPDATE public.administraciones
       SET matricula_rpac = NULL, matricula_rpac_fecha = NULL, matricula_rpac_vencimiento = NULL,
           matricula_rpac_vencimiento_origen = NULL, matricula_rpac_vencimiento_certeza = NULL,
           updated_at = now()
     WHERE id = v_id;

    -- 3) jurisdicción declarada en perfil_regulatorio = 'rpa' (fallback de calc; coherente).
    UPDATE public.perfil_regulatorio SET jurisdiccion = 'rpa'
     WHERE administracion_id = v_id;

    -- 4) despausar SÓLO las declaradas recientes (las añejas quedan pausadas, sin card engañoso).
    UPDATE public.vencimientos
       SET pausado_at = NULL
     WHERE administracion_id = v_id AND tipo = 'renovacion_matricula_declarada'
       AND pausado_at IS NOT NULL AND fecha_vencimiento >= v_hoy - 90;

    -- 5) reconciliar/materializar la declarada con la jurisdicción correcta (caba).
    PERFORM private.perfil_declarado_sync_venc(v_id);

    -- 6) anti-card-engañoso (§6-C/Baldonccini): re-pausar cualquier declarada AÑEJA
    -- (fecha < hoy-90) que el materializador pudiera haber (re)activado por inferencia
    -- de un dato viejo — así no se muestra un "vencida 20XX" engañoso. Las recientes
    -- (SANCLAUDIO 2026-10-17) quedan activas. El cliente re-declara su fecha real luego.
    UPDATE public.vencimientos
       SET pausado_at = now()
     WHERE administracion_id = v_id AND tipo = 'renovacion_matricula_declarada'
       AND estado IN ('vigente','vencido') AND pausado_at IS NULL
       AND fecha_vencimiento < v_hoy - 90;
  END LOOP;

  -- 7) VERIFICAR es_rpac=false para los 3 ANTES de revertir la contención (§6-C).
  SELECT bool_or(private.gg_admin_es_rpac(id)) INTO v_es_rpac
  FROM public.administraciones WHERE id = ANY(v_ids);
  IF v_es_rpac THEN
    RAISE EXCEPTION 'Cutover abortado: algún CABA sigue es_rpac=true (no se revierte la contención)';
  END IF;

  -- 8) revertir la contención: el motor ahora los clasifica CABA (es_rpac=false) → seguro.
  UPDATE public.administraciones SET ofrecimientos_habilitados = true, updated_at = now()
   WHERE id = ANY(v_ids);
END $$;
