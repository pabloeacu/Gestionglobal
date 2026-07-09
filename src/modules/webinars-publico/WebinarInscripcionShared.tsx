// F6 (DGG-63) · Piezas compartidas de la inscripción condicional a webinars.
//
// Disposición condicional (decisión de Pablo): si hay un webinar PUBLICADO y
// VIGENTE (webinar_inscripcion_activa), se muestra su identidad branded
// (banner + nombre + descripción + docentes con foto) + el formulario
// vinculado/compartido. Si NO hay → una página de texto propia de webinars
// (NO la página "Muy pronto").
//
// Estas piezas son agnósticas del contexto: la LANDING embebe el formulario
// debajo de <WebinarIdentidad>; el PORTAL pone un botón de inscripción
// one-click. El texto de espera es idéntico en ambos.

import { useEffect, useState } from 'react';
import { CalendarClock, Clock, GraduationCap, Sparkles, MapPin, Globe, Ticket, ExternalLink, FileText } from 'lucide-react';
import {
  fetchWebinarInscripcionActiva,
  type WebinarInscripcionActiva,
} from '@/services/api/webinars';
import { humanizeError } from '@/lib/errors';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Hook · trae el webinar vigente (o null) con loading/error y un reload manual.
// ---------------------------------------------------------------------------
export function useWebinarVigente() {
  const [data, setData] = useState<WebinarInscripcionActiva | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    void fetchWebinarInscripcionActiva().then((res) => {
      if (!mounted) return;
      setLoading(false);
      if (!res.ok) {
        setError(humanizeError(res.error));
        return;
      }
      setData(res.data);
    });
    return () => {
      mounted = false;
    };
  }, [reloadKey]);

  return { data, loading, error, reload: () => setReloadKey((k) => k + 1) };
}

const TIPO_LABEL: Record<string, string> = {
  webinar: 'Webinar', charla: 'Charla', taller: 'Taller', jornada: 'Jornada',
  curso: 'Curso', podcast: 'Podcast', otro: 'Evento',
};

