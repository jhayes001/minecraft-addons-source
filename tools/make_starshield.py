"""Builds the models and textures for the Star Shield add-on, and optionally preview pictures.

Star Shield is a three-girl K-pop group who secretly protect the world from goofy shadow demons (Grumbles)
with their songs. All three share one model (`geometry.star_idol`); which girl it is is the entity
`variant` (0-2), and the render controller shows that girl's hair, skirt and weapon bones:

  0 Sora   the brave leader: short mint-green bob with a gold star clip, white-and-gold stage jacket,
           pleated skirt, microphone staff
  1 Dalia  the jokester: bright orange high ponytail, red sporty jacket with white stripes, navy shorts,
           high socks and sneakers, a drumstick in each hand
  2 Yuna   the gentle one: long silver-white hair with sky-blue tips and a big blue bow, a sparkly cropped
           stage jacket, layered mini skirt, tall white stage boots, a headset mic, a ribbon fan

Writes into the resource pack:
  models/entity/star_idol.geo.json            the girls (hair/outfit/weapon bones picked per variant)
  textures/entity/star_idol_<0-2>.png         one texture per girl
  models/entity/grumble.geo.json              a Grumble: a round, grumpy shadow blob with googly eyes
  textures/entity/grumble.png
  models/blocks/concert_stage.geo.json        the one-block Concert Stage
  textures/blocks/concert_stage.png
  textures/items/lightstick.png, star_shard.png
And pack_icon.png into the resource pack and the behavior pack next to it (when making a preview).

Units are pixels, feet at y = 0, facing north (-Z). The girls are about 32 pixels tall and shrunk in game
with minecraft:scale 0.75 (about 1.5 blocks). Every face is painted from an 8x8 swatch, except the front
of the head (the face) and the Grumble's front. Positive x rotation tips the top of a bone forward.

Usage: python3 make_starshield.py <resource_pack_dir> [preview.png] [closeup.png]
"""
import json, math, os, sys
from PIL import Image, ImageDraw

# Index = the entity's variant number. Keep in sync with IDOLS in main.js.
GIRLS = [
    {   # Sora
        "name": "Sora",
        "hair": (120, 222, 196), "hair_dark": (78, 176, 152), "hair_tip": (120, 222, 196),
        "top": (250, 250, 246), "top_trim": (240, 190, 60), "sleeve": (250, 250, 246),
        "bottom": (244, 206, 96), "bottom_dark": (214, 168, 60), "leg": (246, 214, 186),
        "shoe": (250, 250, 246), "shoe_dark": (232, 180, 60), "eye": (214, 140, 40), "accent": (240, 190, 60),
    },
    {   # Dalia
        "name": "Dalia",
        "hair": (255, 140, 40), "hair_dark": (222, 98, 20), "hair_tip": (255, 140, 40),
        "top": (226, 52, 60), "top_trim": (252, 252, 252), "sleeve": (226, 52, 60),
        "bottom": (44, 60, 120), "bottom_dark": (30, 42, 92), "leg": (252, 252, 252),
        "shoe": (252, 252, 252), "shoe_dark": (226, 52, 60), "eye": (70, 170, 80), "accent": (252, 220, 60),
    },
    {   # Yuna
        "name": "Yuna",
        "hair": (236, 238, 246), "hair_dark": (204, 208, 226), "hair_tip": (120, 190, 246),
        "top": (110, 170, 246), "top_trim": (226, 232, 246), "sleeve": (110, 170, 246),
        "bottom": (236, 242, 255), "bottom_dark": (150, 196, 250), "leg": (248, 216, 190),
        "shoe": (250, 250, 255), "shoe_dark": (110, 170, 246), "eye": (70, 120, 220), "accent": (110, 170, 246),
    },
]
SKIN = (248, 216, 190)
WHITE = (252, 252, 252)
GOLD = (246, 196, 56)

SW = ["skin", "hair", "hair_dark", "hair_tip", "top", "top_trim", "sleeve", "bottom", "bottom_dark", "leg",
      "shoe", "shoe_dark", "gold", "white", "mic", "stick", "stick_glow", "fan", "fan_rib", "ribbon", "accent", "flower"]
FACE = (0, 40, 10, 10)
REGIONS = {"face": FACE}
TEX_W, TEX_H = 128, 64


