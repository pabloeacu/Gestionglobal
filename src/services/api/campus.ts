// Subsistema 7 (Documento Maestro): Campus virtual.
// API service · patrón ApiResponse<T> (regla 4, P-API-01). Toda mutación pasa
// por acá; los componentes nunca tocan supabase directo.

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database, Json } from '@/types/database';

// ============================================================================
// Tipos generados
// ============================================================================
export type CursoRow = Database['public']['Tables']['cursos']['Row'];
export type CursoInsert = Database['public']['Tables']['cursos']['Insert'];
export type CursoUpdate = Database['public']['Tables']['cursos']['Update'];

export type CursoModuloRow = Database['public']['Tables']['curso_modulos']['Row'];
export type CursoClaseRow = Database['public']['Tables']['curso_clases']['Row'];
export type CursoBibliografiaRow =
  Database['public']['Tables']['curso_bibliografia']['Row'];
export type CursoExamenRow = Database['public']['Tables']['curso_examenes']['Row'];
export type CursoPreguntaRow = Database['public']['Tables']['curso_preguntas']['Row'];
export type CursoOpcionRow = Database['public']['Tables']['curso_opciones']['Row'];
export type CursoMatriculaRow =
  Database['public']['Tables']['curso_matriculas']['Row'];
export type CursoProgresoRow =
  Database['public']['Tables']['curso_progreso']['Row'];
export type ExamenIntentoRow =
  Database['public']['Tables']['examen_intentos']['Row'];

// Fase 1 (DGG-10): condiciones del certificado, checklist por matrícula,
// encuentros sincrónicos y asistencia.
export type CursoCondicionConfigRow =
  Database['public']['Tables']['curso_condiciones_config']['Row'];
export type MatriculaCondicionRow =
  Database['public']['Tables']['matricula_condiciones']['Row'];
export type CursoEncuentroRow =
  Database['public']['Tables']['curso_encuentros']['Row'];
export type CursoEncuentroAsistenciaRow =
  Database['public']['Tables']['curso_encuentro_asistencias']['Row'];

export const CONDICION_TIPOS = [
  'examen',
  'asistencia',
  'pago',
  'otra',
] as const;
export type CondicionTipo = (typeof CONDICION_TIPOS)[number];

export const CONDICION_TIPO_LABEL: Record<CondicionTipo, string> = {
  examen: 'Aprobar el examen',
  asistencia: 'Asistencia a encuentros',
  pago: 'Pago del curso',
  otra: 'Otra condición',
};

// La condición de examen es la única automática (se acredita server-side al
// aprobar). El resto las tilda gerencia/instructor manualmente.
export const CONDICION_AUTOMATICA: Record<CondicionTipo, boolean> = {
  examen: true,
  asistencia: false,
  pago: false,
  otra: false,
};

export const MODALIDADES = ['asincronica', 'sincronica', 'mixta'] as const;
export type Modalidad = (typeof MODALIDADES)[number];

export const MODALIDAD_LABEL: Record<Modalidad, string> = {
  asincronica: 'Asincrónica',
  sincronica: 'Sincrónica',
  mixta: 'Mixta',
};

export const CLASE_TIPOS = [
  'asincronica_video',
  'sincronica_zoom',
  'lectura_pdf',
  'examen',
] as const;
export type ClaseTipo = (typeof CLASE_TIPOS)[number];

export const CLASE_TIPO_LABEL: Record<ClaseTipo, string> = {
  asincronica_video: 'Video asincrónico',
  sincronica_zoom: 'Encuentro sincrónico',
  lectura_pdf: 'Lectura / PDF',
  examen: 'Examen',
};

export const MATRICULA_ESTADOS = [
  'activa',
  'completada',
  'vencida',
  'anulada',
] as const;
export type MatriculaEstado = (typeof MATRICULA_ESTADOS)[number];

export const MATRICULA_ESTADO_LABEL: Record<MatriculaEstado, string> = {
  activa: 'Activa',
  completada: 'Completada',
  vencida: 'Vencida',
  anulada: 'Anulada',
};

export const MATRICULA_ESTADO_BADGE: Record<MatriculaEstado, string> = {
  activa: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  completada: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20',
  vencida: 'bg-amber-50 text-amber-700 border-amber-200',
  anulada: 'bg-red-50 text-red-700 border-red-200',
};

export const PREGUNTA_TIPOS = [
  'multiple_choice',
  'verdadero_falso',
  'texto_corto',
] as const;
export type PreguntaTipo = (typeof PREGUNTA_TIPOS)[number];

export const PREGUNTA_TIPO_LABEL: Record<PreguntaTipo, string> = {
  multiple_choice: 'Multiple choice',
  verdadero_falso: 'Verdadero / Falso',
  texto_corto: 'Respuesta corta',
};

// ============================================================================
// Curso · listado + detalle
// ============================================================================
export interface ListCursosParams {
  search?: string;
  modalidad?: Modalidad | 'todos';
  soloActivos?: boolean;
}

export interface CursoListItem extends CursoRow {
  matriculados_activos: number;
}

