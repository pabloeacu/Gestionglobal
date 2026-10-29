import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

export type AdministracionRow = Database['public']['Tables']['administraciones']['Row'];
export type AdministracionInsert = Database['public']['Tables']['administraciones']['Insert'];
export type AdministracionUpdate = Database['public']['Tables']['administraciones']['Update'];
// nombre_normalizado lo completa el trigger; el caller no lo pasa.
export type AdministracionCreateInput = Omit<AdministracionInsert, 'nombre_normalizado'>;

export const ADMINISTRACION_ESTADOS = ['prospecto', 'activo', 'suspendido', 'baja'] as const;
export type AdministracionEstado = (typeof ADMINISTRACION_ESTADOS)[number];

export interface ListAdministracionesParams {
  search?: string;
  estado?: AdministracionEstado | 'todos';
  limit?: number;
  offset?: number;
}

export interface AdministracionListItem extends AdministracionRow {
  consorcios_count: number;
  responsable_avatar_url: string | null;
}

// DGG-34 R4 sweep · búsqueda rápida para combos / autocompletes
// (WizardActivacion al elegir cliente existente).
export interface AdministracionQuickRow {
  id: string;
  nombre: string;
  cuit: string | null;
}

export async function quickSearchAdministraciones(
  query: string,
  limit = 10,
): Promise<ApiResponse<AdministracionQuickRow[]>> {
  const q = supabase
    .from('administraciones')
    .select('id, nombre, cuit')
    .eq('activo', true)
    .order('nombre')
    .limit(limit);
  const { data, error } = query.trim().length > 0
    ? await q.ilike('nombre', `%${query.trim()}%`)
    : await q;
  if (error) return fail('ADMINS_QUICK', error.message, error);
  return ok((data ?? []) as AdministracionQuickRow[]);
}

export async function listAdministraciones(
  params: ListAdministracionesParams = {},
): Promise<ApiResponse<{ rows: AdministracionListItem[]; total: number }>> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;

  let query = supabase
    .from('administraciones')
    .select('*, consorcios:consorcios(count)', { count: 'exact' })
    .order('nombre', { ascending: true })
    .range(offset, offset + limit - 1);

  if (params.estado && params.estado !== 'todos') {
    query = query.eq('estado', params.estado);
  }
  if (params.search && params.search.trim().length > 0) {
    const s = params.search.trim();
    // ilike sobre nombre + codigo + cuit (best effort)
    query = query.or(
      `nombre.ilike.%${s}%,codigo.ilike.%${s}%,cuit.ilike.%${s}%`,
    );
  }

  const { data, error, count } = await query;
  if (error) return fail('ADMIN_LIST', error.message, error);

  const rowsBase = (data ?? []).map((r) => {
    const cAny = (r as { consorcios?: Array<{ count: number }> }).consorcios;
    const consorcios_count = Array.isArray(cAny) && cAny[0] ? cAny[0].count : 0;
    const { consorcios: _drop, ...rest } = r as AdministracionRow & {
      consorcios?: unknown;
    };
    return { ...(rest as AdministracionRow), consorcios_count };
  });

  // Enrich con avatar del responsable (profiles.avatar_url). El FK admin.user_id
  // apunta a auth.users — usamos un IN sobre profiles.id (que comparte el uuid).
  const userIds = rowsBase
    .map((r) => r.user_id)
    .filter((id): id is string => !!id);
  const avatarMap = new Map<string, string | null>();
  if (userIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, avatar_url')
      .in('id', userIds);
    (profs ?? []).forEach((p) => avatarMap.set(p.id, p.avatar_url));
  }

  const rows: AdministracionListItem[] = rowsBase.map((r) => ({
    ...r,
    responsable_avatar_url: r.user_id ? (avatarMap.get(r.user_id) ?? null) : null,
  }));

  // PostgREST a veces devuelve count=0 cuando el select tiene relaciones
  // embebidas (`consorcios:consorcios(count)`). Si count es null o 0 pero
  // tenemos rows, usamos rows.length como fallback realista.
  const safeTotal = count && count > 0 ? count : rows.length;
  return ok({ rows, total: safeTotal });
}

