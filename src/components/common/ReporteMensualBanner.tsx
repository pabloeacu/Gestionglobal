// ============================================================================
// ReporteMensualBanner · banner inteligente "Generá tu reporte mensual"
//   (P2-#25)
//
// Aparece en el home de gerencia los primeros días del mes nuevo,
// proponiendo generar el reporte del mes anterior. Se descarta por sesión
// o por mes (con localStorage flag "gg.reporteBanner.YYYY-MM").
//
// Comportamiento:
//   • Días 1-10 de cada mes: aparece el banner del mes anterior.
//   • Después del día 10: oculto.
//   • Si el user ya generó o descartó el reporte del mes, no vuelve a
//     aparecer hasta el mes siguiente.
//
// Filosofía: NO genera automáticamente. Sólo INVITA con un CTA atractivo.
// El usuario decide si lo arma y a quién se lo manda.
// ============================================================================

import { useEffect, useState } from 'react';
import { Sparkles, X, ArrowRight, BarChart3, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

interface ReporteMensualBannerProps {
  /** Día límite del mes (default 10). Después no se muestra. */
  diaLimite?: number;
}

function getStorageKey(mesAnterior: { y: number; m: number }): string {
  return `gg.reporteBanner.${mesAnterior.y}-${String(mesAnterior.m).padStart(2, '0')}`;
}

export function ReporteMensualBanner({ diaLimite = 10 }: ReporteMensualBannerProps) {
  const [hidden, setHidden] = useState(true);
  const [mesAnteriorLabel, setMesAnteriorLabel] = useState('');
  const [storageKey, setStorageKey] = useState('');

  useEffect(() => {
    const hoy = new Date();
    const dia = hoy.getDate();
    if (dia > diaLimite) return;

    // Mes anterior (1-12)
    const mesActual0 = hoy.getMonth();        // 0..11
    const anioActual = hoy.getFullYear();
    const mesAnt0 = mesActual0 === 0 ? 11 : mesActual0 - 1;
    const anioAnt = mesActual0 === 0 ? anioActual - 1 : anioActual;
    const label = `${MESES[mesAnt0]} ${anioAnt}`;
    const key = getStorageKey({ y: anioAnt, m: mesAnt0 + 1 });

    // Si el usuario ya lo descartó para ese mes, ocultar.
    try {
      const v = localStorage.getItem(key);
      if (v === 'dismissed' || v === 'done') return;
    } catch { /* ignore */ }

    setMesAnteriorLabel(label);
    setStorageKey(key);
    setHidden(false);
  }, [diaLimite]);

  function dismiss() {
    try {
      if (storageKey) localStorage.setItem(storageKey, 'dismissed');
    } catch { /* ignore */ }
    setHidden(true);
  }

  function markDone() {
    try {
      if (storageKey) localStorage.setItem(storageKey, 'done');
    } catch { /* ignore */ }
    setHidden(true);
  }

  if (hidden) return null;

  return (
    <div
      role="region"
      aria-label="Reporte del mes pasado"
      className="relative overflow-hidden rounded-2xl border border-brand-cyan/30 bg-gradient-to-br from-brand-cyan-pale/30 via-white to-brand-cyan-pale/15 p-5 motion-safe:animate-fade-up"
    >
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full text-brand-muted transition hover:bg-white/60 hover:text-brand-ink"
        aria-label="Ocultar sugerencia hasta el próximo mes"
        title="Ocultar hasta el próximo mes"
      >
        <X size={14} />
      </button>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-cyan text-white shadow-[0_10px_24px_-8px_rgba(14,155,200,0.55)]">
          <Sparkles size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            Nuevo mes · reporte recomendado
          </p>
          <h3 className="mt-1 font-display text-lg font-bold text-brand-ink">
            ¿Cerrás {mesAnteriorLabel}?
          </h3>
          <p className="mt-1 text-sm text-brand-muted">
            Es un buen momento para generar el reporte mensual: cuenta corriente,
            facturación y vencimientos del mes pasado, todo en PDF o XLS branded.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              to="/gerencia/cuenta-corriente"
              onClick={markDone}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full bg-brand-cyan px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-cyan/90',
              )}
            >
              <BarChart3 size={14} /> Cuenta corriente <ArrowRight size={13} />
            </Link>
            <Link
              to="/gerencia/facturacion"
              onClick={markDone}
              className="inline-flex items-center gap-1.5 rounded-full border border-brand-cyan/30 bg-white px-3.5 py-1.5 text-sm font-semibold text-brand-cyan transition hover:bg-brand-cyan-pale/30"
            >
              <FileText size={14} /> Facturación
            </Link>
            <Link
              to="/gerencia/vencimientos"
              onClick={markDone}
              className="inline-flex items-center gap-1.5 rounded-full border border-brand-cyan/30 bg-white px-3.5 py-1.5 text-sm font-semibold text-brand-cyan transition hover:bg-brand-cyan-pale/30"
            >
              Vencimientos
            </Link>
          </div>
          <p className="mt-2 text-[10.5px] text-brand-muted/80">
            Cada pantalla tiene su botón "Exportar PDF/XLS" con branding y filtros vivos.
            Te lo recordamos sólo los primeros 10 días del mes.
          </p>
        </div>
      </div>
    </div>
  );
}
