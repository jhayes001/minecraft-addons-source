"""Checks the Floating Jungle Islands world: builds it, reopens the .mcworld and reads it back.

  - every chunk's sub-chunks decode back to exactly the blocks that were generated
  - level.dat parses, and its spawn is a safe spot (air to stand in, ground underneath)
  - hanging/clinging plants have something holding them up, two-block plants are whole
  - the spawn chest is there with its elytra
  - optional: every block state is valid for the game version, checked against Mojang's
    block list (pass the path to mojang-blocks.json from github.com/Mojang/bedrock-samples,
    metadata/vanilladata_modules, at the tag matching GAME_VERSION)

Usage: python3 tests/floating_world_test.py [path/to/mojang-blocks.json]
"""
import io, json, os, struct, sys, tempfile, zipfile
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import make_floating_world as mfw

fails = []
def check(ok, msg):
    if not ok:
        fails.append(msg)
        print("FAIL:", msg)

# ---- minimal little-endian NBT reader (independent of the writer)
def read_nbt(buf, pos=0):
    def s(p):
        n = struct.unpack_from("<H", buf, p)[0]
        return buf[p + 2:p + 2 + n].decode(), p + 2 + n
    def payload(t, p):
        if t == 1: return struct.unpack_from("<b", buf, p)[0], p + 1
        if t == 2: return struct.unpack_from("<h", buf, p)[0], p + 2
        if t == 3: return struct.unpack_from("<i", buf, p)[0], p + 4
        if t == 4: return struct.unpack_from("<q", buf, p)[0], p + 8
        if t == 5: return struct.unpack_from("<f", buf, p)[0], p + 4
        if t == 8: return s(p)
        if t == 9:
            et = buf[p]; n = struct.unpack_from("<i", buf, p + 1)[0]; p += 5
            out = []
            for _ in range(n):
                v, p = payload(et, p); out.append(v)
            return out, p
        if t == 10:
            d = {}
            while True:
                ct = buf[p]; p += 1
                if ct == 0: return d, p
                name, p = s(p)
                d[name], p = payload(ct, p)
        raise ValueError("tag %d" % t)
    assert buf[pos] == 10
    _, p = s(pos + 1)
    return payload(10, p)

