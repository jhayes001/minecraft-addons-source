"""Builds the Kingdom Quest add-on (the story for the Princess Kingdom world): everything except
the script (addons/KingdomQuest_BP/scripts/main.js) and the world data
(addons/KingdomQuest_BP/scripts/kingdom_data.js, written by make_princess_world.py).

  - kq:princess   the princess on her throne: the seated princess from Unicorn Princess, crying
                  (hands to her face, head down) until her quest is done, then waving happily
  - kq:graham     Graham, the same dog as Alpha Dog (for the end of the story; not placed yet)
  - kq:clerk      the inn keepers (five looks)
  - kq:magic_barrier  an unbreakable shimmering wall that closes a road or gate until the story opens it
  - particles: tears, gold sparkles, glowing paw prints
  - font/glyph_E1.png: little pictures for the story pages (egg, empty egg, Graham, princess sad and
    happy, heart, paw print, ice palace, bed, moon, inn, hen, fence, seeds), used in text as \\uE100 ... \\uE10D

Usage: python3 tools/make_kingdom_quest.py
"""
import json, math, os, shutil
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
BP = os.path.join(ROOT, "addons", "KingdomQuest_BP")
RP = os.path.join(ROOT, "addons", "KingdomQuest_RP")
VERSION = [1, 2, 0]
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
        "header": {"name": "Kingdom Quest (Resources)", "description": "The princess, Graham, inn keepers and magic barriers",
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
    write(os.path.join(BP, "entities", "graham.json"), npc("kq:graham", 0.8, 0.9, "kq_graham"))
    write(os.path.join(BP, "entities", "clerk.json"),
          npc("kq:clerk", 0.6, 1.8, "kq_clerk", {"kq:look": {"type": "int", "range": [0, 4], "client_sync": True, "default": 0}}, "talk"))
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
        "animation.kq_clerk.idle": {"loop": True, "bones": {
            "head": {"rotation": ["math.sin(query.life_time * 60) * 4", "math.sin(query.life_time * 35) * 20", 0]},
            "right_arm": {"rotation": ["math.sin(query.life_time * 90) * 5", 0, "4 + math.sin(query.life_time * 90) * 2"]},
            "left_arm": {"rotation": ["-math.sin(query.life_time * 90) * 5", 0, "-4 - math.sin(query.life_time * 90) * 2"]}}}}}

def client_entity(identifier, geometry, texture, animate, anims):
    return {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": identifier, "materials": {"default": "entity_alphatest"},
        "textures": {"default": texture}, "geometry": {"default": geometry},
        "animations": anims, "scripts": {"animate": animate},
        "render_controllers": ["controller.render.default"]}}}

# the inn keepers: (name, skin, hair, hair style, shirt, apron, pants, shoes, eyes)
CLERKS = [
    ("Rosie", (250, 214, 190), (200, 90, 60), "long", (245, 150, 185), (255, 255, 255), (120, 80, 140), (90, 50, 40), (60, 130, 220)),
    ("Bo", (230, 190, 150), (60, 40, 30), "short", (110, 180, 230), (240, 240, 250), (60, 70, 120), (40, 40, 50), (70, 50, 30)),
    ("Kit", (200, 150, 110), (30, 25, 25), "bun", (250, 160, 50), (255, 240, 200), (100, 70, 50), (70, 40, 30), (60, 40, 30)),
    ("Max", (170, 115, 80), (240, 240, 235), "short", (170, 40, 40), (120, 85, 55), (60, 50, 40), (40, 30, 25), (50, 40, 30)),
    ("Lulu", (255, 225, 200), (250, 220, 110), "long", (250, 225, 90), (255, 255, 255), (90, 160, 220), (240, 240, 240), (80, 170, 110)),
]

def clerk_geometry():
    """A plain player-shaped person (64 x 64 skin layout)."""
    parts = [("body", [0, 24, 0], [-4, 12, -2], [8, 12, 4], [16, 16]),
             ("head", [0, 24, 0], [-4, 24, -4], [8, 8, 8], [0, 0]),
             ("right_arm", [-5, 22, 0], [-8, 12, -2], [4, 12, 4], [40, 16]),
             ("left_arm", [5, 22, 0], [4, 12, -2], [4, 12, 4], [32, 48]),
             ("right_leg", [-1.9, 12, 0], [-3.9, 0, -2], [4, 12, 4], [0, 16]),
             ("left_leg", [1.9, 12, 0], [-0.1, 0, -2], [4, 12, 4], [16, 48])]
    bones = [{"name": "root", "pivot": [0, 0, 0]}]
    for name, pivot, origin, size, uv in parts:
        bones.append({"name": name, "parent": "root", "pivot": pivot, "cubes": [{"origin": origin, "size": size, "uv": uv}]})
    return {"format_version": "1.12.0", "minecraft:geometry": [{"description": {
        "identifier": "geometry.kq_clerk", "texture_width": 64, "texture_height": 64,
        "visible_bounds_width": 2, "visible_bounds_height": 3, "visible_bounds_offset": [0, 1.5, 0]}, "bones": bones}]}

