// #149 · Vista del usuario role='partner'. Lee 2 RPCs SECURITY DEFINER
// (partner_mis_comprobantes / partner_mis_rendiciones) que ya filtran por
// partner_id del profile. Visualización read-only — el partner no edita.

import { useEffect, useState } from 'react';
import {
  Loader2,
  Receipt,
  FileText,
  Briefcase,
  CheckCircle2,
  FileCheck2,
  X as XIcon,
} from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import {
  fetchPartnerMisComprobantes,
  fetchPartnerMisRendiciones,
  fetchPartnerMovimientos,
  partnerMarcarFacturado,
  type PartnerComprobanteRow,
  type PartnerRendicionResumen,
  type PartnerMovimientoRow,
} from '@/services/api/partners';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';

export function PartnerPortalPage() {
  const [comps, setComps] = useState<PartnerComprobanteRow[] | null>(null);
  const [rends, setRends] = useState<PartnerRendicionResumen[] | null>(null);
  // Bloque D / obs 8: movimientos detallados con saldo evolutivo
  const [movs, setMovs] = useState<PartnerMovimientoRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [openFacturar, setOpenFacturar] = useState<PartnerComprobanteRow | null>(null);
  // #9 walkthrough · filtros de fecha
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  function pasaFiltro(fecha: string): boolean {
    if (desde && fecha < desde) return false;
    if (hasta && fecha > hasta) return false;
    return true;
  }

  async function reload() {
    const [c, r, m] = await Promise.all([
      fetchPartnerMisComprobantes(),
      fetchPartnerMisRendiciones(),
      fetchPartnerMovimientos(desde || null, hasta || null),
    ]);
    setComps(c.ok ? c.data : []);
    setRends(r.ok ? r.data : []);
    setMovs(m.ok ? m.data : []);
  }

  useEffect(() => {
    void (async () => {
      await reload();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta]);

  // Totales del periodo filtrado (de los movimientos detallados)
  const totalIngresos = (movs ?? []).filter((m) => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.monto_atribuido), 0);
  const totalEgresos = (movs ?? []).filter((m) => m.tipo === 'egreso').reduce((s, m) => s + Number(m.monto_atribuido), 0);
  const movsList = movs ?? [];
  const saldoFinal = movsList.length > 0
    ? Number(movsList[movsList.length - 1]!.saldo_running)
    : 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="relative overflow-hidden bg-gradient-to-br from-brand-cyan via-brand-cyan to-brand-teal py-10 text-white shadow">
        <TrianglesAccent position="top-right" size={260} tone="cyan" density="rich" className="opacity-50" />
        <TrianglesAccent position="bottom-left" size={180} tone="teal" density="soft" className="opacity-40" />
        <div className="relative mx-auto max-w-5xl px-6">
          <div className="flex items-center gap-2 text-sm text-white/85">
            <Briefcase size={16} /> Portal partner · Gestión Global
          </div>
          <h1 className="mt-3 font-display text-3xl font-bold sm:text-4xl">
            Mis rendiciones y comprobantes
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
        {loading && (
          <div className="grid place-items-center rounded-2xl border border-slate-200 bg-white p-12 text-brand-muted shadow-sm">
            <Loader2 className="mb-2 animate-spin" />
            <p className="text-sm">Cargando…</p>
          </div>
        )}

        {!loading && (
          <>
            {/* Bloque D / obs 8 — Mi caja con saldo evolutivo */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="kicker text-brand-cyan inline-flex items-center gap-2">
                    <Briefcase size={14} /> Mi caja · Movimientos detallados
                  </p>
                  <p className="mt-0.5 text-xs text-brand-muted">
                    Cada operación atribuida al partner con su % de convenio y saldo evolutivo.
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-xs text-brand-muted">
                    Desde
                    <input
                      type="date"
                      value={desde}
                      onChange={(e) => setDesde(e.target.value)}
                      className="ml-1 rounded border border-slate-200 px-1.5 py-0.5 text-xs"
                    />
                  </label>
                  <label className="text-xs text-brand-muted">
                    Hasta
                    <input
                      type="date"
                      value={hasta}
                      onChange={(e) => setHasta(e.target.value)}
                      className="ml-1 rounded border border-slate-200 px-1.5 py-0.5 text-xs"
                    />
                  </label>
                  {(desde || hasta) && (
                    <button
                      type="button"
                      onClick={() => {
                        setDesde('');
                        setHasta('');
                      }}
                      className="text-xs text-brand-cyan hover:underline"
                    >
                      Limpiar
                    </button>
                  )}
                </div>
              </div>

              {/* Cards de totales del periodo */}
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
                  <p className="kicker text-emerald-700">Ingresos atribuidos</p>
                  <p className="mt-1 font-display text-xl font-bold text-emerald-700 tabular">
                    {fmtMoney(totalIngresos)}
                  </p>
                </div>
                <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-3">
                  <p className="kicker text-rose-700">Egresos atribuidos</p>
                  <p className="mt-1 font-display text-xl font-bold text-rose-700 tabular">
                    {fmtMoney(totalEgresos)}
                  </p>
                </div>
                <div className={`rounded-xl border p-3 ${saldoFinal >= 0 ? 'border-brand-cyan/30 bg-brand-cyan-pale/30' : 'border-rose-200 bg-rose-50/40'}`}>
                  <p className="kicker text-brand-cyan">Saldo evolutivo</p>
                  <p className={`mt-1 font-display text-xl font-bold tabular ${saldoFinal >= 0 ? 'text-brand-cyan' : 'text-rose-700'}`}>
                    {fmtMoney(saldoFinal)}
                  </p>
                </div>
              </div>

              {movs && movs.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-brand-muted">
                      <tr className="border-b border-slate-100">
                        <th className="py-2 px-2 text-left">Fecha</th>
                        <th className="py-2 px-2 text-left">Cliente</th>
                        <th className="py-2 px-2 text-left">Servicio</th>
                        <th className="py-2 px-2 text-left">Comprobante</th>
                        <th className="py-2 px-2 text-right">Monto base</th>
                        <th className="py-2 px-2 text-right">%</th>
                        <th className="py-2 px-2 text-right">Atribuido</th>
                        <th className="py-2 px-2 text-right">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movs.map((m) => (
                        <tr key={m.atribucion_id} className="border-b border-slate-50 hover:bg-slate-50/50">
                          <td className="py-2 px-2 tabular text-xs text-brand-muted">{fmtDate(m.fecha)}</td>
                          <td className="py-2 px-2">{m.cliente_nombre ?? '—'}</td>
                          <td className="py-2 px-2 text-xs">{m.servicio_nombre ?? '—'}</td>
                          <td className="py-2 px-2 text-xs font-mono">{m.comprobante_label}</td>
                          <td className="py-2 px-2 text-right tabular">{fmtMoney(m.monto_base)}</td>
                          <td className="py-2 px-2 text-right tabular text-brand-muted">{Number(m.porcentaje).toFixed(1)}%</td>
                          <td className={`py-2 px-2 text-right tabular font-medium ${m.tipo === 'ingreso' ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {m.tipo === 'ingreso' ? '+' : '-'} {fmtMoney(m.monto_atribuido)}
                          </td>
                          <td className={`py-2 px-2 text-right tabular font-semibold ${Number(m.saldo_running) >= 0 ? 'text-brand-ink' : 'text-rose-700'}`}>
                            {fmtMoney(m.saldo_running)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-brand-muted">
                  No hay movimientos atribuidos a tu cuenta en este período.
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <p className="kicker text-brand-cyan inline-flex items-center gap-2">
                  <FileText size={14} /> Resumen por período (
                  {rends?.filter((r) => pasaFiltro(r.periodo_desde)).length ?? 0}
                  )
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-xs text-brand-muted">
                    Desde
                    <input
                      type="date"
                      value={desde}
                      onChange={(e) => setDesde(e.target.value)}
                      className="ml-1 rounded border border-slate-200 px-1.5 py-0.5 text-xs"
                    />
                  </label>
                  <label className="text-xs text-brand-muted">
                    Hasta
                    <input
                      type="date"
                      value={hasta}
                      onChange={(e) => setHasta(e.target.value)}
                      className="ml-1 rounded border border-slate-200 px-1.5 py-0.5 text-xs"
                    />
                  </label>
                  {(desde || hasta) && (
                    <button
                      type="button"
                      onClick={() => {
                        setDesde('');
                        setHasta('');
                      }}
                      className="text-xs text-brand-cyan hover:underline"
                    >
                      Limpiar
                    </button>
                  )}
                </div>
              </div>
              {rends && rends.filter((r) => pasaFiltro(r.periodo_desde)).length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-brand-muted">
                      <tr>
                        <th className="py-2 text-left">Período</th>
                        <th className="py-2 text-left">Estado</th>
                        <th className="py-2 text-right">Ingresos base</th>
                        <th className="py-2 text-right">Ingresos atribuidos</th>
                        <th className="py-2 text-right">Costos base</th>
                        <th className="py-2 text-right">Costos atribuidos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rends
                        .filter((r) => pasaFiltro(r.periodo_desde))
                        .map((r) => (
                          <tr key={r.id} className="border-t border-slate-100">
                            <td className="py-2">
                              {fmtDate(r.periodo_desde)} → {fmtDate(r.periodo_hasta)}
                            </td>
                            <td className="py-2 capitalize">{r.estado}</td>
                            <td className="py-2 text-right">{fmtMoney(r.total_ingresos_brutos)}</td>
                            <td className="py-2 text-right text-emerald-700">{fmtMoney(r.total_ingresos_atribuidos)}</td>
                            <td className="py-2 text-right">{fmtMoney(r.total_costos_brutos)}</td>
                            <td className="py-2 text-right text-rose-700">{fmtMoney(r.total_costos_atribuidos)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-brand-muted">
                  {rends && rends.length > 0
                    ? 'No hay rendiciones que coincidan con el filtro.'
                    : 'Aún no hay rendiciones cerradas para tu cuenta.'}
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="kicker mb-3 text-brand-cyan inline-flex items-center gap-2">
                <Receipt size={14} /> Comprobantes asignados ({comps?.length ?? 0})
              </p>
              {comps && comps.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-brand-muted">
                      <tr>
                        <th className="py-2 text-left">Comprobante</th>
                        <th className="py-2 text-left">Receptor</th>
                        <th className="py-2 text-left">Fecha</th>
                        <th className="py-2 text-right">Total</th>
                        <th className="py-2 text-center">Estado</th>
                        <th className="py-2 text-center">Facturación</th>
                        <th className="py-2 text-right">Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comps.map((c) => (
                        <tr key={c.id} className="border-t border-slate-100">
                          <td className="py-2">
                            {c.tipo} · PV {String(c.punto_venta).padStart(4, '0')}
                            {c.numero ? ' · Nº ' + String(c.numero).padStart(8, '0') : ''}
                          </td>
                          <td className="py-2">{c.receptor_razon_social}</td>
                          <td className="py-2">{fmtDate(c.fecha)}</td>
                          <td className="py-2 text-right">{fmtMoney(c.total)}</td>
                          <td className="py-2 text-center capitalize">{c.estado}</td>
                          <td className="py-2 text-center">
                            {c.partner_facturado_at ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                <CheckCircle2 size={10} /> Facturado · {c.partner_numero_externo}
                              </span>
                            ) : (
                              <span className="text-xs text-brand-muted">Pendiente</span>
                            )}
                          </td>
                          <td className="py-2 text-right">
                            {c.estado === 'anulado' ? (
                              <span className="text-xs text-rose-600">—</span>
                            ) : c.partner_facturado_at ? (
                              <span className="text-xs text-emerald-600">Listo</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setOpenFacturar(c)}
                                className="inline-flex items-center gap-1 rounded-lg bg-brand-cyan px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-teal"
                              >
                                <FileCheck2 size={11} /> Realizar factura
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-brand-muted">
                  No tenés comprobantes asignados a tu emisor todavía.
                </p>
              )}
            </section>
          </>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-brand-muted">
        Gestión Global · gestionglobal.ar
      </footer>

      {openFacturar && (
        <ModalFacturar
          comprobante={openFacturar}
          onClose={() => setOpenFacturar(null)}
          onDone={async () => {
            setOpenFacturar(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

function ModalFacturar({
  comprobante,
  onClose,
  onDone,
}: {
  comprobante: PartnerComprobanteRow;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [numero, setNumero] = useState('');
  const [observacion, setObservacion] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Bloque G / obs 11: PDF de la factura del partner. Si se sube, queda
  // adjunto al comprobante y disponible para cliente/gerencia/partner.
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [subiendoPdf, setSubiendoPdf] = useState(false);

  async function subirPdfYConfirmar(): Promise<void> {
    if (numero.trim().length < 1) {
      toast.error('Ingresá el número de factura externa');
      return;
    }
    let pdfUrl: string | undefined;
    if (pdfFile) {
      setSubiendoPdf(true);
      try {
        const ts = Date.now();
        const rand = Math.random().toString(36).slice(2, 8);
        const safeName = pdfFile.name.replace(/[^\w.\-]/g, '_');
        const path = `${comprobante.id}/${ts}-${rand}-${safeName}`;
        const { supabase } = await import('@/lib/supabase');
        const { error } = await supabase.storage
          .from('partner-facturas')
          .upload(path, pdfFile, {
            upsert: false,
            contentType: pdfFile.type || 'application/pdf',
          });
        if (error) throw error;
        const pub = supabase.storage.from('partner-facturas').getPublicUrl(path);
        pdfUrl = pub.data.publicUrl;
      } catch (e) {
        setSubiendoPdf(false);
        toast.error('No pudimos subir el PDF', {
          description: (e as Error).message,
        });
        return;
      }
      setSubiendoPdf(false);
    }
    setEnviando(true);
    const res = await partnerMarcarFacturado(
      comprobante.id,
      numero.trim(),
      observacion.trim() || undefined,
      pdfUrl,
    );
    setEnviando(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success(
      pdfUrl
        ? 'Comprobante facturado con PDF adjunto'
        : 'Comprobante marcado como facturado',
    );
    await onDone();
  }

  const confirmar = subirPdfYConfirmar;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="kicker text-brand-cyan">Realizar factura</p>
            <h2 className="font-display text-xl font-bold text-brand-ink">
              {comprobante.tipo} · PV {String(comprobante.punto_venta).padStart(4, '0')}
              {comprobante.numero
                ? ' · Nº ' + String(comprobante.numero).padStart(8, '0')
                : ''}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-brand-muted hover:bg-slate-100 hover:text-brand-ink"
            aria-label="Cerrar"
          >
            <XIcon size={16} />
          </button>
        </div>

        <dl className="mb-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-xs">
          <div>
            <dt className="text-brand-muted">Receptor</dt>
            <dd className="font-medium text-brand-ink">
              {comprobante.receptor_razon_social}
            </dd>
          </div>
          <div>
            <dt className="text-brand-muted">Fecha</dt>
            <dd className="text-brand-ink">{fmtDate(comprobante.fecha)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-brand-muted">Total</dt>
            <dd className="text-base font-semibold text-brand-ink">
              {fmtMoney(comprobante.total)}
            </dd>
          </div>
        </dl>

        <div className="space-y-3">
          <label className="block">
            <span className="kicker text-brand-muted">
              Número de factura externa
            </span>
            <input
              type="text"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="Ej. 0001-00000123"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/20"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="kicker text-brand-muted">Observación (opcional)</span>
            <textarea
              rows={2}
              value={observacion}
              onChange={(e) => setObservacion(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/20"
              placeholder="Notas internas para la gerencia…"
            />
          </label>
          <label className="block">
            <span className="kicker text-brand-muted">
              PDF de la factura (opcional pero recomendado)
            </span>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-1.5 text-sm file:mr-2 file:rounded file:border-0 file:bg-brand-cyan-pale/40 file:px-2 file:py-1 file:text-xs file:font-medium file:text-brand-cyan"
            />
            {pdfFile && (
              <p className="mt-1 text-[11px] text-emerald-700">
                ✓ {pdfFile.name} ({Math.round(pdfFile.size / 1024)} KB)
              </p>
            )}
            <p className="mt-1 text-[11px] text-brand-muted">
              Si subís el PDF, queda asociado al comprobante. El cliente lo
              descarga desde su portal, la gerencia desde la ficha. Si no lo
              subís ahora, podés hacerlo más tarde.
            </p>
          </label>
          <p className="text-xs text-brand-muted">
            Al confirmar, la gerencia recibirá una notificación con tu número
            de factura. Esta acción no se puede deshacer.
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={enviando}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand-muted hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void confirmar()}
            disabled={enviando || subiendoPdf || numero.trim().length < 1}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-teal disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {subiendoPdf ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Subiendo PDF…
              </>
            ) : enviando ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Confirmando…
              </>
            ) : (
              <>
                <FileCheck2 size={13} /> Confirmar facturación
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function fmtMoney(n: number | string): string {
  const num = typeof n === 'string' ? Number(n) : n;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  }).format(num);
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default PartnerPortalPage;
