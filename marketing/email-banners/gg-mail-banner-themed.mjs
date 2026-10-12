#!/usr/bin/env node
// =============================================================================
// GG MAIL BANNER · THEMED (DGG-220) — banners premium de captación por tema.
// Extiende el ADN de DGG-219 (frame tinta→petróleo→cian, Oswald MAYÚSCULAS,
// motivo triangular, glow) y cambia la ILUSTRACIÓN glass del lado derecho según
// --theme, con co-brand opcional (FUNDPLATA) para los emails de curso.
// Render = imagen PNG (puppeteer 2x → downscale 1200px), hosteada en public/email/.
//
// Uso:
//   node marketing/email-banners/gg-mail-banner-themed.mjs \
//     --title "¿Se te venció|la matrícula?" --accent 1 \
//     --theme curso --cobrand fundplata \
//     --eyebrow "Gestión Global|Aliados de tu tiempo" \
//     --out public/email/dgg220-vencida.png
//
// Themes: curso | renovacion | campus | tramites | capacitaciones | agenda
// Cobrand: fundplata (agrega el logo en el eyebrow) | (vacío = sólo GG)
// =============================================================================
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const titleLines = flag('title', 'Captación|profesional').split('|');
const accentIdx = parseInt(flag('accent', '1'), 10);
const [brand, slogan] = flag('eyebrow', 'Gestión Global|Aliados de tu tiempo').split('|');
const theme = flag('theme', 'curso');
const cobrand = flag('cobrand', '');
const outBanner = resolve(ROOT, flag('out', 'public/email/dgg220-banner.png'));

const b64 = (p) => readFileSync(resolve(ROOT, p)).toString('base64');
const FONTS = `
@font-face{font-family:'GG Oswald';src:url(data:font/woff2;base64,${b64('public/fonts/gg-oswald-latin.woff2')}) format('woff2');font-weight:300 700;font-display:block;}
@font-face{font-family:'GG Archivo';src:url(data:font/woff2;base64,${b64('public/fonts/gg-archivo-latin.woff2')}) format('woff2');font-weight:400 700;font-display:block;}`;
const fundplataLogo = cobrand === 'fundplata' ? b64('public/landing/partners/fundplata.png') : null;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
// Auto-escala el título para que la línea más larga entre en la columna (~640px).
const maxLen = Math.max(...titleLines.map((l) => l.length), 1);
const titleFs = Math.max(34, Math.min(56, Math.floor(640 / (maxLen * 0.56))));

