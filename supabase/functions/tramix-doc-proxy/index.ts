import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { DOMParser, type Element } from "jsr:@b-fuze/deno-dom";

// ============================================================================
// TRAMIX · tramix-doc-proxy (PRODUCCIÓN) · DGG-46
// Detalle de actuación (texto completo + extracto + fecha de firma) y descarga
// del documento (RTF/.doc) de una actuación. El binario se baja server-side en
// la sesión TRAMIX y se sirve por URL firmada (el cliente no tiene la cookie).
// Aislada. Misma auth/privacidad/gate/sesión que tramix-consulta.
//   action: 'actuacion' → { texto, extracto_actuacion, fecha_firma, tiene_documento }
//   action: 'documento' → { url (firmada), nombre }   (sube a Storage privado + cache)
// ============================================================================

const ROOT = Deno.env.get("TRAMIX_ROOT_URL") ?? "http://tramix.persjuri.gba.gov.ar:8080";
const BASE = ROOT + "/TRAMIX";
const UA = "GestionGlobal-PortalClientes/1.0 (consulta informativa de expedientes; +https://gestionglobal.ar)";
const TIMEOUT_MS = 12000;
const SESSION_MAX_MS = 18 * 60 * 1000;
const DOC_BUCKET = "tramix-documentos";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
// E-GG-51: x-client-info + x-supabase-api-version obligatorios para functions.invoke desde el browser.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };

const latin1 = (b: ArrayBuffer) => new TextDecoder("iso-8859-1").decode(b);
const jsess = (sc: string | null) => { if (!sc) return ""; const m = sc.match(/JSESSIONID=[^;]+/i); return m ? m[0] : ""; };
const clean = (s: string) => (s || "").replace(/\s+/g, " ").trim();
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: CORS });

class TramixDown extends Error {}
class TramixTimeout extends Error {}

