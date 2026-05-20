import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X, AlertTriangle } from 'lucide-react';
import { toastStore, type ToastItem } from '@/lib/toast';
import { useSounds } from '@/contexts/SoundContext';
import { cn } from '@/lib/cn';

const ICON: Record<ToastItem['kind'], typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

const TONE: Record<ToastItem['kind'], string> = {
  success: 'border-emerald-200/70 [--ring:theme(colors.emerald.500)] [--icon:theme(colors.emerald.600)]',
  error: 'border-red-200/70 [--ring:theme(colors.red.500)] [--icon:theme(colors.red.600)]',
  info: 'border-brand-cyan/30 [--ring:theme(colors.brand.cyan)] [--icon:theme(colors.brand.cyan)]',
  warning: 'border-amber-200/70 [--ring:theme(colors.amber.500)] [--icon:theme(colors.amber.600)]',
};

export function ToastViewport() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const { play } = useSounds();

  useEffect(() => toastStore.subscribe(setItems), []);

  // Sonido al aparecer un toast nuevo
  useEffect(() => {
    const last = items[items.length - 1];
    if (!last) return;
    if (last.kind === 'success') play('success');
    else if (last.kind === 'error') play('error');
    // info/warning sin sonido para no saturar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:px-6">
      {items.slice(-5).map((t) => (
        <ToastCard key={t.id} item={t} />
      ))}
    </div>
  );
}

function ToastCard({ item }: { item: ToastItem }) {
  const Icon = ICON[item.kind];
  const [progress, setProgress] = useState(1);

  // Progress ring countdown
  useEffect(() => {
    const start = item.createdAt;
    let raf = 0;
    const tick = () => {
      const elapsed = Date.now() - start;
      const left = 1 - elapsed / item.durationMs;
      if (left <= 0) {
        toastStore.dismiss(item.id);
        return;
      }
      setProgress(left);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [item.id, item.createdAt, item.durationMs]);

  // Ring math
  const R = 9;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - progress);

  return (
    <div
      className={cn(
        'pointer-events-auto relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-2xl border bg-white/85 p-3 pr-10 shadow-[0_24px_60px_-30px_rgba(18,34,48,0.45)] backdrop-blur-md',
        'motion-safe:animate-fade-up',
        TONE[item.kind],
      )}
      role="status"
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
        style={{ background: 'color-mix(in oklab, var(--icon) 14%, transparent)' }}
      >
        <Icon size={18} style={{ color: 'var(--icon)' }} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-brand-ink">{item.message}</p>
        {item.description && (
          <p className="mt-0.5 text-xs text-brand-muted">{item.description}</p>
        )}
      </div>
      <button
        onClick={() => toastStore.dismiss(item.id)}
        className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full text-brand-muted hover:bg-slate-100 hover:text-brand-ink"
        aria-label="Cerrar"
      >
        <X size={13} />
      </button>
      {/* Progress ring abajo a la derecha (sutil) */}
      <svg
        aria-hidden
        className="pointer-events-none absolute right-2 bottom-2 h-5 w-5 -rotate-90"
        viewBox="0 0 22 22"
      >
        <circle
          cx="11"
          cy="11"
          r={R}
          fill="none"
          stroke="rgba(0,0,0,0.08)"
          strokeWidth="2"
        />
        <circle
          cx="11"
          cy="11"
          r={R}
          fill="none"
          stroke="var(--ring)"
          strokeWidth="2"
          strokeDasharray={C}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 60ms linear' }}
        />
      </svg>
    </div>
  );
}
