import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database, Json } from '@/types/database';

export type ComprobanteRow = Database['public']['Tables']['comprobantes']['Row'];
export type ComprobanteItemRow = Database['public']['Tables']['items_comprobantes']['Row'];

export const COMPROBANTE_TIPOS = [
  'A','B','C','X','NC_A','NC_B','NC_C','NC_X','ND_A','ND_B','ND_C','ND_X',
] as const;
export type ComprobanteTipo = (typeof COMPROBANTE_TIPOS)[number];

export const COMPROBANTE_ESTADOS = [
  'borrador','procesando','autorizado','observado','rechazado','anulado','compensado','error',
] as const;
export type ComprobanteEstado = (typeof COMPROBANTE_ESTADOS)[number];

export const COBRANZA_ESTADOS = [
  'pendiente','parcial','pagado','vencido','en_recupero','anulado',
] as const;
export type CobranzaEstado = (typeof COBRANZA_ESTADOS)[number];

export const ALICUOTAS_IVA = ['0','10.5','21','27','exento','no_gravado'] as const;
export type AlicuotaIva = (typeof ALICUOTAS_IVA)[number];

/**
 * ¿El comprobante está VENCIDO? (E-GG-136).
 *
 * "Vencido" NO es un valor real de `estado_cobranza` — la columna sólo toma
 * 'pendiente'/'parcial'/'pagado' (nada lo envejece a 'vencido'). Es una
 * condición DERIVADA de la fecha, igual que en `comprobantes_morosos` /
 * `cliente_deuda_neta` (BD) y en `ComprobanteDetailPage` (UI). Cualquier KPI o
 * badge que filtre `estado_cobranza === 'vencido'` cuenta SIEMPRE 0 (bug).
 *
 * Regla canónica (idéntica al SQL): saldo pendiente > 0, comprobante vivo
 * (no anulado/borrador/rechazado) y `vencimiento < hoy`. Se comparan strings
 * `YYYY-MM-DD` (orden lexicográfico == cronológico) para evitar corrimientos
 * de timezone.
 */
export function esComprobanteVencido(c: {
  vencimiento?: string | null;
  saldo_pendiente?: number | string | null;
  estado?: string | null;
}): boolean {
  if (!c.vencimiento) return false;
  if (Number(c.saldo_pendiente ?? 0) <= 0) return false;
  if (c.estado === 'anulado' || c.estado === 'borrador' || c.estado === 'rechazado') {
    return false;
  }
  const now = new Date();
  const hoy = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  return c.vencimiento.slice(0, 10) < hoy;
}

export interface ComprobanteListItem extends ComprobanteRow {
  administracion_nombre: string;
  consorcio_nombre: string | null;
}

export interface ListComprobantesParams {
  search?: string;
  estado?: ComprobanteEstado | 'todos';
  estadoCobranza?: CobranzaEstado | 'todos';
  tipo?: ComprobanteTipo | 'todos';
  administracionId?: string;
  periodo?: string; // YYYY-MM-01 (primer día del mes)
  limit?: number;
  offset?: number;
}

