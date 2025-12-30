const CACHE_NAME = 'wa-clone-v1';
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './logic.js',
  './manifest.json'
];

// 1. Install Service Worker
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Paksa update SW baru
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Caching files');
        return cache.addAll(urlsToCache);
      })
  );
});

// 2. Activate (Bersihkan cache lama)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// 3. Fetch (Ambil data dengan Error Handling) - BAGIAN YANG DIPERBAIKI
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .catch(() => {
        // Jika Fetch Gagal (Offline/Error), coba cari di Cache
        return caches.match(event.request);
      })
  );
});
