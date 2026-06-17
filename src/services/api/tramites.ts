import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database, Json } from '@/types/database';

// ============================================================================
// Tipos
// ============================================================================
export type TramiteRow = Database['public']['Tables']['tramites']['Row'];
export type TramiteComentarioRow =
  Database['public']['Tables']['tramite_comentarios']['Row'];
export type TramiteEventoRow =
  Database['public']['Tables']['tramite_eventos']['Row'];
export type TramiteAdjuntoRow =
  Database['public']['Tables']['tramite_adjuntos']['Row'];

export const TRAMITE_ESTADOS = [
  'abierto',
  'en_progreso',
  'esperando_cliente',
  'resuelto',
  'cerrado',
  'cancelado',
] as const;
export type TramiteEstado = (typeof TRAMITE_ESTADOS)[number];

export const TRAMITE_PRIORIDADES = ['baja', 'normal', 'alta', 'urgente'] as const;
export type TramitePrioridad = (typeof TRAMITE_PRIORIDADES)[number];

export const TRAMITE_CATEGORIAS = [
  'matricula',
  'dj',
  'consulta_juridica',
  'renovacion',
  'curso',
  'reclamo',
  'otro',
] as const;
export type TramiteCategoria = (typeof TRAMITE_CATEGORIAS)[number];

export const TRAMITE_ESTADO_LABEL: Record<TramiteEstado, string> = {
  abierto: 'Abierto',
  en_progreso: 'En progreso',
  esperando_cliente: 'Esperando cliente',
  resuelto: 'Resuelto',
  cerrado: 'Cerrado',
  cancelado: 'Cancelado',
};

export const TRAMITE_PRIORIDAD_LABEL: Record<TramitePrioridad, string> = {
  baja: 'Baja',
  normal: 'Normal',
  alta: 'Alta',
  urgente: 'Urgente',
};

export const TRAMITE_CATEGORIA_LABEL: Record<TramiteCategoria, string> = {
  matricula: 'Matrícula',
  dj: 'DJ jurada',
  consulta_juridica: 'Consulta jurídica',
  renovacion: 'Renovación',
  curso: 'Curso',
  reclamo: 'Reclamo',
  otro: 'Otro',
};

// ============================================================================
// DGG-38 EXT (2026-06-02 · José Luis) · Catálogo de motivos de cierre por
// categoría de trámite. La RPC `tracking_cerrar` admite motivo libre (text)
// pero el frontend ofrece estos predeterminados como guía. Cada motivo tiene
// `satisfactorio` (resultado positivo o frustrado) y `requiere_documento`
// (true para "Concluyó el curso", "Matrícula otorgada", "Trámite resuelto"
// — donde el adjunto es importante para constancia).
// ============================================================================
export interface MotivoCierreOpcion {
  value: string;          // texto persistido en tramites.motivo_cierre
  label: string;          // copy mostrado en UI
  satisfactorio: boolean; // true = resuelto OK; false = frustrado
  requiere_documento: boolean;  // true → mostrar/forzar paso de adjunto
  /**
   * Tipo del documento esperado — controla el badge en el dialog y el copy
   * del campo de adjunto. José Luis (2026-06-02) marcó la distinción:
   *   - 'certificado': solo los 3 cursos (formación RPAC, actualización RPAC,
   *      actualización RPA) emiten certificado/diploma propiamente dicho.
   *   - 'constancia':  matriculación, renovación de matrícula y DDJJ tienen
   *      "constancia de gestoría" (el documento que la administración
   *      pública entrega al cerrar el trámite).
   *   - 'documento':   genérico para cuando no es ni certificado ni constancia
   *      pero igual conviene adjuntar (resoluciones, dictámenes, etc).
   */
  tipo_documento?: 'certificado' | 'constancia' | 'documento';
  descripcion?: string;   // tooltip / hint en UI
}

const MOTIVOS_CURSO: MotivoCierreOpcion[] = [
  {
    value: 'Concluyó el curso',
    label: 'Concluyó el curso',
    satisfactorio: true,
    requiere_documento: true,
    tipo_documento: 'certificado',
    descripcion: 'El alumno aprobó. Adjuntá el certificado o diploma.',
  },
  {
    value: 'Abandonó el curso',
    label: 'Abandonó el curso',
    satisfactorio: false,
    requiere_documento: false,
    descripcion: 'El alumno dejó de cursar antes de finalizar.',
  },
  {
    value: 'Desaprobó',
    label: 'Desaprobó',
    satisfactorio: false,
    requiere_documento: false,
    descripcion: 'El alumno no alcanzó las condiciones para aprobar.',
  },
  {
    value: 'Se arrepintió o se equivocó en la solicitud',
    label: 'Se arrepintió o se equivocó en la solicitud',
    satisfactorio: false,
    requiere_documento: false,
  },
];

