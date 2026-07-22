/* كريستو — utils.js
   pub/sub · i18n state · image probe · storage · helpers */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- tiny pub/sub ---------- */
const listeners = new Map();
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}
export function emit(event, payload) {
  listeners.get(event)?.forEach((fn) => fn(payload));
}

/* ---------- reduced motion ---------- */
export function prefersReducedMotion() {
  return (
    new URLSearchParams(location.search).get("motion") === "reduce" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/* ---------- safe storage ---------- */
export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode — favorites just won't persist */
    }
  },
};

/* ---------- i18n ---------- */
let currentLang = "ar";
let uiStrings = {};

export function initI18n(strings) {
  uiStrings = strings;
  const saved = storage.get("kristo:lang");
  if (saved === "ar" || saved === "en") {
    currentLang = saved;
  } else {
    currentLang = (navigator.language || "ar").startsWith("ar") ? "ar" : "en";
  }
  applyLangAttrs();
}

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  currentLang = lang === "en" ? "en" : "ar";
  storage.set("kristo:lang", currentLang);
  applyLangAttrs();
}

function applyLangAttrs() {
  document.documentElement.lang = currentLang;
  document.documentElement.dir = currentLang === "ar" ? "rtl" : "ltr";
}

/* t("key") for UI strings — t(field) for bilingual data objects */
export function t(keyOrField, vars) {
  let str;
  if (typeof keyOrField === "string") {
    str = uiStrings[currentLang]?.[keyOrField] ?? uiStrings.en?.[keyOrField] ?? keyOrField;
  } else if (keyOrField && typeof keyOrField === "object") {
    str = keyOrField[currentLang] ?? keyOrField.en ?? "";
  } else {
    return "";
  }
  if (vars) {
    for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, v);
  }
  return str;
}

/* apply data-i18n texts to static DOM */
export function applyStaticI18n(root = document) {
  $$("[data-i18n]", root).forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
}

/* ---------- deterministic responsive images ----------
   The image pipeline guarantees AVIF/WebP/JPEG in two sizes for every menu
   item. Build a <picture> directly from that contract: no HEAD probes, no
   request waterfall, and the browser chooses the first format it can decode. */
function imageWidths(dir) {
  if (dir.includes("/drinks/")) return [128, 256];
  if (dir.includes("/hero/")) return [768, 1280];
  if (dir.endsWith("assets/images/") || dir.endsWith("assets/images")) return [512, 960];
  return [640, 1280];
}

function ensurePicture(img) {
  let picture = img.parentElement?.tagName === "PICTURE" ? img.parentElement : null;
  if (!picture) {
    picture = document.createElement("picture");
    picture.className = "responsive-picture";
    img.before(picture);
    picture.append(img);
  }
  const ensureSource = (type) => {
    let source = picture.querySelector(`source[type="${type}"]`);
    if (!source) {
      source = document.createElement("source");
      source.type = type;
      picture.insertBefore(source, img);
    }
    return source;
  };
  return { picture, avif: ensureSource("image/avif"), webp: ensureSource("image/webp") };
}

export function imagePaths(basename, dir = "assets/images/dishes/") {
  const [smallWidth, largeWidth] = imageWidths(dir);
  const path = (suffix, ext) => `${dir}${basename}${suffix}.${ext}`;
  return {
    basename, dir, smallWidth, largeWidth,
    avif: { small: path("-sm", "avif"), large: path("", "avif") },
    webp: { small: path("-sm", "webp"), large: path("", "webp") },
    jpg: { small: path("-sm", "jpg"), large: path("", "jpg") },
  };
}

