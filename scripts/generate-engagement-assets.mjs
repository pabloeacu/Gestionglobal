#!/usr/bin/env node
// scripts/generate-engagement-assets.mjs
// =============================================================================
// Genera los assets del onboarding de engagement (PWA + notificaciones, DGG-232):
//   · 3 banners de mail (PNG 1200×430, estilo campañas GG) → public/email/
//   · 3 PDF instructivos (A4) → public/email/
// Mismo método que gg-mail-banner.mjs / generate-manual-pdf.mjs: puppeteer +
// fuentes self-host embebidas (sin red). Aprobado por Pablo (prototipos DGG-232).
//
// Uso:  node scripts/generate-engagement-assets.mjs
// =============================================================================
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = resolve(ROOT, 'public/email');
mkdirSync(OUT, { recursive: true });

const b64 = (p) => readFileSync(resolve(ROOT, p)).toString('base64');
const FONTS = `
@font-face{font-family:'GG Oswald';src:url(data:font/woff2;base64,${b64('public/fonts/gg-oswald-latin.woff2')}) format('woff2');font-weight:300 700;font-display:block}
@font-face{font-family:'GG Archivo';src:url(data:font/woff2;base64,${b64('public/fonts/gg-archivo-latin.woff2')}) format('woff2');font-weight:400 700;font-display:block}
`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ---------------------------------------------------------------------------
// ICONOS (chip del banner, stroke claro)
// ---------------------------------------------------------------------------
const stroke = 'fill="none" stroke="#EAF6FB" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
const IC = {
  bell: `<svg viewBox="0 0 24 24" ${stroke}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" ${stroke}><rect x="6" y="2" width="12" height="20" rx="2.6"/><path d="M10 18h4"/></svg>`,
  phoneBell: `<svg viewBox="0 0 24 24" ${stroke}><rect x="4" y="3" width="11" height="18" rx="2.4"/><path d="M7.5 18h4"/><path d="M16.5 10a3 3 0 0 1 6 0c0 3.5 1.5 4.5 1.5 4.5h-9S16.5 13.5 16.5 10"/><path d="M18.5 16.4a1 1 0 0 0 1.8 0"/></svg>`,
};

// ---------------------------------------------------------------------------
// BANNER (1200×430) — degradé tinta→cian, triángulos, glows, Oswald, chip glass
// ---------------------------------------------------------------------------
function bannerHtml(cfg) {
  const title = cfg.title
    .map((l, i) => (i === cfg.accent ? `<span class="cy">${esc(l)}</span>` : esc(l)))
    .join('<br>');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}
