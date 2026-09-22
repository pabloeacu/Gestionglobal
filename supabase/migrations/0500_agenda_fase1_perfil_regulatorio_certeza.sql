-- 0500 · Agenda del Administrador · FASE 1 — Perfil regulatorio + niveles de certeza.
--
-- Aporte #1 del documento de Pablo: NUNCA afirmar una presunción. Hoy la plataforma
-- dice "tu matrícula vence" sin distinguir si el dato es CONFIRMADO por nosotros,
-- DECLARADO por el cliente, INFERIDO de otro hecho, o DESCONOCIDO. Y no hay dónde el
-- cliente declare "ya renové afuera el 15/08" (progressive profiling).
--
-- 100% ADITIVO: capa nueva (enum + tabla + 2 RPC de lectura/declaración). NO toca
-- administraciones, cliente_portal_dashboard, vencimientos, ni ningún flujo vivo. La
-- plataforma sigue siendo la fuente CONFIRMADA; esta tabla guarda sólo lo DECLARADO.

-- ── (1) Enum de certeza ────────────────────────────────────────────────────────────
DO $mig$ BEGIN
  CREATE TYPE public.certeza_dato AS ENUM ('confirmado','declarado','inferido','desconocido');
EXCEPTION WHEN duplicate_object THEN NULL; END $mig$;

