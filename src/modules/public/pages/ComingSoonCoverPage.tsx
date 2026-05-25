// ============================================================================
// ComingSoonCoverPage · DGG-27
//
// "Cortina" pre-lanzamiento que cubre la landing pública (`/`). Mientras
// `config_global.landing_cover_enabled = true`, todo visitante anónimo ve
// esta página. Usuarios logueados bypassan automáticamente (ven la landing
// real). El acceso a /ingresar, /gerencia, /portal, /externo, /webinar,
// /verificar nunca se cubre.
//
// Estética: hero gradient ink → cyan (consistencia con la marca), logo
// vertical con slogan centrado, triángulos decorativos, título display,
// subtítulo, "stay tuned" con redes/contacto.
// ============================================================================

import { Instagram, Facebook, Mail, Phone, Sparkles } from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';

export function ComingSoonCoverPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-brand-ink via-brand-ink to-[#073f4d] text-white">
      {/* Triángulos de marca · esquinas */}
      <TrianglesAccent
        position="top-right"
        size={420}
        tone="cyan"
        density="rich"
        className="opacity-50"
      />
      <TrianglesAccent
        position="bottom-left"
        size={340}
        tone="teal"
        density="soft"
        className="opacity-35"
      />

      {/* Aura cyan flotante de fondo */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-cyan/10 blur-[140px]" />
      <div className="pointer-events-none absolute right-[5%] top-[20%] h-[320px] w-[320px] rounded-full bg-teal-500/15 blur-[100px]" />

      <main className="relative z-10 mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-6 py-16 text-center">
        {/* Logo vertical centrado */}
        <div className="animate-fade-up">
          <BrandMark
            variant="dark"
            orientation="vertical"
            withSlogan
            size={220}
          />
        </div>

        {/* Chip "viene algo" */}
        <div
          className="mt-10 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-brand-cyan animate-fade-up backdrop-blur"
          style={{ animationDelay: '120ms' }}
        >
          <Sparkles size={13} className="text-brand-cyan" />
          Pronto · Nueva era
        </div>

        {/* Título display */}
        <h1
          className="mt-7 max-w-3xl font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl animate-fade-up"
          style={{ animationDelay: '200ms' }}
        >
          Proyectando mejoras
          <br />
          <span className="bg-gradient-to-r from-brand-cyan via-cyan-300 to-teal-300 bg-clip-text text-transparent">
            extraordinarias
          </span>
        </h1>

        {/* Subtítulo */}
        <p
          className="mt-7 max-w-2xl text-lg leading-relaxed text-white/75 animate-fade-up sm:text-xl"
          style={{ animationDelay: '300ms' }}
        >
          Estamos preparando una nueva era para la gestión de tu administración.
          <br className="hidden sm:block" />
          Volvemos muy pronto con un ecosistema integral, premium y a la altura
          de tu trabajo.
        </p>

        {/* CTA suave · contacto */}
        <div
          className="mt-12 flex flex-col items-center gap-4 animate-fade-up"
          style={{ animationDelay: '400ms' }}
        >
          <p className="text-xs uppercase tracking-[0.2em] text-white/55">
            Mientras tanto, escribinos
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href="mailto:contacto@gestionglobal.ar"
              className="group inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition hover:border-brand-cyan/50 hover:bg-brand-cyan/15"
            >
              <Mail size={15} className="text-brand-cyan" />
              contacto@gestionglobal.ar
            </a>
            <a
              href="https://wa.me/5492214317914"
              className="group inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition hover:border-brand-cyan/50 hover:bg-brand-cyan/15"
              target="_blank"
              rel="noreferrer"
            >
              <Phone size={15} className="text-brand-cyan" />
              +54 9 221 431-7914
            </a>
          </div>
          <div className="flex items-center gap-4 pt-2">
            <a
              href="https://www.instagram.com/gestionglobal.ar/"
              aria-label="Instagram"
              target="_blank"
              rel="noreferrer"
              className="text-white/65 transition hover:text-brand-cyan"
            >
              <Instagram size={22} />
            </a>
            <a
              href="https://www.facebook.com/gestionglobal.ar"
              aria-label="Facebook"
              target="_blank"
              rel="noreferrer"
              className="text-white/65 transition hover:text-brand-cyan"
            >
              <Facebook size={22} />
            </a>
          </div>
        </div>

        {/* Footer fino */}
        <footer
          className="absolute bottom-6 left-0 right-0 flex flex-col items-center gap-1 text-[11px] text-white/50 animate-fade-up"
          style={{ animationDelay: '500ms' }}
        >
          <p>
            © {new Date().getFullYear()} Gestión Global · #AliadosDeTuTiempo
          </p>
          <p className="text-white/30">gestionglobal.ar</p>
        </footer>
      </main>
    </div>
  );
}
