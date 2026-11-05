import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, type ApiResponse } from '@/lib/errors';
import type { LexphTipo } from './lexph';

// =============================================================================
// DGG-244 · LexPH — capa de lectura PÚBLICA (anon). F3.
//
// Todo pasa por RPCs SECURITY DEFINER anon-ejecutables que devuelven SÓLO lo
// publicado y SÓLO campos públicos (las tablas siguen staff-only; anon no las toca).
// La cortina `lexph_publico_activo` (config_global) gatea adentro: con el flag en
// false, las RPCs devuelven vacío → "a oscuras".
// =============================================================================

export interface LexphPublicTag {
  slug: string;
  nombre: string;
  tipo: 'materia' | 'jurisdiccion';
}

export interface LexphFeedItem {
  id: string;
  slug: string;
  tipo: LexphTipo;
  titulo: string;
  resumen: string | null;
  imagen_url: string | null;
  imagen_alt: string | null;
  publicado_at: string | null;
  tags: LexphPublicTag[];
}

export interface LexphFuentePublica {
  cita: string;
  url?: string | null;
}

export interface LexphArticuloPublico extends LexphFeedItem {
  cuerpo: string | null;
  campos: Record<string, unknown>;
  fuentes: LexphFuentePublica[];
}

// Estado de la cortina pública. Fail-safe a false (si falla, no mostramos nada).
export async function getLexphPublicoStatus(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('get_lexph_publico_status');
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

// Toggle staff (gerencia). Falla con 42501 si no es staff.
export async function setLexphPublico(enabled: boolean): Promise<ApiResponse<boolean>> {
  try {
    const { data, error } = await supabase.rpc('set_lexph_publico', { p_enabled: enabled });
    if (error) throw error;
    return ok(Boolean(data));
  } catch (e) {
    const err = toApiError(e);
    return fail('LEXPH_PUBLICO_SET', err.message, err.details);
  }
}

// Feed completo de publicados (R19: universo; el front filtra por tipo/etiqueta en memoria).
export async function listPublicados(): Promise<ApiResponse<LexphFeedItem[]>> {
  try {
    const { data, error } = await supabase.rpc('lexph_publico_feed');
    if (error) throw error;
    return ok(((data ?? []) as unknown as LexphFeedItem[]));
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// Un artículo publicado por slug. null si no existe o si la cortina está cerrada.
export async function getPublicadoBySlug(
  slug: string,
): Promise<ApiResponse<LexphArticuloPublico | null>> {
  try {
    const { data, error } = await supabase.rpc('lexph_publico_articulo', { p_slug: slug });
    if (error) throw error;
    return ok((data ?? null) as unknown as LexphArticuloPublico | null);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}
