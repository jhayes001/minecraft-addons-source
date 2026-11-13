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

X0, X1, Z0, Z1 = -416, 416, -688, 144   # built area: x in [X0, X1), z in [Z0, Z1)
SX, SZ = X1 - X0, Z1 - Z0
FOREST_BIOME, SNOW_BIOME, SWAMP_BIOME, MOUNTAIN_BIOME, MESA_BIOME = 4, 12, 6, 3, 37   # 3 windswept hills, 37 badlands
# the three castles (centre of each castle's outer wall); every gate faces south (+z)
PRINCESS, ICE, KNIGHT, SPOOKY, SKY, BLAZE = (0, 0), (-320, -320), (320, -320), (0, -480), (-250, -580), (0, -260)
SKY_OY = 45                 # the sky islands float this many blocks above the ground
# The generator works in its own frame where the grass is at y -61. On writing, everything moves up by
# Y_OFF, so in the game the grass is at y 35 with 99 blocks of stone and deepslate underneath, and the
# generator's MIN_Y lands on the world's real bottom (y -64).
Y_OFF = 96
MIN_Y, MAX_Y = -160, 64
H = MAX_Y - MIN_Y
GROUND = -61                    # grass height (matches the flat world outside)

# ---------------------------------------------------------------- blocks
PALETTE = [("minecraft:air", {})]
_INDEX = {}

def blk(name, **states):
    key = (name, tuple(sorted(states.items())))
    if key not in _INDEX:
        _INDEX[key] = len(PALETTE)
        PALETTE.append((name if ":" in name else "minecraft:" + name, states))
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

# --- snow and ice
SNOW, SNOW_LAYER = blk("snow"), blk("snow_layer", height=0, covered_bit=False)
# (no plain ice anywhere: it melts into running water next to lights; packed and blue ice never melt)
PACKED_ICE, BLUE_ICE = blk("packed_ice"), blk("blue_ice")
DIAMOND, EMERALD_BLOCK, LAPIS_BLOCK = blk("diamond_block"), blk("emerald_block"), blk("lapis_block")
WHITE_GLASS = blk("white_stained_glass")
LBLUE_WOOL, CYAN_C, BLUE_C = blk("light_blue_wool"), blk("cyan_concrete"), RAINBOW[5]
WHITE_CARPET = blk("white_carpet")
SPRUCE_LOG = blk("spruce_log", pillar_axis="y")
SPRUCE_LEAVES = blk("spruce_leaves", persistent_bit=True, update_bit=False)
SPRUCE_PLANKS, SPRUCE_FENCE = blk("spruce_planks"), blk("spruce_fence")
SPRUCE_STAIRS = [blk("spruce_stairs", upside_down_bit=False, weirdo_direction=d) for d in range(4)]
SOUL_LANTERN, HANGING_SOUL_LANTERN = blk("soul_lantern", hanging=False), blk("soul_lantern", hanging=True)
PUMPKIN_HEAD = {d: blk("carved_pumpkin", **{"minecraft:cardinal_direction": d}) for d in ("south", "west", "north", "east")}
LBLUE_CANDLE = blk("light_blue_candle", candles=2, lit=True)
VERDANT_FROG = blk("verdant_froglight", pillar_axis="y")
FERN = blk("fern")
# --- forest and knight
OAK_LOG = blk("oak_log", pillar_axis="y")
OAK_LEAVES = blk("oak_leaves", persistent_bit=True, update_bit=False)
DARK_OAK_LOG = blk("dark_oak_log", pillar_axis="y")
DARK_OAK_LEAVES = blk("dark_oak_leaves", persistent_bit=True, update_bit=False)
DARK_OAK_PLANKS, DARK_OAK_FENCE = blk("dark_oak_planks"), blk("dark_oak_fence")
DARK_OAK_STAIRS = [blk("dark_oak_stairs", upside_down_bit=False, weirdo_direction=d) for d in range(4)]
ANDESITE, COBBLESTONE, MOSSY_COBBLE = blk("andesite"), blk("cobblestone"), blk("mossy_cobblestone")
TALL_GRASS = (blk("tall_grass", upper_block_bit=False), blk("tall_grass", upper_block_bit=True))
POPPY, DANDELION = blk("poppy"), blk("dandelion")
STONE_BRICKS, MOSSY_BRICKS, CRACKED_BRICKS = blk("stone_bricks"), blk("mossy_stone_bricks"), blk("cracked_stone_bricks")
SB_STAIRS = [blk("stone_brick_stairs", upside_down_bit=False, weirdo_direction=d) for d in range(4)]
DEEPSLATE_BRICKS, DEEPSLATE_TILES, POLISHED_DEEPSLATE = blk("deepslate_bricks"), blk("deepslate_tiles"), blk("polished_deepslate")
BLACKSTONE, PB_BRICKS, POLISHED_BLACKSTONE = blk("blackstone"), blk("polished_blackstone_bricks"), blk("polished_blackstone")
RED_NETHER = blk("red_nether_brick")
RED_C = RAINBOW[0]
RED_WOOL, YELLOW_WOOL, BLACK_WOOL = blk("red_wool"), blk("yellow_wool"), blk("black_wool")
RED_CARPET, GREEN_CARPET, BLUE_CARPET, BROWN_CARPET = blk("red_carpet"), blk("green_carpet"), blk("blue_carpet"), blk("brown_carpet")
GRAY_GLASS = blk("gray_stained_glass")
IRON_BARS, IRON_BLOCK = blk("iron_bars"), blk("iron_block")
TARGET = blk("target")
ANVIL = blk("anvil", **{"minecraft:cardinal_direction": "south"})
SMITHING, CRAFTING, CARTOGRAPHY = blk("smithing_table"), blk("crafting_table"), blk("cartography_table")
BLAST_FURNACE = blk("blast_furnace", **{"minecraft:cardinal_direction": "south"})
CAMPFIRE = blk("campfire", extinguished=False, **{"minecraft:cardinal_direction": "south"})
BARREL = blk("barrel", facing_direction=1, open_bit=False)
DRAGON_EGG = blk("dragon_egg")
SHROOMLIGHT = blk("shroomlight")
BONE = blk("bone_block", deprecated=0, pillar_axis="y")
COARSE_DIRT = blk("coarse_dirt")
OBSIDIAN = blk("obsidian")
# --- spooky mountain
LIT_PUMPKIN = {d: blk("lit_pumpkin", **{"minecraft:cardinal_direction": d}) for d in ("south", "west", "north", "east")}
PUMPKIN = {d: blk("pumpkin", **{"minecraft:cardinal_direction": d}) for d in ("south", "west", "north", "east")}
WEB = blk("web")
MYCELIUM, PODZOL, GRAVEL, TUFF = blk("mycelium"), blk("podzol"), blk("gravel"), blk("tuff")
RED_MUSH, BROWN_MUSH = blk("red_mushroom"), blk("brown_mushroom")
RED_CAP = blk("red_mushroom_block", huge_mushroom_bits=14)
BROWN_CAP = blk("brown_mushroom_block", huge_mushroom_bits=14)
MUSH_STEM = blk("mushroom_stem", huge_mushroom_bits=15)
CRYING = blk("crying_obsidian")
COBBLED_DEEPSLATE, DEEPSLATE = blk("cobbled_deepslate"), blk("deepslate", pillar_axis="y")
RAW_GOLD = blk("raw_gold_block")
ORES = [blk(n) for n in ("deepslate_diamond_ore", "deepslate_gold_ore", "deepslate_emerald_ore", "deepslate_lapis_ore",
                         "deepslate_iron_ore", "deepslate_coal_ore", "deepslate_iron_ore", "deepslate_coal_ore")]
RAIL_EW = blk("rail", rail_direction=1)
BREWING = blk("brewing_stand", brewing_stand_slot_a_bit=False, brewing_stand_slot_b_bit=False, brewing_stand_slot_c_bit=False)
CAULDRON = blk("cauldron", cauldron_liquid="water", fill_level=6)
PURPLE_CANDLE = blk("purple_candle", candles=3, lit=True)
BLACK_C, LIME_WOOL, PURPLE_CARPET, BLACK_CARPET = blk("black_concrete"), blk("lime_wool"), blk("purple_carpet"), blk("black_carpet")
DEADBUSH = blk("deadbush")
DS_STAIRS = [blk("deepslate_brick_stairs", upside_down_bit=False, weirdo_direction=d) for d in range(4)]
DARK_OAK_LOG_X, DARK_OAK_LOG_Z = blk("dark_oak_log", pillar_axis="x"), blk("dark_oak_log", pillar_axis="z")
LICHEN_FLOOR = blk("glow_lichen", multi_face_direction_bits=1)
LICHEN_CEILING = blk("glow_lichen", multi_face_direction_bits=2)
OAK_FENCE = blk("oak_fence")
LADDERS = {f: blk("ladder", facing_direction=f) for f in (2, 3, 4, 5)}   # 2 faces north ... 5 faces east
TRAPDOORS = {n: blk(n + "_trapdoor", direction=0, open_bit=False, upside_down_bit=True)
             for n in ("cherry", "spruce", "dark_oak", "crimson")}
BIRCH_PLANKS, BIRCH_FENCE = blk("birch_planks"), blk("birch_fence")
YELLOW_GLASS, YELLOW_CARPET, YELLOW_C = blk("yellow_stained_glass"), blk("yellow_carpet"), RAINBOW[2]
HANGING_ROOTS, GREEN_C, MOSS = blk("hanging_roots"), blk("green_concrete"), blk("moss_block")
LEAVES_PAD = blk("azalea_leaves", persistent_bit=True, update_bit=False)
YELLOW_CANDLE = blk("yellow_candle", candles=3, lit=True)
ORANGE_GLASS, RED_GLASS = blk("orange_stained_glass"), blk("red_stained_glass")
OCHRE_FROG = blk("ochre_froglight", pillar_axis="y")
NETHER_FENCE, RED_SAND, CACTUS = blk("nether_brick_fence"), blk("red_sand"), blk("cactus", age=0)
TERRACOTTA_BANDS = [blk(n) for n in ("orange_terracotta", "orange_terracotta", "yellow_terracotta", "white_terracotta",
                                     "orange_terracotta", "red_terracotta", "hardened_clay", "brown_terracotta",
                                     "orange_terracotta", "light_gray_terracotta", "red_terracotta")]
ORANGE_C = RAINBOW[1]
ORANGE_WOOL, ORANGE_CARPET, ORANGE_CANDLE = blk("orange_wool"), blk("orange_carpet"), blk("orange_candle", candles=3, lit=True)
PB_STAIRS = [blk("polished_blackstone_brick_stairs", upside_down_bit=False, weirdo_direction=d) for d in range(4)]
NETHERITE_BLOCK = blk("netherite_block")
FLAME = [RED_C, RED_C, ORANGE_C, ORANGE_C, YELLOW_C, YELLOW_C]               # flame-coloured roofs, red to yellow
TREE_PARTS = [CHERRY_LOG, CHERRY_LEAVES, SPRUCE_LOG, SPRUCE_LEAVES, OAK_LOG, OAK_LEAVES, DARK_OAK_LOG,
              DARK_OAK_LEAVES, PACKED_ICE, DARK_OAK_LOG_X, DARK_OAK_LOG_Z, PUMPKIN["south"]]

STAIR_IDS = set(QSTAIRS) | set(CHERRY_STAIRS)
# Blocks you can walk through (used by the tests and when planting)
PASSABLE = {AIR, WATER, SHORT_GRASS, LILY_PAD, *FLOWERS, *[a for p in DOUBLE_FLOWERS for a in p], *PETALS,
            PINK_CARPET, MAGENTA_CARPET, LBLUE_CARPET, WHITE_CARPET, RED_CARPET, GREEN_CARPET, BLUE_CARPET,
            BROWN_CARPET, SNOW_LAYER, FERN, *TALL_GRASS, POPPY, DANDELION, PURPLE_CARPET, BLACK_CARPET, RED_MUSH,
            BROWN_MUSH, DEADBUSH, RAIL_EW, YELLOW_CARPET, ORANGE_CARPET}

# ---------------------------------------------------------------- world builder
class World:
    def __init__(self, seed):
        self.seed = seed
        self.rng = random.Random(seed)
        self.b = np.zeros((SX, H, SZ), dtype=np.uint16)      # [x - X0, y - MIN_Y, z - Z0]; palette index
        self.block_entities = []          # (x, y, z, nbt bytes)
        self.chests = {}                  # name -> (x, y, z)
        self.places = {}                  # name -> (x, y, z) spots the test walks to
        self.no_plant = np.zeros((SX, SZ), bool)
        self.no_snow = np.zeros((SX, SZ), bool)
        self.stairs = {}                  # castle -> (steps, floors) in world coordinates

    def inside(self, x, y, z):
        return X0 <= x < X1 and MIN_Y <= y < MAX_Y and Z0 <= z < Z1

    def get(self, x, y, z):
        return self.b[x - X0, y - MIN_Y, z - Z0] if self.inside(x, y, z) else AIR

    def set(self, x, y, z, v, only_air=False):
        if self.inside(x, y, z):
            i, j, k = x - X0, y - MIN_Y, z - Z0
            if only_air and self.b[i, j, k] != AIR:
                return False
            self.b[i, j, k] = v
            return True
        return False

    def fill(self, x0, x1, y0, y1, z0, z1, v):
        """Inclusive box."""
        x0, x1 = max(x0, X0), min(x1, X1 - 1)
        z0, z1 = max(z0, Z0), min(z1, Z1 - 1)
        y0, y1 = max(y0, MIN_Y), min(y1, MAX_Y - 1)
        if x0 <= x1 and y0 <= y1 and z0 <= z1:
            self.b[x0 - X0:x1 - X0 + 1, y0 - MIN_Y:y1 - MIN_Y + 1, z0 - Z0:z1 - Z0 + 1] = v

    def protect(self, x0, x1, z0, z1, snow=False):
        sl = (slice(max(0, x0 - X0), min(SX, x1 - X0 + 1)), slice(max(0, z0 - Z0), min(SZ, z1 - Z0 + 1)))
        self.no_plant[sl] = True
        if not snow:
            self.no_snow[sl] = True

    def surface(self, x, z):
        """Highest non-air y in the column."""
        if not (X0 <= x < X1 and Z0 <= z < Z1):
            return None
        col = self.b[x - X0, :, z - Z0]
        nz = np.nonzero(col)[0]
        return int(nz[-1]) + MIN_Y if len(nz) else None

    def chest(self, name, x, y, z, items, facing="south"):
        self.set(x, y, z, CHESTS[facing])
        self.block_entities.append((x, y, z, chest_nbt(x, y + Y_OFF, z, items)))
        self.chests[name] = (x, y, z)

    def bed(self, x, y, z, direction, color=6):
        dx, dz = [(0, 1), (-1, 0), (0, -1), (1, 0)][direction]
        for (px, pz, head) in ((x, z, False), (x + dx, z + dz, True)):
            self.set(px, y, pz, BEDS[(direction, head)])
            self.block_entities.append((px, y, pz, nbt({"id": STR("Bed"), "color": B(color), "isMovable": B(1),
                                                        "x": I(px), "y": I(y + Y_OFF), "z": I(pz)})))

class _Places:
    def __init__(self, v):
        self.v = v
    def __setitem__(self, k, p):
        x, z = self.v.to_world(p[0], p[2])
        self.v.w.places[self.v.prefix + k] = (x, p[1] + self.v.oy, z)

# Turning a block a quarter turn clockwise (seen from above), for the state names Bedrock uses
_TURN = {
    "minecraft:cardinal_direction": {"south": "west", "west": "north", "north": "east", "east": "south"},
    "weirdo_direction": {0: 2, 1: 3, 2: 1, 3: 0},        # stairs: 0 east 1 west 2 south 3 north
    "facing_direction": {2: 5, 3: 4, 4: 2, 5: 3, 0: 0, 1: 1},
    "pillar_axis": {"x": "z", "z": "x", "y": "y"},
    "rail_direction": {0: 1, 1: 0},
}
_BED_TURN = {0: 1, 1: 2, 2: 3, 3: 0}                     # beds: 0 south 1 west 2 north 3 east
_turned = {}

def turn_block(i, quarters):
    """The same block turned `quarters` quarter turns clockwise."""
    for _ in range(quarters % 4):
        if i not in _turned:
            name, states = PALETTE[i]
            new = dict(states)
            for k, v in states.items():
                if k in _TURN:
                    new[k] = _TURN[k][v]
                elif k == "direction" and name == "minecraft:bed":
                    new[k] = _BED_TURN[v]
            _turned[i] = blk(name[len("minecraft:"):], **new) if new != states else i
        i = _turned[i]
    return i

class View:
    """The world seen from a castle's own centre, so each castle is built in local coordinates
    (gate facing +z). With rot=1 the castle is turned a quarter turn clockwise: its gate faces
    west, local +x points south, and every stair, bed, chest, ladder and log turns with it."""
    def __init__(self, w, ox, oz, prefix="", rot=0, oy=0):
        self.w, self.ox, self.oz, self.prefix, self.rot, self.oy = w, ox, oz, prefix, rot % 4, oy
        self.rng = w.rng
        self.places = _Places(self)
    def to_world(self, x, z):
        for _ in range(self.rot):
            x, z = -z, x
        return x + self.ox, z + self.oz
    def get(self, x, y, z):
        wx, wz = self.to_world(x, z)
        return self.w.get(wx, y + self.oy, wz)
    def set(self, x, y, z, v, only_air=False):
        wx, wz = self.to_world(x, z)
        return self.w.set(wx, y + self.oy, wz, turn_block(v, self.rot) if self.rot else v, only_air)
    def fill(self, x0, x1, y0, y1, z0, z1, v):
        ax, az = self.to_world(x0, z0)
        bx, bz = self.to_world(x1, z1)
        self.w.fill(min(ax, bx), max(ax, bx), y0 + self.oy, y1 + self.oy, min(az, bz), max(az, bz),
                    turn_block(v, self.rot) if self.rot else v)
    def protect(self, x0, x1, z0, z1, snow=False):
        ax, az = self.to_world(x0, z0)
        bx, bz = self.to_world(x1, z1)
        self.w.protect(min(ax, bx), max(ax, bx), min(az, bz), max(az, bz), snow)
    def surface(self, x, z):
        wx, wz = self.to_world(x, z)
        s_ = self.w.surface(wx, wz)
        return None if s_ is None else s_ - self.oy
    def chest(self, name, x, y, z, items, facing="south"):
        wx, wz = self.to_world(x, z)
        for _ in range(self.rot):
            facing = _TURN["minecraft:cardinal_direction"][facing]
        self.w.chest(self.prefix + name, wx, y + self.oy, wz, items, facing)
    def bed(self, x, y, z, direction, color=6):
        wx, wz = self.to_world(x, z)
        for _ in range(self.rot):
            direction = _BED_TURN[direction]
        self.w.bed(wx, y + self.oy, wz, direction, color)
    def save_stairs(self, steps, floors, name=None):
        pts = []
        for x, y, z in steps:
            wx, wz = self.to_world(x, z)
            pts.append((wx, y + self.oy, wz))
        self.w.stairs[name or self.prefix.strip() or "princess"] = (pts, [f + self.oy for f in floors])

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

PINK, PURPLE, SKYBLUE, SUNNY = 0xF7A6C9, 0xB07FE0, 0x8FD3F5, 0xFFE27A

def chest_nbt(x, y, z, items):
    its = [C(dict(it, Slot=B(i))) for i, it in enumerate(items)]
    return nbt({"Findable": B(0), "Items": LST(10, its), "id": STR("Chest"), "isMovable": B(1),
                "x": I(x), "y": I(y), "z": I(z)})

def outfit(rgb, title):
    return [item(0, "leather_chestplate", 1, dyed(rgb, title + " Dress")),
            item(0, "leather_leggings", 1, dyed(rgb, title + " Skirt")),
            item(0, "leather_boots", 1, dyed(rgb, title + " Slippers"))]

SPAWN_ITEMS = ([item(0, "golden_helmet", 1, named("Princess Crown"))] + outfit(PINK, "Princess") +
               [item(0, "cake", 1), item(0, "cookie", 16), item(0, "golden_carrot", 8), item(0, "horse_spawn_egg", 1),
                item(0, "saddle", 1)])
WARDROBE_ITEMS = (outfit(PURPLE, "Lilac") + outfit(SKYBLUE, "Sky Blue") + outfit(SUNNY, "Sunshine") +
                  [item(0, "golden_helmet", 1, named("Spare Crown")), item(0, "pink_dye", 16), item(0, "purple_dye", 16)])
TREASURE_ITEMS = [item(0, "diamond", 16), item(0, "emerald", 16), item(0, "gold_ingot", 32), item(0, "amethyst_shard", 16),
                  item(0, "golden_apple", 4), item(0, "enchanted_golden_apple", 1),
                  item(0, "golden_helmet", 1, named("Queen's Crown"))]
LOOKOUT_TOWER_ITEMS = [item(0, "golden_carrot", 8), item(0, "spyglass", 1),
                item(0, "cookie", 16), item(0, "pink_tulip", 4)]
STABLE_ITEMS = [item(0, "horse_spawn_egg", 2), item(0, "saddle", 2), item(0, "golden_horse_armor", 2),
                item(0, "lead", 2), item(0, "golden_carrot", 16), item(0, "apple", 16), item(0, "name_tag", 2)]
MAZE_ITEMS = [item(0, "cake", 1), item(0, "cat_spawn_egg", 1), item(0, "glow_berries", 16),
              item(0, "lily_of_the_valley", 8), item(0, "music_disc_cat", 1), item(0, "jukebox", 1)]
GOLD_POT_ITEMS = [item(0, "gold_ingot", 32), item(0, "gold_nugget", 64), item(0, "golden_apple", 2), item(0, "clock", 1)]
ICEBLUE, SILVER, SNOWWHITE = 0x9AD8F5, 0xC8D0E0, 0xF4F8FF
ICE_WARDROBE_ITEMS = (outfit(ICEBLUE, "Snow Queen") + outfit(SNOWWHITE, "Snowflake") + outfit(SILVER, "Frost") +
                      [item(0, "diamond_helmet", 1, named("Ice Crown")), item(0, "light_blue_dye", 16)])
ICE_GEM_ITEMS = [item(0, "diamond", 8), item(0, "emerald", 8), item(0, "lapis_lazuli", 16), item(0, "amethyst_shard", 16),
                 item(0, "quartz", 16), item(0, "prismarine_crystals", 8)]
ICE_TREASURE_ITEMS = [item(0, "diamond", 24), item(0, "diamond_helmet", 1, named("Snow Queen's Crown")),
                      item(0, "blue_ice", 16), item(0, "snowball", 16), item(0, "golden_apple", 4),
                      item(0, "enchanted_golden_apple", 1), item(0, "trident", 1, named("Frost Wand"))]
ICE_SPYGLASS_ITEMS = [item(0, "snowball", 16), item(0, "golden_apple", 2), item(0, "spyglass", 1),
                   item(0, "cookie", 16)]
IGLOO_ITEMS = [item(0, "snowball", 16), item(0, "cookie", 16), item(0, "pumpkin_pie", 4), item(0, "milk_bucket", 1),
               item(0, "leather_boots", 1, dyed(SNOWWHITE, "Snow Boots")), item(0, "oak_boat", 1, named("Sled"))]
KNIGHT_TREASURE_ITEMS = [item(0, "diamond_sword", 1, named("Knight's Sword")), item(0, "shield", 1),
                         item(0, "golden_helmet", 1, named("King's Crown")), item(0, "gold_ingot", 32),
                         item(0, "diamond", 16), item(0, "golden_apple", 4), item(0, "enchanted_golden_apple", 1)]
KNIGHT_ARMOR_ITEMS = [item(0, "diamond_helmet"), item(0, "diamond_chestplate"), item(0, "diamond_leggings"),
                      item(0, "diamond_boots"), item(0, "bow"), item(0, "arrow", 64), item(0, "diamond_horse_armor")]
ARMORY_ITEMS = [item(0, "iron_helmet"), item(0, "iron_chestplate"), item(0, "iron_leggings"), item(0, "iron_boots"),
                item(0, "iron_sword"), item(0, "iron_sword"), item(0, "shield"), item(0, "shield"), item(0, "bow"),
                item(0, "crossbow"), item(0, "arrow", 64)]
QUARTERS_ITEMS = [item(0, "bread", 16), item(0, "cooked_beef", 16), item(0, "apple", 8),
                  item(0, "leather_chestplate", 1, dyed(0xB02E26, "Knight's Tunic")),
                  item(0, "leather_boots", 1, dyed(0x3B2A1E, "Riding Boots"))]
FORGE_ITEMS = [item(0, "iron_ingot", 32), item(0, "coal", 32), item(0, "iron_pickaxe"), item(0, "iron_axe"),
               item(0, "iron_shovel"), item(0, "shears")]
KNIGHT_STABLE_ITEMS = [item(0, "horse_spawn_egg", 2), item(0, "saddle", 2), item(0, "iron_horse_armor", 2),
                       item(0, "lead", 2), item(0, "golden_carrot", 16), item(0, "apple", 16), item(0, "name_tag", 2)]
SPOOKY_STABLE_ITEMS = [item(0, "horse_spawn_egg", 2), item(0, "saddle", 2), item(0, "diamond_horse_armor", 1),
                       item(0, "lead", 2), item(0, "golden_carrot", 16), item(0, "apple", 16), item(0, "name_tag", 2)]
VAULT_ITEMS = [item(0, "gold_ingot", 64), item(0, "gold_ingot", 64), item(0, "raw_gold", 32), item(0, "gold_nugget", 64),
               item(0, "golden_apple", 4), item(0, "golden_carrot", 16)]
DWARF_CROWN_ITEMS = [item(0, "golden_helmet", 1, named("Mountain King's Crown")), item(0, "diamond", 16),
                     item(0, "emerald", 16), item(0, "netherite_ingot", 1), item(0, "enchanted_golden_apple", 1)]
POTION_ITEMS = [item(0, "book", 3, named("Spooky Spellbook")), item(0, "glass_bottle", 8), item(0, "glow_berries", 16),
                item(0, "blaze_powder", 4), item(0, "nether_wart", 8), item(0, "glowstone_dust", 16)]
DWARF_FORGE_ITEMS = [item(0, "diamond_pickaxe", 1, named("Dwarf Pick")), item(0, "iron_axe", 1, named("Dwarf Axe")),
                     item(0, "iron_ingot", 32), item(0, "coal", 32), item(0, "iron_helmet", 1, named("Dwarf Helmet"))]
MINE_ITEMS = [item(0, "iron_pickaxe", 1), item(0, "iron_pickaxe", 1), item(0, "torch", 64), item(0, "minecart", 1),
              item(0, "bread", 8)]
COSTUME_ITEMS = [item(0, "carved_pumpkin", 1, named("Pumpkin Head")),
                 item(0, "leather_chestplate", 1, dyed(0x2B1B3A, "Witch Dress")),
                 item(0, "leather_helmet", 1, dyed(0x2B1B3A, "Witch Hat")),
                 item(0, "leather_chestplate", 1, dyed(0xF4F4F4, "Ghost Sheet")),
                 item(0, "leather_chestplate", 1, dyed(0xF08A1C, "Pumpkin Suit")),
                 item(0, "leather_boots", 1, dyed(0x1A1A1A, "Bat Slippers"))]
GEODE_ITEMS = [item(0, "amethyst_shard", 32), item(0, "spyglass", 1), item(0, "amethyst_block", 8),
               item(0, "glow_berries", 16)]
WITCH_ITEMS = [item(0, "diamond", 16), item(0, "emerald", 16), item(0, "golden_helmet", 1, named("Witch Queen's Crown")),
               item(0, "cake", 1), item(0, "pumpkin_pie", 8), item(0, "enchanted_golden_apple", 1)]
BAT_SPYGLASS_ITEMS = [item(0, "pumpkin_pie", 4), item(0, "glow_berries", 16), item(0, "spyglass", 1),
                   item(0, "cookie", 16)]
PRINCESS_SECRET_ITEMS = [item(0, "golden_helmet", 1, named("Secret Fairy Crown")), item(0, "diamond", 8),
                         item(0, "amethyst_shard", 16), item(0, "cake", 1), item(0, "allay_spawn_egg", 1),
                         item(0, "music_disc_otherside", 1), item(0, "jukebox", 1)]
ICE_SECRET_ITEMS = [item(0, "diamond", 16), item(0, "blue_ice", 32), item(0, "polar_bear_spawn_egg", 1),
                    item(0, "trident", 1, named("Frozen Trident")), item(0, "leather_chestplate", 1, dyed(ICEBLUE, "Frost Cloak"))]
