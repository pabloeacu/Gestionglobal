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
