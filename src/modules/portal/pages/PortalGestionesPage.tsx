// PortalGestionesPage · "Mis gestiones" del cliente. Lista de trámites
// del administrador con filtro abiertos/todos + estado visual.
//
// Citas: regla 4 (queries en services/), regla 13 (sin window.confirm).

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  CircleDot,
  XCircle,
  PlusCircle,
  ArrowRight,
  ChevronRight,
  X as XIcon,
  Calendar,
  Tag,
} from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { Skeleton } from '@/components/common';
import { toast } from '@/lib/toast';
import {
  fetchClienteTramites,
  fetchClienteTrackingLineas,
  marcarTrackingAvanceLeido,
  type ClienteTramite,
  type ClienteTrackingLinea,
} from '@/services/api/portal-dashboard';

export function PortalGestionesPage() {
  const [items, setItems] = useState<ClienteTramite[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'abiertos' | 'todos'>('abiertos');
  const [selected, setSelected] = useState<ClienteTramite | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetchClienteTramites(filter === 'abiertos');
    setLoading(false);
    if (!res.ok) {
      toast.error('No pudimos cargar tus gestiones', { description: res.error.message });
      return;
    }
    setItems(res.data);
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [filter]);

  // Cuando el cliente abre el detalle de un tramite, marcamos como leídos
  // los tracking_avance asociados → desaparece el badge del dashboard.
  useEffect(() => {
    if (selected?.id) void marcarTrackingAvanceLeido(selected.id);
  }, [selected]);

  const stats = useMemo(() => ({
    abiertos: items.filter((t) => ['abierto','en_progreso','esperando_cliente'].includes(t.estado)).length,
    esperando: items.filter((t) => t.estado === 'esperando_cliente').length,
    resueltos: items.filter((t) => t.estado === 'resuelto').length,
  }), [items]);

  return (
    <div className="relative space-y-5 pb-12">
      <TrianglesAccent position="top-right" size={180} tone="cyan" density="soft" className="opacity-30" />

      {/* Header */}
      <section className="card-premium relative overflow-hidden">
        <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
          <div>
            <p className="kicker text-brand-cyan">PORTAL · OPERACIÓN</p>
            <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
              Mis gestiones
            </h1>
            <p className="mt-1 max-w-xl text-sm text-brand-muted">
              Acá ves el estado de todos los trámites que Gestión Global está procesando para vos.
            </p>
          </div>
          <Link
            to="/portal/nuevo"
            className="inline-flex items-center gap-2 self-start rounded-xl bg-brand-cyan px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-cyan/90 sm:self-end"
          >
            <PlusCircle size={15} /> Nueva solicitud
          </Link>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatBox label="Abiertos" value={stats.abiertos} tone="cyan" icon={CircleDot} />
        <StatBox label="Esperan acción tuya" value={stats.esperando} tone="amber" icon={AlertCircle} />
        <StatBox label="Resueltos" value={stats.resueltos} tone="emerald" icon={CheckCircle2} />
      </section>

      {/* Tabs */}
      <section className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1">
        {(['abiertos','todos'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`flex-1 rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
              filter === f
                ? 'bg-brand-cyan-pale/80 text-brand-cyan'
                : 'text-brand-muted hover:text-brand-ink'
            }`}
          >
            {f === 'abiertos' ? 'Activos' : 'Todo el historial'}
          </button>
        ))}
      </section>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[0,1,2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
      ) : items.length === 0 ? (
        <IllustratedEmpty
          illustration="lista"
          title={filter === 'abiertos' ? 'Sin gestiones activas' : 'Sin gestiones registradas'}
          description={filter === 'abiertos'
            ? 'Cuando inicies un trámite o nos lo derives, lo verás acá.'
            : 'Todavía no hay registros de gestiones.'}
          action={
            <Link to="/portal/nuevo" className="inline-flex items-center gap-2 rounded-xl bg-brand-cyan px-4 py-2 text-sm font-semibold text-white">
              <PlusCircle size={15} /> Solicitar nuevo servicio
            </Link>
          }
        />
      ) : (
        <ul className="space-y-2">
          {items.map((t) => (
            <li key={t.id}>
              <TramiteCard t={t} onOpen={setSelected} />
            </li>
          ))}
        </ul>
      )}

      <TramiteDetalleModal tramite={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

// =========================================================================
// Modal de detalle (read-only para el cliente)
// =========================================================================
function TramiteDetalleModal({ tramite, onClose }: { tramite: ClienteTramite | null; onClose: () => void }) {
  const [lineas, setLineas] = useState<ClienteTrackingLinea[]>([]);
  const [loadingLineas, setLoadingLineas] = useState(false);

  useEffect(() => {
    if (!tramite) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onEsc); };
  }, [tramite, onClose]);

  // Cargar timeline de líneas visibles al cliente al abrir
  useEffect(() => {
    if (!tramite?.id) {
      setLineas([]);
      return;
    }
    let cancel = false;
    setLoadingLineas(true);
    void fetchClienteTrackingLineas(tramite.id).then((data) => {
      if (cancel) return;
      setLineas(data);
      setLoadingLineas(false);
    });
    return () => { cancel = true; };
  }, [tramite?.id]);

  if (!tramite) return null;
  const estadoInfo = ESTADOS[tramite.estado] ?? { label: tramite.estado, tone: 'slate' as const, icon: FileText };

  return (
    <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center px-3 sm:px-4 py-4 sm:py-6">
      <div className="absolute inset-0 bg-brand-ink/50 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col rounded-3xl bg-white shadow-2xl motion-safe:animate-fade-up">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/80 text-brand-muted hover:bg-white hover:text-brand-ink"
          aria-label="Cerrar"
        >
          <XIcon size={14} />
        </button>

        {/* Header con datos del tramite (sticky para que se vea al scrollear) */}
        <div className="border-b border-slate-100 p-6 sm:p-7">
          <div className="flex items-center gap-3">
            <span className={`grid h-12 w-12 place-items-center rounded-2xl ${TONES[estadoInfo.tone]}`}>
              <estadoInfo.icon size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="kicker text-brand-cyan">GESTIÓN · {tramite.codigo}</p>
              <h2 className="mt-1 font-display text-lg font-bold leading-tight text-brand-ink sm:text-xl">
                {tramite.titulo}
              </h2>
            </div>
            <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${TONE_BADGE[estadoInfo.tone]}`}>
              {estadoInfo.label}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <DataChip icon={Tag} label="Categoría" value={labelCategoria(tramite.categoria)} />
            <DataChip icon={CircleDot} label="Prioridad" value={capitalize(tramite.prioridad)} />
            <DataChip icon={Calendar} label="Iniciado" value={formatFechaCorta(tramite.created_at)} />
            <DataChip icon={Clock} label="Actividad" value={formatActividad(tramite.horas_desde_actividad)} />
          </div>
        </div>

        {/* Timeline scrolleable */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-7">
          <h3 className="font-display text-base font-bold text-brand-ink">Avances</h3>
          <p className="mt-0.5 text-xs text-brand-muted">
            Cada actualización de tu gestión, en orden cronológico.
          </p>

          {loadingLineas ? (
            <div className="mt-5 space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </div>
          ) : lineas.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 p-6 text-center">
              <Clock size={20} className="mx-auto text-slate-400" />
              <p className="mt-2 text-sm font-semibold text-brand-ink">Todavía no hay avances</p>
              <p className="mt-1 text-xs text-brand-muted">
                Cuando el equipo registre una novedad visible para vos, aparecerá acá.
              </p>
            </div>
          ) : (
            <ol className="mt-5 space-y-0">
              {lineas.map((linea, idx) => (
                <TimelineItem
                  key={linea.id}
                  linea={linea}
                  isLast={idx === lineas.length - 1}
                  isFirst={idx === 0}
                />
              ))}
            </ol>
          )}
        </div>

        {/* Footer con contacto */}
        <div className="border-t border-slate-100 bg-slate-50/40 px-6 py-4 sm:px-7">
          <p className="text-xs text-brand-muted">
            ¿Necesitás aclarar algo? Escribinos a{' '}
            <a href="mailto:contacto@gestionglobal.ar" className="font-semibold text-brand-cyan">
              contacto@gestionglobal.ar
            </a>{' '}
            citando el código <span className="font-mono">{tramite.codigo}</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// Componentes del timeline visual de avances
// =========================================================================

function DataChip({ icon: Icon, label, value }: { icon: typeof FileText; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/50 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-brand-muted">
        <Icon size={10} />
        {label}
      </div>
      <p className="mt-0.5 truncate text-xs font-semibold text-brand-ink" title={value}>
        {value}
      </p>
    </div>
  );
}

const CATEGORIA_TONE: Record<string, { bg: string; text: string; line: string }> = {
  emerald: { bg: 'bg-emerald-100', text: 'text-emerald-700', line: 'bg-emerald-200' },
  amber:   { bg: 'bg-amber-100',   text: 'text-amber-700',   line: 'bg-amber-200' },
  cyan:    { bg: 'bg-cyan-100',    text: 'text-cyan-700',    line: 'bg-cyan-200' },
  red:     { bg: 'bg-rose-100',    text: 'text-rose-700',    line: 'bg-rose-200' },
  slate:   { bg: 'bg-slate-100',   text: 'text-slate-700',   line: 'bg-slate-200' },
};

function TimelineItem({ linea, isLast, isFirst }: { linea: ClienteTrackingLinea; isLast: boolean; isFirst: boolean }) {
  const tone = CATEGORIA_TONE[linea.categoria_color] ?? CATEGORIA_TONE.slate!;
  return (
    <li className="relative flex gap-4 pb-6 last:pb-0">
      {/* Línea vertical conectora */}
      {!isLast && (
        <span
          aria-hidden
          className={`absolute left-[15px] top-8 h-full w-0.5 ${tone.line}`}
        />
      )}

      {/* Dot de la categoría */}
      <span
        className={`relative z-10 grid h-8 w-8 flex-shrink-0 place-items-center rounded-full ring-4 ring-white ${tone.bg} ${tone.text}`}
      >
        <CircleDot size={14} />
      </span>

      {/* Card del avance */}
      <div className={`flex-1 rounded-2xl border p-4 transition ${isFirst ? 'border-brand-cyan/40 bg-brand-cyan-pale/15 shadow-sm ring-1 ring-brand-cyan/20' : 'border-slate-200 bg-white'}`}>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone.bg} ${tone.text}`}>
            {linea.categoria_label}
          </span>
          {isFirst && (
            <span className="inline-flex items-center rounded-full bg-brand-cyan px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              ÚLTIMO
            </span>
          )}
          <time className="ml-auto text-[11px] text-brand-muted">
            {formatTimeAgo(linea.created_at)}
          </time>
        </div>

        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-brand-ink">
          {linea.descripcion}
        </p>

        {linea.archivos_urls.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {linea.archivos_urls.map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-brand-cyan transition hover:border-brand-cyan/40 hover:bg-brand-cyan-pale/20"
              >
                📎 Adjunto {i + 1}
              </a>
            ))}
          </div>
        )}

        <p className="mt-3 text-[10px] text-brand-muted">
          Por {linea.autor_nombre} · {formatFechaCorta(linea.created_at)}
        </p>
      </div>
    </li>
  );
}