export async function listCursos(
  params: ListCursosParams = {},
): Promise<ApiResponse<CursoListItem[]>> {
  let q = supabase
    .from('cursos')
    .select(`*, curso_matriculas(id, estado)`)
    .order('created_at', { ascending: false });

  if (params.soloActivos !== false) {
    // por default mostramos sólo activos (catálogo público). Staff puede pasar
    // soloActivos=false para ver el archivo.
    q = q.eq('activo', true);
  }
  if (params.modalidad && params.modalidad !== 'todos') {
    q = q.eq('modalidad', params.modalidad);
  }
  if (params.search && params.search.trim().length > 0) {
    const s = params.search.trim();
    q = q.or(`titulo.ilike.%${s}%,slug.ilike.%${s}%,categoria.ilike.%${s}%`);
  }
  const { data, error } = await q;
  if (error) return fail('CURSOS_LIST', error.message, error);

  type RawRow = CursoRow & {
    curso_matriculas: Array<{ id: string; estado: MatriculaEstado }>;
  };
  const rows = (data as unknown as RawRow[] | null ?? []).map((r) => ({
    ...(r as CursoRow),
    matriculados_activos: (r.curso_matriculas ?? []).filter(
      (m) => m.estado === 'activa',
    ).length,
  }));
  return ok(rows);
}

export interface CursoDetalle {
  curso: CursoRow;
  modulos: Array<
    CursoModuloRow & {
      clases: CursoClaseRow[];
    }
  >;
  bibliografia: CursoBibliografiaRow[];
  examenes: Array<
    CursoExamenRow & {
      preguntas: Array<CursoPreguntaRow & { opciones: CursoOpcionRow[] }>;
    }
  >;
}

export async function getCurso(
  slugOrId: string,
): Promise<ApiResponse<CursoDetalle>> {
  // 1. Curso (por id o slug). Permite SELECT público de activos.
  const byUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      slugOrId,
    );
  const { data: curso, error: e1 } = await supabase
    .from('cursos')
    .select('*')
    .eq(byUuid ? 'id' : 'slug', slugOrId)
    .single();
  if (e1) return fail('CURSO_GET', e1.message, e1);

  // 2. Módulos + clases. RLS filtra para no-matriculados (devolverá vacío).
  const { data: modulos, error: e2 } = await supabase
    .from('curso_modulos')
    .select('*, curso_clases(*)')
    .eq('curso_id', curso.id)
    .order('orden', { ascending: true });
  if (e2) return fail('CURSO_MODULOS', e2.message, e2);

  // 3. Bibliografía.
  const { data: biblio, error: e3 } = await supabase
    .from('curso_bibliografia')
    .select('*')
    .eq('curso_id', curso.id)
    .order('created_at', { ascending: true });
  if (e3) return fail('CURSO_BIBLIO', e3.message, e3);

  // 4. Exámenes con preguntas y opciones.
  const { data: examenes, error: e4 } = await supabase
    .from('curso_examenes')
    .select('*, curso_preguntas(*, curso_opciones(*))')
    .eq('curso_id', curso.id)
    .order('created_at', { ascending: true });
  if (e4) return fail('CURSO_EXAMENES', e4.message, e4);

  type ModRaw = CursoModuloRow & { curso_clases: CursoClaseRow[] };
  type ExRaw = CursoExamenRow & {
    curso_preguntas: Array<CursoPreguntaRow & { curso_opciones: CursoOpcionRow[] }>;
  };

  const modulosOrdenados = (modulos as unknown as ModRaw[] | null ?? []).map(
    (m) => ({
      ...(m as CursoModuloRow),
      clases: [...(m.curso_clases ?? [])].sort((a, b) => a.orden - b.orden),
    }),
  );

  const examenesOrdenados = (examenes as unknown as ExRaw[] | null ?? []).map(
    (e) => ({
      ...(e as CursoExamenRow),
      preguntas: [...(e.curso_preguntas ?? [])]
        .sort((a, b) => a.orden - b.orden)
        .map((p) => ({
          ...(p as CursoPreguntaRow),
          opciones: [...(p.curso_opciones ?? [])].sort(
            (a, b) => a.orden - b.orden,
          ),
        })),
    }),
  );

  return ok({
    curso,
    modulos: modulosOrdenados,
    bibliografia: biblio ?? [],
    examenes: examenesOrdenados,
  });
}

// ============================================================================
// Matrículas
// ============================================================================
export interface MatricularInput {
  cursoId: string;
  profileId: string;
  administracionId?: string | null;
}

// DGG-10: el autoservicio se cerró. La inscripción del alumno la crea staff
// vía `asignarAlumno` (RPC curso_asignar_alumno). `matricularUsuario` queda
// como utilitario de compat para staff (la RPC valida is_staff server-side).
export async function matricularUsuario(
  input: MatricularInput,
): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.rpc('curso_matricular', {
    p_curso_id: input.cursoId,
    p_profile_id: input.profileId,
    // RPC SD acepta null para administracion_id; lo casteamos para el cliente
    // generado, que tipa el param como string.
    p_administracion_id: (input.administracionId ?? null) as unknown as string,
  });
  if (error) return fail('MATRICULAR', error.message, error);
  return ok(data as string);
}

export interface ListMatriculasParams {
  cursoId?: string;
  profileId?: string;
  estado?: MatriculaEstado | 'todos';
  search?: string;
}

export interface MatriculaListItem extends CursoMatriculaRow {
  curso: Pick<CursoRow, 'id' | 'slug' | 'titulo' | 'modalidad'> | null;
  alumno_nombre: string | null;
  alumno_email: string | null;
  administracion_nombre: string | null;
}

