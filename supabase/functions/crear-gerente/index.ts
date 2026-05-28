// crear-gerente · crea un user con role='gerente'/'operador'/'partner' desde
// el panel de gerencia. #149 extiende para soportar partner.
//
// Body: { email, nombre, password?, role?, partner_id? }
//   - password opcional; si no se pasa, se genera uno temporal seguro
//   - role default 'gerente'. 'partner' requiere partner_id
//
// Respuesta: { ok, user_id, password_temporal? }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Body {
  email: string;
  nombre: string;
  password?: string;
  role?: 'gerente' | 'operador' | 'partner';
  partner_id?: string;
}

function generarPassword(): string {
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

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { ok: false, error: 'Falta Authorization header' });

  let body: Body;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: 'JSON inválido' }); }
  if (!body.email || !body.nombre) return json(400, { ok: false, error: 'email y nombre son obligatorios' });

  const role = body.role ?? 'gerente';
  if (!['gerente', 'operador', 'partner'].includes(role)) {
    return json(400, { ok: false, error: `role inválido: ${role}` });
  }
  if (role === 'partner' && !body.partner_id) {
    return json(400, { ok: false, error: 'partner_id es obligatorio para role=partner' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  // 1) Verificar que el caller es staff
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: caller } = await userClient.auth.getUser();
  if (!caller?.user) return json(401, { ok: false, error: 'Token inválido' });
  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', caller.user.id).single();
  if (!callerProfile || !['gerente', 'operador'].includes(callerProfile.role)) {
    return json(403, { ok: false, error: 'Solo gerencia puede crear usuarios' });
  }

  // 2) Si role=partner: verificar que el partner exista y esté activo
  if (role === 'partner') {
    const { data: p } = await admin
      .from('partners')
      .select('id, activo')
      .eq('id', body.partner_id!)
      .single();
    if (!p) return json(404, { ok: false, error: 'Partner no encontrado' });
    if (!p.activo) return json(400, { ok: false, error: 'Partner inactivo' });
  }

  // 3) Verificar que el email no existe ya
  const { data: existingUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (existingUsers?.users?.some(u => u.email?.toLowerCase() === body.email.toLowerCase())) {
    return json(409, { ok: false, error: 'Ya existe un usuario con ese email' });
  }

  // 4) Crear user con password
  const passwordTemporal = body.password ?? generarPassword();
  const { data: newUser, error: errCreate } = await admin.auth.admin.createUser({
    email: body.email,
    password: passwordTemporal,
    email_confirm: true,
    user_metadata: { full_name: body.nombre, role },
  });
  if (errCreate || !newUser?.user) {
    return json(500, { ok: false, error: `Crear user: ${errCreate?.message ?? 'desconocido'}` });
  }

  // 5) Upsert profile con role + partner_id si corresponde
  const profile: Record<string, unknown> = {
    id: newUser.user.id,
    role,
    full_name: body.nombre,
  };
  if (role === 'partner') {
    profile.partner_id = body.partner_id;
  }
  const { error: errProfile } = await admin.from('profiles').upsert(profile);
  if (errProfile) {
    return json(500, { ok: false, error: `Crear profile: ${errProfile.message}` });
  }

  return json(200, { ok: true, user_id: newUser.user.id, password_temporal: passwordTemporal });
});

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
