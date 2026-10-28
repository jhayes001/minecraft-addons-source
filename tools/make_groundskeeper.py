"""Builds the models and textures for the Groundskeeper Elves add-on, and optionally a preview picture.

Two little elves live in an Elf Shed. Each elf wears a tunic, striped stockings, curly-toed boots and a
floppy pointed hat with a gold bell; there are four outfits (the entity `variant`, 0-3). The elf holds
one tool at a time (the entity `skin_id`): 0 nothing, 1 golden sickle (mowing), 2 shovel (snow),
3 rake (leaves), 4 a sack of clippings on the back (on the way to the composter).

Writes into the resource pack:
  models/entity/groundskeeper_elf.geo.json        the elf (tools and sack are bones the render controller shows/hides)
  textures/entity/groundskeeper_elf_<0-3>.png     one texture per outfit
  models/blocks/elf_shed.geo.json                 one-block garden shed with a rake and shovel leaning on it
  textures/blocks/elf_shed.png, elf_shed_open.png door closed / door open (elves are out working)
  textures/particle/grounds_bits.png              little chunk (tinted green/white/orange by the script)
  textures/particle/grounds_sparkle.png           twinkle for elf magic
And pack_icon.png into the resource pack and the behavior pack next to it (when making a preview).

The elf is modeled at about double size and shrunk in game with minecraft:scale 0.45 (about 0.9 blocks
tall to the tip of the hat). Units are pixels, feet at y = 0, facing north (-Z). Every face is painted
from an 8x8 swatch, except the front of the head (the face). Positive x rotation tips the top of a bone
forward (same as the other add-ons).

Bones: root > body > head > hat_tip; body > arm_l, arm_r > tool_sickle, tool_shovel, tool_rake; body > sack;
root > leg_l, leg_r.

Usage: python3 make_groundskeeper.py <resource_pack_dir> [preview.png]
"""
import json, math, os, sys
from PIL import Image, ImageDraw

# Index = the entity's variant number. Keep in sync with LOOKS in main.js.
OUTFITS = [
    # name,     tunic,          tunic dark,     hat,            hat dark,       hair
    ("green",  (70, 160, 76),  (40, 110, 52),  (214, 56, 56),  (150, 30, 36),  (150, 76, 40)),
    ("red",    (210, 66, 62),  (146, 36, 40),  (64, 156, 74),  (36, 104, 48),  (236, 196, 98)),
    ("blue",   (72, 116, 214), (40, 72, 150),  (246, 204, 64), (196, 150, 30), (90, 58, 36)),
    ("purple", (146, 86, 196), (96, 52, 140),  (246, 146, 52), (190, 98, 30),  (196, 92, 44)),
]
SKIN = (246, 206, 176)
CREAM = (250, 244, 228)

SW = ["skin", "tunic", "tunic_dark", "hat", "hat_dark", "trim", "hair", "boot", "legs", "belt", "gold",
      "wood", "iron", "sack", "sack_dark", "clip", "nose", "ear"]
FACE = (0, 40, 9, 9)
REGIONS = {"face": FACE}
TEX_W, TEX_H = 128, 64


