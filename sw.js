/* كريستو — reliable offline shell and update-safe runtime cache */

const CACHE_PREFIX = "kristo-menu::";
const CACHE_REVISION = "source-2026-07-22-premium";
const CACHE = `${CACHE_PREFIX}${CACHE_REVISION}`;

/* Everything required for the first two screens and both languages.
   Menu photography is cached on demand as visitors browse. */
const SHELL = [
  "./",
  "index.html",
  "manifest.json",
  "js/vendor/gsap-core.min.js",
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
  "assets/fonts/Tajawal-400-arabic.woff2",
  "assets/logo/favicon.svg",
  "assets/logo/logo-emblem-256.webp",
  "assets/logo/icon-192.png",
  "assets/logo/icon-512.png",
  "assets/hero/hero-sm.avif",
  "assets/hero/hero.avif",
  "assets/hero/hero-sm.webp",
  "assets/hero/hero.webp",
  "assets/hero/hero-sm.jpg",
  "assets/hero/hero.jpg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function cacheSuccessful(request, response) {
  if (!response || !response.ok || response.type !== "basic") return response;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    /* Revalidate same-name assets so an online visit can never be pinned to an
       old module, stylesheet, data record, manifest, font, or photograph. */
    const response = await fetch(request, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${response.status} ${request.url}`);
    return await cacheSuccessful(request, response);
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await caches.match("index.html");
      if (shell) return shell;
    }
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) return;
  if (request.headers.has("range")) return;
  event.respondWith(networkFirst(request));
});
