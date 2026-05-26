import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';

// Búsqueda global ⌘K end-to-end. Llama a la RPC `busqueda_global` (RLS-safe,
// SECURITY DEFINER con tenancy guard inline — staff ve todo, administrador
// sólo la suya). Cita: regla 4 (sin .from() en componentes), regla 12
// (tenancy guard).

export type BusquedaKind =
  | 'administracion'
  | 'comprobante'
  | 'tramite'
  | 'solicitud'
  | 'vencimiento'
  | 'servicio'
  | 'curso'
  | 'partner'
  | 'formulario';

export interface BusquedaItem {
  kind: BusquedaKind;
  id: string;
  titulo: string;
  subtitulo: string | null;
  url_path: string;
  rank: number;
}

export async function buscarGlobal(
  query: string,
  limit = 8,
): Promise<ApiResponse<BusquedaItem[]>> {
  const q = query.trim();
  if (q.length < 2) return ok([]);

  const { data, error } = await supabase.rpc('busqueda_global', {
    p_q: q,
    p_limit: limit,
  });

  if (error) return fail('BUSQUEDA_GLOBAL', error.message, error);

  const rows = (data ?? []) as BusquedaItem[];
  // Orden global por rank (cada bloque del RPC ya viene ordenado, pero al
  // concatenar varios kinds queremos los top-overall primero).
  const sorted = [...rows].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  return ok(sorted);
}
