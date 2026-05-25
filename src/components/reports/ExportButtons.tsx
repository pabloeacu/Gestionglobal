// ============================================================================
// ExportButtons — DGG-26
//
// Par de botones drop-in para exportar la pantalla actual a PDF (branded)
// o XLS. La pantalla solo provee el callback que arma los datos en el
// momento del click (así respeta filtros vivos sin cachear state intermedio).
// ============================================================================

import { useState } from 'react';
import { FileDown, FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';

interface ExportButtonsProps {
  onExportPdf: () => Promise<void>;
  onExportXls: () => Promise<void>;
  // Opcional: deshabilitar mientras no hay datos.
  disabled?: boolean;
  // Texto del tooltip / aria-label.
  hint?: string;
}

export function ExportButtons({
  onExportPdf,
  onExportXls,
  disabled,
  hint,
}: ExportButtonsProps) {
  const [busy, setBusy] = useState<'pdf' | 'xls' | null>(null);

  async function run(kind: 'pdf' | 'xls', fn: () => Promise<void>) {
    if (disabled || busy) return;
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      toast.error('No pudimos exportar', {
        description: e instanceof Error ? e.message : 'Probá de nuevo',
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
      <button
        type="button"
        disabled={disabled || busy !== null}
        onClick={() => run('pdf', onExportPdf)}
        title={hint ? `${hint} · PDF` : 'Exportar PDF (con branding)'}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-brand-ink transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy === 'pdf' ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <FileDown size={15} />
        )}
        PDF
      </button>
      <span className="h-5 w-px bg-slate-200" />
      <button
        type="button"
        disabled={disabled || busy !== null}
        onClick={() => run('xls', onExportXls)}
        title={hint ? `${hint} · Excel` : 'Exportar Excel'}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-brand-ink transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy === 'xls' ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <FileSpreadsheet size={15} />
        )}
        XLS
      </button>
    </div>
  );
}
