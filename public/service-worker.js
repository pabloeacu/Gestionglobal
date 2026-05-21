// Service Worker mínimo para Plataforma Gestión Global.
//
// Estrategia conservadora: app-shell con network-first para HTML/JS/CSS
// (siempre intentamos la versión nueva del deploy), y cache stale-while-
// revalidate para assets estáticos (fonts, íconos, logos). No cachea
// llamadas a Supabase ni a edge functions — esos datos siempre van a red.
//
// Esto habilita "Instalar app" en Chrome/Safari y mejora la percepción de
// velocidad en navegaciones repetidas. NO es offline-first; sin red, el
// usuario ve la UI cacheada pero las queries van a fallar (con sus toasts).

const CACHE_VERSION = 'gg-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const STATIC_ASSETS = [
  '/',
  '/favicon.png',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/brand/logo-white.png',
  '/brand/logo-white-trim.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // No tocamos Supabase ni edge functions ni APIs externas.
  if (
    url.hostname.includes('supabase') ||
    url.hostname.includes('googleapis') ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // HTML / app routes → network first, cache fallback.
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/'))),
    );
    return;
  }

  // Static assets (JS, CSS, fonts, imágenes) → stale-while-revalidate.
  if (
    ['style', 'script', 'image', 'font'].includes(req.destination) &&
    url.origin === self.location.origin
  ) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => {
              cache.put(req, res.clone()).catch(() => {});
              return res;
            })
            .catch(() => cached);
          return cached || network;
        }),
      ),
    );
  }
});
