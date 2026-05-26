// Tooltip · custom premium tooltip con animación brand. Reemplaza el
// `title` nativo del browser (que tarda 1+ segundos en aparecer y es feo).
//
// Uso:
//   <Tooltip label="Cerrar sesión" side="right">
//     <button>...</button>
//   </Tooltip>
//
// Aparece a los 150ms de hover/focus, se oculta inmediatamente al salir.
// Posicionable a 4 lados (top/right/bottom/left).

import {
  useEffect,
  useId,
  useRef,
  useState,
  cloneElement,
  type ReactElement,
  type ReactNode,
} from 'react';

type Side = 'top' | 'right' | 'bottom' | 'left';

interface TooltipProps {
  label: ReactNode;
  side?: Side;
  /** Delay antes de mostrar (ms). Default 150. */
  delay?: number;
  /** Si false, no renderiza el tooltip (útil cuando un padre quiere desactivar). */
  enabled?: boolean;
  children: ReactElement;
}

export function Tooltip({
  label,
  side = 'top',
  delay = 150,
  enabled = true,
  children,
}: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (showTimer.current) clearTimeout(showTimer.current); };
  }, []);

  function place() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    let left = 0, top = 0;
    switch (side) {
      case 'top':    left = r.left + r.width / 2; top = r.top - margin; break;
      case 'bottom': left = r.left + r.width / 2; top = r.bottom + margin; break;
      case 'left':   left = r.left - margin; top = r.top + r.height / 2; break;
      case 'right':  left = r.right + margin; top = r.top + r.height / 2; break;
    }
    setCoords({ left, top });
  }

  function show() {
    if (!enabled) return;
    place();
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => setOpen(true), delay);
  }

  function hide() {
    if (showTimer.current) clearTimeout(showTimer.current);
    setOpen(false);
  }

  // Recibimos un solo hijo y le inyectamos handlers + ref
  const trigger = cloneElement(children as ReactElement<Record<string, unknown>>, {
    ref: (node: HTMLElement | null) => { triggerRef.current = node; },
    onMouseEnter: (e: React.MouseEvent) => {
      const orig = (children.props as Record<string, unknown>)?.onMouseEnter as ((e: React.MouseEvent) => void) | undefined;
      orig?.(e); show();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      const orig = (children.props as Record<string, unknown>)?.onMouseLeave as ((e: React.MouseEvent) => void) | undefined;
      orig?.(e); hide();
    },
    onFocus: (e: React.FocusEvent) => {
      const orig = (children.props as Record<string, unknown>)?.onFocus as ((e: React.FocusEvent) => void) | undefined;
      orig?.(e); show();
    },
    onBlur: (e: React.FocusEvent) => {
      const orig = (children.props as Record<string, unknown>)?.onBlur as ((e: React.FocusEvent) => void) | undefined;
      orig?.(e); hide();
    },
    'aria-describedby': open ? id : undefined,
  });

  return (
    <>
      {trigger}
      {open && coords && enabled && (
        <span
          id={id}
          role="tooltip"
          className={`pointer-events-none fixed z-[200] rounded-lg bg-brand-ink/95 px-2.5 py-1 text-[11px] font-medium text-white shadow-lg backdrop-blur motion-safe:animate-tooltip-in`}
          style={tooltipStyle(side, coords)}
        >
          {label}
          <span
            aria-hidden
            className="absolute h-1.5 w-1.5 rotate-45 bg-brand-ink/95"
            style={arrowStyle(side)}
          />
        </span>
      )}
    </>
  );
}

function tooltipStyle(side: Side, c: { left: number; top: number }): React.CSSProperties {
  switch (side) {
    case 'top':    return { left: c.left, top: c.top, transform: 'translate(-50%, -100%)' };
    case 'bottom': return { left: c.left, top: c.top, transform: 'translate(-50%, 0)' };
    case 'left':   return { left: c.left, top: c.top, transform: 'translate(-100%, -50%)' };
    case 'right':  return { left: c.left, top: c.top, transform: 'translate(0, -50%)' };
  }
}

function arrowStyle(side: Side): React.CSSProperties {
  switch (side) {
    case 'top':    return { bottom: -3, left: '50%', marginLeft: -3 };
    case 'bottom': return { top: -3, left: '50%', marginLeft: -3 };
    case 'left':   return { right: -3, top: '50%', marginTop: -3 };
    case 'right':  return { left: -3, top: '50%', marginTop: -3 };
  }
}
