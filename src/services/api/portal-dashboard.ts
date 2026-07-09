// portal-dashboard · APIs para el portal del cliente premium.
// Citas: regla 4 (queries en services/), regla 5 (RPC SD+search_path),
// regla 12 (tenancy via private.current_administracion_id()).

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import { parseDocentes, type WebinarDocente, type EventoModalidad } from './webinars';

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
  // Sólo en `disponibles` (mig 0299): el arancel es informativo para la card.
  es_arancelado?: boolean;
  arancel_monto?: number | null;
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

// Etapa A (DGG-100) · Ficha del evento en el portal: info pública completa
// (banner/flyer/disertantes/ubicación/mapa/arancel/grabación) + estado de
// inscripción del cliente. RPC cliente_evento_detalle (mig 0302, SD + tenancy;
// nunca expone secretos Zoom). Devuelve null si el evento no existe o no es
// visible para el cliente (no publicado y no inscripto).
export interface ClienteEventoDetalle {
  id: string;
  titulo: string;
  descripcion: string | null;
  banner_url: string | null;
  flyer_url: string | null;
  docentes: WebinarDocente[];
  fecha_hora: string;
  duracion_min: number;
  plataforma: string;
  modalidad: EventoModalidad;
  tipo: string;
  status: string;
  ubicacion_lugar: string | null;
  ubicacion_direccion: string | null;
  ubicacion_localidad: string | null;
  ubicacion_mapa_url: string | null;
  ubicacion_instrucciones: string | null;
  es_arancelado: boolean;
  arancel_monto: number | null;
  arancel_nota: string | null;
  grabacion_url: string | null;
  inscripto: boolean;
  canal: string | null;
  asistio: boolean;
  join_url: string | null;
}

export async function fetchClienteEventoDetalle(
  webinarId: string,
): Promise<ApiResponse<ClienteEventoDetalle | null>> {
  try {
    const { data, error } = await supabase.rpc('cliente_evento_detalle', {
      p_webinar_id: webinarId,
    });
    if (error) throw error;
    const raw = (data ?? {}) as Record<string, unknown>;
    if (!raw.id || raw.error) return ok(null); // no encontrado / no visible / sin contexto
    return ok({
      id: String(raw.id),
      titulo: String(raw.titulo),
      descripcion: (raw.descripcion as string | null) ?? null,
      banner_url: (raw.banner_url as string | null) ?? null,
      flyer_url: (raw.flyer_url as string | null) ?? null,
      docentes: parseDocentes(raw.docentes as never),
      fecha_hora: String(raw.fecha_hora),
      duracion_min: Number(raw.duracion_min ?? 0),
      plataforma: String(raw.plataforma ?? 'zoom'),
      modalidad: ((raw.modalidad as EventoModalidad | null) ?? 'online'),
      tipo: String(raw.tipo ?? 'webinar'),
      status: String(raw.status ?? 'programado'),
      ubicacion_lugar: (raw.ubicacion_lugar as string | null) ?? null,
      ubicacion_direccion: (raw.ubicacion_direccion as string | null) ?? null,
      ubicacion_localidad: (raw.ubicacion_localidad as string | null) ?? null,
      ubicacion_mapa_url: (raw.ubicacion_mapa_url as string | null) ?? null,
      ubicacion_instrucciones: (raw.ubicacion_instrucciones as string | null) ?? null,
      es_arancelado: Boolean(raw.es_arancelado ?? false),
      arancel_monto: raw.arancel_monto != null ? Number(raw.arancel_monto) : null,
      arancel_nota: (raw.arancel_nota as string | null) ?? null,
      grabacion_url: (raw.grabacion_url as string | null) ?? null,
      inscripto: Boolean(raw.inscripto ?? false),
      canal: (raw.canal as string | null) ?? null,
      asistio: Boolean(raw.asistio ?? false),
      join_url: (raw.join_url as string | null) ?? null,
    });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return fail(err.code ?? 'CLIENTE_EVENTO_DETALLE', err.message ?? 'Error', e);
  }
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
