// PlataformaMuyProntoPage · placeholder de la futura plataforma SaaS.
// Pedido por el usuario 2026-06-02 (E-GG-32): los 2 CTAs "Conocer/Probar la
// plataforma" del landing apuntaban a /ingresar (panel propio). Hasta que
// se lance la plataforma SaaS para administradores externos, ambos CTAs
// llevan acá. NO revela el nombre interno de la plataforma porque cambia.

import { Link } from 'react-router-dom';
import { Sparkles, ArrowLeft, Rocket } from 'lucide-react';
import { SiteNav } from '@/components/site/SiteNav';
import { SiteFooter } from '@/components/site/SiteFooter';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { WhatsAppFloatingButton } from '@/components/common/WhatsAppFloatingButton';

export function PlataformaMuyProntoPage() {
  return (
    <div className="min-h-screen bg-brand-ink text-white">
      <SiteNav />

      <main className="relative isolate overflow-hidden">
        <TrianglesAccent
          position="top-right"
          size={420}
          tone="cyan"
          density="rich"
          className="opacity-25"
        />
        <TrianglesAccent
          position="bottom-left"
          size={360}
          tone="teal"
          density="soft"
          className="opacity-20"
        />

        <section className="mx-auto flex max-w-3xl flex-col items-center px-6 py-24 text-center sm:py-32">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan-light backdrop-blur">
            <Sparkles size={12} /> Muy pronto
          </span>

          <h1 className="mt-8 font-display text-5xl font-extrabold leading-tight tracking-tight sm:text-6xl">
            Estamos construyendo algo{' '}
            <span className="bg-gradient-to-r from-brand-cyan-light to-brand-orange bg-clip-text text-transparent">
              revolucionario.
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/75">
            Una plataforma pensada para administradores de consorcios que
            transforma tu día a día. Menos papeles, menos errores, mucho más
            tiempo para lo que importa. Está en su recta final.
          </p>

          <div className="mt-12 grid w-full max-w-md gap-3 sm:grid-cols-2">
            <Link
              to="/"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/10"
            >
              <ArrowLeft size={14} /> Volver al inicio
            </Link>
            <a
              href="#contactanos"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-brand-cyan px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-cyan/90"
            >
              <Rocket size={14} /> Contactanos
            </a>
          </div>

          <p
            id="contactanos"
            className="mt-16 max-w-lg text-sm text-white/55"
          >
            ¿Querés que te avisemos cuando lance? Usá el botón de WhatsApp y
            te sumamos a la lista de prioridad.
          </p>
        </section>
      </main>

      <WhatsAppFloatingButton mensaje="Hola! Me interesa la plataforma que están por lanzar. ¿Pueden avisarme cuando esté disponible?" />

      <SiteFooter />
    </div>
  );
}
