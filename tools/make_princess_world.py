"""Builds "Princess Kingdom", a ready-to-play Bedrock world (.mcworld).

A magical pastel land with a giant princess castle in the middle:

  - The castle: a white-and-pink palace (the keep) with four corner towers and one great
    tower in the middle, inside a walled courtyard with eight more towers, all with pink and
    purple pointy roofs, gold tips and flags. A moat goes all the way round, with a bridge to
    the gate.
  - Inside the palace: a grand hall with a red-carpet... well, pink-carpet runner, pillars,
    chandeliers and three gold thrones; upstairs the princess bedroom (pink beds and a dress-up
    chest), a library, a dining room with cakes, a rainbow ballroom, and a blossom garden
    gallery. A grand spiral staircase in the middle climbs all the way to the treasure room at
    the top of the great tower, which has a balcony all the way round.
  - The courtyard: a fountain, flower gardens, a unicorn stable, a little hedge maze with a
    treasure chest in the middle, and a lily pond out the back. Stairs go up onto the walls,
    and you can walk all the way round the top into the wall towers.
  - The land: flower meadows and cherry-blossom trees, a river with a rainbow bridge, a giant
    walkable rainbow behind the castle with a pot of gold at each end, fluffy clouds, a glowing
    crystal grove and a fairy pond. Lantern posts light the road at night.

Play notes (set in level.dat): Survival, Peaceful (no monsters), fall damage OFF, keep
inventory ON, coordinates shown. She spawns at the south end of the road next to a chest with
a princess outfit, and walks north over the rainbow bridge to the castle. Outside the built
area (256 x 256 blocks) the world carries on as flat grass.

The low-level world writing (NBT, sub-chunk encoding) is shared with make_floating_world.py.
Needs: numpy, plyvel (pip install plyvel; needs libleveldb), Pillow for previews.

Usage: python3 tools/make_princess_world.py [--seed N] [--out dist]
Outputs: dist/PrincessKingdom.mcworld, dist/princess_preview.png, dist/princess_preview_castle.png,
         dist/princess_preview_night.png
"""
import argparse, json, math, os, random, shutil, struct, tempfile, time, zipfile
import numpy as np

import make_floating_world as fw   # NBT writer, sub-chunk encoder, noise
from make_floating_world import B, S, I, L, F, STR, LST, C, nbt, encode_storage, fbm2, fbm3, noise3

WORLD_NAME = "Princess Kingdom"
GAME_VERSION = fw.GAME_VERSION
BLOCK_VERSION = fw.BLOCK_VERSION
CHUNK_VERSION = fw.CHUNK_VERSION
PLAINS_BIOME = 1

HALF = 128                      # built area is x,z in [-HALF, HALF)
SIZE = HALF * 2
MIN_Y, MAX_Y = -64, 64          # sub-chunks -4 .. 3
H = MAX_Y - MIN_Y
GROUND = -61                    # grass height (matches the flat world outside)

# ---------------------------------------------------------------- blocks
PALETTE = [("minecraft:air", {})]
_INDEX = {}

def blk(name, **states):
    key = (name, tuple(sorted(states.items())))
    if key not in _INDEX:
        _INDEX[key] = len(PALETTE)
        PALETTE.append(("minecraft:" + name, states))
    return _INDEX[key]

AIR = 0
BEDROCK = blk("bedrock", infiniburn_bit=False)
STONE, DIRT, GRASS = blk("stone"), blk("dirt"), blk("grass_block")
GRASS_PATH = blk("grass_path")
WATER = blk("water", liquid_depth=0)
QUARTZ = blk("quartz_block", pillar_axis="y")
SMOOTH_QUARTZ = blk("smooth_quartz", pillar_axis="y")
CHISELED_QUARTZ = blk("chiseled_quartz_block", pillar_axis="y")
QUARTZ_PILLAR = blk("quartz_pillar", pillar_axis="y")
CALCITE = blk("calcite")
GOLD = blk("gold_block")
WHITE_C, PINK_C, MAGENTA_C, PURPLE_C = blk("white_concrete"), blk("pink_concrete"), blk("magenta_concrete"), blk("purple_concrete")
LBLUE_C = blk("light_blue_concrete")
RAINBOW = [blk("red_concrete"), blk("orange_concrete"), blk("yellow_concrete"), blk("lime_concrete"),
           LBLUE_C, blk("blue_concrete"), PURPLE_C]
PINK_TERRACOTTA = blk("pink_terracotta")
PINK_GLASS, MAGENTA_GLASS, LBLUE_GLASS, PURPLE_GLASS = (blk("pink_stained_glass"), blk("magenta_stained_glass"),
                                                        blk("light_blue_stained_glass"), blk("purple_stained_glass"))
WHITE_WOOL, PINK_WOOL, PURPLE_WOOL, MAGENTA_WOOL = blk("white_wool"), blk("pink_wool"), blk("purple_wool"), blk("magenta_wool")
PINK_CARPET, MAGENTA_CARPET, LBLUE_CARPET = blk("pink_carpet"), blk("magenta_carpet"), blk("light_blue_carpet")
CHERRY_LOG = blk("cherry_log", pillar_axis="y")
CHERRY_LEAVES = blk("cherry_leaves", persistent_bit=True, update_bit=False)
CHERRY_PLANKS = blk("cherry_planks")
CHERRY_FENCE = blk("cherry_fence")
AZALEA_LEAVES = blk("azalea_leaves_flowered", persistent_bit=True, update_bit=False)
PETALS = [blk("pink_petals", growth=g, **{"minecraft:cardinal_direction": d})
          for g in (1, 3) for d in ("south", "west", "north", "east")]
FLOWERS = [blk(n) for n in ("pink_tulip", "white_tulip", "allium", "azure_bluet", "oxeye_daisy", "cornflower",
                            "lily_of_the_valley")]
PINK_TULIP, LILY_VALLEY = FLOWERS[0], FLOWERS[6]
DOUBLE_FLOWERS = [(blk(n, upper_block_bit=False), blk(n, upper_block_bit=True)) for n in ("peony", "lilac", "rose_bush")]
SHORT_GRASS = blk("short_grass")
LANTERN = blk("lantern", hanging=False)
HANGING_LANTERN = blk("lantern", hanging=True)
CHAIN = blk("chain", pillar_axis="y")
END_ROD_UP = blk("end_rod", facing_direction=1)
SEA_LANTERN, GLOWSTONE = blk("sea_lantern"), blk("glowstone")
PEARL_FROG = blk("pearlescent_froglight", pillar_axis="y")
AMETHYST = blk("amethyst_block")
AMETHYST_CLUSTER = blk("amethyst_cluster", **{"minecraft:block_face": "up"})
BOOKSHELF = blk("bookshelf")
CAKE = blk("cake", bite_counter=0)
PINK_CANDLE = blk("pink_candle", candles=2, lit=True)
HAY = blk("hay_block", deprecated=0, pillar_axis="y")
LILY_PAD = blk("waterlily")
CHESTS = {d: blk("chest", **{"minecraft:cardinal_direction": d}) for d in ("south", "west", "north", "east")}
# weirdo_direction: the way you walk to go up the stairs. 0 east(+x) 1 west(-x) 2 south(+z) 3 north(-z)
QSTAIRS = [blk("quartz_stairs", upside_down_bit=False, weirdo_direction=d) for d in range(4)]
CHERRY_STAIRS = [blk("cherry_stairs", upside_down_bit=False, weirdo_direction=d) for d in range(4)]
# bed direction: the way the head points from the foot. 0 south(+z) 1 west 2 north(-z) 3 east
BEDS = {(d, head): blk("bed", direction=d, head_piece_bit=head, occupied_bit=False) for d in range(4) for head in (False, True)}

STAIR_IDS = set(QSTAIRS) | set(CHERRY_STAIRS)
# Blocks you can walk through (used by the tests and when planting)
PASSABLE = {AIR, WATER, SHORT_GRASS, LILY_PAD, *FLOWERS, *[a for p in DOUBLE_FLOWERS for a in p], *PETALS,
            PINK_CARPET, MAGENTA_CARPET, LBLUE_CARPET}

