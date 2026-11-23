"""Builds the Dino Park add-on's dinosaurs: models, textures, animations, and the entity, item and recipe files.

Eight dinosaurs hatch from eggs and grow up (babies are a small copy of the grown-up):
  Triceratops, Stegosaurus, Brachiosaurus, Ankylosaurus (2 seats each), Allosaurus, Parasaurolophus (1 seat),
  Velociraptor (a small fast pet), Pterodactyl (a flying pet you can ride; the script flies it).
Plus the T. rex, who stomps through now and then (the script walks it), and the dino egg.

Writes into <base>_BP and <base>_RP:
  RP: models/entity/*.geo.json, textures/entity/*.png, textures/items/*_egg.png, entity/*.entity.json,
      animations/dinos.animation.json, render_controllers/dinos.render_controllers.json, texts/en_US.lang,
      textures/item_texture.json, pack_icon.png
  BP: entities/*.json, items/*_egg.json, recipes/*_egg.json, pack_icon.png

Model units are pixels (16 = one block), feet at y = 0, every dinosaur faces north (-Z). Grown-ups are scale 1,
so each model is built at its real in-game size. Every face is painted from an 8x8 swatch of the dinosaur's colors.

Usage: python3 make_dinos.py <addons_dir>/DinoPark [preview.png]
"""
import json, math, os, random, sys
from PIL import Image, ImageDraw

FACES = ("north", "south", "east", "west", "up", "down")
SW = ["main", "main_hi", "belly", "dark", "stripe", "accent", "horn", "claw", "eye_w", "eye_b", "beak", "tooth",
      "wing", "armor", "spot", "accent2"]


