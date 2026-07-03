import { useMemo, useState } from 'react';
import {
  Plus, Trash2, Save, Pencil, X, ListChecks, FolderPlus, GripVertical,
  CheckCircle2, Info,
} from 'lucide-react';
import {
  Button, Field, Input, Select, Textarea, useConfirm,
} from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { humanizeError } from '@/lib/errors';
import {
  crearExamen, actualizarExamen, borrarExamen,
  crearPregunta, actualizarPregunta, borrarPregunta, reemplazarOpciones,
  crearSeccion, actualizarSeccion, borrarSeccion,
  PREGUNTA_TIPO_LABEL, PREGUNTA_TIPOS,
  type CursoExamenRow, type CursoOpcionRow, type CursoPreguntaRow,
  type CursoExamenSeccionRow, type PreguntaTipo,
} from '@/services/api/campus';

type PreguntaFull = CursoPreguntaRow & { opciones: CursoOpcionRow[] };
type ExamenFull = CursoExamenRow & {
  secciones: CursoExamenSeccionRow[];
  preguntas: PreguntaFull[];
};

interface ExamenEditorProps {
  cursoId: string;
  examenes: ExamenFull[];
  onChanged: () => void;
}

const SIN_SECCION = '__sin__';

// DGG-96 · Ventana de habilitación del examen. La BD guarda timestamptz (UTC); el
// <input type="datetime-local"> trabaja en hora local. Vacío = sin límite (NULL).
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function localInputToIso(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}
function ventanaInvalida(desde: string, hasta: string): boolean {
  return !!desde && !!hasta && new Date(hasta) < new Date(desde);
}
function fmtVentana(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Editor de exámenes para staff. Soporta secciones temáticas, puntaje y
// explicación por pregunta, retroalimentación por opción, y edición completa.
export function ExamenEditor({ cursoId, examenes, onChanged }: ExamenEditorProps) {
  const confirm = useConfirm();
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [nota, setNota] = useState(60);
  const [intentos, setIntentos] = useState(1);
  const [mostrar, setMostrar] = useState(true);
  const [mezclar, setMezclar] = useState(false);
  const [habDesde, setHabDesde] = useState('');
  const [habHasta, setHabHasta] = useState('');
  const [creating, setCreating] = useState(false);

  async function crearNuevo() {
    if (!titulo.trim()) {
      toast.error('Poné un título al examen.');
      return;
    }
    if (ventanaInvalida(habDesde, habHasta)) {
      toast.error('La fecha de cierre no puede ser anterior a la de habilitación.');
      return;
    }
    setCreating(true);
    const res = await crearExamen({
      curso_id: cursoId,
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      nota_aprobacion: Math.min(100, Math.max(0, nota || 0)),
      intentos_max: Math.max(1, intentos || 1),
      mostrar_resultados: mostrar,
      mezclar_preguntas: mezclar,
      fecha_habilitacion: localInputToIso(habDesde),
      fecha_cierre: localInputToIso(habHasta),
    });
    setCreating(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    setTitulo('');
    setDescripcion('');
    setHabDesde('');
    setHabHasta('');
    toast.success('Examen creado');
    onChanged();
  }

  async function eliminar(examen: CursoExamenRow) {
    const ok = await confirm({
      title: 'Eliminar examen',
      message: `¿Eliminar "${examen.titulo}" con todas sus secciones y preguntas? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const res = await borrarExamen(examen.id);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Examen eliminado');
    onChanged();
  }

  return (
    <div className="space-y-6">
      {/* Alta de examen */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="kicker text-brand-cyan">Nuevo examen</p>
        <h3 className="mt-1 font-display text-lg font-semibold text-brand-ink">
          Agregá una evaluación al curso
        </h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Título">
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="p. ej. Examen integrador 2026"
            />
          </Field>
          <Field label="Descripción / consignas (opcional)">
            <Textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={2}
              placeholder="Reglas del examen, condiciones de aprobación, etc."
            />
          </Field>
        </div>
        {/* DGG-96 · ventana de habilitación (opcional). Vacío = disponible ya / sin límite. */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Habilitado desde (opcional)" hint="Vacío = disponible de inmediato.">
            <Input type="datetime-local" value={habDesde}
              onChange={(e) => setHabDesde(e.target.value)} />
          </Field>
          <Field label="Habilitado hasta (opcional)" hint="Vacío = sin límite de tiempo.">
            <Input type="datetime-local" value={habHasta}
              onChange={(e) => setHabHasta(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[140px_140px_1fr_auto]">
          <Field label="Nota mínima">
            <Input type="number" min={0} max={100} value={nota}
              onChange={(e) => setNota(Number(e.target.value))} />
          </Field>
          <Field label="Intentos">
            <Input type="number" min={1} max={20} value={intentos}
              onChange={(e) => setIntentos(Number(e.target.value))} />
          </Field>
          <div className="flex flex-wrap items-end gap-4 pb-1">
            <Toggle checked={mostrar} onChange={setMostrar} label="Mostrar resultados al terminar" />
            <Toggle checked={mezclar} onChange={setMezclar} label="Mezclar preguntas" />
          </div>
          <div className="self-end">
            <Button onClick={crearNuevo} loading={creating}>
              <Plus size={14} /> Crear examen
            </Button>
          </div>
        </div>
      </section>

      {examenes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-brand-muted">
          Todavía no hay exámenes en este curso.
        </div>
      ) : (
        examenes.map((examen) => (
          <ExamenItem
            key={examen.id}
            examen={examen}
            onDelete={() => void eliminar(examen)}
            onChanged={onChanged}
          />
        ))
      )}
    </div>
  );
}

// ── Toggle simple ────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, label }: {
  checked: boolean; onChange: (v: boolean) => void; label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-brand-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-brand-cyan"
      />
      {label}
    </label>
  );
}

// ── Un examen ────────────────────────────────────────────────────────────────
function ExamenItem({ examen, onDelete, onChanged }: {
  examen: ExamenFull; onDelete: () => void; onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [editandoExamen, setEditandoExamen] = useState(false);
  const [nuevaPreguntaSeccion, setNuevaPreguntaSeccion] = useState<string | null>(null);
  const [editandoPregunta, setEditandoPregunta] = useState<string | null>(null);
  const [agregandoSeccion, setAgregandoSeccion] = useState(false);
  const [editandoSeccion, setEditandoSeccion] = useState<string | null>(null);

  const totalPuntos = useMemo(
    () => examen.preguntas.reduce((a, p) => a + (p.puntaje ?? 0), 0),
    [examen.preguntas],
  );

  const preguntasPorSeccion = useMemo(() => {
    const map = new Map<string, PreguntaFull[]>();
    for (const p of examen.preguntas) {
      const k = p.seccion_id ?? SIN_SECCION;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return map;
  }, [examen.preguntas]);

  const sinSeccion = preguntasPorSeccion.get(SIN_SECCION) ?? [];

  async function eliminarPregunta(p: CursoPreguntaRow) {
    const ok = await confirm({
      title: 'Eliminar pregunta', message: '¿Querés eliminar esta pregunta?',
      confirmLabel: 'Eliminar', danger: true,
    });
    if (!ok) return;
    const res = await borrarPregunta(p.id);
    if (!res.ok) { toast.error(humanizeError(res.error)); return; }
    onChanged();
  }

  async function eliminarSeccion(s: CursoExamenSeccionRow) {
    const ok = await confirm({
      title: 'Eliminar sección',
      message: `¿Eliminar la sección "${s.titulo}"? Las preguntas quedan sin sección (no se borran).`,
      confirmLabel: 'Eliminar', danger: true,
    });
    if (!ok) return;
    const res = await borrarSeccion(s.id);
    if (!res.ok) { toast.error(humanizeError(res.error)); return; }
    toast.success('Sección eliminada');
    onChanged();
  }

  const renderPregunta = (p: PreguntaFull, i: number) =>
    editandoPregunta === p.id ? (
      <PreguntaForm
        key={p.id}
        examenId={examen.id}
        secciones={examen.secciones}
        inicial={p}
        onSaved={() => { setEditandoPregunta(null); onChanged(); }}
        onCancel={() => setEditandoPregunta(null)}
      />
    ) : (
      <PreguntaRow
        key={p.id}
        indice={i + 1}
        pregunta={p}
        onEdit={() => setEditandoPregunta(p.id)}
        onDelete={() => void eliminarPregunta(p)}
      />
    );

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-4">
        <div className="min-w-0">
          <p className="kicker text-brand-cyan">Examen</p>
          <h3 className="mt-1 font-display text-lg font-semibold text-brand-ink">
            {examen.titulo}
          </h3>
          {examen.descripcion && (
            <p className="mt-1 max-w-2xl whitespace-pre-line text-xs text-brand-muted">
              {examen.descripcion}
            </p>
          )}
          <p className="mt-1 text-xs text-brand-muted">
            {examen.preguntas.length} preguntas · {totalPuntos} puntos · Mín{' '}
            {examen.nota_aprobacion}% · {examen.intentos_max} intento(s)
            {examen.mezclar_preguntas ? ' · mezcla' : ''}
            {examen.mostrar_resultados ? ' · muestra resultados' : ''}
          </p>
          {(examen.fecha_habilitacion || examen.fecha_cierre) && (
            <p className="mt-1 text-xs font-medium text-brand-cyan">
              {examen.fecha_habilitacion
                ? `Abre ${fmtVentana(examen.fecha_habilitacion)}`
                : 'Disponible ya'}
              {' · '}
              {examen.fecha_cierre ? `Cierra ${fmtVentana(examen.fecha_cierre)}` : 'Sin límite'}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={() => setEditandoExamen((v) => !v)}>
            <Pencil size={14} /> Editar
          </Button>
          <Button variant="ghost" onClick={onDelete}>
            <Trash2 size={14} /> Borrar
          </Button>
        </div>
      </header>

      {editandoExamen && (
        <ExamenMetaForm
          examen={examen}
          onSaved={() => { setEditandoExamen(false); onChanged(); }}
          onCancel={() => setEditandoExamen(false)}
        />
      )}

      <div className="space-y-4 p-4">
        {/* Secciones */}
        {examen.secciones.map((s) => {
          const preguntas = preguntasPorSeccion.get(s.id) ?? [];
          return (
            <section key={s.id} className="rounded-xl border border-slate-200">
              {editandoSeccion === s.id ? (
                <SeccionForm
                  examenId={examen.id}
                  inicial={s}
                  onSaved={() => { setEditandoSeccion(null); onChanged(); }}
                  onCancel={() => setEditandoSeccion(null)}
                />
              ) : (
                <header className="flex items-start justify-between gap-2 border-b border-slate-100 bg-brand-cyan/5 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-ink">
                      <GripVertical size={13} className="text-brand-muted" /> {s.titulo}
                    </p>
                    {s.descripcion && (
                      <p className="text-xs text-brand-muted">{s.descripcion}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => setEditandoSeccion(s.id)}
                      className="rounded p-1 text-brand-muted hover:text-brand-cyan" title="Editar sección">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => void eliminarSeccion(s)}
                      className="rounded p-1 text-brand-muted hover:text-red-600" title="Eliminar sección">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </header>
              )}
              <div className="space-y-2 p-3">
                {preguntas.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-brand-muted">Sección sin preguntas todavía.</p>
                ) : (
                  preguntas.map((p, i) => renderPregunta(p, i))
                )}
                {nuevaPreguntaSeccion === s.id ? (
                  <PreguntaForm
                    examenId={examen.id}
                    secciones={examen.secciones}
                    defaultSeccionId={s.id}
                    onSaved={() => { setNuevaPreguntaSeccion(null); onChanged(); }}
                    onCancel={() => setNuevaPreguntaSeccion(null)}
                  />
                ) : (
                  <Button variant="ghost" onClick={() => setNuevaPreguntaSeccion(s.id)}>
                    <Plus size={13} /> Pregunta en esta sección
                  </Button>
                )}
              </div>
            </section>
          );
        })}

        {/* Preguntas sin sección */}
        {sinSeccion.length > 0 && (
          <section className="rounded-xl border border-slate-100 bg-brand-zebra/30">
            <header className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-brand-muted">
              Sin sección
            </header>
            <div className="space-y-2 p-3">
              {sinSeccion.map((p, i) => renderPregunta(p, i))}
            </div>
          </section>
        )}

        {/* Acciones */}
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
          {agregandoSeccion ? (
            <SeccionForm
              examenId={examen.id}
              onSaved={() => { setAgregandoSeccion(false); onChanged(); }}
              onCancel={() => setAgregandoSeccion(false)}
            />
          ) : (
            <Button variant="secondary" onClick={() => setAgregandoSeccion(true)}>
              <FolderPlus size={14} /> Agregar sección
            </Button>
          )}
          {nuevaPreguntaSeccion === SIN_SECCION ? (
            <div className="w-full">
              <PreguntaForm
                examenId={examen.id}
                secciones={examen.secciones}
                onSaved={() => { setNuevaPreguntaSeccion(null); onChanged(); }}
                onCancel={() => setNuevaPreguntaSeccion(null)}
              />
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setNuevaPreguntaSeccion(SIN_SECCION)}>
              <Plus size={14} /> Agregar pregunta
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

// ── Editar metadata del examen ───────────────────────────────────────────────
function ExamenMetaForm({ examen, onSaved, onCancel }: {
  examen: CursoExamenRow; onSaved: () => void; onCancel: () => void;
}) {
  const [titulo, setTitulo] = useState(examen.titulo);
  const [descripcion, setDescripcion] = useState(examen.descripcion ?? '');
  const [nota, setNota] = useState(examen.nota_aprobacion);
  const [intentos, setIntentos] = useState(examen.intentos_max);
  const [mostrar, setMostrar] = useState(examen.mostrar_resultados);
  const [mezclar, setMezclar] = useState(examen.mezclar_preguntas);
  const [habDesde, setHabDesde] = useState(isoToLocalInput(examen.fecha_habilitacion));
  const [habHasta, setHabHasta] = useState(isoToLocalInput(examen.fecha_cierre));
  const [saving, setSaving] = useState(false);

  async function guardar() {
    if (!titulo.trim()) { toast.error('El título no puede quedar vacío.'); return; }
    if (ventanaInvalida(habDesde, habHasta)) {
      toast.error('La fecha de cierre no puede ser anterior a la de habilitación.');
      return;
    }
    setSaving(true);
    const res = await actualizarExamen(examen.id, {
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      nota_aprobacion: Math.min(100, Math.max(0, nota || 0)),
      intentos_max: Math.max(1, intentos || 1),
      mostrar_resultados: mostrar,
      mezclar_preguntas: mezclar,
      fecha_habilitacion: localInputToIso(habDesde),
      fecha_cierre: localInputToIso(habHasta),
    });
    setSaving(false);
    if (!res.ok) { toast.error(humanizeError(res.error)); return; }
    toast.success('Examen actualizado');
    onSaved();
  }

  return (
    <div className="space-y-3 border-b border-slate-100 bg-brand-zebra/40 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Título">
          <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        </Field>
        <Field label="Descripción / consignas">
          <Textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Nota mínima">
          <Input type="number" min={0} max={100} value={nota}
            onChange={(e) => setNota(Number(e.target.value))} className="w-28" />
        </Field>
        <Field label="Intentos">
          <Input type="number" min={1} max={20} value={intentos}
            onChange={(e) => setIntentos(Number(e.target.value))} className="w-28" />
        </Field>
        <div className="flex flex-wrap items-center gap-4 pb-2">
          <Toggle checked={mostrar} onChange={setMostrar} label="Mostrar resultados" />
          <Toggle checked={mezclar} onChange={setMezclar} label="Mezclar preguntas" />
        </div>
      </div>
      {/* DGG-96 · ventana de habilitación (opcional). Vacío = disponible ya / sin límite. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Habilitado desde (opcional)" hint="Vacío = disponible de inmediato.">
          <Input type="datetime-local" value={habDesde}
            onChange={(e) => setHabDesde(e.target.value)} />
        </Field>
        <Field label="Habilitado hasta (opcional)" hint="Vacío = sin límite de tiempo.">
          <Input type="datetime-local" value={habHasta}
            onChange={(e) => setHabHasta(e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}><X size={14} /> Cancelar</Button>
        <Button onClick={guardar} loading={saving}><Save size={14} /> Guardar</Button>
      </div>
    </div>
  );
}

// ── Form de sección ──────────────────────────────────────────────────────────
function SeccionForm({ examenId, inicial, onSaved, onCancel }: {
  examenId: string; inicial?: CursoExamenSeccionRow; onSaved: () => void; onCancel: () => void;
}) {
  const [titulo, setTitulo] = useState(inicial?.titulo ?? '');
  const [descripcion, setDescripcion] = useState(inicial?.descripcion ?? '');
  const [saving, setSaving] = useState(false);

  async function guardar() {
    if (!titulo.trim()) { toast.error('Poné un título a la sección.'); return; }
    setSaving(true);
    const res = inicial
      ? await actualizarSeccion(inicial.id, { titulo: titulo.trim(), descripcion: descripcion.trim() || null })
      : await crearSeccion({ examen_id: examenId, titulo: titulo.trim(), descripcion: descripcion.trim() || null });
    setSaving(false);
    if (!res.ok) { toast.error(humanizeError(res.error)); return; }
    toast.success(inicial ? 'Sección actualizada' : 'Sección agregada');
    onSaved();
  }

  return (
    <div className="w-full space-y-2 rounded-xl border border-brand-cyan/30 bg-brand-cyan/5 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Título de la sección">
          <Input value={titulo} onChange={(e) => setTitulo(e.target.value)}
            placeholder="p. ej. Procesos Administrativos (Dra. Lucero)" />
        </Field>
        <Field label="Descripción (opcional)">
          <Input value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
            placeholder="p. ej. Seleccioná la respuesta correcta" />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}><X size={13} /> Cancelar</Button>
        <Button onClick={guardar} loading={saving}><Save size={13} /> {inicial ? 'Guardar' : 'Agregar'}</Button>
      </div>
    </div>
  );
}

// ── Tarjeta de pregunta (display) ────────────────────────────────────────────
function PreguntaRow({ indice, pregunta, onEdit, onDelete }: {
  indice: number; pregunta: PreguntaFull; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-brand-ink">
          <span className="mr-1 text-brand-cyan">P{indice}.</span>
          {pregunta.enunciado}
          <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-muted">
            {pregunta.puntaje} pts
          </span>
        </p>
        <div className="flex shrink-0 gap-1">
          <button onClick={onEdit} className="rounded p-1 text-brand-muted hover:text-brand-cyan" title="Editar">
            <Pencil size={13} />
          </button>
          <button onClick={onDelete} className="rounded p-1 text-brand-muted hover:text-red-600" title="Eliminar">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {pregunta.opciones.map((o) => (
          <li key={o.id} className={cn(
            'flex items-center gap-2 rounded-md px-2 py-1',
            o.correcta ? 'bg-emerald-50 text-emerald-800' : 'text-brand-muted',
          )}>
            {o.correcta ? <CheckCircle2 size={12} className="shrink-0 text-emerald-600" />
              : <span className="h-3 w-3 shrink-0 rounded-full border border-slate-300" />}
            {o.texto}
          </li>
        ))}
      </ul>
      {pregunta.explicacion && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-brand-zebra/40 p-2 text-[11px] text-brand-muted">
          <Info size={12} className="mt-px shrink-0 text-brand-cyan" />
          <span><span className="font-semibold">Justificación:</span> {pregunta.explicacion}</span>
        </p>
      )}
    </div>
  );
}

// ── Form de pregunta (alta + edición) ────────────────────────────────────────
interface OpcionDraft { texto: string; correcta: boolean; retroalimentacion: string }

function PreguntaForm({ examenId, secciones, inicial, defaultSeccionId, onSaved, onCancel }: {
  examenId: string;
  secciones: CursoExamenSeccionRow[];
  inicial?: PreguntaFull;
  defaultSeccionId?: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [tipo, setTipo] = useState<PreguntaTipo>(inicial?.tipo as PreguntaTipo ?? 'multiple_choice');
  const [enunciado, setEnunciado] = useState(inicial?.enunciado ?? '');
  const [puntaje, setPuntaje] = useState(inicial?.puntaje ?? 1);
  const [explicacion, setExplicacion] = useState(inicial?.explicacion ?? '');
  const [seccionId, setSeccionId] = useState<string>(
    inicial?.seccion_id ?? defaultSeccionId ?? SIN_SECCION,
  );
  const [opciones, setOpciones] = useState<OpcionDraft[]>(() => {
    if (inicial && inicial.tipo !== 'texto_corto' && inicial.opciones.length) {
      return inicial.opciones.map((o) => ({
        texto: o.texto, correcta: o.correcta, retroalimentacion: o.retroalimentacion ?? '',
      }));
    }
    if ((inicial?.tipo ?? 'multiple_choice') === 'verdadero_falso') {
      return [
        { texto: 'Verdadero', correcta: true, retroalimentacion: '' },
        { texto: 'Falso', correcta: false, retroalimentacion: '' },
      ];
    }
    return [
      { texto: '', correcta: true, retroalimentacion: '' },
      { texto: '', correcta: false, retroalimentacion: '' },
    ];
  });
  const [saving, setSaving] = useState(false);

  function cambiarTipo(nuevo: PreguntaTipo) {
    setTipo(nuevo);
    if (nuevo === 'verdadero_falso') {
      setOpciones([
        { texto: 'Verdadero', correcta: true, retroalimentacion: '' },
        { texto: 'Falso', correcta: false, retroalimentacion: '' },
      ]);
    } else if (nuevo === 'multiple_choice' && opciones.length < 2) {
      setOpciones([
        { texto: '', correcta: true, retroalimentacion: '' },
        { texto: '', correcta: false, retroalimentacion: '' },
      ]);
    }
  }

  async function guardar() {
    if (!enunciado.trim()) { toast.error('Escribí el enunciado.'); return; }
    let ops: OpcionDraft[] = [];
    if (tipo === 'verdadero_falso') {
      ops = opciones.slice(0, 2);
    } else if (tipo === 'multiple_choice') {
      ops = opciones.filter((o) => o.texto.trim());
      if (ops.length < 2) { toast.error('Cargá al menos dos opciones.'); return; }
    }
    if (tipo !== 'texto_corto' && !ops.some((o) => o.correcta)) {
      toast.error('Marcá al menos una opción como correcta.');
      return;
    }
    const opcionesPayload = tipo === 'texto_corto'
      ? undefined
      : ops.map((o) => ({
          texto: o.texto.trim(),
          correcta: o.correcta,
          retroalimentacion: o.retroalimentacion.trim() || null,
        }));
    const seccion = seccionId === SIN_SECCION ? null : seccionId;

    setSaving(true);
    let res;
    if (inicial) {
      res = await actualizarPregunta(inicial.id, {
        enunciado: enunciado.trim(), tipo, puntaje,
        explicacion: explicacion.trim() || null, seccion_id: seccion,
      });
      if (res.ok && opcionesPayload) {
        const r2 = await reemplazarOpciones(inicial.id, opcionesPayload);
        if (!r2.ok) res = r2;
      } else if (res.ok && tipo === 'texto_corto') {
        await reemplazarOpciones(inicial.id, []);
      }
    } else {
      res = await crearPregunta({
        examen_id: examenId, enunciado: enunciado.trim(), tipo, puntaje,
        explicacion: explicacion.trim() || null, seccion_id: seccion,
        opciones: opcionesPayload,
      });
    }
    setSaving(false);
    if (!res.ok) { toast.error(humanizeError(res.error)); return; }
    toast.success(inicial ? 'Pregunta actualizada' : 'Pregunta agregada');
    onSaved();
  }

  return (
    <div className="w-full space-y-3 rounded-xl border border-dashed border-brand-cyan/40 bg-white p-4">
      <p className="kicker text-brand-cyan">{inicial ? 'Editar pregunta' : 'Nueva pregunta'}</p>

      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <Field label="Enunciado">
          <Textarea value={enunciado} onChange={(e) => setEnunciado(e.target.value)} rows={2} />
        </Field>
        <div className="space-y-3">
          <Field label="Tipo">
            <Select value={tipo} onChange={(e) => cambiarTipo(e.target.value as PreguntaTipo)}>
              {PREGUNTA_TIPOS.map((t) => (
                <option key={t} value={t}>{PREGUNTA_TIPO_LABEL[t]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Puntaje">
            <Input type="number" min={0} max={100} value={puntaje}
              onChange={(e) => setPuntaje(Number(e.target.value))} />
          </Field>
        </div>
      </div>

      {secciones.length > 0 && (
        <Field label="Sección">
          <Select value={seccionId} onChange={(e) => setSeccionId(e.target.value)}>
            <option value={SIN_SECCION}>Sin sección</option>
            {secciones.map((s) => (
              <option key={s.id} value={s.id}>{s.titulo}</option>
            ))}
          </Select>
        </Field>
      )}

      {tipo === 'multiple_choice' && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-brand-muted">
            Marcá la opción correcta. La retroalimentación es opcional.
          </p>
          {opciones.map((o, idx) => (
            <div key={idx} className="grid grid-cols-[auto_1fr] items-center gap-2 sm:grid-cols-[auto_1fr_1fr_auto]">
              <input
                type="radio"
                name={`correcta-${inicial?.id ?? 'new'}`}
                checked={o.correcta}
                onChange={() => setOpciones((p) => p.map((x, j) => ({ ...x, correcta: j === idx })))}
                className="h-4 w-4 accent-emerald-600"
                title="Correcta"
              />
              <Input
                value={o.texto}
                onChange={(e) => setOpciones((p) => p.map((x, j) => j === idx ? { ...x, texto: e.target.value } : x))}
                placeholder={`Opción ${idx + 1}`}
              />
              <Input
                value={o.retroalimentacion}
                onChange={(e) => setOpciones((p) => p.map((x, j) => j === idx ? { ...x, retroalimentacion: e.target.value } : x))}
                placeholder="Retroalimentación (opcional)"
              />
              <button
                onClick={() => setOpciones((p) => p.filter((_, j) => j !== idx))}
                disabled={opciones.length <= 2}
                className="justify-self-end rounded p-1 text-brand-muted hover:text-red-600 disabled:opacity-30"
                title="Quitar opción"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <Button variant="ghost"
            onClick={() => setOpciones((p) => [...p, { texto: '', correcta: false, retroalimentacion: '' }])}>
            <Plus size={13} /> Agregar opción
          </Button>
        </div>
      )}

      {tipo === 'verdadero_falso' && (
        <div className="flex items-center gap-3 text-sm">
          <ListChecks size={14} className="text-brand-cyan" />
          <span className="text-brand-muted">Respuesta correcta:</span>
          <label className="flex items-center gap-1">
            <input type="radio" name={`vf-${inicial?.id ?? 'new'}`}
              checked={opciones[0]?.correcta === true}
              onChange={() => setOpciones([
                { texto: 'Verdadero', correcta: true, retroalimentacion: opciones[0]?.retroalimentacion ?? '' },
                { texto: 'Falso', correcta: false, retroalimentacion: opciones[1]?.retroalimentacion ?? '' },
              ])} />
            Verdadero
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name={`vf-${inicial?.id ?? 'new'}`}
              checked={opciones[0]?.correcta === false}
              onChange={() => setOpciones([
                { texto: 'Verdadero', correcta: false, retroalimentacion: opciones[0]?.retroalimentacion ?? '' },
                { texto: 'Falso', correcta: true, retroalimentacion: opciones[1]?.retroalimentacion ?? '' },
              ])} />
            Falso
          </label>
        </div>
      )}

      {tipo === 'texto_corto' && (
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
          Las respuestas de texto corto quedan pendientes de revisión humana (no se autocorrigen).
        </p>
      )}

      <Field label="Justificación / explicación (se muestra al alumno al responder, opcional)">
        <Textarea value={explicacion} onChange={(e) => setExplicacion(e.target.value)} rows={2}
          placeholder="p. ej. Respuesta correcta: B. La ley establece una validez de 30 días…" />
      </Field>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}><X size={14} /> Cancelar</Button>
        <Button onClick={guardar} loading={saving}><Save size={14} /> {inicial ? 'Guardar' : 'Agregar pregunta'}</Button>
      </div>
    </div>
  );
}
