// ============================================================================
// auditoria.ts · API de la bitácora unificada (DGG-35 / P2-#34)
// ============================================================================

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';

export interface AuditLogRow {
  id: number;
  table_name: string;
  action: 'insert' | 'update' | 'delete';
  row_pk: string | null;
  actor_id: string | null;
  actor_email: string | null;
  payload_before: Record<string, unknown> | null;
  payload_after: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditResumenRow {
  table_name: string;
  total: number;
  ultimos_7d: number;
}

export interface AuditFiltros {
  limit?: number;
  offset?: number;
  table?: string | null;
  action?: 'insert' | 'update' | 'delete' | null;
  actor?: string | null;
  desde?: string | null; // ISO
  hasta?: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (n: string, p: any) => (supabase.rpc as any)(n, p);

export async function listAuditLog(
  f: AuditFiltros = {},
): Promise<ApiResponse<AuditLogRow[]>> {
  const { data, error } = await rpc('audit_log_listar', {
    p_limit: f.limit ?? 50,
    p_offset: f.offset ?? 0,
    p_table_filter: f.table ?? null,
    p_action_filter: f.action ?? null,
    p_actor_filter: f.actor ?? null,
    p_desde: f.desde ?? null,
    p_hasta: f.hasta ?? null,
  });
  if (error) return fail('AUDIT_LISTAR', error.message, error);
  return ok((data ?? []) as AuditLogRow[]);
}

export async function getAuditResumen(): Promise<ApiResponse<AuditResumenRow[]>> {
  const { data, error } = await rpc('audit_log_resumen', {});
  if (error) return fail('AUDIT_RESUMEN', error.message, error);
  return ok((data ?? []) as AuditResumenRow[]);
}

// Diff helper: encuentra qué campos cambiaron entre before y after.
export function diffPayload(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Array<{ field: string; old: unknown; new: unknown }> {
  if (!before || !after) return [];
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const out: Array<{ field: string; old: unknown; new: unknown }> = [];
  for (const k of keys) {
    if (k === 'updated_at') continue;
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push({ field: k, old: a, new: b });
    }
  }
  return out;
}
