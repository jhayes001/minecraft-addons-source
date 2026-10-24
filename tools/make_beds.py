"""Writes one .mcstructure per bed color for the House Blueprint add-on.

Each structure is a 2x1x1 bed: foot at x=0, head at x=1 (head pointing east).
The script rotates it into place. Bed color lives in block-entity data,
which scripts can't set directly, so pre-made structures are the workaround.
Format: little-endian NBT, blocks indexed with z fastest, then y, then x.
"""
import struct, sys, os

COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
          "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"]
BLOCK_VERSION = (1 << 24) | (20 << 16) | (0 << 8) | 1  # 1.20.0.1; newer games upgrade the states

def s(txt):
    b = txt.encode("utf-8")
    return struct.pack("<H", len(b)) + b

def tag(t, name, payload):
    return bytes([t]) + s(name) + payload

def byte(name, v): return tag(1, name, struct.pack("<b", v))
def int_(name, v): return tag(3, name, struct.pack("<i", v))
def string(name, v): return tag(8, name, s(v))
def compound(name, items): return tag(10, name, b"".join(items) + b"\x00")
def compound_payload(items): return b"".join(items) + b"\x00"
def int_list(name, values): return tag(9, name, bytes([3]) + struct.pack("<i", len(values)) + b"".join(struct.pack("<i", v) for v in values))
def list_of(name, elem_type, payloads): return tag(9, name, bytes([elem_type]) + struct.pack("<i", len(payloads)) + b"".join(payloads))

def bed_state(head):
    return compound_payload([
        string("name", "minecraft:bed"),
        compound("states", [int_("direction", 3), byte("head_piece_bit", 1 if head else 0), byte("occupied_bit", 0)]),
        int_("version", BLOCK_VERSION),
    ])

def bed_entity(color, x):
    return compound(str(x), [compound("block_entity_data", [
        string("id", "Bed"), byte("color", color), byte("isMovable", 1),
        int_("x", x), int_("y", 0), int_("z", 0),
    ])])

def structure(color):
    layer0 = int_list("", [0, 1])[3:]  # list payload only
    layer1 = int_list("", [-1, -1])[3:]
    root = compound("", [
        int_("format_version", 1),
        int_list("size", [2, 1, 1]),
        compound("structure", [
            list_of("block_indices", 9, [layer0, layer1]),
            list_of("entities", 10, []),
            compound("palette", [compound("default", [
                list_of("block_palette", 10, [bed_state(False), bed_state(True)]),
                compound("block_position_data", [bed_entity(color, 0), bed_entity(color, 1)]),
            ])]),
        ]),
        int_list("structure_world_origin", [0, 0, 0]),
    ])
    return root

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
for i, name in enumerate(COLORS):
    with open(os.path.join(out, f"bed_{name}.mcstructure"), "wb") as f:
        f.write(structure(i))
print("wrote", len(COLORS), "beds to", out)
