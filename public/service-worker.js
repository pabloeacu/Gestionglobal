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

// Web Push notifications (VAPID). El payload viene cifrado por el
// dispatcher (dispatch-push edge function) y el browser lo descifra
// antes de pasarlo a este handler.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { titulo: 'Notificación', cuerpo: event.data ? event.data.text() : '' };
  }
  const title = data.titulo || 'Gestión Global';
  const options = {
    body: data.cuerpo || '',
    icon: data.icono_url || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.click_url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          // Si ya hay una ventana abierta, foco + navegar.
          w.focus();
          if ('navigate' in w) {
            try { w.navigate(targetUrl); } catch (_) { /* noop */ }
          }
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    }),
  );
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
