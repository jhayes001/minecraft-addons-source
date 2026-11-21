"""Builds the art for the Rocket to the Moon add-on: the rocket model (geometry + texture),
the Rocket item icon, the Moon Rock block texture, the exhaust and smoke particle textures,
and both pack icons. Optionally renders a preview picture of the rocket.

Model space is in pixels (16 = one block), standing upright with the front facing north (-Z).
Every face of a cube is painted with one 8x8 swatch from a small palette texture. The cockpit
is a glass bubble: its swatch is see-through (alpha test) apart from a couple of shine marks,
so the riders can see out and everyone else can see them sitting inside.

Usage: python3 make_rocket.py <addons_dir> [preview.png]
"""
import json, math, os, sys
from PIL import Image, ImageDraw

SWATCH = {  # name -> (index, color or None for hand-painted)
    "white": (0, (240, 242, 246)),
    "red": (1, (214, 40, 48)),
    "darkred": (2, (150, 24, 32)),
    "metal": (3, (120, 126, 138)),
    "dark": (4, (52, 56, 64)),
    "window": (5, (96, 190, 240)),
    "gold": (6, (246, 196, 52)),
    "glass": (7, None),
}


def swatch_uv(name):
    i = SWATCH[name][0]
    return [(i % 8) * 8, (i // 8) * 8]


cubes = []  # (origin, size, color)


def box(x, y, z, w, h, d, color):
    cubes.append(((x, y, z), (w, h, d), color))


def round_part(y, h, r, color):
    """A chunky round section: three overlapping boxes make a stepped circle."""
    a, b, c = r, r * 0.64, r * 0.86
    box(-a, y, -b, 2 * a, h, 2 * b, color)
    box(-b, y, -a, 2 * b, h, 2 * a, color)
    box(-c, y, -c, 2 * c, h, 2 * c, color)


# --- Engine ---
round_part(0, 5, 6, "metal")         # nozzle bell
round_part(5, 2, 4.5, "dark")
# --- Body ---
round_part(6, 34, 10, "white")
round_part(17, 3, 10.3, "red")       # red band
round_part(36, 2, 10.3, "red")       # band under the cockpit
box(-4, 25, -10.4, 8, 8, 0.4, "gold")    # porthole rim
box(-3, 26, -10.6, 6, 6, 0.4, "window")  # porthole
# --- Four fins ---
for sx, sz in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
    for (out, y, h) in [(8, 0, 10), (5, 10, 6), (2, 16, 6)]:
        if sx:
            x0 = 9 if sx > 0 else -9 - out
            box(x0, y, -1, out, h, 2, "red")
        else:
            z0 = 9 if sz > 0 else -9 - out
            box(-1, y, z0, 2, h, out, "red")
# --- Cockpit: floor, glass bubble, corner struts ---
round_part(40, 2, 10.5, "darkred")
box(-9.5, 42, -9.5, 19, 24, 19, "glass")
for cx in (-9.5, 8):
    for cz in (-9.5, 8):
        box(cx, 42, cz, 1.5, 24, 1.5, "red")
# --- Nose ---
round_part(66, 3, 10.5, "red")
round_part(69, 3, 8, "red")
round_part(72, 3, 5.5, "red")
box(-2, 75, -2, 4, 3, 4, "gold")
box(-0.5, 78, -0.5, 1, 4, 1, "gold")     # antenna


def write_model(rp):
    faces = ["north", "south", "east", "west", "up", "down"]
    out = []
    for (o, s, color) in cubes:
        uv = {f: {"uv": swatch_uv(color), "uv_size": [8, 8]} for f in faces}
        out.append({"origin": list(o), "size": list(s), "uv": uv})
    geo = {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": "geometry.rocket_ship",
                "texture_width": 64, "texture_height": 64,
                "visible_bounds_width": 8, "visible_bounds_height": 8, "visible_bounds_offset": [0, 2.9, 0],
            },
            "bones": [{"name": "root", "pivot": [0, 46, 0], "cubes": out}],
        }],
    }
    os.makedirs(os.path.join(rp, "models/entity"), exist_ok=True)
    with open(os.path.join(rp, "models/entity/rocket_ship.geo.json"), "w") as f:
        json.dump(geo, f, indent=1)

    tex = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)
    for name, (i, col) in SWATCH.items():
        x, y = (i % 8) * 8, (i // 8) * 8
        if col:
            d.rectangle([x, y, x + 7, y + 7], fill=col + (255,))
    # Glass: see-through, with a little diagonal shine
    x, y = swatch_uv("glass")
    for px, py in [(1, 2), (2, 1), (1, 3), (3, 1), (2, 2)]:
        tex.putpixel((x + px, y + py), (235, 250, 255, 255))
    os.makedirs(os.path.join(rp, "textures/entity"), exist_ok=True)
    tex.save(os.path.join(rp, "textures/entity/rocket_ship.png"))
    print(f"rocket: {len(cubes)} cubes")


def item_icon():
    """16x16 pixel-art rocket pointing up and to the right."""
    rows = [
        "..............R.",
        ".............RRR",
        "............RWWR",
        "...........RWBBW",
        "..........RWBBW.",
        ".........RWWBW..",
        "........RWWWW...",
        "...RR..RWWWW....",
        "..RRRRRWWWW.....",
        "...RRWWWWW......",
        "....OWWWWRR.....",
        "...OYOWWRRR.....",
        "..OYYOORRR......",
        ".OYYO..RR.......",
        ".OYO............",
        "..O.............",
    ]
    pal = {"R": (214, 40, 48), "W": (240, 242, 246), "B": (96, 190, 240), "O": (255, 140, 30), "Y": (255, 230, 90)}
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in pal:
                img.putpixel((x, y), pal[ch] + (255,))
    return img


def moon_rock():
    """Pale gray stone with darker craters and a few blue twinkles."""
    img = Image.new("RGBA", (16, 16))
    for y in range(16):
        for x in range(16):
            n = (x * 7 + y * 13 + (x * y) % 5) % 9
            v = 186 + n * 3
            img.putpixel((x, y), (v, v + 2, v + 8, 255))
    d = ImageDraw.Draw(img)
    for cx, cy, r in [(4, 4, 2.5), (11, 9, 3), (5, 12, 1.6), (12, 3, 1.2)]:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(140, 144, 154, 255))
        d.ellipse([cx - r + 0.8, cy - r + 0.8, cx + r - 0.2, cy + r - 0.2], fill=(160, 164, 174, 255))
    for px, py in [(8, 2), (2, 8), (14, 13), (9, 14)]:
        img.putpixel((px, py), (170, 230, 255, 255))
    return img