def sw_uv(name):
    if name in REGIONS:
        u, v, w, h = REGIONS[name]
        return [u, v], [w, h]
    i = SW.index(name)
    return [(i % 16) * 8, (i // 16) * 8], [8, 8]


BONE_ORDER = ["body", "head", "hat_tip", "arm_l", "arm_r", "leg_l", "leg_r", "sack", "tool_sickle", "tool_shovel", "tool_rake"]
PARENT = {"head": "body", "hat_tip": "head", "arm_l": "body", "arm_r": "body", "sack": "body",
          "tool_sickle": "arm_r", "tool_shovel": "arm_r", "tool_rake": "arm_r"}
PIVOTS = {
    "body": [0, 7, 0], "head": [0, 15, 0], "hat_tip": [0, 30.5, 0.5],
    "arm_l": [-5.2, 14, 0], "arm_r": [5.2, 14, 0], "leg_l": [-1.75, 7, 0], "leg_r": [1.75, 7, 0],
    "sack": [0, 12, 3], "tool_sickle": [5.2, 14, 0], "tool_shovel": [5.2, 14, 0], "tool_rake": [5.2, 14, 0],
}
ROTATION = {"hat_tip": -38}  # the tip of the hat flops backward
bones = {b: [] for b in BONE_ORDER}


def box(bone, x, y, z, w, h, d, color, faces=None):
    bones[bone].append({"o": (x, y, z), "s": (w, h, d), "c": color, "faces": faces or {}})


# ---------- Elf ----------
for bone, s in (("leg_l", -1), ("leg_r", 1)):
    x0 = 0.5 if s > 0 else -3.0                                              # left edge of the leg
    box(bone, x0, 2, -1, 2.5, 5.2, 2, "legs")                               # striped stocking
    box(bone, x0 - 0.3, 0, -1.6, 3.1, 2.2, 3.1, "boot")                     # boot
    box(bone, x0 + 0.45, 0.6, -3.0, 1.6, 1.4, 1.5, "boot")                  # long toe...
    box(bone, x0 + 0.65, 1.8, -3.5, 1.2, 1.1, 1.0, "boot")                  # ...that curls up

box("body", -4, 7, -2.5, 8, 8, 5, "tunic")                                    # tunic
box("body", -4.5, 6, -3, 9, 2.5, 6, "tunic_dark")                             # flared hem
box("body", -3.6, 14.4, -2.9, 7.2, 1.1, 5.8, "trim")                          # collar
box("body", -4.2, 9.5, -2.7, 8.4, 1.2, 5.4, "belt")                           # belt
box("body", -0.8, 9.4, -2.95, 1.6, 1.4, 0.3, "gold")                          # buckle
box("body", 4.0, 7.6, -1.0, 1.0, 2.0, 2.0, "belt")                            # little pouch

box("head", -4.5, 15, -4.5, 9, 9, 9, "skin", {"north": "face"})               # head
box("head", -0.75, 17.6, -5.5, 1.5, 1.5, 1.0, "nose")                         # button nose
box("head", -6.4, 19, -0.75, 1.9, 2.4, 1.5, "ear"); box("head", -7.8, 20.4, -0.5, 1.4, 2.0, 1.0, "ear")  # pointy ears
box("head", 4.5, 19, -0.75, 1.9, 2.4, 1.5, "ear"); box("head", 6.4, 20.4, -0.5, 1.4, 2.0, 1.0, "ear")
box("head", -4.7, 16.5, 4.4, 9.4, 6.5, 0.6, "hair")                           # hair at the back
box("head", -4.8, 18.5, -4.0, 0.4, 4.5, 8.4, "hair"); box("head", 4.4, 18.5, -4.0, 0.4, 4.5, 8.4, "hair")
box("head", -5.0, 23, -5.0, 10, 2, 10, "trim")                                # fluffy hat band
box("head", -4.0, 25, -3.8, 8, 3, 8, "hat")                                   # hat
box("head", -3.0, 28, -2.6, 6, 2.5, 6, "hat")
box("hat_tip", -2.0, 30.5, -1.5, 4, 3, 4, "hat")                              # floppy tip (bone leans back)
box("hat_tip", -1.3, 33.5, -0.8, 2.6, 3, 2.6, "hat_dark")
box("hat_tip", -1.0, 36.5, -0.5, 2.0, 2.0, 2.0, "gold")                       # bell

for bone, s in (("arm_l", -1), ("arm_r", 1)):
    x0 = 4.0 if s > 0 else -6.5
    box(bone, x0, 9.5, -1.25, 2.5, 5, 2.5, "tunic")                           # sleeve
    box(bone, x0 + 0.15, 7.9, -1.1, 2.2, 1.7, 2.2, "skin")                   # hand

box("sack", -3, 9, 2.5, 6, 6, 3.5, "sack")                                    # sack of clippings on the back
box("sack", -1.5, 15, 3.0, 3, 1, 2.5, "sack_dark")
box("sack", -2, 16, 3.2, 4, 1.4, 2, "clip")

# Tools, held in the right hand (around x 5.2, y 8.8).
box("tool_sickle", 4.6, 8.2, -4.4, 1.2, 1.2, 5.2, "wood")                     # handle pointing forward
box("tool_sickle", 4.75, 9.4, -5.3, 0.9, 3.0, 0.9, "gold")                   # golden blade, curving up...
box("tool_sickle", 4.75, 12.2, -4.6, 0.9, 0.9, 2.4, "gold")                  # ...and back
box("tool_sickle", 4.75, 11.6, -2.4, 0.9, 0.8, 1.0, "gold")

box("tool_shovel", 4.6, 2.2, -0.6, 1.2, 13, 1.2, "wood")                      # long handle through the hand
box("tool_shovel", 4.2, 15.2, -1.0, 2.0, 1.0, 2.0, "wood")                   # grip
box("tool_shovel", 3.4, 0, -1.2, 3.6, 3.2, 0.8, "iron")                      # blade

box("tool_rake", 4.6, 1.6, -0.6, 1.2, 14, 1.2, "wood")
box("tool_rake", 1.8, 1.0, -1.0, 7.6, 1.0, 1.6, "wood")                      # rake head
for tx in (2.0, 3.8, 5.6, 7.4, 8.8):
    box("tool_rake", tx, -0.2, -1.4, 0.6, 1.3, 0.6, "iron")                  # tines

FACES = ("north", "south", "east", "west", "up", "down")


def elf_geo():
    out = [{"name": "root", "pivot": [0, 0, 0]}]
    for name in BONE_ORDER:
        cubes = []
        for c in bones[name]:
            uv = {}
            for f in FACES:
                pos, size = sw_uv(c["faces"].get(f, c["c"]))
                uv[f] = {"uv": pos, "uv_size": size}
            cubes.append({"origin": [round(v, 3) for v in c["o"]], "size": [round(v, 3) for v in c["s"]], "uv": uv})
        bone = {"name": name, "parent": PARENT.get(name, "root"), "pivot": PIVOTS[name], "cubes": cubes}
        if name in ROTATION:
            bone["rotation"] = [ROTATION[name], 0, 0]
        out.append(bone)
    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": "geometry.groundskeeper_elf", "texture_width": TEX_W, "texture_height": TEX_H,
                "visible_bounds_width": 2, "visible_bounds_height": 2, "visible_bounds_offset": [0, 0.75, 0],
            },
            "bones": out,
        }],
    }


