-- 0681 · DGG-248 · Auto-materialización de obligaciones regulatorias para
-- TODO matriculado (no sólo los que declararon) — en particular la DDJJ anual.
--
-- CAUSA RAÍZ (medida, no supuesta):
--   El cron diario `gg_perfil_declarado_materializar_diario` materializa los
--   vencimientos regulatorios (renovación / DDJJ / curso) llamando a
--   `private.perfil_declarado_sync_venc(admin)`. Su loop hacía
--   `INNER JOIN perfil_regulatorio`, así que SÓLO procesaba a los ~45 de 157
--   matriculados RPAC que habían declarado algo (o opt-outeado). Los otros
--   112 (106 sin DDJJ vigente) quedaban invisibles → nunca se les creaba la
--   agenda de la DDJJ-de-marzo, que vence el 31/03 para TODO matriculado.
--   `perfil_regulatorio` es ON-DEMAND (lo crean sólo perfil_regulatorio_declarar
--   y _set_no_requiere), NO 1:1 con administraciones → backfillearlo sería
--   incorrecto. En cambio `perfil_regulatorio_calc` YA infiere
--   proxima_ddjj = próximo 31/03 con certeza='inferido' SIN necesitar fila
--   declarada (lee de administraciones.matricula_rpac), y
--   `perfil_declarado_sync_venc` ya materializa cuando la certeza es
--   'declarado' O 'inferido'. El único hueco era el alcance del loop.
--
-- FIX (aditivo, reusa el motor probado — sin tocar perfil_declarado_sync_venc
--   ni perfil_regulatorio_calc): el loop cubre ahora el universo completo:
--   matriculados activos (RPAC/RPA o con inscripción/renovación resuelta)
--   ∪ los que tengan fila en perfil_regulatorio (comportamiento previo intacto).
--   Opt-outs (perfil_regulatorio.no_requiere), supresión por fila 'oficial'
--   (tipo ddjj_anual/curso_actualizacion ya existente) y roll anual (UPDATE
--   in-place de la fecha) los sigue manejando el sync reusado.
--
-- RADIO DE IMPACTO (dry-run real con rollback, verificado 2026-11-12):
--   +106 ddjj_anual_declarada (31/03/2027), +75 curso_actualizacion_declarado
--   (sólo los que tienen un curso previo resuelto → inferido last+12m),
--   +1 renovacion_matricula_declarada. TODAS origen='declarado',
--   notificar_cliente=true, alarmas {45,30,15,0,-7,-21}.
--
-- SEGURIDAD DE TIMING: las filas nuevas NO disparan nada hoy. El aviso corre
--   por el planner `gg_vencimientos_planificar_alertas` (cron diario): la
--   ventana declarado de la DDJJ 31/03/2027 es ~14/02→21/04/2027. Hoy
--   (2026-11-12) queda fuera de toda ventana → cero email/push al materializar.
--   No hay trigger AFTER INSERT en vencimientos que notifique inmediato.

CREATE OR REPLACE FUNCTION public.gg_perfil_declarado_materializar_diario()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE a record; v_n int := 0;
BEGIN
  FOR a IN
    -- (1) comportamiento previo: todo el que tenga perfil regulatorio declarado
    SELECT administracion_id FROM public.perfil_regulatorio
    UNION
    -- (2) DGG-248: todo matriculado activo (RPAC/RPA), aunque nunca haya declarado
    SELECT ad.id FROM public.administraciones ad
     WHERE ad.activo = true
       AND (ad.matricula_rpac IS NOT NULL OR ad.matricula_rpa IS NOT NULL)
    UNION
    -- (3) matriculado por inscripción/renovación resuelta (paridad con
    --     perfil_regulatorio_calc.v_matriculado_conf) aun si la col matrícula
    --     quedara nula por algún dato viejo
    SELECT DISTINCT t.administracion_id
      FROM public.tramites t
      JOIN public.servicios s ON s.id = t.servicio_id
      JOIN public.administraciones ad ON ad.id = t.administracion_id
     WHERE ad.activo = true
       AND t.administracion_id IS NOT NULL
       AND t.estado IN ('resuelto','cerrado')
       AND t.cierre_satisfactorio IS NOT FALSE
       AND s.codigo IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion')
  LOOP
    BEGIN
      PERFORM private.perfil_declarado_sync_venc(a.administracion_id);
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'gg_perfil_declarado_materializar_diario admin %: %', a.administracion_id, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('procesados', v_n, 'at', now());
END $function$;
