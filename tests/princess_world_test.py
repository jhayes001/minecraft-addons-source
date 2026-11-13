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
import json, os, struct, sys, tempfile, zipfile
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

def main():
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
            blocks = np.array(ids, np.int32)[idx].reshape(16, 16, 16).astype(np.uint8)
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
    check(biomes == {mpw.PLAINS_BIOME, mpw.SNOW_BIOME, mpw.FOREST_BIOME, mpw.SWAMP_BIOME}, "plains, snowy, forest and swamp chunks (%s)" % biomes)

    b = w.b
    at = w.get
    P = set(mpw.PASSABLE)
    # ---- spawn and chests
    check(at(sx, sy, sz) == mpw.AIR and at(sx, sy + 1, sz) == mpw.AIR, "spawn has headroom")
    check(at(sx, sy - 1, sz) not in P, "spawn has ground")
    check(len(w.chests) >= 20, "plenty of treasure chests (%d)" % len(w.chests))
    for name, (x, y, z) in w.chests.items():
        check(at(x, y, z) in mpw.CHESTS.values(), "%s chest block" % name)
        e = be.get((x, y, z))
        check(e is not None and e[0]["id"] == "Chest" and e[1] == (x >> 4, z >> 4), "%s chest entity in its chunk" % name)
        if e:
            check(len(e[0]["Items"]) >= 4, "%s chest has items" % name)
    for c in ("", "ice ", "knight ", "spooky "):
        check(any(n.startswith(c + "stable") for n in w.chests) and
              any(it["Name"] == "minecraft:horse_spawn_egg" for it in be[w.chests[c + "stable"]][0]["Items"]),
              "%sstable has horse eggs" % c)
    spawn_items = [it["Name"] for it in be[w.chests["spawn"]][0]["Items"]]
    check("minecraft:golden_helmet" in spawn_items and "minecraft:leather_chestplate" in spawn_items, "princess outfit at spawn")
    beds = sorted(be[k][0]["color"] for k, (d, _) in be.items() if d["id"] == "Bed")
    check(beds == [3] * 4 + [6] * 4 + [10] * 4 + [14] * 8, "2 pink, 2 light blue, 2 purple and 4 red beds (%s)" % beds)

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
    n = bad_count([mpw.DEADBUSH], [mpw.PODZOL, mpw.COARSE_DIRT, mpw.DIRT])
    check(n == 0, "dead bushes on podzol or dirt (%d not)" % n)
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
    check(tds == 3, "three secret trapdoors (%d)" % tds)
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
    check(sorted(w.stairs) == ["ice", "knight", "princess", "spooky", "spooky mine"], "five grand staircases (%s)" % sorted(w.stairs))
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
    for z in range(47, 112):
        for x in (-1, 0, 1):
            t = w.surface(x, z)
            if at(x, mpw.GROUND, z) == mpw.GRASS_PATH or at(x, t, z) in mpw.RAINBOW:   # the rainbow bridge
                road.add((x, z))
    def top(x, z):                      # the road surface (ignoring clouds and rainbows overhead)
        t = mpw.GROUND + 12
        while t is not None and at(x, t, z) in P:
            t -= 1
        return t
    seen, todo = {(0, 60)}, [(0, 60)]
    while todo:
        x, z = todo.pop()
        for nx, nz in ((x + 1, z), (x - 1, z), (x, z + 1), (x, z - 1)):
            if (nx, nz) in road and (nx, nz) not in seen and abs(top(nx, nz) - top(x, z)) <= 1:
                seen.add((nx, nz)); todo.append((nx, nz))
    check(sorted(mpw.ROADS) == ["ice-knight", "knight-spooky", "princess-ice"], "one road from each castle to the next")
    gx, gz = mpw.knight_to_world(0, 54)
    check(gx < mpw.KNIGHT[0] and gz == mpw.KNIGHT[1], "knight fortress gate faces west, toward the road in")
    a = np.array(mpw.ROADS["ice-knight"][-3:], float)
    b_ = np.array(mpw.ROADS["knight-spooky"][:2], float)
    d1, d2 = a[-1] - a[-2], b_[1] - b_[0]
    check(abs(np.dot(d1, d2)) < 1e-6 and tuple(b_[0]) == tuple(a[-2]), "the mountain road turns off at a right angle")
    for name, p in (("ice gate", (mpw.ICE[0], mpw.ICE[1] + 54)), ("knight gate", mpw.knight_to_world(0, 54)),
                    ("spawn", (0, 110)), ("princess gate", (0, 48)), ("spooky gate", (mpw.SPOOKY[0], mpw.SPOOKY[1] + 54))):
        check(any(abs(p[0] - a) <= 1 and abs(p[1] - c) <= 1 for a, c in seen), "road reaches the %s" % name)
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
             "spooky ": ((mpw.SPOOKY[0] - 80, mpw.SPOOKY[0] + 80, mpw.SPOOKY[1] - 90, mpw.SPOOKY[1] + 70),
                         (mpw.SPOOKY[0], mpw.GROUND + 1, mpw.SPOOKY[1] + 56))}
    def owner(name):
        for p_ in ("ice ", "knight ", "spooky "):
            if name.startswith(p_):
                return p_
        return ""
    for prefix, ((x0, x1, z0, z1), (stx, sty, stz)) in crops.items():
        sub = b[x0 - mpw.X0:x1 - mpw.X0, :, z0 - mpw.Z0:z1 - mpw.Z0]
        check(sub[stx - x0, sty - mpw.MIN_Y, stz - z0] in P, "%sstart point is open" % prefix)
        Rm = walk_reach(sub, (stx - x0, sty - mpw.MIN_Y, stz - z0), P, mpw.WATER,
                        list(mpw.LADDERS.values()) + list(mpw.TRAPDOORS.values()))
        def reached(x, y, z, r=2, dy=1):
            i, j, k = x - x0, y - mpw.MIN_Y, z - z0
            return bool(Rm[max(0, i - r):i + r + 1, max(0, j - dy):j + dy + 1, max(0, k - r):k + r + 1].any())
        for name, (x, y, z) in sorted(w.places.items()):
            if owner(name) == prefix:
                check(reached(x, y, z), "can walk to the %s %s" % (name, (x, y, z)))
        for name, (x, y, z) in sorted(w.chests.items()):
            if owner(name) == prefix:
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
