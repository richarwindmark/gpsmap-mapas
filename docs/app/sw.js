// GPSMap web: guarda los archivos de la app para que abra rapido (y sin conexion, lo que ya se haya cargado).
// Los mapas no se guardan aqui: los gestiona la propia app.
const CACHE = 'gpsmap-app-v1';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || e.request.headers.has('range')) return;
  // red primero (siempre la version nueva), y si no hay conexion, lo guardado
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then((cache) => cache.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
