-- ============================================================================
-- 0397 · DGG-123 — Switch Persona Física / Persona Jurídica en formularios RPAC
--
-- Pedido Pablo (doc "Sistema Gestion Global", 2026-07-30/31):
--  · Un ÚNICO formulario de inscripción dinámico con switch PF/PJ al inicio.
--    Jurídica agrega: razón social, CUIT de la empresa, domicilio de la
--    empresa, correo de la empresa + documentación societaria (lista
--    definitiva de Pablo). El form viejo "matriculacion-rpac-juridica"
--    (roto, 0 submissions) se cosechó (hints de razón social y CUIT) y se
--    desactiva junto con su servicio.
--  · Renovación y certificado: mismo switch + datos de la empresa, sin docs
--    nuevos (respuesta #7).
--  · Identidad (capítulo delicado): el cliente ES la persona jurídica. El
--    CUIT y el mail de la EMPRESA viajan en las claves canónicas `cuit` /
--    `email` (validan cuenta, dedupe, portal, facturación). El CUIT personal
--    del titular viaja en `cuit_titular_arca` (el gestor lo necesita: en ARCA
--    se entra con CUIT del titular + su clave fiscal). "Los mails podrían
--    coincidir [titular vs empresa]... los cuits nunca serán iguales" →
--    veto por CUIT en solicitud_match_cliente (abajo).
--
-- Motor (mismo chunk, frontend + edge): los campos ocultos por condición ya
-- NO viajan en el submit (runner + edge v11, con visibilidad en cascada) y
-- las secciones sin campos visibles no se renderizan.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Snapshot de seguridad: schemas actuales de los 4 forms RPAC → versiones.
-- ----------------------------------------------------------------------------
INSERT INTO public.formulario_versiones (formulario_id, version_num, schema)
SELECT f.id,
       COALESCE((SELECT MAX(v.version_num)
                   FROM public.formulario_versiones v
                  WHERE v.formulario_id = f.id), 0) + 1,
       f.schema
  FROM public.formularios f
 WHERE f.slug IN ('matriculacion-rpac', 'renovacion-rpac',
                  'certificado-rpac', 'matriculacion-rpac-juridica');

-- ----------------------------------------------------------------------------
-- 2) matriculacion-rpac → schema dual PF/PJ.
--    PF: idéntico al actual (los campos PF quedan condicionados al switch).
--    PJ: razón social + CUIT/mail de empresa en claves canónicas + docs
--    societarios definitivos. El domicilio compartido pasa a ser el de la
--    sede social (nota condicional). "Formación profesional" y los datos
--    para el certificado de antecedentes personales son solo-física.
-- ----------------------------------------------------------------------------
UPDATE public.formularios
   SET schema = $json$
{
  "sections": [
    {
      "title": "Tipo de solicitante",
      "fields": [
        {
          "name": "tipo_persona_solicitante",
          "type": "radio",
          "label": "¿Quién se inscribe al registro?",
          "hint": "Elegí \"Persona jurídica\" si quien se matricula es una sociedad (S.A., S.R.L., etc.).",
          "options": ["Persona física", "Persona jurídica"],
          "required": true
        },
        {
          "name": "nota_persona_juridica",
          "type": "html",
          "label": "<div style=\"border-left:4px solid #0EA5E9;background:#F0F9FF;padding:12px 16px;border-radius:8px;\"><p style=\"margin:0;color:#0c4a6e;font-size:14px;line-height:1.6;\"><strong>El cliente es la persona jurídica.</strong> La cuenta, el acceso al portal y la facturación se crean con el CUIT y el correo electrónico de la <strong>empresa</strong>. Los datos personales que se piden más abajo son los del titular vinculado en ARCA (ex AFIP).</p></div>",
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona jurídica" }
        },
        {
          "name": "razon_social",
          "type": "text",
          "label": "Razón social",
          "hint": "Tal como figura en el estatuto / contrato social.",
          "required": true,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona jurídica" }
        }
      ]
    },
    {
      "title": "Datos personales",
      "fields": [
        {
          "name": "nota_titular_arca",
          "type": "html",
          "label": "<div style=\"border-left:4px solid #F97316;background:#FFF7ED;padding:12px 16px;border-radius:8px;\"><p style=\"margin:0;color:#7c2d12;font-size:14px;line-height:1.6;\"><strong>Titular vinculado en ARCA:</strong> apellido, nombre, DNI y Clave Fiscal son los de la persona humana que representa a la sociedad. <strong>Empresa:</strong> el CUIT/CUIL y el correo electrónico deben ser los de la sociedad — con ellos se crea tu cuenta.</p></div>",
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona jurídica" }
        },
        { "name": "apellido", "type": "text", "label": "Apellido", "required": true },
        { "name": "nombre", "type": "text", "label": "Nombre", "required": true },
        { "hint": "Sin puntos ni guiones.", "name": "dni", "type": "text", "label": "DNI", "required": true },
        {
          "name": "padre_apellido_nombre",
          "type": "text",
          "label": "Apellido y nombres del padre",
          "required": true,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona física" }
        },
        {
          "name": "madre_apellido_nombre",
          "type": "text",
          "label": "Apellido y nombres de la madre",
          "required": true,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona física" }
        },
        {
          "hint": "11 dígitos sin guiones. Persona jurídica: acá va el CUIT de la EMPRESA (empieza con 30, 33 o 34).",
          "name": "cuit",
          "type": "text",
          "label": "CUIT/CUIL",
          "required": true
        },
        {
          "hint": "11 dígitos sin guiones. El CUIT/CUIL personal del titular (empieza con 20, 23, 24 o 27).",
          "name": "cuit_titular_arca",
          "type": "text",
          "label": "CUIT/CUIL del titular en ARCA",
          "required": true,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona jurídica" }
        },
        {
          "hint": "Tu clave fiscal de ARCA (ex AFIP). La usamos solo para gestionar este trámite y futuros tuyos.",
          "name": "clave_fiscal_arca",
          "type": "text",
          "label": "Clave Fiscal ARCA",
          "required": true,
          "sensitive": true
        },
        {
          "name": "email",
          "type": "email",
          "label": "Correo electrónico",
          "required": true,
          "placeholder": "tu@correo.com"
        },
        {
          "hint": "Incluí característica con el 9 (móvil).",
          "name": "celular",
          "type": "tel",
          "label": "Celular",
          "required": true,
          "placeholder": "+54 11 5555-1234"
        },
        {
          "name": "fecha_nacimiento",
          "type": "date",
          "label": "Fecha de nacimiento",
          "required": true,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona física" }
        },
        {
          "name": "nacionalidad",
          "type": "text",
          "label": "Nacionalidad",
          "required": true,
          "placeholder": "Argentina",
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona física" }
        },
        {
          "hint": "Si seleccionás casado/a o unión convivencial completá los datos del cónyuge debajo.",
          "name": "estado_civil",
          "type": "select",
          "label": "Estado civil",
          "options": ["soltero", "casado", "divorciado", "viudo", "union_convivencial"],
          "required": true,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona física" }
        },
        {
          "name": "apellido_nombre_conyuge",
          "type": "text",
          "label": "Apellido y nombre del cónyuge",
          "required": true,
          "condition": { "field": "estado_civil", "equals": ["casado", "union_convivencial"] }
        },
        {
          "name": "cuit_conyuge",
          "type": "text",
          "label": "CUIT/CUIL del cónyuge",
          "required": true,
          "condition": { "field": "estado_civil", "equals": ["casado", "union_convivencial"] }
        }
      ]
    },
    {
      "title": "Domicilio",
      "fields": [
        {
          "name": "nota_domicilio_empresa",
          "type": "html",
          "label": "<p style=\"margin:0;color:#475569;font-size:14px;\">Ingresá el domicilio legal de la <strong>empresa</strong> (sede social).</p>",
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona jurídica" }
        },
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
      "title": "Formación profesional",
      "fields": [
        {
          "name": "titulo",
          "type": "text",
          "label": "Título obtenido",
          "required": false,
          "placeholder": "Ej: Contador Público, Abogado, Curso de Administración…",
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona física" }
        },
        {
          "name": "institucion_titulo",
          "type": "text",
          "label": "Institución emisora del título",
          "required": false,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona física" }
        },
        {
          "name": "ano_egreso",
          "type": "number",
          "label": "Año de egreso",
          "required": false,
          "validation": { "max": 2050, "min": 1950 },
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona física" }
        }
      ]
    },
    {
      "title": "Documentación requerida",
      "subtitle": "Subí los archivos en PDF o JPG (máx 10MB cada uno).",
      "fields": [
        {
          "name": "dni_frente",
          "type": "file",
          "label": "DNI - Frente",
          "accept": ["application/pdf", "image/jpeg", "image/png"],
          "required": true,
          "max_files": 1,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona física" }
        },
        {
          "name": "dni_dorso",
          "type": "file",
          "label": "DNI - Dorso",
          "accept": ["application/pdf", "image/jpeg", "image/png"],
          "required": true,
          "max_files": 1,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona física" }
        },
        {
          "hint": "Foto color reciente, fondo blanco, sin lentes ni gorro.",
          "name": "foto_carnet",
          "type": "file",
          "label": "Foto carnet 4x4",
          "accept": ["image/jpeg", "image/png"],
          "required": true,
          "max_files": 1,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona física" }
        },
        {
          "hint": "Emitido por una entidad habilitada por el RPAC. También se admite constancia de inscripción al curso o de alumno regular.",
          "name": "certificado_curso_administradores",
          "type": "file",
          "label": "Certificado del Curso de formación de Administrador de Consorcios",
          "accept": ["application/pdf"],
          "required": true,
          "max_files": 1,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona física" }
        },
        {
          "hint": "Debe tener declarado el Código de Actividad 682010.",
          "name": "constancia_inscripcion_arca",
          "type": "file",
          "label": "Constancia de inscripción ARCA",
          "accept": ["application/pdf"],
          "preview": {
            "alt": "Ejemplo de Constancia de Inscripción ARCA — Monotributo, mostrando el código de actividad 682010 Servicios de administración de consorcios de edificios.",
            "url": "/form-previews/constancia-inscripcion-arca-ejemplo.png",
            "filename": "Constancia de Inscripción ARCA (Monotributo).pdf"
          },
          "required": true,
          "max_files": 1,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona física" }
        },
        {
          "hint": "Debe tener declarado el Código de Actividad 682010.",
          "name": "constancia_arba_iibb",
          "type": "file",
          "label": "Constancia de ARBA Ingresos Brutos",
          "accept": ["application/pdf"],
          "preview": {
            "alt": "Ejemplo de Constancia ARBA Ingresos Brutos — actividad principal 682010 Servicios de administración de consorcios de edificios.",
            "url": "/form-previews/constancia-arba-iibb-ejemplo.png",
            "filename": "Constancia ARBA Ingresos Brutos.pdf"
          },
          "required": true,
          "max_files": 1,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona física" }
        },
        {
          "name": "cv",
          "type": "file",
          "label": "Currículum Vitae (opcional)",
          "accept": ["application/pdf"],
          "required": false,
          "max_files": 1,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona física" }
        },
        {
          "hint": "Constancia de inscripción en ARCA a nombre de la sociedad. Debe tener declarado el Código de Actividad 682010.",
          "name": "constancia_cuit_empresa",
          "type": "file",
          "label": "Constancia de C.U.I.T. de la empresa",
          "accept": ["application/pdf"],
          "required": true,
          "max_files": 1,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona jurídica" }
        },
        {
          "hint": "Debe tener declarado el Código de Actividad 682010.",
          "name": "constancia_iibb_empresa",
          "type": "file",
          "label": "Constancia de Inscripción de Ingresos Brutos de la empresa",
          "accept": ["application/pdf"],
          "required": true,
          "max_files": 1,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona jurídica" }
        },
        {
          "hint": "SOLO si la empresa NO está inscripta en la Provincia de Buenos Aires.",
          "name": "certificado_vigencia",
          "type": "file",
          "label": "Certificado de vigencia de la sociedad",
          "accept": ["application/pdf"],
          "required": false,
          "max_files": 1,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona jurídica" }
        },
        {
          "hint": "Cada 20 edificios, la sociedad debe designar un representante técnico. En UN SOLO ARCHIVO PDF, cargá el escaneo del frente y dorso de todos los representantes declarados. Debe ser un solo archivo unificando todos los documentos; puede tener varias páginas.",
          "name": "dni_representantes_tecnicos",
          "type": "file",
          "label": "DNI (frente y dorso) de los representantes técnicos — un solo PDF",
          "accept": ["application/pdf"],
          "required": true,
          "max_files": 1,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona jurídica" }
        }
      ]
    },
    {
      "title": "Listado de consorcios (si ya estás administrando)",
      "subtitle": "Opcional. Si ya administrás consorcios, descargá la planilla modelo, completala y subila.",
      "fields": [
        {
          "hint": "Descargala, completala en tu computadora con los datos de los consorcios que administrás y subila más abajo.",
          "name": "planilla_consorcios_modelo",
          "type": "file_download",
          "label": "Descargá la planilla modelo",
          "required": false,
          "download_url": "https://kaoyhkebnidzqjixvchh.supabase.co/storage/v1/object/public/formulario-descargas/ddjj-anual/datos-de-consorcios-modelo.xlsx",
          "download_filename": "Datos de Consorcios - Gestión Global.xlsx"
        },
        {
          "hint": "Subí la planilla modelo que descargaste arriba ya completa.",
          "name": "planilla_consorcios_completa",
          "type": "file",
          "label": "Listado de consorcios administrados (planilla completa)",
          "required": false
        }
      ]
    },
    {
      "title": "Costos del trámite",
      "fields": [
        {
          "hint": "Honorarios + Gastos del trámite (certificados y tasas).",
          "name": "costos_matriculacion",
          "type": "costos_info",
          "label": "Costos del trámite",
          "costos": {
            "items": [
              {
                "nota": "Sujeto a modificación según el valor de las tasas.",
                "label": "Trámite de 15 días hábiles",
                "precio": "$175.000,00"
              }
            ],
            "cuenta": {
              "cvu": "0000003100053534352305",
              "alias": "GestionGlobal.ar",
              "titular": "Gabriela Beatriz Galeazzi",
              "cuit_cuil": "27225982746"
            },
            "nota_total": "La transferencia debe ser por el total informado."
          }
        },
        {
          "hint": "Transferencia, Mercado Pago o depósito a nombre de Gestión Global. Si vas a usar un voucher 100% lo podés ingresar en la sección \"Voucher\" y este campo se omitirá automáticamente.",
          "name": "comprobante_pago_matricula",
          "type": "file",
          "label": "Comprobante de pago de matrícula",
          "required": true
        }
      ]
    },
    {
      "title": "Declaración jurada",
      "fields": [
        {
          "name": "declaracion_jurada",
          "type": "checkbox",
          "label": "Declaro bajo juramento que los datos consignados son verdaderos",
          "required": true
        }
      ]
    }
  ],
  "post_submit": {
    "message": "Recibimos tu solicitud de matriculación. Vamos a revisar la documentación y nos contactamos por mail dentro de las 72 hs hábiles."
  },
  "submit_label": "Iniciar trámite de matriculación"
}
$json$::jsonb
 WHERE slug = 'matriculacion-rpac';

-- ----------------------------------------------------------------------------
-- 3) renovacion-rpac → switch + datos de la empresa (sin docs nuevos, resp. #7).
--    padre/madre (certificado de antecedentes personales) pasan a solo-física.
-- ----------------------------------------------------------------------------
UPDATE public.formularios
   SET schema = $json$
{
  "sections": [
    {
      "title": "Tipo de solicitante",
      "fields": [
        {
          "name": "tipo_persona_solicitante",
          "type": "radio",
          "label": "¿A nombre de quién está la matrícula?",
          "hint": "Elegí \"Persona jurídica\" si la matrícula está a nombre de una sociedad (S.A., S.R.L., etc.).",
          "options": ["Persona física", "Persona jurídica"],
          "required": true
        },
        {
          "name": "nota_persona_juridica",
          "type": "html",
          "label": "<div style=\"border-left:4px solid #0EA5E9;background:#F0F9FF;padding:12px 16px;border-radius:8px;\"><p style=\"margin:0;color:#0c4a6e;font-size:14px;line-height:1.6;\"><strong>El cliente es la persona jurídica.</strong> La cuenta, el acceso al portal y la facturación se gestionan con el CUIT y el correo electrónico de la <strong>empresa</strong>. Los datos personales que se piden más abajo son los del titular vinculado en ARCA (ex AFIP).</p></div>",
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona jurídica" }
        },
        {
          "name": "razon_social",
          "type": "text",
          "label": "Razón social",
          "hint": "Tal como figura en el estatuto / contrato social.",
          "required": true,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona jurídica" }
        },
        {
          "name": "domicilio_empresa",
          "type": "text",
          "label": "Domicilio de la empresa",
          "hint": "Domicilio legal de la sociedad (sede social): calle, número, piso/depto, localidad.",
          "required": true,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona jurídica" }
        }
      ]
    },
    {
      "title": "Identificación",
      "fields": [
        {
          "name": "nota_titular_arca",
          "type": "html",
          "label": "<div style=\"border-left:4px solid #F97316;background:#FFF7ED;padding:12px 16px;border-radius:8px;\"><p style=\"margin:0;color:#7c2d12;font-size:14px;line-height:1.6;\"><strong>Titular vinculado en ARCA:</strong> apellido, nombre, DNI y Clave Fiscal son los de la persona humana que representa a la sociedad. <strong>Empresa:</strong> el CUIT/CUIL y el correo electrónico deben ser los de la sociedad.</p></div>",
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona jurídica" }
        },
        { "name": "apellido", "type": "text", "label": "Apellido", "required": true },
        { "name": "nombre", "type": "text", "label": "Nombre", "required": true },
        { "hint": "Sin puntos ni guiones.", "name": "dni", "type": "text", "label": "DNI", "required": true },
        {
          "name": "padre_apellido_nombre",
          "type": "text",
          "label": "Apellido y nombres del padre",
          "required": true,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona física" }
        },
        {
          "name": "madre_apellido_nombre",
          "type": "text",
          "label": "Apellido y nombres de la madre",
          "required": true,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona física" }
        },
        {
          "hint": "11 dígitos sin guiones. Persona jurídica: acá va el CUIT de la EMPRESA (empieza con 30, 33 o 34).",
          "name": "cuit",
          "type": "text",
          "label": "CUIT/CUIL",
          "required": true
        },
        {
          "hint": "11 dígitos sin guiones. El CUIT/CUIL personal del titular (empieza con 20, 23, 24 o 27).",
          "name": "cuit_titular_arca",
          "type": "text",
          "label": "CUIT/CUIL del titular en ARCA",
          "required": true,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona jurídica" }
        },
        {
          "hint": "Tu clave fiscal de ARCA (ex AFIP).",
          "name": "clave_fiscal_arca",
          "type": "text",
          "label": "Clave Fiscal ARCA",
          "required": true,
          "sensitive": true
        },
        {
          "name": "email",
          "type": "email",
          "label": "Correo electrónico",
          "required": true,
          "placeholder": "tu@correo.com"
        },
        {
          "hint": "Incluí característica con el 9 (móvil).",
          "name": "celular",
          "type": "tel",
          "label": "Celular",
          "required": true,
          "placeholder": "+54 11 5555-1234"
        },
        {
          "hint": "Tal como figura en tu credencial.",
          "name": "matricula_rpac",
          "type": "text",
          "label": "Número de matrícula RPAC",
          "required": true
        },
        {
          "hint": "El número de legajo que te asignó el Registro al matricularte.",
          "name": "legajo_rpac",
          "type": "text",
          "label": "Número de legajo RPAC",
          "required": true
        }
      ]
    },
    {
      "title": "Documentación requerida",
      "subtitle": "Adjuntá la documentación actualizada.",
      "fields": [
        {
          "name": "dni_frente",
          "type": "file",
          "label": "DNI - Frente",
          "accept": ["application/pdf", "image/jpeg", "image/png"],
          "required": true,
          "max_files": 1
        },
        {
          "name": "dni_dorso",
          "type": "file",
          "label": "DNI - Dorso",
          "accept": ["application/pdf", "image/jpeg", "image/png"],
          "required": true,
          "max_files": 1
        },
        {
          "hint": "Aprobación del curso de actualización emitido por una entidad habilitada por el RPAC. También se admite constancia de inscripción al curso o de alumno regular.",
          "name": "certificado_curso_actualizacion_vigente",
          "type": "file",
          "label": "Certificado de curso de actualización",
          "accept": ["application/pdf"],
          "required": true,
          "max_files": 1
        },
        {
          "hint": "Debe tener declarado el Código de Actividad 682010.",
          "name": "constancia_arca_actualizada",
          "type": "file",
          "label": "Constancia ARCA actualizada",
          "accept": ["application/pdf"],
          "preview": {
            "alt": "Ejemplo de Constancia de Inscripción ARCA — Monotributo, mostrando el código de actividad 682010.",
            "url": "/form-previews/constancia-inscripcion-arca-ejemplo.png",
            "filename": "Constancia de Inscripción ARCA (Monotributo).pdf"
          },
          "required": true,
          "max_files": 1
        },
        {
          "hint": "Debe tener declarado el Código de Actividad 682010.",
          "name": "constancia_arba_iibb",
          "type": "file",
          "label": "Constancia de ARBA Ingresos Brutos",
          "accept": ["application/pdf"],
          "preview": {
            "alt": "Ejemplo de Constancia ARBA Ingresos Brutos — actividad principal 682010 Servicios de administración de consorcios de edificios.",
            "url": "/form-previews/constancia-arba-iibb-ejemplo.png",
            "filename": "Constancia ARBA Ingresos Brutos.pdf"
          },
          "required": true,
          "max_files": 1
        }
      ]
    },
    {
      "title": "Listado de consorcios actualizado",
      "fields": [
        {
          "hint": "Descargala, completala con los consorcios que administrás actualmente y subila más abajo.",
          "name": "planilla_consorcios_modelo",
          "type": "file_download",
          "label": "Descargá la planilla modelo",
          "required": false,
          "download_url": "https://kaoyhkebnidzqjixvchh.supabase.co/storage/v1/object/public/formulario-descargas/ddjj-anual/datos-de-consorcios-modelo.xlsx",
          "download_filename": "Datos de Consorcios - Gestión Global.xlsx"
        },
        {
          "hint": "Subí la planilla modelo que descargaste arriba ya completa.",
          "name": "planilla_consorcios_completa",
          "type": "file",
          "label": "Listado de consorcios administrados (planilla completa)",
          "required": true
        }
      ]
    },
    {
      "title": "Costos del trámite",
      "fields": [
        {
          "hint": "Honorarios + Gastos del trámite (certificados y tasas).",
          "name": "costos_renovacion",
          "type": "costos_info",
          "label": "Costos del trámite",
          "costos": {
            "items": [
              {
                "nota": "Sujeto a modificación según el valor de las tasas.",
                "label": "Trámite de 15 días hábiles",
                "precio": "$175.000,00"
              }
            ],
            "cuenta": {
              "cvu": "0000003100053534352305",
              "alias": "GestionGlobal.ar",
              "titular": "Gabriela Beatriz Galeazzi",
              "cuit_cuil": "27225982746"
            },
            "nota_total": "La transferencia debe ser por el total informado."
          }
        },
        {
          "hint": "Transferencia, Mercado Pago o depósito a nombre de Gestión Global. Si vas a usar un voucher 100% lo podés ingresar en la sección \"Voucher\" y este campo se omitirá automáticamente.",
          "name": "comprobante_pago_renovacion",
          "type": "file",
          "label": "Comprobante de pago de renovación",
          "required": true
        }
      ]
    },
    {
      "title": "Observaciones",
      "fields": [
        {
          "hint": "Algo que quieras dejar en claro para tu trámite.",
          "name": "observaciones",
          "type": "textarea",
          "label": "Observaciones",
          "required": false
        }
      ]
    },
    {
      "title": "Declaración jurada",
      "fields": [
        {
          "name": "declaracion_jurada",
          "type": "checkbox",
          "label": "Declaro bajo juramento que los datos consignados son verdaderos",
          "required": true
        }
      ]
    }
  ],
  "post_submit": {
    "message": "Recibimos tu pedido de renovación. Revisamos la documentación y te avisamos por mail en 48 hs hábiles."
  },
  "submit_label": "Solicitar renovación"
}
$json$::jsonb
 WHERE slug = 'renovacion-rpac';

-- ----------------------------------------------------------------------------
-- 4) certificado-rpac → switch + datos de la empresa (sin docs nuevos).
-- ----------------------------------------------------------------------------
UPDATE public.formularios
   SET schema = $json$
{
  "sections": [
    {
      "title": "Tipo de solicitante",
      "fields": [
        {
          "name": "tipo_persona_solicitante",
          "type": "radio",
          "label": "¿A nombre de quién está la matrícula?",
          "hint": "Elegí \"Persona jurídica\" si la matrícula está a nombre de una sociedad (S.A., S.R.L., etc.).",
          "options": ["Persona física", "Persona jurídica"],
          "required": true
        },
        {
          "name": "nota_persona_juridica",
          "type": "html",
          "label": "<div style=\"border-left:4px solid #0EA5E9;background:#F0F9FF;padding:12px 16px;border-radius:8px;\"><p style=\"margin:0;color:#0c4a6e;font-size:14px;line-height:1.6;\"><strong>El cliente es la persona jurídica.</strong> La cuenta, el acceso al portal y la facturación se gestionan con el CUIT y el correo electrónico de la <strong>empresa</strong>. Los datos personales que se piden más abajo son los del titular vinculado en ARCA (ex AFIP).</p></div>",
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona jurídica" }
        },
        {
          "name": "razon_social",
          "type": "text",
          "label": "Razón social",
          "hint": "Tal como figura en el estatuto / contrato social.",
          "required": true,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona jurídica" }
        },
        {
          "name": "domicilio_empresa",
          "type": "text",
          "label": "Domicilio de la empresa",
          "hint": "Domicilio legal de la sociedad (sede social): calle, número, piso/depto, localidad.",
          "required": true,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona jurídica" }
        }
      ]
    },
    {
      "title": "Datos del solicitante",
      "fields": [
        {
          "name": "nota_titular_arca",
          "type": "html",
          "label": "<div style=\"border-left:4px solid #F97316;background:#FFF7ED;padding:12px 16px;border-radius:8px;\"><p style=\"margin:0;color:#7c2d12;font-size:14px;line-height:1.6;\"><strong>Titular vinculado en ARCA:</strong> apellido, nombre, DNI y Clave Fiscal son los de la persona humana que representa a la sociedad. <strong>Empresa:</strong> el CUIT/CUIL y el correo electrónico deben ser los de la sociedad.</p></div>",
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona jurídica" }
        },
        { "name": "apellido", "type": "text", "label": "Apellido", "required": true, "placeholder": "García" },
        { "name": "nombre", "type": "text", "label": "Nombre", "required": true, "placeholder": "Diego" },
        { "hint": "Sin puntos ni guiones.", "name": "dni", "type": "text", "label": "DNI", "required": true },
        {
          "hint": "11 dígitos sin guiones. Persona jurídica: acá va el CUIT de la EMPRESA (empieza con 30, 33 o 34).",
          "name": "cuit",
          "type": "text",
          "label": "CUIT/CUIL",
          "required": true
        },
        {
          "hint": "11 dígitos sin guiones. El CUIT/CUIL personal del titular (empieza con 20, 23, 24 o 27).",
          "name": "cuit_titular_arca",
          "type": "text",
          "label": "CUIT/CUIL del titular en ARCA",
          "required": true,
          "condition": { "field": "tipo_persona_solicitante", "equals": "Persona jurídica" }
        },
        {
          "hint": "Tu clave fiscal de ARCA (ex AFIP).",
          "name": "clave_fiscal_arca",
          "type": "text",
          "label": "Clave Fiscal ARCA",
          "required": true,
          "sensitive": true
        },
        { "name": "email", "type": "email", "label": "Correo electrónico", "required": true },
        {
          "hint": "Incluí característica con el 9 (móvil).",
          "name": "celular",
          "type": "tel",
          "label": "Celular",
          "required": true,
          "placeholder": "+54 11 5555-1234"
        },
        {
          "hint": "Tal como figura en tu credencial.",
          "name": "matricula",
          "type": "text",
          "label": "Número de matrícula RPAC",
          "required": true
        },
        {
          "hint": "El número de legajo que te asignó el Registro al matricularte.",
          "name": "legajo_rpac",
          "type": "text",
          "label": "Número de legajo RPAC",
          "required": true
        }
      ]
    },
    {
      "title": "Vigencia y destino",
      "fields": [
        {
          "name": "destino_info",
          "type": "html",
          "label": "<div style=\"border-left:4px solid #0EA5E9;background:#F0F9FF;padding:12px 16px;border-radius:8px;\"><p style=\"margin:0;color:#0c4a6e;font-size:14px;line-height:1.6;\"><strong>El certificado es válido durante 30 días.</strong> Durante ese plazo se puede presentar ante consorcios (Asambleas) y cualquier entidad que lo requiera. No hace falta declarar el destino al solicitarlo.</p></div>"
        }
      ]
    },
    {
      "title": "Plazo de emisión",
      "fields": [
        {
          "hint": "El plazo estándar es de 5 días hábiles desde la confirmación del pago.",
          "name": "urgencia",
          "type": "radio",
          "label": "Plazo de emisión",
          "options": ["5_dias_habiles"],
          "required": true
        }
      ]
    },
    {
      "title": "Costos del trámite",
      "fields": [
        {
          "hint": "Honorarios + Gastos del trámite (certificados y tasas).",
          "name": "costos_certificado",
          "type": "costos_info",
          "label": "Costos del trámite",
          "costos": {
            "items": [
              {
                "nota": "Sujeto a modificación según el valor de las tasas.",
                "label": "Trámite de 5 días hábiles",
                "precio": "$35.000,00"
              }
            ],
            "cuenta": {
              "cvu": "0000003100053534352305",
              "alias": "GestionGlobal.ar",
              "titular": "Gabriela Beatriz Galeazzi",
              "cuit_cuil": "27225982746"
            },
            "nota_total": "La transferencia debe ser por el total informado."
          }
        },
        {
          "hint": "Transferencia, Mercado Pago o depósito a nombre de Gestión Global. Si vas a usar un voucher 100% lo podés ingresar en la sección \"Voucher\" y este campo se omitirá automáticamente.",
          "name": "comprobante_pago_certificado",
          "type": "file",
          "label": "Comprobante de pago de la solicitud",
          "required": true
        }
      ]
    },
    {
      "title": "Observaciones",
      "fields": [
        {
          "hint": "Algo que quieras dejar en claro para tu trámite.",
          "name": "observaciones",
          "type": "textarea",
          "label": "Observaciones",
          "required": false
        }
      ]
    }
  ],
  "post_submit": {
    "message": "Pedido registrado. Te enviamos el detalle de costos y plazo por mail."
  },
  "submit_label": "Pedir certificado"
}
$json$::jsonb
 WHERE slug = 'certificado-rpac';