def sw_uv(name):
    if name in REGIONS:
        u, v, w, h = REGIONS[name]
        return [u, v], [w, h]
    i = SW.index(name)
    return [(i % 16) * 8, (i // 16) * 8], [8, 8]


BONE_ORDER = ["body", "head", "hair_bob", "hair_pony", "ponytail", "hair_long", "arm_l", "arm_r",
              "leg_l", "leg_r", "skirt_short", "shorts", "skirt_layered", "bow", "boot_l", "boot_r", "headset",
              "mic_staff", "stick_l", "stick_r", "fan"]
PARENT = {"head": "body", "hair_bob": "head", "hair_pony": "head", "ponytail": "hair_pony", "hair_long": "head",
          "arm_l": "body", "arm_r": "body", "skirt_short": "body", "shorts": "body", "skirt_layered": "body",
          "bow": "body", "boot_l": "leg_l", "boot_r": "leg_r", "headset": "head", "mic_staff": "arm_r", "stick_l": "arm_l", "stick_r": "arm_r", "fan": "arm_r"}
PIVOTS = {
    "body": [0, 11, 0], "head": [0, 21, 0], "hair_bob": [0, 21, 0], "hair_pony": [0, 21, 0],
    "ponytail": [0, 31, 6], "hair_long": [0, 21, 0],
    "arm_l": [-4.5, 20.5, 0], "arm_r": [4.5, 20.5, 0], "leg_l": [-1.75, 11, 0], "leg_r": [1.75, 11, 0],
    "skirt_short": [0, 11, 0], "shorts": [0, 11, 0], "skirt_layered": [0, 11, 0], "bow": [0, 18, -2],
    "boot_l": [-1.75, 11, 0], "boot_r": [1.75, 11, 0], "headset": [0, 21, 0],
    "mic_staff": [4.5, 20.5, 0], "stick_l": [-4.5, 20.5, 0], "stick_r": [4.5, 20.5, 0], "fan": [4.5, 20.5, 0],
}
ROTATION = {"ponytail": 0}
# Which bones belong to which girl (everything else is shared). Keep in sync with the render controller.
ONLY = {
    0: {"hair_bob", "skirt_short", "mic_staff"},
    1: {"hair_pony", "ponytail", "shorts", "stick_l", "stick_r"},
    2: {"hair_long", "skirt_layered", "bow", "boot_l", "boot_r", "headset", "fan"},
}
bones = {b: [] for b in BONE_ORDER}


def box(bone, x, y, z, w, h, d, color, faces=None):
    bones[bone].append({"o": (x, y, z), "s": (w, h, d), "c": color, "faces": faces or {}})


# ---------- The girls ----------
for bone, s in (("leg_l", -1), ("leg_r", 1)):
    x0 = 0.5 if s > 0 else -3.0
    box(bone, x0, 3, -1.25, 2.5, 8.5, 2.5, "leg")                           # legs (socks / tights)
    box(bone, x0 - 0.25, 0, -1.6, 3.0, 3.2, 3.1, "shoe")                    # boots / sneakers
    box(bone, x0 - 0.3, 0, -1.7, 3.1, 0.8, 3.3, "shoe_dark")               # sole
    box(bone, x0 - 0.3, 3.0, -1.5, 3.1, 0.8, 3.0, "shoe_dark")             # cuff

box("body", -3.5, 13, -2, 7, 8, 4, "top")                                  # stage jacket
box("body", -3.6, 20.2, -2.1, 7.2, 0.9, 4.2, "top_trim")                   # collar
box("body", -0.5, 13.2, -2.15, 1, 7, 0.2, "top_trim")                      # zip / front trim
box("body", -3.6, 13, -2.1, 7.2, 0.8, 4.2, "top_trim")                     # hem
box("body", -3.2, 11, -1.8, 6.4, 2.2, 3.6, "bottom_dark")                  # hips (under the skirt)

box("head", -5, 21, -5, 10, 10, 10, "skin", {"north": "face"})             # head

# Sora: short bob, the ends flicking out a little, a gold star clip on the right
box("hair_bob", -5.5, 29, -5.5, 11, 3, 11, "hair")
box("hair_bob", -5.6, 23.5, -5.2, 0.6, 6, 10.7, "hair"); box("hair_bob", 5.0, 23.5, -5.2, 0.6, 6, 10.7, "hair")
box("hair_bob", -5.5, 22.5, 5.0, 11, 7, 0.6, "hair")
box("hair_bob", -6.0, 22.5, -4.5, 0.8, 1.6, 10.5, "hair_dark"); box("hair_bob", 5.2, 22.5, -4.5, 0.8, 1.6, 10.5, "hair_dark")
box("hair_bob", -5.0, 22.0, 5.3, 10, 1.6, 0.8, "hair_dark")
box("hair_bob", 5.5, 27, -3.5, 0.6, 2.0, 2.0, "gold")                      # star clip
box("hair_bob", 5.6, 27.6, -4.1, 0.5, 0.8, 3.2, "gold"); box("hair_bob", 5.6, 26.4, -3.0, 0.5, 3.2, 1.0, "gold")

# Dalia: hair pulled up into a high bouncy ponytail with a yellow scrunchie
box("hair_pony", -5.5, 29, -5.5, 11, 3, 11, "hair")
box("hair_pony", -5.6, 26, -5.2, 0.6, 3.5, 10.7, "hair"); box("hair_pony", 5.0, 26, -5.2, 0.6, 3.5, 10.7, "hair")
box("hair_pony", -5.5, 24.5, 5.0, 11, 5, 0.6, "hair")
box("hair_pony", -1.8, 29.5, 4.8, 3.6, 2.4, 1.6, "accent")                 # scrunchie at the back of the crown
box("ponytail", -1.6, 29.0, 6.2, 3.2, 3.2, 2.6, "hair")                    # high pony, falling down the back
box("ponytail", -1.4, 24.5, 6.8, 2.8, 4.5, 2.4, "hair")
box("ponytail", -1.0, 21.5, 7.2, 2.0, 3.0, 1.8, "hair_dark")

# Yuna: long straight hair to her waist with sky-blue tips, a big blue bow at the back
box("hair_long", -5.5, 29, -5.5, 11, 3, 11, "hair")
box("hair_long", -5.6, 20, -5.2, 0.6, 9.5, 10.7, "hair"); box("hair_long", 5.0, 20, -5.2, 0.6, 9.5, 10.7, "hair")
box("hair_long", -5.6, 16.5, -5.2, 0.6, 3.5, 3.0, "hair_tip"); box("hair_long", 5.0, 16.5, -5.2, 0.6, 3.5, 3.0, "hair_tip")
box("hair_long", -5.5, 15, 5.0, 11, 14.5, 0.9, "hair")
box("hair_long", -5.0, 11.5, 5.2, 10, 3.5, 0.9, "hair_tip")
box("hair_long", -1.0, 28.0, 5.3, 2.0, 2.0, 1.4, "accent")                 # big bow: knot...
box("hair_long", -4.6, 27.0, 5.5, 3.6, 4.0, 1.0, "accent")                 # ...and loops
box("hair_long", 1.0, 27.0, 5.5, 3.6, 4.0, 1.0, "accent")
box("hair_long", -2.2, 23.5, 5.7, 1.2, 4.0, 0.6, "accent"); box("hair_long", 1.0, 23.5, 5.7, 1.2, 4.0, 0.6, "accent")

for bone, s in (("arm_l", -1), ("arm_r", 1)):
    x0 = 3.5 if s > 0 else -5.5
    box(bone, x0, 15, -1, 2, 6, 2, "sleeve")                               # sleeve
    box(bone, x0 - 0.1, 14.4, -1.1, 2.2, 0.8, 2.2, "top_trim")             # cuff
    box(bone, x0 + 0.1, 12, -0.9, 1.8, 2.5, 1.8, "skin")                   # forearm + hand

box("skirt_short", -4.2, 10, -2.7, 8.4, 3.6, 5.4, "bottom")               # pleated skirt
box("skirt_short", -4.4, 10, -2.9, 8.8, 0.9, 5.8, "bottom_dark")
box("shorts", -3.5, 9.5, -2.1, 7, 3.6, 4.2, "bottom")                     # sporty shorts
box("shorts", -3.6, 9.5, -2.2, 7.2, 0.7, 4.4, "top_trim")
box("skirt_layered", -4.0, 10.6, -2.6, 8.0, 2.6, 5.2, "bottom")            # layered stage skirt (tiers)
box("skirt_layered", -4.6, 9.6, -3.1, 9.2, 1.4, 6.2, "bottom_dark")
box("skirt_layered", -5.0, 8.8, -3.5, 10.0, 1.0, 7.0, "bottom")
box("bow", -2.0, 19.8, -2.3, 4, 0.8, 0.3, "top_trim")                      # silver choker-style collar charm
box("bow", -0.5, 18.8, -2.4, 1, 1, 0.4, "gold")
for bone, x0 in (("boot_l", -3.0), ("boot_r", 0.5)):                       # tall white stage boots
    box(bone, x0 - 0.3, 0, -1.7, 3.1, 8.0, 3.2, "shoe")
    box(bone, x0 - 0.35, 7.6, -1.75, 3.2, 0.8, 3.3, "shoe_dark")
    box(bone, x0 - 0.35, 0, -1.8, 3.2, 0.8, 3.4, "shoe_dark")
box("headset", 5.0, 24.0, -1.2, 0.8, 3.0, 2.4, "shoe_dark")                # headset ear piece...
box("headset", 5.2, 24.4, -4.6, 0.5, 0.5, 3.6, "top_trim")                 # ...and the little mic arm
box("headset", 3.6, 24.2, -5.4, 1.8, 0.9, 0.9, "top_trim")

# Weapons, held in the right hand (around x 4.5, y 12.5) unless it's a pair.
box("mic_staff", 4.0, 2, -2.2, 1, 22, 1, "white")                          # staff through the hand
box("mic_staff", 3.6, 23.5, -2.6, 1.8, 0.8, 1.8, "gold")
box("mic_staff", 3.2, 24.3, -3.0, 2.6, 2.6, 2.6, "mic")                    # glowing mic head
box("mic_staff", 3.8, 1.2, -2.0, 1.4, 0.8, 0.6, "gold")
for bone, x in (("stick_l", -4.5), ("stick_r", 4.5)):
    box(bone, x - 0.5, 12.5, -8, 1, 1, 7.5, "stick")                       # drumstick pointing forward
    box(bone, x - 0.7, 12.3, -9.2, 1.4, 1.4, 1.4, "stick_glow")            # glowing tip
box("fan", 4.0, 12.4, -2.0, 1, 3, 1, "fan_rib")                            # fan handle
box("fan", 1.0, 15.2, -2.0, 7, 3.0, 0.5, "fan")                            # open fan
box("fan", 2.0, 18.2, -2.0, 5, 1.2, 0.5, "fan")
box("fan", 4.3, 9.0, -1.8, 0.5, 3.5, 0.5, "ribbon")                        # ribbon hanging off it
box("fan", 4.3, 6.5, -1.3, 0.5, 2.5, 0.5, "ribbon")

FACES = ("north", "south", "east", "west", "up", "down")


def cubes_json(cubelist, regions_uv):
    out = []
    for c in cubelist:
        uv = {}
        for f in FACES:
            pos, size = regions_uv(c["faces"].get(f, c["c"]))
            uv[f] = {"uv": pos, "uv_size": size}
        out.append({"origin": [round(v, 3) for v in c["o"]], "size": [round(v, 3) for v in c["s"]], "uv": uv})
    return out


def idol_geo():
    out = [{"name": "root", "pivot": [0, 0, 0]}]
    for name in BONE_ORDER:
        bone = {"name": name, "parent": PARENT.get(name, "root"), "pivot": PIVOTS[name], "cubes": cubes_json(bones[name], sw_uv)}
        if ROTATION.get(name):
            bone["rotation"] = [ROTATION[name], 0, 0]
        out.append(bone)
    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": "geometry.star_idol", "texture_width": TEX_W, "texture_height": TEX_H,
                "visible_bounds_width": 2, "visible_bounds_height": 3, "visible_bounds_offset": [0, 1.25, 0],
            },
            "bones": out,
        }],
    }


