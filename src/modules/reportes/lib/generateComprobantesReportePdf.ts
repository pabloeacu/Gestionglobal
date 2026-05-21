import jsPDF from 'jspdf';
import {
  CYAN, INK, MUTED, SOFT,
  loadLogoNegativo, drawCover, drawWatermarkTriangles,
  renderFooterAllPages, drawKpiCard, drawPaginatedTable,
  formatMoney, formatDateShort, sanitize,
  type TableColumn,
} from './_helpers';

// ============================================================================
// Reporte PDF · Comprobantes emitidos.
// Reusa la estética brand del comprobante: cover bipartito + watermark +
// cards de KPIs + tabla con header cyan.
// ============================================================================

export interface ComprobanteReporteRow {
  fecha: string;
  tipo: string;
  punto_venta: number;
  numero: number | null;
  receptor_razon_social: string;
  receptor_numero_documento: string;
  total: number;
  saldo_pendiente: number;
  estado: string;
  estado_cobranza: string;
  administracion_nombre?: string;
}

export interface ComprobantesReporteFilters {
  desde?: string;       // YYYY-MM-DD
  hasta?: string;       // YYYY-MM-DD
  administracion?: string;  // nombre legible
  estado?: string;
  tipo?: string;
}

export async function generateComprobantesReportePdf(
  rows: ComprobanteReporteRow[],
  filters: ComprobantesReporteFilters,
): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  const innerW = pageW - margin * 2;

  drawWatermarkTriangles(doc, pageW, pageH);

  const logo = await loadLogoNegativo();
  const periodo = filters.desde && filters.hasta
    ? `${formatDateShort(filters.desde)} – ${formatDateShort(filters.hasta)}`
    : filters.desde
      ? `Desde ${formatDateShort(filters.desde)}`
      : filters.hasta
        ? `Hasta ${formatDateShort(filters.hasta)}`
        : 'Todos los períodos';

  let y = drawCover(doc, pageW, {
    kicker: 'Reporte',
    titulo: 'Comprobantes emitidos',
    subtitulo: periodo,
    logo,
  });

  // Filtros (chips informativos)
  const filtroChips: string[] = [];
  if (filters.administracion) filtroChips.push(`Cliente: ${filters.administracion}`);
  if (filters.tipo && filters.tipo !== 'todos') filtroChips.push(`Tipo: ${filters.tipo}`);
  if (filters.estado && filters.estado !== 'todos') filtroChips.push(`Estado: ${filters.estado}`);
  if (filtroChips.length > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(filtroChips.join('  ·  '), margin, y);
    y += 6;
  }

  // KPIs ejecutivos
  const facturado = rows.reduce((a, r) => a + Number(r.total ?? 0), 0);
  const pendiente = rows.reduce((a, r) => a + Number(r.saldo_pendiente ?? 0), 0);
  const cobrado = facturado - pendiente;
  const cantidad = rows.length;

  const kpiH = 22;
  const gap = 4;
  const kpiW = (innerW - gap * 3) / 4;
  drawKpiCard(doc, margin, y, kpiW, kpiH, 'Comprobantes', String(cantidad), 'ink');
  drawKpiCard(doc, margin + (kpiW + gap), y, kpiW, kpiH, 'Facturado', formatMoney(facturado), 'cyan');
  drawKpiCard(doc, margin + (kpiW + gap) * 2, y, kpiW, kpiH, 'Cobrado', formatMoney(cobrado), 'teal');
  drawKpiCard(doc, margin + (kpiW + gap) * 3, y, kpiW, kpiH, 'Pendiente', formatMoney(pendiente), 'cyan');
  y += kpiH + 10;

  // Sección detalle
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...CYAN);
  doc.text('DETALLE', margin, y, { charSpace: 1.5 });
  y += 5;

  const columns: TableColumn<ComprobanteReporteRow>[] = [
    { header: 'Fecha', width: 22, render: (r) => formatDateShort(r.fecha) },
    { header: 'Tipo', width: 12, align: 'center', render: (r) => r.tipo },
    { header: 'Número', width: 26, render: (r) => r.numero
        ? `${String(r.punto_venta).padStart(5,'0')}-${String(r.numero).padStart(8,'0')}`
        : '— sin nº —' },
    { header: 'Receptor', width: 58, render: (r) => sanitize(r.receptor_razon_social) },
    { header: 'CUIT/DNI', width: 24, render: (r) => r.receptor_numero_documento ?? '' },
    { header: 'Estado', width: 18, align: 'center', render: (r) => r.estado_cobranza },
    { header: 'Importe', width: 24, align: 'right', bold: true, render: (r) => formatMoney(r.total) },
  ];

  drawPaginatedTable(doc, {
    columns,
    rows,
    startX: margin,
    startY: y,
    pageW, pageH,
    bottomMargin: 22,
    onNewPage: () => {
      drawWatermarkTriangles(doc, pageW, pageH);
      // título mini en cada página interior
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...INK);
      doc.text('Comprobantes emitidos · continuación', margin, 16);
      doc.setDrawColor(...SOFT);
      doc.setLineWidth(0.2);
      doc.line(margin, 18, pageW - margin, 18);
      return 22;
    },
  });

  renderFooterAllPages(doc, pageW, pageH);
  return doc;
}
