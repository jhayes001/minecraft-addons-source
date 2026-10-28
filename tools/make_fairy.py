"""Builds the models and textures for the Fairy Friends add-on, and optionally a preview picture.

Writes into the resource pack:
  models/entity/fairy.geo.json       fairy model (girl and boy parts, butterfly wings)
  textures/entity/fairy/fairy_<color>.png   one texture per color, plus rainbow
  models/entity/fairy_egg.geo.json + textures/entity/fairy_egg.png
  models/blocks/fairy_house.geo.json + textures/blocks/fairy_house(_lit).png   mushroom cottage
  textures/items/fairy_egg.png, textures/particle/fairy_dust.png

The fairy is built at double size (so the face has room for big eyes) and shrunk in game
with minecraft:scale. The front faces north (-Z). Every face is painted with an 8x8 color
swatch, except the faces and wings, which have their own drawings.

Usage: python3 make_fairy.py <resource_pack_dir> [preview.png]
"""
import colorsys, json, math, os, random, sys
from PIL import Image, ImageDraw

# Index in the fairy's COLORS list = the entity's variant number. Keep this order in sync with main.js.
COLORS = [
    # name,    outfit,          light,           dark,           hair
    ("pink",   (255, 120, 190), (255, 192, 226), (196, 58, 140), (192, 152, 242)),
    ("red",    (232, 52, 62),   (255, 160, 160), (156, 24, 40),  (122, 66, 40)),
    ("orange", (255, 150, 40),  (255, 208, 142), (200, 96, 20),  (152, 82, 40)),
    ("yellow", (255, 218, 56),  (255, 242, 164), (204, 156, 20), (176, 118, 70)),
    ("green",  (88, 200, 108),  (172, 240, 172), (38, 138, 68),  (246, 150, 192)),
    ("aqua",   (56, 210, 210),  (172, 246, 240), (18, 148, 160), (236, 236, 246)),
    ("blue",   (70, 120, 240),  (164, 192, 255), (40, 70, 180),  (240, 202, 112)),
    ("purple", (160, 90, 230),  (216, 182, 255), (100, 50, 170), (72, 46, 92)),
    ("rainbow", None, None, (120, 60, 170), None),
]
RAINBOW = [(255, 70, 70), (255, 160, 50), (255, 232, 70), (90, 220, 100), (70, 170, 255), (110, 100, 255), (200, 100, 255)]
SKIN = (244, 204, 176)
WHITE = (250, 250, 250)

# ---------------- Fairy model ----------------
SW = ["skin", "outfit", "light", "dark", "hair", "flower", "flower2", "brown", "cap", "white", "gold", "leaf"]
FACE_UV = {"face_girl": (0, 16), "face_boy": (16, 16)}
WING_UV = {"upper": (0, 32, 12, 14), "lower": (16, 32, 8, 8)}


