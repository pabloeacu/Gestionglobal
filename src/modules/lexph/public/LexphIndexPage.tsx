// LexphIndexPage · home pública de LexPH (/lexph). F3 · piel editorial premium.
// R19: trae el feed completo de publicados y filtra por tipo/tema/búsqueda en memoria.
// noindex mientras la web está en preview (se abre a indexación cuando Pablo lo decida).

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Search } from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { cn } from '@/lib/cn';
import { useSeo } from '@/lib/seo';
import { TIPOS, tipoMeta } from '../constants';
import { listPublicados, type LexphFeedItem, type LexphPublicTag } from '@/services/api/lexphPublic';
import {
  LexphPublicShell,
  LexphComingSoon,
  LexphLoader,
  LexphCard,
  LexphMasthead,
  LexphBadge,
  fmtFechaCorta,
  fmtFechaLarga,
  useLexphPublicoStatus,
} from './components/shared';

const CANONICAL = 'https://www.gestionglobal.ar/lexph';

export function LexphIndexPage() {
  const status = useLexphPublicoStatus();
  const [items, setItems] = useState<LexphFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tipo, setTipo] = useState<string | null>(null);
  const [tagSlug, setTagSlug] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (status !== 'on') return;
    let cancelled = false;
    void listPublicados().then((r) => {
      if (cancelled) return;
      if (r.ok) setItems(r.data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [status]);

  const jsonLd = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: 'LexPH — Novedades jurídicas en propiedad horizontal',
      publisher: { '@type': 'Organization', name: 'Gestión Global' },
      url: CANONICAL,
    }),
    [],
  );

  useSeo({
    title: 'LexPH · Novedades jurídicas en propiedad horizontal',
    description:
      'Fallos, normativas, novedades internacionales e insights de propiedad horizontal, explicados para administrar mejor. Un servicio de Gestión Global.',
    canonical: CANONICAL,
    robots: 'noindex, nofollow',
    ogType: 'website',
    jsonLd: status === 'on' ? jsonLd : null,
  });

  // Materias disponibles (derivadas del universo) para la nube de temas.
  const materias = useMemo(() => {
    const map = new Map<string, LexphPublicTag>();
    for (const a of items) for (const t of a.tags) if (t.tipo === 'materia') map.set(t.slug, t);
    return Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [items]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of items) m[a.tipo] = (m[a.tipo] ?? 0) + 1;
    return m;
  }, [items]);

  const hasFilter = tipo !== null || tagSlug !== null || q.trim() !== '';

  const filtrados = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((a) => {
      if (tipo && a.tipo !== tipo) return false;
      if (tagSlug && !a.tags.some((t) => t.slug === tagSlug)) return false;
      if (needle) {
        const hay =
          a.titulo.toLowerCase().includes(needle) ||
          (a.resumen ?? '').toLowerCase().includes(needle) ||
          a.tags.some((t) => t.nombre.toLowerCase().includes(needle));
        if (!hay) return false;
      }
      return true;
    });
  }, [items, tipo, tagSlug, q]);

  // Vista curada (sin filtro): nota de tapa + secciones por tipo.
  const featured = !hasFilter ? items[0] : undefined;
  const latest = !hasFilter ? items.slice(1, 4) : [];
  // Lo que ya salió arriba (tapa + "lo último") NO se repite en las secciones.
  const excludeIds = useMemo(
    () => new Set(featured ? [featured.id, ...latest.map((a) => a.id)] : []),
    [featured, latest],
  );
  const fallos = useMemo(
    () => items.filter((a) => a.tipo === 'fallo' && !excludeIds.has(a.id)),
    [items, excludeIds],
  );
  const normativas = useMemo(
    () => items.filter((a) => a.tipo === 'normativa' && !excludeIds.has(a.id)),
    [items, excludeIds],
  );
  const internacionales = useMemo(
    () => items.filter((a) => a.tipo === 'internacional' && !excludeIds.has(a.id)),
    [items, excludeIds],
  );
  const insights = useMemo(
    () => items.filter((a) => a.tipo === 'insight' && !excludeIds.has(a.id)),
    [items, excludeIds],
  );

  // Título del hero cuando no hay nota de tapa (vista filtrada o 0 artículos):
  // garantiza un <h1> en TODOS los estados (a11y).
  const heroTitulo = !hasFilter
    ? 'Novedades jurídicas en propiedad horizontal'
    : tipo
      ? tipoMeta(tipo).plural
      : tagSlug
        ? materias.find((m) => m.slug === tagSlug)?.nombre ?? 'Resultados'
        : `Resultados para “${q.trim()}”`;

  const clearAll = () => {
    setTipo(null);
    setTagSlug(null);
    setQ('');
  };

  return (
    <LexphPublicShell darkHero={status === 'on'}>
      {status === 'loading' ? (
        <div className="pt-28">
          <LexphLoader />
        </div>
      ) : status === 'off' ? (
        <div className="pt-16">
          <LexphComingSoon />
        </div>
      ) : (
        <>
          {/* ---------- HERO ---------- */}
          <section
            className="relative overflow-hidden text-white"
            style={{
              background:
                'radial-gradient(1200px 520px at 85% -10%, rgba(0,158,202,.5), transparent 60%), linear-gradient(135deg, rgb(var(--brand-night-rgb)) 0%, rgb(var(--brand-night-2-rgb)) 45%, #0d3a5c 100%)',
            }}
          >
            <TrianglesAccent position="top-right" tone="cyan" density="rich" size={340} className="opacity-20" />
            <div className="relative mx-auto max-w-6xl px-6 pb-14 pt-28 sm:pt-32">
              <LexphMasthead />

              {loading ? (
                <div className="py-12">
                  <LexphLoader />
                </div>
              ) : featured ? (
                <div className="mt-10 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
                  {/* Nota de tapa */}
                  <div>
                    <div className="mb-4 flex flex-wrap items-center gap-3">
                      <LexphBadge tipo={featured.tipo} />
                      <span className="font-gg-display text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
                        Nota de tapa
                      </span>
                    </div>
                    <Link to={`/lexph/${featured.slug}`} className="group block">
                      <h1 className="font-display text-[2rem] font-extrabold leading-[1.08] tracking-tight transition group-hover:text-brand-cyan-pale sm:text-[2.6rem]">
                        {featured.titulo}
                      </h1>
                    </Link>
                    {featured.resumen && (
                      <p className="lexph-serif mt-5 max-w-[46ch] text-xl leading-[1.5] text-white/85">
                        {featured.resumen}
                      </p>
                    )}
                    <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/70">
                      <span className="tabular-nums">{fmtFechaLarga(featured.publicado_at)}</span>
                      {featured.tags.slice(0, 2).map((t) => (
                        <span key={t.slug} className="flex items-center gap-3">
                          <span aria-hidden>·</span>
                          {t.nombre}
                        </span>
                      ))}
                    </div>
                    <Link
                      to={`/lexph/${featured.slug}`}
                      className="lexph-cta mt-7 inline-flex items-center gap-2 bg-brand-cyan px-6 py-3 font-gg-display text-sm font-semibold uppercase tracking-[0.07em] text-white"
                    >
                      Leer {featured.tipo === 'fallo' ? 'el fallo' : 'la nota'}
                      <ArrowRight size={16} />
                    </Link>
                  </div>

                  {/* Índice "Lo último" */}
                  {latest.length > 0 && (
                    <div>
                      <p className="font-gg-display border-b border-white/20 pb-2.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-cyan">
                        Lo último
                      </p>
                      <div className="divide-y divide-white/10">
                        {latest.map((a, i) => {
                          const t0 = a.tags[0];
                          return (
                            <Link key={a.id} to={`/lexph/${a.slug}`} className="group flex gap-4 py-4">
                              <span aria-hidden className="font-gg-display text-2xl font-bold leading-none text-white/30">
                                {String(i + 2).padStart(2, '0')}
                              </span>
                              <span>
                                <span className="font-display block text-[15px] font-semibold leading-snug transition group-hover:text-brand-cyan-pale">
                                  {a.titulo}
                                </span>
                                <span className="font-gg-display mt-1.5 block text-[11px] uppercase tracking-[0.08em] text-white/65">
                                  {tipoMeta(a.tipo).label}
                                  {t0 ? ` · ${t0.nombre}` : ''}
                                </span>
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <h1 className="mt-10 max-w-3xl font-display text-2xl font-extrabold leading-tight tracking-tight text-white sm:text-3xl">
                  {heroTitulo}
                </h1>
              )}
            </div>
          </section>

          {/* ---------- RIEL DE FILTROS (sticky bajo la nav fija de 80px) ---------- */}
          <div className="sticky top-20 z-20 border-b border-slate-200 bg-white/92 backdrop-blur-md">
            <div className="mx-auto flex max-w-6xl items-center gap-1.5 overflow-x-auto px-6 py-2.5">
              <RailTab active={!hasFilter} label="Todo" onClick={clearAll} />
              {TIPOS.filter((t) => (counts[t.value] ?? 0) > 0).map((t) => (
                <RailTab
                  key={t.value}
                  active={tipo === t.value}
                  label={t.plural}
                  dot={t.accent}
                  count={counts[t.value]}
                  onClick={() => {
                    setTipo(tipo === t.value ? null : t.value);
                    setTagSlug(null);
                  }}
                />
              ))}
              <div className="relative ml-auto hidden min-w-[220px] sm:block">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar en LexPH…"
                  aria-label="Buscar en LexPH"
                  className="w-full border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-brand-ink outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/20"
                />
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-6xl px-6 py-12">
            {/* Búsqueda en mobile (en desktop vive en el riel) */}
            <div className="relative mb-6 sm:hidden">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar en LexPH…"
                aria-label="Buscar en LexPH"
                className="w-full border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-brand-ink outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/20"
              />
            </div>

            {/* Nube de materias */}
            {materias.length > 0 && (
              <div className="mb-10 flex flex-wrap gap-1.5">
                {materias.map((t) => (
                  <button
                    key={t.slug}
                    type="button"
                    onClick={() => {
                      setTagSlug(tagSlug === t.slug ? null : t.slug);
                      setQ('');
                    }}
                    className={cn(
                      'border px-3 py-1 text-xs font-medium transition',
                      tagSlug === t.slug
                        ? 'border-brand-cyan bg-brand-cyan text-white'
                        : 'border-slate-200 bg-white text-brand-ink hover:border-brand-cyan/50',
                    )}
                  >
                    {t.nombre}
                  </button>
                ))}
              </div>
            )}

            {loading ? (
              <LexphLoader />
            ) : items.length === 0 ? (
              <p className="py-16 text-center text-brand-muted">Todavía no hay artículos publicados.</p>
            ) : hasFilter ? (
              /* ---------- Vista filtrada ---------- */
              <>
                <div className="mb-6 flex items-center justify-between">
                  <p className="font-gg-display text-sm uppercase tracking-[0.08em] text-brand-muted">
                    {filtrados.length} resultado{filtrados.length === 1 ? '' : 's'}
                  </p>
                  <button
                    type="button"
                    onClick={clearAll}
                    className="font-gg-display text-xs uppercase tracking-[0.08em] text-brand-cyan hover:underline"
                  >
                    Limpiar filtros
                  </button>
                </div>
                {filtrados.length === 0 ? (
                  <p className="py-16 text-center text-brand-muted">Sin resultados para este filtro.</p>
                ) : (
                  <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {filtrados.map((a) => (
                      <LexphCard key={a.id} item={a} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              /* ---------- Vista curada por secciones ---------- */
              <div className="space-y-16">
                {fallos.length > 0 && (
                  <Section titulo="Fallos comentados" accent="#009ECA" onMore={() => setTipo('fallo')}>
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                      {fallos.map((a) => (
                        <LexphCard key={a.id} item={a} />
                      ))}
                    </div>
                  </Section>
                )}

                {normativas.length > 0 && (
                  <Section titulo="Normativa & agenda" accent="#159AA6" onMore={() => setTipo('normativa')}>
                    <div className="border-t border-slate-200">
                      {normativas.map((a) => (
                        <AgendaRow key={a.id} item={a} />
                      ))}
                    </div>
                  </Section>
                )}

                {internacionales.length > 0 && (
                  <Section titulo="Mirada internacional" accent="#2E6FB0">
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                      {internacionales.map((a) => (
                        <LexphCard key={a.id} item={a} />
                      ))}
                    </div>
                  </Section>
                )}

                {insights.length > 0 && (
                  <Section titulo="Insights" accent="#C46A10" onMore={() => setTipo('insight')}>
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                      {insights.map((a) => (
                        <LexphCard key={a.id} item={a} />
                      ))}
                    </div>
                  </Section>
                )}
              </div>
            )}

            <p className="mt-14 text-center text-xs text-brand-muted">
              Contenido informativo, no constituye asesoramiento jurídico.{' '}
              <Link to="/" className="font-medium text-brand-cyan hover:underline">
                Gestión Global
              </Link>
            </p>
          </div>

          {/* ---------- Franja newsletter (teaser · F2 conecta el envío) ---------- */}
          <div
            className="relative overflow-hidden text-white"
            style={{ background: 'linear-gradient(120deg, rgb(var(--brand-teal-rgb)), rgb(var(--brand-cyan-rgb)))' }}
          >
            <TrianglesAccent position="top-right" tone="cyan" density="soft" size={220} className="opacity-20" />
            <div className="relative mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="font-gg-display text-2xl font-bold uppercase tracking-[0.02em] sm:text-3xl">
                  LexPH en tu correo, cada quince días
                </h3>
                <p className="mt-2 max-w-[52ch] text-white/90">
                  Los fallos, normativas y vencimientos que mueven la propiedad horizontal, destilados y
                  explicados para administrar mejor.
                </p>
              </div>
              <span className="font-gg-display inline-flex shrink-0 items-center gap-2 self-start border border-white/40 px-5 py-3 text-sm font-semibold uppercase tracking-[0.07em] text-white md:self-auto">
                Suscripción · muy pronto
              </span>
            </div>
          </div>
        </>
      )}
    </LexphPublicShell>
  );
}

// ---------- subcomponentes ----------

function RailTab({
  active,
  label,
  dot,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  dot?: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center gap-2 border px-4 py-2 font-gg-display text-[13px] font-semibold uppercase tracking-[0.06em] transition',
        active
          ? 'border-slate-200 bg-brand-cyan-pale/60 text-brand-ink'
          : 'border-transparent text-brand-muted hover:text-brand-ink',
      )}
    >
      {dot && <span className="h-[7px] w-[7px]" style={{ backgroundColor: dot }} />}
      {label}
      {count != null && <span className="text-[11px] opacity-60">{count}</span>}
    </button>
  );
}

function Section({
  titulo,
  accent,
  onMore,
  children,
}: {
  titulo: string;
  accent: string;
  onMore?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div
        className="mb-7 flex items-baseline justify-between border-t-2 pt-3.5"
        style={{ borderColor: accent }}
      >
        <h2 className="font-gg-display text-2xl font-bold uppercase tracking-[0.03em]" style={{ color: accent }}>
          {titulo}
        </h2>
        {onMore && (
          <button
            type="button"
            onClick={onMore}
            className="font-gg-display text-xs font-semibold uppercase tracking-[0.08em] hover:underline"
            style={{ color: accent }}
          >
            Ver todas →
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function AgendaRow({ item }: { item: LexphFeedItem }) {
  const tag0 = item.tags[0];
  return (
    <Link
      to={`/lexph/${item.slug}`}
      className="grid grid-cols-1 items-center gap-x-5 gap-y-1 border-b border-slate-200 px-1 py-5 transition hover:bg-slate-50 sm:grid-cols-[110px_1fr_auto]"
    >
      <div className="font-gg-display text-[13px] font-semibold uppercase tracking-[0.05em] text-brand-teal tabular-nums">
        {fmtFechaCorta(item.publicado_at)}
      </div>
      <div>
        <h3 className="font-display text-[1.05rem] font-semibold leading-snug text-brand-ink">{item.titulo}</h3>
        {item.resumen && <p className="mt-1 text-sm text-brand-muted">{item.resumen}</p>}
      </div>
      {tag0 && (
        <span className="font-gg-display w-fit border border-slate-200 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-brand-muted">
          {tag0.nombre}
        </span>
      )}
    </Link>
  );
}