def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


def idol_texture(i):
    g = GIRLS[i]
    tex = Image.new("RGBA", (TEX_W, TEX_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)
    put = lambda x, y, c: tex.putpixel((x, y), tuple(c[:3]) + (255,))

    def fill(sw, col):
        (x, y), _ = sw_uv(sw)
        d.rectangle([x, y, x + 7, y + 7], fill=tuple(col) + (255,))
        return x, y

    fill("skin", SKIN)
    x, y = fill("hair", g["hair"])
    for k in range(0, 8, 2):                                                 # strands
        d.line([x + k, y, x + k, y + 7], fill=shade(g["hair"], 0.92) + (255,))
    for k in (1, 5):
        put(x + k, y + 1, shade(g["hair"], 1.15))                           # shine
    fill("hair_dark", g["hair_dark"])
    x, y = fill("hair_tip", g["hair_tip"])
    for k in range(0, 8, 2):
        d.line([x + k, y, x + k, y + 2], fill=g["hair"] + (255,))           # tips fade in from the hair color
    x, y = fill("top", g["top"])
    if i == 1:                                                               # Dalia: white sporty stripes
        for k in (1, 6):
            d.line([x + k, y, x + k, y + 7], fill=WHITE + (255,))
    if i == 2:                                                               # Yuna: sequin sparkles
        for px, py in [(1, 1), (5, 2), (3, 4), (6, 6), (1, 6)]:
            put(x + px, y + py, (226, 240, 255))
    if i == 0:                                                               # Sora: gold buttons
        for k in (2, 5):
            put(x + 2, y + k, GOLD); put(x + 5, y + k, GOLD)
    fill("top_trim", g["top_trim"])
    x, y = fill("sleeve", g["sleeve"])
    if i == 1:
        d.line([x + 3, y, x + 3, y + 7], fill=WHITE + (255,)); d.line([x + 4, y, x + 4, y + 7], fill=WHITE + (255,))
    x, y = fill("bottom", g["bottom"])
    if i == 0:                                                               # pleats
        for k in range(1, 8, 2):
            d.line([x + k, y, x + k, y + 7], fill=g["bottom_dark"] + (255,))
    if i == 2:                                                               # soft ruffles
        for k in range(0, 8, 2):
            put(x + k, y + 7, g["bottom_dark"])
    fill("bottom_dark", g["bottom_dark"])
    x, y = fill("leg", g["leg"])
    if i == 1:
        d.line([x, y + 1, x + 7, y + 1], fill=g["top"] + (255,))             # stripe at the top of the socks
    x, y = fill("shoe", g["shoe"])
    fill("shoe_dark", g["shoe_dark"])
    x, y = fill("gold", GOLD)
    put(x + 2, y + 2, (255, 236, 140))
    fill("white", WHITE)
    x, y = fill("mic", (214, 240, 232))
    for px in range(0, 8, 2):
        for py in range(0, 8, 2):
            put(x + px, y + py, (150, 226, 206))                             # mic mesh, glowing mint
    x, y = fill("stick", (240, 214, 170))
    x, y = fill("stick_glow", (255, 220, 70))
    put(x + 3, y + 3, (255, 255, 210))
    x, y = fill("fan", (236, 244, 255))
    for k in range(0, 8, 2):
        d.line([x + k, y, x + 3, y + 7], fill=(150, 196, 246, 255))         # fan ribs
    d.line([x, y, x + 7, y], fill=(120, 176, 236, 255))
    fill("fan_rib", (176, 130, 90))
    fill("ribbon", (200, 226, 255) if i == 2 else g["accent"])
    fill("accent", g["accent"])
    x, y = fill("flower", (250, 160, 196))
    put(x + 3, y + 3, (255, 230, 120)); put(x + 4, y + 4, (255, 230, 120))

    # Face (10x10): bangs along the top, big sparkly eyes, rosy cheeks, each girl's own smile.
    fx, fy, fw, fh = FACE
    d.rectangle([fx, fy, fx + fw - 1, fy + fh - 1], fill=SKIN + (255,))
    hair, dark = g["hair"], g["hair_dark"]
    bangs = {0: [2, 2, 1, 2, 2, 1, 2, 2, 2, 2],     # Sora: full straight bangs, one flick
             1: [2, 1, 1, 1, 0, 1, 1, 1, 1, 2],     # Dalia: swept back, a little forehead showing
             2: [3, 2, 2, 1, 1, 2, 2, 2, 3, 3]}[i]  # Yuna: soft side-swept bangs
    for col, n in enumerate(bangs):
        for row in range(n):
            put(fx + col, fy + row, hair if row < n - 1 else dark)
    eye, lash = g["eye"], (46, 36, 52)
    for ex in (1, 6):
        if i == 1:
            put(fx + ex, fy + 3, shade(dark, 0.8)); put(fx + ex + 2 - 1, fy + 2, shade(dark, 0.8))   # Dalia: cheeky raised brows
        else:
            put(fx + ex, fy + 3, shade(dark, 0.8)); put(fx + ex + 1, fy + 3, shade(dark, 0.8))
        put(fx + ex, fy + 4, lash); put(fx + ex + 1, fy + 4, lash)                                  # lash line
        put(fx + ex, fy + 5, eye); put(fx + ex + 1, fy + 5, shade(eye, 0.75))
        put(fx + ex, fy + 6, shade(eye, 1.2)); put(fx + ex + 1, fy + 6, eye)
        put(fx + ex, fy + 5, (255, 255, 255))                                                       # sparkle
    for px in (0, 9):
        put(fx + px, fy + 7, (246, 160, 160))                                                       # rosy cheeks
    put(fx + 1, fy + 7, (250, 186, 176)); put(fx + 8, fy + 7, (250, 186, 176))
    mouth = (196, 90, 96)
    if i == 0:                                   # Sora: a big confident smile
        put(fx + 3, fy + 8, mouth); put(fx + 6, fy + 8, mouth)
        for px in (4, 5):
            put(fx + px, fy + 9, mouth)
    elif i == 1:                                 # Dalia: wide open goofy grin
        for px in (3, 4, 5, 6):
            put(fx + px, fy + 8, mouth)
        put(fx + 4, fy + 9, (240, 120, 130)); put(fx + 5, fy + 9, (240, 120, 130))
    else:                                        # Yuna: small shy smile
        put(fx + 4, fy + 8, mouth); put(fx + 5, fy + 8, mouth)
    return tex


# ---------- Grumble ----------
GR_SW = ["gr_body", "gr_belly", "gr_horn", "gr_foot", "gr_arm", "gr_gold", "gr_gem"]
GR_FRONT = (0, 16, 12, 9)
GR_W, GR_H = 64, 32


def gr_uv(name):
    if name == "gr_front":
        u, v, w, h = GR_FRONT
        return [u, v], [w, h]
    i = GR_SW.index(name)
    return [i * 8, 0], [8, 8]


GR_BONES = {"gbody": [], "horns": [], "crown": [], "gfoot_l": [], "gfoot_r": [], "garm_l": [], "garm_r": []}
GR_PARENT = {"horns": "gbody", "crown": "gbody", "garm_l": "gbody", "garm_r": "gbody"}
GR_PIVOT = {"gbody": [0, 2, 0], "horns": [0, 11, 0], "crown": [0, 12.5, 0], "gfoot_l": [-2.5, 2, 0], "gfoot_r": [2.5, 2, 0],
            "garm_l": [-6, 7, 0], "garm_r": [6, 7, 0]}


def gbox(bone, x, y, z, w, h, d, color, faces=None):
    GR_BONES[bone].append({"o": (x, y, z), "s": (w, h, d), "c": color, "faces": faces or {}})


gbox("gbody", -6, 2, -5, 12, 9, 10, "gr_body", {"north": "gr_front"})
gbox("gbody", -5, 11, -4, 10, 1.5, 8, "gr_body")                            # rounded top
gbox("horns", -4.5, 12.5, -1, 1.5, 2.5, 1.5, "gr_horn"); gbox("horns", 3, 12.5, -1, 1.5, 2.5, 1.5, "gr_horn")
gbox("horns", -4.2, 15, -0.7, 0.9, 1.2, 0.9, "gr_horn"); gbox("horns", 3.3, 15, -0.7, 0.9, 1.2, 0.9, "gr_horn")
# The Grumble King's crown (variant 1 only)
gbox("crown", -2.6, 12.5, -2.6, 5.2, 1.4, 5.2, "gr_gold")
for cx, cz in ((-2.6, -2.6), (1.8, -2.6), (-2.6, 1.8), (1.8, 1.8), (-0.4, -2.6)):
    gbox("crown", cx, 13.9, cz, 0.8, 1.4, 0.8, "gr_gold")
gbox("crown", -0.5, 12.9, -2.9, 1.0, 0.8, 0.4, "gr_gem")
gbox("gfoot_l", -4, 0, -2.5, 3, 2, 3.5, "gr_foot"); gbox("gfoot_r", 1, 0, -2.5, 3, 2, 3.5, "gr_foot")
gbox("garm_l", -7.5, 4.5, -1, 1.5, 3.5, 1.5, "gr_arm"); gbox("garm_r", 6, 4.5, -1, 1.5, 3.5, 1.5, "gr_arm")


def grumble_geo():
    out = [{"name": "root", "pivot": [0, 0, 0]}]
    for name, cl in GR_BONES.items():
        out.append({"name": name, "parent": GR_PARENT.get(name, "root"), "pivot": GR_PIVOT[name], "cubes": cubes_json(cl, gr_uv)})
    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {"identifier": "geometry.grumble", "texture_width": GR_W, "texture_height": GR_H,
                            "visible_bounds_width": 1.5, "visible_bounds_height": 1.5, "visible_bounds_offset": [0, 0.5, 0]},
            "bones": out,
        }],
    }


