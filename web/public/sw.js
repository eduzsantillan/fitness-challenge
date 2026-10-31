const CACHE = 'ritmo-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('ritmo-shell-') && key !== CACHE).map(key => caches.delete(key))))); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Never intercept API requests, cross-origin requests, auth callbacks, tokens, or personalized responses.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search || (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/api/')) || event.request.headers.has('authorization')) return;
  if (event.request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/').then(response => response || Response.error()))); return;
  }
  if (!SHELL.includes(url.pathname) && !url.pathname.startsWith('/assets/')) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok && response.type === 'basic') { const copy = response.clone(); void caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
    return response;
  })));
});
