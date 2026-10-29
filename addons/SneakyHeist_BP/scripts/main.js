// Sneaky Heist: a cops-and-robbers sneaking game.
// Use the Heist Map in a big open space and it builds the Ender Manor in front of you: a walled
// garden with hedges and tall grass, a mansion full of rooms, and the Golden Crown on a pedestal in
// the vault. Press a button by the gate (green Easy, yellow Medium, red Hard) and Ender Guards in
// police caps start patrolling. Sneak in, grab the crown, and bring it back to the gold square.
// Crouch to be sneaky, hide in tall grass or behind crates. If a guard catches you it's off to
// jail: wait for the 5 lamps to go out (1 minute), or press the colored buttons in the order shown
// up high on the wall to break out early.
import { world, system, ItemStack, BlockPermutation } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const MAP_ID = "heist:heist_map";
const GUARD = "heist:guard";
const CROWN = "heist:crown";
const ARENA_PROP = "heist:arena";

const LEVELS = [
  // guards, walking / running speed (blocks a tick; you walk 0.216), how far they see, how many
  // ticks they have to look at you before they give chase, and how long the jail code is.
  { name: "Easy", guards: 4, walk: 0.055, run: 0.13, sight: 7, notice: 16, code: 3, vaultGuard: true },
  { name: "Medium", guards: 5, walk: 0.065, run: 0.155, sight: 9, notice: 10, code: 4, vaultGuard: true },
  { name: "Hard", guards: 7, walk: 0.075, run: 0.18, sight: 11, notice: 6, code: 5, vaultGuard: true },
];
const JAIL_TICKS = 1200;      // 60 seconds
const LAMPS = 5;              // one goes out every 12 seconds
const GRACE_TICKS = 100;      // guards leave you alone this long after jail
const CATCH_RANGE = 1.15;
const GRAB_RANGE = 2.0;
const COUNTDOWN = 60;

// ---------- The map of the Ender Manor ----------
// u runs left to right across the arena, v runs away from where you stand when you build it.
// One character per column of blocks:
//   ' ' leave alone   '.' grass   ',' path   'y' yard   'H' home (gold square)   '#' outer wall
//   'a' gate arch     'W' manor wall   'G' window   'd' doorway   '_' wood floor   '~' carpet
//   '=' vault floor   'P' pedestal   'p' pillar   'h' hedge   'b' bush   'g' tall grass   'f' flowers
//   'T' tree   'r' fountain rim   'w' water   'q' fountain spout   'B' bookshelf   'c' barrel
//   'C' crate stack   'k' table   'x' hay bale   'J' jail wall   'j' jail cell   'S' button board
//   'l' lamp post
const W = 72, VMIN = -12, VMAX = 71;
const HALF = 35, VOFF = 14;   // you stand at u 35, v -14 when you build it

function makeLayout() {
  const g = [];
  for (let v = VMIN; v <= VMAX; v++) g.push(new Array(W).fill(" "));
  const set = (u, v, ch) => { if (u >= 0 && u < W && v >= VMIN && v <= VMAX) g[v - VMIN][u] = ch; };
  const get = (u, v) => (u >= 0 && u < W && v >= VMIN && v <= VMAX ? g[v - VMIN][u] : " ");
  const fill = (u0, v0, u1, v1, ch) => {
    for (let v = Math.min(v0, v1); v <= Math.max(v0, v1); v++) for (let u = Math.min(u0, u1); u <= Math.max(u0, u1); u++) set(u, v, ch);
  };
  const box = (u0, v0, u1, v1, ch) => { fill(u0, v0, u1, v0, ch); fill(u0, v1, u1, v1, ch); fill(u0, v0, u0, v1, ch); fill(u1, v0, u1, v1, ch); };
  // Both halves of the garden are mirror images (u -> 71 - u).
  const both = (u0, v0, u1, v1, ch) => { fill(u0, v0, u1, v1, ch); fill(W - 1 - u0, v0, W - 1 - u1, v1, ch); };
  const dot = (u, v, ch) => both(u, v, u, v, ch);

  // Grounds and the outer wall with its gate.
  fill(1, 1, 70, 70, ".");
  box(0, 0, 71, 71, "#");
  fill(34, 0, 37, 0, "a");

  // Front garden: path to the manor door around a fountain.
  fill(34, 1, 37, 23, ",");
  fill(30, 7, 41, 17, ",");
  box(31, 8, 40, 16, "r");
  fill(32, 9, 39, 15, "w");
  fill(35, 12, 36, 12, "q");
  // Hedge rooms with gaps to sneak through.
  both(3, 4, 13, 4, "h"); both(17, 4, 29, 4, "h");
  both(3, 4, 3, 11, "h");
  both(8, 8, 21, 8, "h");
  both(25, 4, 25, 12, "h");
  both(3, 15, 3, 21, "h"); both(3, 21, 12, 21, "h");
  both(8, 12, 8, 17, "h");
  both(12, 13, 21, 13, "h"); both(21, 13, 21, 18, "h");
  both(16, 21, 28, 21, "h");
  both(26, 16, 28, 16, "h");
  // Hiding places and decorations.
  both(5, 5, 7, 7, "g"); both(14, 9, 17, 11, "g"); both(4, 13, 6, 14, "g"); both(10, 15, 13, 19, "g");
  both(23, 14, 26, 15, "g"); both(26, 6, 28, 8, "g"); both(18, 15, 19, 19, "g"); both(9, 5, 11, 6, "f");
  both(16, 5, 22, 6, "f"); both(13, 22, 15, 22, "g");
  dot(19, 10, "T"); dot(6, 18, "T"); dot(27, 19, "T"); dot(11, 2, "T");
  dot(23, 10, "b"); dot(12, 11, "b"); dot(15, 17, "b"); dot(29, 13, "b"); dot(6, 10, "b"); dot(24, 19, "b");
  dot(30, 2, "b"); dot(30, 22, "b");

  // Side yards along the manor.
  both(2, 25, 4, 30, "g"); both(7, 33, 10, 37, "g"); both(2, 41, 5, 46, "g"); both(7, 49, 10, 53, "g");
  dot(6, 27, "T"); dot(3, 37, "T"); dot(8, 44, "T"); dot(4, 52, "T");
  dot(9, 26, "x"); dot(10, 26, "x"); dot(9, 30, "x"); dot(2, 34, "x"); dot(6, 40, "x"); dot(7, 40, "x");
  dot(10, 46, "x"); dot(2, 49, "x");
  both(1, 23, 11, 23, ","); both(11, 23, 11, 55, ",");

  // The manor.
  box(12, 24, 59, 54, "W");
  fill(13, 25, 58, 53, "_");
  for (let u = 14; u <= 57; u += 4) { set(u, 24, "G"); set(u, 54, "G"); }
  for (let v = 26; v <= 52; v += 4) { set(12, v, "G"); set(59, v, "G"); }
  for (const [u, v] of [[12, 24], [59, 24], [12, 54], [59, 54]]) set(u, v, "p");
  fill(34, 24, 37, 24, "d");                                   // front door
  fill(12, 36, 12, 37, "d"); fill(59, 36, 59, 37, "d");          // side doors
  fill(19, 54, 20, 54, "d"); fill(51, 54, 52, 54, "d");          // back doors
  fill(13, 34, 58, 34, "W"); fill(13, 39, 58, 39, "W");          // walls along the long hallway
  for (const [a, b] of [[19, 20], [34, 37], [51, 52]]) fill(a, 34, b, 34, "d");
  for (const [a, b] of [[19, 20], [29, 30], [41, 42], [51, 52]]) fill(a, 39, b, 39, "d");
  fill(27, 25, 27, 33, "W"); fill(44, 25, 44, 33, "W"); fill(27, 28, 27, 30, "d"); fill(44, 28, 44, 30, "d");
  fill(27, 40, 27, 53, "W"); fill(44, 40, 44, 53, "W"); fill(27, 46, 27, 47, "d"); fill(44, 46, 44, 47, "d");
  // Entry hall: pillars and a red carpet.
  fill(35, 25, 36, 33, "~");
  for (const [u, v] of [[30, 27], [41, 27], [30, 31], [41, 31]]) set(u, v, "p");
  // Library (front left): rows of bookshelves.
  fill(15, 27, 19, 27, "B"); fill(22, 27, 25, 27, "B"); fill(15, 31, 18, 31, "B"); fill(21, 31, 25, 31, "B");
  set(14, 25, "c"); set(25, 33, "c");
  // Dining room (front right): two long tables.
  fill(48, 28, 55, 28, "k"); fill(48, 31, 55, 31, "k"); set(57, 25, "c"); set(46, 33, "c");
  // Hallway: a few barrels to duck behind.
  for (const u of [15, 24, 32, 39, 47, 56]) set(u, u % 2 ? 35 : 38, "c");
  // Kitchen (back left): counters along the walls with gaps.
  fill(14, 41, 18, 41, "c"); fill(22, 41, 25, 41, "c"); fill(14, 45, 14, 50, "c"); fill(18, 45, 22, 46, "k");
  fill(18, 50, 22, 50, "k"); set(25, 52, "c"); set(16, 52, "c");
  // Storeroom (back right): crate stacks with aisles.
  fill(47, 41, 49, 43, "C"); fill(53, 41, 55, 43, "C"); fill(47, 47, 49, 48, "C"); fill(53, 47, 55, 48, "C");
  fill(47, 51, 48, 52, "C"); fill(54, 51, 55, 52, "C"); set(51, 44, "c"); set(51, 50, "c");
  // Treasure hall and the vault.
  set(30, 42, "c"); set(41, 42, "c"); set(33, 41, "c"); set(38, 43, "c");
  fill(28, 45, 43, 45, "W"); fill(35, 45, 36, 45, "d");
  fill(28, 46, 43, 53, "=");
  set(29, 47, "c"); set(42, 47, "c"); set(29, 52, "c"); set(42, 52, "c"); set(31, 52, "C"); set(40, 52, "C");
  fill(35, 50, 36, 51, "P");

  // Back garden: a pond, hedges and long grass.
  fill(13, 55, 58, 55, ",");
  fill(30, 59, 41, 68, ",");
  box(31, 60, 40, 67, "r");
  fill(32, 61, 39, 66, "w");
  both(3, 58, 14, 58, "h"); both(18, 58, 26, 58, "h"); both(26, 58, 26, 66, "h");
  both(7, 61, 7, 69, "h"); both(12, 62, 21, 62, "h"); both(12, 62, 12, 67, "h");
  both(17, 66, 23, 66, "h"); both(3, 63, 3, 68, "h");
  both(4, 59, 6, 61, "g"); both(14, 63, 18, 65, "g"); both(9, 67, 11, 69, "g"); both(20, 59, 24, 61, "g");
  both(22, 67, 25, 69, "g"); both(28, 62, 29, 66, "g"); both(15, 68, 18, 69, "f"); both(8, 59, 10, 60, "f");
  dot(10, 64, "T"); dot(20, 69, "T"); dot(28, 57, "T"); dot(2, 56, "T");
  dot(16, 60, "b"); dot(24, 64, "b"); dot(5, 66, "b"); dot(29, 69, "b");

  // Outside the gate: the yard, the gold square, the start buttons, and the jail.
  fill(22, -12, 49, -1, "y");
  fill(34, -6, 37, -3, "H");
  fill(32, -12, 40, -12, "S");
  for (const [u, v] of [[22, -12], [49, -12], [22, -1], [49, -1], [31, -12], [41, -12]]) set(u, v, "l");
  box(15, -12, 21, -1, "J"); fill(16, -6, 20, -6, "J");
  fill(16, -11, 20, -7, "j"); fill(16, -5, 20, -1, "j");

  const rows = g.map((r) => r.join(""));
  return { rows, get };
}

