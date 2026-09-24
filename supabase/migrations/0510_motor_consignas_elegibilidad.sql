-- 0510 · Agenda · alineación del motor a las consignas de Pablo (DGG-200) — parte 1: elegibilidad.
--
-- Consignas: C1 Certificado+DDJJ solo con MATRÍCULA CONOCIDA (número cargado o declarado);
-- C2 Curso+Renovación por VENCIMIENTO (o emisión+12m), SEPARADOS, curso primero;
-- C3 si no tiene matrícula → ofrecer MATRICULACIÓN (+ el dato declarado en la ficha "cuenta");
-- C4 Consultoría a TODOS (sin gate RPAC); C5 Plataforma no se ofrece (ya cumplido).
--
-- Esta migración: 2 helpers nuevos + reescribe `gg_ofrecimiento_elegible` con el set de reglas nuevo.
-- El motor real y el sombra (que llaman al helper) se actualizan en 0511. El motor sigue DORMIDO.

-- ── helper: "matrícula conocida" = número cargado en la ficha O declarado por el cliente ──
CREATE OR REPLACE FUNCTION private.gg_admin_matricula_conocida(p_admin uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.administraciones a
                 WHERE a.id=p_admin AND NULLIF(btrim(a.matricula_rpac),'') IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.perfil_regulatorio pr
                 WHERE pr.administracion_id=p_admin AND NULLIF(btrim(pr.matricula_nro_declarada),'') IS NOT NULL);
$fn$;

-- ── helper: próximo vencimiento de matrícula (para timing de curso/renovación) ──
-- Prioridad: vencimiento explícito futuro > fila de vencimiento renovacion_rpac vigente >
-- próximo aniversario de la EMISIÓN (matricula_rpac_fecha o fecha declarada) — C2 "emisión+12m".
CREATE OR REPLACE FUNCTION private.gg_admin_prox_venc_matricula(p_admin uuid)
 RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
  WITH src AS (
    SELECT
      (SELECT a.matricula_rpac_vencimiento FROM public.administraciones a WHERE a.id=p_admin) AS venc_ficha,
      (SELECT min(v.fecha_vencimiento) FROM public.vencimientos v
        WHERE v.administracion_id=p_admin AND v.tipo='renovacion_rpac' AND v.estado='vigente' AND v.fecha_vencimiento>=CURRENT_DATE) AS venc_row,
      COALESCE(
        (SELECT a.matricula_rpac_fecha FROM public.administraciones a WHERE a.id=p_admin),
        (SELECT pr.matricula_fecha_declarada FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin),
        (SELECT pr.ultima_renovacion_declarada FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin)
      ) AS emision
  )
  SELECT CASE
    WHEN src.venc_ficha IS NOT NULL AND src.venc_ficha >= CURRENT_DATE THEN src.venc_ficha
    WHEN src.venc_row IS NOT NULL THEN src.venc_row
    WHEN src.emision IS NOT NULL THEN (
      -- próximo aniversario de la emisión (mes/día) >= hoy; LEAST(dia,28) evita 29-feb
      SELECT min(d) FROM (VALUES
        (make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,     EXTRACT(MONTH FROM src.emision)::int, LEAST(EXTRACT(DAY FROM src.emision)::int,28))),
        (make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int + 1, EXTRACT(MONTH FROM src.emision)::int, LEAST(EXTRACT(DAY FROM src.emision)::int,28)))
      ) t(d) WHERE d >= CURRENT_DATE)
    ELSE NULL END
  FROM src;
$fn$;

-- ── elegibilidad por regla (set nuevo). Ventanas TUNEABLES (offsets curso/renovación). ──
CREATE OR REPLACE FUNCTION private.gg_ofrecimiento_elegible(p_admin uuid, p_regla text, p_hoy date)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
  SELECT CASE p_regla

    -- C3 · matriculación: NO matriculado (ni conocido ni RPAC por trámite/venc) ni curso CABA
    WHEN 'matriculacion' THEN
      NOT private.gg_admin_matricula_conocida(p_admin)
      AND NOT private.gg_admin_es_rpac(p_admin)
      AND NOT private.gg_admin_hizo_curso_caba(p_admin)
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

    -- C2 · CURSO por vencimiento (primero): próx venc dentro de 60d + no hizo curso en 12m
    WHEN 'curso_venc' THEN
      private.gg_admin_matricula_conocida(p_admin)
      AND NOT private.gg_admin_es_solo_caba(p_admin)
      AND private.gg_admin_prox_venc_matricula(p_admin) IS NOT NULL
      AND private.gg_admin_prox_venc_matricula(p_admin) BETWEEN p_hoy AND (p_hoy + 60)
      AND NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo='curso_actualizacion_rpac' AND t.estado<>'cancelado' AND t.created_at >= now() - interval '12 months')
      AND NOT EXISTS (SELECT 1 FROM public.curso_matriculas cm JOIN public.cursos c ON c.id=cm.curso_id LEFT JOIN public.profiles p ON p.id=cm.profile_id
        WHERE COALESCE(cm.administracion_id,p.administracion_id)=p_admin AND cm.estado<>'anulada' AND c.jurisdiccion='pba' AND c.slug ILIKE '%actualizacion%' AND cm.inscripto_at >= now() - interval '12 months')
      AND NOT COALESCE((SELECT pr.no_requiere ? 'curso_actualizacion' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)

    -- C2 · RENOVACIÓN por vencimiento (después): próx venc dentro de 45d + no renovó en el ciclo
    WHEN 'renovacion_venc' THEN
      private.gg_admin_matricula_conocida(p_admin)
      AND NOT private.gg_admin_es_solo_caba(p_admin)
      AND private.gg_admin_prox_venc_matricula(p_admin) IS NOT NULL
      AND private.gg_admin_prox_venc_matricula(p_admin) BETWEEN p_hoy AND (p_hoy + 45)
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
