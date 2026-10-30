-- 0619_dgg234_f9_certificado_reframe_dedup_jur_gate.sql
-- DGG-234 · F9 — Capitalización de la auditoría §6 del mecanismo de avisos DECLARADOS
-- (DGG-231) cruzado con la capa de jurisdicción (DGG-234). Caso disparador: Avolio
-- Mariana Edith (PBA) recibió "tu certificado de acreditación vence el 05/11/2026",
-- falso (el certificado dura 30 días; +90d es sólo la cadencia de recordatorio para
-- la próxima asamblea). Pablo confirmó las reglas de negocio. Cinco cosas en un chunk:
--
--   (1) CERTIFICADO deja de modelarse como VENCIMIENTO (decisión de Pablo). El
--       recordatorio del certificado YA lo da, bien y con cadencia de 90 días, el
--       ofrecimiento `certificado_90`/`certificado_acreditacion` (dashboard, vivo,
--       127 envíos). El vencimiento declarado era redundante y con copy falso.
--       → se saca del materializador y se retiran los certificado_declarado vivos.
--
--   (2) GATE DE JURISDICCIÓN EN EL BACKEND (defensa en profundidad). Hasta hoy el
--       único filtro de aplicabilidad por jurisdicción vivía en la UI de la ficha
--       del cliente (obligacionesVisibles). El materializador, el calc y la RPC de
--       declarar NO gateaban → un gerente podía anclar un certificado a un CABA (o
--       curso/ddjj a un Neuquén) por el drawer "Anclar datos" y salía el aviso con
--       copy PBA. Ahora: curso/ddjj = {pba,caba}; certificado = {pba}; renovación y
--       consultoría = universales.
--
--   (3) DDJJ de CABA (regla nueva, dada por Pablo — DGDyPC Disp. 2615/DGDYPC/26 art.3):
--       la DDJJ de los consorcios administrados del período anterior vence el 30/11
--       de cada año (p.ej. actividad 2025 → 30/11/2026). Antes el calc sólo inferia
--       la DDJJ para PBA (31/03) → un CABA veía la obligación en su ficha pero nunca
--       recibía recordatorio (hueco inverso). Ahora CABA infiere 30/11 y se avisa.
--
--   (4) FIN DEL CHURN + RE-NOTIFICACIÓN (bug "doble aviso" del caso Avolio). Dos fixes:
--       (a) dedup del planner por (administracion_id, tipo, fecha_vencimiento) en vez
--           de vencimiento_id → re-crear la fila con id nuevo ya no re-avisa; y
--       (b) el materializador deja de ser destructivo: actualiza IN-PLACE (id estable)
--           al cambiar la fecha, y SÓLO retira ('renovado') por razón POSITIVA (la
--           obligación ya no aplica por jurisdicción, hay dato oficial, u opt-out),
--           nunca por una ausencia transitoria de fecha/certeza (lo que mint-eaba ids
--           nuevos y disparaba el re-aviso).
--
--   (5) FUGA EN EL HOME: cliente_portal_dashboard listaba los vencimientos DECLARADOS
--       bajo "Próximos vencimientos" con el enum crudo + la descripción interna de
--       gerencia filtrada al cliente. Los declarados tienen su superficie propia
--       (ficha/agenda/banners "según tus datos"): se excluyen del card de vencimientos.
--
-- Sólo cambia cuerpos de función + retira filas (no DDL, no columnas) → no requiere
-- regen de types (D13 N/A). Firmas intactas → CREATE OR REPLACE (R16 OK). Smoke e2e
-- R18 por separado (BEGIN/DO RAISE EXCEPTION). STABLE/SECDEF/search_path preservados.
-- --------------------------------------------------------------------------

