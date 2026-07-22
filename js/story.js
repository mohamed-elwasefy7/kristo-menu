/* كريستو — story.js
   Narrative sections: welcome, per-category intros, order, closing.
   All copy from data/story.json + data/categories.json (bilingual via
   t()); failure-tolerant — a missing story.json only drops the
   narrative screens, never the menu. */

import { $, $$, t, getLang, appLabel, ICONS } from "./utils.js";
import { ingredientVisual, ornamentDividerHTML } from "./ingredients.js";

let story = null;

export async function loadStory() {
  try {
    const res = await fetch("data/story.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`story.json ${res.status}`);
    story = await res.json();
  } catch (err) {
    console.warn("[kristo] story.json unavailable — narrative screens skipped", err);
    story = null;
  }
  return story;
}

export function getStory() {
  return story;
}

/* ---------- shared helpers ---------- */
function section(id, mood, ariaKey, extraClass = "") {
  const s = document.createElement("section");
  s.className = `screen narrative ${extraClass}`.trim();
  s.id = id;
  s.dataset.mood = mood;
  s.dataset.animate = "";
  s.setAttribute("aria-label", t(ariaKey));
  return s;
}

const kickerHTML = (field) =>
  `<p class="section-kicker" data-enter="rise" data-enter-at="0">${t(field)}</p>`;

const maskTitleHTML = (field, cls = "section-title") =>
  `<h2 class="${cls}"><span class="reveal"><span class="reveal__inner" data-enter="mask" data-enter-at="0.08">${t(field)}</span></span></h2>`;

const ruleHTML = (at = "0.26") =>
  `<span class="gold-rule" data-enter="rule" data-enter-at="${at}" aria-hidden="true"></span>`;

const textureHTML = (word) =>
  `<div class="section-texture" aria-hidden="true" dir="ltr">${word}</div>`;

/* ---------- 1. Welcome — the editorial doorway ---------- */
export function buildWelcome() {
  if (!story?.welcome) return null;
  const w = story.welcome;
  const s = section("welcome", w.mood || "mist", w.title, "welcome");
  const paras = (w.paragraphs || [])
    .map((p, i) =>
      `<p class="${i === 0 ? "narrative__lead" : "narrative__body"}" data-enter="rise" data-enter-at="${(0.34 + i * 0.14).toFixed(2)}">${t(p)}</p>`)
    .join("");
  s.innerHTML = `
    ${textureHTML(w.texture || "BEIRUT")}
    <figure class="welcome__figure" data-enter="photo" data-enter-at="0.08">
      <div class="dish__breathe">
        <img class="welcome__img" alt="${t(w.title)}" loading="lazy" decoding="async">
      </div>
    </figure>
    <div class="narrative__content welcome__content">
      ${kickerHTML(w.kicker)}
      ${maskTitleHTML(w.title)}
      ${ruleHTML()}
      ${paras}
    </div>`;
  const img = $(".welcome__img", s);
  img.dataset.image = w.image || "welcome";
  img.dataset.dir = "assets/images/";
  img.dataset.sizes = "(min-width:1024px) 34vw, 68vw";
  return s;
}

/* ---------- 2. Category intro — one poster screen per category ---------- */
export function buildCategoryIntro(cat) {
  const intro = cat.intro || {};
  const s = section(`cat-${cat.id}`, cat.mood || "paper", cat.label, "cat-intro");

  // opposite-language editorial accent (Arabic UI shows the English line)
  const accent = getLang() === "ar" ? intro.subtitle?.en : intro.subtitle?.ar;
  const accentDir = getLang() === "ar" ? 'lang="en" dir="ltr"' : 'lang="ar" dir="rtl"';

  s.innerHTML = `
    <div class="cat-intro__floats" aria-hidden="true">
      <span class="float float--far cat-intro__float-a" data-ingredient="${cat.ornament || "cedar"}" data-enter="pop" data-enter-at="0.18"></span>
      <span class="float float--near cat-intro__float-b" data-ingredient="flourish" data-enter="pop" data-enter-at="0.3"></span>
    </div>
    <div class="narrative__content narrative__content--center">
      ${kickerHTML("categoryKicker")}
      ${maskTitleHTML(intro.title || cat.label, "section-title section-title--poster")}
      <div class="cat-intro__divider" data-enter="pop" data-enter-at="0.34" aria-hidden="true">${ornamentDividerHTML(cat.ornament)}</div>
      ${accent ? `<p class="cat-intro__subtitle" ${accentDir} data-enter="rise" data-enter-at="0.46">${accent}</p>` : ""}
    </div>
    <div class="swipe-hint" aria-hidden="true">
      <span class="swipe-hint__label">${t("swipeUp")}</span>
      <span class="swipe-hint__chevron"></span>
    </div>`;
  $$(".cat-intro__floats .float", s).forEach((el) => {
    el.innerHTML = ingredientVisual(el.dataset.ingredient, 56).innerHTML;
  });
  return s;
}

/* ---------- 3. Order experience ---------- */
const usable = (url) => url && !/(?:REPLACE_ME|X{3,})/.test(url);

export function buildOrder(restaurant) {
  const s = section("order", "paper", "screenOrder", "order");
  const channels = [];
  for (const [app, url] of Object.entries(restaurant.orderLinks || {})) {
    if (usable(url)) channels.push({ name: appLabel(app), role: t("roleDelivery"), url });
  }
  const wa = restaurant.whatsapp && !restaurant.whatsapp.includes("X")
    ? `https://wa.me/${restaurant.whatsapp.replace(/[^\d]/g, "")}` : "";
  if (wa) channels.push({ name: "WhatsApp", role: t("roleChat"), url: wa });
  if (usable(restaurant.instagram)) channels.push({ name: "Instagram", role: t("roleFollow"), url: restaurant.instagram });

  const cardsHTML = channels.length
    ? channels.map((c, i) => `
        <a class="order-card" href="${c.url}" target="_blank" rel="noopener noreferrer" data-enter="rise" data-enter-at="${0.4 + i * 0.09}">
          <span class="order-card__name">${c.name}</span>
          <span class="order-card__role">${c.role}</span>
          <span class="order-card__arrow" aria-hidden="true">↗</span>
        </a>`).join("")
    : `<p class="narrative__body narrative__body--center" data-enter="rise" data-enter-at="0.4">${document.documentElement.lang === "ar" ? "روابط الطلب تُضاف قريباً" : "Ordering links coming soon"}</p>`;

  s.innerHTML = `
    ${textureHTML("SAHTEIN")}
    <div class="narrative__content narrative__content--center">
      ${kickerHTML(story.order.kicker)}
      ${maskTitleHTML(story.order.title)}
      <p class="narrative__body narrative__body--center" data-enter="rise" data-enter-at="0.3">${t(story.order.body)}</p>
    </div>
    <div class="order__cards">${cardsHTML}</div>`;
  return s;
}

/* ---------- 4. Luxury closing ---------- */
export function buildClosing(restaurant) {
  const s = section("closing", "ink", "screenClosing", "closing");
  const hours = (restaurant.hours || [])
    .map((h) => `${t(h.days)} · ${h.open}–${h.close}`)
    .join(" — ");
  const social = (url, icon, label) =>
    usable(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${icon}<span>${label}</span></a>` : "";
  const wa = restaurant.whatsapp && !restaurant.whatsapp.includes("X")
    ? `https://wa.me/${restaurant.whatsapp.replace(/[^\d]/g, "")}` : "";
  const orderBtns = Object.entries(restaurant.orderLinks || {})
    .filter(([, url]) => usable(url))
    .map(([app, url]) =>
      `<a class="btn btn--primary" href="${url}" target="_blank" rel="noopener noreferrer">${appLabel(app)}</a>`)
    .join("");
  s.innerHTML = `
    <div class="closing__particles" aria-hidden="true"></div>
    <div class="closing__stack">
      <div class="wordmark wordmark--closing" data-enter="mask-wrap">
        <span class="reveal"><span class="reveal__inner" data-enter="mask" data-enter-at="0">
          <span class="wordmark__name">كريستو</span>
        </span></span>
      </div>
      <p class="closing__thanks" data-enter="rise" data-enter-at="0.2">${t(story.closing.thanks)}</p>
      <p class="finale__cucina" data-enter="rise" data-enter-at="0.32">${t("cucina")}</p>
      <p class="closing__sub" data-enter="rise" data-enter-at="0.42">${t(story.closing.sub)}</p>
      <div class="cat-intro__divider" data-enter="pop" data-enter-at="0.5" aria-hidden="true">${ornamentDividerHTML("cedar")}</div>
      <div class="finale__info" data-enter="fade" data-enter-at="0.58">
        ${social(restaurant.instagram, ICONS.instagram, t("instagram"))}
        ${social(wa, ICONS.whatsapp, t("whatsapp"))}
        ${social(restaurant.mapsUrl, ICONS.pin, t(restaurant.location))}
        ${hours ? `<p class="finale__hours">${t("hoursLabel")}: ${hours}</p>` : ""}
      </div>
      ${orderBtns ? `<div class="closing__order" data-enter="rise" data-enter-at="0.68">${orderBtns}</div>` : ""}
    </div>`;
  return s;
}
