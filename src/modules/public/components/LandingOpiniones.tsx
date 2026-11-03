// LandingOpiniones · DGG-241
// Sección pública "La voz de los alumnos": métricas reales (en vivo desde las
// encuestas) + carrusel de testimonios curados por gerencia. Se oculta sola si
// no está activa / no hay cards. SEO: schema.org AggregateRating + Review.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import {
  getLandingOpinionesPublicas,
  type LandingOpinionesPublicas,
} from '@/services/api/landingOpiniones';

function Estrellas({ n }: { n: number }) {
  const r = Math.round(n);
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${n} de 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} size={15} className={i < r ? 'fill-amber-400 text-amber-400' : 'text-slate-300'} />
      ))}
    </span>
  );
}

function iniciales(nombre: string): string {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

export function LandingOpiniones() {
  const [data, setData] = useState<LandingOpinionesPublicas | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let vivo = true;
    void getLandingOpinionesPublicas().then((r) => {
      if (vivo && r.ok) setData(r.data);
    });
    return () => { vivo = false; };
  }, []);

  const cards = data?.cards ?? [];

  // Autoplay suave del carrusel (pausado al interactuar / con reduced-motion).
  useEffect(() => {
    const el = scroller.current;
    if (!el || cards.length <= 1) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let pausado = false;
    const pausar = () => { pausado = true; };
    const seguir = () => { pausado = false; };
    el.addEventListener('pointerenter', pausar);
    el.addEventListener('pointerleave', seguir);
    el.addEventListener('focusin', pausar);
    el.addEventListener('focusout', seguir);
    const t = setInterval(() => {
      if (pausado || !el) return;
      const fin = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
      el.scrollTo({ left: fin ? 0 : el.scrollLeft + Math.min(360, el.clientWidth * 0.9), behavior: 'smooth' });
    }, 4500);
    return () => {
      clearInterval(t);
      el.removeEventListener('pointerenter', pausar);
      el.removeEventListener('pointerleave', seguir);
      el.removeEventListener('focusin', pausar);
      el.removeEventListener('focusout', seguir);
    };
  }, [cards.length]);

  const mover = (dir: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.min(360, el.clientWidth * 0.9), behavior: 'smooth' });
  };

  // JSON-LD para rich snippets (estrellas en Google).
  const jsonLd = useMemo(() => {
    if (!data || !data.agg?.rating || !data.agg?.count) return null;
    return {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Gestión Global',
      url: 'https://www.gestionglobal.ar',
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: String(data.agg.rating),
        bestRating: '5',
        ratingCount: String(data.agg.count),
      },
      review: (data.cards ?? []).slice(0, 10).map((c) => ({
        '@type': 'Review',
        author: { '@type': 'Person', name: c.nombre },
        reviewBody: c.comentario,
        ...(c.estrellas
          ? { reviewRating: { '@type': 'Rating', ratingValue: String(c.estrellas), bestRating: '5' } }
          : {}),
      })),
    };
  }, [data]);

  if (!data || !data.activa || cards.length === 0) return null;

  return (
    <section id="opiniones" className="relative overflow-hidden border-y border-slate-100 bg-brand-zebra/40 py-24">
      <TrianglesAccent className="pointer-events-none absolute -right-10 top-8 h-40 w-40 text-brand-cyan/10" />
      <div className="relative mx-auto max-w-6xl px-6">
        <header className="mx-auto max-w-2xl text-center">
          <p className="kicker text-brand-cyan">La voz de los alumnos</p>
          <h2 className="mt-2 font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            {data.titulo}
          </h2>
        </header>

        {/* Métricas reales */}
        {data.metricas.length > 0 && (
          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {data.metricas.map((m, i) => (
              <div key={`${m.label}-${i}`} className="rounded-2xl border border-slate-200 bg-white px-6 py-7 text-center">
                <p className="font-display text-4xl font-extrabold tabular-nums text-brand-cyan sm:text-5xl">
                  {m.valor}
                  {m.sufijo && <span className="ml-1 text-xl font-semibold text-brand-muted sm:text-2xl">{m.sufijo}</span>}
                </p>
                <p className="mt-2 text-sm font-medium uppercase tracking-wide text-brand-muted">{m.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Carrusel de testimonios */}
        <div className="relative mt-12">
          {cards.length > 1 && (
            <>
              <button
                type="button" aria-label="Anterior" onClick={() => mover(-1)}
                className="absolute -left-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-slate-200 bg-white p-2 text-brand-ink shadow-sm transition hover:border-brand-cyan hover:text-brand-cyan md:block"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button" aria-label="Siguiente" onClick={() => mover(1)}
                className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-slate-200 bg-white p-2 text-brand-ink shadow-sm transition hover:border-brand-cyan hover:text-brand-cyan md:block"
              >
                <ChevronRight size={20} />
              </button>
            </>
          )}

          <div
            ref={scroller}
            role="region"
            aria-roledescription="carrusel"
            aria-label="Opiniones de alumnos"
            tabIndex={0}
            className="flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {cards.map((c, i) => (
              <figure
                key={`${c.nombre}-${i}`}
                className="flex w-[300px] shrink-0 snap-start flex-col rounded-2xl border border-slate-200 bg-white p-7 sm:w-[340px]"
              >
                <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 text-brand-cyan">
                  <path d="M9 7H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2v2a2 2 0 0 1-2 2H4v2h1a4 4 0 0 0 4-4V7Zm10 0h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2v2a2 2 0 0 1-2 2h-1v2h1a4 4 0 0 0 4-4V7Z" />
                </svg>
                {c.estrellas != null && <div className="mt-3"><Estrellas n={c.estrellas} /></div>}
                <blockquote className="mt-3 flex-1 text-[15px] leading-relaxed text-brand-ink/85">
                  {c.comentario}
                </blockquote>
                <figcaption className="mt-6 flex items-center gap-3 border-t border-slate-100 pt-4">
                  {c.foto_url && /^https:\/\//.test(c.foto_url) ? (
                    <img src={c.foto_url} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-slate-200" />
                  ) : (
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-cyan/10 text-sm font-bold text-brand-cyan">
                      {iniciales(c.nombre)}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-brand-ink">{c.nombre}</p>
                    {c.curso && <p className="truncate text-xs text-brand-muted">{c.curso}</p>}
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </div>

      {jsonLd && (
        <script
          type="application/ld+json"
          // Escapamos < > & para que ningún comentario de alumno con "</script>" rompa el tag (XSS).
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026') }}
        />
      )}
    </section>
  );
}
