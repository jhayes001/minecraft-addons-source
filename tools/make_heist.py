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
  models/armor/heist_cape.geo.json             the Royal Cape: shirt + cape, worn in the chest slot (+ textures/models/armor/heist_cape.png)
  textures/items/royal_cape.png                the Royal Cape icon
  textures/items/rainbow_blaster.png           the Rainbow Blaster icon (its rainbow particle reuses heist_sparkle, tinted)
  textures/items/heist_map.png                 the Heist Map icon
  textures/particle/heist_sparkle.png          gold twinkle
  textures/particle/heist_marks.png            "?" and "!" over a guard's head
And, when making a preview, pack_icon.png into both packs and a top-down picture of the Ender Manor
(the layout is read from the behavior pack's main.js with node).

Units are pixels, feet at y = 0, facing north (-Z). Every face is painted from an 8x8 swatch, except the
front of the head (the face) and the front of the shirt. Positive x rotation tips the top of a bone
forward (same as the other add-ons).

Usage: python3 make_heist.py <resource_pack_dir> [preview.png] [map.png] [prizes.png] [cape.png]
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


def geo(identifier, order, parents, pivots, tex_w, tex_h, bw, bh, offset, rotations=None, root=True):
    out = [{"name": "root", "pivot": [0, 0, 0]}] if root else []
    for name in order:
        cubes = []
        for c in bones_of[identifier][name]:
            uv = {}
            for f in FACES:
                pos, size = uv_of[identifier](c["faces"].get(f, c["c"]))
                uv[f] = {"uv": pos, "uv_size": size}
            cube = {"origin": [round(v, 3) for v in c["o"]], "size": [round(v, 3) for v in c["s"]], "uv": uv}
            if c.get("inflate"):
                cube["inflate"] = c["inflate"]
            cubes.append(cube)
        bone = {"name": name, "pivot": pivots[name], "cubes": cubes}
        parent = parents.get(name, "root" if root else None)
        if parent:
            bone["parent"] = parent
        if rotations and name in rotations:
            bone["rotation"] = rotations[name]
        out.append(bone)
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
# 0 crown, 1 boots, 2 pants, 3 chestplate, 4 sword, 5 enchanted golden apple, 6 treasure chest, 7 royal cape.
# Keep in sync with LADDER in main.js (its `model` numbers).
PRIZE_BONES = ["crown", "boots", "pants", "chest", "sword", "apple", "chest_box", "cape"]
crown_bones = {"cushion": [], "prize": [], **{b: [] for b in PRIZE_BONES}}
CROWN_SW = ["velvet", "velvet_dark", "gold", "gold_dark", "ruby", "sapphire", "emerald", "tassel", "wood", "leaf", "box", "box_dark",
            "shirt", "ruffle", "cape", "lining"]


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

# Royal Cape: a little shirt on a stand with the cape hanging behind it.
cbox("cape", -0.5, Y0, -0.5, 1.0, 4.0, 1.0, "wood")                                 # stand
cbox("cape", -3.0, Y0 + 4.0, -1.4, 6.0, 5.0, 2.8, "shirt")                         # shirt
cbox("cape", -4.6, Y0 + 6.6, -1.5, 1.8, 2.4, 3.0, "shirt"); cbox("cape", 2.8, Y0 + 6.6, -1.5, 1.8, 2.4, 3.0, "shirt")   # puffy sleeves
cbox("cape", -2.2, Y0 + 8.8, -1.6, 4.4, 0.7, 1.2, "ruffle")                        # ruffled collar
cbox("cape", -0.35, Y0 + 5.0, -1.55, 0.7, 0.7, 0.2, "gold"); cbox("cape", -0.35, Y0 + 6.8, -1.55, 0.7, 0.7, 0.2, "gold")  # buttons
cbox("cape", -3.6, Y0 + 1.0, 1.4, 7.2, 8.6, 0.6, "cape")                           # cape behind
cbox("cape", -3.7, Y0 + 9.2, 1.3, 7.4, 0.6, 0.8, "gold")                           # gold trim at the top
cbox("cape", -0.6, Y0 + 4.2, 2.0, 1.2, 1.2, 0.2, "gold")                           # star

# The crown on your head (the Golden Crown item): the same crown, a bit bigger, sitting on top of the head
# (player head: y 24-32, 8 wide). Bone `head` follows the player's head.
worn_bones = {"head": []}
for c in crown_bones["crown"]:
    (x, y, z), (w, h, d) = c["o"], c["s"]
    worn_bones["head"].append({"o": (x * 1.3, 31.4 + (y - Y0) * 1.15, z * 1.3), "s": (w * 1.3, h * 1.15, d * 1.3), "c": c["c"], "faces": {}})

bones_of = {"geometry.ender_guard": bones, "geometry.heist_crown": crown_bones, "geometry.heist_crown_worn": worn_bones}
uv_of = {"geometry.ender_guard": sw_uv, "geometry.heist_crown": crown_uv, "geometry.heist_crown_worn": crown_uv}


# ---------- Royal Cape (worn) ----------
# A pretty shirt (puffy sleeves, a ruffled collar, gold buttons) and a cape hanging from the shoulders, worn in the chest
# slot like a chestplate. Bones `body`, `rightArm`, `leftArm` follow the player's; `cape` hangs from the top of the back
# and sways a little (animation.heist_cape.sway). Player model: body x -4..4, y 12..24, z -2..2 (front is -z).
SHIRT, SHIRT_DARK, RUFFLE = (196, 160, 236), (162, 124, 210), (255, 182, 214)
CAPE, CAPE_DARK, LINING, GOLD = (110, 40, 160), (84, 26, 128), (255, 150, 200), (250, 204, 64)
CAPE_SW = ["shirt", "shirt_dark", "ruffle", "cape", "lining", "gold"]
CAPE_REGIONS = {"shirt_front": (0, 16, 8, 12), "cape_back": (16, 16, 10, 16), "cape_lining": (32, 16, 10, 16)}
cape_bones = {"body": [], "rightArm": [], "leftArm": [], "cape": []}


def cape_uv(name):
    if name in CAPE_REGIONS:
        u, v, w, h = CAPE_REGIONS[name]
        return [u, v], [w, h]
    i = CAPE_SW.index(name)
    return [i * 8, 0], [8, 8]


def kbox(bone, x, y, z, w, h, d, color, faces=None, inflate=0):
    cape_bones[bone].append({"o": (x, y, z), "s": (w, h, d), "c": color, "faces": faces or {}, "inflate": inflate})


kbox("body", -4, 12, -2, 8, 12, 4, "shirt", {"north": "shirt_front"}, inflate=0.45)    # shirt
kbox("body", -3.5, 23.6, -2.9, 7, 1.0, 1.0, "ruffle")                                 # ruffled collar
kbox("body", -4.2, 22.4, 2.2, 1.6, 1.6, 0.8, "gold"); kbox("body", 2.6, 22.4, 2.2, 1.6, 1.6, 0.8, "gold")   # cape clasps
kbox("rightArm", -8, 18.5, -2, 4, 5.5, 4, "shirt", inflate=0.8)                       # puffy sleeves
kbox("leftArm", 4, 18.5, -2, 4, 5.5, 4, "shirt", inflate=0.8)
kbox("rightArm", -8, 18.0, -2, 4, 0.8, 4, "ruffle", inflate=0.9)
kbox("leftArm", 4, 18.0, -2, 4, 0.8, 4, "ruffle", inflate=0.9)
kbox("cape", -5, 7.5, 2.6, 10, 16, 1, "gold", {"south": "cape_back", "north": "cape_lining"})   # the cape

bones_of["geometry.heist_cape"] = cape_bones
uv_of["geometry.heist_cape"] = cape_uv


def cape_texture():
    tex = Image.new("RGBA", (64, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)
    cols = {"shirt": SHIRT, "shirt_dark": SHIRT_DARK, "ruffle": RUFFLE, "cape": CAPE, "lining": LINING, "gold": GOLD}
    for name, col in cols.items():
        (x, y), _ = cape_uv(name)
        d.rectangle([x, y, x + 7, y + 7], fill=col + (255,))
    (x, y), _ = cape_uv("shirt")
    for k in range(0, 8, 3):
        d.line([x + k, y, x + k, y + 7], fill=SHIRT_DARK + (255,))                 # soft stripes
    (x, y), _ = cape_uv("ruffle")
    for k in range(0, 8, 2):
        tex.putpixel((x + k, y + 7), (255, 230, 240, 255)); tex.putpixel((x + k + 1, y), (236, 140, 186, 255))
    # Shirt front: ruffles down the middle, gold buttons, a little heart.
    u, v, w, h = CAPE_REGIONS["shirt_front"]
    d.rectangle([u, v, u + w - 1, v + h - 1], fill=SHIRT + (255,))
    for yy in range(h):
        tex.putpixel((u + 3, v + yy), RUFFLE + (255,)); tex.putpixel((u + 4, v + yy), (255, 210, 230, 255))
    for yy in (2, 5, 8):
        tex.putpixel((u + 4, v + yy), GOLD + (255,))
    for px, py in [(1, 2), (2, 2), (5, 2), (6, 2)]:
        tex.putpixel((u + px, v + py), RUFFLE + (255,))
    d.rectangle([u, v + h - 1, u + w - 1, v + h - 1], fill=SHIRT_DARK + (255,))
    # Cape back: royal purple, gold edges, a gold star.
    u, v, w, h = CAPE_REGIONS["cape_back"]
    d.rectangle([u, v, u + w - 1, v + h - 1], fill=CAPE + (255,))
    for yy in range(h):
        if yy % 4 == 1:
            d.line([u + 1, v + yy, u + w - 2, v + yy], fill=CAPE_DARK + (255,))      # folds
    d.rectangle([u, v, u + w - 1, v + h - 1], outline=GOLD + (255,))
    star = ["...##...",
            "...##...",
            "########",
            ".######.",
            "..####..",
            ".##..##.",
            "##....##"]
    for py, row in enumerate(star):
        for px, ch in enumerate(row):
            if ch == "#":
                tex.putpixel((u + 1 + px, v + 3 + py), GOLD + (255,))
    # Cape lining: pink with a gold edge.
    u, v, w, h = CAPE_REGIONS["cape_lining"]
    d.rectangle([u, v, u + w - 1, v + h - 1], fill=LINING + (255,))
    d.rectangle([u, v, u + w - 1, v + h - 1], outline=GOLD + (255,))
    return tex


def cape_icon():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.polygon([(3, 2), (12, 2), (15, 15), (0, 15)], fill=CAPE + (255,), outline=CAPE_DARK + (255,))   # cape
    d.line([(3, 2), (12, 2)], fill=GOLD + (255,))
    d.rectangle([4, 3, 11, 10], fill=SHIRT + (255,))                                                  # shirt
    d.rectangle([2, 3, 4, 6], fill=SHIRT + (255,)); d.rectangle([11, 3, 13, 6], fill=SHIRT + (255,))  # sleeves
    d.line([(5, 3), (10, 3)], fill=RUFFLE + (255,))
    for y in (5, 7, 9):
        img.putpixel((7, y), GOLD + (255,)); img.putpixel((8, y), GOLD + (255,))
    img.putpixel((7, 13), GOLD + (255,)); img.putpixel((8, 12), GOLD + (255,)); img.putpixel((9, 13), GOLD + (255,))
    return img


def crown_texture():
    tex = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)
    cols = {"velvet": (176, 30, 52), "velvet_dark": (140, 20, 40), "gold": (252, 200, 48), "gold_dark": (214, 156, 28),
            "ruby": (230, 30, 60), "sapphire": (40, 90, 230), "emerald": (40, 200, 90), "tassel": (255, 236, 160),
            "wood": (120, 80, 44), "leaf": (60, 170, 60), "box": (150, 96, 50), "box_dark": (116, 70, 36),
            "shirt": SHIRT, "ruffle": RUFFLE, "cape": CAPE, "lining": LINING}
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
             "6. Enchanted Apple", "8+. Treasure Chest", "7. Royal Cape"]
    fig = plt.figure(figsize=(19, 3.4), dpi=110)
    fig.patch.set_facecolor(bg)
    order = [0, 1, 2, 3, 4, 5, 7, 6]   # ladder order: the cape comes before the treasure chests
    for slot, i in enumerate(order):
        b = PRIZE_BONES[i]
        ax = fig.add_subplot(1, 8, slot + 1, projection="3d")
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


