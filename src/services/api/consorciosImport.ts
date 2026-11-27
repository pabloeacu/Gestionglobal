import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Json } from '@/types/database';

// ============================================================================
// Service · importador de consorcios desde .xlsx (DGG-275 F0).
// Flujo:
//   1) parsearConsorciosXlsx → headers + rows + sugerencias de mapping
//   2) validarConsorcios     → marca cada fila ok/error con motivo
//   3) importarConsorcios    → RPC consorcio_import_batch (gerencia)
// El RPC deduplica por CUIT (global) y por (admin, código); re-apunta la
// administración si el consorcio cambió de administrador (sin tocar históricos).
// El Excel se parsea en el browser: nunca toca Storage (R20 n/a).
// ============================================================================

export interface ConsorcioColumnMapping {
  codigo: string | null;
  nombre: string | null;
  cuit: string | null;
  domicilio: string | null;
  localidad: string | null;
  provincia: string | null;
  codigo_postal: string | null;
  unidades_funcionales: string | null;
  monto_abono: string | null;
}

export interface ParsedConsorcioSheet {
  headers: string[];
  rows: Array<Record<string, unknown>>;
  sugerencias: ConsorcioColumnMapping;
}

const ALIASES: Record<keyof ConsorcioColumnMapping, string[]> = {
  codigo: ['codigo', 'código', 'cod', 'code', 'nro'],
  nombre: [
    'nombre', 'consorcio', 'edificio', 'denominacion', 'denominación',
    'razon social', 'razón social', 'name',
  ],
  cuit: ['cuit', 'cuil', 'cuit/cuil', 'documento', 'doc'],
  domicilio: ['domicilio', 'direccion', 'dirección', 'address', 'calle', 'domicilio legal'],
  localidad: ['localidad', 'ciudad', 'city', 'partido'],
  provincia: ['provincia', 'province', 'prov'],
  codigo_postal: ['cp', 'codigo postal', 'código postal', 'postal', 'zip'],
  unidades_funcionales: ['uf', 'ufs', 'unidades', 'unidades funcionales'],
  monto_abono: ['abono', 'monto', 'monto abono', 'importe', 'cuota'],
};

function norm(s: string): string {
  return s
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_\-./\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// autoSugerir: 2 pasadas, cada header se asigna a UN solo campo (sin doble-mapeo),
// y la inclusión por substring sólo aplica a aliases "largos" (≥4 chars) para no
// capturar de más (ej. 'id'/'cp'/'cod' dentro de 'localidad'/'codigo postal').
function autoSugerir(headers: string[]): ConsorcioColumnMapping {
  const normalized = headers.map((h) => ({ original: h, norm: norm(h) }));
  const out: ConsorcioColumnMapping = {
    codigo: null, nombre: null, cuit: null, domicilio: null, localidad: null,
    provincia: null, codigo_postal: null, unidades_funcionales: null, monto_abono: null,
  };
  const used = new Set<string>();
  const campos = Object.keys(ALIASES) as Array<keyof ConsorcioColumnMapping>;

  // Pasada 1 — match EXACTO (cualquier alias de longitud).
  campos.forEach((k) => {
    for (const alias of ALIASES[k]) {
      const a = norm(alias);
      const match = normalized.find((h) => h.norm === a && !used.has(h.original));
      if (match) { out[k] = match.original; used.add(match.original); break; }
    }
  });

  // Pasada 2 — inclusión por substring, sólo aliases ≥4 chars y headers libres.
  campos.forEach((k) => {
    if (out[k]) return;
    for (const alias of ALIASES[k]) {
      const a = norm(alias);
      if (a.length < 4) continue;
      const match = normalized.find((h) => h.norm.includes(a) && !used.has(h.original));
      if (match) { out[k] = match.original; used.add(match.original); break; }
    }
  });

  return out;
}

export async function parsearConsorciosXlsx(
  file: File,
): Promise<ApiResponse<ParsedConsorcioSheet>> {
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const firstName = wb.SheetNames[0];
    if (!firstName) return fail('CONS_IMP_EMPTY', 'El archivo no tiene hojas');
    const ws = wb.Sheets[firstName];
    if (!ws) return fail('CONS_IMP_EMPTY', 'La primera hoja está vacía');

    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: null,
      raw: true,
    });
    if (json.length === 0) {
      return fail('CONS_IMP_EMPTY', 'No se encontraron filas de datos');
    }
    const headers = Object.keys(json[0] ?? {});
    return ok({ headers, rows: json, sugerencias: autoSugerir(headers) });
  } catch (e) {
    return fail('CONS_IMP_PARSE', 'No se pudo leer el archivo. Verificá que sea un .xlsx válido.', e);
  }
}

