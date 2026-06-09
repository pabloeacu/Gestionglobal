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
  configurarSalaWebex,
  crearEncuentro,
  crearSalaZoom,
  eliminarSalaZoom,
  fmtFechaHora,
  listAsistencias,
  listEncuentros,
  listMatriculas,
  marcarAsistencia,
  type CursoDetalle,
  type CursoEncuentroRow,
  type MatriculaListItem,
} from '@/services/api/campus';
import { humanizeError } from '@/lib/errors';

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
  const [plataforma, setPlataforma] = useState<'zoom' | 'webex'>('zoom');
  const [creating, setCreating] = useState(false);

  // Webex manual setup modal
  const [webexModalEnc, setWebexModalEnc] = useState<CursoEncuentroRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [e, m] = await Promise.all([
      listEncuentros(data.curso.id),
      listMatriculas({ cursoId: data.curso.id }),
    ]);
    if (!e.ok) {
      setLoading(false);
      toast.error(humanizeError(e.error));
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
    // Fecha/hora OBLIGATORIA (F9-ter · Lista JL): el acceso del alumno se
    // condiciona a ese día/horario (botón habilitado recién 10 min antes), así
    // que un encuentro sin fecha no tiene sentido para el alumno.
    if (!fecha) {
      toast.error('Poné la fecha y hora del encuentro. El alumno accede recién 10 min antes del horario.');
      return;
    }
    setCreating(true);
    const res = await crearEncuentro({
      cursoId: data.curso.id,
      titulo: titulo.trim(),
      fechaHora: new Date(fecha).toISOString(),
      descripcion: desc.trim() || null,
      plataforma,
    });
    if (!res.ok) {
      setCreating(false);
      toast.error(humanizeError(res.error));
      return;
    }
    // Si pidieron duración custom, actualizamos en BD (la columna default es 60).
    // El campo duracion_min se setea al crear la sala Zoom; lo dejamos por ahora.
    setCreating(false);
    setTitulo('');
    setFecha('');
    setDuracion(60);
    setDesc('');
    setPlataforma('zoom');
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
    // Si tiene sala Zoom, intentamos borrarla PRIMERO para no dejarla huérfana
    // en la cuenta Zoom (F9-bis · Lista JL). Best-effort: si Zoom rechaza el
    // borrado (típico: falta el scope `meeting:delete:meeting:admin` en la app
    // de Zoom), NO bloqueamos el borrado del encuentro — avisamos y seguimos.
    if ((enc as any).zoom_meeting_id) {
      const del = await eliminarSalaZoom({ encuentroId: enc.id });
      if (!del.ok) {
        toast.warning(humanizeError(del.error), {
          description: 'La reunión queda en tu cuenta de Zoom; podés borrarla a mano desde el portal.',
        });
      }
    }
    const res = await borrarEncuentro(enc.id);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    void load();
  }

  async function eliminarSala(enc: CursoEncuentroRow) {
    const ok = await confirm({
      title: 'Eliminar sala Zoom',
      message: `¿Eliminar la reunión Zoom de "${enc.titulo}"? El link actual deja de funcionar. Después podés volver a crear la sala.`,
      confirmLabel: 'Eliminar sala',
      danger: true,
    });
    if (!ok) return;
    setCreandoSalaId(enc.id);
    const res = await eliminarSalaZoom({ encuentroId: enc.id });
    setCreandoSalaId(null);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Sala Zoom eliminada');
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
      toast.error(humanizeError(res.error));
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
          <Field label="Fecha y hora" required>
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

        {/* DGG-19 · Selector de plataforma */}
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand-cyan">
            Plataforma
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition',
                plataforma === 'zoom'
                  ? 'border-brand-cyan bg-brand-cyan/5 ring-1 ring-brand-cyan'
                  : 'border-slate-200 hover:bg-slate-50',
              )}
            >
              <input
                type="radio"
                checked={plataforma === 'zoom'}
                onChange={() => setPlataforma('zoom')}
                className="mt-0.5 accent-brand-cyan"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-brand-ink">Zoom (link externo)</p>
                <p className="mt-0.5 text-[11px] text-brand-muted">
                  Alumnos entran a Zoom oficial. Todas las funciones: share screen, polls, breakouts. Asistencia automática.
                </p>
              </div>
            </label>
            <label
              className={cn(
                'relative flex items-start gap-3 rounded-xl border p-3 transition',
                'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60',
              )}
              title="Webex embebido requiere plan pagado (Guest Issuer deprecado · Service App + Instant Connect requieren suscripción). Scaffold listo para activar al upgrade."
            >
              <input
                type="radio"
                disabled
                checked={false}
                className="mt-0.5 accent-brand-cyan"
                readOnly
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold text-brand-ink">Webex (embebido)</p>
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
                    Plan pagado
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-brand-muted">
                  Embed dentro del campus, mic/cam/share/gallery. Requiere suscripción Webex (no Free). Scaffold listo.
                </p>
              </div>
            </label>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="text-xs text-brand-muted">
            {plataforma === 'zoom'
              ? 'Después de crear el encuentro, generá la sala Zoom desde la fila.'
              : 'Después de crear el encuentro, cargá los datos de la sala Webex (URL + ID).'}
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
          const encPlataforma = (e.plataforma as 'zoom' | 'webex' | undefined) ?? 'zoom';
          const isWebex = encPlataforma === 'webex';
          const tieneSala = isWebex ? !!e.webex_meeting_id : !!e.zoom_meeting_id;
          const status = (isWebex ? e.webex_status : e.zoom_status) as string | undefined ?? 'programado';
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

                  {/* Acciones · indicador de plataforma + setup según tipo */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
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
                    )}
                    {!tieneSala && isWebex && (
                      <button
                        onClick={() => setWebexModalEnc(enc)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-ink px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-ink/90"
                      >
                        <VideoIcon size={13} /> Configurar sala Webex
                      </button>
                    )}
                    {tieneSala && isWebex && (
                      <>
                        <a
                          href={e.webex_join_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-cyan/90"
                        >
                          <Radio size={13} /> Iniciar como host
                        </a>
                        <button
                          onClick={() => setWebexModalEnc(enc)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink shadow-sm transition hover:bg-slate-50"
                        >
                          Editar datos Webex
                        </button>
                        <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-brand-muted">
                          ID {e.webex_meeting_number || e.webex_meeting_id}
                        </span>
                      </>
                    )}
                    {tieneSala && !isWebex && (
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
                        <button
                          onClick={() => void eliminarSala(enc)}
                          disabled={creandoSalaId === enc.id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 shadow-sm transition hover:bg-red-50 disabled:opacity-60"
                          title="Eliminar la sala Zoom (después podés volver a crearla)"
                        >
                          {creandoSalaId === enc.id ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Trash2 size={13} />
                          )}
                          Eliminar sala
                        </button>
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

      {/* Webex setup modal · gerente pega URL + ID + password */}
      {webexModalEnc && (
        <WebexSetupModal
          encuentro={webexModalEnc}
          onClose={() => setWebexModalEnc(null)}
          onSaved={() => {
            setWebexModalEnc(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function WebexSetupModal({
  encuentro,
  onClose,
  onSaved,
}: {
  encuentro: CursoEncuentroRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const e: any = encuentro;
  const [joinUrl, setJoinUrl] = useState<string>(e.webex_join_url ?? '');
  const [meetingId, setMeetingId] = useState<string>(e.webex_meeting_id ?? '');
  const [meetingNumber, setMeetingNumber] = useState<string>(e.webex_meeting_number ?? '');
  const [password, setPassword] = useState<string>(e.webex_password ?? '');
  const [duracion, setDuracion] = useState<number>(e.duracion_min ?? 60);
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
        <h3 className="font-display text-lg font-bold text-brand-ink">
          Configurar sala Webex
        </h3>
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
          y pegá los datos abajo. Los alumnos verán el embed dentro del campus.
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
            <Input
              value={meetingId}
              onChange={(ev) => setMeetingId(ev.target.value)}
              placeholder="abc123def456..."
            />
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
              <Input
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                placeholder="••••"
              />
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
