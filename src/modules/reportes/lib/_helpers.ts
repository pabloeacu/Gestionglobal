import jsPDF from 'jspdf';

// ============================================================================
// Helpers compartidos para los reportes PDF brand-perfect.
// Replica la paleta y los helpers de generateComprobantePdf.ts para coherencia
// visual entre piezas (regla 8: español domain, inglés tech).
// ============================================================================

export const CYAN: [number, number, number] = [0, 158, 202];
export const CYAN_PALE: [number, number, number] = [229, 246, 252];
export const CYAN_MIST: [number, number, number] = [242, 250, 253];
export const TEAL: [number, number, number] = [22, 160, 162];
export const INK: [number, number, number] = [13, 30, 47];
export const MUTED: [number, number, number] = [100, 116, 139];
export const SOFT: [number, number, number] = [203, 213, 225];
export const ZEBRA: [number, number, number] = [248, 250, 252];
export const WHITE: [number, number, number] = [255, 255, 255];

// ----------------------------------------------------------------------------
// Logo cacheado (negativo blanco para cover cyan). Trim del whitespace
// transparente reusando la lógica del comprobante (line-by-line E40).
// ----------------------------------------------------------------------------
export interface LogoAsset {
  dataUrl: string;
  aspect: number;
}
let cachedLogo: LogoAsset | null | undefined;

export async function loadLogoNegativo(): Promise<LogoAsset | null> {
  if (cachedLogo !== undefined) return cachedLogo;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = '/brand/logo-white.png';
    await img.decode();
    const SCAN = 600;
    const tmp = document.createElement('canvas');
    const sAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
    tmp.width = sAspect >= 1 ? SCAN : Math.round(SCAN * sAspect);
    tmp.height = sAspect >= 1 ? Math.round(SCAN / sAspect) : SCAN;
    const tctx = tmp.getContext('2d');
    if (!tctx) { cachedLogo = null; return null; }
    tctx.drawImage(img, 0, 0, tmp.width, tmp.height);
    const data = tctx.getImageData(0, 0, tmp.width, tmp.height).data;
    let minX = tmp.width, minY = tmp.height, maxX = 0, maxY = 0;
    let found = false;
    for (let y = 0; y < tmp.height; y++) {
      for (let x = 0; x < tmp.width; x++) {
        const alpha = data[(y * tmp.width + x) * 4 + 3] ?? 0;
        if (alpha > 12) {
          found = true;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!found) {
      cachedLogo = { dataUrl: tmp.toDataURL('image/png'), aspect: sAspect };
      return cachedLogo;
    }
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;
    const TARGET = 320;
    const a = cw / ch;
    const ow = a >= 1 ? TARGET : Math.round(TARGET * a);
    const oh = a >= 1 ? Math.round(TARGET / a) : TARGET;
    const out = document.createElement('canvas');
    out.width = ow;
    out.height = oh;
    const octx = out.getContext('2d');
    if (!octx) { cachedLogo = null; return null; }
    octx.drawImage(tmp, minX, minY, cw, ch, 0, 0, ow, oh);
    cachedLogo = { dataUrl: out.toDataURL('image/png'), aspect: a };
    return cachedLogo;
  } catch {
    cachedLogo = null;
    return null;
  }
}

// ----------------------------------------------------------------------------
// Watermark · triángulos brand muy sutiles distribuidos por la página.
// ----------------------------------------------------------------------------
export function drawWatermarkTriangles(
  doc: jsPDF,
  pageW: number,
  pageH: number,
): void {
  doc.setFillColor(...CYAN_MIST);
  const groups: Array<[number, number, number]> = [
    [pageW * 0.78, pageH * 0.30, 0.9],
    [pageW * 0.10, pageH * 0.55, 1.1],
    [pageW * 0.88, pageH * 0.66, 0.7],
    [pageW * 0.45, pageH * 0.82, 0.85],
    [pageW * 0.15, pageH * 0.20, 0.55],
  ];
  for (const [cx, cy, scale] of groups) {
    const s = 14 * scale;
    doc.triangle(cx, cy + s, cx + s, cy, cx + s, cy + s, 'F');
    doc.triangle(cx + s + 2, cy + s, cx + 2 * s + 2, cy, cx + 2 * s + 2, cy + s, 'F');
    doc.triangle(cx + 2 * s + 4, cy + s, cx + 3 * s + 4, cy, cx + 3 * s + 4, cy + s, 'F');
  }
}

// ----------------------------------------------------------------------------
// Cover bipartito cyan/teal con kicker + título + subtítulo.
// Devuelve la coordenada `y` justo debajo del cover para seguir dibujando.
// ----------------------------------------------------------------------------
export interface CoverArgs {
  kicker: string;          // p.ej. "REPORTE"
  titulo: string;          // p.ej. "Comprobantes emitidos"
  subtitulo?: string;      // p.ej. "01/01/2026 – 30/04/2026"
  logo: LogoAsset | null;
}
export function drawCover(
  doc: jsPDF,
  pageW: number,
  args: CoverArgs,
): number {
  const margin = 18;
  const coverH = 44;
  const splitX = pageW * 0.58;

  doc.setFillColor(...CYAN);
  doc.rect(0, 0, splitX, coverH, 'F');
  doc.setFillColor(...TEAL);
  doc.rect(splitX, 0, pageW - splitX, coverH, 'F');

  // Gradient fake en el límite
  for (let i = 0; i < 8; i++) {
    const t = i / 8;
    const r = Math.round(CYAN[0] + (TEAL[0] - CYAN[0]) * t);
    const g = Math.round(CYAN[1] + (TEAL[1] - CYAN[1]) * t);
    const b = Math.round(CYAN[2] + (TEAL[2] - CYAN[2]) * t);
    doc.setFillColor(r, g, b);
    doc.rect(splitX - 8 + i, 0, 1.1, coverH, 'F');
  }

  if (args.logo) {
    const logoH = 22;
    const logoW = logoH * args.logo.aspect;
    doc.addImage(
      args.logo.dataUrl, 'PNG',
      margin, (coverH - logoH) / 2,
      logoW, logoH, undefined, 'FAST',
    );
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...WHITE);
    doc.text('GESTIÓN GLOBAL', margin, coverH / 2);
  }

  const rightCx = splitX + (pageW - splitX) / 2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...WHITE);
  doc.text(args.kicker.toUpperCase(), rightCx, 11, { align: 'center', charSpace: 1.6 });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(args.titulo, rightCx, 22, { align: 'center' });

  if (args.subtitulo) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(args.subtitulo, rightCx, 30, { align: 'center' });
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('GESTIONGLOBAL.AR', rightCx, 39, { align: 'center', charSpace: 1.3 });

  return coverH + 10;
}

