import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

// Plantillas / "mensajes modelo" de las líneas de tracking (mig 0517, pedido Pablo 2026-09-27).
// Recurso interno de gerencia: título (etiqueta del picker) + cuerpo (texto que se inserta en la
// descripción de una línea) + categoría opcional (slug SOFT). Espeja el patrón de recupero_plantillas
// (tabla única → sin RPC; RLS staff-only; todo query acá, R4). El cliente jamás ve el catálogo.

export type TrackingPlantillaRow =
  Database['public']['Tables']['tracking_plantillas']['Row'];
export type TrackingPlantillaInsert =
  Database['public']['Tables']['tracking_plantillas']['Insert'];
export type TrackingPlantillaUpdate =
  Database['public']['Tables']['tracking_plantillas']['Update'];

// Lista ordenada por (orden, titulo). `soloActivas` para el picker; sin filtro para la gestión.
export async function listTrackingPlantillas(
  params?: { soloActivas?: boolean },
): Promise<ApiResponse<TrackingPlantillaRow[]>> {
  let q = supabase
    .from('tracking_plantillas')
    .select('*')
    .order('orden', { ascending: true })
    .order('titulo', { ascending: true });
  if (params?.soloActivas) q = q.eq('activo', true);
  const { data, error } = await q;
  if (error) return fail('TRK_PLT_LIST', error.message, error);
  return ok((data ?? []) as TrackingPlantillaRow[]);
}

export async function createTrackingPlantilla(input: {
  titulo: string;
  cuerpo: string;
  categoria?: string | null;
  orden?: number;
  activo?: boolean;
}): Promise<ApiResponse<TrackingPlantillaRow>> {
  const { data, error } = await supabase
    .from('tracking_plantillas')
    .insert({
      titulo: input.titulo,
      cuerpo: input.cuerpo,
      categoria: input.categoria ?? null,
      orden: input.orden ?? 0,
      activo: input.activo ?? true,
    })
    .select('*')
    .single();
  if (error) return fail('TRK_PLT_CREATE', error.message, error);
  return ok(data as TrackingPlantillaRow);
}

export async function updateTrackingPlantilla(
  id: string,
  patch: Partial<Pick<TrackingPlantillaRow, 'titulo' | 'cuerpo' | 'categoria' | 'orden' | 'activo'>>,
): Promise<ApiResponse<TrackingPlantillaRow>> {
  const { data, error } = await supabase
    .from('tracking_plantillas')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return fail('TRK_PLT_UPDATE', error.message, error);
  return ok(data as TrackingPlantillaRow);
}

export async function deleteTrackingPlantilla(id: string): Promise<ApiResponse<null>> {
  const { error } = await supabase.from('tracking_plantillas').delete().eq('id', id);
  if (error) return fail('TRK_PLT_DELETE', error.message, error);
  return ok(null);
}