def box_faces(u, v, w, h, d):
    """Where each face of a box-UV cube is on the texture: name -> (x, y, width, height)."""
    return {"top": (u + d, v, w, d), "bottom": (u + d + w, v, w, d), "right": (u, v + d, d, h),
            "front": (u + d, v + d, w, h), "left": (u + d + w, v + d, d, h), "back": (u + 2 * d + w, v + d, w, h)}

def clerk_skin(skin, hair, style, shirt, apron, pants, shoes, eyes):
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    def fill(box, col):
        x, y, w_, h_ = box
        d.rectangle([x, y, x + w_ - 1, y + h_ - 1], fill=col + (255,))
    head = box_faces(0, 0, 8, 8, 8)
    for f in head.values():
        fill(f, skin)
    fill(head["top"], hair); fill(head["back"], hair)
    for side in ("right", "left"):
        x, y, w_, h_ = head[side]
        fill((x, y, w_, 8 if style == "long" else 3), hair)
    fx, fy = head["front"][:2]
    fill((fx, fy, 8, 2), hair)                                            # fringe
    if style == "long":
        fill((fx, fy + 2, 1, 6), hair); fill((fx + 7, fy + 2, 1, 6), hair)
    if style == "bun":
        fill((head["top"][0] + 3, head["top"][1] + 3, 2, 2), tuple(max(0, c - 30) for c in hair))
    for ex in (1, 5):                                                     # eyes, cheeks, smile
        d.point((fx + ex, fy + 4), fill=(255, 255, 255, 255))
        d.point((fx + ex + 1, fy + 4), fill=eyes + (255,))
    d.point([(fx + 1, fy + 5), (fx + 6, fy + 5)], fill=(245, 150, 160, 255))
    d.line([(fx + 3, fy + 6), (fx + 4, fy + 6)], fill=(170, 70, 80, 255))
    d.point([(fx + 2, fy + 5), (fx + 5, fy + 5)], fill=skin + (255,))
    body = box_faces(16, 16, 8, 12, 4)
    for f in body.values():
        fill(f, shirt)
    bx, by = body["front"][:2]
    fill((bx + 1, by + 4, 6, 8), apron)                                  # apron
    d.line([(bx + 2, by), (bx + 2, by + 4)], fill=apron + (255,)); d.line([(bx + 5, by), (bx + 5, by + 4)], fill=apron + (255,))
    if style == "long":
        x, y, w_, h_ = body["back"]
        fill((x, y, w_, 5), hair)
    for (u, v) in ((40, 16), (32, 48)):
        arm = box_faces(u, v, 4, 12, 4)
        for f in arm.values():
            x, y, w_, h_ = f
            fill(f, skin)
            if h_ == 12:
                fill((x, y, w_, 4), shirt)
        fill(arm["top"], shirt)
    for (u, v) in ((0, 16), (16, 48)):
        leg = box_faces(u, v, 4, 12, 4)
        for f in leg.values():
            x, y, w_, h_ = f
            fill(f, pants)
            if h_ == 12:
                fill((x, y + 10, w_, 2), shoes)
        fill(leg["bottom"], shoes)
    return img

