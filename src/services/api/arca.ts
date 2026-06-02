// services/api/arca.ts · ARCA self-service multi-emisor + cola de emisión.
// DGG-31 (2026-06-01): unificación arca_config (singleton legacy) → arca_emisores.
// Cita: regla 4 (no `from()` directo en componentes), P-API-01 (ApiResponse),
// doc 02 §4.8 (edge fns), P-ARCA-04.

import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, extractEdgeFnError, type ApiResponse } from '@/lib/errors';

export type ArcaAmbiente = 'homologacion' | 'produccion';

// ============================================================================
// Tipos
// ============================================================================

export interface ArcaEmisor {
  id: string;
  nombre: string;
  razon_social: string;
  cuit: string | null;
  condicion_iva: string;
  domicilio_fiscal: string | null;
  logo_url: string | null;
  ambiente: ArcaAmbiente;
  csr_b64: string | null;
  key_b64: string | null;
  cert_b64: string | null;
  cert_alias: string | null;
  csr_generado_at: string | null;
  cert_subido_at: string | null;
  cert_valido_desde: string | null;
  cert_valido_hasta: string | null;
  ultimo_test_at: string | null;
  ultimo_test_ok: boolean | null;
  ultimo_test_msg: string | null;
  ultimo_test_latencia_ms: number | null;
  punto_venta_default: number;
  es_default: boolean;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

// Alias retrocompatible con código viejo que usa ArcaConfig (singleton legacy).
export type ArcaConfig = ArcaEmisor;

export interface ArcaQueueJob {
  id: string;
  comprobante_id: string;
  status: 'pending' | 'sending' | 'done' | 'failed' | 'cancelled';
  scheduled_at: string;
  attempt: number;
  max_attempts: number;
  request_xml: string | null;
  response_xml: string | null;
  last_error: string | null;
  cae: string | null;
  cae_vencimiento: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArcaQueueJobWithComp extends ArcaQueueJob {
  comprobante: {
    tipo: string;
    punto_venta: number;
    numero: number | null;
    total: number;
    receptor_razon_social: string;
  } | null;
}

// ============================================================================
// Normalización de ambiente: la columna acepta múltiples valores por compat
// con el seed viejo. Normalizamos al vocabulario UX 'homologacion'/'produccion'.
// ============================================================================

function normAmbiente(a: string | null | undefined): ArcaAmbiente {
  return a === 'produccion' || a === 'prod' ? 'produccion' : 'homologacion';
}

function rowToEmisor(row: Record<string, unknown>): ArcaEmisor {
  return { ...(row as unknown as ArcaEmisor), ambiente: normAmbiente(row.ambiente as string) };
}

// ============================================================================
// CRUD de emisores (multi-emisor desde DGG-31)
// ============================================================================

export async function listEmisores(): Promise<ApiResponse<ArcaEmisor[]>> {
  const { data, error } = await supabase
    .from('arca_emisores')
    .select('*')
    .order('es_default', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) return fail('ARCA_EMISORES_LIST', error.message, error);
  return ok(((data ?? []) as Record<string, unknown>[]).map(rowToEmisor));
}

export async function getEmisor(emisorId: string): Promise<ApiResponse<ArcaEmisor>> {
  const { data, error } = await supabase
    .from('arca_emisores')
    .select('*')
    .eq('id', emisorId)
    .single();
  if (error) return fail('ARCA_EMISOR_GET', error.message, error);
  return ok(rowToEmisor(data as Record<string, unknown>));
}

/** Devuelve el emisor por defecto (es_default=true, activo=true). Si no existe, lo crea con un placeholder. */
export async function getEmisorDefault(): Promise<ApiResponse<ArcaEmisor>> {
  const { data, error } = await supabase.rpc('arca_emisor_default' as never);
  if (error) return fail('ARCA_EMISOR_DEFAULT', error.message, error);
  if (!data) return fail('ARCA_EMISOR_DEFAULT', 'Sin emisor default');
  return ok(rowToEmisor(data as Record<string, unknown>));
}

export interface CrearEmisorInput {
  nombre: string;
  razon_social: string;
  cuit?: string | null;
  condicion_iva?: string;
  domicilio_fiscal?: string | null;
  logo_url?: string | null;
  ambiente?: ArcaAmbiente;
  punto_venta_default?: number;
  es_default?: boolean;
}

export async function crearEmisor(input: CrearEmisorInput): Promise<ApiResponse<ArcaEmisor>> {
  const { data, error } = await supabase
    .from('arca_emisores')
    .insert({
      nombre: input.nombre,
      razon_social: input.razon_social,
      cuit: input.cuit ?? null,
      condicion_iva: input.condicion_iva ?? 'responsable_inscripto',
      domicilio_fiscal: input.domicilio_fiscal ?? null,
      logo_url: input.logo_url ?? null,
      ambiente: input.ambiente ?? 'homologacion',
      punto_venta_default: input.punto_venta_default ?? 1,
      es_default: input.es_default ?? false,
      activo: true,
    })
    .select('*')
    .single();
  if (error) return fail('ARCA_EMISOR_CREATE', error.message, error);
  return ok(rowToEmisor(data as Record<string, unknown>));
}

export type ActualizarEmisorInput = Partial<{
  nombre: string;
  razon_social: string;
  cuit: string | null;
  condicion_iva: string;
  domicilio_fiscal: string | null;
  logo_url: string | null;
  ambiente: ArcaAmbiente;
  punto_venta_default: number;
}>;

export async function actualizarEmisor(
  emisorId: string,
  patch: ActualizarEmisorInput,
): Promise<ApiResponse<ArcaEmisor>> {
  const { data, error } = await supabase
    .from('arca_emisores')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', emisorId)
    .select('*')
    .single();
  if (error) return fail('ARCA_EMISOR_UPDATE', error.message, error);
  return ok(rowToEmisor(data as Record<string, unknown>));
}

export async function archivarEmisor(emisorId: string): Promise<ApiResponse<void>> {
  const { error } = await supabase
    .from('arca_emisores')
    .update({ activo: false, es_default: false, updated_at: new Date().toISOString() })
    .eq('id', emisorId);
  if (error) return fail('ARCA_EMISOR_ARCHIVE', error.message, error);
  return ok(undefined);
}

export async function reactivarEmisor(emisorId: string): Promise<ApiResponse<void>> {
  const { error } = await supabase
    .from('arca_emisores')
    .update({ activo: true, updated_at: new Date().toISOString() })
    .eq('id', emisorId);
  if (error) return fail('ARCA_EMISOR_REACTIVATE', error.message, error);
  return ok(undefined);
}

export async function marcarDefault(emisorId: string): Promise<ApiResponse<void>> {
  const { error } = await supabase.rpc('arca_emisor_set_default' as never, { p_emisor_id: emisorId } as never);
  if (error) return fail('ARCA_EMISOR_SET_DEFAULT', error.message, error);
  return ok(undefined);
}

// ============================================================================
// Logo del emisor (storage bucket 'emisor-logos', DGG-31 + mig 0160)
// ============================================================================

/**
 * Sube un logo al bucket emisor-logos y actualiza arca_emisores.logo_url.
 * Path: emisor-logos/<emisor_id>/logo-<timestamp>.<ext>
 */
export async function uploadEmisorLogo(
  emisorId: string,
  blob: Blob,
  ext = 'png',
): Promise<ApiResponse<{ publicUrl: string }>> {
  if (!blob.type.startsWith('image/')) {
    return fail('LOGO_INVALID_TYPE', 'El archivo no es una imagen válida.');
  }
  const MAX_BYTES = 4 * 1024 * 1024; // 4 MB — un logo razonable.
  if (blob.size > MAX_BYTES) {
    return fail('LOGO_TOO_LARGE', 'La imagen supera los 4 MB. Reducila antes de subir.');
  }
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'png';
  const path = `${emisorId}/logo-${Date.now()}.${safeExt}`;
  const { error: upErr } = await supabase.storage
    .from('emisor-logos')
    .upload(path, blob, { cacheControl: '3600', upsert: false, contentType: blob.type });
  if (upErr) return fail('LOGO_UPLOAD', upErr.message, toApiError(upErr));
  const { data: pub } = supabase.storage.from('emisor-logos').getPublicUrl(path);
  const publicUrl = pub.publicUrl;
  const { error: updErr } = await supabase
    .from('arca_emisores')
    .update({ logo_url: publicUrl, updated_at: new Date().toISOString() })
    .eq('id', emisorId);
  if (updErr) return fail('LOGO_PERSIST', updErr.message, toApiError(updErr));
  return ok({ publicUrl });
}

/** Borra el logo del emisor del bucket y nullea logo_url. */
export async function clearEmisorLogo(emisorId: string): Promise<ApiResponse<void>> {
  // Listar los blobs en la carpeta del emisor y borrarlos (1 a N — siempre será chico).
  const { data: files, error: lsErr } = await supabase.storage
    .from('emisor-logos')
    .list(emisorId, { limit: 50 });
  if (lsErr) return fail('LOGO_LIST', lsErr.message, lsErr);
  if (files && files.length > 0) {
    const paths = files.map((f) => `${emisorId}/${f.name}`);
    const { error: rmErr } = await supabase.storage.from('emisor-logos').remove(paths);
    if (rmErr) return fail('LOGO_REMOVE', rmErr.message, rmErr);
  }
  const { error: updErr } = await supabase
    .from('arca_emisores')
    .update({ logo_url: null, updated_at: new Date().toISOString() })
    .eq('id', emisorId);
  if (updErr) return fail('LOGO_PERSIST', updErr.message, toApiError(updErr));
  return ok(undefined);
}

// ============================================================================
// Compat: API singleton (legacy) — opera sobre el emisor default.
// ============================================================================

export async function getArcaConfig(): Promise<ApiResponse<ArcaEmisor>> {
  return getEmisorDefault();
}

export async function updateArcaConfig(
  patch: Partial<Pick<ArcaEmisor, 'ambiente' | 'punto_venta_default'>>,
): Promise<ApiResponse<ArcaEmisor>> {
  // Resolver el default y actualizarlo.
  const def = await getEmisorDefault();
  if (!def.ok) return def;
  return actualizarEmisor(def.data.id, patch);
}

// ============================================================================
// Edge fns wrappers — mejor parsing de errores (DGG-31).
// Cuando supabase.functions.invoke recibe un status no-2xx, devuelve
// FunctionsHttpError con .context.response (fetch Response) cuyo body
// contiene el `error` real del backend. Lo extraemos para no mostrar el
// genérico "Edge Function returned a non-2xx status code".
// ============================================================================

// extractInvokeError fue movido a @/lib/errors como extractEdgeFnError (CHUNK1-A).
// Mantenemos el nombre para no romper callers internos.
const extractInvokeError = extractEdgeFnError;

export interface GenerarCsrResult {
  ok: true;
  emisor_id: string;
  csr_pem: string;
  alias_sugerido: string;
  instrucciones: string[];
}

export async function generarCsr(
  emisorId?: string,
  alias?: string,
): Promise<ApiResponse<GenerarCsrResult>> {
  try {
    const body: { emisor_id?: string; alias?: string } = {};
    if (emisorId) body.emisor_id = emisorId;
    if (alias) body.alias = alias;
    const { data, error } = await supabase.functions.invoke('arca-generar-csr', { body });
    if (error) {
      const msg = await extractInvokeError(error);
      return fail('ARCA_GENERAR_CSR', msg, error);
    }
    if (!data?.ok) return fail('ARCA_GENERAR_CSR', data?.error ?? 'Error desconocido', data);
    return ok(data as GenerarCsrResult);
  } catch (e) {
    return { ok: false, error: toApiError(e) };
  }
}

export interface InspeccionarCertResult {
  ok: true;
  emisor_id: string;
  valido_desde: string | null;
  valido_hasta: string | null;
  subject_cn: string | null;
  cuit_in_subject: string | null;
  match_key: boolean;
  alias: string | null;
}

export async function inspeccionarYGuardarCert(
  certB64OrPem: string,
  emisorId?: string,
): Promise<ApiResponse<InspeccionarCertResult>> {
  const body: { emisor_id?: string; cert_pem?: string; cert_b64?: string } = {};
  if (emisorId) body.emisor_id = emisorId;
  if (certB64OrPem.includes('BEGIN CERTIFICATE')) body.cert_pem = certB64OrPem;
  else body.cert_b64 = certB64OrPem;
  try {
    const { data, error } = await supabase.functions.invoke('arca-inspeccionar-cert', { body });
    if (error) {
      const msg = await extractInvokeError(error);
      return fail('ARCA_INSPECT_CERT', msg, error);
    }
    if (!data?.ok) return fail('ARCA_INSPECT_CERT', data?.error ?? 'Error desconocido', data);
    return ok(data as InspeccionarCertResult);
  } catch (e) {
    return { ok: false, error: toApiError(e) };
  }
}

export interface TestConexionResult {
  ok: boolean;
  emisor_id?: string;
  mensaje: string;
  latencia_ms: number;
  ambiente: ArcaAmbiente;
}

export async function testConexion(emisorId?: string): Promise<ApiResponse<TestConexionResult>> {
  try {
    const body: { emisor_id?: string } = {};
    if (emisorId) body.emisor_id = emisorId;
    const { data, error } = await supabase.functions.invoke('arca-test-conexion', { body });
    if (error) {
      // El edge devuelve 400 cuando el test es OK pero connection failed; igual
      // tiene cuerpo válido. supabase-js arroja error genérico, intentamos
      // recuperar el body si lo tiene.
      const msg = await extractInvokeError(error);
      return fail('ARCA_TEST', msg, error);
    }
    return ok(data as TestConexionResult);
  } catch (e) {
    return { ok: false, error: toApiError(e) };
  }
}

// ============================================================================
// Cola de emisión (no cambia con DGG-31).
// ============================================================================

export async function enqueueComprobante(comprobanteId: string): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.rpc('enqueue_emision_comprobante', {
    p_comprobante_id: comprobanteId,
  });
  if (error) return fail('ARCA_ENQUEUE', error.message, error);
  return ok(data as string);
}

export async function reintentarJob(jobId: string): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.rpc('reintentar_arca_job', { p_job_id: jobId });
  if (error) return fail('ARCA_RETRY', error.message, error);
  return ok(data as string);
}

