import { cn } from '@/lib/cn';

interface ProgresoBarProps {
  porcentaje: number;
  className?: string;
  showLabel?: boolean;
  tone?: 'cyan' | 'emerald' | 'amber';
}

const TONE: Record<NonNullable<ProgresoBarProps['tone']>, string> = {
  cyan: 'bg-gradient-to-r from-brand-cyan to-brand-blue',
  emerald: 'bg-gradient-to-r from-emerald-400 to-emerald-600',
  amber: 'bg-gradient-to-r from-amber-400 to-amber-600',
};

// Barra de progreso para el sidebar del alumno y la tarjeta "Mis cursos".
export function ProgresoBar({
  porcentaje,
  className,
  showLabel = true,
  tone = 'cyan',
}: ProgresoBarProps) {
  const p = Math.max(0, Math.min(100, Number(porcentaje) || 0));
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn('h-full transition-all duration-500', TONE[tone])}
          style={{ width: `${p}%` }}
          aria-valuenow={p}
          aria-valuemin={0}
          aria-valuemax={100}
          role="progressbar"
        />
      </div>
      {showLabel && (
        <span className="min-w-[3rem] text-right text-xs font-semibold text-brand-ink tabular-nums">
          {p.toFixed(p % 1 === 0 ? 0 : 1)}%
        </span>
      )}
    </div>
  );
}
