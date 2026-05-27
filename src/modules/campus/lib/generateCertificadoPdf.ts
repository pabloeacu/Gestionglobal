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
  // Un frame extra para que el layout de fuentes asiente.
  await new Promise((r) => requestAnimationFrame(() => r(null)));
}

export async function generateCertificadoPdf(
  cert: CertificadoParaPdf,
  esquema?: EsquemaCert,
): Promise<void> {
  const url = verificacionUrl(cert.codigo);
  // El QR usa el color de acento del esquema (o navy neutro por default).
  const qrDataUrl = await generarQrDataUrl(url, esquema?.color_acento ?? '#0b1f33');

  // Contenedor offscreen (visible para el navegador, fuera del viewport).
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-10000px';
  host.style.top = '0';
  host.style.width = `${CERT_W}px`;
  host.style.height = `${CERT_H}px`;
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
