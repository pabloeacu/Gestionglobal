// Rutas públicas "rastreables" por el píxel de Meta — DGG-242.
// ALLOWLIST estricta (no denylist): el píxel SÓLO puede dispararse en estas
// rutas de marketing. Todo lo demás (/portal, /gerencia, campus, /ingresar,
// tokens externos, etc.) queda fuera por diseño → el píxel NUNCA carga ahí.

export function isTrackablePath(pathname: string): boolean {
  const p = (pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
  if (p === '/' || p === '/inicio' || p === '/plataforma' || p === '/privacidad') return true;
  if (p === '/eventos' || p === '/webinars') return true;
  if (p.startsWith('/formulario/')) return true;
  return false;
}
