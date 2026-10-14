-- 0563_dgg222_f2_cierre_real.sql
-- =============================================================================
-- DGG-222 · Equipo de cierre de trámites — FASE 2 (cierre REAL de los limpios).
-- 100% ADITIVO: no toca `tracking_cerrar` ni ninguna lógica/trigger existente.
-- Sigue GATED: cierra sólo si `config_global.agente_cierre_activo = true` (default
-- FALSE). Con el flag OFF, `correr` sigue en modo 'seco' (igual que F1).
--
-- Entrega F2:
--   · columna `config_global.agente_cierre_cap` (tope de cierres por corrida).
--   · `public.tracking_cerrar_auto(uuid,text,boolean,text)` — RPC del BOT: clon
--     fiel de `tracking_cerrar` con guard relajado (staff O service/cron, NO anon)
--     y actor bot (autor_id NULL → el portal del cliente muestra "Gestión Global";
--     resuelto_por se mantiene = el humano que resolvió). El trigger amortiguador
--     `trg_tramite_cerrar_exige_cobrado` SIGUE siendo la barrera final (si el
--     trámite no es cerrable, aborta y el llamador lo captura).
--   · `private.agente_cierre_detectar()` v3 — agrega 2 blindajes exigidos por §6
--     antes de auto-cerrar: FRESCURA (`tramix_cache.consultado_at >= created_at`)
--     y ANCLAJE (fecha del expediente confirmante dentro de [created_at-180d,
--     now+7d] → outcome del ciclo actual, no uno viejo). Sólo cerrar_limpio si
--     además de amortiguador-limpio + TRAMIX-confirmado está fresco y anclado.
--     Incluye el objeto `cierre` (motivo/satisfactorio/mensaje al cliente) por
--     servicio.
--   · `public.agente_cierre_correr(p_origen)` — modo derivado del flag (R16: misma
--     firma, sin overloads). En 'real': cierra los limpios hasta el cap, con
--     BEGIN/EXCEPTION por ítem (un bloqueo del amortiguador → errores_cierre, no
--     tumba la corrida). Habilita la tenencia de confianza (set_config
--     'app.skip_admin_assert','on', LOCAL) para que el aviso al cliente
--     (trigger → encolar_email → assert_administracion_access) funcione en
--     cualquier path (cron directo / edge / manual). Reporta real vs seco.
-- §6 (3 agentes + e2e): cierra 6 limpios + avisa a 6 clientes con el mensaje
-- personalizado; amortiguador bloquea los sucios; cap respetado; GUC scoped a la
-- txn; todo verificado con rollback.
-- =============================================================================

ALTER TABLE public.config_global ADD COLUMN IF NOT EXISTS agente_cierre_cap int NOT NULL DEFAULT 25;
COMMENT ON COLUMN public.config_global.agente_cierre_cap IS 'DGG-222: tope de cierres por corrida del agente (seguridad).';

