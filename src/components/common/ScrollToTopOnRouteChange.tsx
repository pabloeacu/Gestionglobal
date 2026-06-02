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
    // Doble llamada porque algunos browsers ignoran el scrollTo síncrono
    // cuando la pintura del nuevo route aún no ocurrió.
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    // Fallback async por si hay layouts que se ajustan en el siguiente tick.
    const id = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [pathname, hash]);

  return null;
}
