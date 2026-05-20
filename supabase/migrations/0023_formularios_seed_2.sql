-- ============================================================================
-- 0023_formularios_seed_2 · 6 formularios públicos restantes (Documento Maestro)
-- + extensión del trigger submission → trámite para abarcar todas las
-- categorías 'tramite' y 'servicio'.
--
-- Decisiones / referencias:
-- - Regla 1: toda mutación de negocio persistida (los seeds van por migración).
-- - Regla 6: cambios de schema versionados (este archivo es el cambio).
-- - Regla 8 / E43: reusamos la columna existente `formulario_submission_id`
--   en `tramites` (definida en 0021_tramites.sql, línea 42). El brief pedía
--   `submission_id_origen`, pero crear una segunda columna con el mismo
--   propósito sería deuda inmediata. Se documenta acá y se reutiliza.
-- - Regla 5: la lógica de creación cruza 2 tablas (submissions → tramites) →
--   función plpgsql SECURITY DEFINER con search_path fijo, llamada desde
--   trigger AFTER INSERT.
-- - El motor de formularios (0020) es schema-driven; estos seeds solamente
--   declaran el `schema` jsonb. El runner los pinta automáticamente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Seed de los 6 formularios restantes
-- ---------------------------------------------------------------------------
INSERT INTO public.formularios (slug, titulo, descripcion, categoria, publico, orden, exige_aceptacion_terminos, schema)
VALUES
  -- ========================================================================
  -- (1) matriculacion-rpac · tramite
  -- ========================================================================
  (
    'matriculacion-rpac',
    'Inscripción al Registro Público de Administradores de Consorcios (RPAC)',
    'Trámite de matriculación inicial ante el RPAC (CABA). Adjuntá la documentación requerida y completá la declaración jurada.',
    'tramite',
    true,
    30,
    true,
    $json${
      "sections": [
        {
          "title": "Datos personales",
          "fields": [
            { "name": "apellido", "type": "text", "label": "Apellido", "required": true },
            { "name": "nombre", "type": "text", "label": "Nombre", "required": true },
            { "name": "dni", "type": "text", "label": "DNI", "required": true, "placeholder": "Sin puntos" },
            { "name": "cuit", "type": "text", "label": "CUIT/CUIL", "required": true, "placeholder": "11 dígitos sin guiones" },
            { "name": "fecha_nacimiento", "type": "date", "label": "Fecha de nacimiento", "required": true },
            { "name": "nacionalidad", "type": "text", "label": "Nacionalidad", "required": true, "placeholder": "Argentina" },
            { "name": "estado_civil", "type": "select", "label": "Estado civil", "required": true,
              "options": ["soltero","casado","divorciado","viudo","union_convivencial"] },
            { "name": "apellido_nombre_conyuge", "type": "text", "label": "Apellido y nombre del cónyuge",
              "required": true, "condition": { "field": "estado_civil", "equals": "casado" } },
            { "name": "cuit_conyuge", "type": "text", "label": "CUIT/CUIL del cónyuge",
              "required": true, "condition": { "field": "estado_civil", "equals": "casado" } }
          ]
        },
        {
          "title": "Domicilio",
          "fields": [
            { "name": "calle", "type": "text", "label": "Calle", "required": true },
            { "name": "numero", "type": "text", "label": "Número", "required": true },
            { "name": "piso", "type": "text", "label": "Piso", "required": false },
            { "name": "depto", "type": "text", "label": "Departamento", "required": false },
            { "name": "localidad", "type": "text", "label": "Localidad", "required": true },
            { "name": "provincia", "type": "text", "label": "Provincia", "required": true },
            { "name": "codigo_postal", "type": "text", "label": "Código postal", "required": true }
          ]
        },
        {
          "title": "Contacto",
          "fields": [
            { "name": "email", "type": "email", "label": "Correo electrónico", "required": true },
            { "name": "telefono", "type": "tel", "label": "Teléfono", "required": true },
            { "name": "telefono_alternativo", "type": "tel", "label": "Teléfono alternativo", "required": false }
          ]
        },
        {
          "title": "Formación profesional",
          "fields": [
            { "name": "titulo", "type": "text", "label": "Título obtenido", "required": true,
              "placeholder": "Ej: Contador Público, Abogado, Curso de Administración…" },
            { "name": "institucion_titulo", "type": "text", "label": "Institución emisora del título", "required": true },
            { "name": "ano_egreso", "type": "number", "label": "Año de egreso", "required": true,
              "validation": { "min": 1950, "max": 2050 } }
          ]
        },
        {
          "title": "Documentación requerida",
          "subtitle": "Subí los archivos en PDF o JPG (máx 10MB cada uno).",
          "fields": [
            { "name": "dni_frente", "type": "file", "label": "DNI - Frente", "required": true,
              "max_files": 1, "accept": ["application/pdf","image/jpeg","image/png"] },
            { "name": "dni_dorso", "type": "file", "label": "DNI - Dorso", "required": true,
              "max_files": 1, "accept": ["application/pdf","image/jpeg","image/png"] },
            { "name": "foto_carnet", "type": "file", "label": "Foto carnet 4x4", "required": true,
              "max_files": 1, "accept": ["image/jpeg","image/png"] },
            { "name": "titulo_secundario_o_superior", "type": "file",
              "label": "Título secundario o superior", "required": true,
              "max_files": 1, "accept": ["application/pdf","image/jpeg","image/png"] },
            { "name": "certificado_curso_administradores", "type": "file",
              "label": "Certificado del curso de administradores", "required": true,
              "max_files": 1, "accept": ["application/pdf"] },
            { "name": "constancia_inscripcion_afip", "type": "file",
              "label": "Constancia de inscripción AFIP", "required": true,
              "max_files": 1, "accept": ["application/pdf"] },
            { "name": "cv", "type": "file", "label": "Currículum Vitae (opcional)",
              "required": false, "max_files": 1, "accept": ["application/pdf"] }
          ]
        },
        {
          "title": "Declaración jurada",
          "fields": [
            { "name": "declaracion_jurada", "type": "checkbox",
              "label": "Declaro bajo juramento que los datos consignados son verdaderos",
              "required": true }
          ]
        }
      ],
      "submit_label": "Iniciar trámite de matriculación",
      "post_submit": {
        "message": "Recibimos tu solicitud de matriculación. Vamos a revisar la documentación y nos contactamos por mail dentro de las 72 hs hábiles."
      }
    }$json$::jsonb
  ),

  -- ========================================================================
  -- (2) renovacion-rpac · tramite
  -- ========================================================================
  (
    'renovacion-rpac',
    'Renovación bianual de matrícula RPAC',
    'Renovación periódica de la matrícula de administrador. Requiere certificado de curso de actualización con vencimiento menor a 2 años.',
    'tramite',
    true,
    40,
    true,
    $json${
      "sections": [
        {
          "title": "Identificación",
          "fields": [
            { "name": "matricula", "type": "text", "label": "Número de matrícula RPAC", "required": true },
            { "name": "apellido", "type": "text", "label": "Apellido", "required": true },
            { "name": "nombre", "type": "text", "label": "Nombre", "required": true },
            { "name": "dni", "type": "text", "label": "DNI", "required": true },
            { "name": "cuit", "type": "text", "label": "CUIT/CUIL", "required": true }
          ]
        },
        {
          "title": "Contacto",
          "fields": [
            { "name": "email", "type": "email", "label": "Correo electrónico", "required": true },
            { "name": "telefono", "type": "tel", "label": "Teléfono", "required": true }
          ]
        },
        {
          "title": "Antecedentes",
          "fields": [
            { "name": "trabajaste_otros_administradores", "type": "radio",
              "label": "¿Trabajaste para otros administradores en este período?", "required": true,
              "options": ["Sí","No"] },
            { "name": "lista_administraciones", "type": "textarea",
              "label": "Listá las administraciones (una por línea)", "required": true,
              "placeholder": "Razón social - Matrícula - Período",
              "condition": { "field": "trabajaste_otros_administradores", "equals": "Sí" } }
          ]
        },
        {
          "title": "Documentación requerida",
          "subtitle": "Adjuntá la documentación actualizada.",
          "fields": [
            { "name": "dni_frente", "type": "file", "label": "DNI - Frente", "required": true,
              "max_files": 1, "accept": ["application/pdf","image/jpeg","image/png"] },
            { "name": "dni_dorso", "type": "file", "label": "DNI - Dorso", "required": true,
              "max_files": 1, "accept": ["application/pdf","image/jpeg","image/png"] },
            { "name": "certificado_curso_actualizacion_vigente", "type": "file",
              "label": "Certificado de curso de actualización (vencimiento < 2 años)", "required": true,
              "max_files": 1, "accept": ["application/pdf"],
              "hint": "El certificado debe tener menos de 2 años de antigüedad." },
            { "name": "constancia_afip_actualizada", "type": "file",
              "label": "Constancia AFIP actualizada", "required": true,
              "max_files": 1, "accept": ["application/pdf"] }
          ]
        },
        {
          "title": "Declaración jurada",
          "fields": [
            { "name": "declaracion_jurada", "type": "checkbox",
              "label": "Declaro bajo juramento que los datos consignados son verdaderos",
              "required": true }
          ]
        }
      ],
      "submit_label": "Solicitar renovación",
      "post_submit": {
        "message": "Recibimos tu pedido de renovación. Revisamos la documentación y te avisamos por mail en 48 hs hábiles."
      }
    }$json$::jsonb
  ),

  -- ========================================================================
  -- (3) certificado-rpac · tramite
  -- ========================================================================
  (
    'certificado-rpac',
    'Certificado de matrícula RPAC activa',
    'Solicitá un certificado oficial de matrícula vigente para presentar ante organismos o consorcios.',
    'tramite',
    true,
    50,
    false,
    $json${
      "sections": [
        {
          "title": "Datos del solicitante",
          "fields": [
            { "name": "matricula", "type": "text", "label": "Número de matrícula RPAC", "required": true },
            { "name": "apellido_nombre", "type": "text", "label": "Apellido y nombre", "required": true },
            { "name": "dni", "type": "text", "label": "DNI", "required": true },
            { "name": "cuit", "type": "text", "label": "CUIT/CUIL", "required": true },
            { "name": "email", "type": "email", "label": "Correo electrónico", "required": true },
            { "name": "telefono", "type": "tel", "label": "Teléfono", "required": true }
          ]
        },
        {
          "title": "Destino del certificado",
          "fields": [
            { "name": "destino_certificado", "type": "select",
              "label": "¿A quién va dirigido el certificado?", "required": true,
              "options": ["presentacion_a_organismo","consorcio","otra"] },
            { "name": "cuit_consorcio", "type": "text", "label": "CUIT del consorcio",
              "required": true,
              "condition": { "field": "destino_certificado", "equals": "consorcio" } },
            { "name": "denominacion_consorcio", "type": "text", "label": "Denominación del consorcio",
              "required": true,
              "condition": { "field": "destino_certificado", "equals": "consorcio" } }
          ]
        },
        {
          "title": "Urgencia",
          "fields": [
            { "name": "urgencia", "type": "radio", "label": "Plazo de emisión", "required": true,
              "options": ["normal","urgente_48hs","urgente_24hs"],
              "hint": "Las opciones urgentes tienen costo adicional. Te confirmamos por mail antes de procesar." }
          ]
        }
      ],
      "submit_label": "Pedir certificado",
      "post_submit": {
        "message": "Pedido registrado. Te enviamos el detalle de costos y plazo por mail."
      }
    }$json$::jsonb
  ),

  -- ========================================================================
  -- (4) ddjj-anual · tramite
  -- ========================================================================
  (
    'ddjj-anual',
    'Declaración Jurada anual de administrador',
    'Presentación de la DDJJ anual obligatoria. Detallá los consorcios administrados durante el período fiscal.',
    'tramite',
    true,
    60,
    true,
    $json${
      "sections": [
        {
          "title": "Identificación",
          "fields": [
            { "name": "matricula_rpac", "type": "text", "label": "Número de matrícula RPAC", "required": true },
            { "name": "apellido_nombre", "type": "text", "label": "Apellido y nombre", "required": true },
            { "name": "dni", "type": "text", "label": "DNI", "required": true },
            { "name": "cuit", "type": "text", "label": "CUIT/CUIL", "required": true },
            { "name": "email", "type": "email", "label": "Correo electrónico", "required": true },
            { "name": "telefono", "type": "tel", "label": "Teléfono", "required": true }
          ]
        },
        {
          "title": "Período declarado",
          "fields": [
            { "name": "periodo", "type": "select", "label": "Año fiscal", "required": true,
              "options": ["2022","2023","2024","2025","2026"] }
          ]
        },
        {
          "title": "Consorcios administrados",
          "fields": [
            { "name": "cantidad_consorcios_administrados", "type": "number",
              "label": "Cantidad de consorcios administrados en el período", "required": true,
              "validation": { "min": 0, "max": 9999 } },
            { "name": "consorcios", "type": "textarea",
              "label": "Listado de consorcios (uno por línea)",
              "placeholder": "CUIT - Razón social - Domicilio",
              "required": false,
              "hint": "Una línea por consorcio. Si declarás 0, dejá vacío." }
          ]
        },
        {
          "title": "Documentación requerida",
          "fields": [
            { "name": "nomina_consorcios_pdf", "type": "file",
              "label": "Nómina de consorcios (PDF firmado)", "required": true,
              "max_files": 1, "accept": ["application/pdf"] },
            { "name": "comprobante_pago_dgr", "type": "file",
              "label": "Comprobante de pago DGR", "required": true,
              "max_files": 1, "accept": ["application/pdf"],
              "hint": "Solo si declaraste al menos un consorcio." }
          ]
        },
        {
          "title": "Declaración jurada",
          "fields": [
            { "name": "declaracion_jurada", "type": "checkbox",
              "label": "Declaro bajo juramento que los datos consignados son verdaderos",
              "required": true }
          ]
        }
      ],
      "submit_label": "Presentar DDJJ",
      "post_submit": {
        "message": "DDJJ recibida. Revisamos y te confirmamos la presentación por mail."
      }
    }$json$::jsonb
  ),

  -- ========================================================================
  -- (5) curso-formacion · curso
  -- ========================================================================
  (
    'curso-formacion',
    'Curso inicial de formación de administradores',
    'Inscribite al curso de formación inicial para futuros administradores de consorcios.',
    'curso',
    true,
    70,
    true,
    $json${
      "sections": [
        {
          "title": "Tus datos",
          "fields": [
            { "name": "apellido", "type": "text", "label": "Apellido", "required": true },
            { "name": "nombre", "type": "text", "label": "Nombre", "required": true },
            { "name": "dni", "type": "text", "label": "DNI", "required": true },
            { "name": "fecha_nacimiento", "type": "date", "label": "Fecha de nacimiento", "required": true }
          ]
        },
        {
          "title": "Contacto",
          "fields": [
            { "name": "email", "type": "email", "label": "Correo electrónico", "required": true },
            { "name": "telefono", "type": "tel", "label": "Teléfono / Celular", "required": true },
            { "name": "localidad", "type": "text", "label": "Localidad", "required": true },
            { "name": "provincia", "type": "text", "label": "Provincia", "required": true }
          ]
        },
        {
          "title": "Sobre vos",
          "fields": [
            { "name": "nivel_educativo", "type": "radio", "label": "Nivel educativo alcanzado", "required": true,
              "options": [
                "secundario_completo",
                "terciario_incompleto",
                "terciario_completo",
                "universitario_incompleto",
                "universitario_completo"
              ] },
            { "name": "motivacion", "type": "textarea",
              "label": "Contanos por qué te interesa el curso",
              "required": false,
              "placeholder": "Es opcional, pero nos ayuda a conocerte." },
            { "name": "como_nos_conociste", "type": "select",
              "label": "¿Cómo nos conociste?", "required": true,
              "options": ["instagram","facebook","google","recomendacion","sitio_web","otro"] }
          ]
        },
        {
          "title": "Modalidad",
          "fields": [
            { "name": "modalidad_preferida", "type": "radio",
              "label": "Modalidad de cursado preferida", "required": true,
              "options": ["presencial","virtual_vivo","asincronica"] }
          ]
        },
        {
          "title": "Términos",
          "fields": [
            { "name": "acepta_terminos", "type": "checkbox",
              "label": "Acepto los términos y condiciones de la inscripción",
              "required": true }
          ]
        }
      ],
      "submit_label": "Inscribirme",
      "post_submit": {
        "message": "Inscripción registrada. Te enviamos por mail el cronograma de la próxima cohorte y el detalle de pago."
      }
    }$json$::jsonb
  ),

  -- ========================================================================
  -- (6) curso-actualizacion · curso
  -- ========================================================================
  (
    'curso-actualizacion',
    'Curso de actualización para administradores',
    'Curso obligatorio para mantener la matrícula RPAC vigente. Modalidad presencial, virtual en vivo o asincrónica.',
    'curso',
    true,
    80,
    true,
    $json${
      "sections": [
        {
          "title": "Identificación",
          "fields": [
            { "name": "apellido", "type": "text", "label": "Apellido", "required": true },
            { "name": "nombre", "type": "text", "label": "Nombre", "required": true },
            { "name": "dni", "type": "text", "label": "DNI", "required": true },
            { "name": "matricula_rpac", "type": "text", "label": "Número de matrícula vigente", "required": true }
          ]
        },
        {
          "title": "Contacto",
          "fields": [
            { "name": "email", "type": "email", "label": "Correo electrónico", "required": true },
            { "name": "telefono", "type": "tel", "label": "Teléfono", "required": true }
          ]
        },
        {
          "title": "Antecedentes",
          "fields": [
            { "name": "ano_ultima_actualizacion", "type": "number",
              "label": "Año de la última actualización realizada", "required": true,
              "validation": { "min": 2000, "max": 2050 } },
            { "name": "comprobante_matricula_vigente", "type": "file",
              "label": "Comprobante de matrícula vigente (opcional)",
              "required": false, "max_files": 1,
              "accept": ["application/pdf","image/jpeg","image/png"] }
          ]
        },
        {
          "title": "Modalidad",
          "fields": [
            { "name": "modalidad_preferida", "type": "radio",
              "label": "Modalidad de cursado preferida", "required": true,
              "options": ["presencial","virtual_vivo","asincronica"] }
          ]
        },
        {
          "title": "Términos",
          "fields": [
            { "name": "acepta_terminos", "type": "checkbox",
              "label": "Acepto los términos y condiciones de la inscripción",
              "required": true }
          ]
        }
      ],
      "submit_label": "Inscribirme al curso",
      "post_submit": {
        "message": "Inscripción registrada. Te enviamos por mail las fechas y el detalle de pago."
      }
    }$json$::jsonb
  )
