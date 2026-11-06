import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

// =============================================================================
// DGG-244 · LexPH — hub editorial (CMS de gerencia). Capa de servicio (R4).
//
// Fase 1: carga manual por staff (gerente/operador). Las tablas son staff-only
// (RLS); la lectura pública (anon) se habilita en una fase posterior detrás de
// un flag config_global + noindex. El cuerpo es HTML del editor TipTap y se
// sanitiza con DOMPurify al renderizar (ver componentes de LexPH).
//
// Guardar artículo + etiquetas es multi-tabla → va por la RPC SECURITY DEFINER
// `lexph_articulo_guardar` (R5). El resto (tags sueltos, borrado de artículo con
// cascada de etiquetas) es single-table y va directo, gateado por la policy RLS.
// =============================================================================

export type LexphArticulo = Database['public']['Tables']['lexph_articulos']['Row'];
export type LexphTag = Database['public']['Tables']['lexph_tags']['Row'];

export type LexphTipo = 'fallo' | 'normativa' | 'internacional' | 'insight';
export type LexphEstado = 'borrador' | 'publicado';
export type LexphTagTipo = 'materia' | 'jurisdiccion';

// Fuente citable de un artículo (forma del jsonb `fuentes`).
export interface LexphFuente {
  cita: string;
  url?: string | null;
}

// Artículo + sus etiquetas resueltas (para grilla / detalle / render público).
export interface LexphArticuloConTags extends LexphArticulo {
  tags: LexphTag[];
}

// Payload de guardado desde el CMS.
export interface GuardarArticuloInput {
  id?: string | null;
  tipo: LexphTipo;
  estado: LexphEstado;
  titulo: string;
  slug: string;
  resumen?: string | null;
  cuerpo?: string | null;
  campos?: Record<string, unknown> | null;
  fuentes?: LexphFuente[] | null;
  tagIds?: string[];
  imagenUrl?: string | null;
  imagenAlt?: string | null;
}

// ---------------------------------------------------------------------------
// Slug: normaliza a [a-z0-9-] (NFKD + sin diacríticos). Determinístico, estable.
// ---------------------------------------------------------------------------
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // diacríticos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// Forma del embebido que devuelve PostgREST para las etiquetas.
type ArticuloTagEmbed = {
  lexph_tags: LexphTag | null;
};

function mapArticuloConTags(
  row: LexphArticulo & { lexph_articulo_tags?: ArticuloTagEmbed[] | null },
): LexphArticuloConTags {
  const tags = (row.lexph_articulo_tags ?? [])
    .map((t) => t.lexph_tags)
    .filter((t): t is LexphTag => t !== null)
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  const { lexph_articulo_tags: _omit, ...rest } = row;
  void _omit;
  return { ...(rest as LexphArticulo), tags };
}

// ---------------------------------------------------------------------------
// ARTÍCULOS
// ---------------------------------------------------------------------------

