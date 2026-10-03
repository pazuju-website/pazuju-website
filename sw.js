const CACHE_VERSION = 'pazuju-shell-v1';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/play.html',
  '/books.html',
  '/css/site.css',
  '/app.webmanifest',
  '/images/pazuju-logo.png',
  '/images/icons/icon-192.png',
  '/images/icons/icon-512.png',
  '/images/icons/maskable-192.png',
  '/images/icons/maskable-512.png',
  '/Online Game/js/pazuju-firebase.js',
  '/Online Game/js/pazuju-xml-loader.js',
  '/Online Game/js/pazuju-engine.js',
  '/Online Game/js/celebration.js',
  '/Online Game/js/ads.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Puzzle content (puzzles/**) and Firebase calls must always be fresh - never served stale.
// Everything else (the static app shell) is cache-first for instant loads and basic offline support.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isPuzzleData = isSameOrigin && url.pathname.startsWith('/puzzles/');

  if (!isSameOrigin || isPuzzleData) {
    return; // let the browser handle it normally (network)
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        return response;
      });
    }).catch(() => caches.match(request))
  );
});
