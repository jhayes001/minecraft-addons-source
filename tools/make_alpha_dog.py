"""Builds the models and textures for the Alpha Dog add-on, and optionally a preview picture.

The dog is modeled after Graham, Havana's black pit bull mix (from photos): short shiny black coat,
lean and leggy, a white splotch low on his chest, one ear up and one flopped over, big dark brown
eyes, a long thin tail that curves up, and an orange collar with a rainbow tag.

Writes into the resource pack:
  models/entity/alpha_dog.geo.json        dog model (one model; each growth stage is minecraft:scale)
  textures/entity/alpha_dog.png           dog texture
  models/entity/alpha_dog_egg.geo.json + textures/entity/alpha_dog_egg.png
  textures/items/alpha_dog_egg.png        inventory icon
And pack_icon.png into the resource pack and the behavior pack next to it.

Model units are pixels (16 = one block), feet at y = 0, the dog faces north (-Z). Scale 1.0 is a
large adult dog. Every face is painted from an 8x8 fur swatch, except the face, the muzzle front,
the front of the chest, and the inside of the standing ear, which have their own drawings.

Bones: root > body, head (look), ear_l/ear_r, tongue, tail (wag), leg_* (walk), collar (puppy to
big), alpha_gear (gold spiked collar and saddle, shown only on the Alpha Dog).

Usage: python3 make_alpha_dog.py <resource_pack_dir> [preview.png]
"""
import json, os, random, sys
from PIL import Image, ImageDraw

# Growth stages. Keep in sync with the scale values in the behavior pack entity file.
STAGES = [("Puppy", 0.45), ("Small Dog", 0.7), ("Big Dog", 1.0), ("Alpha Dog", 2.2)]

COAT = (40, 38, 44)
PAL = {
    "coat": COAT,
    "coat_hi": (62, 60, 69),       # top of the back and head: the shine on a black coat
    "belly": (50, 47, 53),
    "muzzle": (54, 51, 57),
    "paw": (27, 26, 30),
    "nose": (16, 15, 18),
    "ear": (25, 24, 28),
    "tongue": (236, 112, 136),
    "collar": (240, 126, 34),      # Graham's orange collar
    "gold": (246, 198, 64),
    "silver": (228, 230, 238),
    "saddle": (150, 44, 44),
    "leather": (112, 70, 40),
    "rainbow": (255, 255, 255),    # his rainbow tag (painted as stripes below)
}
SW = list(PAL)
HEAD_FRONT = (0, 16, 14, 12)    # u, v, w, h in the texture (2 texture pixels per model pixel)
MUZZLE_FRONT = (16, 16, 8, 7)
EAR_INNER = (26, 16, 4, 6)
CHEST_FRONT = (32, 16, 16, 16)  # front of the chest (2 texture pixels per model pixel), with Graham's white splotch
REGIONS = {"head_front": HEAD_FRONT, "muzzle_front": MUZZLE_FRONT, "ear_inner": EAR_INNER, "chest_front": CHEST_FRONT}
TEX_W, TEX_H = 128, 32


