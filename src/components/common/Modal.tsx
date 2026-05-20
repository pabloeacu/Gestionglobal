import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSounds } from '@/contexts/SoundContext';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  kicker?: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  closeOnBackdrop?: boolean;
}

// Modal para confirmaciones rápidas. Para flujos largos usar Drawer.
// El scroll vive en el contenido, nunca en la página (AP-scroll-doble).
export function Modal({
  open,
  onClose,
  title,
  kicker,
  icon,
  children,
  footer,
  width = 480,
  closeOnBackdrop = true,
}: ModalProps) {
  const { play } = useSounds();
  const [prevOpen, setPrevOpen] = useState(false);

  useEffect(() => {
    if (open && !prevOpen) play('open');
    if (!open && prevOpen) play('close');
    setPrevOpen(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-ink/40 p-4 backdrop-blur-sm motion-safe:animate-fade-in"
      onMouseDown={(e) => closeOnBackdrop && e.target === e.currentTarget && onClose()}
    >
      <div
        className="card-premium flex max-h-[85vh] w-full flex-col overflow-hidden motion-safe:animate-spring-in"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
      >
        {(title || kicker) && (
          <div className="flex items-start gap-3 border-b border-slate-100 p-5">
            {icon && (
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-cyan-pale/40 text-brand-cyan">
                {icon}
              </span>
            )}
            <div className="min-w-0 flex-1">
              {kicker && <p className="kicker">{kicker}</p>}
              {title && <h2 className="text-lg font-semibold text-brand-ink">{title}</h2>}
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-brand-muted hover:bg-slate-100"
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className={cn('flex-1 overflow-y-auto p-5')}>{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-slate-100 bg-brand-zebra p-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
