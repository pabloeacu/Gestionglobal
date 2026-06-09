import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

// DGG-11/15: Subsistema Webinars públicos. Captación de prospectos via
// formulario evento → magic-link → /webinar/:token. Backbone Zoom (Fase 3)
// con fallback a YouTube Live cuando el cupo de Zoom se completa.

export type WebinarRow = Database['public']['Tables']['webinars']['Row'];
export type WebinarInscriptoRow = Database['public']['Tables']['webinar_inscriptos']['Row'];
export type ProspectoRow = Database['public']['Tables']['prospectos']['Row'];

// F6 (DGG-63) · Roster de docentes del webinar (esquema tipo curso). Se
// persiste en webinars.docentes (jsonb [{nombre,foto_url}]). foto_url puede
// ser null → la UI muestra la inicial del nombre (igual que campus).
export interface WebinarDocente {
  nombre: string;
  foto_url: string | null;
}

/**
 * Lee de forma defensiva el roster de docentes de una fila de webinar.
 * `webinars.docentes` es jsonb (tipado como `Json`), así que normalizamos a
 * `WebinarDocente[]` descartando entradas mal formadas. Nunca tira.
 */
export function parseDocentes(value: WebinarRow['docentes']): WebinarDocente[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((d) => {
      if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
      const rec = d as Record<string, unknown>;
      const nombre = typeof rec.nombre === 'string' ? rec.nombre : '';
      const foto = typeof rec.foto_url === 'string' ? rec.foto_url : null;
      return { nombre, foto_url: foto } as WebinarDocente;
    })
    .filter((d): d is WebinarDocente => d !== null);
}

export interface WebinarKpis {
  proximos: number;
  en_vivo: number;
  finalizados: number;
  total_inscriptos: number;
}

// F6 (DGG-63) · Identidad pública del webinar VIGENTE para inscripción
// (landing + portal). Lo que devuelve la RPC webinar_inscripcion_activa():
// sólo campos públicos (sin secretos Zoom) + el formulario vinculado/compartido.
export interface WebinarInscripcionActiva {
  id: string;
  titulo: string;
  descripcion: string | null;
  banner_url: string | null;
  docentes: WebinarDocente[];
  fecha_hora: string;
  duracion_min: number;
  plataforma: string;
  formulario_id: string | null;
  formulario_slug: string | null;
  formulario_activo: boolean | null;
}

/**
 * Trae el webinar publicado + vigente más próximo ("el más próximo gana"), o
 * null si no hay ninguno → el front decide form-vs-texto. Anon-callable.
 */