type Hit = { status: number; body: string; bytes: ArrayBuffer; ct: string; cd: string; cookie: string };
async function hit(path: string, opts: { method?: string; body?: string; cookie?: string; follow?: boolean } = {}): Promise<Hit> {
  const headers: Record<string, string> = { "User-Agent": UA, "Accept": "*/*" };
  if (opts.body != null) headers["Content-Type"] = "application/x-www-form-urlencoded";
  let url = path.startsWith("http") ? path : BASE + path;
  let cookie = opts.cookie ?? ""; let method = opts.method ?? "GET"; let body = opts.body;
  for (let i = 0; i < 5; i++) {
    let r: Response;
    try {
      r = await fetch(url, { method, headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, body, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      if (String(e).includes("timed out") || (e as Error)?.name === "TimeoutError") throw new TramixTimeout(String(e));
      throw new TramixDown(String(e));
    }
    const sc = r.headers.get("set-cookie"); const loc = r.headers.get("location");
    if (jsess(sc)) cookie = jsess(sc);
    if (opts.follow && loc && r.status >= 300 && r.status < 400) { await r.body?.cancel(); url = loc.startsWith("http") ? loc : ROOT + (loc.startsWith("/") ? loc : "/TRAMIX/" + loc); method = "GET"; body = undefined; continue; }
    if (r.status >= 500) { await r.body?.cancel(); throw new TramixDown("HTTP " + r.status); }
    const buf = await r.arrayBuffer();
    return { status: r.status, body: latin1(buf), bytes: buf, ct: r.headers.get("content-type") || "", cd: r.headers.get("content-disposition") || "", cookie };
  }
  return { status: 0, body: "", bytes: new ArrayBuffer(0), ct: "", cd: "", cookie };
}
const looksTC = (h: string) => { const x = h.toLowerCase(); return (x.includes("chbaccept") || x.includes("acepto los t") || x.includes("148/06")) && !x.includes("detalle de la actuaci") && !x.includes("detalle de expediente"); };

async function establishSession(): Promise<string> {
  const r1 = await hit("/"); let cookie = r1.cookie;
  const r2 = await hit("/jsp/Instrucciones.jsp", { method: "POST", body: "anonymous=true&chbAccept=on&button=Aceptar", cookie }); if (r2.cookie) cookie = r2.cookie;
  await hit("/LoginServlet", { method: "POST", body: "anonymous=true", cookie, follow: true });
  return cookie;
}
async function getCookie(svc: any, forceNew = false): Promise<string> {
  if (!forceNew) {
    const { data } = await svc.from("tramix_session").select("cookie, aceptado_at").eq("id", "singleton").maybeSingle();
    if (data?.cookie && data.aceptado_at && (Date.now() - new Date(data.aceptado_at).getTime() < SESSION_MAX_MS)) return data.cookie;
  }
  const cookie = await establishSession();
  // upsert (no update): si la fila singleton no existe (p.ej. tras una purga),
  // un UPDATE afecta 0 filas en silencio y la sesión jamás se persiste —
  // auto-sanante como tramix_gate (auditoría post-purga DGG-111).
  await svc.from("tramix_session").upsert({ id: "singleton", cookie, aceptado_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  return cookie;
}

function parseActuacion(html: string) {
  const out = { extracto_actuacion: "", fecha_firma: "", texto: "", tiene_documento: false };
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (doc) {
    const ta = doc.querySelector("textarea");
    if (ta) out.texto = (ta.textContent || "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const leaves = ([...doc.querySelectorAll("td")] as Element[]).filter((d) => !d.querySelector("td") && !d.querySelector("table"));
    const L = leaves.map((d) => clean(d.textContent || ""));
    const valFor = (i: number, label: string) => {
      const t = L[i];
      if (t.toLowerCase().startsWith(label) && t.includes(":")) { const v = t.split(/:(.+)/)[1]?.trim() || ""; if (v) return v; }
      return clean(L[i + 1] || "");
    };
    for (let i = 0; i < L.length; i++) {
      const t = L[i].toLowerCase();
      if (!out.extracto_actuacion && t.startsWith("extracto actuaci")) out.extracto_actuacion = valFor(i, "extracto actuaci");
      if (!out.fecha_firma && t.startsWith("fecha de firma")) out.fecha_firma = valFor(i, "fecha de firma");
    }
  }
  const bw = html.match(/buildDownloadWord\(([^)]*)\)/i);
  out.tiene_documento = bw ? !/disabled/i.test(bw[1]) : false;
  return out;
}

async function navegar(cookie: string, o: string, t: string, n: string, a: string, actIdx: string) {
  await hit(`/ExpedDetails?o=${encodeURIComponent(o)}&t=${encodeURIComponent(t)}&n=${encodeURIComponent(n)}&a=${encodeURIComponent(a)}`, { cookie, follow: true });
  return await hit(`/ActuacionDetails?actIdx=${encodeURIComponent(actIdx)}&fromPage=EXPED_DETAILS`, { cookie, follow: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const t0 = performance.now();
  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const { data: ures } = await userClient.auth.getUser();
    const user = ures?.user;
    if (!user) return json({ resultado: "NO_AUTH" }, 401);

    const { data: prof } = await svc.from("profiles").select("administracion_id").eq("id", user.id).maybeSingle();
    const adminId = prof?.administracion_id ?? null;
    if (!adminId) return json({ resultado: "SIN_ADMIN" });
    const { data: adm } = await svc.from("administraciones").select("legajo_rpac").eq("id", adminId).maybeSingle();
    const legajoDefault = String(adm?.legajo_rpac ?? "").replace(/[^0-9]/g, "");

    const b = await req.json().catch(() => ({} as any));
    const action = b.action ?? "actuacion";
    const force = !!b.force;
    // Legajo editable: el que mande el cliente (la consulta que está mirando) o el de su ficha.
    const legajo = (b.legajo != null ? String(b.legajo).replace(/[^0-9]/g, "") : "") || legajoDefault;
    if (!legajo) return json({ resultado: "SIN_LEGAJO" });
    const ref = b.detalle_ref || {};
    const o = clean(String(ref.o ?? "")), t = clean(String(ref.t ?? "EXP")), n = clean(String(ref.n ?? "")), a = clean(String(ref.a ?? ""));
    const actIdx = String(b.actIdx ?? "0").replace(/[^0-9]/g, "") || "0";
    if (!o || !n || !a) return json({ resultado: "INVALID" });

    // privacidad: el expediente debe pertenecer al legajo del usuario (según cache de consultar)
    const { data: cacheRow } = await svc.from("tramix_cache").select("payload").eq("legajo", legajo).maybeSingle();
    const owns = !!cacheRow?.payload?.expedientes?.some((e: any) => e?.detalle_ref?.n === n && e?.detalle_ref?.a === a && e?.detalle_ref?.o === o);
    if (!owns) return json({ resultado: "FORBIDDEN" });

    // ================= DOCUMENTO (descarga) =================
    if (action === "documento") {
      const docKey = `${o}:${t}:${n}:${a}:${actIdx}`;
      const storagePath = `${legajo}/${o}_${t}_${n}_${a}_act${actIdx}.doc`;
      const { data: dc } = await svc.from("tramix_documentos_cache").select("storage_path, nombre").eq("doc_key", docKey).maybeSingle();
      if (dc && !force) {
        const { data: signed } = await svc.storage.from(DOC_BUCKET).createSignedUrl(dc.storage_path, 300, { download: dc.nombre || "documento.doc" });
        if (signed?.signedUrl) return json({ resultado: "OK", url: signed.signedUrl, nombre: dc.nombre || "documento.doc", desde_cache: true });
      }
      const gate = await svc.rpc("tramix_gate", { p_user: user.id, p_legajo: legajo, p_force: force }).then((r: any) => r.data);
      if (gate?.decision !== "allow") return json({ resultado: gate?.decision === "circuit_open" ? "CIRCUIT_OPEN" : "RATE_LIMITED", wait_ms: gate?.wait_ms });
      try {
        let cookie = await getCookie(svc);
        let ad = await navegar(cookie, o, t, n, a, actIdx);
        if (looksTC(ad.body)) { cookie = await getCookie(svc, true); ad = await navegar(cookie, o, t, n, a, actIdx); }
        const dl = await hit(`/DownloadActWord?`, { cookie, follow: true });
        const okBin = dl.status === 200 && dl.bytes.byteLength > 64 && /attachment|octet-stream|msword|rtf/i.test(dl.cd + " " + dl.ct);
        if (!okBin) { await svc.rpc("tramix_record", { p_user: user.id, p_administracion: adminId, p_legajo: legajo, p_resultado: "PARSE_ERROR" }); return json({ resultado: "SIN_DOCUMENTO" }); }
        const nombre = `Actuacion_${n}-${a}.doc`;
        await svc.storage.from(DOC_BUCKET).upload(storagePath, new Uint8Array(dl.bytes), { contentType: "application/msword", upsert: true });
        await svc.from("tramix_documentos_cache").upsert({ doc_key: docKey, storage_path: storagePath, nombre, content_type: "application/msword", bajado_at: new Date().toISOString() });
        await svc.rpc("tramix_record", { p_user: user.id, p_administracion: adminId, p_legajo: legajo, p_resultado: "OK" });
        const { data: signed } = await svc.storage.from(DOC_BUCKET).createSignedUrl(storagePath, 300, { download: nombre });
        return json({ resultado: "OK", url: signed?.signedUrl, nombre, desde_cache: false, ms: Math.round(performance.now() - t0) });
      } catch (e) {
        const res = e instanceof TramixTimeout ? "TIMEOUT" : "TRAMIX_DOWN";
        await svc.rpc("tramix_record", { p_user: user.id, p_administracion: adminId, p_legajo: legajo, p_resultado: res });
        return json({ resultado: res });
      }
    }

    // ================= ACTUACIÓN (texto + campos) =================
    const refKey = `act:${o}:${t}:${n}:${a}:${actIdx}`;
    const { data: ac } = await svc.from("tramix_detalle_cache").select("payload, consultado_at").eq("ref_key", refKey).maybeSingle();
    if (ac && !force && (Date.now() - new Date(ac.consultado_at).getTime() < 15 * 60 * 1000)) {
      return json({ resultado: "OK", actuacion: ac.payload, desde_cache: true, consultado_at: ac.consultado_at });
    }
    const gate = await svc.rpc("tramix_gate", { p_user: user.id, p_legajo: legajo, p_force: force }).then((r: any) => r.data);
    if (gate?.decision !== "allow") {
      if (ac) return json({ resultado: "OK", actuacion: ac.payload, desde_cache: true, consultado_at: ac.consultado_at, throttle_note: gate?.decision });
      return json({ resultado: gate?.decision === "circuit_open" ? "CIRCUIT_OPEN" : "RATE_LIMITED", wait_ms: gate?.wait_ms });
    }
    try {
      let cookie = await getCookie(svc);
      let ad = await navegar(cookie, o, t, n, a, actIdx);
      if (looksTC(ad.body)) { cookie = await getCookie(svc, true); ad = await navegar(cookie, o, t, n, a, actIdx); if (looksTC(ad.body)) { await svc.rpc("tramix_record", { p_user: user.id, p_administracion: adminId, p_legajo: legajo, p_resultado: "TC_BLOCKED" }); return json({ resultado: "TC_BLOCKED" }); } }
      const parsed = parseActuacion(ad.body);
      await svc.from("tramix_detalle_cache").upsert({ ref_key: refKey, payload: parsed, consultado_at: new Date().toISOString() });
      await svc.rpc("tramix_record", { p_user: user.id, p_administracion: adminId, p_legajo: legajo, p_resultado: "OK" });
      return json({ resultado: "OK", actuacion: parsed, desde_cache: false, consultado_at: new Date().toISOString(), ms: Math.round(performance.now() - t0) });
    } catch (e) {
      const res = e instanceof TramixTimeout ? "TIMEOUT" : "TRAMIX_DOWN";
      await svc.rpc("tramix_record", { p_user: user.id, p_administracion: adminId, p_legajo: legajo, p_resultado: res });
      if (ac) return json({ resultado: "OK", actuacion: ac.payload, desde_cache: true, consultado_at: ac.consultado_at, throttle_note: res });
      return json({ resultado: res });
    }
  } catch (e) {
    return json({ resultado: "ERROR", error: String(e), ms: Math.round(performance.now() - t0) }, 500);
  }
});
