// submit-formulario v14 (E-GG-171 · §6 ultra del merge): (a) el pre-check de
// tamaño descuenta el padding base64 — un archivo de EXACTAMENTE 10 MB pasaba
// front y bucket pero el estimado floor(len*3/4) lo 422aba con mensaje
// contradictorio; (b) tope COMBINADO de 60 MB raw (~80 MB base64, probado OK;
// ~120 MB moría en 546 WORKER_RESOURCE_LIMIT tras subir todo) espejado en el
// runner.
// v13 (E-GG-170 · caso Rodríguez): los archivos se validan
// (tamaño/tipo espejo del bucket) y se suben a Storage ANTES de insertar la
// submission, con el id pre-generado para conservar el path
// `slug/<submission_id>/...`. Si Storage falla, se limpia lo subido y el
// usuario recibe un error claro — la submission NI SE CREA (el insert dispara
// triggers con side effects irreversibles: solicitud, mail "Recibimos tu
// formulario", notifs). Antes el orden era insert→upload y un upload fallido
// se tragaba con console.error → solicitud "válida" sin su adjunto
// obligatorio. Backstop: adjunto subido cuya fila no se pudo registrar →
// notify_all_gerentes. Sólo se aceptan files de campos `file` del schema.
// Historia: v12 strip de ocultos con cascada ANTES de identidad (DGG-123);
// v11 strip inicial post-identidad;
// v10 cliente logueado liga submission a SU administración por JWT;
// v9 presentacionales excluidos de validación; v8 condition.equals
// string|string[] (mig 0141); v7 origen_canal + voucher_codigo.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// R20 (E-GG-40): normaliza el nombre para la key de Storage. Espejo de
// src/lib/storageKeys.ts (los edge fns no pueden importar de src/): NFKD +
// remueve diacríticos + sólo [a-zA-Z0-9._-]. El replace(/[^\w.\-]/) anterior
// dejaba pasar acentos en algunos runtimes de Deno → key inválida.
function safeStorageKey(filename: string): string {
  if (!filename) return 'archivo';
  const clean = filename
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 200);
  return clean || 'archivo';
}

// E-GG-170: espejo de la config del bucket `form-adjuntos` (límite 10 MB +
// whitelist de MIME). Mantener EN SYNC con el bucket (storage.buckets) y con
// la validación del front (FormularioRunner.tsx). Sin esta pre-validación el
// rechazo recién ocurría en Storage, donde era silencioso.
const MAX_FILE_BYTES = 10 * 1024 * 1024;
// E-GG-171: tope combinado del envío. Mantener EN SYNC con el runner
// (MAX_TOTAL_ADJUNTOS_MB en FormularioRunner.tsx).
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
// Bytes EXACTOS de un base64 (descuenta el padding '='). El estimado
// floor(len*3/4) sobraba hasta 2 bytes y rechazaba archivos de exactamente
// 10 MB que el bucket sí acepta.
function bytesDeBase64(b64: string): number {
  const len = b64?.length ?? 0;
  if (len === 0) return 0;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor(len / 4) * 3 + (len % 4 === 0 ? 0 : Math.floor(((len % 4) * 3) / 4)) - pad;
}
const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const MIME_POR_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const FORMATOS_LABEL = 'JPG, PNG, WEBP, PDF o Excel';

