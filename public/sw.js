// XClozr — service worker: recebe as notificações (vendas, chip caiu, cliente chamando, resumo do dia)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { titulo: "XClozr", corpo: event.data ? event.data.text() : "" };
  }
  const titulo = d.titulo || "XClozr";
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: d.corpo || "",
      icon: "/icone-192.png",
      badge: "/icone-badge.png",
      tag: d.tag || undefined,
      renotify: Boolean(d.tag),
      data: { link: d.link || "/" },
      vibrate: [120, 60, 120],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = new URL((event.notification.data && event.notification.data.link) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const j of janelas) {
        if (new URL(j.url).origin === self.location.origin) {
          await j.focus();
          if ("navigate" in j) await j.navigate(link).catch(() => null);
          return;
        }
      }
      await self.clients.openWindow(link);
    })(),
  );
});
