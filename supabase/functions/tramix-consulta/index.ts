import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { DOMParser, type Element } from "jsr:@b-fuze/deno-dom";

// ============================================================================
// TRAMIX · tramix-consulta (PRODUCCIÓN) · DGG-46
// Consulta de expedientes DPPJ-PBA (Mesa de Entradas Virtual) para el portal.
// 100% aislada. El legajo es EDITABLE por el usuario (TRAMIX es consulta
// pública, Disp. DPPJ 148/06): default = el que manda el cliente (su última
// consulta) o el de su ficha (administraciones.legajo_rpac). Cache-first + gate
// atómico anti-martilleo (per-usuario) + sesión reusable + circuit-breaker.
// Parsers validados sobre HTML real (legajo 284265 / EZEQUIEL CARLOS GOMEZ).
// ============================================================================

const BASE = Deno.env.get("TRAMIX_BASE_URL") ?? "http://tramix.persjuri.gba.gov.ar:8080/TRAMIX";
const UA = "GestionGlobal-PortalClientes/1.0 (consulta informativa de expedientes; +https://gestionglobal.ar)";
const TIMEOUT_MS = 12000;
const CACHE_FRESH_MS = 15 * 60 * 1000;
const SESSION_MAX_MS = 18 * 60 * 1000;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };

const latin1 = (b: ArrayBuffer) => new TextDecoder("iso-8859-1").decode(b);
const jsess = (sc: string | null) => { if (!sc) return ""; const m = sc.match(/JSESSIONID=[^;]+/i); return m ? m[0] : ""; };
const clean = (s: string) => (s || "").replace(/\s+/g, " ").trim();
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: CORS });

class TramixDown extends Error {}
class TramixTimeout extends Error {}

