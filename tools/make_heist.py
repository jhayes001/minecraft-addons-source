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
  models/entity/heist_crown.geo.json           the treasure on its cushion (crown, boots, pants, chestplate, sword, apple, chest)
  textures/entity/heist_crown.png
  models/armor/heist_crown_worn.geo.json       the Golden Crown on your head (+ textures/models/armor/heist_crown.png)
  textures/items/golden_crown.png              the Golden Crown icon
  textures/items/heist_map.png                 the Heist Map icon
  textures/particle/heist_sparkle.png          gold twinkle
  textures/particle/heist_marks.png            "?" and "!" over a guard's head
  font/glyph_E7.png                            the little map's squares (U+E700 and up)
And, when making a preview, pack_icon.png into both packs and a top-down picture of the Ender Manor
(the layout is read from the behavior pack's main.js with node).

Units are pixels, feet at y = 0, facing north (-Z). Every face is painted from an 8x8 swatch, except the
front of the head (the face) and the front of the shirt. Positive x rotation tips the top of a bone
forward (same as the other add-ons).

Usage: python3 make_heist.py <resource_pack_dir> [preview.png] [map.png] [little_map.png] [prizes.png]
       python3 make_heist.py --manors out.png <behavior_pack>/scripts/main.js seed [seed...]   (pictures of random manors)
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
# The treasure on the pedestal. Bones under `prize` are the ladder of treasures (the entity `variant` picks one):
# 0 crown, 1 boots, 2 pants, 3 chestplate, 4 sword, 5 enchanted golden apple, 6 treasure chest. Keep in sync with LADDER in main.js.
PRIZE_BONES = ["crown", "boots", "pants", "chest", "sword", "apple", "chest_box"]
crown_bones = {"cushion": [], "prize": [], **{b: [] for b in PRIZE_BONES}}
CROWN_SW = ["velvet", "velvet_dark", "gold", "gold_dark", "ruby", "sapphire", "emerald", "tassel", "wood", "leaf", "box", "box_dark"]


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

# Golden boots: a pair, toes forward (north).
for x0 in (-3.2, 0.4):
    cbox("boots", x0, Y0, -0.6, 2.8, 4.2, 2.8, "gold")
    cbox("boots", x0, Y0, -2.8, 2.8, 1.6, 2.4, "gold")
    cbox("boots", x0 - 0.2, Y0 + 4.2, -0.8, 3.2, 0.6, 3.2, "gold_dark")
# Golden pants: two legs and a waistband.
for x0 in (-3.2, 0.4):
    cbox("pants", x0, Y0, -1.4, 2.8, 6, 2.8, "gold")
cbox("pants", -3.4, Y0 + 6, -1.6, 6.8, 1.6, 3.2, "gold_dark")
cbox("pants", -0.6, Y0 + 6.3, -1.75, 1.2, 1.0, 0.3, "ruby")
# Golden chestplate: body, shoulder pads, collar, a ruby on the front.
cbox("chest", -3.6, Y0, -1.8, 7.2, 6.5, 3.6, "gold")
cbox("chest", -5.2, Y0 + 4.5, -2, 1.8, 2.2, 4, "gold_dark"); cbox("chest", 3.4, Y0 + 4.5, -2, 1.8, 2.2, 4, "gold_dark")
cbox("chest", -1.6, Y0 + 6.5, -1.4, 3.2, 0.6, 2.8, "gold_dark")
cbox("chest", -0.6, Y0 + 3.4, -2.05, 1.2, 1.2, 0.3, "ruby")
# Golden sword, standing on its handle.
cbox("sword", -0.7, Y0, -0.7, 1.4, 0.6, 1.4, "gold_dark")
cbox("sword", -0.45, Y0 + 0.6, -0.45, 0.9, 2.0, 0.9, "wood")
cbox("sword", -2.2, Y0 + 2.6, -0.6, 4.4, 0.8, 1.2, "gold_dark")
cbox("sword", -0.7, Y0 + 3.4, -0.3, 1.4, 8.5, 0.6, "gold")
cbox("sword", -0.35, Y0 + 11.9, -0.3, 0.7, 0.8, 0.6, "gold")
# Enchanted golden apple.
cbox("apple", -2.2, Y0, -2.2, 4.4, 4, 4.4, "gold")
cbox("apple", -1.6, Y0 + 4, -1.6, 3.2, 0.5, 3.2, "gold_dark")
cbox("apple", -0.3, Y0 + 4.3, -0.3, 0.6, 1.4, 0.6, "wood")
cbox("apple", 0.3, Y0 + 5.0, -0.4, 1.8, 0.4, 0.9, "leaf")
cbox("apple", -2.25, Y0 + 2.2, -1.0, 0.1, 1.0, 1.0, "tassel")                    # shine
# Treasure chest with gold bands and a latch.
cbox("chest_box", -3.5, Y0, -2.5, 7, 3.4, 5, "box")
cbox("chest_box", -3.5, Y0 + 3.4, -2.5, 7, 1.6, 5, "box_dark")
cbox("chest_box", -3.6, Y0 + 3.2, -2.6, 7.2, 0.4, 5.2, "gold")
cbox("chest_box", -0.6, Y0 + 2.6, -2.75, 1.2, 1.4, 0.3, "gold")
for bx in (-3.65, 3.15):
    for bz in (-2.65, 2.15):
        cbox("chest_box", bx, Y0, bz, 0.5, 5.0, 0.5, "gold")

# The crown on your head (the Golden Crown item): the same crown, a bit bigger, sitting on top of the head
# (player head: y 24-32, 8 wide). Bone `head` follows the player's head.
worn_bones = {"head": []}
for c in crown_bones["crown"]:
    (x, y, z), (w, h, d) = c["o"], c["s"]
    worn_bones["head"].append({"o": (x * 1.3, 31.4 + (y - Y0) * 1.15, z * 1.3), "s": (w * 1.3, h * 1.15, d * 1.3), "c": c["c"], "faces": {}})

bones_of = {"geometry.ender_guard": bones, "geometry.heist_crown": crown_bones, "geometry.heist_crown_worn": worn_bones}
uv_of = {"geometry.ender_guard": sw_uv, "geometry.heist_crown": crown_uv, "geometry.heist_crown_worn": crown_uv}


def crown_texture():
    tex = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)
    cols = {"velvet": (176, 30, 52), "velvet_dark": (140, 20, 40), "gold": (252, 200, 48), "gold_dark": (214, 156, 28),
            "ruby": (230, 30, 60), "sapphire": (40, 90, 230), "emerald": (40, 200, 90), "tassel": (255, 236, 160),
            "wood": (120, 80, 44), "leaf": (60, 170, 60), "box": (150, 96, 50), "box_dark": (116, 70, 36)}
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
def crown_icon():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    gold, dark, light = (252, 200, 48, 255), (190, 130, 20, 255), (255, 244, 180, 255)
    d.polygon([(1, 13), (1, 4), (4, 8), (8, 2), (12, 8), (15, 4), (15, 13)], fill=gold, outline=dark)
    d.rectangle([1, 11, 15, 13], fill=dark)
    for x, c in [(4, (230, 30, 60, 255)), (8, (40, 90, 230, 255)), (12, (40, 200, 90, 255))]:
        d.rectangle([x - 1, 9, x, 10], fill=c)
    for x, y in [(1, 3), (8, 1), (15, 3)]:
        img.putpixel((x, y), light)
    img.putpixel((7, 4), light); img.putpixel((3, 7), light)
    return img


