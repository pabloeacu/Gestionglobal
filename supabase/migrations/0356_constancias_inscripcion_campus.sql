-- 0356 · Constancias de inscripción de alumnos (Campus) — DGG (chunk CONST)
-- A demanda (sin flujo de pedidos): botón por alumno en la tab Alumnos → plantilla
-- tipo 'constancia' (A4 VERTICAL) → preview + retoque → export PDF / email.
-- RECICLA el sistema de diplomas SIN TOCARLO (mandato Pablo):
--   · plantillas: columna `tipo` aditiva en certificado_esquemas (default 'certificado'
--     → las filas existentes quedan idénticas); columnas nuevas NULLables que el
--     diploma ignora (normalizarEsquema sólo exige color_acento).
--   · el índice único de default pasa a ser POR TIPO (el global haría que marcar
--     default una constancia destronara al default del diploma).
--   · emisiones: tabla hermana `constancias` (NO se contamina `certificados`, que
--     tiene lógica downstream: celebración DGG-41, verificación pública, portal B4).
--   · mismo banco de imágenes (bucket certificado-assets) y mismo bucket 'certificados'
--     para los PDFs (policies staff bucket-wide ya existentes) → cero cambios storage.

-- ── 1 · certificado_esquemas: tipo + campos de constancia (aditivo) ─────────
ALTER TABLE public.certificado_esquemas
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'certificado'
    CHECK (tipo IN ('certificado','constancia')),
  ADD COLUMN IF NOT EXISTS texto_cuerpo text,
  ADD COLUMN IF NOT EXISTS destinatario_bloque text,
  ADD COLUMN IF NOT EXISTS lugar text;

COMMENT ON COLUMN public.certificado_esquemas.tipo IS
  'certificado = diploma A4 apaisado (flujo original, intacto) · constancia = carta A4 vertical (chunk CONST)';
COMMENT ON COLUMN public.certificado_esquemas.texto_cuerpo IS
  'Sólo tipo constancia: cuerpo de la carta con variables {{nombre}} {{apellido}} {{dni}} {{curso}} {{fecha}}';
COMMENT ON COLUMN public.certificado_esquemas.destinatario_bloque IS
  'Sólo tipo constancia: bloque del destinatario impreso (default editable al emitir)';

-- default por tipo (reemplaza el índice global)
DROP INDEX IF EXISTS public.certificado_esquemas_es_default_idx;
CREATE UNIQUE INDEX certificado_esquemas_es_default_por_tipo_idx
  ON public.certificado_esquemas (tipo) WHERE es_default;

-- ── 2 · tabla constancias (hermana de certificados) ─────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.constancias_codigo_seq;

