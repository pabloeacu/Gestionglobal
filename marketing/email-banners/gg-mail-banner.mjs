#!/usr/bin/env node
// =============================================================================
// GG MAIL BANNER · generador de banners premium para mailings (marketing & lifecycle)
// -----------------------------------------------------------------------------
// Aprobado por Pablo (2026-10-11, DGG-219). El banner es una IMAGEN renderizada
// con puppeteer — NO CSS — porque los clientes de mail descartan gradientes,
// backdrop-filter y 3D. Identidad GG marca-nativa: tinta→petróleo→cian, Oswald
// MAYÚSCULAS, motivo triangular, chamfer, glass con profundidad + glow.
//
// Uso:
//   node marketing/email-banners/gg-mail-banner.mjs \
//        --title "Mi agenda de|vencimientos|profesionales" \
//        --accent 1 \                       # índice (0-based) de la línea en cian
//        --eyebrow "Gestión Global|Aliados de tu tiempo" \
//        --out public/email/mi-banner.png \
//        --bell public/email/mi-campanita.png   # (opcional) ícono glass para cards
//
// Sin flags genera el banner "Mi agenda de vencimientos profesionales" (DGG-219).
// Las PNG se hostean en public/email/ → https://www.gestionglobal.ar/email/<x>.png
// =============================================================================
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../');                 // raíz del repo

// ---- CLI ----
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const titleLines = flag('title', 'Mi agenda de|vencimientos|profesionales').split('|');
const accentIdx  = parseInt(flag('accent', '1'), 10);
const [brand, slogan] = flag('eyebrow', 'Gestión Global|Aliados de tu tiempo').split('|');
const outBanner  = resolve(ROOT, flag('out', 'public/email/dgg219-banner.png'));
const outBell    = flag('bell', 'public/email/dgg219-bell.png');
const outBellAbs = outBell ? resolve(ROOT, outBell) : null;

// ---- fuentes self-host embebidas ----
const b64 = (p) => readFileSync(resolve(ROOT, p)).toString('base64');
const FONTS = `
@font-face{font-family:'GG Oswald';src:url(data:font/woff2;base64,${b64('public/fonts/gg-oswald-latin.woff2')}) format('woff2');font-weight:300 700;font-display:block;}
@font-face{font-family:'GG Archivo';src:url(data:font/woff2;base64,${b64('public/fonts/gg-archivo-latin.woff2')}) format('woff2');font-weight:400 700;font-display:block;}
`;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ---- HTML del banner (1200×430) ----
const bannerHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
${FONTS}
*{margin:0;padding:0;box-sizing:border-box}
#banner{position:relative;width:1200px;height:430px;overflow:hidden;
  background:linear-gradient(116deg,#05172A 0%,#0B1F33 32%,#0C4F64 70%,#13828F 100%);
  font-family:'GG Archivo',sans-serif;}
