// #1/#2 (reporte JL) · Informar pago desde el portal (informa → gerencia concilia).
// El cliente informa un pago (intención); NO mueve el saldo. Gerencia concilia
// vía registrar_cobranza_comprobante (única escritora del asiento). Ver mig 0328.
import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';

export type PagoMedio = 'transferencia' | 'deposito' | 'mercadopago' | 'efectivo' | 'otro';
export type PagoEstado = 'reportado' | 'conciliado' | 'rechazado';

export interface PagoReportado {
  id: string;
  administracion_id: string;
  comprobante_id: string | null;
  tramite_id: string | null;
  monto: number;
  fecha_pago: string;
  medio: PagoMedio;
  referencia: string | null;
  nota: string | null;
  estado: PagoEstado;
  motivo_rechazo: string | null;
  created_at: string;
  revisado_at: string | null;
}

// Wrapper que preserva el `this` binding del cliente supabase.
type RawRpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc: RawRpc = (name, args) => (supabase.rpc as unknown as RawRpc).call(supabase, name, args);

export interface ReportarPagoInput {
  comprobanteId?: string | null;
  tramiteId?: string | null;
  trackingLineaId?: string | null;
  monto: number;
  fechaPago: string; // YYYY-MM-DD
  medio: PagoMedio;
  referencia?: string | null;
  archivoPath?: string | null;
  nota?: string | null;
}

// Cliente informa un pago.
export async function reportarPago(input: ReportarPagoInput): Promise<ApiResponse<string>> {
  const { data, error } = await rpc('pago_reportar', {
    p_comprobante_id: input.comprobanteId ?? null,
    p_tramite_id: input.tramiteId ?? null,
    p_tracking_linea_id: input.trackingLineaId ?? null,
    p_monto: input.monto,
    p_fecha_pago: input.fechaPago,
    p_medio: input.medio,
    p_referencia: input.referencia ?? null,
    p_archivo_path: input.archivoPath ?? null,
    p_nota: input.nota ?? null,
  });
  if (error) return fail('PAGO_REPORTAR', error.message, error);
  return ok(data as string);
}

// Pagos que informó el cliente (RLS: sólo los de su administración).
export async function listPagosReportadosCliente(): Promise<ApiResponse<PagoReportado[]>> {
  const { data, error } = await supabase
    .from('pagos_reportados')
    .select('id, administracion_id, comprobante_id, tramite_id, monto, fecha_pago, medio, referencia, nota, estado, motivo_rechazo, created_at, revisado_at')
    .order('created_at', { ascending: false });
  if (error) return fail('PAGOS_CLIENTE', error.message, error);
  return ok((data ?? []) as unknown as PagoReportado[]);
}

export interface PagoReportadoGerencia extends PagoReportado {
  administracion_nombre: string | null;
}

// Cola de gerencia: pagos informados pendientes de conciliar (con nombre del cliente).
export async function listPagosReportadosGerencia(estado: PagoEstado = 'reportado'): Promise<ApiResponse<PagoReportadoGerencia[]>> {
  const { data, error } = await supabase
    .from('pagos_reportados')
    .select('id, administracion_id, comprobante_id, tramite_id, monto, fecha_pago, medio, referencia, nota, estado, motivo_rechazo, created_at, revisado_at, administraciones(nombre)')
    .eq('estado', estado)
    .order('created_at', { ascending: true });
  if (error) return fail('PAGOS_GERENCIA', error.message, error);
  const rows = (data ?? []).map((raw) => {
    const r = raw as unknown as PagoReportado & { administraciones: { nombre: string } | null };
    const { administraciones, ...rest } = r;
    return { ...(rest as PagoReportado), administracion_nombre: administraciones?.nombre ?? null };
  });
  return ok(rows);
}

// Gerencia concilia (→ registrar_cobranza_comprobante).
export async function conciliarPago(input: {
  pagoId: string; cajaId: string; categoriaId: string; comprobanteId?: string | null; fecha?: string | null;
}): Promise<ApiResponse<string>> {
  const { data, error } = await rpc('pago_conciliar', {
    p_pago_id: input.pagoId,
    p_caja_id: input.cajaId,
    p_categoria_id: input.categoriaId,
    p_comprobante_id: input.comprobanteId ?? null,
    p_fecha: input.fecha ?? null,
  });
  if (error) return fail('PAGO_CONCILIAR', error.message, error);
  return ok(data as string);
}

// Gerencia rechaza.
export async function rechazarPago(pagoId: string, motivo: string): Promise<ApiResponse<true>> {
  const { error } = await rpc('pago_rechazar', { p_pago_id: pagoId, p_motivo: motivo });
  if (error) return fail('PAGO_RECHAZAR', error.message, error);
  return ok(true);
}
