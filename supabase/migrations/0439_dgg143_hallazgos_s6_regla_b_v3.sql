-- 0439_dgg143_hallazgos_s6_regla_b_v3.sql
-- DGG-143 · Hallazgos de la doble auditoría §6 sobre la Regla B v3 (mig 0438):
--
-- (1) v4 del trigger: la rama de RELLENO (campo vacío) también se gatea con
--     cierre_satisfactorio IS DISTINCT FROM false. Antes, un cierre por
--     RECHAZO del RPAC con campo vacío asentaba vencimiento = cierre+12m de
--     una matrícula que nunca se otorgó — contradecía el verbatim de Pablo
--     ("los rechazos no tocan nada") y el propio header de 0438. El mandato
--     "el campo no debe quedar nunca vacío" aplica a cierres que prosperaron;
--     en un rechazo, vacío es la verdad (no hay vigencia).
-- (2) v4 del trigger: WARNING forense con tramite/administracion (antes solo
--     SQLERRM — ilegible en logs días después, clase E-GG-42).
-- (3) tracking_cerrar_ciclo: la fecha que el gerente programa en el modal
--     "Programar próximo vencimiento" ahora TAMBIÉN se escribe en
--     administraciones.matricula_rpac_vencimiento cuando el trámite es de un
--     servicio de matrícula RPAC. Antes el modal solo creaba el row en
--     `vencimientos` y la ficha/portal quedaban con el default +12m del
--     trigger → dos "vencimientos de matrícula" divergentes. Doctrina: la
--     fecha explícita del gerente MANDA sobre el default del automatismo
--     (mismo principio "la ingresó a mano y es válida" de la v3). Firma
--     intacta → CREATE OR REPLACE seguro (R16 no aplica: 0 cambio de aridad).

CREATE OR REPLACE FUNCTION public.trg_tramite_cierre_setea_vencimiento_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_hoy_ar date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_nueva date := ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
                    + INTERVAL '12 months')::date;
  v_codigo text;
BEGIN
  IF NEW.estado = 'cerrado' AND OLD.estado IS DISTINCT FROM 'cerrado'
     AND NEW.administracion_id IS NOT NULL
     -- Rechazo del RPAC (excepcionalidad, verbatim Pablo 2026-08-21): no
     -- tocar NADA — ni pisar ni rellenar. NULL (cierre pelado del kanban)
     -- se trata como satisfactorio (doctrina 0355).
     AND NEW.cierre_satisfactorio IS DISTINCT FROM false THEN

    SELECT s.codigo INTO v_codigo FROM public.servicios s WHERE s.id = NEW.servicio_id;

    IF v_codigo IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion') THEN
      -- (1) Campo vacío → rellenar (regla original, los 3 servicios).
      UPDATE public.administraciones
         SET matricula_rpac_vencimiento = v_nueva, updated_at = now()
       WHERE id = NEW.administracion_id
         AND matricula_rpac_vencimiento IS NULL;

      -- (2) RENOVACIÓN que prosperó + fecha existente del mismo año (o
      --     anterior) al del cierre → es la fecha de la renovación previa:
      --     se pisa. Año siguiente → la cargó el gerente a mano: se conserva.
      IF v_codigo = 'rpac_renovacion' THEN
        UPDATE public.administraciones
           SET matricula_rpac_vencimiento = v_nueva, updated_at = now()
         WHERE id = NEW.administracion_id
           AND matricula_rpac_vencimiento IS NOT NULL
           AND EXTRACT(YEAR FROM matricula_rpac_vencimiento)
               <= EXTRACT(YEAR FROM v_hoy_ar);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_tramite_cierre_setea_vencimiento fallo tramite=% admin=%: %',
    NEW.id, NEW.administracion_id, SQLERRM;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- (3) tracking_cerrar_ciclo: sync fecha del gerente → ficha (servicios RPAC).
--     Cuerpo idéntico a 0040 salvo el bloque marcado "DGG-143 §6".
-- ----------------------------------------------------------------------------
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
  -- Defaults sanos
  v_offsets := COALESCE(p_alarmas_offsets, ARRAY[30,7,2]::int[]);

  SELECT t.*
    INTO v_tramite
    FROM public.tramites t
   WHERE t.id = p_tracking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tracking no encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Tenancy guard (regla 12). Si el tracking no tiene administracion_id
  -- asociada, solo staff lo puede cerrar.
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

  -- Sujeto: si el tracking tiene consorcio_id, lo usamos; si no, la
  -- administración como sujeto del vencimiento (administrador del consorcio).
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

  -- Marcar ciclo cerrado en el tracking
  UPDATE public.tramites
     SET cycle_closed_at = now(),
         ultima_actividad_at = now()
   WHERE id = p_tracking_id;

  -- Crear el vencimiento
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

  -- DGG-143 §6: si el trámite es de un servicio de matrícula RPAC, la fecha
  -- explícita del gerente pisa el default del trigger en la ficha. El campo
  -- canónico y la agenda dejan de divergir.
  SELECT s.codigo INTO v_serv_codigo
    FROM public.servicios s WHERE s.id = v_tramite.servicio_id;
  IF v_serv_codigo IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion') THEN
    UPDATE public.administraciones
       SET matricula_rpac_vencimiento = p_proxima_fecha, updated_at = now()
     WHERE id = v_tramite.administracion_id;
  END IF;

  -- Calcular fechas de alarmas (p_proxima_fecha - offset) para feedback al UI.
  FOREACH v_offset IN ARRAY v_offsets LOOP
    v_alarmas := array_append(v_alarmas, (p_proxima_fecha - v_offset)::date);
  END LOOP;

  RETURN QUERY SELECT v_new_id, v_alarmas;
END;
$$;

-- GRANTs: firma intacta → los REVOKE/GRANT de 0040 persisten con
-- CREATE OR REPLACE. Se reafirman por claridad (idempotente).
REVOKE EXECUTE ON FUNCTION public.tracking_cerrar_ciclo(uuid, date, integer[], boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_cerrar_ciclo(uuid, date, integer[], boolean)
  TO authenticated;

-- ----------------------------------------------------------------------------
-- Diferidos documentados del §6 (notas, no fixes de este chunk):
--  · Renovación ANTICIPADA con vencimiento en el 1er trimestre del año
--    siguiente cerrada en nov-dic → la heurística por año la conserva (queda
--    corta ~11 meses). Alternativa por magnitud (< cierre+6m) reportada a
--    Pablo; no se desvía del verbatim sin OK.
--  · cierre_satisfactorio=false está sobrecargado (rechazo RPAC vs "cerrar
--    sin cobrar" E-GG-139): un impago que sí prosperó no pisa. Etapa 3
--    (rework de las 7 vías de cierre) lo desambigua.
--  · Reabrir no restaura una fecha pisada (recuperable a mano vía
--    auditoria_cambios). Rows viejos en `vencimientos` tipo matricula_rpac
--    no se marcan cumplidos al renovar (preexistente; lo absorbe el motor
--    de ofrecimientos de Etapa 4).
-- ----------------------------------------------------------------------------
