"""Checks Dragon Land (Chapter 2's region, tools/make_dragon_land.py) and adding it to a world being played.

  - the edges meet the flat world round it (same ground layers, grass at the same height)
  - from the end of the princess road you can WALK to the dragon in its crater, the wheat field and the shed's
    chest, down the mine stairs to Pebble, the station chest and the start of the line, and along the tunnel to
    the Crystal Caverns stop (no flying, no breaking blocks)
  - the railway: every rail sits on something solid, each piece joins the next (slopes in the lower block, rising
    toward the piece before), powered rails sit on redstone, the 12 gap spots are empty with floor under them,
    and a button stands by each end
  - the station has iron ore showing in its walls; water stays in the field; chests and lanterns sit on something
  - dragon_data.js matches the region
  - adding it to a played world (tools/update_world.py): a fake played world with flat chunks the game made
    (one with a house built on it, a hole dug where the station goes, a chest, a player record), its tables
    compressed with raw zlib like Minecraft's: chunks never visited come in whole, visited ones keep every block
    the player changed, the player's chest and records stay, and running it again changes nothing

  - optional: every block state is valid for the game version (pass mojang-blocks.json, as for princess_world_test)

Usage: python3 tests/dragon_land_test.py [path/to/mojang-blocks.json]
"""
import json, os, shutil, struct, sys, tempfile, zlib
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "tools"))
sys.path.insert(0, HERE)
import make_princess_world as pw
import make_dragon_land as dl
import bedrock_db as bdb
from princess_world_test import walk_reach

fails = []
def check(ok, msg):
    if not ok:
        fails.append(msg)
        print("FAIL:", msg)

w = dl.generate(dl.REGION_SEED)
G = dl.G
idx = lambda x, y, z: (x - dl.RX0, y - pw.MIN_Y, z - dl.RZ0)
get = lambda x, y, z: int(w.b[idx(x, y, z)])
name = lambda v: pw.PALETTE[v][0]

# ---------------------------------------------------------------- the edges meet the flat world
edge_bad = 0
for (x, z) in [(x, dl.RZ0) for x in range(dl.RX0, dl.RX1)] + [(x, dl.RZ1 - 1) for x in range(dl.RX0, dl.RX1)] + \
              [(dl.RX0, z) for z in range(dl.RZ0, dl.RZ1)] + [(dl.RX1 - 1, z) for z in range(dl.RZ0, dl.RZ1)]:
    for gy in range(pw.MIN_Y, G + 3):
        want = dl.flat_default(gy + pw.Y_OFF)
        have = name(get(x, gy, z))
        if have != want and not (gy == G and have == "minecraft:grass_path") and not (gy == G - 1 and have == "minecraft:chiseled_stone_bricks") \
                and not (gy > G and have in ("minecraft:short_grass",) or "flower" in have or "tulip" in have):
            ore = gy < G - 3 and have.endswith("_ore")
            if not ore:
                edge_bad += 1
check(edge_bad == 0, "the region's edges are flat-world ground (%d odd blocks)" % edge_bad)

# ---------------------------------------------------------------- walking
X0, X1, Y0, Y1, Z0, Z1 = -75, 135, dl.CAVE_Y - 3, G + 14, dl.RZ0, 370
sub = w.b[X0 - dl.RX0:X1 - dl.RX0, Y0 - pw.MIN_Y:Y1 - pw.MIN_Y, Z0 - dl.RZ0:Z1 - dl.RZ0]
passable = set(pw.PASSABLE) | dl.RAIL_IDS | {dl.BUTTON_UP, dl.WHEAT, pw.LILY_PAD}
passable |= {v for v, (n, s) in enumerate(pw.PALETTE) if n.endswith(("_flower", "tulip", "short_grass", "fern", "daisy", "allium",
                                                                       "bluet", "cornflower", "orchid", "poppy", "dandelion"))}