const LAYOUT = makeLayout();
const cellAt = (u, v) => LAYOUT.get(u, v);

// What the different columns are like.
const FLOORS = new Set([".", ",", "y", "H", "d", "a", "_", "~", "=", "g", "f", "j"]);
const OPAQUE = new Set(["#", "W", "h", "B", "T", "J", "S", "p", "C", "l"]); // blocks eyes
const LOW = new Set(["c", "k", "x", "b", "r", "q", "P"]);                   // you can hide behind these by crouching
const INDOOR = new Set(["_", "~", "=", "d", "j"]);
const playerWalk = (u, v) => FLOORS.has(cellAt(u, v));
// Guards stay inside the walls, a little back from the gate.
const guardWalk = (u, v) => v >= 3 && v <= 70 && u >= 1 && u <= 70 && FLOORS.has(cellAt(u, v)) && cellAt(u, v) !== "j";

const PEDESTAL = { U: 36, V: 51 };            // middle of the 2x2 pedestal
const HOME = { u0: 34, v0: -6, u1: 37, v1: -3 };
const BOARD_BUTTONS = [{ u: 34, level: 0 }, { u: 36, level: 1 }, { u: 38, level: 2 }]; // v -11, height 1
const START_SPOTS = [[35, -4], [36, -4], [35, -5], [36, -5]];
const STAND = { u: 35, v: -15 };              // where people go when the arena is taken away

// Jail cells. The colored buttons are on the wall at u 15 (pressed from u 16), in five slots running
// left to right; the code is shown up high in the same slots. The bars and lamps are on the wall at u 21.
const CODE_COLORS = [
  { name: "red", slot: 0 }, { name: "yellow", slot: 1 }, { name: "lime", slot: 3 }, { name: "blue", slot: 4 },
];
const CODE_SLOTS = { 3: [1, 2, 3], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4] };
const CELLS = [
  { v0: -11, v1: -7, door: -9 },
  { v0: -5, v1: -1, door: -3 },
];
const inCell = (c, u, v) => u >= 16 && u <= 20 && v >= c.v0 && v <= c.v1;
// The cell, its doorway, and the spot just outside the bars (smooth positions, with a little extra all around).
const nearCell = (c, U, V) => U >= 15.5 && U < 23 && V >= c.v0 - 0.3 && V < c.v1 + 1.3;
const DOOR_OPEN_TICKS = 200;  // an opened door stays open at least 10 seconds

// Spots the guards walk between: spread over the whole place, plus a tighter set around the vault.
const SPOTS = [];
const VAULT_SPOTS = [];
function nearestWalk(u, v, r, ok = guardWalk) {
  for (let d = 0; d <= r; d++) {
    for (let du = -d; du <= d; du++) {
      for (let dv = -d; dv <= d; dv++) {
        if (Math.max(Math.abs(du), Math.abs(dv)) !== d) continue;
        if (ok(u + du, v + dv)) return { u: u + du, v: v + dv };
      }
    }
  }
  return undefined;
}
for (let v = 5; v <= 68; v += 7) {
  for (let u = 4; u <= 67; u += 7) {
    const s = nearestWalk(u, v, 2);
    if (s && !SPOTS.some((o) => o.u === s.u && o.v === s.v)) SPOTS.push(s);
  }
}
for (const [u, v] of [[31, 42], [40, 42], [35, 44], [30, 49], [41, 49], [32, 53], [39, 53], [24, 47], [47, 46], [35, 37]]) {
  const s = nearestWalk(u, v, 1);
  if (s) VAULT_SPOTS.push(s);
}

// ---------- Blocks ----------
const BLOCKS = {
  air: [["minecraft:air"]],
  grass: [["minecraft:grass_block"]],
  dirt: [["minecraft:dirt"]],
  path: [["minecraft:dirt_path"], ["minecraft:grass_path"], ["minecraft:gravel"]],
  yard: [["minecraft:smooth_stone"], ["minecraft:stone"]],
  gold: [["minecraft:gold_block"]],
  wall: [["minecraft:stone_bricks"]],
  mossy: [["minecraft:mossy_stone_bricks"], ["minecraft:stone_bricks"]],
  chiseled: [["minecraft:chiseled_stone_bricks"], ["minecraft:stone_bricks"]],
  manor: [["minecraft:end_stone_bricks"], ["minecraft:end_bricks"], ["minecraft:sandstone"]],
  purpur: [["minecraft:purpur_block"], ["minecraft:quartz_block"]],
  pillar: [["minecraft:purpur_pillar"], ["minecraft:purpur_block"], ["minecraft:quartz_block"]],
  pane: [["minecraft:glass_pane"]],
  planks: [["minecraft:oak_planks"], ["minecraft:planks"]],
  vault: [["minecraft:polished_blackstone"], ["minecraft:polished_deepslate"], ["minecraft:stone"]],
  carpet: [["minecraft:red_carpet"], ["minecraft:carpet", { color: "red" }]],
  tablecloth: [["minecraft:white_carpet"], ["minecraft:carpet", { color: "white" }]],
  leaves: [["minecraft:oak_leaves", { persistent_bit: true }], ["minecraft:leaves", { old_leaf_type: "oak", persistent_bit: true }], ["minecraft:moss_block"]],
  bush: [["minecraft:azalea_leaves_flowered", { persistent_bit: true }], ["minecraft:azalea_leaves", { persistent_bit: true }],
    ["minecraft:oak_leaves", { persistent_bit: true }], ["minecraft:moss_block"]],
  log: [["minecraft:oak_log"], ["minecraft:log"]],
  tallLow: [["minecraft:tall_grass", { upper_block_bit: false }], ["minecraft:double_plant", { double_plant_type: "grass", upper_block_bit: false }],
    ["minecraft:short_grass"], ["minecraft:tallgrass"]],
  tallHigh: [["minecraft:tall_grass", { upper_block_bit: true }], ["minecraft:double_plant", { double_plant_type: "grass", upper_block_bit: true }],
    ["minecraft:air"]],
  water: [["minecraft:water"]],
  bookshelf: [["minecraft:bookshelf"]],
  barrel: [["minecraft:barrel"]],
  hay: [["minecraft:hay_block"]],
  fence: [["minecraft:oak_fence"], ["minecraft:fence"]],
  quartz: [["minecraft:quartz_block"]],
  lantern: [["minecraft:lantern"]],
  seaLantern: [["minecraft:sea_lantern"], ["minecraft:glowstone"]],
  prismarine: [["minecraft:prismarine_bricks"], ["minecraft:prismarine"], ["minecraft:stone_bricks"]],
  jail: [["minecraft:cobblestone"]],
  jailMossy: [["minecraft:mossy_cobblestone"], ["minecraft:cobblestone"]],
  bars: [["minecraft:iron_bars"]],
  lampOn: [["minecraft:ochre_froglight"], ["minecraft:glowstone"]],
  lampOff: [["minecraft:redstone_lamp"], ["minecraft:coal_block"]],
  light: [["minecraft:light_block_15"], ["minecraft:light_block", { block_light_level: 15 }]],
  red: [["minecraft:red_wool"], ["minecraft:wool", { color: "red" }]],
  yellow: [["minecraft:yellow_wool"], ["minecraft:wool", { color: "yellow" }]],
  lime: [["minecraft:lime_wool"], ["minecraft:wool", { color: "lime" }]],
  blue: [["minecraft:blue_wool"], ["minecraft:wool", { color: "blue" }]],
};
const FLOWERS = [
  [["minecraft:poppy"], ["minecraft:red_flower"]], [["minecraft:dandelion"], ["minecraft:yellow_flower"]],
  [["minecraft:cornflower"], ["minecraft:poppy"]], [["minecraft:allium"], ["minecraft:poppy"]],
  [["minecraft:oxeye_daisy"], ["minecraft:dandelion"]], [["minecraft:pink_tulip"], ["minecraft:poppy"]],
];

const permCache = new Map();
function tryPerm(options, key) {
  if (key && permCache.has(key)) return permCache.get(key);
  let found;
  for (const [id, states] of options) {
    try {
      found = BlockPermutation.resolve(id, states);
      break;
    } catch {}
  }
  if (key) permCache.set(key, found);
  return found;
}
const B = (name) => tryPerm(BLOCKS[name], name);
function withFacing(options, facing, key) {
  return tryPerm(options.map(([id, s]) => [id, { ...(s || {}), facing_direction: facing }]), `${key}:${facing}`);
}
const button = (facing) => withFacing([["minecraft:stone_button"], ["minecraft:wooden_button"]], facing, "button");
const wallSign = (facing) => withFacing([["minecraft:wall_sign"], ["minecraft:oak_wall_sign"]], facing, "sign");

// Blocks that probably belong to something someone built. If any are in the way, the map refuses.
const PROTECTED = [
  "chest", "barrel", "bed", "door", "crafting_table", "furnace", "planks", "glass", "wool", "bricks",
  "concrete", "carpet", "sign", "shulker", "torch", "lantern", "bookshelf", "fence", "stairs", "slab",
  "quartz", "glowstone", "gold_block", "purpur", "froglight", "bars", "elf_shed", "fairy_house", "dog_house",
];