*{margin:0;padding:0;box-sizing:border-box}
#banner{position:relative;width:1200px;height:430px;overflow:hidden;font-family:'GG Archivo',sans-serif;
  background:linear-gradient(116deg,#05172A 0%,#0B1F33 32%,#0C4F64 70%,#13828F 100%)}
.glow{position:absolute;border-radius:50%;filter:blur(8px)}
.g1{width:720px;height:720px;top:-230px;right:-120px;background:radial-gradient(circle,rgba(0,158,202,.55),transparent 62%)}
.g2{width:560px;height:560px;bottom:-280px;left:-120px;background:radial-gradient(circle,rgba(21,154,166,.40),transparent 60%)}
.tri{position:absolute;width:0;height:0}
.t1{top:-20px;left:34%;border-left:130px solid transparent;border-right:130px solid transparent;border-bottom:260px solid #9CC7E4;opacity:.05;transform:rotate(18deg)}
.t2{bottom:-80px;left:12%;border-left:120px solid transparent;border-right:120px solid transparent;border-bottom:240px solid #fff;opacity:.05;transform:rotate(-12deg)}
.t3{top:120px;right:30%;border-left:90px solid transparent;border-right:90px solid transparent;border-bottom:180px solid #009ECA;opacity:.10;transform:rotate(30deg)}
.left{position:absolute;left:62px;top:0;height:100%;width:640px;display:flex;flex-direction:column;justify-content:center;z-index:5}
.eyebrow{display:flex;align-items:center;gap:13px;margin-bottom:20px}
.eyebrow .tick{width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:13px solid #009ECA}
.eyebrow .brand{font-family:'GG Oswald';font-weight:600;font-size:14px;letter-spacing:3.2px;text-transform:uppercase;color:#fff}
.eyebrow .sep{width:1px;height:17px;background:rgba(156,199,228,.5)}
.eyebrow .slg{font-family:'GG Oswald';font-weight:500;font-size:14px;letter-spacing:3.2px;text-transform:uppercase;color:#9CC7E4}
.title{font-family:'GG Oswald';font-weight:700;text-transform:uppercase;color:#fff;font-size:58px;line-height:.98;letter-spacing:.5px}
.title .cy{background:linear-gradient(90deg,#35C9EE,#009ECA);-webkit-background-clip:text;background-clip:text;color:transparent}
.rule{margin-top:22px;width:92px;height:7px;background:#009ECA;clip-path:polygon(0 0,100% 0,calc(100% - 7px) 100%,0 100%)}
.chip{position:absolute;right:120px;top:50%;transform:translateY(-50%);width:208px;height:208px;border-radius:44px;z-index:4;
  background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.30);backdrop-filter:blur(13px);
  display:flex;align-items:center;justify-content:center;box-shadow:0 34px 70px rgba(2,10,20,.45),inset 0 1px 0 rgba(255,255,255,.35)}
.chip svg{width:104px;height:104px}
.chip .dot{position:absolute;top:50px;right:50px;width:34px;height:34px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#59D6F6,#009ECA);box-shadow:0 0 22px 4px rgba(0,158,202,.75)}
.chipglow{position:absolute;right:150px;top:50%;transform:translateY(-50%);width:230px;height:230px;border-radius:50%;
  background:radial-gradient(circle,rgba(0,158,202,.45),transparent 62%);filter:blur(12px);z-index:3}
</style></head><body>
<div id="banner">
  <div class="glow g1"></div><div class="glow g2"></div>
  <div class="tri t1"></div><div class="tri t2"></div><div class="tri t3"></div>
  <div class="left">
    <div class="eyebrow"><div class="tick"></div><div class="brand">Gestión Global</div><div class="sep"></div><div class="slg">Aliados de tu tiempo</div></div>
    <div class="title">${title}</div>
    <div class="rule"></div>
  </div>
  <div class="chipglow"></div>
  <div class="chip">${cfg.icon}${cfg.dot ? '<span class="dot"></span>' : ''}</div>
</div></body></html>`;
}

const BANNERS = [
  { out: 'engagement-ambas.png',    title: ['QUE NO SE TE', 'PASE NADA'],     accent: 1, icon: IC.phoneBell, dot: false },
  { out: 'engagement-instalar.png', title: ['SUMÁ LA APP', 'A TU PANTALLA'],  accent: 1, icon: IC.phone,     dot: false },
  { out: 'engagement-activar.png',  title: ['ACTIVÁ', 'TUS AVISOS'],          accent: 1, icon: IC.bell,      dot: true  },
];

// ---------------------------------------------------------------------------
// PDF — carillas (A4). Reusa el diseño aprobado de los instructivos.
// ---------------------------------------------------------------------------
const PHONE_SHARE = `
<div class="phone"><div class="screen">
  <div class="sbar"><span>9:41</span><span class="dots"><i></i><i></i><i></i></span></div>
  <div class="urlbar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>gestionglobal.ar</div>
  <div class="page"><div class="logo"></div><div class="ln m"></div><div class="ln s"></div></div>
  <div class="dim"></div>
  <div class="sheetpop"><div class="grab"></div>
    <div class="srow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="12" height="14" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>Copiar</div>
    <div class="srow hot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/></svg>Agregar a inicio</div>
    <div class="srow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17.3 6.2 21l1.5-6.6L3 9.9l6.7-.6L12 3l2.3 6.3 6.7.6-4.7 4.5L17.8 21z"/></svg>Favoritos</div>
  </div>
</div></div>`;
const PHONE_MENU = `
<div class="phone"><div class="screen">
  <div class="sbar"><span>9:41</span><span class="dots"><i></i><i></i><i></i></span></div>
  <div class="urlbar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>gestionglobal.ar</div>
  <div class="page"><div class="logo"></div><div class="ln m"></div><div class="ln s"></div></div>
  <div class="menu">
    <div class="mrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>Nueva pestaña</div>
    <div class="mrow hot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>Instalar app</div>
    <div class="mrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>Historial</div>
  </div>
</div></div>`;
const bellSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>`;
function phonePerm(app, quien) {
  return `
<div class="phone"><div class="screen">
  <div class="sbar"><span>9:41</span><span class="dots"><i></i><i></i><i></i></span></div>
  ${app ? '<div class="page" style="padding-top:14px"><div class="logo"></div><div class="ln m"></div><div class="ln s"></div><div class="ln m"></div></div>'
        : '<div class="urlbar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>gestionglobal.ar</div><div class="page"><div class="logo"></div><div class="ln m"></div></div>'}
  <div class="dim"></div>
  <div class="perm">
    <div class="pbell">${bellSvg}</div>
    <div class="pq">${quien} quiere ${app ? 'enviarte' : 'mostrarte'} notificaciones</div>
    <div class="pbtns"><div class="pb no">${app ? 'No permitir' : 'Bloquear'}</div><div class="pb yes">Permitir</div></div>
  </div>
</div></div>`;
}
const warnSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>`;
const appleSvg = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 12.5c0-2 1.6-3 1.7-3-.9-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.2 2-1.4 2.4-.4 6 1 8 .6 1 1.4 2.1 2.4 2 .9 0 1.3-.6 2.4-.6 1.1 0 1.4.6 2.4.6 1 0 1.7-1 2.3-2 .7-1.1 1-2.2 1-2.3-.1 0-2-.8-2-3Zm-2-5.5c.5-.6.9-1.5.8-2.4-.8 0-1.7.5-2.3 1.2-.5.5-.9 1.5-.8 2.3.9.1 1.8-.5 2.3-1.1Z"/></svg>`;
const androidSvg = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 9v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9H6Zm-1.5 0A1.5 1.5 0 0 0 3 10.5v4a1.5 1.5 0 0 0 3 0v-4A1.5 1.5 0 0 0 4.5 9Zm15 0A1.5 1.5 0 0 0 18 10.5v4a1.5 1.5 0 0 0 3 0v-4A1.5 1.5 0 0 0 19.5 9ZM8 18v2.5a1.5 1.5 0 0 0 3 0V18H8Zm5 0v2.5a1.5 1.5 0 0 0 3 0V18h-3ZM7.6 7.6h8.8c-.2-2-1.4-3.6-3.1-4.4l.8-1.4a.3.3 0 0 0-.5-.3l-.9 1.5a5.9 5.9 0 0 0-4.4 0L7 1.5a.3.3 0 0 0-.5.3l.8 1.4A5.4 5.4 0 0 0 4.2 7.6Zm2-1.7a.6.6 0 1 1 0-1.2.6.6 0 0 1 0 1.2Zm4.8 0a.6.6 0 1 1 0-1.2.6.6 0 0 1 0 1.2Z"/></svg>`;

function step(n, txt) { return `<div class="step"><span class="sn">${n}</span><span class="st">${txt}</span></div>`; }
function warn(txt) { return `<div class="warn">${warnSvg}<p>${txt}</p></div>`; }
function col(icon, name, brow, phone, steps, warnTxt) {
  return `<div class="col">
    <div class="plat"><span class="pico">${icon}</span><div><div class="pname">${name}</div><div class="pbrow">${brow}</div></div></div>
    ${phone}
    <div class="steps">${steps.join('')}</div>
    ${warn(warnTxt)}
  </div>`;
}
function sheet(num, title, sub, colA, colB) {
  return `<section class="sheet">
    <div class="sheet-band"><div class="glow"></div><div class="tri"></div>
      <div class="sheet-eyebrow"><span class="tick"></span><span>Gestión Global · Aliados de tu tiempo</span><span class="num">${num}</span></div>
      <div class="sheet-title">${title}</div><div class="sheet-sub">${sub}</div>
    </div>
    <div class="cols">${colA}${colB}</div>
    <div class="sheet-foot"><span class="tick"></span><span>¿Necesitás una mano? Respondé el mail o escribinos — lo hacemos juntos en 2 minutos.</span></div>
  </section>`;
}

const CARILLA_A = sheet('Carilla A', 'Instalá la app en tu teléfono',
  'Queda como una app, en tu pantalla de inicio — abre al instante y recibís tus avisos.',
  col(appleSvg, 'iPhone', 'desde Safari', PHONE_SHARE, [
    step(1, 'Abrí <b>gestionglobal.ar</b> en <b>Safari</b>.'),
    step(2, 'Tocá el botón <span class="pill">Compartir</span> abajo en el centro.'),
    step(3, 'Bajá y tocá <b>"Agregar a inicio"</b>.'),
    step(4, 'Tocá <b>Agregar</b>. Ya la tenés en tu pantalla.'),
  ], 'En iPhone, la app se instala <b>solo desde Safari</b> — no funciona desde Chrome u otros navegadores.'),
  col(androidSvg, 'Android', 'desde Chrome', PHONE_MENU, [
    step(1, 'Abrí <b>gestionglobal.ar</b> en <b>Chrome</b>.'),
    step(2, 'Tocá el banner <b>"Instalá Gestión Global"</b>, o el menú <span class="pill">⋮</span> arriba a la derecha.'),
    step(3, 'Elegí <b>"Instalar app"</b> (o "Agregar a la pantalla de inicio").'),
    step(4, 'Confirmá. Ya la tenés como app.'),
  ], 'Si no aparece el banner, está siempre en el menú <b>⋮ → Instalar app</b>.'));

const CARILLA_B = sheet('Carilla B', 'Activá las notificaciones',
  'Para enterarte en el momento de tus vencimientos, el RPAC, tus gestiones y los webinars.',
  col(appleSvg, 'iPhone', 'con la app instalada', phonePerm(true, '<b>"Gestión Global"</b>'), [
    step(1, '<b>Primero instalá la app</b> (ver la otra guía) — en iPhone es obligatorio.'),
    step(2, 'Abrí <b>Gestión Global</b> desde el ícono de tu pantalla de inicio.'),
    step(3, 'Cuando te lo pida, tocá <b>Permitir</b>.'),
    step(4, 'Si no aparece: <b>Ajustes → Notificaciones → Gestión Global → Permitir</b>.'),
  ], 'En iPhone, las notificaciones <b>solo funcionan con la app ya instalada</b> (desde Safari). Sin instalar, no hay avisos.'),
  col(androidSvg, 'Android', 'desde Chrome o la app', phonePerm(false, '<b>gestionglobal.ar</b>'), [
    step(1, 'En la app o en <b>gestionglobal.ar</b>, tocá <span class="pill">Activá las notificaciones</span>.'),
    step(2, 'En el cartel del navegador, tocá <b>Permitir</b>.'),
    step(3, 'Si están bloqueadas: tocá el <b>candado</b> al lado de la URL → <b>Permisos → Notificaciones → Permitir</b>.'),
  ], 'Si antes tocaste <b>Bloquear</b>, el cartel no vuelve a aparecer: hay que habilitarlo desde el <b>candado</b> de la URL.'));

const PDF_CSS = `${FONTS}
*{margin:0;padding:0;box-sizing:border-box}
html,body{font-family:'GG Archivo',sans-serif;color:#122230;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{width:100%;page-break-after:always}
.sheet:last-child{page-break-after:auto}
.sheet-band{position:relative;overflow:hidden;padding:30px 42px;background:linear-gradient(116deg,#05172A 0%,#0B1F33 34%,#0C4F64 72%,#13828F 100%)}
.sheet-band .glow{position:absolute;width:340px;height:340px;top:-150px;right:-90px;border-radius:50%;background:radial-gradient(circle,rgba(0,158,202,.45),transparent 62%);filter:blur(8px)}
.sheet-band .tri{position:absolute;top:-10px;right:26%;width:0;height:0;border-left:46px solid transparent;border-right:46px solid transparent;border-bottom:92px solid #009ECA;opacity:.12;transform:rotate(28deg)}
.sheet-eyebrow{position:relative;display:flex;align-items:center;gap:9px;margin-bottom:12px}
.sheet-eyebrow .tick{width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:11px solid #009ECA}
.sheet-eyebrow span{font-family:'GG Oswald';font-weight:600;font-size:13px;letter-spacing:2.8px;text-transform:uppercase;color:#fff}
.sheet-eyebrow .num{margin-left:auto;color:#9CC7E4}
.sheet-title{position:relative;font-family:'GG Oswald';font-weight:700;text-transform:uppercase;color:#fff;font-size:36px;line-height:1;letter-spacing:.5px}
.sheet-sub{position:relative;margin-top:9px;font-size:16px;color:#CADEEA}
.cols{display:grid;grid-template-columns:1fr 1fr}
.col{padding:30px 34px}
.col:first-child{border-right:1px solid rgba(11,31,51,.14)}
.plat{display:flex;align-items:center;gap:11px;margin-bottom:18px}
.plat .pico{width:36px;height:36px;border-radius:9px;background:#0B1F33;color:#fff;display:flex;align-items:center;justify-content:center}
.plat .pico svg{width:21px;height:21px}
.plat .pname{font-family:'GG Oswald';font-weight:600;font-size:18px;letter-spacing:.5px;text-transform:uppercase}
.plat .pbrow{font-size:12px;color:#5D7284}
.phone{width:210px;margin:0 auto 22px;border-radius:30px;background:#0e1a26;padding:8px}
.screen{position:relative;border-radius:22px;overflow:hidden;background:#fff;height:380px}
.sbar{height:22px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;font-size:10px;color:#334;font-weight:600}
.sbar .dots{display:flex;gap:2px}.sbar .dots i{width:3px;height:3px;border-radius:50%;background:#334;display:block}
.urlbar{margin:5px 9px;height:27px;border-radius:8px;background:#EEF2F6;display:flex;align-items:center;gap:7px;padding:0 10px;font-size:11px;color:#48606f}
.urlbar svg{width:12px;height:12px;color:#8aa0ad;flex:0 0 auto}
.page{padding:11px 11px 0;display:flex;flex-direction:column;gap:8px}
.page .logo{height:26px;width:108px;border-radius:6px;background:linear-gradient(90deg,#0B1F33,#0C4F64)}
.page .ln{height:9px;border-radius:3px;background:#E7ECF1}.page .ln.s{width:70%}.page .ln.m{width:88%}
.dim{position:absolute;inset:0;background:rgba(6,16,26,.42)}
.sheetpop{position:absolute;left:0;right:0;bottom:0;background:#F4F5F7;border-radius:18px 18px 0 0;padding:10px 9px 12px}
.grab{width:38px;height:4px;border-radius:3px;background:#C7CBD1;margin:0 auto 10px}
.srow{display:flex;align-items:center;gap:10px;padding:10px 11px;border-radius:10px;font-size:12.5px;color:#1c2b36;background:#fff;margin-bottom:6px}
.srow svg{width:16px;height:16px;color:#48606f}
.srow.hot{background:#E1F4FA;color:#0C5E73;font-weight:600;outline:2px solid #35C9EE}.srow.hot svg{color:#0C7E92}
.menu{position:absolute;top:32px;right:9px;width:138px;background:#fff;border-radius:11px;box-shadow:0 10px 26px rgba(6,16,26,.3);padding:6px;font-size:12px;color:#1c2b36}
.mrow{padding:8px 10px;border-radius:8px;display:flex;align-items:center;gap:9px}.mrow svg{width:14px;height:14px;color:#48606f}
.mrow.hot{background:#E1F4FA;color:#0C5E73;font-weight:600;outline:2px solid #35C9EE}.mrow.hot svg{color:#0C7E92}
.perm{position:absolute;left:16px;right:16px;top:100px;background:#fff;border-radius:16px;box-shadow:0 14px 34px rgba(6,16,26,.3);padding:16px 15px;text-align:center}
.perm .pq{font-size:12.5px;color:#1c2b36;line-height:1.35;margin-bottom:12px}
.perm .pbtns{display:flex;gap:8px}
.perm .pb{flex:1;font-size:12px;font-weight:600;padding:8px 0;border-radius:9px}
.perm .pb.no{background:#EEF2F6;color:#5a6b78}.perm .pb.yes{background:#009ECA;color:#fff;outline:2px solid #35C9EE}
.perm .pbell{width:38px;height:38px;border-radius:50%;background:#E1F4FA;color:#0C7E92;display:flex;align-items:center;justify-content:center;margin:0 auto 10px}
.perm .pbell svg{width:20px;height:20px}
.steps{display:flex;flex-direction:column;gap:12px}
.step{display:flex;gap:12px;align-items:flex-start}
.step .sn{flex:0 0 auto;width:27px;height:27px;border-radius:50%;background:#009ECA;color:#fff;font-family:'GG Oswald';font-weight:600;font-size:15px;display:flex;align-items:center;justify-content:center}
.step .st{font-size:14.5px;line-height:1.45;color:#2a3b49;padding-top:3px}
.step .st b{font-weight:600;color:#122230}
.step .st .pill{display:inline-flex;align-items:center;gap:3px;background:#E7F1F9;color:#0C7E92;font-weight:600;padding:1px 7px;border-radius:5px}
.warn{margin-top:18px;display:flex;gap:10px;align-items:flex-start;background:#FFF4E5;border:1px solid #F0B35B;border-radius:11px;padding:12px 14px}
.warn svg{flex:0 0 auto;width:19px;height:19px;color:#8A4A00;margin-top:1px}
.warn p{margin:0;font-size:13.5px;line-height:1.45;color:#8A4A00}.warn p b{font-weight:700}
.sheet-foot{padding:15px 42px;display:flex;align-items:center;gap:10px;font-size:13px;color:#5D7284;border-top:1px solid rgba(11,31,51,.14)}
.sheet-foot .tick{width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid #009ECA}
`;
function pdfHtml(sheets) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${PDF_CSS}</style></head><body>${sheets.join('')}</body></html>`;
}
const PDFS = [
  { out: 'guia-instalacion.pdf',   html: pdfHtml([CARILLA_A]) },
  { out: 'guia-notificaciones.pdf',html: pdfHtml([CARILLA_B]) },
  { out: 'guia-completa.pdf',      html: pdfHtml([CARILLA_A, CARILLA_B]) },
];

// ---------------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------------
// Chrome: respeta PUPPETEER_EXECUTABLE_PATH; si no, cae al Chrome del sistema (macOS).
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH
  || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].find((p) => existsSync(p));
const browser = await puppeteer.launch({ headless: 'new', executablePath: CHROME || undefined, args: ['--no-sandbox', '--force-color-profile=srgb'] });
try {
  for (const b of BANNERS) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 430, deviceScaleFactor: 2 });
    await page.setContent(bannerHtml(b), { waitUntil: 'networkidle0' });
    await page.evaluate(async () => { await document.fonts.ready; });
    await new Promise((r) => setTimeout(r, 200));
    const out = resolve(OUT, b.out);
    await (await page.$('#banner')).screenshot({ path: out });
    try { execFileSync('sips', ['--resampleWidth', '1200', out], { stdio: 'ignore' }); } catch {}
    console.log('banner →', b.out);
    await page.close();
  }
  for (const d of PDFS) {
    const page = await browser.newPage();
    await page.setContent(d.html, { waitUntil: 'networkidle0' });
    await page.evaluate(async () => { await document.fonts.ready; });
    await new Promise((r) => setTimeout(r, 150));
    await page.pdf({ path: resolve(OUT, d.out), format: 'A4', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
    console.log('pdf    →', d.out);
    await page.close();
  }
} finally { await browser.close(); }
console.log('DONE');
