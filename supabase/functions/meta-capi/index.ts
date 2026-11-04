import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ============================================================================
// meta-capi · API de conversiones de Meta (server-side) — DGG-242 (PR 3/3).
// Recibe del navegador un evento (con el MISMO event_id del píxel, para
// DEDUPLICAR) + datos de usuario en CRUDO, los NORMALIZA y HASHEA con SHA-256,
// y los reenvía a la Graph API del dataset de Meta.
//
// Público (verify_jwt=false): lo llama el navegador tras un Lead/Registration.
// Fire-and-forget desde el cliente: si Meta no responde, el formulario igual
// funciona (devolvemos 200 siempre). Retry con backoff + timeout por intento.
// NUNCA se loguea PII ni el token. El token vive SÓLO como secret del servidor
// (META_CAPI_TOKEN). Riesgo asumido (documentado): endpoint público sin
// rate-limit → a lo sumo spam de eventos falsos (Meta deduplica/valida); no hay
// acceso a datos ni al token.
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

// Normalizaciones de Meta (Advanced Matching). `s()` sólo acepta strings.
const s = (x: unknown): string => (typeof x === "string" ? x : "");
const stripDiacritics = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "");
const normEmail = (v: string) => v.trim().toLowerCase();
const normName = (v: string) => stripDiacritics(v.trim().toLowerCase());
const normCity = (v: string) => stripDiacritics(v.trim().toLowerCase()).replace(/\s+/g, "");
function normPhone(v: string): string {
  let d = v.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2); // prefijo internacional
  if (d.startsWith("54")) d = d.slice(2); // código de país (lo re-agregamos luego)
  d = d.replace(/^0+/, ""); // 0 troncal
  if (d.length < 8) return ""; // demasiado corto → inválido
  return "54" + d; // Meta espera código de país sin "+"
}

interface UserDataIn { em?: unknown; ph?: unknown; fn?: unknown; ln?: unknown; ct?: unknown; }

async function handle(req: Request): Promise<Response> {
  // Sin token configurado → no-op silencioso: el flujo del cliente ya terminó
  // bien (el píxel del navegador sí disparó). Se avisa en logs SIN PII.
  if (!META_CAPI_TOKEN) {
    console.warn("meta-capi: META_CAPI_TOKEN no configurado; evento no enviado al servidor.");
    return json(200, { ok: false, reason: "not_configured" });
  }

  let body: {
    event_name?: unknown; event_id?: unknown; event_source_url?: unknown;
    user_data?: UserDataIn; fbp?: unknown; fbc?: unknown; client_user_agent?: unknown;
    content_name?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const event_name = s(body.event_name);
  const event_id = s(body.event_id);
  if (!event_name || !event_id) return json(400, { ok: false, error: "missing_event" });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
  const ua = (s(body.client_user_agent) || req.headers.get("user-agent") || "").slice(0, 500);
  const u: UserDataIn = (body.user_data && typeof body.user_data === "object") ? body.user_data : {};

  const user_data: Record<string, unknown> = {};
  if (s(u.em)) user_data.em = [await sha256Hex(normEmail(s(u.em)))];
  if (s(u.ph)) { const p = normPhone(s(u.ph)); if (p) user_data.ph = [await sha256Hex(p)]; }
  if (s(u.fn)) user_data.fn = [await sha256Hex(normName(s(u.fn)))];
  if (s(u.ln)) user_data.ln = [await sha256Hex(normName(s(u.ln)))];
  if (s(u.ct)) { const c = normCity(s(u.ct)); if (c) user_data.ct = [await sha256Hex(c)]; }
  user_data.country = [await sha256Hex("ar")];
  if (s(body.fbp)) user_data.fbp = s(body.fbp);
  if (s(body.fbc)) user_data.fbc = s(body.fbc);
  if (ip) user_data.client_ip_address = ip;
  if (ua) user_data.client_user_agent = ua;

  const content_name = s(body.content_name);
  const payload: Record<string, unknown> = {
    data: [{
      event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_id,
      event_source_url: s(body.event_source_url) || undefined,
      action_source: "website",
      user_data,
      ...(content_name ? { custom_data: { content_name } } : {}),
    }],
    access_token: META_CAPI_TOKEN,
    ...(META_TEST_EVENT_CODE ? { test_event_code: META_TEST_EVENT_CODE } : {}),
  };

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${DATASET_ID}/events`;

  // Retry con backoff + timeout por intento. NUNCA loguear PII ni el token.
  let reason = "unknown";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return json(200, { ok: true });
      reason = `meta_${res.status}`;
      let trace = "";
      try { trace = String(((await res.json()) as { error?: { fbtrace_id?: string } })?.error?.fbtrace_id ?? ""); } catch { /* noop */ }
      console.warn(`meta-capi: Meta ${res.status} intento ${attempt + 1}${trace ? ` fbtrace=${trace}` : ""}`);
      if (res.status < 500) break; // 4xx no se reintenta
    } catch {
      reason = "network_error";
      console.warn(`meta-capi: error de red/timeout intento ${attempt + 1}`);
    }
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  return json(200, { ok: false, reason });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  // Red de robustez: ningún input malicioso (campos no-string, etc.) debe
  // tumbar el edge con una excepción no capturada; siempre 200 para el cliente.
  try {
    return await handle(req);
  } catch (_e) {
    console.warn("meta-capi: excepción no esperada (input inválido); evento descartado.");
    return json(200, { ok: false, reason: "bad_input" });
  }
});
