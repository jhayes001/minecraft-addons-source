"""Builds the models and textures for the Unicorn Princess add-on, and optionally a preview picture.

A princess in a ballgown and a gold crown rides a white unicorn with a rainbow mane, a rainbow tail,
a rainbow spiral horn, and gold hooves. There are four princesses (the entity `variant`, 0-3), each
with her own gown, hair, eyes, and skin; the unicorn is the same in all four textures.

Writes into the resource pack:
  models/entity/unicorn_princess.geo.json          one model: unicorn + princess
  textures/entity/unicorn_princess_<0-3>.png       one texture per princess
  textures/particle/unicorn_glitter.png            twinkly star (tinted rainbow colors by the script)
And pack_icon.png into the resource pack and the behavior pack next to it (when making a preview).

Model units are pixels (16 = one block), feet at y = 0, facing north (-Z). Every face is painted from
an 8x8 swatch, except the unicorn's eyes (sides of the head), the front of its nose, and the
princess's face, which have their own drawings.

Bones: root > body (bobs while walking) > head (neck, mane, horn), tail, princess > p_head, arm_l, arm_r.
The legs hang off root. The neck leans forward 30 degrees and the tail 20 degrees back (bone rotations
in the model); the princess's arms reach forward to hold the reins (arm_r waves in the animation).
Positive x rotation tips the top of a bone forward, the same as the Alpha Dog's sit pose.

Usage: python3 make_unicorn.py <resource_pack_dir> [preview.png]
"""
import json, math, os, sys
from PIL import Image, ImageDraw

RAINBOW = [(240, 70, 86), (255, 150, 60), (255, 222, 72), (104, 208, 110), (78, 160, 255), (150, 102, 232)]

UNICORN = {
    "coat": (247, 245, 252),
    "coat_hi": (255, 255, 255),
    "belly": (226, 224, 240),
    "muzzle": (252, 232, 238),
    "gold": (246, 198, 64),
    "ear_pink": (250, 176, 204),
    "red": RAINBOW[0], "orange": RAINBOW[1], "yellow": RAINBOW[2],
    "green": RAINBOW[3], "blue": RAINBOW[4], "purple": RAINBOW[5],
    "pink": (250, 130, 200),
    "white": (255, 255, 255),
}
HORN = [("horn_1", RAINBOW[0], RAINBOW[1]), ("horn_2", RAINBOW[2], RAINBOW[3]),
        ("horn_3", RAINBOW[4], RAINBOW[5]), ("horn_4", (250, 130, 200), (255, 255, 255))]

# The four princesses. Keep the order in sync with PRINCESSES in the behavior pack script.
PRINCESSES = [
    {"name": "Rosalie", "gown": (248, 140, 192), "gown_dark": (222, 88, 152), "ruffle": (255, 218, 236),
     "hair": (248, 204, 90), "eyes": (66, 128, 232), "skin": (252, 218, 194), "gem": (90, 170, 255)},
    {"name": "Violet", "gown": (178, 122, 232), "gown_dark": (128, 80, 200), "ruffle": (232, 212, 255),
     "hair": (118, 72, 42), "eyes": (56, 160, 88), "skin": (238, 192, 152), "gem": (255, 110, 170)},
    {"name": "Marina", "gown": (92, 194, 232), "gown_dark": (48, 140, 204), "ruffle": (216, 246, 255),
     "hair": (208, 92, 50), "eyes": (110, 72, 44), "skin": (252, 222, 204), "gem": (255, 90, 110)},
    {"name": "Sunny", "gown": (255, 206, 72), "gown_dark": (236, 158, 40), "ruffle": (255, 246, 206),
     "hair": (40, 32, 40), "eyes": (92, 56, 30), "skin": (178, 122, 86), "gem": (110, 220, 140)},
]
PRINCESS_KEYS = ["gown", "gown_dark", "ruffle", "hair", "skin", "gem"]

SW = list(UNICORN) + [h[0] for h in HORN] + PRINCESS_KEYS
UNI_SIDE = (0, 16, 15, 11)       # side of the unicorn's head (2 texture pixels per model pixel)
MUZZLE_FRONT = (16, 16, 9, 8)
P_FACE = (26, 16, 14, 14)        # princess's face
REGIONS = {"uni_side": UNI_SIDE, "muzzle_front": MUZZLE_FRONT, "p_face": P_FACE}
TEX_W, TEX_H = 128, 32


