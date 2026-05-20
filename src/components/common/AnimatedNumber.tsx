import { useEffect, useRef, useState } from 'react';

interface AnimatedNumberProps {
  value: number;
  /** Duración de la animación en ms. Default 700. */
  durationMs?: number;
  /** Formatter custom (ej. Intl.NumberFormat). */
  format?: (n: number) => string;
  className?: string;
}

// Number counter con ease-out (estilo Apple Numbers / Stripe).
// Respeta prefers-reduced-motion (muestra el valor final directo).
export function AnimatedNumber({
  value,
  durationMs = 700,
  format,
  className,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setDisplay(value);
      return;
    }
    fromRef.current = display;
    startRef.current = null;
    let raf = 0;

    const step = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const t = Math.min(1, (ts - startRef.current) / durationMs);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      const next = fromRef.current + (value - fromRef.current) * eased;
      setDisplay(next);
      if (t < 1) raf = requestAnimationFrame(step);
      else setDisplay(value);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  const text = format ? format(Math.round(display)) : String(Math.round(display));
  return <span className={className}>{text}</span>;
}
