const CACHE = 'inneedmoney-v16';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  './favicon-32.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // einzeln hinzufuegen: ein fehlendes Asset soll die Installation nicht kippen
      .then(c => Promise.all(APP_SHELL.map(url => c.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // Navigation: erst Netz (frische App), bei Offline aus dem Cache
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(resp => {
          const klon = resp.clone();
          caches.open(CACHE).then(c => c.put('./index.html', klon));
          return resp;
        })
        .catch(() => caches.match('./index.html').then(c => c || caches.match('./')))
    );
    return;
  }

  // Assets ebenfalls Netz zuerst: sonst passt frisches HTML nicht zu altem CSS/JS.
  // Offline greift der Cache, und jede erfolgreiche Antwort haelt ihn aktuell.
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(resp => {
        if (resp && resp.ok) {
          const klon = resp.clone();
          caches.open(CACHE).then(c => c.put(req, klon));
        }
        return resp;
      })
      .catch(() => caches.match(req).then(c => c || Response.error()))
  );
});
