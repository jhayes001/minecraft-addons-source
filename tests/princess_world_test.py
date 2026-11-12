"""Checks the Princess Kingdom world: builds it, reopens the .mcworld and reads it back.

  - every chunk's sub-chunks decode back to exactly the blocks that were generated
  - level.dat parses, with the kid-friendly rules (Peaceful, no fall damage, keep inventory)
  - the spawn is a safe spot, and every chest's block entity is stored in its own chunk
  - plants, lanterns, carpets, cakes, candles and beds all sit on (or hang from) something;
    two-block flowers and beds are whole; water doesn't touch open air (no leaks)
  - the grand staircase climbs one block per step with headroom all the way, and each
    floor's step is level with that floor
  - you can WALK from the spawn to every room, the towers, the wall walk, the balcony, the
    top of the rainbow and every treasure chest (no flying, no breaking blocks)
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

def walk_reach(b, start, passable_ids, water_id):
    """Cells (feet positions) a player can reach on foot from `start`: walk, step up one
    block, fall any distance, swim. Returns a bool array [x, y, z]."""
    P = np.isin(b, list(passable_ids))
    Hh = b.shape[1]
    body = np.zeros_like(P)
    body[:, :-1, :] = P[:, :-1, :] & P[:, 1:, :]
    head2 = np.zeros_like(P)                       # room to jump: 3 free cells
    head2[:, :-2, :] = body[:, :-2, :] & P[:, 2:, :]
    wet = b == water_id
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
        swim[:, 1:, :] = (R & wet)[:, :-1, :]                      # swim up
        new |= swim & body
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
    path, n_chunks = mpw.write_world(w, out, prev)
    check(n_chunks == (mpw.SIZE // 16) ** 2, "chunk count")

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
    sx, sy, sz = lvl["SpawnX"], lvl["SpawnY"], lvl["SpawnZ"]

    db = plyvel.DB(os.path.join(tmp, "db"))
    name_of = {i: (n, s) for i, (n, s) in enumerate(mpw.PALETTE)}
    lookup = {}
    for i, (n, s) in name_of.items():
        lookup[(n, tuple(sorted(s.items())))] = i
    decoded = np.zeros_like(w.b)
    be = {}
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
            i0, k0, j0 = cx * 16 + mpw.HALF, cz * 16 + mpw.HALF, yi * 16 - mpw.MIN_Y
            decoded[i0:i0 + 16, j0:j0 + 16, k0:k0 + 16] = blocks.transpose(0, 2, 1)
        elif tag == 0x31:
            p = 0
            while p < len(val):
                d, p = read_nbt(val, p)
                be[(d["x"], d["y"], d["z"])] = (d, (cx, cz))
        elif tag == 0x36:
            check(struct.unpack("<i", val)[0] == 2, "finalized")
    db.close()
    check(np.array_equal(decoded, w.b), "blocks read back identical")

    b = w.b
    at = w.get
    P = set(mpw.PASSABLE)
    # ---- spawn and chests
    check(at(sx, sy, sz) == mpw.AIR and at(sx, sy + 1, sz) == mpw.AIR, "spawn has headroom")
    check(at(sx, sy - 1, sz) not in P, "spawn has ground")
    check(len(w.chests) == 8, "8 treasure chests (%d)" % len(w.chests))
    for name, (x, y, z) in w.chests.items():
        check(at(x, y, z) in mpw.CHESTS.values(), "%s chest block" % name)
        e = be.get((x, y, z))
        check(e is not None and e[0]["id"] == "Chest" and e[1] == (x >> 4, z >> 4), "%s chest entity in its chunk" % name)
        if e:
            check(len(e[0]["Items"]) >= 4, "%s chest has items" % name)
    spawn_items = [it["Name"] for it in be[w.chests["spawn"]][0]["Items"]]
    check("minecraft:golden_helmet" in spawn_items and "minecraft:leather_chestplate" in spawn_items, "princess outfit at spawn")
    beds = [k for k, (d, _) in be.items() if d["id"] == "Bed"]
    check(len(beds) == 4 and all(be[k][0]["color"] == 6 for k in beds), "two pink beds (4 halves)")

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
    check(bad_count(mpw.FLOWERS + mpw.PETALS + [mpw.SHORT_GRASS] + lows, soil) == 0, "plants grow on grass")
    for lo, hi in mpw.DOUBLE_FLOWERS:
        check(int(((b == hi) & (below != lo)).sum()) == 0 and int(((b == lo) & (above != hi)).sum()) == 0, "tall flowers whole")
    not_solid = list(P | {mpw.AIR})
    stand = [mpw.LANTERN, mpw.PINK_CANDLE, mpw.CAKE, mpw.PINK_CARPET, mpw.MAGENTA_CARPET, mpw.LBLUE_CARPET,
             mpw.AMETHYST_CLUSTER, mpw.END_ROD_UP] + list(mpw.BEDS.values()) + list(mpw.CHESTS.values())
    m = np.isin(b, stand) & np.isin(below, not_solid)
    check(int(m.sum()) == 0, "lanterns, candles, cakes, carpets, beds, chests sit on something (%d loose)" % m.sum())
    m = (b == mpw.HANGING_LANTERN) & np.isin(above, not_solid)
    check(int(m.sum()) == 0, "hanging lanterns hang from something (%d loose)" % m.sum())
    check(bad_count([mpw.LILY_PAD], [mpw.WATER]) == 0, "lily pads on water")
    # beds: foot and head pieces paired
    for (d, head), bid in mpw.BEDS.items():
        dx, dz = [(0, 1), (-1, 0), (0, -1), (1, 0)][d]
        for (i, j, k) in np.argwhere(b == bid):
            x, y, z = i - mpw.HALF, j + mpw.MIN_Y, k - mpw.HALF
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

    # ---- the grand staircase
    steps = w.steps
    for a, c in zip(steps, steps[1:]):
        check(c[1] == a[1] + 1 and abs(c[0] - a[0]) + abs(c[2] - a[2]) == 1, "steps climb one at a time %s %s" % (a, c))
    for (x, y, z) in steps:
        check(at(x, y + 1, z) in P and at(x, y + 2, z) in P and at(x, y + 3, z) in P, "headroom over step %s" % ((x, y, z),))
    for fy in w.stair_floors:
        s_ = [s for s in steps if s[1] == fy]
        check(len(s_) == 1, "a step level with floor %d" % fy)

    # ---- walk everywhere
    start = (sx + mpw.HALF, sy - mpw.MIN_Y, sz + mpw.HALF)
    R = walk_reach(b, start, P, mpw.WATER)
    def reached(x, y, z, r=1, dy=0):
        i, j, k = x + mpw.HALF, y - mpw.MIN_Y, z + mpw.HALF
        return bool(R[max(0, i - r):i + r + 1, max(0, j - dy):j + dy + 1, max(0, k - r):k + r + 1].any())
    for name, (x, y, z) in sorted(w.places.items()):
        check(reached(x, y, z, r=2, dy=1), "can walk to the %s %s" % (name, (x, y, z)))
    for name, (x, y, z) in sorted(w.chests.items()):
        check(reached(x, y, z, r=2, dy=1), "can walk to the %s chest" % name)
    check(reached(*w.steps[-1][:1], w.steps[-1][1] + 1, w.steps[-1][2], r=0), "can climb the whole staircase")

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
