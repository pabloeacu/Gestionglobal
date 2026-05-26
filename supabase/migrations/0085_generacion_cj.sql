-- 0085 · Generación CJ (Consultoría Jurídica)
--
-- Herramienta de gerencia que permite componer un documento de consultoría
-- jurídica con un editor visual (estilo MANAXER pero sin variables) y
-- exportarlo como PDF. Cada documento generado queda en una grilla de
-- historial con acciones (descargar PDF, enviar por email, eliminar).
--
-- Citas: regla 4 (queries en services/), regla 5 (RPC SD+search_path),
-- regla 12 (tenancy: panel staff-only, gerentes only).

-- =========================================================================
-- 1) Tabla cj_documentos
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.cj_documentos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tema                 text NOT NULL,                                 -- resumen corto para la grilla
  destinatario_nombre  text NOT NULL,
  destinatario_email   text,                                          -- nullable: si no hay, no se puede mailear

  -- Estilo visual del documento (mirror del template MANAXER pero sin variables)
  kicker               text NOT NULL DEFAULT 'CONSULTORÍA JURÍDICA',
  titulo               text NOT NULL,
  color_acento         text NOT NULL DEFAULT '#0891b2',
  mostrar_logo         boolean NOT NULL DEFAULT true,
  cuerpo_html          text NOT NULL DEFAULT '',
  firma                text,

  -- PDF generado (storage path en bucket cj-documentos)
  pdf_storage_path     text,
  pdf_generated_at     timestamptz,

  -- Email: cuándo se mandó por última vez (puede mandarse N veces)
  last_emailed_at      timestamptz,
  last_emailed_to      text,

  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cj_documentos_created_at ON public.cj_documentos (created_at DESC);

ALTER TABLE public.cj_documentos ENABLE ROW LEVEL SECURITY;

-- Solo staff (gerentes) ve y manipula
DROP POLICY IF EXISTS cj_documentos_staff_all ON public.cj_documentos;
CREATE POLICY cj_documentos_staff_all ON public.cj_documentos
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

COMMENT ON TABLE public.cj_documentos IS
  'Documentos de Consultoría Jurídica generados desde el panel de gerencia. Cada uno produce un PDF descargable + email opcional.';

-- =========================================================================
-- 2) Trigger updated_at
-- =========================================================================
CREATE OR REPLACE FUNCTION public.cj_documentos_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS cj_documentos_touch ON public.cj_documentos;
CREATE TRIGGER cj_documentos_touch
  BEFORE UPDATE ON public.cj_documentos
  FOR EACH ROW EXECUTE FUNCTION public.cj_documentos_touch_updated_at();

-- =========================================================================
-- 3) RPCs
-- =========================================================================

