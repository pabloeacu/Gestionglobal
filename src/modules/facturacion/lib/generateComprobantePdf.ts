import jsPDF from 'jspdf';
import type {
  ComprobanteRow,
  ComprobanteItemRow,
} from '@/services/api/comprobantes';
import { getConfigGlobal, type ConfigGlobal } from '@/services/api/configGlobal';

// Paleta brand (RGB)
const CYAN: [number, number, number] = [0, 158, 202];
const CYAN_PALE: [number, number, number] = [229, 246, 252];
const CYAN_MIST: [number, number, number] = [242, 250, 253];   // watermark
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

// Logo cacheado entre llamadas. Hacemos downsample a 220×220 (mantiene la
// proporción del original 4501×4501) para reducir el peso embebido en el
// PDF de ~174KB → ~6-10KB.
let cachedLogoDataUrl: string | null | undefined;
async function loadLogo(): Promise<string | null> {
  if (cachedLogoDataUrl !== undefined) return cachedLogoDataUrl;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = '/brand/logo-white.png';
    await img.decode();
    const TARGET = 220;
    const canvas = document.createElement('canvas');
    const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
    const w = aspect >= 1 ? TARGET : Math.round(TARGET * aspect);
    const h = aspect >= 1 ? Math.round(TARGET / aspect) : TARGET;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      cachedLogoDataUrl = null;
      return null;
    }
    ctx.drawImage(img, 0, 0, w, h);
    cachedLogoDataUrl = canvas.toDataURL('image/png');
    return cachedLogoDataUrl;
  } catch {
    cachedLogoDataUrl = null;
    return null;
  }
}

// Config global (emisor) cacheada por sesión.
let cachedConfig: ConfigGlobal | null | undefined;
async function loadEmisor(): Promise<ConfigGlobal | null> {
  if (cachedConfig !== undefined) return cachedConfig;
  const res = await getConfigGlobal();
  cachedConfig = res.ok ? res.data : null;
  return cachedConfig;
}

// Decide si este comprobante discrimina IVA.
// Regla: solo facturas A/B con emisor RI muestran IVA discriminado.
// Comprobantes X (simples) NUNCA discriminan; emisor monotributo o exento
// tampoco.
function debeDiscriminarIva(tipo: string, condicionEmisor?: string | null): boolean {
  if (!tipo) return false;
  if (!['A', 'B'].includes(tipo)) return false;
  return condicionEmisor === 'responsable_inscripto';
}

