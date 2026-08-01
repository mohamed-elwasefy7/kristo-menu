/* كريستو — swipe.js
   Snap engine. CSS scroll-snap is the source of truth (native touch);
   GSAP Observer intercepts wheel + keyboard on desktop and tweens one
   page per gesture. Lenis is deliberately absent — it breaks snap.   */

import { $, $$, emit, t, prefersReducedMotion, clamp, announce } from "./utils.js";

let container;
let screens = [];
let activeIndex = 0;
let locked = false;
let observer = null;
let rebuilding = false;

export function getActiveIndex() {
  // derive from the real scroll position — IO state can lag instant jumps
  if (container?.clientHeight) {
    return clamp(Math.round(container.scrollTop / container.clientHeight), 0, Math.max(screens.length - 1, 0));
  }
  return activeIndex;
}

export function getScreens() {
  return screens;
}

export function init() {
  container = $("#snap");
  bindScreens();
  initWheelAndKeys();
  initTouchYield();
  initHash();
  initGotoButtons();
}

/* a finger on the glass outranks anything the page is animating */
function initTouchYield() {
  const yield_ = () => cancelPageTween();
  container.addEventListener("touchstart", yield_, { passive: true });
  container.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") yield_();
  }, { passive: true });
}

/* re-bind after a language-switch re-render */
export function rebind(keepIndex = 0) {
  rebuilding = true;
  bindScreens();
  goTo(keepIndex, true);
  requestAnimationFrame(() => { rebuilding = false; });
}

function bindScreens() {
  screens = $$(".screen", container);
  buildRail();
  observeActive();
}

/* ---------- active tracking ---------- */
let io = null;

function observeActive() {
  io?.disconnect();
  io = new IntersectionObserver(
    (entries) => {
      // A fling delivers several crossings in one batch. Acting on each one
      // ran setActive up to five times per frame and left the state on
      // whichever record happened to be last — often a screen already gone
      // past. Only the most-visible screen in the batch counts.
      let best = null;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (!best || entry.intersectionRatio > best.intersectionRatio) best = entry;
      }
      if (!best) return;
      const index = screens.indexOf(best.target);
      if (index === -1 || (index === activeIndex && !rebuilding)) return;
      setActive(index);
    },
    { root: container, threshold: 0.6 },
  );
  screens.forEach((s) => io.observe(s));
}

let settleTimer = null;

function setActive(index) {
  activeIndex = index;
  const section = screens[index];
  // cheap, must feel instant: which chip is lit, which dot, the URL
  updateRail(index);
  updateCatBar(section, index);
  updateHash(section);

  // expensive, must not run mid-fling: the mood crossfade restyles all 97
  // screens and the preloader fetches images. Wait for the scroll to rest,
  // then act on wherever the guest actually landed.
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    const landed = getActiveIndex();
    const target = screens[landed] || section;
    announceScreen(target, landed);
    emit("dish:active", {
      index: landed,
      section: target,
      dishId: target.classList.contains("dish") ? target.id : null,
      mood: target.dataset.mood || "paper",
    });
  }, 140);
}

function announceScreen(section, index) {
  if (section.classList.contains("dish")) {
    const dishes = screens.filter((s) => s.classList.contains("dish"));
    const i = dishes.indexOf(section) + 1;
    announce(`${t("dishOf", { i, n: dishes.length })} — ${section.getAttribute("aria-label")}`);
  } else {
    announce(section.getAttribute("aria-label") || "");
  }
}

/* ---------- programmatic paging ---------- */
let pageTween = null;
let cooldown = null;

/* one cooldown timer, always cancelled before a new one is armed — a stray
   timer from an interrupted tween used to unlock mid-flight and let a second
   navigation start on top of the first */
function settleTween() {
  container.classList.remove("is-tweening");
  clearTimeout(cooldown);
  cooldown = setTimeout(() => { locked = false; }, 180);
}

/* the finger always wins: any touch cancels an in-flight tween instead of
   fighting it for the scroll position */
export function cancelPageTween() {
  if (!pageTween) return;
  pageTween.kill();
  pageTween = null;
  container.classList.remove("is-tweening");
  clearTimeout(cooldown);
  locked = false;
}

const canHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

export function goTo(index, instant = false) {
  index = clamp(index, 0, screens.length - 1);
  // measure the real element: index * clientHeight drifts by a pixel per
  // screen and lands ~50px off at the end of a 97-screen menu
  const top = screens[index]?.offsetTop ?? index * container.clientHeight;

  // hidden documents get no animation frames — jump instantly
  if (instant || prefersReducedMotion() || !window.gsap || document.visibilityState === "hidden") {
    cancelPageTween();
    container.scrollTo({ top, behavior: "auto" });
    return;
  }

  // Touch devices use the browser's own smooth scroll: it yields the moment
  // a finger lands, where a GSAP tween would keep writing scrollTop and tear
  // the gesture apart.
  if (!canHover()) {
    cancelPageTween();
    locked = true;
    container.scrollTo({ top, behavior: "smooth" });
    clearTimeout(cooldown);
    cooldown = setTimeout(() => { locked = false; }, 420);
    return;
  }

  pageTween?.kill();
  locked = true;
  container.classList.add("is-tweening");
  // GSAP can't tween scrollTop on a DOM element directly — use a proxy
  const proxy = { v: container.scrollTop };
  pageTween = gsap.to(proxy, {
    v: top,
    duration: 0.62,
    ease: "power2.inOut",
    onUpdate: () => { container.scrollTop = proxy.v; },
    onComplete: settleTween,
    onInterrupt: settleTween,
  });
}

