-- 0568_dgg222_refinamientos_cierre.sql
-- =============================================================================
-- DGG-222 · Refinamientos del flujo de cierre (auditoría de completitud 14-10).
-- 4 cambios, todos aditivos, firmas idénticas (CREATE OR REPLACE, R16 OK):
--
--  #1 (visible al cliente) — La línea de cierre satisfactorio se rotulaba
--     "Certificado emitido" (ícono medalla) para TODO: jurídica, matrícula,
--     renovación, curso. Es correcto SÓLO cuando se emitió un certificado de
--     acreditación (servicio rpac_certificado). Para el resto ahora usa la
--     categoría neutra existente 'cierre' ("Cierre del trámite", check/emerald).
--     El cierre frustrado usa 'cierre_frustrado' (se agrega su config para que
--     no se vea el slug crudo). Afecta el cierre HUMANO (tracking_cerrar) y el
--     del bot (tracking_cerrar_auto) — paridad. + backfill histórico: de las 37
--     líneas 'certificado_emitido' de cierre, 35 (no-certificado) pasan a 'cierre'
--     y 2 (rpac_certificado reales) se mantienen. Seguro: tracking_lineas sólo
--     tiene trigger AFTER INSERT → un UPDATE de categoría NO re-notifica a nadie.
--
--  #2 (robustez) — tracking_cerrar_auto setea el GUC app.skip_admin_assert='on'
--     adentro, para que el aviso al cliente (encolar_email → assert_administracion_access)
--     NUNCA se dropee en silencio, sin depender de que el caller lo setee.
--
--  #4 (precisión del reporte) — agente_cierre_correr: el desglose por-track en
--     modo real decía "cerré N" usando los limpios DETECTADOS del track, no los
--     cerrados reales. Ahora cuenta cerrados-por-track dentro del loop (sólo
--     divergía si limpios > cap en una corrida).
-- =============================================================================

-- #1 · config de la categoría de cierre frustrado (la 'cierre' ya existe: 0202).
INSERT INTO public.tracking_categorias_config (servicio_id, slug, label, icono, color, orden)
SELECT NULL, 'cierre_frustrado', 'Cierre sin resolución', 'x-circle', 'amber', 116
WHERE NOT EXISTS (
  SELECT 1 FROM public.tracking_categorias_config
  WHERE slug = 'cierre_frustrado' AND servicio_id IS NULL
);

-- #1 · cierre HUMANO: deriva la categoría de la línea por tipo de trámite.
CREATE OR REPLACE FUNCTION public.tracking_cerrar(p_tramite_id uuid, p_motivo_cierre text, p_satisfactorio boolean, p_observaciones text DEFAULT NULL::text, p_documento_final_url text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_admin uuid;
  v_descripcion text;
  v_archivos text[];
  v_estado_linea text;
  v_servicio_codigo text;
  v_categoria_linea text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede cerrar trámites' USING ERRCODE = '42501';
  END IF;

  SELECT t.administracion_id, sv.codigo INTO v_admin, v_servicio_codigo
    FROM public.tramites t LEFT JOIN public.servicios sv ON sv.id = t.servicio_id
   WHERE t.id = p_tramite_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trámite no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF p_motivo_cierre IS NULL OR length(trim(p_motivo_cierre)) = 0 THEN
    RAISE EXCEPTION 'El motivo de cierre es obligatorio' USING ERRCODE = '23502';
  END IF;
  IF p_satisfactorio IS NULL THEN
    RAISE EXCEPTION 'Debés indicar si el cierre fue satisfactorio o no' USING ERRCODE = '23502';
  END IF;

  UPDATE public.tramites
    SET estado = 'cerrado',
        fecha_fin = CURRENT_DATE,
        documento_final_url = p_documento_final_url,
        motivo_cierre = p_motivo_cierre,
        cierre_satisfactorio = p_satisfactorio,
        resuelto_at = COALESCE(resuelto_at, now()),
        resuelto_por = COALESCE(resuelto_por, auth.uid()),
        ultima_actividad_at = now()
   WHERE id = p_tramite_id;

  v_descripcion := 'Trámite cerrado: ' || p_motivo_cierre || '.';
  IF p_observaciones IS NOT NULL AND length(trim(p_observaciones)) > 0 THEN
    v_descripcion := v_descripcion || ' ' || trim(p_observaciones);
  END IF;

  IF p_documento_final_url IS NOT NULL AND length(trim(p_documento_final_url)) > 0 THEN
    v_archivos := ARRAY[p_documento_final_url]::text[];
  ELSE
    v_archivos := '{}'::text[];
  END IF;

  v_estado_linea := CASE WHEN p_satisfactorio THEN 'finalizado' ELSE 'frustrado' END;

  -- #1 · 'certificado_emitido' sólo si efectivamente se emitió un certificado de
  -- acreditación (servicio rpac_certificado); resto satisfactorio → 'cierre' neutro.
  v_categoria_linea := CASE WHEN NOT p_satisfactorio THEN 'cierre_frustrado'
                            WHEN v_servicio_codigo = 'rpac_certificado' THEN 'certificado_emitido'
                            ELSE 'cierre' END;

  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, estado_asociado, archivos_urls, autor_id, visible_cliente
  ) VALUES (
    p_tramite_id, v_categoria_linea, v_descripcion, v_estado_linea, v_archivos, auth.uid(), true
  );
END;
$function$;