class Geo:
    def __init__(self, S=1.0):
        self.S = S
        self.bones = {}          # name -> {"parent", "pivot", "cubes"}
        self.order = []

    def bone(self, name, parent, pivot):
        self.bones[name] = {"parent": parent, "pivot": pivot, "cubes": []}
        self.order.append(name)

    def box(self, bone, x, y, z, w, h, d, sw="main", faces=None):
        f = {}
        if sw == "main":
            f = {"up": "main_hi", "down": "belly"}
        if sw == "stripe":
            f = {"up": "main_hi", "down": "belly"}
        f.update(faces or {})
        self.bones[bone]["cubes"].append({"o": (x, y, z), "s": (w, h, d), "c": sw, "faces": f})

    def pair(self, lb, rb, x, y, z, w, h, d, sw="main", faces=None):
        """A left cube (x is its left edge, on the -x side) and its mirror image on the right."""
        self.box(lb, x, y, z, w, h, d, sw, faces)
        self.box(rb, -(x + w), y, z, w, h, d, sw, faces)

    def eyes(self, bone, half, y, z, size=2.0):
        """Big friendly eyes on both sides of the head. half = half the head's width at the eyes."""
        for side in (-1, 1):
            wx = -half - 0.3 if side < 0 else half
            self.box(bone, wx, y, z, 0.3, size, size, "eye_w")
            px = -half - 0.45 if side < 0 else half + 0.3
            self.box(bone, px, y + size * 0.1, z + size * 0.05, 0.15, size * 0.6, size * 0.55, "eye_b")

    def to_json(self, ident, vb_w, vb_h):
        S = self.S
        out = [{"name": "root", "pivot": [0, 0, 0]}]
        for name in self.order:
            b = self.bones[name]
            cubes = []
            for c in b["cubes"]:
                uv = {}
                for fc in FACES:
                    i = SW.index(c["faces"].get(fc, c["c"]))
                    uv[fc] = {"uv": [(i % 16) * 8, (i // 16) * 8], "uv_size": [8, 8]}
                cubes.append({"origin": [round(v * S, 3) for v in c["o"]], "size": [round(v * S, 3) for v in c["s"]], "uv": uv})
            out.append({"name": name, "parent": b["parent"], "pivot": [round(v * S, 3) for v in b["pivot"]], "cubes": cubes})
        return {"format_version": "1.12.0", "minecraft:geometry": [{
            "description": {"identifier": f"geometry.{ident}", "texture_width": 128, "texture_height": 16,
                            "visible_bounds_width": vb_w, "visible_bounds_height": vb_h, "visible_bounds_offset": [0, vb_h / 2 - 0.5, 0]},
            "bones": out}]}


def quad_legs(g, xs, zf, zb, hf, hb, wf, wb, foot="dark"):
    """Four legs: front pair at zf (height hf, thickness wf), back pair at zb. Bone pivots at the hips."""
    for lb, rb, z, h in (("leg_fl", "leg_fr", zf, hf), ("leg_bl", "leg_br", zb, hb)):
        g.bone(lb, "body", [-xs, h, z])
        g.bone(rb, "body", [xs, h, z])
    for (lb, rb), z, h, w in ((("leg_fl", "leg_fr"), zf, hf, wf), (("leg_bl", "leg_br"), zb, hb, wb)):
        g.pair(lb, rb, -xs - w / 2, 2, z - w / 2, w, h - 2, w, "main", {"up": "main", "down": "belly"})
        g.pair(lb, rb, -xs - w / 2 - 0.5, 0, z - w / 2 - 1, w + 1, 2, w + 1.5, foot)


def tail(g, parent, segs, sw="main"):
    """segs: [(x_half, y, z, height, length)]: each segment a box that starts at z and runs back length pixels."""
    prev = parent
    for i, (xh, y, z, h, ln) in enumerate(segs):
        name = "tail" if i == 0 else f"tail{i + 1}"
        g.bone(name, prev, [0, y + h / 2, z])
        g.box(name, -xh, y, z, xh * 2, h, ln, sw)
        prev = name
    return prev


# ---------------- The dinosaurs ----------------
def triceratops():
    g = Geo()
    g.bone("body", "root", [0, 20, 0])
    g.box("body", -9, 12, -16, 18, 16, 34, "main")                      # big barrel body
    g.box("body", -7, 28, -12, 14, 3, 24, "main_hi")                    # rounded back
    quad_legs(g, 6, -11, 11, 14, 15, 5, 6)
    g.bone("head", "body", [0, 20, -16])
    g.box("head", -6, 12, -28, 12, 11, 12, "main")                      # skull
    g.box("head", -3.5, 11, -33, 7, 7, 5, "beak")                       # beak
    g.box("head", -1, 18, -32, 2, 4, 2, "horn")                         # nose horn
    g.pair("head", "head", -5, 21, -36, 2, 2, 10, "horn")               # two long brow horns
    g.pair("head", "head", -4.5, 21.5, -39, 1, 1, 3, "horn")
    g.box("head", -12, 14, -18.5, 24, 17, 2, "accent", {"north": "accent2", "south": "accent"})   # the big frill
    for x in (-11, -6.5, -1, 4.5, 9):                                    # bumps around the frill edge
        g.box("head", x, 31, -18.5, 2, 2, 2, "horn")
    g.pair("head", "head", -13, 18, -18.5, 2, 2, 2, "horn")
    g.eyes("head", 6, 20, -25.5, 2.2)
    tail(g, "body", [(5, 17, 18, 9, 10), (3.5, 18, 28, 6, 10), (2, 18.5, 38, 4, 10)])
    return g


def stegosaurus():
    g = Geo()
    g.bone("body", "root", [0, 20, 0])
    g.box("body", -7, 11, -17, 14, 13, 14, "main")                      # shoulders (low)
    g.box("body", -8, 13, -5, 16, 15, 10, "main")                       # middle
    g.box("body", -8.5, 15, 4, 17, 15, 13, "main")                      # big rear hump (high)
    quad_legs(g, 5.5, -12, 9, 12, 18, 5, 6.5)
    g.bone("head", "body", [0, 16, -17])
    g.box("head", -3.5, 11, -24, 7, 7, 8, "main")                       # neck
    g.box("head", -3, 10, -31, 6, 6, 8, "main")                         # little head
    g.box("head", -2, 9.5, -33.5, 4, 4, 3, "beak")
    g.eyes("head", 3, 13, -29, 1.6)
    tops = {-15: 24, -10: 25, -4: 28, 2: 30, 8: 30, 13: 30}
    for i, (z, top) in enumerate(tops.items()):                         # two rows of plates, zig-zag
        x = -2.5 if i % 2 == 0 else 0.5
        h = 6 + (4 if -6 < z < 10 else 1) + (i % 2) * 2
        g.box("body", x, top, z - 3, 2, h * 0.6, 6, "accent")
        g.box("body", x, top + h * 0.6, z - 1.8, 2, h * 0.4, 3.6, "accent2")
    t = tail(g, "body", [(5, 19, 17, 9, 10), (3, 20, 27, 6, 10), (2, 20.5, 37, 4, 10)])
    g.box("tail", -1, 28, 18, 2, 5, 5, "accent")                        # plates down the tail
    g.box("tail2", -1, 26, 28, 2, 4, 4, "accent")
    for z in (41, 45):                                                   # the spiky tail (thagomizer)
        g.pair(t, t, -7, 22.5, z, 5, 1.5, 1.5, "horn")
        g.pair(t, t, -3.5, 24, z + 0.5, 1.5, 4, 1.5, "horn")
    return g


def brachiosaurus():
    g = Geo()
    g.bone("body", "root", [0, 32, 0])
    g.box("body", -10, 22, -18, 20, 18, 34, "spot")                     # body
    g.box("body", -9, 40, -18, 18, 5, 16, "main_hi")                    # tall shoulders
    g.box("body", -8, 40, -2, 16, 2, 14, "main_hi")
    quad_legs(g, 7, -11, 10, 30, 24, 7, 7.5)
    g.bone("neck", "body", [0, 38, -16])
    g.box("neck", -4, 34, -26, 8, 14, 9, "main")                        # long neck going up
    g.box("neck", -3.5, 48, -29, 7, 14, 7, "main")
    g.box("neck", -3, 62, -30.5, 6, 14, 6, "main")
    g.bone("head", "neck", [0, 76, -28])
    g.box("head", -3.5, 75, -37, 7, 6, 11, "main")
    g.box("head", -2.5, 74, -41, 5, 4, 4, "main")                       # snout
    g.box("head", -2.5, 81, -33, 5, 3, 5, "main_hi")                    # bump on top of the head
    g.box("head", -2, 73.5, -40.5, 4, 0.6, 3, "dark")                   # smile line
    g.eyes("head", 3.5, 78, -34.5, 1.8)
    tail(g, "body", [(5, 27, 16, 9, 12), (3.5, 25, 28, 7, 12), (2, 23, 40, 4, 14)])
    return g


def ankylosaurus():
    g = Geo()
    g.bone("body", "root", [0, 12, 0])
    g.box("body", -11, 7, -13, 22, 11, 28, "main")
    g.box("body", -10, 18, -12, 20, 3, 26, "armor")
    for z in (-10, -4.5, 1, 6.5):                                        # knobbly armor on the back
        for x in (-8, -3, 2):
            g.box("body", x + (1.2 if z in (-4.5, 6.5) else 0), 21, z, 3, 1.5, 3, "dark")
    for z in (-9, -3, 3, 9):                                             # spikes along the sides
        g.pair("body", "body", -13.5, 11, z, 3, 2, 2, "horn")
    quad_legs(g, 7.5, -8, 9, 9, 9, 6, 6.5)
    g.bone("head", "body", [0, 12, -13])
    g.box("head", -6, 7, -22, 12, 8, 9, "main", {"up": "armor"})
    g.box("head", -4, 7, -25, 8, 5, 3, "beak")
    g.pair("head", "head", -7.5, 13, -16, 2, 2, 2.5, "horn")
    g.eyes("head", 6, 10.5, -20.5, 1.8)
    t = tail(g, "body", [(4, 9, 15, 7, 10), (2.5, 10, 25, 5, 12)])
    g.bone("tail3", t, [0, 12, 37])
    g.box("tail3", -5, 8.5, 37, 10, 7, 7, "armor", {"up": "dark"})       # the tail club
    return g


def biped_legs(g, xs, hip_y, z, thigh, shin, foot, bone_parent="body"):
    """thigh/shin/foot: (w, h, d). Legs hang from the hips at (±xs, hip_y, z)."""
    for lb, side in (("leg_l", -1), ("leg_r", 1)):
        g.bone(lb, bone_parent, [xs * side, hip_y, z])
    tw, th, td = thigh
    sw, sh, sd = shin
    fw, fh, fd = foot
    g.pair("leg_l", "leg_r", -xs - tw / 2, hip_y - th, z - td / 2, tw, th, td, "main")
    g.pair("leg_l", "leg_r", -xs - sw / 2, fh, z - sd / 2 + td * 0.15, sw, hip_y - th - fh + 1, sd, "main")
    g.pair("leg_l", "leg_r", -xs - fw / 2, 0, z - fd + sd / 2 + td * 0.15, fw, fh, fd, "main", {"up": "main"})
    g.pair("leg_l", "leg_r", -xs - fw / 2, 0, z - fd + sd / 2 + td * 0.15 - 1, fw, fh * 0.6, 1, "claw")


def allosaurus():
    g = Geo()
    g.bone("body", "root", [0, 24, 0])
    g.box("body", -7, 18, -12, 14, 14, 24, "stripe")
    g.box("body", -6, 16, -19, 12, 14, 8, "main")                       # chest
    biped_legs(g, 5, 22, 4, (7, 11, 10), (5, 9, 5), (6, 4, 9))
    for ab, side in (("arm_l", -1), ("arm_r", 1)):
        g.bone(ab, "body", [5 * side, 22, -17])
    g.pair("arm_l", "arm_r", -7, 15, -19, 2.5, 8, 3, "main")
    g.pair("arm_l", "arm_r", -7, 13.5, -20, 2.5, 2, 2, "claw")
    g.bone("head", "body", [0, 28, -18])
    g.box("head", -4, 24, -25, 8, 10, 8, "main")                        # neck
    g.box("head", -5, 27, -39, 10, 10, 15, "main")                      # skull
    g.pair("head", "head", -4.5, 37, -32, 2, 2, 4, "accent")            # little red crests over the eyes
    g.eyes("head", 5, 32.5, -32, 2.2)
    g.box("head", -1, 34, -40, 2, 1.5, 1.5, "dark")                     # nostril bump
    g.bone("jaw", "head", [0, 27, -26])
    g.box("jaw", -4.5, 23, -38.5, 9, 4, 13, "main", {"up": "beak"})
    g.box("head", -4.6, 26, -38.8, 9.2, 1.2, 12.5, "tooth")            # rows of teeth
    g.box("jaw", -4.4, 26.6, -38.2, 8.8, 0.9, 11, "tooth")
    tail(g, "body", [(5.5, 21, 12, 10, 12), (4, 22, 24, 7, 13), (2.5, 23, 37, 5, 14)], "stripe")
    return g


def parasaurolophus():
    g = Geo()
    g.bone("body", "root", [0, 20, 0])
    g.box("body", -6, 15, -12, 12, 12, 24, "main")
    g.box("body", -5, 27, -8, 10, 2, 16, "main_hi")
    biped_legs(g, 4.5, 18, 4, (6, 9, 8), (4.5, 8, 4), (5.5, 3, 7))
    for ab, side in (("arm_l", -1), ("arm_r", 1)):
        g.bone(ab, "body", [4.5 * side, 20, -11])
    g.pair("arm_l", "arm_r", -6.5, 9, -13, 2.5, 11, 3, "main")
    g.pair("arm_l", "arm_r", -6.5, 8, -13.5, 2.5, 1.5, 3.5, "dark")
    g.bone("head", "body", [0, 24, -12])
    g.box("head", -3, 23, -19, 6, 12, 8, "main")                        # neck
    g.box("head", -3.5, 32, -27, 7, 7, 10, "main")                      # head
    g.box("head", -3, 31.5, -31.5, 6, 4, 4.5, "beak")                   # duck bill
    g.box("head", -1.5, 37, -22, 3, 3, 10, "accent")                    # the long crest sweeping back
    g.box("head", -1.5, 38.5, -12.5, 3, 3, 6, "accent2")
    g.eyes("head", 3.5, 35, -25, 1.9)
    tail(g, "body", [(4.5, 18, 12, 8, 12), (3, 19, 24, 6, 12), (1.5, 20, 36, 4, 10)])
    return g


def velociraptor():
    g = Geo()
    g.bone("body", "root", [0, 11, 0])
    g.box("body", -3, 8, -7, 6, 6, 13, "stripe")
    g.box("body", -2, 14, -5, 4, 1, 9, "accent")                        # feathers down the back
    biped_legs(g, 2.5, 10, 2, (3, 5, 4), (2.4, 5, 2), (3, 2, 4))
    g.pair("leg_l", "leg_r", -3.5, 2, -1.8, 1, 2.2, 1, "claw")         # the big toe claw
    for ab, side in (("arm_l", -1), ("arm_r", 1)):
        g.bone(ab, "body", [2.5 * side, 11, -6])
    g.pair("arm_l", "arm_r", -4, 7.5, -8, 1.5, 4, 2, "main")
    g.pair("arm_l", "arm_r", -4.4, 7, -7.5, 0.5, 4, 3.5, "accent")      # little feather wings
    g.bone("head", "body", [0, 13, -7])
    g.box("head", -1.5, 12, -10.5, 3, 4.5, 4, "main")                   # neck
    g.box("head", -2, 14, -16.5, 4, 3.5, 7, "main")
    g.box("head", -1.75, 12.6, -16, 3.5, 1.5, 6, "main", {"up": "tooth"})
    g.box("head", -2.05, 13.9, -16.3, 4.1, 0.5, 5, "tooth")
    g.eyes("head", 2, 15.5, -14, 1.4)
    tail(g, "body", [(2, 10, 6, 4, 8), (1.25, 10.5, 14, 3, 8)], "stripe")
    g.bone("tail3", "tail2", [0, 12, 22])
    g.box("tail3", -2, 11.5, 22, 4, 1, 5, "accent")                     # feathery tail tip
    return g


def pterodactyl():
    g = Geo(S=1.6)       # built small, then made 1.6x bigger: big enough to ride
    g.bone("body", "root", [0, 10, 0])
    g.box("body", -3, 8, -6, 6, 5, 12, "main")
    g.box("body", -0.75, 9, 6, 1.5, 1.5, 6, "main")                     # little tail
    g.bone("head", "body", [0, 12, -6])
    g.box("head", -1.5, 10, -10, 3, 3, 5, "main")
    g.box("head", -2, 11, -15, 4, 4, 6, "main")
    g.box("head", -1, 11, -26, 2, 2, 11, "beak")                        # long beak
    g.box("head", -0.75, 14.5, -12, 1.5, 2, 8, "accent")                # crest sweeping back
    g.box("head", -0.75, 15.5, -5, 1.5, 2, 3, "accent2")
    g.eyes("head", 2, 13, -13.5, 1.4)
    # Spread wings (flying) and folded wings (perched). The animations show one set or the other.
    for wb, fb, side in (("wing_l", "wingf_l", -1), ("wing_r", "wingf_r", 1)):
        g.bone(wb, "body", [3 * side, 12, -3])
        g.bone(fb, "body", [3 * side, 12, -3])
    g.pair("wing_l", "wing_r", -28, 11.5, -6, 25, 0.8, 9, "wing")
    g.pair("wing_l", "wing_r", -28, 11.6, -6.6, 25, 1.4, 1.6, "main")   # arm bone along the front edge
    g.pair("wing_l", "wing_r", -28.5, 11, -7, 1.5, 2, 2, "claw")
    g.pair("wingf_l", "wingf_r", -4, 6.5, -6, 1.2, 6, 13, "wing")       # folded along the sides
    g.pair("wingf_l", "wingf_r", -4.3, 11.5, -6.5, 1.6, 1.6, 4, "main")
    biped_legs(g, 1.8, 8.5, 3, (1.6, 2.5, 2), (1.2, 4, 1.2), (2, 1, 2.5))
    return g


def trex():
    g = Geo(S=2.0)       # an allosaurus-shaped base, made twice as big: about 5 blocks tall and 11 long
    g.bone("body", "root", [0, 26, 0])
    g.box("body", -8, 19, -13, 16, 16, 26, "stripe")
    g.box("body", -7, 17, -20, 14, 16, 9, "main")
    biped_legs(g, 5.5, 24, 4, (8, 12, 11), (5.5, 10, 6), (7, 4, 10))
    for ab, side in (("arm_l", -1), ("arm_r", 1)):
        g.bone(ab, "body", [5.5 * side, 22, -18])
    g.pair("arm_l", "arm_r", -7, 17.5, -20, 2, 5, 2.5, "main")           # tiny arms!
    g.pair("arm_l", "arm_r", -7, 16.5, -21, 2, 1.5, 1.5, "claw")
    g.bone("head", "body", [0, 30, -20])
    g.box("head", -5, 26, -27, 10, 12, 9, "main")                       # thick neck
    g.box("head", -6.5, 29, -43, 13, 12, 17, "main")                    # huge head
    g.box("head", -5.5, 31, -46, 11, 8, 3, "main")                      # snout
    g.pair("head", "head", -6, 40, -36, 3, 1.5, 6, "dark")              # brows
    g.eyes("head", 6.5, 36, -35, 2.2)
    g.bone("jaw", "head", [0, 29, -28])
    g.box("jaw", -6, 24, -45, 12, 5, 17, "main", {"up": "beak"})
    g.box("head", -6.1, 28, -45.5, 12.2, 1.3, 16, "tooth")
    g.box("jaw", -5.9, 28.6, -44.8, 11.8, 1, 15, "tooth")
    tail(g, "body", [(6.5, 22, 13, 12, 13), (4.5, 24, 26, 8, 14), (3, 25, 40, 5, 15)], "stripe")
    return g


# ---------------- Colors ----------------
PALETTES = {
    "triceratops": dict(main=(204, 128, 66), belly=(236, 200, 146), dark=(110, 70, 40), accent=(222, 78, 62), accent2=(250, 186, 70),
                        horn=(242, 234, 212), beak=(92, 70, 56)),
    "stegosaurus": dict(main=(102, 150, 84), belly=(206, 212, 150), dark=(54, 82, 44), accent=(232, 122, 52), accent2=(246, 186, 76),
                        horn=(240, 232, 210), beak=(70, 92, 56)),
    "brachiosaurus": dict(main=(126, 156, 184), belly=(212, 220, 228), dark=(78, 100, 128), accent=(96, 124, 156), accent2=(150, 180, 205),
                          horn=(230, 230, 230), beak=(90, 110, 130)),
    "ankylosaurus": dict(main=(176, 150, 102), belly=(222, 206, 166), dark=(96, 78, 54), accent=(150, 120, 80), accent2=(186, 160, 110),
                         horn=(242, 232, 206), beak=(84, 70, 54), armor=(126, 104, 72)),
    "allosaurus": dict(main=(184, 98, 62), belly=(238, 214, 170), dark=(108, 52, 36), accent=(226, 58, 52), accent2=(250, 170, 60),
                       horn=(242, 232, 210), beak=(150, 70, 70)),
    "parasaurolophus": dict(main=(84, 156, 128), belly=(232, 226, 160), dark=(44, 96, 78), accent=(238, 136, 56), accent2=(252, 196, 82),
                            horn=(240, 232, 210), beak=(206, 172, 96)),
    "velociraptor": dict(main=(126, 114, 156), belly=(214, 206, 226), dark=(70, 60, 96), accent=(70, 170, 214), accent2=(120, 210, 240),
                         horn=(240, 232, 210), beak=(100, 90, 120)),
    "pterodactyl": dict(main=(196, 124, 82), belly=(236, 206, 170), dark=(110, 64, 40), accent=(226, 64, 60), accent2=(250, 160, 60),
                        horn=(240, 232, 210), beak=(232, 190, 92), wing=(226, 160, 112)),
    "trex": dict(main=(92, 106, 72), belly=(196, 186, 140), dark=(52, 60, 40), accent=(150, 70, 50), accent2=(190, 110, 60),
                 horn=(240, 232, 210), beak=(170, 80, 80)),
}


def noisy(base, seed, spread=0.12):
    rnd = random.Random(seed)
    img = Image.new("RGBA", (8, 8))
    for x in range(8):
        for y in range(8):
            r = rnd.random()
            k = 1 + spread if r < 0.18 else 1 - spread if r < 0.36 else 1.0
            img.putpixel((x, y), tuple(max(0, min(255, int(v * k))) for v in base) + (255,))
    return img


def texture(kind):
    p = dict(PALETTES[kind])
    p.setdefault("wing", p["main"])
    p.setdefault("armor", p["dark"])
    p["main_hi"] = tuple(min(255, int(c * 1.12 + 8)) for c in p["main"])
    tex = Image.new("RGBA", (128, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)
    seed = sum(map(ord, kind))
    for i, name in enumerate(SW):
        u, v = (i % 16) * 8, (i // 16) * 8
        if name in ("main", "main_hi", "belly", "dark", "armor", "accent", "accent2"):
            tex.paste(noisy(p[name], seed + i), (u, v))
        elif name == "stripe":                 # tiger-ish stripes
            tex.paste(noisy(p["main"], seed + i), (u, v))
            for x in (1, 4, 6):
                d.line([u + x, v, u + x, v + 4 + (x % 3)], fill=p["dark"] + (255,))
        elif name == "spot":                   # giraffe-ish spots
            tex.paste(noisy(p["main"], seed + i), (u, v))
            for x, y in ((1, 1), (5, 2), (2, 5), (6, 6)):
                d.rectangle([u + x, v + y, u + x + 1, v + y + 1], fill=p["dark"] + (255,))
        elif name == "wing":                   # wing skin with darker veins
            tex.paste(noisy(p["wing"], seed + i, 0.06), (u, v))
            for y in (2, 5):
                d.line([u, v + y, u + 7, v + y + 1], fill=tuple(int(c * 0.8) for c in p["wing"]) + (255,))
        elif name == "horn":
            for y in range(8):
                c = tuple(int(q * (1 - y * 0.03)) for q in p["horn"])
                d.line([u, v + y, u + 7, v + y], fill=c + (255,))
        elif name == "claw":
            d.rectangle([u, v, u + 7, v + 7], fill=(58, 54, 52, 255))
        elif name == "eye_w":
            d.rectangle([u, v, u + 7, v + 7], fill=(250, 250, 244, 255))
        elif name == "eye_b":
            d.rectangle([u, v, u + 7, v + 7], fill=(22, 18, 18, 255))
            d.rectangle([u + 1, v + 1, u + 2, v + 2], fill=(255, 255, 255, 255))   # a shine
        elif name == "beak":
            tex.paste(noisy(p["beak"], seed + i, 0.06), (u, v))
        elif name == "tooth":
            d.rectangle([u, v, u + 7, v + 7], fill=(248, 246, 236, 255))
            for x in (1, 3, 5, 7):
                d.point((u + x, v + 7), fill=(200, 196, 186, 255))
    return tex


# ---------------- Species (keep in sync with SPECIES in scripts/main.js) ----------------
PLANTS = ["minecraft:wheat", "minecraft:wheat_seeds", "minecraft:apple", "minecraft:carrot", "minecraft:melon_slice",
          "minecraft:sweet_berries", "minecraft:beetroot", "minecraft:potato", "minecraft:sugar_cane", "minecraft:kelp",
          "minecraft:oak_leaves", "minecraft:birch_leaves", "minecraft:spruce_leaves", "minecraft:jungle_leaves",
          "minecraft:acacia_leaves", "minecraft:dark_oak_leaves", "minecraft:cherry_leaves", "minecraft:hay_block"]
MEAT = ["minecraft:beef", "minecraft:cooked_beef", "minecraft:chicken", "minecraft:cooked_chicken", "minecraft:porkchop",
        "minecraft:cooked_porkchop", "minecraft:mutton", "minecraft:cooked_mutton", "minecraft:rabbit", "minecraft:cooked_rabbit",
        "minecraft:cod", "minecraft:salmon", "minecraft:cooked_cod", "minecraft:cooked_salmon", "minecraft:rotten_flesh"]
FISH = ["minecraft:cod", "minecraft:salmon", "minecraft:cooked_cod", "minecraft:cooked_salmon", "minecraft:tropical_fish",
        "minecraft:beef", "minecraft:chicken", "minecraft:cooked_beef", "minecraft:cooked_chicken"]

# key: (display name, build, seats [y, z...], speed, collision (w, h), food, legs walk factor, biped, dye for the recipe,
#       egg color, egg spot color, protects you from monsters, vb (width, height))
SPECIES = [
    ("triceratops", "Triceratops", triceratops, [1.62, [0.3, -0.5]], 0.24, (1.8, 2.0), PLANTS, 17, False, "orange_dye", (226, 156, 92), (160, 90, 50), False, (6, 3)),
    ("stegosaurus", "Stegosaurus", stegosaurus, [1.62, [0.3, -0.5]], 0.22, (1.7, 2.2), PLANTS, 15, False, "green_dye", (132, 178, 104), (232, 122, 52), False, (6, 3.5)),
    ("brachiosaurus", "Brachiosaurus", brachiosaurus, [2.25, [0.2, -0.6]], 0.22, (1.9, 3.0), PLANTS, 9, False, "light_blue_dye", (160, 190, 214), (90, 112, 140), False, (7, 7)),
    ("ankylosaurus", "Ankylosaurus", ankylosaurus, [1.05, [0.3, -0.5]], 0.2, (1.8, 1.4), PLANTS, 24, False, "brown_dye", (200, 176, 128), (110, 90, 60), False, (5, 2.5)),
    ("allosaurus", "Allosaurus", allosaurus, [1.7, [0.0]], 0.3, (1.3, 2.4), MEAT, 13, True, "red_dye", (214, 120, 84), (120, 56, 40), True, (7, 3.5)),
    ("parasaurolophus", "Parasaurolophus", parasaurolophus, [1.42, [0.0]], 0.28, (1.2, 2.4), PLANTS, 16, True, "cyan_dye", (110, 182, 152), (238, 136, 56), False, (6, 3.5)),
    ("velociraptor", "Velociraptor", velociraptor, None, 0.36, (0.7, 1.0), MEAT, 30, True, "purple_dye", (160, 148, 190), (70, 170, 214), True, (3, 2)),
    ("pterodactyl", "Pterodactyl", pterodactyl, [1.0, [0.0]], 0.0, (1.2, 1.2), FISH, 30, True, "yellow_dye", (230, 170, 120), (226, 64, 60), False, (6, 3)),
]
BABY_SCALE = 0.35
# How far away each dino likes to keep while following you: it starts walking over when you're farther than
# the first number and stops at the second (measured from its middle, so big dinos keep well back).
# Keep in sync with FOLLOW_GAP in scripts/main.js.
FOLLOW = {"triceratops": (12, 7), "stegosaurus": (12, 7), "brachiosaurus": (15, 9), "ankylosaurus": (11, 6),
          "allosaurus": (12, 7), "parasaurolophus": (12, 7), "velociraptor": (8, 4), "pterodactyl": (12, 7)}
GROW_AT = 5           # treats to grow up (also grows by itself over time; see main.js)


def bones_of(g):
    return set(g.order)


def animations(kind, g, walk_f, biped):
    b = bones_of(g)
    A = {}
    if kind == "pterodactyl":
        # Flapping and perching follow the "dino:flying" property, which the script sets (like the Alpha Dog's head tilt).
        flap = "math.sin(query.life_time * 480) * 48 * (math.mod(query.life_time, 6) < 4.6 ? 1 : 0.15)"
        A[f"animation.dino.{kind}.fly"] = {"loop": True, "bones": {
            "wing_l": {"rotation": [0, 0, f"{flap} - 6"]},
            "wing_r": {"rotation": [0, 0, f"-({flap}) + 6"]},
            "wingf_l": {"scale": 0.01}, "wingf_r": {"scale": 0.01},
            "body": {"position": [0, "math.sin(query.life_time * 480 - 90) * 1.5", 0]},
            "head": {"rotation": ["math.sin(query.life_time * 480) * 4", 0, 0]},
            "leg_l": {"rotation": [65, 0, 0]}, "leg_r": {"rotation": [65, 0, 0]}}}
        A[f"animation.dino.{kind}.perch"] = {"loop": True, "bones": {
            "wing_l": {"scale": 0.01}, "wing_r": {"scale": 0.01},
            "head": {"rotation": ["math.sin(query.life_time * 60) * 6", 0, 0]}}}
        # Waddling on the ground (the script moves it and sets "dino:walking"): legs step, body rocks, head bobs.
        A[f"animation.dino.{kind}.waddle"] = {"loop": True, "bones": {
            "leg_l": {"rotation": ["math.sin(query.life_time * 620) * 38", 0, 0]},
            "leg_r": {"rotation": ["-math.sin(query.life_time * 620) * 38", 0, 0]},
            "body": {"rotation": [6, 0, "math.sin(query.life_time * 620) * 7"],
                     "position": [0, "math.abs(math.sin(query.life_time * 620)) * 0.8", 0]},
            "head": {"rotation": ["math.sin(query.life_time * 1240) * 7", 0, 0]},
            "wingf_l": {"rotation": [0, 0, "math.abs(math.sin(query.life_time * 620)) * -10"]},
            "wingf_r": {"rotation": [0, 0, "math.abs(math.sin(query.life_time * 620)) * 10"]}}}
    else:
        # Walking, the same way as the Alpha Dog's legs (which work on the iPad): the legs swing with distance walked,
        # as much as the dino is moving. Babies' little legs take quicker steps (variant 0 = baby, 1 = grown-up).
        F = round(walk_f * 2.2, 1)
        phase = f"query.modified_distance_moved * {F} * (query.variant == 1 ? 1 : 2.4)"
        w = "math.clamp(query.modified_move_speed * 3, 0, 1)"
        amp = 45 if biped else 38
        step = f"math.cos({phase}) * {amp} * {w}"
        if biped:
            legs = {"leg_l": {"rotation": [step, 0, 0]}, "leg_r": {"rotation": [f"-({step})", 0, 0]}}
            if "arm_l" in b:
                legs["arm_l"] = {"rotation": [f"-({step}) * 0.4", 0, 0]}
                legs["arm_r"] = {"rotation": [f"({step}) * 0.4", 0, 0]}
            sway = f"math.sin({phase}) * 4 * {w}"          # bipeds rock side to side as they step
        else:
            legs = {"leg_fl": {"rotation": [step, 0, 0]}, "leg_br": {"rotation": [step, 0, 0]},
                    "leg_fr": {"rotation": [f"-({step})", 0, 0]}, "leg_bl": {"rotation": [f"-({step})", 0, 0]}}
            sway = f"math.sin({phase}) * 2 * {w}"
        legs["body"] = {"position": [0, f"math.abs(math.sin({phase})) * 1.2 * {w}", 0], "rotation": [0, sway, 0]}
        legs["head"] = {"rotation": [f"math.sin({phase} * 2) * 4 * {w}", 0, 0]}
        A[f"animation.dino.{kind}.walk"] = {"loop": True, "bones": legs}
    tails = {}
    for i, t in enumerate(["tail", "tail2", "tail3"]):
        if t in b:
            tails[t] = {"rotation": [f"math.sin(query.life_time * 100 - {i * 40}) * 1.5",
                                     f"math.sin(query.life_time * 80 - {i * 45}) * {5 + i * 3}", 0]}
    if tails:   # (no tail bones, no tail animation: Minecraft rejects the whole file over an empty animation)
        A[f"animation.dino.{kind}.tail"] = {"loop": True, "bones": tails}
    A[f"animation.dino.{kind}.look"] = {"loop": True, "bones": {"head": {"rotation": ["query.target_x_rotation * 0.6", "query.target_y_rotation * 0.6", 0]}}}
    return A


def trex_animations():
    step = "query.life_time * 260"
    return {
        "animation.dino.trex.walk": {"loop": True, "bones": {
            "leg_l": {"rotation": [f"math.sin({step}) * 24", 0, 0]},
            "leg_r": {"rotation": [f"-math.sin({step}) * 24", 0, 0]},
            "body": {"position": [0, f"math.abs(math.cos({step})) * 1.2", 0], "rotation": [0, f"math.sin({step}) * 3", 0]},
            "head": {"rotation": [f"math.sin({step} * 2) * 3", f"-math.sin({step}) * 5", 0]},
            "arm_l": {"rotation": [f"math.sin({step} * 2) * 10", 0, 0]},
            "arm_r": {"rotation": [f"-math.sin({step} * 2) * 10", 0, 0]},
            "tail": {"rotation": [0, f"-math.sin({step}) * 6", 0]},
            "tail2": {"rotation": [0, f"-math.sin({step} - 40) * 8", 0]},
            "tail3": {"rotation": [0, f"-math.sin({step} - 80) * 10", 0]}}},
        # ROAR: head up, mouth wide open, a shake.
        "animation.dino.trex.roar": {"loop": True, "bones": {
            "head": {"rotation": [f"-22 + math.sin(query.life_time * 2400) * 2", 0, 0]},
            "jaw": {"rotation": [34, 0, 0]},
            "body": {"rotation": [-6, 0, 0]},
            "tail": {"rotation": [8, 0, 0]}}},
    }


# ---------------- Eggs ----------------
EGG = [(-3, 0, -3, 6, 1, 6), (-4, 1, -4, 8, 6, 8), (-3.5, 7, -3.5, 7, 2, 7), (-2.5, 9, -2.5, 5, 1.5, 5)]


def egg_geo():
    cubes = [{"origin": [x, y, z], "size": [w, h, dd], "uv": {f: {"uv": [0, 0], "uv_size": [16, 16]} for f in FACES}}
             for (x, y, z, w, h, dd) in EGG]
    return {"format_version": "1.12.0", "minecraft:geometry": [{
        "description": {"identifier": "geometry.dino_egg", "texture_width": 16, "texture_height": 16,
                        "visible_bounds_width": 1.5, "visible_bounds_height": 1.5, "visible_bounds_offset": [0, 0.5, 0]},
        "bones": [{"name": "egg", "pivot": [0, 0, 0], "cubes": cubes}]}]}


def egg_texture(base, spot, seed):
    rnd = random.Random(seed)
    tex = Image.new("RGBA", (16, 16))
    for x in range(16):
        for y in range(16):
            k = 1 + (rnd.random() - 0.5) * 0.1
            tex.putpixel((x, y), tuple(min(255, int(c * k)) for c in base) + (255,))
    d = ImageDraw.Draw(tex)
    for _ in range(9):
        x, y = rnd.randrange(15), rnd.randrange(15)
        d.rectangle([x, y, x + rnd.choice((0, 1)), y + 1], fill=spot + (255,))
    return tex


def egg_icon(base, spot, seed):
    rnd = random.Random(seed)
    tex = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    for x in range(16):
        for y in range(16):
            nx, ny = (x + 0.5 - 8) / 5.4, (y + 0.5 - 9) / 6.6
            if ny < 0:
                nx *= 1.15
            if nx * nx + ny * ny <= 1:
                c = tuple(min(255, int(q * 1.15 + 12)) for q in base) if nx < -0.3 and ny < -0.1 else base
                tex.putpixel((x, y), c + (255,))
    for _ in range(7):
        x, y = rnd.randrange(4, 12), rnd.randrange(4, 14)
        if tex.getpixel((x, y))[3] and tex.getpixel((x + 1, y))[3]:
            tex.putpixel((x, y), spot + (255,))
            tex.putpixel((x + 1, y), spot + (255,))
    tex.putpixel((6, 5), (255, 255, 255, 255))
    out = tex.copy()
    edge = tuple(int(c * 0.55) for c in base) + (255,)
    for x in range(16):
        for y in range(16):
            if tex.getpixel((x, y))[3] == 0 and any(0 <= x + a < 16 and 0 <= y + c < 16 and tex.getpixel((x + a, y + c))[3]
                                                    for a, c in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                out.putpixel((x, y), edge)
    return out


# ---------------- Entity files ----------------
def bp_entity(key, seats, speed, coll, food, protects):
    ident = f"dino:{key}"
    fly = key == "pterodactyl"
    adult = {"minecraft:scale": {"value": 1.0}, "minecraft:variant": {"value": 1}}
    if not fly:
        adult["minecraft:movement"] = {"value": speed}
    if seats:
        y, zs = seats
        adult["minecraft:rideable"] = {
            "seat_count": len(zs), "family_types": ["player"], "crouching_skip_interact": True,
            "interact_text": "action.interact.ride.horse", "pull_in_entities": False,
            "seats": [{"position": [0, y, z]} for z in zs] if len(zs) > 1 else {"position": [0, y, zs[0]]}}
        if not fly:
            adult["minecraft:input_ground_controlled"] = {}
            adult["minecraft:can_power_jump"] = {}
            adult["minecraft:horse.jump_strength"] = {"value": 0.8}
            adult["minecraft:variable_max_auto_step"] = {"base_value": 1.0625, "controlled_value": 1.0625, "jump_prevented_value": 0.5625}
    baby = {"minecraft:scale": {"value": BABY_SCALE}, "minecraft:variant": {"value": 0}}
    if not fly:
        baby["minecraft:movement"] = {"value": max(0.25, speed)}
    groups = {"dino:baby": baby, "dino:adult": adult, "dino:stay": {}, "dino:roam": {}}
    if fly:
        groups["dino:flying"] = {"minecraft:mark_variant": {"value": 1}}
        groups["dino:perched"] = {"minecraft:mark_variant": {"value": 0}}
        groups["dino:follow"] = {}
    else:
        groups["dino:follow"] = {
            "minecraft:behavior.follow_owner": {"priority": 6, "speed_multiplier": 1.15,
                                                "start_distance": FOLLOW[key][0], "stop_distance": FOLLOW[key][1]},
            "minecraft:behavior.random_stroll": {"priority": 8, "speed_multiplier": 0.7, "xz_dist": 6, "y_dist": 5, "interval": 140}}
        # Wandering: roams around its home spot (where you told it to wander) and doesn't follow anyone.
        # The script also walks it home if it ever gets more than 28 blocks away.
        groups["dino:roam"] = {
            "minecraft:home": {"restriction_radius": 14},
            "minecraft:behavior.move_towards_home_restriction": {"priority": 7, "speed_multiplier": 0.8},
            "minecraft:behavior.random_stroll": {"priority": 8, "speed_multiplier": 0.6, "xz_dist": 8, "y_dist": 5, "interval": 90}}
    comps = {
        "minecraft:type_family": {"family": ["dino", key, "pet", "mob"]},
        "minecraft:health": {"value": 60, "max": 60},
        "minecraft:damage_sensor": {"triggers": {"cause": "all", "deals_damage": False}},
        "minecraft:is_tamed": {},
        "minecraft:tameable": {"probability": 0.0, "tame_items": "minecraft:bone"},
        "minecraft:nameable": {"always_show": False, "allow_name_tag_renaming": True},
        "minecraft:leashable": {"soft_distance": 4, "hard_distance": 6, "max_distance": 10},
        "minecraft:persistent": {},
        "minecraft:collision_box": {"width": coll[0], "height": coll[1]},
        "minecraft:pushable": {"is_pushable": not fly, "is_pushable_by_piston": not fly},
        "minecraft:breathable": {"total_supply": 15, "suffocate_time": 0, "breathes_water": True},
        "minecraft:fire_immune": {},
    }
    if fly:
        comps["minecraft:physics"] = {"has_gravity": False, "has_collision": True}
        comps["minecraft:knockback_resistance"] = {"value": 1}
    else:
        comps.update({
            "minecraft:physics": {},
            "minecraft:movement.basic": {},
            "minecraft:jump.static": {},
            "minecraft:navigation.walk": {"can_path_over_water": True, "can_swim": True, "avoid_damage_blocks": True},
            "minecraft:behavior.float": {"priority": 0},
            "minecraft:behavior.look_at_player": {"priority": 9, "look_distance": 8, "probability": 0.03},
            "minecraft:behavior.random_look_around": {"priority": 10},
        })
    if protects:   # meat-eaters hunt hostile mobs anywhere near them (not creepers: they'd blow up next to you)
        monster_filter = {"all_of": [
            {"test": "is_family", "subject": "other", "value": "monster"},
            {"none_of": [{"test": "is_family", "subject": "other", "value": v} for v in
                         ("creeper", "enderman", "zombie_pigman", "piglin", "warden", "wither", "ender_dragon", "creaking", "ghast")]}]}
        comps.update({
            "minecraft:attack": {"damage": 8 if key == "allosaurus" else 4},
            "minecraft:behavior.melee_attack": {"priority": 3, "speed_multiplier": 1.3, "track_target": True, "reach_multiplier": 1.6},
            "minecraft:behavior.nearest_attackable_target": {"priority": 4, "must_see": True, "reselect_targets": True, "within_radius": 16,
                                                              "entity_types": [{"filters": monster_filter, "max_dist": 16}]},
            "minecraft:behavior.owner_hurt_by_target": {"priority": 1, "entity_types": [{"filters": {"none_of": [
                {"test": "is_family", "subject": "other", "value": "player"}, {"test": "is_family", "subject": "other", "value": "pet"}]}}]},
        })

    def swap(add, remove):
        return {"remove": {"component_groups": remove}, "add": {"component_groups": add}}
    events = {
        "minecraft:entity_spawned": {"add": {"component_groups": ["dino:baby", "dino:follow"] + (["dino:flying"] if fly else [])}},
        "dino:baby": swap(["dino:baby"], ["dino:adult"]),
        "dino:grow_up": swap(["dino:adult"], ["dino:baby"]),
        "dino:follow": swap(["dino:follow"], ["dino:stay", "dino:roam"]),
        "dino:stay": swap(["dino:stay"], ["dino:follow", "dino:roam"]),
        "dino:roam": swap(["dino:roam"], ["dino:follow", "dino:stay"]),
    }
    if fly:
        events["dino:fly"] = swap(["dino:flying"], ["dino:perched"])
        events["dino:perch"] = swap(["dino:perched"], ["dino:flying"])
    desc = {"identifier": ident, "is_spawnable": False, "is_summonable": True}
    if fly:
        desc["properties"] = {"dino:flying": {"type": "bool", "default": True, "client_sync": True},
                              "dino:walking": {"type": "bool", "default": False, "client_sync": True}}
    return {"format_version": "1.20.0", "minecraft:entity": {
        "description": desc, "component_groups": groups, "components": comps, "events": events}}


def rp_entity(key, biped, anim_names):
    fly = key == "pterodactyl"
    anims = {"look": f"animation.dino.{key}.look"}
    animate = ["look"]
    if f"animation.dino.{key}.tail" in anim_names:
        anims["tail"] = f"animation.dino.{key}.tail"
        animate.insert(0, "tail")
    if fly:
        anims.update({"fly": f"animation.dino.{key}.fly", "perch": f"animation.dino.{key}.perch",
                      "waddle": f"animation.dino.{key}.waddle"})
        animate += [{"fly": "query.property('dino:flying')"}, {"perch": "!query.property('dino:flying')"},
                    {"waddle": "!query.property('dino:flying') && query.property('dino:walking')"}]
    else:
        anims["walk"] = f"animation.dino.{key}.walk"
        animate.insert(0, "walk")
    return {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": f"dino:{key}", "materials": {"default": "entity_alphatest"},
        "textures": {"default": f"textures/entity/dino_{key}"}, "geometry": {"default": f"geometry.dino_{key}"},
        "animations": anims, "scripts": {"animate": animate}, "render_controllers": ["controller.render.default"]}}}


def trex_bp():
    return {"format_version": "1.20.0", "minecraft:entity": {
        "description": {"identifier": "dino:trex", "is_spawnable": False, "is_summonable": True},
        "component_groups": {"dino:walking": {"minecraft:mark_variant": {"value": 0}},
                             "dino:roaring": {"minecraft:mark_variant": {"value": 1}}},
        "components": {
            "minecraft:type_family": {"family": ["trex", "inanimate"]},
            "minecraft:physics": {"has_gravity": False, "has_collision": False},
            "minecraft:collision_box": {"width": 2.5, "height": 4.5},
            "minecraft:health": {"value": 200, "max": 200},
            "minecraft:damage_sensor": {"triggers": {"cause": "all", "deals_damage": False}},
            "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
            "minecraft:knockback_resistance": {"value": 1},
            "minecraft:fire_immune": {},
            "minecraft:mark_variant": {"value": 0}},
        "events": {
            "dino:walk": {"remove": {"component_groups": ["dino:roaring"]}, "add": {"component_groups": ["dino:walking"]}},
            "dino:roar": {"remove": {"component_groups": ["dino:walking"]}, "add": {"component_groups": ["dino:roaring"]}}}}}


def trex_rp():
    return {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": "dino:trex", "materials": {"default": "entity_alphatest"},
        "textures": {"default": "textures/entity/dino_trex"}, "geometry": {"default": "geometry.dino_trex"},
        "animations": {"walk": "animation.dino.trex.walk", "roar": "animation.dino.trex.roar"},
        "scripts": {"animate": [{"walk": "query.mark_variant == 0"}, {"roar": "query.mark_variant == 1"}]},
        "render_controllers": ["controller.render.default"]}}}


def egg_bp():
    groups = {f"dino:kind_{i}": {"minecraft:variant": {"value": i}} for i in range(len(SPECIES))}
    events = {f"dino:kind_{i}": {"remove": {"component_groups": [g for g in groups if g != f"dino:kind_{i}"]},
                                 "add": {"component_groups": [f"dino:kind_{i}"]}} for i in range(len(SPECIES))}
    return {"format_version": "1.20.0", "minecraft:entity": {
        "description": {"identifier": "dino:egg", "is_spawnable": False, "is_summonable": True},
        "component_groups": groups,
        "components": {
            "minecraft:physics": {"has_gravity": True, "has_collision": True},
            "minecraft:health": {"value": 20, "max": 20},
            "minecraft:damage_sensor": {"triggers": {"cause": "all", "deals_damage": False}},
            "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
            "minecraft:knockback_resistance": {"value": 1},
            "minecraft:fire_immune": {},
            "minecraft:breathable": {"breathes_air": True, "breathes_water": True},
            "minecraft:persistent": {},
            "minecraft:variant": {"value": 0},
            "minecraft:type_family": {"family": ["dino_egg", "inanimate"]},
            "minecraft:collision_box": {"width": 0.6, "height": 0.7}},
        "events": events}}


def egg_rp():
    return {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": "dino:egg", "materials": {"default": "entity_alphatest"},
        "textures": {s[0]: f"textures/entity/dino_egg_{s[0]}" for s in SPECIES},
        "geometry": {"default": "geometry.dino_egg"},
        "animations": {"wobble": "animation.dino.egg.wobble"}, "scripts": {"animate": ["wobble"]},
        "render_controllers": ["controller.render.dino_egg"]}}}