// Algunos SOs entregan File.type vacío o genérico (§6 B#7a: providers de
// Android y Windows con registro roto reportan .xlsx como
// application/octet-stream): si el type declarado no está en la whitelist,
// caemos a la extensión antes de rechazar un archivo válido.
function inferMime(filename: string, given?: string): string {
  const g = (given ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (g && ALLOWED_MIMES.has(g)) return g;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME_POR_EXTENSION[ext] ?? g;
}

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

  // E-GG-170: sólo se aceptan archivos de campos `file` DEFINIDOS en el
  // schema. Un payload crafteado con files de campos inexistentes subía
  // objetos a Storage sin validación ni registro.
  if (Array.isArray(payload.files) && payload.files.length > 0) {
    const fileFields = new Set<string>();
    for (const s of schema.sections) {
      for (const f of s.fields) if (f.type === 'file') fileFields.add(f.name);
    }
    payload.files = payload.files.filter((f) => fileFields.has(f.field));
  }

  // 2a-pre · DGG-123 (auditor A §6): el strip de ocultos corre ANTES de la
  // validación de identidad — si no, un payload crafteado podía "pasar"
  // identidad con valores metidos en campos ocultos que luego se borraban,
  // persistiendo una submission sin esos datos.
  //
  // Los campos DEFINIDOS en el schema que estén ocultos por condición NO se
  // validan, NO se persisten y sus archivos NO se suben, aunque un payload
  // crafteado los mande (el runner ya los excluye). La visibilidad cascadea:
  // si el campo del que depende la condición está a su vez oculto, su valor
  // cuenta como vacío. Sin memo: la evaluación es fresh por campo, idéntica
  // al runner (un memo dependía del orden de iteración bajo ciclos de
  // condición). Claves fuera del schema (meta-campos, extraDatos de flujos
  // internos) pasan intactas.
  {
    const defs = new Map<string, FieldDef>();
    for (const s of schema.sections) for (const f of s.fields) defs.set(f.name, f);
    const esVisible = (f: FieldDef, seen: Set<string>): boolean => {
      if (!f.condition) return true;
      if (seen.has(f.name)) return false;
      seen.add(f.name);
      const dep = defs.get(f.condition.field);
      const depVisible = dep ? esVisible(dep, seen) : true;
      const val = depVisible ? String(payload.datos[f.condition.field] ?? '') : '';
      const target = f.condition.equals;
      return Array.isArray(target) ? target.includes(val) : val === target;
    };
    const ocultos = new Set<string>();
    for (const s of schema.sections) {
      for (const f of s.fields) {
        if (!esVisible(f, new Set())) ocultos.add(f.name);
      }
    }
    if (ocultos.size > 0) {
      for (const k of ocultos) delete payload.datos[k];
      if (Array.isArray(payload.files)) {
        payload.files = payload.files.filter((f) => !ocultos.has(f.field));
      }
    }
  }

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
        // §6 B#3c: cap server-side espejo del front (max_files ?? 1) — sin
        // esto un payload crafteado subía N archivos en un campo single.
        const capArchivos = field.max_files ?? 1;
        if (filesForField.length > capArchivos) {
          validationErrors.push(`${field.label}: máximo ${capArchivos} archivo(s)`);
        }
        // E-GG-170: pre-validación tamaño/tipo contra los límites del bucket
        // ANTES de crear la submission (caso Rodríguez: el rechazo de Storage
        // era silencioso y la solicitud quedaba sin su adjunto obligatorio).
        for (const f of filesForField) {
          const approxBytes = bytesDeBase64(f.base64 ?? '');
          // §6 B#1d: un archivo de 0 bytes (base64 vacío crafteado, o
          // placeholder de cloud drive no descargado en mobile) satisfacía
          // el required con un comprobante inservible.
          if (approxBytes === 0) {
            validationErrors.push(
              `${field.label}: «${f.filename}» está vacío (0 bytes). Volvé a adjuntarlo desde el dispositivo`,
            );
          }
          if (approxBytes > MAX_FILE_BYTES) {
            validationErrors.push(
              `${field.label}: «${f.filename}» pesa ${(approxBytes / 1048576).toFixed(1)} MB y el máximo es 10 MB. Comprimí la imagen o generá un PDF más liviano`,
            );
          }
          if (!ALLOWED_MIMES.has(inferMime(f.filename, f.mime))) {
            validationErrors.push(
              `${field.label}: el formato de «${f.filename}» no está soportado. Aceptamos ${FORMATOS_LABEL}`,
            );
          }
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
  // E-GG-171: tope combinado — espejo del runner (ver MAX_TOTAL_BYTES).
  {
    const totalBytes = (payload.files ?? []).reduce((acc, f) => acc + bytesDeBase64(f.base64 ?? ''), 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      validationErrors.push(
        `el conjunto de archivos pesa ${(totalBytes / 1048576).toFixed(0)} MB y el máximo total del envío es 60 MB. Comprimí las fotos más pesadas`,
      );
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

  // Reporte JL (puntos 2/4/5) · Si es un CLIENTE LOGUEADO (portal), ligar la
  // submission a SU administración por IDENTIDAD (el JWT), no por el email que
  // haya tipeado en el form. Esto: (a) dispara `sync_submission_a_administracion`
  // (propaga padre/madre/dni/dirección/etc. a su ficha), y (b) hace que
  // `crear_tramite_desde_submission_auto` ligue el trámite a su cuenta (solicitud
  // cliente_id ← administracion_id) → el trámite aparece en SU portal y NO se
  // crea un cliente-fantasma nuevo. Antes la submission nacía huérfana (0/24 con
  // administracion_id) → duplicación + datos perdidos + trámite invisible.
  let adminIdCliente: string | null = null;
  if (payload.origen_canal === 'cliente') {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (jwt) {
      try {
        const { data: userData } = await supabase.auth.getUser(jwt);
        const uid = userData?.user?.id;
        if (uid) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('administracion_id, role')
            .eq('id', uid)
            .single();
          if (prof?.role === 'administrador' && prof.administracion_id) {
            adminIdCliente = prof.administracion_id as string;
          }
        }
      } catch (e) {
        console.error('[submit-formulario] no se pudo resolver el cliente logueado:', e);
      }
    }
  }

  // E-GG-170 · ORDEN INVERTIDO: primero Storage, después la submission.
  // El insert de la submission dispara triggers con side effects
  // irreversibles (solicitud, mail "Recibimos tu formulario", notifs a
  // gerencia) — si un upload fallaba DESPUÉS, la solicitud quedaba "válida"
  // sin su adjunto obligatorio y el error se tragaba (caso Rodríguez,
  // curso-actualizacion 31/07). Ahora: si Storage rechaza, se limpia lo ya
  // subido y el usuario recibe un error claro; la submission NI SE CREA.
  // El id se pre-genera para conservar el path `slug/<submission_id>/...`.
  const submissionId = crypto.randomUUID();
  const subidos: Array<{ field: string; filename: string; path: string; mime: string; size: number }> = [];
  const pathsUsados = new Set<string>();
  if (payload.files && payload.files.length > 0) {
    for (const [idx, f] of payload.files.entries()) {
      try {
        const bin = atob(f.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        if (bytes.length > MAX_FILE_BYTES) {
          throw new Error(`supera el máximo de 10 MB`);
        }
        if (bytes.length === 0) {
          throw new Error(`está vacío (0 bytes)`);
        }
        const cleanName = safeStorageKey(f.filename);
        // §6 A#11: dos archivos con el mismo nombre saneado en el mismo campo
        // colisionaban (upsert:false → 409) y abortaban el envío entero con
        // mensaje engañoso. Desambiguamos con el índice sólo si hace falta.
        let path = `${formulario.slug}/${submissionId}/${f.field}-${cleanName}`;
        if (pathsUsados.has(path)) {
          path = `${formulario.slug}/${submissionId}/${f.field}-${idx}-${cleanName}`;
        }
        pathsUsados.add(path);
        const mime = inferMime(f.filename, f.mime) || 'application/octet-stream';
        const { error: errUp } = await supabase.storage
          .from('form-adjuntos')
          .upload(path, bytes, { contentType: mime, upsert: false });
        if (errUp) throw new Error(errUp.message);
        subidos.push({ field: f.field, filename: f.filename, path, mime, size: bytes.length });
      } catch (e) {
        console.error('[submit-formulario] upload falló, abortando envío:', f.filename, e);
        if (subidos.length > 0) {
          const { error: errRm } = await supabase.storage
            .from('form-adjuntos')
            .remove(subidos.map((s) => s.path));
          if (errRm) console.error('[submit-formulario] cleanup remove falló:', errRm.message);
        }
        return jsonError(
          502,
          `No pudimos guardar tu archivo adjunto («${f.filename}»). Tu solicitud NO quedó registrada. ` +
            `Revisá que sea ${FORMATOS_LABEL} de hasta 10 MB y volvé a intentarlo.`,
        );
      }
    }
  }

  const { data: submission, error: errIns } = await supabase
    .from('formulario_submissions')
    .insert({
      id: submissionId,
      formulario_id: formulario.id,
      datos,
      email_contacto: email_contacto ?? null,
      nombre_contacto,
      telefono_contacto: telefono_contacto ?? null,
      cuit_detectado,
      tipo_persona,
      // Cliente logueado → ligada a su admin (identidad por JWT); público → NULL.
      administracion_id: adminIdCliente,
      origen: adminIdCliente ? 'portal' : 'publico',
      ip_address: ipAddress,
      user_agent: userAgent,
      referer_url: referer,
    })
    .select('id, created_at')
    .single();

  if (errIns || !submission) {
    // Sin submission no dejamos huérfanos en Storage.
    if (subidos.length > 0) {
      const { error: errRm } = await supabase.storage
        .from('form-adjuntos')
        .remove(subidos.map((s) => s.path));
      if (errRm) console.error('[submit-formulario] cleanup remove falló:', errRm.message);
    }
    return jsonError(500, `No pudimos guardar la solicitud: ${errIns?.message ?? 'error'}`);
  }

  const adjuntosCreados: Array<{ field: string; filename: string; path: string }> = [];
  for (const s of subidos) {
    const row = {
      submission_id: submission.id,
      field_name: s.field,
      storage_path: s.path,
      filename_original: s.filename,
      mime_type: s.mime,
      size_bytes: s.size,
    };
    let { error: errRow } = await supabase.from('formulario_adjuntos').insert(row);
    if (errRow) {
      // Reintento único (transitorio de red/pool).
      ({ error: errRow } = await supabase.from('formulario_adjuntos').insert(row));
    }
    if (errRow) {
      // Backstop E-GG-170: el archivo SÍ está en Storage pero sin fila la
      // gerencia no lo ve en la grilla. Avisar para rescate manual, sin
      // romperle el envío al usuario (su archivo está a salvo).
      console.error('[submit-formulario] adjunto sin fila:', s.path, errRow.message);
      try {
        // §6 A#12: supabase.rpc no tira — capturar el {error} del resultado,
        // si no el backstop podía quedar mudo sin dejar rastro.
        const { error: errNotif } = await supabase.rpc('notify_all_gerentes', {
          p_evento_codigo: 'formulario_adjunto_huerfano',
          p_titulo: `Adjunto sin registrar en un envío de ${formulario.slug}`,
          p_cuerpo:
            `"${s.filename}" quedó subido en Storage (${s.path}) pero no se pudo registrar ` +
            `en la base (${errRow.message}). Revisar la submission ${submission.id} y recuperarlo manualmente.`,
          p_url: '/gerencia/formularios',
          p_send_email: true,
          p_related_table: 'formulario_submissions',
          p_related_id: submission.id,
        });
        if (errNotif) {
          console.error('[submit-formulario] backstop rpc devolvió error:', errNotif.message);
        }
      } catch (e) {
        console.error('[submit-formulario] backstop notify falló:', e);
      }
      continue;
    }
    adjuntosCreados.push({ field: s.field, filename: s.filename, path: s.path });
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