// Universo COMPLETO (todos los estados) — los KPIs y filtros se calculan en
// memoria sobre este dataset (R19). No filtrar por estado en el backend.
export async function listArticulos(): Promise<ApiResponse<LexphArticuloConTags[]>> {
  try {
    const { data, error } = await supabase
      .from('lexph_articulos')
      .select('*, lexph_articulo_tags(lexph_tags(*))')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as Array<
      LexphArticulo & { lexph_articulo_tags?: ArticuloTagEmbed[] | null }
    >;
    return ok(rows.map(mapArticuloConTags));
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function getArticulo(
  id: string,
): Promise<ApiResponse<LexphArticuloConTags>> {
  try {
    const { data, error } = await supabase
      .from('lexph_articulos')
      .select('*, lexph_articulo_tags(lexph_tags(*))')
      .eq('id', id)
      .single();
    if (error) throw error;
    return ok(
      mapArticuloConTags(
        data as LexphArticulo & { lexph_articulo_tags?: ArticuloTagEmbed[] | null },
      ),
    );
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function guardarArticulo(
  input: GuardarArticuloInput,
): Promise<ApiResponse<string>> {
  try {
    // pg-meta tipa `p_campos`/`p_fuentes` como Json; casteamos el objeto completo
    // al tipo Args generado a través de `unknown` (patrón del repo para RPCs).
    const args = {
      p_tipo: input.tipo,
      p_estado: input.estado,
      p_titulo: input.titulo,
      p_slug: input.slug,
      p_resumen: input.resumen ?? null,
      p_cuerpo: input.cuerpo ?? null,
      p_campos: input.campos ?? {},
      p_fuentes: input.fuentes ?? [],
      p_tag_ids: input.tagIds ?? [],
      p_imagen_url: input.imagenUrl ?? null,
      p_imagen_alt: input.imagenAlt ?? null,
      p_id: input.id ?? undefined,
    } as unknown as Database['public']['Functions']['lexph_articulo_guardar']['Args'];
    const { data, error } = await supabase.rpc('lexph_articulo_guardar', args);
    if (error) throw error;
    return ok(String(data));
  } catch (e) {
    const err = toApiError(e);
    // Código propio para que humanizeError use el mensaje del server (slug dup, etc.).
    return fail('LEXPH_GUARDAR', err.message, err.details);
  }
}

export async function eliminarArticulo(id: string): Promise<ApiResponse<null>> {
  try {
    const { error } = await supabase.from('lexph_articulos').delete().eq('id', id);
    if (error) throw error;
    return ok(null);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// ---------------------------------------------------------------------------
// EDICIONES (volúmenes) · DGG-244 F2b
// El digest (intro/resumen/tendencias/editorial) es POR EDICIÓN y se pisa; las notas
// se acumulan (edicion_id = edición de debut, auto-asignada por trigger al publicar).
// Guardar/cerrar = RPC SECURITY DEFINER staff-only (R5).
// ---------------------------------------------------------------------------
export type LexphEdicion = Database['public']['Tables']['lexph_ediciones']['Row'];

export interface LexphDigestBulletInput {
  titulo: string;
  texto: string;
}
export interface LexphDigestTendenciaInput {
  materia: string;
  texto: string;
}
export interface LexphEditorialInput {
  kicker?: string;
  titulo?: string;
  cuerpo?: string;
}
export interface GuardarEdicionInput {
  id: string;
  tituloInterno?: string | null;
  intro?: string | null;
  resumen: LexphDigestBulletInput[];
  tendencias: LexphDigestTendenciaInput[];
  editorial: LexphEditorialInput;
  destacadoArticuloId?: string | null;
}

// Edición EN CURSO (mayor seq) para el CMS. null si no es staff / no hay ediciones.
export async function getEdicionActualStaff(): Promise<ApiResponse<LexphEdicion | null>> {
  try {
    const { data, error } = await supabase.rpc('lexph_edicion_actual_staff');
    if (error) throw error;
    return ok((data ?? null) as unknown as LexphEdicion | null);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function guardarEdicion(input: GuardarEdicionInput): Promise<ApiResponse<string>> {
  try {
    const args = {
      p_id: input.id,
      p_titulo_interno: input.tituloInterno ?? null,
      p_intro: input.intro ?? null,
      p_resumen: input.resumen ?? [],
      p_tendencias: input.tendencias ?? [],
      p_editorial: input.editorial ?? {},
      p_destacado_articulo_id: input.destacadoArticuloId ?? null,
    } as unknown as Database['public']['Functions']['lexph_edicion_guardar']['Args'];
    const { data, error } = await supabase.rpc('lexph_edicion_guardar', args);
    if (error) throw error;
    return ok(String(data));
  } catch (e) {
    const err = toApiError(e);
    return fail('LEXPH_EDICION_GUARDAR', err.message, err.details);
  }
}

// Cierra la edición en curso y abre la próxima (devuelve la nueva).
export async function cerrarEdicion(id: string): Promise<ApiResponse<LexphEdicion>> {
  try {
    const { data, error } = await supabase.rpc('lexph_edicion_cerrar', { p_id: id });
    if (error) throw error;
    return ok(data as unknown as LexphEdicion);
  } catch (e) {
    const err = toApiError(e);
    return fail('LEXPH_EDICION_CERRAR', err.message, err.details);
  }
}

// Conteo de suscriptores del newsletter (staff; tabla RLS staff-only). R19: universo completo.
export interface LexphSuscriptoresStats {
  total: number;
  confirmados: number;
  pendientes: number;
}
export async function getSuscriptoresStats(): Promise<ApiResponse<LexphSuscriptoresStats>> {
  try {
    const { data, error } = await supabase.from('lexph_suscriptores').select('estado');
    if (error) throw error;
    const rows = (data ?? []) as { estado: string }[];
    return ok({
      total: rows.length,
      confirmados: rows.filter((r) => r.estado === 'confirmado').length,
      pendientes: rows.filter((r) => r.estado === 'pendiente').length,
    });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// ---------------------------------------------------------------------------
// ETIQUETAS (single-table → directo, gateado por RLS staff)
// ---------------------------------------------------------------------------

export async function listTags(): Promise<ApiResponse<LexphTag[]>> {
  try {
    const { data, error } = await supabase
      .from('lexph_tags')
      .select('*')
      .order('tipo', { ascending: true })
      .order('orden', { ascending: true })
      .order('nombre', { ascending: true });
    if (error) throw error;
    return ok((data ?? []) as LexphTag[]);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export interface GuardarTagInput {
  id?: string | null;
  nombre: string;
  tipo: LexphTagTipo;
  slug?: string;
  orden?: number;
  activo?: boolean;
}

export async function guardarTag(input: GuardarTagInput): Promise<ApiResponse<string>> {
  try {
    const slug = input.slug?.trim() ? slugify(input.slug) : slugify(input.nombre);
    if (!slug) return fail('LEXPH_TAG', 'La etiqueta necesita un nombre válido.');
    if (input.id) {
      const { error } = await supabase
        .from('lexph_tags')
        .update({
          nombre: input.nombre,
          tipo: input.tipo,
          slug,
          orden: input.orden ?? 0,
          activo: input.activo ?? true,
        })
        .eq('id', input.id);
      if (error) throw error;
      return ok(input.id);
    }
    const { data, error } = await supabase
      .from('lexph_tags')
      .insert({
        nombre: input.nombre,
        tipo: input.tipo,
        slug,
        orden: input.orden ?? 0,
        activo: input.activo ?? true,
      })
      .select('id')
      .single();
    if (error) throw error;
    return ok((data as { id: string }).id);
  } catch (e) {
    const err = toApiError(e);
    return fail('LEXPH_TAG', err.message, err.details);
  }
}

export async function eliminarTag(id: string): Promise<ApiResponse<null>> {
  try {
    const { error } = await supabase.from('lexph_tags').delete().eq('id', id);
    if (error) throw error;
    return ok(null);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}
