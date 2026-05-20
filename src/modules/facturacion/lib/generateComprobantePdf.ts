import jsPDF from 'jspdf';
import type {
  ComprobanteRow,
  ComprobanteItemRow,
} from '@/services/api/comprobantes';

// Paleta brand (RGB) — alineada con Tailwind config.
const CYAN: [number, number, number] = [0, 158, 202];
const CYAN_PALE: [number, number, number] = [229, 246, 252];
const TEAL: [number, number, number] = [22, 160, 162];
const INK: [number, number, number] = [13, 30, 47];
const MUTED: [number, number, number] = [100, 116, 139];
const SOFT: [number, number, number] = [203, 213, 225];
const ZEBRA: [number, number, number] = [248, 250, 252];
const WHITE: [number, number, number] = [255, 255, 255];

interface Args {
  comprobante: ComprobanteRow;
  items: ComprobanteItemRow[];
}

// Logo cacheado entre llamadas para no descargarlo cada vez.
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

// Comprobante editorial premium — diseño Apple/Stripe-grade.
// Estructura:
//   1. Cover bipartito alto (cyan + teal) con logo y número hero.
//   2. Meta strip (fecha · periodo · vencimiento · estado).
//   3. Bloque "Facturar a" con razón social grande.
//   4. Items como tarjetas con dividers sutiles (no tabla con bordes).
//   5. Card de totales con TOTAL hero en cyan.
//   6. Mensaje "Gracias" + footer brand + slot QR/CAE.
export async function generateComprobantePdf({
  comprobante: c,
  items,
}: Args): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();   // 210
  const pageH = doc.internal.pageSize.getHeight();  // 297
  const margin = 18;
  const innerW = pageW - margin * 2;

  // ============================================================
  // 1. COVER bipartito (75mm)
  // ============================================================
  const coverH = 75;
  const splitX = pageW * 0.58;

  // Izquierda: cyan sólido
  doc.setFillColor(...CYAN);
  doc.rect(0, 0, splitX, coverH, 'F');

  // Derecha: teal sólido
  doc.setFillColor(...TEAL);
  doc.rect(splitX, 0, pageW - splitX, coverH, 'F');

  // Banda de degradado fake en el límite (3 columnas teal mezclando)
  for (let i = 0; i < 8; i++) {
    const t = i / 8;
    const r = Math.round(CYAN[0] + (TEAL[0] - CYAN[0]) * t);
    const g = Math.round(CYAN[1] + (TEAL[1] - CYAN[1]) * t);
    const b = Math.round(CYAN[2] + (TEAL[2] - CYAN[2]) * t);
    doc.setFillColor(r, g, b);
    doc.rect(splitX - 8 + i, 0, 1.1, coverH, 'F');
  }

  // Triángulos brand en la esquina superior derecha (más chicos y pegados al
  // borde para no tapar el texto "COMPROBANTE" ni la "X" XL).
  drawTrianglesGroup(doc, pageW - 30, 4, 26, 12, [255, 255, 255], 0.45);

  // Subtle dot pattern en el lado izquierdo, abajo
  drawDotPattern(doc, margin, coverH - 24, splitX - margin - 6, 16, [255, 255, 255], 0.15);

  // Logo institucional (grande, ~48mm de alto)
  const logo = await loadLogo();
  if (logo) {
    const logoH = 48;
    const aspect = logo.naturalWidth / Math.max(1, logo.naturalHeight);
    const logoW = logoH * aspect;
    // Centrado verticalmente sobre la mitad izquierda, alineado a la izquierda
    const logoX = margin;
    const logoY = (coverH - logoH) / 2;
    doc.addImage(logo, 'PNG', logoX, logoY, logoW, logoH, undefined, 'FAST');
  } else {
    // Fallback wordmark tipográfico
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(28);
    doc.setTextColor(...WHITE);
    doc.text('GESTIÓN GLOBAL', margin, coverH / 2 - 2);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(220, 240, 245);
    doc.text('ALIADOS DE TU TIEMPO', margin, coverH / 2 + 5);
  }

  // Lado derecho: COMPROBANTE + tipo XL + numero
  const rightCx = splitX + (pageW - splitX) / 2;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text('COMPROBANTE', rightCx, 18, { align: 'center', charSpace: 1.8 });

  // Tipo enorme (X)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(56);
  doc.setTextColor(...WHITE);
  doc.text(c.tipo, rightCx, coverH / 2 + 6, { align: 'center' });

  // Número correlativo
  const numStr = c.numero
    ? `${String(c.punto_venta).padStart(5, '0')} - ${String(c.numero).padStart(8, '0')}`
    : 'SIN NÚMERO';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...WHITE);
  doc.text(numStr, rightCx, coverH - 14, { align: 'center', charSpace: 0.8 });

  // ============================================================
  // 2. META STRIP (4 columnas: fecha / periodo / vencimiento / estado)
  // ============================================================
  let y = coverH + 12;

  const metaItems = [
    { label: 'Fecha de emisión', value: formatDateLong(c.fecha) },
    { label: 'Periodo', value: formatPeriodo(c.periodo) },
    { label: 'Vencimiento', value: c.vencimiento ? formatDateLong(c.vencimiento) : '—' },
    { label: 'Estado', value: estadoLabel(c.estado), accent: c.estado === 'autorizado' },
  ];
  const colW = innerW / metaItems.length;
  metaItems.forEach((m, i) => {
    const cx = margin + colW * i;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(m.label.toUpperCase(), cx, y, { charSpace: 0.4 });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...(m.accent ? CYAN : INK));
    doc.text(m.value, cx, y + 6);
  });

  y += 16;

  // Línea divisora horizontal
  doc.setDrawColor(...SOFT);
  doc.setLineWidth(0.25);
  doc.line(margin, y, pageW - margin, y);
  y += 10;

  // ============================================================
  // 3. FACTURAR A — receptor card
  // ============================================================
  // Kicker
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...CYAN);
  doc.text('FACTURAR A', margin, y, { charSpace: 1.5 });
  y += 6;

  // Razón social bold large
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...INK);
  const razon = sanitize(c.receptor_razon_social);
  doc.text(razon, margin, y);
  y += 7;

  // Doc + condición IVA · separados por punto
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  const docLabel = c.receptor_tipo_documento === 'dni_ficticio'
    ? 'DNI ficticio'
    : c.receptor_tipo_documento.toUpperCase();
  const docLine = `${docLabel} ${c.receptor_numero_documento}  ·  ${sanitize(c.receptor_condicion_iva.replaceAll('_', ' '))}`;
  doc.text(docLine, margin, y);
  y += 5;

  if (c.receptor_domicilio) {
    doc.text(sanitize(c.receptor_domicilio), margin, y);
    y += 5;
  }
  y += 6;

  // ============================================================
  // 4. ITEMS — sin tabla, formato "cards" con dividers sutiles
  // ============================================================
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...CYAN);
  doc.text('DETALLE', margin, y, { charSpace: 1.5 });
  y += 7;

  // Encabezado de columnas muy sutil
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text('CONCEPTO', margin, y, { charSpace: 0.4 });
  doc.text('CANT.', pageW - margin - 65, y, { align: 'right', charSpace: 0.4 });
  doc.text('PRECIO', pageW - margin - 38, y, { align: 'right', charSpace: 0.4 });
  doc.text('IMPORTE', pageW - margin, y, { align: 'right', charSpace: 0.4 });
  y += 4;

  // Línea fina debajo del encabezado
  doc.setDrawColor(...SOFT);
  doc.setLineWidth(0.2);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  // Items
  doc.setFont('helvetica', 'normal');
  items.forEach((it, idx) => {
    // Descripción
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    const desc = sanitize(it.descripcion);
    // Truncar si excede ancho disponible
    const maxDescWidth = pageW - margin - 65 - margin - 4;
    const descLines = doc.splitTextToSize(desc, maxDescWidth);
    doc.text(descLines[0] ?? desc, margin, y);

    // Subtext (alicuota + bonificación si aplica)
    const subParts: string[] = [];
    if (it.alicuota_iva && it.alicuota_iva !== 'exento' && it.alicuota_iva !== 'no_gravado') {
      subParts.push(`IVA ${it.alicuota_iva}%`);
    } else if (it.alicuota_iva === 'exento') subParts.push('IVA exento');
    else if (it.alicuota_iva === 'no_gravado') subParts.push('No gravado');
    if (Number(it.bonificacion_porc) > 0) {
      subParts.push(`Bonif. ${it.bonificacion_porc}%`);
    }
    if (subParts.length > 0) {
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(subParts.join(' · '), margin, y + 4.5);
    }

    // Cant / precio / importe alineados a derecha
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(formatNum(Number(it.cantidad)), pageW - margin - 65, y, { align: 'right' });
    doc.text(formatMoney(Number(it.precio_unitario)), pageW - margin - 38, y, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text(formatMoney(Number(it.total)), pageW - margin, y, { align: 'right' });
    doc.setFont('helvetica', 'normal');

    y += subParts.length > 0 ? 9 : 7;

    // Divider entre items (no después del último)
    if (idx < items.length - 1) {
      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.15);
      doc.line(margin, y - 1, pageW - margin, y - 1);
      y += 2;
    }
  });

  y += 8;

  // ============================================================
  // 5. TOTALES — bloque a la derecha
  // ============================================================
  // Sutil línea separadora antes del bloque
  doc.setDrawColor(...SOFT);
  doc.setLineWidth(0.3);
  doc.line(pageW - margin - 70, y, pageW - margin, y);
  y += 7;

  const labelX = pageW - margin - 70;
  const valueX = pageW - margin;

  // Sub-totales (neto / exento / no gravado / iva)
  const subRows: Array<[string, number]> = [];
  if (Number(c.neto) > 0) subRows.push(['Neto gravado', Number(c.neto)]);
  if (Number(c.exento) > 0) subRows.push(['Exento', Number(c.exento)]);
  if (Number(c.no_gravado) > 0) subRows.push(['No gravado', Number(c.no_gravado)]);
  if (Number(c.total_iva) > 0) subRows.push(['IVA', Number(c.total_iva)]);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  subRows.forEach(([lbl, val]) => {
    doc.setTextColor(...MUTED);
    doc.text(lbl, labelX, y);
    doc.setTextColor(...INK);
    doc.text(formatMoney(val), valueX, y, { align: 'right' });
    y += 6;
  });

  y += 2;

  // TOTAL hero card
  const totalCardH = 22;
  const totalCardX = labelX - 4;
  const totalCardW = valueX - totalCardX + 2;
  doc.setFillColor(...CYAN_PALE);
  doc.roundedRect(totalCardX, y, totalCardW, totalCardH, 2.5, 2.5, 'F');
  // Border accent left
  doc.setFillColor(...CYAN);
  doc.rect(totalCardX, y, 1.6, totalCardH, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...CYAN);
  doc.text('TOTAL', labelX + 1, y + 8, { charSpace: 1.2 });
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(c.moneda ?? 'ARS', labelX + 1, y + 14);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...CYAN);
  doc.text(formatMoney(Number(c.total ?? 0)), valueX - 1, y + 14, { align: 'right' });

  y += totalCardH + 4;

  // ============================================================
  // 6. FOOTER fijo + observaciones que respeten el espacio
  // ============================================================
  const FOOTER_BLOCK_H = 38;
  const footerY = pageH - FOOTER_BLOCK_H;

  // Observaciones: solo si caben antes del footer; si no, se omiten del PDF
  // (igual quedan en la ficha web del comprobante).
  if (c.observaciones) {
    const obsLines = doc.splitTextToSize(sanitize(c.observaciones), innerW - 12);
    const obsH = obsLines.length * 4.5 + 12;
    if (y + obsH + 6 <= footerY) {
      y += 4;
      doc.setFillColor(...ZEBRA);
      doc.roundedRect(margin, y, innerW, obsH, 2.5, 2.5, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...CYAN);
      doc.text('OBSERVACIONES', margin + 6, y + 6, { charSpace: 1.2 });
      doc.setFontSize(9);
      doc.setTextColor(...INK);
      doc.text(obsLines, margin + 6, y + 12);
    }
  }

  // Línea divisora superior del footer (con un punto triangular brand)
  doc.setDrawColor(...CYAN);
  doc.setLineWidth(0.4);
  doc.line(margin, footerY, pageW - margin, footerY);
  // Punto triangular acento
  doc.setFillColor(...CYAN);
  const tri = 2.2;
  doc.triangle(
    pageW / 2 - tri, footerY,
    pageW / 2 + tri, footerY,
    pageW / 2, footerY + tri * 1.4,
    'F',
  );

  // Mensaje agradecimiento
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text('Gracias por confiar en Gestión Global.', margin, footerY + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(
    'Si tenés consultas sobre este comprobante, escribinos a contacto@gestionglobal.ar',
    margin,
    footerY + 20,
  );

  // CAE / QR a la derecha (placeholder)
  if (c.cae) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text('CAE', pageW - margin, footerY + 12, { align: 'right', charSpace: 1.2 });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(c.cae, pageW - margin, footerY + 18, { align: 'right' });
    if (c.cae_vencimiento) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...MUTED);
      doc.text(`vence ${formatDateLong(c.cae_vencimiento)}`, pageW - margin, footerY + 23, { align: 'right' });
    }
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text('Comprobante interno · sin valor fiscal', pageW - margin, footerY + 18, { align: 'right' });
  }

  // Brand strip bottom
  const stripY = pageH - 10;
  doc.setFillColor(...CYAN);
  doc.rect(0, stripY, pageW, 4, 'F');
  doc.setFillColor(...TEAL);
  doc.rect(pageW * 0.62, stripY, pageW * 0.38, 4, 'F');
  // Texto centrado en strip
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...WHITE);
  doc.text('gestionglobal.ar', pageW / 2, stripY + 2.7, { align: 'center', charSpace: 0.6 });

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

