"""Builds the Cozy Home add-on's furniture models, textures, block files and pack icons,
and optionally renders a preview picture.

Writes into the resource pack (CozyHome_RP):
  models/blocks/cozy_<variant>.geo.json     one model per look (fridge open/closed, lamp on/off...)
  textures/blocks/cozy_furniture.png         shared texture: color swatches + painted details
  textures/blocks/tv_<channel>.png           TV channels (animated strips, see flipbook_textures.json)
  textures/items/<dish>.png                  the five silly dishes from the cooking pot
  terrain_texture.json, item_texture.json, flipbook_textures.json, blocks.json, pack_icon.png
and into the behavior pack (CozyHome_BP):
  blocks/<furniture>.json                    states, models per state, rotation, light, hit boxes
  pack_icon.png

Every model's front faces north (-Z); placement turns it to face the player.
Usage: python3 make_cozy.py <repo_addons_dir> [preview.png]
"""
import json, math, os, sys
from PIL import Image, ImageDraw

# ---------------- Colors ----------------
PAL = {
    "white": (246, 246, 242), "shadow": (214, 216, 222), "chrome": (196, 206, 218), "dark": (58, 60, 70),
    "black": (30, 30, 36), "mint": (150, 226, 204), "mint_dk": (100, 186, 164), "pink": (255, 170, 200),
    "red": (226, 66, 74), "red_dk": (168, 40, 52), "blue": (100, 152, 236), "blue_dk": (62, 104, 190),
    "water": (92, 178, 240), "foam": (238, 250, 255), "gold": (240, 196, 64), "wood": (182, 128, 80),
    "wood_dk": (122, 82, 50), "cream": (250, 236, 206), "shade": (255, 206, 168), "shade_lit": (255, 248, 206),
    "soup": (242, 140, 60), "fire": (255, 116, 40), "pot_in": (72, 42, 44), "lilac": (196, 160, 240),
}
NAMES = list(PAL)
TEX = 64


