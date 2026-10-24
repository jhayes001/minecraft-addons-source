"""Builds Santa's sleigh model (geometry + texture) for the Santa's Visit add-on,
and optionally renders a preview picture.

Model space is in pixels (16 = one block). The front of the model faces north (-Z),
which is the direction the entity flies. Every face of a cube is painted with one
8x8 color swatch from a small palette texture; the front of Santa's head uses a face swatch.

Usage: python3 make_santa.py <resource_pack_dir> [preview.png]
"""
import json, os, sys
from PIL import Image, ImageDraw

SWATCH = {  # name -> (index, color)
    "red": (0, (200, 32, 40)),
    "white": (1, (246, 246, 246)),
    "black": (2, (34, 30, 30)),
    "skin": (3, (240, 192, 160)),
    "gold": (4, (242, 190, 44)),
    "sack": (5, (128, 84, 48)),
    "deer": (6, (138, 92, 56)),
    "antler": (7, (224, 206, 166)),
    "face": (8, None),
    "darkred": (9, (150, 20, 28)),
    "deerlight": (10, (196, 160, 120)),
}

def swatch_uv(name):
    i = SWATCH[name][0]
    return [(i % 8) * 8, (i // 8) * 8]

cubes = []  # (origin, size, color, front_color)

def box(x, y, z, w, h, d, color, front=None):
    cubes.append(((x, y, z), (w, h, d), color, front))

# --- Sleigh ---
box(-11, 0, -14, 2, 2, 30, "gold")          # runners
box(9, 0, -14, 2, 2, 30, "gold")
box(-11, 2, -17, 2, 6, 3, "gold")           # curled runner fronts
box(9, 2, -17, 2, 6, 3, "gold")
box(-10, 3, -12, 20, 7, 26, "red")          # body
box(-10, 10, -12, 20, 3, 4, "darkred")      # front lip
box(-10, 10, 10, 20, 10, 4, "red")          # tall back seat
box(-11, 9, -12, 1, 2, 26, "gold")          # gold trim
box(10, 9, -12, 1, 2, 26, "gold")

# --- Santa (sitting) ---
box(-6, 10, -2, 12, 11, 8, "red")           # body
box(-6.2, 13, -2.2, 12.4, 2, 8.4, "black")  # belt
box(-1.5, 13, -2.4, 3, 2, 0.4, "gold")      # buckle
box(-9, 13, -1, 3, 8, 4, "red")             # arms
box(6, 13, -1, 3, 8, 4, "red")
box(-9, 11, -4, 3, 3, 4, "white")           # mittens/cuffs reaching forward
box(6, 11, -4, 3, 3, 4, "white")
box(-4, 21, -1, 8, 8, 8, "skin", front="face")  # head
box(-4.5, 17, -2.5, 9, 7, 2, "white")       # beard
box(-5, 28, -1.5, 10, 2, 10, "white")       # hat brim
box(-4, 30, 0, 8, 3, 7, "red")              # hat
box(-3, 33, 1, 6, 3, 5, "red")
box(-1.5, 35, 4, 3, 3, 3, "white")          # pom-pom

# --- Sack of presents on the back seat ---
box(-9, 13, 4, 7, 9, 6, "sack")
box(-7, 22, 6, 3, 2, 3, "gold")

# --- Reins ---
box(-8, 13, -44, 1, 1, 40, "gold")
box(7, 13, -44, 1, 1, 40, "gold")

# --- Two reindeer ---
def reindeer(x, z):
    box(x, 10, z, 6, 7, 14, "deer")                 # body
    box(x + 1, 11, z + 13, 4, 4, 2, "deerlight")    # tail patch
    for lx, lz in [(0, 1), (4, 1), (0, 11), (4, 11)]:
        box(x + lx, 0, z + lz, 2, 10, 2, "deer")    # legs
    box(x + 1, 15, z - 3, 4, 6, 4, "deer")          # neck
    box(x + 1, 19, z - 8, 4, 4, 6, "deer")          # head
    box(x + 1.5, 19.5, z - 9, 3, 2, 1, "black")     # nose
    box(x - 0.2, 12, z + 1, 6.4, 2, 2, "red")       # harness
    box(x + 0, 23, z - 4, 1, 4, 1, "antler")        # antlers
    box(x + 5, 23, z - 4, 1, 4, 1, "antler")
    box(x - 2, 26, z - 4, 3, 1, 1, "antler")
    box(x + 4, 26, z - 4, 3, 1, 1, "antler")
    box(x - 2, 27, z - 4, 1, 2, 1, "antler")
    box(x + 6, 27, z - 4, 1, 2, 1, "antler")

reindeer(-11, -60)
reindeer(5, -60)


def write_pack(rp):
    faces = ["north", "south", "east", "west", "up", "down"]
    out = []
    for (o, s, color, front) in cubes:
        uv = {}
        for f in faces:
            name = front if (f == "north" and front) else color
            uv[f] = {"uv": swatch_uv(name), "uv_size": [8, 8]}
        out.append({"origin": list(o), "size": list(s), "uv": uv})
    geo = {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": "geometry.santa_sleigh",
                "texture_width": 64, "texture_height": 64,
                "visible_bounds_width": 8, "visible_bounds_height": 4, "visible_bounds_offset": [0, 1, -1.5],
            },
            "bones": [{"name": "root", "pivot": [0, 0, 0], "cubes": out}],
        }],
    }
    os.makedirs(os.path.join(rp, "models/entity"), exist_ok=True)
    with open(os.path.join(rp, "models/entity/santa_sleigh.geo.json"), "w") as f:
        json.dump(geo, f, indent=1)

    tex = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)
    for name, (i, col) in SWATCH.items():
        x, y = (i % 8) * 8, (i // 8) * 8
        if col:
            d.rectangle([x, y, x + 7, y + 7], fill=col + (255,))
    # Santa's face: skin, eyes, rosy cheeks, nose
    x, y = swatch_uv("face")
    d.rectangle([x, y, x + 7, y + 7], fill=SWATCH["skin"][1] + (255,))
    for px, py, c in [(2, 3, (40, 40, 60)), (5, 3, (40, 40, 60)), (1, 5, (232, 130, 130)), (6, 5, (232, 130, 130)),
                      (3, 5, (214, 140, 120)), (4, 5, (214, 140, 120))]:
        tex.putpixel((x + px, y + py), c + (255,))
    for px in range(1, 7):
        tex.putpixel((x + px, y + 1), (246, 246, 246, 255))  # white eyebrows/hat shadow
    os.makedirs(os.path.join(rp, "textures/entity"), exist_ok=True)
    tex.save(os.path.join(rp, "textures/entity/santa_sleigh.png"))
    print(f"{len(cubes)} cubes written")


def render_preview(path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    fig = plt.figure(figsize=(8, 5), dpi=110)
    ax = fig.add_subplot(111, projection="3d")
    ax.set_facecolor((0.07, 0.09, 0.2))
    fig.patch.set_facecolor((0.07, 0.09, 0.2))
    for (o, s, color, front) in cubes:
        x, y, z = o
        w, h, dd = s
        col = [c / 255 for c in (SWATCH[color][1] or SWATCH["skin"][1])]
        # plot axes: X = model x, Y = model z, Z = model y (up)
        X = [x, x + w]; Y = [z, z + dd]; Z = [y, y + h]
        verts = [
            [(X[0], Y[0], Z[0]), (X[1], Y[0], Z[0]), (X[1], Y[1], Z[0]), (X[0], Y[1], Z[0])],
            [(X[0], Y[0], Z[1]), (X[1], Y[0], Z[1]), (X[1], Y[1], Z[1]), (X[0], Y[1], Z[1])],
            [(X[0], Y[0], Z[0]), (X[1], Y[0], Z[0]), (X[1], Y[0], Z[1]), (X[0], Y[0], Z[1])],
            [(X[0], Y[1], Z[0]), (X[1], Y[1], Z[0]), (X[1], Y[1], Z[1]), (X[0], Y[1], Z[1])],
            [(X[0], Y[0], Z[0]), (X[0], Y[1], Z[0]), (X[0], Y[1], Z[1]), (X[0], Y[0], Z[1])],
            [(X[1], Y[0], Z[0]), (X[1], Y[1], Z[0]), (X[1], Y[1], Z[1]), (X[1], Y[0], Z[1])],
        ]
        ax.add_collection3d(Poly3DCollection(verts, facecolors=[col], edgecolors=[(0, 0, 0, 0.35)], linewidths=0.3))
    ax.set_xlim(-30, 30); ax.set_ylim(-70, 20); ax.set_zlim(0, 40)
    ax.set_box_aspect((60, 90, 40))
    ax.view_init(elev=18, azim=-35)
    ax.axis("off")
    plt.tight_layout()
    plt.savefig(path, facecolor=fig.get_facecolor())


if __name__ == "__main__":
    write_pack(sys.argv[1])
    if len(sys.argv) > 2:
        render_preview(sys.argv[2])
