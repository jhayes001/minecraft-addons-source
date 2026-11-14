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
    happy, heart, paw print, ice palace, bed, moon, inn, hen, fence, seeds, log, planks, crafting table, stick,
    gate, axe, book), used in text as \\uE100 ... \\uE114
  - kq:guide      the How-To Book the princess gives you: use it for help with whatever you're doing

Usage: python3 tools/make_kingdom_quest.py
"""
import colorsys, json, math, os, shutil
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
BP = os.path.join(ROOT, "addons", "KingdomQuest_BP")
RP = os.path.join(ROOT, "addons", "KingdomQuest_RP")
VERSION = [1, 6, 0]
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
                         {"module_name": "@minecraft/server", "version": "1.19.0"}]})
    write(os.path.join(RP, "manifest.json"), {
        "format_version": 2,
        "header": {"name": "Kingdom Quest (Resources)", "description": "The princess, Graham, inn keepers and magic barriers",
                   "uuid": UUID["rp"], "version": VERSION, "min_engine_version": MIN_ENGINE},
        "modules": [{"type": "resources", "uuid": UUID["rp_res"], "version": VERSION}]})

# ---------------------------------------------------------------- behaviour definitions
# where the character sits in the picture beside the words in a talking window (NPC dialogue)
PORTRAIT = {"person": {"portrait_offsets": {"translate": [-7, 50, 0], "scale": [1.75, 1.75, 1.75]},
                       "picker_offsets": {"translate": [0, 20, 0], "scale": [1.7, 1.7, 1.7]}},
            "princess": {"portrait_offsets": {"translate": [-7, 42, 0], "scale": [2.0, 2.0, 2.0]},
                         "picker_offsets": {"translate": [0, 20, 0], "scale": [1.7, 1.7, 1.7]}},
            "book": {"portrait_offsets": {"translate": [-7, 30, 0], "scale": [4.0, 4.0, 4.0]},
                     "picker_offsets": {"translate": [0, 10, 0], "scale": [3.0, 3.0, 3.0]}}}

def npc(identifier, width, height, family, props=None, button=None, talker=None):
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
            "interact_text": "action.interact.kq_" + button}]}} if button and not talker else {}),
        # characters that talk in Minecraft's own talking window, with their picture beside the words
        **({"minecraft:npc": {"npc_data": dict(PORTRAIT[talker], skin_list=[{"variant": 0}])}} if talker else {})}}}

# ---------------------------------------------------------------- the story (NPC dialogue scenes)
# Everything the characters say. Each page is a scene in Minecraft's talking window, with the character's picture
# beside the words; Next / Back buttons open the next or last page, and buttons that do something (say yes, hand in
# eggs) tell the script with /scriptevent kq:act <what>. Pages with numbers in (eggs so far) come in every version
# the script might need, since a scene's words are fixed.
GLYPH = {n: chr(0xE100 + i) for i, n in enumerate(
    ("egg noEgg graham sad happy heart paw ice bed moon inn hen fence seeds log planks table stick gate axe book next back "
     "snowEgg iceSad iceHappy bridge river").split())}
EGG_NEEDS = [5, 10, 15, 20]                         # 5 for each player, counted up to 4 players
NEXT = "§l§2Next " + GLYPH["next"]
BACK = "§l§1" + GLYPH["back"] + " Back"

def open_cmd(scene):
    return "/dialogue open @s @initiator " + scene

def act(what):
    return "/execute as @initiator run scriptevent kq:act " + what

def page(*parts):
    """A page: a line of pictures, then bold lines (an empty string is a blank line)."""
    pics, lines = parts[0], parts[1:]
    return " ".join(GLYPH[g] for g in pics.split()) + "\n\n" + "\n".join("§l" + l if l else "" for l in lines)

def egg_rows(have, need):
    rows = []
    for i in range(0, need, 5):
        rows.append(" ".join(GLYPH["egg" if k < have else "noEgg"] for k in range(i, min(i + 5, need))))
    return "\n".join(rows)

def story():
    scenes = []
    def scene(tag, name, text, buttons):
        scenes.append({"scene_tag": tag, "npc_name": name, "text": text,
                       "buttons": [{"name": n, "commands": c if isinstance(c, list) else [c]} for n, c in buttons]})
    def chain(prefix, name, pages, last_buttons, first_back=None, next_of=None):
        for i, text in enumerate(pages):
            buttons = []
            if i < len(pages) - 1:
                buttons.append((NEXT, (next_of or {}).get(i, open_cmd("%s_%d" % (prefix, i + 2)))))
            else:
                buttons += last_buttons
            if i > 0:
                buttons.append((BACK, open_cmd("%s_%d" % (prefix, i))))
            elif first_back:
                buttons.append((BACK, open_cmd(first_back)))
            scene("%s_%d" % (prefix, i + 1), name, text, buttons)
    OK = ("§lOK", act("close"))
    sad, happy = GLYPH["sad"] + " Princess Buttercup", GLYPH["happy"] + " Princess Buttercup"
    # --- the princess: the first meeting (the last page says how many eggs, for 1 to 4 players)
    chain("kq_p_intro", sad, [
        page("sad", "Boo hoo!", "", "I am so sad."),
        page("graham", "My dog Graham is lost!"),
        page("graham hen hen", "Graham ran after my hens.", "", "Now my hens are all over!"),
        page("graham", "Then Graham ran far away."),
        page("fence hen fence", "Can you make a pen", "for my hens?"),
    ], [], next_of={4: act("intro6")})
    scenes[-1]["buttons"].insert(0, {"name": NEXT, "commands": [act("intro6")]})
    for n in EGG_NEEDS:
        scene("kq_p_intro_6_%d" % n, sad, egg_rows(n, n) + "\n\n§lThen bring me %d eggs.\n\n§lWill you help me?" % n,
              [("§l§dYes! I will help!", act("yes")), (BACK, open_cmd("kq_p_intro_5"))])
    chain("kq_p_thanks", sad, [
        page("heart", "Thank you!"),
        page("book", "Here is my How-To Book.", "", "Tap it when you need help!"),
        page("hen fence", "Go to the hen house", "by the road.", "", "Make a pen for my hens!"),
    ], [OK])
    scene("kq_p_newbook", sad, page("book", "Here is a new How-To Book.", "", "Tap it when you need help!"), [OK])
    HELP = ("§l§9Help me! " + GLYPH["book"], act("guide"))
    scene("kq_p_pen_none", sad, page("fence hen fence", "Make a pen", "round the hen house.", "", "Get 3 hens in it."), [OK, HELP])
    for h in range(3):
        hens = " ".join([GLYPH["hen"]] * h + ["§7" + GLYPH["hen"] + "§r"] * (3 - h))
        more = 3 - h
        scene("kq_p_pen_h%d" % h, sad, GLYPH["fence"] + " " + hens + "\n\n§lGood pen!\n\n§lGet %d more hen%s in." % (more, "" if more == 1 else "s"),
              [OK, HELP])
    for n in EGG_NEEDS:
        for g in range(n):
            left = n - g
            more = "§lBring me %d more egg%s!" % (left, "" if left == 1 else "s")
            scene("kq_p_eggs_%d_%d" % (g, n), sad, egg_rows(g, n) + "\n\n§lThe hens are in the pen!\n\n" + more, [OK, HELP])
            scene("kq_p_handin_%d_%d" % (g, n), sad, egg_rows(g, n) + "\n\n§lYou have eggs for me!", [("§l§dHere you go! " + GLYPH["egg"], act("give"))])
            if g:
                scene("kq_p_more_%d_%d" % (g, n), sad, egg_rows(g, n) + "\n\n§lThank you!\n\n" + more, [OK])
    chain("kq_p_happy", happy, [
        page("happy", "Hooray!", "", "The magic gate is open!"),
        page("graham ice", "Graham went to", "the Ice Palace!"),
        page("iceSad", "Princess Snowdrop lives there.", "", "She needs help too.", "Go and find her!"),
    ], [("§l§dLet's go! " + GLYPH["paw"], act("close"))])
    # --- Princess Snowdrop of the Ice Palace (quest 2: the bridge)
    snow, snow_happy = GLYPH["iceSad"] + " Princess Snowdrop", GLYPH["iceHappy"] + " Princess Snowdrop"
    chain("kq_s_intro", snow, [
        page("iceSad", "Boo hoo!", "", "I am Princess Snowdrop."),
        page("river", "A big block of ice melted.", "", "Now there is a river!"),
        page("river", "The river cut the road", "to the other castles."),
        page("snowEgg", "My snow golem egg", "is on the other side!"),
        page("graham", "And I saw a little dog.", "", "He ran over the ice", "before it melted!"),
        page("bridge", "Can you make a bridge", "and get my egg?"),
    ], [("§l§dYes! I will help!", act("ice_yes"))])
    chain("kq_s_thanks", snow, [
        page("heart", "Thank you!"),
        page("river", "Go out of my gate", "and down the road.", "", "Turn left.", "Find the river!"),
    ], [OK])
    scene("kq_s_wait", snow, page("bridge snowEgg", "Make a bridge", "over the river.", "", "Get my egg", "from the chest."), [OK, HELP])
    scene("kq_s_handin", snow, page("snowEgg", "My snow golem egg!", "", "You found it!"), [("§l§dHere you go! " + GLYPH["snowEgg"], act("ice_give"))])
    scene("kq_s_hello", snow, page("iceSad", "Hello!", "", "Please help", "Princess Buttercup first."), [OK])
    chain("kq_s_happy", snow_happy, [
        page("iceHappy", "Look! The egg hatched!", "", "A snow golem!"),
        page("graham", "Graham ran to", "Blaze Castle."),
        page("paw", "The magic gate is open.", "", "Go and find him!"),
    ], [("§l§dLet's go! " + GLYPH["paw"], act("close"))])
    # --- the How-To Book: one step per page (the script opens it at your step)
    book = GLYPH["book"] + " How-To Book"
    steps = [
        page("axe", "Get an axe", "from the chest", "at the hen house."),
        page("axe log", "Chop the trees", "by the hen house.", "", "Hold down on the wood.", "Get 10 logs!"),
        page("log planks", "Open your bag.", "Make planks.", "", "1 log makes 4 planks."),
        page("planks table", "Make a crafting table.", "", "It takes 4 planks."),
        page("table", "Put the crafting table", "on the ground.", "", "Tap it to open it."),
        page("planks stick", "Make sticks.", "", "2 planks make 4 sticks."),
        page("planks stick fence", "Make fences at the", "crafting table.", "", "4 planks and 2 sticks", "make 3 fences.", "Make about 16!"),
        page("stick planks gate", "Make a gate.", "", "4 sticks and 2 planks", "make a gate."),
        page("fence hen gate", "Put the fences all", "round the hen house.", "", "Put the gate in the fence.", "No gaps!"),
        page("seeds hen hen hen", "Hold seeds.", "The hens follow you!", "", "Lead 3 hens in.", "Then shut the gate!"),
    ]
    for i, text in enumerate(steps):
        buttons = [(NEXT, open_cmd("kq_b_step_%d" % (i + 1)))] if i < len(steps) - 1 else [OK]
        if i:
            buttons.append((BACK, open_cmd("kq_b_step_%d" % (i - 1))))
        scene("kq_b_step_%d" % i, book, text, buttons)
    scene("kq_b_more", book, page("axe fence", "Is there a gap?", "", "Chop more wood.", "Make more fences!"),
          [(NEXT, open_cmd("kq_b_step_9")), (BACK, open_cmd("kq_b_step_8"))])
    scene("kq_b_welcome", book, page("sad", "The princess is sad.", "", "Go to her castle", "and find her!"), [OK])
    scene("kq_b_find", book, page("sad", "Go to the castle.", "", "Find the princess!"), [OK])
    scene("kq_b_pen_done", GLYPH["hen"] + " Hen Pen", page("fence hen hen hen fence", "Hooray! The hens are", "in the pen!", "", "Now they will lay eggs."), [OK])
    chain("kq_b_eggs", book, [
        page("hen egg", "The hens lay eggs", "in the pen.", "", "Pick them up!"),
        page("egg egg egg", "Take the eggs", "to the princess."),
    ], [OK])
    scene("kq_b_ice", book, page("ice iceSad", "Go to the Ice Palace.", "", "Find Princess Snowdrop!"), [OK])
    scene("kq_b_blaze", book, page("graham paw", "Graham went to", "Blaze Castle.", "", "Go and find him!"), [OK])
    bridge = [
        page("river", "Go down the road", "from the Ice Palace.", "", "Turn left.", "Find the river!"),
        page("axe log", "Chop the trees", "by the river.", "", "Get 4 logs."),
        page("log planks", "Open your bag.", "Make planks.", "", "Make about 12."),
        page("planks river", "Go to the edge", "of the river.", "", "Crouch down,", "so you don't fall!"),
        page("bridge", "Hold the planks.", "Put them over the water,", "one at a time.", "", "Walk out on them!"),
        page("snowEgg", "Find the chest", "on the other side.", "", "Take the egg!"),
        page("snowEgg iceHappy", "Take the egg to", "Princess Snowdrop!"),
    ]
    for i, text in enumerate(bridge):
        buttons = [(NEXT, open_cmd("kq_b_bridge_%d" % (i + 1)))] if i < len(bridge) - 1 else [OK]
        if i:
            buttons.append((BACK, open_cmd("kq_b_bridge_%d" % (i - 1))))
        scene("kq_b_bridge_%d" % i, book, text, buttons)
    scene("kq_b_fell", book, page("river", "Did you fall in?", "", "Swim to the ladder", "and climb out!"), [OK])
    # --- the inn keepers
    for i, (inn, keeper, clue) in enumerate(INN_STORY):
        chain("kq_i%d" % i, GLYPH["inn"] + " " + keeper, [
            page("inn", "Hi! I am %s." % keeper, "", "This is the %s." % inn),
            page("moon bed", "Is it dark?", "", "Sleep in a bed here.", "Then it will be day!"),
        ] + [page(*c) for c in clue], [("§l§dThank you! " + GLYPH["heart"], act("inngift"))])
        scene("kq_i%d_gift" % i, GLYPH["inn"] + " " + keeper, page("heart seeds", "Here is some food", "for your trip!", "", "And seeds to grow wheat."), [OK])
    return scenes

INN_STORY = [
    ("Blossom Inn", "Rosie", [("graham", "I saw a black dog!", "", "He ran by so fast!"), ("ice", "He ran to the Ice Palace.")]),
    ("Snowflake Inn", "Bo", [("graham", "A little dog came in.", "", "He was so cold!"),
                             ("heart", "I gave him a warm hat.", "", "Then he ran to Blaze Castle.")]),
    ("Sunny Inn", "Kit", [("graham", "A dog ate all my cookies!"), ("paw", "Then he ran to the knights.")]),
    ("Acorn Inn", "Max", [("moon", "Last night I heard a dog.", "", "Woof! Woof!"), ("paw", "It came from the", "Haunted Mountain.")]),
    ("Cloud Inn", "Lulu", [("graham", "Look up!", "", "I saw a dog in the sky!"), ("paw", "He went up the", "big beanstalk!")]),
]

def behaviour():
    write(os.path.join(BP, "entities", "princess.json"),
          npc("kq:princess", 0.8, 1.6, "kq_princess", {"kq:happy": {"type": "bool", "client_sync": True, "default": False},
                                               "kq:who": {"type": "int", "range": [0, 7], "client_sync": True, "default": 0}}, "talk", "princess"))
    write(os.path.join(BP, "items", "snow_golem_egg.json"), {
        "format_version": "1.21.50",
        "minecraft:item": {"description": {"identifier": "kq:snow_golem_egg", "menu_category": {"category": "items"}},
                           "components": {"minecraft:icon": {"textures": {"default": "kq_snow_golem_egg"}},
                                          "minecraft:display_name": {"value": "Snow Golem Egg"},
                                          "minecraft:max_stack_size": 1, "minecraft:glint": True}}})
    write(os.path.join(BP, "entities", "graham.json"), npc("kq:graham", 0.8, 0.9, "kq_graham"))
    write(os.path.join(BP, "entities", "clerk.json"),
          npc("kq:clerk", 0.6, 1.8, "kq_clerk", {"kq:look": {"type": "int", "range": [0, 4], "client_sync": True, "default": 0}}, "talk", "person"))
    write(os.path.join(BP, "entities", "book.json"), npc("kq:book", 0.2, 0.2, "kq_book", talker="book"))
    write(os.path.join(BP, "dialogue", "kingdom.diag.json"), {"format_version": "1.17.0", "minecraft:npc_dialogue": {"scenes": story()}})
    write(os.path.join(BP, "items", "guide.json"), {
        "format_version": "1.21.50",
        "minecraft:item": {"description": {"identifier": "kq:guide", "menu_category": {"category": "equipment"}},
                           "components": {"minecraft:icon": {"textures": {"default": "kq_guide"}},
                                          "minecraft:display_name": {"value": "How-To Book"},
                                          "minecraft:max_stack_size": 1, "minecraft:glint": True}}})
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
    d["textures"] = {"sad0": "textures/entity/kq_princess_sad", "happy0": "textures/entity/kq_princess",
                     "sad1": "textures/entity/kq_ice_princess_sad", "happy1": "textures/entity/kq_ice_princess"}
    d["render_controllers"] = ["controller.render.kq_princess"]
    write(os.path.join(RP, "entity", "princess.entity.json"), pe)
    write(os.path.join(RP, "render_controllers", "kq.render_controllers.json"), {
        "format_version": "1.8.0", "render_controllers": {"controller.render.kq_princess": {
            "arrays": {"textures": {"Array.faces": ["Texture.sad0", "Texture.happy0", "Texture.sad1", "Texture.happy1"]}},
            "geometry": "Geometry.default", "materials": [{"*": "Material.default"}],
            "textures": ["Array.faces[query.property('kq:who') * 2 + (query.property('kq:happy') ? 1 : 0)]"]},
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
    write(os.path.join(RP, "models", "entity", "kq_book.geo.json"), {"format_version": "1.12.0", "minecraft:geometry": [{
        "description": {"identifier": "geometry.kq_book", "texture_width": 32, "texture_height": 32,
                        "visible_bounds_width": 1, "visible_bounds_height": 1, "visible_bounds_offset": [0, 0.5, 0]},
        "bones": [{"name": "book", "pivot": [0, 0, 0], "cubes": [
            {"origin": [-5, 0, -1], "size": [5, 7, 1], "uv": [0, 0], "pivot": [0, 0, 0], "rotation": [0, -25, 0]},
            {"origin": [0, 0, -1], "size": [5, 7, 1], "uv": [12, 0], "pivot": [0, 0, 0], "rotation": [0, 25, 0]},
            {"origin": [-4.5, 0.5, -1.6], "size": [4.4, 6, 0.6], "uv": [0, 16], "pivot": [0, 0, 0], "rotation": [0, -25, 0]},
            {"origin": [0.1, 0.5, -1.6], "size": [4.4, 6, 0.6], "uv": [12, 16], "pivot": [0, 0, 0], "rotation": [0, 25, 0]}]}]}]})
    write(os.path.join(RP, "entity", "book.entity.json"), client_entity(
        "kq:book", "geometry.kq_book", "textures/entity/kq_book", [], {}))
    write(os.path.join(RP, "texts", "en_US.lang"), "\n".join([
        "entity.kq:princess.name=Princess", "entity.kq:graham.name=Graham", "entity.kq:clerk.name=Inn Keeper", "entity.kq:book.name=How-To Book",
        "action.interact.kq_talk=Talk", "item.kq:guide=How-To Book", "item.kq:snow_golem_egg=Snow Golem Egg", "tile.kq:magic_barrier.name=Magic Barrier", "pack.name=Kingdom Quest",
        "pack.description=Find Graham!", ""]))
    write(os.path.join(RP, "texts", "languages.json"), ["en_US"])
    write(os.path.join(RP, "textures", "item_texture.json"), {
        "resource_pack_name": "kingdomquest", "texture_name": "atlas.items",
        "texture_data": {"kq_guide": {"textures": "textures/items/kq_guide"},
                         "kq_snow_golem_egg": {"textures": "textures/items/kq_snow_golem_egg"}}})
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
    # Princess Snowdrop of the Ice Palace: the same princess in ice blue, with silver hair and tiara
    for src, dst in (("kq_princess", "kq_ice_princess"), ("kq_princess_sad", "kq_ice_princess_sad")):
        im = Image.open(os.path.join(RP, "textures", "entity", src + ".png")).convert("RGBA")
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                r, g, b, a = px[x, y]
                if not a or (28 <= x < 38 and 21 <= y < 30):          # leave her face (lips, cheeks) alone
                    continue
                h, sat, val = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
                hd = h * 360
                if (hd >= 290 or hd < 10) and sat > 0.12:                  # pink dress -> ice blue
                    rr, gg, bb = colorsys.hsv_to_rgb(200 / 360, min(1, sat * 0.9), val)
                    px[x, y] = (int(rr * 255), int(gg * 255), int(bb * 255), a)
                elif 35 <= hd <= 60 and sat > 0.4:                         # golden hair and crown -> silver
                    v = int(170 + 85 * val)
                    px[x, y] = (min(255, v - 15), min(255, v - 5), min(255, v + 10), a)
        im.save(os.path.join(RP, "textures", "entity", dst + ".png"))
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
    sg = Image.new("RGBA", (16, 16)); pic_snow_egg(ImageDraw.Draw(sg), 0, 0)
    os.makedirs(os.path.join(RP, "textures", "items"), exist_ok=True)
    sg.save(os.path.join(RP, "textures", "items", "kq_snow_golem_egg.png"))
    bk = Image.new("RGBA", (32, 32), (200, 70, 110, 255)); db = ImageDraw.Draw(bk)    # covers pink, pages cream
    db.rectangle([0, 16, 31, 31], fill=(250, 245, 230, 255))
    for y in range(19, 30, 2):
        db.line([(2, y), (9, y)], fill=(150, 150, 170, 255)); db.line([(14, y), (21, y)], fill=(150, 150, 170, 255))
    db.rectangle([3, 3, 8, 8], fill=(250, 200, 50, 255))
    bk.save(os.path.join(RP, "textures", "entity", "kq_book.png"))
    os.makedirs(os.path.join(RP, "textures", "items"), exist_ok=True)
    book = Image.new("RGBA", (16, 16)); pic_book(ImageDraw.Draw(book), 0, 0)
    book.save(os.path.join(RP, "textures", "items", "kq_guide.png"))
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

WOOD, WOOD_DARK, BARK = (190, 145, 85, 255), (140, 100, 55, 255), (100, 75, 45, 255)

def pic_log(d, ox, oy):
    d.rectangle([ox + 4, oy + 1, ox + 11, oy + 15], fill=BARK)
    d.ellipse([ox + 4, oy, ox + 11, oy + 4], fill=WOOD); d.ellipse([ox + 6, oy + 1, ox + 9, oy + 3], fill=WOOD_DARK)
    for y in (6, 10):
        d.line([(ox + 6, oy + y), (ox + 6, oy + y + 2)], fill=(80, 60, 35, 255))

def pic_planks(d, ox, oy):
    d.rectangle([ox + 1, oy + 1, ox + 14, oy + 14], fill=WOOD)
    for y in (4, 8, 12):
        d.line([(ox + 1, oy + y), (ox + 14, oy + y)], fill=WOOD_DARK)
    d.point([(ox + 5, oy + 2), (ox + 10, oy + 6), (ox + 4, oy + 10)], fill=WOOD_DARK)

def pic_table(d, ox, oy):
    d.rectangle([ox + 1, oy + 1, ox + 14, oy + 14], fill=WOOD)
    d.rectangle([ox + 1, oy + 1, ox + 14, oy + 5], fill=(160, 110, 60, 255))
    for x in (4, 8, 12):
        d.line([(ox + x, oy + 1), (ox + x, oy + 5)], fill=WOOD_DARK)
    d.rectangle([ox + 3, oy + 8, ox + 5, oy + 12], fill=(150, 150, 160, 255))      # a saw
    d.rectangle([ox + 9, oy + 8, ox + 12, oy + 10], fill=(110, 110, 120, 255))     # a hammer
    d.line([(ox + 10, oy + 10), (ox + 10, oy + 13)], fill=BARK)

def pic_stick(d, ox, oy):
    d.line([(ox + 3, oy + 13), (ox + 12, oy + 2)], fill=WOOD_DARK, width=3)
    d.line([(ox + 4, oy + 12), (ox + 12, oy + 3)], fill=WOOD, width=1)

def pic_gate(d, ox, oy):
    for x in (1, 13):
        d.rectangle([ox + x, oy + 2, ox + x + 2, oy + 15], fill=(170, 125, 75, 255))
    for x in (5, 10):
        d.rectangle([ox + x, oy + 5, ox + x + 1, oy + 12], fill=(170, 125, 75, 255))
    for y in (5, 11):
        d.rectangle([ox + 3, oy + y, ox + 12, oy + y + 1], fill=(140, 100, 60, 255))

def pic_axe(d, ox, oy):
    d.line([(ox + 3, oy + 14), (ox + 11, oy + 4)], fill=BARK, width=2)
    d.polygon([(ox + 8, oy + 1), (ox + 14, oy + 3), (ox + 13, oy + 8), (ox + 9, oy + 6)], fill=(210, 215, 225, 255))
    d.line([(ox + 14, oy + 3), (ox + 13, oy + 8)], fill=(150, 155, 165, 255))

def pic_book(d, ox, oy):
    d.rectangle([ox + 2, oy + 1, ox + 13, oy + 15], fill=(200, 70, 110, 255))
    d.rectangle([ox + 4, oy + 1, ox + 13, oy + 13], fill=(250, 245, 230, 255))
    d.rectangle([ox + 2, oy + 1, ox + 4, oy + 15], fill=(160, 40, 80, 255))
    for y in (4, 7, 10):
        d.line([(ox + 6, oy + y), (ox + 11, oy + y)], fill=(150, 150, 170, 255))
    d.polygon([(ox + 9, oy + 11), (ox + 10, oy + 13), (ox + 12, oy + 13), (ox + 10, oy + 14)], fill=(250, 200, 50, 255))

def pic_next(d, ox, oy):
    d.polygon([(ox + 2, oy + 5), (ox + 8, oy + 5), (ox + 8, oy + 1), (ox + 15, oy + 8), (ox + 8, oy + 15), (ox + 8, oy + 11), (ox + 2, oy + 11)],
              fill=(90, 200, 90, 255))

def pic_back(d, ox, oy):
    d.polygon([(ox + 14, oy + 5), (ox + 8, oy + 5), (ox + 8, oy + 1), (ox + 1, oy + 8), (ox + 8, oy + 15), (ox + 8, oy + 11), (ox + 14, oy + 11)],
              fill=(130, 140, 230, 255))

def pic_snow_egg(d, ox, oy):
    d.ellipse([ox + 3, oy + 1, ox + 12, oy + 15], fill=(245, 250, 255, 255), outline=(150, 190, 230, 255))
    d.point([(ox + 6, oy + 6), (ox + 9, oy + 6)], fill=(40, 40, 50, 255))                       # coal eyes
    d.polygon([(ox + 7, oy + 8), (ox + 10, oy + 9), (ox + 7, oy + 10)], fill=(250, 140, 40, 255))   # carrot nose
    d.point([(ox + 5, oy + 12), (ox + 10, oy + 3), (ox + 4, oy + 4)], fill=(170, 210, 245, 255))

def pic_bridge(d, ox, oy):
    d.rectangle([ox, oy + 10, ox + 15, oy + 15], fill=(80, 150, 230, 255))                      # water
    d.rectangle([ox, oy + 6, ox + 15, oy + 8], fill=(190, 145, 85, 255))                        # planks
    for x in (3, 7, 11):
        d.line([(ox + x, oy + 6), (ox + x, oy + 8)], fill=(140, 100, 55, 255))
    d.rectangle([ox, oy + 2, ox + 1, oy + 9], fill=(140, 100, 55, 255)); d.rectangle([ox + 14, oy + 2, ox + 15, oy + 9], fill=(140, 100, 55, 255))

def pic_river(d, ox, oy):
    d.rectangle([ox, oy + 2, ox + 4, oy + 15], fill=(240, 248, 255, 255)); d.rectangle([ox + 11, oy + 2, ox + 15, oy + 15], fill=(240, 248, 255, 255))
    d.rectangle([ox + 5, oy + 8, ox + 10, oy + 15], fill=(80, 150, 230, 255))
    d.line([(ox + 6, oy + 10), (ox + 9, oy + 10)], fill=(200, 230, 255, 255))

def pic_ice_face(sad):
    def draw(d, ox, oy):
        face(d, ox, oy, (255, 220, 190, 255), (215, 225, 240, 255), (200, 225, 250, 255), sad)
    return draw

TOOL_PICTURES = [pic_log, pic_planks, pic_table, pic_stick, pic_gate, pic_axe, pic_book, pic_next, pic_back,
                 pic_snow_egg, pic_ice_face(True), pic_ice_face(False), pic_bridge, pic_river]   # \uE10E ... \uE11B

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
    for n, draw in enumerate(TOOL_PICTURES):
        ox, oy = cell(14 + n)
        draw(d, ox, oy)
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
