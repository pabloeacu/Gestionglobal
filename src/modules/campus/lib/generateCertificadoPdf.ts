import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
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
// Enfoque HTML/CSS → imagen → PDF (reemplaza el jsPDF-vector "berreta"):
//   1. Genero el QR de la URL pública de verificación como dataURL.
//   2. Monto <CertificadoPremium> (el MISMO componente del preview) en un nodo
//      offscreen a tamaño real (1123×794, ratio A4 apaisado).
//   3. Espero a que carguen fuentes (Cormorant/Great Vibes) e imágenes (logos).
//   4. html2canvas a scale 3 → PNG de alta resolución.
//   5. jsPDF.addImage cubriendo el A4 297×210 mm → doc.save().
//
// Así el PDF es pixel-idéntico a lo que el usuario ve en "Vista previa".
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

// Espera a que las fuentes web y todas las <img> del nodo estén listas, para
// que html2canvas no capture un frame con placeholders.
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
  // Esperamos varios frames para que el layout (incluido position:absolute,
  // svg, conic-gradient, drop-shadow filters) asiente completamente antes de
  // que html2canvas snapshotee. Un solo frame puede ser insuficiente para
  // que el browser rasterice las firmas/sello/franjas absolute.
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
  // Pequeña pausa adicional (browsers móviles tardan más en composición).
  await new Promise((r) => setTimeout(r, 60));
}

export async function generateCertificadoPdf(
  cert: CertificadoParaPdf,
  esquema?: EsquemaCert,
): Promise<void> {
  const url = verificacionUrl(cert.codigo);
  // El QR usa el color de acento del esquema (o navy neutro por default).
  const qrDataUrl = await generarQrDataUrl(url, esquema?.color_acento ?? '#0b1f33');

  // Contenedor offscreen. Mantenemos el host en el flujo (top:0, left:0) y
  // lo movemos fuera con `transform` — esto fuerza al browser a rasterizar
  // todos los position:absolute / SVG / filters hijos correctamente
  // (con position:fixed + left:-10000 algunos motores no aplican composición
  // a hijos absolutos → la franja inferior y firmas salían recortadas).
  const host = document.createElement('div');
  host.style.position = 'absolute';
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = `${CERT_W}px`;
  host.style.height = `${CERT_H}px`;
  host.style.transform = 'translateX(-99999px)';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '-1';
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
      // Damos un tick para que React monte el árbol.
      requestAnimationFrame(() => resolve());
    });

    const target = host.firstElementChild as HTMLElement | null;
    if (!target) throw new Error('No se montó el certificado');
    await esperarRecursos(target);

    const canvas = await html2canvas(target, {
      scale: 3,
      useCORS: true,
      backgroundColor: null,
      logging: false,
      width: CERT_W,
      height: CERT_H,
      windowWidth: CERT_W,
      windowHeight: CERT_H,
      // Garantiza que html2canvas snapshotee TODO el árbol del cert sin
      // depender del viewport real (que en mobile puede ser 390px y romper
      // mediciones de elementos absolutos).
      foreignObjectRendering: false,
    });
    const png = canvas.toDataURL('image/png');

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(); // 297
    const H = doc.internal.pageSize.getHeight(); // 210
    doc.addImage(png, 'PNG', 0, 0, W, H, undefined, 'FAST');
    doc.save(`certificado-${cert.codigo}.pdf`);
  } finally {
    root.unmount();
    host.remove();
  }
}
