// ============================================================================
// AnaliticaPage · /gerencia/analitica (DGG-39 / P2-#24)
//
// Dashboard analítico avanzado con 5 gráficos SVG inline (sin recharts/nivo
// para no engordar el bundle). Toma como rango el período global o un
// override local (90d default si "Todo").
//
// Layout:
//   • Header con KPIs sumario
//   • Grid 2 columnas:
//     - Facturación mensual (área + ticks)
//     - Cobranzas mensual (área)
//   • Top clientes (horizontal bar)
//   • Mix de servicios (donut + leyenda)
//   • Funnel de conversión (barras descendentes)
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  TrendingUp,
  Users,
  Briefcase,
  Filter,
  Loader2,
  ArrowDownRight,
  Wallet,
} from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { usePeriod } from '@/contexts/GlobalPeriodContext';
import { cn } from '@/lib/cn';
import {
  getAnaliticaCobranzasMensual,
  getAnaliticaFacturacionMensual,
  getAnaliticaFunnel,
  getAnaliticaMixServicios,
  getAnaliticaTopClientes,
  type FunnelEtapa,
  type MixServicio,
  type PuntoMensual,
  type TopCliente,
} from '@/services/api/analitica';

const fmtAR = (n: number) =>
  '$ ' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
const fmtMes = (iso: string) => {
  const parts = iso.split('-');
  const y = parts[0] ?? '';
  const m = parts[1] ?? '01';
  const mes = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][Number(m) - 1] ?? 'ene';
  return `${mes} ${y.slice(2)}`;
};

