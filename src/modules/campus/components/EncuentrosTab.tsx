import { useCallback, useEffect, useState } from 'react';
import {
  CalendarClock,
  ExternalLink,
  GraduationCap,
  Loader2,
  Pencil,
  Plus,
  Radio,
  Save,
  Trash2,
  Video,
  VideoIcon,
} from 'lucide-react';
import { Button, Field, Input, Select, useConfirm } from '@/components/common';
import { ImageUploader } from './ImageUploader';
import { FileUploader } from './FileUploader';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  actualizarEncuentro,
  actualizarModuloSincronico,
  borrarEncuentro,
  borrarModuloSincronico,
  configurarSalaWebex,
  crearEncuentro,
  crearModuloSincronico,
  crearSalaZoom,
  eliminarSalaZoom,
  fmtFechaHora,
  listAsistencias,
  listEncuentros,
  listMatriculas,
  listModulosSincronicos,
  marcarAsistencia,
  MODALIDADES_SINCRONICAS,
  type CursoDetalle,
  type CursoEncuentroRow,
  type MatriculaListItem,
  type ModalidadSincronica,
  type ModuloSincronicoRow,
} from '@/services/api/campus';
import { humanizeError } from '@/lib/errors';

// ISO → value para <input type="datetime-local"> en hora local.
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

type Asist = Record<string, Set<string>>; // encuentroId → set de matriculaId presentes
type ConfirmFn = ReturnType<typeof useConfirm>;

