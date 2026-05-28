import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

export type CajaRow = Database['public']['Tables']['cajas']['Row'];
export type CategoriaFinanzaRow = Database['public']['Tables']['categorias_finanzas']['Row'];
export type MovimientoRow = Database['public']['Tables']['movimientos']['Row'];
export type ImputacionRow = Database['public']['Tables']['movimiento_imputaciones']['Row'];

export interface CobranzaInput {
  comprobante_id: string;
  caja_id: string;
  fecha: string;          // YYYY-MM-DD
  monto: number;
  descripcion?: string;
  referencia?: string;
  categoria_id?: string | null;
  partner_id_atribucion?: string | null; // #145 · flag "participa partner"
}

export async function registrarCobranza(
  input: CobranzaInput,
): Promise<ApiResponse<{ movimiento_id: string }>> {
  const baseArgs = {
    p_comprobante_id: input.comprobante_id,
    p_caja_id: input.caja_id,
    p_fecha: input.fecha,
    p_monto: input.monto,
    p_descripcion: input.descripcion ?? '',
    p_referencia: input.referencia ?? '',
    p_categoria_id: input.categoria_id ?? null,
  } as Record<string, unknown>;
  if (input.partner_id_atribucion) {
    baseArgs.p_partner_id_atribucion = input.partner_id_atribucion;
  }
  const { data, error } = await supabase.rpc(
    'registrar_cobranza_comprobante',
    baseArgs as unknown as {
      p_comprobante_id: string;
      p_caja_id: string;
      p_fecha: string;
      p_monto: number;
      p_descripcion: string;
      p_referencia: string;
      p_categoria_id: string;
    },
  );
  if (error) return fail('COBR_REGISTRAR', error.message, error);
  return ok({ movimiento_id: data as string });
}

export async function desimputarCobranza(
  imputacion_id: string,
): Promise<ApiResponse<{ comprobante_id: string }>> {
  const { data, error } = await supabase.rpc('desimputar_cobranza', {
    p_imputacion_id: imputacion_id,
  });
  if (error) return fail('COBR_DESIMPUTAR', error.message, error);
  return ok({ comprobante_id: data as string });
}

export async function listCajasActivas(): Promise<ApiResponse<CajaRow[]>> {
  const { data, error } = await supabase
    .from('cajas')
    .select('*')
    .eq('activo', true)
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true });
  if (error) return fail('CAJAS_LIST', error.message, error);
  return ok(data ?? []);
}

export async function listCategoriasIngreso(): Promise<
  ApiResponse<CategoriaFinanzaRow[]>
> {
  const { data, error } = await supabase
    .from('categorias_finanzas')
    .select('*')
    .eq('activo', true)
    .eq('tipo', 'ingreso')
    .order('nombre', { ascending: true });
  if (error) return fail('CAT_LIST', error.message, error);
  return ok(data ?? []);
}

export interface CobranzaListItem extends ImputacionRow {
  movimiento: MovimientoRow & {
    caja_nombre: string | null;
    categoria_nombre: string | null;
  };
}

// Cobranzas de un comprobante: imputaciones + datos del movimiento + caja.
export async function listCobranzasDeComprobante(
  comprobante_id: string,
): Promise<ApiResponse<CobranzaListItem[]>> {
  const { data, error } = await supabase
    .from('movimiento_imputaciones')
    .select(
      `*,
       movimiento:movimientos!inner(
         *,
         caja:cajas(nombre),
         categoria:categorias_finanzas(nombre)
       )`,
    )
    .eq('comprobante_id', comprobante_id)
    .order('created_at', { ascending: false });
  if (error) return fail('COBR_LIST', error.message, error);

  type Joined = ImputacionRow & {
    movimiento: MovimientoRow & {
      caja: { nombre: string } | null;
      categoria: { nombre: string } | null;
    };
  };
  const rows: CobranzaListItem[] = (data ?? []).map((raw) => {
    const r = raw as Joined;
    const { caja, categoria, ...mov } = r.movimiento;
    return {
      ...(r as ImputacionRow),
      movimiento: {
        ...(mov as MovimientoRow),
        caja_nombre: caja?.nombre ?? null,
        categoria_nombre: categoria?.nombre ?? null,
      },
    };
  });
  return ok(rows);
}

// Timeline de cuenta corriente del cliente: comprobantes + cobranzas mezclados
// en orden cronológico inverso, con saldo acumulado.
export interface CtaCteEntry {
  id: string;
  fecha: string;
  tipo: 'comprobante' | 'cobranza';
  titulo: string;
  detalle: string | null;
  signo: 1 | -1; // +1 cargo (comprobante), -1 abono (cobranza)
  monto: number;
  saldo: number; // acumulado al final de esta entrada
  comprobante_id: string | null;
  consorcio_nombre: string | null;
}

/**
 * Lista la CC del cliente logueado.
 *
 * Fix #144 (2026-05-27): unificado al RPC SQL `cliente_ctacte_extracto`
 * (mig 0093), que delega a `cuenta_corriente_extracto` (la misma que usa
 * gerencia). Antes hacía 2 queries TS separados sin atomicidad → la cobranza
 * desde gerencia se reflejaba con delay/inconsistencia en el portal. Ahora
 * single query SQL = misma fuente de verdad. El parámetro administracion_id
 * se ignora (queda por compat) — la RPC usa current_administracion_id().
 */
export async function listCtaCteAdministracion(
  _administracion_id?: string,
): Promise<ApiResponse<CtaCteEntry[]>> {
  const { data, error } = await supabase.rpc('cliente_ctacte_extracto' as never);
  if (error) return fail('CTACTE_EXTRACTO', error.message, error);

  type ExtractoRow = {
    fecha: string;
    tipo: 'saldo_inicial' | 'cargo' | 'abono';
    descripcion: string | null;
    debe: number | string;
    haber: number | string;
    saldo: number | string;
    comprobante_id: string | null;
    movimiento_id: string | null;
    imputacion_id: string | null;
    consorcio_nombre: string | null;
  };

  const rows = (data ?? []) as unknown as ExtractoRow[];
  const out: CtaCteEntry[] = rows
    .filter((r) => r.tipo !== 'saldo_inicial')
    .map((r) => {
      const debe = Number(r.debe) || 0;
      const haber = Number(r.haber) || 0;
      const isCargo = r.tipo === 'cargo';
      return {
        id: `${r.tipo[0]}:${r.comprobante_id ?? r.imputacion_id ?? r.fecha}`,
        fecha: r.fecha,
        tipo: isCargo ? 'comprobante' : 'cobranza',
        titulo: r.descripcion ?? (isCargo ? 'Comprobante' : 'Cobranza'),
        detalle: r.consorcio_nombre,
        signo: isCargo ? 1 : -1,
        monto: isCargo ? debe : haber,
        saldo: Number(r.saldo) || 0,
        comprobante_id: r.comprobante_id,
        consorcio_nombre: r.consorcio_nombre,
      };
    });
  return ok(out);
}

// Legacy de 2 queries TS removida (commit fix #144) — la implementación viva
// arriba usa la RPC unificada `cliente_ctacte_extracto` (mig 0093).
