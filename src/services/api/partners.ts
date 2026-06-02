// Subsistema 6 (Documento Maestro): Partners + rendiciones (caso Funplata).
// API service · sigue el patrón ApiResponse<T> (regla 4, P-API-01).

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

// ============================================================================
// Tipos base (regla 4 — todo query vive acá)
// ============================================================================
export type PartnerRow = Database['public']['Tables']['partners']['Row'];
export type PartnerInsert = Database['public']['Tables']['partners']['Insert'];
export type PartnerUpdate = Database['public']['Tables']['partners']['Update'];

export type PartnerConvenioRow =
  Database['public']['Tables']['partner_convenios']['Row'];
export type PartnerConvenioInsert =
  Database['public']['Tables']['partner_convenios']['Insert'];

export type PartnerRendicionRow =
  Database['public']['Tables']['partner_rendiciones']['Row'];

export type PartnerAtribucionRow =
  Database['public']['Tables']['partner_atribuciones']['Row'];

export const CONDICION_IVA = [
  'responsable_inscripto',
  'monotributo',
  'exento',
  'consumidor_final',
  'no_alcanzado',
] as const;
export type CondicionIva = (typeof CONDICION_IVA)[number];

export const CONDICION_IVA_LABEL: Record<CondicionIva, string> = {
  responsable_inscripto: 'Responsable inscripto',
  monotributo: 'Monotributo',
  exento: 'Exento',
  consumidor_final: 'Consumidor final',
  no_alcanzado: 'No alcanzado',
};

export const RENDICION_ESTADOS = [
  'borrador',
  'cerrada',
  'pagada',
  'cancelada',
] as const;
export type RendicionEstado = (typeof RENDICION_ESTADOS)[number];

export const RENDICION_ESTADO_LABEL: Record<RendicionEstado, string> = {
  borrador: 'Borrador',
  cerrada: 'Cerrada',
  pagada: 'Pagada',
  cancelada: 'Cancelada',
};

export const RENDICION_ESTADO_BADGE: Record<RendicionEstado, string> = {
  borrador: 'bg-slate-100 text-slate-700 border-slate-200',
  cerrada: 'bg-amber-50 text-amber-700 border-amber-200',
  pagada: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelada: 'bg-red-50 text-red-700 border-red-200',
};

export const ATRIBUCION_TIPOS = ['ingreso', 'costo'] as const;
export type AtribucionTipo = (typeof ATRIBUCION_TIPOS)[number];

// ============================================================================
// Listado de partners
// ============================================================================
export interface ListPartnersParams {
  search?: string;
  activo?: boolean | 'todos';
  limit?: number;
  offset?: number;
}

export interface PartnerListItem extends PartnerRow {
  convenio_vigente_porc_ingresos: number | null;
  convenio_vigente_porc_costos: number | null;
}

// #145 · Listado mínimo para selectores (solo activos). Devuelve id + nombre.
export interface PartnerOpcion {
  id: string;
  nombre: string;
}
export async function listPartnersActivos(): Promise<ApiResponse<PartnerOpcion[]>> {
  const { data, error } = await supabase
    .from('partners')
    .select('id, nombre_legal')
    .eq('activo', true)
    .order('nombre_legal', { ascending: true });
  if (error) return fail('PARTNERS_OPCIONES', error.message, error);
  const rows = ((data ?? []) as Array<{ id: string; nombre_legal: string }>).map(
    (r) => ({ id: r.id, nombre: r.nombre_legal }),
  );
  return ok(rows);
}

// #149 · Vista del usuario role='partner': sus comprobantes asignados + rendiciones
export interface PartnerComprobanteRow {
  id: string;
  tipo: string;
  numero: number | null;
  punto_venta: number;
  fecha: string;
  vencimiento: string | null;
  total: number;
  estado: string;
  estado_cobranza: string;
  emitido_arca: boolean;
  receptor_razon_social: string;
  partner_facturado_at: string | null;
  partner_numero_externo: string | null;
}

