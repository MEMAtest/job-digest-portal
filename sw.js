const CACHE_VERSION = 'v8';
const CACHE_NAME = `job-digest-${CACHE_VERSION}`;

const APP_SHELL = [
  '/index.html',
  '/styles.css',
  '/styles.part1.css',
  '/styles.part2.css',
  '/styles.part3.css',
  '/app.js',
  '/app.core.js',
  '/app.cv.js',
  '/app.applyhub.js',
  '/app.cvhub.js',
  '/app.bootstrap.js',
  '/app.jobs.js',
  '/app.dashboard.js',
  '/app.notifications.js',
  '/app.prep.js',
  '/app.triage.js',
  '/config.js',
  '/favicon.svg',
  '/manifest.webmanifest',
];

// Install: pre-cache the app shell, then skip waiting
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches, then claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('job-digest-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests over http(s) (Cache API rejects other schemes)
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  // Network-only for Firebase / Firestore / Google APIs (let SDK handle caching)
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com')
  ) {
    return;
  }

  // CDN assets (Google Fonts, html2pdf, etc.): cache-first
  if (url.origin !== location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            // Cache valid responses and opaque cross-origin responses
            // (opaque responses have status 0 but are usable by the browser)
            if (response.ok || response.type === 'opaque') {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => Response.error());
      })
    );
    return;
  }

  // App shell: stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline: if no specific cache hit, fall back to index.html
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return Response.error();
        });

      return cached || fetchPromise;
    })
  );
});
