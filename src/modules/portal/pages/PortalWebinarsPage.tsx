// PortalWebinarsPage · "Mis webinars" del cliente: próximos en los que está
// inscripto + disponibles para inscribirse + grabaciones pasadas.
// La inscripción se hace inline con la RPC `inscribir_a_webinar`.
//
// Citas: regla 4 (queries en services/), regla 13 (sin window.confirm).

import { useEffect, useState } from 'react';
import {
  Video,
  CalendarClock,
  PlayCircle,
  Sparkles,
  CheckCircle2,
  Clock,
  Loader2,
} from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { Skeleton, useConfirm, Button } from '@/components/common';
import { toast } from '@/lib/toast';
import { useAuth } from '@/contexts/AuthContext';
import { inscribirmeAWebinar } from '@/services/api/webinars';
import {
  fetchClienteWebinars,
  type ClienteWebinarItem,
} from '@/services/api/portal-dashboard';
import { humanizeError } from '@/lib/errors';
import {
  useWebinarVigente,
  WebinarIdentidad,
  WebinarTextoEspera,
} from '@/modules/webinars-publico/WebinarInscripcionShared';

export function PortalWebinarsPage() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [mis, setMis] = useState<ClienteWebinarItem[]>([]);
  const [disponibles, setDisponibles] = useState<ClienteWebinarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [inscribing, setInscribing] = useState<string | null>(null);

  // F6 (DGG-63) · hero branded del webinar vigente ("el más próximo gana").
  const { data: vigente, loading: loadingVigente, reload: reloadVigente } = useWebinarVigente();

  async function load() {
    setLoading(true);
    const res = await fetchClienteWebinars();
    setLoading(false);
    if (!res.ok) {
      toast.error('No pudimos cargar webinars', { description: humanizeError(res.error) });
      return;
    }
    setMis(res.data.mis_webinars ?? []);
    setDisponibles(res.data.disponibles ?? []);
  }

  useEffect(() => { void load(); }, []);

  // ¿el cliente ya está inscripto al vigente? (para mostrar "ya estás inscripto"
  // en el hero en vez del botón). Se evita además duplicarlo en las listas.
  const yaInscriptoVigente = !!vigente && mis.some((m) => m.webinar_id === vigente.id);
  const misSinVigente = mis.filter((m) => !vigente || m.webinar_id !== vigente.id);
  const dispSinVigente = disponibles.filter((d) => !vigente || d.webinar_id !== vigente.id);

  async function handleInscribirVigente() {
    if (!user || !vigente) return;
    const ok = await confirm({
      title: 'Inscribirme al webinar',
      message: `¿Confirmás tu inscripción a "${vigente.titulo}"? Te vamos a enviar el link unas horas antes.`,
      confirmLabel: 'Inscribirme',
    });
    if (!ok) return;
    setInscribing(vigente.id);
    const res = await inscribirmeAWebinar(vigente.id);
    setInscribing(null);
    if (!res.ok) {
      toast.error('No pudimos inscribirte', { description: humanizeError(res.error) });
      return;
    }
    toast.success('¡Inscripto!', { description: 'Te vamos a recordar antes del evento.' });
    await load();
    reloadVigente();
  }

  async function handleInscribir(w: ClienteWebinarItem) {
    if (!user) return;
    const ok = await confirm({
      title: 'Inscribirme al webinar',
      message: `¿Confirmás tu inscripción a "${w.titulo}"? Te vamos a enviar el link unas horas antes.`,
      confirmLabel: 'Inscribirme',
    });
    if (!ok) return;

    setInscribing(w.webinar_id);
    const res = await inscribirmeAWebinar(w.webinar_id);
    setInscribing(null);

    if (!res.ok) {
      toast.error('No pudimos inscribirte', { description: humanizeError(res.error) });
      return;
    }
    toast.success('¡Inscripto!', { description: 'Te vamos a recordar antes del evento.' });
    await load();
  }

  return (
    <div className="relative space-y-5 pb-12">
      <TrianglesAccent position="top-right" size={180} tone="cyan" density="soft" className="opacity-30" />

      {/* Header */}
      <section className="card-premium relative overflow-hidden">
        <div className="relative p-5 sm:p-6">
          <p className="kicker text-brand-cyan">PORTAL · CAPACITACIÓN</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            Mis webinars
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-muted">
            Capacitaciones online gratuitas de Gestión Global. Te enviamos recordatorios automáticos antes de cada evento.
          </p>
        </div>
      </section>

      {/* F6 (DGG-63) · Hero del webinar vigente (branded) ó texto de espera */}
      {loadingVigente ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : vigente ? (
        <section className="card-premium relative overflow-hidden p-5 sm:p-6">
          <WebinarIdentidad w={vigente}>
            {yaInscriptoVigente ? (
              <span className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                <CheckCircle2 size={16} /> Ya estás inscripto
              </span>
            ) : (
              <Button onClick={() => void handleInscribirVigente()} disabled={inscribing === vigente.id}>
                {inscribing === vigente.id
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Sparkles size={14} />}
                {inscribing === vigente.id ? 'Inscribiendo…' : 'Inscribirme gratis'}
              </Button>
            )}
          </WebinarIdentidad>
        </section>
      ) : (
        <section className="card-premium relative overflow-hidden p-6 sm:p-10">
          <WebinarTextoEspera />
        </section>
      )}

      {/* Loading de las listas */}
      {loading && (
        <div className="space-y-3">
          {[0,1].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
      )}

      {!loading && (
        <>
          {/* Mis inscripciones (excluye el vigente, que ya está en el hero) */}
          {misSinVigente.length > 0 && (
            <section>
              <header className="mb-3 px-1">
                <p className="kicker text-brand-muted">MIS INSCRIPCIONES</p>
              </header>
              <ul className="grid gap-3 sm:grid-cols-2">
                {misSinVigente.map((w) => <li key={w.webinar_id}><WebinarMyCard w={w} /></li>)}
              </ul>
            </section>
          )}

          {/* Otros próximos disponibles (excluye el vigente) */}
          {dispSinVigente.length > 0 && (
            <section>
              <header className="mb-3 flex items-center justify-between px-1">
                <p className="kicker text-brand-muted">{vigente ? 'OTROS PRÓXIMOS WEBINARS' : 'PRÓXIMOS WEBINARS'}</p>
                <span className="text-[11px] font-medium text-brand-muted">
                  {dispSinVigente.length} disponible{dispSinVigente.length === 1 ? '' : 's'}
                </span>
              </header>
              <ul className="grid gap-3 sm:grid-cols-2">
                {dispSinVigente.map((w) => (
                  <li key={w.webinar_id}>
                    <WebinarAvailCard
                      w={w}
                      inscribing={inscribing === w.webinar_id}
                      onInscribir={() => void handleInscribir(w)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// =========================================================================

function WebinarMyCard({ w }: { w: ClienteWebinarItem }) {
  const fecha = new Date(w.fecha_hora);
  const ahora = new Date();
  const minsHasta = Math.round((fecha.getTime() - ahora.getTime()) / 60000);
  const fueAyer = minsHasta < 0;
  const enCurso = w.status === 'en_curso';
  const finalizado = w.status === 'finalizado';

  let label = '';
  let toneClass = '';
  if (enCurso) {
    label = 'EN VIVO';
    toneClass = 'bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-300';
  } else if (finalizado) {
    label = 'GRABACIÓN';
    toneClass = 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-300';
  } else if (fueAyer) {
    label = 'FINALIZADO';
    toneClass = 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-300';
  } else if (minsHasta < 60) {
    label = `EN ${minsHasta} MIN`;
    toneClass = 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300';
  } else if (minsHasta < 24 * 60) {
    label = `EN ${Math.round(minsHasta / 60)} H`;
    toneClass = 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200';
  } else {
    const d = Math.round(minsHasta / 60 / 24);
    label = `EN ${d} ${d === 1 ? 'DÍA' : 'DÍAS'}`;
    toneClass = 'bg-brand-cyan-pale text-brand-cyan ring-1 ring-inset ring-brand-cyan/30';
  }

  const showJoinLink = (enCurso || (minsHasta <= 15 && minsHasta >= -60)) && !!w.link;
  const showRecording = finalizado && !!w.grabacion_url;

  return (
    <article className="group flex h-full flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-brand-cyan hover:shadow-md">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-brand-cyan-pale text-brand-cyan">
          <Video size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${toneClass}`}>
              {label}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-brand-muted">
              <CheckCircle2 size={10} /> Inscripto
            </span>
          </div>
          <h3 className="mt-1 line-clamp-2 font-semibold leading-tight text-brand-ink">{w.titulo}</h3>
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-brand-muted">
            <CalendarClock size={11} /> {formatFecha(w.fecha_hora)}
            {w.duracion_min ? ` · ${w.duracion_min} min` : ''}
          </p>
          {w.descripcion && <p className="mt-1 line-clamp-2 text-xs text-brand-muted">{w.descripcion}</p>}
        </div>
      </div>
      {(showJoinLink || showRecording) && (
        <div className="mt-auto">
          {showJoinLink && (
            <a
              href={w.link!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-cyan px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-cyan/90"
            >
              <PlayCircle size={14} /> Unirme al webinar
            </a>
          )}
          {showRecording && (
            <a
              href={w.grabacion_url!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan"
            >
              <PlayCircle size={14} /> Ver grabación
            </a>
          )}
        </div>
      )}
    </article>
  );
}

function WebinarAvailCard({ w, inscribing, onInscribir }: {
  w: ClienteWebinarItem;
  inscribing: boolean;
  onInscribir: () => void;
}) {
  return (
    <article className="flex h-full flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-brand-cyan hover:shadow-md">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700">
          <Sparkles size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="kicker text-violet-700 opacity-80">GRATUITO</p>
          <h3 className="line-clamp-2 font-semibold leading-tight text-brand-ink">{w.titulo}</h3>
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-brand-muted">
            <Clock size={11} /> {formatFecha(w.fecha_hora)}
            {w.duracion_min ? ` · ${w.duracion_min} min` : ''}
          </p>
          {w.descripcion && <p className="mt-1 line-clamp-2 text-xs text-brand-muted">{w.descripcion}</p>}
        </div>
      </div>
      <div className="mt-auto">
        <Button onClick={onInscribir} disabled={inscribing} className="w-full">
          {inscribing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {inscribing ? 'Inscribiendo…' : 'Inscribirme'}
        </Button>
      </div>
    </article>
  );
}

function formatFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', {
    weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