// ---------- Where things are ----------
function getArena() {
  try {
    const raw = world.getDynamicProperty(ARENA_PROP);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}
function saveArena(a) {
  try {
    world.setDynamicProperty(ARENA_PROP, a ? JSON.stringify(a) : undefined);
  } catch {}
}
// Block (u, v) at height y above the floor -> world block.
function toWorld(a, u, v, y) {
  return {
    x: a.base.x + a.r.x * (u - HALF) + a.f.x * (v + VOFF),
    y: a.base.y + y,
    z: a.base.z + a.r.z * (u - HALF) + a.f.z * (v + VOFF),
  };
}
// Smooth local position (U, V; cell u covers U from u to u + 1) <-> world position.
function toWorldPos(a, U, V, y) {
  const du = U - 0.5 - HALF, dv = V - 0.5 + VOFF;
  return {
    x: a.base.x + 0.5 + a.r.x * du + a.f.x * dv,
    y: a.base.y + y,
    z: a.base.z + 0.5 + a.r.z * du + a.f.z * dv,
  };
}
function toLocal(a, loc) {
  const dx = loc.x - a.base.x - 0.5, dz = loc.z - a.base.z - 0.5;
  return {
    U: dx * a.r.x + dz * a.r.z + HALF + 0.5,
    V: dx * a.f.x + dz * a.f.z - VOFF + 0.5,
    y: loc.y - a.base.y,
  };
}
// Direction in the arena -> world facing_direction (2 north, 3 south, 4 west, 5 east).
function facingOf(a, du, dv) {
  const x = a.r.x * du + a.f.x * dv, z = a.r.z * du + a.f.z * dv;
  return z < 0 ? 2 : z > 0 ? 3 : x < 0 ? 4 : 5;
}
function yawOf(a, du, dv) {
  const x = a.r.x * du + a.f.x * dv, z = a.r.z * du + a.f.z * dv;
  return (Math.atan2(-x, z) * 180) / Math.PI;
}
function nearArena(a, player, margin = 0) {
  if (!a || player.dimension.id !== a.dim) return false;
  const p = toLocal(a, player.location);
  return p.U >= -margin && p.U <= W + margin && p.V >= VMIN - 4 - margin && p.V <= VMAX + 1 + margin
    && p.y >= -6 - margin && p.y <= 16 + margin;
}
function worldBox(a) {
  const c1 = toWorld(a, 0, VMIN, -4), c2 = toWorld(a, W - 1, VMAX, 12);
  return {
    min: { x: Math.min(c1.x, c2.x), y: c1.y, z: Math.min(c1.z, c2.z) },
    max: { x: Math.max(c1.x, c2.x), y: c2.y, z: Math.max(c1.z, c2.z) },
  };
}

// ---------- Small helpers ----------
const dimOf = (a) => world.getDimension(a.dim);
function playSound(id, location, pitch = 1, volume = 1) {
  try {
    world.playSound(id, location, { pitch, volume });
  } catch {}
}
function particle(dim, id, loc) {
  try {
    dim.spawnParticle(id, loc);
  } catch {}
}
const lastBar = new Map();   // player id -> tick of the last note, so the little map doesn't cover it up
function bar(player, text) {
  lastBar.set(player.id, system.currentTick);
  try {
    player.onScreenDisplay.setActionBar(text);
  } catch {}
}
function say(player, text) {
  try {
    player.sendMessage(text);
  } catch {}
}
function setBlock(dim, loc, perm) {
  if (!perm) return;
  try {
    const b = dim.getBlock(loc);
    if (!b || (b.typeId === "minecraft:air" && perm.type.id === "minecraft:air")) return;
    b.setPermutation(perm);
  } catch {}
}
function blockId(dim, loc) {
  try {
    return dim.getBlock(loc)?.typeId ?? "unloaded";
  } catch {
    return "unloaded";
  }
}
function formatTime(total) {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
function setMode(player, mode) {
  try {
    player.setGameMode(mode);
    return;
  } catch {}
  try {
    player.runCommand(`gamemode ${mode} @s`);
  } catch {}
}
function getMode(player) {
  try {
    return String(player.getGameMode()).toLowerCase();
  } catch {
    return "survival";
  }
}
function tickingArea(a, on) {
  const dim = dimOf(a);
  try {
    dim.runCommand("tickingarea remove heist_arena");
  } catch {}
  if (!on) return;
  const { min, max } = worldBox(a);
  try {
    dim.runCommand(`tickingarea add ${min.x} ${min.y} ${min.z} ${max.x} ${max.y} ${max.z} heist_arena true`);
  } catch (e) {
    console.warn(`[Heist] Couldn't add a ticking area: ${e}`);
  }
}
// Waits (up to 15 seconds) until the whole arena is loaded.
function* waitLoaded(a) {
  const dim = dimOf(a);
  const probes = [[0, VMIN], [W - 1, VMIN], [0, VMAX], [W - 1, VMAX], [HALF, 30]];
  const start = system.currentTick;
  while (system.currentTick - start < 300) {
    if (probes.every(([u, v]) => blockId(dim, toWorld(a, u, v, 0)) !== "unloaded")) return true;
    yield;
  }
  return false;
}

// ---------- Getting the map ----------
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  system.runTimeout(() => {
    if (!game) {
      restoreMode(player);
      freeFromJail(player);
    }
    if (!initialSpawn) return;
    try {
      if (player.getDynamicProperty("heist:got_map")) return;
      const inv = player.getComponent("minecraft:inventory").container;
      const leftover = inv.addItem(new ItemStack(MAP_ID, 1));
      if (leftover) player.dimension.spawnItem(leftover, player.location);
      player.setDynamicProperty("heist:got_map", true);
      say(player, "§6You found a Heist Map! §fUse it at the edge of a big flat open space to build the Ender Manor.");
    } catch {}
  }, 60);
});

// ---------- Using the map ----------
const busy = new Set();
let building = false;
world.afterEvents.itemUse.subscribe(({ source: player, itemStack }) => {
  if (itemStack?.typeId !== MAP_ID || player?.typeId !== "minecraft:player") return;
  if (busy.has(player.id)) return;
  if (building) {
    bar(player, "§eHang on, the Ender Manor is still being built!");
    return;
  }
  busy.add(player.id);
  mapMenu(player).catch(() => {}).finally(() => busy.delete(player.id));
});

async function choose(player, title, body, buttons) {
  const form = new ActionFormData().title(title).body(body);
  for (const b of buttons) form.button(b);
  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return -1;
  return res.selection;
}

async function mapMenu(player) {
  const a = getArena();
  if (!a) {
    const pick = await choose(player, "Sneaky Heist",
      "Build the Ender Manor here? It's big: about 72 blocks wide and 84 deep, built in front of you. Stand at the edge of a big flat open space.",
      ["Build it!", "Not now"]);
    if (pick === 0) buildArena(player);
    return;
  }
  if (!nearArena(a, player, 24)) {
    const pick = await choose(player, "Sneaky Heist",
      `The Ender Manor is at ${a.stand.x}, ${a.stand.z}. There can only be one at a time.`,
      ["OK", "Take it away"]);
    if (pick === 1 && await sure(player)) removeArena(player);
    return;
  }
  const buttons = LEVELS.map((l) => `Play ${l.name}`);
  if (game) buttons.push("Stop the game");
  buttons.push("Take the Ender Manor away");
  const pick = await choose(player, "Sneaky Heist", "Sneak in, grab the treasure in the vault, and bring it back to the gold square to keep it!", buttons);
  if (pick < 0) return;
  if (pick < LEVELS.length) {
    startGame(LEVELS[pick], player);
  } else if (buttons[pick] === "Stop the game") {
    endGame("stopped");
  } else if (await sure(player)) {
    removeArena(player);
  }
}

async function sure(player) {
  return (await choose(player, "Take it away?", "The Ender Manor goes away and the land goes back to how it was. Are you sure?",
    ["Yes, take it away", "No, keep it"])) === 0;
}

// ---------- Building the Ender Manor ----------
function buildArena(player) {
  const view = player.getViewDirection();
  const f = Math.abs(view.x) > Math.abs(view.z) ? { x: Math.sign(view.x), z: 0 } : { x: 0, z: Math.sign(view.z) || 1 };
  const r = { x: -f.z, z: f.x };
  const base = { x: Math.floor(player.location.x), y: Math.floor(player.location.y + 0.01), z: Math.floor(player.location.z) };
  const a = { dim: player.dimension.id, base, f, r, built: false };
  a.stand = toWorld(a, STAND.u, STAND.v, 0);
  building = true;
  system.runJob(buildJob(player, a));
}

function* buildJob(player, a) {
  const dim = dimOf(a);
  try {
    bar(player, "§eChecking the land...");
    tickingArea(a, true);
    if (!(yield* waitLoaded(a))) {
      say(player, "§cThat area is too far away to build in. Move closer to where you want it!");
      tickingArea(a, false);
      return;
    }
    // Safety check first: don't flatten anything someone built.
    for (let v = VMIN; v <= VMAX; v++) {
      for (let u = 0; u < W; u++) {
        if (cellAt(u, v) === " ") continue;
        for (let y = -1; y <= 11; y++) {
          const id = blockId(dim, toWorld(a, u, v, y));
          if (id === "unloaded") {
            say(player, "§cThat area is too far away to build in. Move closer to where you want it!");
            tickingArea(a, false);
            return;
          }
          if (PROTECTED.some((w) => id.includes(w))) {
            say(player, "§cWhoa! The Ender Manor would knock down something already built. Try a big open space.");
            tickingArea(a, false);
            return;
          }
        }
      }
      yield;
    }

    // Save the land in a few pieces so it can go back the way it was.
    const { min, max } = worldBox(a);
    a.tiles = [];
    const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    for (let x = min.x; x <= max.x; x += 40) {
      for (let z = min.z; z <= max.z; z += 44) {
        const id = `heist:land_${stamp}_${a.tiles.length}`;
        const tMin = { x, y: min.y, z }, tMax = { x: Math.min(max.x, x + 39), y: max.y, z: Math.min(max.z, z + 43) };
        try {
          world.structureManager.createFromWorld(id, dim, tMin, tMax, { saveMode: "World", includeEntities: false, includeBlocks: true });
          a.tiles.push({ id, min: tMin });
        } catch (e) {
          console.warn(`[Heist] Couldn't save a snapshot of the land: ${e}`);
        }
        yield;
      }
    }
    saveArena(a);

    say(player, "§6Building the Ender Manor...");
    playSound("block.bell.hit", player.location, 1);

    // Clear the space and lay the floors, row by row away from you.
    for (let v = VMIN; v <= VMAX; v++) {
      for (let u = 0; u < W; u++) groundColumn(dim, a, u, v);
      yield;
    }
    // Walls, hedges, furniture, and everything else.
    for (let v = VMIN; v <= VMAX; v++) {
      for (let u = 0; u < W; u++) buildColumn(dim, a, u, v);
      if (v % 8 === 0) playSound("dig.stone", player.location, 0.8 + ((v - VMIN) / 84) * 0.6, 0.6);
      yield;
    }
    yield* extras(dim, a);

    a.built = true;
    saveArena(a);
    tickingArea(a, false);
    crown = undefined;
    ensureCrown(a);
    playSound("random.levelup", player.location, 1);
    bar(player, "§6The Ender Manor is ready!");
    say(player, "§6The Ender Manor is ready! §fPress a button on the little wall in front of you to play: " +
      "§agreen§f is Easy, §eyellow§f is Medium, §cred§f is Hard. Sneak in, grab the treasure in the vault, and bring it back to the gold square to keep it!");
  } catch (e) {
    console.warn(`[Heist] Building went wrong: ${e}`);
  } finally {
    building = false;
  }
}

const rand = (n) => Math.floor(Math.random() * n);

function groundColumn(dim, a, u, v) {
  const ch = cellAt(u, v);
  if (ch === " ") return;
  const at = (y) => toWorld(a, u, v, y);
  // Fill holes under the floor so there are no caves to fall into.
  for (let y = -3; y <= -2; y++) {
    const id = blockId(dim, at(y));
    if (id === "minecraft:air" || id.includes("water") || id.includes("lava")) setBlock(dim, at(y), B("dirt"));
  }
  let floor;
  if (INDOOR.has(ch) && ch !== "d") floor = ch === "=" ? "vault" : ch === "j" ? "jail" : "planks";
  else if (ch === "d") floor = u >= 12 && u <= 59 && v >= 24 && v <= 54 ? "planks" : "path";
  else if ("#aJ".includes(ch)) floor = ch === "J" ? "jail" : "wall";
  else if ("WGp".includes(ch)) floor = "manor";
  else if ("BcCk~".includes(ch)) floor = "planks";
  else if (ch === "y" || ch === "S" || ch === "l") floor = "yard";
  else if (ch === "H") floor = "gold";
  else if (ch === ",") floor = "path";
  else if (ch === "w" || ch === "r" || ch === "q") floor = "prismarine";
  else if (ch === "P") floor = "vault";
  else floor = "grass";
  setBlock(dim, at(-1), B(floor));
  for (let y = 0; y <= 11; y++) {
    if (blockId(dim, at(y)) !== "minecraft:air") setBlock(dim, at(y), B("air"));
  }
}

