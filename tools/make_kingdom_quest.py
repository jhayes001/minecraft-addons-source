"""Builds the Kingdom Quest add-on (the story for the Princess Kingdom world): everything except
the script (addons/KingdomQuest_BP/scripts/main.js) and the world data
(addons/KingdomQuest_BP/scripts/kingdom_data.js, written by make_princess_world.py).

  - kq:princess   the princess on her throne: the seated princess from Unicorn Princess, crying
                  (hands to her face, head down) until her quest is done, then waving happily
  - kq:golden_egg a spinning golden egg with a rainbow band, to find and tap; and the item you get
  - kq:graham     Graham, the same dog as Alpha Dog (for the end of the story; not placed yet)
  - kq:magic_barrier  an unbreakable shimmering wall that closes a road or gate until the story opens it
  - particles: tears, gold sparkles, glowing paw prints
  - font/glyph_E1.png: little pictures for the story pages (egg, empty egg, Graham, princess sad and
    happy, heart, paw print, ice palace), used in text as \\uE100 ... \\uE107

Usage: python3 tools/make_kingdom_quest.py
"""
import json, math, os, shutil
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
BP = os.path.join(ROOT, "addons", "KingdomQuest_BP")
RP = os.path.join(ROOT, "addons", "KingdomQuest_RP")
VERSION = [1, 0, 0]
UUID = {"bp": "6c1f7a52-3e0b-4d9a-9b55-0f2a6b8e4c11", "bp_data": "a9d3e4f1-5b26-47c8-8e1d-3c7b9f20d6a4",
        "bp_script": "e4b8c2d7-91f3-4a6e-b05d-7d2c8a1f3e95", "rp": "2f7d9b3c-8a41-4e6f-9c05-b1e3d7a5f826",
        "rp_res": "c5a1e9d3-7f28-4b64-a3d0-6e9f2b8c4d17"}
MIN_ENGINE = [1, 21, 50]

def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        if isinstance(data, str):
            f.write(data)
        else:
            json.dump(data, f, indent=2)

# ---------------------------------------------------------------- manifests
def manifests():
    write(os.path.join(BP, "manifest.json"), {
        "format_version": 2,
        "header": {"name": "Kingdom Quest", "description": "Find Graham! The story for the Princess Kingdom world.",
                   "uuid": UUID["bp"], "version": VERSION, "min_engine_version": MIN_ENGINE},
        "modules": [{"type": "data", "uuid": UUID["bp_data"], "version": VERSION},
                    {"type": "script", "language": "javascript", "uuid": UUID["bp_script"], "version": VERSION,
                     "entry": "scripts/main.js"}],
        "dependencies": [{"uuid": UUID["rp"], "version": VERSION},
                         {"module_name": "@minecraft/server", "version": "1.19.0"},
                         {"module_name": "@minecraft/server-ui", "version": "1.3.0"}]})
    write(os.path.join(RP, "manifest.json"), {
        "format_version": 2,
        "header": {"name": "Kingdom Quest (Resources)", "description": "The princess, golden eggs, Graham and magic barriers",
                   "uuid": UUID["rp"], "version": VERSION, "min_engine_version": MIN_ENGINE},
        "modules": [{"type": "resources", "uuid": UUID["rp_res"], "version": VERSION}]})

