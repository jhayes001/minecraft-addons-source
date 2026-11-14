"""Checks the Princess Kingdom world (princess castle, ice palace, knight's fortress and the
roads between them, and the haunted mountain): builds it, reopens the .mcworld and reads it back.

  - every chunk's sub-chunks decode back to exactly the blocks that were generated
  - level.dat parses, with the kid-friendly rules (Peaceful, no fall damage, keep inventory)
  - the spawn is a safe spot, and every chest's block entity is stored in its own chunk
  - plants, lanterns, carpets, cakes, candles and beds all sit on (or hang from) something;
    two-block flowers and beds are whole; water doesn't touch open air (no leaks)
  - each castle's grand staircase climbs one block per step with headroom all the way, and
    each floor's step is level with that floor
  - the roads join all three castle gates and the spawn, with no step higher than one block
  - in each castle you can WALK from the road to every room, the towers, the wall walk, the
    balcony or lookout and every treasure chest; from the spawn you can walk to the top of
    the rainbow and its pots of gold (no flying, no breaking blocks)
  - optional: every block state is valid for the game version, checked against Mojang's
    block list (pass the path to mojang-blocks.json from github.com/Mojang/bedrock-samples,
    metadata/vanilladata_modules, at the tag matching GAME_VERSION)

Usage: python3 tests/princess_world_test.py [path/to/mojang-blocks.json]
"""
import json, math, os, struct, sys, tempfile, zipfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "tools"))
sys.path.insert(0, HERE)
import make_princess_world as mpw
from floating_world_test import read_nbt, decode_subchunk

fails = []
def check(ok, msg):
    if not ok:
        fails.append(msg)
        print("FAIL:", msg)

def walk_reach(b, start, passable_ids, water_id, climb_ids=()):
    """Cells (feet positions) a player can reach on foot from `start`: walk, step up one
    block, fall any distance, swim, climb ladders (and through an opened trapdoor above one).
    Returns a bool array [x, y, z]."""
    P = np.isin(b, list(passable_ids) + list(climb_ids))
    Hh = b.shape[1]
    body = np.zeros_like(P)
    body[:, :-1, :] = P[:, :-1, :] & P[:, 1:, :]
    head2 = np.zeros_like(P)                       # room to jump: 3 free cells
    head2[:, :-2, :] = body[:, :-2, :] & P[:, 2:, :]
    wet = np.isin(b, [water_id] + list(climb_ids))
    below_solid = np.zeros_like(P)
    below_solid[:, 1:, :] = ~P[:, :-1, :] | wet[:, :-1, :]
    supported = body & (below_solid | wet)
    R = np.zeros_like(P)
    sx, sy, sz = start
    R[sx, sy, sz] = True
    def shifts(m):
        out = np.zeros_like(m)
        out[1:, :, :] |= m[:-1, :, :]; out[:-1, :, :] |= m[1:, :, :]
        out[:, :, 1:] |= m[:, :, :-1]; out[:, :, :-1] |= m[:, :, 1:]
        return out
    for _ in range(3000):
        before = int(R.sum())
        st = R & supported
        new = shifts(st) & body                                   # walk / walk off edges
        up = np.zeros_like(R)
        up[:, 1:, :] = shifts(st & head2)[:, :-1, :]               # step or jump up one
        new |= up & body
        swim = np.zeros_like(R)
        swim[:, 1:, :] = (R & wet)[:, :-1, :]                      # swim or climb up
        new |= swim & body
        down = np.zeros_like(R)
        down[:, :-1, :] = (R & (wet | ~supported))[:, 1:, :]       # swim or climb down
        new |= down & body
        into = np.zeros_like(R)
        into[:, :-1, :] = R[:, 1:, :]                               # open a trapdoor / step onto a ladder below
        new |= into & body & wet
        R |= new
        for _ in range(64):                                       # fall
            f = np.zeros_like(R)
            f[:, :-1, :] = (R & ~supported)[:, 1:, :]
            f &= body & ~R
            if not f.any():
                break
            R |= f
        if int(R.sum()) == before:
            break
    return R

def no_name_clashes():
    """Every top-level name in the generator is set once (a second castle once reused a name and
    quietly moved the first castle's staircase)."""
    import ast, collections
    src = open(os.path.join(HERE, "..", "tools", "make_princess_world.py")).read()
    seen = collections.Counter()
    for node in ast.parse(src).body:
        if isinstance(node, ast.Assign):
            for t in node.targets:
                for n in ast.walk(t):
                    if isinstance(n, ast.Name):
                        seen[n.id] += 1
        elif isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            seen[node.name] += 1
    twice = sorted(n for n, k in seen.items() if k > 1)
    check(not twice, "no top-level name is set twice (%s)" % twice)

