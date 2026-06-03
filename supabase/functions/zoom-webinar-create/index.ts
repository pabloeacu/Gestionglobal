// supabase/functions/zoom-webinar-create/index.ts
//
// DGG-11/15: crea una reunión Zoom asociada a un webinar (cuenta propia,
// vía Server-to-Server OAuth) y guarda la metadata en `webinars` vía RPC SD
// webinar_set_zoom.
//
// Diferencias vs zoom-meeting-create (cursos):
//   - target table = webinars (no curso_encuentros)
//   - approval_type = 0 (registration required) o 2 (no registration)
//     → uso 2 para mantener simple: el control de quién entra es por nuestro
//       magic-link, no por Zoom registration.
//   - waiting_room = false (queremos que los inscriptos entren directo)
//   - auto_recording = cloud (queda grabado para los que no asistieron)
//
// Auth: staff (gerente). El RPC re-valida igualmente.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { humanizeUpstream, humanizeUpstreamMsg } from '../_shared/humanize.ts';

const ACCOUNT_ID    = Deno.env.get("ZOOM_ACCOUNT_ID") ?? "";
const CLIENT_ID     = Deno.env.get("ZOOM_S2S_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("ZOOM_S2S_CLIENT_SECRET") ?? "";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

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

async function getZoomAccessToken(): Promise<string> {
  const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
  const r = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ACCOUNT_ID}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    },
  );
  if (!r.ok) throw new Error(`zoom_oauth_${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(204, {});
  if (req.method !== "POST") return json(405, { error: "method" });
  if (!CLIENT_ID || !CLIENT_SECRET || !ACCOUNT_ID) {
    return json(500, { error: "zoom_s2s_not_configured" });
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

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: prof } = await admin
    .from("profiles").select("role").eq("id", userId).maybeSingle();
  if (prof?.role !== "gerente") return json(403, { error: "only_staff" });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "json" }); }
  const webinarId = body?.webinar_id as string;
  if (!webinarId || !/^[0-9a-f-]{36}$/i.test(webinarId)) {
    return json(400, { error: "webinar_id" });
  }
  const hostEmail: string = body?.host_email ?? "me";

  const { data: web } = await admin
    .from("webinars")
    .select("id, titulo, fecha_hora, duracion_min, zoom_meeting_id")
    .eq("id", webinarId)
    .maybeSingle();
  if (!web) return json(404, { error: "webinar_not_found" });
  if (web.zoom_meeting_id) {
    return json(409, { error: "meeting_already_created", meeting_id: web.zoom_meeting_id });
  }

  const topic = body?.topic ?? `Webinar · ${web.titulo}`;
  const startTime = web.fecha_hora ?? new Date().toISOString();
  const duracionMin = Number(web.duracion_min ?? 60);

  let token: string;
  try { token = await getZoomAccessToken(); }
  catch (e) { return json(502, { error: "zoom_oauth", detail: String(e) }); }

  const target = hostEmail === "me" ? "me" : encodeURIComponent(hostEmail);
  const r = await fetch(`https://api.zoom.us/v2/users/${target}/meetings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic,
      type: 2, // scheduled
      start_time: startTime,
      duration: duracionMin,
      timezone: "America/Argentina/Buenos_Aires",
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: true,         // alumnos pueden entrar antes del host
        waiting_room: false,            // sin sala de espera (control vía magic-link)
        mute_upon_entry: true,
        auto_recording: "cloud",        // grabación automática (Pro+)
        meeting_authentication: false,  // sin Zoom login required
        approval_type: 2,               // no registration (control externo)
      },
    }),
  });
  if (!r.ok) {
    const detail = await r.text();
    return json(502, { error: "zoom_create_failed", status: r.status, detail });
  }
  const mtg = await r.json();

  const { error: rpcErr } = await admin.rpc("webinar_set_zoom", {
    p_webinar_id: webinarId,
    p_meeting_id: Number(mtg.id),
    p_join_url: mtg.join_url ?? null,
    p_start_url: mtg.start_url ?? null,
    p_password: mtg.password ?? null,
    p_meeting_number: String(mtg.id),
    p_duracion_min: duracionMin,
  });
  if (rpcErr) {
    console.error('zoom-webinar-create · rpc_set_zoom falló', { err: rpcErr.message });
    // E-GG-44 (Pattern-5 · 2026-06-02)
    return json(500, { error: humanizeUpstreamMsg(rpcErr.message, 'El webinar Zoom se creó pero no pudimos guardarlo. Avisá a un gerente.') });
  }

  return json(200, {
    ok: true,
    meeting_id: mtg.id,
    join_url: mtg.join_url,
    start_url: mtg.start_url,
    password: mtg.password,
    topic,
  });
});