# ---------------------------------------------------------------- behaviour definitions
def npc(identifier, width, height, family, props=None, button=None):
    desc = {"identifier": identifier, "is_spawnable": False, "is_summonable": True}
    if props:
        desc["properties"] = props
    return {"format_version": "1.21.50", "minecraft:entity": {"description": desc, "components": {
        "minecraft:type_family": {"family": [family, "kq"]},
        "minecraft:health": {"value": 20, "max": 20},
        "minecraft:damage_sensor": {"triggers": {"cause": "all", "deals_damage": False}},
        "minecraft:collision_box": {"width": width, "height": height},
        "minecraft:persistent": {},
        "minecraft:physics": {"has_gravity": False, "has_collision": False},
        "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
        "minecraft:knockback_resistance": {"value": 1},
        "minecraft:fire_immune": {},
        "minecraft:breathable": {"breathes_water": True, "breathes_air": True, "suffocate_time": 0},
        "minecraft:nameable": {"always_show": False, "allow_name_tag_renaming": False},
        # a big button on touch screens (the script answers the tap)
        **({"minecraft:interact": {"interactions": [{
            "on_interact": {"filters": {"test": "is_family", "subject": "other", "value": "player"}},
            "interact_text": "action.interact.kq_" + button}]}} if button else {})}}}

def behaviour():
    write(os.path.join(BP, "entities", "princess.json"),
          npc("kq:princess", 0.8, 1.6, "kq_princess", {"kq:happy": {"type": "bool", "client_sync": True, "default": False}}, "talk"))
    write(os.path.join(BP, "entities", "golden_egg.json"), npc("kq:golden_egg", 0.6, 0.7, "kq_egg", button="take"))
    write(os.path.join(BP, "entities", "graham.json"), npc("kq:graham", 0.8, 0.9, "kq_graham"))
    write(os.path.join(BP, "items", "golden_egg.json"), {
        "format_version": "1.21.40",
        "minecraft:item": {"description": {"identifier": "kq:golden_egg", "menu_category": {"category": "items"}},
                           "components": {"minecraft:icon": "kq_golden_egg", "minecraft:max_stack_size": 16,
                                          "minecraft:glint": True, "minecraft:display_name": {"value": "Gold Egg"}}}})
    write(os.path.join(BP, "blocks", "magic_barrier.json"), {
        "format_version": "1.21.40",
        "minecraft:block": {"description": {"identifier": "kq:magic_barrier", "menu_category": {"category": "none"}},
                            "components": {
                                "minecraft:display_name": "Magic Barrier",
                                "minecraft:destructible_by_mining": False,
                                "minecraft:destructible_by_explosion": False,
                                "minecraft:light_emission": 10,
                                "minecraft:light_dampening": 0,
                                "minecraft:geometry": "minecraft:geometry.full_block",
                                "minecraft:material_instances": {"*": {"texture": "kq_magic_barrier", "render_method": "blend"}},
                                "minecraft:map_color": "#c070ff"}}})

# ---------------------------------------------------------------- models and animations
def princess_geometry():
    """The seated princess from Unicorn Princess on her own, sitting on the floor of the model."""
    src = json.load(open(os.path.join(ROOT, "addons", "UnicornPrincess_RP", "models", "entity", "unicorn_princess.geo.json")))
    geo = src["minecraft:geometry"][0]
    keep = {"princess", "p_head", "arm_l", "arm_r"}
    bones = [json.loads(json.dumps(b)) for b in geo["bones"] if b["name"] in keep]
    low = min(c["origin"][1] for b in bones for c in b.get("cubes", []))
    for b in bones:
        b["pivot"][1] -= low
        for c in b.get("cubes", []):
            c["origin"][1] -= low
            if "pivot" in c:
                c["pivot"][1] -= low
        if b["name"] == "princess":
            b.pop("parent", None)
    desc = dict(geo["description"], identifier="geometry.kq_princess", visible_bounds_width=2, visible_bounds_height=3,
                visible_bounds_offset=[0, 1, 0])
    return {"format_version": "1.12.0", "minecraft:geometry": [{"description": desc, "bones": bones}]}