def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


def elf_texture(i):
    name, tunic, tunic_dark, hat, hat_dark, hair = OUTFITS[i]
    tex = Image.new("RGBA", (TEX_W, TEX_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)

    def fill(sw, col):
        (x, y), _ = sw_uv(sw)
        d.rectangle([x, y, x + 7, y + 7], fill=col + (255,))
        return x, y

    fill("skin", SKIN); fill("ear", SKIN); fill("nose", (238, 156, 140))
    x, y = fill("tunic", tunic)
    for k in range(8):
        tex.putpixel((x + k, y + 7), shade(tunic, 0.85) + (255,))       # hem shadow
    fill("tunic_dark", tunic_dark)
    x, y = fill("hat", hat)
    for k in (1, 5):
        tex.putpixel((x + k, y + 2), shade(hat, 1.12) + (255,)); tex.putpixel((x + k + 1, y + 5), shade(hat, 0.9) + (255,))
    fill("hat_dark", hat_dark)
    x, y = fill("trim", CREAM)
    for k in range(0, 8, 2):
        tex.putpixel((x + k, y + 3), (226, 220, 206, 255)); tex.putpixel((x + k + 1, y + 6), (226, 220, 206, 255))
    fill("hair", hair)
    x, y = fill("boot", (110, 70, 42))
    for k in range(8):
        tex.putpixel((x + k, y + 7), (80, 50, 30, 255))
    x, y = fill("legs", CREAM)
    for row in range(0, 8, 2):                                          # striped stockings in the hat's color
        d.line([x, y + row, x + 7, y + row], fill=hat + (255,))
    fill("belt", (92, 58, 34))
    fill("gold", (246, 196, 56))
    x, y = fill("wood", (156, 108, 62))
    for k in (2, 5):
        d.line([x, y + k, x + 7, y + k], fill=(134, 90, 50, 255))
    x, y = fill("iron", (196, 200, 208))
    tex.putpixel((x + 2, y + 2), (236, 238, 242, 255)); tex.putpixel((x + 5, y + 4), (236, 238, 242, 255))
    x, y = fill("sack", (196, 164, 114))
    for k in range(0, 8, 3):
        d.line([x + k, y, x + k, y + 7], fill=(176, 144, 96, 255))
    fill("sack_dark", (150, 120, 80))
    x, y = fill("clip", (92, 168, 64))
    for px, py in [(1, 1), (4, 0), (6, 3), (2, 5), (5, 6)]:
        tex.putpixel((x + px, y + py), (132, 200, 84, 255))

    # Face (9x9): hair fringe under the hat, big friendly eyes, rosy cheeks, a happy smile.
    fx, fy, fw, fh = FACE
    d.rectangle([fx, fy, fx + fw - 1, fy + fh - 1], fill=SKIN + (255,))
    for col in range(fw):
        tex.putpixel((fx + col, fy), hair + (255,))
    for col in (0, 1, 3, 5, 7, 8):
        tex.putpixel((fx + col, fy + 1), hair + (255,))
    brow = shade(hair, 0.7)
    eye = (40, 34, 44)
    for ex in (1, 6):
        tex.putpixel((fx + ex, fy + 2), brow + (255,)); tex.putpixel((fx + ex + 1, fy + 2), brow + (255,))
        for c in (0, 1):
            tex.putpixel((fx + ex + c, fy + 3), eye + (255,))
            tex.putpixel((fx + ex + c, fy + 4), eye + (255,))
        tex.putpixel((fx + ex, fy + 3), (255, 255, 255, 255))           # twinkle in the eye
    for px in (0, 8):
        tex.putpixel((fx + px, fy + 5), (240, 146, 146, 255))           # rosy cheeks
    for px in (2, 6):
        tex.putpixel((fx + px, fy + 6), (176, 80, 76, 255))
    for px in (3, 4, 5):
        tex.putpixel((fx + px, fy + 7), (176, 80, 76, 255))             # smile
    tex.putpixel((fx + 7, fy + 5), shade(SKIN, 0.86) + (255,)); tex.putpixel((fx + 1, fy + 6), shade(SKIN, 0.86) + (255,))  # freckles
    return tex


# ---------- Elf Shed (one block) ----------
BOARD, BOARD_LINE, DOOR, ROOF, ROOF_DARK = (196, 144, 92), (164, 116, 70), (126, 80, 48), (86, 150, 96), (60, 112, 72)
SHED_UV = {
    "front": (0, 0, 12, 10), "back": (16, 0, 12, 10), "side": (32, 0, 10, 10), "planks": (48, 0, 8, 8),
    "roof": (0, 16, 8, 8), "wood": (8, 16, 8, 8), "iron": (16, 16, 8, 8), "stone": (24, 16, 8, 8), "flowers": (32, 16, 8, 8),
}
SHED = [
    # origin, size, {face: region}; every face not listed uses the default given last
    ((-6, 0, -5), (12, 10, 10), {"north": "front", "south": "back", "east": "side", "west": "side"}, "planks"),
    ((-7, 10, -6.5), (14, 1.5, 13), {}, "roof"),
    ((-7, 11.5, -5), (14, 1.5, 10), {}, "roof"),
    ((-7, 13, -3.5), (14, 1.5, 7), {}, "roof"),
    ((-7, 14.5, -2), (14, 1.5, 4), {}, "roof"),
    ((-2, 0, -6.4), (4, 0.6, 1.4), {}, "stone"),                     # doorstep
    ((6.2, 0, 2.2), (0.8, 10.4, 0.8), {}, "wood"),                    # rake leaning on the east wall...
    ((6.0, 10.4, 1.0), (1.2, 0.6, 3.2), {}, "iron"),                  # ...head up
    ((6.0, 3.6, -2.2), (1.2, 1.0, 3.6), {}, "wood"),                  # flower box under the side window
    ((6.0, 4.6, -2.2), (1.2, 0.8, 3.6), {}, "flowers"),
    ((-7.0, 3.2, 2.0), (0.8, 9.0, 0.8), {}, "wood"),                  # shovel on the west wall
    ((-7.2, 0, 1.4), (1.2, 3.4, 2.0), {}, "iron"),
]


def shed_geo():
    cubes = []
    for o, s, faces, default in SHED:
        uv = {}
        for f in FACES:
            u, v, w, h = SHED_UV[faces.get(f, default)]
            uv[f] = {"uv": [u, v], "uv_size": [w, h]}
        cubes.append({"origin": list(o), "size": list(s), "uv": uv})
    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {"identifier": "geometry.elf_shed", "texture_width": 64, "texture_height": 64},
            "bones": [{"name": "shed", "pivot": [0, 0, 0], "cubes": cubes}],
        }],
    }


