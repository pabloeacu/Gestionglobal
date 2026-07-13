// ============================================================================
// generateTramitePdf · genera el PDF "Detalle del trámite" que descarga el
// gestor desde el panel de acceso externo. Branding Gestión Global premium.
//
// Estrategia: HTML offscreen → html2canvas → jsPDF (misma vía que cj-pdf,
// los reportes y los certificados — DGG-13/DGG-26). Devuelve un Blob para
// que el caller dispare la descarga.
// ============================================================================

import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

const DOMAIN = 'gestionglobal.ar';
const BRAND_CYAN = '#009ECA';

export interface AdjuntoTramite {
  field_name: string;
  /** Etiqueta humana del campo (consigna) resuelta server-side (mig 0208). */
  label?: string | null;
  filename_original: string;
  storage_path: string;
  url_descarga?: string; // URL firmada (ya generada por el caller)
}

export interface TramitePdfInput {
  solicitud_id: string;
  servicio: string;
  formulario_titulo: string | null;
  formulario_categoria: string | null;
  solicitante_nombre: string;
  solicitante_email: string;
  solicitante_telefono: string;
  datos: Record<string, unknown>;
  adjuntos: AdjuntoTramite[];
  /**
   * Documentos que el cliente subió a los "Pedidos de Documentación"
   * (bucket pedidos-doc-cliente). E-GG-91 pieza 2: para que el PDF sea
   * consistente con lo que el gestor ve en pantalla.
   */
  pedidosDoc?: Array<{
    descripcion: string;
    filename_original: string;
    estado: string;
    url_descarga?: string;
    /** Nota de texto del cliente cuando no adjuntó archivo (E-GG-110). */
    respuesta_texto?: string | null;
  }>;
  created_at: string;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatearFecha(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatearValor(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function buildHtml(input: TramitePdfInput): string {
  const fechaHoy = new Date().toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const datosRows = Object.entries(input.datos)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(
      ([k, v]) => `
      <tr>
        <td class="campo">${escapeHtml(k.replace(/_/g, ' '))}</td>
        <td class="valor">${escapeHtml(formatearValor(v))}</td>
      </tr>`,
    )
    .join('');

  const adjuntosRows =
    input.adjuntos.length === 0
      ? `<p class="empty">Sin adjuntos cargados por el cliente.</p>`
      : `<ul class="adjuntos">
          ${input.adjuntos
            .map(
              (a) => `
            <li>
              <span class="adj-icon">📎</span>
              ${a.url_descarga
                ? `<a href="${escapeHtml(a.url_descarga)}" target="_blank">${escapeHtml(a.filename_original)}</a>`
                : `<span>${escapeHtml(a.filename_original)}</span>`}
              <span class="adj-campo">· ${escapeHtml(a.label || a.field_name.replace(/_/g, ' '))}</span>
            </li>
          `,
            )
            .join('')}
        </ul>`;

  // E-GG-91 pieza 2: documentos que el cliente subió a los pedidos de
  // documentación. Sólo se renderiza la sección si hay alguno.
  const pedidosDoc = input.pedidosDoc ?? [];
  const pedidosDocSection =
    pedidosDoc.length === 0
      ? ''
      : `<h2>Documentación pedida al cliente</h2>
        <ul class="adjuntos">
          ${pedidosDoc
            .map(
              (p) => `
            <li>
              <span class="adj-icon">${p.respuesta_texto && !p.url_descarga ? '📝' : '📄'}</span>
              ${p.respuesta_texto && !p.url_descarga
                ? `<span>${escapeHtml(p.respuesta_texto)}</span>`
                : p.url_descarga
                ? `<a href="${escapeHtml(p.url_descarga)}" target="_blank">${escapeHtml(p.filename_original)}</a>`
                : `<span>${escapeHtml(p.filename_original)}</span>`}
              <span class="adj-campo">· ${escapeHtml(p.descripcion)}${p.estado === 'aprobado' ? ' · aprobado' : ''}</span>
            </li>
          `,
            )
            .join('')}
        </ul>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #1e293b; background: #fff;
  }
  .page { width: 794px; padding: 48px 56px 40px; background: #fff; min-height: 1100px; }
  .header {
    position: relative;
    padding: 28px 32px 24px;
    background: linear-gradient(135deg, ${BRAND_CYAN} 0%, #0891B2 100%);
    color: #fff;
    border-radius: 16px;
    margin-bottom: 28px;
  }
  .header .brand {
    margin-bottom: 8px;
  }
  .header .brand img {
    height: 36px;
    width: auto;
    display: block;
  }
  .header .kicker {
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.8px;
    text-transform: uppercase;
    color: rgba(255,255,255,0.95);
  }
  .header h1 {
    margin: 6px 0 4px;
    font-size: 26px;
    font-weight: 800;
    line-height: 1.2;
  }
  .header .meta {
    margin-top: 6px;
    font-size: 12px;
    color: rgba(255,255,255,0.92);
  }
  h2 {
    font-size: 14px;
    font-weight: 700;
    color: ${BRAND_CYAN};
    text-transform: uppercase;
    letter-spacing: 1.2px;
    margin: 24px 0 10px;
  }
  .card {
    padding: 16px 18px;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    background: #f8fafc;
    margin-bottom: 6px;
  }
  .solicitante-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 24px;
  }
  .label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #64748b;
    margin: 0 0 2px;
  }
  .value {
    font-size: 13px;
    color: #0f172a;
    margin: 0;
    word-break: break-word;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 4px;
  }
  td {
    font-size: 12px;
    padding: 8px 10px;
    vertical-align: top;
    border-bottom: 1px solid #f1f5f9;
  }
  td.campo {
    width: 38%;
    color: #64748b;
    font-weight: 600;
    text-transform: capitalize;
  }
  td.valor {
    color: #0f172a;
  }
  .adjuntos {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .adjuntos li {
    padding: 8px 10px;
    border-bottom: 1px solid #f1f5f9;
    font-size: 12px;
    color: #0f172a;
  }
  .adj-icon { margin-right: 6px; }
  .adj-campo { color: #94a3b8; font-size: 11px; margin-left: 4px; }
  .adjuntos a { color: ${BRAND_CYAN}; text-decoration: none; font-weight: 500; }
  .empty {
    margin: 0;
    padding: 14px 16px;
    background: #f8fafc;
    border-radius: 10px;
    color: #94a3b8;
    font-size: 12px;
    font-style: italic;
  }
  .footer {
    margin-top: 36px;
    padding-top: 16px;
    border-top: 1px solid #e2e8f0;
    font-size: 10px;
    color: #94a3b8;
    text-align: center;
    line-height: 1.5;
  }
  .footer strong { color: ${BRAND_CYAN}; }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="brand">
      <img src="https://www.${DOMAIN}/brand/logo-h-white.png" alt="Gestión Global" crossorigin="anonymous" />
    </div>
    <p class="kicker">Detalle del trámite</p>
    <h1>${escapeHtml(input.formulario_titulo || input.servicio)}</h1>
    <p class="meta">
      ID ${input.solicitud_id.slice(0, 8).toUpperCase()}
      · Recibido el ${formatearFecha(input.created_at)}
      ${input.formulario_categoria ? ` · ${escapeHtml(input.formulario_categoria)}` : ''}
    </p>
  </div>

  <h2>Solicitante</h2>
  <div class="card">
    <div class="solicitante-grid">
      <div>
        <p class="label">Nombre</p>
        <p class="value">${escapeHtml(input.solicitante_nombre || '—')}</p>
      </div>
      <div>
        <p class="label">Email</p>
        <p class="value">${escapeHtml(input.solicitante_email || '—')}</p>
      </div>
      <div>
        <p class="label">Teléfono</p>
        <p class="value">${escapeHtml(input.solicitante_telefono || '—')}</p>
      </div>
      <div>
        <p class="label">Servicio</p>
        <p class="value">${escapeHtml(input.servicio)}</p>
      </div>
    </div>
  </div>

  <h2>Datos del formulario</h2>
  ${
    datosRows
      ? `<table>${datosRows}</table>`
      : `<p class="empty">El cliente no completó campos en el formulario.</p>`
  }

  <h2>Documentación adjunta</h2>
  ${adjuntosRows}

  ${pedidosDocSection}

  <div class="footer">
    Generado el ${fechaHoy} · <strong>Gestión Global</strong> · ${DOMAIN}<br />
    Documento confidencial — uso exclusivo de la gestoría destinataria.
  </div>

</div>
</body>
</html>`;
}

export async function generateTramitePdfBlob(
  input: TramitePdfInput,
): Promise<Blob> {
  const html = buildHtml(input);

  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-99999px';
  container.style.top = '0';
  container.style.width = '794px';
  container.style.background = '#fff';
  container.innerHTML = html;
  document.body.appendChild(container);

  // Esperar el logo del header (logo-h-white.png con CORS habilitado)
  const imgs = Array.from(container.querySelectorAll('img'));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) return resolve();
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
          // Failsafe: si tarda más de 4s, seguimos sin él
          setTimeout(() => resolve(), 4000);
        }),
    ),
  );
  try {
    if (document.fonts?.ready) await document.fonts.ready;
  } catch {
    /* noop */
  }
  await new Promise((r) => requestAnimationFrame(() => r(null)));

  const pageNode = container.querySelector('.page') as HTMLElement;
  const canvas = await html2canvas(pageNode, {
    scale: 2,
    backgroundColor: '#fff',
    useCORS: true,
    allowTaint: false,
    logging: false,
  });
  document.body.removeChild(container);

  // Generar PDF A4 (potencialmente multipágina si el contenido es largo)
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidthMm = 210;
  const pageHeightMm = 297;
  const imgWidthMm = pageWidthMm;
  const imgHeightMm = (canvas.height * imgWidthMm) / canvas.width;

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

  let yOffset = 0;
  let remaining = imgHeightMm;
  let first = true;
  while (remaining > 0) {
    if (!first) pdf.addPage();
    pdf.addImage(dataUrl, 'JPEG', 0, -yOffset, imgWidthMm, imgHeightMm);
    remaining -= pageHeightMm;
    yOffset += pageHeightMm;
    first = false;
  }

  return pdf.output('blob');
}
