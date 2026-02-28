// BurgerShot Service Worker — Push Notifications
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let data = { title: "BurgerShot", body: "Benachrichtigung" };
  try { data = e.data.json(); } catch(_) {}

  e.waitUntil(
    self.registration.showNotification(data.title || "BurgerShot", {
      body: data.body || "",
      icon: "/logo.png",
      badge: "/logo.png",
      tag: data.tag || "burgershot",
      renotify: true,
      data: { url: data.url || "/" }
    })
  );
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      if (list.length > 0) return list[0].focus();
      return clients.openWindow(e.notification.data?.url || "/");
    })
  );
});