/* ---------- wheel + keyboard (desktop) ---------- */
function initWheelAndKeys() {
  if (!prefersReducedMotion() && window.Observer) {
    gsap.registerPlugin(Observer);
    observer = Observer.create({
      target: container,
      type: "wheel",
      preventDefault: true,
      tolerance: 8,
      onDown: () => step(1),   // wheel down → next
      onUp: () => step(-1),    // wheel up → previous
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    const sheet = $("#order-sheet");
    if (sheet?.open) return;
    const el = document.activeElement;
    const tag = el?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
    // Space must keep activating focused controls (button click fires on keyup
    // only if keydown wasn't cancelled) — page with Space only from the page itself
    const focusIsInteractive =
      tag === "BUTTON" || tag === "A" || tag === "SELECT" || tag === "SUMMARY";

    switch (e.key) {
      case "ArrowDown":
      case "PageDown":
        e.preventDefault(); step(1); break;
      case " ":
        if (focusIsInteractive) return;
        e.preventDefault(); step(e.shiftKey ? -1 : 1); break;
      case "ArrowUp":
      case "PageUp":
        e.preventDefault(); step(-1); break;
      case "Home":
        e.preventDefault(); goTo(0); break;
      case "End":
        e.preventDefault(); goTo(screens.length - 1); break;
    }
  });
}

function step(dir) {
  if (locked) return;
  // derive index from real scroll position (touch may have moved it)
  const current = Math.round(container.scrollTop / container.clientHeight);
  goTo(current + dir);
}

/* ---------- dot rail — one dot per GROUP, not per screen ----------
   ~100 screens would need ~100 dots; instead consecutive screens sharing a
   data-rail value (hero / welcome / each category / drinks / end) collapse
   into one dot that jumps to the group's first screen. */
let railGroups = [];

function buildRail() {
  const rail = $("#rail");
  rail.setAttribute("aria-label", t("railAria"));
  rail.innerHTML = "";
  railGroups = [];
  let current = null;
  screens.forEach((s, i) => {
    const key = s.dataset.rail || s.id || `screen-${i}`;
    if (!current || current.key !== key) {
      current = {
        key, first: i, last: i,
        label: s.getAttribute("aria-label") || `Screen ${i + 1}`,
      };
      railGroups.push(current);
    } else {
      current.last = i;
    }
  });
  railGroups.forEach((g) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", g.label);
    b.addEventListener("click", () => goTo(g.first));
    rail.append(b);
  });
  updateRail(activeIndex);
}

function updateRail(index) {
  const btns = $$("#rail button");
  railGroups.forEach((g, gi) => {
    if (index >= g.first && index <= g.last) btns[gi]?.setAttribute("aria-current", "true");
    else btns[gi]?.removeAttribute("aria-current");
  });
}

/* ---------- sticky section switcher: highlight + keep the chip in view ---------- */
let chipTimer = null;

function updateCatBar(section, index) {
  const bar = $("#catbar");
  const group = section.dataset.rail || "";
  // the hero already shows the full section grid — both switchers start below it
  const away = index !== 0;
  $("#sections-fab")?.setAttribute("data-visible", String(away));
  $$("#sections-list [data-rail]").forEach((row) => {
    row.setAttribute("aria-current", String(row.dataset.rail === group));
  });
  if (!bar) return;
  bar.dataset.visible = String(away);

  let active = null;
  $$(".catbar__chip", bar).forEach((chip) => {
    const on = chip.dataset.rail === group;
    chip.setAttribute("aria-current", String(on));
    if (on) active = chip;
  });
  if (!active) return;
  // centre the active chip inside the bar (scrollIntoView would move the page).
  // Deferred + instant: a smooth scroll started on every crossing competed
  // with the page's own snap animation, and the layout reads it needs are
  // measured off the critical path.
  clearTimeout(chipTimer);
  chipTimer = setTimeout(() => {
    const target = active.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2;
    bar.scrollTo({ left: target, behavior: "auto" });
  }, 160);
}

/* ---------- hash deep-links ---------- */
let hashTimer;

function updateHash(section) {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const id = section.id || "";
    if (id && id !== "top") history.replaceState(null, "", `#${id}`);
    else history.replaceState(null, "", location.pathname + location.search);
  }, 300);
}

function initHash() {
  const id = location.hash.slice(1);
  if (!id) return;
  const target = screens.findIndex((s) => s.id === id);
  if (target > 0) goTo(target, true);
}

/* buttons with data-goto (hero CTAs, nav logo, chef "view in menu")
   — value is a numeric index OR a section id */
function initGotoButtons() {
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-goto]");
    if (!el) return;
    e.preventDefault();
    if (locked) return;            // a jump is already under way
    const v = el.dataset.goto;
    const n = Number(v);
    const index = Number.isNaN(n) ? screens.findIndex((s) => s.id === v) : n;
    if (index >= 0) goTo(index);
  });
}

/* The nav used to auto-hide on scroll-down. It no longer does: the section
   switcher lives inside it and must stay reachable at every moment, which is
   the whole point of a menu a guest scrolls through while seated. */
export function initNavAutoHide() {
  $("#nav").dataset.hidden = "false";
}
