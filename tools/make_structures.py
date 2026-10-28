"""Writes the small pre-made pieces (.mcstructure files) the House Blueprint places:

  bed_<color>     2x1x1 bed: foot at x=0, head at x=1 (head pointing east)
  frame_<item>    1x1x1 item frame facing east, holding <item>
  banner_<color>  1x1x1 wall banner facing east (a curtain)

The script rotates each one into place. Bed and banner colors and what's in a frame
live in block-entity data, which scripts can't set directly, so pre-made structures
are the workaround.
Format: little-endian NBT, blocks indexed with z fastest, then y, then x.
Usage: python3 make_structures.py <behavior_pack>/structures/house
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
def short(name, v): return tag(2, name, struct.pack("<h", v))
def float_(name, v): return tag(5, name, struct.pack("<f", v))
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

def build(size, palette, entities_by_index):
    """palette: list of block-state payloads; blocks are palette indices 0..n-1 in order."""
    n = size[0] * size[1] * size[2]
    layer0 = int_list("", list(range(n)))[3:]  # list payload only
    layer1 = int_list("", [-1] * n)[3:]
    return compound("", [
        int_("format_version", 1),
        int_list("size", size),
        compound("structure", [
            list_of("block_indices", 9, [layer0, layer1]),
            list_of("entities", 10, []),
            compound("palette", [compound("default", [
                list_of("block_palette", 10, palette),
                compound("block_position_data", entities_by_index),
            ])]),
        ]),
        int_list("structure_world_origin", [0, 0, 0]),
    ])


def bed(color):
    return build([2, 1, 1], [bed_state(False), bed_state(True)], [bed_entity(color, 0), bed_entity(color, 1)])


FACING_EAST = 5
FRAME_ITEMS = ["clock", "compass", "diamond", "emerald", "poppy", "golden_apple", "music_disc_cat",
               "cookie", "spyglass", "nautilus_shell"]  # keep in sync with FRAME_ITEMS in main.js


def frame(item):
    state = compound_payload([
        string("name", "minecraft:frame"),
        compound("states", [int_("facing_direction", FACING_EAST), byte("item_frame_map_bit", 0), byte("item_frame_photo_bit", 0)]),
        int_("version", BLOCK_VERSION),
    ])
    be = compound("0", [compound("block_entity_data", [
        string("id", "ItemFrame"), byte("isMovable", 1), int_("x", 0), int_("y", 0), int_("z", 0),
        compound("Item", [string("Name", f"minecraft:{item}"), byte("Count", 1), short("Damage", 0), byte("WasPickedUp", 0)]),
        float_("ItemRotation", 0.0), float_("ItemDropChance", 1.0),
    ])])
    return build([1, 1, 1], [state], [be])


def banner(color_index):
    state = compound_payload([
        string("name", "minecraft:wall_banner"),
        compound("states", [int_("facing_direction", FACING_EAST)]),
        int_("version", BLOCK_VERSION),
    ])
    # Banner base colors count the other way from beds and wool: 0 = black ... 15 = white.
    be = compound("0", [compound("block_entity_data", [
        string("id", "Banner"), byte("isMovable", 1), int_("x", 0), int_("y", 0), int_("z", 0),
        int_("Base", 15 - color_index), int_("Type", 0), list_of("Patterns", 10, []),
    ])])
    return build([1, 1, 1], [state], [be])


out = sys.argv[1]
os.makedirs(out, exist_ok=True)
count = 0
for i, name in enumerate(COLORS):
    for kind, data in (("bed", bed(i)), ("banner", banner(i))):
        with open(os.path.join(out, f"{kind}_{name}.mcstructure"), "wb") as f:
            f.write(data)
        count += 1
for item in FRAME_ITEMS:
    with open(os.path.join(out, f"frame_{item}.mcstructure"), "wb") as f:
        f.write(frame(item))
    count += 1
print("wrote", count, "structures to", out)
