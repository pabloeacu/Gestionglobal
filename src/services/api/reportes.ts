import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import {
  generateComprobantesReportePdf,
  type ComprobanteReporteRow,
  type ComprobantesReporteFilters,
} from '@/modules/reportes/lib/generateComprobantesReportePdf';
import { generateComprobantesReporteXlsx } from '@/modules/reportes/lib/generateComprobantesReporteXlsx';
import {
  generateCtaCteReportePdf,
  type CtaCteMovimiento,
  type CtaCteCliente,
} from '@/modules/reportes/lib/generateCtaCteReportePdf';
import { generateCtaCteReporteXlsx } from '@/modules/reportes/lib/generateCtaCteReporteXlsx';
import {
  generateRecuperoReportePdf,
  type RecuperoAccionRow,
} from '@/modules/reportes/lib/generateRecuperoReportePdf';
import {
  generateTabuladorXlsx,
  type TabuladorRow,
} from '@/modules/reportes/lib/generateTabuladorXlsx';
import { savePdf, downloadBlob } from '@/modules/reportes/lib/_helpers';

// ============================================================================
// Service · reportes. Toda query a Supabase vive acá (regla 4).
// Patrón ApiResponse (P-API-01). Devuelve también previews para mostrar KPIs
// antes de exportar.
// ============================================================================

export interface ReporteComprobantesFilter extends ComprobantesReporteFilters {
  administracionId?: string;
}

export interface ReporteComprobantesPreview {
  rows: ComprobanteReporteRow[];
  totalFacturado: number;
  totalCobrado: number;
  totalPendiente: number;
  cantidad: number;
}

async function fetchComprobantesData(
  filters: ReporteComprobantesFilter,
): Promise<ApiResponse<{ rows: ComprobanteReporteRow[]; adminLabel?: string }>> {
  let q = supabase
    .from('comprobantes')
    .select(`
      fecha, tipo, punto_venta, numero,
      receptor_razon_social, receptor_numero_documento,
      total, saldo_pendiente, estado, estado_cobranza,
      administraciones!inner(id, nombre)
    `)
    .order('fecha', { ascending: true })
    .order('numero', { ascending: true });

  if (filters.desde) q = q.gte('fecha', filters.desde);
  if (filters.hasta) q = q.lte('fecha', filters.hasta);
  if (filters.administracionId) q = q.eq('administracion_id', filters.administracionId);
  if (filters.tipo && filters.tipo !== 'todos') q = q.eq('tipo', filters.tipo);
  if (filters.estado && filters.estado !== 'todos') q = q.eq('estado_cobranza', filters.estado);

  const { data, error } = await q;
  if (error) return fail('REP_COMP_FETCH', error.message, error);

  type Joined = ComprobanteReporteRow & {
    administraciones: { id: string; nombre: string } | null;
  };
  let adminLabel: string | undefined;
  const rows: ComprobanteReporteRow[] = (data ?? []).map((raw) => {
    const r = raw as unknown as Joined;
    const { administraciones, ...rest } = r;
    if (filters.administracionId && administraciones?.nombre) {
      adminLabel = administraciones.nombre;
    }
    return {
      ...(rest as ComprobanteReporteRow),
      administracion_nombre: administraciones?.nombre ?? '—',
    };
  });

  return ok({ rows, adminLabel });
}

export async function previewComprobantes(
  filters: ReporteComprobantesFilter,
): Promise<ApiResponse<ReporteComprobantesPreview>> {
  const res = await fetchComprobantesData(filters);
  if (!res.ok) return res;
  const rows = res.data.rows;
  const totalFacturado = rows.reduce((a, r) => a + Number(r.total ?? 0), 0);
  const totalPendiente = rows.reduce((a, r) => a + Number(r.saldo_pendiente ?? 0), 0);
  const totalCobrado = totalFacturado - totalPendiente;
  return ok({
    rows, totalFacturado, totalCobrado, totalPendiente, cantidad: rows.length,
  });
}

