// API de Encuesta de Satisfacción por curso (mig 0136).
// Regla 4: ningún componente toca supabase.from() directamente.

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

export type CursoEncuestaRow = Database['public']['Tables']['curso_encuestas']['Row'];
export type CursoEncuestaRespuestaRow = Database['public']['Tables']['curso_encuesta_respuestas']['Row'];

// ----------------------------------------------------------------------------
// Schema de la encuesta (en columna `schema` jsonb)
// ----------------------------------------------------------------------------
export type PreguntaTipo = 'escala_10' | 'estrellas' | 'multiple' | 'texto';

export interface PreguntaDef {
  id: string;          // uuid generado en cliente para identificar respuestas
  tipo: PreguntaTipo;
  titulo: string;      // "¿Cómo calificarías el material?"
  ayuda?: string;      // hint opcional debajo del título
  opciones?: string[]; // sólo para 'multiple'
  required?: boolean;
}

export interface EncuestaSchema {
  preguntas: PreguntaDef[];
}

// Etiquetas de UI
export const PREGUNTA_TIPO_LABEL: Record<PreguntaTipo, string> = {
  escala_10: 'Escala 1 a 10',
  estrellas: 'Estrellas (1 a 5)',
  multiple: 'Múltiple opción',
  texto: 'Texto libre',
};

// ----------------------------------------------------------------------------
// Gerencia · CRUD de la encuesta del curso
// ----------------------------------------------------------------------------

export async function getEncuestaPorCurso(
  curso_id: string,
): Promise<ApiResponse<CursoEncuestaRow | null>> {
  const { data, error } = await supabase
    .from('curso_encuestas')
    .select('*')
    .eq('curso_id', curso_id)
    .maybeSingle();
  if (error) return fail('ENC_GET', error.message, error);
  return ok(data);
}

/** Crea la encuesta si no existe, o devuelve la existente. */
export async function ensureEncuestaCurso(
  curso_id: string,
): Promise<ApiResponse<CursoEncuestaRow>> {
  const existing = await getEncuestaPorCurso(curso_id);
  if (!existing.ok) return existing;
  if (existing.data) return ok(existing.data);
  const { data, error } = await supabase
    .from('curso_encuestas')
    .insert({ curso_id })
    .select('*')
    .single();
  if (error) return fail('ENC_INIT', error.message, error);
  return ok(data);
}

export interface ActualizarEncuestaInput {
  titulo?: string;
  descripcion?: string | null;
  schema?: EncuestaSchema;
  activa?: boolean;
  requerida_para_cert?: boolean;
}

export async function actualizarEncuesta(
  id: string,
  patch: ActualizarEncuestaInput,
): Promise<ApiResponse<CursoEncuestaRow>> {
  type EncUpdate = Database['public']['Tables']['curso_encuestas']['Update'];
  const update: EncUpdate = {};
  if (patch.titulo !== undefined) update.titulo = patch.titulo;
  if (patch.descripcion !== undefined) update.descripcion = patch.descripcion;
  if (patch.schema !== undefined) update.schema = patch.schema as unknown as EncUpdate['schema'];
  if (patch.activa !== undefined) update.activa = patch.activa;
  if (patch.requerida_para_cert !== undefined)
    update.requerida_para_cert = patch.requerida_para_cert;
  const { data, error } = await supabase
    .from('curso_encuestas')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return fail('ENC_UPDATE', error.message, error);
  return ok(data);
}

// ----------------------------------------------------------------------------
// Emular desde otro curso
// ----------------------------------------------------------------------------
export interface CursoEmulable {
  curso_id: string;
  curso_titulo: string;
  n_preguntas: number;
}

export async function listarEncuestasEmulables(): Promise<
  ApiResponse<CursoEmulable[]>
> {
  const { data, error } = await supabase.rpc('encuesta_listar_emulables');
  if (error) return fail('ENC_EMULABLES', error.message, error);
  return ok((data ?? []) as CursoEmulable[]);
}