def render_prizes(path):
    """The treasure ladder on its cushion, in order: crown, boots, pants, chestplate, sword, apple, treasure chest."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    bg = (0.86, 0.84, 0.92)
    names = ["1. Golden Crown", "2. Golden Boots", "3. Golden Pants", "4. Golden Chestplate", "5. Golden Sword",
             "6. Enchanted Golden Apple", "7+. Treasure Chest"]
    fig = plt.figure(figsize=(17, 3.4), dpi=110)
    fig.patch.set_facecolor(bg)
    for i, b in enumerate(PRIZE_BONES):
        ax = fig.add_subplot(1, 7, i + 1, projection="3d")
        ax.set_facecolor(bg)
        pp, cc = crown_polys(0, 0, 1.0, b)
        ax.add_collection3d(Poly3DCollection(pp, facecolors=cc, edgecolors=(0, 0, 0, 0.2), linewidths=0.15))
        ax.set_xlim(-7, 7); ax.set_ylim(-7, 7); ax.set_zlim(0, 16)
        ax.set_box_aspect((14, 14, 16))
        ax.view_init(elev=18, azim=-62)
        ax.axis("off")
        ax.set_title(names[i], fontsize=11, color=(0.2, 0.15, 0.3), y=0.92)
    plt.subplots_adjust(left=0, right=1, top=1, bottom=0, wspace=0)
    plt.savefig(path, facecolor=bg)
    plt.close(fig)


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


# ---------- The little map's picture characters ----------
# font/glyph_E7.png: a 16 x 16 grid of 16-pixel characters, U+E700 is the top left. Keep the numbers in sync with GL in
# main.js. Every square is 14 wide and 16 tall (so they line up in rows), drawn a bit see-through so the world shows behind.
GLYPH_TILES = {
    0: ((30, 30, 36), 90), 1: ((96, 160, 66), 215), 2: ((70, 130, 46), 215), 3: ((96, 160, 66), 215), 4: ((176, 148, 98), 215),
    5: ((160, 160, 164), 215), 6: ((178, 132, 82), 215), 7: ((190, 50, 50), 215), 8: ((54, 50, 62), 215), 9: ((92, 92, 98), 235),
    10: ((226, 222, 168), 235), 11: ((30, 92, 34), 235), 12: ((42, 104, 36), 235), 13: ((56, 104, 214), 225), 14: ((110, 74, 42), 225),
    15: ((70, 140, 70), 225), 16: ((70, 70, 74), 235), 17: ((128, 128, 132), 215), 18: ((250, 204, 60), 235), 19: ((240, 236, 226), 235),
    20: ((86, 136, 128), 225),
}
GW, GH = 14, 16


def glyph_sheet():
    img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def cell(i):
        return (i % 16) * 16, (i // 16) * 16

    def square(i, col, a=235):
        x, y = cell(i)
        d.rectangle([x, y, x + GW - 1, y + GH - 1], fill=col + (a,))
        return x, y

    for i, (col, a) in GLYPH_TILES.items():
        x, y = square(i, col, a)
        if i == 2:                                                     # tall grass: blades
            for k in range(1, GW, 3):
                d.line([x + k, y + GH - 2, x + k + 1, y + 3], fill=(130, 200, 80, 255))
        if i == 3:                                                     # flowers
            for px, py, c in [(3, 4, (240, 110, 170)), (9, 3, (250, 220, 60)), (6, 10, (240, 110, 170)), (11, 12, (130, 150, 250))]:
                d.rectangle([x + px, y + py, x + px + 1, y + py + 1], fill=c + (255,))
        if i == 12:                                                    # tree: trunk in the middle
            d.rectangle([x + 5, y + 6, x + 8, y + 9], fill=(110, 76, 40, 255))
        if i == 13:                                                    # water: ripples
            for py in (4, 10):
                d.line([x + 2, y + py, x + 6, y + py], fill=(140, 180, 250, 255)); d.line([x + 8, y + py + 2, x + 12, y + py + 2], fill=(140, 180, 250, 255))
        if i == 18:                                                    # gold square: sparkle
            d.rectangle([x + 6, y + 4, x + 7, y + 11], fill=(255, 246, 190, 255)); d.rectangle([x + 3, y + 7, x + 10, y + 8], fill=(255, 246, 190, 255))
    # 21: stairs, wooden steps; 22: the hole over the stairs (dark).
    x, y = square(21, (178, 132, 82), 245)
    for k in range(0, GH, 4):
        d.rectangle([x, y + k, x + GW - 1, y + k + 1], fill=(110, 74, 42, 255))
    square(22, (24, 20, 28), 235)
    # 32: you, a white arrow pointing up on blue.
    x, y = square(32, (40, 90, 220), 255)
    d.polygon([(x + 7, y + 1), (x + 13, y + 10), (x + 9, y + 9), (x + 9, y + 14), (x + 5, y + 14), (x + 5, y + 9), (x + 1, y + 10)],
              fill=(255, 255, 255, 255))
    # 33: a friend, light blue with a white dot.
    x, y = square(33, (110, 200, 250), 255)
    d.ellipse([x + 4, y + 5, x + 9, y + 10], fill=(255, 255, 255, 255))
    # 34-36: Ender Guards, a black face with long eyes (purple / yellow / red); the chasing one has a red border.
    for i, eye in [(34, (204, 82, 255)), (35, (255, 214, 64)), (36, (255, 52, 52))]:
        x, y = square(i, (14, 12, 18), 255)
        if i == 36:
            d.rectangle([x, y, x + GW - 1, y + GH - 1], outline=(255, 52, 52, 255), width=2)
        d.rectangle([x + 2, y + 7, x + 5, y + 8], fill=eye + (255,)); d.rectangle([x + 8, y + 7, x + 11, y + 8], fill=eye + (255,))
    # 37: the crown, gold on dark purple.
    x, y = square(37, (60, 30, 90), 255)
    d.polygon([(x + 1, y + 12), (x + 1, y + 4), (x + 4, y + 8), (x + 7, y + 2), (x + 10, y + 8), (x + 13, y + 4), (x + 13, y + 12)],
              fill=(255, 210, 40, 255))
    d.rectangle([x + 6, y + 8, x + 7, y + 9], fill=(230, 30, 60, 255))
    # 38: the gold square (home), gold with a dark border and a little house.
    x, y = square(38, (250, 204, 60), 255)
    d.rectangle([x, y, x + GW - 1, y + GH - 1], outline=(110, 70, 0, 255), width=2)
    d.polygon([(x + 7, y + 3), (x + 12, y + 8), (x + 2, y + 8)], fill=(150, 60, 30, 255))
    d.rectangle([x + 4, y + 8, x + 10, y + 12], fill=(150, 60, 30, 255))
    return img


def render_radar_sample(path):
    """What the little map looks like: walking into the manor's front hall with the crown ahead and two guards."""
    sheet = glyph_sheet()
    g = [[1] * 13 for _ in range(11)]
    for r in range(11):
        for c in range(13):
            g[r][c] = 6 if r < 7 else 4 if c in (5, 6, 7) else 1
    for c in range(13):
        if c not in (5, 6, 7):
            g[7][c] = 10
    for r in range(0, 7):
        g[r][0] = 10
    for c in range(1, 13):
        g[0][c] = 10
    g[0][6] = 6
    for r in range(1, 7):
        g[r][6] = 7
    g[3][2] = 14; g[3][10] = 14; g[8][1] = 11; g[9][1] = 11; g[8][11] = 2; g[9][11] = 2; g[9][10] = 2
    g[0][6] = 37; g[2][3] = 34; g[4][9] = 35; g[5][6] = 32
    S = 3
    out = Image.new("RGBA", (13 * 16 * S + 40, 11 * 20 * S + 40), (120, 150, 200, 255))
    for r in range(11):
        for c in range(13):
            i = g[r][c]
            tile = sheet.crop(((i % 16) * 16, (i // 16) * 16, (i % 16) * 16 + 16, (i // 16) * 16 + 16)).resize((16 * S, 16 * S), Image.NEAREST)
            out.alpha_composite(tile, (20 + c * 16 * S, 20 + r * 20 * S))
    out.save(path)


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
    order = ["cushion", "prize"] + PRIZE_BONES
    save_json("models/entity/heist_crown.geo.json",
              geo("geometry.heist_crown", order, {b: "prize" for b in PRIZE_BONES}, {b: [0, 0, 0] for b in order}, 32, 32, 1.5, 1.5, [0, 0.5, 0]))
    save_png("textures/entity/heist_crown.png", crown_texture())
    save_json("models/armor/heist_crown_worn.geo.json",
              geo("geometry.heist_crown_worn", ["head"], {}, {"head": [0, 24, 0]}, 32, 32, 1, 1.5, [0, 1.5, 0]))
    save_png("textures/models/armor/heist_crown.png", crown_texture())
    save_png("textures/items/golden_crown.png", crown_icon())
    save_png("textures/items/heist_map.png", map_icon())
    save_png("textures/particle/heist_sparkle.png", sparkle_texture())
    save_png("textures/particle/heist_marks.png", marks_texture())
    save_png("font/glyph_E7.png", glyph_sheet())
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


def crown_polys(ox, oz, s=1.6, prize="crown"):
    tex = crown_texture()
    polys, cols = [], []
    for bone in ("cushion", prize):
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


def render_manors(path, main_js, seeds):
    """Top-down pictures of random manors (ground floor and upstairs side by side), from their seeds."""
    script = ("const fs=require('fs');const src=fs.readFileSync(process.argv[1],'utf8').replace(/^import .*$/gm,'');"
              "const ev={subscribe(){}};globalThis.__heistTest={};"
              "new Function('world','system','ItemStack','BlockPermutation','ActionFormData',src)("
              "{afterEvents:new Proxy({},{get:()=>ev}),getAllPlayers:()=>[],getDynamicProperty(){}},"
              "{runInterval(){},runTimeout(){},afterEvents:{scriptEventReceive:ev},currentTick:0},class{},{resolve:()=>({})},class{});"
              "console.log(JSON.stringify(process.argv.slice(2).map(Number).map(s=>{const L=__heistTest.api.generateLayout(s);"
              "return {seed:s,floors:L.floors.map(G=>G.g.map(r=>r.join(''))),ped:L.pedestal};})))")
    data = json.loads(subprocess.check_output(["node", "-e", script, main_js] + [str(x) for x in seeds]))
    colors = dict(MAP_COLORS)
    colors.update({"s": (210, 150, 80), "u": (240, 186, 96), "o": (14, 12, 18), "n": (96, 64, 34), "Z": (110, 80, 50)})
    S, top = 6, 26
    w, h = 72 * S, 72 * S
    img = Image.new("RGB", (2 * w + 30, len(data) * (h + top + 14) + 6), (236, 230, 214))
    d = ImageDraw.Draw(img)
    for k, m in enumerate(data):
        oy = 6 + k * (h + top + 14) + top
        for f in range(2):
            ox = 10 + f * (w + 10)
            label = "upstairs" if f else "ground floor"
            if f >= len(m["floors"]):
                d.text((ox + w // 2 - 40, oy + h // 2), "(one story)", fill=(90, 80, 70))
                continue
            for i, row in enumerate(m["floors"][f]):
                v = i - 12
                if v < 0:
                    continue
                y = oy + (71 - v) * S
                for u, ch in enumerate(row):
                    if f == 1 and ch == " ":
                        c0 = colors.get(m["floors"][0][i][u], (236, 230, 214))
                        col = tuple(int(c * 0.3 + 165) for c in c0[:3])
                    else:
                        col = colors.get(ch, (255, 0, 255))
                        if len(col) == 4:
                            continue
                    d.rectangle([ox + u * S, y, ox + u * S + S - 1, y + S - 1], fill=col[:3])
            p = m["ped"]
            if p["f"] == f:
                cx, cy = ox + p["U"] * S, oy + (72 - p["V"]) * S
                d.ellipse([cx - 9, cy - 9, cx + 9, cy + 9], outline=(220, 20, 20), width=3)
            d.text((ox, oy - 16), f"Manor #{k + 1}: {label}" + ("  (treasure circled)" if p["f"] == f else ""), fill=(40, 30, 20))
    img.save(path)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--manors":   # make_heist.py --manors out.png main.js seed...
        render_manors(sys.argv[2], sys.argv[3], [int(x) for x in sys.argv[4:]])
        sys.exit(0)
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
    if len(sys.argv) > 4:
        render_radar_sample(sys.argv[4])
    if len(sys.argv) > 5:
        render_prizes(sys.argv[5])
