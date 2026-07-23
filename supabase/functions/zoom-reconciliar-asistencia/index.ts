// supabase/functions/zoom-reconciliar-asistencia/index.ts
//
// E-GG-145 · Reconciliación de asistencia post-reunión (la garantía).
//
// La asistencia en tiempo real depende de que el participante entre por el
// SDK embebido (customer_key). Si entra por el link crudo / app nativa, el
// webhook no puede identificarlo. Esta función cierra ese hueco: consulta el
// reporte OFICIAL de participantes de Zoom (email + join/leave + duración) y
// se lo pasa a la RPC curso_encuentro_reconciliar_asistencia, que computa
// asistencia SIN degradar nada (nunca pisa manual, nunca baja presente=true).
//
// Invocación:
//   - zoom-webhook (meeting.ended) → { zoom_meeting_id }
//   - cron gg-zoom-reconciliar-asistencia (cada 15 min) → {} (barre pendientes
//     vía RPC zoom_encuentros_pendientes_reconciliar; idempotente)
//   - manual → { encuentro_id }
//
// ⚠️ DEPLOY: SIEMPRE con verify_jwt=false explícito (lección DGG-113) — la
// auth es CRON_SECRET o service_role validada ACÁ ADENTRO.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const ZOOM_ACCOUNT_ID = Deno.env.get("ZOOM_ACCOUNT_ID") ?? "";
const ZOOM_CLIENT_ID = Deno.env.get("ZOOM_S2S_CLIENT_ID") ?? "";
const ZOOM_CLIENT_SECRET = Deno.env.get("ZOOM_S2S_CLIENT_SECRET") ?? "";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// REST/RPC con fetch crudo (patrón F9: sin bundle supabase-js → boot estable).
async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`rpc_${name}_${r.status}: ${await r.text()}`);
  return await r.json();
}

async function restSelect(path: string): Promise<unknown[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
  });
  if (!r.ok) throw new Error(`rest_${r.status}: ${await r.text()}`);
  return (await r.json()) as unknown[];
}

async function zoomToken(): Promise<string> {
  const basic = btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`);
  const r = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
    { method: "POST", headers: { Authorization: `Basic ${basic}` } },
  );
  if (!r.ok) throw new Error(`zoom_oauth_${r.status}: ${await r.text()}`);
  return (await r.json()).access_token as string;
}

interface ZoomParticipant {
  customer_key?: string;
  user_email?: string;
  name?: string;
  join_time?: string;
  leave_time?: string;
  duration?: number; // segundos
}

// Trae los participantes del reporte. Preferimos /report (más completo,
// requiere scope report:read:admin); si el scope no está, fallback a
// /past_meetings (scope meeting básico).
async function fetchParticipantes(
  token: string,
  meetingId: number,
): Promise<{ participantes: ZoomParticipant[]; fuente: string }> {
  const bases = [
    `https://api.zoom.us/v2/report/meetings/${meetingId}/participants`,
    `https://api.zoom.us/v2/past_meetings/${meetingId}/participants`,
  ];
  let lastErr = "";
  for (const base of bases) {
    try {
      const acc: ZoomParticipant[] = [];
      let next = "";
      do {
        const url = `${base}?page_size=300${next ? `&next_page_token=${next}` : ""}`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
        const j = await r.json();
        acc.push(...((j?.participants ?? []) as ZoomParticipant[]));
        next = (j?.next_page_token as string) ?? "";
      } while (next);
      return { participantes: acc, fuente: base.includes("/report/") ? "report" : "past_meetings" };
    } catch (e) {
      lastErr = String(e);
      // probar el siguiente endpoint (típico: 400/401 por scope faltante)
    }
  }
  throw new Error(`zoom_participants_failed: ${lastErr}`);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });

  // Auth: CRON_SECRET o service_role (validación interna; verify_jwt=false).
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer || (bearer !== CRON_SECRET && bearer !== SERVICE_ROLE)) {
    return json(401, { error: "unauthorized" });
  }

  let body: { encuentro_id?: string; zoom_meeting_id?: number } = {};
  try { body = await req.json(); } catch { /* body vacío = barrer pendientes */ }

  try {
    // Resolver la lista de encuentros a reconciliar.
    let objetivos: Array<{ encuentro_id: string; zoom_meeting_id: number }> = [];
    if (body.encuentro_id) {
      const rows = await restSelect(
        `curso_encuentros?id=eq.${body.encuentro_id}&select=id,zoom_meeting_id&limit=1`,
      ) as Array<{ id: string; zoom_meeting_id: number | null }>;
      if (rows[0]?.zoom_meeting_id) {
        objetivos = [{ encuentro_id: rows[0].id, zoom_meeting_id: rows[0].zoom_meeting_id }];
      }
    } else if (body.zoom_meeting_id) {
      const rows = await restSelect(
        `curso_encuentros?zoom_meeting_id=eq.${body.zoom_meeting_id}&select=id,zoom_meeting_id&limit=1`,
      ) as Array<{ id: string; zoom_meeting_id: number | null }>;
      if (rows[0]?.zoom_meeting_id) {
        objetivos = [{ encuentro_id: rows[0].id, zoom_meeting_id: rows[0].zoom_meeting_id }];
      }
    } else {
      objetivos = (await rpc("zoom_encuentros_pendientes_reconciliar", {})) as Array<{
        encuentro_id: string; zoom_meeting_id: number;
      }>;
    }

    if (!objetivos.length) return json(200, { ok: true, reconciliados: 0 });

    const token = await zoomToken();
    const resultados: unknown[] = [];
    for (const o of objetivos) {
      try {
        const { participantes, fuente } = await fetchParticipantes(token, o.zoom_meeting_id);
        const payload = participantes.map((p) => ({
          customer_key: p.customer_key ?? null,
          email: p.user_email ?? null,
          nombre: p.name ?? null,
          join_time: p.join_time ?? null,
          leave_time: p.leave_time ?? null,
          duration_seg: p.duration ?? 0,
        }));
        const res = await rpc("curso_encuentro_reconciliar_asistencia", {
          p_encuentro_id: o.encuentro_id,
          p_participantes: payload,
        });
        resultados.push({ encuentro_id: o.encuentro_id, fuente, participantes: payload.length, ...res as object });
      } catch (e) {
        // Un encuentro que falla no frena a los demás; el cron reintenta
        // (asistencia_reconciliada_at queda NULL hasta lograr reconciliar).
        console.error("reconciliar_encuentro_error", o.encuentro_id, String(e));
        resultados.push({ encuentro_id: o.encuentro_id, error: String(e) });
      }
    }
    return json(200, { ok: true, reconciliados: resultados.length, resultados });
  } catch (e) {
    console.error("zoom-reconciliar-asistencia error", e);
    return json(500, { error: String(e) });
  }
});
