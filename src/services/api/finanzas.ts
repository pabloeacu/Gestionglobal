import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

// DGG-Finanzas Bloque 1: dashboard + CRUD de movimientos + transferencias + reversiones.
// Capitaliza schema de 0005_ctacte_finanzas (cajas, movimientos, imputaciones).
// Las RPCs viven en mig 0055 con prefix `fz_`.

export type CajaRow = Database['public']['Tables']['cajas']['Row'];
export type CategoriaFinanzaRow = Database['public']['Tables']['categorias_finanzas']['Row'];
export type MovimientoRow = Database['public']['Tables']['movimientos']['Row'];

export interface CajaConSaldoRow {
  caja_id: string;
  nombre: string;
  tipo: string;
  moneda: string;
  color: string | null;
  icono: string | null;
  orden: number;
  activo: boolean;
  saldo: number;
  movs_pendientes: number;
}

export interface DashboardKpis {
  saldo_total: number;
  ingresos_mes: number;
  egresos_mes: number;
  movs_pendientes: number;
  cajas_activas: number;
}

export interface MovimientoListadoRow {
  id: string;
  caja_id: string;
  caja_nombre: string;
  caja_color: string | null;
  fecha: string;
  tipo: 'ingreso' | 'egreso' | 'transferencia_in' | 'transferencia_out';
  monto: number;
  categoria_id: string | null;
  categoria_nombre: string | null;
  descripcion: string | null;
  referencia: string | null;
  administracion_id: string | null;
  administracion_nombre: string | null;
  estado: 'pendiente_id' | 'identificado' | 'anulado';
  origen: string;
  revertido_at: string | null;
  transferencia_pair_id: string | null;
  movimiento_revertido_id: string | null;
  total_count: number;
}

// ────────────────────────────────────────────────────────────────
// Reads
// ────────────────────────────────────────────────────────────────

