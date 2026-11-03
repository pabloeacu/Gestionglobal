// encuesta-export · DGG-240
// Motor único de export de encuestas de satisfacción. Lo consumen:
//   - La descarga manual de gerencia (modo 'single'): devuelve b64 del PDF/Excel.
//   - El digest periódico al CM (modo 'digest'): genera el combinado de todos
//     los cursos con novedad, lo sube a Storage y encola el mail (commit RPC).
//
// Auth (verify_jwt=false; la función valida sola):
//   - cron: Authorization = Bearer <cron_secret> → public.is_cron_token.
//   - gerente: Authorization = JWT del usuario → profiles.role='gerente'.
//
// Generación en Deno probada (spike): pdf-lib@1.17.1 (vectorial) + xlsx@0.18.5.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1';
import * as XLSX from 'npm:xlsx@0.18.5';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'email-assets';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---- paleta de marca ----
const CYAN = rgb(0, 0.619, 0.792);     // #009ECA
const INK = rgb(0.071, 0.133, 0.188);  // #122230
const MUTED = rgb(0.365, 0.447, 0.518);// #5D7284
const GREEN = rgb(0.055, 0.624, 0.431);// #0E9F6E
const GOLD = rgb(0.961, 0.620, 0.043); // #F59E0B
const LIGHT = rgb(0.906, 0.945, 0.976);// #E7F1F9
const BORDER = rgb(0.886, 0.910, 0.941);
const STARBG = rgb(0.85, 0.87, 0.90);

type Pregunta = { id: string; tipo: string; titulo: string; opciones?: string[] };
type Respuesta = {
  id: string; fecha: string; alumno_nombre: string | null;
  respuestas: Record<string, unknown>;
  permite_publicar: boolean; publicado: boolean;
  testimonio_nombre: string | null; testimonio_comentario: string | null; testimonio_foto_url: string | null;
};
type Curso = {
  encuesta_id: string; titulo: string; curso_titulo: string | null;
  preguntas: Pregunta[]; total: number; publicables: number; respuestas: Respuesta[];
};
type Dataset = { generado_at: string; desde: string | null; hasta: string; cursos: Curso[] };

// ------------------------------------------------------------------ utils
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// pdf-lib StandardFonts usan WinAnsi: hay que sanear lo que no encaje (emoji, etc.).
function sani(s: unknown): string {
  let t = String(s ?? '');
  t = t.normalize('NFC')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ');
  // dejar sólo lo codificable por WinAnsi (Latin-1 + algunos signos)
  let out = '';
  for (const ch of t) {
    const c = ch.codePointAt(0)!;
    // WinAnsi/CP1252 codifica ASCII imprimible (32-126) + Latin-1 (160-255).
    // 127 (DEL) y 128-159 (controles C1) NO son codificables → se descartan,
    // igual que los emojis (c>255). Si no, pdf-lib tira en drawText.
    if (c === 9 || c === 10 || (c >= 32 && c <= 126) || (c >= 160 && c <= 255)) out += ch;
    else out += '';
  }
  return out;
}

