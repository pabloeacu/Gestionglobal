// LexphIndexPage · home pública de LexPH (/lexph). F3.
// R19: trae el feed completo de publicados y filtra por tipo/tema/búsqueda en memoria.
// noindex mientras la web está en preview (se abre a indexación cuando Pablo lo decida).

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { cn } from '@/lib/cn';
import { useSeo } from '@/lib/seo';
import { TIPOS } from '../constants';
import { listPublicados, type LexphFeedItem, type LexphPublicTag } from '@/services/api/lexphPublic';
import {
  LexphPublicShell,
  LexphComingSoon,
  LexphLoader,
  LexphCard,
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
    jsonLd,
  });

  // Materias disponibles (derivadas del universo) para la nube de temas.
  const materias = useMemo(() => {
    const map = new Map<string, LexphPublicTag>();
    for (const a of items) for (const t of a.tags) if (t.tipo === 'materia') map.set(t.slug, t);
    return Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [items]);

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

  return (
    <LexphPublicShell darkHero>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-night via-brand-night to-brand-cyan text-white">
        <TrianglesAccent position="top-right" tone="cyan" density="rich" size={320} className="opacity-25" />
        <div className="relative mx-auto max-w-5xl px-6 pb-14 pt-32 sm:pt-36">
          <p className="kicker text-white/70">LexPH · Un servicio de Gestión Global</p>
          <h1 className="mt-3 max-w-3xl font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Novedades jurídicas en propiedad horizontal
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-white/80">
            Fallos comentados, normativas e insights, explicados para que administres con criterio y
            anticipación.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-6 py-10">
        {status === 'loading' ? (
          <LexphLoader />
        ) : status === 'off' ? (
          <LexphComingSoon />
        ) : (
          <>
            {/* Filtros */}
            <div className="mb-8 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <FiltroChip active={tipo === null} onClick={() => setTipo(null)} label="Todo" />
                {TIPOS.map((t) => (
                  <FiltroChip
                    key={t.value}
                    active={tipo === t.value}
                    onClick={() => setTipo(tipo === t.value ? null : t.value)}
                    label={t.plural}
                  />
                ))}
                <div className="relative ml-auto w-full max-w-xs">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar…"
                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-brand-ink outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/20"
                  />
                </div>
              </div>
              {materias.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {materias.map((t) => (
                    <button
                      key={t.slug}
                      type="button"
                      onClick={() => setTagSlug(tagSlug === t.slug ? null : t.slug)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs font-medium transition',
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
            </div>

            {/* Grilla */}
            {loading ? (
              <LexphLoader />
            ) : filtrados.length === 0 ? (
              <p className="py-16 text-center text-brand-muted">
                {items.length === 0 ? 'Todavía no hay artículos publicados.' : 'Sin resultados para este filtro.'}
              </p>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {filtrados.map((a) => (
                  <LexphCard key={a.id} item={a} />
                ))}
              </div>
            )}

            <p className="mt-12 text-center text-xs text-brand-muted">
              Contenido informativo, no constituye asesoramiento jurídico.{' '}
              <Link to="/" className="font-medium text-brand-cyan hover:underline">
                Gestión Global
              </Link>
            </p>
          </>
        )}
      </div>
    </LexphPublicShell>
  );
}

function FiltroChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
        active
          ? 'border-brand-cyan bg-brand-cyan text-white'
          : 'border-slate-200 bg-white text-brand-ink hover:border-brand-cyan/50',
      )}
    >
      {label}
    </button>
  );
}
