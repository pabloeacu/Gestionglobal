-- 0594_dgg231_avisos_declarados.sql
-- =====================================================================
-- DGG-231 · Las fechas que el cliente DECLARA voluntariamente en su
-- perfil regulatorio generan recordatorios de vencimiento.
--
-- Principio (Pablo): si el cliente carga sus fechas, le avisamos de sus
-- vencimientos. TRAMIX deja de ser un PEAJE y pasa a ser un UPGRADE: el
-- aviso sale igual sobre el dato declarado; el dato autoritativo (TRAMIX /
-- gerencia / trámite) SIEMPRE lo pisa (supersede), sin doble aviso.
--
-- Decisión arquitectónica (máxima delicadeza): NO tocar el motor de
-- ofrecimientos, ni el blindaje DGG-226, ni las alarmas de servicios
-- contratados. Se AGREGAN tipos de vencimiento DECLARADOS (`*_declarada/o`,
-- origen='declarado') que:
--   - el mismo `dispatch-vencimientos` ya existente envía (reuso de cañería);
--   - el planificador `gg_vencimientos_planificar_alertas` devuelve sin gate
--     (las dos exclusiones aplican SÓLO a tipo='renovacion_rpac' — verificado);
--   - `perfil_regulatorio_calc` NO lee (así lo declarado sigue 'declarado' en
--     la ficha, sin falsear la certeza);
--   - `gg_admin_prox_venc_matricula` (motor ofrecimientos) NO ve (filtra
--     'renovacion_rpac').
-- El supersede se maneja por la certeza que ya calcula `perfil_regulatorio_calc`
-- + un guard de "no existe fila autoritativa" → imposible doble notificación.
--
-- Ver DGG-231 (DECISIONES) · auditoría previa (workflow) · E-GG (si surge bug).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Extender el CHECK de vencimientos.tipo con los 4 tipos declarados
-- ---------------------------------------------------------------------
ALTER TABLE public.vencimientos DROP CONSTRAINT vencimientos_tipo_check;
ALTER TABLE public.vencimientos ADD CONSTRAINT vencimientos_tipo_check
  CHECK (tipo = ANY (ARRAY[
    'renovacion_rpac','curso_actualizacion','ddjj_anual','curso_rpa_caba','otro',
    'renovacion_matricula_declarada','ddjj_anual_declarada',
    'curso_actualizacion_declarado','certificado_declarado'
  ]::text[]));

COMMENT ON COLUMN public.vencimientos.origen IS
  'Fuente de la fila. ''gestion_global'' (default), motor de ofrecimientos, '
  'o ''declarado'' (DGG-231: fecha que el cliente cargó en su perfil '
  'regulatorio; recordatorio con voz "según sus datos", superseded por el '
  'dato autoritativo).';

