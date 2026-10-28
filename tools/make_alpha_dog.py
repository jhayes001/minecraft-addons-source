"""Builds the models and textures for the Alpha Dog add-on, and optionally a preview picture.

The dog is modeled after Graham, Havana's black pit bull mix: short shiny black coat, wide head
with big cheeks, a short muzzle, folded "rose" ears, a broad chest, a thin tail, and brown eyes.

Writes into the resource pack:
  models/entity/alpha_dog.geo.json        dog model (one model; each growth stage is minecraft:scale)
  textures/entity/alpha_dog.png           dog texture
  models/entity/alpha_dog_egg.geo.json + textures/entity/alpha_dog_egg.png
  textures/items/alpha_dog_egg.png        inventory icon
And pack_icon.png into the resource pack and the behavior pack next to it.

Model units are pixels (16 = one block), feet at y = 0, the dog faces north (-Z). Scale 1.0 is a
large adult dog. Every face is painted from an 8x8 fur swatch, except the face, the muzzle front,
and the inside of the ears, which have their own drawings.

Bones: root > body, head (look), ear_l/ear_r, tongue, tail (wag), leg_* (walk), collar (puppy to
large), alpha_gear (gold spiked collar and saddle, shown only on the Alpha Dog).

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
    "collar": (214, 40, 52),
    "gold": (246, 198, 64),
    "silver": (228, 230, 238),
    "saddle": (150, 44, 44),
    "leather": (112, 70, 40),
}
SW = list(PAL)
HEAD_FRONT = (0, 16, 14, 12)    # u, v, w, h in the texture (2 texture pixels per model pixel)
MUZZLE_FRONT = (16, 16, 8, 7)
EAR_INNER = (26, 16, 4, 4)
TEX_W, TEX_H = 128, 32


def sw_uv(name):
    if name == "head_front":
        return [HEAD_FRONT[0], HEAD_FRONT[1]], [HEAD_FRONT[2], HEAD_FRONT[3]]
    if name == "muzzle_front":
        return [MUZZLE_FRONT[0], MUZZLE_FRONT[1]], [MUZZLE_FRONT[2], MUZZLE_FRONT[3]]
    if name == "ear_inner":
        return [EAR_INNER[0], EAR_INNER[1]], [EAR_INNER[2], EAR_INNER[3]]
    i = SW.index(name)
    return [(i % 16) * 8, (i // 16) * 8], [8, 8]


BONE_ORDER = ["body", "leg_fl", "leg_fr", "leg_bl", "leg_br", "tail", "head", "ear_l", "ear_r", "tongue", "collar", "alpha_gear"]
PARENT = {"head": "body", "ear_l": "head", "ear_r": "head", "tongue": "head", "collar": "body", "alpha_gear": "body"}
PIVOTS = {
    "body": [0, 10, 0], "head": [0, 13, -6],
    "leg_fl": [-2.2, 6, -3.7], "leg_fr": [2.2, 6, -3.7], "leg_bl": [-2.4, 7, 4.8], "leg_br": [2.4, 7, 4.8],
    "tail": [0, 12, 7], "ear_l": [-3, 17, -9.5], "ear_r": [3, 17, -9.5], "tongue": [0, 11.5, -14],
    "collar": [0, 12, -6], "alpha_gear": [0, 12, 0],
}
bones = {b: [] for b in BONE_ORDER}


def box(bone, x, y, z, w, h, d, color, faces=None):
    """faces: optional {face: swatch} overrides, e.g. {"north": "head_front"}."""
    bones[bone].append({"o": (x, y, z), "s": (w, h, d), "c": color, "faces": faces or {}})


# Body: a long torso with a deep, wide chest in front (pit bulls are built like little tanks).
box("body", -3.5, 6, -5, 7, 7, 12.5, "coat", {"up": "coat_hi", "down": "belly"})
box("body", -4, 5, -6.5, 8, 8, 5, "coat", {"up": "coat_hi", "down": "belly"})        # chest
box("body", -3.75, 6.5, 3.5, 7.5, 6.5, 3.5, "coat", {"up": "coat_hi"})               # haunches

# Legs: thick and straight, with paws.
for bone, x in (("leg_fl", -3.5), ("leg_fr", 0.9)):
    box(bone, x, 1, -5, 2.6, 5.5, 2.6, "coat")
    box(bone, x - 0.2, 0, -5.4, 3, 1, 3, "paw")
for bone, x in (("leg_bl", -3.9), ("leg_br", 0.9)):
    box(bone, x, 3.5, 3.6, 3, 4, 3, "coat")                                              # thigh
    box(bone, x + 0.2, 1, 4.1, 2.6, 2.5, 2.4, "coat")
    box(bone, x, 0, 3.8, 3, 1, 3, "paw")

# Tail: thin and a little raised, built as small steps so it needs no rotation.
box("tail", -0.6, 11.5, 7, 1.2, 1.2, 2.5, "coat")
box("tail", -0.5, 12.2, 9.3, 1, 1, 2.2, "coat")
box("tail", -0.4, 12.9, 11.3, 0.8, 0.8, 2, "coat")

# Head: wide skull, big cheeks, short muzzle, black nose, brown eyes (drawn on the face).
box("head", -2.6, 10, -8.5, 5.2, 5, 4, "coat", {"up": "coat_hi"})                  # neck
box("head", -3.6, 11.5, -12, 7.2, 6, 5, "coat", {"north": "head_front", "up": "coat_hi"})
box("head", -4.1, 11.5, -11.2, 8.2, 3.6, 3.2, "coat")                                # cheeks
box("head", -2.1, 11.6, -15, 4.2, 3.3, 3, "muzzle", {"north": "muzzle_front", "down": "muzzle"})
box("head", -1.1, 14.1, -15.4, 2.2, 1.1, 0.8, "nose")
# Rose ears: folded over at the top corners of the head.
box("ear_l", -4.2, 16.6, -10.6, 2.2, 1.4, 1.6, "ear", {"north": "ear_inner"})
box("ear_l", -4.5, 15.6, -10.6, 0.9, 1.4, 1.6, "ear")
box("ear_r", 2.0, 16.6, -10.6, 2.2, 1.4, 1.6, "ear", {"north": "ear_inner"})
box("ear_r", 3.6, 15.6, -10.6, 0.9, 1.4, 1.6, "ear")
# Happy tongue hanging out the front of the mouth.
box("tongue", -0.9, 10.4, -14.6, 1.8, 1.3, 1.6, "tongue")

# Red collar with a gold tag (puppy to big dog).
box("collar", -2.9, 12, -8.8, 5.8, 1.2, 4.6, "collar")
box("collar", -0.6, 10.8, -9.05, 1.2, 1.2, 0.3, "gold")
# Alpha Dog gear: a gold collar with silver spikes, and a saddle to ride on.
box("alpha_gear", -3.0, 11.8, -8.9, 6.0, 1.6, 4.8, "gold")
for sx, sz in ((-3.5, -7.6), (2.9, -7.6), (-3.5, -5.4), (2.9, -5.4), (-1.6, -9.4), (0.8, -9.4)):
    box("alpha_gear", sx, 12.3, sz, 0.6, 0.6, 0.6, "silver")
box("alpha_gear", -3.7, 12.95, -2.5, 7.4, 0.7, 6.5, "saddle")                         # seat
box("alpha_gear", -2.6, 13.6, 3.0, 5.2, 1.1, 1.0, "leather")                          # back of the seat
box("alpha_gear", -2.0, 13.6, -2.8, 4.0, 0.9, 0.8, "leather")                         # front of the seat
box("alpha_gear", -3.75, 7.4, 0.2, 0.25, 5.6, 1.4, "leather")                         # girth straps
box("alpha_gear", 3.5, 7.4, 0.2, 0.25, 5.6, 1.4, "leather")
box("alpha_gear", -4.3, 6.4, 0.3, 0.9, 1.2, 1.2, "silver")                            # stirrups
box("alpha_gear", 3.4, 6.4, 0.3, 0.9, 1.2, 1.2, "silver")

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
    d.line([u + 2, v + 3, u + 5, v + 3], fill=PAL["coat_hi"] + (255,))     # brow shine
    d.line([u + 8, v + 3, u + 11, v + 3], fill=PAL["coat_hi"] + (255,))
    d.line([u + 6, v + 1, u + 7, v + 1], fill=PAL["coat_hi"] + (255,))     # little forehead wrinkle
    for ex in (2, 9):                                                      # eyes: 3 x 2 each
        d.rectangle([u + ex, v + 4, u + ex + 2, v + 5], fill=(122, 74, 32, 255))   # brown iris
        d.rectangle([u + ex + 1, v + 4, u + ex + 1, v + 5], fill=(24, 16, 12, 255))  # pupil
        tex.putpixel((u + ex + (2 if ex == 2 else 0), v + 4), (255, 255, 255, 255))  # sparkle, toward the middle
    # Muzzle front, 8 x 7: nose on top (separate cube), mouth line, a hint of a smile.
    u, v, w, h = MUZZLE_FRONT
    tex.paste(fur(PAL["muzzle"], 77).resize((w, h), Image.NEAREST), (u, v))
    d.line([u + 3, v + 2, u + 3, v + 4], fill=(18, 17, 20, 255))
    d.line([u + 4, v + 2, u + 4, v + 4], fill=(18, 17, 20, 255))
    d.line([u + 1, v + 5, u + 6, v + 5], fill=(18, 17, 20, 255))
    tex.putpixel((u + 0, v + 4), (18, 17, 20, 255))
    tex.putpixel((u + 7, v + 4), (18, 17, 20, 255))
    # Inside of the folded ears: a little pinkish-gray.
    u, v, w, h = EAR_INNER
    d.rectangle([u, v, u + w - 1, v + h - 1], fill=PAL["ear"] + (255,))
    d.rectangle([u + 1, v + 1, u + w - 2, v + h - 1], fill=(92, 64, 72, 255))
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


def dog_polys(tex, scale, ox, alpha, puppy):
    polys, cols = [], []
    head_k, head_pivot = (1.35 if puppy else 1.0), PIVOTS["head"]

    def tf(p, bone):
        x, y, z = p  # plot coords: x, model z, up
        if bone in ("head", "ear_l", "ear_r", "tongue") and head_k != 1:
            x = x * head_k
            y = head_pivot[2] + (y - head_pivot[2]) * head_k
            z = head_pivot[1] + (z - head_pivot[1]) * head_k
        return (x * scale + ox, y * scale, z * scale)

    for bone in BONE_ORDER:
        if bone == "collar" and alpha or bone == "alpha_gear" and not alpha:
            continue
        for c in bones[bone]:
            (x, y, z), (w, h, dd) = c["o"], c["s"]
            for fname, f in cube_faces(x, y, z, w, h, dd).items():
                sw = c["faces"].get(fname, c["c"])
                if sw in ("head_front", "muzzle_front") and fname == "north":
                    u, v, tw, th = HEAD_FRONT if sw == "head_front" else MUZZLE_FRONT
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
    fig = plt.figure(figsize=(14, 7), dpi=120)
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
    for i, (name, s) in enumerate(STAGES):
        x += 9 * s + 2
        p, c = dog_polys(tex, s, x, alpha=(i == 3), puppy=(i == 0))
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
        ax.set_xlim(-10, 10); ax.set_ylim(-16, 14); ax.set_zlim(0, 20)
        ax.set_box_aspect((20, 30, 20))
        ax.view_init(elev=10, azim=-62)
        ax.axis("off")
        plt.subplots_adjust(left=-0.25, right=1.25, top=1.25, bottom=-0.25)
        plt.savefig(icon_path, facecolor=fig.get_facecolor())
        plt.close(fig)


if __name__ == "__main__":
    rp = sys.argv[1]
    write_pack(rp)
    if len(sys.argv) > 2:
        icon = os.path.join(rp, "pack_icon.png")
        render_preview(sys.argv[2], icon)
        bp = rp[:-3] + "_BP" if rp.rstrip("/").endswith("_RP") else None
        if bp and os.path.isdir(bp):
            Image.open(icon).save(os.path.join(bp, "pack_icon.png"))
