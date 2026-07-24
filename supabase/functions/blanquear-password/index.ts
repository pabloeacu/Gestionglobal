// blanquear-password · E-GG-157 · "Blanquear contraseña" de la ficha del
// cliente: la gerencia genera una contraseña nueva para el usuario EXISTENTE
// (la actual deja de servir) y el cliente la recibe en su email de LOGIN
// vigente con formato bienvenida ("blanqueamos tu contraseña y generamos
// esta nueva").
//
// Pedido de Pablo (2026-07-24, derivado de E-GG-156): camino PARALELO y
// exclusivo de gerencia respecto del "¿Olvidaste tu contraseña?" del login
// (que sigue intacto para el autoservicio del cliente). Caso de uso típico:
// el cliente ya ingresó alguna vez, olvidó su clave, y llama a la gerencia.
//
// Body:      { administracion_id: string }
// Staff-gate real (JWT del caller → profiles.role gerente/operador).
// Respuesta: { ok: true, email_destino, ya_habia_ingresado } | { ok, error }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

// Versión mínima local de _shared/humanize.ts (deploy autocontenido, E-GG-39).
function humanizeAuthError(msg: string | undefined, fallback: string): { status: number; message: string } {
  const m = msg ?? '';
  if (/rate limit|too many requests/i.test(m)) {
    return { status: 429, message: 'Demasiados intentos seguidos. Esperá un minuto y reintentá.' };
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
    return json(403, { ok: false, error: 'Solo gerencia puede blanquear la contraseña' });
  }

  // 2) Cliente + usuario vinculado (NUNCA crea usuarios: eso es del alta).
  const { data: adminRow, error: errAdmin } = await admin
    .from('administraciones')
    .select('id, nombre, email, user_id, estado')
    .eq('id', body.administracion_id)
    .single();
  if (errAdmin || !adminRow) return json(404, { ok: false, error: 'Administración no encontrada' });
  if (!adminRow.user_id) {
    return json(409, { ok: false, error: 'Este cliente no tiene acceso al portal todavía. Usá "Crear acceso al portal".' });
  }
  // §6 E-GG-157 #4c · cliente dado de baja: sin credenciales (el gate del
  // portal ya lo excluye; enviarle claves sería engañoso). Defensa en
  // profundidad — el front tampoco muestra el botón en baja.
  if (adminRow.estado === 'baja') {
    return json(409, { ok: false, error: 'Este cliente está dado de baja. Reactivalo antes de operar su acceso.' });
  }
  // §6 E-GG-157 #2 · anti-escalación: SOLO se operan credenciales de un
  // usuario cliente del portal (role administrador). Corta el vector "ficha
  // con user_id apuntado a un gerente" → nadie blanquea la clave de un
  // gerente desde acá.
  const { data: profTarget } = await admin
    .from('profiles').select('role').eq('id', adminRow.user_id).maybeSingle();
  if (profTarget?.role !== 'administrador') {
    return json(409, { ok: false, error: 'El usuario vinculado a esta ficha no es un cliente del portal. Verificá la ficha.' });
  }

  const { data: userRes, error: errUser } = await admin.auth.admin.getUserById(adminRow.user_id);
  if (errUser || !userRes?.user?.email) {
    return json(409, { ok: false, error: 'El usuario vinculado no existe. Usá "Crear acceso al portal".' });
  }
  const emailLogin = userRes.user.email;
  const yaIngreso = !!userRes.user.last_sign_in_at;

  // 3) Generar la contraseña nueva y PISAR la actual (usuario existente,
  //    mismo UUID — el historial no se toca).
  const passwordTemporal = generarPasswordTemporal();
  const { error: errPwd } = await admin.auth.admin.updateUserById(adminRow.user_id, {
    password: passwordTemporal,
  });
  if (errPwd) {
    const h = humanizeAuthError(errPwd.message, 'No pudimos blanquear la contraseña. Reintentá.');
    return json(h.status, { ok: false, error: h.message });
  }

  // 4) Credenciales nuevas al email de LOGIN vigente, formato bienvenida con
  //    el copy de blanqueo (template acceso-password-blanqueada, mig 0384).
  const { error: errEmail } = await admin.from('email_queue').insert({
    kind: 'workflow',
    template_slug: 'acceso-password-blanqueada',
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
    // La password ya fue pisada: decirlo sin vueltas — reintentar reencola.
    console.error('blanquear-password: encolar falló', errEmail.message);
    return json(500, { ok: false, error: 'La contraseña se blanqueó pero el email no pudo encolarse. Reintentá el blanqueo.' });
  }

  return json(200, { ok: true, email_destino: emailLogin, ya_habia_ingresado: yaIngreso });
});
