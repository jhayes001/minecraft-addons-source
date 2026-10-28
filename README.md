# Havana's Minecraft Add-ons

Custom Minecraft Bedrock add-ons made for Havana's iPad worlds.
Each add-on is a **behavior pack** (`_BP`: items, recipes, scripts) plus a
**resource pack** (`_RP`: textures, names, particles). Activate the behavior
pack in a world and its resource pack turns on with it.

| Add-on | Version | What it does |
|---|---|---|
| **Rainbow Sword** | 1.0.2 | Glowing sword. Hold "use" to fire an arcing rainbow; mobs it hits float up. Given on first join; craftable from a diamond sword + 7 dyes + glowstone dust. |
| **Maze Wand** | 1.1.0 | Builds a random maze. Levels Easy (full glowing path) / Medium (glowing clues) / Hard (3 hints) / Expert (1 hint). Styles: hedge, dungeon, glass, rainbow. Treasure chest outside the exit, timer and best times. Refuses to build over player-made blocks. |
| **House Blueprint** | 1.5.0 | Builds a random house in front of you: pick a style or "Surprise me!" (17 styles, including Havana's Rainbow House, Preston-Style Fire House, Brianna-Style Sparkle House, Turtle House, Log Cabin, Craftsman, Victorian). Random floor plan (sometimes L/T-shaped), 1 to 4 floors joined by real staircases with railings, some with a rooftop deck, roomy furnished rooms (an open entry room, kitchen, bedrooms, playroom, library) with item frames, paintings, shelves and banner curtains, stair banisters, ceiling lights, a closed front door with lamp posts, path, and a garden of bushes, flowers, and plants. Refuses to build over player-made blocks. Use the blueprint next to a house it built to remove it: chest contents pop out and the land goes back exactly how it was. |
| **Santa's Visit** | 1.0.2 | Christmas Tree item grows a decorated spruce (glowing ornaments, star, snow). Every night after dark Santa's sleigh (custom model) flies over the tree playing Jingle Bells and leaves a present for each player, with a name sign. Tap your present to unwrap 2-3 gifts (weighted bag incl. pets, bundles, rare jackpots). Sleeping through the night still brings presents in the morning. |
| **Pip's Quests** | 1.1.0 | Quest Bell calls Pip, a quest villager. 16 solo quests + 8 team quests (combined inventories for nearby players), badges, weighted prize bag with pets and rare jackpots. |
| **Fairy Friends** | 1.3.1 | Havana's idea. Set a Fairy Egg on the ground; it wiggles, cracks, and hatches in 10 seconds into a fairy (custom model) that's one of 9 colors (pink, red, orange, yellow, green, aqua, blue, purple, or rainbow), a girl or a boy, with a random name. It hangs around 2-4 blocks from you with flapping butterfly wings, fluttering to a new spot every few seconds, sprinkling glowing fairy dust in its color, and follows you anywhere (even the Nether). At night it flies home to its Fairy House (a mushroom-cottage block) and sleeps inside; the windows light up. It comes back to find you at dawn. Fairy light: in dark places (night, caves, unlit houses, thick forest, the Nether/End) your first two fairies light up the area around them, switching off near torches and other lights. Monster shoo: hostile mobs within 6 blocks get zapped with sparkles and bounced away (no damage). Tap your fairy for a menu: twirl, say goodbye to it, or say goodbye to all your fairies (asks "Are you sure?" first; the fairy spirals up and flies away to Fairy Land). Breaking a Fairy House while fairies sleep inside asks whether to say goodbye; No wakes them up. Egg + house given on first join; craftable. |
| **Alpha Dog** | 1.0.1 | Havana's idea, modeled after her dog Graham (from photos: black coat, white splotch on his chest, one ear up and one flopped over, orange collar with a rainbow tag). Set an Alpha Dog Egg on the ground; it wiggles, cracks, and hatches in 10 seconds into a little black puppy (custom model) that's already yours, with a random name (rename it with a name tag from an anvil). Feed it bones and meat (cooked counts double) and it grows: Puppy -> Small Dog -> Big Dog -> a giant Alpha Dog you can ride like a horse (gold spiked collar and saddle). At every size it chases off monsters near you and defends you if something hurts you, and it can't get hurt. It hangs around you but is a little independent: sometimes it trots off to explore for a while and comes back, sometimes with a present (stick, bone, flower... rarely a diamond). It comes running if you get far away, follows you through portals, comes to help if you're hurt, and waits if tied with a lead. Tap to pet (shows a growing bar); crouch + tap for a menu: pet, stay close / go explore, say goodbye. Egg + 6 bones given on first join; craftable. |

## Building the .mcaddon files

```
./build.sh              # all add-ons -> dist/
./build.sh MazeWand     # just one
```

Get the `.mcaddon` onto the iPad (AirDrop, iCloud Drive, email), tap it in the
Files app, then activate it under **Behavior Packs** in the world's settings.
If a scripted feature doesn't work, turn on **Beta APIs** under Experiments.

## Making changes: the two rules

1. **Never change a `uuid`.** The UUIDs identify each pack. New UUIDs make
   Minecraft treat it as a different add-on.
2. **Bump the version on every change**, in *both* `manifest.json` files of
   that add-on (header, modules, and the dependency the BP has on its RP).
   Minecraft refuses to re-import a pack with the same version.

## Technical notes

- Scripts use `@minecraft/server` **1.19.0** (latest v1 stable) and
  `@minecraft/server-ui` **1.3.0**. Moving to the v2 API would need code changes.
- `min_engine_version` is 1.21.50.
- Saved data uses dynamic properties: `rainbow:got_sword`, `maze:got_wand`,
  `maze:best_<Level>`, `house:got_blueprint`, `quest:got_bell`, `quest:data` (on players) and
  `quest:team` (on the world). Keep these names so progress survives updates.
- The Maze Wand keeps active-maze info in memory only, so hints and the timer
  don't work on a maze built before the world was reloaded.
- House Blueprint keeps its planner (floor plans, stairs, furniture) free of Minecraft API calls so it
  can be tested in Node: everything between `const GAP` and the `MINECRAFT SIDE` banner runs standalone.
  Each run of 2,000 simulated houses checks that every room on every floor is reachable on foot and covered by a roof.
- Bed color lives in block-entity data that scripts can't set, so House Blueprint ships 16 tiny
  pre-made beds in `HouseBlueprint_BP/structures/house/` (one per color) and places/rotates the right one
  with `world.structureManager.place`. Item frames (with an item) and banner curtains work the same way
  (`frame_<item>`, `banner_<color>`). Regenerate all 42 with `python3 tools/make_structures.py addons/HouseBlueprint_BP/structures/house`.
  If structure placement fails, beds fall back to plain red beds and frames to empty frames. Paintings are entities;
  the script tries `spawnEntity("minecraft:painting")` and puts an item frame there instead if that fails (and tidies up
  any painting that pops off the wall).
- `tests/house_remove_test.cjs` runs the whole House Blueprint script in a fake world: builds a house over a tree,
  removes it, and checks the land is restored block-for-block (and the backup path if snapshots aren't available).
- Santa's Visit stores the tree (`santa:tree`), last visited night (`santa:lastNight`), players seen
  (`santa:players`) and unopened presents with their gifts (`santa:presents`) as world dynamic properties.
  The sleigh model and texture are generated by `tools/make_santa.py` (also renders a preview).
  `tests/santa_test.cjs` runs the script against a fake world: plant, night flight, named presents,
  unwrapping, sleeping through the night, breaking presents, removing the tree.
- Gifts can't be put inside bundles yet (filling a bundle needs experimental script APIs), so bundles are
  one of the possible gifts instead.
- Pip is a vanilla `minecraft:villager_v2` with the `quest_keeper` tag; his trade
  screen is cancelled and replaced by the quest menu.
- Fairy Friends: all models and textures (fairy geometry, 9 color textures, egg, mushroom house and its
  lit version, item icon, dust sparkle) are generated by `tools/make_fairy.py addons/FairyFriends_RP [preview.png]`.
  The fairy is modeled at double size and shrunk with `minecraft:scale` 0.3; its color is the entity
  `variant` (0-8, set by events `fairy:color_N`) and girl/boy is `mark_variant` (events `fairy:girl` / `fairy:boy`),
  which the render controller uses to pick the texture and show the `girl` or `boy` bone. Wings use
  `entity_alphablend` so they're see-through. Movement is scripted (gravity off, teleported a little each tick). Each fairy picks an open-air spot
  1.6-3.8 blocks from its owner, flutters there slowly, hovers 2-6 seconds, then picks another; it hurries if
  you're more than 6 blocks away and blinks over if more than 20 blocks or a different dimension. Plans live in memory only.
  Saved data: on each fairy `fairy:owner`, `fairy:name`, `fairy:color`, `fairy:gender`, `fairy:state`
  (awake / flyingHome / asleep), `fairy:home`; on eggs `fairy:owner`, `fairy:age`; on the world `fairy:houses`
  (owner + location of each house); on players `fairy:got_starter`. A fairy sleeps in its owner's closest
  house within 64 blocks, or any house within 32 if its owner has none. Sleeping = invisibility effect +
  the block state `fairy:lit`. `tests/fairy_test.cjs` runs the whole day/night story against a fake world.
  Fairy light places an invisible `minecraft:light_block_14` (or `light_block` with `block_light_level` 14 on
  older versions) in the air block the fairy is in and moves it as the fairy moves; only into plain air. Light spots are
  saved in `fairy:lights` (world) and cleared on the next load if any were left behind. "Dark" is a heuristic (no stable
  light-level API in 1.19): no lit light source within 5 blocks that has a clear line to your head (walls block it), and
  night sky, or not the Overworld, or a roof over 4 of 5 spots around you. Checked every 0.5 s; turns on at the first dark
  reading, off after two bright readings in a row. Monster shoo checks every 0.5 s for
  `monster`-family mobs within 6 blocks of a player who has an awake fairy within 10 blocks; each mob at most every
  1.5 s; uses `applyKnockback`. Ender dragon and wither are skipped.
  Recipes: Fairy Egg = egg + glowstone dust + sugar (shapeless); Fairy House = 3 red mushrooms over
  planks, wooden door, planks.
- Alpha Dog: the dog model, its texture (black coat with a bit of shine, white chest splotch, dark brown eyes, pink tongue,
  orange collar with a rainbow tag; one ear up, one flopped over), the egg,
  the item icon, and both pack icons are generated by `tools/make_alpha_dog.py addons/AlphaDog_RP [preview.png]` (the
  preview lines up the egg and all four sizes on a one-block grid). One model; each size is a component group with
  `minecraft:scale` 0.45 / 0.7 / 1.0 / 2.2 and `minecraft:variant` 0-3, set by events `alphadog:stage_0`..`stage_3`. The render
  controller swaps the orange `collar` for `alpha_gear` (gold spiked collar + saddle) at variant 3; puppies get a bigger head
  (bone scale 1.35). Walking, head-turning, tail-wagging, and panting are client animations; barks and steps borrow the wolf
  sounds through the resource pack's `sounds.json`. The dog is a real mob with vanilla AI, not script-moved:
  `minecraft:is_tamed` + `tameable`, and the script calls `tame(player)` when it hatches (and retries every 5 s if the owner
  wasn't around), so `follow_owner` and `owner_hurt_by_target` work. It attacks `monster`-family mobs within 12 blocks
  except creepers, endermen, zombified piglins, wardens, withers, the dragon, creakings, and ghasts. `damage_sensor` makes it
  unhurtable. The Alpha size adds `rideable` (seat at y 1.9; owner only, enforced in the script), `input_ground_controlled`,
  and horse jumping. Roaming is three component groups swapped by events: `roam_free` (follows once more than 11 blocks away;
  the default), `roam_close` (5 blocks), and `explore` (no following, long strolls). Every 30-120 s a free-roaming dog near you
  has a 40% chance to explore for 20-45 s; it stops when time's up, when it's 26+ blocks away, when a monster is within 10
  blocks of you, or when something hurts you (then it teleports to you if it's more than 14 blocks off). After a natural walk
  there's a 45% chance it brings a present when it's next within 4 blocks of you. More than 36 blocks away or in another
  dimension, it teleports to you, unless it's tied with a lead or being ridden. Growing to Alpha checks for a 3x3x3 open space
  first. Treat points: bone/raw meat/rotten flesh 1, cooked meat 2; sizes at 5, 15, 30 total (`GROW_AT`). Only the owner can
  feed, ride, or open the menu. Saved data: on each dog `alphadog:owner`, `alphadog:name`, `alphadog:stage`, `alphadog:food`,
  `alphadog:roam` (free / close), `alphadog:mode` (follow / explore), `alphadog:gift`; on eggs `alphadog:owner`,
  `alphadog:age`; on players `alphadog:got_egg`. Explore timers live in memory, so a dog that was exploring when the world
  closed just comes back. `tests/alpha_dog_test.cjs` runs the whole story against a fake world.
  Recipe: Alpha Dog Egg = egg + bone + black dye (or ink sac), shapeless.

## Changelog

**Alpha Dog**
- 1.0.1: looks more like Graham (from photos): white splotch on his chest, one ear up and one flopped over, orange collar with a rainbow tag, leaner and leggier with a longer muzzle and a tail that curves up, darker eyes. Taller collision boxes and saddle seat to match.
- 1.0.0: first version.

**Fairy Friends**
- 1.3.1: lights in the next room (behind a wall) no longer stop the fairy light; lights up within about half a second; unlit candles/campfires, torchflowers and fire coral don't count as lights; light uses the air just above/below the fairy if its own spot is taken.
- 1.3.0: fairy light (automatic in the dark) and monster shoo.
- 1.2.0: more relaxed following. Fairies hang out a few blocks away, hover, and drift to new spots instead of sticking to your shoulder.
- 1.1.1: smaller fairies (scale 0.42 -> 0.3, about 1/2 block tall); they float a bit higher so they stay near your shoulder.
- 1.1.0: saying goodbye. Tap your own fairy for a menu (twirl / goodbye / goodbye to all); breaking a house with your fairies asleep inside asks whether to say goodbye. Uses `@minecraft/server-ui` 1.3.0. New fairy states `leaving` and `waiting` (a fairy left `waiting` after a reload wakes up).
- 1.0.0: first version.

**Rainbow Sword**
- 1.0.2: gives the sword automatically on first join.
- 1.0.1: simplified item definition so it shows in the creative inventory.
- 1.0.0: first version.

**Maze Wand**
- 1.1.0: difficulty levels, glowing trails, hints, open exit with the treasure outside, on-screen titles.
- 1.0.0: first version (sizes and themes, treasure, timer).

**House Blueprint**
- 1.5.0: house sits at the level you're standing on (fixes doors one block low when standing on a path block, farmland, or snow); steps up to the door when the ground dips; lamp posts reach the ground; nothing within a block of doors, doorways, or the ends of stairs; fewer must-have items per room; no table in the entry room; bigger rooms (at least 5 wide, about 2.5x the old size); fence banisters on every staircase; wall decor (item frames with items, paintings when the game allows, shelves, banner curtains).
- 1.4.0: houses can be removed. Before building, a snapshot of the land is saved (structure `house:land_*`, saved in the world); removing a house moves players out, pops out chest/barrel/furnace contents, and puts the snapshot back. Houses are listed in the world property `house:houses`. Houses built with older versions can't be removed this way.
- 1.3.0: beds come in colors that match each style (Rainbow House beds are any rainbow color).
- 1.2.0: real stair blocks; front door fixed so it builds closed; lamp posts by the door; garden around the house; rooftop decks with stairs (about 1 in 4 houses, more for flat roofs); less crowded rooms (spacing between furniture, per-room limits); new styles Havana's Rainbow House, Brianna-Style Sparkle House, Turtle House.
- 1.1.0: 8 new styles (Preston-style fire house, ice palace, ocean house, mushroom house, log cabin, craftsman, Victorian, golden mansion); horizontal log walls, stone base course, flame-gradient and spotted roofs, lava cauldrons and campfire extras, per-style floor limits.
- 1.0.0: first version.

**Santa's Visit**
- 1.0.2: works on snowy ground (tree replaces the snow layer it's planted on; present spots check one block up/down). Test runs on grass and snow: `GROUND=minecraft:snow_layer TAP_TOP=1 node tests/santa_test.cjs ...`.
- 1.0.1: presents now land on grassy/flowery ground under the tree; backup chest (gifts inside) if the custom present block isn't available; honest message when no presents could be placed; white snow-and-sparkle trail; warnings in the Content Log explain any failure.
- 1.0.0: first version.

**Pip's Quests**
- 1.1.0: team quests, multi-item quests, bigger prize bag (pets, discs, jackpots).
- 1.0.0: first version.

## Ideas for later

Treasure hunt with riddle clues, mystery doors to
surprise rooms, floor-is-lava challenge, magic paintbrush, hide-and-seek wand.
