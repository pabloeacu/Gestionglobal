import { useCallback, useEffect, useState } from 'react';
import {
  CalendarClock,
  Loader2,
  Plus,
  Trash2,
  Video,
} from 'lucide-react';
import { Button, Field, Input, useConfirm } from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  borrarEncuentro,
  crearEncuentro,
  fmtFechaHora,
  listAsistencias,
  listEncuentros,
  listMatriculas,
  marcarAsistencia,
  type CursoDetalle,
  type CursoEncuentroRow,
  type MatriculaListItem,
} from '@/services/api/campus';

// Tab de encuentros sincrónicos: crear encuentros (fecha, Zoom, tema) + grilla
// de asistencia por alumno tildable (DGG-10bis).
export function EncuentrosTab({ data }: { data: CursoDetalle }) {
  const confirm = useConfirm();
  const [encuentros, setEncuentros] = useState<CursoEncuentroRow[]>([]);
  const [matriculas, setMatriculas] = useState<MatriculaListItem[]>([]);
  const [asistencias, setAsistencias] = useState<
    Record<string, Set<string>> // encuentroId -> set de matriculaId presentes
  >({});
  const [loading, setLoading] = useState(true);

  // Form alta
  const [titulo, setTitulo] = useState('');
  const [fecha, setFecha] = useState('');
  const [zoom, setZoom] = useState('');
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
      linkZoom: zoom.trim() || null,
      descripcion: desc.trim() || null,
    });
    setCreating(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    setTitulo('');
    setFecha('');
    setZoom('');
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
        <div className="grid gap-3 sm:grid-cols-2">
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
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Link de Zoom">
            <Input
              value={zoom}
              onChange={(e) => setZoom(e.target.value)}
              placeholder="https://zoom.us/j/…"
            />
          </Field>
          <Field label="Descripción">
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
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
        encuentros.map((enc) => (
          <section key={enc.id} className="card-premium p-5">
            <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <Video size={15} className="text-amber-600" />
                  <h3 className="font-display text-base font-semibold text-brand-ink">
                    {enc.titulo}
                  </h3>
                </div>
                <p className="mt-0.5 text-xs text-brand-muted">
                  {enc.fecha_hora ? fmtFechaHora(enc.fecha_hora) : 'Sin fecha'}
                  {enc.link_zoom && (
                    <>
                      {' · '}
                      <a
                        href={enc.link_zoom}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-brand-cyan hover:underline"
                      >
                        Link Zoom
                      </a>
                    </>
                  )}
                </p>
                {enc.descripcion && (
                  <p className="mt-1 text-sm text-brand-muted">{enc.descripcion}</p>
                )}
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
              <p className="kicker mb-2 text-brand-muted">Asistencia</p>
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
        ))
      )}
    </div>
  );
}
