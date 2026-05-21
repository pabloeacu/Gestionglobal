import { useMemo, useState } from 'react';
import type { DashboardKpis } from '@/services/api/dashboard';

interface SparklineFacturadoProps {
  serie: DashboardKpis['serie_facturado'];
  loading: boolean;
}

const VIEW_W = 1000; // Coordenadas virtuales; el SVG escala con preserveAspectRatio="none".
const VIEW_H = 100;
const PAD_T = 8;
const PAD_B = 6;

const fmtFecha = (iso: string) => {
  // iso = YYYY-MM-DD; parseamos sin TZ shift.
  const parts = iso.split('-').map(Number);
  const dt = new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1);
  return dt.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
};

const fmtMoneda = (n: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n);

// Sparkline SVG inline, sin dependencia de Recharts (regla del prompt: más
// liviano y consistente con el lenguaje gráfico de la marca).
export function SparklineFacturado({ serie, loading }: SparklineFacturadoProps) {
  const [hover, setHover] = useState<{ i: number; x: number } | null>(null);

  const { pointsLine, pointsArea, maxVal, hasData } = useMemo(() => {
    if (serie.length === 0) {
      return { pointsLine: '', pointsArea: '', maxVal: 0, hasData: false };
    }
    const max = serie.reduce((m, p) => Math.max(m, p.facturado), 0);
    const hd = max > 0;
    const denom = max === 0 ? 1 : max;
    const stepX = serie.length > 1 ? VIEW_W / (serie.length - 1) : 0;
    const innerH = VIEW_H - PAD_T - PAD_B;

    const coords = serie.map((p, i) => {
      const x = i * stepX;
      const y = PAD_T + innerH * (1 - p.facturado / denom);
      return { x, y };
    });

    const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ');
    const last = coords[coords.length - 1];
    const area = last
      ? `${line} L${last.x.toFixed(2)},${VIEW_H} L0,${VIEW_H} Z`
      : line;
    return { pointsLine: line, pointsArea: area, maxVal: max, hasData: hd };
  }, [serie]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (serie.length === 0) return;
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    const i = Math.max(0, Math.min(serie.length - 1, Math.round(rel * (serie.length - 1))));
    setHover({ i, x: rel * 100 });
  };

  if (loading) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="kicker mb-3 text-brand-muted">Facturación diaria</p>
        <div className="h-20 w-full animate-pulse rounded-lg bg-slate-100" />
      </section>
    );
  }

  const total = serie.reduce((s, p) => s + p.facturado, 0);
  const hoverPoint = hover ? serie[hover.i] : null;

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-5 motion-safe:animate-fade-up"
      style={{ animationDelay: '320ms' }}
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <p className="kicker text-brand-muted">Facturación diaria</p>
          <p className="mt-1 font-display text-lg font-bold text-brand-ink">
            {fmtMoneda(total)}{' '}
            <span className="text-sm font-normal text-brand-muted">
              en {serie.length} días
            </span>
          </p>
        </div>
        {hasData && maxVal > 0 && (
          <p className="text-xs text-brand-muted">
            Pico: <span className="font-semibold text-brand-ink">{fmtMoneda(maxVal)}</span>
          </p>
        )}
      </div>

      {!hasData ? (
        <div className="grid h-20 place-items-center rounded-lg bg-brand-zebra text-xs text-brand-muted">
          Sin facturación en el período
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            className="block h-20 w-full"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id="sparklineFacturadoFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#009eca" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#009eca" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={pointsArea} fill="url(#sparklineFacturadoFill)" />
            <path
              d={pointsLine}
              fill="none"
              stroke="#009eca"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {hover && (
              <line
                x1={(hover.i / Math.max(1, serie.length - 1)) * VIEW_W}
                x2={(hover.i / Math.max(1, serie.length - 1)) * VIEW_W}
                y1={0}
                y2={VIEW_H}
                stroke="#009eca"
                strokeWidth="1"
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
                opacity="0.5"
              />
            )}
          </svg>
          {hoverPoint && (
            <div
              className="pointer-events-none absolute top-0 -translate-x-1/2 -translate-y-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow-sm"
              style={{ left: `${hover?.x ?? 0}%` }}
            >
              <span className="font-semibold text-brand-ink">{fmtMoneda(hoverPoint.facturado)}</span>
              <span className="ml-2 text-brand-muted">{fmtFecha(hoverPoint.fecha)}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