def egg_geometry():
    cubes = [([-2, 0, -2], [4, 1, 4], [0, 0]), ([-3, 1, -3], [6, 2, 6], [0, 5]), ([-3, 3, -3], [6, 2, 6], [0, 13]),
             ([-2.5, 5, -2.5], [5, 2, 5], [24, 0]), ([-1.5, 7, -1.5], [3, 1, 3], [24, 7])]
    return {"format_version": "1.12.0", "minecraft:geometry": [{
        "description": {"identifier": "geometry.kq_golden_egg", "texture_width": 64, "texture_height": 32,
                        "visible_bounds_width": 1, "visible_bounds_height": 1, "visible_bounds_offset": [0, 0.5, 0]},
        "bones": [{"name": "egg", "pivot": [0, 4, 0],
                   "cubes": [{"origin": o, "size": s, "uv": uv, "inflate": 0} for o, s, uv in cubes]}]}]}

def animations():
    return {"format_version": "1.8.0", "animations": {
        "animation.kq_princess.cry": {"loop": True, "bones": {
            "arm_l": {"rotation": ["-105 + math.sin(query.life_time * 900) * 6", -10, 25]},
            "arm_r": {"rotation": ["-105 + math.sin(query.life_time * 900 + 90) * 6", 10, -25]},
            "p_head": {"rotation": ["18 + math.sin(query.life_time * 450) * 4", 0, 0]},
            "princess": {"position": [0, "math.abs(math.sin(query.life_time * 450)) * 0.4", 0]}}},
        "animation.kq_princess.happy": {"loop": True, "bones": {
            "arm_r": {"rotation": ["-150 + math.sin(query.life_time * 600) * 12", 0, "math.sin(query.life_time * 600) * 18"]},
            "arm_l": {"rotation": [0, 0, "-8 + math.sin(query.life_time * 300) * 6"]},
            "p_head": {"rotation": ["-6 + math.sin(query.life_time * 300) * 4", "math.sin(query.life_time * 150) * 10", 0]}}},
        "animation.kq_golden_egg.spin": {"loop": True, "bones": {
            "egg": {"rotation": [0, "query.life_time * 90", "math.sin(query.life_time * 200) * 6"],
                    "position": [0, "1.5 + math.sin(query.life_time * 160) * 1.2", 0]}}}}}

def client_entity(identifier, geometry, texture, animate, anims):
    return {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": identifier, "materials": {"default": "entity_alphatest"},
        "textures": {"default": texture}, "geometry": {"default": geometry},
        "animations": anims, "scripts": {"animate": animate},
        "render_controllers": ["controller.render.default"]}}}

