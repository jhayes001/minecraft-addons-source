"""Reading a Bedrock world's LevelDB (the db/ folder), and its sub-chunks, in plain Python.

Worlds exported from Minecraft keep their LevelDB tables compressed with zlib (Mojang's own LevelDB), which the
ordinary LevelDB library (plyvel) can't read. This reads the live tables and logs directly (any of: no
compression, zlib, raw zlib; snappy if python-snappy is installed) and gives back every key and value. Writing
goes back through plyvel, uncompressed, which the game reads fine (the generators write their worlds that way).

Also: a little-endian NBT reader, and decoding / encoding sub-chunks (palette storages) so blocks can be merged.
"""
import os, struct, zlib
import numpy as np

# ---------------------------------------------------------------- LevelDB
def _varint(buf, p):
    v = shift = 0
    while True:
        b = buf[p]; p += 1
        v |= (b & 0x7F) << shift
        if b < 0x80:
            return v, p
        shift += 7

def _uncompress(data, kind):
    if kind == 0:
        return data
    if kind == 2:                                  # Mojang: zlib with a header
        return zlib.decompress(data)
    if kind == 4:                                  # Mojang: raw deflate
        return zlib.decompress(data, -15)
    if kind == 1:
        import snappy                              # pip install python-snappy (the game never uses it)
        return snappy.uncompress(data)
    raise ValueError("unknown LevelDB block compression %d" % kind)

def _block(f, offset, size):
    f.seek(offset)
    raw = f.read(size + 5)
    return _uncompress(raw[:size], raw[size])

def _entries(block):
    """(key, value) pairs of a table block."""
    n_restarts = struct.unpack_from("<I", block, len(block) - 4)[0]
    end = len(block) - 4 - 4 * n_restarts
    p, key = 0, b""
    while p < end:
        shared, p = _varint(block, p)
        unshared, p = _varint(block, p)
        vlen, p = _varint(block, p)
        key = key[:shared] + block[p:p + unshared]; p += unshared
        yield key, block[p:p + vlen]
        p += vlen

def _table(path):
    """Every (internal key, value) in an .ldb / .sst table."""
    with open(path, "rb") as f:
        f.seek(0, 2)
        size = f.tell()
        f.seek(size - 48)
        footer = f.read(48)
        if struct.unpack_from("<Q", footer, 40)[0] != 0xDB4775248B80FB57:
            raise ValueError("not a LevelDB table: " + path)
        p = 0
        _, p = _varint(footer, p); _, p = _varint(footer, p)        # metaindex handle
        io, p = _varint(footer, p); isz, p = _varint(footer, p)     # index handle
        for _, handle in _entries(_block(f, io, isz)):
            o, q = _varint(handle, 0); s, _ = _varint(handle, q)
            yield from _entries(_block(f, o, s))

def _log_records(path):
    """The write batches in a .log file (or the edits in a MANIFEST): the payload of each record."""
    data = open(path, "rb").read()
    out, part = [], b""
    p = 0
    while p + 7 <= len(data):
        block_left = 32768 - (p % 32768)
        if block_left < 7:
            p += block_left
            continue
        length, kind = struct.unpack_from("<H", data, p + 4)[0], data[p + 6]
        if kind == 0 and length == 0:
            p += block_left                            # zero padding to the end of the block
            continue
        chunk = data[p + 7:p + 7 + length]
        p += 7 + length
        if kind == 1:
            out.append(chunk)
        elif kind == 2:
            part = chunk
        elif kind == 3:
            part += chunk
        elif kind == 4:
            out.append(part + chunk); part = b""
    return out

def _manifest(db):
    """Live table numbers, and the log number, from the MANIFEST named in CURRENT."""
    name = open(os.path.join(db, "CURRENT")).read().strip()
    live, log_no, prev_log = set(), 0, 0
    for rec in _log_records(os.path.join(db, name)):
        p = 0
        while p < len(rec):
            tag, p = _varint(rec, p)
            if tag == 1:                                   # comparator name
                n, p = _varint(rec, p); p += n
            elif tag in (2, 3, 4, 9):                      # log number, next file, last sequence, prev log
                v, p = _varint(rec, p)
                if tag == 2: log_no = v
                if tag == 9: prev_log = v
            elif tag == 5:                                 # compact pointer: level, key
                _, p = _varint(rec, p); n, p = _varint(rec, p); p += n
            elif tag == 6:                                 # deleted file: level, number
                _, p = _varint(rec, p); num, p = _varint(rec, p); live.discard(num)
            elif tag == 7:                                 # new file: level, number, size, smallest, largest
                _, p = _varint(rec, p); num, p = _varint(rec, p); _, p = _varint(rec, p)
                n, p = _varint(rec, p); p += n; n, p = _varint(rec, p); p += n
                live.add(num)
            else:
                raise ValueError("unknown MANIFEST tag %d" % tag)
    return live, log_no, prev_log