def sw_uv(name):
    if name in FACE_UV:
        return list(FACE_UV[name]), [10, 10]
    i = SW.index(name)
    return [(i % 16) * 8, (i // 16) * 8], [8, 8]


bones = {"girl": [], "boy": [], "wing_l": [], "wing_r": []}


def box(bone, x, y, z, w, h, d, color, front=None):
    bones[bone].append({"o": (x, y, z), "s": (w, h, d), "c": color, "front": front})


# Girl: petal skirt, puffy sleeves, long hair, flower crown.
g = "girl"
box(g, -2.5, 2, -1, 2, 5, 2, "skin"); box(g, 0.5, 2, -1, 2, 5, 2, "skin")              # legs
box(g, -2.75, 0, -1.5, 2.5, 2, 2.75, "dark"); box(g, 0.25, 0, -1.5, 2.5, 2, 2.75, "dark")  # slippers
box(g, -6, 5, -5, 12, 2, 10, "light")                                                  # petal hem
box(g, -5, 6.5, -4, 10, 5, 8, "outfit")                                                # skirt
box(g, -3.5, 11, -2.5, 7, 6, 5, "outfit")                                              # bodice
box(g, -5.5, 10, -1, 2, 6, 2, "skin"); box(g, 3.5, 10, -1, 2, 6, 2, "skin")            # arms
box(g, -6, 15, -1.5, 3, 3, 3, "light"); box(g, 3, 15, -1.5, 3, 3, 3, "light")          # puffy sleeves
box(g, -5, 17, -5, 10, 10, 10, "skin", front="face_girl")                             # head
box(g, -5.5, 26.5, -5.5, 11, 1.5, 11, "hair")                                          # hair top
box(g, -5.5, 12, 5, 11, 16, 1.5, "hair")                                               # long hair down the back
box(g, -5.8, 18, -4, 0.8, 9.5, 9.5, "hair"); box(g, 5, 18, -4, 0.8, 9.5, 9.5, "hair")  # hair at the sides
for i, (fx, fz) in enumerate([(-5.5, -4), (-2.6, -6), (0.6, -6), (3.5, -4), (-6.4, 0), (4.4, 0), (-6.4, 3.5), (4.4, 3.5)]):
    box(g, fx, 27.5, fz, 2, 2, 2, "flower" if i % 2 == 0 else "flower2")                # flower crown

# Boy: tunic with belt, acorn-cap hat with a leaf.
b = "boy"
box(b, -2.5, 2, -1, 2, 6, 2, "dark"); box(b, 0.5, 2, -1, 2, 6, 2, "dark")              # legs
box(b, -2.75, 0, -1.5, 2.5, 2.5, 2.75, "brown"); box(b, 0.25, 0, -1.5, 2.5, 2.5, 2.75, "brown")  # boots
box(b, -4, 7, -2.5, 8, 9, 5, "outfit")                                                 # tunic
box(b, -4.2, 9, -2.7, 8.4, 1.5, 5.4, "brown")                                          # belt
box(b, -0.75, 9, -2.9, 1.5, 1.5, 0.3, "gold")                                          # buckle
box(b, -6, 10, -1, 2, 6, 2, "outfit"); box(b, 4, 10, -1, 2, 6, 2, "outfit")            # sleeves
box(b, -6, 8, -1, 2, 2, 2, "skin"); box(b, 4, 8, -1, 2, 2, 2, "skin")                  # hands
box(b, -5, 16, -5, 10, 10, 10, "skin", front="face_boy")                              # head
box(b, -5.5, 19, 5, 11, 7, 1, "hair")                                                  # hair at the back
box(b, -5.6, 21, -3, 0.6, 5, 8.5, "hair"); box(b, 5, 21, -3, 0.6, 5, 8.5, "hair")      # hair at the sides
box(b, -6, 25.5, -6, 12, 2, 12, "cap")                                                 # acorn cap
box(b, -5, 27.5, -5, 10, 2, 10, "cap")
box(b, -3, 29.5, -3, 6, 1, 6, "cap")
box(b, -0.75, 30.5, -0.75, 1.5, 2.5, 1.5, "brown")                                     # stem
box(b, 0.75, 32, -0.5, 3, 0.5, 2, "leaf")                                              # little leaf

# Butterfly wings: flat panels behind the shoulders. Each side flaps around its pivot.
box("wing_l", -13, 14, 3, 12, 14, 0, "upper"); box("wing_l", -9, 7, 3, 8, 8, 0, "lower")
box("wing_r", 1, 14, 3, 12, 14, 0, "upper"); box("wing_r", 1, 7, 3, 8, 8, 0, "lower")
PIVOTS = {"girl": [0, 0, 0], "boy": [0, 0, 0], "wing_l": [-1, 14, 3], "wing_r": [1, 14, 3]}


def fairy_geo():
    out_bones = [{"name": "root", "pivot": [0, 0, 0]}]
    for name, cubes in bones.items():
        cs = []
        for c in cubes:
            uv = {}
            if c["c"] in WING_UV:
                u, v, w, h = WING_UV[c["c"]]
                mirror = name == "wing_r"
                for f in ("north", "south"):
                    uv[f] = {"uv": [u + w, v] if mirror else [u, v], "uv_size": [-w, h] if mirror else [w, h]}
            else:
                for f in ("north", "south", "east", "west", "up", "down"):
                    pos, size = sw_uv(c["front"] if (f == "north" and c["front"]) else c["c"])
                    uv[f] = {"uv": pos, "uv_size": size}
            cs.append({"origin": list(c["o"]), "size": list(c["s"]), "uv": uv})
        out_bones.append({"name": name, "parent": "root", "pivot": PIVOTS[name], "cubes": cs})
    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": "geometry.fairy", "texture_width": 128, "texture_height": 128,
                "visible_bounds_width": 3, "visible_bounds_height": 3, "visible_bounds_offset": [0, 1, 0],
            },
            "bones": out_bones,
        }],
    }


