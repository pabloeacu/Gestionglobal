// portal-dashboard · APIs para el portal del cliente premium.
// Citas: regla 4 (queries en services/), regla 5 (RPC SD+search_path),
// regla 12 (tenancy via private.current_administracion_id()).

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';

// =========================================================================
// Tipos del dashboard del cliente
// =========================================================================

export interface ClienteAdministracion {
  id: string;
  codigo: string;
  nombre: string;
  responsable_nombre: string | null;
  responsable_apellido: string | null;
  foto_url: string | null;
  matricula_rpac: string | null;
  matricula_rpac_fecha: string | null;
  matricula_rpac_vencimiento: string | null;
  matricula_rpac_dias_a_vencimiento: number | null;
  matricula_rpa: string | null;
  tiene_matricula: boolean;
}

export interface ClienteDeuda {
  total: number;
  tiene_deuda: boolean;
  pendientes_count: number;
  vencidos_count: number;
  proximo_vencimiento: string | null;
}

export interface ClienteClaseHoy {
  encuentro_id: string;
  curso_id: string;
  curso_slug: string;
  curso_titulo: string;
  encuentro_titulo: string;
  fecha_hora: string;
  minutos_para_inicio: number;
  duracion_min: number | null;
  link_zoom: string | null;
  link_webex: string | null;
  plataforma: string;
  iniciado_at: string | null;
}

export interface ClienteWebinar {
  webinar_id: string;
  titulo: string;
  fecha_hora: string;
  horas_para_inicio: number;
  plataforma: string;
  link: string | null;
  status: string;
  inscripto?: boolean;
}

export interface ClienteCurso {
  matricula_id: string;
  curso_id: string;
  curso_slug: string;
  curso_titulo: string;
  modalidad: string;
  vigencia_hasta: string | null;
  inscripto_at: string;
  banner_url: string | null;
}

export interface ClienteVencimientoProx {
  id: string;
  tipo: string;
  descripcion: string | null;
  fecha_vencimiento: string;
  dias_restantes: number;
  estado: string;
  consorcio_id: string | null;
  sujeto: string;
}

export interface ClienteTramiteResumen {
  id: string;
  codigo: string;
  titulo: string;
  categoria: string;
  estado: string;
  ultima_actividad_at: string;
  horas_desde_actividad: number;
}

export interface ClienteOportunidad {
  codigo: string;
  kicker: string;
  titulo: string;
  descripcion: string;
  cta_label: string;
  cta_path: string;
  tone: 'urgente' | 'alto' | 'medio' | 'suave';
  icono: string;
  webinar_id?: string;
  fecha_hora?: string;
  // DGG-45 · true en banners "suaves" (cross-sell/recordatorios): se pueden
  // posponer 30 días. Las obligaciones/deadlines vienen sin este flag.
  posponible?: boolean;
}

export interface ClientePortalDashboard {
  administracion: ClienteAdministracion;
  deuda: ClienteDeuda;
  clase_hoy: ClienteClaseHoy | null;
  webinar_proximo: ClienteWebinar | null;
  cursos_activos: ClienteCurso[];
  tramites_abiertos_count: number;
  ultimo_tramite: ClienteTramiteResumen | null;
  vencimientos_proximos: ClienteVencimientoProx[];
  oportunidades: ClienteOportunidad[];
  generated_at: string;
  error?: string;
}

export async function fetchClientePortalDashboard(): Promise<ApiResponse<ClientePortalDashboard>> {
  const { data, error } = await supabase.rpc('cliente_portal_dashboard');
  if (error) return fail('PORTAL_DASHBOARD', error.message, error);
  return ok(data as unknown as ClientePortalDashboard);
}

/**
 * DGG-45 · Registra que estos banners de oportunidad fueron MOSTRADOS hoy.
 * Sostiene la recurrencia "desde la última vez mostrado" (el banner no
 * reaparece hasta N días después). Se llama una vez por carga del dashboard
 * con los códigos de las oportunidades suaves visibles.
 */
export async function marcarOportunidadMostrada(codigos: string[]): Promise<void> {
  if (codigos.length === 0) return;
  await supabase.rpc('cliente_oportunidad_marcar_mostrada' as never, {
    p_codigos: codigos,
  } as never);
}

/**
 * DGG-45 · Pospone un banner de oportunidad 30 días (acción "Recordar después").
 */