def decode_subchunk(val):
    assert val[0] == 9, "subchunk version"
    n_storages, y_index = val[1], struct.unpack("b", val[2:3])[0]
    p = 3
    header = val[p]; p += 1
    bits = header >> 1
    assert header & 1 == 0, "persistent palette flag"
    per = 32 // bits
    words = -(-4096 // per)
    raw = np.frombuffer(val, "<u4", words, p); p += 4 * words
    idx = ((raw[:, None] >> (np.arange(per, dtype=np.uint32) * bits)) & ((1 << bits) - 1)).reshape(-1)[:4096]
    n = struct.unpack_from("<i", val, p)[0]; p += 4
    pal = []
    for _ in range(n):
        d, p = read_nbt(val, p)
        pal.append(d)
    assert p == len(val), "trailing bytes in subchunk"
    return n_storages, y_index, idx, pal

def main():
    out = tempfile.mkdtemp()
    w = mfw.generate(20261111)
    day = os.path.join(out, "day.png")
    mfw.render(w, day, sc=1)
    path, n_chunks = mfw.write_world(w, out, day)
    check(n_chunks == (mfw.SIZE // 16) ** 2, "chunk count")

    # ---- reopen the .mcworld
    import plyvel
    tmp = tempfile.mkdtemp()
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        check("level.dat" in names and "levelname.txt" in names and "world_icon.jpeg" in names, "world files present")
        check(any(n.startswith("db/") and n.endswith("CURRENT") for n in names), "db present")
        z.extractall(tmp)
    raw = open(os.path.join(tmp, "level.dat"), "rb").read()
    ver, length = struct.unpack_from("<ii", raw)
    check(ver == 10 and length == len(raw) - 8, "level.dat header")
    lvl, end = read_nbt(raw, 8)
    check(end == len(raw), "level.dat parses to the end")
    check(lvl["Generator"] == 2 and json.loads(lvl["FlatWorldLayers"])["biome_id"] == 21, "flat jungle outside")
    check(lvl["falldamage"] == 0 and lvl["keepinventory"] == 1 and lvl["GameType"] == 0, "kid-friendly rules")
    sx, sy, sz = lvl["SpawnX"], lvl["SpawnY"], lvl["SpawnZ"]

    db = plyvel.DB(os.path.join(tmp, "db"))
    name_of = {i: (n, s) for i, (n, s) in enumerate(mfw.PALETTE)}
    decoded = np.zeros_like(w.b)
    be_raw = {}
    sub_count = 0
    for key, val in db:
        if len(key) < 9:
            continue
        cx, cz = struct.unpack_from("<ii", key)
        tag = key[8]
        if tag == 0x2F:
            ns, yi, idx, pal = decode_subchunk(val)
            check(ns == 1 and yi == struct.unpack("b", key[9:10])[0], "subchunk index matches key")
            ids = []
            for pe in pal:
                match = [i for i, (n, s) in name_of.items() if n == pe["name"] and
                         {k: (bool(v) if isinstance(mfw.PALETTE[i][1].get(k), bool) else v) for k, v in pe["states"].items()} == s]
                check(len(match) == 1, "palette entry %s" % pe)
                ids.append(match[0] if match else 0)
                check(pe["version"] == mfw.BLOCK_VERSION, "block version")
            blocks = np.array(ids, np.uint8)[idx].reshape(16, 16, 16)   # x, z, y
            i0, k0, j0 = cx * 16 + mfw.HALF, cz * 16 + mfw.HALF, (yi * 16) - mfw.MIN_Y
            decoded[i0:i0 + 16, j0:j0 + 16, k0:k0 + 16] = blocks.transpose(0, 2, 1)
            sub_count += 1
        elif tag == 0x31:
            be_raw[(cx, cz)] = val
        elif tag == 0x2B:
            check(len(val) == 512 + 25 * 5, "Data3D size")
        elif tag == 0x36:
            check(struct.unpack("<i", val)[0] == 2, "finalized")
    db.close()
    check(sub_count > 1000, "plenty of subchunks (%d)" % sub_count)
    check(np.array_equal(decoded, w.b), "blocks read back identical")

    b = w.b
    def at(x, y, z): return w.get(x, y, z)
    # ---- spawn
    check(at(sx, sy, sz) == mfw.AIR and at(sx, sy + 1, sz) == mfw.AIR, "spawn has headroom")
    check(at(sx, sy - 1, sz) in mfw.SOLID, "spawn has ground")
    check(sy > 30, "spawn is up on the big island")
    chest = [(x, y, z) for (x, y, z, _) in w.block_entities]
    check(len(chest) == 1 and at(*chest[0]) == mfw.CHEST, "spawn chest placed")
    ch = be_raw.get(((chest[0][0]) >> 4, (chest[0][2]) >> 4))
    check(ch is not None, "chest block entity stored in its chunk")
    if ch:
        d, _ = read_nbt(ch)
        check(d["id"] == "Chest" and (d["x"], d["y"], d["z"]) == chest[0], "chest entity position")
        check(any(it["Name"] == "minecraft:elytra" for it in d["Items"]), "elytra in chest")

    # ---- support rules
    solid = np.isin(b, list(mfw.SOLID))
    leafy = np.isin(b, [mfw.LEAVES, mfw.AZALEA_FLOWER_LEAVES])
    above = np.zeros_like(b); above[:, :-1, :] = b[:, 1:, :]
    below = np.zeros_like(b); below[:, 1:, :] = b[:, :-1, :]
    hanging = [mfw.CAVE_VINE, mfw.CAVE_VINE_BERRIES, mfw.CAVE_VINE_TIP_BERRIES]
    m = np.isin(b, hanging)
    bad = m & ~(np.isin(above, list(mfw.SOLID)) | np.isin(above, hanging + [mfw.LEAVES, mfw.AZALEA_FLOWER_LEAVES]))
    check(not bad.any(), "glow-berry vines hang from something (%d loose)" % bad.sum())
    for blk_id, name in ((mfw.SPORE_BLOSSOM, "spore blossom"), (mfw.HANGING_ROOTS, "hanging roots"), (mfw.LICHEN_CEILING, "ceiling lichen")):
        bad = (b == blk_id) & ~np.isin(above, list(mfw.SOLID))
        check(not bad.any(), "%s attached above (%d loose)" % (name, bad.sum()))
    bad = (b == mfw.LICHEN_FLOOR) & ~np.isin(below, list(mfw.SOLID))
    check(not bad.any(), "floor lichen on ground (%d loose)" % bad.sum())
    # vines: each face bit needs a solid block that way, or a vine above carrying it
    shift = {1: (0, 0, 1), 2: (-1, 0, 0), 4: (0, 0, -1), 8: (1, 0, 0)}
    vine_bits = {v: i for i, v in enumerate(mfw.VINES) if i}
    loose = 0
    for (i, j, k) in np.argwhere(np.isin(b, list(vine_bits))):
        bits = vine_bits[b[i, j, k]]
        for bit, (dx, dy, dz) in shift.items():
            if bits & bit:
                ii, kk = i + dx, k + dz
                ok_solid = 0 <= ii < mfw.SIZE and 0 <= kk < mfw.SIZE and (solid[ii, j, kk] or leafy[ii, j, kk])
                up = b[i, j + 1, k] if j + 1 < mfw.H else 0
                ok_up = up in vine_bits and vine_bits[up] & bit
                if not (ok_solid or ok_up):
                    loose += 1
    check(loose == 0, "vines all supported (%d loose)" % loose)
    side_shift = {4: (0, 1), 8: (-1, 0), 16: (0, -1), 32: (1, 0)}
    loose = 0
    for vb, lid in mfw.LICHEN_SIDE.items():
        lb = vb * 4
        dx, dz = side_shift[lb]
        for (i, j, k) in np.argwhere(b == lid):
            ii, kk = i + dx, k + dz
            if not (0 <= ii < mfw.SIZE and 0 <= kk < mfw.SIZE and solid[ii, j, kk]):
                loose += 1
    check(loose == 0, "side lichen attached (%d loose)" % loose)
    for lo, hi in (mfw.TALL_GRASS, mfw.LARGE_FERN):
        check(np.array_equal(b == lo, np.roll(b == hi, -1, axis=1) & (b == lo)) and ((b == hi) & (below != lo)).sum() == 0,
              "two-block plants are whole")
    plants = [mfw.SHORT_GRASS, mfw.FERN, mfw.BLUE_ORCHID, mfw.ALLIUM, mfw.TALL_GRASS[0], mfw.LARGE_FERN[0]]
    bad = np.isin(b, plants) & ~np.isin(below, [mfw.GRASS, mfw.PODZOL, mfw.MOSS, mfw.DIRT, mfw.VERDANT_FROG, mfw.PEARL_FROG])
    check(not bad.any(), "plants on soil (%d not)" % bad.sum())
    check(w.waterfall_count >= 4 and len(w.islands) >= 25 and w.bridge_count >= 2, "enough features")

    # ---- block states valid for the target game version
    if len(sys.argv) > 1:
        data = json.load(open(sys.argv[1]))
        props = {p["name"]: [v["value"] for v in p["values"]] for p in data["block_properties"]}
        blocks = {d["name"]: [p["name"] for p in d.get("properties", [])] for d in data["data_items"]}
        for name, states in mfw.PALETTE:
            check(name in blocks, "%s exists" % name)
            if name in blocks:
                check(sorted(blocks[name]) == sorted(states), "%s has exactly states %s (got %s)" % (name, blocks[name], list(states)))
                for k, v in states.items():
                    check(v in props.get(k, []), "%s %s=%r allowed" % (name, k, v))
        print("Checked %d block states against %s" % (len(mfw.PALETTE), sys.argv[1]))

    print("OK" if not fails else "%d FAILURES" % len(fails))
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
