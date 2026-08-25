#!/usr/bin/env node
// scripts/generate-manual-pdf.mjs  ·  v2 narrativa
//
// Pipeline:
//   1. Lanza Puppeteer (Chromium headless).
//   2. Loguea como gerente y dismissa los tours (gerencia, agenda,
//      trámites) seteando los flags de localStorage antes de cada
//      captura.
//   3. Captura screenshots clean (sin overlay del tour).
//   4. Renderiza MANUAL.md → HTML branded con logo, triángulos,
//      diagramas de flujo SVG y callouts.
//   5. Genera docs/MANUAL.pdf con cover + headers/footers + page nums.
//
// Markers soportados en el markdown:
//   {{shot:id|caption}}          ↦ inserta screenshot
//   {{callout:tone|texto}}       ↦ box con tono "tip" | "why" | "note"
//   {{flowdiagram:slug}}         ↦ inserta SVG de diagrama
//
// Variables de entorno opcionales:
//   MANUAL_GERENTE_EMAIL / MANUAL_GERENTE_PASSWORD
//   MANUAL_CLIENTE_EMAIL / MANUAL_CLIENTE_PASSWORD
//   MANUAL_PARTNER_EMAIL / MANUAL_PARTNER_PASSWORD
//   MANUAL_BASE_URL
//   SKIP_SHOTS=1  → solo re-render
//
// Uso:
//   node scripts/generate-manual-pdf.mjs

import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import MarkdownIt from 'markdown-it';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'docs', 'manual-assets');
const OUTPUT_PDF = path.join(ROOT, 'docs', 'MANUAL.pdf');
const MD_PATH = path.join(ROOT, 'MANUAL.md');
const LOGO_WHITE_PATH = path.join(ROOT, 'public', 'brand', 'logo-h-white.png');
const LOGO_DARK_PATH = path.join(ROOT, 'public', 'brand', 'logo-h-dark.png');

const BASE = process.env.MANUAL_BASE_URL ?? 'https://www.gestionglobal.ar';

// Credenciales de captura: SOLO por variable de entorno — NUNCA hardcodeadas.
// (Antes vivían acá en texto plano; se removieron por seguridad.)
// Para regenerar capturas exportá MANUAL_{GERENTE,CLIENTE,PARTNER}_{EMAIL,PASSWORD}
// usando cuentas QA efímeras (no cuentas reales). Con SKIP_SHOTS=1 no se necesitan.
const cred = (rol) => ({
  email: process.env[`MANUAL_${rol}_EMAIL`] ?? '',
  password: process.env[`MANUAL_${rol}_PASSWORD`] ?? '',
});
const GERENTE = cred('GERENTE');
const CLIENTE = cred('CLIENTE');
const PARTNER = cred('PARTNER');

// La lista SHOTS actual sólo usa la cuenta de gerente (+ login público).
// CLIENTE/PARTNER quedan disponibles por si se agregan shots de esos roles.
if (process.env.SKIP_SHOTS !== '1') {
  if (!GERENTE.email || !GERENTE.password) {
    console.error(
      '✗ Falta MANUAL_GERENTE_EMAIL / MANUAL_GERENTE_PASSWORD. ' +
      'Las credenciales de captura van por variable de entorno (usá una cuenta QA efímera). ' +
      'Para sólo re-renderizar sin capturar, corré con SKIP_SHOTS=1.',
    );
    process.exit(1);
  }
}

const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };

// Flags a setear post-login para dismissar wizards.
const DISMISS_FLAGS = {
  'gg.gerencia.tourCompleted': '1',
  'gg.gerencia.agendaTourCompleted': '1',
  'gg.gerencia.tramitesTourCompleted': '1',
};

