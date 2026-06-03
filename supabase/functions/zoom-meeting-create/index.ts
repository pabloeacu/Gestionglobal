// supabase/functions/zoom-meeting-create/index.ts
//
// DGG-14: crea una reunión Zoom (cuenta propia, vía Server-to-Server OAuth)
// y guarda la metadata en curso_encuentros vía RPC SD curso_encuentro_set_zoom.
//
// Auth: requiere staff (gerente). El RPC re-valida igualmente.
//
// Flow:
//   1) Caller (gerencia) → POST { encuentro_id, host_email?, topic?, duracion_min? }
//   2) Edge: token = POST oauth/token (grant=account_credentials, account_id=...)
//      con Basic auth (client_id:client_secret) → access_token.
//   3) Edge: POST /v2/users/{user}/meetings con
//        { topic, type=2 (scheduled), start_time, duration, settings:{
//            join_before_host:false, waiting_room:false (o true),
//            auto_recording:'cloud', meeting_authentication:false,
//            participant_video:true, host_video:true } }
//      user = host_email (gerente) o 'me' (cuenta principal de la S2S app).
//   4) Edge: rpc curso_encuentro_set_zoom(...) con id+join_url+start_url+pwd.

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
  const encuentroId = body?.encuentro_id as string;
  if (!encuentroId || !/^[0-9a-f-]{36}$/i.test(encuentroId)) {
    return json(400, { error: "encuentro_id" });
  }
  const hostEmail: string = body?.host_email ?? "me";
  const duracionMin: number = Number(body?.duracion_min ?? 60);

  const { data: enc } = await admin
    .from("curso_encuentros")
    .select("id, titulo, fecha_hora, curso_id, zoom_meeting_id")
    .eq("id", encuentroId)
    .maybeSingle();
  if (!enc) return json(404, { error: "encuentro_not_found" });
  if (enc.zoom_meeting_id) {
    return json(409, { error: "meeting_already_created", meeting_id: enc.zoom_meeting_id });
  }

  const { data: curso } = await admin
    .from("cursos").select("titulo").eq("id", enc.curso_id).maybeSingle();

  const topic = body?.topic ?? `${curso?.titulo ?? "Campus"} · ${enc.titulo}`;
  const startTime = enc.fecha_hora ?? new Date().toISOString();

  // 1) Token
  let token: string;
  try { token = await getZoomAccessToken(); }
  catch (e) { return json(502, { error: "zoom_oauth", detail: String(e) }); }

  // 2) Create meeting
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
        join_before_host: false,
        waiting_room: true,
        mute_upon_entry: true,
        auto_recording: "cloud",
        meeting_authentication: false,
        approval_type: 2, // no registration
      },
    }),
  });
  if (!r.ok) {
    const detail = await r.text();
    return json(502, { error: "zoom_create_failed", status: r.status, detail });
  }
  const mtg = await r.json();

  // 3) Persistir en BD vía RPC SD (re-valida staff)
  const { error: rpcErr } = await admin.rpc("curso_encuentro_set_zoom", {
    p_encuentro_id: encuentroId,
    p_meeting_id: Number(mtg.id),
    p_join_url: mtg.join_url ?? null,
    p_start_url: mtg.start_url ?? null,
    p_password: mtg.password ?? null,
    p_duracion_min: duracionMin,
  });
  if (rpcErr) {
    console.error('zoom-meeting-create · rpc_set_zoom falló', { encuentroId, err: rpcErr.message });
    // E-GG-44 (Pattern-5 · 2026-06-02)
    return json(500, { error: humanizeUpstreamMsg(rpcErr.message, 'La reunión Zoom se creó pero no pudimos guardarla en el curso. Avisá a un gerente.') });
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
