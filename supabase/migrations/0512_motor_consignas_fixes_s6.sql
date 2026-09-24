-- 0512 · Agenda · §6 de las migs 0510/0511 (DGG-200). Fixes de la doble auditoría (3 agentes).
--
-- Hallazgos corregidos (todos latentes; motor real DORMIDO, 0 comms):
--  · A#1/A#2 (C2 fidelidad): curso/renovación gateaban por NÚMERO conocido, pero C2 dice "ofrecer
--    cuando se conoce el VENCIMIENTO". Se gatean ahora por prox_venc (vencimiento conocido), no por
--    número. Cert/DDJJ SIGUEN por número (eso es C1). matriculación suma `prox_venc IS NULL` para no
--    ofrecerse a quien declaró una fecha (está matriculado aunque no cargó el número).
--  · A#4 (renovación inminente): con venc ≤15d, el curso-primero + gracia 7d podía saltear la
--    renovación urgente. Ahora el curso sólo dispara con venc > 15d; el inminente va directo a renovación.
--  · C-H1 (vencido oculto): prox_venc rodaba un vencimiento YA VENCIDO al año siguiente → un matriculado
--    lapsado quedaba invisible para renovación. Ahora la ventana incluye hasta 60d de atraso (overdue),
--    y renovación cubre [hoy-60, hoy+45]. Un lapsado reciente recibe renovación (el caso más urgente).
--  · C-H2 (timezone): prox_venc usaba CURRENT_DATE (UTC); ahora usa la fecha AR (igual que el motor).
--  · C-H5 (fin de mes): el aniversario usa el ÚLTIMO día real del mes (no el cap fijo 28).
--  · B#1 (R6): REVOKE EXECUTE FROM PUBLIC en los helpers `private` (igualar a gg_ofrecimiento_elegible).
-- Sin cambios de firma → sin overloads (R16). Cert/DDJJ (C1), consultoría (C4), plataforma (C5) intactos.

-- ── helper prox_venc: fecha AR + ventana overdue 60d + fin de mes real (misma firma, sin overload) ──
CREATE OR REPLACE FUNCTION private.gg_admin_prox_venc_matricula(p_admin uuid)
 RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
  WITH src AS (
    SELECT
      (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS hoy,
      (SELECT a.matricula_rpac_vencimiento FROM public.administraciones a WHERE a.id=p_admin) AS venc_ficha,
      (SELECT min(v.fecha_vencimiento) FROM public.vencimientos v
        WHERE v.administracion_id=p_admin AND v.tipo='renovacion_rpac' AND v.estado='vigente'
          AND v.fecha_vencimiento >= ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - 60)) AS venc_row,
      COALESCE(
        (SELECT a.matricula_rpac_fecha FROM public.administraciones a WHERE a.id=p_admin),
        (SELECT pr.matricula_fecha_declarada FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin),
        (SELECT pr.ultima_renovacion_declarada FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin)
      ) AS emision
  )
  SELECT CASE
    WHEN src.venc_ficha IS NOT NULL AND src.venc_ficha >= src.hoy - 60 THEN src.venc_ficha
    WHEN src.venc_row IS NOT NULL THEN src.venc_row
    WHEN src.emision IS NOT NULL THEN (
      -- aniversario de la emisión más cercano que no esté vencido hace más de 60 días;
      -- día = min(día de emisión, último día real del mes) para no adelantar fin de mes.
      SELECT min(d) FROM (
        SELECT make_date(
                 y,
                 EXTRACT(MONTH FROM src.emision)::int,
                 LEAST(
                   EXTRACT(DAY FROM src.emision)::int,
                   EXTRACT(DAY FROM (make_date(y, EXTRACT(MONTH FROM src.emision)::int, 1)
                                     + interval '1 month' - interval '1 day'))::int
                 )
               ) AS d
        FROM generate_series(EXTRACT(YEAR FROM src.hoy)::int - 1, EXTRACT(YEAR FROM src.hoy)::int + 1) AS y
      ) t WHERE t.d >= src.hoy - 60)
    ELSE NULL END
  FROM src;
$fn$;