export async function listMatriculas(
  params: ListMatriculasParams = {},
): Promise<ApiResponse<MatriculaListItem[]>> {
  let q = supabase
    .from('curso_matriculas')
    .select(
      `*,
       cursos:curso_id(id, slug, titulo, modalidad),
       profiles!curso_matriculas_profile_id_fkey(id, full_name),
       administraciones(id, nombre)`,
    )
    .order('inscripto_at', { ascending: false });
  if (params.cursoId) q = q.eq('curso_id', params.cursoId);
  if (params.profileId) q = q.eq('profile_id', params.profileId);
  if (params.estado && params.estado !== 'todos') q = q.eq('estado', params.estado);

  const { data, error } = await q;
  if (error) return fail('MATRICULAS_LIST', error.message, error);

  type RawRow = CursoMatriculaRow & {
    cursos: Pick<CursoRow, 'id' | 'slug' | 'titulo' | 'modalidad'> | null;
    profiles: { id: string; full_name: string | null } | null;
    administraciones: { id: string; nombre: string } | null;
  };
  let rows: MatriculaListItem[] = (data as unknown as RawRow[] | null ?? []).map(
    (r) => ({
      ...(r as CursoMatriculaRow),
      curso: r.cursos,
      alumno_nombre: r.profiles?.full_name ?? null,
      alumno_email: null,
      administracion_nombre: r.administraciones?.nombre ?? null,
    }),
  );
  if (params.search && params.search.trim().length > 0) {
    const s = params.search.trim().toLowerCase();
    rows = rows.filter((r) =>
      [r.alumno_nombre, r.curso?.titulo, r.administracion_nombre]
        .filter(Boolean)
        .some((x) => x!.toLowerCase().includes(s)),
    );
  }
  return ok(rows);
}

export async function setMatriculaEstado(
  matriculaId: string,
  estado: MatriculaEstado,
): Promise<ApiResponse<true>> {
  const { error } = await supabase
    .from('curso_matriculas')
    .update({ estado })
    .eq('id', matriculaId);
  if (error) return fail('MATRICULA_ESTADO', error.message, error);
  return ok(true);
}

// ============================================================================
// Progreso
// ============================================================================
export async function marcarCompletada(
  matriculaId: string,
  claseId: string,
): Promise<ApiResponse<true>> {
  const { error } = await supabase.rpc('curso_marcar_clase_completada', {
    p_matricula_id: matriculaId,
    p_clase_id: claseId,
  });
  if (error) return fail('PROGRESO_MARK', error.message, error);
  return ok(true);
}

export interface ProgresoResumen {
  total_clases: number;
  completadas: number;
  porcentaje: number;
  examenes_aprobados: number;
}

export async function getProgresoResumen(
  matriculaId: string,
): Promise<ApiResponse<ProgresoResumen>> {
  const { data, error } = await supabase.rpc('curso_progreso_resumen', {
    p_matricula_id: matriculaId,
  });
  if (error) return fail('PROGRESO_SUM', error.message, error);
  return ok(data as unknown as ProgresoResumen);
}

export async function listProgreso(
  matriculaId: string,
): Promise<ApiResponse<CursoProgresoRow[]>> {
  const { data, error } = await supabase
    .from('curso_progreso')
    .select('*')
    .eq('matricula_id', matriculaId);
  if (error) return fail('PROGRESO_LIST', error.message, error);
  return ok(data ?? []);
}

// ============================================================================
// Exámenes
// ============================================================================
export interface RespuestaPregunta {
  pregunta_id: string;
  opcion_ids?: string[];
  texto?: string;
}

export async function iniciarIntento(
  examenId: string,
  matriculaId: string,
): Promise<ApiResponse<ExamenIntentoRow>> {
  // Próximo número de intento.
  const { data: prev, error: e1 } = await supabase
    .from('examen_intentos')
    .select('intento')
    .eq('examen_id', examenId)
    .eq('matricula_id', matriculaId)
    .order('intento', { ascending: false })
    .limit(1);
  if (e1) return fail('INTENTO_PREV', e1.message, e1);
  const siguiente = (prev?.[0]?.intento ?? 0) + 1;

  const { data, error } = await supabase
    .from('examen_intentos')
    .insert({
      examen_id: examenId,
      matricula_id: matriculaId,
      intento: siguiente,
    })
    .select()
    .single();
  if (error) return fail('INTENTO_INIT', error.message, error);
  return ok(data);
}

export interface ResultadoExamen {
  nota: number;
  aprobado: boolean;
  pendientes_revision: number;
  detalle: Array<{
    pregunta_id: string;
    correcta: boolean | null;
    puntaje: number;
    pendiente_revision: boolean;
  }>;
}

export async function responderExamen(
  intentoId: string,
  respuestas: RespuestaPregunta[],
): Promise<ApiResponse<ResultadoExamen>> {
  const { data, error } = await supabase.rpc('curso_responder_examen', {
    p_intento_id: intentoId,
    p_respuestas: respuestas as unknown as Json,
  });
  if (error) return fail('EXAMEN_RESPONDER', error.message, error);
  return ok(data as unknown as ResultadoExamen);
}

export async function listIntentos(
  matriculaId: string,
  examenId?: string,
): Promise<ApiResponse<ExamenIntentoRow[]>> {
  let q = supabase
    .from('examen_intentos')
    .select('*')
    .eq('matricula_id', matriculaId)
    .order('intento', { ascending: false });
  if (examenId) q = q.eq('examen_id', examenId);
  const { data, error } = await q;
  if (error) return fail('INTENTOS_LIST', error.message, error);
  return ok(data ?? []);
}

