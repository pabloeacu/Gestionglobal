import { useEffect } from 'react';

// DGG-244 · SEO por página para un SPA sin SSR (no hay react-helmet en el repo).
// Setea title/description/canonical/robots/OG + JSON-LD en el <head> al montar y
// RESTAURA todo al desmontar (clave en un SPA: no dejar meta stale al navegar).
// El JSON-LD se embebe escapado (patrón de LandingOpiniones) para evitar breakout.

export interface SeoOptions {
  title?: string;
  description?: string;
  canonical?: string;
  /** p.ej. 'noindex, nofollow' (default LexPH preview) o 'index, follow'. */
  robots?: string;
  ogType?: string;
  image?: string | null;
  /** Objeto(s) schema.org. Memoizar con useMemo para no re-correr el efecto en loop. */
  jsonLd?: object | object[] | null;
}

export function useSeo(opts: SeoOptions): void {
  const { title, description, canonical, robots, ogType = 'article', image, jsonLd } = opts;

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const prevTitle = document.title;
    const restores: Array<() => void> = [];

    const upsertMeta = (key: string, attr: 'name' | 'property', content?: string) => {
      if (!content) return;
      let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      if (el) {
        const prev = el.getAttribute('content');
        const target = el;
        restores.push(() => {
          if (prev === null) target.removeAttribute('content');
          else target.setAttribute('content', prev);
        });
      } else {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
        const target = el;
        restores.push(() => target.remove());
      }
      el.setAttribute('content', content);
    };

    if (title) document.title = title;
    upsertMeta('description', 'name', description);
    upsertMeta('robots', 'name', robots);
    upsertMeta('og:title', 'property', title);
    upsertMeta('og:description', 'property', description);
    upsertMeta('og:type', 'property', ogType);
    if (image) upsertMeta('og:image', 'property', image);

    if (canonical) {
      const link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      link.setAttribute('href', canonical);
      document.head.appendChild(link);
      restores.push(() => link.remove());
    }

    if (jsonLd) {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify(jsonLd)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026');
      document.head.appendChild(script);
      restores.push(() => script.remove());
    }

    return () => {
      document.title = prevTitle;
      // restaurar en orden inverso
      for (let i = restores.length - 1; i >= 0; i--) restores[i]!();
    };
  }, [title, description, canonical, robots, ogType, image, jsonLd]);
}
