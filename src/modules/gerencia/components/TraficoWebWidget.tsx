// DGG-245 · Cards de tráfico web en el Inicio de gerencia — Landing (/) y LexPH
// (/lexph*) DISCRIMINADAS (pedido de Pablo: quien entra a la landing puede no entrar
// a LexPH, y quien entra a LexPH puede llegar directo). Lee el snapshot de Vercel Web
// Analytics (tabla public.vercel_trafico, refrescada por cron cada 3h).
import { useEffect, useState } from 'react';
import { Globe, Newspaper } from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { AnimatedNumber } from '@/components/common/AnimatedNumber';
import { cn } from '@/lib/cn';
import {
  getTraficoWeb,
  type TraficoFila,
  type Superficie,
  type Ventana,
} from '@/services/api/trafico';

const fmt = (n: number) =>
  new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n);

const VENTANAS: { key: Ventana; label: string }[] = [
  { key: 'hoy', label: 'Hoy' },
  { key: '7d', label: '7 días' },
  { key: '30d', label: '30 días' },
];

function hace(iso: string | undefined): string {
  if (!iso) return '';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

interface CardProps {
  titulo: string;
  ruta: string;
  icon: typeof Globe;
  accent: 'cyan' | 'teal';
  datos: Partial<Record<Ventana, TraficoFila>>;
  loading: boolean;
  delay: number;
  mostrarNewsletter?: boolean;
}

function TraficoCard({
  titulo, ruta, icon: Icon, accent, datos, loading, delay, mostrarNewsletter,
}: CardProps) {
  const nl = datos['30d']?.desde_newsletter ?? 0;
  return (
    <div
      className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-brand-cyan/40 motion-safe:animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <TrianglesAccent
        position="top-right"
        size={140}
        tone={accent}
        density="soft"
        className="opacity-30 transition-opacity group-hover:opacity-60"
      />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="kicker text-brand-muted">{titulo}</p>
            <p className="mt-0.5 truncate text-xs text-brand-muted">{ruta}</p>
          </div>
          <span
            className={cn(
              'grid h-10 w-10 shrink-0 place-items-center rounded-xl',
              accent === 'cyan'
                ? 'bg-brand-cyan-pale/40 text-brand-cyan'
                : 'bg-emerald-50 text-emerald-600',
            )}
          >
            <Icon size={18} />
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {VENTANAS.map(({ key, label }) => {
            const d = datos[key];
            return (
              <div key={key} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-brand-muted">
                  {label}
                </p>
                <p className="mt-1 font-display text-xl font-bold tabular-nums text-brand-ink">
                  {loading ? (
                    <span className="inline-block h-5 w-10 animate-pulse rounded bg-slate-200 align-middle" />
                  ) : (
                    <AnimatedNumber value={d?.visitantes ?? 0} format={fmt} />
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-brand-muted tabular-nums">
                  {fmt(d?.vistas ?? 0)} vistas
                </p>
              </div>
            );
          })}
        </div>
        {mostrarNewsletter && nl > 0 && (
          <p className="mt-3 text-xs text-brand-muted">
            <span className="font-semibold tabular-nums text-brand-cyan">{fmt(nl)}</span>{' '}
            desde el newsletter (30d)
          </p>
        )}
      </div>
    </div>
  );
}

export function TraficoWebWidget() {
  const [filas, setFilas] = useState<TraficoFila[] | null>(null);

  useEffect(() => {
    let vivo = true;
    void getTraficoWeb().then((r) => {
      if (vivo && r.ok) setFilas(r.data);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const loading = filas === null;

  // Si nunca corrió el snapshot (tabla vacía tras cargar), no mostramos la sección.
  if (!loading && (filas?.length ?? 0) === 0) return null;

  const mapa: Record<Superficie, Partial<Record<Ventana, TraficoFila>>> = {
    landing: {},
    lexph: {},
  };
  for (const f of filas ?? []) mapa[f.superficie][f.ventana] = f;

  const act = (filas ?? [])[0]?.actualizado_at;
  const totalVistas = (filas ?? []).reduce((a, f) => a + f.vistas, 0);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="kicker text-brand-muted">Tráfico web</p>
        {act && <p className="text-xs text-brand-muted">actualizado {hace(act)}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TraficoCard
          titulo="Landing"
          ruta="gestionglobal.ar"
          icon={Globe}
          accent="teal"
          datos={mapa.landing}
          loading={loading}
          delay={0}
        />
        <TraficoCard
          titulo="LexPH"
          ruta="/lexph"
          icon={Newspaper}
          accent="cyan"
          datos={mapa.lexph}
          loading={loading}
          delay={80}
          mostrarNewsletter
        />
      </div>
      {!loading && totalVistas === 0 && (
        <p className="mt-2 text-xs text-brand-muted">
          La medición recién arrancó; las cards se van llenando con las visitas.
        </p>
      )}
    </section>
  );
}
