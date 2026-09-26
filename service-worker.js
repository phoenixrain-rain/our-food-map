const CACHE_NAME = 'our-food-map-shell-v14';
const APP_VERSION = '2.9.0';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './app.js?v=2.9.0',
  './styles.css?v=2.9.0',
  './vendor/supabase.js?v=2.9.0',
  './lib/model.js?v=2.9.0',
  './lib/photos.js?v=2.9.0',
  './lib/cloud.js?v=2.9.0',
  './lib/local-store.js?v=2.9.0',
  './lib/avatar.js?v=2.9.0',
  './lib/dom.js?v=2.9.0',
  './lib/discovery.js?v=2.9.0',
  './lib/discovery-ui.js?v=2.9.0',
  './lib/drafts.js?v=2.9.0',
  './lib/draft-ui.js?v=2.9.0',
  './lib/tasks.js?v=2.9.0',
  './lib/gallery.js?v=2.9.0',
  './lib/dialogs.js?v=2.9.0',
  './lib/updates.js?v=2.9.0',
  './lib/insights.js?v=2.9.0',
  './lib/comparison.js?v=2.9.0',
  './lib/comparison-ui.js?v=2.9.0',
  './lib/connection.js?v=2.9.0',
  './icons/app-icon-180.png',
  './icons/app-icon-192.png',
  './icons/app-icon-512.png'
];

self.addEventListener('message', event => {
  if (event.data?.type === 'FOOD_MAP_GET_VERSION') event.ports?.[0]?.postMessage({ type: 'FOOD_MAP_VERSION', version: APP_VERSION });
});

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
    event.respondWith((async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(request, { signal: controller.signal });
        if (response.ok) {
          // Keep the deadline until the HTML body is complete, not just headers.
          await response.clone().arrayBuffer();
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy)));
          return response;
        }
        return await caches.match('./index.html') || response;
      } catch {
        return await caches.match('./index.html') || new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>暂时无法连接</title><h1>暂时无法连接美食地图</h1><p>请联网后重新打开。不要清除网站数据或卸载应用。</p>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      } finally { clearTimeout(timer); }
    })());
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
