import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { SiteNav } from '@/components/site/SiteNav';
import { SiteFooter } from '@/components/site/SiteFooter';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { cn } from '@/lib/cn';
import { tipoMeta } from '../../constants';
import { getLexphPublicoStatus, type LexphFeedItem } from '@/services/api/lexphPublic';

// DGG-244 · Piezas compartidas de la web pública de LexPH (F3).

export function fmtFechaLarga(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('es-AR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

// Cortina pública: 'loading' | 'on' | 'off'. Fail-safe a 'off'.
export function useLexphPublicoStatus(): 'loading' | 'on' | 'off' {
  const [estado, setEstado] = useState<'loading' | 'on' | 'off'>('loading');
  useEffect(() => {
    let cancelled = false;
    void getLexphPublicoStatus().then((activo) => {
      if (!cancelled) setEstado(activo ? 'on' : 'off');
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return estado;
}

// Shell público: look clásico de marca (data-gg-classic, Sora/Inter) con SiteNav + SiteFooter.
export function LexphPublicShell({
  children,
  darkHero = false,
}: {
  children: ReactNode;
  darkHero?: boolean;
}) {
  return (
    <div data-gg-classic className="flex min-h-screen flex-col bg-white font-sans text-brand-ink">
      <SiteNav darkHero={darkHero} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

export function LexphLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="animate-spin text-brand-cyan" size={28} />
    </div>
  );
}

// Cortina cuando la web pública está apagada (flag en false).
export function LexphComingSoon() {
  return (
    <section className="relative mx-auto max-w-3xl px-6 py-28 text-center sm:py-36">
      <TrianglesAccent position="top-right" tone="cyan" density="soft" size={220} className="opacity-40" />
      <p className="kicker text-brand-cyan">LexPH · Un servicio de Gestión Global</p>
      <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight text-brand-ink sm:text-5xl">
        Muy pronto
      </h1>
      <p className="mx-auto mt-4 max-w-xl text-brand-muted">
        Estamos preparando nuestro espacio de novedades jurídicas en propiedad horizontal:
        fallos, normativas e insights para administrar mejor.
      </p>
    </section>
  );
}

// Portada de artículo: imagen real o fallback de marca por tipo.
export function LexphCover({
  item,
  className,
}: {
  item: Pick<LexphFeedItem, 'tipo' | 'titulo' | 'imagen_url' | 'imagen_alt'>;
  className?: string;
}) {
  if (item.imagen_url) {
    return (
      <img
        src={item.imagen_url}
        alt={item.imagen_alt ?? item.titulo}
        loading="lazy"
        className={cn('h-full w-full object-cover', className)}
      />
    );
  }
  const meta = tipoMeta(item.tipo);
  const Icon = meta.icon;
  return (
    <div
      className={cn(
        'relative flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br from-brand-night via-brand-night to-brand-cyan',
        className,
      )}
    >
      <TrianglesAccent position="bottom-right" tone="cyan" density="soft" size={160} className="opacity-25" />
      <Icon className="relative text-white/90" size={40} strokeWidth={1.5} />
    </div>
  );
}

// Card de artículo para grillas públicas.
export function LexphCard({ item }: { item: LexphFeedItem }) {
  const meta = tipoMeta(item.tipo);
  return (
    <Link
      to={`/lexph/${item.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:border-brand-cyan/40 hover:shadow-md"
    >
      <div className="aspect-[16/9] w-full overflow-hidden">
        <LexphCover item={item} className="transition duration-500 group-hover:scale-[1.03]" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <span
          className={cn(
            'inline-flex w-fit items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
            meta.chip,
          )}
        >
          {meta.label}
        </span>
        <h3 className="font-display text-lg font-bold leading-snug text-brand-ink transition group-hover:text-brand-cyan">
          {item.titulo}
        </h3>
        {item.resumen && <p className="line-clamp-3 text-sm text-brand-muted">{item.resumen}</p>}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-xs text-brand-muted">
          <span className="truncate">{item.tags.slice(0, 2).map((t) => t.nombre).join(' · ')}</span>
          <span className="shrink-0 tabular-nums">{fmtFechaLarga(item.publicado_at)}</span>
        </div>
      </div>
    </Link>
  );
}
