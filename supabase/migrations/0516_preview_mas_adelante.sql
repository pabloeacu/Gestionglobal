-- 0516 · Panorama del cliente: distinguir "más adelante" de "no corresponde" (pedido Pablo 2026-09-27).
--
-- El panorama (gg_ofrecimientos_preview) mostraba "no corresponde ahora" para TODO lo no-elegible,
-- mezclando dos cosas distintas: lo que genuinamente NO aplica (matriculación de un matriculado) y lo
-- que SÍ aplica pero cuya VENTANA de oferta todavía no abrió (DDJJ fuera de temporada; curso/renovación
-- lejos del vencimiento). Eso se leía como contradicción al lado del Perfil regulatorio, que muestra la
-- obligación futura con fecha confirmada. Caso testigo: Catelli (Mat. 3030, vence 11/08/2027) —
-- renovación/curso/DDJJ "no corresponde" pese a ser obligaciones futuras conocidas.
--
-- FIX: cada tile suma `mas_adelante` (bool) = la obligación aplica pero la ventana no está abierta:
--   · ddjj: matrícula conocida, no solo-CABA, no opt-out, FUERA de temporada nov-mar.
--   · curso: no solo-CABA, no opt-out, vencimiento conocido pero a más de 60 días (ventana 16-60d antes).
--   · renovación: no solo-CABA, no opt-out, vencimiento conocido pero a más de 45 días (ventana [-60,+45]).
-- matriculación/certificado/consultoría no son ventana-gated de esta forma → mas_adelante=false.
-- Es la MISMA fuente que el motor (helpers gg_*), sin drift. Sólo lectura; R12 (assert) intacto.

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
  v_mat_conocida boolean := private.gg_admin_matricula_conocida(p_administracion_id);
  v_solo_caba boolean := private.gg_admin_es_solo_caba(p_administracion_id);
  v_mes int := EXTRACT(MONTH FROM v_hoy)::int;
  v_e_matric boolean := private.gg_ofrecimiento_elegible(p_administracion_id,'matriculacion',v_hoy);
  v_e_ddjj   boolean := private.gg_ofrecimiento_elegible(p_administracion_id,'ddjj_ciclo',v_hoy);
  v_e_curso  boolean := private.gg_ofrecimiento_elegible(p_administracion_id,'curso_venc',v_hoy);
  v_e_renov  boolean := private.gg_ofrecimiento_elegible(p_administracion_id,'renovacion_venc',v_hoy);
  v_e_cert   boolean := private.gg_ofrecimiento_elegible(p_administracion_id,'certificado_90',v_hoy);
  v_e_cj     boolean := private.gg_ofrecimiento_elegible(p_administracion_id,'cj_120',v_hoy);
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);
  SELECT no_requiere INTO v_nr FROM public.perfil_regulatorio WHERE administracion_id = p_administracion_id;
  RETURN jsonb_build_object(
    'generated_at', now(),
    'prox_venc_matricula', to_char(v_prox, 'YYYY-MM-DD'),
    'prox_venc_vencido', (v_prox IS NOT NULL AND v_prox < v_hoy),
    'matriculacion', jsonb_build_object(
      'elegible', v_e_matric,
      'no_requiere', COALESCE(v_nr ? 'matriculacion', false),
      'mas_adelante', false),
    'certificado', jsonb_build_object(
      'elegible', v_e_cert,
      'no_requiere', COALESCE(v_nr ? 'certificado', false),
      'mas_adelante', false),
    'consultoria', jsonb_build_object(
      'elegible', v_e_cj,
      'no_requiere', COALESCE(v_nr ? 'consultoria', false),
      'mas_adelante', false),
    'curso_actualizacion', jsonb_build_object(
      'elegible', v_e_curso,
      'no_requiere', COALESCE(v_nr ? 'curso_actualizacion', false),
      'mas_adelante', (NOT v_e_curso AND NOT COALESCE(v_nr ? 'curso_actualizacion', false)
                       AND NOT v_solo_caba AND v_prox IS NOT NULL AND v_prox > (v_hoy + 60))),
    'renovacion', jsonb_build_object(
      'elegible', v_e_renov,
      'no_requiere', COALESCE(v_nr ? 'renovacion', false),
      'mas_adelante', (NOT v_e_renov AND NOT COALESCE(v_nr ? 'renovacion', false)
                       AND NOT v_solo_caba AND v_prox IS NOT NULL AND v_prox > (v_hoy + 45))),
    'ddjj', jsonb_build_object(
      'elegible', v_e_ddjj,
      'no_requiere', COALESCE(v_nr ? 'ddjj', false),
      'mas_adelante', (NOT v_e_ddjj AND NOT COALESCE(v_nr ? 'ddjj', false)
                       AND v_mat_conocida AND NOT v_solo_caba AND v_mes NOT IN (11,12,1,2,3)))
  );
END $function$;