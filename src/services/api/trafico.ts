// DGG-245 · Tráfico web (Vercel Web Analytics) — lee el snapshot que escribe el edge
// `vercel-trafico-snapshot` cada 3h. Staff-only (RLS). Para las cards del Inicio de
// gerencia: Landing (/) y LexPH (/lexph*) discriminadas.
import { supabase } from '@/lib/supabase';
import { fail, ok, type ApiResponse } from '@/lib/errors';

export type Superficie = 'landing' | 'lexph';
export type Ventana = 'hoy' | '7d' | '30d';

export type MedicionEstado = 'ok' | 'sin_addon' | 'error';

export interface TraficoFila {
  superficie: Superficie;
  ventana: Ventana;
  visitantes: number;
  vistas: number;
  desde_newsletter: number | null; // NULL = no medible (ver medicion_estado) · DGG-265
  desde_email: number | null;      // visitas desde cualquier email de marketing
  medicion_estado: MedicionEstado;
  actualizado_at: string;
}

export async function getTraficoWeb(): Promise<ApiResponse<TraficoFila[]>> {
  const { data, error } = await supabase
    .from('vercel_trafico')
    .select('superficie, ventana, visitantes, vistas, desde_newsletter, desde_email, medicion_estado, actualizado_at');
  if (error) return fail('TRAFICO_WEB', error.message, error);
  return ok((data ?? []) as TraficoFila[]);
}
