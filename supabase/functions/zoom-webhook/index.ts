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
  // DGG-11/15: doble lookup — el meeting puede ser de un curso (Campus Fase 3)
  // o de un webinar. Determinamos contexto consultando ambas tablas. Si está
  // en webinars, usamos la RPC webinar_zoom_evento + match por email del
  // participante (no por customer_key porque el join es link externo).
  try {
    const ev = body?.event as string | undefined;
    const p = body?.payload?.object ?? {};
    const meetingIdRaw = p?.id;
    const meetingId = meetingIdRaw ? Number(meetingIdRaw) : null;

    if (!meetingId) return jsonResp(200, { ok: true });

    // Determinar contexto: ¿curso, webinar o sesión compartida?
    const { data: webinarMatch } = await supabase
      .from("webinars")
      .select("id")
      .eq("zoom_meeting_id", meetingId)
      .maybeSingle();
    const esWebinar = !!webinarMatch;

    // F11/DGG-79: si el meeting es de una SESIÓN compartida (2+ cursos comparten
    // la sala), el meeting_id vive en encuentro_sesiones_compartidas y NO en
    // ninguna fila de curso_encuentros. Lo enrutamos a las RPCs de sesión, que
    // abanican el presente a cada curso enganchado.
    let esSesionCompartida = false;
    if (!esWebinar) {
      const { data: sesMatch } = await supabase
        .from("encuentro_sesiones_compartidas")
        .select("id")
        .eq("zoom_meeting_id", meetingId)
        .maybeSingle();
      esSesionCompartida = !!sesMatch;
    }

    if (ev === "meeting.started") {
      if (esWebinar) {
        await supabase.rpc("webinar_zoom_evento", {
          p_zoom_meeting_id: meetingId,
          p_inscripto_id: null,
          p_evento: "start",
          p_ocurrido_at: p?.start_time ?? new Date().toISOString(),
          p_payload: p,
        });
      } else if (esSesionCompartida) {
        await supabase.rpc("encuentro_sesion_zoom_estado", {
          p_meeting_id: meetingId,
          p_estado: "en_curso",
          p_ocurrido_at: p?.start_time ?? new Date().toISOString(),
        });
      } else {
        await supabase.rpc("curso_encuentro_zoom_estado", {
          p_meeting_id: meetingId,
          p_estado: "en_curso",
          p_ocurrido_at: p?.start_time ?? new Date().toISOString(),
        });
      }
    } else if (ev === "meeting.ended") {
      if (esWebinar) {
        await supabase.rpc("webinar_zoom_evento", {
          p_zoom_meeting_id: meetingId,
          p_inscripto_id: null,
          p_evento: "end",
          p_ocurrido_at: p?.end_time ?? new Date().toISOString(),
          p_payload: p,
        });
      } else if (esSesionCompartida) {
        await supabase.rpc("encuentro_sesion_zoom_estado", {
          p_meeting_id: meetingId,
          p_estado: "finalizado",
          p_ocurrido_at: p?.end_time ?? new Date().toISOString(),
        });
      } else {
        await supabase.rpc("curso_encuentro_zoom_estado", {
          p_meeting_id: meetingId,
          p_estado: "finalizado",
          p_ocurrido_at: p?.end_time ?? new Date().toISOString(),
        });
        // E-GG-145 · disparar la reconciliación con el reporte oficial de Zoom
        // (cubre a quien entró por link crudo/app nativa, sin customer_key).
        // Fire-and-catch: si falla, el cron cada 15 min la reintenta.
        try {
          const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
          await fetch(`${SUPABASE_URL}/functions/v1/zoom-reconciliar-asistencia`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${cronSecret}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ zoom_meeting_id: meetingId }),
          });
        } catch (e) {
          console.error("reconciliar_invoke_error", String(e));
        }
      }
    } else if (ev === "meeting.participant_joined" || ev === "meeting.participant_left") {
      const part = p?.participant ?? {};
      const at = (ev === "meeting.participant_joined" ? part?.join_time : part?.leave_time)
        ?? new Date().toISOString();
      const evento = ev === "meeting.participant_joined" ? "join" : "leave";

      if (esWebinar) {
        // Webinars: link externo. Match por user_email (si Zoom lo manda) contra
        // webinar_inscriptos.email_snapshot. Si no, log payload sin inscripto.
        const userEmail = (part?.email ?? part?.user_email ?? "").toString().toLowerCase().trim();
        let inscriptoId: string | null = null;
        if (userEmail) {
          const { data: insc } = await supabase
            .from("webinar_inscriptos")
            .select("id")
            .eq("webinar_id", (webinarMatch as { id: string }).id)
            .eq("email_snapshot", userEmail)
            .maybeSingle();
          inscriptoId = (insc as { id: string } | null)?.id ?? null;
        }
        await supabase.rpc("webinar_zoom_evento", {
          p_zoom_meeting_id: meetingId,
          p_inscripto_id: inscriptoId,
          p_evento: evento,
          p_ocurrido_at: at,
          p_payload: part,
        });
      } else if (esSesionCompartida) {
        // F11/DGG-79: el customer_key es la matrícula del curso DESDE EL QUE entró.
        // La RPC de sesión resuelve la persona (profile) y abanica el presente a
        // todas sus matrículas activas en los cursos enganchados a la sesión.
        const matriculaId = part?.customer_key as string | undefined;
        if (matriculaId && /^[0-9a-f-]{36}$/i.test(matriculaId)) {
          await supabase.rpc("encuentro_sesion_zoom_evento", {
            p_meeting_id: meetingId,
            p_matricula_id: matriculaId,
            p_evento: evento,
            p_ocurrido_at: at,
            p_payload: part,
          });
        }
      } else {
        // Cursos: customer_key viene del Meeting SDK (ZoomMtg.join customerKey=matriculaId).
        // E-GG-145: si no viene (link crudo/app nativa), fallback por email del
        // participante; y se registre o no la identidad, el evento SIEMPRE queda
        // loggeado (matricula_id NULL) — nunca más descartes silenciosos.
        const matriculaId = part?.customer_key as string | undefined;
        if (matriculaId && /^[0-9a-f-]{36}$/i.test(matriculaId)) {
          await supabase.rpc("curso_encuentro_zoom_evento", {
            p_meeting_id: meetingId,
            p_matricula_id: matriculaId,
            p_evento: evento,
            p_ocurrido_at: at,
            p_payload: part,
          });
        } else {
          const userEmail = (part?.email ?? part?.user_email ?? "").toString().toLowerCase().trim();
          const { error: evErr } = await supabase.rpc("curso_encuentro_zoom_evento_por_email", {
            p_meeting_id: meetingId,
            p_email: userEmail,
            p_evento: evento,
            p_ocurrido_at: at,
            p_payload: part,
          });
          if (evErr) console.error("evento_por_email_error", evErr.message);
        }
      }
    } else if (ev === "recording.completed") {
      const files = (p?.recording_files ?? []) as Array<any>;
      const mp4 = files.find((f) => f?.file_type === "MP4");
      const grabacionUrl = mp4?.download_url ?? p?.share_url ?? null;
      const playUrl = p?.share_url ?? grabacionUrl;
      if (grabacionUrl) {
        if (esWebinar) {
          await supabase
            .from("webinars")
            .update({ grabacion_url: playUrl ?? grabacionUrl })
            .eq("zoom_meeting_id", meetingId);
        } else if (esSesionCompartida) {
          await supabase.rpc("encuentro_sesion_zoom_grabacion", {
            p_meeting_id: meetingId,
            p_grabacion_url: grabacionUrl,
            p_grabacion_play_url: playUrl,
          });
        } else {
          await supabase.rpc("curso_encuentro_zoom_grabacion", {
            p_meeting_id: meetingId,
            p_grabacion_url: grabacionUrl,
            p_grabacion_play_url: playUrl,
          });
        }
      }
    }
    return jsonResp(200, { ok: true });
  } catch (e) {
    console.error("zoom-webhook dispatch error", e);
    return jsonResp(200, { ok: true, warn: "dispatch_error" }); // 200 para no reintentar en loop
  }
});