def blaster_icon():
    """The Rainbow Blaster: a chunky toy blaster in white and gold with rainbow stripes and a glowing tip."""
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    outline = (60, 50, 80, 255)
    d.polygon([(1, 6), (12, 6), (12, 10), (7, 10), (6, 14), (3, 14), (4, 10), (1, 10)], fill=(245, 245, 250, 255), outline=outline)  # body and grip
    stripes = [(240, 60, 60), (250, 160, 40), (250, 230, 60), (90, 210, 90), (80, 140, 250), (170, 90, 240)]
    for i, c in enumerate(stripes):
        d.line([(2 + i, 7), (2 + i, 9)], fill=c + (255,))
    d.rectangle([12, 7, 14, 9], fill=(250, 204, 64, 255), outline=outline)                                                       # barrel
    img.putpixel((15, 8), (255, 250, 200, 255)); img.putpixel((15, 7), (255, 240, 160, 200)); img.putpixel((15, 9), (255, 240, 160, 200))
    d.line([(6, 10), (7, 12)], fill=outline)                                                                                      # trigger
    return img


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
    order = ["cushion", "prize"] + PRIZE_BONES
    save_json("models/entity/heist_crown.geo.json",
              geo("geometry.heist_crown", order, {b: "prize" for b in PRIZE_BONES}, {b: [0, 0, 0] for b in order}, 32, 32, 1.5, 1.5, [0, 0.5, 0]))
    save_png("textures/entity/heist_crown.png", crown_texture())
    save_json("models/armor/heist_crown_worn.geo.json",
              geo("geometry.heist_crown_worn", ["head"], {}, {"head": [0, 24, 0]}, 32, 32, 1, 1.5, [0, 1.5, 0]))
    save_png("textures/models/armor/heist_crown.png", crown_texture())
    save_png("textures/items/golden_crown.png", crown_icon())
    save_json("models/armor/heist_cape.geo.json",
              geo("geometry.heist_cape", ["body", "rightArm", "leftArm", "cape"], {"cape": "body"},
                  {"body": [0, 24, 0], "rightArm": [-5, 22, 0], "leftArm": [5, 22, 0], "cape": [0, 24, 2.6]},
                  64, 32, 2, 3, [0, 1.5, 0], rotations={"cape": [8, 0, 0]}, root=False))
    save_png("textures/models/armor/heist_cape.png", cape_texture())
    save_png("textures/items/royal_cape.png", cape_icon())
    save_png("textures/items/rainbow_blaster.png", blaster_icon())
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


