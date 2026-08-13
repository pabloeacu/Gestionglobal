// cj-pdf · genera el PDF del documento de Consultoría Jurídica.
// Renderiza el HTML del layout MANAXER en un canvas y lo convierte a PDF A4.
// Maneja paginación automática si el contenido excede la altura de la página.
//
// DGG-132 (§6): el logo viaja como DATA URL (el service worker de la PWA
// cachea /logo-color.png sin headers CORS y la re-carga `crossorigin` de
// html2canvas fallaba → hueco en blanco en el PDF); los cortes de página
// buscan una fila en blanco (no cortan líneas de texto por la mitad); y cada
// página lleva "N de M" chiquito y clarito al pie.

import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

const DOMAIN = 'gestionglobal.ar';
const LOGO_PATH = '/logo-color.png';

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
// Logo como data URL (cacheado). Mismo asset same-origin que sirve la app;
// al inlinearlo, preview (iframe sandbox) y html2canvas lo ven idéntico sin
// depender de red, CORS ni del service worker.
// =========================================================================
let logoDataUrlPromise: Promise<string> | null = null;

export function getLogoDataUrl(): Promise<string> {
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = (async () => {
      const res = await fetch(LOGO_PATH);
      if (!res.ok) throw new Error(`logo ${res.status}`);
      const blob = await res.blob();
      // §6: el rewrite SPA de Vercel devuelve index.html con 200 si el asset
      // faltara — sin este guard quedaría cacheado un data:text/html roto
      // para toda la sesión (el bug del logo, en versión permanente).
      if (!blob.type.startsWith('image/')) throw new Error(`logo content-type: ${blob.type}`);
      return await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      });
    })().catch((e) => {
      // Permitir reintento en la próxima llamada y degradar a la URL absoluta
      // (peor caso: el comportamiento previo).
      logoDataUrlPromise = null;
      console.error('cj-pdf logo fetch', e);
      return `https://www.${DOMAIN}${LOGO_PATH}`;
    });
  }
  return logoDataUrlPromise;
}