function buildColumn(dim, a, u, v) {
  const ch = cellAt(u, v);
  const at = (y) => toWorld(a, u, v, y);
  const put = (y, perm) => setBlock(dim, at(y), perm);
  switch (ch) {
    case "#":
      for (let y = 0; y <= 4; y++) put(y, Math.random() < 0.15 ? B("mossy") : B("wall"));
      if ((u + v) % 2 === 0) put(5, B("wall"));
      else if ((u + v) % 12 === 1) put(5, B("lantern"));
      break;
    case "a":
      put(3, B("chiseled")); put(4, B("wall")); put(5, B("wall"));
      break;
    case "W":
      for (let y = 0; y <= 4; y++) put(y, B("manor"));
      break;
    case "G":
      put(0, B("manor")); put(1, B("pane")); put(2, B("pane")); put(3, B("manor")); put(4, B("manor"));
      break;
    case "p":
      for (let y = 0; y <= 4; y++) put(y, B("pillar"));
      break;
    case "d":
      if (u >= 12 && u <= 59 && v >= 24 && v <= 54) { put(3, B("manor")); put(4, B("manor")); }
      break;
    case "~":
      put(0, B("carpet"));
      break;
    case "h":
      for (let y = 0; y <= 2; y++) put(y, B("leaves"));
      break;
    case "b":
      put(0, B("bush"));
      break;
    case "g":
      put(0, B("tallLow")); put(1, B("tallHigh"));
      break;
    case "f": {
      const i = (u * 7 + v * 13) % FLOWERS.length;
      put(0, tryPerm(FLOWERS[i], `flower${i}`));
      break;
    }
    case "T":
      for (let y = 0; y <= 4; y++) put(y, B("log"));
      for (let dy = 3; dy <= 6; dy++) {
        const rad = dy === 6 ? 1 : 2;
        for (let du = -rad; du <= rad; du++) {
          for (let dv = -rad; dv <= rad; dv++) {
            if ((du || dv) && dy < 5 && Math.abs(du) === 2 && Math.abs(dv) === 2) continue;
            if (!du && !dv && dy <= 4) continue;
            const loc = toWorld(a, u + du, v + dv, dy);
            if (blockId(dim, loc) === "minecraft:air") setBlock(dim, loc, B("leaves"));
          }
        }
      }
      break;
    case "r":
      put(0, B("prismarine"));
      break;
    case "w":
      put(0, B("water"));
      break;
    case "q":
      put(0, B("prismarine")); put(1, B("prismarine")); put(2, B("seaLantern"));
      break;
    case "B":
      for (let y = 0; y <= 2; y++) put(y, B("bookshelf"));
      break;
    case "c":
      put(0, v >= 46 && v <= 53 && u >= 28 && u <= 43 ? B("gold") : B("barrel"));
      break;
    case "C":
      put(0, B("barrel")); put(1, B("barrel"));
      break;
    case "k":
      put(0, B("fence")); put(1, B("tablecloth"));
      break;
    case "x":
      put(0, B("hay"));
      break;
    case "P":
      put(0, B("quartz"));
      break;
    case "J":
      for (let y = 0; y <= 3; y++) put(y, Math.random() < 0.2 ? B("jailMossy") : B("jail"));
      put(4, B("jail"));
      break;
    case "j":
      put(4, B("jail"));
      break;
    case "S":
      put(0, B("wall")); put(1, B("wall")); put(2, B("chiseled"));
      break;
    case "l":
      put(0, B("fence")); put(1, B("fence")); put(2, B("lantern"));
      break;
    default:
      break;
  }
}

function* extras(dim, a) {
  const put = (u, v, y, perm) => setBlock(dim, toWorld(a, u, v, y), perm);
  // The manor roof, with a little wall around the edge.
  for (let v = 24; v <= 54; v++) {
    for (let u = 12; u <= 59; u++) {
      put(u, v, 5, B("purpur"));
      if ((u === 12 || u === 59 || v === 24 || v === 54) && (u + v) % 2 === 0) put(u, v, 6, B("manor"));
    }
    yield;
  }
  // Hidden lights everywhere so no monsters spawn inside, even at night.
  for (let v = VMIN; v <= VMAX; v++) {
    for (let u = 0; u < W; u++) {
      const ch = cellAt(u, v);
      if (!FLOORS.has(ch) || ch === "d" || ch === "a") continue;
      const inside = INDOOR.has(ch) && ch !== "j";
      if (!(inside ? u % 5 === 2 && v % 5 === 2 : u % 6 === 3 && v % 6 === 3)) continue;
      const loc = toWorld(a, u, v, inside ? 4 : 3);
      if (blockId(dim, loc) === "minecraft:air") setBlock(dim, loc, B("light"));
    }
    if (v % 6 === 0) yield;
  }
  // Start buttons, each on a colored block with a sign over it.
  const toArena = facingOf(a, 0, 1);
  for (const b of BOARD_BUTTONS) {
    const lvl = LEVELS[b.level];
    put(b.u, -12, 1, B(["lime", "yellow", "red"][b.level]));
    put(b.u, -11, 1, button(toArena));
    put(b.u, -11, 2, wallSign(toArena));
    try {
      dim.getBlock(toWorld(a, b.u, -11, 2))?.getComponent("minecraft:sign")?.setText(lvl.name);
    } catch {}
  }
  // Jail cells: colored buttons on the back wall, lamps and bars on the front wall.
  const intoCell = facingOf(a, 1, 0);
  for (const c of CELLS) {
    for (const col of CODE_COLORS) {
      put(15, c.v0 + col.slot, 1, B(col.name));
      put(16, c.v0 + col.slot, 1, button(intoCell));
    }
    for (let i = 0; i < LAMPS; i++) put(21, c.v0 + i, 3, B("lampOn"));
    put(21, c.door, 0, B("bars")); put(21, c.door, 1, B("bars"));
    put(21, c.door - 1, 1, B("bars")); put(21, c.door + 1, 1, B("bars"));
    put(18, c.door, 3, B("light"));
  }
  yield;
}

// ---------- Taking it away ----------
function removeArena(player) {
  const a = getArena();
  if (!a) return;
  if (game) endGame("stopped");
  building = true;
  system.runJob(removeJob(player, a));
}

function* removeJob(player, a) {
  const dim = dimOf(a);
  try {
    tickingArea(a, true);
    yield* waitLoaded(a);
    for (const p of world.getAllPlayers()) {
      if (nearArena(a, p)) {
        try {
          p.teleport({ x: a.stand.x + 0.5, y: a.stand.y, z: a.stand.z + 0.5 });
        } catch {}
      }
    }
    for (const e of crownsNear(a)) e.remove();
    crown = undefined;
    const { min, max } = worldBox(a);
    for (let i = 0; i < 16; i++) {
      particle(dim, "minecraft:huge_explosion_emitter", {
        x: min.x + Math.random() * (max.x - min.x), y: a.base.y + 2 + Math.random() * 6, z: min.z + Math.random() * (max.z - min.z),
      });
    }
    playSound("random.pop", player.location, 0.6);
    let restored = 0;
    for (const t of a.tiles || []) {
      try {
        world.structureManager.place(t.id, dim, t.min);
        restored++;
      } catch (e) {
        console.warn(`[Heist] Couldn't put the land back: ${e}`);
      }
      yield;
    }
    if (!a.tiles || restored < a.tiles.length) {
      // No snapshot: clear everything above the ground and cover the ground with grass.
      for (let v = VMIN; v <= VMAX; v++) {
        for (let u = 0; u < W; u++) {
          if (cellAt(u, v) === " ") continue;
          for (let y = 0; y <= 7; y++) setBlock(dim, toWorld(a, u, v, y), B("air"));
          setBlock(dim, toWorld(a, u, v, -1), B("grass"));
        }
        yield;
      }
    }
    for (const t of a.tiles || []) {
      try {
        world.structureManager.delete(t.id);
      } catch {}
    }
    saveArena(undefined);
    tickingArea(a, false);
    say(player, "§6The Ender Manor is gone, and the land is back to how it was!");
  } finally {
    building = false;
  }
}

// ---------- The Golden Crown ----------
let crown;   // the crown entity
function crownsNear(a) {
  try {
    return dimOf(a).getEntities({ type: CROWN, location: toWorldPos(a, PEDESTAL.U, PEDESTAL.V, 1), maxDistance: 120 });
  } catch {
    return [];
  }
}
function crownHome(a) {
  return toWorldPos(a, PEDESTAL.U, PEDESTAL.V, 1.05);
}
// Keeps exactly one crown around once the arena is built (it's re-made after a reload).
function ensureCrown(a) {
  if (!a?.built) return;
  if (crown && crown.isValid()) return;
  const home = crownHome(a);
  if (blockId(dimOf(a), { x: Math.floor(home.x), y: Math.floor(home.y) - 1, z: Math.floor(home.z) }) === "unloaded") return;
  const found = crownsNear(a);
  crown = found.shift();
  for (const e of found) e.remove();
  if (!crown) {
    try {
      crown = dimOf(a).spawnEntity(CROWN, home);
    } catch {
      crown = undefined;
    }
  }
}
// Which treasure the pedestal shows: for the players in the game, or everyone nearby when there's no game.
function showPrize(a) {
  if (!crown?.isValid()) return;
  const players = game ? [...game.players.values()].map((r) => r.player) : world.getAllPlayers().filter((p) => nearArena(a, p, 48));
  const step = pedestalPrize(players);
  if (game) game.prize = step;
  if (crown.heistPrize === step) return;
  crown.heistPrize = step;
  try {
    crown.triggerEvent(`heist:prize_${LADDER[step].model}`);
  } catch {}
}
function putCrownBack(a, poof) {
  if (!crown || !crown.isValid()) {
    crown = undefined;
    ensureCrown(a);
    return;
  }
  const dim = dimOf(a);
  if (poof) for (let i = 0; i < 6; i++) particle(dim, "heist:sparkle", crown.location);
  try {
    crown.triggerEvent("heist:on_pedestal");
    crown.teleport(crownHome(a), { rotation: { x: 0, y: 0 } });
  } catch {}
  showPrize(a);
  if (poof) {
    for (let i = 0; i < 6; i++) particle(dim, "heist:sparkle", crownHome(a));
    playSound("random.orb", crownHome(a), 0.7);
  }
}

// ---------- The game ----------
let game;   // the game going on right now, or undefined

