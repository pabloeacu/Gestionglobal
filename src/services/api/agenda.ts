// Servicio de Agenda (patrón MDC capitalizado, ver AGENDA_GERENCIAL_HANDOFF.md
// — secciones B3/B4 + lecciones E1..E14).
//
// Filosofía: la Agenda es el organizador ejecutivo personal de cada usuario
// staff (RLS por owner_id = auth.uid()). Recurrencia virtual: la fila madre
// guarda la regla, las ocurrencias se calculan en runtime; las excepciones
// viven en agenda_event_overrides.
//
// Regla 4 del proyecto: ningún componente debe llamar supabase.from() — todo
// pasa por estas funciones. Devuelven ApiResponse<T> (P-API-01).

import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

// --- Tipos del dominio ------------------------------------------------------

export type AgendaPrioridad = 'baja' | 'media' | 'alta';
export type AgendaRecurrencia = 'none' | 'daily' | 'weekly' | 'monthly';

export interface AgendaCategoria {
  id: string;
  ownerId: string;
  name: string;
  color: string;
  icon: string | null;
  isSystem: boolean;
  orden: number;
}

export interface AgendaEvento {
  id: string;
  ownerId: string;
  title: string;
  notes: string | null;
  categoryId: string | null;
  startAt: string | null; // ISO; null = sin fecha (bandeja)
  endAt: string | null;
  allDay: boolean;
  isDone: boolean;
  doneAt: string | null;
  priority: AgendaPrioridad;
  reminderOffsets: number[];
  recurrence: AgendaRecurrencia;
  recurrenceWeekdays: number[] | null;
  recurrenceMonthday: number | null;
  recurrenceUntil: string | null;
  colorOverride: string | null;
  linkedConsorcioIds: string[];
  linkedAdministracionId: string | null;
  linkedComprobanteId: string | null;
  linkedTramiteId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgendaOverride {
  id: string;
  parentId: string;
  originalDate: string; // YYYY-MM-DD
  status: 'moved' | 'skipped' | 'done';
  newStartAt: string | null;
  newEndAt: string | null;
  doneAt: string | null;
  createdAt: string;
}

export type VinculoTipo = 'administracion' | 'consorcio' | 'comprobante' | 'tramite';
export interface VinculoOpcion {
  tipo: VinculoTipo;
  id: string;
  label: string;
  hint: string | null;
}

// --- Mappers ---------------------------------------------------------------

type RowCat = Database['public']['Tables']['agenda_categories']['Row'];
type RowEv = Database['public']['Tables']['agenda_events']['Row'];
type RowOv = Database['public']['Tables']['agenda_event_overrides']['Row'];

function mapCat(r: RowCat): AgendaCategoria {
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    color: r.color,
    icon: r.icon,
    isSystem: r.is_system,
    orden: r.orden,
  };
}