function formatTimeAgo(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const mins = Math.floor((now - t) / 60000);
  if (mins < 1) return 'recién';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}

function formatFechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

// =========================================================================

function StatBox({ label, value, tone, icon: Icon }: {
  label: string;
  value: number;
  tone: 'cyan' | 'amber' | 'emerald';
  icon: typeof CircleDot;
}) {
  const toneCls = {
    cyan: 'text-brand-cyan bg-brand-cyan-pale/40',
    amber: 'text-amber-700 bg-amber-50',
    emerald: 'text-emerald-700 bg-emerald-50',
  }[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className={`inline-grid h-8 w-8 place-items-center rounded-lg ${toneCls}`}>
        <Icon size={14} />
      </div>
      <p className="mt-2 font-display text-2xl font-bold tabular text-brand-ink leading-none">{value}</p>
      <p className="mt-1 text-[11px] text-brand-muted">{label}</p>
    </div>
  );
}

function TramiteCard({ t, onOpen }: { t: ClienteTramite; onOpen: (t: ClienteTramite) => void }) {
  const estadoInfo = ESTADOS[t.estado] ?? { label: t.estado, tone: 'slate' as const, icon: FileText };
  const isReadOnly = ['resuelto','cerrado','cancelado'].includes(t.estado);
  return (
    <button
      type="button"
      onClick={() => onOpen(t)}
      className={`group w-full text-left rounded-2xl border bg-white p-4 transition hover:border-brand-cyan hover:shadow-md ${isReadOnly ? 'border-slate-200 opacity-90' : 'border-slate-200'}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-start gap-3 sm:flex-1">
          <span className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl ${TONES[estadoInfo.tone]}`}>
            <estadoInfo.icon size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-semibold text-brand-ink">{t.titulo}</p>
              <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${TONE_BADGE[estadoInfo.tone]}`}>
                {estadoInfo.label}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-brand-muted">
              <span className="font-mono">{t.codigo}</span>
              {' · '}
              {labelCategoria(t.categoria)}
              {t.total_comentarios > 0 && ` · ${t.total_comentarios} comentario${t.total_comentarios > 1 ? 's' : ''}`}
            </p>
            <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-brand-muted">
              <Clock size={10} /> {formatActividad(t.horas_desde_actividad)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 self-end text-sm font-semibold text-brand-cyan transition group-hover:gap-1.5 sm:self-center">
          <span className="hidden sm:inline">{isReadOnly ? 'Ver' : 'Detalle'}</span>
          <ChevronRight size={14} />
        </div>
      </div>
    </button>
  );
}

// =========================================================================
// Diccionarios visuales
// =========================================================================
type Tone = 'cyan' | 'amber' | 'emerald' | 'rose' | 'slate';

const TONES: Record<Tone, string> = {
  cyan: 'bg-brand-cyan-pale/60 text-brand-cyan',
  amber: 'bg-amber-50 text-amber-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  rose: 'bg-rose-50 text-rose-700',
  slate: 'bg-slate-100 text-slate-600',
};

const TONE_BADGE: Record<Tone, string> = {
  cyan: 'bg-brand-cyan-pale text-brand-cyan ring-1 ring-inset ring-brand-cyan/30',
  amber: 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300',
  emerald: 'bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-300',
  rose: 'bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-300',
  slate: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-300',
};

const ESTADOS: Record<string, { label: string; tone: Tone; icon: typeof FileText }> = {
  abierto:           { label: 'Abierto', tone: 'cyan', icon: CircleDot },
  en_progreso:       { label: 'En curso', tone: 'cyan', icon: ArrowRight },
  esperando_cliente: { label: 'Tu acción', tone: 'amber', icon: AlertCircle },
  resuelto:          { label: 'Resuelto', tone: 'emerald', icon: CheckCircle2 },
  cerrado:           { label: 'Cerrado', tone: 'slate', icon: CheckCircle2 },
  cancelado:         { label: 'Cancelado', tone: 'rose', icon: XCircle },
};

function labelCategoria(c: string): string {
  const map: Record<string, string> = {
    matricula: 'Matrícula',
    dj: 'Declaración jurada',
    consulta_juridica: 'Consulta jurídica',
    renovacion: 'Renovación',
    curso: 'Curso',
    reclamo: 'Reclamo',
    otro: 'Otro',
  };
  return map[c] ?? c;
}

function formatActividad(horas: number | null): string {
  if (horas == null || !isFinite(horas)) return 'Sin actividad reciente';
  if (horas < 1) return 'Actualizado hace minutos';
  if (horas < 24) return `Actualizado hace ${Math.round(horas)} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? 'Actualizado ayer' : `Actualizado hace ${dias} días`;
}
