"""Side-by-side composite of two screenshots labeled LEFT / RIGHT.

python3 compose.py left.png right.png out.png desktop|phone
Each side is scaled to a fixed width and cropped to a maximum height, so very long
pages do not shrink to illegibility; the crop is noted on the image.
"""
import sys
from PIL import Image, ImageDraw

left, right, out, view = sys.argv[1:5]
W, MAXH = (900, 2600) if view == "desktop" else (400, 2400)
GAP, HEAD = 24, 36


def load(p):
    im = Image.open(p).convert("RGB")
    h = round(im.height * W / im.width)
    im = im.resize((W, h), Image.LANCZOS)
    cropped = h > MAXH
    return (im.crop((0, 0, W, MAXH)) if cropped else im), cropped


a, ca = load(left)
b, cb = load(right)
H = max(a.height, b.height) + HEAD
canvas = Image.new("RGB", (W * 2 + GAP, H), (128, 128, 128))
d = ImageDraw.Draw(canvas)
for x, im, label, cropped in ((0, a, "LEFT", ca), (W + GAP, b, "RIGHT", cb)):
    d.rectangle([x, 0, x + W, HEAD], fill=(30, 30, 30))
    d.text((x + 10, 10), label + ("  (page continues below; cropped)" if cropped else ""), fill=(255, 255, 255))
    canvas.paste(im, (x, HEAD))
canvas.save(out, optimize=True)
