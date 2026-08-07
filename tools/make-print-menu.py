# -*- coding: utf-8 -*-
"""
كريستو — printable paper menu.

Reads the same data the website reads (menu.json, prices.json,
categories.json) and lays it out as a print-ready A4 PDF: every dish with its
photo, Arabic name, English name, description and price, grouped by section.

The daily board is deliberately excluded — it changes every week and would be
stale the day after printing. Everything else comes from the live data files,
so the paper menu can never drift from the QR menu.

Text stays vector (crisp at any zoom, selectable, searchable) because the page
is rendered through Chrome rather than drawn pixel by pixel.

    python tools/make-print-menu.py            # needs the local server running
    python tools/make-print-menu.py --lang en
    python tools/make-print-menu.py --port 4177
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "print"
CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]

SKIP_CATEGORIES = {"daily"}     # the weekly board never goes to print


def load(name):
    return json.loads((ROOT / "data" / name).read_text(encoding="utf-8"))


def price_html(value, lang):
    """One price, or a row of sized options for the share platters."""
    sar = "ر.س" if lang == "ar" else "SAR"
    if isinstance(value, list):
        return "".join(
            f'<span class="size"><b>{o["price"]}</b> {sar}'
            f'<em>{o["label"].get(lang, o["label"]["en"])}</em></span>'
            for o in value if isinstance(o.get("price"), (int, float))
        )
    if isinstance(value, (int, float)) and value > 0:
        return f'<span class="price"><b>{value}</b> {sar}</span>'
    return ""                    # no price on file → print nothing, never a 0


def build_html(lang: str) -> str:
    menu, prices, cats = load("menu.json"), load("prices.json"), load("categories.json")
    brand = load("brand.json")
    rtl = lang == "ar"
    t = lambda o: (o or {}).get(lang) or (o or {}).get("en") or ""

    by_cat = {}
    for d in menu["dishes"]:
        by_cat.setdefault(d["category"], []).append(d)

    sections = []
    for cat in sorted(cats, key=lambda c: c.get("order", 0)):
        if cat["id"] in SKIP_CATEGORIES:
            continue
        dishes = by_cat.get(cat["id"], [])
        if not dishes:
            continue
        rows = []
        for d in dishes:
            img = f'assets/images/dishes/{d["image"]}-sm.jpg'
            has_img = (ROOT / img).exists()
            rows.append(f"""
      <li class="dish">
        <div class="thumb">{'<img src="/' + img + '" alt="">' if has_img else '<span class="thumb__mark"></span>'}</div>
        <div class="copy">
          <p class="name">{t(d["name"])}</p>
          <p class="alt">{d["name"].get("en" if rtl else "ar", "")}</p>
          <p class="desc">{t(d.get("description"))}</p>
        </div>
        <div class="cost">{price_html(prices.get(d["id"]), lang)}</div>
      </li>""")
        sections.append(f"""
    <section class="cat">
      <h2 class="cat__title">{t(cat["label"])}<span>{cat["label"].get("en" if rtl else "ar", "")}</span></h2>
      <ul class="dishes">{''.join(rows)}</ul>
    </section>""")

    drinks = "".join(
        f'<li class="drink"><span>{t(dr["name"])}</span>{price_html(prices.get(dr["id"]), lang)}</li>'
        for dr in menu.get("drinks", [])
    )
    drinks_block = f"""
    <section class="cat cat--drinks">
      <h2 class="cat__title">{'المشروبات' if rtl else 'Drinks'}<span>{'Drinks' if rtl else 'المشروبات'}</span></h2>
      <ul class="drinks">{drinks}</ul>
    </section>""" if drinks else ""

    title = t(brand.get("name")) or "KRISTO"
    tagline = t(brand.get("tagline"))
    where = t(brand.get("location"))

    return f"""<!DOCTYPE html>
<html lang="{lang}" dir="{'rtl' if rtl else 'ltr'}">
<head>
<meta charset="UTF-8">
<title>{title} — {'منيو' if rtl else 'Menu'}</title>
<style>
@font-face {{ font-family:"Aref Ruqaa"; src:url("/assets/fonts/ArefRuqaa-700-arabic.woff2") format("woff2"); font-weight:700; }}
@font-face {{ font-family:"Aref Ruqaa"; src:url("/assets/fonts/ArefRuqaa-700-latin.woff2") format("woff2"); font-weight:700; unicode-range:U+0000-00FF; }}
@font-face {{ font-family:"Tajawal"; src:url("/assets/fonts/Tajawal-400-arabic.woff2") format("woff2"); font-weight:400; }}
@font-face {{ font-family:"Tajawal"; src:url("/assets/fonts/Tajawal-400-latin.woff2") format("woff2"); font-weight:400; unicode-range:U+0000-00FF; }}
@font-face {{ font-family:"Tajawal"; src:url("/assets/fonts/Tajawal-700-arabic.woff2") format("woff2"); font-weight:700; }}
@font-face {{ font-family:"Tajawal"; src:url("/assets/fonts/Tajawal-700-latin.woff2") format("woff2"); font-weight:700; unicode-range:U+0000-00FF; }}
@font-face {{ font-family:"Cormorant"; src:url("/assets/fonts/CormorantGaramond-400i-latin.woff2") format("woff2"); font-style:italic; }}

