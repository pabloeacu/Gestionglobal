import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Scale, GraduationCap, FileText } from 'lucide-react';
import { BrandBackdrop } from '@/components/brand/BrandBackdrop';
import { BrandMark } from '@/components/brand/BrandMark';

const PILARES = [
  { icon: ShieldCheck, label: 'Gestoría RPAC / RPA' },
  { icon: FileText, label: 'Declaraciones juradas' },
  { icon: GraduationCap, label: 'Campus y formación' },
  { icon: Scale, label: 'Asesoría jurídica' },
];

// Landing institucional (placeholder premium de Fase 2: estructura comercial
// completa más adelante). Identidad: degradé nocturno + logo + grafismos.
export function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-brand-night font-sans text-white">
      <BrandBackdrop />

      {/* top bar */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <BrandMark variant="dark" size={38} />
        <Link
          to="/ingresar"
          className="rounded-full border border-white/20 px-5 py-2 text-sm font-medium text-white/90 backdrop-blur transition hover:border-white/40 hover:bg-white/5"
        >
          Ingresar
        </Link>
      </header>

      {/* hero */}
      <main className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-6 pb-24 pt-16 text-center sm:pt-24">
        <span className="animate-fade-up rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-cyan-light backdrop-blur">
          Aliados de tu tiempo
        </span>

        <h1
          className="mt-8 animate-fade-up font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl"
          style={{ animationDelay: '80ms' }}
        >
          Respaldamos cada paso
          <br />
          <span className="bg-gradient-to-r from-brand-cyan-light via-white to-brand-teal bg-clip-text text-transparent">
            de tu gestión.
          </span>
        </h1>

        <p
          className="mt-6 max-w-xl animate-fade-up text-base leading-relaxed text-white/65 sm:text-lg"
          style={{ animationDelay: '160ms' }}
        >
          El ecosistema integral para administradores de consorcios: trámites,
          matrículas, facturación, campus y gestión — en un solo lugar, bajo
          gestionglobal.ar.
        </p>

        <div
          className="mt-10 flex animate-fade-up flex-col items-center gap-4 sm:flex-row"
          style={{ animationDelay: '240ms' }}
        >
          <Link
            to="/ingresar"
            className="group relative inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-cyan to-brand-blue px-8 py-3.5 font-semibold text-white shadow-[0_8px_30px_-8px_rgba(0,158,202,0.7)] transition hover:shadow-[0_12px_40px_-8px_rgba(0,158,202,0.9)]"
          >
            Ingresar a la plataforma
            <ArrowRight size={18} className="transition group-hover:translate-x-1" />
          </Link>
          <a
            href="#servicios"
            className="rounded-full px-6 py-3.5 text-sm font-medium text-white/70 transition hover:text-white"
          >
            Conocer los servicios
          </a>
        </div>

        {/* pilares */}
        <div
          id="servicios"
          className="mt-20 grid w-full animate-fade-up grid-cols-2 gap-3 sm:grid-cols-4"
          style={{ animationDelay: '320ms' }}
        >
          {PILARES.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur transition hover:border-white/20 hover:bg-white/[0.07]"
            >
              <Icon size={22} className="mx-auto text-brand-cyan-light" />
              <p className="mt-3 text-xs font-medium text-white/75">{label}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="relative z-10 mx-auto max-w-6xl px-6 pb-10 text-center text-xs text-white/40">
        #AliadosDeTuTiempo · contacto@gestionglobal.ar · Global Servicios
        Integrados SRL
      </footer>
    </div>
  );
}
