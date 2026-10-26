"""Builds the blind spot-check page: 10 pairwise comparisons with images embedded.

python3 -I bench/src/spotcheck.py round2 P121 P015 ... > bench/spotcheck/spot-check.html
The page records each choice in the artifact's db (collection `spotcheck`) when it runs as a
published artifact, and in localStorage otherwise. The answer key is NOT in the page.
"""
import base64, io, json, sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ROUND = sys.argv[1]
pairs = sys.argv[2:]


def jpeg(path, width):
    im = Image.open(path).convert("RGB")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=72, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


tasks = {p.stem.split("-")[0].zfill(2): json.loads(p.read_text()) for p in (ROOT / "tasks").glob("*.json")}
key = {k["pair"]: k for k in json.loads((ROOT / "results" / "judge" / ROUND / "key.json").read_text())}
items = []
for p in pairs:
    t = tasks[key[p]["id"]]
    items.append({
        "pair": p,
        "title": t["title"],
        "brief": t["brief"],
        "desktop": jpeg(ROOT / "out" / "pairs" / ROUND / f"{p}-desktop.png", 1400),
        "phone": jpeg(ROOT / "out" / "pairs" / ROUND / f"{p}-phone.png", 700),
    })

page = (ROOT / "src" / "spotcheck.template.html").read_text()
sys.stdout.write(page.replace("/*ITEMS*/[]", json.dumps(items)))