PRISONER_ITEMS = [item(0, "bread", 4), item(0, "bone", 8), item(0, "iron_ingot", 4), item(0, "compass", 1)]
DUNGEON_VAULT_ITEMS = [item(0, "netherite_sword", 1, named("Dungeon Blade")), item(0, "gold_ingot", 32),
                       item(0, "diamond", 12), item(0, "golden_apple", 4), item(0, "enchanted_golden_apple", 1),
                       item(0, "shield", 1, named("Dungeon Shield"))]
LAKE_ITEMS = [item(0, "fishing_rod", 1), item(0, "axolotl_bucket", 1), item(0, "glow_ink_sac", 8),
              item(0, "oak_boat", 1), item(0, "cooked_cod", 8)]
CRYSTAL_ITEMS = [item(0, "amethyst_shard", 32), item(0, "spyglass", 1), item(0, "diamond", 4), item(0, "glow_berries", 16)]
DEEP_HOARD_ITEMS = [item(0, "golden_helmet", 1, named("Dwarf King's Crown")), item(0, "gold_block", 16),
                    item(0, "netherite_ingot", 2), item(0, "enchanted_golden_apple", 2), item(0, "totem_of_undying", 1)]
DEEP_DIAMOND_ITEMS = [item(0, "diamond", 32), item(0, "emerald", 32), item(0, "diamond_pickaxe", 1, named("King's Pick")),
                      item(0, "diamond_block", 4)]
SKY_STABLE_ITEMS = [item(0, "horse_spawn_egg", 2), item(0, "saddle", 2), item(0, "golden_horse_armor", 2),
                    item(0, "lead", 4), item(0, "golden_carrot", 16), item(0, "apple", 16), item(0, "name_tag", 2)]
SKY_WARDROBE_ITEMS = (outfit(0xFFE27A, "Sky Princess") + outfit(0xFFFFFF, "Cloud") + outfit(0x8FD3F5, "Sky Blue") +
                      [item(0, "golden_helmet", 1, named("Sky Tiara")), item(0, "yellow_dye", 16)])
SKY_TREASURE_ITEMS = [item(0, "golden_helmet", 1, named("Rainbow Crown")), item(0, "diamond", 32), item(0, "emerald", 32),
                      item(0, "gold_block", 8), item(0, "enchanted_golden_apple", 2), item(0, "nether_star", 1),
                      item(0, "cake", 1)]
SKY_SPYGLASS_ITEMS = [item(0, "golden_apple", 2), item(0, "cake", 1), item(0, "spyglass", 1),
                   item(0, "feather", 16)]
RAINBOW_END_ITEMS = [item(0, "gold_ingot", 64), item(0, "red_dye", 8), item(0, "orange_dye", 8), item(0, "yellow_dye", 8),
                     item(0, "lime_dye", 8), item(0, "light_blue_dye", 8), item(0, "purple_dye", 8)]
LOOKOUT_ITEMS = [item(0, "spyglass", 1), item(0, "compass", 1), item(0, "map", 1), item(0, "cookie", 8)]
FIRE = 0xE8501E
BLAZE_STABLE_ITEMS = [item(0, "horse_spawn_egg", 2), item(0, "saddle", 2), item(0, "golden_horse_armor", 2),
                      item(0, "lead", 2), item(0, "golden_carrot", 16), item(0, "apple", 16), item(0, "name_tag", 2)]
BLAZE_WARDROBE_ITEMS = (outfit(FIRE, "Blaze") + outfit(0xFFB000, "Sunburst") + outfit(0xC81E1E, "Ruby") +
                        [item(0, "golden_helmet", 1, named("Flame Crown")), item(0, "orange_dye", 16)])
BLAZE_TREASURE_ITEMS = [item(0, "golden_helmet", 1, named("Blaze Crown")), item(0, "diamond", 24),
                        item(0, "gold_ingot", 32), item(0, "netherite_ingot", 2), item(0, "enchanted_golden_apple", 1),
                        item(0, "fire_charge", 8)]
BLAZE_SPYGLASS_ITEMS = [item(0, "blaze_rod", 4), item(0, "golden_apple", 2), item(0, "spyglass", 1),
                       item(0, "cookie", 16)]
PARKOUR_ITEMS = [item(0, "golden_helmet", 1, named("Parkour Champion")), item(0, "diamond", 8),
                 item(0, "golden_apple", 4), item(0, "cake", 1)]
FIRE_VAULT_ITEMS = [item(0, "netherite_sword", 1, named("Flame Sword")), item(0, "gold_block", 8), item(0, "diamond", 16),
                    item(0, "blaze_rod", 8), item(0, "enchanted_golden_apple", 1)]

# ---------------------------------------------------------------- shapes
def disk_mask(cx, cz, r, x0, x1, z0, z1):
    xs, zs = np.arange(x0, x1 + 1), np.arange(z0, z1 + 1)
    X, Z = np.meshgrid(xs, zs, indexing="ij")
    return np.hypot(X - cx, Z - cz), X, Z

def column_set(w, X, Z, mask, y0, y1, v):
    for x, z in zip(X[mask], Z[mask]):
        w.fill(int(x), int(x), y0, y1, int(z), int(z), v)

def cone(w, cx, cz, r0, y0, h, colors, flag=PINK_WOOL, tip=None, pole=None):
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
    w.set(tx, y0 + h, tz, tip or GOLD)
    for k in range(1, 4):
        w.set(tx, y0 + h + k, tz, pole or CHAIN)
    w.set(tx, y0 + h + 4, tz, END_ROD_UP)
    for a in range(1, 4):
        for k in (2, 3):
            w.set(tx + a, y0 + h + k, tz, flag)

def tower(w, cx, cz, r, y0, top, cone_h, roof, room=None, band=PINK_C, glass=PINK_GLASS, flag=PINK_WOOL,
          body=None, floor=None, light=None, tip=None):
    """Round tower: solid body to `top`, banded and windowed, with a cone roof.
    room = (floor_y, [door angles in degrees]) carves a room from floor_y+1 up into the roof."""
    R = r + 2
    d, X, Z = disk_mask(cx, cz, 0, int(cx - R), int(cx + R), int(cz - R), int(cz + R))
    mat = body_mat = body if isinstance(body, int) else QUARTZ
    body = d <= r + 0.35
    shell = body & (d > r - 1.0)
    column_set(w, X, Z, body, y0, top, body_mat)
    for y in range(y0 + 5, top + 1, 8):
        column_set(w, X, Z, shell, y, y, band)
    if room:
        fy, doors = room
        inner = d <= r - 1.0
        column_set(w, X, Z, inner, fy + 1, top, AIR)
        column_set(w, X, Z, inner, fy, fy, floor or SMOOTH_QUARTZ)
        for ang in doors:
            carve_door(w, cx, cz, r, fy + 1, ang)
        # lanterns in the room
        for ang in (45, 225):
            a = math.radians(ang)
            w.set(int(round(cx + math.cos(a) * (r - 2))), fy + 1, int(round(cz + math.sin(a) * (r - 2))), light or LANTERN)
    # windows: little glass slits
    for y in range(y0 + 8, top - 1, 7):
        for ang in (0, 90, 180, 270):
            a = math.radians(ang + 45)
            wx, wz = int(round(cx + math.cos(a) * r)), int(round(cz + math.sin(a) * r))
            for k in (0, 1):
                if w.get(wx, y + k, wz) == mat:
                    w.set(wx, y + k, wz, glass)
    cone(w, cx, cz, r + 1.2, top + 1, cone_h, roof, flag, tip)

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
def region_weights(X, Z):
    """How snowy (ice castle) and how foresty (knight castle) each spot is, 0..1."""
    d_ice = np.hypot(X - ICE[0], Z - ICE[1])
    d_kn = np.hypot(X - KNIGHT[0], Z - KNIGHT[1])
    d_sp = np.hypot(X - SPOOKY[0], Z - SPOOKY[1])
    d_bl = np.hypot(X - BLAZE[0], Z - BLAZE[1])
    sw = np.clip((180 - d_sp) / 40.0, 0, 1)
    return (np.clip((215 - d_ice) / 50.0, 0, 1), np.clip((215 - d_kn) / 50.0, 0, 1), sw,
            np.clip((165 - d_bl) / 45.0, 0, 1) * (1 - sw))

KNIGHT_VALLEY = (200, -320, 320, -320)    # the valley runs from the crossroads to the fortress

def build_ground(w):
    X, Z = np.meshgrid(np.arange(X0, X1), np.arange(Z0, Z1), indexing="ij")
    edge = np.minimum(np.minimum(X + 0.5 - X0, X1 - X - 0.5), np.minimum(Z + 0.5 - Z0, Z1 - Z - 0.5))
    fade = np.clip((edge - 6) / 24.0, 0, 1)
    castle = np.ones(X.shape)
    for (cx, cz) in (PRINCESS, ICE, KNIGHT, SPOOKY, SKY, BLAZE):
        castle = np.minimum(castle, np.clip((np.maximum(np.abs(X - cx), np.abs(Z - cz)) - 56) / 16.0, 0, 1))
    for sx in (1, -1):
        dx, dz = knight_to_world(sx * (DRAGON[0] + 3), DRAGON[1] + 3)
        castle = np.minimum(castle, np.clip((np.maximum(np.abs(X - dx), np.abs(Z - dz)) - 20) / 14.0, 0, 1))
    road = np.where(Z < 40, 1.0, np.clip((np.abs(X) - 5) / 8.0, 0, 1))
    from scipy.ndimage import distance_transform_edt
    road_d = distance_transform_edt(~w.road_mask)
    zr = river_z(X)
    river = np.where(np.abs(X) <= 104, np.clip((np.abs(Z - zr) - 7) / 10.0, 0, 1), 1.0)
    iw, kw, sw, bw = region_weights(X, Z)
    w.ice_w, w.knight_w, w.spooky_w, w.blaze_w = iw, kw, sw, bw
    amp = 9 + 5 * iw + 9 * kw + 3 * sw
    hills = np.clip(fbm2(X, Z, 60, w.seed + 1) + 0.15, 0, 1) * amp + 1.2 * fbm2(X, Z, 12, w.seed + 2)
    # the knight's mountains: rocky ridges and snowy peaks all round a green valley that holds the
    # fortress, the dragons and the crossroads; the roads wind through passes between the peaks
    ax, az, bx, bz = KNIGHT_VALLEY
    t = np.clip(((X - ax) * (bx - ax) + (Z - az) * (bz - az)) / float((bx - ax) ** 2 + (bz - az) ** 2), 0, 1)
    d_valley = np.hypot(X - (ax + t * (bx - ax)), Z - (az + t * (bz - az)))
    d_kn = np.hypot(X - KNIGHT[0], Z - KNIGHT[1])
    mw = np.clip((270 - d_kn) / 50.0, 0, 1) * (1 - np.clip(sw * 1.5, 0, 1)) * np.clip((d_valley - 70) / 35.0, 0, 1)
    w.mountain_w = mw
    base = np.clip(fbm2(X, Z, 90, w.seed + 40) * 0.8 + 0.6, 0.2, 1.2)
    ridge = (1 - np.abs(fbm2(X, Z, 40, w.seed + 41))) ** 2.2
    peaks = 16 + 82 * ridge * base + 6 * fbm2(X, Z, 14, w.seed + 42)
    hills = hills * (1 - mw) + peaks * mw
    # the badlands round Blaze Castle: flat-topped mesas in steps
    p = fbm2(X, Z, 40, w.seed + 60)
    mesa = 13 * (p > 0.18) + 11 * (p > 0.42) + 9 * (p > 0.62) + 1.5 * fbm2(X, Z, 10, w.seed + 61)
    hills = hills * (1 - bw) + mesa * bw
    near_road = np.clip((road_d - 4) / (12.0 + 12.0 * mw), 0, 1)        # gentler slopes beside the mountain passes
    height = np.round(GROUND + np.maximum(hills, 0) * fade * castle * road * river * near_road).astype(int)
    w.ground = height
    ys = (np.arange(H) + MIN_Y)[None, :, None]
    hh = height[:, None, :]
    b = w.b
    b[(ys < hh - 3)] = STONE
    b[(ys >= hh - 3) & (ys < hh)] = DIRT
    b[ys == hh] = GRASS
    b[(ys <= -96) & (b == STONE)] = DEEPSLATE          # deepslate below the game's y 0
    b[:, 0, :] = BEDROCK
    # bare rock on steep and high mountainsides, snow on the peaks
    hp = np.pad(height, 1, mode="edge")
    slope = np.max([np.abs(hp[1:-1, 1:-1] - hp[2:, 1:-1]), np.abs(hp[1:-1, 1:-1] - hp[:-2, 1:-1]),
                    np.abs(hp[1:-1, 1:-1] - hp[1:-1, 2:]), np.abs(hp[1:-1, 1:-1] - hp[1:-1, :-2])], axis=0)
    n = fbm2(X, Z, 9, w.seed + 43)
    rock = (mw > 0.25) & ((slope >= 3) | (height >= GROUND + 42 + 6 * n))
    w.snowcap = (mw > 0.25) & (height >= GROUND + 58 + 8 * n)
    for (i, k) in np.argwhere(rock):
        h = height[i, k] - MIN_Y
        r = n[i, k]
        b[i, h - 3:h + 1, k] = ANDESITE if r > 0.35 else STONE
        if slope[i, k] < 3 and r < -0.3:
            b[i, h, k] = GRAVEL
    for (i, k) in np.argwhere(w.snowcap):
        h = height[i, k] - MIN_Y
        b[i, h, k] = SNOW
    # badlands: striped terracotta cliffs, red sand on the flat tops
    for (i, k) in np.argwhere(bw > 0.5):
        h = height[i, k]
        for y in range(GROUND - 3, h + 1):
            b[i, y - MIN_Y, k] = TERRACOTTA_BANDS[(y + int(2 * n[i, k])) % len(TERRACOTTA_BANDS)]
        if slope[i, k] < 2:
            b[i, h - MIN_Y, k] = RED_SAND

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

def lamp_post(w, x, y, z, h=2, post=None, light=None):
    for k in range(h):
        w.set(x, y + k, z, post or CHERRY_FENCE)
    w.set(x, y + h, z, light or LANTERN)

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
    """Cherry groves and flower meadows round the princess castle, snowy spruce woods and ice
    spikes round the ice castle, oak and dark oak woods with boulders round the knight castle."""
    rng = w.rng
    X, Z = np.meshgrid(np.arange(X0, X1), np.arange(Z0, Z1), indexing="ij")
    grove = fbm2(X, Z, 40, w.seed + 30)
    meadow = fbm2(X, Z, 20, w.seed + 31)
    dark = fbm2(X, Z, 50, w.seed + 33)
    podzol = fbm2(X, Z, 16, w.seed + 34) > 0.05
    kind = (fbm2(X, Z, 14, w.seed + 32) * 3.5 + 3.5).astype(int) % len(FLOWERS)
    order = [(i, k) for i in range(SX) for k in range(SZ)]
    rng.shuffle(order)
    trees = 0
    for (i, k) in order:
        if w.no_plant[i, k]:
            continue
        x, z = i + X0, k + Z0
        t = w.surface(x, z)
        if t is not None and w.get(x, t, z) == RED_SAND:
            r = rng.random()
            if r < 0.004 and all(w.get(x + a, t + k, z + c) == AIR for a, c in ((1, 0), (-1, 0), (0, 1), (0, -1)) for k in (1, 2, 3)):
                for k in range(1, rng.randint(2, 4)):
                    w.set(x, t + k, z, CACTUS)
            elif r < 0.03:
                w.set(x, t + 1, z, DEADBUSH)
            continue
        if t is None or w.get(x, t, z) != GRASS:
            continue
        y = t + 1
        r = rng.random()
        iw, kw, sw = w.ice_w[i, k], w.knight_w[i, k], w.spooky_w[i, k]
        if w.mountain_w[i, k] > 0.5 and iw < 0.5 and sw < 0.5:
            kw = 1.0                                       # mountainsides belong to the knight's mountains
        region = ("spooky" if sw > rng.uniform(0.35, 0.65) else "ice" if iw > rng.uniform(0.35, 0.65)
                  else "knight" if kw > rng.uniform(0.35, 0.65) else "princess")
        if region == "spooky":
            if podzol[i, k]:
                w.set(x, t, z, PODZOL)
            if r < 0.008 and clear_around(w, x, z, 3):
                trees += dead_tree(w, x, y, z)
            elif r < 0.013:
                w.set(x, y, z, PUMPKIN[rng.choice(("south", "west", "north", "east"))])
            elif r < 0.0135:
                w.set(x, y, z, LIT_PUMPKIN[rng.choice(("south", "west", "north", "east"))])
            elif r < 0.05 and podzol[i, k]:
                w.set(x, y, z, RED_MUSH if r < 0.03 else BROWN_MUSH)
            elif r < 0.07:
                w.set(x, y, z, DEADBUSH if podzol[i, k] else SHORT_GRASS)
            elif r < 0.20 and not podzol[i, k]:
                w.set(x, y, z, SHORT_GRASS)
            continue
        if region == "ice":
            if r < (0.025 if grove[i, k] > 0.1 else 0.004) and clear_around(w, x, z, 3):
                trees += spruce_tree(w, x, y, z)
            elif r < 0.0275 and clear_around(w, x, z, 4):
                ice_spike(w, x, y, z)
            elif r < 0.10:
                w.set(x, y, z, SHORT_GRASS if r < 0.08 else FERN)
            continue
        if region in ("knight", "princess") and w.mountain_w[i, k] > 0.5:
            high = t > GROUND + 30
            if r < (0.006 if high else 0.02) and clear_around(w, x, z, 3):
                trees += spruce_tree(w, x, y, z)
            elif r < 0.25:
                w.set(x, y, z, SHORT_GRASS if r < 0.2 else FERN)
            continue
        if region == "knight":
            if r < (0.035 if grove[i, k] > 0.05 else 0.006) and clear_around(w, x, z, 3):
                trees += (dark_oak_tree if dark[i, k] > 0.1 else oak_tree)(w, x, y, z)
            elif r < 0.037 and clear_around(w, x, z, 3):
                boulder(w, x, t, z)
            elif r < 0.33:
                w.set(x, y, z, SHORT_GRASS if r < 0.25 else FERN)
            elif r < 0.37 and w.get(x, y + 1, z) == AIR:
                w.set(x, y, z, TALL_GRASS[0]); w.set(x, y + 1, z, TALL_GRASS[1])
            elif r < 0.395:
                w.set(x, y, z, POPPY if r < 0.385 else DANDELION)
            continue
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
    i, k = x - X0, z - Z0
    if i - r < 0 or k - r < 0 or i + r >= SX or k + r >= SZ:
        return False
    if w.no_plant[i - r:i + r + 1, k - r:k + r + 1].any():
        return False
    sub = w.b[i - r:i + r + 1, :, k - r:k + r + 1]
    return not np.isin(sub, TREE_PARTS).any()

def spruce_tree(w, x, y, z):
    rng = w.rng
    h = rng.randint(7, 13)
    for k in range(h):
        w.set(x, y + k, z, SPRUCE_LOG)
    for k in range(2, h + 2):
        top = h + 1 - k
        rr = 0.6 + top * 3.2 / h
        if k % 2 and k < h:
            rr -= 0.7
        ri = int(math.ceil(rr))
        for a in range(-ri, ri + 1):
            for c in range(-ri, ri + 1):
                if (a or c or k >= h) and a * a + c * c <= rr * rr + 0.3:
                    w.set(x + a, y + k, z + c, SPRUCE_LEAVES, only_air=True)
    w.set(x, y + h + 2, z, SPRUCE_LEAVES, only_air=True)
    return 1

def ice_spike(w, x, y, z):
    rng = w.rng
    tall = rng.random() < 0.25
    h = rng.randint(18, 30) if tall else rng.randint(6, 14)
    r0 = rng.uniform(1.2, 1.8) if tall else rng.uniform(1.8, 3.0)
    for k in range(-2, h):
        rr = r0 * (1 - max(k, 0) / h) ** 0.8 + 0.3
        ri = int(math.ceil(rr))
        for a in range(-ri, ri + 1):
            for c in range(-ri, ri + 1):
                if a * a + c * c <= rr * rr:
                    w.set(x + a, y + k, z + c, PACKED_ICE)
    w.spikes = getattr(w, "spikes", 0) + 1

def oak_tree(w, x, y, z):
    rng = w.rng
    h = rng.randint(4, 6)
    for k in range(h):
        w.set(x, y + k, z, OAK_LOG)
    for k in range(h - 2, h + 2):
        rr = 2.6 if k < h else 1.6
        ri = int(math.ceil(rr))
        for a in range(-ri, ri + 1):
            for c in range(-ri, ri + 1):
                if a * a + c * c <= rr * rr + rng.uniform(-0.8, 0.4):
                    w.set(x + a, y + k, z + c, OAK_LEAVES, only_air=True)
    return 1

def dark_oak_tree(w, x, y, z):
    rng = w.rng
    h = rng.randint(6, 9)
    for k in range(h):
        for a in (0, 1):
            for c in (0, 1):
                w.set(x + a, y + k, z + c, DARK_OAK_LOG)
    for a in (0, 1):
        for c in (0, 1):
            if w.get(x + a, y - 1, z + c) == AIR:
                w.set(x + a, y - 1, z + c, DIRT)
    for k in range(h - 2, h + 2):
        rr = 4.6 if k < h else 3.2 if k == h else 2.0
        ri = int(math.ceil(rr))
        for a in range(-ri, ri + 2):
            for c in range(-ri, ri + 2):
                if (a - 0.5) ** 2 + (c - 0.5) ** 2 <= rr * rr + rng.uniform(-1.5, 0.5):
                    w.set(x + a, y + k, z + c, DARK_OAK_LEAVES, only_air=True)
    return 1

