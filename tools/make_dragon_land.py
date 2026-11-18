"""Dragon Land: the new region for Chapter 2 of the Princess Kingdom story ("The Dragon's Wing").

It lies just south of the spawn, outside the old built area (game x -192..192, z 144..464), so it can be added to a
world that is already being played without touching anything built in the kingdom (see tools/update_world.py).

  - The Crash Site: a scorched crater about 100 blocks south of the spawn where the dragon lies, with a skid mark
    leading in, knocked-down trees, scattered stones, and a path from the end of the princess road.
  - The old wheat field west of the crater (water down the middle, a little shed with a chest and a crafting
    table): wheat for the dragon's nest of hay bales.
  - The mine head on the crater's east rim: a timber frame over a staircase 30 blocks down to
  - the Miner's Station: a lantern-lit hall with Pebble's counter, a furnace, a crafting table and a chest, iron ore
    in the walls, and the start of the mine railway. 12 rails are missing just past the platform (the rockslide);
    after that the line runs east and down through a tunnel (powered rails on every slope, so it climbs back up
    too) and turns south to the Crystal Caverns stop, where a magic wall closes the caverns for now.
    A button by the cart at each end starts the ride.
  - The Crystal Caverns, behind the magic door (the script opens it when you first arrive): a dark entry hall, a
    chasm with a narrow two-wide bridge (water at the bottom, steps out of it), and a big geode (smooth basalt,
    calcite, amethyst, budding amethyst) with 24 crystal clusters. No lights: torches are the lesson.

Writes addons/KingdomQuest_BP/scripts/dragon_data.js (where the story spots are, in game coordinates).

Built with the castle generator's World/View helpers: make_princess_world's bounds are swapped for this region's
while it is generated and written (see `bounds()`), so the same code writes its chunks.

Usage: python3 tools/make_dragon_land.py [--preview out.png]     (make_princess_world.py builds it into new worlds)
"""
import contextlib, json, math, os, random, struct, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_princess_world as pw
from make_princess_world import blk, AIR

RX0, RX1, RZ0, RZ1 = -192, 192, 144, 464          # the region (game x and z; multiples of 16)
G = pw.GROUND                                      # grass height in generator coordinates (game y 35)
Y_OFF = pw.Y_OFF

@contextlib.contextmanager
def bounds():
    """Point make_princess_world's World/View/chunk code at this region while inside the block."""
    saved = pw.X0, pw.X1, pw.Z0, pw.Z1, pw.SX, pw.SZ
    pw.X0, pw.X1, pw.Z0, pw.Z1 = RX0, RX1, RZ0, RZ1
    pw.SX, pw.SZ = RX1 - RX0, RZ1 - RZ0
    try:
        yield
    finally:
        pw.X0, pw.X1, pw.Z0, pw.Z1, pw.SX, pw.SZ = saved

# ---------------------------------------------------------------- blocks
STONE, DIRT, GRASS, DEEPSLATE, BEDROCK = pw.STONE, pw.DIRT, pw.GRASS, pw.DEEPSLATE, pw.BEDROCK
GRASS_PATH, WATER, LANTERN, HANGING_LANTERN = pw.GRASS_PATH, pw.WATER, pw.LANTERN, pw.HANGING_LANTERN
COARSE, GRAVEL, BLACKSTONE, COBBLE = pw.COARSE_DIRT, blk("gravel"), pw.BLACKSTONE, pw.COBBLESTONE
STONE_BRICKS, MOSSY_BRICKS, CRACKED_BRICKS = pw.STONE_BRICKS, pw.MOSSY_BRICKS, pw.CRACKED_BRICKS
DO_PLANKS, DO_FENCE, DO_LOG = pw.DARK_OAK_PLANKS, pw.DARK_OAK_FENCE, pw.DARK_OAK_LOG
SPRUCE_PLANKS, SPRUCE_LOG = pw.SPRUCE_PLANKS, pw.SPRUCE_LOG
OAK_LOG, OAK_LEAVES, OAK_PLANKS = pw.OAK_LOG, pw.OAK_LEAVES, blk("oak_planks")
OAK_LOG_X, OAK_LOG_Z = blk("oak_log", pillar_axis="x"), blk("oak_log", pillar_axis="z")
BIRCH_LOG, BIRCH_LEAVES = blk("birch_log", pillar_axis="y"), blk("birch_leaves", persistent_bit=True, update_bit=False)
FARMLAND, WHEAT = pw.FARMLAND, pw.WHEAT
HAY = pw.HAY
SB_STAIRS = pw.SB_STAIRS                           # weirdo_direction: 0 up to the east, 1 west, 2 south, 3 north
IRON_ORE, COAL_ORE = blk("iron_ore"), blk("coal_ore")
DS_IRON = blk("deepslate_iron_ore")
REDSTONE_BLOCK = blk("redstone_block")
RAIL = {d: blk("rail", rail_direction=d) for d in range(10)}       # 0 N-S, 1 E-W, 2-5 up to E W N S, 6 SE 7 SW 8 NW 9 NE
POWERED = {d: blk("golden_rail", rail_direction=d, rail_data_bit=True) for d in range(6)}
UNPOWERED = {d: blk("golden_rail", rail_direction=d, rail_data_bit=False) for d in range(6)}   # the ends (a button powers them)
BUTTON_UP = blk("stone_button", button_pressed_bit=False, facing_direction=1)
FURNACE = blk("furnace", **{"minecraft:cardinal_direction": "north"})
TABLE = blk("crafting_table")
MAGIC = pw.MAGIC_BARRIER
GLOW_LICHEN = pw.LICHEN_CEILING
SHORT_GRASS, FLOWERS = pw.SHORT_GRASS, pw.FLOWERS
MARKER = blk("chiseled_stone_bricks")             # under the path at the region's edge: the script checks for it
RAIL_IDS = {*RAIL.values(), *POWERED.values(), *UNPOWERED.values()}

# ---------------------------------------------------------------- where things are (game x, z; generator y)
CRATER = (0, 222)                    # middle of the crater: the dragon lies here, facing north (toward the castle)
CRATER_R = 17
FIELD = (-52, 210, -38, 230)         # the wheat field x0, z0, x1, z1
SHED = (-58, 214)                    # the field's shed (its door faces east)
HEAD = (30, 220)                     # the mine head on the crater's east rim (top of the stairs)
STAIR_X = (29, 31)                   # the staircase: 3 wide, going down south from z 224
STATION_Y = G - 30                   # station floor (game y 5)
HALL = (14, 52, 255, 276)            # the station hall x0, x1, z0, z1
LINE_Z = 272                         # the railway runs east along this z out of the station
START_X = 19                         # the cart's spot at the start (a bumper wall just west of it)
GAP = list(range(23, 35))            # the 12 missing rails
TURN_X = 120                         # where the line turns south
STOP_Z = 352                         # the Crystal Caverns stop (bumper just south of it)
CAVE_Y = STATION_Y - 18              # the line's floor at the far end (game y -13)

