// SALUD del sistema · API service.
// Wraps la RPC public.db_health_metrics() que devuelve un JSON con todas
// las métricas. Solo accesible por staff (la RPC tira 42501 si no).
//
// Patrón ApiResponse<T> (regla 4).

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';

// ============================================================================
// Tipos del payload
// ============================================================================

export interface ProPlan {
  db_limit_bytes: number;
  storage_limit_bytes: number;
  plan_name: string;
}

export interface DbStats {
  size_bytes: number;
  size_pretty: string;
  usage_pct: number;
  cache_hit_pct: number | null;
  index_hit_pct: number | null;
  connections_active: number;
  connections_max: number;
  connections_pct: number;
}

export interface StorageTotal {
  bytes: number;
  pretty: string;
  usage_pct: number;
}

export interface TableInfo {
  tabla: string;
  bytes: number;
  pretty: string;
  filas_estimadas: number;
}

export interface BucketInfo {
  bucket: string;
  public: boolean;
  file_count: number;
  bytes: number;
  pretty: string;
}

export type AlertSeverity = 'warning' | 'critical';

export interface Alert {
  kind: 'db_size' | 'storage' | 'cache' | 'index' | 'connections';
  severity: AlertSeverity;
  message: string;
}

export interface DbHealthPayload {
  captured_at: string;
  pro_plan: ProPlan;
  db: DbStats;
  storage_total: StorageTotal;
  tables_top10: TableInfo[];
  storage_buckets: BucketInfo[];
  alerts: Alert[];
}

// ============================================================================
// API
// ============================================================================

export async function getDbHealthMetrics(): Promise<ApiResponse<DbHealthPayload>> {
  const { data, error } = await supabase.rpc('db_health_metrics' as never);
  if (error) return fail(error.code ?? 'UNKNOWN', error.message, error);
  return ok(data as unknown as DbHealthPayload);
}
