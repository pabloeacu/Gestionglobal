import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, type ApiResponse } from '@/lib/errors';

// DGG-23 · Finanzas Bloque 3
// - 3.A · CRUD cajas + categorías (mig 0058)
// - 3.B · Reportes financieros (mig 0059)
// - 3.C · Importador histórico masivo (mig 0060)
//
// NOTA: los types de Database aún no incluyen los nuevos RPCs `fz_*` porque
// no se regeneraron (token de Supabase pendiente del usuario). Para evitar
// errores TS y mantener type-safety local, envolvemos rpc() con un wrapper
// que preserva el this binding (regla: extraer un método pierde `this`).
type RpcResult<T> = Promise<{ data: T | null; error: { message: string } | null }>;
function rpc<T>(name: string, params?: Record<string, unknown>): RpcResult<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase.rpc as any)(name, params) as RpcResult<T>;
}

// ────────────────────────────────────────────────────────────────
// 3.A · Cajas custom
// ────────────────────────────────────────────────────────────────

export type CajaTipo = 'banco' | 'billetera_virtual' | 'plazo_fijo' | 'efectivo';

export interface CajaAdminRow {
  caja_id: string;
  nombre: string;
  tipo: CajaTipo;
  moneda: string;
  color: string | null;
  icono: string | null;
  orden: number;
  activo: boolean;
  cbu: string | null;
  alias: string | null;
  numero_cuenta: string | null;
  banco_entidad: string | null;
  saldo: number;
  cantidad_movimientos: number;
  created_at: string;
  // JL-CAJA · agregado por mig 0174. El RPC fz_listar_cajas_admin puede que
  // no devuelva el campo todavía (depende de su SELECT). El frontend hace
  // fallback con `?? false`.
  es_default?: boolean;
}

export interface CrearCajaInput {
  nombre: string;
  tipo: CajaTipo;
  moneda?: 'ARS' | 'USD';
  color?: string | null;
  icono?: string | null;
  cbu?: string | null;
  alias?: string | null;
  numero_cuenta?: string | null;
  banco_entidad?: string | null;
}

export interface ActualizarCajaInput {
  cajaId: string;
  nombre: string;
  tipo?: CajaTipo;              // JL-CAJA #1 (mig 0174)
  color?: string | null;
  icono?: string | null;
  orden?: number | null;
  cbu?: string | null;
  alias?: string | null;
  numero_cuenta?: string | null;
  banco_entidad?: string | null;
  es_default?: boolean;         // JL-CAJA #3 (mig 0174)
}