// ============================================================================
// CRUDs staff · cursos, módulos, clases, exámenes
// ============================================================================
export interface CrearCursoInput {
  slug: string;
  titulo: string;
  descripcion?: string | null;
  descripcion_html?: string | null;
  categoria?: string | null;
  modalidad?: Modalidad;
  duracion_horas?: number | null;
  precio_lista?: number | null;
  cupo_max?: number | null;
  vigencia_meses?: number;
  instructor_nombre?: string | null;
  instructor_bio?: string | null;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  banner_url?: string | null;
}

export async function crearCurso(
  input: CrearCursoInput,
): Promise<ApiResponse<CursoRow>> {
  const { data, error } = await supabase
    .from('cursos')
    .insert({
      slug: input.slug,
      titulo: input.titulo,
      descripcion: input.descripcion ?? null,
      descripcion_html: input.descripcion_html ?? null,
      categoria: input.categoria ?? null,
      modalidad: input.modalidad ?? 'asincronica',
      duracion_horas: input.duracion_horas ?? null,
      precio_lista: input.precio_lista ?? null,
      cupo_max: input.cupo_max ?? null,
      vigencia_meses: input.vigencia_meses ?? 12,
      instructor_nombre: input.instructor_nombre ?? null,
      instructor_bio: input.instructor_bio ?? null,
      fecha_inicio: input.fecha_inicio ?? null,
      fecha_fin: input.fecha_fin ?? null,
      banner_url: input.banner_url ?? null,
      activo: true,
    })
    .select()
    .single();
  if (error) return fail('CURSO_CREATE', error.message, error);
  return ok(data);
}

export async function actualizarCurso(
  id: string,
  patch: CursoUpdate,
): Promise<ApiResponse<CursoRow>> {
  const { data, error } = await supabase
    .from('cursos')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('CURSO_UPDATE', error.message, error);
  return ok(data);
}

export async function setCursoActivo(
  id: string,
  activo: boolean,
): Promise<ApiResponse<true>> {
  const { error } = await supabase.from('cursos').update({ activo }).eq('id', id);
  if (error) return fail('CURSO_ACTIVO', error.message, error);
  return ok(true);
}

// Módulos
export async function crearModulo(
  cursoId: string,
  titulo: string,
  descripcion?: string | null,
): Promise<ApiResponse<CursoModuloRow>> {
  const { data: orden } = await supabase
    .from('curso_modulos')
    .select('orden')
    .eq('curso_id', cursoId)
    .order('orden', { ascending: false })
    .limit(1);
  const next = ((orden?.[0]?.orden as number | undefined) ?? 0) + 1;
  const { data, error } = await supabase
    .from('curso_modulos')
    .insert({ curso_id: cursoId, orden: next, titulo, descripcion: descripcion ?? null })
    .select()
    .single();
  if (error) return fail('MODULO_CREATE', error.message, error);
  return ok(data);
}

export async function actualizarModulo(
  id: string,
  patch: Partial<Pick<CursoModuloRow, 'titulo' | 'descripcion' | 'orden'>>,
): Promise<ApiResponse<CursoModuloRow>> {
  const { data, error } = await supabase
    .from('curso_modulos')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('MODULO_UPDATE', error.message, error);
  return ok(data);
}

export async function borrarModulo(id: string): Promise<ApiResponse<true>> {
  const { error } = await supabase.from('curso_modulos').delete().eq('id', id);
  if (error) return fail('MODULO_DELETE', error.message, error);
  return ok(true);
}

// Clases
export interface ClaseInput {
  modulo_id: string;
  titulo: string;
  tipo: ClaseTipo;
  descripcion?: string | null;
  youtube_url?: string | null;
  zoom_url?: string | null;
  zoom_fecha_hora?: string | null;
  material_url?: string | null;
  duracion_min?: number | null;
}

export async function crearClase(
  input: ClaseInput,
): Promise<ApiResponse<CursoClaseRow>> {
  const { data: orden } = await supabase
    .from('curso_clases')
    .select('orden')
    .eq('modulo_id', input.modulo_id)
    .order('orden', { ascending: false })
    .limit(1);
  const next = ((orden?.[0]?.orden as number | undefined) ?? 0) + 1;
  const { data, error } = await supabase
    .from('curso_clases')
    .insert({
      modulo_id: input.modulo_id,
      titulo: input.titulo,
      tipo: input.tipo,
      orden: next,
      descripcion: input.descripcion ?? null,
      youtube_url: input.youtube_url ?? null,
      zoom_url: input.zoom_url ?? null,
      zoom_fecha_hora: input.zoom_fecha_hora ?? null,
      material_url: input.material_url ?? null,
      duracion_min: input.duracion_min ?? null,
    })
    .select()
    .single();
  if (error) return fail('CLASE_CREATE', error.message, error);
  return ok(data);
}

export async function actualizarClase(
  id: string,
  patch: Partial<ClaseInput> & { orden?: number },
): Promise<ApiResponse<CursoClaseRow>> {
  const { data, error } = await supabase
    .from('curso_clases')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('CLASE_UPDATE', error.message, error);
  return ok(data);
}

