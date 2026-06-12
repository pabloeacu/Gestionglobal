import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface Step {
  key: string;
  label: string;
  description?: string;
  /** Si el paso tiene errores (rojo). */
  invalid?: boolean;
}

interface StepperProps {
  steps: Step[];
  current: number; // 0-based
  onJump?: (index: number) => void;
  className?: string;
  /**
   * Compacto: muestra círculos numerados + conector y el nombre del paso activo
   * abajo, en vez de la etiqueta al lado de cada círculo. Para wizards con muchos
   * pasos que no entran en una fila sin cortarse (JL 2 · obs 4: el wizard de
   * activación llega a 6 pasos con Campus y el 6º se salía del modal). Escala a
   * cualquier cantidad de pasos y a 360px.
   */
  compact?: boolean;
}

// Indicador de progreso premium: pastilla activa con label, dots conectados,
// check verde en pasos completados, rojo si tiene error. Click para saltar
// a pasos previos.
export function Stepper({ steps, current, onJump, className, compact }: StepperProps) {
  // Modo compacto (JL 2 · obs 4): círculos numerados + conector en una fila y el
  // nombre del paso activo abajo. Reemplaza las etiquetas al lado de cada círculo
  // (que con 6 pasos desbordaban el modal de 820px y cortaban el 6º). Escala a
  // cualquier cantidad de pasos y a 360px. El modo normal (drawers de 3-5 pasos)
  // queda intacto.
  if (compact) {
    return (
      <div className={cn('w-full', className)}>
        <ol className="flex w-full items-center gap-1.5">
          {steps.map((s, i) => {
            const done = i < current;
            const active = i === current;
            const future = i > current;
            const clickable = i < current && onJump;
            return (
              <li
                key={s.key}
                className={cn(
                  'flex items-center gap-1.5',
                  i < steps.length - 1 ? 'flex-1' : 'flex-none',
                )}
              >
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && onJump?.(i)}
                  title={s.label}
                  className={cn(
                    'grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold ring-1 ring-inset transition',
                    s.invalid
                      ? 'bg-red-50 text-red-600 ring-red-200'
                      : done
                        ? 'bg-emerald-500 text-white ring-emerald-500'
                        : active
                          ? 'bg-brand-cyan text-white ring-brand-cyan'
                          : 'bg-white text-brand-muted ring-slate-200',
                    active && 'shadow-[0_0_0_4px_rgba(0,158,202,0.18)]',
                    clickable ? 'cursor-pointer hover:ring-slate-300' : 'cursor-default',
                  )}
                >
                  {done ? <Check size={12} strokeWidth={3} /> : i + 1}
                </button>
                {i < steps.length - 1 && (
                  <span
                    aria-hidden
                    className={cn(
                      'h-px flex-1 transition-colors',
                      future ? 'bg-slate-200' : 'bg-brand-cyan/40',
                    )}
                  />
                )}
              </li>
            );
          })}
        </ol>
        <p className="mt-2.5 text-center text-xs font-semibold uppercase tracking-wider">
          <span className="text-brand-muted">
            Paso {current + 1} de {steps.length}
          </span>
          <span aria-hidden className="mx-1.5 text-slate-300">
            ·
          </span>
          <span
            className={steps[current]?.invalid ? 'text-red-600' : 'text-brand-ink'}
          >
            {steps[current]?.label}
          </span>
        </p>
      </div>
    );
  }

  return (
    <ol className={cn('flex w-full items-center gap-1.5', className)}>
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const future = i > current;
        const clickable = i < current && onJump;
        return (
          <li key={s.key} className="flex flex-1 items-center gap-1.5">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onJump?.(i)}
              className={cn(
                'group flex w-full flex-col items-start gap-1 rounded-lg px-3 py-2 text-left transition',
                clickable && 'hover:bg-slate-50 cursor-pointer',
                !clickable && 'cursor-default',
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold ring-1 ring-inset transition',
                    s.invalid
                      ? 'bg-red-50 text-red-600 ring-red-200'
                      : done
                        ? 'bg-emerald-500 text-white ring-emerald-500'
                        : active
                          ? 'bg-brand-cyan text-white ring-brand-cyan'
                          : 'bg-white text-brand-muted ring-slate-200',
                    active && 'shadow-[0_0_0_4px_rgba(0,158,202,0.18)]',
                  )}
                >
                  {done ? <Check size={12} strokeWidth={3} /> : i + 1}
                </span>
                <span
                  className={cn(
                    'text-xs font-semibold uppercase tracking-wider transition',
                    active
                      ? 'text-brand-ink'
                      : done
                        ? 'text-emerald-700'
                        : 'text-brand-muted',
                  )}
                >
                  {s.label}
                </span>
              </span>
              {active && s.description && (
                <span className="hidden text-[11px] text-brand-muted sm:inline">
                  {s.description}
                </span>
              )}
            </button>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  'h-px flex-1 transition-colors',
                  future ? 'bg-slate-200' : 'bg-brand-cyan/40',
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// Contenedor de cada paso con título + subtítulo + contenido. Anima al
// cambiar de paso con fade-up.
export function StepPanel({
  title,
  subtitle,
  stepKey,
  children,
}: {
  title: string;
  subtitle?: string;
  stepKey: string;
  children: ReactNode;
}) {
  return (
    <div
      key={stepKey}
      className="space-y-5 motion-safe:animate-fade-up"
    >
      <header>
        <h3 className="font-display text-lg font-bold text-brand-ink">
          {title}
        </h3>
        {subtitle && <p className="mt-1 text-sm text-brand-muted">{subtitle}</p>}
      </header>
      {children}
    </div>
  );
}
