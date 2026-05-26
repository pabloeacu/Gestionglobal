// cj-pdf · genera el PDF del documento de Consultoría Jurídica.
// Renderiza el HTML del layout MANAXER en un canvas y lo convierte a PDF A4.
// Maneja paginación automática si el contenido excede la altura de la página.

import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

const DOMAIN = 'gestionglobal.ar';

export interface CjDocumentoPdfInput {
  kicker: string;
  titulo: string;
  color_acento: string;
  mostrar_logo: boolean;
  cuerpo_html: string;
  firma: string | null;
  destinatario_nombre: string;
  destinatario_email: string | null;
}

// =========================================================================
// Layout HTML (A4-friendly · estilo MANAXER pero adaptado para impresión)
// =========================================================================
export function buildCjLayoutHtml(doc: CjDocumentoPdfInput): string {
  const accent = /^#[0-9a-fA-F]{6}$/.test(doc.color_acento) ? doc.color_acento : '#0891b2';
  const safe = (s: string) =>
    s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

  const logoBlock = doc.mostrar_logo
    ? `<div style="text-align:center;padding:24px 0 8px;"><img src="https://www.${DOMAIN}/logo-color.png" alt="Gestión Global" crossorigin="anonymous" style="max-width:200px;height:auto;display:inline-block;" /></div>`
    : '';

  const firmaBlock = doc.firma
    ? `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:13px;color:#475569;">${safe(doc.firma)}</div>`
    : '';

  const destinatarioBlock = `
    <div style="margin:16px 0;padding:12px 16px;background:#f8fafc;border-radius:10px;border-left:3px solid ${accent};font-size:13px;color:#1e293b;">
      <strong style="color:#0f172a;">Destinatario:</strong> ${safe(doc.destinatario_nombre)}${doc.destinatario_email ? ` · <span style="color:#64748b;">${safe(doc.destinatario_email)}</span>` : ''}
    </div>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { margin:0; padding:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#1e293b; background:#fff; }
  .page { width:794px; padding:48px 56px; background:#fff; }
  h1 { margin:8px 0 4px; font-size:28px; line-height:1.18; font-weight:800; color:#0f172a; }
  h2 { font-size:18px; font-weight:700; color:#0f172a; margin:18px 0 8px; }
  p { margin:0 0 12px; font-size:14px; line-height:1.65; }
  ul, ol { margin:0 0 12px 24px; padding:0; font-size:14px; line-height:1.65; }
  li { margin:4px 0; }
  strong { color:#0f172a; }
  blockquote { margin:12px 0; padding:8px 16px; border-left:3px solid ${accent}; background:#f8fafc; color:#475569; }
  a { color:${accent}; }
  hr { border:0; border-top:1px solid #e2e8f0; margin:16px 0; }
  .kicker { font-size:12px; font-weight:700; letter-spacing:1.6px; text-transform:uppercase; color:${accent}; margin:0; }
  .footer { margin-top:48px; padding-top:16px; border-top:1px solid #e2e8f0; font-size:10px; color:#94a3b8; text-align:center; }
</style>
</head>
<body>
<div class="page">
  ${logoBlock}
  <p class="kicker">${safe(doc.kicker)}</p>
  <h1>${safe(doc.titulo)}</h1>
  ${destinatarioBlock}
  <hr />
  <div>${doc.cuerpo_html || '<p>(sin contenido)</p>'}</div>
  ${firmaBlock}
  <div class="footer">Gestión Global · Consultoría Jurídica · ${DOMAIN}</div>
</div>
</body>
</html>`;
}

// =========================================================================
// Generador principal: HTML → canvas → PDF
// =========================================================================
export async function generarPdfBlob(doc: CjDocumentoPdfInput): Promise<Blob> {
  const html = buildCjLayoutHtml(doc);

  // Render el HTML en un contenedor off-screen
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-99999px';
  container.style.top = '0';
  container.style.width = '794px'; // A4 ancho aproximado a 96dpi
  container.style.background = '#fff';
  container.innerHTML = html;
  document.body.appendChild(container);

  // Esperamos que la imagen del logo cargue (si aplica)
  const imgs = Array.from(container.querySelectorAll('img'));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) return resolve();
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
          // Safety timeout
          setTimeout(() => resolve(), 3000);
        }),
    ),
  );

  const pageEl = container.querySelector('.page') as HTMLElement;
  // Capturamos
  const canvas = await html2canvas(pageEl, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
  });

  document.body.removeChild(container);

  // jsPDF A4: 210 × 297 mm
  const pdfWidthMm = 210;
  const pdfHeightMm = 297;
  const margin = 10; // mm

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  const usableWidthMm = pdfWidthMm - margin * 2;
  const imgWidthPx = canvas.width;
  const imgHeightPx = canvas.height;
  const pxPerMm = imgWidthPx / usableWidthMm;
  const totalHeightMm = imgHeightPx / pxPerMm;

  // Paginación: cuántas páginas necesitamos
  const usableHeightMm = pdfHeightMm - margin * 2;
  const pageHeightPx = usableHeightMm * pxPerMm;

  let renderedPx = 0;
  let pageIdx = 0;
  while (renderedPx < imgHeightPx) {
    if (pageIdx > 0) pdf.addPage();

    const sliceHeightPx = Math.min(pageHeightPx, imgHeightPx - renderedPx);
    // Creamos un canvas slice
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = imgWidthPx;
    sliceCanvas.height = sliceHeightPx;
    const ctx = sliceCanvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    ctx.drawImage(
      canvas,
      0,
      renderedPx,
      imgWidthPx,
      sliceHeightPx,
      0,
      0,
      imgWidthPx,
      sliceHeightPx,
    );
    const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.92);
    const sliceHeightMm = sliceHeightPx / pxPerMm;
    pdf.addImage(sliceData, 'JPEG', margin, margin, usableWidthMm, sliceHeightMm);

    renderedPx += sliceHeightPx;
    pageIdx += 1;
    if (totalHeightMm <= usableHeightMm) break; // cupo en una sola página
  }

  return pdf.output('blob');
}

// =========================================================================
// Descarga directa (gatilla download del browser)
// =========================================================================
export function descargarBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
