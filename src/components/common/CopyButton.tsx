import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';

// Click-to-copy chip que muestra check + toast 800ms al copiar.
// Usar para CUIT, email, teléfono, IBAN, códigos. Si el value es null
// renderiza un guion mudo (no copia nada).
export function CopyButton({
  value,
  label,
  className,
  tabular,
}: {
  value: string | null | undefined;
  label?: string;
  className?: string;
  tabular?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  if (!value) {
    return <span className="text-brand-muted">—</span>;
  }
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value as string);
      setCopied(true);
      toast.success(`${label ?? 'Copiado'} al portapapeles`);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error('No pudimos copiar al portapapeles');
    }
  }
  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition',
        'hover:bg-brand-cyan-pale/40 hover:text-brand-cyan',
        tabular && 'tabular',
        className,
      )}
      title={`Copiar ${label ?? value}`}
    >
      <span className="truncate">{value}</span>
      <span className="opacity-0 transition group-hover:opacity-100">
        {copied ? (
          <Check size={13} className="text-emerald-600" />
        ) : (
          <Copy size={13} className="text-brand-muted group-hover:text-brand-cyan" />
        )}
      </span>
    </button>
  );
}
