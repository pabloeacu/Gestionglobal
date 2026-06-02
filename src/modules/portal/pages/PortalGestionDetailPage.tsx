// ============================================================================
// PortalGestionDetailPage · Bloque H / obs 12
//
// El detalle de cada trámite (avances + tracking) ahora vive en una pantalla
// propia en vez de un modal. El modal cortaba contenido con el header y se
// veía apretado. La pantalla nueva usa el layout normal del portal:
// scroll natural, ancho cómodo, navegación back atrás.
// ============================================================================
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  CircleDot,
  XCircle,
  ArrowRight,
  Calendar,
  Tag,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { PedidosDocPanel } from '@/components/common/PedidosDocPanel';
import {
  fetchClienteTramites,
  fetchClienteTrackingLineas,
  marcarTrackingAvanceLeido,
  type ClienteTramite,
  type ClienteTrackingLinea,
} from '@/services/api/portal-dashboard';

// Mismo diccionario que PortalGestionesPage. Mantenido sincronizado a propósito
// para no acoplar pantallas pero mostrar el mismo lenguaje visual.
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

export function PortalGestionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation() as { state: { tramite?: ClienteTramite } | null };
  const passedTramite = location.state?.tramite;

  const [tramite, setTramite] = useState<ClienteTramite | null>(passedTramite ?? null);
  const [lineas, setLineas] = useState<ClienteTrackingLinea[]>([]);
  const [loadingLineas, setLoadingLineas] = useState(true);
  const [loadingTramite, setLoadingTramite] = useState(!passedTramite);

  // Si no llegamos con state (entrada directa por URL o reload), reconstruimos
  // el tramite buscando entre los del cliente. Es la fuente que usa la lista.
  useEffect(() => {
    if (!id || tramite) return;
    let cancel = false;
    void fetchClienteTramites(false).then((res) => {
      if (cancel) return;
      setLoadingTramite(false);
      if (!res.ok) {
        toast.error('No pudimos cargar el detalle del trámite');
        navigate('/portal/gestiones');
        return;
      }
      const t = res.data.find((x) => x.id === id) ?? null;
      if (!t) {
        toast.error('No encontramos este trámite');
        navigate('/portal/gestiones');
        return;
      }
      setTramite(t);
    });
    return () => {
      cancel = true;
    };
  }, [id, tramite, navigate]);

  useEffect(() => {
    if (!id) return;
    let cancel = false;
    setLoadingLineas(true);
    void fetchClienteTrackingLineas(id).then((data) => {
      if (cancel) return;
      setLineas(data);
      setLoadingLineas(false);
      // Marcar todos los avances como leídos (igual que el modal hacía)
      void marcarTrackingAvanceLeido(id);
    });
    return () => {
      cancel = true;
    };
  }, [id]);

  if (loadingTramite || !tramite) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <div className="h-8 w-40 animate-pulse rounded bg-slate-100" />
        <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
      </div>
    );
  }

  const estadoInfo = ESTADOS[tramite.estado] ?? {
    label: tramite.estado,
    tone: 'slate' as const,
    icon: FileText,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        to="/portal/gestiones"
        className="inline-flex items-center gap-1.5 text-sm text-brand-muted transition hover:text-brand-ink"
      >
        <ArrowLeft size={14} /> Mis gestiones
      </Link>

      {/* Header del tramite */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3">
          <span className={`grid h-12 w-12 place-items-center rounded-2xl ${TONES[estadoInfo.tone]}`}>
            <estadoInfo.icon size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="kicker text-brand-cyan">GESTIÓN · {tramite.codigo}</p>
            <h1 className="mt-1 font-display text-xl font-bold leading-tight text-brand-ink sm:text-2xl">
              {tramite.titulo}
            </h1>
          </div>
          <span
            className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${TONE_BADGE[estadoInfo.tone]}`}
          >
            {estadoInfo.label}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <DataChip icon={Tag} label="Categoría" value={labelCategoria(tramite.categoria)} />
          <DataChip icon={CircleDot} label="Prioridad" value={capitalize(tramite.prioridad)} />
          <DataChip icon={Calendar} label="Iniciado" value={formatFechaCorta(tramite.created_at)} />
          <DataChip icon={Clock} label="Actividad" value={formatActividad(tramite.horas_desde_actividad)} />
        </div>
      </section>

      {/* N2 · Pedidos de documentación al cliente (banner amber con upload por item) */}
      <PedidosDocPanel
        tramiteId={tramite.id}
        variant="cliente"
        tramiteLabel={tramite.codigo ?? undefined}
      />

      {/* Timeline de avances */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="font-display text-base font-bold text-brand-ink">Avances</h2>
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
      </section>

      {/* Contacto */}
      <section className="rounded-2xl border border-slate-200 bg-slate-50/40 px-5 py-4 text-xs text-brand-muted sm:px-6">
        ¿Necesitás aclarar algo? Escribinos a{' '}
        <a href="mailto:contacto@gestionglobal.ar" className="font-semibold text-brand-cyan">
          contacto@gestionglobal.ar
        </a>{' '}
        citando el código <span className="font-mono">{tramite.codigo}</span>.
      </section>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Helpers (duplicados intencionalmente del archivo de Gestiones para
// independencia de la pantalla — son funciones puras)
// ----------------------------------------------------------------------------
function DataChip({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileText;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 px-2.5 py-1.5">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-brand-muted">
        <Icon size={10} /> {label}
      </p>
      <p className="mt-0.5 truncate font-medium text-brand-ink">{value}</p>
    </div>
  );
}

function TimelineItem({
  linea,
  isLast,
  isFirst,
}: {
  linea: ClienteTrackingLinea;
  isLast: boolean;
  isFirst: boolean;
}) {
  const tone =
    linea.categoria_slug === 'incidencia'
      ? { dot: 'bg-rose-500', bg: 'bg-rose-50', text: 'text-rose-700' }
      : linea.categoria_slug === 'cobranza'
        ? { dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700' }
        : { dot: 'bg-brand-cyan', bg: 'bg-brand-cyan-pale/40', text: 'text-brand-cyan' };
  const categoriaLabel = linea.categoria_label || linea.categoria_slug;

  return (
    <li className="relative flex gap-4 pb-5">
      {!isLast && <span aria-hidden className="absolute left-[7px] top-3 h-full w-px bg-slate-200" />}
      <span aria-hidden className={`relative mt-1.5 inline-block h-4 w-4 rounded-full ring-4 ring-white ${tone.dot}`} />
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone.bg} ${tone.text}`}>
            {categoriaLabel}
          </span>
          {isFirst && (
            <span className="inline-flex items-center rounded-full bg-brand-cyan px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              último
            </span>
          )}
          <span className="text-[11px] text-brand-muted">
            {formatFechaLarga(linea.created_at)}
          </span>
        </div>
        <p className="mt-1 text-sm text-brand-ink whitespace-pre-wrap">{linea.descripcion}</p>
        {Array.isArray(linea.archivos_urls) && linea.archivos_urls.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {linea.archivos_urls.map((url, i) => {
              const name = nombreArchivo(url);
              return (
                <li key={i}>
                  {/* DGG-40 (José Luis): el cliente debe poder descargar
                      adjuntos del tracking desde su portal. `download` da
                      el nombre limpio en el filesystem; target=_blank
                      mantiene la pestaña abierta si el navegador prefiere
                      abrir inline (PDF nativo). */}
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={name}
                    title={`Descargar ${name}`}
                    className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-brand-ink hover:bg-slate-200"
                  >
                    <FileText size={11} />
                    {name}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </li>
  );
}

function nombreArchivo(url: string): string {
  try {
    const last = url.split('/').pop() ?? 'archivo';
    return decodeURIComponent(last).replace(/^\d+-[a-z0-9]+-/, '');
  } catch {
    return 'archivo';
  }
}

function labelCategoria(s: string): string {
  return s.replace(/_/g, ' ');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatFechaCorta(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  } catch {
    return iso;
  }
}

function formatFechaLarga(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatActividad(horas: number | null): string {
  if (horas === null) return 'sin actividad';
  if (horas < 1) return 'hace minutos';
  if (horas < 24) return `hace ${Math.round(horas)} h`;
  const dias = Math.round(horas / 24);
  return `hace ${dias} d`;
}
