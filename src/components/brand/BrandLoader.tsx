import { cn } from '@/lib/cn';

interface BrandLoaderProps {
  /** Tamaño del símbolo en px. Default 64. */
  size?: number;
  /** Texto opcional bajo el logo. */
  label?: string;
  /** Si va sobre fondo oscuro. */
  variant?: 'light' | 'dark';
  className?: string;
}

// Loader institucional: símbolo Gestión Global con respiración suave + halo
// pulsante. Reemplaza el "Cargando…" plano. Respeta prefers-reduced-motion.
export function BrandLoader({
  size = 64,
  label,
  variant = 'light',
  className,
}: BrandLoaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="relative" style={{ width: size, height: size }}>
        {/* halo cian/teal pulsante detrás del logo */}
        <span
          aria-hidden
          className="absolute inset-0 -m-2 rounded-full bg-gradient-to-br from-brand-cyan/35 to-brand-teal/35 blur-xl motion-safe:animate-pulse-glow motion-reduce:opacity-40"
        />
        <img
          src="/icons/icon-512.png"
          alt=""
          aria-hidden
          style={{ width: size, height: size }}
          className="relative object-contain drop-shadow-[0_8px_22px_rgba(0,158,202,0.35)] motion-safe:animate-breath motion-reduce:opacity-90"
        />
      </div>
      {label && (
        <p
          className={cn(
            'text-xs font-medium uppercase tracking-[0.22em] motion-safe:animate-fade-in',
            variant === 'dark' ? 'text-white/70' : 'text-brand-muted',
          )}
        >
          {label}
        </p>
      )}
      <span className="sr-only">Cargando</span>
    </div>
  );
}

// Variante pantalla completa (centrada en viewport).
export function BrandLoaderScreen({
  label = 'Cargando',
  variant = 'light',
}: {
  label?: string;
  variant?: 'light' | 'dark';
}) {
  return (
    <div
      className={cn(
        'grid min-h-screen place-items-center',
        variant === 'dark' ? 'bg-brand-night' : 'bg-white',
      )}
    >
      <BrandLoader size={88} label={label} variant={variant} />
    </div>
  );
}
