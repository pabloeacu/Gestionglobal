// solicitudes · service API para el Centro de Solicitudes + Wizard de
// Activación. Cita: regla 4 (todo supabase.from() vive acá), regla 5
// (lógica multi-tabla en RPCs SD), Documento "Flujo Maestro" §1-8.

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database, Json } from '@/types/database';

export type SolicitudRow = Database['public']['Tables']['solicitudes']['Row'];
export type SolicitudDerivacionRow =
  Database['public']['Tables']['solicitud_derivaciones']['Row'];
export type SolicitudEstado =
  | 'recibida'
  | 'en_revision'
  | 'derivada'
  | 'activada'
  | 'descartada';

export interface SolicitudListItem extends SolicitudRow {
  formulario_titulo: string | null;
  formulario_categoria: string | null;
  cliente_nombre: string | null;
  servicio_nombre: string | null;
  // #161/obs 2: precio del servicio para pre-fill comprobante desde solicitud
  servicio_precio_base?: number | null;
  servicio_precio_modo?: string | null;
}

export interface ListSolicitudesFilters {
  estado?: SolicitudEstado | 'todos' | 'activas';
  servicio_id?: string | null;
  search?: string;
  desde?: string;
  hasta?: string;
  limit?: number;
  offset?: number;
}

// Wrapper RPC que preserva el `this` binding (sino: TypeError 'rest').
type RawRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc: RawRpc = (name, args) =>
  (supabase.rpc as unknown as RawRpc).call(supabase, name, args);

// ----------------------------------------------------------------------------
// Listado
// ----------------------------------------------------------------------------

export async function listSolicitudes(
  filters: ListSolicitudesFilters = {},
): Promise<ApiResponse<{ rows: SolicitudListItem[]; total: number }>> {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  let q = supabase
    .from('solicitudes')
    .select(
      `*,
       formulario_submissions:formulario_submission_id(
         formularios:formulario_id(titulo,categoria)
       ),
       administraciones:cliente_id(nombre),
       servicios:servicio_solicitado_id(nombre)`,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.estado && filters.estado !== 'todos') {
    if (filters.estado === 'activas') {
      q = q.in('estado', ['recibida', 'en_revision', 'derivada']);
    } else {
      q = q.eq('estado', filters.estado);
    }
  }
  if (filters.servicio_id) {
    q = q.eq('servicio_solicitado_id', filters.servicio_id);
  }
  if (filters.desde) q = q.gte('created_at', filters.desde);
  if (filters.hasta) q = q.lte('created_at', filters.hasta);
  if (filters.search?.trim()) {
    const s = filters.search.trim();
    q = q.or(
      `solicitante_nombre.ilike.%${s}%,solicitante_email.ilike.%${s}%,solicitante_telefono.ilike.%${s}%`,
    );
  }

  const { data, error, count } = await q;
  if (error) return fail('SOL_LIST', error.message, error);

  type Joined = SolicitudRow & {
    formulario_submissions: {
      formularios: { titulo: string; categoria: string } | null;
    } | null;
    administraciones: { nombre: string } | null;
    servicios: { nombre: string } | null;
  };

  const rows: SolicitudListItem[] = (data ?? []).map((raw) => {
    const r = raw as Joined;
    const {
      formulario_submissions,
      administraciones,
      servicios,
      ...rest
    } = r;
    return {
      ...(rest as SolicitudRow),
      formulario_titulo:
        formulario_submissions?.formularios?.titulo ?? null,
      formulario_categoria:
        formulario_submissions?.formularios?.categoria ?? null,
      cliente_nombre: administraciones?.nombre ?? null,
      servicio_nombre: servicios?.nombre ?? null,
    };
  });

  const safeTotal = count && count > 0 ? count : rows.length;
  return ok({ rows, total: safeTotal });
}

// ----------------------------------------------------------------------------
// Detalle
// ----------------------------------------------------------------------------

export interface SolicitudDetalle extends SolicitudListItem {
  submission_payload: Record<string, unknown> | null;
  submission_adjuntos: Array<{ campo: string; nombre: string; url: string }>;
  derivaciones: SolicitudDerivacionRow[];
  /**
   * 1.C · schema del formulario al que pertenece este submission. Sirve
   * para resolver `field.name → field.label` y renderizar el payload con
   * etiquetas legibles en lugar de keys crudas.
   */
  formulario_schema: Json | null;
}

