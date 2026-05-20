import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface IllustratedEmptyProps {
  illustration?: 'edificio' | 'consorcio' | 'busqueda' | 'lista';
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

// Empty state premium con ilustración de marca (triángulos teal/cian + un
// símbolo orbital sutil). Animaciones sutiles motion-safe.
export function IllustratedEmpty({
  illustration = 'lista',
  title,
  description,
  action,
  className,
}: IllustratedEmptyProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-5 py-12 text-center',
        className,
      )}
    >
      <EmptyArt variant={illustration} />
      <div className="max-w-md space-y-2">
        <h3 className="font-display text-xl font-bold text-brand-ink">
          {title}
        </h3>
        {description && (
          <p className="text-sm leading-relaxed text-brand-muted">
            {description}
          </p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

function EmptyArt({
  variant,
}: {
  variant: NonNullable<IllustratedEmptyProps['illustration']>;
}) {
  // SVG común: triángulos teal/cian con animación sutil + icono central
  return (
    <div className="relative h-32 w-32">
      {/* halo */}
      <span
        aria-hidden
        className="absolute inset-0 -m-3 rounded-full bg-gradient-to-br from-brand-cyan/15 to-brand-teal/15 blur-2xl"
      />
      <svg
        viewBox="0 0 200 200"
        className="relative h-full w-full"
        aria-hidden
      >
        {/* Triángulos flotantes que respiran */}
        <g>
          <path
            d="M30 70 L70 30 L70 70 Z"
            className="fill-brand-cyan/55 motion-safe:animate-breath"
            style={{ animationDelay: '0ms' }}
          />
          <path
            d="M80 38 L120 38 L100 70 Z"
            className="fill-brand-teal/45 motion-safe:animate-breath"
            style={{ animationDelay: '300ms' }}
          />
          <path
            d="M130 70 L170 30 L170 70 Z"
            className="fill-brand-cyan/30 motion-safe:animate-breath"
            style={{ animationDelay: '600ms' }}
          />
        </g>
        {/* Anillo orbital */}
        <ellipse
          cx="100"
          cy="135"
          rx="60"
          ry="18"
          className="fill-none stroke-brand-muted/40"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="6 6"
        />
        {/* Glyph central según variante */}
        <g transform="translate(80,100)">
          {variant === 'consorcio' && (
            <path
              d="M0 30 L0 6 L30 0 L30 30 Z M6 12 H12 V18 H6 Z M18 12 H24 V18 H18 Z M6 22 H12 V28 H6 Z M18 22 H24 V28 H18 Z"
              className="fill-brand-ink"
            />
          )}
          {variant === 'edificio' && (
            <path
              d="M0 30 L0 0 L40 0 L40 30 Z M6 6 H14 V14 H6 Z M22 6 H30 V14 H22 Z M6 18 H14 V26 H6 Z M22 18 H30 V26 H22 Z"
              className="fill-brand-ink"
            />
          )}
          {variant === 'busqueda' && (
            <g className="stroke-brand-ink fill-none" strokeWidth="3" strokeLinecap="round">
              <circle cx="14" cy="14" r="10" />
              <line x1="22" y1="22" x2="34" y2="34" />
            </g>
          )}
          {variant === 'lista' && (
            <g className="stroke-brand-ink" strokeWidth="3" strokeLinecap="round">
              <line x1="0" y1="6" x2="36" y2="6" />
              <line x1="0" y1="18" x2="28" y2="18" />
              <line x1="0" y1="30" x2="20" y2="30" />
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}