def sw_uv(name):
    i = NAMES.index(name)
    return [(i % 8) * 4 + 1, (i // 8) * 4 + 1], [2, 2]  # sample the middle of a 4x4 swatch


# Painted details: name -> (u, v, w, h) in cozy_furniture.png
DECAL = {
    "fridge_door": (0, 16, 14, 14),
    "fridge_inside": (16, 16, 14, 16),
    "stove_front": (32, 16, 14, 11),
    "stove_front_lit": (48, 16, 14, 11),
    "stove_top": (32, 28, 14, 14),
    "mailbox_front": (0, 34, 6, 5),
    "seat_top": (8, 34, 9, 10),
    "tub_bottom": (48, 28, 12, 12),
}

# ---------------- Models ----------------
# A cube: origin, size, base color, and optional per-face overrides:
#   "decal:<name>" paints a detail, "screen" uses the TV screen material, or another swatch color.
def C(o, s, color, **faces):
    return {"o": o, "s": s, "c": color, "f": faces}


FRIDGE_BODY = [-7, 0, -2], [14, 16, 10]
MODELS = {
    "fridge_closed": [
        C(*FRIDGE_BODY, "mint"),
        C([-7, 1, -3], [14, 14, 1], "mint", north="decal:fridge_door"),
        C([3.5, 6, -4], [1, 5, 1], "chrome"),
    ],
    "fridge_open": [
        C(*FRIDGE_BODY, "mint", north="decal:fridge_inside"),
        C([-8, 1, -14], [1, 14, 11], "mint", west="decal:fridge_door", east="white"),
        C([-9, 6, -13], [1, 5, 1], "chrome"),
    ],
}
for pot in range(3):
    m = [C([-7, 0, -7], [14, 11, 14], "white", north="decal:stove_front_lit" if pot == 2 else "decal:stove_front",
           up="decal:stove_top"),
         C([-4, 11, -4], [8, 5, 8], "red", up="pot_in" if pot == 0 else "soup", down="red_dk"),
         C([-5, 14, -1], [1, 1, 2], "dark"), C([4, 14, -1], [1, 1, 2], "dark")]
    if pot == 2:  # flames around the bottom of the pot and bubbles on top
        m += [C([-4.5, 11, -4.5], [9, 0.5, 9], "fire"),
              C([-2, 16, -1], [1, 1, 1], "foam"), C([1, 16, 1], [1, 1, 1], "foam"), C([0, 16, -3], [1, 1, 1], "foam")]
    MODELS[f"stove_{pot}"] = m

TUB = [C([x, 0, z], [2, 2, 2], "gold") for x, z in [(-7, -7), (5, -7), (-7, 5), (5, 5)]] + [
    C([-8, 2, -8], [16, 1, 16], "white", up="decal:tub_bottom"),
    C([-8, 3, -8], [16, 7, 2], "white"), C([-8, 3, 6], [16, 7, 2], "white"),
    C([-8, 3, -6], [2, 7, 12], "white"), C([6, 3, -6], [2, 7, 12], "white"),
    C([-1, 10, 5], [2, 3, 2], "chrome"), C([-0.5, 12, 3.5], [1, 1, 1.5], "chrome"),
    C([-3, 10, 6], [1, 1, 1], "red"), C([2, 10, 6], [1, 1, 1], "blue"),
]
MODELS["bathtub_empty"] = TUB
MODELS["bathtub_full"] = TUB + [
    C([-6, 3, -6], [12, 5.5, 12], "water"),
    C([-4, 8.5, -3], [2, 1, 2], "foam"), C([1, 8.5, 1], [3, 1, 2], "foam"),
    C([-2, 8.5, 3], [2, 1, 1], "foam"), C([3, 8.5, -4], [1, 1, 1], "foam"), C([-5, 8.5, 2], [1, 0.5, 1], "foam"),
]
MODELS["toilet"] = [
    C([-2.5, 0, -3], [5, 5, 6], "white"),
    C([-4.5, 5, -6], [9, 4, 10], "white"),
    C([-4.5, 9, -6], [9, 1, 10], "white", up="decal:seat_top"),
    C([-5, 5, 4], [10, 10, 4], "white"),
    C([-5.5, 15, 3.5], [11, 1, 5], "shadow"),
    C([3, 13, 3], [2, 1, 1], "chrome"),
]
MODELS["tv"] = [
    C([-5, 0, -2], [10, 2, 5], "wood_dk"),
    C([-8, 2, -2], [16, 11, 5], "dark"),
    C([-7, 3, -2.5], [14, 9, 0.5], "black", north="screen"),
    C([-3, 13, 0], [1, 3, 1], "chrome"), C([2, 13, 0], [1, 3, 1], "chrome"),
    C([-3, 16, 0], [1, 1, 1], "red"), C([2, 16, 0], [1, 1, 1], "red"),
]
for lit in (False, True):
    MODELS["lamp_on" if lit else "lamp_off"] = [
        C([-3, 0, -3], [6, 1, 6], "wood_dk"),
        C([-0.5, 1, -0.5], [1, 8, 1], "gold"),
        C([-4.5, 9, -4.5], [9, 6, 9], "shade_lit" if lit else "shade"),
        C([-1.5, 15, -1.5], [3, 1, 3], "gold"),
    ]
for up in (False, True):
    m = [C([-1, 0, -1], [2, 10, 2], "wood"),
         C([-3, 10, -5], [6, 5, 10], "blue", north="decal:mailbox_front"),
         C([-3.5, 15, -5], [7, 1, 10], "blue_dk")]
    m += ([C([3, 10, 2], [1, 6, 1], "wood_dk"), C([3, 14, -1], [1, 2, 3], "red")] if up
          else [C([3, 11, -3], [1, 1, 5], "red")])
    MODELS["mailbox_up" if up else "mailbox_down"] = m

FACES = ["north", "south", "east", "west", "up", "down"]


def face_size(face, s):
    w, h, d = s
    return {"north": (w, h), "south": (w, h), "east": (d, h), "west": (d, h), "up": (w, d), "down": (w, d)}[face]


def geo(name):
    cubes = []
    for c in MODELS[name]:
        uv = {}
        for f in FACES:
            spec = c["f"].get(f, c["c"])
            if spec == "screen":
                uv[f] = {"uv": [1, 3], "uv_size": [14, 9], "material_instance": "screen"}
            elif spec.startswith("decal:"):
                u, v, w, h = DECAL[spec[6:]]
                uv[f] = {"uv": [u, v], "uv_size": [w, h]}
            else:
                o, sz = sw_uv(spec)
                uv[f] = {"uv": o, "uv_size": sz}
        cubes.append({"origin": c["o"], "size": c["s"], "uv": uv})
    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {"identifier": f"geometry.cozy_{name}", "texture_width": TEX, "texture_height": TEX},
            "bones": [{"name": "furniture", "pivot": [0, 0, 0], "cubes": cubes}],
        }],
    }


