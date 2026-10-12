import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, type ApiResponse } from '@/lib/errors';

// ============================================================================
// DGG-220 · CRM de captación (padrón PBA). Lee los RPCs de la mig 0549
// (SECDEF staff-gated). Todo el envío de marketing está GATED detrás del flag
// config_global.prospectos_campanas_activo (server-side, ver prospectos_enviar_campana).
// R4: todo query vive acá, no en componentes.
// ============================================================================

export type SegmentoCaptacion =
  | 'vencida' | 'curso_reno_30' | 'curso_31_90' | 'vigente_lejos' | 'sin_dato';

export interface CaptacionKpis {
  total: number;
  con_email_real: number;
  sin_email: number;
  sancionados: number;
  convertidos: number;
  bajas: number;
  contactados: number;
  seg_vencida: number;
  seg_curso_reno_30: number;
  seg_curso_31_90: number;
  seg_vigente_lejos: number;
  seg_sin_dato: number;
  activo: boolean;
  hoy: string;
  enriquecidos: number;
  enrich_pendientes: number;
  padron_total: number;
}

export interface ProspectoCaptacionRow {
  id: string;
  nombre: string;
  email: string;
  cuit: string | null;
  matricula: string | null;
  legajo: string | null;
  matricula_vencimiento: string | null;
  ultima_renovacion: string | null;
  segmento: SegmentoCaptacion;
  estado_captacion: string | null;
  sanciones: boolean | null;
  sin_email: boolean;
  suprimido: boolean;
  ultimo_mail_slug: string | null;
  ultimo_mail_asunto: string | null;
  ultimo_mail_at: string | null;
  convertido_at: string | null;
  baja_at: string | null;
  padron_count: number;
  total_count: number;
}

export interface CampanaPreview {
  template: string;
  template_existe: boolean;
  segmento: string | null;
  es_de_vencimiento: boolean;
  bloqueado_guard: boolean;
  en_segmento: number;
  sin_email: number;
  suprimidos: number;
  en_gracia: number;
  en_cooldown: number;
  elegibles: number;
}

export interface EnviarCampanaResult {
  ok: boolean;
  encolados: number;
  error?: string;
  gated?: boolean;
  template?: string;
  segmento?: string | null;
}

// Catálogo de campañas (los 7 templates de la mig 0547). `vencimiento` marca
// las que exigen un segmento de vencimiento (el RPC lo valida igual).
export interface CampanaCatalogoItem {
  slug: string;
  label: string;
  vencimiento: boolean;
  estrella: 'FUNDPLATA' | 'GG';
  descripcion: string;
}

export const CAMPANAS_CATALOGO: CampanaCatalogoItem[] = [
  { slug: 'captacion-curso-3190', label: 'Curso de actualización (31-90 días)', vencimiento: true, estrella: 'FUNDPLATA', descripcion: 'Matrícula vence en 31-90 días → invitación al curso.' },
  { slug: 'captacion-curso-reno', label: 'Curso + renovación (≤30 días)', vencimiento: true, estrella: 'FUNDPLATA', descripcion: 'Matrícula vence en ≤30 días → curso y renovación juntos.' },
  { slug: 'captacion-vencida', label: '¿Se te venció la matrícula?', vencimiento: true, estrella: 'FUNDPLATA', descripcion: 'Matrícula vencida → regularización (empático).' },
  { slug: 'captacion-campus', label: 'Campus + certificado', vencimiento: false, estrella: 'GG', descripcion: 'Bondad de plataforma — campus virtual con certificado.' },
  { slug: 'captacion-agenda', label: 'Agenda de vencimientos', vencimiento: false, estrella: 'GG', descripcion: 'Bondad — agenda personalizada + recordatorios.' },
  { slug: 'captacion-tramites', label: 'Seguimiento de trámites', vencimiento: false, estrella: 'GG', descripcion: 'Bondad — seguimiento de trámites en tiempo real.' },
  { slug: 'captacion-capacitaciones', label: 'Capacitaciones gratuitas', vencimiento: false, estrella: 'GG', descripcion: 'Bondad — capacitaciones/webinars gratuitos.' },
];

export const SEGMENTO_LABEL: Record<SegmentoCaptacion, string> = {
  vencida: 'Vencida',
  curso_reno_30: 'Vence ≤30d',
  curso_31_90: 'Vence 31-90d',
  vigente_lejos: 'Vigente',
  sin_dato: 'Sin dato',
};

export async function getCaptacionKpis(): Promise<ApiResponse<CaptacionKpis>> {
  try {
    const { data, error } = await supabase.rpc('prospectos_captacion_kpis');
    if (error) throw error;
    return ok(data as unknown as CaptacionKpis);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export interface ListCaptacionParams {
  segmento?: SegmentoCaptacion | null;
  estado?: string | null;
  search?: string | null;
  soloSancionados?: boolean;
  soloConEmail?: boolean;
  limit?: number;
  offset?: number;
}

export async function listProspectosCaptacion(
  params: ListCaptacionParams = {},
): Promise<ApiResponse<{ rows: ProspectoCaptacionRow[]; total: number }>> {
  try {
    const { data, error } = await supabase.rpc('prospectos_captacion_list', {
      p_segmento: params.segmento ?? undefined,
      p_estado: params.estado ?? undefined,
      p_search: params.search ?? undefined,
      p_solo_sancionados: params.soloSancionados ?? false,
      p_solo_con_email: params.soloConEmail ?? false,
      p_limit: params.limit ?? 50,
      p_offset: params.offset ?? 0,
    });
    if (error) throw error;
    const rows = (data ?? []) as unknown as ProspectoCaptacionRow[];
    const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;
    return ok({ rows, total });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function previewCampana(
  templateSlug: string,
  segmento: SegmentoCaptacion | null,
): Promise<ApiResponse<CampanaPreview>> {
  try {
    const { data, error } = await supabase.rpc('prospectos_preview_campana', {
      p_template_slug: templateSlug,
      p_segmento: segmento ?? undefined,
    });
    if (error) throw error;
    return ok(data as unknown as CampanaPreview);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function enviarCampana(
  templateSlug: string,
  segmento: SegmentoCaptacion | null,
  limite: number,
): Promise<ApiResponse<EnviarCampanaResult>> {
  try {
    const { data, error } = await supabase.rpc('prospectos_enviar_campana', {
      p_template_slug: templateSlug,
      p_segmento: segmento ?? undefined,
      p_limite: limite,
    });
    if (error) throw error;
    return ok(data as unknown as EnviarCampanaResult);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}