export async function fetchPartnerMisComprobantes(): Promise<
  ApiResponse<PartnerComprobanteRow[]>
> {
  const { data, error } = await supabase.rpc('partner_mis_comprobantes' as never);
  if (error) return fail('PARTNER_MIS_COMP', error.message, error);
  return ok((data ?? []) as unknown as PartnerComprobanteRow[]);
}

// #153 · Partner marca un comprobante como facturado (sistema externo).
// Bloque G / obs 11: ahora acepta opcionalmente el PDF de la factura (URL en
// bucket partner-facturas) para que quede asociado al comprobante y descargable
// desde cliente, gerencia y partner.
// DGG-34 R4 sweep · sube el PDF de la factura del partner al bucket
// `partner-facturas` y devuelve la URL pública. Antes vivía como import
// dinámico de supabase en PartnerPortalPage (anti-patrón R4).
export async function subirFacturaPartner(
  comprobanteId: string,
  file: File,
): Promise<ApiResponse<string>> {
  const safe = file.name.replace(/[^\w.\-]/g, '_');
  const path = `${comprobanteId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}-${safe}`;
  const { error } = await supabase.storage
    .from('partner-facturas')
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) return fail('PARTNER_FACTURA_UPLOAD', error.message, error);
  const { data } = supabase.storage.from('partner-facturas').getPublicUrl(path);
  return ok(data.publicUrl);
}

export async function partnerMarcarFacturado(
  comprobanteId: string,
  numeroExterno: string,
  observacion?: string,
  pdfUrl?: string,
): Promise<ApiResponse<string>> {
  const args = {
    p_comprobante_id: comprobanteId,
    p_numero_externo: numeroExterno,
    p_observacion: observacion ?? null,
    p_pdf_url: pdfUrl ?? null,
  } as unknown as Record<string, unknown>;
  const { data, error } = await supabase.rpc(
    'partner_marcar_facturado' as never,
    args as never,
  );
  if (error) return fail('PARTNER_FACTURAR', error.message, error);
  return ok(data as unknown as string);
}

export interface PartnerRendicionResumen {
  id: string;
  periodo_desde: string;
  periodo_hasta: string;
  estado: string;
  total_ingresos_brutos: number;
  total_ingresos_atribuidos: number;
  total_costos_brutos: number;
  total_costos_atribuidos: number;
}

export async function fetchPartnerMisRendiciones(): Promise<
  ApiResponse<PartnerRendicionResumen[]>
> {
  const { data, error } = await supabase.rpc('partner_mis_rendiciones' as never);
  if (error) return fail('PARTNER_MIS_REND', error.message, error);
  return ok((data ?? []) as unknown as PartnerRendicionResumen[]);
}

// Bloque D / obs 8 · Detalle pormenorizado de movimientos del partner con
// saldo evolutivo. Sirve para la vista "Mi caja" estilo cuenta corriente.
export interface PartnerMovimientoRow {
  atribucion_id: string;
  fecha: string;
  tipo: 'ingreso' | 'egreso';
  cliente_nombre: string | null;
  servicio_nombre: string | null;
  comprobante_label: string;
  monto_base: number;
  porcentaje: number;
  monto_atribuido: number;
  saldo_running: number;
}

export async function fetchPartnerMovimientos(
  desde?: string | null,
  hasta?: string | null,
): Promise<ApiResponse<PartnerMovimientoRow[]>> {
  const args: Record<string, unknown> = {};
  if (desde) args.p_desde = desde;
  if (hasta) args.p_hasta = hasta;
  const { data, error } = await supabase.rpc(
    'partner_rendicion_movimientos' as never,
    args as never,
  );
  if (error) return fail('PARTNER_MOV', error.message, error);
  return ok((data ?? []) as unknown as PartnerMovimientoRow[]);
}

