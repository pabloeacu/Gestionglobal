// LexphEditorialPage · nota independiente del EDITORIAL/insight de la edición actual
// (/lexph/editorial). DGG-244 F2c. El home muestra sólo el teaser con "Seguir leyendo →";
// el cuerpo largo vive acá → es lo que ACORTA el home. Misma fuente de datos que el teaser
// (getEdicionActual → una sola RPC) para coherencia aviso↔display. Piel editorial + noindex.

import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Lightbulb } from 'lucide-react';
import { useSeo } from '@/lib/seo';
import { getEdicionActual, type LexphEdicionActual } from '@/services/api/lexphPublic';
import {
  LexphPublicShell,
  LexphComingSoon,
  LexphLoader,
  LexphMasthead,
  fmtFechaLarga,
  useLexphPublicoStatus,
} from './components/shared';
import './lexph-prose.css';

const CANONICAL = 'https://www.gestionglobal.ar/lexph/editorial';

export function LexphEditorialPage() {
  const status = useLexphPublicoStatus();
  const [edicion, setEdicion] = useState<LexphEdicionActual | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status !== 'on') return;
    let cancelled = false;
    setLoading(true);
    void getEdicionActual().then((ed) => {
      if (cancelled) return;
      setEdicion(ed);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [status]);

  const editorial: LexphEdicionActual['editorial'] = edicion?.editorial ?? {};
  const hasEditorial = Boolean(editorial.titulo || editorial.cuerpo);
  const primerParrafo = (editorial.cuerpo ?? '').split('\n\n')[0] ?? '';

  useSeo({
    title: hasEditorial ? `${editorial.titulo ?? 'Editorial'} · LexPH` : 'LexPH',
    description: hasEditorial ? primerParrafo.slice(0, 160) || undefined : undefined,
    canonical: CANONICAL,
    robots: 'noindex, nofollow',
    ogType: 'article',
  });

  if (status === 'loading' || (status === 'on' && loading)) {
    return (
      <LexphPublicShell>
        <div className="pt-28">
          <LexphLoader />
        </div>
      </LexphPublicShell>
    );
  }
  if (status === 'off') {
    return (
      <LexphPublicShell>
        <div className="pt-16">
          <LexphComingSoon />
        </div>
      </LexphPublicShell>
    );
  }
  // Sin editorial cargado → volvemos a la tapa (no es una nota propia todavía).
  if (!edicion || !hasEditorial) {
    return <Navigate to="/lexph" replace />;
  }

  const parrafos = (editorial.cuerpo ?? '').split('\n\n').filter((p) => p.trim());
  const sello = edicion.publicado_at ? `Edición · ${fmtFechaLarga(edicion.publicado_at)}` : 'Esta edición';

  return (
    <LexphPublicShell>
      <LexphMasthead />
      <article className="mx-auto max-w-3xl px-6 py-12">
        <Link
          to="/lexph"
          className="font-gg-display inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-brand-cyan transition hover:text-brand-teal"
        >
          <ArrowLeft size={14} /> Volver a LexPH
        </Link>

        <p className="font-gg-display mt-6 text-[11px] uppercase tracking-[0.12em] text-brand-muted tabular-nums">
          {sello}
        </p>
        <p className="font-gg-display mt-4 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-teal">
          <Lightbulb size={14} /> {editorial.kicker ?? 'Editorial'}
        </p>
        <h1 className="mt-2 font-display text-[2rem] font-extrabold leading-[1.1] tracking-tight text-brand-ink sm:text-[2.4rem]">
          {editorial.titulo ?? 'Editorial de la edición'}
        </h1>

        <div className="lexph-dropcap mt-7 space-y-5">
          {parrafos.map((p, i) => (
            <p key={i} className="lexph-serif text-[1.15rem] leading-[1.6] text-brand-ink/90">
              {p}
            </p>
          ))}
        </div>

        <p className="mt-12 border-t border-slate-200 pt-6 text-xs leading-relaxed text-brand-muted">
          Contenido informativo, no constituye asesoramiento jurídico.{' '}
          <Link to="/" className="font-medium text-brand-cyan hover:underline">
            Gestión Global
          </Link>
        </p>
      </article>
    </LexphPublicShell>
  );
}
