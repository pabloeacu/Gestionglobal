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

// ============================================================================
// Cobrar-al-emitir (JL · 2026-06-16): permitir imputar una cobranza —total o
// PARCIAL— en el mismo acto de generar el comprobante. Reusa la RPC de cobranza
// existente (soporta parcial nativo). El comprobante se emite por el total del
// servicio; la cobranza imputada puede ser menor → estado_cobranza='parcial'.
// ============================================================================
export type CobroModo = 'sin_cobro' | 'total' | 'parcial';

export interface CobroAhoraState {
  modo: CobroModo;
  cajaId: string;
  categoriaId: string;
  fecha: string; // YYYY-MM-DD
  montoParcial: number; // sólo se usa cuando modo === 'parcial'
  referencia: string;
  partnerId: string; // participación del partner (rendición)
}

export function cobroInicial(): CobroAhoraState {
  return {
    modo: 'sin_cobro',
    cajaId: '',
    categoriaId: '',
    fecha: new Date().toISOString().slice(0, 10),
    montoParcial: 0,
    referencia: '',
    partnerId: '',
  };
}

/** Valida la config de cobro-al-emitir contra el total del comprobante.
 * Devuelve un mensaje de error, o null si está OK (incl. modo 'sin_cobro'). */
export function validarCobroEnEmision(
  cobro: CobroAhoraState,
  total: number,
): string | null {
  if (cobro.modo === 'sin_cobro') return null;
  if (!cobro.cajaId) return 'Elegí la caja donde se acreditó el pago';
  if (!cobro.fecha) return 'Indicá la fecha del pago';
  if (cobro.modo === 'parcial') {
    if (!(cobro.montoParcial > 0))
      return 'El monto del pago parcial debe ser mayor a 0';
    if (cobro.montoParcial > total + 0.009)
      return 'El pago parcial no puede superar el total del comprobante';
  }
  return null;
}

/** Tras emitir, registra la cobranza en el mismo acto (si modo != sin_cobro).
 * Re-lee el saldo REAL del comprobante recién emitido para evitar desfasajes de
 * redondeo: 'total' cobra el saldo exacto; 'parcial' clampea a ese saldo. */
export async function registrarCobranzaEnEmision(
  comprobanteId: string,
  cobro: CobroAhoraState,
): Promise<ApiResponse<{ movimiento_id: string } | null>> {
  if (cobro.modo === 'sin_cobro') return ok(null);
  const { data: comp, error } = await supabase
    .from('comprobantes')
    .select('saldo_pendiente, total')
    .eq('id', comprobanteId)
    .single();
  if (error) return fail('COBRO_SALDO', error.message, error);
  const saldo = Number(comp?.saldo_pendiente ?? comp?.total ?? 0);
  const monto =
    cobro.modo === 'total' ? saldo : Math.min(cobro.montoParcial, saldo);
  if (!(monto > 0)) return fail('COBRO_MONTO', 'El monto a cobrar debe ser mayor a 0');
  const r = await registrarCobranza({
    comprobante_id: comprobanteId,
    caja_id: cobro.cajaId,
    fecha: cobro.fecha,
    monto,
    referencia: cobro.referencia,
    categoria_id: cobro.categoriaId || null,
    partner_id_atribucion: cobro.partnerId || null,
  });
  if (!r.ok) return r;
  return ok(r.data);
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

// ============================================================================
// Saldo a favor / crédito (JL #3 · DGG-91): al anular un comprobante ya pagado
// (p. ej. inscripción duplicada) el pago queda como INGRESO sin imputar = saldo
// a favor del cliente. Estas RPCs lo exponen y permiten aplicarlo a otra deuda
// pendiente de la MISMA administración. Backend: mig 0265.
// ============================================================================
export interface CreditoDisponible {
  movimiento_id: string;
  fecha: string;
  monto: number;
  saldo_disponible: number;
  descripcion: string | null;
  comprobante_origen: string | null;
}

/** Lista los saldos a favor (ingresos con crédito no aplicado) de una admin. */
export async function listarCreditosAdministracion(
  administracion_id: string,
): Promise<ApiResponse<CreditoDisponible[]>> {
  const { data, error } = await supabase.rpc(
    'listar_creditos_administracion' as never,
    { p_administracion_id: administracion_id } as never,
  );
  if (error) return fail('CRED_LIST', error.message, error);
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const out: CreditoDisponible[] = rows.map((r) => ({
    movimiento_id: String(r.movimiento_id),
    fecha: String(r.fecha),
    monto: Number(r.monto) || 0,
    saldo_disponible: Number(r.saldo_disponible) || 0,
    descripcion: (r.descripcion as string | null) ?? null,
    comprobante_origen: (r.comprobante_origen as string | null) ?? null,
  }));
  return ok(out);
}

/** Imputa un crédito disponible a un comprobante pendiente (misma admin). */
export async function imputarCreditoAComprobante(
  movimiento_id: string,
  comprobante_id: string,
  monto: number,
): Promise<ApiResponse<{ credito_restante: number; comprobante_saldo: number }>> {
  const { data, error } = await supabase.rpc(
    'imputar_credito_a_comprobante' as never,
    {
      p_movimiento_id: movimiento_id,
      p_comprobante_id: comprobante_id,
      p_monto: monto,
    } as never,
  );
  if (error) return fail('CRED_IMPUTAR', error.message, error);
  const d = (data ?? {}) as Record<string, unknown>;
  return ok({
    credito_restante: Number(d.credito_restante) || 0,
    comprobante_saldo: Number(d.comprobante_saldo) || 0,
  });
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
  administracion_id?: string,
): Promise<ApiResponse<CtaCteEntry[]>> {
  // Mig 0109: cliente_ctacte_extracto acepta p_admin_id (staff puede pedir
  // CC de cualquier admin; cliente usa current_administracion_id si no se
  // pasa). Pasamos siempre cuando lo conocemos.
  const args = administracion_id
    ? ({ p_admin_id: administracion_id } as unknown as Record<string, unknown>)
    : ({} as Record<string, unknown>);
  const { data, error } = await supabase.rpc(
    'cliente_ctacte_extracto' as never,
    args as never,
  );
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