EGG_WOBBLE = {"animation.dino.egg.wobble": {"loop": True, "bones": {"egg": {"rotation": [
    "math.sin(query.life_time * 400) * (math.mod(query.life_time, 3) > 2.2 ? 9 : 2)", 0,
    "math.cos(query.life_time * 300) * (math.mod(query.life_time, 3) > 2.2 ? 9 : 2)"]}}}}


def write_pack(base):
    bp, rp = base + "_BP", base + "_RP"

    def save_json(root, rel, obj):
        p = os.path.join(root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            json.dump(obj, f, indent=2)
            f.write("\n")

    def save_png(rel, img):
        p = os.path.join(rp, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        img.save(p)

    # One animation file per dinosaur (and one each for the egg and the T. rex), so one bad animation can't stop
    # all the others from loading.
    def save_anims(name, anims):
        for k, v in anims.items():
            assert v.get("bones"), f"empty animation {k}"
        save_json(rp, f"animations/{name}.animation.json", {"format_version": "1.8.0", "animations": anims})
    old_file = os.path.join(rp, "animations/dinos.animation.json")
    if os.path.exists(old_file):
        os.remove(old_file)
    save_anims("dino_egg", EGG_WOBBLE)
    lang = ["entity.dino:egg.name=Dino Egg", "entity.dino:trex.name=T. rex"]
    item_tex = {}
    for i, (key, name, build, seats, speed, coll, food, walk_f, biped, dye, ecol, espot, protects, vb) in enumerate(SPECIES):
        g = build()
        save_json(rp, f"models/entity/dino_{key}.geo.json", g.to_json(f"dino_{key}", *vb))
        save_png(f"textures/entity/dino_{key}.png", texture(key))
        save_png(f"textures/entity/dino_egg_{key}.png", egg_texture(ecol, espot, i))
        save_png(f"textures/items/dino_{key}_egg.png", egg_icon(ecol, espot, i))
        save_json(bp, f"entities/{key}.json", bp_entity(key, seats, speed, coll, food, protects))
        save_json(bp, f"items/{key}_egg.json", {"format_version": "1.21.50", "minecraft:item": {
            "description": {"identifier": f"dino:{key}_egg", "menu_category": {"category": "nature"}},
            "components": {"minecraft:icon": {"textures": {"default": f"dino_{key}_egg"}},
                           "minecraft:display_name": {"value": f"{name} Egg"}, "minecraft:max_stack_size": 16}}})
        save_json(bp, f"recipes/{key}_egg.json", {"format_version": "1.20.10", "minecraft:recipe_shapeless": {
            "description": {"identifier": f"dino:{key}_egg_recipe"}, "tags": ["crafting_table"],
            "ingredients": [{"item": "minecraft:egg"}, {"item": "minecraft:bone"}, {"item": f"minecraft:{dye}"}],
            "unlock": [{"item": "minecraft:bone"}], "result": {"item": f"dino:{key}_egg"}}})
        item_tex[f"dino_{key}_egg"] = {"textures": f"textures/items/dino_{key}_egg"}
        lang.append(f"entity.dino:{key}.name={name}")
        lang.append(f"item.dino:{key}_egg={name} Egg")
        A = animations(key, g, walk_f, biped)
        save_anims(f"dino_{key}", A)
        save_json(rp, f"entity/dino_{key}.entity.json", rp_entity(key, biped, A))
    g = trex()
    save_json(rp, "models/entity/dino_trex.geo.json", g.to_json("dino_trex", 12, 7))
    save_png("textures/entity/dino_trex.png", texture("trex"))
    save_json(rp, "entity/dino_trex.entity.json", trex_rp())
    save_json(bp, "entities/trex.json", trex_bp())
    save_anims("dino_trex", trex_animations())
    save_json(rp, "models/entity/dino_egg.geo.json", egg_geo())
    save_json(rp, "entity/dino_egg.entity.json", egg_rp())
    save_json(bp, "entities/egg.json", egg_bp())
    save_json(rp, "render_controllers/dinos.render_controllers.json", {"format_version": "1.8.0", "render_controllers": {
        "controller.render.dino_egg": {
            "arrays": {"textures": {"Array.eggs": [f"Texture.{s[0]}" for s in SPECIES]}},
            "geometry": "Geometry.default", "materials": [{"*": "Material.default"}], "textures": ["Array.eggs[query.variant]"]}}})
    save_json(rp, "textures/item_texture.json", {"resource_pack_name": "dinopark", "texture_name": "atlas.items", "texture_data": item_tex})
    os.makedirs(os.path.join(rp, "texts"), exist_ok=True)
    with open(os.path.join(rp, "texts/en_US.lang"), "w") as f:
        f.write("\n".join(lang) + "\n")
    save_json(rp, "texts/languages.json", ["en_US"])


# ---------------- Preview ----------------
SHADE = {"up": 1.0, "north": 0.85, "south": 0.7, "west": 0.62, "east": 0.9, "down": 0.5}


def cube_faces(x, y, z, w, h, dd):
    X, Y, Z = [x, x + w], [z, z + dd], [y, y + h]
    return {
        "down": [(X[0], Y[0], Z[0]), (X[1], Y[0], Z[0]), (X[1], Y[1], Z[0]), (X[0], Y[1], Z[0])],
        "up": [(X[0], Y[0], Z[1]), (X[1], Y[0], Z[1]), (X[1], Y[1], Z[1]), (X[0], Y[1], Z[1])],
        "north": [(X[0], Y[0], Z[0]), (X[1], Y[0], Z[0]), (X[1], Y[0], Z[1]), (X[0], Y[0], Z[1])],
        "south": [(X[0], Y[1], Z[0]), (X[1], Y[1], Z[0]), (X[1], Y[1], Z[1]), (X[0], Y[1], Z[1])],
        "west": [(X[0], Y[0], Z[0]), (X[0], Y[1], Z[0]), (X[0], Y[1], Z[1]), (X[0], Y[0], Z[1])],
        "east": [(X[1], Y[0], Z[0]), (X[1], Y[1], Z[0]), (X[1], Y[1], Z[1]), (X[1], Y[0], Z[1])],
    }


def polys_for(g, kind, ox, oy=0, scale=1.0, hide=()):
    tex = texture(kind)
    polys, cols = [], []
    S = g.S * scale
    for name in g.order:
        if name in hide:
            continue
        for c in g.bones[name]["cubes"]:
            (x, y, z), (w, h, dd) = c["o"], c["s"]
            for fname, f in cube_faces(x, y, z, w, h, dd).items():
                i = SW.index(c["faces"].get(fname, c["c"]))
                px = tex.getpixel(((i % 16) * 8 + 3, (i // 16) * 8 + 3))
                polys.append([(p[0] * S + ox, p[1] * S + oy, p[2] * S) for p in f])
                cols.append(tuple(min(1, q / 255 * SHADE[fname]) for q in px[:3]) + (1,))
    return polys, cols


def render_preview(path, icon_path=None):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    bg = (0.93, 0.96, 0.9)
    shows = [(s[0], s[1], s[2]()) for s in SPECIES] + [("trex", "T. rex", trex())]
    fig = plt.figure(figsize=(22, 13), dpi=100)
    fig.patch.set_facecolor(bg)
    for k, (key, name, g) in enumerate(shows):
        ax = fig.add_subplot(3, 3, k + 1, projection="3d")
        ax.set_facecolor(bg)
        hide = ("wingf_l", "wingf_r")
        p, c = polys_for(g, key, 0, hide=hide)
        ax.add_collection3d(Poly3DCollection(p, facecolors=c, edgecolors=(0, 0, 0, 0.15), linewidths=0.1))
        pts = [q for poly in p for q in poly]
        lo = [min(q[i] for q in pts) for i in range(3)]
        hi = [max(q[i] for q in pts) for i in range(3)]
        span = max(hi[i] - lo[i] for i in range(3))
        mid = [(lo[i] + hi[i]) / 2 for i in range(3)]
        ax.set_xlim(mid[0] - span / 2, mid[0] + span / 2); ax.set_ylim(mid[1] - span / 2, mid[1] + span / 2); ax.set_zlim(0, span)
        ax.set_box_aspect((1, 1, 1))
        ax.view_init(elev=12, azim=-35)
        ax.axis("off")
        ax.set_title(f"{name}  ({(hi[2]) / 16:.1f} blocks tall, {(hi[1] - lo[1]) / 16:.1f} long)", fontsize=12)
    plt.subplots_adjust(left=0, right=1, top=0.96, bottom=0, wspace=0, hspace=0.05)
    plt.savefig(path, facecolor=bg)
    plt.close(fig)
    if icon_path:                     # pack icon: the T. rex's head
        fig = plt.figure(figsize=(2.56, 2.56), dpi=100)
        fig.patch.set_facecolor((0.98, 0.78, 0.36))
        ax = fig.add_subplot(1, 1, 1, projection="3d")
        ax.set_facecolor((0.98, 0.78, 0.36))
        p, c = polys_for(trex(), "trex", 0)
        ax.add_collection3d(Poly3DCollection(p, facecolors=c, edgecolors=(0, 0, 0, 0.2), linewidths=0.2))
        ax.set_xlim(-40, 40); ax.set_ylim(-100, -20); ax.set_zlim(20, 100)
        ax.set_box_aspect((1, 1, 1))
        ax.view_init(elev=8, azim=-50)
        ax.axis("off")
        plt.subplots_adjust(left=-0.3, right=1.3, top=1.3, bottom=-0.3)
        plt.savefig(icon_path, facecolor=fig.get_facecolor())
        plt.close(fig)


if __name__ == "__main__":
    base = sys.argv[1].rstrip("/")
    write_pack(base)
    if len(sys.argv) > 2:
        icon = os.path.join(base + "_RP", "pack_icon.png")
        render_preview(sys.argv[2], icon)
        Image.open(icon).save(os.path.join(base + "_BP", "pack_icon.png"))
    print("done")
