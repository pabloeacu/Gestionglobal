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
