"""Chapter 2 (The Dragon's Wing) for the Kingdom Quest pack: the dragon entity, Pebble's look, the little pictures,
and every page the dragon, Pebble and the How-To Book say. make_kingdom_quest.py pulls these in.

The words follow Chapter 1's rules: short sentences, simple words, one idea a page, pictures first.
"""
from PIL import ImageDraw

# new pictures, after Chapter 1's ( onward): keep this order, the script uses the codes
GLYPH_NAMES = "dragonSad dragonHappy wheat hay rail minecart pebble crystal button boom sheep wool redstone gold door"

# Pebble the miner (a kq:clerk, look 6): (name, skin, hair, style, shirt, apron, pants, shoes, eyes, crown, flame, beard)
PEBBLE = ("Pebble", (225, 180, 145), (120, 80, 50), "short", (70, 100, 160), (150, 110, 70), (90, 75, 60), (60, 45, 35),
          (60, 110, 60), (250, 200, 60), None, (190, 130, 80))

PORTRAIT = {"portrait_offsets": {"translate": [-7, 18, 0], "scale": [0.5, 0.5, 0.5]},
            "picker_offsets": {"translate": [0, 6, 0], "scale": [0.45, 0.45, 0.45]}}

def dragon_entity():
    """The dragon: stays where the script puts it (lying in its crater, or flying in), talks in the talking window.
    kq:pose 0 lying hurt, 1 lying happy, 2 flying, 3 standing; kq:wing 0-4 (bandages, then mended); kq:roar."""
    return {"format_version": "1.21.50", "minecraft:entity": {
        "description": {"identifier": "kq:dragon", "is_spawnable": False, "is_summonable": True,
                        "properties": {"kq:pose": {"type": "int", "range": [0, 3], "client_sync": True, "default": 0},
                                       "kq:wing": {"type": "int", "range": [0, 4], "client_sync": True, "default": 0},
                                       "kq:roar": {"type": "bool", "client_sync": True, "default": False}}},
        "components": {
            "minecraft:type_family": {"family": ["kq_dragon", "kq"]},
            "minecraft:health": {"value": 200, "max": 200},
            "minecraft:damage_sensor": {"triggers": {"cause": "all", "deals_damage": False}},
            "minecraft:collision_box": {"width": 3, "height": 2.5},
            # tap anywhere on it: the body, and the head or tail end (the boxes don't turn with it, so both ends)
            "minecraft:custom_hit_test": {"hitboxes": [{"pivot": [0, 1.4, 0], "width": 4.5, "height": 2.8},
                                                       {"pivot": [0, 1.6, -4.5], "width": 2.6, "height": 2.4},
                                                       {"pivot": [0, 1.6, 4.5], "width": 2.6, "height": 2.4},
                                                       {"pivot": [-4.5, 1.6, 0], "width": 2.6, "height": 2.4},
                                                       {"pivot": [4.5, 1.6, 0], "width": 2.6, "height": 2.4}]},
            "minecraft:persistent": {},
            "minecraft:physics": {"has_gravity": False, "has_collision": False},
            "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
            "minecraft:knockback_resistance": {"value": 1},
            "minecraft:fire_immune": {},
            "minecraft:breathable": {"breathes_water": True, "breathes_air": True, "suffocate_time": 0},
            "minecraft:nameable": {"always_show": False, "allow_name_tag_renaming": False},
            "minecraft:npc": {"npc_data": dict(PORTRAIT, skin_list=[{"variant": 0}])}}}}

# ---------------------------------------------------------------- pictures (16 x 16)
INK, PURPLE, EYE = (34, 30, 44, 255), (128, 62, 170, 255), (242, 80, 255, 255)

