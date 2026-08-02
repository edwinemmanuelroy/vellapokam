/* Kerala Flood Dashboard — service worker.
 *
 * Deliberately minimal: its only job is delivering rescue notifications.
 * No caching/offline logic lives here yet (see ROADMAP: offline SOS queueing),
 * so there is no stale-asset risk from this file.
 */

// Take over immediately — a rescue alert should not wait for a tab to close.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const isSos = data.kind === "sos";
  const title = data.title || "Kerala Flood Alert";

  const options = {
    body: data.body || "",
    // Icons live in /icons; both are plain PNGs so every platform renders them.
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    // Group by tag so a burst of alerts does not bury the screen, but never
    // collapse distinct SOS reports into one another.
    tag: data.tag || (isSos ? `sos-${Date.now()}` : "alert"),
    requireInteraction: isSos, // an SOS should not auto-dismiss
    vibrate: isSos ? [200, 100, 200, 100, 200] : [150],
    data: { url: data.url || "/" },
    actions: [{ action: "open", title: isSos ? "View rescue" : "Open" }],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Reuse an open dashboard tab rather than piling up new ones.
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(target).catch(() => {});
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      })
  );
});
