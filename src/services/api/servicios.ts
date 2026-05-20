import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

// ============================================================================
// Catálogo de servicios + Tabulador de costos (Subsistema 3 + 5 del DM).
// Patrón ApiResponse (P-API-01) · regla 4: nada de supabase.from() en
// componentes — todo query vive acá.
// ============================================================================

export type ServicioRow = Database['public']['Tables']['servicios']['Row'];
export type ServicioInsert = Database['public']['Tables']['servicios']['Insert'];
export type ServicioUpdate = Database['public']['Tables']['servicios']['Update'];
export type CategoriaServicioRow =
  Database['public']['Tables']['categorias_servicio']['Row'];
export type TabuladorPrecioRow =
  Database['public']['Tables']['tabulador_precios']['Row'];
export type TabuladorPrecioInsert =
  Database['public']['Tables']['tabulador_precios']['Insert'];
export type PrecioAuditRow = Database['public']['Tables']['precio_audit']['Row'];

// Modalidades soportadas por el tabulador (regla 8: inglés en BD, español UI).
export const PRECIO_MODOS = [
  'fijo',
  'por_consorcio',
  'por_unidad_funcional',
  'por_tramite',
  'convenio',
  'preferencial',
] as const;
export type PrecioModo = (typeof PRECIO_MODOS)[number];

export const PRECIO_MODO_LABEL: Record<PrecioModo, string> = {
  fijo: 'Precio fijo',
  por_consorcio: 'Por consorcio',
  por_unidad_funcional: 'Por unidad funcional',
  por_tramite: 'Por trámite',
  convenio: 'Por convenio',
  preferencial: 'Preferencial',
};

export const ORIGEN_PRECIO_LABEL: Record<string, string> = {
  base: 'Base',
  ajuste_porcentual: 'Ajuste %',
  ajuste_fijo: 'Ajuste fijo',
  ajuste_indice: 'Índice',
  convenio: 'Convenio',
  preferencial: 'Preferencial',
  cliente_nuevo: 'Cliente nuevo',
  cliente_recurrente: 'Cliente recurrente',
};

export interface ServicioListItem extends ServicioRow {
  categoria_nombre: string;
  categoria_codigo: string;
  precio_vigente: number | null;
  precio_vigente_id: string | null;
}

export interface ListServiciosFilters {
  categoriaCodigo?: string | 'todas';
  modalidad?: PrecioModo | 'todas';
  soloActivos?: boolean;
  search?: string;
}

// ----------------------------------------------------------------------------
// Categorías
// ----------------------------------------------------------------------------
export async function listCategorias(): Promise<
  ApiResponse<CategoriaServicioRow[]>
> {
  const { data, error } = await supabase
    .from('categorias_servicio')
    .select('*')
    .order('orden', { ascending: true });
  if (error) return fail('CAT_LIST', error.message, error);
  return ok(data ?? []);
}

// ----------------------------------------------------------------------------
// Listado liviano (picker del wizard de emisión).
// ----------------------------------------------------------------------------
export async function listServiciosActivos(): Promise<
  ApiResponse<ServicioListItem[]>
> {
  const res = await listServicios({ soloActivos: true });
  return res;
}

