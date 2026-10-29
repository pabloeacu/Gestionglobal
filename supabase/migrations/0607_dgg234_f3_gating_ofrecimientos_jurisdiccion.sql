-- 0607_dgg234_f3_gating_ofrecimientos_jurisdiccion.sql
-- DGG-234 · Fase 3 — Gating del motor de ofrecimientos por jurisdicción POSITIVA.
-- Ver DGG-234_matricula_multijurisdiccion.md
-- --------------------------------------------------------------------------
-- Las reglas de servicios PBA-only (ddjj_ciclo, curso_venc, renovacion_venc,
-- matricula_desactualizada, certificado_90) pasan de gatear con
-- "NOT gg_admin_es_solo_caba" (= "no es sólo CABA", que deja pasar a Neuquén y
-- a multi-jurisdicción) a exigir SER PBA ("gg_admin_es_rpac"). Además:
--  · 'matriculacion' no se ofrece a quien ya tiene matrícula NO-PBA en la hija.
--  · 'perfil_incompleto' incluye a quien tiene matrícula en la hija (CABA/NEU).
-- 0 REGRESIÓN para datos actuales: es_solo_caba=false para los 178; es_rpac sólo
-- difiere para los 29 sin matrícula, que YA son inelegibles en esas reglas por
-- sus otras condiciones (matricula_conocida / prox_venc / matricula_rpac_vencimiento).
-- CREATE OR REPLACE (misma firma, R16 ok). SQL STABLE, sin cambio de seguridad.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.gg_ofrecimiento_elegible(p_admin uuid, p_regla text, p_hoy date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_regla
    WHEN 'matriculacion' THEN
      NOT private.gg_admin_matricula_conocida(p_admin)
      AND NOT private.gg_admin_es_rpac(p_admin)
      AND NOT private.gg_admin_hizo_curso_caba(p_admin)
      AND private.gg_admin_prox_venc_matricula(p_admin) IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.matricula_extra me WHERE me.administracion_id = p_admin)
      AND NOT COALESCE((SELECT pr.no_requiere ? 'matriculacion' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)
    WHEN 'ddjj_ciclo' THEN
      EXTRACT(MONTH FROM p_hoy)::int IN (11,12,1,2,3)
      AND private.gg_admin_matricula_conocida(p_admin)
      AND private.gg_admin_es_rpac(p_admin)
      AND NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo='rpac_ddjj' AND t.estado<>'cancelado'
          AND t.created_at >= make_date(EXTRACT(YEAR FROM p_hoy)::int - CASE WHEN EXTRACT(MONTH FROM p_hoy)>=11 THEN 0 ELSE 1 END, 11, 1))
      AND NOT COALESCE((SELECT pr.no_requiere ? 'ddjj' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)
    WHEN 'curso_venc' THEN
      private.gg_admin_es_rpac(p_admin)
      AND private.gg_admin_prox_venc_matricula(p_admin) IS NOT NULL
      AND private.gg_admin_prox_venc_matricula(p_admin) > (p_hoy + 15)
      AND private.gg_admin_prox_venc_matricula(p_admin) <= (p_hoy + 60)
      AND NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo='curso_actualizacion_rpac' AND t.estado<>'cancelado' AND t.created_at >= now() - interval '12 months')
      AND NOT EXISTS (SELECT 1 FROM public.curso_matriculas cm JOIN public.cursos c ON c.id=cm.curso_id LEFT JOIN public.profiles p ON p.id=cm.profile_id
        WHERE COALESCE(cm.administracion_id,p.administracion_id)=p_admin AND cm.estado<>'anulada' AND c.jurisdiccion='pba' AND c.slug ILIKE '%actualizacion%' AND cm.inscripto_at >= now() - interval '12 months')
      AND NOT COALESCE((SELECT pr.no_requiere ? 'curso_actualizacion' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)
    WHEN 'renovacion_venc' THEN
      private.gg_admin_es_rpac(p_admin)
      AND private.gg_admin_prox_venc_matricula(p_admin) IS NOT NULL
      AND private.gg_admin_prox_venc_matricula(p_admin) BETWEEN p_hoy AND (p_hoy + 45)
      AND NOT EXISTS (SELECT 1 FROM public.administraciones a
        WHERE a.id=p_admin AND a.matricula_rpac_vencimiento IS NOT NULL AND a.matricula_rpac_vencimiento < p_hoy)
      AND NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo IN ('rpac_renovacion','rpac_inscripcion','rpac_inscripcion_juridica')
          AND t.estado<>'cancelado' AND t.created_at >= now() - interval '10 months')
      AND NOT COALESCE((SELECT pr.no_requiere ? 'renovacion' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)
    WHEN 'matricula_desactualizada' THEN
      private.gg_admin_es_rpac(p_admin)
      AND EXISTS (SELECT 1 FROM public.administraciones a
        WHERE a.id=p_admin AND a.matricula_rpac_vencimiento IS NOT NULL AND a.matricula_rpac_vencimiento < p_hoy)
      AND NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo IN ('rpac_renovacion','rpac_inscripcion','rpac_inscripcion_juridica')
          AND t.estado<>'cancelado' AND t.created_at >= now() - interval '10 months')
      AND NOT COALESCE((SELECT pr.no_requiere ? 'renovacion' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)
    WHEN 'certificado_90' THEN
      private.gg_admin_matricula_conocida(p_admin)
      AND private.gg_admin_es_rpac(p_admin)
      AND NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo='rpac_certificado' AND t.estado<>'cancelado' AND t.created_at >= now() - interval '90 days')
      AND NOT COALESCE((SELECT pr.no_requiere ? 'certificado' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)
    WHEN 'cj_120' THEN
      NOT EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
        WHERE t.administracion_id=p_admin AND s.codigo='juridico_consulta' AND t.estado<>'cancelado' AND t.created_at >= now() - interval '120 days')
      AND NOT COALESCE((SELECT pr.no_requiere ? 'consultoria' FROM public.perfil_regulatorio pr WHERE pr.administracion_id=p_admin), false)
    WHEN 'perfil_incompleto' THEN
      (private.gg_admin_es_rpac(p_admin)
        OR private.gg_admin_hizo_curso_caba(p_admin)
        OR EXISTS (SELECT 1 FROM public.matricula_extra me WHERE me.administracion_id=p_admin))
      AND private.gg_admin_ficha_incompleta(p_admin)
    ELSE false
  END;
$function$;