def sw_uv(name):
    if name in REGIONS:
        u, v, w, h = REGIONS[name]
        return [u, v], [w, h]
    i = SW.index(name)
    return [(i % 16) * 8, (i // 16) * 8], [8, 8]


BONE_ORDER = ["body", "leg_fl", "leg_fr", "leg_bl", "leg_br", "head", "tail", "princess", "p_head", "arm_l", "arm_r"]
PARENT = {"head": "body", "tail": "body", "princess": "body", "p_head": "princess", "arm_l": "princess", "arm_r": "princess"}
PIVOTS = {
    "body": [0, 11, 0],
    "leg_fl": [-2.75, 12, -6.25], "leg_fr": [2.75, 12, -6.25], "leg_bl": [-2.75, 12, 8.25], "leg_br": [2.75, 12, 8.25],
    "head": [0, 20, -8], "tail": [0, 20, 11],
    "princess": [0, 21, 0], "p_head": [0, 30, 0], "arm_l": [-4.4, 29, 0.2], "arm_r": [4.4, 29, 0.2],
}
ROTATION = {"head": 30, "tail": 20, "arm_l": -40, "arm_r": -40}  # x rotation in the model, degrees
bones = {b: [] for b in BONE_ORDER}


def box(bone, x, y, z, w, h, d, color, faces=None):
    """faces: optional {face: swatch} overrides, e.g. {"north": "p_face"}."""
    bones[bone].append({"o": (x, y, z), "s": (w, h, d), "c": color, "faces": faces or {}})


# ---------- Unicorn ----------
box("body", -5, 11, -9, 10, 10, 20, "coat", {"up": "coat_hi", "down": "belly"})
box("body", -4.5, 12, -10, 9, 8, 1.2, "coat")                       # rounded chest
box("body", -4.6, 11.5, 10.8, 9.2, 8.8, 0.9, "coat")                # rounded rump

for bone, x, z in (("leg_fl", -4.5, -8), ("leg_fr", 1.0, -8), ("leg_bl", -4.5, 6.5), ("leg_br", 1.0, 6.5)):
    box(bone, x, 2, z, 3.5, 10, 3.5, "coat")
    box(bone, x - 0.25, 0, z - 0.25, 4, 2, 4, "gold")               # gold hooves
    box(bone, x - 0.1, 2, z - 0.1, 3.7, 0.6, 3.7, "white")          # fluffy fetlock

# Neck and head (the whole bone leans forward 30 degrees).
box("head", -2.5, 17, -10.5, 5, 13, 6, "coat", {"up": "coat_hi"})
box("head", -3, 28, -12, 6, 5.5, 7.5, "coat", {"west": "uni_side", "east": "uni_side", "up": "coat_hi"})
box("head", -2.2, 28, -18, 4.4, 4.2, 6.2, "muzzle", {"north": "muzzle_front"})
box("head", -2.4, 27.9, -16.3, 4.8, 4.4, 0.7, "gold")                # bridle noseband
box("head", -3.1, 30.5, -12.2, 6.2, 0.7, 0.8, "gold")                # bridle cheek strap
box("head", -2.8, 33.5, -7.6, 1.6, 3, 1.2, "coat", {"north": "ear_pink"})
box("head", 1.2, 33.5, -7.6, 1.6, 3, 1.2, "coat", {"north": "ear_pink"})
box("head", -1.4, 33.3, -11.3, 2.8, 1.2, 2.6, "pink")                # forelock
# Rainbow mane: red at the top of the neck down to purple at the shoulders, with strands falling on the left.
for i, col in enumerate(["red", "orange", "yellow", "green", "blue", "purple"]):
    y = 31.2 - (i + 1) * 2.3
    box("head", -1.3, y, -4.9, 2.6, 2.3, 2.6, col)
    box("head", -3.4, y - 0.8, -6.4, 0.9, 2.3, 3.2, col)
box("head", -1.4, 31.2, -6.8, 2.8, 2.2, 2.4, "red")                  # mane between the ears
# Rainbow spiral horn: four tapering segments.
for (name, _, _), (x, y, z, s, h) in zip(HORN, [(-1, 33.5, -11.6, 2, 2.3), (-0.8, 35.8, -11.4, 1.6, 2.2),
                                                 (-0.6, 38.0, -11.2, 1.2, 2.0), (-0.35, 40.0, -10.95, 0.7, 1.6)]):
    box("head", x, y, z, s, h, s, name)

# Rainbow tail: bands from red at the top to purple at the tip, getting fuller as it falls.
for i, col in enumerate(["red", "orange", "yellow", "green", "blue", "purple"]):
    w, d = 3 + i * 0.35, 2.6 + i * 0.25
    box("tail", -w / 2, 20.5 - (i + 1) * 2.4, 11.6 - d / 2 + i * 0.1, w, 2.4, d, col)
box("tail", -1.4, 3.6, 11.0, 2.8, 1.0, 2.4, "pink")                  # little pink tip

# ---------- Princess ----------
box("princess", -6, 14.5, -4.5, 12, 7.5, 9, "gown")                  # ballgown skirt over the unicorn's back
box("princess", -6.4, 13.8, -4.9, 12.8, 1.2, 9.8, "ruffle")          # ruffle at the hem
box("princess", -4.5, 21.5, -3.5, 9, 2, 6.5, "gown")                 # top of the skirt
box("princess", -6.9, 13.4, -1.8, 1, 1, 2, "gold")                   # slippers peeking out
box("princess", 5.9, 13.4, -1.8, 1, 1, 2, "gold")
box("princess", -3.2, 23, -1.8, 6.4, 7, 3.8, "gown_dark")            # bodice
box("princess", -3.4, 23, -2.0, 6.8, 0.9, 4.2, "gold")               # sash
box("princess", -0.6, 25, -2.0, 1.2, 4.5, 0.3, "ruffle")             # lace down the front
box("princess", -3.6, 22.5, 1.6, 7.2, 10.5, 2.6, "hair")             # long hair down her back
box("p_head", -3.5, 30, -3.5, 7, 7, 7, "skin", {"north": "p_face"})
box("p_head", -3.8, 34.6, -3.8, 7.6, 2.8, 7.6, "hair")               # top of the hair
box("p_head", -3.8, 29.5, 3.0, 7.6, 5.4, 1.6, "hair")                # back of the hair
box("p_head", -4.2, 28.6, -3.0, 1, 6.2, 5.4, "hair")                 # side locks
box("p_head", 3.2, 28.6, -3.0, 1, 6.2, 5.4, "hair")
box("p_head", -2.6, 37.3, -2.6, 5.2, 1.3, 5.2, "gold")               # crown
for cx, cz, ch in ((-2.6, -2.6, 1.4), (1.6, -2.6, 1.4), (-2.6, 1.6, 1.4), (1.6, 1.6, 1.4), (-0.5, -2.6, 2.1)):
    box("p_head", cx, 38.6, cz, 1, ch, 1, "gold")
box("p_head", -0.6, 37.4, -2.9, 1.2, 1.1, 0.4, "gem")
for bone, x in (("arm_l", -5.6), ("arm_r", 3.0)):
    box(bone, x, 27, -1.2, 2.6, 2.8, 2.8, "gown")                    # puffy sleeve
    box(bone, x + 0.4, 23, -0.6, 1.8, 4.2, 1.8, "skin")
    box(bone, x + 0.3, 22.4, -0.7, 2.0, 0.9, 2.0, "white")           # glove
box("arm_r", 3.1, 26.6, -1.1, 2.4, 0.5, 2.6, "gold")                 # bracelet

FACES = ("north", "south", "east", "west", "up", "down")


def geo():
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
                "identifier": "geometry.unicorn_princess", "texture_width": TEX_W, "texture_height": TEX_H,
                "visible_bounds_width": 3, "visible_bounds_height": 3.5, "visible_bounds_offset": [0, 1.25, 0],
            },
            "bones": out,
        }],
    }