def soft_dot():
    img = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    for y in range(8):
        for x in range(8):
            r = math.hypot(x - 3.5, y - 3.5) / 3.8
            if r < 1:
                img.putpixel((x, y), (255, 255, 255, round(255 * (1 - r * r))))
    return img


def pack_icon():
    img = Image.new("RGBA", (64, 64), (14, 18, 48, 255))
    d = ImageDraw.Draw(img)
    for sx, sy in [(6, 8), (20, 4), (50, 10), (58, 30), (8, 40), (30, 14), (44, 52), (12, 58)]:
        d.point((sx, sy), fill=(255, 255, 230, 255))
    d.ellipse([30, 30, 70, 70], fill=(206, 210, 218, 255))   # the moon in the corner
    for cx, cy, r in [(44, 44, 4), (56, 52, 5), (40, 58, 3)]:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(170, 174, 184, 255))
    rocket = item_icon().resize((40, 40), Image.NEAREST)
    img.alpha_composite(rocket, (2, 4))
    return img


def write_all(addons):
    rp = os.path.join(addons, "RocketMoon_RP")
    bp = os.path.join(addons, "RocketMoon_BP")
    write_model(rp)
    os.makedirs(os.path.join(rp, "textures/items"), exist_ok=True)
    item_icon().save(os.path.join(rp, "textures/items/rocket.png"))
    os.makedirs(os.path.join(rp, "textures/blocks"), exist_ok=True)
    moon_rock().save(os.path.join(rp, "textures/blocks/moon_rock.png"))
    os.makedirs(os.path.join(rp, "textures/particle"), exist_ok=True)
    soft_dot().save(os.path.join(rp, "textures/particle/rocket_puff.png"))
    icon = pack_icon()
    icon.save(os.path.join(rp, "pack_icon.png"))
    icon.save(os.path.join(bp, "pack_icon.png"))


def render_preview(path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    fig = plt.figure(figsize=(5, 7), dpi=110)
    ax = fig.add_subplot(111, projection="3d")
    bg = (0.07, 0.09, 0.2)
    ax.set_facecolor(bg)
    fig.patch.set_facecolor(bg)
    for (o, s, color) in cubes:
        x, y, z = o
        w, h, dd = s
        col = SWATCH[color][1]
        rgba = (0.8, 0.95, 1, 0.12) if col is None else tuple(c / 255 for c in col) + (1,)
        X = [x, x + w]; Y = [z, z + dd]; Z = [y, y + h]
        verts = [
            [(X[0], Y[0], Z[0]), (X[1], Y[0], Z[0]), (X[1], Y[1], Z[0]), (X[0], Y[1], Z[0])],
            [(X[0], Y[0], Z[1]), (X[1], Y[0], Z[1]), (X[1], Y[1], Z[1]), (X[0], Y[1], Z[1])],
            [(X[0], Y[0], Z[0]), (X[1], Y[0], Z[0]), (X[1], Y[0], Z[1]), (X[0], Y[0], Z[1])],
            [(X[0], Y[1], Z[0]), (X[1], Y[1], Z[0]), (X[1], Y[1], Z[1]), (X[0], Y[1], Z[1])],
            [(X[0], Y[0], Z[0]), (X[0], Y[1], Z[0]), (X[0], Y[1], Z[1]), (X[0], Y[0], Z[1])],
            [(X[1], Y[0], Z[0]), (X[1], Y[1], Z[0]), (X[1], Y[1], Z[1]), (X[1], Y[0], Z[1])],
        ]
        ax.add_collection3d(Poly3DCollection(verts, facecolors=[rgba], edgecolors=[(0, 0, 0, 0.25)], linewidths=0.3))
    ax.set_xlim(-25, 25); ax.set_ylim(-25, 25); ax.set_zlim(0, 84)
    ax.set_box_aspect((50, 50, 84))
    ax.view_init(elev=12, azim=-60)
    ax.axis("off")
    plt.tight_layout()
    plt.savefig(path, facecolor=fig.get_facecolor())


if __name__ == "__main__":
    write_all(sys.argv[1])
    if len(sys.argv) > 2:
        render_preview(sys.argv[2])