// v2: capturamos las pantallas de gerencia (una sola cuenta de gerente QA
// efímera ve todos los datos → salen pobladas y en gg-brand). Las pantallas
// que dependen de un :id o de datos por-cliente (portal/partner/detalle) quedan
// con placeholder gg-brand en el render.
const SHOTS = [
  { id: 'login', url: `${BASE}/ingresar`, login: null },
  { id: 'gerencia-inicio', url: `${BASE}/gerencia`, login: GERENTE },
  { id: 'gerencia-agenda', url: `${BASE}/gerencia/agenda`, login: 'reuse' },
  { id: 'gerencia-solicitudes', url: `${BASE}/gerencia/solicitudes`, login: 'reuse' },
  { id: 'gerencia-clientes', url: `${BASE}/gerencia/clientes`, login: 'reuse' },
  { id: 'gerencia-tramites', url: `${BASE}/gerencia/tramites`, login: 'reuse' },
  { id: 'gerencia-moderacion', url: `${BASE}/gerencia/moderacion`, login: 'reuse' },
  { id: 'gerencia-facturacion', url: `${BASE}/gerencia/facturacion`, login: 'reuse' },
  { id: 'gerencia-pagos-informados', url: `${BASE}/gerencia/facturacion/pagos-informados`, login: 'reuse' },
  { id: 'gerencia-cuenta-corriente', url: `${BASE}/gerencia/cuenta-corriente`, login: 'reuse' },
  { id: 'gerencia-recupero', url: `${BASE}/gerencia/recupero`, login: 'reuse' },
  { id: 'gerencia-finanzas', url: `${BASE}/gerencia/finanzas`, login: 'reuse' },
  { id: 'gerencia-conciliacion', url: `${BASE}/gerencia/finanzas/conciliacion`, login: 'reuse' },
  { id: 'gerencia-campus', url: `${BASE}/gerencia/campus`, login: 'reuse' },
  { id: 'gerencia-eventos', url: `${BASE}/gerencia/formularios/webinars`, login: 'reuse' },
  { id: 'gerencia-comunicaciones', url: `${BASE}/gerencia/comunicaciones`, login: 'reuse' },
  { id: 'gerencia-analitica', url: `${BASE}/gerencia/analitica`, login: 'reuse' },
  { id: 'gerencia-servicios', url: `${BASE}/gerencia/servicios`, login: 'reuse' },
  { id: 'gerencia-emisores', url: `${BASE}/gerencia/configuracion/emisores`, login: 'reuse' },
  { id: 'gerencia-plantillas', url: `${BASE}/gerencia/configuracion/emails/templates`, login: 'reuse' },
  { id: 'gerencia-generacion-cj', url: `${BASE}/gerencia/configuracion/generacion-cj`, login: 'reuse' },
  { id: 'gerencia-salud-sistema', url: `${BASE}/gerencia/configuracion/salud-sistema`, login: 'reuse' },
];

async function dismissTours(page) {
  await page.evaluate((flags) => {
    Object.entries(flags).forEach(([k, v]) => {
      try { localStorage.setItem(k, v); } catch {}
    });
  }, DISMISS_FLAGS);
}

async function logIn(page, creds) {
  // Logout previo
  await page.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => {
    Object.keys(localStorage).forEach((k) => {
      if (k.includes('supabase') || k.includes('auth')) localStorage.removeItem(k);
    });
    Object.keys(sessionStorage).forEach((k) => {
      if (k.includes('supabase') || k.includes('auth')) sessionStorage.removeItem(k);
    });
  });
  await page.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type="email"]', { timeout: 10_000 });
  await (await page.$('input[type="email"]')).type(creds.email, { delay: 12 });
  await (await page.$('input[type="password"]')).type(creds.password, { delay: 12 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15_000 }).catch(() => null),
    page.keyboard.press('Enter'),
  ]);
  // Set tour flags y reload para que la app los lea desde el primer mount
  await dismissTours(page);
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

    for (const shot of SHOTS) {
      if (shot.login && shot.login !== 'reuse') {
        console.log(`  → login (${shot.login.email}) para ${shot.id}`);
        await logIn(page, shot.login);
      }
      console.log(`  → captura ${shot.id} (${shot.url})`);
      await page.goto(shot.url, { waitUntil: 'networkidle2', timeout: 25_000 });
      // Re-dismiss (por si la app montó el tour antes de leer el flag)
      await dismissTours(page);
      await new Promise((r) => setTimeout(r, 600));
      // Reload una vez para que con los flags ya en localStorage no aparezca tour
      await page.reload({ waitUntil: 'networkidle2', timeout: 25_000 });
      await dismissTours(page);
      await new Promise((r) => setTimeout(r, 800));
      // Ocultar manualmente cualquier overlay residual del tour
      await page.evaluate(() => {
        document.querySelectorAll('[data-tour-overlay], [data-onboarding-tour], [role="dialog"][aria-label*="tour" i]')
          .forEach((el) => (el.style.display = 'none'));
      });
      const out = path.join(ASSETS_DIR, `${shot.id}.jpg`);
      await page.screenshot({
        path: out,
        type: 'jpeg',
        quality: 72,
        fullPage: false,
        captureBeyondViewport: false,
      });
      console.log(`    OK · ${out}`);
    }
  } finally {
    await browser.close();
  }
}

