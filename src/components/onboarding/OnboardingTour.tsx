// D1 · #10 · Tour de bienvenida del gerente.
//
// Tour custom de 6 pasos sin dependencias externas (Shepherd.js descartado
// para mantener bundle liviano). Highlight via overlay con "agujero" que
// expone el target real (CSS box-shadow grande + animación).
//
// Activación:
//   - Primera vez del gerente → automático (localStorage flag).
//   - Manual desde Perfil → resetTour() y mostrar.
//
// API:
//   <OnboardingTour open={open} onClose={() => ...} steps={STEPS_GERENCIA} />

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ChevronLeft, ChevronRight, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/common';

export interface TourStep {
  /** CSS selector del elemento a destacar (null = pantalla centrada sin highlight). */
  target: string | null;
  title: string;
  description: ReactNode;
  /** Posición del card respecto al target. Default 'bottom'. */
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  /** Ruta a navegar antes de mostrar el paso. */
  navigateTo?: string;
}

interface Props {
  open: boolean;
  steps: TourStep[];
  onClose: (completed: boolean) => void;
}

const CARD_W = 360;
const CARD_PAD = 16;

export function OnboardingTour({ open, steps, onClose }: Props) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardPos, setCardPos] = useState<{ left: number; top: number }>({
    left: window.innerWidth / 2 - CARD_W / 2,
    top: window.innerHeight / 2 - 120,
  });
  const animRef = useRef<number | null>(null);

  const step = steps[idx];

  // Navegar al `navigateTo` si lo tiene, antes de medir el target.
  useEffect(() => {
    if (!open || !step?.navigateTo) return;
    if (window.location.pathname === step.navigateTo) return;
    window.history.pushState({}, '', step.navigateTo);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, [open, step]);

  // Medir target + calcular posición del card.
  useLayoutEffect(() => {
    if (!open || !step) return;
    function measure() {
      if (!step || !step.target) {
        setRect(null);
        setCardPos({
          left: Math.max(20, window.innerWidth / 2 - CARD_W / 2),
          top: window.innerHeight / 2 - 140,
        });
        return;
      }
      const el = document.querySelector(step.target);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect(r);
      const placement = step.placement ?? 'bottom';
      let left = 0;
      let top = 0;
      switch (placement) {
        case 'top':
          left = r.left + r.width / 2 - CARD_W / 2;
          top = r.top - 180;
          break;
        case 'bottom':
          left = r.left + r.width / 2 - CARD_W / 2;
          top = r.bottom + 12;
          break;
        case 'left':
          left = r.left - CARD_W - 12;
          top = r.top;
          break;
        case 'right':
          left = r.right + 12;
          top = r.top;
          break;
        case 'center':
          left = window.innerWidth / 2 - CARD_W / 2;
          top = window.innerHeight / 2 - 140;
          break;
      }
      // Clamp dentro del viewport con margen.
      left = Math.max(16, Math.min(left, window.innerWidth - CARD_W - 16));
      top = Math.max(16, Math.min(top, window.innerHeight - 220));
      setCardPos({ left, top });
    }
    measure();
    // Esperar un tick por si la navegación recién acaba de pintar.
    animRef.current = window.requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [open, idx, step]);

  if (!open || !step) return null;

  function next() {
    if (idx >= steps.length - 1) {
      onClose(true);
    } else {
      setIdx(idx + 1);
    }
  }
  function prev() {
    if (idx > 0) setIdx(idx - 1);
  }
  function skip() {
    onClose(false);
  }

  return createPortal(
    <div className="fixed inset-0 z-[80]">
      {/* Overlay con agujero sobre el target */}
      {rect ? (
        <>
          <div
            className="absolute bg-brand-ink/55 backdrop-blur-[2px] transition-all duration-300"
            style={{ inset: 0 }}
          />
          {/* Ring/glow alrededor del target */}
          <div
            className="pointer-events-none absolute rounded-xl ring-4 ring-brand-cyan ring-offset-2 ring-offset-transparent transition-all duration-300 motion-safe:animate-pulse"
            style={{
              left: rect.left - 6,
              top: rect.top - 6,
              width: rect.width + 12,
              height: rect.height + 12,
              boxShadow:
                '0 0 0 9999px rgba(15, 31, 49, 0.55), 0 0 40px rgba(6,182,212,0.35)',
            }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-brand-ink/55 backdrop-blur-[2px]" />
      )}

      {/* Card con el contenido del paso */}
      <div
        role="dialog"
        aria-label={`Tour · paso ${idx + 1} de ${steps.length}`}
        className="absolute w-[360px] rounded-2xl border border-slate-200 bg-white shadow-2xl motion-safe:animate-spring-in"
        style={{
          left: cardPos.left,
          top: cardPos.top,
          padding: CARD_PAD,
        }}
      >
        <header className="mb-2 flex items-start justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-cyan-pale/60 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-cyan">
            <Sparkles size={10} />
            Paso {idx + 1} de {steps.length}
          </span>
          <button
            type="button"
            onClick={skip}
            aria-label="Saltar tour"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-ink"
          >
            <X size={14} />
          </button>
        </header>
        <h3 className="mb-1 font-display text-base font-semibold text-brand-ink">
          {step.title}
        </h3>
        <div className="text-sm text-brand-ink/80">{step.description}</div>
        <footer className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={skip}
            className="text-xs text-brand-muted underline-offset-2 hover:underline"
          >
            Saltar
          </button>
          <div className="flex items-center gap-2">
            {idx > 0 && (
              <Button variant="ghost" onClick={prev} className="!px-2 !py-1.5 !text-xs">
                <ChevronLeft size={12} /> Anterior
              </Button>
            )}
            <Button onClick={next} className="!px-3 !py-1.5 !text-xs">
              {idx >= steps.length - 1 ? (
                <>
                  Terminar <ArrowRight size={12} />
                </>
              ) : (
                <>
                  Siguiente <ChevronRight size={12} />
                </>
              )}
            </Button>
          </div>
        </footer>
        {/* Dots de progreso */}
        <div className="mt-3 flex justify-center gap-1">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === idx
                  ? 'w-5 bg-brand-cyan'
                  : i < idx
                    ? 'w-1.5 bg-brand-cyan/60'
                    : 'w-1.5 bg-slate-200'
              }`}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Pasos preseteados para el gerente — usa selectores que existen en GerenciaLayout.
export const STEPS_GERENCIA: TourStep[] = [
  {
    target: null,
    placement: 'center',
    title: '¡Bienvenido a Gestión Global!',
    description: (
      <p>
        Esta es tu plataforma operativa. Te muestro los lugares clave en 6 pasos
        rápidos. Podés saltar el tour en cualquier momento y volver a verlo
        desde tu perfil.
      </p>
    ),
  },
  {
    target: '[data-tour="sidebar-captacion"]',
    placement: 'right',
    title: 'Captación',
    description: (
      <p>
        Acá llegan las <strong>solicitudes nuevas</strong>, formularios públicos
        y webinars. El radar comercial de Gestión Global.
      </p>
    ),
  },
  {
    target: '[data-tour="sidebar-clientes"]',
    placement: 'right',
    title: 'Clientes',
    description: (
      <p>
        Tus <strong>administraciones</strong> activas: cuenta corriente, datos
        de contacto, servicios contratados y consorcios.
      </p>
    ),
  },
  {
    target: '[data-tour="sidebar-tramites"]',
    placement: 'right',
    title: 'Trámites',
    description: (
      <p>
        El núcleo operativo: cada trámite tiene su <strong>tracking</strong> con
        avances, adjuntos, alarmas y cierre de ciclo automático.
      </p>
    ),
  },
  {
    target: '[data-tour="sidebar-agenda"]',
    placement: 'right',
    title: 'Agenda',
    description: (
      <p>
        Todo lo que tiene fecha se proyecta acá:{' '}
        <strong>vencimientos, trámites, comprobantes y solicitudes</strong>.
        Tirá tu cabeza acá y la organizamos juntos.
      </p>
    ),
  },
  {
    target: '[data-tour="palette-trigger"]',
    placement: 'bottom',
    title: 'Búsqueda rápida ⌘K',
    description: (
      <p>
        Apretá <kbd className="rounded border bg-slate-100 px-1 text-xs">⌘K</kbd>{' '}
        en cualquier lado para buscar clientes, comprobantes, trámites… o crear
        un evento con lenguaje natural. Tu atajo más usado.
      </p>
    ),
  },
];

const TOUR_KEY = 'gg.gerencia.tourCompleted';

export function shouldShowGerenciaTour(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(TOUR_KEY) !== '1';
  } catch {
    return false;
  }
}

export function markGerenciaTourSeen(): void {
  try {
    window.localStorage.setItem(TOUR_KEY, '1');
  } catch {
    /* noop */
  }
}

export function resetGerenciaTour(): void {
  try {
    window.localStorage.removeItem(TOUR_KEY);
  } catch {
    /* noop */
  }
}