function startGame(level, presser) {
  const a = getArena();
  if (!a?.built || building) return;
  if (game) {
    bar(presser, "§eA game is already going! Use the Heist Map to stop it.");
    return;
  }
  game = {
    a, level, phase: "countdown", start: system.currentTick, players: new Map(), guards: [],
    carrier: undefined, jails: CELLS.map(() => ({ inside: new Set(), until: 0, code: [], progress: 0, open: false, openAt: 0, lit: LAMPS })),
  };
  tickingArea(a, true);
  clearMonsters(a);
  ensureCrown(a);
  putCrownBack(a, false);
  const players = world.getAllPlayers().filter((p) => nearArena(a, p, 2));
  if (presser && !players.includes(presser)) players.push(presser);
  players.forEach((p, i) => {
    join(p);
    const [u, v] = START_SPOTS[i % START_SPOTS.length];
    try {
      p.teleport(toWorldPos(a, u + 0.5, v + 0.5, 0), { rotation: { x: 0, y: yawOf(a, 0, 1) } });
    } catch {}
  });
  showPrize(a);
  spawnGuards();
  for (let i = 0; i < 3; i++) {
    system.runTimeout(() => {
      if (!game || game.phase !== "countdown") return;
      for (const p of game.players.values()) {
        bar(p.player, `§e${3 - i}`);
        try {
          p.player.playSound("note.bit", { pitch: 1, volume: 1 });
        } catch {}
      }
    }, i * 20);
  }
}

function join(player) {
  if (!game || game.players.has(player.id)) return;
  game.players.set(player.id, { player, jailed: -1, grace: 0 });
  let prev;
  try {
    prev = player.getDynamicProperty("heist:prevMode");
  } catch {}
  if (!prev) {
    const mode = getMode(player);
    try {
      player.setDynamicProperty("heist:prevMode", mode === "adventure" ? "adventure" : mode);
    } catch {}
  }
  setMode(player, "adventure");
  let toldRules;
  try {
    toldRules = player.getDynamicProperty("heist:rules");
  } catch {}
  if (!toldRules) {
    say(player, "§6Sneaky Heist! §fSneak past the Ender Guards, grab the treasure in the vault, and bring it back to the gold square to keep it. " +
      "Crouch to be sneaky, and hide in tall grass or behind crates. If a guard catches you, it's off to jail!");
    try {
      player.setDynamicProperty("heist:rules", true);
    } catch {}
  }
  let toldMap;
  try {
    toldMap = player.getDynamicProperty("heist:map_tip");
  } catch {}
  if (!toldMap) {
    say(player, "§6Tip: §fhold your Heist Map (or put it in your other hand) to see a little map of where you are. " +
      "You're the white arrow, and the gold crown shows which way the treasure is!");
    try {
      player.setDynamicProperty("heist:map_tip", true);
    } catch {}
  }
}

function leave(id) {
  const rec = game?.players.get(id);
  if (!rec) return;
  if (game.carrier === id) dropCrown(false);
  for (const j of game.jails) j.inside.delete(id);
  game.players.delete(id);
  restoreMode(rec.player);
}

function restoreMode(player) {
  let prev;
  try {
    prev = player.getDynamicProperty("heist:prevMode");
  } catch {}
  if (!prev) return;
  setMode(player, prev);
  try {
    player.setDynamicProperty("heist:prevMode", undefined);
  } catch {}
}

// Someone left in a jail cell when the game ended (or the world was closed) walks out free.
function freeFromJail(player) {
  const a = getArena();
  if (!a?.built || !nearArena(a, player)) return;
  const p = toLocal(a, player.location);
  if (p.y > -2 && p.y < 4 && CELLS.some((c) => nearCell(c, p.U, p.V))) {
    try {
      player.teleport(toWorldPos(a, 36, -4.5, 0));
    } catch {}
  }
}

function endGame(how) {
  if (!game) return;
  const g = game;
  game = undefined;
  const dim = dimOf(g.a);
  for (const gd of g.guards) poofGuard(gd, dim);
  putCrownBack(g.a, how !== "won");
  for (const rec of g.players.values()) freeFromJail(rec.player);
  g.jails.forEach((j, i) => {
    setDoor(g.a, i, false);
    setLamps(g.a, i, LAMPS);
  });
  for (const rec of g.players.values()) {
    restoreMode(rec.player);
  }
  tickingArea(g.a, false);
}

function clearMonsters(a) {
  const dim = dimOf(a);
  let mobs = [];
  try {
    mobs = dim.getEntities({ families: ["monster"], location: toWorldPos(a, 36, 30, 1), maxDistance: 70 });
  } catch {}
  for (const m of mobs) {
    if (m.typeId === GUARD) continue;
    try {
      const p = toLocal(a, m.location);
      if (p.U < 0 || p.U > W || p.V < VMIN || p.V > VMAX + 1) continue;
      particle(dim, "minecraft:huge_explosion_emitter", m.location);
      m.remove();
    } catch {}
  }
}

// ---------- Ender Guards ----------
const VARIANT_EVENTS = ["heist:walk", "heist:look", "heist:run", "heist:idle"];

function spawnGuards() {
  const g = game, a = g.a, dim = dimOf(a);
  const taken = [];
  for (let i = 0; i < g.level.guards; i++) {
    const vault = g.level.vaultGuard && i === 0;
    const pool = (vault ? VAULT_SPOTS : SPOTS).filter((s) => s.v >= 22 && !taken.some((t) => Math.hypot(t.u - s.u, t.v - s.v) < 9));
    const s = pool.length ? pool[rand(pool.length)] : SPOTS[rand(SPOTS.length)];
    taken.push(s);
    const gd = {
      U: s.u + 0.5, V: s.v + 0.5, yaw: rand(360), vault, state: "idle", path: [], spot: s, recent: [s],
      until: g.start + COUNTDOWN + 20 + rand(60), susp: 0, target: undefined, lastSeen: undefined, lastSeenAt: 0, variant: -1,
      lookBase: rand(360), repath: 0,
    };
    try {
      gd.e = dim.spawnEntity(GUARD, toWorldPos(a, gd.U, gd.V, 0));
    } catch (e) {
      console.warn(`[Heist] Couldn't spawn a guard: ${e}`);
      continue;
    }
    for (let k = 0; k < 8; k++) particle(dim, "minecraft:mob_portal", toWorldPos(a, gd.U + Math.random() - 0.5, gd.V + Math.random() - 0.5, Math.random() * 2.5));
    setVariant(gd, 3);
    g.guards.push(gd);
  }
}

function poofGuard(gd, dim) {
  if (!gd.e?.isValid()) return;
  for (let k = 0; k < 8; k++) {
    particle(dim, "minecraft:mob_portal", { x: gd.e.location.x + Math.random() - 0.5, y: gd.e.location.y + Math.random() * 2.5, z: gd.e.location.z + Math.random() - 0.5 });
  }
  playSound("mob.endermen.portal", gd.e.location, 1.2, 0.6);
  try {
    gd.e.remove();
  } catch {}
}

function setVariant(gd, n) {
  if (gd.variant === n) return;
  gd.variant = n;
  try {
    gd.e.triggerEvent(VARIANT_EVENTS[n]);
  } catch {}
}

// Path finding on the map grid: 8 directions, no cutting corners.
function findPath(from, to) {
  if (!guardWalk(to.u, to.v) || !guardWalk(from.u, from.v)) return undefined;
  const key = (u, v) => (v - VMIN) * W + u;
  const prev = new Map([[key(from.u, from.v), -1]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    if (c.u === to.u && c.v === to.v) {
      const out = [];
      let k = key(c.u, c.v);
      while (k !== -1) {
        out.push({ u: k % W, v: Math.floor(k / W) + VMIN });
        k = prev.get(k);
      }
      out.pop();
      return out.reverse();
    }
    for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nu = c.u + du, nv = c.v + dv;
      if (prev.has(key(nu, nv)) || !guardWalk(nu, nv)) continue;
      if (du && dv && (!guardWalk(c.u + du, c.v) || !guardWalk(c.u, c.v + dv))) continue;
      prev.set(key(nu, nv), key(c.u, c.v));
      queue.push({ u: nu, v: nv });
    }
  }
  return undefined;
}

// Can a guard walk straight from a to b? (Its body is about 0.6 wide.)
function clearWalk(a, b) {
  const dist = Math.hypot(b.U - a.U, b.V - a.V);
  const steps = Math.max(1, Math.ceil(dist / 0.2));
  for (let i = 1; i <= steps; i++) {
    const U = a.U + ((b.U - a.U) * i) / steps, V = a.V + ((b.V - a.V) * i) / steps;
    for (const [ou, ov] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
      if (!guardWalk(Math.floor(U + ou), Math.floor(V + ov))) return false;
    }
  }
  return true;
}

// Can the guard see the player? The guard's eyes, the player, and everything in between, on the map grid.
function canSee(gd, p, level, chasing) {
  const du = p.U - gd.U, dv = p.V - gd.V;
  const d = Math.hypot(du, dv);
  if (p.y < -1 || p.y > 3) return false;
  const here = cellAt(Math.floor(p.U), Math.floor(p.V));
  const inGrass = here === "g";
  if (inGrass && p.sneaking && d > 1.6) return false;           // hidden in the tall grass
  let range = level.sight * (chasing ? 1.3 : 1);
  if (p.sneaking && !chasing) range *= 0.55;
  if (inGrass) range *= 0.7;
  if (d > range) return false;
  if (!chasing && !(d < 2.5 && !p.sneaking)) {
    // Guards see in front of them (a wide cone), and hear you if you walk right up behind them.
    const yaw = (gd.yaw * Math.PI) / 180;
    const fu = -Math.sin(yaw), fv = Math.cos(yaw);
    if ((du * fu + dv * fv) / (d || 1) < 0.5) return false;
  }
  // Walk along the line between them.
  const steps = Math.ceil(d / 0.25);
  for (let i = 1; i < steps; i++) {
    const U = gd.U + (du * i) / steps, V = gd.V + (dv * i) / steps;
    const cu = Math.floor(U), cv = Math.floor(V);
    if (cu === Math.floor(gd.U) && cv === Math.floor(gd.V)) continue;
    if (cu === Math.floor(p.U) && cv === Math.floor(p.V)) continue;
    const ch = cellAt(cu, cv);
    if (OPAQUE.has(ch)) return false;
    if (LOW.has(ch) && p.sneaking && Math.hypot(p.U - U, p.V - V) < 1.7) return false;   // crouching behind a crate
  }
  return true;
}

// The guard's yaw in arena terms: 0 means facing +v. (World yaw is worked out when teleporting.)
function faceToward(gd, du, dv, turn = 1) {
  if (!du && !dv) return;
  const want = (Math.atan2(-du, dv) * 180) / Math.PI;
  let diff = ((want - gd.yaw + 540) % 360) - 180;
  gd.yaw += Math.max(-30 * turn, Math.min(30 * turn, diff));
}

function cellOf(o) {
  return { u: Math.floor(o.U), v: Math.floor(o.V) };
}

function goTo(gd, cell) {
  const path = findPath(cellOf(gd), cell);
  if (!path) return false;
  gd.path = path.map((c) => ({ U: c.u + 0.5, V: c.v + 0.5 }));
  return true;
}

