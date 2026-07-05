// submit-formulario v9: presentacionales (file_download/costos_info) excluidos de
// la validación, en sync con el runner (F5 · consistencia de skip-lists).
// Historia: v8 condition.equals acepta string|string[] (mig 0141); v7 origen_canal +
// voucher_codigo; voucher 100% saltea el required de campos file.

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
  condition?: { field: string; equals: string | string[] };
  validation?: { min?: number; max?: number; pattern?: string };
}
interface SectionDef { title?: string; fields: FieldDef[]; }
interface SchemaDef { sections: SectionDef[]; submit_label?: string; }

interface SubmitPayload {
  slug: string;
  datos: Record<string, unknown>;
  files?: Array<{ field: string; base64: string; filename: string; mime?: string }>;
  /** publico (landing) | cliente (portal logueado). Condiciona precio_aplicado + alcance del voucher. */
  origen_canal?: 'publico' | 'cliente';
  /** Código de voucher opcional. El trigger DB lo valida y aplica el descuento. */
  voucher_codigo?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'Method not allowed');

  let payload: SubmitPayload;
  try { payload = await req.json(); } catch { return jsonError(400, 'JSON inválido'); }

  if (!payload.slug) return jsonError(400, 'slug requerido');
  if (!payload.datos || typeof payload.datos !== 'object') return jsonError(400, 'datos requerido');

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: formulario, error: errForm } = await supabase
    .from('formularios')
    .select('id, slug, titulo, schema, activo, publico, cierre_at, mensaje_confirmacion, redirect_url_after, notificar_a_emails, servicio_id')
    .eq('slug', payload.slug)
    .single();
  if (errForm || !formulario) return jsonError(404, `Formulario "${payload.slug}" no encontrado`);
  if (!formulario.activo) return jsonError(410, 'Este formulario ya no está disponible');
  if (formulario.cierre_at && new Date(formulario.cierre_at) < new Date()) return jsonError(410, 'Este formulario está cerrado');

  const schema = formulario.schema as SchemaDef;

  // 2a. Identidad obligatoria (DGG 2026-05-29).
  const identityErrors = validarIdentidadObligatoria(payload.datos);
  if (identityErrors.length > 0) {
    return jsonError(
      422,
      `Faltan datos para identificarte como cliente: ${identityErrors.join(', ')}. Si ya tenés cuenta, ingresá desde tu portal en gestionglobal.ar.`,
    );
  }

  // 2b. Pre-check del voucher: si es 100%, skipeamos la validación required
  // de campos file (no se exige comprobante de pago). El trigger DB hace la
  // validación autoritaria + incrementa usos; acá sólo necesitamos saber si
  // saltearnos los files required.
  let voucherEs100 = false;
  if (
    typeof payload.voucher_codigo === 'string' &&
    payload.voucher_codigo.trim().length > 0 &&
    formulario.servicio_id
  ) {
    const { data: vRes } = await supabase.rpc('voucher_validar', {
      p_codigo: payload.voucher_codigo.trim(),
      p_servicio_id: formulario.servicio_id,
      p_es_cliente: payload.origen_canal === 'cliente',
    });
    const obj = (vRes ?? {}) as Record<string, unknown>;
    if (obj.valido === true && obj.es_100 === true) voucherEs100 = true;
  }

  // 2c. Validar datos contra el schema.
  const validationErrors: string[] = [];
  for (const section of schema.sections) {
    for (const field of section.fields) {
      // Presentacionales (sin dato del usuario): no se validan ni persisten.
      // Mantener en sync con el runner (FormularioRunner) — F5 · consistencia.
      if (['heading', 'separator', 'html', 'file_download', 'costos_info'].includes(field.type)) continue;
      if (field.condition) {
        const dep = String(payload.datos[field.condition.field] ?? '');
        const target = field.condition.equals;
        const visible = Array.isArray(target) ? target.includes(dep) : dep === target;
        if (!visible) continue;
      }
      const val = payload.datos[field.name];
      const empty = val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0);
      if (field.type === 'file') {
        const filesForField = (payload.files ?? []).filter((f) => f.field === field.name);
        if (field.required && filesForField.length === 0 && !voucherEs100) {
          validationErrors.push(`${field.label}: requerido`);
        }
        if (field.max_files && filesForField.length > field.max_files) {
          validationErrors.push(`${field.label}: máximo ${field.max_files} archivos`);
        }
        continue;
      }
      if (field.required && empty) { validationErrors.push(`${field.label}: requerido`); continue; }
      if (empty) continue;
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
  if (validationErrors.length > 0) return jsonError(422, `Datos inválidos: ${validationErrors.join('; ')}`);

  // 2d. Inyectar meta-campos para el trigger DB (mig 0135).
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
    [pickByKeys(datos, ['apellido']), pickByKeys(datos, ['nombre', 'nombres'])].filter(Boolean).join(' ').trim() ||
    null;

  const cuit = String(pickByKeys(datos, ['cuit', 'cuit_persona_juridica']) ?? '').replace(/\D/g, '');
  let tipo_persona: 'fisica' | 'juridica' | null = null;
  let cuit_detectado: string | null = null;
  if (/^\d{11}$/.test(cuit)) {
    cuit_detectado = cuit;
    const prefix = cuit.slice(0, 2);
    if (['30', '33', '34'].includes(prefix)) tipo_persona = 'juridica';
    else if (['20', '23', '24', '27'].includes(prefix)) tipo_persona = 'fisica';
  }

  const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = req.headers.get('user-agent') ?? null;
  const referer = req.headers.get('referer') ?? null;

  // E-GG-88 · Rate-limit anti-spam por IP: máx 12 envíos en 10 min desde la misma
  // conexión. Generoso para uso legítimo (incluso oficinas detrás de NAT) pero
  // frena floods automatizados. Usa el service_role (bypassa RLS) sobre la misma
  // tabla que ya loguea la IP. Si falla el conteo, no bloquea (fail-open).
  if (ipAddress) {
    const desde = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count, error: errRate } = await supabase
      .from('formulario_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('ip_address', ipAddress)
      .gte('created_at', desde);
    if (!errRate && (count ?? 0) >= 12) {
      return jsonError(
        429,
        'Recibimos varias solicitudes desde tu conexión en pocos minutos. Esperá unos minutos y volvé a intentarlo.',
      );
    }
  }

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

  if (errIns || !submission) return jsonError(500, `No pudimos guardar la solicitud: ${errIns?.message ?? 'error'}`);

  const adjuntosCreados: Array<{ field: string; filename: string; path: string }> = [];
  if (payload.files && payload.files.length > 0) {
    for (const f of payload.files) {
      try {
        const bin = atob(f.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const cleanName = f.filename.replace(/[^\w.\-]/g, '_').slice(0, 80);
        const path = `${formulario.slug}/${submission.id}/${f.field}-${cleanName}`;
        const { error: errUp } = await supabase.storage
          .from('form-adjuntos')
          .upload(path, bytes, { contentType: f.mime ?? 'application/octet-stream', upsert: false });
        if (errUp) { console.error('upload error', errUp); continue; }
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

function validarIdentidadObligatoria(datos: Record<string, unknown>): string[] {
  const faltantes: string[] = [];
  const apellido = pickByKeys(datos, ['apellido']);
  const nombre = pickByKeys(datos, ['nombre', 'nombres']);
  const apellidoNombre = pickByKeys(datos, ['apellido_nombre', 'nombre_completo', 'razon_social']);
  if (!apellidoNombre || apellidoNombre.split(/\s+/).filter(Boolean).length < 2) {
    if (!apellido) faltantes.push('Apellido');
    if (!nombre) faltantes.push('Nombre');
  }
  const dniRaw = String(pickByKeys(datos, ['dni', 'documento', 'numero_documento']) ?? '').replace(/\D/g, '');
  if (dniRaw.length < 7) faltantes.push('DNI');
  const cuitRaw = String(pickByKeys(datos, ['cuit', 'cuit_cuil', 'cuil', 'cuit_persona_juridica']) ?? '').replace(/\D/g, '');
  if (cuitRaw.length !== 11) faltantes.push('CUIT/CUIL');
  const emailRaw = pickByKeys(datos, ['email', 'correo', 'correo_electronico']);
  if (!emailRaw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) faltantes.push('Correo electrónico');
  const celRaw = String(pickByKeys(datos, ['celular', 'telefono', 'tel', 'movil']) ?? '').replace(/\D/g, '');
  if (celRaw.length < 8) faltantes.push('Celular');
  return faltantes;
}
