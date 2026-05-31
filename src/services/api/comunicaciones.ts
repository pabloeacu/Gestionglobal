// Panel de Comunicaciones · noticias / novedades multi-canal
// Regla 4: nada de supabase.from() en componentes.
import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database, Json } from '@/types/database';

type ComunicacionInsertDb = Database['public']['Tables']['comunicaciones']['Insert'];
type ComunicacionUpdateDb = Database['public']['Tables']['comunicaciones']['Update'];

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
export type BannerEstilo = 'info' | 'novedad' | 'aviso' | 'urgente';
export type ComunicacionEstado = 'borrador' | 'enviado' | 'archivado';

export type AudienciaTipo = 'todos' | 'manual' | 'by_servicios' | 'by_convenio';

export type Audiencia =
  | { type: 'todos' }
  | { type: 'manual'; administracion_ids: string[] }
  | { type: 'by_servicios'; servicio_ids: string[] }
  | { type: 'by_convenio'; convenios: string[] };

export interface ComunicacionRow {
  id: string;
  titulo: string;
  cuerpo_md: string;
  cuerpo_html: string | null;
  cta_label: string | null;
  cta_url: string | null;
  audiencia: Audiencia;
  canal_banner: boolean;
  canal_email: boolean;
  canal_push: boolean;
  banner_estilo: BannerEstilo;
  visible_desde: string;
  visible_hasta: string | null;
  estado: ComunicacionEstado;
  enviado_at: string | null;
  enviado_por: string | null;
  total_destinatarios: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface ComunicacionInsert {
  titulo: string;
  cuerpo_md: string;
  cuerpo_html?: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
  audiencia: Audiencia;
  canal_banner: boolean;
  canal_email: boolean;
  canal_push: boolean;
  banner_estilo: BannerEstilo;
  visible_desde?: string;
  visible_hasta?: string | null;
}

export interface DestinatarioPreview {
  administracion_id: string;
  nombre: string;
  email: string | null;
  tiene_user: boolean;
}

export interface NovedadCliente {
  id: string;
  titulo: string;
  cuerpo_md: string;
  cta_label: string | null;
  cta_url: string | null;
  banner_estilo: BannerEstilo;
  enviado_at: string;
  visto_at: string | null;
}

// ---------------------------------------------------------------------------
// CRUD gerencia
// ---------------------------------------------------------------------------
export async function listComunicaciones(): Promise<ApiResponse<ComunicacionRow[]>> {
  const { data, error } = await supabase
    .from('comunicaciones')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return fail('COMUNICACIONES_LIST', error.message, error);
  return ok((data ?? []) as unknown as ComunicacionRow[]);
}

export async function getComunicacion(id: string): Promise<ApiResponse<ComunicacionRow>> {
  const { data, error } = await supabase
    .from('comunicaciones')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return fail('COMUNICACIONES_GET', error.message, error);
  if (!data) return fail('COMUNICACIONES_GET', 'no encontrada');
  return ok(data as unknown as ComunicacionRow);
}

export async function crearComunicacion(
  input: ComunicacionInsert,
): Promise<ApiResponse<ComunicacionRow>> {
  const payload: ComunicacionInsertDb = {
    titulo: input.titulo,
    cuerpo_md: input.cuerpo_md,
    cuerpo_html: input.cuerpo_html ?? null,
    cta_label: input.cta_label ?? null,
    cta_url: input.cta_url ?? null,
    audiencia: input.audiencia as unknown as Json,
    canal_banner: input.canal_banner,
    canal_email: input.canal_email,
    canal_push: input.canal_push,
    banner_estilo: input.banner_estilo,
    visible_desde: input.visible_desde,
    visible_hasta: input.visible_hasta ?? null,
  };
  const { data, error } = await supabase
    .from('comunicaciones')
    .insert(payload)
    .select('*')
    .single();
  if (error) return fail('COMUNICACIONES_CREATE', error.message, error);
  return ok(data as unknown as ComunicacionRow);
}

export async function actualizarComunicacion(
  id: string,
  patch: Partial<ComunicacionInsert>,
): Promise<ApiResponse<ComunicacionRow>> {
  const payload: ComunicacionUpdateDb = {
    ...(patch.titulo !== undefined && { titulo: patch.titulo }),
    ...(patch.cuerpo_md !== undefined && { cuerpo_md: patch.cuerpo_md }),
    ...(patch.cuerpo_html !== undefined && { cuerpo_html: patch.cuerpo_html ?? null }),
    ...(patch.cta_label !== undefined && { cta_label: patch.cta_label ?? null }),
    ...(patch.cta_url !== undefined && { cta_url: patch.cta_url ?? null }),
    ...(patch.audiencia !== undefined && { audiencia: patch.audiencia as unknown as Json }),
    ...(patch.canal_banner !== undefined && { canal_banner: patch.canal_banner }),
    ...(patch.canal_email !== undefined && { canal_email: patch.canal_email }),
    ...(patch.canal_push !== undefined && { canal_push: patch.canal_push }),
    ...(patch.banner_estilo !== undefined && { banner_estilo: patch.banner_estilo }),
    ...(patch.visible_desde !== undefined && { visible_desde: patch.visible_desde }),
    ...(patch.visible_hasta !== undefined && { visible_hasta: patch.visible_hasta ?? null }),
  };
  const { data, error } = await supabase
    .from('comunicaciones')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return fail('COMUNICACIONES_UPDATE', error.message, error);
  return ok(data as unknown as ComunicacionRow);
}

export async function eliminarComunicacion(id: string): Promise<ApiResponse<void>> {
  const { error } = await supabase.from('comunicaciones').delete().eq('id', id);
  if (error) return fail('COMUNICACIONES_DELETE', error.message, error);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Preview de destinatarios y envío
// ---------------------------------------------------------------------------
export async function previewDestinatarios(
  audiencia: Audiencia,
): Promise<ApiResponse<DestinatarioPreview[]>> {
  const { data, error } = await supabase.rpc(
    'comunicacion_preview_destinatarios',
    { p_audiencia: audiencia as unknown as Json },
  );
  if (error) return fail('COMUNICACIONES_PREVIEW', error.message, error);
  return ok((data ?? []) as unknown as DestinatarioPreview[]);
}

export interface EnvioResultado {
  comunicacion_id: string;
  destinatarios: number;
  emails_encolados: number;
  pushes_encolados: number;
}

export async function enviarComunicacion(
  id: string,
): Promise<ApiResponse<EnvioResultado>> {
  const { data, error } = await supabase.rpc('comunicacion_enviar', { p_id: id });
  if (error) return fail('COMUNICACIONES_ENVIAR', error.message, error);
  return ok(data as unknown as EnvioResultado);
}

// ---------------------------------------------------------------------------
// Portal cliente
// ---------------------------------------------------------------------------
export async function listNovedadesCliente(): Promise<ApiResponse<NovedadCliente[]>> {
  const { data, error } = await supabase.rpc('comunicaciones_vigentes_cliente');
  if (error) return fail('NOVEDADES_LIST', error.message, error);
  return ok((data ?? []) as unknown as NovedadCliente[]);
}

export async function marcarNovedadVista(id: string): Promise<ApiResponse<void>> {
  const { error } = await supabase.rpc('comunicacion_marcar_vista', {
    p_comunicacion_id: id,
  });
  if (error) return fail('NOVEDADES_MARCAR_VISTA', error.message, error);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Helpers UI
// ---------------------------------------------------------------------------
export const BANNER_ESTILO_LABEL: Record<BannerEstilo, string> = {
  info: 'Informativo',
  novedad: 'Novedad',
  aviso: 'Aviso',
  urgente: 'Urgente',
};

export const BANNER_ESTILO_BADGE: Record<
  BannerEstilo,
  { bg: string; text: string; ring: string }
> = {
  info: { bg: 'bg-slate-100', text: 'text-slate-700', ring: 'ring-slate-300' },
  novedad: { bg: 'bg-cyan-50', text: 'text-cyan-700', ring: 'ring-cyan-200' },
  aviso: { bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-300' },
  urgente: { bg: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-300' },
};