def surface_y(w, x, z):
    """The top solid block's y (generator coordinates)."""
    for y in range(G + 12, G - 20, -1):
        if w.get(x, y, z) not in (AIR, SHORT_GRASS, *FLOWERS, pw.TALL_GRASS[0], pw.TALL_GRASS[1]) and w.get(x, y, z) not in (OAK_LEAVES, BIRCH_LEAVES):
            return y
    return G

# ---------------------------------------------------------------- the ground
def ground(w):
    """The flat world's layers (so the region's edges meet the flat ground around it), with gentle rolls inside."""
    w.fill(RX0, RX1 - 1, pw.MIN_Y, pw.MIN_Y, RZ0, RZ1 - 1, BEDROCK)
    w.fill(RX0, RX1 - 1, pw.MIN_Y + 1, -96, RZ0, RZ1 - 1, DEEPSLATE)
    w.fill(RX0, RX1 - 1, -95, G - 4, RZ0, RZ1 - 1, STONE)
    w.fill(RX0, RX1 - 1, G - 3, G - 1, RZ0, RZ1 - 1, DIRT)
    w.fill(RX0, RX1 - 1, G, G, RZ0, RZ1 - 1, GRASS)
    xs, zs = np.meshgrid(np.arange(RX0, RX1), np.arange(RZ0, RZ1), indexing="ij")
    bump = pw.fbm2(xs.astype(float), zs.astype(float), 70.0, w.seed + 5, 3)
    edge = np.minimum.reduce([xs - RX0, RX1 - 1 - xs, zs - RZ0, RZ1 - 1 - zs]).astype(float)
    fade = np.clip((edge - 8) / 40.0, 0, 1)
    near = np.hypot(xs - CRATER[0], zs - CRATER[1])
    keep_flat = np.clip((near - 60) / 30.0, 0, 1)            # flat round the crash site, the field and the mine
    h = np.round(np.clip(bump, 0, None) * 9 * fade * keep_flat).astype(int)
    for (i, k) in np.argwhere(h > 0):
        x, z = int(i) + RX0, int(k) + RZ0
        top = G + int(h[i, k])
        w.fill(x, x, G, top - 1, z, z, DIRT)
        w.set(x, top, z, GRASS)
    w.heights = h
    # ores, sparse, as in any stone
    rng = random.Random(w.seed + 31)
    for _ in range(2600):
        x, y, z = rng.randrange(RX0, RX1), rng.randint(pw.MIN_Y + 3, G - 8), rng.randrange(RZ0, RZ1)
        kind = rng.choices(["coal", "iron", "copper", "gold", "redstone", "lapis", "diamond"], [5, 4, 2, 1.5, 1.5, 1, 0.6])[0]
        if kind in ("gold", "redstone", "lapis", "diamond") and y > -100:
            kind = "iron"
        plain, deep = pw.ORE_BLOCKS[kind]
        for _ in range(rng.randint(2, 6)):
            cur = w.get(x, y, z)
            if cur == STONE:
                w.set(x, y, z, plain)
            elif cur == DEEPSLATE:
                w.set(x, y, z, deep)
            x += rng.choice((-1, 0, 1)); y += rng.choice((-1, 0, 1)); z += rng.choice((-1, 0, 1))

def path_line(w, pts, width=1):
    """A grass path along straight segments (half-width `width`)."""
    for (ax, az), (bx, bz) in zip(pts, pts[1:]):
        n = int(max(abs(bx - ax), abs(bz - az))) * 2 + 1
        for t in np.linspace(0, 1, n):
            x, z = int(round(ax + (bx - ax) * t)), int(round(az + (bz - az) * t))
            for a in range(-width, width + 1):
                for c in range(-width, width + 1):
                    if abs(a) + abs(c) <= width + (1 if width > 1 else 0):
                        y = surface_y(w, x + a, z + c)
                        if w.get(x + a, y, z + c) in (GRASS, DIRT):
                            w.set(x + a, y, z + c, GRASS_PATH)
                            w.fill(x + a, x + a, y + 1, y + 3, z + c, z + c, AIR)
                            w.protect(x + a - 1, x + a + 1, z + c - 1, z + c + 1)

# ---------------------------------------------------------------- the crash site
def crater(w):
    cx, cz = CRATER
    rng = random.Random(w.seed + 9)
    for x in range(cx - CRATER_R - 6, cx + CRATER_R + 7):
        for z in range(cz - CRATER_R - 6, cz + CRATER_R + 7):
            d = math.hypot(x - cx, (z - cz) * 0.8)
            if d <= CRATER_R:
                depth = int(round(3.2 * (1 - (d / CRATER_R) ** 2)))
                top = G - depth
                w.fill(x, x, top + 1, G + 6, z, z, AIR)
                w.set(x, top, z, rng.choice([COARSE, COARSE, COARSE, GRAVEL, BLACKSTONE, DIRT]))
                w.set(x, top - 1, z, DIRT)
            elif d <= CRATER_R + 3:
                # a raised, scorched rim of thrown-up earth
                up = 1 if d <= CRATER_R + 1.8 else 0
                w.fill(x, x, G + 1, G + 6, z, z, AIR)
                if up:
                    w.set(x, G, z, DIRT)
                    w.set(x, G + 1, z, rng.choice([COARSE, COARSE, DIRT, GRASS]))
                else:
                    w.set(x, G, z, rng.choice([COARSE, GRASS, GRASS]))
            elif d <= CRATER_R + 6 and rng.random() < 0.35:
                w.set(x, G, z, COARSE)
            w.protect(x, x, z, z)
    # the skid mark: a long scraped trench coming in from the north
    for z in range(cz - CRATER_R - 30, cz - CRATER_R + 2):
        wobble = int(round(math.sin(z * 0.21) * 1.2))
        depth = 1 if z < cz - CRATER_R - 18 else 2
        for a in range(-2, 3):
            x = cx + wobble + a
            dd = depth - (1 if abs(a) == 2 else 0)
            if dd <= 0:
                w.set(x, G, z, COARSE)
                continue
            w.fill(x, x, G - dd + 1, G + 5, z, z, AIR)
            w.set(x, G - dd, z, rng.choice([COARSE, COARSE, GRAVEL, DIRT]))
        w.protect(cx + wobble - 4, cx + wobble + 4, z, z)
    # knocked-down trees lying round the rim, and stones thrown out
    for ang, length in ((0.6, 6), (2.0, 5), (2.9, 7), (4.1, 5), (5.3, 6)):
        r = CRATER_R + 5
        x0, z0 = int(cx + math.cos(ang) * r), int(cz + math.sin(ang) * r / 0.8)
        along_x = abs(math.cos(ang + 1.4)) > abs(math.sin(ang + 1.4))
        for k in range(length):
            x, z = (x0 + k, z0) if along_x else (x0, z0 + k)
            if HEAD[0] - 6 <= x <= HEAD[0] + 6 and HEAD[1] - 6 <= z <= HEAD[1] + 8:
                continue
            y = surface_y(w, x, z)
            w.set(x, y + 1, z, OAK_LOG_X if along_x else OAK_LOG_Z)
            if k == length - 1:
                for a, c in ((1, 0), (0, 1), (-1, 0), (0, -1), (0, 0)):
                    if w.get(x + a, y + 2, z + c) == AIR:
                        w.set(x + a, y + 2, z + c, OAK_LEAVES)
        w.protect(x0 - 3, x0 + length + 3, z0 - 3, z0 + length + 3)
    for _ in range(14):
        a = rng.uniform(0, 2 * math.pi); r = rng.uniform(CRATER_R + 3, CRATER_R + 14)
        x, z = int(cx + math.cos(a) * r), int(cz + math.sin(a) * r)
        if HEAD[0] - 6 <= x <= HEAD[0] + 6 and HEAD[1] - 6 <= z <= HEAD[1] + 8 or FIELD[0] - 8 <= x <= FIELD[2] + 2:
            continue
        y = surface_y(w, x, z)
        w.set(x, y + 1, z, rng.choice([COBBLE, BLACKSTONE, pw.MOSSY_COBBLE]))
    w.quest["dragon"] = (cx, G - 3 + 1, cz)
    w.places["crater"] = (cx, G - 2, cz + 6)

