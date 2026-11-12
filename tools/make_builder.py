"""Builds the model, textures and item icon for the House Blueprint's construction worker, and optionally a preview.

The Builder's Blueprint calls a construction worker who builds the frame of a house one block at a time
(walls, floors, windows, roof, stairs and the front door) and leaves the decorating to the player.
The worker wears a yellow hard hat, a hi-vis vest with silver stripes, jeans, work boots, gloves and a
tool belt, and carries a hammer. There are four looks (the entity `variant`, 0-3); looks 1 and 3 have a
ponytail (shown by the render controller). Keep LOOKS in sync with BUILDER_LOOKS in main.js.

What the worker is doing is the entity `mark_variant`: 0 standing, 1 walking, 2 hammering, 3 waving, 4 cheering.

Writes into the resource pack:
  models/entity/house_builder.geo.json       the worker
  textures/entity/house_builder_<0-3>.png    one texture per look
  animations/house_builder.animation.json    idle, walk, hammer, wave, cheer
  textures/items/builder_blueprint.png       the Builder's Blueprint (a yellow version of the House Blueprint)

Units are pixels, feet at y = 0, facing north (-Z), player-sized (32 pixels = 2 blocks to the top of the head).
Positive x rotation tips the top of a bone forward, so -90 on an arm points it straight ahead.

Usage: python3 make_builder.py <resource_pack_dir> [preview.png]
"""
import json, math, os, sys
from PIL import Image, ImageDraw

LOOKS = [
    # skin,           hair,           vest,            ponytail
    ((236, 190, 156), (110, 72, 42),  (250, 126, 30),  False),   # brown hair, mustache
    ((206, 150, 108), (40, 30, 28),   (170, 230, 40),  True),    # black ponytail
    ((128, 84, 58),   (30, 24, 22),   (250, 126, 30),  False),   # short beard
    ((246, 206, 176), (196, 92, 40),  (170, 230, 40),  True),    # red ponytail, freckles
]
SW = ["skin", "hair", "shirt", "vest", "jeans", "boot", "belt", "pouch", "glove", "hat", "hat_dark",
      "wood", "iron", "head_side", "sleeve"]
FACE = (0, 40, 8, 8)
REGIONS = {"face": FACE}
TEX_W, TEX_H = 128, 64


def sw_uv(name):
    if name in REGIONS:
        u, v, w, h = REGIONS[name]
        return [u, v], [w, h]
    i = SW.index(name)
    return [(i % 16) * 8, (i // 16) * 8], [8, 8]


BONE_ORDER = ["body", "head", "hat", "ponytail", "arm_l", "arm_r", "hammer", "leg_l", "leg_r"]
PARENT = {"head": "body", "hat": "head", "ponytail": "head", "arm_l": "body", "arm_r": "body", "hammer": "arm_r"}
PIVOTS = {
    "body": [0, 12, 0], "head": [0, 24, 0], "hat": [0, 24, 0], "ponytail": [0, 28, 4],
    "arm_l": [-6, 22, 0], "arm_r": [6, 22, 0], "hammer": [6, 13, 0], "leg_l": [-2, 12, 0], "leg_r": [2, 12, 0],
}
bones = {b: [] for b in BONE_ORDER}


def box(bone, x, y, z, w, h, d, color, faces=None):
    bones[bone].append({"o": (x, y, z), "s": (w, h, d), "c": color, "faces": faces or {}})


for bone, x0 in (("leg_l", -4), ("leg_r", 0)):
    box(bone, x0, 3, -2, 4, 9, 4, "jeans")
    box(bone, x0 - 0.25, 0, -2.6, 4.5, 3.2, 4.85, "boot")          # chunky work boots, toe sticking out

box("body", -4, 12, -2, 8, 12, 4, "shirt")
box("body", -4.3, 13.5, -2.3, 8.6, 10.2, 4.6, "vest")               # hi-vis vest
box("body", -4.5, 12, -2.5, 9, 1.8, 5, "belt")                      # tool belt...
box("body", -5.6, 10.6, -1.6, 1.4, 2.8, 3, "pouch")                 # ...with pouches
box("body", 4.2, 10.6, -1.6, 1.4, 2.8, 3, "pouch")
box("body", -1, 10.4, 2.4, 2, 2.4, 1, "pouch")

box("head", -4, 24, -4, 8, 8, 8, "head_side", {"north": "face", "south": "hair", "up": "hair"})
box("hat", -4.5, 29.6, -4.5, 9, 2.6, 9, "hat")                      # hard hat dome
box("hat", -3.6, 32.2, -3.6, 7.2, 1.2, 7.2, "hat")
box("hat", -0.6, 32.2, -4.2, 1.2, 1.6, 8.4, "hat_dark")             # the ridge down the middle
box("hat", -5, 29.2, -6.6, 10, 0.7, 11.6, "hat_dark")               # brim, longer at the front
box("ponytail", -1.2, 23.5, 4, 2.4, 5, 2, "hair")
box("ponytail", -0.9, 21.2, 4.4, 1.8, 2.6, 1.6, "hair")

for bone, x0 in (("arm_l", -8), ("arm_r", 4)):
    box(bone, x0, 18.5, -2, 4, 5.5, 4, "sleeve")
    box(bone, x0, 15, -2, 4, 3.5, 4, "skin")
    box(bone, x0 - 0.2, 11.6, -2.2, 4.4, 3.6, 4.4, "glove")

# Hammer in the right fist (around x 6, y 13): the handle points forward, the head stands up at the end.
box("hammer", 5.4, 12.4, -9.5, 1.2, 1.2, 9, "wood")
box("hammer", 4.9, 11.0, -11.5, 2.2, 4.4, 2.2, "iron")
box("hammer", 5.3, 15.4, -11.2, 1.4, 1.2, 1.6, "iron")               # claw

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
        out.append({"name": name, "parent": PARENT.get(name, "root"), "pivot": PIVOTS[name], "cubes": cubes})
    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": "geometry.house_builder", "texture_width": TEX_W, "texture_height": TEX_H,
                "visible_bounds_width": 3, "visible_bounds_height": 3, "visible_bounds_offset": [0, 1.25, 0],
            },
            "bones": out,
        }],
    }