def main():
    no_name_clashes()
    out = tempfile.mkdtemp()
    w = mpw.generate(20261112)
    prev = os.path.join(out, "p.png")
    mpw.render(w, prev, region=(-20, 20, -20, 20), sc=1)
    sxz = (mpw.SX // 16) * (mpw.SZ // 16)
    path, n_chunks = mpw.write_world(w, out, prev)
    check(n_chunks == sxz, "chunk count")

    # ---- reopen the .mcworld
    import plyvel
    tmp = tempfile.mkdtemp()
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        check("level.dat" in names and "levelname.txt" in names and "world_icon.jpeg" in names, "world files present")
        z.extractall(tmp)
    raw = open(os.path.join(tmp, "level.dat"), "rb").read()
    ver, length = struct.unpack_from("<ii", raw)
    check(ver == 10 and length == len(raw) - 8, "level.dat header")
    lvl, end = read_nbt(raw, 8)
    check(end == len(raw), "level.dat parses to the end")
    check(lvl["LevelName"] == "Princess Kingdom", "world name")
    check(lvl["Generator"] == 2 and json.loads(lvl["FlatWorldLayers"])["biome_id"] == mpw.PLAINS_BIOME, "flat plains outside")
    check(lvl["Difficulty"] == 0 and lvl["falldamage"] == 0 and lvl["keepinventory"] == 1 and lvl["GameType"] == 0,
          "kid-friendly rules (Peaceful, no fall damage, keep inventory, Survival)")
    sx, sy, sz = lvl["SpawnX"], lvl["SpawnY"] - mpw.Y_OFF, lvl["SpawnZ"]
    check(lvl["SpawnY"] == mpw.GROUND + 1 + mpw.Y_OFF, "spawn on the raised ground (y %d)" % lvl["SpawnY"])
    layers = json.loads(lvl["FlatWorldLayers"])["block_layers"]
    check(sum(l["count"] for l in layers) == mpw.GROUND + mpw.Y_OFF + 64 + 1, "flat world outside is as deep as the built area")

    db = plyvel.DB(os.path.join(tmp, "db"))
    name_of = {i: (n, s) for i, (n, s) in enumerate(mpw.PALETTE)}
    lookup = {}
    for i, (n, s) in name_of.items():
        lookup[(n, tuple(sorted(s.items())))] = i
    decoded = np.zeros_like(w.b)
    be = {}
    biomes = set()
    for key, val in db:
        if len(key) < 9:
            continue
        cx, cz = struct.unpack_from("<ii", key)
        tag = key[8]
        if tag == 0x2F:
            ns, yi, idx, pal = decode_subchunk(val)
            ids = []
            for pe in pal:
                st = tuple(sorted((k, (bool(v) if isinstance(name_of_states(pe["name"], k), bool) else v))
                                  for k, v in pe["states"].items()))
                ids.append(lookup.get((pe["name"], st), -1))
                check(ids[-1] >= 0, "palette entry %s" % pe)
                check(pe["version"] == mpw.BLOCK_VERSION, "block version")
            blocks = np.array(ids, np.int32)[idx].reshape(16, 16, 16).astype(np.uint16)
            i0, k0, j0 = cx * 16 - mpw.X0, cz * 16 - mpw.Z0, yi * 16 - (mpw.MIN_Y + mpw.Y_OFF)
            decoded[i0:i0 + 16, j0:j0 + 16, k0:k0 + 16] = blocks.transpose(0, 2, 1)
        elif tag == 0x31:
            p = 0
            while p < len(val):
                d, p = read_nbt(val, p)
                be[(d["x"], d["y"] - mpw.Y_OFF, d["z"])] = (d, (cx, cz))
        elif tag == 0x36:
            check(struct.unpack("<i", val)[0] == 2, "finalized")
        elif tag == 0x2B:
            biomes.add(struct.unpack_from("<i", val, 513)[0])
    db.close()
    check(np.array_equal(decoded, w.b), "blocks read back identical")
    check(biomes == {mpw.PLAINS_BIOME, mpw.SNOW_BIOME, mpw.FOREST_BIOME, mpw.SWAMP_BIOME, mpw.MOUNTAIN_BIOME, mpw.MESA_BIOME},
          "plains, snowy, forest, swamp and mountain chunks (%s)" % biomes)
    peak = int(w.ground[mpw.knight_to_world(0, 0)[0] - 200 - mpw.X0:mpw.KNIGHT[0] + 96 - mpw.X0,
                        mpw.KNIGHT[1] - 200 - mpw.Z0:mpw.KNIGHT[1] + 200 - mpw.Z0].max())
    check(peak > mpw.GROUND + 60, "real mountains round the Knight's Fortress (highest %d blocks up)" % (peak - mpw.GROUND))
    check(int((w.snowcap & (w.mountain_w > 0)).sum()) > 500, "snowy peaks")

    b = w.b
    at = w.get
    P = set(mpw.PASSABLE) | {mpw.MAGIC_BARRIER}          # the story opens the magic barriers; walk as if they're gone
    # ---- spawn and chests
    check(at(sx, sy, sz) == mpw.AIR and at(sx, sy + 1, sz) == mpw.AIR, "spawn has headroom")
    check(at(sx, sy - 1, sz) not in P, "spawn has ground")
    check(len(w.chests) >= 20, "plenty of treasure chests (%d)" % len(w.chests))
    for name, (x, y, z) in w.chests.items():
        check(at(x, y, z) in mpw.CHESTS.values(), "%s chest block" % name)
        e = be.get((x, y, z))
        check(e is not None and e[0]["id"] == "Chest" and e[1] == (x >> 4, z >> 4), "%s chest entity in its chunk" % name)
        if e:
            check(len(e[0]["Items"]) >= (1 if name in ("chasm snow golem egg", "blaze graham's collar") else 4), "%s chest has items" % name)
    for c in ("", "ice ", "knight ", "spooky ", "sky ", "blaze "):
        check(any(n.startswith(c + "stable") for n in w.chests) and
              any(it["Name"] == "minecraft:horse_spawn_egg" for it in be[w.chests[c + "stable"]][0]["Items"]),
              "%sstable has horse eggs" % c)
    spawn_items = [it["Name"] for it in be[w.chests["spawn"]][0]["Items"]]
    check("minecraft:golden_helmet" in spawn_items and "minecraft:leather_chestplate" in spawn_items, "princess outfit at spawn")
    beds = sorted(be[k][0]["color"] for k, (d, _) in be.items() if d["id"] == "Bed")
    check(beds == [1] * 12 + [3] * 20 + [4] * 12 + [6] * 20 + [10] * 12 + [14] * 16,
          "castle beds, 4 in each inn and 4 by each princess's throne (%s)" % beds)

    # ---- support rules
    below = np.zeros_like(b); below[:, 1:, :] = b[:, :-1, :]
    above = np.zeros_like(b); above[:, :-1, :] = b[:, 1:, :]
    soil = [mpw.GRASS, mpw.DIRT]
    def bad_count(ids, ok_below=None, ok_above=None):
        m = np.isin(b, ids)
        if ok_below is not None:
            m &= ~np.isin(below, ok_below)
        if ok_above is not None:
            m &= ~np.isin(above, ok_above)
        return int(m.sum())
    lows = [lo for lo, _ in mpw.DOUBLE_FLOWERS]
    highs = [hi for _, hi in mpw.DOUBLE_FLOWERS]
    plants = mpw.FLOWERS + mpw.PETALS + [mpw.SHORT_GRASS, mpw.FERN, mpw.POPPY, mpw.DANDELION, mpw.TALL_GRASS[0]] + lows
    check(bad_count(plants, soil) == 0, "plants grow on grass (%d not)" % bad_count(plants, soil))
    check(int(((b == mpw.TALL_GRASS[1]) & (below != mpw.TALL_GRASS[0])).sum()) == 0, "tall grass whole")
    n = bad_count([mpw.RED_MUSH, mpw.BROWN_MUSH], [mpw.PODZOL, mpw.MYCELIUM])
    check(n == 0, "mushrooms on podzol or mycelium, where they never pop off (%d not)" % n)
    n = bad_count([mpw.DEADBUSH], [mpw.PODZOL, mpw.COARSE_DIRT, mpw.DIRT, mpw.RED_SAND])
    check(n == 0, "dead bushes on podzol, dirt or red sand (%d not)" % n)
    n = bad_count([mpw.CACTUS], [mpw.RED_SAND, mpw.CACTUS])
    check(n == 0, "cacti stand on red sand (%d not)" % n)
    for lo, hi in mpw.DOUBLE_FLOWERS:
        check(int(((b == hi) & (below != lo)).sum()) == 0 and int(((b == lo) & (above != hi)).sum()) == 0, "tall flowers whole")
    not_solid = list(P | {mpw.AIR})
    stand = [mpw.LANTERN, mpw.PINK_CANDLE, mpw.CAKE, mpw.PINK_CARPET, mpw.MAGENTA_CARPET, mpw.LBLUE_CARPET,
             mpw.AMETHYST_CLUSTER, mpw.END_ROD_UP, mpw.SNOW_LAYER, mpw.SOUL_LANTERN, mpw.LBLUE_CANDLE, mpw.WHITE_CARPET,
             mpw.RED_CARPET, mpw.GREEN_CARPET, mpw.BLUE_CARPET, mpw.BROWN_CARPET, mpw.DRAGON_EGG, mpw.CAMPFIRE,
             mpw.ANVIL, mpw.PURPLE_CANDLE, mpw.PURPLE_CARPET, mpw.BLACK_CARPET, mpw.RAIL_EW, mpw.BREWING, mpw.CAULDRON,
             mpw.HAY, mpw.LICHEN_FLOOR] + list(mpw.PUMPKIN.values()) + list(mpw.BEDS.values()) + list(mpw.CHESTS.values())
    m = np.isin(b, stand) & np.isin(below, not_solid)
    check(int(m.sum()) == 0, "lanterns, candles, cakes, carpets, beds, chests sit on something (%d loose)" % m.sum())
    m = np.isin(b, [mpw.HANGING_LANTERN, mpw.HANGING_SOUL_LANTERN, mpw.LICHEN_CEILING]) & np.isin(above, not_solid)
    check(int(m.sum()) == 0, "hanging lanterns hang from something (%d loose)" % m.sum())
    check(bad_count([mpw.LILY_PAD], [mpw.WATER]) == 0, "lily pads on water")
    # beds: foot and head pieces paired
    for (d, head), bid in mpw.BEDS.items():
        dx, dz = [(0, 1), (-1, 0), (0, -1), (1, 0)][d]
        for (i, j, k) in np.argwhere(b == bid):
            x, y, z = i + mpw.X0, j + mpw.MIN_Y, k + mpw.Z0
            other = (x - dx, y, z - dz) if head else (x + dx, y, z + dz)
            check(at(*other) == mpw.BEDS[(d, not head)], "bed at %s is whole" % ((x, y, z),))
    # water never touches open air or plants sideways or below (so nothing leaks)
    wet = b == mpw.WATER
    leak = 0
    loose = np.isin(b, [v for v in P if v not in (mpw.WATER, mpw.LILY_PAD)] + [mpw.AIR])
    for sh in ((1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1), (0, -1, 0)):
        n = np.roll(loose, (-sh[0], -sh[1], -sh[2]), axis=(0, 1, 2))
        leak += int((wet & n).sum())
    edge_wet = wet[0].any() or wet[-1].any() or wet[:, :, 0].any() or wet[:, :, -1].any()
    check(leak == 0 and not edge_wet, "water stays put (%d open sides)" % leak)

    # ladders lean on a wall
    wall_of = {5: (-1, 0), 4: (1, 0), 3: (0, -1), 2: (0, 1)}
    for f, lid in mpw.LADDERS.items():
        for (i, j, k) in np.argwhere(b == lid):
            x, y, z = i + mpw.X0, j + mpw.MIN_Y, k + mpw.Z0
            check(at(x + wall_of[f][0], y, z + wall_of[f][1]) not in P, "ladder at %s has a wall behind it" % ((x, y, z),))
    tds = int(np.isin(b, list(mpw.TRAPDOORS.values())).sum())
    check(tds == 4, "four secret trapdoors (%d)" % tds)
    # caves and ores under the land
    g = w.ground
    ys = (np.arange(mpw.H) + mpw.MIN_Y)[None, :, None]
    cave = int(((b == mpw.AIR) & (ys < g[:, None, :] - 8)).sum())
    check(cave > 500000, "plenty of caves underground (%d blocks)" % cave)
    ores = int(np.isin(b, [a for pair in mpw.ORE_BLOCKS.values() for a in pair]).sum())
    check(ores > 50000, "plenty of ore (%d)" % ores)
    check(len(w.cave_entrances) >= 5, "cave entrances (%d)" % len(w.cave_entrances))
    for (mx, mz, t, dx, dz, L) in w.cave_entrances:
        fx, fz = mx + dx * (L - 1), mz + dz * (L - 1)
        check(at(fx, t - L + 2, fz) in P, "cave entrance at %s goes all the way down" % ((mx, mz),))

    # ---- the grand staircases
    check(sorted(w.stairs) == ["blaze", "ice", "knight", "princess", "sky", "spooky", "spooky mine"],
          "seven grand staircases (%s)" % sorted(w.stairs))
    for castle, (steps, floors) in w.stairs.items():
        for a, c in zip(steps, steps[1:]):
            check(c[1] == a[1] + 1 and abs(c[0] - a[0]) + abs(c[2] - a[2]) == 1, "%s steps climb one at a time %s %s" % (castle, a, c))
        for (x, y, z) in steps:
            check(at(x, y + 1, z) in P and at(x, y + 2, z) in P and at(x, y + 3, z) in P,
                  "%s headroom over step %s" % (castle, (x, y, z)))
        for fy in floors:
            check(len([s_ for s_ in steps if s_[1] == fy]) == 1, "%s: a step level with floor %d" % (castle, fy))

    # ---- roads: one connected path joining the spawn and all three gates, never more than a block's step
    road = {(int(i) + mpw.X0, int(k) + mpw.Z0) for i, k in np.argwhere(w.road_mask)}
    # quest 2's chasm cuts the road out of the Ice Palace: the player bridges it, so the road test does too
    ch = w.quest["chasm"]
    al, ac = np.array(ch["along"]), np.array([-ch["along"][1], ch["along"][0]])
    bridge = {(x, z) for (x, z) in ch["cols"] if abs((np.array([x + 0.5, z + 0.5]) - ch["at"]) @ ac) <= 2.5}
    road |= bridge
    for z in range(47, 112):
        for x in (-1, 0, 1):
            t = w.surface(x, z)
            if at(x, mpw.GROUND, z) == mpw.GRASS_PATH or at(x, t, z) in mpw.RAINBOW:   # the rainbow bridge
                road.add((x, z))
    def top(x, z):                      # the road surface (ignoring clouds, rainbows and the magic arch overhead)
        if (x, z) in bridge:
            return mpw.GROUND
        t = mpw.GROUND + 7
        while t is not None and at(x, t, z) in P:
            t -= 1
        return t
    seen, todo = {(0, 60)}, [(0, 60)]
    while todo:
        x, z = todo.pop()
        for nx, nz in ((x + 1, z), (x - 1, z), (x, z + 1), (x, z - 1)):
            if (nx, nz) in road and (nx, nz) not in seen and abs(top(nx, nz) - top(x, z)) <= 1:
                seen.add((nx, nz)); todo.append((nx, nz))
    check(sorted(mpw.ROADS) == ["blaze-knight", "ice-blaze", "knight-spooky", "princess-ice", "sky-home", "spooky-sky"],
          "one road from each castle to the next, and the road home")
    q = w.quest
    # quest 1's farm: a flat yard round the hen house, wheat on farmland by water, hens on grass round about
    fx, fy, fz = q["farm"]["coop"]
    check(fy == mpw.GROUND + 1 and all(at(fx + a, mpw.GROUND, fz + c) in (mpw.GRASS, mpw.GRASS_PATH, mpw.FARMLAND, mpw.WATER)
                                      for a in range(-13, 14) for c in range(-13, 14)), "the farm yard is flat")
    check(all(at(fx + a, fy + h, fz + c) == mpw.OAK_LOG for a in (-1, 1) for c in (-1, 1) for h in (0, 1))
          and at(fx, fy, fz) == mpw.AIR and at(fx, fy + 2, fz) == mpw.OAK_PLANKS, "the hen house: posts, a roof, room for hens")
    check(all(at(fx + a, fy, fz + c) in P for a in range(-5, 6) for c in range(-5, 6) if max(abs(a), abs(c)) > 1),
          "room round the hen house to build a pen")
    wheat = np.argwhere(b == mpw.WHEAT)
    check(len(wheat) >= 30 and all(b[i, j - 1, k] == mpw.FARMLAND for i, j, k in wheat), "a wheat field, on farmland")
    farm_items = [it["Name"] for it in be[w.chests["farm chest"]][0]["Items"]]
    check("minecraft:iron_axe" in farm_items and "minecraft:wheat_seeds" in farm_items and
          not any("fence" in n or "planks" in n for n in farm_items), "the farm chest has axes and seeds, but no fences (you make them)")
    trunks = [(fx + a, fz + c) for a, c in mpw.FARM_TREES]
    logs = sum(1 for x, z in trunks for yy in range(fy, fy + 8) if at(x, yy, z) == mpw.OAK_LOG)
    check(logs >= 22, "oak trees to chop in the farm yard (%d logs: enough for a pen)" % logs)
    check(np.count_nonzero(b == mpw.FARM_LEAVES) > 50 and mpw.PALETTE[mpw.FARM_LEAVES][1]["persistent_bit"] is False,
          "their leaves fall away when they're chopped")
    hens = q["farm"]["hens"]
    check(len(hens) >= 12 and all(at(x, y - 1, z) == mpw.GRASS and at(x, y, z) in P and at(x, y + 1, z) in P for x, y, z in hens),
          "hens start on grass round the meadows")
    check(all(max(abs(x), abs(z)) > mpw.WALL + 12 and z < mpw.river_z(x) for x, _, z in hens), "hens are outside the castle, this side of the river")
    px, py, pz = q["princess"]
    check(at(px, py - 1, pz) == mpw.GOLD and at(px, py + 1, pz) == mpw.AIR and at(px, py + 2, pz) == mpw.AIR,
          "the princess's seat on the big throne")
    # inns: one on each road, outside the magic fences, with a keeper behind the desk
    check(sorted(i["road"] for i in w.inns) == sorted(mpw.ROADS), "an inn on each road")
    for inn in w.inns:
        x, y, z = inn["clerk"]
        check(at(x, y, z) == mpw.AIR and at(x, y + 1, z) == mpw.AIR and at(x, y - 1, z) not in P, "%s keeper has room" % inn["name"])
        check(all(math.hypot(x - a, z - b) > r + 15 for _, (a, b), r, _ in mpw.MAGIC_RINGS), "%s is outside the magic fences" % inn["name"])
    kd_inns = [i["name"] for i in w.inns]
    check(len(set(kd_inns)) == 6, "six different inns")
    # magic fences: all the way round, a horse can't jump them, one gate on the road in
    check([r["name"] for r in q["rings"]] == ["ice", "blaze", "knight", "spooky", "sky"] and
          [r["opens"] for r in q["rings"]] == [1, 2, 3, 4, 5], "a magic fence round each castle after the first, in story order")
    for ring in q["rings"]:
        (cx, cz), r = ring["center"], ring["r"]
        check(len(ring["gate"]) > 30 and all(at(*c) == mpw.MAGIC_BARRIER for c in ring["gate"]), "%s gate is magic" % ring["name"])
        gate_cols = {(c[0], c[2]) for c in ring["gate"]}
        check(any(w.road_mask[x - mpw.X0, z - mpw.Z0] for x, z in gate_cols), "%s gate is on the road" % ring["name"])
        holes = []
        for k in range(720):
            a = math.radians(k / 2)
            x, z = int(round(cx + r * math.cos(a))), int(round(cz + r * math.sin(a)))
            if (x, z) in gate_cols or not (mpw.X0 <= x < mpw.X1 and mpw.Z0 <= z < mpw.Z1):
                continue
            if mpw.AMETHYST in w.b[x - mpw.X0, :, z - mpw.Z0]:      # a gate post
                continue
            t = mpw.ground_top(w, x, z)
            col = [at(x, y, z) for y in range(t + 1, t + 1 + mpw.RING_HEIGHT)]
            if not all(v not in mpw.PASSABLE for v in col):
                holes.append((x, z))
        check(not holes, "%s magic fence has no gaps (%s)" % (ring["name"], holes[:5]))
        # nothing else passes through the fence: the road crosses it once, at the gate
        band = np.argwhere(w.road_mask) + [mpw.X0, mpw.Z0]
        d = np.hypot(band[:, 0] - cx, band[:, 1] - cz)
        cross = {(int(x), int(z)) for (x, z), dd in zip(band, d) if abs(dd - r) <= 1.0}
        check(cross and cross <= gate_cols, "%s: the road only crosses the fence at the gate" % ring["name"])
    check(len(q["to princess"]) > 20, "sparkles from the spawn to the princess")
    # quest 2: Princess Snowdrop's seat, the chasm, its ladder, trees for wood, and the egg
    ix, iy, iz = q["ice princess"]
    check(at(ix, iy - 1, iz) == mpw.BLUE_ICE and at(ix, iy + 1, iz) == mpw.AIR and at(ix, iy + 2, iz) == mpw.AIR, "Princess Snowdrop's seat on the ice throne")
    wt = mpw.GROUND - 10
    cols = ch["cols"]
    lx, _, lz = w.places["chasm ladder"]
    check(len(cols) > 1000 and all(at(x, wt, z) == mpw.WATER and at(x, mpw.GROUND, z) == mpw.AIR and at(x, wt + 1, z) == mpw.AIR
                                   for x, z in cols if (x, z) != (lx, lz)),
          "a deep chasm with a river at the bottom, cutting the road")
    width = [c for c in cols if abs((np.array([c[0] + 0.5, c[1] + 0.5]) - ch["at"]) @ ac) < 0.5]
    check(8 <= len(width) <= 11, "the chasm is %d blocks across at the road (too far to jump)" % len(width))
    lx, _, lz = w.places["chasm ladder"]
    check(all(at(lx, y, lz) in mpw.LADDERS.values() for y in range(wt - 1, mpw.GROUND + 1)), "a ladder up the near wall, out of the river")
    check(sum(1 for x, z in cols for y in range(wt - 1, mpw.GROUND + 1) if at(x, y, z) in mpw.LADDERS.values()) == mpw.GROUND - wt + 2,
          "only one ladder (no way up the far side)")
    nx_, _, nz_ = ch["near"]
    spruce = {(x, z) for x in range(nx_ - 30, nx_ + 30) for z in range(nz_ - 30, nz_ + 30) if at(x, mpw.GROUND + 1, z) == mpw.SPRUCE_LOG}
    check(len(spruce) >= 3, "spruce trees by the chasm, for wood (%d)" % len(spruce))
    egg_items = [it["Name"] for it in be[w.chests["chasm snow golem egg"]][0]["Items"]]
    check(egg_items == ["kq:snow_golem_egg"], "the Snow Golem Egg in the chest on the far side")
    # quests 3 to 6: the seats, the dark mine, the quarry, the lamp posts, Graham's cloud
    for name, ((x, y, z), _, _) in q["seats"].items():
        check(at(x, y + 1, z) == mpw.AIR and at(x, y - 1, z) not in P, "%s's seat on the throne" % name)
    mine = q["mine"]
    cells = w.mine_cells
    lights = sum(1 for c in cells if at(*c) in mpw.GLOW or at(*c) in (mpw.LANTERN, mpw.SOUL_LANTERN))
    check(len(cells) > 400 and lights == 0, "the mine is dark inside (%d lights)" % lights)
    coal = sum(1 for (x, y, z) in cells for a, c in ((1, 0), (-1, 0), (0, 1), (0, -1)) if at(x + a, y, z + c) == mpw.COAL_ORE)
    check(coal >= 10, "coal shows in the mine walls (%d)" % coal)
    leaks = [c for (x, y, z) in cells for c in ((x + 1, y, z), (x - 1, y, z), (x, y, z + 1), (x, y, z - 1), (x, y - 1, z))
             if c not in cells and c[1] <= mpw.GROUND and at(*c) in P]
    check(not leaks, "the mine's walls are solid (no way off into the caves) %s" % leaks[:3])
    check(mine["bottom"][1] <= mpw.GROUND - 18, "the mine goes deep")
    check([it["Name"] for it in be[w.chests["blaze graham's collar"]][0]["Items"]] == ["kq:collar"], "Graham's collar in the chest at the bottom")
    qx, _, qz = q["quarry"]["at"]
    ore = {k: sum(1 for x in range(qx - 9, qx + 10) for z in range(qz - 9, qz + 10) for y in range(mpw.GROUND - 9, mpw.GROUND + 1)
                  if at(x, y, z) == v and any(at(x + a, y + e, z + c) == mpw.AIR for a, e, c in ((1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1), (0, 1, 0))))
           for k, v in (("iron", mpw.IRON_ORE), ("coal", mpw.COAL_ORE))}
    check(ore["iron"] >= 12 and ore["coal"] >= 4, "iron and coal showing in the quarry %s" % ore)
    posts = q["lamps"]["posts"]
    check(len(posts) == 6 and all(at(x, y, z) == mpw.AIR and at(x, y - 1, z) == mpw.DARK_OAK_FENCE for x, y, z in posts),
          "six dark lamp posts, waiting for jack o'lanterns")
    pv = mpw.View(w, mpw.SPOOKY[0], mpw.SPOOKY[1], "")
    pumpkins = sum(1 for x in range(-12, -4) for z in range(33, 53) if pv.get(x, mpw.GROUND + 1, z) in mpw.PUMPKIN.values())
    check(pumpkins >= 12, "pumpkins to carve in the patch (%d)" % pumpkins)
    check(sorted(it["Name"] for it in be[w.chests["spooky wisp's chest"]][0]["Items"]).count("minecraft:iron_ingot") == 1,
          "Lady Wisp's chest has iron for shears")
    gx, gy, gz = q["cloud"]["graham"]
    check(at(gx, gy - 1, gz) == mpw.WHITE_WOOL and at(gx, gy, gz) == mpw.AIR, "Graham's little cloud")
    gy0 = q["cloud"]["cloud_y"]
    under = [y for y in range(gy0 - 1, gy0 - 20, -1) if at(gx - 4, y, gz) not in P]
    check(under and gy0 - under[0] >= 7, "the cloud is too high to jump up to (%d blocks)" % (gy0 - under[0] if under else -1))
    gh = q["graham home"]
    check(at(*gh) == mpw.AIR and at(gh[0], gh[1] - 1, gh[2]) not in P, "a spot for Graham by Princess Buttercup's throne")
    wings = [it["Name"] for d, _ in be.values() for it in d.get("Items", []) if it["Name"] in ("minecraft:elytra", "minecraft:firework_rocket")]
    check(not wings, "no wings (elytras) or rockets in any chest (%s)" % wings)
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        check("behavior_packs/KingdomQuest_BP/manifest.json" in names and "resource_packs/KingdomQuest_RP/manifest.json" in names
              and "behavior_packs/KingdomQuest_BP/scripts/main.js" in names, "Kingdom Quest packs inside the world")
        bp = json.loads(z.read("behavior_packs/KingdomQuest_BP/manifest.json"))["header"]
        rp = json.loads(z.read("resource_packs/KingdomQuest_RP/manifest.json"))["header"]
        wb = json.loads(z.read("world_behavior_packs.json"))
        wr = json.loads(z.read("world_resource_packs.json"))
        check(wb == [{"pack_id": bp["uuid"], "version": bp["version"]}] and wr == [{"pack_id": rp["uuid"], "version": rp["version"]}],
              "the world turns the packs on")
        kd = z.read("behavior_packs/KingdomQuest_BP/scripts/kingdom_data.js").decode()
        kdj = json.loads(kd[kd.index("{"):kd.rindex("}") + 1])
        check(kdj["princess"] == [px, py + mpw.Y_OFF, pz] and kdj["farm"]["coop"] == [fx, fy + mpw.Y_OFF, fz], "story data in game coordinates")
    gx, gz = mpw.knight_to_world(0, 54)
    check(gx < mpw.KNIGHT[0] and gz == mpw.KNIGHT[1], "knight fortress gate faces west, toward the road in")
    bgx, bgz = mpw.blaze_to_world(0, 54)
    check(bgx < mpw.BLAZE[0] and bgz == mpw.BLAZE[1], "Blaze Castle's gate faces west, toward the road in")
    a2 = np.array(mpw.ROADS["ice-blaze"][-2:], float)
    b2 = np.array(mpw.ROADS["blaze-knight"][:2], float)
    check(abs(np.dot(a2[1] - a2[0], b2[1] - b2[0])) < 1e-6 and tuple(b2[0]) == tuple(a2[0]),
          "the road on to the knights turns off at a right angle before Blaze Castle")
    a = np.array(mpw.ROADS["blaze-knight"][-3:], float)
    b_ = np.array(mpw.ROADS["knight-spooky"][:2], float)
    pk = w.parkour
    for p0, p1 in zip(pk, pk[1:]):
        check(max(abs(p1[0] - p0[0]), abs(p1[2] - p0[2])) <= 2 and 0 <= p1[1] - p0[1] <= 1,
              "parkour jump %s -> %s is a short hop" % (p0, p1))
    for (x, y, z) in pk:
        check(at(x, y + 1, z) in P and at(x, y + 2, z) in P, "headroom on parkour pad %s" % ((x, y, z),))
    px_, py_, pz_ = w.chests["blaze parkour prize"]
    check(max(abs(px_ - pk[-1][0]), abs(pz_ - pk[-1][2])) <= 2 and py_ == pk[-1][1] + 1, "the prize waits on the last pad")
    d1, d2 = a[-1] - a[-2], b_[1] - b_[0]
    check(abs(np.dot(d1, d2)) < 1e-6 and tuple(b_[0]) == tuple(a[-2]), "the mountain road turns off at a right angle")
    for name, p in (("ice gate", (mpw.ICE[0], mpw.ICE[1] + 54)), ("knight gate", mpw.knight_to_world(0, 54)),
                    ("spawn", (0, 110)), ("princess gate", (0, 48)), ("spooky gate", (mpw.SPOOKY[0], mpw.SPOOKY[1] + 54)),
                    ("sky castle meadow", (mpw.SKY[0], mpw.SKY[1] + 54)),
                    ("blaze gate", mpw.blaze_to_world(0, 54))):
        check(any(abs(p[0] - a) <= 1 and abs(p[1] - c) <= 1 for a, c in seen), "road reaches the %s" % name)
    island_top = mpw.GROUND + mpw.SKY_OY
    check(at(mpw.SKY[0], island_top, mpw.SKY[1] + 20) != mpw.AIR and at(mpw.SKY[0], mpw.GROUND + 20, mpw.SKY[1] + 20) == mpw.AIR,
          "the sky castle's island floats %d blocks up" % mpw.SKY_OY)
    lad = [y for y in range(mpw.GROUND, island_top + 1) if at(mpw.SKY[0], y, mpw.SKY[1] + 36) == mpw.LADDERS[3]]
    check(len(lad) == mpw.SKY_OY and lad[0] == mpw.GROUND + 1, "a ladder all the way up the beanstalk (%d rungs)" % len(lad))
    check(w.surface(mpw.SPOOKY[0] + int(mpw.MC[0]) - 20, mpw.SPOOKY[1] + int(mpw.MC[1])) > mpw.GROUND + 50,
          "the haunted mountain is a real mountain")
    check(not any(n == "minecraft:ice" for n, _ in mpw.PALETTE), "no plain ice (it melts into running water)")
    dxw, dzw = mpw.knight_to_world(*mpw.DRAGON)
    check(max(abs(dxw - mpw.KNIGHT[0]), abs(dzw - mpw.KNIGHT[1])) - 9 > 46, "dragon stands outside the fortress and its moat")
    check(at(dxw, mpw.GROUND + 9, dzw) not in P, "dragon statue is there")
    twx, twz = mpw.knight_to_world(-mpw.DRAGON[0], mpw.DRAGON[1])
    check(at(twx, mpw.GROUND + 9, twz) not in P, "its twin is on the other side of the road")
    rx, rz = mpw.knight_to_world(0, mpw.DRAGON[1])
    check(w.road_mask[rx - mpw.X0, rz - mpw.Z0] and not w.road_mask[dxw - mpw.X0, dzw - mpw.Z0]
          and not w.road_mask[twx - mpw.X0, twz - mpw.Z0], "the road runs between the two dragons")
    castles = [mpw.PRINCESS, mpw.ICE, mpw.KNIGHT, mpw.SPOOKY]
    apart = min(np.hypot(a[0] - c[0], a[1] - c[1]) for i, a in enumerate(castles) for c in castles[i + 1:])
    check(apart > 350, "castles a long ride apart (closest pair %d blocks as the crow flies)" % apart)

    # ---- walk everywhere: each castle from where its road arrives, and the princess land from the spawn
    crops = {"": ((-130, 130, -110, 130), (sx, sy, sz)),
             "ice ": ((mpw.ICE[0] - 70, mpw.ICE[0] + 95, mpw.ICE[1] - 70, mpw.ICE[1] + 70), (mpw.ICE[0], mpw.GROUND + 1, mpw.ICE[1] + 56)),
             "knight ": ((mpw.KNIGHT[0] - 100, mpw.KNIGHT[0] + 100, mpw.KNIGHT[1] - 100, mpw.KNIGHT[1] + 100),
                         (mpw.knight_to_world(0, 56)[0], mpw.GROUND + 1, mpw.knight_to_world(0, 56)[1])),
             "blaze ": ((mpw.BLAZE[0] - 100, mpw.BLAZE[0] + 100, mpw.BLAZE[1] - 100, mpw.BLAZE[1] + 100),
                        (mpw.blaze_to_world(0, 56)[0], mpw.GROUND + 1, mpw.blaze_to_world(0, 56)[1])),
             "sky ": ((mpw.SKY[0] - 75, mpw.SKY[0] + 75, mpw.SKY[1] - 75, mpw.SKY[1] + 70),
                      (mpw.SKY[0], mpw.GROUND + 1, mpw.SKY[1] + 56)),
             "spooky ": ((mpw.SPOOKY[0] - 80, mpw.SPOOKY[0] + 80, mpw.SPOOKY[1] - 90, mpw.SPOOKY[1] + 70),
                         (mpw.SPOOKY[0], mpw.GROUND + 1, mpw.SPOOKY[1] + 56))}
    # the chasm: walking from the near bank you can't reach the far side, until there's a bridge
    crops["chasm "] = ((nx_ - 45, nx_ + 45, nz_ - 45, nz_ + 45), (nx_, mpw.GROUND + 1, nz_))
    road_cells = np.argwhere(w.road_mask) + [mpw.X0, mpw.Z0]
    for inn in w.inns:
        dx, dz = inn["door"]
        rc = road_cells[np.argmin(np.hypot(road_cells[:, 0] - dx, road_cells[:, 1] - dz))]
        crops[inn["name"] + " "] = ((dx - 40, dx + 40, dz - 40, dz + 40), (int(rc[0]), mpw.GROUND + 1, int(rc[1])))
    def owner(name):
        best = ""
        for p_ in crops:
            if p_ and name.startswith(p_) and len(p_) > len(best):
                best = p_
        return best
    for prefix, ((x0, x1, z0, z1), (stx, sty, stz)) in crops.items():
        x0, x1, z0, z1 = max(x0, mpw.X0), min(x1, mpw.X1), max(z0, mpw.Z0), min(z1, mpw.Z1)
        sub = b[x0 - mpw.X0:x1 - mpw.X0, :, z0 - mpw.Z0:z1 - mpw.Z0]
        check(sub[stx - x0, sty - mpw.MIN_Y, stz - z0] in P, "%sstart point is open" % prefix)
        if prefix == "sky ":
            Rs = walk_reach(sub, (stx - x0, sty - mpw.MIN_Y, stz - z0), P, mpw.WATER,
                            list(mpw.LADDERS.values()) + list(mpw.TRAPDOORS.values()))
            gx, gy, gz = w.quest["cloud"]["graham"]
            check(not Rs[gx - x0 - 2:gx - x0 + 3, gy - mpw.MIN_Y, gz - z0 - 2:gz - z0 + 3].any(),
                  "you can't walk up to Graham's cloud without building stairs")
        if prefix == "chasm ":
            fx_, fy_, fz_ = ch["far"]
            R0 = walk_reach(sub, (stx - x0, sty - mpw.MIN_Y, stz - z0), P, mpw.WATER,
                            list(mpw.LADDERS.values()) + list(mpw.TRAPDOORS.values()))
            check(not R0[fx_ - x0 - 1:fx_ - x0 + 2, fy_ - mpw.MIN_Y - 1:fy_ - mpw.MIN_Y + 2, fz_ - z0 - 1:fz_ - z0 + 2].any(),
                  "without a bridge you can't get across the chasm (not even by swimming)")
            sub = sub.copy()
            for (x, z) in bridge:
                if x0 <= x < x1 and z0 <= z < z1:
                    sub[x - x0, mpw.GROUND - mpw.MIN_Y, z - z0] = mpw.OAK_PLANKS
        Rm = walk_reach(sub, (stx - x0, sty - mpw.MIN_Y, stz - z0), P, mpw.WATER,
                        list(mpw.LADDERS.values()) + list(mpw.TRAPDOORS.values()))
        def reached(x, y, z, r=2, dy=1):
            i, j, k = x - x0, y - mpw.MIN_Y, z - z0
            return bool(Rm[max(0, i - r):i + r + 1, max(0, j - dy):j + dy + 1, max(0, k - r):k + r + 1].any())
        for name, (x, y, z) in sorted(w.places.items()):
            if owner(name) == prefix:
                check(reached(x, y, z), "can walk to the %s %s" % (name, (x, y, z)))
        for name, (x, y, z) in sorted(w.chests.items()):
            if owner(name) == prefix and "parkour" not in name:      # the parkour prize is checked jump by jump above
                check(reached(x, y, z), "can walk to the %s chest" % name)
        for sname, (steps, _) in w.stairs.items():
            if (sname.split()[0] + " " if sname != "princess" else "") == prefix:
                for st in (steps[0], steps[-1]):
                    check(reached(st[0], st[1] + 1, st[2], r=0, dy=0), "%s staircase: can reach the step at %s" % (sname, st))

    # ---- block states valid for the target game version
    if len(sys.argv) > 1:
        data = json.load(open(sys.argv[1]))
        props = {p["name"]: [v["value"] for v in p["values"]] for p in data["block_properties"]}
        blocks = {d["name"]: [p["name"] for p in d.get("properties", [])] for d in data["data_items"]}
        for name, states in mpw.PALETTE:
            if name.startswith("kq:"):                     # Kingdom Quest's own block, from its pack
                check(not states and os.path.exists(os.path.join(HERE, "..", "addons", "KingdomQuest_BP", "blocks",
                                                                 name[3:] + ".json")), "%s defined in the pack" % name)
                continue
            check(name in blocks, "%s exists" % name)
            if name in blocks:
                check(sorted(blocks[name]) == sorted(states), "%s has exactly states %s (got %s)" % (name, blocks[name], list(states)))
                for k, v in states.items():
                    check(v in props.get(k, []), "%s %s=%r allowed" % (name, k, v))
        print("Checked %d block states against %s" % (len(mpw.PALETTE), sys.argv[1]))

    print("OK" if not fails else "%d FAILURES" % len(fails))
    sys.exit(1 if fails else 0)

def name_of_states(name, key):
    for n, s in mpw.PALETTE:
        if n == name and key in s:
            return s[key]
    return None

if __name__ == "__main__":
    main()
