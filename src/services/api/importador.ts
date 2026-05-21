import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';

// ============================================================================
// Service · importador histórico de comprobantes (.xlsx).
// Flujo:
//   1) parsearArchivoXlsx → headers + rows + sugerencias de mapping
//   2) validarFilas       → marca cada fila como ok/error con motivo
//   3) importarLote       → RPC import_comprobantes_batch (gerente)
// ============================================================================

export interface ParsedSheet {
  headers: string[];
  rows: Array<Record<string, unknown>>;
  sugerencias: ColumnMapping;
}

// Mapping: campo del comprobante → header detectado en el Excel.
export interface ColumnMapping {
  fecha: string | null;
  tipo: string | null;
  puntoVenta: string | null;
  numero: string | null;
  receptorRazonSocial: string | null;
  receptorCuit: string | null;
  total: string | null;
  observaciones: string | null;
  administracion: string | null;  // nombre o código del cliente
}

// Heurística: aliases comunes en español/inglés para auto-mapping.
const ALIASES: Record<keyof ColumnMapping, string[]> = {
  fecha: ['fecha', 'date', 'fecha emision', 'fecha de emision', 'emitido'],
  tipo: ['tipo', 'type', 'tipo comprobante', 'tipo de comprobante'],
  puntoVenta: ['punto de venta', 'punto venta', 'pv', 'pto venta'],
  numero: ['numero', 'número', 'nro', 'n°', 'comprobante', 'numero comprobante'],
  receptorRazonSocial: [
    'razon social', 'razón social', 'cliente', 'receptor', 'nombre', 'destinatario',
  ],
  receptorCuit: ['cuit', 'cuil', 'documento', 'dni', 'cuit/cuil', 'cuit cliente'],
  total: ['total', 'importe', 'monto', 'amount', 'importe total'],
  observaciones: ['observaciones', 'obs', 'notas', 'comentarios', 'detalle'],
  administracion: [
    'administracion', 'administración', 'admin', 'razon social administracion',
    'cliente_id', 'administracion_id',
  ],
};

function norm(s: string): string {
  return s.toString().toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_\-./\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function autoSugerir(headers: string[]): ColumnMapping {
  const normalized = headers.map((h) => ({ original: h, norm: norm(h) }));
  const out: ColumnMapping = {
    fecha: null, tipo: null, puntoVenta: null, numero: null,
    receptorRazonSocial: null, receptorCuit: null, total: null,
    observaciones: null, administracion: null,
  };
  (Object.keys(ALIASES) as Array<keyof ColumnMapping>).forEach((k) => {
    for (const alias of ALIASES[k]) {
      const a = norm(alias);
      const match = normalized.find((h) => h.norm === a || h.norm.includes(a));
      if (match) { out[k] = match.original; break; }
    }
  });
  return out;
}

// ----------------------------------------------------------------------------
// parsearArchivoXlsx · lee la primera hoja, devuelve headers + filas + mapping.
// ----------------------------------------------------------------------------
export async function parsearArchivoXlsx(
  file: File,
): Promise<ApiResponse<ParsedSheet>> {
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const firstName = wb.SheetNames[0];
    if (!firstName) return fail('IMP_EMPTY', 'El archivo no tiene hojas');
    const ws = wb.Sheets[firstName];
    if (!ws) return fail('IMP_EMPTY', 'La primera hoja está vacía');

    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: null,
      raw: true,
    });

    if (json.length === 0) {
      return fail('IMP_EMPTY', 'No se encontraron filas de datos');
    }

    const headers = Object.keys(json[0] ?? {});
    return ok({
      headers,
      rows: json,
      sugerencias: autoSugerir(headers),
    });
  } catch (e) {
    return fail('IMP_PARSE', 'No se pudo leer el archivo. Verificá que sea un .xlsx válido.', e);
  }
}

// ----------------------------------------------------------------------------
// validarFilas · convierte cada fila del Excel en un payload listo para el RPC.
// Marca filas inválidas con motivo (no las descarta acá, se acumulan en el
// resultado para que el usuario vea exactamente qué pasó).
// ----------------------------------------------------------------------------
export interface ValidacionFila {
  index: number;                       // 1-based para mostrar al usuario
  ok: boolean;
  motivo?: string;
  payload?: Record<string, unknown>;
  resumen?: string;                    // string display friendly
}

export interface ValidarFilasArgs {
  rows: Array<Record<string, unknown>>;
  mapping: ColumnMapping;
  administracionIdDefault?: string;     // si todas las filas son del mismo cliente
  administracionMap?: Map<string, string>; // nombre/codigo normalizado → uuid
}

const TIPOS_VALIDOS = new Set(['X', 'A', 'B', 'C']);

function parseDate(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number') {
    // Serial Excel
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const ms = v * 86400000;
    const dt = new Date(epoch.getTime() + ms);
    if (Number.isNaN(dt.getTime())) return null;
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (!s) return null;
  // Formatos típicos: dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd
  const m1 = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m1) {
    const [, d, m, y] = m1;
    const yy = (y!.length === 2 ? '20' + y : y)!;
    return `${yy}-${m!.padStart(2,'0')}-${d!.padStart(2,'0')}`;
  }
  const m2 = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (m2) {
    const [, y, m, d] = m2;
    return `${y}-${m!.padStart(2,'0')}-${d!.padStart(2,'0')}`;
  }
  return null;
}