// =============================================================================
// HTML render
// =============================================================================

const md = new MarkdownIt({ html: true, linkify: false, typographer: true });

async function fileToBase64(filepath) {
  const buf = await fs.readFile(filepath);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// SVG decorativo: cluster de triángulos brand-cyan/teal.
function trianglesAccentSvg({ size = 220, tone = 'cyan', density = 'soft', rotate = 0 } = {}) {
  const color = tone === 'teal' ? '#14b8a6' : '#06b6d4';
  const op = (rich, soft) => (density === 'rich' ? rich : soft);
  return `
<svg viewBox="0 0 200 200" width="${size}" height="${size}"
     style="transform: rotate(${rotate}deg);" aria-hidden>
  <g fill="${color}">
    <path d="M40 10 L90 10 L40 60 Z" opacity="${op(0.55, 0.35)}"/>
    <path d="M100 10 L150 10 L100 60 Z" opacity="${op(0.35, 0.2)}"/>
    <path d="M40 70 L90 70 L40 120 Z" opacity="${op(0.25, 0.15)}"/>
    <path d="M155 30 L185 30 L155 60 Z" opacity="${op(0.35, 0.22)}"/>
    <path d="M105 75 L135 75 L105 105 Z" opacity="${op(0.18, 0.1)}"/>
  </g>
</svg>`;
}

// Flow diagrams como SVG vectorial liviano.
function flowDiagramCaptacion() {
  return `
<svg viewBox="0 0 720 230" class="flow" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cyTeal" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#06b6d4"/>
      <stop offset="1" stop-color="#14b8a6"/>
    </linearGradient>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#06b6d4"/>
    </marker>
  </defs>
  <!-- Nodes -->
  <g font-family="-apple-system, Inter, sans-serif" font-size="11.5" fill="#0b1f33">
    <g>
      <rect x="20" y="80" width="120" height="68" rx="10" fill="white" stroke="#cbd5e1"/>
      <text x="80" y="105" text-anchor="middle" font-weight="600">Formulario</text>
      <text x="80" y="122" text-anchor="middle" fill="#64748b" font-size="9.5">público</text>
      <text x="80" y="138" text-anchor="middle" font-size="9" fill="#94a3b8">/formularios/:slug</text>
    </g>
    <g>
      <rect x="170" y="80" width="120" height="68" rx="10" fill="white" stroke="#cbd5e1"/>
      <text x="230" y="105" text-anchor="middle" font-weight="600">Solicitud</text>
      <text x="230" y="122" text-anchor="middle" fill="#64748b" font-size="9.5">en captación</text>
      <text x="230" y="138" text-anchor="middle" font-size="9" fill="#94a3b8">estado: Nueva</text>
    </g>
    <g>
      <rect x="320" y="80" width="120" height="68" rx="10" fill="white" stroke="#cbd5e1"/>
      <text x="380" y="105" text-anchor="middle" font-weight="600">Análisis</text>
      <text x="380" y="122" text-anchor="middle" fill="#64748b" font-size="9.5">+ derivación</text>
      <text x="380" y="138" text-anchor="middle" font-size="9" fill="#94a3b8">gestoría / asesor</text>
    </g>
    <g>
      <rect x="470" y="80" width="120" height="68" rx="10" fill="white" stroke="#cbd5e1"/>
      <text x="530" y="105" text-anchor="middle" font-weight="600">Activar</text>
      <text x="530" y="122" text-anchor="middle" fill="#64748b" font-size="9.5">como cliente</text>
      <text x="530" y="138" text-anchor="middle" font-size="9" fill="#94a3b8">wizard 5-6 pasos</text>
    </g>
    <g>
      <rect x="600" y="80" width="100" height="68" rx="10" fill="url(#cyTeal)" stroke="none"/>
      <text x="650" y="105" text-anchor="middle" font-weight="700" fill="white">Trámite</text>
      <text x="650" y="122" text-anchor="middle" fill="white" font-size="9.5" opacity="0.85">+ portal</text>
      <text x="650" y="138" text-anchor="middle" font-size="9" fill="white" opacity="0.7">credenciales por email</text>
    </g>
  </g>
  <!-- Arrows -->
  <g stroke="#06b6d4" stroke-width="2" fill="none" marker-end="url(#arrow)">
    <line x1="140" y1="114" x2="170" y2="114"/>
    <line x1="290" y1="114" x2="320" y2="114"/>
    <line x1="440" y1="114" x2="470" y2="114"/>
    <line x1="590" y1="114" x2="600" y2="114"/>
  </g>
  <!-- Title -->
  <text x="360" y="30" text-anchor="middle" font-family="-apple-system, Inter, sans-serif"
        font-size="13" font-weight="700" fill="#0b1f33"
        letter-spacing="0.5">El viaje de una solicitud</text>
  <text x="360" y="50" text-anchor="middle" font-family="-apple-system, Inter, sans-serif"
        font-size="10" fill="#64748b">de visitante anónimo a cliente activo</text>
  <!-- Footnote -->
  <text x="360" y="195" text-anchor="middle" font-family="-apple-system, Inter, sans-serif"
        font-size="9" fill="#94a3b8">3 canales sincronizados (dashboard · email · push)</text>
  <text x="360" y="208" text-anchor="middle" font-family="-apple-system, Inter, sans-serif"
        font-size="9" fill="#94a3b8">en cada transición de estado</text>
</svg>`;
}

function flowDiagramTramite() {
  return `
<svg viewBox="0 0 720 270" class="flow" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="arrow2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#14b8a6"/>
    </marker>
  </defs>
  <text x="360" y="28" text-anchor="middle" font-family="-apple-system, Inter, sans-serif"
        font-size="13" font-weight="700" fill="#0b1f33"
        letter-spacing="0.5">El ciclo de un trámite</text>
  <text x="360" y="46" text-anchor="middle" font-family="-apple-system, Inter, sans-serif"
        font-size="10" fill="#64748b">desde su creación hasta el próximo vencimiento</text>

  <g font-family="-apple-system, Inter, sans-serif" font-size="10.5" fill="#0b1f33">
    <!-- Row 1 -->
    <g>
      <circle cx="80" cy="100" r="28" fill="white" stroke="#06b6d4" stroke-width="2"/>
      <text x="80" y="103" text-anchor="middle" font-weight="700" fill="#06b6d4">1</text>
      <text x="80" y="148" text-anchor="middle" font-weight="600">Creación</text>
      <text x="80" y="162" text-anchor="middle" fill="#64748b" font-size="9">cliente + servicio</text>
    </g>
    <g>
      <circle cx="220" cy="100" r="28" fill="white" stroke="#06b6d4" stroke-width="2"/>
      <text x="220" y="103" text-anchor="middle" font-weight="700" fill="#06b6d4">2</text>
      <text x="220" y="148" text-anchor="middle" font-weight="600">Avances</text>
      <text x="220" y="162" text-anchor="middle" fill="#64748b" font-size="9">internos y visibles</text>
    </g>
    <g>
      <circle cx="360" cy="100" r="28" fill="white" stroke="#06b6d4" stroke-width="2"/>
      <text x="360" y="103" text-anchor="middle" font-weight="700" fill="#06b6d4">3</text>
      <text x="360" y="148" text-anchor="middle" font-weight="600">Docs</text>
      <text x="360" y="162" text-anchor="middle" fill="#64748b" font-size="9">se piden y se reciben</text>
    </g>
    <g>
      <circle cx="500" cy="100" r="28" fill="white" stroke="#06b6d4" stroke-width="2"/>
      <text x="500" y="103" text-anchor="middle" font-weight="700" fill="#06b6d4">4</text>
      <text x="500" y="148" text-anchor="middle" font-weight="600">Comprobante</text>
      <text x="500" y="162" text-anchor="middle" fill="#64748b" font-size="9">+ cobranza</text>
    </g>
    <g>
      <circle cx="640" cy="100" r="28" fill="#14b8a6" stroke="none"/>
      <text x="640" y="103" text-anchor="middle" font-weight="700" fill="white">5</text>
      <text x="640" y="148" text-anchor="middle" font-weight="600">Cierre</text>
      <text x="640" y="162" text-anchor="middle" fill="#64748b" font-size="9">+ próximo vto.</text>
    </g>
  </g>
  <!-- Connectors -->
  <g stroke="#06b6d4" stroke-width="2" fill="none" marker-end="url(#arrow2)">
    <line x1="108" y1="100" x2="192" y2="100"/>
    <line x1="248" y1="100" x2="332" y2="100"/>
    <line x1="388" y1="100" x2="472" y2="100"/>
    <line x1="528" y1="100" x2="612" y2="100"/>
  </g>
  <!-- Footnote bar -->
  <g>
    <rect x="60" y="200" width="600" height="42" rx="6" fill="#ecfdf5" stroke="#a7f3d0"/>
    <text x="360" y="218" text-anchor="middle" font-family="-apple-system, Inter, sans-serif"
          font-size="10" font-weight="600" fill="#065f46">
      Si el servicio tiene vigencia_meses, el cierre programa
      el próximo vencimiento automáticamente</text>
    <text x="360" y="232" text-anchor="middle" font-family="-apple-system, Inter, sans-serif"
          font-size="9" fill="#0f766e">y aparece en la Agenda + alertas con cadencia humana</text>
  </g>
</svg>`;
}

const FLOW_DIAGRAMS = {
  captacion: flowDiagramCaptacion,
  tramite: flowDiagramTramite,
};

// ---- Markdown pre-process: expand markers --------------------------------

function expandMarkers(markdown) {
  // {{shot:id|caption}} — si la captura existe muestra la imagen; si no,
  // un marco placeholder gg-brand (el manual nunca se rompe por falta de shot).
  let out = markdown.replace(/\{\{shot:([a-z0-9-]+)\|([^}]+)\}\}/g, (_, id, caption) => {
    const cap = caption.trim();
    const has = existsSync(path.join(ASSETS_DIR, `${id}.jpg`));
    if (has) {
      return `\n\n<figure class="shot"><img src="manual-assets/${id}.jpg" alt="${id}"><figcaption>${cap}</figcaption></figure>\n\n`;
    }
    return `\n\n<figure class="shot shot-ph"><div class="ph-frame"><span class="ph-dot"></span><span class="ph-dot"></span><span class="ph-dot"></span><span class="ph-url">${id}</span></div><div class="ph-body"><span class="ph-ico">▦</span><span class="ph-label">Vista de <strong>${id}</strong></span></div><figcaption>${cap}</figcaption></figure>\n\n`;
  });
  // {{callout:tone|texto}}
  out = out.replace(/\{\{callout:(tip|why|note)\|([^}]+)\}\}/g, (_, tone, text) => {
    const labels = { tip: 'Pequeño truco', why: '¿Por qué?', note: 'Nota' };
    const icons = {
      tip: '✶', why: '?', note: 'i',
    };
    return `\n\n<aside class="callout callout-${tone}"><span class="cl-icon">${icons[tone]}</span><div><strong>${labels[tone]}</strong><span>${text.trim()}</span></div></aside>\n\n`;
  });
  // {{flowdiagram:slug}}
  out = out.replace(/\{\{flowdiagram:([a-z0-9-]+)\}\}/g, (_, slug) => {
    const fn = FLOW_DIAGRAMS[slug];
    if (!fn) return `<!-- diagrama desconocido: ${slug} -->`;
    return `\n\n<div class="diagram">${fn()}</div>\n\n`;
  });
  return out;
}