export async function getAdministracion(
  id: string,
): Promise<ApiResponse<AdministracionRow>> {
  const { data, error } = await supabase
    .from('administraciones')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return fail('ADMIN_GET', error.message, error);
  return ok(data);
}

export type MatriculaExtraRow = Database['public']['Tables']['matricula_extra']['Row'];

// DGG-234 F6 · matrícula de jurisdicción NO-PBA (CABA/Neuquén). Vive en la tabla hija
// matricula_extra con certeza 'declarado' (CABA/NEU no tienen registro oficial consultable
// como TRAMIX) — NO en administraciones.matricula_rpac (eso es PBA → reabriría E-GG-236) ni
// en las columnas legacy matricula_rpa* (0 filas, deprecadas). Staff lee/escribe vía RLS.
export async function fetchMatriculasExtra(
  administracionId: string,
): Promise<ApiResponse<MatriculaExtraRow[]>> {
  const { data, error } = await supabase
    .from('matricula_extra')
    .select('*')
    .eq('administracion_id', administracionId)
    .order('jurisdiccion');
  if (error) return fail('MATEXTRA_LIST', error.message, error);
  return ok(data ?? []);
}

// DGG-234 F8 · jurisdicción NO-PBA que el editor de gerencia administra (CABA o Neuquén).
export type MatriculaExtraJur = 'caba' | 'neuquen';

// Setea/actualiza/borra la matrícula de OTRA jurisdicción (CABA/Neuquén) de un cliente
// desde gerencia. El form de gerencia administra UNA sola matrícula no-PBA por vez: la que
// CARGÓ (jurisdiccionPrevia) o la que el gerente ELIGIÓ (jurisdiccion). Todos los borrados
// se ACOTAN a esas jurisdicciones — NUNCA se toca una fila no-PBA que el form no mostró
// (p.ej. una CABA oculta mientras se edita Neuquén) → sin pérdida de datos silenciosa (§6 F8,
// hallazgo CONFIRMADO). `jurisdiccionPrevia` = la jurisdicción que el drawer trajo al abrir.
//  · nro vacío/null → borra SÓLO la fila de la jurisdicción gestionada (previa o elegida).
//  · cambió de jurisdicción respecto de la cargada → borra SÓLO la previa, inserta la nueva.
//  · misma jurisdicción ya existente → sólo actualiza el Nº (NO pisa fecha/vencimiento/origen).
// certeza siempre 'declarado' (CABA/Neuquén no tienen registro oficial consultable).
export async function setMatriculaExtra(
  administracionId: string,
  jurisdiccion: MatriculaExtraJur,
  nro: string | null,
  jurisdiccionPrevia: MatriculaExtraJur | null = null,
): Promise<ApiResponse<null>> {
  const limpio = (nro ?? '').trim();

  if (!limpio) {
    // El gerente limpió la matrícula que estaba editando → borrar SÓLO esa fila
    // (la cargada, o la elegida si no había previa). No tocar otras jurisdicciones.
    const target = jurisdiccionPrevia ?? jurisdiccion;
    const { error } = await supabase
      .from('matricula_extra')
      .delete()
      .eq('administracion_id', administracionId)
      .eq('jurisdiccion', target);
    if (error) return fail('MATEXTRA_DEL', error.message, error);
    return ok(null);
  }

  // Cambió de jurisdicción respecto de la cargada → sacar SÓLO la fila previa (no otras).
  if (jurisdiccionPrevia && jurisdiccionPrevia !== jurisdiccion) {
    const { error } = await supabase
      .from('matricula_extra')
      .delete()
      .eq('administracion_id', administracionId)
      .eq('jurisdiccion', jurisdiccionPrevia);
    if (error) return fail('MATEXTRA_DEL_PREVIA', error.message, error);
  }

  const { data: existing, error: eSel } = await supabase
    .from('matricula_extra')
    .select('id')
    .eq('administracion_id', administracionId)
    .eq('jurisdiccion', jurisdiccion)
    .maybeSingle();
  if (eSel) return fail('MATEXTRA_SEL', eSel.message, eSel);
  if (existing) {
    const { error } = await supabase
      .from('matricula_extra')
      .update({ matricula_nro: limpio })
      .eq('id', existing.id);
    if (error) return fail('MATEXTRA_UPD', error.message, error);
    return ok(null);
  }
  const { error } = await supabase.from('matricula_extra').insert({
    administracion_id: administracionId,
    jurisdiccion,
    matricula_nro: limpio,
    certeza: 'declarado',
    origen: 'gerencia_manual',
  });
  if (error) return fail('MATEXTRA_INS', error.message, error);
  return ok(null);
}

