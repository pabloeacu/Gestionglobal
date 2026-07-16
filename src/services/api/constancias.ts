import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, type ApiResponse } from '@/lib/errors';
import { safeStorageKey } from '@/lib/storageKeys';
import type { Database } from '@/types/database';

// ============================================================================
// Constancias de inscripción (chunk CONST · a demanda, DGG).
// Hermanas del certificado pero con su propia tabla/RPCs — el flujo del diploma
// NO se toca (mandato Pablo). El PDF se genera browser-side con la misma
// tecnología (ver ../modules/campus/lib/generateConstanciaPdf.ts) y se guarda
// en el MISMO bucket privado 'certificados' bajo el prefijo `constancia/`.
// ============================================================================

export type ConstanciaRow = Database['public']['Tables']['constancias']['Row'];

/** Datos del alumno/curso que alimentan las variables de la constancia.
 *  Fuente canónica del apellido/nombre/DNI: administraciones.responsable_* */
export interface DatosConstanciaAlumno {
  matricula_id: string;
  curso_id: string;
  curso_titulo: string;
  administracion_id: string | null;
  nombre: string;
  apellido: string;
  dni: string;
  email_contacto: string | null;
}

export async function getDatosConstancia(
  matriculaId: string,
): Promise<ApiResponse<DatosConstanciaAlumno>> {
  const { data, error } = await supabase
    .from('curso_matriculas')
    .select(
      `id, curso_id, administracion_id,
       cursos:curso_id(titulo),
       administraciones(responsable_nombre, responsable_apellido, responsable_dni, email)`,
    )
    .eq('id', matriculaId)
    .maybeSingle();
  if (error) return fail('CONST_DATOS', error.message, error);
  if (!data) return fail('NOT_FOUND', 'Matrícula no encontrada');
  const r = data as unknown as {
    id: string;
    curso_id: string;
    administracion_id: string | null;
    cursos: { titulo: string } | null;
    administraciones: {
      responsable_nombre: string | null;
      responsable_apellido: string | null;
      responsable_dni: string | null;
      email: string | null;
    } | null;
  };
  return ok({
    matricula_id: r.id,
    curso_id: r.curso_id,
    curso_titulo: r.cursos?.titulo ?? '',
    administracion_id: r.administracion_id,
    nombre: r.administraciones?.responsable_nombre ?? '',
    apellido: r.administraciones?.responsable_apellido ?? '',
    dni: r.administraciones?.responsable_dni ?? '',
    email_contacto: r.administraciones?.email ?? null,
  });
}

/** Emite la constancia (snapshot server-side · RPC staff-only, regla 5/18). */
export async function emitirConstancia(input: {
  matriculaId: string;
  esquemaId: string;
  textoFinal: string;
  destinatarioFinal: string | null;
}): Promise<ApiResponse<{ id: string; codigo: string }>> {
  const { data, error } = await supabase.rpc('emitir_constancia', {
    p_matricula_id: input.matriculaId,
    p_esquema_id: input.esquemaId,
    p_texto_final: input.textoFinal,
    p_destinatario_final: input.destinatarioFinal ?? undefined,
  });
  if (error) return fail('CONST_EMITIR', error.message, error);
  const r = data as { id: string; codigo: string };
  return ok(r);
}

/** Sube el PDF renderizado al bucket privado 'certificados' (prefijo propio).
 *  R20: el nombre del archivo pasa por safeStorageKey. */
export async function uploadConstanciaPdf(
  constanciaId: string,
  codigo: string,
  blob: Blob,
): Promise<ApiResponse<string>> {
  try {
    const path = `constancia/${constanciaId}/constancia-${safeStorageKey(codigo)}.pdf`;
    const up = await supabase.storage.from('certificados').upload(path, blob, {
      upsert: true,
      contentType: 'application/pdf',
      cacheControl: '3600',
    });
    if (up.error) return fail('CONST_UPLOAD', up.error.message, up.error);
    return ok(path);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

/** Registra el path del PDF en la fila (RPC staff-only). */
export async function constanciaRegistrarPdf(
  constanciaId: string,
  path: string,
): Promise<ApiResponse<void>> {
  const { error } = await supabase.rpc('constancia_registrar_pdf', {
    p_constancia_id: constanciaId,
    p_path: path,
  });
  if (error) return fail('CONST_REG_PDF', error.message, error);
  return ok(undefined);
}

/** Envía la constancia por email con el PDF adjunto (edge fn gemela de
 *  send-certificado-email · Gmail OAuth de contacto@). */
export async function sendConstanciaEmail(
  constanciaId: string,
  opts: { enviarAlAlumno: boolean; extraEmail?: string | null },
): Promise<ApiResponse<{ to: string[] }>> {
  const { data, error } = await supabase.functions.invoke('send-constancia-email', {
    body: {
      constancia_id: constanciaId,
      enviar_al_alumno: opts.enviarAlAlumno,
      extra_email: opts.extraEmail?.trim() || null,
    },
  });
  if (error) {
    // FunctionsHttpError: el mensaje real viene en el body JSON.
    try {
      const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
      const j = ctx?.json ? await ctx.json() : null;
      return fail('CONST_EMAIL', j?.error ?? error.message, error);
    } catch {
      return fail('CONST_EMAIL', error.message, error);
    }
  }
  const r = data as { ok: boolean; to?: string[]; error?: string };
  if (!r?.ok) return fail('CONST_EMAIL', r?.error ?? 'No se pudo enviar');
  return ok({ to: r.to ?? [] });
}

/** Historial de constancias emitidas de una matrícula (staff · RLS). */
export async function listConstanciasMatricula(
  matriculaId: string,
): Promise<ApiResponse<ConstanciaRow[]>> {
  const { data, error } = await supabase
    .from('constancias')
    .select('*')
    .eq('matricula_id', matriculaId)
    .order('created_at', { ascending: false });
  if (error) return fail('CONST_LIST', error.message, error);
  return ok((data ?? []) as ConstanciaRow[]);
}

/** Signed URL corta para re-descargar un PDF ya guardado. */
export async function signedUrlConstancia(path: string): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.storage
    .from('certificados')
    .createSignedUrl(path, 60 * 10);
  if (error) return fail('CONST_SIGN', error.message, error);
  return ok(data.signedUrl);
}

// ============================================================================
// Variables de plantilla → texto final
// ============================================================================

/** Formatea un DNI numérico con puntos de miles (35410690 → 35.410.690). */
export function formatDni(dni: string): string {
  const digits = (dni ?? '').replace(/\D/g, '');
  if (!digits) return dni ?? '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function fechaLargaEs(d: Date = new Date()): string {
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

/** Reemplaza las variables {{nombre}} {{apellido}} {{dni}} {{curso}} {{fecha}}
 *  del texto de la plantilla con los datos reales del alumno. */
export function reemplazarVariablesConstancia(
  plantilla: string,
  datos: DatosConstanciaAlumno,
  fecha: Date = new Date(),
): string {
  return (plantilla ?? '')
    .replaceAll('{{nombre}}', datos.nombre || '—')
    .replaceAll('{{apellido}}', datos.apellido || '—')
    .replaceAll('{{dni}}', formatDni(datos.dni) || '—')
    .replaceAll('{{curso}}', datos.curso_titulo || '—')
    .replaceAll('{{fecha}}', fechaLargaEs(fecha));
}
