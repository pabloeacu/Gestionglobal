// LandingOpiniones · DGG-241
// Dos franjas públicas de opiniones, diferenciadas por lugar Y estética
// (pedido de Pablo 2026-11-03, para que no se mezclen "alumnos" con "servicios"):
//   • <OpinionesServicios/> → debajo de "Cómo trabajamos". Opiniones sobre la
//     GESTIÓN/servicio. Tratamiento petróleo, ícono de cita, sin métricas de
//     curso. Fondo claro: además rompe el "dark+dark" entre Cómo trabajamos y
//     Plataforma.
//   • <OpinionesAlumnos/>   → debajo de "Formate con los mejores". La voz de los
//     ALUMNOS. Tratamiento cian/académico + métricas reales en vivo + SEO.
// Ambas leen la misma RPC pública (una sola llamada, deduplicada) y se ocultan
// solas si no hay cards de su categoría. El comportamiento del carrusel (autoplay,
// snap, flechas) es idéntico en las dos.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, GraduationCap, MessageSquareQuote, Quote, Star, Users } from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import {
  getLandingOpinionesPublicas,
  type LandingCardPublica,
  type LandingCategoria,
  type LandingOpinionesPublicas,
} from '@/services/api/landingOpiniones';
import type { ApiResponse } from '@/lib/errors';

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

// Estrellas con relleno parcial (4.8/5 → 96% de ancho dorado sobre 5 grises).
function EstrellasRelleno({ valor }: { valor: number }) {
  const pct = Math.max(0, Math.min(100, (valor / 5) * 100));
  return (
    <div className="relative inline-flex" aria-hidden>
      <div className="flex gap-0.5 text-slate-200">
        {[0, 1, 2, 3, 4].map((i) => <Star key={i} size={18} className="fill-current" />)}
      </div>
      <div className="absolute inset-0 flex gap-0.5 overflow-hidden text-amber-400" style={{ width: `${pct}%` }}>
        {[0, 1, 2, 3, 4].map((i) => <Star key={i} size={18} className="shrink-0 fill-current" />)}
      </div>
    </div>
  );
}

// Barra horizontal minimalista (p. ej. satisfacción 9.1/10).
function BarraValor({ valor, max }: { valor: number; max: number }) {
  const pct = Math.max(0, Math.min(100, (valor / max) * 100));
  return (
    <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-200/80" aria-hidden>
      <div className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-teal" style={{ width: `${pct}%` }} />
    </div>
  );
}

// Viz de cada card estadística según el `kind` de la métrica.
function MetricaViz({ kind, valor }: { kind: string; valor: string }) {
  const num = parseFloat(valor.replace(',', '.'));
  if (kind === 'estrellas_global' && Number.isFinite(num)) return <EstrellasRelleno valor={num} />;
  if (kind === 'escala_global' && Number.isFinite(num)) return <BarraValor valor={num} max={10} />;
  if (kind === 'opiniones' || kind === 'publicables') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-cyan/10 px-3 py-1 text-xs font-semibold text-brand-teal">
        <Users size={13} /> alumnos reales
      </span>
    );
  }
  return null;
}

// ---- fetch deduplicado: ambas franjas comparten UNA llamada por carga ----
let _enVuelo: Promise<ApiResponse<LandingOpinionesPublicas>> | null = null;
function fetchOpiniones(): Promise<ApiResponse<LandingOpinionesPublicas>> {
  if (!_enVuelo) {
    _enVuelo = getLandingOpinionesPublicas().finally(() => { _enVuelo = null; });
  }
  return _enVuelo;
}

function useOpiniones(): LandingOpinionesPublicas | null {
  const [data, setData] = useState<LandingOpinionesPublicas | null>(null);
  useEffect(() => {
    let vivo = true;
    void fetchOpiniones().then((r) => { if (vivo && r.ok) setData(r.data); });
    return () => { vivo = false; };
  }, []);
  return data;
}

