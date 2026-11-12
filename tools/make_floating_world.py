"""Builds "Floating Jungle Islands", a ready-to-play Bedrock world (.mcworld).

Floating rock islands hang high over a jungle floor. Their tops are grassy jungle with trees,
ferns and purple flowers; vines drape over the sides; glow-berry vines, spore blossoms,
shroomlights and froglights hang underneath, so at night the islands glow. A few islands
pour waterfalls, root bridges join some neighbours, and stone towers rise from the floor.

Play notes (set in level.dat): Survival, Easy, fall damage OFF, keep inventory ON,
coordinates shown. She spawns on the big middle island next to a chest with an elytra and
rockets. Outside the built area (384 x 384 blocks) the world carries on as flat jungle grass.

How it's written: blocks go into LevelDB with no compression, which Bedrock reads fine.
Needs: numpy, plyvel (pip install plyvel; needs libleveldb), Pillow for previews.

Usage: python3 tools/make_floating_world.py [--seed N] [--out dist]
Outputs: dist/FloatingIslands.mcworld, dist/floating_preview_day.png, dist/floating_preview_night.png
"""
import argparse, io, json, math, os, random, shutil, struct, tempfile, time, zipfile
import numpy as np

WORLD_NAME = "Floating Jungle Islands"
# Block states are written for 1.21.60; any newer game upgrades them on load.
GAME_VERSION = (1, 21, 60, 33)
BLOCK_VERSION = (1 << 24) | (21 << 16) | (60 << 8) | 33
CHUNK_VERSION = 40
JUNGLE_BIOME = 21

HALF = 192                     # built area is x,z in [-HALF, HALF)
SIZE = HALF * 2
MIN_Y, MAX_Y = -64, 176        # array covers these heights (subchunks -4 .. 9)
H = MAX_Y - MIN_Y
FLAT_SURFACE = -61             # grass height of the flat world outside the built area

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
STONE, ANDESITE, TUFF, CALCITE = blk("stone"), blk("andesite"), blk("tuff"), blk("calcite")
MOSSY_COBBLE, MOSS = blk("mossy_cobblestone"), blk("moss_block")
DIRT, GRASS, PODZOL, MUD = blk("dirt"), blk("grass_block"), blk("podzol"), blk("mud")
WATER = blk("water", liquid_depth=0)
FALLING_WATER = blk("water", liquid_depth=8)
LOG = blk("jungle_log", pillar_axis="y")
LOG_X, LOG_Z = blk("jungle_log", pillar_axis="x"), blk("jungle_log", pillar_axis="z")
LEAVES = blk("jungle_leaves", persistent_bit=True, update_bit=False)
AZALEA_FLOWER_LEAVES = blk("azalea_leaves_flowered", persistent_bit=True, update_bit=False)
ROOTS = blk("mangrove_roots")
SHORT_GRASS, FERN = blk("short_grass"), blk("fern")
TALL_GRASS = (blk("tall_grass", upper_block_bit=False), blk("tall_grass", upper_block_bit=True))
LARGE_FERN = (blk("large_fern", upper_block_bit=False), blk("large_fern", upper_block_bit=True))
BLUE_ORCHID, ALLIUM = blk("blue_orchid"), blk("allium")
MOSS_CARPET = blk("moss_carpet")
SHROOMLIGHT, SEA_LANTERN = blk("shroomlight"), blk("sea_lantern")
PEARL_FROG = blk("pearlescent_froglight", pillar_axis="y")
VERDANT_FROG = blk("verdant_froglight", pillar_axis="y")
SPORE_BLOSSOM = blk("spore_blossom")
HANGING_ROOTS = blk("hanging_roots")
CAVE_VINE = blk("cave_vines", growing_plant_age=25)
CAVE_VINE_BERRIES = blk("cave_vines_body_with_berries", growing_plant_age=25)
CAVE_VINE_TIP_BERRIES = blk("cave_vines_head_with_berries", growing_plant_age=25)
SEA_PICKLE = blk("sea_pickle", cluster_count=3, dead_bit=False)
CHEST = blk("chest", **{"minecraft:cardinal_direction": "south"})
# vine_direction_bits: which neighbour holds the vine up. 1 south(+z) 2 west(-x) 4 north(-z) 8 east(+x)
VINES = [AIR] + [blk("vine", vine_direction_bits=b) for b in range(1, 16)]
# glow lichen multi_face_direction_bits: the face(s) it sits on. 1 down 2 up 4 south 8 west 16 north 32 east
LICHEN_FLOOR = blk("glow_lichen", multi_face_direction_bits=1)
LICHEN_CEILING = blk("glow_lichen", multi_face_direction_bits=2)
LICHEN_SIDE = {b: blk("glow_lichen", multi_face_direction_bits=b * 4) for b in (1, 2, 4, 8)}  # keyed by vine bit

SOLID = {BEDROCK, STONE, ANDESITE, TUFF, CALCITE, MOSSY_COBBLE, MOSS, DIRT, GRASS, PODZOL, MUD,
         LOG, LOG_X, LOG_Z, ROOTS, SHROOMLIGHT, SEA_LANTERN, PEARL_FROG, VERDANT_FROG}
ROCKY = {STONE, ANDESITE, TUFF, CALCITE, MOSSY_COBBLE, MOSS, DIRT, GRASS, SHROOMLIGHT, PEARL_FROG}

# ---------------------------------------------------------------- noise
def _hash(ix, iy, iz, seed):
    h = (ix.astype(np.int64) * 73856093) ^ (iy.astype(np.int64) * 19349663) ^ (iz.astype(np.int64) * 83492791) ^ seed
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return (h & 0xFFFFFF).astype(np.float64) / 0xFFFFFF * 2 - 1

def noise3(x, y, z, scale, seed):
    x, y, z = np.asarray(x, float) / scale, np.asarray(y, float) / scale, np.asarray(z, float) / scale
    x0, y0, z0 = np.floor(x), np.floor(y), np.floor(z)
    fx, fy, fz = x - x0, y - y0, z - z0
    fx, fy, fz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
    x0, y0, z0 = x0.astype(np.int64), y0.astype(np.int64), z0.astype(np.int64)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (fx if dx else 1 - fx) * (fy if dy else 1 - fy) * (fz if dz else 1 - fz)
                out = out + w * _hash(x0 + dx, y0 + dy, z0 + dz, seed)
    return out

