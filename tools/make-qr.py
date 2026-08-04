# -*- coding: utf-8 -*-
"""
كريستو — QR stand / table-card generator.

Builds the branded scan card at any paper size, print-ready:
  <out>/kristo-qr-<size>.pdf          with 3mm bleed  → send to a print shop
  <out>/kristo-qr-<size>.png          same, as an image
  <out>/kristo-qr-<size>-trimmed.pdf  cut to size     → print at home
  <out>/kristo-qr-<size>-trimmed.png
plus the bare code once: kristo-qr-plain.png / .svg

Every generated card is decode-tested before it is written, including at a
downscale that mimics a cheap phone camera — a card that cannot be scanned is
worse than no card.

    python tools/make-qr.py                 # A5 + A6 + A7
    python tools/make-qr.py --sizes a6
    python tools/make-qr.py --url https://…
"""
import argparse
import sys
from pathlib import Path

import segno
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_URL = "https://menustudio.github.io/kristo/?lang=ar"
DEFAULT_OUT = ROOT.parent / "kristo-qr"

DPI = 300
MM = DPI / 25.4
BLEED_MM = 3

# ISO paper, portrait, in millimetres
SIZES = {"a5": (148, 210), "a6": (105, 148), "a7": (74, 105)}

TURQ = (111, 162, 159)
RED = (216, 53, 44)
WHITE = (255, 255, 255)

AR_BOLD = r"C:\Windows\Fonts\tahomabd.ttf"
LAT = r"C:\Windows\Fonts\segoeui.ttf"


def shape_ar(text):
    """Arabic needs joining + bidi before Pillow can draw it."""
    import arabic_reshaper
    from bidi.algorithm import get_display
    return get_display(arabic_reshaper.reshape(text))


def build_card(url: str, w_mm: float, h_mm: float) -> tuple[Image.Image, int]:
    W, H = round(w_mm * MM), round(h_mm * MM)
    B = round(BLEED_MM * MM)
    CW, CH = W + B * 2, H + B * 2
    card = Image.new("RGB", (CW, CH), TURQ)
    d = ImageDraw.Draw(card)
    font = lambda p, s: ImageFont.truetype(p, max(8, round(s)))

    # emblem, feathered so its square edge disappears into the field
    lw = round(W * 0.46)
    logo = Image.open(ROOT / "assets/logo/logo-emblem.webp").convert("RGB").resize((lw, lw), Image.LANCZOS)
    mask = Image.new("L", (lw, lw), 0)
    ImageDraw.Draw(mask).ellipse([lw * .05, lw * .05, lw * .95, lw * .95], fill=255)
    logo_y = B + round(H * 0.030)
    card.paste(logo, (B + (W - lw) // 2, logo_y), mask.filter(ImageFilter.GaussianBlur(lw * 0.05)))

    # the code, on a white plate
    qr = segno.make(url, error="h")
    tmp = DEFAULT_OUT / "_q.png"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    qr.save(tmp, scale=40, border=0, dark="#171512", light="#FFFFFF")
    q = Image.open(tmp).convert("RGB")

    size = round(W * 0.54)
    pad = round(size * 0.085)
    qx = B + (W - size) // 2
    qy = logo_y + lw + round(H * 0.022)
    d.rounded_rectangle([qx - pad, qy - pad, qx + size + pad, qy + size + pad],
                        radius=round(size * 0.10), fill=WHITE)
    card.paste(q.resize((size, size), Image.NEAREST), (qx, qy))

    # centre mark: red disc + upright fork and knife (never reads as an ✗)
    r = round(size * 0.105)
    cx, cy = qx + size // 2, qy + size // 2
    d.ellipse([cx - r * 1.2, cy - r * 1.2, cx + r * 1.2, cy + r * 1.2], fill=WHITE)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=RED)
    sw = max(2, round(r * 0.15))
    thin = max(2, round(sw * 0.7))
    h2, gap = r * 0.5, r * 0.30
    d.line([cx + gap, cy - h2, cx + gap, cy + h2], fill=WHITE, width=sw)
    d.line([cx + gap, cy - h2, cx + gap + r * 0.15, cy - h2 * 0.2], fill=WHITE, width=sw)
    d.line([cx - gap, cy - h2 * 0.1, cx - gap, cy + h2], fill=WHITE, width=sw)
    for dx in (-r * 0.15, 0, r * 0.15):
        d.line([cx - gap + dx, cy - h2, cx - gap + dx, cy - h2 * 0.35], fill=WHITE, width=thin)
    d.line([cx - gap - r * 0.15, cy - h2 * 0.28, cx - gap + r * 0.15, cy - h2 * 0.28], fill=WHITE, width=thin)

    def center(txt, f, y, fill=WHITE):
        x0, y0, x1, y1 = d.textbbox((0, 0), txt, font=f)
        d.text(((CW - (x1 - x0)) // 2 - x0, y), txt, font=f, fill=fill)
        return y + (y1 - y0)

    y = qy + size + pad + round(H * 0.038)
    y = center(shape_ar("امسح الكود لعرض المنيو"), font(AR_BOLD, W * 0.056), y) + round(H * 0.014)
    y = center("SCAN FOR OUR MENU", font(LAT, W * 0.030), y, (235, 247, 246)) + round(H * 0.024)
    d.line([CW * 0.39, y, CW * 0.61, y], fill=(214, 236, 234), width=max(1, round(W * 0.0025)))
    center("KRISTO  ·  LEBANESE CUISINE", font(LAT, W * 0.025), y + round(H * 0.015), (232, 246, 245))
    return card, B


def decode_ok(card: Image.Image, url: str) -> list[str]:
    """Read the card back the way a phone would, including a poor-camera downscale."""
    import cv2
    import numpy as np
    det = cv2.QRCodeDetector()
    failures = []
    w, h = card.size
    for label, im in [("full", card),
                      ("phone-720w", card.resize((720, round(720 * h / w)), Image.LANCZOS)),
                      ("poor-360w", card.resize((360, round(360 * h / w)), Image.LANCZOS))]:
        txt, *_ = det.detectAndDecode(cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR))
        if txt != url:
            failures.append(label)
    return failures


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--sizes", nargs="*", default=list(SIZES), choices=list(SIZES))
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    for key in args.sizes:
        w_mm, h_mm = SIZES[key]
        card, B = build_card(args.url, w_mm, h_mm)
        bad = decode_ok(card, args.url)
        if bad:
            sys.exit(f"{key}: QR failed to decode at {', '.join(bad)} — not written")
        card.save(out / f"kristo-qr-{key}.png", dpi=(DPI, DPI))
        card.save(out / f"kristo-qr-{key}.pdf", "PDF", resolution=DPI)
        trimmed = card.crop((B, B, card.width - B, card.height - B))
        trimmed.save(out / f"kristo-qr-{key}-trimmed.png", dpi=(DPI, DPI))
        trimmed.save(out / f"kristo-qr-{key}-trimmed.pdf", "PDF", resolution=DPI)
        print(f"  {key.upper():3s} {w_mm}×{h_mm}mm  {trimmed.size[0]}×{trimmed.size[1]}px  scan OK")

    segno.make(args.url, error="h").save(out / "kristo-qr-plain.png", scale=30, border=3,
                                         dark="#171512", light="#FFFFFF")
    segno.make(args.url, error="h").save(out / "kristo-qr-plain.svg", scale=12, border=3, dark="#171512")
    (out / "_q.png").unlink(missing_ok=True)
    print(f"\nwritten to {out}")


if __name__ == "__main__":
    main()