-- ---------------------------------------------------------------------
-- 2. perfil_regulatorio_calc: exponer `fuente` en proxima_renovacion
--    (para distinguir badge "TRAMIX" vs "Verificado" en el front).
--    CREATE OR REPLACE — misma firma (R16 ok, sin overload).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.perfil_regulatorio_calc(p_administracion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  a record; d record;
  v_matriculado_conf boolean; v_matriculado boolean;
  v_mat_fecha date; v_mat_fecha_cert public.certeza_dato;
  v_mat_nro text; v_mat_nro_cert public.certeza_dato;
  v_legajo_nro text; v_legajo_cert public.certeza_dato;
  v_ult_renov date; v_ult_renov_cert public.certeza_dato;
  v_prox_renov date; v_prox_renov_cert public.certeza_dato;
  v_ult_curso date; v_ult_curso_cert public.certeza_dato;
  v_prox_curso date; v_prox_curso_cert public.certeza_dato;
  v_ult_ddjj date; v_ult_ddjj_cert public.certeza_dato;
  v_prox_ddjj date; v_prox_ddjj_cert public.certeza_dato;
  v_ult_cert date; v_ult_cert_cert public.certeza_dato;
  v_prox_cert date; v_prox_cert_cert public.certeza_dato;
  v_ult_cons date; v_ult_cons_cert public.certeza_dato;
  v_matric_cert public.certeza_dato;
  v_jur text;
  v_conf int := 0; v_total int := 9;
  v_venc_renov date; v_venc_ddjj date; v_venc_curso date;
  v_venc_cert public.certeza_dato;
  v_fuente_renov text;  -- DGG-231: 'tramix' | 'gestion' | NULL
BEGIN
  SELECT id, matricula_rpac, matricula_rpac_fecha, matricula_rpac_vencimiento,
         matricula_rpa, matricula_rpa_fecha, matricula_rpa_vencimiento, legajo_rpac,
         matricula_rpac_vencimiento_certeza, matricula_rpac_vencimiento_origen
    INTO a FROM public.administraciones WHERE id = p_administracion_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Administración inexistente' USING ERRCODE='P0002'; END IF;
  SELECT * INTO d FROM public.perfil_regulatorio WHERE administracion_id = p_administracion_id;
  v_venc_cert := COALESCE(a.matricula_rpac_vencimiento_certeza, 'confirmado');
  SELECT min(fecha_vencimiento) INTO v_venc_renov FROM public.vencimientos
    WHERE administracion_id=p_administracion_id AND tipo='renovacion_rpac' AND estado='vigente' AND fecha_vencimiento>=CURRENT_DATE;
  SELECT min(fecha_vencimiento) INTO v_venc_ddjj FROM public.vencimientos
    WHERE administracion_id=p_administracion_id AND tipo='ddjj_anual' AND estado='vigente' AND fecha_vencimiento>=CURRENT_DATE;
  SELECT min(fecha_vencimiento) INTO v_venc_curso FROM public.vencimientos
    WHERE administracion_id=p_administracion_id AND tipo IN ('curso_actualizacion','curso_rpa_caba') AND estado='vigente' AND fecha_vencimiento>=CURRENT_DATE;
  v_jur := CASE WHEN a.matricula_rpac IS NOT NULL THEN 'rpac'
                WHEN a.matricula_rpa IS NOT NULL THEN 'rpa' ELSE d.jurisdiccion END;
  v_matriculado_conf := (a.matricula_rpac IS NOT NULL OR a.matricula_rpa IS NOT NULL) OR EXISTS (
    SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado IN ('resuelto','cerrado')
      AND t.cierre_satisfactorio IS NOT FALSE
      AND s.codigo IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion'));
  IF v_matriculado_conf THEN v_matriculado := true; v_matric_cert := 'confirmado';
  ELSIF d.matricula_fecha_declarada IS NOT NULL THEN v_matriculado := true; v_matric_cert := 'declarado';
  ELSE v_matriculado := false; v_matric_cert := 'desconocido'; END IF;
  v_mat_nro := COALESCE(a.matricula_rpac, a.matricula_rpa, d.matricula_nro_declarada);
  v_mat_nro_cert := CASE WHEN a.matricula_rpac IS NOT NULL OR a.matricula_rpa IS NOT NULL THEN 'confirmado'
                         WHEN d.matricula_nro_declarada IS NOT NULL THEN 'declarado' ELSE 'desconocido' END;
  v_mat_fecha := COALESCE(a.matricula_rpac_fecha, a.matricula_rpa_fecha, d.matricula_fecha_declarada);
  v_mat_fecha_cert := CASE WHEN a.matricula_rpac_fecha IS NOT NULL OR a.matricula_rpa_fecha IS NOT NULL THEN 'confirmado'
                           WHEN d.matricula_fecha_declarada IS NOT NULL THEN 'declarado' ELSE 'desconocido' END;
  v_legajo_nro := COALESCE(a.legajo_rpac, d.legajo_nro_declarado);
  v_legajo_cert := CASE WHEN a.legajo_rpac IS NOT NULL THEN 'confirmado'
                        WHEN d.legajo_nro_declarado IS NOT NULL THEN 'declarado' ELSE 'desconocido' END;
  SELECT max(COALESCE(t.fecha_fin, t.resuelto_at::date)) INTO v_ult_renov
    FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado IN ('resuelto','cerrado')
      AND t.cierre_satisfactorio IS NOT FALSE AND s.codigo='rpac_renovacion';
  IF v_ult_renov IS NOT NULL THEN v_ult_renov_cert := 'confirmado';
  ELSIF d.ultima_renovacion_declarada IS NOT NULL THEN v_ult_renov := d.ultima_renovacion_declarada; v_ult_renov_cert := 'declarado';
  ELSE v_ult_renov_cert := 'desconocido'; END IF;
  IF v_venc_renov IS NOT NULL THEN v_prox_renov := v_venc_renov; v_prox_renov_cert := v_venc_cert;
  ELSIF a.matricula_rpac_vencimiento IS NOT NULL THEN v_prox_renov := a.matricula_rpac_vencimiento; v_prox_renov_cert := v_venc_cert;
  ELSIF a.matricula_rpa_vencimiento IS NOT NULL THEN v_prox_renov := a.matricula_rpa_vencimiento; v_prox_renov_cert := 'confirmado';
  ELSIF v_ult_renov IS NOT NULL THEN v_prox_renov := (v_ult_renov + interval '12 months')::date; v_prox_renov_cert := 'inferido';
  ELSIF v_mat_fecha IS NOT NULL THEN v_prox_renov := (v_mat_fecha + interval '12 months')::date; v_prox_renov_cert := 'inferido';
  ELSE v_prox_renov_cert := 'desconocido'; END IF;
  -- DGG-231: fuente de la próxima renovación (sólo significativa si está confirmada)
  v_fuente_renov := CASE
    WHEN v_prox_renov_cert = 'confirmado' AND a.matricula_rpac_vencimiento_origen IN ('oficial_tramix','verificado_tramix') THEN 'tramix'
    WHEN v_prox_renov_cert = 'confirmado' THEN 'gestion'
    ELSE NULL END;
  SELECT max(COALESCE(t.fecha_fin, t.resuelto_at::date)) INTO v_ult_curso
    FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado IN ('resuelto','cerrado')
      AND t.cierre_satisfactorio IS NOT FALSE AND s.codigo IN ('curso_actualizacion_rpac','rpa_actualizacion');
  IF v_ult_curso IS NOT NULL THEN v_ult_curso_cert := 'confirmado';
  ELSIF d.ultimo_curso_actualizacion_declarado IS NOT NULL THEN v_ult_curso := d.ultimo_curso_actualizacion_declarado; v_ult_curso_cert := 'declarado';
  ELSE v_ult_curso_cert := 'desconocido'; END IF;
  IF v_venc_curso IS NOT NULL THEN v_prox_curso := v_venc_curso; v_prox_curso_cert := 'confirmado';
  ELSIF v_ult_curso IS NOT NULL THEN v_prox_curso := (v_ult_curso + interval '12 months')::date; v_prox_curso_cert := 'inferido';
  ELSE v_prox_curso_cert := 'desconocido'; END IF;
  SELECT max(COALESCE(t.fecha_fin, t.resuelto_at::date)) INTO v_ult_ddjj
    FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado IN ('resuelto','cerrado')
      AND t.cierre_satisfactorio IS NOT FALSE AND s.codigo='rpac_ddjj';
  IF v_ult_ddjj IS NOT NULL THEN v_ult_ddjj_cert := 'confirmado';
  ELSIF d.ultima_ddjj_declarada IS NOT NULL THEN v_ult_ddjj := d.ultima_ddjj_declarada; v_ult_ddjj_cert := 'declarado';
  ELSE v_ult_ddjj_cert := 'desconocido'; END IF;
  IF v_venc_ddjj IS NOT NULL THEN
    v_prox_ddjj := v_venc_ddjj; v_prox_ddjj_cert := 'confirmado';
  ELSIF v_matriculado AND v_jur = 'rpac' THEN
    IF make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 3, 31) >= CURRENT_DATE THEN
      v_prox_ddjj := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 3, 31);
    ELSE
      v_prox_ddjj := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int + 1, 3, 31);
    END IF;
    IF v_ult_ddjj IS NOT NULL AND v_ult_ddjj >= (v_prox_ddjj - interval '1 year')::date THEN
      v_prox_ddjj := (v_prox_ddjj + interval '1 year')::date;
    END IF;
    v_prox_ddjj_cert := 'inferido';
  ELSE v_prox_ddjj_cert := 'desconocido'; END IF;
  SELECT max(COALESCE(t.fecha_fin, t.resuelto_at::date)) INTO v_ult_cert
    FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado IN ('resuelto','cerrado')
      AND t.cierre_satisfactorio IS NOT FALSE AND s.codigo='rpac_certificado';
  IF v_ult_cert IS NOT NULL THEN v_ult_cert_cert := 'confirmado';
  ELSIF d.ultimo_certificado_declarado IS NOT NULL THEN v_ult_cert := d.ultimo_certificado_declarado; v_ult_cert_cert := 'declarado';
  ELSE v_ult_cert_cert := 'desconocido'; END IF;
  IF v_ult_cert IS NOT NULL THEN v_prox_cert := (v_ult_cert + interval '3 months')::date; v_prox_cert_cert := 'inferido';
  ELSE v_prox_cert_cert := 'desconocido'; END IF;
  SELECT max(COALESCE(t.fecha_fin, t.resuelto_at::date)) INTO v_ult_cons
    FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado IN ('resuelto','cerrado')
      AND t.cierre_satisfactorio IS NOT FALSE AND s.codigo='juridico_consulta';
  IF v_ult_cons IS NOT NULL THEN v_ult_cons_cert := 'confirmado';
  ELSIF d.ultima_consultoria_declarada IS NOT NULL THEN v_ult_cons := d.ultima_consultoria_declarada; v_ult_cons_cert := 'declarado';
  ELSE v_ult_cons_cert := 'desconocido'; END IF;
  v_conf :=
    (v_matric_cert IN ('confirmado','declarado'))::int
    + (v_mat_fecha_cert IN ('confirmado','declarado'))::int
    + (v_legajo_cert IN ('confirmado','declarado'))::int
    + (v_jur IS NOT NULL)::int
    + (v_ult_renov_cert IN ('confirmado','declarado'))::int
    + (v_ult_curso_cert IN ('confirmado','declarado'))::int
    + (v_ult_ddjj_cert IN ('confirmado','declarado'))::int
    + (v_ult_cert_cert IN ('confirmado','declarado'))::int
    + (v_ult_cons_cert IN ('confirmado','declarado'))::int;
  RETURN jsonb_build_object(
    'administracion_id', p_administracion_id, 'jurisdiccion', v_jur,
    'matriculado', jsonb_build_object('valor', v_matriculado, 'certeza', v_matric_cert),
    'matricula', jsonb_build_object('nro', v_mat_nro, 'nro_certeza', v_mat_nro_cert, 'fecha', v_mat_fecha, 'fecha_certeza', v_mat_fecha_cert),
    'legajo', jsonb_build_object('nro', v_legajo_nro, 'nro_certeza', v_legajo_cert),
    'ultima_renovacion', jsonb_build_object('fecha', v_ult_renov, 'certeza', v_ult_renov_cert),
    'proxima_renovacion', jsonb_build_object('fecha', v_prox_renov, 'certeza', v_prox_renov_cert, 'fuente', v_fuente_renov),
    'ultimo_curso_actualizacion', jsonb_build_object('fecha', v_ult_curso, 'certeza', v_ult_curso_cert),
    'proximo_curso_actualizacion', jsonb_build_object('fecha', v_prox_curso, 'certeza', v_prox_curso_cert),
    'ultima_ddjj', jsonb_build_object('fecha', v_ult_ddjj, 'certeza', v_ult_ddjj_cert),
    'proxima_ddjj', jsonb_build_object('fecha', v_prox_ddjj, 'certeza', v_prox_ddjj_cert),
    'ultimo_certificado', jsonb_build_object('fecha', v_ult_cert, 'certeza', v_ult_cert_cert),
    'proximo_certificado', jsonb_build_object('fecha', v_prox_cert, 'certeza', v_prox_cert_cert),
    'ultima_consultoria', jsonb_build_object('fecha', v_ult_cons, 'certeza', v_ult_cons_cert),
    'no_requiere', COALESCE(d.no_requiere, '{}'::jsonb),
    'completitud_pct', round(100.0 * v_conf / v_total)::int, 'generated_at', now());