def stripes(d, x, y, w, h, colors, vertical=False):
    n = len(colors)
    for i, col in enumerate(colors):
        if vertical:
            d.rectangle([x + i * w // n, y, x + (i + 1) * w // n - 1, y + h - 1], fill=col + (255,))
        else:
            d.rectangle([x, y + i * h // n, x + w - 1, y + (i + 1) * h // n - 1], fill=col + (255,))


def lighten(c, f):
    return tuple(int(v + (255 - v) * f) for v in c)


def fairy_texture(idx):
    name, outfit, light, dark, hair = COLORS[idx]
    rainbow = name == "rainbow"
    tex = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)

    def fill(sw, col):
        (x, y), _ = sw_uv(sw)
        d.rectangle([x, y, x + 7, y + 7], fill=col + (255,))

    fill("skin", SKIN)
    fill("dark", dark)
    fill("flower", WHITE)
    fill("flower2", (255, 228, 90))
    fill("brown", (120, 78, 46))
    fill("white", WHITE)
    fill("gold", (242, 190, 44))
    if rainbow:
        for sw, cols in (("outfit", RAINBOW), ("light", [lighten(c, 0.5) for c in RAINBOW]),
                         ("hair", [lighten(c, 0.25) for c in RAINBOW])):
            (x, y), _ = sw_uv(sw)
            stripes(d, x, y, 8, 8, cols[:4] if sw == "hair" else cols[::2], vertical=False)
        fill("leaf", (255, 160, 220))
    else:
        fill("outfit", outfit)
        fill("light", light)
        fill("hair", hair)
        fill("leaf", light)
    # Acorn cap: brown with a criss-cross pattern.
    (x, y), _ = sw_uv("cap")
    d.rectangle([x, y, x + 7, y + 7], fill=(150, 100, 56, 255))
    for i in range(8):
        for j in range(8):
            if (i + j) % 3 == 0:
                tex.putpixel((x + i, y + j), (118, 76, 40, 255))
    # Small shading line at the hem of outfit swatches so the cubes read as clothing.
    hair_px = lambda col, row: tex.getpixel(((sw_uv("hair")[0][0] + col % 8), sw_uv("hair")[0][1] + row % 8))[:3]
    eye_dark = (44, 34, 66)
    iris = dark if not rainbow else (150, 80, 220)

    # Girl's face: side-swept fringe, big eyes with lashes, rosy cheeks, small smile.
    fx, fy = FACE_UV["face_girl"]
    d.rectangle([fx, fy, fx + 9, fy + 9], fill=SKIN + (255,))
    for col in range(10):
        for row in (0, 1):
            tex.putpixel((fx + col, fy + row), hair_px(col, row) + (255,))
    for col in (0, 1, 2, 7, 8, 9):
        tex.putpixel((fx + col, fy + 2), hair_px(col, 2) + (255,))
    for col in (0, 9):
        tex.putpixel((fx + col, fy + 3), hair_px(col, 3) + (255,))
    for ex in (2, 6):
        for row in (4, 5, 6):
            for c in (0, 1):
                tex.putpixel((fx + ex + c, fy + row), (eye_dark if row == 4 else iris) + (255,))
        tex.putpixel((fx + ex, fy + 5), WHITE + (255,))
    tex.putpixel((fx + 1, fy + 3), eye_dark + (255,)); tex.putpixel((fx + 8, fy + 3), eye_dark + (255,))  # lashes
    tex.putpixel((fx + 1, fy + 7), (240, 150, 160, 255)); tex.putpixel((fx + 8, fy + 7), (240, 150, 160, 255))
    tex.putpixel((fx + 4, fy + 8), (204, 92, 104, 255)); tex.putpixel((fx + 5, fy + 8), (204, 92, 104, 255))

    # Boy's face: spiky fringe, eyebrows, round eyes, freckles, grin.
    fx, fy = FACE_UV["face_boy"]
    d.rectangle([fx, fy, fx + 9, fy + 9], fill=SKIN + (255,))
    for col in range(10):
        tex.putpixel((fx + col, fy), hair_px(col, 0) + (255,))
        tex.putpixel((fx + col, fy + 1), hair_px(col, 1) + (255,))
    for col in (0, 3, 6, 9):
        tex.putpixel((fx + col, fy + 2), hair_px(col, 2) + (255,))
    brow = tuple(max(0, v - 60) for v in hair_px(0, 0))
    for ex in (2, 6):
        tex.putpixel((fx + ex, fy + 3), brow + (255,)); tex.putpixel((fx + ex + 1, fy + 3), brow + (255,))
        for c in (0, 1):
            tex.putpixel((fx + ex + c, fy + 4), eye_dark + (255,))
            tex.putpixel((fx + ex + c, fy + 5), iris + (255,))
        tex.putpixel((fx + ex, fy + 5), WHITE + (255,))
    for px in (1, 8):
        tex.putpixel((fx + px, fy + 6), (226, 150, 120, 255))
    for px in (3, 6):
        tex.putpixel((fx + px, fy + 7), (190, 90, 90, 255))
    for px in (4, 5):
        tex.putpixel((fx + px, fy + 8), (190, 90, 90, 255))

    # Wings: see-through, with a darker edge and white sparkle dots.
    for key in ("upper", "lower"):
        u, v, w, h = WING_UV[key]
        for px in range(w):
            for py in range(h):
                nx, ny = (px + 0.5) / w * 2 - 1, (py + 0.5) / h * 2 - 1
                r = nx * nx + ny * ny
                if r > 1:
                    continue
                if rainbow:
                    base = RAINBOW[min(len(RAINBOW) - 1, int(py / h * len(RAINBOW)))]
                    col = lighten(base, 0.35)
                else:
                    col = lighten(outfit, 0.45)
                alpha = 150
                if r > 0.62:
                    col = (dark if not rainbow else lighten(RAINBOW[min(6, int(py / h * 7))], 0.0))
                    alpha = 225
                tex.putpixel((u + px, v + py), col + (alpha,))
        dots = [(3, 4), (7, 3), (5, 8), (8, 9)] if key == "upper" else [(3, 3), (5, 5)]
        for dx, dy in dots:
            tex.putpixel((u + dx, v + dy), WHITE + (235,))
    return tex


# ---------------- Egg ----------------
EGG = [(-3, 0, -3, 6, 1, 6), (-4, 1, -4, 8, 6, 8), (-3.5, 7, -3.5, 7, 2, 7), (-2.5, 9, -2.5, 5, 1.5, 5)]


def egg_geo():
    cubes = []
    for (x, y, z, w, h, dd) in EGG:
        cubes.append({"origin": [x, y, z], "size": [w, h, dd],
                      "uv": {f: {"uv": [0, 0], "uv_size": [8, 8]} for f in ("north", "south", "east", "west", "up", "down")}})
    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {"identifier": "geometry.fairy_egg", "texture_width": 16, "texture_height": 16,
                            "visible_bounds_width": 1.5, "visible_bounds_height": 1.5, "visible_bounds_offset": [0, 0.5, 0]},
            "bones": [{"name": "egg", "pivot": [0, 0, 0], "cubes": cubes}],
        }],
    }


