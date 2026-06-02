import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Radio, Users, CheckCircle2, Clock, Video, Youtube } from 'lucide-react';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import {
  crearWebinar,
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

  async function recargar() {
    setLoading(true);
    const [r1, r2] = await Promise.all([listWebinars(), getWebinarKpis()]);
    setLoading(false);
    if (r1.ok) setItems(r1.data);
    if (r2.ok) setKpis(r2.data);
  }

  useEffect(() => { void recargar(); }, []);

  const visibles = items.filter((w) => filtroStatus === 'todos' || w.status === filtroStatus);

  return (
    <div className="space-y-6">
      <FormulariosWebinarsTabs />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">Captación de prospectos</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            Webinars
          </h1>
          <p className="mt-1 max-w-xl text-sm text-brand-muted">
            Sesiones públicas con magic-link único por inscripto. Zoom (cupo) + YouTube Live (fallback).
            Asistencia automática vía webhook.
          </p>
        </div>
        <Button onClick={() => setOpenNuevo(true)}>
          <Plus size={14} /> Nuevo webinar
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
          Cargando webinars…
        </div>
      ) : visibles.length === 0 ? (
        <IllustratedEmpty
          title="Todavía no hay webinars"
          description="Creá el primer webinar y compartilo desde un formulario tipo evento."
          action={<Button onClick={() => setOpenNuevo(true)}><Plus size={14} /> Nuevo webinar</Button>}
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
                    </div>
                    {w.descripcion && (
                      <p className="mt-1 line-clamp-2 text-sm text-brand-muted">{w.descripcion}</p>
                    )}
                    <p className="mt-2 text-xs text-brand-muted">
                      <Clock size={11} className="inline" /> {fmtFecha(w.fecha_hora)} · {w.duracion_min} min
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 text-xs">
                    {tieneZoom && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                        <Video size={11} /> Zoom (cupo {w.cupo_zoom ?? '∞'})
                      </span>
                    )}
                    {tieneYoutube && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-red-700">
                        <Youtube size={11} /> YouTube Live
                      </span>
                    )}
                    {!tieneZoom && !tieneYoutube && (
                      <span className="text-amber-700">
                        ⚠ Sin canales configurados
                      </span>
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
  const [creating, setCreating] = useState(false);

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
      cupoZoom: cupoZoom > 0 ? cupoZoom : null,
      youtubeLiveUrl: youtubeUrl.trim() || null,
    });
    setCreating(false);
    if (!res.ok) {
      toast.error('No pudimos crear el webinar', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Webinar creado');
    onCreated();
  }

  return (
    <Modal open onClose={onClose} title="Nuevo webinar" width={520}>
      <div className="space-y-3">
        <Field label="Título" required>
          <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej. Cómo cumplir con la DDJJ 2026" />
        </Field>
        <Field label="Descripción">
          <Textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3} placeholder="Resumen del contenido del webinar" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha" required>
            <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Field>
          <Field label="Hora">
            <Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duración (min)">
            <Input type="number" value={duracion} onChange={(e) => setDuracion(Number(e.target.value))} min={15} max={600} step={15} />
          </Field>
          <Field label="Cupo Zoom" hint="100 en plan Free">
            <Input type="number" value={cupoZoom} onChange={(e) => setCupoZoom(Number(e.target.value))} min={0} max={1000} />
          </Field>
        </div>
        <Field label="URL de YouTube Live (fallback opcional)" hint="Cuando el cupo de Zoom se llena, los nuevos inscriptos van a YouTube">
          <Input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://www.youtube.com/live/..." />
        </Field>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={crear} loading={creating}>Crear webinar</Button>
        </div>
      </div>
    </Modal>
  );
}