export async function createAdministracion(
  input: AdministracionCreateInput,
): Promise<ApiResponse<AdministracionRow>> {
  // nombre_normalizado lo completa el trigger BEFORE INS; mandamos placeholder
  // vacío para satisfacer NOT NULL (el trigger lo sobrescribe).
  const payload: AdministracionInsert = { ...input, nombre_normalizado: '' };
  const { data, error } = await supabase
    .from('administraciones')
    .insert(payload)
    .select()
    .single();
  if (error) return fail('ADMIN_CREATE', error.message, error);
  return ok(data);
}

export async function updateAdministracion(
  id: string,
  patch: AdministracionUpdate,
): Promise<ApiResponse<AdministracionRow>> {
  const { data, error } = await supabase
    .from('administraciones')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('ADMIN_UPDATE', error.message, error);
  return ok(data);
}

// Baja transaccional vía RPC (mig 0318): además de marcar la admin de baja,
// DESHABILITA los usuarios de portal (profiles administradores) para cortarles
// el acceso — antes un UPDATE directo dejaba al cliente pudiendo loguearse y
// ver su portal (Gap 1, hueco de seguridad). El helper current_administracion_id
// también lo blinda a nivel RLS, esto es la señal para el signOut del front.
export async function archiveAdministracion(
  id: string,
): Promise<ApiResponse<null>> {
  const { error } = await supabase.rpc('administracion_dar_de_baja', {
    p_administracion_id: id,
  });
  if (error) return fail('ADMIN_BAJA', error.message, error);
  return ok(null);
}

// Reactiva un cliente dado de baja: revierte estado/activo + rehabilita sus
// usuarios de portal (mig 0318).
export async function reactivarAdministracion(
  id: string,
): Promise<ApiResponse<null>> {
  const { error } = await supabase.rpc('administracion_reactivar', {
    p_administracion_id: id,
  });
  if (error) return fail('ADMIN_REACTIVAR', error.message, error);
  return ok(null);
}

// Precheck de identidad antes de crear/editar un cliente (mig 0321, decisiones
// Pablo). Devuelve el gemelo por CUIT (para ofrecer reactivar si está de baja) y
// el gemelo por DNI activo (para avisar "puede ser la misma persona").
export interface IdentidadPrecheck {
  cuit_twin: { id: string; nombre: string; activo: boolean; estado: string } | null;
  dni_twin: { id: string; nombre: string } | null;
}

export async function adminPrecheckIdentidad(
  cuit: string | null,
  dni: string | null,
  excluirId: string | null,
): Promise<ApiResponse<IdentidadPrecheck>> {
  const { data, error } = await supabase.rpc('admin_precheck_identidad' as never, {
    p_cuit: cuit,
    p_dni: dni,
    p_excluir_id: excluirId,
  } as never);
  if (error) return fail('ADMIN_PRECHECK', error.message, error);
  return ok(data as IdentidadPrecheck);
}