// ----------------------------------------------------------------------------
// Listado principal con join a categoría y precio base vigente (regla general).
// ----------------------------------------------------------------------------
export async function listServicios(
  filters: ListServiciosFilters = {},
): Promise<ApiResponse<ServicioListItem[]>> {
  let q = supabase
    .from('servicios')
    .select(`*, categorias_servicio!inner(id,codigo,nombre,orden)`)
    .order('orden', { ascending: true });

  if (filters.soloActivos) q = q.eq('activo', true);
  if (filters.modalidad && filters.modalidad !== 'todas') {
    q = q.eq('precio_modo', filters.modalidad);
  }
  if (filters.search && filters.search.trim().length > 0) {
    const s = filters.search.trim();
    q = q.or(`nombre.ilike.%${s}%,codigo.ilike.%${s}%,descripcion.ilike.%${s}%`);
  }

  const { data, error } = await q;
  if (error) return fail('SERV_LIST', error.message, error);

  type Joined = ServicioRow & {
    categorias_servicio: {
      id: string;
      codigo: string;
      nombre: string;
      orden: number;
    } | null;
  };
  const rows = (data ?? []) as Joined[];

  // Filtro por categoría en memoria (más simple que .eq tras !inner anidado).
  const filtered =
    filters.categoriaCodigo && filters.categoriaCodigo !== 'todas'
      ? rows.filter(
          (r) => r.categorias_servicio?.codigo === filters.categoriaCodigo,
        )
      : rows;

  if (filtered.length === 0) return ok([]);

  // Precio base vigente (sin admin/consorcio/convenio, vigente_hasta NULL).
  const ids = filtered.map((r) => r.id);
  const { data: precios, error: precErr } = await supabase
    .from('tabulador_precios')
    .select('id,servicio_id,precio,vigente_desde,vigente_hasta')
    .in('servicio_id', ids)
    .is('administracion_id', null)
    .is('consorcio_id', null)
    .is('convenio', null)
    .is('vigente_hasta', null);
  if (precErr) return fail('SERV_LIST_PRECIO', precErr.message, precErr);

  const precioMap = new Map<
    string,
    { id: string; precio: number }
  >();
  for (const p of precios ?? []) {
    precioMap.set(p.servicio_id, { id: p.id, precio: Number(p.precio) });
  }

  const items: ServicioListItem[] = filtered.map((r) => {
    const { categorias_servicio, ...rest } = r;
    const pv = precioMap.get(r.id);
    return {
      ...(rest as ServicioRow),
      categoria_nombre: categorias_servicio?.nombre ?? '—',
      categoria_codigo: categorias_servicio?.codigo ?? '',
      precio_vigente: pv ? pv.precio : null,
      precio_vigente_id: pv ? pv.id : null,
    };
  });
  return ok(items);
}

// ----------------------------------------------------------------------------
// Detalle de servicio + todos sus precios (historial + reglas especiales).
// ----------------------------------------------------------------------------
export interface ServicioDetail {
  servicio: ServicioRow & {
    categoria_nombre: string;
    categoria_codigo: string;
  };
  precios: Array<
    TabuladorPrecioRow & {
      administracion_nombre: string | null;
      consorcio_nombre: string | null;
    }
  >;
}

export async function getServicio(
  id: string,
): Promise<ApiResponse<ServicioDetail>> {
  const { data: serv, error: e1 } = await supabase
    .from('servicios')
    .select(`*, categorias_servicio!inner(codigo,nombre)`)
    .eq('id', id)
    .single();
  if (e1) return fail('SERV_GET', e1.message, e1);

  type Joined = ServicioRow & {
    categorias_servicio: { codigo: string; nombre: string } | null;
  };
  const j = serv as Joined;
  const { categorias_servicio, ...rest } = j;

  const { data: precios, error: e2 } = await supabase
    .from('tabulador_precios')
    .select(
      `*,
       administraciones(id,nombre),
       consorcios(id,nombre)`,
    )
    .eq('servicio_id', id)
    .order('vigente_desde', { ascending: false });
  if (e2) return fail('SERV_GET_PRECIOS', e2.message, e2);

  type PJoined = TabuladorPrecioRow & {
    administraciones: { id: string; nombre: string } | null;
    consorcios: { id: string; nombre: string } | null;
  };
  const preciosOut = (precios ?? []).map((p) => {
    const pj = p as PJoined;
    const { administraciones, consorcios, ...prest } = pj;
    return {
      ...(prest as TabuladorPrecioRow),
      administracion_nombre: administraciones?.nombre ?? null,
      consorcio_nombre: consorcios?.nombre ?? null,
    };
  });

  return ok({
    servicio: {
      ...(rest as ServicioRow),
      categoria_nombre: categorias_servicio?.nombre ?? '—',
      categoria_codigo: categorias_servicio?.codigo ?? '',
    },
    precios: preciosOut,
  });
}