def resources():
    write(os.path.join(RP, "models", "entity", "kq_princess.geo.json"), princess_geometry())
    write(os.path.join(RP, "models", "entity", "kq_golden_egg.geo.json"), egg_geometry())
    write(os.path.join(RP, "animations", "kq.animation.json"), animations())
    write(os.path.join(RP, "entity", "princess.entity.json"), client_entity(
        "kq:princess", "geometry.kq_princess", "textures/entity/kq_princess",
        [{"cry": "!query.property('kq:happy')"}, {"happy": "query.property('kq:happy')"}],
        {"cry": "animation.kq_princess.cry", "happy": "animation.kq_princess.happy"}))
    write(os.path.join(RP, "entity", "golden_egg.entity.json"), client_entity(
        "kq:golden_egg", "geometry.kq_golden_egg", "textures/entity/kq_golden_egg", ["spin"],
        {"spin": "animation.kq_golden_egg.spin"}))
    # Graham: the Alpha Dog model and texture, without the giant Alpha's gear
    shutil.copy(os.path.join(ROOT, "addons", "AlphaDog_RP", "models", "entity", "alpha_dog.geo.json"),
                os.path.join(RP, "models", "entity", "kq_graham.geo.json"))
    g = json.load(open(os.path.join(RP, "models", "entity", "kq_graham.geo.json")))
    for geo in g["minecraft:geometry"]:
        geo["description"]["identifier"] = "geometry.kq_graham"
        geo["bones"] = [b for b in geo["bones"] if b["name"] != "alpha_gear"]
    write(os.path.join(RP, "models", "entity", "kq_graham.geo.json"), g)
    write(os.path.join(RP, "entity", "graham.entity.json"), client_entity(
        "kq:graham", "geometry.kq_graham", "textures/entity/kq_graham", [], {}))
    write(os.path.join(RP, "texts", "en_US.lang"), "\n".join([
        "entity.kq:princess.name=Princess", "entity.kq:golden_egg.name=Gold Egg", "entity.kq:graham.name=Graham",
        "item.kq:golden_egg=Gold Egg", "action.interact.kq_talk=Talk", "action.interact.kq_take=Take", "tile.kq:magic_barrier.name=Magic Barrier", "pack.name=Kingdom Quest",
        "pack.description=Find Graham!", ""]))
    write(os.path.join(RP, "texts", "languages.json"), ["en_US"])
    write(os.path.join(RP, "textures", "item_texture.json"), {
        "resource_pack_name": "kingdomquest", "texture_name": "atlas.items",
        "texture_data": {"kq_golden_egg": {"textures": "textures/items/kq_golden_egg"}}})
    write(os.path.join(RP, "textures", "terrain_texture.json"), {
        "resource_pack_name": "kingdomquest", "texture_name": "atlas.terrain", "padding": 8, "num_mip_levels": 4,
        "texture_data": {"kq_magic_barrier": {"textures": "textures/blocks/kq_magic_barrier"}}})
    write(os.path.join(RP, "textures", "flipbook_textures.json"), [
        {"flipbook_texture": "textures/blocks/kq_magic_barrier", "atlas_tile": "kq_magic_barrier", "ticks_per_frame": 3}])
    write(os.path.join(RP, "blocks.json"), {"format_version": "1.21.40", "kq:magic_barrier": {"sound": "glass"}})
    particles()
    textures()

def particle(ident, tex, n, life, speed, accel, size, shape, tint=None, facing="lookat_xyz", drag=0.0):
    comps = {
        "minecraft:emitter_rate_instant": {"num_particles": n},
        "minecraft:emitter_lifetime_once": {"active_time": 0},
        "minecraft:particle_lifetime_expression": {"max_lifetime": life},
        "minecraft:particle_initial_speed": speed,
        "minecraft:particle_motion_dynamic": {"linear_acceleration": accel, "linear_drag_coefficient": drag},
        "minecraft:particle_appearance_billboard": {"size": size, "facing_camera_mode": facing,
                                                    "uv": {"texture_width": 16, "texture_height": 16, "uv": [0, 0], "uv_size": [16, 16]}},
    }
    comps.update(shape)
    if tint:
        comps["minecraft:particle_appearance_tinting"] = {"color": tint}
    return {"format_version": "1.10.0", "particle_effect": {
        "description": {"identifier": ident, "basic_render_parameters": {"material": "particles_alpha", "texture": tex}},
        "components": comps}}

def particles():
    fade = "1 - variable.particle_age / variable.particle_lifetime"
    write(os.path.join(RP, "particles", "tear.json"), particle(
        "kq:tear", "textures/particle/kq_tear", 1, "0.9", 0.4, [0, -6, 0], [0.07, 0.09],
        {"minecraft:emitter_shape_point": {"direction": ["math.random(-0.3, 0.3)", 0.4, "math.random(-0.3, 0.3)"]}}))
    write(os.path.join(RP, "particles", "sparkle.json"), particle(
        "kq:sparkle", "textures/particle/kq_sparkle", 6, "0.8 + variable.particle_random_1 * 0.6", 0.6, [0, 0.3, 0],
        [f"0.12 * ({fade}) + 0.03", f"0.12 * ({fade}) + 0.03"],
        {"minecraft:emitter_shape_sphere": {"radius": 0.4, "direction": "outwards"}}, drag=2.0))
    write(os.path.join(RP, "particles", "pawprint.json"), particle(
        "kq:pawprint", "textures/particle/kq_pawprint", 1, "2.5", 0, [0, 0, 0], [0.22, 0.22],
        {"minecraft:emitter_shape_point": {}}, tint=[1, 1, 1, fade], facing="emitter_transform_xz"))

