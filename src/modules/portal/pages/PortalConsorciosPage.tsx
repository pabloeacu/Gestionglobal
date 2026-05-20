import { useEffect, useState } from 'react';
import { Building2, Users, Wallet, FileText, Hash } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import {
  listConsorciosByAdministracion,
  type ConsorcioRow,
} from '@/services/api/consorcios';
import { CopyButton } from '@/components/common';
import { cn } from '@/lib/cn';

// Read-only de los consorcios del administrador. El cliente no puede crear,
// editar ni dar de baja sus consorcios desde el portal — eso lo hace el
// staff de Gestión Global. Sólo visualización.

export function PortalConsorciosPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ConsorcioRow[]>([]);
  const [selected, setSelected] = useState<ConsorcioRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.administracionId) return;
    setLoading(true);
    setError(null);
    void listConsorciosByAdministracion(user.administracionId, true).then(
      (res) => {
        setLoading(false);
        if (!res.ok) {
          setError(res.error.message);
          return;
        }
        setRows(res.data);
      },
    );
  }, [user?.administracionId]);

  if (!user?.administracionId) {
    return (
      <div className="mx-auto max-w-md p-12 text-center text-sm text-brand-muted">
        Tu cuenta no tiene una administración asociada.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="grid place-items-center p-16">
        <BrandLoader size={56} label="Cargando consorcios" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <p className="kicker text-brand-cyan">Mis consorcios</p>
        <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
          Consorcios
        </h1>
        <p className="mt-1 text-sm text-brand-muted">
          Edificios que administrás. La información se gestiona desde Gestión
          Global; cualquier cambio, escribinos.
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {rows.length === 0 && !error ? (
        <div className="card-premium relative overflow-hidden p-12 text-center">
          <TrianglesAccent
            position="top-right"
            size={180}
            tone="cyan"
            density="soft"
            className="opacity-25"
          />
          <div className="relative">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-cyan-pale/40 text-brand-cyan">
              <Building2 size={24} />
            </span>
            <h2 className="mt-3 font-display text-lg font-bold text-brand-ink">
              Sin consorcios cargados
            </h2>
            <p className="mt-1 text-sm text-brand-muted">
              Cuando se carguen los consorcios de tu administración, los vas a
              ver acá.
            </p>
          </div>
        </div>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c, idx) => (
            <ConsorcioCard
              key={c.id}
              consorcio={c}
              onClick={() => setSelected(c)}
              delay={Math.min(idx, 9) * 40}
            />
          ))}
        </section>
      )}

      {selected && (
        <ConsorcioDetailModal
          consorcio={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function ConsorcioCard({
  consorcio,
  onClick,
  delay,
}: {
  consorcio: ConsorcioRow;
  onClick: () => void;
  delay: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 text-left transition motion-safe:animate-fade-up hover:-translate-y-0.5 hover:border-brand-cyan/60 hover:shadow-md',
        !consorcio.activo && 'opacity-70',
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <TrianglesAccent
        position="top-right"
        size={120}
        tone="cyan"
        density="soft"
        className="opacity-25 transition group-hover:opacity-40"
      />
      <div className="relative">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-cyan-pale/40 text-brand-cyan transition group-hover:bg-brand-cyan group-hover:text-white">
            <Building2 size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="kicker text-brand-muted">
              <span className="font-mono">{consorcio.codigo}</span>
            </p>
            <h3 className="mt-0.5 truncate font-display text-base font-bold text-brand-ink">
              {consorcio.nombre}
            </h3>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <Stat
            icon={Users}
            label="Unidades"
            value={String(consorcio.unidades_funcionales)}
          />
          <Stat
            icon={Wallet}
            label="Abono"
            value={formatMoney(Number(consorcio.monto_abono ?? 0))}
          />
        </dl>
        <div className="mt-3 flex items-center justify-between">
          <span
            className={cn(
              'inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold',
              consorcio.activo
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-slate-100 text-slate-600',
            )}
          >
            {consorcio.activo ? 'Activo' : 'Baja'}
          </span>
          <span className="text-[11px] text-brand-muted">
            {consorcio.tipo_documento === 'cuit' ? 'CUIT' : 'DNI'}{' '}
            <span className="tabular">{consorcio.numero_documento}</span>
          </span>
        </div>
      </div>
    </button>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-brand-zebra/40 px-2.5 py-1.5">
      <div className="flex items-center gap-1.5 text-brand-muted">
        <Icon size={11} />
        <span className="kicker">{label}</span>
      </div>
      <p className="mt-0.5 font-medium text-brand-ink tabular">{value}</p>
    </div>
  );
}

function ConsorcioDetailModal({
  consorcio,
  onClose,
}: {
  consorcio: ConsorcioRow;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-brand-ink/40 px-4 py-8 motion-safe:animate-fade-up">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="relative h-24 bg-gradient-to-br from-brand-cyan via-brand-cyan to-brand-teal">
          <TrianglesAccent
            position="top-right"
            size={180}
            tone="cyan"
            density="rich"
            className="opacity-60"
          />
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 rounded-full bg-white/20 p-1.5 text-white backdrop-blur transition hover:bg-white/30"
            aria-label="Cerrar"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="-mt-8 px-6 pb-6">
          <span className="grid h-16 w-16 place-items-center rounded-2xl border-4 border-white bg-gradient-to-br from-brand-cyan to-brand-teal text-white shadow-md">
            <Building2 size={22} />
          </span>
          <h2 className="mt-2 font-display text-xl font-bold text-brand-ink">
            {consorcio.nombre}
          </h2>
          <p className="text-xs font-mono text-brand-muted">{consorcio.codigo}</p>

          <dl className="mt-4 space-y-2 text-sm">
            <DetailRow
              icon={Hash}
              label={consorcio.tipo_documento === 'cuit' ? 'CUIT' : 'DNI'}
              value={
                <CopyButton
                  value={consorcio.numero_documento}
                  label={consorcio.tipo_documento === 'cuit' ? 'CUIT' : 'DNI'}
                  tabular
                />
              }
            />
            <DetailRow
              icon={Users}
              label="Unidades funcionales"
              value={<span className="tabular">{consorcio.unidades_funcionales}</span>}
            />
            <DetailRow
              icon={Wallet}
              label="Abono mensual"
              value={
                <span className="tabular">
                  {formatMoney(Number(consorcio.monto_abono ?? 0))}
                </span>
              }
            />
            <DetailRow
              icon={FileText}
              label="Facturar a"
              value={
                consorcio.facturar_con_cuit_administracion
                  ? 'Administración'
                  : 'Consorcio'
              }
            />
            {consorcio.domicilio && (
              <DetailRow
                icon={Building2}
                label="Domicilio"
                value={consorcio.domicilio}
              />
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Hash;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 last:border-b-0">
      <span className="inline-flex items-center gap-1.5 text-xs text-brand-muted">
        <Icon size={12} /> {label}
      </span>
      <span className="text-sm text-brand-ink">{value}</span>
    </div>
  );
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}
