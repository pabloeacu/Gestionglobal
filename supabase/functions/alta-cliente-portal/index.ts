// alta-cliente-portal · crea user en auth.users + vincula administracion.user_id
// + encola email "bienvenida-administracion" con credenciales reales.
//
// Disparado por el frontend tras solicitud_activar (escenario "cliente nuevo").
//
// Secrets requeridos:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Body:
//   {
//     administracion_id: string,
//     email: string,
//     nombre: string
//   }
//
// Respuesta:
//   { ok: true, user_id, password_set: true }  // o
//   { ok: false, error: string }
//
// Idempotente: si el user ya existe con ese email, NO crea otro, sólo vincula
// y reusa credenciales (no genera nueva password). Devuelve { user_id, password_set: false }.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';
import { humanizeUpstream, humanizeUpstreamMsg } from '../_shared/humanize.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Body {
  administracion_id: string;
  email: string;
  nombre: string;
}

function generarPasswordTemporal(): string {
  // 12 chars alfanuméricos + 1 mayúscula + 1 número + 1 símbolo seguro
  // (Supabase requires min 6, recommended 12+. Solo chars sin ambigüedad: sin 0/O/1/l/I)
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
  if (!body.administracion_id || !body.email || !body.nombre) {
    return json(400, { ok: false, error: 'administracion_id, email y nombre son obligatorios' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (!supabaseUrl || !serviceKey) return json(500, { ok: false, error: 'Configuración faltante' });

  const admin = createClient(supabaseUrl, serviceKey);

  // 1) Auth check pragmático: aceptamos cualquier Bearer válido (anon, service_role
  //    o user JWT de staff). El control de acceso real está en quién puede llamar
  //    esta edge function (sólo se invoca desde el trigger AFTER INSERT admin con
  //    service_role, o desde el wizard de gerencia con JWT de staff).
  //    Si vienen casos de abuso futuro, agregar verify_jwt=true en supabase/config.
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (bearerToken.length < 20) {
    return json(401, { ok: false, error: 'Bearer inválido o vacío' });
  }

  // 2) Verificar que la administración existe + no tenga ya user_id seteado
  const { data: adminRow, error: errAdmin } = await admin
    .from('administraciones')
    .select('id, email, nombre, user_id')
    .eq('id', body.administracion_id)
    .single();
  if (errAdmin || !adminRow) {
    console.error('alta-cliente-portal: administración no encontrada', {
      administracion_id: body.administracion_id,
      err: errAdmin?.message,
    });
    return json(404, { ok: false, error: 'Administración no encontrada' });
  }

  // 3) Buscar si ya existe user con ese email
  const { data: existingUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existingUser = existingUsers?.users?.find(u => u.email?.toLowerCase() === body.email.toLowerCase());

  let userId: string;
  let passwordSet = false;
  let passwordTemporal: string | null = null;

  if (existingUser) {
    // Idempotencia: usuario ya existe → solo vinculamos.
    userId = existingUser.id;
  } else {
    // 4) Crear user con password temporal + email_confirm=true
    passwordTemporal = generarPasswordTemporal();
    const { data: newUser, error: errCreate } = await admin.auth.admin.createUser({
      email: body.email,
      password: passwordTemporal,
      email_confirm: true,
      user_metadata: { full_name: body.nombre, role: 'administrador' },
    });
    if (errCreate || !newUser?.user) {
      console.error('alta-cliente-portal: createUser falló', {
        email: body.email,
        administracion_id: body.administracion_id,
        err: errCreate?.message,
      });
      // E-GG-44
      const h = humanizeUpstream(errCreate?.message, 'No pudimos crear el acceso al portal. Verificá el email y reintentá.');
      return json(h.status, { ok: false, error: h.message });
    }
    userId = newUser.user.id;
    passwordSet = true;

    // 5) Asegurar profile.role='administrador' + administracion_id vinculado
    //    El trigger handle_new_user crea profile pero NO setea administracion_id.
    //    La RLS administraciones_select requiere profiles.administracion_id != NULL,
    //    por eso lo seteamos acá (EGG-QA-19).
    await admin
      .from('profiles')
      .upsert({
        id: userId,
        role: 'administrador',
        full_name: body.nombre,
        administracion_id: body.administracion_id,
      });
  }

  // 5b) Asegurar el vínculo profiles.administracion_id (también para user
  //     pre-existente; idempotente para el recién creado).
  await admin
    .from('profiles')
    .update({ administracion_id: body.administracion_id })
    .eq('id', userId);

  // 6) Vincular administraciones.user_id ← user.id
  if (adminRow.user_id !== userId) {
    const { error: errLink } = await admin
      .from('administraciones')
      .update({ user_id: userId })
      .eq('id', body.administracion_id);
    if (errLink) {
      console.error('alta-cliente-portal: vincular admin↔user falló', {
        administracion_id: body.administracion_id,
        user_id: userId,
        err: errLink.message,
      });
      // E-GG-44
      const h = humanizeUpstream(errLink.message, 'El usuario se creó pero no pudimos vincularlo al cliente. Avisá a un gerente.');
      return json(h.status, { ok: false, error: h.message });
    }
  }

  // 7) Encolar email de bienvenida si recién creamos el user
  if (passwordSet && passwordTemporal) {
    const { error: errEmail } = await admin.from('email_queue').insert({
      kind: 'workflow',
      template_slug: 'bienvenida-administracion',
      to_email: body.email,
      to_nombre: body.nombre,
      variables: {
        nombre_administracion: body.nombre,
        email_user: body.email,
        password_temporal: passwordTemporal,
        link_portal: 'https://www.gestionglobal.ar/ingresar',
      },
      prioridad: 1,
      intento: 0,
      max_intentos: 3,
      programado_para: new Date().toISOString(),
      administracion_id: body.administracion_id,
      related_table: 'administraciones',
      related_id: body.administracion_id,
    });
    if (errEmail) {
      // No falla la operación principal; el cliente puede reenviarse manualmente
      console.warn('Encolar email bienvenida falló:', errEmail.message);
    }
  }

  return json(200, { ok: true, user_id: userId, password_set: passwordSet });
});

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