ON CONFLICT (slug) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 2) Trigger forms → trámites: extensión para categorías 'tramite' y 'servicio'
--
-- NOTA (Regla 8 / E43): la columna pedida en el brief como `submission_id_origen`
-- ya existe en `tramites` con el nombre `formulario_submission_id` (definida en
-- migración 0021_tramites.sql, línea 42, con su índice idx_tramites_submission).
-- Crear una columna sinónima sería deuda inmediata, así que reusamos la
-- existente y solo extendemos el comportamiento del trigger.
--
-- Mapping slug → categoria de trámite (enum válido del CHECK de `tramites`):
--   matriculacion-rpac → matricula
--   renovacion-rpac    → renovacion
--   certificado-rpac   → matricula
--   ddjj-anual         → dj
--   consultoria-juridica → consulta_juridica (ya existente)
--   (otros formularios de categoría 'tramite'/'servicio' no mapeados → 'otro')
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.crear_tramite_desde_submission_auto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_slug text;
  v_form_titulo text;
  v_form_categoria text;
  v_tramite_categoria text;
  v_titulo text;
  v_descripcion text;
  v_apellido text;
  v_nombre text;
  v_nombre_completo text;
BEGIN
  SELECT slug, titulo, categoria
    INTO v_slug, v_form_titulo, v_form_categoria
    FROM public.formularios
   WHERE id = NEW.formulario_id;

  -- Solo creamos trámite automático para categorías 'tramite' / 'servicio' /
  -- 'consulta' (esta última conserva el comportamiento original del 0021).
  IF v_form_categoria NOT IN ('tramite','servicio','consulta') THEN
    RETURN NEW;
  END IF;

  -- Mapeo slug → categoria de la tabla `tramites`.
  v_tramite_categoria := CASE v_slug
    WHEN 'consultoria-juridica' THEN 'consulta_juridica'
    WHEN 'matriculacion-rpac'   THEN 'matricula'
    WHEN 'renovacion-rpac'      THEN 'renovacion'
    WHEN 'certificado-rpac'     THEN 'matricula'
    WHEN 'ddjj-anual'           THEN 'dj'
    ELSE 'otro'
  END;

  -- Apellido / nombre denormalizados (con fallback al nombre_contacto que
  -- ya calcula la edge function submit-formulario).
  v_apellido := NULLIF(trim(COALESCE(NEW.datos->>'apellido', '')), '');
  v_nombre   := NULLIF(trim(COALESCE(NEW.datos->>'nombre', '')), '');
  v_nombre_completo := COALESCE(
    NEW.nombre_contacto,
    NULLIF(trim(concat_ws(' ', v_apellido, v_nombre)), ''),
    NEW.email_contacto,
    'sin contacto'
  );

  v_titulo := v_form_titulo || ' · ' || v_nombre_completo;

  -- Descripción = payload pretty-printed (cap a 4KB defensivo).
  v_descripcion := left(jsonb_pretty(NEW.datos), 4000);

  INSERT INTO public.tramites (
    titulo, descripcion, categoria, prioridad, estado,
    formulario_submission_id, administracion_id,
    solicitante_nombre, solicitante_email, solicitante_telefono
  )
  VALUES (
    v_titulo,
    v_descripcion,
    v_tramite_categoria,
    'normal',
    'abierto',
    NEW.id,
    NEW.administracion_id,   -- típicamente NULL en submission público
    v_nombre_completo,
    NEW.email_contacto,
    NEW.telefono_contacto
  );

  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.crear_tramite_desde_submission_auto() FROM PUBLIC, anon, authenticated;

-- El trigger trg_subm_auto_tramite ya existe (0021 línea 495) y apunta a esta
-- función. CREATE OR REPLACE sobre la función basta — no recreamos el trigger.

COMMENT ON FUNCTION public.crear_tramite_desde_submission_auto() IS
  'Trigger AFTER INSERT en formulario_submissions. Crea trámite automático para '
  'formularios de categoría tramite/servicio/consulta. administracion_id queda '
  'NULL salvo que la submission ya esté asociada; gerencia la asigna luego.';