def shed_texture(open_door):
    tex = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)

    def boards(name):
        u, v, w, h = SHED_UV[name]
        d.rectangle([u, v, u + w - 1, v + h - 1], fill=BOARD + (255,))
        for x in range(2, w, 3):
            d.line([u + x, v, u + x, v + h - 1], fill=BOARD_LINE + (255,))
        return u, v, w, h

    # Front: plank wall, a green door with a round window and a gold knob, lanterns either side.
    u, v, w, h = boards("front")
    if open_door:
        d.rectangle([u + 4, v + 2, u + 7, v + 9], fill=(52, 38, 30, 255))          # dark doorway
        d.rectangle([u + 4, v + 8, u + 7, v + 9], fill=(92, 70, 48, 255))          # floor inside
        tex.putpixel((u + 5, v + 4), (255, 214, 120, 255)); tex.putpixel((u + 6, v + 5), (255, 190, 90, 255))  # a lantern glowing inside
    else:
        d.rectangle([u + 4, v + 2, u + 7, v + 9], fill=(70, 128, 82, 255))
        for k in range(4):
            tex.putpixel((u + 4 + k, v + 2 + 7 - k * 2), (50, 98, 60, 255))         # Z brace
        tex.putpixel((u + 5, v + 3), (170, 214, 236, 255)); tex.putpixel((u + 6, v + 3), (170, 214, 236, 255))
        tex.putpixel((u + 7, v + 6), (246, 196, 56, 255))                           # knob
    d.line([u + 3, v + 1, u + 8, v + 1], fill=DOOR + (255,))                        # lintel
    for lx in (1, 10):
        tex.putpixel((u + lx, v + 3), (60, 60, 60, 255)); tex.putpixel((u + lx, v + 4), (255, 214, 110, 255))
    tex.putpixel((u + 1, v + 9), (90, 170, 70, 255)); tex.putpixel((u + 10, v + 9), (90, 170, 70, 255))
    tex.putpixel((u + 2, v + 9), (240, 120, 160, 255)); tex.putpixel((u + 9, v + 9), (250, 214, 80, 255))
    boards("back")
    u, v, w, h = boards("side")
    d.rectangle([u + 3, v + 2, u + 6, v + 5], fill=(250, 248, 240, 255))
    d.rectangle([u + 4, v + 3, u + 5, v + 4], fill=(150, 196, 230, 255))
    u, v, w, h = SHED_UV["planks"]
    d.rectangle([u, v, u + 7, v + 7], fill=BOARD + (255,))
    for y in (2, 5):
        d.line([u, v + y, u + 7, v + y], fill=BOARD_LINE + (255,))
    # Roof: green shingles in scalloped rows.
    u, v, w, h = SHED_UV["roof"]
    d.rectangle([u, v, u + 7, v + 7], fill=ROOF + (255,))
    for row in (1, 4, 7):
        for x in range(8):
            if (x + row) % 3 == 0:
                tex.putpixel((u + x, v + row), ROOF_DARK + (255,))
    u, v, w, h = SHED_UV["wood"]
    d.rectangle([u, v, u + 7, v + 7], fill=(150, 102, 58, 255))
    u, v, w, h = SHED_UV["iron"]
    d.rectangle([u, v, u + 7, v + 7], fill=(190, 196, 204, 255))
    u, v, w, h = SHED_UV["stone"]
    d.rectangle([u, v, u + 7, v + 7], fill=(160, 160, 166, 255))
    for x, y in [(1, 1), (5, 2), (2, 5), (6, 6)]:
        tex.putpixel((u + x, v + y), (130, 130, 138, 255))
    u, v, w, h = SHED_UV["flowers"]
    d.rectangle([u, v, u + 7, v + 7], fill=(80, 160, 64, 255))
    for i, (x, y) in enumerate([(1, 1), (4, 2), (6, 0), (2, 4), (5, 5), (1, 7), (7, 6)]):
        tex.putpixel((u + x, v + y), [(240, 90, 120), (250, 214, 80), (160, 120, 240), (255, 255, 255)][i % 4] + (255,))
    return tex