def fbm3(x, y, z, scale, seed, octaves=3):
    total, amp, norm = 0, 1.0, 0
    for o in range(octaves):
        total = total + amp * noise3(x, y, z, scale / (2 ** o), seed + o * 1013)
        norm += amp
        amp *= 0.5
    return total / norm

def fbm2(x, z, scale, seed, octaves=4):
    return fbm3(x, np.zeros_like(np.asarray(x, float)), z, scale, seed, octaves)

# ---------------------------------------------------------------- world builder
class World:
    def __init__(self, seed):
        self.seed = seed
        self.rng = random.Random(seed)
        self.b = np.zeros((SIZE, H, SIZE), dtype=np.uint8)   # [x, y, z]
        self.block_entities = []

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

    def top(self, x, z, below=MAX_Y):
        """Highest non-air y in the column at or below `below`, or None."""
        col = self.b[x + HALF, : below - MIN_Y, z + HALF]
        nz = np.nonzero(col)[0]
        return int(nz[-1]) + MIN_Y if len(nz) else None

# ---------------------------------------------------------------- terrain
def build_ground(w):
    xs = np.arange(-HALF, HALF)
    X, Z = np.meshgrid(xs, xs, indexing="ij")
    edge = np.minimum(HALF - np.abs(X + 0.5), HALF - np.abs(Z + 0.5))
    fade = np.clip((edge - 8) / 40.0, 0, 1)                 # flat at the border so it meets the flat world
    n = fbm2(X, Z, 90, w.seed + 1)
    hills = np.clip(n + 0.22, -0.2, 1) * 16 + 2 * fbm2(X, Z, 18, w.seed + 2)
    height = np.round(FLAT_SURFACE + hills * fade).astype(int)
    height = np.clip(height, MIN_Y + 1, FLAT_SURFACE + 18)
    podzol = fbm2(X, Z, 25, w.seed + 3) > 0.25
    w.ground = height
    for i in range(SIZE):
        for k in range(SIZE):
            h = height[i, k]
            col = w.b[i, :, k]
            col[0] = BEDROCK
            hj = h - MIN_Y
            col[1:max(1, hj - 3)] = STONE
            if h < FLAT_SURFACE:                              # lake
                col[max(1, hj - 3):hj + 1] = MUD
                col[hj + 1:FLAT_SURFACE - MIN_Y + 1] = WATER
            else:
                col[max(1, hj - 3):hj] = DIRT
                col[hj] = PODZOL if podzol[i, k] else GRASS

def place_island(w, cx, cz, top_y, radius, depth, sharp, seed, grounded=False):
    """A floating rock island: a domed top with a spike hanging underneath."""
    r_box = int(radius * 1.45) + 2
    x0, x1 = max(-HALF, cx - r_box), min(HALF, cx + r_box)
    z0, z1 = max(-HALF, cz - r_box), min(HALF, cz + r_box)
    bottom = MIN_Y + 1 if grounded else max(MIN_Y + 1, int(top_y - depth))
    y0, y1 = bottom, min(MAX_Y - 1, int(top_y + radius * 0.35) + 2)
    X, Y, Z = np.meshgrid(np.arange(x0, x1), np.arange(y0, y1), np.arange(z0, z1), indexing="ij")
    dist = np.sqrt((X - cx) ** 2 + (Z - cz) ** 2)
    d = np.clip((top_y - Y) / depth, 0, 1)                     # 0 at the top, 1 at the tip
    if grounded:
        prof = radius * (0.75 + 0.25 * (1 - d) ** 0.5)            # towers: nearly straight sides
    else:
        prof = radius * (1 - d) ** sharp                        # spike tapering downward
    # rounded top dome
    dome = top_y + radius * 0.22 * np.clip(1 - (dist / radius) ** 2, 0, 1)
    wobble = 1 + 0.32 * fbm3(X, Y * 0.6, Z, 14, seed) + 0.12 * noise3(X, Y, Z, 4, seed + 7)
    solid = (dist < prof * wobble) & (Y <= dome + 1.5 * noise3(X, 0 * X, Z, 6, seed + 9))
    if not grounded:
        solid &= Y >= top_y - depth
    sub = w.b[x0 + HALF:x1 + HALF, y0 - MIN_Y:y1 - MIN_Y, z0 + HALF:z1 + HALF]
    sub[solid & (sub == AIR) | solid & (sub == WATER)] = STONE

def paint_rock(w):
    """Turn raw island stone into grass tops, dirt, banded rock and moss."""
    b = w.b
    stone = b == STONE
    above = np.zeros_like(stone); above[:, :-1, :] = b[:, 1:, :] == AIR
    above2 = np.zeros_like(stone); above2[:, :-2, :] = b[:, 2:, :] == AIR
    above3 = np.zeros_like(stone); above3[:, :-3, :] = b[:, 3:, :] == AIR
    idx = np.argwhere(stone)
    X, Y, Z = idx[:, 0] - HALF, idx[:, 1] + MIN_Y, idx[:, 2] - HALF
    band = ((Y + 3 * noise3(X, Y, Z, 9, w.seed + 20)) / 5).astype(int) % 5
    rock = np.array([STONE, ANDESITE, STONE, TUFF, CALCITE], dtype=np.uint8)[band]
    moss = fbm3(X, Y, Z, 10, w.seed + 21) > 0.22
    rock[moss] = np.where(noise3(X, Y, Z, 3, w.seed + 22) > 0, MOSS, MOSSY_COBBLE)[moss]
    b[idx[:, 0], idx[:, 1], idx[:, 2]] = rock
    b[stone & (above2 | above3) & ~above] = DIRT
    b[stone & above] = GRASS