def sw_uv(name):
    if name in REGIONS:
        u, v, w, h = REGIONS[name]
        return [u, v], [w, h]
    i = SW.index(name)
    return [(i % 16) * 8, (i // 16) * 8], [8, 8]


L = 2  # Graham is leggy: everything above the legs sits this much higher than a stocky pit bull would
BONE_ORDER = ["body", "leg_fl", "leg_fr", "leg_bl", "leg_br", "tail", "head", "ear_l", "ear_r", "tongue", "collar", "alpha_gear"]
PARENT = {"head": "body", "ear_l": "head", "ear_r": "head", "tongue": "head", "collar": "body", "alpha_gear": "body"}
PIVOTS = {
    "body": [0, 10 + L, 0], "head": [0, 13 + L, -6],
    "leg_fl": [-1.9, 6 + L, -3.9], "leg_fr": [1.9, 6 + L, -3.9], "leg_bl": [-2.0, 8 + L, 5.2], "leg_br": [2.0, 8 + L, 5.2],
    "tail": [0, 12 + L, 7.4], "ear_l": [-2.3, 16.6 + L, -9.4], "ear_r": [2.5, 16.6 + L, -9.5], "tongue": [0, 11.5 + L, -15],
    "collar": [0, 12 + L, -6], "alpha_gear": [0, 12 + L, 0],
}
bones = {b: [] for b in BONE_ORDER}


def box(bone, x, y, z, w, h, d, color, faces=None):
    """faces: optional {face: swatch} overrides, e.g. {"north": "head_front"}."""
    bones[bone].append({"o": (x, y, z), "s": (w, h, d), "c": color, "faces": faces or {}})


# Body: lean and athletic, with a deep chest and Graham's white splotch on the front of it.
box("body", -3, 6 + L, -5, 6, 6.5, 12.5, "coat", {"up": "coat_hi", "down": "belly"})
box("body", -3.4, 5.2 + L, -6.5, 6.8, 7.3, 4.5, "coat", {"north": "chest_front", "up": "coat_hi", "down": "belly"})  # chest
box("body", -3.3, 6.5 + L, 3.5, 6.6, 6, 3.8, "coat", {"up": "coat_hi"})                 # haunches

# Legs: long and slim, with paws.
for bone, x in (("leg_fl", -3.0), ("leg_fr", 0.8)):
    box(bone, x, 1, -5, 2.2, 5 + L, 2.2, "coat")
    box(bone, x - 0.2, 0, -5.3, 2.6, 1, 2.8, "paw")
for bone, x in (("leg_bl", -3.4), ("leg_br", 0.6)):
    box(bone, x, 4 + L, 3.6, 2.8, 4.5, 3.2, "coat")                                       # thigh
    box(bone, x + 0.3, 1, 4.3, 2.2, 3 + L, 2.2, "coat")
    box(bone, x + 0.1, 0, 4.0, 2.6, 1, 2.8, "paw")

# Tail: long and thin, curving up like a hook (built as steps so it needs no rotation).
box("tail", -0.55, 11.6 + L, 7.4, 1.1, 1.1, 2.2, "coat")
box("tail", -0.5, 12.5 + L, 9.2, 1.0, 1.4, 1.6, "coat")
box("tail", -0.45, 13.6 + L, 10.3, 0.9, 1.8, 1.1, "coat")
box("tail", -0.4, 15.2 + L, 10.5, 0.8, 1.6, 0.9, "coat")

# Head: a bit narrower than a pit bull's, with a longer muzzle, black nose, and big brown eyes.
box("head", -2.3, 10 + L, -8.5, 4.6, 5, 4, "coat", {"up": "coat_hi"})                 # neck
box("head", -3.3, 11.5 + L, -11.8, 6.6, 5.8, 5, "coat", {"north": "head_front", "up": "coat_hi"})
box("head", -3.6, 11.5 + L, -11, 7.2, 3, 3, "coat")                                    # cheeks
box("head", -1.8, 11.7 + L, -16, 3.6, 3, 4.2, "muzzle", {"north": "muzzle_front", "down": "muzzle"})
box("head", -1.1, 13.9 + L, -16.4, 2.2, 1.1, 0.8, "nose")
# Ears: one stands up (pink inside), the other flops over, just like Graham's.
box("ear_l", -3.5, 16.6 + L, -9.8, 2.4, 3.4, 0.9, "ear", {"north": "ear_inner"})
box("ear_l", -3.1, 20 + L, -9.8, 1.4, 0.9, 0.9, "ear")
box("ear_r", 1.6, 16.6 + L, -10.6, 2.2, 0.9, 2.2, "ear")
box("ear_r", 3.4, 13.6 + L, -10.8, 0.8, 3.6, 2.4, "ear")
# Happy tongue hanging out the front of the mouth.
box("tongue", -0.8, 10.6 + L, -15.6, 1.6, 1.3, 1.6, "tongue")

# Orange collar with a rainbow tag, like Graham's (puppy to big dog).
box("collar", -2.7, 12 + L, -8.8, 5.4, 1.3, 4.6, "collar")
box("collar", -0.25, 11.6 + L, -9.0, 0.5, 0.5, 0.2, "silver")
box("collar", -0.8, 10.1 + L, -9.15, 1.6, 1.5, 0.3, "rainbow")
# Alpha Dog gear: a gold collar with silver spikes, and a saddle to ride on.
box("alpha_gear", -2.8, 11.8 + L, -8.9, 5.6, 1.6, 4.8, "gold")
for sx, sz in ((-3.3, -7.6), (2.7, -7.6), (-3.3, -5.4), (2.7, -5.4), (-1.6, -9.4), (0.8, -9.4)):
    box("alpha_gear", sx, 12.3 + L, sz, 0.6, 0.6, 0.6, "silver")
box("alpha_gear", -3.2, 14.45, -2.5, 6.4, 0.7, 6.5, "saddle")                           # seat
box("alpha_gear", -2.4, 15.1, 3.0, 4.8, 1.1, 1.0, "leather")                            # back of the seat
box("alpha_gear", -1.8, 15.1, -2.8, 3.6, 0.9, 0.8, "leather")                           # front of the seat
box("alpha_gear", -3.25, 8.2, 0.2, 0.25, 6.3, 1.4, "leather")                           # girth straps
box("alpha_gear", 3.0, 8.2, 0.2, 0.25, 6.3, 1.4, "leather")
box("alpha_gear", -3.8, 7.2, 0.3, 0.9, 1.2, 1.2, "silver")                              # stirrups
box("alpha_gear", 2.9, 7.2, 0.3, 0.9, 1.2, 1.2, "silver")

# Sitting pose (bone: [x rotation in degrees, [x, y, z] offset in pixels]). Positive x rotation tips the front down,
# like Minecraft's own head pitch. Written into the resource pack as animation.alpha_dog.sit.
SIT_POSE = {
    "body": [-30, [0, -3.8, 1.2]],          # tip back: chest up, rump down onto the ground
    "head": [24, [0, 0, 0]],                # look ahead again
    "leg_bl": [-75, [0, -5.8, -0.8]],       # back legs folded forward under the hips
    "leg_br": [-75, [0, -5.8, -0.8]],
    "tail": [-28, [0, -8.2, -0.5]],         # tail down along the ground behind
}

# Play bow ("wanna play?"): front end down on the elbows, rump up, tail up, looking up at you.
BOW_POSE = {
    "body": [28, [0, -2.9, 0.4]],
    "head": [-40, [0, 0, 0]],
    "leg_fl": [-82, [0, -6.4, 0.6]],
    "leg_fr": [-82, [0, -6.4, 0.6]],
    "tail": [40, [0, 0.6, 0]],
}

# Lying down for the night: belly on the ground, front paws out in front, head resting low.
LIE_POSE = {
    "body": [0, [0, -6.6, 0]],
    "head": [12, [0, -0.6, 0]],
    "leg_fl": [-86, [0, -6.7, -0.4]],
    "leg_fr": [-86, [0, -6.7, -0.4]],
    "leg_bl": [-84, [0, -8.4, -1.6]],
    "leg_br": [-84, [0, -8.4, -1.6]],
    "tail": [-38, [0, -7.6, -0.4]],
}
POSES = {"sit": SIT_POSE, "play_bow": BOW_POSE, "lie": LIE_POSE}

FACES = ("north", "south", "east", "west", "up", "down")


def dog_geo():
    out = [{"name": "root", "pivot": [0, 0, 0]}]
    for name in BONE_ORDER:
        cubes = []
        for c in bones[name]:
            uv = {}
            for f in FACES:
                pos, size = sw_uv(c["faces"].get(f, c["c"]))
                uv[f] = {"uv": pos, "uv_size": size}
            cubes.append({"origin": list(c["o"]), "size": list(c["s"]), "uv": uv})
        out.append({"name": name, "parent": PARENT.get(name, "root"), "pivot": PIVOTS[name], "cubes": cubes})
    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": "geometry.alpha_dog", "texture_width": TEX_W, "texture_height": TEX_H,
                "visible_bounds_width": 2.5, "visible_bounds_height": 2.5, "visible_bounds_offset": [0, 0.75, 0],
            },
            "bones": out,
        }],
    }


