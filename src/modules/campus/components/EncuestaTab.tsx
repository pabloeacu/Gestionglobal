// Solapa "Encuesta de satisfacción" del editor del curso (gerencia).
// Mig 0136. Sub-tabs internos: Configuración (builder + flags) | Respuestas (reportes).

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Trash2,
  Copy,
  ClipboardList,
  Star,
  CheckSquare,
  AlignLeft,
  Hash,
  ChevronUp,
  ChevronDown,
  Image as ImageIcon,
  EyeOff,
  CheckCircle2,
  X,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  Button,
  Field,
  Input,
  Select,
  Textarea,
  Tabs,
  type TabItem,
  useConfirm,
} from '@/components/common';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import {
  actualizarEncuesta,
  emularEncuestaDeCurso,
  ensureEncuestaCurso,
  listarEncuestasEmulables,
  listarRespuestasCurso,
  marcarPublicado,
  nuevoIdPregunta,
  PREGUNTA_TIPO_LABEL,
  type CursoEmulable,
  type CursoEncuestaRow,
  type EncuestaSchema,
  type PreguntaDef,
  type PreguntaTipo,
  type RespuestaJoinProfile,
} from '@/services/api/encuestas';
import { cn } from '@/lib/cn';
import { formatDateShort } from '@/lib/dates';

interface EncuestaTabProps {
  curso_id: string;
  curso_titulo: string;
}

export function EncuestaTab({ curso_id, curso_titulo }: EncuestaTabProps) {
  const [encuesta, setEncuesta] = useState<CursoEncuestaRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'config' | 'respuestas'>('config');

  async function load() {
    setLoading(true);
    const r = await ensureEncuestaCurso(curso_id);
    setLoading(false);
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    setEncuesta(r.data);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curso_id]);

  if (loading || !encuesta) {
    return (
      <section className="card-premium p-6 text-sm text-brand-muted">
        Cargando encuesta…
      </section>
    );
  }

  const tabs: TabItem[] = [
    { key: 'config', label: 'Configuración' },
    { key: 'respuestas', label: 'Respuestas' },
  ];

  return (
    <div className="space-y-4">
      <Tabs items={tabs} activeKey={tab} onChange={(k) => setTab(k as 'config' | 'respuestas')} />
      {tab === 'config' && (
        <EncuestaConfig
          encuesta={encuesta}
          curso_id={curso_id}
          curso_titulo={curso_titulo}
          onChange={(e) => setEncuesta(e)}
        />
      )}
      {tab === 'respuestas' && <EncuestaRespuestas encuesta={encuesta} />}
    </div>
  );
}

// ============================================================================
// CONFIGURACIÓN · builder + flags + emular
// ============================================================================