function step(gd, speed) {
  let left = speed;
  while (left > 0 && gd.path.length) {
    while (gd.path.length > 1 && clearWalk(gd, gd.path[1])) gd.path.shift();
    const t = gd.path[0];
    const du = t.U - gd.U, dv = t.V - gd.V, d = Math.hypot(du, dv);
    faceToward(gd, du, dv, speed > 0.1 ? 1.5 : 0.6);
    if (d <= left) {
      gd.U = t.U; gd.V = t.V;
      gd.path.shift();
      left -= d;
    } else {
      gd.U += (du / d) * left; gd.V += (dv / d) * left;
      left = 0;
    }
  }
  return gd.path.length === 0;
}

function pickSpot(gd) {
  const g = game;
  const pool = gd.vault ? VAULT_SPOTS : SPOTS;
  const busySpots = g.guards.filter((o) => o !== gd).map((o) => o.spot);
  let options = pool.filter((s) => {
    const d = Math.hypot(s.u - gd.U, s.v - gd.V);
    return d >= (gd.vault ? 4 : 8) && d <= (gd.vault ? 18 : 30) && !gd.recent.includes(s) && !busySpots.includes(s);
  });
  if (!options.length) options = pool.filter((s) => !busySpots.includes(s) && s !== gd.spot);
  const s = options[rand(options.length)];
  gd.recent.push(s);
  if (gd.recent.length > 4) gd.recent.shift();
  gd.spot = s;
  return s;
}

function guardTick(gd, now) {
  const g = game, a = g.a, lvl = g.level;
  if (!gd.e?.isValid()) return;

  // Look for robbers every other tick.
  if (now % 2 === 0 && g.phase === "play") {
    let best, bestD = Infinity;
    for (const rec of g.players.values()) {
      if (rec.jailed >= 0 || now < rec.grace) continue;
      const p = rec.pos;
      if (!p) continue;
      const chasingThis = gd.state === "chase" && gd.target === rec.player.id;
      if (!canSee(gd, p, lvl, chasingThis)) continue;
      const d = Math.hypot(p.U - gd.U, p.V - gd.V);
      if (d < bestD) { best = rec; bestD = d; }
    }
    if (gd.state === "chase") {
      const tracked = best && (best.player.id === gd.target || bestD < 4) ? best : undefined;
      if (tracked) {
        gd.target = tracked.player.id;
        gd.lastSeen = { U: tracked.pos.U, V: tracked.pos.V };
        gd.lastSeenAt = now;
      }
    } else if (best) {
      gd.susp += bestD < 3 ? 6 : 2;
      if (gd.state !== "suspicious") {
        gd.resume = gd.state;
        gd.state = "suspicious";
        particle(dimOf(a), "heist:question", toWorldPos(a, gd.U, gd.V, 3.1));
        playSound("note.bell", toWorldPos(a, gd.U, gd.V, 2), 1.4, 0.8);
      }
      gd.suspect = best.player.id;
      gd.lastSeen = { U: best.pos.U, V: best.pos.V };
      if (gd.susp >= lvl.notice) {
        gd.state = "chase";
        gd.target = best.player.id;
        gd.lastSeenAt = now;
        gd.path = [];
        gd.repath = 0;
        particle(dimOf(a), "heist:alert", toWorldPos(a, gd.U, gd.V, 3.1));
        const loc = toWorldPos(a, gd.U, gd.V, 2);
        playSound("note.flute", loc, 1.8, 1);
        system.runTimeout(() => playSound("note.flute", loc, 2, 1), 3);
        system.runTimeout(() => playSound("note.flute", loc, 1.8, 1), 6);
      }
    } else if (gd.state === "suspicious") {
      gd.susp -= 1;
      if (gd.susp <= 0) {
        gd.susp = 0;
        // Something was there... go take a look.
        gd.state = "search";
        gd.path = [];
      }
    }
  }

  switch (gd.state) {
    case "idle": {   // standing at a spot, looking around
      setVariant(gd, 3);
      gd.yaw = gd.lookBase + Math.sin(now * 0.05) * 70;
      if (g.phase === "play" && now >= gd.until) {
        const s = pickSpot(gd);
        if (s && goTo(gd, s)) {
          gd.state = "patrol";
        } else {
          gd.until = now + 20;
        }
      }
      break;
    }
    case "patrol": {
      setVariant(gd, 0);
      if (step(gd, lvl.walk)) {
        gd.state = "idle";
        gd.lookBase = gd.yaw;
        gd.until = now + 40 + rand(80);
      }
      break;
    }
    case "suspicious": {
      setVariant(gd, 1);
      if (gd.lastSeen) faceToward(gd, gd.lastSeen.U - gd.U, gd.lastSeen.V - gd.V, 0.5);
      break;
    }
    case "search": {   // walk to where the robber was last seen
      setVariant(gd, 0);
      if (!gd.path.length && gd.lastSeen) {
        const c = nearestWalk(Math.floor(gd.lastSeen.U), Math.floor(gd.lastSeen.V), 2);
        gd.lastSeen = undefined;
        if (!c || !goTo(gd, c)) gd.path = [];
      }
      if (step(gd, lvl.walk * 1.4)) {
        gd.state = "idle";
        gd.lookBase = gd.yaw;
        gd.until = now + 60;
      }
      break;
    }
    case "chase": {
      setVariant(gd, 2);
      const rec = g.players.get(gd.target);
      const lost = !rec || rec.jailed >= 0 || now < rec.grace || now - gd.lastSeenAt > 60;
      if (lost) {
        // Lost them: look around where they were last seen.
        gd.state = "search";
        gd.susp = Math.floor(lvl.notice / 2);
        gd.path = [];
        if (!rec || rec.jailed >= 0 || now < rec.grace) gd.lastSeen = undefined;
        break;
      }
      const goal = gd.lastSeen;
      const direct = clearWalk(gd, goal);
      if (direct) {
        gd.path = [goal];
      } else if (now >= gd.repath || !gd.path.length) {
        gd.repath = now + 8;
        const c = nearestWalk(Math.floor(goal.U), Math.floor(goal.V), 2);
        if (!c || !goTo(gd, c)) gd.path = [];
      }
      step(gd, lvl.run);
      break;
    }
  }

  // Tag! Anybody close enough is caught.
  if (g.phase === "play") {
    for (const rec of g.players.values()) {
      if (rec.jailed >= 0 || now < rec.grace || !rec.pos) continue;
      if (Math.abs(rec.pos.y) > 2) continue;
      if (Math.hypot(rec.pos.U - gd.U, rec.pos.V - gd.V) < CATCH_RANGE) {
        caught(rec, gd);
        gd.state = "idle";
        gd.lookBase = gd.yaw;
        gd.until = now + 60;
        gd.susp = 0;
        gd.path = [];
        break;
      }
    }
  }

  try {
    gd.e.teleport(toWorldPos(a, gd.U, gd.V, 0), { rotation: { x: 0, y: worldYaw(a, gd.yaw) } });
  } catch {}
}

// Arena yaw (0 = facing +v) -> world yaw.
function worldYaw(a, yaw) {
  const t = (yaw * Math.PI) / 180;
  return yawOf(a, -Math.sin(t), Math.cos(t));
}

// ---------- Getting caught, and jail ----------
function caught(rec, gd) {
  const g = game, a = g.a, dim = dimOf(a);
  const p = rec.player;
  const from = p.location;
  for (let k = 0; k < 12; k++) particle(dim, "minecraft:mob_portal", { x: from.x + Math.random() - 0.5, y: from.y + Math.random() * 2, z: from.z + Math.random() - 0.5 });
  playSound("mob.endermen.portal", from, 1, 1);
  if (g.carrier === p.id) dropCrown(true);
  // Into the emptier cell.
  let ci = g.jails[0].inside.size <= g.jails[1].inside.size ? 0 : 1;
  const cell = CELLS[ci], j = g.jails[ci];
  j.inside.add(p.id);
  rec.jailed = ci;
  for (const o of g.guards) if (o.target === p.id && o.state === "chase") { o.state = "search"; o.path = []; o.lastSeen = undefined; }
  // A new prisoner relights the lamps and gets a new code.
  for (const other of g.players.values()) {
    if (other.jailed !== ci && other.pos && nearCell(cell, other.pos.U, other.pos.V)) {
      try {
        other.player.teleport(toWorldPos(a, 24.5, cell.door + 0.5, 0));
      } catch {}
    }
  }
  j.until = system.currentTick + JAIL_TICKS;
  j.progress = 0;
  j.open = false;
  setDoor(a, ci, false);
  setLamps(a, ci, LAMPS);
  newCode(a, ci, g.level.code);
  try {
    p.teleport(toWorldPos(a, 19, (cell.v0 + cell.v1) / 2 + 0.5, 0), { rotation: { x: 0, y: yawOf(a, -1, 0) } });
  } catch {}
  system.runTimeout(() => playSound("mob.endermen.portal", toWorldPos(a, 18.5, cell.door + 0.5, 1), 1.3, 1), 2);
  let told;
  try {
    told = p.getDynamicProperty("heist:jail_tip");
  } catch {}
  if (!told) {
    say(p, "§cCaught! §fYou're in jail until the 5 lamps go out. Or break out: press the colored buttons in the same order as the colors up high on the wall!");
    try {
      p.setDynamicProperty("heist:jail_tip", true);
    } catch {}
  }
}

function newCode(a, ci, len) {
  const j = game.jails[ci], cell = CELLS[ci], dim = dimOf(a);
  j.code = [];
  for (let i = 0; i < len; i++) {
    let c;
    do c = CODE_COLORS[rand(CODE_COLORS.length)]; while (j.code.length && c === j.code[j.code.length - 1]);
    j.code.push(c);
  }
  const slots = CODE_SLOTS[len] || CODE_SLOTS[3];
  for (let s = 0; s < 5; s++) {
    const i = slots.indexOf(s);
    setBlock(dim, toWorld(a, 15, cell.v0 + s, 3), i >= 0 ? B(j.code[i].name) : B("jail"));
  }
}

function setDoor(a, ci, open) {
  const cell = CELLS[ci], dim = dimOf(a);
  for (const y of [0, 1]) setBlock(dim, toWorld(a, 21, cell.door, y), open ? B("air") : B("bars"));
}

function setLamps(a, ci, lit) {
  const cell = CELLS[ci], dim = dimOf(a);
  if (game) game.jails[ci].lit = lit;
  for (let i = 0; i < LAMPS; i++) setBlock(dim, toWorld(a, 21, cell.v1 - i, 3), i < lit ? B("lampOn") : B("lampOff"));
}

function openCell(ci, how) {
  const g = game, a = g.a, j = g.jails[ci], cell = CELLS[ci];
  j.open = true;
  j.openAt = system.currentTick;
  setDoor(a, ci, true);
  setLamps(a, ci, 0);
  const at = toWorldPos(a, 21.5, cell.door + 0.5, 1);
  playSound(how === "solved" ? "random.levelup" : "random.door_open", at, 1, 1);
  if (how === "solved") for (let k = 0; k < 10; k++) particle(dimOf(a), "minecraft:villager_happy", toWorldPos(a, 18 + Math.random() * 2, cell.v0 + Math.random() * 5, Math.random() * 2.5));
  for (const id of j.inside) {
    const rec = g.players.get(id);
    if (!rec) continue;
    rec.jailed = -1;
    rec.grace = system.currentTick + GRACE_TICKS;
  }
  j.inside.clear();
}