const MOTIVOS_MATRICULA: MotivoCierreOpcion[] = [
  {
    value: 'Matrícula otorgada',
    label: 'Matrícula otorgada',
    satisfactorio: true,
    requiere_documento: true,
    tipo_documento: 'constancia',
    descripcion: 'Adjuntá la constancia de gestoría / resolución del organismo.',
  },
  {
    value: 'Matrícula rechazada',
    label: 'Matrícula rechazada',
    satisfactorio: false,
    requiere_documento: false,
  },
  {
    value: 'Abandono del trámite',
    label: 'Abandono del trámite',
    satisfactorio: false,
    requiere_documento: false,
  },
];

const MOTIVOS_RENOVACION: MotivoCierreOpcion[] = [
  {
    value: 'Renovación otorgada',
    label: 'Renovación otorgada',
    satisfactorio: true,
    requiere_documento: true,
    tipo_documento: 'constancia',
    descripcion: 'Adjuntá la constancia de gestoría de la renovación.',
  },
  {
    value: 'Renovación rechazada',
    label: 'Renovación rechazada',
    satisfactorio: false,
    requiere_documento: false,
  },
  {
    value: 'Abandono del trámite',
    label: 'Abandono del trámite',
    satisfactorio: false,
    requiere_documento: false,
  },
];

const MOTIVOS_DJ: MotivoCierreOpcion[] = [
  {
    value: 'DDJJ presentada',
    label: 'DDJJ presentada',
    satisfactorio: true,
    requiere_documento: true,
    tipo_documento: 'constancia',
    descripcion: 'Adjuntá la constancia de gestoría / acuse de presentación.',
  },
  {
    value: 'DDJJ rechazada',
    label: 'DDJJ rechazada',
    satisfactorio: false,
    requiere_documento: false,
  },
  {
    value: 'Abandono del trámite',
    label: 'Abandono del trámite',
    satisfactorio: false,
    requiere_documento: false,
  },
];

const MOTIVOS_GENERICOS: MotivoCierreOpcion[] = [
  {
    value: 'Satisfactorio',
    label: 'Satisfactorio',
    satisfactorio: true,
    requiere_documento: false,
    descripcion: 'Trámite resuelto con el resultado esperado.',
  },
  {
    value: 'Sin éxito',
    label: 'Sin éxito',
    satisfactorio: false,
    requiere_documento: false,
    descripcion: 'No se obtuvo el resultado esperado.',
  },
  {
    value: 'Abandono del trámite',
    label: 'Abandono del trámite',
    satisfactorio: false,
    requiere_documento: false,
  },
];

export const MOTIVOS_CIERRE_POR_CATEGORIA: Record<TramiteCategoria, MotivoCierreOpcion[]> = {
  curso: MOTIVOS_CURSO,
  matricula: MOTIVOS_MATRICULA,
  renovacion: MOTIVOS_RENOVACION,
  dj: MOTIVOS_DJ,
  consulta_juridica: MOTIVOS_GENERICOS,
  reclamo: MOTIVOS_GENERICOS,
  otro: MOTIVOS_GENERICOS,
};

/** Mapea tipo_documento a label humano para el badge del dialog y el campo. */
export function tipoDocumentoLabel(tipo: MotivoCierreOpcion['tipo_documento']): string {
  switch (tipo) {
    case 'certificado': return 'Certificado';
    case 'constancia':  return 'Constancia';
    case 'documento':   return 'Documento';
    default:            return 'Adjunto';
  }
}

// El siguiente estado natural cuando hacés "Avanzar" desde la kanban / la card.
export const NEXT_ESTADO: Record<TramiteEstado, TramiteEstado | null> = {
  abierto: 'en_progreso',
  en_progreso: 'esperando_cliente',
  esperando_cliente: 'resuelto',
  resuelto: 'cerrado',
  cerrado: null,
  cancelado: null,
};

// DGG-44 · Orden canónico de la pipeline para detectar AVANCES (forward).
// `cancelado` = -1 → mover a/desde cancelado no es "avanzar".
export const ESTADO_ORDEN: Record<TramiteEstado, number> = {
  abierto: 0,
  en_progreso: 1,
  esperando_cliente: 2,
  resuelto: 3,
  cerrado: 4,
  cancelado: -1,
};

