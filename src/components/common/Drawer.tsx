import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useSounds } from '@/contexts/SoundContext';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  kicker?: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

// Drawer para flujos largos (wizards, conciliación). Modal solo para
// confirmaciones rápidas (doc 02 §6.1).
export function Drawer({
  open,
  onClose,
  title,
  kicker,
  description,
  icon,
  children,
  footer,
  width = 720,
}: DrawerProps) {
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
      className="fixed inset-0 z-50 flex justify-end bg-brand-ink/40 backdrop-blur-sm motion-safe:animate-fade-in"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex h-full w-full flex-col bg-white shadow-xl motion-safe:animate-slide-in-right"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start gap-3 border-b border-slate-100 p-5">
          {icon && (
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-cyan-pale/40 text-brand-cyan">
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            {kicker && <p className="kicker">{kicker}</p>}
            {title && <h2 className="text-xl font-semibold text-brand-ink">{title}</h2>}
            {description && <p className="mt-1 text-sm text-brand-muted">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-brand-muted hover:bg-slate-100"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-slate-100 bg-brand-zebra p-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
