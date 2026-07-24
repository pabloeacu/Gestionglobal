// corregir-email-acceso · DGG-117 · "Corregir mail de acceso" de la ficha del
// cliente: la gerencia carga SOLO el email nuevo y la plataforma hace todo.
//
// Wizard automático (pedido de Pablo, 2026-07-24 — caso Nogueira):
//   1. Cambia el email de LOGIN del usuario existente (mismo UUID → el
//      historial completo queda intacto: matrículas, trámites, cta cte).
//   2. Actualiza el email de contacto de la ficha (administraciones.email)
//      → todas las comunicaciones futuras van a la casilla nueva.
//   3. Avisa al cliente EN LA CASILLA NUEVA (antes de tocar la ficha, §6 A#6):
//      · nunca ingresó  → template 'acceso-email-actualizado' con contraseña
//        temporal regenerada (equivale a re-bienvenida en el mail correcto);
//      · ya ingresó     → template 'acceso-email-actualizado-aviso' (su
//        contraseña vigente no se toca).
//   4. §6 A#8: aviso de seguridad al mail ANTERIOR (best-effort) — si el
//      dueño legítimo no pidió el cambio, se entera y puede responder.
//
// Body:      { administracion_id: string, email_nuevo: string }
// Staff-gate real (JWT del caller → profiles.role gerente/operador).
// Respuesta: { ok: true, email_anterior, email_nuevo, ya_habia_ingresado, aviso_enviado }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