function fmtFechaLarga(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-AR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Identidad branded del webinar vigente. `children` = la acción de inscripción
// (formulario embebido en landing, botón one-click en portal).
// ---------------------------------------------------------------------------
export function WebinarIdentidad({
  w,
  children,
  as = 'h1',
}: {
  w: WebinarInscripcionActiva;
  children?: React.ReactNode;
  /** Tag del título. El portal pasa 'h2' (la página ya tiene su <h1>). */
  as?: 'h1' | 'h2';
}) {
  const Heading = as;
  return (
    <div className="space-y-6">
      {/* Banner */}
      {w.banner_url && (
        <div className="overflow-hidden rounded-3xl border border-slate-200 shadow-[0_24px_60px_-30px_rgba(0,93,105,0.35)]">
          <img
            src={w.banner_url}
            alt={`Banner del evento ${w.titulo}`}
            className="block h-auto w-full object-cover"
            loading="lazy"
          />
        </div>
      )}

      {/* Título + meta */}
      <div>
        <p className="kicker text-brand-cyan">
          {w.es_arancelado ? 'Capacitación' : 'Capacitación gratuita'} · {TIPO_LABEL[w.tipo] ?? 'Evento'}
        </p>
        <Heading className="mt-1 font-display text-3xl font-extrabold leading-tight tracking-tight text-brand-ink sm:text-4xl">
          {w.titulo}
        </Heading>
        <p className="mt-2 inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-brand-muted">
          <CalendarClock size={15} className="text-brand-cyan" />
          <span className="capitalize">{fmtFechaLarga(w.fecha_hora)}</span>
          <span className="text-slate-300">·</span>
          <Clock size={14} className="text-brand-cyan" />
          {w.duracion_min} min
          <span className="text-slate-300">·</span>
          {w.modalidad === 'presencial' ? (
            <span className="inline-flex items-center gap-1 text-violet-600"><MapPin size={14} /> Presencial</span>
          ) : w.modalidad === 'mixto' ? (
            <span className="inline-flex items-center gap-1 text-teal-600"><MapPin size={14} /> Online + presencial</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-sky-600"><Globe size={14} /> Online</span>
          )}
        </p>
      </div>

      {/* Lugar (eventos presenciales/mixtos) */}
      {w.modalidad !== 'online' && (w.ubicacion_direccion || w.ubicacion_lugar) && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
          <p className="kicker mb-1 flex items-center gap-1.5 text-violet-700">
            <MapPin size={14} /> Dónde
          </p>
          {w.ubicacion_lugar && <p className="text-sm font-semibold text-brand-ink">{w.ubicacion_lugar}</p>}
          {w.ubicacion_direccion && <p className="text-sm text-brand-ink/80">{w.ubicacion_direccion}</p>}
          {w.ubicacion_localidad && <p className="text-sm text-brand-muted">{w.ubicacion_localidad}</p>}
          {w.ubicacion_instrucciones && (
            <p className="mt-2 whitespace-pre-wrap text-xs text-brand-muted">{w.ubicacion_instrucciones}</p>
          )}
          {w.ubicacion_mapa_url && (
            <a
              href={w.ubicacion_mapa_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-violet-700 hover:underline"
            >
              <ExternalLink size={13} /> Ver en el mapa
            </a>
          )}
        </div>
      )}

      {/* Arancel (informativo) */}
      {w.es_arancelado && (
        <div className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <Ticket size={15} />
          <span>
            Evento arancelado
            {w.arancel_monto != null && `: $${w.arancel_monto.toLocaleString('es-AR')}`}
            {w.arancel_nota && ` · ${w.arancel_nota}`}
          </span>
        </div>
      )}

      {/* Descripción */}
      {w.descripcion && (
        <p className="max-w-2xl whitespace-pre-wrap text-[15px] leading-relaxed text-brand-ink/85">
          {w.descripcion}
        </p>
      )}

      {/* Disertantes */}
      {w.docentes.length > 0 && (
        <div>
          <p className="kicker mb-3 flex items-center gap-1.5 text-brand-muted">
            <GraduationCap size={14} /> {w.docentes.length === 1 ? 'Disertante' : 'Disertantes'}
          </p>
          <ul className="flex flex-wrap gap-x-6 gap-y-4">
            {w.docentes.map((d, i) => (
              <li key={i} className="flex items-start gap-3">
                <DocenteAvatar nombre={d.nombre} foto={d.foto_url} />
                <div className="min-w-0">
                  <span className="block text-sm font-semibold text-brand-ink">
                    {d.nombre || 'Disertante'}
                  </span>
                  {d.bio && <span className="block max-w-xs text-xs text-brand-muted line-clamp-3">{d.bio}</span>}
                  {d.cv_url && (
                    <a
                      href={d.cv_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-cyan hover:underline"
                    >
                      <FileText size={11} /> Ver CV
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Acción de inscripción (form embebido o botón one-click) */}
      {children && <div className="pt-2">{children}</div>}
    </div>
  );
}

function DocenteAvatar({ nombre, foto }: { nombre: string; foto: string | null }) {
  const inicial = (nombre.trim()[0] ?? '·').toUpperCase();
  return (
    <span
      className={cn(
        'grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full border border-slate-200 bg-brand-cyan-pale text-brand-cyan',
      )}
    >
      {foto ? (
        <img src={foto} alt={nombre} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="font-display text-lg font-bold">{inicial}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Página de texto cuando NO hay webinar vigente. Texto EXACTO de Pablo
// (propio de webinars, NO la página "Muy pronto").
// ---------------------------------------------------------------------------
export function WebinarTextoEspera() {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <span className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-brand-cyan-pale text-brand-cyan">
        <Sparkles size={28} />
      </span>
      <h1 className="font-display text-2xl font-extrabold leading-tight tracking-tight text-brand-ink sm:text-3xl">
        Estate atento a nuestra próxima capacitación gratuita.
      </h1>
      <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-brand-muted">
        Creemos que la capacitación es clave para la excelencia, y en Gestión Global tenemos una
        vocación por la formación de una generación de administradores que no encajen, sino que
        sobresalgan.
      </p>
      <p className="mt-6 font-display text-lg font-bold text-brand-cyan">#AliadosDeTuTiempo</p>
    </div>
  );
}