start = (0 - X0, G + 1 - Y0, dl.RZ0 + 1 - Z0)
check(sub[start[0], start[1], start[2]] in passable and sub[start[0], start[1] - 1, start[2]] not in passable, "a place to stand at the road's end")
R = walk_reach(sub, start, passable, pw.WATER)
def reach(p, r=1, what=""):
    x, y, z = p
    for a in range(-r, r + 1):
        for c in range(-r, r + 1):
            for b in (0, 1, -1):
                i, j, k = x + a - X0, y + b - Y0, z + c - Z0
                if 0 <= i < R.shape[0] and 0 <= j < R.shape[1] and 0 <= k < R.shape[2] and R[i, j, k]:
                    return True
    check(False, "can walk to " + what + " " + str(p))
    return False
q = w.quest
reach((q["dragon"][0], q["dragon"][1], q["dragon"][2] - 9), 2, "the dragon")
reach(w.places["field shed"], 1, "the shed")
sc = q["shed chest"]; reach((sc[0], sc[1], sc[2] - 1), 1, "the shed chest")
reach(q["field"], 3, "the wheat field")
reach(w.places["mine head"], 1, "the mine head")
reach(w.places["pebble"], 1, "Pebble's counter")
st = q["station chest"]; reach((st[0], st[1], st[2] + 1), 1, "the station chest")
s0 = q["start"]; reach((s0[0], s0[1], s0[2] - 1), 1, "the platform by the cart")
reach(w.places["crystal stop"], 1, "the Crystal Caverns stop (along the tunnel)")
# the Crystal Caverns: through the (opened) magic door, over the bridge, into the geode; out of the pit's water
cx0, cy0, cz0, cx1, cy1, cz1 = q["caverns"]
CX0, CY0, CZ0 = 118, cy0 - 2, cz0
csub = w.b[CX0 - dl.RX0:cx1 + 1 - dl.RX0, CY0 - pw.MIN_Y:cy1 + 2 - pw.MIN_Y, CZ0 - dl.RZ0:cz1 + 1 - dl.RZ0]
cpass = passable | {pw.MAGIC_BARRIER}
def creach(R2, p, r, what):
    x, y, z = p
    ok = any(R2[x + a - CX0, y + bb - CY0, z + c - CZ0] for a in range(-r, r + 1) for c in range(-r, r + 1) for bb in (0, 1, -1))
    check(ok, "caverns: can walk to " + what)
cs = q["crystal stop"]
RC = walk_reach(csub, (cs[0] - CX0, cs[1] - CY0, cs[2] - CZ0), cpass, pw.WATER)
creach(RC, w.places["chasm far side"], 1, "the far side of the bridge")
creach(RC, w.places["geode"], 1, "the geode")
reachable_clusters = sum(1 for (x, y, z) in q["clusters"] if any(RC[x + a - CX0, y + bb - CY0, z + c - CZ0]
                         for a in (-1, 0, 1) for c in (-1, 0, 1) for bb in (-2, -1, 0, 1)))
check(len(q["clusters"]) >= 18 and reachable_clusters >= 12, "crystals to mine (%d, %d within reach)" % (len(q["clusters"]), reachable_clusters))
pit = [(i, j, k) for (i, j, k) in np.argwhere(csub == pw.WATER)]
if pit:
    i, j, k = max(pit, key=lambda t: t[1])
    RP = walk_reach(csub, (int(i), int(j), int(k)), cpass, pw.WATER)
    creach(RP, w.places["chasm far side"], 1, "out of the water in the chasm")
lit = sum(1 for (i, j, k) in np.argwhere(np.isin(csub, [pw.LANTERN, pw.HANGING_LANTERN])) if CX0 + i > 129)
check(lit == 0, "the caverns are dark (no lanterns inside): %d" % lit)

for (x, y, z) in q["gap"]:
    check(get(x, y, z) == pw.AIR and get(x, y - 1, z) not in passable, "the gap at %d is empty, with floor under it" % x)