END $function$;

-- ---------------------------------------------------------------------
-- 3. Materializador: refleja las próximas obligaciones DECLARADAS del
--    perfil regulatorio en filas de `vencimientos` (origen='declarado'),
--    o las retira cuando el dato autoritativo las pisa / se opta out.
--    SECURITY DEFINER (R17: escribe tabla RLS con policy de write staff).
-- ---------------------------------------------------------------------
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
BEGIN
  v := private.perfil_regulatorio_calc(p_admin);
  v_no_req := COALESCE(v->'no_requiere', '{}'::jsonb);

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
      -- ¿ya existe un vencimiento AUTORITATIVO que cubre esta obligación?
      v_oficial := (array_length(r.oficiales, 1) IS NOT NULL) AND EXISTS (
        SELECT 1 FROM public.vencimientos w
        WHERE w.administracion_id = p_admin AND w.tipo = ANY(r.oficiales)
          AND w.estado IN ('vigente','vencido'));

      v_debe := v_cert IN ('declarado','inferido')
                AND v_fecha IS NOT NULL
                AND NOT v_optout
                AND NOT v_oficial;

      IF v_debe THEN
        -- supersede propio: retirar una declarada previa con OTRA fecha
        UPDATE public.vencimientos
           SET estado = 'renovado'
         WHERE administracion_id = p_admin AND tipo = r.tipo_dec
           AND estado IN ('vigente','vencido') AND fecha_vencimiento <> v_fecha;
        -- insertar la declarada vigente si no existe con esa misma fecha (idempotente)
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
        -- SUPERSEDE: el dato autoritativo tomó la posta, se optó-out, o no hay
        -- fecha → retirar cualquier declarada vigente/vencida (sin doble aviso).
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