def make_islands(w):
    rng = w.rng
    islands = []
    # the big spawn island in the middle
    islands.append(dict(cx=0, cz=0, top=55, r=24, depth=70, sharp=0.75))
    tries = 0
    while len(islands) < 34 and tries < 4000:
        tries += 1
        r = rng.choice([7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 19])
        cx, cz = rng.randint(-HALF + r + 6, HALF - r - 6), rng.randint(-HALF + r + 6, HALF - r - 6)
        top = rng.randint(0, 110)
        ok = True
        for o in islands:
            gap = math.hypot(cx - o["cx"], cz - o["cz"]) - (r + o["r"]) * 1.25
            if gap < 6 and abs(top - o["top"]) < (r + o["r"]) * 2.2:
                ok = False
                break
        if ok:
            islands.append(dict(cx=cx, cz=cz, top=top, r=r, depth=r * rng.uniform(1.6, 3.0),
                                sharp=rng.uniform(0.55, 1.1)))
    for i, isl in enumerate(islands):
        place_island(w, isl["cx"], isl["cz"], isl["top"], isl["r"], isl["depth"], isl["sharp"], w.seed + 100 + i)
    # stone towers rising from the jungle floor
    towers = []
    while len(towers) < 7:
        r = rng.randint(5, 9)
        cx, cz = rng.randint(-HALF + 20, HALF - 20), rng.randint(-HALF + 20, HALF - 20)
        if all(math.hypot(cx - o["cx"], cz - o["cz"]) > o["r"] + r + 10 for o in islands + towers):
            t = dict(cx=cx, cz=cz, top=rng.randint(-30, 20), r=r)
            towers.append(t)
            place_island(w, cx, cz, t["top"], r, 200, 1, w.seed + 500 + len(towers), grounded=True)
    w.islands, w.towers = islands, towers

def make_bridges(w):
    """Sagging root bridges between some neighbouring islands at similar heights."""
    rng, isl = w.rng, w.islands
    pairs = []
    for i in range(len(isl)):
        for j in range(i + 1, len(isl)):
            a, b = isl[i], isl[j]
            gap = math.hypot(a["cx"] - b["cx"], a["cz"] - b["cz"]) - a["r"] - b["r"]
            if 6 < gap < 40 and abs(a["top"] - b["top"]) < 14:
                pairs.append((gap, i, j))
    pairs.sort()
    used = {}
    bridges = 0
    for gap, i, j in pairs:
        if used.get(i, 0) >= 2 or used.get(j, 0) >= 2 or bridges >= 12:
            continue
        a, b = isl[i], isl[j]
        dx, dz = b["cx"] - a["cx"], b["cz"] - a["cz"]
        L = math.hypot(dx, dz)
        ux, uz = dx / L, dz / L
        # start/end on each island's rim
        sx, sz = a["cx"] + ux * (a["r"] * 0.55), a["cz"] + uz * (a["r"] * 0.55)
        ex, ez = b["cx"] - ux * (b["r"] * 0.55), b["cz"] - uz * (b["r"] * 0.55)
        sy = w.top(int(sx), int(sz), a["top"] + 12) or a["top"]
        ey = w.top(int(ex), int(ez), b["top"] + 12) or b["top"]
        n = int(math.hypot(ex - sx, ez - sz) * 2) + 1
        sag = 2 + gap * 0.12
        axis = LOG_X if abs(ux) > abs(uz) else LOG_Z
        px, pz = -uz, ux
        hang = []
        for s in range(n + 1):
            t = s / n
            x, z = sx + (ex - sx) * t, sz + (ez - sz) * t
            y = sy + (ey - sy) * t - sag * 4 * t * (1 - t)
            for off in (-0.5, 0.5):
                bx, by, bz = int(round(x + px * off)), int(round(y)), int(round(z + pz * off))
                if w.get(bx, by, bz) in (AIR, LEAVES):
                    w.set(bx, by, bz, axis if rng.random() < 0.6 else ROOTS)
                    for k in (1, 2):
                        if w.get(bx, by + k, bz) not in (AIR, LEAVES, SHORT_GRASS, FERN):
                            break
                        w.set(bx, by + k, bz, AIR)
                    hang.append((bx, by - 1, bz))
        for (x, y, z) in hang:
            if rng.random() < 0.18 and w.get(x, y, z) == AIR:
                hang_down(w, x, y, z, rng.randint(2, 9), glow=rng.random() < 0.5)
        used[i] = used.get(i, 0) + 1
        used[j] = used.get(j, 0) + 1
        bridges += 1
    w.bridge_count = bridges

def make_waterfalls(w):
    rng = w.rng
    falls = 0
    for isl in sorted(w.islands, key=lambda i: -i["r"]):
        if falls >= 8 or isl["r"] < 11:
            continue
        ang = rng.uniform(0, 2 * math.pi)
        ux, uz = math.cos(ang), math.sin(ang)
        # walk outward from the centre until the next step leaves the island
        last = None
        for step in range(0, isl["r"] * 2):
            x, z = int(round(isl["cx"] + ux * step)), int(round(isl["cz"] + uz * step))
            t = w.top(x, z, isl["top"] + 12)
            if t is None or t < isl["top"] - 8:
                break
            last = (x, z, t)
        if not last:
            continue
        x, z, t = last
        # a little spring pool feeding the edge
        for (px, pz) in [(x, z), (int(round(x - ux)), int(round(z - uz))), (int(round(x - 2 * ux)), int(round(z - 2 * uz)))]:
            pt = w.top(px, pz, t + 2)
            if pt is not None and abs(pt - t) <= 1:
                w.set(px, t, pz, WATER)
                for k in range(1, 4):
                    if w.get(px, t + k, pz) != AIR:
                        w.set(px, t + k, pz, AIR)
        # the falling column just past the rim
        fx, fz = int(round(x + ux)), int(round(z + uz))
        if w.get(fx, t, fz) != AIR:
            continue
        w.set(fx, t, fz, FALLING_WATER)
        y = t - 1
        while y > MIN_Y + 1 and w.get(fx, y, fz) == AIR:
            w.set(fx, y, fz, FALLING_WATER)
            y -= 1
        # splash pool where it lands
        landed = w.get(fx, y, fz)
        if landed in (GRASS, PODZOL, DIRT, STONE, MOSS):
            for ax in range(-2, 3):
                for az in range(-2, 3):
                    if ax * ax + az * az <= 5 and w.get(fx + ax, y, fz + az) in (GRASS, PODZOL, DIRT, MOSS, STONE, TUFF, ANDESITE, CALCITE):
                        if w.get(fx + ax, y + 1, fz + az) in (AIR, SHORT_GRASS, FERN):
                            w.set(fx + ax, y + 1, fz + az, AIR)
                            w.set(fx + ax, y, fz + az, WATER)
                            if rng.random() < 0.25:
                                w.set(fx + ax, y - 1, fz + az, SEA_LANTERN)
        falls += 1
    w.waterfall_count = falls

