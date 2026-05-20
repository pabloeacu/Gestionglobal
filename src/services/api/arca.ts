// services/api/arca.ts · ARCA self-service configuration + cola de emisión.
// Cita: regla 4 (no `from()` directo en componentes), P-API-01 (ApiResponse),
// doc 02 §4.8 (edge fns), P-ARCA-04 (plugin opcional).

import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, type ApiResponse } from '@/lib/errors';

export type ArcaAmbiente = 'homologacion' | 'produccion';

export interface ArcaConfig {
  id: number;
  ambiente: ArcaAmbiente;
  cert_b64: string | null;
  key_b64: string | null;
  csr_b64: string | null;
  csr_generado_at: string | null;
  cert_subido_at: string | null;
  cert_alias: string | null;
  cert_valido_desde: string | null;
  cert_valido_hasta: string | null;
  ultimo_test_at: string | null;
  ultimo_test_ok: boolean | null;
  ultimo_test_msg: string | null;
  ultimo_test_latencia_ms: number | null;
  punto_venta_default: number;
  created_at: string;
  updated_at: string;
}

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

// ---------------------------------------------------------------------------
// Config CRUD.
// ---------------------------------------------------------------------------
export async function getArcaConfig(): Promise<ApiResponse<ArcaConfig>> {
  const { data, error } = await supabase
    .from('arca_config')
    .select('*')
    .eq('id', 1)
    .single();
  if (error) return fail('ARCA_CONFIG_LOAD', error.message, error);
  return ok(data as unknown as ArcaConfig);
}

export async function updateArcaConfig(
  patch: Partial<Pick<ArcaConfig, 'ambiente' | 'punto_venta_default'>>,
): Promise<ApiResponse<ArcaConfig>> {
  const { data, error } = await supabase
    .from('arca_config')
    .update(patch)
    .eq('id', 1)
    .select('*')
    .single();
  if (error) return fail('ARCA_CONFIG_UPDATE', error.message, error);
  return ok(data as unknown as ArcaConfig);
}

// ---------------------------------------------------------------------------
// Edge fns wrappers.
// ---------------------------------------------------------------------------
export interface GenerarCsrResult {
  ok: true;
  csr_pem: string;
  alias_sugerido: string;
  instrucciones: string[];
}

export async function generarCsr(
  alias?: string,
): Promise<ApiResponse<GenerarCsrResult>> {
  try {
    const { data, error } = await supabase.functions.invoke('arca-generar-csr', {
      body: alias ? { alias } : {},
    });
    if (error) return fail('ARCA_GENERAR_CSR', error.message, error);
    if (!data?.ok) return fail('ARCA_GENERAR_CSR', data?.error ?? 'Error desconocido', data);
    return ok(data as GenerarCsrResult);
  } catch (e) {
    return { ok: false, error: toApiError(e) };
  }
}

export interface InspeccionarCertResult {
  ok: true;
  valido_desde: string | null;
  valido_hasta: string | null;
  subject_cn: string | null;
  cuit_in_subject: string | null;
  match_key: boolean;
  alias: string | null;
}

export async function inspeccionarYGuardarCert(
  certB64OrPem: string,
): Promise<ApiResponse<InspeccionarCertResult>> {
  const body = certB64OrPem.includes('BEGIN CERTIFICATE')
    ? { cert_pem: certB64OrPem }
    : { cert_b64: certB64OrPem };
  try {
    const { data, error } = await supabase.functions.invoke('arca-inspeccionar-cert', { body });
    if (error) return fail('ARCA_INSPECT_CERT', error.message, error);
    if (!data?.ok) return fail('ARCA_INSPECT_CERT', data?.error ?? 'Error desconocido', data);
    return ok(data as InspeccionarCertResult);
  } catch (e) {
    return { ok: false, error: toApiError(e) };
  }
}

export interface TestConexionResult {
  ok: boolean;
  mensaje: string;
  latencia_ms: number;
  ambiente: ArcaAmbiente;
}

export async function testConexion(): Promise<ApiResponse<TestConexionResult>> {
  try {
    const { data, error } = await supabase.functions.invoke('arca-test-conexion', {
      body: {},
    });
    if (error) return fail('ARCA_TEST', error.message, error);
    // El edge devuelve 200 si OK, 400 si fallo: ambos cuerpos con `ok`.
    return ok(data as TestConexionResult);
  } catch (e) {
    return { ok: false, error: toApiError(e) };
  }
}

// ---------------------------------------------------------------------------
// Cola de emisión.
// ---------------------------------------------------------------------------
export async function enqueueComprobante(
  comprobanteId: string,
): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.rpc('enqueue_emision_comprobante', {
    p_comprobante_id: comprobanteId,
  });
  if (error) return fail('ARCA_ENQUEUE', error.message, error);
  return ok(data as string);
}

export async function reintentarJob(
  jobId: string,
): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.rpc('reintentar_arca_job', {
    p_job_id: jobId,
  });
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

export async function getJobDetail(
  jobId: string,
): Promise<ApiResponse<ArcaQueueJobWithComp>> {
  const { data, error } = await supabase
    .from('arca_emision_queue')
    .select(
      `*, comprobante:comprobantes(tipo, punto_venta, numero, total, receptor_razon_social)`,
    )
    .eq('id', jobId)
    .single();
  if (error) return fail('ARCA_QUEUE_DETAIL', error.message, error);
  return ok(data as unknown as ArcaQueueJobWithComp);
}

// ---------------------------------------------------------------------------
// KPIs cola.
// ---------------------------------------------------------------------------
export interface ArcaKpis {
  pending: number;
  sending: number;
  done: number;
  failed: number;
}

export async function getColaKpis(): Promise<ApiResponse<ArcaKpis>> {
  // Una sola query agrupada para evitar 4 round-trips.
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

// ---------------------------------------------------------------------------
// Estado derivado: ¿ARCA listo para emitir?
// ---------------------------------------------------------------------------
export function arcaListo(cfg: ArcaConfig | null): boolean {
  if (!cfg) return false;
  return !!(cfg.cert_b64 && cfg.key_b64 && cfg.ultimo_test_ok);
}

export interface ArcaWizardStage {
  step: 1 | 2 | 3 | 4;
  csrGenerado: boolean;
  certSubido: boolean;
  testOk: boolean;
}

export function arcaWizardStage(cfg: ArcaConfig | null): ArcaWizardStage {
  const csrGenerado = !!cfg?.csr_b64 && !!cfg?.key_b64;
  const certSubido = !!cfg?.cert_b64;
  const testOk = !!cfg?.ultimo_test_ok;
  const step = !csrGenerado ? 1 : !certSubido ? 2 : !testOk ? 3 : 4;
  return { step: step as 1 | 2 | 3 | 4, csrGenerado, certSubido, testOk };
}
