// WebinarBodyContent · cuerpo compartido entre la página standalone y el wrapper Campus.
// Recibe el `resp` ya resuelto + countdown ya calculado.

import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Video,
  Youtube,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import type { WebinarAccesoResp } from './useWebinarAcceso';

interface Props {
  resp: WebinarAccesoResp;
  countdown: string;
  /** Cuando true, oculta el CTA prospecto (en el wrapper Campus aparece como CTA propio del Campus). */
  hideProspectoCta?: boolean;
}

export function WebinarBodyContent({ resp, countdown, hideProspectoCta }: Props) {
  const { webinar, acceso, inscripto } = resp;
  const isLive = webinar.status === 'en_curso';
  const isFinished = webinar.status === 'finalizado' || acceso.is_past;
  const isCancelled = webinar.status === 'cancelado';

  return (
    <>
      {/* Saludo personalizado */}
      <div className="mb-6 text-center">
        <p className="text-sm text-brand-muted">Hola</p>
        <p className="font-display text-xl font-semibold text-brand-ink">{inscripto.nombre}</p>
      </div>

      {isCancelled && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <AlertCircle size={28} className="mx-auto mb-2 text-amber-600" />
          <p className="font-semibold text-amber-900">Este webinar fue cancelado</p>
          <p className="mt-1 text-sm text-amber-700">
            Te avisaremos por email cuando se reprograme.
          </p>
        </div>
      )}

      {isLive && acceso.join_url && (
        <div className="rounded-3xl border-2 border-red-300 bg-gradient-to-br from-red-50 to-white p-6 shadow-lg">
          <div className="mb-3 flex items-center justify-center gap-2 text-red-700">
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
              Si pide contraseña:{' '}
              <span className="font-mono font-semibold text-brand-ink">{acceso.zoom_password}</span>
            </p>
          )}
          <p className="mt-3 text-center text-xs text-brand-muted">
            {acceso.canal === 'zoom'
              ? 'Te conectás por Zoom · asistencia automática'
              : 'Te conectás por YouTube Live'}
          </p>
        </div>
      )}

      {!isLive && !isFinished && !isCancelled && acceso.is_future && (
        <div className="rounded-3xl border border-brand-cyan/30 bg-gradient-to-br from-brand-cyan/5 to-white p-8 text-center shadow-lg">
          <p className="text-xs uppercase tracking-widest text-brand-muted">Empieza en</p>
          <p className="mt-2 font-display text-4xl font-bold tabular-nums text-brand-cyan">{countdown}</p>
          <p className="mt-3 text-sm text-brand-muted">
            Te asignamos canal{' '}
            <strong className="text-brand-ink">{acceso.canal === 'zoom' ? 'Zoom' : 'YouTube Live'}</strong>.
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
          <div className="mb-4 text-center">
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

      {!hideProspectoCta && inscripto.es_prospecto && !isCancelled && (
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
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-brand-cyan bg-white px-4 py-2 text-sm font-semibold text-brand-cyan transition hover:bg-brand-cyan hover:text-white"
          >
            Visitar gestionglobal.ar <ExternalLink size={13} />
          </a>
        </div>
      )}
    </>
  );
}
