// ============================================================================
// csvCopy · utilidad para copiar filas como CSV al portapapeles (P2-#16)
//
// Patrón: la llamás con un array de objetos + un mapping de columnas (orden +
// label + opcional formatter). Devuelve un string CSV serializado y lo copia
// al clipboard. Toasts manejados por quien la llama.
//
// Características:
//   • Quoting RFC 4180 (escape "" y wrap " si hay coma, comilla o salto)
//   • Header opcional (default true)
//   • Separador configurable (default ',' — para Excel ES-AR uso ';')
//   • Skip values null/undefined → ''
//
// Uso típico (top de un listado, junto a ExportButtons):
//
//   const csv = rowsToCsv(filtered, [
//     { key: 'fecha', label: 'Fecha', format: r => fmt(r.fecha) },
//     { key: 'admin', label: 'Cliente', format: r => r.admin_nombre },
//     { key: 'monto', label: 'Total $', format: r => r.total.toFixed(2) },
//   ]);
//   await copyCsvToClipboard(csv);
//   toast.success('Tabla copiada como CSV');
// ============================================================================

export interface CsvColumn<T> {
  key: string;
  label: string;
  format?: (row: T) => string | number | null | undefined;
}

const SAFE_LINE = /[",\n;]/;

function quote(v: string, sep: string): string {
  // Si el valor contiene el separador, comilla o salto, lo encerramos en " y
  // escapamos comillas internas duplicándolas. RFC 4180.
  const needs =
    v.includes(sep) || v.includes('"') || v.includes('\n') || v.includes('\r');
  if (!needs) return v;
  return '"' + v.replace(/"/g, '""') + '"';
}

export interface RowsToCsvOpts {
  /** Separador de campos. Default coma. Usar ';' para Excel-AR. */
  separator?: ',' | ';' | '\t';
  /** Si emite la fila de header. Default true. */
  header?: boolean;
  /** Salto de línea. Default CRLF (compat Excel). */
  newline?: '\n' | '\r\n';
}

export function rowsToCsv<T>(
  rows: T[],
  columns: CsvColumn<T>[],
  opts: RowsToCsvOpts = {},
): string {
  const sep = opts.separator ?? ',';
  const nl = opts.newline ?? '\r\n';
  const lines: string[] = [];

  if (opts.header !== false) {
    lines.push(columns.map((c) => quote(c.label, sep)).join(sep));
  }

  for (const row of rows) {
    const cells: string[] = [];
    for (const c of columns) {
      let raw: unknown;
      if (c.format) {
        raw = c.format(row);
      } else {
        raw = (row as Record<string, unknown>)[c.key];
      }
      const s = raw === null || raw === undefined ? '' : String(raw);
      cells.push(quote(s, sep));
    }
    lines.push(cells.join(sep));
  }

  return lines.join(nl);
}

export async function copyCsvToClipboard(csv: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(csv);
      return true;
    }
    // Fallback antiguo (textarea + execCommand)
    const ta = document.createElement('textarea');
    ta.value = csv;
    ta.style.position = 'fixed';
    ta.style.left = '-99999px';
    document.body.appendChild(ta);
    ta.select();
    // execCommand está deprecado pero sirve de fallback
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** One-shot helper: serializa + copia + devuelve OK. */
export async function copyAsCsv<T>(
  rows: T[],
  columns: CsvColumn<T>[],
  opts?: RowsToCsvOpts,
): Promise<boolean> {
  const csv = rowsToCsv(rows, columns, opts);
  return copyCsvToClipboard(csv);
}

// Re-exporto la regex de detección por si alguien quiere validar manualmente.
export const _CSV_SAFE_LINE = SAFE_LINE;
