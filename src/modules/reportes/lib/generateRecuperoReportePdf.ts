import jsPDF from 'jspdf';
import {
  CYAN, INK, MUTED, SOFT,
  loadLogoNegativo, drawCover, drawWatermarkTriangles,
  renderFooterAllPages, drawKpiCard, drawPaginatedTable,
  formatMoney, formatDateShort, sanitize,
  type TableColumn,
} from './_helpers';

// ============================================================================
// Reporte PDF · Acciones de recupero (R1/R2/R3).
// Pensado para cuando el módulo `recupero_acciones` esté online; el caller
// pasa las filas ya armadas (este generador no consulta BD).
// ============================================================================

export interface RecuperoAccionRow {
  fecha: string;
  cliente: string;
  comprobante_ref?: string | null;
  nivel: 'R1' | 'R2' | 'R3' | string;
  monto: number;
  estado: 'pendiente' | 'recuperado' | 'incobrable' | string;
  notas?: string | null;
}

export interface RecuperoReporteArgs {
  desde?: string;
  hasta?: string;
  rows: RecuperoAccionRow[];
}

export async function generateRecuperoReportePdf(
  args: RecuperoReporteArgs,
): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  const innerW = pageW - margin * 2;

  drawWatermarkTriangles(doc, pageW, pageH);

  const logo = await loadLogoNegativo();
  const periodo = args.desde && args.hasta
    ? `${formatDateShort(args.desde)} – ${formatDateShort(args.hasta)}`
    : 'Todos los períodos';

  let y = drawCover(doc, pageW, {
    kicker: 'Recupero',
    titulo: 'Acciones de cobranza',
    subtitulo: periodo,
    logo,
  });

  // KPIs por nivel
  const por = (lvl: string) => args.rows.filter((r) => r.nivel === lvl);
  const sum = (rs: RecuperoAccionRow[]) => rs.reduce((a, r) => a + Number(r.monto ?? 0), 0);
  const recuperado = sum(args.rows.filter((r) => r.estado === 'recuperado'));
  const enRecupero = sum(args.rows.filter((r) => r.estado === 'pendiente'));

  const kpiH = 22;
  const gap = 4;
  const kpiW = (innerW - gap * 4) / 5;
  drawKpiCard(doc, margin, y, kpiW, kpiH, 'R1', String(por('R1').length), 'ink');
  drawKpiCard(doc, margin + (kpiW + gap), y, kpiW, kpiH, 'R2', String(por('R2').length), 'ink');
  drawKpiCard(doc, margin + (kpiW + gap) * 2, y, kpiW, kpiH, 'R3', String(por('R3').length), 'ink');
  drawKpiCard(doc, margin + (kpiW + gap) * 3, y, kpiW, kpiH, 'En recupero', formatMoney(enRecupero), 'cyan');
  drawKpiCard(doc, margin + (kpiW + gap) * 4, y, kpiW, kpiH, 'Recuperado', formatMoney(recuperado), 'teal');
  y += kpiH + 10;

  // Tabla acciones
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...CYAN);
  doc.text('ACCIONES', margin, y, { charSpace: 1.5 });
  y += 5;

  if (args.rows.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text('Sin acciones registradas para los filtros seleccionados.', margin, y + 10);
  } else {
    const columns: TableColumn<RecuperoAccionRow>[] = [
      { header: 'Fecha', width: 22, render: (r) => formatDateShort(r.fecha) },
      { header: 'Cliente', width: 60, render: (r) => sanitize(r.cliente) },
      { header: 'Comp.', width: 28, render: (r) => sanitize(r.comprobante_ref ?? '') },
      { header: 'Nivel', width: 14, align: 'center', bold: true, render: (r) => r.nivel },
      { header: 'Estado', width: 26, align: 'center', render: (r) => r.estado },
      { header: 'Monto', width: 24, align: 'right', bold: true, render: (r) => formatMoney(r.monto) },
    ];

    drawPaginatedTable(doc, {
      columns,
      rows: args.rows,
      startX: margin,
      startY: y,
      pageW, pageH,
      bottomMargin: 22,
      onNewPage: () => {
        drawWatermarkTriangles(doc, pageW, pageH);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...INK);
        doc.text('Recupero · continuación', margin, 16);
        doc.setDrawColor(...SOFT);
        doc.setLineWidth(0.2);
        doc.line(margin, 18, pageW - margin, 18);
        return 22;
      },
    });
  }

  renderFooterAllPages(doc, pageW, pageH);
  return doc;
}
