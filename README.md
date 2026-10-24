# Havana's Minecraft Add-ons

Custom Minecraft Bedrock add-ons made for Havana's iPad worlds.
Each add-on is a **behavior pack** (`_BP`: items, recipes, scripts) plus a
**resource pack** (`_RP`: textures, names, particles). Activate the behavior
pack in a world and its resource pack turns on with it.

| Add-on | Version | What it does |
|---|---|---|
| **Rainbow Sword** | 1.0.2 | Glowing sword. Hold "use" to fire an arcing rainbow; mobs it hits float up. Given on first join; craftable from a diamond sword + 7 dyes + glowstone dust. |
| **Maze Wand** | 1.1.0 | Builds a random maze. Levels Easy (full glowing path) / Medium (glowing clues) / Hard (3 hints) / Expert (1 hint). Styles: hedge, dungeon, glass, rainbow. Treasure chest outside the exit, timer and best times. Refuses to build over player-made blocks. |
| **House Blueprint** | 1.1.0 | Builds a random house in front of you: pick a style or "Surprise me!" (Cozy Cottage, Stone Cottage, Modern, Cherry Blossom, Candy, Desert, Preston-Style Fire House, Ice Palace, Ocean House, Mushroom House, Log Cabin, Craftsman, Victorian, Golden Mansion). Random floor plan (sometimes L/T-shaped), 1 to 4 floors joined by staircases with railings, furnished rooms (living room, kitchen, bedrooms, playroom, library), ceiling lights, front door, path and flowers. Refuses to build over player-made blocks. |
| **Pip's Quests** | 1.1.0 | Quest Bell calls Pip, a quest villager. 16 solo quests + 8 team quests (combined inventories for nearby players), badges, weighted prize bag with pets and rare jackpots. |

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
- Pip is a vanilla `minecraft:villager_v2` with the `quest_keeper` tag; his trade
  screen is cancelled and replaced by the quest menu.

## Changelog

**Rainbow Sword**
- 1.0.2: gives the sword automatically on first join.
- 1.0.1: simplified item definition so it shows in the creative inventory.
- 1.0.0: first version.

**Maze Wand**
- 1.1.0: difficulty levels, glowing trails, hints, open exit with the treasure outside, on-screen titles.
- 1.0.0: first version (sizes and themes, treasure, timer).

**House Blueprint**
- 1.1.0: 8 new styles (Preston-style fire house, ice palace, ocean house, mushroom house, log cabin, craftsman, Victorian, golden mansion); horizontal log walls, stone base course, flame-gradient and spotted roofs, lava cauldrons and campfire extras, per-style floor limits.
- 1.0.0: first version.

**Pip's Quests**
- 1.1.0: team quests, multi-item quests, bigger prize bag (pets, discs, jackpots).
- 1.0.0: first version.

## Ideas for later

Pet egg that grows up, treasure hunt with riddle clues, mystery doors to
surprise rooms, floor-is-lava challenge, magic paintbrush, hide-and-seek wand.