def bits_texture():
    tex = Image.new("RGBA", (4, 4), (255, 255, 255, 255))
    for x, y in [(0, 0), (3, 0), (0, 3), (3, 3)]:
        tex.putpixel((x, y), (255, 255, 255, 0))
    tex.putpixel((1, 2), (215, 215, 215, 255)); tex.putpixel((2, 1), (235, 235, 235, 255))
    return tex


def sparkle_texture():
    tex = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    for x, y, a in [(3, 3, 255), (4, 3, 255), (3, 4, 255), (4, 4, 255), (3, 1, 200), (3, 2, 230), (3, 5, 230), (3, 6, 200),
                    (1, 3, 200), (2, 3, 230), (5, 3, 230), (6, 3, 200), (4, 2, 160), (4, 5, 160), (2, 4, 160), (5, 4, 160)]:
        tex.putpixel((x, y), (255, 255, 255, a))
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

    save_json("models/entity/groundskeeper_elf.geo.json", elf_geo())
    for i in range(len(OUTFITS)):
        save_png(f"textures/entity/groundskeeper_elf_{i}.png", elf_texture(i))
    save_json("models/blocks/elf_shed.geo.json", shed_geo())
    save_png("textures/blocks/elf_shed.png", shed_texture(False))
    save_png("textures/blocks/elf_shed_open.png", shed_texture(True))
    save_png("textures/particle/grounds_bits.png", bits_texture())
    save_png("textures/particle/grounds_sparkle.png", sparkle_texture())
    print(f"elf: {sum(len(v) for v in bones.values())} cubes in {len(BONE_ORDER)} bones, {len(OUTFITS)} outfits; shed: {len(SHED)} cubes")