function EncuestaConfig({
  encuesta,
  curso_id,
  curso_titulo,
  onChange,
}: {
  encuesta: CursoEncuestaRow;
  curso_id: string;
  curso_titulo: string;
  onChange: (e: CursoEncuestaRow) => void;
}) {
  const schema = useMemo<EncuestaSchema>(
    () =>
      (encuesta.schema as unknown as EncuestaSchema) ?? { preguntas: [] },
    [encuesta.schema],
  );
  const [draft, setDraft] = useState<EncuestaSchema>(schema);
  const [titulo, setTitulo] = useState(encuesta.titulo);
  const [descripcion, setDescripcion] = useState(encuesta.descripcion ?? '');
  const [saving, setSaving] = useState(false);
  const [emularOpen, setEmularOpen] = useState(false);

  // Sync con backend SÓLO si el draft local está limpio (== último valor remoto
  // sincronizado). Esto evita pisar cambios pendientes cuando otra acción
  // (toggleActiva / toggleRequerida / emular) refresca el objeto `encuesta`.
  const lastRemoteSchemaRef = useRef<EncuestaSchema>(schema);
  const lastRemoteTituloRef = useRef<string>(encuesta.titulo);
  const lastRemoteDescRef = useRef<string>(encuesta.descripcion ?? '');

  useEffect(() => {
    const draftClean =
      JSON.stringify(draft) === JSON.stringify(lastRemoteSchemaRef.current);
    if (draftClean) setDraft(schema);
    lastRemoteSchemaRef.current = schema;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  useEffect(() => {
    if (titulo === lastRemoteTituloRef.current) setTitulo(encuesta.titulo);
    lastRemoteTituloRef.current = encuesta.titulo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encuesta.titulo]);

  useEffect(() => {
    const nextDesc = encuesta.descripcion ?? '';
    if (descripcion === lastRemoteDescRef.current) setDescripcion(nextDesc);
    lastRemoteDescRef.current = nextDesc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encuesta.descripcion]);

  const dirty =
    JSON.stringify(draft) !== JSON.stringify(schema) ||
    titulo !== encuesta.titulo ||
    (descripcion || '') !== (encuesta.descripcion ?? '');

  async function guardar() {
    setSaving(true);
    const r = await actualizarEncuesta(encuesta.id, {
      titulo,
      descripcion: descripcion.trim() || null,
      schema: draft,
    });
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    toast.success('Encuesta guardada.');
    onChange(r.data);
  }

  async function toggleActiva() {
    const r = await actualizarEncuesta(encuesta.id, {
      activa: !encuesta.activa,
    });
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    toast.success(r.data.activa ? 'Encuesta activada.' : 'Encuesta desactivada.');
    onChange(r.data);
  }

  async function toggleRequerida() {
    const r = await actualizarEncuesta(encuesta.id, {
      requerida_para_cert: !encuesta.requerida_para_cert,
    });
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    toast.success(
      r.data.requerida_para_cert
        ? 'Marcada como requisito para certificado.'
        : 'Ya no es requisito para certificado.',
    );
    onChange(r.data);
  }

  function addPregunta(tipo: PreguntaTipo) {
    const nueva: PreguntaDef = {
      id: nuevoIdPregunta(),
      tipo,
      titulo:
        tipo === 'escala_10'
          ? '¿Cómo calificarías el curso en general?'
          : tipo === 'estrellas'
            ? 'Calidad del material'
            : tipo === 'multiple'
              ? '¿Qué fue lo que más te gustó?'
              : '¿Qué mejorarías?',
      required: true,
      ...(tipo === 'multiple' ? { opciones: ['Opción A', 'Opción B', 'Opción C'] } : {}),
    };
    setDraft((d) => ({ preguntas: [...d.preguntas, nueva] }));
  }

  function patchPregunta(id: string, patch: Partial<PreguntaDef>) {
    setDraft((d) => ({
      preguntas: d.preguntas.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  }
  function deletePregunta(id: string) {
    setDraft((d) => ({ preguntas: d.preguntas.filter((p) => p.id !== id) }));
  }
  function movePregunta(id: string, dir: -1 | 1) {
    setDraft((d) => {
      const list = [...d.preguntas];
      const i = list.findIndex((p) => p.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return d;
      [list[i], list[j]] = [list[j]!, list[i]!];
      return { preguntas: list };
    });
  }

  return (
    <div className="space-y-4">
      {/* Header con flags + acciones */}
      <section className="card-premium space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="kicker flex items-center gap-1">
              <ClipboardList size={12} /> Encuesta de satisfacción
            </p>
            <p className="mt-1 text-xs text-brand-muted">
              {draft.preguntas.length === 0
                ? 'Todavía no agregaste preguntas. Usá la paleta de abajo o emulá una existente.'
                : `${draft.preguntas.length} pregunta(s) · ${
                    encuesta.activa ? 'visible para los alumnos' : 'oculta a los alumnos'
                  }${encuesta.requerida_para_cert ? ' · requerida para emitir certificado' : ''}${dirty ? ' · cambios sin guardar' : ''}.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setEmularOpen(true)}
            >
              <Copy size={14} /> Emular de otro curso
            </Button>
            <Button
              variant={encuesta.activa ? 'secondary' : 'primary'}
              type="button"
              onClick={() => void toggleActiva()}
            >
              {encuesta.activa ? (
                <>
                  <EyeOff size={14} /> Despublicar
                </>
              ) : (
                <>
                  <CheckCircle2 size={14} /> Publicar
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Título visible">
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Encuesta de satisfacción"
            />
          </Field>
          <Field label="Descripción (opcional)">
            <Input
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Tu opinión es importante."
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-sm">
          <input
            type="checkbox"
            checked={encuesta.requerida_para_cert}
            onChange={() => void toggleRequerida()}
            className="rounded text-brand-cyan"
          />
          <span className="text-brand-ink">
            <strong>Requerida para certificado.</strong>{' '}
            <span className="text-brand-muted">
              El alumno debe completarla antes de que el motor emita el cert.
            </span>
          </span>
        </label>
      </section>

      {/* Paleta */}
      <section className="card-premium p-4">
        <p className="kicker mb-2">Agregar pregunta</p>
        <div className="flex flex-wrap gap-2">
          <PaletteItem icon={<Hash size={14} />} label="Escala 1 a 10" onClick={() => addPregunta('escala_10')} />
          <PaletteItem icon={<Star size={14} />} label="Estrellas (1-5)" onClick={() => addPregunta('estrellas')} />
          <PaletteItem icon={<CheckSquare size={14} />} label="Múltiple opción" onClick={() => addPregunta('multiple')} />
          <PaletteItem icon={<AlignLeft size={14} />} label="Texto libre" onClick={() => addPregunta('texto')} />
        </div>
      </section>

      {/* Lista preguntas */}
      <section className="space-y-3">
        {draft.preguntas.length === 0 ? (
          <div className="card-premium p-8">
            <IllustratedEmpty
              illustration="lista"
              title="Sin preguntas"
              description="Agregá la primera pregunta usando la paleta de arriba o emulá la encuesta de otro curso."
            />
          </div>
        ) : (
          draft.preguntas.map((p, i) => (
            <PreguntaCard
              key={p.id}
              pregunta={p}
              index={i}
              total={draft.preguntas.length}
              onPatch={(patch) => patchPregunta(p.id, patch)}
              onDelete={() => deletePregunta(p.id)}
              onMove={(dir) => movePregunta(p.id, dir)}
            />
          ))
        )}
        {/* Aviso: testimonio siempre presente */}
        <div className="card-premium relative overflow-hidden border-emerald-200 bg-emerald-50/40 p-4 text-sm text-emerald-900">
          <p className="flex items-center gap-2 font-semibold">
            <ImageIcon size={14} /> Sección "Testimonio + foto" siempre presente
          </p>
          <p className="mt-1 text-xs">
            Al final de toda encuesta, el alumno verá un bloque opcional para
            dejar su nombre, una foto, un comentario y declarar si lo podemos
            usar en nuestras redes. Esa sección no se configura — viene por defecto.
          </p>
        </div>
      </section>

      {/* Footer guardar */}
      {dirty && (
        <div className="sticky bottom-4 z-10 flex items-center justify-end gap-2 rounded-2xl border border-brand-cyan/30 bg-white/95 p-3 shadow-lg backdrop-blur">
          <span className="text-sm text-brand-muted">
            Tenés cambios sin guardar.
          </span>
          <Button type="button" disabled={saving} onClick={() => void guardar()}>
            {saving ? 'Guardando…' : 'Guardar encuesta'}
          </Button>
        </div>
      )}

      {emularOpen && (
        <EmularModal
          curso_id={curso_id}
          curso_titulo={curso_titulo}
          onClose={() => setEmularOpen(false)}
          onEmulado={() => {
            setEmularOpen(false);
            void (async () => {
              const r = await ensureEncuestaCurso(curso_id);
              if (r.ok) onChange(r.data);
            })();
          }}
        />
      )}
    </div>
  );
}

function PaletteItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-brand-ink shadow-sm transition hover:border-brand-cyan/40 hover:bg-brand-cyan-pale/30"
    >
      <span className="text-brand-cyan">{icon}</span>
      {label}
    </button>
  );
}

function PreguntaCard({
  pregunta,
  index,
  total,
  onPatch,
  onDelete,
  onMove,
}: {
  pregunta: PreguntaDef;
  index: number;
  total: number;
  onPatch: (patch: Partial<PreguntaDef>) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <div className="card-premium space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-cyan-pale text-xs font-semibold text-brand-cyan">
            {index + 1}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-muted">
            {PREGUNTA_TIPO_LABEL[pregunta.tipo]}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            className="rounded-md p-1.5 text-brand-muted hover:bg-slate-100 disabled:opacity-30"
            aria-label="Subir"
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            className="rounded-md p-1.5 text-brand-muted hover:bg-slate-100 disabled:opacity-30"
            aria-label="Bajar"
          >
            <ChevronDown size={14} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md p-1.5 text-red-600 hover:bg-red-50"
            aria-label="Eliminar"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <Field label="Pregunta" required>
        <Input
          value={pregunta.titulo}
          onChange={(e) => onPatch({ titulo: e.target.value })}
        />
      </Field>
      <Field label="Texto de ayuda (opcional)">
        <Input
          value={pregunta.ayuda ?? ''}
          onChange={(e) => onPatch({ ayuda: e.target.value || undefined })}
        />
      </Field>
      {pregunta.tipo === 'multiple' && (
        <Field label="Opciones" hint="Una por línea. Mínimo 2.">
          <Textarea
            value={(pregunta.opciones ?? []).join('\n')}
            rows={4}
            onChange={(e) =>
              onPatch({
                opciones: e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
      )}
      <label className="flex items-center gap-2 text-sm text-brand-ink">
        <input
          type="checkbox"
          checked={pregunta.required ?? true}
          onChange={(e) => onPatch({ required: e.target.checked })}
          className="rounded text-brand-cyan"
        />
        Obligatoria
      </label>
    </div>
  );
}

function EmularModal({
  curso_id,
  curso_titulo,
  onClose,
  onEmulado,
}: {
  curso_id: string;
  curso_titulo: string;
  onClose: () => void;
  onEmulado: () => void;
}) {
  const [items, setItems] = useState<CursoEmulable[]>([]);
  const [loading, setLoading] = useState(true);
  const [pick, setPick] = useState<string>('');
  const [emulating, setEmulating] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await listarEncuestasEmulables();
      setLoading(false);
      if (r.ok) {
        const otros = r.data.filter((x) => x.curso_id !== curso_id);
        setItems(otros);
        if (otros.length > 0) setPick(otros[0]!.curso_id);
      }
    })();
  }, [curso_id]);

  async function onConfirmar() {
    if (!pick) return;
    setEmulating(true);
    const r = await emularEncuestaDeCurso(curso_id, pick);
    setEmulating(false);
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    toast.success('Encuesta emulada · podés editarla a partir de la base.');
    onEmulado();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-brand-ink/40 p-4"
      onClick={onClose}
    >
      <div
        className="card-premium relative max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-3 top-3 rounded-md p-1 text-brand-muted hover:bg-slate-100"
        >
          <X size={16} />
        </button>
        <p className="kicker flex items-center gap-1">
          <Copy size={12} /> Emular encuesta
        </p>
        <h3 className="font-display text-lg font-bold text-brand-ink">
          Tomar otra como base
        </h3>
        <p className="mt-1 text-xs text-brand-muted">
          Vas a sobreescribir la encuesta actual del curso{' '}
          <strong>{curso_titulo}</strong> con una copia editable de la elegida.
        </p>
        <div className="mt-4 space-y-3">
          {loading ? (
            <p className="text-sm text-brand-muted">Cargando…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-brand-muted">
              Todavía no hay otras encuestas configuradas.
            </p>
          ) : (
            <Field label="Curso de referencia">
              <Select value={pick} onChange={(e) => setPick(e.target.value)}>
                {items.map((it) => (
                  <option key={it.curso_id} value={it.curso_id}>
                    {it.curso_titulo} ({it.n_preguntas} preguntas)
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <footer className="mt-4 flex items-center justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!pick || emulating}
            onClick={() => void onConfirmar()}
          >
            {emulating ? 'Emulando…' : 'Emular'}
          </Button>
        </footer>
      </div>
    </div>
  );
}

// ============================================================================
// RESPUESTAS · reportes y testimonios
// ============================================================================

function EncuestaRespuestas({ encuesta }: { encuesta: CursoEncuestaRow }) {
  const [rows, setRows] = useState<RespuestaJoinProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const confirm = useConfirm();

  async function load() {
    setLoading(true);
    const r = await listarRespuestasCurso(encuesta.id);
    setLoading(false);
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    setRows(r.data);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encuesta.id]);

  const schema = (encuesta.schema as unknown as EncuestaSchema) ?? { preguntas: [] };

  const stats = useMemo(() => {
    const s: Record<string, { tipo: PreguntaTipo; titulo: string; values: unknown[] }> = {};
    for (const q of schema.preguntas) {
      s[q.id] = { tipo: q.tipo, titulo: q.titulo, values: [] };
    }
    for (const r of rows) {
      const map = (r.respuestas ?? {}) as Record<string, unknown>;
      for (const q of schema.preguntas) {
        const v = map[q.id];
        if (v !== undefined && v !== null && v !== '') s[q.id]!.values.push(v);
      }
    }
    return s;
  }, [rows, schema]);

  const candidatosPublicar = rows.filter((r) => r.permite_publicar);

  if (loading) {
    return <p className="text-sm text-brand-muted">Cargando…</p>;
  }
  if (rows.length === 0) {
    return (
      <div className="card-premium p-8">
        <IllustratedEmpty
          illustration="busqueda"
          title="Sin respuestas todavía"
          description={
            encuesta.activa
              ? 'Cuando un alumno responda, vas a verla acá.'
              : 'La encuesta no está publicada. Activala desde Configuración para que los alumnos puedan responder.'
          }
        />
      </div>
    );
  }

  async function togglePublicado(r: RespuestaJoinProfile) {
    if (!r.publicado) {
      const ok = await confirm({
        title: 'Marcar como publicado',
        message: `Vas a marcar como "Publicado" el testimonio de ${
          r.alumno_nombre ?? r.testimonio_nombre ?? 'el alumno'
        }. Esto es sólo para no repetirlo — la plataforma no publica nada por sí misma.`,
        confirmLabel: 'Marcar publicado',
      });
      if (!ok) return;
    }
    const res = await marcarPublicado(r.id, !r.publicado);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success(r.publicado ? 'Desmarcado.' : 'Marcado como publicado.');
    void load();
  }

  return (
    <div className="space-y-4">
      {/* KPIs por pregunta */}
      <section className="card-premium p-5">
        <p className="kicker mb-2">Resumen por pregunta</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {schema.preguntas.map((q) => (
            <StatCard key={q.id} pregunta={q} values={stats[q.id]?.values ?? []} />
          ))}
        </div>
      </section>

      {/* Testimonios con permiso */}
      <section className="card-premium overflow-hidden">
        <header className="border-b border-slate-100 px-5 py-3">
          <p className="kicker">Testimonios con permiso de uso</p>
          <h3 className="font-display text-base font-bold text-brand-ink">
            Disponibles para campañas ({candidatosPublicar.length})
          </h3>
          <p className="mt-0.5 text-xs text-brand-muted">
            Lista para que gerencia los use fuera de la plataforma. El check
            "Publicado" se marca a mano cuando ya se usó (para evitar repetir).
          </p>
        </header>
        {candidatosPublicar.length === 0 ? (
          <p className="px-5 py-6 text-sm text-brand-muted">
            Todavía nadie cedió permiso para usar su testimonio.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {candidatosPublicar.map((r) => (
              <li key={r.id} className="flex items-start gap-4 px-5 py-4">
                {r.testimonio_foto_url ? (
                  <img
                    src={r.testimonio_foto_url}
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
                  />
                ) : (
                  <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-slate-100 text-brand-muted">
                    <ImageIcon size={20} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-brand-ink">
                      {r.testimonio_nombre ?? r.alumno_nombre ?? 'Anónimo'}
                    </p>
                    {r.publicado && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <CheckCircle2 size={10} /> Publicado
                      </span>
                    )}
                  </div>
                  {r.testimonio_comentario && (
                    <p className="mt-1 text-sm leading-relaxed text-brand-ink/90">
                      “{r.testimonio_comentario}”
                    </p>
                  )}
                  <p className="mt-1 text-xs text-brand-muted">
                    {r.alumno_nombre ?? '—'} · enviado {formatDateShort(r.created_at)}
                  </p>
                </div>
                <label className="ml-2 inline-flex shrink-0 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={r.publicado}
                    onChange={() => void togglePublicado(r)}
                    className="rounded text-brand-cyan"
                  />
                  Publicado
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Lista completa de respuestas */}
      <section className="card-premium overflow-hidden">
        <header className="border-b border-slate-100 px-5 py-3">
          <p className="kicker">Respuestas individuales ({rows.length})</p>
        </header>
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.id} className="px-5 py-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <p className="font-medium text-brand-ink">
                  {r.alumno_nombre ?? 'Alumno'}
                </p>
                <span className="text-xs text-brand-muted">
                  {formatDateShort(r.created_at)}
                </span>
                {r.permite_publicar && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                    Cedió permiso
                  </span>
                )}
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {schema.preguntas.map((q) => {
                  const map = (r.respuestas ?? {}) as Record<string, unknown>;
                  const v = map[q.id];
                  return (
                    <li key={q.id} className="flex gap-2">
                      <span className="text-brand-muted">{q.titulo}:</span>
                      <span className="text-brand-ink">
                        {v === undefined || v === null || v === '' ? (
                          <em className="text-brand-muted">sin responder</em>
                        ) : (
                          renderRespuesta(q.tipo, v)
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StatCard({
  pregunta,
  values,
}: {
  pregunta: PreguntaDef;
  values: unknown[];
}) {
  const total = values.length;
  if (total === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-xs font-semibold text-brand-ink">{pregunta.titulo}</p>
        <p className="mt-1 text-xs text-brand-muted">Sin datos</p>
      </div>
    );
  }
  if (pregunta.tipo === 'escala_10' || pregunta.tipo === 'estrellas') {
    const nums = values.map((v) => Number(v)).filter((n) => Number.isFinite(n));
    const avg = nums.reduce((a, b) => a + b, 0) / (nums.length || 1);
    const max = pregunta.tipo === 'escala_10' ? 10 : 5;
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-xs font-semibold text-brand-ink">{pregunta.titulo}</p>
        <p className="mt-1 font-display text-2xl font-bold text-brand-cyan">
          {avg.toFixed(1)}{' '}
          <span className="text-sm font-normal text-brand-muted">/ {max}</span>
        </p>
        <p className="text-[10px] text-brand-muted">{total} respuesta(s)</p>
      </div>
    );
  }
  if (pregunta.tipo === 'multiple') {
    const counts: Record<string, number> = {};
    for (const v of values) {
      const k = String(v);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    const ordered = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-xs font-semibold text-brand-ink">{pregunta.titulo}</p>
        <ul className="mt-1 space-y-0.5 text-xs">
          {ordered.map(([k, c]) => (
            <li key={k} className="flex items-center justify-between gap-2">
              <span className="truncate text-brand-ink/90">{k}</span>
              <span className="tabular-nums font-semibold text-brand-cyan">
                {c} ({Math.round((c * 100) / total)}%)
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  // texto
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold text-brand-ink">{pregunta.titulo}</p>
      <p className="mt-1 text-xs text-brand-muted">
        {total} respuesta(s) de texto · ver listado individual debajo.
      </p>
    </div>
  );
}

function renderRespuesta(tipo: PreguntaTipo, v: unknown): React.ReactNode {
  if (tipo === 'estrellas') {
    const n = Number(v);
    return (
      <span className="inline-flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            size={12}
            className={cn(
              i < n ? 'fill-amber-400 text-amber-400' : 'text-slate-300',
            )}
          />
        ))}
        <span className="ml-1 text-xs text-brand-muted">{n}/5</span>
      </span>
    );
  }
  if (tipo === 'escala_10') {
    return <strong>{Number(v)}/10</strong>;
  }
  return String(v);
}
