import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// DGG-221 · prospectos-reimport-padron
// Re-import automático del padrón PBA (cada 10 días, pg_cron). Baja el CSV
// público de la planilla "Datos matriculados en PBA", lo parsea y se lo pasa a
// la RPC `prospectos_reimport_aplicar`, que descarta clientes + ya-importados,
// inserta los NUEVOS y los encola al goteo TRAMIX → se suman solos a las campañas.
// Service-auth (is_cron_token). Idempotente: re-correr no duplica.
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHEET_ID = Deno.env.get("PADRON_SHEET_ID") ?? "10Y5b4FvlSKY4mGced_5TtQt4TWb23qL7RrYejZJPAIg";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Content-Type": "application/json" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: CORS });

// Parser CSV robusto (campos entre comillas con comas/comillas escapadas, CRLF/LF).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* ignore */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  try {
    // --- Auth: sólo la cron ---
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: okAuth } = await svc.rpc("is_cron_token", { p_token: token });
    if (okAuth !== true) return json({ error: "unauthorized" }, 401);

    // --- Bajar el CSV (fetch sigue el 307 a googleusercontent) ---
    const r = await fetch(CSV_URL, { redirect: "follow", signal: AbortSignal.timeout(45000) });
    if (!r.ok) return json({ error: "csv_fetch_failed", status: r.status }, 502);
    const csv = await r.text();
    if (/<html|accounts\.google\.com|sign in/i.test(csv.slice(0, 500))) {
      return json({ error: "csv_no_publico", hint: "La planilla dejó de ser accesible por link." }, 502);
    }

    const table = parseCsv(csv);
    if (table.length < 2) return json({ error: "csv_vacio", filas: table.length }, 502);

    // Mapeo por posición: 0 matricula, 1 legajo, 2 nombre, 3 cuit, 4 mail, 5 sanciones.
    // Saltamos la cabecera (fila 0).
    const rows = table.slice(1)
      .filter((cols) => cols.some((c) => (c || "").trim() !== ""))
      .map((cols) => ({
        matricula: (cols[0] || "").trim(),
        legajo: (cols[1] || "").trim(),
        nombre: (cols[2] || "").trim(),
        cuit: (cols[3] || "").trim(),
        mail: (cols[4] || "").trim(),
        sanciones: (cols[5] || "").trim(),
      }))
      .filter((x) => x.legajo !== "" && x.nombre !== "");

    if (rows.length === 0) return json({ error: "sin_filas_usables", crudas: table.length });

    // --- Aplicar (dedup + insert + encolar TRAMIX) ---
    const { data: res, error } = await svc.rpc("prospectos_reimport_aplicar", { p_rows: rows });
    if (error) return json({ error: "rpc_error", detail: error.message }, 500);

    return json({ ok: true, filas_csv: rows.length, resultado: res });
  } catch (e) {
    return json({ error: "excepcion", detail: String(e) }, 500);
  }
});
