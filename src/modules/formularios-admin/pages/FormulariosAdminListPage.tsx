// Listado tipo galería de formularios (gerencia). Permite crear desde cero,
// duplicar como plantilla y filtrar por categoría / estado.
//
// Backlog #17–#18: alta + plantillas como vehículo para el constructor visual.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus,
  Copy,
  Trash2,
  Eye,
  PencilLine,
  ExternalLink,
  FileText,
  CheckCircle2,
  CircleSlash,
} from 'lucide-react';
import { Button, Field, Input, Modal, Select, Textarea, useConfirm } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import {
  crearFormulario,
  duplicarFormulario,
  eliminarFormulario,
  listFormulariosAdmin,
  slugify,
  toggleActivo,
} from '@/services/api/formularios-admin';
import type { FormularioRow } from '@/services/api/formularios';
import { cn } from '@/lib/cn';

const CATEGORIAS = [
  { value: 'captacion', label: 'Captación' },
  { value: 'tramite', label: 'Trámite' },
  { value: 'servicio', label: 'Servicio' },
  { value: 'curso', label: 'Curso' },
  { value: 'evento', label: 'Evento' },
  { value: 'consulta', label: 'Consulta' },
];

function categoriaLabel(c: string) {
  return CATEGORIAS.find((x) => x.value === c)?.label ?? c;
}

