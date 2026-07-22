/* كريستو — app.js
   Boot orchestration only. Feature logic lives in the modules. */

import {
  $, on, initI18n, getLang, setLang, t, applyStaticI18n, applyImage, prefersReducedMotion,
} from "./utils.js";
import * as menu from "./menu.js";
import * as story from "./story.js";
import * as swipe from "./swipe.js";
import * as animations from "./animations.js";
import * as parallax from "./parallax.js";
import * as loader from "./loader.js";

async function boot() {
  // 1) kick every fetch off in parallel — nothing gates the hero image
  const stringsPromise = fetch("data/i18n.json", { cache: "no-cache" }).then((r) => r.json());
  const dataPromise = menu.loadData();
  const storyPromise = story.loadStory(); // tolerant — never throws
  const loaderDone = loader.run(dataPromise, storyPromise);

  let strings = { en: {}, ar: {} };
  try {
    strings = await stringsPromise;
  } catch (err) {
    console.warn("[kristo] i18n load failed", err);
  }
  initI18n(strings);
  applyStaticI18n();
  updateLangButton();
  // wire the toggle before the data gate so it works on the error screen too
  $("#lang-toggle").addEventListener("click", onLangToggle);

  try {
    await dataPromise;
  } catch (err) {
    console.error("[kristo] menu load failed", err);
    menu.renderError();
    await loaderDone;
    return;
  }
  await storyPromise;

  await menu.render();
  menu.initSheet();
  menu.initMenuIndex();
  injectMenuSchema();

  // engines (dish DOM exists now)
  animations.init();
  swipe.init();
  swipe.initNavAutoHide();
  animations.bindImages(applyImage);
  // heavy GSAP work (20 timelines + ~80 scrubs) waits for idle — the loader
  // covers this window; unbound sections degrade to fully-visible content
  idle(() => {
    animations.bindDishes();
  });

  // reveal
  await loaderDone;
  animations.heroEntrance();
  scheduleMotionEnhancements();

  // PWA: register after the reveal so it never competes with boot
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch((err) => {
      console.warn("[kristo] sw registration failed", err);
    });
  }
}

/* SEO: Menu/MenuItem JSON-LD generated from the same data the page renders */
function injectMenuSchema() {
  const data = menu.getData();
  if (!data) return;
  const sections = (data.categories || []).map((cat) => ({
    "@type": "MenuSection",
    name: cat.label?.ar || cat.id,
    hasMenuItem: data.dishes
      .filter((d) => d.category === cat.id)
      .map((d) => {
        const item = { "@type": "MenuItem", name: d.name?.ar || d.id, description: d.description?.ar || "" };
        if (d.price != null) {
          item.offers = { "@type": "Offer", price: String(d.price), priceCurrency: "SAR" };
        }
        return item;
      }),
  }));
  const schema = {
    "@context": "https://schema.org",
    "@type": "Menu",
    name: "منيو كريستو",
    inLanguage: "ar",
    hasMenuSection: sections,
  };
  const el = document.createElement("script");
  el.type = "application/ld+json";
  el.textContent = JSON.stringify(schema);
  document.head.append(el);
}

const idle = (fn) =>
  ("requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 120));

let motionEnhancements;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") resolve();
      else {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
      }
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.addEventListener("load", () => { script.dataset.loaded = "true"; resolve(); }, { once: true });
    script.addEventListener("error", reject, { once: true });
    document.head.append(script);
  });
}

function enableMotionEnhancements() {
  if (prefersReducedMotion() || motionEnhancements) return motionEnhancements;
  motionEnhancements = (window.ScrollTrigger && window.Observer
    ? Promise.resolve()
    : Promise.all([
        loadScript("js/vendor/scroll-trigger.min.js"),
        loadScript("js/vendor/observer.min.js"),
      ]))
    .then(() => {
      swipe.enhanceInput();
      parallax.init();
    })
    .catch((err) => console.warn("[kristo] optional motion plugins unavailable", err));
  return motionEnhancements;
}

function scheduleMotionEnhancements() {
  if (prefersReducedMotion()) return;
  const trigger = () => enableMotionEnhancements();
  ["pointerdown", "touchstart", "wheel", "keydown"].forEach((type) => {
    window.addEventListener(type, trigger, { once: true, passive: true, capture: true });
  });
  setTimeout(trigger, 8000);
}

async function onLangToggle() {
  const next = getLang() === "ar" ? "en" : "ar";
  setLang(next);
  applyStaticI18n();
  updateLangButton();
  if (!menu.getData()) {
    menu.renderError();          // menu never loaded — re-render the error card
    return;
  }
  const keepIndex = swipe.getActiveIndex();
  await menu.render();           // rebuild dish/drinks/finale DOM in new language
  swipe.rebind(keepIndex);       // re-observe new sections, restore position
  animations.bindDishes();       // rebuild timelines for new DOM
  animations.bindImages(applyImage);
  parallax.bind();
}

function updateLangButton() {
  const btn = $("#lang-toggle");
  const ar = getLang() === "ar";
  btn.textContent = ar ? "EN" : "ع";
  btn.setAttribute("aria-label", ar ? "Switch to English" : "التبديل إلى العربية");
}

/* GSAP CDN scripts are deferred like this module — wait for full parse */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
