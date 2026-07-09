// PortalEventoDetallePage · Etapa A (DGG-100) · Ficha del evento en el portal.
//
// El cliente se inscribe con UN CLICK, pero antes necesita ver TODA la info del
// evento (dónde es, mapa, flyer, disertantes, arancel) — "no sabe ni dónde es".
// Reusa <WebinarIdentidad> (la misma identidad branded del público/landing) para
// consistencia total, y le agrega: el flyer al costado + el panel de estado de
// inscripción (inscripto / canal / unirse / grabación) o el botón one-click.
//
// Datos: RPC cliente_evento_detalle (mig 0302) → info pública + estado de
// inscripción del cliente (nunca secretos Zoom). Read-only salvo el one-click.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Video,
  Youtube,
  MapPin,
  PlayCircle,
  Sparkles,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Button, Skeleton, useConfirm } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { toast } from '@/lib/toast';
import { useAuth } from '@/contexts/AuthContext';
import { humanizeError } from '@/lib/errors';
import {
  fetchClienteEventoDetalle,
  type ClienteEventoDetalle,
} from '@/services/api/portal-dashboard';
import { inscribirmeAWebinar, type WebinarInscripcionActiva } from '@/services/api/webinars';
import {
  WebinarIdentidad,
} from '@/modules/webinars-publico/WebinarInscripcionShared';

// Adapta el detalle del cliente a la forma que consume <WebinarIdentidad>
// (no usa los campos de formulario → null).
function toIdentidad(ev: ClienteEventoDetalle): WebinarInscripcionActiva {
  return {
    id: ev.id,
    titulo: ev.titulo,
    descripcion: ev.descripcion,
    banner_url: ev.banner_url,
    flyer_url: ev.flyer_url,
    docentes: ev.docentes,
    fecha_hora: ev.fecha_hora,
    duracion_min: ev.duracion_min,
    plataforma: ev.plataforma,
    modalidad: ev.modalidad,
    tipo: ev.tipo,
    ubicacion_lugar: ev.ubicacion_lugar,
    ubicacion_direccion: ev.ubicacion_direccion,
    ubicacion_localidad: ev.ubicacion_localidad,
    ubicacion_mapa_url: ev.ubicacion_mapa_url,
    ubicacion_instrucciones: ev.ubicacion_instrucciones,
    es_arancelado: ev.es_arancelado,
    arancel_monto: ev.arancel_monto,
    arancel_nota: ev.arancel_nota,
    formulario_id: null,
    formulario_slug: null,
    formulario_activo: null,
  };
}

