// GPSMap web: guarda los archivos de la app para que abra sin conexion (lo que ya se haya cargado).
// Siempre se pide primero la version nueva al servidor (sin la cache del navegador); los mapas no van aqui.
const CACHE = 'gpsmap-app-v2';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || e.request.headers.has('range')) return;
  // red primero y sin cache del navegador (siempre la ultima version publicada); sin conexion, lo guardado
  e.respondWith(fetch(e.request, { cache: 'no-store' }).then((r) => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then((cache) => cache.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
