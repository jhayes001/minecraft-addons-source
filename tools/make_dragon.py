"""The dragon for Chapter 2 of the Princess Kingdom story (Kingdom Quest): model, texture, animations, preview.

An Ender Dragon, but our own model (the game's own dragon only works properly in the End, breaks blocks and can't
be friendly): black scales with a purple sheen, pale purple belly, purple wing skin, horns, claws and bright
magenta eyes. About 11 blocks from nose to tail and 10 across the wings.

Model units are pixels (16 = one block), feet at y = 0, facing north (-Z), like the dog. Bones:
root > body > neck > head > jaw; body > tail1 > tail2 > tail3; body > leg_fl, leg_fr, leg_bl, leg_br;
body > wing_l > wing_l_tip, body > wing_r > wing_r_tip (the right wing is the broken one);
wing_r_tip > bandage_1 ... bandage_3 (hidden until each piece of the mend is done).

Rotations follow Bedrock's convention (the same one Blockbench shows): +x tips the front end down, +z lifts the
+x side (the left wing) up and lowers the -x side. The preview applies exactly the poses written into the
animations, so what it shows is what the game shows.

Poses (the kq:pose property): 0 lying hurt (head low, broken wing dragging), 1 lying happy (head up),
2 flying (wings beating, legs tucked), 3 standing proud. kq:wing (0-4) shows the bandages (one for each thing brought); at 4 the wing is
mended and folds like the other one.

Usage: python3 tools/make_dragon.py <resource_pack_dir> [preview.png]   (make_kingdom_quest.py calls write_pack)
"""
import json, math, os, random, sys
from PIL import Image, ImageDraw

PAL = {
    "scale": (34, 30, 44), "scale_hi": (58, 46, 82), "belly": (96, 78, 120), "skin": (128, 62, 170),
    "skin_dark": (88, 40, 122), "horn": (222, 212, 236), "claw": (236, 230, 242), "eye": (242, 80, 255),
    "pupil": (40, 0, 60), "tooth": (248, 248, 252), "spine": (150, 92, 210), "nostril": (14, 10, 20),
    "bandage": (246, 240, 226), "bandage_hi": (255, 252, 244), "mouth": (150, 40, 70), "bone": (70, 56, 96),
}
SW = list(PAL)
TEX_W, TEX_H = 128, 32

