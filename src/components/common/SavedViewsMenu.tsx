// ============================================================================
// SavedViewsMenu · selector "Mis vistas" reusable (DGG-37 / P2-#26)
//
// Drop-in para cualquier listado. La pantalla:
//   • Pasa `modulo` (identificador único · ej "vencimientos").
//   • Pasa `currentFiltros` (jsonb arbitrario · lo que esa pantalla quiera).
//   • Pasa `onApply(filtros)` callback para aplicar una vista cargada.
//
// El componente lista las vistas guardadas, deja guardar la actual con un
// nombre, marcar default, borrar, y aplicar default automáticamente al
// montar (vía `applyDefaultOnMount`).
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookmarkPlus,
  Bookmark,
  ChevronDown,
  Star,
  Trash2,
  Loader2,
  Check,
} from 'lucide-react';
import { Button, Field, Input, Modal, useConfirm } from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  borrarVista,
  guardarVista,
  listVistas,
  setVistaDefault,
  type VistaGuardada,
} from '@/services/api/vistas';

interface SavedViewsMenuProps {
  /** Identificador único del listado (ej "vencimientos") */
  modulo: string;
  /** Estado actual de filtros · se guarda cuando el usuario hace "Guardar como…" */
  currentFiltros: Record<string, unknown>;
  /** Callback: aplicar estos filtros al listado */
  onApply: (filtros: Record<string, unknown>) => void;
  /** Si true, al montar carga las vistas y aplica la default si existe.
   *  Sólo en el primer mount — útil para "abrir en mi vista favorita". */
  applyDefaultOnMount?: boolean;
}

