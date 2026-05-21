import ExcelJS from 'exceljs';
import {
  applyBrandSheet, workbookToBlob,
  titleStyle, subtitleStyle, moneyStyle, cellStyle, zebraStyle,
} from './_xlsxStyles';

// ============================================================================
// Reporte Excel · Tabulador de servicios (precios base vigentes).
// Multi-hoja: una hoja por categoría (regla 8: español domain, inglés tech —
// hoja "TODAS" como índice global).
// ============================================================================

export interface TabuladorRow {
  codigo: string;
  nombre: string;
  categoria_codigo: string;
  categoria_nombre: string;
  precio_modo: string;          // fijo / por_consorcio / etc
  precio_vigente: number | null;
  unidad?: string | null;
  activo: boolean;
}

export async function generateTabuladorXlsx(rows: TabuladorRow[]): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Gestión Global';
  wb.created = new Date();

  const writeSheet = (
    ws: ExcelJS.Worksheet,
    title: string,
    subtitle: string,
    items: TabuladorRow[],
  ) => {
    ws.mergeCells('A1:F1');
    ws.getCell('A1').value = title;
    ws.getCell('A1').style = titleStyle;
    ws.getRow(1).height = 30;

    ws.mergeCells('A2:F2');
    ws.getCell('A2').value = subtitle;
    ws.getCell('A2').style = subtitleStyle;

    ws.addRow([]);
    ws.addRow(['Código', 'Servicio', 'Categoría', 'Modalidad', 'Unidad', 'Precio vigente']);

    items.forEach((r, idx) => {
      const row = ws.addRow([
        r.codigo,
        r.nombre,
        r.categoria_nombre,
        r.precio_modo,
        r.unidad ?? '',
        r.precio_vigente,
      ]);
      row.getCell(1).style = cellStyle;
      row.getCell(2).style = cellStyle;
      row.getCell(3).style = cellStyle;
      row.getCell(4).style = cellStyle;
      row.getCell(5).style = cellStyle;
      row.getCell(6).style = r.precio_vigente == null
        ? { ...cellStyle, font: { italic: true } }
        : moneyStyle;
      if (idx % 2 === 0) row.eachCell((c) => { c.style = { ...c.style, ...zebraStyle }; });
    });

    applyBrandSheet(ws, {
      headerRow: 4,
      columnWidths: [14, 42, 22, 18, 14, 18],
      freezeAfterHeader: true,
    });
  };

  // Hoja general
  const wsAll = wb.addWorksheet('Todos');
  writeSheet(
    wsAll,
    'Tabulador de servicios',
    `${rows.length} servicios · exportado ${new Date().toLocaleDateString('es-AR')}`,
    rows,
  );

  // Hojas por categoría
  const catMap = new Map<string, { nombre: string; items: TabuladorRow[] }>();
  for (const r of rows) {
    const key = r.categoria_codigo || 'sin_categoria';
    if (!catMap.has(key)) {
      catMap.set(key, { nombre: r.categoria_nombre || 'Sin categoría', items: [] });
    }
    catMap.get(key)!.items.push(r);
  }

  for (const [key, grupo] of catMap) {
    // Excel limita el nombre de hoja a 31 chars y prohíbe ciertos caracteres.
    const safeName = grupo.nombre.replace(/[\\/?*[\]:]/g, '_').slice(0, 31);
    const ws = wb.addWorksheet(safeName || key.slice(0, 31));
    writeSheet(
      ws,
      grupo.nombre,
      `Categoría · ${grupo.items.length} servicios`,
      grupo.items,
    );
  }

  return workbookToBlob(wb);
}