def resources():
    write(os.path.join(RP, "models", "entity", "kq_princess.geo.json"), princess_geometry())
    write(os.path.join(RP, "animations", "kq.animation.json"), animations())
    pe = client_entity(
        "kq:princess", "geometry.kq_princess", "textures/entity/kq_princess",
        [{"cry": "!query.property('kq:happy')"}, {"happy": "query.property('kq:happy')"}],
        {"cry": "animation.kq_princess.cry", "happy": "animation.kq_princess.happy"})
    d = pe["minecraft:client_entity"]["description"]
    d["textures"] = {"happy": "textures/entity/kq_princess", "sad": "textures/entity/kq_princess_sad"}
    d["render_controllers"] = ["controller.render.kq_princess"]
    write(os.path.join(RP, "entity", "princess.entity.json"), pe)
    write(os.path.join(RP, "render_controllers", "kq.render_controllers.json"), {
        "format_version": "1.8.0", "render_controllers": {"controller.render.kq_princess": {
            "arrays": {"textures": {"Array.faces": ["Texture.sad", "Texture.happy"]}},
            "geometry": "Geometry.default", "materials": [{"*": "Material.default"}],
            "textures": ["Array.faces[query.property('kq:happy') ? 1 : 0]"]},
        "controller.render.kq_clerk": {
            "arrays": {"textures": {"Array.looks": ["Texture.c%d" % i for i in range(len(CLERKS))]}},
            "geometry": "Geometry.default", "materials": [{"*": "Material.default"}],
            "textures": ["Array.looks[query.property('kq:look')]"]}}})
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
    write(os.path.join(RP, "models", "entity", "kq_clerk.geo.json"), clerk_geometry())
    ce = client_entity("kq:clerk", "geometry.kq_clerk", "textures/entity/kq_clerk_0", ["idle"],
                       {"idle": "animation.kq_clerk.idle"})
    d = ce["minecraft:client_entity"]["description"]
    d["textures"] = {"c%d" % i: "textures/entity/kq_clerk_%d" % i for i in range(len(CLERKS))}
    d["render_controllers"] = ["controller.render.kq_clerk"]
    write(os.path.join(RP, "entity", "clerk.entity.json"), ce)
    write(os.path.join(RP, "texts", "en_US.lang"), "\n".join([
        "entity.kq:princess.name=Princess", "entity.kq:graham.name=Graham", "entity.kq:clerk.name=Inn Keeper",
        "action.interact.kq_talk=Talk", "tile.kq:magic_barrier.name=Magic Barrier", "pack.name=Kingdom Quest",
        "pack.description=Find Graham!", ""]))
    write(os.path.join(RP, "texts", "languages.json"), ["en_US"])
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
    paw = particle(
        "kq:pawprint", "textures/particle/kq_pawprint", 1, "2.5", 0, [0, 0, 0], [0.22, 0.22],
        {"minecraft:emitter_shape_point": {}}, tint=[1, 1, 1, fade], facing="emitter_transform_xz")
    paw["particle_effect"]["components"]["minecraft:particle_appearance_billboard"]["uv"] = {
        "texture_width": 128, "texture_height": 16, "uv": ["math.mod(math.round(variable.dir), 8) * 16", 0], "uv_size": [16, 16]}
    write(os.path.join(RP, "particles", "pawprint.json"), paw)

def textures():
    os.makedirs(os.path.join(RP, "textures", "entity"), exist_ok=True)
    shutil.copy(os.path.join(ROOT, "addons", "UnicornPrincess_RP", "textures", "entity", "unicorn_princess_0.png"),
                os.path.join(RP, "textures", "entity", "kq_princess.png"))
    # the sad face: her smile turned upside down, and tears under her eyes (face = 14 x 14 at 26, 16)
    sad = Image.open(os.path.join(RP, "textures", "entity", "kq_princess.png")).convert("RGBA")
    fu, fv = 26, 16
    skin, lip, tear = sad.getpixel((fu + 6, fv + 12)), sad.getpixel((fu + 5, fv + 10)), (130, 200, 255, 255)
    for (x, y) in ((5, 10), (8, 10), (6, 11), (7, 11)):
        sad.putpixel((fu + x, fv + y), skin)
    for (x, y) in ((6, 10), (7, 10), (5, 11), (8, 11)):
        sad.putpixel((fu + x, fv + y), lip)
    for (x, y) in ((3, 9), (3, 10), (10, 9), (10, 10), (10, 11)):
        sad.putpixel((fu + x, fv + y), tear)
    brow = sad.getpixel((fu + 3, fv + 5))                              # brows tilted up in the middle
    for (x, y) in ((2, 4), (11, 4)):
        sad.putpixel((fu + x, fv + y), skin)
    for (x, y) in ((5, 4), (8, 4)):
        sad.putpixel((fu + x, fv + y), brow)
    sad.save(os.path.join(RP, "textures", "entity", "kq_princess_sad.png"))
    shutil.copy(os.path.join(ROOT, "addons", "AlphaDog_RP", "textures", "entity", "alpha_dog.png"),
                os.path.join(RP, "textures", "entity", "kq_graham.png"))
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
    # paw prints lie flat on the ground, in 8 headings (frame k points 45 * k degrees clockwise from north).
    # Flat particles show their image with its top toward +z (south) and its right toward +x (east).
    big = Image.new("RGBA", (64, 64)); draw_paw(ImageDraw.Draw(big), 8, 8, 48, (255, 200, 60, 255))
    strip = Image.new("RGBA", (16 * 8, 16))
    for k in range(8):
        a = math.radians(45 * k)
        hx, hz = math.sin(a), -math.cos(a)                 # heading in the world (north is -z)
        tx, ty = hx, -hz                                   # the toes' direction in the image
        frame = big.rotate(math.degrees(math.atan2(-tx, -ty)), resample=Image.BICUBIC).resize((16, 16), Image.LANCZOS)
        strip.paste(frame, (16 * k, 0))
    strip.save(os.path.join(RP, "textures", "particle", "kq_pawprint.png"))
    for i, c in enumerate(CLERKS):
        clerk_skin(*c[1:]).save(os.path.join(RP, "textures", "entity", "kq_clerk_%d.png" % i))
    glyphs()