# ---------------- Painting ----------------
def furniture_texture():
    img = Image.new("RGBA", (TEX, TEX), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i, n in enumerate(NAMES):
        x, y = (i % 8) * 4, (i // 8) * 4
        d.rectangle([x, y, x + 3, y + 3], fill=PAL[n] + (255,))

    def px(region, x, y, col):
        u, v, w, h = DECAL[region]
        if 0 <= x < w and 0 <= y < h:
            img.putpixel((u + x, v + y), (PAL[col] if isinstance(col, str) else col) + (255,))

    def fill(region, col, x0=0, y0=0, x1=None, y1=None):
        u, v, w, h = DECAL[region]
        x1 = w - 1 if x1 is None else x1
        y1 = h - 1 if y1 is None else y1
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                px(region, x, y, col)

    # Fridge door: freezer line, a drawing held up by magnets.
    r = "fridge_door"
    fill(r, "mint")
    for x in range(14):
        px(r, x, 0, "mint_dk"); px(r, x, 13, "mint_dk"); px(r, x, 4, "mint_dk")
    for y in range(14):
        px(r, 0, y, "mint_dk"); px(r, 13, y, "mint_dk")
    fill(r, "white", 2, 6, 7, 11)  # a kid's drawing: sun, grass, a little house
    px(r, 3, 7, "gold"); px(r, 4, 7, "gold"); px(r, 3, 8, "gold")
    for x in range(2, 8):
        px(r, x, 11, (120, 200, 90))
    fill(r, "pink", 5, 9, 6, 10); px(r, 5, 8, "red"); px(r, 6, 8, "red")
    px(r, 2, 6, "red"); px(r, 7, 6, "blue")  # magnets
    px(r, 10, 2, "pink"); px(r, 11, 2, "pink"); px(r, 10, 1, "pink"); px(r, 11, 3, "pink")  # heart magnet
    px(r, 9, 8, "gold"); px(r, 10, 7, "gold"); px(r, 10, 8, "gold"); px(r, 11, 8, "gold"); px(r, 10, 9, "gold")  # star
    # Fridge inside: shelves full of food.
    r = "fridge_inside"
    fill(r, "white")
    for y in range(16):
        px(r, 0, y, "mint"); px(r, 13, y, "mint")
    for x in range(14):
        px(r, x, 0, "mint"); px(r, x, 15, "mint"); px(r, x, 5, "shadow"); px(r, x, 10, "shadow")
    for x, y, col in [(2, 4, "red"), (3, 4, "red"), (2, 3, (90, 180, 70)), (5, 2, "white"), (5, 3, "blue"), (5, 4, "blue"),
                      (6, 2, "white"), (6, 3, "blue"), (6, 4, "blue"), (9, 3, (255, 150, 40)), (10, 4, (255, 150, 40)),
                      (11, 4, (255, 150, 40)), (9, 2, (90, 180, 70)),
                      (2, 9, "pink"), (3, 9, "pink"), (4, 9, "pink"), (3, 8, "cream"), (3, 7, "red"),
                      (7, 9, "cream"), (8, 9, "cream"), (9, 9, "cream"), (10, 9, "cream"), (7, 8, "cream"), (9, 8, "cream"),
                      (2, 14, (80, 200, 90)), (3, 14, (80, 200, 90)), (3, 13, (120, 220, 110)), (6, 14, (255, 220, 70)),
                      (7, 14, (255, 220, 70)), (7, 13, (255, 220, 70)), (10, 14, "lilac"), (11, 14, "lilac"), (11, 13, (150, 110, 210))]:
        px(r, x, y, col)
    # Stove front: knobs, a handle and the oven window (glowing when cooking).
    for r, glow in [("stove_front", False), ("stove_front_lit", True)]:
        fill(r, "white")
        for x in (2, 5, 8, 11):
            px(r, x, 1, "dark")
        for x in range(2, 12):
            px(r, x, 3, "chrome")
        fill(r, "chrome", 2, 4, 11, 9)
        fill(r, (255, 150, 60) if glow else "dark", 3, 5, 10, 8)
        if glow:
            for x in range(3, 11):
                px(r, x, 8, (255, 210, 90))
        for x in range(14):
            px(r, x, 10, "shadow")
    r = "stove_top"
    fill(r, "black")
    for cx, cy in [(3, 3), (10, 3), (3, 10), (10, 10)]:
        for a in range(12):
            t = a / 12 * 2 * math.pi
            px(r, round(cx + 2 * math.cos(t)), round(cy + 2 * math.sin(t)), "dark")
    # Mailbox front.
    r = "mailbox_front"
    fill(r, "blue")
    for x in range(6):
        px(r, x, 0, "blue_dk"); px(r, x, 4, "blue_dk")
    for y in range(5):
        px(r, 0, y, "blue_dk"); px(r, 5, y, "blue_dk")
    px(r, 2, 2, "white"); px(r, 3, 2, "white"); px(r, 4, 3, "gold")
    # Toilet seat: a white ring around the water.
    r = "seat_top"
    fill(r, "white")
    for x in range(9):
        for y in range(10):
            if ((x - 4) / 3.0) ** 2 + ((y - 4.5) / 3.6) ** 2 <= 1:
                px(r, x, y, (120, 186, 236))
            elif ((x - 4) / 4.2) ** 2 + ((y - 4.5) / 4.8) ** 2 > 1:
                px(r, x, y, "shadow")
    # Tub bottom: soft tiles.
    r = "tub_bottom"
    fill(r, "white")
    for i in range(12):
        px(r, i, 5, "shadow"); px(r, 5, i, "shadow")
    return img


# ---------------- TV channels ----------------
RAINBOW = [(255, 70, 70), (255, 160, 50), (255, 232, 70), (90, 220, 100), (70, 170, 255), (150, 100, 255)]
CHANNELS = ["off", "rainbow", "fish", "stars", "sunny", "graham"]  # index = cozy:channel state; 5 is the secret one
TICKS = {"rainbow": 3, "fish": 4, "stars": 8, "sunny": 4, "graham": 5}


def screen_frames(name):
    """Returns a list of 14x9 pictures for a channel."""
    frames = []
    if name == "off":
        im = Image.new("RGB", (14, 9), (34, 36, 44))
        for i in range(4):
            im.putpixel((9 + i, i + 1), (70, 74, 90))
        return [im]
    if name == "rainbow":
        for f in range(12):
            im = Image.new("RGB", (14, 9))
            for x in range(14):
                for y in range(9):
                    im.putpixel((x, y), RAINBOW[((x + y + f) // 2) % 6])
            frames.append(im)
    elif name == "fish":
        for f in range(18):
            im = Image.new("RGB", (14, 9))
            for y in range(9):
                for x in range(14):
                    im.putpixel((x, y), (40, 120 + y * 8, 200 + y * 4) if y < 8 else (232, 210, 150))
            for sx, h in [(2, 4), (11, 3)]:
                for k in range(h):
                    im.putpixel((sx + (1 if (k + f // 3) % 2 else 0), 7 - k), (60, 190, 90))
            fx = f - 3  # an orange fish swims across, tail wiggling
            for x, y, col in [(fx, 4, (255, 140, 40)), (fx + 1, 4, (255, 140, 40)), (fx + 2, 4, (255, 170, 60)),
                              (fx + 1, 3, (255, 140, 40)), (fx + 1, 5, (255, 140, 40)), (fx + 2, 4, (20, 20, 30)),
                              (fx - 1, 3 + f % 2, (255, 110, 30)), (fx - 1, 5 - f % 2, (255, 110, 30))]:
                if 0 <= x < 14:
                    im.putpixel((x, y), col)
            by = 7 - (f % 8)
            if by >= 0:
                im.putpixel((7, by), (200, 240, 255))
            frames.append(im)
    elif name == "stars":
        stars = [(1, 1), (4, 6), (6, 2), (9, 7), (12, 1), (3, 4), (11, 5), (8, 0)]
        for f in range(4):
            im = Image.new("RGB", (14, 9), (20, 24, 70))
            for i, (x, y) in enumerate(stars):
                on = (i + f) % 3 != 0
                im.putpixel((x, y), (255, 240, 150) if on else (90, 90, 140))
            for x, y in [(10, 2), (11, 2), (10, 3), (11, 3), (12, 3), (11, 4), (10, 4)]:
                im.putpixel((x, y), (255, 248, 210))
            im.putpixel((12, 2), (20, 24, 70))
            frames.append(im)
    elif name == "sunny":
        for f in range(8):
            im = Image.new("RGB", (14, 9), (130, 200, 255))
            for x in range(14):
                top = 7 - round(1.2 * math.sin(x / 13 * math.pi))
                for y in range(top, 9):
                    im.putpixel((x, y), (90, 200, 90))
            cy = 3 - [0, 1, 1, 2, 2, 1, 1, 0][f]
            for dx in range(-1, 2):
                for dy in range(-1, 2):
                    im.putpixel((6 + dx, cy + 2 + dy), (255, 220, 60))
            for dx, dy in [(0, -2), (0, 2), (-2, 0), (2, 0)]:
                y = cy + 2 + dy
                if 0 <= y < 9:
                    im.putpixel((6 + dx, y), (255, 180, 40))
            im.putpixel((5, cy + 1), (60, 40, 30)); im.putpixel((7, cy + 1), (60, 40, 30))
            frames.append(im)
    elif name == "graham":
        # The secret channel: Graham, black with a white chest splotch and an orange collar, wagging.
        for f in range(4):
            im = Image.new("RGB", (14, 9), (150, 210, 255))
            for x in range(14):
                im.putpixel((x, 8), (90, 190, 80)); im.putpixel((x, 7), (110, 205, 95))
            B = (26, 26, 30)
            for x in range(4, 10):
                for y in range(4, 6):
                    im.putpixel((x, y), B)
            for x, y in [(4, 6), (4, 7), (8, 6), (8, 7), (5, 6), (9, 6), (9, 7)]:
                im.putpixel((x, y), B)
            for x, y in [(9, 2), (10, 2), (11, 2), (9, 3), (10, 3), (11, 3), (12, 3), (10, 1)]:
                im.putpixel((x, y), B)  # head, one ear up
            im.putpixel((9, 1), B if f % 2 else (150, 210, 255))  # the floppy ear bobs
            im.putpixel((11, 2), (240, 240, 240)); im.putpixel((12, 3), (20, 20, 20))
            im.putpixel((9, 4), (255, 140, 40)); im.putpixel((10, 4), (255, 140, 40))  # collar
            im.putpixel((8, 5), (245, 245, 245))  # chest splotch
            tail = [(3, 3), (2, 3), (3, 4), (2, 5)][f]
            im.putpixel(tail, B); im.putpixel((3, 4), B)
            frames.append(im)
    return frames


def channel_texture(name):
    frames = screen_frames(name)
    strip = Image.new("RGBA", (16, 16 * len(frames)), (20, 20, 26, 255))
    for i, fr in enumerate(frames):
        strip.paste(fr, (1, 16 * i + 3))
    return strip


# ---------------- Dishes ----------------
DISHES = {  # id: (name, icon painter)
    "fruit_salad": "Fruit Salad",
    "carrot_cake": "Carrot Cake",
    "pizza": "Pizza",
    "rainbow_soup": "Rainbow Soup",
    "mud_pie": "Mud Pie",
}


def bowl(d):
    BR, BR2 = (150, 98, 56), (112, 70, 40)
    for y in range(9, 14):
        w = 6 - (y - 9) // 2 - (1 if y == 13 else 0)
        d.line([8 - w, y, 7 + w, y], fill=BR + (255,))
    d.line([2, 9, 13, 9], fill=BR2 + (255,))


def dish_icon(name):
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    p = lambda x, y, c: img.putpixel((x, y), c + (255,))
    if name == "fruit_salad":
        bowl(d)
        for x, y, c in [(4, 8, (230, 50, 60)), (5, 8, (230, 50, 60)), (5, 7, (230, 50, 60)), (7, 7, (255, 220, 60)),
                        (8, 7, (255, 220, 60)), (8, 6, (255, 220, 60)), (10, 8, (90, 200, 90)), (11, 8, (90, 200, 90)),
                        (10, 7, (140, 230, 120)), (6, 8, (160, 90, 220)), (9, 8, (255, 150, 40)), (12, 8, (230, 50, 60)),
                        (7, 8, (255, 150, 40)), (3, 8, (90, 200, 90)), (6, 6, (200, 60, 80))]:
            p(x, y, c)
    elif name == "rainbow_soup":
        bowl(d)
        for i, c in enumerate(RAINBOW):
            d.line([3 + i * 2 - (1 if i == 0 else 0), 8, 4 + i * 2, 8], fill=c + (255,))
        for x, y in [(5, 6), (9, 5), (11, 7)]:
            p(x, y, (255, 255, 255))
    elif name == "carrot_cake":
        d.polygon([(2, 12), (13, 12), (13, 6), (2, 9)], fill=(236, 150, 70, 255))
        d.line([2, 12, 13, 12], fill=(190, 110, 50, 255))
        d.line([2, 10, 13, 9], fill=(250, 240, 230, 255))
        d.polygon([(2, 9), (13, 6), (13, 5), (2, 8)], fill=(255, 250, 240, 255))
        for x, y in [(6, 6), (7, 6)]:
            p(x, y, (255, 130, 30))
        p(7, 5, (80, 190, 80)); p(8, 5, (80, 190, 80))
    elif name == "pizza":
        d.polygon([(2, 3), (13, 3), (8, 14)], fill=(255, 214, 90, 255))
        d.line([2, 3, 13, 3], fill=(200, 130, 60, 255)); d.line([2, 4, 13, 4], fill=(220, 150, 70, 255))
        for x, y in [(5, 6), (9, 6), (7, 9), (8, 11)]:
            p(x, y, (210, 50, 50)); p(x + 1, y, (210, 50, 50))
        p(6, 8, (90, 180, 70)); p(10, 8, (90, 180, 70))
    elif name == "mud_pie":
        d.ellipse([2, 6, 13, 13], fill=(200, 170, 120, 255))
        d.ellipse([3, 6, 12, 11], fill=(112, 76, 46, 255))
        for x, y in [(5, 8), (8, 7), (10, 9)]:
            p(x, y, (90, 60, 36))
        for x, y in [(7, 5), (8, 5), (8, 4), (9, 4)]:  # a little worm peeking out
            p(x, y, (240, 140, 160))
        p(9, 3, (240, 140, 160)); p(9, 4, (30, 30, 30))
    return img


def pack_icon():
    im = Image.new("RGBA", (16, 16), (255, 236, 244, 255))
    d = ImageDraw.Draw(im)
    d.rectangle([3, 7, 12, 14], fill=(255, 250, 240, 255))
    d.polygon([(1, 8), (8, 1), (14, 8)], fill=(240, 90, 130, 255))
    d.rectangle([7, 10, 9, 14], fill=(182, 128, 80, 255))
    d.rectangle([4, 9, 5, 10], fill=(255, 220, 110, 255)); d.rectangle([11, 9, 12, 10], fill=(255, 220, 110, 255))
    for x, y in [(7, 4), (9, 4), (6, 5), (7, 5), (8, 5), (9, 5), (10, 5), (7, 6), (8, 6), (9, 6), (8, 7)]:
        im.putpixel((x, y), (255, 250, 250, 255))
    return im.resize((256, 256), Image.NEAREST)


# ---------------- Blocks ----------------
ROTATE = [("north", 0), ("west", 90), ("south", 180), ("east", 270)]
# id: display name, states, [(condition, model, extra components)], collision box, selection box, sound, map color
BLOCKS = {
    "fridge": ("Fridge", {"cozy:open": [False, True]},
               [("!q.block_state('cozy:open')", "fridge_closed", {}), ("q.block_state('cozy:open')", "fridge_open", {})],
               ([-7, 0, -3], [14, 16, 11]), None, "metal", "#96e2cc"),
    "stove": ("Stove", {"cozy:pot": [0, 1, 2]},
              [(f"q.block_state('cozy:pot') == {i}", f"stove_{i}", {"minecraft:light_emission": 9} if i == 2 else {})
               for i in range(3)],
              ([-7, 0, -7], [14, 16, 14]), None, "metal", "#f6f6f2"),
    "bathtub": ("Bathtub", {"cozy:full": [False, True]},
                [("!q.block_state('cozy:full')", "bathtub_empty", {}), ("q.block_state('cozy:full')", "bathtub_full", {})],
                ([-8, 0, -8], [16, 3, 16]), ([-8, 0, -8], [16, 10, 16]), "stone", "#f6f6f2"),
    "toilet": ("Toilet", {}, [("true", "toilet", {})],
               ([-5, 0, -6], [10, 10, 12]), ([-6, 0, -6], [12, 16, 14]), "stone", "#f6f6f2"),
    "tv": ("TV", {"cozy:channel": list(range(len(CHANNELS)))},
           [(f"q.block_state('cozy:channel') == {i}", "tv",
             {"minecraft:material_instances": {"*": {"texture": "cozy_furniture", "render_method": "alpha_test"},
                                               "screen": {"texture": f"cozy_tv_{ch}", "render_method": "opaque"}},
              **({"minecraft:light_emission": 6} if i else {})})
            for i, ch in enumerate(CHANNELS)],
           ([-8, 0, -3], [16, 13, 6]), ([-8, 0, -3], [16, 16, 6]), "wood", "#3a3c46"),
    "lamp": ("Lamp", {"cozy:lit": [False, True]},
             [("!q.block_state('cozy:lit')", "lamp_off", {}),
              ("q.block_state('cozy:lit')", "lamp_on", {"minecraft:light_emission": 15})],
             ([-4.5, 0, -4.5], [9, 16, 9]), None, "wood", "#ffcea8"),
    "mailbox": ("Mailbox", {"cozy:flag": [False, True]},
                [("!q.block_state('cozy:flag')", "mailbox_down", {}), ("q.block_state('cozy:flag')", "mailbox_up", {})],
                ([-3, 0, -5], [6, 16, 10]), ([-4, 0, -5], [8, 16, 10]), "wood", "#6498ec"),
}


def block_json(key):
    name, states, looks, coll, sel, _sound, color = BLOCKS[key]
    first = looks[0]
    comps = {
        "minecraft:display_name": name,
        "minecraft:geometry": f"geometry.cozy_{first[1]}",
        "minecraft:material_instances": {"*": {"texture": "cozy_furniture", "render_method": "alpha_test"}},
        "minecraft:collision_box": {"origin": coll[0], "size": coll[1]},
        "minecraft:selection_box": {"origin": (sel or coll)[0], "size": (sel or coll)[1]},
        "minecraft:destructible_by_mining": {"seconds_to_destroy": 0.5},
        "minecraft:destructible_by_explosion": {"explosion_resistance": 3},
        "minecraft:light_dampening": 0,
        "minecraft:map_color": color,
    }
    if "screen" in json.dumps(MODELS[first[1]]):
        comps["minecraft:material_instances"] = looks[0][2]["minecraft:material_instances"]
    perms = [{"condition": f"q.block_state('minecraft:cardinal_direction') == '{d}'",
              "components": {"minecraft:transformation": {"rotation": [0, r, 0]}}} for d, r in ROTATE]
    if len(looks) > 1:
        for cond, model, extra in looks:
            perms.append({"condition": cond, "components": {"minecraft:geometry": f"geometry.cozy_{model}", **extra}})
    desc = {"identifier": f"cozy:{key}", "menu_category": {"category": "items"},
            "traits": {"minecraft:placement_direction": {"enabled_states": ["minecraft:cardinal_direction"],
                                                         "y_rotation_offset": 180}}}
    if states:
        desc["states"] = states
    return {"format_version": "1.21.40", "minecraft:block": {"description": desc, "components": comps, "permutations": perms}}


def write(addons):
    rp, bp = os.path.join(addons, "CozyHome_RP"), os.path.join(addons, "CozyHome_BP")

    def save_json(root, rel, obj):
        p = os.path.join(root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            json.dump(obj, f, indent=2)
            f.write("\n")

    def save_png(root, rel, img):
        p = os.path.join(root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        img.save(p)

    for name in MODELS:
        save_json(rp, f"models/blocks/cozy_{name}.geo.json", geo(name))
    save_png(rp, "textures/blocks/cozy_furniture.png", furniture_texture())
    terrain = {"cozy_furniture": {"textures": "textures/blocks/cozy_furniture"}}
    flip = []
    for ch in CHANNELS:
        save_png(rp, f"textures/blocks/tv_{ch}.png", channel_texture(ch))
        terrain[f"cozy_tv_{ch}"] = {"textures": f"textures/blocks/tv_{ch}"}
        if ch in TICKS:
            flip.append({"flipbook_texture": f"textures/blocks/tv_{ch}", "atlas_tile": f"cozy_tv_{ch}",
                         "ticks_per_frame": TICKS[ch]})
    save_json(rp, "textures/terrain_texture.json", {"resource_pack_name": "cozy_home", "texture_name": "atlas.terrain",
                                                    "padding": 8, "num_mip_levels": 4, "texture_data": terrain})
    save_json(rp, "textures/flipbook_textures.json", flip)
    items = {}
    for key in DISHES:
        save_png(rp, f"textures/items/{key}.png", dish_icon(key))
        items[f"cozy_{key}"] = {"textures": f"textures/items/{key}"}
    save_json(rp, "textures/item_texture.json", {"resource_pack_name": "cozy_home", "texture_name": "atlas.items",
                                                 "texture_data": items})
    save_json(rp, "blocks.json", {"format_version": "1.21.40", **{f"cozy:{k}": {"sound": v[5]} for k, v in BLOCKS.items()}})
    for key in BLOCKS:
        save_json(bp, f"blocks/{key}.json", block_json(key))
    icon = pack_icon()
    save_png(rp, "pack_icon.png", icon)
    save_png(bp, "pack_icon.png", icon)
    print(f"cozy: {len(MODELS)} models, {len(BLOCKS)} blocks, {len(CHANNELS)} TV channels, {len(DISHES)} dishes")


# ---------------- Preview ----------------
def render_preview(path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    tex = furniture_texture()
    shows = [("Fridge", "fridge_closed", None), ("Fridge (open)", "fridge_open", None), ("Stove (cooking)", "stove_2", None),
             ("Bathtub (full)", "bathtub_full", None), ("Toilet", "toilet", None), ("TV", "tv", "fish"),
             ("Lamp (on)", "lamp_on", None), ("Mailbox (mail!)", "mailbox_up", None)]
    fig = plt.figure(figsize=(16, 4.6), dpi=100)
    bg = (1.0, 0.96, 0.97)
    fig.patch.set_facecolor(bg)

    def color_of(spec):
        return tuple(q / 255 for q in PAL[spec]) + (1,)

    for k, (title, model, channel) in enumerate(shows):
        ax = fig.add_subplot(1, len(shows), k + 1, projection="3d")
        ax.set_facecolor(bg)
        polys, cols = [], []
        for c in MODELS[model]:
            (x, y, z), (w, h, dd) = c["o"], c["s"]
            X, Z = [x, x + w], [z, z + dd]
            Y = [y, y + h]
            # plot axes: (model x, model z, up)
            quads = {
                "down": [(X[0], Z[0], Y[0]), (X[1], Z[0], Y[0]), (X[1], Z[1], Y[0]), (X[0], Z[1], Y[0])],
                "up": [(X[0], Z[0], Y[1]), (X[1], Z[0], Y[1]), (X[1], Z[1], Y[1]), (X[0], Z[1], Y[1])],
                "north": [(X[0], Z[0], Y[0]), (X[1], Z[0], Y[0]), (X[1], Z[0], Y[1]), (X[0], Z[0], Y[1])],
                "south": [(X[0], Z[1], Y[0]), (X[1], Z[1], Y[0]), (X[1], Z[1], Y[1]), (X[0], Z[1], Y[1])],
                "west": [(X[0], Z[0], Y[0]), (X[0], Z[1], Y[0]), (X[0], Z[1], Y[1]), (X[0], Z[0], Y[1])],
                "east": [(X[1], Z[0], Y[0]), (X[1], Z[1], Y[0]), (X[1], Z[1], Y[1]), (X[1], Z[0], Y[1])],
            }
            for f, q in quads.items():
                spec = c["f"].get(f, c["c"])
                if spec == "screen" or (spec.startswith("decal:") and f in ("north", "up", "west")):
                    if spec == "screen":
                        pic = screen_frames(channel)[5]
                    else:
                        u, v, ww, hh = DECAL[spec[6:]]
                        pic = tex.crop((u, v, u + ww, v + hh))
                    pw, ph = pic.size
                    for i in range(pw):
                        for j in range(ph):
                            col = tuple(t / 255 for t in pic.getpixel((i, j))[:3]) + (1,)
                            if f == "north":
                                a0, a1 = x + i * w / pw, x + (i + 1) * w / pw
                                b0, b1 = y + h - (j + 1) * h / ph, y + h - j * h / ph
                                polys.append([(a0, z - 0.02, b0), (a1, z - 0.02, b0), (a1, z - 0.02, b1), (a0, z - 0.02, b1)])
                            elif f == "west":
                                a0, a1 = z + i * dd / pw, z + (i + 1) * dd / pw
                                b0, b1 = y + h - (j + 1) * h / ph, y + h - j * h / ph
                                polys.append([(x - 0.02, a0, b0), (x - 0.02, a1, b0), (x - 0.02, a1, b1), (x - 0.02, a0, b1)])
                            else:
                                a0, a1 = x + i * w / pw, x + (i + 1) * w / pw
                                c0, c1 = z + j * dd / ph, z + (j + 1) * dd / ph
                                polys.append([(a0, c0, y + h + 0.02), (a1, c0, y + h + 0.02), (a1, c1, y + h + 0.02), (a0, c1, y + h + 0.02)])
                            cols.append(col)
                    continue
                if spec.startswith("decal:"):
                    u, v, ww, hh = DECAL[spec[6:]]
                    col = tuple(t / 255 for t in tex.getpixel((u + ww // 2, v + hh // 2))[:3]) + (1,)
                else:
                    col = color_of(spec)
                polys.append(q)
                cols.append(col)
        ax.add_collection3d(Poly3DCollection(polys, facecolors=cols, edgecolors=(0, 0, 0, 0.1), linewidths=0.1))
        ax.set_xlim(-9, 9); ax.set_ylim(-15, 9); ax.set_zlim(0, 18)
        ax.set_box_aspect((18, 24, 18))
        ax.view_init(elev=18, azim=-58)
        ax.axis("off")
        ax.set_title(title, fontsize=11, color=(0.5, 0.2, 0.35))
    plt.subplots_adjust(left=0, right=1, top=0.93, bottom=0, wspace=0)
    plt.savefig(path, facecolor=bg)
    # dishes strip
    strip = Image.new("RGBA", (16 * 5 + 4 * 6, 24), (255, 245, 248, 255))
    for i, key in enumerate(DISHES):
        strip.alpha_composite(dish_icon(key), (4 + i * 20, 4))
    strip.resize((strip.width * 8, strip.height * 8), Image.NEAREST).save(path.replace(".png", "_dishes.png"))


if __name__ == "__main__":
    write(sys.argv[1])
    if len(sys.argv) > 2:
        render_preview(sys.argv[2])