export async function listPartners(
  params: ListPartnersParams = {},
): Promise<ApiResponse<{ rows: PartnerListItem[]; total: number }>> {
  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;

  let q = supabase
    .from('partners')
    .select(
      `*, partner_convenios!partner_convenios_partner_id_fkey(
        porc_ingresos, porc_costos, vigencia_desde, vigencia_hasta, activo
      )`,
      { count: 'exact' },
    )
    .order('nombre_legal', { ascending: true })
    .range(offset, offset + limit - 1);

  if (params.activo !== undefined && params.activo !== 'todos') {
    q = q.eq('activo', params.activo);
  }
  if (params.search && params.search.trim().length > 0) {
    const s = params.search.trim();
    q = q.or(`nombre_legal.ilike.%${s}%,slug.ilike.%${s}%,cuit.ilike.%${s}%`);
  }

  const { data, error, count } = await q;
  if (error) return fail('PARTNERS_LIST', error.message, error);

  type RawRow = PartnerRow & {
    partner_convenios: Array<
      Pick<
        PartnerConvenioRow,
        'porc_ingresos' | 'porc_costos' | 'vigencia_desde' | 'vigencia_hasta' | 'activo'
      >
    >;
  };

  const today = new Date().toISOString().slice(0, 10);
  const rows: PartnerListItem[] = (data as unknown as RawRow[] | null ?? []).map(
    (r) => {
      const vigente = (r.partner_convenios ?? []).find(
        (c) =>
          c.activo &&
          c.vigencia_desde <= today &&
          (c.vigencia_hasta === null || c.vigencia_hasta >= today),
      );
      return {
        ...(r as PartnerRow),
        convenio_vigente_porc_ingresos: vigente?.porc_ingresos ?? null,
        convenio_vigente_porc_costos: vigente?.porc_costos ?? null,
      };
    },
  );

  return ok({ rows, total: count ?? 0 });
}

export async function getPartner(
  id: string,
): Promise<ApiResponse<PartnerRow>> {
  const { data, error } = await supabase
    .from('partners')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return fail('PARTNER_GET', error.message, error);
  return ok(data);
}

// ============================================================================
// CRUD partners
// ============================================================================
export interface CrearPartnerInput {
  slug: string;
  nombre_legal: string;
  cuit?: string | null;
  condicion_iva?: CondicionIva | null;
  email?: string | null;
  telefono?: string | null;
  domicilio?: string | null;
  observaciones?: string | null;
}

export async function crearPartner(
  input: CrearPartnerInput,
): Promise<ApiResponse<PartnerRow>> {
  const { data, error } = await supabase
    .from('partners')
    .insert({
      slug: input.slug,
      nombre_legal: input.nombre_legal,
      cuit: input.cuit ?? null,
      condicion_iva: input.condicion_iva ?? null,
      email: input.email ?? null,
      telefono: input.telefono ?? null,
      domicilio: input.domicilio ?? null,
      observaciones: input.observaciones ?? null,
    })
    .select()
    .single();
  if (error) return fail('PARTNER_CREATE', error.message, error);
  return ok(data);
}

export type ActualizarPartnerPatch = Partial<{
  nombre_legal: string;
  cuit: string | null;
  condicion_iva: CondicionIva | null;
  email: string | null;
  telefono: string | null;
  domicilio: string | null;
  observaciones: string | null;
}>;

export async function actualizarPartner(
  id: string,
  patch: ActualizarPartnerPatch,
): Promise<ApiResponse<PartnerRow>> {
  const { data, error } = await supabase
    .from('partners')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('PARTNER_UPDATE', error.message, error);
  return ok(data);
}

export async function setPartnerActivo(
  id: string,
  activo: boolean,
): Promise<ApiResponse<true>> {
  const { error } = await supabase
    .from('partners')
    .update({ activo })
    .eq('id', id);
  if (error) return fail('PARTNER_ACTIVO', error.message, error);
  return ok(true);
}

