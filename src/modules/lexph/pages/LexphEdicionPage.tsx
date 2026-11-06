// LexphEdicionPage · CMS del DIGEST de la edición en curso (gerencia). DGG-244 F2b.
// Editor estructurado de las 4 secciones del molde de Pablo: intro (hilo conductor) +
// resumen ejecutivo + tendencias por materia + editorial/insight, con nota de tapa y
// "Cerrar edición". El digest es POR EDICIÓN y se pisa; las notas se acumulan solas.
// R4 (queries en services/), R13 (useConfirm), R19 (universo completo + filtro en memoria).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  FlagOff,
  ExternalLink,
  Newspaper,
  Star,
  GripVertical,
  Send,
} from 'lucide-react';
import { Button, Field, Input, Textarea, Select, Skeleton, useConfirm } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import {
  getEdicionActualStaff,
  guardarEdicion,
  cerrarEdicion,
  enviarNewsletter,
  listArticulos,
  getSuscriptoresStats,
  type LexphEdicion,
  type LexphArticuloConTags,
  type LexphDigestBulletInput,
  type LexphDigestTendenciaInput,
  type LexphEditorialInput,
  type LexphSuscriptoresStats,
} from '@/services/api/lexph';
import { LexphDigest } from '../public/components/LexphDigest';
import type { LexphEdicionActual } from '@/services/api/lexphPublic';
import { tipoMeta } from '../constants';
import '../public/lexph-public.css'; // sólo utilidades .lexph-* (scopeadas) → vista previa fiel

