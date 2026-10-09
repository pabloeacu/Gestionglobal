import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { DOMParser, type Element } from "jsr:@b-fuze/deno-dom";

// ============================================================================
// TRAMIX · tramix-backfill (DGG-216) · goteo de fondo para completar las fichas
// con fecha de matrícula + vencimiento reales leídos del legajo oficial DPPJ-PBA.
// Procesa 1 legajo por invocación (pg_cron cada 1 min → ritmo muy suave con el
// sitio gov). Reusa VERBATIM el flujo TRAMIX de tramix-consulta (DGG-46):
// sesión reusable + QueryExped + parser + paginación. Respeta el circuit-breaker
// (tramix_throttle) y registra en tramix_record. Service-auth (cron_secret).
//
// Método (validado con Pablo, pilotos Amado/Barraza/Berueta):
//   matriculación = `ADMINISTRADOR DE CONSORCIOS`/INSCRIPTO
//   última renov. = `RENOVACION DE MATRICULA`/INSCRIPTO (la más reciente)
//   vencimiento   = (última renov., o matriculación si nunca renovó) + 12 meses
//   casos raros (sin matriculación / baja-suspensión / NOT_FOUND / scrape parcial)
//   → FLAG o reintento; NO se inventa ni se escribe.
// ============================================================================