SPOTS = [(255, 150, 200), (150, 200, 255), (255, 226, 110), (190, 150, 255), (140, 225, 170)]


def egg_texture():
    tex = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)
    d.rectangle([0, 0, 7, 7], fill=(255, 248, 236, 255))
    for i, (x, y) in enumerate([(1, 1), (5, 2), (2, 5), (6, 6), (4, 4)]):
        tex.putpixel((x, y), SPOTS[i] + (255,))
        tex.putpixel((x + 1 if x < 7 else x, y), SPOTS[i] + (255,))
    return tex


def egg_icon():
    tex = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    for x in range(16):
        for y in range(16):
            nx, ny = (x + 0.5 - 8) / 5.6, (y + 0.5 - 9) / 6.8
            if ny < 0:
                nx *= 1.12
            if nx * nx + ny * ny <= 1:
                shade = 255 if nx < 0.35 else 232
                tex.putpixel((x, y), (shade, shade - 6, shade - 18, 255))
    rnd = random.Random(7)
    for i, (x, y) in enumerate([(6, 5), (9, 8), (5, 11), (10, 12), (7, 14), (9, 3)]):
        if tex.getpixel((x, y))[3]:
            tex.putpixel((x, y), SPOTS[i % len(SPOTS)] + (255,))
    for x, y in [(2, 2), (13, 4), (12, 1)]:
        tex.putpixel((x, y), (255, 240, 120, 255))
    # Outline
    out = tex.copy()
    for x in range(16):
        for y in range(16):
            if tex.getpixel((x, y))[3] == 0 and any(
                    0 <= x + a < 16 and 0 <= y + c < 16 and tex.getpixel((x + a, y + c))[3] and tex.getpixel((x + a, y + c))[:3] != (255, 240, 120)
                    for a, c in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                out.putpixel((x, y), (120, 90, 140, 255))
    return out


# ---------------- Fairy house (a one-block mushroom cottage) ----------------
CREAM, WOOD, CAP, SPOT, GILL = (246, 232, 204), (150, 96, 56), (232, 72, 96), (255, 246, 240), (226, 206, 176)
HOUSE_UV = {
    "door": (0, 0, 10, 9), "window": (16, 0, 10, 9), "cream": (32, 0, 8, 8), "stone": (40, 0, 8, 8),
    "cap_side": (0, 12, 16, 4), "cap_top": (0, 20, 16, 16), "cap_under": (16, 20, 16, 16),
}
HOUSE = [
    # origin, size, {face: region}
    ((-5, 0, -5), (10, 9, 10), {"north": "door", "south": "window", "east": "window", "west": "window", "up": "cream", "down": "cream"}),
    ((-8, 9, -8), (16, 4, 16), {"north": "cap_side", "south": "cap_side", "east": "cap_side", "west": "cap_side", "up": "cap_top", "down": "cap_under"}),
    ((-6, 13, -6), (12, 2, 12), {f: "cap_side" for f in ("north", "south", "east", "west")} | {"up": "cap_top", "down": "cap_under"}),
    ((-3.5, 15, -3.5), (7, 1, 7), {f: "cap_top" for f in ("north", "south", "east", "west", "up", "down")}),
    ((-2, 0, -7), (4, 1, 2), {f: "stone" for f in ("north", "south", "east", "west", "up", "down")}),
]


def house_geo():
    cubes = []
    for o, s, faces in HOUSE:
        uv = {}
        for f, region in faces.items():
            u, v, w, h = HOUSE_UV[region]
            uv[f] = {"uv": [u, v], "uv_size": [w, h]}
        cubes.append({"origin": list(o), "size": list(s), "uv": uv})
    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {"identifier": "geometry.fairy_house", "texture_width": 64, "texture_height": 64},
            "bones": [{"name": "house", "pivot": [0, 0, 0], "cubes": cubes}],
        }],
    }


