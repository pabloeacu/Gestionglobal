// Cuenta Corriente · service API para el módulo de gerencia.
// Apoya las RPCs de migración 0031:
//   - cuenta_corriente_resumen(p_administracion_id, p_desde, p_hasta)
//   - cuenta_corriente_extracto(p_administracion_id, p_desde, p_hasta)
//   - cuenta_corriente_morosos(p_limit)
//   - cuenta_corriente_resumen_global(p_desde, p_hasta)
//
// E43: tipos generados de Supabase aún no incluyen las nuevas RPCs (la
// regeneración requiere SUPABASE_ACCESS_TOKEN). Usamos el mismo workaround
// que `crearComprobanteBorradorFiscal` (services/api/comprobantes.ts):
// castear `supabase.rpc` a un firma agnóstica de nombre. Cuando se regenere
// `database.ts` se pueden tipar normalmente.

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';

type RawRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

// Wrapper que preserva el `this` binding de supabase. Asignar
// `supabase.rpc` a una constante pierde `this` y rompe en runtime con
// "Cannot read properties of undefined (reading 'rest')".
const rpc: RawRpc = (name, args) =>
  (supabase.rpc as unknown as RawRpc).call(supabase, name, args);

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
export interface CtaCteResumen {
  saldo_inicial: number;
  total_facturado: number;
  total_cobrado: number;
  saldo_actual: number;
  comprobantes_pendientes: number;
  comprobantes_vencidos: number;
  deuda_total: number;
  /** E-GG-86 · crédito vigente del cliente (pagos no imputados a deuda). */
  saldo_a_favor: number;
  proximo_vencimiento: string | null;
}

// E-GG-86: 'saldo_favor' = fila HABER de un pago que quedó como crédito
// (anulación de comprobante pagado / pago a cuenta / residual de cobranza).
export type ExtractoTipo = 'saldo_inicial' | 'cargo' | 'abono' | 'saldo_favor';

export interface ExtractoRow {
  fecha: string;
  tipo: ExtractoTipo;
  descripcion: string;
  debe: number;
  haber: number;
  saldo: number;
  comprobante_id: string | null;
  movimiento_id: string | null;
  imputacion_id: string | null;
  consorcio_nombre: string | null;
}

export interface MorosoRow {
  administracion_id: string;
  administracion_nombre: string;
  deuda_total: number;
  comprobantes_vencidos: number;
  comprobantes_pendientes: number;
  mayor_dias_vencido: number;
}

export interface ResumenGlobalRow {
  administracion_id: string;
  administracion_nombre: string;
  total_facturado: number;
  total_cobrado: number;
  deuda_total: number;
  /** E-GG-86 · crédito vigente del cliente. */
  saldo_a_favor: number;
  comprobantes_vencidos: number;
  comprobantes_pendientes: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toStr(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
export async function getResumenAdministracion(
  administracionId: string,
  desde?: string,
  hasta?: string,
): Promise<ApiResponse<CtaCteResumen>> {
  const args: Record<string, unknown> = { p_administracion_id: administracionId };
  if (desde) args['p_desde'] = desde;
  if (hasta) args['p_hasta'] = hasta;

  const { data, error } = await rpc('cuenta_corriente_resumen', args);
  if (error) return fail('CTACTE_RESUMEN', error.message, error);
  const arr = Array.isArray(data) ? data : [];
  const row = (arr[0] ?? {}) as Record<string, unknown>;
  return ok({
    saldo_inicial: toNum(row['saldo_inicial']),
    total_facturado: toNum(row['total_facturado']),
    total_cobrado: toNum(row['total_cobrado']),
    saldo_actual: toNum(row['saldo_actual']),
    comprobantes_pendientes: toNum(row['comprobantes_pendientes']),
    comprobantes_vencidos: toNum(row['comprobantes_vencidos']),
    deuda_total: toNum(row['deuda_total']),
    saldo_a_favor: toNum(row['saldo_a_favor']),
    proximo_vencimiento: (row['proximo_vencimiento'] as string | null) ?? null,
  });
}

export async function getExtracto(
  administracionId: string,
  desde: string,
  hasta: string,
): Promise<ApiResponse<ExtractoRow[]>> {
  const { data, error } = await rpc('cuenta_corriente_extracto', {
    p_administracion_id: administracionId,
    p_desde: desde,
    p_hasta: hasta,
  });
  if (error) return fail('CTACTE_EXTRACTO', error.message, error);
  const arr = Array.isArray(data) ? data : [];
  const rows: ExtractoRow[] = arr.map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      fecha: toStr(r['fecha']),
      tipo: (r['tipo'] as ExtractoTipo) ?? 'cargo',
      descripcion: toStr(r['descripcion']),
      debe: toNum(r['debe']),
      haber: toNum(r['haber']),
      saldo: toNum(r['saldo']),
      comprobante_id: (r['comprobante_id'] as string | null) ?? null,
      movimiento_id: (r['movimiento_id'] as string | null) ?? null,
      imputacion_id: (r['imputacion_id'] as string | null) ?? null,
      consorcio_nombre: (r['consorcio_nombre'] as string | null) ?? null,
    };
  });
  return ok(rows);
}

export async function listMorososResumen(
  limit = 10,
): Promise<ApiResponse<MorosoRow[]>> {
  const { data, error } = await rpc('cuenta_corriente_morosos', { p_limit: limit });
  if (error) return fail('CTACTE_MOROSOS', error.message, error);
  const arr = Array.isArray(data) ? data : [];
  const rows: MorosoRow[] = arr.map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      administracion_id: toStr(r['administracion_id']),
      administracion_nombre: toStr(r['administracion_nombre']),
      deuda_total: toNum(r['deuda_total']),
      comprobantes_vencidos: toNum(r['comprobantes_vencidos']),
      comprobantes_pendientes: toNum(r['comprobantes_pendientes']),
      mayor_dias_vencido: toNum(r['mayor_dias_vencido']),
    };
  });
  return ok(rows);
}

export async function getResumenGlobal(
  desde?: string,
  hasta?: string,
): Promise<ApiResponse<ResumenGlobalRow[]>> {
  const args: Record<string, unknown> = {};
  if (desde) args['p_desde'] = desde;
  if (hasta) args['p_hasta'] = hasta;

  const { data, error } = await rpc('cuenta_corriente_resumen_global', args);
  if (error) return fail('CTACTE_GLOBAL', error.message, error);
  const arr = Array.isArray(data) ? data : [];
  const rows: ResumenGlobalRow[] = arr.map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      administracion_id: toStr(r['administracion_id']),
      administracion_nombre: toStr(r['administracion_nombre']),
      total_facturado: toNum(r['total_facturado']),
      total_cobrado: toNum(r['total_cobrado']),
      deuda_total: toNum(r['deuda_total']),
      saldo_a_favor: toNum(r['saldo_a_favor']),
      comprobantes_vencidos: toNum(r['comprobantes_vencidos']),
      comprobantes_pendientes: toNum(r['comprobantes_pendientes']),
    };
  });
  return ok(rows);
}
