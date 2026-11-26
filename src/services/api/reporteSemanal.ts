// DGG-266 · Reporte integral de automatización + marketing. Lee la RPC
// reporte_semanal_data (staff-gated) que calcula envíos+rebotes por categoría y
// campaña, visitas por UTM (engagement), tráfico, referrers/dispositivos/países y
// captación. Mismo dato que consume el email semanal → una sola fuente de verdad.
import { supabase } from '@/lib/supabase';
import { fail, ok, humanizeError, toApiError, type ApiResponse } from '@/lib/errors';

export type MedicionEstado = 'ok' | 'sin_addon' | 'error';

export interface ReporteTotales {
  enviados: number;
  rebotes: number;
  rebote_pct: number;
  supresiones_nuevas: number;
}
export interface ReporteCategoria {
  categoria: string;
  enviados: number;
  rebotes: number;
  rebote_pct: number;
}
export interface ReporteCampana {
  campana: string;
  categoria: string;
  enviados: number;
  rebotes: number;
  rebote_pct: number;
  visitas: number;
}
export interface ReporteTemplate {
  template: string;
  enviados: number;
  rebotes: number;
}
export interface ReporteTrafico {
  visitantes: number;
  vistas: number;
  desde_newsletter: number | null;
  desde_email: number | null;
  medicion_estado: MedicionEstado;
}
export interface ReporteValor {
  valor: string;
  visitantes: number;
}
export interface ReporteCaptacion {
  conversiones_semana: number;
  conversiones_total: number;
  sin_contactar: number;
  en_cola: number;
  motor_activo: boolean;
}
/** DGG-270: gemelo federal del bloque de captación (origen='import_nacional'). */
export type ReporteFederal = ReporteCaptacion;
export interface ReporteSemanal {
  generado_at: string;
  dias: number;
  ventana: string;
  totales: ReporteTotales;
  categorias: ReporteCategoria[];
  campanas: ReporteCampana[];
  avisos_clientes: ReporteTemplate[];
  transaccional: ReporteTemplate[];
  trafico: ReporteTrafico | null;
  referrers: ReporteValor[];
  dispositivos: Record<string, number>;
  paises: ReporteValor[];
  captacion: ReporteCaptacion;
  federal: ReporteFederal;
}

export async function getReporteSemanal(dias = 7): Promise<ApiResponse<ReporteSemanal>> {
  const { data, error } = await supabase.rpc('reporte_semanal_data', { p_dias: dias });
  if (error) return fail('REPORTE_SEMANAL', humanizeError(toApiError(error)), error);
  return ok(data as unknown as ReporteSemanal);
}