def read_db(db):
    """Every live key -> value in a LevelDB folder."""
    live, log_no, prev_log = _manifest(db)
    best = {}                                              # key -> (sequence, value or None)
    def put(key, seq, val):
        old = best.get(key)
        if old is None or seq > old[0]:
            best[key] = (seq, val)
    for num in sorted(live):
        for ext in (".ldb", ".sst"):
            path = os.path.join(db, "%06d%s" % (num, ext))
            if os.path.exists(path):
                for ikey, val in _table(path):
                    trailer = struct.unpack_from("<Q", ikey, len(ikey) - 8)[0]
                    put(ikey[:-8], trailer >> 8, val if trailer & 0xFF == 1 else None)
                break
        else:
            raise ValueError("table %06d is missing from the world's db folder" % num)
    for fn in sorted(os.listdir(db)):
        if not fn.endswith(".log"):
            continue
        num = int(fn.split(".")[0])
        if num < log_no and num != prev_log:
            continue
        for batch in _log_records(os.path.join(db, fn)):
            seq, count = struct.unpack_from("<QI", batch, 0)
            p = 12
            for i in range(count):
                kind = batch[p]; p += 1
                n, p = _varint(batch, p); key = batch[p:p + n]; p += n
                if kind == 1:
                    n, p = _varint(batch, p); val = batch[p:p + n]; p += n
                    put(key, seq + i, val)
                else:
                    put(key, seq + i, None)
    return {k: v for k, (s, v) in best.items() if v is not None}

def write_db(db, items):
    """A fresh LevelDB folder with these keys and values (no compression)."""
    import plyvel
    d = plyvel.DB(db, create_if_missing=True, error_if_exists=True, compression=None)
    with d.write_batch() as wb:
        for k, v in items.items():
            wb.put(k, v)
    d.compact_range()
    d.close()

# ---------------------------------------------------------------- NBT (little endian)
def read_nbt(buf, pos=0):
    """One named compound at pos: (dict, end). Lists of compounds come back as lists of dicts."""
    def s(p):
        n = struct.unpack_from("<H", buf, p)[0]
        return buf[p + 2:p + 2 + n].decode("utf-8", "replace"), p + 2 + n
    def payload(t, p):
        if t == 1: return struct.unpack_from("<b", buf, p)[0], p + 1
        if t == 2: return struct.unpack_from("<h", buf, p)[0], p + 2
        if t == 3: return struct.unpack_from("<i", buf, p)[0], p + 4
        if t == 4: return struct.unpack_from("<q", buf, p)[0], p + 8
        if t == 5: return struct.unpack_from("<f", buf, p)[0], p + 4
        if t == 6: return struct.unpack_from("<d", buf, p)[0], p + 8
        if t == 7:
            n = struct.unpack_from("<i", buf, p)[0]; return bytes(buf[p + 4:p + 4 + n]), p + 4 + n
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
        if t == 11:
            n = struct.unpack_from("<i", buf, p)[0]; return list(struct.unpack_from("<%di" % n, buf, p + 4)), p + 4 + 4 * n
        if t == 12:
            n = struct.unpack_from("<i", buf, p)[0]; return list(struct.unpack_from("<%dq" % n, buf, p + 4)), p + 4 + 8 * n
        raise ValueError("NBT tag %d" % t)
    t = buf[pos]
    _, p = s(pos + 1)
    return payload(t, p)

# ---------------------------------------------------------------- sub-chunks
def decode_storage(val, p):
    """One palette storage at p: (4096 indices in x, z, y order, [palette entry bytes], [palette dicts], end)."""
    header = val[p]; p += 1
    bits = header >> 1
    if header & 1:
        raise ValueError("runtime palette in saved data")
    if bits == 0:                                          # one block everywhere: no words
        idx = np.zeros(4096, np.int64)
        n = 1
    else:
        per = 32 // bits
        words = -(-4096 // per)
        raw = np.frombuffer(val, "<u4", words, p).astype(np.uint64); p += 4 * words
        idx = ((raw[:, None] >> (np.arange(per, dtype=np.uint64) * bits)) & ((1 << bits) - 1)).reshape(-1)[:4096].astype(np.int64)
        n = struct.unpack_from("<i", val, p)[0]; p += 4
    raws, dicts = [], []
    for _ in range(n):
        d, q = read_nbt(val, p)
        raws.append(bytes(val[p:q])); dicts.append(d)
        p = q
    return idx, raws, dicts, p

def decode_subchunk(val):
    """(y index or None, [storages]); each storage is (indices, palette bytes, palette dicts)."""
    ver = val[0]
    if ver == 8:
        n, y, p = val[1], None, 2
    elif ver == 9:
        n, y, p = val[1], struct.unpack("b", val[2:3])[0], 3
    else:
        raise ValueError("sub-chunk version %d" % ver)
    out = []
    for _ in range(n):
        idx, raws, dicts, p = decode_storage(val, p)
        out.append((idx, raws, dicts))
    return y, out

def encode_storage(idx, palette_raws):
    """4096 indices into palette_raws (entry bytes): one storage's bytes."""
    uniq, local = np.unique(np.asarray(idx), return_inverse=True)
    n = len(uniq)
    bits = next(bb for bb in (1, 2, 3, 4, 5, 6, 8, 16) if (1 << bb) >= n)
    per = 32 // bits
    words = -(-4096 // per)
    padded = np.zeros(words * per, np.uint32); padded[:4096] = local
    padded = padded.reshape(words, per)
    packed = np.bitwise_or.reduce(padded << (np.arange(per, dtype=np.uint32) * bits), axis=1).astype("<u4")
    return bytes([bits << 1]) + packed.tobytes() + struct.pack("<i", n) + b"".join(palette_raws[int(u)] for u in uniq)

def encode_subchunk(y, storages):
    """storages: [(indices, palette entry bytes)]."""
    return bytes([9, len(storages), y & 0xFF]) + b"".join(encode_storage(i, r) for i, r in storages)
