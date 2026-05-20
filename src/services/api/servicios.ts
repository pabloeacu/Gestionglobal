import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

export type ServicioRow = Database['public']['Tables']['servicios']['Row'];
export type CategoriaServicioRow = Database['public']['Tables']['categorias_servicio']['Row'];

export interface ServicioListItem extends ServicioRow {
  categoria_nombre: string;
}

// Listado liviano para el picker del wizard de emisión: solo activos.
export async function listServiciosActivos(): Promise<
  ApiResponse<ServicioListItem[]>
> {
  const { data, error } = await supabase
    .from('servicios')
    .select(`*, categorias_servicio!inner(id,nombre,codigo)`)
    .eq('activo', true)
    .order('orden', { ascending: true });
  if (error) return fail('SERV_LIST', error.message, error);

  type Joined = ServicioRow & {
    categorias_servicio: { nombre: string; codigo: string } | null;
  };
  const rows: ServicioListItem[] = (data ?? []).map((raw) => {
    const r = raw as Joined;
    const { categorias_servicio, ...rest } = r;
    return {
      ...(rest as ServicioRow),
      categoria_nombre: categorias_servicio?.nombre ?? '—',
    };
  });
  return ok(rows);
}