-- ==========================================================================
-- (A) perfil_regulatorio_calc — DDJJ de CABA (30/11) + gate del certificado a PBA.
--     Base: mig 0617 (F8). Único cambio: la rama de proxima_ddjj gana el caso CABA,
--     y proximo_certificado se infiere sólo para PBA. v_jur (binario) y jurisdiccion_code
--     intactos; PBA byte-idéntico (la rama v_jur='rpac' no cambia).
-- ==========================================================================
CREATE OR REPLACE FUNCTION private.perfil_regulatorio_calc(p_administracion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  a record; d record; me record;
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
  v_jur_code text;
  v_me_cert public.certeza_dato;
  v_conf int := 0; v_total int := 9;
  v_venc_renov date; v_venc_ddjj date; v_venc_curso date;
  v_venc_cert public.certeza_dato;
  v_fuente_renov text;
BEGIN
  SELECT id, matricula_rpac, matricula_rpac_fecha, matricula_rpac_vencimiento,
         matricula_rpa, matricula_rpa_fecha, matricula_rpa_vencimiento, legajo_rpac,
         matricula_rpac_vencimiento_certeza, matricula_rpac_vencimiento_origen
    INTO a FROM public.administraciones WHERE id = p_administracion_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Administración inexistente' USING ERRCODE='P0002'; END IF;
  SELECT * INTO d FROM public.perfil_regulatorio WHERE administracion_id = p_administracion_id;
  SELECT * INTO me FROM public.matricula_extra
    WHERE administracion_id = p_administracion_id ORDER BY jurisdiccion LIMIT 1;
  v_me_cert := COALESCE(me.certeza, 'declarado');

  v_venc_cert := COALESCE(a.matricula_rpac_vencimiento_certeza, 'confirmado');
  SELECT min(fecha_vencimiento) INTO v_venc_renov FROM public.vencimientos
    WHERE administracion_id=p_administracion_id AND tipo='renovacion_rpac' AND estado='vigente' AND fecha_vencimiento>=CURRENT_DATE;
  SELECT min(fecha_vencimiento) INTO v_venc_ddjj FROM public.vencimientos
    WHERE administracion_id=p_administracion_id AND tipo='ddjj_anual' AND estado='vigente' AND fecha_vencimiento>=CURRENT_DATE;
  SELECT min(fecha_vencimiento) INTO v_venc_curso FROM public.vencimientos
    WHERE administracion_id=p_administracion_id AND tipo IN ('curso_actualizacion','curso_rpa_caba') AND estado='vigente' AND fecha_vencimiento>=CURRENT_DATE;
  v_jur := CASE WHEN a.matricula_rpac IS NOT NULL THEN 'rpac'
                WHEN a.matricula_rpa IS NOT NULL THEN 'rpa'
                WHEN me.id IS NOT NULL THEN 'rpa'
                ELSE d.jurisdiccion END;
  v_jur_code := CASE WHEN a.matricula_rpac IS NOT NULL THEN 'pba'
                     WHEN a.matricula_rpa IS NOT NULL THEN 'caba'
                     WHEN me.id IS NOT NULL THEN me.jurisdiccion::text
                     ELSE CASE d.jurisdiccion WHEN 'rpac' THEN 'pba' WHEN 'rpa' THEN 'caba' ELSE NULL END
                END;
  v_matriculado_conf := (a.matricula_rpac IS NOT NULL OR a.matricula_rpa IS NOT NULL) OR EXISTS (
    SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado IN ('resuelto','cerrado')
      AND t.cierre_satisfactorio IS NOT FALSE
      AND s.codigo IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion'));
  IF v_matriculado_conf THEN v_matriculado := true; v_matric_cert := 'confirmado';
  ELSIF me.id IS NOT NULL THEN v_matriculado := true; v_matric_cert := v_me_cert;
  ELSIF d.matricula_fecha_declarada IS NOT NULL THEN v_matriculado := true; v_matric_cert := 'declarado';
  ELSE v_matriculado := false; v_matric_cert := 'desconocido'; END IF;
  v_mat_nro := COALESCE(a.matricula_rpac, a.matricula_rpa, me.matricula_nro, d.matricula_nro_declarada);
  v_mat_nro_cert := CASE WHEN a.matricula_rpac IS NOT NULL OR a.matricula_rpa IS NOT NULL THEN 'confirmado'
                         WHEN me.matricula_nro IS NOT NULL THEN v_me_cert
                         WHEN d.matricula_nro_declarada IS NOT NULL THEN 'declarado' ELSE 'desconocido' END;
  v_mat_fecha := COALESCE(a.matricula_rpac_fecha, a.matricula_rpa_fecha, me.matricula_fecha, d.matricula_fecha_declarada);
  v_mat_fecha_cert := CASE WHEN a.matricula_rpac_fecha IS NOT NULL OR a.matricula_rpa_fecha IS NOT NULL THEN 'confirmado'
                           WHEN me.matricula_fecha IS NOT NULL THEN v_me_cert
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
  ELSIF me.matricula_vencimiento IS NOT NULL THEN v_prox_renov := me.matricula_vencimiento; v_prox_renov_cert := v_me_cert;
  ELSIF v_ult_renov IS NOT NULL THEN v_prox_renov := (v_ult_renov + interval '12 months')::date; v_prox_renov_cert := 'inferido';
  ELSIF v_mat_fecha IS NOT NULL THEN v_prox_renov := (v_mat_fecha + interval '12 months')::date; v_prox_renov_cert := 'inferido';
  ELSE v_prox_renov_cert := 'desconocido'; END IF;
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
    -- PBA (RPAC): DDJJ anual, deadline 31/03 (sin cambios respecto de F8).
    IF make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 3, 31) >= CURRENT_DATE THEN
      v_prox_ddjj := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 3, 31);
    ELSE
      v_prox_ddjj := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int + 1, 3, 31);
    END IF;
    IF v_ult_ddjj IS NOT NULL AND v_ult_ddjj >= (v_prox_ddjj - interval '1 year')::date THEN
      v_prox_ddjj := (v_prox_ddjj + interval '1 year')::date;
    END IF;
    v_prox_ddjj_cert := 'inferido';
  ELSIF v_matriculado AND v_jur_code = 'caba' THEN
    -- CABA (DGDyPC · Disposición 2615/DGDYPC/26, art. 3°): la DDJJ de los consorcios
    -- administrados del período anterior vence el 30/11 de cada año (actividad 2025 →
    -- 30/11/2026). DGG-234 F9 (regla dada por Pablo). Mismo patrón que PBA, fecha 30/11.
    IF make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 11, 30) >= CURRENT_DATE THEN
      v_prox_ddjj := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 11, 30);
    ELSE
      v_prox_ddjj := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int + 1, 11, 30);
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
  -- DGG-234 F9 · el certificado YA NO se modela como "vencimiento" (dura 30 días; el
  -- recordatorio de 90 días lo da el ofrecimiento certificado_90). proximo_certificado
  -- queda sólo como SUGERENCIA (inferido) de "conviene renovar cada 90 días", y sólo
  -- para PBA (gate de jurisdicción: certificado = RPAC/PBA-only). El materializador ya
  -- no lo materializa (abajo). El front lo muestra informativo, nunca "vence el X".
  IF v_ult_cert IS NOT NULL AND v_jur_code = 'pba' THEN
    v_prox_cert := (v_ult_cert + interval '3 months')::date; v_prox_cert_cert := 'inferido';
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
    'jurisdiccion_code', v_jur_code,
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

-- ==========================================================================
-- (B) perfil_declarado_sync_venc — (1) saca el certificado; (2) gate de jurisdicción
--     por obligación; (4) id ESTABLE (update in-place) + retiro sólo por razón positiva.
-- ==========================================================================
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
  v_renov_en_curso boolean;
  v_jur public.jurisdiccion_matricula;