function jailTick(now) {
  const g = game, a = g.a;
  g.jails.forEach((j, ci) => {
    const cell = CELLS[ci];
    if (j.inside.size) {
      const left = j.until - now;
      const lit = Math.max(0, Math.ceil((left / JAIL_TICKS) * LAMPS));
      if (lit !== j.lit) {
        setLamps(a, ci, lit);
        playSound("random.click", toWorldPos(a, 18.5, cell.door + 0.5, 3), 0.8, 0.8);
      }
      if (left <= 0) {
        openCell(ci, "time");
        return;
      }
      // Prisoners stay in the cell (even if the door is open for someone else).
      for (const id of j.inside) {
        const rec = g.players.get(id);
        if (rec?.pos && !inCell(cell, Math.floor(rec.pos.U), Math.floor(rec.pos.V))) {
          try {
            rec.player.teleport(toWorldPos(a, 19, (cell.v0 + cell.v1) / 2 + 0.5, 0));
          } catch {}
        }
      }
    }
    if (now % 10 !== 0) return;
    // Anyone who isn't a prisoner of this cell, near it or in it.
    const freeNear = [...g.players.values()].filter((rec) => rec.jailed !== ci && rec.pos && nearCell(cell, rec.pos.U, rec.pos.V));
    // Nobody free can ever be shut in: the door opens for them.
    if (!j.open && freeNear.some((rec) => inCell(cell, Math.floor(rec.pos.U), Math.floor(rec.pos.V)))) {
      j.open = true;
      j.openAt = now;
      setDoor(a, ci, true);
    }
    // Close the door once everyone free has walked away from it.
    if (j.open && now - j.openAt > DOOR_OPEN_TICKS && !freeNear.length) {
      j.open = false;
      setDoor(a, ci, false);
      if (!j.inside.size) setLamps(a, ci, LAMPS);
    }
  });
}

const lastPress = new Map();
function onButton(block, player) {
  const a = getArena();
  if (!a?.built || block.dimension?.id !== undefined && block.dimension.id !== a.dim) return;
  const k = `${block.location.x},${block.location.y},${block.location.z}`;
  if ((lastPress.get(k) ?? -99) > system.currentTick - 4) return;   // the same press, seen twice
  lastPress.set(k, system.currentTick);
  const l = toLocal(a, { x: block.location.x + 0.5, y: block.location.y, z: block.location.z + 0.5 });
  const u = Math.floor(l.U), v = Math.floor(l.V), y = Math.round(l.y);
  if (y !== 1) return;
  const b = v === -11 && BOARD_BUTTONS.find((o) => o.u === u);
  if (b) {
    if (player) startGame(LEVELS[b.level], player);
    return;
  }
  if (u !== 16 || !game) return;
  const ci = CELLS.findIndex((c) => v >= c.v0 && v <= c.v1);
  if (ci < 0) return;
  const j = game.jails[ci], cell = CELLS[ci];
  if (!j.inside.size || j.open) return;
  const color = CODE_COLORS.find((c) => cell.v0 + c.slot === v);
  if (!color) return;
  const at = toWorldPos(a, 16.5, v + 0.5, 1.5);
  if (j.code[j.progress] === color) {
    j.progress++;
    playSound("note.pling", at, 0.9 + j.progress * 0.15, 1);
    particle(dimOf(a), "minecraft:villager_happy", at);
    if (j.progress >= j.code.length) openCell(ci, "solved");
  } else {
    j.progress = 0;
    playSound("note.bass", at, 0.6, 1);
  }
}
world.afterEvents.playerInteractWithBlock?.subscribe(({ player, block }) => {
  if (block?.typeId?.includes("button")) onButton(block, player);
});
world.afterEvents.buttonPush?.subscribe(({ block, source }) => {
  if (source?.typeId === "minecraft:player") onButton(block, source);
});

// ---------- Carrying the crown ----------
function dropCrown(poof) {
  if (!game) return;
  game.carrier = undefined;
  putCrownBack(game.a, poof);
}

function crownTick(now) {
  const g = game, a = g.a, dim = dimOf(a);
  if (!crown?.isValid()) ensureCrown(a);
  if (!crown) return;
  if (!g.carrier) {
    if (now % 10 === 0) particle(dim, "heist:sparkle", toWorldPos(a, PEDESTAL.U + Math.random() - 0.5, PEDESTAL.V + Math.random() - 0.5, 1.2 + Math.random() * 0.6));
    if (g.phase !== "play") return;
    for (const rec of g.players.values()) {
      if (rec.jailed >= 0 || !rec.pos || Math.abs(rec.pos.y) > 2) continue;
      if (Math.hypot(rec.pos.U - PEDESTAL.U, rec.pos.V - PEDESTAL.V) < GRAB_RANGE) {
        g.carrier = rec.player.id;
        try {
          crown.triggerEvent("heist:carried");
        } catch {}
        playSound("random.orb", rec.player.location, 1.2, 1);
        playSound("note.chime", rec.player.location, 1.5, 1);
        let told;
        try {
          told = rec.player.getDynamicProperty("heist:crown_tip");
        } catch {}
        if (!told) {
          bar(rec.player, "§6You got it! Bring it back to the gold square to keep it!");
          try {
            rec.player.setDynamicProperty("heist:crown_tip", true);
          } catch {}
        }
        break;
      }
    }
    return;
  }
  const rec = g.players.get(g.carrier);
  if (!rec) {
    dropCrown(true);
    return;
  }
  const l = rec.player.location;
  try {
    crown.teleport({ x: l.x, y: l.y + 2.15, z: l.z });
  } catch {}
  if (now % 3 === 0) particle(dim, "heist:sparkle", { x: l.x + Math.random() - 0.5, y: l.y + 0.3 + Math.random() * 1.5, z: l.z + Math.random() - 0.5 });
  const p = rec.pos;
  if (g.phase === "play" && p && p.U >= HOME.u0 && p.U < HOME.u1 + 1 && p.V >= HOME.v0 && p.V < HOME.v1 + 1 && Math.abs(p.y) < 2) win(rec);
}

function win(rec) {
  const g = game, a = g.a, dim = dimOf(a);
  g.phase = "won";
  g.wonAt = system.currentTick;
  const seconds = Math.max(1, Math.round((system.currentTick - g.start - COUNTDOWN) / 20));
  const home = toWorldPos(a, 36, -4.5, 1);
  playSound("random.levelup", home, 1, 1);
  playSound("random.totem", home, 1.2, 0.6);
  for (let i = 0; i < 6; i++) {
    system.runTimeout(() => {
      try {
        dim.spawnEntity("minecraft:fireworks_rocket", toWorldPos(a, 33 + Math.random() * 6, -7 + Math.random() * 5, 0.5));
      } catch {}
      for (let k = 0; k < 4; k++) particle(dim, "minecraft:totem_particle", toWorldPos(a, 34 + Math.random() * 4, -6 + Math.random() * 4, 1 + Math.random() * 2));
      playSound("firework.launch", home, 1, 1);
    }, i * 8);
  }
  // The treasure she carried home poofs into sparkles: it's hers now.
  try {
    for (let k = 0; k < 10; k++) particle(dim, "heist:sparkle", rec.player.location);
    for (let k = 0; k < 6; k++) particle(dim, "minecraft:totem_particle", rec.player.location);
  } catch {}
  const shown = g.prize;
  const who = rec.player.name;
  for (const other of g.players.values()) {
    const p = other.player;
    const prop = `heist:best_${g.level.name}`;
    let best;
    try {
      best = p.getDynamicProperty(prop);
    } catch {}
    let msg = `§6${who} brought the ${LADDER[shown].name} home in ${formatTime(seconds)}! §f(${g.level.name})`;
    if (typeof best !== "number" || seconds < best) {
      try {
        p.setDynamicProperty(prop, seconds);
      } catch {}
      if (typeof best === "number") msg += " §aNew best time!";
    } else {
      msg += ` §7Best: ${formatTime(best)}`;
    }
    say(p, msg);
    const got = givePrize(p);
    bar(p, `§6You got the ${got.name}!`);
  }
  for (const gd of g.guards) setVariant(gd, 3);
  // Right away, the next treasure appears on the pedestal.
  putCrownBack(a, false);
}

// ---------- The treasure ladder ----------
// Each player climbs the ladder one win at a time: crown, boots, pants, chestplate, sword, enchanted apple, and
// after that a treasure chest full of surprises every time. Player property `heist:prizes` = how many steps won.
// `model` is the treasure entity's variant (which model shows on the pedestal), `slot` is where it's put on.
const LADDER = [
  { name: "Golden Crown", item: "heist:golden_crown", slot: "Head", model: 0 },
  { name: "Golden Boots", item: "minecraft:golden_boots", slot: "Feet", model: 1 },
  { name: "Golden Pants", item: "minecraft:golden_leggings", slot: "Legs", model: 2, rename: true },
  { name: "Golden Chestplate", item: "minecraft:golden_chestplate", slot: "Chest", model: 3 },
  { name: "Golden Sword", item: "minecraft:golden_sword", model: 4 },
  { name: "Enchanted Golden Apple", item: "minecraft:enchanted_golden_apple", model: 5 },
  { name: "Treasure Chest", model: 6 },
];
const TREASURE = LADDER.length - 1;
const PRIZES = [
  ["minecraft:diamond", 3], ["minecraft:emerald", 8], ["minecraft:golden_apple", 2], ["minecraft:cake", 1],
  ["minecraft:cookie", 16], ["minecraft:firework_rocket", 12], ["minecraft:gold_block", 2], ["minecraft:name_tag", 2],
  ["minecraft:amethyst_shard", 8], ["minecraft:glow_ink_sac", 6], ["minecraft:totem_of_undying", 1], ["minecraft:diamond_horse_armor", 1],
];

function prizeStep(player) {
  let n;
  try {
    n = player.getDynamicProperty("heist:prizes");
  } catch {}
  return typeof n === "number" ? Math.min(n, TREASURE) : 0;
}

// The treasure on the pedestal: the next one for whoever is furthest behind (so nobody skips a step).
function pedestalPrize(players) {
  if (!players.length) return 0;
  return Math.min(...players.map(prizeStep));
}

function giveItem(player, item, slot) {
  if (slot) {
    try {
      const eq = player.getComponent("minecraft:equippable");
      if (eq && !eq.getEquipment(slot)) {
        eq.setEquipment(slot, item);
        return;
      }
    } catch {}
  }
  try {
    const inv = player.getComponent("minecraft:inventory").container;
    const left = inv.addItem(item);
    if (left) player.dimension.spawnItem(left, player.location);
  } catch {
    try {
      player.dimension.spawnItem(item, player.location);
    } catch {}
  }
}

function givePrize(player) {
  const step = prizeStep(player);
  const prize = LADDER[step];
  if (step < TREASURE) {
    let item;
    try {
      item = new ItemStack(prize.item, 1);
      if (prize.rename) item.nameTag = prize.name;
    } catch {
      item = new ItemStack("minecraft:gold_ingot", 5);   // the Golden Crown item is missing somehow
    }
    giveItem(player, item, prize.slot);
    try {
      player.setDynamicProperty("heist:prizes", step + 1);
    } catch {}
  } else {
    // The treasure chest: three different surprises.
    const pool = [...PRIZES].sort(() => Math.random() - 0.5);
    let n = 0;
    for (const [id, count] of pool) {
      if (n >= 3) break;
      try {
        giveItem(player, new ItemStack(id, count));
        n++;
      } catch {}
    }
    try {
      player.setDynamicProperty("heist:prizes", step + 1);
    } catch {}
  }
  return prize;
}