CREATE OR REPLACE FUNCTION public.cj_documento_crear(
  p_tema                text,
  p_destinatario_nombre text,
  p_destinatario_email  text,
  p_kicker              text,
  p_titulo              text,
  p_color_acento        text,
  p_mostrar_logo        boolean,
  p_cuerpo_html         text,
  p_firma               text
)
RETURNS public.cj_documentos
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.cj_documentos;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501';
  END IF;
  IF p_color_acento !~ '^#[0-9a-fA-F]{6}$' THEN
    RAISE EXCEPTION 'color_acento debe ser hex #rrggbb' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.cj_documentos (
    tema, destinatario_nombre, destinatario_email,
    kicker, titulo, color_acento, mostrar_logo, cuerpo_html, firma,
    created_by
  ) VALUES (
    p_tema, p_destinatario_nombre, NULLIF(p_destinatario_email, ''),
    COALESCE(NULLIF(p_kicker, ''), 'CONSULTORÍA JURÍDICA'),
    p_titulo, p_color_acento, p_mostrar_logo, p_cuerpo_html,
    NULLIF(p_firma, ''),
    auth.uid()
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cj_documento_crear(text,text,text,text,text,text,boolean,text,text) TO authenticated;


CREATE OR REPLACE FUNCTION public.cj_documento_actualizar(
  p_id                  uuid,
  p_tema                text,
  p_destinatario_nombre text,
  p_destinatario_email  text,
  p_kicker              text,
  p_titulo              text,
  p_color_acento        text,
  p_mostrar_logo        boolean,
  p_cuerpo_html         text,
  p_firma               text
)
RETURNS public.cj_documentos
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.cj_documentos;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501';
  END IF;
  IF p_color_acento !~ '^#[0-9a-fA-F]{6}$' THEN
    RAISE EXCEPTION 'color_acento debe ser hex #rrggbb' USING ERRCODE = '22023';
  END IF;

  UPDATE public.cj_documentos SET
    tema                = p_tema,
    destinatario_nombre = p_destinatario_nombre,
    destinatario_email  = NULLIF(p_destinatario_email, ''),
    kicker              = COALESCE(NULLIF(p_kicker, ''), 'CONSULTORÍA JURÍDICA'),
    titulo              = p_titulo,
    color_acento        = p_color_acento,
    mostrar_logo        = p_mostrar_logo,
    cuerpo_html         = p_cuerpo_html,
    firma               = NULLIF(p_firma, ''),
    -- al editar contenido invalidamos el PDF previo (debe regenerarse)
    pdf_storage_path    = NULL,
    pdf_generated_at    = NULL
  WHERE id = p_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento % no encontrado', p_id USING ERRCODE = '42P01';
  END IF;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cj_documento_actualizar(uuid,text,text,text,text,text,text,boolean,text,text) TO authenticated;


-- Setea el path del PDF generado (lo llama el frontend después de subir a storage)
CREATE OR REPLACE FUNCTION public.cj_documento_marcar_pdf(p_id uuid, p_storage_path text)
RETURNS public.cj_documentos
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.cj_documentos;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501';
  END IF;
  UPDATE public.cj_documentos SET
    pdf_storage_path = p_storage_path,
    pdf_generated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento % no encontrado', p_id USING ERRCODE = '42P01';
  END IF;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cj_documento_marcar_pdf(uuid, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.cj_documento_eliminar(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.cj_documentos WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cj_documento_eliminar(uuid) TO authenticated;


-- Marca el documento como enviado (lo invoca la edge function tras mandar el mail)
CREATE OR REPLACE FUNCTION public.cj_documento_marcar_enviado(p_id uuid, p_to text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501';
  END IF;
  UPDATE public.cj_documentos
     SET last_emailed_at = now(),
         last_emailed_to = p_to
   WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cj_documento_marcar_enviado(uuid, text) TO authenticated;


-- Listado para la grilla
CREATE OR REPLACE FUNCTION public.cj_documentos_listar()
RETURNS TABLE (
  id                   uuid,
  tema                 text,
  destinatario_nombre  text,
  destinatario_email   text,
  titulo               text,
  pdf_storage_path     text,
  pdf_generated_at     timestamptz,
  last_emailed_at      timestamptz,
  last_emailed_to      text,
  created_at           timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
STABLE
AS $$
  SELECT id, tema, destinatario_nombre, destinatario_email, titulo,
         pdf_storage_path, pdf_generated_at, last_emailed_at, last_emailed_to,
         created_at
  FROM public.cj_documentos
  WHERE private.is_staff()
  ORDER BY created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.cj_documentos_listar() TO authenticated;


-- Get full por id (para reabrir editor)
CREATE OR REPLACE FUNCTION public.cj_documento_get(p_id uuid)
RETURNS public.cj_documentos
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
STABLE
AS $$
  SELECT * FROM public.cj_documentos
   WHERE id = p_id AND private.is_staff()
   LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.cj_documento_get(uuid) TO authenticated;

-- =========================================================================
-- 4) Storage bucket privado cj-documentos
-- =========================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('cj-documentos', 'cj-documentos', false)
ON CONFLICT (id) DO NOTHING;

-- Policy: solo staff lee/escribe en este bucket
DROP POLICY IF EXISTS "cj_docs_staff_read" ON storage.objects;
CREATE POLICY "cj_docs_staff_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'cj-documentos' AND private.is_staff());

DROP POLICY IF EXISTS "cj_docs_staff_write" ON storage.objects;
CREATE POLICY "cj_docs_staff_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cj-documentos' AND private.is_staff());

DROP POLICY IF EXISTS "cj_docs_staff_update" ON storage.objects;
CREATE POLICY "cj_docs_staff_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'cj-documentos' AND private.is_staff())
  WITH CHECK (bucket_id = 'cj-documentos' AND private.is_staff());

DROP POLICY IF EXISTS "cj_docs_staff_delete" ON storage.objects;
CREATE POLICY "cj_docs_staff_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'cj-documentos' AND private.is_staff());