// DGG-44 · ¿El cambio `from → to` avanza la gestión hacia el cierre?
// Sólo los avances disparan el gate de cobranza (no las regresiones ni
// los movimientos a/desde cancelado).
export function esAvanceTramite(
  from: TramiteEstado,
  to: TramiteEstado,
): boolean {
  const a = ESTADO_ORDEN[from];
  const b = ESTADO_ORDEN[to];
  return a >= 0 && b >= 0 && b > a;
}

// ============================================================================
// List + filtros (gerencia)
// ============================================================================
export interface TramiteListItem extends TramiteRow {
  administracion_nombre: string | null;
  consorcio_nombre: string | null;
  asignado_nombre: string | null;
  // F8 (DGG-64) · nombre del servicio del catálogo (para el multiselect de
  // filtros). Null si el trámite no tiene servicio vinculado.
  servicio_nombre: string | null;
  // DGG-44 · computed column (Postgrest). TRUE si el trámite tiene un
  // comprobante con costo (total>0) e impago (saldo>0). Señal del gate de
  // cobranza al avanzar en el kanban. Sólo lo solicita listTramites.
  cobro_pendiente: boolean;
  // DGG-88 · computed column (Postgrest). Diferencia el MOTIVO del cobro pendiente
  // para el copy del gate: 'parcial' (hay pago a cuenta, queda saldo) vs
  // 'sin_cobranza' (impago, sin ningún pago). NULL si no hay saldo pendiente.
  cobro_estado: 'parcial' | 'sin_cobranza' | null;
  // DGG-55 · computed column (Postgrest). TRUE si el trámite no es terminal y NO
  // tiene comprobante no-anulado vinculado (capta DDJJ + huecos). Chip + filtro.
  comprobante_pendiente: boolean;
}

export interface ListTramitesParams {
  search?: string;
  estado?: TramiteEstado | 'todos';
  estados?: TramiteEstado[];  // para kanban (varios estados)
  categoria?: TramiteCategoria | 'todos';
  prioridad?: TramitePrioridad | 'todos';
  administracionId?: string;
  // DGG-33 (2026-06-02): se eliminó `asignadoA`. Gestión Global no tiene
  // asignaciones individuales — todos los gerentes ven todo. Mantenemos el
  // JOIN `asignado` por compatibilidad con trámites históricos importados
  // pero ningún caller debe filtrar por persona.
  limit?: number;
  offset?: number;
}

interface RawListRow extends TramiteRow {
  administraciones: { id: string; nombre: string } | null;
  consorcios: { id: string; nombre: string } | null;
  asignado: { id: string; full_name: string | null } | null;
  servicios?: { id: string; nombre: string } | null; // F8 · sólo en listTramites
  cobro_pendiente?: boolean | null; // DGG-44 · sólo presente en listTramites
  cobro_estado?: 'parcial' | 'sin_cobranza' | null; // DGG-88 · idem
  comprobante_pendiente?: boolean | null; // DGG-55 · idem
}

function mapRaw(r: RawListRow): TramiteListItem {
  return {
    ...(r as TramiteRow),
    administracion_nombre: r.administraciones?.nombre ?? null,
    consorcio_nombre: r.consorcios?.nombre ?? null,
    asignado_nombre: r.asignado?.full_name ?? null,
    servicio_nombre: r.servicios?.nombre ?? null,
    cobro_pendiente: r.cobro_pendiente ?? false,
    cobro_estado: r.cobro_estado ?? null,
    comprobante_pendiente: r.comprobante_pendiente ?? false,
  };
}

