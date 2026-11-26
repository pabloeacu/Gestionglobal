import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, type ApiResponse } from '@/lib/errors';

// ============================================================================
// DGG-269 · CRM de Captación Federal (segmento prospectos.origen='import_nacional':
// CABA/PBA-no-padrón/OTRO, que vinieron de congresos/convenciones/Excel de GG).
// Hermano de prospectosCaptacion (PBA) pero segmenta por JURISDICCIÓN (no por
// vencimiento de matrícula) y las campañas son targeteadas y manuales.
// Todo el envío está GATEADO detrás de config_global.federal_campanas_activo
// (server-side, ver prospectos_federal_enviar_campana). RPCs de la mig 0716.
// R4: todo query vive acá, no en componentes.
// ============================================================================

export type JurisdiccionFederal = 'CABA' | 'PBA' | 'OTRO';

export const JURISDICCIONES: { key: JurisdiccionFederal; label: string }[] = [
  { key: 'CABA', label: 'CABA' },
  { key: 'PBA', label: 'PBA (no-padrón)' },
  { key: 'OTRO', label: 'Otros' },
];

export interface FederalKpis {
  total: number;
  caba: number;
  pba: number;
  otro: number;
  con_email: number;
  suprimidos: number;
  contactados: number;
  convertidos: number;
  bajas: number;
  activo: boolean;
  enviados_total: number;
  encolados_hoy: number;
  cola_pendiente: number;
  hoy: string;
}

export interface ProspectoFederalRow {
  id: string;
  nombre: string;
  nombre_pila: string | null;
  email: string;
  telefono: string | null;
  matricula: string | null;
  jurisdiccion: string | null;
  origen_detalle: string | null;
  estado_captacion: string | null;
  suprimido: boolean;
  ultimo_mail_slug: string | null;
  ultimo_mail_asunto: string | null;
  ultimo_mail_at: string | null;
  convertido_at: string | null;
  baja_at: string | null;
  /** Campañas ya enviadas a este prospecto: { slug: últimaFechaISO }. */
  campanas_enviadas: Record<string, string> | null;
  total_count: number;
}

export interface FederalCampanaPreview {
  template: string;
  template_existe: boolean;
  jurisdiccion: string | null;
  en_segmento: number;
  sin_email: number;
  suprimidos: number;
  en_gracia: number;
  en_cooldown: number;
  elegibles: number;
}

export interface FederalEnviarResult {
  ok: boolean;
  encolados?: number;
  dias?: number;
  template?: string;
  jurisdiccion?: string | null;
  cap_diario?: number;
  forzado?: boolean;
  error?: string;
  gated?: boolean;
}

// Catálogo de campañas federales (slugs 'federal-%' de la mig 0717). `lanzable` marca
// cuáles se disparan desde el lanzador manual de esta página; el webinar (federal-webinar)
// es una maqueta que se enruta desde un evento, por eso NO es lanzable — pero SÍ está en el
// catálogo para pintar su "coin" en la grilla si al prospecto le llegó (DGG-270, pedido de Pablo:
// "las campañas prototipo con sus íconos, de modo de que marque a quién ya se le envió una").
export interface FederalCampanaItem {
  slug: string;
  label: string;
  descripcion: string;
  /** Hex del acento (coincide con color_acento del template). */
  color: string;
  /** Inicial corta (2 letras) para la "moneda"/chip de la grilla. */
  inicial: string;
  /** true si se dispara desde el lanzador manual de esta página (el webinar no). */
  lanzable: boolean;
}

export const FEDERAL_CAMPANAS_CATALOGO: FederalCampanaItem[] = [
  { slug: 'federal-rpa-caba', label: 'Curso RPA (CABA)', color: '#009ECA', inicial: 'RP', lanzable: true,
    descripcion: 'Actualización RPA (CABA) — modalidad mixta, certificado habilitante. Ideal para jurisdicción CABA.' },
  { slug: 'federal-consultoria', label: 'Consultoría jurídica', color: '#159AA6', inicial: 'CJ', lanzable: true,
    descripcion: 'Consultoría jurídica de propiedad horizontal, para todo el país.' },
  { slug: 'federal-webinar', label: 'Webinar', color: '#2E6FB0', inicial: 'Wb', lanzable: false,
    descripcion: 'Invitación a webinar (se enruta desde un evento, no desde el lanzador manual).' },
];

// Sólo las lanzables desde el botón "Lanzar campaña" de esta página.
export const FEDERAL_CAMPANAS_LANZABLES = FEDERAL_CAMPANAS_CATALOGO.filter((c) => c.lanzable);

export async function getFederalKpis(): Promise<ApiResponse<FederalKpis>> {
  try {
    const { data, error } = await supabase.rpc('prospectos_federal_kpis');
    if (error) throw error;
    return ok(data as unknown as FederalKpis);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export interface ListFederalParams {
  jurisdiccion?: JurisdiccionFederal | null;
  estado?: string | null;
  search?: string | null;
  soloConEmail?: boolean;
  limit?: number;
  offset?: number;
}

export async function listProspectosFederal(
  params: ListFederalParams = {},
): Promise<ApiResponse<{ rows: ProspectoFederalRow[]; total: number }>> {
  try {
    const { data, error } = await supabase.rpc('prospectos_federal_list', {
      p_jurisdiccion: params.jurisdiccion ?? undefined,
      p_estado: params.estado ?? undefined,
      p_search: params.search ?? undefined,
      p_solo_con_email: params.soloConEmail ?? false,
      p_limit: params.limit ?? 50,
      p_offset: params.offset ?? 0,
    });
    if (error) throw error;
    const rows = (data ?? []) as unknown as ProspectoFederalRow[];
    const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;
    return ok({ rows, total });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function previewFederalCampana(
  templateSlug: string,
  jurisdiccion: JurisdiccionFederal | null,
): Promise<ApiResponse<FederalCampanaPreview>> {
  try {
    const { data, error } = await supabase.rpc('prospectos_federal_preview_campana', {
      p_template_slug: templateSlug,
      p_jurisdiccion: jurisdiccion ?? undefined,
    });
    if (error) throw error;
    return ok(data as unknown as FederalCampanaPreview);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function enviarFederalCampana(
  templateSlug: string,
  jurisdiccion: JurisdiccionFederal | null,
  limiteDiario: number,
  forzar = false,
): Promise<ApiResponse<FederalEnviarResult>> {
  try {
    const { data, error } = await supabase.rpc('prospectos_federal_enviar_campana', {
      p_template_slug: templateSlug,
      p_jurisdiccion: jurisdiccion ?? undefined,
      p_limite_diario: limiteDiario,
      p_forzar: forzar,
    });
    if (error) throw error;
    return ok(data as unknown as FederalEnviarResult);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// Baja / reactivación: reusan las RPCs GLOBALES (funcionan por id de prospecto, sin
// importar el origen) ya definidas en prospectosCaptacion. Se re-exportan para que la
// página federal las use sin duplicar lógica.
export { darBajaProspectoManual, reactivarProspectoManual } from './prospectosCaptacion';