# ---------- Preview ----------
SHADE = {"up": 1.0, "north": 0.84, "south": 0.72, "west": 0.66, "east": 0.9, "down": 0.55}
TOOL_BONES = {1: "tool_sickle", 2: "tool_shovel", 3: "tool_rake", 4: "sack"}


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


def posed(bone, pt, extra=None):
    x, y, z = pt
    b = bone
    while b and b != "root":
        ang = ROTATION.get(b, 0) + (extra or {}).get(b, 0)
        if ang:
            py, pz = PIVOTS[b][1], PIVOTS[b][2]
            t = math.radians(ang)
            ry, rz = y - py, z - pz
            y, z = py + ry * math.cos(t) + rz * math.sin(t), pz - ry * math.sin(t) + rz * math.cos(t)
        b = PARENT.get(b, "root")
    return x, y, z


def elf_polys(tex, ox, oz, tool, extra=None, scale=1.0):
    polys, cols = [], []
    show = {b for b in BONE_ORDER if b not in TOOL_BONES.values()} | ({TOOL_BONES[tool]} if tool in TOOL_BONES else set())
    for bone in BONE_ORDER:
        if bone not in show:
            continue
        for c in bones[bone]:
            for fname, quad in corners(*c["o"], *c["s"]).items():
                sw = c["faces"].get(fname, c["c"])
                if sw == "face" and fname == "north":
                    (x, y, z), (w, h, dd) = c["o"], c["s"]
                    u, v, tw, th = FACE
                    for px in range(tw):
                        for py in range(th):
                            y0, y1 = y + h - (py + 1) * h / th, y + h - py * h / th
                            a0, a1 = x + w - (px + 1) * w / tw, x + w - px * w / tw
                            q = [(a0, y0, z - 0.02), (a1, y0, z - 0.02), (a1, y1, z - 0.02), (a0, y1, z - 0.02)]
                            pts = [posed(bone, p, extra) for p in q]
                            polys.append([(ox + p[0] * scale, oz + p[2] * scale, p[1] * scale) for p in pts])
                            cols.append(tuple(min(1, ch / 255 * SHADE["north"] * 1.08) for ch in tex.getpixel((u + px, v + py))[:3]) + (1,))
                    continue
                (su, sv), _ = sw_uv(sw if sw != "face" else "skin")
                ch = tex.getpixel((su + 3, sv + 3))
                pts = [posed(bone, p, extra) for p in quad]
                polys.append([(ox + p[0] * scale, oz + p[2] * scale, p[1] * scale) for p in pts])
                cols.append(tuple(min(1, q / 255 * SHADE[fname]) for q in ch[:3]) + (1,))
    return polys, cols


