import { useParams } from 'react-router-dom';
import { AlertCircle, Calendar, Clock, Loader2, Radio } from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { WebinarBodyContent } from './WebinarBodyContent';
import { useCountdown, useWebinarAcceso } from './useWebinarAcceso';

// DGG-11/15: página pública (sin login) que se accede vía magic-link
// /webinar/:token. Muestra datos del webinar + botón "Unirme al webinar"
// según el canal asignado al inscripto (Zoom o YouTube Live).

function fmtFecha(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-AR', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

export function WebinarPublicoPage() {
  const { token } = useParams<{ token: string }>();
  const acceso = useWebinarAcceso(token);

  // Countdown se llama siempre con un valor seguro (Rules of Hooks).
  const countdown = useCountdown(
    acceso.state === 'ok' ? acceso.resp.webinar.fecha_hora : new Date().toISOString(),
  );

  if (acceso.state === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-50 to-brand-cyan/5 p-6">
        <div className="flex items-center gap-2 text-brand-muted">
          <Loader2 size={20} className="animate-spin" />
          <span>Cargando evento…</span>
        </div>
      </div>
    );
  }

  if (acceso.state === 'error') {
    return (
      <div className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-50 to-red-50 p-6">
        <div className="max-w-md rounded-3xl border border-red-200 bg-white p-8 text-center shadow-xl">
          <AlertCircle size={40} className="mx-auto mb-3 text-red-500" />
          <h1 className="font-display text-xl font-bold text-brand-ink">No pudimos abrir el evento</h1>
          <p className="mt-2 text-sm text-brand-muted">{acceso.message}</p>
          <p className="mt-4 text-xs text-brand-muted">
            Si recibiste un link reciente y no funciona, contactanos a{' '}
            <a href="mailto:contacto@gestionglobal.ar" className="text-brand-cyan underline">contacto@gestionglobal.ar</a>.
          </p>
        </div>
      </div>
    );
  }

  const { webinar } = acceso.resp;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-brand-cyan/5">
      <div className="relative overflow-hidden bg-gradient-to-br from-brand-night via-brand-night to-brand-cyan px-6 py-12 text-white">
        <TrianglesAccent position="top-right" tone="cyan" className="opacity-20" />
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-brand-cyan/80">
            <Radio size={14} /> Evento de Gestión Global
          </div>
          <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">{webinar.titulo}</h1>
          {webinar.descripcion && (
            <p className="mt-3 max-w-2xl text-base text-white/80">{webinar.descripcion}</p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-white/90">
            <span className="inline-flex items-center gap-1.5">
              <Calendar size={14} /> {fmtFecha(webinar.fecha_hora)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock size={14} /> {webinar.duracion_min} min
            </span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-6 py-8">
        <WebinarBodyContent resp={acceso.resp} countdown={countdown} />
      </div>

      <footer className="mt-12 border-t border-slate-200 bg-white py-6 text-center text-xs text-brand-muted">
        <p>Gestión Global · gestionglobal.ar</p>
        <p className="mt-1">
          ¿Problemas con el acceso? Escribinos a{' '}
          <a href="mailto:contacto@gestionglobal.ar" className="text-brand-cyan hover:underline">
            contacto@gestionglobal.ar
          </a>
        </p>
      </footer>
    </div>
  );
}
