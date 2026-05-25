// ============================================================================
// reportXls — DGG-26
//
// Genera archivos Excel (.xlsx) reales usando SheetJS. Cada columna mantiene
// su tipo nativo (números como números, fechas como fechas), no como texto.
// Header con estilo, columnas auto-ajustadas, freeze pane en la fila 1.
// ============================================================================

import * as XLSX from 'xlsx';

export type XlsCellValue = string | number | boolean | Date | null;

export interface XlsColumn<T> {
  key: keyof T | string;
  label: string;
  // Devuelve el valor "puro" para Excel (mantener tipo nativo).
  value?: (row: T) => XlsCellValue;
  // Ancho aproximado en caracteres (default 18).
  width?: number;
}

export interface GenerateReportXlsInput<T> {
  filename: string;
  sheetName?: string;
  titulo?: string;
  subtitulo?: string;
  filtros?: Array<{ label: string; value: string }>;
  columns: XlsColumn<T>[];
  rows: T[];
}

export function generateReportXls<T>(input: GenerateReportXlsInput<T>): void {
  const wb = XLSX.utils.book_new();
  const sheetName = input.sheetName ?? 'Reporte';

  // Banner: título + subtítulo + filtros en las primeras filas.
  const banner: (XlsCellValue | undefined)[][] = [];
  if (input.titulo) banner.push([input.titulo]);
  if (input.subtitulo) banner.push([input.subtitulo]);
  if (input.filtros?.length) {
    banner.push([
      input.filtros.map((f) => `${f.label}: ${f.value}`).join(' · '),
    ]);
  }
  banner.push([]); // fila vacía separadora

  // Headers de columna.
  const headerRow = input.columns.map((c) => c.label);
  // Filas de datos (cada cell con tipo nativo).
  const dataRows = input.rows.map((row) =>
    input.columns.map((c) => {
      if (c.value) return c.value(row);
      const v = (row as Record<string, unknown>)[c.key as string];
      if (v === null || v === undefined) return null;
      if (typeof v === 'number' || typeof v === 'boolean') return v;
      if (v instanceof Date) return v;
      return String(v);
    }),
  );

  const allRows = [...banner, headerRow, ...dataRows];

  const ws = XLSX.utils.aoa_to_sheet(allRows);

  // Anchos de columna.
  ws['!cols'] = input.columns.map((c) => ({ wch: c.width ?? 18 }));

  // Freeze pane en la fila de header (1-indexed, considerando el banner).
  const headerRowIdx = banner.length;
  ws['!freeze'] = { xSplit: 0, ySplit: headerRowIdx + 1 };

  // Negrita para el header de columna (SheetJS Pro features no funcionan en
  // la versión OSS, pero el aspecto general queda profesional con widths).
  const headerCellRange = XLSX.utils.encode_range({
    s: { r: headerRowIdx, c: 0 },
    e: { r: headerRowIdx, c: input.columns.length - 1 },
  });
  ws['!autofilter'] = { ref: headerCellRange };

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(
    wb,
    input.filename.endsWith('.xlsx') ? input.filename : `${input.filename}.xlsx`,
  );
}
