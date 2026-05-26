import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

// ============================================================================
// Tipos y constantes
// ============================================================================
export type VencimientoRow = Database['public']['Tables']['vencimientos']['Row'];
export type VencimientoInsert =
  Database['public']['Tables']['vencimientos']['Insert'];
export type VencimientoUpdate =
  Database['public']['Tables']['vencimientos']['Update'];

export type VencimientoConfigRow =
  Database['public']['Tables']['vencimientos_config']['Row'];
export type VencimientoConfigUpdate =
  Database['public']['Tables']['vencimientos_config']['Update'];

export const VENCIMIENTO_TIPOS = [
  'matricula_rpac',
  'ddjj_anual',
  'certificado_arca',
  'seguro_consorcio',
  'habilitacion_municipal',
  'libro_actas',
  'libro_administracion',
  'revision_ascensor',
  'otro',
] as const;
export type VencimientoTipo = (typeof VENCIMIENTO_TIPOS)[number];

export const VENCIMIENTO_TIPO_LABEL: Record<VencimientoTipo, string> = {
  matricula_rpac: 'Matrícula RPAC',
  ddjj_anual: 'Declaración Jurada anual',
  certificado_arca: 'Certificado ARCA',
  seguro_consorcio: 'Seguro del consorcio',
  habilitacion_municipal: 'Habilitación municipal',
  libro_actas: 'Libro de actas',
  libro_administracion: 'Libro de administración',
  revision_ascensor: 'Revisión de ascensor',
  otro: 'Otro',
};

export const VENCIMIENTO_ESTADOS = [
  'vigente',
  'vencido',
  'renovado',
  'cancelado',
] as const;
export type VencimientoEstado = (typeof VENCIMIENTO_ESTADOS)[number];

export const VENCIMIENTO_ESTADO_LABEL: Record<VencimientoEstado, string> = {
  vigente: 'Vigente',
  vencido: 'Vencido',
  renovado: 'Renovado',
  cancelado: 'Cancelado',
};

export const VENCIMIENTO_SUJETOS = ['administracion', 'consorcio'] as const;
export type VencimientoSujeto = (typeof VENCIMIENTO_SUJETOS)[number];

// ============================================================================
// Listado con joins (gerencia)
// ============================================================================
export interface VencimientoListItem extends VencimientoRow {
  administracion_nombre: string | null;
  consorcio_nombre: string | null;
}

interface RawListRow extends VencimientoRow {
  administraciones: { id: string; nombre: string } | null;
  consorcios: { id: string; nombre: string } | null;
}

function mapRaw(r: RawListRow): VencimientoListItem {
  return {
    ...(r as VencimientoRow),
    administracion_nombre: r.administraciones?.nombre ?? null,
    consorcio_nombre: r.consorcios?.nombre ?? null,
  };
}

export interface ListVencimientosParams {
  search?: string;
  tipo?: VencimientoTipo | 'todos';
  estado?: VencimientoEstado | 'todos';
  administracionId?: string;
  consorcioId?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  limit?: number;
  offset?: number;
}

export async function listVencimientos(
  params: ListVencimientosParams = {},
): Promise<ApiResponse<{ rows: VencimientoListItem[]; total: number }>> {
  const limit = params.limit ?? 200;
  const offset = params.offset ?? 0;

  let q = supabase
    .from('vencimientos')
    .select(
      `*,
       administraciones(id,nombre),
       consorcios(id,nombre)`,
      { count: 'exact' },
    )
    .order('fecha_vencimiento', { ascending: true })
    .range(offset, offset + limit - 1);

  if (params.tipo && params.tipo !== 'todos') q = q.eq('tipo', params.tipo);
  if (params.estado && params.estado !== 'todos') q = q.eq('estado', params.estado);
  if (params.administracionId) q = q.eq('administracion_id', params.administracionId);
  if (params.consorcioId) q = q.eq('consorcio_id', params.consorcioId);
  if (params.fechaDesde) q = q.gte('fecha_vencimiento', params.fechaDesde);
  if (params.fechaHasta) q = q.lte('fecha_vencimiento', params.fechaHasta);

  if (params.search && params.search.trim().length > 0) {
    const s = params.search.trim();
    q = q.or(`descripcion.ilike.%${s}%,observaciones.ilike.%${s}%`);
  }

  const { data, error, count } = await q;
  if (error) return fail('VENC_LIST', error.message, error);
  return ok({
    rows:
      (data as unknown as RawListRow[] | null)?.map(mapRaw) ?? [],
    total: count ?? 0,
  });
}

// ============================================================================
// RPC · proximos_vencimientos
// ============================================================================
export interface ProximoVencimiento {
  id: string;
  tipo: VencimientoTipo;
  sujeto: VencimientoSujeto;
  sujeto_id: string;
  administracion_id: string;
  administracion_nombre: string;
  consorcio_id: string | null;
  consorcio_nombre: string | null;
  fecha_vencimiento: string;
  fecha_emision: string | null;
  dias_restantes: number;
  descripcion: string | null;
  observaciones: string | null;
  estado: VencimientoEstado;
  sugerencia_servicio_slug: string | null;
  alerta_30d_enviada: string | null;
  alerta_20d_enviada: string | null;
  alerta_10d_enviada: string | null;
}

