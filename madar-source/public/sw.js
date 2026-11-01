// مدار service worker: app shell cache so it opens offline, push notifications, notification clicks.
const CACHE = 'madar-v18'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './mascot/man.webp', './mascot/icon.png', ...['chicken', 'duck', 'trombone'].map((n) => `./sounds/lib/${n}.mp3`)])))
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

// pushed from the madar-push function: {title, body, tag, taskId, kind}
// Madar's own vibration: a short orbit (three taps then a long one); late tasks buzz harder
const VIBRATE = { assigned: [90, 70, 90, 70, 90, 70, 320], reminder: [120, 90, 120], overdue: [300, 120, 300, 120, 300] }
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { title: 'مدار', body: e.data ? e.data.text() : '' } }
  e.waitUntil(Promise.all([
    // any open Madar window plays the funny sound; the phone's own sound covers the rest
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => list.forEach((c) => c.postMessage({ type: 'ring', kind: d.kind }))),
    self.registration.showNotification(d.title || 'مدار', {
    body: d.body || '',
    tag: d.tag,
    renotify: true,
    icon: './mascot/icon.png',
    badge: './icons/icon-192.png',
    dir: 'rtl',
    lang: 'ar',
    vibrate: VIBRATE[d.kind] || [120, 80, 120],
    requireInteraction: d.kind === 'overdue' || d.kind === 'assigned',
    data: { url: d.taskId ? `./#/tasks?t=${d.taskId}` : './#/notifications' },
  })]))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || './#/notifications'
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    const open = list.find((c) => 'focus' in c)
    if (open) return open.navigate ? open.navigate(url).then((c) => (c || open).focus()) : open.focus()
    return self.clients.openWindow(url)
  }))
})
