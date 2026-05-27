import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import jsPDF from 'jspdf';
import { toPng } from 'html-to-image';
import QRCode from 'qrcode';
import type { CertificadoParaPdf } from '@/services/api/campus';
import { verificacionUrl } from '@/services/api/campus';
import {
  CertificadoPremium,
  CERT_W,
  CERT_H,
  type EsquemaCert,
} from '../components/CertificadoPremium';

// ============================================================================
// Generación del certificado ULTRA PREMIUM (DGG-13).
//
// Estrategia v3 — switch html2canvas → html-to-image:
//   html2canvas rasteriza manualmente el DOM y falla con SVGs complejos +
//   position:absolute + bottom (perdía la franja inferior, QR, sello).
//   html-to-image en cambio serializa el DOM dentro de un foreignObject SVG
//   y lo dibuja en canvas — es el método más fiel posible al render real
//   del browser. Lo que ve el usuario en el preview = exactamente lo que
//   sale al PDF.
//
//   1. Monto <CertificadoPremium> en un host VISIBLE (no offscreen-hack)
//      en una capa por encima de la app con opacity 0 + pointer-events none,
//      para que el browser lo rasterice de verdad.
//   2. Espero fonts + imágenes + 3 frames.
//   3. toPng(target, { width: CERT_W, height: CERT_H, pixelRatio: 3 }).
//   4. jsPDF.addImage cubre A4 297×210mm (ratio idéntico a CERT_W/CERT_H).
// ============================================================================

async function generarQrDataUrl(url: string, dark: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(url, {
      margin: 1,
      width: 320,
      errorCorrectionLevel: 'M',
      color: { dark, light: '#ffffff' },
    });
  } catch {
    return null;
  }
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
  // 3 frames + 80ms para que SVG conic-gradient/drop-shadows asienten.
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
  await new Promise((r) => setTimeout(r, 80));
}

export async function generateCertificadoPdf(
  cert: CertificadoParaPdf,
  esquema?: EsquemaCert,
): Promise<void> {
  const url = verificacionUrl(cert.codigo);
  const qrDataUrl = await generarQrDataUrl(url, esquema?.color_acento ?? '#0b1f33');

  // Host VISIBLE pero invisible al usuario · z-index alto + opacity 0.
  // Sin position:fixed offscreen — el browser necesita layoutar de verdad
  // todos los position:absolute hijos.
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '0';
  host.style.top = '0';
  host.style.width = `${CERT_W}px`;
  host.style.height = `${CERT_H}px`;
  host.style.opacity = '0';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '-9999';
  host.style.overflow = 'hidden';
  document.body.appendChild(host);

  const root = createRoot(host);
  try {
    await new Promise<void>((resolve) => {
      root.render(
        createElement(CertificadoPremium, {
          cert,
          qrDataUrl,
          verificarUrl: url,
          esquema,
        }),
      );
      requestAnimationFrame(() => resolve());
    });

    const target = host.firstElementChild as HTMLElement | null;
    if (!target) throw new Error('No se montó el certificado');
    await esperarRecursos(target);

    // html-to-image: serializa DOM dentro de un foreignObject SVG y rasteriza
    // en canvas. Captura fielmente SVGs, conic-gradient, drop-shadow, etc.
    const dataUrl = await toPng(target, {
      width: CERT_W,
      height: CERT_H,
      pixelRatio: 3,
      cacheBust: true,
      // Skips fonts download (las ya tenemos en document.fonts)
      skipFonts: false,
      // Permitir CORS para imágenes externas (logo, firmas, watermark)
      fetchRequestInit: { mode: 'cors', credentials: 'omit' },
    });

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(); // 297
    const H = doc.internal.pageSize.getHeight(); // 210
    doc.addImage(dataUrl, 'PNG', 0, 0, W, H, undefined, 'FAST');
    doc.save(`certificado-${cert.codigo}.pdf`);
  } finally {
    root.unmount();
    host.remove();
  }
}
