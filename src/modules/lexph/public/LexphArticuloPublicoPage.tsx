// LexphArticuloPublicoPage · detalle público de un artículo (/lexph/:slug). F3.
// Piel editorial premium: hero oscuro, deck serif, "Sumario del caso", capitular,
// callouts y remate de captación. Cuerpo con SafeHtml (DOMPurify) + .lexph-prose.
// JSON-LD Article + noindex (preview).

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ExternalLink, Lightbulb, ShieldAlert } from 'lucide-react';
import { SafeHtml } from '@/components/common/SafeHtml';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
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
  LexphBadge,
  LexphCard,
  fmtFechaLarga,
  isSafeHttpUrl,
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
  const jurisdicciones = (art?.tags ?? [])
    .filter((t) => t.tipo === 'jurisdiccion')
    .map((t) => t.nombre)
    .join(' · ');
  const tieneSumario = fichaPresentes.length > 0 || voces.length > 0 || jurisdicciones.length > 0;

  const minutos = useMemo(() => {
    const text = (art?.cuerpo ?? '').replace(/<[^>]+>/g, ' ');
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(2, Math.round(words / 200));
  }, [art]);

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
    canonical: estado === 'ok' && slug ? `https://www.gestionglobal.ar/lexph/${slug}` : undefined,
    robots: 'noindex, nofollow',
    ogType: 'article',
    image: art?.imagen_url ?? undefined,
    jsonLd: estado === 'ok' ? jsonLd : null,
  });

  const related = useMemo(
    () => relacionados.filter((r) => r.slug !== slug && r.tipo === art?.tipo).slice(0, 3),
    [relacionados, slug, art],
  );

  // Estados sin artículo (loading / off / no encontrado): shell claro.
  if (status === 'loading' || estado === 'loading' || status === 'off' || estado === 'no_encontrado' || !art || !meta) {
    return (
      <LexphPublicShell>
        <div className="mx-auto max-w-3xl px-6 pb-20 pt-28 sm:pt-32">
          <Link
            to="/lexph"
            className="font-gg-display inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-brand-muted transition hover:text-brand-cyan"
          >
            <ArrowLeft size={14} /> LexPH
          </Link>
          {status === 'loading' || estado === 'loading' ? (
            <LexphLoader />
          ) : status === 'off' ? (
            <LexphComingSoon />
          ) : (
            <div className="py-20 text-center">
              <h1 className="font-display text-2xl font-bold text-brand-ink">Artículo no encontrado</h1>
              <p className="mt-2 text-brand-muted">
                Puede que haya cambiado de dirección o ya no esté disponible.
              </p>
              <Link to="/lexph" className="mt-4 inline-block font-medium text-brand-cyan hover:underline">
                Volver a LexPH
              </Link>
            </div>
          )}
        </div>
      </LexphPublicShell>
    );
  }

  return (
    <LexphPublicShell darkHero>
      {/* ---------- Hero editorial ---------- */}
      <section
        className="relative overflow-hidden text-white"
        style={{
          background:
            'radial-gradient(900px 420px at 80% -20%, rgba(0,158,202,.48), transparent 60%), linear-gradient(135deg, rgb(var(--brand-night-rgb)), rgb(var(--brand-night-2-rgb)))',
        }}
      >
        <TrianglesAccent position="top-right" tone="cyan" density="rich" size={300} className="opacity-15" />
        <div className="relative mx-auto max-w-3xl px-6 pb-14 pt-28 sm:pt-32">
          <Link
            to="/lexph"
            className="font-gg-display inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-white/60 transition hover:text-white"
          >
            <ArrowLeft size={14} /> LexPH · {meta.plural}
          </Link>
          <div className="mt-5">
            <LexphBadge tipo={art.tipo} />
          </div>
          <h1 className="mt-4 font-display text-3xl font-extrabold leading-[1.1] tracking-tight sm:text-[2.4rem]">
            {art.titulo}
          </h1>
          {art.resumen && (
            <p className="lexph-serif mt-5 max-w-[56ch] text-xl leading-[1.5] text-white/85">{art.resumen}</p>
          )}
          <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/15 pt-5 text-sm text-white/70">
            {art.publicado_at && <span className="tabular-nums">{fmtFechaLarga(art.publicado_at)}</span>}
            <span aria-hidden>·</span>
            <span>Lectura {minutos} min</span>
            {art.tags.slice(0, 2).map((t) => (
              <Link
                key={t.slug}
                to={`/lexph/tema/${t.slug}`}
                className="font-gg-display border border-white/25 px-2.5 py-1 text-[11px] uppercase tracking-[0.06em] transition hover:border-white/60"
              >
                {t.nombre}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Portada (si hay imagen válida) ---------- */}
      {isSafeHttpUrl(art.imagen_url) && (
        <div className="mx-auto max-w-[1040px] px-6 pt-10">
          <img
            src={art.imagen_url}
            alt={art.imagen_alt ?? art.titulo}
            loading="lazy"
            className="lexph-chamfer aspect-[16/7] w-full object-cover"
          />
        </div>
      )}

      {/* ---------- Cuerpo + Sumario ---------- */}
      <div
        className={cn(
          'mx-auto max-w-[1040px] gap-x-12 px-6 pt-14',
          tieneSumario ? 'lg:grid lg:grid-cols-[1fr_300px]' : '',
        )}
      >
        <div className="min-w-0">
          {art.cuerpo && <SafeHtml html={art.cuerpo} className="lexph-prose lexph-dropcap" />}
        </div>

        {tieneSumario && (
          <aside className="mt-10 lg:mt-0">
            <div className="lexph-chamfer border border-slate-200 bg-slate-50/70 lg:sticky lg:top-6">
              <div className="font-gg-display bg-brand-ink px-5 py-3 text-xs font-bold uppercase tracking-[0.1em] text-white">
                {art.tipo === 'fallo' ? 'Sumario del caso' : 'Ficha técnica'}
              </div>
              <dl className="px-5 py-4">
                {fichaPresentes.map((c) => (
                  <div key={c.key} className="mb-3.5">
                    <dt className="font-gg-display text-[10.5px] font-semibold uppercase tracking-[0.08em] text-brand-muted">
                      {c.label}
                    </dt>
                    <dd className="mt-0.5 text-sm font-medium leading-snug text-brand-ink">{str(c.key)}</dd>
                  </div>
                ))}
                {jurisdicciones && (
                  <div className="mb-1">
                    <dt className="font-gg-display text-[10.5px] font-semibold uppercase tracking-[0.08em] text-brand-muted">
                      Jurisdicción
                    </dt>
                    <dd className="mt-0.5 text-sm font-medium leading-snug text-brand-ink">{jurisdicciones}</dd>
                  </div>
                )}
              </dl>
              {voces.length > 0 && (
                <div className="border-t border-slate-200 px-5 py-4">
                  <p className="font-gg-display mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-brand-muted">
                    Voces
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {voces.map((v, i) => (
                      <span key={i} className="border border-slate-200 bg-white px-2 py-1 text-xs text-brand-ink">
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ---------- Callouts + fuentes + remate ---------- */}
      <div className="mx-auto max-w-[1040px] px-6 pb-4">
        <div className={cn(tieneSumario ? 'lg:max-w-[calc(100%-348px)]' : '')}>
          {claveAdmin && (
            <Callout tone="cyan" icon={<Lightbulb size={18} />} titulo="Clave para el administrador" texto={claveAdmin} />
          )}
          {riesgo && (
            <Callout tone="amber" icon={<ShieldAlert size={18} />} titulo="Riesgo / Oportunidad" texto={riesgo} />
          )}

          {art.fuentes.length > 0 && (
            <div className="mt-10 border-t border-slate-200 pt-5">
              <p className="font-gg-display mb-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-brand-muted">
                Fuentes
              </p>
              <ul className="space-y-1.5 text-sm">
                {art.fuentes.map((f, i) => (
                  <li key={i}>
                    {f.url && isSafeHttpUrl(f.url) ? (
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex items-center gap-1 text-brand-cyan hover:underline"
                      >
                        {f.cita || f.url} <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span className="text-brand-ink">{f.cita || f.url}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Remate de captación hacia Gestión Global */}
          <div
            className="lexph-chamfer relative mt-10 overflow-hidden px-8 py-9 text-white"
            style={{ background: 'linear-gradient(130deg, rgb(var(--brand-night-rgb)), #0d3a5c)' }}
          >
            <TrianglesAccent position="bottom-right" tone="cyan" density="soft" size={180} className="opacity-15" />
            <div className="relative">
              <p className="font-gg-display text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-cyan">
                LexPH es parte de Gestión Global
              </p>
              <p className="mt-2.5 font-display text-2xl font-bold leading-tight">Administrá con la ley de tu lado</p>
              <p className="mt-2 max-w-[56ch] text-white/85">
                Agenda de vencimientos, seguimiento de trámites, cursos y una plataforma pensada para
                administradores de consorcios.
              </p>
              <Link
                to="/"
                className="lexph-cta mt-5 inline-flex items-center gap-2 bg-brand-cyan px-6 py-3 font-gg-display text-sm font-semibold uppercase tracking-[0.07em] text-white"
              >
                Conocé la plataforma <ArrowRight size={16} />
              </Link>
            </div>
          </div>

          <p className="mt-8 bg-slate-50 p-4 text-xs leading-relaxed text-brand-muted">
            Este contenido tiene carácter exclusivamente informativo y no constituye asesoramiento jurídico.
            Ante dudas sobre casos concretos, consultá con un profesional del derecho.
          </p>
        </div>
      </div>

      {/* ---------- Relacionados ---------- */}
      {related.length > 0 && (
        <section className="mt-10 border-t border-slate-200 bg-slate-50/50">
          <div className="mx-auto max-w-6xl px-6 py-12">
            <p className="font-gg-display mb-6 text-sm font-semibold uppercase tracking-[0.1em] text-brand-cyan">
              Seguir leyendo
            </p>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
    cyan: 'border-brand-cyan/30 bg-brand-cyan-pale/40',
    amber: 'border-amber-300/50 bg-amber-50',
  } as const;
  const titleTone = { cyan: 'text-brand-cyan', amber: 'text-amber-700' } as const;
  return (
    <div className={cn('lexph-chamfer-sm mt-8 border p-6', tones[tone])}>
      <p className={cn('font-gg-display flex items-center gap-2 text-sm font-bold uppercase tracking-[0.06em]', titleTone[tone])}>
        {icon} {titulo}
      </p>
      <p className="mt-2 text-[15px] leading-relaxed text-brand-ink/90">{texto}</p>
    </div>
  );
}
