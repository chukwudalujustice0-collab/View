const CACHE_NAME = "view-cache-v7";

// Only static files here (DO NOT add home.html or dynamic pages)
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/login.html",
  "/signup.html",
  "/manifest.json",
  "/install.js",
  "/icon-192x192.png",
  "/icon-512x512.png"
];


// ================= INSTALL =================
self.addEventListener("install", (event) => {
  console.log("Service Worker Installing...");

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );

  self.skipWaiting(); // activate immediately
});


// ================= ACTIVATE =================
self.addEventListener("activate", (event) => {
  console.log("Service Worker Activated");

  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("Deleting old cache:", key);
            return caches.delete(key);
          }
        })
      )
    )
  );

  self.clients.claim(); // take control immediately
});


// ================= FETCH =================
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only GET requests
  if (request.method !== "GET") return;

  // 🚫 NEVER CACHE SUPABASE OR API
  if (
    url.hostname.includes("supabase.co") ||
    url.pathname.startsWith("/api/")
  ) {
    event.respondWith(fetch(request));
    return;
  }

  // ================= HTML (NETWORK FIRST) =================
  if (
    request.headers.get("accept") &&
    request.headers.get("accept").includes("text/html")
  ) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          // Save fresh version
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone);
          });
          return networkResponse;
        })
        .catch(() => {
          // fallback if offline
          return caches.match(request) || caches.match("/index.html");
        })
    );
    return;
  }

  // ================= STATIC FILES (CACHE FIRST) =================
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(request).then((networkResponse) => {
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, clone);
        });
        return networkResponse;
      });
    })
  );
});


// ================= FORCE UPDATE =================
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
