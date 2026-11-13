// DGG-249 · Egresos-obligación (contabilidad simétrica a los ingresos).
// La obligación de pago de GG: se emite impaga y se paga total/parcial/queda
// como pasivo. El pago emite un `movimientos` egreso (origen='pago_egreso') que
// toca caja; la obligación impaga NO toca caja (pasivo). Ver DGG-249.
//
// R4: todo el acceso a datos vive acá. Los types regenerados aún no conocen la
// tabla/RPCs nuevas, así que usamos un caller rpc crudo (igual que dashboard.ts).
import { supabase } from '@/lib/supabase';
import { fail, ok, type ApiResponse } from '@/lib/errors';

type RawRpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc: RawRpc = (name, args) =>
  (supabase.rpc as unknown as RawRpc).call(supabase, name, args);

export type EstadoPagoEgreso = 'pendiente' | 'parcial' | 'pagado' | 'anulado';

export interface ObligacionEgreso {
  id: string;
  fecha: string;
  vencimiento: string | null;
  proveedor_nombre: string;
  concepto: string;
  total: number;
  saldo_pendiente: number;
  estado_pago: EstadoPagoEgreso;
  estado: 'activo' | 'anulado';
  vencido: boolean;
  categoria_id: string | null;
  categoria_nombre: string | null;
  partner_id_atribucion: string | null;
  partner_nombre: string | null;
  administracion_id: string | null;
  admin_nombre: string | null;
  curso_id: string | null;
  tramite_id: string | null;
  observaciones: string | null;
  created_at: string;
}

export interface EmitirEgresoInput {
  proveedorNombre: string;
  concepto: string;
  total: number;
  fecha: string;
  vencimiento?: string | null;
  categoriaId?: string | null;
  proveedorId?: string | null;
  administracionId?: string | null;
  consorcioId?: string | null;
  partnerIdAtribucion?: string | null;
  cursoId?: string | null;
  tramiteId?: string | null;
  observaciones?: string | null;
  // Pago en el mismo acto (opcional): caja + monto (parcial o total). Impago = omitir.
  pagoCajaId?: string | null;
  pagoMonto?: number | null;
  pagoFecha?: string | null;
}

/** Lista las obligaciones de egreso (universo completo; el front filtra tabs en memoria, R19). */
export async function listObligaciones(
  incluirAnulados = false,
): Promise<ApiResponse<ObligacionEgreso[]>> {
  const { data, error } = await rpc('listar_egresos', {
    p_incluir_anulados: incluirAnulados,
  });
  if (error) return fail('EGRESOS_LIST', error.message, error);
  return ok((data ?? []) as ObligacionEgreso[]);
}

/** Emite una obligación de egreso. Con pagoCajaId+pagoMonto, la paga en el mismo acto (atómico). */
export async function emitirEgreso(input: EmitirEgresoInput): Promise<ApiResponse<string>> {
  const { data, error } = await rpc('emitir_egreso', {
    p_proveedor_nombre: input.proveedorNombre,
    p_concepto: input.concepto,
    p_total: input.total,
    p_fecha: input.fecha,
    p_vencimiento: input.vencimiento ?? null,
    p_categoria_id: input.categoriaId ?? null,
    p_proveedor_id: input.proveedorId ?? null,
    p_administracion_id: input.administracionId ?? null,
    p_consorcio_id: input.consorcioId ?? null,
    p_partner_id_atribucion: input.partnerIdAtribucion ?? null,
    p_curso_id: input.cursoId ?? null,
    p_tramite_id: input.tramiteId ?? null,
    p_observaciones: input.observaciones ?? null,
    p_pago_caja_id: input.pagoCajaId ?? null,
    p_pago_monto: input.pagoMonto ?? null,
    p_pago_fecha: input.pagoFecha ?? null,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) return fail('EGRESO_EMITIR', error.message, error);
  return ok(data as string);
}

/** Registra un pago contra una obligación existente (crea el movimiento egreso + imputación). */
export async function registrarPagoEgreso(args: {
  egresoId: string;
  cajaId: string;
  fecha: string;
  monto: number;
  descripcion?: string | null;
  referencia?: string | null;
}): Promise<ApiResponse<string>> {
  const { data, error } = await rpc('registrar_pago_egreso', {
    p_egreso_id: args.egresoId,
    p_caja_id: args.cajaId,
    p_fecha: args.fecha,
    p_monto: args.monto,
    p_descripcion: args.descripcion ?? null,
    p_referencia: args.referencia ?? null,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) return fail('EGRESO_PAGO', error.message, error);
  return ok(data as string);
}

/** Anula una obligación (sólo si no tiene pagos registrados; deshacé el pago primero). */
export async function anularEgreso(egresoId: string, motivo: string): Promise<ApiResponse<void>> {
  const { error } = await rpc('anular_egreso', { p_egreso_id: egresoId, p_motivo: motivo });
  if (error) return fail('EGRESO_ANULAR', error.message, error);
  return ok(undefined);
}

/**
 * Deshace TODOS los pagos de una obligación de forma atómica y consistente (DGG-249 / E-GG-50):
 * borra las imputaciones de pago → la obligación recalcula a impaga, y anula el/los movimiento(s)
 * de caja (salen de caja, KPIs, sábana y rendición). Es la vía ÚNICA para deshacer un pago de
 * egreso: caja bloquea anular/revertir de esos movimientos. Devuelve cuántos pagos deshizo.
 */
export async function revertirPagosEgreso(
  egresoId: string,
  motivo?: string | null,
): Promise<ApiResponse<number>> {
  const { data, error } = await rpc('revertir_pagos_egreso', {
    p_egreso_id: egresoId,
    p_motivo: motivo ?? null,
  });
  if (error) return fail('EGRESO_REVERTIR_PAGOS', error.message, error);
  return ok((data as number) ?? 0);
}