export async function listTramites(
  params: ListTramitesParams = {},
): Promise<ApiResponse<{ rows: TramiteListItem[]; total: number }>> {
  const limit = params.limit ?? 200;
  const offset = params.offset ?? 0;

  let q = supabase
    .from('tramites')
    .select(
      `*,
       cobro_pendiente,
       cobro_estado,
       comprobante_pendiente,
       administraciones(id,nombre),
       consorcios(id,nombre),
       servicios(id,nombre),
       asignado:profiles!tramites_asignado_a_fkey(id,full_name)`,
      { count: 'exact' },
    )
    .order('ultima_actividad_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (params.estado && params.estado !== 'todos') {
    q = q.eq('estado', params.estado);
  }
  if (params.estados && params.estados.length > 0) {
    q = q.in('estado', params.estados);
  }
  if (params.categoria && params.categoria !== 'todos') {
    q = q.eq('categoria', params.categoria);
  }
  if (params.prioridad && params.prioridad !== 'todos') {
    q = q.eq('prioridad', params.prioridad);
  }
  if (params.administracionId) {
    q = q.eq('administracion_id', params.administracionId);
  }
  // DGG-33: removido filtro por asignado_a (ver ListTramitesParams).
  if (params.search && params.search.trim().length > 0) {
    const s = params.search.trim();
    q = q.or(
      `titulo.ilike.%${s}%,codigo.ilike.%${s}%,solicitante_nombre.ilike.%${s}%,solicitante_email.ilike.%${s}%`,
    );
  }

  const { data, error, count } = await q;
  if (error) return fail('TRAMITES_LIST', error.message, error);
  return ok({
    rows: (data as unknown as RawListRow[] | null)?.map(mapRaw) ?? [],
    total: count ?? 0,
  });
}

// ============================================================================
// Mis trámites (portal del administrador)
// ============================================================================
export async function listMisTramites(): Promise<ApiResponse<TramiteListItem[]>> {
  const { data, error } = await supabase
    .from('tramites')
    .select(
      `*,
       administraciones(id,nombre),
       consorcios(id,nombre),
       asignado:profiles!tramites_asignado_a_fkey(id,full_name)`,
    )
    .order('ultima_actividad_at', { ascending: false });
  if (error) return fail('TRAMITES_MIS', error.message, error);
  return ok(
    (data as unknown as RawListRow[] | null)?.map(mapRaw) ?? [],
  );
}

// ============================================================================
// Detalle de un trámite (con relaciones)
// ============================================================================
export interface TramiteDetail extends TramiteRow {
  administracion: { id: string; nombre: string } | null;
  consorcio: { id: string; nombre: string } | null;
  comprobante: {
    id: string;
    tipo: string;
    punto_venta: number;
    numero: number | null;
    total: number;
  } | null;
  submission: {
    id: string;
    formulario_id: string;
    datos: Json;
    created_at: string;
  } | null;
  asignado: { id: string; full_name: string | null; avatar_url: string | null } | null;
  creador: { id: string; full_name: string | null } | null;
  resolutor: { id: string; full_name: string | null } | null;
  comentarios: TramiteComentarioRow[];
  eventos: TramiteEventoRow[];
  adjuntos: TramiteAdjuntoRow[];
}