-- ----------------------------------------------------------------------------
-- 5) Desaparecer el form jurídico viejo (roto, 0 submissions) + su servicio.
--    Nada se borra (regla de oro): sólo se desactivan. El schema quedó
--    snapshoteado en formulario_versiones (paso 1).
-- ----------------------------------------------------------------------------
UPDATE public.formularios SET activo = false WHERE slug = 'matriculacion-rpac-juridica';
UPDATE public.servicios   SET activo = false WHERE codigo = 'rpac_inscripcion_juridica';

-- ----------------------------------------------------------------------------
-- 6) Identidad PF/PJ · veto por CUIT en solicitud_match_cliente.
--    Mandato Pablo: "los mails podrían coincidir [titular vs empresa]...
--    los cuits nunca serán iguales" → si la submission trae un CUIT completo
--    (11 dígitos) y el candidato tiene CUIT distinto, NO es el mismo cliente
--    (ni por email ni por DNI). Misma firma → CREATE OR REPLACE es seguro
--    (R16 aplica a cambios de firma, acá no cambia).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.solicitud_match_cliente(p_submission_id uuid)
 RETURNS TABLE(administracion_id uuid, administracion_nombre text, cuit text, email text, match_por text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_datos jsonb;
  v_email text;
  v_cuit  text;
  v_dni   text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede consultar matches'
      USING ERRCODE = '42501';
  END IF;

  SELECT fs.datos INTO v_datos
    FROM public.formulario_submissions fs
   WHERE fs.id = p_submission_id;
  IF v_datos IS NULL THEN
    RETURN;
  END IF;

  -- Tolerante a nombres de campos variados — los formularios viejos usan
  -- 'apellido_nombre', 'cuit_cuil', etc. Normalizamos.
  v_email := lower(trim(COALESCE(
    v_datos->>'email',
    v_datos->>'correo',
    v_datos->>'correo_electronico'
  )));
  v_cuit  := regexp_replace(COALESCE(
    v_datos->>'cuit',
    v_datos->>'cuit_cuil',
    v_datos->>'cuil',
    ''
  ), '[^0-9]', '', 'g');
  v_dni   := regexp_replace(COALESCE(
    v_datos->>'dni',
    v_datos->>'documento',
    v_datos->>'numero_documento',
    ''
  ), '[^0-9]', '', 'g');

  -- Prioridad: email > cuit > dni. Sin nombre.
  -- DGG-123 · Veto por CUIT: con CUIT completo en la submission, un candidato
  -- con CUIT distinto se descarta aunque coincida email o DNI (caso titular
  -- que contrata como PF con el mismo mail que su sociedad, y viceversa).
  IF v_email <> '' THEN
    RETURN QUERY
      SELECT a.id, a.nombre, a.cuit, a.email, 'email'::text
        FROM public.administraciones a
       WHERE a.activo
         AND a.email IS NOT NULL
         AND lower(a.email) = v_email
         AND (length(v_cuit) <> 11 OR a.cuit IS NULL
              OR regexp_replace(a.cuit, '[^0-9]', '', 'g') = v_cuit)
       LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  IF v_cuit <> '' AND length(v_cuit) >= 8 THEN
    RETURN QUERY
      SELECT a.id, a.nombre, a.cuit, a.email, 'cuit'::text
        FROM public.administraciones a
       WHERE a.activo
         AND a.cuit IS NOT NULL
         AND regexp_replace(a.cuit, '[^0-9]', '', 'g') = v_cuit
       LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  IF v_dni <> '' AND length(v_dni) >= 7 THEN
    RETURN QUERY
      SELECT a.id, a.nombre, a.cuit, a.email, 'dni'::text
        FROM public.administraciones a
       WHERE a.activo
         AND a.responsable_dni IS NOT NULL
         AND regexp_replace(a.responsable_dni, '[^0-9]', '', 'g') = v_dni
         AND (length(v_cuit) <> 11 OR a.cuit IS NULL
              OR regexp_replace(a.cuit, '[^0-9]', '', 'g') = v_cuit)
       LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;
  -- Sin match
  RETURN;
END;
$function$;
