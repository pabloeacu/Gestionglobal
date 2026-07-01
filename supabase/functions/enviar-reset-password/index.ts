// enviar-reset-password · dispara el flujo de recuperación de contraseña.
//
// Por qué existe (DGG-93 / reporte JL #5): no había recuperación de contraseña.
// Un usuario que olvida su clave queda bloqueado (el login falla y "cambiar mi
// contraseña" exige estar logueado). Este proyecto NO usa el SMTP de Supabase
// Auth (los users se crean con email_confirm=true), así que resetPasswordForEmail
// nativo no es confiable. En su lugar:
//   1. admin.generateLink({type:'recovery', email, redirectTo}) genera el link
//      seguro (service_role).
//   2. Encolamos el correo en email_queue con el template 'password-reset', que
//      se despacha por el pipeline propio (Google Workspace) — confiable.
//   3. La pantalla /restablecer recibe la sesión de recovery y deja fijar la
//      nueva clave con updateUser({password}) — el server nunca ve la clave.
//
// Seguridad: respuesta SIEMPRE genérica ({ok:true}) para no filtrar qué emails
// existen (anti-enumeración). Throttle: no reencola si ya se mandó uno a la misma
// dirección en los últimos 3 minutos. Público (anon-callable): un usuario
// bloqueado no tiene sesión.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITE_URL = 'https://www.gestionglobal.ar';
const REDIRECT_TO = `${SITE_URL}/restablecer`;

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

const OK = () => json(200, { ok: true }); // respuesta genérica anti-enumeración

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'método no soportado' });

  let body: { email?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: 'Body inválido.' });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json(400, { ok: false, error: 'Ingresá un email válido.' });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Throttle anti-spam (dos niveles; siempre devolvemos ok genérico):
  //  (a) 1 cada 3 min por dirección (evita reenvíos por doble-click / impaciencia)
  //  (b) máx 5 en 24 h por dirección (evita mail-bombing lento espaciado >3 min)
  try {
    const ahora = Date.now();
    const desde3m = new Date(ahora - 3 * 60 * 1000).toISOString();
    const { count: recientes } = await admin
      .from('email_queue')
      .select('id', { count: 'exact', head: true })
      .eq('template_slug', 'password-reset')
      .eq('to_email', email)
      .gte('created_at', desde3m);
    if ((recientes ?? 0) > 0) return OK();

    const desde24h = new Date(ahora - 24 * 60 * 60 * 1000).toISOString();
    const { count: delDia } = await admin
      .from('email_queue')
      .select('id', { count: 'exact', head: true })
      .eq('template_slug', 'password-reset')
      .eq('to_email', email)
      .gte('created_at', desde24h);
    if ((delDia ?? 0) >= 5) return OK();
  } catch {
    /* throttle best-effort: si falla el select, seguimos */
  }

  // Generar el link de recovery. Si el email no existe (o cualquier error),
  // devolvemos ok genérico sin revelarlo.
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: REDIRECT_TO },
  });
  const link = data?.properties?.action_link;
  if (error || !link) return OK();

  // Nombre para el saludo (best-effort).
  let nombre = 'Hola';
  const uid = data.user?.id;
  if (uid) {
    const { data: adm } = await admin
      .from('administraciones')
      .select('nombre')
      .eq('user_id', uid)
      .maybeSingle();
    const metaNombre =
      (data.user?.user_metadata?.nombre as string | undefined) ??
      (data.user?.user_metadata?.full_name as string | undefined);
    nombre = adm?.nombre ?? metaNombre ?? 'Hola';
  }

  // Encolar el correo por el pipeline propio.
  const { error: qErr } = await admin.from('email_queue').insert({
    to_email: email,
    to_nombre: nombre,
    subject: 'Restablecé tu contraseña · Gestión Global',
    kind: 'workflow',
    template_slug: 'password-reset',
    variables: { nombre, reset_url: link },
    prioridad: 1,
    programado_para: new Date().toISOString(),
    related_table: 'auth_users',
    related_id: uid ?? null,
  });
  if (qErr) {
    // No revelamos detalle al caller; logueamos para diagnóstico.
    console.error('[enviar-reset-password] enqueue falló:', qErr.message);
  }

  return OK();
});
