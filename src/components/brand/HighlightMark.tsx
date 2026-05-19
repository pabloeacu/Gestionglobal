import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

// Efecto "marcador resaltador" cian: una barra teal/cyan a 38% de transparencia
// detrás del texto, como en los posts de Instagram de Gestión Global.
// Variante 'fill' = pintada detrás; 'underline' = subrayado grueso.
interface HighlightMarkProps {
  children: ReactNode;
  variant?: 'fill' | 'underline';
  tone?: 'cyan' | 'teal';
  className?: string;
}

export function HighlightMark({
  children,
  variant = 'fill',
  tone = 'cyan',
  className,
}: HighlightMarkProps) {
  const toneClass =
    tone === 'cyan' ? 'bg-brand-cyan/25' : 'bg-brand-teal/25';
  if (variant === 'underline') {
    return (
      <span className={cn('relative inline-block', className)}>
        <span className="relative z-10">{children}</span>
        <span
          className={cn(
            'absolute inset-x-0 bottom-1 -z-0 block h-[0.28em]',
            toneClass,
          )}
          aria-hidden
        />
      </span>
    );
  }
  return (
    <span className={cn('relative inline-block px-1', className)}>
      <span className="relative z-10">{children}</span>
      <span
        className={cn(
          'absolute inset-y-[0.05em] inset-x-0 -z-0 block rounded-[2px]',
          toneClass,
        )}
        aria-hidden
      />
    </span>
  );
}
