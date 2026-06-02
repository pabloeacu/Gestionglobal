// cambiar-mi-password · cambia la contraseña del user autenticado.
//
// Por qué existe: Supabase Auth tiene "Secure password change" + "Require
// current password" ENABLED (AUDIT bonus #272). En ese modo, el método
// `supabase.auth.updateUser({password})` desde el cliente rechaza con
// "Current password required when setting new password" porque no hay
// forma estándar de mandar `password_current` desde supabase-js v2.
//
// Esta edge fn implementa el flujo correcto del server-side:
//   1. Verifica el JWT del caller para obtener el user.id + email.
//   2. Re-autentica con signInWithPassword usando el current. Si falla
//      → 401 "La contraseña actual no es correcta".
//   3. Si OK, usa SERVICE_ROLE_KEY para hacer `admin.updateUserById` que
//      bypassa la restricción.
//
// Beneficio extra: si quisiéramos endurecer (lockout post N intentos),
// este es el lugar central donde aplicarlo.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'método no soportado' });

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return json(401, { ok: false, error: 'Falta token de sesión.' });
  }

  let body: { current?: string; new?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: 'Body inválido.' });
  }

  const current = (body.current ?? '').trim();
  const next = (body.new ?? '').trim();

  if (!current) return json(400, { ok: false, error: 'Falta la contraseña actual.' });
  if (next.length < 8) {
    return json(400, { ok: false, error: 'La contraseña nueva debe tener al menos 8 caracteres.' });
  }
  if (next === current) {
    return json(400, { ok: false, error: 'La contraseña nueva no puede ser igual a la actual.' });
  }

  // 1) Identificar al user a partir del token (sin service_role para no
  //    saltarnos RLS; usamos anon + el JWT del caller).
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json(401, { ok: false, error: 'Tu sesión expiró. Volvé a ingresar.' });
  }
  const email = userData.user.email;
  const userId = userData.user.id;
  if (!email) {
    return json(400, { ok: false, error: 'Tu usuario no tiene email asociado.' });
  }

  // 2) Verificar la contraseña actual probando un signIn en otro cliente
  //    aislado (NO el del caller — sino reemplazaríamos su sesión).
  const verifier = createClient(SUPABASE_URL, ANON_KEY);
  const { error: reauthErr } = await verifier.auth.signInWithPassword({
    email,
    password: current,
  });
  if (reauthErr) {
    return json(401, { ok: false, error: 'La contraseña actual no es correcta.' });
  }
  // Cerrar la sesión del verifier para no dejar refresh tokens dando vueltas.
  try { await verifier.auth.signOut(); } catch { /* noop */ }

  // 3) Actualizar la contraseña vía service_role (bypassea la restricción
  //    "Secure password change" que rechaza updateUser desde el cliente).
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
    password: next,
  });
  if (updErr) {
    return json(500, {
      ok: false,
      error: `No pudimos actualizar la contraseña: ${updErr.message}`,
    });
  }

  return json(200, { ok: true });
});