export interface ConsorcioFilaValidada {
  index: number;            // 1-based para mostrar al usuario
  ok: boolean;
  motivo?: string;
  payload?: Record<string, unknown>;
  resumen: string;
}

function parseMoney(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (!s) return 0;
  s = s.replace(/\$/g, '').replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseIntSafe(v: unknown): number {
  if (v == null) return 0;
  const n = Math.floor(Number(String(v).replace(/[^0-9.-]/g, '')));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function validarConsorcios(
  rows: Array<Record<string, unknown>>,
  mapping: ConsorcioColumnMapping,
): ConsorcioFilaValidada[] {
  return rows.map((row, idx) => {
    const get = (k: keyof ConsorcioColumnMapping): unknown => {
      const header = mapping[k];
      return header ? row[header] : null;
    };
    const nombre = String(get('nombre') ?? '').trim();
    const codigo = String(get('codigo') ?? '').trim();
    const cuitRaw = String(get('cuit') ?? '').replace(/[^0-9]/g, '');
    const cuit = cuitRaw || null;

    const errores: string[] = [];
    if (!nombre) errores.push('Nombre vacío');
    if (cuit && cuit.length !== 11) errores.push('CUIT no tiene 11 dígitos');

    const resumen = `${codigo || '—'} · ${nombre || '(sin nombre)'}${cuit ? ` · CUIT ${cuit}` : ''}`;

    if (errores.length > 0) {
      return { index: idx + 1, ok: false, motivo: errores.join(' · '), resumen };
    }

    // Numéricos nullable: null = "columna no mapeada o vacía" → el RPC preserva
    // el valor existente (coalesce-preserve). Nunca mandamos 0 por omisión, que
    // pisaría la base de facturación del consorcio (auditoría §6 #1).
    const ufRaw = get('unidades_funcionales');
    const abonoRaw = get('monto_abono');
    const uf =
      ufRaw == null || String(ufRaw).trim() === '' ? null : parseIntSafe(ufRaw);
    const abono =
      abonoRaw == null || String(abonoRaw).trim() === '' ? null : parseMoney(abonoRaw);

    return {
      index: idx + 1,
      ok: true,
      payload: {
        codigo: codigo || null,
        nombre,
        cuit,
        domicilio: String(get('domicilio') ?? '').trim() || null,
        localidad: String(get('localidad') ?? '').trim() || null,
        provincia: String(get('provincia') ?? '').trim() || null,
        codigo_postal: String(get('codigo_postal') ?? '').trim() || null,
        unidades_funcionales: uf,
        monto_abono: abono,
      },
      resumen,
    };
  });
}

export interface ConsorcioImportDetalle {
  fila: number;
  codigo: string | null;
  nombre: string | null;
  resultado: 'creado' | 'actualizado' | 'repunteado' | 'error';
  motivo?: string;
  consorcio_id?: string | null;
}

export interface ConsorcioImportResult {
  log_id: string;
  total: number;
  creados: number;
  actualizados: number;
  repunteados: number;
  errores: number;
  detalle: ConsorcioImportDetalle[];
}

export async function importarConsorcios(
  administracionId: string,
  archivo: string,
  filas: ConsorcioFilaValidada[],
): Promise<ApiResponse<ConsorcioImportResult>> {
  const payload = filas.filter((f) => f.ok && f.payload).map((f) => f.payload!);
  if (payload.length === 0) {
    return fail('CONS_IMP_NO_VALIDAS', 'No hay filas válidas para importar');
  }
  const { data, error } = await supabase.rpc('consorcio_import_batch', {
    p_administracion_id: administracionId,
    p_archivo: archivo,
    p_filas: payload as unknown as Json,
  });
  if (error) return fail('CONS_IMP_RPC', error.message, error);
  return ok(data as unknown as ConsorcioImportResult);
}
