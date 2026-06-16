// DGG-85 · Clip de adjuntos (constancias) de un movimiento en la lista de Cajas.
// Ver/descargar/agregar/eliminar. count>0 → clip cian con número; count 0 → clip
// gris para adjuntar una constancia a un egreso existente.
import { useState } from 'react';
import { Paperclip, Download, Plus, Trash2, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useConfirm } from '@/components/common';
import { cn } from '@/lib/cn';
import {
  listAdjuntosMovimiento,
  subirAdjuntoMovimiento,
  urlFirmadaAdjuntoMovimiento,
  eliminarAdjuntoMovimiento,
  type MovimientoAdjuntoRow,
} from '@/services/api/finanzas';

export function MovimientoAdjuntosButton({
  movimientoId,
  initialCount,
}: {
  movimientoId: string;
  initialCount: number;
}) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MovimientoAdjuntoRow[] | null>(null);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const r = await listAdjuntosMovimiento(movimientoId);
    if (r.ok) {
      setItems(r.data);
      setCount(r.data.length);
    }
  }
  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (items === null) await reload();
  }
  async function descargar(a: MovimientoAdjuntoRow) {
    const r = await urlFirmadaAdjuntoMovimiento(a.storage_path);
    if (r.ok) window.open(r.data, '_blank', 'noopener');
    else toast.error('No pudimos abrir el adjunto');
  }
  async function onAdd(files: FileList | null) {
    const fs = Array.from(files ?? []);
    if (!fs.length) return;
    setBusy(true);
    let fail = 0;
    for (const f of fs) {
      const up = await subirAdjuntoMovimiento(movimientoId, f);
      if (!up.ok) fail++;
    }
    setBusy(false);
    if (fail) toast.warning(`${fail} adjunto(s) no se subieron`);
    await reload();
  }
  async function onDelete(a: MovimientoAdjuntoRow) {
    const ok = await confirm({
      title: 'Eliminar constancia',
      message: `¿Eliminar "${a.filename_original}"? Es un comprobante de gasto y la acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const r = await eliminarAdjuntoMovimiento(a);
    setBusy(false);
    if (!r.ok) { toast.error('No pudimos eliminar el adjunto'); return; }
    await reload();
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={toggle}
        title={count > 0 ? `${count} adjunto(s)` : 'Adjuntar constancia'}
        className={cn('rounded-md p-1 hover:bg-slate-100', count > 0 ? 'text-brand-cyan' : 'text-slate-400')}
      >
        <span className="inline-flex items-center gap-0.5">
          <Paperclip size={13} />
          {count > 0 && <span className="text-[10px] font-semibold">{count}</span>}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-2 text-left shadow-lg">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted">
              Constancias
            </span>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-brand-cyan hover:bg-brand-cyan/10">
              <Plus size={12} /> Agregar
              <input
                type="file"
                multiple
                accept="image/*,application/pdf,.xls,.xlsx,.doc,.docx"
                className="hidden"
                disabled={busy}
                onChange={(e) => { void onAdd(e.target.files); e.target.value = ''; }}
              />
            </label>
          </div>
          {items === null ? (
            <div className="flex items-center gap-2 px-1 py-2 text-xs text-brand-muted">
              <Loader2 size={13} className="animate-spin" /> Cargando…
            </div>
          ) : items.length === 0 ? (
            <p className="px-1 py-2 text-xs text-brand-muted">Sin adjuntos. Agregá una constancia.</p>
          ) : (
            items.map((a) => (
              <div key={a.id} className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs hover:bg-slate-50">
                <button
                  type="button"
                  onClick={() => void descargar(a)}
                  className="flex flex-1 items-center gap-1.5 truncate text-left text-brand-ink"
                >
                  <Download size={12} className="flex-none text-brand-cyan" />
                  <span className="truncate">{a.filename_original}</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onDelete(a)}
                  className="flex-none text-slate-400 hover:text-rose-600"
                  title="Eliminar"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