-- RPC del bot (clon fiel de tracking_cerrar, guard relajado, actor bot) ---------
CREATE OR REPLACE FUNCTION public.tracking_cerrar_auto(
  p_tramite_id uuid, p_motivo_cierre text, p_satisfactorio boolean, p_observaciones text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $$
DECLARE
  v_descripcion text;
  v_estado_linea text;
BEGIN
  IF NOT (private.is_staff() OR (auth.uid() IS NULL AND COALESCE(auth.role(),'') <> 'anon')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_motivo_cierre IS NULL OR length(trim(p_motivo_cierre)) = 0 THEN
    RAISE EXCEPTION 'El motivo de cierre es obligatorio' USING ERRCODE = '23502';
  END IF;
  IF p_satisfactorio IS NULL THEN
    RAISE EXCEPTION 'Debés indicar si el cierre fue satisfactorio' USING ERRCODE = '23502';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tramites WHERE id = p_tramite_id) THEN
    RAISE EXCEPTION 'Trámite no encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- El trigger trg_tramite_cerrar_exige_cobrado (amortiguador) es la barrera final.
  -- resuelto_por NO se toca → se mantiene el humano que resolvió.
  UPDATE public.tramites
    SET estado = 'cerrado',
        fecha_fin = CURRENT_DATE,
        motivo_cierre = p_motivo_cierre,
        cierre_satisfactorio = p_satisfactorio,
        resuelto_at = COALESCE(resuelto_at, now()),
        ultima_actividad_at = now()
   WHERE id = p_tramite_id;

  v_descripcion := 'Trámite cerrado: ' || p_motivo_cierre || '.';
  IF p_observaciones IS NOT NULL AND length(trim(p_observaciones)) > 0 THEN
    v_descripcion := v_descripcion || ' ' || trim(p_observaciones);
  END IF;
  v_estado_linea := CASE WHEN p_satisfactorio THEN 'finalizado' ELSE 'frustrado' END;

  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, estado_asociado, archivos_urls, autor_id, visible_cliente
  ) VALUES (
    p_tramite_id,
    CASE WHEN p_satisfactorio THEN 'certificado_emitido' ELSE 'cierre_frustrado' END,
    v_descripcion, v_estado_linea, '{}'::text[], NULL, true
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tracking_cerrar_auto(uuid,text,boolean,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.tracking_cerrar_auto(uuid,text,boolean,text) TO authenticated, service_role;

-- detectar v3 (frescura + anclaje + objeto cierre) ----------------------------
CREATE OR REPLACE FUNCTION private.agente_cierre_detectar()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
WITH cand AS (
  SELECT t.id AS tramite_id, t.categoria, t.servicio_id, sv.codigo AS servicio_codigo,
         t.administracion_id, t.comprobante_id,
         t.created_at, (now()::date - t.created_at::date) AS dias_abierto,
         sv.nombre AS servicio, a.nombre AS cliente,
         a.legajo_rpac AS legajo, a.matricula_rpac AS matricula,
         a.matricula_rpac_vencimiento AS venc_ficha,
         public.cobro_pendiente(t) AS impago,
         (EXISTS (SELECT 1 FROM public.servicios s2 WHERE s2.id=t.servicio_id
                    AND GREATEST(COALESCE(s2.precio_publico,0),COALESCE(s2.precio_cliente,0),COALESCE(s2.precio_base,0))>0)
          AND NOT EXISTS (SELECT 1 FROM public.comprobantes c WHERE c.estado<>'anulado' AND COALESCE(c.total,0)>0
                    AND (c.id=t.comprobante_id
                         OR c.id IN (SELECT so.comprobante_id FROM public.solicitudes so
                                      WHERE so.tramite_id=t.id AND so.comprobante_id IS NOT NULL)))
         ) AS arancelado_sin_comp,
         (t.categoria IN ('matricula','renovacion')
          AND NOT (NULLIF(btrim(a.matricula_rpac),'') IS NOT NULL
                   AND NULLIF(btrim(a.legajo_rpac),'') IS NOT NULL)) AS sin_otorg,
         CASE sv.codigo
           WHEN 'rpac_inscripcion'          THEN 'ADMINISTRADOR DE CONSORCIOS'
           WHEN 'rpac_inscripcion_juridica' THEN 'ADMINISTRADOR DE CONSORCIOS'
           WHEN 'rpac_renovacion'           THEN 'RENOVACION DE MATRICULA'
           WHEN 'rpac_certificado'          THEN 'CERTIFICADO DE ACREDITACION'
           ELSE NULL END AS exp_esperado,
         CASE sv.codigo
           WHEN 'rpac_certificado'          THEN 'NOTIFICADO OFICIOS'
           WHEN 'rpac_inscripcion'          THEN 'INSCRIPTO'
           WHEN 'rpac_inscripcion_juridica' THEN 'INSCRIPTO'
           WHEN 'rpac_renovacion'           THEN 'INSCRIPTO'
           ELSE NULL END AS estado_ok
  FROM public.tramites t
  JOIN public.administraciones a ON a.id = t.administracion_id
  LEFT JOIN public.servicios sv ON sv.id = t.servicio_id
  WHERE t.estado = 'resuelto'
    AND (now() - t.created_at) > interval '25 days'
    AND t.categoria NOT IN ('curso','consulta_juridica')
),
tx AS (
  SELECT c.tramite_id, (tc.legajo IS NOT NULL) AS tiene_cache, tc.consultado_at,
    (SELECT jsonb_build_object('estado', e->>'estado', 'tramite', e->>'tramite', 'fecha', e->>'fecha', 'numero', e->>'numero')
       FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(tc.payload->'expedientes')='array'
                   THEN tc.payload->'expedientes' ELSE '[]'::jsonb END) e
      WHERE c.exp_esperado IS NOT NULL AND e->>'tramite' = c.exp_esperado
      ORDER BY private.tramix_fecha(e->>'fecha') DESC NULLS LAST, (e->>'numero') DESC NULLS LAST
      LIMIT 1) AS ult
  FROM cand c
  LEFT JOIN public.tramix_cache tc ON tc.legajo = c.legajo
),
ev AS (
  SELECT c.*, x.tiene_cache, x.consultado_at, x.ult,
    (x.ult->>'estado' = c.estado_ok) AS estado_confirma,
    (x.consultado_at IS NOT NULL AND x.consultado_at >= c.created_at) AS fresco,
    -- ANCLAJE (§6-A): el expediente confirmante debe ser del CICLO ACTUAL (posterior
    -- a la apertura del trámite, 7d de gracia por desfasaje de tiempos), NO uno de un
    -- ciclo anterior. La ventana previa (created_at-180d) era laxa y daba falso
    -- positivo en servicios repetibles (cert/renovación): p.ej. Coppari se cerraría
    -- citando un certificado emitido 128d ANTES de que el trámite existiera.
    (private.tramix_fecha(x.ult->>'fecha') IS NOT NULL
       AND private.tramix_fecha(x.ult->>'fecha') BETWEEN (c.created_at::date - 7) AND (now()::date + 7)) AS anclado
  FROM cand c JOIN tx x ON x.tramite_id=c.tramite_id
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'tramite_id', tramite_id, 'categoria', categoria, 'servicio', servicio,
  'servicio_codigo', servicio_codigo, 'cliente', cliente,
  'administracion_id', administracion_id, 'legajo', legajo,
  'matricula', matricula, 'venc_ficha', venc_ficha, 'dias_abierto', dias_abierto,
  'bloqueos', (
      (CASE WHEN impago THEN jsonb_build_array('impago') ELSE '[]'::jsonb END)
   || (CASE WHEN arancelado_sin_comp THEN jsonb_build_array('arancelado_sin_comprobante') ELSE '[]'::jsonb END)
   || (CASE WHEN sin_otorg THEN jsonb_build_array('sin_otorgamiento') ELSE '[]'::jsonb END)),
  'tramix', CASE WHEN exp_esperado IS NULL THEN jsonb_build_object('estado','servicio_no_mapeado')
                 WHEN NOT tiene_cache THEN jsonb_build_object('estado','sin_cache')
                 WHEN ult IS NULL THEN jsonb_build_object('estado','sin_expediente')
                 ELSE ult || jsonb_build_object('fresco',fresco,'anclado',anclado) END,
  'decision', CASE
     WHEN impago OR arancelado_sin_comp OR sin_otorg THEN 'reportar_bloqueo'
     WHEN exp_esperado IS NOT NULL AND tiene_cache AND estado_confirma AND fresco AND anclado THEN 'cerrar_limpio'
     ELSE 'reportar_revision' END,
  'cierre', CASE WHEN NOT(impago OR arancelado_sin_comp OR sin_otorg)
                   AND exp_esperado IS NOT NULL AND tiene_cache AND estado_confirma AND fresco AND anclado
    THEN jsonb_build_object(
      'satisfactorio', true,
      'motivo', CASE servicio_codigo WHEN 'rpac_certificado' THEN 'Certificado de acreditación emitido'
                                     WHEN 'rpac_renovacion' THEN 'Matrícula renovada'
                                     ELSE 'Matrícula otorgada' END,
      'observaciones', 'Verificamos en la Mesa de Entradas (RPAC · Pcia. de Bs. As.) que tu '||
        CASE servicio_codigo WHEN 'rpac_certificado' THEN 'Certificado de Acreditación fue EMITIDO'
                             WHEN 'rpac_renovacion' THEN 'renovación de matrícula fue OTORGADA'
                             ELSE 'matrícula fue OTORGADA' END ||
        ' el '||COALESCE(ult->>'fecha','')||'. El RPAC te lo notifica por correo a tu casilla declarada; '||
        'además podés consultarlo desde nuestro acceso a la Mesa de Entradas, en tu portal. '||
        '¡Gracias por confiar en Gestión Global! Quedamos a disposición para seguir trabajando juntos.')
    ELSE NULL END,
  'motivo', CASE
     WHEN impago THEN 'Cobro pendiente (impago/parcial)'
     WHEN arancelado_sin_comp THEN 'Servicio arancelado sin comprobante emitido'
     WHEN sin_otorg THEN 'Falta matrícula+legajo RPAC en la ficha (cargar otorgamiento)'
     WHEN exp_esperado IS NULL THEN 'Servicio sin regla TRAMIX definida — revisar manual'
     WHEN NOT tiene_cache THEN 'Sin verificación TRAMIX (falta scrapear el legajo)'
     WHEN ult IS NULL THEN 'TRAMIX sin expediente de '||exp_esperado
     WHEN NOT estado_confirma AND ult->>'estado'='OBSERVADO' THEN 'TRAMIX: '||exp_esperado||' OBSERVADO — revisar'
     WHEN NOT estado_confirma THEN 'TRAMIX: '||exp_esperado||' en estado "'||(ult->>'estado')||'" (no terminal) — revisar'
     WHEN NOT fresco THEN 'TRAMIX confirmado pero el cache es anterior a la apertura del trámite — re-scrapear antes de cerrar'
     WHEN NOT anclado THEN 'TRAMIX: el expediente confirmante es de un ciclo anterior (fecha previa a la apertura) — revisar manual'
     ELSE 'TRAMIX confirma '||exp_esperado||' = '||estado_ok||' → cerrable' END
) ORDER BY
     (CASE WHEN impago OR arancelado_sin_comp OR sin_otorg THEN 2
           WHEN exp_esperado IS NOT NULL AND tiene_cache AND estado_confirma AND fresco AND anclado THEN 0 ELSE 1 END),
     cliente), '[]'::jsonb)