# ---------------------------------------------------------------- plants
def leaf_blob(w, cx, cy, cz, r, glow=0.0, leaf=LEAVES):
    ri = int(math.ceil(r))
    for x in range(-ri, ri + 1):
        for y in range(-1, 2):
            for z in range(-ri, ri + 1):
                rr = r - (1 if y == 1 else 0)
                if x * x + z * z <= rr * rr + w.rng.uniform(-1, 1):
                    v = w.rng.choice((SEA_LANTERN, PEARL_FROG, SHROOMLIGHT)) if w.rng.random() < glow else leaf
                    w.set(cx + x, cy + y, cz + z, v, only_air=True)

def jungle_tree(w, x, y, z, height, thick=1, glow=0.0):
    rng = w.rng
    for k in range(height):
        for a in range(thick):
            for c in range(thick):
                cur = w.get(x + a, y + k, z + c)
                if cur not in (AIR, LEAVES, SHORT_GRASS, FERN):
                    return
                w.set(x + a, y + k, z + c, LOG)
    top = y + height
    mid = thick / 2
    leaf_blob(w, int(x + mid), top, int(z + mid), 2.5 + thick * 1.3, glow)
    leaf_blob(w, int(x + mid), top - 2, int(z + mid), 3.2 + thick * 1.5, glow)
    if thick >= 2:   # side branches with their own leaf clumps
        for _ in range(rng.randint(2, 4)):
            by = y + int(height * rng.uniform(0.55, 0.85))
            ang = rng.uniform(0, 2 * math.pi)
            L = rng.randint(3, 4 + thick * 2)
            bx = bz = 0
            for s in range(1, L + 1):
                bx, bz = int(round(math.cos(ang) * s + mid)), int(round(math.sin(ang) * s + mid))
                w.set(x + bx, by + s // 3, z + bz, LOG, only_air=True)
            leaf_blob(w, x + bx, by + L // 3 + 1, z + bz, 2.5 + thick * 0.5, glow)
    # vines climbing the trunk
    for k in range(1, height - 2):
        for (dx, dz, bit) in ((-1, 0, 8), (thick, 0, 2), (0, -1, 1), (0, thick, 4)):
            if rng.random() < 0.18:
                w.set(x + dx, y + k, z + dz, VINES[bit], only_air=True)

def bush(w, x, y, z):
    w.set(x, y, z, LOG, only_air=True)
    leaf = AZALEA_FLOWER_LEAVES if w.rng.random() < 0.35 else LEAVES
    leaf_blob(w, x, y, z, 1.8, leaf=leaf)

def hang_down(w, x, y, z, length, glow=True):
    """Glow-berry vine (or hanging roots) hanging from the block above (x, y+1, z)."""
    placed = 0
    for k in range(length):
        if w.get(x, y - k, z) != AIR or w.get(x, y - k - 1, z) not in (AIR,):
            break
        w.set(x, y - k, z, CAVE_VINE_BERRIES if (glow and w.rng.random() < 0.12) else CAVE_VINE)
        placed += 1
    if placed:
        tip_y = y - placed + 1
        w.set(x, tip_y, z, CAVE_VINE_TIP_BERRIES if glow and w.rng.random() < 0.35 else CAVE_VINE)
    return placed

def great_tree(w, x, z):
    """One giant glowing tree in a clearing on the jungle floor."""
    y = int(w.ground[x + HALF, z + HALF]) + 1
    for a in range(-6, 10):
        for c in range(-6, 10):
            for k in range(0, 50):
                if w.get(x + a, y + k, z + c) in (LEAVES, LOG, AZALEA_FLOWER_LEAVES):
                    w.set(x + a, y + k, z + c, AIR)
    # flared root base
    for a in range(-3, 7):
        for c in range(-3, 7):
            d = math.hypot(a - 1.5, c - 1.5)
            for k in range(0, max(0, int(6 - d * 1.4))):
                w.set(x + a, y + k, z + c, ROOTS if d > 2.5 else LOG)
    for k in range(38):
        for a in range(4):
            for c in range(4):
                w.set(x + a, y + k, z + c, LOG)
    rng = w.rng
    for layer, (ly, r) in enumerate([(30, 12), (36, 10), (40, 7)]):
        leaf_blob(w, x + 2, y + ly, z + 2, r, glow=0.03)
        for _ in range(int(r * 6)):
            ang, rad = rng.uniform(0, 2 * math.pi), rng.uniform(1, r)
            hx, hz = int(x + 2 + math.cos(ang) * rad), int(z + 2 + math.sin(ang) * rad)
            hang_down(w, hx, y + ly - 2, hz, rng.randint(6, 26), glow=True)
    for _ in range(14):
        ang, rad = rng.uniform(0, 2 * math.pi), rng.uniform(3, 11)
        w.set(int(x + 2 + math.cos(ang) * rad), y + 30 + rng.randint(-1, 1), int(z + 2 + math.sin(ang) * rad), PEARL_FROG)
    # glowing ring around the base
    for i in range(24):
        ang = i / 24 * 2 * math.pi
        gx, gz = int(x + 2 + math.cos(ang) * 9), int(z + 2 + math.sin(ang) * 9)
        gy = w.top(gx, gz, y + 4)
        if gy is not None and w.get(gx, gy, gz) in (GRASS, PODZOL):
            w.set(gx, gy, gz, VERDANT_FROG if i % 2 else PEARL_FROG)
    w.great_tree = (x + 2, y, z + 2)

def plant_surfaces(w):
    rng = w.rng
    b = w.b
    grass = (b == GRASS) | (b == PODZOL)
    air_above = np.zeros_like(grass); air_above[:, :-1, :] = b[:, 1:, :] == AIR
    spots = np.argwhere(grass & air_above)
    spots = [tuple(s) for s in spots]
    rng.shuffle(spots)
    xs = np.arange(-HALF, HALF)
    GX, GZ = np.meshgrid(xs, xs, indexing="ij")
    glowfloor = (fbm2(GX, GZ, 14, w.seed + 43) > 0.28) & (np.random.default_rng(w.seed).random((SIZE, SIZE)) < 0.6)
    trees = 0
    for (i, j, k) in spots:
        x, y, z = i - HALF, j + MIN_Y + 1, k - HALF
        if w.get(x, y, z) != AIR:
            continue
        on_ground = y <= FLAT_SURFACE + 20 and j + MIN_Y <= w.ground[i, k] + 0
        r = rng.random()
        if r < (0.007 if on_ground else 0.005):
            h = rng.randint(6, 12)
            thick = 2 if rng.random() < (0.25 if on_ground else 0.12) else 1
            if thick == 2:
                h = rng.randint(14, 24 if on_ground else 18)
            jungle_tree(w, x, y, z, h, thick, glow=0.015)
            trees += 1
        elif r < 0.03:
            bush(w, x, y, z)
        elif r < 0.034:
            w.set(x, y - 1, z, VERDANT_FROG if rng.random() < 0.5 else PEARL_FROG)
            w.set(x, y, z, FERN)
        elif r < 0.30:
            w.set(x, y, z, rng.choice([SHORT_GRASS, SHORT_GRASS, FERN]))
        elif r < 0.40 and w.get(x, y + 1, z) == AIR:
            lo, hi = rng.choice([TALL_GRASS, LARGE_FERN])
            w.set(x, y, z, lo); w.set(x, y + 1, z, hi)
        elif r < 0.43:
            w.set(x, y, z, rng.choice([BLUE_ORCHID, ALLIUM, ALLIUM]))
        elif r < 0.46:
            w.set(x, y, z, MOSS_CARPET)
        elif glowfloor[i, k]:
            w.set(x, y, z, LICHEN_FLOOR)
    w.tree_count = trees
    # sea pickles glowing in shallow lake water
    for i in range(0, SIZE):
        for k in range(0, SIZE):
            g = w.ground[i, k]
            if g < FLAT_SURFACE - 1 and rng.random() < 0.02:
                w.set(i - HALF, g + 1, k - HALF, SEA_PICKLE)

def drape_islands(w):
    """Vines down the sides; glow-berry vines, spore blossoms and lights underneath."""
    rng = w.rng
    b = w.b
    band = np.zeros(H, bool); band[(FLAT_SURFACE + 6) - MIN_Y:] = True
    rocky = np.isin(b, list(ROCKY))
    air = b == AIR
    # --- side vines
    bits = np.zeros(b.shape, np.uint8)
    bits[:, :, :-1] |= np.where(rocky[:, :, 1:], 1, 0).astype(np.uint8)    # solid to the south (+z)
    bits[1:, :, :] |= np.where(rocky[:-1, :, :], 2, 0).astype(np.uint8)    # solid to the west (-x)
    bits[:, :, 1:] |= np.where(rocky[:, :, :-1], 4, 0).astype(np.uint8)    # solid to the north (-z)
    bits[:-1, :, :] |= np.where(rocky[1:, :, :], 8, 0).astype(np.uint8)    # solid to the east (+x)
    cand = air & (bits > 0) & band[None, :, None]
    idx = np.argwhere(cand)
    X, Y, Z = idx[:, 0] - HALF, idx[:, 1] + MIN_Y, idx[:, 2] - HALF
    dens = fbm3(X, Y * 0.3, Z, 12, w.seed + 40)
    lich = fbm3(X, Y, Z, 7, w.seed + 41)
    # glowing lichen patches on bare cliff faces (one face per block keeps it simple)
    single = {1: 1, 2: 2, 4: 4, 8: 8}
    bv = bits[idx[:, 0], idx[:, 1], idx[:, 2]]
    lmask = (lich > 0.18) & (dens <= 0.25) & np.isin(bv, list(single))
    li = idx[lmask]
    b[li[:, 0], li[:, 1], li[:, 2]] = np.array([LICHEN_SIDE.get(int(v), AIR) for v in range(16)], np.uint8)[bv[lmask]]
    keep = dens > 0.25
    idx = idx[keep]
    vt = np.array(VINES, dtype=np.uint8)
    b[idx[:, 0], idx[:, 1], idx[:, 2]] = vt[bits[idx[:, 0], idx[:, 1], idx[:, 2]]]
    vines = 0
    vine_ids = set(VINES[1:])
    for (i, j, k) in idx:
        if j > 0 and b[i, j - 1, k] == AIR and rng.random() < 0.35:
            v = b[i, j, k]
            for d in range(1, rng.randint(2, 10)):
                if j - d <= 0 or b[i, j - d, k] != AIR:
                    break
                b[i, j - d, k] = v
        vines += 1
    # --- undersides
    air = b == AIR
    under = np.zeros_like(air)
    under[:, :-1, :] = air[:, :-1, :] & rocky[:, 1:, :]
    under &= band[None, :, None]
    spots = np.argwhere(under)
    sx_, sy_, sz_ = spots[:, 0] - HALF, spots[:, 1] + MIN_Y, spots[:, 2] - HALF
    ceil_patch = fbm3(sx_, sy_, sz_, 6, w.seed + 42) > 0.0
    hangs = 0
    for n, (i, j, k) in enumerate(spots):
        x, y, z = i - HALF, j + MIN_Y, k - HALF
        r = rng.random()
        if r < 0.035:
            long = rng.random() < 0.08
            hang_down(w, x, y, z, rng.randint(40, 140) if long else rng.randint(3, 22), glow=True)
            hangs += 1
        elif r < 0.05:
            w.set(x, y, z, SPORE_BLOSSOM)
        elif r < 0.065:
            w.set(x, y, z, HANGING_ROOTS)
        elif r < 0.075:
            w.set(x, y + 1, z, SEA_LANTERN)
        elif r < 0.083:
            w.set(x, y + 1, z, PEARL_FROG)
        elif r < 0.086:
            w.set(x, y + 1, z, SHROOMLIGHT)
        elif ceil_patch[n]:
            w.set(x, y, z, LICHEN_CEILING)
    w.vine_count, w.hang_count = vines, hangs

def settle(w):
    """Remove anything left hanging or floating by later edits, top to bottom."""
    b = w.b
    solid_ids = np.array(sorted(SOLID | {LEAVES, AZALEA_FLOWER_LEAVES}), np.uint8)
    hang = np.array([CAVE_VINE, CAVE_VINE_BERRIES, CAVE_VINE_TIP_BERRIES], np.uint8)
    vine_bits = np.zeros(256, np.uint8)
    for i, v in enumerate(VINES):
        if i: vine_bits[v] = i
    vt = np.array(VINES, np.uint8)
    removed = 0
    for j in range(H - 2, -1, -1):
        layer, up = b[:, j, :], b[:, j + 1, :]
        up_solid = np.isin(up, solid_ids)
        # hanging plants need something above
        loose = np.isin(layer, hang) & ~(up_solid | np.isin(up, hang))
        loose |= np.isin(layer, [SPORE_BLOSSOM, HANGING_ROOTS, LICHEN_CEILING]) & ~up_solid
        # vines keep only the faces that are still held up
        vb = vine_bits[layer]
        if vb.any():
            s_ = np.isin(layer, solid_ids)
            sol = np.isin(b[:, j, :], solid_ids)
            held = np.zeros_like(vb)
            held[:, :-1] |= np.where(sol[:, 1:], 1, 0).astype(np.uint8)
            held[1:, :] |= np.where(sol[:-1, :], 2, 0).astype(np.uint8)
            held[:, 1:] |= np.where(sol[:, :-1], 4, 0).astype(np.uint8)
            held[:-1, :] |= np.where(sol[1:, :], 8, 0).astype(np.uint8)
            held |= vine_bits[up]
            nb = vb & held
            changed = (vb > 0) & (nb != vb)
            removed += int(changed.sum())
            layer[changed] = vt[nb[changed]]
        removed += int(loose.sum())
        layer[loose] = AIR
    # things that sit on the ground
    soil = np.isin(b, [GRASS, PODZOL, MOSS, DIRT, VERDANT_FROG, PEARL_FROG])
    below = np.zeros_like(b); below[:, 1:, :] = b[:, :-1, :]
    plants = [SHORT_GRASS, FERN, BLUE_ORCHID, ALLIUM, TALL_GRASS[0], LARGE_FERN[0], MOSS_CARPET]
    loose = np.isin(b, plants) & ~np.isin(below, [GRASS, PODZOL, MOSS, DIRT, VERDANT_FROG, PEARL_FROG])
    loose |= (b == LICHEN_FLOOR) & ~np.isin(below, solid_ids)
    b[loose] = AIR
    removed += int(loose.sum())
    for lo, hi in (TALL_GRASS, LARGE_FERN):
        below = np.zeros_like(b); below[:, 1:, :] = b[:, :-1, :]
        above = np.zeros_like(b); above[:, :-1, :] = b[:, 1:, :]
        b[(b == hi) & (below != lo)] = AIR
        b[(b == lo) & (above != hi)] = AIR
    return removed

# ---------------------------------------------------------------- spawn
def make_spawn(w):
    y = w.top(0, 0, 90)
    # clear a little glade
    for a in range(-3, 4):
        for c in range(-3, 4):
            t = w.top(a, c, 90)
            for k in range(t + 1, t + 12):
                if w.get(a, k, c) not in (AIR,):
                    w.set(a, k, c, AIR)
    y = max(yy for yy in range(MIN_Y, 90) if w.get(0, yy, 0) in SOLID)
    for k in range(y + 1, y + 4):
        w.set(0, k, 0, AIR)
    w.spawn = (0, y + 1, 0)
    cy = max(yy for yy in range(MIN_Y, 90) if w.get(2, yy, 0) in SOLID) + 1
    w.set(2, cy + 1, 0, AIR)
    w.set(2, cy, 0, CHEST)
    w.set(2, cy - 1, 2, PEARL_FROG)
    w.block_entities.append((2, cy, 0, chest_nbt(2, cy, 0)))

# ---------------------------------------------------------------- NBT (little-endian)
def _s(t):
    b = t.encode("utf-8"); return struct.pack("<H", len(b)) + b

class T:  # typed NBT values
    def __init__(self, kind, v): self.kind, self.v = kind, v
def B(v): return T(1, v)
def S(v): return T(2, v)
def I(v): return T(3, v)
def L(v): return T(4, v)
def F(v): return T(5, v)
def STR(v): return T(8, v)
def LST(kind, items): return T(9, (kind, items))
def C(d): return T(10, d)

def _payload(t):
    k, v = t.kind, t.v
    if k == 1: return struct.pack("<b", int(v))
    if k == 2: return struct.pack("<h", v)
    if k == 3: return struct.pack("<i", v)
    if k == 4: return struct.pack("<q", v)
    if k == 5: return struct.pack("<f", v)
    if k == 8: return _s(v)
    if k == 9:
        ek, items = v
        return bytes([ek]) + struct.pack("<i", len(items)) + b"".join(_payload(i) for i in items)
    if k == 10:
        return b"".join(bytes([c.kind]) + _s(n) + _payload(c) for n, c in v.items()) + b"\x00"
    raise ValueError(k)

def nbt(d):
    return b"\x0a" + _s("") + _payload(C(d))

def _auto(v):
    if isinstance(v, bool): return B(v)
    if isinstance(v, int): return I(v)
    return STR(v)

def block_state_nbt(name, states):
    return nbt({"name": STR(name), "states": C({k: _auto(v) for k, v in states.items()}), "version": I(BLOCK_VERSION)})

def chest_nbt(x, y, z):
    def item(slot, name, count, tag=None):
        d = {"Count": B(count), "Damage": S(0), "Name": STR(name), "Slot": B(slot), "WasPickedUp": B(0)}
        if tag: d["tag"] = C(tag)
        return C(d)
    rockets = {"Fireworks": C({"Explosions": LST(10, []), "Flight": B(1)})}
    items = [item(0, "minecraft:elytra", 1), item(1, "minecraft:firework_rocket", 64, rockets),
             item(2, "minecraft:firework_rocket", 64, rockets), item(3, "minecraft:cooked_beef", 16),
             item(4, "minecraft:spyglass", 1), item(5, "minecraft:glow_berries", 16)]
    return nbt({"Findable": B(0), "Items": LST(10, items), "id": STR("Chest"), "isMovable": B(1),
                "x": I(x), "y": I(y), "z": I(z)})

# ---------------------------------------------------------------- chunk encoding
def encode_storage(blocks_xzy, palette_nbt_of):
    """blocks_xzy: 4096 local palette indices in Bedrock order (x, z, y)."""
    uniq, local = np.unique(blocks_xzy, return_inverse=True)
    n = len(uniq)
    bits = next(bb for bb in (1, 2, 3, 4, 5, 6, 8, 16) if (1 << bb) >= n)
    per = 32 // bits
    words = -(-4096 // per)
    padded = np.zeros(words * per, np.uint32); padded[:4096] = local
    padded = padded.reshape(words, per)
    shifts = (np.arange(per, dtype=np.uint32) * bits)
    packed = np.bitwise_or.reduce(padded << shifts, axis=1).astype("<u4")
    out = bytes([bits << 1]) + packed.tobytes() + struct.pack("<i", n)
    out += b"".join(palette_nbt_of[int(u)] for u in uniq)
    return out

def chunk_records(w, cx, cz, palette_nbt):
    """Yields (key_suffix, value) LevelDB records for one chunk at chunk coords cx, cz."""
    i0, k0 = cx * 16 + HALF, cz * 16 + HALF
    col = w.b[i0:i0 + 16, :, k0:k0 + 16]           # x, y, z
    base = struct.pack("<ii", cx, cz)
    yield base + bytes([0x2C]), bytes([CHUNK_VERSION])
    for sy in range(H // 16):
        sub = col[:, sy * 16:(sy + 1) * 16, :]
        if not sub.any():
            continue
        xzy = sub.transpose(0, 2, 1).reshape(-1)    # index = x*256 + z*16 + y
        y_index = sy + MIN_Y // 16
        val = bytes([9, 1, y_index & 0xFF]) + encode_storage(xzy, palette_nbt)
        yield base + bytes([0x2F, y_index & 0xFF]), val
    # Data3D: heightmap then one biome storage per subchunk from -64 up (25 like the game writes)
    nz = col != AIR
    top = np.where(nz.any(axis=1), H - np.argmax(nz[:, ::-1, :], axis=1), 0)  # [x, z]
    hm = top.T.reshape(-1).astype("<i2")   # index z*16 + x
    biomes = b""
    for s in range(25):
        biomes += bytes([(0 << 1) | 1]) + struct.pack("<i", JUNGLE_BIOME)
    yield base + bytes([0x2B]), hm.tobytes() + biomes
    yield base + bytes([0x36]), struct.pack("<i", 2)       # finalized: don't generate here
    bes = [nb for (x, y, z, nb) in w.block_entities if (x + HALF) // 16 == cx + HALF // 16 and (z + HALF) // 16 == cz + HALF // 16]
    if bes:
        yield base + bytes([0x31]), b"".join(bes)

# ---------------------------------------------------------------- level.dat
FLAT_LAYERS = json.dumps({
    "biome_id": JUNGLE_BIOME,
    "block_layers": [{"block_name": "minecraft:bedrock", "count": 1}, {"block_name": "minecraft:dirt", "count": 2},
                     {"block_name": "minecraft:grass_block", "count": 1}],
    "encoding_version": 6, "structure_options": None, "world_version": "version.post_1_18"},
    separators=(",", ":"))

def level_dat(w):
    sx, sy, sz = w.spawn
    v = list(GAME_VERSION)
    now = int(time.time())
    on, off = B(1), B(0)
    d = {
        "LevelName": STR(WORLD_NAME), "BiomeOverride": STR(""), "FlatWorldLayers": STR(FLAT_LAYERS),
        "baseGameVersion": STR("*"), "InventoryVersion": STR("%d.%d.%d" % tuple(v[:3])), "prid": STR(""),
        "GameType": I(0), "Generator": I(2), "Difficulty": I(1), "NetherScale": I(8), "NetworkVersion": I(776),
        "Platform": I(2), "PlatformBroadcastIntent": I(3), "XBLBroadcastIntent": I(3),
        "SpawnX": I(sx), "SpawnY": I(sy), "SpawnZ": I(sz), "StorageVersion": I(10), "WorldVersion": I(1),
        "eduOffer": I(0), "functioncommandlimit": I(10000), "limitedWorldDepth": I(16), "limitedWorldWidth": I(16),
        "LimitedWorldOriginX": I(sx), "LimitedWorldOriginY": I(sy), "LimitedWorldOriginZ": I(sz),
        "maxcommandchainlength": I(65535), "serverChunkTickRange": I(4), "spawnradius": I(0),
        "permissionsLevel": I(0), "playerPermissionsLevel": I(1), "randomtickspeed": I(1), "editorWorldType": I(0),
        "lightningTime": I(100000), "rainTime": I(100000), "daylightCycle": I(0), "playerssleepingpercentage": I(100),
        "RandomSeed": L(w.seed), "Time": L(1000), "LastPlayed": L(now), "currentTick": L(0), "worldStartCount": L(0),
        "lightningLevel": F(0.0), "rainLevel": F(0.0),
        "lastOpenedWithVersion": LST(3, [I(x) for x in v + [0]]),
        "MinimumCompatibleClientVersion": LST(3, [I(x) for x in v[:3] + [0, 0]]),
        "abilities": C({"attackmobs": on, "attackplayers": on, "build": on, "doorsandswitches": on, "flying": off,
                        "instabuild": off, "invulnerable": off, "lightning": off, "mayfly": off, "mine": on,
                        "op": off, "opencontainers": on, "teleport": off, "flySpeed": F(0.05), "walkSpeed": F(0.1),
                        "verticalFlySpeed": F(1.0)}),
        "experiments": C({"experiments_ever_used": off, "saved_with_toggled_experiments": off}),
    }
    for k in ["CenterMapsToOrigin", "ConfirmedPlatformLockedContent", "ForceGameType", "HasUncompleteWorldFileOnDisk",
              "SpawnV1Villagers", "bonusChestEnabled", "bonusChestSpawned", "cheatsEnabled", "commandsEnabled",
              "doimmediaterespawn", "educationFeaturesEnabled", "falldamage", "hasBeenLoadedInCreative",
              "hasLockedBehaviorPack", "hasLockedResourcePack", "immutableWorld", "isFromLockedTemplate",
              "isFromWorldTemplate", "isSingleUseWorld", "isWorldTemplateOptionLocked", "requiresCopiedPackRemovalCheck",
              "startWithMapEnabled", "texturePacksRequired", "useMsaGamertagsOnly", "isHardcore", "dolimitedcrafting",
              "isCreatedInEditor", "isExportedFromEditor", "isRandomSeedAllowed", "showdaysplayed"]:
        d[k] = off
    for k in ["LANBroadcast", "LANBroadcastIntent", "MultiplayerGame", "MultiplayerGameIntent", "commandblockoutput",
              "commandblocksenabled", "dodaylightcycle", "doentitydrops", "dofiretick", "doinsomnia", "domobloot",
              "domobspawning", "dotiledrops", "doweathercycle", "drowningdamage", "firedamage", "freezedamage",
              "keepinventory", "mobgriefing", "naturalregeneration", "pvp", "sendcommandfeedback", "showcoordinates",
              "showdeathmessages", "showtags", "spawnMobs", "tntexplodes", "showbordereffect", "respawnblocksexplode",
              "recipesunlock", "projectilescanbreakblocks", "showrecipemessages", "tntexplosiondropdecay"]:
        d[k] = on
    body = nbt(d)
    return struct.pack("<ii", 10, len(body)) + body

# ---------------------------------------------------------------- previews
COLORS = {}
def _color_table():
    c = {GRASS: (86, 150, 60), PODZOL: (110, 80, 40), DIRT: (120, 85, 55), MUD: (60, 55, 60), STONE: (125, 125, 125),
         ANDESITE: (135, 135, 132), TUFF: (105, 108, 100), CALCITE: (215, 215, 205), MOSSY_COBBLE: (95, 115, 85),
         MOSS: (90, 125, 50), WATER: (50, 90, 200), FALLING_WATER: (120, 170, 240), LOG: (90, 70, 40),
         LOG_X: (90, 70, 40), LOG_Z: (90, 70, 40), LEAVES: (40, 120, 30), AZALEA_FLOWER_LEAVES: (150, 110, 170),
         ROOTS: (80, 60, 45), BEDROCK: (40, 40, 40), SHROOMLIGHT: (255, 170, 80), SEA_LANTERN: (190, 240, 240),
         PEARL_FROG: (240, 190, 240), VERDANT_FROG: (190, 255, 170), SPORE_BLOSSOM: (230, 120, 200),
         CAVE_VINE: (70, 120, 40), CAVE_VINE_BERRIES: (255, 170, 60), CAVE_VINE_TIP_BERRIES: (255, 170, 60),
         CHEST: (160, 110, 40), HANGING_ROOTS: (140, 100, 80), SEA_PICKLE: (150, 230, 120), MOSS_CARPET: (90, 125, 50),
         BLUE_ORCHID: (60, 160, 230), ALLIUM: (180, 100, 220)}
    for v in VINES[1:]: c[v] = (50, 110, 35)
    for v in [LICHEN_FLOOR, LICHEN_CEILING] + list(LICHEN_SIDE.values()): c[v] = (120, 215, 200)
    for v in (SHORT_GRASS, FERN) + TALL_GRASS + LARGE_FERN: c[v] = (80, 150, 55)
    return c
GLOW = {LICHEN_FLOOR, LICHEN_CEILING, *LICHEN_SIDE.values(), SHROOMLIGHT, SEA_LANTERN, PEARL_FROG, VERDANT_FROG, CAVE_VINE_BERRIES, CAVE_VINE_TIP_BERRIES, SEA_PICKLE, SPORE_BLOSSOM}

def render(w, path, night=False, sc=3):
    from PIL import Image
    ct = _color_table()
    lut = np.zeros((256, 3), np.float32)
    for k, v in ct.items(): lut[k] = v
    b = w.b
    solid = b != AIR
    exposed = solid.copy()
    nb = np.zeros_like(solid)
    nb[:, :-1, :] |= ~solid[:, 1:, :]; nb[:-1, :, :] |= ~solid[1:, :, :]; nb[:, :, :-1] |= ~solid[:, :, 1:]
    exposed &= nb
    idx = np.argwhere(exposed)
    i, j, k = idx[:, 0], idx[:, 1], idx[:, 2]
    # isometric view from the south-east corner
    sx = ((i - k) + SIZE) * sc
    sy = ((i + k) / 2 - j * 1.2) * sc
    sy = (sy - sy.min()).astype(int)
    depth = i + k + j * 0.01
    order = np.argsort(depth)
    sx, sy, i, j, k = sx[order], sy[order], i[order], j[order], k[order]
    blocks = b[i, j, k]
    col = lut[blocks].copy()
    top_open = np.zeros(len(i), bool)
    up = j + 1 < H
    top_open[up] = b[i[up], j[up] + 1, k[up]] == AIR
    col *= np.where(top_open, 1.0, 0.72)[:, None]
    if night:
        g = np.isin(blocks, list(GLOW))
        col = np.where(g[:, None], col * 1.1, col * np.array([0.13, 0.16, 0.30]))
    Wd, Hd = SIZE * 2 * sc + 2 * sc, int(sy.max()) + 2 * sc
    img = np.zeros((Hd, Wd, 3), np.float32)
    img[:] = (10, 14, 40) if night else (160, 205, 245)
    for ox in range(sc):
        for oy in range(sc):
            img[sy + oy, sx + ox] = col
    if night:   # soft glow bloom
        from PIL import ImageFilter
        glow_img = np.zeros_like(img)
        g = np.isin(blocks, list(GLOW))
        for ox in range(sc):
            for oy in range(sc):
                glow_img[sy[g] + oy, sx[g] + ox] = col[g]
        blur = np.asarray(Image.fromarray(np.clip(glow_img, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4 * sc)), np.float32)
        img = img + blur * 1.6
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(path)

# ---------------------------------------------------------------- write
def write_world(w, out_dir, preview_day):
    import plyvel
    tmp = tempfile.mkdtemp()
    dbdir = os.path.join(tmp, "db")
    db = plyvel.DB(dbdir, create_if_missing=True, compression=None)
    palette_nbt = {i: block_state_nbt(n, s) for i, (n, s) in enumerate(PALETTE)}
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
    im = Image.open(preview_day).convert("RGB")
    im.thumbnail((800, 450))
    im.save(os.path.join(tmp, "world_icon.jpeg"), quality=88)
    out = os.path.join(out_dir, "FloatingIslands.mcworld")
    if os.path.exists(out): os.remove(out)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(tmp):
            for fn in files:
                p = os.path.join(root, fn)
                z.write(p, os.path.relpath(p, tmp))
    shutil.rmtree(tmp)
    return out, n_chunks

def generate(seed):
    w = World(seed)
    t0 = time.time()
    build_ground(w)
    make_islands(w)
    paint_rock(w)
    make_waterfalls(w)
    make_bridges(w)
    great_tree(w, -70, 60)
    plant_surfaces(w)
    drape_islands(w)
    make_spawn(w)
    w.settled = settle(w)
    w.build_seconds = time.time() - t0
    return w

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20261111)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "dist"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    w = generate(a.seed)
    day = os.path.join(a.out, "floating_preview_day.png")
    render(w, day)
    render(w, os.path.join(a.out, "floating_preview_night.png"), night=True)
    out, n = write_world(w, a.out, day)
    print(f"{len(w.islands)} islands, {len(w.towers)} towers, {w.bridge_count} bridges, {w.waterfall_count} waterfalls, "
          f"{w.tree_count} trees, {w.hang_count} hanging glow vines; spawn {w.spawn}; {n} chunks")
    print(f"Wrote {out} ({os.path.getsize(out) // 1024} KB) in {w.build_seconds:.0f}s")

if __name__ == "__main__":
    main()
