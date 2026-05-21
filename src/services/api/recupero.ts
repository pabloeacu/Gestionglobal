// Subsistema Recupero / Cobranzas R1-R2-R3 (MDC-17).
//
// Wrappers tipados sobre las RPCs y tablas creadas en mig 0027:
//   · disparar_recupero_manual(comprobante, nivel, observaciones)
//   · comprobantes_morosos(administracion_id?)
//   · recupero_plantillas       — CRUD del copy R1/R2/R3
//   · recupero_config           — defaults global + override por admin
//   · recupero_acciones         — log de gestiones (audit)
//
// Patrón ApiResponse (regla 4: nada de supabase.from() en componentes).

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database, Json } from '@/types/database';

// ============================================================================
// Tipos derivados del schema generado
// ============================================================================
export type RecuperoPlantillaRow =
  Database['public']['Tables']['recupero_plantillas']['Row'];
export type RecuperoPlantillaUpdate =
  Database['public']['Tables']['recupero_plantillas']['Update'];

export type RecuperoConfigRow =
  Database['public']['Tables']['recupero_config']['Row'];
export type RecuperoConfigUpdate =
  Database['public']['Tables']['recupero_config']['Update'];
export type RecuperoConfigInsert =
  Database['public']['Tables']['recupero_config']['Insert'];

export type RecuperoAccionRow =
  Database['public']['Tables']['recupero_acciones']['Row'];

export type DispatchRecuperoLogRow =
  Database['public']['Tables']['dispatch_recupero_log']['Row'];

export const RECUPERO_NIVELES = [1, 2, 3] as const;
export type RecuperoNivel = (typeof RECUPERO_NIVELES)[number];

export const RECUPERO_NIVEL_LABEL: Record<RecuperoNivel, string> = {
  1: 'R1 · Amistoso',
  2: 'R2 · Firme',
  3: 'R3 · Prejudicial',
};

export const RECUPERO_NIVEL_TONO: Record<RecuperoNivel, 'cyan' | 'amber' | 'red'> = {
  1: 'cyan',
  2: 'amber',
  3: 'red',
};

// ============================================================================
// Acciones · listado
// ============================================================================
export interface AccionListItem extends RecuperoAccionRow {
  administracion_nombre: string | null;
  consorcio_nombre: string | null;
  comprobante_tipo: string | null;
  comprobante_numero: number | null;
  punto_venta: number | null;
  autor_nombre: string | null;
}

export interface ListAccionesParams {
  search?: string;
  nivel?: RecuperoNivel | 'todos';
  administracionId?: string;
  desde?: string; // ISO date
  hasta?: string; // ISO date
  limit?: number;
  offset?: number;
}