export async function getSolicitud(
  id: string,
): Promise<ApiResponse<SolicitudDetalle>> {
  const [{ data: solRaw, error: e1 }, { data: derivs, error: e2 }] =
    await Promise.all([
      supabase
        .from('solicitudes')
        .select(
          `*,
           formulario_submissions:formulario_submission_id(
             id,
             datos,
             formularios:formulario_id(titulo,categoria,schema)
           ),
           administraciones:cliente_id(nombre),
           servicios:servicio_solicitado_id(nombre, precio_base, precio_modo)`,
        )
        .eq('id', id)
        .single(),
      supabase
        .from('solicitud_derivaciones')
        .select('*')
        .eq('solicitud_id', id)
        .order('enviada_at', { ascending: false }),
    ]);

  if (e1) return fail('SOL_GET', e1.message, e1);
  if (e2) return fail('SOL_GET_DERIVS', e2.message, e2);

  type Joined = SolicitudRow & {
    formulario_submissions: {
      id: string;
      datos: Json | null;
      formularios: {
        titulo: string;
        categoria: string;
        schema: Json | null;
      } | null;
    } | null;
    administraciones: { nombre: string } | null;
    servicios: {
      nombre: string;
      precio_base: number | null;
      precio_modo: string | null;
    } | null;
  };
  const s = solRaw as Joined;
  const {
    formulario_submissions,
    administraciones,
    servicios,
    ...rest
  } = s;

  // Adjuntos del submission (de la tabla formulario_adjuntos)
  let adjuntos: Array<{ campo: string; nombre: string; url: string }> = [];
  if (formulario_submissions?.id) {
    const { data: adjs } = await supabase
      .from('formulario_adjuntos')
      .select('field_name, filename_original, storage_path')
      .eq('submission_id', formulario_submissions.id);
    // El bucket form-adjuntos es privado → URL firmada (getPublicUrl daría 403).
    adjuntos = await Promise.all(
      ((adjs as Array<{
        field_name: string;
        filename_original: string;
        storage_path: string;
      }> | null) ?? []).map(async (a) => {
        const { data: signed } = await supabase.storage
          .from('form-adjuntos')
          .createSignedUrl(a.storage_path, 60 * 60);
        return {
          campo: a.field_name,
          nombre: a.filename_original,
          url: signed?.signedUrl ?? '',
        };
      }),
    );
  }

  return ok({
    ...(rest as SolicitudRow),
    formulario_titulo: formulario_submissions?.formularios?.titulo ?? null,
    formulario_categoria:
      formulario_submissions?.formularios?.categoria ?? null,
    cliente_nombre: administraciones?.nombre ?? null,
    servicio_nombre: servicios?.nombre ?? null,
    // #161/obs 2: precio_base del servicio para pre-fill el comprobante
    servicio_precio_base: servicios?.precio_base ?? null,
    servicio_precio_modo: servicios?.precio_modo ?? null,
    submission_payload:
      (formulario_submissions?.datos as Record<string, unknown>) ?? null,
    submission_adjuntos: adjuntos,
    derivaciones: (derivs ?? []) as SolicitudDerivacionRow[],
    formulario_schema: formulario_submissions?.formularios?.schema ?? null,
  });
}

// ----------------------------------------------------------------------------
// Acciones (RPCs)
// ----------------------------------------------------------------------------

export async function marcarEnRevision(
  id: string,
  observaciones?: string,
): Promise<ApiResponse<true>> {
  const { error } = await rpc('solicitud_marcar_en_revision', {
    p_solicitud_id: id,
    p_observaciones: observaciones ?? null,
  });
  if (error) return fail('SOL_REVISION', error.message, error);
  return ok(true);
}

export interface DerivarInput {
  destinatario_email: string;
  destinatario_nombre?: string;
  plantilla_slug?: string;
  observaciones?: string;
  // Bloque K (obs nueva): TTL del enlace seguro del gestor.
  // Default 14 días. Rango 1..365. Configurable por caso desde el wizard.
  dias_validez?: number;
}

export async function derivar(
  id: string,
  input: DerivarInput,
): Promise<ApiResponse<{ derivacionId: string }>> {
  const { data, error } = await rpc('solicitud_derivar', {
    p_solicitud_id: id,
    p_destinatario_email: input.destinatario_email,
    p_destinatario_nombre: input.destinatario_nombre ?? null,
    p_plantilla_slug: input.plantilla_slug ?? 'solicitud-derivada-gestoria',
    p_observaciones: input.observaciones ?? null,
    p_dias_validez: input.dias_validez ?? 14,
  } as unknown as Parameters<typeof rpc>[1]);
  if (error) return fail('SOL_DERIVAR', error.message, error);
  return ok({ derivacionId: data as string });
}

export interface CrearClienteInput {
  nombre: string;
  cuit?: string | null;
  email?: string | null;
  telefono?: string | null;
  responsable_nombre?: string | null;
  responsable_apellido?: string | null;
  domicilio_fiscal?: string | null;
  condicion_iva?: string | null;
  codigo?: string | null;
}