export async function descargarComprobantesPdf(
  filters: ReporteComprobantesFilter,
): Promise<ApiResponse<{ filename: string }>> {
  const res = await fetchComprobantesData(filters);
  if (!res.ok) return res;
  const filtersForPdf: ComprobantesReporteFilters = {
    desde: filters.desde, hasta: filters.hasta,
    estado: filters.estado, tipo: filters.tipo,
    administracion: res.data.adminLabel,
  };
  const doc = await generateComprobantesReportePdf(res.data.rows, filtersForPdf);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `reporte-comprobantes-${stamp}.pdf`;
  savePdf(doc, filename);
  return ok({ filename });
}

export async function descargarComprobantesXlsx(
  filters: ReporteComprobantesFilter,
): Promise<ApiResponse<{ filename: string }>> {
  const res = await fetchComprobantesData(filters);
  if (!res.ok) return res;
  const filtersForXlsx: ComprobantesReporteFilters = {
    desde: filters.desde, hasta: filters.hasta,
    estado: filters.estado, tipo: filters.tipo,
    administracion: res.data.adminLabel,
  };
  const blob = await generateComprobantesReporteXlsx(res.data.rows, filtersForXlsx);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `reporte-comprobantes-${stamp}.xlsx`;
  downloadBlob(blob, filename);
  return ok({ filename });
}

// ----------------------------------------------------------------------------
// Cuenta corriente
// ----------------------------------------------------------------------------
export interface ReporteCtaCteFilter {
  administracionId: string;
  desde?: string;
  hasta?: string;
}

