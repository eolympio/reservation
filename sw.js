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

/* ── LA VERSION, ET COMMENT ON LA LIT (corrigé le 15/08) ──────────────────
   Avant, on cherchait « const VERSION = 'v69' » dans le JavaScript de la
   page. Depuis que le fichier publié est minifié, cette ligne est réécrite
   (const VERSION="v70") : introuvable. On se rabattait alors sur le NOMBRE DE
   CARACTÈRES du fichier — Edwin a vu « Nouvelle version 545981 prête », et le
   bandeau revenait indéfiniment puisqu'un nombre de caractères n'égalera
   jamais « v70 ».
   Deux leçons, appliquées ici :
     · on lit la version dans le HTML (<meta> ou commentaire), que la
       minification ne touche pas ;
     · plus AUCUN repli inventé. Pas de version lisible = on se tait. Un
       bandeau qu'on ne peut pas faire disparaître est pire que pas de
       bandeau du tout.
   ────────────────────────────────────────────────────────────────────────── */
const versionDe = txt =>
  (txt.match(/name="ocr-version" content="(v\d+)"/) || [])[1] ||
  (txt.match(/const VERSION = '(v\d+)'/) || [])[1] ||
  null;

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
