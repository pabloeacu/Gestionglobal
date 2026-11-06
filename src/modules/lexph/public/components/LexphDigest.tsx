// DGG-244 F2c · Digest editorial de la EDICIÓN actual en la web (rediseño revista).
// Las 4 piezas del molde de Pablo, en un SPREAD tipo diario: cabecera + apartado
// "Scan rápido" (resumen ejecutivo, índice 01–05) + spread de dos columnas donde
// la izquierda es la columna larga de lectura (intro con capitular + teaser del
// editorial → nota independiente /lexph/editorial) y la derecha es el carrusel de
// "Tendencias por materia" (scroll-snap, sin librería). Full-width (max-w-6xl) y
// sólo azules de marca (cero naranja). El editorial completo vive en la nota.

import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Lightbulb, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import type { LexphEdicionActual } from '@/services/api/lexphPublic';
import { fmtFechaLarga } from './shared';

// Rotación de colores de marca para las materias de "Tendencias" (cero naranja).
const MATERIA_COLORS = ['#009ECA', '#159AA6', '#2E6FB0', '#0B1F33'];

export function LexphDigest({ edicion }: { edicion: LexphEdicionActual }) {
  const intro = edicion.intro?.trim();
  const resumen = Array.isArray(edicion.resumen) ? edicion.resumen : [];
  const tendencias = Array.isArray(edicion.tendencias) ? edicion.tendencias : [];
  const editorial = edicion.editorial ?? {};
  const hasEditorial = Boolean(editorial.titulo || editorial.cuerpo);
  const sello = edicion.publicado_at ? `Edición · ${fmtFechaLarga(edicion.publicado_at)}` : 'Esta edición';
  const bajada = (editorial.cuerpo ?? '').split('\n\n')[0] ?? '';

  const trackRef = useRef<HTMLUListElement>(null);
  const scrollTrack = (dir: 1 | -1) =>
    trackRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });

  if (!intro && resumen.length === 0 && tendencias.length === 0 && !hasEditorial) return null;

  return (
    <section className="relative border-t border-slate-200 bg-slate-50">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <TrianglesAccent position="top-right" tone="teal" density="soft" size={220} className="opacity-[0.07]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-6 py-10 sm:py-12">
        {/* ---------- Cabecera del spread (patrón Section del home) ---------- */}
        <div className="mb-8 flex items-baseline justify-between gap-4 border-t-2 border-brand-cyan pt-3.5">
          <h2 className="font-gg-display text-2xl font-bold uppercase tracking-[0.03em] text-brand-cyan">
            La edición
          </h2>
          <span className="font-gg-display shrink-0 text-[11px] uppercase tracking-[0.12em] text-brand-muted tabular-nums">
            {sello}
          </span>
        </div>

        {/* ---------- Resumen ejecutivo — apartado "Scan rápido" (índice 01–05) ---------- */}
        {resumen.length > 0 && (
          <div className="lexph-chamfer-sm mb-10 border border-slate-200 bg-white p-6 shadow-[0_18px_40px_-30px_rgb(var(--brand-night-rgb)/0.45)]">
            <p className="font-gg-display mb-1 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-teal">
              <ClipboardList size={15} /> Scan rápido
            </p>
            <h3 className="font-display text-xl font-extrabold text-brand-ink">Resumen ejecutivo</h3>
            <div className="mb-5 mt-3 h-0.5 w-10 bg-brand-cyan" />
            <ol className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              {resumen.map((b, i) => (
                <li key={i} className="flex gap-3.5">
                  <span className="font-gg-display shrink-0 pt-0.5 text-[13px] font-bold tabular-nums text-brand-cyan">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <p className="text-[14.5px] leading-relaxed text-brand-ink/90">
                    <strong className="text-brand-ink">{b.titulo}:</strong> {b.texto}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* ---------- Spread: columna larga de lectura ↔ columna en carrusel ---------- */}
        <div className="lg:grid lg:grid-cols-12 lg:gap-x-10">
          {/* IZQUIERDA — columna larga (intro standfirst + teaser del editorial) */}
          <div className="lg:col-span-7">
            {intro && (
              <p className="lexph-lead-dropcap lexph-serif text-[1.3rem] leading-[1.5] text-brand-ink sm:text-[1.5rem]">
                {intro}
              </p>
            )}

            {intro && hasEditorial && <div className="my-7 h-px bg-slate-200" />}

            {hasEditorial && (
              <div>
                <p className="font-gg-display flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-teal">
                  <Lightbulb size={14} /> {editorial.kicker ?? 'Editorial'}
                </p>
                {editorial.titulo && (
                  <h3 className="mt-2 font-display text-2xl font-extrabold leading-tight tracking-tight text-brand-ink sm:text-[1.7rem]">
                    {editorial.titulo}
                  </h3>
                )}
                {editorial.cuerpo && (
                  <p className="lexph-serif mt-3 text-[1.15rem] leading-[1.5] text-brand-ink/85 line-clamp-4">
                    {bajada}
                  </p>
                )}
                <Link
                  to="/lexph/editorial"
                  className="lexph-cta lexph-cta-ink mt-5 inline-flex items-center gap-2 bg-brand-cyan px-5 py-2.5 font-gg-display text-[13px] font-semibold uppercase tracking-[0.07em] text-white"
                >
                  Seguir leyendo <ArrowRight size={16} />
                </Link>
              </div>
            )}
          </div>

          {/* DERECHA — columna en carrusel (Tendencias por materia, scroll-snap) */}
          {tendencias.length > 0 && (
            <div className="mt-10 lg:col-span-5 lg:mt-0 lg:self-start">
              <div className="mb-5 flex items-end justify-between gap-3">
                <h3 className="font-gg-display text-xl font-bold uppercase tracking-[0.03em] text-brand-ink">
                  Tendencias por materia
                </h3>
                <div className="hidden shrink-0 gap-2 lg:flex">
                  <button
                    type="button"
                    aria-label="Tendencia anterior"
                    onClick={() => scrollTrack(-1)}
                    className="lexph-chamfer-sm border border-slate-200 p-2 text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="Tendencia siguiente"
                    onClick={() => scrollTrack(1)}
                    className="lexph-chamfer-sm border border-slate-200 p-2 text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>

              <ul
                ref={trackRef}
                role="region"
                aria-label="Tendencias por materia"
                className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {tendencias.map((t, i) => {
                  const color = MATERIA_COLORS[i % MATERIA_COLORS.length];
                  return (
                    <li
                      key={i}
                      className="lexph-card lexph-chamfer flex w-[80%] max-w-[300px] shrink-0 snap-start flex-col border border-slate-200 bg-white sm:w-[78%]"
                    >
                      <div className="h-1.5 w-full" style={{ backgroundColor: color }} />
                      <div className="flex flex-1 flex-col p-5">
                        <span
                          className="lexph-chamfer-sm mb-3 inline-block w-fit px-3 py-1.5 font-gg-display text-[11px] font-semibold uppercase tracking-[0.08em] text-white"
                          style={{ backgroundColor: color }}
                        >
                          {t.materia}
                        </span>
                        <p className="text-[15px] leading-relaxed text-brand-ink/85 line-clamp-6">{t.texto}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