// Versión mínima local de _shared/humanize.ts (deploy autocontenido): mapea
// los errores de Supabase Auth que esta edge puede propagar al UI (E-GG-39).
function humanizeAuthError(msg: string | undefined, fallback: string): { status: number; message: string } {
  const m = msg ?? '';
  if (/rate limit|too many requests/i.test(m)) {
    return { status: 429, message: 'Demasiados intentos seguidos. Esperá un minuto y reintentá.' };
  }
  if (/user already (registered|exists)|already been registered|email.*already.*registered/i.test(m)) {
    return { status: 409, message: 'Ya existe un usuario con ese email.' };
  }
  if (/invalid.*email|email.*invalid/i.test(m)) {
    return { status: 422, message: 'El email no tiene un formato válido.' };
  }
  return { status: 500, message: fallback };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function generarPasswordTemporal(): string {
  const safe = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const symbols = '!@#$%&*';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let pwd = '';
  for (let i = 0; i < 12; i++) pwd += safe[bytes[i] % safe.length];
  pwd += safe[bytes[12] % safe.length].toUpperCase();
  pwd += String(bytes[13] % 10);
  pwd += symbols[bytes[14] % symbols.length];
  return pwd;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const authHeader = req.headers.get('Authorization') ?? '';
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return json(401, { ok: false, error: 'Falta Authorization' });

  let body: { administracion_id?: string; email_nuevo?: string } = {};
  try { body = await req.json(); } catch { return json(400, { ok: false, error: 'JSON inválido' }); }
  const emailNuevo = (body.email_nuevo ?? '').trim().toLowerCase();
  if (!body.administracion_id || !emailNuevo) {
    return json(400, { ok: false, error: 'administracion_id y email_nuevo son obligatorios' });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNuevo)) {
    return json(400, { ok: false, error: 'Ingresá un email válido.' });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1) Staff-gate real.
  const { data: caller, error: errCaller } = await admin.auth.getUser(bearer);
  if (errCaller || !caller?.user) return json(401, { ok: false, error: 'Sesión inválida' });
  const { data: prof } = await admin
    .from('profiles').select('role').eq('id', caller.user.id).maybeSingle();
  if (!prof || !['gerente', 'operador'].includes(prof.role ?? '')) {
    return json(403, { ok: false, error: 'Solo gerencia puede corregir el mail de acceso' });
  }

  // 2) Cliente + usuario vinculado.
  const { data: adminRow, error: errAdmin } = await admin
    .from('administraciones')
    .select('id, nombre, email, user_id')
    .eq('id', body.administracion_id)
    .single();
  if (errAdmin || !adminRow) return json(404, { ok: false, error: 'Administración no encontrada' });
  if (!adminRow.user_id) {
    return json(409, { ok: false, error: 'Este cliente no tiene acceso al portal todavía. Usá "Crear acceso al portal" con el email correcto.' });
  }

  const { data: userRes, error: errUser } = await admin.auth.admin.getUserById(adminRow.user_id);
  if (errUser || !userRes?.user) {
    return json(409, { ok: false, error: 'El usuario vinculado no existe. Usá "Crear acceso al portal".' });
  }
  const emailAnterior = userRes.user.email ?? '(desconocido)';
  const yaIngreso = !!userRes.user.last_sign_in_at;

  if (emailAnterior.toLowerCase() === emailNuevo) {
    return json(409, { ok: false, error: 'El email nuevo es igual al actual.' });
  }

  // 3) Colisión: ¿otro usuario ya usa ese email? (pre-check con listUsers;
  //    el backstop real es el índice UNIQUE de auth.users → updateUserById
  //    duplicado falla y humanizeAuthError lo mapea a 409. §6 A#5.)
  const { data: existingUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const colision = existingUsers?.users?.find(
    (u) => u.email?.toLowerCase() === emailNuevo && u.id !== adminRow.user_id,
  );
  if (colision) {
    return json(409, { ok: false, error: 'Ese email ya está usado por otro usuario de la plataforma. Verificá con el cliente.' });
  }

  // 4) Cambiar el email de LOGIN del usuario existente (mismo UUID).
  //    email_confirm: true → sin flujo de confirmación (la gerencia ya validó).
  const updatePayload: { email: string; email_confirm: boolean; password?: string } = {
    email: emailNuevo,
    email_confirm: true,
  };
  let passwordTemporal: string | null = null;
  if (!yaIngreso) {
    // Nunca entró: la bienvenida original se perdió → credenciales frescas
    // en el mismo update (atómico del lado de Auth).
    passwordTemporal = generarPasswordTemporal();
    updatePayload.password = passwordTemporal;
  }
  const { error: errUpd } = await admin.auth.admin.updateUserById(adminRow.user_id, updatePayload);
  if (errUpd) {
    const h = humanizeAuthError(errUpd.message, 'No pudimos actualizar el email de acceso. Reintentá.');
    return json(h.status, { ok: false, error: h.message });
  }

  // 5) Avisar al cliente en la casilla NUEVA — ANTES de tocar la ficha (§6
  //    A#6): si la password fue regenerada, el aviso con credenciales no debe
  //    depender de que el update de la ficha salga bien.
  const { error: errEmail } = await admin.from('email_queue').insert({
    kind: 'workflow',
    template_slug: passwordTemporal ? 'acceso-email-actualizado' : 'acceso-email-actualizado-aviso',
    to_email: emailNuevo,
    to_nombre: adminRow.nombre,
    variables: {
      nombre_administracion: adminRow.nombre,
      email_nuevo: emailNuevo,
      email_anterior: emailAnterior,
      ...(passwordTemporal ? { password_temporal: passwordTemporal } : {}),
      link_portal: 'https://www.gestionglobal.ar/ingresar',
    },
    prioridad: 1,
    intento: 0,
    max_intentos: 3,
    programado_para: new Date().toISOString(),
    administracion_id: adminRow.id,
    related_table: 'administraciones',
    related_id: adminRow.id,
  });
  const avisoEnviado = !errEmail;
  if (errEmail) {
    console.error('corregir-email-acceso: encolar aviso falló', errEmail.message);
  }

  // 5b) §6 A#8 · Aviso de seguridad al mail ANTERIOR (best-effort): patrón
  //     estándar de cambio de credenciales — si el dueño legítimo no pidió el
  //     cambio, se entera y puede responder. Si esa casilla rebota (caso
  //     típico que motivó la corrección), simplemente rebota sin ruido.
  if (emailAnterior.includes('@')) {
    const { error: errAvisoViejo } = await admin.from('email_queue').insert({
      kind: 'workflow',
      template_slug: 'acceso-email-actualizado-aviso',
      to_email: emailAnterior,
      to_nombre: adminRow.nombre,
      variables: {
        nombre_administracion: adminRow.nombre,
        email_nuevo: emailNuevo,
        email_anterior: emailAnterior,
        link_portal: 'https://www.gestionglobal.ar/ingresar',
      },
      prioridad: 3,
      intento: 0,
      max_intentos: 3,
      programado_para: new Date().toISOString(),
      administracion_id: adminRow.id,
      related_table: 'administraciones',
      related_id: adminRow.id,
    });
    if (errAvisoViejo) {
      console.warn('corregir-email-acceso: aviso al mail anterior falló', errAvisoViejo.message);
    }
  }

  // 6) Actualizar el email de contacto de la ficha.
  const { error: errFicha } = await admin
    .from('administraciones')
    .update({ email: emailNuevo })
    .eq('id', adminRow.id);
  if (errFicha) {
    // El login ya cambió y el aviso ya está encolado; sólo falta la ficha.
    console.error('corregir-email-acceso: update ficha falló', errFicha.message);
    return json(500, { ok: false, error: 'El acceso se actualizó y avisamos al cliente, pero la ficha no se pudo actualizar. Editá el email de la ficha a mano.' });
  }

  return json(200, {
    ok: true,
    email_anterior: emailAnterior,
    email_nuevo: emailNuevo,
    ya_habia_ingresado: yaIngreso,
    aviso_enviado: avisoEnviado,
  });
});