// ---------- Every tick ----------
system.runInterval(() => {
  const now = system.currentTick;
  if (!game) {
    if (now % 40 === 0) {
      const a = getArena();
      if (a?.built && !building && world.getAllPlayers().some((p) => nearArena(a, p, 48))) {
        ensureCrown(a);
        showPrize(a);
        if (crown?.isValid()) particle(dimOf(a), "heist:sparkle", toWorldPos(a, PEDESTAL.U + Math.random() - 0.5, PEDESTAL.V + Math.random() - 0.5, 1.4));
      }
    }
    if (now % 100 === 50) {
      sweepStrays();
      for (const p of world.getAllPlayers()) freeFromJail(p);
    }
    return;
  }
  const g = game, a = g.a;
  if (now % 20 === 0 && !getArena()) {
    game = undefined;
    return;
  }

  // Who's playing, and where they are.
  if (now % 10 === 0) {
    for (const p of world.getAllPlayers()) {
      if (!g.players.has(p.id) && nearArena(a, p, 0) && g.phase !== "won") join(p);
    }
    for (const [id, rec] of [...g.players]) {
      let valid = false;
      try {
        valid = rec.player.isValid();
      } catch {}
      if (!valid || !nearArena(a, rec.player, 4)) leave(id);
    }
    if (!g.players.size) {
      endGame("empty");
      return;
    }
  }
  for (const rec of g.players.values()) {
    try {
      const l = toLocal(a, rec.player.location);
      rec.pos = { U: l.U, V: l.V, y: l.y, sneaking: !!rec.player.isSneaking };
    } catch {
      rec.pos = undefined;
    }
  }

  if (g.phase === "countdown" && now - g.start >= COUNTDOWN) {
    g.phase = "play";
    for (const rec of g.players.values()) {
      bar(rec.player, `§aGo! Sneak in and get the ${LADDER[g.prize ?? 0].name}!`);
      try {
        rec.player.playSound("note.bit", { pitch: 2, volume: 1 });
      } catch {}
    }
  }
  if (g.phase === "won" && now - g.wonAt > 100) {
    endGame("won");
    return;
  }

  if (g.phase !== "won") for (const gd of g.guards) guardTick(gd, now);
  crownTick(now);
  jailTick(now);
  if (now % 100 === 0) clearMonsters(a);
}, 1);

// ---------- The little map ----------
// While you hold the Heist Map (in either hand) near the Ender Manor, a little map shows above the hotbar,
// drawn with the pack's own picture characters (font/glyph_E7.png, characters U+E700 and up). You're the
// white arrow in the middle, always facing up; each square is 2 x 2 blocks. Guards show on Easy and Medium
// (purple eyes, yellow when they're suspicious, red when they're chasing). The crown shows where it is, or at
// the edge pointing the way if it's farther; while you carry it, the gold square shows the way home instead.
const RADAR_W = 13, RADAR_H = 11, RADAR_S = 2;
const RC = RADAR_W >> 1, RR = RADAR_H >> 1;
const GL = {
  out: 0, grass: 1, tall: 2, flower: 3, path: 4, yard: 5, floor: 6, carpet: 7, vault: 8, wall: 9, manor: 10, hedge: 11,
  door: 6, tree: 12, water: 13, furn: 14, bush: 15, jail: 16, cell: 17, home: 18, pedestal: 19, rim: 20,
  you: 32, friend: 33, guard: 34, guardHuh: 35, guardChase: 36, crown: 37, homeMark: 38,
};
const glyph = (i) => String.fromCharCode(0xe700 + i);
const TILE = {
  " ": "out", ".": "grass", ",": "path", "y": "yard", "H": "home", "#": "wall", "a": "path", "W": "manor", "G": "manor", "p": "manor",
  "d": "door", "_": "floor", "~": "carpet", "=": "vault", "P": "pedestal", "h": "hedge", "b": "bush", "g": "tall", "f": "flower",
  "T": "tree", "r": "rim", "w": "water", "q": "rim", "B": "furn", "c": "furn", "C": "furn", "k": "furn", "x": "furn",
  "J": "jail", "S": "jail", "l": "jail", "j": "cell",
};
// When a square covers more than one kind of block, the first kind in this list wins (doorways always show).
const RANK = ["door", "wall", "manor", "jail", "hedge", "tree", "pedestal", "home", "water", "rim", "furn", "bush", "carpet",
  "vault", "cell", "tall", "flower", "floor", "path", "yard", "grass", "out"];

function heldMap(player) {
  let eq;
  try {
    eq = player.getComponent("minecraft:equippable");
  } catch {}
  for (const slot of ["Mainhand", "Offhand"]) {
    try {
      if (eq?.getEquipment(slot)?.typeId === MAP_ID) return true;
    } catch {}
  }
  return false;
}

function radarFor(player, a) {
  // Which way you're facing, snapped to the manor's four directions (the map turns when you turn past a corner),
  // so every square lines up with a real 2 x 2 patch of the manor and the walls stay crisp.
  let vu = 0, vv = 1;
  try {
    const v = player.getViewDirection();
    vu = v.x * a.r.x + v.z * a.r.z; vv = v.x * a.f.x + v.z * a.f.z;
  } catch {}
  if (Math.abs(vu) < 0.02 && Math.abs(vv) < 0.02) {
    try {
      const yaw = (player.getRotation().y * Math.PI) / 180;
      const x = -Math.sin(yaw), z = Math.cos(yaw);
      vu = x * a.r.x + z * a.r.z; vv = x * a.f.x + z * a.f.z;
    } catch {}
  }
  const [fu, fv] = Math.abs(vu) > Math.abs(vv) ? [Math.sign(vu), 0] : [0, Math.sign(vv) || 1];
  const [ru, rv] = [fv, -fu];                    // your right hand
  const me = toLocal(a, player.location);
  const bu = Math.floor(me.U / RADAR_S) * RADAR_S, bv = Math.floor(me.V / RADAR_S) * RADAR_S;   // your 2 x 2 patch
  const grid = [];
  for (let row = 0; row < RADAR_H; row++) {
    const line = [];
    for (let col = 0; col < RADAR_W; col++) {
      const k = col - RC, m = RR - row;
      const u0 = bu + RADAR_S * (k * ru + m * fu), v0 = bv + RADAR_S * (k * rv + m * fv);
      let best = RANK.length - 1;
      for (let du = 0; du < RADAR_S; du++) {
        for (let dv = 0; dv < RADAR_S; dv++) {
          const r = RANK.indexOf(TILE[cellAt(u0 + du, v0 + dv)] || "out");
          if (r < best) best = r;
        }
      }
      line.push(GL[RANK[best]]);
    }
    grid.push(line);
  }
  // Where something lands on the little map (clamped to the edge, pointing the way, if it's off it).
  const spot = (loc, clamp) => {
    const l = toLocal(a, loc);
    const du = (l.U - bu - RADAR_S / 2) / RADAR_S, dv = (l.V - bv - RADAR_S / 2) / RADAR_S;
    let c = du * ru + dv * rv, r = -(du * fu + dv * fv);
    if (Math.abs(Math.round(c)) > RC || Math.abs(Math.round(r)) > RR) {
      if (!clamp) return undefined;
      const t = Math.min(RC / Math.abs(c || 1e-6), RR / Math.abs(r || 1e-6));
      c *= t; r *= t;
    }
    return { col: Math.max(0, Math.min(RADAR_W - 1, RC + Math.round(c))), row: Math.max(0, Math.min(RADAR_H - 1, RR + Math.round(r))) };
  };
  const mark = (loc, g, clamp) => {
    const s = spot(loc, clamp);
    if (s && !(s.col === RC && s.row === RR)) grid[s.row][s.col] = g;
  };
  if (game) {
    for (const rec of game.players.values()) {
      if (rec.player.id !== player.id) {
        try {
          mark(rec.player.location, GL.friend, false);
        } catch {}
      }
    }
    if (game.level.name !== "Hard") {
      for (const gd of game.guards) {
        const g = gd.state === "chase" ? GL.guardChase : gd.state === "suspicious" || gd.state === "search" ? GL.guardHuh : GL.guard;
        mark(toWorldPos(a, gd.U, gd.V, 0), g, false);
      }
    }
  }
  if (game && game.carrier === player.id) {
    mark(toWorldPos(a, 36, -4.5, 0), GL.homeMark, true);
  } else if (!game || !game.carrier) {
    let at = toWorldPos(a, PEDESTAL.U, PEDESTAL.V, 0);
    try {
      if (crown?.isValid()) at = crown.location;
    } catch {}
    mark(at, GL.crown, true);
  }
  grid[RR][RC] = GL.you;
  return grid.map((line) => line.map(glyph).join("")).join("\n");
}

system.runInterval(() => {
  const now = system.currentTick;
  const a = getArena();
  if (!a?.built || building) return;
  for (const p of world.getAllPlayers()) {
    if (!nearArena(a, p, 16) || !heldMap(p)) continue;
    if (now - (lastBar.get(p.id) ?? -999) < 50) continue;   // let a note show first
    if (game?.players.get(p.id)?.jailed >= 0) continue;     // no map in jail
    try {
      p.onScreenDisplay.setActionBar(radarFor(p, a));
    } catch {}
  }
}, 4);

// Guards or crowns left over from before a reload.
function sweepStrays() {
  for (const d of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
    let dim;
    try {
      dim = world.getDimension(d);
    } catch {
      continue;
    }
    try {
      for (const e of dim.getEntities({ type: GUARD })) if (!game || !game.guards.some((gd) => gd.e === e)) e.remove();
    } catch {}
    try {
      for (const e of dim.getEntities({ type: CROWN })) if (!crown || e.id !== crown.id) e.remove();
    } catch {}
  }
}

system.runTimeout(() => {
  sweepStrays();
  for (const p of world.getAllPlayers()) {
    restoreMode(p);
    freeFromJail(p);
  }
}, 20);

// /scriptevent heist:start easy|medium|hard (cheats on) starts a game for the nearest player.
system.afterEvents?.scriptEventReceive?.subscribe(({ id, message, sourceEntity }) => {
  if (id !== "heist:start") return;
  const lvl = LEVELS.find((l) => l.name.toLowerCase() === String(message || "easy").trim().toLowerCase()) || LEVELS[0];
  const player = sourceEntity?.typeId === "minecraft:player" ? sourceEntity : world.getAllPlayers()[0];
  if (player) startGame(lvl, player);
});

// For tests/heist_test.cjs.
if (globalThis.__heistTest) {
  globalThis.__heistTest.api = {
    LAYOUT, SPOTS, VAULT_SPOTS, CELLS, PEDESTAL, HOME, guardWalk, playerWalk, findPath, canSee, cellAt,
    LADDER, getGame: () => game, toLocal, toWorld, toWorldPos, getArena, LEVELS, radarFor, GL,
  };
}
