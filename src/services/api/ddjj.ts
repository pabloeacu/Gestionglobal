// ============================================================================
// services/api/ddjj.ts · Credenciales del Portal de DDJJ (misgestiones.com.ar) — DGG-243.
//
// Fuente ÚNICA: public.credenciales_regulatorias (store cifrado, plataforma='ddjj').
// La contraseña viaja al front SÓLO en el reveal explícito del dueño/staff; nunca en
// el meta ni en un select('*'). Toda lectura/escritura por RPC SECURITY DEFINER.
// Regla 4: nunca supabase.from() en componentes — usar este módulo.
// ============================================================================
import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';

const PLATAFORMA = 'ddjj';

export type CredencialEstado = 'borrador' | 'propuesto' | 'publicado' | 'descartado';

export interface CredencialMeta {
  existe: boolean;
  usuario: string | null;
  tienePassword: boolean;
  estado: CredencialEstado | null;
  updatedAt: string | null;
}

/** Carga/edición directa por GERENCIA (staff). Deja la credencial 'publicado'.
 *  usuario/password vacíos = no se tocan (COALESCE server-side). */
export async function setCredencialDdjj(input: {
  administracionId: string;
  usuario?: string | null;
  password?: string | null;
}): Promise<ApiResponse<void>> {
  const { error } = await supabase.rpc('credencial_reg_set', {
    p_administracion_id: input.administracionId,
    p_plataforma: PLATAFORMA,
    p_usuario: input.usuario ?? '',
    p_password: input.password ?? '',
  });
  if (error) return fail('CREDENCIAL_DDJJ_SET', error.message, error);
  return ok(undefined);
}

/** Metadata (SIN contraseña): usuario + si tiene password + estado. Dueño o staff (R12). */
export async function getCredencialDdjjMeta(administracionId: string): Promise<ApiResponse<CredencialMeta>> {
  const { data, error } = await supabase.rpc('credencial_reg_meta', {
    p_administracion_id: administracionId,
    p_plataforma: PLATAFORMA,
  });
  if (error) return fail('CREDENCIAL_DDJJ_META', error.message, error);
  const r = (data ?? {}) as {
    existe?: boolean; usuario?: string | null; tiene_password?: boolean;
    estado?: string | null; updated_at?: string | null;
  };
  return ok({
    existe: !!r.existe,
    usuario: r.usuario ?? null,
    tienePassword: !!r.tiene_password,
    estado: (r.estado as CredencialEstado | null) ?? null,
    updatedAt: r.updated_at ?? null,
  });
}

/** Revela la contraseña descifrada on-demand (dueño o staff). Auditado server-side. */
export async function revelarCredencialDdjj(administracionId: string): Promise<ApiResponse<string | null>> {
  const { data, error } = await supabase.rpc('credencial_reg_revelar', {
    p_administracion_id: administracionId,
    p_plataforma: PLATAFORMA,
  });
  if (error) return fail('CREDENCIAL_DDJJ_REVELAR', error.message, error);
  return ok((data as string | null) ?? null);
}

// ============================================================================
// F2b · Carril de PROPUESTA de gestoría + MODERACIÓN (gemelo del otorgamiento).
// El secreto propuesto vive en credenciales_regulatorias.prop_* (cifrado); NUNCA
// en el tracking. La gestoría propone (por token, ver accesoExterno.ts) y gerencia
// modera: publicar (con edición opcional) / descartar.
// ============================================================================

/** Una propuesta de credenciales pendiente de moderación (sin contraseñas). */
export interface CredencialModeracionPendiente {
  administracionId: string;
  plataforma: 'ddjj' | 'arca';
  adminNombre: string | null;
  propTramiteId: string | null;
  propTramiteCodigo: string | null;
  propUsuario: string | null;
  propTienePassword: boolean;
  propOrigen: string | null;
  propPor: string | null;
  propAt: string | null;
  /** Lo PUBLICADO hoy (lo que ve el cliente); null si todavía no hay publicada. */
  actualUsuario: string | null;
  actualTienePassword: boolean;
  actualEstado: CredencialEstado | null;
}

/** Cola de propuestas de credenciales pendientes de moderación (staff). Sin contraseñas. */
export async function fetchCredencialModeracionPendientes(): Promise<ApiResponse<CredencialModeracionPendiente[]>> {
  const { data, error } = await supabase.rpc('credencial_reg_moderacion_pendientes');
  if (error) return fail('CREDENCIAL_MOD_PENDIENTES', error.message, error);
  const rows = (data ?? []) as Array<{
    administracion_id: string; plataforma: string; admin_nombre: string | null;
    prop_tramite_id: string | null; prop_tramite_codigo: string | null;
    prop_usuario: string | null; prop_tiene_password: boolean;
    prop_origen: string | null; prop_por: string | null; prop_at: string | null;
    actual_usuario: string | null; actual_tiene_password: boolean; actual_estado: string | null;
  }>;
  return ok(rows.map((r) => ({
    administracionId: r.administracion_id,
    plataforma: (r.plataforma as 'ddjj' | 'arca'),
    adminNombre: r.admin_nombre ?? null,
    propTramiteId: r.prop_tramite_id ?? null,
    propTramiteCodigo: r.prop_tramite_codigo ?? null,
    propUsuario: r.prop_usuario ?? null,
    propTienePassword: !!r.prop_tiene_password,
    propOrigen: r.prop_origen ?? null,
    propPor: r.prop_por ?? null,
    propAt: r.prop_at ?? null,
    actualUsuario: r.actual_usuario ?? null,
    actualTienePassword: !!r.actual_tiene_password,
    actualEstado: (r.actual_estado as CredencialEstado | null) ?? null,
  })));
}

/** Modera una propuesta: 'publicar' (prop→ficha, con edición opcional) o 'descartar'. Staff. */
export async function moderarCredencial(input: {
  administracionId: string;
  plataforma?: 'ddjj' | 'arca';
  accion: 'publicar' | 'descartar';
  usuario?: string | null;
  password?: string | null;
}): Promise<ApiResponse<void>> {
  const { error } = await supabase.rpc('credencial_reg_moderar', {
    p_administracion_id: input.administracionId,
    p_plataforma: input.plataforma ?? PLATAFORMA,
    p_accion: input.accion,
    // DEFAULT NULL server-side → omitir (undefined) equivale a NULL ("usar la propuesta tal cual").
    p_usuario: input.usuario ?? undefined,
    p_password: input.password ?? undefined,
  });
  if (error) return fail('CREDENCIAL_MODERAR', error.message, error);
  return ok(undefined);
}

/** Revela la contraseña PROPUESTA (staff-only) para verificarla antes de publicar. Auditado. */
export async function revelarPropuestaCredencial(
  administracionId: string,
  plataforma: 'ddjj' | 'arca' = PLATAFORMA,
): Promise<ApiResponse<string | null>> {
  const { data, error } = await supabase.rpc('credencial_reg_revelar_propuesta', {
    p_administracion_id: administracionId,
    p_plataforma: plataforma,
  });
  if (error) return fail('CREDENCIAL_REVELAR_PROP', error.message, error);
  return ok((data as string | null) ?? null);
}
