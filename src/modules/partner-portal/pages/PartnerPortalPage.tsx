// #149 · Vista del usuario role='partner'. Lee 2 RPCs SECURITY DEFINER
// (partner_mis_comprobantes / partner_mis_rendiciones) que ya filtran por
// partner_id del profile. Visualización read-only — el partner no edita.

import { useEffect, useState } from 'react';
import { Loader2, Receipt, FileText, Briefcase } from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import {
  fetchPartnerMisComprobantes,
  fetchPartnerMisRendiciones,
  type PartnerComprobanteRow,
  type PartnerRendicionResumen,
} from '@/services/api/partners';

export function PartnerPortalPage() {
  const [comps, setComps] = useState<PartnerComprobanteRow[] | null>(null);
  const [rends, setRends] = useState<PartnerRendicionResumen[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const [c, r] = await Promise.all([
        fetchPartnerMisComprobantes(),
        fetchPartnerMisRendiciones(),
      ]);
      setComps(c.ok ? c.data : []);
      setRends(r.ok ? r.data : []);
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
              <p className="kicker mb-3 text-brand-cyan inline-flex items-center gap-2">
                <FileText size={14} /> Rendiciones ({rends?.length ?? 0})
              </p>
              {rends && rends.length > 0 ? (
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
                      {rends.map((r) => (
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
                  Aún no hay rendiciones cerradas para tu cuenta.
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
                        <th className="py-2 text-center">ARCA</th>
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
                            {c.emitido_arca ? '✓' : '—'}
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
