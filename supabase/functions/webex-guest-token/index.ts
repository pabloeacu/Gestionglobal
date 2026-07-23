// supabase/functions/webex-guest-token/index.ts
//
// DGG-19 · Mints a JWT guest token for the Webex Meetings widget.
//
// Auth: cualquier alumno autenticado con matrícula activa al curso del
// encuentro. Webex permite que un "Guest Issuer" emita tokens firmados
// con HS256 + shared secret. Esos tokens se pasan al widget como
// `accessToken` y le permiten al alumno joinear sin tener cuenta Webex.
//
// Requirements:
//   WEBEX_GUEST_ISSUER_ID      — UUID del Guest Issuer creado en
//                                developer.webex.com → Apps → Guest Issuer
//   WEBEX_GUEST_SHARED_SECRET  — base64-encoded shared secret
//
// Flow:
//   1) Cliente POST { encuentro_id } + Bearer del alumno
//   2) Edge valida matrícula activa
//   3) Edge firma JWT { sub: alumno_id, name: displayName, iss: ISSUER_ID,
//                       exp: now + 4h }
//   4) Devuelve { token, meetingId, password }
//
// verify_jwt=false para evitar el 500 del preflight CORS.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const ISSUER_ID = Deno.env.get("WEBEX_GUEST_ISSUER_ID") ?? "";
const SHARED_SECRET = Deno.env.get("WEBEX_GUEST_SHARED_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function signGuestJWT(
  subject: string,
  displayName: string,
): Promise<string> {
  // El shared secret de Webex viene en base64. Decodificamos a bytes y
  // creamos la HMAC key.
  const secretBytes = Uint8Array.from(atob(SHARED_SECRET), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = {
    sub: subject,
    name: displayName,
    iss: ISSUER_ID,
    iat: getNumericDate(0),
    exp: getNumericDate(60 * 60 * 4), // 4 horas
  };
  return await create({ alg: "HS256", typ: "JWT" }, payload, key);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method" });
  if (!ISSUER_ID || !SHARED_SECRET) {
    return json(500, { error: "webex_guest_creds_not_configured" });
  }

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json(401, { error: "no_auth" });
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: ures, error: uerr } = await userClient.auth.getUser();
  if (uerr || !ures?.user) return json(401, { error: "invalid_auth" });
  const userId = ures.user.id;

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "json" }); }
  const encuentroId = body?.encuentro_id as string | undefined;
  if (!encuentroId || !/^[0-9a-f-]{36}$/i.test(encuentroId)) {
    return json(400, { error: "encuentro_id" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: enc, error: encErr } = await admin
    .from("curso_encuentros")
    .select("id, curso_id, plataforma, webex_meeting_id, webex_meeting_number, webex_password, curso:curso_id(activo, publicar_at, despublicar_at)")
    .eq("id", encuentroId).maybeSingle();
  if (encErr || !enc) return json(404, { error: "encuentro_not_found" });
  if (enc.plataforma !== "webex") return json(409, { error: "not_webex_encuentro" });
  if (!enc.webex_meeting_id) return json(409, { error: "webex_meeting_not_set" });

  // Profile (gerente bypass / matrícula activa para alumno)
  const { data: prof } = await admin
    .from("profiles").select("role, display_name, email").eq("id", userId).maybeSingle();
  const isStaff = prof?.role === "gerente";

  let displayName = prof?.display_name || ures.user.email || "Participante";
  let matriculaId: string | null = null;
  if (!isStaff) {
    const { data: mat } = await admin
      .from("curso_matriculas")
      .select("id, estado")
      .eq("curso_id", enc.curso_id).eq("profile_id", userId).maybeSingle();
    if (!mat) return json(403, { error: "not_matriculado" });
    if (mat.estado && mat.estado !== "activa") {
      return json(403, { error: "matricula_inactiva" });
    }
    // DGG-115 (0375, B#7): matrícula sola no alcanza — el curso tiene que estar
    // publicado o finalizado (espejo de private.curso_estado_publicacion).
    const curso = enc.curso as {
      activo: boolean;
      despublicar_at: string | null;
    } | null;
    const finalizado =
      !!curso?.despublicar_at &&
      new Date(curso.despublicar_at).getTime() <= Date.now();
    // DGG-116 (E-GG-151): el check "Visible" (activo) publica el curso YA;
    // publicar_at (Fecha de inicio) dejó de retener la visibilidad (sólo
    // dispara el auto-tildado por cron). Espejo del derivador de 3 estados:
    // publicado = activo. La lógica vieja exigía publicar_at<=now y devolvía
    // 403 a un curso con visibilidad anticipada (activo=true + fecha futura)
    // que la BD/RLS ya exponen en dashboard/banner/campus.
    const publicado = !!curso?.activo;
    if (!finalizado && !publicado) return json(403, { error: "curso_no_publicado" });
    matriculaId = mat.id;
  }

  // Webex Guest Issuer SDK requires "user-{base64}" subject format
  const subjectId = `${userId}`;
  const token = await signGuestJWT(subjectId, displayName);

  return json(200, {
    token,
    meetingId: enc.webex_meeting_id,
    meetingNumber: enc.webex_meeting_number,
    password: enc.webex_password,
    displayName,
    customerKey: matriculaId,
  });
});
