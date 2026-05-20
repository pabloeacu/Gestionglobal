import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

export type CajaRow = Database['public']['Tables']['cajas']['Row'];
export type CategoriaFinanzaRow = Database['public']['Tables']['categorias_finanzas']['Row'];
export type MovimientoRow = Database['public']['Tables']['movimientos']['Row'];
export type ImputacionRow = Database['public']['Tables']['movimiento_imputaciones']['Row'];

export interface CobranzaInput {
  comprobante_id: string;
  caja_id: string;
  fecha: string;          // YYYY-MM-DD
  monto: number;
  descripcion?: string;
  referencia?: string;
  categoria_id?: string | null;
}

export async function registrarCobranza(
  input: CobranzaInput,
): Promise<ApiResponse<{ movimiento_id: string }>> {
  const { data, error } = await supabase.rpc('registrar_cobranza_comprobante', {
    p_comprobante_id: input.comprobante_id,
    p_caja_id: input.caja_id,
    p_fecha: input.fecha,
    p_monto: input.monto,
    p_descripcion: input.descripcion ?? '',
    p_referencia: input.referencia ?? '',
    p_categoria_id: input.categoria_id ?? null,
  } as unknown as {
    p_comprobante_id: string;
    p_caja_id: string;
    p_fecha: string;
    p_monto: number;
    p_descripcion: string;
    p_referencia: string;
    p_categoria_id: string;
  });
  if (error) return fail('COBR_REGISTRAR', error.message, error);
  return ok({ movimiento_id: data as string });
}

export async function desimputarCobranza(
  imputacion_id: string,
): Promise<ApiResponse<{ comprobante_id: string }>> {
  const { data, error } = await supabase.rpc('desimputar_cobranza', {
    p_imputacion_id: imputacion_id,
  });
  if (error) return fail('COBR_DESIMPUTAR', error.message, error);
  return ok({ comprobante_id: data as string });
}

export async function listCajasActivas(): Promise<ApiResponse<CajaRow[]>> {
  const { data, error } = await supabase
    .from('cajas')
    .select('*')
    .eq('activo', true)
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true });
  if (error) return fail('CAJAS_LIST', error.message, error);
  return ok(data ?? []);
}

export async function listCategoriasIngreso(): Promise<
  ApiResponse<CategoriaFinanzaRow[]>
> {
  const { data, error } = await supabase
    .from('categorias_finanzas')
    .select('*')
    .eq('activo', true)
    .eq('tipo', 'ingreso')
    .order('nombre', { ascending: true });
  if (error) return fail('CAT_LIST', error.message, error);
  return ok(data ?? []);
}

export interface CobranzaListItem extends ImputacionRow {
  movimiento: MovimientoRow & {
    caja_nombre: string | null;
    categoria_nombre: string | null;
  };
}

// Cobranzas de un comprobante: imputaciones + datos del movimiento + caja.
export async function listCobranzasDeComprobante(
  comprobante_id: string,
): Promise<ApiResponse<CobranzaListItem[]>> {
  const { data, error } = await supabase
    .from('movimiento_imputaciones')
    .select(
      `*,
       movimiento:movimientos!inner(
         *,
         caja:cajas(nombre),
         categoria:categorias_finanzas(nombre)
       )`,
    )
    .eq('comprobante_id', comprobante_id)
    .order('created_at', { ascending: false });
  if (error) return fail('COBR_LIST', error.message, error);

  type Joined = ImputacionRow & {
    movimiento: MovimientoRow & {
      caja: { nombre: string } | null;
      categoria: { nombre: string } | null;
    };
  };
  const rows: CobranzaListItem[] = (data ?? []).map((raw) => {
    const r = raw as Joined;
    const { caja, categoria, ...mov } = r.movimiento;
    return {
      ...(r as ImputacionRow),
      movimiento: {
        ...(mov as MovimientoRow),
        caja_nombre: caja?.nombre ?? null,
        categoria_nombre: categoria?.nombre ?? null,
      },
    };
  });
  return ok(rows);
}

