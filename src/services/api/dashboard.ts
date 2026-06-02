import { supabase } from '@/lib/supabase';
import { fail, ok, type ApiResponse } from '@/lib/errors';

// Forma del JSONB devuelto por public.kpis_dashboard_global. Mantenido en
// sync con supabase/migrations/0033_kpis_dashboard.sql.
export interface DashboardKpis {
  facturado_periodo: number;
  cobrado_periodo: number;
  deuda_total: number;
  admins_morosos: number;
  tramites_abiertos: number;
  vencimientos_proximos: number;
  serie_facturado: Array<{ fecha: string; facturado: number }>;
}

// Llama a la RPC kpis_dashboard_global. Los types regenerados no la
// conocen todavía (la migración acaba de aplicarse), así que casteamos a
// un caller crudo en vez de "as any" diseminado.
type RawRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

// DGG-34 R4 sweep · capitalización RPC `gerencia_alarmas_hoy`
// (AlarmasHoyWidget.tsx).
export interface AlarmaHoyRow {
  id: string;
  tramite_id: string;
  tramite_codigo: string | null;
  tramite_titulo: string | null;
  descripcion: string | null;
  alerta_en: string; // ISO
  dias_vencido: number;
  administracion_nombre: string | null;
  // permitir campos extra sin romper TS si la RPC evoluciona
  [k: string]: unknown;
}

export async function listarAlarmasHoy(): Promise<ApiResponse<AlarmaHoyRow[]>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('gerencia_alarmas_hoy');
  if (error) return fail('ALARMAS_HOY', error.message, error);
  return ok((data ?? []) as unknown as AlarmaHoyRow[]);
}

export async function getDashboardGlobal(
  diasAtras = 30,
): Promise<ApiResponse<DashboardKpis>> {
  const desde = new Date();
  desde.setDate(desde.getDate() - diasAtras);
  const desdeStr = desde.toISOString().slice(0, 10);

  const rpc: RawRpc = (name, args) =>
    (supabase.rpc as unknown as RawRpc).call(supabase, name, args);

  const { data, error } = await rpc('kpis_dashboard_global', {
    p_desde: desdeStr,
  });
  if (error) return fail('DASH_KPIS', error.message, error);
  return ok(data as DashboardKpis);
}