def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


def texture(i):
    skin, hair, vest, pony = LOOKS[i]
    tex = Image.new("RGBA", (TEX_W, TEX_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)
    px = lambda x, y, c: tex.putpixel((x, y), c + (255,))

    def fill(sw, col):
        (x, y), _ = sw_uv(sw)
        d.rectangle([x, y, x + 7, y + 7], fill=col + (255,))
        return x, y

    fill("skin", skin)
    x, y = fill("hair", hair)
    for k in range(0, 8, 3):
        px(x + k, y + 2, shade(hair, 0.8)); px(x + k + 1, y + 5, shade(hair, 1.15))
    x, y = fill("shirt", (92, 120, 168))                                 # blue work shirt
    x, y = fill("sleeve", (92, 120, 168))
    d.line([x, y + 7, x + 7, y + 7], fill=shade((92, 120, 168), 0.8) + (255,))
    x, y = fill("vest", vest)
    for row in (2, 5):                                                   # reflective stripes
        d.line([x, y + row, x + 7, y + row], fill=(214, 220, 226, 255))
    x, y = fill("jeans", (58, 86, 140))
    for k in (1, 6):
        d.line([x + k, y, x + k, y + 7], fill=(48, 72, 120, 255))
    x, y = fill("boot", (120, 78, 40))
    d.line([x, y + 6, x + 7, y + 6], fill=(60, 40, 24, 255)); d.line([x, y + 7, x + 7, y + 7], fill=(60, 40, 24, 255))
    px(x + 2, y + 2, (232, 200, 120)); px(x + 5, y + 2, (232, 200, 120))  # laces
    x, y = fill("belt", (96, 62, 34))
    px(x + 3, y + 3, (200, 200, 206)); px(x + 4, y + 3, (200, 200, 206))
    x, y = fill("pouch", (150, 104, 60))
    d.line([x, y + 1, x + 7, y + 1], fill=(110, 74, 40, 255))
    px(x + 2, y, (190, 194, 204)); px(x + 5, y, (246, 196, 56))          # a screwdriver and a pencil poking out
    x, y = fill("glove", (214, 176, 112))
    d.line([x, y, x + 7, y], fill=(186, 146, 84, 255))
    x, y = fill("hat", (250, 204, 34))
    px(x + 2, y + 2, (255, 236, 130)); px(x + 3, y + 2, (255, 236, 130))  # shine
    fill("hat_dark", (226, 170, 20))
    x, y = fill("wood", (150, 102, 58))
    d.line([x, y + 3, x + 7, y + 3], fill=(126, 84, 46, 255))
    x, y = fill("iron", (168, 172, 182))
    px(x + 2, y + 2, (230, 232, 238))
    # Sides of the head: hair on top (under the hat) and at the back, an ear, skin below.
    x, y = fill("head_side", skin)
    d.rectangle([x, y, x + 7, y + 2], fill=hair + (255,))
    d.rectangle([x + 5, y + 3, x + 7, y + 5], fill=hair + (255,))
    px(x + 3, y + 4, shade(skin, 0.85)); px(x + 3, y + 5, shade(skin, 0.85))

    # Face (8x8). The top two rows are under the hard hat.
    fx, fy, fw, fh = FACE
    d.rectangle([fx, fy, fx + 7, fy + 7], fill=skin + (255,))
    d.rectangle([fx, fy, fx + 7, fy + 1], fill=hair + (255,))
    for c in (0, 1, 6, 7):
        px(fx + c, fy + 2, hair)                                         # hair at the temples
    eye = (40, 34, 44)
    for ex in (1, 5):
        px(fx + ex, fy + 3, shade(hair, 0.75)); px(fx + ex + 1, fy + 3, shade(hair, 0.75))  # eyebrows
        px(fx + ex, fy + 4, (255, 255, 255)); px(fx + ex + 1, fy + 4, eye)
    px(fx + 3, fy + 5, shade(skin, 0.82)); px(fx + 4, fy + 5, shade(skin, 0.82))           # nose
    mouth = (150, 70, 66)
    if i == 0:                                                           # big friendly mustache
        for c in range(1, 7):
            px(fx + c, fy + 6, shade(hair, 0.9))
        px(fx + 3, fy + 7, mouth); px(fx + 4, fy + 7, mouth)
    elif i == 2:                                                         # short beard around a smile
        for c in range(8):
            px(fx + c, fy + 7, hair)
        px(fx, fy + 6, hair); px(fx + 7, fy + 6, hair)
        for c in (2, 3, 4, 5):
            px(fx + c, fy + 6, (236, 236, 236) if c in (3, 4) else mouth)
    else:
        px(fx + 2, fy + 6, mouth); px(fx + 5, fy + 6, mouth)
        px(fx + 3, fy + 7, mouth); px(fx + 4, fy + 7, mouth)
        px(fx, fy + 5, (236, 150, 140)); px(fx + 7, fy + 5, (236, 150, 140))   # rosy cheeks
    if i == 3:
        for c in (1, 6):
            px(fx + c, fy + 5, shade(skin, 0.8))                         # freckles
    return tex


def animations():
    walk = "query.life_time * 760"
    return {
        "format_version": "1.8.0",
        "animations": {
            "animation.house_builder.idle": {
                "loop": True,
                "bones": {
                    "head": {"rotation": [0, f"math.sin(query.life_time * 40) * 10", 0]},
                    "arm_l": {"rotation": [f"math.sin(query.life_time * 90) * 3", 0, -3]},
                    "arm_r": {"rotation": [f"-math.sin(query.life_time * 90) * 3", 0, 3]},
                },
            },
            "animation.house_builder.walk": {
                "loop": True,
                "bones": {
                    "leg_l": {"rotation": [f"math.cos({walk}) * 36", 0, 0]},
                    "leg_r": {"rotation": [f"-math.cos({walk}) * 36", 0, 0]},
                    "arm_l": {"rotation": [f"-math.cos({walk}) * 32", 0, 0]},
                    "arm_r": {"rotation": [f"math.cos({walk}) * 32", 0, 0]},
                    "body": {"position": [0, f"math.abs(math.sin({walk})) * 0.8", 0]},
                },
            },
            "animation.house_builder.hammer": {
                "loop": True,
                "bones": {
                    "body": {"rotation": [6, 0, 0]},
                    "head": {"rotation": [12, 0, 0]},
                    "arm_r": {"rotation": ["-95 - math.sin(query.life_time * 720) * 40", 0, 0]},
                    "arm_l": {"rotation": [-40, 0, 12]},
                },
            },
            "animation.house_builder.wave": {
                "loop": True,
                "bones": {
                    "arm_r": {"rotation": [-160, 0, "math.sin(query.life_time * 700) * 25"]},
                    "head": {"rotation": [-6, 0, "math.sin(query.life_time * 200) * 5"]},
                },
            },
            "animation.house_builder.cheer": {
                "loop": True,
                "bones": {
                    "arm_r": {"rotation": [-165, 0, "math.sin(query.life_time * 500) * 12"]},
                    "arm_l": {"rotation": [-165, 0, "-math.sin(query.life_time * 500) * 12"]},
                    "body": {"position": [0, "math.abs(math.sin(query.life_time * 360)) * 3", 0]},
                    "head": {"rotation": [-10, 0, 0]},
                },
            },
        },
    }


def item_texture():
    """The House Blueprint recolored construction yellow, with a hazard-striped spine and the house drawn as a frame."""
    here = os.path.dirname(os.path.abspath(__file__))
    src = Image.open(os.path.join(here, "..", "addons", "HouseBlueprint_RP", "textures", "items", "house_blueprint.png")).convert("RGBA")
    out = src.copy()
    swap = {
        (44, 96, 196): (246, 186, 30),      # cover
        (16, 32, 70): (84, 54, 16),         # outline
        (235, 245, 255): (60, 40, 16),      # the house, drawn dark like a frame
    }
    for y in range(16):
        for x in range(16):
            r, g, b, a = src.getpixel((x, y))
            if not a:
                continue
            if (r, g, b) in ((200, 215, 240), (70, 130, 225)):          # the spine: hazard stripes
                out.putpixel((x, y), ((40, 32, 20) if (x + y) % 4 < 2 else (250, 214, 40)) + (255,))
            elif (r, g, b) in swap:
                out.putpixel((x, y), swap[(r, g, b)] + (255,))
    return out


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

    save_json("models/entity/house_builder.geo.json", geo())
    for i in range(len(LOOKS)):
        save_png(f"textures/entity/house_builder_{i}.png", texture(i))
    save_json("animations/house_builder.animation.json", animations())
    save_png("textures/items/builder_blueprint.png", item_texture())
    print(f"builder: {sum(len(v) for v in bones.values())} cubes in {len(BONE_ORDER)} bones, {len(LOOKS)} looks")


# ---------- Preview ----------
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


def polys_for(i, ox, pose):
    tex = texture(i)
    polys, cols = [], []
    for bone in BONE_ORDER:
        if bone == "ponytail" and not LOOKS[i][3]:
            continue
        for c in bones[bone]:
            for fname, quad in corners(*c["o"], *c["s"]).items():
                sw = c["faces"].get(fname, c["c"])
                if sw == "face" and fname == "north":
                    (x, y, z), (w, h, dd) = c["o"], c["s"]
                    u, v, tw, th = FACE
                    for pxl in range(tw):
                        for pyl in range(th):
                            y0, y1 = y + h - (pyl + 1) * h / th, y + h - pyl * h / th
                            a0, a1 = x + w - (pxl + 1) * w / tw, x + w - pxl * w / tw
                            q = [(a0, y0, z - 0.02), (a1, y0, z - 0.02), (a1, y1, z - 0.02), (a0, y1, z - 0.02)]
                            pts = [posed(bone, p, pose) for p in q]
                            polys.append([(ox + p[0], p[2], p[1]) for p in pts])
                            cols.append(tuple(min(1, ch / 255 * 0.95) for ch in tex.getpixel((u + pxl, v + pyl))[:3]) + (1,))
                    continue
                (su, sv), _ = sw_uv(sw)
                ch = tex.getpixel((su + 3, sv + 3))
                pts = [posed(bone, p, pose) for p in quad]
                polys.append([(ox + p[0], p[2], p[1]) for p in pts])
                cols.append(tuple(min(1, q / 255 * SHADE[fname]) for q in ch[:3]) + (1,))
    return polys, cols


POSES = [{}, {"arm_r": -110, "body": 6, "head": 12, "arm_l": -40}, {"arm_r": -160}, {"arm_r": -165, "arm_l": -165}]


def render_preview(path, icon_path=None):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    bg = (0.86, 0.92, 0.98)
    fig = plt.figure(figsize=(14, 6), dpi=110)
    fig.patch.set_facecolor(bg)
    ax = fig.add_subplot(1, 1, 1, projection="3d")
    ax.set_facecolor(bg)
    polys, cols = [], []
    for i in range(4):
        pp, cc = polys_for(i, i * 24, POSES[i])
        polys += pp; cols += cc
    ax.add_collection3d(Poly3DCollection(polys, facecolors=cols, edgecolors=(0, 0, 0, 0.15), linewidths=0.1))
    for i, name in enumerate(["standing", "hammering", "waving", "cheering"]):
        ax.text(i * 24, 0, 40, name, ha="center", fontsize=10)
    ax.set_xlim(-12, 84); ax.set_ylim(-14, 14); ax.set_zlim(0, 40)
    ax.set_box_aspect((96, 28, 40), zoom=1.3)
    ax.view_init(elev=10, azim=-62)
    ax.axis("off")
    plt.subplots_adjust(left=0, right=1, top=1, bottom=0)
    plt.savefig(path, facecolor=bg, bbox_inches="tight", pad_inches=0.1)
    plt.close(fig)


if __name__ == "__main__":
    rp = sys.argv[1]
    write_pack(rp)
    if len(sys.argv) > 2:
        render_preview(sys.argv[2])