export async function getProximosVencimientos(
  diasAdelante = 90,
  administracionId?: string,
): Promise<ApiResponse<ProximoVencimiento[]>> {
  const { data, error } = await supabase.rpc('proximos_vencimientos', {
    p_administracion_id: administracionId ?? undefined,
    p_dias: diasAdelante,
  });
  if (error) return fail('VENC_PROXIMOS', error.message, error);
  return ok((data ?? []) as ProximoVencimiento[]);
}

// ============================================================================
// CRUD
// ============================================================================
export interface CrearVencimientoInput {
  tipo: VencimientoTipo;
  sujeto: VencimientoSujeto;
  sujeto_id: string;
  administracion_id: string;
  consorcio_id?: string | null;
  fecha_vencimiento: string;
  fecha_emision?: string | null;
  descripcion?: string | null;
  observaciones?: string | null;
}

export async function crearVencimiento(
  input: CrearVencimientoInput,
): Promise<ApiResponse<VencimientoRow>> {
  const { data, error } = await supabase
    .from('vencimientos')
    .insert({
      tipo: input.tipo,
      sujeto: input.sujeto,
      sujeto_id: input.sujeto_id,
      administracion_id: input.administracion_id,
      consorcio_id: input.consorcio_id ?? null,
      fecha_vencimiento: input.fecha_vencimiento,
      fecha_emision: input.fecha_emision ?? null,
      descripcion: input.descripcion ?? null,
      observaciones: input.observaciones ?? null,
    })
    .select()
    .single();
  if (error) return fail('VENC_CREATE', error.message, error);
  return ok(data);
}

export type ActualizarVencimientoPatch = Partial<{
  tipo: VencimientoTipo;
  fecha_vencimiento: string;
  fecha_emision: string | null;
  descripcion: string | null;
  observaciones: string | null;
  consorcio_id: string | null;
  estado: VencimientoEstado;
}>;

export async function actualizarVencimiento(
  id: string,
  patch: ActualizarVencimientoPatch,
): Promise<ApiResponse<VencimientoRow>> {
  const { data, error } = await supabase
    .from('vencimientos')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('VENC_UPDATE', error.message, error);
  return ok(data);
}

export async function marcarRenovado(
  id: string,
  nuevaFechaVencimiento: string,
): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.rpc('marcar_renovado', {
    p_vencimiento_id: id,
    p_nueva_fecha_vencimiento: nuevaFechaVencimiento,
  });
  if (error) return fail('VENC_RENOVAR', error.message, error);
  return ok(data as string);
}

// DGG-34 / P5-6.B · Bulk renovar. ids[] y nuevasFechas[] paralelos. Atómico.
export async function marcarRenovadosMasivo(
  ids: string[],
  nuevasFechas: string[],
): Promise<ApiResponse<Array<{ original_id: string; nuevo_id: string }>>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    'marcar_renovados_masivo',
    { p_ids: ids, p_nuevas_fechas: nuevasFechas },
  );
  if (error) return fail('VENC_RENOVAR_MASIVO', error.message, error);
  return ok(
    (data ?? []) as Array<{ original_id: string; nuevo_id: string }>,
  );
}

export async function cancelarVencimiento(
  id: string,
): Promise<ApiResponse<true>> {
  const { error } = await supabase
    .from('vencimientos')
    .update({ estado: 'cancelado' })
    .eq('id', id);
  if (error) return fail('VENC_CANCEL', error.message, error);
  return ok(true);
}

// ============================================================================
// Config
// ============================================================================
export async function listConfig(
  administracionId?: string | null,
): Promise<ApiResponse<VencimientoConfigRow[]>> {
  let q = supabase
    .from('vencimientos_config')
    .select('*')
    .order('tipo', { ascending: true });

  if (administracionId === null) {
    q = q.is('administracion_id', null);
  } else if (administracionId) {
    q = q.eq('administracion_id', administracionId);
  }

  const { data, error } = await q;
  if (error) return fail('VENC_CFG_LIST', error.message, error);
  return ok((data ?? []) as VencimientoConfigRow[]);
}

export async function actualizarConfig(
  id: string,
  patch: VencimientoConfigUpdate,
): Promise<ApiResponse<VencimientoConfigRow>> {
  const { data, error } = await supabase
    .from('vencimientos_config')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('VENC_CFG_UPDATE', error.message, error);
  return ok(data);
}

// ============================================================================
// Helpers UI
// ============================================================================
export type Criticidad = 'critica' | 'proxima' | 'lejana' | 'vencida';

export function criticidad(diasRestantes: number): Criticidad {
  if (diasRestantes < 0) return 'vencida';
  if (diasRestantes < 10) return 'critica';
  if (diasRestantes < 30) return 'proxima';
  return 'lejana';
}

export const CRITICIDAD_BADGE: Record<Criticidad, string> = {
  vencida: 'bg-red-50 text-red-700 border-red-200',
  critica: 'bg-red-50 text-red-700 border-red-200',
  proxima: 'bg-amber-50 text-amber-700 border-amber-200',
  lejana: 'bg-slate-100 text-slate-600 border-slate-200',
};

export const CRITICIDAD_LABEL: Record<Criticidad, string> = {
  vencida: 'Vencido',
  critica: 'Crítico',
  proxima: 'Próximo',
  lejana: 'Lejano',
};

export function diasHastaFecha(fechaIso: string): number {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const f = new Date(fechaIso + 'T00:00:00');
  return Math.round((f.getTime() - hoy.getTime()) / 86_400_000);
}
