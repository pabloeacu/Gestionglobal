import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Json } from '@/types/database';

// ============================================================================
// Service · emisión de comprobantes de la presentación DDJJ (DGG-275 F3).
// Emite el lote (único a la administración, o uno por consorcio) vía la RPC
// tramite_emitir_comprobantes_ddjj (mig 0750), que estampa comprobantes.tramite_id
// (vínculo N:1, mig 0749) para que el gate de cierre y la cta cte vean todos.
// ============================================================================

export type DdjjModo = 'unico' | 'por_consorcio';
export type DdjjTipoLinea = 'simple' | 'fiscal';

export interface DdjjLineaEmision {
  consorcio_id?: string | null;
  tipo?: DdjjTipoLinea;
  descripcion?: string | null;
  precio: number;
  alicuota_iva?: string;
  bonificacion_porc?: number;
  concepto?: string;
}

export interface DdjjEmisionDetalle {
  fila: number;
  consorcio_id?: string | null;
  comprobante_id?: string;
  total?: number;
  resultado: 'emitido' | 'error';
  motivo?: string;
}

export interface DdjjEmisionResult {
  modo: DdjjModo;
  total_lineas: number;
  emitidos: number;
  errores: number;
  monto_total: number;
  primer_comprobante_id: string | null;
  comprobante_ids: string[];
  detalle: DdjjEmisionDetalle[];
}

export async function emitirComprobantesDdjj(
  tramiteId: string,
  modo: DdjjModo,
  lineas: DdjjLineaEmision[],
): Promise<ApiResponse<DdjjEmisionResult>> {
  if (lineas.length === 0) {
    return fail('DDJJ_EMIT_SIN_LINEAS', 'No hay líneas para emitir');
  }
  const { data, error } = await supabase.rpc('tramite_emitir_comprobantes_ddjj', {
    p_tramite_id: tramiteId,
    p_modo: modo,
    p_lineas: lineas as unknown as Json,
  });
  if (error) return fail('DDJJ_EMIT_RPC', error.message, error);
  return ok(data as unknown as DdjjEmisionResult);
}
