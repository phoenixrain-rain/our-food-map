const CACHE_NAME = 'our-food-map-shell-v15';
const APP_VERSION = '2.9.1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './app.js?v=2.9.1',
  './styles.css?v=2.9.1',
  './vendor/supabase.js?v=2.9.1',
  './lib/model.js?v=2.9.1',
  './lib/photos.js?v=2.9.1',
  './lib/cloud.js?v=2.9.1',
  './lib/local-store.js?v=2.9.1',
  './lib/avatar.js?v=2.9.1',
  './lib/dom.js?v=2.9.1',
  './lib/discovery.js?v=2.9.1',
  './lib/discovery-ui.js?v=2.9.1',
  './lib/drafts.js?v=2.9.1',
  './lib/draft-ui.js?v=2.9.1',
  './lib/tasks.js?v=2.9.1',
  './lib/gallery.js?v=2.9.1',
  './lib/dialogs.js?v=2.9.1',
  './lib/updates.js?v=2.9.1',
  './lib/insights.js?v=2.9.1',
  './lib/comparison.js?v=2.9.1',
  './lib/comparison-ui.js?v=2.9.1',
  './lib/connection.js?v=2.9.1',
  './icons/app-icon-180.png',
  './icons/app-icon-192.png',
  './icons/app-icon-512.png'
];

// An icon failure must not block a working application. Keep the complete,
// versioned HTML/JS/CSS together; these optional decorations can catch up later.
const OPTIONAL_SHELL = ['./manifest.webmanifest', './icons/app-icon-180.png', './icons/app-icon-192.png', './icons/app-icon-512.png'];
async function fetchComplete(path, milliseconds = 45000) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), milliseconds);
  try {
    const response = await fetch(new URL(path, self.registration.scope), { cache: 'reload', signal: controller.signal });
    if (!response.ok) throw new Error('Application resource unavailable');
    await response.clone().arrayBuffer();
    return response;
  } finally { clearTimeout(timer); }
}

self.addEventListener('message', event => {
  if (event.data?.type === 'FOOD_MAP_GET_VERSION') event.ports?.[0]?.postMessage({ type: 'FOOD_MAP_VERSION', version: APP_VERSION });
  if (event.data?.type === 'FOOD_MAP_REPAIR_SHELL') event.waitUntil(ensureShell().then(
    () => event.ports?.[0]?.postMessage({ type: 'FOOD_MAP_REPAIR_RESULT', complete: true }),
    () => event.ports?.[0]?.postMessage({ type: 'FOOD_MAP_REPAIR_RESULT', complete: false })
  ));
});

async function prepareShell() {
    const required = APP_SHELL.filter(path => !OPTIONAL_SHELL.includes(path) && path !== './');
    const downloaded = await Promise.all(required.map(async path => [path, await fetchComplete(path)]));
    const html = downloaded.find(([path]) => path === './index.html')[1];
    const source = await html.clone().text();
    // A CDN may briefly serve an older HTML document during deployment. Never
    // activate that document with this worker's differently-versioned modules.
    if (!['app.js', 'styles.css', 'vendor/supabase.js'].every(path => source.includes(`./${path}?v=${APP_VERSION}`))) {
      throw new Error('Application versions do not match');
    }
    const cache = await caches.open(CACHE_NAME), rootDocument = html.clone();
    await Promise.all([...downloaded.map(([path, response]) => cache.put(path, response)), cache.put('./', rootDocument)]);
    await Promise.allSettled(OPTIONAL_SHELL.map(async path => cache.put(path, await fetchComplete(path, 4000))));
}
let repair = null;
function ensureShell() {
  if (!repair) repair = (async () => {
    const cache = await caches.open(CACHE_NAME);
    const required = APP_SHELL.filter(path => !OPTIONAL_SHELL.includes(path));
    if ((await Promise.all(required.map(path => cache.match(path)))).every(Boolean)) return;
    await prepareShell();
  })().finally(() => { repair = null; });
  return repair;
}
self.addEventListener('install', event => {
  event.waitUntil(prepareShell().then(() => self.skipWaiting()));
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
      // Pin navigation to the *installed* release. Replacing just this HTML
      // with the newest network document corrupts an otherwise complete shell
      // when the next worker cannot finish installing. UpdateUI prepares the
      // next release separately and never reloads an open editor automatically.
      const cached = await (await caches.open(CACHE_NAME)).match('./index.html');
      if (cached) return cached;
      try {
        // Storage may be evicted by the browser. A network-only fallback must
        // not mutate a versioned cache piecemeal, or mix it with another cache.
        return await fetchComplete(request.url, 30000);
      } catch {
        return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>暂时无法连接</title><h1>暂时无法连接美食地图</h1><p>请联网后重新打开。不要清除网站数据或卸载应用。</p>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
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
