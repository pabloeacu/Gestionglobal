-- 0441_dgg142e3_hallazgos_s6_cerrar_ciclo_y_moderacion.sql
-- DGG-142 E3 · Hallazgos de la doble auditoría §6 (3 agentes + refutación):
--
-- (1) `tracking_cerrar_ciclo` v3:
--     a. IDEMPOTENCIA (GAP 2 refutación): cada llamada insertaba un vencimiento
--        nuevo sin cerrar el vigente anterior del mismo tracking → programar
--        dos veces (kanban y luego detail) dejaba 2 rows 'vigente' y el
--        dispatch mandaba avisos DUPLICADOS al cliente por cada tríada.
--        Ahora, antes del INSERT: los vigentes previos del tracking pasan a
--        'renovado' (supersede — manda la última programación del humano).
--     b. GATE DE RECHAZO en el sync RPAC (GAP 4 refutación): el sync de
--        mig 0439 escribía `matricula_rpac_vencimiento` aunque el cierre fuera
--        NO satisfactorio (rechazo del RPAC) — contradecía el propio gate del
--        trigger (0439) y el verbatim de Pablo ("los rechazos no tocan nada").
--        El gerente que programa un recordatorio sobre un rechazo agenda la
--        alarma, pero la ficha NO asienta vigencia de una matrícula que nunca
--        se otorgó. Espejo exacto del trigger:
--        `cierre_satisfactorio IS DISTINCT FROM false`.
--     Firma intacta → CREATE OR REPLACE (sin riesgo R16).
--
-- (2) `tracking_moderacion_pendientes` +2 columnas (administracion_id,
--     servicio_vigencia_meses): la vía V7 (publicar con "Pasar a: Cerrado")
--     ofrecía el modal sin saber si el trámite tiene administración (error
--     22023 recién al submit) y sin fecha sugerida por vigencia. Cambia el
--     RETURNS TABLE → DROP + CREATE + re-GRANT (regla 16).

