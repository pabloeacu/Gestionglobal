import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  ComprobanteRow,
  ComprobanteItemRow,
} from '@/services/api/comprobantes';

// Brand colors en RGB (Tailwind brand-cyan / brand-teal / brand-ink)
const BRAND_CYAN: [number, number, number] = [0, 158, 202];
const BRAND_TEAL: [number, number, number] = [22, 160, 162];
const BRAND_INK: [number, number, number] = [13, 30, 47];
const BRAND_MUTED: [number, number, number] = [100, 116, 139];
const BRAND_ZEBRA: [number, number, number] = [248, 250, 252];

interface Args {
  comprobante: ComprobanteRow;
  items: ComprobanteItemRow[];
}

// Logo PNG cacheado entre llamadas (se descarga una vez por sesión).
let cachedLogo: HTMLImageElement | null | undefined;
async function loadLogo(): Promise<HTMLImageElement | null> {
  if (cachedLogo !== undefined) return cachedLogo;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = '/brand/logo-white.png';
    await img.decode();
    cachedLogo = img;
    return img;
  } catch {
    cachedLogo = null;
    return null;
  }
}

// Genera PDF A4 del comprobante con la marca Gestión Global. Devuelve el doc
// jsPDF — el caller decide guardar (doc.save), abrir (doc.output('bloburl'))
// o adjuntar a email (doc.output('arraybuffer') → base64).
export async function generateComprobantePdf({
  comprobante: c,
  items,
}: Args): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 16;

  // -------------------- header band con gradient (manual) --------------------
  // Banda más alta para dar respiración al logo institucional.
  const headerH = 40;
  doc.setFillColor(...BRAND_CYAN);
  doc.rect(0, 0, pageW, headerH, 'F');
  doc.setFillColor(...BRAND_TEAL);
  doc.rect(pageW * 0.62, 0, pageW * 0.38, headerH, 'F');

  // Triángulos brand en esquina top-right (sutil, no compiten con el logo)
  drawTriangles(doc, pageW - 42, 6, 30);

  // Logo institucional (PNG blanco transparente). Si no está disponible,
  // fallback al wordmark tipográfico.
  const logo = await loadLogo();
  if (logo) {
    const logoH = 26;                            // mm
    const aspect = logo.naturalWidth / Math.max(1, logo.naturalHeight);
    const logoW = logoH * aspect;
    doc.addImage(logo, 'PNG', margin, (headerH - logoH) / 2, logoW, logoH, undefined, 'FAST');
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(255, 255, 255);
    doc.text('GESTIÓN GLOBAL', margin, 19);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(220, 240, 245);
    doc.text('ALIADOS DE TU TIEMPO', margin, 25);
  }

  // Bloque del número y tipo (lado derecho)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  const numStr = c.numero
    ? `${String(c.punto_venta).padStart(5, '0')}-${String(c.numero).padStart(8, '0')}`
    : 'SIN NÚMERO';
  doc.text(`COMPROBANTE ${c.tipo}`, pageW - margin, 18, { align: 'right' });
  doc.setFontSize(16);
  doc.text(numStr, pageW - margin, 27, { align: 'right' });

  // -------------------- meta box (fecha / periodo / venc) --------------------
  let y = 48;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...BRAND_MUTED);

  const meta = [
    ['Fecha de emisión', formatDate(c.fecha)],
    ['Periodo', formatDate(c.periodo)],
    ['Vencimiento', c.vencimiento ? formatDate(c.vencimiento) : '—'],
    ['Estado', labelEstado(c.estado)],
  ];
  const colW = (pageW - margin * 2) / meta.length;
  meta.forEach(([label, value], i) => {
    if (!label || !value) return;
    const x = margin + colW * i;
    doc.setFontSize(7);
    doc.setTextColor(...BRAND_MUTED);
    doc.text(label.toUpperCase(), x, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...BRAND_INK);
    doc.text(String(value), x, y + 5);
    doc.setFont('helvetica', 'normal');
  });

  // -------------------- receptor snapshot --------------------
  y = 56;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.2);
  doc.line(margin, y, pageW - margin, y);

  y += 8;
  doc.setFontSize(7);
  doc.setTextColor(...BRAND_CYAN);
  doc.text('FACTURAR A', margin, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...BRAND_INK);
  doc.text(c.receptor_razon_social, margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...BRAND_MUTED);
  doc.text(
    `${c.receptor_tipo_documento.toUpperCase()} ${c.receptor_numero_documento}  ·  ${c.receptor_condicion_iva.replaceAll('_', ' ')}`,
    margin,
    y,
  );
  if (c.receptor_domicilio) {
    y += 5;
    doc.text(c.receptor_domicilio, margin, y);
  }

  // -------------------- tabla de items --------------------
  y += 10;
  autoTable(doc, {
    startY: y,
    head: [['#', 'Descripción', 'Cant.', 'P. unit.', 'Bonif.', 'IVA', 'Subtotal', 'Total']],
    body: items.map((it) => [
      String(it.orden),
      it.descripcion,
      formatNum(Number(it.cantidad)),
      formatMoney(Number(it.precio_unitario)),
      Number(it.bonificacion_porc) > 0 ? `${it.bonificacion_porc}%` : '—',
      it.alicuota_iva,
      formatMoney(Number(it.subtotal)),
      formatMoney(Number(it.total)),
    ]),
    headStyles: {
      fillColor: BRAND_ZEBRA,
      textColor: BRAND_MUTED,
      fontStyle: 'bold',
      fontSize: 7,
      cellPadding: 2.5,
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
    },
    bodyStyles: {
      fontSize: 9,
      cellPadding: 2.5,
      textColor: BRAND_INK,
      lineColor: [241, 245, 249],
      lineWidth: 0.1,
    },
    columnStyles: {
      0: { halign: 'right', cellWidth: 8, textColor: BRAND_MUTED, fontSize: 8 },
      1: { cellWidth: 'auto' },
      2: { halign: 'right', cellWidth: 14 },
      3: { halign: 'right', cellWidth: 22 },
      4: { halign: 'right', cellWidth: 14, textColor: BRAND_MUTED },
      5: { halign: 'right', cellWidth: 12, textColor: BRAND_MUTED },
      6: { halign: 'right', cellWidth: 22 },
      7: { halign: 'right', cellWidth: 24, fontStyle: 'bold' },
    },
    margin: { left: margin, right: margin },
    theme: 'plain',
  });

  // -------------------- totales --------------------
  // @ts-expect-error jspdf-autotable adds lastAutoTable
  const afterTableY: number = doc.lastAutoTable?.finalY ?? y + 30;
  let ty = afterTableY + 6;

  const totalsRight = pageW - margin;
  const labelX = totalsRight - 50;
  const drawTotalRow = (
    label: string,
    value: number,
    bold = false,
    accent = false,
  ) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 11 : 9);
    doc.setTextColor(...(accent ? BRAND_CYAN : bold ? BRAND_INK : BRAND_MUTED));
    doc.text(label, labelX, ty, { align: 'right' });
    doc.setTextColor(...(accent ? BRAND_CYAN : BRAND_INK));
    doc.text(formatMoney(value), totalsRight, ty, { align: 'right' });
    ty += bold ? 7 : 5;
  };

  drawTotalRow('Neto gravado', Number(c.neto ?? 0));
  if (Number(c.exento) > 0) drawTotalRow('Exento', Number(c.exento));
  if (Number(c.no_gravado) > 0) drawTotalRow('No gravado', Number(c.no_gravado));
  drawTotalRow('IVA total', Number(c.total_iva ?? 0));
  // separator line con respiración suficiente para que no atraviese el TOTAL
  ty += 3;
  doc.setDrawColor(...BRAND_CYAN);
  doc.setLineWidth(0.6);
  doc.line(labelX - 6, ty, totalsRight, ty);
  ty += 8;
  drawTotalRow('TOTAL', Number(c.total ?? 0), true, true);

  // -------------------- observaciones (opcional) --------------------
  if (c.observaciones) {
    ty += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...BRAND_MUTED);
    doc.text('OBSERVACIONES', margin, ty);
    ty += 4;
    doc.setFontSize(9);
    doc.setTextColor(...BRAND_INK);
    const lines = doc.splitTextToSize(c.observaciones, pageW - margin * 2);
    doc.text(lines, margin, ty);
  }

  // -------------------- footer --------------------
  const footerY = pageH - 14;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.2);
  doc.line(margin, footerY - 6, pageW - margin, footerY - 6);
  doc.setFontSize(7);
  doc.setTextColor(...BRAND_MUTED);
  doc.text(
    'Gestión Global  ·  gestionglobal.ar  ·  contacto@gestionglobal.ar',
    margin,
    footerY,
  );
  doc.text(
    c.cae
      ? `CAE ${c.cae}${c.cae_vencimiento ? ` · vence ${formatDate(c.cae_vencimiento)}` : ''}`
      : 'Comprobante interno · sin valor fiscal',
    pageW - margin,
    footerY,
    { align: 'right' },
  );

  return doc;
}