-- ── (2) Tabla: hechos regulatorios DECLARADOS (por el cliente o anclados por gerencia) ─
CREATE TABLE IF NOT EXISTS public.perfil_regulatorio (
  administracion_id uuid PRIMARY KEY REFERENCES public.administraciones(id) ON DELETE CASCADE,
  jurisdiccion text CHECK (jurisdiccion IN ('rpac','rpa')),          -- PBA / CABA
  matricula_fecha_declarada date,
  matricula_nro_declarada text,
  ultima_renovacion_declarada date,
  ultimo_curso_actualizacion_declarado date,
  ultima_ddjj_declarada date,
  ultima_consultoria_declarada date,
  ultimo_certificado_declarado date,
  no_requiere jsonb NOT NULL DEFAULT '{}'::jsonb,                    -- {servicio_codigo:{motivo,fecha}} — "no deseo / no corresponde"
  notas text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
COMMENT ON TABLE public.perfil_regulatorio IS
  'Hechos regulatorios DECLARADOS por el cliente (progressive profiling) o anclados a mano por gerencia. La plataforma (administraciones/tramites) es la fuente CONFIRMADA; esto es la capa declarada. Agenda Fase 1 (DGG-195).';

ALTER TABLE public.perfil_regulatorio ENABLE ROW LEVEL SECURITY;
-- R6: grants explícitos (a nivel tabla; la escritura del cliente va por RPC definer).
GRANT SELECT, INSERT, UPDATE ON public.perfil_regulatorio TO authenticated;
-- Staff: todo. Cliente: SÓLO lee su propia fila (escribe por RPC).
CREATE POLICY perfil_reg_staff ON public.perfil_regulatorio FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY perfil_reg_cliente_select ON public.perfil_regulatorio FOR SELECT TO authenticated
  USING (administracion_id = private.current_administracion_id());

-- touch updated_at
CREATE OR REPLACE FUNCTION private.perfil_regulatorio_touch()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $fn$
BEGIN NEW.updated_at := now(); RETURN NEW; END $fn$;
DROP TRIGGER IF EXISTS trg_perfil_regulatorio_touch ON public.perfil_regulatorio;
CREATE TRIGGER trg_perfil_regulatorio_touch BEFORE UPDATE ON public.perfil_regulatorio
  FOR EACH ROW EXECUTE FUNCTION private.perfil_regulatorio_touch();

-- ── (3) RPC declarar: el cliente (o gerencia) ancla un dato con certeza='declarado' ───
-- Sólo pisa lo pasado (los NULL no borran). R12: tenencia. NO toca administraciones.
CREATE OR REPLACE FUNCTION public.perfil_regulatorio_declarar(
  p_administracion_id uuid,
  p_jurisdiccion text DEFAULT NULL,
  p_matricula_fecha date DEFAULT NULL,
  p_matricula_nro text DEFAULT NULL,
  p_ultima_renovacion date DEFAULT NULL,
  p_ultimo_curso_actualizacion date DEFAULT NULL,
  p_ultima_ddjj date DEFAULT NULL,
  p_ultima_consultoria date DEFAULT NULL,
  p_ultimo_certificado date DEFAULT NULL,
  p_no_requiere jsonb DEFAULT NULL,
  p_notas text DEFAULT NULL
) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);  -- R12 (helper vive en private)
  IF p_jurisdiccion IS NOT NULL AND p_jurisdiccion NOT IN ('rpac','rpa') THEN
    RAISE EXCEPTION 'jurisdiccion inválida' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.perfil_regulatorio AS pr (
    administracion_id, jurisdiccion, matricula_fecha_declarada, matricula_nro_declarada,
    ultima_renovacion_declarada, ultimo_curso_actualizacion_declarado, ultima_ddjj_declarada,
    ultima_consultoria_declarada, ultimo_certificado_declarado, no_requiere, notas, updated_by
  ) VALUES (
    p_administracion_id, p_jurisdiccion, p_matricula_fecha, p_matricula_nro,
    p_ultima_renovacion, p_ultimo_curso_actualizacion, p_ultima_ddjj,
    p_ultima_consultoria, p_ultimo_certificado, COALESCE(p_no_requiere,'{}'::jsonb), p_notas, auth.uid()
  )
  ON CONFLICT (administracion_id) DO UPDATE SET
    jurisdiccion = COALESCE(EXCLUDED.jurisdiccion, pr.jurisdiccion),
    matricula_fecha_declarada = COALESCE(EXCLUDED.matricula_fecha_declarada, pr.matricula_fecha_declarada),
    matricula_nro_declarada = COALESCE(EXCLUDED.matricula_nro_declarada, pr.matricula_nro_declarada),
    ultima_renovacion_declarada = COALESCE(EXCLUDED.ultima_renovacion_declarada, pr.ultima_renovacion_declarada),
    ultimo_curso_actualizacion_declarado = COALESCE(EXCLUDED.ultimo_curso_actualizacion_declarado, pr.ultimo_curso_actualizacion_declarado),
    ultima_ddjj_declarada = COALESCE(EXCLUDED.ultima_ddjj_declarada, pr.ultima_ddjj_declarada),
    ultima_consultoria_declarada = COALESCE(EXCLUDED.ultima_consultoria_declarada, pr.ultima_consultoria_declarada),
    ultimo_certificado_declarado = COALESCE(EXCLUDED.ultimo_certificado_declarado, pr.ultimo_certificado_declarado),
    no_requiere = CASE WHEN p_no_requiere IS NULL THEN pr.no_requiere ELSE pr.no_requiere || p_no_requiere END,
    notas = COALESCE(EXCLUDED.notas, pr.notas),
    updated_by = auth.uid();