def shed_polys(tex, ox, oz):
    polys, cols = [], []
    for o, s, faces, default in SHED:
        for fname, quad in corners(*o, *s).items():
            region = faces.get(fname, default)
            u, v, tw, th = SHED_UV[region]
            if region in ("front", "side") and fname in ("north", "east", "west"):
                (x, y, z), (w, h, dd) = o, s
                for px in range(tw):
                    for py in range(th):
                        y0, y1 = y + h - (py + 1) * h / th, y + h - py * h / th
                        if fname == "north":
                            a0, a1 = x + w - (px + 1) * w / tw, x + w - px * w / tw
                            q = [(a0, y0, z - 0.02), (a1, y0, z - 0.02), (a1, y1, z - 0.02), (a0, y1, z - 0.02)]
                        else:
                            a0, a1 = z + px * dd / tw, z + (px + 1) * dd / tw
                            fx = x - 0.02 if fname == "west" else x + w + 0.02
                            q = [(fx, y0, a0), (fx, y0, a1), (fx, y1, a1), (fx, y1, a0)]
                        polys.append([(ox + p[0], oz + p[2], p[1]) for p in q])
                        cols.append(tuple(min(1, ch / 255 * SHADE[fname]) for ch in tex.getpixel((u + px, v + py))[:3]) + (1,))
                continue
            ch = tex.getpixel((u + 3, v + 3))
            polys.append([(ox + p[0], oz + p[2], p[1]) for p in quad])
            cols.append(tuple(min(1, q / 255 * SHADE[fname]) for q in ch[:3]) + (1,))
    return polys, cols


