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
  // Marca si ya recibimos un valor "real" después del mount.
  // Patrón: si el componente se monta con value=0 y el padre todavía está
  // cargando datos, no queremos animar 0 → N — eso da sensación de "los KPIs
  // estaban en cero". En vez de eso, saltamos directo a value la primera vez
  // que el padre nos entrega un valor distinto del initial.
  const settledRef = useRef(false);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setDisplay(value);
      settledRef.current = true;
      return;
    }
    // Primer "asentamiento" después del mount: si arrancamos en 0 pero el
    // padre nos entrega un valor positivo, saltamos directo (data inicial).
    if (!settledRef.current) {
      settledRef.current = true;
      setDisplay(value);
      fromRef.current = value;
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

  const rounded = Math.round(display);
  const text = format ? format(rounded) : DEFAULT_NF.format(rounded);
  return <span className={className}>{text}</span>;
}

// Formato por default: separadores de miles es-AR. Para casos especiales
// (porcentajes, monedas, etc) pasar `format` explícito.
const DEFAULT_NF = new Intl.NumberFormat('es-AR');
