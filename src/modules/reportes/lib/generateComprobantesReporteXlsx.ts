import ExcelJS from 'exceljs';
import {
  applyBrandSheet, workbookToBlob,
  titleStyle, subtitleStyle, moneyStyle, dateStyle, cellStyle, zebraStyle,
} from './_xlsxStyles';
import type { ComprobanteReporteRow, ComprobantesReporteFilters } from './generateComprobantesReportePdf';

// ============================================================================
// Reporte Excel · Comprobantes.
// Hoja "Comprobantes" con headers en cyan, freeze pane, formato moneda y fecha.
// ============================================================================

export async function generateComprobantesReporteXlsx(
  rows: ComprobanteReporteRow[],
  filters: ComprobantesReporteFilters,
): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Gestión Global';
  wb.created = new Date();

  const ws = wb.addWorksheet('Comprobantes', {
    properties: { defaultRowHeight: 18 },
  });

  // Banner
  ws.mergeCells('A1:G1');
  const titleCell = ws.getCell('A1');
  titleCell.value = 'Comprobantes emitidos · Reporte';
  titleCell.style = titleStyle;
  ws.getRow(1).height = 30;

  ws.mergeCells('A2:G2');
  const subParts: string[] = [];
  if (filters.desde && filters.hasta)
    subParts.push(`Período ${filters.desde} – ${filters.hasta}`);
  if (filters.administracion) subParts.push(`Cliente: ${filters.administracion}`);
  if (filters.tipo && filters.tipo !== 'todos') subParts.push(`Tipo: ${filters.tipo}`);
  if (filters.estado && filters.estado !== 'todos') subParts.push(`Estado: ${filters.estado}`);
  ws.getCell('A2').value = subParts.join('  ·  ') || 'Sin filtros';
  ws.getCell('A2').style = subtitleStyle;

  // Header
  const headers = [
    'Fecha', 'Tipo', 'Número', 'Receptor', 'CUIT/DNI',
    'Estado cobranza', 'Importe',
  ];
  ws.addRow([]); // row 3 separator
  ws.addRow(headers); // row 4

  // Datos
  rows.forEach((r, idx) => {
    const row = ws.addRow([
      r.fecha ? new Date(r.fecha) : null,
      r.tipo,
      r.numero
        ? `${String(r.punto_venta).padStart(5, '0')}-${String(r.numero).padStart(8, '0')}`
        : '—',
      r.receptor_razon_social,
      r.receptor_numero_documento,
      r.estado_cobranza,
      Number(r.total ?? 0),
    ]);
    row.getCell(1).style = dateStyle;
    row.getCell(2).style = { ...cellStyle, alignment: { horizontal: 'center', vertical: 'middle' } };
    row.getCell(3).style = cellStyle;
    row.getCell(4).style = cellStyle;
    row.getCell(5).style = cellStyle;
    row.getCell(6).style = { ...cellStyle, alignment: { horizontal: 'center', vertical: 'middle' } };
    row.getCell(7).style = moneyStyle;
    if (idx % 2 === 0) {
      row.eachCell((c) => { c.style = { ...c.style, ...zebraStyle }; });
    }
  });

  // Total
  const totalRow = ws.addRow([
    null, null, null, null, null, 'TOTAL',
    rows.reduce((a, r) => a + Number(r.total ?? 0), 0),
  ]);
  totalRow.font = { bold: true };
  totalRow.getCell(7).style = { ...moneyStyle, font: { bold: true } };

  applyBrandSheet(ws, {
    headerRow: 4,
    columnWidths: [13, 8, 22, 42, 16, 18, 16],
    freezeAfterHeader: true,
  });

  return workbookToBlob(wb);
}