def pic_dragon(sad):
    def draw(d, ox, oy):
        d.polygon([(ox + 1, oy + 9), (ox + 6, oy + 4), (ox + 12, oy + 5), (ox + 15, oy + 9), (ox + 12, oy + 13), (ox + 3, oy + 13)], fill=INK)
        d.polygon([(ox + 4, oy + 5), (ox + 2, oy), (ox + 6, oy + 4)], fill=(222, 212, 236, 255))         # horns
        d.polygon([(ox + 9, oy + 5), (ox + 10, oy), (ox + 11, oy + 5)], fill=(222, 212, 236, 255))
        d.rectangle([ox + 5, oy + 7, ox + 6, oy + 8], fill=EYE); d.rectangle([ox + 10, oy + 7, ox + 11, oy + 8], fill=EYE)
        d.point([(ox + 13, oy + 10), (ox + 14, oy + 10)], fill=(10, 8, 14, 255))
        if sad:
            d.arc([ox + 5, oy + 11, ox + 11, oy + 15], 200, 340, fill=(240, 240, 250, 255))
            d.point([(ox + 5, oy + 9), (ox + 5, oy + 10)], fill=(130, 200, 255, 255))
        else:
            d.arc([ox + 5, oy + 8, ox + 11, oy + 12], 20, 160, fill=(240, 240, 250, 255))
    return draw

def pic_wheat(d, ox, oy):
    for x in (4, 8, 12):
        d.line([(ox + x, oy + 15), (ox + x - 1, oy + 5)], fill=(150, 170, 60, 255))
        for k in range(3):
            d.ellipse([ox + x - 3, oy + 2 + k * 3, ox + x, oy + 5 + k * 3], fill=(225, 190, 80, 255))

def pic_hay(d, ox, oy):
    d.rectangle([ox + 1, oy + 3, ox + 14, oy + 14], fill=(215, 175, 60, 255))
    for y in (6, 11):
        d.line([(ox + 1, oy + y), (ox + 14, oy + y)], fill=(150, 60, 40, 255))
    for x in (4, 8, 12):
        d.line([(ox + x, oy + 3), (ox + x, oy + 14)], fill=(240, 205, 100, 255))

def pic_rail(d, ox, oy):
    for y in (2, 6, 10, 14):
        d.line([(ox + 2, oy + y), (ox + 13, oy + y)], fill=(130, 90, 50, 255), width=2)
    for x in (4, 11):
        d.line([(ox + x, oy), (ox + x, oy + 15)], fill=(170, 170, 180, 255), width=2)

def pic_minecart(d, ox, oy):
    d.polygon([(ox + 1, oy + 4), (ox + 14, oy + 4), (ox + 12, oy + 11), (ox + 3, oy + 11)], fill=(140, 140, 150, 255))
    d.rectangle([ox + 3, oy + 5, ox + 12, oy + 7], fill=(90, 90, 100, 255))
    for x in (4, 11):
        d.ellipse([ox + x - 2, oy + 10, ox + x + 2, oy + 14], fill=(50, 50, 55, 255))

def pic_pebble(d, ox, oy):
    d.ellipse([ox + 3, oy + 3, ox + 12, oy + 14], fill=(225, 180, 145, 255))
    d.chord([ox + 2, oy, ox + 13, oy + 9], 180, 360, fill=(250, 200, 60, 255))                       # hard hat
    d.rectangle([ox + 1, oy + 4, ox + 14, oy + 5], fill=(250, 200, 60, 255))
    d.rectangle([ox + 6, oy + 1, ox + 9, oy + 3], fill=(255, 250, 200, 255))                         # its lamp
    d.chord([ox + 3, oy + 9, ox + 12, oy + 16], 0, 180, fill=(190, 130, 80, 255))                   # beard
    d.point([(ox + 5, oy + 7), (ox + 10, oy + 7)], fill=(30, 30, 30, 255))

def pic_crystal(d, ox, oy):
    d.polygon([(ox + 8, oy), (ox + 12, oy + 6), (ox + 10, oy + 15), (ox + 6, oy + 15), (ox + 4, oy + 6)], fill=(170, 110, 230, 255))
    d.polygon([(ox + 8, oy), (ox + 10, oy + 6), (ox + 8, oy + 15), (ox + 6, oy + 6)], fill=(215, 175, 255, 255))
    d.polygon([(ox + 2, oy + 8), (ox + 4, oy + 11), (ox + 3, oy + 15), (ox + 1, oy + 15), (ox, oy + 11)], fill=(150, 90, 210, 255))

def pic_button(d, ox, oy):
    d.rectangle([ox + 1, oy + 9, ox + 14, oy + 14], fill=(125, 125, 130, 255))
    d.rectangle([ox + 4, oy + 5, ox + 11, oy + 9], fill=(170, 170, 175, 255))
    d.polygon([(ox + 7, oy), (ox + 10, oy + 3), (ox + 5, oy + 3)], fill=(240, 60, 60, 255))           # "press here"