CREATE TABLE IF NOT EXISTS public.constancias (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula_id       uuid NOT NULL REFERENCES public.curso_matriculas(id) ON DELETE CASCADE,
  curso_id           uuid NOT NULL REFERENCES public.cursos(id) ON DELETE CASCADE,
  administracion_id  uuid REFERENCES public.administraciones(id) ON DELETE SET NULL,
  alumno_profile_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  codigo             text NOT NULL UNIQUE,
  payload_snapshot   jsonb NOT NULL DEFAULT '{}'::jsonb,
  esquema_snapshot   jsonb NOT NULL DEFAULT '{}'::jsonb,
  texto_final        text NOT NULL,
  destinatario_final text,
  pdf_storage_path   text,
  enviado_email_at   timestamptz,
  enviado_a          text,
  emitida_por        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.constancias ENABLE ROW LEVEL SECURITY;
-- Regla 6 (post mig 0130): GRANTs explícitos.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.constancias TO authenticated;
GRANT USAGE ON SEQUENCE public.constancias_codigo_seq TO authenticated;

-- Sólo staff opera constancias (el alumno la recibe por mail; no hay superficie portal).
CREATE POLICY constancias_staff_all ON public.constancias
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

-- Regla 11: índices para toda FK.
CREATE INDEX IF NOT EXISTS constancias_matricula_idx ON public.constancias (matricula_id);
CREATE INDEX IF NOT EXISTS constancias_curso_idx     ON public.constancias (curso_id);
CREATE INDEX IF NOT EXISTS constancias_admin_idx     ON public.constancias (administracion_id);
CREATE INDEX IF NOT EXISTS constancias_alumno_idx    ON public.constancias (alumno_profile_id);
CREATE INDEX IF NOT EXISTS constancias_emitida_por_idx ON public.constancias (emitida_por);

-- ── 3 · RPC de emisión (snapshot server-side, regla 5) ──────────────────────
CREATE FUNCTION public.emitir_constancia(
  p_matricula_id uuid,
  p_esquema_id uuid,
  p_texto_final text,
  p_destinatario_final text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mat public.curso_matriculas%ROWTYPE;
  v_curso_titulo text;
  v_adm public.administraciones%ROWTYPE;
  v_esquema jsonb;
  v_codigo text;
  v_id uuid;
  v_payload jsonb;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede emitir constancias' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_texto_final),'') = '' THEN
    RAISE EXCEPTION 'El texto de la constancia no puede estar vacío' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_mat FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Matrícula % no existe', p_matricula_id; END IF;

  SELECT titulo INTO v_curso_titulo FROM public.cursos WHERE id = v_mat.curso_id;

  IF v_mat.administracion_id IS NOT NULL THEN
    SELECT * INTO v_adm FROM public.administraciones WHERE id = v_mat.administracion_id;
  END IF;

  SELECT to_jsonb(e) INTO v_esquema
    FROM public.certificado_esquemas e
   WHERE e.id = p_esquema_id AND e.tipo = 'constancia';
  IF v_esquema IS NULL THEN
    RAISE EXCEPTION 'La plantilla % no existe o no es de tipo constancia', p_esquema_id;
  END IF;

  v_codigo := 'CONST-' || to_char(now(), 'YYYY') || '-' ||
              lpad(nextval('public.constancias_codigo_seq')::text, 5, '0');

  v_payload := jsonb_build_object(
    'alumno_nombre',   coalesce(v_adm.responsable_nombre, ''),
    'alumno_apellido', coalesce(v_adm.responsable_apellido, ''),
    'alumno_dni',      coalesce(v_adm.responsable_dni, ''),
    'alumno_email',    coalesce(v_adm.email, ''),
    'curso_titulo',    coalesce(v_curso_titulo, ''),
    'fecha_emision',   to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD'),
    'matricula_id',    v_mat.id,
    'curso_id',        v_mat.curso_id
  );

  INSERT INTO public.constancias (
    matricula_id, curso_id, administracion_id, alumno_profile_id, codigo,
    payload_snapshot, esquema_snapshot, texto_final, destinatario_final, emitida_por
  ) VALUES (
    v_mat.id, v_mat.curso_id, v_mat.administracion_id, v_mat.profile_id, v_codigo,
    v_payload, v_esquema, btrim(p_texto_final), nullif(btrim(coalesce(p_destinatario_final,'')),''), auth.uid()
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'codigo', v_codigo);
END;
$function$;

REVOKE ALL ON FUNCTION public.emitir_constancia(uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.emitir_constancia(uuid, uuid, text, text) TO authenticated, service_role;

-- ── 4 · RPC registrar el PDF subido (espejo de certificado_registrar_pdf) ───
CREATE FUNCTION public.constancia_registrar_pdf(p_constancia_id uuid, p_path text)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia' USING ERRCODE = '42501';
  END IF;
  UPDATE public.constancias
     SET pdf_storage_path = p_path, updated_at = now()
   WHERE id = p_constancia_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Constancia % no existe', p_constancia_id; END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.constancia_registrar_pdf(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.constancia_registrar_pdf(uuid, text) TO authenticated, service_role;

-- ── 5 · Plantilla constancia inicial (default, texto del modelo de Pablo) ───
INSERT INTO public.certificado_esquemas (
  nombre, descripcion, tipo, es_default,
  color_acento, color_dorado,
  visible_marca_logo, visible_sigla, sigla_texto,
  visible_texto_descriptivo, texto_descriptivo,
  visible_leyenda_legal, leyenda_legal,
  visible_firma_1, firma_1_nombre, firma_1_cargo,
  visible_firma_2, firma_2_nombre, firma_2_cargo,
  visible_sello, visible_watermark,
  lugar, destinatario_bloque, texto_cuerpo
) VALUES (
  'Constancia de inscripción · FU.DE.CO.IN.',
  'Carta A4 vertical para acreditar la condición de alumno inscripto (modelo RPAC).',
  'constancia', true,
  '#0b1f33', '#a87f3c',
  true, false, 'FU.DE.CO.IN.',
  false, '',
  false, '',
  true, 'Pablo M. Parente', 'Presidente FU.DE.CO.IN.',
  true, 'Dr. Pablo E. Acuña', 'Director Académico',
  false, false,
  'Buenos Aires',
  E'Responsable Ejecutivo\nde la Unidad de Coordinación\ndel Registro Público de Administradores\nde Consorcios de Propiedad Horizontal\nde la Provincia de Buenos Aires (RPAC)\nLic. Carlos Capasso\nS____________/____________D',
  E'De mi mayor consideración,\n\nPor medio de la presente, y a solicitud de {{nombre}} {{apellido}}, DNI {{dni}}, acreditamos su condición de ALUMNO INSCRIPTO AL {{curso}} de nuestra entidad, habilitada a los efectos de inscribir y renovar matrículas del registro que dirige.\n\nAtte.'
);