// ----------------------------------------------------------------------------
// Footer fino: brand strip + paginado. Llamar al final de cada página.
// ----------------------------------------------------------------------------
export function drawFooterPaginado(
  doc: jsPDF,
  pageW: number,
  pageH: number,
  page: number,
  totalPages: number,
): void {
  const stripY = pageH - 10;
  doc.setFillColor(...CYAN);
  doc.rect(0, stripY, pageW, 4, 'F');
  doc.setFillColor(...TEAL);
  doc.rect(pageW * 0.62, stripY, pageW * 0.38, 4, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...WHITE);
  doc.text(
    `Página ${page} de ${totalPages}  ·  gestionglobal.ar`,
    pageW / 2,
    stripY + 2.7,
    { align: 'center', charSpace: 0.6 },
  );
}

// ----------------------------------------------------------------------------
// Card con acento lateral cyan (reused del comprobante para KPIs y filas).
// ----------------------------------------------------------------------------
export function drawSideAccentCard(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  filled = true,
): void {
  if (filled) {
    doc.setFillColor(252, 253, 254);
    doc.roundedRect(x, y, w, h, 1.5, 1.5, 'F');
  }
  doc.setFillColor(...CYAN);
  doc.rect(x, y, 1.4, h, 'F');
  doc.setDrawColor(...SOFT);
  doc.setLineWidth(0.15);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, 'S');
}

// ----------------------------------------------------------------------------
// KPI card grande con valor + label (resumen ejecutivo).
// ----------------------------------------------------------------------------
export function drawKpiCard(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  accent: 'cyan' | 'teal' | 'ink' = 'cyan',
): void {
  drawSideAccentCard(doc, x, y, w, h);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text(label.toUpperCase(), x + 4, y + 5.5, { charSpace: 0.4 });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  const color = accent === 'cyan' ? CYAN : accent === 'teal' ? TEAL : INK;
  doc.setTextColor(...color);
  doc.text(value, x + 4, y + h - 4);
}

// ----------------------------------------------------------------------------
// Helpers numéricos / fecha (mismo estilo que comprobante PDF).
// ----------------------------------------------------------------------------
export function sanitize(s: string | null | undefined): string {
  return (s ?? '').toString().normalize('NFC');
}

