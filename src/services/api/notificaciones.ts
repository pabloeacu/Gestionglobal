// ============================================================================
// notificaciones.ts · API del centro de notificaciones in-app (DGG-30 / P5-7.C)
//
// Capa de acceso a las RPCs `notif_*` (mig 0063). Sigue el patrón E-GG-21:
// usamos `(supabase.rpc as any)(...)` para preservar el `this` binding del
// cliente. Tipos manuales (no dependemos de Database['public']['Functions']
// porque generate-types puede saltarse RPCs nuevas hasta el próximo build).
// ============================================================================

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';

export type NotifTipo =
  | 'solicitud_nueva'
  | 'tracking_cerrado'
  | 'vencimiento_proximo'
  | 'comprobante_pagado'
  | 'sistema';

export interface NotifItem {
  id: string;
  tipo: NotifTipo | string;
  titulo: string;
  cuerpo: string | null;
  url: string | null;
  payload: Record<string, unknown> | null;
  leido_at: string | null;
  created_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (name: string, params: any) => (supabase.rpc as any)(name, params);

export async function notifListar(
  limit = 30,
  offset = 0,
  soloNoLeidas = false,
): Promise<ApiResponse<NotifItem[]>> {
  const { data, error } = await rpc('notif_listar', {
    p_limit: limit,
    p_offset: offset,
    p_solo_no_leidas: soloNoLeidas,
  });
  if (error) return fail('NOTIF_LISTAR', error.message, error);
  return ok((data ?? []) as NotifItem[]);
}

export async function notifNoLeidasCount(): Promise<ApiResponse<number>> {
  const { data, error } = await rpc('notif_no_leidas_count', {});
  if (error) return fail('NOTIF_COUNT', error.message, error);
  return ok(Number(data ?? 0));
}

export async function notifMarcarLeida(id: string): Promise<ApiResponse<boolean>> {
  const { data, error } = await rpc('notif_marcar_leida', { p_id: id });
  if (error) return fail('NOTIF_MARCAR_LEIDA', error.message, error);
  return ok(Boolean(data));
}

export async function notifMarcarTodasLeidas(): Promise<ApiResponse<number>> {
  const { data, error } = await rpc('notif_marcar_todas_leidas', {});
  if (error) return fail('NOTIF_MARCAR_TODAS', error.message, error);
  return ok(Number(data ?? 0));
}

export async function notifArchivar(id: string): Promise<ApiResponse<boolean>> {
  const { data, error } = await rpc('notif_archivar', { p_id: id });
  if (error) return fail('NOTIF_ARCHIVAR', error.message, error);
  return ok(Boolean(data));
}
