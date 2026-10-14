-- 0566_dgg222_reporte_cierre_colapsa_cursos.sql
-- =============================================================================
-- DGG-222 · UX del reporte diario del equipo de cierre (entregabilidad).
-- El e2e de 0565 reveló que, con el track de cursos, el universo saltó a ~90
-- trámites y el email diario listaba los 72 cursos "aún cursando" uno por uno
-- — ruido que se repetiría idéntico cada día y entierra lo accionable.
-- FIX (sólo el cuerpo del mail; cero cambio de lógica/cierre):
--   · El DETALLE lista en full sólo lo accionable: cerrados/cerraría, bloqueados,
--     y principal/jurídica "a revisar".
--   · Los cursos "a revisar" (en marcha) se colapsan en UNA línea-resumen con
--     el desglose (esperando cert / aún cursando / con cobro pendiente).
-- Firma idéntica (p_origen text) → CREATE OR REPLACE sin overload (R16 OK).
-- detectar() NO se toca (queda en v5 de 0565).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agente_cierre_correr(p_origen text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_items jsonb; v_total int; v_limpios int; v_bloqueos int; v_revision int;
  v_resumen jsonb; v_run_id uuid; v_modo text; v_activo boolean; v_cap int;
  v_cerrados int := 0; v_errores jsonb := '[]'::jsonb; v_it jsonb; v_err_txt text;
  v_hoy text := to_char((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, 'DD/MM/YYYY');
  v_lista text; v_cuerpo text; v_titulo text;
  v_tp int; v_tj int; v_tc int; v_lp int; v_lj int; v_lc int;
  v_rp int; v_rj int; v_rc int; v_bp int; v_bj int; v_bc int;
  v_cur_espera int; v_cur_cursando int;
BEGIN
  IF NOT (private.is_staff() OR (auth.uid() IS NULL AND COALESCE(auth.role(),'') <> 'anon')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.skip_admin_assert', 'on', true);

  SELECT COALESCE(agente_cierre_activo,false), COALESCE(agente_cierre_cap,25)
    INTO v_activo, v_cap FROM public.config_global LIMIT 1;
  v_modo := CASE WHEN v_activo THEN 'real' ELSE 'seco' END;

  v_items := private.agente_cierre_detectar();
  v_total := jsonb_array_length(v_items);
  SELECT count(*) FILTER (WHERE it->>'decision'='cerrar_limpio'),
         count(*) FILTER (WHERE it->>'decision'='reportar_bloqueo'),
         count(*) FILTER (WHERE it->>'decision'='reportar_revision')
    INTO v_limpios, v_bloqueos, v_revision FROM jsonb_array_elements(v_items) it;

  SELECT count(*) FILTER (WHERE it->>'track'='principal'),
         count(*) FILTER (WHERE it->>'track'='juridica'),
         count(*) FILTER (WHERE it->>'track'='curso'),
         count(*) FILTER (WHERE it->>'track'='principal' AND it->>'decision'='cerrar_limpio'),
         count(*) FILTER (WHERE it->>'track'='juridica'  AND it->>'decision'='cerrar_limpio'),
         count(*) FILTER (WHERE it->>'track'='curso'     AND it->>'decision'='cerrar_limpio'),
         count(*) FILTER (WHERE it->>'track'='principal' AND it->>'decision'='reportar_revision'),
         count(*) FILTER (WHERE it->>'track'='juridica'  AND it->>'decision'='reportar_revision'),
         count(*) FILTER (WHERE it->>'track'='curso'     AND it->>'decision'='reportar_revision'),
         count(*) FILTER (WHERE it->>'track'='principal' AND it->>'decision'='reportar_bloqueo'),
         count(*) FILTER (WHERE it->>'track'='juridica'  AND it->>'decision'='reportar_bloqueo'),
         count(*) FILTER (WHERE it->>'track'='curso'     AND it->>'decision'='reportar_bloqueo'),
         count(*) FILTER (WHERE it->>'track'='curso' AND it->>'decision'='reportar_revision' AND (it->>'motivo') LIKE 'Egresó pero%'),
         count(*) FILTER (WHERE it->>'track'='curso' AND it->>'decision'='reportar_revision' AND (it->>'motivo') LIKE 'Curso aún%')
    INTO v_tp,v_tj,v_tc, v_lp,v_lj,v_lc, v_rp,v_rj,v_rc, v_bp,v_bj,v_bc, v_cur_espera, v_cur_cursando
    FROM jsonb_array_elements(v_items) it;

  IF v_modo = 'real' THEN
    FOR v_it IN SELECT e FROM jsonb_array_elements(v_items) e WHERE e->>'decision'='cerrar_limpio' LOOP
      EXIT WHEN v_cerrados >= v_cap;
      BEGIN
        PERFORM public.tracking_cerrar_auto(
          (v_it->>'tramite_id')::uuid, v_it->'cierre'->>'motivo',
          (v_it->'cierre'->>'satisfactorio')::boolean, v_it->'cierre'->>'observaciones');
        v_cerrados := v_cerrados + 1;
      EXCEPTION WHEN OTHERS THEN
        v_err_txt := SQLERRM;
        v_errores := v_errores || jsonb_build_object('cliente', v_it->>'cliente',
                      'tramite_id', v_it->>'tramite_id', 'error', v_err_txt);
      END;
    END LOOP;
  END IF;

  v_resumen := jsonb_build_object('total', v_total, 'cerrar_limpio', v_limpios,
     'reportar_revision', v_revision, 'reportar_bloqueo', v_bloqueos, 'modo', v_modo,
     'cerrados', v_cerrados, 'errores_cierre', jsonb_array_length(v_errores), 'cap', v_cap,
     'por_track', jsonb_build_object(
        'principal', jsonb_build_object('total',v_tp,'limpios',v_lp,'revision',v_rp,'bloqueos',v_bp),
        'juridica',  jsonb_build_object('total',v_tj,'limpios',v_lj,'revision',v_rj,'bloqueos',v_bj),
        'curso',     jsonb_build_object('total',v_tc,'limpios',v_lc,'revision',v_rc,'bloqueos',v_bc,
                                        'espera_cert',v_cur_espera,'cursando',v_cur_cursando)));

  INSERT INTO public.agente_cierre_runs (origen, modo, overall, resumen, items)
  VALUES (p_origen, v_modo, CASE WHEN v_total=0 THEN 'sin_candidatos' ELSE 'ok' END,
          v_resumen || jsonb_build_object('errores_detalle', v_errores), v_items)
  RETURNING id INTO v_run_id;

  IF v_total > 0 OR p_origen <> 'cron' THEN
    -- Detalle en full: TODO menos los cursos "a revisar" (se resumen en una línea).
    SELECT string_agg(format('%s %s — %s (%s) · %s',
             CASE e->>'decision' WHEN 'cerrar_limpio' THEN (CASE WHEN v_modo='real' THEN '✓ CERRADO:' ELSE '✓ cerraría:' END)
                                 WHEN 'reportar_bloqueo' THEN '⛔ bloqueado:' ELSE '🔎 a revisar:' END,
             e->>'cliente', initcap(e->>'categoria'), COALESCE(e->>'servicio','—'),
             CASE e->>'decision' WHEN 'cerrar_limpio' THEN COALESCE(e->'cierre'->>'motivo', e->>'motivo') ELSE e->>'motivo' END),
             E'\n' ORDER BY e->>'decision', e->>'track', e->>'cliente')
      INTO v_lista FROM jsonb_array_elements(v_items) e
      WHERE NOT (e->>'track'='curso' AND e->>'decision'='reportar_revision');

    v_titulo := CASE WHEN v_modo='real' THEN 'Resumen de agentes · Cierre de trámites'
                     ELSE 'Resumen de agentes · Cierre de trámites (SIMULACIÓN)' END;
    v_cuerpo :=
      CASE WHEN v_modo='real' THEN 'Equipo de cierre de trámites · ' || v_hoy || E'\n' ||
             'Cerré ' || v_cerrados || ' trámite(s) y avisé a sus clientes.'
           ELSE 'SIMULACIÓN — equipo de cierre de trámites · ' || v_hoy || E'\n' ||
             '(No cerré nada ni escribí a ningún cliente.)' END || E'\n\n' ||
      'Detectados (resueltos +25 días): ' || v_total || ' en 3 tracks.' || E'\n' ||
      '• Principal (matrícula/renovación/certificado, con verificación TRAMIX): ' || v_tp ||
        '  →  ' || (CASE WHEN v_modo='real' THEN 'cerré ' ELSE 'limpios ' END) || v_lp ||
        ' · a revisar ' || v_rp || ' · bloqueados ' || v_bp || E'\n' ||
      '• Jurídica (consultas resueltas, con respuesta visible al cliente): ' || v_tj ||
        '  →  ' || (CASE WHEN v_modo='real' THEN 'cerré ' ELSE 'limpios ' END) || v_lj ||
        ' · a revisar ' || v_rj || ' · bloqueados ' || v_bj || E'\n' ||
      '• Cursos (RPAC/PBA, egresado + certificado +30 días): ' || v_tc ||
        '  →  ' || (CASE WHEN v_modo='real' THEN 'cerré ' ELSE 'limpios ' END) || v_lc ||
        ' · a revisar ' || v_rc || ' · bloqueados ' || v_bc || E'\n\n' ||
      CASE WHEN v_modo='real'
        THEN 'Cerrados efectivamente: ' || v_cerrados || ' de ' || v_limpios || ' limpios (tope por corrida: ' || v_cap || ')' ||
             (CASE WHEN jsonb_array_length(v_errores)>0 THEN ' · No se pudo cerrar: '||jsonb_array_length(v_errores) ELSE '' END) || E'\n'
        ELSE 'Total limpios que cerraría al activar: ' || v_limpios || E'\n' END ||
      'Total a revisar: ' || v_revision || '  ·  Total bloqueados (amortiguador, no se fuerzan): ' || v_bloqueos || E'\n\n' ||
      'Detalle (accionable):' || E'\n' || COALESCE(v_lista, '(sin ítems accionables)') ||
      CASE WHEN v_tc > v_lc + v_bc
        THEN E'\n• Cursos en marcha (no requieren acción): ' || (v_cur_espera + v_cur_cursando) ||
             ' — ' || v_cur_espera || ' egresados esperando que el certificado cumpla 30 días · ' ||
             v_cur_cursando || ' aún cursando.'
        ELSE '' END ||
      CASE WHEN jsonb_array_length(v_errores)>0
        THEN E'\n\n⚠ No se pudieron cerrar (los dejo para revisión):\n' ||
             (SELECT string_agg('• '||(x->>'cliente')||': '||(x->>'error'), E'\n') FROM jsonb_array_elements(v_errores) x)
        ELSE '' END || E'\n\n' ||
      CASE WHEN v_modo='real' THEN 'Los bloqueados y los "a revisar" quedan para vos.'
           ELSE 'Cuando valides, habilito el cierre automático de los limpios. Los bloqueados y "a revisar" siempre quedan para vos.' END;

    INSERT INTO public.email_queue (kind, template_slug, to_email, to_nombre, variables,
                                    prioridad, intento, max_intentos, programado_para)
    VALUES ('workflow', 'gerencia-notif-generica', 'pabloeacu@gmail.com', 'Pablo',
            jsonb_build_object('titulo_evento', v_titulo, 'url', '/gerencia/tramites', 'cuerpo', v_cuerpo),
            3, 0, 3, now());
  END IF;

  RETURN jsonb_build_object('ok', true, 'run_id', v_run_id, 'resumen', v_resumen);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.agente_cierre_correr(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.agente_cierre_correr(text) TO authenticated, service_role;
