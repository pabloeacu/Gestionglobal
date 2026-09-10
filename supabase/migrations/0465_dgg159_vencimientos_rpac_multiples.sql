-- ============================================================================
-- 0465 · DGG-159 — Vencimientos RPAC automáticos y tipados al otorgar matrícula
-- ----------------------------------------------------------------------------
-- Pablo: al cerrar una inscripción/renovación RPAC (otorgamiento), JL carga la
-- FECHA DE MATRICULACIÓN y el sistema debe programar automáticamente, con fechas
-- editables, tres vencimientos:
--   · Renovación de matrícula — anual (matriculación + 12 meses).
--   · DDJJ anual — vence en MARZO (fecha fija para todos), aviso desde 60 días.
--   · Curso de actualización — anual.
--
-- Modelo (sin cambio de schema; los tipos ya existen en el CHECK de vencimientos):
--   · RENOVACIÓN se materializa por la vía YA existente: al setear
--     administraciones.matricula_rpac_vencimiento, el trigger
--     trg_admin_matricula_venc_sync_fn crea/supersede la fila `renovacion_rpac`
--     con offsets {45,30,15}. Acá sólo la ligamos al tracking + notificar (idéntico
--     patrón a tracking_cerrar_ciclo) y, si el trigger no la creó, la insertamos.
--   · DDJJ y CURSO se insertan como filas tipadas (`ddjj_anual`, `curso_actualizacion`),
--     superseeding la vigente previa del mismo tipo (encadenado por estado).
--
-- Las FECHAS llegan ya calculadas/editadas desde la UI (default en el front:
-- renovación = base+12m, curso = base+12m, DDJJ = próximo 31-mar); la RPC sólo
-- valida que sean futuras y persiste. Gate is_staff (edición de gestión, no recibe
-- p_administracion_id del cliente → R12 no aplica). SECURITY DEFINER + search_path.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tracking_programar_vencimientos_rpac(
  p_tramite_id uuid,
  p_fecha_matriculacion date,
  p_fecha_renovacion date,
  p_fecha_ddjj date,
  p_fecha_curso date,
  p_notificar boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_tramite record;
  v_serv_codigo text;
  v_admin uuid;
  v_reno_id uuid;
  v_ddjj_id uuid;
  v_curso_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo el equipo de gestión puede programar los vencimientos.'
      USING ERRCODE = '42501';
  END IF;

  SELECT t.* INTO v_tramite FROM public.tramites t WHERE t.id = p_tramite_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trámite no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_tramite.administracion_id IS NULL THEN
    RAISE EXCEPTION 'El trámite no tiene administración asociada' USING ERRCODE = '22023';
  END IF;
  v_admin := v_tramite.administracion_id;

  SELECT s.codigo INTO v_serv_codigo FROM public.servicios s WHERE s.id = v_tramite.servicio_id;
  IF v_serv_codigo NOT IN ('rpac_inscripcion', 'rpac_inscripcion_juridica', 'rpac_renovacion') THEN
    RAISE EXCEPTION 'El programador de vencimientos RPAC es sólo para inscripción/renovación (servicio: %).', COALESCE(v_serv_codigo, '—')
      USING ERRCODE = '22023';
  END IF;

  IF p_fecha_matriculacion IS NULL THEN
    RAISE EXCEPTION 'Falta la fecha de matriculación.' USING ERRCODE = '22023';
  END IF;

  -- Las fechas de los vencimientos miran hacia adelante (las alarmas se calculan
  -- como fecha - offset y el cron sólo dispara futuros).
  IF p_fecha_renovacion IS NULL OR p_fecha_renovacion <= CURRENT_DATE THEN
    RAISE EXCEPTION 'La fecha de renovación debe ser futura.' USING ERRCODE = '22023';
  END IF;
  IF p_fecha_ddjj IS NULL OR p_fecha_ddjj <= CURRENT_DATE THEN
    RAISE EXCEPTION 'La fecha de la DDJJ debe ser futura.' USING ERRCODE = '22023';
  END IF;
  IF p_fecha_curso IS NULL OR p_fecha_curso <= CURRENT_DATE THEN
    RAISE EXCEPTION 'La fecha del curso de actualización debe ser futura.' USING ERRCODE = '22023';
  END IF;

  -- Marca de cierre de ciclo (consistente con tracking_cerrar_ciclo).
  UPDATE public.tramites
     SET cycle_closed_at = now(), ultima_actividad_at = now()
   WHERE id = p_tramite_id;

  -- (1) RENOVACIÓN — vía la ficha: setear fecha de matriculación + vencimiento.
  -- El trigger trg_admin_matricula_venc_sync_fn crea/supersede `renovacion_rpac` {45,30,15}.
  UPDATE public.administraciones
     SET matricula_rpac_fecha = p_fecha_matriculacion,
         matricula_rpac_vencimiento = p_fecha_renovacion,
         updated_at = now()
   WHERE id = v_admin;

  -- Ligar la fila renovacion_rpac vigente al tracking + notificar (como tracking_cerrar_ciclo).
  UPDATE public.vencimientos
     SET tracking_id = p_tramite_id,
         notificar_cliente = COALESCE(p_notificar, true)
   WHERE administracion_id = v_admin AND tipo = 'renovacion_rpac' AND estado = 'vigente'
     AND fecha_vencimiento = p_fecha_renovacion
  RETURNING id INTO v_reno_id;

  -- Fallback: si el trigger no la creó (swallowea excepciones), insertarla acá.
  IF v_reno_id IS NULL THEN
    INSERT INTO public.vencimientos
      (tipo, sujeto, sujeto_id, administracion_id, fecha_vencimiento, fecha_emision,
       descripcion, estado, alarmas_offsets, notificar_cliente, tracking_id, origen)
    VALUES ('renovacion_rpac', 'administracion', v_admin, v_admin, p_fecha_renovacion, CURRENT_DATE,
       'Vencimiento de matrícula RPAC', 'vigente', '{45,30,15}'::int[],
       COALESCE(p_notificar, true), p_tramite_id, 'gestion_global')
    RETURNING id INTO v_reno_id;
  END IF;

  -- (2) DDJJ anual (marzo; aviso desde 60 días antes — pedido Pablo).
  UPDATE public.vencimientos SET estado = 'renovado'
   WHERE administracion_id = v_admin AND tipo = 'ddjj_anual' AND estado = 'vigente';
  INSERT INTO public.vencimientos
    (tipo, sujeto, sujeto_id, administracion_id, fecha_vencimiento, fecha_emision,
     descripcion, estado, alarmas_offsets, notificar_cliente, tracking_id, origen)
  VALUES ('ddjj_anual', 'administracion', v_admin, v_admin, p_fecha_ddjj, CURRENT_DATE,
     'DDJJ anual RPAC (vence en marzo)', 'vigente', '{60,30,15}'::int[],
     COALESCE(p_notificar, true), p_tramite_id, 'gestion_global')
  RETURNING id INTO v_ddjj_id;

  -- (3) Curso de actualización (anual).
  UPDATE public.vencimientos SET estado = 'renovado'
   WHERE administracion_id = v_admin AND tipo = 'curso_actualizacion' AND estado = 'vigente';
  INSERT INTO public.vencimientos
    (tipo, sujeto, sujeto_id, administracion_id, fecha_vencimiento, fecha_emision,
     descripcion, estado, alarmas_offsets, notificar_cliente, tracking_id, origen)
  VALUES ('curso_actualizacion', 'administracion', v_admin, v_admin, p_fecha_curso, CURRENT_DATE,
     'Curso de actualización RPAC (anual)', 'vigente', '{45,30,15}'::int[],
     COALESCE(p_notificar, true), p_tramite_id, 'gestion_global')
  RETURNING id INTO v_curso_id;

  RETURN jsonb_build_object(
    'renovacion_id', v_reno_id,
    'ddjj_id', v_ddjj_id,
    'curso_id', v_curso_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.tracking_programar_vencimientos_rpac(uuid, date, date, date, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_programar_vencimientos_rpac(uuid, date, date, date, date, boolean) TO authenticated;
