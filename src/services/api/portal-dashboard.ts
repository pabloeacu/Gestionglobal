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
