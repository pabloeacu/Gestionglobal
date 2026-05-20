import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { ComprobanteListItem } from './comprobantes';
import type { Database } from '@/types/database';

type ComprobanteRow = Database['public']['Tables']['comprobantes']['Row'];

// Datos del dashboard del portal del administrador. La RLS filtra todo por
// administracion_id automáticamente, así que no hace falta pasar el id acá
// — alcanza con que el usuario esté autenticado como administrador.

export interface PortalDashboard {
  comprobantesActivos: number;
  saldoPendienteTotal: number;
  vencidosCount: number;
  proximoVencimiento: { dias: number; fecha: string } | null;
  consorciosActivos: number;
  proximosVencimientos: ComprobanteListItem[];
}

export async function getPortalDashboard(
  administracionId: string,
): Promise<ApiResponse<PortalDashboard>> {
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const [compsRes, consRes] = await Promise.all([
    supabase
      .from('comprobantes')
      .select(
        `*,
         administraciones!inner(id,nombre),
         consorcios(id,nombre)`,
      )
      .eq('administracion_id', administracionId)
      .neq('estado', 'anulado')
      .neq('estado', 'borrador')
      .order('vencimiento', { ascending: true, nullsFirst: false })
      .limit(200),
    supabase
      .from('consorcios')
      .select('id', { count: 'exact', head: true })
      .eq('administracion_id', administracionId)
      .eq('activo', true),
  ]);

  if (compsRes.error)
    return fail('PORTAL_COMPS', compsRes.error.message, compsRes.error);
  if (consRes.error)
    return fail('PORTAL_CONS', consRes.error.message, consRes.error);

  type Joined = ComprobanteRow & {
    administraciones: { id: string; nombre: string } | null;
    consorcios: { id: string; nombre: string } | null;
  };

  const rows: ComprobanteListItem[] = (compsRes.data ?? []).map((raw) => {
    const r = raw as Joined;
    const { administraciones, consorcios, ...rest } = r;
    return {
      ...(rest as ComprobanteRow),
      administracion_nombre: administraciones?.nombre ?? '—',
      consorcio_nombre: consorcios?.nombre ?? null,
    };
  });

  const pendientes = rows.filter(
    (r) =>
      r.estado_cobranza === 'pendiente' ||
      r.estado_cobranza === 'parcial' ||
      r.estado_cobranza === 'vencido',
  );
  const saldoPendienteTotal = pendientes.reduce(
    (s, r) => s + Number(r.saldo_pendiente ?? 0),
    0,
  );
  const vencidosCount = rows.filter(
    (r) => r.estado_cobranza === 'vencido',
  ).length;

  // Próximos vencimientos: dentro de 30 días, con saldo > 0, no vencidos
  const proximosVencimientos = rows
    .filter((r) => {
      if (!r.vencimiento) return false;
      if (Number(r.saldo_pendiente ?? 0) <= 0) return false;
      return r.vencimiento <= cutoffStr;
    })
    .sort((a, b) =>
      (a.vencimiento ?? '').localeCompare(b.vencimiento ?? ''),
    )
    .slice(0, 5);

  // Próximo vencimiento futuro
  const futurosCv = pendientes
    .filter((r) => r.vencimiento && r.vencimiento >= today.toISOString().slice(0, 10))
    .sort((a, b) =>
      (a.vencimiento ?? '').localeCompare(b.vencimiento ?? ''),
    );
  const proximo = futurosCv[0];
  let proximoVencimiento: PortalDashboard['proximoVencimiento'] = null;
  if (proximo?.vencimiento) {
    const venc = new Date(proximo.vencimiento + 'T00:00:00');
    const dias = Math.ceil(
      (venc.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    proximoVencimiento = { dias, fecha: proximo.vencimiento };
  }

  return ok({
    comprobantesActivos: rows.filter((r) => r.estado === 'autorizado').length,
    saldoPendienteTotal,
    vencidosCount,
    proximoVencimiento,
    consorciosActivos: consRes.count ?? 0,
    proximosVencimientos,
  });
}
