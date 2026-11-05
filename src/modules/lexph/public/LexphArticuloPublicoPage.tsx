// LexphArticuloPublicoPage · detalle público de un artículo (/lexph/:slug). F3.
// Render del cuerpo HTML con SafeHtml (DOMPurify) + tipografía .lexph-prose.
// JSON-LD Article + noindex (preview).

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Lightbulb, ShieldAlert } from 'lucide-react';
import { SafeHtml } from '@/components/common/SafeHtml';
import { cn } from '@/lib/cn';
import { useSeo } from '@/lib/seo';
import { tipoMeta } from '../constants';
import {
  getPublicadoBySlug,
  listPublicados,
  type LexphArticuloPublico,
  type LexphFeedItem,
} from '@/services/api/lexphPublic';
import {
  LexphPublicShell,
  LexphComingSoon,
  LexphLoader,
  LexphCover,
  LexphCard,
  fmtFechaLarga,
  useLexphPublicoStatus,
} from './components/shared';
import './lexph-prose.css';

type Estado = 'loading' | 'ok' | 'no_encontrado';

// Campos estructurados que se muestran como "ficha técnica" (label → key).
const FICHA_CAMPOS: { key: string; label: string }[] = [
  { key: 'tribunal', label: 'Tribunal' },
  { key: 'organismo', label: 'Organismo' },
  { key: 'pais', label: 'País' },
  { key: 'sala', label: 'Sala' },
  { key: 'norma', label: 'Norma' },
  { key: 'caratula', label: 'Carátula' },
  { key: 'fecha', label: 'Fecha' },
];