-- #1 + #2 · cierre del BOT: misma derivación de categoría + GUC de tenencia adentro.
CREATE OR REPLACE FUNCTION public.tracking_cerrar_auto(p_tramite_id uuid, p_motivo_cierre text, p_satisfactorio boolean, p_observaciones text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE v_descripcion text; v_estado_linea text; v_servicio_codigo text; v_categoria_linea text;
BEGIN
  IF NOT (private.is_staff() OR (auth.uid() IS NULL AND COALESCE(auth.role(),'') <> 'anon')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  -- #2 · robustez: el aviso al cliente downstream (encolar_email → assert_administracion_access)
  -- necesita la tenencia habilitada. La seteamos acá para que NUNCA se dropee en silencio,
  -- sin depender de que el caller (agente_cierre_correr) lo setee. SET LOCAL (sólo esta txn).
  PERFORM set_config('app.skip_admin_assert', 'on', true);

  IF p_motivo_cierre IS NULL OR length(trim(p_motivo_cierre)) = 0 THEN
    RAISE EXCEPTION 'El motivo de cierre es obligatorio' USING ERRCODE = '23502'; END IF;
  IF p_satisfactorio IS NULL THEN
    RAISE EXCEPTION 'Debés indicar si el cierre fue satisfactorio' USING ERRCODE = '23502'; END IF;

  SELECT sv.codigo INTO v_servicio_codigo
    FROM public.tramites t LEFT JOIN public.servicios sv ON sv.id = t.servicio_id
   WHERE t.id = p_tramite_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trámite no encontrado' USING ERRCODE = 'P0002'; END IF;

  UPDATE public.tramites
    SET estado='cerrado', fecha_fin=CURRENT_DATE, motivo_cierre=p_motivo_cierre,
        cierre_satisfactorio=p_satisfactorio, resuelto_at=COALESCE(resuelto_at, now()), ultima_actividad_at=now()
   WHERE id = p_tramite_id;

  v_descripcion := 'Trámite cerrado: ' || p_motivo_cierre || '.';
  IF p_observaciones IS NOT NULL AND length(trim(p_observaciones)) > 0 THEN
    v_descripcion := v_descripcion || ' ' || trim(p_observaciones); END IF;
  v_estado_linea := CASE WHEN p_satisfactorio THEN 'finalizado' ELSE 'frustrado' END;

  v_categoria_linea := CASE WHEN NOT p_satisfactorio THEN 'cierre_frustrado'
                            WHEN v_servicio_codigo = 'rpac_certificado' THEN 'certificado_emitido'
                            ELSE 'cierre' END;

  INSERT INTO public.tracking_lineas (tramite_id, categoria, descripcion, estado_asociado, archivos_urls, autor_id, visible_cliente)
  VALUES (p_tramite_id, v_categoria_linea, v_descripcion, v_estado_linea, '{}'::text[], NULL, true);
END; $function$;

-- #4 · agente_cierre_correr: contador de cerrados POR TRACK (no limpios detectados).
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
  v_cerrados_p int := 0; v_cerrados_j int := 0; v_cerrados_c int := 0;
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
        -- #4 · cerrados POR TRACK (para el reporte exacto en modo real)
        IF    (v_it->>'track')='principal' THEN v_cerrados_p := v_cerrados_p + 1;
        ELSIF (v_it->>'track')='juridica'  THEN v_cerrados_j := v_cerrados_j + 1;
        ELSIF (v_it->>'track')='curso'     THEN v_cerrados_c := v_cerrados_c + 1;
        END IF;
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
        'principal', jsonb_build_object('total',v_tp,'limpios',v_lp,'revision',v_rp,'bloqueos',v_bp,'cerrados',v_cerrados_p),
        'juridica',  jsonb_build_object('total',v_tj,'limpios',v_lj,'revision',v_rj,'bloqueos',v_bj,'cerrados',v_cerrados_j),
        'curso',     jsonb_build_object('total',v_tc,'limpios',v_lc,'revision',v_rc,'bloqueos',v_bc,'cerrados',v_cerrados_c,
                                        'espera_cert',v_cur_espera,'cursando',v_cur_cursando)));

  INSERT INTO public.agente_cierre_runs (origen, modo, overall, resumen, items)
  VALUES (p_origen, v_modo, CASE WHEN v_total=0 THEN 'sin_candidatos' ELSE 'ok' END,
          v_resumen || jsonb_build_object('errores_detalle', v_errores), v_items)
  RETURNING id INTO v_run_id;

  IF v_total > 0 OR p_origen <> 'cron' THEN
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
        '  →  ' || (CASE WHEN v_modo='real' THEN 'cerré ' || v_cerrados_p ELSE 'limpios ' || v_lp END) ||
        ' · a revisar ' || v_rp || ' · bloqueados ' || v_bp || E'\n' ||
      '• Jurídica (consultas resueltas, con respuesta visible al cliente): ' || v_tj ||
        '  →  ' || (CASE WHEN v_modo='real' THEN 'cerré ' || v_cerrados_j ELSE 'limpios ' || v_lj END) ||
        ' · a revisar ' || v_rj || ' · bloqueados ' || v_bj || E'\n' ||
      '• Cursos (RPAC/PBA, egresado + certificado +30 días): ' || v_tc ||
        '  →  ' || (CASE WHEN v_modo='real' THEN 'cerré ' || v_cerrados_c ELSE 'limpios ' || v_lc END) ||
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

-- #1 · backfill de líneas de cierre históricas mal rotuladas (seguro: tracking_lineas
-- sólo tiene trigger AFTER INSERT → un UPDATE de categoría no re-notifica a nadie).
-- 'certificado_emitido' → 'cierre' para todo lo que NO sea certificado de acreditación.
UPDATE public.tracking_lineas tl
   SET categoria = 'cierre'
  FROM public.tramites t
  LEFT JOIN public.servicios sv ON sv.id = t.servicio_id
 WHERE tl.tramite_id = t.id
   AND tl.categoria = 'certificado_emitido'
   AND COALESCE(sv.codigo, '') <> 'rpac_certificado';
