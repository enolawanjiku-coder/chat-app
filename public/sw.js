// v2: only cache immutable hashed assets. Never cache navigations or API traffic,
// so new deploys can never serve a stale app shell.
const CACHE = 'sc-v2'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // never touch supabase traffic
  if (url.hostname.includes('supabase.co')) return
  // navigations always go to network (offline falls back to cached shell)
  if (request.mode === 'navigate') {
    e.respondWith(fetch(request).catch(() => caches.match('/')))
    return
  }
  // cache only versioned static assets (js/css/images), never html
  if (!url.pathname.startsWith('/assets/')) return
  e.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {})
          return res
        }),
    ),
  )
})
