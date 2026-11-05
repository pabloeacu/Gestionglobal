import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { SiteNav } from '@/components/site/SiteNav';
import { SiteFooter } from '@/components/site/SiteFooter';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { cn } from '@/lib/cn';
import { tipoMeta } from '../../constants';
import { getLexphPublicoStatus, type LexphFeedItem } from '@/services/api/lexphPublic';
import type { LexphTipo } from '@/services/api/lexph';
import '../lexph-public.css';

// DGG-244 · Piezas compartidas de la web pública de LexPH (F3).
// Piel editorial premium: masthead Oswald, acento serif Cormorant, chamfer,
// motivo triangular, números tabulares. Todas las fuentes ya están cargadas.

// Sólo http(s) es un href/src seguro (evita javascript:/data: aunque el dato
// venga del CMS de staff). Usado para imagen_url (portadas) y fuentes.url (§6 2b/5c).
export function isSafeHttpUrl(u: string | null | undefined): u is string {
  return !!u && /^https?:\/\//i.test(u.trim());
}

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

export function fmtFechaCorta(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso)
      .toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })
      .replace(/\./g, '');
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

// Shell público: look clásico de marca (data-gg-classic) con SiteNav + SiteFooter.
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

// Cabecera de publicación: FRANJA BLANCA con motivo triangular + logo LexPH
// (fondo transparente) + bajada en tinta. Banda propia arriba del hero oscuro.
export function LexphMasthead() {
  return (
    <section className="relative overflow-hidden border-b border-slate-200 bg-white">
      <TrianglesAccent position="top-right" tone="cyan" density="rich" size={300} className="opacity-[0.12]" />
      <div className="relative mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 pb-8 pt-28">
        <img
          src="/brand/lexph-logo.png"
          alt="LexPH — un servicio de Gestión Global"
          className="h-[60px] w-auto sm:h-[78px]"
        />
        <p className="font-gg-display max-w-[300px] text-[11px] font-semibold uppercase leading-[1.5] tracking-[0.13em] text-brand-muted">
          Inteligencia jurídica en propiedad horizontal · un servicio de Gestión Global
        </p>
      </div>
    </section>
  );
}

// Badge sólido por tipo (Oswald mayúsculas). `label` opcional pisa el default.
export function LexphBadge({
  tipo,
  label,
  className,
}: {
  tipo: LexphTipo;
  label?: string;
  className?: string;
}) {
  const meta = tipoMeta(tipo);
  return (
    <span
      style={{ backgroundColor: meta.accent }}
      className={cn(
        'inline-flex items-center font-gg-display text-[11px] font-semibold uppercase tracking-[0.09em] text-white px-2.5 py-1',
        className,
      )}
    >
      {label ?? meta.label}
    </span>
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
      <img src="/brand/lexph-logo.png" alt="LexPH" className="mx-auto h-14 w-auto sm:h-16" />
      <p className="kicker mt-4 text-brand-cyan">Un servicio de Gestión Global</p>
      <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight text-brand-ink sm:text-4xl">
        Muy pronto
      </h1>
      <p className="mx-auto mt-4 max-w-xl text-brand-muted">
        Estamos preparando nuestro espacio de novedades jurídicas en propiedad horizontal:
        fallos, normativas e insights para administrar mejor.
      </p>
    </section>
  );
}

// Portada de artículo: imagen real o fallback de marca por tipo
// (gradiente tinta→cian + motivo triangular + palabra fantasma del tipo).
export function LexphCover({
  item,
  className,
}: {
  item: Pick<LexphFeedItem, 'tipo' | 'titulo' | 'imagen_url' | 'imagen_alt'>;
  className?: string;
}) {
  if (isSafeHttpUrl(item.imagen_url)) {
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
      className={cn('relative h-full w-full overflow-hidden', className)}
      style={{
        background:
          'linear-gradient(135deg, rgb(var(--brand-night-rgb)) 0%, rgb(var(--brand-night-2-rgb)) 55%, #0d3a5c 100%)',
      }}
    >
      <TrianglesAccent position="top-right" tone="cyan" density="rich" size={150} className="opacity-20" />
      <Icon className="absolute left-4 top-4 text-white/80" size={22} strokeWidth={1.5} />
      <span
        aria-hidden
        className="font-gg-display pointer-events-none absolute -bottom-3 right-2 text-[64px] font-bold uppercase leading-none tracking-wide text-white/[0.07]"
      >
        {meta.label}
      </span>
    </div>
  );
}

// Card de artículo para grillas públicas (editorial premium, esquinas rectas).
export function LexphCard({ item }: { item: LexphFeedItem }) {
  const meta = tipoMeta(item.tipo);
  return (
    <Link
      to={`/lexph/${item.slug}`}
      className="lexph-card group flex flex-col overflow-hidden border border-slate-200 bg-white"
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden">
        <LexphCover item={item} className="transition duration-500 group-hover:scale-[1.03]" />
      </div>
      <div style={{ backgroundColor: meta.accent }} className="h-1 w-full" />
      <div className="flex flex-1 flex-col p-5">
        <LexphBadge tipo={item.tipo} className="mb-3 self-start" />
        <h3 className="font-display text-[1.075rem] font-bold leading-snug tracking-tight text-brand-ink transition group-hover:text-brand-cyan">
          {item.titulo}
        </h3>
        {item.resumen && (
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-brand-muted">{item.resumen}</p>
        )}
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-brand-muted">
          <span className="truncate font-gg-display uppercase tracking-[0.05em]">
            {item.tags.slice(0, 2).map((t) => t.nombre).join(' · ')}
          </span>
          <span className="shrink-0 tabular-nums">{fmtFechaCorta(item.publicado_at)}</span>
        </div>
      </div>
    </Link>
  );
}
