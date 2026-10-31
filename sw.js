const CACHE = 'ardesia-v22';
const FILES = ['/', '/index.html', '/styles.css', '/src/ink-engine-adapters.js', '/vendor/signature_pad-5.1.4.js', '/vendor/paper-core-0.16.0.js', '/src/ink-engine.js', '/src/app.js', '/src/core.js', '/src/ink.js', '/src/live-ink.js', '/src/pen-preview.js', '/src/tool-settings.js', '/src/tool-cursor.js', '/src/size-picker.js', '/src/pen-training.js', '/src/perf.js', '/src/storage.js', '/manifest.webmanifest', '/assets/icon.svg', '/assets/icon-192.png', '/assets/icon-512.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('ardesia-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && FILES.includes(new URL(event.request.url).pathname)) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
    return response;
  }).catch(() => caches.match(event.request)));
});