def sw_uv(name):
    i = SW.index(name)
    return [(i % 16) * 8, (i // 16) * 8], [8, 8]

BONES = ["body", "neck", "head", "jaw", "tail1", "tail2", "tail3", "leg_fl", "leg_fr", "leg_bl", "leg_br",
         "wing_l", "wing_l_tip", "wing_r", "wing_r_tip", "bandage_1", "bandage_2", "bandage_3"]
PARENT = {"neck": "body", "head": "neck", "jaw": "head", "tail1": "body", "tail2": "tail1", "tail3": "tail2",
          "leg_fl": "body", "leg_fr": "body", "leg_bl": "body", "leg_br": "body", "wing_l": "body", "wing_r": "body",
          "wing_l_tip": "wing_l", "wing_r_tip": "wing_r", "bandage_1": "wing_r", "bandage_2": "wing_r_tip",
          "bandage_3": "wing_r_tip"}
PIVOTS = {"body": [0, 28, 0], "neck": [0, 33, -22], "head": [0, 37, -56], "jaw": [0, 33, -60],
          "tail1": [0, 30, 22], "tail2": [0, 28, 42], "tail3": [0, 27, 60],
          "leg_fl": [11, 22, -13], "leg_fr": [-11, 22, -13], "leg_bl": [11, 22, 13], "leg_br": [-11, 22, 13],
          "wing_l": [13, 40, -10], "wing_l_tip": [50, 40, -10], "wing_r": [-13, 40, -10], "wing_r_tip": [-50, 40, -10],
          "bandage_1": [-44, 40, -10], "bandage_2": [-52, 40, -10], "bandage_3": [-60, 40, -10]}
cubes = {b: [] for b in BONES}

def box(bone, x, y, z, w, h, d, color, faces=None):
    cubes[bone].append({"o": (x, y, z), "s": (w, h, d), "c": color, "faces": faces or {}})

# body: a long, deep chest, pale belly plates, a row of purple spines down the back
box("body", -13, 16, -22, 26, 24, 44, "scale", {"up": "scale_hi", "down": "belly"})
box("body", -11, 14, -18, 22, 4, 34, "belly")
for i, z in enumerate(range(-18, 20, 8)):
    box("body", -1.5, 40, z, 3, 4 + (i % 2), 4, "spine")
# neck: two thick pieces rising to the head
box("neck", -6, 27, -40, 12, 12, 20, "scale", {"up": "scale_hi", "down": "belly"})
box("neck", -5, 29, -57, 10, 11, 18, "scale", {"up": "scale_hi", "down": "belly"})
for z in (-36, -48):
    box("neck", -1, 39, z, 2, 3, 3, "spine")
# head: skull, long snout with nostrils, brow ridges, bright eyes, horns sweeping back
box("head", -8, 30, -74, 16, 14, 18, "scale", {"up": "scale_hi", "down": "belly"})
box("head", -6, 31, -90, 12, 8, 16, "scale", {"up": "scale_hi", "down": "belly"})
box("head", -5, 39, -86, 2, 1.5, 3, "nostril"); box("head", 3, 39, -86, 2, 1.5, 3, "nostril")
box("head", -9, 40, -74, 18, 2.5, 6, "scale_hi")                                       # brow
box("head", -8.6, 36, -72, 0.8, 3, 4, "eye"); box("head", 7.8, 36, -72, 0.8, 3, 4, "eye")
box("head", -8.9, 36.6, -70.8, 0.4, 1.8, 1.6, "pupil"); box("head", 8.5, 36.6, -70.8, 0.4, 1.8, 1.6, "pupil")
for sx in (-7, 4):
    box("head", sx, 43, -62, 3, 3, 7, "horn")
    box("head", sx + 0.4, 45, -56, 2.2, 2.4, 6, "horn")
    box("head", sx + 0.8, 46.5, -51, 1.4, 1.8, 4, "horn")
# jaw (opens a little when it talks or roars), with teeth along the top edge
box("jaw", -5.5, 27, -88, 11, 4, 28, "scale", {"down": "belly", "up": "mouth"})
for x in (-5, 4):
    for z in (-87, -82, -77):
        box("jaw", x, 31, z, 1, 1.6, 1.2, "tooth")
# tail: three pieces getting thinner, a spade at the tip
box("tail1", -8, 22, 22, 16, 12, 22, "scale", {"up": "scale_hi", "down": "belly"})
box("tail2", -6, 22, 42, 12, 10, 20, "scale", {"up": "scale_hi", "down": "belly"})
box("tail3", -4, 23, 60, 8, 7, 18, "scale", {"up": "scale_hi", "down": "belly"})
box("tail3", -6, 24, 76, 12, 4, 8, "spine")
for bone, z in (("tail1", 30), ("tail2", 50), ("tail3", 66)):
    box(bone, -1, (34 if bone == "tail1" else 32 if bone == "tail2" else 30), z, 2, 3, 3, "spine")
# legs: thick, with three white claws each
for bone in ("leg_fl", "leg_fr", "leg_bl", "leg_br"):
    px, _, pz = PIVOTS[bone]
    box(bone, px - 4, 4, pz - 4, 8, 20, 8, "scale", {"up": "scale_hi"})
    box(bone, px - 5, 0, pz - 6, 10, 4, 10, "scale")
    for cx in (-4.5, -0.75, 3):
        box(bone, px + cx, 0, pz - 8, 1.5, 2, 2.5, "claw")
# wings: an arm bone along the front edge and purple skin behind it, in two parts (so the broken one can bend)
for side, s in (("l", 1), ("r", -1)):
    w, t = "wing_" + side, "wing_" + side + "_tip"
    def X(a, b):
        return (a, b - a) if s > 0 else (-b, b - a)
    x0, wd = X(13, 50); box(w, x0, 38, -12, wd, 4, 4, "bone")
    x0, wd = X(13, 50); box(w, x0, 39.25, -8, wd, 1.5, 30, "skin", {"down": "skin_dark"})
    x0, wd = X(50, 84); box(t, x0, 38.5, -11.5, wd, 3, 3, "bone")
    x0, wd = X(50, 70); box(t, x0, 39.25, -8.5, wd, 1.5, 26, "skin", {"down": "skin_dark"})
    x0, wd = X(70, 84); box(t, x0, 39.25, -8.5, wd, 1.5, 14, "skin", {"down": "skin_dark"})
    x0, wd = X(82, 87); box(t, x0, 38.5, -12, wd, 3, 3, "claw")
# bandages round the broken wing: one where the arm bends, one along it, one on the skin
box("bandage_1", -48, 37, -13, 6, 6, 6, "bandage", {"up": "bandage_hi"})
box("bandage_2", -56, 37.5, -12.5, 7, 5, 5, "bandage", {"up": "bandage_hi"})
box("bandage_3", -66, 38.75, -9, 8, 2.5, 18, "bandage", {"up": "bandage_hi"})

FACES = ("north", "south", "east", "west", "up", "down")

def geometry():
    out = [{"name": "root", "pivot": [0, 0, 0]}]
    for name in BONES:
        cs = []
        for c in cubes[name]:
            uv = {}
            for f in FACES:
                pos, size = sw_uv(c["faces"].get(f, c["c"]))
                uv[f] = {"uv": pos, "uv_size": size}
            cs.append({"origin": list(c["o"]), "size": list(c["s"]), "uv": uv})
        out.append({"name": name, "parent": PARENT.get(name, "root"), "pivot": PIVOTS[name], "cubes": cs})
    return {"format_version": "1.12.0", "minecraft:geometry": [{"description": {
        "identifier": "geometry.kq_dragon", "texture_width": TEX_W, "texture_height": TEX_H,
        "visible_bounds_width": 14, "visible_bounds_height": 8, "visible_bounds_offset": [0, 2, 0]}, "bones": out}]}

def texture():
    tex = Image.new("RGBA", (TEX_W, TEX_H), (0, 0, 0, 0))
    rnd = random.Random(7)
    for name, base in PAL.items():
        (u, v), _ = sw_uv(name)
        for x in range(8):
            for y in range(8):
                k = 1.0
                if name in ("scale", "scale_hi", "belly"):
                    # rows of overlapping scales: a lighter edge on each
                    edge = (y % 4 == 0) or ((x + (y // 4) * 2) % 4 == 0 and y % 4 == 1)
                    k = 1.35 if edge else 0.92 if rnd.random() < 0.25 else 1.0
                elif name in ("skin", "skin_dark"):
                    k = 1.15 if x in (2, 6) else 0.95 if rnd.random() < 0.3 else 1.0     # veins in the wing skin
                elif name in ("bandage", "bandage_hi"):
                    k = 0.9 if (x + y) % 4 == 0 else 1.0
                elif rnd.random() < 0.15:
                    k = 0.9
                tex.putpixel((u + x, v + y), tuple(min(255, int(c * k)) for c in base) + (255,))
    return tex

# ---------------------------------------------------------------- poses and animations
# each pose: bone -> (rotation [x, y, z] in degrees, position offset [x, y, z] in pixels). Strings are Molang
# (they move in the game); the preview uses the number in front.
LIE = {"root": ([0, 0, 0], [0, -13, 0]),
       "leg_fl": ([-80, 0, 0], [0, 3, -4]), "leg_fr": ([-80, 0, 0], [0, 3, -4]),
       "leg_bl": ([70, 0, 0], [0, 6, 4]), "leg_br": ([70, 0, 0], [0, 6, 4]),
       "tail1": ([-22, "-12 + math.sin(query.life_time * 40) * 4", 0], [0, 0, 0]),
       "tail2": ([12, "-16 + math.sin(query.life_time * 40 - 30) * 5", 0], [0, 0, 0]),
       "tail3": ([8, "-18 + math.sin(query.life_time * 40 - 60) * 6", 0], [0, 0, 0]),
       "wing_l": ([0, 70, 20], [0, 0, 0]), "wing_l_tip": ([0, 60, 0], [0, 0, 0])}           # healthy wing folded along its side
BROKEN = {"wing_r": ([4, 10, 36], [0, 0, 0]), "wing_r_tip": ([10, -30, -45], [0, 0, 0])}     # dragging, bent wrong at the joint
MENDED = {"wing_r": ([0, -70, -20], [0, 0, 0]), "wing_r_tip": ([0, -60, 0], [0, 0, 0])}     # folded like the other one
HURT = {"neck": (["12 + math.sin(query.life_time * 50) * 2", "math.sin(query.life_time * 25) * 6", 0], [0, 0, 0]),
        "head": (["8 + math.sin(query.life_time * 50) * 3", 0, "math.sin(query.life_time * 30) * 3"], [0, 0, 0]),
        "body": ([0, 0, 0], [0, "math.sin(query.life_time * 70) * 0.5", 0])}
HAPPY = {"neck": (["-12 + math.sin(query.life_time * 90) * 3", "math.sin(query.life_time * 40) * 14", 0], [0, 0, 0]),
         "head": (["14 + math.sin(query.life_time * 90) * 3", 0, "math.sin(query.life_time * 45) * 5"], [0, 0, 0]),
         "body": ([0, 0, 0], [0, "math.sin(query.life_time * 90) * 0.6", 0]),
         "tail3": ([4, "-18 + math.sin(query.life_time * 160) * 22", 0], [0, 0, 0])}
FLY = {"leg_fl": ([-50, 0, 0], [0, 2, 0]), "leg_fr": ([-50, 0, 0], [0, 2, 0]),
       "leg_bl": ([60, 0, 0], [0, 2, 2]), "leg_br": ([60, 0, 0], [0, 2, 2]),
       "neck": (["-6 + math.sin(query.life_time * 360) * 3", 0, 0], [0, 0, 0]), "head": ([8, 0, 0], [0, 0, 0]),
       "tail1": (["-4 + math.sin(query.life_time * 360 - 60) * 4", 0, 0], [0, 0, 0]),
       "tail2": (["-2 + math.sin(query.life_time * 360 - 100) * 5", 0, 0], [0, 0, 0]),
       "tail3": (["math.sin(query.life_time * 360 - 140) * 6", 0, 0], [0, 0, 0]),
       "body": ([-4, 0, 0], [0, "-math.sin(query.life_time * 360) * 2", 0]),
       "wing_l": ([0, 0, "math.sin(query.life_time * 360) * 38"], [0, 0, 0]),
       "wing_l_tip": ([0, 0, "math.sin(query.life_time * 360 - 50) * 24"], [0, 0, 0]),
       "wing_r": ([0, 0, "-math.sin(query.life_time * 360) * 38"], [0, 0, 0]),
       "wing_r_tip": ([0, 0, "-math.sin(query.life_time * 360 - 50) * 24"], [0, 0, 0])}
# flying hurt (the crash): the broken wing hardly beats, the body rolls toward it
FLY_HURT = dict(FLY, **{"wing_r": ([10, 0, "-10 - math.sin(query.life_time * 360) * 8"], [0, 0, 0]),
                        "wing_r_tip": ([0, -20, 35], [0, 0, 0]),
                        "body": (["-4", 0, "-14 + math.sin(query.life_time * 200) * 10"], [0, "-math.sin(query.life_time * 360) * 2", 0])})
STAND = {"neck": (["-18 + math.sin(query.life_time * 60) * 2", "math.sin(query.life_time * 30) * 10", 0], [0, 0, 0]),
         "head": ([16, 0, 0], [0, 0, 0]),
         "tail1": ([8, "math.sin(query.life_time * 40) * 6", 0], [0, 0, 0]),
         "tail2": ([6, "math.sin(query.life_time * 40 - 30) * 8", 0], [0, 0, 0]),
         "wing_l": ([0, 70, 20], [0, 0, 0]), "wing_l_tip": ([0, 60, 0], [0, 0, 0]),
         "wing_r": ([0, -70, -20], [0, 0, 0]), "wing_r_tip": ([0, -60, 0], [0, 0, 0])}
ROAR = {"jaw": (["18 * math.max(0, math.sin(query.life_time * 240))", 0, 0], [0, 0, 0])}

def anim_json(pose):
    bones = {}
    for b, (rot, pos) in pose.items():
        e = {}
        if any(r != 0 for r in rot):
            e["rotation"] = rot
        if any(p != 0 for p in pos):
            e["position"] = pos
        bones[b] = e
    return {"loop": True, "bones": bones}

ANIMS = {"lie": LIE, "broken": BROKEN, "mended": MENDED, "hurt": HURT, "happy": HAPPY, "fly": FLY,
         "fly_hurt": FLY_HURT, "stand": STAND, "roar": ROAR}

def animations():
    return {"format_version": "1.8.0", "animations": {"animation.kq_dragon." + k: anim_json(v) for k, v in ANIMS.items()}}

def client_entity():
    q = "query.property"
    anims = {k: "animation.kq_dragon." + k for k in ANIMS}
    animate = [{"lie": f"{q}('kq:pose') <= 1"}, {"hurt": f"{q}('kq:pose') == 0"}, {"happy": f"{q}('kq:pose') == 1"},
               {"broken": f"{q}('kq:pose') <= 1 && {q}('kq:wing') < 4"},
               {"mended": f"{q}('kq:pose') <= 1 && {q}('kq:wing') >= 4"},
               {"fly": f"{q}('kq:pose') == 2 && {q}('kq:wing') >= 4"},
               {"fly_hurt": f"{q}('kq:pose') == 2 && {q}('kq:wing') < 4"},
               {"stand": f"{q}('kq:pose') == 3"}, {"roar": f"{q}('kq:roar')"}]
    return {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": "kq:dragon", "materials": {"default": "entity_alphatest"},
        "textures": {"default": "textures/entity/kq_dragon"}, "geometry": {"default": "geometry.kq_dragon"},
        "animations": anims, "scripts": {"animate": animate}, "render_controllers": ["controller.render.kq_dragon"]}}}

def render_controller():
    return {"format_version": "1.8.0", "render_controllers": {"controller.render.kq_dragon": {
        "geometry": "Geometry.default", "materials": [{"*": "Material.default"}], "textures": ["Texture.default"],
        "part_visibility": [{"bandage_*": False},
                            {"bandage_1": "query.property('kq:wing') >= 1 && query.property('kq:wing') < 4"},
                            {"bandage_2": "query.property('kq:wing') >= 2 && query.property('kq:wing') < 4"},
                            {"bandage_3": "query.property('kq:wing') >= 3 && query.property('kq:wing') < 4"}]}}}

def write_pack(rp):
    def save(rel, obj):
        p = os.path.join(rp, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            json.dump(obj, f, indent=2)
            f.write("\n")
    save("models/entity/kq_dragon.geo.json", geometry())
    save("animations/kq_dragon.animation.json", animations())
    save("entity/dragon.entity.json", client_entity())
    save("render_controllers/kq_dragon.render_controllers.json", render_controller())
    os.makedirs(os.path.join(rp, "textures", "entity"), exist_ok=True)
    texture().save(os.path.join(rp, "textures", "entity", "kq_dragon.png"))

# ---------------------------------------------------------------- preview
def _num(v):
    if isinstance(v, (int, float)):
        return float(v)
    s = v.strip()
    n = ""
    for ch in s:
        if ch in "-+.0123456789" and not (ch in "+-" and n and n[-1] not in "e"):
            n += ch
        elif n:
            break
    try:
        return float(n)
    except ValueError:
        return 0.0

def _rot(p, ang):
    """Bedrock bone rotation: three.js with x and y negated, order ZYX (x applied first)."""
    rx, ry, rz = (math.radians(-_num(ang[0])), math.radians(-_num(ang[1])), math.radians(_num(ang[2])))
    x, y, z = p
    y, z = y * math.cos(rx) - z * math.sin(rx), y * math.sin(rx) + z * math.cos(rx)
    x, z = x * math.cos(ry) + z * math.sin(ry), -x * math.sin(ry) + z * math.cos(ry)
    x, y = x * math.cos(rz) - y * math.sin(rz), x * math.sin(rz) + y * math.cos(rz)
    return (x, y, z)

def posed_point(p, bone, pose):
    b = bone
    while b:
        piv = PIVOTS.get(b, [0, 0, 0])
        rot, pos = pose.get(b, ([0, 0, 0], [0, 0, 0]))
        q = (p[0] - piv[0], p[1] - piv[1], p[2] - piv[2])
        q = _rot(q, rot)
        p = (q[0] + piv[0] + _num(pos[0]), q[1] + piv[1] + _num(pos[1]), q[2] + piv[2] + _num(pos[2]))
        b = PARENT.get(b, "root" if b != "root" else None)
    return p

SHADE = {"up": 1.0, "north": 0.82, "south": 0.7, "west": 0.62, "east": 0.88, "down": 0.5}

def cube_faces(x, y, z, w, h, d):
    X, Y, Z = [x, x + w], [y, y + h], [z, z + d]
    return {"down": [(X[0], Y[0], Z[0]), (X[1], Y[0], Z[0]), (X[1], Y[0], Z[1]), (X[0], Y[0], Z[1])],
            "up": [(X[0], Y[1], Z[0]), (X[1], Y[1], Z[0]), (X[1], Y[1], Z[1]), (X[0], Y[1], Z[1])],
            "north": [(X[0], Y[0], Z[0]), (X[1], Y[0], Z[0]), (X[1], Y[1], Z[0]), (X[0], Y[1], Z[0])],
            "south": [(X[0], Y[0], Z[1]), (X[1], Y[0], Z[1]), (X[1], Y[1], Z[1]), (X[0], Y[1], Z[1])],
            "west": [(X[0], Y[0], Z[0]), (X[0], Y[0], Z[1]), (X[0], Y[1], Z[1]), (X[0], Y[1], Z[0])],
            "east": [(X[1], Y[0], Z[0]), (X[1], Y[0], Z[1]), (X[1], Y[1], Z[1]), (X[1], Y[1], Z[0])]}

def polys(pose, wing, ox=0.0):
    out, cols = [], []
    for bone in BONES:
        if bone.startswith("bandage"):
            k = int(bone[-1])
            if not (wing >= k and wing < 4):
                continue
        for c in cubes[bone]:
            for fname, f in cube_faces(*c["o"], *c["s"]).items():
                col = PAL[c["faces"].get(fname, c["c"])]
                pts = [posed_point(p, bone, pose) for p in f]
                out.append([(p[0] + ox, p[2], p[1]) for p in pts])       # plot: x, z (depth), y (up)
                k = SHADE[fname]
                cols.append(tuple(min(1, v / 255 * k + 0.06) for v in col) + (1,))
    return out, cols

def merged(*ps):
    out = {}
    for p in ps:
        out.update(p)
    return out

PREVIEW_POSES = [("Hurt, lying in the crater", merged(LIE, HURT, BROKEN), 0),
                 ("Three bandages on", merged(LIE, HAPPY, BROKEN), 3),
                 ("Mended", merged(LIE, HAPPY, MENDED), 4),
                 ("Flying", FLY, 4),
                 ("Crashing", FLY_HURT, 0)]

def render_preview(path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    bg = (0.93, 0.95, 0.98)
    fig = plt.figure(figsize=(22, 14), dpi=90)
    fig.patch.set_facecolor(bg)
    for i, (label, pose, wing) in enumerate(PREVIEW_POSES + [("From the front, hurt", merged(LIE, HURT, BROKEN), 0)]):
        ax = fig.add_subplot(2, 3, i + 1, projection="3d")
        ax.set_facecolor(bg)
        p, c = polys(pose, wing)
        ax.add_collection3d(Poly3DCollection(p, facecolors=c, edgecolors=(0, 0, 0, 0.25), linewidths=0.15))
        for g in range(-96, 97, 16):
            ax.plot([g, g], [-96, 96], [0, 0], color=(0.7, 0.75, 0.7), lw=0.3)
            ax.plot([-96, 96], [g, g], [0, 0], color=(0.7, 0.75, 0.7), lw=0.3)
        ax.set_xlim(-96, 96); ax.set_ylim(-96, 96); ax.set_zlim(-10, 90)
        ax.set_box_aspect((192, 192, 100))
        ax.view_init(elev=22, azim=-60 if i < 5 else -90)
        ax.set_title(label, fontsize=13)
        ax.axis("off")
    plt.subplots_adjust(left=0, right=1, top=0.96, bottom=0, wspace=0, hspace=0.05)
    plt.savefig(path, facecolor=bg)
    plt.close(fig)

if __name__ == "__main__":
    write_pack(sys.argv[1])
    if len(sys.argv) > 2:
        render_preview(sys.argv[2])
