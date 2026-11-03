// LandingOpinionesManager · DGG-241
// Manager de gerencia de la sección "La voz de los alumnos" de la landing:
// datos generales (título, métricas, on/off) + curaduría de las cards
// (agregar del pool de publicables / manual, reordenar, editar, quitar, activar).

import { useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, Check, Eye, Loader2, Pencil, Plus, Trash2, X,
} from 'lucide-react';
import { Button, Field, Input, Select, Switch, Textarea, useConfirm } from '@/components/common';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { humanizeError } from '@/lib/errors';
import { formatTimestampDate } from '@/lib/dates';
import {
  agregarTestimonio, agregarTestimonioManual, deleteTestimonio,
  getLandingOpinionesAdmin, reordenarTestimonios, setLandingOpinionesConfig, updateTestimonio,
  type LandingOpinionesAdmin, type LandingCardAdmin, type LandingMetricaConfig,
} from '@/services/api/landingOpiniones';

const KIND_OPTS = [
  { value: 'estrellas_global', label: 'Promedio de estrellas (todas las encuestas)' },
  { value: 'escala_global', label: 'Promedio de satisfacción (escala 1-10)' },
  { value: 'opiniones', label: 'Total de opiniones (respuestas)' },
  { value: 'publicables', label: 'Total de publicables' },
  { value: 'manual', label: 'Número manual (lo escribís vos)' },
];

function nuevoId() {
  try { return crypto.randomUUID().slice(0, 8); } catch { return String(Date.now()); }
}