// ============================================================
// helpers
// ============================================================

function sanitize(s: string): string {
  // jsPDF Helvetica (WinAnsi) no soporta algunos caracteres Unicode raros.
  // Por las dudas, normalizamos NFC.
  return s.normalize('NFC');
}

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

function parseLocalDate(d: string): Date {
  const datePart = d.includes('T') ? d.slice(0, 10) : d;
  const parts = datePart.split('-').map(Number);
  return new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1);
}

function formatDateLong(d: string): string {
  return parseLocalDate(d).toLocaleDateString('es-AR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function formatPeriodo(d: string): string {
  return parseLocalDate(d).toLocaleDateString('es-AR', {
    month: 'long', year: 'numeric',
  });
}

function estadoLabel(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Pequeño grupo de 3 triángulos brand para overlay decorativo.
function drawTrianglesGroup(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  color: [number, number, number],
  opacity: number,
) {
  // jspdf no soporta alpha real; simulamos con un color "más claro" mezclando con white.
  const mixed: [number, number, number] = [
    Math.round(color[0] * opacity + 255 * (1 - opacity)),
    Math.round(color[1] * opacity + 255 * (1 - opacity)),
    Math.round(color[2] * opacity + 255 * (1 - opacity)),
  ];
  // Como el fondo no es blanco sino cyan, mezclamos con CYAN/TEAL para que se vea "translúcido".
  // Heurística: si el fondo es cyan/teal, oscurecemos ligeramente.
  const tri = w / 3.4;
  doc.setFillColor(mixed[0], mixed[1], mixed[2]);
  // Tri 1
  doc.triangle(x, y + h, x + tri, y, x + tri, y + h, 'F');
  // Tri 2 (más opaco)
  doc.setFillColor(
    Math.round(color[0] * (opacity + 0.15) + 255 * (1 - (opacity + 0.15))),
    Math.round(color[1] * (opacity + 0.15) + 255 * (1 - (opacity + 0.15))),
    Math.round(color[2] * (opacity + 0.15) + 255 * (1 - (opacity + 0.15))),
  );
  doc.triangle(x + tri + 2, y + h, x + tri * 2 + 2, y, x + tri * 2 + 2, y + h, 'F');
  // Tri 3 (más opaco)
  doc.setFillColor(
    Math.round(color[0] * (opacity + 0.3) + 255 * (1 - (opacity + 0.3))),
    Math.round(color[1] * (opacity + 0.3) + 255 * (1 - (opacity + 0.3))),
    Math.round(color[2] * (opacity + 0.3) + 255 * (1 - (opacity + 0.3))),
  );
  doc.triangle(x + tri * 2 + 4, y + h, x + tri * 3 + 4, y, x + tri * 3 + 4, y + h, 'F');
}

// Patrón de puntos sutil (grid 5×3) para textura.
function drawDotPattern(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  color: [number, number, number],
  opacity: number,
) {
  const mixed: [number, number, number] = [
    Math.round(color[0] * opacity + 0 * (1 - opacity)),
    Math.round(color[1] * opacity + 0 * (1 - opacity)),
    Math.round(color[2] * opacity + 0 * (1 - opacity)),
  ];
  doc.setFillColor(mixed[0], mixed[1], mixed[2]);
  const cols = 16;
  const rows = 4;
  const stepX = w / cols;
  const stepY = h / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      doc.circle(x + i * stepX, y + j * stepY, 0.28, 'F');
    }
  }
}