export function LexphArticuloPublicoPage() {
  const { slug } = useParams<{ slug: string }>();
  const status = useLexphPublicoStatus();
  const [art, setArt] = useState<LexphArticuloPublico | null>(null);
  const [estado, setEstado] = useState<Estado>('loading');
  const [relacionados, setRelacionados] = useState<LexphFeedItem[]>([]);

  useEffect(() => {
    if (status !== 'on' || !slug) return;
    let cancelled = false;
    setEstado('loading');
    void getPublicadoBySlug(slug).then((r) => {
      if (cancelled) return;
      if (r.ok && r.data) {
        setArt(r.data);
        setEstado('ok');
      } else {
        setEstado('no_encontrado');
      }
    });
    void listPublicados().then((r) => {
      if (!cancelled && r.ok) setRelacionados(r.data);
    });
    return () => {
      cancelled = true;
    };
  }, [status, slug]);

  const meta = art ? tipoMeta(art.tipo) : null;

  const campos = (art?.campos ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof campos[k] === 'string' ? (campos[k] as string) : '');
  const voces = Array.isArray(campos['voces']) ? (campos['voces'] as unknown[]).map(String) : [];
  const claveAdmin = str('clave_administrador');
  const riesgo = str('riesgo_oportunidad');
  const fichaPresentes = FICHA_CAMPOS.filter((c) => str(c.key));

  const jsonLd = useMemo(() => {
    if (!art) return null;
    return {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: art.titulo,
      description: art.resumen ?? undefined,
      datePublished: art.publicado_at ?? undefined,
      image: art.imagen_url ?? undefined,
      author: { '@type': 'Organization', name: 'Gestión Global' },
      publisher: { '@type': 'Organization', name: 'Gestión Global' },
      mainEntityOfPage: `https://www.gestionglobal.ar/lexph/${art.slug}`,
    };
  }, [art]);

  useSeo({
    title: art ? `${art.titulo} · LexPH` : 'LexPH',
    description: art?.resumen ?? undefined,
    canonical: slug ? `https://www.gestionglobal.ar/lexph/${slug}` : undefined,
    robots: 'noindex, nofollow',
    ogType: 'article',
    image: art?.imagen_url ?? undefined,
    jsonLd,
  });

  const related = useMemo(
    () => relacionados.filter((r) => r.slug !== slug && r.tipo === art?.tipo).slice(0, 3),
    [relacionados, slug, art],
  );

  return (
    <LexphPublicShell>
      <div className="mx-auto max-w-3xl px-6 pb-20 pt-28 sm:pt-32">
        <Link
          to="/lexph"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-muted transition hover:text-brand-cyan"
        >
          <ArrowLeft size={15} /> LexPH
        </Link>

        {status === 'loading' || estado === 'loading' ? (
          <LexphLoader />
        ) : status === 'off' ? (
          <LexphComingSoon />
        ) : estado === 'no_encontrado' || !art || !meta ? (
          <div className="py-20 text-center">
            <h1 className="font-display text-2xl font-bold text-brand-ink">Artículo no encontrado</h1>
            <p className="mt-2 text-brand-muted">Puede que haya cambiado de dirección o ya no esté disponible.</p>
            <Link to="/lexph" className="mt-4 inline-block font-medium text-brand-cyan hover:underline">
              Volver a LexPH
            </Link>
          </div>
        ) : (
          <article className="mt-6">
            {/* Encabezado */}
            <header>
              <span
                className={cn(
                  'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
                  meta.chip,
                )}
              >
                {meta.label}
              </span>
              <h1 className="mt-3 font-display text-3xl font-extrabold leading-tight tracking-tight text-brand-ink sm:text-4xl">
                {art.titulo}
              </h1>
              {art.resumen && <p className="mt-4 text-lg leading-relaxed text-brand-muted">{art.resumen}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-brand-muted">
                {art.publicado_at && <span className="tabular-nums">{fmtFechaLarga(art.publicado_at)}</span>}
                {art.tags.length > 0 && <span aria-hidden>·</span>}
                <span className="flex flex-wrap gap-1.5">
                  {art.tags.map((t) => (
                    <Link
                      key={t.slug}
                      to={`/lexph/tema/${t.slug}`}
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-brand-ink transition hover:bg-brand-cyan-pale/60 hover:text-brand-cyan"
                    >
                      {t.nombre}
                    </Link>
                  ))}
                </span>
              </div>
            </header>

            {/* Portada */}
            <div className="mt-8 aspect-[16/8] w-full overflow-hidden rounded-2xl">
              <LexphCover item={art} />
            </div>

            {/* Ficha técnica */}
            {(fichaPresentes.length > 0 || voces.length > 0) && (
              <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
                {fichaPresentes.length > 0 && (
                  <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                    {fichaPresentes.map((c) => (
                      <div key={c.key} className="flex flex-col">
                        <dt className="kicker text-brand-muted">{c.label}</dt>
                        <dd className="text-sm font-medium text-brand-ink">{str(c.key)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {voces.length > 0 && (
                  <div className="mt-4 border-t border-slate-200 pt-4">
                    <p className="kicker mb-2 text-brand-muted">Voces</p>
                    <div className="flex flex-wrap gap-1.5">
                      {voces.map((v, i) => (
                        <span key={i} className="rounded-md bg-white px-2 py-1 text-xs text-brand-ink ring-1 ring-slate-200">
                          {v}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Cuerpo */}
            {art.cuerpo && <SafeHtml html={art.cuerpo} className="lexph-prose mt-8" />}

            {/* Callouts */}
            {claveAdmin && (
              <Callout
                tone="cyan"
                icon={<Lightbulb size={18} />}
                titulo="Clave para el administrador"
                texto={claveAdmin}
              />
            )}
            {riesgo && (
              <Callout
                tone="amber"
                icon={<ShieldAlert size={18} />}
                titulo="Riesgo / Oportunidad"
                texto={riesgo}
              />
            )}

            {/* Fuentes */}
            {art.fuentes.length > 0 && (
              <div className="mt-10 border-t border-slate-200 pt-5">
                <p className="kicker mb-2 text-brand-muted">Fuentes</p>
                <ul className="space-y-1.5 text-sm">
                  {art.fuentes.map((f, i) => (
                    <li key={i}>
                      {f.url ? (
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="inline-flex items-center gap-1 text-brand-cyan hover:underline"
                        >
                          {f.cita || f.url} <ExternalLink size={12} />
                        </a>
                      ) : (
                        <span className="text-brand-ink">{f.cita}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mt-10 rounded-xl bg-slate-50 p-4 text-xs text-brand-muted">
              Este contenido tiene carácter exclusivamente informativo y no constituye asesoramiento
              jurídico. Ante dudas sobre casos concretos, consultá con un profesional del derecho.
            </p>
          </article>
        )}
      </div>

      {/* Relacionados */}
      {estado === 'ok' && related.length > 0 && (
        <section className="border-t border-slate-200 bg-slate-50/50">
          <div className="mx-auto max-w-5xl px-6 py-12">
            <p className="kicker mb-5 text-brand-cyan">Seguir leyendo</p>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((r) => (
                <LexphCard key={r.id} item={r} />
              ))}
            </div>
          </div>
        </section>
      )}
    </LexphPublicShell>
  );
}

function Callout({
  tone,
  icon,
  titulo,
  texto,
}: {
  tone: 'cyan' | 'amber';
  icon: React.ReactNode;
  titulo: string;
  texto: string;
}) {
  const tones = {
    cyan: 'border-brand-cyan/30 bg-brand-cyan-pale/40 text-brand-cyan',
    amber: 'border-amber-300/50 bg-amber-50 text-amber-700',
  } as const;
  return (
    <div className={cn('mt-8 rounded-2xl border p-5', tones[tone])}>
      <p className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide">
        {icon} {titulo}
      </p>
      <p className="mt-2 text-[15px] leading-relaxed text-brand-ink/90">{texto}</p>
    </div>
  );
}