export function SavedViewsMenu({
  modulo,
  currentFiltros,
  onApply,
  applyDefaultOnMount = true,
}: SavedViewsMenuProps) {
  const confirm = useConfirm();
  const [vistas, setVistas] = useState<VistaGuardada[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [nombre, setNombre] = useState('');
  const [esDefault, setEsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const mountAppliedRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await listVistas(modulo);
    if (r.ok) {
      setVistas(r.data);
      // Aplicar default al primer mount
      if (applyDefaultOnMount && !mountAppliedRef.current) {
        const def = r.data.find((v) => v.es_default);
        if (def) onApply(def.filtros);
        mountAppliedRef.current = true;
      }
    }
    setLoading(false);
  }, [modulo, applyDefaultOnMount, onApply]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modulo]);

  // Cerrar dropdown por click fuera / Esc
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function handleGuardar() {
    if (!nombre.trim()) {
      toast.error('Ponele un nombre a la vista');
      return;
    }
    setSaving(true);
    const r = await guardarVista(modulo, nombre.trim(), currentFiltros, esDefault);
    setSaving(false);
    if (!r.ok) {
      toast.error('No pudimos guardar la vista', { description: r.error.message });
      return;
    }
    toast.success(`Vista "${nombre}" guardada`);
    setSaveOpen(false);
    setNombre('');
    setEsDefault(false);
    void refresh();
  }

  async function handleAplicar(v: VistaGuardada) {
    onApply(v.filtros);
    setOpen(false);
    toast.success(`Aplicada "${v.nombre}"`, { duration: 1500 });
  }

  async function handleDefault(v: VistaGuardada) {
    setBusyId(v.id);
    const r = await setVistaDefault(v.id);
    setBusyId(null);
    if (!r.ok) {
      toast.error('No pudimos marcar como default', { description: r.error.message });
      return;
    }
    toast.success(`"${v.nombre}" es ahora la vista por defecto`);
    void refresh();
  }

  async function handleBorrar(v: VistaGuardada) {
    const ok2 = await confirm({
      title: 'Borrar vista guardada',
      message: `¿Eliminar "${v.nombre}"? Los filtros guardados se perderán.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok2) return;
    setBusyId(v.id);
    const r = await borrarVista(v.id);
    setBusyId(null);
    if (!r.ok) {
      toast.error('No pudimos borrar la vista', { description: r.error.message });
      return;
    }
    toast.success('Vista eliminada');
    void refresh();
  }

  const total = vistas.length;
  const defaultName = vistas.find((v) => v.es_default)?.nombre;

  return (
    <>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-ink transition hover:border-brand-cyan/40',
            open && 'border-brand-cyan/40 bg-brand-cyan/5',
          )}
          aria-expanded={open}
          title="Mis vistas guardadas"
        >
          <Bookmark size={13} className="text-brand-cyan" />
          <span className="hidden sm:inline">Mis vistas</span>
          {total > 0 && (
            <span className="rounded-full bg-brand-cyan-pale/60 px-1.5 py-0.5 text-[10px] font-bold text-brand-cyan">
              {total}
            </span>
          )}
          <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
        </button>

        {open && (
          <div
            className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_18px_40px_-10px_rgba(18,34,48,0.25)] motion-safe:animate-fade-up"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
                Mis vistas
              </p>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setSaveOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded-full bg-brand-cyan px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-brand-cyan/90"
              >
                <BookmarkPlus size={11} /> Guardar actual
              </button>
            </div>
            <div className="max-h-[55vh] overflow-y-auto">
              {loading ? (
                <p className="flex items-center justify-center gap-2 py-6 text-xs text-brand-muted">
                  <Loader2 size={12} className="animate-spin" /> Cargando…
                </p>
              ) : vistas.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-brand-muted">
                  No tenés vistas guardadas. Guardá los filtros actuales para
                  reutilizarlos más adelante.
                </p>
              ) : (
                <ul>
                  {vistas.map((v) => (
                    <li
                      key={v.id}
                      className={cn(
                        'group flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0',
                        v.es_default && 'bg-brand-cyan-pale/10',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => void handleAplicar(v)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium text-brand-ink">
                          {v.es_default && (
                            <Star size={11} className="text-amber-500" fill="currentColor" />
                          )}
                          {v.nombre}
                        </p>
                        <p className="text-[10px] text-brand-muted">
                          {Object.keys(v.filtros).length}{' '}
                          {Object.keys(v.filtros).length === 1 ? 'filtro' : 'filtros'}
                        </p>
                      </button>
                      <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                        {!v.es_default && (
                          <button
                            type="button"
                            onClick={() => void handleDefault(v)}
                            disabled={busyId === v.id}
                            className="rounded p-1 text-brand-muted hover:bg-amber-50 hover:text-amber-700"
                            title="Marcar como default"
                            aria-label="Marcar como default"
                          >
                            <Star size={12} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleBorrar(v)}
                          disabled={busyId === v.id}
                          className="rounded p-1 text-brand-muted hover:bg-rose-50 hover:text-rose-700"
                          title="Borrar vista"
                          aria-label="Borrar"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {defaultName && (
              <p className="border-t border-slate-100 bg-slate-50/50 px-3 py-2 text-[10.5px] text-brand-muted">
                Default: <span className="font-medium text-amber-700">{defaultName}</span> ·
                se aplica al entrar al listado.
              </p>
            )}
          </div>
        )}
      </div>

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Guardar vista"
        kicker="Filtros guardados"
        icon={<BookmarkPlus size={16} />}
        width={420}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSaveOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={() => void handleGuardar()} disabled={saving || !nombre.trim()}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Guardar
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-brand-muted">
            Va a quedar guardada con los filtros que tenés aplicados ahora.
            Podés reutilizarla más adelante con un click.
          </p>
          <Field label="Nombre" required>
            <Input
              autoFocus
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder='ej. "Vencidos críticos"'
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleGuardar();
              }}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-brand-ink">
            <input
              type="checkbox"
              checked={esDefault}
              onChange={(e) => setEsDefault(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-cyan focus:ring-brand-cyan/40"
            />
            <span>Marcar como default · se aplica al entrar a la pantalla</span>
          </label>
        </div>
      </Modal>
    </>
  );
}