export async function getCajasConSaldo(): Promise<ApiResponse<CajaConSaldoRow[]>> {
  try {
    const { data, error } = await supabase
      .from('cajas_con_saldo')
      .select('*')
      .order('orden', { ascending: true });
    if (error) throw error;
    return ok((data ?? []).map((r) => ({
      caja_id: String((r as Record<string, unknown>).caja_id),
      nombre: String((r as Record<string, unknown>).nombre),
      tipo: String((r as Record<string, unknown>).tipo),
      moneda: String((r as Record<string, unknown>).moneda),
      color: ((r as Record<string, unknown>).color as string | null) ?? null,
      icono: ((r as Record<string, unknown>).icono as string | null) ?? null,
      orden: Number((r as Record<string, unknown>).orden ?? 0),
      activo: !!(r as Record<string, unknown>).activo,
      saldo: Number((r as Record<string, unknown>).saldo ?? 0),
      movs_pendientes: Number((r as Record<string, unknown>).movs_pendientes ?? 0),
    })));
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function getCaja(id: string): Promise<ApiResponse<CajaRow>> {
  try {
    const { data, error } = await supabase
      .from('cajas')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail('not_found', 'Caja no encontrada');
    return ok(data);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function listCategoriasFinanzas(): Promise<ApiResponse<CategoriaFinanzaRow[]>> {
  try {
    const { data, error } = await supabase
      .from('categorias_finanzas')
      .select('*')
      .eq('activo', true)
      .order('nombre', { ascending: true });
    if (error) throw error;
    return ok(data ?? []);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function getDashboardKpis(): Promise<ApiResponse<DashboardKpis>> {
  try {
    const { data, error } = await supabase.rpc('fz_dashboard_kpis');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return ok({
      saldo_total: Number(row?.saldo_total ?? 0),
      ingresos_mes: Number(row?.ingresos_mes ?? 0),
      egresos_mes: Number(row?.egresos_mes ?? 0),
      movs_pendientes: Number(row?.movs_pendientes ?? 0),
      cajas_activas: Number(row?.cajas_activas ?? 0),
    });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export interface ListarMovimientosFiltros {
  cajaId?: string | null;
  tipo?: 'ingreso' | 'egreso' | 'transferencia_in' | 'transferencia_out' | null;
  fechaDesde?: string | null;
  fechaHasta?: string | null;
  search?: string | null;
  incluirAnulados?: boolean;
  incluirRevertidos?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListarMovimientosResult {
  rows: MovimientoListadoRow[];
  total: number;
}

export async function listarMovimientos(
  filtros: ListarMovimientosFiltros = {},
): Promise<ApiResponse<ListarMovimientosResult>> {
  try {
    const { data, error } = await supabase.rpc('fz_listar_movimientos', {
      p_caja_id: filtros.cajaId ?? undefined,
      p_tipo: filtros.tipo ?? undefined,
      p_fecha_desde: filtros.fechaDesde ?? undefined,
      p_fecha_hasta: filtros.fechaHasta ?? undefined,
      p_search: filtros.search ?? undefined,
      p_incluir_anulados: filtros.incluirAnulados ?? false,
      p_incluir_revertidos: filtros.incluirRevertidos ?? true,
      p_limit: filtros.limit ?? 50,
      p_offset: filtros.offset ?? 0,
    });
    if (error) throw error;
    const rows = (data ?? []) as MovimientoListadoRow[];
    const total = rows[0] ? Number(rows[0].total_count) : 0;
    return ok({ rows, total });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// ────────────────────────────────────────────────────────────────
// Writes
// ────────────────────────────────────────────────────────────────

export interface CrearMovimientoInput {
  cajaId: string;
  tipo: 'ingreso' | 'egreso';
  monto: number;
  fecha: string;
  categoriaId?: string | null;
  descripcion?: string | null;
  referencia?: string | null;
  administracionId?: string | null;
  consorcioId?: string | null;
  imputarAComprobanteId?: string | null;
  partnerIdAtribucion?: string | null; // #145 · flag "participa partner"
}

export async function crearMovimientoManual(
  input: CrearMovimientoInput,
): Promise<ApiResponse<string>> {
  try {
    const args: Record<string, unknown> = {
      p_caja_id: input.cajaId,
      p_tipo: input.tipo,
      p_monto: input.monto,
      p_fecha: input.fecha,
      p_categoria_id: input.categoriaId ?? undefined,
      p_descripcion: input.descripcion ?? undefined,
      p_referencia: input.referencia ?? undefined,
      p_administracion_id: input.administracionId ?? undefined,
      p_consorcio_id: input.consorcioId ?? undefined,
      p_comprobante_imputar_a_id: input.imputarAComprobanteId ?? undefined,
    };
    if (input.partnerIdAtribucion) {
      args.p_partner_id_atribucion = input.partnerIdAtribucion;
    }
    // Cast: tipos no regenerados aún, pero la RPC ya acepta el param (mig 0101).
    const { data, error } = await supabase.rpc(
      'fz_crear_movimiento_manual',
      args as unknown as {
        p_caja_id: string;
        p_tipo: string;
        p_monto: number;
        p_fecha: string;
      },
    );
    if (error) throw error;
    return ok(String(data));
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export interface CrearTransferenciaInput {
  cajaOrigenId: string;
  cajaDestinoId: string;
  monto: number;
  fecha: string;
  descripcion?: string | null;
  referencia?: string | null;
}

export async function crearTransferencia(
  input: CrearTransferenciaInput,
): Promise<ApiResponse<string>> {
  try {
    const { data, error } = await supabase.rpc('fz_crear_transferencia', {
      p_caja_origen_id: input.cajaOrigenId,
      p_caja_destino_id: input.cajaDestinoId,
      p_monto: input.monto,
      p_fecha: input.fecha,
      p_descripcion: input.descripcion ?? undefined,
      p_referencia: input.referencia ?? undefined,
    });
    if (error) throw error;
    return ok(String(data));
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function revertirMovimiento(
  movimientoId: string,
  motivo?: string,
): Promise<ApiResponse<string>> {
  try {
    const { data, error } = await supabase.rpc('fz_revertir_movimiento', {
      p_movimiento_id: movimientoId,
      p_motivo: motivo ?? undefined,
    });
    if (error) throw error;
    return ok(String(data));
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function anularMovimiento(
  movimientoId: string,
  motivo?: string,
): Promise<ApiResponse<true>> {
  try {
    const { error } = await supabase.rpc('fz_anular_movimiento', {
      p_movimiento_id: movimientoId,
      p_motivo: motivo ?? undefined,
    });
    if (error) throw error;
    return ok(true as const);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// ────────────────────────────────────────────────────────────────
// Bloque 2 · Conciliación bancaria
// ────────────────────────────────────────────────────────────────

export interface HistoricoLineaInput {
  fecha: string; // YYYY-MM-DD
  descripcion: string;
  ingreso: number;
  egreso: number;
  observaciones?: string | null;
  saldo?: number | null;
}

export interface ImportarLoteResult {
  lote_id: string;
  total: number;
  nuevas: number;
  duplicadas: number;
}

export async function importarHistoricoLote(
  cajaId: string,
  lineas: HistoricoLineaInput[],
  archivoNombre?: string,
  observaciones?: string,
): Promise<ApiResponse<ImportarLoteResult>> {
  try {
    const { data, error } = await supabase.rpc('fz_importar_historico_lote', {
      p_caja_id: cajaId,
      p_lineas: lineas as unknown as Database['public']['Tables']['historico_banco']['Row'][],
      p_archivo_nombre: archivoNombre ?? undefined,
      p_observaciones: observaciones ?? undefined,
    });
    if (error) throw error;
    const r = data as unknown as ImportarLoteResult;
    return ok(r);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export interface HistoricoPendienteRow {
  id: string;
  caja_id: string;
  caja_nombre: string;
  fecha: string;
  descripcion: string;
  ingreso: number;
  egreso: number;
  observaciones: string | null;
  saldo: number | null;
  monto_efectivo: number;
  tipo_efectivo: 'ingreso' | 'egreso';
  total_count: number;
}

export async function listarHistoricoPendientes(
  cajaId: string,
  limit = 100,
  offset = 0,
): Promise<ApiResponse<{ rows: HistoricoPendienteRow[]; total: number }>> {
  try {
    const { data, error } = await supabase.rpc('fz_listar_historico_pendientes', {
      p_caja_id: cajaId,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw error;
    const rows = (data ?? []) as HistoricoPendienteRow[];
    const total = rows[0] ? Number(rows[0].total_count) : 0;
    return ok({ rows, total });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export interface SugerenciaMatchRow {
  movimiento_id: string;
  fecha: string;
  tipo: string;
  monto: number;
  descripcion: string | null;
  categoria_nombre: string | null;
  administracion_nombre: string | null;
  dias_diff: number;
  score: number;
}

export async function sugerirMatches(
  historicoId: string,
): Promise<ApiResponse<SugerenciaMatchRow[]>> {
  try {
    const { data, error } = await supabase.rpc('fz_sugerir_matches', {
      p_historico_id: historicoId,
    });
    if (error) throw error;
    return ok((data ?? []) as SugerenciaMatchRow[]);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function conciliarManual(
  historicoId: string,
  movimientoId: string,
): Promise<ApiResponse<true>> {
  try {
    const { error } = await supabase.rpc('fz_conciliar_manual', {
      p_historico_id: historicoId,
      p_movimiento_id: movimientoId,
    });
    if (error) throw error;
    return ok(true as const);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export interface CrearMovDesdeHistoricoInput {
  historicoId: string;
  categoriaId?: string | null;
  administracionId?: string | null;
  descripcionCustom?: string | null;
  guardarPatron?: boolean;
}

export async function crearMovDesdeHistorico(
  input: CrearMovDesdeHistoricoInput,
): Promise<ApiResponse<string>> {
  try {
    const { data, error } = await supabase.rpc('fz_crear_mov_desde_historico', {
      p_historico_id: input.historicoId,
      p_categoria_id: input.categoriaId ?? undefined,
      p_administracion_id: input.administracionId ?? undefined,
      p_descripcion_custom: input.descripcionCustom ?? undefined,
      p_guardar_patron: input.guardarPatron ?? false,
    });
    if (error) throw error;
    return ok(String(data));
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function ignorarLineaHistorico(
  historicoId: string,
  motivo?: string,
): Promise<ApiResponse<true>> {
  try {
    const { error } = await supabase.rpc('fz_ignorar_linea_historico', {
      p_historico_id: historicoId,
      p_motivo: motivo ?? undefined,
    });
    if (error) throw error;
    return ok(true as const);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export interface ConciliacionKpis {
  total_lineas: number;
  pendientes: number;
  conciliadas: number;
  ignoradas: number;
}

export async function getConciliacionKpis(cajaId?: string): Promise<ApiResponse<ConciliacionKpis>> {
  try {
    const { data, error } = await supabase.rpc('fz_conciliacion_kpis', {
      p_caja_id: cajaId ?? undefined,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return ok({
      total_lineas: Number(row?.total_lineas ?? 0),
      pendientes: Number(row?.pendientes ?? 0),
      conciliadas: Number(row?.conciliadas ?? 0),
      ignoradas: Number(row?.ignoradas ?? 0),
    });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// Helper para autocomplete de administraciones (usado en NuevoMovimientoModal)
export async function buscarAdministraciones(
  search: string,
  limit = 10,
): Promise<ApiResponse<Array<{ id: string; nombre: string; codigo: string | null }>>> {
  try {
    if (!search || search.trim().length < 2) return ok([]);
    const s = search.trim();
    const { data, error } = await supabase
      .from('administraciones')
      .select('id, nombre, codigo')
      .or(`nombre.ilike.%${s}%,codigo.ilike.%${s}%,cuit.ilike.%${s}%`)
      .limit(limit);
    if (error) throw error;
    return ok((data ?? []) as Array<{ id: string; nombre: string; codigo: string | null }>);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}
