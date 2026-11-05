// LexphArticuloEditorPage · editor de artículo a página completa (gerencia).
// DGG-244 · R4 (services/), R5 (guardado via RPC), R13 (DialogProvider).
// El cuerpo es HTML del editor TipTap común; los campos estructurados por tipo
// van a `campos` jsonb; las fuentes citables a `fuentes` jsonb.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Loader2, Plus, Trash2, Link2, FileText } from 'lucide-react';
import {
  Button,
  Field,
  Input,
  Textarea,
  Select,
  Skeleton,
  RichTextEditor,
  useAlert,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import {
  getArticulo,
  guardarArticulo,
  listTags,
  slugify,
  type LexphTipo,
  type LexphEstado,
  type LexphFuente,
  type LexphTag,
} from '@/services/api/lexph';
import { TIPOS, CAMPOS_POR_TIPO, tipoMeta } from '../constants';

type CamposMap = Record<string, string | string[]>;

export function LexphArticuloEditorPage() {
  const navigate = useNavigate();
  const alert = useAlert();
  const { id } = useParams<{ id?: string }>();
  const esNuevo = !id;

  const [loading, setLoading] = useState(!esNuevo);
  const [saving, setSaving] = useState(false);

  const [tipo, setTipo] = useState<LexphTipo>('fallo');
  const [estado, setEstado] = useState<LexphEstado>('borrador');
  const [titulo, setTitulo] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [resumen, setResumen] = useState('');
  const [cuerpo, setCuerpo] = useState('<p></p>');
  const [campos, setCampos] = useState<CamposMap>({});
  const [fuentes, setFuentes] = useState<LexphFuente[]>([]);
  const [tagIds, setTagIds] = useState<Set<string>>(new Set());

  const [tags, setTags] = useState<LexphTag[]>([]);

  // Cargar etiquetas disponibles + (si edita) el artículo.
  useEffect(() => {
    void (async () => {
      const tg = await listTags();
      if (tg.ok) setTags(tg.data);
      if (esNuevo) return;
      const res = await getArticulo(id!);
      setLoading(false);
      if (!res.ok) {
        toast.error('No pudimos cargar el artículo', { description: humanizeError(res.error) });
        navigate('/gerencia/contenidos');
        return;
      }
      const a = res.data;
      setTipo(a.tipo as LexphTipo);
      setEstado(a.estado as LexphEstado);
      setTitulo(a.titulo);
      setSlug(a.slug);
      setSlugTouched(true);
      setResumen(a.resumen ?? '');
      setCuerpo(a.cuerpo || '<p></p>');
      setCampos((a.campos as CamposMap) ?? {});
      setFuentes(Array.isArray(a.fuentes) ? (a.fuentes as unknown as LexphFuente[]) : []);
      setTagIds(new Set(a.tags.map((t) => t.id)));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Slug automático desde el título mientras no se haya tocado a mano.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(titulo));
  }, [titulo, slugTouched]);

  const camposDef = CAMPOS_POR_TIPO[tipo];
  const meta = tipoMeta(tipo);

  const tagsPorTipo = useMemo(() => {
    const materia = tags.filter((t) => t.tipo === 'materia' && t.activo);
    const jurisdiccion = tags.filter((t) => t.tipo === 'jurisdiccion' && t.activo);
    return { materia, jurisdiccion };
  }, [tags]);

  function setCampo(key: string, value: string | string[]) {
    setCampos((prev) => ({ ...prev, [key]: value }));
  }

  function toggleTag(tid: string) {
    setTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tid)) next.delete(tid);
      else next.add(tid);
      return next;
    });
  }

  async function handleGuardar(estadoFinal: LexphEstado) {
    if (!titulo.trim()) {
      await alert({ title: 'Falta el título', message: 'El artículo necesita un título.' });
      return;
    }
    if (!slug.trim()) {
      await alert({ title: 'Falta el identificador', message: 'El slug no puede quedar vacío.' });
      return;
    }
    const cuerpoVacio = !cuerpo.replace(/<[^>]*>/g, '').trim();
    if (estadoFinal === 'publicado' && cuerpoVacio && !resumen.trim()) {
      await alert({
        title: 'Contenido vacío',
        message: 'Para publicar, cargá al menos el resumen o el cuerpo del artículo.',
      });
      return;
    }

    // Normalizar campos: quitar vacíos; listas quedan como array de líneas no vacías.
    const camposLimpios: Record<string, unknown> = {};
    for (const def of camposDef) {
      const v = campos[def.key];
      if (def.kind === 'lista') {
        const arr = Array.isArray(v)
          ? v
          : String(v ?? '').split('\n');
        const clean = arr.map((s) => s.trim()).filter(Boolean);
        if (clean.length) camposLimpios[def.key] = clean;
      } else {
        const s = String(v ?? '').trim();
        if (s) camposLimpios[def.key] = s;
      }
    }

    const fuentesLimpias = fuentes
      .map((f) => ({ cita: f.cita.trim(), url: (f.url ?? '').trim() || null }))
      .filter((f) => f.cita || f.url);

    setSaving(true);
    const res = await guardarArticulo({
      id: esNuevo ? null : id,
      tipo,
      estado: estadoFinal,
      titulo: titulo.trim(),
      slug: slugify(slug),
      resumen: resumen.trim() || null,
      cuerpo: cuerpoVacio ? null : cuerpo,
      campos: camposLimpios,
      fuentes: fuentesLimpias,
      tagIds: Array.from(tagIds),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos guardar', { description: humanizeError(res.error) });
      return;
    }
    toast.success(estadoFinal === 'publicado' ? 'Artículo publicado' : 'Artículo guardado');
    navigate('/gerencia/contenidos');
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  const Icon = meta.icon;

  return (
    <div className="relative space-y-6 pb-32">
      <TrianglesAccent position="top-right" size={180} tone="cyan" density="soft" className="opacity-30" />

      {/* Header */}
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
          <span className={`grid h-10 w-10 place-items-center rounded-xl ${meta.chip}`}>
            <Icon size={18} />
          </span>
          <div>
            <p className="kicker text-brand-cyan">LEXPH · {esNuevo ? 'NUEVO' : 'EDITANDO'}</p>
            <h1 className="font-display text-2xl font-bold text-brand-ink">
              {titulo.trim() || 'Artículo sin título'}
            </h1>
            <div className="mt-1">
              <EstadoChip estado={estado} />
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Columna principal */}
        <div className="space-y-5">
          <section className="card-premium space-y-4 p-5">
            <Field label="Tipo de pieza" hint="Define qué datos estructurados se piden abajo.">
              <Select value={tipo} onChange={(e) => setTipo(e.target.value as LexphTipo)}>
                {TIPOS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Título">
              <Input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Título del artículo"
              />
            </Field>
            <Field label="Identificador (slug)" hint="Se usará en la URL pública. Se genera solo desde el título.">
              <Input
                value={slug}
                onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
                placeholder="mi-articulo"
                className="font-mono text-sm"
              />
            </Field>
            <Field label="Resumen / bajada" hint="Copete para las cards y el newsletter.">
              <Textarea
                value={resumen}
                onChange={(e) => setResumen(e.target.value)}
                rows={3}
                placeholder="Síntesis breve de la pieza…"
              />
            </Field>
          </section>

          {/* Campos estructurados por tipo */}
          {camposDef.length > 0 && (
            <section className="card-premium space-y-4 p-5">
              <p className="kicker flex items-center gap-1.5 text-brand-muted">
                <FileText size={11} /> DATOS DE {meta.label.toUpperCase()}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {camposDef.map((def) => {
                  const full = def.kind !== 'text';
                  return (
                    <div key={def.key} className={full ? 'sm:col-span-2' : ''}>
                      <Field label={def.label}>
                        {def.kind === 'text' ? (
                          <Input
                            value={String(campos[def.key] ?? '')}
                            onChange={(e) => setCampo(def.key, e.target.value)}
                            placeholder={def.placeholder}
                          />
                        ) : (
                          <Textarea
                            value={
                              Array.isArray(campos[def.key])
                                ? (campos[def.key] as string[]).join('\n')
                                : String(campos[def.key] ?? '')
                            }
                            onChange={(e) =>
                              setCampo(
                                def.key,
                                def.kind === 'lista' ? e.target.value.split('\n') : e.target.value,
                              )
                            }
                            rows={def.kind === 'lista' ? 4 : 3}
                            placeholder={def.placeholder}
                          />
                        )}
                      </Field>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Cuerpo */}
          <section className="card-premium space-y-3 p-5">
            <p className="kicker text-brand-muted">CUERPO DEL ARTÍCULO</p>
            <RichTextEditor
              value={cuerpo}
              onChange={setCuerpo}
              placeholder="Desarrollá el análisis… (negrita, listas, citas, links)"
              minHeight={320}
            />
          </section>

          {/* Fuentes */}
          <section className="card-premium space-y-3 p-5">
            <div className="flex items-center justify-between">
              <p className="kicker flex items-center gap-1.5 text-brand-muted">
                <Link2 size={11} /> FUENTES
              </p>
              <Button variant="ghost" onClick={() => setFuentes((f) => [...f, { cita: '', url: '' }])}>
                <Plus size={14} /> Agregar fuente
              </Button>
            </div>
            {fuentes.length === 0 ? (
              <p className="text-sm text-brand-muted">Sin fuentes citadas.</p>
            ) : (
              <div className="space-y-2">
                {fuentes.map((f, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <Input
                      value={f.cita}
                      onChange={(e) =>
                        setFuentes((prev) => prev.map((x, j) => (j === i ? { ...x, cita: e.target.value } : x)))
                      }
                      placeholder="Cita / referencia"
                    />
                    <Input
                      value={f.url ?? ''}
                      onChange={(e) =>
                        setFuentes((prev) => prev.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                      }
                      placeholder="https://…"
                      className="font-mono text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setFuentes((prev) => prev.filter((_, j) => j !== i))}
                      className="grid h-10 w-10 place-items-center rounded-lg text-brand-muted transition hover:bg-rose-50 hover:text-rose-600"
                      aria-label="Quitar fuente"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Columna lateral: etiquetas */}
        <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start">
          <section className="card-premium space-y-4 p-5">
            <p className="kicker text-brand-muted">ETIQUETAS</p>
            {tags.length === 0 ? (
              <p className="text-sm text-brand-muted">
                No hay etiquetas.{' '}
                <button
                  type="button"
                  className="font-medium text-brand-cyan hover:underline"
                  onClick={() => navigate('/gerencia/contenidos/etiquetas')}
                >
                  Crear etiquetas
                </button>
              </p>
            ) : (
              <>
                <TagGroup titulo="Materia" tags={tagsPorTipo.materia} sel={tagIds} onToggle={toggleTag} />
                <TagGroup titulo="Jurisdicción" tags={tagsPorTipo.jurisdiccion} sel={tagIds} onToggle={toggleTag} />
              </>
            )}
          </section>
        </aside>
      </div>

      {/* Footer sticky de acciones (offset del sidebar w-64 desde md:) */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur md:left-64">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-end gap-2 px-2">
          <Button variant="ghost" onClick={() => navigate('/gerencia/contenidos')} disabled={saving}>
            Cancelar
          </Button>
          {estado === 'publicado' ? (
            <>
              <Button variant="secondary" onClick={() => void handleGuardar('borrador')} disabled={saving}>
                Pasar a borrador
              </Button>
              <Button onClick={() => void handleGuardar('publicado')} disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Guardar cambios
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => void handleGuardar('borrador')} disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Guardar borrador
              </Button>
              <Button onClick={() => void handleGuardar('publicado')} disabled={saving}>
                Publicar
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EstadoChip({ estado }: { estado: LexphEstado }) {
  const publicado = estado === 'publicado';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
        publicado ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${publicado ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {publicado ? 'Publicado' : 'Borrador'}
    </span>
  );
}

function TagGroup({
  titulo,
  tags,
  sel,
  onToggle,
}: {
  titulo: string;
  tags: LexphTag[];
  sel: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-brand-ink">{titulo}</p>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => {
          const on = sel.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onToggle(t.id)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                on
                  ? 'border-brand-cyan bg-brand-cyan text-white'
                  : 'border-slate-200 bg-white text-brand-ink hover:border-brand-cyan/50'
              }`}
            >
              {t.nombre}
            </button>
          );
        })}
      </div>
    </div>
  );
}
