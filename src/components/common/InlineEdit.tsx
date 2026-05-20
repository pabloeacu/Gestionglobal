import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { cn } from '@/lib/cn';

// Edita en sitio: click → input. Enter o blur guarda, Escape cancela.
// onSave debe devolver una promesa; si rechaza, vuelve al valor previo.
// Para que conviva con tablas/listas conserva la altura de la fila.
export function InlineEdit({
  value,
  onSave,
  placeholder,
  multiline,
  type = 'text',
  className,
  ariaLabel,
}: {
  value: string | null | undefined;
  onSave: (next: string | null) => Promise<void> | void;
  placeholder?: string;
  multiline?: boolean;
  type?: 'text' | 'email' | 'tel';
  className?: string;
  ariaLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      if (el) {
        el.focus();
        if ('setSelectionRange' in el) {
          el.setSelectionRange(el.value.length, el.value.length);
        }
      }
    }
  }, [editing]);

  async function commit() {
    if (busy) return;
    const next = draft.trim();
    const prev = (value ?? '').trim();
    if (next === prev) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSave(next === '' ? null : next);
      setEditing(false);
    } catch {
      setDraft(value ?? '');
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setDraft(value ?? '');
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={ariaLabel ?? 'Editar campo'}
        className={cn(
          'group inline-flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition',
          'hover:bg-brand-cyan-pale/30',
          className,
        )}
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            !value && 'italic text-brand-muted',
          )}
        >
          {value || placeholder || '—'}
        </span>
        <Pencil
          size={12}
          className="shrink-0 text-brand-muted opacity-0 transition group-hover:opacity-100"
        />
      </button>
    );
  }

  const inputCls = cn(
    'min-w-0 flex-1 rounded-md border border-brand-cyan/50 bg-white px-2 py-1 text-sm shadow-sm outline-none',
    'focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/20',
    className,
  );

  return (
    <span className="inline-flex w-full items-center gap-1">
      {multiline ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void commit();
            }
          }}
          rows={3}
          className={inputCls}
          disabled={busy}
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type={type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              void commit();
            }
          }}
          className={inputCls}
          disabled={busy}
          placeholder={placeholder}
        />
      )}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void commit()}
        className="rounded-md p-1 text-emerald-600 hover:bg-emerald-50"
        aria-label="Guardar"
      >
        <Check size={14} />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={cancel}
        className="rounded-md p-1 text-brand-muted hover:bg-slate-100"
        aria-label="Cancelar"
      >
        <X size={14} />
      </button>
    </span>
  );
}
