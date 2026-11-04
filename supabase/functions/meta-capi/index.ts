import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ============================================================================
// meta-capi · API de conversiones de Meta (server-side) — DGG-242 (PR 3/3).
// Recibe del navegador un evento (con el MISMO event_id del píxel, para
// DEDUPLICAR) + datos de usuario en CRUDO, los NORMALIZA y HASHEA con SHA-256,
// y los reenvía a la Graph API del dataset de Meta.
//
// Público (verify_jwt=false): lo llama el navegador tras un Lead/Registration.
// Fire-and-forget desde el cliente: si Meta no responde, el formulario igual
// funciona (devolvemos 200 siempre). Retry con backoff. NUNCA se loguea PII ni
// el token. El token vive SÓLO como secret del servidor (META_CAPI_TOKEN).
// ============================================================================

const META_CAPI_TOKEN = Deno.env.get("META_CAPI_TOKEN") ?? "";
const META_TEST_EVENT_CODE = Deno.env.get("META_TEST_EVENT_CODE") ?? "";
const DATASET_ID = Deno.env.get("META_DATASET_ID") ?? "2125673824985124";
const GRAPH_VERSION = "v21.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Normalizaciones de Meta (Advanced Matching).
const normLower = (v: string) => v.normalize("NFKC").trim().toLowerCase();
function normPhone(v: string): string {
  let d = v.replace(/\D/g, "");
  // Argentina: asegurar prefijo de país 54, sólo dígitos.
  if (d.startsWith("00")) d = d.slice(2);
  if (!d.startsWith("54") && d.length >= 8) d = "54" + d;
  return d;
}

interface UserDataIn {
  em?: string; ph?: string; fn?: string; ln?: string; ct?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  // Sin token configurado → no-op silencioso: el flujo del cliente ya terminó
  // bien (el píxel del navegador sí disparó). Se avisa en logs SIN PII.
  if (!META_CAPI_TOKEN) {
    console.warn("meta-capi: META_CAPI_TOKEN no configurado; evento no enviado al servidor.");
    return json(200, { ok: false, reason: "not_configured" });
  }

  let body: {
    event_name?: string; event_id?: string; event_source_url?: string;
    user_data?: UserDataIn; fbp?: string; fbc?: string; client_user_agent?: string;
    content_name?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const { event_name, event_id } = body;
  if (!event_name || !event_id) return json(400, { ok: false, error: "missing_event" });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
  const ua = (body.client_user_agent ?? req.headers.get("user-agent") ?? "").slice(0, 500);
  const u = body.user_data ?? {};

  const user_data: Record<string, unknown> = {};
  if (u.em) user_data.em = [await sha256Hex(normLower(u.em))];
  if (u.ph) { const p = normPhone(u.ph); if (p) user_data.ph = [await sha256Hex(p)]; }
  if (u.fn) user_data.fn = [await sha256Hex(normLower(u.fn))];
  if (u.ln) user_data.ln = [await sha256Hex(normLower(u.ln))];
  if (u.ct) user_data.ct = [await sha256Hex(normLower(u.ct))];
  user_data.country = [await sha256Hex("ar")];
  if (body.fbp) user_data.fbp = body.fbp;
  if (body.fbc) user_data.fbc = body.fbc;
  if (ip) user_data.client_ip_address = ip;
  if (ua) user_data.client_user_agent = ua;

  const payload: Record<string, unknown> = {
    data: [{
      event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_id,
      event_source_url: body.event_source_url,
      action_source: "website",
      user_data,
      ...(body.content_name ? { custom_data: { content_name: body.content_name } } : {}),
    }],
    access_token: META_CAPI_TOKEN,
    ...(META_TEST_EVENT_CODE ? { test_event_code: META_TEST_EVENT_CODE } : {}),
  };

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${DATASET_ID}/events`;

  // Retry con backoff (sólo 5xx / red). NUNCA loguear PII ni el token.
  let reason = "unknown";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return json(200, { ok: true });
      reason = `meta_${res.status}`;
      // El cuerpo de error de Meta puede incluir fbtrace_id (útil, no-PII).
      let trace = "";
      try { trace = String(((await res.json()) as { error?: { fbtrace_id?: string } })?.error?.fbtrace_id ?? ""); } catch { /* noop */ }
      console.warn(`meta-capi: Meta ${res.status} intento ${attempt + 1}${trace ? ` fbtrace=${trace}` : ""}`);
      if (res.status < 500) break; // 4xx no se reintenta
    } catch {
      reason = "network_error";
      console.warn(`meta-capi: error de red intento ${attempt + 1}`);
    }
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  // 200 siempre: el formulario del cliente NO depende de esto.
  return json(200, { ok: false, reason });
});
