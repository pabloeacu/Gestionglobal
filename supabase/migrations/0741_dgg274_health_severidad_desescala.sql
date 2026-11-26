-- 0741 · DGG-274 / E-GG-306 — La severidad de las alertas de health se des-escala.
--
-- Bug capitalizado del banner "Alerta crítica · Cola de emails: 200 en cola (~3h
-- para drenar)" que Pablo vio el 2026-11-26: severidad CRÍTICA mostrando el TEXTO
-- de un warning ("~3h para drenar"). Causa: `health_flow_record_run` LATEABA la
-- severidad — una vez que un run devolvía 'critical', la alerta quedaba critical
-- para siempre (hasta resolverse), pero seguía sobre-escribiendo `last_error` con
-- el detail de runs posteriores (que ya eran sólo warning). Resultado: severidad y
-- texto incoherentes, y un rojo que no bajaba aunque el estado real ya fuera warning.
--
-- Fix: la severidad de una alerta abierta refleja el ÚLTIMO run (se des-escala de
-- critical→warning cuando el estado mejora, igual que ya se resolvía en 'ok'). El
-- banner poolea en vivo y se cierra en 'ok', así que no se pierde ninguna señal:
-- mientras el problema siga, la alerta sigue abierta con su severidad y texto reales
-- y COHERENTES. Esto, combinado con el chequeo carril-aware del edge (sólo vigila el
-- transaccional, no el goteo de marketing SES), elimina el falso crítico recurrente.
--
-- R16: CREATE OR REPLACE misma firma (4 params) → no crea overload.
-- R5/R17: SECURITY DEFINER (ya lo era), escribe en tablas con RLS.

CREATE OR REPLACE FUNCTION public.health_flow_record_run(
  p_overall_status text, p_duration_ms integer, p_checks jsonb, p_origen text DEFAULT 'cron'::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run_id uuid;
  v_check_key text;
  v_check jsonb;
  v_status text;
  v_detail text;
  v_alert_id uuid;
  v_alert_existing public.health_flow_alerts;
  v_gerente_id uuid;
  v_push_payload jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('gerente','superadmin')
    ) THEN
      RAISE EXCEPTION 'No tenés permisos para registrar corridas de health check'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.health_flow_runs (overall_status, duration_ms, checks, origen)
  VALUES (
    COALESCE(p_overall_status, 'ok'),
    COALESCE(p_duration_ms, 0),
    COALESCE(p_checks, '{}'::jsonb),
    COALESCE(p_origen, 'cron')
  )
  RETURNING id INTO v_run_id;

  FOR v_check_key, v_check IN SELECT * FROM jsonb_each(COALESCE(p_checks, '{}'::jsonb))
  LOOP
    v_status := v_check->>'status';
    v_detail := v_check->>'detail';

    SELECT * INTO v_alert_existing
    FROM public.health_flow_alerts
    WHERE check_key = v_check_key AND resolved_at IS NULL
    LIMIT 1;

    IF v_status IN ('warning','critical') THEN
      IF v_alert_existing.id IS NULL THEN
        INSERT INTO public.health_flow_alerts (
          check_key, severity, last_error, origen_run_id, last_seen_at
        ) VALUES (
          v_check_key, v_status, v_detail, v_run_id, now()
        )
        RETURNING id INTO v_alert_id;

        v_push_payload := jsonb_build_object(
          'title', CASE
            WHEN v_status = 'critical' THEN 'Alerta crítica en flujos del sistema'
            ELSE 'Aviso en flujos del sistema'
          END,
          'body', COALESCE(v_detail, v_check_key) || ' — revisá Salud del sistema',
          'url', '/gerencia/configuracion/salud',
          'tag', 'health-flow-' || v_check_key
        );

        FOR v_gerente_id IN
          SELECT id FROM public.profiles WHERE role IN ('gerente','superadmin')
        LOOP
          BEGIN
            PERFORM private.notif_emitir(
              p_user_id := v_gerente_id,
              p_tipo := 'sistema',
              p_titulo := v_push_payload->>'title',
              p_cuerpo := v_push_payload->>'body',
              p_url := v_push_payload->>'url',
              p_payload := v_push_payload
            );
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END;
        END LOOP;

        UPDATE public.health_flow_alerts
        SET push_dispatched_at = now()
        WHERE id = v_alert_id;

      ELSE
        -- E-GG-306: la severidad refleja el ÚLTIMO run (se des-escala critical→warning
        -- cuando el estado mejora). Antes LATEABA en critical y dejaba el texto (warning)
        -- incoherente con el rojo. El banner poolea en vivo + se cierra en 'ok', así que
        -- no se pierde la señal: mientras el problema siga, la alerta sigue abierta con
        -- severidad y texto REALES y coherentes.
        UPDATE public.health_flow_alerts
        SET last_seen_at = now(),
            last_error = v_detail,
            severity = v_status
        WHERE id = v_alert_existing.id;
      END IF;
    ELSIF v_status = 'ok' AND v_alert_existing.id IS NOT NULL THEN
      UPDATE public.health_flow_alerts
      SET resolved_at = now(), resolved_by = 'auto'
      WHERE id = v_alert_existing.id;
    END IF;
  END LOOP;

  RETURN v_run_id;
END $function$;