export async function applyImage(img, basename, dir = "assets/images/dishes/", sizes = "(min-width:1024px) 40vw, 80vw") {
  const paths = imagePaths(basename, dir);
  const { picture, avif, webp } = ensurePicture(img);
  const srcset = (pair) => `${pair.small} ${paths.smallWidth}w, ${pair.large} ${paths.largeWidth}w`;

  avif.srcset = srcset(paths.avif);
  avif.sizes = sizes;
  webp.srcset = srcset(paths.webp);
  webp.sizes = sizes;
  img.src = paths.jpg.large;
  img.srcset = srcset(paths.jpg);
  img.sizes = sizes;

  img.onerror = () => {
    if (img.dataset.fallbackApplied === "true") return;
    img.dataset.fallbackApplied = "true";
    picture.querySelectorAll("source").forEach((source) => source.removeAttribute("srcset"));
    img.removeAttribute("srcset");
    img.src = placeholderDataURI(basename);
  };

  return { url: paths.avif.large, ext: "avif", ...paths };
}

/* branded inline-SVG placeholder when no file exists at all */
export function placeholderDataURI(name = "") {
  const initial = (name[0] || "ك").toUpperCase();
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'>` +
    `<defs><radialGradient id='g' cx='35%' cy='25%'><stop offset='0%' stop-color='#F4EFE6'/><stop offset='100%' stop-color='#B6C9C6'/></radialGradient></defs>` +
    `<rect width='400' height='400' fill='url(%23g)'/>` +
    `<circle cx='200' cy='200' r='130' fill='none' stroke='#4C837F' stroke-width='2' opacity='.55'/>` +
    `<text x='200' y='228' text-anchor='middle' font-family='Aref Ruqaa,Amiri,Georgia,serif' font-size='96' fill='#171512' opacity='.7'>${initial}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg).replace(/%23/g, "%23")}`;
}

/* ---------- delivery app display names ---------- */
const APP_LABELS = {
  keeta: "Keeta",
  hungerstation: "HungerStation",
  ninja: "Ninja",
  thechefz: "The Chefz",
  jahez: "Jahez",
  careem: "Careem",
};
export const appLabel = (app) =>
  APP_LABELS[app] ?? app.charAt(0).toUpperCase() + app.slice(1);

/* ---------- misc ---------- */
export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function announce(text) {
  const el = $("#sr-announcer");
  if (el) el.textContent = text;
}

let toastTimer;
export function toast(text) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2200);
}

/* inline SVG icon set (stroke = currentColor) */
export const ICONS = {
  heart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6.3a5 5 0 1 1 7.5 6.3Z"/></svg>`,
  share: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v13"/><path d="m7 8 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>`,
  bag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h12l1 14H5L6 7Z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/></svg>`,
  flame: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21c4 0 6.5-2.6 6.5-6.2 0-3.2-2.2-5.5-3.9-7.3-.4 1.6-1.2 2.5-2.2 3-.2-2.9-1.6-5.5-4.4-7.5.3 5-4.5 6.6-4.5 11.6C3.5 18.4 8 21 12 21Z"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  leaf: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20C4 10 10 4 20 4c0 10-6 16-16 16Z"/><path d="M4 20c4-6 8-10 12-12"/></svg>`,
  chili: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 7c0 8-4 13-10 13 2-2 3-5 3-8 0-3 3-7 7-7"/><path d="M14 7c0-2 1.5-3.5 3.5-3.5"/><path d="M14 7c2 0 3 1.5 3 3"/></svg>`,
  toque: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 21h10v-6.3A4.5 4.5 0 0 0 19.5 7 4.5 4.5 0 0 0 15 4.6a4.5 4.5 0 0 0-6 0A4.5 4.5 0 0 0 4.5 7 4.5 4.5 0 0 0 7 14.7V21Z"/><path d="M7 17h10"/></svg>`,
  instagram: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".9" fill="currentColor" stroke="none"/></svg>`,
  whatsapp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z"/><path d="M9 8.5c0 4 2.5 6.5 6.5 6.5l1-2-2.2-1.1-1 1c-1.2-.5-1.9-1.2-2.4-2.4l1-1L10.9 7l-1.9 1.5Z"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-5.8 7-11a7 7 0 1 0-14 0c0 5.2 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
};
