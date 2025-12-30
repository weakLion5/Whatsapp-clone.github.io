self.addEventListener('install', (e) => {
  console.log('[Service Worker] Install');
});

self.addEventListener('fetch', (e) => {
  // Standar: Biarkan request berjalan normal
  e.respondWith(fetch(e.request));
});