.glow{position:absolute;border-radius:50%;filter:blur(6px);}
.g1{width:720px;height:720px;top:-230px;right:-120px;background:radial-gradient(circle,rgba(0,158,202,.55),transparent 62%);}
.g2{width:560px;height:560px;bottom:-280px;left:-120px;background:radial-gradient(circle,rgba(21,154,166,.40),transparent 60%);}
.g3{width:360px;height:360px;top:40px;right:300px;background:radial-gradient(circle,rgba(156,199,228,.30),transparent 60%);}
.tri{position:absolute;width:0;height:0}
.t1{top:-20px;left:34%;border-left:130px solid transparent;border-right:130px solid transparent;border-bottom:260px solid #9CC7E4;opacity:.05;transform:rotate(18deg)}
.t2{bottom:-80px;left:12%;border-left:120px solid transparent;border-right:120px solid transparent;border-bottom:240px solid #FFFFFF;opacity:.05;transform:rotate(-12deg)}
.t3{top:120px;right:-30px;border-left:90px solid transparent;border-right:90px solid transparent;border-bottom:180px solid #009ECA;opacity:.10;transform:rotate(30deg)}
.left{position:absolute;left:56px;top:0;height:100%;width:650px;display:flex;flex-direction:column;justify-content:center;z-index:5}
.eyebrow{display:flex;align-items:center;gap:13px;margin-bottom:20px}
.eyebrow .tick{width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:13px solid #009ECA}
.eyebrow .brand{font-family:'GG Oswald';font-weight:600;font-size:14px;letter-spacing:3.2px;text-transform:uppercase;color:#fff}
.eyebrow .sep{width:1px;height:17px;background:rgba(156,199,228,.5)}
.eyebrow .slg{font-family:'GG Oswald';font-weight:500;font-size:14px;letter-spacing:3.2px;text-transform:uppercase;color:#9CC7E4}
.title{font-family:'GG Oswald';font-weight:700;text-transform:uppercase;color:#fff;font-size:57px;line-height:.98;letter-spacing:.5px}
.title .cy{background:linear-gradient(90deg,#35C9EE,#009ECA);-webkit-background-clip:text;background-clip:text;color:transparent;}
.rule{margin-top:22px;width:92px;height:7px;background:#009ECA;clip-path:polygon(0 0,100% 0,calc(100% - 7px) 100%,0 100%)}
.right{position:absolute;right:40px;top:0;height:100%;width:430px;z-index:4}
.cal{position:absolute;top:92px;right:118px;width:228px;height:246px;
  background:rgba(255,255,255,.10);backdrop-filter:blur(13px);-webkit-backdrop-filter:blur(13px);
  border:1px solid rgba(255,255,255,.30);
  clip-path:polygon(0 0,calc(100% - 26px) 0,100% 26px,100% 100%,0 100%);
  box-shadow:0 34px 70px rgba(2,10,20,.45), inset 0 1px 0 rgba(255,255,255,.35);}
.cal .hd{height:60px;background:linear-gradient(90deg,#0C7E92,#009ECA);display:flex;align-items:center;justify-content:center;gap:40px;
  clip-path:polygon(0 0,calc(100% - 26px) 0,100% 26px,100% 100%,0 100%);}
.cal .hd .ring{width:11px;height:24px;border-radius:6px;background:rgba(255,255,255,.85);margin-top:-16px;box-shadow:0 2px 4px rgba(0,0,0,.25)}
.cal .grid{padding:22px 24px;display:grid;grid-template-columns:repeat(4,1fr);grid-gap:16px 14px}
.cal .grid i{width:100%;height:12px;border-radius:3px;background:rgba(255,255,255,.22);display:block}
.cal .grid i.hot{position:relative;background:transparent}
.dot{position:absolute;top:-10px;left:50%;transform:translateX(-50%);width:34px;height:34px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#59D6F6,#009ECA);box-shadow:0 0 22px 4px rgba(0,158,202,.75),0 6px 14px rgba(0,0,0,.3)}
.bell{position:absolute;bottom:40px;right:70px;width:150px;height:150px;filter:drop-shadow(0 18px 30px rgba(2,10,20,.5))}
.bellglow{position:absolute;bottom:60px;right:90px;width:150px;height:150px;border-radius:50%;background:radial-gradient(circle,rgba(0,158,202,.65),transparent 65%);filter:blur(10px)}
.clock{position:absolute;top:60px;right:40px;width:78px;height:78px;border-radius:50%;
  background:rgba(255,255,255,.12);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  border:1px solid rgba(255,255,255,.35);box-shadow:0 16px 30px rgba(2,10,20,.4),inset 0 1px 0 rgba(255,255,255,.4)}
.clock:before,.clock:after{content:'';position:absolute;left:50%;top:50%;background:#EAF6FB;transform-origin:left center;border-radius:2px}
.clock:before{width:26px;height:4px;transform:translate(-2px,-2px) rotate(-54deg)}
.clock:after{width:20px;height:4px;transform:translate(-2px,-2px) rotate(16deg)}
.cdot{position:absolute;left:50%;top:50%;width:8px;height:8px;background:#009ECA;border-radius:50%;transform:translate(-50%,-50%);z-index:2}
</style></head><body>
<div id="banner">
  <div class="glow g1"></div><div class="glow g2"></div><div class="glow g3"></div>
  <div class="tri t1"></div><div class="tri t2"></div><div class="tri t3"></div>
  <div class="left">
    <div class="eyebrow"><div class="tick"></div><div class="brand">${esc(brand)}</div><div class="sep"></div><div class="slg">${esc(slogan)}</div></div>
    <div class="title">${titleLines.map((l, i) => i === accentIdx ? `<span class="cy">${esc(l)}</span>` : esc(l)).join('<br>')}</div>
    <div class="rule"></div>
  </div>
  <div class="right">
    <div class="bellglow"></div>
    <div class="clock"><div class="cdot"></div></div>
    <div class="cal">
      <div class="hd"><div class="ring"></div><div class="ring"></div></div>
      <div class="grid"><i></i><i></i><i></i><i></i><i></i><i class="hot"><span class="dot"></span></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
    </div>
    <svg class="bell" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5FD6F6"/><stop offset="1" stop-color="#0C8FBE"/></linearGradient>
        <linearGradient id="bh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".9"/><stop offset=".5" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
      </defs>
      <path d="M50 13c-3.2 0-5.6 2.4-5.6 5.4v3.2C32 23.6 24 33.4 24 46v9.4c0 6-3 10.4-7.4 14.4 0 1.6 1.2 2.8 2.8 2.8h61.2c1.6 0 2.8-1.2 2.8-2.8C79 65.8 76 61.4 76 55.4V46c0-12.6-8-22.4-20.4-24.4v-3.2c0-3-2.4-5.4-5.6-5.4z" fill="url(#bg)"/>
      <path d="M50 13c-3.2 0-5.6 2.4-5.6 5.4v3.2C32 23.6 24 33.4 24 46v9.4c0 6-3 10.4-7.4 14.4 0 1.6 1.2 2.8 2.8 2.8h61.2c1.6 0 2.8-1.2 2.8-2.8C79 65.8 76 61.4 76 55.4V46c0-12.6-8-22.4-20.4-24.4v-3.2c0-3-2.4-5.4-5.6-5.4z" fill="url(#bh)"/>
      <path d="M41 78a9 9 0 0 0 18 0z" fill="url(#bg)"/>
      <circle cx="50" cy="14" r="5.5" fill="#EAF6FB"/>
    </svg>
  </div>
</div></body></html>`;

// ---- HTML de la campanita glass (decora cards; fondo transparente) ----
const bellHtml = `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}
*{margin:0;padding:0;box-sizing:border-box}
#bell{position:relative;width:240px;height:240px;display:flex;align-items:center;justify-content:center;background:transparent}
.ring{position:absolute;border:3px solid rgba(0,158,202,.22);border-radius:50%}
.r1{width:150px;height:150px}.r2{width:196px;height:196px;border-color:rgba(0,158,202,.12)}
.chip{position:relative;width:128px;height:128px;border-radius:30px;background:linear-gradient(140deg,#E7F1F9,#CFE6F4);
  box-shadow:0 20px 40px rgba(0,110,150,.28),inset 0 2px 4px rgba(255,255,255,.9);display:flex;align-items:center;justify-content:center}
</style></head><body><div id="bell">
  <div class="ring r2"></div><div class="ring r1"></div>
  <div class="chip"><svg width="74" height="74" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="b2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2CB4DE"/><stop offset="1" stop-color="#0C7FB0"/></linearGradient></defs>
    <path d="M50 13c-3.2 0-5.6 2.4-5.6 5.4v3.2C32 23.6 24 33.4 24 46v9.4c0 6-3 10.4-7.4 14.4 0 1.6 1.2 2.8 2.8 2.8h61.2c1.6 0 2.8-1.2 2.8-2.8C79 65.8 76 61.4 76 55.4V46c0-12.6-8-22.4-20.4-24.4v-3.2c0-3-2.4-5.4-5.6-5.4z" fill="url(#b2)"/>
    <path d="M41 78a9 9 0 0 0 18 0z" fill="url(#b2)"/><circle cx="50" cy="14" r="5.5" fill="#0C7FB0"/>
  </svg></div>
</div></body></html>`;

// ---- render ----
mkdirSync(dirname(outBanner), { recursive: true });
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--force-color-profile=srgb'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 430, deviceScaleFactor: 2 });
  await page.setContent(bannerHtml, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => { await document.fonts.ready; });
  await new Promise((r) => setTimeout(r, 250));
  await (await page.$('#banner')).screenshot({ path: outBanner });
  // Se renderiza a 2x (2400px) por nitidez y se downscalea a 1200px para el email
  // (~300KB vs ~830KB; los clientes de mail proxean imágenes, el peso importa).
  try { execFileSync('sips', ['--resampleWidth', '1200', outBanner], { stdio: 'ignore' }); }
  catch { console.warn('sips no disponible — banner queda a 2x; downscalear manual a 1200px para email'); }
  console.log('banner →', outBanner);

  if (outBellAbs) {
    mkdirSync(dirname(outBellAbs), { recursive: true });
    const p2 = await browser.newPage();
    await p2.setViewport({ width: 240, height: 240, deviceScaleFactor: 2 });
    await p2.setContent(bellHtml, { waitUntil: 'networkidle0' });
    await p2.evaluate(async () => { await document.fonts.ready; });
    await new Promise((r) => setTimeout(r, 150));
    await (await p2.$('#bell')).screenshot({ path: outBellAbs, omitBackground: true });
    console.log('bell   →', outBellAbs);
  }
} finally { await browser.close(); }
console.log('DONE');
