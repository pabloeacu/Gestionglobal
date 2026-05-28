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
  partnerMarcarFacturado,
  type PartnerComprobanteRow,
  type PartnerRendicionResumen,
} from '@/services/api/partners';
import { toast } from '@/lib/toast';

export function PartnerPortalPage() {
  const [comps, setComps] = useState<PartnerComprobanteRow[] | null>(null);
  const [rends, setRends] = useState<PartnerRendicionResumen[] | null>(null);
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
    const [c, r] = await Promise.all([
      fetchPartnerMisComprobantes(),
      fetchPartnerMisRendiciones(),
    ]);
    setComps(c.ok ? c.data : []);
    setRends(r.ok ? r.data : []);
  }

  useEffect(() => {
    void (async () => {
      await reload();
      setLoading(false);
    })();
  }, []);

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
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <p className="kicker text-brand-cyan inline-flex items-center gap-2">
                  <FileText size={14} /> Rendiciones (
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

  async function confirmar() {
    if (numero.trim().length < 1) {
      toast.error('Ingresá el número de factura externa');
      return;
    }
    setEnviando(true);
    const res = await partnerMarcarFacturado(
      comprobante.id,
      numero.trim(),
      observacion.trim() || undefined,
    );
    setEnviando(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('Comprobante marcado como facturado');
    await onDone();
  }

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
            onClick={confirmar}
            disabled={enviando || numero.trim().length < 1}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-teal disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {enviando ? (
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