CREATE OR REPLACE FUNCTION public.tracking_cerrar_ciclo(
  p_tracking_id uuid,
  p_proxima_fecha date,
  p_alarmas_offsets integer[],
  p_notificar_cliente boolean DEFAULT true
)
RETURNS TABLE (vencimiento_id uuid, alarmas_planificadas date[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tramite record;
  v_new_id  uuid;
  v_sujeto  text;
  v_sujeto_id uuid;
  v_offset int;
  v_alarmas date[] := '{}';
  v_offsets int[];
  v_serv_codigo text;
BEGIN
  v_offsets := COALESCE(p_alarmas_offsets, ARRAY[30,7,2]::int[]);

  SELECT t.*
    INTO v_tramite
    FROM public.tramites t
   WHERE t.id = p_tracking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tracking no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT private.is_staff() THEN
    IF v_tramite.administracion_id IS NULL THEN
      RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
    PERFORM private.assert_administracion_access(v_tramite.administracion_id);
  END IF;

  IF p_proxima_fecha IS NULL OR p_proxima_fecha <= CURRENT_DATE THEN
    RAISE EXCEPTION 'La próxima fecha debe ser futura'
      USING ERRCODE = '22023';
  END IF;

  IF v_tramite.consorcio_id IS NOT NULL THEN
    v_sujeto := 'consorcio';
    v_sujeto_id := v_tramite.consorcio_id;
  ELSE
    v_sujeto := 'administracion';
    v_sujeto_id := COALESCE(v_tramite.administracion_id, p_tracking_id);
  END IF;

  IF v_tramite.administracion_id IS NULL THEN
    RAISE EXCEPTION 'El tracking no tiene administración asociada'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.tramites
     SET cycle_closed_at = now(),
         ultima_actividad_at = now()
   WHERE id = p_tracking_id;

  -- §6 E3 (1a) · SUPERSEDE: una re-programación reemplaza a la anterior.
  -- Los vigentes previos del mismo tracking pasan a 'renovado' para que el
  -- dispatch no duplique avisos y el panel del detail apunte al nuevo.
  UPDATE public.vencimientos
     SET estado = 'renovado'
   WHERE tracking_id = p_tracking_id
     AND estado = 'vigente';

  INSERT INTO public.vencimientos (
    tipo, sujeto, sujeto_id,
    administracion_id, consorcio_id,
    fecha_vencimiento, fecha_emision,
    descripcion,
    estado,
    alarmas_offsets, notificar_cliente,
    tracking_id,
    origen
  ) VALUES (
    'otro', v_sujeto, v_sujeto_id,
    v_tramite.administracion_id, v_tramite.consorcio_id,
    p_proxima_fecha, CURRENT_DATE,
    COALESCE('Próximo vencimiento generado por tracking «' || v_tramite.titulo || '»', 'Próximo vencimiento'),
    'vigente',
    v_offsets, COALESCE(p_notificar_cliente, true),
    p_tracking_id,
    'tracking'
  )
  RETURNING id INTO v_new_id;

  -- DGG-143 §6 (0439) + §6 E3 (1b) · la fecha explícita del gerente pisa el
  -- default del trigger en la ficha, SALVO cierre no satisfactorio (rechazo
  -- del RPAC): la alarma se agenda igual, pero la ficha no asienta vigencia
  -- de una matrícula que no se otorgó (espejo del gate del trigger, 0439).
  SELECT s.codigo INTO v_serv_codigo
    FROM public.servicios s WHERE s.id = v_tramite.servicio_id;
  IF v_serv_codigo IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion')
     AND v_tramite.cierre_satisfactorio IS DISTINCT FROM false THEN
    UPDATE public.administraciones
       SET matricula_rpac_vencimiento = p_proxima_fecha, updated_at = now()
     WHERE id = v_tramite.administracion_id;
  END IF;

  FOREACH v_offset IN ARRAY v_offsets LOOP
    v_alarmas := array_append(v_alarmas, (p_proxima_fecha - v_offset)::date);
  END LOOP;

  RETURN QUERY SELECT v_new_id, v_alarmas;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tracking_cerrar_ciclo(uuid, date, integer[], boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_cerrar_ciclo(uuid, date, integer[], boolean)
  TO authenticated;

-- ----------------------------------------------------------------------------
-- (2) tracking_moderacion_pendientes: +administracion_id +servicio_vigencia_meses
--     (cambia el RETURNS TABLE → DROP + CREATE + re-GRANT, regla 16)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.tracking_moderacion_pendientes();

CREATE FUNCTION public.tracking_moderacion_pendientes()
RETURNS TABLE(
  linea_id uuid, tramite_id uuid, tramite_codigo text, servicio_nombre text,
  cliente_nombre text, gestor_label text, descripcion text,
  archivos_urls text[], created_at timestamptz,
  administracion_id uuid, servicio_vigencia_meses integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT tl.id, t.id, t.codigo, COALESCE(s.nombre, t.titulo, 'Trámite'),
         COALESCE(a.nombre, t.solicitante_nombre), tl.gestor_label, tl.descripcion, tl.archivos_urls, tl.created_at,
         t.administracion_id, s.vigencia_meses
  FROM public.tracking_lineas tl
  JOIN public.tramites t ON t.id = tl.tramite_id
  LEFT JOIN public.servicios s ON s.id = t.servicio_id
  LEFT JOIN public.administraciones a ON a.id = t.administracion_id
  WHERE tl.categoria = 'gestor_avance' AND tl.moderacion_estado = 'pendiente' AND private.is_staff()
  ORDER BY tl.created_at ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.tracking_moderacion_pendientes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_moderacion_pendientes() TO authenticated;

-- ----------------------------------------------------------------------------
-- SMOKES (MCP, DO $$ ... ROLLBACK):
--   C1 doble programación → 1 solo vigente (el previo pasa a 'renovado')
--   C2 cierre no satisfactorio + programar → agenda SÍ, ficha NO
--   C3 cierre satisfactorio + programar → ficha = fecha del gerente (0439 OK)
--   M1 moderación devuelve administracion_id + vigencia
--   R16: 0 funciones duplicadas
-- ----------------------------------------------------------------------------
