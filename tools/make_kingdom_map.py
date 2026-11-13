"""Draws a top-down map of the Princess Kingdom world: terrain from above with hill shading, the
roads, the castles numbered in story order, the start, landmarks, cave entrances, north arrow and
scale bar.

Usage: python3 tools/make_kingdom_map.py [--out dist]   ->  dist/kingdom_map.png
"""
import argparse, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(__file__))
import make_princess_world as m

CASTLES = [  # (name, centre, label offset dx, dz) in story order
    ("Princess Castle", m.PRINCESS, 150, -12),
    ("Ice Palace", m.ICE, 0, -75),
    ("Blaze Castle", m.BLAZE, 0, -78),
    ("Knight's Fortress", m.KNIGHT, 0, -80),
    ("Haunted Mountain", m.SPOOKY, 0, -90),
    ("Sky Castle", m.SKY, 0, -85),
]
LANDMARKS = [(0, -104, "Giant rainbow"), (-72, 30, "Crystal grove"), (78, 58, "Fairy pond"), (-60, 86, "Rainbow bridge")]

def font(size):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/Library/Fonts/Arial Bold.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def draw_map(w, path, S=1.25):
    lut = np.zeros((len(m.PALETTE) + 1, 3), np.float32)
    for k, v in m._colors().items():
        if v:
            lut[k] = v
    b = w.b
    ys = (np.arange(m.H) + m.MIN_Y)[None, :, None]
    sky = ((np.abs(np.arange(m.SX) + m.X0 - m.SKY[0]) < 80)[:, None, None] &
           (np.abs(np.arange(m.SZ) + m.Z0 - m.SKY[1]) < 80)[None, None, :] & (ys > m.GROUND + 70))
    b = np.where((b == m.WHITE_WOOL) & (ys > m.GROUND + 20) & ~sky, 0, b)        # hide the drifting clouds
    top = m.H - 1 - np.argmax((b != 0)[:, ::-1, :], axis=1)
    blk = np.take_along_axis(b, top[:, None, :], axis=1)[:, 0, :]
    h = top.astype(float)
    shade = np.clip(1.0 - 0.08 * (np.gradient(h, axis=0) + np.gradient(h, axis=1)), 0.6, 1.35)
    col = np.clip(lut[blk] * shade[:, :, None], 0, 255).astype(np.uint8).transpose(1, 0, 2)
    img = Image.fromarray(col).resize((int(m.SX * S), int(m.SZ * S)), Image.LANCZOS)
    d = ImageDraw.Draw(img)
    F, Fs = font(22), font(16)

    def P(x, z):
        return ((x - m.X0) * S, (z - m.Z0) * S)

    def txt(px, py, t):
        d.text((px - d.textlength(t, font=Fs) / 2, py - 8), t, font=Fs, fill=(255, 255, 255), stroke_width=3,
               stroke_fill=(40, 40, 60))

    for c in list(w.road_curves.values()) + [np.array([(0, z) for z in range(47, 112)], float)]:
        pts = [P(x, z) for x, z in c[::6]]
        d.line(pts, fill=(90, 60, 30), width=7)
        d.line(pts, fill=(235, 205, 140), width=4)
    for num, (name, (x, z), dx, dz) in enumerate(CASTLES, 1):
        cx, cy = P(x, z)
        d.ellipse([cx - 16, cy - 16, cx + 16, cy + 16], fill=(40, 40, 60), outline=(255, 255, 255), width=3)
        d.text((cx - d.textlength(str(num), font=F) / 2, cy - 14), str(num), font=F, fill=(255, 230, 90))
        tx, ty = cx + dx * S, cy + dz * S
        tw = d.textlength(name, font=F)
        d.rounded_rectangle([tx - tw / 2 - 8, ty - 6, tx + tw / 2 + 8, ty + 28], radius=8, fill=(40, 40, 60))
        d.text((tx - tw / 2, ty - 2), name, font=F, fill=(255, 255, 255))
    sx, sy = P(w.spawn[0], w.spawn[2])
    d.regular_polygon((sx, sy, 14), 5, fill=(255, 215, 0), outline=(80, 50, 0))
    d.text((sx + 18, sy - 10), "Start", font=Fs, fill=(255, 255, 255), stroke_width=3, stroke_fill=(40, 40, 60))
    for (x, z, t) in LANDMARKS:
        txt(*P(x, z), t)
    for (mx, mz, *_) in w.cave_entrances:
        px, py = P(mx, mz)
        d.ellipse([px - 5, py - 5, px + 5, py + 5], fill=(30, 30, 30), outline=(255, 255, 255), width=2)
    W, Hh = img.size
    d.polygon([(W - 50, 30), (W - 62, 62), (W - 50, 54), (W - 38, 62)], fill=(255, 255, 255), outline=(40, 40, 60))
    d.text((W - 57, 64), "N", font=F, fill=(255, 255, 255), stroke_width=3, stroke_fill=(40, 40, 60))
    x0, y0 = 30, Hh - 40
    d.rectangle([x0, y0, x0 + 100 * S, y0 + 8], fill=(255, 255, 255), outline=(40, 40, 60))
    d.text((x0, y0 - 24), "100 blocks", font=Fs, fill=(255, 255, 255), stroke_width=3, stroke_fill=(40, 40, 60))
    lx = x0 + 160
    d.ellipse([lx, y0 - 2, lx + 12, y0 + 10], fill=(30, 30, 30), outline=(255, 255, 255), width=2)
    d.text((lx + 18, y0 - 6), "cave entrance", font=Fs, fill=(255, 255, 255), stroke_width=3, stroke_fill=(40, 40, 60))
    img.save(path)
    return path

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20261112)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "dist"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    print(draw_map(m.generate(a.seed), os.path.join(a.out, "kingdom_map.png")))