export async function listAcciones(
  params: ListAccionesParams = {},
): Promise<ApiResponse<{ rows: AccionListItem[]; total: number }>> {
  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;

  let q = supabase
    .from('recupero_acciones')
    .select(
      `*,
       administraciones(id,nombre),
       consorcios(id,nombre),
       comprobantes(id,tipo,numero,punto_venta),
       profiles!recupero_acciones_autor_fkey(id,full_name)`,
      { count: 'exact' },
    )
    .order('enviado_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (params.nivel && params.nivel !== 'todos') q = q.eq('nivel', params.nivel);
  if (params.administracionId) q = q.eq('administracion_id', params.administracionId);
  if (params.desde) q = q.gte('enviado_at', params.desde);
  if (params.hasta) q = q.lte('enviado_at', params.hasta);

  const { data, error, count } = await q;
  if (error) return fail('REC_ACC_LIST', error.message, error);

  type Joined = RecuperoAccionRow & {
    administraciones: { id: string; nombre: string } | null;
    consorcios: { id: string; nombre: string } | null;
    comprobantes: { id: string; tipo: string; numero: number | null; punto_venta: number | null } | null;
    profiles: { id: string; full_name: string | null } | null;
  };

  let rows: AccionListItem[] = ((data ?? []) as Joined[]).map((r) => {
    const { administraciones, consorcios, comprobantes, profiles, ...rest } = r;
    return {
      ...(rest as RecuperoAccionRow),
      administracion_nombre: administraciones?.nombre ?? null,
      consorcio_nombre: consorcios?.nombre ?? null,
      comprobante_tipo: comprobantes?.tipo ?? null,
      comprobante_numero: comprobantes?.numero ?? null,
      punto_venta: comprobantes?.punto_venta ?? null,
      autor_nombre: profiles?.full_name ?? null,
    };
  });

  if (params.search && params.search.trim().length > 0) {
    const s = params.search.trim().toLowerCase();
    rows = rows.filter((r) =>
      [r.administracion_nombre, r.consorcio_nombre, r.observaciones]
        .filter(Boolean)
        .some((x) => x!.toLowerCase().includes(s)),
    );
  }

  return ok({ rows, total: count ?? rows.length });
}

// ============================================================================
// Plantillas
// ============================================================================
export async function listPlantillas(): Promise<
  ApiResponse<RecuperoPlantillaRow[]>
> {
  const { data, error } = await supabase
    .from('recupero_plantillas')
    .select('*')
    .order('nivel', { ascending: true });
  if (error) return fail('REC_PLT_LIST', error.message, error);
  return ok((data ?? []) as RecuperoPlantillaRow[]);
}

export async function updatePlantilla(
  slug: string,
  patch: Pick<RecuperoPlantillaUpdate, 'asunto' | 'body' | 'activo' | 'descripcion' | 'dias_desde_vencimiento_min'>,
): Promise<ApiResponse<RecuperoPlantillaRow>> {
  const { data, error } = await supabase
    .from('recupero_plantillas')
    .update(patch)
    .eq('slug', slug)
    .select('*')
    .single();
  if (error) return fail('REC_PLT_UPDATE', error.message, error);
  return ok(data as RecuperoPlantillaRow);
}

// ============================================================================
// Disparar manual
// ============================================================================
export async function dispararRecuperoManual(
  comprobanteId: string,
  nivel: RecuperoNivel,
  observaciones?: string,
): Promise<ApiResponse<{ id: string }>> {
  const args = {
    p_comprobante_id: comprobanteId,
    p_nivel: nivel,
    p_observaciones: observaciones ?? null,
  } as unknown as {
    p_comprobante_id: string;
    p_nivel: number;
    p_observaciones: string;
  };
  const { data, error } = await supabase.rpc('disparar_recupero_manual', args);
  if (error) return fail('REC_DISPARAR', error.message, error);
  return ok({ id: data as string });
}

// ============================================================================
// Morosos
// ============================================================================
export interface MorosoRow {
  comprobante_id: string;
  comprobante_tipo: string;
  comprobante_numero: number | null;
  punto_venta: number | null;
  fecha: string;
  vencimiento: string;
  total: number;
  saldo_pendiente: number;
  estado_cobranza: string;
  administracion_id: string;
  administracion_nombre: string;
  consorcio_id: string | null;
  consorcio_nombre: string | null;
  dias_vencido: number;
  nivel_sugerido: RecuperoNivel | null;
  ultima_accion_at: string | null;
  ultima_accion_nivel: RecuperoNivel | null;
}

export interface ListMorososParams {
  administracionId?: string;
  search?: string;
  nivelSugerido?: RecuperoNivel | 'todos';
}

export async function listMorosos(
  params: ListMorososParams = {},
): Promise<ApiResponse<MorosoRow[]>> {
  const { data, error } = await supabase.rpc('comprobantes_morosos', {
    p_administracion_id: params.administracionId ?? undefined,
  });
  if (error) return fail('REC_MOROSOS', error.message, error);

  let rows = (data ?? []) as MorosoRow[];

  if (params.nivelSugerido && params.nivelSugerido !== 'todos') {
    rows = rows.filter((r) => r.nivel_sugerido === params.nivelSugerido);
  }

  if (params.search && params.search.trim().length > 0) {
    const s = params.search.trim().toLowerCase();
    rows = rows.filter((r) =>
      [r.administracion_nombre, r.consorcio_nombre, r.comprobante_tipo]
        .filter(Boolean)
        .some((x) => x!.toLowerCase().includes(s)),
    );
  }

  return ok(rows);
}

// ============================================================================
// Config (global + por administración)
// ============================================================================
export async function listConfig(): Promise<ApiResponse<RecuperoConfigRow[]>> {
  const { data, error } = await supabase
    .from('recupero_config')
    .select('*')
    .order('administracion_id', { ascending: true, nullsFirst: true });
  if (error) return fail('REC_CFG_LIST', error.message, error);
  return ok((data ?? []) as RecuperoConfigRow[]);
}

export async function actualizarConfig(
  id: string,
  patch: Pick<
    RecuperoConfigUpdate,
    | 'dias_r1'
    | 'dias_r2'
    | 'dias_r3'
    | 'activo_r1'
    | 'activo_r2'
    | 'activo_r3'
    | 'email_destinatario_override'
  >,
): Promise<ApiResponse<RecuperoConfigRow>> {
  const { data, error } = await supabase
    .from('recupero_config')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return fail('REC_CFG_UPDATE', error.message, error);
  return ok(data as RecuperoConfigRow);
}

export async function crearConfigPorAdministracion(
  administracionId: string,
  patch: Partial<
    Pick<
      RecuperoConfigInsert,
      | 'dias_r1'
      | 'dias_r2'
      | 'dias_r3'
      | 'activo_r1'
      | 'activo_r2'
      | 'activo_r3'
      | 'email_destinatario_override'
    >
  > = {},
): Promise<ApiResponse<RecuperoConfigRow>> {
  const { data, error } = await supabase
    .from('recupero_config')
    .insert({
      administracion_id: administracionId,
      dias_r1: patch.dias_r1 ?? 7,
      dias_r2: patch.dias_r2 ?? 30,
      dias_r3: patch.dias_r3 ?? 60,
      activo_r1: patch.activo_r1 ?? true,
      activo_r2: patch.activo_r2 ?? true,
      activo_r3: patch.activo_r3 ?? true,
      email_destinatario_override: patch.email_destinatario_override ?? null,
    })
    .select('*')
    .single();
  if (error) return fail('REC_CFG_CREATE', error.message, error);
  return ok(data as RecuperoConfigRow);
}

// ============================================================================
// KPIs (helpers para dashboard)
// ============================================================================
export interface RecuperoKpis {
  deuda_total: number;
  morosos_count: number;
  r1_30d: number;
  r2_30d: number;
  r3_30d: number;
}

export async function getKpis(): Promise<ApiResponse<RecuperoKpis>> {
  const [morososRes, accionesRes] = await Promise.all([
    supabase.rpc('comprobantes_morosos', { p_administracion_id: undefined }),
    supabase
      .from('recupero_acciones')
      .select('nivel,enviado_at')
      .gte(
        'enviado_at',
        new Date(Date.now() - 30 * 86_400_000).toISOString(),
      ),
  ]);

  if (morososRes.error) {
    return fail('REC_KPI_MOR', morososRes.error.message, morososRes.error);
  }
  if (accionesRes.error) {
    return fail('REC_KPI_ACC', accionesRes.error.message, accionesRes.error);
  }

  const morosos = (morososRes.data ?? []) as MorosoRow[];
  const acciones = (accionesRes.data ?? []) as Array<{
    nivel: number;
    enviado_at: string;
  }>;

  const deuda_total = morosos.reduce((acc, r) => acc + Number(r.saldo_pendiente || 0), 0);
  return ok({
    deuda_total,
    morosos_count: morosos.length,
    r1_30d: acciones.filter((a) => a.nivel === 1).length,
    r2_30d: acciones.filter((a) => a.nivel === 2).length,
    r3_30d: acciones.filter((a) => a.nivel === 3).length,
  });
}

// `Json` re-export para evitar warnings de TS unused-vars en módulos que
// importen sólo tipos del schema.
export type { Json };
