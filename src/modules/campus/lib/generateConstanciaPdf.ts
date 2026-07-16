import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import jsPDF from 'jspdf';
import { toPng } from 'html-to-image';
import {
  ConstanciaPremium,
  CONST_W,
  CONST_H,
  ESQUEMA_CONST_DEFAULT,
  type ConstanciaDatosRender,
  type EsquemaConstancia,
} from '../components/ConstanciaPremium';

// ============================================================================
// Generación de la CONSTANCIA de inscripción (chunk CONST) — A4 VERTICAL.
//
// GEMELO de generateCertificadoPdf.ts: NO comparte código con el diploma
// (mandato Pablo: no tocar la emisión de certificados) pero replica sus
// lecciones capitalizadas:
//   · urlToDataUrl vía <img>+canvas (NO fetch → evita el 403 del checkpoint
//     de Vercel y los fallos de inline en foreignObject)
//   · host VISIBLE con opacity:0 (no offscreen-hack)
//   · polling con setTimeout, NUNCA requestAnimationFrame (E-GG-95: la tab en
//     segundo plano pausa rAF y colgaba el render)
//   · toPng con skipFonts:true (SecurityError con Google Fonts cross-origin)
//     + pixelRatio 3 + retry único
//   · jsPDF A4 — acá PORTRAIT (210×297mm; CONST_W/CONST_H tiene ratio idéntico)
// Sin QR (decisión Pablo).
// ============================================================================

async function urlToDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  return new Promise<string | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 5000);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

/** Pre-embebe como data URLs las imágenes del esquema (logo + firmas + watermark). */
async function embedAssetsConstancia(
  esquema: EsquemaConstancia | undefined,
): Promise<EsquemaConstancia> {
  const base = { ...ESQUEMA_CONST_DEFAULT, ...(esquema ?? {}) };
  const [marca, firma1, firma2, watermark] = await Promise.all([
    urlToDataUrl(base.marca_logo_url ?? '/cert/logo-fundplata.png'),
    urlToDataUrl(base.firma_1_img_url ?? '/cert/firma-parente.png'),
    urlToDataUrl(base.firma_2_img_url ?? '/cert/firma-acuna.png'),
    base.visible_watermark ? urlToDataUrl(base.watermark_url) : Promise.resolve(null),
  ]);
  return {
    ...base,
    marca_logo_url: marca,
    firma_1_img_url: firma1,
    firma_2_img_url: firma2,
    watermark_url: watermark,
  };
}

async function esperarRecursos(node: HTMLElement): Promise<void> {
  try {
    if (document.fonts?.ready) await document.fonts.ready;
  } catch {
    /* noop */
  }
  const imgs = Array.from(node.querySelectorAll('img'));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) return resolve();
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        }),
    ),
  );
  // setTimeout, NO rAF (E-GG-95).
  await new Promise((r) => setTimeout(r, 180));
}

/** Renderiza la constancia y devuelve el PDF como Blob (A4 portrait). */
export async function renderConstanciaPdfBlob(
  datos: ConstanciaDatosRender,
  esquema?: EsquemaConstancia,
): Promise<Blob> {
  const esquemaEmbedded = await embedAssetsConstancia(esquema);

  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '0';
  host.style.top = '0';
  host.style.width = `${CONST_W}px`;
  host.style.height = `${CONST_H}px`;
  host.style.opacity = '0';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '-9999';
  host.style.overflow = 'hidden';
  document.body.appendChild(host);

  const root = createRoot(host);
  try {
    root.render(createElement(ConstanciaPremium, { datos, esquema: esquemaEmbedded }));

    // Polling con setTimeout (no rAF · E-GG-95), deadline holgado.
    let target: HTMLElement | null = null;
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline) {
      target = host.firstElementChild as HTMLElement | null;
      if (target && target.offsetWidth > 0 && target.offsetHeight > 0) break;
      await new Promise<void>((r) => setTimeout(r, 50));
    }
    if (!target || target.offsetWidth === 0 || target.offsetHeight === 0) {
      throw new Error('La constancia no se renderizó en el DOM. Recargá la página y reintentá.');
    }
    await esperarRecursos(target);

    let dataUrl: string;
    const opts = {
      width: CONST_W,
      height: CONST_H,
      pixelRatio: 3,
      cacheBust: true,
      // CRÍTICO (lección del diploma): sin skipFonts html-to-image intenta leer
      // cssRules de Google Fonts cross-origin y rompe con SecurityError.
      skipFonts: true,
      fetchRequestInit: { credentials: 'include' as RequestCredentials },
    };
    try {
      dataUrl = await toPng(target, opts);
    } catch (e) {
      console.warn('[constancia-pdf] toPng falló, reintentando una vez:', e);
      await new Promise((r) => setTimeout(r, 300));
      await esperarRecursos(target);
      dataUrl = await toPng(target, opts);
    }
    if (!dataUrl || !dataUrl.startsWith('data:image')) {
      throw new Error('La captura de la constancia salió vacía.');
    }

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(); // 210
    const H = doc.internal.pageSize.getHeight(); // 297
    doc.addImage(dataUrl, 'PNG', 0, 0, W, H, undefined, 'FAST');
    return doc.output('blob');
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Genera y DESCARGA la constancia. */
export async function generateConstanciaPdf(
  datos: ConstanciaDatosRender,
  esquema?: EsquemaConstancia,
): Promise<void> {
  const blob = await renderConstanciaPdfBlob(datos, esquema);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `constancia-${datos.codigo}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