export async function borrarClase(id: string): Promise<ApiResponse<true>> {
  const { error } = await supabase.from('curso_clases').delete().eq('id', id);
  if (error) return fail('CLASE_DELETE', error.message, error);
  return ok(true);
}

// Bibliografía
export async function crearBibliografia(
  cursoId: string,
  input: {
    titulo: string;
    autor?: string | null;
    url?: string | null;
    archivo_url?: string | null;
    descripcion?: string | null;
  },
): Promise<ApiResponse<CursoBibliografiaRow>> {
  const { data, error } = await supabase
    .from('curso_bibliografia')
    .insert({
      curso_id: cursoId,
      titulo: input.titulo,
      autor: input.autor ?? null,
      url: input.url ?? null,
      archivo_url: input.archivo_url ?? null,
      descripcion: input.descripcion ?? null,
    })
    .select()
    .single();
  if (error) return fail('BIBLIO_CREATE', error.message, error);
  return ok(data);
}

export async function borrarBibliografia(id: string): Promise<ApiResponse<true>> {
  const { error } = await supabase
    .from('curso_bibliografia')
    .delete()
    .eq('id', id);
  if (error) return fail('BIBLIO_DELETE', error.message, error);
  return ok(true);
}

// Exámenes
export interface ExamenInput {
  curso_id: string;
  titulo: string;
  descripcion?: string | null;
  modulo_id?: string | null;
  fecha_habilitacion?: string | null;
  fecha_cierre?: string | null;
  intentos_max?: number;
  nota_aprobacion?: number;
}

export async function crearExamen(
  input: ExamenInput,
): Promise<ApiResponse<CursoExamenRow>> {
  const { data, error } = await supabase
    .from('curso_examenes')
    .insert({
      curso_id: input.curso_id,
      titulo: input.titulo,
      descripcion: input.descripcion ?? null,
      modulo_id: input.modulo_id ?? null,
      fecha_habilitacion: input.fecha_habilitacion ?? null,
      fecha_cierre: input.fecha_cierre ?? null,
      intentos_max: input.intentos_max ?? 1,
      nota_aprobacion: input.nota_aprobacion ?? 60,
    })
    .select()
    .single();
  if (error) return fail('EXAMEN_CREATE', error.message, error);
  return ok(data);
}

export async function actualizarExamen(
  id: string,
  patch: Partial<ExamenInput>,
): Promise<ApiResponse<CursoExamenRow>> {
  const { data, error } = await supabase
    .from('curso_examenes')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('EXAMEN_UPDATE', error.message, error);
  return ok(data);
}

export async function borrarExamen(id: string): Promise<ApiResponse<true>> {
  const { error } = await supabase.from('curso_examenes').delete().eq('id', id);
  if (error) return fail('EXAMEN_DELETE', error.message, error);
  return ok(true);
}

// Preguntas
export interface PreguntaInput {
  examen_id: string;
  enunciado: string;
  tipo: PreguntaTipo;
  puntaje?: number;
  opciones?: Array<{ texto: string; correcta: boolean }>;
}

export async function crearPregunta(
  input: PreguntaInput,
): Promise<ApiResponse<CursoPreguntaRow>> {
  const { data: orden } = await supabase
    .from('curso_preguntas')
    .select('orden')
    .eq('examen_id', input.examen_id)
    .order('orden', { ascending: false })
    .limit(1);
  const next = ((orden?.[0]?.orden as number | undefined) ?? 0) + 1;
  const { data, error } = await supabase
    .from('curso_preguntas')
    .insert({
      examen_id: input.examen_id,
      enunciado: input.enunciado,
      tipo: input.tipo,
      puntaje: input.puntaje ?? 1,
      orden: next,
    })
    .select()
    .single();
  if (error) return fail('PREGUNTA_CREATE', error.message, error);

  if (input.opciones && input.opciones.length > 0) {
    const rows = input.opciones.map((o, i) => ({
      pregunta_id: data.id,
      orden: i + 1,
      texto: o.texto,
      correcta: o.correcta,
    }));
    const { error: e2 } = await supabase.from('curso_opciones').insert(rows);
    if (e2) return fail('OPCIONES_CREATE', e2.message, e2);
  }
  return ok(data);
}

export async function actualizarPregunta(
  id: string,
  patch: Partial<Omit<PreguntaInput, 'examen_id' | 'opciones'>> & { orden?: number },
): Promise<ApiResponse<CursoPreguntaRow>> {
  const { data, error } = await supabase
    .from('curso_preguntas')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('PREGUNTA_UPDATE', error.message, error);
  return ok(data);
}

export async function borrarPregunta(id: string): Promise<ApiResponse<true>> {
  const { error } = await supabase.from('curso_preguntas').delete().eq('id', id);
  if (error) return fail('PREGUNTA_DELETE', error.message, error);
  return ok(true);
}

// Opciones
export async function reemplazarOpciones(
  preguntaId: string,
  opciones: Array<{ texto: string; correcta: boolean; retroalimentacion?: string | null }>,
): Promise<ApiResponse<true>> {
  const { error: e1 } = await supabase
    .from('curso_opciones')
    .delete()
    .eq('pregunta_id', preguntaId);
  if (e1) return fail('OPCIONES_DELETE', e1.message, e1);
  if (opciones.length === 0) return ok(true);
  const rows = opciones.map((o, i) => ({
    pregunta_id: preguntaId,
    orden: i + 1,
    texto: o.texto,
    correcta: o.correcta,
    retroalimentacion: o.retroalimentacion ?? null,
  }));
  const { error: e2 } = await supabase.from('curso_opciones').insert(rows);
  if (e2) return fail('OPCIONES_CREATE', e2.message, e2);
  return ok(true);
}

