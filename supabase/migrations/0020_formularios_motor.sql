-- ============================================================================
-- 0020_formularios_motor · motor de formularios inteligentes (Phase 2C MVP).
-- Base extensible para los 8 formularios del Documento Maestro de Formularios:
-- webinarios, jurídica, matriculación RPAC, renovación, certificado, DJ,
-- curso formación, curso actualización. Soporta modalidades pública/privada,
-- adjuntos, lógica condicional declarativa en jsonb, tracking de submissions.
--
-- Decisiones de diseño:
-- - Schema del formulario en jsonb → flexible sin migraciones por cada cambio
-- - Submissions con datos jsonb + denormalización de email/nombre/cuit para
--   búsqueda rápida y tracking
-- - Adjuntos en tabla separada con vínculo al storage bucket 'form-adjuntos'
-- - RLS: anon puede INSERT submissions/adjuntos; SELECT solo staff
-- - publico=true → SELECT del formulario desde anon; false → solo staff/portal
-- ============================================================================

-- ---------------------------------------------------------------------------
-- formularios · definición de cada formulario
-- ---------------------------------------------------------------------------
CREATE TABLE public.formularios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  titulo text NOT NULL,
  descripcion text,
  categoria text NOT NULL CHECK (categoria IN (
    'captacion','tramite','servicio','curso','evento','consulta'
  )),
  -- schema describe el formulario: secciones + campos + lógica condicional.
  -- Ver estructura esperada al final de esta migración.
  schema jsonb NOT NULL,

  -- Modalidad
  publico boolean NOT NULL DEFAULT true,
  activo boolean NOT NULL DEFAULT true,
  cierre_at timestamptz,                    -- fecha de cierre opcional

  -- Recursos asociados (descargables)
  pdf_descargable_url text,
  excel_modelo_url text,
  hero_imagen_url text,

  -- Textos legales
  textos_legales text,
  exige_aceptacion_terminos boolean NOT NULL DEFAULT false,

  -- Vínculos a otras entidades (futuras integraciones)
  servicio_id uuid REFERENCES public.servicios(id) ON DELETE SET NULL,

  -- Configuración de notificaciones
  notificar_a_emails text[] NOT NULL DEFAULT '{}'::text[],
  mensaje_confirmacion text NOT NULL DEFAULT 'Recibimos tu solicitud. Nos contactamos pronto.',
  redirect_url_after text,

  -- Métricas denormalizadas
  total_envios int NOT NULL DEFAULT 0,
  orden int NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_formularios_slug ON public.formularios(slug) WHERE activo;
CREATE INDEX idx_formularios_categoria ON public.formularios(categoria) WHERE activo;