function fmtFecha(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' });
  } catch { return iso; }
}
function fmtFechaHora(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
  } catch { return iso; }
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = sani(text).split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  // Una "palabra" sola más larga que maxW (URL/token pegado) se parte por chars.
  const pieces = (w: string): string[] => {
    if (!w || font.widthOfTextAtSize(w, size) <= maxW) return [w];
    const parts: string[] = []; let chunk = '';
    for (const ch of w) {
      if (chunk && font.widthOfTextAtSize(chunk + ch, size) > maxW) { parts.push(chunk); chunk = ch; }
      else chunk += ch;
    }
    if (chunk) parts.push(chunk);
    return parts;
  };
  for (const w of words) {
    for (const piece of pieces(w)) {
      const test = cur ? cur + ' ' + piece : piece;
      if (font.widthOfTextAtSize(test, size) > maxW && cur) { lines.push(cur); cur = piece; }
      else cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// ------------------------------------------------------------------ agregación (replica StatCard)
type Agg =
  | { tipo: 'escala_10' | 'estrellas'; titulo: string; avg: number; max: number; n: number; dist: { k: string; c: number }[] }
  | { tipo: 'multiple' | 'casillas'; titulo: string; n: number; dist: { k: string; c: number; pct: number }[] }
  | { tipo: 'texto'; titulo: string; n: number; textos: string[] };

function aggregate(preg: Pregunta, rows: Respuesta[]): Agg {
  const values: unknown[] = [];
  for (const r of rows) {
    const v = r.respuestas?.[preg.id];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    values.push(v);
  }
  const n = values.length;
  if (preg.tipo === 'escala_10' || preg.tipo === 'estrellas') {
    const nums = values.map((v) => Number(v)).filter((x) => Number.isFinite(x));
    const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    const max = preg.tipo === 'escala_10' ? 10 : 5;
    const distMap: Record<string, number> = {};
    for (const x of nums) distMap[String(x)] = (distMap[String(x)] ?? 0) + 1;
    const dist = Object.entries(distMap).map(([k, c]) => ({ k, c })).sort((a, b) => Number(a.k) - Number(b.k));
    return { tipo: preg.tipo, titulo: preg.titulo, avg, max, n, dist };
  }
  if (preg.tipo === 'casillas') {
    const counts: Record<string, number> = {};
    for (const v of values) { const arr = Array.isArray(v) ? v : [v]; for (const it of arr) { const k = String(it); counts[k] = (counts[k] ?? 0) + 1; } }
    const dist = Object.entries(counts).map(([k, c]) => ({ k, c, pct: Math.round((c * 100) / (n || 1)) })).sort((a, b) => b.c - a.c);
    return { tipo: 'casillas', titulo: preg.titulo, n, dist };
  }
  if (preg.tipo === 'multiple') {
    const counts: Record<string, number> = {};
    for (const v of values) { const k = String(v); counts[k] = (counts[k] ?? 0) + 1; }
    const dist = Object.entries(counts).map(([k, c]) => ({ k, c, pct: Math.round((c * 100) / (n || 1)) })).sort((a, b) => b.c - a.c);
    return { tipo: 'multiple', titulo: preg.titulo, n, dist };
  }
  return { tipo: 'texto', titulo: preg.titulo, n, textos: values.map((v) => String(v)) };
}

function valorCelda(preg: Pregunta, v: unknown): string | number {
  if (v === undefined || v === null) return '';
  if (preg.tipo === 'escala_10' || preg.tipo === 'estrellas') { const x = Number(v); return Number.isFinite(x) ? x : ''; }
  if (preg.tipo === 'casillas') { const arr = Array.isArray(v) ? v : [v]; return arr.map((x) => String(x)).join(' · '); }
  return String(v);
}

// ------------------------------------------------------------------ PDF
class Doc {
  pdf!: PDFDocument; page!: PDFPage; reg!: PDFFont; bold!: PDFFont;
  y = 0; W = 595.28; H = 841.89; M = 48;
  async init() {
    this.pdf = await PDFDocument.create();
    this.reg = await this.pdf.embedFont(StandardFonts.Helvetica);
    this.bold = await this.pdf.embedFont(StandardFonts.HelveticaBold);
    this.newPage();
  }
  newPage() { this.page = this.pdf.addPage([this.W, this.H]); this.y = this.H - this.M; }
  need(h: number) { if (this.y - h < this.M + 24) this.newPage(); }
  get innerW() { return this.W - this.M * 2; }
  text(s: string, x: number, size: number, font: PDFFont, color = INK) {
    this.page.drawText(sani(s), { x, y: this.y, size, font, color });
  }
  // título de pregunta con wrap; devuelve alto consumido
  heading(s: string, size: number, font: PDFFont, color = INK, gap = 6) {
    const lines = wrap(s, font, size, this.innerW);
    this.need(lines.length * (size + 3) + gap);
    for (const ln of lines) { this.page.drawText(ln, { x: this.M, y: this.y, size, font, color }); this.y -= size + 3; }
    this.y -= gap;
  }
  stars(x: number, yTop: number, avg: number, sz: number) {
    const path = 'M 10 0 L 12.35 6.9 L 19.5 7.1 L 13.8 11.5 L 15.9 18.5 L 10 14.2 L 4.1 18.5 L 6.2 11.5 L 0.5 7.1 L 7.65 6.9 Z';
    const unit = 20 * (sz / 20); const gap = unit * 0.28;
    const rounded = Math.round(avg);
    for (let i = 0; i < 5; i++) {
      this.page.drawSvgPath(path, { x: x + i * (unit + gap), y: yTop, color: i < rounded ? GOLD : STARBG, scale: sz / 20 });
    }
  }
  bar(x: number, y: number, w: number, frac: number, color = CYAN, h = 9) {
    this.page.drawRectangle({ x, y, width: w, height: h, color: LIGHT });
    const fw = Math.max(0, Math.min(1, frac)) * w;
    if (fw > 0) this.page.drawRectangle({ x, y, width: fw, height: h, color });
  }
  rule() { this.need(10); this.page.drawLine({ start: { x: this.M, y: this.y }, end: { x: this.W - this.M, y: this.y }, thickness: 1, color: BORDER }); this.y -= 12; }
}

function drawAgg(d: Doc, a: Agg) {
  d.heading(a.titulo, 11, d.bold, INK, 4);
  if (a.tipo === 'escala_10' || a.tipo === 'estrellas') {
    d.need(a.tipo === 'estrellas' ? 30 : 24);
    const avgTxt = a.avg.toFixed(1);
    d.page.drawText(avgTxt, { x: d.M, y: d.y - 4, size: 18, font: d.bold, color: CYAN });
    const avgW = d.bold.widthOfTextAtSize(avgTxt, 18);
    d.page.drawText(`/ ${a.max}`, { x: d.M + avgW + 5, y: d.y - 2, size: 10, font: d.reg, color: MUTED });
    d.page.drawText(`${a.n} respuesta(s)`, { x: d.W - d.M - d.reg.widthOfTextAtSize(`${a.n} respuesta(s)`, 9), y: d.y - 2, size: 9, font: d.reg, color: MUTED });
    if (a.tipo === 'estrellas') { d.stars(d.M + avgW + 50, d.y + 14, a.avg, 15); d.y -= 30; }
    else {
      const bx = d.M + avgW + 55; const bw = d.innerW - avgW - 55 - 90;
      d.bar(bx, d.y, bw, a.avg / a.max); d.y -= 24;
    }
  } else if (a.tipo === 'multiple' || a.tipo === 'casillas') {
    for (const row of a.dist) {
      d.need(16);
      const label = `${row.k}`;
      const lblLines = wrap(label, d.reg, 9, d.innerW - 150);
      d.page.drawText(lblLines[0] + (lblLines.length > 1 ? '…' : ''), { x: d.M, y: d.y, size: 9, font: d.reg, color: INK });
      const cntTxt = `${row.c} (${row.pct}%)`;
      d.page.drawText(cntTxt, { x: d.W - d.M - d.reg.widthOfTextAtSize(cntTxt, 9), y: d.y, size: 9, font: d.bold, color: CYAN });
      d.y -= 11;
      d.bar(d.M, d.y, d.innerW, row.pct / 100, CYAN, 5); d.y -= 11;
    }
    d.page.drawText(`${a.n} respuesta(s)${a.tipo === 'casillas' ? ' · multi' : ''}`, { x: d.M, y: d.y, size: 8, font: d.reg, color: MUTED });
    d.y -= 14;
  } else {
    d.page.drawText(`${a.n} respuesta(s) de texto`, { x: d.M, y: d.y, size: 9, font: d.reg, color: MUTED }); d.y -= 14;
    for (const t of a.textos.slice(0, 8)) {
      const lines = wrap('“' + t + '”', d.reg, 9, d.innerW - 10);
      for (const ln of lines) { d.need(12); d.page.drawText(ln, { x: d.M + 8, y: d.y, size: 9, font: d.reg, color: MUTED }); d.y -= 11; }
      d.y -= 2;
    }
    if (a.textos.length > 8) { d.page.drawText(`(+${a.textos.length - 8} más en el Excel)`, { x: d.M + 8, y: d.y, size: 8, font: d.reg, color: MUTED }); d.y -= 12; }
  }
  d.y -= 6;
}

async function buildPdf(ds: Dataset, titulo: string, periodo: string): Promise<Uint8Array> {
  const d = new Doc(); await d.init();
  // Cabecera de marca
  d.page.drawRectangle({ x: 0, y: d.H - 6, width: d.W, height: 6, color: CYAN });
  d.text('GESTIÓN GLOBAL', d.M, 13, d.bold, CYAN); d.y -= 20;
  d.heading(titulo, 20, d.bold, INK, 2);
  d.page.drawText(sani(periodo), { x: d.M, y: d.y, size: 10, font: d.reg, color: MUTED }); d.y -= 14;
  d.page.drawText(`Generado ${fmtFechaHora(ds.generado_at)}`, { x: d.M, y: d.y, size: 8, font: d.reg, color: MUTED }); d.y -= 16;
  d.rule();

  if (ds.cursos.length === 0 || ds.cursos.every((c) => c.total === 0)) {
    d.heading('Sin respuestas en el período seleccionado.', 11, d.reg, MUTED);
  }

  for (const curso of ds.cursos) {
    d.need(60);
    // encabezado de curso
    d.page.drawRectangle({ x: d.M - 6, y: d.y - 4, width: d.innerW + 12, height: 22, color: LIGHT });
    d.page.drawText(sani(curso.curso_titulo || curso.titulo), { x: d.M, y: d.y + 2, size: 12, font: d.bold, color: INK });
    const meta = `${curso.total} respuesta(s) · ${curso.publicables} publicable(s)`;
    d.page.drawText(meta, { x: d.W - d.M - d.reg.widthOfTextAtSize(meta, 9), y: d.y + 3, size: 9, font: d.reg, color: MUTED });
    d.y -= 30;

    if (curso.total === 0) { d.page.drawText('Sin respuestas en el período.', { x: d.M, y: d.y, size: 9, font: d.reg, color: MUTED }); d.y -= 20; continue; }

    for (const preg of curso.preguntas) drawAgg(d, aggregate(preg, curso.respuestas));

    // testimonios publicables (con comentario)
    const tests = curso.respuestas.filter((r) => r.permite_publicar && (r.testimonio_comentario || r.testimonio_nombre));
    if (tests.length) {
      d.need(24); d.heading('Testimonios publicables', 12, d.bold, GREEN, 4);
      for (const t of tests.slice(0, 20)) {
        const who = t.testimonio_nombre || t.alumno_nombre || 'Alumno';
        const foto = t.testimonio_foto_url ? '  [foto adjunta]' : '';
        d.need(14);
        d.page.drawText(sani(who + foto), { x: d.M, y: d.y, size: 9, font: d.bold, color: INK }); d.y -= 11;
        if (t.testimonio_comentario) {
          for (const ln of wrap('“' + t.testimonio_comentario + '”', d.reg, 9, d.innerW - 10)) { d.need(12); d.page.drawText(ln, { x: d.M + 8, y: d.y, size: 9, font: d.reg, color: MUTED }); d.y -= 11; }
        }
        d.y -= 4;
      }
    }
    d.y -= 6; d.rule();
  }

  // footer con número de página
  const pages = d.pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(`Gestión Global · Encuestas de satisfacción`, { x: d.M, y: 24, size: 7, font: d.reg, color: MUTED });
    const pg = `${i + 1} / ${pages.length}`;
    p.drawText(pg, { x: d.W - d.M - d.reg.widthOfTextAtSize(pg, 7), y: 24, size: 7, font: d.reg, color: MUTED });
  });
  return await d.pdf.save();
}