// Convierte el PDF a base64 para enviar como adjunto vía edge function.
export function pdfToBase64(doc: jsPDF): string {
  const ab = doc.output('arraybuffer') as ArrayBuffer;
  const bytes = new Uint8Array(ab);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

// ---- helpers ----

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatNum(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDate(d: string): string {
  // Parsear como local (no UTC) para evitar offset de TZ que retrocede un día.
  const parts = (d.includes('T') ? d.slice(0, 10) : d).split('-').map(Number);
  const dt = new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1);
  return dt.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function labelEstado(e: string): string {
  return e.charAt(0).toUpperCase() + e.slice(1);
}

// Dibuja 3 triángulos brand en posición x,y dentro de un box size×size.
function drawTriangles(doc: jsPDF, x: number, y: number, size: number) {
  const s = size / 3;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(255, 255, 255);
  // tri 1
  const a = (vertices: Array<[number, number]>) => {
    const xs = vertices.map((v) => v[0]);
    const ys = vertices.map((v) => v[1]);
    doc.lines(
      vertices.slice(1).map((v, i) => [v[0] - vertices[i]![0], v[1] - vertices[i]![1]]) as [number, number][],
      xs[0]!,
      ys[0]!,
      [1, 1],
      'F',
      true,
    );
  };
  doc.setFillColor(255, 255, 255);
  // Tres triángulos pequeños con opacidad simulada (color claro)
  doc.setFillColor(180, 220, 240);
  a([[x, y + s], [x + s, y], [x + s, y + s]]);
  doc.setFillColor(150, 210, 220);
  a([[x + s + 2, y + s], [x + s * 2 + 2, y], [x + s * 2 + 2, y + s]]);
  doc.setFillColor(120, 195, 215);
  a([[x + s * 2 + 4, y + s], [x + s * 3 + 4, y], [x + s * 3 + 4, y + s]]);
}
