import jsPDF from 'jspdf';
import {
  CYAN, INK, MUTED, SOFT,
  loadLogoNegativo, drawCover, drawWatermarkTriangles,
  renderFooterAllPages, drawKpiCard, drawPaginatedTable,
  formatMoney, formatDateShort, sanitize,
  type TableColumn,
} from './_helpers';

// ============================================================================
// Reporte PDF · Extracto de cuenta corriente por administración.
// Concatena emisiones (comprobantes) y pagos (movimientos imputados) ordenados
// por fecha, con saldo corrido.
// ============================================================================

export interface CtaCteMovimiento {
  fecha: string;
  concepto: string;
  referencia?: string | null;
  debe: number;      // emite comprobante → aumenta deuda
  haber: number;     // pago / NC → reduce deuda
}

export interface CtaCteCliente {
  nombre: string;
  cuit?: string | null;
  domicilio?: string | null;
  email?: string | null;
}

export interface CtaCteReporteArgs {
  cliente: CtaCteCliente;
  movimientos: CtaCteMovimiento[]; // ya ordenados por fecha ascendente
  saldoInicial?: number;
  desde?: string;
  hasta?: string;
}

export async function generateCtaCteReportePdf(
  args: CtaCteReporteArgs,
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
    : 'Histórico completo';

  let y = drawCover(doc, pageW, {
    kicker: 'Cuenta corriente',
    titulo: sanitize(args.cliente.nombre),
    subtitulo: periodo,
    logo,
  });

  // Datos cliente
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...CYAN);
  doc.text('CLIENTE', margin, y, { charSpace: 1.5 });
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...INK);
  doc.text(sanitize(args.cliente.nombre), margin, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const partes: string[] = [];
  if (args.cliente.cuit) partes.push(`CUIT ${args.cliente.cuit}`);
  if (args.cliente.email) partes.push(args.cliente.email);
  if (args.cliente.domicilio) partes.push(sanitize(args.cliente.domicilio));
  if (partes.length > 0) { doc.text(partes.join('  ·  '), margin, y); y += 5; }
  y += 4;

  // KPIs: total deuda / total cobrado / saldo
  const totalDebe = args.movimientos.reduce((a, m) => a + Number(m.debe ?? 0), 0);
  const totalHaber = args.movimientos.reduce((a, m) => a + Number(m.haber ?? 0), 0);
  const saldoFinal = Number(args.saldoInicial ?? 0) + totalDebe - totalHaber;

  const kpiH = 22;
  const gap = 4;
  const kpiW = (innerW - gap * 2) / 3;
  drawKpiCard(doc, margin, y, kpiW, kpiH, 'Total facturado', formatMoney(totalDebe), 'cyan');
  drawKpiCard(doc, margin + (kpiW + gap), y, kpiW, kpiH, 'Total cobrado', formatMoney(totalHaber), 'teal');
  drawKpiCard(doc, margin + (kpiW + gap) * 2, y, kpiW, kpiH, 'Saldo final', formatMoney(saldoFinal), saldoFinal > 0 ? 'cyan' : 'ink');
  y += kpiH + 10;

  // Tabla movimientos con saldo corrido
  let saldo = Number(args.saldoInicial ?? 0);
  const rowsConSaldo = args.movimientos.map((m) => {
    saldo += Number(m.debe ?? 0) - Number(m.haber ?? 0);
    return { ...m, saldo };
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...CYAN);
  doc.text('MOVIMIENTOS', margin, y, { charSpace: 1.5 });
  y += 5;

  const columns: TableColumn<typeof rowsConSaldo[number]>[] = [
    { header: 'Fecha', width: 22, render: (r) => formatDateShort(r.fecha) },
    { header: 'Concepto', width: 84, render: (r) => sanitize(r.concepto) },
    { header: 'Ref.', width: 28, render: (r) => sanitize(r.referencia ?? '') },
    { header: 'Debe', width: 22, align: 'right', render: (r) => r.debe ? formatMoney(r.debe) : '—' },
    { header: 'Haber', width: 22, align: 'right', render: (r) => r.haber ? formatMoney(r.haber) : '—' },
    { header: 'Saldo', width: 26, align: 'right', bold: true, render: (r) => formatMoney(r.saldo) },
  ];

  drawPaginatedTable(doc, {
    columns,
    rows: rowsConSaldo,
    startX: margin,
    startY: y,
    pageW, pageH,
    bottomMargin: 22,
    onNewPage: () => {
      drawWatermarkTriangles(doc, pageW, pageH);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...INK);
      doc.text(`Cta. cte. · ${sanitize(args.cliente.nombre)} (cont.)`, margin, 16);
      doc.setDrawColor(...SOFT);
      doc.setLineWidth(0.2);
      doc.line(margin, 18, pageW - margin, 18);
      return 22;
    },
  });

  renderFooterAllPages(doc, pageW, pageH);
  return doc;
}
