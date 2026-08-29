/* ══════════════════════════════════════════════════════════════════
   H&H ACCOUNT SYNC — SERVICE WORKER (OFFLINE FIRST & CACHE ENGINE)
   ══════════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'hh-sync-cache-v1';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@300;400;500&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

// Install Event: Pre-cache app shell & essential CDNs
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Pre-caching offline application shell & assets');
      // Attempt caching each asset resiliently
      for (const asset of PRECACHE_ASSETS) {
        try {
          const response = await fetch(asset, { mode: asset.startsWith('http') && !asset.includes(self.location.hostname) ? 'cors' : 'same-origin' });
          if (response && response.ok) {
            await cache.put(asset, response);
          }
        } catch (err) {
          console.warn('[SW] Could not pre-cache asset:', asset, err);
        }
      }
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Cleanup stale caches & take immediate control
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Clearing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Offline-first caching strategy
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip non-GET requests (e.g. POST requests go directly to network or handled by client queue)
  if (req.method !== 'GET') {
    return;
  }

  // 1. Navigation requests (HTML documents) -> Network-first with Cache fallback
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/', responseClone));
          }
          return networkResponse;
        })
        .catch(async () => {
          console.log('[SW] Serving cached application shell offline for navigation');
          const cachedResponse = await caches.match('/index.html') || await caches.match('/');
          if (cachedResponse) {
            return cachedResponse;
          }
          return new Response('<h1>H&H Account Sync</h1><p>অফলাইন মোডে আছেন। অনুগ্রহ করে পুনরায় চেষ্টা করুন।</p>', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        })
    );
    return;
  }

  // 2. Static Assets (Scripts, Styles, Fonts, CDN Libraries) -> Cache-first with runtime caching
  if (
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    req.destination === 'style' ||
    req.destination === 'script' ||
    req.destination === 'font' ||
    req.destination === 'image'
  ) {
    event.respondWith(
      caches.match(req).then((cachedResponse) => {
        if (cachedResponse) {
          // Return cached and refresh in background (Stale-While-Revalidate)
          fetch(req).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(req, networkResponse));
            }
          }).catch(() => {/* Ignore background fetch failure when offline */});
          return cachedResponse;
        }

        // Fetch from network and cache
        return fetch(req).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, responseClone));
          }
          return networkResponse;
        }).catch(() => {
          // If offline and not in cache, fallback gracefully
          return new Response('', { status: 408, statusText: 'Offline Asset Unavailable' });
        });
      })
    );
    return;
  }

  // 3. Default fallback: Network first, cache fallback
  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, responseClone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(req))
  );
});

// Background Sync (when connection is restored)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-sheets-queue' || event.tag === 'sync-google-sheets') {
    console.log('[SW] Background Sync event triggered:', event.tag);
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'BACKGROUND_SYNC_TRIGGERED', timestamp: Date.now() });
        });
      })
    );
  }
});

// Message listener from client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CHECK_OFFLINE_STATUS') {
    event.source.postMessage({
      type: 'SW_STATUS',
      cacheName: CACHE_NAME,
      online: navigator.onLine,
      ready: true
    });
  }
});