// ============================================================================
// Carrusel compartido · `variant` cambia la estética de cada card para que las
// opiniones de servicios y las de alumnos se distingan a simple vista.
// ============================================================================
function Carrusel({ cards, variant, label }: { cards: LandingCardPublica[]; variant: LandingCategoria; label: string }) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const esServicio = variant === 'servicio';

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

  return (
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
        aria-label={label}
        tabIndex={0}
        className="flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {cards.map((c, i) => (
          <figure
            key={`${c.nombre}-${i}`}
            className={
              esServicio
                // SERVICIO · acento petróleo + borde izquierdo marcado + ícono de cita.
                ? 'flex w-[300px] shrink-0 snap-start flex-col rounded-2xl border border-slate-200 border-l-4 border-l-brand-teal bg-white p-7 sm:w-[340px]'
                // ALUMNO · card limpia, comilla tipográfica cian + estrellas doradas.
                : 'flex w-[300px] shrink-0 snap-start flex-col rounded-2xl border border-slate-200 bg-white p-7 sm:w-[340px]'
            }
          >
            {esServicio ? (
              <span aria-hidden className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand-teal/10 text-brand-teal">
                <Quote size={18} className="fill-current" />
              </span>
            ) : (
              <span aria-hidden className="select-none font-display text-6xl font-bold leading-[0.5] text-brand-cyan/25">
                &ldquo;
              </span>
            )}
            {!esServicio && c.estrellas != null && <div className="mt-4"><Estrellas n={c.estrellas} /></div>}
            <blockquote className={`${esServicio ? 'mt-4' : 'mt-3'} flex-1 text-[15px] leading-relaxed text-brand-ink/85`}>
              {c.comentario}
            </blockquote>
            <figcaption className="mt-6 flex items-center gap-3 border-t border-slate-100 pt-4">
              {c.foto_url && /^https:\/\//.test(c.foto_url) ? (
                <img src={c.foto_url} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-slate-200" />
              ) : (
                <span className={
                  esServicio
                    ? 'grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-teal/10 text-sm font-bold text-brand-teal'
                    : 'grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-cyan/10 text-sm font-bold text-brand-cyan'
                }>
                  {iniciales(c.nombre)}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-brand-ink">{c.nombre}</p>
                {c.curso && (
                  <p className={`truncate text-xs ${esServicio ? 'text-brand-teal' : 'text-brand-muted'}`}>{c.curso}</p>
                )}
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Opiniones de SERVICIOS · debajo de "Cómo trabajamos" (fondo claro petróleo).
// ============================================================================
export function OpinionesServicios() {
  const data = useOpiniones();
  const cards = useMemo(() => (data?.cards ?? []).filter((c) => c.categoria === 'servicio'), [data]);
  if (!data || !data.activa || cards.length === 0) return null;

  return (
    <section id="opiniones-servicios" className="relative overflow-hidden border-y border-brand-teal/15 bg-brand-zebra py-20 sm:py-24">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-teal via-brand-cyan to-brand-teal" />
      <TrianglesAccent className="pointer-events-none absolute -left-12 top-10 h-44 w-44 text-brand-teal/10" />
      <TrianglesAccent className="pointer-events-none absolute -right-12 bottom-8 h-36 w-36 rotate-180 text-brand-cyan/10" />
      <div className="relative mx-auto max-w-6xl px-6">
        <header className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-teal px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-white shadow-sm">
            <MessageSquareQuote size={15} /> Clientes
          </span>
          <p className="kicker mt-4 text-brand-teal">La experiencia de nuestros clientes</p>
          <h2 className="mt-2 font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            {data.titulo_servicios}
          </h2>
        </header>
        <Carrusel cards={cards} variant="servicio" label="Opiniones de clientes sobre el servicio" />
      </div>
    </section>
  );
}

// ============================================================================
// Opiniones de ALUMNOS · debajo de "Formate con los mejores" (fondo cian).
// Incluye las métricas reales en vivo + el JSON-LD de SEO (una sola vez).
// ============================================================================
export function OpinionesAlumnos() {
  const data = useOpiniones();
  const cards = useMemo(() => (data?.cards ?? []).filter((c) => c.categoria === 'alumno'), [data]);

  // JSON-LD para rich snippets (estrellas en Google) — usa TODAS las cards.
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
    <section id="opiniones" className="relative overflow-hidden border-y border-brand-cyan/15 bg-brand-pale/50 py-24 sm:py-28">
      {/* Capacitaciones = franja de color propio, separada de los servicios. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-cyan via-brand-teal to-brand-cyan" />
      <TrianglesAccent className="pointer-events-none absolute -right-12 top-10 h-48 w-48 text-brand-cyan/10" />
      <TrianglesAccent className="pointer-events-none absolute -left-12 bottom-8 h-40 w-40 rotate-180 text-brand-teal/10" />
      <div className="relative mx-auto max-w-6xl px-6">
        <header className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-brand-teal shadow-sm ring-1 ring-brand-cyan/20">
            <GraduationCap size={15} /> Capacitaciones
          </span>
          <p className="kicker mt-4 text-brand-cyan">La voz de los alumnos</p>
          <h2 className="mt-2 font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            {data.titulo}
          </h2>
        </header>

        {/* Métricas reales */}
        {data.metricas.length > 0 && (
          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {data.metricas.map((m, i) => (
              <div
                key={`${m.label}-${i}`}
                className="flex flex-col items-center rounded-2xl border border-brand-cyan/15 bg-white px-6 py-7 text-center shadow-sm ring-1 ring-black/[0.02]"
              >
                <p className="font-display text-4xl font-extrabold tabular-nums text-brand-cyan sm:text-5xl">
                  {m.valor}
                  {m.sufijo && <span className="ml-1 text-xl font-semibold text-brand-muted sm:text-2xl">{m.sufijo}</span>}
                </p>
                <div className="mt-3 flex min-h-[26px] items-center justify-center">
                  <MetricaViz kind={m.kind} valor={m.valor} />
                </div>
                <p className="mt-3 text-sm font-medium uppercase tracking-wide text-brand-muted">{m.label}</p>
                {m.hint && <p className="mt-0.5 text-[11px] font-normal normal-case tracking-normal text-brand-muted/80">{m.hint}</p>}
              </div>
            ))}
          </div>
        )}

        <Carrusel cards={cards} variant="alumno" label="Opiniones de alumnos" />
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