def house_texture(lit):
    glass = (255, 222, 120) if lit else (64, 76, 118)
    tex = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)

    def region(name, col):
        u, v, w, h = HOUSE_UV[name]
        d.rectangle([u, v, u + w - 1, v + h - 1], fill=col + (255,))
        return u, v, w, h

    # Front wall with a rounded door, a little window in it, and a gold knob.
    u, v, w, h = region("door", CREAM)
    for x in range(3, 7):
        for y in range(2, 9):
            if y == 2 and x in (3, 6):
                continue
            tex.putpixel((u + x, v + y), WOOD + (255,))
    for x in (4, 5):
        tex.putpixel((u + x, v + 3), glass + (255,))
    tex.putpixel((u + 5, v + 6), (242, 190, 44, 255))
    for x, y in [(1, 7), (8, 7), (1, 8), (8, 8)]:
        tex.putpixel((u + x, v + y), (110, 190, 90, 255))  # little plants by the door
    tex.putpixel((u + 1, v + 6), (255, 140, 190, 255)); tex.putpixel((u + 8, v + 6), (255, 220, 90, 255))
    # Side walls with a round window.
    u, v, w, h = region("window", CREAM)
    for x in range(3, 7):
        for y in range(2, 6):
            corner = (x in (3, 6)) and (y in (2, 5))
            if corner:
                continue
            edge = x in (3, 6) or y in (2, 5)
            tex.putpixel((u + x, v + y), (WOOD if edge else glass) + (255,))
    tex.putpixel((u + 2, v + 7), (110, 190, 90, 255)); tex.putpixel((u + 7, v + 7), (110, 190, 90, 255))
    region("cream", CREAM)
    u, v, w, h = region("stone", (170, 170, 176))
    for x, y in [(1, 1), (5, 2), (2, 5), (6, 6)]:
        tex.putpixel((u + x, v + y), (140, 140, 148, 255))
    # Toadstool cap: red with white spots, gills underneath.
    u, v, w, h = region("cap_side", CAP)
    for x in (2, 7, 12):
        tex.putpixel((u + x, v + 1), SPOT + (255,)); tex.putpixel((u + x + 1, v + 1), SPOT + (255,))
        tex.putpixel((u + x, v + 2), SPOT + (255,))
    u, v, w, h = region("cap_top", CAP)
    for cx, cy, r in [(4, 4, 1.6), (11, 3, 1.2), (8, 9, 1.8), (3, 12, 1.2), (13, 12, 1.5)]:
        for x in range(16):
            for y in range(16):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    tex.putpixel((u + x, v + y), SPOT + (255,))
    u, v, w, h = region("cap_under", GILL)
    for x in range(0, 16, 2):
        d.line([u + x, v, u + x, v + h - 1], fill=(206, 182, 150, 255))
    return tex


