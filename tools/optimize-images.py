# -*- coding: utf-8 -*-
"""
كريستو — image pipeline.

Reads tools/sources.json (dish/drink id -> absolute source path, authored
alongside data/menu.json) and writes optimized web assets named by id.
Idempotent: skips outputs newer than their source. Run again whenever a
source photo or the map changes.

Outputs
  assets/images/dishes/{id}.{avif,webp,jpg}      1400px
  assets/images/dishes/{id}-sm.{avif,webp,jpg}    750px
  assets/images/drinks/{id}.{avif,webp,jpg}       400px (+ -sm 200px)
  assets/hero/hero.{avif,webp,jpg}               1600px (+ hero-sm 800px)
  assets/images/welcome.{avif,webp,jpg}          1200px (+ welcome-sm 700px)
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageFilter, features

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "tools" / "sources.json"
DISHES_OUT = ROOT / "assets" / "images" / "dishes"
DRINKS_OUT = ROOT / "assets" / "images" / "drinks"
IMAGES_OUT = ROOT / "assets" / "images"
HERO_OUT = ROOT / "assets" / "hero"

# hero + welcome are art-directed picks from the hi-res pool, not menu items
HERO_SRC = Path(r"D:\chris\kristo menu\_extracted\Plates-20260127T143240Z-3-001\Plates\MIX GRILL PLATTER 1.jpg")
WELCOME_SRC = Path(r"D:\chris\kristo menu\_extracted\Cold Mezza and Appetizers-20260127T115731Z-3-001\cold & hot appetizers\homos.jpg")

AVIF = features.check("avif")
PAPER = (244, 239, 230)  # brand paper #F4EFE6


def load_rgb(path: Path, max_target: int) -> Image.Image:
    im = Image.open(path)
    # JPEG draft mode: decode 60MP sources at a fraction of the cost —
    # ask for ~2x the largest output so LANCZOS still has headroom
    if im.format == "JPEG":
        im.draft("RGB", (max_target * 2, max_target * 2))
    if im.mode in ("RGBA", "LA", "P"):
        bg = Image.new("RGB", im.size, PAPER)
        im = im.convert("RGBA")
        bg.paste(im, mask=im.split()[-1])
        return bg
    return im.convert("RGB")


def crop_subject(im: Image.Image, pad: float = 0.06) -> Image.Image:
    """Trim the empty floor/backdrop around a bottle or can.

    The drink shots frame the product small inside a uniform surface, which
    renders as a speck in an 80px card. Sample the border colour, keep every
    pixel that differs from it, then crop that box to a square so the strip
    stays a tidy row of same-sized cards.
    """
    rgb = im.convert("RGB")
    w, h = rgb.size
    small = rgb.resize((min(w, 400), min(h, 400)), Image.BILINEAR)
    sw, sh = small.size
    px = small.load()

    edge = [px[x, 0] for x in range(0, sw, 4)] + [px[x, sh - 1] for x in range(0, sw, 4)] \
        + [px[0, y] for y in range(0, sh, 4)] + [px[sw - 1, y] for y in range(0, sh, 4)]
    bg = tuple(sum(c[i] for c in edge) // len(edge) for i in range(3))

    # Per-pixel distance from the backdrop, then column/row energy profiles.
    # Profiles beat a raw bounding box here: tile grout and the product's own
    # shadow trip a min/max box, but they never build the dense ridge the
    # bottle does.
    cols = [0.0] * sw
    rows = [0.0] * sh
    for y in range(sh):
        for x in range(sw):
            r, g, b = px[x, y]
            dist = abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])
            if dist > 34:
                cols[x] += dist
                rows[y] += dist

    def dense_span(profile):
        peak = max(profile)
        if peak <= 0:
            return None
        cut = peak * 0.18
        i = profile.index(peak)
        lo = i
        while lo > 0 and profile[lo - 1] >= cut:
            lo -= 1
        hi = i
        while hi < len(profile) - 1 and profile[hi + 1] >= cut:
            hi += 1
        return lo, hi + 1

    span_x = dense_span(cols)
    span_y = dense_span(rows)
    if not span_x or not span_y:
        return rgb                      # nothing stands out — leave it alone

    fx, fy = w / sw, h / sh
    x0, x1 = span_x[0] * fx, span_x[1] * fx
    y0, y1 = span_y[0] * fy, span_y[1] * fy
    side = max(x1 - x0, y1 - y0) * (1 + pad * 2)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    box = (round(cx - side / 2), round(cy - side / 2), round(cx + side / 2), round(cy + side / 2))

    canvas = Image.new("RGB", (box[2] - box[0], box[3] - box[1]), bg)
    src_box = (max(0, box[0]), max(0, box[1]), min(w, box[2]), min(h, box[3]))
    canvas.paste(rgb.crop(src_box), (src_box[0] - box[0], src_box[1] - box[1]))
    return canvas


def pad_square(im: Image.Image) -> Image.Image:
    """Grow a landscape photo into a square by extending its own backdrop.

    The dish frames are square, and the food is shot wide. Cropping to square
    would cut the ends off wraps and sandwiches, so the surface the dish sits
    on is continued above and below instead — nothing is lost and the card
    still reads as one photograph.
    """
    rgb = im.convert("RGB")
    w, h = rgb.size
    if w == h:
        return rgb
    side = max(w, h)
    px = rgb.load()
    step = max(1, min(w, h) // 60)
    edge = [px[x, 0] for x in range(0, w, step)] + [px[x, h - 1] for x in range(0, w, step)] \
        + [px[0, y] for y in range(0, h, step)] + [px[w - 1, y] for y in range(0, h, step)]
    bg = tuple(sum(c[i] for c in edge) // len(edge) for i in range(3))

    canvas = Image.new("RGB", (side, side), bg)
    # blur-stretch the top and bottom rows so the fill keeps the floor's tone
    if h < side:
        slice_h = max(4, h // 6)
        blur = max(24, side // 40)
        top = rgb.crop((0, 0, w, slice_h)).resize((side, (side - h) // 2 + 4), Image.BILINEAR)
        bot = rgb.crop((0, h - slice_h, w, h)).resize((side, side - h - (side - h) // 2 + 4), Image.BILINEAR)
        canvas.paste(top.filter(ImageFilter.GaussianBlur(blur)), (0, 0))
        canvas.paste(bot.filter(ImageFilter.GaussianBlur(blur)), (0, h + (side - h) // 2 - 4))
    canvas.paste(rgb, ((side - w) // 2, (side - h) // 2))
    return canvas


def save_variants(im: Image.Image, out_dir: Path, slug: str, sizes, jpeg=True, avif=True):
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for label, px in sizes:
        suffix = "" if label == "lg" else f"-{label}"
        w, h = im.size
        scale = min(1.0, px / max(w, h))
        variant = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS) if scale < 1 else im
        webp = out_dir / f"{slug}{suffix}.webp"
        variant.save(webp, "WEBP", quality=82, method=6)
        written.append(webp)
        if jpeg:
            jpg = out_dir / f"{slug}{suffix}.jpg"
            variant.save(jpg, "JPEG", quality=85, optimize=True, progressive=True)
            written.append(jpg)
        if avif and AVIF:
            av = out_dir / f"{slug}{suffix}.avif"
            variant.save(av, "AVIF", quality=60)
            written.append(av)
    return written


def fresh(src: Path, out_dir: Path, slug: str) -> bool:
    probe = out_dir / f"{slug}.webp"
    return probe.exists() and probe.stat().st_mtime >= src.stat().st_mtime


def main():
    if not SOURCES.exists():
        sys.exit(f"sources map not found: {SOURCES}")
    sources = json.loads(SOURCES.read_text(encoding="utf-8"))

    missing = [(sid, p) for sid, p in sources.items() if not Path(p).exists()]
    if missing:
        for sid, p in missing:
            print(f"  !! MISSING SOURCE: {sid} -> {p}")
        sys.exit(f"{len(missing)} sources missing — fix tools/sources.json first")

    total, skipped = 0, 0
    for sid, p in sorted(sources.items()):
        src = Path(p)
        if sid.startswith("drink-"):
            out_dir, sizes, max_t = DRINKS_OUT, [("lg", 400), ("sm", 200)], 400
        else:
            out_dir, sizes, max_t = DISHES_OUT, [("lg", 1400), ("sm", 750)], 1400
        if fresh(src, out_dir, sid):
            skipped += 1
            continue
        im = load_rgb(src, max_t)
        im = crop_subject(im) if sid.startswith("drink-") else pad_square(im)
        files = save_variants(im, out_dir, sid, sizes)
        total += len(files)
        print(f"  {sid} ({len(files)} files)")

    for slug, src, out_dir, sizes, max_t in (
        ("hero", HERO_SRC, HERO_OUT, [("lg", 1600), ("sm", 800)], 1600),
        ("welcome", WELCOME_SRC, IMAGES_OUT, [("lg", 1200), ("sm", 700)], 1200),
    ):
        if not src.exists():
            print(f"  !! {slug} source missing: {src}")
            continue
        if fresh(src, out_dir, slug):
            skipped += 1
            continue
        files = save_variants(load_rgb(src, max_t), out_dir, slug, sizes)
        total += len(files)
        print(f"  {slug}: {src.name} ({len(files)} files)")

    print(f"Done. {total} files written, {skipped} sources up to date. AVIF support: {AVIF}")
    if not AVIF:
        print("WARNING: no AVIF support — install pillow-avif-plugin or the image probe chain will 404 on avif")


if __name__ == "__main__":
    main()
