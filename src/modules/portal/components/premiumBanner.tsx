// ============================================================================
// premiumBanner · DGG-254 — lenguaje visual ÚNICO para los banners del dashboard
// del portal del cliente (marca-nativa, skill gestionglobal-ui).
//
// Reemplaza los pasteles Tailwind crudos (rounded-2xl + from-rose-50…) por el
// "aspecto premium" aprobado (degradé tinta→acento, chamfer, Oswald MAYÚSCULAS,
// motivo triangular, glass tile). MISMO footprint/tamaño que los banners actuales
// (p-4 sm:p-5) y responsive. La semántica se mantiene con el TONO (color de acento),
// no con fondos pastel. Sólo capa de presentación — ninguna lógica cambia.
// ============================================================================
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';

export type BannerTone = 'brand' | 'urgente' | 'alto' | 'exito' | 'deuda' | 'suave';

interface ToneConfig {
  grad: string;      // degradé del fondo (tinta → acento)
  accent: string;    // color del kicker + glyph
  cta: string;       // CTA primario (relleno)
  tri: 'cyan' | 'teal';
}

// Base tinta (navy) SIEMPRE; cambia el 3er stop + el acento según semántica.
export const BANNER_TONES: Record<BannerTone, ToneConfig> = {
  brand:   { grad: 'from-brand-night via-brand-night-2 to-brand-teal',       accent: 'text-brand-cyan-light', cta: 'bg-brand-cyan text-white hover:bg-brand-cyan-light hover:text-brand-ink', tri: 'cyan' },
  urgente: { grad: 'from-[#2b0f18] via-brand-night to-[#6d2233]',            accent: 'text-rose-200',         cta: 'bg-rose-500 text-white hover:bg-rose-400',                                 tri: 'cyan' },
  alto:    { grad: 'from-[#2a1c06] via-brand-night to-[#7a5212]',            accent: 'text-amber-200',        cta: 'bg-amber-400 text-brand-ink hover:bg-amber-300',                           tri: 'cyan' },
  exito:   { grad: 'from-brand-night via-[#0d4a40] to-brand-teal',           accent: 'text-emerald-200',      cta: 'bg-emerald-500 text-white hover:bg-emerald-400',                           tri: 'teal' },
  deuda:   { grad: 'from-[#2a1c06] via-brand-night to-[#7a5212]',            accent: 'text-amber-200',        cta: 'bg-amber-400 text-brand-ink hover:bg-amber-300',                           tri: 'cyan' },
  suave:   { grad: 'from-brand-night via-brand-night-2 to-brand-teal',       accent: 'text-brand-cyan-light', cta: 'bg-brand-cyan text-white hover:bg-brand-cyan-light hover:text-brand-ink', tri: 'cyan' },
};

/** Clase del CTA primario (relleno con el acento del tono). Chamfer + Oswald MAYÚS. */
export function premiumCtaClass(tone: BannerTone = 'brand'): string {
  return cn(
    'inline-flex items-center justify-center gap-1.5 gg-chamfer-sm px-4 py-2 font-display text-xs uppercase tracking-wider transition disabled:opacity-60',
    BANNER_TONES[tone].cta,
  );
}

/** Clase del CTA secundario (contorno claro sobre el fondo oscuro). */
export const premiumGhostCtaClass =
  'inline-flex items-center justify-center gap-1.5 gg-chamfer-sm border border-white/25 px-4 py-2 font-display text-xs uppercase tracking-wider text-white/90 transition hover:bg-white/10';

interface PremiumBannerProps {
  tone?: BannerTone;
  kicker?: ReactNode;
  title: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;        // cuerpo
  actions?: ReactNode;         // zona de CTAs
  onDismiss?: () => void;      // X (opcional)
  dismissing?: boolean;
  dismissLabel?: string;
  className?: string;
  ariaLabel?: string;
}

/** Banner premium full-width. Mismo tamaño/footprint que los banners actuales. */
export function PremiumBanner({
  tone = 'brand', kicker, title, icon, children, actions,
  onDismiss, dismissing, dismissLabel = 'Cerrar', className, ariaLabel,
}: PremiumBannerProps) {
  const T = BANNER_TONES[tone];
  return (
    <section
      className={cn('relative overflow-hidden gg-chamfer bg-gradient-to-br p-4 text-white motion-safe:animate-fade-up sm:p-5', T.grad, className)}
      aria-label={ariaLabel}
    >
      <TrianglesAccent position="top-right" size={132} tone={T.tri} density="rich" className="opacity-20" />
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10 blur-2xl" />

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          disabled={dismissing}
          aria-label={dismissLabel}
          className="absolute right-2.5 top-2.5 rounded-md p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          <X size={16} />
        </button>
      )}

      <div className={cn('relative flex items-start gap-3', onDismiss && 'pr-7')}>
        {icon && (
          <div className={cn('grid h-11 w-11 shrink-0 place-items-center gg-chamfer-sm bg-white/10 ring-1 ring-white/25', T.accent)}>
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {kicker && <p className={cn('kicker', T.accent)}>{kicker}</p>}
          <h3 className="font-display text-base uppercase leading-tight tracking-tight sm:text-lg">{title}</h3>
          {children && <div className="mt-1 text-sm text-white/80">{children}</div>}
          {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
    </section>
  );
}
