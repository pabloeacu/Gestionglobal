import { useState } from 'react';
import { Plus, Trash2, Save, ListChecks } from 'lucide-react';
import {
  Button,
  Field,
  Input,
  Select,
  Textarea,
  useConfirm,
} from '@/components/common';
import { toast } from '@/lib/toast';
import {
  borrarExamen,
  borrarPregunta,
  crearExamen,
  crearPregunta,
  reemplazarOpciones,
  PREGUNTA_TIPO_LABEL,
  PREGUNTA_TIPOS,
  type CursoExamenRow,
  type CursoOpcionRow,
  type CursoPreguntaRow,
  type PreguntaTipo,
} from '@/services/api/campus';
import { cn } from '@/lib/cn';

interface ExamenEditorProps {
  cursoId: string;
  examenes: Array<
    CursoExamenRow & {
      preguntas: Array<CursoPreguntaRow & { opciones: CursoOpcionRow[] }>;
    }
  >;
  onChanged: () => void;
}

// Editor de exámenes para staff. SurveyMonkey-style: lista de exámenes,
// alta inline de exámenes y preguntas, gestión de opciones por pregunta.
export function ExamenEditor({ cursoId, examenes, onChanged }: ExamenEditorProps) {
  const confirm = useConfirm();
  const [nuevoTitulo, setNuevoTitulo] = useState('');
  const [nuevaNota, setNuevaNota] = useState(60);
  const [nuevoIntentos, setNuevoIntentos] = useState(1);
  const [creating, setCreating] = useState(false);

  async function crearNuevo() {
    if (!nuevoTitulo.trim()) {
      toast.error('Poné un título al examen.');
      return;
    }
    setCreating(true);
    const res = await crearExamen({
      curso_id: cursoId,
      titulo: nuevoTitulo.trim(),
      intentos_max: nuevoIntentos,
      nota_aprobacion: nuevaNota,
    });
    setCreating(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    setNuevoTitulo('');
    toast.success('Examen creado');
    onChanged();
  }

  async function eliminar(examen: CursoExamenRow) {
    const ok = await confirm({
      title: 'Eliminar examen',
      message: `¿Eliminar "${examen.titulo}" y todas sus preguntas? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const res = await borrarExamen(examen.id);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('Examen eliminado');
    onChanged();
  }

  return (
    <div className="space-y-6">
      {/* Alta rápida */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="kicker text-brand-cyan">Nuevo examen</p>
        <h3 className="mt-1 font-display text-lg font-semibold text-brand-ink">
          Agregá una evaluación al curso
        </h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_120px_120px_auto]">
          <Field label="Título">
            <Input
              value={nuevoTitulo}
              onChange={(e) => setNuevoTitulo(e.target.value)}
              placeholder="p. ej. Examen final"
            />
          </Field>
          <Field label="Nota mínima">
            <Input
              type="number"
              min={0}
              max={100}
              value={nuevaNota}
              onChange={(e) => setNuevaNota(Number(e.target.value))}
            />
          </Field>
          <Field label="Intentos">
            <Input
              type="number"
              min={1}
              max={20}
              value={nuevoIntentos}
              onChange={(e) => setNuevoIntentos(Number(e.target.value))}
            />
          </Field>
          <div className="self-end">
            <Button onClick={crearNuevo} loading={creating}>
              <Plus size={14} /> Crear
            </Button>
          </div>
        </div>
      </section>

      {/* Lista */}
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

interface ExamenItemProps {
  examen: CursoExamenRow & {
    preguntas: Array<CursoPreguntaRow & { opciones: CursoOpcionRow[] }>;
  };
  onDelete: () => void;
  onChanged: () => void;
}

function ExamenItem({ examen, onDelete, onChanged }: ExamenItemProps) {
  const confirm = useConfirm();
  const [tipo, setTipo] = useState<PreguntaTipo>('multiple_choice');
  const [enunciado, setEnunciado] = useState('');
  const [opciones, setOpciones] = useState<
    Array<{ texto: string; correcta: boolean }>
  >([
    { texto: '', correcta: true },
    { texto: '', correcta: false },
  ]);
  const [saving, setSaving] = useState(false);

  async function addPregunta() {
    if (!enunciado.trim()) {
      toast.error('Escribí el enunciado.');
      return;
    }
    const opcionesFinales =
      tipo === 'verdadero_falso'
        ? [
            { texto: 'Verdadero', correcta: opciones[0]?.correcta ?? true },
            { texto: 'Falso', correcta: opciones[0]?.correcta ? false : true },
          ]
        : opciones.filter((o) => o.texto.trim());
    if (tipo !== 'texto_corto' && opcionesFinales.filter((o) => o.correcta).length === 0) {
      toast.error('Marcá al menos una opción como correcta.');
      return;
    }
    setSaving(true);
    const res = await crearPregunta({
      examen_id: examen.id,
      enunciado: enunciado.trim(),
      tipo,
      opciones: tipo !== 'texto_corto' ? opcionesFinales : undefined,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    setEnunciado('');
    setOpciones([
      { texto: '', correcta: true },
      { texto: '', correcta: false },
    ]);
    toast.success('Pregunta agregada');
    onChanged();
  }

  async function eliminarPregunta(p: CursoPreguntaRow) {
    const ok = await confirm({
      title: 'Eliminar pregunta',
      message: '¿Querés eliminar esta pregunta?',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const res = await borrarPregunta(p.id);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    onChanged();
  }

  async function actualizarOpcionCorrecta(
    pregunta: CursoPreguntaRow & { opciones: CursoOpcionRow[] },
    opcionId: string,
  ) {
    const next = pregunta.opciones.map((o) => ({
      texto: o.texto,
      correcta: o.id === opcionId,
    }));
    const res = await reemplazarOpciones(pregunta.id, next);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    onChanged();
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
        <div>
          <p className="kicker text-brand-cyan">Examen</p>
          <h3 className="mt-1 font-display text-lg font-semibold text-brand-ink">
            {examen.titulo}
          </h3>
          <p className="text-xs text-brand-muted">
            {examen.preguntas.length} preguntas · Mín {examen.nota_aprobacion}/100 · {examen.intentos_max} intento(s)
          </p>
        </div>
        <Button variant="ghost" onClick={onDelete}>
          <Trash2 size={14} /> Borrar
        </Button>
      </header>

      <div className="space-y-3 p-4">
        {examen.preguntas.map((p, i) => (
          <div
            key={p.id}
            className="rounded-xl border border-slate-100 bg-brand-zebra/30 p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-brand-ink">
                <span className="mr-1 text-brand-cyan">P{i + 1}.</span>
                {p.enunciado}
              </p>
              <button
                onClick={() => void eliminarPregunta(p)}
                className="text-brand-muted hover:text-red-600"
                title="Eliminar"
              >
                <Trash2 size={13} />
              </button>
            </div>
            <ul className="mt-2 space-y-1 text-xs">
              {p.opciones.map((o) => (
                <li
                  key={o.id}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1',
                    o.correcta
                      ? 'bg-emerald-50 text-emerald-800'
                      : 'text-brand-muted',
                  )}
                >
                  <input
                    type="radio"
                    name={`correcta-${p.id}`}
                    checked={o.correcta}
                    onChange={() => void actualizarOpcionCorrecta(p, o.id)}
                    className="accent-emerald-600"
                  />
                  {o.texto}
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* Alta de pregunta */}
        <div className="rounded-xl border border-dashed border-slate-300 p-4">
          <p className="kicker text-brand-cyan">Nueva pregunta</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_200px]">
            <Field label="Enunciado">
              <Textarea
                value={enunciado}
                onChange={(e) => setEnunciado(e.target.value)}
                rows={2}
              />
            </Field>
            <Field label="Tipo">
              <Select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as PreguntaTipo)}
              >
                {PREGUNTA_TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {PREGUNTA_TIPO_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {tipo === 'multiple_choice' && (
            <div className="mt-3 space-y-2">
              {opciones.map((o, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="correcta-new"
                    checked={o.correcta}
                    onChange={() =>
                      setOpciones((prev) =>
                        prev.map((x, j) => ({ ...x, correcta: j === idx })),
                      )
                    }
                    className="accent-emerald-600"
                  />
                  <Input
                    value={o.texto}
                    onChange={(e) =>
                      setOpciones((prev) =>
                        prev.map((x, j) =>
                          j === idx ? { ...x, texto: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder={`Opción ${idx + 1}`}
                  />
                  <button
                    onClick={() =>
                      setOpciones((prev) => prev.filter((_, j) => j !== idx))
                    }
                    className="text-brand-muted hover:text-red-600"
                    title="Quitar"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <Button
                variant="ghost"
                onClick={() =>
                  setOpciones((prev) => [...prev, { texto: '', correcta: false }])
                }
              >
                <Plus size={13} /> Agregar opción
              </Button>
            </div>
          )}

          {tipo === 'verdadero_falso' && (
            <div className="mt-3 flex items-center gap-3 text-sm">
              <ListChecks size={14} className="text-brand-cyan" />
              <span>Respuesta correcta:</span>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="vf-new"
                  checked={opciones[0]?.correcta === true}
                  onChange={() =>
                    setOpciones([
                      { texto: 'Verdadero', correcta: true },
                      { texto: 'Falso', correcta: false },
                    ])
                  }
                />
                Verdadero
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="vf-new"
                  checked={opciones[0]?.correcta === false}
                  onChange={() =>
                    setOpciones([
                      { texto: 'Verdadero', correcta: false },
                      { texto: 'Falso', correcta: true },
                    ])
                  }
                />
                Falso
              </label>
            </div>
          )}

          {tipo === 'texto_corto' && (
            <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              Las respuestas de texto corto quedan pendientes de revisión humana
              (no se autocorrigen).
            </p>
          )}

          <div className="mt-3 flex justify-end">
            <Button onClick={addPregunta} loading={saving}>
              <Save size={14} /> Guardar pregunta
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}