# ---------- Textures ----------
def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


def texture(p):
    pal = dict(UNICORN)
    pal.update({k: p[k] for k in PRINCESS_KEYS})
    tex = Image.new("RGBA", (TEX_W, TEX_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)
    for name in SW:
        (u, v), _ = sw_uv(name)
        if name.startswith("horn_"):
            _, a, b = next(h for h in HORN if h[0] == name)
            for x in range(8):
                for y in range(8):
                    tex.putpixel((u + x, v + y), (a if ((x + y) // 2) % 2 == 0 else b) + (255,))  # spiral stripes
            continue
        base = pal[name]
        d.rectangle([u, v, u + 7, v + 7], fill=base + (255,))
        if name in ("coat", "coat_hi", "belly", "muzzle"):          # a soft lavender shimmer on the white coat
            for (x, y) in ((1, 2), (5, 1), (3, 5), (6, 6), (0, 6)):
                tex.putpixel((u + x, v + y), shade(base, 0.95)[:2] + (min(255, base[2] + 4),) + (255,))
        elif name == "hair":                                        # strands
            for x in (1, 4, 6):
                d.line([u + x, v, u + x, v + 7], fill=shade(base, 0.82) + (255,))
            d.line([u + 2, v, u + 2, v + 7], fill=shade(base, 1.18) + (255,))
        elif name in ("gown", "gown_dark"):                         # silky folds and a sparkle
            for x in (2, 5):
                d.line([u + x, v, u + x, v + 7], fill=shade(base, 0.9) + (255,))
            tex.putpixel((u + 6, v + 2), (255, 255, 255, 255))
            tex.putpixel((u + 1, v + 5), shade(base, 1.25) + (255,))
        elif name == "ruffle":
            for x in range(0, 8, 2):
                tex.putpixel((u + x, v + 7), shade(base, 0.85) + (255,))
        elif name in ("gold", "gem"):
            d.line([u, v + 1, u + 7, v + 1], fill=shade(base, 1.2) + (255,))
            tex.putpixel((u + 2, v + 3), (255, 255, 255, 255))
        elif name in RAINBOW_NAMES:                                 # hair-like streaks in the mane and tail
            d.line([u + 1, v, u + 1, v + 7], fill=shade(base, 1.15) + (255,))
            d.line([u + 5, v, u + 5, v + 7], fill=shade(base, 0.88) + (255,))

    # Side of the unicorn's head: a big sparkly eye with long lashes, near the middle so it reads the same on both sides.
    u, v, w, h = UNI_SIDE
    d.rectangle([u, v, u + w - 1, v + h - 1], fill=UNICORN["coat"] + (255,))
    d.rectangle([u + 6, v + 3, u + 9, v + 7], fill=(70, 44, 120, 255))          # deep purple eye
    d.rectangle([u + 7, v + 5, u + 8, v + 7], fill=(36, 22, 70, 255))
    tex.putpixel((u + 7, v + 3), (255, 255, 255, 255))
    tex.putpixel((u + 8, v + 4), (200, 180, 255, 255))
    for x in range(5, 11):
        tex.putpixel((u + x, v + 2), (40, 30, 60, 255))                           # lashes
    tex.putpixel((u + 4, v + 1), (40, 30, 60, 255)); tex.putpixel((u + 11, v + 1), (40, 30, 60, 255))
    tex.putpixel((u + 5, v + 1), (40, 30, 60, 255)); tex.putpixel((u + 10, v + 1), (40, 30, 60, 255))
    d.line([u + 6, v + 9, u + 9, v + 9], fill=(252, 196, 214, 255))              # blush

    # Front of the nose: nostrils and a little smile.
    u, v, w, h = MUZZLE_FRONT
    d.rectangle([u, v, u + w - 1, v + h - 1], fill=UNICORN["muzzle"] + (255,))
    for x in (2, 6):
        d.rectangle([u + x, v + 2, u + x, v + 3], fill=(214, 150, 172, 255))
    d.line([u + 3, v + 6, u + 5, v + 6], fill=(214, 150, 172, 255))
    tex.putpixel((u + 2, v + 5), (214, 150, 172, 255)); tex.putpixel((u + 6, v + 5), (214, 150, 172, 255))

    # Princess's face: bangs, big eyes with a sparkle, rosy cheeks, smile.
    u, v, w, h = P_FACE
    d.rectangle([u, v, u + w - 1, v + h - 1], fill=p["skin"] + (255,))
    hair = p["hair"]
    d.rectangle([u, v, u + w - 1, v + 2], fill=hair + (255,))
    for x, depth in ((0, 6), (1, 5), (2, 4), (3, 3), (5, 3), (6, 4), (9, 3), (11, 4), (12, 5), (13, 6)):
        d.line([u + x, v, u + x, v + depth], fill=hair + (255,))
    d.line([u + 4, v + 3, u + 8, v + 3], fill=shade(hair, 0.85) + (255,))
    for ex in (3, 9):
        d.rectangle([u + ex, v + 6, u + ex + 1, v + 8], fill=p["eyes"] + (255,))
        tex.putpixel((u + ex + (1 if ex == 3 else 0), v + 6), (255, 255, 255, 255))
        tex.putpixel((u + ex + (0 if ex == 3 else 1), v + 8), shade(p["eyes"], 0.55) + (255,))
    lash = (40, 26, 30, 255)
    d.line([u + 2, v + 5, u + 5, v + 5], fill=lash)
    d.line([u + 8, v + 5, u + 11, v + 5], fill=lash)
    tex.putpixel((u + 2, v + 4), lash); tex.putpixel((u + 11, v + 4), lash)
    blush = (246, 140, 160, 255)
    for x in (2, 11):
        d.rectangle([u + x - (1 if x == 2 else 0), v + 9, u + x + (0 if x == 2 else 1), v + 9], fill=blush)
    d.line([u + 6, v + 11, u + 7, v + 11], fill=(214, 70, 100, 255))
    tex.putpixel((u + 5, v + 10), (214, 70, 100, 255)); tex.putpixel((u + 8, v + 10), (214, 70, 100, 255))
    return tex


RAINBOW_NAMES = ("red", "orange", "yellow", "green", "blue", "purple", "pink")


def glitter():
    """8x8 four-point twinkle star; white so the script can tint it any color."""
    img = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    for x, y, a in [(3, 0, 140), (4, 0, 140), (3, 1, 220), (4, 1, 220), (3, 6, 220), (4, 6, 220), (3, 7, 140), (4, 7, 140),
                    (0, 3, 140), (0, 4, 140), (1, 3, 220), (1, 4, 220), (6, 3, 220), (6, 4, 220), (7, 3, 140), (7, 4, 140),
                    (2, 2, 200), (5, 2, 200), (2, 5, 200), (5, 5, 200)]:
        img.putpixel((x, y), (255, 255, 255, a))
    for x in (2, 3, 4, 5):
        for y in (3, 4):
            img.putpixel((x, y), (255, 255, 255, 255))
    for y in (2, 5):
        for x in (3, 4):
            img.putpixel((x, y), (255, 255, 255, 255))
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

    save_json("models/entity/unicorn_princess.geo.json", geo())
    for i, p in enumerate(PRINCESSES):
        save_png(f"textures/entity/unicorn_princess_{i}.png", texture(p))
    save_png("textures/particle/unicorn_glitter.png", glitter())
    print(f"unicorn + princess: {sum(len(v) for v in bones.values())} cubes in {len(BONE_ORDER)} bones")


# ---------- Preview ----------
SHADE = {"up": 1.0, "north": 0.84, "south": 0.72, "west": 0.66, "east": 0.9, "down": 0.55}


def corners(x, y, z, w, h, dd):
    """Face quads in model coords (x, y, z)."""
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
    """Apply the model's bone rotations (and any extra pose), child first, then each parent."""
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


def region_quads(c, face, region):
    """Per-pixel quads for a face painted with a drawing (north, west, east only)."""
    (x, y, z), (w, h, dd) = c["o"], c["s"]
    u, v, tw, th = REGIONS[region]
    for px in range(tw):
        for py in range(th):
            y0, y1 = y + h - (py + 1) * h / th, y + h - py * h / th
            if face == "north":
                a0, a1 = x + w - (px + 1) * w / tw, x + w - px * w / tw
                q = [(a0, y0, z - 0.02), (a1, y0, z - 0.02), (a1, y1, z - 0.02), (a0, y1, z - 0.02)]
            else:
                a0, a1 = z + px * dd / tw, z + (px + 1) * dd / tw
                fx = x - 0.02 if face == "west" else x + w + 0.02
                q = [(fx, y0, a0), (fx, y0, a1), (fx, y1, a1), (fx, y1, a0)]
            yield q, (u + px, v + py)


def model_polys(tex, ox, extra=None):
    polys, cols = [], []

    def tf(p, bone):
        x, y, z = posed(bone, p, extra)
        return (x + ox, z, y)  # plot coords: x, model z, up

    for bone in BONE_ORDER:
        for c in bones[bone]:
            for fname, quad in corners(*c["o"], *c["s"]).items():
                sw = c["faces"].get(fname, c["c"])
                if sw in REGIONS and fname in ("north", "west", "east"):
                    for q, (tu, tv) in region_quads(c, fname, sw):
                        polys.append([tf(pt, bone) for pt in q])
                        cols.append(tuple(min(1, ch / 255 * SHADE[fname] * 1.05) for ch in tex.getpixel((tu, tv))[:3]) + (1,))
                    continue
                (su, sv), _ = sw_uv(sw)
                ch = tex.getpixel((su + 3, sv + 3))
                polys.append([tf(pt, bone) for pt in quad])
                cols.append(tuple(min(1, q / 255 * SHADE[fname]) for q in ch[:3]) + (1,))
    return polys, cols


def render_preview(path, icon_path=None):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    bg = (0.86, 0.93, 1.0)
    fig = plt.figure(figsize=(18, 7), dpi=120)
    fig.patch.set_facecolor(bg)
    ax = fig.add_subplot(1, 1, 1, projection="3d")
    ax.set_facecolor(bg)
    polys, cols, labels = [], [], []
    for i, p in enumerate(PRINCESSES):
        x = i * 34
        pp, cc = model_polys(texture(p), x, extra={"arm_r": -110} if i == 1 else None)
        polys += pp; cols += cc
        labels.append((f"Princess {p['name']}" + (" (waving)" if i == 1 else ""), x, 50))
    ax.add_collection3d(Poly3DCollection(polys, facecolors=cols, edgecolors=(0, 0, 0, 0.15), linewidths=0.1))
    right = 3 * 34 + 16
    for gx in range(-16, right + 1, 16):
        ax.plot([gx, gx], [-32, 32], [0, 0], color=(0.55, 0.75, 0.55), lw=0.4)
    for gy in range(-32, 33, 16):
        ax.plot([-16, right], [gy, gy], [0, 0], color=(0.55, 0.75, 0.55), lw=0.4)
    for name, lx, lz in labels:
        ax.text(lx, 0, lz, name, ha="center", fontsize=11, color=(0.35, 0.15, 0.35))
    ax.set_xlim(-16, right); ax.set_ylim(-32, 32); ax.set_zlim(0, 52)
    ax.set_box_aspect((right + 16, 64, 52), zoom=1.4)
    ax.view_init(elev=12, azim=-35)
    ax.axis("off")
    plt.subplots_adjust(left=0, right=1, top=1, bottom=0)
    plt.savefig(path, facecolor=bg, bbox_inches="tight", pad_inches=0.1)
    plt.close(fig)

    if icon_path:  # pack icon: Princess Rosalie and her unicorn, close up
        fig = plt.figure(figsize=(2.56, 2.56), dpi=100)
        fig.patch.set_facecolor((0.98, 0.78, 0.9))
        ax = fig.add_subplot(1, 1, 1, projection="3d")
        ax.set_facecolor((0.98, 0.78, 0.9))
        pp, cc = model_polys(texture(PRINCESSES[0]), 0)
        ax.add_collection3d(Poly3DCollection(pp, facecolors=cc, edgecolors=(0, 0, 0, 0.18), linewidths=0.15))
        ax.set_xlim(-14, 14); ax.set_ylim(-24, 16); ax.set_zlim(0, 42)
        ax.set_box_aspect((28, 40, 42))
        ax.view_init(elev=8, azim=-40)
        ax.axis("off")
        plt.subplots_adjust(left=-0.2, right=1.2, top=1.2, bottom=-0.2)
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