def fur(base, seed):
    """8x8 swatch with a little fur texture so the black coat doesn't look like a flat shadow."""
    rnd = random.Random(seed)
    img = Image.new("RGBA", (8, 8))
    for x in range(8):
        for y in range(8):
            r = rnd.random()
            k = 1.18 if r < 0.16 else 0.86 if r < 0.3 else 1.0
            img.putpixel((x, y), tuple(min(255, int(v * k)) for v in base) + (255,))
    return img


def dog_texture():
    tex = Image.new("RGBA", (TEX_W, TEX_H), (0, 0, 0, 0))
    for i, name in enumerate(SW):
        u, v = (i % 16) * 8, (i // 16) * 8
        base = PAL[name]
        if name in ("coat", "coat_hi", "belly", "muzzle", "paw", "ear"):
            tex.paste(fur(base, i), (u, v))
        else:
            ImageDraw.Draw(tex).rectangle([u, v, u + 7, v + 7], fill=base + (255,))
            if name in ("collar", "gold", "saddle"):          # a shine line along the top
                hi = tuple(min(255, int(c * 1.25 + 20)) for c in base)
                ImageDraw.Draw(tex).line([u, v + 1, u + 7, v + 1], fill=hi + (255,))
    d = ImageDraw.Draw(tex)

    # Face (front of the head), 14 x 12. Row 0 is the top of the head. The muzzle covers the
    # middle of the bottom half, so the eyes sit just above it, wide apart like a pit bull's.
    u, v, w, h = HEAD_FRONT
    tex.paste(fur(PAL["coat"], 99).resize((w, h), Image.NEAREST), (u, v))
    tex.putpixel((u + 3, v + 3), PAL["coat_hi"] + (255,))                 # a little brow shine
    tex.putpixel((u + 10, v + 3), PAL["coat_hi"] + (255,))
    d.line([u + 6, v + 1, u + 7, v + 1], fill=PAL["coat_hi"] + (255,))     # little forehead wrinkle
    for ex in (2, 9):                                                      # big soulful eyes: 3 x 3 each
        d.rectangle([u + ex, v + 4, u + ex + 2, v + 6], fill=(58, 34, 18, 255))    # dark brown
        d.rectangle([u + ex + 1, v + 5, u + ex + 1, v + 6], fill=(20, 13, 10, 255))  # pupil
        tex.putpixel((u + ex + (2 if ex == 2 else 0), v + 4), (255, 255, 255, 255))  # shine, toward the middle
    # Muzzle front, 8 x 7: nose on top (separate cube), mouth line, a hint of a smile.
    u, v, w, h = MUZZLE_FRONT
    tex.paste(fur(PAL["muzzle"], 77).resize((w, h), Image.NEAREST), (u, v))
    d.line([u + 3, v + 3, u + 4, v + 3], fill=(24, 23, 27, 255))         # little dip under the nose
    d.line([u + 2, v + 5, u + 5, v + 5], fill=(24, 23, 27, 255))         # small smile
    tex.putpixel((u + 1, v + 4), (24, 23, 27, 255))
    tex.putpixel((u + 6, v + 4), (24, 23, 27, 255))
    # Inside of the folded ears: a little pinkish-gray.
    u, v, w, h = EAR_INNER
    d.rectangle([u, v, u + w - 1, v + h - 1], fill=PAL["ear"] + (255,))
    d.rectangle([u + 1, v + 1, u + w - 2, v + h - 1], fill=(92, 64, 72, 255))
    # Front of the chest: Graham's white splotch, low and a little lopsided.
    u, v, w, h = CHEST_FRONT
    tex.paste(fur(PAL["coat"], 55).resize((w, h), Image.NEAREST), (u, v))
    for row, (a, b) in {9: (7, 8), 10: (6, 9), 11: (5, 10), 12: (5, 10), 13: (6, 10), 14: (6, 9), 15: (7, 8)}.items():
        d.line([u + a, v + row, u + b, v + row], fill=(246, 244, 240, 255))
    for x, y in ((5, 11), (10, 13), (8, 9)):
        tex.putpixel((u + x, v + y), (206, 204, 202, 255))
    # Rainbow tag
    ru, rv = sw_uv("rainbow")[0]
    for i, c in enumerate([(255, 80, 80), (255, 170, 50), (250, 230, 70), (90, 210, 110), (70, 160, 255), (150, 100, 240), (230, 110, 220), (255, 80, 80)]):
        d.line([ru, rv + i, ru + 7, rv + i], fill=c + (255,))
    # Shiny nose highlight
    nu, nv = sw_uv("nose")[0]
    tex.putpixel((nu + 2, nv + 2), (90, 90, 100, 255))
    tex.putpixel((nu + 3, nv + 2), (70, 70, 80, 255))
    return tex


# ---------------- Egg ----------------
EGG = [(-3, 0, -3, 6, 1, 6), (-4, 1, -4, 8, 6, 8), (-3.5, 7, -3.5, 7, 2, 7), (-2.5, 9, -2.5, 5, 1.5, 5)]
EGG_BASE, EGG_SPOT = (40, 38, 44), (236, 196, 82)


def egg_geo():
    cubes = [{"origin": [x, y, z], "size": [w, h, dd], "uv": {f: {"uv": [0, 0], "uv_size": [8, 8]} for f in FACES}}
             for (x, y, z, w, h, dd) in EGG]
    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {"identifier": "geometry.alpha_dog_egg", "texture_width": 16, "texture_height": 16,
                            "visible_bounds_width": 1.5, "visible_bounds_height": 1.5, "visible_bounds_offset": [0, 0.5, 0]},
            "bones": [{"name": "egg", "pivot": [0, 0, 0], "cubes": cubes}],
        }],
    }


