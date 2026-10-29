"""Builds the models and textures for the Sneaky Heist add-on, and optionally preview pictures.

The Ender Guard is a tall, skinny, Enderman-like police officer: black skin, long arms and legs, a navy
uniform shirt with a gold star badge and a black belt, and a navy police cap with a shiny black brim and a
gold badge. Its eyes change with its mood (the entity `mark_variant`, which also picks the animation):
  0 walking on patrol (purple eyes)   1 "?" suspicious (yellow eyes)   2 chasing (red eyes)   3 looking around (purple)
The Golden Crown sits on a red velvet cushion with gold tassels; when someone carries it the cushion hides
(`mark_variant` 1) and the crown floats over their head.

Writes into the resource pack:
  models/entity/ender_guard.geo.json           the guard (about 2.6 blocks tall)
  textures/entity/ender_guard_<0-2>.png        purple / yellow / red eyes
  models/entity/heist_crown.geo.json           crown and cushion
  textures/entity/heist_crown.png
  textures/items/heist_map.png                 the Heist Map icon
  textures/particle/heist_sparkle.png          gold twinkle
  textures/particle/heist_marks.png            "?" and "!" over a guard's head
And, when making a preview, pack_icon.png into both packs and a top-down picture of the Ender Manor
(the layout is read from the behavior pack's main.js with node).

Units are pixels, feet at y = 0, facing north (-Z). Every face is painted from an 8x8 swatch, except the
front of the head (the face) and the front of the shirt. Positive x rotation tips the top of a bone
forward (same as the other add-ons).

Usage: python3 make_heist.py <resource_pack_dir> [preview.png] [map.png]
"""
import json, math, os, subprocess, sys
from PIL import Image, ImageDraw

TEX_W, TEX_H = 64, 64
SW = ["skin", "skin_dark", "shirt", "shirt_dark", "belt", "gold", "cap", "brim", "cap_band", "sole"]
FACE = (0, 32, 8, 8)
SHIRT_FRONT = (8, 32, 8, 11)
REGIONS = {"face": FACE, "shirt_front": SHIRT_FRONT}
EYES = [(204, 82, 255), (255, 214, 64), (255, 52, 52)]
SKIN = (26, 22, 30)


def sw_uv(name):
    if name in REGIONS:
        u, v, w, h = REGIONS[name]
        return [u, v], [w, h]
    i = SW.index(name)
    return [(i % 8) * 8, (i // 8) * 8], [8, 8]


BONE_ORDER = ["body", "head", "cap", "arm_l", "arm_r", "leg_l", "leg_r"]
PARENT = {"head": "body", "cap": "head", "arm_l": "body", "arm_r": "body"}
PIVOTS = {"body": [0, 22, 0], "head": [0, 33, 0], "cap": [0, 41, 0], "arm_l": [-5, 32, 0], "arm_r": [5, 32, 0],
          "leg_l": [-2, 22, 0], "leg_r": [2, 22, 0]}
bones = {b: [] for b in BONE_ORDER}


def box(bone, x, y, z, w, h, d, color, faces=None):
    bones[bone].append({"o": (x, y, z), "s": (w, h, d), "c": color, "faces": faces or {}})


# ---------- Ender Guard ----------
box("leg_l", -3, 0, -1, 2, 22, 2, "skin")
box("leg_r", 1, 0, -1, 2, 22, 2, "skin")
box("leg_l", -3.3, 0, -1.6, 2.6, 1.2, 2.9, "sole")                       # little black shoes
box("leg_r", 0.7, 0, -1.6, 2.6, 1.2, 2.9, "sole")
box("body", -4, 22, -2, 8, 11, 4, "shirt", {"north": "shirt_front"})    # uniform shirt
box("body", -4.2, 22.5, -2.2, 8.4, 1.6, 4.4, "belt")                    # belt
box("body", -0.7, 22.6, -2.35, 1.4, 1.4, 0.2, "gold")                    # buckle
box("arm_l", -6, 11, -1, 2, 22, 2, "skin")
box("arm_r", 4, 11, -1, 2, 22, 2, "skin")
box("arm_l", -6.25, 29, -1.25, 2.5, 4, 2.5, "shirt")                     # short sleeves
box("arm_r", 3.75, 29, -1.25, 2.5, 4, 2.5, "shirt")
box("head", -4, 33, -4, 8, 8, 8, "skin", {"north": "face"})
box("cap", -4.4, 41, -4.4, 8.8, 1.2, 8.8, "cap_band")                    # black band
box("cap", -4.6, 42.2, -4.6, 9.2, 2.4, 9.2, "cap")                       # navy top, a bit wider
box("cap", -4.2, 40.6, -7.2, 8.4, 0.8, 3.0, "brim")                      # shiny brim sticking out front
box("cap", -1.0, 41.4, -4.75, 2.0, 2.2, 0.3, "gold")                     # cap badge

FACES = ("north", "south", "east", "west", "up", "down")


def geo(identifier, order, parents, pivots, tex_w, tex_h, bw, bh, offset):
    out = [{"name": "root", "pivot": [0, 0, 0]}]
    for name in order:
        cubes = []
        for c in bones_of[identifier][name]:
            uv = {}
            for f in FACES:
                pos, size = uv_of[identifier](c["faces"].get(f, c["c"]))
                uv[f] = {"uv": pos, "uv_size": size}
            cubes.append({"origin": [round(v, 3) for v in c["o"]], "size": [round(v, 3) for v in c["s"]], "uv": uv})
        out.append({"name": name, "parent": parents.get(name, "root"), "pivot": pivots[name], "cubes": cubes})
    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {"identifier": identifier, "texture_width": tex_w, "texture_height": tex_h,
                            "visible_bounds_width": bw, "visible_bounds_height": bh, "visible_bounds_offset": offset},
            "bones": out,
        }],
    }


