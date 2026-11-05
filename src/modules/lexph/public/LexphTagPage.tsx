// LexphTagPage · listado público por etiqueta (/lexph/tema/:tag). F3 · piel editorial.

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { useSeo } from '@/lib/seo';
import { listPublicados, type LexphFeedItem } from '@/services/api/lexphPublic';
import {
  LexphPublicShell,
  LexphComingSoon,
  LexphLoader,
  LexphCard,
  useLexphPublicoStatus,
} from './components/shared';

export function LexphTagPage() {
  const { tag } = useParams<{ tag: string }>();
  const status = useLexphPublicoStatus();
  const [items, setItems] = useState<LexphFeedItem[]>([]);
  const [loading, setLoading] = useState(true);

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

  const filtrados = useMemo(
    () => items.filter((a) => a.tags.some((t) => t.slug === tag)),
    [items, tag],
  );
  const tagNombre = useMemo(
    () => filtrados[0]?.tags.find((t) => t.slug === tag)?.nombre ?? tag ?? '',
    [filtrados, tag],
  );

  useSeo({
    title: `${tagNombre} · LexPH`,
    description: `Artículos de LexPH sobre ${tagNombre} en propiedad horizontal.`,
    canonical: tag ? `https://www.gestionglobal.ar/lexph/tema/${tag}` : undefined,
    robots: 'noindex, nofollow',
    ogType: 'website',
  });

  if (status === 'loading' || status === 'off') {
    return (
      <LexphPublicShell>
        <div className="mx-auto max-w-5xl px-6 pb-20 pt-28 sm:pt-32">
          <Link
            to="/lexph"
            className="font-gg-display inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-brand-muted transition hover:text-brand-cyan"
          >
            <ArrowLeft size={14} /> LexPH
          </Link>
          {status === 'loading' ? <LexphLoader /> : <LexphComingSoon />}
        </div>
      </LexphPublicShell>
    );
  }

  return (
    <LexphPublicShell darkHero>
      {/* Hero slim */}
      <section
        className="relative overflow-hidden text-white"
        style={{
          background:
            'radial-gradient(800px 360px at 82% -20%, rgba(0,158,202,.45), transparent 60%), linear-gradient(135deg, rgb(var(--brand-night-rgb)), rgb(var(--brand-night-2-rgb)))',
        }}
      >
        <TrianglesAccent position="top-right" tone="cyan" density="rich" size={260} className="opacity-15" />
        <div className="relative mx-auto max-w-5xl px-6 pb-12 pt-28 sm:pt-32">
          <Link
            to="/lexph"
            className="font-gg-display inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-white/60 transition hover:text-white"
          >
            <ArrowLeft size={14} /> LexPH
          </Link>
          <p className="font-gg-display mt-5 text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
            Tema
          </p>
          <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-[2.4rem]">{tagNombre}</h1>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-6 py-12">
        {loading ? (
          <LexphLoader />
        ) : filtrados.length === 0 ? (
          <p className="py-16 text-center text-brand-muted">No hay artículos para este tema todavía.</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filtrados.map((a) => (
              <LexphCard key={a.id} item={a} />
            ))}
          </div>
        )}
      </div>
    </LexphPublicShell>
  );
}
