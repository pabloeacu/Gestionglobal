import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Radio, Users, CheckCircle2, Clock, Copy, Loader2, Video, Youtube, MapPin, Globe } from 'lucide-react';
import { Button, Field, Input, Modal, Select, Textarea, useConfirm } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import {
  crearWebinar,
  duplicarWebinar,
  getWebinarKpis,
  listWebinars,
  type WebinarRow,
  type WebinarKpis,
} from '@/services/api/webinars';
import { cn } from '@/lib/cn';
import { FormulariosWebinarsTabs } from '../components/FormulariosWebinarsTabs';
import { humanizeError } from '@/lib/errors';

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  programado: { label: 'Programado', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  en_curso: { label: '● En vivo', cls: 'bg-red-100 text-red-700 border-red-200 animate-pulse' },
  finalizado: { label: 'Finalizado', cls: 'bg-green-100 text-green-700 border-green-200' },
  cancelado: { label: 'Cancelado', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
};

// Eventos (2026-07): modalidad + tipo son sólo etiquetas informativas.
const MODALIDAD_BADGES: Record<string, { label: string; cls: string }> = {
  online: { label: 'Online', cls: 'border-sky-200 bg-sky-50 text-sky-700' },
  presencial: { label: 'Presencial', cls: 'border-violet-200 bg-violet-50 text-violet-700' },
  mixto: { label: 'Mixto', cls: 'border-teal-200 bg-teal-50 text-teal-700' },
};
const TIPO_LABELS: Record<string, string> = {
  webinar: 'Webinar', charla: 'Charla', taller: 'Taller', jornada: 'Jornada',
  curso: 'Curso', podcast: 'Podcast', otro: 'Evento',
};

function fmtFecha(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-AR', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function WebinarsListPage() {
  const [items, setItems] = useState<WebinarRow[]>([]);
  const [kpis, setKpis] = useState<WebinarKpis>({ proximos: 0, en_vivo: 0, finalizados: 0, total_inscriptos: 0 });
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'programado' | 'en_curso' | 'finalizado' | 'cancelado'>('todos');
  const [openNuevo, setOpenNuevo] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const confirm = useConfirm();

  async function recargar() {
    setLoading(true);
    const [r1, r2] = await Promise.all([listWebinars(), getWebinarKpis()]);
    setLoading(false);
    if (r1.ok) setItems(r1.data);
    if (r2.ok) setKpis(r2.data);
  }

  useEffect(() => { void recargar(); }, []);

  async function handleDuplicate(w: WebinarRow) {
    const okc = await confirm({
      title: 'Duplicar evento',
      message:
        `Se creará una copia BORRADOR de "${w.titulo}" (descripción, fecha, disertantes, ` +
        'banner, flyer, certificado y formulario de inscripción). NO se copian la sala Zoom ' +
        'ni los inscriptos. Después la editás y la publicás.',
      confirmLabel: 'Duplicar',
    });
    if (!okc) return;
    setDuplicatingId(w.id);
    const res = await duplicarWebinar(w.id);
    setDuplicatingId(null);
    if (!res.ok) {
      toast.error('No pudimos duplicar el evento', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Evento duplicado. Abriendo la copia…');
    window.location.assign(`/gerencia/formularios/webinars/${res.data}`);
  }

  const visibles = items.filter((w) => filtroStatus === 'todos' || w.status === filtroStatus);

  return (
    <div className="space-y-6">
      <FormulariosWebinarsTabs />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">Captación de prospectos</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            Eventos
          </h1>
          <p className="mt-1 max-w-xl text-sm text-brand-muted">
            Charlas, talleres, jornadas y webinars — online, presenciales o mixtos. Inscripción pública con
            magic-link único por inscripto y captación de prospectos.
          </p>
        </div>
        <Button onClick={() => setOpenNuevo(true)}>
          <Plus size={14} /> Nuevo evento
        </Button>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Próximos" value={kpis.proximos} icon={Clock} tone="cyan" />
        <KpiCard label="En vivo" value={kpis.en_vivo} icon={Radio} tone="red" />
        <KpiCard label="Finalizados" value={kpis.finalizados} icon={CheckCircle2} tone="green" />
        <KpiCard label="Inscriptos totales" value={kpis.total_inscriptos} icon={Users} tone="navy" />
      </div>

      {/* Filtro */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <Select
          value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value as typeof filtroStatus)}
          className="max-w-xs"
        >
          <option value="todos">Todos los estados</option>
          <option value="programado">Programados</option>
          <option value="en_curso">En vivo</option>
          <option value="finalizado">Finalizados</option>
          <option value="cancelado">Cancelados</option>
        </Select>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-brand-muted">
          Cargando eventos…
        </div>
      ) : visibles.length === 0 ? (
        <IllustratedEmpty
          title="Todavía no hay eventos"
          description="Creá el primer evento (online, presencial o mixto) y compartilo desde un formulario tipo evento."
          action={<Button onClick={() => setOpenNuevo(true)}><Plus size={14} /> Nuevo evento</Button>}
        />
      ) : (
        <div className="grid gap-3">
          {visibles.map((w) => {
            const badge = STATUS_BADGES[w.status] ?? STATUS_BADGES.programado;
            const tieneZoom = !!w.zoom_meeting_id;
            const tieneYoutube = !!w.youtube_live_url;
            return (
              <Link
                key={w.id}
                to={`/gerencia/formularios/webinars/${w.id}`}
                className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-cyan/40 hover:shadow-md"
              >
                <TrianglesAccent position="top-right" density="soft" className="opacity-30 group-hover:opacity-60" />
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-lg font-bold text-brand-ink">{w.titulo}</h3>
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider', badge?.cls ?? '')}>
                        {badge?.label ?? w.status}
                      </span>
                      {/* F6 (DGG-63) · estado de publicación (vivo para inscripción) */}
                      <span className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                        w.publicado
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-slate-50 text-slate-500',
                      )}>
                        {w.publicado ? 'Publicado' : 'Borrador'}
                      </span>
                      {/* Eventos: modalidad + tipo */}
                      <span className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                        (MODALIDAD_BADGES[w.modalidad ?? 'online'] ?? MODALIDAD_BADGES.online)!.cls,
                      )}>
                        {w.modalidad === 'presencial' ? <MapPin size={10} /> : <Globe size={10} />}
                        {(MODALIDAD_BADGES[w.modalidad ?? 'online'] ?? MODALIDAD_BADGES.online)!.label}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                        {TIPO_LABELS[w.tipo ?? 'webinar'] ?? 'Evento'}
                      </span>
                    </div>
                    {w.descripcion && (
                      <p className="mt-1 line-clamp-2 text-sm text-brand-muted">{w.descripcion}</p>
                    )}
                    <p className="mt-2 text-xs text-brand-muted">
                      <Clock size={11} className="inline" /> {fmtFecha(w.fecha_hora)} · {w.duracion_min} min
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 text-xs">
                    <button
                      type="button"
                      disabled={duplicatingId === w.id}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (duplicatingId !== w.id) void handleDuplicate(w);
                      }}
                      title="Duplicar evento (copia borrador, sin inscriptos)"
                      aria-label="Duplicar evento"
                      className="relative z-10 inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-brand-ink shadow-sm ring-1 ring-slate-200 transition hover:text-brand-cyan disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {duplicatingId === w.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Copy size={12} />
                      )}
                      {duplicatingId === w.id ? 'Duplicando…' : 'Duplicar'}
                    </button>
                    {w.modalidad !== 'online' && (w.ubicacion_lugar || w.ubicacion_localidad) && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">
                        <MapPin size={11} /> {w.ubicacion_lugar || w.ubicacion_localidad}
                      </span>
                    )}
                    {w.modalidad !== 'presencial' && tieneZoom && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                        <Video size={11} /> Zoom (cupo {w.cupo_zoom ?? '∞'})
                      </span>
                    )}
                    {w.modalidad !== 'presencial' && tieneYoutube && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-red-700">
                        <Youtube size={11} /> YouTube Live
                      </span>
                    )}
                    {/* Aviso de config incompleta según modalidad */}
                    {w.modalidad !== 'presencial' && !tieneZoom && !tieneYoutube && (
                      <span className="text-amber-700">⚠ Falta canal online</span>
                    )}
                    {w.modalidad !== 'online' && !w.ubicacion_direccion && (
                      <span className="text-amber-700">⚠ Falta la dirección</span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {openNuevo && (
        <NuevoWebinarModal
          onClose={() => setOpenNuevo(false)}
          onCreated={() => { setOpenNuevo(false); void recargar(); }}
        />
      )}
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof Clock; tone: 'cyan' | 'red' | 'green' | 'navy' }) {
  const tones: Record<string, string> = {
    cyan: 'bg-brand-cyan/5 text-brand-cyan ring-brand-cyan/20',
    red: 'bg-red-50 text-red-700 ring-red-100',
    green: 'bg-green-50 text-green-700 ring-green-100',
    navy: 'bg-slate-50 text-slate-700 ring-slate-100',
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className={cn('grid h-9 w-9 place-items-center rounded-full ring-1', tones[tone])}>
          <Icon size={16} />
        </div>
        <p className="text-xs uppercase tracking-wider text-brand-muted">{label}</p>
      </div>
      <p className="mt-2 font-display text-2xl font-bold text-brand-ink">{value}</p>
    </div>
  );
}

function NuevoWebinarModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('19:00');
  const [duracion, setDuracion] = useState(60);
  const [cupoZoom, setCupoZoom] = useState(100);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [modalidad, setModalidad] = useState<'online' | 'presencial' | 'mixto'>('online');
  const [tipo, setTipo] = useState('webinar');
  const [creating, setCreating] = useState(false);
  const esOnline = modalidad !== 'presencial'; // online o mixto tienen canal online

  async function crear() {
    if (!titulo.trim()) {
      toast.error('Falta el título');
      return;
    }
    if (!fecha) {
      toast.error('Falta la fecha');
      return;
    }
    const fechaHora = new Date(`${fecha}T${hora}:00`).toISOString();
    setCreating(true);
    const res = await crearWebinar({
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      fechaHora,
      duracionMin: duracion,
      cupoZoom: esOnline && cupoZoom > 0 ? cupoZoom : null,
      youtubeLiveUrl: esOnline ? youtubeUrl.trim() || null : null,
      modalidad,
      tipo: tipo as never,
    });
    setCreating(false);
    if (!res.ok) {
      toast.error('No pudimos crear el evento', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Evento creado');
    onCreated();
  }

  return (
    <Modal open onClose={onClose} title="Nuevo evento" width={520}>
      <div className="space-y-3">
        <Field label="Título" required>
          <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej. Cómo cumplir con la DDJJ 2026" />
        </Field>
        <Field label="Descripción">
          <Textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3} placeholder="Resumen del contenido del evento" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Modalidad" required>
            <Select value={modalidad} onChange={(e) => setModalidad(e.target.value as typeof modalidad)}>
              <option value="online">Online (Zoom / YouTube)</option>
              <option value="presencial">Presencial (lugar físico)</option>
              <option value="mixto">Mixto (el inscripto elige)</option>
            </Select>
          </Field>
          <Field label="Tipo">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="webinar">Webinar</option>
              <option value="charla">Charla</option>
              <option value="taller">Taller</option>
              <option value="jornada">Jornada</option>
              <option value="curso">Curso</option>
              <option value="podcast">Podcast</option>
              <option value="otro">Otro</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha" required>
            <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Field>
          <Field label="Hora">
            <Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
          </Field>
        </div>
        <Field label="Duración (min)">
          <Input type="number" value={duracion} onChange={(e) => setDuracion(Number(e.target.value))} min={15} max={600} step={15} />
        </Field>
        {esOnline && (
          <>
            <Field label="Cupo Zoom" hint="100 en plan Free">
              <Input type="number" value={cupoZoom} onChange={(e) => setCupoZoom(Number(e.target.value))} min={0} max={1000} />
            </Field>
            <Field label="URL de YouTube Live (fallback opcional)" hint="Cuando el cupo de Zoom se llena, los nuevos inscriptos van a YouTube">
              <Input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://www.youtube.com/live/..." />
            </Field>
          </>
        )}
        {modalidad !== 'online' && (
          <p className="rounded-lg border border-violet-200 bg-violet-50 p-2.5 text-xs text-violet-700">
            <MapPin size={12} className="mr-1 inline" />
            El lugar, la dirección y el cupo presencial se cargan en el detalle del evento, después de crearlo.
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={crear} loading={creating}>Crear evento</Button>
        </div>
      </div>
    </Modal>
  );
}
