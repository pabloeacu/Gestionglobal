// LexphTagPage · listado público por etiqueta (/lexph/tema/:tag). F3.

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
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

  return (
    <LexphPublicShell>
      <div className="mx-auto max-w-5xl px-6 pb-20 pt-28 sm:pt-32">
        <Link
          to="/lexph"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-muted transition hover:text-brand-cyan"
        >
          <ArrowLeft size={15} /> LexPH
        </Link>

        {status === 'loading' ? (
          <LexphLoader />
        ) : status === 'off' ? (
          <LexphComingSoon />
        ) : (
          <>
            <header className="mb-8 mt-6">
              <p className="kicker text-brand-cyan">Tema</p>
              <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-brand-ink sm:text-4xl">
                {tagNombre}
              </h1>
            </header>
            {loading ? (
              <LexphLoader />
            ) : filtrados.length === 0 ? (
              <p className="py-16 text-center text-brand-muted">
                No hay artículos para este tema todavía.
              </p>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {filtrados.map((a) => (
                  <LexphCard key={a.id} item={a} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </LexphPublicShell>
  );
}
