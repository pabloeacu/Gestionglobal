// PortalOnboardingTour · Tour custom (sin libs externas) que guía al
// cliente la primera vez que entra al portal. Modal central con steps
// que destacan las secciones clave. Reproducible en mobile y desktop.
//
// El estado se persiste en localStorage (`gg_portal_tour_completed`)
// para no re-aparecer en cada visita. Reseteable desde Perfil.

import { useEffect, useState } from 'react';
import {
  Home,
  GraduationCap,
  FileText,
  Video,
  PlusCircle,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  X,
} from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';

const STORAGE_KEY = 'gg_portal_tour_v1';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Step {
  icon: typeof Home;
  kicker: string;
  titulo: string;
  descripcion: string;
}

const STEPS: Step[] = [
  {
    icon: Sparkles,
    kicker: 'BIENVENIDO',
    titulo: 'Tu portal de servicios',
    descripcion: 'Acá tenés todo lo que contrataste con Gestión Global: cursos, trámites, webinars y comprobantes. Te lo presentamos en 5 pasos rápidos.',
  },
  {
    icon: Home,
    kicker: 'INICIO',
    titulo: 'Acceso inteligente',
    descripcion: 'La pantalla principal te muestra lo más importante del día: tus clases próximas, webinars de hoy, vencimientos urgentes y oportunidades para vos.',
  },
  {
    icon: GraduationCap,
    kicker: 'CAMPUS',
    titulo: 'Mis cursos & clases en vivo',
    descripcion: 'Tu carrera profesional centralizada. Cuando una clase esté por empezar, vas a ver el botón "Unirme" desde el inicio.',
  },
  {
    icon: Video,
    kicker: 'WEBINARS',
    titulo: 'Capacitaciones gratuitas',
    descripcion: 'Anotate a webinars formativos sin costo. Te avisamos por email + push notification antes de cada evento.',
  },
  {
    icon: FileText,
    kicker: 'GESTIONES',
    titulo: 'Mis trámites · sin perderles el rastro',
    descripcion: 'Todos tus trámites con estado actualizado, comentarios, archivos y novedades. Si necesitamos algo tuyo, lo verás como "Tu acción".',
  },
  {
    icon: PlusCircle,
    kicker: 'NUEVO SERVICIO',
    titulo: 'Pedí lo que necesites',
    descripcion: 'Desde acá iniciás un nuevo trámite, una consulta jurídica, una renovación de matrícula o inscripción a curso. Te guiamos paso a paso.',
  },
];

export function PortalOnboardingTour({ open, onClose }: Props) {
  const [idx, setIdx] = useState(0);
  const totalSteps = STEPS.length;

  useEffect(() => {
    if (!open) return;
    setIdx(0);
  }, [open]);

  // Bloquear scroll del body cuando está abierto
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const step = STEPS[idx]!;
  const Icon = step.icon;
  const isLast = idx === totalSteps - 1;

  function complete() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ completed_at: new Date().toISOString() })); } catch {}
    onClose();
  }

  function skip() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ skipped_at: new Date().toISOString() })); } catch {}
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-end sm:place-items-center px-3 sm:px-4 py-4 sm:py-6 backdrop-blur">
      {/* overlay */}
      <div
        className="absolute inset-0 bg-brand-ink/60"
        onClick={skip}
        aria-hidden
      />

      {/* card */}
      <div
        className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl motion-safe:animate-fade-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
      >
        <TrianglesAccent position="top-right" size={170} tone="cyan" density="soft" className="opacity-30" />

        {/* close button */}
        <button
          type="button"
          onClick={skip}
          className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/80 text-brand-muted backdrop-blur transition hover:bg-white hover:text-brand-ink"
          aria-label="Cerrar tour"
        >
          <X size={14} />
        </button>

        <div className="relative px-6 pt-8 pb-4 sm:px-8 sm:pt-10">
          {/* Step progress */}
          <div className="mb-5 flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition ${
                  i <= idx ? 'bg-brand-cyan' : 'bg-slate-200'
                }`}
              />
            ))}
          </div>

          {/* Icon */}
          <div className="mb-4 inline-grid h-14 w-14 place-items-center rounded-2xl bg-brand-cyan-pale text-brand-cyan">
            <Icon size={26} />
          </div>

          {/* Content */}
          <p className="kicker text-brand-cyan">{step.kicker}</p>
          <h2 id="tour-title" className="mt-1 font-display text-2xl font-bold text-brand-ink">
            {step.titulo}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-brand-muted">
            {step.descripcion}
          </p>
        </div>

        {/* Footer */}
        <div className="relative flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3 sm:px-8 sm:py-4">
          <button
            type="button"
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={idx === 0}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-muted transition hover:text-brand-ink disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={13} /> Atrás
          </button>

          <span className="text-[11px] font-medium text-brand-muted tabular">
            {idx + 1} / {totalSteps}
          </span>

          {isLast ? (
            <button
              type="button"
              onClick={complete}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-cyan px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-cyan/90"
            >
              ¡Listo! <Sparkles size={13} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIdx((i) => Math.min(totalSteps - 1, i + 1))}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-cyan px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-cyan/90"
            >
              Siguiente <ChevronRight size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Helpers de estado del tour
export function tourCompletado(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return !!raw;
  } catch {
    return false;
  }
}

export function resetTour(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}
