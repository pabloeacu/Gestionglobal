-- 0596_dgg231_supersede_fresco.sql
-- =====================================================================
-- DGG-231 · corrección del guard de supersede de la renovación declarada.
--
-- 0595 ató el "¿la oficial cubre a la declarada?" a la CERTEZA del venc de
-- matrícula (='confirmado'). Eso cierra el hueco #2 (vía form-confirm sin TRAMIX)
-- pero deja una ventana de DOBLE AVISO: si el cliente declaró una fecha FUTURA
-- (certeza='declarado') y existe un scrape TRAMIX fresco que NO pisa esa fecha
-- futura (regla DGG-226 "no pisar fecha futura declarada"), entonces la oficial
-- renovacion_rpac SÍ avisa (TRAMIX fresco) Y la declarada también → 2 avisos.
--
-- Fix: la oficial "cubre" a la declarada SÓLO si realmente va a avisar =
--   existe una fila renovacion_rpac vigente/vencida  AND  TRAMIX está fresco
--   (si no hay TRAMIX fresco, el blindaje DGG-226 la silencia → la declarada
--   debe avisar, voz "según tus datos"). Una renovación EN CURSO con GG también
--   la suprime (B4). Espeja exactamente cuándo el planificador emite la oficial,
--   sin tocar el blindaje. Los casos gerencia/TRAMIX-confirmado ya los bloquea
--   el chequeo de certeza del calc (v_cert='confirmado' → no materializa).
-- Ver DGG-231 · doble auditoría §6 (hallazgos A2/B4).
-- =====================================================================

CREATE OR REPLACE FUNCTION private.perfil_declarado_sync_venc(p_admin uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v jsonb;
  v_no_req jsonb;
  r record;
  v_renov_en_curso boolean;   -- B4: trámite de renovación abierto con GG
BEGIN
  v := private.perfil_regulatorio_calc(p_admin);
  v_no_req := COALESCE(v->'no_requiere', '{}'::jsonb);

  v_renov_en_curso := EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.administracion_id = p_admin
      AND t.categoria = 'renovacion'
      AND t.estado IN ('abierto','en_progreso','esperando_cliente'));

  FOR r IN
    SELECT * FROM (VALUES
      ('renovacion_matricula_declarada'::text, 'proxima_renovacion'::text, 'renovacion'::text,          ARRAY['renovacion_rpac']::text[]),
      ('ddjj_anual_declarada',                 'proxima_ddjj',             'ddjj',                       ARRAY['ddjj_anual']::text[]),
      ('curso_actualizacion_declarado',        'proximo_curso_actualizacion', 'curso_actualizacion',     ARRAY['curso_actualizacion','curso_rpa_caba']::text[]),
      ('certificado_declarado',                'proximo_certificado',      'certificado',                ARRAY[]::text[])
    ) AS t(tipo_dec, calc_key, no_req_key, oficiales)
  LOOP
    DECLARE
      v_fecha   date    := NULLIF(v -> r.calc_key ->> 'fecha', '')::date;
      v_cert    text    := v -> r.calc_key ->> 'certeza';
      v_optout  boolean := (v_no_req ? r.no_req_key);
      v_oficial boolean;
      v_debe    boolean;
    BEGIN
      -- cobertura autoritativa genérica (ddjj / curso)
      v_oficial := (array_length(r.oficiales, 1) IS NOT NULL) AND EXISTS (
        SELECT 1 FROM public.vencimientos w
        WHERE w.administracion_id = p_admin AND w.tipo = ANY(r.oficiales)
          AND w.estado IN ('vigente','vencido'));

      IF r.tipo_dec = 'renovacion_matricula_declarada' THEN
        -- A2 + B4: la oficial cubre a la declarada SÓLO si realmente va a avisar
        -- (existe + TRAMIX fresco), o si hay una renovación en curso con GG.
        -- Si la oficial está gateada por DGG-226 (sin TRAMIX fresco), la declarada
        -- avisa con voz "según tus datos" (cierra el hueco #2). Sin doble aviso.
        v_oficial := v_renov_en_curso
                     OR (v_oficial AND private.gg_venc_tramix_fresco(p_admin));
      END IF;

      v_debe := v_cert IN ('declarado','inferido')
                AND v_fecha IS NOT NULL
                AND NOT v_optout
                AND NOT v_oficial;

      IF v_debe THEN
        UPDATE public.vencimientos
           SET estado = 'renovado'
         WHERE administracion_id = p_admin AND tipo = r.tipo_dec
           AND estado IN ('vigente','vencido') AND fecha_vencimiento <> v_fecha;
        INSERT INTO public.vencimientos
          (tipo, sujeto, sujeto_id, administracion_id, fecha_vencimiento, fecha_emision,
           descripcion, estado, origen, alarmas_offsets, notificar_cliente)
        SELECT r.tipo_dec, 'administracion', p_admin, p_admin, v_fecha,
               (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
               'Recordatorio según datos declarados por el cliente', 'vigente',
               'declarado', '{45,30,15,0,-7,-21}'::int[], true
        WHERE NOT EXISTS (
          SELECT 1 FROM public.vencimientos w
          WHERE w.administracion_id = p_admin AND w.tipo = r.tipo_dec
            AND w.estado IN ('vigente','vencido') AND w.fecha_vencimiento = v_fecha);
      ELSE
        UPDATE public.vencimientos
           SET estado = 'renovado'
         WHERE administracion_id = p_admin AND tipo = r.tipo_dec
           AND estado IN ('vigente','vencido');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'perfil_declarado_sync_venc obligacion % admin %: %', r.tipo_dec, p_admin, SQLERRM;
    END;
  END LOOP;
END $function$;