# ---------------------------------------------------------------- world builder
class World:
    def __init__(self, seed):
        self.seed = seed
        self.rng = random.Random(seed)
        self.b = np.zeros((SIZE, H, SIZE), dtype=np.uint8)   # [x, y, z]
        self.block_entities = []          # (x, y, z, nbt bytes)
        self.chests = {}                  # name -> (x, y, z)
        self.places = {}                  # name -> (x, y, z) spots the test walks to
        self.no_plant = np.zeros((SIZE, SIZE), bool)

    def inside(self, x, y, z):
        return -HALF <= x < HALF and MIN_Y <= y < MAX_Y and -HALF <= z < HALF

    def get(self, x, y, z):
        return self.b[x + HALF, y - MIN_Y, z + HALF] if self.inside(x, y, z) else AIR

    def set(self, x, y, z, v, only_air=False):
        if self.inside(x, y, z):
            i, j, k = x + HALF, y - MIN_Y, z + HALF
            if only_air and self.b[i, j, k] != AIR:
                return False
            self.b[i, j, k] = v
            return True
        return False

    def fill(self, x0, x1, y0, y1, z0, z1, v):
        """Inclusive box."""
        x0, x1 = max(x0, -HALF), min(x1, HALF - 1)
        z0, z1 = max(z0, -HALF), min(z1, HALF - 1)
        y0, y1 = max(y0, MIN_Y), min(y1, MAX_Y - 1)
        if x0 <= x1 and y0 <= y1 and z0 <= z1:
            self.b[x0 + HALF:x1 + HALF + 1, y0 - MIN_Y:y1 - MIN_Y + 1, z0 + HALF:z1 + HALF + 1] = v

    def protect(self, x0, x1, z0, z1):
        self.no_plant[max(0, x0 + HALF):min(SIZE, x1 + HALF + 1), max(0, z0 + HALF):min(SIZE, z1 + HALF + 1)] = True

    def surface(self, x, z):
        """Highest non-air y in the column."""
        if not (-HALF <= x < HALF and -HALF <= z < HALF):
            return None
        col = self.b[x + HALF, :, z + HALF]
        nz = np.nonzero(col)[0]
        return int(nz[-1]) + MIN_Y if len(nz) else None

    def chest(self, name, x, y, z, items, facing="south"):
        self.set(x, y, z, CHESTS[facing])
        self.block_entities.append((x, y, z, chest_nbt(x, y, z, items)))
        self.chests[name] = (x, y, z)

    def bed(self, x, y, z, direction, color=6):
        dx, dz = [(0, 1), (-1, 0), (0, -1), (1, 0)][direction]
        for (px, pz, head) in ((x, z, False), (x + dx, z + dz, True)):
            self.set(px, y, pz, BEDS[(direction, head)])
            self.block_entities.append((px, y, pz, nbt({"id": STR("Bed"), "color": B(color), "isMovable": B(1),
                                                        "x": I(px), "y": I(y), "z": I(pz)})))

# ---------------------------------------------------------------- items
def item(slot, name, count=1, tag=None, damage=0):
    d = {"Count": B(count), "Damage": S(damage), "Name": STR("minecraft:" + name), "Slot": B(slot), "WasPickedUp": B(0)}
    if tag:
        d["tag"] = C(tag)
    return d

def named(n):
    return {"display": C({"Name": STR(n)})}

def dyed(rgb, name=None):
    t = {"customColor": I(struct.unpack("<i", struct.pack("<I", 0xFF000000 | rgb))[0])}
    if name:
        t.update(named(name))
    return t

PINK, PURPLE, SKY, SUNNY = 0xF7A6C9, 0xB07FE0, 0x8FD3F5, 0xFFE27A

def chest_nbt(x, y, z, items):
    its = [C(dict(it, Slot=B(i))) for i, it in enumerate(items)]
    return nbt({"Findable": B(0), "Items": LST(10, its), "id": STR("Chest"), "isMovable": B(1),
                "x": I(x), "y": I(y), "z": I(z)})

def outfit(rgb, title):
    return [item(0, "leather_chestplate", 1, dyed(rgb, title + " Dress")),
            item(0, "leather_leggings", 1, dyed(rgb, title + " Skirt")),
            item(0, "leather_boots", 1, dyed(rgb, title + " Slippers"))]

SPAWN_ITEMS = ([item(0, "golden_helmet", 1, named("Princess Crown"))] + outfit(PINK, "Princess") +
               [item(0, "cake", 1), item(0, "cookie", 16), item(0, "pink_tulip", 8), item(0, "golden_carrot", 8)])
WARDROBE_ITEMS = (outfit(PURPLE, "Lilac") + outfit(SKY, "Sky Blue") + outfit(SUNNY, "Sunshine") +
                  [item(0, "golden_helmet", 1, named("Spare Crown")), item(0, "pink_dye", 16), item(0, "purple_dye", 16)])
TREASURE_ITEMS = [item(0, "diamond", 16), item(0, "emerald", 16), item(0, "gold_ingot", 32), item(0, "amethyst_shard", 16),
                  item(0, "golden_apple", 4), item(0, "enchanted_golden_apple", 1),
                  item(0, "golden_helmet", 1, named("Queen's Crown"))]
FLYING_ITEMS = [item(0, "elytra", 1, named("Fairy Wings")), item(0, "firework_rocket", 64,
                {"Fireworks": C({"Explosions": LST(10, []), "Flight": B(1)})}), item(0, "spyglass", 1),
                item(0, "cookie", 16), item(0, "pink_tulip", 4)]
STABLE_ITEMS = [item(0, "horse_spawn_egg", 2), item(0, "saddle", 2), item(0, "golden_horse_armor", 2),
                item(0, "lead", 2), item(0, "golden_carrot", 16), item(0, "apple", 16), item(0, "name_tag", 2)]
MAZE_ITEMS = [item(0, "cake", 1), item(0, "cat_spawn_egg", 1), item(0, "glow_berries", 16),
              item(0, "lily_of_the_valley", 8), item(0, "music_disc_cat", 1), item(0, "jukebox", 1)]
GOLD_POT_ITEMS = [item(0, "gold_ingot", 32), item(0, "gold_nugget", 64), item(0, "golden_apple", 2), item(0, "clock", 1)]

# ---------------------------------------------------------------- shapes
def disk_mask(cx, cz, r, x0, x1, z0, z1):
    xs, zs = np.arange(x0, x1 + 1), np.arange(z0, z1 + 1)
    X, Z = np.meshgrid(xs, zs, indexing="ij")
    return np.hypot(X - cx, Z - cz), X, Z

def column_set(w, X, Z, mask, y0, y1, v):
    for x, z in zip(X[mask], Z[mask]):
        w.fill(int(x), int(x), y0, y1, int(z), int(z), v)