POSES = {  # roughly what the work animations look like mid-swing
    1: {"body": 15, "arm_r": -55},
    2: {"body": 12, "arm_r": -25, "arm_l": -45},
    3: {"body": 10, "arm_r": -30},
    4: {},
}


def render_preview(path, icon_path=None):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    # In-game sizes: the elf is drawn at 0.45 scale next to a one-block (16 pixel) shed.
    S = 0.45
    bg = (0.88, 0.95, 0.86)
    fig = plt.figure(figsize=(16, 6), dpi=120)
    fig.patch.set_facecolor(bg)
    ax = fig.add_subplot(1, 1, 1, projection="3d")
    ax.set_facecolor(bg)
    polys, cols, labels = [], [], []
    pp, cc = shed_polys(shed_texture(True), 0, 0)
    polys += pp; cols += cc
    labels.append(("Elf Shed (elves out)", 0, 22))
    for i in range(4):
        x = 24 + i * 22
        tool = i + 1
        pp, cc = elf_polys(elf_texture(i), x, 0, tool, POSES[tool], S)
        polys += pp; cols += cc
        labels.append((["mowing (sickle)", "shoveling snow", "raking leaves", "carrying clippings"][i], x, 22))
    ax.add_collection3d(Poly3DCollection(polys, facecolors=cols, edgecolors=(0, 0, 0, 0.15), linewidths=0.1))
    right = 24 + 3 * 22 + 22
    for gx in range(-8, right + 1, 16):
        ax.plot([gx, gx], [-16, 16], [0, 0], color=(0.45, 0.65, 0.45), lw=0.4)
    for gy in (-16, 0, 16):
        ax.plot([-8, right], [gy, gy], [0, 0], color=(0.45, 0.65, 0.45), lw=0.4)
    for name, lx, lz in labels:
        ax.text(lx, 0, lz, name, ha="center", fontsize=10, color=(0.2, 0.3, 0.2))
    ax.set_xlim(-10, right); ax.set_ylim(-16, 16); ax.set_zlim(0, 24)
    ax.set_box_aspect((right + 10, 32, 24), zoom=1.3)
    ax.view_init(elev=14, azim=-58)
    ax.axis("off")
    plt.subplots_adjust(left=0, right=1, top=1, bottom=0)
    plt.savefig(path, facecolor=bg, bbox_inches="tight", pad_inches=0.1)
    plt.close(fig)

    if icon_path:  # pack icon: the green elf with his rake, close up
        fig = plt.figure(figsize=(2.56, 2.56), dpi=100)
        fig.patch.set_facecolor((0.78, 0.9, 0.72))
        ax = fig.add_subplot(1, 1, 1, projection="3d")
        ax.set_facecolor((0.78, 0.9, 0.72))
        pp, cc = elf_polys(elf_texture(0), 0, 0, 3, {"arm_r": -15})
        ax.add_collection3d(Poly3DCollection(pp, facecolors=cc, edgecolors=(0, 0, 0, 0.18), linewidths=0.15))
        ax.set_xlim(-11, 11); ax.set_ylim(-11, 11); ax.set_zlim(0, 38)
        ax.set_box_aspect((22, 22, 38))
        ax.view_init(elev=10, azim=-62)
        ax.axis("off")
        plt.subplots_adjust(left=-0.25, right=1.25, top=1.12, bottom=-0.12)
        plt.savefig(icon_path, facecolor=fig.get_facecolor())
        plt.close(fig)


if __name__ == "__main__":
    rp = sys.argv[1]
    write_pack(rp)
    if len(sys.argv) > 2:
        icon = os.path.join(rp, "pack_icon.png")
        render_preview(sys.argv[2], icon)
        bp = rp.rstrip("/")[:-3] + "_BP" if rp.rstrip("/").endswith("_RP") else None
        if bp and os.path.isdir(bp):
            Image.open(icon).save(os.path.join(bp, "pack_icon.png"))
