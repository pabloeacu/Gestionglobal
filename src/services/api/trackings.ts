// ============================================================================
// services/api/trackings.ts · Sistema de Tracking (puntos 9-17 Flujo Maestro)
//
// "Tracking" es la INSTANCIA del servicio en una iteración (DJ 2025 ≠ DJ 2026).
// Físicamente vive sobre la tabla `tramites` (mig 0036 agregó servicio_id,
// periodo, parent_tracking_id, fecha_inicio/fin, documento_final_url) más
// `tracking_lineas` (avances categorizados) y dos tablas de configuración:
// `tracking_estados_config` y `tracking_categorias_config` (servicio_id=NULL
// = default global; row con servicio_id = override por servicio).
//
// Regla 4: nunca hacer supabase.from() desde componentes — usar este módulo.
// Regla 1: toda mutación pasa por RPC o INSERT auditado.
// ============================================================================
import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

// ----------------------------------------------------------------------------
// Tipos base (re-exportamos del schema)
// ----------------------------------------------------------------------------
export type TrackingRow = Database['public']['Tables']['tramites']['Row'];
export type TrackingLineaRow =
  Database['public']['Tables']['tracking_lineas']['Row'];
export type TrackingEstadoConfigRow =
  Database['public']['Tables']['tracking_estados_config']['Row'];
export type TrackingCategoriaConfigRow =
  Database['public']['Tables']['tracking_categorias_config']['Row'];

// Categorías default seedeadas (12 + custom). Source-of-truth: tracking_categorias_config (svc=NULL).
export const TRACKING_CATEGORIA_SLUGS = [
  'documentacion_recibida',
  'documentacion_observada',
  'tramite_enviado',
  'pendiente_cliente',
  'respuesta_organismo',
  'aprobacion',
  'rechazo',
  'recordatorio',
  'vencimiento',
  'seguimiento_interno',
  'certificado_emitido',
  'diploma_emitido',
  'custom',
] as const;
export type TrackingCategoriaSlug = (typeof TRACKING_CATEGORIA_SLUGS)[number];

// Estados default seedeados (10). Override por servicio vive en tracking_estados_config.
export const TRACKING_ESTADO_SLUGS = [
  'recibido',
  'pendiente_revision',
  'documentacion_incompleta',
  'enviado_gestoria',
  'en_proceso',
  'observado',
  'pendiente_cliente',
  'aprobado',
  'finalizado',
  'cancelado',
] as const;

// ----------------------------------------------------------------------------
// LIST con joins
// ----------------------------------------------------------------------------
export interface TrackingListItem extends TrackingRow {
  servicio_nombre: string | null;
  servicio_codigo: string | null;
  administracion_nombre: string | null;
  lineas_pendientes: number;  // líneas con alerta_en > now()
}

export interface ListTrackingsParams {
  search?: string;
  servicioId?: string;
  administracionId?: string;
  estado?: string;
  periodo?: string;
  limit?: number;
  offset?: number;
}

interface RawTracking extends TrackingRow {
  servicio: { id: string; nombre: string; codigo: string } | null;
  administracion: { id: string; nombre: string } | null;
}

