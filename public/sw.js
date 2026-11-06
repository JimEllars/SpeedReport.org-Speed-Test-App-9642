const CACHE_NAME = 'speedreport-cache-v1';

// The manifest is served as /manifest.webmanifest (see index.html). Pointing at
// /manifest.json did not fail loudly: this origin answers unknown paths with the
// SPA shell, so `cache.addAll` succeeded and precached index.html under a
// manifest key, while the real manifest was never stored.
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      // One missing asset used to reject `addAll` and abort the whole install,
      // leaving the app with no service worker at all and no visible reason why.
      .then((cache) => Promise.allSettled(ASSETS_TO_CACHE.map((asset) => cache.add(asset))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
          return undefined;
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Enforce direct network fetch for telemetry, benchmarking payloads, and all API calls
  if (url.pathname.startsWith('/api/') || url.pathname === '/health' || url.pathname === '/download' || url.pathname === '/upload') {
    return event.respondWith(fetch(event.request));
  }

  // Navigations are network-first. Cache-first pinned index.html (and with it the
  // hashed bundle it references) for as long as the cache survived, so a browser
  // that had visited once kept booting a build that had already been replaced.
  if (event.request.mode === 'navigate') {
    return event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached || Response.error()))
    );
  }

  // CacheFirst for other static assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((response) => {
        // Cache new assets on the fly
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      });
    })
  );
});
