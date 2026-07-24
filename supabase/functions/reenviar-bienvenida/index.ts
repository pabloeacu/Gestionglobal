// reenviar-bienvenida · DGG-117 · Reenvía el mail de bienvenida del portal al
// usuario EXISTENTE del cliente, sin crear usuarios nuevos.
//
// Caso de uso (Pablo, 2026-07-24): el primer mail de bienvenida se perdió
// (rebote, casilla llena, borrado accidental) y la gerencia quiere repetirlo.
// Como la password temporal original no es recuperable (queda hasheada), se
// REGENERA una nueva y se reenvía el mismo template 'bienvenida-administracion'
// con credenciales frescas. Si el cliente ya había ingresado, el front advierte
// antes (la clave vigente deja de servir).
//
// Body:    { administracion_id: string }
// Región:  staff-gated de verdad — el JWT del caller debe ser de un profile
//          con role gerente/operador (a diferencia del gate laxo del alta,
//          E-GG-150 lección: superficie que muta credenciales = gate real).
// Respuesta: { ok: true, email_destino, ya_habia_ingresado } | { ok, error }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

// Versión mínima local de _shared/humanize.ts (deploy autocontenido): mapea
// los errores de Supabase Auth que esta edge puede propagar al UI (E-GG-39).
function humanizeAuthError(msg: string | undefined, fallback: string): { status: number; message: string } {
  const m = msg ?? '';
  if (/rate limit|too many requests/i.test(m)) {
    return { status: 429, message: 'Demasiados intentos seguidos. Esperá un minuto y reintentá.' };
  }
  if (/user already (registered|exists)|already been registered/i.test(m)) {
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

  let body: { administracion_id?: string } = {};
  try { body = await req.json(); } catch { return json(400, { ok: false, error: 'JSON inválido' }); }
  if (!body.administracion_id) return json(400, { ok: false, error: 'administracion_id es obligatorio' });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1) Staff-gate real: el JWT del caller debe pertenecer a gerente/operador.
  const { data: caller, error: errCaller } = await admin.auth.getUser(bearer);
  if (errCaller || !caller?.user) return json(401, { ok: false, error: 'Sesión inválida' });
  const { data: prof } = await admin
    .from('profiles').select('role').eq('id', caller.user.id).maybeSingle();
  if (!prof || !['gerente', 'operador'].includes(prof.role ?? '')) {
    return json(403, { ok: false, error: 'Solo gerencia puede reenviar la bienvenida' });
  }

  // 2) Cliente + usuario vinculado (NUNCA crea usuarios: eso es del alta).
  const { data: adminRow, error: errAdmin } = await admin
    .from('administraciones')
    .select('id, nombre, email, user_id')
    .eq('id', body.administracion_id)
    .single();
  if (errAdmin || !adminRow) return json(404, { ok: false, error: 'Administración no encontrada' });
  if (!adminRow.user_id) {
    return json(409, { ok: false, error: 'Este cliente no tiene acceso al portal todavía. Usá "Crear acceso al portal".' });
  }

  const { data: userRes, error: errUser } = await admin.auth.admin.getUserById(adminRow.user_id);
  if (errUser || !userRes?.user?.email) {
    return json(409, { ok: false, error: 'El usuario vinculado no existe. Usá "Crear acceso al portal".' });
  }
  const emailLogin = userRes.user.email;
  const yaIngreso = !!userRes.user.last_sign_in_at;

  // 3) Regenerar password temporal del usuario EXISTENTE (mismo ID).
  const passwordTemporal = generarPasswordTemporal();
  const { error: errPwd } = await admin.auth.admin.updateUserById(adminRow.user_id, {
    password: passwordTemporal,
  });
  if (errPwd) {
    const h = humanizeAuthError(errPwd.message, 'No pudimos regenerar la contraseña. Reintentá.');
    return json(h.status, { ok: false, error: h.message });
  }

  // 4) Reenviar la bienvenida (mismo template del alta) con credenciales nuevas.
  const { error: errEmail } = await admin.from('email_queue').insert({
    kind: 'workflow',
    template_slug: 'bienvenida-administracion',
    to_email: emailLogin,
    to_nombre: adminRow.nombre,
    variables: {
      nombre_administracion: adminRow.nombre,
      email_user: emailLogin,
      password_temporal: passwordTemporal,
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
  if (errEmail) {
    // La password ya se regeneró: avisamos igual, el reintento reencola.
    console.error('reenviar-bienvenida: encolar falló', errEmail.message);
    return json(500, { ok: false, error: 'Se regeneró la contraseña pero el email no pudo encolarse. Reintentá el reenvío.' });
  }

  return json(200, { ok: true, email_destino: emailLogin, ya_habia_ingresado: yaIngreso });
});
