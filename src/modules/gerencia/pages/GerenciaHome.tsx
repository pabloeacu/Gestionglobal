import { Link } from 'react-router-dom';
import { Users, Briefcase, FileText, AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';

const QUICK = [
  {
    to: '/gerencia/clientes',
    label: 'Clientes',
    description: 'Administraciones y consorcios',
    icon: Users,
    available: true,
  },
  {
    to: '/gerencia/servicios',
    label: 'Servicios',
    description: 'Catálogo y tabulador de precios',
    icon: Briefcase,
    available: false,
  },
  {
    to: '/gerencia/facturacion',
    label: 'Facturación',
    description: 'Comprobantes, lotes y ARCA',
    icon: FileText,
    available: false,
  },
  {
    to: '/gerencia/recupero',
    label: 'Recupero',
    description: 'Cobranzas y reclamos',
    icon: AlertCircle,
    available: false,
  },
];

export function GerenciaHome() {
  const { user } = useAuth();
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header>
        <p className="kicker text-brand-cyan">Inicio</p>
        <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
          Hola{user?.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}.
        </h1>
        <p className="mt-2 text-brand-muted">
          Empezá administrando tus clientes y consorcios; el resto del
          ecosistema se va activando módulo por módulo.
        </p>
      </header>

      <section>
        <p className="kicker mb-3 text-brand-muted">Atajos</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {QUICK.map(({ to, label, description, icon: Icon, available }) =>
            available ? (
              <Link
                key={to}
                to={to}
                className="group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-brand-cyan/50 hover:shadow-[0_18px_40px_-24px_rgba(0,158,202,0.4)]"
              >
                <TrianglesAccent
                  position="top-right"
                  size={130}
                  tone="cyan"
                  density="soft"
                  className="opacity-40 transition-opacity group-hover:opacity-70"
                />
                <span className="relative grid h-11 w-11 place-items-center rounded-xl bg-brand-cyan-pale/40 text-brand-cyan transition group-hover:bg-brand-cyan group-hover:text-white">
                  <Icon size={20} />
                </span>
                <div className="relative">
                  <p className="font-display text-base font-bold text-brand-ink">
                    {label}
                  </p>
                  <p className="text-xs text-brand-muted">{description}</p>
                </div>
              </Link>
            ) : (
              <div
                key={to}
                className="flex items-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-white/60 p-5"
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-brand-muted">
                  <Icon size={20} />
                </span>
                <div>
                  <p className="font-display text-base font-bold text-brand-muted">
                    {label}
                  </p>
                  <p className="text-xs text-brand-muted/80">
                    {description} · próximamente
                  </p>
                </div>
              </div>
            ),
          )}
        </div>
      </section>
    </div>
  );
}