def egg_pixels(full):
    """A chicken egg (or an empty outline of one)."""
    img = Image.new("RGBA", (16, 16)); d = ImageDraw.Draw(img)
    if full:
        d.ellipse([3, 1, 12, 15], fill=(240, 222, 190, 255), outline=(170, 140, 100, 255))
        d.point([(6, 6), (9, 9), (7, 11), (10, 5)], fill=(200, 170, 130, 255))
        d.point([(6, 3), (5, 4)], fill=(255, 250, 240, 255))
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
        d.arc([ox + 5, oy + 11, ox + 10, oy + 15], 180, 360, fill=(160, 40, 60, 255))   # a frown
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
    ox, oy = cell(8)                                                # bed
    d.rectangle([ox + 1, oy + 8, ox + 14, oy + 12], fill=(230, 60, 80, 255))
    d.rectangle([ox + 1, oy + 6, ox + 5, oy + 9], fill=(255, 255, 255, 255))
    d.rectangle([ox + 1, oy + 4, ox + 2, oy + 15], fill=(140, 90, 50, 255)); d.rectangle([ox + 13, oy + 8, ox + 14, oy + 15], fill=(140, 90, 50, 255))
    ox, oy = cell(9)                                                # moon and star
    d.ellipse([ox + 2, oy + 2, ox + 13, oy + 13], fill=(255, 235, 140, 255))
    d.ellipse([ox + 6, oy, ox + 16, oy + 10], fill=(0, 0, 0, 0))
    d.point([(ox + 13, oy + 12), (ox + 12, oy + 13), (ox + 14, oy + 13), (ox + 13, oy + 14)], fill=(255, 255, 200, 255))
    ox, oy = cell(10)                                               # inn (a little house)
    d.polygon([(ox, oy + 7), (ox + 8, oy), (ox + 15, oy + 7)], fill=(230, 80, 90, 255))
    d.rectangle([ox + 2, oy + 7, ox + 13, oy + 15], fill=(235, 200, 160, 255))
    d.rectangle([ox + 7, oy + 10, ox + 9, oy + 15], fill=(120, 70, 40, 255))
    d.rectangle([ox + 3, oy + 9, ox + 5, oy + 11], fill=(150, 200, 250, 255)); d.rectangle([ox + 11, oy + 9, ox + 13, oy + 11], fill=(150, 200, 250, 255))
    ox, oy = cell(11)                                               # hen
    d.ellipse([ox + 2, oy + 6, ox + 13, oy + 14], fill=(250, 250, 250, 255), outline=(180, 180, 180, 255))
    d.ellipse([ox + 9, oy + 2, ox + 14, oy + 8], fill=(250, 250, 250, 255), outline=(180, 180, 180, 255))
    d.rectangle([ox + 10, oy, ox + 12, oy + 2], fill=(220, 40, 40, 255))
    d.polygon([(ox + 14, oy + 4), (ox + 16, oy + 5), (ox + 14, oy + 6)], fill=(250, 170, 40, 255))
    d.point((ox + 12, oy + 4), fill=(20, 20, 20, 255))
    d.line([(ox + 6, oy + 14), (ox + 6, oy + 15)], fill=(250, 170, 40, 255)); d.line([(ox + 9, oy + 14), (ox + 9, oy + 15)], fill=(250, 170, 40, 255))
    ox, oy = cell(12)                                               # fence
    for x in (1, 7, 13):
        d.rectangle([ox + x, oy + 2, ox + x + 2, oy + 15], fill=(170, 125, 75, 255))
    for yy in (5, 10):
        d.rectangle([ox, oy + yy, ox + 15, oy + yy + 1], fill=(140, 100, 60, 255))
    ox, oy = cell(13)                                               # seeds
    for (x, y_) in ((4, 6), (8, 4), (11, 8), (6, 10), (10, 12)):
        d.ellipse([ox + x - 1, oy + y_ - 2, ox + x + 1, oy + y_ + 2], fill=(110, 170, 60, 255))
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