// ------------------------------------------------------------------ XLSX
function buildXlsx(ds: Dataset): string {
  const wb = XLSX.utils.book_new();

  // Hoja Resumen
  const resumen: (string | number)[][] = [['Curso', 'Respuestas', 'Publicables', 'Pregunta', 'Tipo', 'Resultado']];
  for (const c of ds.cursos) {
    if (!c.preguntas.length) resumen.push([c.curso_titulo || c.titulo, c.total, c.publicables, '', '', '']);
    c.preguntas.forEach((preg, idx) => {
      const a = aggregate(preg, c.respuestas);
      let res = '';
      if (a.tipo === 'escala_10' || a.tipo === 'estrellas') res = `${a.avg.toFixed(1)} / ${a.max} (${a.n})`;
      else if (a.tipo === 'texto') res = `${a.n} texto(s)`;
      else res = a.dist.map((x) => `${x.k}: ${x.c} (${x.pct}%)`).join(' · ');
      resumen.push([idx === 0 ? (c.curso_titulo || c.titulo) : '', idx === 0 ? c.total : '', idx === 0 ? c.publicables : '', preg.titulo, preg.tipo, res]);
    });
  }
  const wsR = XLSX.utils.aoa_to_sheet(resumen);
  wsR['!cols'] = [{ wch: 34 }, { wch: 12 }, { wch: 12 }, { wch: 42 }, { wch: 12 }, { wch: 46 }];
  XLSX.utils.book_append_sheet(wb, wsR, 'Resumen');

  // Una hoja por curso: una fila por respuesta
  const usados = new Set<string>();
  ds.cursos.forEach((c, ci) => {
    const header = ['Fecha', 'Alumno', ...c.preguntas.map((p) => p.titulo), 'Autoriza publicar', 'Testimonio (nombre)', 'Testimonio (comentario)', 'Foto (URL)'];
    const aoa: (string | number)[][] = [header];
    for (const r of c.respuestas) {
      aoa.push([
        fmtFechaHora(r.fecha),
        r.alumno_nombre ?? '',
        ...c.preguntas.map((p) => valorCelda(p, r.respuestas?.[p.id])),
        r.permite_publicar ? 'SÍ' : 'NO',
        r.testimonio_nombre ?? '',
        r.testimonio_comentario ?? '',
        r.testimonio_foto_url ?? '',
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // hyperlink en la columna Foto
    const fotoCol = header.length - 1;
    for (let i = 0; i < c.respuestas.length; i++) {
      const url = c.respuestas[i].testimonio_foto_url;
      if (url) {
        const addr = XLSX.utils.encode_cell({ r: i + 1, c: fotoCol });
        ws[addr] = { t: 's', v: 'Ver / descargar foto', l: { Target: url, Tooltip: 'Abrir foto del testimonio' } };
      }
    }
    ws['!cols'] = header.map((h, i) => (i === 0 ? { wch: 18 } : i === 1 ? { wch: 24 } : i >= header.length - 2 ? { wch: 40 } : { wch: 20 }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } }) };
    // nombre de hoja seguro y único (máx 31)
    let name = sani(c.curso_titulo || c.titulo).replace(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || `Curso ${ci + 1}`;
    let base = name, k = 2;
    while (usados.has(name.toLowerCase())) { name = `${base.slice(0, 26)} ${k++}`; }
    usados.add(name.toLowerCase());
    XLSX.utils.book_append_sheet(wb, ws, name);
  });

  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

// ------------------------------------------------------------------ periodo label
function periodoLabel(desde: string | null, hasta: string): string {
  const h = new Date(new Date(hasta).getTime() - 1); // último instante cubierto
  if (!desde) return `hasta el ${fmtFecha(h.toISOString())}`;
  return `${fmtFecha(desde)} al ${fmtFecha(h.toISOString())}`;
}

// ------------------------------------------------------------------ handler
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // --- auth ---
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  let caller: 'cron' | 'gerente' | 'operador' | null = null;
  if (token) {
    const { data: isCron } = await admin.rpc('is_cron_token', { p_token: token });
    if (isCron === true) caller = 'cron';
    else {
      const { data: u } = await admin.auth.getUser(token);
      if (u?.user) {
        const { data: prof } = await admin.from('profiles').select('role').eq('id', u.user.id).maybeSingle();
        if (prof?.role === 'gerente') caller = 'gerente';
        else if (prof?.role === 'operador') caller = 'operador';
      }
    }
  }
  if (!caller) return json({ error: 'unauthorized' }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* vacío */ }
  const mode = (body.mode as string) || 'digest';

  try {
    if (mode === 'single') {
      // single lo usan gerente (descarga manual) y cron/servicio (confiable).
      const encuestaId = body.encuesta_id as string;
      if (!encuestaId) return json({ error: 'encuesta_id requerido' }, 400);
      const desde = (body.desde as string) || null;
      const hasta = (body.hasta as string) || new Date().toISOString();
      const formato = (body.formato as string) || 'both';
      const { data: ds, error } = await admin.rpc('encuesta_export_dataset', { p_desde: desde, p_hasta: hasta, p_encuesta_id: encuestaId });
      if (error) return json({ error: error.message }, 500);
      const data = ds as Dataset;
      const titulo = data.cursos[0]?.curso_titulo || data.cursos[0]?.titulo || 'Encuesta de satisfacción';
      const periodo = periodoLabel(desde, hasta);
      const out: Record<string, unknown> = { ok: true };
      const slug = sani(titulo).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'encuesta';
      if (formato === 'pdf' || formato === 'both') {
        const pdf = await buildPdf(data, titulo, periodo);
        out.pdf_b64 = encodeB64(pdf);
        out.pdf_filename = `encuesta-${slug}.pdf`;
      }
      if (formato === 'xlsx' || formato === 'both') {
        out.xlsx_b64 = buildXlsx(data);
        out.xlsx_filename = `encuesta-${slug}.xlsx`;
      }
      return json(out);
    }

    // --- digest ---
    const force = body.force === true;
    if (caller === 'operador') return json({ error: 'forbidden' }, 403);
    if (caller === 'gerente' && !force) return json({ error: 'gerente debe forzar' }, 400);

    const { data: est, error: estErr } = await admin.rpc('encuesta_cm_estado');
    if (estErr) return json({ error: estErr.message }, 500);
    const estado = est as { activo: boolean; due: boolean; corte: string; cubierto_hasta: string | null; emails: string };
    // force (gerente "Enviar ahora") dispara aun con el recurrente apagado.
    if (!force && !estado.activo) return json({ ok: true, skipped: 'inactivo' });
    if (!force && !estado.due) return json({ ok: true, skipped: 'no_due' });
    if (!estado.emails || !estado.emails.trim()) return json({ ok: true, skipped: 'sin_emails' });

    const desde = estado.cubierto_hasta;
    const corte = estado.corte;
    const origen = caller === 'cron' ? 'cron' : 'manual';
    const { data: ds, error } = await admin.rpc('encuesta_export_dataset', { p_desde: desde, p_hasta: corte, p_encuesta_id: null });
    if (error) return json({ error: error.message }, 500);
    const data = ds as Dataset;
    const periodo = periodoLabel(desde, corte);
    const totResp = data.cursos.reduce((a, c) => a + c.total, 0);
    const totPub = data.cursos.reduce((a, c) => a + c.publicables, 0);

    if (data.cursos.length === 0 || totResp === 0) {
      // sin novedad: avanza reloj, no manda mail
      const { data: c0 } = await admin.rpc('encuesta_cm_commit', {
        p_origen: origen, p_corte: corte, p_desde: desde, p_bucket: BUCKET,
        p_pdf_path: null, p_xlsx_path: null, p_pdf_filename: null, p_xlsx_filename: null,
        p_resumen: { cursos: 0, respuestas: 0, publicables: 0, periodo_label: periodo },
      });
      return json({ ok: true, sin_novedad: true, overall: (c0 as { overall?: string })?.overall });
    }

    const pdf = await buildPdf(data, 'Encuestas de satisfacción', periodo);
    const xlsxB64 = buildXlsx(data);

    // Guard de tamaño: dispatch-emails omite adjuntos en silencio si superan ~7MB.
    // Si el combinado se acerca al cap, NO enviamos: logueamos error y NO avanzamos
    // el reloj (la ventana queda pendiente para reintento / decisión). [A#1/B#2]
    const totalB64 = Math.ceil(pdf.length / 3) * 4 + xlsxB64.length;
    if (totalB64 > 6_500_000) {
      await admin.rpc('encuesta_cm_commit', {
        p_origen: origen, p_corte: corte, p_desde: desde, p_bucket: BUCKET,
        p_pdf_path: null, p_xlsx_path: null, p_pdf_filename: null, p_xlsx_filename: null,
        p_resumen: { cursos: data.cursos.length, respuestas: totResp, publicables: totPub, periodo_label: periodo },
        p_error: `adjuntos demasiado grandes (~${Math.round(totalB64 / 1024)}KB b64); ventana no enviada`,
      });
      return json({ ok: false, error: 'adjuntos_demasiado_grandes', kb: Math.round(totalB64 / 1024) }, 500);
    }

    const stamp = corte.slice(0, 10);
    const pdfPath = `encuesta-cm/${stamp}/resumen-${Date.now()}.pdf`;
    const xlsxPath = `encuesta-cm/${stamp}/respuestas-${Date.now()}.xlsx`;
    const up1 = await admin.storage.from(BUCKET).upload(pdfPath, pdf, { contentType: 'application/pdf', upsert: true });
    if (up1.error) return json({ error: `upload pdf: ${up1.error.message}` }, 500);
    const up2 = await admin.storage.from(BUCKET).upload(xlsxPath, b64ToU8(xlsxB64), { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: true });
    if (up2.error) { await admin.storage.from(BUCKET).remove([pdfPath]); return json({ error: `upload xlsx: ${up2.error.message}` }, 500); }

    const { data: committed, error: cErr } = await admin.rpc('encuesta_cm_commit', {
      p_origen: origen, p_corte: corte, p_desde: desde, p_bucket: BUCKET,
      p_pdf_path: pdfPath, p_xlsx_path: xlsxPath, p_pdf_filename: 'resumen-encuestas.pdf', p_xlsx_filename: 'respuestas-encuestas.xlsx',
      p_resumen: { cursos: data.cursos.length, respuestas: totResp, publicables: totPub, periodo_label: periodo },
    });
    if (cErr) { await admin.storage.from(BUCKET).remove([pdfPath, xlsxPath]); return json({ error: `commit: ${cErr.message}` }, 500); }
    const overall = (committed as { overall?: string })?.overall;
    // si no se encoló (sin_destinatarios / ya_procesado), los archivos quedan huérfanos → limpiar.
    if (overall !== 'ok') await admin.storage.from(BUCKET).remove([pdfPath, xlsxPath]);
    return json({ ok: true, overall, cursos: data.cursos.length, respuestas: totResp, publicables: totPub, commit: committed });
  } catch (e) {
    return json({ error: String(e), stack: (e as Error)?.stack ?? null }, 500);
  }
});

// ------------------------------------------------------------------ base64 helpers (Deno)
function encodeB64(u8: Uint8Array): string {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + CH)));
  return btoa(s);
}
function b64ToU8(b64: string): Uint8Array {
  const bin = atob(b64); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
