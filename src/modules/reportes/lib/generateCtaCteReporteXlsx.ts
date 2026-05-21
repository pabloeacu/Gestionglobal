import ExcelJS from 'exceljs';
import {
  applyBrandSheet, workbookToBlob,
  titleStyle, subtitleStyle, moneyStyle, dateStyle, cellStyle, zebraStyle,
} from './_xlsxStyles';
import type { CtaCteReporteArgs } from './generateCtaCteReportePdf';

// ============================================================================
// Reporte Excel · Cuenta corriente por cliente, con saldo corrido.
// ============================================================================

export async function generateCtaCteReporteXlsx(
  args: CtaCteReporteArgs,
): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Gestión Global';
  wb.created = new Date();

  const ws = wb.addWorksheet('Cuenta corriente');

  ws.mergeCells('A1:F1');
  ws.getCell('A1').value = `Cuenta corriente · ${args.cliente.nombre}`;
  ws.getCell('A1').style = titleStyle;
  ws.getRow(1).height = 30;

  ws.mergeCells('A2:F2');
  const subParts: string[] = [];
  if (args.cliente.cuit) subParts.push(`CUIT ${args.cliente.cuit}`);
  if (args.cliente.email) subParts.push(args.cliente.email);
  if (args.desde && args.hasta) subParts.push(`Período ${args.desde} – ${args.hasta}`);
  ws.getCell('A2').value = subParts.join('  ·  ') || 'Histórico completo';
  ws.getCell('A2').style = subtitleStyle;

  ws.addRow([]); // row 3

  // Header
  ws.addRow(['Fecha', 'Concepto', 'Referencia', 'Debe', 'Haber', 'Saldo']); // row 4

  let saldo = Number(args.saldoInicial ?? 0);
  if (args.saldoInicial && args.saldoInicial !== 0) {
    const row = ws.addRow([null, 'Saldo inicial', null, null, null, saldo]);
    row.getCell(2).style = { ...cellStyle, font: { italic: true } };
    row.getCell(6).style = { ...moneyStyle, font: { bold: true } };
  }

  args.movimientos.forEach((m, idx) => {
    saldo += Number(m.debe ?? 0) - Number(m.haber ?? 0);
    const row = ws.addRow([
      m.fecha ? new Date(m.fecha) : null,
      m.concepto,
      m.referencia ?? '',
      m.debe ? Number(m.debe) : null,
      m.haber ? Number(m.haber) : null,
      saldo,
    ]);
    row.getCell(1).style = dateStyle;
    row.getCell(2).style = cellStyle;
    row.getCell(3).style = cellStyle;
    row.getCell(4).style = moneyStyle;
    row.getCell(5).style = moneyStyle;
    row.getCell(6).style = { ...moneyStyle, font: { bold: true } };
    if (idx % 2 === 0) row.eachCell((c) => { c.style = { ...c.style, ...zebraStyle }; });
  });

  // Totales
  const totalDebe = args.movimientos.reduce((a, m) => a + Number(m.debe ?? 0), 0);
  const totalHaber = args.movimientos.reduce((a, m) => a + Number(m.haber ?? 0), 0);
  const totRow = ws.addRow([null, null, 'TOTAL', totalDebe, totalHaber, saldo]);
  totRow.font = { bold: true };
  totRow.getCell(4).style = { ...moneyStyle, font: { bold: true } };
  totRow.getCell(5).style = { ...moneyStyle, font: { bold: true } };
  totRow.getCell(6).style = { ...moneyStyle, font: { bold: true } };

  applyBrandSheet(ws, {
    headerRow: 4,
    columnWidths: [13, 50, 18, 16, 16, 18],
    freezeAfterHeader: true,
  });

  return workbookToBlob(wb);
}
