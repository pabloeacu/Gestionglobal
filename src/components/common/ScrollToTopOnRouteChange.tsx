// ScrollToTopOnRouteChange · resetea scroll a 0 cuando cambia el pathname.
// Por defecto React Router NO resetea el scroll: si el usuario viene
// scrolleando una página larga (landing) y clickea un CTA del medio/fin
// para ir a otra (formulario, ficha, plataforma), llega al destino con
// el scroll del origen — el header de la página nueva queda fuera de vista.
//
// Reportado por el usuario 2026-06-02: "algunos formularios se abren desde
// abajo en lugar de priorizando el inicio de la página".
//
// Excepción: si la URL trae `#anchor`, dejamos al browser navegar al ancla.

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export function ScrollToTopOnRouteChange() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) return; // dejar que el browser navegue al ancla
    // Disparo triple para cubrir Suspense + lazy imports:
    //  - Sync: para el caso normal sin lazy.
    //  - rAF: para layouts que se ajustan en el siguiente frame.
    //  - setTimeout(0/120ms): cubre el caso donde el nuevo route es lazy y
    //    el componente recién monta después de varios ticks. Sin esto, el
    //    scrollTo ya pasó y la página queda donde estaba.
    const reset = () => window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    reset();
    const raf = window.requestAnimationFrame(reset);
    const t1 = window.setTimeout(reset, 0);
    const t2 = window.setTimeout(reset, 120);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [pathname, hash]);

  return null;
}
