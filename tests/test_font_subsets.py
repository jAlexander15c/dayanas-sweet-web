"""Font correctness beyond the file extension; requires the build tool's venv."""
import json
import subprocess
import unittest
from io import BytesIO
from fontTools.ttLib import TTFont
from subset_fonts import ROOT, characters

class FontSubsets(unittest.TestCase):
    def test_coverage_metrics_styles_and_compression(self):
        manifest = json.loads((ROOT / "tests/font-subsets.json").read_text())
        required = set(map(ord, "áéíóúüñÁÉÍÓÚÜÑ¿¡’“”«»—–…$€·°×0123456789"))
        for entry in manifest["fonts"]:
            with self.subTest(font=entry["file"]):
                raw = subprocess.check_output(["git", "show", f'{manifest["base"]}:assets/{entry["source"]}'], cwd=ROOT)
                original = TTFont(BytesIO(raw))
                data = (ROOT / "assets" / entry["file"]).read_bytes()
                self.assertEqual(data[:4], b"wOF2")
                self.assertLess(len(data), len(raw) * .45)
                font = TTFont(BytesIO(data))
                before, after = original.getBestCmap(), font.getBestCmap()
                self.assertFalse(required - set(after), "Spanish or required punctuation missing")
                self.assertFalse((characters() & set(before)) - set(after), "Existing source text lost coverage")
                for c in after:
                    self.assertEqual(font["hmtx"].metrics[after[c]], original["hmtx"].metrics[before[c]], hex(c))
                for table, fields in {"head":["unitsPerEm","macStyle"], "hhea":["ascent","descent","lineGap"], "OS/2":["usWeightClass","fsSelection","sTypoAscender","sTypoDescender","sTypoLineGap"]}.items():
                    for field in fields:self.assertEqual(getattr(font[table],field),getattr(original[table],field))
                for table in ["GPOS","GSUB","fpgm","prep"]:
                    if table in original:self.assertIn(table,font)

if __name__ == "__main__": unittest.main()