def dust_texture():
    tex = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    for x, y, a in [(3, 3, 255), (4, 3, 255), (3, 4, 255), (4, 4, 255), (3, 1, 200), (3, 2, 230), (3, 5, 230), (3, 6, 200),
                    (1, 3, 200), (2, 3, 230), (5, 3, 230), (6, 3, 200), (4, 2, 160), (4, 5, 160), (2, 4, 160), (5, 4, 160)]:
        tex.putpixel((x, y), (255, 255, 255, a))
    return tex


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

    save_json("models/entity/fairy.geo.json", fairy_geo())
    for i, c in enumerate(COLORS):
        save_png(f"textures/entity/fairy/fairy_{c[0]}.png", fairy_texture(i))
    save_json("models/entity/fairy_egg.geo.json", egg_geo())
    save_png("textures/entity/fairy_egg.png", egg_texture())
    save_png("textures/items/fairy_egg.png", egg_icon())
    save_json("models/blocks/fairy_house.geo.json", house_geo())
    save_png("textures/blocks/fairy_house.png", house_texture(False))
    save_png("textures/blocks/fairy_house_lit.png", house_texture(True))
    save_png("textures/particle/fairy_dust.png", dust_texture())
    print(f"fairy: {sum(len(v) for v in bones.values())} cubes, {len(COLORS)} textures; house: {len(HOUSE)} cubes")


