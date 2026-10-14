import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

// ============================================================================
// DGG-222 · Equipo de cierre de trámites (dashboard + comando manual).
// Lee/escribe los RPCs de las migs 0562-0567 (SECDEF, staff-gated):
//   · agente_cierre_preview()  → read-only: qué cerraría/reportaría AHORA (0567)
//   · agente_cierre_correr('manual') → corre el equipo (modo derivado del flag)
//   · agente_cierre_runs       → historial de corridas (RLS staff SELECT)
//   · config_global.agente_cierre_activo / _cap → flag + tope (gerente, RLS)
// El cierre REAL está GATED por config_global.agente_cierre_activo (si false →
// 'seco'/simulación). R4: todo query vive acá, no en componentes.
// ============================================================================

export type AgenteCierreRun = Database['public']['Tables']['agente_cierre_runs']['Row'];

export type CierreTrack = 'principal' | 'juridica' | 'curso';
export type CierreDecision = 'cerrar_limpio' | 'reportar_bloqueo' | 'reportar_revision';

export interface CierrePorTrack {
  total: number; limpios: number; revision: number; bloqueos: number;
  espera_cert?: number; cursando?: number;
}

export interface CierreResumen {
  total: number;
  cerrar_limpio: number;
  reportar_revision: number;
  reportar_bloqueo: number;
  modo: 'real' | 'seco';
  cerrados: number;
  errores_cierre: number;
  cap: number;
  por_track?: { principal: CierrePorTrack; juridica: CierrePorTrack; curso: CierrePorTrack };
}

export interface CierreItem {
  tramite_id: string;
  track: CierreTrack;
  categoria: string;
  servicio: string | null;
  cliente: string;
  decision: CierreDecision;
  bloqueos: string[];
  motivo: string;
  dias_abierto: number;
  cierre: { motivo: string; satisfactorio: boolean; observaciones: string } | null;
}

export interface AgenteCierreConfig { activo: boolean; cap: number; }

function readConfig(data: { agente_cierre_activo: boolean | null; agente_cierre_cap: number | null }): AgenteCierreConfig {
  return { activo: data.agente_cierre_activo ?? false, cap: data.agente_cierre_cap ?? 25 };
}

export async function getAgenteCierreConfig(): Promise<ApiResponse<AgenteCierreConfig>> {
  try {
    const { data, error } = await supabase
      .from('config_global')
      .select('agente_cierre_activo, agente_cierre_cap')
      .eq('id', 1)
      .single();
    if (error) throw error;
    return ok(readConfig(data));
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function listAgenteCierreRuns(
  page: number,
  pageSize: number,
): Promise<ApiResponse<{ rows: AgenteCierreRun[]; total: number }>> {
  try {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await supabase
      .from('agente_cierre_runs')
      .select('*', { count: 'exact' })
      .order('run_at', { ascending: false })
      .range(from, to);
    if (error) throw error;
    return ok({ rows: (data ?? []) as AgenteCierreRun[], total: count ?? 0 });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

/** Read-only: qué cerraría/reportaría el equipo si corriera ahora (no cierra nada). */
export async function previewAgenteCierre(): Promise<ApiResponse<CierreItem[]>> {
  try {
    const { data, error } = await supabase.rpc('agente_cierre_preview');
    if (error) throw error;
    return ok((data ?? []) as unknown as CierreItem[]);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

/** Corre el equipo AHORA (origen manual). En modo real cierra los limpios + avisa a los clientes. */
export async function correrAgenteCierre(): Promise<
  ApiResponse<{ ok: boolean; run_id: string; resumen: CierreResumen }>
> {
  try {
    const { data, error } = await supabase.rpc('agente_cierre_correr', { p_origen: 'manual' });
    if (error) throw error;
    return ok(data as unknown as { ok: boolean; run_id: string; resumen: CierreResumen });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

/** Prende/apaga el cierre automático (flag gateado por RLS a gerente). */
export async function setAgenteCierreActivo(activo: boolean): Promise<ApiResponse<AgenteCierreConfig>> {
  try {
    const { data, error } = await supabase
      .from('config_global')
      .update({ agente_cierre_activo: activo })
      .eq('id', 1)
      .select('agente_cierre_activo, agente_cierre_cap')
      .single();
    if (error) throw error;
    return ok(readConfig(data));
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

/** Cambia el tope de cierres por corrida (gateado por RLS a gerente). */
export async function setAgenteCierreCap(cap: number): Promise<ApiResponse<AgenteCierreConfig>> {
  try {
    const { data, error } = await supabase
      .from('config_global')
      .update({ agente_cierre_cap: cap })
      .eq('id', 1)
      .select('agente_cierre_activo, agente_cierre_cap')
      .single();
    if (error) throw error;
    return ok(readConfig(data));
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}
