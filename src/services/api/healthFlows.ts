// Health flows · API service (DGG-32).
// Envuelve las RPCs definidas en mig 0164 + la edge fn `health-flows-check`.
// Citas: regla 4 (queries en services/), regla 12 (staff only).
//
// Las RPCs `health_flow_*` tiran 42501 si el caller no es staff.

import { supabase } from '@/lib/supabase';
import { ok, fail, extractEdgeFnError, type ApiResponse } from '@/lib/errors';

// ============================================================================
// Tipos
// ============================================================================

export type HealthFlowStatus = 'ok' | 'warning' | 'critical' | 'skipped';
export type HealthFlowOverall = 'ok' | 'warning' | 'critical';

export interface HealthFlowCheckResult {
  status: HealthFlowStatus;
  detail: string;
  metric?: number;
}

export interface HealthFlowRun {
  id: string;
  run_at: string;
  overall_status: HealthFlowOverall;
  duration_ms: number;
  checks: Record<string, HealthFlowCheckResult>;
  origen: 'cron' | 'manual';
}

export interface HealthFlowActiveAlert {
  id: string;
  check_key: string;
  severity: 'warning' | 'critical';
  started_at: string;
  last_seen_at: string;
  last_error: string | null;
  origen_run_id: string | null;
}

// Etiquetas humanas por check_key. Si llega uno nuevo, se muestra el key tal cual.
export const HEALTH_FLOW_CHECK_LABELS: Record<string, string> = {
  email_queue_atascada: 'Cola de emails',
  push_queue_atascada: 'Cola de push web',
  cron_dispatchers_activos: 'Cron dispatchers',
  cron_secret_alineado: 'Secreto del cron alineado',
  trigger_captacion: 'Captación de formularios → trámites',
  notif_escala_push: 'Campanita escala a push web',
  arca_comprobantes: 'Comprobantes ARCA',
};

export function labelDeCheck(key: string): string {
  return HEALTH_FLOW_CHECK_LABELS[key] ?? key;
}

// ============================================================================
// Listas
// ============================================================================

export async function listHealthFlowRuns(
  limit = 20,
): Promise<ApiResponse<HealthFlowRun[]>> {
  const { data, error } = await supabase.rpc('health_flow_runs_recent' as never, {
    p_limit: limit,
  } as never);
  if (error) return fail(error.code ?? 'HEALTH_RUNS', error.message, error);
  return ok((data ?? []) as unknown as HealthFlowRun[]);
}

export async function listHealthFlowActiveAlerts(): Promise<
  ApiResponse<HealthFlowActiveAlert[]>
> {
  const { data, error } = await supabase.rpc(
    'health_flow_alerts_active' as never,
  );
  if (error) return fail(error.code ?? 'HEALTH_ALERTS', error.message, error);
  return ok((data ?? []) as unknown as HealthFlowActiveAlert[]);
}

export async function resolveHealthFlowAlert(
  alertId: string,
): Promise<ApiResponse<boolean>> {
  const { data, error } = await supabase.rpc(
    'health_flow_alert_resolve' as never,
    { p_id: alertId } as never,
  );
  if (error) return fail(error.code ?? 'HEALTH_RESOLVE', error.message, error);
  return ok((data ?? false) as boolean);
}

// ============================================================================
// Correr health check manualmente (gerencia → "Correr ahora")
// ============================================================================

export interface RunHealthCheckResult {
  run_id: string;
  overall_status: HealthFlowOverall;
  duration_ms: number;
  checks: Record<string, HealthFlowCheckResult>;
}

export async function runHealthCheckManual(): Promise<
  ApiResponse<RunHealthCheckResult>
> {
  const { data, error } = await supabase.functions.invoke<{
    ok: boolean;
    run_id: string;
    overall_status: HealthFlowOverall;
    duration_ms: number;
    checks: Record<string, HealthFlowCheckResult>;
    error?: string;
  }>('health-flows-check', { body: { origen: 'manual' } });

  if (error) {
    const msg = await extractEdgeFnError(error);
    return fail('HEALTH_RUN', msg, error);
  }
  if (!data?.ok) return fail('HEALTH_RUN', data?.error ?? 'No se pudo correr el chequeo');
  return ok({
    run_id: data.run_id,
    overall_status: data.overall_status,
    duration_ms: data.duration_ms,
    checks: data.checks,
  });
}