export function FormulariosAdminListPage() {
  const confirm = useConfirm();
  const [items, setItems] = useState<FormularioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroCat, setFiltroCat] = useState<string>('');
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'activos' | 'inactivos'>('todos');
  const [modalNuevo, setModalNuevo] = useState<{ duplicarDe?: FormularioRow } | null>(null);

  async function recargar() {
    setLoading(true);
    const res = await listFormulariosAdmin();
    setLoading(false);
    if (!res.ok) {
      toast.error('No pudimos cargar los formularios', { description: res.error.message });
      return;
    }
    setItems(res.data);
  }

  useEffect(() => {
    void recargar();
  }, []);

  const visibles = useMemo(() => {
    return items.filter((f) => {
      if (filtroCat && f.categoria !== filtroCat) return false;
      if (filtroEstado === 'activos' && !f.activo) return false;
      if (filtroEstado === 'inactivos' && f.activo) return false;
      return true;
    });
  }, [items, filtroCat, filtroEstado]);

  async function onToggle(f: FormularioRow) {
    const res = await toggleActivo(f.id, !f.activo);
    if (!res.ok) {
      toast.error('No pudimos actualizar el estado', { description: res.error.message });
      return;
    }
    toast.success(f.activo ? 'Formulario desactivado' : 'Formulario activado');
    void recargar();
  }

  async function onEliminar(f: FormularioRow) {
    const ok = await confirm({
      title: 'Eliminar formulario',
      message: `¿Eliminar definitivamente "${f.titulo}"? Las respuestas recibidas se conservan.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const res = await eliminarFormulario(f.id);
    if (!res.ok) {
      toast.error('No pudimos eliminar', { description: res.error.message });
      return;
    }
    toast.success('Formulario eliminado');
    void recargar();
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">Constructor visual</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            Formularios
          </h1>
          <p className="mt-1 max-w-xl text-sm text-brand-muted">
            Creá, editá y publicá los formularios públicos sin tocar código.
            Cada cambio queda versionado.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setModalNuevo({ duplicarDe: undefined })}>
            <Copy size={14} /> Desde plantilla
          </Button>
          <Button onClick={() => setModalNuevo({})}>
            <Plus size={14} /> Nuevo formulario
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <Select
          className="w-44"
          value={filtroCat}
          onChange={(e) => setFiltroCat(e.target.value)}
        >
          <option value="">Todas las categorías</option>
          {CATEGORIAS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-xs">
          {(['todos', 'activos', 'inactivos'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFiltroEstado(k)}
              className={cn(
                'rounded-md px-2.5 py-1 capitalize transition',
                filtroEstado === k
                  ? 'bg-white text-brand-ink shadow-sm'
                  : 'text-brand-muted hover:text-brand-ink',
              )}
            >
              {k}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-brand-muted">
          {visibles.length} formulario{visibles.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : visibles.length === 0 ? (
        <IllustratedEmpty
          title="Sin formularios todavía"
          description="Creá tu primer formulario desde cero o duplicá una plantilla."
          action={
            <Button onClick={() => setModalNuevo({})}>
              <Plus size={14} /> Nuevo formulario
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibles.map((f, i) => (
            <article
              key={f.id}
              className="card-premium group relative flex flex-col overflow-hidden p-5 motion-safe:animate-fade-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <TrianglesAccent
                position="top-right"
                size={110}
                tone={f.activo ? 'cyan' : 'teal'}
                density="soft"
                className="opacity-25"
              />
              <div className="relative flex flex-1 flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-brand-cyan-pale/40 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-cyan">
                    {categoriaLabel(f.categoria)}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
                      f.activo
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-brand-muted',
                    )}
                  >
                    {f.activo ? <CheckCircle2 size={11} /> : <CircleSlash size={11} />}
                    {f.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <h2 className="font-display text-lg font-bold text-brand-ink">
                  {f.titulo}
                </h2>
                <p className="text-xs text-brand-muted">/formulario/{f.slug}</p>
                {f.descripcion && (
                  <p className="line-clamp-2 text-sm text-brand-muted">
                    {f.descripcion}
                  </p>
                )}
                <div className="mt-auto flex items-center gap-3 pt-2 text-xs text-brand-muted">
                  <span className="inline-flex items-center gap-1">
                    <FileText size={12} /> {f.total_envios} envío{f.total_envios === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
              <div className="relative mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                <Link
                  to={`/gerencia/formularios/${f.id}`}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-brand-ink hover:bg-slate-50"
                >
                  <PencilLine size={12} /> Editar
                </Link>
                <a
                  href={`/formulario/${f.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-brand-ink hover:bg-slate-50"
                >
                  <ExternalLink size={12} /> Ver
                </a>
                <button
                  onClick={() => setModalNuevo({ duplicarDe: f })}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-brand-ink hover:bg-slate-50"
                  type="button"
                >
                  <Copy size={12} /> Duplicar
                </button>
                <button
                  onClick={() => onToggle(f)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium',
                    f.activo
                      ? 'border-slate-300 bg-white text-brand-ink hover:bg-slate-50'
                      : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
                  )}
                  type="button"
                >
                  <Eye size={12} /> {f.activo ? 'Desactivar' : 'Activar'}
                </button>
                <button
                  onClick={() => onEliminar(f)}
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                  type="button"
                  aria-label="Eliminar"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {modalNuevo && (
        <NuevoFormularioModal
          duplicarDe={modalNuevo.duplicarDe}
          onClose={() => setModalNuevo(null)}
          onCreado={() => {
            setModalNuevo(null);
            void recargar();
          }}
        />
      )}
    </div>
  );
}

function NuevoFormularioModal({
  duplicarDe,
  onClose,
  onCreado,
}: {
  duplicarDe?: FormularioRow;
  onClose: () => void;
  onCreado: () => void;
}) {
  const [titulo, setTitulo] = useState(
    duplicarDe ? `Copia de ${duplicarDe.titulo}` : '',
  );
  const [slug, setSlug] = useState(
    duplicarDe ? `${duplicarDe.slug}-copia` : '',
  );
  const [slugTocado, setSlugTocado] = useState(false);
  const [categoria, setCategoria] = useState(duplicarDe?.categoria ?? 'captacion');
  const [descripcion, setDescripcion] = useState(duplicarDe?.descripcion ?? '');
  const [sending, setSending] = useState(false);

  function onTituloChange(v: string) {
    setTitulo(v);
    if (!slugTocado) setSlug(slugify(v));
  }

  async function onSubmit() {
    if (!titulo.trim() || !slug.trim()) {
      toast.error('Faltan título o slug');
      return;
    }
    setSending(true);
    const res = duplicarDe
      ? await duplicarFormulario(duplicarDe.id, slug.trim(), titulo.trim())
      : await crearFormulario({
          slug: slug.trim(),
          titulo: titulo.trim(),
          categoria,
          descripcion: descripcion.trim() || undefined,
        });
    setSending(false);
    if (!res.ok) {
      toast.error('No pudimos crear el formulario', { description: res.error.message });
      return;
    }
    toast.success(duplicarDe ? 'Formulario duplicado' : 'Formulario creado');
    onCreado();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={duplicarDe ? 'Duplicar formulario' : 'Nuevo formulario'}
      kicker="Constructor"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} loading={sending}>
            {duplicarDe ? 'Duplicar' : 'Crear'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {duplicarDe && (
          <p className="rounded-lg border border-slate-200 bg-brand-zebra/40 p-3 text-xs text-brand-muted">
            Se copiará el schema completo de <strong>{duplicarDe.titulo}</strong>.
            El nuevo formulario nacerá inactivo.
          </p>
        )}
        <Field label="Título" required>
          <Input value={titulo} onChange={(e) => onTituloChange(e.target.value)} autoFocus />
        </Field>
        <Field label="Slug" hint="Define la URL pública: /formulario/{slug}" required>
          <Input
            value={slug}
            onChange={(e) => {
              setSlug(slugify(e.target.value));
              setSlugTocado(true);
            }}
          />
        </Field>
        <Field label="Categoría" required>
          <Select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            {CATEGORIAS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Descripción" hint="Opcional. Se muestra en el hero público.">
          <Textarea
            rows={3}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