// ----------------------------------------------------------------------------
// Alta / edición / baja lógica.
// ----------------------------------------------------------------------------
export interface CrearServicioInput {
  categoria_id: string;
  codigo: string;
  nombre: string;
  descripcion?: string | null;
  precio_modo: PrecioModo;
  precio_base?: number;
  iva_alicuota?: string;
  requiere_administracion?: boolean;
  requiere_consorcio?: boolean;
  permite_multiples_consorcios?: boolean;
  habilita_campus?: boolean;
  campus_vigencia_meses?: number | null;
  habilitado_formulario_publico?: boolean;
  formulario_publico_slug?: string | null;
  observaciones?: string | null;
  // Si viene, se crea un tabulador_precios base con este monto.
  precio_inicial?: number;
}

export async function crearServicio(
  input: CrearServicioInput,
): Promise<ApiResponse<ServicioRow>> {
  const { precio_inicial, ...servicioFields } = input;
  const insert: ServicioInsert = {
    ...servicioFields,
    precio_base: input.precio_base ?? 0,
    iva_alicuota: input.iva_alicuota ?? '21',
    activo: true,
  };

  const { data, error } = await supabase
    .from('servicios')
    .insert(insert)
    .select()
    .single();
  if (error) return fail('SERV_CREATE', error.message, error);

  // Si vino precio_inicial, sembramos la regla base.
  if (typeof precio_inicial === 'number' && precio_inicial >= 0) {
    const { error: pErr } = await supabase.from('tabulador_precios').insert({
      servicio_id: data.id,
      precio: precio_inicial,
      origen: 'base',
      motivo: 'Alta del servicio',
    } satisfies TabuladorPrecioInsert);
    if (pErr) return fail('SERV_CREATE_PRECIO', pErr.message, pErr);
  }

  return ok(data as ServicioRow);
}

export async function actualizarServicio(
  id: string,
  patch: ServicioUpdate,
): Promise<ApiResponse<ServicioRow>> {
  const { data, error } = await supabase
    .from('servicios')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('SERV_UPDATE', error.message, error);
  return ok(data as ServicioRow);
}

export async function desactivarServicio(
  id: string,
): Promise<ApiResponse<true>> {
  const { error } = await supabase
    .from('servicios')
    .update({ activo: false })
    .eq('id', id);
  if (error) return fail('SERV_DEACTIVATE', error.message, error);
  return ok(true);
}

export async function activarServicio(
  id: string,
): Promise<ApiResponse<true>> {
  const { error } = await supabase
    .from('servicios')
    .update({ activo: true })
    .eq('id', id);
  if (error) return fail('SERV_ACTIVATE', error.message, error);
  return ok(true);
}

// ----------------------------------------------------------------------------
// Precios (tabulador).
// ----------------------------------------------------------------------------
export interface CrearPrecioInput {
  precio: number;
  origen?: TabuladorPrecioRow['origen'];
  vigente_desde?: string; // YYYY-MM-DD
  vigente_hasta?: string | null;
  administracion_id?: string | null;
  consorcio_id?: string | null;
  convenio?: string | null;
  motivo?: string | null;
  notas?: string | null;
}

export async function crearPrecio(
  servicioId: string,
  input: CrearPrecioInput,
): Promise<ApiResponse<TabuladorPrecioRow>> {
  // Validación cliente del invariante (la BD también lo chequea con CHECK).
  const ejes =
    (input.administracion_id ? 1 : 0) +
    (input.consorcio_id ? 1 : 0) +
    (input.convenio ? 1 : 0);
  if (ejes > 1) {
    return fail(
      'SERV_PRECIO_ALCANCE',
      'El precio sólo puede tener un alcance: administración, consorcio o convenio.',
    );
  }

  const insert: TabuladorPrecioInsert = {
    servicio_id: servicioId,
    precio: input.precio,
    origen: input.origen ?? 'base',
    administracion_id: input.administracion_id ?? null,
    consorcio_id: input.consorcio_id ?? null,
    convenio: input.convenio ?? null,
    vigente_desde: input.vigente_desde ?? new Date().toISOString().slice(0, 10),
    vigente_hasta: input.vigente_hasta ?? null,
    motivo: input.motivo ?? null,
    notas: input.notas ?? null,
  };

  // Si es regla base nueva, primero cerramos la base abierta (uq parcial).
  if (!insert.administracion_id && !insert.consorcio_id && !insert.convenio) {
    const today = new Date().toISOString().slice(0, 10);
    await supabase
      .from('tabulador_precios')
      .update({ vigente_hasta: today })
      .eq('servicio_id', servicioId)
      .is('administracion_id', null)
      .is('consorcio_id', null)
      .is('convenio', null)
      .is('vigente_hasta', null);
  }

  const { data, error } = await supabase
    .from('tabulador_precios')
    .insert(insert)
    .select()
    .single();
  if (error) return fail('SERV_PRECIO_CREATE', error.message, error);
  return ok(data as TabuladorPrecioRow);
}