FROM ev;
$$;
REVOKE EXECUTE ON FUNCTION private.agente_cierre_detectar() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION private.agente_cierre_detectar() TO service_role;

-- correr v2.1 (modo real gated + GUC tenencia de confianza) --------------------
CREATE OR REPLACE FUNCTION public.agente_cierre_correr(p_origen text DEFAULT 'manual')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp SET "TimeZone" TO 'America/Argentina/Buenos_Aires' AS $$
DECLARE
  v_items jsonb; v_total int; v_limpios int; v_bloqueos int; v_revision int;
  v_resumen jsonb; v_run_id uuid; v_modo text; v_activo boolean; v_cap int;
  v_cerrados int := 0; v_errores jsonb := '[]'::jsonb; v_it jsonb; v_err_txt text;
  v_hoy text := to_char((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, 'DD/MM/YYYY');
  v_lista text; v_cuerpo text; v_titulo text;
BEGIN
  IF NOT (private.is_staff() OR (auth.uid() IS NULL AND COALESCE(auth.role(),'') <> 'anon')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Contexto de confianza: el bot cierra trámites que detectó y avisa a SUS clientes.
  -- Habilita la tenencia para los encolar_email downstream en cualquier path. SET LOCAL.
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
     'cerrados', v_cerrados, 'errores_cierre', jsonb_array_length(v_errores), 'cap', v_cap);

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
             E'\n' ORDER BY e->>'decision', e->>'cliente')
      INTO v_lista FROM jsonb_array_elements(v_items) e;

    v_titulo := CASE WHEN v_modo='real' THEN 'Resumen de agentes · Cierre de trámites'
                     ELSE 'Resumen de agentes · Cierre de trámites (SIMULACIÓN)' END;
    v_cuerpo :=
      CASE WHEN v_modo='real' THEN 'Equipo de cierre de trámites · ' || v_hoy || E'\n' ||
             'Cerré ' || v_cerrados || ' trámite(s) y avisé a sus clientes.'
           ELSE 'SIMULACIÓN — equipo de cierre de trámites · ' || v_hoy || E'\n' ||
             '(No cerré nada ni escribí a ningún cliente.)' END || E'\n\n' ||
      'Track principal (resueltos +25 días, excluye cursos y jurídica): ' || v_total || ' trámites.' || E'\n' ||
      CASE WHEN v_modo='real'
        THEN '  Cerrados: ' || v_cerrados || (CASE WHEN jsonb_array_length(v_errores)>0 THEN ' · No se pudo cerrar: '||jsonb_array_length(v_errores) ELSE '' END) || E'\n'
        ELSE '  Cerraría (limpios + TRAMIX confirma): ' || v_limpios || E'\n' END ||
      '  A revisar: ' || v_revision || E'\n' ||
      '  Bloqueados (amortiguador, no se fuerzan): ' || v_bloqueos || E'\n\n' ||
      COALESCE(v_lista, '(sin candidatos)') ||
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
$$;
REVOKE EXECUTE ON FUNCTION public.agente_cierre_correr(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.agente_cierre_correr(text) TO authenticated, service_role;