// Genera PDF A4 del comprobante con la marca Gestión Global.
export async function generateComprobantePdf({
  comprobante: c,
  items,
}: Args): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();   // 210
  const pageH = doc.internal.pageSize.getHeight();  // 297
  const margin = 18;
  const innerW = pageW - margin * 2;

  const [logoDataUrl, emisor] = await Promise.all([loadLogo(), loadEmisor()]);
  const discriminaIva = debeDiscriminarIva(c.tipo, emisor?.condicion_iva);

  // ============================================================
  // 0. WATERMARK · Triángulos brand muy sutiles distribuidos por el fondo.
  //    JsPDF no tiene alpha real; usamos un color muy claro (cyan mist).
  // ============================================================
  drawWatermarkTriangles(doc, pageW, pageH);

  // ============================================================
  // 1. COVER bipartito 48mm (la mitad de antes)
  // ============================================================
  const coverH = 48;
  const splitX = pageW * 0.58;

  doc.setFillColor(...CYAN);
  doc.rect(0, 0, splitX, coverH, 'F');

  doc.setFillColor(...TEAL);
  doc.rect(splitX, 0, pageW - splitX, coverH, 'F');

  // Gradient fake en el límite (mezcla cyan→teal en 8 columnas)
  for (let i = 0; i < 8; i++) {
    const t = i / 8;
    const r = Math.round(CYAN[0] + (TEAL[0] - CYAN[0]) * t);
    const g = Math.round(CYAN[1] + (TEAL[1] - CYAN[1]) * t);
    const b = Math.round(CYAN[2] + (TEAL[2] - CYAN[2]) * t);
    doc.setFillColor(r, g, b);
    doc.rect(splitX - 8 + i, 0, 1.1, coverH, 'F');
  }

  // Logo institucional (downsampled a 220px) — alto 28mm
  if (logoDataUrl) {
    const logoH = 28;
    const logoW = logoH; // canvas es cuadrado por construcción
    doc.addImage(logoDataUrl, 'PNG', margin, (coverH - logoH) / 2, logoW, logoH, undefined, 'FAST');
    // Texto wordmark al lado (más sutil ahora que el logo cuadrado se ve bien)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...WHITE);
    doc.text('GESTIÓN GLOBAL', margin + logoW + 4, coverH / 2 - 1);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(220, 240, 245);
    doc.text('ALIADOS DE TU TIEMPO', margin + logoW + 4, coverH / 2 + 4, { charSpace: 0.8 });
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(...WHITE);
    doc.text('GESTIÓN GLOBAL', margin, coverH / 2 - 1);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(220, 240, 245);
    doc.text('ALIADOS DE TU TIEMPO', margin, coverH / 2 + 5, { charSpace: 0.8 });
  }

  // Lado derecho: COMPROBANTE + tipo XL + numero
  const rightCx = splitX + (pageW - splitX) / 2;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...WHITE);
  doc.text('COMPROBANTE', rightCx, 10, { align: 'center', charSpace: 1.6 });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(34);
  doc.setTextColor(...WHITE);
  doc.text(c.tipo, rightCx, coverH / 2 + 4, { align: 'center' });

  const numStr = c.numero
    ? `${String(c.punto_venta).padStart(5, '0')} - ${String(c.numero).padStart(8, '0')}`
    : 'SIN NÚMERO';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...WHITE);
  doc.text(numStr, rightCx, coverH - 8, { align: 'center', charSpace: 0.6 });

  // ============================================================
  // 2. EMISOR (datos impositivos obligatorios)
  // ============================================================
  let y = coverH + 10;
  drawEmisorBlock(doc, emisor, margin, y, innerW);
  y += 22;

  // ============================================================
  // 3. META STRIP — cards modernas con borde lateral cyan
  // ============================================================
  const metaItems = [
    { label: 'Fecha de emisión', value: formatDateLong(c.fecha) },
    { label: 'Periodo', value: formatPeriodo(c.periodo) },
    { label: 'Vencimiento', value: c.vencimiento ? formatDateLong(c.vencimiento) : '—' },
    { label: 'Estado', value: estadoLabel(c.estado), accent: c.estado === 'autorizado' },
  ];
  const gap = 3;
  const cardW = (innerW - gap * (metaItems.length - 1)) / metaItems.length;
  const cardH = 16;
  metaItems.forEach((m, i) => {
    const cx = margin + (cardW + gap) * i;
    drawSideAccentCard(doc, cx, y, cardW, cardH);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text(m.label.toUpperCase(), cx + 4, y + 5, { charSpace: 0.4 });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...(m.accent ? CYAN : INK));
    doc.text(m.value, cx + 4, y + 12);
  });
  y += cardH + 9;

  // ============================================================
  // 4. FACTURAR A — receptor
  // ============================================================
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...CYAN);
  doc.text('FACTURAR A', margin, y, { charSpace: 1.5 });
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  doc.text(sanitize(c.receptor_razon_social), margin, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const docLabel = c.receptor_tipo_documento === 'dni_ficticio'
    ? 'DNI ficticio'
    : c.receptor_tipo_documento.toUpperCase();
  doc.text(
    `${docLabel} ${c.receptor_numero_documento}  ·  ${sanitize(c.receptor_condicion_iva.replaceAll('_', ' '))}`,
    margin, y,
  );
  y += 5;
  if (c.receptor_domicilio) {
    doc.text(sanitize(c.receptor_domicilio), margin, y);
    y += 5;
  }
  y += 6;

  // ============================================================
  // 5. ITEMS — cada uno como card con borde lateral cyan sutil
  // ============================================================
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...CYAN);
  doc.text('DETALLE', margin, y, { charSpace: 1.5 });
  y += 7;

  // Encabezado de columnas dinámico según discriminación de IVA
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  const colCantX  = pageW - margin - (discriminaIva ? 84 : 60);
  const colPrecioX = pageW - margin - (discriminaIva ? 58 : 32);
  const colIvaX    = pageW - margin - 32;
  const colImpX    = pageW - margin;
  doc.text('CONCEPTO', margin + 4, y, { charSpace: 0.4 });
  doc.text('CANT.', colCantX, y, { align: 'right', charSpace: 0.4 });
  doc.text(discriminaIva ? 'P. UNIT.' : 'PRECIO', colPrecioX, y, { align: 'right', charSpace: 0.4 });
  if (discriminaIva) doc.text('IVA', colIvaX, y, { align: 'right', charSpace: 0.4 });
  doc.text('IMPORTE', colImpX, y, { align: 'right', charSpace: 0.4 });
  y += 5;

  items.forEach((it) => {
    const subParts: string[] = [];
    if (Number(it.bonificacion_porc) > 0) {
      subParts.push(`Bonif. ${it.bonificacion_porc}%`);
    }
    // Para X / monotributo: si la alícuota no es 21 (la "default invisible"),
    // mostramos como nota; si es 21 no agregamos ruido visual.
    if (!discriminaIva && it.alicuota_iva === 'exento') subParts.push('Exento');
    else if (!discriminaIva && it.alicuota_iva === 'no_gravado') subParts.push('No gravado');

    const cardH = subParts.length > 0 ? 14 : 10;

    drawSideAccentCard(doc, margin, y, innerW, cardH, true);

    // Descripción
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(...INK);
    doc.text(sanitize(it.descripcion), margin + 4, y + 6.5);

    if (subParts.length > 0) {
      doc.setFontSize(7);
      doc.setTextColor(...MUTED);
      doc.text(subParts.join(' · '), margin + 4, y + 11);
    }

    // Cantidad
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(formatNum(Number(it.cantidad)), colCantX, y + 6.5, { align: 'right' });

    // Precio (neto si discrimina, final si no)
    const precio = Number(it.precio_unitario);
    const subtotalNeto = Number(it.subtotal);
    const ivaItem = Number(it.iva);
    if (discriminaIva) {
      // p_unitario en jspdf representa el neto, IVA discriminado, importe = subtotal + iva
      doc.text(formatMoney(precio), colPrecioX, y + 6.5, { align: 'right' });
      doc.text(formatMoney(ivaItem), colIvaX, y + 6.5, { align: 'right' });
    } else {
      // Mostrar precio FINAL (con IVA incluido) en P. UNIT y el mismo en IMPORTE × cantidad
      const precioFinalUnit = (subtotalNeto + ivaItem) / Math.max(1, Number(it.cantidad));
      doc.text(formatMoney(precioFinalUnit), colPrecioX, y + 6.5, { align: 'right' });
    }

    // Importe total de la línea
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...INK);
    doc.text(formatMoney(Number(it.total)), colImpX, y + 6.5, { align: 'right' });
    doc.setFont('helvetica', 'normal');

    y += cardH + 3;
  });

  y += 6;

  // ============================================================
  // 6. TOTALES — bloque a la derecha
  // ============================================================
  doc.setDrawColor(...SOFT);
  doc.setLineWidth(0.3);
  doc.line(pageW - margin - 70, y, pageW - margin, y);
  y += 7;

  const labelX = pageW - margin - 70;
  const valueX = pageW - margin;

  const subRows: Array<[string, number]> = [];
  if (discriminaIva) {
    if (Number(c.neto) > 0) subRows.push(['Neto gravado', Number(c.neto)]);
    if (Number(c.exento) > 0) subRows.push(['Exento', Number(c.exento)]);
    if (Number(c.no_gravado) > 0) subRows.push(['No gravado', Number(c.no_gravado)]);
    if (Number(c.total_iva) > 0) subRows.push(['IVA', Number(c.total_iva)]);
  }
  // Si no discrimina IVA, los items ya muestran precio final; no mostramos
  // breakdown.

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
  doc.setFillColor(...CYAN);
  doc.rect(totalCardX, y, 1.8, totalCardH, 'F');

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
  // 7. FOOTER fijo (con observaciones encima si caben)
  // ============================================================
  const FOOTER_BLOCK_H = 38;
  const footerY = pageH - FOOTER_BLOCK_H;

  // Observaciones (si caben antes del footer)
  if (c.observaciones) {
    const obsLines = doc.splitTextToSize(sanitize(c.observaciones), innerW - 12);
    const obsH = obsLines.length * 4.5 + 12;
    if (y + obsH + 6 <= footerY) {
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

  // Línea divisora del footer + punto triangular cyan
  doc.setDrawColor(...CYAN);
  doc.setLineWidth(0.4);
  doc.line(margin, footerY, pageW - margin, footerY);
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
  const emailContacto = emisor?.email_contacto || 'contacto@gestionglobal.ar';
  doc.text(
    `Si tenés consultas, escribinos a ${emailContacto}`,
    margin,
    footerY + 20,
  );

  // CAE / fiscal a la derecha
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

  // Brand strip al pie
  const stripY = pageH - 10;
  doc.setFillColor(...CYAN);
  doc.rect(0, stripY, pageW, 4, 'F');
  doc.setFillColor(...TEAL);
  doc.rect(pageW * 0.62, stripY, pageW * 0.38, 4, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...WHITE);
  doc.text(emisor?.sitio_web ?? 'gestionglobal.ar', pageW / 2, stripY + 2.7, { align: 'center', charSpace: 0.6 });

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
// helpers de dibujo
// ============================================================

// Card con accent lateral cyan sutil. Si `filled` = true, también fondo zebra.
function drawSideAccentCard(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  filled = false,
) {
  if (filled) {
    doc.setFillColor(252, 253, 254);
    doc.roundedRect(x, y, w, h, 1.5, 1.5, 'F');
  }
  // Acento lateral cyan
  doc.setFillColor(...CYAN);
  doc.rect(x, y, 1.4, h, 'F');
  // Borde sutil completo
  doc.setDrawColor(...SOFT);
  doc.setLineWidth(0.15);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, 'S');
}

function drawEmisorBlock(
  doc: jsPDF,
  emisor: ConfigGlobal | null,
  x: number,
  y: number,
  w: number,
) {
  const razon = emisor?.razon_social ?? 'Gestión Global';
  const cuit = emisor?.cuit;
  const cond = emisor?.condicion_iva ?? 'responsable_inscripto';
  const dom = emisor?.domicilio_fiscal;
  const loc = [emisor?.localidad, emisor?.provincia, emisor?.codigo_postal]
    .filter(Boolean)
    .join(', ');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...CYAN);
  doc.text('EMISOR', x, y, { charSpace: 1.5 });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(sanitize(razon), x, y + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  const line1Parts: string[] = [];
  line1Parts.push(`CUIT ${cuit ?? '— pendiente —'}`);
  line1Parts.push(`Cond. IVA: ${sanitize(cond.replaceAll('_', ' '))}`);
  doc.text(line1Parts.join('  ·  '), x, y + 10);

  // Línea 2: domicilio
  const line2 = [dom, loc].filter(Boolean).join(' · ');
  if (line2) {
    doc.text(sanitize(line2), x, y + 14.5);
  }

  // Divisor delgado a la derecha (efecto card sin ser un card)
  doc.setDrawColor(...SOFT);
  doc.setLineWidth(0.2);
  doc.line(x, y + 18, x + w, y + 18);
}

// Triángulos en watermark distribuidos por la página, color cyan-mist
// (casi blanco con tinte). JsPDF no tiene alpha real así que simulamos.
function drawWatermarkTriangles(doc: jsPDF, pageW: number, pageH: number) {
  doc.setFillColor(...CYAN_MIST);
  const groups: Array<[number, number, number]> = [
    // x, y, scale
    [pageW * 0.78, pageH * 0.30, 0.9],
    [pageW * 0.10, pageH * 0.55, 1.1],
    [pageW * 0.88, pageH * 0.66, 0.7],
    [pageW * 0.45, pageH * 0.82, 0.85],
    [pageW * 0.15, pageH * 0.20, 0.55],
  ];
  for (const [cx, cy, scale] of groups) {
    const s = 14 * scale;
    // 3 triángulos del mismo grupo
    doc.triangle(cx, cy + s, cx + s, cy, cx + s, cy + s, 'F');
    doc.triangle(cx + s + 2, cy + s, cx + 2 * s + 2, cy, cx + 2 * s + 2, cy + s, 'F');
    doc.triangle(cx + 2 * s + 4, cy + s, cx + 3 * s + 4, cy, cx + 3 * s + 4, cy + s, 'F');
  }
}

// ============================================================
// helpers numéricos / fecha
// ============================================================

function sanitize(s: string): string {
  return s.normalize('NFC');
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

function formatNum(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0, maximumFractionDigits: 2,
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