def cone(w, cx, cz, r0, y0, h, colors, flag=PINK_WOOL):
    """Hollow pointy roof, striped, with a gold tip, a rod and a little flag."""
    R = int(math.ceil(r0)) + 1
    d, X, Z = disk_mask(cx, cz, 0, int(cx - R), int(cx + R), int(cz - R), int(cz + R))
    for t in range(h):
        rr = r0 * (1 - t / h)
        ring = (d <= rr + 0.35) & (d > rr - 1.4)
        if rr < 1.4:
            ring = d <= rr + 0.35
        col = colors[(t // 3) % len(colors)]
        for x, z in zip(X[ring], Z[ring]):
            w.set(int(x), y0 + t, int(z), col)
    tx, tz = int(round(cx)), int(round(cz))
    w.set(tx, y0 + h, tz, GOLD)
    for k in range(1, 4):
        w.set(tx, y0 + h + k, tz, CHAIN)
    w.set(tx, y0 + h + 4, tz, END_ROD_UP)
    for a in range(1, 4):
        for k in (2, 3):
            w.set(tx + a, y0 + h + k, tz, flag)

def tower(w, cx, cz, r, y0, top, cone_h, roof, room=None, band=PINK_C, glass=PINK_GLASS, flag=PINK_WOOL):
    """Round tower: solid body to `top`, banded and windowed, with a cone roof.
    room = (floor_y, [door angles in degrees]) carves a room from floor_y+1 up into the roof."""
    R = r + 2
    d, X, Z = disk_mask(cx, cz, 0, int(cx - R), int(cx + R), int(cz - R), int(cz + R))
    body = d <= r + 0.35
    shell = body & (d > r - 1.0)
    column_set(w, X, Z, body, y0, top, QUARTZ)
    for y in range(y0 + 5, top + 1, 8):
        column_set(w, X, Z, shell, y, y, band)
    if room:
        fy, doors = room
        inner = d <= r - 1.0
        column_set(w, X, Z, inner, fy + 1, top, AIR)
        column_set(w, X, Z, inner, fy, fy, SMOOTH_QUARTZ)
        for ang in doors:
            carve_door(w, cx, cz, r, fy + 1, ang)
        # lanterns in the room
        for ang in (45, 225):
            a = math.radians(ang)
            w.set(int(round(cx + math.cos(a) * (r - 2))), fy + 1, int(round(cz + math.sin(a) * (r - 2))), LANTERN)
    # windows: little glass slits
    for y in range(y0 + 8, top - 1, 7):
        for ang in (0, 90, 180, 270):
            a = math.radians(ang + 45)
            wx, wz = int(round(cx + math.cos(a) * r)), int(round(cz + math.sin(a) * r))
            for k in (0, 1):
                if w.get(wx, y + k, wz) == QUARTZ:
                    w.set(wx, y + k, wz, glass)
    cone(w, cx, cz, r + 1.2, top + 1, cone_h, roof, flag)

def carve_door(w, cx, cz, r, y, ang, width=1.2, height=3, depth=2.2):
    a = math.radians(ang)
    ca, sa = math.cos(a), math.sin(a)
    R = r + 2
    for x in range(int(cx - R), int(cx + R) + 1):
        for z in range(int(cz - R), int(cz + R) + 1):
            px, pz = x - cx, z - cz
            proj, perp = px * ca + pz * sa, -px * sa + pz * ca
            if r - depth <= proj <= r + 0.6 and abs(perp) <= width:
                for k in range(height):
                    w.set(x, y + k, z, AIR)

# ---------------------------------------------------------------- land
def build_ground(w):
    xs = np.arange(-HALF, HALF)
    X, Z = np.meshgrid(xs, xs, indexing="ij")
    edge = np.minimum(HALF - np.abs(X + 0.5), HALF - np.abs(Z + 0.5))
    fade = np.clip((edge - 6) / 24.0, 0, 1)
    castle = np.clip((np.maximum(np.abs(X), np.abs(Z)) - 54) / 16.0, 0, 1)
    road = np.where(Z < 40, 1.0, np.clip((np.abs(X) - 5) / 8.0, 0, 1))
    zr = river_z(X)
    river = np.where(np.abs(X) <= 104, np.clip((np.abs(Z - zr) - 7) / 10.0, 0, 1), 1.0)
    hills = np.clip(fbm2(X, Z, 60, w.seed + 1) + 0.15, 0, 1) * 9 + 1.2 * fbm2(X, Z, 12, w.seed + 2)
    height = np.round(GROUND + np.maximum(hills, 0) * fade * castle * road * river).astype(int)
    w.ground = height
    ys = (np.arange(H) + MIN_Y)[None, :, None]
    hh = height[:, None, :]
    b = w.b
    b[(ys < hh - 3)] = STONE
    b[(ys >= hh - 3) & (ys < hh)] = DIRT
    b[ys == hh] = GRASS
    b[:, 0, :] = BEDROCK

def river_z(x):
    return 86 + 4 * np.sin(np.asarray(x, float) / 21.0)

def build_river(w):
    for x in range(-104, 105):
        zc = float(river_z(x))
        half = 4.0 if abs(x) < 96 else 4.0 * math.sqrt(max(0, 1 - ((abs(x) - 96) / 8.0) ** 2))
        for z in range(int(zc - 6), int(zc + 7)):
            if abs(z - zc) <= half:
                w.fill(x, x, GROUND - 2, GROUND, z, z, WATER)
                w.fill(x, x, GROUND + 1, GROUND + 6, z, z, AIR)
                if w.rng.random() < 0.03:
                    w.set(x, GROUND - 3, z, SEA_LANTERN)
                elif w.rng.random() < 0.05 and abs(z - zc) > 2:
                    w.set(x, GROUND + 1, z, LILY_PAD)
        w.protect(x, x, int(zc - 5), int(zc + 5))

def build_road(w):
    """Spawn plaza at the south end, a path north over the rainbow bridge to the moat bridge."""
    zc = float(river_z(0))
    b0, b1 = int(zc - 9), int(zc + 9)
    for z in range(47, 112):
        if b0 <= z <= b1:
            continue
        for x in range(-1, 2):
            w.set(x, GROUND, z, GRASS_PATH)
            w.fill(x, x, GROUND + 1, GROUND + 4, z, z, AIR)
    w.protect(-3, 3, 40, 120)
    # lantern posts every 10 blocks
    for z in range(52, 110, 10):
        if b0 - 2 <= z <= b1 + 2:
            continue
        for x in (-3, 3):
            lamp_post(w, x, GROUND + 1, z)
    # rainbow bridge: a 7-wide arch over the river, red on the west edge to purple on the east
    for z in range(b0, b1 + 1):
        t = (z - zc) / (b1 - zc + 0.5)
        y = GROUND + int(round(6 * (1 - t * t)))
        for i, x in enumerate(range(-3, 4)):
            w.set(x, y, z, RAINBOW[i])
            w.fill(x, x, y + 1, y + 4, z, z, AIR)
    w.places["rainbow bridge"] = (0, GROUND + 7, int(zc))
    # spawn plaza
    sx, sz = 0, 114
    d, X, Z = disk_mask(sx, sz, 0, sx - 5, sx + 5, sz - 5, sz + 5)
    for x, z, dd in zip(X.ravel(), Z.ravel(), d.ravel()):
        if dd <= 4.4:
            w.set(int(x), GROUND, int(z), PINK_TERRACOTTA if dd > 3.3 else SMOOTH_QUARTZ)
            w.fill(int(x), int(x), GROUND + 1, GROUND + 5, int(z), int(z), AIR)
    w.protect(-6, 6, 108, 120)
    w.spawn = (sx, GROUND + 1, sz)
    w.chest("spawn", sx + 2, GROUND + 1, sz, SPAWN_ITEMS, facing="west")
    for x, z in ((-4, 110), (4, 110), (-4, 118), (4, 118)):
        lamp_post(w, x, GROUND + 1, z)

def lamp_post(w, x, y, z, h=2):
    for k in range(h):
        w.set(x, y + k, z, CHERRY_FENCE)
    w.set(x, y + h, z, LANTERN)

def cherry_tree(w, x, y, z, size=1.0):
    rng = w.rng
    h = int(rng.randint(4, 6) * size)
    for k in range(h):
        if w.get(x, y + k, z) not in (AIR, SHORT_GRASS) and k > 0:
            return False
        w.set(x, y + k, z, CHERRY_LOG)
    tops = [(x, y + h, z)]
    for _ in range(rng.randint(1, 3)):
        a = rng.uniform(0, 2 * math.pi)
        L = rng.randint(2, 3) * size
        bx = by = bz = 0
        for s in range(1, int(L) + 1):
            bx, bz = int(round(math.cos(a) * s)), int(round(math.sin(a) * s))
            by = h - 2 + s
            w.set(x + bx, y + by, z + bz, CHERRY_LOG, only_air=True)
        tops.append((x + bx, y + by, z + bz))
    for (tx, ty, tz) in tops:
        r = rng.uniform(2.6, 3.6) * size
        ri = int(math.ceil(r))
        for a in range(-ri, ri + 1):
            for c in range(-ri, ri + 1):
                for k in range(-1, 3):
                    rr = r - (0 if k <= 0 else k * 0.9)
                    if a * a + c * c <= rr * rr + rng.uniform(-1.2, 0.6):
                        w.set(tx + a, ty + k, tz + c, CHERRY_LEAVES, only_air=True)
    # fallen petals around the base
    for _ in range(int(14 * size)):
        px, pz = x + rng.randint(-4, 4), z + rng.randint(-4, 4)
        t = w.surface(px, pz)
        if t is not None and w.get(px, t, pz) == GRASS:
            w.set(px, t + 1, pz, rng.choice(PETALS))
    return True

def plant_land(w):
    """Cherry groves, flower meadows and grass over all the open grass."""
    rng = w.rng
    xs = np.arange(-HALF, HALF)
    X, Z = np.meshgrid(xs, xs, indexing="ij")
    grove = fbm2(X, Z, 40, w.seed + 30)
    meadow = fbm2(X, Z, 20, w.seed + 31)
    kind = (fbm2(X, Z, 14, w.seed + 32) * 3.5 + 3.5).astype(int) % len(FLOWERS)
    order = [(i, k) for i in range(SIZE) for k in range(SIZE)]
    rng.shuffle(order)
    trees = 0
    for (i, k) in order:
        x, z = i - HALF, k - HALF
        if w.no_plant[i, k]:
            continue
        t = w.surface(x, z)
        if t is None or w.get(x, t, z) != GRASS:
            continue
        y = t + 1
        r = rng.random()
        if r < (0.03 if grove[i, k] > 0.15 else 0.002) and clear_around(w, x, z, 3):
            if cherry_tree(w, x, y, z, size=1.0 if rng.random() < 0.8 else 1.3):
                trees += 1
            continue
        if meadow[i, k] > -0.05 and r < 0.40:
            if r < 0.04:
                lo, hi = rng.choice(DOUBLE_FLOWERS)
                w.set(x, y, z, lo); w.set(x, y + 1, z, hi)
            else:
                w.set(x, y, z, FLOWERS[kind[i, k]] if rng.random() < 0.75 else rng.choice(FLOWERS))
        elif r < 0.25:
            w.set(x, y, z, SHORT_GRASS)
        elif r < 0.262:
            w.set(x, y, z, rng.choice(PETALS))
    w.tree_count = trees

def clear_around(w, x, z, r):
    i, k = x + HALF, z + HALF
    if i - r < 0 or k - r < 0 or i + r >= SIZE or k + r >= SIZE:
        return False
    if w.no_plant[i - r:i + r + 1, k - r:k + r + 1].any():
        return False
    sub = w.b[i - r:i + r + 1, :, k - r:k + r + 1]
    return not np.isin(sub, [CHERRY_LOG, CHERRY_LEAVES]).any()

def giant_rainbow(w):
    """A giant rainbow behind the castle, with a pot of gold at each end. It rises no steeper
    than one block per block, so you can walk (well, hop) all the way up and over it."""
    L, hgt, zc = 118, 74, -100
    for x in range(-L, L + 1):
        top = GROUND + int(round(hgt * math.cos(math.pi * x / (2 * L))))
        for band in range(7):
            y = top - band
            for z in range(zc - 2, zc + 3):
                cur = w.get(x, y, z)
                if cur == AIR or cur in PASSABLE or cur in (CHERRY_LEAVES, CHERRY_LOG):
                    w.set(x, y, z, RAINBOW[band])
        for z in range(zc - 2, zc + 3):
            w.fill(x, x, top + 1, top + 3, z, z, AIR)
    w.protect(-L - 2, L + 2, zc - 10, zc + 10)
    w.places["rainbow top"] = (0, GROUND + hgt + 1, zc)
    for side in (-1, 1):
        px = side * (L - 10)
        pz = zc + 6
        t = w.surface(px, pz)
        y = t + 1 if w.get(px, t, pz) in (GRASS, DIRT) else t
        for a in range(-2, 3):
            for c in range(-2, 3):
                if a * a + c * c <= 5:
                    w.fill(px + a, px + a, y, y + 4, pz + c, pz + c, AIR)
                    w.set(px + a, y - 1, pz + c, GOLD)
        w.set(px - 1, y, pz, GOLD); w.set(px + 1, y, pz + 1, GOLD)
        w.chest("pot of gold " + ("west" if side < 0 else "east"), px, y, pz, GOLD_POT_ITEMS)
        w.protect(px - 3, px + 3, pz - 3, pz + 3)

def clouds(w):
    rng = w.rng
    spots = []
    while len(spots) < 12:
        cx, cz = rng.randint(-110, 110), rng.randint(-110, 110)
        if abs(cx) < 45 and abs(cz) < 50:
            continue                                # keep the castle sky clear
        if any(math.hypot(cx - a, cz - b) < 40 for a, b, _ in spots):
            continue
        spots.append((cx, cz, rng.randint(28, 46)))
    for (cx, cz, cy) in spots:
        for _ in range(rng.randint(4, 7)):
            bx, bz = cx + rng.randint(-9, 9), cz + rng.randint(-5, 5)
            rx, ry, rz = rng.uniform(4, 8), rng.uniform(1.8, 3), rng.uniform(3, 5)
            for x in range(int(bx - rx), int(bx + rx) + 1):
                for y in range(int(cy - ry), int(cy + ry) + 1):
                    for z in range(int(bz - rz), int(bz + rz) + 1):
                        if ((x - bx) / rx) ** 2 + ((y - cy) / ry) ** 2 * (2 if y < cy else 1) + ((z - bz) / rz) ** 2 <= 1:
                            if w.get(x, y, z) == AIR:
                                w.set(x, y, z, WHITE_WOOL)
    w.cloud_count = len(spots)

def crystal_grove(w, cx, cz):
    rng = w.rng
    for _ in range(9):
        x, z = cx + rng.randint(-9, 9), cz + rng.randint(-9, 9)
        t = w.surface(x, z)
        h = rng.randint(2, 5)
        for k in range(h):
            for a in range(-1, 2):
                for c in range(-1, 2):
                    if abs(a) + abs(c) <= (1 if k < h - 1 else 0):
                        w.set(x + a, t + 1 + k, z + c, AMETHYST if (a or c or k % 3) else PEARL_FROG)
        w.set(x, t + 1 + h, z, AMETHYST_CLUSTER)
        for a, c in ((2, 0), (-2, 0), (0, 2), (0, -2)):
            tt = w.surface(x + a, z + c)
            if w.get(x + a, tt, z + c) == GRASS:
                w.set(x + a, tt, z + c, AMETHYST)
                w.set(x + a, tt + 1, z + c, AMETHYST_CLUSTER)
    w.protect(cx - 11, cx + 11, cz - 11, cz + 11)
    w.places["crystal grove"] = (cx, w.surface(cx, cz) + 1, cz)

def fairy_pond(w, cx, cz):
    rng = w.rng
    for x in range(cx - 9, cx + 10):
        for z in range(cz - 7, cz + 8):
            e = ((x - cx) / 8.5) ** 2 + ((z - cz) / 6.5) ** 2
            t = w.surface(x, z)
            if e <= 1:
                w.fill(x, x, GROUND + 1, t + 6, z, z, AIR)
                w.fill(x, x, GROUND - 2, GROUND, z, z, WATER)
                if rng.random() < 0.08:
                    w.set(x, GROUND - 3, z, SEA_LANTERN)
                elif rng.random() < 0.10:
                    w.set(x, GROUND + 1, z, LILY_PAD)
            elif e <= 1.5 and rng.random() < 0.25:
                if w.get(x, t, z) == GRASS:
                    w.fill(x, x, t + 1, t + 1 + rng.randint(0, 1), z, z, AZALEA_LEAVES)
            elif e <= 1.5 and rng.random() < 0.06 and w.get(x, t, z) == GRASS:
                lamp_post(w, x, t + 1, z, 1)
    w.protect(cx - 10, cx + 10, cz - 8, cz + 8)
    w.places["fairy pond"] = (cx + 10, w.surface(cx + 10, cz) + 1, cz)

# ---------------------------------------------------------------- castle
WALL = 38                 # outer wall's outside face
MOAT0, MOAT1 = 41, 46
WALL_TOP = -49            # wall-walk surface block
KX0, KX1, KZ0, KZ1 = -20, 20, -24, 16        # the palace (keep)
F1, F2, F3, ROOF = -61, -48, -40, -32        # floor blocks of each level
MID, TOP = -14, 4                            # great tower floors
GT = (-0.5, -10.5)                           # great tower centre
GT_R = 9
SQ = (-4, 3, -14, -7)                        # stairwell square x0, x1, z0, z1

def moat_and_bridge(w):
    xs = np.arange(-50, 51)
    for x in xs:
        for z in xs:
            m = max(abs(x), abs(z))
            if MOAT0 <= m <= MOAT1:
                w.fill(int(x), int(x), GROUND - 2, GROUND, int(z), int(z), WATER)
                w.fill(int(x), int(x), GROUND + 1, GROUND + 8, int(z), int(z), AIR)
    w.protect(-50, 50, -50, 50)
    for z in range(WALL + 1, MOAT1 + 2):
        for x in range(-3, 4):
            w.set(x, GROUND, z, CHERRY_PLANKS)
        for x in (-4, 4):
            w.set(x, GROUND, z, CHERRY_PLANKS)
            w.set(x, GROUND + 1, z, CHERRY_FENCE)
    for x in (-4, 4):
        w.set(x, GROUND + 2, MOAT1 + 1, LANTERN)
        w.set(x, GROUND + 2, WALL + 1, LANTERN)

def outer_wall(w):
    lo, hi = WALL - 2, WALL
    for x in range(-hi, hi + 1):
        for z in range(-hi, hi + 1):
            m = max(abs(x), abs(z))
            if lo <= m <= hi:
                w.fill(x, x, GROUND - 2, WALL_TOP, z, z, QUARTZ)
                w.set(x, WALL_TOP - 3, z, PINK_C)
                if m == hi and (x + z) % 2 == 0:
                    w.set(x, WALL_TOP + 1, z, QUARTZ)          # merlons on the outside edge
    # the gate: an arch through the south wall
    for x in range(-3, 4):
        for z in range(lo, hi + 1):
            top = -55 if abs(x) <= 1 else (-56 if abs(x) <= 2 else -57)
            w.fill(x, x, GROUND + 1, top, z, z, AIR)
            w.set(x, GROUND, z, SMOOTH_QUARTZ)
    w.set(0, -54, WALL, GOLD)
    # stairs up onto the wall, inside the south wall on each side of the gate
    for side, d in ((1, 0), (-1, 1)):
        for t in range(12):
            x = side * (13 + t)
            y = GROUND + 1 + t
            w.fill(x, x, GROUND + 1, y - 1, lo - 1, lo - 1, QUARTZ)
            w.set(x, y, lo - 1, QSTAIRS[d])
    w.places["wall walk"] = (30, WALL_TOP + 1, WALL - 1)
    # wall towers: corners, gate and the middle of each other side, with rooms on the wall walk
    ry = WALL_TOP
    for sx in (-1, 1):
        for sz in (-1, 1):
            doors = [180 if sx > 0 else 0, 270 if sz > 0 else 90]
            tower(w, sx * WALL, sz * WALL, 6, GROUND - 2, -36, 14, (PINK_C, MAGENTA_C), room=(ry, doors))
    for sx in (-1, 1):
        tower(w, sx * 7, WALL, 4, GROUND - 2, -42, 11, (PURPLE_C, PINK_C), room=(ry, [0, 180]),
              band=MAGENTA_C, glass=MAGENTA_GLASS, flag=PURPLE_WOOL)
        tower(w, sx * WALL, 0, 5, GROUND - 2, -40, 12, (MAGENTA_C, PINK_C), room=(ry, [90, 270]),
              band=PURPLE_C, glass=PURPLE_GLASS, flag=MAGENTA_WOOL)
    tower(w, 0, -WALL, 5, GROUND - 2, -40, 12, (MAGENTA_C, PINK_C), room=(ry, [0, 180]),
          band=PURPLE_C, glass=PURPLE_GLASS, flag=MAGENTA_WOOL)
    w.places["corner tower room"] = (WALL - 3, ry + 1, WALL - 3)
    w.places["gate tower room"] = (7, ry + 1, WALL)

def keep(w):
    # walls (2 thick), solid up to the roof
    for x in range(KX0, KX1 + 1):
        for z in range(KZ0, KZ1 + 1):
            edge = x <= KX0 + 1 or x >= KX1 - 1 or z <= KZ0 + 1 or z >= KZ1 - 1
            if edge:
                w.fill(x, x, F1, ROOF, z, z, QUARTZ)
                outer = x in (KX0, KX1) or z in (KZ0, KZ1)
                if outer:
                    for y in (F2 - 1, F3 - 1, ROOF - 1):
                        w.set(x, y, z, PINK_C)
                    w.set(x, ROOF + 1, z, QUARTZ)
                    if (x + z) % 2 == 0:
                        w.set(x, ROOF + 2, z, QUARTZ)
            else:
                w.fill(x, x, F1 + 1, ROOF - 1, z, z, AIR)
                # floors
                w.set(x, F1, z, PINK_C if (x + z) % 2 else WHITE_C)
                w.set(x, F2, z, SMOOTH_QUARTZ)
                w.set(x, F3, z, SMOOTH_QUARTZ)
                w.set(x, ROOF, z, QUARTZ)
    # glowing tiles in the ceilings
    for x in range(-15, 16, 6):
        for z in range(-20, 14, 6):
            if not (SQ[0] - 2 <= x <= SQ[1] + 2 and SQ[2] - 2 <= z <= SQ[3] + 2):
                for y in (F2, F3, ROOF):
                    w.set(x, y, z, GLOWSTONE)
    # tall windows on every side
    def window(x, z, rows, glass):
        for y in rows:
            w.set(x, y, z, glass)
    for p in range(-12, 13, 6):
        g = PINK_GLASS if (p // 6) % 2 else LBLUE_GLASS
        for (x, z) in ((p, KZ0), (p, KZ0 + 1), (KX0, p - 4), (KX0 + 1, p - 4), (KX1, p - 4), (KX1 - 1, p - 4)):
            for o in (-1, 0, 1):
                xx, zz = (x + o, z) if z in (KZ0, KZ0 + 1) else (x, z + o)
                window(xx, zz, range(-57, -51 if o == 0 else -52), g)
                window(xx, zz, range(F2 + 2, F2 + 6), g)
                window(xx, zz, range(F3 + 2, F3 + 6), g)
        if abs(p) >= 6:
            for z in (KZ1, KZ1 - 1):
                for o in (-1, 0, 1):
                    window(p + o, z, range(-57, -51 if o == 0 else -52), g)
                    window(p + o, z, range(F2 + 2, F2 + 6), g)
                    window(p + o, z, range(F3 + 2, F3 + 6), g)
    # front door: a big arch with a gold keystone and two pillars
    for x in range(-3, 4):
        top = -53 if abs(x) <= 1 else (-54 if abs(x) <= 2 else -55)
        for z in (KZ1 - 1, KZ1):
            w.fill(x, x, F1 + 1, top, z, z, AIR)
            w.set(x, F1, z, SMOOTH_QUARTZ)
    w.set(0, -52, KZ1, GOLD)
    for x in (-5, 5):
        w.fill(x, x, F1 + 1, -52, KZ1 + 2, KZ1 + 2, QUARTZ_PILLAR)
        w.set(x, -51, KZ1 + 2, GOLD)
        w.set(x, -50, KZ1 + 2, LANTERN)

def grand_hall(w):
    # carpet runner from the door to the throne steps
    for z in range(1, KZ1 - 1):
        for x in range(-2, 3):
            w.set(x, F1 + 1, z, MAGENTA_CARPET if abs(x) == 2 else PINK_CARPET)
    # pillars
    for x in (-10, 10):
        for z in range(12, -23, -6):
            w.fill(x, x, F1 + 1, F2 - 1, z, z, QUARTZ_PILLAR)
            w.set(x, F2 - 1, z, GOLD)
    # flower planters along the side walls
    for x in (-18, 18):
        for z in range(-20, 14):
            if z % 6 in (1, 2, 3):
                w.set(x, F1 + 1, z, GRASS)
                w.set(x, F1 + 2, z, PINK_TULIP if z % 2 else FLOWERS[2])
    # throne dais with three gold thrones
    for x in range(-6, 7):
        for z in range(-4, 0):
            w.set(x, F1 + 1, z, SMOOTH_QUARTZ)
    for x in range(-2, 3):
        w.set(x, F1 + 1, 0, QSTAIRS[3])
    def throne(x, z, tall, cushion):
        y = F1 + 2
        w.set(x, y, z, GOLD); w.set(x, y + 1, z, cushion)
        w.set(x - 1, y, z, GOLD); w.set(x + 1, y, z, GOLD)
        for k in range(tall):
            for a in (-1, 0, 1):
                w.set(x + a, y + k, z - 1, GOLD)
        w.set(x - 1, y + tall, z - 1, END_ROD_UP); w.set(x + 1, y + tall, z - 1, END_ROD_UP)
        w.set(x, y + tall, z - 1, AMETHYST_CLUSTER)
    throne(0, -2, 5, PINK_CARPET)
    throne(-4, -2, 3, LBLUE_CARPET)
    throne(4, -2, 3, LBLUE_CARPET)
    w.places["throne"] = (0, F1 + 2, 1)
    # chandeliers: from the floor-3 ceiling down through the balcony hole, and from the hall ceiling
    for (x, z, top) in ((0, 9, F3 - 1), (0, 4, F3 - 1), (-14, 2, F2 - 1), (14, 2, F2 - 1),
                        (-14, -12, F2 - 1), (14, -12, F2 - 1)):
        chandelier(w, x, z, top, -53 if top == F3 - 1 else -52)

def chandelier(w, x, z, top, low):
    for y in range(low + 1, top + 1):
        w.set(x, y, z, CHAIN)
    for a, c in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
        w.set(x + a, low, z + c, GOLD)
        if a or c:
            w.set(x + a, low - 1, z + c, HANGING_LANTERN)
            w.set(x + a, low + 1, z + c, PINK_CANDLE)
    w.set(x, low - 1, z, HANGING_LANTERN)

def wall_line(w, x0, x1, z0, z1, y0, y1, doors=()):
    for x in range(x0, x1 + 1):
        for z in range(z0, z1 + 1):
            for y in range(y0, y1 + 1):
                if any(dx0 <= x <= dx1 and dz0 <= z <= dz1 and y <= y0 + 2 for (dx0, dx1, dz0, dz1) in doors):
                    continue
                w.set(x, y, z, PINK_C if y == y0 else WHITE_C)

def floor_two(w):
    y0, y1 = F2 + 1, F3 - 1
    wall_line(w, -7, -7, KZ0 + 2, KZ1 - 2, y0, y1, doors=[(-7, -7, -13, -11), (-7, -7, 5, 7)])
    wall_line(w, 6, 6, KZ0 + 2, KZ1 - 2, y0, y1, doors=[(6, 6, -13, -11), (6, 6, 5, 7)])
    wall_line(w, KX0 + 2, -8, -4, -4, y0, y1, doors=[(-14, -12, -4, -4)])
    wall_line(w, 7, KX1 - 2, -4, -4, y0, y1, doors=[(11, 13, -4, -4)])
    # balcony hole over the grand hall, with a glass railing
    for x in range(-3, 3):
        for z in range(3, 12):
            w.set(x, F2, z, AIR)
    for x in range(-4, 4):
        for z in range(2, 13):
            if x in (-4, 3) or z in (2, 12):
                w.set(x, y0, z, PINK_GLASS)
    # --- princess bedroom (back left)
    for x in range(KX0 + 2, -7):
        for z in range(KZ0 + 2, -4):
            if w.get(x, y0, z) == AIR:
                w.set(x, y0, z, PINK_CARPET)
    w.bed(-13, y0, -21, 2)
    w.bed(-10, y0, -21, 2)
    for x in (-14, -11, -9):
        w.set(x, y0, -22, CHERRY_PLANKS); w.set(x, y0 + 1, -22, LANTERN)
    w.chest("wardrobe", -17, y0, -12, WARDROBE_ITEMS, facing="east")
    w.set(-17, y0, -10, CHERRY_PLANKS); w.set(-17, y0 + 1, -10, CAKE)
    w.set(-17, y0, -8, CHERRY_PLANKS); w.set(-17, y0 + 1, -8, PINK_CANDLE)
    for z in (-15, -16):
        w.set(-17, y0, z, AMETHYST); w.set(-17, y0 + 1, z, AMETHYST_CLUSTER)
    w.places["bedroom"] = (-12, y0, -15)
    # --- library (front left)
    for x in range(KX0 + 2, -7):
        for z in range(-3, KZ1 - 1):
            if w.get(x, y0, z) == AIR:
                if x == KX0 + 2 and not (z % 6 in (1, 2, 3)):
                    w.fill(x, x, y0, y0 + 3, z, z, BOOKSHELF)
                elif z == -3 and not (-14 <= x <= -12):
                    w.fill(x, x, y0, y0 + 3, z, z, BOOKSHELF)
                else:
                    w.set(x, y0, z, LBLUE_CARPET)
    for z in (4, 8):
        for x in (-14, -13, -12):
            w.set(x, y0, z, CHERRY_PLANKS)
        w.set(-13, y0 + 1, z, PINK_CANDLE)
        w.set(-15, y0, z, CHERRY_STAIRS[1]); w.set(-11, y0, z, CHERRY_STAIRS[0])
    w.places["library"] = (-12, y0, 6)
    # --- dining room (back right): a long table of cakes
    for x in range(9, 17):
        for z in (-14, -13):
            w.set(x, y0, z, SMOOTH_QUARTZ)
            if x % 2:
                w.set(x, y0 + 1, z, CAKE)
            else:
                w.set(x, y0 + 1, z, PINK_CANDLE)
        w.set(x, y0, -15, CHERRY_STAIRS[2])
        w.set(x, y0, -12, CHERRY_STAIRS[3])
        w.set(x, y1, -13, HANGING_LANTERN) if x % 3 == 0 else None
    w.places["dining room"] = (12, y0, -18)
    # --- rainbow ballroom (front right)
    for x in range(7, KX1 - 1):
        for z in range(-3, KZ1 - 1):
            if w.get(x, F2, z) in (SMOOTH_QUARTZ, GLOWSTONE):
                w.set(x, F2, z, RAINBOW[(x + z) % 7] if (x + z) % 5 else PEARL_FROG)
    w.places["ballroom"] = (12, y0, 6)

def floor_three(w):
    """The blossom gallery: an open floor with little cherry trees and crystals."""
    y0 = F3 + 1
    for (x, z) in ((-13, -16), (13, -16), (-13, 8), (13, 8), (-13, -4), (13, -4)):
        for a in range(-2, 3):
            for c in range(-2, 3):
                w.set(x + a, F3, z + c, GRASS)
                w.set(x + a, y0, z + c, PETALS[(a + c) % len(PETALS)] if (a or c) else AIR)
        for k in range(3):
            w.set(x, y0 + k, z, CHERRY_LOG)
        for a in range(-2, 3):
            for c in range(-2, 3):
                for k in (3, 4, 5):
                    if a * a + c * c <= (6 if k < 5 else 2):
                        w.set(x + a, y0 + k, z + c, CHERRY_LEAVES, only_air=True)
    for (x, z) in ((-8, 10), (7, 10), (-8, -20), (7, -20), (0, 10)):
        w.set(x, y0, z, AMETHYST); w.set(x, y0 + 1, z, AMETHYST); w.set(x, y0 + 2, z, AMETHYST_CLUSTER)
    for x in range(-3, 3):
        for z in range(1, 14):
            w.set(x, y0, z, PINK_CARPET)
    w.places["gallery"] = (0, y0, 0)

def keep_towers(w):
    for sx in (KX0, KX1):
        for sz in (KZ0, KZ1):
            ang = math.degrees(math.atan2(-4 - sz, 0 - sx))
            tower(w, sx, sz, 5, F1, -20, 16, (PINK_C, PURPLE_C), room=(ROOF, [ang]))
    w.places["keep tower room"] = (KX1, ROOF + 1, KZ1)

def roof_garden(w):
    y = ROOF + 1
    for x in range(-16, 17, 4):
        for z in (-20, 12):
            if abs(x) >= 6:
                w.set(x, ROOF, z, GRASS); w.set(x, y, z, FLOWERS[(x // 4) % 7])
    for (x, z) in ((-16, -4), (16, -4)):
        lamp_post(w, x, y, z)
    w.places["roof"] = (10, y, 0)

def ring_cells():
    x0, x1, z0, z1 = SQ
    cells = [(x, z1) for x in range(x0, x1 + 1)]                 # south row, going east
    cells += [(x1, z) for z in range(z1 - 1, z0 - 1, -1)]        # east column, going north
    cells += [(x, z0) for x in range(x1 - 1, x0 - 1, -1)]        # north row, going west
    cells += [(x0, z) for z in range(z0 + 1, z1)]                # west column, going south
    return cells

STEP0 = F1 + 1                                   # y of the first step
def great_tower(w):
    cx, cz = GT
    r = GT_R
    R = r + 3
    d, X, Z = disk_mask(cx, cz, 0, int(cx - R), int(cx + R) + 1, int(cz - R), int(cz + R) + 1)
    shell = (d <= r + 0.35) & (d > r - 0.8)
    inner = d <= r - 0.8
    top = 12
    column_set(w, X, Z, shell, ROOF, top, QUARTZ)
    column_set(w, X, Z, inner, ROOF + 1, top, AIR)
    for y in range(ROOF + 6, top, 8):
        column_set(w, X, Z, shell, y, y, PINK_C)
    for y in (MID, TOP):
        column_set(w, X, Z, inner, y, y, SMOOTH_QUARTZ)
    for y in range(ROOF + 4, top - 1, 6):
        for ang in (45, 135, 225, 315, 0, 180):
            a = math.radians(ang)
            wx, wz = int(math.floor(cx + math.cos(a) * r + 0.5)), int(math.floor(cz + math.sin(a) * r + 0.5))
            w.set(wx, y, wz, PINK_GLASS); w.set(wx, y + 1, wz, PINK_GLASS)
    # balcony all the way round the top room
    bal = (d > r - 0.8) & (d <= r + 2.6)
    column_set(w, X, Z, bal & ~shell, TOP, TOP, SMOOTH_QUARTZ)
    rail = (d > r + 1.6) & (d <= r + 2.6)
    column_set(w, X, Z, rail, TOP + 1, TOP + 1, QUARTZ)
    for x, z in zip(X[rail], Z[rail]):
        if (x + z) % 3 == 0:
            w.set(int(x), TOP + 2, int(z), LANTERN)
    carve_door(w, cx, cz, r, ROOF + 1, 90, width=1.6)
    carve_door(w, cx, cz, r, TOP + 1, 90, width=1.6)
    cone(w, cx + 0.0, cz + 0.0, r + 1.6, top + 1, 26, (PINK_C, MAGENTA_C, PURPLE_C), flag=MAGENTA_WOOL)
    w.places["balcony"] = (0, TOP + 1, int(cz + r + 1.5))
    w.places["tower middle room"] = (-1, MID + 1, -17)

def stairwell(w):
    """The grand spiral staircase: a square ring of stairs round a glowing core, from the
    grand hall all the way to the treasure room. Each floor's step is level with the floor."""
    x0, x1, z0, z1 = SQ
    cells = ring_cells()
    n = len(cells)
    last = TOP - STEP0
    floors = [F2, F3, ROOF, MID, TOP]
    # core
    for x in range(x0 + 1, x1):
        for z in range(z0 + 1, z1):
            edge = x in (x0 + 1, x1 - 1) or z in (z0 + 1, z1 - 1)
            for y in range(F1 + 1, TOP + 1):
                v = QUARTZ_PILLAR
                if (y - F1) % 7 == 0:
                    v = PINK_C
                if edge and (x in (x0 + 1, x1 - 1)) and (z in (z0 + 1, z1 - 1)) and (y - F1) % 5 == 2:
                    v = SEA_LANTERN
                w.set(x, y, z, v)
    # open the ring through every floor
    for (x, z) in cells:
        w.fill(x, x, F1 + 1, TOP + 6, z, z, AIR)
    steps = []
    for i in range(last + 1):
        x, z = cells[i % n]
        nx, nz = cells[(i + 1) % n]
        dx, dz = nx - x, nz - z
        dirn = 0 if dx > 0 else 1 if dx < 0 else 2 if dz > 0 else 3
        w.set(x, STEP0 + i, z, QSTAIRS[dirn])
        steps.append((x, STEP0 + i, z))
    w.steps = steps
    # railings round the ring on each floor, with a gap by that floor's step
    for fy in floors:
        i = fy - STEP0
        sx, sz = cells[i % n]
        for x in range(x0 - 1, x1 + 2):
            for z in range(z0 - 1, z1 + 2):
                if x in (x0 - 1, x1 + 1) or z in (z0 - 1, z1 + 1):
                    if max(abs(x - sx), abs(z - sz)) <= 1:
                        continue
                    w.set(x, fy + 1, z, CHISELED_QUARTZ)
                    if (x, z) in ((x0 - 1, z0 - 1), (x1 + 1, z0 - 1), (x0 - 1, z1 + 1), (x1 + 1, z1 + 1)):
                        w.set(x, fy + 2, z, LANTERN)
    w.stair_floors = floors

def treasure_room(w):
    y = TOP + 1
    w.chest("treasure", -1, y, -17, TREASURE_ITEMS, facing="south")
    w.chest("fairy wings", 0, y, -17, FLYING_ITEMS, facing="south")
    for (x, z) in ((-3, -17), (2, -17), (-7, -12), (6, -12), (-7, -9), (6, -9)):
        if w.get(x, y, z) == AIR and w.get(x, y - 1, z) != AIR:
            w.set(x, y, z, GOLD)
            w.set(x, y + 1, z, AMETHYST_CLUSTER)
    w.places["treasure room"] = (0, y, -17)

def courtyard(w):
    lo = WALL - 3                                    # inside face of the wall
    # path from the gate to the palace door, round the fountain
    fx, fz = 0, 27
    for z in range(KZ1 + 1, WALL + 1):
        for x in range(-3, 4):
            dd = math.hypot(x - fx, z - fz)
            if dd > 4.4:
                w.set(x, GROUND, z, PINK_TERRACOTTA if abs(x) == 3 else SMOOTH_QUARTZ)
    d, X, Z = disk_mask(fx, fz, 0, fx - 7, fx + 7, fz - 7, fz + 7)
    for x, z, dd in zip(X.ravel(), Z.ravel(), d.ravel()):
        x, z = int(x), int(z)
        if dd <= 3.4:
            w.fill(x, x, GROUND - 1, GROUND, z, z, WATER)
            w.set(x, GROUND - 2, z, SEA_LANTERN if (x + z) % 3 == 0 else SMOOTH_QUARTZ)
        elif dd <= 4.4:
            w.set(x, GROUND, z, SMOOTH_QUARTZ); w.set(x, GROUND + 1, z, SMOOTH_QUARTZ)
        elif dd <= 6.4:
            w.set(x, GROUND, z, SMOOTH_QUARTZ)
    w.fill(fx, fx, GROUND - 1, GROUND + 4, fz, fz, CHISELED_QUARTZ)
    for a in (-1, 0, 1):
        for c in (-1, 0, 1):
            if a or c:
                w.set(fx + a, GROUND + 5, fz + c, GOLD)
    w.set(fx, GROUND + 5, fz, WATER)
    w.places["fountain"] = (fx, GROUND + 1, fz + 6)
    for z in (20, 34):
        for x in (-5, 5):
            lamp_post(w, x, GROUND + 1, z)
    w.protect(-lo, lo, -lo, lo)
    # flower gardens either side of the path
    rng = w.rng
    for x in range(-lo + 1, lo):
        for z in range(KZ1 + 2, lo):
            if 6 <= abs(x) and w.get(x, GROUND, z) == GRASS and w.get(x, GROUND + 1, z) == AIR:
                if (x // 3 + z // 3) % 2 == 0 and rng.random() < 0.8:
                    w.set(x, GROUND + 1, z, FLOWERS[(abs(x) // 3) % 7])
                elif rng.random() < 0.05:
                    w.set(x, GROUND + 1, z, rng.choice(PETALS))
    for (x, z) in ((-20, 26), (20, 26), (-30, 20), (30, 20), (-30, 28), (30, 28)):
        cherry_tree(w, x, GROUND + 1, z, 0.9)
    # lily pond behind the palace
    for x in range(-14, 15):
        for z in range(-32, KZ0 - 1):
            e = (x / 13.0) ** 2 + ((z + 29) / 3.4) ** 2
            if e <= 1:
                w.fill(x, x, GROUND - 1, GROUND, z, z, WATER)
                if rng.random() < 0.15:
                    w.set(x, GROUND + 1, z, LILY_PAD)
    for (x, z) in ((-24, -30), (24, -30), (-30, -26), (30, -26)):
        cherry_tree(w, x, GROUND + 1, z, 0.9)
    w.places["lily pond"] = (16, GROUND + 1, -30)
    stable(w)
    hedge_maze(w)

def stable(w):
    """The unicorn stable, on the east side of the palace."""
    x0, x1, z0, z1 = 24, 32, -8, 2
    y = GROUND + 1
    for x in range(x0, x1 + 1):
        for z in range(z0, z1 + 1):
            w.set(x, GROUND, z, CHERRY_PLANKS)
            if x in (x0, x1) or z in (z0, z1):
                corner = x in (x0, x1) and z in (z0, z1)
                if corner:
                    w.fill(x, x, y, y + 3, z, z, CHERRY_LOG)
                elif x == x0 and z0 + 3 <= z <= z1 - 3:
                    pass                                   # wide opening facing the palace
                else:
                    w.set(x, y, z, CHERRY_FENCE)
            w.set(x, y + 4, z, PINK_C if (x + z) % 2 else WHITE_C)
    for z in range(z0 + 1, z1):
        if z % 3:
            w.set(x1 - 1, y, z, HAY)
        else:
            w.set(x1 - 1, GROUND, z, WATER)              # a drinking trough sunk into the floor
    for z in (z0 + 3, z1 - 3):
        for x in range(x0 + 3, x1 - 1):
            w.set(x, y, z, CHERRY_FENCE)
    for (x, z) in ((x0 + 2, z0 + 1), (x0 + 2, z1 - 1)):
        w.set(x, y + 3, z, HANGING_LANTERN)
    w.chest("stable", x0 + 1, y, z0 + 1, STABLE_ITEMS, facing="south")
    w.places["stable"] = (x0 + 2, y, (z0 + z1) // 2)

def hedge_maze(w):
    """A little hedge maze (5 x 5 rooms, waist... well, head high) with a chest in the middle."""
    n = 5
    x0, z0 = -32, -11          # north-west corner of the maze
    size = 2 * n + 1
    rng = w.rng
    walls = np.ones((size, size), bool)
    seen = np.zeros((n, n), bool)
    stack = [(n - 1, n // 2)]
    seen[n - 1, n // 2] = True
    while stack:
        cx, cz = stack[-1]
        walls[2 * cx + 1, 2 * cz + 1] = False
        nb = [(cx + a, cz + c) for a, c in ((1, 0), (-1, 0), (0, 1), (0, -1))
              if 0 <= cx + a < n and 0 <= cz + c < n and not seen[cx + a, cz + c]]
        if not nb:
            stack.pop()
            continue
        nx, nz = rng.choice(nb)
        walls[cx + nx + 1, cz + nz + 1] = False
        seen[nx, nz] = True
        stack.append((nx, nz))
    walls[size - 1, 2 * (n // 2) + 1] = False             # entrance on the east, facing the palace
    y = GROUND + 1
    for a in range(size):
        for c in range(size):
            x, z = x0 + a, z0 + c
            w.fill(x, x, y, y + 3, z, z, AIR)
            if walls[a, c]:
                w.fill(x, x, y, y + 1, z, z, AZALEA_LEAVES)
            else:
                w.set(x, GROUND, z, GRASS)
    mx, mz = x0 + 2 * (n // 2) + 1, z0 + 2 * (n // 2) + 1
    w.chest("maze", mx, y, mz, MAZE_ITEMS, facing="east")
    w.set(mx, GROUND, mz + 1, PEARL_FROG)
    w.places["maze entrance"] = (x0 + size, y, z0 + 2 * (n // 2) + 1)

# ---------------------------------------------------------------- level.dat
FLAT_LAYERS = json.dumps({
    "biome_id": PLAINS_BIOME,
    "block_layers": [{"block_name": "minecraft:bedrock", "count": 1}, {"block_name": "minecraft:dirt", "count": 2},
                     {"block_name": "minecraft:grass_block", "count": 1}],
    "encoding_version": 6, "structure_options": None, "world_version": "version.post_1_18"},
    separators=(",", ":"))

def level_dat(w):
    """Same layout as the Floating Islands world, with Peaceful difficulty and plains outside."""
    saved = fw.WORLD_NAME, fw.FLAT_LAYERS
    fw.WORLD_NAME, fw.FLAT_LAYERS = WORLD_NAME, FLAT_LAYERS
    try:
        raw = fw.level_dat(w)
    finally:
        fw.WORLD_NAME, fw.FLAT_LAYERS = saved
    # Difficulty: patch the int in the NBT body (Easy 1 -> Peaceful 0)
    key = b"\x03" + struct.pack("<H", 10) + b"Difficulty"
    p = raw.index(key) + len(key)
    raw = raw[:p] + struct.pack("<i", 0) + raw[p + 4:]
    return raw

# ---------------------------------------------------------------- chunks
def chunk_records(w, cx, cz, palette_nbt):
    i0, k0 = cx * 16 + HALF, cz * 16 + HALF
    col = w.b[i0:i0 + 16, :, k0:k0 + 16]
    base = struct.pack("<ii", cx, cz)
    yield base + bytes([0x2C]), bytes([CHUNK_VERSION])
    for sy in range(H // 16):
        sub = col[:, sy * 16:(sy + 1) * 16, :]
        if not sub.any():
            continue
        xzy = sub.transpose(0, 2, 1).reshape(-1)
        y_index = sy + MIN_Y // 16
        yield base + bytes([0x2F, y_index & 0xFF]), bytes([9, 1, y_index & 0xFF]) + encode_storage(xzy, palette_nbt)
    nz = col != AIR
    top = np.where(nz.any(axis=1), H - np.argmax(nz[:, ::-1, :], axis=1), 0)
    hm = top.T.reshape(-1).astype("<i2")
    biomes = b"".join(bytes([1]) + struct.pack("<i", PLAINS_BIOME) for _ in range(25))
    yield base + bytes([0x2B]), hm.tobytes() + biomes
    yield base + bytes([0x36]), struct.pack("<i", 2)
    bes = [nb for (x, y, z, nb) in w.block_entities if (x + HALF) // 16 == cx + HALF // 16 and (z + HALF) // 16 == cz + HALF // 16]
    if bes:
        yield base + bytes([0x31]), b"".join(bes)

def write_world(w, out_dir, preview):
    import plyvel
    tmp = tempfile.mkdtemp()
    db = plyvel.DB(os.path.join(tmp, "db"), create_if_missing=True, compression=None)
    palette_nbt = {i: fw.nbt({"name": STR(n), "states": C({k: fw._auto(v) for k, v in s.items()}),
                              "version": I(BLOCK_VERSION)}) for i, (n, s) in enumerate(PALETTE)}
    n_chunks = 0
    with db.write_batch() as wb:
        for cx in range(-HALF // 16, HALF // 16):
            for cz in range(-HALF // 16, HALF // 16):
                for key, val in chunk_records(w, cx, cz, palette_nbt):
                    wb.put(key, val)
                n_chunks += 1
    db.compact_range()
    db.close()
    with open(os.path.join(tmp, "level.dat"), "wb") as f:
        f.write(level_dat(w))
    with open(os.path.join(tmp, "levelname.txt"), "w") as f:
        f.write(WORLD_NAME)
    from PIL import Image
    im = Image.open(preview).convert("RGB")
    im.thumbnail((800, 450))
    im.save(os.path.join(tmp, "world_icon.jpeg"), quality=88)
    out = os.path.join(out_dir, "PrincessKingdom.mcworld")
    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(tmp):
            for fn in files:
                p = os.path.join(root, fn)
                z.write(p, os.path.relpath(p, tmp))
    shutil.rmtree(tmp)
    return out, n_chunks

# ---------------------------------------------------------------- previews
def _colors():
    c = {GRASS: (110, 175, 70), DIRT: (120, 85, 55), STONE: (125, 125, 125), BEDROCK: (40, 40, 40),
         GRASS_PATH: (170, 150, 95), WATER: (70, 130, 230), QUARTZ: (236, 230, 224), SMOOTH_QUARTZ: (240, 236, 230),
         CHISELED_QUARTZ: (230, 225, 218), QUARTZ_PILLAR: (232, 228, 222), CALCITE: (225, 225, 220), GOLD: (250, 205, 60),
         WHITE_C: (235, 238, 240), PINK_C: (240, 150, 185), MAGENTA_C: (200, 70, 190), PURPLE_C: (120, 50, 170),
         PINK_TERRACOTTA: (165, 80, 80), PINK_GLASS: (245, 180, 210), MAGENTA_GLASS: (220, 120, 210),
         LBLUE_GLASS: (160, 210, 245), PURPLE_GLASS: (170, 120, 220), WHITE_WOOL: (248, 248, 250),
         PINK_WOOL: (245, 165, 195), PURPLE_WOOL: (140, 70, 190), MAGENTA_WOOL: (210, 90, 200),
         PINK_CARPET: (240, 150, 185), MAGENTA_CARPET: (200, 70, 190), LBLUE_CARPET: (110, 180, 230),
         CHERRY_LOG: (60, 35, 45), CHERRY_LEAVES: (245, 175, 205), CHERRY_PLANKS: (225, 175, 165), CHERRY_FENCE: (225, 175, 165),
         AZALEA_LEAVES: (110, 145, 60), SHORT_GRASS: (100, 170, 65), LANTERN: (255, 200, 110), HANGING_LANTERN: (255, 200, 110),
         CHAIN: (60, 60, 70), END_ROD_UP: (250, 245, 235), SEA_LANTERN: (200, 240, 240), GLOWSTONE: (250, 215, 130),
         PEARL_FROG: (245, 205, 240), AMETHYST: (150, 100, 200), AMETHYST_CLUSTER: (190, 140, 230), BOOKSHELF: (130, 90, 50),
         CAKE: (250, 240, 235), PINK_CANDLE: (240, 150, 185), HAY: (200, 170, 50), LILY_PAD: (50, 130, 40)}
    for v in RAINBOW: c.setdefault(v, None)
    for v, rgb in zip(RAINBOW, [(220, 40, 40), (245, 140, 30), (250, 220, 40), (110, 200, 40), (90, 190, 240),
                                (50, 70, 200), (130, 50, 180)]):
        c[v] = rgb
    for v in FLOWERS: c[v] = (235, 150, 200)
    for lo, hi in DOUBLE_FLOWERS: c[lo] = c[hi] = (220, 120, 190)
    for v in PETALS: c[v] = (245, 170, 205)
    for v in CHESTS.values(): c[v] = (160, 110, 40)
    for v in QSTAIRS: c[v] = (236, 230, 224)
    for v in CHERRY_STAIRS: c[v] = (225, 175, 165)
    for v in BEDS.values(): c[v] = (240, 150, 185)
    return c
GLOW = {LANTERN, HANGING_LANTERN, SEA_LANTERN, GLOWSTONE, PEARL_FROG, END_ROD_UP, PINK_CANDLE}

def render(w, path, region=None, sc=2, night=False):
    from PIL import Image, ImageFilter
    lut = np.zeros((256, 3), np.float32)
    for k, v in _colors().items():
        if v: lut[k] = v
    b = w.b
    if region:
        x0, x1, z0, z1 = region
        b = b[x0 + HALF:x1 + HALF, :, z0 + HALF:z1 + HALF]
    solid = b != AIR
    nb = np.zeros_like(solid)
    nb[:, :-1, :] |= ~solid[:, 1:, :]; nb[:-1, :, :] |= ~solid[1:, :, :]; nb[:, :, :-1] |= ~solid[:, :, 1:]
    nb[-1, :, :] = True; nb[:, :, -1] = True
    idx = np.argwhere(solid & nb & ((np.arange(b.shape[1]) >= 0)[None, :, None]))
    i, j, k = idx[:, 0], idx[:, 1], idx[:, 2]
    keep_ = j >= 1
    i, j, k = i[keep_], j[keep_], k[keep_]
    sx = ((i - k) + b.shape[2]) * sc
    sy = ((i + k) / 2 - j) * sc
    sy = (sy - sy.min()).astype(int)
    order = np.argsort(i + k + j * 0.01)
    sx, sy, i, j, k = sx[order], sy[order], i[order], j[order], k[order]
    blocks = b[i, j, k]
    col = lut[blocks].copy()
    top_open = np.zeros(len(i), bool)
    up = j + 1 < b.shape[1]
    top_open[up] = b[i[up], j[up] + 1, k[up]] == AIR
    side = np.zeros(len(i), bool)
    ok = i + 1 < b.shape[0]
    side[ok] = b[i[ok] + 1, j[ok], k[ok]] == AIR
    col *= np.where(top_open, 1.0, np.where(side, 0.86, 0.72))[:, None]
    if night:
        g = np.isin(blocks, list(GLOW))
        col = np.where(g[:, None], col * 1.1, col * np.array([0.16, 0.16, 0.32]))
    Wd, Hd = (b.shape[0] + b.shape[2]) * sc + 2 * sc, int(sy.max()) + 2 * sc
    img = np.zeros((Hd, Wd, 3), np.float32)
    img[:] = (16, 16, 48) if night else (175, 215, 250)
    for ox in range(sc):
        for oy in range(sc + 1):
            img[np.minimum(sy + oy, Hd - 1), sx + ox] = col
    if night:
        glow_img = np.zeros_like(img)
        g = np.isin(blocks, list(GLOW))
        for ox in range(sc):
            for oy in range(sc):
                glow_img[sy[g] + oy, sx[g] + ox] = col[g]
        blur = np.asarray(Image.fromarray(np.clip(glow_img, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3 * sc)), np.float32)
        img = img + blur * 1.8
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(path)

# ---------------------------------------------------------------- main
def generate(seed):
    w = World(seed)
    t0 = time.time()
    build_ground(w)
    build_river(w)
    moat_and_bridge(w)
    build_road(w)
    keep(w)
    grand_hall(w)
    floor_two(w)
    floor_three(w)
    roof_garden(w)
    keep_towers(w)
    great_tower(w)
    stairwell(w)
    treasure_room(w)
    outer_wall(w)
    courtyard(w)
    giant_rainbow(w)
    crystal_grove(w, -72, 40)
    fairy_pond(w, 72, 42)
    plant_land(w)
    clouds(w)
    w.build_seconds = time.time() - t0
    return w

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20261112)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "dist"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    w = generate(a.seed)
    whole = os.path.join(a.out, "princess_preview.png")
    render(w, whole, sc=2)
    render(w, os.path.join(a.out, "princess_preview_castle.png"), region=(-52, 52, -52, 52), sc=5)
    render(w, os.path.join(a.out, "princess_preview_night.png"), sc=2, night=True)
    out, n = write_world(w, a.out, os.path.join(a.out, "princess_preview_castle.png"))
    print(f"{w.tree_count} cherry trees, {w.cloud_count} clouds, {len(w.chests)} treasure chests, "
          f"{len(w.steps)} stairs; spawn {w.spawn}; {n} chunks")
    print(f"Wrote {out} ({os.path.getsize(out) // 1024} KB) in {w.build_seconds:.0f}s")

if __name__ == "__main__":
    main()