def pic_boom(d, ox, oy):
    pts = []
    import math
    for k in range(16):
        r = 7.5 if k % 2 == 0 else 3.5
        a = k * math.pi / 8
        pts.append((ox + 8 + math.cos(a) * r, oy + 8 + math.sin(a) * r))
    d.polygon(pts, fill=(255, 170, 40, 255))
    d.ellipse([ox + 5, oy + 5, ox + 11, oy + 11], fill=(255, 240, 150, 255))

def pic_sheep(d, ox, oy):
    d.ellipse([ox + 2, oy + 3, ox + 14, oy + 12], fill=(245, 245, 240, 255))                         # fluffy body
    for x in (4, 7, 10, 12):
        d.ellipse([ox + x - 2, oy + 2, ox + x + 2, oy + 6], fill=(250, 250, 248, 255))
    d.rectangle([ox, oy + 5, ox + 4, oy + 10], fill=(210, 190, 175, 255))                              # face
    d.point([(ox + 1, oy + 7)], fill=(30, 30, 30, 255))
    for x in (5, 11):
        d.rectangle([ox + x, oy + 12, ox + x + 1, oy + 15], fill=(110, 95, 85, 255))

def pic_wool(d, ox, oy):
    d.rectangle([ox + 2, oy + 3, ox + 13, oy + 14], fill=(240, 238, 232, 255))
    for (x, y) in ((4, 5), (8, 7), (11, 4), (5, 10), (10, 11), (7, 13)):
        d.point([(ox + x, oy + y), (ox + x + 1, oy + y)], fill=(205, 200, 195, 255))
    d.rectangle([ox + 2, oy + 3, ox + 13, oy + 14], outline=(200, 196, 190, 255))

def pic_redstone(d, ox, oy):
    for (x, y, r) in ((5, 9, 3), (10, 7, 3), (8, 12, 2), (11, 12, 2)):
        d.ellipse([ox + x - r, oy + y - r, ox + x + r, oy + y + r], fill=(200, 20, 20, 255))
    d.point([(ox + 4, oy + 8), (ox + 9, oy + 6)], fill=(255, 120, 120, 255))

def pic_gold(d, ox, oy):
    d.polygon([(ox + 1, oy + 12), (ox + 4, oy + 6), (ox + 12, oy + 6), (ox + 15, oy + 12)], fill=(250, 205, 50, 255))
    d.polygon([(ox + 4, oy + 6), (ox + 12, oy + 6), (ox + 11, oy + 8), (ox + 5, oy + 8)], fill=(255, 240, 150, 255))
    d.line([(ox + 1, oy + 12), (ox + 15, oy + 12)], fill=(190, 140, 20, 255))

def pic_door(d, ox, oy):
    d.rectangle([ox + 3, oy, ox + 12, oy + 15], fill=(200, 200, 205, 255))
    d.rectangle([ox + 3, oy, ox + 12, oy + 15], outline=(120, 120, 128, 255))
    for y in (3, 6):
        d.rectangle([ox + 5, oy + y, ox + 10, oy + y + 1], fill=(150, 150, 158, 255))
    d.rectangle([ox + 10, oy + 9, ox + 11, oy + 10], fill=(90, 90, 95, 255))

PICTURES = [pic_dragon(True), pic_dragon(False), pic_wheat, pic_hay, pic_rail, pic_minecart, pic_pebble, pic_crystal,
            pic_button, pic_boom, pic_sheep, pic_wool, pic_redstone, pic_gold, pic_door]

