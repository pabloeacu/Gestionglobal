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
import { fetchClienteTramites, type ClienteTramite } from '@/services/api/portal-dashboard';

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
  useEffect(() => {
    if (!tramite) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onEsc); };
  }, [tramite, onClose]);

  if (!tramite) return null;
  const estadoInfo = ESTADOS[tramite.estado] ?? { label: tramite.estado, tone: 'slate' as const, icon: FileText };

  return (
    <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center px-3 sm:px-4 py-4 sm:py-6">
      <div className="absolute inset-0 bg-brand-ink/50 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl motion-safe:animate-fade-up">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/80 text-brand-muted hover:bg-white hover:text-brand-ink"
          aria-label="Cerrar"
        >
          <XIcon size={14} />
        </button>

        <div className="p-6 sm:p-7">
          <div className="flex items-center gap-3">
            <span className={`grid h-12 w-12 place-items-center rounded-2xl ${TONES[estadoInfo.tone]}`}>
              <estadoInfo.icon size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="kicker text-brand-cyan">GESTIÓN</p>
              <p className="font-mono text-[11px] text-brand-muted">{tramite.codigo}</p>
            </div>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${TONE_BADGE[estadoInfo.tone]}`}>
              {estadoInfo.label}
            </span>
          </div>

          <h2 className="mt-4 font-display text-xl font-bold leading-tight text-brand-ink">
            {tramite.titulo}
          </h2>

          <dl className="mt-5 space-y-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
            <Row icon={Tag} label="Categoría" value={labelCategoria(tramite.categoria)} />
            <Row icon={CircleDot} label="Prioridad" value={capitalize(tramite.prioridad)} />
            <Row icon={Calendar} label="Iniciado" value={formatFecha(tramite.created_at)} />
            <Row icon={Clock} label="Última actividad" value={formatActividad(tramite.horas_desde_actividad)} />
            {tramite.vence_at && (
              <Row icon={Calendar} label="Vence" value={formatFecha(tramite.vence_at)} />
            )}
          </dl>

          {(tramite.total_comentarios > 0 || tramite.total_adjuntos > 0) && (
            <p className="mt-4 text-xs text-brand-muted">
              {tramite.total_comentarios > 0 && <>💬 {tramite.total_comentarios} comentario{tramite.total_comentarios > 1 ? 's' : ''}{' · '}</>}
              {tramite.total_adjuntos > 0 && <>📎 {tramite.total_adjuntos} adjunto{tramite.total_adjuntos > 1 ? 's' : ''}</>}
            </p>
          )}

          <div className="mt-5 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-3 text-xs text-brand-muted">
            ¿Necesitás aclarar algo? Escribinos a <a href="mailto:contacto@gestionglobal.ar" className="font-semibold text-brand-cyan">contacto@gestionglobal.ar</a> citando el código <span className="font-mono">{tramite.codigo}</span>.
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof FileText; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon size={13} className="text-brand-muted" />
      <span className="text-brand-muted">{label}</span>
      <span className="ml-auto font-medium text-brand-ink">{value}</span>
    </div>
  );
}

function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
function formatFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

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