// ============================================================================
// Fase 1 · Asignación manual de alumnos (DGG-10: sin autoservicio)
// ============================================================================
export interface AsignarAlumnoInput {
  cursoId: string;
  administracionId: string;
  profileId?: string | null;
}

export async function asignarAlumno(
  input: AsignarAlumnoInput,
): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.rpc('curso_asignar_alumno', {
    p_curso_id: input.cursoId,
    p_administracion_id: input.administracionId,
    p_profile_id: (input.profileId ?? null) as unknown as string,
  });
  if (error) return fail('CURSO_ASIGNAR', error.message, error);
  return ok(data as string);
}

// ============================================================================
// Fase 1 · Condiciones del certificado (config por curso)
// ============================================================================
export interface CondicionConfigInput {
  id?: string;
  tipo: CondicionTipo;
  etiqueta: string;
  examen_id?: string | null;
  obligatoria?: boolean;
  activa?: boolean;
  orden?: number;
}

export async function listCondicionesConfig(
  cursoId: string,
): Promise<ApiResponse<CursoCondicionConfigRow[]>> {
  const { data, error } = await supabase
    .from('curso_condiciones_config')
    .select('*')
    .eq('curso_id', cursoId)
    .order('orden', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return fail('CONDICIONES_LIST', error.message, error);
  return ok(data ?? []);
}

// Reemplaza el set de condiciones de un curso por el provisto (full sync).
// Mantiene las filas existentes por id (para no perder el checklist ya
// materializado), inserta nuevas y borra las que ya no están.
export async function guardarCondicionesConfig(
  cursoId: string,
  condiciones: CondicionConfigInput[],
): Promise<ApiResponse<true>> {
  // 1. Estado actual.
  const { data: actuales, error: e0 } = await supabase
    .from('curso_condiciones_config')
    .select('id')
    .eq('curso_id', cursoId);
  if (e0) return fail('CONDICIONES_SYNC', e0.message, e0);

  const idsEntrantes = new Set(
    condiciones.filter((c) => c.id).map((c) => c.id as string),
  );
  const aBorrar = (actuales ?? [])
    .map((r) => r.id)
    .filter((id) => !idsEntrantes.has(id));

  // 2. Borrar las que ya no están.
  if (aBorrar.length > 0) {
    const { error: eDel } = await supabase
      .from('curso_condiciones_config')
      .delete()
      .in('id', aBorrar);
    if (eDel) return fail('CONDICIONES_DEL', eDel.message, eDel);
  }

  // 3. Upsert (insert nuevas, update existentes) preservando el orden.
  for (let i = 0; i < condiciones.length; i++) {
    const c = condiciones[i]!;
    const payload = {
      curso_id: cursoId,
      tipo: c.tipo,
      etiqueta: c.etiqueta,
      automatica: CONDICION_AUTOMATICA[c.tipo],
      examen_id: c.examen_id ?? null,
      obligatoria: c.obligatoria ?? true,
      activa: c.activa ?? true,
      orden: i,
    };
    if (c.id) {
      const { error } = await supabase
        .from('curso_condiciones_config')
        .update(payload)
        .eq('id', c.id);
      if (error) return fail('CONDICION_UPDATE', error.message, error);
    } else {
      const { error } = await supabase
        .from('curso_condiciones_config')
        .insert(payload);
      if (error) return fail('CONDICION_INSERT', error.message, error);
    }
  }
  return ok(true);
}

// ============================================================================
// Fase 1 · Checklist de condiciones por matrícula (gestión + portal alumno)
// ============================================================================
export interface MatriculaCondicionItem extends MatriculaCondicionRow {
  tipo: CondicionTipo;
  etiqueta: string;
  obligatoria: boolean;
  activa: boolean;
}

export async function listCondicionesMatricula(
  matriculaId: string,
): Promise<ApiResponse<MatriculaCondicionItem[]>> {
  const { data, error } = await supabase
    .from('matricula_condiciones')
    .select('*, curso_condiciones_config!inner(tipo, etiqueta, obligatoria, activa, orden)')
    .eq('matricula_id', matriculaId);
  if (error) return fail('MAT_CONDICIONES', error.message, error);

  type Raw = MatriculaCondicionRow & {
    curso_condiciones_config: {
      tipo: CondicionTipo;
      etiqueta: string;
      obligatoria: boolean;
      activa: boolean;
      orden: number;
    } | null;
  };
  const rows = (data as unknown as Raw[] | null ?? [])
    .map((r) => ({
      ...(r as MatriculaCondicionRow),
      tipo: (r.curso_condiciones_config?.tipo ?? 'otra') as CondicionTipo,
      etiqueta: r.curso_condiciones_config?.etiqueta ?? 'Condición',
      obligatoria: r.curso_condiciones_config?.obligatoria ?? true,
      activa: r.curso_condiciones_config?.activa ?? true,
      _orden: r.curso_condiciones_config?.orden ?? 0,
    }))
    .sort((a, b) => a._orden - b._orden)
    .map(({ _orden, ...rest }) => rest);
  return ok(rows);
}

export interface TildarCondicionInput {
  matriculaCondicionId: string;
  cumplida: boolean;
  observaciones?: string | null;
}

export async function tildarCondicion(
  input: TildarCondicionInput,
): Promise<ApiResponse<true>> {
  const { error } = await supabase.rpc('matricula_tildar_condicion', {
    p_matricula_condicion_id: input.matriculaCondicionId,
    p_cumplida: input.cumplida,
    p_observaciones: (input.observaciones ?? null) as unknown as string,
  });
  if (error) return fail('CONDICION_TILDAR', error.message, error);
  return ok(true);
}

// ============================================================================
// Fase 1 · Encuentros sincrónicos + asistencia
// ============================================================================
export async function listEncuentros(
  cursoId: string,
): Promise<ApiResponse<CursoEncuentroRow[]>> {
  const { data, error } = await supabase
    .from('curso_encuentros')
    .select('*')
    .eq('curso_id', cursoId)
    .order('fecha_hora', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) return fail('ENCUENTROS_LIST', error.message, error);
  return ok(data ?? []);
}

export interface EncuentroInput {
  cursoId: string;
  titulo: string;
  descripcion?: string | null;
  fechaHora?: string | null;
  linkZoom?: string | null;
}

export async function crearEncuentro(
  input: EncuentroInput,
): Promise<ApiResponse<CursoEncuentroRow>> {
  const { data, error } = await supabase
    .from('curso_encuentros')
    .insert({
      curso_id: input.cursoId,
      titulo: input.titulo,
      descripcion: input.descripcion ?? null,
      fecha_hora: input.fechaHora ?? null,
      link_zoom: input.linkZoom ?? null,
    })
    .select()
    .single();
  if (error) return fail('ENCUENTRO_CREATE', error.message, error);
  return ok(data);
}

export async function actualizarEncuentro(
  id: string,
  patch: Partial<{
    titulo: string;
    descripcion: string | null;
    fecha_hora: string | null;
    link_zoom: string | null;
  }>,
): Promise<ApiResponse<CursoEncuentroRow>> {
  const { data, error } = await supabase
    .from('curso_encuentros')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('ENCUENTRO_UPDATE', error.message, error);
  return ok(data);
}

export async function borrarEncuentro(id: string): Promise<ApiResponse<true>> {
  const { error } = await supabase.from('curso_encuentros').delete().eq('id', id);
  if (error) return fail('ENCUENTRO_DELETE', error.message, error);
  return ok(true);
}

export async function listAsistencias(
  encuentroId: string,
): Promise<ApiResponse<CursoEncuentroAsistenciaRow[]>> {
  const { data, error } = await supabase
    .from('curso_encuentro_asistencias')
    .select('*')
    .eq('encuentro_id', encuentroId);
  if (error) return fail('ASISTENCIAS_LIST', error.message, error);
  return ok(data ?? []);
}

export interface MarcarAsistenciaInput {
  encuentroId: string;
  matriculaId: string;
  presente: boolean;
}

// Tilde de asistencia por (encuentro, matrícula). Upsert idempotente.
export async function marcarAsistencia(
  input: MarcarAsistenciaInput,
): Promise<ApiResponse<true>> {
  const { error } = await supabase
    .from('curso_encuentro_asistencias')
    .upsert(
      {
        encuentro_id: input.encuentroId,
        matricula_id: input.matriculaId,
        presente: input.presente,
        marcada_at: new Date().toISOString(),
      },
      { onConflict: 'encuentro_id,matricula_id' },
    );
  if (error) return fail('ASISTENCIA_MARK', error.message, error);
  return ok(true);
}

// ============================================================================
// Fase 1 · Registro de pago del curso → asiento de ingreso (DGG-10bis)
// ============================================================================
export interface RegistrarPagoInput {
  matriculaId: string;
  monto: number;
  cajaId: string;
  observaciones?: string | null;
}

export async function registrarPagoCurso(
  input: RegistrarPagoInput,
): Promise<ApiResponse<{ movimiento_id: string; condicion_pago_id: string | null }>> {
  const { data, error } = await supabase.rpc('curso_registrar_pago', {
    p_matricula_id: input.matriculaId,
    p_monto: input.monto,
    p_caja_id: input.cajaId,
    p_observaciones: (input.observaciones ?? null) as unknown as string,
  });
  if (error) return fail('CURSO_PAGO', error.message, error);
  return ok(
    data as unknown as { movimiento_id: string; condicion_pago_id: string | null },
  );
}

// Administraciones disponibles para asignar (reusa la cartera de clientes).
export interface AdministracionParaAsignar {
  id: string;
  nombre: string;
  codigo: string;
}

export async function listAdministracionesParaAsignar(
  search?: string,
): Promise<ApiResponse<AdministracionParaAsignar[]>> {
  let q = supabase
    .from('administraciones')
    .select('id, nombre, codigo')
    .eq('activo', true)
    .order('nombre', { ascending: true })
    .limit(50);
  if (search && search.trim().length > 0) {
    const s = search.trim();
    q = q.or(`nombre.ilike.%${s}%,codigo.ilike.%${s}%`);
  }
  const { data, error } = await q;
  if (error) return fail('ADMIN_ASIGNAR_LIST', error.message, error);
  return ok((data ?? []) as AdministracionParaAsignar[]);
}

// Cajas activas para el modal de registro de pago (reusa finanzas).
export interface CajaParaPago {
  id: string;
  nombre: string;
}

export async function listCajasParaPago(): Promise<ApiResponse<CajaParaPago[]>> {
  const { data, error } = await supabase
    .from('cajas')
    .select('id, nombre')
    .eq('activo', true)
    .order('orden', { ascending: true });
  if (error) return fail('CAJAS_PAGO_LIST', error.message, error);
  return ok((data ?? []) as CajaParaPago[]);
}

// ============================================================================
// Fase 2 · Certificados verificables (DGG-10)
// ============================================================================
export type CertificadoRow = Database['public']['Tables']['certificados']['Row'];

export interface CertificadoSnapshot {
  alumno_nombre?: string;
  curso_titulo?: string;
  instructor_nombre?: string | null;
  duracion_horas?: number | null;
  nota_examen?: number | null;
  emitido_at?: string;
}

// Datos que el render del PDF necesita (snapshot + campos de la fila).
export interface CertificadoParaPdf {
  id: string;
  codigo: string;
  tema: number;
  alumno_nombre: string;
  curso_titulo: string;
  instructor_nombre: string | null;
  nota_examen: number | null;
  emitido_at: string;
  duracion_horas: number | null;
}

export function certificadoParaPdf(c: CertificadoRow): CertificadoParaPdf {
  const snap = (c.payload_snapshot ?? {}) as CertificadoSnapshot;
  return {
    id: c.id,
    codigo: c.codigo,
    tema: c.tema,
    alumno_nombre: snap.alumno_nombre ?? 'Alumno',
    curso_titulo: snap.curso_titulo ?? '',
    instructor_nombre: c.instructor_nombre ?? snap.instructor_nombre ?? null,
    nota_examen: c.nota_examen !== null ? Number(c.nota_examen) : null,
    emitido_at: c.emitido_at,
    duracion_horas: snap.duracion_horas ?? null,
  };
}

// Certificado de una matrícula (o null si todavía no se emitió).
export async function getCertificadoMatricula(
  matriculaId: string,
): Promise<ApiResponse<CertificadoRow | null>> {
  const { data, error } = await supabase
    .from('certificados')
    .select('*')
    .eq('matricula_id', matriculaId)
    .maybeSingle();
  if (error) return fail('CERT_GET', error.message, error);
  return ok(data ?? null);
}

// Mapa matrícula → certificado, para la lista de gerencia (una sola query).
export async function listCertificadosPorCurso(
  cursoId: string,
): Promise<ApiResponse<Record<string, CertificadoRow>>> {
  const { data, error } = await supabase
    .from('certificados')
    .select('*')
    .eq('curso_id', cursoId);
  if (error) return fail('CERT_LIST', error.message, error);
  const acc: Record<string, CertificadoRow> = {};
  for (const c of data ?? []) acc[c.matricula_id] = c;
  return ok(acc);
}

// Emisión manual desde gerencia (idempotente; el motor también la dispara).
export async function emitirCertificado(
  matriculaId: string,
): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.rpc('emitir_certificado', {
    p_matricula_id: matriculaId,
  });
  if (error) return fail('CERT_EMITIR', error.message, error);
  return ok(data as string);
}

