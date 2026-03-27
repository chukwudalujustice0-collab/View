const CACHE_NAME = "view-sw-v20";
const OFFLINE_URL = "/offline.html";
const APP_BASE_URL = "https://ezarjrxzkqqsbyirxttg.supabase.co"; // kept for reference only
const SUPABASE_URL = "https://ezarjrxzkqqsbyirxttg.supabase.co";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/login.html",
  "/signup.html",
  "/forgot-password.html",
  "/offline.html",

  "/home.html",
  "/explore.html",
  "/chats.html",
  "/chat-room.html",
  "/groups.html",
  "/group-room.html",
  "/calls.html",
  "/call.html",
  "/video-feed.html",
  "/notifications.html",
  "/profile.html",
  "/public-profile.html",
  "/settings.html",
  "/friends.html",
  "/updates.html",
  "/ai-assistant.html",

  "/manifest.json",

  "/icon-72x72.png",
  "/icon-96x96.png",
  "/icon-128x128.png",
  "/icon-144x144.png",
  "/icon-152x152.png",
  "/icon-192x192.png",
  "/icon-384x384.png",
  "/icon-512x512.png"
];

const NETWORK_FIRST_PAGES = [
  "/",
  "/index.html",
  "/login.html",
  "/signup.html",
  "/forgot-password.html",
  "/offline.html",

  "/home.html",
  "/explore.html",
  "/chats.html",
  "/chat-room.html",
  "/groups.html",
  "/group-room.html",
  "/calls.html",
  "/call.html",
  "/video-feed.html",
  "/notifications.html",
  "/profile.html",
  "/public-profile.html",
  "/settings.html",
  "/friends.html",
  "/updates.html",
  "/ai-assistant.html"
];

const NEVER_CACHE_PATTERNS = [
  "supabase.co",
  "/api/",
  "/auth/v1/",
  "/rest/v1/",
  "/storage/v1/",
  "/realtime/v1/",
  "/functions/v1/"
];

function isNeverCache(url) {
  return NEVER_CACHE_PATTERNS.some((pattern) =>
    url.hostname.includes(pattern) || url.pathname.includes(pattern)
  );
}

function isNetworkFirstPage(url) {
  return NETWORK_FIRST_PAGES.some((path) => url.pathname === path);
}

function isStaticAsset(request, url) {
  const destination = request.destination;

  return (
    destination === "style" ||
    destination === "script" ||
    destination === "image" ||
    destination === "font" ||
    destination === "manifest" ||
    destination === "audio" ||
    destination === "video" ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".jpeg") ||
    url.pathname.endsWith(".webp") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".ico") ||
    url.pathname.endsWith(".woff") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".mp3") ||
    url.pathname.endsWith(".mp4")
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

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildNotificationPayload(rawData) {
  const data = rawData || {};
  const type = data.type || "general";

  let url = data.url || "/notifications.html";

  if (type === "chat" && data.conversationId) {
    url = `/chat-room.html?id=${encodeURIComponent(data.conversationId)}`;
  }

  if (type === "group" && data.conversationId) {
    url = `/chat-room.html?id=${encodeURIComponent(data.conversationId)}`;
  }

  if (type === "call") {
    if (data.conversationId || data.userId) {
      const params = new URLSearchParams();
      if (data.conversationId) params.set("conversation_id", data.conversationId);
      if (data.userId) params.set("user_id", data.userId);
      url = `/calls.html?${params.toString()}`;
    } else {
      url = "/calls.html";
    }
  }

  if (type === "profile" && data.userId) {
    url = `/public-profile.html?id=${encodeURIComponent(data.userId)}`;
  }

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

  return {
    title: data.title || "View",
    options: {
      body: data.body || "You have a new notification.",
      icon: data.icon || "/icon-192x192.png",
      badge: data.badge || "/icon-192x192.png",
      image: data.image || undefined,
      vibrate: Array.isArray(data.vibrate) ? data.vibrate : [200, 100, 200],
      tag: data.tag || `view-${type}`,
      renotify: true,
      requireInteraction: Boolean(data.requireInteraction),
      actions,
      data: {
        url,
        type,
        notificationId: data.notificationId || null,
        conversationId: data.conversationId || null,
        userId: data.userId || null
      }
    }
  };
}

async function focusOrOpenUrl(targetUrl) {
  const clientList = await clients.matchAll({
    type: "window",
    includeUncontrolled: true
  });

  const absoluteTarget = new URL(targetUrl, self.location.origin).href;

  for (const client of clientList) {
    const clientUrl = new URL(client.url);

    if (clientUrl.href === absoluteTarget || clientUrl.pathname === new URL(absoluteTarget).pathname) {
      if ("focus" in client) {
        await client.focus();
      }
      if ("navigate" in client) {
        await client.navigate(absoluteTarget);
      }
      return;
    }
  }

  if (clients.openWindow) {
    await clients.openWindow(absoluteTarget);
  }
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
          return Promise.resolve();
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
    return;
  }

  if (event.data.type === "SHOW_LOCAL_NOTIFICATION") {
    const payload = buildNotificationPayload(event.data.payload || {});
    event.waitUntil(
      self.registration.showNotification(payload.title, payload.options)
    );
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

      return new Response("", { status: 504, statusText: "Offline" });
    })
  );
});

self.addEventListener("push", (event) => {
  let parsed = null;

  try {
    if (event.data) {
      const text = event.data.text();
      parsed = safeJsonParse(text) || {
        title: "View",
        body: text || "You have a new notification.",
        url: "/notifications.html"
      };
    } else {
      parsed = {
        title: "View",
        body: "You have a new notification.",
        url: "/notifications.html"
      };
    }
  } catch {
    parsed = {
      title: "View",
      body: "You have a new notification.",
      url: "/notifications.html"
    };
  }

  const payload = buildNotificationPayload(parsed);

  event.waitUntil(
    self.registration.showNotification(payload.title, payload.options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "close") return;

  const targetUrl = event.notification?.data?.url || "/notifications.html";

  event.waitUntil(focusOrOpenUrl(targetUrl));
});

self.addEventListener("notificationclose", () => {
  // reserved for analytics / cleanup later
});

self.addEventListener("sync", (event) => {
  if (event.tag === "view-retry-sync") {
    event.waitUntil(Promise.resolve());
  }
});