// ============================================================================
// Convenios
// ============================================================================
export async function listConvenios(
  partnerId: string,
): Promise<ApiResponse<PartnerConvenioRow[]>> {
  const { data, error } = await supabase
    .from('partner_convenios')
    .select('*')
    .eq('partner_id', partnerId)
    .order('vigencia_desde', { ascending: false });
  if (error) return fail('PCONV_LIST', error.message, error);
  return ok((data ?? []) as PartnerConvenioRow[]);
}

export interface CrearConvenioInput {
  partner_id: string;
  vigencia_desde: string;
  vigencia_hasta?: string | null;
  porc_ingresos: number;
  porc_costos: number;
  moneda?: 'ARS' | 'USD';
  observaciones?: string | null;
}

export async function crearConvenio(
  input: CrearConvenioInput,
): Promise<ApiResponse<PartnerConvenioRow>> {
  const { data, error } = await supabase
    .from('partner_convenios')
    .insert({
      partner_id: input.partner_id,
      vigencia_desde: input.vigencia_desde,
      vigencia_hasta: input.vigencia_hasta ?? null,
      porc_ingresos: input.porc_ingresos,
      porc_costos: input.porc_costos,
      moneda: input.moneda ?? 'ARS',
      activo: true,
      observaciones: input.observaciones ?? null,
    })
    .select()
    .single();
  if (error) return fail('PCONV_CREATE', error.message, error);
  return ok(data);
}

export async function cerrarConvenio(
  id: string,
  fechaHasta: string,
): Promise<ApiResponse<PartnerConvenioRow>> {
  const { data, error } = await supabase
    .from('partner_convenios')
    .update({ vigencia_hasta: fechaHasta, activo: false })
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('PCONV_CERRAR', error.message, error);
  return ok(data);
}

// ============================================================================
// Atribuciones
// ============================================================================
export interface ListAtribucionesParams {
  partnerId?: string;
  rendicionId?: string;
  tipo?: AtribucionTipo;
  desde?: string;
  hasta?: string;
}

export interface AtribucionListItem extends PartnerAtribucionRow {
  comprobante_resumen: string | null;
  movimiento_resumen: string | null;
}

export async function listAtribuciones(
  params: ListAtribucionesParams = {},
): Promise<ApiResponse<AtribucionListItem[]>> {
  let q = supabase
    .from('partner_atribuciones')
    .select(
      `*,
       comprobantes(id, tipo, numero, total, fecha),
       movimientos(id, fecha, monto, descripcion, tipo)`,
    )
    .order('created_at', { ascending: false })
    .limit(500);

  if (params.partnerId) q = q.eq('partner_id', params.partnerId);
  if (params.rendicionId) q = q.eq('rendicion_id', params.rendicionId);
  if (params.tipo) q = q.eq('tipo', params.tipo);

  const { data, error } = await q;
  if (error) return fail('PAT_LIST', error.message, error);

  type RawRow = PartnerAtribucionRow & {
    comprobantes: {
      id: string;
      tipo: string;
      numero: number | null;
      total: number;
      fecha: string;
    } | null;
    movimientos: {
      id: string;
      fecha: string;
      monto: number;
      descripcion: string | null;
      tipo: string;
    } | null;
  };

  const rows: AtribucionListItem[] = (data as unknown as RawRow[] | null ?? [])
    .filter(
      (r) =>
        !params.desde ||
        !params.hasta ||
        (r.comprobantes
          ? r.comprobantes.fecha >= params.desde &&
            r.comprobantes.fecha <= params.hasta
          : r.movimientos
            ? r.movimientos.fecha >= params.desde &&
              r.movimientos.fecha <= params.hasta
            : true),
    )
    .map((r) => ({
      ...(r as PartnerAtribucionRow),
      comprobante_resumen: r.comprobantes
        ? `${r.comprobantes.tipo} ${r.comprobantes.numero ?? '—'} · $${r.comprobantes.total}`
        : null,
      movimiento_resumen: r.movimientos
        ? `${r.movimientos.fecha} · $${r.movimientos.monto} · ${r.movimientos.descripcion ?? ''}`.trim()
        : null,
    }));

  return ok(rows);
}

