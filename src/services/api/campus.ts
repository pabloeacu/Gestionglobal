// Subsistema 7 (Documento Maestro): Campus virtual.
// API service · patrón ApiResponse<T> (regla 4, P-API-01). Toda mutación pasa
// por acá; los componentes nunca tocan supabase directo.

import { supabase } from '@/lib/supabase';
import { ok, fail, extractEdgeFnError, type ApiResponse } from '@/lib/errors';
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
export type CursoModuloMaterialRow =
  Database['public']['Tables']['curso_modulo_material']['Row'];
export type CursoExamenRow = Database['public']['Tables']['curso_examenes']['Row'];
export type CursoPreguntaRow = Database['public']['Tables']['curso_preguntas']['Row'];
export type CursoOpcionRow = Database['public']['Tables']['curso_opciones']['Row'];
export type CursoExamenSeccionRow =
  Database['public']['Tables']['curso_examen_secciones']['Row'];
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
  'encuesta',
  'pago',
  'otra',
] as const;
export type CondicionTipo = (typeof CONDICION_TIPOS)[number];

export const CONDICION_TIPO_LABEL: Record<CondicionTipo, string> = {
  examen: 'Aprobar el examen',
  asistencia: 'Asistencia a encuentros',
  encuesta: 'Completar la encuesta de satisfacción',
  pago: 'Pago del curso',
  otra: 'Otra condición',
};