GR_BODY = (70, 52, 104)


def grumble_texture():
    tex = Image.new("RGBA", (GR_W, GR_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)
    put = lambda x, y, c: tex.putpixel((x, y), tuple(c[:3]) + (255,))
    for name, col in (("gr_body", GR_BODY), ("gr_belly", (96, 76, 136)), ("gr_horn", (196, 170, 230)),
                      ("gr_foot", (46, 34, 70)), ("gr_arm", (58, 42, 88)), ("gr_gold", (246, 196, 56)), ("gr_gem", (226, 50, 90))):
        (x, y), _ = gr_uv(name)
        d.rectangle([x, y, x + 7, y + 7], fill=col + (255,))
    (x, y), _ = gr_uv("gr_body")
    for px, py in [(1, 1), (5, 2), (3, 5), (6, 6), (0, 4)]:
        put(x + px, y + py, (90, 70, 130))                                     # shadowy speckles
    # Front (12x9): big uneven googly eyes, a grumpy unibrow, a wobbly frown with one tooth.
    fx, fy, fw, fh = GR_FRONT
    d.rectangle([fx, fy, fx + fw - 1, fy + fh - 1], fill=GR_BODY + (255,))
    for px, py in [(0, 0), (11, 0), (5, 1), (2, 7), (9, 8)]:
        put(fx + px, fy + py, (90, 70, 130))
    d.line([fx + 1, fy + 1, fx + 10, fy + 1], fill=(36, 24, 56, 255))         # grumpy brow
    put(fx + 5, fy + 2, (36, 24, 56)); put(fx + 6, fy + 2, (36, 24, 56))
    d.rectangle([fx + 1, fy + 2, fx + 4, fy + 5], fill=(255, 255, 255, 255))  # left eye (big)
    d.rectangle([fx + 8, fy + 3, fx + 10, fy + 5], fill=(255, 255, 255, 255)) # right eye (smaller)
    d.rectangle([fx + 2, fy + 4, fx + 3, fy + 5], fill=(240, 90, 200, 255))   # pupils looking different ways
    put(fx + 9, fy + 3, (240, 90, 200))
    for px, py in [(3, 8), (4, 7), (5, 7), (6, 7), (7, 7), (8, 8)]:
        put(fx + px, fy + py, (30, 18, 44))                                    # frown
    put(fx + 5, fy + 8, (250, 250, 240))                                       # one little tooth
    return tex


# ---------- Concert Stage (one block) ----------
ST_UV = {"top": (0, 0, 16, 16), "side": (16, 0, 16, 4), "speaker": (16, 8, 4, 6), "speaker_side": (24, 8, 4, 6),
         "gold": (32, 0, 4, 4), "star": (40, 0, 4, 4), "dark": (48, 0, 4, 4), "light": (52, 0, 4, 4)}
STAGE = [
    ((-8, 0, -8), (16, 4, 16), {"up": "top", "north": "side", "south": "side", "east": "side", "west": "side"}, "dark"),
    ((-8, 4, 4), (4, 6, 4), {"north": "speaker"}, "speaker_side"),            # speakers at the back corners
    ((4, 4, 4), (4, 6, 4), {"north": "speaker"}, "speaker_side"),
    ((-7.5, 10, 5.5), (1, 5, 1), {}, "gold"), ((6.5, 10, 5.5), (1, 5, 1), {}, "gold"),   # arch posts
    ((-7.5, 15, 5.5), (15, 1, 1), {}, "gold"),                                # arch beam
    ((-2, 11, 5.5), (4, 4, 1), {}, "star"),                                   # big star hanging from it
    ((-1, 14.8, 5.9), (2, 0.3, 0.2), {}, "gold"),
    ((-6.5, 14.2, 5.3), (1, 0.8, 0.8), {}, "light"), ((5.5, 14.2, 5.3), (1, 0.8, 0.8), {}, "light"),  # spotlights
]


def stage_geo():
    cubes = []
    for o, s, faces, default in STAGE:
        uv = {}
        for f in FACES:
            u, v, w, h = ST_UV[faces.get(f, default)]
            uv[f] = {"uv": [u, v], "uv_size": [w, h]}
        cubes.append({"origin": list(o), "size": list(s), "uv": uv})
    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {"identifier": "geometry.concert_stage", "texture_width": 64, "texture_height": 32},
            "bones": [{"name": "stage", "pivot": [0, 0, 0], "cubes": cubes}],
        }],
    }