export function formatMoney(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
}

export function formatNum(n: number | null | undefined, decimals = 2): string {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0, maximumFractionDigits: decimals,
  }).format(v);
}

function parseLocalDate(d: string): Date {
  const datePart = d.includes('T') ? d.slice(0, 10) : d;
  const [yy, mm, dd] = datePart.split('-').map(Number);
  return new Date(yy ?? 1970, (mm ?? 1) - 1, dd ?? 1);
}

export function formatDateLong(d: string | null | undefined): string {
  if (!d) return '—';
  return parseLocalDate(d).toLocaleDateString('es-AR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

export function formatDateShort(d: string | null | undefined): string {
  if (!d) return '—';
  return parseLocalDate(d).toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

// ----------------------------------------------------------------------------
// Tabla genérica con paginado automático. Cada llamada agrega filas y
// renderiza paginado/header de nueva página cuando se desborda.
// ----------------------------------------------------------------------------
export interface TableColumn<T> {
  header: string;
  width: number;            // mm
  align?: 'left' | 'right' | 'center';
  render: (row: T) => string;
  bold?: boolean;
}

export interface TableOptions<T> {
  columns: TableColumn<T>[];
  rows: T[];
  startX: number;
  startY: number;
  rowH?: number;
  pageW: number;
  pageH: number;
  bottomMargin?: number;
  onNewPage?: (doc: jsPDF) => number; // devuelve y inicial en la nueva página
}

export function drawPaginatedTable<T>(
  doc: jsPDF,
  opts: TableOptions<T>,
): { lastY: number; pages: number } {
  const {
    columns, rows, startX, pageH,
    bottomMargin = 25,
    rowH = 8,
  } = opts;
  void opts.pageW; // reservado para futuras alineaciones full-width
  let y = opts.startY;
  let pages = 1;

  const drawHeader = (yy: number): number => {
    doc.setFillColor(...CYAN);
    doc.rect(startX, yy, columns.reduce((a, c) => a + c.width, 0), 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...WHITE);
    let cx = startX;
    for (const col of columns) {
      const tx = col.align === 'right'
        ? cx + col.width - 2
        : col.align === 'center'
          ? cx + col.width / 2
          : cx + 2.5;
      doc.text(col.header.toUpperCase(), tx, yy + 4.8, {
        align: col.align ?? 'left',
        charSpace: 0.4,
      });
      cx += col.width;
    }
    return yy + 7;
  };

  y = drawHeader(y);

  rows.forEach((r, idx) => {
    if (y + rowH > pageH - bottomMargin) {
      doc.addPage();
      pages += 1;
      const newY = opts.onNewPage ? opts.onNewPage(doc) : 20;
      y = drawHeader(newY);
    }
    // Zebra striping
    if (idx % 2 === 0) {
      doc.setFillColor(...ZEBRA);
      doc.rect(
        startX, y,
        columns.reduce((a, c) => a + c.width, 0), rowH, 'F',
      );
    }
    let cx = startX;
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    for (const col of columns) {
      doc.setFont('helvetica', col.bold ? 'bold' : 'normal');
      const tx = col.align === 'right'
        ? cx + col.width - 2
        : col.align === 'center'
          ? cx + col.width / 2
          : cx + 2.5;
      const value = col.render(r);
      const truncated = truncateToWidth(doc, value, col.width - 4);
      doc.text(truncated, tx, y + 5.3, { align: col.align ?? 'left' });
      cx += col.width;
    }
    y += rowH;
  });

  return { lastY: y, pages };
}

function truncateToWidth(doc: jsPDF, text: string, maxW: number): string {
  if (doc.getTextWidth(text) <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const candidate = text.slice(0, mid) + '…';
    if (doc.getTextWidth(candidate) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

// ----------------------------------------------------------------------------
// Persiste paginado real una vez conocemos cuántas páginas hubo.
// ----------------------------------------------------------------------------
export function renderFooterAllPages(doc: jsPDF, pageW: number, pageH: number): void {
  // jsPDF v4 expone getNumberOfPages / setPage.
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    drawFooterPaginado(doc, pageW, pageH, i, total);
  }
}

// ----------------------------------------------------------------------------
// Trigger de descarga vía blob (browser).
// ----------------------------------------------------------------------------
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function savePdf(doc: jsPDF, filename: string): void {
  doc.save(filename);
}