# ---------------------------------------------------------------- the railway
rails = w.track
check(len(rails) > 150, "a long line (%d)" % len(rails))
gapset = {tuple(p) for p in q["gap"]}
bad = []
for i, (x, y, z) in enumerate(rails):
    v = get(x, y, z)
    if (x, y, z) in gapset:
        continue
    if v not in dl.RAIL_IDS:
        bad.append("no rail at %s" % ((x, y, z),)); continue
    below = get(x, y - 1, z)
    if below in passable:
        bad.append("rail in the air at %s" % ((x, y, z),))
    n, s = pw.PALETTE[v]
    if n == "minecraft:golden_rail" and s.get("rail_data_bit") and below != dl.REDSTONE_BLOCK:
        bad.append("powered rail not on redstone at %s" % ((x, y, z),))
    for k in range(1, 4):                       # room for a cart and a rider (a lantern may hang at the top)
        if get(x, y + k, z) not in passable and not (k == 3 and get(x, y + k, z) == pw.HANGING_LANTERN):
            bad.append("no headroom over %s" % ((x, y, z),)); break
    if i:
        px, py, pz = rails[i - 1]
        if abs(px - x) + abs(pz - z) != 1:
            bad.append("track jumps at %s" % ((x, y, z),))
        if py != y:
            # going down: this piece is a slope in the lower block rising toward the last piece
            d = s.get("rail_direction")
            ok = py == y + 1 and ((px < x and d == 3) or (px > x and d == 2) or (pz < z and d == 4) or (pz > z and d == 5))
            if not ok:
                bad.append("bad slope at %s" % ((x, y, z),))
check(not bad, "the railway is sound: " + "; ".join(bad[:4]))
ex, ey, ez = rails[-1]
check(get(*rails[0][:1], rails[0][1], rails[0][2] + 1) == dl.BUTTON_UP and get(ex + 1, ey, ez) == dl.BUTTON_UP, "a button by each end")
check(get(rails[0][0] - 1, rails[0][1], rails[0][2]) not in passable and get(ex, ey, ez + 1) not in passable, "a bumper at each end")
drop = rails[0][1] - rails[-1][1]
check(drop >= 15, "the line goes down to the caverns (%d blocks)" % drop)
check(w.iron_in_station >= 15, "iron ore in the station walls (%d)" % w.iron_in_station)

# ---------------------------------------------------------------- things sit on something; water stays put
for nm, (x, y, z) in w.chests.items():
    check(get(x, y - 1, z) not in passable, "chest %s sits on something" % nm)
lanterns = np.argwhere(np.isin(w.b, [pw.LANTERN]))
hanging = np.argwhere(np.isin(w.b, [pw.HANGING_LANTERN]))
loose = sum(1 for (i, j, k) in lanterns if w.b[i, j - 1, k] in passable or w.b[i, j - 1, k] == pw.AIR)
loose += sum(1 for (i, j, k) in hanging if w.b[i, j + 1, k] == pw.AIR)
check(loose == 0, "every lantern sits on or hangs from something (%d loose)" % loose)
leaks = 0
for (i, j, k) in np.argwhere(w.b == pw.WATER):
    for (a, b, c) in ((1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1), (0, -1, 0)):
        if 0 <= i + a < w.b.shape[0] and 0 <= k + c < w.b.shape[2] and w.b[i + a, j + b, k + c] == pw.AIR:
            leaks += 1
check(leaks == 0, "the field's water stays in its channel (%d leaks)" % leaks)

# ---------------------------------------------------------------- the story data
src = open(dl.data_path()).read()
data = json.loads(src[src.index("{"):src.rindex("}") + 1])
check(data["dragon"] == [q["dragon"][0], q["dragon"][1] + pw.Y_OFF, q["dragon"][2]], "dragon_data.js matches the region (run tools/make_dragon_land.py)")
check(data["gap"] == [[x, y + pw.Y_OFF, z] for (x, y, z) in q["gap"]], "dragon_data.js has the gap")
check(data["marker"][3] == "minecraft:chiseled_stone_bricks" and get(q["marker"][0], q["marker"][1], q["marker"][2]) == dl.MARKER, "the marker block")

