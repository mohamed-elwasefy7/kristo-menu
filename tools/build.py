# -*- coding: utf-8 -*-
"""
كريستو — production build.

Generates a clean, minified, deploy-ready `dist/` folder that serves as a
pure static site on GitHub Pages / Vercel / Netlify / Cloudflare Pages with
no per-platform build step. Source stays readable; dist is the artifact.

Run:
    python tools/build.py                    # default GitHub Pages base URL
    python tools/build.py --base-url https://yourdomain.com

What it does:
  - CSS : concatenate css/*.css (fixed order) -> rcssmin -> dist/css/bundle.min.css
  - JS  : rjsmin each js/*.js -> dist/js/*.js  (module graph + modulepreloads kept)
  - HTML: conservative minify (protect script/style/template), absolute og:image
  - copy: assets/ (minus logo-source.png), data/ (verbatim, editable), gsap, manifest
  - sw.js: same shell, CACHE bumped to a content hash (invalidates old caches)
  - generate: 404.html, .nojekyll, _headers, stamped robots.txt + sitemap.xml
"""
import argparse
import hashlib
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
VENDOR = ROOT / "tools" / "vendor"

# prefer the vendored copies so a local rebuild needs no `pip install`; fall
# back to a pip-installed copy (e.g. in CI) if the vendored import fails.
try:
    sys.path.insert(0, str(VENDOR))
    import rcssmin  # noqa: E402
    import rjsmin  # noqa: E402
except Exception:
    if str(VENDOR) in sys.path:
        sys.path.remove(str(VENDOR))
    import rcssmin  # noqa: E402  (pip install rcssmin rjsmin)
    import rjsmin  # noqa: E402

CSS_ORDER = ["fonts.css", "style.css", "animations.css", "sections.css", "responsive.css", "premium.css"]
JS_FILES = ["utils", "menu", "story", "ingredients", "swipe", "animations", "parallax", "loader", "app"]
DEFAULT_BASE_URL = "https://mohamed-elwasefy7.github.io/kristo-menu"


def clean_dist():
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)


def build_css() -> tuple[int, str]:
    parts = []
    for name in CSS_ORDER:
        css = (ROOT / "css" / name).read_text(encoding="utf-8")
        parts.append(css)
    minified = rcssmin.cssmin("\n".join(parts))
    out = DIST / "css" / "bundle.min.css"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(minified, encoding="utf-8")
    return len(minified.encode("utf-8")), minified


def build_js() -> int:
    out_dir = DIST / "js"
    out_dir.mkdir(parents=True, exist_ok=True)
    total = 0
    for name in JS_FILES:
        src = (ROOT / "js" / f"{name}.js").read_text(encoding="utf-8")
        mini = rjsmin.jsmin(src)
        (out_dir / f"{name}.js").write_text(mini, encoding="utf-8")
        total += len(mini.encode("utf-8"))
    # GSAP bundle is already minified — copy verbatim
    vendor_out = out_dir / "vendor"
    vendor_out.mkdir(parents=True, exist_ok=True)
    bundle = (ROOT / "js" / "vendor" / "gsap-bundle.min.js").read_text(encoding="utf-8")
    scroll_label = bundle.index("ScrollTrigger 3.12.5")
    observer_label = bundle.index("Observer 3.12.5")
    scroll_start = bundle.rfind("/*", 0, scroll_label)
    observer_start = bundle.rfind("/*", 0, observer_label)
    if min(scroll_start, observer_start) < 0 or scroll_start >= observer_start:
        raise RuntimeError("Unable to split the pinned GSAP 3.12.5 bundle")
    for filename, content in (
        ("gsap-core.min.js", bundle[:scroll_start]),
        ("scroll-trigger.min.js", bundle[scroll_start:observer_start]),
        ("observer.min.js", bundle[observer_start:]),
    ):
        (vendor_out / filename).write_text(content.strip(), encoding="utf-8")
    return total


# regions whose inner content must survive minification untouched
_PROTECT = re.compile(
    r"(<script\b[^>]*>.*?</script>|<style\b[^>]*>.*?</style>|<template\b[^>]*>.*?</template>|<pre\b[^>]*>.*?</pre>|<textarea\b[^>]*>.*?</textarea>)",
    re.S | re.I,
)


def minify_html(html: str) -> str:
    stash = []

    def hold(m):
        stash.append(m.group(1))
        return f"\x00{len(stash) - 1}\x00"

    html = _PROTECT.sub(hold, html)
    html = re.sub(r"<!--(?!\[if).*?-->", "", html, flags=re.S)  # strip comments (keep IE conditionals)
    html = re.sub(r">\s+<", "><", html)                          # inter-tag whitespace
    html = re.sub(r"\n\s*", "", html)                            # line indentation
    html = re.sub(r"\x00(\d+)\x00", lambda m: stash[int(m.group(1))], html)
    return html.strip()


def build_html(base_url: str, production_css: str) -> int:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    # fonts.css is authored for css/bundle.min.css, where ../assets is correct.
    # Once that CSS is inlined into index.html, URLs resolve from the document
    # instead, so remove only the single parent segment from font asset paths.
    inline_css = production_css.replace("../assets/fonts/", "assets/fonts/")
    html = html.replace(
        '  <link rel="stylesheet" href="css/bundle.min.css">',
        f"  <style>{inline_css}</style>",
    )
    # premium.css is folded into the production CSS bundle.
    html = html.replace('  <link rel="stylesheet" href="css/premium.css">\n', "")
    # absolute canonical (search engines want the deployed URL, not "./")
    html = html.replace('<link rel="canonical" href="./">',
                        f'<link rel="canonical" href="{base_url}/">')
    # absolute social-card image (crawlers need an absolute URL)
    html = html.replace(
        'content="assets/logo/og-image.jpg"',
        f'content="{base_url}/assets/logo/og-image.jpg"',
    )
    # add og:url right after the (now absolute) og:image meta
    html = html.replace(
        f'<meta property="og:image" content="{base_url}/assets/logo/og-image.jpg">',
        f'<meta property="og:image" content="{base_url}/assets/logo/og-image.jpg">\n'
        f'  <meta property="og:url" content="{base_url}/">',
    )
    mini = minify_html(html)
    (DIST / "index.html").write_text(mini, encoding="utf-8")
    return len(mini.encode("utf-8"))