# ---------------- Preview ----------------
def cube_faces(x, y, z, w, h, dd):
    X, Y, Z = [x, x + w], [z, z + dd], [y, y + h]  # plot axes: X = model x, Y = model z, Z = up
    return [
        [(X[0], Y[0], Z[0]), (X[1], Y[0], Z[0]), (X[1], Y[1], Z[0]), (X[0], Y[1], Z[0])],
        [(X[0], Y[0], Z[1]), (X[1], Y[0], Z[1]), (X[1], Y[1], Z[1]), (X[0], Y[1], Z[1])],
        [(X[0], Y[0], Z[0]), (X[1], Y[0], Z[0]), (X[1], Y[0], Z[1]), (X[0], Y[0], Z[1])],
        [(X[0], Y[1], Z[0]), (X[1], Y[1], Z[0]), (X[1], Y[1], Z[1]), (X[0], Y[1], Z[1])],
        [(X[0], Y[0], Z[0]), (X[0], Y[1], Z[0]), (X[0], Y[1], Z[1]), (X[0], Y[0], Z[1])],
        [(X[1], Y[0], Z[0]), (X[1], Y[1], Z[0]), (X[1], Y[1], Z[1]), (X[1], Y[0], Z[1])],
    ]


def render_preview(path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    fig = plt.figure(figsize=(12, 5), dpi=110)
    bg = (0.98, 0.95, 1.0)
    fig.patch.set_facecolor(bg)
    shows = [("Pink girl fairy", 0, "girl"), ("Blue boy fairy", 6, "boy"), ("Rainbow girl fairy", 8, "girl"),
             ("Green boy fairy", 4, "boy"), ("Fairy house", None, "house"), ("Fairy egg", None, "egg")]
    for k, (title, idx, kind) in enumerate(shows):
        ax = fig.add_subplot(1, len(shows), k + 1, projection="3d")
        ax.set_facecolor(bg)
        polys, cols = [], []
        if kind in ("girl", "boy"):
            tex = fairy_texture(idx).convert("RGBA")
            # Paint faces pixel by pixel on the front of the head; everything else uses the swatch's middle color.
            for bone in (kind, "wing_l", "wing_r"):
                for c in bones[bone]:
                    (x, y, z), (w, h, dd) = c["o"], c["s"]
                    if c["c"] in WING_UV:
                        u, v, ww, hh = WING_UV[c["c"]]
                        for px in range(ww):
                            for py in range(hh):
                                p = tex.getpixel((u + (ww - 1 - px if bone == "wing_r" else px), v + py))
                                if p[3] == 0:
                                    continue
                                X0 = x + px * w / ww
                                Z0 = y + h - (py + 1) * h / hh
                                # Wings splay backward a little, like they do mid-flap.
                                sgn = -1 if bone == "wing_l" else 1
                                t0 = abs(X0 - (x if bone == "wing_r" else x + w))
                                t1 = abs(X0 + w / ww - (x if bone == "wing_r" else x + w))
                                polys.append([(X0, z + t0 * 0.35, Z0), (X0 + w / ww, z + t1 * 0.35, Z0),
                                              (X0 + w / ww, z + t1 * 0.35, Z0 + h / hh), (X0, z + t0 * 0.35, Z0 + h / hh)])
                                cols.append(tuple(q / 255 for q in p[:3]) + (min(1, p[3] / 255 + 0.15),))
                        continue
                    faces = cube_faces(x, y, z, w, h, dd)
                    for fi, f in enumerate(faces):
                        if fi == 2 and c["front"]:
                            fu, fv = FACE_UV[c["front"]]
                            for px in range(10):
                                for py in range(10):
                                    p = tex.getpixel((fu + px, fv + py))
                                    X0 = x + w - (px + 1) * w / 10
                                    Z0 = y + h - (py + 1) * h / 10
                                    polys.append([(X0, z - 0.01, Z0), (X0 + w / 10, z - 0.01, Z0), (X0 + w / 10, z - 0.01, Z0 + h / 10), (X0, z - 0.01, Z0 + h / 10)])
                                    cols.append(tuple(q / 255 for q in p[:3]) + (1,))
                            continue
                        (su, sv), _ = sw_uv(c["c"])
                        p = tex.getpixel((su + (fi * 2 + 1) % 8, sv + (fi + 3) % 8))
                        polys.append(f)
                        cols.append(tuple(q / 255 for q in p[:3]) + (1,))
            lim = ((-16, 16), (-16, 16), (0, 36))
        elif kind == "house":
            tex = house_texture(True)
            for o, s, faces in HOUSE:
                fs = cube_faces(*o, *s)
                names = ["down", "up", "north", "south", "west", "east"]
                for fi, f in enumerate(fs):
                    region = faces.get(names[fi])
                    u, v, w, h = HOUSE_UV[region]
                    if names[fi] == "north" and region == "door":
                        x, y, z = o
                        for px in range(w):
                            for py in range(h):
                                p = tex.getpixel((u + px, v + py))
                                X0 = x + px * s[0] / w
                                Z0 = y + s[1] - (py + 1) * s[1] / h
                                polys.append([(X0, z - 0.01, Z0), (X0 + s[0] / w, z - 0.01, Z0), (X0 + s[0] / w, z - 0.01, Z0 + s[1] / h), (X0, z - 0.01, Z0 + s[1] / h)])
                                cols.append(tuple(q / 255 for q in p[:3]) + (1,))
                        continue
                    p = tex.getpixel((u, v + h - 1))
                    polys.append(f)
                    cols.append(tuple(q / 255 for q in p[:3]) + (1,))
            # spots on top of the cap for the preview
            for cx, cz in [(-4, -4), (3, -5), (0, 1), (-5, 4), (5, 4)]:
                polys.append([(cx, cz, 13.02), (cx + 2, cz, 13.02), (cx + 2, cz + 2, 13.02), (cx, cz + 2, 13.02)])
                cols.append((1, 0.96, 0.94, 1))
            lim = ((-9, 9), (-9, 9), (0, 18))
        else:
            for (x, y, z, w, h, dd) in EGG:
                for f in cube_faces(x, y, z, w, h, dd):
                    polys.append(f)
                    cols.append((1, 0.97, 0.92, 1))
            for i, (sx, sy) in enumerate([(-2, 2), (1, 4), (-1, 6), (2, 1.5)]):
                polys.append([(sx, -4.02, sy), (sx + 1.2, -4.02, sy), (sx + 1.2, -4.02, sy + 1.2), (sx, -4.02, sy + 1.2)])
                cols.append(tuple(q / 255 for q in SPOTS[i]) + (1,))
            lim = ((-6, 6), (-6, 6), (0, 12))
        pc = Poly3DCollection(polys, facecolors=cols, edgecolors=(0, 0, 0, 0.12), linewidths=0.15)
        ax.add_collection3d(pc)
        ax.set_xlim(*lim[0]); ax.set_ylim(*lim[1]); ax.set_zlim(*lim[2])
        ax.set_box_aspect((lim[0][1] - lim[0][0], lim[1][1] - lim[1][0], lim[2][1] - lim[2][0]))
        ax.view_init(elev=12, azim=-62)
        ax.axis("off")
        ax.set_title(title, fontsize=11, color=(0.35, 0.2, 0.45), y=0.98)
    plt.subplots_adjust(left=0, right=1, top=0.95, bottom=0, wspace=0)
    plt.savefig(path, facecolor=bg)


if __name__ == "__main__":
    write_pack(sys.argv[1])
    if len(sys.argv) > 2:
        render_preview(sys.argv[2])