BEGIN
  v := private.perfil_regulatorio_calc(p_admin);
  v_no_req := COALESCE(v->'no_requiere', '{}'::jsonb);

  v_jur := COALESCE(
    (SELECT me.jurisdiccion FROM public.matricula_extra me
      WHERE me.administracion_id = p_admin ORDER BY me.jurisdiccion LIMIT 1),
    'pba');

  v_renov_en_curso := EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.administracion_id = p_admin
      AND t.categoria = 'renovacion'
      AND t.estado IN ('abierto','en_progreso','esperando_cliente'));

  -- DGG-234 F9 · el certificado SALE de esta lista (ya no es un vencimiento; su
  -- recordatorio lo da el ofrecimiento certificado_90). Cada obligación declara su
  -- `aplica_jur` (jurisdicciones donde corresponde) → se materializa/retira por eso.
  FOR r IN
    SELECT * FROM (VALUES
      ('renovacion_matricula_declarada'::text, 'proxima_renovacion'::text, 'renovacion'::text,          ARRAY['renovacion_rpac']::text[],                   ARRAY['pba','caba','neuquen']::text[]),
      ('ddjj_anual_declarada',                 'proxima_ddjj',             'ddjj',                       ARRAY['ddjj_anual']::text[],                        ARRAY['pba','caba']::text[]),
      ('curso_actualizacion_declarado',        'proximo_curso_actualizacion', 'curso_actualizacion',     ARRAY['curso_actualizacion','curso_rpa_caba']::text[], ARRAY['pba','caba']::text[])
    ) AS t(tipo_dec, calc_key, no_req_key, oficiales, aplica_jur)
  LOOP
    DECLARE
      v_fecha   date    := NULLIF(v -> r.calc_key ->> 'fecha', '')::date;
      v_cert    text    := v -> r.calc_key ->> 'certeza';
      v_optout  boolean := (v_no_req ? r.no_req_key);
      v_aplica  boolean := (v_jur::text = ANY(r.aplica_jur));
      v_oficial boolean;
      v_debe    boolean;
    BEGIN
      v_oficial := (array_length(r.oficiales, 1) IS NOT NULL) AND EXISTS (
        SELECT 1 FROM public.vencimientos w
        WHERE w.administracion_id = p_admin AND w.tipo = ANY(r.oficiales)
          AND w.estado IN ('vigente','vencido'));

      IF r.tipo_dec = 'renovacion_matricula_declarada' THEN
        v_oficial := v_renov_en_curso
                     OR (v_oficial AND private.gg_venc_tramix_fresco(p_admin));
      END IF;

      v_debe := v_aplica
                AND v_cert IN ('declarado','inferido')
                AND v_fecha IS NOT NULL
                AND NOT v_optout
                AND NOT v_oficial;

      IF v_debe THEN
        -- id ESTABLE: si ya hay una fila vigente/vencida de este tipo, se actualiza
        -- IN-PLACE a la fecha correcta (no se retira+re-inserta → no se mint-ea id
        -- nuevo → no re-avisa por un parpadeo). Si la fecha cambió de verdad, el
        -- dedup por (admin,tipo,fecha) del planner permite el re-aviso legítimo.
        UPDATE public.vencimientos
           SET fecha_vencimiento = v_fecha,
               estado            = 'vigente',
               jurisdiccion      = v_jur,
               updated_at        = now()
         WHERE administracion_id = p_admin AND tipo = r.tipo_dec
           AND estado IN ('vigente','vencido') AND fecha_vencimiento <> v_fecha;
        -- Si no existe ninguna vigente/vencida, se crea.
        INSERT INTO public.vencimientos
          (tipo, sujeto, sujeto_id, administracion_id, fecha_vencimiento, fecha_emision,
           descripcion, estado, origen, alarmas_offsets, notificar_cliente, jurisdiccion)
        SELECT r.tipo_dec, 'administracion', p_admin, p_admin, v_fecha,
               (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
               'Recordatorio según datos declarados por el cliente', 'vigente',
               'declarado', '{45,30,15,0,-7,-21}'::int[], true, v_jur
        WHERE NOT EXISTS (
          SELECT 1 FROM public.vencimientos w
          WHERE w.administracion_id = p_admin AND w.tipo = r.tipo_dec
            AND w.estado IN ('vigente','vencido'));
      ELSE
        -- Retirar SÓLO por razón POSITIVA (la obligación ya no aplica a la jurisdicción,
        -- hay dato oficial, o el cliente optó por no requerirla). NUNCA por una ausencia
        -- transitoria de fecha/certeza teniendo el dato cargado — eso churneaba ids
        -- nuevos y disparaba el doble aviso (caso Avolio, DGG-234 F9).
        IF (NOT v_aplica) OR v_oficial OR v_optout THEN
          UPDATE public.vencimientos
             SET estado = 'renovado'
           WHERE administracion_id = p_admin AND tipo = r.tipo_dec
             AND estado IN ('vigente','vencido');
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'perfil_declarado_sync_venc obligacion % admin %: %', r.tipo_dec, p_admin, SQLERRM;
    END;
  END LOOP;
END $function$;

-- ==========================================================================
-- (C) gg_vencimientos_planificar_alertas — dedup de la rama DECLARADOS por
--     (administracion_id, tipo, fecha_vencimiento) en vez de vencimiento_id, para que
--     re-crear la fila con id nuevo no vuelva a avisar lo mismo. Base: def actual
--     (0602/DGG-233). Rama oficial (renovacion_rpac) intacta.
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.gg_vencimientos_planificar_alertas(p_fecha date DEFAULT hoy_ar())
 RETURNS TABLE(vencimiento_id uuid, offset_dias integer, fecha_vencimiento date, administracion_id uuid, consorcio_id uuid, notificar_cliente boolean, tipo text, descripcion text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT v.administracion_id AS admin_id
    FROM public.vencimientos v
    CROSS JOIN LATERAL unnest(v.alarmas_offsets) AS o
    WHERE v.tipo = 'renovacion_rpac' AND v.notificar_cliente AND v.administracion_id IS NOT NULL
      AND v.estado IN ('vigente','vencido') AND v.pausado_at IS NULL
      AND p_fecha = (v.fecha_vencimiento - o * INTERVAL '1 day')::date
      AND NOT EXISTS (
        SELECT 1 FROM public.tramites t
        WHERE t.administracion_id = v.administracion_id
          AND t.categoria = 'renovacion'
          AND t.estado IN ('abierto','en_progreso','esperando_cliente'))
      AND NOT private.gg_venc_tramix_fresco(v.administracion_id)
  LOOP
    PERFORM private.gg_venc_encolar_refresh(r.admin_id);
  END LOOP;

  RETURN QUERY
  SELECT v.id, o::int AS offset_dias, v.fecha_vencimiento, v.administracion_id,
    v.consorcio_id, v.notificar_cliente, v.tipo, v.descripcion
  FROM public.vencimientos v
  CROSS JOIN LATERAL unnest(v.alarmas_offsets) AS o
  WHERE v.estado IN ('vigente','vencido')
    AND v.pausado_at IS NULL
    AND p_fecha = (v.fecha_vencimiento - o * INTERVAL '1 day')::date
    AND NOT (
      v.tipo = 'renovacion_rpac' AND v.administracion_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.tramites t
        WHERE t.administracion_id = v.administracion_id
          AND t.categoria = 'renovacion'
          AND t.estado IN ('abierto','en_progreso','esperando_cliente')))
    AND NOT (
      v.tipo = 'renovacion_rpac' AND v.notificar_cliente AND v.administracion_id IS NOT NULL
      AND NOT private.gg_venc_tramix_fresco(v.administracion_id))

  UNION ALL

  SELECT v.id, (v.fecha_vencimiento - p_fecha)::int AS offset_dias, v.fecha_vencimiento,
    v.administracion_id, v.consorcio_id, v.notificar_cliente, v.tipo, v.descripcion
  FROM public.vencimientos v
  WHERE v.origen = 'declarado'
    AND v.estado IN ('vigente','vencido')
    AND v.pausado_at IS NULL
    AND COALESCE(v.notificar_cliente, true)
    AND v.alarmas_offsets IS NOT NULL
    AND array_length(v.alarmas_offsets, 1) > 0
    AND p_fecha >= v.fecha_vencimiento - (SELECT max(o) FROM unnest(v.alarmas_offsets) AS o)
    AND p_fecha <= v.fecha_vencimiento - (SELECT min(o) FROM unnest(v.alarmas_offsets) AS o)
    AND NOT EXISTS (
      SELECT 1 FROM unnest(v.alarmas_offsets) AS o
      WHERE v.fecha_vencimiento - o = p_fecha)
    -- DGG-234 F9 · dedup por OBLIGACIÓN (admin, tipo, fecha), no por vencimiento_id:
    -- si YA se mailó cualquier fila de esta misma (admin,tipo,fecha), no re-avisar
    -- aunque la fila se haya re-creado con id nuevo (fin del doble aviso, caso Avolio).
    AND NOT EXISTS (
      SELECT 1 FROM public.dispatch_vencimientos_log dl
      JOIN public.vencimientos w ON w.id = dl.vencimiento_id
      WHERE w.administracion_id = v.administracion_id
        AND w.tipo = v.tipo
        AND w.fecha_vencimiento = v.fecha_vencimiento
        AND dl.canal = 'email_cliente'
        AND dl.resultado IN ('ok','skipped'));
END;
$function$;

-- ==========================================================================
-- (D) perfil_regulatorio_declarar — gate de jurisdicción en la ESCRITURA: certificado
--     sólo PBA; curso/ddjj sólo PBA+CABA (no Neuquén). Cierra el camino del drawer
--     "Anclar datos" de gerencia (que no gatea en la UI). Base: def actual. Firma intacta.
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.perfil_regulatorio_declarar(p_administracion_id uuid, p_jurisdiccion text DEFAULT NULL::text, p_matricula_fecha date DEFAULT NULL::date, p_matricula_nro text DEFAULT NULL::text, p_legajo_nro text DEFAULT NULL::text, p_ultima_renovacion date DEFAULT NULL::date, p_ultimo_curso_actualizacion date DEFAULT NULL::date, p_ultima_ddjj date DEFAULT NULL::date, p_ultima_consultoria date DEFAULT NULL::date, p_ultimo_certificado date DEFAULT NULL::date, p_no_requiere jsonb DEFAULT NULL::jsonb, p_notas text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_jur_norm public.jurisdiccion_matricula;
  v_jur_legacy text;
  v_es_pba boolean;
  v_eff_jur text;        -- DGG-234 F9: jurisdicción EFECTIVA del cliente (param o dato ya cargado)
  v_curso_in date;       -- entradas gateadas por jurisdicción
  v_ddjj_in date;
  v_cert_in date;
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);

  IF p_jurisdiccion IS NOT NULL AND lower(p_jurisdiccion) NOT IN ('rpac','rpa','pba','caba','neuquen') THEN
    RAISE EXCEPTION 'jurisdiccion inválida' USING ERRCODE = '22023';
  END IF;
  v_jur_norm := CASE lower(COALESCE(p_jurisdiccion,''))
                  WHEN 'rpac' THEN 'pba' WHEN 'pba' THEN 'pba'
                  WHEN 'rpa'  THEN 'caba' WHEN 'caba' THEN 'caba'
                  WHEN 'neuquen' THEN 'neuquen' ELSE NULL END::public.jurisdiccion_matricula;
  v_jur_legacy := CASE WHEN v_jur_norm = 'pba' THEN 'rpac'
                       WHEN v_jur_norm IN ('caba','neuquen') THEN 'rpa' ELSE NULL END;
  v_es_pba := (v_jur_norm IS NULL OR v_jur_norm = 'pba');

  -- Jurisdicción efectiva: el parámetro si vino, si no la de matricula_extra (CABA/NEU),
  -- si no 'pba'. Gobierna qué obligaciones NO-universales se aceptan (defensa en
  -- profundidad; la ficha del cliente ya oculta lo que no aplica, pero el drawer de
  -- gerencia no — así un certificado anclado a un CABA se descarta acá).
  v_eff_jur := COALESCE(
    v_jur_norm::text,
    (SELECT me.jurisdiccion::text FROM public.matricula_extra me
       WHERE me.administracion_id = p_administracion_id ORDER BY me.jurisdiccion LIMIT 1),
    'pba');
  v_curso_in := CASE WHEN v_eff_jur IN ('pba','caba') THEN p_ultimo_curso_actualizacion END;
  v_ddjj_in  := CASE WHEN v_eff_jur IN ('pba','caba') THEN p_ultima_ddjj END;
  v_cert_in  := CASE WHEN v_eff_jur = 'pba'           THEN p_ultimo_certificado END;

  INSERT INTO public.perfil_regulatorio AS pr (
    administracion_id, jurisdiccion, matricula_fecha_declarada, matricula_nro_declarada,
    legajo_nro_declarado, ultima_renovacion_declarada, ultimo_curso_actualizacion_declarado,
    ultima_ddjj_declarada, ultima_consultoria_declarada, ultimo_certificado_declarado,
    no_requiere, notas, updated_by
  ) VALUES (
    p_administracion_id, v_jur_legacy,
    CASE WHEN v_es_pba THEN p_matricula_fecha END,
    CASE WHEN v_es_pba THEN p_matricula_nro END,
    CASE WHEN v_es_pba THEN p_legajo_nro END,
    p_ultima_renovacion, v_curso_in,
    v_ddjj_in, p_ultima_consultoria, v_cert_in,
    COALESCE(p_no_requiere,'{}'::jsonb), p_notas, auth.uid()
  )
  ON CONFLICT (administracion_id) DO UPDATE SET
    jurisdiccion = COALESCE(EXCLUDED.jurisdiccion, pr.jurisdiccion),
    matricula_fecha_declarada = CASE WHEN v_es_pba THEN COALESCE(EXCLUDED.matricula_fecha_declarada, pr.matricula_fecha_declarada) ELSE pr.matricula_fecha_declarada END,
    matricula_nro_declarada = CASE WHEN v_es_pba THEN COALESCE(EXCLUDED.matricula_nro_declarada, pr.matricula_nro_declarada) ELSE pr.matricula_nro_declarada END,
    legajo_nro_declarado = CASE WHEN v_es_pba THEN COALESCE(EXCLUDED.legajo_nro_declarado, pr.legajo_nro_declarado) ELSE pr.legajo_nro_declarado END,
    ultima_renovacion_declarada = COALESCE(EXCLUDED.ultima_renovacion_declarada, pr.ultima_renovacion_declarada),
    ultimo_curso_actualizacion_declarado = CASE WHEN v_eff_jur IN ('pba','caba') THEN COALESCE(EXCLUDED.ultimo_curso_actualizacion_declarado, pr.ultimo_curso_actualizacion_declarado) ELSE pr.ultimo_curso_actualizacion_declarado END,
    ultima_ddjj_declarada = CASE WHEN v_eff_jur IN ('pba','caba') THEN COALESCE(EXCLUDED.ultima_ddjj_declarada, pr.ultima_ddjj_declarada) ELSE pr.ultima_ddjj_declarada END,
    ultima_consultoria_declarada = COALESCE(EXCLUDED.ultima_consultoria_declarada, pr.ultima_consultoria_declarada),
    ultimo_certificado_declarado = CASE WHEN v_eff_jur = 'pba' THEN COALESCE(EXCLUDED.ultimo_certificado_declarado, pr.ultimo_certificado_declarado) ELSE pr.ultimo_certificado_declarado END,
    no_requiere = CASE WHEN p_no_requiere IS NULL THEN pr.no_requiere ELSE pr.no_requiere || p_no_requiere END,
    notas = COALESCE(EXCLUDED.notas, pr.notas),
    updated_by = auth.uid();

  IF NOT v_es_pba AND (p_matricula_nro IS NOT NULL OR p_matricula_fecha IS NOT NULL) THEN
    INSERT INTO public.matricula_extra
      (administracion_id, jurisdiccion, matricula_nro, matricula_fecha, matricula_vencimiento, certeza, origen, updated_by)
    VALUES (p_administracion_id, v_jur_norm, p_matricula_nro, p_matricula_fecha,
            CASE WHEN p_matricula_fecha IS NOT NULL THEN (p_matricula_fecha + INTERVAL '12 months')::date END,
            'declarado', 'cliente', auth.uid())
    ON CONFLICT (administracion_id, jurisdiccion) DO UPDATE SET
      matricula_nro = COALESCE(EXCLUDED.matricula_nro, public.matricula_extra.matricula_nro),
      matricula_fecha = COALESCE(EXCLUDED.matricula_fecha, public.matricula_extra.matricula_fecha),
      matricula_vencimiento = COALESCE(EXCLUDED.matricula_vencimiento, public.matricula_extra.matricula_vencimiento),
      updated_by = auth.uid(), updated_at = now();
  END IF;

  BEGIN
    PERFORM private.perfil_declarado_sync_venc(p_administracion_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'perfil_regulatorio_declarar sync_venc admin %: %', p_administracion_id, SQLERRM;
  END;
END $function$;

-- ==========================================================================
-- (E) cliente_portal_dashboard — excluir los vencimientos DECLARADOS del card
--     "Próximos vencimientos" (tienen su superficie propia: ficha/agenda/banners
--     "según tus datos"). Elimina la fuga de enum crudo + descripción interna al
--     cliente. Sólo cambia la subquery de v_vencimientos_proximos.
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.cliente_portal_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_admin_id uuid; v_admin record; v_deuda record; v_clase_hoy jsonb; v_webinar_proximo jsonb;
  v_ultimo_tramite jsonb; v_tramites_abiertos int; v_cursos_activos jsonb; v_vencimientos_proximos jsonb;
  v_oportunidades jsonb := '[]'::jsonb; v_cands jsonb := '[]'::jsonb;
  v_has_matricula boolean; v_matriculado boolean; v_ddjj_presentada boolean; v_tiene_deuda boolean;
  v_recien_llegado boolean; v_puede_crosssell boolean; v_dias_a_renovacion int; v_tiene_actualizacion_movil boolean;
  v_proxima_ddjj record; v_webinar_destacado record; v_hizo_caba boolean; v_ofrece boolean;
  v_toques_hoy text[] := '{}';
  v_mes int := EXTRACT(MONTH FROM (now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))::int;
  v_renovacion_en_curso boolean;
  me record; v_jur text;
  v_mat_nro text; v_mat_venc date;
  v_decl_cta text; v_decl_label text; v_decl_nom text;
BEGIN
  v_admin_id := private.current_administracion_id();
  IF v_admin_id IS NULL THEN RETURN jsonb_build_object('error', 'no_administracion_context'); END IF;
  SELECT id, codigo, nombre, responsable_nombre, responsable_apellido,
         matricula_rpac, matricula_rpac_fecha, matricula_rpac_vencimiento,
         matricula_rpa, matricula_rpa_vencimiento, foto_url, created_at, ofrecimientos_habilitados
    INTO v_admin FROM public.administraciones WHERE id = v_admin_id;
  SELECT * INTO me FROM public.matricula_extra
    WHERE administracion_id = v_admin_id ORDER BY jurisdiccion LIMIT 1;
  v_has_matricula := v_admin.matricula_rpac IS NOT NULL OR me.id IS NOT NULL;
  v_ofrece := COALESCE(v_admin.ofrecimientos_habilitados, true);
  v_hizo_caba := private.gg_admin_hizo_curso_caba(v_admin_id);
  SELECT COALESCE(array_agg(DISTINCT ol.codigo), '{}') INTO v_toques_hoy
  FROM public.ofrecimientos_log ol
  WHERE ol.administracion_id = v_admin_id AND ol.canal = 'banner'
    AND ol.ciclo_ancla = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_matriculado := v_has_matricula OR EXISTS (
    SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id = t.servicio_id
    WHERE t.administracion_id = v_admin_id AND t.estado = 'cerrado'
      AND s.codigo IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion'));
  v_jur := CASE WHEN me.id IS NOT NULL AND v_admin.matricula_rpac IS NULL THEN me.jurisdiccion::text
                WHEN v_matriculado THEN 'pba' ELSE NULL END;
  v_mat_nro  := COALESCE(v_admin.matricula_rpac, me.matricula_nro);
  v_mat_venc := COALESCE(v_admin.matricula_rpac_vencimiento, me.matricula_vencimiento);
  SELECT EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.administracion_id = v_admin_id AND t.categoria = 'renovacion'
      AND t.estado IN ('abierto','en_progreso','esperando_cliente')
  ) INTO v_renovacion_en_curso;
  v_dias_a_renovacion := CASE WHEN v_admin.matricula_rpac_vencimiento IS NULL THEN NULL
    ELSE (v_admin.matricula_rpac_vencimiento - CURRENT_DATE)::int END;
  SELECT * INTO v_deuda FROM public.cliente_deuda_neta(v_admin_id);
  v_tiene_deuda := COALESCE(v_deuda.total, 0) > 0;
  v_recien_llegado := (now() - v_admin.created_at) < interval '15 days';
  v_puede_crosssell := NOT v_recien_llegado;
  SELECT jsonb_build_object('encuentro_id', e.id, 'curso_id', c.id, 'curso_slug', c.slug,
    'curso_titulo', c.titulo, 'encuentro_titulo', e.titulo, 'fecha_hora', e.fecha_hora,
    'minutos_para_inicio', EXTRACT(EPOCH FROM (e.fecha_hora - now()))::int / 60, 'duracion_min', e.duracion_min,
    'link_zoom', COALESCE(e.zoom_join_url, e.link_zoom), 'link_webex', e.webex_join_url,
    'plataforma', COALESCE(e.plataforma, 'zoom'), 'iniciado_at', e.iniciado_at) INTO v_clase_hoy
  FROM public.curso_encuentros e JOIN public.cursos c ON c.id = e.curso_id
  WHERE EXISTS (SELECT 1 FROM public.curso_matriculas cm JOIN public.profiles p ON p.id = cm.profile_id
    WHERE cm.curso_id = c.id AND cm.estado = 'activa' AND p.administracion_id = v_admin_id)
    AND private.curso_estado_publicacion(c.activo, c.publicar_at, c.despublicar_at) IN ('publicado','finalizado')
    AND e.fecha_hora BETWEEN (now() - interval '30 minutes') AND (now() + interval '12 hours')
  ORDER BY e.fecha_hora ASC LIMIT 1;
  SELECT jsonb_build_object('webinar_id', w.id, 'titulo', w.titulo, 'fecha_hora', w.fecha_hora,
    'horas_para_inicio', EXTRACT(EPOCH FROM (w.fecha_hora - now())) / 3600, 'plataforma', w.plataforma,
    'link', COALESCE(w.zoom_join_url, w.webex_join_url, w.youtube_live_url), 'status', w.status, 'inscripto', true)
    INTO v_webinar_proximo
  FROM public.webinars w JOIN public.webinar_inscriptos wi ON wi.webinar_id = w.id
  WHERE wi.administracion_id = v_admin_id AND w.fecha_hora >= now() - interval '15 minutes'
    AND w.status IN ('programado','en_curso') ORDER BY w.fecha_hora ASC LIMIT 1;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('matricula_id', cm.id, 'curso_id', c.id, 'curso_slug', c.slug,
    'curso_titulo', c.titulo, 'modalidad', c.modalidad, 'vigencia_hasta', cm.vigencia_hasta,
    'inscripto_at', cm.inscripto_at, 'banner_url', c.banner_url) ORDER BY cm.inscripto_at DESC), '[]'::jsonb)
  INTO v_cursos_activos
  FROM public.curso_matriculas cm JOIN public.cursos c ON c.id = cm.curso_id
  JOIN public.profiles p ON p.id = cm.profile_id
  WHERE p.administracion_id = v_admin_id AND cm.estado = 'activa';
  SELECT COUNT(*) INTO v_tramites_abiertos FROM public.tramites
  WHERE administracion_id = v_admin_id AND estado IN ('abierto','en_progreso','esperando_cliente');
  SELECT jsonb_build_object('id', t.id, 'codigo', t.codigo, 'titulo', t.titulo, 'categoria', t.categoria,
    'estado', t.estado, 'ultima_actividad_at', t.ultima_actividad_at,
    'horas_desde_actividad', EXTRACT(EPOCH FROM (now() - t.ultima_actividad_at)) / 3600) INTO v_ultimo_tramite
  FROM public.tramites t WHERE t.administracion_id = v_admin_id
    AND t.estado IN ('abierto','en_progreso','esperando_cliente')
  ORDER BY t.ultima_actividad_at DESC LIMIT 1;
  -- DGG-234 F9 · excluir origen='declarado': los recordatorios declarados (DGG-231)
  -- tienen su superficie propia (ficha "Tu agenda de avisos" + banners "según tus datos").
  -- No deben aparecer en este card genérico (fugaban el enum crudo + la descripción interna).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', v.id, 'tipo', v.tipo, 'descripcion', v.descripcion,
    'fecha_vencimiento', v.fecha_vencimiento, 'dias_restantes', (v.fecha_vencimiento - CURRENT_DATE)::int,
    'estado', v.estado, 'consorcio_id', v.consorcio_id, 'sujeto', v.sujeto) ORDER BY v.fecha_vencimiento ASC), '[]'::jsonb)
  INTO v_vencimientos_proximos
  FROM (SELECT * FROM public.vencimientos WHERE administracion_id = v_admin_id AND estado = 'vigente'
      AND origen IS DISTINCT FROM 'declarado'
      AND fecha_vencimiento BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '90 days')
      ORDER BY fecha_vencimiento ASC LIMIT 5) v;
  SELECT EXISTS (SELECT 1 FROM public.curso_matriculas cm JOIN public.cursos c ON c.id = cm.curso_id
    LEFT JOIN public.profiles p ON p.id = cm.profile_id
    WHERE COALESCE(cm.administracion_id, p.administracion_id) = v_admin_id AND cm.estado <> 'anulada'
      AND c.jurisdiccion = 'pba' AND c.slug ILIKE '%actualizacion%'
      AND cm.inscripto_at >= now() - interval '12 months') INTO v_tiene_actualizacion_movil;
  SELECT id, fecha_vencimiento, (fecha_vencimiento - CURRENT_DATE)::int AS dias_restantes INTO v_proxima_ddjj
  FROM public.vencimientos WHERE administracion_id = v_admin_id AND tipo = 'ddjj_anual' AND estado = 'vigente'
    AND fecha_vencimiento >= CURRENT_DATE ORDER BY fecha_vencimiento ASC LIMIT 1;
  SELECT w.id, w.titulo, w.fecha_hora, w.descripcion INTO v_webinar_destacado
  FROM public.webinars w WHERE w.status = 'programado' AND w.fecha_hora >= now()
    AND NOT EXISTS (SELECT 1 FROM public.webinar_inscriptos wi WHERE wi.webinar_id = w.id AND wi.administracion_id = v_admin_id)
  ORDER BY w.fecha_hora ASC LIMIT 1;
  v_ddjj_presentada := EXISTS (SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id = t.servicio_id
    WHERE t.administracion_id = v_admin_id AND s.nombre ILIKE 'Declaraciones juradas%'
      AND t.created_at >= date_trunc('year', now()));
  IF v_proxima_ddjj.dias_restantes IS NOT NULL AND v_proxima_ddjj.dias_restantes BETWEEN 0 AND 60 THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object('codigo','ddjj_proxima','prioridad',10,'bucket','accion','posponible',false,
      'kicker','OBLIGACIÓN ANUAL','titulo','Tu DDJJ vence pronto',
      'descripcion','Tenés '||v_proxima_ddjj.dias_restantes||' día'||CASE WHEN v_proxima_ddjj.dias_restantes=1 THEN '' ELSE 's' END||' para presentar tu Declaración Jurada anual.',
      'cta_label','Iniciar DDJJ','cta_path','/formulario/ddjj-anual?origen=portal',
      'tone',CASE WHEN v_proxima_ddjj.dias_restantes<=15 THEN 'urgente' WHEN v_proxima_ddjj.dias_restantes<=30 THEN 'alto' ELSE 'medio' END,'icono','file-text'));
  END IF;
  IF v_matriculado AND NOT v_renovacion_en_curso AND v_dias_a_renovacion IS NOT NULL AND v_dias_a_renovacion < 0 THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object('codigo','matricula_vencida','prioridad',15,'bucket','accion','posponible',false,
      'kicker','MATRÍCULA VENCIDA','titulo','Tu matrícula RPAC está vencida',
      'descripcion','Tu matrícula venció hace '||abs(v_dias_a_renovacion)||' día'||CASE WHEN v_dias_a_renovacion=-1 THEN '' ELSE 's' END||'. Iniciá la renovación para regularizar tu habilitación.',
      'cta_label','Renovar ahora','cta_path','/formulario/renovacion-rpac?origen=portal','tone','urgente','icono','badge-check'));
  END IF;
  IF v_matriculado AND NOT v_renovacion_en_curso AND v_dias_a_renovacion IS NOT NULL AND v_dias_a_renovacion BETWEEN 0 AND 60 THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object('codigo','renovacion_matricula','prioridad',20,'bucket','accion','posponible',false,
      'kicker','OPORTUNIDAD','titulo','Renová tu matrícula RPAC',
      'descripcion','Tu matrícula vence en '||v_dias_a_renovacion||' día'||CASE WHEN v_dias_a_renovacion=1 THEN '' ELSE 's' END||'. Renová ahora y mantené tu habilitación al día.',
      'cta_label','Iniciar renovación','cta_path','/formulario/renovacion-rpac?origen=portal',
      'tone',CASE WHEN v_dias_a_renovacion<=15 THEN 'urgente' WHEN v_dias_a_renovacion<=30 THEN 'alto' ELSE 'medio' END,'icono','badge-check'));
  END IF;
  IF v_matriculado AND NOT v_renovacion_en_curso AND v_admin.matricula_rpac_vencimiento IS NULL THEN
    DECLARE v_rd_fecha date; v_rd_dias int;
    BEGIN
      SELECT fecha_vencimiento, (fecha_vencimiento - CURRENT_DATE)::int
        INTO v_rd_fecha, v_rd_dias
        FROM public.vencimientos
        WHERE administracion_id = v_admin_id AND tipo = 'renovacion_matricula_declarada'
          AND estado IN ('vigente','vencido') AND pausado_at IS NULL
        ORDER BY fecha_vencimiento ASC LIMIT 1;
      IF v_jur IN ('caba','neuquen') THEN
        v_decl_nom   := CASE WHEN v_jur='caba' THEN 'RPA (CABA)' ELSE 'RPA (Neuquén)' END;
        v_decl_cta   := CASE WHEN v_jur='caba' THEN '/formulario/curso-actualizacion-caba?origen=portal' ELSE '/portal/mi-ficha?origen=portal' END;
        v_decl_label := CASE WHEN v_jur='caba' THEN 'Ver el curso de actualización' ELSE 'Ver mi ficha' END;
        IF v_rd_fecha IS NOT NULL AND v_rd_dias < 0 THEN
          v_cands := v_cands || jsonb_build_array(jsonb_build_object('codigo','matricula_declarada_vencida','prioridad',16,'bucket','accion','posponible',false,
            'kicker','SEGÚN TUS DATOS','titulo','Tu matrícula figura vencida',
            'descripcion','Según la fecha que cargaste, tu matrícula '||v_decl_nom||' venció el '||to_char(v_rd_fecha,'DD/MM/YYYY')||'.'||
              CASE WHEN v_jur='caba' THEN ' Mantené tu inscripción al día con el curso de actualización anual.' ELSE ' Renovala ante el RPA de Neuquén y actualizá tu ficha.' END,
            'cta_label',v_decl_label,'cta_path',v_decl_cta,'tone','urgente','icono','badge-check'));
        ELSIF v_rd_fecha IS NOT NULL AND v_rd_dias BETWEEN 0 AND 60 THEN
          v_cands := v_cands || jsonb_build_array(jsonb_build_object('codigo','matricula_declarada_proxima','prioridad',21,'bucket','accion','posponible',false,
            'kicker','SEGÚN TUS DATOS','titulo','Tu matrícula vence pronto',
            'descripcion','Según la fecha que cargaste, tu matrícula '||v_decl_nom||' vence el '||to_char(v_rd_fecha,'DD/MM/YYYY')||' (en '||v_rd_dias||' día'||CASE WHEN v_rd_dias=1 THEN '' ELSE 's' END||').'||
              CASE WHEN v_jur='caba' THEN ' Hacé el curso de actualización CABA para mantenerla al día.' ELSE ' Renovala ante el RPA de Neuquén.' END,
            'cta_label',v_decl_label,'cta_path',v_decl_cta,'tone',CASE WHEN v_rd_dias<=15 THEN 'urgente' ELSE 'alto' END,'icono','badge-check'));
        END IF;
      ELSE
        IF v_rd_fecha IS NOT NULL AND v_rd_dias < 0 THEN
          v_cands := v_cands || jsonb_build_array(jsonb_build_object('codigo','matricula_declarada_vencida','prioridad',16,'bucket','accion','posponible',false,
            'kicker','SEGÚN TUS DATOS','titulo','Tu matrícula figura vencida',
            'descripcion','Según la fecha que cargaste, tu matrícula venció el '||to_char(v_rd_fecha,'DD/MM/YYYY')||'. Si ya la renovaste, actualizá tu agenda; si no, la renovamos por vos.',
            'cta_label','Renovar matrícula','cta_path','/formulario/renovacion-rpac?origen=portal','tone','urgente','icono','badge-check'));
        ELSIF v_rd_fecha IS NOT NULL AND v_rd_dias BETWEEN 0 AND 60 THEN
          v_cands := v_cands || jsonb_build_array(jsonb_build_object('codigo','matricula_declarada_proxima','prioridad',21,'bucket','accion','posponible',false,
            'kicker','SEGÚN TUS DATOS','titulo','Tu matrícula vence pronto',
            'descripcion','Según la fecha que cargaste, tu matrícula vence el '||to_char(v_rd_fecha,'DD/MM/YYYY')||' (en '||v_rd_dias||' día'||CASE WHEN v_rd_dias=1 THEN '' ELSE 's' END||'). Renovala a tiempo; la gestionamos por vos.',
            'cta_label','Renovar matrícula','cta_path','/formulario/renovacion-rpac?origen=portal','tone',CASE WHEN v_rd_dias<=15 THEN 'urgente' ELSE 'alto' END,'icono','badge-check'));
        END IF;
      END IF;
    END;
  END IF;
  IF v_ofrece AND NOT EXISTS (SELECT 1 FROM public.tramites t WHERE t.administracion_id = v_admin_id AND t.categoria = 'renovacion'
         AND t.estado IN ('abierto','en_progreso','esperando_cliente'))
     AND EXISTS (SELECT 1 FROM public.ofrecimientos_log ol WHERE ol.administracion_id = v_admin_id AND ol.codigo = 'renovacion_postcurso'
         AND ol.canal = 'banner' AND ol.ciclo_ancla > CURRENT_DATE - 30) THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object('codigo','renovacion_postcurso','prioridad',22,'bucket','accion','posponible',false,
      'kicker','RENOVACIÓN DE MATRÍCULA','titulo','Terminaste tu Curso de Actualización',
      'descripcion','Ya tenés el requisito listo para renovar tu matrícula RPAC. Hacemos todo el trámite por vos.',
      'cta_label','Solicitar renovación','cta_path','/formulario/renovacion-rpac?origen=portal','tone','medio','icono','badge-check'));
  END IF;
  IF NOT v_matriculado AND NOT v_hizo_caba AND v_jur IS NULL AND v_ofrece THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object('codigo','matricula_inicial','prioridad',30,'bucket','accion','posponible',false,
      'kicker','EMPEZÁ TU CARRERA','titulo','Matriculate como administrador',
      'descripcion','Combinamos curso de formación + trámite de matrícula RPAC. Te acompañamos en todo el proceso.',
      'cta_label','Ver requisitos','cta_path','/formulario/matriculacion-rpac?origen=portal','tone','medio','icono','sparkles'));
  END IF;
  IF v_ofrece AND v_matriculado AND (NOT v_tiene_actualizacion_movil OR 'curso_actualizacion_60' = ANY(v_toques_hoy)) THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object('codigo','curso_actualizacion','prioridad',40,'bucket','accion','posponible',false,
      'kicker','CAPACITACIÓN ANUAL','titulo','Cumplí con tu actualización del año',
      'descripcion','Mantené tu matrícula vigente: el curso de actualización anual es obligatorio (CABA o PBA).',
      'cta_label','Ver cursos','cta_path','/portal/campus','tone','medio','icono','graduation-cap'));
  END IF;
  IF v_ofrece AND v_matriculado AND v_jur = 'pba' AND NOT v_ddjj_presentada AND v_mes IN (11,12,1,2,3)
     AND NOT EXISTS (SELECT 1 FROM public.cliente_oportunidad_eventos e WHERE e.administracion_id=v_admin_id AND e.codigo='ddjj_diciembre'
         AND ((e.snoozed_until IS NOT NULL AND e.snoozed_until>now())
           OR (e.last_shown_at IS NOT NULL AND e.last_shown_at>=date_trunc('year',now()) AND e.last_shown_at::date<>CURRENT_DATE))) THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object('codigo','ddjj_diciembre','prioridad',55,'bucket','suave','posponible',true,
      'kicker','OBLIGACIÓN ANUAL','titulo','No dejes tu DDJJ para último momento',
      'descripcion','Arrancá cuanto antes tu Declaración Jurada anual y evitá el apuro de fin de período.',
      'cta_label','Iniciar DDJJ','cta_path','/formulario/ddjj-anual?origen=portal','tone','medio','icono','file-text'));
  END IF;
  IF v_ofrece AND v_matriculado AND v_jur = 'pba'
     AND NOT EXISTS (SELECT 1 FROM public.cliente_oportunidad_eventos e WHERE e.administracion_id=v_admin_id AND e.codigo='certificado_acreditacion'
         AND e.snoozed_until IS NOT NULL AND e.snoozed_until>now())
     AND ( 'certificado_90' = ANY(v_toques_hoy) OR (v_puede_crosssell AND NOT EXISTS (
             SELECT 1 FROM public.cliente_oportunidad_eventos e WHERE e.administracion_id=v_admin_id AND e.codigo='certificado_acreditacion'
               AND e.last_shown_at IS NOT NULL AND e.last_shown_at::date<>CURRENT_DATE AND e.last_shown_at::date>CURRENT_DATE-90)) ) THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object('codigo','certificado_acreditacion','prioridad',60,'bucket','suave','posponible',true,
      'kicker','ACREDITACIÓN','titulo','Certificá tu matrícula activa',
      'descripcion','Obtené tu certificado de acreditación RPAC para presentar ante consorcios (asambleas) y las entidades que lo requieran.',
      'cta_label','Solicitar certificado','cta_path','/formulario/certificado-rpac?origen=portal','tone','suave','icono','badge-check'));
  END IF;
  IF v_ofrece AND (v_matriculado OR v_hizo_caba)
     AND NOT EXISTS (SELECT 1 FROM public.cliente_oportunidad_eventos e WHERE e.administracion_id=v_admin_id AND e.codigo='consultoria_juridica'
         AND e.snoozed_until IS NOT NULL AND e.snoozed_until>now())
     AND ( 'cj_120' = ANY(v_toques_hoy) OR (v_puede_crosssell AND NOT EXISTS (
             SELECT 1 FROM public.cliente_oportunidad_eventos e WHERE e.administracion_id=v_admin_id AND e.codigo='consultoria_juridica'
               AND e.last_shown_at IS NOT NULL AND e.last_shown_at::date<>CURRENT_DATE AND e.last_shown_at::date>CURRENT_DATE-120)) ) THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object('codigo','consultoria_juridica','prioridad',70,'bucket','suave','posponible',true,
      'kicker','CONSULTORÍA JURÍDICA','titulo','¿Dudas de práctica profesional?',
      'descripcion','Contás con nuestro servicio de consultoría jurídica para las consultas de tu día a día.',
      'cta_label','Consultar','cta_path','/formulario/consultoria-juridica?origen=portal','tone','suave','icono','sparkles'));
  END IF;
  IF v_ofrece AND v_webinar_proximo IS NULL AND v_webinar_destacado.id IS NOT NULL AND NOT v_recien_llegado
     AND NOT EXISTS (SELECT 1 FROM public.cliente_oportunidad_eventos e WHERE e.administracion_id=v_admin_id AND e.codigo='webinar_destacado'
         AND e.snoozed_until IS NOT NULL AND e.snoozed_until>now()) THEN
    v_cands := v_cands || jsonb_build_array(jsonb_build_object('codigo','webinar_destacado','prioridad',80,'bucket','suave','posponible',true,
      'kicker','WEBINAR GRATUITO','titulo',v_webinar_destacado.titulo,
      'descripcion','Sumate a nuestro próximo webinar formativo sin costo.',
      'cta_label','Inscribirme','cta_path','/portal/webinars','tone','suave','icono','video',
      'webinar_id',v_webinar_destacado.id,'fecha_hora',v_webinar_destacado.fecha_hora));
  END IF;
  SELECT COALESCE(jsonb_agg(elem ORDER BY (elem->>'prioridad')::int), '[]'::jsonb) INTO v_oportunidades
  FROM (SELECT elem, row_number() OVER (PARTITION BY elem->>'bucket' ORDER BY (elem->>'prioridad')::int) AS rn
    FROM jsonb_array_elements(v_cands) elem) ranked WHERE rn = 1;
  RETURN jsonb_build_object(
    'administracion', jsonb_build_object('id', v_admin.id, 'codigo', v_admin.codigo, 'nombre', v_admin.nombre,
      'responsable_nombre', v_admin.responsable_nombre, 'responsable_apellido', v_admin.responsable_apellido,
      'foto_url', v_admin.foto_url, 'matricula_rpac', v_admin.matricula_rpac, 'matricula_rpac_fecha', v_admin.matricula_rpac_fecha,
      'matricula_rpac_vencimiento', v_admin.matricula_rpac_vencimiento, 'matricula_rpac_dias_a_vencimiento', v_dias_a_renovacion,
      'matricula_rpa', v_admin.matricula_rpa, 'tiene_matricula', v_has_matricula,
      'matricula_nro', v_mat_nro, 'matricula_vencimiento', v_mat_venc, 'jurisdiccion', v_jur),
    'deuda', jsonb_build_object('total', COALESCE(v_deuda.total, 0), 'tiene_deuda', v_tiene_deuda,
      'pendientes_count', COALESCE(v_deuda.pendientes_count, 0), 'vencidos_count', COALESCE(v_deuda.vencidos_count, 0),
      'proximo_vencimiento', v_deuda.proximo_vencimiento),
    'clase_hoy', v_clase_hoy, 'webinar_proximo', v_webinar_proximo, 'cursos_activos', v_cursos_activos,
    'tramites_abiertos_count', v_tramites_abiertos, 'ultimo_tramite', v_ultimo_tramite,
    'vencimientos_proximos', v_vencimientos_proximos, 'oportunidades', v_oportunidades, 'generated_at', now());
END;
$function$;

-- ==========================================================================
-- (F) Retiro de datos: el certificado deja de existir como vencimiento. Se marcan
--     'renovado' los certificado_declarado vivos (quedan fuera de todas las superficies
--     vigente/vencido: planner, home, agenda, ficha). No se borran (trazabilidad).
-- ==========================================================================
UPDATE public.vencimientos
   SET estado = 'renovado', updated_at = now()
 WHERE tipo = 'certificado_declarado'
   AND estado IN ('vigente','vencido');