async function fetchCtaCteData(
  filters: ReporteCtaCteFilter,
): Promise<ApiResponse<{ cliente: CtaCteCliente; movimientos: CtaCteMovimiento[]; saldoInicial: number }>> {
  // Cliente
  const { data: admin, error: adminErr } = await supabase
    .from('administraciones')
    .select('id, nombre, cuit, direccion, domicilio_fiscal, email')
    .eq('id', filters.administracionId)
    .maybeSingle();
  if (adminErr) return fail('REP_CTACTE_ADMIN', adminErr.message, adminErr);
  if (!admin) return fail('REP_CTACTE_404', 'Administración inexistente');

  type AdminRow = {
    nombre: string;
    cuit: string | null;
    direccion: string | null;
    domicilio_fiscal: string | null;
    email: string | null;
  };
  const a = admin as unknown as AdminRow;
  const cliente: CtaCteCliente = {
    nombre: a.nombre,
    cuit: a.cuit ?? null,
    domicilio: a.direccion ?? a.domicilio_fiscal ?? null,
    email: a.email ?? null,
  };

  // E-GG-86 / R15: UNA SOLA FUENTE DE VERDAD. El reporte consume la MISMA RPC
  // que la pantalla (`cuenta_corriente_extracto`) en vez de armar su propia query
  // paralela divergente. La vieja versión tomaba DEBE = comprobantes 'autorizado'
  // y HABER = ingresos brutos (sin join a imputaciones, sin filtro de reversión):
  // el PDF mostraba números distintos a la cta cte en pantalla y el saldo a favor
  // con el signo equivocado (saldo acreedor fantasma). Ahora el extracto incluye
  // cargos + cobranzas imputadas + saldo a favor, todo coherente con el saldo.
  const hoy = new Date();
  const desde = filters.desde
    ?? new Date(hoy.getTime() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const hasta = filters.hasta ?? hoy.toISOString().slice(0, 10);

  const { data: ext, error: extErr } = await supabase.rpc(
    'cuenta_corriente_extracto' as never,
    {
      p_administracion_id: filters.administracionId,
      p_desde: desde,
      p_hasta: hasta,
    } as never,
  );
  if (extErr) return fail('REP_CTACTE_EXT', extErr.message, extErr);

  type ExtRow = {
    fecha: string;
    tipo: 'saldo_inicial' | 'cargo' | 'abono' | 'saldo_favor';
    descripcion: string | null;
    debe: number | string;
    haber: number | string;
    saldo: number | string;
  };

  let saldoInicial = 0;
  const movimientos: CtaCteMovimiento[] = [];
  for (const r of (ext ?? []) as unknown as ExtRow[]) {
    if (r.tipo === 'saldo_inicial') {
      saldoInicial = Number(r.saldo) || 0;
      continue;
    }
    movimientos.push({
      fecha: r.fecha,
      concepto: r.descripcion ?? '',
      referencia: null,
      debe: Number(r.debe) || 0,
      haber: Number(r.haber) || 0,
    });
  }

  return ok({ cliente, movimientos, saldoInicial });
}

export async function descargarCtaCtePdf(
  filters: ReporteCtaCteFilter,
): Promise<ApiResponse<{ filename: string }>> {
  const res = await fetchCtaCteData(filters);
  if (!res.ok) return res;
  const doc = await generateCtaCteReportePdf({
    cliente: res.data.cliente,
    movimientos: res.data.movimientos,
    saldoInicial: res.data.saldoInicial,
    desde: filters.desde,
    hasta: filters.hasta,
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = res.data.cliente.nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
  const filename = `cta-cte-${slug}-${stamp}.pdf`;
  savePdf(doc, filename);
  return ok({ filename });
}

export async function descargarCtaCteXlsx(
  filters: ReporteCtaCteFilter,
): Promise<ApiResponse<{ filename: string }>> {
  const res = await fetchCtaCteData(filters);
  if (!res.ok) return res;
  const blob = await generateCtaCteReporteXlsx({
    cliente: res.data.cliente,
    movimientos: res.data.movimientos,
    saldoInicial: res.data.saldoInicial,
    desde: filters.desde,
    hasta: filters.hasta,
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = res.data.cliente.nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
  const filename = `cta-cte-${slug}-${stamp}.xlsx`;
  downloadBlob(blob, filename);
  return ok({ filename });
}

// ----------------------------------------------------------------------------
// Recupero — best effort: si la tabla `recupero_acciones` no existe todavía
// (otro agente la crea), devolvemos 0 filas con un mensaje informativo.
// ----------------------------------------------------------------------------
export interface ReporteRecuperoFilter {
  desde?: string;
  hasta?: string;
  nivel?: 'R1' | 'R2' | 'R3' | 'todos';
}

async function fetchRecuperoData(
  filters: ReporteRecuperoFilter,
): Promise<ApiResponse<{ rows: RecuperoAccionRow[] }>> {
  // La tabla recupero_acciones la crea otro agente (subsistema recupero).
  // Hasta entonces, no figura en `types/database.ts`; usamos cast a unknown
  // para no acoplarnos a un nombre que TS no conoce todavía.
  type RecRow = {
    fecha: string; nivel: string; monto: number; estado: string; notas: string | null;
    administraciones: { nombre: string } | null;
    comprobantes: { tipo: string; punto_venta: number; numero: number | null } | null;
  };
  const dyn = supabase as unknown as {
    from(t: string): {
      select(s: string): {
        order(c: string, o: { ascending: boolean }): {
          gte(c: string, v: string): unknown;
          lte(c: string, v: string): unknown;
          eq(c: string, v: string): unknown;
        };
      };
    };
  };
  let q: unknown = dyn
    .from('recupero_acciones')
    .select('fecha, nivel, monto, estado, notas, administraciones(nombre), comprobantes(tipo, punto_venta, numero)')
    .order('fecha', { ascending: true });
  const qBuilder = q as {
    gte: (c: string, v: string) => unknown;
    lte: (c: string, v: string) => unknown;
    eq: (c: string, v: string) => unknown;
    then?: (cb: (r: unknown) => unknown) => unknown;
  };
  if (filters.desde) q = qBuilder.gte('fecha', filters.desde);
  if (filters.hasta) q = (q as typeof qBuilder).lte('fecha', filters.hasta);
  if (filters.nivel && filters.nivel !== 'todos') q = (q as typeof qBuilder).eq('nivel', filters.nivel);

  const resp = await (q as unknown as Promise<{ data: RecRow[] | null; error: { message: string } | null }>);
  if (resp.error) {
    if (/does not exist|undefined_table|schema cache/i.test(resp.error.message)) {
      return ok({ rows: [] });
    }
    return fail('REP_RECUPERO_FETCH', resp.error.message, resp.error);
  }

  const rows: RecuperoAccionRow[] = (resp.data ?? []).map((r) => ({
    fecha: r.fecha,
    cliente: r.administraciones?.nombre ?? '—',
    comprobante_ref: r.comprobantes
      ? `${r.comprobantes.tipo} ${r.comprobantes.numero
          ? `${String(r.comprobantes.punto_venta).padStart(5,'0')}-${String(r.comprobantes.numero).padStart(8,'0')}`
          : 'sin nº'}`
      : null,
    nivel: r.nivel,
    monto: Number(r.monto ?? 0),
    estado: r.estado,
    notas: r.notas,
  }));
  return ok({ rows });
}

export async function descargarRecuperoPdf(
  filters: ReporteRecuperoFilter,
): Promise<ApiResponse<{ filename: string }>> {
  const res = await fetchRecuperoData(filters);
  if (!res.ok) return res;
  const doc = await generateRecuperoReportePdf({
    desde: filters.desde, hasta: filters.hasta, rows: res.data.rows,
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `reporte-recupero-${stamp}.pdf`;
  savePdf(doc, filename);
  return ok({ filename });
}

// ----------------------------------------------------------------------------
// Tabulador (sólo .xlsx — el PDF no agrega valor frente a la lista en pantalla)
// ----------------------------------------------------------------------------
export async function descargarTabuladorXlsx(): Promise<ApiResponse<{ filename: string }>> {
  const { data: cats, error: catsErr } = await supabase
    .from('categorias_servicio')
    .select('id, codigo, nombre, orden');
  if (catsErr) return fail('REP_TAB_CATS', catsErr.message, catsErr);
  type Cat = { id: string; codigo: string; nombre: string };
  const catMap = new Map<string, Cat>(
    ((cats ?? []) as unknown as Cat[]).map((c) => [c.id, c]),
  );

  const { data: servs, error: servsErr } = await supabase
    .from('servicios')
    .select('id, codigo, nombre, categoria_id, precio_modo, activo')
    .order('codigo', { ascending: true });
  if (servsErr) return fail('REP_TAB_SERV', servsErr.message, servsErr);

  type Serv = {
    id: string; codigo: string; nombre: string; categoria_id: string;
    precio_modo: string; activo: boolean;
  };
  const servArr = (servs ?? []) as unknown as Serv[];

  const ids = servArr.map((s) => s.id);
  const { data: precios, error: precErr } = await supabase
    .from('tabulador_precios')
    .select('id, servicio_id, precio')
    .in('servicio_id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'])
    .is('administracion_id', null)
    .is('consorcio_id', null)
    .is('convenio', null)
    .is('vigente_hasta', null);
  if (precErr) return fail('REP_TAB_PRECIOS', precErr.message, precErr);
  type Precio = { servicio_id: string; precio: number };
  const precioMap = new Map<string, number>(
    ((precios ?? []) as unknown as Precio[]).map((p) => [p.servicio_id, Number(p.precio)]),
  );

  const rows: TabuladorRow[] = servArr.map((s) => {
    const c = catMap.get(s.categoria_id);
    return {
      codigo: s.codigo,
      nombre: s.nombre,
      categoria_codigo: c?.codigo ?? '',
      categoria_nombre: c?.nombre ?? '—',
      precio_modo: s.precio_modo,
      precio_vigente: precioMap.get(s.id) ?? null,
      unidad: null,
      activo: s.activo,
    };
  });

  const blob = await generateTabuladorXlsx(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `tabulador-${stamp}.xlsx`;
  downloadBlob(blob, filename);
  return ok({ filename });
}