# ---------------------------------------------------------------- block states
if len(sys.argv) > 1:
    mj = json.load(open(sys.argv[1]))
    props = {p["name"]: [v["value"] for v in p["values"]] for p in mj["block_properties"]}
    known = {d["name"]: sorted(p["name"] for p in d.get("properties", [])) for d in mj["data_items"]}
    for v in np.unique(w.b):
        n, st = pw.PALETTE[int(v)]
        if n.startswith("kq:"):
            continue
        check(n in known and known[n] == sorted(st) and all(val in props.get(k, []) for k, val in st.items()),
              "block state %s %s is valid" % (n, st))

# ---------------------------------------------------------------- adding it to a played world
def recompress(path):
    """Rewrite an uncompressed LevelDB table with raw-zlib blocks, the way Minecraft stores them."""
    data = open(path, "rb").read()
    footer = data[-48:]
    p = 0
    mo, p = bdb._varint(footer, p); ms, p = bdb._varint(footer, p)
    io, p = bdb._varint(footer, p); isz, p = bdb._varint(footer, p)
    out = bytearray()
    def block(raw):
        comp = zlib.compressobj(6, zlib.DEFLATED, -15)
        z = comp.compress(raw) + comp.flush()
        off = len(out)
        out.extend(z + bytes([4]) + b"\0\0\0\0")
        return off, len(z)
    def varint(v):
        b = bytearray()
        while True:
            if v < 0x80:
                b.append(v); return bytes(b)
            b.append((v & 0x7F) | 0x80); v >>= 7
    def encode_block(entries):
        b, restarts = bytearray(), []
        for k, v in entries:
            restarts.append(len(b))
            b += varint(0) + varint(len(k)) + varint(len(v)) + k + v
        for r in restarts:
            b += struct.pack("<I", r)
        return bytes(b + struct.pack("<I", len(restarts)))
    def raw_block(o, s):
        assert data[o + s] == 0
        return data[o:o + s]
    index = []
    for key, handle in bdb._entries(raw_block(io, isz)):
        o, qq = bdb._varint(handle, 0); s, _ = bdb._varint(handle, qq)
        no, ns = block(raw_block(o, s))
        index.append((key, varint(no) + varint(ns)))
    meta = block(raw_block(mo, ms))
    idx_h = block(encode_block(index))
    foot = varint(meta[0]) + varint(meta[1]) + varint(idx_h[0]) + varint(idx_h[1])
    out.extend(foot + b"\0" * (40 - len(foot)) + struct.pack("<Q", 0xDB4775248B80FB57))
    open(path, "wb").write(bytes(out))

def flat_chunk(cx, cz, house=False, hole=None):
    """A chunk as the game makes it outside the old built area: the flat layers (and maybe a player's changes)."""
    pal = {0: pw.PALETTE.index(("minecraft:air", {}))}
    raws = [bdb_raw(n) for n in ("minecraft:air", "minecraft:bedrock", "minecraft:deepslate", "minecraft:stone", "minecraft:dirt",
                                  "minecraft:grass_block", "minecraft:oak_planks")]
    recs = {}
    base = struct.pack("<ii", cx, cz)
    recs[base + b"\x2c"] = bytes([40])
    for y in range(-4, 3):
        a = np.zeros(4096, np.int64)
        for i in range(4096):
            gy = y * 16 + (i % 16)
            a[i] = ["minecraft:air", "minecraft:bedrock", "minecraft:deepslate", "minecraft:stone", "minecraft:dirt",
                    "minecraft:grass_block"].index(dl.flat_default(gy))
            x, z = i // 256, (i // 16) % 16
            if house and 36 <= gy <= 39 and x in (2, 9) and 2 <= z <= 9:
                a[i] = 6                                                       # a little house of planks
            if hole and hole[0] <= gy <= hole[1]:
                a[i] = 0                                                       # dug out
        if not a.any():
            continue
        recs[base + bytes([0x2F, y & 0xFF])] = bdb.encode_subchunk(y, [(a, raws)])
    recs[base + b"\x2b"] = struct.pack("<256h", *([100] * 256)) + bytes([1]) + struct.pack("<i", 1) * 1
    return recs

