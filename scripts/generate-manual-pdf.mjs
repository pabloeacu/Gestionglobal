#!/usr/bin/env node
// scripts/generate-manual-pdf.mjs
//
// Pipeline:
//   1. Lanza Puppeteer (Chromium headless).
//   2. Loguea como gerente y captura pantallas clave del live deploy.
//   3. Renderiza MANUAL.md → HTML branded (minimalist premium).
//   4. Genera docs/MANUAL.pdf con cover + TOC + headers/footers.
//
// Output: docs/MANUAL.pdf y docs/manual-assets/*.jpg.
//
// Variables de entorno opcionales:
//   MANUAL_GERENTE_EMAIL    (default: pabloeacu@gmail.com)
//   MANUAL_GERENTE_PASSWORD (default: EagleView2026)
//   MANUAL_CLIENTE_EMAIL    (default: pabloeacu+maria@gmail.com)
//   MANUAL_CLIENTE_PASSWORD (default: MariaTest2026!)
//   MANUAL_PARTNER_EMAIL    (default: partner@funplata.qa)
//   MANUAL_PARTNER_PASSWORD (default: PartnerTest2026!)
//   MANUAL_BASE_URL         (default: https://www.gestionglobal.ar)
//
// Uso:
//   node scripts/generate-manual-pdf.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import MarkdownIt from 'markdown-it';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'docs', 'manual-assets');
const OUTPUT_PDF = path.join(ROOT, 'docs', 'MANUAL.pdf');
const MD_PATH = path.join(ROOT, 'MANUAL.md');

const BASE = process.env.MANUAL_BASE_URL ?? 'https://www.gestionglobal.ar';
const GERENTE = {
  email: process.env.MANUAL_GERENTE_EMAIL ?? 'pabloeacu@gmail.com',
  password: process.env.MANUAL_GERENTE_PASSWORD ?? 'EagleView2026',
};
const CLIENTE = {
  email: process.env.MANUAL_CLIENTE_EMAIL ?? 'pabloeacu+maria@gmail.com',
  password: process.env.MANUAL_CLIENTE_PASSWORD ?? 'MariaTest2026!',
};
const PARTNER = {
  email: process.env.MANUAL_PARTNER_EMAIL ?? 'partner@funplata.qa',
  password: process.env.MANUAL_PARTNER_PASSWORD ?? 'PartnerTest2026!',
};

const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };

// Lista de capturas a tomar. Cada item: { id, url, login, after?, scroll? }
const SHOTS = [
  // Cover assets primero (no requieren login)
  {
    id: 'login',
    url: `${BASE}/ingresar`,
    login: null,
    description: 'Pantalla de login',
  },
  // Gerencia
  {
    id: 'gerencia-inicio',
    url: `${BASE}/gerencia`,
    login: GERENTE,
    description: 'Inicio del panel de gerencia con onboarding Primeros 5 minutos',
  },
  {
    id: 'gerencia-agenda',
    url: `${BASE}/gerencia/agenda`,
    login: 'reuse',
    description: 'Agenda con subtítulo MDC y barra mágica',
  },
  {
    id: 'gerencia-clientes',
    url: `${BASE}/gerencia/clientes`,
    login: 'reuse',
    description: 'Listado de administraciones',
  },
  {
    id: 'gerencia-tramites',
    url: `${BASE}/gerencia/tramites`,
    login: 'reuse',
    description: 'Listado de trámites con KPIs',
  },
  {
    id: 'gerencia-comunicaciones',
    url: `${BASE}/gerencia/comunicaciones`,
    login: 'reuse',
    description: 'Panel de comunicaciones multi-canal',
  },
  {
    id: 'gerencia-facturacion',
    url: `${BASE}/gerencia/facturacion`,
    login: 'reuse',
    description: 'Comprobantes con KPIs y tabla',
  },
  {
    id: 'gerencia-cuenta-corriente',
    url: `${BASE}/gerencia/cuenta-corriente`,
    login: 'reuse',
    description: 'Cuenta corriente global con IllustratedEmpty',
  },
  {
    id: 'gerencia-finanzas',
    url: `${BASE}/gerencia/finanzas`,
    login: 'reuse',
    description: 'Finanzas con cajas activas',
  },
  {
    id: 'gerencia-campus',
    url: `${BASE}/gerencia/campus`,
    login: 'reuse',
    description: 'Campus virtual con cursos',
  },
  {
    id: 'gerencia-analitica',
    url: `${BASE}/gerencia/analitica`,
    login: 'reuse',
    description: 'Analítica avanzada con charts',
  },
  {
    id: 'gerencia-plantillas',
    url: `${BASE}/gerencia/configuracion/emails/templates`,
    login: 'reuse',
    description: 'Editor de plantillas de email con preview',
  },
  // Logout → Portal cliente
  {
    id: 'portal-home',
    url: `${BASE}/portal`,
    login: CLIENTE,
    description: 'Portal del administrador (cliente) — home',
  },
  {
    id: 'portal-cuenta-corriente',
    url: `${BASE}/portal/cuenta-corriente`,
    login: 'reuse',
    description: 'Cuenta corriente del cliente con saldo evolutivo',
  },
  // Logout → Partner
  {
    id: 'partner-rendiciones',
    url: `${BASE}/partner`,
    login: PARTNER,
    description: 'Portal del partner con rendiciones y comprobantes',
  },
];