export async function emularEncuestaDeCurso(
  curso_destino: string,
  curso_origen: string,
): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.rpc('encuesta_emular_de_curso', {
    p_curso_destino: curso_destino,
    p_curso_origen: curso_origen,
  });
  if (error) return fail('ENC_EMULAR', error.message, error);
  return ok(data as unknown as string);
}

// ----------------------------------------------------------------------------
// Alumno · responder
// ----------------------------------------------------------------------------
export interface TestimonioInput {
  nombre?: string | null;
  foto_url?: string | null;
  comentario?: string | null;
  permite_publicar?: boolean;
}

export async function responderEncuesta(
  matricula_id: string,
  respuestas: Record<string, unknown>,
  testimonio?: TestimonioInput,
): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.rpc('encuesta_responder', {
    p_matricula_id: matricula_id,
    p_respuestas: respuestas as never,
    p_testimonio: (testimonio ?? null) as never,
  });
  if (error) return fail('ENC_RESPONDER', error.message, error);
  return ok(data as unknown as string);
}

export async function getMiRespuesta(
  matricula_id: string,
): Promise<ApiResponse<CursoEncuestaRespuestaRow | null>> {
  const { data, error } = await supabase
    .from('curso_encuesta_respuestas')
    .select('*')
    .eq('matricula_id', matricula_id)
    .maybeSingle();
  if (error) return fail('ENC_MI_RESP', error.message, error);
  return ok(data);
}

// ----------------------------------------------------------------------------
// Upload de foto del testimonio
// ----------------------------------------------------------------------------
export async function uploadFotoTestimonio(
  curso_id: string,
  matricula_id: string,
  file: File,
): Promise<ApiResponse<string>> {
  // E-GG-40 sweep
  const { safeStorageKey } = await import('@/lib/storageKeys');
  const path = `${curso_id}/${matricula_id}-${Date.now()}-${safeStorageKey(file.name)}`;
  const up = await supabase.storage
    .from('encuesta-testimonios')
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (up.error) return fail('ENC_FOTO', up.error.message, up.error);
  const { data: pub } = supabase.storage
    .from('encuesta-testimonios')
    .getPublicUrl(path);
  return ok(pub.publicUrl);
}

// ----------------------------------------------------------------------------
// Gerencia · reportes
// ----------------------------------------------------------------------------
export interface RespuestaJoinProfile extends CursoEncuestaRespuestaRow {
  alumno_nombre: string | null;
}

export async function listarRespuestasCurso(
  encuesta_id: string,
): Promise<ApiResponse<RespuestaJoinProfile[]>> {
  // Una sola query con join a profiles via matricula. `profiles` expone
  // `full_name` (no `nombre_completo`). El email no se incluye porque vive
  // en auth.users y no es accesible vía PostgREST público (no lo necesita
  // la UI de gerencia para este reporte).
  const { data, error } = await supabase
    .from('curso_encuesta_respuestas')
    .select(
      `*, curso_matriculas:matricula_id(profile_id, profiles:profile_id(full_name))`,
    )
    .eq('encuesta_id', encuesta_id)
    .order('created_at', { ascending: false });
  if (error) return fail('ENC_RESPS', error.message, error);
  type Joined = CursoEncuestaRespuestaRow & {
    curso_matriculas: {
      profile_id: string;
      profiles: { full_name: string | null } | null;
    } | null;
  };
  const rows = (data ?? []) as unknown as Joined[];
  return ok(
    rows.map((r) => ({
      ...(r as CursoEncuestaRespuestaRow),
      alumno_nombre: r.curso_matriculas?.profiles?.full_name ?? null,
    })),
  );
}

export async function marcarPublicado(
  respuesta_id: string,
  publicado: boolean,
): Promise<ApiResponse<true>> {
  const { error } = await supabase.rpc('encuesta_marcar_publicado', {
    p_respuesta_id: respuesta_id,
    p_publicado: publicado,
  });
  if (error) return fail('ENC_PUB', error.message, error);
  return ok(true);
}

// ----------------------------------------------------------------------------
// Util · genera id de pregunta en cliente
// ----------------------------------------------------------------------------
export function nuevoIdPregunta(): string {
  // Pequeño uuid sin libs externas (no crypto-safe; suficiente para keys).
  return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
