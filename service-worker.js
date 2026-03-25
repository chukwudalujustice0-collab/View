const CACHE_NAME = "view-cache-v2";
const OFFLINE_FALLBACK = "/home.html";

const APP_ASSETS = [
  "/",
  "/index.html",
  "/login.html",
  "/signup.html",
  "/forgot-password.html",
  "/reset-password.html",
  "/dashboard.html",
  "/home.html",
  "/explore.html",
  "/create-post.html",
  "/video-feed.html",
  "/messages.html",
  "/chat.html",
  "/call.html",
  "/video-call.html",
  "/profile.html",
  "/edit-profile.html",
  "/followers.html",
  "/following.html",
  "/comments.html",
  "/saved-posts.html",
  "/notifications.html",
  "/wallet.html",
  "/subscriptions.html",
  "/analytics.html",
  "/connected-accounts.html",
  "/publish-history.html",
  "/drafts.html",
  "/scheduled-posts.html",
  "/ai-help.html",
  "/settings.html",
  "/support.html",
  "/faq.html",
  "/terms.html",
  "/privacy.html",
  "/community-guidelines.html",
  "/about.html",
  "/friends.html",
  "/chats.html",
  "/chat-room.html",
  "/search-results.html",
  "/manifest.json",
  "/install.js",

  "/icons/icon-72x72.png",
  "/icons/icon-96x96.png",
  "/icons/icon-128x128.png",
  "/icons/icon-144x144.png",
  "/icons/icon-152x152.png",
  "/icons/icon-192x192.png",
  "/icons/icon-384x384.png",
  "/icons/icon-512x512.png"
];

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);

  for (const asset of APP_ASSETS) {
    try {
      await cache.add(asset);
    } catch (error) {
      console.warn("Could not cache asset:", asset, error);
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return null;
        })
      );
    })
  );

  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);

  // Skip non-http protocols
  if (!requestUrl.protocol.startsWith("http")) return;

  // HTML pages: network first, fallback to cache/offline page
  if (
    request.mode === "navigate" ||
    request.headers.get("accept")?.includes("text/html")
  ) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return networkResponse;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) return cachedResponse;

          const fallback = await caches.match(OFFLINE_FALLBACK);
          return fallback || new Response("Offline", { status: 503 });
        })
    );
    return;
  }

  // Static files / images / scripts / css: cache first, then network
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }

          const responseClone = networkResponse.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });

          return networkResponse;
        })
        .catch(() => {
          // optional image fallback
          if (request.destination === "image") {
            return caches.match("/icons/icon-192x192.png");
          }
        });
    })
  );
});

self.addEventListener("push", (event) => {
  let data = {
    title: "View",
    body: "You have a new notification.",
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-96x96.png",
    image: "",
    url: "/notifications.html"
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch (error) {
      console.warn("Push payload was not valid JSON");
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.badge,
      image: data.image || undefined,
      data: {
        url: data.url || "/notifications.html"
      }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || "/notifications.html";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const clientUrl = new URL(client.url);

        if (clientUrl.origin === self.location.origin) {
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

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
