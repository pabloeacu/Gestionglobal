// supabase/functions/zoom-sdk-signature/index.ts
//
// DGG-14: firma el JWT que necesita el Web Meeting SDK de Zoom para joinear.
// Devuelve { signature, sdkKey, customerKey } al frontend.
//
// El JWT lleva como payload:
//   { sdkKey, mn, role, iat, exp, appKey, tokenExp }
// - role: 0 = attendant, 1 = host (start con start_url, no usamos role=1 acá).
// - customerKey: identificador propio para correlacionar attendance vía
//   webhook (en nuestro caso = matricula_id, validado server-side abajo).
//
// Auth: requiere JWT del usuario (verify_jwt=true). Validamos que el caller
// sea staff o tenga matrícula al curso del encuentro pedido.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const SDK_KEY = Deno.env.get("ZOOM_SDK_KEY") ?? "";
const SDK_SECRET = Deno.env.get("ZOOM_SDK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}

async function signMeetingJWT(
  meetingNumber: string,
  role: 0 | 1,
): Promise<string> {
  const iat = getNumericDate(0);
  const exp = getNumericDate(60 * 60 * 2); // 2h
  const tokenExp = exp;
  const payload = {
    appKey: SDK_KEY,
    sdkKey: SDK_KEY,
    mn: meetingNumber,
    role,
    iat,
    exp,
    tokenExp,
  };
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SDK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return await create({ alg: "HS256", typ: "JWT" }, payload, key);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(204, {});
  if (req.method !== "POST") return json(405, { error: "method" });

  if (!SDK_KEY || !SDK_SECRET) {
    return json(500, { error: "sdk_creds_not_configured" });
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
  const roleReq = (body?.role === 1 ? 1 : 0) as 0 | 1;
  if (!encuentroId || !/^[0-9a-f-]{36}$/i.test(encuentroId)) {
    return json(400, { error: "encuentro_id" });
  }

  // Resolver encuentro + meeting_id + validar acceso
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // F11/DGG-79: si el encuentro pertenece a una sesión compartida, el meeting_id
  // vive en la sesión (no en la fila del encuentro). Resolvemos desde la sesión.
  const { data: enc, error: encErr } = await admin
    .from("curso_encuentros")
    .select("id, curso_id, zoom_meeting_id, zoom_password, duracion_min, sesion_compartida_id, sesion:encuentro_sesiones_compartidas(zoom_meeting_id, zoom_password)")
    .eq("id", encuentroId)
    .maybeSingle();
  if (encErr || !enc) return json(404, { error: "encuentro_not_found" });
  const sesion = enc.sesion as { zoom_meeting_id: number | null; zoom_password: string | null } | null;
  const meetingNumber = enc.sesion_compartida_id
    ? sesion?.zoom_meeting_id ?? null
    : enc.zoom_meeting_id;
  // E-GG-145: la password viaja acá (gateada por matrícula/staff) para que el
  // front no necesite leer zoom_password de la tabla (menos secretos en el
  // payload del alumno).
  const meetingPassword = enc.sesion_compartida_id
    ? sesion?.zoom_password ?? null
    : (enc as { zoom_password?: string | null }).zoom_password ?? null;
  if (!meetingNumber) return json(409, { error: "meeting_not_created" });

  // ¿Es staff?
  const { data: prof } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const isStaff = prof?.role === "gerente";

  let matriculaId: string | null = null;
  if (isStaff) {
    // OK, staff puede entrar como host (role=1) o attendant.
  } else {
    // Validar matrícula al curso.
    const { data: mat } = await admin
      .from("curso_matriculas")
      .select("id, estado, vigencia_hasta")
      .eq("curso_id", enc.curso_id)
      .eq("profile_id", userId)
      .maybeSingle();
    if (!mat) return json(403, { error: "not_matriculado" });
    // DGG-82: acceso = activa O completada dentro de la ventana post-finalización
    // (espejo de private.curso_matriculado). vigencia_hasta NULL en completada =
    // grandfather (matrículas previas al feature). Fecha de hoy en hora
    // Argentina ('YYYY-MM-DD' vía 'en-CA'), igual que el gate de la BD
    // ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date).
    const hoy = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
    });
    const tieneAcceso =
      mat.estado === "activa" ||
      (mat.estado === "completada" &&
        (mat.vigencia_hasta == null || mat.vigencia_hasta >= hoy));
    if (!tieneAcceso) return json(403, { error: "matricula_inactiva" });
    matriculaId = mat.id;
  }

  // role=1 solo si staff
  const role = (isStaff ? roleReq : 0) as 0 | 1;

  const signature = await signMeetingJWT(
    String(meetingNumber),
    role,
  );

  return json(200, {
    signature,
    sdkKey: SDK_KEY,
    meetingNumber: String(meetingNumber),
    role,
    password: meetingPassword,
    customerKey: matriculaId, // null si es staff. F11: el fan-out resuelve la
    // persona desde esta matrícula y abanica a sus matrículas en cada curso.
  });
});