export interface ActivarInput {
  /** Si se conoce, vincular al cliente existente. */
  cliente_id?: string | null;
  /** Si es cliente nuevo, datos para crear la administración. */
  crear_cliente?: CrearClienteInput | null;
  /** Periodo del tracking — ej. "2025" o "2025-12". */
  periodo: string;
  /** Fecha de inicio del tracking (YYYY-MM-DD). */
  fecha_inicio: string;
}

export async function activar(
  id: string,
  input: ActivarInput,
): Promise<ApiResponse<{ trackingId: string }>> {
  const args = {
    p_solicitud_id: id,
    p_cliente_id: input.cliente_id ?? null,
    p_crear_cliente_input: (input.crear_cliente ?? null) as Json | null,
    p_periodo: input.periodo,
    p_fecha_inicio: input.fecha_inicio,
  };
  const { data, error } = await rpc('solicitud_activar', args);
  if (error) return fail('SOL_ACTIVAR', error.message, error);
  return ok({ trackingId: data as string });
}

export async function descartar(
  id: string,
  motivo: string,
): Promise<ApiResponse<true>> {
  const { error } = await rpc('solicitud_descartar', {
    p_solicitud_id: id,
    p_motivo: motivo,
  });
  if (error) return fail('SOL_DESCARTAR', error.message, error);
  return ok(true);
}

// 1.F · restaura una solicitud descartada (revierte estado + limpia
// motivo_descarte). Devuelve el nuevo estado al que se restauró. Usado por el
// toast "Deshacer" tras descartar.
export async function restaurarSolicitud(
  id: string,
): Promise<ApiResponse<{ estado: SolicitudEstado }>> {
  const { data, error } = await rpc('restaurar_solicitud', {
    p_solicitud_id: id,
  });
  if (error) return fail('SOL_RESTAURAR', error.message, error);
  return ok({ estado: data as SolicitudEstado });
}

// 1.H · responde una solicitud desde la plataforma (motor de email Workspace).
// Persiste en sent_emails ligado a la solicitud. `fromCasilla` elige el alias
// REAL del dominio (post EGG-QA-06): cursos/webinar/juridico/general.
// dispatch-emails.ts::aliasFor() mapea el valor a la dirección de correo real.
export type RespuestaCasilla =
  | 'cursos'
  | 'webinar'
  | 'juridico'
  | 'general';

export async function responderSolicitud(
  id: string,
  input: { asunto: string; cuerpo: string; fromCasilla?: RespuestaCasilla },
): Promise<ApiResponse<{ sentEmailId: string }>> {
  const { data, error } = await rpc('solicitud_responder', {
    p_solicitud_id: id,
    p_asunto: input.asunto,
    p_cuerpo: input.cuerpo,
    p_from_casilla: input.fromCasilla ?? 'general',
  });
  if (error) return fail('SOL_RESPONDER', error.message, error);
  return ok({ sentEmailId: data as string });
}

// ----------------------------------------------------------------------------
// KPIs
// ----------------------------------------------------------------------------

export interface SolicitudesKpis {
  recibidas: number;
  en_revision: number;
  derivadas: number;
  activadas_hoy: number;
}

export async function getKpis(): Promise<ApiResponse<SolicitudesKpis>> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [r, er, der, act] = await Promise.all([
    supabase
      .from('solicitudes')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'recibida'),
    supabase
      .from('solicitudes')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'en_revision'),
    supabase
      .from('solicitudes')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'derivada'),
    supabase
      .from('solicitudes')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'activada')
      .gte('activada_at', `${todayIso}T00:00:00`),
  ]);

  return ok({
    recibidas: r.count ?? 0,
    en_revision: er.count ?? 0,
    derivadas: der.count ?? 0,
    activadas_hoy: act.count ?? 0,
  });
}

// #148 · Vincular comprobante emitido a la solicitud (después de generarlo
// via emitir_comprobante_manual desde el panel de Facturación).
export async function setSolicitudComprobante(
  solicitudId: string,
  comprobanteId: string,
): Promise<ApiResponse<true>> {
  // Cast: la columna se agregó en mig 0100 pero los types regenerados pueden
  // no haberse subido aún al repo. Inserción type-safe sin romper build.
  const upd = supabase.from('solicitudes') as unknown as {
    update(values: Record<string, unknown>): {
      eq(col: string, val: string): Promise<{ error: { message: string } | null }>;
    };
  };
  const { error } = await upd
    .update({ comprobante_id: comprobanteId })
    .eq('id', solicitudId);
  if (error) return fail('SOL_SET_COMPROBANTE', error.message, error);
  return ok(true);
}
