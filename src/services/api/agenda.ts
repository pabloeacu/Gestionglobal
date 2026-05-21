import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

// Subsistema agenda operativa (Documento Maestro punto 23–25). Tabla:
// agenda_eventos (migración 0037). RLS: staff full; admin solo SELECT por
// cliente_id propio.

export type AgendaCategoria =
  | 'general'
  | 'seguimiento'
  | 'vencimiento'
  | 'recordatorio'
  | 'reunion'
  | 'tarea';
export const AGENDA_CATEGORIAS: AgendaCategoria[] = [
  'general',
  'seguimiento',
  'vencimiento',
  'recordatorio',
  'reunion',
  'tarea',
];
export const AGENDA_CATEGORIA_LABEL: Record<AgendaCategoria, string> = {
  general: 'General',
  seguimiento: 'Seguimiento',
  vencimiento: 'Vencimiento',
  recordatorio: 'Recordatorio',
  reunion: 'Reunión',
  tarea: 'Tarea',
};

export type AgendaPrioridad = 'baja' | 'normal' | 'alta' | 'urgente';
export const AGENDA_PRIORIDADES: AgendaPrioridad[] = ['baja', 'normal', 'alta', 'urgente'];
export const AGENDA_PRIORIDAD_LABEL: Record<AgendaPrioridad, string> = {
  baja: 'Baja',
  normal: 'Normal',
  alta: 'Alta',
  urgente: 'Urgente',
};

export type AgendaEventoRow = Database['public']['Tables']['agenda_eventos']['Row'];
export type AgendaEventoInsert = Database['public']['Tables']['agenda_eventos']['Insert'];
export type AgendaEventoUpdate = Database['public']['Tables']['agenda_eventos']['Update'];

export interface EventoAgenda {
  id: string;
  titulo: string;
  descripcion: string | null;
  fechaInicio: string;
  fechaFin: string | null;
  todoElDia: boolean;
  categoria: AgendaCategoria;
  prioridad: AgendaPrioridad;
  responsableId: string | null;
  responsableNombre: string | null;
  clienteId: string | null;
  clienteNombre: string | null;
  servicioId: string | null;
  servicioNombre: string | null;
  tramiteId: string | null;
  vencimientoId: string | null;
  recordatorioMinutosAntes: number;
  completadoAt: string | null;
  canceladoAt: string | null;
  origen: string;
}

export interface ListarEventosFilters {
  desde: Date;
  hasta: Date;
  responsable?: string | null;
  cliente?: string | null;
  servicio?: string | null;
  categoria?: AgendaCategoria | null;
  prioridad?: AgendaPrioridad | null;
  incluirCompletados?: boolean;
}