// F10 · Encuentros sincrónicos como MÓDULOS: cada módulo (= condición de
// asistencia, mig 0220) agrupa sus encuentros, tiene docente (foto+CV) y una
// modalidad (único / alternativas / serie) que define cómo se cumple la
// condición del certificado. Los encuentros se pueden editar (fecha, etc.).
export function EncuentrosTab({ data }: { data: CursoDetalle }) {
  const confirm = useConfirm();
  const [modulos, setModulos] = useState<ModuloSincronicoRow[]>([]);
  const [encuentros, setEncuentros] = useState<CursoEncuentroRow[]>([]);
  const [matriculas, setMatriculas] = useState<MatriculaListItem[]>([]);
  const [asist, setAsist] = useState<Asist>({});
  const [loading, setLoading] = useState(true);
  const [webexEnc, setWebexEnc] = useState<CursoEncuentroRow | null>(null);

  // Nuevo módulo
  const [nmTitulo, setNmTitulo] = useState('');
  const [nmModalidad, setNmModalidad] = useState<ModalidadSincronica>('unico');
  const [creando, setCreando] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [mo, e, m] = await Promise.all([
      listModulosSincronicos(data.curso.id),
      listEncuentros(data.curso.id),
      listMatriculas({ cursoId: data.curso.id }),
    ]);
    if (!mo.ok) {
      setLoading(false);
      toast.error(humanizeError(mo.error));
      return;
    }
    if (!e.ok) {
      setLoading(false);
      toast.error(humanizeError(e.error));
      return;
    }
    setModulos(mo.data);
    setEncuentros(e.data);
    if (m.ok) setMatriculas(m.data);
    const pares = await Promise.all(
      e.data.map(async (enc) => {
        const a = await listAsistencias(enc.id);
        return [
          enc.id,
          new Set<string>(
            a.ok ? a.data.filter((x) => x.presente).map((x) => x.matricula_id) : [],
          ),
        ] as const;
      }),
    );
    const acc: Asist = {};
    for (const [k, v] of pares) acc[k] = v;
    setAsist(acc);
    setLoading(false);
  }, [data.curso.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function crearModulo() {
    if (!nmTitulo.trim()) {
      toast.error('Ponele un nombre al módulo sincrónico.');
      return;
    }
    setCreando(true);
    const res = await crearModuloSincronico(data.curso.id, {
      titulo: nmTitulo.trim(),
      modalidad: nmModalidad,
    });
    setCreando(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    setNmTitulo('');
    setNmModalidad('unico');
    toast.success('Módulo sincrónico creado');
    void load();
  }

  async function toggleAsist(encuentroId: string, matriculaId: string) {
    const presente = !asist[encuentroId]?.has(matriculaId);
    setAsist((prev) => {
      const next = { ...prev };
      const set = new Set(next[encuentroId] ?? []);
      if (presente) set.add(matriculaId);
      else set.delete(matriculaId);
      next[encuentroId] = set;
      return next;
    });
    const res = await marcarAsistencia({ encuentroId, matriculaId, presente });
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      void load();
    }
  }

  if (loading) {
    return (
      <div className="grid h-40 place-items-center text-brand-muted">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  const sinModulo = encuentros.filter((e) => !e.condicion_id);

  return (
    <div className="space-y-4">
      {/* Nuevo módulo sincrónico */}
      <section className="card-premium p-5">
        <header className="mb-2 flex items-center gap-2">
          <GraduationCap size={16} className="text-brand-cyan" />
          <h2 className="font-display text-lg font-semibold text-brand-ink">
            Nuevo módulo sincrónico
          </h2>
        </header>
        <p className="mb-3 text-sm text-brand-muted">
          Un módulo agrupa sus encuentros y define la condición de asistencia del
          certificado según su modalidad.
        </p>
        <div className="grid gap-3 sm:grid-cols-[1fr_minmax(180px,auto)_auto]">
          <Field label="Nombre del módulo" required>
            <Input
              value={nmTitulo}
              onChange={(e) => setNmTitulo(e.target.value)}
              placeholder="Asambleas virtuales"
            />
          </Field>
          <Field label="Modalidad">
            <Select
              value={nmModalidad}
              onChange={(e) => setNmModalidad(e.target.value as ModalidadSincronica)}
            >
              {MODALIDADES_SINCRONICAS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button onClick={crearModulo} loading={creando}>
              <Plus size={14} /> Crear módulo
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-brand-muted">
          {MODALIDADES_SINCRONICAS.find((m) => m.value === nmModalidad)?.hint}
        </p>
      </section>

      {modulos.length === 0 && sinModulo.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-brand-muted">
          Todavía no hay módulos sincrónicos. Creá el primero arriba y después
          sumale encuentros.
        </div>
      ) : (
        <>
          {modulos.map((mod) => (
            <ModuloCard
              key={mod.id}
              modulo={mod}
              encuentros={encuentros.filter((e) => e.condicion_id === mod.id)}
              matriculas={matriculas}
              asist={asist}
              cursoId={data.curso.id}
              onToggleAsist={toggleAsist}
              onReload={load}
              onWebex={setWebexEnc}
              confirm={confirm}
            />
          ))}

          {sinModulo.length > 0 && (
            <section className="card-premium border-amber-200 bg-amber-50/40 p-5">
              <header className="mb-1 flex items-center gap-2">
                <CalendarClock size={16} className="text-amber-600" />
                <h3 className="font-display text-base font-semibold text-brand-ink">
                  Encuentros sin módulo
                </h3>
              </header>
              <p className="mb-3 text-xs text-brand-muted">
                No pertenecen a ningún módulo sincrónico (no cuentan para la
                condición). Asignalos a uno.
              </p>
              <ul className="space-y-2">
                {sinModulo.map((enc) => (
                  <li
                    key={enc.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-brand-ink">
                      {enc.titulo}
                    </span>
                    <span className="text-xs text-brand-muted">
                      {enc.fecha_hora ? fmtFechaHora(enc.fecha_hora) : 'Sin fecha'}
                    </span>
                    <Select
                      className="h-9 w-auto py-1 text-xs"
                      value=""
                      aria-label="Asignar a módulo"
                      onChange={async (e) => {
                        if (!e.target.value) return;
                        const r = await actualizarEncuentro(enc.id, {
                          condicion_id: e.target.value,
                        });
                        if (!r.ok) {
                          toast.error(humanizeError(r.error));
                          return;
                        }
                        toast.success('Encuentro asignado');
                        void load();
                      }}
                    >
                      <option value="">Asignar a módulo…</option>
                      {modulos.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.etiqueta}
                        </option>
                      ))}
                    </Select>
                    <button
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Eliminar encuentro',
                          message: `¿Eliminar "${enc.titulo}"?`,
                          confirmLabel: 'Eliminar',
                          danger: true,
                        });
                        if (!ok) return;
                        const r = await borrarEncuentro(enc.id);
                        if (!r.ok) {
                          toast.error(humanizeError(r.error));
                          return;
                        }
                        void load();
                      }}
                      className="rounded-md p-1.5 text-brand-muted transition hover:bg-red-50 hover:text-red-600"
                      title="Eliminar encuentro"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {webexEnc && (
        <WebexSetupModal
          encuentro={webexEnc}
          onClose={() => setWebexEnc(null)}
          onSaved={() => {
            setWebexEnc(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Card de un módulo sincrónico: docente + meta editable + sus encuentros.
// ----------------------------------------------------------------------------
function ModuloCard({
  modulo,
  encuentros,
  matriculas,
  asist,
  cursoId,
  onToggleAsist,
  onReload,
  onWebex,
  confirm,
}: {
  modulo: ModuloSincronicoRow;
  encuentros: CursoEncuentroRow[];
  matriculas: MatriculaListItem[];
  asist: Asist;
  cursoId: string;
  onToggleAsist: (encId: string, matId: string) => void;
  onReload: () => void | Promise<void>;
  onWebex: (enc: CursoEncuentroRow) => void;
  confirm: ConfirmFn;
}) {
  const [titulo, setTitulo] = useState(modulo.etiqueta);
  const [desc, setDesc] = useState<string>(modulo.descripcion ?? '');
  const [modalidad, setModalidad] = useState<ModalidadSincronica>(
    (modulo.modalidad as ModalidadSincronica) ?? 'unico',
  );
  const [obligatoria, setObligatoria] = useState<boolean>(modulo.obligatoria);
  const [docNombre, setDocNombre] = useState<string>(modulo.docente_nombre ?? '');
  const [docFoto, setDocFoto] = useState<string | null>(modulo.docente_foto_url ?? null);
  const [docCv, setDocCv] = useState<string | null>(modulo.docente_cv_url ?? null);
  const [savingMeta, setSavingMeta] = useState(false);

  // Nuevo encuentro dentro del módulo
  const [neTitulo, setNeTitulo] = useState('');
  const [neFecha, setNeFecha] = useState('');
  const [neDuracion, setNeDuracion] = useState(60);
  const [addOpen, setAddOpen] = useState(false);
  const [addingEnc, setAddingEnc] = useState(false);

  const metaDirty =
    titulo.trim() !== modulo.etiqueta ||
    (desc.trim() || null) !== (modulo.descripcion ?? null) ||
    modalidad !== ((modulo.modalidad as ModalidadSincronica) ?? 'unico') ||
    obligatoria !== modulo.obligatoria ||
    (docNombre.trim() || null) !== (modulo.docente_nombre ?? null);

  async function guardarMeta() {
    if (!titulo.trim()) {
      toast.error('El módulo necesita un nombre.');
      return;
    }
    setSavingMeta(true);
    const res = await actualizarModuloSincronico(modulo.id, {
      etiqueta: titulo.trim(),
      descripcion: desc.trim() || null,
      modalidad,
      obligatoria,
      docente_nombre: docNombre.trim() || null,
    });
    setSavingMeta(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Módulo actualizado');
    void onReload();
  }

  async function borrarModulo() {
    const ok = await confirm({
      title: 'Eliminar módulo sincrónico',
      message: encuentros.length
        ? `Tiene ${encuentros.length} encuentro(s); quedarán sin módulo. ¿Eliminar el módulo?`
        : '¿Eliminar este módulo?',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const res = await borrarModuloSincronico(modulo.id);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Módulo eliminado');
    void onReload();
  }

  async function agregarEncuentro() {
    if (!neTitulo.trim()) {
      toast.error('Ponele un título al encuentro.');
      return;
    }
    if (!neFecha) {
      toast.error('Poné la fecha y hora (el alumno accede 10 min antes).');
      return;
    }
    setAddingEnc(true);
    const res = await crearEncuentro({
      cursoId,
      titulo: neTitulo.trim(),
      fechaHora: new Date(neFecha).toISOString(),
      duracionMin: neDuracion,
      condicionId: modulo.id,
    });
    setAddingEnc(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    setNeTitulo('');
    setNeFecha('');
    setNeDuracion(60);
    setAddOpen(false);
    toast.success('Encuentro agregado');
    void onReload();
  }

  const modHint = MODALIDADES_SINCRONICAS.find((x) => x.value === modalidad)?.hint;

  return (
    <section className="card-premium p-5">
      {/* Header: docente + meta editable */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="shrink-0">
          <ImageUploader
            value={docFoto}
            onChange={setDocFoto}
            onPersist={async (url) => {
              await actualizarModuloSincronico(modulo.id, { docente_foto_url: url });
              void onReload();
            }}
            scope="encuentro-docente"
            ownerId={modulo.id}
            shape="circle"
            label="Docente"
            hint="Subí una nueva o reusá una del banco."
            bankEnabled
            onPickBank={async (item) => {
              setDocNombre(item.nombre);
              setDocFoto(item.foto_url);
              const r = await actualizarModuloSincronico(modulo.id, {
                docente_nombre: item.nombre,
                docente_foto_url: item.foto_url,
              });
              if (!r.ok) toast.error(humanizeError(r.error));
              else void onReload();
            }}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              className="max-w-xs font-semibold"
              aria-label="Nombre del módulo"
            />
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-cyan/10 px-2 py-0.5 text-[11px] font-semibold text-brand-cyan">
              {MODALIDADES_SINCRONICAS.find((x) => x.value === modalidad)?.label ?? modalidad}
            </span>
            <button
              onClick={() => void borrarModulo()}
              className="ml-auto rounded-md p-1.5 text-brand-muted transition hover:bg-red-50 hover:text-red-600"
              title="Eliminar módulo"
            >
              <Trash2 size={15} />
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={docNombre}
              onChange={(e) => setDocNombre(e.target.value)}
              placeholder="Nombre del docente"
              aria-label="Docente"
            />
            <Select
              value={modalidad}
              onChange={(e) => setModalidad(e.target.value as ModalidadSincronica)}
              aria-label="Modalidad del módulo"
            >
              {MODALIDADES_SINCRONICAS.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </Select>
          </div>
          <Input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Descripción (opcional)"
            aria-label="Descripción del módulo"
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <label className="inline-flex items-center gap-1.5 text-brand-muted">
              <input
                type="checkbox"
                checked={obligatoria}
                onChange={(e) => setObligatoria(e.target.checked)}
                className="accent-brand-cyan"
              />
              Obligatoria para el certificado
            </label>
            {modHint && <span className="text-brand-muted">{modHint}</span>}
            <div className="ml-auto flex items-center gap-2">
              <FileUploader
                value={docCv}
                onChange={setDocCv}
                onPersist={async (url) => {
                  await actualizarModuloSincronico(modulo.id, { docente_cv_url: url });
                  void onReload();
                }}
                scope="encuentro-docente-cv"
                ownerId={modulo.id}
                label="CV del docente (PDF)"
                hint="Opcional"
              />
              {metaDirty && (
                <Button onClick={guardarMeta} loading={savingMeta} className="!py-1.5 text-xs">
                  <Save size={13} /> Guardar módulo
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Encuentros del módulo */}
      <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
        {encuentros.length === 0 ? (
          <p className="text-sm text-brand-muted">Este módulo todavía no tiene encuentros.</p>
        ) : (
          encuentros.map((enc) => (
            <EncuentroRow
              key={enc.id}
              encuentro={enc}
              matriculas={matriculas}
              presentes={asist[enc.id] ?? new Set()}
              onToggleAsist={onToggleAsist}
              onReload={onReload}
              onWebex={onWebex}
              confirm={confirm}
            />
          ))
        )}

        {addOpen ? (
          <div className="rounded-xl border border-brand-cyan/30 bg-brand-cyan-pale/20 p-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="Tema / título" required>
                <Input value={neTitulo} onChange={(e) => setNeTitulo(e.target.value)} placeholder="Encuentro 1" />
              </Field>
              <Field label="Fecha y hora" required>
                <Input type="datetime-local" value={neFecha} onChange={(e) => setNeFecha(e.target.value)} />
              </Field>
              <Field label="Duración (min)">
                <Input
                  type="number"
                  min={15}
                  max={480}
                  value={neDuracion}
                  onChange={(e) => setNeDuracion(Number(e.target.value) || 60)}
                />
              </Field>
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={() => setAddOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink hover:bg-slate-50"
              >
                Cancelar
              </button>
              <Button onClick={agregarEncuentro} loading={addingEnc} className="!py-1.5 text-xs">
                <Plus size={13} /> Agregar
              </Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-brand-cyan/40 px-3 py-1.5 text-xs font-semibold text-brand-cyan transition hover:bg-brand-cyan/5"
          >
            <Plus size={13} /> Agregar encuentro
          </button>
        )}
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------
// Una fila de encuentro: edición + sala Zoom/Webex + grilla de asistencia.
// ----------------------------------------------------------------------------
function EncuentroRow({
  encuentro,
  matriculas,
  presentes,
  onToggleAsist,
  onReload,
  onWebex,
  confirm,
}: {
  encuentro: CursoEncuentroRow;
  matriculas: MatriculaListItem[];
  presentes: Set<string>;
  onToggleAsist: (encId: string, matId: string) => void;
  onReload: () => void | Promise<void>;
  onWebex: (enc: CursoEncuentroRow) => void;
  confirm: ConfirmFn;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [edTitulo, setEdTitulo] = useState(encuentro.titulo);
  const [edFecha, setEdFecha] = useState(isoToLocalInput(encuentro.fecha_hora));
  const [edDuracion, setEdDuracion] = useState<number>(encuentro.duracion_min ?? 60);
  const [edDesc, setEdDesc] = useState<string>(encuentro.descripcion ?? '');
  const [savingEd, setSavingEd] = useState(false);

  const isWebex = encuentro.plataforma === 'webex';
  const tieneSala = isWebex ? !!encuentro.webex_meeting_id : !!encuentro.zoom_meeting_id;
  const status = (isWebex ? encuentro.webex_status : encuentro.zoom_status) ?? 'programado';
  const statusBadge =
    status === 'en_curso'
      ? { label: '● En vivo', cls: 'bg-red-100 text-red-700 border-red-200' }
      : status === 'finalizado'
        ? { label: 'Finalizado', cls: 'bg-slate-100 text-slate-700 border-slate-200' }
        : status === 'cancelado'
          ? { label: 'Cancelado', cls: 'bg-amber-100 text-amber-700 border-amber-200' }
          : { label: 'Programado', cls: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20' };

  async function crearSala() {
    setBusy(true);
    const r = await crearSalaZoom({ encuentroId: encuentro.id, duracionMin: encuentro.duracion_min ?? 60 });
    setBusy(false);
    if (!r.ok) {
      toast.error(humanizeError(r.error));
      return;
    }
    toast.success('Sala Zoom creada ✓');
    void onReload();
  }

  async function eliminarSala() {
    const ok = await confirm({
      title: 'Eliminar sala Zoom',
      message: `¿Eliminar la reunión Zoom de "${encuentro.titulo}"? El link deja de funcionar.`,
      confirmLabel: 'Eliminar sala',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const r = await eliminarSalaZoom({ encuentroId: encuentro.id });
    setBusy(false);
    if (!r.ok) {
      toast.error(humanizeError(r.error));
      return;
    }
    toast.success('Sala Zoom eliminada');
    void onReload();
  }

  async function eliminar() {
    const ok = await confirm({
      title: 'Eliminar encuentro',
      message: `¿Eliminar "${encuentro.titulo}" y su registro de asistencia?`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    if (encuentro.zoom_meeting_id) {
      const d = await eliminarSalaZoom({ encuentroId: encuentro.id });
      if (!d.ok) {
        toast.warning(humanizeError(d.error), {
          description: 'La reunión queda en tu cuenta de Zoom; borrala a mano si querés.',
        });
      }
    }
    const r = await borrarEncuentro(encuentro.id);
    if (!r.ok) {
      toast.error(humanizeError(r.error));
      return;
    }
    void onReload();
  }

  async function guardarEdicion() {
    if (!edTitulo.trim()) {
      toast.error('El encuentro necesita un título.');
      return;
    }
    if (!edFecha) {
      toast.error('Poné la fecha y hora.');
      return;
    }
    setSavingEd(true);
    const r = await actualizarEncuentro(encuentro.id, {
      titulo: edTitulo.trim(),
      fecha_hora: new Date(edFecha).toISOString(),
      duracion_min: edDuracion,
      descripcion: edDesc.trim() || null,
    });
    setSavingEd(false);
    if (!r.ok) {
      toast.error(humanizeError(r.error));
      return;
    }
    setEditing(false);
    toast.success('Encuentro actualizado');
    void onReload();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      {editing ? (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Título" required>
              <Input value={edTitulo} onChange={(ev) => setEdTitulo(ev.target.value)} />
            </Field>
            <Field label="Fecha y hora" required>
              <Input type="datetime-local" value={edFecha} onChange={(ev) => setEdFecha(ev.target.value)} />
            </Field>
            <Field label="Duración (min)">
              <Input
                type="number"
                min={15}
                max={480}
                value={edDuracion}
                onChange={(ev) => setEdDuracion(Number(ev.target.value) || 60)}
              />
            </Field>
          </div>
          <Field label="Descripción">
            <Input value={edDesc} onChange={(ev) => setEdDesc(ev.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setEditing(false);
                setEdTitulo(encuentro.titulo);
                setEdFecha(isoToLocalInput(encuentro.fecha_hora));
                setEdDuracion(encuentro.duracion_min ?? 60);
                setEdDesc(encuentro.descripcion ?? '');
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink hover:bg-slate-50"
            >
              Cancelar
            </button>
            <Button onClick={guardarEdicion} loading={savingEd} className="!py-1.5 text-xs">
              <Save size={13} /> Guardar
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Video size={14} className="text-amber-600" />
                <h4 className="font-semibold text-brand-ink">{encuentro.titulo}</h4>
                {tieneSala && (
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                      statusBadge.cls,
                    )}
                  >
                    {statusBadge.label}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-brand-muted">
                {encuentro.fecha_hora ? fmtFechaHora(encuentro.fecha_hora) : 'Sin fecha'}
                {encuentro.duracion_min ? ` · ${encuentro.duracion_min} min` : ''}
              </p>
              {encuentro.descripcion && (
                <p className="mt-1 text-sm text-brand-muted">{encuentro.descripcion}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => setEditing(true)}
                className="rounded-md p-1.5 text-brand-muted transition hover:bg-slate-100 hover:text-brand-cyan"
                title="Editar encuentro"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => void eliminar()}
                className="rounded-md p-1.5 text-brand-muted transition hover:bg-red-50 hover:text-red-600"
                title="Eliminar encuentro"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {/* Sala Zoom/Webex */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                isWebex
                  ? 'border-purple-200 bg-purple-50 text-purple-700'
                  : 'border-blue-200 bg-blue-50 text-blue-700',
              )}
            >
              {isWebex ? 'Webex' : 'Zoom'}
            </span>
            {!tieneSala && !isWebex && (
              <button
                onClick={() => void crearSala()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-ink px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-ink/90 disabled:opacity-60"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <VideoIcon size={13} />}
                Crear sala Zoom
              </button>
            )}
            {!tieneSala && isWebex && (
              <button
                onClick={() => onWebex(encuentro)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-ink px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-ink/90"
              >
                <VideoIcon size={13} /> Configurar Webex
              </button>
            )}
            {tieneSala && isWebex && (
              <>
                <a
                  href={encuentro.webex_join_url ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-cyan/90"
                >
                  <Radio size={13} /> Iniciar host
                </a>
                <button
                  onClick={() => onWebex(encuentro)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink shadow-sm transition hover:bg-slate-50"
                >
                  Editar Webex
                </button>
              </>
            )}
            {tieneSala && !isWebex && (
              <>
                {encuentro.zoom_start_url && (
                  <a
                    href={encuentro.zoom_start_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-cyan/90"
                  >
                    <Radio size={13} /> Iniciar host
                  </a>
                )}
                {encuentro.zoom_join_url && (
                  <a
                    href={encuentro.zoom_join_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink shadow-sm transition hover:bg-slate-50"
                  >
                    <ExternalLink size={13} /> Link público
                  </a>
                )}
                {encuentro.grabacion_play_url && (
                  <a
                    href={encuentro.grabacion_play_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                  >
                    <ExternalLink size={13} /> Grabación
                  </a>
                )}
                <button
                  onClick={() => void eliminarSala()}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 shadow-sm transition hover:bg-red-50 disabled:opacity-60"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  Eliminar sala
                </button>
              </>
            )}
          </div>

          {/* Asistencia */}
          <div className="mt-3 rounded-lg border border-slate-100 bg-brand-zebra/30 p-2.5">
            <p className="kicker mb-2 text-brand-muted">
              Asistencia {tieneSala && '· se completa sola cuando los alumnos joineen'}
            </p>
            {matriculas.length === 0 ? (
              <p className="text-sm text-brand-muted">Asigná alumnos al curso para tomar asistencia.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {matriculas.map((mt) => {
                  const presente = presentes.has(mt.id);
                  return (
                    <li key={mt.id}>
                      <button
                        onClick={() => onToggleAsist(encuentro.id, mt.id)}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition',
                          presente
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-slate-200 bg-white text-brand-muted hover:bg-slate-50',
                        )}
                      >
                        <span className="truncate">{mt.alumno_nombre ?? 'Alumno'}</span>
                        <span
                          className={cn(
                            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                            presente ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600',
                          )}
                        >
                          {presente ? 'Presente' : 'Ausente'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Modal de configuración manual de sala Webex (sin cambios funcionales).
// ----------------------------------------------------------------------------
function WebexSetupModal({
  encuentro,
  onClose,
  onSaved,
}: {
  encuentro: CursoEncuentroRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [joinUrl, setJoinUrl] = useState<string>(encuentro.webex_join_url ?? '');
  const [meetingId, setMeetingId] = useState<string>(encuentro.webex_meeting_id ?? '');
  const [meetingNumber, setMeetingNumber] = useState<string>(encuentro.webex_meeting_number ?? '');
  const [password, setPassword] = useState<string>(encuentro.webex_password ?? '');
  const [duracion, setDuracion] = useState<number>(encuentro.duracion_min ?? 60);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!joinUrl.trim() || !meetingId.trim()) {
      toast.error('URL y Meeting ID son obligatorios.');
      return;
    }
    setSaving(true);
    const res = await configurarSalaWebex({
      encuentroId: encuentro.id,
      joinUrl: joinUrl.trim(),
      meetingId: meetingId.trim(),
      meetingNumber: meetingNumber.trim() || null,
      password: password.trim() || null,
      duracionMin: duracion,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Sala Webex configurada ✓');
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="font-display text-lg font-bold text-brand-ink">Configurar sala Webex</h3>
        <p className="mt-1 text-xs text-brand-muted">
          Creá la reunión en{' '}
          <a
            href="https://webex.com/meet"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-brand-cyan underline"
          >
            webex.com/meet
          </a>{' '}
          y pegá los datos abajo.
        </p>
        <div className="mt-4 space-y-3">
          <Field label="Join URL (link público)" required>
            <Input
              value={joinUrl}
              onChange={(ev) => setJoinUrl(ev.target.value)}
              placeholder="https://gestionglobal.webex.com/meet/..."
            />
          </Field>
          <Field label="Meeting ID (campo `id` de la API o slug del URL)" required>
            <Input value={meetingId} onChange={(ev) => setMeetingId(ev.target.value)} placeholder="abc123def456..." />
          </Field>
          <Field label="Meeting Number (los 9-10 dígitos visibles)">
            <Input
              value={meetingNumber}
              onChange={(ev) => setMeetingNumber(ev.target.value)}
              placeholder="123 456 7890"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Password (opcional)">
              <Input value={password} onChange={(ev) => setPassword(ev.target.value)} placeholder="••••" />
            </Field>
            <Field label="Duración (min)">
              <Input
                type="number"
                min={15}
                max={480}
                value={duracion}
                onChange={(ev) => setDuracion(Number(ev.target.value) || 60)}
              />
            </Field>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-brand-ink hover:bg-slate-50"
          >
            Cancelar
          </button>
          <Button onClick={save} loading={saving}>
            Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}