export function LandingOpinionesManager() {
  const confirm = useConfirm();
  const [data, setData] = useState<LandingOpinionesAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // drafts de datos generales
  const [titulo, setTitulo] = useState('');
  const [activa, setActiva] = useState(true);
  const [metricas, setMetricas] = useState<LandingMetricaConfig[]>([]);

  // edición de card
  const [editId, setEditId] = useState<string | null>(null);
  const [eNombre, setENombre] = useState('');
  const [eComentario, setEComentario] = useState('');
  const [eCurso, setECurso] = useState('');
  const [eFoto, setEFoto] = useState('');

  // alta manual
  const [mNombre, setMNombre] = useState('');
  const [mComentario, setMComentario] = useState('');
  const [mCurso, setMCurso] = useState('');
  const [mFoto, setMFoto] = useState('');

  async function load() {
    const r = await getLandingOpinionesAdmin();
    if (r.ok) {
      setData(r.data);
      setTitulo(r.data.titulo);
      setActiva(r.data.activa);
      setMetricas(r.data.metricas ?? []);
    } else toast.error('No pudimos cargar la sección', { description: humanizeError(r.error) });
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function guardarGenerales() {
    setBusy(true);
    const res = await setLandingOpinionesConfig({ titulo: titulo.trim(), activa, metricas });
    setBusy(false);
    if (res.ok) { toast.success('Datos generales guardados'); void load(); }
    else toast.error('No pudimos guardar', { description: humanizeError(res.error) });
  }

  async function accion<T>(fn: () => Promise<{ ok: boolean; error?: unknown; data?: T }>, okMsg?: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.ok) { if (okMsg) toast.success(okMsg); void load(); return true; }
    toast.error('No se pudo', { description: humanizeError((res as { error: unknown }).error) });
    return false;
  }

  async function reordenar(idx: number, dir: -1 | 1) {
    if (!data || busy) return;
    const ids = data.cards.map((c) => c.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j]!, ids[idx]!];
    await accion(() => reordenarTestimonios(ids));
  }

  function abrirEdit(c: LandingCardAdmin) {
    setEditId(c.id); setENombre(c.nombre); setEComentario(c.comentario); setECurso(c.curso ?? ''); setEFoto(c.foto_url ?? '');
  }
  async function guardarEdit() {
    if (!editId) return;
    const ok = await accion(() => updateTestimonio(editId, { nombre: eNombre.trim(), comentario: eComentario.trim(), curso_titulo: eCurso.trim() || null, foto_url: eFoto.trim() || null }), 'Card actualizada');
    if (ok) setEditId(null);
  }

  async function quitar(c: LandingCardAdmin) {
    const okc = await confirm({ title: 'Quitar de la landing', message: `¿Quitar la opinión de ${c.nombre}? No borra la respuesta de la encuesta, sólo la saca de la web.`, confirmLabel: 'Quitar', danger: true });
    if (!okc) return;
    await accion(() => deleteTestimonio(c.id), 'Quitada de la landing');
  }

  async function altaManual() {
    if (!mNombre.trim() || !mComentario.trim()) { toast.error('Nombre y comentario son obligatorios'); return; }
    const ok = await accion(() => agregarTestimonioManual({ nombre: mNombre.trim(), comentario: mComentario.trim(), curso: mCurso.trim() || null, foto_url: mFoto.trim() || null }), 'Opinión agregada');
    if (ok) { setMNombre(''); setMComentario(''); setMCurso(''); setMFoto(''); }
  }

  if (loading) return <div className="grid place-items-center py-16"><Loader2 className="animate-spin text-brand-muted" /></div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">Landing · opiniones</p>
          <h2 className="font-display text-xl font-bold text-brand-ink sm:text-2xl">Sección "La voz de los alumnos"</h2>
          <p className="mt-1 max-w-2xl text-sm text-brand-muted">
            Lo que se ve en la home, debajo de Cursos. Las métricas son reales (en vivo desde las encuestas); las opiniones las curás vos de las respuestas publicables.
          </p>
        </div>
        <a href="https://www.gestionglobal.ar/#opiniones" target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-brand-ink hover:bg-slate-50">
          <Eye size={14} /> Ver en la web
        </a>
      </header>

      {/* Datos generales */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-brand-ink">Datos generales</p>
          <Switch checked={activa} onChange={setActiva} label="Sección visible en la web" size="sm" />
        </div>
        <div className="mt-3">
          <Field label="Título de la sección">
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3">
          <p className="kicker mb-1.5">Métricas destacadas</p>
          <div className="space-y-2">
            {metricas.map((m, i) => (
              <div key={m.id ?? i} className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                <Field label="Etiqueta" className="min-w-[140px] flex-1">
                  <Input value={m.label} onChange={(e) => setMetricas((xs) => xs.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                </Field>
                <Field label="Dato" className="w-56">
                  <Select value={m.kind} onChange={(e) => setMetricas((xs) => xs.map((x, j) => j === i ? { ...x, kind: e.target.value } : x))}>
                    {KIND_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </Field>
                {m.kind === 'manual' && (
                  <Field label="Valor" className="w-24">
                    <Input value={m.valor ?? ''} onChange={(e) => setMetricas((xs) => xs.map((x, j) => j === i ? { ...x, valor: e.target.value } : x))} />
                  </Field>
                )}
                <Field label="Sufijo" className="w-20">
                  <Input value={m.sufijo ?? ''} placeholder="/5" onChange={(e) => setMetricas((xs) => xs.map((x, j) => j === i ? { ...x, sufijo: e.target.value } : x))} />
                </Field>
                <Field label="Aclaración" className="min-w-[150px] flex-1">
                  <Input value={m.hint ?? ''} placeholder="del último cuatrimestre" onChange={(e) => setMetricas((xs) => xs.map((x, j) => j === i ? { ...x, hint: e.target.value } : x))} />
                </Field>
                <Button variant="ghost" onClick={() => setMetricas((xs) => xs.filter((_, j) => j !== i))}><Trash2 size={14} /></Button>
              </div>
            ))}
            {metricas.length < 5 && (
              <Button variant="secondary" onClick={() => setMetricas((xs) => [...xs, { id: nuevoId(), label: 'Nueva métrica', kind: 'opiniones', sufijo: '' }])}>
                <Plus size={14} /> Agregar métrica
              </Button>
            )}
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={() => void guardarGenerales()} loading={busy}>Guardar datos generales</Button>
        </div>
      </section>

      {/* Cards actuales */}
      <section className="space-y-3">
        <h3 className="font-display text-lg font-bold text-brand-ink">
          Opiniones en la landing ({data.cards.filter((c) => c.activo).length} activas de {data.cards.length})
        </h3>
        {activa && data.cards.length > 0 && data.cards.filter((c) => c.activo).length === 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> La sección está marcada como visible, pero no hay ninguna opinión activa → en la web se oculta. Activá al menos una.
          </div>
        )}
        {data.cards.length === 0 ? (
          <IllustratedEmpty title="Todavía no hay opiniones" description="Agregá algunas desde el listado de abajo para que aparezcan en la web." />
        ) : (
          <ul className="space-y-2">
            {data.cards.map((c, i) => (
              <li key={c.id} className={cn('rounded-xl border bg-white p-3', c.activo ? 'border-slate-200' : 'border-slate-200 bg-slate-50 opacity-70')}>
                {editId === c.id ? (
                  <div className="space-y-2">
                    <Field label="Nombre"><Input value={eNombre} onChange={(e) => setENombre(e.target.value)} /></Field>
                    <Field label="Comentario"><Textarea value={eComentario} onChange={(e) => setEComentario(e.target.value)} rows={3} /></Field>
                    <Field label="Curso / rol"><Input value={eCurso} onChange={(e) => setECurso(e.target.value)} /></Field>
                    <Field label="Foto (URL, opcional)"><Input value={eFoto} onChange={(e) => setEFoto(e.target.value)} placeholder="https://…" /></Field>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => setEditId(null)}><X size={14} /> Cancelar</Button>
                      <Button variant="primary" onClick={() => void guardarEdit()} loading={busy}><Check size={14} /> Guardar</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center gap-0.5 pt-1">
                      <button type="button" aria-label="Subir" onClick={() => void reordenar(i, -1)} disabled={i === 0 || busy} className="text-brand-muted hover:text-brand-cyan disabled:opacity-30"><ArrowUp size={16} /></button>
                      <span className="text-[11px] tabular-nums text-brand-muted">{i + 1}</span>
                      <button type="button" aria-label="Bajar" onClick={() => void reordenar(i, 1)} disabled={i === data.cards.length - 1 || busy} className="text-brand-muted hover:text-brand-cyan disabled:opacity-30"><ArrowDown size={16} /></button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-brand-ink">{c.nombre}</p>
                        {c.estrellas != null && <span className="text-xs font-semibold text-amber-600">★ {c.estrellas}</span>}
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', c.origen === 'manual' ? 'bg-slate-100 text-slate-600' : 'bg-brand-cyan/10 text-brand-cyan')}>{c.origen === 'manual' ? 'Manual' : 'Encuesta'}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-sm text-brand-ink/80">"{c.comentario}"</p>
                      {c.curso && <p className="mt-0.5 text-xs text-brand-muted">{c.curso}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Switch checked={c.activo} onChange={(n) => void accion(() => updateTestimonio(c.id, { activo: n }))} size="sm" />
                      <Button variant="ghost" onClick={() => abrirEdit(c)} disabled={busy}><Pencil size={14} /></Button>
                      <Button variant="ghost" onClick={() => void quitar(c)} disabled={busy}><Trash2 size={14} /></Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Pool de publicables + alta manual */}
      <section className="space-y-3">
        <h3 className="font-display text-lg font-bold text-brand-ink">Opiniones publicables sin usar ({data.pool.length})</h3>
        {data.pool.length === 0 ? (
          <p className="text-sm text-brand-muted">No hay opiniones publicables nuevas con comentario para agregar.</p>
        ) : (
          <ul className="space-y-2">
            {data.pool.map((p) => (
              <li key={p.respuesta_id} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-brand-ink">{p.nombre}</p>
                    <span className="text-xs text-brand-muted">{formatTimestampDate(p.fecha)}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-brand-ink/80">"{p.comentario}"</p>
                  {p.curso && <p className="mt-0.5 text-xs text-brand-muted">{p.curso}</p>}
                </div>
                <Button variant="secondary" onClick={() => void accion(() => agregarTestimonio(p.respuesta_id), 'Agregada a la landing')} className="shrink-0">
                  <Plus size={14} /> Agregar
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-4">
          <p className="text-sm font-semibold text-brand-ink">Agregar una opinión manual</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Field label="Nombre"><Input value={mNombre} onChange={(e) => setMNombre(e.target.value)} /></Field>
            <Field label="Curso / rol (opcional)"><Input value={mCurso} onChange={(e) => setMCurso(e.target.value)} /></Field>
          </div>
          <Field label="Comentario" className="mt-2"><Textarea value={mComentario} onChange={(e) => setMComentario(e.target.value)} rows={2} /></Field>
          <Field label="Foto (URL, opcional)" className="mt-2"><Input value={mFoto} onChange={(e) => setMFoto(e.target.value)} placeholder="https://…" /></Field>
          <div className="mt-2 flex justify-end">
            <Button variant="secondary" onClick={() => void altaManual()} loading={busy}><Plus size={14} /> Agregar manual</Button>
          </div>
        </div>
      </section>
    </div>
  );
}
