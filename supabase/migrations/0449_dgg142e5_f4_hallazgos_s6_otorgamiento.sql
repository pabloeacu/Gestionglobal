-- ============================================================================
-- 0449 · DGG-142 E5 F4 — fix-pack de la doble auditoría §6 del otorgamiento
--        de gestoría (3 agentes + refutación adversarial sobre mig 0448).
--
-- Hallazgos que corrige (informes A/B/C, 2026-08-22):
--  (1) C#1 MEDIA · tl_admin_insert permitía a un cliente autenticado forjar
--      líneas categoria='gestor_avance' con moderacion_estado='pendiente',
--      gestor_label arbitrario (impersonación del estudio) y otorgamiento SIN
--      sanitizar, que entraban a la cola de Moderación disfrazadas de aporte
--      de gestoría con "Asentar en la ficha" pre-tildado. La ficha seguía
--      gateada por gerencia (sin camino directo), pero es spoofing de
--      procedencia. El front nunca inserta directo (todo va por RPC), así que
--      endurecer no rompe ningún flujo vivo.
--  (2) B GAP-1 MEDIA + C#4 · gg_sanitizar_otorgamiento aceptaba literales
--      especiales de fecha de Postgres ('infinity', fechas BC, año 3000,
--      'tomorrow') — verificado en vivo. Un payload anónimo crafteado podía
--      dejar 'infinity' en propuesto; el <input type=date> lo renderiza VACÍO
--      pero el estado React lo retiene y gerencia lo publicaría sin verlo →
--      ficha + vencimientos con infinity (alarma eterna, formatDateShort roto).
--      Fix: isfinite + rango [1900-01-01, 2200-12-31]. De paso IMMUTABLE →
--      STABLE (A#20: text::date depende de DateStyle; hoy inocuo, correcto ya).
--  (3) C#3 MENOR · sin FOR UPDATE en la moderación: doble click ultrarrápido
--      o dos gerentes concurrentes publicaban dos veces → doble email/push al
--      cliente (la ficha quedaba bien: idempotente). Fix: FOR UPDATE.
--  (4) C#2 MEDIA-LATENTE · gate de servicio asimétrico: la captura
--      (gestor_cargar_avance) resuelve COALESCE(solicitud.servicio_solicitado,
--      tramite.servicio) y la moderación miraba SOLO tramite.servicio. Si
--      divergen, una propuesta aceptada no se podía aplicar (22023 confuso).
--      Fix: la moderación acepta si CUALQUIERA de los dos lados es RPAC
--      (unión ⊇ lo que aceptó la captura; y habilita el caso inverso legítimo
--      de trámite RPAC con solicitud divergente).
--
-- R16: las dos funciones conservan firma → CREATE OR REPLACE (0 overloads,
--      smoke al pie). R18: smoke e2e post-apply vía execute_sql (DO $$ …
--      RAISE EXCEPTION 'E2E_OK_ROLLBACK'), no acá adentro para no abortar la
--      migración.
-- ============================================================================

-- (1) tl_admin_insert endurecida: el cliente jamás inserta líneas de gestoría
DROP POLICY IF EXISTS tl_admin_insert ON public.tracking_lineas;
CREATE POLICY tl_admin_insert ON public.tracking_lineas
  FOR INSERT TO authenticated
  WITH CHECK (
    autor_id = auth.uid()
    AND estado_asociado IS NULL      -- el admin no mueve estados, sólo agrega notas
    AND categoria <> 'gestor_avance' -- E5 §6 C#1: la categoría de gestoría sólo
    AND moderacion_estado IS NULL    -- nace por gestor_cargar_avance (SD) o staff;
    AND gestor_label IS NULL         -- impide forjar aportes "de la gestoría"
    AND otorgamiento IS NULL         -- y colar otorgamientos sin sanitizar
    AND EXISTS (
      SELECT 1 FROM public.tramites t
       WHERE t.id = tracking_lineas.tramite_id
         AND t.administracion_id IS NOT NULL
         AND t.administracion_id = private.current_administracion_id()
    )
  );

-- (2) Sanitizador v2: fechas finitas y plausibles + STABLE ------------------
CREATE OR REPLACE FUNCTION private.gg_sanitizar_otorgamiento(p_in jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_mat text; v_leg text; v_fe date; v_fv date; v_out jsonb := '{}'::jsonb;
BEGIN
  IF p_in IS NULL OR jsonb_typeof(p_in) <> 'object' THEN RETURN NULL; END IF;

  v_mat := NULLIF(trim(COALESCE(p_in->>'matricula', '')), '');
  v_leg := NULLIF(trim(COALESCE(p_in->>'legajo', '')), '');
  IF length(COALESCE(v_mat, '')) > 40 OR length(COALESCE(v_leg, '')) > 40 THEN
    RAISE EXCEPTION 'Matrícula/legajo demasiado largos (máx 40)' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_fe := NULLIF(trim(COALESCE(p_in->>'fecha_emision', '')), '')::date;
    v_fv := NULLIF(trim(COALESCE(p_in->>'fecha_vencimiento', '')), '')::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Fecha inválida en el otorgamiento (formato AAAA-MM-DD)' USING ERRCODE = '22023';
  END;
  -- §6 B GAP-1/C#4: ::date acepta 'infinity', fechas BC y 'tomorrow'. Un
  -- infinity asentado en la ficha arma una alarma eterna y rompe el render.
  IF (v_fe IS NOT NULL AND (NOT isfinite(v_fe) OR v_fe NOT BETWEEN DATE '1900-01-01' AND DATE '2200-12-31'))
     OR (v_fv IS NOT NULL AND (NOT isfinite(v_fv) OR v_fv NOT BETWEEN DATE '1900-01-01' AND DATE '2200-12-31')) THEN
    RAISE EXCEPTION 'Fecha fuera del rango razonable (1900–2200)' USING ERRCODE = '22023';
  END IF;
  IF v_fe IS NOT NULL AND v_fv IS NOT NULL AND v_fv < v_fe THEN
    RAISE EXCEPTION 'La fecha de vencimiento no puede ser anterior a la de emisión' USING ERRCODE = '22023';
  END IF;

  IF v_mat IS NOT NULL THEN v_out := v_out || jsonb_build_object('matricula', v_mat); END IF;
  IF v_leg IS NOT NULL THEN v_out := v_out || jsonb_build_object('legajo', v_leg); END IF;
  IF v_fe IS NOT NULL THEN v_out := v_out || jsonb_build_object('fecha_emision', v_fe); END IF;
  IF v_fv IS NOT NULL THEN v_out := v_out || jsonb_build_object('fecha_vencimiento', v_fv); END IF;

  IF v_out = '{}'::jsonb THEN RETURN NULL; END IF;
  RETURN v_out;
END;
$$;

-- (3)+(4) Moderación v3: FOR UPDATE + gate RPAC por unión solicitud/trámite --
CREATE OR REPLACE FUNCTION public.tracking_moderar_gestor_avance(
  p_linea_id uuid, p_accion text,
  p_descripcion text DEFAULT NULL,
  p_archivos_urls text[] DEFAULT NULL,
  p_estado_asociado text DEFAULT NULL,
  p_motivo text DEFAULT NULL,
  p_otorgamiento jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_linea public.tracking_lineas%ROWTYPE;
  v_ap jsonb;
  v_serv_tramite text;
  v_serv_solicitud text;
  v_admin_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Sólo gerencia puede moderar' USING ERRCODE = '42501';
  END IF;

  -- §6 C#3: FOR UPDATE — dos moderaciones concurrentes de la misma línea
  -- serializan acá; la segunda ve moderacion_estado <> 'pendiente' y aborta
  -- (antes: doble publicación = doble email/push al cliente).
  SELECT * INTO v_linea FROM public.tracking_lineas WHERE id = p_linea_id FOR UPDATE;
  IF v_linea.id IS NULL THEN
    RAISE EXCEPTION 'Línea no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_linea.categoria <> 'gestor_avance' OR v_linea.moderacion_estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La línea no está pendiente de moderación' USING ERRCODE = '22023';
  END IF;

  IF p_estado_asociado IS NOT NULL
     AND p_estado_asociado NOT IN ('abierto','en_progreso','esperando_cliente','resuelto','cerrado','cancelado') THEN
    RAISE EXCEPTION 'Estado asociado inválido: %', p_estado_asociado USING ERRCODE = '22023';
  END IF;
  IF p_descripcion IS NOT NULL AND trim(p_descripcion) = '' THEN
    RAISE EXCEPTION 'La descripción no puede quedar vacía' USING ERRCODE = '22023';
  END IF;

  -- E5 · el otorgamiento SOLO se aplica al publicar (interno/descartar jamás
  -- tocan la ficha).
  v_ap := private.gg_sanitizar_otorgamiento(p_otorgamiento);
  IF v_ap IS NOT NULL AND p_accion <> 'publicar' THEN
    RAISE EXCEPTION 'El otorgamiento sólo puede aplicarse al publicar' USING ERRCODE = '22023';
  END IF;
  IF v_ap IS NOT NULL THEN
    -- §6 C#2: espejo del gate de captura. La captura acepta por
    -- COALESCE(solicitud.servicio_solicitado, tramite.servicio); acá se acepta
    -- si CUALQUIERA de los dos lados es RPAC (unión ⊇ captura), para que toda
    -- propuesta aceptada pueda aplicarse aunque solicitud y trámite diverjan.
    SELECT t.administracion_id, st.codigo, ss.codigo
      INTO v_admin_id, v_serv_tramite, v_serv_solicitud
      FROM public.tramites t
      LEFT JOIN public.servicios st ON st.id = t.servicio_id
      LEFT JOIN LATERAL (
        SELECT s2.codigo
          FROM public.solicitudes sol
          JOIN public.servicios s2 ON s2.id = sol.servicio_solicitado_id
         WHERE sol.tramite_id = t.id
         ORDER BY sol.created_at DESC
         LIMIT 1
      ) ss ON true
     WHERE t.id = v_linea.tramite_id;
    IF v_admin_id IS NULL THEN
      RAISE EXCEPTION 'El trámite no tiene administración asociada' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(v_serv_tramite, '') NOT IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion')
       AND COALESCE(v_serv_solicitud, '') NOT IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion') THEN
      RAISE EXCEPTION 'El otorgamiento sólo aplica a trámites de matrícula RPAC' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_descripcion IS NOT NULL THEN
    UPDATE public.tracking_lineas SET descripcion = trim(p_descripcion) WHERE id = p_linea_id;
  END IF;
  IF p_archivos_urls IS NOT NULL THEN
    UPDATE public.tracking_lineas SET archivos_urls = p_archivos_urls WHERE id = p_linea_id;
  END IF;

  IF p_accion = 'publicar' THEN
    UPDATE public.tracking_lineas
       SET visible_cliente = true, moderacion_estado = 'publicado',
           estado_asociado = COALESCE(p_estado_asociado, estado_asociado),
           moderada_at = now(), moderada_por = auth.uid()
     WHERE id = p_linea_id;
    IF p_estado_asociado = 'cancelado' THEN
      -- DGG-95 backstop: cancelar cascadea (anula comprobante no-fiscal → saldo a favor).
      PERFORM public.tramite_cancelar(v_linea.tramite_id, true, 'Cancelado desde moderación');
    ELSIF p_estado_asociado IS NOT NULL THEN
      UPDATE public.tramites SET estado = p_estado_asociado, ultima_actividad_at = now()
       WHERE id = v_linea.tramite_id;
    END IF;

    -- E5 · aplicar el otorgamiento DESPUÉS del cambio de estado: si el cierre
    -- disparó la Regla B (0439), el valor explícito aprobado por gerencia
    -- PISA la heurística. Sólo se escriben las claves presentes. El UPDATE
    -- de matricula_rpac_vencimiento dispara el sync 0444 → alarma {45,30,15}
    -- automática. Diff old/new queda en auditoria_cambios (trigger existente).
    IF v_ap IS NOT NULL THEN
      UPDATE public.administraciones a
         SET matricula_rpac = COALESCE(v_ap->>'matricula', a.matricula_rpac),
             legajo_rpac = COALESCE(v_ap->>'legajo', a.legajo_rpac),
             matricula_rpac_fecha = COALESCE((v_ap->>'fecha_emision')::date, a.matricula_rpac_fecha),
             matricula_rpac_vencimiento = COALESCE((v_ap->>'fecha_vencimiento')::date, a.matricula_rpac_vencimiento),
             updated_at = now()
       WHERE a.id = v_admin_id;

      UPDATE public.tracking_lineas
         SET otorgamiento = COALESCE(otorgamiento, '{}'::jsonb)
               || jsonb_build_object('aplicado', v_ap, 'aplicado_at', now(), 'aplicado_por', auth.uid())
       WHERE id = p_linea_id;
    END IF;

    PERFORM private.tracking_notificar_avance_cliente(p_linea_id);

  ELSIF p_accion = 'interno' THEN
    UPDATE public.tracking_lineas
       SET visible_cliente = false, moderacion_estado = 'interno',
           moderada_at = now(), moderada_por = auth.uid()
     WHERE id = p_linea_id;

  ELSIF p_accion = 'descartar' THEN
    UPDATE public.tracking_lineas
       SET visible_cliente = false, moderacion_estado = 'descartado',
           descarte_motivo = NULLIF(trim(COALESCE(p_motivo, '')), ''),
           moderada_at = now(), moderada_por = auth.uid()
     WHERE id = p_linea_id;

  ELSE
    RAISE EXCEPTION 'Acción inválida: %', p_accion USING ERRCODE = '22023';
  END IF;
END;
$function$;

-- Grants sin cambio (firma idéntica, C-O-R los preserva) — se reafirman igual:
REVOKE EXECUTE ON FUNCTION public.tracking_moderar_gestor_avance(uuid, text, text, text[], text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_moderar_gestor_avance(uuid, text, text, text[], text, text, jsonb) TO authenticated;

-- ============================================================================
-- Smokes post-apply (correr vía execute_sql, no acá):
--  R16 · SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--        WHERE n.nspname IN ('public','private') GROUP BY proname HAVING count(*)>1
--        → 0 filas para las funciones tocadas.
--  S1  · sanitizador: '{"fecha_vencimiento":"infinity"}' → 22023;
--        '{"fecha_vencimiento":"3000-01-01"}' → 22023; '{"fecha_vencimiento":"0001-01-01 BC"}' → 22023.
--  S2  · policy: SET ROLE authenticated + claims de cliente → INSERT
--        categoria='gestor_avance' → 42501; INSERT nota normal → OK (rollback).
--  S3  · e2e completo del circuito (DO $$ … 'E2E_OK_ROLLBACK'): propuesta →
--        publicar+cerrado editado → ficha + UNA alarma renovacion_rpac.
-- ============================================================================