-- ---------------------------------------------------------------------
-- 4. Materializador diario (cron) — barre todas las administraciones con
--    perfil regulatorio y sincroniza sus declaradas. Captura el rollover
--    de fechas inferidas y los supersede cuando llega lo autoritativo.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gg_perfil_declarado_materializar_diario()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE a record; v_n int := 0;
BEGIN
  FOR a IN
    SELECT pr.administracion_id
    FROM public.perfil_regulatorio pr
    JOIN public.administraciones ad ON ad.id = pr.administracion_id
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

-- ---------------------------------------------------------------------
-- 5. Hot-call: al declarar, sincronizar en caliente (aviso inmediato sin
--    esperar al cron). CREATE OR REPLACE — misma firma (R16 ok).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.perfil_regulatorio_declarar(p_administracion_id uuid, p_jurisdiccion text DEFAULT NULL::text, p_matricula_fecha date DEFAULT NULL::date, p_matricula_nro text DEFAULT NULL::text, p_legajo_nro text DEFAULT NULL::text, p_ultima_renovacion date DEFAULT NULL::date, p_ultimo_curso_actualizacion date DEFAULT NULL::date, p_ultima_ddjj date DEFAULT NULL::date, p_ultima_consultoria date DEFAULT NULL::date, p_ultimo_certificado date DEFAULT NULL::date, p_no_requiere jsonb DEFAULT NULL::jsonb, p_notas text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);
  IF p_jurisdiccion IS NOT NULL AND p_jurisdiccion NOT IN ('rpac','rpa') THEN
    RAISE EXCEPTION 'jurisdiccion inválida' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.perfil_regulatorio AS pr (
    administracion_id, jurisdiccion, matricula_fecha_declarada, matricula_nro_declarada,
    legajo_nro_declarado, ultima_renovacion_declarada, ultimo_curso_actualizacion_declarado,
    ultima_ddjj_declarada, ultima_consultoria_declarada, ultimo_certificado_declarado,
    no_requiere, notas, updated_by
  ) VALUES (
    p_administracion_id, p_jurisdiccion, p_matricula_fecha, p_matricula_nro,
    p_legajo_nro, p_ultima_renovacion, p_ultimo_curso_actualizacion,
    p_ultima_ddjj, p_ultima_consultoria, p_ultimo_certificado,
    COALESCE(p_no_requiere,'{}'::jsonb), p_notas, auth.uid()
  )
  ON CONFLICT (administracion_id) DO UPDATE SET
    jurisdiccion = COALESCE(EXCLUDED.jurisdiccion, pr.jurisdiccion),
    matricula_fecha_declarada = COALESCE(EXCLUDED.matricula_fecha_declarada, pr.matricula_fecha_declarada),
    matricula_nro_declarada = COALESCE(EXCLUDED.matricula_nro_declarada, pr.matricula_nro_declarada),
    legajo_nro_declarado = COALESCE(EXCLUDED.legajo_nro_declarado, pr.legajo_nro_declarado),
    ultima_renovacion_declarada = COALESCE(EXCLUDED.ultima_renovacion_declarada, pr.ultima_renovacion_declarada),
    ultimo_curso_actualizacion_declarado = COALESCE(EXCLUDED.ultimo_curso_actualizacion_declarado, pr.ultimo_curso_actualizacion_declarado),
    ultima_ddjj_declarada = COALESCE(EXCLUDED.ultima_ddjj_declarada, pr.ultima_ddjj_declarada),
    ultima_consultoria_declarada = COALESCE(EXCLUDED.ultima_consultoria_declarada, pr.ultima_consultoria_declarada),
    ultimo_certificado_declarado = COALESCE(EXCLUDED.ultimo_certificado_declarado, pr.ultimo_certificado_declarado),
    no_requiere = CASE WHEN p_no_requiere IS NULL THEN pr.no_requiere ELSE pr.no_requiere || p_no_requiere END,
    notas = COALESCE(EXCLUDED.notas, pr.notas),
    updated_by = auth.uid();

  -- DGG-231: reflejar las obligaciones declaradas en recordatorios al toque.
  BEGIN
    PERFORM private.perfil_declarado_sync_venc(p_administracion_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'perfil_regulatorio_declarar sync_venc admin %: %', p_administracion_id, SQLERRM;
  END;
END $function$;

-- ---------------------------------------------------------------------
-- 6. Plantilla de email (voz "según sus datos", sin "estimado"/"≈").
--    Patrón manaxer-v1 (kicker + titulo_visual + cuerpo_html_visual + CTA).
--    `frase_estado` la arma el edge (situacional: vence / vence hoy / vencida).
-- ---------------------------------------------------------------------
INSERT INTO public.email_templates
  (slug, nombre, descripcion, asunto, kicker, titulo_visual, cuerpo_html_visual,
   cta_text, cta_url, from_casilla, color_acento, firma, variables, layout_version,
   mostrar_logo, incluir_tabla_envio, body_html, activo)
VALUES (
  'vencimiento-declarado-cliente',
  'Recordatorio de vencimiento · datos declarados (cliente)',
  'DGG-231. Recordatorio de una obligación regulatoria calculada a partir de los datos que el cliente declaró en su perfil. Voz "según sus datos"; el dato oficial (TRAMIX) la supersede.',
  'Recordatorio de tu {{tipo_label}} · Gestión Global',
  'SEGÚN TUS DATOS',
  'Un recordatorio sobre tu {{tipo_label}}, {{nombre}}',
  '<p style="margin:0 0 12px;color:#1e293b;">Según los datos que cargaste en tu perfil, {{frase_estado}}.</p>'
  '<p style="margin:0 0 12px;background:#ecfeff;border-left:4px solid #0891b2;border-radius:8px;padding:12px 14px;color:#0e7490;">Si ya la gestionaste, actualizá la fecha en tu perfil y dejamos de recordártela. Si todavía no, escribinos y la resolvemos con vos.</p>'
  '<p style="margin:0;color:#475569;font-size:14px;">¿Querés que te la confirmemos oficialmente? Cargá tu legajo RPAC y la verificamos con el registro.</p>',
  'Ver mi ficha',
  'https://gestionglobal.ar/portal/mi-ficha?origen=aviso',
  'general',
  '#0891b2',
  'Equipo Gestión Global',
  '["nombre","tipo_label","fecha_vencimiento","frase_estado"]'::jsonb,
  'manaxer-v1',
  true,
  false,
  '<!-- manaxer-v1 -->',
  true
)
ON CONFLICT (slug) DO UPDATE SET
  nombre = EXCLUDED.nombre, descripcion = EXCLUDED.descripcion, asunto = EXCLUDED.asunto,
  kicker = EXCLUDED.kicker, titulo_visual = EXCLUDED.titulo_visual,
  cuerpo_html_visual = EXCLUDED.cuerpo_html_visual, cta_text = EXCLUDED.cta_text,
  cta_url = EXCLUDED.cta_url, from_casilla = EXCLUDED.from_casilla,
  color_acento = EXCLUDED.color_acento, firma = EXCLUDED.firma,
  variables = EXCLUDED.variables, layout_version = EXCLUDED.layout_version,
  mostrar_logo = EXCLUDED.mostrar_logo, incluir_tabla_envio = EXCLUDED.incluir_tabla_envio,
  body_html = EXCLUDED.body_html, activo = true, updated_at = now();

-- ---------------------------------------------------------------------
-- 7. GRANTs (R6)
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION private.perfil_declarado_sync_venc(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gg_perfil_declarado_materializar_diario() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gg_perfil_declarado_materializar_diario() TO service_role;
-- perfil_regulatorio_declarar y perfil_regulatorio_calc conservan sus grants
-- previos (CREATE OR REPLACE no los altera).

-- ---------------------------------------------------------------------
-- 8. Cron: materializar a las 11:50 UTC (antes del dispatch-vencimientos 12:00)
-- ---------------------------------------------------------------------
SELECT cron.schedule(
  'gg-perfil-declarado-materializar',
  '50 11 * * *',
  $cron$SELECT public.gg_perfil_declarado_materializar_diario();$cron$
);
