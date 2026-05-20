import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

export type ConsorcioRow = Database['public']['Tables']['consorcios']['Row'];
export type ConsorcioInsert = Database['public']['Tables']['consorcios']['Insert'];
export type ConsorcioUpdate = Database['public']['Tables']['consorcios']['Update'];

export async function listConsorciosByAdministracion(
  administracionId: string,
  includeInactive = false,
): Promise<ApiResponse<ConsorcioRow[]>> {
  let q = supabase
    .from('consorcios')
    .select('*')
    .eq('administracion_id', administracionId)
    .order('nombre', { ascending: true });
  if (!includeInactive) q = q.eq('activo', true);
  const { data, error } = await q;
  if (error) return fail('CONSORCIO_LIST', error.message, error);
  return ok(data);
}

export async function getConsorcio(id: string): Promise<ApiResponse<ConsorcioRow>> {
  const { data, error } = await supabase
    .from('consorcios')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return fail('CONSORCIO_GET', error.message, error);
  return ok(data);
}

// Si el caller no provee tipo_documento/numero_documento, el trigger
// asignar_dni_ficticio consume el contador de config_global y lo completa
// (D07). Por eso aceptamos esos campos como opcionales aunque el schema diga
// NOT NULL — el trigger los rellena antes del CHECK.
export type ConsorcioCreateInput = Omit<
  ConsorcioInsert,
  'tipo_documento' | 'numero_documento' | 'nombre_normalizado'
> & {
  tipo_documento?: ConsorcioInsert['tipo_documento'];
  numero_documento?: ConsorcioInsert['numero_documento'];
};

export async function createConsorcio(
  input: ConsorcioCreateInput,
): Promise<ApiResponse<ConsorcioRow>> {
  const { tipo_documento, numero_documento, ...rest } = input;
  // Cuando no se provee documento, va null y el trigger asignar_dni_ficticio
  // (BEFORE INSERT) consume el contador de config_global y lo completa (D07).
  // El cast es necesario porque el tipo generado lo marca NOT NULL.
  const payload = {
    ...rest,
    nombre_normalizado: '',
    tipo_documento: (tipo_documento ?? null) as ConsorcioInsert['tipo_documento'],
    numero_documento: (numero_documento ?? null) as ConsorcioInsert['numero_documento'],
  };
  const { data, error } = await supabase
    .from('consorcios')
    .insert(payload)
    .select()
    .single();
  if (error) return fail('CONSORCIO_CREATE', error.message, error);
  return ok(data);
}

export async function updateConsorcio(
  id: string,
  patch: ConsorcioUpdate,
): Promise<ApiResponse<ConsorcioRow>> {
  const { data, error } = await supabase
    .from('consorcios')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('CONSORCIO_UPDATE', error.message, error);
  return ok(data);
}

export async function setConsorcioActivo(
  id: string,
  activo: boolean,
  motivo?: string,
): Promise<ApiResponse<ConsorcioRow>> {
  return updateConsorcio(id, {
    activo,
    baja_motivo: activo ? null : (motivo ?? null),
    baja_fecha: activo ? null : new Date().toISOString().slice(0, 10),
  });
}