export interface ListJobsFilter {
  status?: 'pending' | 'sending' | 'done' | 'failed' | 'cancelled';
  limit?: number;
  offset?: number;
}

export async function listColaJobs(
  filter: ListJobsFilter = {},
): Promise<ApiResponse<{ rows: ArcaQueueJobWithComp[]; total: number }>> {
  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;
  let q = supabase
    .from('arca_emision_queue')
    .select(
      `*, comprobante:comprobantes(tipo, punto_venta, numero, total, receptor_razon_social)`,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (filter.status) q = q.eq('status', filter.status);
  const { data, error, count } = await q;
  if (error) return fail('ARCA_QUEUE_LIST', error.message, error);
  return ok({
    rows: (data as unknown as ArcaQueueJobWithComp[]) ?? [],
    total: count ?? 0,
  });
}

export async function getJobDetail(jobId: string): Promise<ApiResponse<ArcaQueueJobWithComp>> {
  const { data, error } = await supabase
    .from('arca_emision_queue')
    .select(`*, comprobante:comprobantes(tipo, punto_venta, numero, total, receptor_razon_social)`)
    .eq('id', jobId)
    .single();
  if (error) return fail('ARCA_QUEUE_DETAIL', error.message, error);
  return ok(data as unknown as ArcaQueueJobWithComp);
}

// ============================================================================
// KPIs cola.
// ============================================================================

export interface ArcaKpis {
  pending: number;
  sending: number;
  done: number;
  failed: number;
}

export async function getColaKpis(): Promise<ApiResponse<ArcaKpis>> {
  const { data, error } = await supabase
    .from('arca_emision_queue')
    .select('status')
    .in('status', ['pending', 'sending', 'done', 'failed']);
  if (error) return fail('ARCA_KPIS', error.message, error);
  const kpis: ArcaKpis = { pending: 0, sending: 0, done: 0, failed: 0 };
  for (const row of (data as Array<{ status: string }> | null) ?? []) {
    if (row.status === 'pending') kpis.pending++;
    else if (row.status === 'sending') kpis.sending++;
    else if (row.status === 'done') kpis.done++;
    else if (row.status === 'failed') kpis.failed++;
  }
  return ok(kpis);
}

// ============================================================================
// Estado derivado del wizard ARCA (por emisor).
// ============================================================================

export function arcaListo(em: ArcaEmisor | null): boolean {
  if (!em) return false;
  return !!(em.cuit && em.cert_b64 && em.key_b64 && em.ultimo_test_ok);
}

export interface ArcaWizardStage {
  step: 1 | 2 | 3 | 4;
  cuitCargado: boolean;
  csrGenerado: boolean;
  certSubido: boolean;
  testOk: boolean;
}

export function arcaWizardStage(em: ArcaEmisor | null): ArcaWizardStage {
  const cuitCargado = !!em?.cuit;
  const csrGenerado = !!em?.csr_b64 && !!em?.key_b64;
  const certSubido = !!em?.cert_b64;
  const testOk = !!em?.ultimo_test_ok;
  // Sin CUIT no se puede avanzar: forzamos paso 1.
  const step: 1 | 2 | 3 | 4 = !cuitCargado
    ? 1
    : !csrGenerado
      ? 1
      : !certSubido
        ? 2
        : !testOk
          ? 3
          : 4;
  return { step, cuitCargado, csrGenerado, certSubido, testOk };
}
