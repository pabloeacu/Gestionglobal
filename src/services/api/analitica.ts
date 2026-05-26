// ============================================================================
// analitica.ts · API del dashboard analítico avanzado (DGG-39 / P2-#24)
// ============================================================================

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';

export interface PuntoMensual {
  mes: string;       // YYYY-MM-01
  total: number;
  cantidad: number;
}

export interface TopCliente {
  administracion_id: string | null;
  nombre: string;
  total_facturado: number;
  total_comprobantes: number;
}

export interface MixServicio {
  servicio_id: string | null;
  nombre: string;
  total: number;
  cantidad: number;
}

export interface FunnelEtapa {
  etapa: string;
  cantidad: number;
  orden: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (n: string, p: any) => (supabase.rpc as any)(n, p);

const toNum = (x: unknown) => Number(x ?? 0);

export async function getAnaliticaFacturacionMensual(meses = 12): Promise<ApiResponse<PuntoMensual[]>> {
  const { data, error } = await rpc('analitica_facturacion_mensual', { p_meses: meses });
  if (error) return fail('ANALITICA_FACT', error.message, error);
  return ok((data ?? []).map((r: { mes: string; total: number; cantidad: number }) => ({
    mes: r.mes, total: toNum(r.total), cantidad: r.cantidad,
  })));
}

export async function getAnaliticaCobranzasMensual(meses = 12): Promise<ApiResponse<PuntoMensual[]>> {
  const { data, error } = await rpc('analitica_cobranzas_mensual', { p_meses: meses });
  if (error) return fail('ANALITICA_COB', error.message, error);
  return ok((data ?? []).map((r: { mes: string; total: number; cantidad: number }) => ({
    mes: r.mes, total: toNum(r.total), cantidad: r.cantidad,
  })));
}

export async function getAnaliticaTopClientes(dias = 90, limit = 10): Promise<ApiResponse<TopCliente[]>> {
  const { data, error } = await rpc('analitica_top_clientes', { p_dias: dias, p_limit: limit });
  if (error) return fail('ANALITICA_TOP', error.message, error);
  return ok((data ?? []).map((r: { administracion_id: string; nombre: string; total_facturado: number; total_comprobantes: number }) => ({
    administracion_id: r.administracion_id,
    nombre: r.nombre,
    total_facturado: toNum(r.total_facturado),
    total_comprobantes: r.total_comprobantes,
  })));
}

export async function getAnaliticaMixServicios(dias = 90): Promise<ApiResponse<MixServicio[]>> {
  const { data, error } = await rpc('analitica_mix_servicios', { p_dias: dias });
  if (error) return fail('ANALITICA_MIX', error.message, error);
  return ok((data ?? []).map((r: { servicio_id: string; nombre: string; total: number; cantidad: number }) => ({
    servicio_id: r.servicio_id, nombre: r.nombre, total: toNum(r.total), cantidad: r.cantidad,
  })));
}

export async function getAnaliticaFunnel(dias = 90): Promise<ApiResponse<FunnelEtapa[]>> {
  const { data, error } = await rpc('analitica_funnel', { p_dias: dias });
  if (error) return fail('ANALITICA_FUNNEL', error.message, error);
  return ok((data ?? []) as FunnelEtapa[]);
}
