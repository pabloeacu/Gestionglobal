// FiltroRangoFechas · DGG-124 (pedido Pablo 31/07): "desde y hasta en un solo
// calendario". Botón que abre un popover con UN calendario: primer click marca
// el desde, segundo click el hasta (si tocás un día anterior, se reinicia el
// rango). Presets rápidos + Limpiar. Sin dependencias nuevas.
//
// Valores como 'YYYY-MM-DD' (fecha local, sin huso) — el service los convierte
// al filtro que corresponda (gte/lte sobre la columna de fecha).

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface RangoFechas {
  desde: string | null;
  hasta: string | null;
}

const DIAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function iso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function fmtCorto(isoDate: string): string {
  const [, m, d] = isoDate.split('-');
  return `${d}/${m}`;
}

export function FiltroRangoFechas({
  valor,
  onChange,
  className,
}: {
  valor: RangoFechas;
  onChange: (rango: RangoFechas) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const hoy = new Date();
  const [mesVisible, setMesVisible] = useState(() => {
    const base = valor.desde ? new Date(valor.desde + 'T00:00:00') : hoy;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function clickDia(isoDia: string) {
    if (!valor.desde || (valor.desde && valor.hasta)) {
      onChange({ desde: isoDia, hasta: null });
      return;
    }
    // Segundo click: si es anterior al desde, reinicia el rango desde ahí.
    if (isoDia < valor.desde) {
      onChange({ desde: isoDia, hasta: null });
      return;
    }
    onChange({ desde: valor.desde, hasta: isoDia });
    setOpen(false);
  }

  function preset(dias: number | 'mes') {
    const h = iso(hoy);
    if (dias === 'mes') {
      const primero = iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
      onChange({ desde: primero, hasta: h });
    } else if (dias === 0) {
      onChange({ desde: h, hasta: h });
    } else {
      const d = new Date(hoy);
      d.setDate(d.getDate() - dias);
      onChange({ desde: iso(d), hasta: h });
    }
    setOpen(false);
  }

  // Grilla del mes visible: lunes primero.
  const primerDia = new Date(mesVisible.getFullYear(), mesVisible.getMonth(), 1);
  const offset = (primerDia.getDay() + 6) % 7; // 0=lunes
  const diasEnMes = new Date(mesVisible.getFullYear(), mesVisible.getMonth() + 1, 0).getDate();
  const celdas: Array<string | null> = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: diasEnMes }, (_, i) =>
      iso(new Date(mesVisible.getFullYear(), mesVisible.getMonth(), i + 1)),
    ),
  ];

  const activo = valor.desde !== null;
  const etiqueta = valor.desde
    ? `${fmtCorto(valor.desde)} – ${valor.hasta ? fmtCorto(valor.hasta) : '…'}`
    : 'Rango de fechas';

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm transition',
          activo
            ? 'border-brand-cyan bg-brand-cyan-pale/30 font-medium text-brand-cyan'
            : 'border-slate-200 text-brand-muted hover:border-brand-cyan hover:text-brand-cyan',
        )}
      >
        <CalendarDays size={14} />
        {etiqueta}
        {activo && (
          <span
            role="button"
            aria-label="Limpiar rango"
            onClick={(e) => { e.stopPropagation(); onChange({ desde: null, hasta: null }); }}
            className="ml-0.5 grid h-4 w-4 place-items-center rounded-full hover:bg-brand-cyan/10"
          >
            <X size={11} />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-xl motion-safe:animate-fade-up">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Mes anterior"
              onClick={() => setMesVisible(new Date(mesVisible.getFullYear(), mesVisible.getMonth() - 1, 1))}
              className="grid h-6 w-6 place-items-center rounded-md text-brand-muted hover:bg-slate-100"
            >
              <ChevronLeft size={14} />
            </button>
            <p className="text-sm font-semibold text-brand-ink">
              {MESES[mesVisible.getMonth()]} {mesVisible.getFullYear()}
            </p>
            <button
              type="button"
              aria-label="Mes siguiente"
              onClick={() => setMesVisible(new Date(mesVisible.getFullYear(), mesVisible.getMonth() + 1, 1))}
              className="grid h-6 w-6 place-items-center rounded-md text-brand-muted hover:bg-slate-100"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold uppercase text-brand-muted">
            {DIAS.map((d, i) => <span key={i} className="py-1">{d}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {celdas.map((c, i) => {
              if (!c) return <span key={i} />;
              const esDesde = c === valor.desde;
              const esHasta = c === valor.hasta;
              const enRango =
                valor.desde && valor.hasta && c > valor.desde && c < valor.hasta;
              const esHoy = c === iso(hoy);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => clickDia(c)}
                  className={cn(
                    'grid h-7 w-full place-items-center rounded-md text-xs tabular transition',
                    esDesde || esHasta
                      ? 'bg-brand-cyan font-bold text-white'
                      : enRango
                        ? 'bg-brand-cyan-pale/50 text-brand-ink'
                        : 'text-brand-ink hover:bg-slate-100',
                    esHoy && !esDesde && !esHasta && 'ring-1 ring-brand-cyan/50',
                  )}
                >
                  {Number(c.slice(-2))}
                </button>
              );
            })}
          </div>

          <p className="mt-2 text-[10px] text-brand-muted">
            {!valor.desde || valor.hasta
              ? 'Tocá el día de inicio y después el de fin.'
              : 'Ahora tocá el día de fin.'}
          </p>

          <div className="mt-2 flex flex-wrap gap-1 border-t border-slate-100 pt-2">
            <Preset onClick={() => preset(0)}>Hoy</Preset>
            <Preset onClick={() => preset(7)}>7 días</Preset>
            <Preset onClick={() => preset(30)}>30 días</Preset>
            <Preset onClick={() => preset('mes')}>Este mes</Preset>
            <Preset onClick={() => { onChange({ desde: null, hasta: null }); setOpen(false); }}>
              Limpiar
            </Preset>
          </div>
        </div>
      )}
    </div>
  );
}

function Preset({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-brand-muted transition hover:border-brand-cyan hover:text-brand-cyan"
    >
      {children}
    </button>
  );
}
