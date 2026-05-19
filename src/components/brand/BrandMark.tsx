import { cn } from '@/lib/cn';

interface BrandMarkProps {
  // 'dark' = sobre fondo oscuro (wordmark blanco) · 'light' = fondo claro (tinta)
  variant?: 'dark' | 'light';
  // alto del símbolo en px
  size?: number;
  withSlogan?: boolean;
  className?: string;
}

// Lockup de marca controlado: símbolo a color (vívido, alto contraste sobre
// cualquier fondo) + wordmark en tipografía display. Evita los logos blancos
// line-art que pierden contraste.
export function BrandMark({
  variant = 'light',
  size = 40,
  withSlogan = false,
  className,
}: BrandMarkProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <img
        src="/icons/icon-512.png"
        alt=""
        aria-hidden
        style={{ height: size, width: size }}
        className="object-contain drop-shadow-[0_4px_14px_rgba(0,158,202,0.35)]"
      />
      <div className="leading-none">
        <span
          className={cn(
            'block font-display font-extrabold tracking-tight',
            variant === 'dark' ? 'text-white' : 'text-brand-ink',
          )}
          style={{ fontSize: size * 0.5 }}
        >
          GESTIÓN GLOBAL
        </span>
        {withSlogan && (
          <span
            className={cn(
              'mt-1 block font-medium tracking-[0.18em]',
              variant === 'dark' ? 'text-brand-cyan-light' : 'text-brand-muted',
            )}
            style={{ fontSize: size * 0.2 }}
          >
            ALIADOS DE TU TIEMPO
          </span>
        )}
      </div>
    </div>
  );
}
