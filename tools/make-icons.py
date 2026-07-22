# -*- coding: utf-8 -*-
"""
كريستو — icon pipeline.

Turns the brand logo (assets/logo/logo-source.png — drop the clean file
there) into every raster brand asset the site needs. Re-run after
replacing logo-source.png.

Until the real logo file arrives, a synthesized mark (poster-red disc +
white fork & knife on turquoise) fills every slot so nothing 404s.

Outputs (all into assets/logo/)
  logo-emblem.webp        480px   loader / closing screens
  icon-192.png            192px   PWA
  icon-512.png            512px   PWA
  icon-maskable-512.png   512px   PWA maskable (emblem at 72% on turquoise)
  apple-touch-icon.png    180px   iOS home screen
  og-image.jpg            1200x630 social cards
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "assets" / "logo" / "logo-source.png"
OUT = ROOT / "assets" / "logo"

TURQUOISE = (111, 162, 159)  # #6FA29F
RED = (216, 53, 44)          # #D8352C
WHITE = (255, 255, 255)


def synth_emblem(side: int = 1024) -> Image.Image:
    """Placeholder mark: red disc + crossed fork & knife (the logo's crown)."""
    im = Image.new("RGB", (side, side), TURQUOISE)
    d = ImageDraw.Draw(im)
    pad = side * 0.08
    d.ellipse([pad, pad, side - pad, side - pad], fill=RED)
    w = max(6, side // 36)

    def line(x1, y1, x2, y2):
        d.line([side * x1, side * y1, side * x2, side * y2], fill=WHITE, width=w)

    # knife (start-top -> end-bottom) and fork crossing it
    line(.36, .28, .64, .72)
    line(.36, .28, .40, .43)   # blade edge
    line(.64, .28, .36, .72)
    line(.64, .28, .68, .40)   # fork outer tine
    line(.585, .265, .61, .37)  # fork inner tine
    return im


def load_square() -> Image.Image:
    if not LOGO.exists():
        print(f"NOTE: {LOGO.name} not found — writing synthesized placeholder mark")
        return synth_emblem()
    im = Image.open(LOGO).convert("RGB")
    w, h = im.size
    side = min(w, h)
    return im.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))


def save_icon_png(image: Image.Image, path: Path):
    optimized = image.convert("RGB").quantize(
        colors=256,
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.FLOYDSTEINBERG,
    )
    optimized.save(path, "PNG", optimize=True, compress_level=9)


def main():
    em = load_square()

    sq = em.resize((480, 480), Image.LANCZOS)
    sq.save(OUT / "logo-emblem.webp", "WEBP", quality=88, method=6)
    em.resize((256, 256), Image.LANCZOS).save(
        OUT / "logo-emblem-256.webp", "WEBP", quality=82, method=6
    )

    for px in (192, 512):
        save_icon_png(em.resize((px, px), Image.LANCZOS), OUT / f"icon-{px}.png")

    # maskable: safe zone = inner 80% circle -> shrink emblem to 72% on turquoise
    canvas = Image.new("RGB", (512, 512), TURQUOISE)
    inner = em.resize((369, 369), Image.LANCZOS)
    canvas.paste(inner, ((512 - 369) // 2, (512 - 369) // 2))
    save_icon_png(canvas, OUT / "icon-maskable-512.png")

    save_icon_png(em.resize((180, 180), Image.LANCZOS), OUT / "apple-touch-icon.png")

    og = Image.new("RGB", (1200, 630), TURQUOISE)
    badge = em.resize((560, 560), Image.LANCZOS)
    og.paste(badge, ((1200 - 560) // 2, (630 - 560) // 2))
    og.save(OUT / "og-image.jpg", "JPEG", quality=88, optimize=True, progressive=True)

    print("icons written to", OUT)


if __name__ == "__main__":
    main()