def render_cape_preview(path):
    """A plain blocky player wearing the Golden Crown and the Royal Cape, from the front and from behind."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    tex, ctex = cape_texture(), crown_texture()
    skin, hair, pants, shoe = (232, 190, 160), (120, 72, 40), (60, 90, 170), (70, 50, 40)

    def rot_x(pt, pivot, ang):
        if not ang:
            return pt
        x, y, z = pt
        t = math.radians(ang)
        ry, rz = y - pivot[1], z - pivot[2]
        return x, pivot[1] + ry * math.cos(t) + rz * math.sin(t), pivot[2] - ry * math.sin(t) + rz * math.cos(t)

    def figure(ox, polys, cols):
        def solid(o, sz, col, inflate=0, ang=0, pivot=(0, 0, 0), faces=None, texture=None, uvf=None):
            (x, y, z), (w, h, d) = o, sz
            x, y, z, w, h, d = x - inflate, y - inflate, z - inflate, w + 2 * inflate, h + 2 * inflate, d + 2 * inflate
            for fname, quad in corners(x, y, z, w, h, d).items():
                region = (faces or {}).get(fname)
                if region and texture is not None:
                    (u0, v0), (tw, th) = uvf(region)
                    for px in range(tw):
                        for py in range(th):
                            y0, y1 = y + h - (py + 1) * h / th, y + h - py * h / th
                            if fname == "north":
                                a0, a1 = x + w - (px + 1) * w / tw, x + w - px * w / tw
                                q = [(a0, y0, z - 0.02), (a1, y0, z - 0.02), (a1, y1, z - 0.02), (a0, y1, z - 0.02)]
                            else:
                                a0, a1 = x + px * w / tw, x + (px + 1) * w / tw
                                q = [(a0, y0, z + d + 0.02), (a1, y0, z + d + 0.02), (a1, y1, z + d + 0.02), (a0, y1, z + d + 0.02)]
                            pts = [rot_x(p, pivot, ang) for p in q]
                            polys.append([(ox + p[0], p[2], p[1]) for p in pts])
                            c = texture.getpixel((u0 + px, v0 + py))
                            cols.append(tuple(min(1, ch / 255 * SHADE[fname] * 1.05) for ch in c[:3]) + (1,))
                    continue
                pts = [rot_x(p, pivot, ang) for p in quad]
                polys.append([(ox + p[0], p[2], p[1]) for p in pts])
                cols.append(tuple(min(1, ch / 255 * SHADE[fname]) for ch in col) + (1,))

        solid((-4, 0, -2), (4, 12, 4), pants); solid((0, 0, -2), (4, 12, 4), pants)
        solid((-4, 0, -2.2), (4, 2, 4.4), shoe); solid((0, 0, -2.2), (4, 2, 4.4), shoe)
        solid((-8, 12, -2), (4, 12, 4), skin); solid((4, 12, -2), (4, 12, 4), skin)
        solid((-4, 24, -4), (8, 8, 8), skin)
        solid((-4.2, 29, -4.2), (8.4, 3.4, 8.4), hair)
        for c in cape_bones["body"] + cape_bones["rightArm"] + cape_bones["leftArm"]:
            col = tex.getpixel((cape_uv(c["c"])[0][0] + 3, cape_uv(c["c"])[0][1] + 3))[:3]
            solid(c["o"], c["s"], col, c.get("inflate", 0), faces=c["faces"], texture=tex, uvf=cape_uv)
        for c in cape_bones["cape"]:
            solid(c["o"], c["s"], GOLD, ang=8, pivot=(0, 24, 2.6), faces=c["faces"], texture=tex, uvf=cape_uv)
        for c in worn_bones["head"]:
            (su, sv), _ = crown_uv(c["c"])
            solid(c["o"], c["s"], ctex.getpixel((su + 4, sv + 5))[:3])

    bg = (0.86, 0.84, 0.92)
    fig = plt.figure(figsize=(9, 6), dpi=110)
    fig.patch.set_facecolor(bg)
    for i, (azim, label) in enumerate([(-70, "front"), (110, "back")]):
        ax = fig.add_subplot(1, 2, i + 1, projection="3d")
        ax.set_facecolor(bg)
        polys, cols = [], []
        figure(0, polys, cols)
        ax.add_collection3d(Poly3DCollection(polys, facecolors=cols, edgecolors=(0, 0, 0, 0.12), linewidths=0.1))
        ax.set_xlim(-10, 10); ax.set_ylim(-10, 10); ax.set_zlim(0, 38)
        ax.set_box_aspect((20, 20, 38))
        ax.view_init(elev=8, azim=azim)
        ax.axis("off")
        ax.set_title(f"Royal Cape ({label})", fontsize=12, color=(0.2, 0.15, 0.3), y=0.95)
    plt.subplots_adjust(left=0, right=1, top=1, bottom=0, wspace=0)
    plt.savefig(path, facecolor=bg)
    plt.close(fig)


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
        render_prizes(sys.argv[4])
    if len(sys.argv) > 5:
        render_cape_preview(sys.argv[5])