function brandHtmlShell(bodyHtml, { logoWhite, logoDark, fontsCss }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Manual oficial · Gestión Global</title>
<style>
${fontsCss}
  :root {
    /* gg-brand (DGG-136): navy / petróleo / cyan de acción */
    --cyan: #009ECA;
    --teal: #159AA6;
    --blue: #2E6FB0;
    --sky: #9CC7E4;
    --cyan-pale: #E1F3FA;
    --teal-pale: #E7F1F9;
    --ink: #0B1F33;
    --ink2: #122230;
    --night: #0B1F33;
    --muted: #5D7284;
    --slate-100: #EEF3F8;
    --slate-200: rgba(11,31,51,.14);
    --slate-50: #F3F7FB;
    --emerald: #0E9F6E;
    --amber: #C46A10;
    --rose: #C22B4A;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'GG Archivo', -apple-system, "Segoe UI", Roboto, sans-serif;
    color: var(--ink2);
    font-size: 10.8pt;
    line-height: 1.62;
    background: white;
    font-feature-settings: "tnum" 1, "lnum" 1;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ============== Cover ============== */
  .cover {
    page-break-after: always;
    position: relative;
    height: 100vh;
    background: linear-gradient(160deg, #061a2d 0%, #0b1f33 50%, #114c5c 110%);
    color: white;
    overflow: hidden;
    padding: 56pt 56pt 48pt;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .cover .tri-tr {
    position: absolute; top: -40px; right: -40px; opacity: 0.6;
  }
  .cover .tri-bl {
    position: absolute; bottom: -60px; left: -60px; opacity: 0.35;
    transform: rotate(180deg);
  }
  .cover .logo-row {
    position: relative; z-index: 2;
  }
  .cover .logo-row img {
    height: 56px; width: auto; display: block;
  }
  .cover .hero { position: relative; z-index: 2; max-width: 580px; margin-top: 32pt; }
  .cover .kicker {
    font-family: 'GG Oswald', sans-serif;
    font-size: 11pt; letter-spacing: 5px; text-transform: uppercase;
    color: var(--cyan); opacity: 0.95; margin-bottom: 22pt; font-weight: 600;
  }
  .cover h1 {
    font-family: 'GG Oswald', sans-serif;
    font-size: 52pt; line-height: 1.0; font-weight: 700; margin: 0;
    letter-spacing: 0.5px; text-transform: uppercase;
    color: white;
    padding-top: 0;
    page-break-before: auto;
  }
  .cover h1::before { display: none; }
  .cover h1 .accent { color: var(--cyan); }
  .cover .subtitle {
    font-size: 13pt; margin-top: 20pt; line-height: 1.55;
    color: rgba(255,255,255,.88); max-width: 480px;
  }
  .cover .meta {
    position: relative; z-index: 2;
    display: flex; gap: 36pt; align-items: flex-end;
    border-top: 1px solid rgba(255,255,255,.18); padding-top: 18pt;
  }
  .cover .meta-item .label {
    font-size: 7.5pt; letter-spacing: 2.5px; text-transform: uppercase;
    color: rgba(255,255,255,.6); margin-bottom: 4pt;
  }
  .cover .meta-item .value {
    font-size: 11pt; font-weight: 600; color: white;
  }
  .cover .ribbon {
    position: absolute; left: 56pt; right: 56pt; top: 56pt;
    z-index: 1; opacity: 0.08;
    height: 1px; background: white;
  }

  /* ============== Inner pages ============== */
  main { padding: 8pt 14mm 0; position: relative; }

  /* Section openers: h1 con triángulos decorativos */
  h1 {
    font-family: 'GG Oswald', sans-serif;
    font-size: 27pt; font-weight: 700; letter-spacing: .5px;
    text-transform: uppercase;
    margin: 36pt 0 16pt; color: var(--ink);
    page-break-before: always; padding-top: 12pt;
    position: relative;
  }
  h1:first-of-type { page-break-before: auto; }
  h1::before {
    content: ''; display: block; width: 64pt; height: 4px;
    background: linear-gradient(90deg, var(--teal) 0 44pt, var(--ink) 44pt);
    margin-bottom: 18pt;
  }
  h2 { font-family: 'GG Oswald', sans-serif;
       font-size: 17pt; font-weight: 600; margin: 26pt 0 10pt;
       color: var(--ink); letter-spacing: .04em; text-transform: uppercase;
       border-bottom: 1px solid var(--slate-200); padding-bottom: 6pt; }
  h3 { font-family: 'GG Oswald', sans-serif;
       font-size: 13.5pt; font-weight: 600; margin: 20pt 0 8pt;
       color: var(--ink); letter-spacing: .02em; }
  h4 { font-family: 'GG Oswald', sans-serif;
       font-size: 11pt; font-weight: 600; margin: 14pt 0 4pt;
       color: var(--ink); text-transform: uppercase; letter-spacing: .03em; }
  p { margin: 6pt 0; }
  ul, ol { margin: 6pt 0 10pt; padding-left: 18pt; }
  li { margin: 3pt 0; }

  /* TOC */
  ul li ul, ol li ul { margin: 4pt 0; }
  body > main > ul:first-of-type { /* TOC un poco más aireado */ }

  /* Code */
  code {
    font-family: "SF Mono", "Menlo", "Consolas", monospace;
    font-size: 9pt;
    background: var(--slate-100);
    color: var(--ink);
    padding: 1pt 5pt; border-radius: 3px;
  }
  pre {
    background: var(--slate-50);
    border: 1px solid var(--slate-200);
    border-left: 3px solid var(--cyan);
    padding: 10pt 12pt;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 8.8pt;
    line-height: 1.5;
    margin: 12pt 0;
  }
  pre code { background: transparent; padding: 0; }

  /* Blockquote */
  blockquote {
    border-left: 3px solid var(--cyan);
    background: var(--cyan-pale);
    margin: 12pt 0;
    padding: 10pt 16pt;
    border-radius: 0 8px 8px 0;
    color: var(--ink);
    font-style: italic;
    page-break-inside: avoid;
  }
  blockquote p { margin: 4pt 0; }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 12pt 0;
    font-size: 9pt;
    page-break-inside: avoid;
  }
  th {
    text-align: left;
    background: var(--slate-50);
    color: var(--muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .5px;
    font-size: 8pt;
    padding: 7pt 9pt;
    border-bottom: 2px solid var(--slate-200);
  }
  td {
    padding: 7pt 9pt;
    border-bottom: 1px solid var(--slate-100);
    vertical-align: top;
  }
  tr:nth-child(even) td { background: var(--slate-50); }

  a { color: var(--cyan); text-decoration: none; }
  strong { color: var(--ink); font-weight: 700; }
  em { color: var(--ink); font-style: italic; }
  hr { border: none; border-top: 1px solid var(--slate-200);
       margin: 22pt 0; }

  /* Screenshot card (figure) — forma de marca: recta + offset duro */
  figure.shot {
    margin: 16pt 0;
    border: 1px solid var(--slate-200);
    border-radius: 0;
    overflow: hidden;
    box-shadow: 4px 4px 0 rgba(11,31,51,.07);
    background: white;
    page-break-inside: avoid;
  }
  figure.shot img { display: block; width: 100%; height: auto; }
  figure.shot figcaption {
    padding: 9pt 14pt;
    font-size: 9pt;
    color: var(--muted);
    background: var(--slate-50);
    border-top: 1px solid var(--slate-200);
    line-height: 1.4;
  }
  figure.shot figcaption::before {
    content: '▸ ';
    color: var(--cyan);
    font-size: 8pt;
    margin-right: 4pt;
  }
  /* Placeholder de captura pendiente (gg-brand) */
  figure.shot-ph .ph-frame {
    display: flex; align-items: center; gap: 6pt;
    height: 22pt; padding: 0 12pt;
    background: var(--slate-50); border-bottom: 1px solid var(--slate-200);
  }
  figure.shot-ph .ph-dot { width: 7pt; height: 7pt; border-radius: 50%; background: #cdd8e2; }
  figure.shot-ph .ph-url {
    margin-left: 6pt; font-size: 8pt; color: var(--muted);
    background: white; border: 1px solid var(--slate-200); padding: 1pt 10pt;
  }
  figure.shot-ph .ph-body {
    height: 120pt; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 6pt;
    background: repeating-linear-gradient(135deg, #fafcfe, #fafcfe 12pt, #f3f7fb 12pt, #f3f7fb 24pt);
    color: var(--muted);
  }
  figure.shot-ph .ph-ico { font-size: 22pt; color: var(--sky); }
  figure.shot-ph .ph-label { font-size: 9pt; }
  figure.shot-ph .ph-label strong { color: var(--ink); font-family: 'GG Oswald', sans-serif; letter-spacing: .03em; }

  /* Callouts (balloons) */
  aside.callout {
    display: flex; gap: 14pt;
    margin: 14pt 0;
    padding: 12pt 16pt;
    border-radius: 10px;
    page-break-inside: avoid;
    background: var(--slate-50);
    border-left: 4px solid var(--cyan);
  }
  aside.callout.callout-tip {
    background: linear-gradient(135deg, rgba(6,182,212,.06), rgba(20,184,166,.06));
    border-left-color: var(--cyan);
  }
  aside.callout.callout-why {
    background: rgba(236, 253, 245, .9);
    border-left-color: var(--teal);
  }
  aside.callout.callout-note {
    background: rgba(254, 243, 199, .55);
    border-left-color: #d97706;
  }
  aside.callout .cl-icon {
    width: 24pt; height: 24pt;
    flex-shrink: 0;
    background: white;
    border-radius: 50%;
    display: inline-flex;
    align-items: center; justify-content: center;
    color: var(--cyan);
    font-weight: 700;
    font-size: 12pt;
    box-shadow: 0 0 0 3px rgba(6,182,212,.12);
  }
  aside.callout.callout-why .cl-icon { color: var(--teal); box-shadow: 0 0 0 3px rgba(20,184,166,.12); }
  aside.callout.callout-note .cl-icon { color: #d97706; box-shadow: 0 0 0 3px rgba(217,119,6,.12); }
  aside.callout div { display: flex; flex-direction: column; gap: 4pt; }
  aside.callout strong {
    font-size: 8.5pt;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    color: var(--muted);
  }
  aside.callout span { font-size: 10pt; line-height: 1.55; }

  /* Diagram */
  .diagram {
    margin: 18pt 0;
    padding: 16pt 8pt;
    background: linear-gradient(180deg, white, var(--slate-50));
    border: 1px solid var(--slate-200);
    border-radius: 10px;
    text-align: center;
    page-break-inside: avoid;
  }
  .diagram svg.flow {
    width: 100%; height: auto; max-width: 100%;
  }

  /* Triangle decoration on section openings */
  h1 .tri {
    position: absolute; top: -20pt; right: -10pt;
    opacity: 0.45;
    transform: scale(0.7);
  }

  /* TOC styling override */
  body > main > p + ol {
    border-top: 1px solid var(--slate-200);
    padding-top: 6pt;
  }

</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function buildCoverHtml({ logoWhite }) {
  const today = new Date().toLocaleDateString('es-AR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
  const trTR = trianglesAccentSvg({ size: 380, tone: 'cyan', density: 'rich' });
  const trBL = trianglesAccentSvg({ size: 320, tone: 'teal', density: 'soft' });
  return `
<section class="cover">
  <div class="tri-tr">${trTR}</div>
  <div class="tri-bl">${trBL}</div>
  <div class="logo-row"><img src="${logoWhite}" alt="Gestión Global"></div>
  <div class="hero">
    <div class="kicker">Manual oficial · v2.0</div>
    <h1>Aliados de tu <span class="accent">tiempo</span>.</h1>
    <p class="subtitle">
      La guía para usar la plataforma de Gestión Global todos los días.
      Pensada para entrar, leer un capítulo, y volver al trabajo con la
      respuesta que necesitabas.
    </p>
  </div>
  <div class="meta">
    <div class="meta-item">
      <div class="label">Versión</div>
      <div class="value">2.0</div>
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

function buildFontsCss() {
  const FONTS_DIR = path.join(ROOT, 'marketing', 'guia-bienvenida', 'fonts');
  const b64 = (f) => readFileSync(path.join(FONTS_DIR, f)).toString('base64');
  const face = (family, file) =>
    `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${b64(file)}) format('woff2');font-weight:400 700;font-display:swap;}`;
  return [
    face('GG Oswald', 'gg-oswald-latin.woff2'),
    face('GG Archivo', 'gg-archivo-latin.woff2'),
  ].join('\n');
}

async function renderHtml() {
  const rawMd = await fs.readFile(MD_PATH, 'utf8');
  const expanded = expandMarkers(rawMd);
  const bodyHtml = md.render(expanded);
  const [logoWhite, logoDark] = await Promise.all([
    fileToBase64(LOGO_WHITE_PATH),
    fileToBase64(LOGO_DARK_PATH),
  ]);
  const fontsCss = buildFontsCss();
  return brandHtmlShell(
    buildCoverHtml({ logoWhite }) + `<main>${bodyHtml}</main>`,
    { logoWhite, logoDark, fontsCss },
  );
}

async function generatePdf(html, { logoDark }) {
  console.log('• Renderizando HTML → PDF…');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    const tmpHtmlPath = path.join(ROOT, 'docs', '.manual.tmp.html');
    await fs.writeFile(tmpHtmlPath, html, 'utf8');
    await page.goto(`file://${tmpHtmlPath}`, { waitUntil: 'networkidle0' });
    await page.emulateMediaType('print');

    await page.pdf({
      path: OUTPUT_PDF,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: '18mm', right: '0mm', bottom: '18mm', left: '0mm' },
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="font-family: -apple-system, Inter, sans-serif;
                    font-size: 7.5pt; color: #94a3b8;
                    width: 100%; padding: 0 14mm 4mm;
                    display: flex; align-items: center; justify-content: space-between;
                    border-bottom: 1px solid #f1f5f9;">
          <div style="display:flex;align-items:center;gap:6pt;">
            <img src="${logoDark}" style="height: 12pt;"/>
            <span style="letter-spacing: 1.5px; text-transform: uppercase;
                         color:#475569;">Manual oficial</span>
          </div>
          <span style="color:#94a3b8;letter-spacing:0.5px;">gestionglobal.ar</span>
        </div>`,
      footerTemplate: `
        <div style="font-family: -apple-system, Inter, sans-serif;
                    font-size: 7.5pt; color: #94a3b8;
                    width: 100%; padding: 4mm 14mm 0;
                    display: flex; justify-content: space-between;
                    border-top: 1px solid #f1f5f9;">
          <span>Gestión Global · Aliados de tu tiempo</span>
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
  const logoDark = await fileToBase64(LOGO_DARK_PATH);
  await generatePdf(html, { logoDark });

  const stat = await fs.stat(OUTPUT_PDF);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
  console.log(`\n✓ MANUAL.pdf generado (${sizeMB} MB)`);
})();