export async function listarCajasAdmin(
  incluirArchivadas = true,
): Promise<ApiResponse<CajaAdminRow[]>> {
  try {
    const { data, error } = await rpc('fz_listar_cajas_admin', {
      p_incluir_archivadas: incluirArchivadas,
    });
    if (error) throw error;
    return ok(((data ?? []) as unknown) as CajaAdminRow[]);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function crearCaja(input: CrearCajaInput): Promise<ApiResponse<string>> {
  try {
    const { data, error } = await rpc('fz_caja_crear', {
      p_nombre: input.nombre,
      p_tipo: input.tipo,
      p_moneda: input.moneda ?? 'ARS',
      p_color: input.color ?? undefined,
      p_icono: input.icono ?? undefined,
      p_cbu: input.cbu ?? undefined,
      p_alias: input.alias ?? undefined,
      p_numero_cuenta: input.numero_cuenta ?? undefined,
      p_banco_entidad: input.banco_entidad ?? undefined,
    });
    if (error) throw error;
    return ok(String(data));
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function actualizarCaja(input: ActualizarCajaInput): Promise<ApiResponse<true>> {
  try {
    const { error } = await rpc('fz_caja_actualizar', {
      p_caja_id: input.cajaId,
      p_nombre: input.nombre,
      p_tipo: input.tipo ?? undefined,         // JL-CAJA #1
      p_color: input.color ?? undefined,
      p_icono: input.icono ?? undefined,
      p_orden: input.orden ?? undefined,
      p_cbu: input.cbu ?? undefined,
      p_alias: input.alias ?? undefined,
      p_numero_cuenta: input.numero_cuenta ?? undefined,
      p_banco_entidad: input.banco_entidad ?? undefined,
      p_es_default: input.es_default ?? undefined,  // JL-CAJA #3
    });
    if (error) throw error;
    return ok(true as const);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// JL-CAJA #2 (mig 0174) · hard delete (con check de saldo y de historial).
export async function eliminarCaja(cajaId: string): Promise<ApiResponse<true>> {
  try {
    const { error } = await rpc('fz_caja_eliminar', { p_caja_id: cajaId });
    if (error) throw error;
    return ok(true as const);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// JL-CAJA #3 (mig 0174) · setea es_default=true y desmarca las demás.
export async function marcarCajaDefault(cajaId: string): Promise<ApiResponse<true>> {
  try {
    const { error } = await rpc('fz_caja_marcar_default', { p_caja_id: cajaId });
    if (error) throw error;
    return ok(true as const);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function archivarCaja(cajaId: string): Promise<ApiResponse<true>> {
  try {
    const { error } = await rpc('fz_caja_archivar', { p_caja_id: cajaId });
    if (error) throw error;
    return ok(true as const);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function reactivarCaja(cajaId: string): Promise<ApiResponse<true>> {
  try {
    const { error } = await rpc('fz_caja_reactivar', { p_caja_id: cajaId });
    if (error) throw error;
    return ok(true as const);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// ────────────────────────────────────────────────────────────────
// 3.A · Categorías custom
// ────────────────────────────────────────────────────────────────

export type CategoriaTipo = 'ingreso' | 'egreso' | 'ambos';

export interface CategoriaAdminRow {
  categoria_id: string;
  nombre: string;
  tipo: CategoriaTipo;
  color: string | null;
  icono: string | null;
  activo: boolean;
  cantidad_movimientos: number;
  created_at: string;
}

export async function listarCategoriasAdmin(
  incluirArchivadas = true,
): Promise<ApiResponse<CategoriaAdminRow[]>> {
  try {
    const { data, error } = await rpc('fz_listar_categorias_admin', {
      p_incluir_archivadas: incluirArchivadas,
    });
    if (error) throw error;
    return ok(((data ?? []) as unknown) as CategoriaAdminRow[]);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function crearCategoria(input: {
  nombre: string;
  tipo: CategoriaTipo;
  color?: string | null;
  icono?: string | null;
}): Promise<ApiResponse<string>> {
  try {
    const { data, error } = await rpc('fz_categoria_crear', {
      p_nombre: input.nombre,
      p_tipo: input.tipo,
      p_color: input.color ?? undefined,
      p_icono: input.icono ?? undefined,
    });
    if (error) throw error;
    return ok(String(data));
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function actualizarCategoria(input: {
  categoriaId: string;
  nombre: string;
  tipo: CategoriaTipo;
  color?: string | null;
  icono?: string | null;
}): Promise<ApiResponse<true>> {
  try {
    const { error } = await rpc('fz_categoria_actualizar', {
      p_categoria_id: input.categoriaId,
      p_nombre: input.nombre,
      p_tipo: input.tipo,
      p_color: input.color ?? undefined,
      p_icono: input.icono ?? undefined,
    });
    if (error) throw error;
    return ok(true as const);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function archivarCategoria(categoriaId: string): Promise<ApiResponse<true>> {
  try {
    const { error } = await rpc('fz_categoria_archivar', {
      p_categoria_id: categoriaId,
    });
    if (error) throw error;
    return ok(true as const);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function reactivarCategoria(categoriaId: string): Promise<ApiResponse<true>> {
  try {
    const { error } = await rpc('fz_categoria_reactivar', {
      p_categoria_id: categoriaId,
    });
    if (error) throw error;
    return ok(true as const);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// ────────────────────────────────────────────────────────────────
// 3.B · Reportes financieros
// ────────────────────────────────────────────────────────────────

export interface FlujoCajaRow {
  mes_num: number;
  mes_label: string;
  mes_inicio: string;
  ingresos: number;
  egresos: number;
  neto: number;
  saldo_acumulado: number;
}

export async function getReporteFlujoCaja(
  anio?: number,
  cajaId?: string | null,
): Promise<ApiResponse<FlujoCajaRow[]>> {
  try {
    const { data, error } = await rpc('fz_reporte_flujo_caja', {
      p_anio: anio ?? undefined,
      p_caja_id: cajaId ?? undefined,
    });
    if (error) throw error;
    return ok(((data ?? []) as unknown) as FlujoCajaRow[]);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export interface BalanceMensualRow {
  caja_id: string;
  caja_nombre: string;
  caja_tipo: string;
  caja_color: string | null;
  mes_num: number;
  mes_label: string;
  saldo_inicial: number;
  ingresos: number;
  egresos: number;
  saldo_final: number;
}

export async function getReporteBalanceMensual(
  anio?: number,
  soloActivas = true,
): Promise<ApiResponse<BalanceMensualRow[]>> {
  try {
    const { data, error } = await rpc('fz_reporte_balance_mensual', {
      p_anio: anio ?? undefined,
      p_solo_activas: soloActivas,
    });
    if (error) throw error;
    return ok(((data ?? []) as unknown) as BalanceMensualRow[]);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export interface PygRow {
  categoria_id: string | null;
  categoria_nombre: string | null;
  categoria_tipo: string | null;
  categoria_color: string | null;
  tipo_movimiento: 'ingreso' | 'egreso';
  cantidad_movimientos: number;
  total: number;
}

export async function getReportePyG(
  desde?: string,
  hasta?: string,
): Promise<ApiResponse<PygRow[]>> {
  try {
    const { data, error } = await rpc('fz_reporte_pyg', {
      p_desde: desde ?? undefined,
      p_hasta: hasta ?? undefined,
    });
    if (error) throw error;
    return ok(((data ?? []) as unknown) as PygRow[]);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export interface ComparativoRow {
  mes_num: number;
  mes_label: string;
  ingresos_actual: number;
  ingresos_anterior: number;
  ingresos_var_pct: number | null;
  egresos_actual: number;
  egresos_anterior: number;
  egresos_var_pct: number | null;
  neto_actual: number;
  neto_anterior: number;
}

export async function getReporteComparativo(
  anio?: number,
): Promise<ApiResponse<ComparativoRow[]>> {
  try {
    const { data, error } = await rpc('fz_reporte_comparativo', {
      p_anio: anio ?? undefined,
    });
    if (error) throw error;
    return ok(((data ?? []) as unknown) as ComparativoRow[]);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// ────────────────────────────────────────────────────────────────
// 3.C · Importador histórico masivo
// ────────────────────────────────────────────────────────────────

export interface LineaImportacion {
  fecha: string;
  tipo: 'ingreso' | 'egreso';
  caja: string;
  categoria?: string;
  monto: number;
  descripcion?: string;
  administracion_codigo?: string;
  consorcio_codigo?: string;
  referencia?: string;
}

export interface ResultadoImportacion {
  lote_id: string | null;
  total: number;
  importadas: number;
  duplicadas: number;
  errores: number;
  detalles_errores: Array<{
    fila: number;
    error: string;
    linea: Record<string, unknown>;
  }>;
  dry_run: boolean;
}

export async function importarHistoricoMasivo(
  lineas: LineaImportacion[],
  options: {
    archivoNombre?: string;
    observaciones?: string;
    dryRun?: boolean;
  } = {},
): Promise<ApiResponse<ResultadoImportacion>> {
  try {
    const { data, error } = await rpc('fz_importar_historico_masivo', {
      p_lineas: lineas as unknown as Record<string, unknown>[],
      p_archivo_nombre: options.archivoNombre ?? undefined,
      p_observaciones: options.observaciones ?? undefined,
      p_dry_run: options.dryRun ?? false,
    });
    if (error) throw error;
    return ok(data as unknown as ResultadoImportacion);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export interface LoteHistoricoRow {
  lote_id: string;
  archivo_nombre: string | null;
  observaciones: string | null;
  total_lineas: number;
  total_importadas: number;
  total_duplicadas: number;
  total_errores: number;
  created_at: string;
  created_by_nombre: string | null;
}

export async function listarLotesHistorico(
  limit = 50,
  offset = 0,
): Promise<ApiResponse<LoteHistoricoRow[]>> {
  try {
    const { data, error } = await rpc('fz_listar_lotes_historico', {
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw error;
    return ok(((data ?? []) as unknown) as LoteHistoricoRow[]);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}