export async function posponerOportunidad(codigo: string): Promise<ApiResponse<true>> {
  const { error } = await supabase.rpc('cliente_oportunidad_posponer' as never, {
    p_codigo: codigo,
  } as never);
  if (error) return fail('OPORTUNIDAD_POSPONER', error.message, error);
  return ok(true);
}

/**
 * Cuenta de avances de tracking sin leer (notif_internas tipo='tracking_avance').
 * Usado para el badge "X nuevos" en la card "Mis gestiones" del portal.
 */
export async function fetchTrackingAvancesNuevosCount(): Promise<number> {
  const { data, error } = await supabase.rpc('cliente_tracking_avances_nuevos_count' as never);
  if (error) return 0;
  return (data as unknown as number) ?? 0;
}

/**
 * Marca como leídas las notif_internas tipo tracking_avance asociadas a un tramite.
 * Se llama cuando el cliente abre la vista detalle del tramite.
 */
export async function marcarTrackingAvanceLeido(tramiteId: string): Promise<number> {
  const { data, error } = await supabase.rpc('cliente_marcar_tracking_leido' as never, {
    p_tramite_id: tramiteId,
  } as never);
  if (error) return 0;
  return (data as unknown as number) ?? 0;
}

// =========================================================================
// Mis trámites
// =========================================================================

export interface ClienteTramite {
  id: string;
  codigo: string;
  titulo: string;
  categoria: string;
  prioridad: string;
  estado: string;
  vence_at: string | null;
  ultima_actividad_at: string;
  horas_desde_actividad: number;
  total_comentarios: number;
  total_adjuntos: number;
  consorcio_id: string | null;
  servicio_id: string | null;
  created_at: string;
}

export async function fetchClienteTramites(soloAbiertos = false): Promise<ApiResponse<ClienteTramite[]>> {
  const { data, error } = await supabase.rpc('cliente_tramites_listar', {
    p_solo_abiertos: soloAbiertos,
  });
  if (error) return fail('CLIENTE_TRAMITES', error.message, error);
  return ok((data ?? []) as ClienteTramite[]);
}

// =========================================================================
// Mis webinars
// =========================================================================

export interface ClienteWebinarItem {
  webinar_id: string;
  titulo: string;
  descripcion: string | null;
  fecha_hora: string;
  duracion_min: number | null;
  status?: string;
  plataforma: string;
  link?: string | null;
  grabacion_url?: string | null;
  inscripto_at?: string;
  asistio?: boolean;
}

export interface ClienteWebinarsResponse {
  mis_webinars: ClienteWebinarItem[];
  disponibles: ClienteWebinarItem[];
  error?: string;
}

export async function fetchClienteWebinars(): Promise<ApiResponse<ClienteWebinarsResponse>> {
  const { data, error } = await supabase.rpc('cliente_webinars_listar');
  if (error) return fail('CLIENTE_WEBINARS', error.message, error);
  return ok(data as unknown as ClienteWebinarsResponse);
}

// =========================================================================
// Catálogo de formularios disponibles (solicitar nuevo servicio)
// =========================================================================

export interface ClienteFormularioCatalogItem {
  formulario_id: string;
  slug: string;
  titulo: string;
  descripcion: string | null;
  categoria: string;
}

export async function fetchClienteCatalogo(): Promise<ApiResponse<ClienteFormularioCatalogItem[]>> {
  const { data, error } = await supabase.rpc('cliente_catalogo_formularios');
  if (error) return fail('CLIENTE_CATALOGO', error.message, error);
  return ok((data ?? []) as ClienteFormularioCatalogItem[]);
}

// =========================================================================
// Líneas de tracking visibles al cliente (timeline en modal de Mis gestiones)
// =========================================================================

export interface ClienteTrackingLinea {
  id: string;
  categoria_slug: string;
  categoria_label: string;
  categoria_icono: string;
  categoria_color: string;
  descripcion: string;
  archivos_urls: string[];
  autor_nombre: string;
  created_at: string;
}

/**
 * Lista las líneas de avance visibles al cliente para un trámite suyo.
 * RPC valida que el trámite pertenezca a la administración del usuario.
 */
export async function fetchClienteTrackingLineas(
  tramiteId: string,
): Promise<ClienteTrackingLinea[]> {
  const { data, error } = await supabase.rpc('cliente_tracking_lineas' as never, {
    p_tramite_id: tramiteId,
  } as never);
  if (error) return [];
  return (data ?? []) as unknown as ClienteTrackingLinea[];
}