export async function listTrackings(
  params: ListTrackingsParams = {},
): Promise<ApiResponse<{ rows: TrackingListItem[]; total: number }>> {
  const limit = params.limit ?? 200;
  const offset = params.offset ?? 0;

  let q = supabase
    .from('tramites')
    .select(
      `*,
       servicio:servicios(id,nombre,codigo),
       administracion:administraciones(id,nombre)`,
      { count: 'exact' },
    )
    .order('ultima_actividad_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (params.servicioId) q = q.eq('servicio_id', params.servicioId);
  if (params.administracionId) q = q.eq('administracion_id', params.administracionId);
  if (params.estado) q = q.eq('estado', params.estado);
  if (params.periodo) q = q.eq('periodo', params.periodo);
  if (params.search && params.search.trim().length > 0) {
    const s = params.search.trim();
    q = q.or(
      `titulo.ilike.%${s}%,codigo.ilike.%${s}%,periodo.ilike.%${s}%`,
    );
  }

  const { data, error, count } = await q;
  if (error) return fail('TRACKINGS_LIST', error.message, error);

  const ids = (data ?? []).map((r) => (r as RawTracking).id);
  let pendientesById = new Map<string, number>();
  if (ids.length > 0) {
    const { data: lpend } = await supabase
      .from('tracking_lineas')
      .select('tramite_id, alerta_en')
      .in('tramite_id', ids)
      .gt('alerta_en', new Date().toISOString());
    if (lpend) {
      for (const row of lpend as { tramite_id: string }[]) {
        pendientesById.set(row.tramite_id, (pendientesById.get(row.tramite_id) ?? 0) + 1);
      }
    }
  }

  const rows: TrackingListItem[] = ((data as unknown as RawTracking[]) ?? []).map((r) => ({
    ...r,
    servicio_nombre: r.servicio?.nombre ?? null,
    servicio_codigo: r.servicio?.codigo ?? null,
    administracion_nombre: r.administracion?.nombre ?? null,
    lineas_pendientes: pendientesById.get(r.id) ?? 0,
  }));

  return ok({ rows, total: count ?? 0 });
}

// ----------------------------------------------------------------------------
// DETAIL
// ----------------------------------------------------------------------------
// 2.G · vencimiento ligado al tracking (el más próximo vigente) — sirve para
// el panel "Próximas alarmas" del tab Resumen.
export interface TrackingVencimientoLigado {
  id: string;
  fecha_vencimiento: string;
  alarmas_offsets: number[];
  notificar_cliente: boolean;
  estado: string;
}

export interface TrackingDetail extends TrackingRow {
  // 2.D · sla_dias del servicio para el indicador de SLA del header.
  servicio: { id: string; nombre: string; codigo: string; sla_dias: number | null } | null;
  administracion: { id: string; nombre: string; email: string | null } | null;
  consorcio: { id: string; nombre: string } | null;
  parent: { id: string; periodo: string | null; estado: string } | null;
  lineas: TrackingLineaRow[];
  estados_disponibles: TrackingEstadoConfigRow[];
  categorias_disponibles: TrackingCategoriaConfigRow[];
  // 2.G · vencimiento ligado (DGG-07) si existe.
  vencimiento_ligado: TrackingVencimientoLigado | null;
}

export async function getTracking(id: string): Promise<ApiResponse<TrackingDetail>> {
  // NOTA: NO usamos el embed self-referencial `parent:tramites!fkey(...)`.
  // PostgREST resuelve los self-joins vía schema cache, que queda stale tras
  // agregar el FK por migración y rompe con "Could not find a relationship
  // between 'tramites' and 'tramites'". Traemos el parent con una query
  // separada — robusto e independiente del cache. (E-GG-04)
  const { data: t, error } = await supabase
    .from('tramites')
    .select(
      `*,
       servicio:servicios(id,nombre,codigo,sla_dias),
       administracion:administraciones(id,nombre,email),
       consorcio:consorcios(id,nombre)`,
    )
    .eq('id', id)
    .single();
  if (error) return fail('TRACKING_GET', error.message, error);

  const tt = t as unknown as TrackingRow & {
    servicio: TrackingDetail['servicio'];
    administracion: TrackingDetail['administracion'];
    consorcio: TrackingDetail['consorcio'];
    parent: TrackingDetail['parent'];
  };

  // Parent (continuación de tracking previo) — query separada.
  let parent: TrackingDetail['parent'] = null;
  if (tt.parent_tracking_id) {
    const { data: p } = await supabase
      .from('tramites')
      .select('id,periodo,estado')
      .eq('id', tt.parent_tracking_id)
      .maybeSingle();
    if (p) parent = p as TrackingDetail['parent'];
  }

  const [lineasRes, estadosRes, categoriasRes, vencRes] = await Promise.all([
    supabase
      .from('tracking_lineas')
      .select('*')
      .eq('tramite_id', id)
      .order('created_at', { ascending: false }),
    listEstadosConfig(tt.servicio_id ?? null),
    listCategoriasConfig(tt.servicio_id ?? null),
    // 2.G · vencimiento ligado al tracking (más próximo, prioriza vigentes).
    supabase
      .from('vencimientos')
      .select('id, fecha_vencimiento, alarmas_offsets, notificar_cliente, estado')
      .eq('tracking_id', id)
      .order('fecha_vencimiento', { ascending: true })
      .limit(1),
  ]);

  if (lineasRes.error) return fail('TRACKING_LINEAS', lineasRes.error.message, lineasRes.error);
  if (!estadosRes.ok) return estadosRes;
  if (!categoriasRes.ok) return categoriasRes;

  const vencRaw = (vencRes.data ?? [])[0] as TrackingVencimientoLigado | undefined;

  return ok({
    ...tt,
    parent,
    lineas: lineasRes.data ?? [],
    estados_disponibles: estadosRes.data,
    categorias_disponibles: categoriasRes.data,
    vencimiento_ligado: vencRaw ?? null,
  });
}

// ----------------------------------------------------------------------------
// AGREGAR LÍNEA (RPC)
// ----------------------------------------------------------------------------
export interface AgregarLineaInput {
  categoria: TrackingCategoriaSlug | string;
  descripcion: string;
  estado_asociado?: string | null;
  archivos_urls?: string[];
  alerta_en?: string | null;  // ISO timestamptz
  visible_cliente?: boolean;  // si true → encola email + push al cliente
}

export async function agregarLinea(
  trackingId: string,
  input: AgregarLineaInput,
): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.rpc('tracking_agregar_linea', {
    p_tramite_id: trackingId,
    p_categoria: input.categoria,
    p_descripcion: input.descripcion,
    p_estado_asociado: input.estado_asociado ?? undefined,
    p_archivos_urls: input.archivos_urls ?? [],
    p_alerta_en: input.alerta_en ?? undefined,
    p_visible_cliente: input.visible_cliente ?? false,
  } as never);
  if (error) return fail('TRACKING_LINEA_ADD', error.message, error);
  return ok(data as string);
}

