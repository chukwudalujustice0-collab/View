const CACHE_NAME = "view-sw-v10";
const OFFLINE_URL = "/offline.html";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/home.html",
  "/explore.html",
  "/chats.html",
  "/notifications.html",
  "/profile.html",
  "/settings.html",
  "/manifest.json",
  "/icon-72x72.png",
  "/icon-96x96.png",
  "/icon-128x128.png",
  "/icon-144x144.png",
  "/icon-152x152.png",
  "/icon-192x192.png",
  "/icon-384x384.png",
  "/icon-512x512.png",
  OFFLINE_URL
];

const NETWORK_FIRST_PAGES = [
  "/",
  "/index.html",
  "/home.html",
  "/explore.html",
  "/chats.html",
  "/chat-room.html",
  "/notifications.html",
  "/profile.html",
  "/settings.html",
  "/call.html",
  "/groups.html",
  "/friends.html",
  "/updates.html"
];

const NEVER_CACHE_PATTERNS = [
  "supabase.co",
  "/api/",
  "/auth/v1/",
  "/rest/v1/",
  "/storage/v1/",
  "/realtime/v1/"
];

function isNeverCache(url) {
  return NEVER_CACHE_PATTERNS.some(pattern =>
    url.hostname.includes(pattern) || url.pathname.includes(pattern)
  );
}

function isNetworkFirstPage(url) {
  return NETWORK_FIRST_PAGES.some(path => url.pathname === path);
}

function isStaticAsset(request, url) {
  const destination = request.destination;
  return (
    destination === "style" ||
    destination === "script" ||
    destination === "image" ||
    destination === "font" ||
    destination === "manifest" ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".jpeg") ||
    url.pathname.endsWith(".webp") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".ico") ||
    url.pathname.endsWith(".woff") ||
    url.pathname.endsWith(".woff2")
  );
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;

    if (request.mode === "navigate") {
      const offline = await cache.match(OFFLINE_URL);
      if (offline) return offline;
    }

    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const networkResponse = await fetch(request);
  if (networkResponse && networkResponse.ok) {
    cache.put(request, networkResponse.clone());
  }
  return networkResponse;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const asset of STATIC_ASSETS) {
        try {
          await cache.add(asset);
        } catch (error) {
          console.warn("SW failed to precache:", asset, error);
        }
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") return;

  if (isNeverCache(url)) {
    event.respondWith(fetch(request));
    return;
  }

  if (
    request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html") ||
    isNetworkFirstPage(url)
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAsset(request, url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(
    fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        return cache.match(OFFLINE_URL);
      }
    })
  );
});

self.addEventListener("push", (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {
      title: "View",
      body: "You have a new notification.",
      url: "/notifications.html"
    };
  }

  const type = data.type || "general";

  let actions = [
    { action: "open", title: "Open" },
    { action: "close", title: "Dismiss" }
  ];

  if (type === "call") {
    actions = [
      { action: "open", title: "Answer" },
      { action: "close", title: "Dismiss" }
    ];
  }

  const options = {
    body: data.body || "You have a new notification.",
    icon: data.icon || "/icon-192x192.png",
    badge: data.badge || "/icon-192x192.png",
    image: data.image || undefined,
    vibrate: data.vibrate || [200, 100, 200],
    tag: data.tag || `view-${type}`,
    renotify: true,
    requireInteraction: !!data.requireInteraction,
    actions,
    data: {
      url: data.url || "/notifications.html",
      type,
      notificationId: data.notificationId || null,
      conversationId: data.conversationId || null,
      userId: data.userId || null
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "View", options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "close") return;

  const targetUrl = event.notification.data?.url || "/notifications.html";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

self.addEventListener("notificationclose", () => {
  // reserved for analytics or cleanup later
});

self.addEventListener("sync", (event) => {
  if (event.tag === "view-retry-sync") {
    event.waitUntil(Promise.resolve());
  }
});
