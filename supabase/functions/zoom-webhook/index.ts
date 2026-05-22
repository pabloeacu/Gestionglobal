// supabase/functions/zoom-webhook/index.ts
//
// DGG-14: webhook receiver para eventos de Zoom (Server-to-Server OAuth app).
// Recibe:
//   - endpoint.url_validation  → responde el challenge HMAC para que Zoom
//                                 acepte la URL al guardar Event Subscriptions.
//   - meeting.started/ended    → actualiza curso_encuentros.zoom_status.
//   - meeting.participant_joined/left → registra join/leave por matrícula
//                                       (customer_key=matricula_id).
//   - recording.completed      → guarda URLs de grabación.
//
// Verificación de firma (excepto url_validation): Zoom envía
//   x-zm-request-timestamp + x-zm-signature: v0=<hex_hmac_sha256>
//   donde hash = HMAC_SHA256(SECRET_TOKEN, `v0:{timestamp}:{rawBody}`).
//
// Esta función llama RPCs SD usando service-role (regla 3).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SECRET_TOKEN = Deno.env.get("ZOOM_WEBHOOK_SECRET_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const encoder = new TextEncoder();

async function hmacSha256Hex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, encoder.encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function jsonResp(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResp(405, { error: "method" });
  if (!SECRET_TOKEN) return jsonResp(500, { error: "secret_not_configured" });

  const raw = await req.text();
  let body: any;
  try { body = JSON.parse(raw); } catch { return jsonResp(400, { error: "invalid_json" }); }

  // ── Endpoint URL validation challenge ─────────────────────────
  if (body?.event === "endpoint.url_validation") {
    const plain = body?.payload?.plainToken;
    if (typeof plain !== "string") return jsonResp(400, { error: "no_plainToken" });
    const encrypted = await hmacSha256Hex(SECRET_TOKEN, plain);
    return jsonResp(200, { plainToken: plain, encryptedToken: encrypted });
  }

  // ── Signature verification for real events ────────────────────
  const ts = req.headers.get("x-zm-request-timestamp") ?? "";
  const sig = req.headers.get("x-zm-signature") ?? "";
  const expected = "v0=" + await hmacSha256Hex(SECRET_TOKEN, `v0:${ts}:${raw}`);
  if (sig !== expected) {
    return jsonResp(401, { error: "invalid_signature" });
  }

  // ── Dispatch real events ──────────────────────────────────────
  try {
    const ev = body?.event as string | undefined;
    const p = body?.payload?.object ?? {};
    const meetingIdRaw = p?.id;
    const meetingId = meetingIdRaw ? Number(meetingIdRaw) : null;

    if (ev === "meeting.started" && meetingId) {
      await supabase.rpc("curso_encuentro_zoom_estado", {
        p_meeting_id: meetingId,
        p_estado: "en_curso",
        p_ocurrido_at: p?.start_time ?? new Date().toISOString(),
      });
    } else if (ev === "meeting.ended" && meetingId) {
      await supabase.rpc("curso_encuentro_zoom_estado", {
        p_meeting_id: meetingId,
        p_estado: "finalizado",
        p_ocurrido_at: p?.end_time ?? new Date().toISOString(),
      });
    } else if ((ev === "meeting.participant_joined" || ev === "meeting.participant_left") && meetingId) {
      const part = p?.participant ?? {};
      // customer_key viene del Meeting SDK ZoomMtg.join({customerKey: matriculaId})
      const matriculaId = part?.customer_key as string | undefined;
      const at = (ev === "meeting.participant_joined" ? part?.join_time : part?.leave_time)
        ?? new Date().toISOString();
      if (matriculaId && /^[0-9a-f-]{36}$/i.test(matriculaId)) {
        await supabase.rpc("curso_encuentro_zoom_evento", {
          p_meeting_id: meetingId,
          p_matricula_id: matriculaId,
          p_evento: ev === "meeting.participant_joined" ? "join" : "leave",
          p_ocurrido_at: at,
          p_payload: part,
        });
      }
    } else if (ev === "recording.completed" && meetingId) {
      const files = (p?.recording_files ?? []) as Array<any>;
      const mp4 = files.find((f) => f?.file_type === "MP4");
      const grabacionUrl = mp4?.download_url ?? p?.share_url ?? null;
      const playUrl = p?.share_url ?? grabacionUrl;
      if (grabacionUrl) {
        await supabase.rpc("curso_encuentro_zoom_grabacion", {
          p_meeting_id: meetingId,
          p_grabacion_url: grabacionUrl,
          p_grabacion_play_url: playUrl,
        });
      }
    }
    return jsonResp(200, { ok: true });
  } catch (e) {
    console.error("zoom-webhook dispatch error", e);
    return jsonResp(200, { ok: true, warn: "dispatch_error" }); // 200 para no reintentar en loop
  }
});