export async function fetchWebinarInscripcionActiva(): Promise<ApiResponse<WebinarInscripcionActiva | null>> {
  try {
    const { data, error } = await supabase.rpc('webinar_inscripcion_activa' as never);
    if (error) throw error;
    if (!data) return ok(null);
    const raw = data as unknown as Record<string, unknown>;
    return ok({
      id: String(raw.id),
      titulo: String(raw.titulo),
      descripcion: (raw.descripcion as string | null) ?? null,
      banner_url: (raw.banner_url as string | null) ?? null,
      docentes: parseDocentes(raw.docentes as WebinarRow['docentes']),
      fecha_hora: String(raw.fecha_hora),
      duracion_min: Number(raw.duracion_min ?? 0),
      plataforma: String(raw.plataforma ?? 'zoom'),
      formulario_id: (raw.formulario_id as string | null) ?? null,
      formulario_slug: (raw.formulario_slug as string | null) ?? null,
      formulario_activo: (raw.formulario_activo as boolean | null) ?? null,
    });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// DGG-34 R4 sweep · capitalización RPC cliente (PortalWebinarsPage.tsx).
export async function inscribirmeAWebinar(
  webinarId: string,
): Promise<ApiResponse<true>> {
  const { error } = await supabase.rpc(
    'cliente_webinar_inscribirme' as never,
    { p_webinar_id: webinarId } as never,
  );
  if (error) return fail('WEBINAR_INSCRIBIRME', error.message, error);
  return ok(true);
}

export async function listWebinars(): Promise<ApiResponse<WebinarRow[]>> {
  try {
    const { data, error } = await supabase
      .from('webinars')
      .select('*')
      .order('fecha_hora', { ascending: false });
    if (error) throw error;
    return ok(data ?? []);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function getWebinarKpis(): Promise<ApiResponse<WebinarKpis>> {
  try {
    const { data, error } = await supabase.rpc('list_webinar_kpis');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return ok({
      proximos: Number(row?.proximos ?? 0),
      en_vivo: Number(row?.en_vivo ?? 0),
      finalizados: Number(row?.finalizados ?? 0),
      total_inscriptos: Number(row?.total_inscriptos ?? 0),
    });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function getWebinar(id: string): Promise<ApiResponse<WebinarRow>> {
  try {
    const { data, error } = await supabase
      .from('webinars')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail('not_found', 'Webinar no encontrado');
    return ok(data);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export interface CrearWebinarInput {
  titulo: string;
  descripcion?: string | null;
  fechaHora: string; // ISO
  duracionMin?: number;
  cupoZoom?: number | null;
  formularioId?: string | null;
  youtubeLiveUrl?: string | null;
  plataforma?: 'zoom' | 'webex';
}

export async function crearWebinar(input: CrearWebinarInput): Promise<ApiResponse<string>> {
  try {
    const args = {
      p_titulo: input.titulo.trim(),
      p_descripcion: input.descripcion ?? null,
      p_fecha_hora: input.fechaHora,
      p_duracion_min: input.duracionMin ?? 60,
      p_cupo_zoom: input.cupoZoom ?? 100,
      p_formulario_id: input.formularioId ?? null,
      p_youtube_live_url: input.youtubeLiveUrl ?? null,
      p_plataforma: input.plataforma ?? 'zoom',
    } as unknown as Parameters<typeof supabase.rpc<'crear_webinar'>>[1];
    const { data, error } = await supabase.rpc('crear_webinar', args);
    if (error) throw error;
    return ok(String(data));
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export interface ActualizarWebinarInput {
  titulo?: string;
  descripcion?: string | null;
  fechaHora?: string;
  duracionMin?: number;
  cupoZoom?: number | null;
  youtubeLiveUrl?: string | null;
  grabacionUrl?: string | null;
  status?: 'programado' | 'en_curso' | 'finalizado' | 'cancelado';
  certEsquemaId?: string | null;
  certEmite?: boolean;
  // F6 (DGG-63)
  bannerUrl?: string | null;
  publicado?: boolean;
  docentes?: WebinarDocente[];
}

export async function actualizarWebinar(
  id: string,
  input: ActualizarWebinarInput,
): Promise<ApiResponse<true>> {
  try {
    type WebinarUpdate = Database['public']['Tables']['webinars']['Update'];
    const patch: WebinarUpdate = {};
    if (input.titulo !== undefined) patch.titulo = input.titulo;
    if (input.descripcion !== undefined) patch.descripcion = input.descripcion;
    if (input.fechaHora !== undefined) patch.fecha_hora = input.fechaHora;
    if (input.duracionMin !== undefined) patch.duracion_min = input.duracionMin;
    if (input.cupoZoom !== undefined) patch.cupo_zoom = input.cupoZoom;
    if (input.youtubeLiveUrl !== undefined) patch.youtube_live_url = input.youtubeLiveUrl;
    if (input.grabacionUrl !== undefined) patch.grabacion_url = input.grabacionUrl;
    if (input.status !== undefined) patch.status = input.status;
    if (input.certEsquemaId !== undefined) patch.cert_esquema_id = input.certEsquemaId;
    if (input.certEmite !== undefined) patch.cert_emite = input.certEmite;
    if (input.bannerUrl !== undefined) patch.banner_url = input.bannerUrl;
    if (input.publicado !== undefined) patch.publicado = input.publicado;
    if (input.docentes !== undefined) {
      patch.docentes = input.docentes as unknown as WebinarUpdate['docentes'];
    }
    const { error } = await supabase.from('webinars').update(patch).eq('id', id);
    if (error) throw error;
    return ok(true as const);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function eliminarWebinar(id: string): Promise<ApiResponse<true>> {
  try {
    const { error } = await supabase.from('webinars').delete().eq('id', id);
    if (error) throw error;
    return ok(true as const);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// DGG-29 · emitir cert a un asistente del webinar
export async function emitirCertificadoWebinar(
  webinarId: string,
  profileId: string,
): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.rpc('emitir_certificado_webinar', {
    p_webinar_id: webinarId,
    p_profile_id: profileId,
  });
  if (error) return fail('CERT_WEBINAR_EMITIR', error.message, error);
  return ok(data as string);
}

// DGG-29 · emite cert a todos los asistentes (con profile_id y asistio=true)
export async function emitirCertificadosWebinarLote(
  webinarId: string,
): Promise<ApiResponse<number>> {
  const { data, error } = await supabase.rpc('emitir_certificados_webinar_lote', {
    p_webinar_id: webinarId,
  });
  if (error) return fail('CERT_WEBINAR_LOTE', error.message, error);
  return ok((data as number) ?? 0);
}

export interface CrearReunionZoomInput {
  webinarId: string;
  hostEmail?: string;
  topic?: string;
}

export async function crearReunionZoom(
  input: CrearReunionZoomInput,
): Promise<ApiResponse<{
  meetingId: number;
  joinUrl: string;
  startUrl: string;
  password: string;
}>> {
  try {
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (!token) return fail('unauthenticated', 'Sesión expirada');
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zoom-webinar-create`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        webinar_id: input.webinarId,
        host_email: input.hostEmail ?? 'me',
        topic: input.topic,
      }),
    });
    const j = await res.json();
    if (!res.ok) return fail(j?.error ?? `http_${res.status}`, j?.detail ?? 'No pudimos crear la reunión Zoom');
    return ok({
      meetingId: Number(j.meeting_id),
      joinUrl: String(j.join_url),
      startUrl: String(j.start_url),
      password: String(j.password ?? ''),
    });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// Inscriptos

export interface InscriptoConCanal {
  id: string;
  webinar_id: string;
  email_snapshot: string;
  nombre_snapshot: string;
  telefono_snapshot: string | null;
  canal: 'zoom' | 'youtube';
  administracion_id: string | null;
  prospecto_id: string | null;
  asistio: boolean;
  tiempo_conectado_seg: number;
  inscripto_at: string;
  prospecto_nombre?: string | null;
  administracion_nombre?: string | null;
}

export async function listInscriptos(
  webinarId: string,
): Promise<ApiResponse<InscriptoConCanal[]>> {
  try {
    const { data, error } = await supabase
      .from('webinar_inscriptos')
      .select(`
        id, webinar_id, email_snapshot, nombre_snapshot, telefono_snapshot, canal,
        administracion_id, prospecto_id, asistio, tiempo_conectado_seg, inscripto_at,
        prospectos:prospecto_id(nombre),
        administraciones:administracion_id(razon_social)
      `)
      .eq('webinar_id', webinarId)
      .order('inscripto_at', { ascending: false });
    if (error) throw error;
    const out: InscriptoConCanal[] = (data ?? []).map((r) => {
      const row = r as unknown as Record<string, unknown>;
      const prospecto = row.prospectos as { nombre?: string | null } | null;
      const admin = row.administraciones as { razon_social?: string | null } | null;
      return {
        id: String(row.id),
        webinar_id: String(row.webinar_id),
        email_snapshot: String(row.email_snapshot),
        nombre_snapshot: String(row.nombre_snapshot),
        telefono_snapshot: (row.telefono_snapshot as string | null) ?? null,
        canal: row.canal as 'zoom' | 'youtube',
        administracion_id: (row.administracion_id as string | null) ?? null,
        prospecto_id: (row.prospecto_id as string | null) ?? null,
        asistio: !!row.asistio,
        tiempo_conectado_seg: Number(row.tiempo_conectado_seg ?? 0),
        inscripto_at: String(row.inscripto_at),
        prospecto_nombre: prospecto?.nombre ?? null,
        administracion_nombre: admin?.razon_social ?? null,
      };
    });
    return ok(out);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export interface InscriptoTokenRow {
  inscripto_id: string;
  token: string;
}

export async function listInscriptoTokens(
  webinarId: string,
): Promise<ApiResponse<InscriptoTokenRow[]>> {
  try {
    const { data, error } = await supabase
      .from('webinar_acceso_tokens')
      .select('token, webinar_inscripto_id, webinar_inscriptos!inner(webinar_id)')
      .eq('webinar_inscriptos.webinar_id', webinarId)
      .is('revocado_at', null);
    if (error) throw error;
    const out: InscriptoTokenRow[] = (data ?? []).map((r) => ({
      inscripto_id: String((r as Record<string, unknown>).webinar_inscripto_id),
      token: String((r as Record<string, unknown>).token),
    }));
    return ok(out);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// Prospectos

// E-GG-46 (2026-06-04 · auditoría E-GG-45): patrón estado-derivado-vs-propagado.
// Un prospecto convertido a cliente queda con `convertido_at` y
// `convertido_a_administracion_id`. Si después esa administración se da de
// baja (administraciones.activo=false / estado='baja') el prospecto sigue
// figurando como "Convertido ✓" en la grilla sin pista de que el cliente
// ya no está activo. Misma raíz que E-GG-45: la baja del cliente no propaga
// al prospecto (es por diseño — el prospecto es registro histórico de la
// captación). Para no engañar al gerente, devolvemos el estado del cliente
// vinculado y la UI muestra un badge "Cliente de baja" cuando corresponde.
export interface ProspectoListItem extends ProspectoRow {
  cliente_activo: boolean | null;
  cliente_estado: string | null;
}

export async function listProspectos(): Promise<ApiResponse<ProspectoListItem[]>> {
  try {
    const { data, error } = await supabase
      .from('prospectos')
      .select('*, administraciones:convertido_a_administracion_id(activo,estado)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    type Joined = ProspectoRow & {
      administraciones: { activo: boolean; estado: string } | null;
    };
    const rows: ProspectoListItem[] = ((data ?? []) as Joined[]).map((raw) => {
      const { administraciones, ...rest } = raw;
      return {
        ...(rest as ProspectoRow),
        cliente_activo: administraciones?.activo ?? null,
        cliente_estado: administraciones?.estado ?? null,
      };
    });
    return ok(rows);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function convertirProspecto(
  prospectoId: string,
  administracionId: string,
): Promise<ApiResponse<true>> {
  try {
    const { error } = await supabase.rpc('convertir_prospecto_a_cliente', {
      p_prospecto_id: prospectoId,
      p_administracion_id: administracionId,
    });
    if (error) throw error;
    return ok(true as const);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// DEEP-2 · Edición de prospectos (nombre/email/teléfono). Cierra GAP de
// captación: cuando un prospecto llega desde un formulario público con email
// mal escrito o nombre incompleto, la gerencia puede corregirlo sin tener
// que tocar la BD.
export interface ActualizarProspectoInput {
  nombre?: string;
  email?: string;
  telefono?: string | null;
}

export async function actualizarProspecto(
  id: string,
  input: ActualizarProspectoInput,
): Promise<ApiResponse<ProspectoRow>> {
  try {
    type ProspectoUpdate = Database['public']['Tables']['prospectos']['Update'];
    const patch: ProspectoUpdate = {};
    if (input.nombre !== undefined) patch.nombre = input.nombre;
    if (input.email !== undefined) patch.email = input.email;
    if (input.telefono !== undefined) patch.telefono = input.telefono;
    const { data, error } = await supabase
      .from('prospectos')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return ok(data);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// Inscripción manual (gerencia agrega un inscripto ad-hoc)
export interface InscribirManualInput {
  webinarId: string;
  email: string;
  nombre: string;
  telefono?: string | null;
}

export async function inscribirManual(
  input: InscribirManualInput,
): Promise<ApiResponse<{ token: string; canal: 'zoom' | 'youtube' }>> {
  try {
    const { data, error } = await supabase.rpc('inscribir_a_webinar', {
      p_webinar_id: input.webinarId,
      p_email: input.email.trim(),
      p_nombre: input.nombre.trim(),
      p_telefono: input.telefono ?? undefined,
      p_submission_id: undefined,
    });
    if (error) throw error;
    const result = data as { token: string; canal: 'zoom' | 'youtube' };
    return ok({ token: result.token, canal: result.canal });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// ============================================================================
// G1 · Histórico de webinars por administración (vw_administracion_webinars).
// Usado en la ficha del cliente (gerencia) y en el portal del cliente.
// ============================================================================
export interface AdminWebinarHistorial {
  inscripto_id: string;
  webinar_id: string;
  titulo: string;
  fecha_hora: string;
  duracion_min: number;
  webinar_status: string;
  grabacion_url: string | null;
  canal: string;
  asistio: boolean;
  tiempo_conectado_seg: number | null;
  inscripto_at: string;
}

export async function listAdministracionWebinars(
  administracionId: string,
): Promise<ApiResponse<AdminWebinarHistorial[]>> {
  const { data, error } = await supabase.rpc('administracion_webinars', {
    p_administracion_id: administracionId,
  });
  if (error) return fail('ADMIN_WEBINARS', error.message, error);
  return ok((data ?? []) as unknown as AdminWebinarHistorial[]);
}