async function logIn(page, creds) {
  await page.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => {
    // Cleanup previa sesión
    Object.keys(localStorage).forEach((k) => {
      if (k.includes('supabase') || k.includes('auth')) localStorage.removeItem(k);
    });
    Object.keys(sessionStorage).forEach((k) => {
      if (k.includes('supabase') || k.includes('auth')) sessionStorage.removeItem(k);
    });
  });
  await page.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle2' });
  // Wait for email field
  await page.waitForSelector('input[type="email"], input[name="email"]', {
    timeout: 10_000,
  });
  // Type creds
  const emailSel =
    (await page.$('input[type="email"]')) ?? (await page.$('input[name="email"]'));
  await emailSel.type(creds.email, { delay: 12 });
  const passSel =
    (await page.$('input[type="password"]')) ??
    (await page.$('input[name="password"]'));
  await passSel.type(creds.password, { delay: 12 });
  // Submit
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15_000 }).catch(() => null),
    page.keyboard.press('Enter'),
  ]);
}

async function captureShots() {
  console.log('• Lanzando Chromium…');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: VIEWPORT,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);

    let currentRole = null;
    for (const shot of SHOTS) {
      const wantLogin = shot.login;
      if (wantLogin && wantLogin !== 'reuse') {
        // Need fresh login
        console.log(`  → login (${wantLogin.email}) para ${shot.id}`);
        await logIn(page, wantLogin);
        currentRole = wantLogin.email;
      }
      console.log(`  → captura ${shot.id} (${shot.url})`);
      await page.goto(shot.url, { waitUntil: 'networkidle2', timeout: 25_000 });
      // Pequeño delay para animaciones de entrada
      await new Promise((r) => setTimeout(r, 1200));
      const out = path.join(ASSETS_DIR, `${shot.id}.jpg`);
      await page.screenshot({
        path: out,
        type: 'jpeg',
        quality: 78,
        fullPage: false,
        captureBeyondViewport: false,
      });
      console.log(`    OK · ${out}`);
    }
  } finally {
    await browser.close();
  }
}

// ---- Generación del HTML branded ----------------------------------------

const md = new MarkdownIt({ html: true, linkify: false, typographer: true });