const BASE = Deno.env.get("TRAMIX_BASE_URL") ?? "http://tramix.persjuri.gba.gov.ar:8080/TRAMIX";
const ORIGIN = BASE.replace(/\/TRAMIX$/, "");
const UA = "GestionGlobal-PortalClientes/1.0 (consulta informativa de expedientes; +https://gestionglobal.ar)";
const TIMEOUT_MS = 12000;
const SESSION_MAX_MS = 18 * 60 * 1000;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Content-Type": "application/json" };
// Usuario gerencia (Pablo) para el registro en tramix_record (circuit-breaker).
const BF_USER = "49aca7aa-b4fb-4855-aaf3-f05ddafa56d5";
const MAX_INTENTOS = 4;

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
    if (opts.follow && loc && r.status >= 300 && r.status < 400) { await r.body?.cancel(); url = loc.startsWith("http") ? loc : ORIGIN + (loc.startsWith("/") ? loc : "/TRAMIX/" + loc); method = "GET"; body = undefined; continue; }
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
function parseNextHref(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html"); if (!doc) return null;
  for (const a of [...doc.querySelectorAll('a[href*="direccion=SIGUIENTE"]')] as Element[]) {
    if (clean(a.textContent || "").toLowerCase().includes("siguiente")) { const h = a.getAttribute("href"); if (h) return h; }
  }
  return null;
}
async function getCookie(svc: any, forceNew = false): Promise<string> {
  if (!forceNew) {
    const { data } = await svc.from("tramix_session").select("cookie, aceptado_at").eq("id", "singleton").maybeSingle();
    if (data?.cookie && data.aceptado_at && (Date.now() - new Date(data.aceptado_at).getTime() < SESSION_MAX_MS)) return data.cookie;
  }
  const cookie = await establishSession();
  await svc.from("tramix_session").upsert({ id: "singleton", cookie, aceptado_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  return cookie;
}

// --- Interpretación (validada con Pablo) ---
function pDMY(s: string) { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((s || "").trim()); return m ? { d: +m[1], mo: +m[2], y: +m[3] } : null; }
function isoOf(x: any) { return x ? `${x.y}-${String(x.mo).padStart(2, "0")}-${String(x.d).padStart(2, "0")}` : null; }
function plus12(x: any) { return x ? `${x.y + 1}-${String(x.mo).padStart(2, "0")}-${String(x.d).padStart(2, "0")}` : null; }
function interpret(exps: any[]) {
  const mats = exps.filter((e) => /ADMINISTRADOR DE CONSORCIOS/i.test(e.tramite || "") && /INSCRIPTO/i.test(e.estado || "")).map((e) => pDMY(e.fecha)).filter(Boolean).sort((a: any, b: any) => (a.y - b.y) || (a.mo - b.mo) || (a.d - b.d));
  const renos = exps.filter((e) => /RENOVACION DE MATRICULA/i.test(e.tramite || "") && /INSCRIPTO/i.test(e.estado || "")).map((e) => pDMY(e.fecha)).filter(Boolean).sort((a: any, b: any) => (b.y - a.y) || (b.mo - a.mo) || (b.d - a.d));
  const especial = exps.filter((e) => /BAJA|SUSPEN|CANCEL|INHABIL|REHABIL/i.test(e.tramite || ""));
  const mat = mats[0] || null, reno = renos[0] || null, ancla = reno || mat;
  let flag: string | null = null;
  if (!mat && !reno) flag = "sin_mat_ni_reno";
  else if (!mat) flag = "sin_matriculacion";
  if (especial.length) flag = (flag ? flag + ";" : "") + "especial:" + [...new Set(especial.map((e) => e.tramite))].join("|");
  return { matriculacion: isoOf(mat), ultima_renovacion: isoOf(reno), vencimiento: plus12(ancla), n_reno: renos.length, flag };
}

// Query completo de un legajo (con paginación). Devuelve {expedientes, parcial} o lanza.
async function consultarLegajo(svc: any, legajo: string): Promise<{ expedientes: any[]; parcial: boolean; titular: string }> {
  const qs = `txtLegajo=${encodeURIComponent(legajo)}&txtNumero=&txtAnio=&txtDenom=&chbPersonalQuery=&orderBy=LEGAJO`;
  let cookie = await getCookie(svc);
  let r = await hit(`/QueryExped?${qs}`, { cookie, follow: true });
  if (looksTC(r.body)) { cookie = await getCookie(svc, true); r = await hit(`/QueryExped?${qs}`, { cookie, follow: true }); if (looksTC(r.body)) { return { expedientes: [], parcial: true, titular: "" }; } }
  const p = parseResults(r.body);
  if (!p.expedientes.length && p.count !== 0) return { expedientes: [], parcial: true, titular: "" };
  let parcial = false;
  const refKey = (e: any, i: number) => (e?.detalle_ref?.o || e?.detalle_ref?.n || e?.detalle_ref?.a) ? `${e.detalle_ref.o}:${e.detalle_ref.t}:${e.detalle_ref.n}:${e.detalle_ref.a}` : (e?.numero || `#${i}`);
  const seen = new Set<string>(p.expedientes.map((e, i) => refKey(e, i)));
  let nextHref = parseNextHref(r.body); let pages = 1;
  while (nextHref) {
    if (pages >= 25) { parcial = true; break; }
    let abs: string;
    try { const u = new URL(nextHref, BASE); if (u.origin !== ORIGIN) { parcial = true; break; } abs = u.href; } catch { parcial = true; break; }
    let rn; try { rn = await hit(abs, { cookie, follow: true }); } catch { parcial = true; break; }
    if (rn.cookie) cookie = rn.cookie;
    if (looksTC(rn.body)) { cookie = await getCookie(svc, true); try { rn = await hit(abs, { cookie, follow: true }); } catch { parcial = true; break; } if (rn.cookie) cookie = rn.cookie; if (looksTC(rn.body)) { parcial = true; break; } }
    const pn = parseResults(rn.body); let added = 0;
    for (const e of pn.expedientes) { const k = refKey(e, seen.size); if (!seen.has(k)) { seen.add(k); p.expedientes.push(e); added++; } }
    if (added === 0) break;
    nextHref = parseNextHref(rn.body); pages++;
  }
  return { expedientes: p.expedientes, parcial, titular: p.expedientes[0]?.denominacion ?? "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  try {
    // --- Auth: sólo la cron (cron_secret del vault) ---
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: okAuth } = await svc.rpc("is_cron_token", { p_token: token });
    if (okAuth !== true) return json({ error: "unauthorized" }, 401);

    // --- Circuit-breaker (compartido con tramix-consulta) ---
    const { data: th } = await svc.from("tramix_throttle").select("circuito_abierto_hasta").eq("id", "singleton").maybeSingle();
    if (th?.circuito_abierto_hasta && new Date(th.circuito_abierto_hasta).getTime() > Date.now()) {
      return json({ skipped: "circuit_open", retry_at: th.circuito_abierto_hasta });
    }

    // --- Claim 1 legajo ---
    const { data: claimed } = await svc.rpc("tramix_backfill_claim");
    const row = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!row) {
      const { count } = await svc.from("tramix_backfill_queue").select("id", { count: "exact", head: true }).eq("estado", "pendiente");
      return json({ done: true, pendientes: count ?? 0 });
    }
    const { id: rowId, admin_id, legajo } = row;

    // --- Query TRAMIX ---
    let res: any;
    try {
      res = await consultarLegajo(svc, legajo);
    } catch (e) {
      const r = e instanceof TramixTimeout ? "TIMEOUT" : "TRAMIX_DOWN";
      await svc.rpc("tramix_record", { p_user: BF_USER, p_administracion: admin_id, p_legajo: legajo, p_resultado: r });
      // reintento (o error tras MAX_INTENTOS)
      const { data: cur } = await svc.from("tramix_backfill_queue").select("intentos").eq("id", rowId).maybeSingle();
      const intentos = (cur?.intentos ?? 0) + 1;
      await svc.from("tramix_backfill_queue").update({ intentos, estado: intentos >= MAX_INTENTOS ? "error" : "pendiente", resultado: r, updated_at: new Date().toISOString() }).eq("id", rowId);
      return json({ legajo, resultado: r, intentos, requeued: intentos < MAX_INTENTOS });
    }

    // scrape parcial → no confiar (podría faltar la última renovación) → reintento
    if (res.parcial) {
      await svc.rpc("tramix_record", { p_user: BF_USER, p_administracion: admin_id, p_legajo: legajo, p_resultado: "PARSE_ERROR" });
      const { data: cur } = await svc.from("tramix_backfill_queue").select("intentos").eq("id", rowId).maybeSingle();
      const intentos = (cur?.intentos ?? 0) + 1;
      await svc.from("tramix_backfill_queue").update({ intentos, estado: intentos >= MAX_INTENTOS ? "flag" : "pendiente", flag: intentos >= MAX_INTENTOS ? "scrape_parcial" : null, resultado: "PARCIAL", updated_at: new Date().toISOString() }).eq("id", rowId);
      return json({ legajo, resultado: "PARCIAL", intentos });
    }

    const exps = res.expedientes;
    await svc.rpc("tramix_record", { p_user: BF_USER, p_administracion: admin_id, p_legajo: legajo, p_resultado: exps.length ? "OK" : "NOT_FOUND" });

    if (!exps.length) {
      await svc.from("tramix_backfill_queue").update({ estado: "flag", flag: "not_found", resultado: "NOT_FOUND", n_expedientes: 0, titular: res.titular, updated_at: new Date().toISOString() }).eq("id", rowId);
      return json({ legajo, resultado: "NOT_FOUND" });
    }

    const it = interpret(exps);
    const limpio = it.flag === null;

    if (limpio) {
      // Escribir la ficha (certeza confirmado = dato oficial en administraciones).
      await svc.from("administraciones").update({ matricula_rpac_fecha: it.matriculacion, matricula_rpac_vencimiento: it.vencimiento }).eq("id", admin_id);
    }
    await svc.from("tramix_backfill_queue").update({
      estado: limpio ? "ok" : "flag",
      matriculacion: it.matriculacion, ultima_renovacion: it.ultima_renovacion, vencimiento: it.vencimiento,
      n_expedientes: exps.length, flag: it.flag, resultado: "OK", titular: res.titular,
      updated_at: new Date().toISOString(),
    }).eq("id", rowId);

    return json({ legajo, titular: res.titular, estado: limpio ? "ok" : "flag", matriculacion: it.matriculacion, ultima_renovacion: it.ultima_renovacion, vencimiento: it.vencimiento, n_reno: it.n_reno, n_exp: exps.length, flag: it.flag });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
