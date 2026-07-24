# -*- coding: utf-8 -*-
"""Concatenate the source stylesheets into css/bundle.min.css (one request).
Sources stay authoritative — edit them, rerun this, commit both."""
import re
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
ORDER = ["fonts.css", "style.css", "animations.css", "sections.css", "responsive.css"]

parts = []
for name in ORDER:
    css = (ROOT / "css" / name).read_text(encoding="utf-8")
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)          # strip comments
    css = re.sub(r"\n\s*\n+", "\n", css)                      # collapse blanks
    parts.append(f"/* == {name} == */\n{css.strip()}")

out = ROOT / "css" / "bundle.min.css"
out.write_text("\n".join(parts), encoding="utf-8")
print(f"bundle.min.css: {out.stat().st_size // 1024}KB from {len(ORDER)} files")
