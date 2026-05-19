import { cn } from '@/lib/cn';

// Cluster de triángulos teal — lenguaje gráfico de Gestión Global (ver IG
// gestionglobal.ar y la Presentación). Posicionable en esquinas de hero/sección.
interface TrianglesAccentProps {
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  size?: number;
  tone?: 'cyan' | 'teal';
  density?: 'soft' | 'rich';
  className?: string;
}

const POS: Record<NonNullable<TrianglesAccentProps['position']>, string> = {
  'top-right': 'top-0 right-0',
  'top-left': 'top-0 left-0 -scale-x-100',
  'bottom-right': 'bottom-0 right-0 -scale-y-100',
  'bottom-left': 'bottom-0 left-0 -scale-100',
};

export function TrianglesAccent({
  position = 'top-right',
  size = 220,
  tone = 'cyan',
  density = 'soft',
  className,
}: TrianglesAccentProps) {
  const color = tone === 'cyan' ? 'text-brand-cyan' : 'text-brand-teal';
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 200"
      className={cn('pointer-events-none absolute', color, POS[position], className)}
      style={{ width: size, height: size }}
    >
      <g fill="currentColor">
        <path d="M40 10 L90 10 L40 60 Z" opacity={density === 'rich' ? '0.55' : '0.35'} />
        <path d="M100 10 L150 10 L100 60 Z" opacity={density === 'rich' ? '0.35' : '0.2'} />
        <path d="M40 70 L90 70 L40 120 Z" opacity={density === 'rich' ? '0.25' : '0.15'} />
        <path d="M155 30 L185 30 L155 60 Z" opacity={density === 'rich' ? '0.35' : '0.22'} />
        <path d="M105 75 L135 75 L105 105 Z" opacity={density === 'rich' ? '0.18' : '0.1'} />
      </g>
    </svg>
  );
}
