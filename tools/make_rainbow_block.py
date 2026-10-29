"""Builds the Rainbow Block textures and pack icons for the Rainbow Block add-on,
and optionally renders a preview picture.

Sides: 7 horizontal stripes, red at the top down to violet at the bottom, so a wall of
Rainbow Blocks reads as one big striped rainbow. Top and bottom: square rings, red on the
outside to violet near the middle with a little white sparkle in the center.

Usage: python3 make_rainbow_block.py <repo_addons_dir> [preview.png]
"""
import os, sys
from PIL import Image

RAINBOW = [  # red, orange, yellow, green, blue, indigo, violet
    (232, 48, 48),
    (255, 146, 32),
    (255, 222, 48),
    (64, 200, 72),
    (48, 140, 240),
    (80, 64, 200),
    (176, 80, 224),
]
WHITE = (255, 255, 255)
STRIPE_ROWS = [3, 2, 2, 2, 2, 2, 3]  # 16 pixel rows split into 7 stripes


def shade(c, f):
    return tuple(max(0, min(255, round(v * f))) for v in c)


def side_texture():
    img = Image.new("RGBA", (16, 16))
    y = 0
    for color, rows in zip(RAINBOW, STRIPE_ROWS):
        for r in range(rows):
            # a lighter top row on each stripe gives it a soft shine
            c = shade(color, 1.15) if r == 0 else color
            for x in range(16):
                img.putpixel((x, y), c + (255,))
            y += 1
    return img


def top_texture():
    img = Image.new("RGBA", (16, 16))
    for y in range(16):
        for x in range(16):
            ring = min(x, y, 15 - x, 15 - y)  # 0 at the edge, 7 in the middle
            c = WHITE if ring == 7 else RAINBOW[ring]
            img.putpixel((x, y), c + (255,))
    return img


def pack_icon(side):
    # The striped side face, scaled up.
    icon = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    icon.paste(side, (0, 0))
    big = icon.resize((256, 256), Image.NEAREST)
    return big


def preview(side, top, path):
    # A 4x3 wall of blocks plus the top face, scaled up, so you can see how stripes line up.
    s = 16
    canvas = Image.new("RGBA", (s * 6, s * 3), (40, 40, 48, 255))
    for bx in range(4):
        for by in range(3):
            canvas.paste(side, (bx * s, by * s))
    canvas.paste(top, (s * 5, s))
    canvas.resize((canvas.width * 8, canvas.height * 8), Image.NEAREST).save(path)


def main():
    addons = sys.argv[1]
    rp = os.path.join(addons, "RainbowBlock_RP")
    bp = os.path.join(addons, "RainbowBlock_BP")
    os.makedirs(os.path.join(rp, "textures", "blocks"), exist_ok=True)
    side, top = side_texture(), top_texture()
    side.save(os.path.join(rp, "textures", "blocks", "rainbow_block_side.png"))
    top.save(os.path.join(rp, "textures", "blocks", "rainbow_block_top.png"))
    icon = pack_icon(side)
    icon.save(os.path.join(rp, "pack_icon.png"))
    icon.save(os.path.join(bp, "pack_icon.png"))
    if len(sys.argv) > 2:
        preview(side, top, sys.argv[2])
    print("Rainbow Block textures written")


if __name__ == "__main__":
    main()