export async function listarEventos(
  filters: ListarEventosFilters,
): Promise<ApiResponse<EventoAgenda[]>> {
  try {
    const args = {
      p_desde: filters.desde.toISOString(),
      p_hasta: filters.hasta.toISOString(),
      p_responsable: filters.responsable ?? null,
      p_cliente: filters.cliente ?? null,
      p_servicio: filters.servicio ?? null,
      p_categoria: filters.categoria ?? null,
      p_prioridad: filters.prioridad ?? null,
      p_incluir_completados: !!filters.incluirCompletados,
    } as unknown as {
      p_desde: string;
      p_hasta: string;
      p_responsable: string;
      p_cliente: string;
      p_servicio: string;
      p_categoria: string;
      p_prioridad: string;
      p_incluir_completados: boolean;
    };
    const { data, error } = await supabase.rpc('listar_eventos_agenda', args);
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      id: string;
      titulo: string;
      descripcion: string | null;
      fecha_inicio: string;
      fecha_fin: string | null;
      todo_el_dia: boolean;
      categoria: AgendaCategoria;
      prioridad: AgendaPrioridad;
      responsable_id: string | null;
      responsable_nombre: string | null;
      cliente_id: string | null;
      cliente_nombre: string | null;
      servicio_id: string | null;
      servicio_nombre: string | null;
      tramite_id: string | null;
      vencimiento_id: string | null;
      recordatorio_minutos_antes: number;
      completado_at: string | null;
      cancelado_at: string | null;
      origen: string;
    }>;
    return ok(
      rows.map((r) => ({
        id: r.id,
        titulo: r.titulo,
        descripcion: r.descripcion,
        fechaInicio: r.fecha_inicio,
        fechaFin: r.fecha_fin,
        todoElDia: r.todo_el_dia,
        categoria: r.categoria,
        prioridad: r.prioridad,
        responsableId: r.responsable_id,
        responsableNombre: r.responsable_nombre,
        clienteId: r.cliente_id,
        clienteNombre: r.cliente_nombre,
        servicioId: r.servicio_id,
        servicioNombre: r.servicio_nombre,
        tramiteId: r.tramite_id,
        vencimientoId: r.vencimiento_id,
        recordatorioMinutosAntes: r.recordatorio_minutos_antes,
        completadoAt: r.completado_at,
        canceladoAt: r.cancelado_at,
        origen: r.origen,
      })),
    );
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export interface CrearEventoInput {
  titulo: string;
  descripcion?: string | null;
  fechaInicio: Date;
  fechaFin?: Date | null;
  todoElDia?: boolean;
  categoria?: AgendaCategoria;
  prioridad?: AgendaPrioridad;
  responsableId?: string | null;
  clienteId?: string | null;
  servicioId?: string | null;
  tramiteId?: string | null;
  vencimientoId?: string | null;
  recordatorioMinutosAntes?: number;
}

export async function crearEvento(
  input: CrearEventoInput,
): Promise<ApiResponse<AgendaEventoRow>> {
  try {
    const insert: AgendaEventoInsert = {
      titulo: input.titulo,
      descripcion: input.descripcion ?? null,
      fecha_inicio: input.fechaInicio.toISOString(),
      fecha_fin: input.fechaFin?.toISOString() ?? null,
      todo_el_dia: input.todoElDia ?? false,
      categoria: input.categoria ?? 'general',
      prioridad: input.prioridad ?? 'normal',
      responsable_id: input.responsableId ?? null,
      cliente_id: input.clienteId ?? null,
      servicio_id: input.servicioId ?? null,
      tramite_id: input.tramiteId ?? null,
      vencimiento_id: input.vencimientoId ?? null,
      recordatorio_minutos_antes: input.recordatorioMinutosAntes ?? 0,
    };
    const { data, error } = await supabase
      .from('agenda_eventos')
      .insert(insert)
      .select()
      .single();
    if (error) throw error;
    return ok(data);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function actualizarEvento(
  id: string,
  patch: AgendaEventoUpdate,
): Promise<ApiResponse<AgendaEventoRow>> {
  try {
    const { data, error } = await supabase
      .from('agenda_eventos')
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

export async function completarEvento(id: string): Promise<ApiResponse<null>> {
  try {
    const { error } = await supabase
      .from('agenda_eventos')
      .update({ completado_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    return ok(null);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function cancelarEvento(id: string): Promise<ApiResponse<null>> {
  try {
    const { error } = await supabase
      .from('agenda_eventos')
      .update({ cancelado_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    return ok(null);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// Helpers de rango día/semana/mes
export function eventosDelDia(date: Date): { desde: Date; hasta: Date } {
  const d0 = new Date(date);
  d0.setHours(0, 0, 0, 0);
  const d1 = new Date(d0);
  d1.setDate(d1.getDate() + 1);
  return { desde: d0, hasta: d1 };
}

export function eventosDeLaSemana(anchor: Date): { desde: Date; hasta: Date } {
  const d0 = new Date(anchor);
  d0.setHours(0, 0, 0, 0);
  // lunes como inicio (ISO: 1)
  const dow = (d0.getDay() + 6) % 7;
  d0.setDate(d0.getDate() - dow);
  const d1 = new Date(d0);
  d1.setDate(d1.getDate() + 7);
  return { desde: d0, hasta: d1 };
}

export function eventosDelMes(year: number, month: number): { desde: Date; hasta: Date } {
  const desde = new Date(year, month, 1, 0, 0, 0, 0);
  const hasta = new Date(year, month + 1, 1, 0, 0, 0, 0);
  // Para mostrar mes completo incluyendo dias del mes anterior/siguiente
  // visibles en cuadrícula, ampliamos a la semana ISO.
  const desdeSemana = eventosDeLaSemana(desde).desde;
  const hastaSemana = eventosDeLaSemana(new Date(hasta.getTime() - 1)).hasta;
  return { desde: desdeSemana, hasta: hastaSemana };
}
