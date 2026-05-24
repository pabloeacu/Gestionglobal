// supabase/functions/webex-webhook/index.ts
//
// DGG-19 · Webhooks de Webex para tracking de asistencia.
//
// Events suscritos (configurar en developer.webex.com → Webhooks):
//   - meetings.started        → marca encuentro 'en_curso'
//   - meetings.ended          → marca 'finalizado' + cierra asistencias
//   - meetingParticipants.joined → registra ingreso del alumno
//   - meetingParticipants.left   → registra salida + acumula tiempo
//
// Signature: Webex usa HMAC-SHA1 con secret en header X-Spark-Signature.
//
// verify_jwt=false (es webhook público de Webex).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBEX_WEBHOOK_SECRET = Deno.env.get("WEBEX_WEBHOOK_SECRET") ?? "";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function verifyWebexSignature(
  rawBody: string,
  signature: string,
): Promise<boolean> {
  if (!WEBEX_WEBHOOK_SECRET) return true; // skip if not configured (dev)
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBEX_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex === signature;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });

  const rawBody = await req.text();
  const signature = req.headers.get("X-Spark-Signature") ?? "";
  const ok = await verifyWebexSignature(rawBody, signature);
  if (!ok) return json(401, { error: "invalid_signature" });

  let event: any;
  try { event = JSON.parse(rawBody); } catch { return json(400, { error: "json" }); }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Webex event structure: { resource, event, data: { ... } }
  // resource: 'meetings' | 'meetingParticipants'
  // event: 'started' | 'ended' | 'joined' | 'left'
  const resource = event?.resource as string | undefined;
  const evt = event?.event as string | undefined;
  const data = event?.data ?? {};

  try {
    if (resource === "meetings" && evt === "started") {
      const meetingId = data.id as string | undefined;
      if (!meetingId) return json(400, { error: "no_meeting_id" });
      await admin.rpc("webex_encuentro_started", {
        p_webex_meeting_id: meetingId,
        p_started_at: data.startTime ?? new Date().toISOString(),
      });
    } else if (resource === "meetings" && evt === "ended") {
      const meetingId = data.id as string | undefined;
      if (!meetingId) return json(400, { error: "no_meeting_id" });
      await admin.rpc("webex_encuentro_ended", {
        p_webex_meeting_id: meetingId,
        p_ended_at: data.endTime ?? new Date().toISOString(),
      });
    } else if (resource === "meetingParticipants" && evt === "joined") {
      const meetingId = data.meetingId as string | undefined;
      const customerKey = data.customerKey as string | undefined;
      if (!meetingId) return json(400, { error: "no_meeting_id" });
      await admin.rpc("webex_participant_joined", {
        p_webex_meeting_id: meetingId,
        p_customer_key: customerKey ?? null,
        p_joined_at: data.joinedTime ?? new Date().toISOString(),
        p_display_name: data.displayName ?? null,
      });
    } else if (resource === "meetingParticipants" && evt === "left") {
      const meetingId = data.meetingId as string | undefined;
      const customerKey = data.customerKey as string | undefined;
      if (!meetingId) return json(400, { error: "no_meeting_id" });
      await admin.rpc("webex_participant_left", {
        p_webex_meeting_id: meetingId,
        p_customer_key: customerKey ?? null,
        p_left_at: data.leftTime ?? new Date().toISOString(),
      });
    } else {
      // event no soportado — devolvemos 200 igual (Webex re-intentaría)
      return json(200, { ignored: true, resource, event: evt });
    }
  } catch (e: any) {
    console.error("webex-webhook error", e);
    return json(500, { error: "rpc_failed", detail: e?.message });
  }

  return json(200, { ok: true });
});