// ----------------------------------------------------------------------------
// CERRAR TRACKING (RPC, staff only)
// ----------------------------------------------------------------------------
export async function cerrarTracking(
  trackingId: string,
  documentoUrl: string,
): Promise<ApiResponse<true>> {
  const { error } = await supabase.rpc('tracking_cerrar', {
    p_tramite_id: trackingId,
    p_documento_final_url: documentoUrl,
  });
  if (error) return fail('TRACKING_CERRAR', error.message, error);
  return ok(true);
}

// ----------------------------------------------------------------------------
// CERRAR CICLO + programar próximo vencimiento (mig 0040)
// Genera un vencimiento ligado al tracking con offsets de alarma personalizados
// y marca cycle_closed_at en la fila de tramites.
// ----------------------------------------------------------------------------
export interface CerrarCicloTrackingInput {
  trackingId: string;
  proximaFecha: string; // YYYY-MM-DD
  alarmasOffsets: number[];
  notificarCliente?: boolean;
}

export interface CerrarCicloTrackingResult {
  vencimientoId: string;
  alarmasPlanificadas: string[]; // YYYY-MM-DD
}

export async function cerrarCicloTracking(
  input: CerrarCicloTrackingInput,
): Promise<ApiResponse<CerrarCicloTrackingResult>> {
  const { data, error } = await supabase.rpc('tracking_cerrar_ciclo', {
    p_tracking_id: input.trackingId,
    p_proxima_fecha: input.proximaFecha,
    p_alarmas_offsets: input.alarmasOffsets,
    p_notificar_cliente: input.notificarCliente ?? true,
  });
  if (error) return fail('TRACKING_CERRAR_CICLO', error.message, error);
  const rows = (data ?? []) as Array<{
    vencimiento_id: string;
    alarmas_planificadas: string[];
  }>;
  const first = rows[0];
  if (!first) {
    return fail('TRACKING_CERRAR_CICLO_EMPTY', 'La RPC no devolvió filas.');
  }
  return ok({
    vencimientoId: first.vencimiento_id,
    alarmasPlanificadas: first.alarmas_planificadas ?? [],
  });
}

// ----------------------------------------------------------------------------
// 2.G · EDITAR cronograma de un vencimiento ya programado (modo edit del modal)
// Actualiza fecha + offsets + notificar_cliente. Pasa por la API de
// vencimientos (regla 4). Las alarmas se re-planifican en el próximo tick del
// cron dispatch-vencimientos (idempotente por tríada, mig 0041).
// ----------------------------------------------------------------------------
export async function actualizarVencimiento(input: {
  vencimientoId: string;
  proximaFecha: string;
  alarmasOffsets: number[];
  notificarCliente: boolean;
}): Promise<ApiResponse<true>> {
  const { error } = await supabase
    .from('vencimientos')
    .update({
      fecha_vencimiento: input.proximaFecha,
      alarmas_offsets: input.alarmasOffsets,
      notificar_cliente: input.notificarCliente,
    })
    .eq('id', input.vencimientoId);
  if (error) return fail('VENC_UPDATE_CRONOGRAMA', error.message, error);
  return ok(true);
}

// ----------------------------------------------------------------------------
// RECURRENCIA — historial del mismo cliente para un servicio
// ----------------------------------------------------------------------------
export async function historialPorCliente(
  administracionId: string,
  servicioSlug: string,
): Promise<ApiResponse<TrackingRow[]>> {
  const { data, error } = await supabase.rpc('tracking_historial_cliente', {
    p_administracion_id: administracionId,
    p_servicio_slug: servicioSlug,
  });
  if (error) return fail('TRACKING_HIST', error.message, error);
  return ok((data ?? []) as TrackingRow[]);
}