// examen y encuesta son automáticas (se acreditan server-side: examen al aprobar,
// encuesta al responder). El resto las tilda gerencia/instructor manualmente.
export const CONDICION_AUTOMATICA: Record<CondicionTipo, boolean> = {
  examen: true,
  asistencia: false,
  encuesta: true,
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
      material: CursoModuloMaterialRow[];
    }
  >;
  bibliografia: CursoBibliografiaRow[];
  examenes: Array<
    CursoExamenRow & {
      secciones: CursoExamenSeccionRow[];
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
    .select('*, curso_clases(*), curso_modulo_material(*)')
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
    .select('*, curso_examen_secciones(*), curso_preguntas(*, curso_opciones(*))')
    .eq('curso_id', curso.id)
    .order('created_at', { ascending: true });
  if (e4) return fail('CURSO_EXAMENES', e4.message, e4);

  type ModRaw = CursoModuloRow & {
    curso_clases: CursoClaseRow[];
    curso_modulo_material: CursoModuloMaterialRow[];
  };
  type ExRaw = CursoExamenRow & {
    curso_examen_secciones: CursoExamenSeccionRow[];
    curso_preguntas: Array<CursoPreguntaRow & { curso_opciones: CursoOpcionRow[] }>;
  };

  const modulosOrdenados = (modulos as unknown as ModRaw[] | null ?? []).map(
    (m) => ({
      ...(m as CursoModuloRow),
      clases: [...(m.curso_clases ?? [])].sort((a, b) => a.orden - b.orden),
      material: [...(m.curso_modulo_material ?? [])].sort((a, b) =>
        (a.created_at ?? '').localeCompare(b.created_at ?? ''),
      ),
    }),
  );

  const examenesOrdenados = (examenes as unknown as ExRaw[] | null ?? []).map(
    (e) => ({
      ...(e as CursoExamenRow),
      secciones: [...(e.curso_examen_secciones ?? [])].sort(
        (a, b) => a.orden - b.orden,
      ),
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
  curso: Pick<CursoRow, 'id' | 'slug' | 'titulo' | 'modalidad' | 'banner_url'> | null;
  alumno_nombre: string | null;
  administracion_nombre: string | null;
}

export async function listMatriculas(
  params: ListMatriculasParams = {},
): Promise<ApiResponse<MatriculaListItem[]>> {
  let q = supabase
    .from('curso_matriculas')
    .select(
      `*,
       cursos:curso_id(id, slug, titulo, modalidad, banner_url),
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
    cursos: Pick<CursoRow, 'id' | 'slug' | 'titulo' | 'modalidad' | 'banner_url'> | null;
    profiles: { id: string; full_name: string | null } | null;
    administraciones: { id: string; nombre: string } | null;
  };
  let rows: MatriculaListItem[] = (data as unknown as RawRow[] | null ?? []).map(
    (r) => ({
      ...(r as CursoMatriculaRow),
      curso: r.cursos,
      alumno_nombre: r.profiles?.full_name ?? null,
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
  // RPC atómica (regla 4): valida ventana + tope de intentos server-side y
  // serializa arranques concurrentes. Reemplaza el read-then-insert del front.
  const { data, error } = await supabase.rpc('curso_iniciar_intento', {
    p_examen_id: examenId,
    p_matricula_id: matriculaId,
  });
  if (error) return fail('INTENTO_INIT', error.message, error);
  return ok(data as unknown as ExamenIntentoRow);
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
    explicacion: string | null;
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

// Contenido del examen SANITIZADO para que lo rinda el alumno: SIN `correcta`,
// sin retroalimentación y sin explicación (viajan sólo al corregir, vía
// curso_responder_examen). Regla 3 / E-GG-52. Lo provee la RPC SECURITY DEFINER
// curso_examen_rendir; el SELECT directo de preguntas/opciones es staff-only.
export interface ExamenRendirPregunta {
  id: string;
  seccion_id: string | null;
  orden: number;
  tipo: PreguntaTipo;
  enunciado: string;
  puntaje: number;
  opciones: Array<{ id: string; orden: number; texto: string }>;
}
export interface ExamenRendir {
  examen: Pick<
    CursoExamenRow,
    | 'id' | 'curso_id' | 'titulo' | 'descripcion' | 'nota_aprobacion'
    | 'intentos_max' | 'mostrar_resultados' | 'mezclar_preguntas'
    | 'fecha_habilitacion' | 'fecha_cierre'
  >;
  secciones: Array<Pick<CursoExamenSeccionRow, 'id' | 'titulo' | 'descripcion' | 'orden'>>;
  preguntas: ExamenRendirPregunta[];
}

export async function getExamenParaRendir(
  examenId: string,
): Promise<ApiResponse<ExamenRendir>> {
  const { data, error } = await supabase.rpc('curso_examen_rendir', {
    p_examen_id: examenId,
  });
  if (error) return fail('EXAMEN_RENDIR', error.message, error);
  return ok(data as unknown as ExamenRendir);
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

// Clona un curso completo (todo el material: módulos+clases, examen+secciones+
// preguntas+opciones, condiciones, encuentros [sin sala Zoom], bibliografía,
// encuestas) remapeando los FK. NO clona alumnos matriculados ni datos por-alumno.
// El clon nace BORRADOR (activo=false) con slug único y título "… (copia)".
// Backend: RPC curso_duplicar (mig 0222/0223, SECURITY DEFINER + is_staff). Devuelve
// el id del clon. `as any`: la RPC es nueva y aún no está en los types generados.
export async function duplicarCurso(cursoId: string): Promise<ApiResponse<string>> {
  const { data, error } = await (supabase.rpc as any)('curso_duplicar', {
    p_curso_id: cursoId,
  });
  if (error) return fail('CURSO_DUPLICAR', error.message, error);
  return ok(data as string);
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
  patch: Partial<
    Pick<
      CursoModuloRow,
      | 'titulo'
      | 'descripcion'
      | 'orden'
      | 'icono_url'
      | 'docente_nombre'
      | 'docente_foto_url'
      | 'docente_bio'
      | 'docente_cv_url'
      | 'publicado'
      | 'publicar_at'
      | 'despublicar_at'
    >
  >,
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
  instructor_foto_url?: string | null;
  publicado?: boolean;
  publicar_at?: string | null;
  despublicar_at?: string | null;
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
      instructor_foto_url: input.instructor_foto_url ?? null,
      publicado: input.publicado ?? true,
      publicar_at: input.publicar_at ?? null,
      despublicar_at: input.despublicar_at ?? null,
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
// ============================================================================
// Banco de imágenes de docentes (reuso rápido de fotos ya cargadas)
// ============================================================================
export interface DocenteBancoItem {
  nombre: string;
  foto_url: string;
}

// Junta los pares (nombre, foto) de docente ya cargados en CUALQUIER superficie
// del campus que tenga nombre asociado: módulos asincrónicos, condiciones /
// encuentros sincrónicos, instructor del curso, y docentes de webinars (jsonb).
// Permite reutilizar una foto sin volver a subirla. Distinct por
// (nombre.toLowerCase(), foto). R14/E-GG-* : el banco se alimenta de todas las
// fuentes con nombre; `curso_clases` solo guarda foto sin nombre ⇒ no forma un
// item del banco y queda afuera (pero SÍ puede consumir el banco).
export async function listDocentesBanco(): Promise<ApiResponse<DocenteBancoItem[]>> {
  const [m, c, cu, w] = await Promise.all([
    supabase
      .from('curso_modulos')
      .select('docente_nombre, docente_foto_url')
      .not('docente_foto_url', 'is', null)
      .not('docente_nombre', 'is', null),
    supabase
      .from('curso_condiciones_config')
      .select('docente_nombre, docente_foto_url')
      .not('docente_foto_url', 'is', null)
      .not('docente_nombre', 'is', null),
    supabase
      .from('cursos')
      .select('instructor_nombre, instructor_foto_url')
      .not('instructor_foto_url', 'is', null)
      .not('instructor_nombre', 'is', null),
    supabase.from('webinars').select('docentes').not('docentes', 'is', null),
  ]);
  if (m.error) return fail('DOCENTE_BANCO', m.error.message, m.error);
  if (c.error) return fail('DOCENTE_BANCO', c.error.message, c.error);
  if (cu.error) return fail('DOCENTE_BANCO', cu.error.message, cu.error);
  if (w.error) return fail('DOCENTE_BANCO', w.error.message, w.error);
  const pares: Array<{ nombre: unknown; foto: unknown }> = [
    ...(m.data ?? []).map((r) => ({ nombre: r.docente_nombre, foto: r.docente_foto_url })),
    ...(c.data ?? []).map((r) => ({ nombre: r.docente_nombre, foto: r.docente_foto_url })),
    ...(cu.data ?? []).map((r) => ({ nombre: r.instructor_nombre, foto: r.instructor_foto_url })),
  ];
  // webinars.docentes es jsonb [{ nombre, foto_url }]; parseamos defensivo.
  for (const row of w.data ?? []) {
    const arr = (row as { docentes?: unknown }).docentes;
    if (!Array.isArray(arr)) continue;
    for (const d of arr) {
      if (d && typeof d === 'object') {
        const o = d as Record<string, unknown>;
        pares.push({ nombre: o.nombre, foto: o.foto_url });
      }
    }
  }
  const seen = new Set<string>();
  const out: DocenteBancoItem[] = [];
  for (const p of pares) {
    const nombre = (typeof p.nombre === 'string' ? p.nombre : '').trim();
    const foto = (typeof p.foto === 'string' ? p.foto : '').trim();
    if (!nombre || !foto) continue;
    const key = `${nombre.toLowerCase()}|${foto}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ nombre, foto_url: foto });
  }
  out.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return ok(out);
}

export async function crearBibliografia(
  cursoId: string,
  input: {
    titulo: string;
    autor?: string | null;
    url?: string | null;
    archivo_url?: string | null;
    descripcion?: string | null;
    publicado?: boolean;
    publicar_at?: string | null;
    despublicar_at?: string | null;
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
      publicado: input.publicado ?? true,
      publicar_at: input.publicar_at ?? null,
      despublicar_at: input.despublicar_at ?? null,
    })
    .select()
    .single();
  if (error) return fail('BIBLIO_CREATE', error.message, error);
  return ok(data);
}