END $fn$;
REVOKE ALL ON FUNCTION public.perfil_regulatorio_declarar(uuid,text,date,text,date,date,date,date,date,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perfil_regulatorio_declarar(uuid,text,date,text,date,date,date,date,date,jsonb,text) TO authenticated;

-- ── (4) RPC get: perfil regulatorio MERGEADO con certeza + próximas fechas derivadas ──
-- Prioridad de certeza por dato: confirmado (plataforma) > declarado (tabla) > inferido > desconocido.
-- SOLO LECTURA. R12: tenencia. Reusa la derivación de fechas del negocio (matríc+12m, DDJJ marzo).
CREATE OR REPLACE FUNCTION public.perfil_regulatorio_get(p_administracion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public','pg_temp' SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $fn$
DECLARE
  a record; d record;
  v_matriculado_conf boolean; v_matriculado boolean;
  v_mat_fecha date; v_mat_fecha_cert public.certeza_dato;
  v_mat_nro text; v_mat_nro_cert public.certeza_dato;
  v_ult_renov date; v_ult_renov_cert public.certeza_dato;
  v_prox_renov date; v_prox_renov_cert public.certeza_dato;
  v_ult_curso date; v_ult_curso_cert public.certeza_dato;
  v_prox_curso date; v_prox_curso_cert public.certeza_dato;
  v_ult_ddjj date; v_ult_ddjj_cert public.certeza_dato;
  v_prox_ddjj date; v_prox_ddjj_cert public.certeza_dato;
  v_ult_cert date; v_ult_cert_cert public.certeza_dato;
  v_ult_cons date; v_ult_cons_cert public.certeza_dato;
  v_matric_cert public.certeza_dato;
  v_jur text;
  v_conf int := 0; v_total int := 8;
  v_venc_renov date; v_venc_ddjj date; v_venc_curso date;
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);  -- R12 (helper vive en private)

  SELECT id, matricula_rpac, matricula_rpac_fecha, matricula_rpac_vencimiento,
         matricula_rpa, matricula_rpa_fecha, matricula_rpa_vencimiento, legajo_rpac
    INTO a FROM public.administraciones WHERE id = p_administracion_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Administración inexistente' USING ERRCODE='P0002'; END IF;
  SELECT * INTO d FROM public.perfil_regulatorio WHERE administracion_id = p_administracion_id;

  -- Próximas fechas YA sembradas en vencimientos (confirmadas por el sistema): se prefieren
  -- antes de inferir. La fila vigente más próxima por tipo.
  SELECT min(fecha_vencimiento) INTO v_venc_renov FROM public.vencimientos
    WHERE administracion_id=p_administracion_id AND tipo='renovacion_rpac' AND estado='vigente' AND fecha_vencimiento>=CURRENT_DATE;
  SELECT min(fecha_vencimiento) INTO v_venc_ddjj FROM public.vencimientos
    WHERE administracion_id=p_administracion_id AND tipo='ddjj_anual' AND estado='vigente' AND fecha_vencimiento>=CURRENT_DATE;
  SELECT min(fecha_vencimiento) INTO v_venc_curso FROM public.vencimientos
    WHERE administracion_id=p_administracion_id AND tipo IN ('curso_actualizacion') AND estado='vigente' AND fecha_vencimiento>=CURRENT_DATE;

  -- jurisdicción: la que tenga matrícula confirmada, si no la declarada
  v_jur := CASE WHEN a.matricula_rpac IS NOT NULL THEN 'rpac'
                WHEN a.matricula_rpa IS NOT NULL THEN 'rpa'
                ELSE d.jurisdiccion END;

  -- ¿matriculado? confirmado si hay matrícula o cerró inscripción/renovación
  v_matriculado_conf := (a.matricula_rpac IS NOT NULL OR a.matricula_rpa IS NOT NULL) OR EXISTS (
    SELECT 1 FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado='cerrado'
      AND s.codigo IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion'));
  IF v_matriculado_conf THEN v_matriculado := true; v_matric_cert := 'confirmado';
  ELSIF d.matricula_fecha_declarada IS NOT NULL THEN v_matriculado := true; v_matric_cert := 'declarado';
  ELSE v_matriculado := false; v_matric_cert := 'desconocido'; END IF;

  -- matrícula: nro + fecha (confirmado > declarado > desconocido)
  v_mat_nro := COALESCE(a.matricula_rpac, a.matricula_rpa, d.matricula_nro_declarada);
  v_mat_nro_cert := CASE WHEN a.matricula_rpac IS NOT NULL OR a.matricula_rpa IS NOT NULL THEN 'confirmado'
                         WHEN d.matricula_nro_declarada IS NOT NULL THEN 'declarado' ELSE 'desconocido' END;
  v_mat_fecha := COALESCE(a.matricula_rpac_fecha, a.matricula_rpa_fecha, d.matricula_fecha_declarada);
  v_mat_fecha_cert := CASE WHEN a.matricula_rpac_fecha IS NOT NULL OR a.matricula_rpa_fecha IS NOT NULL THEN 'confirmado'
                           WHEN d.matricula_fecha_declarada IS NOT NULL THEN 'declarado' ELSE 'desconocido' END;

  -- última renovación: cerró un rpac_renovacion (confirmado) > declarada > desconocido
  SELECT max(t.fecha_fin) INTO v_ult_renov FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado='cerrado' AND s.codigo='rpac_renovacion';
  IF v_ult_renov IS NOT NULL THEN v_ult_renov_cert := 'confirmado';
  ELSIF d.ultima_renovacion_declarada IS NOT NULL THEN v_ult_renov := d.ultima_renovacion_declarada; v_ult_renov_cert := 'declarado';
  ELSE v_ult_renov_cert := 'desconocido'; END IF;

  -- próxima renovación: vencimiento SEMBRADO/confirmado > (última renov / matrícula + 12m) inferido
  IF v_venc_renov IS NOT NULL THEN v_prox_renov := v_venc_renov; v_prox_renov_cert := 'confirmado';
  ELSIF a.matricula_rpac_vencimiento IS NOT NULL THEN v_prox_renov := a.matricula_rpac_vencimiento; v_prox_renov_cert := 'confirmado';
  ELSIF a.matricula_rpa_vencimiento IS NOT NULL THEN v_prox_renov := a.matricula_rpa_vencimiento; v_prox_renov_cert := 'confirmado';
  ELSIF v_ult_renov IS NOT NULL THEN v_prox_renov := (v_ult_renov + interval '12 months')::date; v_prox_renov_cert := 'inferido';
  ELSIF v_mat_fecha IS NOT NULL THEN v_prox_renov := (v_mat_fecha + interval '12 months')::date; v_prox_renov_cert := 'inferido';
  ELSE v_prox_renov_cert := 'desconocido'; END IF;

  -- último curso de actualización: cerró curso_actualizacion (confirmado) > declarado > desconocido
  SELECT max(t.fecha_fin) INTO v_ult_curso FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado='cerrado' AND s.codigo IN ('curso_actualizacion_rpac','rpa_actualizacion');
  IF v_ult_curso IS NOT NULL THEN v_ult_curso_cert := 'confirmado';
  ELSIF d.ultimo_curso_actualizacion_declarado IS NOT NULL THEN v_ult_curso := d.ultimo_curso_actualizacion_declarado; v_ult_curso_cert := 'declarado';
  ELSE v_ult_curso_cert := 'desconocido'; END IF;
  -- próximo curso: vencimiento sembrado > último + 12m (inferido)
  IF v_venc_curso IS NOT NULL THEN v_prox_curso := v_venc_curso; v_prox_curso_cert := 'confirmado';
  ELSIF v_ult_curso IS NOT NULL THEN v_prox_curso := (v_ult_curso + interval '12 months')::date; v_prox_curso_cert := 'inferido';
  ELSE v_prox_curso_cert := 'desconocido'; END IF;

  -- última DDJJ: cerró rpac_ddjj (confirmado) > declarada > desconocido
  SELECT max(t.fecha_fin) INTO v_ult_ddjj FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado='cerrado' AND s.codigo='rpac_ddjj';
  IF v_ult_ddjj IS NOT NULL THEN v_ult_ddjj_cert := 'confirmado';
  ELSIF d.ultima_ddjj_declarada IS NOT NULL THEN v_ult_ddjj := d.ultima_ddjj_declarada; v_ult_ddjj_cert := 'declarado';
  ELSE v_ult_ddjj_cert := 'desconocido'; END IF;
  -- próxima DDJJ: vencimiento sembrado (confirmado) > si matriculado, el 31/03 próximo (fecha legal fija).
  IF v_venc_ddjj IS NOT NULL THEN
    v_prox_ddjj := v_venc_ddjj; v_prox_ddjj_cert := 'confirmado';
  ELSIF v_matriculado THEN
    IF make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 3, 31) >= CURRENT_DATE THEN
      v_prox_ddjj := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 3, 31);  -- si aún no pasó el 31/03 de este año
    ELSE
      v_prox_ddjj := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int + 1, 3, 31);
    END IF;
    v_prox_ddjj_cert := v_matric_cert;  -- confirmado si la matrícula lo es; declarado si no
  ELSE v_prox_ddjj_cert := 'desconocido'; END IF;

  -- último certificado / última consultoría (confirmado por trámite cerrado > declarado > desconocido)
  SELECT max(t.fecha_fin) INTO v_ult_cert FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado='cerrado' AND s.codigo='rpac_certificado';
  IF v_ult_cert IS NOT NULL THEN v_ult_cert_cert := 'confirmado';
  ELSIF d.ultimo_certificado_declarado IS NOT NULL THEN v_ult_cert := d.ultimo_certificado_declarado; v_ult_cert_cert := 'declarado';
  ELSE v_ult_cert_cert := 'desconocido'; END IF;

  SELECT max(t.fecha_fin) INTO v_ult_cons FROM public.tramites t JOIN public.servicios s ON s.id=t.servicio_id
    WHERE t.administracion_id=p_administracion_id AND t.estado='cerrado' AND s.codigo='juridico_consulta';
  IF v_ult_cons IS NOT NULL THEN v_ult_cons_cert := 'confirmado';
  ELSIF d.ultima_consultoria_declarada IS NOT NULL THEN v_ult_cons := d.ultima_consultoria_declarada; v_ult_cons_cert := 'declarado';
  ELSE v_ult_cons_cert := 'desconocido'; END IF;

  -- completitud regulatoria: % de datos NO desconocidos (de 8 hechos núcleo)
  v_conf :=
    (v_matric_cert <> 'desconocido')::int + (v_mat_fecha_cert <> 'desconocido')::int
    + (v_prox_renov_cert <> 'desconocido')::int + (v_ult_curso_cert <> 'desconocido')::int
    + (v_prox_ddjj_cert <> 'desconocido')::int + (v_ult_ddjj_cert <> 'desconocido')::int
    + (v_ult_cert_cert <> 'desconocido')::int + (v_ult_cons_cert <> 'desconocido')::int;

  RETURN jsonb_build_object(
    'administracion_id', p_administracion_id,
    'jurisdiccion', v_jur,
    'matriculado', jsonb_build_object('valor', v_matriculado, 'certeza', v_matric_cert),
    'matricula', jsonb_build_object('nro', v_mat_nro, 'nro_certeza', v_mat_nro_cert,
                                    'fecha', v_mat_fecha, 'fecha_certeza', v_mat_fecha_cert),
    'ultima_renovacion', jsonb_build_object('fecha', v_ult_renov, 'certeza', v_ult_renov_cert),
    'proxima_renovacion', jsonb_build_object('fecha', v_prox_renov, 'certeza', v_prox_renov_cert),
    'ultimo_curso_actualizacion', jsonb_build_object('fecha', v_ult_curso, 'certeza', v_ult_curso_cert),
    'proximo_curso_actualizacion', jsonb_build_object('fecha', v_prox_curso, 'certeza', v_prox_curso_cert),
    'ultima_ddjj', jsonb_build_object('fecha', v_ult_ddjj, 'certeza', v_ult_ddjj_cert),
    'proxima_ddjj', jsonb_build_object('fecha', v_prox_ddjj, 'certeza', v_prox_ddjj_cert),
    'ultimo_certificado', jsonb_build_object('fecha', v_ult_cert, 'certeza', v_ult_cert_cert),
    'ultima_consultoria', jsonb_build_object('fecha', v_ult_cons, 'certeza', v_ult_cons_cert),
    'no_requiere', COALESCE(d.no_requiere, '{}'::jsonb),
    'completitud_pct', round(100.0 * v_conf / v_total)::int,
    'generated_at', now()
  );
END $fn$;
REVOKE ALL ON FUNCTION public.perfil_regulatorio_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perfil_regulatorio_get(uuid) TO authenticated;