function parseMoney(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  // Quitar símbolo moneda y espacios
  s = s.replace(/\$/g, '').replace(/\s/g, '');
  // ES: coma decimal, miles con punto. Si tiene ambos, asumimos coma = decimal.
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function cleanDoc(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9]/g, '');
  return s || null;
}

export function validarFilas(args: ValidarFilasArgs): ValidacionFila[] {
  const { rows, mapping, administracionIdDefault, administracionMap } = args;
  return rows.map((row, idx) => {
    const get = (key: keyof ColumnMapping): unknown => {
      const header = mapping[key];
      return header ? row[header] : null;
    };

    const errores: string[] = [];

    const fecha = parseDate(get('fecha'));
    if (!fecha) errores.push('Fecha inválida');

    const tipoRaw = (get('tipo') ?? 'X').toString().trim().toUpperCase();
    const tipo = TIPOS_VALIDOS.has(tipoRaw) ? tipoRaw : null;
    if (!tipo) errores.push(`Tipo inválido (${tipoRaw})`);

    const razon = (get('receptorRazonSocial') ?? '').toString().trim();
    if (!razon) errores.push('Razón social vacía');

    const doc = cleanDoc(get('receptorCuit'));
    if (!doc) errores.push('CUIT/DNI inválido');
    else if (doc.length !== 11 && doc.length !== 8 && doc.length !== 7) {
      errores.push('CUIT/DNI no tiene 7/8/11 dígitos');
    }

    const total = parseMoney(get('total'));
    if (total == null || total < 0) errores.push('Importe total inválido');

    const pv = parseMoney(get('puntoVenta')) ?? 1;
    const numero = parseMoney(get('numero'));
    const obs = get('observaciones');

    // Resolver administracion_id
    let administracionId: string | null = administracionIdDefault ?? null;
    if (!administracionId) {
      const adminRaw = (get('administracion') ?? '').toString().trim();
      if (adminRaw && administracionMap) {
        const k = norm(adminRaw);
        administracionId = administracionMap.get(k) ?? null;
      }
    }
    if (!administracionId) errores.push('Administración no resuelta');

    if (errores.length > 0) {
      return {
        index: idx + 1,
        ok: false,
        motivo: errores.join(' · '),
        resumen: `${fecha ?? '?'} · ${tipo ?? '?'} · ${razon || '?'} · $${total ?? '?'}`,
      };
    }

    return {
      index: idx + 1,
      ok: true,
      payload: {
        administracionId,
        fecha,
        tipo,
        puntoVenta: Math.round(pv),
        numero: numero != null ? Math.round(numero) : null,
        receptorRazonSocial: razon,
        receptorCuit: doc,
        total,
        observaciones: obs ? String(obs) : null,
      },
      resumen: `${fecha} · ${tipo} · ${razon} · $${total}`,
    };
  });
}

// ----------------------------------------------------------------------------
// importarLote · RPC al backend.
// ----------------------------------------------------------------------------
export interface ImportResult {
  logId: string;
  total: number;
  insertados: number;
  saltados: number;
  errores: Array<{ fila: number; motivo: string }>;
}

export async function importarLote(
  archivo: string,
  filasValidadas: ValidacionFila[],
): Promise<ApiResponse<ImportResult>> {
  const payload = filasValidadas
    .filter((f) => f.ok && f.payload)
    .map((f) => f.payload!);

  if (payload.length === 0) {
    return fail('IMP_NO_VALIDAS', 'No hay filas válidas para importar');
  }

  // El RPC `import_comprobantes_batch` se creó en la migración 0030; los
  // types regenerados aún no lo incluyen, así que casteamos para invocarlo.
  const rpc = supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc('import_comprobantes_batch', {
    p_archivo: archivo,
    p_filas: payload,
  });
  if (error) return fail('IMP_RPC', error.message, error);
  return ok(data as ImportResult);
}

// ----------------------------------------------------------------------------
// Helpers para resolver administraciones por nombre/código.
// ----------------------------------------------------------------------------
export async function fetchAdministracionesMap(): Promise<
  ApiResponse<Map<string, string>>
> {
  const { data, error } = await supabase
    .from('administraciones')
    .select('id, nombre, codigo, cuit');
  if (error) return fail('IMP_ADMIN_LIST', error.message, error);
  const map = new Map<string, string>();
  type Row = { id: string; nombre: string; codigo: string | null; cuit: string | null };
  ((data ?? []) as unknown as Row[]).forEach((a) => {
    if (a.nombre) map.set(norm(a.nombre), a.id);
    if (a.codigo) map.set(norm(a.codigo), a.id);
    if (a.cuit) map.set(norm(a.cuit), a.id);
  });
  return ok(map);
}