def copy_static():
    # assets minus the 1.6 MB icon master
    shutil.copytree(
        ROOT / "assets", DIST / "assets",
        ignore=shutil.ignore_patterns("logo-source.png"),
    )
    # data verbatim — stays human-editable in the deployed output
    shutil.copytree(ROOT / "data", DIST / "data")
    shutil.copy2(ROOT / "manifest.json", DIST / "manifest.json")
    # Kept so the source service-worker shell remains valid in dist even
    # though production HTML already has these rules folded into the bundle.


def build_sw(cache_hash: str):
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    sw = re.sub(
        r'const CACHE_REVISION = "[^"]*";',
        f'const CACHE_REVISION = "{cache_hash}";',
        sw,
    )
    (DIST / "sw.js").write_text(sw, encoding="utf-8")


def stamp_seo(base_url: str):
    (DIST / "robots.txt").write_text(
        "User-agent: *\nAllow: /\n\n"
        f"Sitemap: {base_url}/sitemap.xml\n",
        encoding="utf-8",
    )
    (DIST / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"  <url>\n    <loc>{base_url}/</loc>\n"
        "    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n"
        "</urlset>\n",
        encoding="utf-8",
    )


NOTFOUND_HTML = """<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>كريستو — الصفحة غير موجودة</title>
<link rel="icon" href="assets/logo/favicon.svg" type="image/svg+xml">
<style>
:root{color-scheme:light}
body{margin:0;min-height:100vh;display:grid;place-items:center;text-align:center;
font-family:"Tajawal","Segoe UI",sans-serif;background:#F4EFE6;color:#171512;padding:2rem}
.box{max-width:26rem}
h1{font-size:clamp(2rem,9vw,3rem);margin:.2em 0;color:#A32722}
p{color:#4C837F;line-height:1.8;margin:.6em 0 1.4em}
a{display:inline-block;min-height:48px;line-height:48px;padding:0 2rem;border-radius:999px;
background:#D8352C;color:#FFF7F2;font-weight:700;text-decoration:none}
</style></head>
<body><div class="box">
<h1>كريستو</h1>
<p>الصفحة اللي تدوّر عليها مش موجودة.<br>ارجع للمنيو وكمّل.</p>
<a href="./">المنيو الرئيسي</a>
</div></body></html>
"""

HEADERS = """# Long-cache the immutable assets (fonts + vendored GSAP never change by name)
/assets/fonts/*
  Cache-Control: public, max-age=31536000, immutable
/js/vendor/*
  Cache-Control: public, max-age=31536000, immutable

# Revalidate app shell + data every load (SW owns the real caching)
/sw.js
  Cache-Control: public, max-age=0, must-revalidate
/data/*
  Cache-Control: public, max-age=0, must-revalidate
/*
  Cache-Control: public, max-age=0, must-revalidate
"""


def generate_extras():
    (DIST / "404.html").write_text(NOTFOUND_HTML, encoding="utf-8")
    (DIST / ".nojekyll").write_text("", encoding="utf-8")
    (DIST / "_headers").write_text(HEADERS, encoding="utf-8")


def content_hash() -> str:
    h = hashlib.sha1()
    # Hash the entire deployable application, not only the entry points. This
    # makes edits to any module, data file, manifest, font, or photograph
    # produce a new Kristo cache revision on the next production build.
    for f in sorted(path for path in DIST.rglob("*") if path.is_file() and path.name != "sw.js"):
        h.update(f.relative_to(DIST).as_posix().encode("utf-8"))
        h.update(f.read_bytes())
    return h.hexdigest()[:10]


def kb(n):
    return f"{n / 1024:.1f} KB"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL,
                    help="production origin for sitemap/robots/og (no trailing slash)")
    args = ap.parse_args()
    base = args.base_url.rstrip("/")

    print(f"→ base URL: {base}")
    clean_dist()
    css_bytes, production_css = build_css()
    js_bytes = build_js()
    html_bytes = build_html(base, production_css)
    copy_static()
    stamp_seo(base)
    generate_extras()
    build_sw(content_hash())

    # report
    src_css = (ROOT / "css" / "bundle.min.css").stat().st_size if (ROOT / "css" / "bundle.min.css").exists() else 0
    src_js = sum((ROOT / "js" / f"{n}.js").stat().st_size for n in JS_FILES)
    src_html = (ROOT / "index.html").stat().st_size
    print("\n  asset        source →  dist")
    print(f"  CSS      {kb(src_css):>10} → {kb(css_bytes)}")
    print(f"  JS (×9)  {kb(src_js):>10} → {kb(js_bytes)}")
    print(f"  HTML     {kb(src_html):>10} → {kb(html_bytes)}")
    total = sum(f.stat().st_size for f in DIST.rglob("*") if f.is_file())
    print(f"\n  dist total: {kb(total)}  →  {DIST}")
    print("  build OK")


if __name__ == "__main__":
    main()