// Timeline de cuenta corriente del cliente: comprobantes + cobranzas mezclados
// en orden cronológico inverso, con saldo acumulado.
export interface CtaCteEntry {
  id: string;
  fecha: string;
  tipo: 'comprobante' | 'cobranza';
  titulo: string;
  detalle: string | null;
  signo: 1 | -1; // +1 cargo (comprobante), -1 abono (cobranza)
  monto: number;
  saldo: number; // acumulado al final de esta entrada
  comprobante_id: string | null;
  consorcio_nombre: string | null;
}

export async function listCtaCteAdministracion(
  administracion_id: string,
): Promise<ApiResponse<CtaCteEntry[]>> {
  // Comprobantes (cargos): autorizados, no anulados.
  const compsRes = await supabase
    .from('comprobantes')
    .select('id, tipo, punto_venta, numero, fecha, total, estado, consorcios(nombre)')
    .eq('administracion_id', administracion_id)
    .neq('estado', 'anulado')
    .neq('estado', 'borrador')
    .order('fecha', { ascending: true });
  if (compsRes.error) return fail('CTACTE_COMPS', compsRes.error.message, compsRes.error);

  // Imputaciones (abonos) hacia comprobantes de esta admin.
  const impsRes = await supabase
    .from('movimiento_imputaciones')
    .select(
      `id, monto_imputado, created_at, comprobante_id,
       movimiento:movimientos!inner(fecha, descripcion, referencia)`,
    )
    .not('comprobante_id', 'is', null);
  if (impsRes.error) return fail('CTACTE_IMPS', impsRes.error.message, impsRes.error);

  type CompRow = {
    id: string;
    tipo: string;
    punto_venta: number;
    numero: number | null;
    fecha: string;
    total: number | string;
    consorcios: { nombre: string } | null;
  };
  type ImpRow = {
    id: string;
    monto_imputado: number | string;
    comprobante_id: string;
    movimiento: { fecha: string; descripcion: string | null; referencia: string | null };
  };

  // Filtramos imputaciones cuyo comprobante pertenece a esta admin.
  const compIdsDeLaAdmin = new Set((compsRes.data ?? []).map((c) => (c as CompRow).id));
  const impsFiltradas = ((impsRes.data ?? []) as ImpRow[]).filter((i) =>
    compIdsDeLaAdmin.has(i.comprobante_id),
  );

  const entries: Array<Omit<CtaCteEntry, 'saldo'>> = [];

  for (const raw of (compsRes.data ?? []) as CompRow[]) {
    const numStr = raw.numero
      ? `${String(raw.punto_venta).padStart(5, '0')}-${String(raw.numero).padStart(8, '0')}`
      : '—';
    entries.push({
      id: `c:${raw.id}`,
      fecha: raw.fecha,
      tipo: 'comprobante',
      titulo: `${raw.tipo} ${numStr}`,
      detalle: raw.consorcios?.nombre ?? null,
      signo: 1,
      monto: Number(raw.total),
      comprobante_id: raw.id,
      consorcio_nombre: raw.consorcios?.nombre ?? null,
    });
  }

  for (const i of impsFiltradas) {
    entries.push({
      id: `i:${i.id}`,
      fecha: i.movimiento.fecha,
      tipo: 'cobranza',
      titulo:
        i.movimiento.descripcion?.trim() ||
        `Cobranza${i.movimiento.referencia ? ` · ${i.movimiento.referencia}` : ''}`,
      detalle: i.movimiento.referencia ?? null,
      signo: -1,
      monto: Number(i.monto_imputado),
      comprobante_id: i.comprobante_id,
      consorcio_nombre: null,
    });
  }

  // Orden cronológico ASC para acumular el saldo, después invertimos para mostrar.
  entries.sort((a, b) =>
    a.fecha === b.fecha ? a.id.localeCompare(b.id) : a.fecha.localeCompare(b.fecha),
  );

  let saldo = 0;
  const withSaldo: CtaCteEntry[] = entries.map((e) => {
    saldo += e.signo * e.monto;
    return { ...e, saldo };
  });

  // Mostrar más recientes arriba.
  return ok(withSaldo.reverse());
}