def wheat_field(w):
    x0, z0, x1, z1 = FIELD
    mid = (z0 + z1) // 2
    w.fill(x0 - 1, x1 + 1, G + 1, G + 4, z0 - 1, z1 + 1, AIR)
    w.fill(x0 - 1, x1 + 1, G, G, z0 - 1, z1 + 1, GRASS)
    for x in range(x0, x1 + 1):
        for z in range(z0, z1 + 1):
            if z == mid:
                w.set(x, G, z, WATER)
                w.set(x, G - 1, z, DIRT)
            else:
                w.set(x, G, z, FARMLAND)
                w.set(x, G + 1, z, WHEAT)
    for x in range(x0 - 1, x1 + 2):                 # a low fence round it, with a gap on each side
        for z in (z0 - 1, z1 + 1):
            if abs(x - (x0 + x1) // 2) > 1:
                w.set(x, G + 1, z, pw.OAK_FENCE)
    for z in range(z0 - 1, z1 + 2):
        for x in (x0 - 1, x1 + 1):
            if abs(z - mid) > 1:
                w.set(x, G + 1, z, pw.OAK_FENCE)
    w.protect(x0 - 3, x1 + 3, z0 - 3, z1 + 3)
    # the shed: a little hut with the chest and a crafting table, door facing east, toward the field
    sx, sz = SHED
    w.fill(sx - 3, sx + 2, G + 1, G + 5, sz - 3, sz + 3, AIR)
    w.fill(sx - 3, sx + 2, G, G, sz - 3, sz + 3, SPRUCE_PLANKS)
    for y in range(G + 1, G + 4):
        for x in range(sx - 3, sx + 3):
            for z in range(sz - 3, sz + 4):
                edge = x in (sx - 3, sx + 2) or z in (sz - 3, sz + 3)
                if edge:
                    corner = x in (sx - 3, sx + 2) and z in (sz - 3, sz + 3)
                    w.set(x, y, z, SPRUCE_LOG if corner else OAK_PLANKS)
    w.fill(sx - 3, sx + 2, G + 4, G + 4, sz - 3, sz + 3, SPRUCE_PLANKS)
    w.fill(sx + 2, sx + 2, G + 1, G + 2, sz - 1, sz + 1, AIR)            # a wide doorway
    w.set(sx - 3, G + 2, sz, pw.GLASS if hasattr(pw, "GLASS") else blk("glass"))
    w.set(sx - 1, G + 4, sz, AIR); w.set(sx - 1, G + 3, sz, HANGING_LANTERN)
    w.set(sx - 1, G + 4, sz, SPRUCE_PLANKS)
    w.set(sx - 2, G + 1, sz - 2, TABLE)
    w.chest("field shed", sx - 2, G + 1, sz + 2, FIELD_ITEMS, facing="north")
    w.set(sx - 2, G + 1, sz, HAY); w.set(sx - 2, G + 2, sz, HAY)     # a hay bale or two, to show what they look like
    w.protect(sx - 5, sx + 4, sz - 5, sz + 5)
    w.quest["field"] = ((x0 + x1) // 2, G + 1, (z0 + z1) // 2)
    w.quest["shed chest"] = (sx - 2, G + 1, sz + 2)
    w.places["field shed"] = (sx, G + 1, sz)

FIELD_ITEMS = [pw.item(0, "crafting_table", 1), pw.item(1, "bread", 8), pw.item(2, "wheat", 9), pw.item(3, "apple", 6)]
STATION_ITEMS = [pw.item(0, "stone_pickaxe", 1), pw.item(1, "stone_pickaxe", 1), pw.item(2, "coal", 16),
                 pw.item(3, "stick", 8), pw.item(4, "bread", 8)]      # (no torches: making them is quest 3's lesson)

# ---------------------------------------------------------------- the mine head and the stairs down
def mine_head(w):
    hx, hz = HEAD
    x0, x1 = STAIR_X
    top_z = hz + 4                                 # first step down
    # clear and level a pad on the rim
    w.fill(hx - 5, hx + 5, G + 1, G + 9, hz - 5, hz + 8, AIR)
    w.fill(hx - 5, hx + 5, G, G, hz - 5, hz + 8, STONE_BRICKS)
    w.fill(hx - 5, hx + 5, G - 1, G - 1, hz - 5, hz + 8, STONE)
    # the timber headframe: four posts, beams, a pulley wheel on top
    for (px, pz) in ((hx - 4, hz - 4), (hx + 4, hz - 4), (hx - 4, hz + 7), (hx + 4, hz + 7)):
        w.fill(px, px, G + 1, G + 6, pz, pz, DO_LOG)
    w.fill(hx - 4, hx + 4, G + 7, G + 7, hz - 4, hz - 4, DO_PLANKS)
    w.fill(hx - 4, hx + 4, G + 7, G + 7, hz + 7, hz + 7, DO_PLANKS)
    w.fill(hx - 4, hx - 4, G + 7, G + 7, hz - 4, hz + 7, DO_PLANKS)
    w.fill(hx + 4, hx + 4, G + 7, G + 7, hz - 4, hz + 7, DO_PLANKS)
    w.fill(hx - 1, hx + 1, G + 8, G + 8, hz, hz + 3, DO_PLANKS)
    w.fill(hx, hx, G + 9, G + 10, hz + 1, hz + 2, DO_LOG)
    w.set(hx - 4, G + 6, hz - 3, HANGING_LANTERN); w.set(hx + 4, G + 6, hz - 3, HANGING_LANTERN)
    for (px, pz) in ((hx - 3, hz - 4), (hx + 3, hz - 4)):          # lanterns either side of the way in
        pw.lamp_post(w, px, G + 1, pz, 2, DO_FENCE, LANTERN)
    # rails and a cart rusting by the entrance (just for looks), and a stone arch over the stairs
    w.fill(x0 - 1, x1 + 1, G + 1, G + 4, top_z - 1, top_z - 1, STONE_BRICKS)
    w.fill(x0, x1, G + 1, G + 3, top_z - 1, top_z - 1, AIR)
    # the staircase: down one block for each block south, 30 steps, lanterns on the wall every few steps
    for k in range(30):
        z = top_z + k
        fy = G - k                                  # the step's top block
        w.fill(x0 - 1, x1 + 1, fy - 1, fy + 5, z, z, STONE_BRICKS)
        w.fill(x0, x1, fy + 1, fy + 4, z, z, AIR)
        for x in range(x0, x1 + 1):
            w.set(x, fy, z, SB_STAIRS[3])           # up toward the north
        if k % 5 == 2:
            w.set(x0 - 1, fy + 3, z, LANTERN_WALL)
            w.set(x1 + 1, fy + 3, z, LANTERN_WALL)
    w.protect(hx - 7, hx + 7, hz - 7, hz + 10)
    w.quest["stairs top"] = (hx, G + 1, hz)
    w.places["mine head"] = (hx, G + 1, hz)
    return top_z + 30                               # the z where the stairs reach the station floor

LANTERN_WALL = None    # set in generate(): a lantern standing on a little ledge (a stone brick block sticking out)

# ---------------------------------------------------------------- the station
def station(w, stairs_end_z):
    x0, x1, z0, z1 = HALL
    fy, h = STATION_Y, 8
    rng = random.Random(w.seed + 17)
    # the hall: stone brick floor, rough stone walls with iron ore showing, a high ceiling with beams
    w.fill(x0, x1, fy + 1, fy + h, z0, z1, AIR)
    w.fill(x0, x1, fy, fy, z0, z1, STONE_BRICKS)
    for x in range(x0, x1 + 1, 6):
        w.fill(x, x, fy + h, fy + h, z0, z1, DO_PLANKS)
        for z in (z0, z1):
            w.fill(x, x, fy + 1, fy + h - 1, z, z, DO_LOG)
        w.set(x, fy + h - 1, (z0 + z1) // 2, HANGING_LANTERN)
    # the stairs come in through the north wall
    sx0, sx1 = STAIR_X
    w.fill(sx0, sx1, fy + 1, fy + 4, z0 - 1, z0 - 1, AIR)
    # iron (and some coal) in the walls, where she can reach it
    ores = 0
    for x in range(x0 - 1, x1 + 2):
        for z in range(z0 - 1, z1 + 2):
            for y in range(fy + 1, fy + 4):
                if w.get(x, y, z) not in (STONE, *[a for p in pw.ORE_BLOCKS.values() for a in p]):
                    continue
                inside = x0 <= x <= x1 and z0 <= z <= z1
                if inside:
                    continue
                if rng.random() < 0.13:
                    w.set(x, y, z, IRON_ORE); ores += 1
                elif rng.random() < 0.04:
                    w.set(x, y, z, COAL_ORE)
    w.iron_in_station = ores
    # Pebble's counter, the furnace and crafting table, the chest
    px, pz = x0 + 8, z0 + 4
    w.fill(px - 2, px + 2, fy + 1, fy + 1, pz + 1, pz + 1, SPRUCE_PLANKS)
    w.set(px - 2, fy + 2, pz + 1, LANTERN)
    w.set(px + 4, fy + 1, pz - 2, FURNACE)
    w.set(px + 5, fy + 1, pz - 2, TABLE)
    w.chest("station", px + 6, fy + 1, pz - 2, STATION_ITEMS, facing="south")
    w.fill(px - 3, px - 3, fy + 1, fy + 2, pz - 3, pz - 3, pw.BARREL)
    w.quest["pebble"] = (px, fy + 1, pz)
    w.quest["station chest"] = (px + 6, fy + 1, pz - 2)
    w.quest["furnace"] = (px + 4, fy + 1, pz - 2)
    w.places["pebble"] = (px, fy + 1, pz + 2)
    # the platform: a raised stone edge along the track, lanterns on posts
    for x in range(x0 + 2, x1 - 1):
        w.set(x, fy + 1, LINE_Z - 2, STONE_BRICKS)
    for x in range(x0 + 4, x1 - 1, 8):
        pw.lamp_post(w, x, fy + 2, LINE_Z - 2, 1, DO_FENCE, LANTERN)
    # the rubble from the rockslide, heaped by the wall where the rails were knocked off
    for x in GAP:
        if rng.random() < 0.6:
            w.set(x, fy + 1, LINE_Z + 2, rng.choice([COBBLE, GRAVEL, COBBLE]))
        if rng.random() < 0.3:
            w.set(x, fy + 2, LINE_Z + 2, COBBLE)
    return fy

def railway(w, fy):
    """The line: bumper and button at the start, the gap, then east (down three powered slopes), a turn south, and
    on to the Crystal Caverns stop. Every rail sits on a solid block; powered rails sit on redstone blocks."""
    track = []                                      # (x, y, z) of each rail, in order, rail y = floor + 1
    x0, x1, z0, z1 = HALL
    z = LINE_Z
    w.fill(START_X - 1, START_X - 1, fy + 1, fy + 2, z - 1, z + 1, STONE_BRICKS)   # the bumper wall
    y = fy + 1
    # in the hall: start (a powered rail with a button beside it), then the gap, then plain rails with boosts
    for x in range(START_X, x1 + 1):
        track.append((x, y, z))
    # the tunnel east, stepping down three times by 6
    x = x1 + 1
    plan = [("flat", 16), ("down", 6), ("flat", 14), ("down", 6), ("flat", 14), ("down", 6)]
    for kind, n in plan:
        for _ in range(n):
            if kind == "down":
                y -= 1                              # a slope rail sits in the lower block and rises to the west
                track.append((x, y, z, "down"))
            else:
                track.append((x, y, z))
            x += 1
    while x < TURN_X:
        track.append((x, y, z)); x += 1
    track.append((TURN_X, y, z, "turn"))
    for zz in range(z + 1, STOP_Z + 1):
        track.append((TURN_X, y, zz))
    end_y = y
    # carve the tunnel round the track and lay the rails
    for i, t in enumerate(track):
        tx, ty, tz = t[:3]
        if not (x0 <= tx <= x1 and z0 <= tz <= z1):
            along_x = tz == LINE_Z
            for a in (-1, 0, 1):
                for b in ((-1, 0, 1) if tx == TURN_X and tz == LINE_Z else (0,)):
                    ax, az = (tx + b, tz + a) if along_x else (tx + a, tz + b)
                    w.fill(ax, ax, ty, ty + 3, az, az, AIR)
                    w.set(ax, ty - 1, az, STONE_BRICKS)
        w.set(tx, ty - 1, tz, STONE_BRICKS)
    # rails: slopes (and the start, and a boost every 8 on the flat) are powered rails on redstone blocks
    flat_run = 0
    for i, t in enumerate(track):
        tx, ty, tz = t[:3]
        kind = t[3] if len(t) > 3 else ""
        if tx in GAP and tz == LINE_Z:
            continue                                 # the missing rails: she lays these
        along_x = tz == LINE_Z and kind != "turn"
        if kind == "turn":
            w.set(tx, ty, tz, RAIL[7])                # from the west, round to the south
            continue
        if kind == "down":
            w.set(tx, ty - 1, tz, REDSTONE_BLOCK)
            w.set(tx, ty, tz, POWERED[3])             # rising toward the west: downhill going east
            flat_run = 0
            continue
        first, last = i == 0, i == len(track) - 1
        flat_run += 1
        nxt_down = i + 1 < len(track) and len(track[i + 1]) > 3 and track[i + 1][3] == "down"
        prev_down = i > 0 and len(track[i - 1]) > 3 and track[i - 1][3] == "down"
        next_to_end = i == 1 or i == len(track) - 2       # plain, so the ends' brake rails don't get powered through it
        if first or last or (not next_to_end and (nxt_down or prev_down or flat_run % 8 == 0)):
            w.set(tx, ty - 1, tz, REDSTONE_BLOCK if not (first or last) else STONE_BRICKS)
            w.set(tx, ty, tz, UNPOWERED[1 if along_x else 0] if (first or last) else POWERED[1 if along_x else 0])
        else:
            w.set(tx, ty, tz, RAIL[1 if along_x else 0])
    # buttons by the two ends (pressing one powers the end's rail and the cart rolls off the bumper)
    sx, sy, sz = track[0][:3]
    w.set(sx, sy, sz + 1, BUTTON_UP)
    ex, ey, ez = track[-1][:3]
    w.fill(ex - 1, ex + 1, ey - 1, ey + 1, ez + 1, ez + 1, STONE_BRICKS)    # the far bumper
    w.set(ex + 1, ey, ez, BUTTON_UP)
    w.set(ex + 1, ey - 1, ez, STONE_BRICKS)
    # light the tunnel: lanterns hanging from the ceiling every 10, glowing lichen here and there
    for i, t in enumerate(track):
        tx, ty, tz = t[:3]
        if not (x0 <= tx <= x1 and z0 <= tz <= z1) and i % 10 == 5:
            w.set(tx, ty + 3, tz, HANGING_LANTERN)
            w.set(tx, ty + 4, tz, STONE_BRICKS)
    w.track = [t[:3] for t in track]
    w.quest["start"] = track[0][:3]
    w.quest["gap"] = [(x, fy + 1, LINE_Z) for x in GAP]
    w.quest["stop"] = track[-1][:3]
    return end_y

def crystal_stop(w, y):
    """The stop at the end of the line: a little platform, and the way into the Crystal Caverns closed by magic."""
    x, z = TURN_X, STOP_Z
    w.fill(x + 2, x + 8, y, y + 4, z - 8, z, AIR)
    w.fill(x + 2, x + 8, y - 1, y - 1, z - 8, z, STONE_BRICKS)
    w.fill(x + 1, x + 1, y - 1, y - 1, z - 8, z, STONE_BRICKS)
    w.fill(x + 1, x + 1, y, y + 3, z - 8, z, AIR)
    pw.lamp_post(w, x + 2, y, z - 6, 2, DO_FENCE, LANTERN)
    pw.lamp_post(w, x + 2, y, z - 1, 2, DO_FENCE, LANTERN)
    # amethyst peeking out round a magic door in the east wall: the caverns (Chapter 2, part 2)
    w.fill(x + 9, x + 9, y, y + 3, z - 6, z - 2, pw.AMETHYST)
    w.fill(x + 9, x + 9, y, y + 2, z - 5, z - 3, MAGIC)
    w.fill(x + 10, x + 14, y - 1, y + 4, z - 7, z - 1, pw.AMETHYST)
    w.fill(x + 10, x + 13, y, y + 3, z - 6, z - 2, AIR)
    w.set(x + 11, y, z - 4, pw.AMETHYST_CLUSTER)
    w.set(x + 8, y + 3, z - 4, pw.AMETHYST_CLUSTER)
    w.set(x + 1, y, z, BUTTON_UP)                 # (the platform's clearing took the far end's button: put it back)
    w.quest["crystal stop"] = (x + 3, y, z - 3)
    w.quest["crystal door"] = [(x + 9, yy, zz) for yy in range(y, y + 3) for zz in range(z - 5, z - 2)]
    w.places["crystal stop"] = (x + 3, y, z - 3)

# ---------------------------------------------------------------- the Crystal Caverns (quest 3)
CLUSTER = {f: blk("amethyst_cluster", **{"minecraft:block_face": f}) for f in ("up", "down", "north", "south", "east", "west")}
BUDDING, SMOOTH_BASALT, CALCITE = blk("budding_amethyst"), blk("smooth_basalt"), pw.CALCITE
MARKER2 = blk("chiseled_polished_blackstone")      # under the path too: Dragon Land part 2 (the caverns) is here

def crystal_caverns(w, y):
    """Behind the magic door: a dark entry hall, a chasm with a narrow stone bridge (water at the bottom: a fall
    only means a splash, with steps to climb out), and a big geode room lined with amethyst, crystal clusters on
    its floor, walls and roof. No lights: just the crystals' faint glow (torches are the lesson)."""
    rng = random.Random(w.seed + 41)
    zc = STOP_Z - 4                                       # the door's middle
    fl = y - 1                                            # floor level (the stop's platform)
    def ellipsoid(cx, cy, cz, rx, ry, rz, fill, only_y_from=None, shell=0):
        for x in range(int(cx - rx - shell) - 1, int(cx + rx + shell) + 2):
            for yy in range(int(cy - ry - shell) - 1, int(cy + ry + shell) + 2):
                for z in range(int(cz - rz - shell) - 1, int(cz + rz + shell) + 2):
                    d = ((x - cx) / (rx + shell)) ** 2 + ((yy - cy) / (ry + shell)) ** 2 + ((z - cz) / (rz + shell)) ** 2
                    wob = 0.06 * math.sin(x * 0.7 + z * 0.5 + yy)
                    if d <= 1 + wob and (only_y_from is None or yy >= only_y_from):
                        fill(x, yy, z)
    carve = lambda x, yy, z: w.set(x, yy, z, AIR)
    # the entry hall: rough stone, a little amethyst showing
    ellipsoid(139, y + 3, zc, 8, 5, 8, carve, only_y_from=y)
    for x in range(130, 147):
        for z in range(zc - 8, zc + 9):
            if w.get(x, y, z) == AIR:
                w.set(x, fl, z, rng.choice([STONE, STONE, GRAVEL]))
    w.fill(130, 133, y, y + 3, zc - 2, zc + 2, AIR)      # through the door
    w.fill(130, 133, fl, fl, zc - 2, zc + 2, STONE)
    # to the chasm: a short low passage
    w.fill(146, 150, y, y + 3, zc - 1, zc + 1, AIR)
    w.fill(146, 150, fl, fl, zc - 1, zc + 1, STONE)
    # the chasm room, and its pit: water two deep at the bottom, a bridge two wide across, steps out of the water
    ellipsoid(157, y + 3, zc, 7, 5, 7, carve, only_y_from=y)
    for x in range(150, 165):
        for z in range(zc - 7, zc + 8):
            if w.get(x, y, z) == AIR:
                w.set(x, fl, z, STONE)
    px0, px1, pz0, pz1 = 152, 161, zc - 5, zc + 5
    w.fill(px0, px1, y - 6, fl, pz0, pz1, AIR)
    w.fill(px0, px1, y - 6, y - 5, pz0, pz1, WATER)
    w.fill(px0, px1, y - 7, y - 7, pz0, pz1, STONE)
    w.fill(px0, px1, fl, fl, zc - 1, zc, STONE)           # the bridge (no rails, no walls: the scary bit)
    for k in range(4):                                    # steps up out of the water, along the east end, to the bridge
        w.fill(px1, px1, y - 7, y - 5 + k, zc + 4 - k, zc + 4 - k, STONE)
    # into the geode: a narrow crack
    w.fill(163, 168, y, y + 2, zc, zc + 1, AIR)
    w.fill(163, 168, fl, fl, zc, zc + 1, STONE)
    # the geode: smooth basalt, then calcite, then amethyst round a big hollow; a flat amethyst floor
    gx, gy, gz = 178, y + 4, zc
    ellipsoid(gx, gy, gz, 10, 7, 10, lambda a, b, c: w.set(a, b, c, SMOOTH_BASALT), shell=2.6)
    ellipsoid(gx, gy, gz, 10, 7, 10, lambda a, b, c: w.set(a, b, c, CALCITE), shell=1.6)
    ellipsoid(gx, gy, gz, 10, 7, 10, lambda a, b, c: w.set(a, b, c, BUDDING if rng.random() < 0.12 else pw.AMETHYST), shell=0.7)
    ellipsoid(gx, gy, gz, 10, 7, 10, carve, only_y_from=y)
    for x in range(gx - 11, gx + 12):
        for z in range(gz - 11, gz + 12):
            if w.get(x, y, z) == AIR:
                w.set(x, fl, z, pw.AMETHYST)
                for yy in range(fl - 3, fl):
                    if w.get(x, yy, z) == AIR:
                        w.set(x, yy, z, pw.AMETHYST)
    w.fill(163, 169, y, y + 2, zc, zc + 1, AIR)            # (the crack goes through the geode's shell)
    w.fill(167, 169, fl, fl, zc, zc + 1, CALCITE)
    # crystals: on amethyst next to the hollow, pointing into it
    clusters = []
    faces = {(0, 1, 0): "up", (0, -1, 0): "down", (0, 0, -1): "north", (0, 0, 1): "south", (1, 0, 0): "east", (-1, 0, 0): "west"}
    spots = []
    for x in range(gx - 11, gx + 12):
        for yy in range(fl, gy + 9):
            for z in range(gz - 11, gz + 12):
                if w.get(x, yy, z) not in (pw.AMETHYST, BUDDING):
                    continue
                for (a, b, c), f in faces.items():
                    if w.get(x + a, yy + b, z + c) == AIR and not (f == "up" and abs(z - gz) <= 1 and x < gx - 4):
                        spots.append((x + a, yy + b, z + c, f))
    rng.shuffle(spots)
    used = set()
    for (x, yy, z, f) in spots:
        if len(clusters) >= 22:
            break
        if any(abs(x - u[0]) + abs(yy - u[1]) + abs(z - u[2]) < 4 for u in used):
            continue
        if f == "up" and len([c for c in clusters if c[3] == "up"]) >= 10:
            continue
        w.set(x, yy, z, CLUSTER[f])
        used.add((x, yy, z))
        clusters.append((x, yy, z, f))
    # a few in the entry hall and chasm room too, so there's a glint to head for
    for (x, z) in ((141, zc + 5), (137, zc - 5), (156, zc + 6)):
        if w.get(x, y, z) == AIR and w.get(x, fl, z) != AIR:
            w.set(x, fl, z, pw.AMETHYST); w.set(x, y, z, CLUSTER["up"]); clusters.append((x, y, z, "up"))
    w.quest["clusters"] = [c[:3] for c in clusters]
    w.quest["caverns"] = (129, y - 7, gz - 14, gx + 14, gy + 10, gz + 14)
    w.quest["geode"] = (gx, y, gz)
    w.places["geode"] = (gx - 6, y, gz)
    w.places["chasm far side"] = (163, y, zc)

# ---------------------------------------------------------------- the land round about
def meadow(w):
    rng = random.Random(w.seed + 3)
    for x in range(RX0 + 1, RX1 - 1):
        for z in range(RZ0 + 1, RZ1 - 1):
            if w.no_plant[x - RX0, z - RZ0]:
                continue
            y = surface_y(w, x, z)
            if w.get(x, y, z) != GRASS or w.get(x, y + 1, z) != AIR:
                continue
            r = rng.random()
            if r < 0.006 and not w.no_plant[max(0, x - RX0 - 3):x - RX0 + 4, max(0, z - RZ0 - 3):z - RZ0 + 4].any() \
                    and RX0 + 4 < x < RX1 - 4 and RZ0 + 4 < z < RZ1 - 4:
                if rng.random() < 0.5:
                    pw.oak_tree(w, x, y + 1, z)
                else:
                    birch(w, x, y + 1, z, rng)
                w.protect(x - 3, x + 3, z - 3, z + 3)
            elif r < 0.25:
                w.set(x, y + 1, z, SHORT_GRASS)
            elif r < 0.28:
                w.set(x, y + 1, z, rng.choice(FLOWERS))

def birch(w, x, y, z, rng):
    h = rng.randint(5, 7)
    for k in range(h):
        w.set(x, y + k, z, BIRCH_LOG)
    for k in range(h - 3, h + 1):
        rr = 2.2 if k < h - 1 else 1.2
        for a in range(-2, 3):
            for c in range(-2, 3):
                if a * a + c * c <= rr * rr + rng.uniform(-0.6, 0.3):
                    w.set(x + a, y + k, z + c, BIRCH_LEAVES, only_air=True)

def paths(w):
    """From the end of the princess road (the spawn) to the crash site, the field and the mine head."""
    cx, cz = CRATER
    path_line(w, [(0, RZ0), (0, RZ0 + 14), (-3, cz - CRATER_R - 34)], 1)
    path_line(w, [(-6, cz - 14), (-20, cz - 8), (FIELD[2] + 2, (FIELD[1] + FIELD[3]) // 2)], 1)
    path_line(w, [(FIELD[0] - 1, (FIELD[1] + FIELD[3]) // 2), (SHED[0] + 3, SHED[1])], 1)
    path_line(w, [(cx + 8, cz - 12), (HEAD[0] - 1, HEAD[1] - 6)], 1)
    # lantern posts along the way in
    for z in range(RZ0 + 6, cz - CRATER_R - 30, 14):
        y = surface_y(w, 3, z)
        if w.get(3, y, z) in (GRASS, DIRT) and w.get(3, y + 1, z) in (AIR, SHORT_GRASS):
            pw.lamp_post(w, 3, y + 1, z, 2, pw.OAK_FENCE, LANTERN)
    w.set(0, G - 1, RZ0 + 2, MARKER)
    w.set(1, G - 1, RZ0 + 2, MARKER2)
    w.quest["marker"] = (0, G - 1, RZ0 + 2)

# ---------------------------------------------------------------- the story data
def trail(points, step=3):
    out, last = [], None
    for (ax, ay, az), (bx, by, bz) in zip(points, points[1:]):
        n = max(1, int(math.hypot(bx - ax, bz - az) / 0.5))
        for k in range(n + 1):
            t = k / n
            p = (ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t)
            if last is None or math.hypot(p[0] - last[0], p[2] - last[2]) >= step:
                last = p
                out.append((int(math.floor(p[0])), int(round(p[1])), int(math.floor(p[2]))))
    return out

def data_js(w):
    g = lambda p: [int(p[0]), int(p[1]) + Y_OFF, int(p[2])]
    q = w.quest
    cx, cz = CRATER
    spawn = (0, G + 1, 114)
    to_crash = [spawn, (0, G + 1, RZ0 + 14), (-3, G + 1, cz - CRATER_R - 34), (cx, G - 1, cz - CRATER_R + 2), (cx, G - 2, cz - 9)]
    to_field = [(cx - 6, G - 2, cz - 10), (-20, G + 1, cz - 8), (FIELD[2] + 2, G + 1, (FIELD[1] + FIELD[3]) // 2)]
    hx, hz = HEAD
    sx = (STAIR_X[0] + STAIR_X[1]) // 2
    to_station = [(cx + 6, G - 2, cz - 8), (cx + 8, G, cz - 12), (hx - 1, G + 1, hz - 6), (sx, G + 1, hz + 2),
                  (sx, G + 1, hz + 3), (sx, STATION_Y + 1, hz + 4 + 30), (sx, STATION_Y + 1, HALL[2] + 2),
                  (q["pebble"][0], STATION_Y + 1, q["pebble"][2] + 3)]
    data = {
        "marker": g(q["marker"]) + ["minecraft:chiseled_stone_bricks"], "startMarker": list(START_MARKER),
        "dragon": g(q["dragon"]), "dragonFacing": 180, "crater": [cx, G + Y_OFF - 2, cz], "nestR": 11,
        "field": g(q["field"]), "fieldBox": [FIELD[0], FIELD[1], FIELD[2], FIELD[3]], "shedChest": g(q["shed chest"]),
        "stairsTop": g(q["stairs top"]), "pebble": g(q["pebble"]), "pebbleFacing": 180,
        "stationChest": g(q["station chest"]), "furnace": g(q["furnace"]),
        "station": [HALL[0], STATION_Y + Y_OFF, HALL[2], HALL[1], STATION_Y + Y_OFF + 8, HALL[3]],
        "start": g(q["start"]), "gap": [g(p) for p in q["gap"]], "stop": g(q["stop"]),
        "crystalStop": g(q["crystal stop"]), "crystalDoor": [g(p) for p in q["crystal door"]],
        "caverns": [q["caverns"][0], q["caverns"][1] + Y_OFF, q["caverns"][2], q["caverns"][3], q["caverns"][4] + Y_OFF, q["caverns"][5]],
        "clusters": [g(p) for p in q["clusters"]], "geode": g(q["geode"]),
        "track": [g(p) for p in w.track],
        "trails": {"crash": [g(p) for p in trail(to_crash)], "field": [g(p) for p in trail(to_field)],
                   "station": [g(p) for p in trail(to_station, 2)]},
    }
    return ("// Written by tools/make_dragon_land.py: where Chapter 2 (The Dragon's Wing) happens, in game coordinates.\n"
            "export const DRAGON = " + json.dumps(data, separators=(",", ":")) + ";\n")

def data_path():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "addons", "KingdomQuest_BP", "scripts", "dragon_data.js")

# ---------------------------------------------------------------- build
def generate(seed=20261117):   # (REGION_SEED: the world and dragon_data.js must come from the same one)
    global LANTERN_WALL
    LANTERN_WALL = LANTERN
    with bounds():
        w = pw.World(seed)
        w.quest = {}
        for k in ("blaze_w", "spooky_w", "ice_w", "mountain_w", "knight_w"):
            setattr(w, k, np.zeros((pw.SX, pw.SZ), np.float32))
        ground(w)
        crater(w)
        wheat_field(w)
        stairs_end = mine_head(w)
        fy = station(w, stairs_end)
        end_y = railway(w, fy)
        crystal_stop(w, end_y)
        crystal_caverns(w, end_y)
        paths(w)
        meadow(w)
    return w

def chunk_coords():
    return [(cx, cz) for cx in range(RX0 // 16, RX1 // 16) for cz in range(RZ0 // 16, RZ1 // 16)]

def records(w, palette_nbt):
    """(key, value) for every chunk of the region, as make_princess_world writes them."""
    with bounds():
        for cx, cz in chunk_coords():
            for kv in pw.chunk_records(w, cx, cz, palette_nbt):
                yield kv

def write_data(w):
    with open(data_path(), "w") as f:
        f.write(data_js(w))

def render(w, path):
    orig = pw._colors
    def colors():                                    # (birch, hay, rails and the rest, for the picture)
        c = orig()
        c.update({BIRCH_LOG: (225, 225, 215), BIRCH_LEAVES: (125, 175, 85), HAY: (215, 175, 60), GRAVEL: (135, 130, 125),
                  BLACKSTONE: (45, 40, 48), OAK_LOG_X: (110, 85, 50), OAK_LOG_Z: (110, 85, 50), WHEAT: (220, 190, 80),
                  FARMLAND: (100, 70, 45), MARKER: (125, 125, 125), TABLE: (150, 110, 70)})
        return c
    pw._colors = colors
    try:
        with bounds():
            pw.render(w, path, region=(-80, 140, RZ0, 380), sc=3)
    finally:
        pw._colors = orig

def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20261117)
    ap.add_argument("--preview")
    a = ap.parse_args()
    w = generate(a.seed)
    write_data(w)
    if a.preview:
        render(w, a.preview)
    print(f"Dragon Land: {len(w.track)} rails of track, {w.iron_in_station} iron ore in the station walls, "
          f"{len(w.chests)} chests; data -> {os.path.normpath(data_path())}")


# ---------------------------------------------------------------- adding the region to a world being played
REGION_SEED = 20261117
# A world made to start at Chapter 2 (make_princess_world.py --start-chapter2) has this block under the spawn: the
# script sees it on the first visit, finishes Chapter 1 and gives Graham to the first player as her dog.
START_MARKER = (0, 20, 112, "minecraft:lodestone")          # game coordinates

def flat_default(game_y):
    """The flat world's block at this height (what the game made outside the old built area)."""
    if game_y == -64: return "minecraft:bedrock"
    if game_y <= 0: return "minecraft:deepslate"
    if game_y <= 31: return "minecraft:stone"
    if game_y <= 34: return "minecraft:dirt"
    if game_y == 35: return "minecraft:grass_block"
    return "minecraft:air"

def _palette_nbt():
    import make_floating_world as fw
    return {i: fw.nbt({"name": pw.STR(n), "states": pw.C({k: fw._auto(v) for k, v in s.items()}),
                       "version": pw.I(pw.BLOCK_VERSION)}) for i, (n, s) in enumerate(pw.PALETTE)}

def merge_into(items, w=None, report=None):
    """Put Dragon Land into a world's LevelDB contents (key -> value, changed in place). Chunks the game never made
    are written whole. In chunks it did make, a block becomes Dragon Land's only where it is still the flat world's
    own ground or air; anything built, dug or placed there is kept (as are entities and block entities)."""
    import bedrock_db as bdb
    w = w or generate(REGION_SEED)
    pal = _palette_nbt()
    air_raw = pal[AIR]
    stats = {"new": 0, "merged": 0, "kept": 0}
    ly = np.tile(np.arange(16), 256)                          # local y of each index (x, z, y order)
    with bounds():
        for cx, cz in chunk_coords():
            ours = dict(pw.chunk_records(w, cx, cz, pal))
            base = struct.pack("<ii", cx, cz)
            if (base + b"\x2c") not in items and (base + b"\x76") not in items:
                items.update(ours)
                stats["new"] += 1
                continue
            stats["merged"] += 1
            took = {}                                          # y index -> bool[4096]: Dragon Land's block went in
            for y in range(-4, 20):
                k = base + bytes([0x2F, y & 0xFF])
                ov, hv = ours.get(k), items.get(k)
                if ov is None and hv is None:
                    continue
                if ov is not None:
                    _, st = bdb.decode_subchunk(ov)
                    o_idx, o_raws = st[0][0], st[0][1]
                else:
                    o_idx, o_raws = np.zeros(4096, np.int64), [air_raw]
                if hv is not None:
                    _, hst = bdb.decode_subchunk(hv)
                    h_idx, h_raws, h_dicts = hst[0]
                    extra = [(i, r) for i, r, _ in hst[1:]]
                    names = np.array([d.get("name", "") for d in h_dicts])[h_idx]
                else:
                    h_idx, h_raws, extra = np.zeros(4096, np.int64), [air_raw], []
                    names = np.full(4096, "minecraft:air")
                defaults = np.array([flat_default(y * 16 + v) for v in range(16)])[ly]
                # (ore counts as plain ground too: a world with an earlier Dragon Land has ore where new caves go)
                take = (names == defaults) | (np.char.endswith(names.astype(str), "_ore") & (defaults != "minecraft:air"))
                if ov is None:
                    take &= False                              # nothing of ours here (air): keep hers
                kept = int((~take & (names != defaults)).sum())
                stats["kept"] += kept
                took[y] = take
                idx = np.where(take, len(h_raws) + o_idx, h_idx)
                items[k] = bdb.encode_subchunk(y, [(idx, h_raws + o_raws)] + extra)
            # chests and beds: ours go in where our block went in
            bev = ours.get(base + b"\x31")
            if bev:
                add, p = [], 0
                while p < len(bev):
                    d, q = bdb.read_nbt(bev, p)
                    gx, gy, gz = d["x"], d["y"], d["z"]
                    y = gy >> 4
                    i = (gx & 15) * 256 + (gz & 15) * 16 + (gy & 15)
                    if took.get(y) is not None and took[y][i]:
                        add.append(bev[p:q])
                    p = q
                if add:
                    items[base + b"\x31"] = items.get(base + b"\x31", b"") + b"".join(add)
            # the height map: as high as either world's blocks reach
            for tag in (0x2B, 0x2D):
                hk = base + bytes([tag])
                if hk in items and base + b"\x2b" in ours and len(items[hk]) >= 512:
                    mine = np.frombuffer(items[hk][:512], "<i2")
                    new = np.frombuffer(ours[base + b"\x2b"][:512], "<i2")
                    items[hk] = np.maximum(mine, new).astype("<i2").tobytes() + items[hk][512:]
    if report is not None:
        report.update(stats)
    return items

def marker_key():
    """The sub-chunk holding the marker block under the path at the region's edge."""
    x, y, z = 0, G - 1 + Y_OFF, RZ0 + 2
    return struct.pack("<ii", x >> 4, z >> 4) + bytes([0x2F, (y >> 4) & 0xFF])

def has_region(items):
    """Is this Dragon Land, as far as it goes now, in this world already? (Part 1's marker is chiseled stone bricks
    under the path at the edge; part 2, the caverns, adds chiseled polished blackstone next to it.)"""
    import bedrock_db as bdb
    val = items.get(marker_key())
    if val is None:
        return False
    x, y, z = 1, G - 1 + Y_OFF, RZ0 + 2
    _, st = bdb.decode_subchunk(val)
    idx, _, dicts = st[0]
    return dicts[idx[(x & 15) * 256 + (z & 15) * 16 + (y & 15)]].get("name") == "minecraft:chiseled_polished_blackstone"

if __name__ == "__main__":
    main()
