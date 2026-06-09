// usuarios · panel de gestión de usuarios (Configuración).
// Lista, crea y elimina users via RPC + edge function `crear-gerente`.
// Citas: regla 4 (queries en services/), regla 12 (tenancy: panel staff-only).

import { supabase } from '@/lib/supabase';
import { ok, fail, extractEdgeFnError, type ApiResponse } from '@/lib/errors';

export interface UsuarioRow {
  user_id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  role: string;
  administracion_id: string | null;
  administracion_nombre: string | null;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
  pwa_installed_at: string | null;
  pwa_last_seen_at: string | null;
  push_activo: boolean;
  push_subs_count: number;
  created_at: string;
}

export async function listarUsuarios(): Promise<ApiResponse<UsuarioRow[]>> {
  const { data, error } = await supabase.rpc('gestion_usuarios_listar');
  if (error) return fail('USERS_LIST', error.message, error);
  return ok((data ?? []) as UsuarioRow[]);
}

export async function eliminarGerente(userId: string): Promise<ApiResponse<true>> {
  const { error } = await supabase.rpc('gestion_gerente_eliminar', { p_user_id: userId });
  if (error) return fail('USERS_DELETE', error.message, error);
  return ok(true);
}

// DGG-34 R4 sweep · capitalización edge fn alta-cliente-portal
// (WizardActivacion.tsx).
export interface AltaClientePortalPayload {
  administracion_id?: string;
  email: string;
  nombre: string;
  apellido?: string;
  telefono?: string;
  cuit?: string;
  enviar_email_bienvenida?: boolean;
  // permitir extender en el futuro sin romper TS
  [k: string]: unknown;
}

export async function altaClientePortal(
  payload: AltaClientePortalPayload,
): Promise<ApiResponse<unknown>> {
  const { data, error } = await supabase.functions.invoke('alta-cliente-portal', {
    body: payload,
  });
  if (error) {
    const msg = await extractEdgeFnError(error);
    return fail('ALTA_CLIENTE_PORTAL', msg, error);
  }
  return ok(data);
}

// F1 (Lista JL) · Resuelve —o crea si falta— el usuario de portal del alumno para
// poder matricularlo en un curso. La matrícula (`curso_asignar_alumno`) necesita
// `administraciones.user_id`; un cliente EXISTENTE sin acceso al portal no lo tiene.
// Chequea `user_id` PRIMERO (evita re-crear o "hijackear" un user con otro email) y
// sólo llama `altaClientePortal` si falta — que es idempotente y sólo envía el mail
// de bienvenida cuando crea un usuario nuevo (no para uno ya existente).
export async function asegurarUsuarioAlumno(input: {
  administracionId: string;
  fallbackEmail?: string | null;
  fallbackNombre?: string | null;
}): Promise<ApiResponse<{ profileId: string }>> {
  const { data: adm, error } = await supabase
    .from('administraciones')
    .select('user_id, email, nombre')
    .eq('id', input.administracionId)
    .maybeSingle();
  if (error) return fail('ASEGURAR_USER_ALUMNO', error.message, error);
  if (adm?.user_id) return ok({ profileId: adm.user_id as string });
  const email = (((adm?.email as string | null) ?? input.fallbackEmail) ?? '').trim();
  const nombre = (((adm?.nombre as string | null) ?? input.fallbackNombre) ?? 'Cliente').trim();
  if (!email)
    return fail(
      'ASEGURAR_USER_ALUMNO',
      'El alumno no tiene email cargado; no se puede crear su acceso al portal para matricularlo.',
    );
  const alta = await altaClientePortal({ administracion_id: input.administracionId, email, nombre });
  if (!alta.ok) return fail('ASEGURAR_USER_ALUMNO', alta.error.message, alta.error.details);
  const uid = (alta.data as { user_id?: string } | null)?.user_id;
  if (!uid)
    return fail('ASEGURAR_USER_ALUMNO', 'No se pudo resolver el usuario del alumno tras crearlo.');
  return ok({ profileId: uid });
}

// DGG-34 · Editar nombre + rol de un gerente/operador desde el panel Usuarios
export async function actualizarGerente(
  user_id: string,
  full_name: string,
  role: 'gerente' | 'operador',
): Promise<ApiResponse<{ ok: true }>> {
  const { error } = await supabase.rpc('actualizar_gerente', {
    p_user_id: user_id,
    p_full_name: full_name,
    p_role: role,
  });
  if (error) return fail('USERS_UPDATE', error.message, error);
  return ok({ ok: true });
}

export async function crearGerente(
  email: string,
  nombre: string,
): Promise<ApiResponse<{ user_id: string; password_temporal?: string }>> {
  const { data, error } = await supabase.functions.invoke('crear-gerente', {
    body: { email, nombre },
  });
  if (error) {
    const msg = await extractEdgeFnError(error);
    return fail('USERS_CREATE', msg, error);
  }
  if (!data?.ok) return fail('USERS_CREATE', data?.error ?? 'Error desconocido', data);
  return ok({ user_id: data.user_id, password_temporal: data.password_temporal });
}

// #149/#153 · Crear usuario role='partner' asociado a un partner
export async function crearUsuarioPartner(
  email: string,
  nombre: string,
  partnerId: string,
): Promise<ApiResponse<{ user_id: string; password_temporal?: string }>> {
  const { data, error } = await supabase.functions.invoke('crear-gerente', {
    body: { email, nombre, role: 'partner', partner_id: partnerId },
  });
  if (error) {
    const msg = await extractEdgeFnError(error);
    return fail('USERS_CREATE_PARTNER', msg, error);
  }
  if (!data?.ok) return fail('USERS_CREATE_PARTNER', data?.error ?? 'Error desconocido', data);
  return ok({ user_id: data.user_id, password_temporal: data.password_temporal });
}

// PWA heartbeat: el cliente lo llama al boot si está en standalone mode
export async function reportarPwa(installed: boolean): Promise<void> {
  try {
    await supabase.rpc('gg_profile_marcar_pwa', { p_installed: installed });
  } catch {
    // no es crítico — sólo telemetría
  }
}