export async function getTramite(id: string): Promise<ApiResponse<TramiteDetail>> {
  const { data: t, error: e1 } = await supabase
    .from('tramites')
    .select(
      `*,
       administracion:administraciones(id,nombre),
       consorcio:consorcios(id,nombre),
       comprobante:comprobantes(id,tipo,punto_venta,numero,total),
       submission:formulario_submissions(id,formulario_id,datos,created_at),
       asignado:profiles!tramites_asignado_a_fkey(id,full_name,avatar_url),
       creador:profiles!tramites_created_by_fkey(id,full_name),
       resolutor:profiles!tramites_resuelto_por_fkey(id,full_name)`,
    )
    .eq('id', id)
    .single();
  if (e1) return fail('TRAMITE_GET', e1.message, e1);

  const [coms, evs, adjs] = await Promise.all([
    supabase
      .from('tramite_comentarios')
      .select('*')
      .eq('tramite_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('tramite_eventos')
      .select('*')
      .eq('tramite_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('tramite_adjuntos')
      .select('*')
      .eq('tramite_id', id)
      .order('uploaded_at', { ascending: false }),
  ]);

  if (coms.error) return fail('TRAMITE_COMS', coms.error.message, coms.error);
  if (evs.error) return fail('TRAMITE_EVS', evs.error.message, evs.error);
  if (adjs.error) return fail('TRAMITE_ADJ', adjs.error.message, adjs.error);

  return ok({
    ...(t as unknown as TramiteRow & {
      administracion: TramiteDetail['administracion'];
      consorcio: TramiteDetail['consorcio'];
      comprobante: TramiteDetail['comprobante'];
      submission: TramiteDetail['submission'];
      asignado: TramiteDetail['asignado'];
      creador: TramiteDetail['creador'];
      resolutor: TramiteDetail['resolutor'];
    }),
    comentarios: coms.data ?? [],
    eventos: evs.data ?? [],
    adjuntos: adjs.data ?? [],
  });
}

// ============================================================================
// CREATE / UPDATE
// ============================================================================
export interface CreateTramiteInput {
  titulo: string;
  descripcion?: string | null;
  categoria: TramiteCategoria;
  prioridad?: TramitePrioridad;
  administracion_id?: string | null;
  consorcio_id?: string | null;
  comprobante_id?: string | null;
  // DGG-33: removido `asignado_a` (sin asignaciones individuales). Insert
  // queda con asignado_a NULL por default de Postgres.
  vence_at?: string | null;
  solicitante_nombre?: string | null;
  solicitante_email?: string | null;
  solicitante_telefono?: string | null;
}

export async function createTramite(
  input: CreateTramiteInput,
): Promise<ApiResponse<TramiteRow>> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('tramites')
    .insert({
      titulo: input.titulo,
      descripcion: input.descripcion ?? null,
      categoria: input.categoria,
      prioridad: input.prioridad ?? 'normal',
      administracion_id: input.administracion_id ?? null,
      consorcio_id: input.consorcio_id ?? null,
      comprobante_id: input.comprobante_id ?? null,
      vence_at: input.vence_at ?? null,
      solicitante_nombre: input.solicitante_nombre ?? null,
      solicitante_email: input.solicitante_email ?? null,
      solicitante_telefono: input.solicitante_telefono ?? null,
      created_by: auth.user?.id ?? null,
      // codigo es generado por trigger; lo pasamos vacío para que el trigger lo
      // complete (el campo es NOT NULL pero el trigger lo setea BEFORE INSERT).
      codigo: '',
    })
    .select()
    .single();
  if (error) return fail('TRAMITE_CREATE', error.message, error);
  return ok(data);
}

export type UpdateTramitePatch = Partial<{
  titulo: string;
  descripcion: string | null;
  categoria: TramiteCategoria;
  prioridad: TramitePrioridad;
  estado: TramiteEstado;
  administracion_id: string | null;
  consorcio_id: string | null;
  comprobante_id: string | null;
  // DGG-33: removido asignado_a.
  vence_at: string | null;
  // DEEP-1: datos del solicitante editables post-alta (drawer
  // TrackingMetadataDrawer). Antes solo se podían setear en createTramite.
  solicitante_nombre: string | null;
  solicitante_email: string | null;
  solicitante_telefono: string | null;
}>;

// DGG-34 R4 sweep · lectura puntual del administracion_id de un trámite
// (WizardActivacion la usa post-alta para decidir si dispara email de
// bienvenida al cliente). Evita traer el detalle completo.
export async function getTramiteAdministracionId(
  id: string,
): Promise<ApiResponse<string | null>> {
  const { data, error } = await supabase
    .from('tramites')
    .select('administracion_id')
    .eq('id', id)
    .maybeSingle();
  if (error) return fail('TRAMITE_GET_ADMIN_ID', error.message, error);
  return ok(data?.administracion_id ?? null);
}

export async function updateTramite(
  id: string,
  patch: UpdateTramitePatch,
): Promise<ApiResponse<TramiteRow>> {
  const { data, error } = await supabase
    .from('tramites')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return fail('TRAMITE_UPDATE', error.message, error);
  return ok(data);
}

// ============================================================================
// Comentarios
// ============================================================================
export async function addComentario(
  tramite_id: string,
  contenido: string,
  visible_para: 'cliente' | 'staff' | 'todos' = 'todos',
): Promise<ApiResponse<TramiteComentarioRow>> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail('NO_SESSION', 'Sin sesión activa');

  // Obtenemos role + nombre para snapshot
  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('role, full_name')
    .eq('id', auth.user.id)
    .single();
  if (pErr) return fail('PROFILE_LOAD', pErr.message, pErr);

  const autor_role = (profile?.role ?? 'sistema') as
    | 'gerente'
    | 'operador'
    | 'administrador'
    | 'sistema';

  // Si es administrador, RLS exige visible_para='todos'
  const effective_visible: 'cliente' | 'staff' | 'todos' =
    autor_role === 'administrador' ? 'todos' : visible_para;

  const { data, error } = await supabase
    .from('tramite_comentarios')
    .insert({
      tramite_id,
      contenido,
      visible_para: effective_visible,
      autor_id: auth.user.id,
      autor_nombre: profile?.full_name ?? auth.user.email ?? 'Usuario',
      autor_role,
    })
    .select()
    .single();
  if (error) return fail('COM_INSERT', error.message, error);
  return ok(data);
}

