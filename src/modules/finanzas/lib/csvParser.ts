import Papa from 'papaparse';
import type { HistoricoLineaInput } from '@/services/api/finanzas';

// DGG-22 · Formato propio del usuario (universal sin importar el banco).
// Columnas esperadas (case-insensitive, flexible orden):
//   fecha, descripcion, ingreso, egreso, observaciones, saldo
// Tolerante a:
//   - separador `,` o `;` (auto-detect papaparse)
//   - "ingreso" y "egreso" en columnas separadas O un solo "monto" con signo
//     (positivo = ingreso, negativo = egreso)
//   - fecha en DD/MM/YYYY o YYYY-MM-DD
//   - montos con separador de miles "." y decimal "," o al revés

export interface ParseResult {
  ok: boolean;
  lineas: HistoricoLineaInput[];
  errores: string[];
  totalFilas: number;
  headers: string[];
}

const HEADER_ALIASES: Record<string, string[]> = {
  fecha: ['fecha', 'fecha operación', 'fecha operacion', 'fecha mov.', 'date'],
  descripcion: ['descripcion', 'descripción', 'concepto', 'detalle', 'description'],
  ingreso: ['ingreso', 'ingresos', 'haber', 'credito', 'crédito', 'depósito', 'deposito'],
  egreso: ['egreso', 'egresos', 'debe', 'debito', 'débito', 'retiro'],
  monto: ['monto', 'importe', 'amount'],
  observaciones: ['observaciones', 'observacion', 'observación', 'notas', 'comentarios'],
  saldo: ['saldo', 'balance', 'saldo posterior'],
};

function normHeader(h: string): string {
  return h.toLowerCase().trim().replace(/[áéíóúñ]/g, (c) => ({ á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ñ: 'n' }[c] ?? c));
}

function findKey(headers: string[], aliases: string[]): string | null {
  for (const h of headers) {
    const n = normHeader(h);
    for (const a of aliases) {
      const an = normHeader(a);
      if (n === an || n.includes(an)) return h;
    }
  }
  return null;
}

function parseMonto(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return 0;
  let s = String(raw).trim();
  if (!s) return 0;
  // remover símbolos de moneda
  s = s.replace(/[$€\s]/g, '');
  // detectar formato AR (1.234,56) vs US (1,234.56)
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    // El último separador es el decimal
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      // formato AR: 1.234,56
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // formato US: 1,234.56
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    // solo coma: asumir decimal AR
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function parseFecha(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch && isoMatch[1] && isoMatch[2] && isoMatch[3]) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }
  // DD/MM/YYYY o DD-MM-YYYY
  const dmyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (dmyMatch && dmyMatch[1] && dmyMatch[2] && dmyMatch[3]) {
    const yyyy = dmyMatch[3].length === 2 ? `20${dmyMatch[3]}` : dmyMatch[3];
    return `${yyyy}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }
  // Date object via JS
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    return dt.toISOString().slice(0, 10);
  }
  return null;
}

export function parseCsvExtracto(text: string): ParseResult {
  const result: ParseResult = {
    ok: false, lineas: [], errores: [], totalFilas: 0, headers: [],
  };
  if (!text.trim()) {
    result.errores.push('El archivo está vacío.');
    return result;
  }

  // Detectar separador automáticamente (papaparse hace eso bien si delimiter=undefined)
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
  });

  if (parsed.errors && parsed.errors.length > 0) {
    parsed.errors.slice(0, 3).forEach((e) => result.errores.push(`Línea ${e.row}: ${e.message}`));
  }

  const rows = parsed.data;
  result.totalFilas = rows.length;
  result.headers = parsed.meta.fields ?? [];

  if (rows.length === 0) {
    result.errores.push('El archivo no tiene filas con datos.');
    return result;
  }

  const headers = result.headers;
  const keyFecha = findKey(headers, HEADER_ALIASES.fecha!);
  const keyDesc = findKey(headers, HEADER_ALIASES.descripcion!);
  const keyIngreso = findKey(headers, HEADER_ALIASES.ingreso!);
  const keyEgreso = findKey(headers, HEADER_ALIASES.egreso!);
  const keyMonto = findKey(headers, HEADER_ALIASES.monto!);
  const keyObs = findKey(headers, HEADER_ALIASES.observaciones!);
  const keySaldo = findKey(headers, HEADER_ALIASES.saldo!);

  if (!keyFecha) result.errores.push('Falta columna "Fecha".');
  if (!keyDesc) result.errores.push('Falta columna "Descripción".');
  if (!keyIngreso && !keyEgreso && !keyMonto) {
    result.errores.push('Falta columna "Ingreso"/"Egreso" o "Monto".');
  }
  if (result.errores.length > 0) return result;

  rows.forEach((row, idx) => {
    const fechaRaw = keyFecha ? row[keyFecha] : null;
    const fecha = parseFecha(fechaRaw);
    if (!fecha) {
      // saltar saldos iniciales / filas sin fecha sin error
      return;
    }

    const descripcion = String((keyDesc ? row[keyDesc] : '') ?? '').trim();
    if (!descripcion) return;

    let ingreso = 0;
    let egreso = 0;
    if (keyIngreso || keyEgreso) {
      ingreso = keyIngreso ? Math.abs(parseMonto(row[keyIngreso])) : 0;
      egreso = keyEgreso ? Math.abs(parseMonto(row[keyEgreso])) : 0;
    } else if (keyMonto) {
      const m = parseMonto(row[keyMonto]);
      if (m > 0) ingreso = m;
      else if (m < 0) egreso = Math.abs(m);
    }
    if (ingreso === 0 && egreso === 0) return; // saltar líneas con monto 0 (ej. headers de saldo)

    const observaciones = keyObs ? String(row[keyObs] ?? '').trim() || null : null;
    const saldo = keySaldo ? parseMonto(row[keySaldo]) : null;

    result.lineas.push({
      fecha,
      descripcion,
      ingreso,
      egreso,
      observaciones,
      saldo: saldo !== null && saldo !== 0 ? saldo : null,
    });
    // idx solo se usa para reportar errores; no necesario referenciar
    void idx;
  });

  result.ok = result.lineas.length > 0;
  if (result.lineas.length === 0 && result.errores.length === 0) {
    result.errores.push('No se encontraron líneas válidas con fecha + descripción + monto.');
  }
  return result;
}

// Plantilla CSV descargable
export const PLANTILLA_CSV = `fecha,descripcion,ingreso,egreso,observaciones,saldo
2026-05-01,Transferencia recibida de Juan Pérez,150000,,Ref 123456,150000
2026-05-02,Pago servicios,,5500,Edesur,144500
2026-05-03,Honorarios mes 5,80000,,,224500
`;

export function descargarPlantilla(): void {
  const blob = new Blob([PLANTILLA_CSV], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plantilla-extracto-bancario.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