async function hit(path: string, opts: { method?: string; body?: string; cookie?: string; follow?: boolean } = {}) {
  const headers: Record<string, string> = { "User-Agent": UA, "Accept": "text/html,*/*" };
  if (opts.body != null) headers["Content-Type"] = "application/x-www-form-urlencoded";
  let url = path.startsWith("http") ? path : BASE + path;
  let cookie = opts.cookie ?? ""; let method = opts.method ?? "GET"; let body = opts.body;
  for (let i = 0; i < 4; i++) {
    let r: Response;
    try {
      r = await fetch(url, { method, headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, body, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      if (String(e).includes("timed out") || (e as Error)?.name === "TimeoutError") throw new TramixTimeout(String(e));
      throw new TramixDown(String(e));
    }
    const sc = r.headers.get("set-cookie"); const loc = r.headers.get("location");
    if (jsess(sc)) cookie = jsess(sc);
    if (opts.follow && loc && r.status >= 300 && r.status < 400) { await r.body?.cancel(); url = loc.startsWith("http") ? loc : BASE.replace(/\/TRAMIX$/, "") + (loc.startsWith("/") ? loc : "/TRAMIX/" + loc); method = "GET"; body = undefined; continue; }
    if (r.status >= 500) { await r.body?.cancel(); throw new TramixDown("HTTP " + r.status); }
    return { status: r.status, body: latin1(await r.arrayBuffer()), cookie };
  }
  return { status: 0, body: "", cookie };
}
const looksTC = (h: string) => { const x = h.toLowerCase(); return (x.includes("chbaccept") || x.includes("acepto los t") || x.includes("148/06")) && !x.includes("expedientes que coinciden") && !x.includes("expedientes encontrados") && !x.includes("detalle de expediente"); };

async function establishSession(): Promise<string> {
  const r1 = await hit("/"); let cookie = r1.cookie;
  const r2 = await hit("/jsp/Instrucciones.jsp", { method: "POST", body: "anonymous=true&chbAccept=on&button=Aceptar", cookie }); if (r2.cookie) cookie = r2.cookie;
  await hit("/LoginServlet", { method: "POST", body: "anonymous=true", cookie, follow: true });
  return cookie;
}

function parseResults(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html"); if (!doc) return { count: null as number | null, expedientes: [] as any[] };
  let count: number | null = null; const m = html.match(/encontrado\s+(\d+)\s+expedientes/i) || html.match(/(\d+)\s+expedientes que coinciden/i); if (m) count = parseInt(m[1], 10);
  const links = [...doc.querySelectorAll('a[href*="ExpedDetails"]')] as Element[]; const seen = new Set<Element>(); const expedientes: any[] = [];
  for (const a of links) {
    const tr = a.closest("tr"); if (!tr || seen.has(tr)) continue; seen.add(tr);
    const tds = [...tr.querySelectorAll("td")] as Element[]; const txt = tds.map((d) => clean(d.textContent || ""));
    let li = tds.findIndex((d) => d.querySelector('a[href*="ExpedDetails"]')); if (li < 0) li = tds.findIndex((d) => d.contains(a as unknown as Node));
    const at = (o: number) => { const i = li + o; return i >= 0 && i < txt.length ? txt[i] : ""; };
    let ref: any = null; try { const u = new URL(a.getAttribute("href") || "", "http://x/"); ref = { o: clean(u.searchParams.get("o") || ""), t: clean(u.searchParams.get("t") || "EXP"), n: clean(u.searchParams.get("n") || ""), a: clean(u.searchParams.get("a") || "") }; } catch { /* */ }
    expedientes.push({ legajo: at(-1), numero: clean(a.textContent || ""), alcance: at(1), denominacion: at(2), tramite: at(3), estado: at(4), fecha: at(5), detalle_ref: ref });
  }
  return { count, expedientes };
}
const DET_LABELS = ["Legajo", "Domicilio", "Partido", "Expediente Nº", "Ingresado el", "Tipo de trámite", "Trámites", "Ubicación actual", "Estado", "Nro.de Resolución", "Fecha de Resolución"];
function matchLabel(t: string) { const tl = t.toLowerCase(); for (const L of DET_LABELS) { const lc = L.toLowerCase(); if (tl === lc + ":" || tl === lc) return { key: L, inline: "" }; if (tl.startsWith(lc + ":")) return { key: L, inline: t.slice(L.length + 1).trim() }; } return null; }
function parseDetalle(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html"); if (!doc) return { header: {} as Record<string, string>, actuaciones: [] as any[] };
  const leaves = ([...doc.querySelectorAll("td")] as Element[]).filter((d) => !d.querySelector("td") && !d.querySelector("table"));
  const L = leaves.map((d) => clean(d.textContent || ""));
  const header: Record<string, string> = {};
  for (let i = 0; i < L.length; i++) { const m = matchLabel(L[i]); if (!m) continue; let val = m.inline; if (!val) { const nxt = L[i + 1] || ""; if (nxt && !matchLabel(nxt)) val = nxt; } if (!(m.key in header) || (!header[m.key] && val)) header[m.key] = val; }
  const acts: any[] = []; let actTable: Element | null = null;
  const firstLink = doc.querySelector('a[href*="ActuacionDetails"]') as Element | null; if (firstLink) actTable = firstLink.closest("table");
  if (!actTable) { const ext = leaves.find((d) => /^extracto$/i.test(clean(d.textContent || ""))); if (ext) actTable = ext.closest("table"); }
  const dateRx = /^\d{2}\/\d{2}\/\d{4}$/;
  if (actTable) { for (const tr of [...actTable.querySelectorAll("tr")] as Element[]) { const cs = ([...tr.querySelectorAll("td")] as Element[]).filter((d) => !d.querySelector("td")).map((d) => clean(d.textContent || "")); const di = cs.findIndex((c) => dateRx.test(c)); if (di < 0) continue; const link = tr.querySelector('a[href*="ActuacionDetails"]') as Element | null; let actIdx: string | null = null; if (link) { try { actIdx = new URL(link.getAttribute("href") || "", "http://x/").searchParams.get("actIdx"); } catch { /* */ } } const fecha = cs[di]; const rest = cs.filter((c, idx) => idx !== di && c); const estado = rest.length ? rest[rest.length - 1] : ""; const extracto = rest.length > 1 ? rest.slice(0, -1).join(" ") : (rest[0] || ""); acts.push({ fecha, extracto, estado, actIdx }); } }
  return { header, actuaciones: acts };
}
async function estadoHash(exps: any[]): Promise<string> {
  const s = exps.map((e) => `${e.numero}:${e.estado}`).join("|");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function getCookie(svc: any, forceNew = false): Promise<string> {
  if (!forceNew) {
    const { data } = await svc.from("tramix_session").select("cookie, aceptado_at").eq("id", "singleton").maybeSingle();
    if (data?.cookie && data.aceptado_at && (Date.now() - new Date(data.aceptado_at).getTime() < SESSION_MAX_MS)) return data.cookie;
  }
  const cookie = await establishSession();
  await svc.from("tramix_session").update({ cookie, aceptado_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", "singleton");
  return cookie;
}
const gateToResultado = (d: string) => (d === "circuit_open" ? "CIRCUIT_OPEN" : "RATE_LIMITED");

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
    const action = b.action ?? "consultar";
    const force = !!b.force;
    // Legajo editable: lo que mande el cliente (su última consulta) o el de su ficha.
    const legajoCliente = b.legajo != null ? String(b.legajo).replace(/[^0-9]/g, "") : "";
    const legajo = legajoCliente || legajoDefault;
    if (!legajo) return json({ resultado: "SIN_LEGAJO", legajo_default: legajoDefault });

    // =================== DETALLE ===================
    if (action === "detalle") {
      const ref = b.detalle_ref || {};
      const o = clean(String(ref.o ?? "")), t = clean(String(ref.t ?? "EXP")), n = clean(String(ref.n ?? "")), a = clean(String(ref.a ?? ""));
      if (!o || !n || !a) return json({ resultado: "INVALID" });
      const { data: cacheRow } = await svc.from("tramix_cache").select("payload").eq("legajo", legajo).maybeSingle();
      const owns = !!cacheRow?.payload?.expedientes?.some((e: any) => e?.detalle_ref?.n === n && e?.detalle_ref?.a === a && e?.detalle_ref?.o === o);
      if (!owns) return json({ resultado: "FORBIDDEN" });
      const refKey = `${o}:${t}:${n}:${a}`;
      const { data: dc } = await svc.from("tramix_detalle_cache").select("payload, consultado_at").eq("ref_key", refKey).maybeSingle();
      if (dc && !force && (Date.now() - new Date(dc.consultado_at).getTime() < CACHE_FRESH_MS)) {
        return json({ resultado: "OK", detalle: dc.payload, desde_cache: true, consultado_at: dc.consultado_at, ms: Math.round(performance.now() - t0) });
      }
      const gate = await svc.rpc("tramix_gate", { p_user: user.id, p_legajo: legajo, p_force: force }).then((r: any) => r.data);
      if (gate?.decision !== "allow") {
        if (dc) return json({ resultado: "OK", detalle: dc.payload, desde_cache: true, consultado_at: dc.consultado_at, throttle_note: gate?.decision });
        return json({ resultado: gateToResultado(gate?.decision), wait_ms: gate?.wait_ms, retry_at: gate?.retry_at });
      }
      try {
        let cookie = await getCookie(svc);
        let r = await hit(`/ExpedDetails?o=${encodeURIComponent(o)}&t=${encodeURIComponent(t)}&n=${encodeURIComponent(n)}&a=${encodeURIComponent(a)}`, { cookie, follow: true });
        if (looksTC(r.body)) { cookie = await getCookie(svc, true); r = await hit(`/ExpedDetails?o=${encodeURIComponent(o)}&t=${encodeURIComponent(t)}&n=${encodeURIComponent(n)}&a=${encodeURIComponent(a)}`, { cookie, follow: true }); if (looksTC(r.body)) { await svc.rpc("tramix_record", { p_user: user.id, p_administracion: adminId, p_legajo: legajo, p_resultado: "TC_BLOCKED" }); return json({ resultado: "TC_BLOCKED" }); } }
        const det = parseDetalle(r.body);
        if (!Object.keys(det.header).length) { await svc.rpc("tramix_record", { p_user: user.id, p_administracion: adminId, p_legajo: legajo, p_resultado: "PARSE_ERROR" }); return dc ? json({ resultado: "OK", detalle: dc.payload, desde_cache: true, consultado_at: dc.consultado_at }) : json({ resultado: "PARSE_ERROR" }); }
        await svc.from("tramix_detalle_cache").upsert({ ref_key: refKey, payload: det, consultado_at: new Date().toISOString() });
        await svc.rpc("tramix_record", { p_user: user.id, p_administracion: adminId, p_legajo: legajo, p_resultado: "OK" });
        return json({ resultado: "OK", detalle: det, desde_cache: false, consultado_at: new Date().toISOString(), ms: Math.round(performance.now() - t0) });
      } catch (e) {
        const res = e instanceof TramixTimeout ? "TIMEOUT" : "TRAMIX_DOWN";
        await svc.rpc("tramix_record", { p_user: user.id, p_administracion: adminId, p_legajo: legajo, p_resultado: res });
        if (dc) return json({ resultado: "OK", detalle: dc.payload, desde_cache: true, consultado_at: dc.consultado_at, throttle_note: res });
        return json({ resultado: res });
      }
    }

    // =================== CONSULTAR ===================
    const okList = (payload: any, extra: Record<string, unknown> = {}) => json({ resultado: payload?.expedientes?.length ? "OK" : "NOT_FOUND", legajo, legajo_default: legajoDefault, titular: payload?.titular ?? "", expedientes: payload?.expedientes ?? [], ...extra });
    const { data: cache } = await svc.from("tramix_cache").select("payload, estado_hash, consultado_at").eq("legajo", legajo).maybeSingle();
    if (cache && !force && (Date.now() - new Date(cache.consultado_at).getTime() < CACHE_FRESH_MS)) {
      return okList(cache.payload, { desde_cache: true, consultado_at: cache.consultado_at, ms: Math.round(performance.now() - t0) });
    }
    const gate = await svc.rpc("tramix_gate", { p_user: user.id, p_legajo: legajo, p_force: force }).then((r: any) => r.data);
    if (gate?.decision !== "allow") {
      if (cache) return okList(cache.payload, { desde_cache: true, consultado_at: cache.consultado_at, throttle_note: gate?.decision });
      return json({ resultado: gateToResultado(gate?.decision), legajo, legajo_default: legajoDefault, wait_ms: gate?.wait_ms, retry_at: gate?.retry_at });
    }
    try {
      const qs = `txtLegajo=${encodeURIComponent(legajo)}&txtNumero=&txtAnio=&txtDenom=&chbPersonalQuery=&orderBy=LEGAJO`;
      let cookie = await getCookie(svc);
      let r = await hit(`/QueryExped?${qs}`, { cookie, follow: true });
      if (looksTC(r.body)) { cookie = await getCookie(svc, true); r = await hit(`/QueryExped?${qs}`, { cookie, follow: true }); if (looksTC(r.body)) { await svc.rpc("tramix_record", { p_user: user.id, p_administracion: adminId, p_legajo: legajo, p_resultado: "TC_BLOCKED" }); return cache ? okList(cache.payload, { desde_cache: true, consultado_at: cache.consultado_at, throttle_note: "TC_BLOCKED" }) : json({ resultado: "TC_BLOCKED", legajo, legajo_default: legajoDefault }); } }
      const p = parseResults(r.body);
      if (!p.expedientes.length && p.count !== 0) { await svc.rpc("tramix_record", { p_user: user.id, p_administracion: adminId, p_legajo: legajo, p_resultado: "PARSE_ERROR" }); return cache ? okList(cache.payload, { desde_cache: true, consultado_at: cache.consultado_at, throttle_note: "PARSE_ERROR" }) : json({ resultado: "PARSE_ERROR", legajo, legajo_default: legajoDefault }); }
      const titular = p.expedientes[0]?.denominacion ?? "";
      const payload = { titular, expedientes: p.expedientes };
      const hash = await estadoHash(p.expedientes);
      await svc.from("tramix_cache").upsert({ legajo, payload, estado_hash: hash, consultado_at: new Date().toISOString() });
      await svc.rpc("tramix_record", { p_user: user.id, p_administracion: adminId, p_legajo: legajo, p_resultado: p.expedientes.length ? "OK" : "NOT_FOUND" });
      return okList(payload, { desde_cache: false, consultado_at: new Date().toISOString(), ms: Math.round(performance.now() - t0) });
    } catch (e) {
      const res = e instanceof TramixTimeout ? "TIMEOUT" : "TRAMIX_DOWN";
      await svc.rpc("tramix_record", { p_user: user.id, p_administracion: adminId, p_legajo: legajo, p_resultado: res });
      if (cache) return okList(cache.payload, { desde_cache: true, consultado_at: cache.consultado_at, throttle_note: res });
      return json({ resultado: res, legajo, legajo_default: legajoDefault });
    }
  } catch (e) {
    return json({ resultado: "ERROR", error: String(e), ms: Math.round(performance.now() - t0) }, 500);
  }
});
