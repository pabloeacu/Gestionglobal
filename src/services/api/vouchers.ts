// API de vouchers por servicio (mig 0134).
// Regla 4: ningún componente toca supabase.from() directamente.

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

export type ServicioVoucherRow = Database['public']['Tables']['servicio_vouchers']['Row'];
export type ServicioVoucherInsert = Database['public']['Tables']['servicio_vouchers']['Insert'];
export type ServicioVoucherUpdate = Database['public']['Tables']['servicio_vouchers']['Update'];

export type VoucherAlcance = 'publico' | 'cliente' | 'ambos';

// ----------------------------------------------------------------------------
// Gerencia · CRUD
// ----------------------------------------------------------------------------

export async function listVouchersDeServicio(
  servicio_id: string,
): Promise<ApiResponse<ServicioVoucherRow[]>> {
  const { data, error } = await supabase
    .from('servicio_vouchers')
    .select('*')
    .eq('servicio_id', servicio_id)
    .order('created_at', { ascending: false });
  if (error) return fail('VOUCHERS_LIST', error.message, error);
  return ok(data ?? []);
}

export interface CrearVoucherInput {
  servicio_id: string;
  codigo: string;
  descuento_pct: number;          // 1..100
  alcance: VoucherAlcance;
  expira_at?: string | null;      // ISO timestamptz · null = nunca
  max_usos?: number | null;       // null = ilimitado
  observaciones?: string | null;
}

export async function crearVoucher(
  input: CrearVoucherInput,
): Promise<ApiResponse<ServicioVoucherRow>> {
  const insert: ServicioVoucherInsert = {
    servicio_id: input.servicio_id,
    codigo: input.codigo.trim(),
    descuento_pct: input.descuento_pct,
    alcance: input.alcance,
    expira_at: input.expira_at ?? null,
    max_usos: input.max_usos ?? null,
    observaciones: input.observaciones ?? null,
    activo: true,
  };
  const { data, error } = await supabase
    .from('servicio_vouchers')
    .insert(insert)
    .select()
    .single();
  if (error) return fail('VOUCHER_CREATE', error.message, error);
  return ok(data);
}

export async function actualizarVoucher(
  id: string,
  patch: ServicioVoucherUpdate,
): Promise<ApiResponse<ServicioVoucherRow>> {
  const { data, error } = await supabase
    .from('servicio_vouchers')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('VOUCHER_UPDATE', error.message, error);
  return ok(data);
}

export async function eliminarVoucher(id: string): Promise<ApiResponse<true>> {
  const { error } = await supabase
    .from('servicio_vouchers')
    .delete()
    .eq('id', id);
  if (error) return fail('VOUCHER_DELETE', error.message, error);
  return ok(true);
}

// ----------------------------------------------------------------------------
// Validación (uso público desde formularios)
// ----------------------------------------------------------------------------

export interface ValidacionVoucher {
  valido: boolean;
  voucher_id?: string;
  codigo?: string;
  descuento_pct?: number;
  es_100?: boolean;          // bonificación total → no requiere comprobante de pago
  mensaje: string;
}

/**
 * Llama al RPC voucher_validar. Acepta anon: puede usarse desde landing
 * pública. Si p_es_cliente es true, valida sólo vouchers con alcance
 * 'cliente' o 'ambos'.
 */
export async function validarVoucher(
  codigo: string,
  servicio_id: string,
  es_cliente = false,
): Promise<ApiResponse<ValidacionVoucher>> {
  const { data, error } = await supabase.rpc('voucher_validar', {
    p_codigo: codigo,
    p_servicio_id: servicio_id,
    p_es_cliente: es_cliente,
  });
  if (error) return fail('VOUCHER_VALIDAR', error.message, error);
  return ok((data ?? { valido: false, mensaje: 'Sin respuesta' }) as unknown as ValidacionVoucher);
}

/**
 * Incrementa el contador de usos. Se llama al CREAR la solicitud que usó el
 * voucher, no antes (para no inflar contadores con validaciones de prueba).
 */
export async function incrementarUsoVoucher(
  voucher_id: string,
): Promise<ApiResponse<true>> {
  const { error } = await supabase.rpc('voucher_incrementar_uso', {
    p_voucher_id: voucher_id,
  });
  if (error) return fail('VOUCHER_USO', error.message, error);
  return ok(true);
}

// ----------------------------------------------------------------------------
// Util: estado visual para listas
// ----------------------------------------------------------------------------
export function estadoVoucher(
  v: ServicioVoucherRow,
): { label: string; tone: 'success' | 'warn' | 'danger' | 'muted' } {
  if (!v.activo) return { label: 'Inactivo', tone: 'muted' };
  if (v.expira_at && new Date(v.expira_at).getTime() <= Date.now())
    return { label: 'Vencido', tone: 'danger' };
  if (v.max_usos != null && v.usos_count >= v.max_usos)
    return { label: 'Agotado', tone: 'danger' };
  if (v.expira_at) {
    const diasRestantes = Math.ceil(
      (new Date(v.expira_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    if (diasRestantes <= 7) return { label: `Vence en ${diasRestantes}d`, tone: 'warn' };
  }
  return { label: 'Vigente', tone: 'success' };
}
