"""生成应用图标：圆角渐变底 + 白色对勾。输出 icon.png / tray.png / icon.ico"""

import os
import sys

from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
os.makedirs(OUT, exist_ok=True)

TOP = (52, 214, 178)
BOTTOM = (12, 150, 122)


def rounded_mask(size, radius_ratio=0.26):
    mask = Image.new("L", (size * 4, size * 4), 0)
    draw = ImageDraw.Draw(mask)
    r = int(size * 4 * radius_ratio)
    draw.rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=r, fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def gradient(size):
    img = Image.new("RGB", (size, size), TOP)
    pixels = img.load()
    for y in range(size):
        for x in range(size):
            t = (x / size * 0.45 + y / size * 0.55)
            pixels[x, y] = (
                int(TOP[0] + (BOTTOM[0] - TOP[0]) * t),
                int(TOP[1] + (BOTTOM[1] - TOP[1]) * t),
                int(TOP[2] + (BOTTOM[2] - TOP[2]) * t),
            )
    return img


def build(size, radius_ratio=0.26, padding_ratio=0.0):
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = int(size * (1 - padding_ratio * 2))
    grad = gradient(inner).convert("RGBA")
    mask = rounded_mask(inner, radius_ratio)

    # 顶部柔光
    sheen = Image.new("RGBA", (inner, inner), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sheen)
    sd.ellipse((-inner * 0.35, -inner * 0.75, inner * 1.3, inner * 0.55), fill=(255, 255, 255, 46))
    sheen.putalpha(Image.composite(sheen.split()[3], Image.new("L", (inner, inner), 0), mask))
    grad = Image.alpha_composite(grad, sheen)

    base.paste(grad, (int(size * padding_ratio), int(size * padding_ratio)), mask)

    draw = ImageDraw.Draw(base)
    s = size
    w = max(2, int(s * 0.105))
    pts = [(s * 0.28, s * 0.53), (s * 0.435, s * 0.685), (s * 0.735, s * 0.345)]
    draw.line(pts, fill=(255, 255, 255, 255), width=w, joint="curve")
    for p in (pts[0], pts[2]):
        r = w / 2
        draw.ellipse((p[0] - r, p[1] - r, p[0] + r, p[1] + r), fill=(255, 255, 255, 255))
    return base


icon = build(256)
icon.save(os.path.join(OUT, "icon.png"))

tray = build(64)
tray = tray.resize((32, 32), Image.LANCZOS)
tray.save(os.path.join(OUT, "tray.png"))
tray.resize((16, 16), Image.LANCZOS).save(os.path.join(OUT, "tray@16.png"))

icon.save(
    os.path.join(OUT, "icon.ico"),
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

print("assets written to", OUT)
for name in sorted(os.listdir(OUT)):
    print(" -", name, os.path.getsize(os.path.join(OUT, name)), "bytes")
