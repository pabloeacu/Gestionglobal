-- 0616_dgg234_f6_otorgamiento_guard_jurisdiccion.sql
-- DGG-234 · F6 — Guard de jurisdicción en tracking_cargar_otorgamiento (E-GG-236).
-- --------------------------------------------------------------------------
-- tracking_cargar_otorgamiento asienta la matrícula otorgada en las columnas
-- administraciones.matricula_rpac* (concepto RPAC/PBA: "el Registro te otorgó la
-- matrícula"). Lo dispara el gestor al resolver un trámite de categoría
-- 'matricula'/'renovacion'. NO consultaba la jurisdicción: si un cliente de CABA
-- (matrícula en matricula_extra, declarada) llegara a tener un trámite de esa
-- categoría, el otorgamiento le escribiría matricula_rpac y lo RECLASIFICARÍA como
-- PBA — reabriendo E-GG-236 (avisos/ofrecimientos RPAC cruzados).
--
-- Hoy es un hueco DORMIDO (los CABA usan rpa_actualizacion, categoría curso, no
-- matricula/renovacion) pero real. Guard mínimo y preciso: rechazar el otorgamiento
-- cuando el cliente es PURAMENTE no-PBA (tiene fila en matricula_extra y NO tiene
-- matricula_rpac). Así protege a los CABA/Neuquén reales sin tocar a los PBA (sin
-- matricula_extra) ni a un eventual dual (que ya tendría matricula_rpac).
--
-- Firma intacta → CREATE OR REPLACE (sin overload, R16 OK). SECURITY DEFINER
-- preservado. Smoke e2e R18 incluido abajo (BEGIN/.../ROLLBACK forzado).
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tracking_cargar_otorgamiento(
  p_tramite_id uuid,
  p_matricula text DEFAULT NULL::text,
  p_legajo text DEFAULT NULL::text,
  p_fecha_emision date DEFAULT NULL::date,
  p_fecha_vencimiento date DEFAULT NULL::date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_tramite record; v_admin uuid; v_ot jsonb;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo el equipo de gestión puede cargar el otorgamiento.' USING ERRCODE = '42501';
  END IF;
  SELECT t.* INTO v_tramite FROM public.tramites t WHERE t.id = p_tramite_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trámite no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_tramite.categoria NOT IN ('matricula', 'renovacion') THEN
    RAISE EXCEPTION 'El otorgamiento sólo aplica a trámites de matriculación o renovación (categoría: %).', v_tramite.categoria USING ERRCODE = '22023';
  END IF;
  v_admin := v_tramite.administracion_id;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'El trámite no tiene un cliente (administración) vinculado; no hay dónde asentar la matrícula.' USING ERRCODE = '22023';
  END IF;

  -- DGG-234 F6 (E-GG-236): guard de jurisdicción. Un cliente puramente no-PBA
  -- (matrícula en matricula_extra, sin matricula_rpac) NO debe recibir un
  -- otorgamiento RPAC — lo reclasificaría a PBA. Su matrícula se gestiona declarada.
  IF (SELECT a.matricula_rpac FROM public.administraciones a WHERE a.id = v_admin) IS NULL
     AND EXISTS (SELECT 1 FROM public.matricula_extra me WHERE me.administracion_id = v_admin) THEN
    RAISE EXCEPTION 'Este cliente tiene matrícula en otra jurisdicción (CABA/Neuquén), que se gestiona como dato declarado y no por otorgamiento RPAC. Cargá o corregí su matrícula desde la ficha del cliente.' USING ERRCODE = '22023';
  END IF;

  IF p_fecha_vencimiento IS NULL THEN
    RAISE EXCEPTION 'La fecha de vencimiento de la matrícula es obligatoria.' USING ERRCODE = '22023';
  END IF;
  v_ot := private.gg_sanitizar_otorgamiento(jsonb_build_object(
    'matricula', p_matricula,
    'legajo', p_legajo,
    'fecha_emision', p_fecha_emision,
    'fecha_vencimiento', p_fecha_vencimiento
  ));
  IF v_ot IS NULL THEN
    RAISE EXCEPTION 'No se cargó ningún dato del otorgamiento.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.administraciones a
     SET matricula_rpac = COALESCE(v_ot->>'matricula', a.matricula_rpac),
         legajo_rpac = COALESCE(v_ot->>'legajo', a.legajo_rpac),
         matricula_rpac_fecha = COALESCE((v_ot->>'fecha_emision')::date, a.matricula_rpac_fecha),
         matricula_rpac_vencimiento = COALESCE((v_ot->>'fecha_vencimiento')::date, a.matricula_rpac_vencimiento),
         updated_at = now()
   WHERE a.id = v_admin;
  UPDATE public.tramites SET ultima_actividad_at = now() WHERE id = p_tramite_id;
  RETURN (SELECT jsonb_build_object(
    'administracion_id', a.id,
    'matricula_rpac', a.matricula_rpac,
    'legajo_rpac', a.legajo_rpac,
    'matricula_rpac_fecha', a.matricula_rpac_fecha,
    'matricula_rpac_vencimiento', a.matricula_rpac_vencimiento
  ) FROM public.administraciones a WHERE a.id = v_admin);
END;
$function$;
