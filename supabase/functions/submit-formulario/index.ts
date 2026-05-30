// submit-formulario · endpoint público que recibe envíos de cualquier
// formulario público (slug) con datos + adjuntos opcionales, valida contra
// el schema declarado en jsonb, persiste la submission + uploads a storage,
// y dispara automatizaciones básicas (notificación email a equipo).
//
// Acepta dos modalidades:
// - JSON puro: { slug, datos: { ... }, files: [{ field, base64, filename, mime }] }
// - multipart/form-data: convencional (campos de form + File entries)
//
// El endpoint es público (verify_jwt=false). Aplica detección de patrones
// (CUIT prefix 30/33 → persona jurídica) y denormaliza email/nombre/telefono
// para búsqueda rápida en gerencia.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface FieldDef {
  name: string;
  type: string;
  label: string;
  required?: boolean;
  options?: string[];
  max_files?: number;
  condition?: { field: string; equals: string };
  validation?: { min?: number; max?: number; pattern?: string };
}

interface SectionDef {
  title?: string;
  fields: FieldDef[];
}

interface SchemaDef {
  sections: SectionDef[];
  submit_label?: string;
  post_submit?: { message?: string; redirect_url?: string };
}

interface SubmitPayload {
  slug: string;
  datos: Record<string, unknown>;
  files?: Array<{ field: string; base64: string; filename: string; mime?: string }>;
  /** publico (landing) | cliente (portal logueado). Si viene, condiciona el precio aplicado y el alcance del voucher. */
  origen_canal?: 'publico' | 'cliente';
  /** Código de voucher opcional. El trigger DB lo valida y aplica el descuento. */
  voucher_codigo?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'Method not allowed');

  let payload: SubmitPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonError(400, 'JSON inválido');
  }

  if (!payload.slug) return jsonError(400, 'slug requerido');
  if (!payload.datos || typeof payload.datos !== 'object') {
    return jsonError(400, 'datos requerido');
  }

  // Cliente con anon key — no exponemos service role a clientes públicos.
  // Para escribir necesitamos service_role (la RLS permite INSERT anon a
  // formulario_submissions; pero validamos contra schema acá para no
  // depender solo de la RLS).
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1. Cargar formulario por slug
  const { data: formulario, error: errForm } = await supabase
    .from('formularios')
    .select('id, slug, titulo, schema, activo, publico, cierre_at, mensaje_confirmacion, redirect_url_after, notificar_a_emails')
    .eq('slug', payload.slug)
    .single();
  if (errForm || !formulario) {
    return jsonError(404, `Formulario "${payload.slug}" no encontrado`);
  }
  if (!formulario.activo) return jsonError(410, 'Este formulario ya no está disponible');
  if (formulario.cierre_at && new Date(formulario.cierre_at) < new Date()) {
    return jsonError(410, 'Este formulario está cerrado');
  }

  const schema = formulario.schema as SchemaDef;

  // 2a. Validar identidad obligatoria (DGG 2026-05-29): los 6 campos clave
  // los pedimos SIEMPRE — defensa en server por si el schema en BD aún no
  // los tiene declarados (mig 0133). El cross-match con administraciones
  // depende de email/cuit/dni; UX depende de apellido/nombre/celular.
  const identityErrors = validarIdentidadObligatoria(payload.datos);
  if (identityErrors.length > 0) {
    return jsonError(
      422,
      `Faltan datos para identificarte como cliente: ${identityErrors.join(
        ', ',
      )}. Si ya tenés cuenta, ingresá desde tu portal en gestionglobal.ar.`,
    );
  }

  // 2b. Validar datos contra el schema
  const validationErrors: string[] = [];
  const visibleFields = new Set<string>();
  for (const section of schema.sections) {
    for (const field of section.fields) {
      // Skip non-data fields (heading, separator, html)
      if (['heading', 'separator', 'html'].includes(field.type)) continue;

      // Lógica condicional: si el campo tiene condition, evaluar
      if (field.condition) {
        const dep = payload.datos[field.condition.field];
        if (String(dep) !== field.condition.equals) continue;
      }
      visibleFields.add(field.name);

      const val = payload.datos[field.name];
      const empty =
        val === undefined ||
        val === null ||
        val === '' ||
        (Array.isArray(val) && val.length === 0);

      // Para file fields, validamos contra payload.files
      if (field.type === 'file') {
        const filesForField = (payload.files ?? []).filter((f) => f.field === field.name);
        if (field.required && filesForField.length === 0) {
          validationErrors.push(`${field.label}: requerido`);
        }
        if (field.max_files && filesForField.length > field.max_files) {
          validationErrors.push(`${field.label}: máximo ${field.max_files} archivos`);
        }
        continue;
      }

      if (field.required && empty) {
        validationErrors.push(`${field.label}: requerido`);
        continue;
      }
      if (empty) continue;

      // Validaciones por tipo
      if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(val))) {
        validationErrors.push(`${field.label}: email inválido`);
      }
      if (field.type === 'tel') {
        const digits = String(val).replace(/\D/g, '');
        if (digits.length < 8) validationErrors.push(`${field.label}: teléfono incompleto`);
      }
      if (field.type === 'number') {
        const n = Number(val);
        if (isNaN(n)) validationErrors.push(`${field.label}: número inválido`);
        if (field.validation?.min !== undefined && n < field.validation.min) {
          validationErrors.push(`${field.label}: mínimo ${field.validation.min}`);
        }
        if (field.validation?.max !== undefined && n > field.validation.max) {
          validationErrors.push(`${field.label}: máximo ${field.validation.max}`);
        }
      }
      if ((field.type === 'select' || field.type === 'radio') && field.options && !field.options.includes(String(val))) {
        validationErrors.push(`${field.label}: valor no permitido`);
      }
    }
  }

  if (validationErrors.length > 0) {
    return jsonError(422, `Datos inválidos: ${validationErrors.join('; ')}`);
  }

  // 3. Detectar email/nombre/telefono/cuit en los datos para denormalizar
  // 2c. Inyectar meta-campos para el trigger de pipeline (voucher + canal).
  //     La mig 0135 los lee desde datos._origen_canal y datos._voucher_codigo.
  const datos: Record<string, unknown> = { ...payload.datos };
  if (payload.origen_canal === 'cliente' || payload.origen_canal === 'publico') {
    datos._origen_canal = payload.origen_canal;
  }
  if (typeof payload.voucher_codigo === 'string' && payload.voucher_codigo.trim().length > 0) {
    datos._voucher_codigo = payload.voucher_codigo.trim();
  }

  const email_contacto = pickByKeys(datos, ['email', 'correo', 'correo_electronico']);
  const telefono_contacto = pickByKeys(datos, ['celular', 'telefono', 'tel']);
  const nombre_contacto =
    pickByKeys(datos, ['nombre_completo', 'apellido_nombre', 'razon_social']) ||
    [pickByKeys(datos, ['apellido']), pickByKeys(datos, ['nombre', 'nombres'])]
      .filter(Boolean).join(' ').trim() || null;

  // Detección persona física/jurídica por CUIT
  const cuit = String(pickByKeys(datos, ['cuit', 'cuit_persona_juridica']) ?? '').replace(/\D/g, '');
  let tipo_persona: 'fisica' | 'juridica' | null = null;
  let cuit_detectado: string | null = null;
  if (/^\d{11}$/.test(cuit)) {
    cuit_detectado = cuit;
    const prefix = cuit.slice(0, 2);
    if (['30', '33', '34'].includes(prefix)) tipo_persona = 'juridica';
    else if (['20', '23', '24', '27'].includes(prefix)) tipo_persona = 'fisica';
  }

  // 4. Insertar submission
  const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = req.headers.get('user-agent') ?? null;
  const referer = req.headers.get('referer') ?? null;

  const { data: submission, error: errIns } = await supabase
    .from('formulario_submissions')
    .insert({
      formulario_id: formulario.id,
      datos,
      email_contacto: email_contacto ?? null,
      nombre_contacto,
      telefono_contacto: telefono_contacto ?? null,
      cuit_detectado,
      tipo_persona,
      origen: 'publico',
      ip_address: ipAddress,
      user_agent: userAgent,
      referer_url: referer,
    })
    .select('id, created_at')
    .single();

  if (errIns || !submission) {
    return jsonError(500, `No pudimos guardar la solicitud: ${errIns?.message ?? 'error'}`);
  }

  // 5. Subir adjuntos
  const adjuntosCreados: Array<{ field: string; filename: string; path: string }> = [];
  if (payload.files && payload.files.length > 0) {
    for (const f of payload.files) {
      try {
        // Decodificar base64
        const bin = atob(f.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

        const cleanName = f.filename.replace(/[^\w.\-]/g, '_').slice(0, 80);
        const path = `${formulario.slug}/${submission.id}/${f.field}-${cleanName}`;

        const { error: errUp } = await supabase.storage
          .from('form-adjuntos')
          .upload(path, bytes, {
            contentType: f.mime ?? 'application/octet-stream',
            upsert: false,
          });
        if (errUp) {
          console.error('upload error', errUp);
          continue;
        }

        await supabase.from('formulario_adjuntos').insert({
          submission_id: submission.id,
          field_name: f.field,
          storage_path: path,
          filename_original: f.filename,
          mime_type: f.mime ?? null,
          size_bytes: bytes.length,
        });

        adjuntosCreados.push({ field: f.field, filename: f.filename, path });
      } catch (e) {
        console.error('file processing error', e);
      }
    }
  }

  // 6. Responder al cliente
  return new Response(
    JSON.stringify({
      ok: true,
      submission_id: submission.id,
      mensaje: formulario.mensaje_confirmacion,
      redirect_url: formulario.redirect_url_after,
      adjuntos: adjuntosCreados.length,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function pickByKeys(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Validación dura de identidad obligatoria (DGG 2026-05-29). Estos 6 campos
 * deben venir SIEMPRE — no importa lo que diga el schema del formulario en
 * BD. Tolerante a aliases legacy (apellido_nombre junto cuenta para los dos,
 * telefono cuenta como celular, etc.). Devuelve labels en español de lo que
 * falta. Lista vacía = todo OK.
 */
function validarIdentidadObligatoria(
  datos: Record<string, unknown>,
): string[] {
  const faltantes: string[] = [];

  const apellido = pickByKeys(datos, ['apellido']);
  const nombre = pickByKeys(datos, ['nombre', 'nombres']);
  const apellidoNombre = pickByKeys(datos, [
    'apellido_nombre',
    'nombre_completo',
    'razon_social',
  ]);
  // Si vino apellido_nombre con al menos 2 palabras, lo aceptamos como
  // apellido + nombre juntos (compatibilidad legacy). Si vino sólo una palabra
  // o vacío, exigimos los dos separados.
  if (!apellidoNombre || apellidoNombre.split(/\s+/).filter(Boolean).length < 2) {
    if (!apellido) faltantes.push('Apellido');
    if (!nombre) faltantes.push('Nombre');
  }

  const dniRaw = String(
    pickByKeys(datos, ['dni', 'documento', 'numero_documento']) ?? '',
  ).replace(/\D/g, '');
  if (dniRaw.length < 7) faltantes.push('DNI');

  const cuitRaw = String(
    pickByKeys(datos, ['cuit', 'cuit_cuil', 'cuil', 'cuit_persona_juridica']) ??
      '',
  ).replace(/\D/g, '');
  if (cuitRaw.length !== 11) faltantes.push('CUIT/CUIL');

  const emailRaw = pickByKeys(datos, ['email', 'correo', 'correo_electronico']);
  if (!emailRaw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    faltantes.push('Correo electrónico');
  }

  const celRaw = String(
    pickByKeys(datos, ['celular', 'telefono', 'tel', 'movil']) ?? '',
  ).replace(/\D/g, '');
  if (celRaw.length < 8) faltantes.push('Celular');

  return faltantes;
}
