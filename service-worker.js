const CACHE_NAME = "view-cache-v1";

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
  "/manifest.json",
  "/icon-72.png",
  "/icon-96.png",
  "/icon-128.png",
  "/icon-144.png",
  "/icon-152.png",
  "/icon-192.png",
  "/icon-384.png",
  "/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_ASSETS);
    })
  );

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
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((networkResponse) => {
          if (
            !networkResponse ||
            networkResponse.status !== 200 ||
            networkResponse.type !== "basic"
          ) {
            return networkResponse;
          }

          const responseClone = networkResponse.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });

          return networkResponse;
        })
        .catch(() => {
          if (request.headers.get("accept")?.includes("text/html")) {
            return caches.match("/index.html");
          }
        });
    })
  );
});