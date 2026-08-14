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

// E-GG-155: bump a v2 → purga el index.html añejo cacheado por v1 (el
// fallback offline podía servir un app-shell de semanas atrás cuyo bundle
// pre-E-GG-144 refrescaba tokens sin lock y hacía revocar la familia).
const CACHE_VERSION = 'gg-v3'; // DGG-136 cutover: purga gg-v2 (theme-boot/CSS añejos)
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
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
      // E-GG-155 · pestañas/PWA "zombies" que quedaron abiertas por días corren
      // el bundle viejo en memoria y jamás se recargan solas — son las que
      // rotaban tokens con código pre-E-GG-144 y hacían revocar la familia.
      // Al activarse un SW nuevo (deploy), recargamos SOLO las ocultas (jamás
      // ante los ojos del usuario). Las visibles se recargan desde main.tsx
      // cuando el usuario las oculta (controllerchange → reload diferido).
      // §6 B#3: NUNCA recargar la pestaña de recuperación de contraseña — su
      // sesión vive solo en memoria (DGG-93) y el hash del link ya fue
      // consumido: un reload la dejaría sin poder terminar el reset.
      //
      // §6 B#4 (ping/pong): antes de navegar un client oculto le preguntamos
      // si corre un bundle nuevo. Los nuevos responden 'pong' y se recargan
      // solos vía controllerchange respetando drawers abiertos (main.tsx);
      // los viejos (sin listener) no responden → navigate forzado, que es el
      // único remedio para un bundle pre-fix clavado en memoria.
      // (re-§6 D2b: pings en PARALELO — con N zombies el activate tarda ~2s
      // total, no N×2s.)
      const wins = await self.clients.matchAll({ type: 'window' });
      await Promise.all(wins.map(async (w) => {
        if (
          w.visibilityState !== 'hidden' ||
          !('navigate' in w) ||
          w.url.includes('/restablecer')
        ) {
          return;
        }
        const esBundleNuevo = await new Promise((resolve) => {
          const ch = new MessageChannel();
          const t = setTimeout(() => resolve(false), 2000);
          ch.port1.onmessage = () => { clearTimeout(t); resolve(true); };
          try {
            w.postMessage({ type: 'GG_SW_PING' }, [ch.port2]);
          } catch (_) {
            clearTimeout(t); resolve(false);
          }
        });
        if (!esBundleNuevo) {
          try { await w.navigate(w.url); } catch (_) { /* noop */ }
        }
      }));
    })(),
  );
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