// ----------------------------------------------------------------------------
// CONFIG: estados (defaults + overrides por servicio)
// ----------------------------------------------------------------------------
export async function listEstadosConfig(
  servicioId: string | null,
): Promise<ApiResponse<TrackingEstadoConfigRow[]>> {
  // Defaults + (si se especifica servicio) overrides; merge por slug, override gana.
  const { data: defaults, error: e1 } = await supabase
    .from('tracking_estados_config')
    .select('*')
    .is('servicio_id', null)
    .order('orden', { ascending: true });
  if (e1) return fail('ESTADOS_DEFAULT', e1.message, e1);

  if (!servicioId) return ok(defaults ?? []);

  const { data: overrides, error: e2 } = await supabase
    .from('tracking_estados_config')
    .select('*')
    .eq('servicio_id', servicioId)
    .order('orden', { ascending: true });
  if (e2) return fail('ESTADOS_OVR', e2.message, e2);

  const map = new Map<string, TrackingEstadoConfigRow>();
  for (const d of defaults ?? []) map.set(d.slug, d);
  for (const o of overrides ?? []) map.set(o.slug, o);
  return ok(
    Array.from(map.values()).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)),
  );
}

export async function listCategoriasConfig(
  servicioId: string | null,
): Promise<ApiResponse<TrackingCategoriaConfigRow[]>> {
  const { data: defaults, error: e1 } = await supabase
    .from('tracking_categorias_config')
    .select('*')
    .is('servicio_id', null)
    .order('orden', { ascending: true });
  if (e1) return fail('CATEGS_DEFAULT', e1.message, e1);

  if (!servicioId) return ok(defaults ?? []);

  const { data: overrides, error: e2 } = await supabase
    .from('tracking_categorias_config')
    .select('*')
    .eq('servicio_id', servicioId)
    .order('orden', { ascending: true });
  if (e2) return fail('CATEGS_OVR', e2.message, e2);

  const map = new Map<string, TrackingCategoriaConfigRow>();
  for (const d of defaults ?? []) map.set(d.slug, d);
  for (const o of overrides ?? []) map.set(o.slug, o);
  return ok(
    Array.from(map.values()).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)),
  );
}

// CRUD config (staff only — RLS lo enforce)
export interface UpsertEstadoConfigInput {
  id?: string;
  servicio_id: string | null;
  slug: string;
  label: string;
  color?: string;
  orden?: number;
  es_final?: boolean;
}

export async function upsertEstadoConfig(
  input: UpsertEstadoConfigInput,
): Promise<ApiResponse<TrackingEstadoConfigRow>> {
  const payload = {
    id: input.id,
    servicio_id: input.servicio_id,
    slug: input.slug,
    label: input.label,
    color: input.color ?? 'slate',
    orden: input.orden ?? 0,
    es_final: input.es_final ?? false,
  };
  const { data, error } = await supabase
    .from('tracking_estados_config')
    .upsert(payload, { onConflict: 'servicio_id,slug' })
    .select()
    .single();
  if (error) return fail('ESTADO_UPSERT', error.message, error);
  return ok(data);
}

export async function deleteEstadoConfig(id: string): Promise<ApiResponse<true>> {
  const { error } = await supabase.from('tracking_estados_config').delete().eq('id', id);
  if (error) return fail('ESTADO_DEL', error.message, error);
  return ok(true);
}

export interface UpsertCategoriaConfigInput {
  id?: string;
  servicio_id: string | null;
  slug: string;
  label: string;
  icono?: string | null;
  color?: string;
  orden?: number;
}

export async function upsertCategoriaConfig(
  input: UpsertCategoriaConfigInput,
): Promise<ApiResponse<TrackingCategoriaConfigRow>> {
  const payload = {
    id: input.id,
    servicio_id: input.servicio_id,
    slug: input.slug,
    label: input.label,
    icono: input.icono ?? null,
    color: input.color ?? 'slate',
    orden: input.orden ?? 0,
  };
  const { data, error } = await supabase
    .from('tracking_categorias_config')
    .upsert(payload, { onConflict: 'servicio_id,slug' })
    .select()
    .single();
  if (error) return fail('CATEG_UPSERT', error.message, error);
  return ok(data);
}

export async function deleteCategoriaConfig(id: string): Promise<ApiResponse<true>> {
  const { error } = await supabase.from('tracking_categorias_config').delete().eq('id', id);
  if (error) return fail('CATEG_DEL', error.message, error);
  return ok(true);
}

// ----------------------------------------------------------------------------
// HELPERS UI
// ----------------------------------------------------------------------------
export const COLOR_BADGE: Record<string, string> = {
  cyan: 'bg-cyan-100 text-cyan-700 ring-cyan-200',
  teal: 'bg-teal-100 text-teal-700 ring-teal-200',
  amber: 'bg-amber-100 text-amber-700 ring-amber-200',
  red: 'bg-red-100 text-red-700 ring-red-200',
  emerald: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
};

export function colorBadge(color: string | null | undefined): string {
  const key = color ?? 'slate';
  return COLOR_BADGE[key] ?? COLOR_BADGE.slate ?? '';
}
