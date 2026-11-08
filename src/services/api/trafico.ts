// DGG-245 · Tráfico web (Vercel Web Analytics) — lee el snapshot que escribe el edge
// `vercel-trafico-snapshot` cada 3h. Staff-only (RLS). Para las cards del Inicio de
// gerencia: Landing (/) y LexPH (/lexph*) discriminadas.
import { supabase } from '@/lib/supabase';
import { fail, ok, type ApiResponse } from '@/lib/errors';

export type Superficie = 'landing' | 'lexph';
export type Ventana = 'hoy' | '7d' | '30d';

export interface TraficoFila {
  superficie: Superficie;
  ventana: Ventana;
  visitantes: number;
  vistas: number;
  desde_newsletter: number;
  actualizado_at: string;
}

export async function getTraficoWeb(): Promise<ApiResponse<TraficoFila[]>> {
  const { data, error } = await supabase
    .from('vercel_trafico')
    .select('superficie, ventana, visitantes, vistas, desde_newsletter, actualizado_at');
  if (error) return fail('TRAFICO_WEB', error.message, error);
  return ok((data ?? []) as TraficoFila[]);
}