-- ── elegibilidad: curso/renov por vencimiento (no por número); matriculación excluye a quien tiene fecha ──
CREATE OR REPLACE FUNCTION private.gg_ofrecimiento_elegible(p_admin uuid, p_regla text, p_hoy date)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
  SELECT CASE p_regla

    -- C3 · matriculación: sin señal de matrícula alguna (ni número, ni RPAC, ni curso CABA, ni fecha
    -- de vencimiento conocida). El escape "ya estoy matriculado" es cargar el número o una fecha.
    WHEN 'matriculacion' THEN
      NOT private.gg_admin_matricula_conocida(p_admin)
      AND NOT private.gg_admin_es_rpac(p_admin)
      AND NOT private.gg_admin_hizo_curso_caba(p_admin)
      AND private.gg_admin_prox_venc_matricula(p_admin) IS NULL
      AND NOT COALESCE((SELECT pr.no_requiere ? 'matriculacion' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)

    -- C1 · DDJJ: temporada nov-mar + matrícula CONOCIDA (número) + no solo-CABA + sin DDJJ del ciclo
    WHEN 'ddjj_ciclo' THEN
      EXTRACT(MONTH FROM p_hoy)::int IN (11,12,1,2,3)
      AND private.gg_admin_matricula_conocida(p_admin)
      AND NOT private.gg_admin_es_solo_caba(p_admin)
      AND NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo='rpac_ddjj' AND t.estado<>'cancelado'
          AND t.created_at >= make_date(EXTRACT(YEAR FROM p_hoy)::int - CASE WHEN EXTRACT(MONTH FROM p_hoy)>=11 THEN 0 ELSE 1 END, 11, 1))
      AND NOT COALESCE((SELECT pr.no_requiere ? 'ddjj' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)

    -- C2 · CURSO por vencimiento CONOCIDO (no por número), primero: venc futuro entre 16 y 60 días
    -- (>15d deja lugar a la renovación cuando el venc es inminente) + no hizo curso en 12m.
    WHEN 'curso_venc' THEN
      NOT private.gg_admin_es_solo_caba(p_admin)
      AND private.gg_admin_prox_venc_matricula(p_admin) IS NOT NULL
      AND private.gg_admin_prox_venc_matricula(p_admin) > (p_hoy + 15)
      AND private.gg_admin_prox_venc_matricula(p_admin) <= (p_hoy + 60)
      AND NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo='curso_actualizacion_rpac' AND t.estado<>'cancelado' AND t.created_at >= now() - interval '12 months')
      AND NOT EXISTS (SELECT 1 FROM public.curso_matriculas cm JOIN public.cursos c ON c.id=cm.curso_id LEFT JOIN public.profiles p ON p.id=cm.profile_id
        WHERE COALESCE(cm.administracion_id,p.administracion_id)=p_admin AND cm.estado<>'anulada' AND c.jurisdiccion='pba' AND c.slug ILIKE '%actualizacion%' AND cm.inscripto_at >= now() - interval '12 months')
      AND NOT COALESCE((SELECT pr.no_requiere ? 'curso_actualizacion' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)

    -- C2 · RENOVACIÓN por vencimiento CONOCIDO (no por número), después: cubre inminente Y vencido
    -- reciente [hoy-60, hoy+45] (un lapsado es el caso más urgente) + no renovó en el ciclo.
    WHEN 'renovacion_venc' THEN
      NOT private.gg_admin_es_solo_caba(p_admin)
      AND private.gg_admin_prox_venc_matricula(p_admin) IS NOT NULL
      AND private.gg_admin_prox_venc_matricula(p_admin) BETWEEN (p_hoy - 60) AND (p_hoy + 45)
      AND NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo IN ('rpac_renovacion','rpac_inscripcion','rpac_inscripcion_juridica')
          AND t.estado<>'cancelado' AND t.created_at >= now() - interval '10 months')
      AND NOT COALESCE((SELECT pr.no_requiere ? 'renovacion' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)

    -- C1 · CERTIFICADO: matrícula CONOCIDA (número) + no solo-CABA + sin certificado en 90d
    WHEN 'certificado_90' THEN
      private.gg_admin_matricula_conocida(p_admin)
      AND NOT private.gg_admin_es_solo_caba(p_admin)
      AND NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo='rpac_certificado' AND t.estado<>'cancelado' AND t.created_at >= now() - interval '90 days')
      AND NOT COALESCE((SELECT pr.no_requiere ? 'certificado' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)

    -- C4 · CONSULTORÍA a TODOS (sin gate RPAC): sin consulta jurídica en 120d
    WHEN 'cj_120' THEN
      NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo='juridico_consulta' AND t.estado<>'cancelado' AND t.created_at >= now() - interval '120 days')
      AND NOT COALESCE((SELECT pr.no_requiere ? 'consultoria' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)

    ELSE false
  END;
$fn$;

-- ── preview: sumar flag `vencido` (C6: distinguir "vence el" de "vencida el") ──
CREATE OR REPLACE FUNCTION public.gg_ofrecimientos_preview(p_administracion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_nr jsonb;
  v_prox date := private.gg_admin_prox_venc_matricula(p_administracion_id);
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);
  SELECT no_requiere INTO v_nr FROM public.perfil_regulatorio WHERE administracion_id = p_administracion_id;
  RETURN jsonb_build_object(
    'generated_at', now(),
    'prox_venc_matricula', to_char(v_prox, 'YYYY-MM-DD'),
    'prox_venc_vencido', (v_prox IS NOT NULL AND v_prox < v_hoy),
    'matriculacion', jsonb_build_object(
      'elegible', private.gg_ofrecimiento_elegible(p_administracion_id,'matriculacion',v_hoy),
      'no_requiere', COALESCE(v_nr ? 'matriculacion', false)),
    'certificado', jsonb_build_object(
      'elegible', private.gg_ofrecimiento_elegible(p_administracion_id,'certificado_90',v_hoy),
      'no_requiere', COALESCE(v_nr ? 'certificado', false)),
    'consultoria', jsonb_build_object(
      'elegible', private.gg_ofrecimiento_elegible(p_administracion_id,'cj_120',v_hoy),
      'no_requiere', COALESCE(v_nr ? 'consultoria', false)),
    'curso_actualizacion', jsonb_build_object(
      'elegible', private.gg_ofrecimiento_elegible(p_administracion_id,'curso_venc',v_hoy),
      'no_requiere', COALESCE(v_nr ? 'curso_actualizacion', false)),
    'renovacion', jsonb_build_object(
      'elegible', private.gg_ofrecimiento_elegible(p_administracion_id,'renovacion_venc',v_hoy),
      'no_requiere', COALESCE(v_nr ? 'renovacion', false)),
    'ddjj', jsonb_build_object(
      'elegible', private.gg_ofrecimiento_elegible(p_administracion_id,'ddjj_ciclo',v_hoy),
      'no_requiere', COALESCE(v_nr ? 'ddjj', false))
  );
END $function$;

-- ── B#1 (R6) · least-privilege en los helpers `private` (PUBLIC no debe ejecutarlos) ──
REVOKE EXECUTE ON FUNCTION
  private.gg_admin_matricula_conocida(uuid),
  private.gg_admin_prox_venc_matricula(uuid),
  private.gg_admin_es_rpac(uuid),
  private.gg_admin_es_solo_caba(uuid),
  private.gg_admin_hizo_curso_caba(uuid)
FROM PUBLIC;