function brandHtmlShell(bodyHtml) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Manual oficial · Gestión Global</title>
<style>
  /* ============================================================
     Tipografía base — system Inter / SF
     ============================================================ */
  :root {
    --cyan: #06b6d4;
    --teal: #14b8a6;
    --cyan-pale: #e0f7fa;
    --ink: #0b1f33;
    --night: #0b1f33;
    --muted: #64748b;
    --slate-100: #f1f5f9;
    --slate-200: #e2e8f0;
    --slate-50: #f8fafc;
    --emerald: #059669;
    --amber: #d97706;
    --rose: #dc2626;
  }
  * { box-sizing: border-box; }
  html, body { padding: 0; margin: 0; }
  body {
    font-family: -apple-system, "SF Pro Text", "Inter", "Segoe UI", Roboto,
                 sans-serif;
    color: var(--ink);
    font-size: 10.5pt;
    line-height: 1.55;
    background: white;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ============================================================
     Cover page
     ============================================================ */
  .cover {
    page-break-after: always;
    height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    background: linear-gradient(160deg, #0b1f33 0%, #0b1f33 55%, #06b6d4 130%);
    color: white;
    padding: 64px 72px;
    position: relative;
    overflow: hidden;
  }
  .cover::before {
    content: '';
    position: absolute;
    top: -120px; right: -120px;
    width: 460px; height: 460px;
    background: radial-gradient(circle, rgba(20,184,166,.35), transparent 65%);
    border-radius: 50%;
  }
  .cover::after {
    content: '';
    position: absolute;
    bottom: -160px; left: -160px;
    width: 520px; height: 520px;
    background: radial-gradient(circle, rgba(6,182,212,.25), transparent 65%);
    border-radius: 50%;
  }
  .cover .brand { position: relative; z-index: 1; }
  .cover .brand-mark {
    display: inline-flex; align-items: center; gap: 14px;
    font-size: 12pt; font-weight: 600; letter-spacing: 1px;
    text-transform: uppercase; color: rgba(255,255,255,.85);
  }
  .cover .brand-mark::before {
    content: ''; display: inline-block; width: 22px; height: 22px;
    background: linear-gradient(135deg, #06b6d4, #14b8a6);
    border-radius: 6px;
    transform: rotate(45deg);
  }
  .cover .hero { position: relative; z-index: 1; max-width: 720px; }
  .cover .kicker {
    font-size: 11pt; letter-spacing: 4px; text-transform: uppercase;
    color: var(--cyan); margin-bottom: 18px; opacity: .9;
  }
  .cover h1 {
    font-size: 56pt; line-height: 1.04; font-weight: 800; margin: 0;
    letter-spacing: -1.5px;
  }
  .cover h1 em {
    font-style: normal;
    background: linear-gradient(135deg, #67e8f9, #5eead4);
    -webkit-background-clip: text; background-clip: text;
    color: transparent;
  }
  .cover .subtitle {
    font-size: 14pt; margin-top: 22px; line-height: 1.5;
    color: rgba(255,255,255,.85); max-width: 560px;
  }
  .cover .meta { position: relative; z-index: 1; display: flex; gap: 32px; align-items: flex-end; }
  .cover .meta-item .label {
    font-size: 8pt; letter-spacing: 2px; text-transform: uppercase;
    color: rgba(255,255,255,.55); margin-bottom: 4px;
  }
  .cover .meta-item .value {
    font-size: 11pt; font-weight: 600; color: white;
  }

  /* ============================================================
     Content pages
     ============================================================ */
  main {
    padding: 0 14mm;
  }
  h1 { font-size: 24pt; font-weight: 800; letter-spacing: -.5px;
       margin: 32pt 0 12pt; color: var(--ink);
       page-break-before: always; padding-top: 8pt; }
  h1:first-of-type { page-break-before: auto; }
  h1::before {
    content: ''; display: block; width: 48px; height: 4px;
    background: linear-gradient(90deg, var(--cyan), var(--teal));
    margin-bottom: 14px; border-radius: 2px;
  }
  h2 { font-size: 16pt; font-weight: 700; margin: 24pt 0 8pt;
       color: var(--ink); letter-spacing: -.2px;
       border-bottom: 1px solid var(--slate-200); padding-bottom: 4pt; }
  h3 { font-size: 12.5pt; font-weight: 700; margin: 18pt 0 6pt;
       color: var(--ink); }
  h4 { font-size: 11pt; font-weight: 700; margin: 14pt 0 4pt;
       color: var(--ink); }
  p { margin: 6pt 0; }
  ul, ol { margin: 6pt 0 8pt; padding-left: 18pt; }
  li { margin: 2pt 0; }

  /* Code */
  code {
    font-family: "SF Mono", "Menlo", "Consolas", monospace;
    font-size: 9pt;
    background: var(--slate-100);
    color: var(--ink);
    padding: 1pt 4pt; border-radius: 3px;
  }
  pre {
    background: var(--slate-50);
    border: 1px solid var(--slate-200);
    border-left: 3px solid var(--cyan);
    padding: 10pt 12pt;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 8.5pt;
    line-height: 1.45;
    margin: 10pt 0;
  }
  pre code { background: transparent; padding: 0; }

  /* Blockquote */
  blockquote {
    border-left: 3px solid var(--cyan);
    background: var(--cyan-pale);
    margin: 10pt 0;
    padding: 8pt 14pt;
    border-radius: 0 6px 6px 0;
    color: var(--ink);
    font-style: normal;
  }
  blockquote p { margin: 4pt 0; }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 10pt 0;
    font-size: 9pt;
  }
  th {
    text-align: left;
    background: var(--slate-50);
    color: var(--muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .5px;
    font-size: 8pt;
    padding: 6pt 8pt;
    border-bottom: 2px solid var(--slate-200);
  }
  td {
    padding: 6pt 8pt;
    border-bottom: 1px solid var(--slate-100);
    vertical-align: top;
  }
  tr:nth-child(even) td { background: var(--slate-50); }

  /* Links */
  a { color: var(--cyan); text-decoration: none; }
  strong { color: var(--ink); font-weight: 700; }
  em { color: var(--ink); font-style: italic; }
  hr { border: none; border-top: 1px solid var(--slate-200);
       margin: 18pt 0; }

  /* Screenshot card */
  .shot {
    margin: 14pt 0;
    border: 1px solid var(--slate-200);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(11,31,51,.06), 0 1px 2px rgba(11,31,51,.04);
    background: white;
    page-break-inside: avoid;
  }
  .shot img { display: block; width: 100%; height: auto; }
  .shot .caption {
    padding: 6pt 12pt;
    font-size: 8.5pt;
    color: var(--muted);
    background: var(--slate-50);
    border-top: 1px solid var(--slate-200);
  }
  .shot .caption strong { color: var(--ink); }

  /* TOC inline */
  .toc-section { page-break-after: always; padding: 0 14mm; }
  .toc-section h1 { page-break-before: auto; }
  .toc-list { list-style: none; padding: 0; margin-top: 14pt; }
  .toc-list li {
    display: flex; justify-content: space-between;
    padding: 5pt 0; border-bottom: 1px dotted var(--slate-200);
    font-size: 10pt;
  }
  .toc-list li .title { flex: 1; }
  .toc-list li .num {
    color: var(--cyan); font-weight: 600;
    margin-right: 10pt; min-width: 24pt; text-align: right;
  }

  /* Pull quote */
  .pullquote {
    margin: 14pt 0;
    padding: 10pt 18pt;
    background: linear-gradient(135deg, rgba(6,182,212,.07), rgba(20,184,166,.07));
    border: 1px solid rgba(6,182,212,.15);
    border-radius: 8px;
    font-size: 11pt;
    line-height: 1.5;
  }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function buildCoverHtml() {
  const today = new Date().toLocaleDateString('es-AR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
  return `
<section class="cover">
  <div class="brand"><span class="brand-mark">Gestión Global</span></div>
  <div class="hero">
    <div class="kicker">Manual oficial · v1.0</div>
    <h1>Aliados<br/>de tu <em>tiempo</em>.</h1>
    <p class="subtitle">
      Guía operativa completa de la plataforma — panel de gerencia,
      portal del administrador, portal del partner, campus virtual y
      acceso externo. Lo que necesitás para usar Gestión Global todos
      los días.
    </p>
  </div>
  <div class="meta">
    <div class="meta-item">
      <div class="label">Versión</div>
      <div class="value">1.0</div>
    </div>
    <div class="meta-item">
      <div class="label">Publicado</div>
      <div class="value">${today}</div>
    </div>
    <div class="meta-item">
      <div class="label">Dominio</div>
      <div class="value">gestionglobal.ar</div>
    </div>
  </div>
</section>`;
}

// Mapeo screenshot ↔ donde insertarlo en el manual.
// La key es un fragmento único de texto markdown que precede al lugar de
// inserción; el valor es { id, caption }.
const SHOT_INSERTIONS = [
  {
    needle: '### 2.1 Página de login',
    id: 'login',
    caption: 'Login único · detecta el rol y enruta al panel correcto.',
  },
  {
    needle: '### 3.1 Inicio · Hola, …',
    id: 'gerencia-inicio',
    caption: 'Inicio de gerencia con la card de onboarding "Primeros 5 minutos".',
  },
  {
    needle: '### 3.3 Clientes · Administraciones',
    id: 'gerencia-clientes',
    caption: 'Listado de administraciones con KPIs, búsqueda y exports.',
  },
  {
    needle: '### 3.4 Trámites · Operación',
    id: 'gerencia-tramites',
    caption: 'Lista de trámites con KPIs (Abiertos/Resueltos/Sin asignar/Vencidos).',
  },
  {
    needle: '### 3.5 Agenda · organizador ejecutivo',
    id: 'gerencia-agenda',
    caption: 'Agenda · "Tirá lo que tengas en la cabeza — yo lo ordeno." (patrón MDC).',
  },
  {
    needle: '#### 3.6.1 Comprobantes',
    id: 'gerencia-facturacion',
    caption: 'Comprobantes simples (tipo X) y fiscales (A/B/C con ARCA + CAE).',
  },
  {
    needle: '#### 3.6.2 Cuenta corriente global',
    id: 'gerencia-cuenta-corriente',
    caption: 'Cuenta corriente global con IllustratedEmpty cuando no hay match.',
  },
  {
    needle: '#### 3.7.1 Cajas y movimientos',
    id: 'gerencia-finanzas',
    caption: 'Finanzas con 4 cajas activas + movimientos recientes.',
  },
  {
    needle: '### 3.8 Campus virtual',
    id: 'gerencia-campus',
    caption: 'Campus virtual · cursos con clases asincrónicas y encuentros sincrónicos.',
  },
  {
    needle: '### 3.9 Comunicaciones · Noticias y novedades',
    id: 'gerencia-comunicaciones',
    caption: 'Panel de comunicaciones multi-canal (dashboard + email + push).',
  },
  {
    needle: '### 3.10 Analítica avanzada',
    id: 'gerencia-analitica',
    caption: 'Inteligencia de negocio con KPIs, charts y funnel de conversión.',
  },
  {
    needle: '#### Plantillas email',
    id: 'gerencia-plantillas',
    caption: 'Editor de plantillas con preview en vivo (datos de ejemplo).',
  },
  {
    needle: '### 4.1 Dashboard (home)',
    id: 'portal-home',
    caption: 'Portal del administrador — dashboard con KPIs, banners y sugerencias.',
  },
  {
    needle: '### 4.3 Cuenta corriente (cliente)',
    id: 'portal-cuenta-corriente',
    caption: 'Cuenta corriente del cliente con saldo evolutivo y movimientos FIFO.',
  },
  {
    needle: '### 5.1 Mis rendiciones y comprobantes',
    id: 'partner-rendiciones',
    caption: 'Portal del partner · resumen por período + comprobantes asignados.',
  },
];

function injectShots(markdown) {
  let result = markdown;
  for (const { needle, id, caption } of SHOT_INSERTIONS) {
    const block = `\n\n<div class="shot"><img src="manual-assets/${id}.jpg" alt="${id}"><div class="caption"><strong>${id}</strong> · ${caption}</div></div>\n\n`;
    // Insertar antes de la línea siguiente al heading
    const idx = result.indexOf(needle);
    if (idx < 0) {
      console.warn(`! No encontré "${needle}" en MANUAL.md`);
      continue;
    }
    const endOfLine = result.indexOf('\n', idx);
    result = result.slice(0, endOfLine + 1) + block + result.slice(endOfLine + 1);
  }
  return result;
}

async function renderHtml() {
  const rawMd = await fs.readFile(MD_PATH, 'utf8');
  const withShots = injectShots(rawMd);
  const bodyHtml = md.render(withShots);
  const finalHtml =
    brandHtmlShell(buildCoverHtml() + `<main>${bodyHtml}</main>`);
  return finalHtml;
}

async function generatePdf(html) {
  console.log('• Renderizando HTML → PDF…');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    // Necesitamos base file:// para que las <img src="manual-assets/..."> resuelvan
    const tmpHtmlPath = path.join(ROOT, 'docs', '.manual.tmp.html');
    await fs.writeFile(tmpHtmlPath, html, 'utf8');
    await page.goto(`file://${tmpHtmlPath}`, { waitUntil: 'networkidle0' });

    await page.emulateMediaType('print');
    await page.pdf({
      path: OUTPUT_PDF,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: '14mm', right: '0mm', bottom: '16mm', left: '0mm' },
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="font-family: -apple-system, Inter, sans-serif;
                    font-size: 7pt; color: #94a3b8;
                    width: 100%; padding: 0 14mm;
                    display: flex; justify-content: space-between;">
          <span style="letter-spacing: 1.5px; text-transform: uppercase;">
            Gestión Global · Manual oficial
          </span>
          <span class="title"></span>
        </div>`,
      footerTemplate: `
        <div style="font-family: -apple-system, Inter, sans-serif;
                    font-size: 7pt; color: #94a3b8;
                    width: 100%; padding: 0 14mm;
                    display: flex; justify-content: space-between;">
          <span>gestionglobal.ar</span>
          <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>`,
    });

    await fs.unlink(tmpHtmlPath).catch(() => null);
    console.log(`  OK · ${OUTPUT_PDF}`);
  } finally {
    await browser.close();
  }
}

(async function main() {
  await fs.mkdir(ASSETS_DIR, { recursive: true });
  await fs.mkdir(path.dirname(OUTPUT_PDF), { recursive: true });

  if (process.env.SKIP_SHOTS !== '1') {
    console.log('=== Fase 1 · Capturando screenshots ===');
    await captureShots();
  } else {
    console.log('=== Fase 1 saltada (SKIP_SHOTS=1) ===');
  }

  console.log('=== Fase 2 · Render HTML + PDF ===');
  const html = await renderHtml();
  await generatePdf(html);

  const stat = await fs.stat(OUTPUT_PDF);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
  console.log(`\n✓ MANUAL.pdf generado (${sizeMB} MB)`);
})();
