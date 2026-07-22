/* Local-only responsive audit and screenshot capture. No build or deploy. */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = process.env.KRISTO_AUDIT_ROOT
  ? path.resolve(process.env.KRISTO_AUDIT_ROOT)
  : path.resolve(__dirname, "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "screenshots"));
const PORT = 4177;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const chromeCandidates = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];
const executablePath = chromeCandidates.find(fs.existsSync);
const forbiddenBrandTerms = [
  "فطيرة الديرة",
  "فطيره الديره",
  "fatirat aldeerah",
  "fatirat al deerah",
  "deerah",
  "aldeerah",
];
const auditableExtensions = new Set([
  ".html", ".css", ".js", ".json", ".md", ".txt", ".xml", ".py", ".toml", ".bat", ".yml", ".yaml",
]);

function findBrandContamination() {
  const hits = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(ROOT, file).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (relative === ".git" || relative.startsWith("tools/vendor")) continue;
        visit(file);
        continue;
      }
      if (file === __filename || !auditableExtensions.has(path.extname(entry.name).toLowerCase())) continue;
      const content = fs.readFileSync(file, "utf8").toLocaleLowerCase("en");
      for (const term of forbiddenBrandTerms) {
        if (content.includes(term)) hits.push({ file: relative, term });
      }
    }
  };
  visit(ROOT);
  return hits;
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function startServer() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, ORIGIN).pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function ready(page, url) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator("#loader").waitFor({ state: "hidden", timeout: 6000 });
  await page.waitForTimeout(180);
}

async function makePage(browser, viewport, lang = "ar", options = {}) {
  const context = await browser.newContext({
    viewport,
    locale: lang === "ar" ? "ar-SA" : "en-US",
    reducedMotion: options.reducedMotion || "no-preference",
    serviceWorkers: options.serviceWorkers || "block",
  });
  await context.addInitScript((selected) => {
    localStorage.setItem("kristo:lang", JSON.stringify(selected));
  }, lang);
  const page = await context.newPage();
  return { context, page };
}

