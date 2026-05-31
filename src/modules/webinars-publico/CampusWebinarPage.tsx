// CampusWebinarPage · G2 (DGG-15).
// Wrapper premium "Campus" para que el prospecto acceda al webinar via magic-link
// sin login, dentro del shell visual del Campus (en vez de la página standalone).
//
// Ruta: /campus/webinar/:token
// - Header con logo BrandMark + "Campus · Webinar invitado"
// - Cuerpo: WebinarBodyContent (compartido con la versión standalone)
// - Footer: CTA al landing institucional + ayuda
//
// El prospecto NO matricula al Campus completo: este wrapper se sirve sin auth
// y la edge function `webinar-acceso` resuelve el token con service_role.

import { useParams, Link } from 'react-router-dom';
import {
  AlertCircle,
  Calendar,
  Clock,
  Loader2,
  GraduationCap,
  Radio,
  ArrowRight,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { WebinarBodyContent } from './WebinarBodyContent';
import { useCountdown, useWebinarAcceso } from './useWebinarAcceso';

function fmtFecha(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-AR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function CampusWebinarPage() {
  const { token } = useParams<{ token: string }>();
  const acceso = useWebinarAcceso(token);
  const countdown = useCountdown(
    acceso.state === 'ok' ? acceso.resp.webinar.fecha_hora : new Date().toISOString(),
  );

  // Loading
  if (acceso.state === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-50 via-white to-brand-cyan/5 p-6">
        <div className="flex items-center gap-2 text-brand-muted">
          <Loader2 size={20} className="animate-spin" />
          <span>Cargando webinar…</span>
        </div>
      </div>
    );
  }

  // Error
  if (acceso.state === 'error') {
    return (
      <div className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-50 to-red-50 p-6">
        <div className="max-w-md rounded-3xl border border-red-200 bg-white p-8 text-center shadow-xl">
          <AlertCircle size={40} className="mx-auto mb-3 text-red-500" />
          <h1 className="font-display text-xl font-bold text-brand-ink">
            No pudimos abrir el webinar
          </h1>
          <p className="mt-2 text-sm text-brand-muted">{acceso.message}</p>
          <p className="mt-4 text-xs text-brand-muted">
            Si recibiste un link reciente y no funciona, contactanos a{' '}
            <a href="mailto:contacto@gestionglobal.ar" className="text-brand-cyan underline">
              contacto@gestionglobal.ar
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  const { webinar, inscripto } = acceso.resp;
  const esProspecto = inscripto.es_prospecto;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-brand-cyan/5">
      {/* Top bar estilo Campus */}
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="inline-flex items-center gap-2 transition hover:opacity-85">
            <BrandMark variant="dark" size={28} />
          </Link>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-500">
            <GraduationCap size={14} className="text-brand-cyan" />
            <span className="hidden font-semibold text-slate-700 sm:inline">Campus · Webinar invitado</span>
            <span className="font-semibold text-slate-700 sm:hidden">Campus</span>
          </div>
        </div>
      </header>

      {/* Hero compacto Campus-style */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-night via-brand-night to-brand-cyan px-6 py-10 text-white sm:py-14">
        <TrianglesAccent position="top-right" tone="cyan" className="opacity-25" />
        <TrianglesAccent position="bottom-left" tone="cyan" className="opacity-15" />
        <div className="relative mx-auto max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] uppercase tracking-widest text-brand-cyan-pale ring-1 ring-white/20">
            <Radio size={11} /> Webinar de Gestión Global
          </div>
          <h1 className="mt-3 font-display text-2xl font-bold sm:text-4xl">{webinar.titulo}</h1>
          {webinar.descripcion && (
            <p className="mt-3 max-w-2xl text-sm text-white/85 sm:text-base">{webinar.descripcion}</p>
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
      </section>

      {/* Cuerpo: estado + CTA principal */}
      <main className="mx-auto max-w-3xl px-6 py-8">
        <WebinarBodyContent
          resp={acceso.resp}
          countdown={countdown}
          // Mostramos un CTA propio del Campus debajo (más prolijo que el genérico).
          hideProspectoCta
        />

        {/* G2 · CTA Campus para prospectos */}
        {esProspecto && webinar.status !== 'cancelado' && (
          <div className="mt-8 overflow-hidden rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-cyan-50 p-2.5 text-cyan-700 ring-1 ring-cyan-100">
                <Sparkles size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-700">
                  Campus Gestión Global
                </p>
                <h3 className="mt-0.5 font-display text-lg font-bold text-brand-ink">
                  ¿Querés acceder a más cursos como administrador?
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  Convertirte en cliente te da matrícula gratis al Campus completo: formación
                  continua RPAC, encuentros mensuales, recursos jurídicos y certificación.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <a
                    href="https://gestionglobal.ar/servicios"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue"
                  >
                    Conocé los servicios <ArrowRight size={14} />
                  </a>
                  <a
                    href="https://gestionglobal.ar"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    gestionglobal.ar <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-12 border-t border-slate-200 bg-white py-6 text-center text-xs text-brand-muted">
        <p>Gestión Global · Campus</p>
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