def dead_tree(w, x, y, z):
    """A spooky bare tree: a dark trunk with crooked branches, sometimes a cobweb."""
    rng = w.rng
    h = rng.randint(4, 8)
    for k in range(h):
        w.set(x, y + k, z, DARK_OAK_LOG)
    for _ in range(rng.randint(2, 4)):
        dx, dz = rng.choice(((1, 0), (-1, 0), (0, 1), (0, -1)))
        by = y + rng.randint(h // 2, h - 1)
        L = rng.randint(2, 4)
        for s_ in range(1, L + 1):
            w.set(x + dx * s_, by + s_ // 2, z + dz * s_, DARK_OAK_LOG_X if dx else DARK_OAK_LOG_Z, only_air=True)
        if rng.random() < 0.3:
            w.set(x + dx * L, by + L // 2 - 1, z + dz * L, WEB, only_air=True)
    return 1

def boulder(w, x, t, z):
    rng = w.rng
    r = rng.uniform(1.5, 2.8)
    ri = int(math.ceil(r))
    for a in range(-ri, ri + 1):
        for c in range(-ri, ri + 1):
            for k in range(-1, ri + 1):
                if a * a + c * c + (k * 1.4) ** 2 <= r * r:
                    w.set(x + a, t + k, z + c, rng.choice((STONE, ANDESITE, MOSSY_COBBLE, COBBLESTONE)))

def tidy_plants(w):
    """Take away any plant left without soil under it (a boulder or ice spike landed next to it),
    and any half of a two-block plant whose other half is gone."""
    b = w.b
    below = np.zeros_like(b); below[:, 1:, :] = b[:, :-1, :]
    plants = FLOWERS + PETALS + [SHORT_GRASS, FERN, POPPY, DANDELION, TALL_GRASS[0]] + [lo for lo, _ in DOUBLE_FLOWERS]
    loose = np.isin(b, plants) & ~np.isin(below, [GRASS, DIRT])
    loose |= np.isin(b, [RED_MUSH, BROWN_MUSH]) & ~np.isin(below, [PODZOL, MYCELIUM])
    loose |= (b == DEADBUSH) & ~np.isin(below, [PODZOL, COARSE_DIRT, DIRT, RED_SAND])
    open_ = list(PASSABLE | {AIR})
    above = np.zeros_like(b); above[:, :-1, :] = b[:, 1:, :]
    loose |= (b == LICHEN_FLOOR) & np.isin(below, open_)
    loose |= (b == LICHEN_CEILING) & np.isin(above, open_)
    b[loose] = AIR
    for lo, hi in DOUBLE_FLOWERS + [TALL_GRASS]:
        below = np.zeros_like(b); below[:, 1:, :] = b[:, :-1, :]
        above = np.zeros_like(b); above[:, :-1, :] = b[:, 1:, :]
        b[(b == hi) & (below != lo)] = AIR
        b[(b == lo) & (above != hi)] = AIR

def snow_cover(w):
    """A thin layer of snow on the open ground, trees and ice spikes round the ice castle."""
    tops = {GRASS, SNOW, SPRUCE_LEAVES, PACKED_ICE, DIRT, STONE}
    n = 0
    for i in range(SX):
        for k in range(SZ):
            if (w.ice_w[i, k] < 0.45 and not w.snowcap[i, k]) or w.no_snow[i, k]:
                continue
            col = w.b[i, :, k]
            nz = np.nonzero(col)[0]
            if not len(nz):
                continue
            j = nz[-1]
            if col[j] in tops and j + 1 < H:
                col[j + 1] = SNOW_LAYER
                n += 1
            elif col[j] in (SHORT_GRASS, FERN) and j >= 1 and col[j - 1] == GRASS:
                col[j] = SNOW_LAYER
                n += 1
    w.snow_count = n

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
    tries = 0
    while len(spots) < 44 and tries < 5000:
        tries += 1
        cx, cz = rng.randint(X0 + 20, X1 - 20), rng.randint(Z0 + 20, Z1 - 20)
        if any(abs(cx - a) < 55 and abs(cz - b) < 60 for a, b in (PRINCESS, ICE, KNIGHT)) or \
                (abs(cx - SPOOKY[0]) < 85 and abs(cz - SPOOKY[1]) < 95) or \
                (abs(cx - SKY[0]) < 110 and abs(cz - SKY[1]) < 110) or \
                (abs(cx - BLAZE[0]) < 70 and abs(cz - BLAZE[1]) < 70):
            continue                                # keep the castle skies clear
        if any(math.hypot(cx - a, cz - b) < 55 for a, b, _ in spots):
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
    throne(w, 0, -2, F1 + 2, 5, PINK_CARPET)
    throne(w, -4, -2, F1 + 2, 3, LBLUE_CARPET)
    throne(w, 4, -2, F1 + 2, 3, LBLUE_CARPET)
    w.places["throne"] = (0, F1 + 2, 1)
    # chandeliers: from the floor-3 ceiling down through the balcony hole, and from the hall ceiling
    for (x, z, top) in ((0, 9, F3 - 1), (0, 4, F3 - 1), (-14, 2, F2 - 1), (14, 2, F2 - 1),
                        (-14, -12, F2 - 1), (14, -12, F2 - 1)):
        chandelier(w, x, z, top, -53 if top == F3 - 1 else -52)

def throne(w, x, z, y, tall, cushion, mat=None, back=None, deco=None, side=None):
    """A throne facing south: seat and arms at z, the back at z - 1."""
    mat = mat or GOLD
    back = back or mat
    w.set(x, y, z, mat); w.set(x, y + 1, z, cushion)
    w.set(x - 1, y, z, mat); w.set(x + 1, y, z, mat)
    for k in range(tall):
        for a in (-1, 0, 1):
            w.set(x + a, y + k, z - 1, back)
    w.set(x - 1, y + tall, z - 1, side or END_ROD_UP); w.set(x + 1, y + tall, z - 1, side or END_ROD_UP)
    w.set(x, y + tall, z - 1, deco or AMETHYST_CLUSTER)

def chandelier(w, x, z, top, low, hub=None, light=None, candle=-1):
    for y in range(low + 1, top + 1):
        w.set(x, y, z, CHAIN)
    for a, c in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
        w.set(x + a, low, z + c, hub or GOLD)
        if a or c:
            w.set(x + a, low - 1, z + c, light or HANGING_LANTERN)
            if candle:
                w.set(x + a, low + 1, z + c, PINK_CANDLE if candle == -1 else candle)
    w.set(x, low - 1, z, light or HANGING_LANTERN)

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

def ring_cells(sq=None):
    x0, x1, z0, z1 = sq or SQ
    cells = [(x, z1) for x in range(x0, x1 + 1)]                 # south row, going east
    cells += [(x1, z) for z in range(z1 - 1, z0 - 1, -1)]        # east column, going north
    cells += [(x, z0) for x in range(x1 - 1, x0 - 1, -1)]        # north row, going west
    cells += [(x0, z) for z in range(z0 + 1, z1)]                # west column, going south
    return cells

STEP0 = F1 + 1                                   # y of the first step

def big_round_tower(w, center, r, base, top, floors, shell_mat, band, floor_mat, glass, cone_colors, cone_h,
                    tip, flag, rail, rail_light):
    """A great round tower standing on a roof at `base`: hollow, with floors, a balcony round
    the top floor (floors[-1]), doors out onto the roof and the balcony (south), and a cone."""
    cx, cz = center
    R = r + 3
    d, X, Z = disk_mask(cx, cz, 0, int(cx - R), int(cx + R) + 1, int(cz - R), int(cz + R) + 1)
    shell = (d <= r + 0.35) & (d > r - 0.8)
    inner = d <= r - 0.8
    column_set(w, X, Z, shell, base, top, shell_mat)
    column_set(w, X, Z, inner, base + 1, top, AIR)
    for y in range(base + 6, top, 8):
        column_set(w, X, Z, shell, y, y, band)
    for y in floors:
        column_set(w, X, Z, inner, y, y, floor_mat)
    for y in range(base + 4, top - 1, 6):
        for ang in (45, 135, 225, 315, 0, 180):
            a = math.radians(ang)
            wx, wz = int(math.floor(cx + math.cos(a) * r + 0.5)), int(math.floor(cz + math.sin(a) * r + 0.5))
            w.set(wx, y, wz, glass); w.set(wx, y + 1, wz, glass)
    tf = floors[-1]
    bal = (d > r - 0.8) & (d <= r + 2.6)
    column_set(w, X, Z, bal & ~shell, tf, tf, floor_mat)
    railm = (d > r + 1.6) & (d <= r + 2.6)
    column_set(w, X, Z, railm, tf + 1, tf + 1, rail)
    for x, z in zip(X[railm], Z[railm]):
        if (x + z) % 3 == 0:
            w.set(int(x), tf + 2, int(z), rail_light)
    carve_door(w, cx, cz, r, base + 1, 90, width=1.6)
    carve_door(w, cx, cz, r, tf + 1, 90, width=1.6)
    cone(w, cx, cz, r + 1.6, top + 1, cone_h, cone_colors, flag=flag, tip=tip)
    w.places["balcony"] = (int(cx + 0.5), tf + 1, int(cz + r + 1.5))

def great_tower(w):
    big_round_tower(w, GT, GT_R, ROOF, 12, [MID, TOP], QUARTZ, PINK_C, SMOOTH_QUARTZ, PINK_GLASS,
                    (PINK_C, MAGENTA_C, PURPLE_C), 26, GOLD, MAGENTA_WOOL, QUARTZ, LANTERN)
    w.places["tower middle room"] = (-1, MID + 1, -17)

def spiral_stairs(w, sq, step0, top, floors, stairs, core, core_band, core_light, rail, rail_light, floor0=None, name=None):
    """A square ring of stairs round a solid core, one step up per block, from step0 to `top`.
    Each floor in `floors` has the step that's level with it, and a railing round the ring
    with a gap by that step."""
    x0, x1, z0, z1 = sq
    floor0 = step0 - 1 if floor0 is None else floor0
    cells = ring_cells(sq)
    n = len(cells)
    last = top - step0
    for x in range(x0 + 1, x1):
        for z in range(z0 + 1, z1):
            edge = x in (x0 + 1, x1 - 1) and z in (z0 + 1, z1 - 1)
            for y in range(floor0 + 1, top + 1):
                v = core
                if (y - floor0) % 7 == 0:
                    v = core_band
                if edge and (y - floor0) % 5 == 2:
                    v = core_light
                w.set(x, y, z, v)
    for (x, z) in cells:
        w.fill(x, x, floor0 + 1, top + 6, z, z, AIR)
    steps = []
    for i in range(last + 1):
        x, z = cells[i % n]
        nx, nz = cells[(i + 1) % n]
        dx, dz = nx - x, nz - z
        dirn = 0 if dx > 0 else 1 if dx < 0 else 2 if dz > 0 else 3
        w.set(x, step0 + i, z, stairs[dirn])
        steps.append((x, step0 + i, z))
    for fy in floors:
        i = fy - step0
        sx, sz = cells[i % n]
        for x in range(x0 - 1, x1 + 2):
            for z in range(z0 - 1, z1 + 2):
                if x in (x0 - 1, x1 + 1) or z in (z0 - 1, z1 + 1):
                    if max(abs(x - sx), abs(z - sz)) <= 1:
                        continue
                    w.set(x, fy + 1, z, rail)
                    if (x, z) in ((x0 - 1, z0 - 1), (x1 + 1, z0 - 1), (x0 - 1, z1 + 1), (x1 + 1, z1 + 1)):
                        w.set(x, fy + 2, z, rail_light)
    if hasattr(w, "save_stairs"):
        w.save_stairs(steps, floors, name)
    return steps

def stairwell(w):
    """The grand spiral staircase: from the grand hall all the way to the treasure room."""
    spiral_stairs(w, SQ, STEP0, TOP, [F2, F3, ROOF, MID, TOP], QSTAIRS, QUARTZ_PILLAR, PINK_C, SEA_LANTERN,
                  CHISELED_QUARTZ, LANTERN, floor0=F1)

def treasure_room(w):
    y = TOP + 1
    w.chest("treasure", -1, y, -17, TREASURE_ITEMS, facing="south")
    w.chest("tower treasure", 0, y, -17, LOOKOUT_TOWER_ITEMS, facing="south")
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

def stable_at(w, x0, x1, z0, z1, open_side, floor, post, fence, roof_a, roof_b, chest_name, items):
    """A little open stable: corner posts, a fenced side, two stalls, hay and a drinking trough."""
    y = GROUND + 1
    ox = x0 if open_side == "west" else x1
    back = x1 - 1 if open_side == "west" else x0 + 1
    for x in range(x0, x1 + 1):
        for z in range(z0, z1 + 1):
            w.set(x, GROUND, z, floor)
            w.fill(x, x, y, y + 3, z, z, AIR)
            if x in (x0, x1) or z in (z0, z1):
                if x in (x0, x1) and z in (z0, z1):
                    w.fill(x, x, y, y + 3, z, z, post)
                elif x == ox and z0 + 3 <= z <= z1 - 3:
                    pass                                   # wide opening
                else:
                    w.set(x, y, z, fence)
            w.set(x, y + 4, z, roof_a if (x + z) % 2 else roof_b)
    for z in range(z0 + 1, z1):
        if z % 3:
            w.set(back, y, z, HAY)
        else:
            w.set(back, GROUND, z, WATER)               # a drinking trough sunk into the floor
    xs = range(x0 + 3, x1 - 1) if open_side == "west" else range(x0 + 2, x1 - 2)
    for z in (z0 + 3, z1 - 3):
        for x in xs:
            w.set(x, y, z, fence)
    lx = x0 + 2 if open_side == "west" else x1 - 2
    for z in (z0 + 1, z1 - 1):
        w.set(lx, y + 3, z, HANGING_LANTERN)
    cx = x0 + 1 if open_side == "west" else x1 - 1
    w.chest(chest_name, cx, y, z0 + 1, items, facing="south")
    w.places[chest_name] = (lx, y, (z0 + z1) // 2)

def stable(w):
    """The unicorn stable, on the east side of the palace."""
    stable_at(w, 24, 32, -8, 2, "west", CHERRY_PLANKS, CHERRY_LOG, CHERRY_FENCE, PINK_C, WHITE_C, "stable", STABLE_ITEMS)

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

# ---------------------------------------------------------------- underground: ores, caves and cave entrances
ORE_KINDS = {  # name: (shallowest gen y, weight)   (gen y -96 is the game's y 0)
    "coal": (40, 5.0), "iron": (40, 4.0), "copper": (40, 2.0), "gold": (-105, 2.0), "lapis": (-100, 1.5),
    "redstone": (-115, 2.0), "diamond": (-132, 1.2), "emerald": (-100, 0.35)}
ORE_BLOCKS = {k: (blk(k + "_ore"), blk("deepslate_" + k + "_ore")) for k in ORE_KINDS}
NATURAL = None   # filled in below, once all the stone-ish blocks exist

def natural_ids():
    return np.array(sorted({STONE, DEEPSLATE, DIRT, ANDESITE, TUFF, GRAVEL} |
                           {a for p in ORE_BLOCKS.values() for a in p}), np.uint16)

def add_ores(w):
    """Ore veins through the stone and deepslate (more of the good stuff deeper down)."""
    rng = random.Random(w.seed + 77)
    kinds = list(ORE_KINDS)
    n = 0
    for _ in range(26000):
        x, z = rng.randrange(X0, X1), rng.randrange(Z0, Z1)
        top = int(w.ground[x - X0, z - Z0]) - 6
        y = rng.randint(MIN_Y + 2, max(MIN_Y + 3, top))
        ok = [k for k in kinds if y <= ORE_KINDS[k][0]]
        kind = rng.choices(ok, [ORE_KINDS[k][1] for k in ok])[0]
        plain, deep = ORE_BLOCKS[kind]
        for _ in range(rng.randint(2, 8) if kind not in ("diamond", "emerald") else rng.randint(1, 4)):
            cur = w.get(x, y, z)
            if cur == STONE:
                w.set(x, y, z, plain); n += 1
            elif cur == DEEPSLATE:
                w.set(x, y, z, deep); n += 1
            x += rng.choice((-1, 0, 1)); y += rng.choice((-1, 0, 1)); z += rng.choice((-1, 0, 1))
    w.ore_count = n

def cave_exclusion(w):
    """Columns caves must stay away from: the castles (and their tunnels) and anything with water."""
    from scipy.ndimage import binary_dilation
    ex = np.zeros((SX, SZ), bool)
    for (cx, cz) in (PRINCESS, ICE, KNIGHT, SPOOKY, SKY, BLAZE):
        ex[max(0, cx - 100 - X0):cx + 101 - X0, max(0, cz - 100 - Z0):cz + 101 - Z0] = True
    wet = (w.b == WATER).any(axis=1)
    ex |= binary_dilation(wet, iterations=6)
    return ex

def carve_ball(w, cx, cy, cz, rx, ry, rz, nat, ex=None, ceil=None):
    x0, x1 = int(max(X0, cx - rx - 1)), int(min(X1 - 1, cx + rx + 1))
    z0, z1 = int(max(Z0, cz - rz - 1)), int(min(Z1 - 1, cz + rz + 1))
    y0, y1 = int(max(MIN_Y + 1, cy - ry - 1)), int(min(MAX_Y - 1, cy + ry + 1))
    if x0 > x1 or z0 > z1 or y0 > y1:
        return
    sub = w.b[x0 - X0:x1 - X0 + 1, y0 - MIN_Y:y1 - MIN_Y + 1, z0 - Z0:z1 - Z0 + 1]
    X, Y, Z = np.ogrid[x0:x1 + 1, y0:y1 + 1, z0:z1 + 1]
    m = ((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2 + ((Z - cz) / rz) ** 2 <= 1
    if ex is not None:
        m &= ~ex[x0 - X0:x1 - X0 + 1, None, z0 - Z0:z1 - Z0 + 1]
    if ceil is not None:
        m &= Y <= ceil[x0 - X0:x1 - X0 + 1, None, z0 - Z0:z1 - Z0 + 1]
    m &= np.isin(sub, nat)
    sub[m] = AIR

def caves(w):
    """Winding cave tunnels and big caverns all through the underground, kept well below the
    surface and away from the castles and from water. A dozen sloping entrances near the roads
    lead down into caverns, and many tunnels start from those so the entrances join up."""
    rng = random.Random(w.seed + 78)
    nat = natural_ids()
    ex = cave_exclusion(w)
    ceil = w.ground - 8
    starts = []
    # --- entrances near the roads
    w.cave_entrances = []
    curves = list(w.road_curves.values())
    tries = 0
    while len(w.cave_entrances) < 12 and tries < 3000:
        tries += 1
        c = rng.choice(curves)
        i = rng.randrange(20, len(c) - 21)
        (ax, az), (bx, bz) = c[i], c[i + 4]
        d = np.array([bx - ax, bz - az]); d = d / (np.hypot(*d) + 1e-9)
        side = rng.choice((-1, 1))
        px, pz = -d[1] * side, d[0] * side
        mx, mz = int(round(ax + px * 9)), int(round(az + pz * 9))
        dx, dz = (int(np.sign(px)), 0) if abs(px) >= abs(pz) else (0, int(np.sign(pz)))
        far_x, far_z = mx + dx * 60, mz + dz * 60
        if not (X0 + 30 <= min(mx, far_x) and max(mx, far_x) < X1 - 30 and Z0 + 30 <= min(mz, far_z) and max(mz, far_z) < Z1 - 30):
            continue
        lo_x, hi_x, lo_z, hi_z = min(mx, far_x) - 14, max(mx, far_x) + 14, min(mz, far_z) - 14, max(mz, far_z) + 14
        if ex[lo_x - X0:hi_x - X0, lo_z - Z0:hi_z - Z0].any():
            continue
        if any(abs(mx - a) < 80 and abs(mz - b) < 80 for a, b, *_ in w.cave_entrances):
            continue
        if w.no_plant[mx - 3 - X0:mx + 4 - X0, mz - 3 - Z0:mz + 4 - Z0].any():
            continue
        t = int(w.ground[mx - X0, mz - Z0])
        L = t - (-100)
        ux, uz = (px, pz) if abs(px) > abs(pz) else (px, pz)
        dx, dz = (int(np.sign(px)), 0) if abs(px) >= abs(pz) else (0, int(np.sign(pz)))
        for k in range(L):
            fx, fz, fy = mx + dx * k, mz + dz * k, t - k
            for o in (-1, 0, 1):
                cx_, cz_ = fx + dz * o, fz + dx * o
                w.fill(cx_, cx_, fy + 1, fy + 4, cz_, cz_, AIR)
                if w.get(cx_, fy, cz_) in (AIR, WATER):
                    w.set(cx_, fy, cz_, STONE)
            if k % 9 == 4:
                w.set(fx, fy + 1, fz, LICHEN_FLOOR)
        ex_x, ex_z, ex_y = mx + dx * (L + 6), mz + dz * (L + 6), -100
        carve_ball(w, ex_x, ex_y + 3, ex_z, 10, 6, 10, nat)
        for (o, h) in ((-2, 0), (2, 0)):
            lamp_post(w, mx + dz * o - dx, t + 1, mz + dx * o - dz, 2, OAK_FENCE, LANTERN)
        for o in (-2, -1, 0, 1, 2):
            w.set(mx + dz * o - dx, t, mz + dx * o - dz, MOSSY_COBBLE)
        w.protect(mx - 4, mx + 4 + dx * 6, mz - 4, mz + 4 + dz * 6)
        w.cave_entrances.append((mx, mz, t, dx, dz, L))
        starts += [(ex_x, ex_y + 2, ex_z)] * 6
    # --- big caverns
    for _ in range(40):
        for _ in range(200):
            x, z = rng.randrange(X0 + 20, X1 - 20), rng.randrange(Z0 + 20, Z1 - 20)
            if not ex[x - X0, z - Z0]:
                break
        y = rng.randint(-140, -105)
        carve_ball(w, x, y, z, rng.uniform(8, 15), rng.uniform(5, 8), rng.uniform(8, 15), nat, ex, ceil)
        starts += [(x, y, z)] * 2
    # --- winding tunnels
    for i in range(170):
        if starts and rng.random() < 0.7:
            x, y, z = rng.choice(starts)
        else:
            x, z, y = rng.randrange(X0 + 10, X1 - 10), rng.randrange(Z0 + 10, Z1 - 10), rng.randint(-150, -80)
        yaw, pitch = rng.uniform(0, 2 * math.pi), rng.uniform(-0.2, 0.2)
        x, y, z = float(x), float(y), float(z)
        for step in range(rng.randint(100, 260)):
            r = 1.8 + 1.2 * (1 + math.sin(step / 9.0 + i)) / 2 + rng.uniform(0, 0.6)
            carve_ball(w, x, y, z, r * 1.2, r, r * 1.2, nat, ex, ceil)
            yaw += rng.uniform(-0.25, 0.25)
            pitch = max(-0.35, min(0.35, pitch + rng.uniform(-0.08, 0.08)))
            x += math.cos(yaw) * math.cos(pitch) * 1.4
            z += math.sin(yaw) * math.cos(pitch) * 1.4
            y += math.sin(pitch) * 1.4
            if y < -150 or y > -75:
                pitch = -pitch; y = max(-150, min(-75, y))
            if not (X0 + 4 <= x < X1 - 4 and Z0 + 4 <= z < Z1 - 4) or ex[int(x) - X0, int(z) - Z0]:
                yaw += math.pi
                x += math.cos(yaw) * 3; z += math.sin(yaw) * 3
                x = min(max(x, X0 + 5), X1 - 6); z = min(max(z, Z0 + 5), Z1 - 6)

def cave_glow(w):
    """Glowing lichen on cave floors and ceilings, so the caves aren't pitch black."""
    rng = np.random.default_rng(w.seed + 79)
    nat = natural_ids()
    n = 0
    for i0 in range(0, SX, 64):
        sl = w.b[i0:i0 + 64]
        g = w.ground[i0:i0 + 64]
        ys = (np.arange(H) + MIN_Y)[None, :, None]
        deep = ys < g[:, None, :] - 4
        air = (sl == AIR) & deep
        below = np.zeros_like(air); below[:, 1:, :] = np.isin(sl[:, :-1, :], nat)
        above = np.zeros_like(air); above[:, :-1, :] = np.isin(sl[:, 1:, :], nat)
        r = rng.random(sl.shape)
        f = air & below & (r < 0.035)
        c = air & above & ~below & (r > 0.985)
        sl[f] = LICHEN_FLOOR
        sl[c] = LICHEN_CEILING
        n += int(f.sum() + c.sum())
    w.glow_count = n

# ---------------------------------------------------------------- roads between the castles
JUNCTION = (0, 56)
# One road from castle to castle, in story order: Princess -> Ice -> Knight -> Haunted Mountain.
ROADS = {
    "princess-ice": [JUNCTION, (-60, 58), (-105, 55), (-150, 5), (-200, -80), (-260, -170), (-310, -225),
                     (-320, -250), (ICE[0], ICE[1] + 54)],
    # comes in from the west, straight at the fortress gate, with a right-angle turn north to the mountain
    # Blaze Castle faces west too: straight in from the Ice Palace, a right-angle turn south for the knights
    "ice-blaze": [(-320, -250), (-260, -252), (-160, -258), (-110, -260), (-80, -260), (BLAZE[0] - 54, BLAZE[1])],
    "blaze-knight": [(-80, -260), (-80, -235), (-76, -200), (-35, -186), (55, -190), (120, -228), (165, -285),
                     (190, -320), (212, -320), (KNIGHT[0] - 54, KNIGHT[1])],   # the fortress gate (it faces west)
    "knight-spooky": [(212, -320), (212, -345), (212, -372), (190, -405), (110, -410), (40, -404), (0, -400),
                      (SPOOKY[0], SPOOKY[1] + 54)],
    "spooky-sky": [(0, -400), (-45, -398), (-115, -415), (-175, -470), (-225, -520), (SKY[0], SKY[1] + 70),
                   (SKY[0], SKY[1] + 54)],
}

def catmull(points, step=0.25):
    pts = [points[0]] + list(points) + [points[-1]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = (np.array(p, float) for p in pts[i - 1:i + 3])
        n = max(2, int(np.hypot(*(p2 - p1)) / step))
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(np.array(points[-1], float))
    return np.array(out)

def plan_roads(w):
    """Lay out the roads (before the ground, so the hills flatten out along them)."""
    w.road_mask = np.zeros((SX, SZ), bool)
    w.road_curves = {}
    w.road_length = {}
    for name, pts in ROADS.items():
        c = catmull(pts)
        w.road_curves[name] = c
        w.road_length[name] = float(np.sum(np.hypot(*np.diff(c, axis=0).T)))
        for (x, z) in c:
            for a in range(int(x - 2), int(x + 3)):
                for b in range(int(z - 2), int(z + 3)):
                    if (a + 0.5 - x) ** 2 + (b + 0.5 - z) ** 2 <= 1.7 ** 2 and X0 <= a < X1 and Z0 <= b < Z1:
                        w.road_mask[a - X0, b - Z0] = True

def region_of(w, x, z):
    i, k = x - X0, z - Z0
    if w.spooky_w[i, k] > 0.5:
        return "spooky"
    if w.blaze_w[i, k] > 0.5:
        return "blaze"
    if w.ice_w[i, k] > 0.5:
        return "ice"
    if w.knight_w[i, k] > 0.5:
        return "knight"
    return "princess"

LAMPS = {"princess": (CHERRY_FENCE, LANTERN), "ice": (SPRUCE_FENCE, SOUL_LANTERN), "knight": (DARK_OAK_FENCE, LANTERN),
         "spooky": (DARK_OAK_FENCE, LIT_PUMPKIN["south"]), "blaze": (NETHER_FENCE, LANTERN)}

def draw_roads(w):
    for (i, k) in np.argwhere(w.road_mask):
        x, z = i + X0, k + Z0
        w.set(x, GROUND, z, GRASS_PATH)
        w.fill(x, x, GROUND + 1, GROUND + 5, z, z, AIR)
        w.protect(x - 2, x + 2, z - 2, z + 2)
    # lantern posts every 20 blocks, on alternating sides
    for name, c in w.road_curves.items():
        dist, nxt, side = 0.0, 10.0, 1
        for a, b in zip(c, c[1:]):
            dist += float(np.hypot(*(b - a)))
            if dist >= nxt:
                nxt += 20
                d = (b - a) / (np.hypot(*(b - a)) + 1e-9)
                px, pz = int(round(a[0] - d[1] * 3 * side)), int(round(a[1] + d[0] * 3 * side))
                side = -side
                if not (X0 + 2 <= px < X1 - 2 and Z0 + 2 <= pz < Z1 - 2) or w.road_mask[px - X0, pz - Z0]:
                    continue
                if w.get(px, GROUND, pz) in (GRASS, DIRT) and w.get(px, GROUND + 1, pz) == AIR:
                    post, light = LAMPS[region_of(w, px, pz)]
                    lamp_post(w, px, GROUND + 1, pz, 2, post, light)
                    w.protect(px - 1, px + 1, pz - 1, pz + 1)

def frozen_ponds(w):
    """A few frozen ponds in the snowy land round the ice castle."""
    rng = w.rng
    made = 0
    tries = 0
    while made < 5 and tries < 400:
        tries += 1
        cx, cz = ICE[0] + rng.randint(-170, 170), ICE[1] + rng.randint(-150, 170)
        if not (X0 + 20 <= cx < X1 - 20 and Z0 + 20 <= cz < Z1 - 20):
            continue
        if max(abs(cx - ICE[0]), abs(cz - ICE[1])) < 75 or w.ice_w[cx - X0, cz - Z0] < 0.9:
            continue
        rx, rz = rng.uniform(6, 11), rng.uniform(5, 9)
        box = (slice(int(cx - rx) - 3 - X0, int(cx + rx) + 4 - X0), slice(int(cz - rz) - 3 - Z0, int(cz + rz) + 4 - Z0))
        if w.no_plant[box].any():
            continue
        cells = [(x, z) for x in range(int(cx - rx), int(cx + rx) + 1) for z in range(int(cz - rz), int(cz + rz) + 1)
                 if ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 <= 1]
        top = min(int(w.ground[x - X0, z - Z0]) for x, z in cells)
        for x, z in cells:
            w.fill(x, x, top - 2, top - 1, z, z, WATER)
            w.set(x, top, z, PACKED_ICE)
            w.fill(x, x, top + 1, top + 12, z, z, AIR)
        w.protect(int(cx - rx) - 2, int(cx + rx) + 2, int(cz - rz) - 2, int(cz + rz) + 2, snow=True)
        made += 1
    w.pond_count = made

# ---------------------------------------------------------------- the ice palace
I_C = (-0.5, -4.5)            # palace (and great spire) centre, local
I_R = 20
I_SQ = (-4, 3, -8, -1)
IW0, IW1 = 37.5, 40.4         # round outer wall, inside and outside radius

def snowman(w, x, y, z, facing="south"):
    w.set(x, y, z, SNOW); w.set(x, y + 1, z, SNOW); w.set(x, y + 2, z, PUMPKIN_HEAD[facing])

def ice_outer(v):
    for x in range(-52, 53):
        for z in range(-52, 53):
            d = math.hypot(x, z)
            if 44 <= d <= 49.5:
                v.fill(x, x, GROUND - 2, GROUND - 1, z, z, WATER)
                v.set(x, GROUND, z, PACKED_ICE)
                v.fill(x, x, GROUND + 1, GROUND + 8, z, z, AIR)
            elif IW0 <= d <= IW1:
                v.fill(x, x, GROUND - 2, WALL_TOP, z, z, PACKED_ICE)
                v.set(x, WALL_TOP - 3, z, BLUE_ICE)
                v.set(x, WALL_TOP, z, SNOW)
                if d > 39.4 and (x + z) % 2 == 0:
                    v.set(x, WALL_TOP + 1, z, PACKED_ICE)
            elif d < IW0:
                v.set(x, GROUND, z, SNOW)
                v.fill(x, x, GROUND + 1, GROUND + 12, z, z, AIR)
    v.protect(-53, 53, -53, 53, snow=True)
    # gate arch, and a bridge over the frozen moat to the road
    for x in range(-3, 4):
        for z in range(30, 43):
            if IW0 - 0.6 <= math.hypot(x, z) <= IW1 + 0.6:
                top = -55 if abs(x) <= 1 else (-56 if abs(x) <= 2 else -57)
                v.fill(x, x, GROUND + 1, top, z, z, AIR)
    v.set(0, -54, 40, DIAMOND)
    v.set(-1, -54, 40, DIAMOND)
    for z in range(14, 54):
        for x in range(-2, 2):
            v.set(x, GROUND, z, (WHITE_C if x in (-2, 1) else LBLUE_C) if z < 41 else SPRUCE_PLANKS)
        if z >= 41:
            for x in (-3, 2):
                v.set(x, GROUND, z, SPRUCE_PLANKS)
                v.set(x, GROUND + 1, z, SPRUCE_FENCE)
    for x in (-3, 2):
        v.set(x, GROUND + 2, 53, SOUL_LANTERN)
        v.set(x, GROUND + 2, 43, SOUL_LANTERN)
    # stairs up onto the wall, either side of the gate
    for xs, d in (((14, 15), 2), ((-15, -14), 2)):
        for x in xs:
            for t in range(12):
                z, y = 23 + t, GROUND + 1 + t
                v.fill(x, x, GROUND + 1, y - 1, z, z, PACKED_ICE)
                v.set(x, y, z, QSTAIRS[d])
    # ice spires round the wall, with little rooms on the wall walk
    angs = [0, 45, 135, 180, 225, 270, 315, 79, 101]
    for ang in angs:
        a = math.radians(ang)
        cx, cz = 39 * math.cos(a), 39 * math.sin(a)
        tall = -38 if ang not in (79, 101) else -42
        tower(v, cx, cz, 4, GROUND - 2, tall, 16, (LBLUE_C, WHITE_C, LBLUE_GLASS), room=(WALL_TOP, [ang + 90, ang - 90]),
              band=BLUE_ICE, glass=LBLUE_GLASS, flag=LBLUE_WOOL, body=PACKED_ICE, floor=SNOW, light=SOUL_LANTERN,
              tip=DIAMOND)
    v.places["wall walk"] = (19, WALL_TOP + 1, 33)
    v.places["spire room"] = (28, WALL_TOP + 1, 28)

def ice_palace(v):
    cx, cz = I_C
    R = I_R
    for x in range(-23, 23):
        for z in range(-28, 20):
            d = math.hypot(x - cx, z - cz)
            if d > R + 0.35:
                continue
            if d > R - 1.65:
                v.fill(x, x, F1, ROOF, z, z, PACKED_ICE)
                if d > R - 0.65:
                    for y in (F2 - 1, F3 - 1, ROOF - 1):
                        v.set(x, y, z, BLUE_ICE)
                    v.set(x, ROOF + 1, z, SNOW)
                    if (x + z) % 2 == 0:
                        v.set(x, ROOF + 2, z, PACKED_ICE)
                ang = math.degrees(math.atan2(z - cz, x - cx)) % 360
                near = min(abs((ang - t + 180) % 360 - 180) for t in (90, 45, 135, 225, 315))
                if (ang + 2.5) % 24 < 5 and near > 13:
                    g = LBLUE_GLASS if int(ang // 24) % 2 else WHITE_GLASS
                    for rows in (range(-57, -51), range(F2 + 2, F2 + 6), range(F3 + 2, F3 + 6)):
                        for y in rows:
                            v.set(x, y, z, g)
            else:
                v.fill(x, x, F1 + 1, ROOF - 1, z, z, AIR)
                v.set(x, F1, z, SNOW if (x + z) % 2 else LBLUE_C)
                v.set(x, F2, z, WHITE_C)
                v.set(x, F3, z, PACKED_ICE if d < R - 4.5 else SNOW)
                v.set(x, ROOF, z, SNOW)
    for x in range(-15, 16, 6):
        for z in range(-19, 12, 6):
            if math.hypot(x - cx, z - cz) < R - 3 and not (-6 <= x <= 5 and -10 <= z <= 1):
                for y in (F2, F3, ROOF):
                    v.set(x, y, z, SEA_LANTERN)
    carve_door(v, cx, cz, R, F1 + 1, 90, width=2.2, height=7, depth=2.6)
    for x in (-3, 2):
        v.set(x, -52, int(cz + R), DIAMOND)
    # --- the frozen throne room
    for z in range(0, 16):
        for x in range(-2, 2):
            if v.get(x, F1 + 1, z) == AIR:
                v.set(x, F1 + 1, z, LBLUE_CARPET if x in (-1, 0) else WHITE_CARPET)
    for k in range(12):
        ang = k * 30
        if ang in (90, 270):
            continue
        a = math.radians(ang)
        px, pz = int(round(cx + 13.5 * math.cos(a))), int(round(cz + 13.5 * math.sin(a)))
        v.fill(px, px, F1 + 1, F2 - 1, pz, pz, PACKED_ICE)
        v.set(px, F2 - 1, pz, SEA_LANTERN)
    for x in range(-6, 6):
        for z in range(-20, -15):
            v.set(x, F1 + 1, z, PACKED_ICE)
    for x in range(-2, 2):
        v.set(x, F1 + 1, -15, QSTAIRS[3])
    throne(v, -1, -18, F1 + 2, 6, LBLUE_CARPET, mat=BLUE_ICE, back=PACKED_ICE, deco=DIAMOND, side=END_ROD_UP)
    throne(v, -5, -18, F1 + 2, 3, WHITE_CARPET, mat=BLUE_ICE, back=PACKED_ICE, deco=END_ROD_UP)
    throne(v, 3, -18, F1 + 2, 3, WHITE_CARPET, mat=BLUE_ICE, back=PACKED_ICE, deco=END_ROD_UP)
    for (x, z) in ((-12, 8), (11, 8)):
        snowman(v, x, F1 + 1, z)
    for (x, z) in ((-10, -4), (9, -4), (-1, 8)):
        chandelier(v, x, z, F2 - 1, -52, hub=DIAMOND, light=HANGING_SOUL_LANTERN, candle=LBLUE_CANDLE)
    v.places["throne"] = (-1, F1 + 2, -13)
    # --- second floor: the snow queen's bedroom (west) and the gem room (east)
    y0, y1 = F2 + 1, F3 - 1
    for x in (-8, 7):
        for z in range(-24, 17):
            if math.hypot(x - cx, z - cz) < R - 1.65:
                for y in range(y0, y1 + 1):
                    if not (-6 <= z <= -4 and y <= y0 + 2):
                        v.set(x, y, z, PACKED_ICE if y > y0 else BLUE_ICE)
    for x in range(-19, -8):
        for z in range(-24, 16):
            if math.hypot(x - cx, z - cz) < R - 1.65 and v.get(x, y0, z) == AIR:
                v.set(x, y0, z, WHITE_CARPET)
    v.bed(-15, y0, -8, 1, color=3)
    v.bed(-15, y0, -1, 1, color=3)
    v.set(-17, y0, -5, SPRUCE_PLANKS); v.set(-17, y0 + 1, -5, SOUL_LANTERN)
    v.chest("wardrobe", -12, y0, -14, ICE_WARDROBE_ITEMS, facing="south")
    v.set(-14, y0, -12, SPRUCE_PLANKS); v.set(-14, y0 + 1, -12, CAKE)
    v.set(-10, y0, -14, SPRUCE_PLANKS); v.set(-10, y0 + 1, -14, LBLUE_CANDLE)
    v.set(-12, y0, 6, SPRUCE_PLANKS); v.set(-12, y0 + 1, 6, LBLUE_CANDLE)
    v.places["bedroom"] = (-12, y0, -4)
    for (x, z, m) in ((11, -12, DIAMOND), (14, -7, EMERALD_BLOCK), (14, -1, LAPIS_BLOCK), (11, 4, AMETHYST),
                      (10, -4, GOLD)):
        v.set(x, y0, z, m); v.set(x, y0 + 1, z, AMETHYST_CLUSTER)
    v.chest("gems", 16, y0, -4, ICE_GEM_ITEMS, facing="west")
    v.places["gem room"] = (11, y0, -2)
    # --- third floor: an indoor ice rink
    for (x, z) in ((-12, -14), (11, -14), (-12, 6), (11, 6)):
        snowman(v, x, F3 + 1, z)
    v.places["ice rink"] = (-10, F3 + 1, 2)
    # --- spires on the palace rim, the great spire and the grand staircase
    for ang in (45, 135, 225, 315):
        a = math.radians(ang)
        tx, tz = cx + R * math.cos(a), cz + R * math.sin(a)
        tower(v, tx, tz, 4, F1, -22, 18, (LBLUE_C, WHITE_C, LBLUE_GLASS), room=(ROOF, [ang + 180]), band=BLUE_ICE,
              glass=LBLUE_GLASS, flag=LBLUE_WOOL, body=PACKED_ICE, floor=SNOW, light=SOUL_LANTERN, tip=DIAMOND)
    v.places["palace spire room"] = (int(round(cx + R * 0.7071)), ROOF + 1, int(round(cz + R * 0.7071)))
    big_round_tower(v, I_C, 9, ROOF, 12, [MID, TOP], PACKED_ICE, BLUE_ICE, WHITE_C, LBLUE_GLASS,
                    (WHITE_C, LBLUE_C, LBLUE_GLASS), 34, DIAMOND, LBLUE_WOOL, SNOW, SOUL_LANTERN)
    v.places["tower middle room"] = (-1, MID + 1, -11)
    spiral_stairs(v, I_SQ, STEP0, TOP, [F2, F3, ROOF, MID, TOP], QSTAIRS, PACKED_ICE, BLUE_ICE, SEA_LANTERN,
                  SNOW, SOUL_LANTERN, floor0=F1)
    v.places["roof"] = (12, ROOF + 1, 6)
    y = TOP + 1
    v.chest("treasure", -1, y, -11, ICE_TREASURE_ITEMS, facing="south")
    v.chest("spire treasure", 0, y, -11, ICE_SPYGLASS_ITEMS, facing="south")
    for (x, z) in ((-3, -11), (2, -11), (-7, -3), (6, -3)):
        if v.get(x, y, z) == AIR and v.get(x, y - 1, z) != AIR:
            v.set(x, y, z, DIAMOND)
            v.set(x, y + 1, z, AMETHYST_CLUSTER)
    v.places["treasure room"] = (0, y, -11)

def ice_courtyard(v):
    y = GROUND + 1
    # crystal sculptures either side of the path
    for sx in (-7, 6):
        for a in range(-1, 2):
            for c in range(-1, 2):
                v.set(sx + a, y, 27 + c, PACKED_ICE)
        v.set(sx, y + 1, 27, SEA_LANTERN)
        for k in range(2, 9):
            rr = 1.6 * (1 - (k - 2) / 7) + 0.3
            for a in range(-2, 3):
                for c in range(-2, 3):
                    if a * a + c * c <= rr * rr:
                        v.set(sx + a, y + k, 27 + c, BLUE_ICE)
    for (x, z) in ((-4, 20), (3, 20), (-4, 34), (3, 34)):
        lamp_post(v, x, y, z, 2, SPRUCE_FENCE, SOUL_LANTERN)
    # skating rink
    for x in range(-32, -15):
        for z in range(10, 23):
            e = ((x + 24) / 7.5) ** 2 + ((z - 16) / 5.0) ** 2
            if e <= 1:
                v.set(x, GROUND, z, PACKED_ICE)
            elif e <= 1.5:
                v.set(x, GROUND, z, BLUE_ICE)
    v.places["skating rink"] = (-24, y, 22)
    # igloo
    ix, iz = 24, 14
    for x in range(ix - 6, ix + 7):
        for z in range(iz - 6, iz + 7):
            for k in range(0, 6):
                d = math.sqrt((x - ix) ** 2 + (z - iz) ** 2 + (k * 1.15) ** 2)
                if d <= 5.1:
                    v.set(x, y + k, z, SNOW if d > 3.9 else AIR)
            if math.hypot(x - ix, z - iz) <= 3.9:
                v.set(x, y, z, WHITE_CARPET)
    for x in range(ix - 6, ix - 2):
        for z in (iz - 1, iz, iz + 1):
            for k in (0, 1):
                v.set(x, y + k, z, AIR)
            v.set(x, y + 2, z, SNOW) if x <= ix - 4 else None
    v.chest("igloo", ix + 2, y, iz, IGLOO_ITEMS, facing="west")
    v.set(ix, y, iz + 2, SOUL_LANTERN)
    v.set(ix, y, iz - 2, SOUL_LANTERN)
    v.places["igloo"] = (ix - 1, y, iz)
    for (x, z) in ((-10, 33), (9, 33), (20, -24), (-20, -24), (-30, 8)):
        snowman(v, x, y, z)
    for (x, z) in ((-21, -27), (21, -27), (31, -6), (29, 3)):
        spruce_tree(v, x, y, z)
    stable_at(v, -34, -26, -6, 4, "east", SPRUCE_PLANKS, SPRUCE_LOG, SPRUCE_FENCE, LBLUE_C, WHITE_C, "stable",
              STABLE_ITEMS)

def ice_castle(w):
    v = View(w, ICE[0], ICE[1], "ice ")
    ice_outer(v)
    ice_palace(v)
    ice_courtyard(v)
    ice_secret(v)

# ---------------------------------------------------------------- the knight's fortress
K_SQ = (-4, 3, -11, -4)
KX0_, KX1_, KZ0_, KZ1_ = -22, 22, -26, 14
K_WALL_TOP = -47
DRAGON = (28, 66)           # the dragon statue, outside the walls beside the road in (local)
KNIGHT_ROT = 1              # the fortress is turned so its gate faces west, toward the road from the Ice Palace

def knight_to_world(x, z):
    for _ in range(KNIGHT_ROT):
        x, z = -z, x
    return KNIGHT[0] + x, KNIGHT[1] + z
KT = (-9, 8, -16, 1)          # great tower box x0, x1, z0, z1

def bricks(rng):
    r = rng.random()
    return MOSSY_BRICKS if r < 0.12 else CRACKED_BRICKS if r < 0.2 else STONE_BRICKS

def banner(w, x0, x1, z0, z1, top, length):
    """A red banner with a gold stripe hanging down a wall, `top` downwards."""
    for x in range(x0, x1 + 1):
        for z in range(z0, z1 + 1):
            for k in range(length):
                y = top - k
                w.set(x, y, z, YELLOW_WOOL if k in (2, length - 3) else RED_WOOL)

def square_tower(v, cx, cz, half, y0, top, room=None, doors=(), banners=()):
    rng = v.rng
    for x in range(cx - half, cx + half + 1):
        for z in range(cz - half, cz + half + 1):
            edge = abs(x - cx) == half or abs(z - cz) == half
            corner = abs(x - cx) == half and abs(z - cz) == half
            for y in range(y0, top + 1):
                v.set(x, y, z, POLISHED_BLACKSTONE if corner else bricks(rng))
            if edge:
                v.set(x, top + 1, z, STONE_BRICKS)
                if (x + z) % 2 == 0:
                    v.set(x, top + 2, z, STONE_BRICKS)
    for y in range(y0 + 8, top - 2, 6):
        for (x, z) in ((cx - half, cz), (cx + half, cz), (cx, cz - half), (cx, cz + half)):
            v.set(x, y, z, GRAY_GLASS); v.set(x, y + 1, z, GRAY_GLASS)
    if room is not None:
        fy = room
        v.fill(cx - half + 2, cx + half - 2, fy + 1, top - 1, cz - half + 2, cz + half - 2, AIR)
        v.fill(cx - half + 2, cx + half - 2, fy, fy, cz - half + 2, cz + half - 2, DARK_OAK_PLANKS)
        for side in doors:
            if side in "ew":
                x0 = cx + half - 1 if side == "e" else cx - half
                v.fill(x0, x0 + 1, fy + 1, fy + 3, cz - 1, cz + 1, AIR)
            else:
                z0 = cz + half - 1 if side == "s" else cz - half
                v.fill(cx - 1, cx + 1, fy + 1, fy + 3, z0, z0 + 1, AIR)
        for (a, c) in ((-1, -1), (1, 1)):
            v.set(cx + a * (half - 2), fy + 1, cz + c * (half - 2), LANTERN)
    for side in banners:
        if side == "s":
            banner(v, cx - 1, cx + 1, cz + half + 1, cz + half + 1, top - 2, 9)
        elif side == "n":
            banner(v, cx - 1, cx + 1, cz - half - 1, cz - half - 1, top - 2, 9)
        elif side == "e":
            banner(v, cx + half + 1, cx + half + 1, cz - 1, cz + 1, top - 2, 9)
        else:
            banner(v, cx - half - 1, cx - half - 1, cz - 1, cz + 1, top - 2, 9)

def knight_outer(v):
    rng = v.rng
    for x in range(-50, 51):
        for z in range(-50, 51):
            m = max(abs(x), abs(z))
            if 41 <= m <= 46:
                v.fill(x, x, GROUND - 2, GROUND, z, z, WATER)
                v.fill(x, x, GROUND + 1, GROUND + 8, z, z, AIR)
            elif 36 <= m <= 38:
                for y in range(GROUND - 2, K_WALL_TOP + 1):
                    v.set(x, y, z, bricks(rng))
                if m in (36, 38) and (x + z) % 2 == 0:
                    v.set(x, K_WALL_TOP + 1, z, STONE_BRICKS)
            elif m < 36:
                v.fill(x, x, GROUND + 1, GROUND + 12, z, z, AIR)
    v.protect(-50, 50, -50, 50)
    # drawbridge and the path to the road
    for z in range(39, 54):
        for x in range(-3, 4):
            v.set(x, GROUND, z, DARK_OAK_PLANKS if z <= 47 else (GRASS_PATH if abs(x) <= 1 else v.get(x, GROUND, z)))
        if z <= 47:
            for x in (-4, 4):
                v.set(x, GROUND, z, DARK_OAK_PLANKS)
                v.set(x, GROUND + 1, z, DARK_OAK_FENCE)
    for x in (-4, 4):
        v.set(x, GROUND + 2, 47, LANTERN)
    # gatehouse with a portcullis, and a passage for the wall walk
    for x in range(-8, 9):
        for z in range(33, 41):
            for y in range(GROUND - 2, -40):
                v.set(x, y, z, DEEPSLATE_BRICKS if abs(x) < 8 and z < 40 else POLISHED_BLACKSTONE)
            if abs(x) == 8 or z in (33, 40):
                v.set(x, -40, z, DEEPSLATE_BRICKS)
                if (x + z) % 2 == 0:
                    v.set(x, -39, z, DEEPSLATE_BRICKS)
    v.fill(-2, 2, GROUND + 1, -55, 33, 40, AIR)
    v.fill(-2, 2, GROUND, GROUND, 33, 40, STONE_BRICKS)
    v.fill(-2, 2, -55, -55, 40, 40, IRON_BARS)
    v.fill(-8, 8, K_WALL_TOP + 1, K_WALL_TOP + 3, 36, 38, AIR)
    v.fill(-8, 8, K_WALL_TOP, K_WALL_TOP, 36, 38, STONE_BRICKS)
    for bx in (-6, 4):
        banner(v, bx, bx + 2, 41, 41, -42, 10)
    # stairs up onto the wall
    for side, d in ((1, 0), (-1, 1)):
        for t in range(14):
            x, y = side * (13 + t), GROUND + 1 + t
            v.fill(x, x, GROUND + 1, y - 1, 35, 35, STONE_BRICKS)
            v.set(x, y, 35, SB_STAIRS[d])
    # towers
    for sx in (-1, 1):
        for sz in (-1, 1):
            doors = ("w" if sx > 0 else "e") + ("n" if sz > 0 else "s")
            banners = ("e" if sx > 0 else "w") + ("s" if sz > 0 else "n")
            square_tower(v, sx * 38, sz * 38, 6, GROUND - 2, -32, K_WALL_TOP, doors, banners)
    for sx in (-1, 1):
        square_tower(v, sx * 38, 0, 5, GROUND - 2, -36, K_WALL_TOP, "ns", "e" if sx > 0 else "w")
    square_tower(v, 0, -38, 5, GROUND - 2, -36, K_WALL_TOP, "ew", "n")
    v.places["wall walk"] = (30, K_WALL_TOP + 1, 36)
    v.places["tower room"] = (38, K_WALL_TOP + 1, 38)
    v.places["gatehouse passage"] = (0, K_WALL_TOP + 1, 37)

def knight_keep(v):
    rng = v.rng
    for x in range(KX0_, KX1_ + 1):
        for z in range(KZ0_, KZ1_ + 1):
            edge = x <= KX0_ + 1 or x >= KX1_ - 1 or z <= KZ0_ + 1 or z >= KZ1_ - 1
            if edge:
                for y in range(F1, ROOF + 1):
                    v.set(x, y, z, DEEPSLATE_TILES if rng.random() < 0.25 else DEEPSLATE_BRICKS)
                if x in (KX0_, KX1_) or z in (KZ0_, KZ1_):
                    for y in (F2 - 1, F3 - 1, ROOF - 1):
                        v.set(x, y, z, RED_NETHER)
                    v.set(x, ROOF + 1, z, DEEPSLATE_BRICKS)
                    if (x + z) % 2 == 0:
                        v.set(x, ROOF + 2, z, DEEPSLATE_BRICKS)
            else:
                v.fill(x, x, F1 + 1, ROOF - 1, z, z, AIR)
                v.set(x, F1, z, POLISHED_DEEPSLATE if (x + z) % 2 else STONE_BRICKS)
                v.set(x, F2, z, DARK_OAK_PLANKS)
                v.set(x, F3, z, DARK_OAK_PLANKS)
                v.set(x, ROOF, z, STONE_BRICKS)
    for x in range(-18, 19, 6):
        for z in range(-22, 12, 6):
            if not (-6 <= x <= 5 and -13 <= z <= -2):
                for y in (F2, F3, ROOF):
                    v.set(x, y, z, SHROOMLIGHT)
    # narrow windows
    for p in range(-18, 19, 4):
        rows = [range(-57, -52), range(F2 + 2, F2 + 5), range(F3 + 2, F3 + 5)]
        for (x, z) in ((p, KZ0_), (p, KZ0_ + 1), (KX0_, p - 6), (KX0_ + 1, p - 6), (KX1_, p - 6), (KX1_ - 1, p - 6),
                       (p, KZ1_), (p, KZ1_ - 1)):
            for i, ys in enumerate(rows):
                if z in (KZ1_, KZ1_ - 1) and i == 0 and abs(x) <= 6:
                    continue
                if KZ0_ + 2 <= z <= KZ1_ - 2 or x == p:
                    for y in ys:
                        v.set(x, y, z, GRAY_GLASS)
    # front door with a portcullis and banners
    v.fill(-2, 2, F1 + 1, -55, KZ1_ - 1, KZ1_, AIR)
    v.fill(-2, 2, F1, F1, KZ1_ - 1, KZ1_, STONE_BRICKS)
    v.fill(-2, 2, -55, -55, KZ1_, KZ1_, IRON_BARS)
    for bx in (-6, 4):
        banner(v, bx, bx + 2, KZ1_ + 1, KZ1_ + 1, -51, 8)
    # chunky corner turrets
    for sx in (KX0_, KX1_):
        for sz in (KZ0_, KZ1_):
            square_tower(v, sx, sz, 3, F1, -24)

def knight_hall(v):
    y = F1 + 1
    for z in range(2, KZ1_ - 1):
        for x in range(-2, 3):
            v.set(x, y, z, RED_CARPET)
    for x in range(-6, 7):
        for z in range(-2, 1):
            v.set(x, y, z, POLISHED_BLACKSTONE)
    for x in range(-2, 3):
        v.set(x, y, 1, SB_STAIRS[3])
    throne(v, 0, -1, F1 + 2, 5, RED_CARPET, mat=PB_BRICKS, back=POLISHED_BLACKSTONE, deco=GOLD, side=GOLD)
    throne(v, -4, -1, F1 + 2, 3, RED_CARPET, mat=PB_BRICKS, back=POLISHED_BLACKSTONE, deco=GOLD, side=LANTERN)
    throne(v, 4, -1, F1 + 2, 3, RED_CARPET, mat=PB_BRICKS, back=POLISHED_BLACKSTONE, deco=GOLD, side=LANTERN)
    for x in (-12, 12):
        for z in range(12, -25, -6):
            v.fill(x, x, y, F2 - 1, z, z, DEEPSLATE_TILES)
            v.set(x, F2 - 1, z, RED_NETHER)
    # banquet tables with benches
    for sgn in (-1, 1):
        for z in range(3, 12):
            for x in (7, 8):
                v.set(sgn * x, y, z, DARK_OAK_PLANKS)
            v.set(sgn * 7 if z % 2 else sgn * 8, y + 1, z, CAKE if z % 4 == 1 else LANTERN)
            v.set(sgn * 6, y, z, DARK_OAK_STAIRS[1 if sgn > 0 else 0])
            v.set(sgn * 9, y, z, DARK_OAK_STAIRS[0 if sgn > 0 else 1])
    # fireplaces
    for sx in (-20, 20):
        v.set(sx, y, -8, CAMPFIRE)
        for z in (-9, -7):
            v.fill(sx, sx, y, y + 1, z, z, STONE_BRICKS)
        v.fill(sx, sx, y + 2, F2 - 1, -9, -7, STONE_BRICKS)
        v.set(sx + (1 if sx < 0 else -1), y + 2, -9, LANTERN) if False else None
    for (x, z) in ((0, 9), (0, 4), (-15, -12), (15, -12), (-15, 2), (15, 2)):
        chandelier(v, x, z, F2 - 1, -53, hub=IRON_BLOCK, light=HANGING_LANTERN, candle=0)
    v.places["throne"] = (0, y, 3)
    v.places["banquet"] = (-10, y, 7)

def knight_upstairs(v):
    y0, y1 = F2 + 1, F3 - 1
    for x in (-8, 7):
        for z in range(KZ0_ + 2, KZ1_ - 1):
            for y in range(y0, y1 + 1):
                if (-10 <= z <= -8 or 4 <= z <= 6) and y <= y0 + 2:
                    continue
                v.set(x, y, z, STONE_BRICKS)
    # armory
    for z in range(-23, 12, 2):
        v.set(-20, y0, z, BARREL)
    for (x, b) in ((-12, ANVIL), (-14, SMITHING), (-16, CRAFTING)):
        v.set(x, y0, -23, b)
    for z in (-2, 2):
        v.set(-14, y0, z, HAY); v.set(-14, y0 + 1, z, HAY); v.set(-14, y0 + 2, z, PUMPKIN_HEAD["east"])
    v.chest("armory", -19, y0, -4, ARMORY_ITEMS, facing="east")
    v.places["armory"] = (-12, y0, -6)
    # knights' quarters: four red beds
    for z in (-20, -14, 0, 6):
        v.bed(17, y0, z, 3, color=14)
        v.set(18, y0, z + 2, DARK_OAK_PLANKS); v.set(18, y0 + 1, z + 2, LANTERN)
    v.chest("quarters", 19, y0, -6, QUARTERS_ITEMS, facing="west")
    v.places["quarters"] = (13, y0, -6)
    # war room upstairs: a big table with a map of the kingdom
    y = F3 + 1
    for x in range(-5, 5):
        for z in range(3, 10):
            v.set(x, y, z, DARK_OAK_PLANKS)
            n = math.sin(x * 0.9) + math.cos(z * 1.3)
            v.set(x, y + 1, z, BLUE_CARPET if n > 1.1 else GREEN_CARPET if n > -0.6 else BROWN_CARPET)
    v.set(-1, y + 1, 6, RED_CARPET)
    v.set(-7, y, 6, CARTOGRAPHY)
    for z in range(-23, 12):
        if z % 6 not in (0, 1):
            v.fill(-20, -20, y, y + 2, z, z, BOOKSHELF)
    for (z, m) in ((-18, IRON_BLOCK), (-12, GOLD), (-6, DIAMOND), (0, EMERALD_BLOCK), (6, TARGET)):
        v.set(19, y, z, POLISHED_BLACKSTONE); v.set(19, y + 1, z, m)
    v.places["war room"] = (0, y, 11)

def knight_great_tower(v):
    x0, x1, z0, z1 = KT
    rng = v.rng
    for x in range(x0, x1 + 1):
        for z in range(z0, z1 + 1):
            wall = x <= x0 + 1 or x >= x1 - 1 or z <= z0 + 1 or z >= z1 - 1
            for y in range(ROOF, TOP + 1):
                if wall:
                    v.set(x, y, z, RED_NETHER if (y - ROOF) % 8 == 6 else
                          (DEEPSLATE_TILES if rng.random() < 0.25 else DEEPSLATE_BRICKS))
                elif y in (ROOF, MID, TOP):
                    v.set(x, y, z, DARK_OAK_PLANKS if y != TOP else STONE_BRICKS)
                else:
                    v.set(x, y, z, AIR)
            if x in (x0, x1) or z in (z0, z1):
                v.set(x, TOP + 1, z, DEEPSLATE_BRICKS)
                if (x + z) % 2 == 0:
                    v.set(x, TOP + 2, z, DEEPSLATE_BRICKS)
    for y in range(ROOF + 4, TOP - 2, 6):
        for p in (-4, 0, 4):
            for (x, z) in ((p, z0), (p, z0 + 1), (p, z1), (p, z1 - 1), (x0, p - 7), (x0 + 1, p - 7), (x1, p - 7), (x1 - 1, p - 7)):
                v.set(x, y, z, GRAY_GLASS); v.set(x, y + 1, z, GRAY_GLASS)
    # corner turrets on the lookout and a big flag
    for (cx, cz) in ((x0 + 1, z0 + 1), (x1 - 1, z0 + 1), (x0 + 1, z1 - 1), (x1 - 1, z1 - 1)):
        for a in (-1, 0, 1):
            for c in (-1, 0, 1):
                v.fill(cx + a, cx + a, TOP + 1, TOP + 6, cz + c, cz + c, DEEPSLATE_BRICKS)
                if (a + c) % 2 == 0:
                    v.set(cx + a, TOP + 7, cz + c, DEEPSLATE_BRICKS)
    fx, fz = x1 - 1, z0 + 1
    for k in range(7, 15):
        v.set(fx, TOP + k, fz, DARK_OAK_FENCE)
    for a in range(1, 6):
        for k in (12, 13, 14):
            v.set(fx + a, TOP + k, fz, YELLOW_WOOL if k == 13 else RED_WOOL)
    v.fill(-2, 1, ROOF + 1, ROOF + 3, z1 - 1, z1, AIR)
    spiral_stairs(v, K_SQ, STEP0, TOP, [F2, F3, ROOF, MID, TOP], SB_STAIRS, DEEPSLATE_BRICKS, RED_NETHER, SHROOMLIGHT,
                  STONE_BRICKS, LANTERN, floor0=F1)
    y = MID + 1
    v.chest("treasure", -1, y, -14, KNIGHT_TREASURE_ITEMS, facing="south")
    v.chest("armor", 0, y, -14, KNIGHT_ARMOR_ITEMS, facing="south")
    v.set(-6, y, -12, OBSIDIAN); v.set(-6, y + 1, -12, DRAGON_EGG)
    for (x, z) in ((5, -13), (-6, -2), (5, -2)):
        v.set(x, y, z, GOLD)
    v.places["treasure room"] = (0, y, -13)
    v.places["lookout"] = (5, TOP + 1, -3)
    v.places["roof"] = (12, ROOF + 1, 8)

def dragon(v, x, z, mirror=False, name="dragon"):
    """A big stone dragon statue sitting on a plinth, facing south, wings half open. A mirrored one
    curls its tail the other way, so a pair can stand either side of a road."""
    m = -1 if mirror else 1
    y0 = GROUND + 1
    v.protect(min(x - 14 * m, x + 20 * m), max(x - 14 * m, x + 20 * m), z - 11, z + 18)
    for a in range(-13, 20):
        a *= m
        for c in range(-10, 18):
            v.fill(x + a, x + a, y0, y0 + 30, z + c, z + c, AIR)
            if -9 <= a <= 9 and -7 <= c <= 11:
                v.set(x + a, GROUND, z + c, POLISHED_BLACKSTONE if abs(a) < 9 and -7 < c < 11 else STONE_BRICKS)
    def ball(px, py, pz, r, mat, belly=None):
        ri = int(math.ceil(r))
        for a in range(-ri, ri + 1):
            for b in range(-ri, ri + 1):
                for c in range(-ri, ri + 1):
                    if a * a + b * b + c * c <= r * r:
                        v.set(int(px + a), int(py + b), int(pz + c), belly if (belly and b < -r * 0.3) else mat)
    # body
    for a in range(-4, 5):
        for b in range(-4, 5):
            for c in range(-7, 8):
                if (a / 3.6) ** 2 + (b / 3.0) ** 2 + (c / 6.2) ** 2 <= 1:
                    v.set(x + a, y0 + 5 + b, z + c, PB_BRICKS if b < -1 else BLACKSTONE)
    for (a, c) in ((-2, -3), (2, -3), (-2, 3), (2, 3)):
        v.fill(x + a, x + a + (1 if a > 0 else -1) * 0, y0, y0 + 3, z + c, z + c + 1, BLACKSTONE)
        v.set(x + a, y0, z + c + 2, BONE)                    # claws
    # neck and head
    for t in range(9):
        ball(x, y0 + 6 + t * 0.75, z + 4 + t * 0.4, 1.7 - t * 0.05, BLACKSTONE)
    hy, hz = y0 + 12, z + 8
    v.fill(x - 2, x + 2, hy, hy + 3, hz, hz + 3, BLACKSTONE)
    v.fill(x - 1, x + 1, hy, hy + 1, hz + 4, hz + 5, BLACKSTONE)
    for a in (-1, 1):
        v.set(x + a, hy - 1, hz + 5, BONE)                   # teeth
        v.set(x + 2 * a, hy + 2, hz + 2, SHROOMLIGHT)        # glowing eyes
        for k in range(3):
            v.set(x + 2 * a, hy + 4 + k, hz - k // 2, BONE)  # horns
    for c in range(-6, 8, 2):
        v.set(x, y0 + 9, z + c, RED_NETHER)                  # spines along the back
    # wings
    for sgn in (-1, 1):
        for a in range(1, 9):
            xx = x + sgn * (3 + a)
            yy = y0 + 7 + a // 2
            for c in range(-4, 4 - a // 3):
                v.set(xx, yy, z + c, BLACKSTONE if c == -4 or a == 8 else RED_NETHER)
    # tail curling round to the east
    for t in range(11):
        r = 1.3 - t * 0.07
        ball(x + m * (3 + t), y0 + 3 - t // 4, z - 5 + round(1.5 * math.sin(t / 2.0)), r, BLACKSTONE)
    v.places[name] = (x, y0, z + 13) if v.get(x, y0, z + 13) == AIR else (x + 6 * m, y0, z + 10)

def knight_courtyard(v):
    y = GROUND + 1
    for z in range(15, 34):
        for x in range(-2, 3):
            v.set(x, GROUND, z, STONE_BRICKS if abs(x) < 2 else COBBLESTONE)
    for (x, z) in ((-4, 20), (4, 20), (-4, 29), (4, 29)):
        lamp_post(v, x, y, z, 2, DARK_OAK_FENCE, LANTERN)
    # training yard: straw dummies and archery targets
    for x in range(10, 33):
        for z in range(17, 34):
            v.set(x, GROUND, z, COARSE_DIRT)
    for x in (14, 19, 24, 29):
        v.set(x, y, 21, HAY); v.set(x, y + 1, 21, HAY); v.set(x, y + 2, 21, PUMPKIN_HEAD["south"])
    for x in range(13, 31, 4):
        v.set(x, y, 31, DARK_OAK_FENCE); v.set(x, y + 1, 31, TARGET)
    v.places["training yard"] = (20, y, 26)
    # the forge
    fx0, fx1, fz0, fz1 = 25, 33, -8, 2
    for x in range(fx0, fx1 + 1):
        for z in range(fz0, fz1 + 1):
            v.set(x, GROUND, z, STONE_BRICKS)
            v.set(x, y + 4, z, DARK_OAK_PLANKS)
            if x in (fx0, fx1) and z in (fz0, fz1):
                v.fill(x, x, y, y + 3, z, z, DARK_OAK_LOG)
    v.set(32, y, -6, BLAST_FURNACE); v.set(30, y, -6, ANVIL); v.set(28, y, -6, SMITHING)
    v.set(32, y, -3, CAMPFIRE)
    for z in (-1, 0):
        v.set(32, y, z, BARREL)
    v.chest("forge", 32, y, 1, FORGE_ITEMS, facing="west")
    v.set(29, y + 3, -3, HANGING_LANTERN)
    v.places["forge"] = (27, y, -3)
    stable_at(v, -34, -26, -8, 2, "east", DARK_OAK_PLANKS, DARK_OAK_LOG, DARK_OAK_FENCE, DARK_OAK_PLANKS, STONE_BRICKS,
              "stable", KNIGHT_STABLE_ITEMS)
    # the well
    for a in range(-2, 3):
        for c in range(-2, 3):
            edge = abs(a) == 2 or abs(c) == 2
            if edge:
                v.set(a, y, -31 + c, COBBLESTONE)
            else:
                v.fill(a, a, GROUND - 1, GROUND, -31 + c, -31 + c, WATER)
    for (a, c) in ((-2, -2), (2, 2), (-2, 2), (2, -2)):
        v.fill(a, a, y + 1, y + 2, -31 + c, -31 + c, DARK_OAK_FENCE)
    v.fill(-2, 2, y + 3, y + 3, -33, -29, DARK_OAK_PLANKS)
    v.places["well"] = (4, y, -31)
    for (x, z) in ((-24, -31), (24, -31)):
        oak_tree(v, x, y, z)

def knight_castle(w):
    v = View(w, KNIGHT[0], KNIGHT[1], "knight ", rot=KNIGHT_ROT)
    knight_outer(v)
    knight_keep(v)
    knight_hall(v)
    knight_upstairs(v)
    knight_great_tower(v)
    knight_courtyard(v)
    dragon(v, DRAGON[0], DRAGON[1])
    dragon(v, -DRAGON[0], DRAGON[1], mirror=True, name="dragon twin")
    knight_secret(v)

# ---------------------------------------------------------------- the haunted mountain (dwarf halls)
MC = (-0.5, -8.5)             # mountain peak, great staircase and witch tower centre (local)
M_R = 70                      # mountain radius
PEAK = 20                     # flat top of the mountain, and the witch tower's floor
GEO = -31                     # floor of the crystal geode cave, halfway up the stairs
S_SQ = (-4, 3, -12, -5)

def hall_ceiling(x):
    return -40 - int(round(8 * (x / 23.0) ** 2))

def mountain(v):
    rng = v.rng
    xs, zs = np.arange(-72, 73), np.arange(-80, 63)
    X, Z = np.meshgrid(xs, zs, indexing="ij")
    d = np.hypot(X - MC[0], Z - MC[1])
    gx, gz = X + v.ox, Z + v.oz
    n = fbm2(gx, gz, 18, 7001)
    raw = GROUND + 110 * np.clip(1 - d / M_R, 0, 1) ** 1.3 * (0.86 + 0.28 * n)
    h = np.minimum(np.round(raw), PEAK).astype(int)
    h[(Z > 28) & (np.abs(X) <= 13)] = GROUND                    # the canyon up to the gate
    band = fbm3(gx, gx * 0, gz, 9, 7002)
    for i, x in enumerate(xs):
        for k, z in enumerate(zs):
            top = h[i, k]
            if top <= GROUND or d[i, k] >= M_R:
                continue
            for y in range(GROUND - 2, top + 1):
                yy = y + int(3 * band[i, k])
                m = TUFF if yy % 9 == 0 else DEEPSLATE if y < -45 else ANDESITE if yy % 7 == 3 else STONE
                v.set(int(x), y, int(z), m)
            v.fill(int(x), int(x), top + 1, top + 40, int(z), int(z), AIR)
            if top >= PEAK:
                v.set(int(x), top, int(z), COBBLED_DEEPSLATE)
            elif top < GROUND + 10:
                v.set(int(x), top, int(z), PODZOL if n[i, k] > 0 else COARSE_DIRT)
            elif n[i, k] > 0.25:
                v.set(int(x), top, int(z), GRAVEL)
            elif rng.random() < 0.004:
                v.set(int(x), top, int(z), CRYING)                # glowing purple specks on the slopes
    v.protect(-14, 14, 26, 58)

def carve(v, x0, x1, y0, y1, z0, z1, floor=None):
    v.fill(x0, x1, y0, y1, z0, z1, AIR)
    if floor is not None:
        for x in range(x0, x1 + 1):
            for z in range(z0, z1 + 1):
                v.set(x, y0 - 1, z, floor(x, z) if callable(floor) else floor)

def ghost(v, x, y, z):
    """A cute floating ghost: a white sheet with two black eyes and an 'oo' mouth, facing south."""
    for a in (-1, 0, 1):
        for k in range(-3, 2):
            if k == -3 and a == 0:
                continue                                   # wavy hem
            for c in (0, 1):
                v.set(x + a, y + k, z + c, WHITE_WOOL)
    v.set(x, y + 2, z, WHITE_WOOL); v.set(x, y + 2, z + 1, WHITE_WOOL)
    v.set(x - 1, y + 1, z + 1, BLACK_WOOL); v.set(x + 1, y + 1, z + 1, BLACK_WOOL)
    v.set(x, y - 1, z + 1, BLACK_WOOL)

def dwarf_statue(v, x, z, y=None):
    """A big stone dwarf guard: helmet with horns, glowing eyes, a long beard and an axe."""
    y = GROUND + 1 if y is None else y
    for a in (-2, -1, 1, 2):
        v.fill(x + a, x + a, y, y + 2, z, z + 1, DEEPSLATE)                     # legs
    v.fill(x - 3, x + 3, y + 3, y + 8, z, z + 1, COBBLED_DEEPSLATE)              # body
    v.fill(x - 3, x + 3, y + 3, y + 3, z, z + 2, POLISHED_BLACKSTONE)            # belt
    v.set(x, y + 3, z + 2, GOLD)                                                 # buckle
    v.fill(x - 2, x + 2, y + 9, y + 12, z, z + 2, DEEPSLATE)                     # head
    v.fill(x - 2, x + 2, y + 13, y + 13, z, z + 2, POLISHED_BLACKSTONE)          # helmet
    for a in (-3, 3):
        v.set(x + a, y + 13, z + 1, BONE); v.set(x + a, y + 14, z + 1, BONE)     # horns
    v.set(x - 1, y + 11, z + 3, CRYING); v.set(x + 1, y + 11, z + 3, CRYING)    # eyes
    v.fill(x - 2, x + 2, y + 5, y + 10, z + 2, z + 2, CALCITE)                   # beard
    v.fill(x - 1, x + 1, y + 4, y + 4, z + 2, z + 2, CALCITE)
    v.set(x, y + 10, z + 3, STONE)                                               # nose
    ax = x + (4 if x > 0 else -4)
    v.fill(ax, ax, y, y + 9, z + 1, z + 1, DARK_OAK_LOG)                         # axe
    v.fill(ax, ax, y + 7, y + 10, z + 2, z + 3, IRON_BLOCK)

def spooky_entrance(v):
    y = GROUND + 1
    # canyon courtyard floor, path, pumpkin patch and jack-o'-lantern posts
    for x in range(-13, 14):
        for z in range(29, 58):
            v.set(x, GROUND, z, PODZOL if (x * 7 + z * 3) % 5 else COARSE_DIRT)
            v.fill(x, x, y, y + 30, z, z, AIR)
    for z in range(21, 58):
        for x in range(-2, 3):
            v.set(x, GROUND, z, MOSSY_COBBLE if (x + z) % 3 == 0 else COBBLESTONE)
    rng = v.rng
    for x in range(-12, -4):
        for z in range(33, 53):
            r = rng.random()
            if r < 0.22:
                v.set(x, y, z, PUMPKIN[rng.choice(("south", "west", "north", "east"))])
            elif r < 0.26:
                v.set(x, y, z, LIT_PUMPKIN["east"])
            elif r < 0.33:
                v.set(x, y, z, DEADBUSH)
    v.places["pumpkin patch"] = (-4, y, 44)
    for z in (34, 42, 50):
        for x in (-4, 4):
            lamp_post(v, x, y, z, 2, DARK_OAK_FENCE, LIT_PUMPKIN["south"])
    stable_at(v, 5, 12, 36, 46, "west", DARK_OAK_PLANKS, DARK_OAK_LOG, DARK_OAK_FENCE, PURPLE_C, BLACK_C, "stable",
              SPOOKY_STABLE_ITEMS)
    # the gate: a big arch in the cliff with a raised portcullis, guarded by two dwarves
    for x in range(-5, 6):
        for z in range(23, 29):
            top = -51 if abs(x) <= 2 else (-52 if abs(x) <= 3 else -54)
            if abs(x) <= 4:
                v.fill(x, x, y, top, z, z, AIR)
        for yy in range(y, -49):
            if abs(x) == 5 or yy == -50:
                v.set(x, yy, 28, POLISHED_BLACKSTONE)
    v.fill(-2, 2, -51, -51, 28, 28, IRON_BARS)
    v.set(0, -49, 28, CRYING)
    for x in (-9, 9):
        dwarf_statue(v, x, 29)
    # tunnel into the mountain
    carve(v, -3, 3, y, -54, 21, 27, floor=lambda x, z: DEEPSLATE_TILES)
    for z in range(21, 28):
        for x in (-4, 4):
            v.fill(x, x, y, -54, z, z, DEEPSLATE_BRICKS)
        v.fill(-3, 3, -53, -53, z, z, DEEPSLATE_BRICKS)
        if z % 3 == 0:
            v.set(0, -54, z, HANGING_SOUL_LANTERN)
    for z in range(21, 28):
        for x in (-1, 0, 1):
            v.set(x, y, z, PURPLE_CARPET)
    v.places["gate"] = (0, y, 30)

def great_hall(v):
    y = GROUND + 1
    for x in range(-22, 23):
        c = hall_ceiling(x)
        for z in range(-20, 21):
            v.fill(x, x, y, c, z, z, AIR)
            v.set(x, GROUND, z, POLISHED_DEEPSLATE if (x + z) % 2 else DEEPSLATE_TILES)
            v.set(x, c + 1, z, DEEPSLATE_TILES)
        for z in (-21, 21):
            v.fill(x, x, y, c + 1, z, z, DEEPSLATE_BRICKS)
    for z in range(-21, 22):
        for x in (-23, 23):
            v.fill(x, x, y, hall_ceiling(22) + 1, z, z, DEEPSLATE_BRICKS)
    v.fill(-3, 3, y, -54, 21, 21, AIR)                     # opening to the tunnel
    # pillars with soul lanterns
    for x in (-12, 12):
        for z in (-16, -8, 0, 8, 16):
            for a in (0, 1):
                for c in (0, 1):
                    v.fill(x + a, x + a, y, hall_ceiling(x) + 1, z + c, z + c, DEEPSLATE_BRICKS)
            v.set(x, -55, z + 2, SOUL_LANTERN) if False else None
            v.set(x + (2 if x > 0 else -1), y, z, LIT_PUMPKIN["east" if x < 0 else "west"])
    # carpet, dais and the Mountain King's throne
    for z in range(2, 21):
        for x in (-1, 0, 1):
            v.set(x, y, z, PURPLE_CARPET)
        for x in (-2, 2):
            v.set(x, y, z, BLACK_CARPET)
    for x in range(-6, 7):
        for z in range(-2, 1):
            v.set(x, y, z, POLISHED_BLACKSTONE)
    for x in range(-2, 3):
        v.set(x, y, 1, DS_STAIRS[3])
    throne(v, 0, -1, y + 1, 6, PURPLE_CARPET, mat=POLISHED_BLACKSTONE, back=CRYING, deco=LIT_PUMPKIN["south"], side=GOLD)
    throne(v, -4, -1, y + 1, 3, PURPLE_CARPET, mat=POLISHED_BLACKSTONE, back=PB_BRICKS, deco=SOUL_LANTERN)
    throne(v, 4, -1, y + 1, 3, PURPLE_CARPET, mat=POLISHED_BLACKSTONE, back=PB_BRICKS, deco=SOUL_LANTERN)
    v.places["throne"] = (0, y, 3)
    # feast tables
    for sgn in (-1, 1):
        for z in range(4, 17):
            for x in (6, 7):
                v.set(sgn * x, y, z, DARK_OAK_PLANKS)
            v.set(sgn * (6 if z % 2 else 7), y + 1, z, CAKE if z % 4 == 1 else PURPLE_CANDLE)
            v.set(sgn * 5, y, z, DARK_OAK_STAIRS[1 if sgn > 0 else 0])
            v.set(sgn * 8, y, z, DARK_OAK_STAIRS[0 if sgn > 0 else 1])
    # chandeliers, ghosts and cobwebs
    for (x, z) in ((0, 12), (0, 6), (-17, -10), (17, -10), (-17, 10), (17, 10), (-7, -16), (7, -16)):
        chandelier(v, x, z, hall_ceiling(x), hall_ceiling(x) - 5, hub=POLISHED_BLACKSTONE, light=HANGING_SOUL_LANTERN,
                   candle=PURPLE_CANDLE)
    for (x, yy, z) in ((-15, -47, 4), (15, -48, -2), (-8, -46, -15), (9, -47, 14)):
        ghost(v, x, yy, z)
    for x in (-22, 22):
        for z in (-20, 20):
            for k in range(3):
                v.set(x, hall_ceiling(x) - k, z, WEB)
    v.places["great hall"] = (-10, y, 10)

def side_rooms(v):
    y = GROUND + 1
    rng = v.rng
    def door(x0, x1, z0, z1):
        carve(v, x0, x1, y, y + 3, z0, z1, floor=lambda x, z: DEEPSLATE_TILES)
    # --- treasure vault (west, back)
    carve(v, -40, -26, y, y + 8, -16, 0, floor=lambda x, z: POLISHED_BLACKSTONE)
    door(-25, -23, -9, -7)
    for _ in range(26):
        gx, gz = rng.randint(-39, -27), rng.choice((rng.randint(-15, -12), rng.randint(-4, -1)))
        for k in range(rng.randint(1, 3)):
            v.set(gx, y + k, gz, GOLD if rng.random() < 0.6 else RAW_GOLD)
    v.chest("gold vault", -38, y, -8, VAULT_ITEMS, facing="east")
    v.chest("dwarf crown", -38, y, -6, DWARF_CROWN_ITEMS, facing="east")
    for (x, z) in ((-32, -8), (-32, -6)):
        v.set(x, y, z, LANTERN)
    v.places["treasure vault"] = (-30, y, -7)
    # --- potion library (west, front)
    carve(v, -40, -26, y, y + 7, 4, 16, floor=lambda x, z: DARK_OAK_PLANKS)
    door(-25, -23, 9, 11)
    for z in range(4, 17):
        if z not in (9, 10, 11):
            v.fill(-40, -40, y, y + 4, z, z, BOOKSHELF)
    for x in range(-39, -26):
        v.fill(x, x, y, y + 4, 16, 16, BOOKSHELF)
    for x in (-36, -33, -30):
        v.set(x, y, 7, CAULDRON); v.set(x, y, 12, BREWING)
    for (x, z) in ((-36, 9), (-33, 9), (-30, 9)):
        v.set(x, y, z, DARK_OAK_PLANKS); v.set(x, y + 1, z, PURPLE_CANDLE)
    for (x, z) in ((-39, 4), (-27, 4), (-39, 15), (-27, 15)):
        v.set(x, y + 6, z, WEB); v.set(x, y + 5, z, WEB) if x == -39 else None
    v.chest("potions", -27, y, 13, POTION_ITEMS, facing="west")
    v.places["potion library"] = (-29, y, 10)
    # --- dwarf forge (east, back)
    carve(v, 26, 40, y, y + 8, -16, 0, floor=lambda x, z: STONE_BRICKS)
    door(23, 25, -9, -7)
    for z in (-15, -12, -9):
        v.set(40, y, z, BLAST_FURNACE)
    for z in (-15, -11):
        v.set(36, y, z, ANVIL)
    v.set(32, y, -15, SMITHING)
    for z in (-3, -2):
        v.fill(38, 40, y, y + 1, z - 1, z + 1, STONE_BRICKS)
        v.set(39, y, z, CAMPFIRE)
    v.fill(38, 40, y + 2, y + 8, -4, -1, STONE_BRICKS)
    v.chest("forge", 28, y, -15, DWARF_FORGE_ITEMS, facing="south")
    v.set(33, y + 7, -8, HANGING_LANTERN); v.fill(33, 33, y + 8, y + 8, -8, -8, CHAIN)
    v.places["forge"] = (30, y, -6)
    # --- the mine (east, front): a rough cave with ore in the walls and a little railway
    door(23, 25, 9, 11)
    for x in range(26, 45):
        for z in range(3, 19):
            for k in range(0, 8):
                e = ((x - 35) / 9.5) ** 2 + ((z - 11) / 7.5) ** 2 + ((k - 2.5) / 5.0) ** 2
                if e <= 1 + 0.25 * noise3(x, k, z, 3, 7003):
                    v.set(x, y + k, z, AIR)
    for x in range(26, 45):
        for z in range(3, 19):
            if v.get(x, y, z) == AIR:
                v.set(x, GROUND, z, GRAVEL if (x + z) % 4 else STONE)
    v.fill(23, 25, y, y + 3, 9, 11, AIR)
    for x in range(25, 47):
        for z in range(1, 21):
            for k in range(-1, 9):
                if v.get(x, y + k, z) in (STONE, ANDESITE, TUFF, DEEPSLATE):
                    near = any(v.get(x + a, y + k + b, z + c) == AIR for a, b, c in
                               ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)))
                    if near and rng.random() < 0.16:
                        v.set(x, y + k, z, rng.choice(ORES))
    for x in range(26, 35):
        if v.get(x, y, 11) == AIR and v.get(x, GROUND, 11) != AIR:
            v.set(x, y, 11, RAIL_EW)
    for (x, z) in ((30, 6), (38, 16), (40, 6)):
        if v.get(x, y, z) == AIR:
            lamp_post(v, x, y, z, 1, DARK_OAK_FENCE, LANTERN)
    v.chest("mine", 28, y, 14, MINE_ITEMS, facing="east")
    v.places["mine"] = (33, y, 11)
    # --- haunted bedroom (north, left)
    carve(v, -17, -5, y, y + 6, -32, -22, floor=lambda x, z: DARK_OAK_PLANKS)
    door(-12, -10, -21, -21)
    v.fill(-12, -10, y, y + 3, -21, -21, AIR)
    for x in range(-16, -5):
        for z in range(-31, -22):
            v.set(x, y, z, PURPLE_CARPET if (x + z) % 2 else BLACK_CARPET)
    v.bed(-14, y, -30, 2, color=10)
    v.bed(-8, y, -30, 2, color=10)
    v.set(-11, y, -31, DARK_OAK_PLANKS); v.set(-11, y + 1, -31, LIT_PUMPKIN["south"])
    v.chest("costumes", -16, y, -26, COSTUME_ITEMS, facing="east")
    for (x, z) in ((-17, -32), (-5, -32), (-17, -22)):
        v.set(x, y + 6, z, WEB)
    ghost(v, -11, y + 3, -27) if False else None
    v.places["haunted bedroom"] = (-11, y, -24)
    # --- glowing mushroom cave (north, right)
    carve(v, 5, 21, y, y + 9, -34, -22, floor=lambda x, z: MYCELIUM)
    door(9, 11, -21, -21)
    v.fill(9, 11, y, y + 3, -21, -21, AIR)
    def big_mushroom(mx, mz, red, h):
        for k in range(h):
            v.set(mx, y + k, mz, MUSH_STEM)
        cap = RED_CAP if red else BROWN_CAP
        rr = 2.3 if red else 3.2
        for a in range(-3, 4):
            for c in range(-3, 4):
                dd = math.hypot(a, c)
                if dd <= rr:
                    v.set(mx + a, y + h, mz + c, cap)
                    if red and dd > rr - 1.1:
                        v.set(mx + a, y + h - 1, mz + c, cap)
    big_mushroom(9, -30, True, 5)
    big_mushroom(17, -27, False, 6)
    for (x, z) in ((6, -33), (20, -33)):
        v.set(x, GROUND, z, VERDANT_FROG)
    for _ in range(40):
        mx, mz = rng.randint(6, 20), rng.randint(-33, -23)
        if v.get(mx, y, mz) == AIR and v.get(mx, GROUND, mz) == MYCELIUM:
            v.set(mx, y, mz, RED_MUSH if rng.random() < 0.5 else BROWN_MUSH)
    for (x, z) in ((7, -24), (13, -33), (19, -23), (13, -24)):
        v.set(x, y + 10, z, SHROOMLIGHT)
    v.places["mushroom cave"] = (13, y, -24)

def geode(v):
    cx, cy, cz = MC[0], -26, MC[1]
    rng = v.rng
    for x in range(-10, 10):
        for yy in range(cy - 9, cy + 10):
            for z in range(-19, 3):
                d = math.sqrt((x - cx) ** 2 + (yy - cy) ** 2 + (z - cz) ** 2)
                if d > 8.6:
                    continue
                if d > 7.6:
                    v.set(x, yy, z, CALCITE)
                elif d > 6.6:
                    r = rng.random()
                    v.set(x, yy, z, PEARL_FROG if r < 0.05 else CRYING if r < 0.1 else AMETHYST)
                elif yy < GEO:
                    v.set(x, yy, z, CALCITE)
                elif yy == GEO:
                    v.set(x, yy, z, AMETHYST if rng.random() < 0.3 else CALCITE)
                else:
                    v.set(x, yy, z, AIR)
    for x in range(-7, 7):
        for z in range(-16, 0):
            if v.get(x, GEO + 1, z) == AIR and v.get(x, GEO, z) == AMETHYST and rng.random() < 0.35:
                v.set(x, GEO + 1, z, AMETHYST_CLUSTER)
    v.chest("geode", 3, GEO + 1, -2, GEODE_ITEMS, facing="north")
    v.places["crystal geode"] = (-3, GEO + 1, -3)

def witch_tower(v):
    big_round_tower(v, MC, 8, PEAK, PEAK + 12, [PEAK], POLISHED_BLACKSTONE, PURPLE_C, DARK_OAK_PLANKS, PURPLE_GLASS,
                    (PURPLE_C, BLACK_C, MAGENTA_C), 18, LIT_PUMPKIN["south"], LIME_WOOL, COBBLED_DEEPSLATE,
                    LIT_PUMPKIN["south"])
    y = PEAK + 1
    v.chest("witch's treasure", -1, y, -15, WITCH_ITEMS, facing="south")
    v.chest("witch lookout", 0, y, -15, BAT_SPYGLASS_ITEMS, facing="south")
    v.set(-6, y, -10, CAULDRON); v.set(5, y, -10, BREWING)
    for (x, z) in ((-6, -6), (5, -6)):
        v.set(x, y, z, LIT_PUMPKIN["south"])
    v.places["witch tower"] = (0, y, -15)

def spooky_castle(w):
    v = View(w, SPOOKY[0], SPOOKY[1], "spooky ")
    mountain(v)
    spooky_entrance(v)
    great_hall(v)
    side_rooms(v)
    geode(v)
    witch_tower(v)
    deep_mine(v)
    spiral_stairs(v, S_SQ, STEP0, PEAK, [GEO, PEAK], DS_STAIRS, DEEPSLATE_BRICKS, CRYING, PEARL_FROG,
                  POLISHED_BLACKSTONE, SOUL_LANTERN, floor0=F1)

# ---------------------------------------------------------------- secret passages
LADDER_FACE = {"n": 3, "s": 2, "w": 5, "e": 4}       # which way a ladder faces when its wall is on that side
DIRS = {"e": (1, 0), "w": (-1, 0), "s": (0, 1), "n": (0, -1)}
STAIR_UP = {"e": 0, "w": 1, "s": 2, "n": 3}

def secret_passage(v, x, y_floor, z, trapdoor, down, wall, go, steps, lining, stairs, light):
    """A hidden trapdoor in the floor at (x, y_floor, z); a ladder down `down` blocks on the `wall`
    side; then a 2-wide staircase going `go` and down one block per step. Returns the far end:
    (x, floor y, z) of the first flat spot after the last step."""
    v.set(x, y_floor, z, trapdoor)
    v.fill(x, x, y_floor + 1, y_floor + 2, z, z, AIR) if v.get(x, y_floor + 1, z) not in (AIR,) and False else None
    wx, wz = DIRS[wall]
    for k in range(1, down + 1):
        y = y_floor - k
        if v.get(x + wx, y, z + wz) == AIR:
            v.set(x + wx, y, z + wz, lining)
        v.set(x, y, z, LADDERS[LADDER_FACE[wall]])
    yb = y_floor - down                       # lowest ladder cell: you step off here
    v.set(x, yb - 1, z, lining)
    dx, dz = DIRS[go]
    px, pz = -dz, dx                          # the staircase is 2 wide: this way is the second lane
    pts = []
    for i in range(steps + 4):
        cx, cz = x + dx * (i + 1), z + dz * (i + 1)
        fy = yb - 1 - max(0, min(i - 1, steps - 1))   # one flat step, then down, then flat at the end
        for o in (0, 1):
            ax, az = cx + px * o, cz + pz * o
            v.fill(ax, ax, fy + 1, fy + 3, az, az, AIR)
            v.set(ax, fy, az, stairs[STAIR_UP[{"e": "w", "w": "e", "n": "s", "s": "n"}[go]]] if 1 <= i <= steps else lining)
            for (ex, ez) in ((ax - px, az - pz), (ax + px, az + pz)):
                for yy in range(fy, fy + 4):
                    if v.get(ex, yy, ez) not in (AIR,) and not (ex, ez) in [(cx + px * q, cz + pz * q) for q in (0, 1)]:
                        v.set(ex, yy, ez, lining)
            v.set(ax, fy + 4, az, lining)
        if i % 6 == 3:
            v.set(cx, fy + 3, cz, light)
        pts.append((cx, fy, cz))
    v.fill(x, x, yb - 1, yb - 1, z, z, lining)
    return pts[-1]

def princess_secret(v):
    """Behind the wardrobe in the princess bedroom: a little nook with a trapdoor. A ladder goes down
    inside the palace wall, and a staircase leads deep underground to the Secret Fairy Grotto."""
    x, z = KX0 + 1, -13
    v.fill(x, x, F2 + 1, F2 + 2, z, z, AIR)                      # the nook in the wall
    ex, ey, ez = secret_passage(v, x, F2, z, TRAPDOORS["cherry"], 20, "w", "n", 34, QUARTZ, QSTAIRS, HANGING_LANTERN)
    cx, cz = ex, ez - 9
    x0, x1, z0, z1 = cx - 7, cx + 8, cz - 7, cz + 7
    for a in range(x0 - 1, x1 + 2):
        for c in range(z0 - 1, z1 + 2):
            wall = a in (x0 - 1, x1 + 1) or c in (z0 - 1, z1 + 1)
            for k in range(0, 9):
                v.set(a, ey + k, c, AMETHYST if (wall or k == 8) and (a + c + k) % 6 else
                      PEARL_FROG if (wall or k == 8) else (GRASS if k == 0 else AIR))
    v.fill(ex, ex + 1, ey + 1, ey + 3, z1 + 1, z1 + 1, AIR)        # doorway from the staircase
    v.fill(ex, ex + 1, ey, ey, z1 + 1, z1 + 1, GRASS)
    for a in range(x0 + 2, x0 + 7):                                # a pool with lily pads
        for c in range(z0 + 2, z0 + 6):
            v.set(a, ey, c, WATER)
            v.set(a, ey - 1, c, SEA_LANTERN)
            if (a + c) % 3 == 0:
                v.set(a, ey + 1, c, LILY_PAD)
    cherry_tree(v, x1 - 3, ey + 1, z0 + 3, 0.7)
    for a in range(x0, x1 + 1):
        for c in range(z0, z1 + 1):
            if v.get(a, ey, c) == GRASS and v.get(a, ey + 1, c) == AIR and (a * 3 + c) % 4 == 0:
                v.set(a, ey + 1, c, FLOWERS[(a + c) % 7])
    v.chest("secret grotto", x0 + 1, ey + 1, z1, PRINCESS_SECRET_ITEMS, facing="north")
    for c in (z0 + 1, z1 - 1):
        v.set(x1, ey + 1, c, LANTERN)
    v.places["secret grotto"] = (cx + 2, ey + 1, cz + 3)

def ice_secret(v):
    """A trapdoor in the igloo floor (like a real igloo basement): down a ladder and a long icy
    staircase to the Frozen Caves."""
    x, z = 24, 12
    v.set(x, GROUND + 1, z, AIR)
    end = secret_passage(v, x, GROUND, z, TRAPDOORS["spruce"], 10, "n", "e", 30, PACKED_ICE, QSTAIRS, HANGING_SOUL_LANTERN)
    ex, ey, ez = end
    cx, cz = ex + 10, ez
    rng = v.rng
    for a in range(cx - 12, cx + 13):
        for c in range(cz - 11, cz + 12):
            for k in range(-1, 10):
                d = ((a - cx) / 11.5) ** 2 + ((k - 3) / 6.5) ** 2 + ((c - cz) / 10.5) ** 2
                if d <= 1:
                    v.set(a, ey + k, c, AIR if k >= 1 else PACKED_ICE)
                elif d <= 1.35 and v.get(a, ey + k, c) != AIR:
                    v.set(a, ey + k, c, BLUE_ICE if rng.random() < 0.3 else PACKED_ICE)
    for a in range(ex - 1, cx - 8):                                # join the staircase to the cave
        for c in (ez, ez + 1):
            v.fill(a, a, ey + 1, ey + 3, c, c, AIR)
            v.set(a, ey, c, PACKED_ICE)
    for _ in range(26):                                            # icicles
        a, c = cx + rng.randint(-9, 9), cz + rng.randint(-8, 8)
        top = max((k for k in range(1, 10) if v.get(a, ey + k, c) == AIR), default=None)
        if top and top > 4:
            for k in range(rng.randint(1, 3)):
                if v.get(a, ey + top - k, c) == AIR and v.get(a, ey + top - k - 1, c) == AIR:
                    v.set(a, ey + top - k, c, PACKED_ICE)
    for (a, c) in ((cx - 5, cz - 4), (cx + 5, cz + 4), (cx - 6, cz + 5), (cx + 6, cz - 5)):
        snowman(v, a, ey + 1, c)
    for (a, c) in ((cx - 3, cz), (cx + 3, cz), (cx, cz - 6), (cx, cz + 6)):
        v.set(a, ey + 1, c, SOUL_LANTERN)
    v.set(cx, ey + 1, cz - 2, BLUE_ICE); v.set(cx, ey + 2, cz - 2, DIAMOND)
    v.chest("frozen vault", cx + 1, ey + 1, cz - 2, ICE_SECRET_ITEMS, facing="south")
    v.places["frozen caves"] = (cx, ey + 1, cz + 2)

def knight_secret(v):
    """Behind the side throne in the great hall: a trapdoor down to the castle dungeon, with jail
    cells, cobwebs and the Dungeon Vault at the far end."""
    x, z = -6, -3
    end = secret_passage(v, x, F1, z, TRAPDOORS["dark_oak"], 8, "n", "w", 32, STONE_BRICKS, SB_STAIRS, HANGING_LANTERN)
    ex, ey, ez = end
    y = ey + 1
    rng = v.rng
    xa, xb = ex - 36, ex                               # main corridor, z ez-1 .. ez+2
    for a in range(xa, xb + 1):
        for c in range(ez - 2, ez + 4):
            for k in range(-1, 5):
                edge = c in (ez - 2, ez + 3) or k in (-1, 4)
                v.set(a, y + k, c, (MOSSY_BRICKS if rng.random() < 0.3 else STONE_BRICKS) if edge else AIR)
        if a % 6 == 0:
            v.set(a, y + 3, ez, HANGING_LANTERN)
    cells = []
    for a0 in range(xa + 2, xb - 6, 7):
        for side in (-1, 1):
            c0 = ez - 6 if side < 0 else ez + 4
            for a in range(a0, a0 + 6):
                for c in range(c0 - 1, c0 + 5):
                    for k in range(-1, 5):
                        edge = a in (a0, a0 + 5) or c in (c0 - 1, c0 + 4) or k in (-1, 4)
                        v.set(a, y + k, c, (MOSSY_BRICKS if rng.random() < 0.3 else STONE_BRICKS) if edge else AIR)
            front = c0 + 4 if side < 0 else c0 - 1
            for a in range(a0 + 1, a0 + 5):
                v.fill(a, a, y, y + 3, front, front, IRON_BARS)
            v.fill(a0 + 2, a0 + 2, y, y + 1, front, front, AIR)          # the cell door is open
            cells.append((a0, c0, side))
            v.set(a0 + 1, y + 3, c0 + 1, WEB)
            v.set(a0 + 4, y, c0 + (3 if side < 0 else 0), HAY)
            v.set(a0 + 3, y, c0 + (3 if side < 0 else 0), BONE)
            v.set(a0 + 1, y + 3, c0 + 2, CHAIN)
    a0, c0, side = cells[1]
    v.chest("prisoner's stash", a0 + 1, y, c0 + (3 if side < 0 else 0), PRISONER_ITEMS, facing="east")
    # the vault at the end
    vx0, vx1 = xa - 12, xa - 1
    for a in range(vx0 - 1, vx1 + 2):
        for c in range(ez - 6, ez + 8):
            for k in range(-1, 7):
                edge = a in (vx0 - 1, vx1 + 1) or c in (ez - 6, ez + 7) or k in (-1, 6)
                v.set(a, y + k, c, POLISHED_BLACKSTONE if edge else AIR)
    v.fill(xa - 1, xa, y, y + 2, ez, ez + 1, AIR)
    for _ in range(18):
        a, c = rng.randint(vx0, vx0 + 3), rng.randint(ez - 5, ez + 6)
        for k in range(rng.randint(1, 3)):
            v.set(a, y + k, c, GOLD if rng.random() < 0.6 else RAW_GOLD)
    v.chest("dungeon vault", vx0 + 5, y, ez - 5, DUNGEON_VAULT_ITEMS, facing="south")
    v.set(vx0 + 7, y, ez - 5, OBSIDIAN)
    for (a, c) in ((vx0 + 6, ez + 6), (vx1, ez - 5)):
        v.set(a, y, c, LANTERN)
    v.places["dungeon"] = (xa + 10, y, ez)
    v.places["dungeon vault"] = (vx0 + 7, y, ez)

# ---------------------------------------------------------------- the deep dwarf mine under the haunted mountain
M_SQ = (36, 43, 6, 13)          # mine shaft stairs (local), in the mine cave
L1, L2, L3 = -86, -113, -141    # floor blocks of the three mine levels

def beams(v, x0, x1, z0, z1, y, h, axis="x"):
    """Wooden mine supports every 5 blocks along a tunnel."""
    rng = range(x0, x1 + 1, 5) if axis == "x" else range(z0, z1 + 1, 5)
    for p in rng:
        if axis == "x":
            for c in (z0, z1):
                v.fill(p, p, y + 1, y + h - 1, c, c, DARK_OAK_FENCE)
            v.fill(p, p, y + h, y + h, z0, z1, DARK_OAK_PLANKS)
        else:
            for a in (x0, x1):
                v.fill(a, a, y + 1, y + h - 1, p, p, DARK_OAK_FENCE)
            v.fill(x0, x1, y + h, y + h, p, p, DARK_OAK_PLANKS)

def ore_walls(v, x0, x1, y0, y1, z0, z1, chance, rich=False):
    rng = v.rng
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            for z in range(z0, z1 + 1):
                cur = v.get(x, y, z)
                if cur in (STONE, DEEPSLATE, ANDESITE, TUFF) and rng.random() < chance:
                    if any(v.get(x + a, y + b, z + c) == AIR for a, b, c in
                           ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))):
                        kind = rng.choice(("diamond", "emerald", "gold") if rich else ("coal", "iron", "gold", "lapis", "redstone", "diamond"))
                        v.set(x, y, z, ORE_BLOCKS[kind][1 if y <= -96 else 0])

def tunnel(v, x0, x1, z0, z1, fy, h=4, floor=None, rails=None):
    v.fill(x0, x1, fy + 1, fy + h, z0, z1, AIR)
    v.fill(x0, x1, fy, fy, z0, z1, floor or STONE)
    if rails is not None:
        for x in range(x0, x1 + 1):
            if v.get(x, fy + 1, rails) == AIR:
                v.set(x, fy + 1, rails, RAIL_EW)

def deep_mine(v):
    rng = v.rng
    # --- level 1: the junction, the underground lake and the diamond grotto
    tunnel(v, 28, 50, 1, 18, L1, 6, floor=STONE)
    beams(v, 28, 50, 1, 18, L1, 6)
    for (a, c) in ((30, 3), (47, 3), (30, 16), (47, 16)):
        v.set(a, L1 + 6, c, HANGING_LANTERN)
    tunnel(v, -6, 27, 8, 10, L1, 4, rails=9)
    beams(v, -6, 27, 8, 10, L1, 4)
    lx, lz = -22, 9
    for a in range(lx - 17, lx + 18):
        for c in range(lz - 13, lz + 14):
            for k in range(1, 11):
                if ((a - lx) / 16.5) ** 2 + ((k - 3) / 7.5) ** 2 + ((c - lz) / 12.5) ** 2 <= 1:
                    v.set(a, L1 + k, c, AIR)
            if ((a - lx) / 16.5) ** 2 + ((c - lz) / 12.5) ** 2 <= 0.95:
                lake = ((a - lx - 3) / 10.0) ** 2 + ((c - lz) / 7.5) ** 2 <= 1
                v.set(a, L1, c, WATER if lake else (MYCELIUM if (a + c) % 3 else STONE))
                if lake:
                    v.set(a, L1 - 1, c, SEA_LANTERN if (a * 7 + c) % 5 == 0 else WATER)
                    v.set(a, L1 - 2, c, STONE)
                elif v.get(a, L1, c) == MYCELIUM and rng.random() < 0.1:
                    v.set(a, L1 + 1, c, RED_MUSH if rng.random() < 0.5 else BROWN_MUSH)
    for (a, c) in ((lx - 13, lz - 6), (lx - 12, lz + 7), (lx + 13, lz + 7)):
        if v.get(a, L1, c) != WATER:
            v.set(a, L1 + 1, c, VERDANT_FROG)
    v.chest("lake", lx - 14, L1 + 1, lz, LAKE_ITEMS, facing="east")
    v.places["underground lake"] = (lx + 15, L1 + 1, lz)
    tunnel(v, 51, 60, 8, 10, L1, 4, rails=9)
    beams(v, 51, 60, 8, 10, L1, 4)
    for a in range(58, 70):
        for c in range(1, 18):
            for k in range(1, 8):
                if ((a - 64) / 6.0) ** 2 + ((k - 3) / 4.0) ** 2 + ((c - 9) / 7.5) ** 2 <= 1:
                    v.set(a, L1 + k, c, AIR)
    ore_walls(v, 56, 71, L1, L1 + 8, -1, 19, 0.35, rich=True)
    v.set(64, L1 + 1, 9, LANTERN)
    v.places["diamond grotto"] = (62, L1 + 1, 9)
    ore_walls(v, -6, 50, L1, L1 + 6, 0, 19, 0.06)
    # --- level 2: the chasm with a rope bridge, and the crystal cavern
    for a in range(16, 28):
        for c in range(-26, 42):
            wob = 2.2 * math.sin(c / 6.0)
            for y in range(L3 + 1, L2 + 18):
                if abs(a - 21.5 - wob) <= 3.2 + 1.5 * math.sin(y / 7.0 + c / 9.0):
                    v.set(a, y, c, AIR)
    for a in range(14, 30):
        for c in range(-26, 42):
            if v.get(a, L3 + 1, c) == AIR:
                v.set(a, L3, c, GRAVEL if (a + c) % 3 else STONE)
    tunnel(v, 28, 50, 1, 18, L2, 5, floor=STONE)
    beams(v, 28, 50, 1, 18, L2, 5)
    tunnel(v, -4, 27, 8, 10, L2, 4)
    for a in range(12, 32):                                        # the rope bridge
        for c in (8, 9, 10):
            v.set(a, L2, c, DARK_OAK_PLANKS if c != 8 or a % 2 else SPRUCE_PLANKS)
        for c in (7, 11):
            v.set(a, L2, c, DARK_OAK_PLANKS)
            v.set(a, L2 + 1, c, DARK_OAK_FENCE)
            v.fill(a, a, L2 + 2, L2 + 4, c, c, AIR)
    for c in (7, 11):
        for a in (12, 31):
            v.fill(a, a, L2 + 1, L2 + 3, c, c, DARK_OAK_LOG)
            v.set(a, L2 + 4, c, LANTERN)
    v.places["rope bridge"] = (20, L2 + 1, 9)
    gx, gy, gz = -18, L2 + 6, 9
    for a in range(gx - 15, gx + 16):
        for c in range(gz - 15, gz + 16):
            for y in range(gy - 15, gy + 16):
                d = math.sqrt((a - gx) ** 2 + ((y - gy) * 1.3) ** 2 + (c - gz) ** 2)
                if d > 14.5:
                    continue
                if d > 13.2:
                    v.set(a, y, c, CALCITE)
                elif d > 12.2:
                    r = rng.random()
                    v.set(a, y, c, PEARL_FROG if r < 0.06 else CRYING if r < 0.1 else AMETHYST)
                elif y <= L2:
                    v.set(a, y, c, AMETHYST if y == L2 and rng.random() < 0.4 else CALCITE)
                else:
                    v.set(a, y, c, AIR)
    for a in range(gx - 10, gx + 11):
        for c in range(gz - 10, gz + 11):
            if v.get(a, L2 + 1, c) == AIR and v.get(a, L2, c) == AMETHYST and rng.random() < 0.5:
                v.set(a, L2 + 1, c, AMETHYST_CLUSTER)
    tunnel(v, -9, 0, 8, 10, L2, 4)
    v.chest("crystal cavern", gx - 8, L2 + 1, gz, CRYSTAL_ITEMS, facing="east")
    v.places["crystal cavern"] = (gx + 4, L2 + 1, gz)
    # --- level 3: the Dwarf King's hoard, with a way back from the bottom of the chasm
    v.fill(28, 54, L3 + 1, L3 + 11, -6, 24, AIR)
    v.fill(28, 54, L3, L3, -6, 24, POLISHED_BLACKSTONE)
    for a in (27, 55):
        v.fill(a, a, L3, L3 + 11, -7, 25, DEEPSLATE_BRICKS)
    for c in (-7, 25):
        v.fill(27, 55, L3, L3 + 11, c, c, DEEPSLATE_BRICKS)
    v.fill(27, 55, L3 + 12, L3 + 12, -7, 25, DEEPSLATE_TILES)
    v.fill(24, 27, L3 + 1, L3 + 4, 8, 10, AIR)
    v.fill(24, 27, L3, L3, 8, 10, POLISHED_BLACKSTONE)
    for a in range(28, 55, 6):
        for c in (-6, 24):
            v.fill(a, a, L3 + 1, L3 + 11, c, c, DEEPSLATE_BRICKS)
    for _ in range(70):
        a, c = rng.randint(45, 54), rng.randint(-5, 23)
        for k in range(rng.randint(1, 4)):
            if v.get(a, L3 + 1 + k, c) == AIR:
                v.set(a, L3 + 1 + k, c, GOLD if rng.random() < 0.55 else RAW_GOLD)
    for (a, c) in ((32, -3), (32, 21), (50, -3)):
        for k in range(1, 7):
            v.set(a, L3 + k, c, AMETHYST if k < 5 else AMETHYST)
        v.set(a, L3 + 7, c, AMETHYST_CLUSTER)
    for (a, c) in ((30, 2), (30, 16), (44, 2), (44, 16), (40, 22)):
        v.set(a, L3 + 1, c, LIT_PUMPKIN["east"])
    for (a, c) in ((34, 0), (34, 19), (47, 9)):
        v.fill(a, a, L3 + 8, L3 + 11, c, c, CHAIN)
        v.set(a, L3 + 7, c, HANGING_SOUL_LANTERN)
    dwarf_statue(v, 51, 9, y=L3 + 1)
    v.chest("dwarf king's hoard", 44, L3 + 1, 9, DEEP_HOARD_ITEMS, facing="west")
    v.chest("deep diamonds", 44, L3 + 1, 11, DEEP_DIAMOND_ITEMS, facing="west")
    v.places["dwarf hoard"] = (32, L3 + 1, 9)
    v.places["chasm bottom"] = (21, L3 + 1, 9)
    spiral_stairs(v, M_SQ, L3 + 1, GROUND, [L1, L2, GROUND], DS_STAIRS, DEEPSLATE_BRICKS, CRYING, PEARL_FROG,
                  POLISHED_BLACKSTONE, LANTERN, floor0=L3, name="spooky mine")
    v.places["mine junction"] = (32, L1 + 1, 10)

# ---------------------------------------------------------------- the sky castle (floating islands)
# Built through two views of the same spot: `vg` on the ground (stable, beanstalk) and `vs` up in
# the sky, where local y GROUND is the top of the main island (SKY_OY blocks above the real ground).
S_C = (-0.5, -0.5)            # sky palace centre (and its grand staircase)
S_R = 15
SKY_SQ = (-4, 3, -4, 3)
SF1, SF2, SROOF, STOP = GROUND, GROUND + 10, GROUND + 20, GROUND + 32
SKY_ISLANDS = {"main": (0, 0, 29, 24), "garden": (-50, -8, 12, 11), "rainbow": (50, -14, 11, 10), "lookout": (0, -50, 9, 12)}

def sky_island(v, cx, cz, r, depth, seed):
    rng = random.Random(seed)
    R_ = int(r * 1.1) + 2
    xs, zs = np.arange(cx - R_, cx + R_ + 1), np.arange(cz - R_, cz + R_ + 1)
    X, Z = np.meshgrid(xs, zs, indexing="ij")
    n = fbm2(X + v.ox, Z + v.oz, 9, seed)
    d = np.hypot(X - cx, Z - cz) / (r * (1 + 0.06 * n))
    for (i, k) in np.argwhere(d < 1):
        x, z = int(xs[i]), int(zs[k])
        dd = d[i, k]
        bottom = GROUND - 2 - int(depth * (1 - dd ** 1.6) * (0.85 + 0.3 * rng.random()))
        for y in range(bottom, GROUND + 1):
            v.set(x, y, z, GRASS if y == GROUND else DIRT if y >= GROUND - 3 else
                  (ANDESITE if (y + x + z) % 7 == 0 else STONE))
        r_ = rng.random()
        if r_ < 0.12:
            v.set(x, bottom - 1, z, HANGING_ROOTS)
        elif r_ < 0.17:
            v.set(x, bottom - 1, z, LICHEN_CEILING)
    v.protect(int(cx - R_), int(cx + R_), int(cz - R_), int(cz + R_))

def sky_bridge(v, a, b, rainbow=False):
    """A bridge between two islands at island-top height, with fence rails (a rainbow one is wider)."""
    (ax, az), (bx, bz) = a, b
    L = math.hypot(bx - ax, bz - az)
    ux, uz = (bx - ax) / L, (bz - az) / L
    half = 3.5 if rainbow else 1.5
    done = set()
    for t in np.arange(0, L, 0.3):
        for o in np.arange(-half - 1, half + 1.01, 0.3):
            x, z = int(round(ax + ux * t - uz * o)), int(round(az + uz * t + ux * o))
            if (x, z) in done:
                continue
            done.add((x, z))
            if v.get(x, GROUND, z) != AIR:
                continue
            if abs(o) <= half:
                v.set(x, GROUND, z, RAINBOW[min(6, int((o + half) / (2 * half) * 7))] if rainbow else BIRCH_PLANKS)
    for (x, z) in done:
        if v.get(x, GROUND, z) == AIR and any(v.get(x + p, GROUND, z + q) in RAINBOW + [BIRCH_PLANKS]
                                             for p in (-1, 0, 1) for q in (-1, 0, 1)):
            v.set(x, GROUND, z, WHITE_C if rainbow else BIRCH_PLANKS)
            v.set(x, GROUND + 1, z, BIRCH_FENCE)

def sky_palace(vs):
    cx, cz = S_C
    R = S_R
    for x in range(-R - 2, R + 2):
        for z in range(-R - 2, R + 2):
            d = math.hypot(x - cx, z - cz)
            if d > R + 0.35:
                continue
            if d > R - 1.65:
                vs.fill(x, x, SF1, SROOF, z, z, WHITE_C)
                if d > R - 0.65:
                    for y in (SF2 - 1, SROOF - 1):
                        vs.set(x, y, z, GOLD)
                    vs.set(x, SROOF + 1, z, WHITE_C)
                    if (x + z) % 2 == 0:
                        vs.set(x, SROOF + 2, z, WHITE_C)
                ang = math.degrees(math.atan2(z - cz, x - cx)) % 360
                near = min(abs((ang - t + 180) % 360 - 180) for t in (90, 45, 135, 225, 315))
                if (ang + 3) % 30 < 6 and near > 16:
                    g = LBLUE_GLASS if int(ang // 30) % 2 else YELLOW_GLASS
                    for rows in (range(SF1 + 3, SF1 + 8), range(SF2 + 2, SF2 + 7)):
                        for y in rows:
                            vs.set(x, y, z, g)
            else:
                vs.fill(x, x, SF1 + 1, SROOF - 1, z, z, AIR)
                vs.set(x, SF1, z, QUARTZ if (x + z) % 2 else SMOOTH_QUARTZ)
                vs.set(x, SF2, z, SMOOTH_QUARTZ)
                vs.set(x, SROOF, z, QUARTZ)
    for x in (-9, -3, 3, 9):
        for z in (-9, -3, 3, 9):
            if not (-6 <= x <= 5 and -6 <= z <= 5) and math.hypot(x - cx, z - cz) < R - 3:
                for y in (SF2, SROOF):
                    vs.set(x, y, z, SEA_LANTERN)
    carve_door(vs, cx, cz, R, SF1 + 1, 90, width=1.6, height=6, depth=2.6)
    # throne room
    for z in range(5, 13):
        for x in (-1, 0):
            if vs.get(x, SF1 + 1, z) == AIR:
                vs.set(x, SF1 + 1, z, YELLOW_CARPET)
    for x in range(-5, 5):
        for z in range(-10, -6):
            vs.set(x, SF1 + 1, z, GOLD if (x + z) % 3 == 0 else QUARTZ)
    for x in range(-2, 2):
        vs.set(x, SF1 + 1, -6, QSTAIRS[3])
    throne(vs, 0, -8, SF1 + 2, 5, YELLOW_CARPET, mat=GOLD, back=WHITE_C, deco=DIAMOND)
    throne(vs, -3, -8, SF1 + 2, 3, LBLUE_CARPET, mat=GOLD, back=WHITE_C, deco=END_ROD_UP)
    throne(vs, 3, -8, SF1 + 2, 3, LBLUE_CARPET, mat=GOLD, back=WHITE_C, deco=END_ROD_UP)
    for (x, z) in ((-7, 5), (6, 5), (-8, -2), (7, -2)):
        chandelier(vs, x, z, SF2 - 1, SF2 - 4, hub=GOLD, light=HANGING_LANTERN, candle=YELLOW_CANDLE)
    vs.places["throne room"] = (-1, SF1 + 1, 7)
    # sky bedroom (second floor)
    y = SF2 + 1
    vs.bed(-9, y, -3, 1, color=4)
    vs.bed(-9, y, 2, 1, color=4)
    vs.set(-10, y, 0, BIRCH_PLANKS); vs.set(-10, y + 1, 0, LANTERN)
    vs.chest("wardrobe", 8, y, -3, SKY_WARDROBE_ITEMS, facing="west")
    vs.set(8, y, 2, BIRCH_PLANKS); vs.set(8, y + 1, 2, CAKE)
    for (x, z) in ((-6, -8), (5, -8), (-6, 7), (5, 7)):
        vs.set(x, y, z, YELLOW_CANDLE)
    vs.places["sky bedroom"] = (-6, y, 0)
    # towers, the great tower and the grand staircase
    for ang in (45, 135, 225, 315):
        a = math.radians(ang)
        tower(vs, cx + R * math.cos(a), cz + R * math.sin(a), 4, SF1, SROOF + 10, 12, (LBLUE_C, WHITE_C, YELLOW_C),
              room=(SROOF, [ang + 180]), band=GOLD, glass=LBLUE_GLASS, flag=YELLOW_WOOL, body=WHITE_C,
              floor=SMOOTH_QUARTZ, tip=GOLD)
    vs.places["tower room"] = (int(round(cx + R * 0.7071)), SROOF + 1, int(round(cz + R * 0.7071)))
    big_round_tower(vs, S_C, 8, SROOF, STOP + 8, [STOP], WHITE_C, GOLD, SMOOTH_QUARTZ, LBLUE_GLASS,
                    (LBLUE_C, WHITE_C, YELLOW_C), 16, GOLD, YELLOW_WOOL, QUARTZ, LANTERN)
    spiral_stairs(vs, SKY_SQ, SF1 + 1, STOP, [SF2, SROOF, STOP], QSTAIRS, QUARTZ_PILLAR, GOLD, SEA_LANTERN,
                  CHISELED_QUARTZ, LANTERN, floor0=SF1, name="sky")
    y = STOP + 1
    vs.chest("treasure", -1, y, -7, SKY_TREASURE_ITEMS, facing="south")
    vs.chest("sky lookout", 0, y, -7, SKY_SPYGLASS_ITEMS, facing="south")
    for x in (-3, 2):
        vs.set(x, y, -7, GOLD); vs.set(x, y + 1, -7, AMETHYST_CLUSTER)
    vs.places["treasure room"] = (0, y, -6)
    vs.places["roof"] = (8, SROOF + 1, 3)

def sky_gardens(vs):
    rng = vs.rng
    # path from the beanstalk landing to the palace door
    for z in range(13, 32):
        for x in range(-2, 2):
            if vs.get(x, GROUND, z) == GRASS:
                vs.set(x, GROUND, z, GOLD if x in (-2, 1) else SMOOTH_QUARTZ)
    for (x, z) in ((-4, 18), (3, 18), (-4, 26), (3, 26)):
        lamp_post(vs, x, GROUND + 1, z, 2, BIRCH_FENCE, LANTERN)
    whites = [FLOWERS[1], FLOWERS[3], FLOWERS[4], FLOWERS[5], FLOWERS[6]]
    for name, (ix, iz, r, _) in SKY_ISLANDS.items():
        for x in range(ix - r - 2, ix + r + 3):
            for z in range(iz - r - 2, iz + r + 3):
                if vs.get(x, GROUND, z) == GRASS and vs.get(x, GROUND + 1, z) == AIR:
                    q = rng.random()
                    if q < 0.30:
                        vs.set(x, GROUND + 1, z, rng.choice(whites))
                    elif q < 0.33 and math.hypot(x - ix, z - iz) > 4:
                        vs.set(x, GROUND + 1, z, LEAVES_PAD)
    # garden island: a blossom tree and a lily pond
    gx, gz = SKY_ISLANDS["garden"][:2]
    for x in range(gx + 2, gx + 6):
        for z in range(gz - 2, gz + 2):
            vs.set(x, GROUND, z, WATER)
            vs.set(x, GROUND + 1, z, LILY_PAD if (x + z) % 3 == 0 else AIR)
    cherry_tree(vs, gx - 4, GROUND + 1, gz, 0.8)
    vs.places["garden island"] = (gx - 1, GROUND + 1, gz + 5)
    # the island at the end of the rainbow
    rx, rz = SKY_ISLANDS["rainbow"][:2]
    for (x, z) in ((rx - 1, rz), (rx + 1, rz), (rx, rz - 1), (rx, rz + 1), (rx, rz)):
        vs.set(x, GROUND + 1, z, GOLD)
    vs.set(rx, GROUND + 2, rz, GOLD)
    vs.chest("end of the rainbow", rx + 2, GROUND + 1, rz, RAINBOW_END_ITEMS, facing="west")
    vs.places["rainbow island"] = (rx - 4, GROUND + 1, rz)
    # lookout island with a little tower
    lx, lz = SKY_ISLANDS["lookout"][:2]
    tower(vs, lx, lz, 4, GROUND, GROUND + 9, 10, (LBLUE_C, WHITE_C), room=(GROUND, [90]), band=GOLD,
          glass=LBLUE_GLASS, flag=YELLOW_WOOL, body=WHITE_C, floor=SMOOTH_QUARTZ, tip=GOLD)
    vs.chest("lookout", lx + 1, GROUND + 1, lz - 1, LOOKOUT_ITEMS, facing="south")
    vs.places["lookout"] = (lx, GROUND + 1, lz + 6)
    # bridges
    sky_bridge(vs, (0, 0), (gx, gz))
    sky_bridge(vs, (0, 0), (lx, lz))
    sky_bridge(vs, (0, 0), (rx, rz), rainbow=True)
    # a few clouds drifting round the islands
    for (x, y, z) in ((-38, -4, 26), (40, 3, 22), (-28, 6, -40), (34, -2, -44), (8, 10, 40)):
        for _ in range(4):
            bx, bz = x + rng.randint(-5, 5), z + rng.randint(-3, 3)
            for a in range(-5, 6):
                for c in range(-3, 4):
                    for k in range(-1, 2):
                        if (a / 5.5) ** 2 + (c / 3.5) ** 2 + (k / 1.6) ** 2 <= 1 and vs.get(bx + a, GROUND + y + k, bz + c) == AIR:
                            vs.set(bx + a, GROUND + y + k, bz + c, WHITE_WOOL)

def beanstalk(vg):
    """A giant beanstalk from the meadow up to the main island, with a ladder up its south side,
    leafy rest pads on the way, and a landing at the top by the island's edge."""
    top = GROUND + SKY_OY                       # the island top (and the landing) in ground coordinates
    for y in range(GROUND + 1, top):
        for x in (-1, 0, 1):
            for z in (33, 34, 35):
                vs_ = GREEN_C if (y + x * 2 + z) % 5 else MOSS
                vg.set(x, y, z, vs_)
        vg.set(0, y, 36, LADDERS[3])
        k = y - GROUND
        a = math.radians(k * 40)
        px, pz = int(round(math.cos(a) * 2.6)), int(round(34 + math.sin(a) * 2.6))
        if not (pz >= 36 and abs(px) <= 1):
            vg.set(px, y, pz, LEAVES_PAD, only_air=True)
        if k % 10 == 5:                                         # rest pads either side of the ladder
            side = 1 if (k // 10) % 2 else -1
            for x in range(1, 5):
                for z in range(33, 39):
                    if not (x == 0 and z == 36):
                        vg.set(side * x, y, z, LEAVES_PAD, only_air=True)
    vg.set(0, top, 36, LADDERS[3])
    for x in range(-4, 5):                                       # the landing
        for z in range(29, 39):
            if (x, z) != (0, 36):
                vg.set(x, top, z, BIRCH_PLANKS)
            vg.fill(x, x, top + 1, top + 4, z, z, AIR)
    for x in range(-4, 5):
        for z in range(31, 39):
            if (abs(x) == 4 or z == 38) and not (abs(x) <= 1 and z == 38 and False):
                vg.set(x, top + 1, z, BIRCH_FENCE)
    for (x, z) in ((-4, 31), (4, 31)):
        vg.set(x, top + 2, z, LANTERN)
    for k in range(1, 6):                                        # the beanstalk's curly top
        vg.set(0, top + k, 38 + k // 3, GREEN_C)
    for a in range(-3, 4):
        for c in range(-2, 3):
            for k in range(5, 8):
                if a * a + c * c + (k - 6) ** 2 * 2 <= 10:
                    vg.set(a, top + k, 40 + c, LEAVES_PAD, only_air=True)
    for a in range(-3, 4):
        for c in range(31, 38):
            if vg.get(a, GROUND, c) == GRASS and not (-1 <= a <= 1 and 33 <= c <= 36):
                vg.set(a, GROUND, c, MOSS)
    vg.places["beanstalk top"] = (2, top + 1, 33)

def sky_base(vg):
    """The meadow under the islands: a path from the road, a stable and hitching posts."""
    y = GROUND + 1
    for z in range(37, 57):
        for x in range(-2, 3):
            vg.set(x, GROUND, z, SMOOTH_QUARTZ if abs(x) < 2 else GOLD)
            vg.fill(x, x, y, y + 4, z, z, AIR)
    stable_at(vg, 6, 14, 38, 48, "west", BIRCH_PLANKS, BIRCH_FENCE, BIRCH_FENCE, LBLUE_C, WHITE_C, "stable",
              SKY_STABLE_ITEMS)
    for x in range(-12, -5):                                     # hitching rail
        vg.set(x, y, 44, BIRCH_FENCE)
        vg.fill(x, x, y + 1, y + 3, 44, 44, AIR)
    for (x, z) in ((-4, 40), (4, 52), (-4, 52)):
        lamp_post(vg, x, y, z, 2, BIRCH_FENCE, LANTERN)
    vg.protect(-18, 18, 28, 60)
    vg.places["hitching rail"] = (-9, y, 46)

def sky_castle(w):
    vg = View(w, SKY[0], SKY[1], "sky ")
    vs = View(w, SKY[0], SKY[1], "sky ", oy=SKY_OY)
    for i, (name, (x, z, r, depth)) in enumerate(SKY_ISLANDS.items()):
        sky_island(vs, x, z, r, depth, w.seed + 500 + i)
    sky_palace(vs)
    sky_gardens(vs)
    sky_base(vg)
    beanstalk(vg)

# ---------------------------------------------------------------- Blaze Castle (fire castle, badlands)
B_C = (-0.5, -4.5)            # palace / great tower / staircase centre (local)
B_R = 20
B_SQ = (-4, 3, -8, -1)
BLAZE_ROT = 1                 # gate faces west, toward the road from the Ice Palace

def blaze_to_world(x, z):
    for _ in range(BLAZE_ROT):
        x, z = -z, x
    return BLAZE[0] + x, BLAZE[1] + z

def flame_sculpture(v, x, z, y):
    for a in range(-1, 2):
        for c in range(-1, 2):
            v.set(x + a, y, z + c, PB_BRICKS)
    v.set(x, y + 1, z, OCHRE_FROG)
    for k in range(2, 9):
        rr = 1.6 * (1 - (k - 2) / 7) + 0.3
        for a in range(-2, 3):
            for c in range(-2, 3):
                if a * a + c * c <= rr * rr:
                    v.set(x + a, y + k, z + c, (RED_GLASS if k < 4 else ORANGE_GLASS if k < 7 else YELLOW_GLASS))
    v.set(x, y + 2, z, SHROOMLIGHT)

def blaze_outer(v):
    for x in range(-52, 53):
        for z in range(-52, 53):
            d = math.hypot(x, z)
            if 44 <= d <= 49.5:                                  # a glowing "lava" moat: orange glass over lights
                v.set(x, GROUND - 1, z, SHROOMLIGHT)
                v.set(x, GROUND, z, ORANGE_GLASS)
                v.fill(x, x, GROUND + 1, GROUND + 8, z, z, AIR)
            elif IW0 <= d <= IW1:
                v.fill(x, x, GROUND - 2, WALL_TOP, z, z, POLISHED_BLACKSTONE)
                v.set(x, WALL_TOP - 3, z, RED_NETHER)
                v.set(x, WALL_TOP - 6, z, OCHRE_FROG)
                v.set(x, WALL_TOP, z, RED_NETHER)
                if d > 39.4 and (x + z) % 2 == 0:
                    v.set(x, WALL_TOP + 1, z, PB_BRICKS)
            elif d < IW0:
                v.set(x, GROUND, z, RED_SAND)
                v.fill(x, x, GROUND + 1, GROUND + 12, z, z, AIR)
    v.protect(-53, 53, -53, 53)
    for x in range(-3, 4):
        for z in range(30, 43):
            if IW0 - 0.6 <= math.hypot(x, z) <= IW1 + 0.6:
                top = -55 if abs(x) <= 1 else (-56 if abs(x) <= 2 else -57)
                v.fill(x, x, GROUND + 1, top, z, z, AIR)
    v.set(0, -54, 40, GOLD); v.set(-1, -54, 40, GOLD)
    for z in range(14, 54):
        for x in range(-2, 2):
            v.set(x, GROUND, z, (GOLD if x in (-2, 1) else RED_NETHER) if z < 41 else PB_BRICKS)
        if z >= 41:
            for x in (-3, 2):
                v.set(x, GROUND, z, PB_BRICKS)
                v.set(x, GROUND + 1, z, NETHER_FENCE)
    for x in (-3, 2):
        for z in (43, 53):
            v.set(x, GROUND + 2, z, LANTERN)
    for xs in ((14, 15), (-15, -14)):
        for x in xs:
            for t in range(12):
                z, y = 23 + t, GROUND + 1 + t
                v.fill(x, x, GROUND + 1, y - 1, z, z, POLISHED_BLACKSTONE)
                v.set(x, y, z, PB_STAIRS[2])
    for ang in [0, 45, 135, 180, 225, 270, 315, 79, 101]:
        a = math.radians(ang)
        tower(v, 39 * math.cos(a), 39 * math.sin(a), 4, GROUND - 2, -38 if ang not in (79, 101) else -42, 12, FLAME,
              room=(WALL_TOP, [ang + 90, ang - 90]), band=RED_NETHER, glass=ORANGE_GLASS, flag=ORANGE_WOOL,
              body=POLISHED_BLACKSTONE, floor=RED_NETHER, tip=SHROOMLIGHT)
    v.places["wall walk"] = (19, WALL_TOP + 1, 33)
    v.places["tower room"] = (28, WALL_TOP + 1, 28)

def blaze_palace(v):
    cx, cz = B_C
    R = B_R
    for x in range(-23, 23):
        for z in range(-28, 20):
            d = math.hypot(x - cx, z - cz)
            if d > R + 0.35:
                continue
            if d > R - 1.65:
                v.fill(x, x, F1, ROOF, z, z, PB_BRICKS)
                if d > R - 0.65:
                    for y in (F2 - 1, F3 - 1, ROOF - 1):
                        v.set(x, y, z, RED_NETHER)
                    v.set(x, F2 - 4, z, OCHRE_FROG)
                    v.set(x, ROOF + 1, z, POLISHED_BLACKSTONE)
                    if (x + z) % 2 == 0:
                        v.set(x, ROOF + 2, z, PB_BRICKS)
                ang = math.degrees(math.atan2(z - cz, x - cx)) % 360
                near = min(abs((ang - t + 180) % 360 - 180) for t in (90, 45, 135, 225, 315))
                if (ang + 2.5) % 24 < 5 and near > 13:
                    g = ORANGE_GLASS if int(ang // 24) % 2 else RED_GLASS
                    for rows in (range(-57, -51), range(F2 + 2, F2 + 6), range(F3 + 2, F3 + 6)):
                        for y in rows:
                            v.set(x, y, z, g)
            else:
                v.fill(x, x, F1 + 1, ROOF - 1, z, z, AIR)
                v.set(x, F1, z, RED_NETHER if (x + z) % 2 else PB_BRICKS)
                v.set(x, F2, z, SHROOMLIGHT if (x * 3 + z * 5) % 7 == 0 else ORANGE_GLASS)    # glowing "lava" floor
                v.set(x, F3, z, POLISHED_BLACKSTONE)
                v.set(x, ROOF, z, PB_BRICKS)
    for x in range(-15, 16, 6):
        for z in range(-19, 12, 6):
            if math.hypot(x - cx, z - cz) < R - 3 and not (-6 <= x <= 5 and -10 <= z <= 1):
                for y in (F3, ROOF):
                    v.set(x, y, z, SHROOMLIGHT)
    carve_door(v, cx, cz, R, F1 + 1, 90, width=2.2, height=7, depth=2.6)
    # the throne room, with lava-lamp pillars
    for z in range(0, 16):
        for x in range(-2, 2):
            if v.get(x, F1 + 1, z) == AIR:
                v.set(x, F1 + 1, z, ORANGE_CARPET if x in (-1, 0) else RED_CARPET)
    for k in range(12):
        ang = k * 30
        if ang in (90, 270):
            continue
        a = math.radians(ang)
        px, pz = int(round(cx + 13.5 * math.cos(a))), int(round(cz + 13.5 * math.sin(a)))
        for y in range(F1 + 1, F2):
            v.set(px, y, pz, SHROOMLIGHT if (y - F1) % 3 == 0 else ORANGE_GLASS)
    for x in range(-6, 6):
        for z in range(-20, -15):
            v.set(x, F1 + 1, z, RED_NETHER)
    for x in range(-2, 2):
        v.set(x, F1 + 1, -15, PB_STAIRS[3])
    throne(v, -1, -18, F1 + 2, 6, ORANGE_CARPET, mat=GOLD, back=PB_BRICKS, deco=SHROOMLIGHT, side=END_ROD_UP)
    throne(v, -5, -18, F1 + 2, 3, RED_CARPET, mat=GOLD, back=PB_BRICKS, deco=END_ROD_UP)
    throne(v, 3, -18, F1 + 2, 3, RED_CARPET, mat=GOLD, back=PB_BRICKS, deco=END_ROD_UP)
    for (x, z) in ((-10, -4), (9, -4), (-1, 8)):
        chandelier(v, x, z, F2 - 1, -52, hub=GOLD, light=HANGING_LANTERN, candle=ORANGE_CANDLE)
    v.places["throne"] = (-1, F1 + 2, -13)
    # second floor: a parkour course over the glowing floor, climbing round to a prize
    pads = []
    for i in range(14):
        a = math.radians(20 + i * 9)
        px, pz = int(round(cx + 13 * math.cos(a))), int(round(cz + 13 * math.sin(a)))
        top = F2 + 1 + min(i // 2, 4)
        v.set(px, top, pz, (RED_C, ORANGE_C, YELLOW_C)[i % 3])
        pads.append((px, top, pz))
    lx, ly, lz = pads[-1]
    for a in (-1, 0, 1):
        for c in (-1, 0, 1):
            v.set(lx + a, ly, lz + c, GOLD)
    v.chest("parkour prize", lx - 1, ly + 1, lz, PARKOUR_ITEMS, facing="east")
    v.w.parkour = [(*v.to_world(x, z)[:1], y + v.oy, v.to_world(x, z)[1]) for x, y, z in pads]
    sx_, sy_, sz_ = pads[0]
    v.places["parkour start"] = (sx_ + 1, F2 + 1, sz_ - 1)
    # third floor: bedroom and trophy room
    y0 = F3 + 1
    v.bed(-15, y0, -8, 1, color=1)
    v.bed(-15, y0, -1, 1, color=1)
    v.set(-17, y0, -5, PB_BRICKS); v.set(-17, y0 + 1, -5, LANTERN)
    v.chest("wardrobe", -12, y0, -14, BLAZE_WARDROBE_ITEMS, facing="south")
    v.set(-10, y0, 4, PB_BRICKS); v.set(-10, y0 + 1, 4, CAKE)
    for (x, z, m_) in ((12, -12, GOLD), (14, -7, DIAMOND), (14, -1, EMERALD_BLOCK), (11, 4, NETHERITE_BLOCK)):
        v.set(x, y0, z, POLISHED_BLACKSTONE); v.set(x, y0 + 1, z, m_)
    v.places["bedroom"] = (-12, y0, -4)
    v.places["trophy room"] = (10, y0, -4)
    # spires, great tower, staircase, treasure
    for ang in (45, 135, 225, 315):
        a = math.radians(ang)
        tower(v, cx + R * math.cos(a), cz + R * math.sin(a), 4, F1, -22, 18, FLAME, room=(ROOF, [ang + 180]),
              band=RED_NETHER, glass=ORANGE_GLASS, flag=ORANGE_WOOL, body=PB_BRICKS, floor=RED_NETHER, tip=SHROOMLIGHT)
    big_round_tower(v, B_C, 9, ROOF, 12, [MID, TOP], PB_BRICKS, RED_NETHER, POLISHED_BLACKSTONE, ORANGE_GLASS,
                    [RED_C] * 3 + [ORANGE_C] * 3 + [YELLOW_C] * 4, 30, SHROOMLIGHT, ORANGE_WOOL, POLISHED_BLACKSTONE, LANTERN)
    v.places["tower middle room"] = (-1, MID + 1, -11)
    spiral_stairs(v, B_SQ, STEP0, TOP, [F2, F3, ROOF, MID, TOP], PB_STAIRS, PB_BRICKS, RED_NETHER, SHROOMLIGHT,
                  POLISHED_BLACKSTONE, LANTERN, floor0=F1)
    v.places["roof"] = (12, ROOF + 1, 6)
    y = TOP + 1
    v.chest("treasure", -1, y, -11, BLAZE_TREASURE_ITEMS, facing="south")
    v.chest("tower treasure", 0, y, -11, BLAZE_SPYGLASS_ITEMS, facing="south")
    for (x, z) in ((-3, -11), (2, -11), (-7, -3), (6, -3)):
        if v.get(x, y, z) == AIR and v.get(x, y - 1, z) != AIR:
            v.set(x, y, z, GOLD)
    v.places["treasure room"] = (0, y, -11)

def blaze_courtyard(v):
    y = GROUND + 1
    for sx in (-7, 6):
        flame_sculpture(v, sx, 27, y)
    for (x, z) in ((-4, 20), (3, 20), (-4, 34), (3, 34)):
        lamp_post(v, x, y, z, 2, NETHER_FENCE, LANTERN)
    for (fx, fz) in ((-20, 20), (20, 20), (24, -22), (-22, -24)):              # fire pits
        for a in (-1, 0, 1):
            for c in (-1, 0, 1):
                v.set(fx + a, y, fz + c, PB_BRICKS if (a or c) else CAMPFIRE)
    v.places["fire pits"] = (-20, y, 24)
    for (x, z) in ((28, 4), (30, 12), (-28, 16)):
        for k in range(1, 3):
            v.set(x, y + k - 1, z, CACTUS)
    stable_at(v, -34, -26, -6, 4, "east", PB_BRICKS, POLISHED_BLACKSTONE, NETHER_FENCE, RED_C, ORANGE_C, "stable",
              BLAZE_STABLE_ITEMS)

def blaze_secret(v):
    """A trapdoor behind the left throne leads down to the Lava Cave: pools of glowing "lava"
    (orange glass over lights, safe to walk on), lava-falls on the walls and the Fire Vault."""
    end = secret_passage(v, -8, F1, -19, TRAPDOORS["crimson"], 9, "n", "w", 30, PB_BRICKS, PB_STAIRS, HANGING_LANTERN)
    ex, ey, ez = end
    rng = v.rng
    x0, x1, z0, z1 = ex - 16, ex - 1, ez - 7, ez + 8
    for a in range(x0 - 1, x1 + 2):
        for c in range(z0 - 1, z1 + 2):
            wall = a in (x0 - 1, x1 + 1) or c in (z0 - 1, z1 + 1)
            for k in range(0, 9):
                v.set(a, ey + k, c, (RED_NETHER if rng.random() < 0.5 else BLACKSTONE) if (wall or k in (0, 8)) else AIR)
    v.fill(x1 + 1, x1 + 1, ey + 1, ey + 3, ez, ez + 1, AIR)
    for a in range(x0, x1 + 1):
        for c in range(z0, z1 + 1):
            pool = ((a - (x0 + 6)) / 4.0) ** 2 + ((c - ez) / 3.5) ** 2 <= 1
            if pool:
                v.set(a, ey, c, ORANGE_GLASS)
                v.set(a, ey - 1, c, SHROOMLIGHT)
    for c in range(z0, z1 + 1, 3):                                   # lava-falls on the back wall
        for k in range(1, 8):
            v.set(x0 - 1, ey + k, c, ORANGE_GLASS if k % 3 else SHROOMLIGHT)
    for _ in range(14):
        a, c = rng.randint(x1 - 4, x1 - 1), rng.randint(z0, z0 + 3)
        for k in range(rng.randint(1, 2)):
            v.set(a, ey + 1 + k, c, GOLD)
    v.chest("fire vault", x1 - 2, ey + 1, z1 - 1, FIRE_VAULT_ITEMS, facing="north")
    v.set(x1 - 4, ey + 1, z1 - 1, LANTERN)
    v.places["lava cave"] = (x1 - 3, ey + 1, ez + 4)

def blaze_castle(w):
    v = View(w, BLAZE[0], BLAZE[1], "blaze ", rot=BLAZE_ROT)
    blaze_outer(v)
    blaze_palace(v)
    blaze_courtyard(v)
    blaze_secret(v)

# ---------------------------------------------------------------- level.dat
# ---------------------------------------------------------------- Kingdom Quest (the story add-on)
MAGIC_BARRIER = blk("kq:magic_barrier")          # from the Kingdom Quest pack: unbreakable, see-through, glowing
QUEST_PACKS = ("KingdomQuest_BP", "KingdomQuest_RP")
FARM = (30, 68)                                   # the hen house yard, between the castle and the river, by the road
FARM_ITEMS = [item(0, "oak_fence", 64), item(0, "fence_gate", 4), item(0, "wheat_seeds", 32), item(0, "lead", 2),
              item(0, "bread", 8)]
FARMLAND = blk("farmland", moisturized_amount=7)
WHEAT = blk("wheat", growth=7)
# A magic fence round each castle after the first (name, centre, radius, the quest that opens its gate).
# Only the gate, where the road comes in, opens; the fence stays.
MAGIC_RINGS = [("ice", ICE, 60, 1), ("blaze", BLAZE, 62, 2), ("knight", (KNIGHT[0] - 6, KNIGHT[1]), 88, 3), ("spooky", SPOOKY, 72, 4),
               ("sky", SKY, 75, 5)]
RING_HEIGHT = 6                                   # higher than a horse can jump

def farm_yard(w):
    """Quest 1's farm: a flat grassy yard with a little hen house in the middle (build a pen round it), a wheat
    field, a chest of fences, gates and seeds, and a scarecrow. Returns the hen house spot and where the hens
    Graham scattered start out."""
    v = View(w, FARM[0], FARM[1], "farm ")
    y = GROUND + 1
    for x in range(-13, 14):
        for z in range(-13, 14):
            v.fill(x, x, y, y + 22, z, z, AIR)
            for yy in range(GROUND - 4, GROUND):
                if v.get(x, yy, z) in PASSABLE:
                    v.set(x, yy, z, DIRT)
            v.set(x, GROUND, z, GRASS)
            if (x * 7 + z * 13) % 5 == 0 and max(abs(x), abs(z)) > 2:
                v.set(x, y, z, SHORT_GRASS)                 # grass to break for seeds
    v.protect(-13, 13, -13, 13)
    # the hen house: four posts and a roof with a bale of hay on top
    for x in (-1, 0, 1):
        for z in (-1, 0, 1):
            v.set(x, y, z, AIR)
            if abs(x) == 1 and abs(z) == 1:
                v.fill(x, x, y, y + 1, z, z, OAK_LOG)
            v.set(x, y + 2, z, OAK_PLANKS)
    v.set(0, y + 3, 0, HAY)
    # wheat field (north-west), with a water channel
    for x in range(-12, -5):
        for z in range(-12, -5):
            if x == -9:
                v.set(x, GROUND, z, WATER)
                v.set(x, y, z, AIR)
            else:
                v.set(x, GROUND, z, FARMLAND)
                v.set(x, y, z, WHEAT)
    v.chest("chest", -4, y, -11, FARM_ITEMS, facing="south")
    v.set(-3, y, -11, HAY); v.set(-3, y + 1, -11, LANTERN)
    # scarecrow
    v.fill(9, 9, y, y + 1, 9, 9, OAK_FENCE)
    v.set(9, y + 2, 9, PUMPKIN_HEAD["south"])
    v.set(8, y + 1, 9, OAK_FENCE); v.set(10, y + 1, 9, OAK_FENCE)
    # a path from the road
    for x in (-13,):
        for z in (-3, 3):
            lamp_post(v, x, y, z, 2, OAK_FENCE, LANTERN)
    x = -14
    while x > -40:
        wx, wz = v.to_world(x, 0)
        if w.road_mask[wx - X0, wz - Z0]:
            break
        for z in (-1, 0, 1):
            v.set(x, GROUND, z, GRASS_PATH)
            v.fill(x, x, y, y + 3, z, z, AIR)
        x -= 1
    for x in range(-13, -1):
        for z in (-1, 0, 1):
            v.set(x, GROUND, z, GRASS_PATH)
            v.set(x, y, z, AIR)
    v.places["hen house"] = (0, y, 2)
    v.places["wheat field"] = (-9, y, -5)
    # hens, scattered by Graham all round the meadows this side of the river
    rng = random.Random(w.seed + 77)
    spots = []
    tries = 0
    while len(spots) < 16 and tries < 20000:
        tries += 1
        a, r = rng.uniform(0, 2 * math.pi), rng.uniform(16, 60)
        x, z = int(FARM[0] + r * math.cos(a)), int(FARM[1] + r * math.sin(a))
        if max(abs(x), abs(z)) < 56 or z > river_z(x) - 4 or z < 50 or abs(x) > 110:
            continue
        if w.road_mask[x - X0, z - Z0] or w.get(x, GROUND, z) != GRASS or w.get(x, y, z) not in PASSABLE \
                or w.get(x, y + 1, z) not in PASSABLE or w.get(x, y, z) == WATER:
            continue
        if any(math.hypot(x - a_, z - b_) < 6 for a_, _, b_ in spots):
            continue
        spots.append((x, y, z))
    assert len(spots) >= 12, "room for the hens"
    return {"coop": (FARM[0], y, FARM[1]), "hens": spots}

def ground_top(w, x, z):
    """The top of the solid ground in a column (climbing up rock and walls, but not trees, clouds or islands)."""
    if not (X0 <= x < X1 and Z0 <= z < Z1):
        return GROUND
    y = int(w.ground[x - X0, z - Z0])
    soft = lambda v: v in PASSABLE or v == MAGIC_BARRIER
    while soft(w.get(x, y, z)) and y > GROUND - 20:
        y -= 1
    while not soft(w.get(x, y + 1, z)) and w.get(x, y + 1, z) not in TREE_PARTS and y < MAX_Y - 12:
        y += 1
    return y

def magic_ring(w, name, center, r, opens):
    """A ring of magic barrier round a castle, RING_HEIGHT above the ground (higher where the ground beside it
    is higher, so there are no gaps on slopes), with a gate where the road crosses: amethyst posts, a glowing
    lintel and a curtain of barrier that the story takes away."""
    cx, cz = center
    band = [(x, z) for x in range(cx - r - 2, cx + r + 3) for z in range(cz - r - 2, cz + r + 3)
            if abs(math.hypot(x - cx, z - cz) - r) <= 1.0]
    tops = {(x, z): ground_top(w, x, z) for x in range(cx - r - 4, cx + r + 5) for z in range(cz - r - 4, cz + r + 5)
            if abs(math.hypot(x - cx, z - cz) - r) <= 3.0}
    road = np.argwhere(w.road_mask) + [X0, Z0]
    near_road = road[np.abs(np.hypot(road[:, 0] - cx, road[:, 1] - cz) - r) <= 6]
    def road_dist(x, z):
        return float(np.min(np.hypot(near_road[:, 0] - x, near_road[:, 1] - z))) if len(near_road) else 99.0
    gate, posts = [], []
    for (x, z) in band:
        rd = road_dist(x, z)
        t = tops[(x, z)]
        high = max(tops.get((x + a, z + c), t) for a in (-1, 0, 1) for c in (-1, 0, 1)) + RING_HEIGHT
        if rd <= 3.2:
            gate.append((x, z, t))
        elif rd <= 4.6:
            posts.append((x, z, t))
        else:
            for y in range(t - 3, high + 1):            # a little way down too, over cave mouths
                if w.get(x, y, z) in PASSABLE or (y > t and w.get(x, y, z) in TREE_PARTS):
                    w.set(x, y, z, MAGIC_BARRIER)
                    if w.get(x, y + 1, z) == SNOW_LAYER:   # snow that sat on a branch we replaced
                        w.set(x, y + 1, z, AIR)
    cells = []
    lintel = max([t for _, _, t in gate] + [GROUND]) + 8
    for (x, z, t) in gate:
        for y in range(t + 1, lintel):
            if w.get(x, y, z) in PASSABLE or w.get(x, y, z) in TREE_PARTS:
                w.set(x, y, z, MAGIC_BARRIER)
                cells.append((x, y, z))
        w.set(x, lintel, z, PEARL_FROG)
    for (x, z, t) in posts:
        w.fill(x, x, t + 1, lintel, z, z, AMETHYST)
        w.set(x, lintel + 1, z, AMETHYST_CLUSTER)
    gx = sum(c[0] for c in cells) / max(1, len(cells))
    gz = sum(c[2] for c in cells) / max(1, len(cells))
    w.places[name + " magic gate"] = (int(round(gx + (cx - gx) * 6 / r)), GROUND + 1, int(round(gz + (cz - gz) * 6 / r)))
    return {"name": name, "center": (cx, cz), "r": r, "opens": opens, "gate": cells}

# ---------------------------------------------------------------- inns along the roads
OAK_PLANKS = blk("oak_planks")
# (name, road, walls, corner logs, roof, bed color, carpet, fence, clerk)
INNS = [
    ("blossom inn", "princess-ice", CHERRY_PLANKS, CHERRY_LOG, PINK_C, 6, PINK_CARPET, CHERRY_FENCE, "Rosie"),
    ("snowflake inn", "ice-blaze", SPRUCE_PLANKS, SPRUCE_LOG, LBLUE_C, 3, LBLUE_CARPET, SPRUCE_FENCE, "Bo"),
    ("sunny inn", "blaze-knight", BIRCH_PLANKS, OAK_LOG, ORANGE_C, 1, ORANGE_CARPET, OAK_FENCE, "Kit"),
    ("acorn inn", "knight-spooky", DARK_OAK_PLANKS, DARK_OAK_LOG, RED_C, 14, RED_CARPET, DARK_OAK_FENCE, "Max"),
    ("cloud inn", "spooky-sky", BIRCH_PLANKS, BIRCH_PLANKS, YELLOW_C, 4, YELLOW_CARPET, BIRCH_FENCE, "Lulu"),
]
INN_ITEMS = [item(0, "bread", 16), item(0, "cookie", 16), item(0, "golden_carrot", 16), item(0, "apple", 8),
             item(0, "torch", 16)]
INN_PAD = (-11, 14, -8, 8)            # local x0, x1, z0, z1 of the flat yard (front of the inn at z 5)
CARDINAL_ROT = {(0, 1): 0, (-1, 0): 1, (0, -1): 2, (1, 0): 3}   # which rot turns local +z to this world direction

def inn_site(w, road):
    """A flat-ish spot beside the middle of a road, outside every magic fence and clear of other roads and water.
    Returns (centre x, centre z, rot) with the inn's front (local +z) facing the road."""
    c = w.road_curves[road]
    dist = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(c, axis=0).T))])
    total = dist[-1]
    best = None
    for frac in [0.5 + s_ * 0.02 * k for k in range(0, 15) for s_ in (1, -1)]:
        i = int(np.searchsorted(dist, total * frac))
        d = c[min(i + 1, len(c) - 1)] - c[max(i - 1, 0)]
        d = d / np.hypot(*d)
        for side, off in ((1, 15), (-1, 15), (1, 21), (-1, 21)):
            n = np.array([-d[1], d[0]]) * side
            card = (int(round(n[0])), 0) if abs(n[0]) >= abs(n[1]) else (0, int(round(n[1])))
            rot = CARDINAL_ROT[(-card[0], -card[1])]
            cx, cz = int(round(c[i][0] + card[0] * off)), int(round(c[i][1] + card[1] * off))
            v = View(w, cx, cz, "", rot)
            cells = [v.to_world(x, z) for x in range(INN_PAD[0], INN_PAD[1] + 1) for z in range(INN_PAD[2], INN_PAD[3] + 1)]
            if not all(X0 + 4 <= x < X1 - 4 and Z0 + 4 <= z < Z1 - 4 for x, z in cells):
                continue
            back = [v.to_world(x, z) for x in range(INN_PAD[0], INN_PAD[1] + 1) for z in range(INN_PAD[2], 7)]
            if any(w.road_mask[x - X0, z - Z0] for x, z in back):
                continue
            if any(w.get(x, GROUND, z) == WATER or w.get(x, GROUND - 1, z) == WATER for x, z in cells):
                continue
            if any(math.hypot(cx - a, cz - b) < r + 22 for _, (a, b), r, _ in MAGIC_RINGS):
                continue
            if any(math.hypot(cx - a, cz - b) < 110 for a, b in (PRINCESS,)):
                continue
            g = np.array([w.ground[x - X0, z - Z0] for x, z in cells])
            score = float(np.abs(g - GROUND).mean()) + abs(frac - 0.5) * 25 + (off - 15) * 0.1
            if best is None or score < best[0]:
                best = (score, cx, cz, rot)
        if best and best[0] < 1.0:
            break
    assert best, "no room for an inn on the %s road" % road
    return best[1:]

def build_inn(w, idx, name, road, walls, log, roof, bed_color, carpet, fence, clerk):
    cx, cz, rot = inn_site(w, road)
    v = View(w, cx, cz, name + " ", rot)
    x0, x1, z0, z1 = INN_PAD
    # flatten the yard
    for x in range(x0, x1 + 1):
        for z in range(z0, z1 + 1):
            wx, wz = v.to_world(x, z)
            if w.road_mask[wx - X0, wz - Z0]:
                continue
            v.fill(x, x, GROUND + 1, GROUND + 22, z, z, AIR)
            for y in range(GROUND - 4, GROUND):
                if v.get(x, y, z) in PASSABLE:
                    v.set(x, y, z, DIRT)
            v.set(x, GROUND, z, GRASS)
    v.protect(x0, x1, z0, z1)
    y = GROUND + 1
    # floor, walls, windows
    for x in range(-7, 8):
        for z in range(-5, 6):
            v.set(x, GROUND, z, walls)
            edge = abs(x) == 7 or abs(z) == 5
            if abs(x) == 7 and abs(z) == 5:
                v.fill(x, x, y, y + 3, z, z, log)
            elif edge:
                v.fill(x, x, y, y + 3, z, z, walls)
                if (z == 5 and abs(x) in (3, 4)) or (abs(x) == 7 and abs(z) <= 1) or (z == -5 and abs(x) in (4,)):
                    v.fill(x, x, y + 1, y + 2, z, z, WHITE_GLASS)
            v.set(x, y + 4, z, walls if edge or (x % 4 or z % 4) else GLOWSTONE)   # ceiling, with lights
    v.fill(0, 0, y, y + 1, 5, 5, AIR)                                              # the front door
    # gable roof (ridge along x), with an overhang
    for k in range(7):
        yy = y + 4 + k
        for z in (-6 + k, 6 - k):
            v.fill(-8, 8, yy, yy, z, z, roof)
        if k >= 1:
            for x in (-7, 7):
                v.fill(x, x, yy, yy, -5 + k, 5 - k, walls)
    # inside: a front desk with the clerk behind it, four beds, a pantry and a cake table
    for x in range(-6, -2):
        v.set(x, y, -1, log)
    v.set(-3, y, -2, log)
    v.set(-6, y + 1, -1, LANTERN)
    for x in (0, 2, 4, 6):
        v.bed(x, y, -3, 2, bed_color)
    for z in range(-2, 5):
        for x in (-1, 0, 1):
            v.set(x, y, z, carpet)
    v.chest("pantry", 6, y, 3, INN_ITEMS, facing="west")
    v.set(-6, y, 3, walls); v.set(-6, y + 1, 3, CAKE)
    v.set(-5, y, 3, walls); v.set(-5, y + 1, 3, PINK_CANDLE)
    v.set(6, y, 0, walls); v.set(6, y + 1, 0, LANTERN)
    # outside: lamps by the door, a path to the road, a hitching rail with hay and a water trough
    for x in (-2, 2):
        lamp_post(v, x, y, 7, 2, fence, LANTERN)
    for x in range(9, 14):
        v.set(x, y, 1, fence)
    v.set(13, y, 3, HAY)
    for x in (10, 11, 12):
        v.set(x, GROUND, 3, WATER)
    z = 6
    while z < 28:
        wx, wz = v.to_world(0, z)
        if w.road_mask[wx - X0, wz - Z0]:
            break
        for x in (-1, 0, 1):
            v.set(x, GROUND, z, GRASS_PATH)
            v.fill(x, x, y, y + 3, z, z, AIR)
        z += 1
    clerk = v.to_world(-5, -3)
    v.places["front desk"] = (-4, y, 1)
    v.places["beds"] = (1, y, -2)
    return {"name": name, "clerk_name": clerk, "clerk": (clerk[0], y, clerk[1]), "facing": 90 * rot,
            "door": v.to_world(0, 7), "road": road}

def build_inns(w):
    w.inns = []
    for i, spec in enumerate(INNS):
        info = build_inn(w, i, *spec)
        info["clerk_name"] = spec[-1]
        w.inns.append(info)

def round_fountain(z):
    """x of a path up the courtyard that steps round the fountain (at z 27)."""
    d = abs(z - 27)
    return -5 if d <= 5 else -3 if d <= 8 else 0

def kingdom_quest(w):
    """Where the story happens: the princess's seat, the golden eggs, the magic barriers that close the
    road to the Ice Palace (and its gate) until her quest is done, and Graham's paw-print trail."""
    q = {}
    seat = (0, F1 + 3, -2)                                       # on the cushion of the big pink throne
    assert w.get(0, F1 + 2, -2) == GOLD and w.get(0, F1 + 4, -2) == AIR
    q["princess"] = seat
    q["farm"] = farm_yard(w)
    q["rings"] = [magic_ring(w, *r) for r in MAGIC_RINGS]
    build_inns(w)
    c = w.road_curves["princess-ice"]
    # Graham's paw prints: from the throne, out of the castle, and all the way to the Ice Palace gate
    trail = [(0, F1 + 1, z) for z in range(1, KZ1 + 1, 3)]
    trail += [(round_fountain(z), GROUND + 1, z) for z in range(KZ1 + 3, JUNCTION[1], 3)]
    last = None
    for (x, z) in c:
        if last is None or math.hypot(x - last[0], z - last[1]) >= 3:
            trail.append((int(math.floor(x)), GROUND + 1, int(math.floor(z))))
            last = (x, z)
    trail += [(ICE[0], GROUND + 1, ICE[1] + z) for z in range(54, 44, -3)]
    q["trail"] = [feet(w, x, y, z) for (x, y, z) in trail]
    # gold sparkles from the spawn up to the princess, until you have met her
    to_p = [(0, GROUND + 1, z) for z in range(w.spawn[2] - 4, KZ1 + 2, -3)] + [(0, F1 + 1, z) for z in range(KZ1, 0, -3)]
    q["to princess"] = [feet(w, round_fountain(z), y, z) for (x, y, z) in to_p]
    w.quest = q
    return q

def feet(w, x, y, z):
    """Where you stand at (x, z), starting the search at height y (bridges and steps lift it)."""
    for yy in range(y, y + 10):
        if w.get(x, yy, z) in PASSABLE and w.get(x, yy - 1, z) not in PASSABLE and w.get(x, yy + 1, z) in PASSABLE:
            return (x, yy, z)
    return (x, y, z)

def heading8(path, i):
    """Which way the path goes at point i, in eighths of a turn clockwise from north (0 north, 2 east, 4 south)."""
    a, b = (path[i], path[i + 1]) if i + 1 < len(path) else (path[i - 1], path[i])
    return int(round(math.degrees(math.atan2(b[0] - a[0], -(b[2] - a[2]))) / 45)) % 8

def quest_data_js(w):
    """addons/KingdomQuest_BP/scripts/kingdom_data.js: the world's story spots in game coordinates."""
    g = lambda p: [p[0], p[1] + Y_OFF, p[2]]
    q = w.quest
    data = {"princess": g(q["princess"]), "princessFacing": 0,
            "farm": {"coop": g(q["farm"]["coop"]), "hens": [g(p) for p in q["farm"]["hens"]]},
            "rings": [{"name": r_["name"], "center": list(r_["center"]), "r": r_["r"], "opens": r_["opens"],
                       "gate": [g(p) for p in r_["gate"]]} for r_ in q["rings"]],
            "trail": [g(p) + [heading8(q["trail"], i)] for i, p in enumerate(q["trail"])], "toPrincess": [g(p) for p in q["to princess"]],
            "inns": [{"name": n["name"], "clerk": n["clerk_name"], "pos": g(n["clerk"]), "facing": n["facing"]} for n in w.inns],
            "spawn": g(w.spawn), "iceGate": g(w.places["ice magic gate"])}
    return ("// Written by tools/make_princess_world.py: where the story happens in the Princess Kingdom world.\n"
            "export const KINGDOM = " + json.dumps(data, separators=(",", ":")) + ";\n")

FLAT_LAYERS = json.dumps({
    "biome_id": PLAINS_BIOME,
    "block_layers": [{"block_name": "minecraft:bedrock", "count": 1}, {"block_name": "minecraft:deepslate", "count": 64},
                     {"block_name": "minecraft:stone", "count": 31}, {"block_name": "minecraft:dirt", "count": 3},
                     {"block_name": "minecraft:grass_block", "count": 1}],
    "encoding_version": 6, "structure_options": None, "world_version": "version.post_1_18"},
    separators=(",", ":"))

def level_dat(w):
    """Same layout as the Floating Islands world, with Peaceful difficulty and plains outside."""
    saved = fw.WORLD_NAME, fw.FLAT_LAYERS
    fw.WORLD_NAME, fw.FLAT_LAYERS = WORLD_NAME, FLAT_LAYERS
    try:
        class _Shim: pass
        shim = _Shim()
        shim.seed, shim.spawn = w.seed, (w.spawn[0], w.spawn[1] + Y_OFF, w.spawn[2])
        raw = fw.level_dat(shim)
    finally:
        fw.WORLD_NAME, fw.FLAT_LAYERS = saved
    # Difficulty: patch the int in the NBT body (Easy 1 -> Peaceful 0)
    key = b"\x03" + struct.pack("<H", 10) + b"Difficulty"
    p = raw.index(key) + len(key)
    raw = raw[:p] + struct.pack("<i", 0) + raw[p + 4:]
    return raw

# ---------------------------------------------------------------- chunks
def chunk_records(w, cx, cz, palette_nbt):
    i0, k0 = cx * 16 - X0, cz * 16 - Z0
    col = w.b[i0:i0 + 16, :, k0:k0 + 16]
    base = struct.pack("<ii", cx, cz)
    yield base + bytes([0x2C]), bytes([CHUNK_VERSION])
    for sy in range(H // 16):
        sub = col[:, sy * 16:(sy + 1) * 16, :]
        if not sub.any():
            continue
        xzy = sub.transpose(0, 2, 1).reshape(-1)
        y_index = sy + (MIN_Y + Y_OFF) // 16
        yield base + bytes([0x2F, y_index & 0xFF]), bytes([9, 1, y_index & 0xFF]) + encode_storage(xzy, palette_nbt)
    nz = col != AIR
    top = np.where(nz.any(axis=1), H - np.argmax(nz[:, ::-1, :], axis=1), 0)
    hm = top.T.reshape(-1).astype("<i2")
    ci, ck = i0 + 8, k0 + 8
    biome = (MESA_BIOME if w.blaze_w[ci, ck] > 0.5 else SWAMP_BIOME if w.spooky_w[ci, ck] > 0.5 else SNOW_BIOME if w.ice_w[ci, ck] > 0.5
             else MOUNTAIN_BIOME if w.mountain_w[ci, ck] > 0.4
             else FOREST_BIOME if w.knight_w[ci, ck] > 0.5
             else PLAINS_BIOME)
    biomes = b"".join(bytes([1]) + struct.pack("<i", biome) for _ in range(25))
    yield base + bytes([0x2B]), hm.tobytes() + biomes
    yield base + bytes([0x36]), struct.pack("<i", 2)
    bes = [nb for (x, y, z, nb) in w.block_entities if x >> 4 == cx and z >> 4 == cz]
    if bes:
        yield base + bytes([0x31]), b"".join(bes)

def embed_quest_packs(w, tmp):
    """Write the story data into the Kingdom Quest behaviour pack and put both packs inside the world."""
    addons = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "addons")
    with open(os.path.join(addons, "KingdomQuest_BP", "scripts", "kingdom_data.js"), "w") as f:
        f.write(quest_data_js(w))
    for kind, pack in (("behavior", QUEST_PACKS[0]), ("resource", QUEST_PACKS[1])):
        src = os.path.join(addons, pack)
        shutil.copytree(src, os.path.join(tmp, kind + "_packs", pack))
        m = json.load(open(os.path.join(src, "manifest.json")))["header"]
        with open(os.path.join(tmp, "world_%s_packs.json" % kind), "w") as f:
            json.dump([{"pack_id": m["uuid"], "version": m["version"]}], f, indent=2)

def write_world(w, out_dir, preview):
    import plyvel
    tmp = tempfile.mkdtemp()
    db = plyvel.DB(os.path.join(tmp, "db"), create_if_missing=True, compression=None)
    palette_nbt = {i: fw.nbt({"name": STR(n), "states": C({k: fw._auto(v) for k, v in s.items()}),
                              "version": I(BLOCK_VERSION)}) for i, (n, s) in enumerate(PALETTE)}
    n_chunks = 0
    with db.write_batch() as wb:
        for cx in range(X0 // 16, X1 // 16):
            for cz in range(Z0 // 16, Z1 // 16):
                for key, val in chunk_records(w, cx, cz, palette_nbt):
                    wb.put(key, val)
                n_chunks += 1
    db.compact_range()
    db.close()
    with open(os.path.join(tmp, "level.dat"), "wb") as f:
        f.write(level_dat(w))
    with open(os.path.join(tmp, "levelname.txt"), "w") as f:
        f.write(WORLD_NAME)
    embed_quest_packs(w, tmp)
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
    c[MAGIC_BARRIER] = (200, 120, 255)
    c[FARMLAND] = (110, 75, 45); c[WHEAT] = (220, 190, 80)
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
    by_name = [("snow", (245, 248, 252)), ("packed_ice", (150, 185, 235)), ("blue_ice", (110, 160, 235)),
               ("minecraft:ice", (165, 200, 245)), ("diamond", (100, 230, 225)), ("emerald", (40, 200, 90)),
               ("lapis", (40, 70, 170)), ("white_stained", (235, 240, 245)), ("light_blue_wool", (110, 180, 230)),
               ("cyan", (40, 140, 150)), ("white_carpet", (235, 238, 240)), ("spruce_log", (60, 45, 30)),
               ("spruce_leaves", (50, 85, 55)), ("spruce", (115, 85, 50)), ("soul_lantern", (120, 220, 230)),
               ("carved_pumpkin", (220, 130, 30)), ("candle", (110, 180, 230)), ("verdant", (190, 255, 170)),
               ("fern", (80, 140, 55)), ("oak_log", (100, 80, 50)), ("dark_oak_log", (60, 45, 30)),
               ("dark_oak_leaves", (45, 100, 35)), ("oak_leaves", (70, 135, 45)), ("dark_oak", (70, 50, 30)),
               ("andesite", (135, 135, 132)), ("mossy", (95, 115, 85)), ("cobblestone", (120, 120, 120)),
               ("tall_grass", (80, 150, 55)), ("poppy", (220, 40, 40)), ("dandelion", (250, 220, 40)),
               ("stone_brick", (125, 125, 125)), ("deepslate", (70, 70, 75)), ("blackstone", (45, 40, 45)),
               ("red_nether", (110, 15, 15)), ("red_wool", (175, 40, 40)), ("yellow_wool", (245, 200, 50)),
               ("black_wool", (30, 30, 30)), ("red_carpet", (175, 40, 40)), ("green_carpet", (80, 110, 30)),
               ("blue_carpet", (50, 60, 170)), ("brown_carpet", (110, 75, 45)), ("black_carpet", (25, 25, 30)), ("gray_stained", (90, 90, 95)),
               ("iron", (200, 200, 205)), ("target", (230, 220, 210)), ("anvil", (70, 70, 70)), ("table", (130, 95, 60)),
               ("furnace", (90, 90, 95)), ("campfire", (255, 170, 60)), ("barrel", (130, 95, 55)),
               ("dragon_egg", (20, 10, 30)), ("shroomlight", (255, 170, 80)), ("bone", (230, 225, 200)),
               ("coarse_dirt", (110, 80, 55)), ("crying_obsidian", (90, 30, 170)), ("obsidian", (25, 15, 40)),
               ("hay", (200, 170, 50)), ("lit_pumpkin", (250, 170, 40)), ("pumpkin", (225, 130, 30)), ("web", (225, 225, 230)),
               ("mycelium", (115, 95, 115)), ("red_mushroom", (200, 40, 40)), ("brown_mushroom", (150, 110, 80)),
               ("mushroom_stem", (210, 200, 185)), ("tuff", (105, 108, 100)), ("raw_gold", (220, 170, 50)),
               ("diamond_ore", (90, 200, 200)), ("gold_ore", (220, 190, 70)), ("emerald_ore", (60, 190, 90)),
               ("lapis_ore", (60, 80, 180)), ("iron_ore", (190, 160, 140)), ("coal_ore", (40, 40, 40)), ("rail", (130, 110, 90)),
               ("brewing", (110, 100, 90)), ("cauldron", (60, 60, 65)), ("black_concrete", (20, 20, 25)),
               ("lime_wool", (110, 190, 25)), ("purple_carpet", (120, 40, 170)), ("deadbush", (130, 95, 50)),
               ("podzol", (95, 65, 30)), ("orange_stained", (240, 140, 40)), ("red_stained", (200, 50, 40)),
               ("ochre", (245, 210, 120)), ("nether_brick_fence", (60, 25, 30)), ("red_sand", (190, 100, 40)),
               ("orange_terracotta", (160, 85, 40)), ("yellow_terracotta", (185, 135, 35)), ("white_terracotta", (210, 180, 160)),
               ("red_terracotta", (145, 60, 45)), ("hardened_clay", (150, 95, 65)), ("brown_terracotta", (80, 55, 40)),
               ("light_gray_terracotta", (135, 105, 95)), ("cactus", (80, 125, 40)), ("orange_wool", (240, 120, 20)),
               ("orange_carpet", (240, 120, 20)), ("netherite_block", (65, 60, 65)), ("birch_planks", (215, 200, 150)), ("birch_fence", (215, 200, 150)),
               ("yellow_stained", (250, 225, 90)), ("yellow_carpet", (250, 215, 60)), ("hanging_roots", (150, 110, 90)),
               ("green_concrete", (75, 110, 35)), ("moss_block", (90, 140, 50)), ("azalea_leaves", (90, 140, 50)), ("gravel", (130, 125, 120)), ("purple_wool", (120, 40, 170))]
    for i, (n, st) in enumerate(PALETTE):
        if i and i not in c:
            for key, rgb in by_name:
                if key in n:
                    c[i] = rgb
                    break
    return c
GLOW = {*LIT_PUMPKIN.values(), CRYING, VERDANT_FROG, LANTERN, HANGING_LANTERN, SEA_LANTERN, GLOWSTONE, PEARL_FROG, END_ROD_UP, PINK_CANDLE, SOUL_LANTERN,
        HANGING_SOUL_LANTERN, SHROOMLIGHT, LBLUE_CANDLE, CAMPFIRE}

def render(w, path, region=None, sc=2, night=False, min_y=GROUND - 6):
    from PIL import Image, ImageFilter
    lut = np.zeros((len(PALETTE) + 1, 3), np.float32)
    for k, v in _colors().items():
        if v: lut[k] = v
    b = w.b
    if region:
        x0, x1, z0, z1 = region
        b = b[x0 - X0:x1 - X0, :, z0 - Z0:z1 - Z0]
    b = b[:, min_y - MIN_Y:, :]
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
    Wd, Hd = (b.shape[0] + b.shape[2]) * sc + 2 * sc, int(sy.max()) + 4 * sc
    img = np.zeros((Hd, Wd, 3), np.float32)
    img[:] = (16, 16, 48) if night else (175, 215, 250)
    for ox in range(sc):
        for oy in range(3 * sc):             # tall enough to cover the side of the block too
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
    plan_roads(w)
    build_ground(w)
    build_river(w)
    pv = View(w, 0, 0, "")
    moat_and_bridge(pv)
    build_road(w)
    keep(pv)
    grand_hall(pv)
    floor_two(pv)
    floor_three(pv)
    roof_garden(pv)
    keep_towers(pv)
    great_tower(pv)
    stairwell(pv)
    treasure_room(pv)
    outer_wall(pv)
    courtyard(pv)
    princess_secret(pv)
    draw_roads(w)
    ice_castle(w)
    knight_castle(w)
    spooky_castle(w)
    sky_castle(w)
    blaze_castle(w)
    giant_rainbow(w)
    crystal_grove(w, -72, 40)
    fairy_pond(w, 72, 42)
    frozen_ponds(w)
    add_ores(w)
    caves(w)
    cave_glow(w)
    plant_land(w)
    tidy_plants(w)
    snow_cover(w)
    clouds(w)
    kingdom_quest(w)
    w.build_seconds = time.time() - t0
    return w

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20261112)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "dist"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    w = generate(a.seed)
    render(w, os.path.join(a.out, "princess_preview.png"), sc=1)
    castle = os.path.join(a.out, "princess_preview_castle.png")
    render(w, castle, region=(-52, 52, -52, 52), sc=5)
    render(w, os.path.join(a.out, "princess_preview_ice.png"), region=(ICE[0] - 54, ICE[0] + 54, ICE[1] - 54, ICE[1] + 54), sc=5)
    render(w, os.path.join(a.out, "princess_preview_knight.png"), region=(KNIGHT[0] - 52, KNIGHT[0] + 52, KNIGHT[1] - 52, KNIGHT[1] + 52), sc=5)
    render(w, os.path.join(a.out, "princess_preview_spooky.png"), region=(SPOOKY[0] - 74, SPOOKY[0] + 74, SPOOKY[1] - 82, SPOOKY[1] + 62), sc=4)
    render(w, os.path.join(a.out, "princess_preview_sky.png"), region=(SKY[0] - 72, SKY[0] + 72, SKY[1] - 72, SKY[1] + 64), sc=4)
    render(w, os.path.join(a.out, "princess_preview_blaze.png"), region=(BLAZE[0] - 120, BLAZE[0] + 56, BLAZE[1] - 70, BLAZE[1] + 90), sc=4)
    render(w, os.path.join(a.out, "princess_preview_night.png"), sc=1, night=True)
    out, n = write_world(w, a.out, castle)
    steps = sum(len(s_) for s_, _ in w.stairs.values())
    print(f"{w.tree_count} trees, {getattr(w, 'spikes', 0)} ice spikes, {w.pond_count} frozen ponds, {w.cloud_count} clouds, "
          f"{len(w.chests)} treasure chests, {steps} stairs; spawn {w.spawn}; {n} chunks")
    print(f"{w.ore_count} ore blocks, {len(w.cave_entrances)} cave entrances, {w.glow_count} glow lichen")
    print("roads: " + ", ".join(f"{k} {v:.0f} blocks" for k, v in w.road_length.items()))
    print(f"Wrote {out} ({os.path.getsize(out) // 1024} KB) in {w.build_seconds:.0f}s")

if __name__ == "__main__":
    main()
