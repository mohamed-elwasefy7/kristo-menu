/* كريستو — parallax.js
   Multi-layer ScrollTrigger scrubs inside the snap container.
   Every layer is a transform-only scrub with ease:none; at snap rest
   all layers sit at 0, so nothing is misaligned when idle.

   Windowed binding: with ~100 snap screens, creating every scrub up
   front would mean ~600 live ScrollTriggers. Instead a near-viewport
   IntersectionObserver (±150% rootMargin) creates a section's scrubs
   as it approaches and kills them once it leaves — steady state stays
   around 3 sections × ~6 layers. */

import { $, $$, prefersReducedMotion } from "./utils.js";

let sectionTriggers = new Map(); // section -> [{ st, el }]
let nearIO = null;

export function init() {
  if (prefersReducedMotion() || !window.gsap || !window.ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  spawnParticles(".hero__particles", 12);
  bind();
}

/* per-dish layer table: [selector, amplitude yPercent, scrub lag] */
const DISH_LAYERS = [
  [".dish__bg", 2, 1.2],
  [".dish__texture", 4, 1.0],
  [".dish__floats-far", 8, 0.8],
  [".dish__floats-near", 12, 0.6],
  [".dish__figure", 6, 0.6],
  [".dish__content", 2.5, 0.9],
  [".dish__foot", 1.2, 1.1],
];

const NARRATIVE_LAYERS = [
  [".section-texture", 4, 1.0],
  [".narrative__content", 2.5, 0.9],
  [".cat-intro__floats", 8, 0.8],
  [".welcome__figure", 6, 0.6],
  [".closing__stack", 2, 1.0],
];

export function bind() {
  sectionTriggers.forEach((entries) => entries.forEach(({ st }) => {
    st.animation?.kill();
    st.kill();
  }));
  sectionTriggers = new Map();
  nearIO?.disconnect();
  if (prefersReducedMotion() || !window.ScrollTrigger) return;

  const container = $("#snap");

  const makeScrubs = (section) => {
    const layers = section.classList.contains("dish") ? DISH_LAYERS : NARRATIVE_LAYERS;
    const made = [];
    layers.forEach(([sel, amp, lag]) => {
      const el = section.querySelector(sel);
      if (!el) return;
      const tween = gsap.fromTo(el, { yPercent: amp }, {
        yPercent: -amp,
        ease: "none",
        scrollTrigger: {
          trigger: section,
          scroller: container,
          start: "top bottom",
          end: "bottom top",
          scrub: lag,
          fastScrollEnd: true,
        },
      });
      made.push({ st: tween.scrollTrigger, el });
    });
    return made;
  };

  const killScrubs = (section) => {
    const entries = sectionTriggers.get(section);
    if (!entries) return;
    entries.forEach(({ st, el }) => {
      st.animation?.kill();
      st.kill();
      gsap.set(el, { clearProps: "transform" });
    });
    sectionTriggers.delete(section);
  };

  const sections = $$(".dish, .narrative", container);
  nearIO = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const section = entry.target;
        if (entry.isIntersecting) {
          if (!sectionTriggers.has(section)) sectionTriggers.set(section, makeScrubs(section));
        } else {
          killScrubs(section);
        }
      }
    },
    { root: container, rootMargin: "150% 0px" },
  );
  sections.forEach((s) => nearIO.observe(s));

  // closing screen particles (idempotent)
  spawnParticles(".closing__particles", 9);
}

/* ---------- ambient particles (hero + closing) ---------- */
export function spawnParticles(containerSel, count = 12) {
  const wrap = $(containerSel);
  if (!wrap || wrap.childElementCount) return;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    p.style.insetInlineStart = `${8 + Math.random() * 84}%`;
    p.style.insetBlockStart = `${10 + Math.random() * 78}%`;
    p.style.setProperty("--dur", `${9 + Math.random() * 7}s`);
    p.style.setProperty("--delay", `${-Math.random() * 9}s`);
    p.style.setProperty("--dx", `${(Math.random() * 16 - 8).toFixed(1)}px`);
    p.style.opacity = (0.12 + Math.random() * 0.2).toFixed(2);
    const size = (3 + Math.random() * 3).toFixed(1);
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    wrap.append(p);
  }
}