export function AnaliticaPage() {
  const period = usePeriod();
  // El período global controla los gráficos basados en "días" (top clientes,
  // mix, funnel). Para series mensuales usamos siempre 12 meses por
  // legibilidad. El usuario puede ver 7d/30d/90d/1y desde el header.
  const dias = period.days > 0 ? period.days : 365;

  const [facturacion, setFacturacion] = useState<PuntoMensual[]>([]);
  const [cobranzas, setCobranzas] = useState<PuntoMensual[]>([]);
  const [topClientes, setTopClientes] = useState<TopCliente[]>([]);
  const [mixServicios, setMixServicios] = useState<MixServicio[]>([]);
  const [funnel, setFunnel] = useState<FunnelEtapa[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      getAnaliticaFacturacionMensual(12),
      getAnaliticaCobranzasMensual(12),
      getAnaliticaTopClientes(dias, 10),
      getAnaliticaMixServicios(dias),
      getAnaliticaFunnel(dias),
    ]).then(([f, c, t, m, fn]) => {
      if (cancelled) return;
      if (f.ok) setFacturacion(f.data);
      if (c.ok) setCobranzas(c.data);
      if (t.ok) setTopClientes(t.data);
      if (m.ok) setMixServicios(m.data);
      if (fn.ok) setFunnel(fn.data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [dias]);

  const totalFacturacion = useMemo(
    () => facturacion.reduce((a, p) => a + p.total, 0),
    [facturacion],
  );
  const totalCobranzas = useMemo(
    () => cobranzas.reduce((a, p) => a + p.total, 0),
    [cobranzas],
  );
  const tasaConversion = useMemo(() => {
    const rec = funnel.find((e) => e.etapa === 'recibidas')?.cantidad ?? 0;
    const act = funnel.find((e) => e.etapa === 'activadas')?.cantidad ?? 0;
    return rec > 0 ? (act / rec) * 100 : 0;
  }, [funnel]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <header className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-brand-cyan-pale/15 to-white p-6">
        <TrianglesAccent position="top-right" tone="cyan" density="rich" />
        <div className="relative">
          <p className="kicker text-brand-cyan">Inteligencia de negocio</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            Analítica avanzada
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-muted">
            Tendencias mensuales, ranking de clientes, mix de servicios y
            funnel de conversión. El rango se ajusta con el selector global
            de período del header.
          </p>
          <div className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-brand-muted">
            <Filter size={11} /> Rango activo:{' '}
            <span className="font-semibold text-brand-ink">{period.label}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiTile
              label="Facturación 12m"
              value={fmtAR(totalFacturacion)}
              icon={TrendingUp}
              tone="cyan"
            />
            <KpiTile
              label="Cobranzas 12m"
              value={fmtAR(totalCobranzas)}
              icon={Wallet}
              tone="emerald"
            />
            <KpiTile
              label="Top clientes"
              value={String(topClientes.length)}
              icon={Users}
              tone="amber"
            />
            <KpiTile
              label="Conversión"
              value={`${tasaConversion.toFixed(0)}%`}
              icon={ArrowDownRight}
              tone="ink"
              sub="solicitudes → activadas"
            />
          </div>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-brand-muted">
          <Loader2 size={16} className="animate-spin" />
          Cargando datos…
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Facturación mensual"
              subtitle="Últimos 12 meses · total emitido"
              icon={TrendingUp}
              tone="cyan"
            >
              <LineChart data={facturacion} color="#0e9bc8" />
            </ChartCard>
            <ChartCard
              title="Cobranzas mensuales"
              subtitle="Últimos 12 meses · ingresos imputados"
              icon={Wallet}
              tone="emerald"
            >
              <LineChart data={cobranzas} color="#10b981" />
            </ChartCard>
          </div>

          <ChartCard
            title="Top clientes por facturación"
            subtitle={`Últimos ${dias} días`}
            icon={Users}
            tone="amber"
          >
            {topClientes.length === 0 ? (
              <EmptyMini />
            ) : (
              <HorizontalBar
                data={topClientes.map((c) => ({
                  label: c.nombre,
                  value: c.total_facturado,
                  sub: `${c.total_comprobantes} comp.`,
                }))}
                fmt={fmtAR}
                color="#f59e0b"
              />
            )}
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Mix de servicios facturados"
              subtitle={`Últimos ${dias} días`}
              icon={Briefcase}
              tone="violet"
            >
              {mixServicios.length === 0 ? (
                <EmptyMini />
              ) : (
                <Donut data={mixServicios} />
              )}
            </ChartCard>

            <ChartCard
              title="Funnel de conversión"
              subtitle="Solicitudes recibidas → activadas como clientes"
              icon={BarChart3}
              tone="rose"
            >
              {funnel.every((e) => e.cantidad === 0) ? (
                <EmptyMini />
              ) : (
                <Funnel data={funnel} />
              )}
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KpiTile({
  label,
  value,
  icon: Icon,
  tone,
  sub,
}: {
  label: string;
  value: string;
  icon: typeof TrendingUp;
  tone: 'cyan' | 'emerald' | 'amber' | 'ink';
  sub?: string;
}) {
  const colors = {
    cyan: 'bg-brand-cyan-pale/40 text-brand-cyan',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    ink: 'bg-slate-100 text-slate-700',
  }[tone];
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3">
      <span className={cn('grid h-10 w-10 place-items-center rounded-xl', colors)}>
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-brand-muted">{label}</p>
        <p className="truncate text-base font-bold tabular-nums text-brand-ink">{value}</p>
        {sub && <p className="truncate text-[10px] text-brand-muted">{sub}</p>}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  icon: Icon,
  tone,
  children,
}: {
  title: string;
  subtitle: string;
  icon: typeof TrendingUp;
  tone: 'cyan' | 'emerald' | 'amber' | 'violet' | 'rose';
  children: React.ReactNode;
}) {
  const colors = {
    cyan: 'bg-brand-cyan-pale/40 text-brand-cyan',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    violet: 'bg-violet-50 text-violet-700',
    rose: 'bg-rose-50 text-rose-700',
  }[tone];
  return (
    <section className="card-premium relative overflow-hidden p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className={cn('grid h-9 w-9 place-items-center rounded-xl', colors)}>
          <Icon size={15} />
        </span>
        <div>
          <h2 className="font-display text-base font-bold text-brand-ink">{title}</h2>
          <p className="text-[11.5px] text-brand-muted">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function EmptyMini() {
  return (
    <p className="grid h-32 place-items-center text-xs text-brand-muted">
      Sin datos para el rango seleccionado
    </p>
  );
}

// SVG line chart con área debajo (12 meses).
function LineChart({ data, color }: { data: PuntoMensual[]; color: string }) {
  if (data.length === 0) return <EmptyMini />;
  const W = 600;
  const H = 180;
  const PAD = 24;
  const max = Math.max(1, ...data.map((d) => d.total));
  const xStep = (W - PAD * 2) / Math.max(1, data.length - 1);

  const points = data.map((d, i) => {
    const x = PAD + i * xStep;
    const y = H - PAD - (d.total / max) * (H - PAD * 2);
    return { x, y, d };
  });

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const area = `${path} L ${PAD + (data.length - 1) * xStep} ${H - PAD} L ${PAD} ${H - PAD} Z`;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={`g-${color.replace('#', '')}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
          <line
            key={i}
            x1={PAD}
            x2={W - PAD}
            y1={H - PAD - p * (H - PAD * 2)}
            y2={H - PAD - p * (H - PAD * 2)}
            stroke="#e2e8f0"
            strokeWidth={1}
            strokeDasharray={i === 0 ? '' : '2 3'}
          />
        ))}
        {/* Área */}
        <path d={area} fill={`url(#g-${color.replace('#', '')})`} />
        {/* Línea */}
        <path d={path} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" />
        {/* Puntos */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3} fill={color} />
            <title>{`${fmtMes(p.d.mes)} · ${fmtAR(p.d.total)} · ${p.d.cantidad} comp.`}</title>
          </g>
        ))}
        {/* Etiquetas X (mes) */}
        {points.map((p, i) => (
          i % 2 === 0 ? (
            <text
              key={`l-${i}`}
              x={p.x}
              y={H + 12}
              textAnchor="middle"
              fontSize={9}
              fill="#94a3b8"
            >
              {fmtMes(p.d.mes)}
            </text>
          ) : null
        ))}
      </svg>
    </div>
  );
}

function HorizontalBar({
  data,
  fmt,
  color,
}: {
  data: Array<{ label: string; value: number; sub?: string }>;
  fmt: (n: number) => string;
  color: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-2">
      {data.map((d, i) => {
        const pct = (d.value / max) * 100;
        return (
          <li key={i} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate font-medium text-brand-ink">{d.label}</span>
              <span className="flex items-center gap-2 whitespace-nowrap tabular-nums text-brand-ink">
                <span>{fmt(d.value)}</span>
                {d.sub && <span className="text-brand-muted">· {d.sub}</span>}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// Donut chart 200x200 con leyenda al costado.
function Donut({ data }: { data: MixServicio[] }) {
  const total = data.reduce((a, d) => a + d.total, 0) || 1;
  const COLORS = [
    '#0e9bc8', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444',
    '#06b6d4', '#84cc16', '#ec4899', '#6366f1', '#14b8a6',
    '#f97316', '#a3a3a3',
  ];
  let acumAngle = 0;
  const R = 60;
  const RIn = 35;
  const cx = 80;
  const cy = 80;
  const slices = data.map((d, i) => {
    const frac = d.total / total;
    const start = acumAngle;
    const end = acumAngle + frac * 2 * Math.PI;
    acumAngle = end;
    const x1 = cx + R * Math.cos(start - Math.PI / 2);
    const y1 = cy + R * Math.sin(start - Math.PI / 2);
    const x2 = cx + R * Math.cos(end - Math.PI / 2);
    const y2 = cy + R * Math.sin(end - Math.PI / 2);
    const xi1 = cx + RIn * Math.cos(end - Math.PI / 2);
    const yi1 = cy + RIn * Math.sin(end - Math.PI / 2);
    const xi2 = cx + RIn * Math.cos(start - Math.PI / 2);
    const yi2 = cy + RIn * Math.sin(start - Math.PI / 2);
    const largeArc = frac > 0.5 ? 1 : 0;
    return {
      path: `M ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} L ${xi1} ${yi1} A ${RIn} ${RIn} 0 ${largeArc} 0 ${xi2} ${yi2} Z`,
      color: COLORS[i % COLORS.length],
      d,
      pct: frac * 100,
    };
  });

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg width="160" height="160" viewBox="0 0 160 160" className="shrink-0">
        {slices.map((s, i) => (
          <g key={i}>
            <path d={s.path} fill={s.color} />
            <title>{`${s.d.nombre} · ${fmtAR(s.d.total)} · ${s.pct.toFixed(1)}%`}</title>
          </g>
        ))}
        {/* Hole con total al centro */}
        <text x={cx} y={cy + 1} textAnchor="middle" fontSize={11} fontWeight={700} fill="#0f172a">
          {fmtAR(total)}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize={9} fill="#94a3b8">
          total
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
        {slices.slice(0, 10).map((s, i) => (
          <li key={i} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: s.color }}
              />
              <span className="truncate text-brand-ink">{s.d.nombre}</span>
            </span>
            <span className="whitespace-nowrap tabular-nums text-brand-muted">
              {s.pct.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Funnel({ data }: { data: FunnelEtapa[] }) {
  const max = Math.max(1, ...data.map((e) => e.cantidad));
  const COLORS = ['#0e9bc8', '#10b981', '#f59e0b', '#8b5cf6'];
  return (
    <ul className="space-y-2">
      {data.map((e, i) => {
        const pct = (e.cantidad / max) * 100;
        const prev = i > 0 ? (data[i - 1]?.cantidad ?? null) : null;
        const conv = prev && prev > 0 ? (e.cantidad / prev) * 100 : null;
        return (
          <li key={i} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium capitalize text-brand-ink">
                {e.etapa}
              </span>
              <span className="flex items-center gap-2 tabular-nums">
                <span className="font-bold text-brand-ink">{e.cantidad}</span>
                {conv != null && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                      conv > 50 ? 'bg-emerald-50 text-emerald-700' :
                      conv > 20 ? 'bg-amber-50 text-amber-700' :
                      'bg-rose-50 text-rose-700',
                    )}
                  >
                    {conv.toFixed(0)}% conv.
                  </span>
                )}
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${pct}%`,
                  backgroundColor: COLORS[i % COLORS.length],
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