def paw(d, x, y, col):
    """A tiny paw print: pad plus three toes, about 3 x 3."""
    d.rectangle([x, y + 1, x + 2, y + 2], fill=col)
    for tx in (x - 1, x + 1, x + 3):
        d.point((tx, y - 1 if tx == x + 1 else y), fill=col)


def egg_texture():
    tex = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    tex.paste(fur(EGG_BASE, 5), (0, 0))
    paw(ImageDraw.Draw(tex), 3, 3, EGG_SPOT + (255,))
    return tex


def egg_icon():
    tex = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    for x in range(16):
        for y in range(16):
            nx, ny = (x + 0.5 - 8) / 5.6, (y + 0.5 - 9) / 6.8
            if ny < 0:
                nx *= 1.12
            if nx * nx + ny * ny <= 1:
                c = (64, 61, 70) if nx < -0.35 and ny < 0 else EGG_BASE
                tex.putpixel((x, y), c + (255,))
    d = ImageDraw.Draw(tex)
    paw(d, 7, 9, EGG_SPOT + (255,))
    d.point((5, 5), fill=(255, 255, 255, 255))
    out = tex.copy()
    for x in range(16):
        for y in range(16):
            if tex.getpixel((x, y))[3] == 0 and any(
                    0 <= x + a < 16 and 0 <= y + c < 16 and tex.getpixel((x + a, y + c))[3]
                    for a, c in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                out.putpixel((x, y), (200, 160, 60, 255))
    return out


# ---------------- Sleepy "Z" particle ----------------
def zzz_texture():
    img = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.line([1, 1, 6, 1], fill=(255, 255, 255, 255))
    d.line([6, 1, 1, 6], fill=(255, 255, 255, 255))
    d.line([1, 6, 6, 6], fill=(255, 255, 255, 255))
    return img



# ---------------- Dog house (a block) ----------------
# One block footprint, door facing north (-Z), stair-stepped red roof, a bone over the door. The "dog" bone is a
# sleeping Graham (head on his paws in the doorway), only shown when a dog is inside (block state alphadog:occupied).
HOUSE_PAL = {
    "siding": (178, 122, 72), "trim": (122, 78, 44), "floor": (96, 62, 36), "roof": (196, 52, 48), "roof_dark": (150, 36, 36),
    "dark": (30, 22, 18), "bone": (240, 236, 224), "fur": COAT, "nose": (16, 15, 18), "collar": (240, 126, 34),
}
HOUSE_SW = list(HOUSE_PAL)
HOUSE_REGIONS = {"lintel_front": (0, 16, 12, 6), "dog_face": (16, 16, 10, 8), "siding_big": (32, 16, 16, 16)}
house_cubes = {"house": [], "dog": []}


def hbox(bone, x, y, z, w, h, d, color, faces=None):
    house_cubes[bone].append({"o": (x, y, z), "s": (w, h, d), "c": color, "faces": faces or {}})


def house_uv(name):
    if name in HOUSE_REGIONS:
        u, v, w, h = HOUSE_REGIONS[name]
        return [u, v], [w, h]
    i = HOUSE_SW.index(name)
    return [(i % 8) * 8, (i // 8) * 8], [8, 8]


hbox("house", -7, 0, -7, 14, 1, 14, "floor")
hbox("house", -7, 1, -7, 2, 10, 14, "siding", {"west": "siding_big", "east": "siding_big"})   # left wall
hbox("house", 5, 1, -7, 2, 10, 14, "siding", {"west": "siding_big", "east": "siding_big"})    # right wall
hbox("house", -5, 1, 5, 10, 10, 2, "siding", {"south": "siding_big"})                         # back wall
hbox("house", -5, 1, -7, 2, 10, 2, "trim")                                                     # door posts
hbox("house", 3, 1, -7, 2, 10, 2, "trim")
hbox("house", -3, 8, -7, 6, 3, 2, "trim", {"north": "lintel_front"})                         # over the door (bone sign)
hbox("house", -3, 1, -5.5, 6, 7, 0.5, "dark")                                                  # dark inside, behind the door
for i, (y, half) in enumerate([(11, 9), (13, 7), (15, 5), (17, 3), (19, 1)]):                 # stepped roof
    hbox("house", -half, y, -9, half * 2, 2, 18, "roof" if i % 2 == 0 else "roof_dark")
# Sleeping Graham in the doorway: head resting on his front paws, ears flopped, eyes closed, orange collar.
hbox("dog", -3, 1, -9.5, 2, 1, 4, "fur")                                                       # paws
hbox("dog", 1, 1, -9.5, 2, 1, 4, "fur")
hbox("dog", -2.5, 1.6, -8.6, 5, 4, 3.6, "fur", {"north": "dog_face"})                        # head
hbox("dog", -1.6, 1.7, -10.4, 3.2, 2.2, 1.8, "fur")                                            # muzzle
hbox("dog", -0.7, 3.3, -10.6, 1.4, 0.7, 0.4, "nose")
hbox("dog", -3.3, 3.4, -8.3, 1.0, 2.0, 2.2, "fur")                                             # flopped ears
hbox("dog", 2.3, 3.4, -8.3, 1.0, 2.0, 2.2, "fur")
hbox("dog", -2.6, 1.4, -5.4, 5.2, 0.8, 0.6, "collar")


def house_geo():
    bones = []
    for name, cubes in house_cubes.items():
        cs = []
        for c in cubes:
            uv = {}
            for f in FACES:
                pos, size = house_uv(c["faces"].get(f, c["c"]))
                uv[f] = {"uv": pos, "uv_size": size}
            cs.append({"origin": list(c["o"]), "size": list(c["s"]), "uv": uv})
        bones.append({"name": name, "pivot": [0, 0, 0], "cubes": cs})
    return {"format_version": "1.12.0", "minecraft:geometry": [{
        "description": {"identifier": "geometry.alphadog_dog_house", "texture_width": 64, "texture_height": 32},
        "bones": bones}]}


def house_texture():
    tex = Image.new("RGBA", (64, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)
    for i, name in enumerate(HOUSE_SW):
        u, v = (i % 8) * 8, (i // 8) * 8
        base = HOUSE_PAL[name]
        if name == "fur":
            tex.paste(fur(base, 31), (u, v))
            continue
        d.rectangle([u, v, u + 7, v + 7], fill=base + (255,))
        if name in ("siding", "floor", "trim"):                     # plank lines
            line = tuple(int(c * 0.8) for c in base) + (255,)
            for yy in (2, 5):
                d.line([u, v + yy, u + 7, v + yy], fill=line)
        if name.startswith("roof"):                                  # shingle edge
            d.line([u, v + 7, u + 7, v + 7], fill=tuple(int(c * 0.7) for c in base) + (255,))
    # Siding for the big wall faces: planks with seams.
    u, v, w, h = HOUSE_REGIONS["siding_big"]
    d.rectangle([u, v, u + w - 1, v + h - 1], fill=HOUSE_PAL["siding"] + (255,))
    for yy in range(0, h, 3):
        d.line([u, v + yy, u + w - 1, v + yy], fill=tuple(int(c * 0.8) for c in HOUSE_PAL["siding"]) + (255,))
    # Over the door: a white bone on dark trim.
    u, v, w, h = HOUSE_REGIONS["lintel_front"]
    d.rectangle([u, v, u + w - 1, v + h - 1], fill=HOUSE_PAL["trim"] + (255,))
    bone = HOUSE_PAL["bone"] + (255,)
    d.line([u + 3, v + 3, u + 8, v + 3], fill=bone)
    for bx in (2, 9):
        d.point((bx, v + 2), fill=bone) if False else None
        d.rectangle([u + bx, v + 2, u + bx + 1, v + 2], fill=bone)
        d.rectangle([u + bx, v + 4, u + bx + 1, v + 4], fill=bone)
    # Sleeping face: closed eyes (little arcs), black fur.
    u, v, w, h = HOUSE_REGIONS["dog_face"]
    tex.paste(fur(PAL["coat"], 13).resize((w, h), Image.NEAREST), (u, v))
    lid = (110, 104, 118, 255)
    for ex in (1, 6):
        d.line([u + ex, v + 4, u + ex + 2, v + 4], fill=lid)
        d.point((u + ex, v + 3), fill=lid)
        d.point((u + ex + 2, v + 3), fill=lid)
    return tex


# ---------------- Writing the pack ----------------
def write_pack(rp, icon_png=None):
    def save_json(rel, obj):
        p = os.path.join(rp, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            json.dump(obj, f, indent=1)

    def save_png(rel, img):
        p = os.path.join(rp, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        img.save(p)

    save_json("models/entity/alpha_dog.geo.json", dog_geo())
    save_png("textures/entity/alpha_dog.png", dog_texture())
    save_json("models/entity/alpha_dog_egg.geo.json", egg_geo())
    save_png("textures/entity/alpha_dog_egg.png", egg_texture())
    save_png("textures/items/alpha_dog_egg.png", egg_icon())
    save_png("textures/particle/alphadog_zzz.png", zzz_texture())
    save_json("models/blocks/alphadog_dog_house.geo.json", house_geo())
    save_png("textures/blocks/alphadog_dog_house.png", house_texture())
    anim_path = os.path.join(rp, "animations/alpha_dog.animation.json")
    if os.path.exists(anim_path):
        anims = json.load(open(anim_path))
        for pname, pose in POSES.items():
            anims["animations"][f"animation.alpha_dog.{pname}"] = {"loop": True, "bones": {
                b: {"rotation": [ang, 0, 0], "position": off} for b, (ang, off) in pose.items()}}
        with open(anim_path, "w") as f:
            json.dump(anims, f, indent=2)
            f.write("\n")
    print(f"dog: {sum(len(v) for v in bones.values())} cubes in {len(BONE_ORDER)} bones")


# ---------------- Preview ----------------
def cube_faces(x, y, z, w, h, dd):
    X, Y, Z = [x, x + w], [z, z + dd], [y, y + h]  # plot axes: X = model x, Y = model z, Z = up
    return {
        "down": [(X[0], Y[0], Z[0]), (X[1], Y[0], Z[0]), (X[1], Y[1], Z[0]), (X[0], Y[1], Z[0])],
        "up": [(X[0], Y[0], Z[1]), (X[1], Y[0], Z[1]), (X[1], Y[1], Z[1]), (X[0], Y[1], Z[1])],
        "north": [(X[0], Y[0], Z[0]), (X[1], Y[0], Z[0]), (X[1], Y[0], Z[1]), (X[0], Y[0], Z[1])],
        "south": [(X[0], Y[1], Z[0]), (X[1], Y[1], Z[0]), (X[1], Y[1], Z[1]), (X[0], Y[1], Z[1])],
        "west": [(X[0], Y[0], Z[0]), (X[0], Y[1], Z[0]), (X[0], Y[1], Z[1]), (X[0], Y[0], Z[1])],
        "east": [(X[1], Y[0], Z[0]), (X[1], Y[1], Z[0]), (X[1], Y[1], Z[1]), (X[1], Y[0], Z[1])],
    }


SHADE = {"up": 1.0, "north": 0.82, "south": 0.7, "west": 0.62, "east": 0.88, "down": 0.5}


def dog_polys(tex, scale, ox, alpha, puppy, pose=None):
    import math
    polys, cols = [], []
    head_k, head_pivot = (1.35 if puppy else 1.0), PIVOTS["head"]
    pose = pose or {}

    def posed(bone, my, mz):
        # Apply this bone's pose, then its parent's, and so on (children move with their parents).
        b = bone
        while b and b != "root":
            if b in pose:
                ang, off = pose[b]
                py, pz = PIVOTS[b][1], PIVOTS[b][2]
                t = math.radians(ang)
                ry, rz = my - py, mz - pz
                my, mz = py + ry * math.cos(t) + rz * math.sin(t), pz - ry * math.sin(t) + rz * math.cos(t)
                my, mz = my + off[1], mz + off[2]
            b = PARENT.get(b, "root")
        return my, mz

    def tf(p, bone):
        x, y, z = p  # plot coords: x, model z, up
        if bone in ("head", "ear_l", "ear_r", "tongue") and head_k != 1:
            x = x * head_k
            y = head_pivot[2] + (y - head_pivot[2]) * head_k
            z = head_pivot[1] + (z - head_pivot[1]) * head_k
        z, y = posed(bone, z, y)
        return (x * scale + ox, y * scale, z * scale)

    for bone in BONE_ORDER:
        if bone == "collar" and alpha or bone == "alpha_gear" and not alpha:
            continue
        for c in bones[bone]:
            (x, y, z), (w, h, dd) = c["o"], c["s"]
            for fname, f in cube_faces(x, y, z, w, h, dd).items():
                sw = c["faces"].get(fname, c["c"])
                if sw in ("head_front", "muzzle_front", "chest_front", "ear_inner") and fname == "north":
                    u, v, tw, th = REGIONS[sw]
                    for px in range(tw):
                        for py in range(th):
                            p = tex.getpixel((u + px, v + py))
                            X0 = x + w - (px + 1) * w / tw
                            Z0 = y + h - (py + 1) * h / th
                            q = [(X0, z - 0.02, Z0), (X0 + w / tw, z - 0.02, Z0), (X0 + w / tw, z - 0.02, Z0 + h / th), (X0, z - 0.02, Z0 + h / th)]
                            polys.append([tf(pt, bone) for pt in q])
                            cols.append(tuple(min(1, q2 / 255 * 0.95 + 0.02) for q2 in p[:3]) + (1,))
                    continue
                (su, sv), _ = sw_uv(sw)
                p = tex.getpixel((su + 3, sv + 3))
                k = SHADE[fname]
                lift = 0.07 if sw in ("coat", "coat_hi", "belly", "muzzle", "paw", "ear", "nose") else 0
                polys.append([tf(pt, bone) for pt in f])
                cols.append(tuple(min(1, q2 / 255 * k + lift * k) for q2 in p[:3]) + (1,))
    return polys, cols


def render_preview(path, icon_path=None):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    tex = dog_texture()
    bg = (0.94, 0.97, 0.92)
    fig = plt.figure(figsize=(18, 7), dpi=120)
    fig.patch.set_facecolor(bg)
    ax = fig.add_subplot(1, 1, 1, projection="3d")
    ax.set_facecolor(bg)
    polys, cols, x = [], [], -10
    labels = []
    # Egg first, then each stage side by side at its in-game size.
    for (ex, ey, ez, w, h, dd) in EGG:
        for f in cube_faces(ex, ey, ez, w, h, dd).values():
            polys.append([(p[0] + x, p[1], p[2]) for p in f])
            cols.append(tuple(c / 255 for c in EGG_BASE) + (1,))
    labels.append(("Egg", x, 14))
    x += 12
    shows = [(n, s, i, None) for i, (n, s) in enumerate(STAGES)]
    shows.insert(3, ("Big Dog sitting", 1.0, 2, SIT_POSE))
    shows.append(("Alpha sitting", 2.2, 3, SIT_POSE))
    for name, s, i, pose in shows:
        x += 9 * s + 2
        p, c = dog_polys(tex, s, x, alpha=(i == 3), puppy=(i == 0), pose=pose)
        polys += p; cols += c
        labels.append((name, x, 20 * s + 6))
        x += 9 * s + 6
    ax.add_collection3d(Poly3DCollection(polys, facecolors=cols, edgecolors=(0, 0, 0, 0.18), linewidths=0.12))
    # Ground grid: one square = one block.
    for gx in range(-16, int(x) + 16, 16):
        ax.plot([gx, gx], [-16, 16], [0, 0], color=(0.6, 0.75, 0.55), lw=0.4)
    for gy in range(-16, 17, 16):
        ax.plot([-16, x + 8], [gy, gy], [0, 0], color=(0.6, 0.75, 0.55), lw=0.4)
    for name, lx, lz in labels:
        ax.text(lx, 0, lz, name, ha="center", fontsize=11, color=(0.25, 0.2, 0.15))
    ax.set_xlim(-16, x + 8); ax.set_ylim(-24, 24); ax.set_zlim(0, 50)
    ax.set_box_aspect((x + 24, 48, 50), zoom=1.45)
    ax.view_init(elev=14, azim=-58)
    ax.axis("off")
    plt.subplots_adjust(left=0, right=1, top=1, bottom=0)
    plt.savefig(path, facecolor=bg, bbox_inches="tight", pad_inches=0.1)
    plt.close(fig)

    if icon_path:  # pack icon: the alpha dog, close up
        fig = plt.figure(figsize=(2.56, 2.56), dpi=100)
        fig.patch.set_facecolor((0.36, 0.62, 0.86))
        ax = fig.add_subplot(1, 1, 1, projection="3d")
        ax.set_facecolor((0.36, 0.62, 0.86))
        p, c = dog_polys(tex, 1.0, 0, alpha=True, puppy=False)
        ax.add_collection3d(Poly3DCollection(p, facecolors=c, edgecolors=(0, 0, 0, 0.2), linewidths=0.2))
        ax.set_xlim(-12, 12); ax.set_ylim(-18, 14); ax.set_zlim(-1, 24)
        ax.set_box_aspect((24, 32, 25))
        ax.view_init(elev=10, azim=-62)
        ax.axis("off")
        plt.subplots_adjust(left=-0.25, right=1.25, top=1.25, bottom=-0.25)
        plt.savefig(icon_path, facecolor=fig.get_facecolor())
        plt.close(fig)


def render_house_preview(path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    tex = house_texture()
    fig = plt.figure(figsize=(12, 5.5), dpi=110)
    bg = (0.94, 0.97, 0.92)
    fig.patch.set_facecolor(bg)
    for k, (title, occupied) in enumerate((("Dog house", False), ("Graham asleep inside", True))):
        ax = fig.add_subplot(1, 2, k + 1, projection="3d")
        ax.set_facecolor(bg)
        polys, cols = [], []
        for bone in ("house", "dog") if occupied else ("house",):
            for c in house_cubes[bone]:
                for fname, f in cube_faces(*c["o"], *c["s"]).items():
                    sw = c["faces"].get(fname, c["c"])
                    if sw in HOUSE_REGIONS and fname in ("north",):
                        u, v, tw, th = HOUSE_REGIONS[sw]
                        (x, y, z), (w, h, dd) = c["o"], c["s"]
                        for px in range(tw):
                            for py in range(th):
                                pcol = tex.getpixel((u + px, v + py))
                                X0 = x + w - (px + 1) * w / tw
                                Z0 = y + h - (py + 1) * h / th
                                polys.append([(X0, z - 0.02, Z0), (X0 + w / tw, z - 0.02, Z0), (X0 + w / tw, z - 0.02, Z0 + h / th), (X0, z - 0.02, Z0 + h / th)])
                                cols.append(tuple(q / 255 * SHADE[fname] for q in pcol[:3]) + (1,))
                        continue
                    (su, sv), _ = house_uv(sw)
                    pcol = tex.getpixel((su + 3, sv + 3))
                    polys.append(f)
                    cols.append(tuple(min(1, q / 255 * SHADE[fname] + (0.05 if sw == "fur" else 0)) for q in pcol[:3]) + (1,))
        ax.add_collection3d(Poly3DCollection(polys, facecolors=cols, edgecolors=(0, 0, 0, 0.18), linewidths=0.15))
        ax.set_xlim(-11, 11); ax.set_ylim(-13, 11); ax.set_zlim(0, 22); ax.set_box_aspect((22, 24, 22))
        ax.view_init(elev=14, azim=-62); ax.axis("off")
        ax.set_title(title, fontsize=12, color=(0.25, 0.2, 0.15))
    plt.subplots_adjust(left=0, right=1, top=0.94, bottom=0, wspace=0)
    plt.savefig(path, facecolor=bg)
    plt.close(fig)


if __name__ == "__main__":
    rp = sys.argv[1]
    write_pack(rp)
    if len(sys.argv) > 2:
        icon = os.path.join(rp, "pack_icon.png")
        render_preview(sys.argv[2], icon)
        render_house_preview(sys.argv[2].replace(".png", "_house.png"))
        bp = rp[:-3] + "_BP" if rp.rstrip("/").endswith("_RP") else None
        if bp and os.path.isdir(bp):
            Image.open(icon).save(os.path.join(bp, "pack_icon.png"))