async function collectLayout(page) {
  return page.evaluate(() => {
    const visible = (selector) => {
      const el = document.querySelector(selector);
      return el && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden";
    };
    const targets = [...document.querySelectorAll("#rail button, .nav button, .hero__cat")]
      .map((el) => el.getBoundingClientRect())
      .filter((rect) => rect.width && rect.height);
    const hero = document.querySelector(".hero");
    const heroRect = hero.getBoundingClientRect();
    const heroContentRects = [".hero__figure", ".hero__brandmark", ".hero__content", ".hero__hint"]
      .map((selector) => document.querySelector(selector)?.getBoundingClientRect())
      .filter(Boolean);
    const heroContentOverflow = Math.max(
      0,
      ...heroContentRects.map((rect) => rect.bottom - heroRect.bottom),
      ...heroContentRects.map((rect) => heroRect.top - rect.top),
    );
    return {
      screens: document.querySelectorAll(".screen").length,
      dishes: document.querySelectorAll(".dish").length,
      categories: document.querySelectorAll(".cat-intro").length,
      priceNodes: document.querySelectorAll(".dish__price").length,
      railMinWidth: Math.min(...targets.map((rect) => rect.width)),
      railMinHeight: Math.min(...targets.map((rect) => rect.height)),
      heroContentOverflow,
      navVisible: document.querySelector("#nav").dataset.hidden !== "true",
      descriptionVisible: visible(".dish.is-active-screen .dish__desc"),
      ingredientsVisible: visible(".dish.is-active-screen .dish__ingredients"),
      actionsVisible: visible(".dish.is-active-screen .dish__actions"),
      snap: getComputedStyle(document.querySelector("#snap")).scrollSnapType,
    };
  });
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), fullPage: false });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ headless: true, executablePath });
  const failures = [];
  const consoleErrors = [];
  const brandContamination = findBrandContamination();
  const report = { brandContamination: { matches: brandContamination.length } };
  if (brandContamination.length) {
    failures.push(`brand contamination: ${JSON.stringify(brandContamination)}`);
  }

  try {
    const cases = [
      { name: "mobile375", viewport: { width: 375, height: 812 }, lang: "ar" },
      { name: "mobile390", viewport: { width: 390, height: 844 }, lang: "ar" },
      { name: "mobile430", viewport: { width: 430, height: 932 }, lang: "en" },
      { name: "landscape", viewport: { width: 844, height: 390 }, lang: "en", hash: "#manakish-zaatar" },
    ];

    for (const test of cases) {
      const { context, page } = await makePage(browser, test.viewport, test.lang);
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(`${test.name}: ${message.text()}`);
      });
      page.on("pageerror", (error) => consoleErrors.push(`${test.name}: ${error.message}`));
      await ready(page, `${ORIGIN}/?motion=reduce${test.hash || ""}`);
      if (test.hash) await page.locator(test.hash).waitFor({ state: "visible" });
      report[test.name] = await collectLayout(page);
      if (report[test.name].screens !== 97) failures.push(`${test.name}: expected 97 screens`);
      if (report[test.name].dishes !== 84) failures.push(`${test.name}: expected 84 dishes`);
      if (report[test.name].priceNodes !== 0) failures.push(`${test.name}: null prices were rendered`);
      if (test.hash && !report[test.name].navVisible) failures.push(`${test.name}: global navigation hidden after deep link`);
      if (test.hash && (!report[test.name].descriptionVisible || !report[test.name].ingredientsVisible || !report[test.name].actionsVisible)) {
        failures.push(`${test.name}: meaningful product content is hidden`);
      }
      await context.close();
    }

    /* Two-tap category access and touch targets. */
    {
      const { context, page } = await makePage(browser, { width: 390, height: 844 }, "ar");
      await ready(page, `${ORIGIN}/?motion=reduce`);
      await page.locator("#menu-index-toggle").click();
      const linkCount = await page.locator(".menu-index__link").count();
      const linkSizes = await page.locator(".menu-index__link").evaluateAll((els) => els.map((el) => {
        const rect = el.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }));
      if (linkCount !== 9) failures.push(`category index: expected 9 links, found ${linkCount}`);
      if (linkSizes.some((size) => size.width < 44 || size.height < 44)) failures.push("category index: touch target below 44px");
      await page.locator(".menu-index__link").first().click();
      await page.locator("#cat-manakish.is-active-screen").waitFor({ timeout: 3000 });
      report.categoryIndex = { linkCount, twoTapDestination: await page.locator("#cat-manakish").getAttribute("id") };
      await context.close();
    }

    /* Reduced motion disables mandatory snap. */
    {
      const { context, page } = await makePage(browser, { width: 390, height: 844 }, "ar", { reducedMotion: "reduce" });
      await ready(page, `${ORIGIN}/`);
      const snap = await page.locator("#snap").evaluate((el) => getComputedStyle(el).scrollSnapType);
      if (snap !== "none") failures.push(`reduced motion: expected snap none, found ${snap}`);
      report.reducedMotion = { snap };
      await context.close();
    }

    /* Async language rebuild and production delivery links remain intact. */
    {
      const { context, page } = await makePage(browser, { width: 390, height: 844 }, "ar");
      await ready(page, `${ORIGIN}/?motion=reduce`);
      await page.locator("#lang-toggle").click();
      await page.waitForFunction(() => document.documentElement.lang === "en" && document.querySelectorAll(".dish").length === 84);
      const english = await page.evaluate(() => ({
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        screens: document.querySelectorAll(".screen").length,
      }));
      await page.locator("#lang-toggle").click();
      await page.waitForFunction(() => document.documentElement.lang === "ar" && document.querySelectorAll(".dish").length === 84);
      await page.locator(".dish__order").first().click();
      await page.locator("#order-sheet[open]").waitFor();
      const deliveryLinks = await page.locator('a[href*="hungerstation.go.link"], a[href*="url.mykeeta.com"]').evaluateAll((links) => links.map((link) => ({
        href: link.href,
        target: link.target,
        rel: link.rel,
      })));
      if (english.lang !== "en" || english.dir !== "ltr" || english.screens !== 97) failures.push("language switch: English rebuild failed");
      if (deliveryLinks.length !== 6) failures.push(`delivery links: expected 6 rendered links, found ${deliveryLinks.length}`);
      if (deliveryLinks.some((link) => link.target !== "_blank" || !link.rel.includes("noopener") || !link.rel.includes("noreferrer"))) {
        failures.push("delivery links: external-link security attributes missing");
      }
      report.behavior = { english, returnedToArabic: await page.locator("html").getAttribute("lang"), deliveryLinks: deliveryLinks.length };
      await context.close();
    }

    /* 200% zoom approximation: preserve product copy in a constrained viewport. */
    {
      const { context, page } = await makePage(browser, { width: 640, height: 450 }, "en");
      await ready(page, `${ORIGIN}/?motion=reduce#manakish-zaatar`);
      await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
      await page.waitForTimeout(100);
      const states = await page.locator("#manakish-zaatar").evaluate((section) => ({
        desc: getComputedStyle(section.querySelector(".dish__desc")).display,
        ingredients: getComputedStyle(section.querySelector(".dish__ingredients")).display,
        actions: getComputedStyle(section.querySelector(".dish__actions")).display,
      }));
      if (Object.values(states).includes("none")) failures.push("200% zoom: product content hidden");
      report.zoom200 = states;
      await context.close();
    }

    /* Offline shell and cache ownership. */
    {
      const { context, page } = await makePage(browser, { width: 390, height: 844 }, "ar", { serviceWorkers: "allow" });
      await page.goto(`${ORIGIN}/robots.txt`);
      await page.evaluate(() => caches.open("unrelated-origin-cache"));
      await ready(page, `${ORIGIN}/?motion=reduce`);
      const manifest = await page.evaluate(() => fetch("manifest.json").then((response) => response.json()));
      const cdp = await context.newCDPSession(page);
      const appManifest = await cdp.send("Page.getAppManifest");
      const installability = await cdp.send("Page.getInstallabilityErrors");
      await page.evaluate(() => navigator.serviceWorker.ready);
      const cacheState = await page.evaluate(async () => {
        const names = await caches.keys();
        const owned = names.find((name) => name.startsWith("kristo-menu::"));
        const requests = owned ? await (await caches.open(owned)).keys() : [];
        return {
          names,
          owned,
          entries: requests.length,
          menuImages: requests.filter((request) => /\/assets\/images\/(?:dishes|drinks)\//.test(request.url)).length,
        };
      });
      if (!cacheState.names.includes("unrelated-origin-cache")) failures.push("service worker deleted an unrelated cache");
      if (!cacheState.owned) failures.push("service worker did not create the owned shell cache");
      if (cacheState.menuImages !== 0) failures.push("service worker precached menu images");
      if (appManifest.errors?.length) failures.push(`manifest errors: ${JSON.stringify(appManifest.errors)}`);
      const appInstallabilityErrors = (installability.installabilityErrors || [])
        .filter((error) => error.errorId !== "in-incognito");
      if (appInstallabilityErrors.length) failures.push(`installability errors: ${JSON.stringify(appInstallabilityErrors)}`);
      await context.setOffline(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("#loader").waitFor({ state: "hidden", timeout: 6000 });
      const heroLoaded = await page.locator("#hero-img").evaluate((img) => img.complete && img.naturalWidth > 0);
      const offlineScreens = await page.locator(".screen").count();
      const offlineDishes = await page.locator(".dish").count();
      if (!heroLoaded) failures.push("offline: hero image did not load");
      if (offlineScreens !== 97 || offlineDishes !== 84) failures.push("offline: complete menu shell did not render");
      report.offline = {
        heroLoaded,
        offlineScreens,
        offlineDishes,
        unrelatedCachePreserved: cacheState.names.includes("unrelated-origin-cache"),
        shellCache: cacheState.owned,
        shellEntries: cacheState.entries,
        precachedMenuImages: cacheState.menuImages,
        manifest: { name: manifest.name, display: manifest.display, start_url: manifest.start_url, icons: manifest.icons?.length || 0 },
        manifestErrors: appManifest.errors?.length || 0,
        installabilityErrors: appInstallabilityErrors.length,
      };
      await context.setOffline(false);
      await context.close();
    }

    /* Requested screenshots. */
    {
      const { context, page } = await makePage(browser, { width: 1440, height: 900 }, "ar");
      await ready(page, `${ORIGIN}/?motion=reduce`);
      await screenshot(page, "desktop-hero.png");
      await context.close();
    }
    {
      const { context, page } = await makePage(browser, { width: 390, height: 844 }, "ar");
      await ready(page, `${ORIGIN}/?motion=reduce`);
      await screenshot(page, "mobile-hero.png");
      await page.goto(`${ORIGIN}/?motion=reduce#cat-manakish`, { waitUntil: "networkidle" });
      await page.locator("#loader").waitFor({ state: "hidden", timeout: 6000 });
      await page.locator("#cat-manakish.is-active-screen").waitFor({ timeout: 3000 });
      await page.waitForTimeout(320);
      await screenshot(page, "category.png");
      await page.goto(`${ORIGIN}/?motion=reduce#manakish-spinach`, { waitUntil: "networkidle" });
      await page.locator("#loader").waitFor({ state: "hidden", timeout: 6000 });
      await page.locator("#manakish-spinach.is-active-screen").waitFor({ timeout: 3000 });
      await page.locator("#manakish-spinach .dish__img").waitFor({ state: "visible" });
      await page.waitForFunction(() => document.querySelector("#manakish-spinach .dish__img")?.naturalWidth > 0);
      await page.waitForTimeout(320);
      await screenshot(page, "product.png");
      await context.close();
    }
    {
      const { context, page } = await makePage(browser, { width: 844, height: 390 }, "en");
      await ready(page, `${ORIGIN}/?motion=reduce#manakish-zaatar`);
      await page.locator("#manakish-zaatar.is-active-screen").waitFor({ timeout: 3000 });
      await page.waitForFunction(() => document.querySelector("#manakish-zaatar .dish__img")?.naturalWidth > 0);
      await screenshot(page, "short-screen.png");
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  const result = { ok: failures.length === 0 && consoleErrors.length === 0, failures, consoleErrors, report, screenshots: OUT };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
