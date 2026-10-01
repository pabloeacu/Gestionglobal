import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import jsPDF from 'jspdf';
import { toPng } from 'html-to-image';
import {
  VoucherCredencial,
  VOUCHER_W,
  VOUCHER_H,
  ESQUEMA_VOUCHER_DEFAULT,
  type VoucherCredencialDatos,
  type VoucherCredencialEsquema,
} from '../components/VoucherCredencial';

// ============================================================================
// Generación de la credencial de VOUCHER (DGG-210) — PNG o PDF.
//
// GEMELO de generateConstanciaPdf.ts: replica sus lecciones capitalizadas
//   · urlToDataUrl vía <img>+canvas (NO fetch → evita 403 del checkpoint Vercel)
//   · host VISIBLE con opacity:0 (no offscreen-hack)
//   · polling con setTimeout, NUNCA requestAnimationFrame (E-GG-95)
//   · toPng con skipFonts:true + pixelRatio 3 + retry único
//   · host bajo data-gg-classic (los render descargables escapan el tema gg-brand)
// Capa de presentación pura: no toca la lógica del voucher.
// ============================================================================

export type FormatoVoucher = 'png' | 'pdf';

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

/** Renderiza la credencial del voucher y devuelve un data URL PNG (pixelRatio 3). */
export async function renderVoucherPngDataUrl(datos: VoucherCredencialDatos): Promise<string> {
  const logo = await urlToDataUrl(ESQUEMA_VOUCHER_DEFAULT.logo_url);
  const esquema: VoucherCredencialEsquema = { logo_url: logo };

  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '0';
  host.style.top = '0';
  host.style.width = `${VOUCHER_W}px`;
  host.style.height = `${VOUCHER_H}px`;
  host.style.opacity = '0';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '-9999';
  host.style.overflow = 'hidden';
  // DGG-136 · escape del tema gg-brand: la credencial usa identidad clásica inline.
  host.setAttribute('data-gg-classic', '');
  document.body.appendChild(host);

  const root = createRoot(host);
  try {
    root.render(createElement(VoucherCredencial, { datos, esquema }));

    let target: HTMLElement | null = null;
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline) {
      target = host.firstElementChild as HTMLElement | null;
      if (target && target.offsetWidth > 0 && target.offsetHeight > 0) break;
      await new Promise<void>((r) => setTimeout(r, 50));
    }
    if (!target || target.offsetWidth === 0 || target.offsetHeight === 0) {
      throw new Error('La credencial no se renderizó. Recargá la página y reintentá.');
    }
    await esperarRecursos(target);

    const opts = {
      width: VOUCHER_W,
      height: VOUCHER_H,
      pixelRatio: 3,
      cacheBust: true,
      skipFonts: true, // evita SecurityError leyendo cssRules de Google Fonts
      fetchRequestInit: { credentials: 'include' as RequestCredentials },
    };
    let dataUrl: string;
    try {
      dataUrl = await toPng(target, opts);
    } catch (err) {
      console.warn('[voucher-credencial] toPng falló, reintentando una vez:', err);
      await new Promise((r) => setTimeout(r, 300));
      await esperarRecursos(target);
      dataUrl = await toPng(target, opts);
    }
    if (!dataUrl || !dataUrl.startsWith('data:image')) {
      throw new Error('La captura de la credencial salió vacía.');
    }
    return dataUrl;
  } finally {
    root.unmount();
    host.remove();
  }
}

function nombreArchivo(codigo: string, ext: string): string {
  const safe = codigo.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `voucher-${safe}.${ext}`;
}

function descargarDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Genera y DESCARGA la credencial del voucher en el formato pedido. */
export async function descargarVoucherCredencial(
  datos: VoucherCredencialDatos,
  formato: FormatoVoucher,
): Promise<void> {
  const dataUrl = await renderVoucherPngDataUrl(datos);

  if (formato === 'png') {
    descargarDataUrl(dataUrl, nombreArchivo(datos.codigo, 'png'));
    return;
  }

  // PDF: página a medida de la tarjeta (sin márgenes en blanco).
  const pageW = 180; // mm
  const pageH = (VOUCHER_H / VOUCHER_W) * pageW; // mantiene el ratio exacto
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [pageW, pageH] });
  doc.addImage(dataUrl, 'PNG', 0, 0, pageW, pageH, undefined, 'FAST');
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  try {
    descargarDataUrl(url, nombreArchivo(datos.codigo, 'pdf'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