IDOL_COLORS = [GIRLS[0]["hair"], GIRLS[1]["hair"], GIRLS[2]["hair_tip"]]


def stage_texture():
    tex = Image.new("RGBA", (64, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)
    put = lambda x, y, c: tex.putpixel((x, y), tuple(c[:3]) + (255,))
    u, v, w, h = ST_UV["top"]                                                  # shiny dark floor with a star in the middle
    d.rectangle([u, v, u + 15, v + 15], fill=(52, 44, 80, 255))
    for k in range(0, 16, 4):
        d.line([u + k, v, u + k, v + 15], fill=(62, 54, 96, 255))
    d.rectangle([u, v, u + 15, v + 15], outline=GOLD + (255,))
    star = [(7, 3), (8, 3), (7, 4), (8, 4), (3, 6), (4, 6), (5, 6), (6, 6), (7, 6), (8, 6), (9, 6), (10, 6), (11, 6), (12, 6),
            (5, 7), (6, 7), (7, 7), (8, 7), (9, 7), (10, 7), (6, 8), (7, 8), (8, 8), (9, 8), (6, 9), (7, 9), (8, 9), (9, 9),
            (5, 10), (6, 10), (9, 10), (10, 10), (4, 11), (5, 11), (10, 11), (11, 11), (7, 5), (8, 5)]
    for px, py in star:
        put(u + px, v + py, (255, 226, 110))
    u, v, w, h = ST_UV["side"]                                                 # front edge: a row of colored lights
    d.rectangle([u, v, u + 15, v + 3], fill=(40, 34, 64, 255))
    d.line([u, v, u + 15, v], fill=GOLD + (255,))
    for k in range(1, 16, 3):
        put(u + k, v + 2, IDOL_COLORS[(k // 3) % 3])
    u, v, w, h = ST_UV["speaker"]
    d.rectangle([u, v, u + 3, v + 5], fill=(30, 28, 40, 255))
    for py in (1, 4):
        put(u + 1, v + py, (90, 86, 110)); put(u + 2, v + py, (90, 86, 110))
    u, v, w, h = ST_UV["speaker_side"]
    d.rectangle([u, v, u + 3, v + 5], fill=(44, 40, 58, 255))
    for name, col in (("gold", GOLD), ("star", (255, 226, 110)), ("dark", (40, 34, 64)), ("light", (255, 250, 220))):
        u, v, w, h = ST_UV[name]
        d.rectangle([u, v, u + 3, v + 3], fill=col + (255,))
    return tex


# ---------- Item icons ----------
def lightstick_icon():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    put = lambda x, y, c: img.putpixel((x, y), tuple(c[:3]) + (255,))
    for k in range(6):                                                         # handle, diagonal
        put(2 + k, 13 - k, (250, 250, 250)); put(3 + k, 13 - k, (220, 220, 230))
    put(2, 14, GOLD); put(3, 14, GOLD)
    for px, py, c in [(8, 7, GOLD), (9, 6, GOLD), (7, 8, GOLD)]:
        put(px, py, c)
    # a star on top, one point in each girl's color
    cx, cy = 11, 4
    for dx in range(-2, 3):
        for dy in range(-2, 3):
            if abs(dx) + abs(dy) <= 2:
                put(cx + dx, cy + dy, (255, 236, 140))
    put(cx, cy - 3, IDOL_COLORS[0]); put(cx - 3, cy, IDOL_COLORS[1]); put(cx + 3, cy, IDOL_COLORS[2])
    put(cx - 2, cy + 3, IDOL_COLORS[1]); put(cx + 2, cy + 3, IDOL_COLORS[2])
    put(cx, cy, (255, 255, 255))
    return img


def shard_icon():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    put = lambda x, y, c: img.putpixel((x, y), tuple(c[:3]) + (255,))
    for y in range(3, 13):
        half = min(y - 3, 12 - y) // 2 + 1
        for x in range(8 - half, 8 + half):
            put(x, y, (255, 230, 120) if x < 8 else (246, 196, 70))
    put(7, 5, (255, 255, 230)); put(7, 6, (255, 255, 230))
    for px, py in [(3, 3), (12, 4), (12, 11), (3, 11)]:
        put(px, py, (255, 255, 255))
    return img


def ticket_icon():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([1, 4, 14, 11], fill=(236, 120, 200, 255))                    # pink ticket
    for y in (6, 9):
        img.putpixel((1, y), (0, 0, 0, 0)); img.putpixel((14, y), (0, 0, 0, 0))   # notches
    d.line([10, 4, 10, 11], fill=(250, 200, 236, 255))                         # tear line
    for px, py in [(5, 5), (4, 6), (5, 6), (6, 6), (3, 7), (4, 7), (5, 7), (6, 7), (7, 7), (4, 8), (6, 8), (5, 9)]:
        img.putpixel((px, py), (255, 236, 120, 255))                           # star
    for px, py in [(12, 6), (12, 8), (12, 10)]:
        img.putpixel((px, py), (255, 255, 255, 255))
    return img


def clue_icon():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.polygon([(2, 2), (11, 2), (14, 5), (14, 14), (2, 14)], fill=(250, 244, 226, 255))
    d.polygon([(11, 2), (14, 5), (11, 5)], fill=(220, 210, 186, 255))          # folded corner
    for y in (6, 8, 10):
        d.line([4, y, 11, y], fill=(120, 110, 150, 255))                       # writing
    d.line([4, 12, 8, 12], fill=(120, 110, 150, 255))
    for px, py in [(12, 11), (11, 12), (12, 12), (13, 12), (12, 13)]:
        img.putpixel((px, py), (240, 190, 60, 255))                            # little star
    return img


def medal_icon():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.polygon([(4, 0), (7, 0), (8, 6), (6, 7)], fill=IDOL_COLORS[0] + (255,))   # ribbons in the girls' colors
    d.polygon([(8, 0), (11, 0), (9, 7), (7, 6)], fill=IDOL_COLORS[2] + (255,))
    d.line([7, 0, 8, 6], fill=IDOL_COLORS[1] + (255,))
    d.ellipse([3, 6, 12, 15], fill=GOLD + (255,), outline=(200, 150, 40, 255))
    for px, py in [(7, 8), (8, 8), (6, 10), (7, 10), (8, 10), (9, 10), (7, 11), (8, 11), (6, 12), (9, 12)]:
        img.putpixel((px, py), (255, 244, 180, 255))
    return img


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

    save_json("models/entity/star_idol.geo.json", idol_geo())
    for i in range(len(GIRLS)):
        save_png(f"textures/entity/star_idol_{i}.png", idol_texture(i))
    save_json("models/entity/grumble.geo.json", grumble_geo())
    save_png("textures/entity/grumble.png", grumble_texture())
    save_json("models/blocks/concert_stage.geo.json", stage_geo())
    save_png("textures/blocks/concert_stage.png", stage_texture())
    save_png("textures/items/lightstick.png", lightstick_icon())
    save_png("textures/items/star_shard.png", shard_icon())
    save_png("textures/items/adventure_ticket.png", ticket_icon())
    save_png("textures/items/clue.png", clue_icon())
    save_png("textures/items/medal.png", medal_icon())
    print(f"idols: {sum(len(v) for v in bones.values())} cubes in {len(BONE_ORDER)} bones; "
          f"grumble: {sum(len(v) for v in GR_BONES.values())} cubes; stage: {len(STAGE)} cubes")


# ---------- Preview ----------
SHADE = {"up": 1.0, "north": 0.88, "south": 0.72, "west": 0.7, "east": 0.92, "down": 0.55}


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


def make_poser(parent, pivots, pose):
    """pose: bone -> (rx, rz) degrees. Rotates around each bone's pivot, child first, then up the chain."""
    def posed(bone, pt):
        x, y, z = pt
        b = bone
        while b and b != "root":
            rx, rz = pose.get(b, (0, 0))
            px, py, pz = pivots[b]
            if rz:
                t = math.radians(rz)
                dx, dy = x - px, y - py
                x, y = px + dx * math.cos(t) - dy * math.sin(t), py + dx * math.sin(t) + dy * math.cos(t)
            if rx:
                t = math.radians(rx)
                ry, rzz = y - py, z - pz
                y, z = py + ry * math.cos(t) + rzz * math.sin(t), pz - ry * math.sin(t) + rzz * math.cos(t)
            b = parent.get(b, "root")
        return x, y, z
    return posed


def model_polys(bone_cubes, order, show, uvf, tex, posed, face_regions, ox, oz, scale, turn=0):
    """Polygons for a model. face_regions: swatch name -> (u, v, w, h) painted pixel by pixel on the north face."""
    polys, cols = [], []
    ct, st = math.cos(math.radians(turn)), math.sin(math.radians(turn))

    def place(p):
        x, y, z = p
        x, z = x * ct - z * st, x * st + z * ct
        return (ox + x * scale, oz + z * scale, y * scale)

    for bone in order:
        if bone not in show:
            continue
        for c in bone_cubes[bone]:
            for fname, quad in corners(*c["o"], *c["s"]).items():
                sw = c["faces"].get(fname, c["c"])
                if sw in face_regions and fname == "north":
                    (x, y, z), (w, h, dd) = c["o"], c["s"]
                    u, v, tw, th = face_regions[sw]
                    for px in range(tw):
                        for py in range(th):
                            y0, y1 = y + h - (py + 1) * h / th, y + h - py * h / th
                            a0, a1 = x + w - (px + 1) * w / tw, x + w - px * w / tw
                            q = [(a0, y0, z - 0.02), (a1, y0, z - 0.02), (a1, y1, z - 0.02), (a0, y1, z - 0.02)]
                            polys.append([place(posed(bone, p)) for p in q])
                            cols.append(tuple(min(1, ch / 255 * SHADE["north"] * 1.1) for ch in tex.getpixel((u + px, v + py))[:3]) + (1,))
                    continue
                if sw in face_regions:
                    sw = c["c"]
                (su, sv), _ = uvf(sw)
                ch = tex.getpixel((su + 3, sv + 3))
                polys.append([place(posed(bone, p)) for p in quad])
                cols.append(tuple(min(1, q / 255 * SHADE[fname]) for q in ch[:3]) + (1,))
    return polys, cols


IDOL_POSES = [
    {"arm_r": (-30, -8), "arm_l": (0, 12), "head": (0, 0)},                    # Sora: staff out, ready
    {"arm_r": (-25, -10), "arm_l": (-55, 10), "ponytail": (8, 0)},            # Dalia: drumsticks up
    {"arm_r": (-38, -12), "arm_l": (0, 6)},                                   # Yuna: fan raised
]


def idol_polys(i, ox, oz, scale, pose=None, turn=0):
    tex = idol_texture(i)
    hidden = set().union(*ONLY.values()) - ONLY[i]
    show = [b for b in BONE_ORDER if b not in hidden]
    posed = make_poser(PARENT, PIVOTS, pose if pose is not None else IDOL_POSES[i])
    return model_polys(bones, BONE_ORDER, show, sw_uv, tex, posed, {"face": FACE}, ox, oz, scale, turn)


def grumble_polys(ox, oz, scale, turn=0, king=False):
    posed = make_poser(GR_PARENT, GR_PIVOT, {"garm_l": (0, -25), "garm_r": (0, 25)})
    show = [b for b in GR_BONES if king or b != "crown"]
    return model_polys(GR_BONES, list(GR_BONES), show, gr_uv, grumble_texture(), posed,
                       {"gr_front": GR_FRONT}, ox, oz, scale, turn)


def stage_polys(ox, oz):
    tex = stage_texture()
    polys, cols = [], []
    for o, s, faces, default in STAGE:
        for fname, quad in corners(*o, *s).items():
            region = faces.get(fname, default)
            u, v, tw, th = ST_UV[region]
            if region in ("top", "side", "speaker") and fname in ("up", "north"):
                (x, y, z), (w, h, dd) = o, s
                for px in range(tw):
                    for py in range(th):
                        if fname == "up":
                            a0, a1 = x + px * w / tw, x + (px + 1) * w / tw
                            b0, b1 = z + py * dd / th, z + (py + 1) * dd / th
                            q = [(a0, y + h + 0.02, b0), (a1, y + h + 0.02, b0), (a1, y + h + 0.02, b1), (a0, y + h + 0.02, b1)]
                        else:
                            y0, y1 = y + h - (py + 1) * h / th, y + h - py * h / th
                            a0, a1 = x + px * w / tw, x + (px + 1) * w / tw
                            q = [(a0, y0, z - 0.02), (a1, y0, z - 0.02), (a1, y1, z - 0.02), (a0, y1, z - 0.02)]
                        polys.append([(ox + p[0], oz + p[2], p[1]) for p in q])
                        cols.append(tuple(min(1, ch / 255 * SHADE[fname]) for ch in tex.getpixel((u + px, v + py))[:3]) + (1,))
                continue
            ch = tex.getpixel((u + 1, v + 1))
            polys.append([(ox + p[0], oz + p[2], p[1]) for p in quad])
            cols.append(tuple(min(1, q / 255 * SHADE[fname]) for q in ch[:3]) + (1,))
    return polys, cols


def draw(path, parts, xlim, ylim, zlim, size, elev, azim, bg, labels=(), zoom=1.0, edge=0.15, dpi=120, pad=0.1):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    fig = plt.figure(figsize=size, dpi=dpi)
    fig.patch.set_facecolor(bg)
    ax = fig.add_subplot(1, 1, 1, projection="3d")
    ax.set_facecolor(bg)
    polys, cols = [], []
    for pp, cc in parts:
        polys += pp; cols += cc
    ax.add_collection3d(Poly3DCollection(polys, facecolors=cols, edgecolors=(0, 0, 0, edge), linewidths=0.12))
    for name, lx, lz in labels:
        ax.text(lx, 0, lz, name, ha="center", fontsize=12, color=(0.25, 0.2, 0.35), fontweight="bold")
    ax.set_xlim(*xlim); ax.set_ylim(*ylim); ax.set_zlim(*zlim)
    ax.set_box_aspect((xlim[1] - xlim[0], ylim[1] - ylim[0], zlim[1] - zlim[0]), zoom=zoom)
    ax.view_init(elev=elev, azim=azim)
    ax.axis("off")
    plt.subplots_adjust(left=0, right=1, top=1, bottom=0)
    if pad is None:
        plt.savefig(path, facecolor=bg)
    else:
        plt.savefig(path, facecolor=bg, bbox_inches="tight", pad_inches=pad)
    plt.close(fig)


def render_preview(path, closeup=None, icon_path=None):
    S = 0.75                                    # in-game size: the girls next to a one-block (16 pixel) stage
    bg = (0.93, 0.91, 0.98)
    parts = [stage_polys(0, 0)]
    labels = [("Concert Stage", 0, 21)]
    for i, x in enumerate((24, 44, 64)):
        parts.append(idol_polys(i, x, 0, S))
        labels.append((GIRLS[i]["name"], x, 28))
    parts.append(grumble_polys(86, 0, 1.0, turn=0))
    labels.append(("a Grumble", 86, 19))
    draw(path, parts, (-12, 100), (-16, 16), (0, 30), (16, 6), 12, -66, bg, labels, zoom=1.2)

    if closeup:                                 # the Grumble King (3x size) facing Star Shield
        king = closeup.replace(".png", "_king.png")
        parts = [idol_polys(i, x, -10, S, turn=t) for i, (x, t) in enumerate(((-26, 150), (-14, 170), (-2, 190)))]
        parts.append(grumble_polys(30, 6, 3.0, king=True))
        draw(king, parts, (-34, 54), (-24, 24), (0, 50), (12, 7), 12, -70, bg,
             [("Star Shield", -14, 30), ("the Grumble King", 30, 52)], zoom=1.25, edge=0.1, dpi=120)
    if closeup:                                 # the three girls big, slightly from the front
        parts = [idol_polys(i, x, 0, 1.0, turn=t) for i, (x, t) in enumerate(((-17, 12), (0, 0), (17, -12)))]
        draw(closeup, parts, (-27, 27), (-14, 14), (0, 34), (12, 8), 6, -82, bg,
             [(GIRLS[i]["name"], x, 37) for i, x in enumerate((-17, 0, 17))], zoom=1.25, edge=0.1, dpi=130)

    if icon_path:
        parts = [idol_polys(i, x, 0, 1.0, turn=t) for i, (x, t) in enumerate(((-15, 15), (0, 0), (15, -15)))]
        draw(icon_path, parts, (-23, 23), (-12, 12), (4, 36), (2.56, 2.56), 6, -84, (0.86, 0.82, 0.96),
             zoom=1.6, edge=0.08, dpi=100, pad=None)


if __name__ == "__main__":
    rp = sys.argv[1]
    write_pack(rp)
    if len(sys.argv) > 2:
        icon = os.path.join(rp, "pack_icon.png")
        render_preview(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None, icon)
        bp = rp.rstrip("/")[:-3] + "_BP" if rp.rstrip("/").endswith("_RP") else None
        if bp and os.path.isdir(bp):
            Image.open(icon).save(os.path.join(bp, "pack_icon.png"))
