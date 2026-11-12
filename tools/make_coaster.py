"""Builds the Coaster Wand item texture and pack icons.

The wand: a gold handle with a little rainbow roller-coaster hill on top and a red cart
riding over it. The pack icon: the same hill, big, on a sky-blue background.

Usage: python3 tools/make_coaster.py addons
"""
import os, sys
from PIL import Image, ImageDraw

RAINBOW = [(232, 48, 48), (255, 146, 32), (255, 222, 48), (64, 200, 72), (48, 140, 240), (176, 80, 224)]
GOLD, GOLD_DARK = (255, 200, 40), (190, 130, 20)
RED, RED_DARK, GREY = (220, 40, 40), (140, 20, 20), (90, 90, 100)


def wand():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = img.putpixel
    # handle: diagonal from bottom-left up to the middle
    for i in range(8):
        px((1 + i, 14 - i), GOLD + (255,))
        px((1 + i, 15 - i), GOLD_DARK + (255,))
    # rainbow hill: arcs of each color
    hill = [(6, 9), (7, 7), (8, 6), (9, 5), (10, 5), (11, 5), (12, 6), (13, 7), (14, 9)]
    for band, color in enumerate(RAINBOW[:3]):
        for x, y in hill:
            yy = y + band
            if 0 <= yy < 16:
                px((x, yy), color + (255,))
    # the cart near the top of the hill
    for x in range(9, 12):
        for y in range(2, 4):
            px((x, y), RED + (255,))
    for x in (9, 11):
        px((x, 4), GREY + (255,))
    px((10, 2), RED_DARK + (255,))
    # sparkle
    px((3, 3), (255, 255, 255, 255))
    px((14, 2), (255, 255, 200, 255))
    return img


def pack_icon(size=128):
    img = Image.new("RGBA", (size, size), (140, 200, 255, 255))
    d = ImageDraw.Draw(img)
    s = size / 128
    # ground
    d.rectangle([0, 104 * s, size, size], fill=(90, 180, 70, 255))
    # rainbow track: a big hill then a small one
    for band, color in enumerate(RAINBOW):
        off = band * 5 * s
        d.arc([10 * s, 24 * s + off, 80 * s, 150 * s + off], 180, 360, fill=color + (255,), width=int(5 * s))
        d.arc([70 * s, 64 * s + off, 120 * s, 150 * s + off], 180, 360, fill=color + (255,), width=int(5 * s))
    # supports
    for x in (24, 45, 66, 95):
        d.rectangle([x * s, 70 * s, (x + 3) * s, 104 * s], fill=(120, 80, 40, 255))
    # the cart on top of the big hill
    d.rectangle([36 * s, 12 * s, 54 * s, 24 * s], fill=RED + (255,), outline=RED_DARK + (255,), width=int(2 * s))
    d.ellipse([37 * s, 22 * s, 43 * s, 28 * s], fill=GREY + (255,))
    d.ellipse([47 * s, 22 * s, 53 * s, 28 * s], fill=GREY + (255,))
    return img


def main(addons):
    rp, bp = os.path.join(addons, "CoasterWand_RP"), os.path.join(addons, "CoasterWand_BP")
    os.makedirs(os.path.join(rp, "textures", "items"), exist_ok=True)
    wand().save(os.path.join(rp, "textures", "items", "coaster_wand.png"))
    icon = pack_icon()
    icon.save(os.path.join(rp, "pack_icon.png"))
    icon.save(os.path.join(bp, "pack_icon.png"))
    print("wrote textures and pack icons")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "addons")