// =========================================================================
// Layout HTML (A4-friendly · estilo MANAXER pero adaptado para impresión)
// =========================================================================
export function buildCjLayoutHtml(doc: CjDocumentoPdfInput, logoSrc?: string): string {
  const accent = /^#[0-9a-fA-F]{6}$/.test(doc.color_acento) ? doc.color_acento : '#0891b2';
  const safe = (s: string) =>
    s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

  const logoBlock = doc.mostrar_logo
    ? `<div style="text-align:center;padding:24px 0 8px;"><img src="${logoSrc ?? `https://www.${DOMAIN}${LOGO_PATH}`}" alt="Gestión Global" style="max-width:200px;height:auto;display:inline-block;" /></div>`
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
  /* §6 DGG-132: TODO scopeado bajo .page — este <style> también se inyecta en
     el documento VIVO durante la captura de html2canvas y las reglas globales
     (body, *, .kicker) re-estilizaban toda la app por 1-3 segundos. */
  .page, .page * { box-sizing: border-box; }
  .page { width:794px; padding:48px 56px; margin:0; background:#fff; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#1e293b; }
  .page h1 { margin:8px 0 4px; font-size:28px; line-height:1.18; font-weight:800; color:#0f172a; }
  .page h2 { font-size:18px; font-weight:700; color:#0f172a; margin:18px 0 8px; }
  .page p { margin:0 0 12px; font-size:14px; line-height:1.65; }
  .page ul, .page ol { margin:0 0 12px 24px; padding:0; font-size:14px; line-height:1.65; }
  .page li { margin:4px 0; }
  .page strong { color:#0f172a; }
  .page blockquote { margin:12px 0; padding:8px 16px; border-left:3px solid ${accent}; background:#f8fafc; color:#475569; }
  .page a { color:${accent}; }
  .page hr { border:0; border-top:1px solid #e2e8f0; margin:16px 0; }
  .page .kicker { font-size:12px; font-weight:700; letter-spacing:1.6px; text-transform:uppercase; color:${accent}; margin:0; }
  .page .footer { margin-top:48px; padding-top:16px; border-top:1px solid #e2e8f0; font-size:10px; color:#94a3b8; text-align:center; }
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
  const logoSrc = doc.mostrar_logo ? await getLogoDataUrl() : undefined;
  const html = buildCjLayoutHtml(doc, logoSrc);

  // Render el HTML en un contenedor off-screen
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-99999px';
  container.style.top = '0';
  container.style.width = '794px'; // A4 ancho aproximado a 96dpi
  container.style.background = '#fff';
  container.innerHTML = html;
  // DGG-136 · escape del tema gg-brand: los PDFs son INTOCABLES (identidad clásica siempre)
  container.setAttribute('data-gg-classic', '');
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
  // §6: cap dinámico de escala — iOS Safari limita el ÁREA total del canvas
  // (~16.7M px) y un doc largo a scale 2 sale en blanco SIN error. Con el cap,
  // documentos largos bajan la escala lo justo para entrar en el límite.
  const alturaCss = Math.max(1, pageEl.scrollHeight);
  const scale = Math.min(2, Math.max(1, Math.sqrt(16_000_000 / (794 * alturaCss))));
  // Capturamos
  const canvas = await html2canvas(pageEl, {
    scale,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
  });

  document.body.removeChild(container);
  if (!canvas.width || !canvas.height) {
    throw new Error('El render del documento devolvió un canvas vacío. Probá con un documento más corto o desde una computadora.');
  }

  // jsPDF A4: 210 × 297 mm
  const pdfWidthMm = 210;
  const pdfHeightMm = 297;
  const margin = 10; // mm
  const footerBandMm = 6; // reserva para el "N de M" al pie

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  const usableWidthMm = pdfWidthMm - margin * 2;
  const imgWidthPx = canvas.width;
  const imgHeightPx = canvas.height;
  const pxPerMm = imgWidthPx / usableWidthMm;

  const usableHeightMm = pdfHeightMm - margin * 2 - footerBandMm;
  const pageHeightPx = Math.floor(usableHeightMm * pxPerMm);

  // ── Cortes inteligentes: nunca por el medio de una línea de texto ──────
  // Desde el corte ideal buscamos hacia ARRIBA la fila totalmente blanca más
  // cercana (los espacios entre líneas/párrafos siempre existen). Si no hay
  // ninguna en la ventana (bloque gigante sin blancos, p.ej. una imagen),
  // caemos al corte ideal como antes.
  const ctxFull = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctxFull) throw new Error('No 2D context');
  const esFilaBlanca = (y: number): boolean => {
    const fila = ctxFull.getImageData(0, y, imgWidthPx, 1).data;
    for (let i = 0; i < fila.length; i += 16) { // muestrea 1 de cada 4 px
      if ((fila[i] ?? 255) < 246 || (fila[i + 1] ?? 255) < 246 || (fila[i + 2] ?? 255) < 246) {
        return false;
      }
    }
    return true;
  };

  const cortes: Array<{ desde: number; hasta: number }> = [];
  let inicio = 0;
  while (inicio < imgHeightPx) {
    let fin = Math.min(inicio + pageHeightPx, imgHeightPx);
    if (fin < imgHeightPx) {
      const ventana = Math.floor(pageHeightPx * 0.25);
      const minimo = inicio + Math.floor(pageHeightPx * 0.5);
      for (let y = fin; y > fin - ventana && y > minimo; y--) {
        if (esFilaBlanca(y)) { fin = y; break; }
      }
    }
    cortes.push({ desde: inicio, hasta: fin });
    inicio = fin;
    // La página siguiente arranca en contenido: saltear el colchón blanco.
    while (inicio < imgHeightPx && esFilaBlanca(inicio)) inicio++;
  }

  const totalPaginas = cortes.length;
  cortes.forEach((corte, idx) => {
    if (idx > 0) pdf.addPage();
    const sliceHeightPx = corte.hasta - corte.desde;
    if (sliceHeightPx > 0) {
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = imgWidthPx;
      sliceCanvas.height = sliceHeightPx;
      const ctx = sliceCanvas.getContext('2d');
      if (!ctx) throw new Error('No 2D context');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, imgWidthPx, sliceHeightPx);
      ctx.drawImage(
        canvas,
        0, corte.desde, imgWidthPx, sliceHeightPx,
        0, 0, imgWidthPx, sliceHeightPx,
      );
      const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.92);
      const sliceHeightMm = sliceHeightPx / pxPerMm;
      pdf.addImage(sliceData, 'JPEG', margin, margin, usableWidthMm, sliceHeightMm);
    }
    // Nº de página al pie, chiquito y clarito (pedido Pablo DGG-132).
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(203, 213, 225); // slate-300
    pdf.text(`${idx + 1} de ${totalPaginas}`, pdfWidthMm / 2, pdfHeightMm - 6, { align: 'center' });
  });

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
