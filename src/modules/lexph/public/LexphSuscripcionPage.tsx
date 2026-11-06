// LexphSuscripcionPage · confirmación / baja de la suscripción (por token). DGG-244 F2d.
// Rutas públicas /lexph/confirmar?token=... y /lexph/baja?token=... — anon, por token uuid.
// Llama la RPC al montar y muestra un resultado de marca. noindex.

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle, Loader2, ArrowLeft } from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { useSeo } from '@/lib/seo';
import {
  confirmarSuscripcionLexph,
  bajaSuscripcionLexph,
  type LexphSuscripcionEstado,
} from '@/services/api/lexphPublic';
import { LexphPublicShell } from './components/shared';

type Resultado = 'cargando' | LexphSuscripcionEstado;

export function LexphSuscripcionPage({ modo }: { modo: 'confirmar' | 'baja' }) {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [resultado, setResultado] = useState<Resultado>('cargando');

  useSeo({
    title: modo === 'confirmar' ? 'Confirmar suscripción · LexPH' : 'Baja de LexPH',
    robots: 'noindex, nofollow',
    ogType: 'website',
  });

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setResultado('invalido');
      return;
    }
    const run = modo === 'confirmar' ? confirmarSuscripcionLexph : bajaSuscripcionLexph;
    void run(token).then((r) => {
      if (!cancelled) setResultado(r);
    });
    return () => {
      cancelled = true;
    };
  }, [modo, token]);

  const ok = modo === 'confirmar' ? resultado === 'confirmado' : resultado === 'baja';

  const titulo = ok
    ? modo === 'confirmar'
      ? '¡Suscripción confirmada!'
      : 'Te diste de baja'
    : 'No pudimos procesar el enlace';

  const mensaje = ok
    ? modo === 'confirmar'
      ? 'Ya vas a recibir LexPH en tu correo: fallos, normativas e insights de propiedad horizontal, destilados para administrar mejor.'
      : 'No vas a recibir más correos de LexPH. Si cambiás de idea, podés volver a suscribirte cuando quieras desde la web.'
    : 'El enlace puede haber expirado o ser incorrecto. Probá de nuevo desde el correo que te enviamos, o volvé a suscribirte.';

  return (
    <LexphPublicShell>
      <section className="relative mx-auto max-w-2xl px-6 py-24 text-center sm:py-32">
        <TrianglesAccent position="top-right" tone="cyan" density="soft" size={220} className="opacity-40" />
        <img src="/brand/lexph-logo.png" alt="LexPH" className="mx-auto h-12 w-auto sm:h-14" />
        <div className="relative mt-10">
          {resultado === 'cargando' ? (
            <Loader2 className="mx-auto animate-spin text-brand-cyan" size={32} />
          ) : (
            <>
              {ok ? (
                <CheckCircle2 className="mx-auto text-emerald-500" size={52} strokeWidth={1.6} />
              ) : (
                <XCircle className="mx-auto text-brand-muted" size={52} strokeWidth={1.6} />
              )}
              <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight text-brand-ink sm:text-4xl">
                {titulo}
              </h1>
              <p className="mx-auto mt-4 max-w-md text-brand-muted">{mensaje}</p>
              <Link
                to="/lexph"
                className="lexph-cta mt-8 inline-flex items-center gap-2 bg-brand-cyan px-6 py-3 font-gg-display text-sm font-semibold uppercase tracking-[0.07em] text-white"
              >
                <ArrowLeft size={15} /> Ir a LexPH
              </Link>
            </>
          )}
        </div>
      </section>
    </LexphPublicShell>
  );
}
