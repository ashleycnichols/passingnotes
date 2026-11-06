// Passing Notes service worker: shows tag notifications. No offline caching.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(d.title || 'Passing Notes', {
      body: d.body || 'You were tagged in a scene',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: d.tag,
      data: { url: d.url || './' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of windows) {
      if (c.url.startsWith(self.registration.scope)) {
        c.postMessage({ navigate: url });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
