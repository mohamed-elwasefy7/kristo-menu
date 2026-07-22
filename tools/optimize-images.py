# -*- coding: utf-8 -*-
"""
كريستو — image pipeline.

Reads tools/sources.json (dish/drink id -> absolute source path, authored
alongside data/menu.json) and writes optimized web assets named by id.
Idempotent: skips outputs newer than their source. Run again whenever a
source photo or the map changes.

Outputs
  assets/images/dishes/{id}.{avif,webp,jpg}      1280px
  assets/images/dishes/{id}-sm.{avif,webp,jpg}    640px
  assets/images/drinks/{id}.{avif,webp,jpg}       256px (+ -sm 128px)
  assets/hero/hero.{avif,webp,jpg}               1280px (+ hero-sm 768px)
  assets/images/welcome.{avif,webp,jpg}           960px (+ welcome-sm 512px)
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image, features

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


def save_variants(
    im: Image.Image,
    out_dir: Path,
    slug: str,
    sizes,
    jpeg=True,
    avif=True,
    webp_quality=78,
    jpeg_quality=82,
    avif_quality=50,
):
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for label, px in sizes:
        suffix = "" if label == "lg" else f"-{label}"
        w, h = im.size
        scale = min(1.0, px / max(w, h))
        variant = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS) if scale < 1 else im
        webp = out_dir / f"{slug}{suffix}.webp"
        variant.save(webp, "WEBP", quality=webp_quality, method=6)
        written.append(webp)
        if jpeg:
            jpg = out_dir / f"{slug}{suffix}.jpg"
            variant.save(jpg, "JPEG", quality=jpeg_quality, optimize=True, progressive=True)
            written.append(jpg)
        if avif and AVIF:
            av = out_dir / f"{slug}{suffix}.avif"
            variant.save(av, "AVIF", quality=avif_quality)
            written.append(av)
    return written


def fresh(src: Path, out_dir: Path, slug: str) -> bool:
    probe = out_dir / f"{slug}.webp"
    return probe.exists() and probe.stat().st_mtime >= src.stat().st_mtime


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="rebuild every optimized variant")
    args = parser.parse_args()

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
            out_dir, sizes, max_t = DRINKS_OUT, [("lg", 256), ("sm", 128)], 256
        else:
            out_dir, sizes, max_t = DISHES_OUT, [("lg", 1280), ("sm", 640)], 1280
        if not args.force and fresh(src, out_dir, sid):
            skipped += 1
            continue
        files = save_variants(load_rgb(src, max_t), out_dir, sid, sizes)
        total += len(files)
        print(f"  {sid} ({len(files)} files)")

    for slug, src, out_dir, sizes, max_t in (
        ("hero", HERO_SRC, HERO_OUT, [("lg", 1280), ("sm", 768)], 1280),
        ("welcome", WELCOME_SRC, IMAGES_OUT, [("lg", 960), ("sm", 512)], 960),
    ):
        if not src.exists():
            print(f"  !! {slug} source missing: {src}")
            continue
        if not args.force and fresh(src, out_dir, slug):
            skipped += 1
            continue
        files = save_variants(
            load_rgb(src, max_t),
            out_dir,
            slug,
            sizes,
            webp_quality=80,
            jpeg_quality=84,
            avif_quality=54,
        )
        total += len(files)
        print(f"  {slug}: {src.name} ({len(files)} files)")

    print(f"Done. {total} files written, {skipped} sources up to date. AVIF support: {AVIF}")
    if not AVIF:
        print("WARNING: no AVIF support — install pillow-avif-plugin or the image probe chain will 404 on avif")


if __name__ == "__main__":
    main()