export async function cerrarPrecio(
  precioId: string,
  vigenteHasta?: string,
): Promise<ApiResponse<true>> {
  const hasta = vigenteHasta ?? new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from('tabulador_precios')
    .update({ vigente_hasta: hasta })
    .eq('id', precioId);
  if (error) return fail('SERV_PRECIO_CIERRE', error.message, error);
  return ok(true);
}

// ----------------------------------------------------------------------------
// RPCs.
// ----------------------------------------------------------------------------
export interface PrecioResuelto {
  precio_unitario: number;
  precio_total: number;
  modo: PrecioModo;
  origen: string;
  unidades: number;
  tabulador_precio_id: string | null;
}

export async function resolverPrecio(
  servicioId: string,
  opts: {
    administracionId?: string | null;
    consorcioId?: string | null;
    fecha?: string;
  } = {},
): Promise<ApiResponse<PrecioResuelto>> {
  const { data, error } = await supabase.rpc('resolver_precio_servicio', {
    p_servicio_id: servicioId,
    p_administracion_id: opts.administracionId ?? undefined,
    p_consorcio_id: opts.consorcioId ?? undefined,
    p_fecha: opts.fecha ?? undefined,
  });
  if (error) return fail('SERV_RESOLVER', error.message, error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return fail('SERV_RESOLVER_VACIO', 'El resolver no devolvió fila.');
  }
  return ok({
    precio_unitario: Number(row.precio_unitario),
    precio_total: Number(row.precio_total),
    modo: row.modo as PrecioModo,
    origen: row.origen,
    unidades: row.unidades ?? 1,
    tabulador_precio_id: row.tabulador_precio_id ?? null,
  });
}

export interface AjusteMasivoResultRow {
  servicio_id: string;
  precio_anterior: number;
  precio_nuevo: number;
}

export async function ajusteMasivo(input: {
  categoriaCodigo?: string | null;
  servicioId?: string | null;
  porcentaje: number;
  motivo?: string | null;
}): Promise<ApiResponse<AjusteMasivoResultRow[]>> {
  const { data, error } = await supabase.rpc('ajuste_masivo_precios', {
    p_categoria_codigo: input.categoriaCodigo ?? undefined,
    p_servicio_id: input.servicioId ?? undefined,
    p_porcentaje: input.porcentaje,
    p_motivo: input.motivo ?? undefined,
  });
  if (error) return fail('SERV_AJUSTE', error.message, error);
  const rows = (data ?? []) as Array<{
    servicio_id: string;
    precio_anterior: number;
    precio_nuevo: number;
  }>;
  return ok(
    rows.map((r) => ({
      servicio_id: r.servicio_id,
      precio_anterior: Number(r.precio_anterior),
      precio_nuevo: Number(r.precio_nuevo),
    })),
  );
}

// ----------------------------------------------------------------------------
// Audit log para un servicio.
// ----------------------------------------------------------------------------
export interface AuditRow extends PrecioAuditRow {
  autor_nombre: string | null;
}

export async function listAuditServicio(
  servicioId: string,
  limit = 50,
): Promise<ApiResponse<AuditRow[]>> {
  const { data, error } = await supabase
    .from('precio_audit')
    .select(`*, profiles:autor(full_name)`)
    .eq('servicio_id', servicioId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return fail('SERV_AUDIT', error.message, error);
  type Joined = PrecioAuditRow & {
    profiles: { full_name: string | null } | null;
  };
  return ok(
    (data ?? []).map((row) => {
      const r = row as Joined;
      const { profiles, ...rest } = r;
      return {
        ...(rest as PrecioAuditRow),
        autor_nombre: profiles?.full_name ?? null,
      };
    }),
  );
}