CREATE TRIGGER trg_formularios_touch
  BEFORE UPDATE ON public.formularios
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_formularios_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.formularios
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- ---------------------------------------------------------------------------
-- formulario_submissions · cada envío del formulario
-- ---------------------------------------------------------------------------
CREATE TABLE public.formulario_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formulario_id uuid NOT NULL
    REFERENCES public.formularios(id) ON DELETE RESTRICT,

  -- Datos enviados (clave de campo → valor)
  datos jsonb NOT NULL,

  -- Denormalizados para búsqueda/tracking
  email_contacto text,
  nombre_contacto text,
  telefono_contacto text,
  cuit_detectado text,
  tipo_persona text CHECK (tipo_persona IS NULL OR tipo_persona IN ('fisica','juridica')),

  -- Origen
  origen text NOT NULL DEFAULT 'publico'
    CHECK (origen IN ('publico','portal','interno','importacion')),
  ip_address inet,
  user_agent text,
  referer_url text,

  -- Estado / tracking
  estado text NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','en_revision','procesado','rechazado','duplicado')),
  observaciones_internas text,
  procesado_at timestamptz,
  procesado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Vínculos a entidades del sistema (cuando aplica)
  administracion_id uuid REFERENCES public.administraciones(id) ON DELETE SET NULL,
  comprobante_id uuid REFERENCES public.comprobantes(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_subm_formulario ON public.formulario_submissions(formulario_id, created_at DESC);
CREATE INDEX idx_subm_estado ON public.formulario_submissions(estado, created_at DESC);
CREATE INDEX idx_subm_email ON public.formulario_submissions(email_contacto) WHERE email_contacto IS NOT NULL;
CREATE INDEX idx_subm_cuit ON public.formulario_submissions(cuit_detectado) WHERE cuit_detectado IS NOT NULL;
CREATE INDEX idx_subm_admin ON public.formulario_submissions(administracion_id) WHERE administracion_id IS NOT NULL;

CREATE TRIGGER trg_subm_touch
  BEFORE UPDATE ON public.formulario_submissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_subm_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.formulario_submissions
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- Incrementar contador del formulario al crear submission
CREATE OR REPLACE FUNCTION public.incrementar_envios_formulario()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.formularios
    SET total_envios = total_envios + 1
  WHERE id = NEW.formulario_id;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.incrementar_envios_formulario() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_subm_incrementa_form
  AFTER INSERT ON public.formulario_submissions
  FOR EACH ROW EXECUTE FUNCTION public.incrementar_envios_formulario();

-- ---------------------------------------------------------------------------
-- formulario_adjuntos · archivos subidos por submission
-- ---------------------------------------------------------------------------
CREATE TABLE public.formulario_adjuntos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL
    REFERENCES public.formulario_submissions(id) ON DELETE CASCADE,
  field_name text NOT NULL,        -- a qué campo corresponde
  storage_path text NOT NULL,      -- path completo en el bucket
  filename_original text NOT NULL,
  mime_type text,
  size_bytes int,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_adjuntos_submission ON public.formulario_adjuntos(submission_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.formularios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formulario_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formulario_adjuntos ENABLE ROW LEVEL SECURITY;

-- formularios: anon SELECT si público y activo; staff full
DROP POLICY IF EXISTS formularios_select_public ON public.formularios;
CREATE POLICY formularios_select_public ON public.formularios
  FOR SELECT TO anon, authenticated
  USING (publico = true AND activo = true);

DROP POLICY IF EXISTS formularios_staff_all ON public.formularios;
CREATE POLICY formularios_staff_all ON public.formularios
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

-- submissions: anon puede INSERT (es público); staff SELECT/UPDATE; nadie DELETE
DROP POLICY IF EXISTS subm_insert_anon ON public.formulario_submissions;
CREATE POLICY subm_insert_anon ON public.formulario_submissions
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS subm_staff_select ON public.formulario_submissions;
CREATE POLICY subm_staff_select ON public.formulario_submissions
  FOR SELECT TO authenticated
  USING (private.is_staff());

DROP POLICY IF EXISTS subm_staff_update ON public.formulario_submissions;
CREATE POLICY subm_staff_update ON public.formulario_submissions
  FOR UPDATE TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

-- adjuntos: anon INSERT (durante el submit); staff SELECT/DELETE
DROP POLICY IF EXISTS adj_insert_anon ON public.formulario_adjuntos;
CREATE POLICY adj_insert_anon ON public.formulario_adjuntos
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS adj_staff_select ON public.formulario_adjuntos;
CREATE POLICY adj_staff_select ON public.formulario_adjuntos
  FOR SELECT TO authenticated
  USING (private.is_staff());

DROP POLICY IF EXISTS adj_staff_delete ON public.formulario_adjuntos;
CREATE POLICY adj_staff_delete ON public.formulario_adjuntos
  FOR DELETE TO authenticated
  USING (private.is_staff());

-- ---------------------------------------------------------------------------
-- Bucket de storage para adjuntos de formularios públicos.
-- Path estructura: form-adjuntos/<formulario_slug>/<submission_id>/<filename>
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'form-adjuntos',
  'form-adjuntos',
  false,                          -- privado: solo staff con signed URL
  10485760,                       -- 10MB por archivo
  ARRAY['image/jpeg','image/png','image/webp','application/pdf','application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
ON CONFLICT (id) DO NOTHING;

-- RLS sobre storage.objects para este bucket
DROP POLICY IF EXISTS form_adj_insert ON storage.objects;
CREATE POLICY form_adj_insert ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'form-adjuntos');

DROP POLICY IF EXISTS form_adj_select_staff ON storage.objects;
CREATE POLICY form_adj_select_staff ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'form-adjuntos' AND private.is_staff());

DROP POLICY IF EXISTS form_adj_delete_staff ON storage.objects;
CREATE POLICY form_adj_delete_staff ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'form-adjuntos' AND private.is_staff());

