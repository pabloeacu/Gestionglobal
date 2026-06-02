import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { Button, Field, Input, Select, useConfirm } from '@/components/common';
import {
  upsertCategoriaConfig,
  deleteCategoriaConfig,
  colorBadge,
  type TrackingCategoriaConfigRow,
} from '@/services/api/trackings';
import { cn } from '@/lib/cn';
import { humanizeError } from '@/lib/errors';

const COLORS = ['slate', 'cyan', 'teal', 'amber', 'red', 'emerald'] as const;

export interface CategoriasConfigManagerProps {
  servicioId: string | null;
  categorias: TrackingCategoriaConfigRow[];
  onChange: () => void;
}

export function CategoriasConfigManager({
  servicioId,
  categorias,
  onChange,
}: CategoriasConfigManagerProps) {
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    slug: '',
    label: '',
    icono: '',
    color: 'slate' as string,
    orden: 0,
  });

  async function handleAdd() {
    if (!draft.slug.trim() || !draft.label.trim()) {
      toast.error('Slug y label son obligatorios');
      return;
    }
    const res = await upsertCategoriaConfig({
      servicio_id: servicioId,
      slug: draft.slug.trim(),
      label: draft.label.trim(),
      icono: draft.icono.trim() || null,
      color: draft.color,
      orden: draft.orden,
    });
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Categoría agregada');
    setDraft({ slug: '', label: '', icono: '', color: 'slate', orden: 0 });
    setAdding(false);
    onChange();
  }

  async function handleDelete(c: TrackingCategoriaConfigRow) {
    if (c.servicio_id === null) {
      toast.error('No se pueden eliminar categorías default.');
      return;
    }
    const ok = await confirm({
      title: 'Eliminar categoría',
      message: `¿Eliminar "${c.label}"? Las líneas existentes con esta categoría no se modifican.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const res = await deleteCategoriaConfig(c.id);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Categoría eliminada');
    onChange();
  }

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Categorías de líneas</h3>
        <Button variant="ghost" onClick={() => setAdding(true)} disabled={adding} className="py-1.5">
          <Plus className="h-4 w-4" /> Agregar
        </Button>
      </header>

      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {categorias.map((c) => (
          <li key={c.id} className="flex items-center gap-3 p-3">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1',
                colorBadge(c.color),
              )}
            >
              {c.label}
            </span>
            <span className="font-mono text-xs text-slate-500">{c.slug}</span>
            {c.icono && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                {c.icono}
              </span>
            )}
            <span className="ml-auto text-xs text-slate-400">orden {c.orden}</span>
            {c.servicio_id !== null && (
              <button
                onClick={() => void handleDelete(c)}
                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                aria-label="Eliminar"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-cyan-200 bg-cyan-50/30 p-4">
          <Field label="Slug" required>
            <Input
              value={draft.slug}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              placeholder="mi_categoria"
            />
          </Field>
          <Field label="Label" required>
            <Input
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="Mi Categoría"
            />
          </Field>
          <Field label="Ícono (lucide slug)">
            <Input
              value={draft.icono}
              onChange={(e) => setDraft({ ...draft, icono: e.target.value })}
              placeholder="check / bell / mail / …"
            />
          </Field>
          <Field label="Color">
            <Select
              value={draft.color}
              onChange={(e) => setDraft({ ...draft, color: e.target.value })}
            >
              {COLORS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Orden">
            <Input
              type="number"
              value={draft.orden}
              onChange={(e) => setDraft({ ...draft, orden: Number(e.target.value) })}
            />
          </Field>
          <div className="col-span-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAdding(false)} className="py-1.5">
              Cancelar
            </Button>
            <Button onClick={handleAdd} className="py-1.5">
              Guardar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
