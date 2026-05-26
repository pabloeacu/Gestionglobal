// PortalMiCuentaPage · sección unificada que agrupa Cuenta corriente y
// Comprobantes bajo un solo menú. Tabs internas: "Saldo" (cta cte) y
// "Comprobantes" (listado de facturas). El saldo se desprende de los
// comprobantes — tiene sentido tenerlos en el mismo espacio.

import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Wallet, Receipt } from 'lucide-react';
import { PortalCtaCtePage } from './PortalCtaCtePage';
import { PortalComprobantesPage } from './PortalComprobantesPage';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';

type Tab = 'saldo' | 'comprobantes';

const TABS: { key: Tab; label: string; icon: typeof Wallet; desc: string }[] = [
  { key: 'saldo', label: 'Saldo & movimientos', icon: Wallet, desc: 'Tu cuenta corriente, cargos y cobranzas' },
  { key: 'comprobantes', label: 'Comprobantes', icon: Receipt, desc: 'Facturas, notas de crédito y débito' },
];

export function PortalMiCuentaPage() {
  const [params, setParams] = useSearchParams();
  const initial: Tab = params.get('tab') === 'comprobantes' ? 'comprobantes' : 'saldo';
  const [tab, setTab] = useState<Tab>(initial);

  function changeTab(t: Tab) {
    setTab(t);
    const next = new URLSearchParams(params);
    next.set('tab', t);
    setParams(next, { replace: true });
  }

  return (
    <div className="relative space-y-5 pb-12">
      <TrianglesAccent position="top-right" size={180} tone="cyan" density="soft" className="opacity-30" />

      <header className="card-premium relative overflow-hidden">
        <div className="relative p-5 sm:p-6">
          <p className="kicker text-brand-cyan">PORTAL · FINANZAS</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            Mi cuenta
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-muted">
            Tu saldo, movimientos y comprobantes en un solo lugar. El saldo se actualiza con cada cobranza imputada.
          </p>
        </div>
      </header>

      {/* Tabs */}
      <nav className="grid grid-cols-2 gap-1 rounded-2xl border border-slate-200 bg-white p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => changeTab(t.key)}
              className={`flex flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left transition sm:flex-row sm:items-center sm:gap-2.5 ${
                active
                  ? 'bg-brand-cyan-pale/80 text-brand-cyan'
                  : 'text-brand-muted hover:text-brand-ink hover:bg-slate-50'
              }`}
              aria-pressed={active}
            >
              <Icon size={16} className="flex-shrink-0" />
              <span className="flex flex-col">
                <span className="text-sm font-semibold leading-none">{t.label}</span>
                <span className="mt-0.5 hidden text-[10px] font-medium opacity-70 sm:inline">{t.desc}</span>
              </span>
            </button>
          );
        })}
      </nav>

      {/* Contenido */}
      <TabPanel show={tab === 'saldo'}>
        <PortalCtaCtePage />
      </TabPanel>
      <TabPanel show={tab === 'comprobantes'}>
        <PortalComprobantesPage />
      </TabPanel>
    </div>
  );
}

function TabPanel({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null;
  return <div className="motion-safe:animate-fade-up">{children}</div>;
}