# ---------------------------------------------------------------- the pages
def story(scene, chain, page, act, open_cmd, NEXT, BACK, GLYPH):
    OK = ("OK", act("close"))
    book = GLYPH["book"] + " How-To Book"
    sad, happy = GLYPH["dragonSad"] + " Ender Dragon", GLYPH["dragonHappy"] + " Ender Dragon"
    pebble = GLYPH["pebble"] + " Pebble"
    def lesson(prefix, pages):
        for i, text in enumerate(pages):
            buttons = [(NEXT, open_cmd("%s_%d" % (prefix, i + 1)))] if i < len(pages) - 1 else [OK]
            if i:
                buttons.append((BACK, open_cmd("%s_%d" % (prefix, i - 1))))
            scene("%s_%d" % (prefix, i), book, text, buttons)
    # --- the crash (the How-To Book tells everyone)
    chain("kq_d_crash", book, [
        page("boom", "BOOM!", "", "Something big fell", "from the sky!"),
        page("dragonSad", "It fell past the end", "of the road.", "", "Go and see!"),
        page("graham", "Take Graham with you!"),
    ], [OK])
    scene("kq_d_find", book, page("dragonSad", "Something fell", "from the sky!", "", "Go past the end of the road.", "Look for the smoke!"), [OK])
    # --- the dragon: meeting it
    chain("kq_d_intro", sad, [
        page("dragonSad", "Grrr...", "", "Ow! Ow!"),
        page("dragonSad heart", "Oh! Don't be scared.", "", "I will not hurt you."),
        page("dragonSad", "I am the Ender Dragon.", "", "A big storm", "blew me down."),
        page("dragonSad", "My wing broke!", "", "I fell out of the sky."),
        page("dragonSad", "The ground is so hard.", "", "And I am cold."),
        page("hay", "Can you make me", "a soft bed?", "", "Hay is soft!"),
    ], [("§dYes! " + GLYPH["heart"], act("d_yes"))])
    chain("kq_d_thanks", sad, [
        page("hay hay hay hay", "Make 4 hay bales.", "", "Put them down by me."),
        page("wheat", "There is wheat", "in the field", "by me."),
    ], [OK])
    for k in range(4):
        scene("kq_d_wait_%d" % k, sad, page(" ".join(["hay"] * max(1, k)) if k else "hay",
                                            "%d of 4 hay bales." % k if k else "No hay yet.", "", "I need %d more!" % (4 - k)), [OK])
    chain("kq_d_nest", happy, [
        page("dragonHappy hay", "Ahh! So soft!", "", "Thank you!"),
        page("dragonSad", "But my wing", "still hurts."),
        page("crystal", "To fix it, I need", "three things.", "", "They are deep down", "in the mines."),
        page("pebble", "Go down the stairs", "by me.", "", "Find Pebble.", "He has a train!"),
    ], [OK])
    scene("kq_d_happy", happy, page("pebble rail", "Find Pebble", "at the train!", "", "Go down the stairs", "by me."), [OK])
    scene("kq_d_needcrystals", happy, page("crystal", "Bring me 12 crystals", "from the Crystal Caverns!", "", "Graham can sniff", "them out!"), [OK])
    chain("kq_d_crystal", happy, [
        page("crystal heart", "Crystals!", "", "Thank you!"),
        page("dragonHappy", "Look at my wing!", "", "It is a little better."),
        page("wool", "Next I need", "something soft.", "", "Like wool!"),
        page("sheep", "Some sheep got lost", "deep down", "in the Glow Garden."),
        page("pebble minecart", "Pebble has a train", "to the Glow Garden!"),
    ], [OK])
    scene("kq_d_needwool", happy, page("wool sheep", "Bring me 6 wool!", "", "The sheep are", "in the Glow Garden."), [OK])
    chain("kq_d_wool", happy, [
        page("wool heart", "Wool!", "So soft!", "", "Thank you!"),
        page("dragonHappy", "My wing feels", "much better!"),
        page("gold", "Just one more thing:", "gold!", "", "Gold is strong.", "It will hold my wing straight."),
        page("door", "The old Deep Forge", "is at the bottom", "of the mine."),
        page("pebble minecart", "Pebble has a train", "that goes way down deep!"),
    ], [OK])
    scene("kq_d_needgold", happy, page("gold", "Bring me 4 gold bars!", "", "Find them in", "the Deep Forge."), [OK])
    chain("kq_d_gold", happy, [
        page("gold heart", "Gold!", "Strong and shiny!", "", "Thank you!"),
        page("crystal wool gold", "Crystals, wool", "and gold.", "", "That is all three!"),
        page("moon dragonHappy", "My wing needs", "one night to mend.", "", "Will you stay", "with me tonight?"),
        page("bed", "Make a bed.", "Put it by me.", "", "Sleep when", "it gets dark!"),
    ], [OK])
    scene("kq_d_mending", happy, page("moon bed", "My wing needs", "one night to mend.", "", "Sleep in a bed", "by me tonight!"), [OK])
    FLY = ("§dFly! " + GLYPH["heart"], act("d_fly"))
    chain("kq_d_mended", happy, [
        page("dragonHappy heart", "Good morning!", "", "Look at my wing!", "It is all better!"),
        page("crystal wool gold", "Your crystals, wool", "and gold fixed it.", "", "Thank you, my friend!"),
        page("dragonHappy", "Climb on my back!", "", "Let's fly!"),
    ], [FLY, ("Not now", act("close"))])
    scene("kq_d_again", happy, page("dragonHappy heart", "Hello, my friend!", "", "Do you want to fly?"), [FLY, ("Not now", act("close"))])
    scene("kq_d_part5", happy, page("dragonHappy", "My wing is mending!"), [OK])
    scene("kq_d_part4", happy, page("dragonHappy", "My wing feels", "much better!"), [OK])
    scene("kq_d_part3", happy, page("dragonHappy", "My wing is", "a little better!"), [OK])
    # --- the How-To Book: the nest
    scene("kq_d_b_nestdone", book, page("dragonHappy hay", "The dragon has a bed!", "", "Go and see the dragon."), [OK])
    lesson("kq_d_b_nest", [
        page("wheat", "Go to the wheat field.", "", "It is by the dragon."),
        page("wheat", "Pick the wheat.", "Tap it!", "", "9 wheat make", "1 hay bale."),
        page("table wheat hay", "Put a crafting table down.", "", "Put 9 wheat in it,", "in all 9 boxes.", "Make a hay bale!"),
        page("hay dragonSad", "Put the hay bale down", "by the dragon."),
        page("hay", "The dragon needs", "4 hay bales.", "", "Make more!"),
        page("dragonHappy", "The bed is done!", "", "Tap the dragon!"),
    ])
    # --- Pebble the miner
    scene("kq_pb_hello", pebble, page("pebble dragonSad", "Hello!", "", "A dragon fell", "out of the sky!", "Help it first."), [OK])
    chain("kq_pb_intro", pebble, [
        page("pebble", "Hello! I am Pebble.", "", "This is my mine train."),
        page("rail", "A rockslide broke", "my track!", "", "Now the train can't go."),
        page("rail", "Can you make", "new rails?"),
    ], [("§dYes! " + GLYPH["heart"], act("pb_yes"))])
    chain("kq_pb_thanks", pebble, [
        page("book", "Your How-To Book", "will help you."),
        page("iron", "Look! Iron in the walls!", "", "Iron has orange spots."),
    ], [OK])
    for k in range(12):
        scene("kq_pb_wait_%d" % k, pebble, page("rail", "%d of 12 rails." % k if k else "No rails yet.", "",
                                                "Fill the gap", "in the track!"), [OK])
    chain("kq_pb_fixed", pebble, [
        page("pebble heart", "You fixed my track!", "", "Thank you!"),
        page("minecart", "Here is a minecart!"),
    ], [("§dThank you! " + GLYPH["heart"], act("pb_cart"))])
    scene("kq_pb_ride", pebble, page("minecart button", "Put the cart on the track.", "Tap it to get in.", "", "Push the button.", "Off you go!"), [OK])
    scene("kq_pb_done", pebble, page("crystal minecart button", "To the Crystal Caverns!", "", "Put the cart on the track.", "Push the button to go!"), [OK])
    # --- the How-To Book: the track
    scene("kq_d_b_pebble", book, page("pebble", "Go down the stairs", "by the dragon.", "", "Find Pebble", "at the train!"), [OK])
    lesson("kq_d_b_track", [
        page("pickaxe coal", "Get a pickaxe and coal", "from the chest."),
        page("iron pickaxe", "Find iron in the walls:", "rock with orange spots.", "", "Mine 6!"),
        page("iron furnace coal", "Put iron in the top", "of the furnace.", "Put coal in the bottom.", "", "Wait for it to cook!"),
        page("iron stick rail", "Make rails!", "", "6 iron and 1 stick:", "iron down both sides,", "the stick in the middle."),
        page("rail", "Put the rails", "on the broken track.", "", "Fill the gap!"),
        page("pebble", "The track is fixed!", "", "Tap Pebble!"),
        page("minecart rail", "Put the minecart", "on the track.", "", "Tap it to get in!"),
        page("button minecart", "Push the button!", "", "Off you go!"),
    ])
    chain("kq_d_arrive", book, [
        page("crystal", "You made it!", "", "The Crystal Caverns!"),
        page("crystal", "The magic door", "is open!"),
        page("torch", "It is dark in there.", "", "Make torches.", "Light the way!"),
        page("crystal dragonHappy", "Get 12 crystals", "for the dragon!"),
    ], [OK])
    # --- the How-To Book: the Crystal Caverns
    lesson("kq_d_b_cave", [
        page("coal stick torch", "Make torches!", "", "Coal on top", "of a stick."),
        page("torch", "Put 6 torches on the walls", "in the caverns.", "", "Light the way!"),
        page("crystal pickaxe", "Mine the purple crystals", "with a pickaxe.", "", "Get 12!"),
        page("crystal dragonHappy", "Take the crystals", "to the dragon!", "", "Ride the train back.", "Go up the stairs."),
    ])
    scene("kq_d_b_part3", book, page("dragonHappy", "The dragon's wing", "is a little better!"), [OK])
    # --- the How-To Book: the Glow Garden
    lesson("kq_d_b_wool", [
        page("iron", "Get 2 iron.", "", "Mine it and smelt it,", "like before!"),
        page("iron shears", "Make shears!", "", "2 iron, corner", "to corner."),
        page("shears sheep", "Ride to the Glow Garden.", "", "Shear the sheep!", "Get 6 wool."),
        page("wool dragonHappy", "Take the wool", "to the dragon!", "", "Ride the train back.", "Go up the stairs."),
    ])
    scene("kq_d_b_part4", book, page("dragonHappy", "The dragon's wing", "feels much better!"), [OK])
    # --- the How-To Book: the Deep Forge
    lesson("kq_d_b_gold", [
        page("minecart door", "Ride the train", "to the Deep Forge.", "", "The door is by", "the south wall."),
        page("iron stick pickaxe", "Make an iron pickaxe!", "", "3 iron across the top,", "2 sticks down the middle."),
        page("redstone pickaxe", "Find redstone:", "rock with red spots.", "", "Mine it with", "your iron pickaxe."),
        page("redstone stick torch", "Make a redstone torch!", "", "Redstone on top", "of a stick."),
        page("torch door", "Put the redstone torch", "right next to the door.", "", "Redstone opens", "iron doors!"),
        page("gold pickaxe", "Mine the gold", "in the forge walls:", "rock with gold spots."),
        page("gold furnace coal", "Melt the gold", "in the furnace.", "", "Make 4 gold bars!"),
        page("gold dragonHappy", "Take the gold", "to the dragon!", "", "Ride the train back.", "Go up the stairs."),
    ])
    scene("kq_d_b_part5", book, page("dragonHappy", "The dragon's wing", "is mending!"), [OK])
    # --- the How-To Book: the last night, and the flight
    lesson("kq_d_b_mend", [
        page("wool planks bed", "Make a bed!", "", "3 wool on top,", "3 planks under them."),
        page("bed moon", "Put the bed by the dragon.", "", "Sleep in it", "when it gets dark."),
    ])
    scene("kq_d_b_fly", book, page("dragonHappy", "The dragon's wing", "is all better!", "", "Go and see it!"), [OK])
    chain("kq_d_end", book, [
        page("dragonHappy heart", "You did it!", "", "The dragon can fly again!"),
        page("graham heart", "You, Graham", "and the dragon", "are best friends now."),
        page("dragonHappy", "Tap the dragon", "any time", "to fly again!"),
        page("star", "The End", "of Chapter 2!"),
    ], [OK])
    scene("kq_d_b_forgeopen", book, page("door heart", "The door is open!", "", "Graham is OK!"), [OK])
    scene("kq_pb_forge", pebble, page("pebble door", "The Deep Forge line", "is open!", "", "Its door is by", "the south wall."), [OK])
    scene("kq_pb_garden", pebble, page("pebble minecart sheep", "The Glow Garden line", "is open!", "", "Go through the door", "by the west wall."), [OK])
    # names over their heads
    talk = [("§dTalk " + GLYPH["heart"], act("talk"))]
    scene("kq_name_dragon", "Ender Dragon", page("dragonSad", "Grrr..."), talk)
    scene("kq_name_pebble", "Pebble", page("pebble", "Hello!"), talk)