// --- Glyphs SVG por tema (trazo limpio, blanco, dentro del tile glass) ---
const GLYPHS = {
  curso: `<path d="M50 20 8 38l42 18 34-14.6V58h6V37.8L92 36 50 20zM24 52v14c0 7 12 12 26 12s26-5 26-12V52L50 64 24 52z" fill="url(#gw)"/>`,
  renovacion: `<rect x="24" y="14" width="44" height="60" rx="5" fill="url(#gw)"/><rect x="33" y="28" width="26" height="4.5" rx="2" fill="#0B3A4A"/><rect x="33" y="39" width="26" height="4.5" rx="2" fill="#0B3A4A"/><rect x="33" y="50" width="16" height="4.5" rx="2" fill="#0B3A4A"/><circle cx="66" cy="62" r="17" fill="#35C9EE"/><path d="M58 62l6 6 11-12" stroke="#063B4C" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  campus: `<rect x="14" y="18" width="72" height="46" rx="6" fill="url(#gw)"/><rect x="22" y="26" width="56" height="30" rx="3" fill="#0B3A4A"/><path d="M44 34v14l13-7-13-7z" fill="#35C9EE"/><rect x="38" y="70" width="24" height="5" rx="2.5" fill="url(#gw)"/><rect x="30" y="64" width="40" height="5" rx="2.5" fill="url(#gw)"/>`,
  tramites: `<circle cx="26" cy="26" r="9" fill="#35C9EE"/><path d="M22 26l3 3 6-7" stroke="#063B4C" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="26" cy="50" r="9" fill="#35C9EE"/><path d="M22 50l3 3 6-7" stroke="#063B4C" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="26" cy="74" r="9" fill="url(#gw)"/><rect x="42" y="22" width="40" height="8" rx="4" fill="url(#gw)"/><rect x="42" y="46" width="40" height="8" rx="4" fill="url(#gw)"/><rect x="42" y="70" width="28" height="8" rx="4" fill="url(#gw)"/><path d="M26 35v6M26 59v6" stroke="rgba(255,255,255,.35)" stroke-width="3"/>`,
  capacitaciones: `<circle cx="50" cy="40" r="22" fill="url(#gw)"/><circle cx="50" cy="40" r="13" fill="none" stroke="#35C9EE" stroke-width="4"/><path d="M50 30l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.8L50 30z" fill="#35C9EE"/><path d="M40 58l-6 22 16-9 16 9-6-22" fill="url(#gw)"/>`,
};
const ACCENT_CHIP = `<div class="chip"></div>`;

const cobrandEyebrow = fundplataLogo
  ? `<div class="sep"></div><span class="slg" style="color:#cfe0ea;">con</span><img class="fp" src="data:image/png;base64,${fundplataLogo}" alt="FUNDPLATA"/>`
  : '';

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${FONTS}
*{margin:0;padding:0;box-sizing:border-box}
#banner{position:relative;width:1200px;height:430px;overflow:hidden;background:linear-gradient(116deg,#05172A 0%,#0B1F33 32%,#0C4F64 70%,#13828F 100%);font-family:'GG Archivo',sans-serif}
.glow{position:absolute;border-radius:50%;filter:blur(6px)}
.g1{width:720px;height:720px;top:-230px;right:-120px;background:radial-gradient(circle,rgba(0,158,202,.55),transparent 62%)}
.g2{width:560px;height:560px;bottom:-280px;left:-120px;background:radial-gradient(circle,rgba(21,154,166,.40),transparent 60%)}
.g3{width:360px;height:360px;top:40px;right:300px;background:radial-gradient(circle,rgba(156,199,228,.30),transparent 60%)}
.tri{position:absolute;width:0;height:0}
.t1{top:-20px;left:34%;border-left:130px solid transparent;border-right:130px solid transparent;border-bottom:260px solid #9CC7E4;opacity:.05;transform:rotate(18deg)}
.t3{top:120px;right:-30px;border-left:90px solid transparent;border-right:90px solid transparent;border-bottom:180px solid #009ECA;opacity:.10;transform:rotate(30deg)}
.left{position:absolute;left:56px;top:0;height:100%;width:660px;display:flex;flex-direction:column;justify-content:center;z-index:5}
.eyebrow{display:flex;align-items:center;gap:13px;margin-bottom:20px}
.eyebrow .tick{width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:13px solid #009ECA}
.eyebrow .brand{font-family:'GG Oswald';font-weight:600;font-size:14px;letter-spacing:3.2px;text-transform:uppercase;color:#fff}
.eyebrow .sep{width:1px;height:17px;background:rgba(156,199,228,.5)}
.eyebrow .slg{font-family:'GG Oswald';font-weight:500;font-size:14px;letter-spacing:3.2px;text-transform:uppercase;color:#9CC7E4}
.eyebrow .fp{height:30px;width:auto;display:block;filter:brightness(0) invert(1);opacity:.95}
.title{font-family:'GG Oswald';font-weight:700;text-transform:uppercase;color:#fff;font-size:${titleFs}px;line-height:1.02;letter-spacing:.5px}
.title .cy{background:linear-gradient(90deg,#35C9EE,#009ECA);-webkit-background-clip:text;background-clip:text;color:transparent}
.rule{margin-top:22px;width:92px;height:7px;background:#009ECA;clip-path:polygon(0 0,100% 0,calc(100% - 7px) 100%,0 100%)}
.right{position:absolute;right:56px;top:0;height:100%;width:360px;display:flex;align-items:center;justify-content:center;z-index:4}
.tile{position:relative;width:250px;height:250px;background:rgba(255,255,255,.10);backdrop-filter:blur(13px);-webkit-backdrop-filter:blur(13px);border:1px solid rgba(255,255,255,.28);clip-path:polygon(0 0,calc(100% - 30px) 0,100% 30px,100% 100%,0 100%);box-shadow:0 34px 70px rgba(2,10,20,.45),inset 0 1px 0 rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center}
.tileglow{position:absolute;width:250px;height:250px;border-radius:50%;background:radial-gradient(circle,rgba(0,158,202,.55),transparent 62%);filter:blur(12px)}
.chip{position:absolute;top:-26px;right:-22px;width:64px;height:64px;background:rgba(255,255,255,.14);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.3);clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,0 100%);box-shadow:0 14px 28px rgba(2,10,20,.4)}
svg.glyph{width:140px;height:140px;filter:drop-shadow(0 10px 18px rgba(2,10,20,.45))}
</style></head><body>
<div id="banner">
  <div class="glow g1"></div><div class="glow g2"></div><div class="glow g3"></div>
  <div class="tri t1"></div><div class="tri t3"></div>
  <div class="left">
    <div class="eyebrow"><div class="tick"></div><div class="brand">${esc(brand)}</div><div class="sep"></div><div class="slg">${esc(slogan)}</div>${cobrandEyebrow}</div>
    <div class="title">${titleLines.map((l, i) => i === accentIdx ? `<span class="cy">${esc(l)}</span>` : esc(l)).join('<br>')}</div>
    <div class="rule"></div>
  </div>
  <div class="right">
    <div class="tileglow"></div>
    <div class="tile">
      ${ACCENT_CHIP}
      <svg class="glyph" viewBox="0 0 100 94" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="gw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#CFE6F4"/></linearGradient></defs>
        ${GLYPHS[theme] || GLYPHS.curso}
      </svg>
    </div>
  </div>
</div></body></html>`;

mkdirSync(dirname(outBanner), { recursive: true });
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--force-color-profile=srgb'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 430, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => { await document.fonts.ready; });
  await new Promise((r) => setTimeout(r, 250));
  await (await page.$('#banner')).screenshot({ path: outBanner });
  try { execFileSync('sips', ['--resampleWidth', '1200', outBanner], { stdio: 'ignore' }); } catch { /* sips opcional */ }
  console.log('banner →', outBanner, '· theme', theme, cobrand ? '· cobrand ' + cobrand : '');
} finally { await browser.close(); }