def textures():
    os.makedirs(os.path.join(RP, "textures", "entity"), exist_ok=True)
    shutil.copy(os.path.join(ROOT, "addons", "UnicornPrincess_RP", "textures", "entity", "unicorn_princess_0.png"),
                os.path.join(RP, "textures", "entity", "kq_princess.png"))
    shutil.copy(os.path.join(ROOT, "addons", "AlphaDog_RP", "textures", "entity", "alpha_dog.png"),
                os.path.join(RP, "textures", "entity", "kq_graham.png"))
    rainbow = [(230, 50, 50), (245, 140, 30), (250, 220, 40), (90, 200, 70), (70, 160, 240), (150, 80, 220)]
    # egg: gold, with a rainbow band round the middle
    egg = Image.new("RGBA", (64, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(egg)
    d.rectangle([0, 0, 63, 31], fill=(250, 200, 50, 255))
    for y in range(13, 21):
        for x in range(0, 24):
            egg.putpixel((x, y), rainbow[(x // 4) % 6] + (255,))
    for (x, y) in ((3, 6), (10, 8), (17, 7), (27, 2), (5, 22), (14, 24)):
        egg.putpixel((x, y), (255, 250, 220, 255))
    egg.save(os.path.join(RP, "textures", "entity", "kq_golden_egg.png"))
    os.makedirs(os.path.join(RP, "textures", "items"), exist_ok=True)
    icon(egg_pixels(True)).save(os.path.join(RP, "textures", "items", "kq_golden_egg.png"))
    # magic barrier: a shimmering purple-pink curtain, 8 frames
    os.makedirs(os.path.join(RP, "textures", "blocks"), exist_ok=True)
    fb = Image.new("RGBA", (16, 16 * 8))
    for f in range(8):
        for y in range(16):
            for x in range(16):
                s = math.sin((x + y) * 0.7 + f * 0.8) * 0.5 + 0.5
                t = math.sin((x - y) * 0.45 - f * 0.6) * 0.5 + 0.5
                r, g, b = int(170 + 70 * s), int(90 + 60 * t), 255
                a = int(120 + 80 * s * t)
                if (x * 7 + y * 3 + f * 5) % 23 == 0:
                    r, g, b, a = 255, 255, 255, 230
                fb.putpixel((x, y + 16 * f), (r, g, b, a))
    fb.save(os.path.join(RP, "textures", "blocks", "kq_magic_barrier.png"))
    os.makedirs(os.path.join(RP, "textures", "particle"), exist_ok=True)
    tear = Image.new("RGBA", (16, 16)); dt = ImageDraw.Draw(tear)
    dt.polygon([(8, 1), (13, 10), (8, 15), (3, 10)], fill=(120, 190, 255, 255)); dt.ellipse([4, 7, 12, 15], fill=(120, 190, 255, 255))
    tear.save(os.path.join(RP, "textures", "particle", "kq_tear.png"))
    sp = Image.new("RGBA", (16, 16)); ds = ImageDraw.Draw(sp)
    ds.polygon([(8, 0), (10, 6), (16, 8), (10, 10), (8, 16), (6, 10), (0, 8), (6, 6)], fill=(255, 225, 90, 255))
    ds.ellipse([6, 6, 10, 10], fill=(255, 255, 230, 255))
    sp.save(os.path.join(RP, "textures", "particle", "kq_sparkle.png"))
    paw = Image.new("RGBA", (16, 16)); dp = ImageDraw.Draw(paw)
    draw_paw(dp, 0, 0, 16, (255, 200, 60, 255))
    paw.save(os.path.join(RP, "textures", "particle", "kq_pawprint.png"))
    glyphs()

def egg_pixels(full):
    img = Image.new("RGBA", (16, 16)); d = ImageDraw.Draw(img)
    if full:
        d.ellipse([3, 1, 12, 15], fill=(250, 200, 50, 255), outline=(170, 110, 20, 255))
        for i, c in enumerate([(230, 50, 50), (250, 160, 40), (90, 200, 70), (70, 160, 240)]):
            d.line([(4, 8 + i // 2), (11, 8 + i // 2)], fill=c + (255,)) if i % 2 == 0 else None
        d.point([(6, 4), (7, 3)], fill=(255, 255, 230, 255))
    else:
        d.ellipse([3, 1, 12, 15], outline=(150, 150, 150, 255), width=1)
    return img

def icon(img):
    return img

def draw_paw(d, ox, oy, s, col):
    k = s / 16.0
    d.ellipse([ox + 4 * k, oy + 7 * k, ox + 12 * k, oy + 14 * k], fill=col)
    for (x, y) in ((2, 4), (6, 1.5), (10, 1.5), (14, 4)):
        d.ellipse([ox + (x - 1.8) * k, oy + (y - 1.8) * k, ox + (x + 1.8) * k, oy + (y + 1.8) * k], fill=col)

def face(d, ox, oy, skin, hair, crown, sad):
    d.ellipse([ox + 2, oy + 2, ox + 13, oy + 15], fill=skin)
    d.rectangle([ox + 2, oy + 2, ox + 13, oy + 6], fill=hair)
    d.polygon([(ox + 4, oy + 3), (ox + 5, oy), (ox + 7, oy + 2), (ox + 8, oy), (ox + 10, oy + 2), (ox + 11, oy), (ox + 12, oy + 3)], fill=crown)
    d.point([(ox + 5, oy + 9), (ox + 10, oy + 9)], fill=(40, 30, 60, 255))
    if sad:
        d.line([(ox + 6, oy + 13), (ox + 9, oy + 12)], fill=(120, 40, 60, 255))
        d.line([(ox + 6, oy + 12), (ox + 9, oy + 13)], fill=(120, 40, 60, 255)) if False else None
        d.point([(ox + 5, oy + 11), (ox + 10, oy + 11), (ox + 10, oy + 12)], fill=(100, 170, 255, 255))
    else:
        d.arc([ox + 5, oy + 10, ox + 10, oy + 13], 0, 180, fill=(160, 40, 60, 255))

def glyphs():
    """Little pictures for the story pages: font/glyph_E1.png, 16 x 16 cells of 16 px (\\uE100 = cell 0)."""
    sheet = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    def cell(n):
        return (n % 16) * 16, (n // 16) * 16
    sheet.paste(egg_pixels(True), cell(0))
    sheet.paste(egg_pixels(False), cell(1))
    d = ImageDraw.Draw(sheet)
    ox, oy = cell(2)                                                # Graham
    d.ellipse([ox + 2, oy + 3, ox + 13, oy + 14], fill=(30, 30, 35, 255))
    d.polygon([(ox + 2, oy + 6), (ox + 1, oy), (ox + 6, oy + 3)], fill=(30, 30, 35, 255))       # ear up
    d.polygon([(ox + 10, oy + 3), (ox + 15, oy + 4), (ox + 14, oy + 9)], fill=(30, 30, 35, 255))  # floppy ear
    d.rectangle([ox + 6, oy + 9, ox + 9, oy + 12], fill=(240, 240, 240, 255))
    d.point([(ox + 5, oy + 7), (ox + 10, oy + 7)], fill=(255, 255, 255, 255))
    d.rectangle([ox + 3, oy + 13, ox + 12, oy + 15], fill=(245, 130, 30, 255))
    face(d, *cell(3), (255, 220, 190, 255), (240, 200, 90, 255), (250, 200, 50, 255), True)
    face(d, *cell(4), (255, 220, 190, 255), (240, 200, 90, 255), (250, 200, 50, 255), False)
    ox, oy = cell(5)                                                # heart
    d.polygon([(ox + 8, oy + 14), (ox + 1, oy + 7), (ox + 3, oy + 2), (ox + 8, oy + 5), (ox + 13, oy + 2), (ox + 15, oy + 7)],
              fill=(240, 60, 110, 255))
    draw_paw(d, *cell(6), 16, (255, 190, 60, 255))
    ox, oy = cell(7)                                                # ice palace
    d.rectangle([ox + 3, oy + 7, ox + 12, oy + 15], fill=(200, 230, 255, 255))
    for x in (2, 7, 12):
        d.polygon([(ox + x, oy + 8), (ox + x + 1.5, oy + 1), (ox + x + 3, oy + 8)], fill=(110, 180, 240, 255))
    os.makedirs(os.path.join(RP, "font"), exist_ok=True)
    sheet.save(os.path.join(RP, "font", "glyph_E1.png"))

def ui_icons():
    """Big pictures for the page buttons (so she can tap them without reading): next, back, yes, egg, help."""
    out = os.path.join(RP, "textures", "kq_ui")
    os.makedirs(out, exist_ok=True)
    def arrow(flip):
        img = Image.new("RGBA", (32, 32)); d = ImageDraw.Draw(img)
        pts = [(6, 11), (17, 11), (17, 4), (28, 16), (17, 28), (17, 21), (6, 21)]
        if flip:
            pts = [(32 - x, y) for x, y in pts]
        d.polygon(pts, fill=(90, 200, 90, 255) if not flip else (150, 150, 220, 255), outline=(30, 90, 30, 255) if not flip else (60, 60, 140, 255))
        return img
    arrow(False).save(os.path.join(out, "next.png"))
    arrow(True).save(os.path.join(out, "back.png"))
    heart = Image.new("RGBA", (32, 32)); d = ImageDraw.Draw(heart)
    d.polygon([(16, 28), (3, 14), (5, 5), (16, 10), (27, 5), (29, 14)], fill=(240, 60, 110, 255), outline=(150, 20, 60, 255))
    heart.save(os.path.join(out, "yes.png"))
    egg_pixels(True).resize((32, 32), Image.NEAREST).save(os.path.join(out, "egg.png"))
    q = Image.new("RGBA", (32, 32)); d = ImageDraw.Draw(q)
    d.ellipse([2, 2, 29, 29], fill=(80, 160, 240, 255), outline=(30, 80, 160, 255), width=2)
    d.arc([10, 7, 22, 18], 180, 360, fill=(255, 255, 255, 255), width=3)
    d.line([(21, 13), (16, 18), (16, 21)], fill=(255, 255, 255, 255), width=3)
    d.rectangle([15, 24, 17, 26], fill=(255, 255, 255, 255))
    q.save(os.path.join(out, "help.png"))
    paw = Image.new("RGBA", (32, 32)); draw_paw(ImageDraw.Draw(paw), 0, 0, 32, (255, 190, 60, 255))
    paw.save(os.path.join(out, "paw.png"))

def pack_icons():
    for root in (BP, RP):
        img = Image.new("RGBA", (64, 64), (120, 190, 250, 255))
        d = ImageDraw.Draw(img)
        d.ellipse([16, 8, 48, 58], fill=(250, 200, 50, 255), outline=(170, 110, 20, 255), width=2)
        for i, c in enumerate([(230, 50, 50), (250, 160, 40), (90, 200, 70), (70, 160, 240)]):
            d.rectangle([17, 30 + i * 3, 47, 32 + i * 3], fill=c)
        img.save(os.path.join(root, "pack_icon.png"))

def main():
    manifests()
    behaviour()
    resources()
    ui_icons()
    pack_icons()
    print("Kingdom Quest packs written to", os.path.normpath(BP), "and", os.path.normpath(RP))

if __name__ == "__main__":
    main()
