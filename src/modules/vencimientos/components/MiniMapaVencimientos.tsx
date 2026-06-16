// 6.C · Mini-mapa calendario de vencimientos. Vista heatmap mensual del
// próximo período (90 días) con densidad por color: tonos más intensos
// indican más vencimientos. Click en un día filtra/foca la lista.
//
// No reemplaza la lista; complementa para ver de un vistazo distribución
// temporal — útil para planificar trabajo y detectar picos.

import { useMemo } from 'react';
import { Flame } from 'lucide-react';
import { parseLocalDate } from '@/lib/dates';
import type { ProximoVencimiento } from '@/services/api/vencimientos';

interface Props {
  vencimientos: ProximoVencimiento[];
  /** Días hacia adelante a mostrar. Default 90 (≈ 3 meses). */
  dias?: number;
  /** Día seleccionado (resalta visualmente). */
  selectedYmd?: string | null;
  /** Click en celda. Si vacía, vencimientos=[] y day igual viene. */
  onPickDay?: (ymd: string, fecha: Date, count: number) => void;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function colorDensidad(n: number, max: number): string {
  if (n === 0) return 'bg-slate-100 text-slate-400';
  const pct = max <= 0 ? 0 : n / max;
  if (pct >= 0.75) return 'bg-rose-500 text-white';
  if (pct >= 0.5) return 'bg-rose-300 text-white';
  if (pct >= 0.25) return 'bg-amber-300 text-amber-900';
  return 'bg-amber-100 text-amber-700';
}

export function MiniMapaVencimientos({
  vencimientos,
  dias = 90,
  selectedYmd,
  onPickDay,
}: Props) {
  const hoy = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const countPorDia = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of vencimientos) {
      const fv = parseLocalDate(v.fecha_vencimiento);
      if (Number.isNaN(fv.getTime())) continue;
      const key = ymd(fv);
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [vencimientos]);

  const max = useMemo(() => {
    let m = 0;
    for (const n of countPorDia.values()) if (n > m) m = n;
    return m;
  }, [countPorDia]);

  // 13 columnas (semanas) × 7 filas (días) — suficiente para ~91 días.
  const semanas = Math.ceil(dias / 7);
  const dow = (d: Date) => (d.getDay() + 6) % 7; // lunes=0
  const start = useMemo(() => {
    const d = new Date(hoy);
    d.setDate(d.getDate() - dow(d));
    return d;
  }, [hoy]);

  // Construir matriz [columna][fila].
  const cells = useMemo(() => {
    const out: Array<Array<{ d: Date; ymdKey: string; inRange: boolean }>> = [];
    for (let c = 0; c < semanas; c++) {
      const col: Array<{ d: Date; ymdKey: string; inRange: boolean }> = [];
      for (let r = 0; r < 7; r++) {
        const dd = new Date(start);
        dd.setDate(start.getDate() + c * 7 + r);
        const inRange =
          dd >= hoy &&
          dd <= (() => {
            const x = new Date(hoy);
            x.setDate(hoy.getDate() + dias);
            return x;
          })();
        col.push({ d: dd, ymdKey: ymd(dd), inRange });
      }
      out.push(col);
    }
    return out;
  }, [start, semanas, hoy, dias]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="kicker text-brand-cyan">Mini-mapa</p>
          <h3 className="font-display text-sm font-semibold text-brand-ink">
            Próximos {dias} días
          </h3>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-brand-muted">
          <span>menos</span>
          <span className="h-3 w-3 rounded-sm bg-slate-100" />
          <span className="h-3 w-3 rounded-sm bg-amber-100" />
          <span className="h-3 w-3 rounded-sm bg-amber-300" />
          <span className="h-3 w-3 rounded-sm bg-rose-300" />
          <span className="h-3 w-3 rounded-sm bg-rose-500" />
          <span>más</span>
        </div>
      </div>
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${semanas}, minmax(0, 1fr))` }}
      >
        {cells.map((col, ci) => (
          <div key={ci} className="grid grid-rows-7 gap-0.5">
            {col.map(({ d, ymdKey, inRange }) => {
              const n = countPorDia.get(ymdKey) ?? 0;
              const isSelected = selectedYmd === ymdKey;
              const isHoy = ymdKey === ymd(hoy);
              return (
                <button
                  key={ymdKey}
                  type="button"
                  disabled={!inRange}
                  onClick={() => onPickDay?.(ymdKey, d, n)}
                  title={`${d.toLocaleDateString('es-AR', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })} · ${n} vencimiento${n === 1 ? '' : 's'}`}
                  aria-label={`${d.toLocaleDateString('es-AR')}: ${n} vencimientos`}
                  className={`h-3.5 w-full rounded-sm transition ${
                    !inRange ? 'invisible' : ''
                  } ${colorDensidad(n, max)} ${
                    isSelected ? 'ring-2 ring-brand-cyan ring-offset-1' : ''
                  } ${isHoy ? 'outline outline-1 outline-offset-1 outline-brand-cyan' : ''}`}
                />
              );
            })}
          </div>
        ))}
      </div>
      {max > 0 && (
        <p className="mt-2 inline-flex items-center gap-1 text-[10px] text-rose-600">
          <Flame size={10} /> Día más cargado: {max} vencimiento{max === 1 ? '' : 's'}
        </p>
      )}
    </div>
  );
}