function fmtDia(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

// --- parseo seguro del jsonb de la edición a estado editable ---
function asObj(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' ? (x as Record<string, unknown>) : {};
}
function str(x: unknown): string {
  return typeof x === 'string' ? x : '';
}
function toBullets(j: unknown): LexphDigestBulletInput[] {
  if (!Array.isArray(j)) return [];
  return j.map((x) => ({ titulo: str(asObj(x)['titulo']), texto: str(asObj(x)['texto']) }));
}
function toTendencias(j: unknown): LexphDigestTendenciaInput[] {
  if (!Array.isArray(j)) return [];
  return j.map((x) => ({ materia: str(asObj(x)['materia']), texto: str(asObj(x)['texto']) }));
}
function toEditorial(j: unknown): LexphEditorialInput {
  const o = asObj(j);
  return { kicker: str(o['kicker']), titulo: str(o['titulo']), cuerpo: str(o['cuerpo']) };
}

export function LexphEdicionPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();

  const [edicion, setEdicion] = useState<LexphEdicion | null>(null);
  const [articulos, setArticulos] = useState<LexphArticuloConTags[]>([]);
  const [susc, setSusc] = useState<LexphSuscriptoresStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  // --- estado editable del digest ---
  const [tituloInterno, setTituloInterno] = useState('');
  const [intro, setIntro] = useState('');
  const [resumen, setResumen] = useState<LexphDigestBulletInput[]>([]);
  const [tendencias, setTendencias] = useState<LexphDigestTendenciaInput[]>([]);
  const [editorial, setEditorial] = useState<LexphEditorialInput>({ kicker: '', titulo: '', cuerpo: '' });
  const [destacadoId, setDestacadoId] = useState<string>('');

  const hidratar = useCallback((e: LexphEdicion | null) => {
    setEdicion(e);
    setTituloInterno(e?.titulo_interno ?? '');
    setIntro(e?.intro ?? '');
    setResumen(toBullets(e?.resumen));
    setTendencias(toTendencias(e?.tendencias));
    setEditorial(toEditorial(e?.editorial));
    setDestacadoId(e?.destacado_articulo_id ?? '');
  }, []);

  const cargar = useCallback(async () => {
    setLoading(true);
    const [edRes, artRes, suscRes] = await Promise.all([
      getEdicionActualStaff(),
      listArticulos(),
      getSuscriptoresStats(),
    ]);
    setLoading(false);
    if (!edRes.ok) {
      toast.error('No pudimos cargar la edición', { description: humanizeError(edRes.error) });
      return;
    }
    if (artRes.ok) setArticulos(artRes.data);
    if (suscRes.ok) setSusc(suscRes.data);
    hidratar(edRes.data);
  }, [hidratar]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Notas publicadas (para el selector de tapa) y notas de ESTA edición (read-only).
  const publicados = useMemo(
    () => articulos.filter((a) => a.estado === 'publicado'),
    [articulos],
  );
  const notasEdicion = useMemo(
    () => (edicion ? publicados.filter((a) => a.edicion_id === edicion.id) : []),
    [publicados, edicion],
  );

  // Objeto para la vista previa en vivo (misma pieza que la web pública).
  const previewEdicion: LexphEdicionActual | null = useMemo(() => {
    if (!edicion) return null;
    const destacadoSlug = publicados.find((a) => a.id === destacadoId)?.slug ?? null;
    return {
      id: edicion.id,
      intro: intro.trim() || null,
      resumen: resumen.filter((b) => b.titulo.trim() || b.texto.trim()),
      tendencias: tendencias.filter((t) => t.materia.trim() || t.texto.trim()),
      editorial: {
        kicker: editorial.kicker?.trim() || undefined,
        titulo: editorial.titulo?.trim() || undefined,
        cuerpo: editorial.cuerpo?.trim() || undefined,
      },
      publicado_at: edicion.publicado_at,
      destacado_slug: destacadoSlug,
    };
  }, [edicion, intro, resumen, tendencias, editorial, destacadoId, publicados]);

  async function handleGuardar() {
    if (!edicion) return;
    setSaving(true);
    const res = await guardarEdicion({
      id: edicion.id,
      tituloInterno,
      intro,
      resumen: resumen.filter((b) => b.titulo.trim() || b.texto.trim()),
      tendencias: tendencias.filter((t) => t.materia.trim() || t.texto.trim()),
      editorial: {
        kicker: editorial.kicker?.trim() || undefined,
        titulo: editorial.titulo?.trim() || undefined,
        cuerpo: editorial.cuerpo?.trim() || undefined,
      },
      destacadoArticuloId: destacadoId || null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos guardar', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Edición guardada', { description: 'El digest ya se ve en la web pública.' });
    void cargar();
  }

  async function handleCerrar() {
    if (!edicion) return;
    const ok = await confirm({
      title: 'Cerrar esta edición',
      message:
        'Se congela la edición actual (sus notas quedan registradas como de esta entrega) y se abre ' +
        'la próxima con el digest en blanco. El digest de la edición cerrada seguirá visible en la web ' +
        'hasta que completes el de la nueva. ¿Continuar?',
      confirmLabel: 'Cerrar y abrir la próxima',
    });
    if (!ok) return;
    setCerrando(true);
    const res = await cerrarEdicion(edicion.id);
    setCerrando(false);
    if (!res.ok) {
      toast.error('No pudimos cerrar la edición', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Edición cerrada', {
      description: `Abrimos la ${res.data.titulo_interno}. Cargá su digest cuando quieras.`,
    });
    void cargar();
  }

  async function handleEnviar() {
    if (!edicion) return;
    if (!intro.trim()) {
      toast.error('Completá al menos la intro antes de enviar el newsletter.');
      return;
    }
    const confirmados = susc?.confirmados ?? 0;
    if (confirmados === 0) {
      toast.error('Todavía no hay suscriptores confirmados.');
      return;
    }
    const ya = edicion.newsletter_enviado_at;
    const n = `${confirmados} suscriptor${confirmados === 1 ? '' : 'es'} confirmado${confirmados === 1 ? '' : 's'}`;
    const ok = await confirm({
      title: ya ? 'Reenviar el newsletter' : 'Enviar el newsletter',
      message: ya
        ? `Ya enviaste esta edición el ${fmtDia(ya)}. Se reenviará el teaser (con link a la web) a ${n}. ¿Continuar?`
        : `Se enviará el newsletter —un teaser de marca con link a la edición completa en la web— a ${n}. ¿Continuar?`,
      confirmLabel: ya ? 'Reenviar' : 'Enviar',
    });
    if (!ok) return;
    setEnviando(true);
    const res = await enviarNewsletter(edicion.id);
    setEnviando(false);
    if (!res.ok) {
      toast.error('No pudimos enviar', { description: humanizeError(res.error) });
      return;
    }
    toast.success(`Newsletter encolado a ${res.data.enviados} suscriptor${res.data.enviados === 1 ? '' : 'es'}`, {
      description: 'Se envían de a poco por el throttle de correo. Podés cerrar la edición cuando quieras.',
    });
    void cargar();
  }

  if (loading) {
    return (
      <div className="space-y-4 pb-12">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (!edicion) {
    return (
      <div className="space-y-6 pb-12">
        <BackLink navigate={navigate} />
        <div className="card-premium p-8 text-center">
          <p className="text-brand-muted">Todavía no hay ninguna edición. Se crea con la primera carga de contenidos.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative space-y-6 pb-16">
      <TrianglesAccent position="top-right" size={200} tone="cyan" density="soft" className="opacity-40" />
      <BackLink navigate={navigate} />

      {/* Header */}
      <header className="card-premium relative overflow-hidden">
        <div className="relative flex flex-wrap items-start justify-between gap-4 p-6">
          <div>
            <p className="kicker text-brand-cyan">LEXPH · EDICIÓN EN CURSO</p>
            <h1 className="font-display text-3xl font-bold text-brand-ink">{edicion.titulo_interno}</h1>
            <p className="mt-1 max-w-2xl text-sm text-brand-muted">
              Editá el digest editorial de esta edición (intro, resumen, tendencias e insight). Se publica en
              la web al guardar y se pisa en cada entrega. Las notas se agrupan solas: hoy hay{' '}
              <strong className="text-brand-ink">{notasEdicion.length}</strong> en esta edición.
            </p>
            {susc && (
              <p className="mt-1.5 text-sm text-brand-muted">
                Newsletter:{' '}
                <strong className="text-brand-ink">{susc.confirmados}</strong> suscriptor
                {susc.confirmados === 1 ? '' : 'es'} confirmado{susc.confirmados === 1 ? '' : 's'}
                {susc.pendientes > 0 && <> · {susc.pendientes} sin confirmar</>}
                {' · '}
                {edicion.newsletter_enviado_at ? (
                  <span className="text-emerald-700">enviado el {fmtDia(edicion.newsletter_enviado_at)}</span>
                ) : (
                  <span>sin enviar</span>
                )}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/lexph"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-brand-ink transition hover:border-brand-cyan/50"
            >
              Ver en la web <ExternalLink size={14} />
            </a>
            <Button variant="ghost" onClick={() => void handleEnviar()} disabled={enviando || saving || cerrando}>
              <Send size={15} /> {enviando ? 'Enviando…' : edicion.newsletter_enviado_at ? 'Reenviar newsletter' : 'Enviar newsletter'}
            </Button>
            <Button variant="ghost" onClick={() => void handleCerrar()} disabled={cerrando || saving || enviando}>
              <FlagOff size={15} /> {cerrando ? 'Cerrando…' : 'Cerrar edición'}
            </Button>
            <Button onClick={() => void handleGuardar()} disabled={saving || cerrando || enviando}>
              <Save size={15} /> {saving ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(360px,460px)]">
        {/* ----------------- Editor ----------------- */}
        <div className="space-y-6">
          {/* Datos + tapa */}
          <section className="card-premium space-y-4 p-6">
            <SectionTitle>Edición</SectionTitle>
            <Field label="Nombre interno (no se muestra en la web)">
              <Input value={tituloInterno} onChange={(e) => setTituloInterno(e.target.value)} placeholder="Edición N°2" />
            </Field>
            <Field label="Nota de tapa" hint="La nota destacada del home. Si no elegís, se usa la más reciente.">
              <Select value={destacadoId} onChange={(e) => setDestacadoId(e.target.value)}>
                <option value="">— Automática (la más reciente) —</option>
                {publicados.map((a) => (
                  <option key={a.id} value={a.id}>
                    {tipoMeta(a.tipo).label} · {a.titulo}
                  </option>
                ))}
              </Select>
            </Field>
          </section>

          {/* Intro */}
          <section className="card-premium space-y-4 p-6">
            <SectionTitle>Intro · hilo conductor</SectionTitle>
            <Field label="Texto" hint="El párrafo de apertura: qué une a las notas de esta edición.">
              <Textarea
                value={intro}
                onChange={(e) => setIntro(e.target.value)}
                rows={4}
                placeholder="El hilo conductor de estas semanas…"
              />
            </Field>
          </section>

          {/* Resumen ejecutivo */}
          <section className="card-premium space-y-4 p-6">
            <div className="flex items-center justify-between">
              <SectionTitle>Resumen ejecutivo · scan rápido</SectionTitle>
              <AddBtn onClick={() => setResumen((r) => [...r, { titulo: '', texto: '' }])} />
            </div>
            {resumen.length === 0 && <EmptyHint>Sin ítems. Agregá los puntos clave de la edición.</EmptyHint>}
            <div className="space-y-3">
              {resumen.map((b, i) => (
                <ItemCard key={i} onRemove={() => setResumen((r) => r.filter((_, j) => j !== i))}>
                  <Input
                    value={b.titulo}
                    onChange={(e) =>
                      setResumen((r) => r.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)))
                    }
                    placeholder="Título del punto"
                  />
                  <Textarea
                    value={b.texto}
                    onChange={(e) =>
                      setResumen((r) => r.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))
                    }
                    rows={2}
                    placeholder="Detalle…"
                  />
                </ItemCard>
              ))}
            </div>
          </section>

          {/* Tendencias por materia */}
          <section className="card-premium space-y-4 p-6">
            <div className="flex items-center justify-between">
              <SectionTitle>Tendencias por materia</SectionTitle>
              <AddBtn onClick={() => setTendencias((t) => [...t, { materia: '', texto: '' }])} />
            </div>
            {tendencias.length === 0 && <EmptyHint>Sin ítems. Agregá el análisis por materia.</EmptyHint>}
            <div className="space-y-3">
              {tendencias.map((t, i) => (
                <ItemCard key={i} onRemove={() => setTendencias((p) => p.filter((_, j) => j !== i))}>
                  <Input
                    value={t.materia}
                    onChange={(e) =>
                      setTendencias((p) => p.map((x, j) => (j === i ? { ...x, materia: e.target.value } : x)))
                    }
                    placeholder="Materia (ej. Daños y responsabilidad)"
                  />
                  <Textarea
                    value={t.texto}
                    onChange={(e) =>
                      setTendencias((p) => p.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))
                    }
                    rows={3}
                    placeholder="Análisis…"
                  />
                </ItemCard>
              ))}
            </div>
          </section>

          {/* Editorial / Insight */}
          <section className="card-premium space-y-4 p-6">
            <SectionTitle>Editorial · insight de cierre</SectionTitle>
            <Field label="Bajada (kicker)">
              <Input
                value={editorial.kicker ?? ''}
                onChange={(e) => setEditorial((o) => ({ ...o, kicker: e.target.value }))}
                placeholder="Insight LexPH · Edición N°2"
              />
            </Field>
            <Field label="Título">
              <Input
                value={editorial.titulo ?? ''}
                onChange={(e) => setEditorial((o) => ({ ...o, titulo: e.target.value }))}
                placeholder="El riesgo está en los detalles…"
              />
            </Field>
            <Field label="Cuerpo" hint="Separá párrafos con una línea en blanco.">
              <Textarea
                value={editorial.cuerpo ?? ''}
                onChange={(e) => setEditorial((o) => ({ ...o, cuerpo: e.target.value }))}
                rows={6}
                placeholder="Desarrollo del insight…"
              />
            </Field>
          </section>

          {/* Notas de esta edición (read-only) */}
          <section className="card-premium space-y-3 p-6">
            <SectionTitle>Notas de esta edición · {notasEdicion.length}</SectionTitle>
            <p className="text-xs text-brand-muted">
              Se agrupan solas al publicarse. Marcadas como “Nuevo” en la web cuando conviven con notas de
              ediciones anteriores.
            </p>
            {notasEdicion.length === 0 ? (
              <EmptyHint>Todavía no hay notas publicadas en esta edición.</EmptyHint>
            ) : (
              <ul className="divide-y divide-slate-100">
                {notasEdicion.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 py-2.5">
                    <span className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg ${tipoMeta(a.tipo).chip}`}>
                      <Newspaper size={14} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-brand-ink">{a.titulo}</span>
                    {a.id === destacadoId && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                        <Star size={10} /> Tapa
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ----------------- Vista previa en vivo ----------------- */}
        <aside className="lg:sticky lg:top-6 lg:h-fit">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
              <span className="font-gg-display text-xs font-bold uppercase tracking-[0.1em] text-brand-muted">
                Vista previa
              </span>
              <span className="text-[11px] text-brand-muted">como se ve en la web</span>
            </div>
            <div className="max-h-[70vh] overflow-y-auto" data-gg-classic>
              {previewEdicion ? (
                <LexphDigest edicion={previewEdicion} />
              ) : (
                <p className="p-8 text-center text-sm text-brand-muted">Nada que previsualizar.</p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------- subcomponentes ----------
function BackLink({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  return (
    <button
      type="button"
      onClick={() => navigate('/gerencia/contenidos')}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-muted transition hover:text-brand-cyan"
    >
      <ArrowLeft size={15} /> Contenidos
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-lg font-bold text-brand-ink">{children}</h2>;
}

function AddBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-cyan transition hover:border-brand-cyan/50"
    >
      <Plus size={13} /> Agregar
    </button>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-brand-muted">{children}</p>;
}

function ItemCard({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="relative rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
      <div className="flex items-start gap-2">
        <GripVertical size={15} className="mt-2.5 flex-shrink-0 text-slate-300" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">{children}</div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Quitar"
          className="mt-1 grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg text-brand-muted transition hover:bg-rose-50 hover:text-rose-600"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