def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


def guard_texture(mood):
    tex = Image.new("RGBA", (TEX_W, TEX_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)

    def fill(sw, col):
        (x, y), _ = sw_uv(sw)
        d.rectangle([x, y, x + 7, y + 7], fill=col + (255,))
        return x, y

    x, y = fill("skin", SKIN)
    for px, py in [(1, 2), (5, 5), (3, 6), (6, 1)]:
        tex.putpixel((x + px, y + py), (40, 32, 48, 255))                 # a faint purple shimmer
    fill("skin_dark", shade(SKIN, 0.7))
    navy = (36, 52, 112)
    x, y = fill("shirt", navy)
    for k in range(8):
        tex.putpixel((x + k, y + 7), shade(navy, 0.8) + (255,))
    fill("shirt_dark", shade(navy, 0.75))
    fill("belt", (20, 20, 24))
    x, y = fill("gold", (246, 196, 56))
    tex.putpixel((x + 2, y + 2), (255, 236, 150, 255)); tex.putpixel((x + 5, y + 4), (255, 236, 150, 255))
    x, y = fill("cap", (30, 44, 98))
    for k in range(8):
        tex.putpixel((x + k, y), (46, 64, 132, 255))
    x, y = fill("brim", (14, 14, 18))
    tex.putpixel((x + 2, y + 2), (70, 70, 84, 255)); tex.putpixel((x + 3, y + 2), (70, 70, 84, 255))   # shine
    fill("cap_band", (16, 16, 20))
    fill("sole", (10, 10, 12))

    # Face (8x8): long glowing Enderman eyes and a little grin.
    fx, fy, fw, fh = FACE
    d.rectangle([fx, fy, fx + fw - 1, fy + fh - 1], fill=SKIN + (255,))
    eye = EYES[mood]
    glow = shade(eye, 0.62)
    for ex in (0, 5):
        for c in range(3):
            tex.putpixel((fx + ex + c, fy + 4), eye + (255,))
        tex.putpixel((fx + ex + (2 if ex == 0 else 0), fy + 3), glow + (255,))
    if mood == 2:                                                       # angry brows when chasing
        for ex, ey in [(0, 2), (1, 2), (2, 3), (5, 3), (6, 2), (7, 2)]:
            tex.putpixel((fx + ex, fy + ey), (70, 20, 24, 255))
    if mood == 1:                                                       # raised eyebrows: huh?
        for ex in (0, 1, 2, 5, 6, 7):
            tex.putpixel((fx + ex, fy + 2), (60, 54, 70, 255))
    for px in (3, 4):
        tex.putpixel((fx + px, fy + 6), (54, 46, 62, 255))

    # Shirt front (8x11): buttons down the middle, pockets, and a gold star badge on the chest.
    sx, sy, sw, sh = SHIRT_FRONT
    d.rectangle([sx, sy, sx + sw - 1, sy + sh - 1], fill=navy + (255,))
    for py in (2, 5, 8):
        tex.putpixel((sx + 4, sy + py), (200, 200, 210, 255))
    d.line([sx + 4, sy, sx + 4, sy + sh - 1], fill=shade(navy, 0.8) + (255,))
    for py in (2, 5, 8):
        tex.putpixel((sx + 4, sy + py), (200, 200, 210, 255))
    gold = (246, 196, 56, 255)
    for px, py in [(1, 2), (0, 3), (1, 3), (2, 3), (1, 4), (0, 5), (2, 5)]:
        tex.putpixel((sx + px, sy + py), gold)                          # star badge
    for px in range(5, 8):
        tex.putpixel((sx + px, sy + 3), shade(navy, 0.7) + (255,))      # pocket flap
    d.line([sx, sy, sx + sw - 1, sy], fill=shade(navy, 0.7) + (255,))   # collar
    return tex


# ---------- Golden Crown ----------
crown_bones = {"cushion": [], "crown": []}
CROWN_SW = ["velvet", "velvet_dark", "gold", "gold_dark", "ruby", "sapphire", "emerald", "tassel"]


def crown_uv(name):
    i = CROWN_SW.index(name)
    return [(i % 4) * 8, (i // 4) * 8], [8, 8]


def cbox(bone, x, y, z, w, h, d, color):
    crown_bones[bone].append({"o": (x, y, z), "s": (w, h, d), "c": color, "faces": {}})


cbox("cushion", -5, 0, -5, 10, 3, 10, "velvet")
cbox("cushion", -4, 3, -4, 8, 0.6, 8, "velvet_dark")
for sx in (-1, 1):
    for sz in (-1, 1):
        cbox("cushion", sx * 5 - 0.5, 0.2, sz * 5 - 0.5, 1, 1.6, 1, "tassel")
# The crown: a gold band with four points, a jewel on each side, and a pearl on each point.
Y0 = 3.3
cbox("crown", -3.5, Y0, -3.5, 7, 2.5, 0.8, "gold"); cbox("crown", -3.5, Y0, 2.7, 7, 2.5, 0.8, "gold")
cbox("crown", -3.5, Y0, -2.7, 0.8, 2.5, 5.4, "gold"); cbox("crown", 2.7, Y0, -2.7, 0.8, 2.5, 5.4, "gold")
cbox("crown", -3.3, Y0 - 0.2, -3.3, 6.6, 0.4, 6.6, "gold_dark")
for px, pz in [(-0.6, -3.6), (-0.6, 2.8), (-3.6, -0.6), (2.8, -0.6)]:
    cbox("crown", px, Y0 + 2.5, pz, 1.2 if abs(px) < 1 else 0.8, 2.2, 0.8 if abs(px) < 1 else 1.2, "gold")
for px, pz in [(-3.5, -3.5), (2.7, -3.5), (-3.5, 2.7), (2.7, 2.7)]:
    cbox("crown", px, Y0 + 2.5, pz, 0.8, 1.4, 0.8, "gold_dark")
for (px, pz, w, d), jewel in zip([(-0.75, -3.75, 1.5, 0.3), (-0.75, 3.45, 1.5, 0.3), (-3.75, -0.75, 0.3, 1.5), (3.45, -0.75, 0.3, 1.5)],
                                 ["ruby", "sapphire", "emerald", "ruby"]):
    cbox("crown", px, Y0 + 0.6, pz, w, 1.3, d, jewel)
for px, pz in [(-0.5, -3.5), (-0.5, 2.9), (-3.5, -0.5), (2.9, -0.5)]:
    cbox("crown", px, Y0 + 4.7, pz, 1.0, 1.0, 0.6 if abs(px) < 1 else 1.0, "tassel")

bones_of = {"geometry.ender_guard": bones, "geometry.heist_crown": crown_bones}
uv_of = {"geometry.ender_guard": sw_uv, "geometry.heist_crown": crown_uv}


def crown_texture():
    tex = Image.new("RGBA", (32, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)
    cols = {"velvet": (176, 30, 52), "velvet_dark": (140, 20, 40), "gold": (252, 200, 48), "gold_dark": (214, 156, 28),
            "ruby": (230, 30, 60), "sapphire": (40, 90, 230), "emerald": (40, 200, 90), "tassel": (255, 236, 160)}
    for name, col in cols.items():
        (x, y), _ = crown_uv(name)
        d.rectangle([x, y, x + 7, y + 7], fill=col + (255,))
        if name.startswith("gold"):
            for k in range(0, 8, 3):
                tex.putpixel((x + k, y + 1), (255, 246, 190, 255))
        if name in ("ruby", "sapphire", "emerald"):
            d.rectangle([x + 1, y + 1, x + 2, y + 2], fill=(255, 255, 255, 220))
    return tex


# ---------- Small pictures ----------
def map_icon():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    paper, edge = (236, 218, 170, 255), (170, 130, 80, 255)
    d.rectangle([1, 2, 14, 14], fill=paper)
    d.rectangle([1, 2, 14, 14], outline=edge)
    for x in (1, 14):                                                    # rolled edges
        d.line([x, 2, x, 14], fill=(200, 170, 120, 255))
    d.rectangle([3, 4, 12, 12], outline=(120, 150, 90, 255))             # the wall
    for x, y in [(4, 11), (5, 10), (6, 10), (7, 9), (8, 8)]:
        img.putpixel((x, y), (150, 60, 50, 255))                         # dotted path to the vault
    for x, y in [(9, 6), (10, 7), (11, 6), (9, 7), (11, 7)]:
        img.putpixel((x, y), (250, 196, 40, 255))                        # little crown
    img.putpixel((10, 5), (250, 196, 40, 255))
    img.putpixel((9, 5), (250, 196, 40, 255)); img.putpixel((11, 5), (250, 196, 40, 255))
    for x, y in [(7, 13), (8, 13)]:
        img.putpixel((x, y), (120, 150, 90, 255))
    return img


def sparkle_texture():
    tex = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    for x, y, a in [(3, 3, 255), (4, 3, 255), (3, 4, 255), (4, 4, 255), (3, 1, 200), (3, 2, 230), (3, 5, 230), (3, 6, 200),
                    (1, 3, 200), (2, 3, 230), (5, 3, 230), (6, 3, 200), (4, 2, 160), (4, 5, 160), (2, 4, 160), (5, 4, 160)]:
        tex.putpixel((x, y), (255, 255, 255, a))
    return tex


GLYPHS = {
    "?": ["..####..", ".##..##.", ".....##.", "....##..", "...##...", "...##...", "........", "...##..."],
    "!": ["...##...", "...##...", "...##...", "...##...", "...##...", "........", "...##...", "...##..."],
}


def marks_texture():
    # 16x8: "?" (yellow) on the left, "!" (red) on the right, each with a dark outline.
    tex = Image.new("RGBA", (16, 8), (0, 0, 0, 0))
    for i, (ch, col) in enumerate([("?", (255, 220, 60)), ("!", (255, 60, 50))]):
        rows = GLYPHS[ch]
        on = {(x, y) for y, r in enumerate(rows) for x, c in enumerate(r) if c == "#"}
        for y in range(8):
            for x in range(8):
                if (x, y) in on:
                    tex.putpixel((i * 8 + x, y), col + (255,))
                elif any((x + dx, y + dy) in on for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                    tex.putpixel((i * 8 + x, y), (40, 20, 20, 255))
    return tex


# ---------- Writing the pack ----------
def write_pack(rp):
    def save_json(rel, obj):
        p = os.path.join(rp, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            json.dump(obj, f, indent=1)

    def save_png(rel, img):
        p = os.path.join(rp, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        img.save(p)

    save_json("models/entity/ender_guard.geo.json",
              geo("geometry.ender_guard", BONE_ORDER, PARENT, PIVOTS, TEX_W, TEX_H, 2, 3.5, [0, 1.5, 0]))
    for mood in range(3):
        save_png(f"textures/entity/ender_guard_{mood}.png", guard_texture(mood))
    save_json("models/entity/heist_crown.geo.json",
              geo("geometry.heist_crown", ["cushion", "crown"], {}, {"cushion": [0, 0, 0], "crown": [0, 0, 0]}, 32, 16, 1.5, 1.5, [0, 0.5, 0]))
    save_png("textures/entity/heist_crown.png", crown_texture())
    save_png("textures/items/heist_map.png", map_icon())
    save_png("textures/particle/heist_sparkle.png", sparkle_texture())
    save_png("textures/particle/heist_marks.png", marks_texture())
    print(f"guard: {sum(len(v) for v in bones.values())} cubes; crown: {sum(len(v) for v in crown_bones.values())} cubes")


# ---------- Previews ----------
SHADE = {"up": 1.0, "north": 0.84, "south": 0.72, "west": 0.66, "east": 0.9, "down": 0.55}


def corners(x, y, z, w, h, dd):
    X, Y, Z = (x, x + w), (y, y + h), (z, z + dd)
    return {
        "down": [(X[0], Y[0], Z[0]), (X[1], Y[0], Z[0]), (X[1], Y[0], Z[1]), (X[0], Y[0], Z[1])],
        "up": [(X[0], Y[1], Z[0]), (X[1], Y[1], Z[0]), (X[1], Y[1], Z[1]), (X[0], Y[1], Z[1])],
        "north": [(X[0], Y[0], Z[0]), (X[1], Y[0], Z[0]), (X[1], Y[1], Z[0]), (X[0], Y[1], Z[0])],
        "south": [(X[0], Y[0], Z[1]), (X[1], Y[0], Z[1]), (X[1], Y[1], Z[1]), (X[0], Y[1], Z[1])],
        "west": [(X[0], Y[0], Z[0]), (X[0], Y[0], Z[1]), (X[0], Y[1], Z[1]), (X[0], Y[1], Z[0])],
        "east": [(X[1], Y[0], Z[0]), (X[1], Y[0], Z[1]), (X[1], Y[1], Z[1]), (X[1], Y[1], Z[0])],
    }


def posed(bone, pt, pose):
    x, y, z = pt
    b = bone
    while b and b != "root":
        ang = pose.get(b, 0)
        if ang:
            py, pz = PIVOTS[b][1], PIVOTS[b][2]
            t = math.radians(ang)
            ry, rz = y - py, z - pz
            y, z = py + ry * math.cos(t) + rz * math.sin(t), pz - ry * math.sin(t) + rz * math.cos(t)
        b = PARENT.get(b, "root")
    return x, y, z


def detailed_face(tex, region, c, pose, bone, ox, oz, polys, cols):
    (x, y, z), (w, h, dd) = c["o"], c["s"]
    u, v, tw, th = region
    for px in range(tw):
        for py in range(th):
            y0, y1 = y + h - (py + 1) * h / th, y + h - py * h / th
            a0, a1 = x + w - (px + 1) * w / tw, x + w - px * w / tw
            q = [(a0, y0, z - 0.02), (a1, y0, z - 0.02), (a1, y1, z - 0.02), (a0, y1, z - 0.02)]
            pts = [posed(bone, p, pose) for p in q]
            polys.append([(ox + p[0], oz + p[2], p[1]) for p in pts])
            cols.append(tuple(min(1, ch / 255 * SHADE["north"] * 1.1) for ch in tex.getpixel((u + px, v + py))[:3]) + (1,))


def guard_polys(mood, ox, oz, pose):
    tex = guard_texture(mood)
    polys, cols = [], []
    for bone in BONE_ORDER:
        for c in bones[bone]:
            for fname, quad in corners(*c["o"], *c["s"]).items():
                sw = c["faces"].get(fname, c["c"])
                if sw in REGIONS and fname == "north":
                    detailed_face(tex, REGIONS[sw], c, pose, bone, ox, oz, polys, cols)
                    continue
                (su, sv), _ = sw_uv(sw if sw not in REGIONS else "skin")
                ch = tex.getpixel((su + 3, sv + 3))
                pts = [posed(bone, p, pose) for p in quad]
                polys.append([(ox + p[0], oz + p[2], p[1]) for p in pts])
                cols.append(tuple(min(1, q / 255 * SHADE[fname]) for q in ch[:3]) + (1,))
    return polys, cols


def crown_polys(ox, oz, s=1.6):
    tex = crown_texture()
    polys, cols = [], []
    for bone in ("cushion", "crown"):
        for c in crown_bones[bone]:
            for fname, quad in corners(*c["o"], *c["s"]).items():
                (su, sv), _ = crown_uv(c["c"])
                ch = tex.getpixel((su + 4, sv + 5))
                polys.append([(ox + p[0] * s, oz + p[2] * s, p[1] * s) for p in quad])
                cols.append(tuple(min(1, q / 255 * SHADE[fname]) for q in ch[:3]) + (1,))
    return polys, cols


POSES = [{"leg_l": 20, "leg_r": -20, "arm_l": -16, "arm_r": 16},              # walking
         {"head": 12, "body": 6},                                              # huh?
         {"body": 14, "leg_l": 38, "leg_r": -34, "arm_l": -80, "arm_r": -64}]  # chasing


def render_preview(path, icon_path=None):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    bg = (0.86, 0.84, 0.92)
    fig = plt.figure(figsize=(14, 7), dpi=110)
    fig.patch.set_facecolor(bg)
    ax = fig.add_subplot(1, 1, 1, projection="3d")
    ax.set_facecolor(bg)
    polys, cols = [], []
    labels = []
    for i in range(3):
        x = i * 26
        pp, cc = guard_polys(i, x, 0, POSES[i])
        polys += pp; cols += cc
        labels.append((["on patrol", "huh?", "chasing!"][i], x, 50))
    # A quartz pedestal (one block = 16 pixels) with the crown on it.
    px = 3 * 26
    for fname, quad in corners(px - 8, 0, -8, 16, 16, 16).items():
        polys.append([(p[0], p[2], p[1]) for p in quad]); cols.append(tuple(0.93 * SHADE[fname] for _ in range(3)) + (1,))
    pp, cc = crown_polys(px, 0)
    polys += [[(p[0], p[1], p[2] + 16) for p in q] for q in pp]; cols += cc
    labels.append(("the Golden Crown", px, 34))
    ax.add_collection3d(Poly3DCollection(polys, facecolors=cols, edgecolors=(0, 0, 0, 0.15), linewidths=0.1))
    right = px + 16
    for gx in range(-16, right + 1, 16):
        ax.plot([gx, gx], [-16, 16], [0, 0], color=(0.55, 0.5, 0.65), lw=0.4)
    for gy in (-16, 0, 16):
        ax.plot([-16, right], [gy, gy], [0, 0], color=(0.55, 0.5, 0.65), lw=0.4)
    for name, lx, lz in labels:
        ax.text(lx, 0, lz, name, ha="center", fontsize=11, color=(0.2, 0.15, 0.3))
    ax.set_xlim(-16, right); ax.set_ylim(-16, 16); ax.set_zlim(0, 50)
    ax.set_box_aspect((right + 16, 32, 50), zoom=1.25)
    ax.view_init(elev=12, azim=-62)
    ax.axis("off")
    plt.subplots_adjust(left=0, right=1, top=1, bottom=0)
    plt.savefig(path, facecolor=bg, bbox_inches="tight", pad_inches=0.1)
    plt.close(fig)

    if icon_path:  # pack icon: a guard leaning in with red eyes, next to the crown
        fig = plt.figure(figsize=(2.56, 2.56), dpi=100)
        fig.patch.set_facecolor((0.55, 0.42, 0.78))
        ax = fig.add_subplot(1, 1, 1, projection="3d")
        ax.set_facecolor((0.55, 0.42, 0.78))
        pp, cc = guard_polys(2, 0, 0, {"arm_r": -50, "arm_l": -20, "head": 6})
        cp, ccol = crown_polys(16, -10, 1.3)
        ax.add_collection3d(Poly3DCollection(pp + cp, facecolors=cc + ccol, edgecolors=(0, 0, 0, 0.2), linewidths=0.15))
        ax.set_xlim(-14, 26); ax.set_ylim(-20, 20); ax.set_zlim(0, 46)
        ax.set_box_aspect((40, 40, 46))
        ax.view_init(elev=10, azim=-58)
        ax.axis("off")
        plt.subplots_adjust(left=-0.2, right=1.2, top=1.1, bottom=-0.1)
        plt.savefig(icon_path, facecolor=fig.get_facecolor())
        plt.close(fig)


MAP_COLORS = {
    " ": (0, 0, 0, 0), ".": (104, 168, 72), ",": (178, 150, 100), "y": (168, 168, 168), "H": (250, 204, 60),
    "#": (110, 110, 116), "a": (178, 150, 100), "W": (222, 220, 164), "G": (150, 200, 230), "d": (196, 150, 96),
    "_": (196, 150, 96), "~": (196, 48, 48), "=": (60, 56, 66), "P": (250, 204, 60), "p": (170, 120, 170),
    "h": (40, 110, 40), "b": (90, 150, 80), "g": (136, 196, 90), "f": (230, 120, 180), "T": (90, 64, 40),
    "r": (90, 140, 130), "w": (60, 110, 220), "q": (200, 240, 240), "B": (130, 90, 50), "c": (150, 104, 60),
    "C": (120, 84, 50), "k": (240, 240, 240), "x": (220, 190, 70), "J": (90, 90, 90), "j": (140, 140, 140),
    "S": (130, 130, 136), "l": (255, 220, 120),
}


def render_map(path, main_js):
    """Top-down picture of the Ender Manor: the gate and the gold square at the bottom, the vault up top."""
    script = ("const fs=require('fs');const src=fs.readFileSync(process.argv[1],'utf8').replace(/^import .*$/gm,'');"
              "const ev={subscribe(){}};globalThis.__heistTest={};"
              "new Function('world','system','ItemStack','BlockPermutation','ActionFormData',src)("
              "{afterEvents:new Proxy({},{get:()=>ev}),getAllPlayers:()=>[],getDynamicProperty(){}},"
              "{runInterval(){},runTimeout(){},afterEvents:{scriptEventReceive:ev},currentTick:0},class{},{resolve:()=>({})},class{});"
              "console.log(JSON.stringify(__heistTest.api.LAYOUT.rows))")
    rows = json.loads(subprocess.check_output(["node", "-e", script, main_js]))
    S = 9
    w, h = len(rows[0]), len(rows)
    img = Image.new("RGB", (w * S, h * S), (232, 226, 210))
    d = ImageDraw.Draw(img)
    for i, row in enumerate(rows):
        y = (h - 1 - i) * S                                                # far side at the top
        for u, ch in enumerate(row):
            col = MAP_COLORS.get(ch, (255, 0, 255))
            if len(col) == 4:
                continue
            d.rectangle([u * S, y, u * S + S - 1, y + S - 1], fill=col)
            if ch == "g":
                for k in range(0, S, 3):
                    d.line([u * S + k, y + S - 2, u * S + k + 1, y + 2], fill=(96, 160, 60))
            if ch == "T":
                d.ellipse([u * S - S, y - S, u * S + 2 * S - 1, y + 2 * S - 1], outline=(40, 110, 40), width=2)
    # Crown on the pedestal, the jail buttons and the start buttons.
    cu, cv = 36, 51
    cy = (h - 1 - (cv + 12)) * S
    d.polygon([(cu * S - 7, cy + 4), (cu * S - 7, cy - 6), (cu * S - 3, cy - 1), (cu * S, cy - 8), (cu * S + 3, cy - 1),
               (cu * S + 7, cy - 6), (cu * S + 7, cy + 4)], fill=(255, 210, 40), outline=(120, 80, 0))
    for u, col in [(34, (60, 200, 60)), (36, (240, 220, 40)), (38, (220, 50, 50))]:
        y = (h - 1 - (-11 + 12)) * S
        d.ellipse([u * S + 1, y + 1, u * S + S - 2, y + S - 2], fill=col, outline=(0, 0, 0))
    img.save(path)


if __name__ == "__main__":
    rp = sys.argv[1]
    write_pack(rp)
    bp = rp.rstrip("/")[:-3] + "_BP" if rp.rstrip("/").endswith("_RP") else None
    if len(sys.argv) > 2:
        icon = os.path.join(rp, "pack_icon.png")
        render_preview(sys.argv[2], icon)
        if bp and os.path.isdir(bp):
            Image.open(icon).save(os.path.join(bp, "pack_icon.png"))
    if len(sys.argv) > 3 and bp:
        render_map(sys.argv[3], os.path.join(bp, "scripts", "main.js"))