:root {{ --turq:#6FA29F; --red:#D8352C; --deep:#A32722; --ink:#171512; --soft:#5B5750; --paper:#F4EFE6; --line:#E0D6C6; }}
@page {{ size:A4; margin:13mm 11mm 14mm; }}
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{ font-family:"Tajawal",sans-serif; color:var(--ink); background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }}

/* ---------- cover ---------- */
/* exactly the printable height: any taller and the cover spills a blank page */
.cover {{ height:266mm; display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:7mm; background:var(--turq); color:#fff; break-after:page; text-align:center; }}
.cover + .cat {{ margin-block-start:0; }}
.cover img {{ width:74mm; height:74mm; object-fit:cover;
  -webkit-mask-image:radial-gradient(closest-side,#000 58%,transparent 98%); mask-image:radial-gradient(closest-side,#000 58%,transparent 98%); }}
.cover h1 {{ font-family:"Aref Ruqaa",serif; font-size:19mm; line-height:1.5; font-weight:700; }}
.cover p {{ font-family:"Cormorant",serif; font-style:italic; font-size:5mm; letter-spacing:.1em; opacity:.92; }}
.cover .where {{ font-family:"Tajawal"; font-style:normal; font-size:3.4mm; letter-spacing:.06em; opacity:.85; }}

/* ---------- sections ---------- */
.cat {{ break-inside:auto; margin-block-end:6mm; }}
.cat__title {{ font-family:"Aref Ruqaa",serif; font-size:7.5mm; line-height:1.7; font-weight:700; color:var(--deep);
  border-block-end:.6mm solid var(--red); padding-block-end:1.5mm; margin-block-end:3.5mm;
  display:flex; align-items:baseline; justify-content:space-between; break-after:avoid; }}
.cat__title span {{ font-family:"Cormorant",serif; font-style:italic; font-size:4.2mm; color:var(--soft); letter-spacing:.06em; }}

.dishes {{ list-style:none; columns:2; column-gap:7mm; }}
.dish {{ break-inside:avoid; display:flex; gap:3mm; align-items:flex-start;
  padding-block:2.2mm; border-block-end:.2mm solid var(--line); }}
.thumb {{ flex:0 0 auto; width:19mm; height:19mm; border-radius:2mm; overflow:hidden; background:var(--paper); }}
.thumb img {{ width:100%; height:100%; object-fit:cover; display:block; }}
.thumb__mark {{ display:block; width:100%; height:100%;
  background:radial-gradient(closest-side,var(--paper),#CFDDDA); }}
.copy {{ flex:1 1 auto; min-width:0; }}
.name {{ font-weight:700; font-size:3.6mm; line-height:1.35; }}
.alt {{ font-family:"Cormorant",serif; font-style:italic; font-size:3mm; color:var(--soft); }}
.desc {{ font-size:2.7mm; line-height:1.45; color:var(--soft); margin-block-start:.6mm;
  display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }}
.cost {{ flex:0 0 auto; text-align:end; display:flex; flex-direction:column; gap:.8mm; align-items:flex-end; }}
.price b, .size b {{ font-size:4.4mm; color:var(--red); }}
.price, .size {{ font-size:2.6mm; color:var(--soft); white-space:nowrap; }}
.size {{ display:flex; align-items:baseline; gap:1mm; }}
.size em {{ font-style:normal; font-size:2.4mm; }}

/* ---------- drinks ---------- */
/* keep the drinks list whole: split across a page break it left one page
   nearly empty */
.cat--drinks {{ break-inside:avoid; }}
.drinks {{ list-style:none; columns:3; column-gap:6mm; }}
.drink {{ break-inside:avoid; display:flex; justify-content:space-between; align-items:baseline; gap:2mm;
  padding-block:1.5mm; border-block-end:.2mm solid var(--line); font-size:3.2mm; }}
.drink b {{ font-size:3.6mm; }}

.foot {{ margin-block-start:5mm; padding-block-start:3mm; border-block-start:.3mm solid var(--line);
  text-align:center; font-size:2.8mm; color:var(--soft); letter-spacing:.04em; }}
</style>
</head>
<body>
  <div class="cover">
    <img src="/assets/logo/logo-emblem.webp" alt="">
    <h1>{title}</h1>
    <p>{tagline}</p>
    <p class="where">{where}</p>
  </div>
  {''.join(sections)}
  {drinks_block}
  <p class="foot">{'الأسعار بالريال السعودي · تشمل ضريبة القيمة المضافة' if rtl else 'Prices in SAR · VAT included'}
     &nbsp;·&nbsp; menustudio.github.io/kristo</p>
</body>
</html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", default="ar", choices=["ar", "en"])
    ap.add_argument("--port", type=int, default=4177)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    chrome = next((c for c in CHROME_CANDIDATES if Path(c).exists()), None)
    if not chrome:
        sys.exit("Chrome/Edge not found — needed to render the PDF")

    OUT_DIR.mkdir(exist_ok=True)
    page = OUT_DIR / f"menu-{args.lang}.html"
    page.write_text(build_html(args.lang), encoding="utf-8")

    out_pdf = Path(args.out) if args.out else (ROOT.parent / "kristo-print" / f"kristo-menu-{args.lang}.pdf")
    out_pdf.parent.mkdir(parents=True, exist_ok=True)

    url = f"http://localhost:{args.port}/print/{page.name}"
    subprocess.run([
        chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
        f"--print-to-pdf={out_pdf}", "--virtual-time-budget=30000", url,
    ], check=True, capture_output=True)

    if not out_pdf.exists():
        sys.exit(f"Chrome did not produce {out_pdf} — is the server running on :{args.port}?")
    print(f"  {out_pdf.name}  {out_pdf.stat().st_size // 1024} KB  →  {out_pdf.parent}")


if __name__ == "__main__":
    main()
