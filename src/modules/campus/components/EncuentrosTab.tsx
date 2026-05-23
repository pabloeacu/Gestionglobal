import { useCallback, useEffect, useState } from 'react';
import {
  CalendarClock,
  ExternalLink,
  Loader2,
  Plus,
  Radio,
  Trash2,
  Video,
  VideoIcon,
} from 'lucide-react';
import { Button, Field, Input, useConfirm } from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  borrarEncuentro,
  crearEncuentro,
  crearSalaZoom,
  fmtFechaHora,
  listAsistencias,
  listEncuentros,
  listMatriculas,
  marcarAsistencia,
  type CursoDetalle,
  type CursoEncuentroRow,
  type MatriculaListItem,
} from '@/services/api/campus';

// Tab de encuentros sincrónicos: crear encuentros con sala Zoom integrada,
// asistencia automática (vía webhook) y manual (tilde override) — DGG-14.
export function EncuentrosTab({ data }: { data: CursoDetalle }) {
  const confirm = useConfirm();
  const [encuentros, setEncuentros] = useState<CursoEncuentroRow[]>([]);
  const [matriculas, setMatriculas] = useState<MatriculaListItem[]>([]);
  const [asistencias, setAsistencias] = useState<
    Record<string, Set<string>> // encuentroId -> set de matriculaId presentes
  >({});
  const [loading, setLoading] = useState(true);
  const [creandoSalaId, setCreandoSalaId] = useState<string | null>(null);

  // Form alta
  const [titulo, setTitulo] = useState('');
  const [fecha, setFecha] = useState('');
  const [duracion, setDuracion] = useState<number>(60);
  const [desc, setDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [e, m] = await Promise.all([
      listEncuentros(data.curso.id),
      listMatriculas({ cursoId: data.curso.id }),
    ]);
    if (!e.ok) {
      setLoading(false);
      toast.error(e.error.message);
      return;
    }
    setEncuentros(e.data);
    if (m.ok) setMatriculas(m.data);

    const pares = await Promise.all(
      e.data.map(async (enc) => {
        const a = await listAsistencias(enc.id);
        const set = new Set<string>(
          a.ok ? a.data.filter((x) => x.presente).map((x) => x.matricula_id) : [],
        );
        return [enc.id, set] as const;
      }),
    );
    const acc: Record<string, Set<string>> = {};
    for (const [k, v] of pares) acc[k] = v;
    setAsistencias(acc);
    setLoading(false);
  }, [data.curso.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function crear() {
    if (!titulo.trim()) {
      toast.error('Ponele un título al encuentro.');
      return;
    }
    setCreating(true);
    const res = await crearEncuentro({
      cursoId: data.curso.id,
      titulo: titulo.trim(),
      fechaHora: fecha ? new Date(fecha).toISOString() : null,
      descripcion: desc.trim() || null,
    });
    if (!res.ok) {
      setCreating(false);
      toast.error(res.error.message);
      return;
    }
    // Si pidieron duración custom, actualizamos en BD (la columna default es 60).
    // El campo duracion_min se setea al crear la sala Zoom; lo dejamos por ahora.
    setCreating(false);
    setTitulo('');
    setFecha('');
    setDuracion(60);
    setDesc('');
    toast.success('Encuentro creado');
    void load();
  }

  async function eliminar(enc: CursoEncuentroRow) {
    const ok = await confirm({
      title: 'Eliminar encuentro',
      message: `¿Eliminar "${enc.titulo}" y su registro de asistencia?`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const res = await borrarEncuentro(enc.id);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    void load();
  }

  async function crearSala(enc: CursoEncuentroRow) {
    setCreandoSalaId(enc.id);
    const res = await crearSalaZoom({
      encuentroId: enc.id,
      duracionMin: (enc as any).duracion_min ?? duracion,
    });
    setCreandoSalaId(null);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('Sala Zoom creada ✓');
    void load();
  }

  async function toggle(encuentroId: string, matriculaId: string) {
    const presente = !asistencias[encuentroId]?.has(matriculaId);
    // Optimista
    setAsistencias((prev) => {
      const next = { ...prev };
      const set = new Set(next[encuentroId] ?? []);
      if (presente) set.add(matriculaId);
      else set.delete(matriculaId);
      next[encuentroId] = set;
      return next;
    });
    const res = await marcarAsistencia({ encuentroId, matriculaId, presente });
    if (!res.ok) {
      toast.error(res.error.message);
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

  return (
    <div className="space-y-4">
      {/* Alta de encuentro */}
      <section className="card-premium p-5">
        <header className="mb-3 flex items-center gap-2">
          <CalendarClock size={16} className="text-brand-cyan" />
          <h2 className="font-display text-lg font-semibold text-brand-ink">
            Nuevo encuentro sincrónico
          </h2>
        </header>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Tema / título" required>
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Encuentro 1 · dudas normativas"
            />
          </Field>
          <Field label="Fecha y hora">
            <Input
              type="datetime-local"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </Field>
          <Field label="Duración (min)">
            <Input
              type="number"
              min={15}
              max={480}
              value={duracion}
              onChange={(e) => setDuracion(Number(e.target.value) || 60)}
            />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Descripción">
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="text-xs text-brand-muted">
            Después de crear el encuentro, generá la sala Zoom desde la fila.
          </p>
          <Button onClick={crear} loading={creating}>
            <Plus size={14} /> Agregar encuentro
          </Button>
        </div>
      </section>

      {/* Lista de encuentros con grilla de asistencia */}
      {encuentros.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-brand-muted">
          Todavía no hay encuentros sincrónicos. Creá el primero arriba.
        </div>
      ) : (
        encuentros.map((enc) => {
          const e: any = enc; // columnas nuevas tipadas vía DB types regenerados
          const tieneSala = !!e.zoom_meeting_id;
          const status = (e.zoom_status as string | undefined) ?? 'programado';
          const statusBadge =
            status === 'en_curso'
              ? { label: '● En vivo', cls: 'bg-red-100 text-red-700 border-red-200' }
              : status === 'finalizado'
                ? { label: 'Finalizado', cls: 'bg-slate-100 text-slate-700 border-slate-200' }
                : status === 'cancelado'
                  ? { label: 'Cancelado', cls: 'bg-amber-100 text-amber-700 border-amber-200' }
                  : { label: 'Programado', cls: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20' };
          return (
            <section key={enc.id} className="card-premium p-5">
              <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Video size={15} className="text-amber-600" />
                    <h3 className="font-display text-base font-semibold text-brand-ink">
                      {enc.titulo}
                    </h3>
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
                    {enc.fecha_hora ? fmtFechaHora(enc.fecha_hora) : 'Sin fecha'}
                    {e.duracion_min ? ` · ${e.duracion_min} min` : ''}
                  </p>
                  {enc.descripcion && (
                    <p className="mt-1 text-sm text-brand-muted">{enc.descripcion}</p>
                  )}

                  {/* Acciones Zoom */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {!tieneSala ? (
                      <button
                        onClick={() => void crearSala(enc)}
                        disabled={creandoSalaId === enc.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-ink px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-ink/90 disabled:opacity-60"
                      >
                        {creandoSalaId === enc.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <VideoIcon size={13} />
                        )}
                        Crear sala Zoom
                      </button>
                    ) : (
                      <>
                        {e.zoom_start_url && (
                          <a
                            href={e.zoom_start_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-cyan/90"
                          >
                            <Radio size={13} /> Iniciar como host
                          </a>
                        )}
                        {e.zoom_join_url && (
                          <a
                            href={e.zoom_join_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink shadow-sm transition hover:bg-slate-50"
                          >
                            <ExternalLink size={13} /> Link público
                          </a>
                        )}
                        <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-brand-muted">
                          ID {e.zoom_meeting_id}
                          {e.zoom_password ? ` · pwd ${e.zoom_password}` : ''}
                        </span>
                        {e.grabacion_play_url && (
                          <a
                            href={e.grabacion_play_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                          >
                            <ExternalLink size={13} /> Grabación
                          </a>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => void eliminar(enc)}
                  className="rounded-md p-2 text-brand-muted transition hover:bg-red-50 hover:text-red-600"
                  title="Eliminar encuentro"
                >
                  <Trash2 size={15} />
                </button>
              </header>

              {/* Asistencia */}
              <div className="rounded-xl border border-slate-100 bg-brand-zebra/30 p-3">
                <p className="kicker mb-2 text-brand-muted">
                  Asistencia {tieneSala && '· se completa automáticamente cuando los alumnos joineen'}
                </p>
                {matriculas.length === 0 ? (
                  <p className="text-sm text-brand-muted">
                    Asigná alumnos al curso para tomar asistencia.
                  </p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {matriculas.map((m) => {
                      const presente = asistencias[enc.id]?.has(m.id) ?? false;
                      return (
                        <li key={m.id}>
                          <button
                            onClick={() => void toggle(enc.id, m.id)}
                            className={cn(
                              'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition',
                              presente
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                : 'border-slate-200 bg-white text-brand-muted hover:bg-slate-50',
                            )}
                          >
                            <span className="truncate">
                              {m.alumno_nombre ?? 'Alumno'}
                            </span>
                            <span
                              className={cn(
                                'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                                presente
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-slate-200 text-slate-600',
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
            </section>
          );
        })
      )}
    </div>
  );
}
