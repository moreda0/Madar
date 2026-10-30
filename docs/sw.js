// مدار service worker: app shell cache so it opens offline, plus notification clicks.
const CACHE = 'madar-v7'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icons/icon-192.png'])))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))))
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // pages: network first so updates land, cache as fallback
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return r }).catch(() => caches.match('./index.html')))
    return
  }
  // same-origin assets and fonts: cache first
  if (url.origin === location.origin || url.host.endsWith('gstatic.com') || url.host.endsWith('googleapis.com')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) } return r })))
  }
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    const open = list.find((c) => 'focus' in c)
    return open ? open.focus() : self.clients.openWindow('./#/notifications')
  }))
})
