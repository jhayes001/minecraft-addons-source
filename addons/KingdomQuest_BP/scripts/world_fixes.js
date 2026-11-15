// Fixes to the Princess Kingdom map for worlds that are already being played.
//
// Updating an old world (tools/update_world.py) swaps in the new Kingdom Quest packs but keeps the world itself, so
// anything changed in the map generator would be missing there. Each fix here is applied once per world, the first
// time a player is near it and all of it is loaded; the world remembers which ones it has done (kq:fixes).
// A brand-new world built by make_princess_world.py already has every fix, so a fix must be harmless there too:
// "set" only states what the blocks should be, and "when" (optional) skips the fix unless a block still has the old,
// broken look.
//
//   { id: "unique-name", near: [x, y, z],                    // game coordinates (as in kingdom_data.js)
//     when: [x, y, z, "minecraft:old_block"],                 // optional: only if that block is still the old one
//     set: [[x1, y1, z1, x2, y2, z2, "minecraft:block"], ...] }  // fill each box (corners included)
//
// Keep each fix small (a few thousand blocks) and within about 40 blocks of "near".
export const FIXES = [
];