export async function listComprobantes(
  params: ListComprobantesParams = {},
): Promise<ApiResponse<{ rows: ComprobanteListItem[]; total: number }>> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;

  let q = supabase
    .from('comprobantes')
    .select(
      `*,
       administraciones!inner(id,nombre),
       consorcios(id,nombre)`,
      { count: 'exact' },
    )
    .order('fecha', { ascending: false })
    .order('numero', { ascending: false })
    .range(offset, offset + limit - 1);

  if (params.estado && params.estado !== 'todos') {
    q = q.eq('estado', params.estado);
  }
  if (params.estadoCobranza && params.estadoCobranza !== 'todos') {
    if (params.estadoCobranza === 'vencido') {
      // E-GG-136: 'vencido' NO es un valor real de estado_cobranza (nadie lo
      // envejece) → `.eq('estado_cobranza','vencido')` devolvía SIEMPRE 0.
      // Traducimos al predicado derivado por fecha (idéntico a comprobantes_morosos).
      const now = new Date();
      const hoy = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
        now.getDate(),
      ).padStart(2, '0')}`;
      q = q
        .gt('saldo_pendiente', 0)
        .not('vencimiento', 'is', null)
        .lt('vencimiento', hoy)
        .not('estado', 'in', '(anulado,borrador,rechazado)');
    } else {
      q = q.eq('estado_cobranza', params.estadoCobranza);
    }
  }
  if (params.tipo && params.tipo !== 'todos') {
    q = q.eq('tipo', params.tipo);
  }
  if (params.administracionId) {
    q = q.eq('administracion_id', params.administracionId);
  }
  if (params.periodo) {
    q = q.eq('periodo', params.periodo);
  }
  if (params.search && params.search.trim().length > 0) {
    const s = params.search.trim();
    q = q.or(
      `receptor_razon_social.ilike.%${s}%,receptor_numero_documento.ilike.%${s}%`,
    );
  }

  const { data, error, count } = await q;
  if (error) return fail('COMP_LIST', error.message, error);

  type Joined = ComprobanteRow & {
    administraciones: { id: string; nombre: string } | null;
    consorcios: { id: string; nombre: string } | null;
  };
  const rows: ComprobanteListItem[] = (data ?? []).map((raw) => {
    const r = raw as Joined;
    const { administraciones, consorcios, ...rest } = r;
    return {
      ...(rest as ComprobanteRow),
      administracion_nombre: administraciones?.nombre ?? '—',
      consorcio_nombre: consorcios?.nombre ?? null,
    };
  });

  // PostgREST a veces devuelve count=0 con joins; fallback a rows.length.
  const safeTotal = count && count > 0 ? count : rows.length;
  return ok({ rows, total: safeTotal });
}

export async function getComprobante(
  id: string,
): Promise<
  ApiResponse<{ comprobante: ComprobanteRow; items: ComprobanteItemRow[] }>
> {
  const [{ data: comp, error: e1 }, { data: items, error: e2 }] = await Promise.all([
    supabase.from('comprobantes').select('*').eq('id', id).single(),
    supabase
      .from('items_comprobantes')
      .select('*')
      .eq('comprobante_id', id)
      .order('orden', { ascending: true }),
  ]);
  if (e1) return fail('COMP_GET', e1.message, e1);
  if (e2) return fail('COMP_ITEMS', e2.message, e2);
  return ok({ comprobante: comp as ComprobanteRow, items: items ?? [] });
}

export interface ItemDraft {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  bonificacion_porc: number;
  alicuota_iva: AlicuotaIva;
  servicio_id?: string | null;
  consorcio_id?: string | null;
}

export interface EmitirComprobanteInput {
  administracion_id: string;
  consorcio_id: string | null;
  tipo: 'X' | 'NC_X' | 'ND_X';
  punto_venta: number;
  fecha: string;
  vencimiento: string;
  concepto: 'productos' | 'servicios' | 'productos_servicios';
  items: ItemDraft[];
  observaciones?: string;
  comprobante_referencia_id?: string | null;
}

export async function emitirComprobanteManual(
  input: EmitirComprobanteInput,
): Promise<ApiResponse<{ id: string }>> {
  // El type generator marca los args como `string` no-null, pero el PL/pgSQL
  // acepta NULL en consorcio_id y comprobante_referencia_id. Cast deliberado.
  const args = {
    p_administracion_id: input.administracion_id,
    p_consorcio_id: input.consorcio_id,
    p_tipo: input.tipo,
    p_punto_venta: input.punto_venta,
    p_fecha: input.fecha,
    p_vencimiento: input.vencimiento,
    p_concepto: input.concepto,
    p_items: input.items.map((it) => ({
      descripcion: it.descripcion,
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario,
      bonificacion_porc: it.bonificacion_porc,
      alicuota_iva: it.alicuota_iva,
      servicio_id: it.servicio_id ?? null,
      consorcio_id: it.consorcio_id ?? null,
    })),
    p_observaciones: input.observaciones ?? '',
    p_comprobante_referencia_id: input.comprobante_referencia_id ?? null,
  } as unknown as {
    p_administracion_id: string;
    p_comprobante_referencia_id: string;
    p_concepto: string;
    p_consorcio_id: string;
    p_fecha: string;
    p_items: Json;
    p_observaciones: string;
    p_punto_venta: number;
    p_tipo: string;
    p_vencimiento: string;
  };
  const { data, error } = await supabase.rpc('emitir_comprobante_manual', args);
  if (error) return fail('COMP_EMITIR', error.message, error);
  return ok({ id: data as string });
}

// Tipos fiscales (A/B/C y sus NC/ND). Crea el borrador (sin numerador) y
// devuelve el id. El caller debería llamar luego a enqueueComprobante() de
// services/api/arca para que la cola lo autorice y le asigne CAE/número.
export type TipoFiscal =
  | 'A' | 'B' | 'C'
  | 'NC_A' | 'NC_B' | 'NC_C'
  | 'ND_A' | 'ND_B' | 'ND_C';

export interface CrearBorradorFiscalInput {
  administracion_id: string;
  consorcio_id: string | null;
  tipo: TipoFiscal;
  punto_venta: number;
  fecha: string;
  vencimiento: string;
  concepto: 'productos' | 'servicios' | 'productos_servicios';
  items: ItemDraft[];
  observaciones?: string;
  comprobante_referencia_id?: string | null;
}

export async function crearComprobanteBorradorFiscal(
  input: CrearBorradorFiscalInput,
): Promise<ApiResponse<{ id: string }>> {
  const args = {
    p_administracion_id: input.administracion_id,
    p_consorcio_id: input.consorcio_id,
    p_tipo: input.tipo,
    p_punto_venta: input.punto_venta,
    p_fecha: input.fecha,
    p_vencimiento: input.vencimiento,
    p_concepto: input.concepto,
    p_items: input.items.map((it) => ({
      descripcion: it.descripcion,
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario,
      bonificacion_porc: it.bonificacion_porc,
      alicuota_iva: it.alicuota_iva,
      servicio_id: it.servicio_id ?? null,
      consorcio_id: it.consorcio_id ?? null,
    })),
    p_observaciones: input.observaciones ?? '',
    p_comprobante_referencia_id: input.comprobante_referencia_id ?? null,
  } as unknown as {
    p_administracion_id: string;
    p_comprobante_referencia_id: string;
    p_concepto: string;
    p_consorcio_id: string;
    p_fecha: string;
    p_items: Json;
    p_observaciones: string;
    p_punto_venta: number;
    p_tipo: string;
    p_vencimiento: string;
  };
  // rpc name not in generated types yet (mig 0013a). Cast inline pero
  // PRESERVANDO `this` con .call(supabase) — sin esto, supabase-js v2
  // explota con "Cannot read properties of undefined (reading 'rest')".
  type RawRpc = (
    name: string,
    args: unknown,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await (supabase.rpc as unknown as RawRpc).call(
    supabase,
    'crear_comprobante_borrador_fiscal',
    args,
  );
  if (error) return fail('COMP_CREAR_FISCAL', error.message, error);
  return ok({ id: data as string });
}

export async function anularComprobante(
  id: string,
  motivo: string,
): Promise<ApiResponse<{ id: string }>> {
  const { data, error } = await supabase.rpc('anular_comprobante', {
    p_comprobante_id: id,
    p_motivo: motivo,
  });
  if (error) return fail('COMP_ANULAR', error.message, error);
  return ok({ id: data as string });
}

// Paquete de blindaje al anular (decisión Pablo): el modal ofrece las
// correcciones. El RPC auto-cancela ARCA + recupero; el preview reporta el
// impacto (incl. partner borrador/pagada) para mostrarlo antes de confirmar.
export interface AnularPreview {
  tiene_cae: boolean;
  cobrado_a_credito: number;
  arca_pendientes: number;
  recupero_pendientes: number;
  partner_borrador: { count: number; monto: number };
  partner_pagada: { count: number; monto: number };
}

export async function anularComprobantePreview(
  id: string,
): Promise<ApiResponse<AnularPreview>> {
  const { data, error } = await supabase.rpc(
    'anular_comprobante_preview' as never,
    { p_comprobante_id: id } as never,
  );
  if (error) return fail('COMP_ANULAR_PREVIEW', error.message, error);
  return ok(data as AnularPreview);
}

export async function peekProximoNumero(
  puntoVenta: number,
  tipo: ComprobanteTipo,
): Promise<ApiResponse<number>> {
  const { data, error } = await supabase.rpc('peek_proximo_numero', {
    p_punto_venta: puntoVenta,
    p_tipo: tipo,
  });
  if (error) return fail('COMP_PEEK', error.message, error);
  return ok((data as number) ?? 1);
}

/**
 * #150 · Transforma un comprobante simple (tipo='X') en fiscal (A/B/C).
 * Asigna nuevo número del tipo destino y deja el comprobante en estado
 * 'borrador' listo para enviar a ARCA cuando se confirme.
 *
 * Valida: estado != 'anulado', tipo actual = 'X', emitido_arca = false.
 */
export async function transformarComprobanteAFiscal(
  comprobanteId: string,
  nuevoTipo: 'A' | 'B' | 'C',
): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.rpc('comprobante_transformar_a_fiscal' as never, {
    p_comprobante_id: comprobanteId,
    p_nuevo_tipo: nuevoTipo,
  } as never);
  if (error) return fail('COMP_TRANSFORMAR', error.message, error);
  return ok(data as string);
}