-- ---------------------------------------------------------------------------
-- Seed: 2 formularios de los 8 del Documento Maestro
--
-- Estructura del schema jsonb (descripción inline):
-- {
--   "sections": [
--     {
--       "title": "...", "subtitle": "...",
--       "fields": [
--         { "name": "campo_id", "type": "text|email|tel|number|date|textarea|
--                                        select|multiselect|radio|checkbox|
--                                        file|html|heading|separator",
--           "label": "...",
--           "placeholder": "...",
--           "required": true|false,
--           "hint": "...",
--           "options": ["..."],       // para select/multiselect/radio
--           "max_files": 1|2|...,     // para type=file
--           "accept": ["application/pdf","image/*"],  // para type=file
--           "validation": { "min": ..., "max": ..., "pattern": "..." },
--           "condition": { "field": "...", "equals": "..." }  // mostrar solo si
--         }
--       ]
--     }
--   ],
--   "submit_label": "Enviar",
--   "post_submit": {
--     "message": "...",
--     "redirect_url": "...",
--     "derivar_a_formulario_slug": "..."   // para formularios derivados
--   }
-- }
-- ---------------------------------------------------------------------------

INSERT INTO public.formularios (slug, titulo, descripcion, categoria, publico, orden, schema)
VALUES
  (
    'webinarios',
    'Inscripción a webinarios gratuitos',
    'Capacitaciones abiertas para administradores. Te avisamos por mail antes de cada encuentro.',
    'evento',
    true,
    10,
    '{
      "sections": [
        {
          "title": "Tus datos",
          "fields": [
            { "name": "apellido", "type": "text", "label": "Apellido", "required": true, "placeholder": "García" },
            { "name": "nombre", "type": "text", "label": "Nombre", "required": true, "placeholder": "Diego" },
            { "name": "email", "type": "email", "label": "Correo electrónico", "required": true, "placeholder": "tu@correo.com" },
            { "name": "celular", "type": "tel", "label": "Celular", "required": true, "placeholder": "+54 11 5555-1234" }
          ]
        },
        {
          "title": "Sobre vos",
          "fields": [
            { "name": "rol", "type": "radio", "label": "¿Sos administrador matriculado?", "required": true,
              "options": ["RPA CABA","RPAC Buenos Aires","Más de un registro","Ningún registro"] },
            { "name": "origen", "type": "radio", "label": "¿Cómo te enteraste del webinario?", "required": true,
              "options": ["WhatsApp","Redes sociales","Mail","Me lo contó un amigo"] },
            { "name": "pregunta", "type": "textarea", "label": "Dejanos tu pregunta (opcional)", "required": false,
              "placeholder": "Algo que te gustaría que tratemos en el encuentro…" }
          ]
        }
      ],
      "submit_label": "Anotarme al webinario",
      "post_submit": {
        "message": "¡Listo! Te vamos a mandar el link del encuentro por mail unos días antes.",
        "redirect_url": null
      }
    }'::jsonb
  ),
  (
    'consultoria-juridica',
    'Solicitud de consultoría jurídica',
    'Asesoramiento sobre propiedad horizontal, actas, reglamentos y procedimientos.',
    'consulta',
    true,
    20,
    '{
      "sections": [
        {
          "title": "Quién consulta",
          "fields": [
            { "name": "apellido_nombre", "type": "text", "label": "Apellido y nombre", "required": true },
            { "name": "email", "type": "email", "label": "Correo electrónico", "required": true },
            { "name": "administracion", "type": "text", "label": "Nombre de la administración", "required": true }
          ]
        },
        {
          "title": "Tu consulta",
          "fields": [
            { "name": "consulta", "type": "textarea", "label": "¿Cuál es la consulta?", "required": true,
              "placeholder": "Contanos los detalles que necesitemos saber…" },
            { "name": "requiere_analisis", "type": "radio", "label": "¿Requiere análisis de actas o reglamentos?", "required": true,
              "options": ["Sí","No"] },
            { "name": "docs_analisis", "type": "file", "label": "Adjuntar documentación para análisis",
              "required": false, "max_files": 2,
              "accept": ["application/pdf","image/*"],
              "condition": { "field": "requiere_analisis", "equals": "Sí" },
              "hint": "Hasta 2 archivos (PDF o imágenes), 10MB cada uno." }
          ]
        },
        {
          "title": "Pago",
          "fields": [
            { "name": "comprobante_pago", "type": "file", "label": "Adjuntar comprobante de pago",
              "required": true, "max_files": 1,
              "accept": ["application/pdf","image/*"],
              "hint": "Subí el comprobante de pago para confirmar la solicitud." }
          ]
        }
      ],
      "submit_label": "Enviar consulta",
      "post_submit": {
        "message": "Recibimos tu consulta. Un miembro del equipo jurídico se va a contactar en las próximas 48 hs hábiles.",
        "redirect_url": null
      }
    }'::jsonb
  )
ON CONFLICT (slug) DO NOTHING;
