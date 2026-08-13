/* ==========================================================================
   OCR Brillance — service worker de l'app client (rdv.ocrbrillance.com)

   · L'app s'ouvre INSTANTANÉMENT : la page vient du téléphone, pas du réseau.
   · Elle se met à jour quand même : la nouvelle version est téléchargée en
     arrière-plan et, si elle diffère, un bandeau propose de l'appliquer.
     C'est le seul moyen d'avoir les deux à la fois — avant, la page passait
     toujours par le réseau d'abord : ~430 Ko à attendre à chaque ouverture,
     ce qui donnait l'impression que « l'app tourne lentement » (13/08).
     Ici, aucun bandeau : un client n'a pas à gérer des versions, la
     prochaine ouverture partira sur la nouvelle.
   · Les tarifs restent consultables hors ligne ; les créneaux et les
     réservations, jamais mis en cache — ce sont des données vivantes.
   ========================================================================== */
const CACHE = 'ocr-rdv-v2';
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

// La version inscrite dans la page : c'est elle qui dit si le fichier a changé.
// La version de l'ATELIER (vNN) — pas celle du socle partagé, qui apparaît
// plus haut dans le fichier et vaut « 1.2.0 » (piège vu au test du 13/08).
const versionDe = txt => (txt.match(/const VERSION = '(v\d+)'/) || [])[1] || String(txt.length);

async function prevenirLesEcrans(version) {
  const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  cs.forEach(c => c.postMessage({ type: 'ocr-nouvelle-version', version }));
}

// Va chercher la page à jour en arrière-plan, la range, et prévient l'écran
// si elle est différente de celle qu'on vient de servir.
async function rafraichirEnFond(requete, ancienTxt) {
  try {
    const r = await fetch(requete, { cache: 'no-store' });
    if (!r || !r.ok) return;
    const txt = await r.clone().text();
    const c = await caches.open(CACHE);
    await c.put('/', r.clone());
    if (ancienTxt && versionDe(txt) !== versionDe(ancienTxt)) await prevenirLesEcrans(versionDe(txt));
  } catch (e) { /* hors ligne : on garde ce qu'on a */ }
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.host.includes('supabase.co')) return;   // données vivantes : jamais en cache

  // PAGES : le cache d'abord (ouverture immédiate), le réseau derrière.
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const enCache = await c.match('/');
      if (enCache) {
        const ancienTxt = await enCache.clone().text();
        e.waitUntil(rafraichirEnFond(e.request, ancienTxt));
        return enCache;
      }
      // première ouverture : rien en cache, on prend le réseau
      try {
        const r = await fetch(e.request);
        c.put('/', r.clone());
        return r;
      } catch (ex) {
        return new Response('<h1>Hors ligne</h1><p>Reconnecte-toi une fois pour installer l’application.</p>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // icônes, polices, bibliothèque Supabase : cache d'abord (ouverture instantanée)
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

/* L'écran nous interroge — « quelle version as-tu en réserve ? »
   On répond seulement si elle diffère de la sienne. C'est la voie fiable :
   le message poussé juste après un rechargement peut arriver avant que la
   page n'ait eu le temps d'écouter (course vue au test du 13/08). */
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'ocr-appliquer') { self.skipWaiting(); return; }
  if (d.type !== 'ocr-version?') return;
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const r = await c.match('/');
    if (!r) return;
    const v = versionDe(await r.text());
    if (v && d.version && v !== d.version && e.source)
      e.source.postMessage({ type: 'ocr-nouvelle-version', version: v });
  })());
});
