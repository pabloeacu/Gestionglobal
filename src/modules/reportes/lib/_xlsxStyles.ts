import type { Style, Fill, Border, Worksheet } from 'exceljs';

// ============================================================================
// Estilos brand reusables para todos los .xlsx generados.
// Paleta idéntica al PDF para coherencia visual entre piezas.
// ============================================================================

// Hex codes (sin alpha) — exceljs usa ARGB.
const CYAN_HEX = 'FF009ECA';
const CYAN_PALE_HEX = 'FFE5F6FC';
const TEAL_HEX = 'FF16A0A2';
const INK_HEX = 'FF0D1E2F';
const MUTED_HEX = 'FF64748B';
const SOFT_HEX = 'FFCBD5E1';
const WHITE_HEX = 'FFFFFFFF';

export const BRAND = {
  CYAN_HEX, CYAN_PALE_HEX, TEAL_HEX, INK_HEX,
  MUTED_HEX, SOFT_HEX, WHITE_HEX,
};

const thinBorder: Border = { style: 'thin', color: { argb: SOFT_HEX } };

export const headerStyle: Partial<Style> = {
  font: { name: 'Calibri', size: 11, bold: true, color: { argb: WHITE_HEX } },
  alignment: { vertical: 'middle', horizontal: 'left', wrapText: false },
  fill: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: CYAN_HEX },
  } as Fill,
  border: {
    top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder,
  },
};

export const titleStyle: Partial<Style> = {
  font: { name: 'Calibri', size: 18, bold: true, color: { argb: INK_HEX } },
  alignment: { vertical: 'middle', horizontal: 'left' },
};

export const subtitleStyle: Partial<Style> = {
  font: { name: 'Calibri', size: 10, italic: true, color: { argb: MUTED_HEX } },
};

export const cellStyle: Partial<Style> = {
  font: { name: 'Calibri', size: 10, color: { argb: INK_HEX } },
  alignment: { vertical: 'middle', horizontal: 'left' },
  border: {
    top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder,
  },
};

export const moneyStyle: Partial<Style> = {
  ...cellStyle,
  alignment: { vertical: 'middle', horizontal: 'right' },
  numFmt: '"$" #,##0.00',
};

export const dateStyle: Partial<Style> = {
  ...cellStyle,
  numFmt: 'dd/mm/yyyy',
  alignment: { vertical: 'middle', horizontal: 'center' },
};

export const numberStyle: Partial<Style> = {
  ...cellStyle,
  alignment: { vertical: 'middle', horizontal: 'right' },
  numFmt: '#,##0',
};

export const zebraStyle: Partial<Style> = {
  fill: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF8FAFC' },
  } as Fill,
};

// ----------------------------------------------------------------------------
// Aplica estilos brand a una hoja típica: header row coloreado + freeze + auto
// width estimado. `dataRowStart` indica desde dónde se aplican zebra y bordes.
// ----------------------------------------------------------------------------
export function applyBrandSheet(
  ws: Worksheet,
  opts: {
    headerRow: number;
    columnWidths?: number[];
    freezeAfterHeader?: boolean;
  },
): void {
  // Color header
  const header = ws.getRow(opts.headerRow);
  header.eachCell((cell) => {
    cell.style = headerStyle;
  });
  header.height = 22;

  // Freeze pane después del header
  if (opts.freezeAfterHeader !== false) {
    ws.views = [{ state: 'frozen', ySplit: opts.headerRow }];
  }

  // Anchos
  if (opts.columnWidths) {
    opts.columnWidths.forEach((w, i) => {
      const col = ws.getColumn(i + 1);
      col.width = w;
    });
  }
}

// ----------------------------------------------------------------------------
// Download buffer como xlsx (browser).
// ----------------------------------------------------------------------------
export async function workbookToBlob(
  wb: import('exceljs').Workbook,
): Promise<Blob> {
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
