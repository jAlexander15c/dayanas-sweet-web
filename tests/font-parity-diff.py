"""Compare the paired full-page captures; does not alter source screenshots."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageChops

root = Path(sys.argv[1])
results = []
for path in sorted(root.glob("*-before.png")):
    after = path.with_name(path.name.replace("-before", "-after"))
    a, b = Image.open(path).convert("RGB"), Image.open(after).convert("RGB")
    result = {"page": path.stem.removesuffix("-before"), "beforeSize": a.size, "afterSize": b.size}
    if a.size == b.size:
        diff = ImageChops.difference(a, b)
        changed = sum(1 for px in diff.get_flattened_data() if px != (0, 0, 0))
        result.update(changedPixels=changed, changedPercent=100*changed/(a.width*a.height), bounds=diff.getbbox())
        diff.save(root / (result["page"] + "-diff.png"))
    results.append(result)
(root / "pixel-differences.json").write_text(json.dumps(results, indent=2))
print(json.dumps(results, indent=2))
if len(results) != 10 or any(r.get("changedPixels") != 0 for r in results):
    raise SystemExit("Font parity failed: expected ten identical pairs")
