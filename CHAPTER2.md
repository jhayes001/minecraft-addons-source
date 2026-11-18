# Chapter 2: The Dragon's Wing (plan)

The sequel to "Find Graham!" in the Princess Kingdom world. Same rules as Chapter 1: a hidden lesson in every
quest, real Minecraft skills (no magic shortcuts), short pages she turns herself, the How-To Book opening at her
step, a gold arrow and sparkles showing the way, items from one area needed in the next, and the scary feeling
coming from places, not monsters.

## The story

The day after Graham comes home, the sky goes dark, there's a roar, and a huge black dragon flies low over the
Princess Castle trailing smoke, wobbles, and crashes past the end of the road. It's the Ender Dragon, but hurt
and frightened, not fierce: one wing is broken. Havana and Graham go to help. The dragon needs three things to
mend the wing, all deep underground, and the old mine train is the way down. At the end the wing is fixed and the
dragon flies Havana (and Graham) over the whole kingdom.

Graham comes along: nervous of the dragon at first (whimpers, stays close), then its friend; he sniffs out each
quest item, rides in his own minecart, has a brave moment of his own, and rides on the dragon at the end.

## The land

A new region just south of the spawn (game x -192 to 192, z 144 to 464), outside the old built area, so it can be
added to Havana's world without touching anything she has built. The underground areas are joined by a mine
railway from one station.

1. **The Crash Site** (surface, about 90 blocks south of the spawn): a scorched crater with knocked-down trees and
   smoke, the dragon lying in the middle with its broken wing out to the side. An old wheat field next to it.
2. **The Miner's Station** (30 blocks down, reached by stairs from a mine head on the crater rim): the hub. A dwarf
   stationmaster, Pebble. Every later area is a branch line from here.
3. **The Crystal Caverns:** an amethyst geode. Shards to make the wing sparkle and heal.
4. **The Glow Garden:** a lush cave with glow berries, moss and axolotls. Soft string to stitch the wing.
5. **The Deep Forge:** lava, gold and redstone. Power the last stretch of track and forge a golden splint.
   Graham gets stuck on the far side of the broken track: powering the rails rescues him too.
6. **The finale:** back at the crater, the wing is mended, and the dragon flies everyone over all six castles.

## The quests

| # | Where | Who | What she does | Lesson |
|---|---|---|---|---|
| 1 | Crash Site | the dragon | Make the dragon a soft nest: 4 hay bales round it | harvesting wheat, 3x3 crafting |
| 2 | Miner's Station | Pebble | Mend the broken track: mine iron, smelt it, make rails, lay them, ride the minecart | smelting, rails, minecarts |
| 3 | Crystal Caverns | (to come) | Amethyst shards for the wing | mining, a pickaxe for each job |
| 4 | Glow Garden | (to come) | String to stitch the wing | spiders' webs / shears, a lead for an axolotl? |
| 5 | Deep Forge | (to come) | Power the rails, forge the gold splint, rescue Graham | gold, redstone, powered rails |
| 6 | Crash Site | the dragon | The wing is mended: a flight over the kingdom | |

## Built so far

- Part 1 (Kingdom Quest 1.11.0): the dragon (its own model: black scales, purple wings, magenta eyes, a broken wing
  dragging), the crash, quest 1 and quest 2, Pebble, and the line as far as the Crystal Caverns stop (182 rails,
  18 blocks down; the caverns are behind a magic wall in the amethyst until part 2).

## Next (part 2)

- Open the magic door at the Crystal Caverns stop (a `world_fixes.js`-style step, or the script clears
  `DRAGON.crystalDoor` when part 2 starts) and build the caverns inside the region generator.
- Branch lines from the station to the Glow Garden and the Deep Forge (switch tracks, or separate platforms).
- Each thing brought back sets `kq:wing` (1-3 bandages show on the dragon); the fourth step mends it (4) and the
  flight over the kingdom uses `kq:pose` 2.

## How it works (for whoever builds the next part)

- Story progress is its own world property, `kq:ch2` (Chapter 1 keeps `kq:stage`; Chapter 2 starts once that is 7).
  0 not started, 1 the crash has happened (go and see), 2 nest, 3 track, 4 (part 2 starts here).
- `tools/make_dragon_land.py` builds the region (reusing the castle generator's helpers) and writes
  `addons/KingdomQuest_BP/scripts/dragon_data.js` (where everything is). `make_princess_world.py` puts the region
  into new worlds; `tools/update_world.py` adds it to an exported world: it only changes blocks that are still the
  plain flat-world ground, so anything built out there is kept.
- `addons/KingdomQuest_BP/scripts/dragon.js` is the story; `main.js` hands it taps, buttons, the book, hints and
  the arrow once Chapter 1 is over.
- `tools/make_dragon.py` makes the dragon's model, texture and animations (and a preview picture).
