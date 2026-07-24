/* كريستو — sw.js
   Minimal offline shell:
   - precache the app shell on install
   - network-first for data/*.json (menu & price edits propagate instantly)
   - cache-first for assets/ (immutable image/font pipeline output)
   - navigation fallback to the cached shell (the app IS the offline page) */

const CACHE = "kristo-f2c71f2e5e";

const SHELL = [
  "./",
  "index.html",
  "manifest.json",
  "css/bundle.min.css",
  "js/vendor/gsap-bundle.min.js",
  "js/app.js",
  "js/utils.js",
  "js/menu.js",
  "js/story.js",
  "js/ingredients.js",
  "js/swipe.js",
  "js/animations.js",
  "js/parallax.js",
  "js/loader.js",
  "data/brand.json",
  "data/social.json",
  "data/settings.json",
  "data/categories.json",
  "data/menu.json",
  "data/prices.json",
  "data/story.json",
  "data/i18n.json",
  "assets/fonts/ArefRuqaa-700-arabic.woff2",
  "assets/fonts/ArefRuqaa-400-arabic.woff2",
  "assets/fonts/Tajawal-400-arabic.woff2",
  "assets/fonts/Tajawal-700-arabic.woff2",
  "assets/logo/favicon.svg",
  "assets/logo/logo-emblem.webp",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll rejects wholesale on one 404 — add files individually instead
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;
  const url = new URL(req.url);

  // navigations: network, falling back to the cached shell
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("index.html")));
    return;
  }

  // data: network-first + revalidate so JSON edits show up immediately
  if (url.pathname.includes("/data/")) {
    e.respondWith(
      fetch(req.url, { cache: "no-cache" })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // everything else (assets, css, js): cache-first
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
