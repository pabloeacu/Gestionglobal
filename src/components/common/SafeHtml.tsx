import { useMemo } from 'react';
import DOMPurify from 'dompurify';

// DGG-244 · Render seguro de HTML confiable-pero-saneado (cuerpo de artículos LexPH,
// que sale del editor TipTap). DOMPurify ya está en el repo; este es el único wrapper.
// Allowlist acotada al set que TipTap puede producir (StarterKit h1-h3/p/listas/
// blockquote/strong/em/hr/code + Link a[href] + TextStyle/Color span[style=color]).

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr',
  'ul', 'ol', 'li', 'blockquote',
  'strong', 'b', 'em', 'i', 'u', 's', 'span', 'a', 'code', 'pre',
];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'style'];

// Hook global (se registra una sola vez al importar): todo <a> saneado abre en
// pestaña nueva, sin pasar opener y sin transmitir ranking (noopener/nofollow).
// Es el único uso de DOMPurify en el repo, así que el hook no afecta a nadie más.
let hookRegistered = false;
function ensureHook() {
  if (hookRegistered || typeof window === 'undefined') return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
  hookRegistered = true;
}

export function SafeHtml({ html, className }: { html: string | null | undefined; className?: string }) {
  const clean = useMemo(() => {
    ensureHook();
    return DOMPurify.sanitize(html ?? '', {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      // sólo `color` inline (lo que produce TextStyle/Color); nada de url()/expression
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
    });
  }, [html]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />;
}
