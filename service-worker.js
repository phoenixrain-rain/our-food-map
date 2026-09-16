const CACHE_NAME = 'our-food-map-shell-v3';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './app.js?v=2.0.0',
  './styles.css?v=2.0.0',
  './vendor/supabase.js?v=2.0.0',
  './lib/model.js?v=2.0.0',
  './lib/photos.js?v=2.0.0',
  './lib/cloud.js?v=2.0.0',
  './lib/local-store.js?v=2.0.0',
  './icons/app-icon-180.png',
  './icons/app-icon-192.png',
  './icons/app-icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('our-food-map-shell-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy)));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && APP_SHELL.some(path => new URL(path, self.registration.scope).href === request.url)) await cache.put(request, response.clone());
      return response;
    })
  );
});