export async function actualizarBibliografia(
  id: string,
  patch: Partial<
    Pick<
      CursoBibliografiaRow,
      | 'titulo'
      | 'autor'
      | 'url'
      | 'archivo_url'
      | 'descripcion'
      | 'publicado'
      | 'publicar_at'
      | 'despublicar_at'
    >
  >,
): Promise<ApiResponse<CursoBibliografiaRow>> {
  const { data, error } = await supabase
    .from('curso_bibliografia')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('BIBLIO_UPDATE', error.message, error);
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

// ============================================================================
// Material extra por módulo (curso_modulo_material) · opera como bibliografía
// pero a nivel MÓDULO. Al alumno la sección se le muestra sólo si el módulo
// tiene ≥1 ítem (condición de render en CursoDetalleAlumnoPage). Single-table
// → sin RPC (regla 5); RLS espeja curso_clases (mig 0232).
// ============================================================================
export async function crearMaterialModulo(
  moduloId: string,
  input: {
    titulo: string;
    url?: string | null;
    archivo_url?: string | null;
    descripcion?: string | null;
  },
): Promise<ApiResponse<CursoModuloMaterialRow>> {
  const { data, error } = await supabase
    .from('curso_modulo_material')
    .insert({
      modulo_id: moduloId,
      titulo: input.titulo,
      url: input.url ?? null,
      archivo_url: input.archivo_url ?? null,
      descripcion: input.descripcion ?? null,
    })
    .select()
    .single();
  if (error) return fail('MODULO_MATERIAL_CREATE', error.message, error);
  return ok(data);
}

export async function actualizarMaterialModulo(
  id: string,
  patch: Partial<
    Pick<CursoModuloMaterialRow, 'titulo' | 'url' | 'archivo_url' | 'descripcion'>
  >,
): Promise<ApiResponse<CursoModuloMaterialRow>> {
  const { data, error } = await supabase
    .from('curso_modulo_material')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('MODULO_MATERIAL_UPDATE', error.message, error);
  return ok(data);
}

export async function borrarMaterialModulo(
  id: string,
): Promise<ApiResponse<true>> {
  const { error } = await supabase
    .from('curso_modulo_material')
    .delete()
    .eq('id', id);
  if (error) return fail('MODULO_MATERIAL_DELETE', error.message, error);
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
  mostrar_resultados?: boolean;
  mezclar_preguntas?: boolean;
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
      mostrar_resultados: input.mostrar_resultados ?? true,
      mezclar_preguntas: input.mezclar_preguntas ?? false,
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
  explicacion?: string | null;
  seccion_id?: string | null;
  opciones?: Array<{ texto: string; correcta: boolean; retroalimentacion?: string | null }>;
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
      explicacion: input.explicacion ?? null,
      seccion_id: input.seccion_id ?? null,
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
      retroalimentacion: o.retroalimentacion ?? null,
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

// Secciones del examen (DGG-47): agrupan preguntas por tema/instructor.
export interface SeccionInput {
  examen_id: string;
  titulo: string;
  descripcion?: string | null;
  orden?: number;
}

export async function crearSeccion(
  input: SeccionInput,
): Promise<ApiResponse<CursoExamenSeccionRow>> {
  const { data: ord } = await supabase
    .from('curso_examen_secciones')
    .select('orden')
    .eq('examen_id', input.examen_id)
    .order('orden', { ascending: false })
    .limit(1);
  const next = ((ord?.[0]?.orden as number | undefined) ?? 0) + 1;
  const { data, error } = await supabase
    .from('curso_examen_secciones')
    .insert({
      examen_id: input.examen_id,
      titulo: input.titulo,
      descripcion: input.descripcion ?? null,
      orden: input.orden ?? next,
    })
    .select()
    .single();
  if (error) return fail('SECCION_CREATE', error.message, error);
  return ok(data);
}

export async function actualizarSeccion(
  id: string,
  patch: Partial<Omit<SeccionInput, 'examen_id'>>,
): Promise<ApiResponse<CursoExamenSeccionRow>> {
  const { data, error } = await supabase
    .from('curso_examen_secciones')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('SECCION_UPDATE', error.message, error);
  return ok(data);
}

export async function borrarSeccion(id: string): Promise<ApiResponse<true>> {
  // Las preguntas de la sección quedan con seccion_id NULL (ON DELETE SET NULL).
  const { error } = await supabase
    .from('curso_examen_secciones')
    .delete()
    .eq('id', id);
  if (error) return fail('SECCION_DELETE', error.message, error);
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
  // F10 defensa en profundidad: las condiciones de 'asistencia' (módulos
  // sincrónicos) se administran SÓLO en EncuentrosTab; nunca se sincronizan
  // desde acá (evita crear/pisar un módulo fantasma sin modalidad).
  const conds = condiciones.filter((c) => c.tipo !== 'asistencia');
  // 1. Estado actual.
  const { data: actuales, error: e0 } = await supabase
    .from('curso_condiciones_config')
    .select('id')
    .eq('curso_id', cursoId)
    // F10: las condiciones de 'asistencia' (módulos sincrónicos) las administra
    // EncuentrosTab con CRUD fino; el full-sync de CondicionesTab NO las toca.
    .neq('tipo', 'asistencia');
  if (e0) return fail('CONDICIONES_SYNC', e0.message, e0);

  const idsEntrantes = new Set(
    conds.filter((c) => c.id).map((c) => c.id as string),
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
  for (let i = 0; i < conds.length; i++) {
    const c = conds[i]!;
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

  // Condición "Encuesta": si hay una activa, marcamos la encuesta del curso como
  // requerida_para_cert (así el gate y la card del alumno la muestran obligatoria).
  // NO la desactivamos si no hay (otros cursos pueden tener el flag desde la pestaña
  // Encuesta de Satisfacción). El gate del backend igual honra la condición directamente
  // (mig 0227), esto es para el display del alumno + consistencia con la pestaña Encuesta.
  const hayEncuestaActiva = conds.some(
    (c) => c.tipo === 'encuesta' && (c.activa ?? true),
  );
  if (hayEncuestaActiva) {
    const { error: eFlag } = await supabase
      .from('curso_encuestas')
      .update({ requerida_para_cert: true })
      .eq('curso_id', cursoId);
    if (eFlag) return fail('CONDICION_ENCUESTA_FLAG', eFlag.message, eFlag);
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
  /** DGG-19: 'zoom' (default, link externo) o 'webex' (widget embebido) */
  plataforma?: 'zoom' | 'webex';
  /** F10: módulo sincrónico (condición de asistencia) al que pertenece. */
  condicionId?: string | null;
  duracionMin?: number;
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
      plataforma: input.plataforma ?? 'zoom',
      condicion_id: input.condicionId ?? null,
      duracion_min: input.duracionMin ?? undefined,
    })
    .select()
    .single();
  if (error) return fail('ENCUENTRO_CREATE', error.message, error);
  return ok(data);
}

/** Staff: configura manualmente una sala Webex (URL + meeting ID + password).
 *  Webex Free plan no expone API de creación automática como Zoom S2S, así
 *  que el gerente crea la reunión en Webex y nos pasa el join URL.
 */
export async function configurarSalaWebex(input: {
  encuentroId: string;
  joinUrl: string;
  meetingId: string;
  meetingNumber?: string | null;
  password?: string | null;
  duracionMin?: number;
}): Promise<ApiResponse<true>> {
  const { error } = await supabase
    .from('curso_encuentros')
    .update({
      plataforma: 'webex',
      webex_join_url: input.joinUrl,
      webex_meeting_id: input.meetingId,
      webex_meeting_number: input.meetingNumber ?? null,
      webex_password: input.password ?? null,
      webex_status: 'programado',
      duracion_min: input.duracionMin ?? undefined,
    })
    .eq('id', input.encuentroId);
  if (error) return fail('WEBEX_SET', error.message, error);
  return ok(true);
}

export async function actualizarEncuentro(
  id: string,
  patch: Partial<{
    titulo: string;
    descripcion: string | null;
    fecha_hora: string | null;
    link_zoom: string | null;
    condicion_id: string | null;
    duracion_min: number;
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

// ============================================================================
// F10 · Módulos sincrónicos = condición de asistencia con modalidad + docente.
// Cada uno agrupa N encuentros (curso_encuentros.condicion_id) y define cómo se
// computa el cumplimiento (trigger backend mig 0220): unico/alternativos → ≥1
// presente; serie → todos. Reusa el sistema de condiciones del certificado.
// ============================================================================
export type ModalidadSincronica = 'unico' | 'alternativos' | 'serie';

export const MODALIDADES_SINCRONICAS: {
  value: ModalidadSincronica;
  label: string;
  hint: string;
}[] = [
  { value: 'unico', label: 'Encuentro único', hint: 'Un solo encuentro; hay que asistir a ese.' },
  { value: 'alternativos', label: 'Fechas alternativas', hint: 'Varias fechas; basta asistir a UNA.' },
  { value: 'serie', label: 'Serie de encuentros', hint: 'Varios encuentros; hay que asistir a TODOS.' },
];

/** Un módulo sincrónico ES una fila de curso_condiciones_config (tipo='asistencia'). */
export type ModuloSincronicoRow = CursoCondicionConfigRow;

export async function listModulosSincronicos(
  cursoId: string,
): Promise<ApiResponse<ModuloSincronicoRow[]>> {
  const { data, error } = await supabase
    .from('curso_condiciones_config')
    .select('*')
    .eq('curso_id', cursoId)
    .eq('tipo', 'asistencia')
    .order('orden', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return fail('MODULOS_SINC_LIST', error.message, error);
  return ok(data ?? []);
}

export interface ModuloSincronicoInput {
  titulo: string;
  descripcion?: string | null;
  modalidad: ModalidadSincronica;
  obligatoria?: boolean;
}

export async function crearModuloSincronico(
  cursoId: string,
  input: ModuloSincronicoInput,
): Promise<ApiResponse<ModuloSincronicoRow>> {
  const { data: maxRow } = await supabase
    .from('curso_condiciones_config')
    .select('orden')
    .eq('curso_id', cursoId)
    .order('orden', { ascending: false })
    .limit(1)
    .maybeSingle();
  const orden = ((maxRow?.orden as number | undefined) ?? -1) + 1;
  const { data, error } = await supabase
    .from('curso_condiciones_config')
    .insert({
      curso_id: cursoId,
      tipo: 'asistencia',
      etiqueta: input.titulo,
      descripcion: input.descripcion ?? null,
      modalidad: input.modalidad,
      obligatoria: input.obligatoria ?? true,
      automatica: true, // se auto-computa por asistencia a sus encuentros (mig 0220)
      activa: true,
      orden,
    })
    .select()
    .single();
  if (error) return fail('MODULO_SINC_CREATE', error.message, error);
  return ok(data);
}

export async function actualizarModuloSincronico(
  id: string,
  patch: Partial<{
    etiqueta: string;
    descripcion: string | null;
    modalidad: ModalidadSincronica;
    docente_nombre: string | null;
    docente_foto_url: string | null;
    docente_cv_url: string | null;
    obligatoria: boolean;
    activa: boolean;
  }>,
): Promise<ApiResponse<ModuloSincronicoRow>> {
  const { data, error } = await supabase
    .from('curso_condiciones_config')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('MODULO_SINC_UPDATE', error.message, error);
  return ok(data);
}

/** Borra el módulo. Sus encuentros quedan con condicion_id=NULL (FK ON DELETE SET NULL). */
export async function borrarModuloSincronico(id: string): Promise<ApiResponse<true>> {
  const { error } = await supabase
    .from('curso_condiciones_config')
    .delete()
    .eq('id', id);
  if (error) return fail('MODULO_SINC_DELETE', error.message, error);
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
// Fase 3 · Integración Zoom (DGG-14)
// Edge functions:
//   - zoom-encuentro-create : staff crea reunión Zoom y guarda metadata.
//     (F9 · Lista JL 2026-06-08: reemplaza a `zoom-meeting-create`, cuyo cold-start
//      crasheaba por el bundle de supabase-js → OPTIONS 500 sin CORS. La nueva usa
//      fetch crudo a la REST/Auth/RPC de Supabase y bootea OK.)
//   - zoom-sdk-signature   : firma JWT del Web Meeting SDK para join.
// ============================================================================

export interface ZoomMeetingCreated {
  ok: true;
  meeting_id: number;
  join_url: string;
  start_url: string;
  password: string | null;
  topic: string;
}

/** Staff: crea la reunión Zoom asociada al encuentro y persiste IDs en BD. */
export async function crearSalaZoom(input: {
  encuentroId: string;
  duracionMin?: number;
  topic?: string;
  hostEmail?: string;
}): Promise<ApiResponse<ZoomMeetingCreated>> {
  const { data, error } = await supabase.functions.invoke('zoom-encuentro-create', {
    body: {
      encuentro_id: input.encuentroId,
      duracion_min: input.duracionMin,
      topic: input.topic,
      host_email: input.hostEmail,
    },
  });
  if (error) {
    const msg = await extractEdgeFnError(error);
    return fail('ZOOM_CREATE', msg, error);
  }
  if (!data?.ok) return fail('ZOOM_CREATE', data?.error ?? 'Falló crear sala', data);
  return ok(data as ZoomMeetingCreated);
}

/**
 * Staff: borra la reunión Zoom y limpia la metadata del encuentro.
 * Contrapartida de crearSalaZoom (F9-bis · Lista JL). Evita reuniones huérfanas
 * al borrar/regenerar un encuentro. Pasá `encuentroId` (caso normal: borra su
 * reunión + limpia la fila) o `meetingId` (limpieza de huérfanos por ID directo).
 * Idempotente: si la reunión ya no existe en Zoom, igual resuelve OK.
 */
export async function eliminarSalaZoom(input: {
  encuentroId?: string;
  meetingId?: number;
}): Promise<ApiResponse<true>> {
  const { data, error } = await supabase.functions.invoke('zoom-encuentro-delete', {
    body: { encuentro_id: input.encuentroId, meeting_id: input.meetingId },
  });
  if (error) {
    const msg = await extractEdgeFnError(error);
    return fail('ZOOM_DELETE', msg, error);
  }
  if (!data?.ok) return fail('ZOOM_DELETE', data?.error ?? 'Falló borrar la sala', data);
  return ok(true);
}

export interface ZoomSdkSignature {
  signature: string;
  sdkKey: string;
  meetingNumber: string;
  role: 0 | 1;
  customerKey: string | null;
}

/** Pide al edge fn la firma JWT del Web Meeting SDK para joinear al encuentro. */
export async function firmarSdk(input: {
  encuentroId: string;
  role?: 0 | 1;
}): Promise<ApiResponse<ZoomSdkSignature>> {
  const { data, error } = await supabase.functions.invoke('zoom-sdk-signature', {
    body: { encuentro_id: input.encuentroId, role: input.role ?? 0 },
  });
  if (error) {
    const msg = await extractEdgeFnError(error);
    return fail('ZOOM_SIGN', msg, error);
  }
  if (!data?.signature) return fail('ZOOM_SIGN', data?.error ?? 'Sin firma', data);
  return ok(data as ZoomSdkSignature);
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

// DGG-29: forma normalizada del esquema visual (snapshot del cert o fila de BD)
// Los nombres coinciden con EsquemaCert del componente CertificadoPremium.
export interface EsquemaCertSnapshot {
  color_acento: string;
  color_dorado: string;
  visible_marca_logo: boolean;
  marca_logo_url: string | null;
  visible_sigla: boolean;
  sigla_texto: string;
  visible_texto_descriptivo: boolean;
  texto_descriptivo: string;
  visible_leyenda_legal: boolean;
  leyenda_legal: string;
  visible_firma_1: boolean;
  firma_1_img_url: string | null;
  firma_1_nombre: string;
  firma_1_cargo: string;
  visible_firma_2: boolean;
  firma_2_img_url: string | null;
  firma_2_nombre: string;
  firma_2_cargo: string;
  visible_sello: boolean;
  sello_logo_url: string | null;
  visible_watermark: boolean;
  watermark_url: string | null;
}

// Normaliza un row/jsonb del esquema al shape mínimo que consume el render.
function normalizarEsquema(raw: unknown): EsquemaCertSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.color_acento !== 'string') return null;
  return r as unknown as EsquemaCertSnapshot;
}

/**
 * DGG-29 · Resuelve el esquema visual a aplicar al render de un certificado:
 *  1) Si el cert tiene snapshot persistido (esquema_snapshot), lo usa tal cual.
 *  2) Si no (cert legacy o aún no persistido), busca el esquema del origen
 *     (curso o webinar — XOR).
 *  3) Fallback final: esquema default del sistema.
 */
export async function resolverEsquemaParaCert(
  c: CertificadoRow,
): Promise<EsquemaCertSnapshot | null> {
  const snap = normalizarEsquema(c.esquema_snapshot);
  if (snap) return snap;

  let esquemaId: string | null = null;
  if (c.curso_id) {
    const { data } = await supabase
      .from('cursos')
      .select('cert_esquema_id')
      .eq('id', c.curso_id)
      .maybeSingle();
    esquemaId = data?.cert_esquema_id ?? null;
  } else if ((c as { webinar_id?: string | null }).webinar_id) {
    const { data } = await supabase
      .from('webinars')
      .select('cert_esquema_id')
      .eq('id', (c as { webinar_id: string }).webinar_id)
      .maybeSingle();
    esquemaId = data?.cert_esquema_id ?? null;
  }
  if (esquemaId) {
    const { data: e } = await supabase
      .from('certificado_esquemas')
      .select('*')
      .eq('id', esquemaId)
      .maybeSingle();
    const n = normalizarEsquema(e);
    if (n) return n;
  }
  const { data: def } = await supabase
    .from('certificado_esquemas')
    .select('*')
    .eq('es_default', true)
    .maybeSingle();
  return normalizarEsquema(def);
}

// ============================================================================
// DGG-41 (2026-06-02 · José Luis) · Celebración del cert
// ============================================================================
export interface CertCelebrarItem {
  cert_id: string;
  codigo: string;
  curso_id: string;
  curso_titulo: string;
  emitido_at: string;
  link_verificacion: string;
}

/**
 * Lista los certificados del alumno logueado que aún no fueron "celebrados"
 * (banner sin descartar / sin descargar). Para mostrar el banner premium en
 * PortalHome y en el detalle del trámite curso.
 */
export async function listCertsCelebrarCliente(): Promise<ApiResponse<CertCelebrarItem[]>> {
  // RPCs nuevas (mig 0184) — types se regeneran luego.
  const { data, error } = await supabase.rpc('cliente_certs_celebrar' as never);
  if (error) return fail('CERT_CELEBRAR_LIST', error.message, error);
  return ok(((data as unknown) ?? []) as CertCelebrarItem[]);
}

/**
 * Marca un cert como "celebración vista". Se llama al descargar o al cerrar
 * el banner explícitamente. Idempotente (no toca si ya estaba marcado).
 */
export async function marcarCelebracionVista(certId: string): Promise<ApiResponse<true>> {
  const { error } = await supabase.rpc(
    'cert_marcar_celebracion_vista' as never,
    { p_cert_id: certId } as never,
  );
  if (error) return fail('CERT_CELEB_MARCAR', error.message, error);
  return ok(true);
}

/**
 * Obtiene un certificado completo por id (para generar el PDF).
 */
export async function getCertCompleto(certId: string): Promise<ApiResponse<CertificadoRow>> {
  const { data, error } = await supabase
    .from('certificados')
    .select('*')
    .eq('id', certId)
    .single();
  if (error) return fail('CERT_GET', error.message, error);
  return ok(data as CertificadoRow);
}

/**
 * Resuelve el esquema cuando todavía no hay cert emitido (vista previa antes
 * de la emisión). Solo usa el curso → esquema o el default.
 */
export async function resolverEsquemaPorCurso(
  cursoId: string,
): Promise<EsquemaCertSnapshot | null> {
  const { data } = await supabase
    .from('cursos')
    .select('cert_esquema_id')
    .eq('id', cursoId)
    .maybeSingle();
  const esquemaId = data?.cert_esquema_id;
  if (esquemaId) {
    const { data: e } = await supabase
      .from('certificado_esquemas')
      .select('*')
      .eq('id', esquemaId)
      .maybeSingle();
    const n = normalizarEsquema(e);
    if (n) return n;
  }
  const { data: def } = await supabase
    .from('certificado_esquemas')
    .select('*')
    .eq('es_default', true)
    .maybeSingle();
  return normalizarEsquema(def);
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
  for (const c of data ?? []) {
    if (c.matricula_id) acc[c.matricula_id] = c;
  }
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

// ============================================================================
// L1 (mig 0140) · Imágenes + publicación
// ============================================================================

/**
 * ¿El recurso es visible para el alumno ahora mismo?
 * Mismas reglas que `public.is_visible_for_alumno(...)` en BD:
 *   - publicado=false ⇒ NO visible.
 *   - publicar_at en el futuro ⇒ NO visible.
 *   - despublicar_at en el pasado ⇒ NO visible.
 */
export function esVisibleAlumno(
  obj: {
    publicado?: boolean | null;
    publicar_at?: string | null;
    despublicar_at?: string | null;
  } | null | undefined,
): boolean {
  if (!obj) return false;
  if (obj.publicado === false) return false;
  const now = Date.now();
  if (obj.publicar_at && new Date(obj.publicar_at).getTime() > now) return false;
  if (obj.despublicar_at && new Date(obj.despublicar_at).getTime() <= now) return false;
  return true;
}

/** Etiqueta corta del estado de publicación, útil en chips de gerencia. */
export function estadoPublicacion(
  obj: {
    publicado?: boolean | null;
    publicar_at?: string | null;
    despublicar_at?: string | null;
  } | null | undefined,
): {
  tone: 'emerald' | 'slate' | 'amber' | 'rose';
  label: string;
} {
  if (!obj) return { tone: 'slate', label: 'Borrador' };
  const now = Date.now();
  if (obj.publicado === false) return { tone: 'slate', label: 'Borrador' };
  if (obj.publicar_at && new Date(obj.publicar_at).getTime() > now) {
    return { tone: 'amber', label: 'Programado' };
  }
  if (obj.despublicar_at && new Date(obj.despublicar_at).getTime() <= now) {
    return { tone: 'rose', label: 'Despublicado' };
  }
  return { tone: 'emerald', label: 'Publicado' };
}

export type CampusMediaScope =
  | 'curso-banner'
  | 'curso-instructor'
  | 'modulo-icono'
  | 'modulo-docente'
  | 'clase-instructor'
  | 'modulo-docente-cv'
  | 'biblio-archivo'
  | 'modulo-material'
  // F6 (DGG-63) · Webinars con esquema rico. Reusamos el bucket campus-media
  // (público, policy campus_media_write_staff path-agnóstica) para el banner
  // del webinar y las fotos del roster de docentes. R20: el upload pasa por
  // uploadCampusMedia → safeStorageKey.
  | 'webinar-banner'
  | 'webinar-docente'
  // F10 · docente del módulo sincrónico (foto + CV), patrón módulos DGG-50/51.
  | 'encuentro-docente'
  | 'encuentro-docente-cv';

/**
 * Sube una imagen al bucket público `campus-media` y devuelve la URL pública.
 * Path determinístico: `{scope}/{ownerId}/{timestamp}-{filename}`.
 * Cada subida sobreescribe la anterior si tiene la misma key (upsert=true).
 */
export async function uploadCampusMedia(
  scope: CampusMediaScope,
  ownerId: string,
  file: File,
): Promise<ApiResponse<string>> {
  // E-GG-40 sweep · safeStorageKey normaliza NFKD y quita diacríticos
  const { safeStorageKey } = await import('@/lib/storageKeys');
  const path = `${scope}/${ownerId}/${Date.now()}-${safeStorageKey(file.name)}`;
  const up = await supabase.storage
    .from('campus-media')
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (up.error) return fail('CAMPUS_MEDIA_UPLOAD', up.error.message, up.error);
  const { data } = supabase.storage.from('campus-media').getPublicUrl(path);
  return ok(data.publicUrl);
}

/**
 * Borra una URL pública del bucket `campus-media`.
 * Convierte la URL pública en path interno y borra. Silencioso si no existe.
 */
export async function deleteCampusMedia(publicUrl: string | null | undefined): Promise<void> {
  if (!publicUrl) return;
  const marker = '/storage/v1/object/public/campus-media/';
  const idx = publicUrl.indexOf(marker);
  if (idx < 0) return;
  const path = publicUrl.slice(idx + marker.length);
  await supabase.storage.from('campus-media').remove([path]);
}
