// API de "La voz de los alumnos" en la landing (DGG-241).
// Sección pública de opiniones (datos reales de encuestas) + manager de gerencia.
// Regla 4: ningún componente toca supabase.from()/rpc() directo.

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

// ---- públicos (landing) ----
export interface LandingMetrica { label: string; valor: string; sufijo: string; kind: string; hint: string }
export type LandingCategoria = 'servicio' | 'alumno';
export interface LandingCardPublica {
  nombre: string; comentario: string; foto_url: string | null;
  curso: string | null; estrellas: number | null; categoria: LandingCategoria;
}
export interface LandingOpinionesPublicas {
  activa: boolean; titulo: string; titulo_servicios: string;
  metricas: LandingMetrica[]; cards: LandingCardPublica[];
  agg: { rating: number | null; count: number };
}

/** Datos de la sección pública (callable por anon). */
export async function getLandingOpinionesPublicas(): Promise<ApiResponse<LandingOpinionesPublicas>> {
  const { data, error } = await supabase.rpc('landing_opiniones_publicas');
  if (error) return fail('LAND_OP_PUB', error.message, error);
  return ok(data as unknown as LandingOpinionesPublicas);
}

// ---- admin (gerencia) ----
export interface LandingMetricaConfig { id: string; label: string; kind: string; sufijo?: string; valor?: string; hint?: string }
export interface LandingCardAdmin {
  id: string; respuesta_id: string | null; nombre: string; comentario: string;
  foto_url: string | null; curso: string | null; estrellas: number | null;
  orden: number; activo: boolean; origen: string; categoria: LandingCategoria;
}
export interface LandingPoolItem {
  respuesta_id: string; nombre: string; comentario: string;
  foto_url: string | null; curso: string | null; fecha: string;
}
export interface LandingOpinionesAdmin {
  titulo: string; titulo_servicios: string; activa: boolean;
  metricas: LandingMetricaConfig[]; cards: LandingCardAdmin[]; pool: LandingPoolItem[];
}

export async function getLandingOpinionesAdmin(): Promise<ApiResponse<LandingOpinionesAdmin>> {
  const { data, error } = await supabase.rpc('landing_opiniones_admin');
  if (error) return fail('LAND_OP_ADMIN', error.message, error);
  return ok(data as unknown as LandingOpinionesAdmin);
}

/** Agrega una respuesta publicable como card (snapshot + consentimiento duro en el backend). */
export async function agregarTestimonio(respuestaId: string): Promise<ApiResponse<true>> {
  const { data, error } = await supabase.rpc('landing_testimonio_agregar', { p_respuesta_id: respuestaId });
  if (error) return fail('LAND_OP_ADD', error.message, error);
  if (data && (data as { ok?: boolean }).ok === false) return fail('LAND_OP_ADD', 'Esa opinión ya estaba en la landing.');
  return ok(true);
}

export async function agregarTestimonioManual(p: {
  nombre: string; comentario: string; curso?: string | null; foto_url?: string | null;
  categoria?: LandingCategoria;
}): Promise<ApiResponse<true>> {
  const { error } = await supabase.rpc('landing_testimonio_manual', {
    p_nombre: p.nombre, p_comentario: p.comentario,
    p_curso: p.curso ?? undefined, p_foto_url: p.foto_url ?? undefined,
    p_categoria: p.categoria ?? 'alumno',
  });
  if (error) return fail('LAND_OP_MANUAL', error.message, error);
  return ok(true);
}

export async function reordenarTestimonios(ids: string[]): Promise<ApiResponse<true>> {
  const { error } = await supabase.rpc('landing_testimonio_reordenar', { p_ids: ids });
  if (error) return fail('LAND_OP_ORDER', error.message, error);
  return ok(true);
}

/** Edita una card (nombre/comentario/curso/foto/activo). Single-table → RLS staff. */
export async function updateTestimonio(
  id: string,
  patch: { nombre?: string; comentario?: string; curso_titulo?: string | null; foto_url?: string | null; activo?: boolean; categoria?: LandingCategoria },
): Promise<ApiResponse<true>> {
  const upd: Database['public']['Tables']['landing_testimonios']['Update'] = {};
  if (patch.nombre !== undefined) upd.nombre = patch.nombre;
  if (patch.comentario !== undefined) upd.comentario = patch.comentario;
  if (patch.curso_titulo !== undefined) upd.curso_titulo = patch.curso_titulo;
  if (patch.foto_url !== undefined) upd.foto_url = patch.foto_url;
  if (patch.activo !== undefined) upd.activo = patch.activo;
  if (patch.categoria !== undefined) upd.categoria = patch.categoria;
  const { data, error } = await supabase.from('landing_testimonios').update(upd).eq('id', id).select('id');
  if (error) return fail('LAND_OP_UPD', error.message, error);
  if (!data || data.length === 0) return fail('LAND_OP_UPD', 'No se aplicó el cambio (sin permisos de gerencia).');
  return ok(true);
}

export async function deleteTestimonio(id: string): Promise<ApiResponse<true>> {
  const { data, error } = await supabase.from('landing_testimonios').delete().eq('id', id).select('id');
  if (error) return fail('LAND_OP_DEL', error.message, error);
  if (!data || data.length === 0) return fail('LAND_OP_DEL', 'No se pudo quitar (sin permisos de gerencia).');
  return ok(true);
}

export async function setLandingOpinionesConfig(
  patch: { titulo?: string; titulo_servicios?: string; activa?: boolean; metricas?: LandingMetricaConfig[] },
): Promise<ApiResponse<true>> {
  const upd: Database['public']['Tables']['config_global']['Update'] = {};
  if (patch.titulo !== undefined) upd.landing_opiniones_titulo = patch.titulo;
  if (patch.titulo_servicios !== undefined) upd.landing_opiniones_titulo_servicios = patch.titulo_servicios;
  if (patch.activa !== undefined) upd.landing_opiniones_activa = patch.activa;
  if (patch.metricas !== undefined) upd.landing_opiniones_metricas = patch.metricas as unknown as Database['public']['Tables']['config_global']['Update']['landing_opiniones_metricas'];
  const { data, error } = await supabase.from('config_global').update(upd).eq('id', 1).select('id');
  if (error) return fail('LAND_OP_CFG', error.message, error);
  if (!data || data.length === 0) return fail('LAND_OP_CFG', 'No se aplicó el cambio (sin permisos de gerencia).');
  return ok(true);
}
