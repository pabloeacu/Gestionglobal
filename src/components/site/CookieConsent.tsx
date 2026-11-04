// Aviso mínimo de cookies / medición — DGG-242.
// El sitio no tenía banner: éste CONDICIONA la carga del píxel de Meta al
// consentimiento. Aparece sólo cuando puede haber píxel: visitante ANÓNIMO,
// en ruta pública de marketing, con píxel configurado y sin decisión previa.
// Landmark `region` con aria-label (no modal: no atrapa el foco), liviano,
// al estilo del sitio.

import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getConsent, setConsent, onConsentChange } from '@/lib/metaConsent';
import { metaPixelConfigured } from '@/lib/metaPixel';
import { isTrackablePath } from '@/lib/publicRoutes';

export function CookieConsent() {
  const location = useLocation();
  const { session } = useAuth();
  const [decided, setDecided] = useState<boolean>(() => getConsent() !== null);

  // Reaccionar al instante si el consentimiento cambia desde /privacidad (o en
  // otra parte de la app), sin esperar a la próxima navegación.
  useEffect(() => onConsentChange((v) => setDecided(v !== null)), []);
  // Red de seguridad: re-evaluar también al navegar (cubre storage externo).
  useEffect(() => {
    setDecided(getConsent() !== null);
  }, [location.pathname]);

  const anon = !session;
  const visible =
    !decided && metaPixelConfigured() && anon && isTrackablePath(location.pathname);

  if (!visible) return null;

  const decidir = (v: 'granted' | 'denied') => {
    setConsent(v);
    setDecided(true);
  };

  return (
    <div
      role="region"
      aria-live="polite"
      aria-label="Aviso de cookies y medición"
      className="fixed inset-x-0 bottom-0 z-[60] px-4 pb-4"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-[0_18px_50px_-20px_rgba(11,31,51,0.45)] backdrop-blur sm:flex-row sm:items-center sm:gap-4">
        <p className="flex-1 text-sm leading-relaxed text-brand-ink/85">
          Usamos cookies de medición y publicidad (píxel de Meta) para entender cómo llegás a
          nuestro sitio y mejorar nuestras campañas. Podés aceptarlas o rechazarlas. Más info en
          nuestra{' '}
          <Link to="/privacidad" className="font-semibold text-brand-cyan underline underline-offset-2">
            política de privacidad
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => decidir('denied')}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan"
          >
            Rechazar
          </button>
          <button
            type="button"
            onClick={() => decidir('granted')}
            className="rounded-full bg-brand-ink px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-cyan"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