// ============================================================================
// Rendiciones · RPCs
// ============================================================================
export async function crearRendicion(
  partnerId: string,
  desde: string,
  hasta: string,
): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.rpc('partner_crear_rendicion', {
    p_partner_id: partnerId,
    p_desde: desde,
    p_hasta: hasta,
  });
  if (error) return fail('PREND_CREATE', error.message, error);
  return ok(data as string);
}

export async function cerrarRendicion(
  id: string,
): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.rpc('partner_cerrar_rendicion', {
    p_rendicion_id: id,
  });
  if (error) return fail('PREND_CERRAR', error.message, error);
  return ok(data as string);
}

export async function anularRendicion(
  id: string,
  motivo: string,
): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.rpc('partner_anular_rendicion', {
    p_rendicion_id: id,
    p_motivo: motivo,
  });
  if (error) return fail('PREND_ANULAR', error.message, error);
  return ok(data as string);
}

export async function marcarRendicionPagada(
  id: string,
  comprobanteId?: string | null,
): Promise<ApiResponse<PartnerRendicionRow>> {
  const patch: Database['public']['Tables']['partner_rendiciones']['Update'] = {
    estado: 'pagada',
  };
  if (comprobanteId !== undefined) patch.comprobante_id = comprobanteId;
  const { data, error } = await supabase
    .from('partner_rendiciones')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('PREND_PAGADA', error.message, error);
  return ok(data);
}

// ============================================================================
// Listado rendiciones
// ============================================================================
export interface ListRendicionesParams {
  partnerId?: string;
  estado?: RendicionEstado | 'todos';
  limit?: number;
}

export interface RendicionListItem extends PartnerRendicionRow {
  partner_nombre: string | null;
}

export async function listRendiciones(
  params: ListRendicionesParams = {},
): Promise<ApiResponse<RendicionListItem[]>> {
  let q = supabase
    .from('partner_rendiciones')
    .select(`*, partners(id, nombre_legal, slug)`)
    .order('periodo_desde', { ascending: false })
    .limit(params.limit ?? 100);

  if (params.partnerId) q = q.eq('partner_id', params.partnerId);
  if (params.estado && params.estado !== 'todos') q = q.eq('estado', params.estado);

  const { data, error } = await q;
  if (error) return fail('PREND_LIST', error.message, error);

  type RawRow = PartnerRendicionRow & {
    partners: { id: string; nombre_legal: string; slug: string } | null;
  };

  const rows: RendicionListItem[] = (data as unknown as RawRow[] | null ?? []).map(
    (r) => ({
      ...(r as PartnerRendicionRow),
      partner_nombre: r.partners?.nombre_legal ?? null,
    }),
  );
  return ok(rows);
}

export interface RendicionConDetalle {
  rendicion: PartnerRendicionRow;
  partner: PartnerRow | null;
  atribuciones: AtribucionListItem[];
}

export async function getRendicion(
  id: string,
): Promise<ApiResponse<RendicionConDetalle>> {
  const { data: rend, error: e1 } = await supabase
    .from('partner_rendiciones')
    .select('*, partners(*)')
    .eq('id', id)
    .single();
  if (e1) return fail('PREND_GET', e1.message, e1);

  const atribRes = await listAtribuciones({ rendicionId: id });
  if (!atribRes.ok) return atribRes;

  type RawRow = PartnerRendicionRow & { partners: PartnerRow | null };
  const raw = rend as unknown as RawRow;

  return ok({
    rendicion: { ...(raw as PartnerRendicionRow) },
    partner: raw.partners ?? null,
    atribuciones: atribRes.data,
  });
}

// ============================================================================
// Helpers UI
// ============================================================================
export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${Number(n).toFixed(n % 1 === 0 ? 0 : 2)}%`;
}

export function fmtMoneda(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  }).format(Number(n));
}