export interface VerificacionResultado {
  valido: boolean;
  estado: 'valido' | 'revocado' | 'no_encontrado';
  codigo?: string;
  alumno_nombre?: string;
  curso_titulo?: string;
  instructor_nombre?: string | null;
  nota_examen?: number | null;
  emitido_at?: string;
  revocado_motivo?: string | null;
}

// Verificación pública (sin login). RPC SECURITY DEFINER ejecutable por anon.
export async function verificarCertificado(
  codigo: string,
): Promise<ApiResponse<VerificacionResultado>> {
  const { data, error } = await supabase.rpc('verificar_certificado', {
    p_codigo: codigo,
  });
  if (error) return fail('CERT_VERIFICAR', error.message, error);
  return ok(data as unknown as VerificacionResultado);
}

// URL pública de verificación. Prioridad: base configurada (VITE_PUBLIC_BASE_URL,
// p. ej. el dominio de producción gestionglobal.ar) → origin del browser →
// fallback al dominio de producción. Así el QR del PDF apunta SIEMPRE a una URL
// pública resoluble, aun cuando el certificado se descargue desde un preview de
// Vercel o un entorno local (DGG-13).
export function verificacionUrl(codigo: string): string {
  const configured =
    typeof import.meta !== 'undefined'
      ? (import.meta.env?.VITE_PUBLIC_BASE_URL as string | undefined)
      : undefined;
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : undefined;
  const base = (configured || origin || 'https://gestionglobal.ar').replace(
    /\/+$/,
    '',
  );
  return `${base}/verificar/${codigo}`;
}

// ============================================================================
// Helpers UI
// ============================================================================
export function youtubeIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace(/^\//, '');
      return id || null;
    }
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      // /embed/<id>
      const parts = u.pathname.split('/').filter(Boolean);
      const embedIdx = parts.findIndex((p) => p === 'embed' || p === 'shorts');
      if (embedIdx >= 0 && parts[embedIdx + 1]) return parts[embedIdx + 1] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

export function fmtMoneda(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number(n));
}

export function fmtFecha(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return s;
  }
}

export function fmtFechaHora(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return s;
  }
}