export function PortalEventoDetallePage() {
  const { id } = useParams<{ id: string }>();
  const [ev, setEv] = useState<ClienteEventoDetalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    const res = await fetchClienteEventoDetalle(id);
    setLoading(false);
    if (!res.ok) {
      toast.error('No pudimos cargar el evento', { description: humanizeError(res.error) });
      setNotFound(true);
      return;
    }
    if (!res.data) {
      setNotFound(true);
      return;
    }
    setEv(res.data);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  return (
    <div className="relative space-y-5 pb-12">
      <TrianglesAccent position="top-right" size={180} tone="cyan" density="soft" className="opacity-30" />

      <Link
        to="/portal/webinars"
        className="inline-flex items-center gap-1 text-sm text-brand-muted transition hover:text-brand-cyan"
      >
        <ArrowLeft size={14} /> Volver a Mis eventos
      </Link>

      {loading ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : notFound || !ev ? (
        <section className="card-premium flex flex-col items-center gap-3 p-10 text-center">
          <AlertCircle size={32} className="text-brand-muted" />
          <h1 className="font-display text-xl font-bold text-brand-ink">Evento no disponible</h1>
          <p className="max-w-md text-sm text-brand-muted">
            Puede que el enlace haya cambiado o que el evento ya no esté disponible para tu cuenta.
          </p>
          <Link to="/portal/webinars" className="text-sm font-semibold text-brand-cyan hover:underline">
            Ver mis eventos
          </Link>
        </section>
      ) : (
        <section className="card-premium relative overflow-hidden p-5 sm:p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
              <WebinarIdentidad w={toIdentidad(ev)} as="h1">
                <InscripcionEstado ev={ev} onChanged={load} />
              </WebinarIdentidad>
            </div>
            {ev.flyer_url && (
              <aside className="lg:w-64 lg:shrink-0">
                <img
                  src={ev.flyer_url}
                  alt={`Flyer de ${ev.titulo}`}
                  className="mx-auto w-full max-w-[16rem] rounded-2xl border border-slate-200 shadow-[0_18px_44px_-24px_rgba(0,93,105,0.4)]"
                  loading="lazy"
                />
              </aside>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

// Panel de estado de inscripción / acción one-click. Modality-aware:
// presenciales no muestran "Unirme" (no hay canal online → el "Dónde" de la
// identidad manda); online/mixto muestran el link cuando está en vivo o cerca.
function InscripcionEstado({ ev, onChanged }: { ev: ClienteEventoDetalle; onChanged: () => void }) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [inscribing, setInscribing] = useState(false);

  const cancelado = ev.status === 'cancelado';
  const finalizado = ev.status === 'finalizado';
  const enCurso = ev.status === 'en_curso';
  const inicio = new Date(ev.fecha_hora).getTime();
  const minsHasta = Math.round((inicio - Date.now()) / 60000);
  // Ventana de inscripción cerrada: presencial cierra al inicio; online/mixto a
  // inicio+duración (espeja private.webinar_vigente_id / inscribir_a_webinar).
  // `cerrado` cubre el caso "evento pasado pero status aún 'programado'" (el cron
  // de finalización todavía no corrió) → no ofrecemos inscribirse a algo vencido.
  const cierre = ev.modalidad === 'presencial' ? inicio : inicio + ev.duracion_min * 60_000;
  const cerrado = finalizado || Date.now() > cierre;
  // "Unirme" visible cuando está en vivo o dentro de los 15' previos (o hasta 60'
  // después, por si empezó tarde) y hay canal online.
  const mostrarUnirme = !!ev.join_url && (enCurso || (minsHasta <= 15 && minsHasta >= -60));
  const puedeInscribirse = !ev.inscripto && !cancelado && !cerrado && ev.status === 'programado';

  async function inscribir() {
    if (!user) return;
    const ok = await confirm({
      title: 'Inscribirme al evento',
      message: `¿Confirmás tu inscripción a "${ev.titulo}"? Te vamos a enviar el link o los detalles antes de que empiece.`,
      confirmLabel: 'Inscribirme',
    });
    if (!ok) return;
    setInscribing(true);
    const res = await inscribirmeAWebinar(ev.id);
    setInscribing(false);
    if (!res.ok) {
      toast.error('No pudimos inscribirte', { description: humanizeError(res.error) });
      return;
    }
    toast.success('¡Inscripto!', { description: 'Te vamos a recordar antes del evento.' });
    onChanged();
  }

  if (cancelado) {
    return (
      <div className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800">
        <AlertCircle size={16} /> Este evento fue cancelado
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      {ev.inscripto ? (
        <span className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
          <CheckCircle2 size={16} /> Ya estás inscripto
        </span>
      ) : puedeInscribirse ? (
        <Button onClick={() => void inscribir()} disabled={inscribing}>
          {inscribing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {inscribing ? 'Inscribiendo…' : 'Inscribirme gratis'}
        </Button>
      ) : null}

      {/* Canal (para inscriptos online/mixto) */}
      {ev.inscripto && ev.canal && ev.canal !== 'presencial' && (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-brand-muted">
          {ev.canal === 'zoom' ? <Video size={13} className="text-blue-600" /> : <Youtube size={13} className="text-red-600" />}
          Te conectás por {ev.canal === 'zoom' ? 'Zoom' : 'YouTube'}
        </span>
      )}

      {/* Unirme (en vivo / cerca) */}
      {mostrarUnirme && (
        <a
          href={ev.join_url!}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-cyan px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-cyan/90"
        >
          <PlayCircle size={15} /> Unirme al evento
        </a>
      )}

      {/* Asistió (histórico) */}
      {ev.inscripto && ev.asistio && (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
          <CheckCircle2 size={13} /> Registramos tu asistencia
        </span>
      )}

      {/* Grabación (finalizados) */}
      {finalizado && ev.grabacion_url && (
        <a
          href={ev.grabacion_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan"
        >
          <PlayCircle size={15} /> Ver grabación
        </a>
      )}

      {/* Presencial: recordatorio de que el "Dónde" está arriba */}
      {ev.inscripto && ev.canal === 'presencial' && !cerrado && (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-700">
          <MapPin size={13} /> Te esperamos en el lugar (ver arriba)
        </span>
      )}

      {/* Cierre: evento finalizado/pasado, no inscripto y sin grabación → evita
          que el panel quede sin ningún elemento (GAP §6). */}
      {cerrado && !ev.inscripto && !ev.grabacion_url && (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-brand-muted">
          Este evento ya finalizó
        </span>
      )}
    </div>
  );
}
