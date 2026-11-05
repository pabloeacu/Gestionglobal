// LexphTagsPage · CRUD de etiquetas de LexPH (materia / jurisdicción).
// DGG-244 · R4 (services/), R13 (DialogProvider: usePrompt/useConfirm).

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import {
  Button,
  Field,
  Input,
  Select,
  Skeleton,
  useConfirm,
  usePrompt,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import {
  listTags,
  guardarTag,
  eliminarTag,
  type LexphTag,
  type LexphTagTipo,
} from '@/services/api/lexph';

export function LexphTagsPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const prompt = usePrompt();

  const [tags, setTags] = useState<LexphTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<LexphTagTipo>('materia');
  const [adding, setAdding] = useState(false);

  async function refresh() {
    const res = await listTags();
    setLoading(false);
    if (!res.ok) {
      toast.error('No pudimos cargar etiquetas', { description: humanizeError(res.error) });
      return;
    }
    setTags(res.data);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const grupos = useMemo(
    () => ({
      materia: tags.filter((t) => t.tipo === 'materia'),
      jurisdiccion: tags.filter((t) => t.tipo === 'jurisdiccion'),
    }),
    [tags],
  );

  async function handleAdd() {
    if (!nombre.trim()) return;
    setAdding(true);
    const res = await guardarTag({ nombre: nombre.trim(), tipo });
    setAdding(false);
    if (!res.ok) {
      toast.error('No pudimos crear la etiqueta', { description: humanizeError(res.error) });
      return;
    }
    setNombre('');
    toast.success('Etiqueta creada');
    void refresh();
  }

  async function handleRename(t: LexphTag) {
    const nuevo = await prompt({
      title: 'Renombrar etiqueta',
      message: 'Nuevo nombre de la etiqueta',
      defaultValue: t.nombre,
      confirmLabel: 'Guardar',
    });
    if (nuevo === null || !nuevo.trim() || nuevo.trim() === t.nombre) return;
    const res = await guardarTag({ id: t.id, nombre: nuevo.trim(), tipo: t.tipo as LexphTagTipo });
    if (!res.ok) {
      toast.error('No pudimos renombrar', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Etiqueta actualizada');
    void refresh();
  }

  async function handleToggleActivo(t: LexphTag) {
    const res = await guardarTag({
      id: t.id,
      nombre: t.nombre,
      tipo: t.tipo as LexphTagTipo,
      slug: t.slug,
      orden: t.orden,
      activo: !t.activo,
    });
    if (!res.ok) {
      toast.error('No pudimos actualizar', { description: humanizeError(res.error) });
      return;
    }
    void refresh();
  }

  async function handleDelete(t: LexphTag) {
    const ok = await confirm({
      title: 'Eliminar etiqueta',
      message: `¿Eliminar "${t.nombre}"? Se quitará de todos los artículos que la usen.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const res = await eliminarTag(t.id);
    if (!res.ok) {
      toast.error('No pudimos eliminar', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Etiqueta eliminada');
    setTags((prev) => prev.filter((x) => x.id !== t.id));
  }

  return (
    <div className="relative space-y-6 pb-12">
      <TrianglesAccent position="top-right" size={180} tone="cyan" density="soft" className="opacity-30" />

      <header className="card-premium relative overflow-hidden">
        <div className="relative flex flex-wrap items-center gap-4 p-5">
          <button
            type="button"
            onClick={() => navigate('/gerencia/contenidos')}
            className="grid h-9 w-9 place-items-center rounded-lg text-brand-muted transition hover:bg-slate-100 hover:text-brand-ink"
            aria-label="Volver"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <p className="kicker text-brand-cyan">LEXPH · TAXONOMÍA</p>
            <h1 className="font-display text-2xl font-bold text-brand-ink">Etiquetas</h1>
            <p className="mt-0.5 text-sm text-brand-muted">
              Materias temáticas y jurisdicciones para clasificar los artículos.
            </p>
          </div>
        </div>
      </header>

      {/* Alta rápida */}
      <section className="card-premium p-5">
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_200px_auto]">
          <Field label="Nueva etiqueta">
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); }}
              placeholder="Ej. Seguros, Asambleas, CABA…"
            />
          </Field>
          <Field label="Tipo">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value as LexphTagTipo)}>
              <option value="materia">Materia</option>
              <option value="jurisdiccion">Jurisdicción</option>
            </Select>
          </Field>
          <Button onClick={() => void handleAdd()} disabled={adding || !nombre.trim()}>
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Agregar
          </Button>
        </div>
      </section>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          <TagColumn
            titulo="Materias"
            tags={grupos.materia}
            onRename={handleRename}
            onToggle={handleToggleActivo}
            onDelete={handleDelete}
          />
          <TagColumn
            titulo="Jurisdicciones"
            tags={grupos.jurisdiccion}
            onRename={handleRename}
            onToggle={handleToggleActivo}
            onDelete={handleDelete}
          />
        </div>
      )}
    </div>
  );
}

function TagColumn({
  titulo,
  tags,
  onRename,
  onToggle,
  onDelete,
}: {
  titulo: string;
  tags: LexphTag[];
  onRename: (t: LexphTag) => void;
  onToggle: (t: LexphTag) => void;
  onDelete: (t: LexphTag) => void;
}) {
  return (
    <section className="card-premium p-5">
      <p className="kicker mb-3 text-brand-muted">
        {titulo} · {tags.length}
      </p>
      {tags.length === 0 ? (
        <p className="text-sm text-brand-muted">Todavía no hay etiquetas de este tipo.</p>
      ) : (
        <ul className="space-y-1.5">
          {tags.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2"
            >
              <span className={`flex-1 truncate text-sm ${t.activo ? 'text-brand-ink' : 'text-slate-400 line-through'}`}>
                {t.nombre}
                <span className="ml-2 font-mono text-[10px] text-brand-muted">{t.slug}</span>
              </span>
              <button
                type="button"
                onClick={() => onToggle(t)}
                className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition ${
                  t.activo ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}
                title={t.activo ? 'Activa — click para ocultar' : 'Oculta — click para activar'}
              >
                {t.activo ? 'activa' : 'oculta'}
              </button>
              <button
                type="button"
                onClick={() => onRename(t)}
                className="grid h-7 w-7 place-items-center rounded-md text-brand-muted transition hover:bg-brand-cyan-pale/60 hover:text-brand-cyan"
                aria-label="Renombrar"
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                onClick={() => onDelete(t)}
                className="grid h-7 w-7 place-items-center rounded-md text-brand-muted transition hover:bg-rose-50 hover:text-rose-600"
                aria-label="Eliminar"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