// ============================================================================
// Adjuntos
// ============================================================================
export async function subirAdjunto(
  tramite_id: string,
  file: File,
): Promise<ApiResponse<TramiteAdjuntoRow>> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail('NO_SESSION', 'Sin sesión activa');

  // E-GG-40 sweep
  const { safeStorageKey } = await import('@/lib/storageKeys');
  const storage_path = `${tramite_id}/${Date.now()}_${safeStorageKey(file.name)}`;

  const upload = await supabase.storage
    .from('tramite-adjuntos')
    .upload(storage_path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    });
  if (upload.error) return fail('UPLOAD', upload.error.message, upload.error);

  const { data, error } = await supabase
    .from('tramite_adjuntos')
    .insert({
      tramite_id,
      storage_path,
      filename_original: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      subido_por: auth.user.id,
    })
    .select()
    .single();
  if (error) {
    // best-effort: limpiar el blob que quedó huérfano
    await supabase.storage.from('tramite-adjuntos').remove([storage_path]);
    return fail('ADJ_INSERT', error.message, error);
  }
  return ok(data);
}

export async function urlFirmadaAdjunto(
  storage_path: string,
  segundos = 600,
): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.storage
    .from('tramite-adjuntos')
    .createSignedUrl(storage_path, segundos);
  if (error) return fail('SIGN_URL', error.message, error);
  return ok(data.signedUrl);
}

// DGG-38 (2026-06-02) · Sube el documento final que cierra el trámite
// (certificado, diploma, PDF de aprobación, etc.). Bucket público con URL
// estable porque la URL se comparte con el cliente en su tracking.
export async function subirDocumentoFinalTramite(
  tramite_id: string,
  file: File,
): Promise<ApiResponse<string>> {
  // E-GG-40 sweep
  const { safeStorageKey } = await import('@/lib/storageKeys');
  const path = `${tramite_id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeStorageKey(file.name)}`;
  const { error } = await supabase.storage
    .from('tramite-documento-final')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    });
  if (error) return fail('UPLOAD_DOC_FINAL', error.message, error);
  const { data } = supabase.storage
    .from('tramite-documento-final')
    .getPublicUrl(path);
  return ok(data.publicUrl);
}

export async function eliminarAdjunto(
  adjunto: TramiteAdjuntoRow,
): Promise<ApiResponse<true>> {
  const { error: e1 } = await supabase
    .from('tramite_adjuntos')
    .delete()
    .eq('id', adjunto.id);
  if (e1) return fail('ADJ_DELETE', e1.message, e1);

  // best-effort: borrar el blob
  await supabase.storage
    .from('tramite-adjuntos')
    .remove([adjunto.storage_path]);
  return ok(true);
}

// ============================================================================
// RPC: crear trámite desde submission
// ============================================================================
export async function crearTramiteDesdeSubmission(
  submission_id: string,
  categoria: TramiteCategoria,
  asignado_a?: string | null,
  titulo?: string | null,
  prioridad: TramitePrioridad = 'normal',
): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.rpc('crear_tramite_desde_submission', {
    p_submission_id: submission_id,
    p_categoria: categoria,
    p_asignado_a: asignado_a ?? undefined,
    p_titulo: titulo ?? undefined,
    p_prioridad: prioridad,
  });
  if (error) return fail('RPC_DESDE_SUB', error.message, error);
  return ok(data as string);
}

// ============================================================================
// Incrementar vistas (analytics light)
// ============================================================================
export async function incrementarVistas(id: string): Promise<ApiResponse<true>> {
  const { error } = await supabase.rpc('tramite_incrementar_vistas', {
    p_tramite_id: id,
  });
  if (error) return fail('VIEWS', error.message, error);
  return ok(true);
}

// ============================================================================
// Helpers de UI
// ============================================================================
export interface SlaInfo {
  diasRestantes: number | null;  // null si no hay vence_at
  vencido: boolean;
  diasAbierto: number;
}

export function computeSla(t: TramiteRow): SlaInfo {
  const now = Date.now();
  const created = new Date(t.created_at).getTime();
  const diasAbierto = Math.max(
    0,
    Math.floor((now - created) / (1000 * 60 * 60 * 24)),
  );
  if (!t.vence_at) return { diasRestantes: null, vencido: false, diasAbierto };
  const vence = new Date(t.vence_at).getTime();
  const diff = vence - now;
  const dias = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return {
    diasRestantes: dias,
    vencido: diff < 0 && t.estado !== 'resuelto' && t.estado !== 'cerrado',
    diasAbierto,
  };
}
