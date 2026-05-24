import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Radio,
  Video,
  Youtube,
} from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { cn } from '@/lib/cn';

// DGG-11/15: página pública (sin login) que se accede vía magic-link
// /webinar/:token. Muestra datos del webinar + botón "Unirme al webinar"
// según el canal asignado al inscripto (Zoom o YouTube Live).

interface Resp {
  ok: true;
  inscripto: {
    id: string;
    nombre: string;
    email: string;
    canal: 'zoom' | 'youtube';
    es_prospecto: boolean;
    es_cliente: boolean;
    asistio: boolean;
    tiempo_conectado_seg: number;
  };
  webinar: {
    id: string;
    titulo: string;
    descripcion: string | null;
    fecha_hora: string;
    duracion_min: number;
    status: 'programado' | 'en_curso' | 'finalizado' | 'cancelado';
    plataforma: 'zoom' | 'webex';
    grabacion_url: string | null;
  };
  acceso: {
    canal: 'zoom' | 'youtube';
    join_url: string | null;
    zoom_password: string | null;
    zoom_meeting_number: string | null;
    in_window: boolean;
    is_future: boolean;
    is_past: boolean;
    vence_at: string;
  };
}

interface ErrResp {
  ok: false;
  error: { code: string; message: string };
}

function fmtFecha(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-AR', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function useCountdown(targetIso: string): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const target = new Date(targetIso).getTime();
  const diff = Math.max(0, target - now);
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function WebinarPublicoPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [resp, setResp] = useState<Resp | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // CRÍTICO: TODOS los hooks deben llamarse ANTES de cualquier early return
  // (React error #310). useCountdown se usa solo si el webinar es futuro,
  // pero el hook se llama siempre con un valor seguro.
  const countdown = useCountdown(resp?.webinar?.fecha_hora ?? new Date().toISOString());

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webinar-acceso/${token}`;
        const res = await fetch(url, {
          headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
        });
        const j = (await res.json()) as Resp | ErrResp;
        if (cancelled) return;
        if (!j.ok) {
          setErrorMsg(j.error?.message ?? 'Acceso no válido');
          setState('error');
          return;
        }
        setResp(j);
        setState('ok');
      } catch (e) {
        if (cancelled) return;
        setErrorMsg('No pudimos cargar el webinar. Probá de nuevo en unos minutos.');
        setState('error');
      }
    }
    void fetchData();
    return () => { cancelled = true; };
  }, [token]);

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-brand-cyan/5 grid place-items-center p-6">
        <div className="flex items-center gap-2 text-brand-muted">
          <Loader2 size={20} className="animate-spin" />
          <span>Cargando webinar…</span>
        </div>
      </div>
    );
  }

  if (state === 'error' || !resp) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-red-50 grid place-items-center p-6">
        <div className="max-w-md rounded-3xl border border-red-200 bg-white p-8 text-center shadow-xl">
          <AlertCircle size={40} className="mx-auto mb-3 text-red-500" />
          <h1 className="font-display text-xl font-bold text-brand-ink">No pudimos abrir el webinar</h1>
          <p className="mt-2 text-sm text-brand-muted">{errorMsg}</p>
          <p className="mt-4 text-xs text-brand-muted">
            Si recibiste un link reciente y no funciona, contactanos a{' '}
            <a href="mailto:cursos@gestionglobal.ar" className="text-brand-cyan underline">cursos@gestionglobal.ar</a>.
          </p>
        </div>
      </div>
    );
  }

  const { webinar, acceso, inscripto } = resp;
  const isLive = webinar.status === 'en_curso';
  const isFinished = webinar.status === 'finalizado' || acceso.is_past;
  const isCancelled = webinar.status === 'cancelado';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-brand-cyan/5">
      {/* Header hero gradiente */}
      <div className="relative overflow-hidden bg-gradient-to-br from-brand-navy via-brand-navy to-brand-cyan py-12 px-6 text-white">
        <TrianglesAccent position="top-right" tone="cyan" className="opacity-20" />
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-brand-cyan/80">
            <Radio size={14} /> Webinar de Gestión Global
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

      {/* Cuerpo principal */}
      <div className="mx-auto max-w-3xl px-6 py-8">
        {/* Saludo personalizado */}
        <div className="mb-6 text-center">
          <p className="text-sm text-brand-muted">Hola</p>
          <p className="font-display text-xl font-semibold text-brand-ink">{inscripto.nombre}</p>
        </div>

        {/* Estado del webinar + CTA principal */}
        {isCancelled && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
            <AlertCircle size={28} className="mx-auto mb-2 text-amber-600" />
            <p className="font-semibold text-amber-900">Este webinar fue cancelado</p>
            <p className="mt-1 text-sm text-amber-700">Te avisaremos por email cuando se reprograme.</p>
          </div>
        )}

        {isLive && acceso.join_url && (
          <div className="rounded-3xl border-2 border-red-300 bg-gradient-to-br from-red-50 to-white p-6 shadow-lg">
            <div className="flex items-center justify-center gap-2 text-red-700 mb-3">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500"></span>
              </span>
              <span className="text-sm font-semibold uppercase tracking-wider">En vivo ahora</span>
            </div>
            <a
              href={acceso.join_url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'block w-full rounded-xl py-4 text-center font-display text-lg font-bold text-white shadow-md transition hover:scale-[1.01]',
                acceso.canal === 'zoom' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-red-600 hover:bg-red-700',
              )}
            >
              <span className="inline-flex items-center gap-2">
                {acceso.canal === 'zoom' ? <Video size={20} /> : <Youtube size={20} />}
                Unirme al webinar
                <ExternalLink size={16} />
              </span>
            </a>
            {acceso.canal === 'zoom' && acceso.zoom_password && (
              <p className="mt-3 text-center text-xs text-brand-muted">
                Si pide contraseña: <span className="font-mono font-semibold text-brand-ink">{acceso.zoom_password}</span>
              </p>
            )}
            <p className="mt-3 text-center text-xs text-brand-muted">
              {acceso.canal === 'zoom' ? 'Te conectás por Zoom · asistencia automática' : 'Te conectás por YouTube Live'}
            </p>
          </div>
        )}

        {!isLive && !isFinished && !isCancelled && acceso.is_future && (
          <div className="rounded-3xl border border-brand-cyan/30 bg-gradient-to-br from-brand-cyan/5 to-white p-8 text-center shadow-lg">
            <p className="text-xs uppercase tracking-widest text-brand-muted">Empieza en</p>
            <p className="mt-2 font-display text-4xl font-bold tabular-nums text-brand-cyan">{countdown}</p>
            <p className="mt-3 text-sm text-brand-muted">
              Te asignamos canal <strong className="text-brand-ink">{acceso.canal === 'zoom' ? 'Zoom' : 'YouTube Live'}</strong>.
              Volvé a esta página el día del evento para entrar.
            </p>
            {acceso.canal === 'zoom' && (
              <p className="mt-2 text-xs text-brand-muted">
                Tu asistencia se va a registrar automáticamente cuando entres por Zoom.
              </p>
            )}
          </div>
        )}

        {isFinished && (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-center mb-4">
              <CheckCircle2 size={32} className="mx-auto mb-2 text-green-600" />
              <p className="font-display text-lg font-semibold text-brand-ink">El webinar finalizó</p>
              {inscripto.asistio && (
                <p className="mt-1 text-sm text-green-700">¡Gracias por participar!</p>
              )}
            </div>
            {webinar.grabacion_url && (
              <a
                href={webinar.grabacion_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-xl bg-brand-cyan py-3 text-center font-semibold text-white hover:bg-brand-cyan/90"
              >
                <span className="inline-flex items-center gap-2">
                  <Video size={16} /> Ver grabación <ExternalLink size={14} />
                </span>
              </a>
            )}
          </div>
        )}

        {/* CTA prospecto: invitación a conocer Gestión Global */}
        {inscripto.es_prospecto && !isCancelled && (
          <div className="mt-6 rounded-2xl border border-brand-cyan/20 bg-gradient-to-br from-brand-cyan/5 to-white p-5 text-center">
            <p className="kicker">¿Querés conocer Gestión Global?</p>
            <h3 className="mt-1 font-display text-lg font-bold text-brand-ink">
              Servicios para administradores de consorcios
            </h3>
            <p className="mt-2 text-sm text-brand-muted">
              Si te resultó útil este webinar, te interesará conocer todo lo que hacemos: matriculación RPAC,
              DDJJ, jurídico, Administración Global SaaS y más.
            </p>
            <a
              href="https://gestionglobal.ar"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-brand-cyan bg-white px-4 py-2 text-sm font-semibold text-brand-cyan hover:bg-brand-cyan hover:text-white transition"
            >
              Visitar gestionglobal.ar <ExternalLink size={13} />
            </a>
          </div>
        )}
      </div>

      <footer className="mt-12 border-t border-slate-200 bg-white py-6 text-center text-xs text-brand-muted">
        <p>Gestión Global · gestionglobal.ar</p>
        <p className="mt-1">
          ¿Problemas con el acceso? Escribinos a{' '}
          <a href="mailto:cursos@gestionglobal.ar" className="text-brand-cyan hover:underline">
            cursos@gestionglobal.ar
          </a>
        </p>
      </footer>
    </div>
  );
}
