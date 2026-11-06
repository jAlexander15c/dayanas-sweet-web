"""Build real WOFF2 from the approved fonts, retaining metrics, hinting and layout.

Run with official PyPI fonttools==4.68.0 and brotli==1.2.1.
Source binaries are read from the published baseline, never downloaded elsewhere.
"""
import hashlib
import json
import re
import subprocess
from io import BytesIO
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
BASE = "fc35d4ac1d572c89a52e47cc31dd6f07481512ab"

def characters():
    # Latin and combining accents cover Spanish, names and decomposed accents.
    chars = set(range(0x20, 0x180)) | set(range(0x300, 0x370))
    chars.update(map(ord, "áéíóúüñÁÉÍÓÚÜÑ¿¡’“”«»—–…$€·°×"))
    files = [*ROOT.glob("templates/*.json"), *ROOT.glob("sections/*.liquid"),
             ROOT / "locales/es.default.json", ROOT / "config/settings_data.json"]
    for path in files:
        text = path.read_text(encoding="utf-8")
        chars.update(ord(c) for c in text if not c.isspace() or c == " ")
        chars.update(int(v, 16) for v in re.findall(r"\\u([a-fA-F0-9]{4})", text))
    return chars

def build():
    requested = characters()
    css = subprocess.check_output(["git", "show", f"{BASE}:assets/ds-redesign.css"], cwd=ROOT).decode()
    manifest = []
    for source in sorted(set(re.findall(r"ds-r-font-[a-f0-9]+\.woff2", css))):
        raw = subprocess.check_output(["git", "show", f"{BASE}:assets/{source}"], cwd=ROOT)
        font = TTFont(BytesIO(raw), recalcTimestamp=False)
        cmap = font.getBestCmap()
        keep = requested & set(cmap)
        options = subset.Options()
        options.layout_features = ["*"]
        options.name_IDs = ["*"]
        options.name_languages = ["*"]
        options.name_legacy = True
        options.notdef_glyph = True
        options.notdef_outline = True
        options.recommended_glyphs = True
        options.hinting = True
        worker = subset.Subsetter(options=options)
        worker.populate(unicodes=keep)
        worker.subset(font)
        font.flavor = "woff2"
        buffer = BytesIO(); font.save(buffer); data = buffer.getvalue()
        target = "ds-r-font-" + hashlib.sha256(data).hexdigest()[:12] + ".woff2"
        (ROOT / "assets" / target).write_bytes(data)
        old = ROOT / "assets" / source
        if old.exists(): old.unlink()
        css = css.replace(source, target)
        manifest.append({"source": source, "file": target, "beforeBytes": len(raw), "afterBytes": len(data),
                         "weight": font["OS/2"].usWeightClass, "italic": bool(font["head"].macStyle & 2),
                         "retainedCodepoints": len(keep),
                         "unsupportedInOriginal": " ".join(f"U+{c:04X}" for c in sorted(requested - set(cmap)))})
    # All remaining stylesheet bytes are unchanged from the approved baseline.
    (ROOT / "assets/ds-redesign.css").write_text(css.replace("format('truetype')", "format('woff2')"), encoding="utf-8", newline="")
    (ROOT / "tests/font-subsets.json").write_text(json.dumps({"base": BASE, "fonts": manifest}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps([{k:f[k] for k in ["file","beforeBytes","afterBytes"]} for f in manifest], indent=2))

if __name__ == "__main__": build()