def bdb_raw(n):
    import make_floating_world as fw
    return fw.nbt({"name": pw.STR(n), "states": pw.C({"pillar_axis": pw.STR("y")} if n == "minecraft:deepslate" else {}),
                   "version": pw.I(pw.BLOCK_VERSION)})

import plyvel
tmp = tempfile.mkdtemp()
root = os.path.join(tmp, "world")
db = os.path.join(root, "db")
os.makedirs(root)
items = {}
crater_chunk = (dl.CRATER[0] >> 4, dl.CRATER[1] >> 4)
pebble_chunk = (q["pebble"][0] >> 4, q["pebble"][2] >> 4)
items.update(flat_chunk(*crater_chunk, house=True))
items.update(flat_chunk(*pebble_chunk, hole=(pw.Y_OFF + dl.STATION_Y - 2, pw.Y_OFF + dl.STATION_Y + 2)))
items.update(flat_chunk(0, 9))                                                  # the marker's chunk, plain
chest_be = pw.chest_nbt(crater_chunk[0] * 16 + 5, 36, crater_chunk[1] * 16 + 5, [pw.item(0, "diamond", 3)])
items[struct.pack("<ii", *crater_chunk) + b"\x31"] = chest_be
items[b"~local_player"] = b"havana"
items[struct.pack("<ii", 0, 0) + b"\x2c"] = bytes([40])                        # a kingdom chunk: never touched
items[struct.pack("<ii", 0, 0) + b"\x2f\x00"] = b"kingdom"
d = plyvel.DB(db, create_if_missing=True, compression=None)
keys = sorted(items)
with d.write_batch() as wb:
    for k in keys[: len(keys) // 2]:
        wb.put(k, items[k])
d.compact_range()                                                               # half in tables ...
for k in keys[len(keys) // 2:]:
    d.put(k, items[k])                                                          # ... half still in the log
d.put(b"deleted-key", b"x"); d.delete(b"deleted-key")
d.close()
for fn in os.listdir(db):
    if fn.endswith(".ldb"):
        recompress(os.path.join(db, fn))
back = bdb.read_db(db)
check(back == items, "the LevelDB reader reads tables (raw zlib) and the log back exactly")
import update_world
report = []
update_world.add_dragon_land(root, report)
print("\n".join(report))
after = bdb.read_db(db)
check(after[b"~local_player"] == b"havana", "player records kept")
check(after[struct.pack("<ii", 0, 0) + b"\x2f\x00"] == b"kingdom", "kingdom chunks untouched")
check(len([k for k in after if len(k) in (9, 10) and k[8] == 0x2C]) >= len(dl.chunk_coords()), "every chunk of the region is there")

def block_at(items_, x, gy, z):
    y = gy >> 4
    v = items_.get(struct.pack("<ii", x >> 4, z >> 4) + bytes([0x2F, y & 0xFF]))
    if v is None:
        return "minecraft:air"
    _, st = bdb.decode_subchunk(v)
    i, _, dicts = st[0]
    return dicts[i[(x & 15) * 256 + (z & 15) * 16 + (gy & 15)]]["name"]

cx0, cz0 = crater_chunk[0] * 16, crater_chunk[1] * 16
check(block_at(after, cx0 + 2, 37, cz0 + 5) == "minecraft:oak_planks", "the player's house by the crater is kept")
changed = sum(1 for x in range(cx0, cx0 + 16) for z in range(cz0, cz0 + 16)
              if block_at(after, x, 34, z) != "minecraft:dirt" and name(get(x, 34 - pw.Y_OFF, z)) == block_at(after, x, 34, z))
check(changed > 20, "the crater is dug into the visited chunk (%d)" % changed)
px, py, pz = q["pebble"]
check(block_at(after, px, py + pw.Y_OFF - 1, pz) == "minecraft:air", "the player's hole where the station floor would be stays a hole")
check(block_at(after, px + 3, py + pw.Y_OFF + 5, pz) == name(get(px + 3, py + 5, pz)), "the station is built round it")
far = (10, 20)                                                                   # a chunk never visited: whole
for (x, gy, z) in ((far[0] * 16 + 3, 35, far[1] * 16 + 3), (far[0] * 16 + 8, 20, far[1] * 16 + 8)):
    check(block_at(after, x, gy, z) == name(get(x, gy - pw.Y_OFF, z)), "an unvisited chunk comes in whole at %s" % ((x, gy, z),))
bes = after[struct.pack("<ii", *crater_chunk) + b"\x31"]
check(bes.startswith(chest_be), "the player's chest is kept")
sx, sy, sz = q["shed chest"]
be = after.get(struct.pack("<ii", sx >> 4, sz >> 4) + b"\x31", b"")
check(b"crafting_table" in be, "the shed chest is filled")
sx, sy, sz = q["station chest"]                       # (in the chunk with the dug hole: the player's air stays)
be = after.get(struct.pack("<ii", sx >> 4, sz >> 4) + b"\x31", b"")
check(b"stone_pickaxe" not in be and block_at(after, sx, sy + pw.Y_OFF, sz) == "minecraft:air", "no chest put into the player's hole")
check(update_world.make_dragon_land.has_region(after) if hasattr(update_world, "make_dragon_land") else dl.has_region(after), "the marker says it's there")
report = []
update_world.add_dragon_land(root, report)
check(report == ["Dragon Land: already there"], "running it again changes nothing: " + str(report))
again = bdb.read_db(db)
check(again == after, "the second run leaves the world exactly as it was")
# a world with part 1 only (no second marker, rock and ore where the caverns are now): the update adds the caverns
def set_block(items_, x, gy, z, nm):
    k = struct.pack("<ii", x >> 4, z >> 4) + bytes([0x2F, (gy >> 4) & 0xFF])
    _, st = bdb.decode_subchunk(items_[k])
    i, raws, dicts = st[0]
    raws = raws + [bdb_raw(nm)]
    i = i.copy(); i[(x & 15) * 256 + (z & 15) * 16 + (gy & 15)] = len(raws) - 1
    items_[k] = bdb.encode_subchunk(gy >> 4, [(i, raws)] + [(a, r) for a, r, _ in st[1:]])
old = dict(again)
gx, gy_, gz = q["geode"]
set_block(old, 1, G - 1 + pw.Y_OFF, dl.RZ0 + 2, "minecraft:dirt")
set_block(old, gx, gy_ + pw.Y_OFF + 2, gz, "minecraft:deepslate")      # (deepslate: this deep, that is the plain ground)
set_block(old, gx + 1, gy_ + pw.Y_OFF + 2, gz, "minecraft:iron_ore")
shutil.rmtree(db); bdb.write_db(db, old)
report = []
update_world.add_dragon_land(root, report)
print("\n".join(report))
now = bdb.read_db(db)
check(dl.has_region(now) and block_at(now, gx, gy_ + pw.Y_OFF + 2, gz) == "minecraft:air" and block_at(now, gx + 1, gy_ + pw.Y_OFF + 2, gz) == "minecraft:air",
      "a world with part 1 gets the caverns (rock and ore cleared out)")
check(block_at(now, cx0 + 2, 37, cz0 + 5) == "minecraft:oak_planks", "and the player's house is still there")
shutil.rmtree(tmp)

print("FAILED: %d" % len(fails) if fails else "all checks passed")
sys.exit(1 if fails else 0)