function mapEv(r: RowEv): AgendaEvento {
  return {
    id: r.id,
    ownerId: r.owner_id,
    title: r.title,
    notes: r.notes,
    categoryId: r.category_id,
    startAt: r.start_at,
    endAt: r.end_at,
    allDay: r.all_day,
    isDone: r.is_done,
    doneAt: r.done_at,
    priority: r.priority as AgendaPrioridad,
    reminderOffsets: r.reminder_offsets ?? [],
    recurrence: r.recurrence as AgendaRecurrencia,
    recurrenceWeekdays: r.recurrence_weekdays,
    recurrenceMonthday: r.recurrence_monthday,
    recurrenceUntil: r.recurrence_until,
    colorOverride: r.color_override,
    linkedConsorcioIds: r.linked_consorcio_ids ?? [],
    linkedAdministracionId: r.linked_administracion_id,
    linkedComprobanteId: r.linked_comprobante_id,
    linkedTramiteId: r.linked_tramite_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapOv(r: RowOv): AgendaOverride {
  return {
    id: r.id,
    parentId: r.parent_id,
    originalDate: r.original_date,
    status: r.status as AgendaOverride['status'],
    newStartAt: r.new_start_at,
    newEndAt: r.new_end_at,
    doneAt: r.done_at,
    createdAt: r.created_at,
  };
}

// --- Categorías ------------------------------------------------------------

export async function ensureSeedCategorias(): Promise<ApiResponse<null>> {
  try {
    const u = (await supabase.auth.getUser()).data.user;
    if (!u) return fail('NO_AUTH', 'Sesión no encontrada.');
    const { error } = await supabase.rpc('gg_agenda_seed_default_categories', { p_owner: u.id });
    if (error) throw error;
    return ok(null);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function listCategorias(): Promise<ApiResponse<AgendaCategoria[]>> {
  try {
    const { data, error } = await supabase
      .from('agenda_categories')
      .select('*')
      .order('orden', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw error;
    return ok((data ?? []).map(mapCat));
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export interface CrearCategoriaInput {
  name: string;
  color: string;
  icon?: string | null;
  orden?: number;
}

export async function crearCategoria(input: CrearCategoriaInput): Promise<ApiResponse<AgendaCategoria>> {
  try {
    const u = (await supabase.auth.getUser()).data.user;
    if (!u) return fail('NO_AUTH', 'Sesión no encontrada.');
    const { data, error } = await supabase
      .from('agenda_categories')
      .insert({
        owner_id: u.id,
        name: input.name.trim(),
        color: input.color,
        icon: input.icon ?? null,
        orden: input.orden ?? 99,
        is_system: false,
      })
      .select('*')
      .single();
    if (error) throw error;
    return ok(mapCat(data));
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function actualizarCategoria(
  id: string,
  patch: Partial<CrearCategoriaInput>,
): Promise<ApiResponse<AgendaCategoria>> {
  try {
    const update: Database['public']['Tables']['agenda_categories']['Update'] = {};
    if (patch.name !== undefined) update.name = patch.name.trim();
    if (patch.color !== undefined) update.color = patch.color;
    if (patch.icon !== undefined) update.icon = patch.icon;
    if (patch.orden !== undefined) update.orden = patch.orden;
    const { data, error } = await supabase
      .from('agenda_categories')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return ok(mapCat(data));
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function eliminarCategoria(id: string): Promise<ApiResponse<null>> {
  try {
    // No se puede eliminar una de sistema (chequeo cliente; RLS no lo bloquea).
    const { data: cat, error: e0 } = await supabase
      .from('agenda_categories')
      .select('is_system')
      .eq('id', id)
      .single();
    if (e0) throw e0;
    if (cat?.is_system) return fail('SYSTEM_CATEGORY', 'Las categorías de sistema no se pueden eliminar.');
    const { error } = await supabase.from('agenda_categories').delete().eq('id', id);
    if (error) throw error;
    return ok(null);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// --- Eventos ---------------------------------------------------------------

export interface ListarEventosFilters {
  from?: Date | null;
  to?: Date | null;
  includeDone?: boolean;
}

export interface ListarEventosResult {
  eventos: AgendaEvento[];
  overrides: AgendaOverride[];
}

export async function listEventos(
  filters: ListarEventosFilters = {},
): Promise<ApiResponse<ListarEventosResult>> {
  try {
    let q = supabase.from('agenda_events').select('*');
    // Para soportar bandeja (start_at NULL) + rango, filtramos cliente-side
    // contra el rango y dejamos pasar los NULL.
    if (filters.includeDone === false) q = q.eq('is_done', false);
    const { data: evs, error: e1 } = await q.order('start_at', { ascending: true, nullsFirst: true });
    if (e1) throw e1;
    const eventos = (evs ?? []).map(mapEv);
    const parentIds = eventos.filter((e) => e.recurrence !== 'none').map((e) => e.id);
    let overrides: AgendaOverride[] = [];
    if (parentIds.length > 0) {
      const { data: ovs, error: e2 } = await supabase
        .from('agenda_event_overrides')
        .select('*')
        .in('parent_id', parentIds);
      if (e2) throw e2;
      overrides = (ovs ?? []).map(mapOv);
    }
    return ok({ eventos, overrides });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export interface CrearEventoInput {
  title: string;
  notes?: string | null;
  categoryId?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  allDay?: boolean;
  priority?: AgendaPrioridad;
  recurrence?: AgendaRecurrencia;
  recurrenceWeekdays?: number[] | null;
  recurrenceMonthday?: number | null;
  recurrenceUntil?: string | null;
  colorOverride?: string | null;
  linkedConsorcioIds?: string[];
  linkedAdministracionId?: string | null;
  linkedComprobanteId?: string | null;
  linkedTramiteId?: string | null;
}

export async function crearEvento(input: CrearEventoInput): Promise<ApiResponse<AgendaEvento>> {
  try {
    const u = (await supabase.auth.getUser()).data.user;
    if (!u) return fail('NO_AUTH', 'Sesión no encontrada.');
    const { data, error } = await supabase
      .from('agenda_events')
      .insert({
        owner_id: u.id,
        title: input.title.trim(),
        notes: input.notes ?? null,
        category_id: input.categoryId ?? null,
        start_at: input.startAt ?? null,
        end_at: input.endAt ?? null,
        all_day: input.allDay ?? false,
        priority: input.priority ?? 'media',
        recurrence: input.recurrence ?? 'none',
        recurrence_weekdays: input.recurrenceWeekdays ?? null,
        recurrence_monthday: input.recurrenceMonthday ?? null,
        recurrence_until: input.recurrenceUntil ?? null,
        color_override: input.colorOverride ?? null,
        linked_consorcio_ids: input.linkedConsorcioIds ?? [],
        linked_administracion_id: input.linkedAdministracionId ?? null,
        linked_comprobante_id: input.linkedComprobanteId ?? null,
        linked_tramite_id: input.linkedTramiteId ?? null,
      })
      .select('*')
      .single();
    if (error) throw error;
    return ok(mapEv(data));
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export type ActualizarEventoInput = Partial<CrearEventoInput> & {
  isDone?: boolean;
};

export async function actualizarEvento(
  id: string,
  patch: ActualizarEventoInput,
): Promise<ApiResponse<AgendaEvento>> {
  try {
    const update: Database['public']['Tables']['agenda_events']['Update'] = {};
    if (patch.title !== undefined) update.title = patch.title.trim();
    if (patch.notes !== undefined) update.notes = patch.notes;
    if (patch.categoryId !== undefined) update.category_id = patch.categoryId;
    if (patch.startAt !== undefined) update.start_at = patch.startAt;
    if (patch.endAt !== undefined) update.end_at = patch.endAt;
    if (patch.allDay !== undefined) update.all_day = patch.allDay;
    if (patch.priority !== undefined) update.priority = patch.priority;
    if (patch.recurrence !== undefined) update.recurrence = patch.recurrence;
    if (patch.recurrenceWeekdays !== undefined) update.recurrence_weekdays = patch.recurrenceWeekdays;
    if (patch.recurrenceMonthday !== undefined) update.recurrence_monthday = patch.recurrenceMonthday;
    if (patch.recurrenceUntil !== undefined) update.recurrence_until = patch.recurrenceUntil;
    if (patch.colorOverride !== undefined) update.color_override = patch.colorOverride;
    if (patch.linkedConsorcioIds !== undefined) update.linked_consorcio_ids = patch.linkedConsorcioIds;
    if (patch.linkedAdministracionId !== undefined) update.linked_administracion_id = patch.linkedAdministracionId;
    if (patch.linkedComprobanteId !== undefined) update.linked_comprobante_id = patch.linkedComprobanteId;
    if (patch.linkedTramiteId !== undefined) update.linked_tramite_id = patch.linkedTramiteId;
    if (patch.isDone !== undefined) {
      update.is_done = patch.isDone;
      update.done_at = patch.isDone ? new Date().toISOString() : null;
    }
    const { data, error } = await supabase
      .from('agenda_events')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return ok(mapEv(data));
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function eliminarEvento(id: string): Promise<ApiResponse<null>> {
  try {
    const { error } = await supabase.from('agenda_events').delete().eq('id', id);
    if (error) throw error;
    return ok(null);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// --- Marcar como hecha ----------------------------------------------------
// Si la ocurrencia es recurrente, creamos un override 'done'; si no, set
// is_done=true en el evento madre.

export async function marcarHecha(
  eventId: string,
  isDone: boolean,
  options: { recurrente?: boolean; occurrenceDate?: string } = {},
): Promise<ApiResponse<null>> {
  try {
    if (options.recurrente && options.occurrenceDate) {
      if (isDone) {
        const { error } = await supabase
          .from('agenda_event_overrides')
          .upsert(
            {
              parent_id: eventId,
              original_date: options.occurrenceDate,
              status: 'done',
              done_at: new Date().toISOString(),
            },
            { onConflict: 'parent_id,original_date' },
          );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('agenda_event_overrides')
          .delete()
          .eq('parent_id', eventId)
          .eq('original_date', options.occurrenceDate)
          .eq('status', 'done');
        if (error) throw error;
      }
    } else {
      const { error } = await supabase
        .from('agenda_events')
        .update({ is_done: isDone, done_at: isDone ? new Date().toISOString() : null })
        .eq('id', eventId);
      if (error) throw error;
    }
    return ok(null);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// Override: mover una ocurrencia recurrente
export async function moverOcurrencia(
  parentId: string,
  originalDate: string,
  newStartAt: string,
  newEndAt: string | null,
): Promise<ApiResponse<AgendaOverride>> {
  try {
    const { data, error } = await supabase
      .from('agenda_event_overrides')
      .upsert(
        {
          parent_id: parentId,
          original_date: originalDate,
          status: 'moved',
          new_start_at: newStartAt,
          new_end_at: newEndAt,
        },
        { onConflict: 'parent_id,original_date' },
      )
      .select('*')
      .single();
    if (error) throw error;
    return ok(mapOv(data));
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// Override: saltear una ocurrencia recurrente
export async function saltearOcurrencia(
  parentId: string,
  originalDate: string,
): Promise<ApiResponse<null>> {
  try {
    const { error } = await supabase
      .from('agenda_event_overrides')
      .upsert(
        { parent_id: parentId, original_date: originalDate, status: 'skipped' },
        { onConflict: 'parent_id,original_date' },
      );
    if (error) throw error;
    return ok(null);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// --- Posponer (E11): delta relativo a la fecha del evento, NO a hoy -------

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Ancla = nunca antes de hoy; si el evento ya está en el futuro, su día.
 *  (Capitalización de E11 del handoff.) */
export function anclaPostergar(startAtISO: string | null | undefined): Date {
  const hoy = startOfToday();
  if (!startAtISO) return hoy;
  const d = new Date(startAtISO);
  d.setHours(0, 0, 0, 0);
  return d > hoy ? d : hoy;
}

/** Devuelve el ISO con la fecha pospuesta `deltaDays` desde la fecha del
 *  evento (E11). Si el evento tiene endAt, lo preserva como duración relativa. */
export function calcularPosponer(
  startAtISO: string,
  endAtISO: string | null,
  deltaDays: number,
): { startAt: string; endAt: string | null } {
  const anchor = anclaPostergar(startAtISO);
  const start = new Date(anchor);
  const hh = new Date(startAtISO).getHours();
  const mm = new Date(startAtISO).getMinutes();
  start.setDate(start.getDate() + deltaDays);
  start.setHours(hh, mm, 0, 0);
  let end: Date | null = null;
  if (endAtISO) {
    const durMs = new Date(endAtISO).getTime() - new Date(startAtISO).getTime();
    end = new Date(start.getTime() + durMs);
  }
  return { startAt: start.toISOString(), endAt: end ? end.toISOString() : null };
}

export async function posponerEvento(
  eventId: string,
  deltaDays: number,
): Promise<ApiResponse<AgendaEvento>> {
  try {
    const { data: ev, error: e0 } = await supabase
      .from('agenda_events')
      .select('id, start_at, end_at, recurrence')
      .eq('id', eventId)
      .single();
    if (e0) throw e0;
    if (!ev?.start_at) {
      return fail('SIN_FECHA', 'No se puede posponer un evento sin fecha.');
    }
    if (ev.recurrence !== 'none') {
      return fail('RECURRENTE', 'Para posponer una ocurrencia recurrente, usá moverOcurrencia.');
    }
    const { startAt, endAt } = calcularPosponer(ev.start_at, ev.end_at ?? null, deltaDays);
    return actualizarEvento(eventId, { startAt, endAt });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// --- Agenda unificada (hub temporal · mig 0040) ---------------------------

export type AgendaFuente = 'personal' | 'vencimiento' | 'tramite' | 'comprobante' | 'solicitud';

export interface OcurrenciaUnificada {
  fuente: AgendaFuente;
  origenId: string;
  ownerId: string | null;
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  categoryHint: string;
  color: string;
  estado: string;
  editable: boolean;
  linkedAdminId: string | null;
  linkedConsorcioId: string | null;
}

export interface ListarUnificadasInput {
  from: Date;
  to: Date;
  fuentes?: AgendaFuente[] | null;
}

export async function listEventosUnificados(
  input: ListarUnificadasInput,
): Promise<ApiResponse<OcurrenciaUnificada[]>> {
  try {
    const { data, error } = await supabase.rpc('gg_agenda_listar_unificada', {
      p_from: input.from.toISOString(),
      p_to: input.to.toISOString(),
      p_fuentes: input.fuentes ?? undefined,
    });
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      fuente: string;
      origen_id: string;
      owner_id: string | null;
      title: string;
      start_at: string;
      end_at: string | null;
      all_day: boolean;
      category_hint: string;
      color: string;
      estado: string;
      editable: boolean;
      linked_admin_id: string | null;
      linked_consorcio_id: string | null;
    }>;
    return ok(
      rows.map((r) => ({
        fuente: r.fuente as AgendaFuente,
        origenId: r.origen_id,
        ownerId: r.owner_id,
        title: r.title,
        startAt: r.start_at,
        endAt: r.end_at,
        allDay: r.all_day,
        categoryHint: r.category_hint,
        color: r.color,
        estado: r.estado,
        editable: r.editable,
        linkedAdminId: r.linked_admin_id,
        linkedConsorcioId: r.linked_consorcio_id,
      })),
    );
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// --- Catálogo de vínculos -------------------------------------------------

export async function listVinculosCatalogo(): Promise<ApiResponse<VinculoOpcion[]>> {
  try {
    const { data, error } = await supabase.rpc('gg_agenda_listar_vinculos');
    if (error) throw error;
    const rows = (data ?? []) as Array<{ tipo: string; id: string; label: string; hint: string | null }>;
    return ok(
      rows.map((r) => ({
        tipo: r.tipo as VinculoTipo,
        id: r.id,
        label: r.label,
        hint: r.hint,
      })),
    );
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}
