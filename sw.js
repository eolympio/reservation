/* ==========================================================================
   OCR Brillance — service worker de l'app client (rdv.ocrbrillance.com)
   · L'app s'ouvre instantanément (coquille en cache) et marche hors ligne
     pour consulter les tarifs.
   · Les PAGES passent toujours par le réseau d'abord : personne ne reste
     bloqué sur une vieille version. Hors ligne → version en cache.
   · Les appels à la base (Supabase) ne sont JAMAIS mis en cache.
   ========================================================================== */
const CACHE = 'ocr-rdv-v1';
const COQUILLE = ['/', 'icon.png', 'icon-192.png', 'icon-512.png', 'manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.host.includes('supabase.co')) return;   // données vivantes, jamais en cache

  // pages : réseau d'abord (toujours à jour), cache en secours (hors ligne)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(r => {
        const copie = r.clone();
        caches.open(CACHE).then(c => c.put('/', copie));
        return r;
      }).catch(() => caches.match('/'))
    );
    return;
  }

  // icônes, polices, bibliothèques : cache d'abord (instantané), réseau sinon
  const cachable = url.origin === location.origin ||
                   /jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.host);
  if (cachable) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
        const copie = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copie));
        return r;
      }))
    );
  }
});
