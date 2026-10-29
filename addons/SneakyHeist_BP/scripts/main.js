// Sneaky Heist: a cops-and-robbers sneaking game.
// Use the Heist Map in a big open space and it builds the Ender Manor in front of you: a walled
// garden with hedges and tall grass, a mansion full of rooms, and the Golden Crown on a pedestal in
// the vault. Press a button by the gate (green Easy, yellow Medium, red Hard) and Ender Guards in
// police caps start patrolling. Sneak in, grab the crown, and bring it back to the gold square.
// Crouch to be sneaky, hide in tall grass or behind crates. If a guard catches you it's off to
// jail: wait for the 5 lamps to go out (1 minute), or press the colored buttons in the order shown
// up high on the wall to break out early.
import { world, system, ItemStack, BlockPermutation, MolangVariableMap } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const MAP_ID = "heist:heist_map";
const GUARD = "heist:guard";
const CROWN = "heist:crown";
const ARENA_PROP = "heist:arena";
const VERSION = "1.6.0";   // shown in the Heist Map's menu, so you can tell which version a world is running

const LEVELS = [
  // guards, walking / running speed (blocks a tick; you walk 0.216), how far they see, how many ticks they have to
  // look at you before they give chase, how long the jail code is, ticks between a guard's teleports (about; each
  // waits this plus up to this again), on Hard the chance a guard that lost you blinks to where it last saw you,
  // and how many ticks the Rainbow Blaster takes to get a shot back.
  { name: "Easy", guards: 4, walk: 0.055, run: 0.13, sight: 7, notice: 16, code: 3, vaultGuard: true, blink: 900, chaseBlink: 0, recharge: 300 },
  { name: "Medium", guards: 5, walk: 0.065, run: 0.155, sight: 9, notice: 10, code: 4, vaultGuard: true, blink: 600, chaseBlink: 0, recharge: 400 },
  { name: "Hard", guards: 7, walk: 0.075, run: 0.18, sight: 11, notice: 6, code: 5, vaultGuard: true, blink: 400, chaseBlink: 0.5, recharge: 600 },
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

function newGrid() {
  const g = [];
  for (let v = VMIN; v <= VMAX; v++) g.push(new Array(W).fill(" "));
  const ok = (u, v) => u >= 0 && u < W && v >= VMIN && v <= VMAX;
  const set = (u, v, ch) => { if (ok(u, v)) g[v - VMIN][u] = ch; };
  const get = (u, v) => (ok(u, v) ? g[v - VMIN][u] : " ");
  const fill = (u0, v0, u1, v1, ch) => {
    for (let v = Math.min(v0, v1); v <= Math.max(v0, v1); v++) for (let u = Math.min(u0, u1); u <= Math.max(u0, u1); u++) set(u, v, ch);
  };
  const box = (u0, v0, u1, v1, ch) => { fill(u0, v0, u1, v0, ch); fill(u0, v1, u1, v1, ch); fill(u0, v0, u0, v1, ch); fill(u1, v0, u1, v1, ch); };
  return { g, set, get, fill, box };
}

// Outside the gate: the yard, the gold square, the start buttons, and the jail. The same for every manor.
function addYard(G) {
  const { set, fill, box } = G;
  fill(22, -12, 49, -1, "y");
  fill(34, -6, 37, -3, "H");
  fill(32, -12, 40, -12, "S");
  for (const [u, v] of [[22, -12], [49, -12], [22, -1], [49, -1], [31, -12], [41, -12]]) set(u, v, "l");
  box(15, -12, 21, -1, "J"); fill(16, -6, 20, -6, "J");
  fill(16, -11, 20, -7, "j"); fill(16, -5, 20, -1, "j");

}

// The classic Ender Manor: the first one you build.
function makeClassic() {
  const G = newGrid();
  const { set, get, fill, box } = G;
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

  addYard(G);
  return { floors: [G], stairs: [], buildings: [{ u0: 12, v0: 24, u1: 59, v1: 54, floors: 1 }], seed: 0 };
}

// ---------- Random manors ----------
// After every win the manor rebuilds itself from a new seed (saved in the arena, so the same seed always makes the
// same manor). The outer wall, the gate and the yard never change; everything inside the walls does: where the manor
// is and how big, one or two floors (with stairs), its rooms and doors, which room is the vault (sometimes the treasure
// is outside in a hedge garden instead), and the gardens: paths, ponds, hedges, trees, tall grass, flowers and cover.
// Every manor is checked: everything you can walk on is reachable from the gate, and guards can patrol everywhere.
function rng32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function generateLayout(seed) {
  for (let attempt = 0; attempt < 60; attempt++) {
    let L;
    try {
      L = tryGenerate((seed + attempt * 7919) >>> 0);
    } catch (e) {
      console.warn(`[Heist] Manor ${seed}/${attempt} failed: ${e}`);
      genWhy("threw " + String(e).slice(0, 60));
    }
    if (L) {
      L.seed = seed;
      return L;
    }
  }
  const classic = finishLayout(makeClassic());
  classic.seed = seed;
  return classic;
}

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const HOLE_STEPS = [2, 3, 4];   // steps with no upstairs floor over them (headroom)

let GENR = Math.random;   // the generator's dice (seeded while a manor is being made)

const genWhy = (r) => {
  const t = globalThis.__heistTest;
  if (!t) return;
  if (!t.why) t.why = {};
  t.why[r] = (t.why[r] || 0) + 1;
};

function tryGenerate(s) {
  const R = rng32(s);
  GENR = R;
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const chance = (p) => R() < p;
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(R() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  const G0 = newGrid();
  G0.fill(1, 1, 70, 70, ".");
  G0.box(0, 0, 71, 71, "#");
  G0.fill(34, 0, 37, 0, "a");
  addYard(G0);
  const L = { floors: [G0], stairs: [], buildings: [], seed: s };
  const saved = LAYOUT;
  LAYOUT = L;              // so the walking helpers below look at this manor
  try {
    const ok = build(L);
    if (!ok) return undefined;
    finishLayout(L);
    if (!validLayout(L)) { genWhy("invalid"); return undefined; }
    return L;
  } finally {
    LAYOUT = saved;
    GENR = Math.random;
  }

  function build(L) {
    const gardenTreasure = chance(0.3);
    const mw = ri(30, 50), md = ri(20, 30);
    const mu0 = ri(5, 66 - mw), mv0 = ri(16, 66 - md);
    const mu1 = mu0 + mw - 1, mv1 = mv0 + md - 1;
    const twoFloors = chance(0.6);
    const B = { u0: mu0, v0: mv0, u1: mu1, v1: mv1, floors: 1 };
    L.buildings.push(B);

    // ----- Floor 1 (the ground floor) -----
    G0.box(B.u0, B.v0, B.u1, B.v1, "W");
    G0.fill(B.u0 + 1, B.v0 + 1, B.u1 - 1, B.v1 - 1, "_");
    const rooms0 = roomsIn(G0, B);
    // The front door, on the side facing the gate, as close to the middle as it fits.
    const front = doorSpots(G0, B, "front", 3);
    if (!front.length) { genWhy("if (!front.length) r"); return false; }
    front.sort((a, b) => Math.abs(a.u - 35) - Math.abs(b.u - 35));
    const fd = front[Math.min(front.length - 1, ri(0, 3))];
    for (const c of fd.cells) G0.set(c.u, c.v, "d");
    let extra = 0;
    for (const side of shuffle(["left", "right", "back"])) {
      if (!chance(0.65) && extra > 0) continue;
      const spots = doorSpots(G0, B, side, 2);
      if (!spots.length) continue;
      const d = spots[ri(0, spots.length - 1)];
      for (const c of d.cells) G0.set(c.u, c.v, "d");
      extra++;
    }
    if (!extra) { genWhy("if (!extra) return f"); return false; }
    decorateWalls(G0, B, true);

    // ----- Floor 2, with stairs -----
    let G1, rooms1 = [];
    if (twoFloors) {
      const st = placeStairs(G0, B, rooms0);
      if (st) {
        G1 = newGrid();
        let fitted = false;
        for (let k = 0; k < 25 && !fitted; k++) {
          G1.fill(B.u0, B.v0, B.u1, B.v1, " ");
          G1.box(B.u0, B.v0, B.u1, B.v1, "W");
          G1.fill(B.u0 + 1, B.v0 + 1, B.u1 - 1, B.v1 - 1, "_");
          rooms1 = roomsIn(G1, B);
          // The whole stair run and the spot at the top have to be inside one room upstairs.
          const lane = [];
          for (let i = 0; i <= 6; i++) lane.push({ u: st.u + st.du * i, v: st.v + st.dv * i });
          const ids = new Set(lane.map((c) => roomIdAt(rooms1, c.u, c.v)));
          fitted = !ids.has(-1) && ids.size === 1 && lane.every((c) => G1.get(c.u, c.v) === "_");
        }
        if (fitted) {
          for (let i = 0; i <= 4; i++) G0.set(st.u + st.du * i, st.v + st.dv * i, "s");
          G0.set(st.u + st.du * 5, st.v + st.dv * 5, "Z");
          // The opening in the upstairs floor, over steps 2-4: you're about half a block wide, so while you step up
          // onto step 3 part of you is still over step 2, and your head needs room there too (2 blocks above each step).
          for (const i of HOLE_STEPS) G1.set(st.u + st.du * i, st.v + st.dv * i, "o");
          G1.set(st.u + st.du * 5, st.v + st.dv * 5, "u");
          // Railings around the opening upstairs.
          const pu = st.dv, pv = st.du;   // across the stairs
          for (const side of [-1, 1]) {
            for (const i of HOLE_STEPS) {
              const c = { u: st.u + st.du * i + pu * side, v: st.v + st.dv * i + pv * side };
              if (G1.get(c.u, c.v) === "_") G1.set(c.u, c.v, "n");
            }
          }
          if (G1.get(st.u + st.du * 1, st.v + st.dv * 1) === "_") G1.set(st.u + st.du * 1, st.v + st.dv * 1, "n");
          L.floors.push(G1);
          L.stairs.push(st);
          B.floors = 2;
          decorateWalls(G1, B, false);
        } else {
          G1 = undefined;
          rooms1 = [];
        }
      }
    }
    rebuildStairIndex(L);

    // ----- Paths and gardens -----
    const reserved = new Set();
    const key = (u, v) => (v + 20) * 100 + u;
    const reserve = (u0, v0, u1, v1) => {
      for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) reserved.add(key(u, v));
    };
    reserve(mu0 - 2, mv0 - 2, mu1 + 2, mv1 + 2);
    reserve(29, 1, 42, 4);
    // Path from the gate to the front door.
    const pathV = mv0 - 3;
    const du0 = fd.cells[0].u, du1 = fd.cells[fd.cells.length - 1].u;
    const pathCells = [];
    const pathFill = (u0, v0, u1, v1) => {
      for (let v = Math.min(v0, v1); v <= Math.max(v0, v1); v++) {
        for (let u = Math.min(u0, u1); u <= Math.max(u0, u1); u++) {
          if (G0.get(u, v) === ".") G0.set(u, v, ",");
          pathCells.push({ u, v });
        }
      }
    };
    pathFill(35, 1, 36, pathV);
    pathFill(Math.min(35, du0), pathV - 1, Math.max(36, du1), pathV);
    pathFill(du0, pathV, du1, mv0 - 1);
    for (const c of pathCells) reserve(c.u - 1, c.v - 1, c.u + 1, c.v + 1);
    if (chance(0.6)) {
      for (let u = mu0 - 1; u <= mu1 + 1; u++) for (const v of [mv0 - 1, mv1 + 1]) if (G0.get(u, v) === ".") G0.set(u, v, ",");
      for (let v = mv0 - 1; v <= mv1 + 1; v++) for (const u of [mu0 - 1, mu1 + 1]) if (G0.get(u, v) === ".") G0.set(u, v, ",");
    }
    const free = (u, v) => u >= 3 && u <= 68 && v >= 3 && v <= 68 && G0.get(u, v) === "." && !reserved.has(key(u, v));
    const freeRect = (u0, v0, u1, v1) => {
      for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) if (!free(u, v)) return false;
      return true;
    };

    // The treasure: in the vault (the room farthest from the front door), or in a hedge garden.
    let treasurePlaced = false;
    if (gardenTreasure) {
      for (let k = 0; k < 80 && !treasurePlaced; k++) {
        const gu = ri(3, 58), gv = ri(30, 58);
        if (!freeRect(gu - 1, gv - 1, gu + 10, gv + 10)) continue;
        const snap = snapshot(L);
        G0.box(gu, gv, gu + 9, gv + 9, "h");
        G0.fill(gu + 1, gv + 1, gu + 8, gv + 8, ",");
        const side = ri(0, 3);
        const gap = side === 0 ? [[gu + 4, gv], [gu + 5, gv]] : side === 1 ? [[gu + 4, gv + 9], [gu + 5, gv + 9]]
          : side === 2 ? [[gu, gv + 4], [gu, gv + 5]] : [[gu + 9, gv + 4], [gu + 9, gv + 5]];
        for (const [u, v] of gap) G0.set(u, v, ",");
        G0.fill(gu + 4, gv + 4, gu + 5, gv + 5, "P");
        for (const [u, v] of [[gu + 1, gv + 1], [gu + 8, gv + 1], [gu + 1, gv + 8], [gu + 8, gv + 8]]) G0.set(u, v, "c");
        if (allConnected(L)) {
          treasurePlaced = true;
          reserve(gu - 1, gv - 1, gu + 10, gv + 10);
        } else {
          restore(L, snap);
        }
      }
    }
    const allRooms = rooms0.map((r) => ({ ...r, f: 0 })).concat(rooms1.map((r) => ({ ...r, f: 1 })));
    rebuildStairIndex(L);
    const { dist } = bfs(L, okArray(L, walkAll, "walk", true), [nodeOf(0, fd.cells[1]?.u ?? fd.cells[0].u, fd.cells[0].v)]);
    const roomDist = (r) => {
      let best = Infinity;
      for (let v = r.v0; v <= r.v1; v++) for (let u = r.u0; u <= r.u1; u++) {
        const d = dist[nodeOf(r.f, u, v)];
        if (d >= 0 && d < best) best = d;
      }
      return best;
    };
    const fdRoom = roomIdAt(rooms0, fd.cells[0].u, fd.cells[0].v + 1);
    let vault;
    if (!treasurePlaced) {
      const options = allRooms.filter((r, i) => !(r.f === 0 && i === fdRoom) && r.u1 - r.u0 >= 4 && r.v1 - r.v0 >= 4 && !roomHasStairs(L, r))
        .map((r) => ({ r, d: roomDist(r) })).filter((o) => o.d < Infinity).sort((a, b) => b.d - a.d);
      if (!options.length) { genWhy("if (!options.length)"); return false; }
      vault = options[Math.min(options.length - 1, ri(0, 1))].r;
      const G = L.floors[vault.f];
      for (let v = vault.v0; v <= vault.v1; v++) for (let u = vault.u0; u <= vault.u1; u++) if (G.get(u, v) === "_") G.set(u, v, "=");
      const pu = Math.floor((vault.u0 + vault.u1) / 2), pv = Math.floor((vault.v0 + vault.v1) / 2);
      G.fill(pu, pv, pu + 1, pv + 1, "P");
      for (const [u, v] of [[vault.u0, vault.v0], [vault.u1, vault.v0], [vault.u0, vault.v1], [vault.u1, vault.v1]]) {
        if (!nearDoor(G, u, v)) tryPut(L, vault.f, [[u, v]], "c");
      }
    }

    // Furniture, room by room.
    allRooms.forEach((r, i) => {
      if (r === vault) return;
      const isHall = r.f === 0 && i === fdRoom;
      const kind = isHall ? "hall" : ["library", "dining", "kitchen", "store", "lounge"][ri(0, 4)];
      furnish(L, r, kind, fd);
      for (let k = ri(1, 3); k > 0; k--) {
        tryPut(L, r.f, [[ri(r.u0, r.u1), ri(r.v0, r.v1)]], "c");
      }
    });

    // Ponds.
    for (let n = ri(0, 2), k = 0; n > 0 && k < 60; k++) {
      const w = ri(8, 12), d = ri(6, 9), u0 = ri(3, 68 - w), v0 = ri(3, 68 - d);
      if (!freeRect(u0 - 1, v0 - 1, u0 + w, v0 + d)) continue;
      const snap = snapshot(L);
      G0.fill(u0, v0, u0 + w - 1, v0 + d - 1, "r");
      G0.fill(u0 + 1, v0 + 1, u0 + w - 2, v0 + d - 2, "w");
      if (chance(0.5)) {
        const cu = u0 + Math.floor(w / 2) - 1, cv = v0 + Math.floor(d / 2);
        G0.fill(cu, cv, cu + 1, cv, "q");
      }
      if (allConnected(L)) {
        n--;
        reserve(u0 - 1, v0 - 1, u0 + w, v0 + d);
      } else {
        restore(L, snap);
      }
    }
    // Hedges: straight runs, some with a corner.
    for (let n = ri(12, 20), k = 0; n > 0 && k < 200; k++) {
      const len = ri(5, 13), horiz = chance(0.5);
      const u0 = ri(3, horiz ? 68 - len : 68), v0 = ri(3, horiz ? 68 : 68 - len);
      const cells = [];
      for (let i = 0; i < len; i++) cells.push(horiz ? [u0 + i, v0] : [u0, v0 + i]);
      if (chance(0.5)) {
        const end = cells[chance(0.5) ? 0 : cells.length - 1], len2 = ri(3, 8), dir = chance(0.5) ? 1 : -1;
        for (let i = 1; i <= len2; i++) cells.push(horiz ? [end[0], end[1] + i * dir] : [end[0] + i * dir, end[1]]);
      }
      const set = new Set(cells.map(([u, v]) => key(u, v)));
      const fits = cells.every(([u, v]) => free(u, v)
        && [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].every(([a, b]) =>
          set.has(key(u + a, v + b)) || !"hTrwqWGp#".includes(G0.get(u + a, v + b))));
      if (!fits) continue;
      const snap = snapshot(L);
      for (const [u, v] of cells) G0.set(u, v, "h");
      if (allConnected(L)) n--;
      else restore(L, snap);
    }
    // Tall grass (hiding spots) and flowers.
    for (let n = ri(10, 16), k = 0; n > 0 && k < 200; k++) {
      const w = ri(2, 5), d = ri(2, 4), u0 = ri(3, 68 - w), v0 = ri(3, 68 - d);
      let any = false;
      for (let v = v0; v < v0 + d; v++) for (let u = u0; u < u0 + w; u++) if (free(u, v)) { G0.set(u, v, "g"); any = true; }
      if (any) n--;
    }
    for (let n = ri(5, 8), k = 0; n > 0 && k < 100; k++) {
      const w = ri(2, 4), d = ri(1, 2), u0 = ri(3, 68 - w), v0 = ri(3, 68 - d);
      if (!freeRect(u0, v0, u0 + w - 1, v0 + d - 1)) continue;
      G0.fill(u0, v0, u0 + w - 1, v0 + d - 1, "f");
      n--;
    }
    // Trees, with room for their leaves.
    for (let n = ri(6, 12), k = 0; n > 0 && k < 200; k++) {
      const u = ri(4, 67), v = ri(4, 67);
      if (!free(u, v)) continue;
      if (u >= mu0 - 4 && u <= mu1 + 4 && v >= mv0 - 4 && v <= mv1 + 4) continue;
      let clear = true;
      for (let a = -3; a <= 3 && clear; a++) for (let b = -3; b <= 3; b++) if ("ThrwqP".includes(G0.get(u + a, v + b))) { clear = false; break; }
      if (!clear) continue;
      if (tryPut(L, 0, [[u, v]], "T")) n--;
    }
    // Low cover to crouch behind: bushes and hay bales.
    for (let n = ri(12, 18), k = 0; n > 0 && k < 200; k++) {
      const u = ri(3, 68), v = ri(3, 68);
      if (!free(u, v)) continue;
      if (tryPut(L, 0, [[u, v]], chance(0.6) ? "b" : "x")) n--;
    }
    return true;
  }
}

// ----- Helpers for the generator -----
// Splits a building's inside into rooms with walls between them (on grid G). Returns the rooms (inside cells only).
function roomsIn(G, B) {
  const rooms = [];
  const R = GENR;
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const split = (u0, v0, u1, v1, depth) => {
    const w = u1 - u0 + 1, d = v1 - v0 + 1;
    const canU = w >= 13, canV = d >= 11;
    if ((!canU && !canV) || (depth > 1 && w * d < 150 && R() < 0.35)) {
      rooms.push({ u0, v0, u1, v1 });
      return;
    }
    const alongU = canU && !canV ? true : !canU && canV ? false : w > d * 1.2 ? true : d > w * 1.2 ? false : R() < 0.5;
    if (alongU) {
      const at = ri(u0 + 6, u1 - 6);
      G.fill(at, v0, at, v1, "W");
      split(u0, v0, at - 1, v1, depth + 1);
      split(at + 1, v0, u1, v1, depth + 1);
    } else {
      const at = ri(v0 + 5, v1 - 5);
      G.fill(u0, at, u1, at, "W");
      split(u0, v0, u1, at - 1, depth + 1);
      split(u0, at + 1, u1, v1, depth + 1);
    }
  };
  split(B.u0 + 1, B.v0 + 1, B.u1 - 1, B.v1 - 1, 0);
  // Doors between rooms (2 wide): enough to reach every room, plus a few extra so there's more than one way around.
  const id = (u, v) => roomIdAt(rooms, u, v);
  const pairs = new Map();
  const add = (ra, rb, cells) => {
    const k = ra < rb ? `${ra},${rb}` : `${rb},${ra}`;
    if (!pairs.has(k)) pairs.set(k, []);
    pairs.get(k).push(cells);
  };
  for (let v = B.v0 + 1; v < B.v1; v++) {
    for (let u = B.u0 + 1; u < B.u1; u++) {
      if (G.get(u, v) !== "W") continue;
      let ra = id(u - 1, v), rb = id(u + 1, v);   // rooms left and right of a wall running along v
      if (ra >= 0 && rb >= 0 && ra !== rb && G.get(u, v + 1) === "W" && id(u - 1, v + 1) === ra && id(u + 1, v + 1) === rb) add(ra, rb, [[u, v], [u, v + 1]]);
      ra = id(u, v - 1); rb = id(u, v + 1);       // rooms above and below a wall running along u
      if (ra >= 0 && rb >= 0 && ra !== rb && G.get(u + 1, v) === "W" && id(u + 1, v - 1) === ra && id(u + 1, v + 1) === rb) add(ra, rb, [[u, v], [u + 1, v]]);
    }
  }
  const parent = rooms.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const entries = [...pairs.entries()];
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  for (const [k, spots] of entries) {
    const [a, b] = k.split(",").map(Number);
    if (find(a) === find(b) && R() > 0.3) continue;
    parent[find(a)] = find(b);
    // Not at the very ends of the shared wall, so the door doesn't open into a corner.
    const inner = spots.length > 2 ? spots.slice(1, -1) : spots;
    for (const [u, v] of inner[Math.floor(R() * inner.length)]) G.set(u, v, "d");
  }
  return rooms;
}

function roomIdAt(rooms, u, v) {
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    if (u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1) return i;
  }
  return -1;
}

// Spots for an outside door (n wide) on one side of a building, each opening onto floor inside.
function doorSpots(G, B, side, n) {
  const out = [];
  const lineU = side === "front" || side === "back";
  const fixed = side === "front" ? B.v0 : side === "back" ? B.v1 : side === "left" ? B.u0 : B.u1;
  const inward = side === "front" ? 1 : side === "back" ? -1 : side === "left" ? 1 : -1;
  const from = (lineU ? B.u0 : B.v0) + 2, to = (lineU ? B.u1 : B.v1) - 2 - (n - 1);
  for (let t = from; t <= to; t++) {
    const cells = [];
    let ok = true;
    for (let i = 0; i < n; i++) {
      const u = lineU ? t + i : fixed, v = lineU ? fixed : t + i;
      const iu = lineU ? u : u + inward, iv = lineU ? v + inward : v;
      if (G.get(u, v) !== "W" || G.get(iu, iv) !== "_") ok = false;
      cells.push({ u, v });
    }
    // Not right next to a wall that runs inward from here.
    const before = lineU ? [t - 1, fixed + inward] : [fixed + inward, t - 1];
    const after = lineU ? [t + n, fixed + inward] : [fixed + inward, t + n];
    if (G.get(before[0], before[1]) === "W" || G.get(after[0], after[1]) === "W") ok = false;
    if (ok) out.push({ u: cells[0].u, v: cells[0].v, cells });
  }
  return out;
}

// Windows every few blocks and pillars on the corners.
function decorateWalls(G, B, ground) {
  for (let u = B.u0 + 2; u <= B.u1 - 2; u++) {
    for (const [v, iv] of [[B.v0, B.v0 + 1], [B.v1, B.v1 - 1]]) {
      if ((u - B.u0) % 4 === 2 && G.get(u, v) === "W" && G.get(u, iv) === "_" && G.get(u - 1, v) === "W" && G.get(u + 1, v) === "W") G.set(u, v, "G");
    }
  }
  for (let v = B.v0 + 2; v <= B.v1 - 2; v++) {
    for (const [u, iu] of [[B.u0, B.u0 + 1], [B.u1, B.u1 - 1]]) {
      if ((v - B.v0) % 4 === 2 && G.get(u, v) === "W" && G.get(iu, v) === "_" && G.get(u, v - 1) === "W" && G.get(u, v + 1) === "W") G.set(u, v, "G");
    }
  }
  for (const [u, v] of [[B.u0, B.v0], [B.u1, B.v0], [B.u0, B.v1], [B.u1, B.v1]]) G.set(u, v, "p");
}

// A straight run of stairs along a wall inside one room downstairs: 7 cells (the spot you start from, then 6 steps;
// the 6th is level with the floor upstairs), and a free spot at the top. Returns {u, v, du, dv} for the first step.
function placeStairs(G0, B, rooms) {
  const options = [];
  for (const r of rooms) {
    for (const [du, dv] of DIRS4) {
      // Along each wall of the room, in each direction.
      const lanes = du ? [r.v0, r.v1] : [r.u0, r.u1];
      for (const lane of lanes) {
        const wallSide = du ? (lane === r.v0 ? -1 : 1) : (lane === r.u0 ? -1 : 1);
        const len = du ? r.u1 - r.u0 + 1 : r.v1 - r.v0 + 1;
        if (len < 9) continue;
        for (let t = 1; t + 7 <= len - 1; t++) {
          const startU = du ? (du > 0 ? r.u0 + t : r.u1 - t) : lane;
          const startV = du ? lane : (dv > 0 ? r.v0 + t : r.v1 - t);
          let ok = true;
          for (let i = -1; i <= 6 && ok; i++) {
            const u = startU + du * i, v = startV + dv * i;
            if (G0.get(u, v) !== "_") ok = false;
            const wu = du ? u : u + wallSide, wv = du ? v + wallSide : v;
            if (G0.get(wu, wv) === "d") ok = false;
            const ou = du ? u : u - wallSide, ov = du ? v - wallSide : v;
            if (G0.get(ou, ov) === "d" || G0.get(ou, ov) === "W") ok = false;
          }
          if (ok) options.push({ u: startU, v: startV, du, dv });
        }
      }
    }
  }
  if (!options.length) return undefined;
  return options[Math.floor(GENR() * options.length)];
}

function roomHasStairs(L, r) {
  for (const st of L.stairs) {
    for (let i = -1; i <= 6; i++) {
      const u = st.u + st.du * i, v = st.v + st.dv * i;
      if (u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1) return true;
    }
  }
  return false;
}

function nearDoor(G, u, v) {
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (G.get(u + a, v + b) === "d") return true;
  return false;
}

// Puts furniture on floor cells if it doesn't block a doorway or cut anything off.
function tryPut(L, f, cells, ch) {
  const G = L.floors[f];
  for (const [u, v] of cells) {
    if (!["_", "."].includes(G.get(u, v))) return false;
    if (G.get(u, v) === "_" && nearDoor(G, u, v)) return false;
    if (STAIRS_NEAR(L, f, u, v)) return false;
  }
  const old = cells.map(([u, v]) => G.get(u, v));
  for (const [u, v] of cells) G.set(u, v, ch);
  if (ringConnected(L, f, cells) || allConnected(L)) return true;
  cells.forEach(([u, v], i) => G.set(u, v, old[i]));
  return false;
}

function STAIRS_NEAR(L, f, u, v) {
  for (const st of L.stairs) {
    for (let i = -1; i <= 6; i++) {
      const su = st.u + st.du * i, sv = st.v + st.dv * i;
      if (Math.abs(su - u) <= 1 && Math.abs(sv - v) <= 1) return true;
    }
  }
  return false;
}

function furnish(L, r, kind, fd) {
  const f = r.f;
  const w = r.u1 - r.u0 + 1, d = r.v1 - r.v0 + 1;
  const row = (v, u0, u1, ch) => {
    const cells = [];
    for (let u = u0; u <= u1; u++) cells.push([u, v]);
    return tryPut(L, f, cells, ch);
  };
  if (kind === "hall") {
    // A red carpet in from the front door, and pillars.
    const G = L.floors[0];
    for (const c of fd.cells.slice(0, 2)) for (let v = r.v0; v <= r.v1; v++) if (G.get(c.u, v) === "_") G.set(c.u, v, "~");
    if (w >= 10 && d >= 8) {
      for (const [u, v] of [[r.u0 + 2, r.v0 + 2], [r.u1 - 2, r.v0 + 2], [r.u0 + 2, r.v1 - 2], [r.u1 - 2, r.v1 - 2]]) tryPut(L, f, [[u, v]], "p");
    }
  } else if (kind === "library") {
    for (let v = r.v0 + 1; v <= r.v1 - 1; v += 3) {
      const mid = Math.floor((r.u0 + r.u1) / 2);
      row(v, r.u0 + 1, mid - 1, "B");
      row(v, mid + 2, r.u1 - 1, "B");
    }
  } else if (kind === "dining") {
    if (d >= 6) {
      row(r.v0 + 2, r.u0 + 2, r.u1 - 2, "k");
      row(r.v1 - 2, r.u0 + 2, r.u1 - 2, "k");
    } else {
      row(Math.floor((r.v0 + r.v1) / 2), r.u0 + 2, r.u1 - 2, "k");
    }
  } else if (kind === "kitchen") {
    for (let u = r.u0; u <= r.u1; u++) tryPut(L, f, [[u, r.v0]], "c");
    const mv = Math.floor((r.v0 + r.v1) / 2) + 1;
    if (d >= 6) row(mv, r.u0 + 3, r.u1 - 3, "k");
  } else if (kind === "store") {
    for (let v = r.v0 + 1; v + 1 <= r.v1 - 1; v += 4) {
      for (let u = r.u0 + 1; u + 1 <= r.u1 - 1; u += 4) tryPut(L, f, [[u, v], [u + 1, v], [u, v + 1], [u + 1, v + 1]], "C");
    }
  } else {
    // Lounge: a rug and some barrels.
    const G = L.floors[f];
    const cu = Math.floor((r.u0 + r.u1) / 2) - 1, cv = Math.floor((r.v0 + r.v1) / 2) - 1;
    for (let v = cv; v <= cv + 2; v++) for (let u = cu; u <= cu + 2; u++) if (G.get(u, v) === "_") G.set(u, v, "~");
    for (let k = 0; k < 4; k++) tryPut(L, f, [[r.u0 + Math.floor(GENR() * w), r.v0 + Math.floor(GENR() * d)]], "c");
  }
}

function snapshot(L) {
  return L.floors.map((G) => G.g.map((row) => row.slice()));
}
function restore(L, snap) {
  snap.forEach((rows, f) => { L.floors[f].g.splice(0, rows.length, ...rows); });
}

// ---------- Walking around a manor (any floor, up and down stairs) ----------
// Floor 0 is the ground; floor 1 is upstairs (its floor is 6 blocks up). A stair run is 6 steps: steps 0-4 belong to
// the ground floor ('s'), step 5 is level with the upstairs floor ('u'); the opening above steps 2-4 is 'o'.
const FLOOR_Y = [0, 6];
function rebuildStairIndex(L) {
  L.stairAt = new Map();
  for (const st of L.stairs) {
    for (let i = 0; i <= 5; i++) L.stairAt.set((st.v + st.dv * i - VMIN) * W + st.u + st.du * i, { st, i });
  }
}
function stairInfo(u, v) {
  return LAYOUT.stairAt?.get((v - VMIN) * W + u);
}
// Height above the ground at a spot, for someone on floor f.
function heightAt(f, U, V) {
  const info = stairInfo(Math.floor(U), Math.floor(V));
  if (info && (f === 0 || info.i >= 4)) {
    const st = info.st;
    const t = st.du > 0 ? U - st.u : st.du < 0 ? st.u + 1 - U : st.dv > 0 ? V - st.v : st.v + 1 - V;
    return Math.max(0, Math.min(6, t));
  }
  return FLOOR_Y[f] ?? 0;
}
const WALK = new Set([".", ",", "y", "H", "d", "a", "_", "~", "=", "g", "f", "j", "s", "u"]);
const walkAll = (f, u, v) => {
  const ch = cellAt(u, v, f);
  return WALK.has(ch) && ch !== "j";
};
// ----- Fast searches over the map (typed arrays; node = floor * N + row * W + u, row = v - VMIN) -----
const NODES = (VMAX - VMIN + 1) * W;
const nodeOf = (f, u, v) => f * NODES + (v - VMIN) * W + u;
const nodeF = (n) => Math.floor(n / NODES);
const nodeU = (n) => (n % NODES) % W;
const nodeV = (n) => Math.floor((n % NODES) / W) + VMIN;
// Which nodes are ok to stand on, for a test like walkAll or guardOk (cached on the layout).
function okArray(L, ok, name, fresh = false) {
  if (!L.ok) L.ok = {};
  if (L.ok[name] && !fresh) return L.ok[name];
  const saved = LAYOUT;
  LAYOUT = L;
  const arr = new Uint8Array(L.floors.length * NODES);
  for (let f = 0; f < L.floors.length; f++) {
    for (let v = VMIN; v <= VMAX; v++) for (let u = 0; u < W; u++) if (ok(f, u, v)) arr[nodeOf(f, u, v)] = 1;
  }
  LAYOUT = saved;
  if (!fresh) L.ok[name] = arr;
  return arr;
}
const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
// Breadth-first search: 8 directions (no cutting corners), stairs only straight up/down, and from the top step
// onto the floor upstairs and back. Stops early when it reaches `target` (a node), if given.
function bfs(L, okArr, starts, target = -1) {
  const total = L.floors.length * NODES;
  const dist = new Int32Array(total).fill(-1), prev = new Int32Array(total).fill(-1), queue = new Int32Array(total);
  const stairAt = L.stairAt || new Map();
  let head = 0, tail = 0;
  for (const n of starts) if (okArr[n] && dist[n] < 0) { dist[n] = 0; queue[tail++] = n; }
  while (head < tail) {
    const n = queue[head++];
    if (n === target) break;
    const f = Math.floor(n / NODES), c = n % NODES, r = Math.floor(c / W), u = c % W;
    const here = stairAt.get(c);
    const onStairs = here && (f === 0 ? here.i <= 4 : here.i === 5);
    for (let d = 0; d < 8; d++) {
      const du = D8[d][0], dv = D8[d][1], nu = u + du, nr = r + dv;
      if (nu < 0 || nu >= W || nr < 0 || nr >= VMAX - VMIN + 1) continue;
      const nc = nr * W + nu, nn = f * NODES + nc;
      if (dist[nn] >= 0 || !okArr[nn]) continue;
      const there = stairAt.get(nc);
      const thereOn = there && (f === 0 ? there.i <= 4 : there.i === 5);
      if (onStairs || thereOn) {
        const st = (onStairs ? here : there).st;
        if (!((du === st.du && dv === st.dv) || (du === -st.du && dv === -st.dv))) continue;
      } else if (du && dv && (!okArr[f * NODES + r * W + nu] || !okArr[f * NODES + nr * W + u])) {
        continue;
      }
      dist[nn] = dist[n] + 1; prev[nn] = n; queue[tail++] = nn;
    }
    let jump = -1;
    if (onStairs && f === 0 && here.i === 4) jump = NODES + c + here.st.dv * W + here.st.du;
    if (onStairs && f === 1) jump = c - here.st.dv * W - here.st.du;
    if (jump >= 0 && okArr[jump] && dist[jump] < 0) { dist[jump] = dist[n] + 1; prev[jump] = n; queue[tail++] = jump; }
  }
  return { dist, prev };
}

// Is everything you can walk on reachable from the gate? (A quick flood fill over both floors.)
function allConnected(L) {
  rebuildStairIndex(L);
  const F = L.floors.length, N = (VMAX - VMIN + 1) * W;
  const walk = new Uint8Array(F * N), seen = new Uint8Array(F * N);
  let total = 0;
  for (let f = 0; f < F; f++) {
    const g = L.floors[f].g;
    for (let r = 0; r < g.length; r++) {
      const row = g[r];
      for (let u = 0; u < W; u++) {
        const ch = row[u];
        if (WALK.has(ch) && ch !== "j") {
          walk[f * N + r * W + u] = 1;
          if (r + VMIN >= 1) total++;
        }
      }
    }
  }
  const stairAt = L.stairAt;
  const queue = new Int32Array(F * N);
  let head = 0, tail = 0, found = 0;
  const start = 0 * N + (1 - VMIN) * W + 35;
  if (!walk[start]) return false;
  seen[start] = 1; queue[tail++] = start;
  while (head < tail) {
    const k = queue[head++];
    const f = Math.floor(k / N), c = k % N, r = Math.floor(c / W), u = c % W;
    if (r + VMIN >= 1) found++;
    const here = stairAt.get(c);
    const onStairs = here && (f === 0 ? here.i <= 4 : here.i === 5);
    for (let d = 0; d < 4; d++) {
      const du = DIRS4[d][0], dv = DIRS4[d][1];
      const nu = u + du, nr = r + dv;
      if (nu < 0 || nu >= W || nr < 0 || nr > VMAX - VMIN) continue;
      const nc = nr * W + nu, nk = f * N + nc;
      if (seen[nk] || !walk[nk]) continue;
      const there = stairAt.get(nc);
      const thereOn = there && (f === 0 ? there.i <= 4 : there.i === 5);
      if (onStairs || thereOn) {
        const st = (onStairs ? here : there).st;
        if (!((du === st.du && dv === st.dv) || (du === -st.du && dv === -st.dv))) continue;
      }
      seen[nk] = 1; queue[tail++] = nk;
    }
    if (onStairs && f === 0 && here.i === 4) {
      const nk = N + c + here.st.dv * W + here.st.du;
      if (walk[nk] && !seen[nk]) { seen[nk] = 1; queue[tail++] = nk; }
    }
    if (onStairs && f === 1) {
      const nk = c - here.st.dv * W - here.st.du;
      if (walk[nk] && !seen[nk]) { seen[nk] = 1; queue[tail++] = nk; }
    }
  }
  return found === total;
}

// A quick local check: after putting something on these cells, can you still get around it? If the walkable cells
// in the ring around it are all joined up within the ring, nothing can have been cut off.
function ringConnected(L, f, cells) {
  const G = L.floors[f];
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const [u, v] of cells) { u0 = Math.min(u0, u); v0 = Math.min(v0, v); u1 = Math.max(u1, u); v1 = Math.max(v1, v); }
  u0--; v0--; u1++; v1++;
  const ring = [];
  for (let u = u0; u <= u1; u++) ring.push([u, v0]);
  for (let v = v0 + 1; v <= v1; v++) ring.push([u1, v]);
  for (let u = u1 - 1; u >= u0; u--) ring.push([u, v1]);
  for (let v = v1 - 1; v > v0; v--) ring.push([u0, v]);
  const ok = ring.map(([u, v]) => {
    const ch = G.get(u, v);
    return WALK.has(ch) && ch !== "j" && !stairInfo(u, v);
  });
  if (ring.some(([u, v]) => stairInfo(u, v))) return false;
  // Count runs of walkable cells around the ring (corners only join their two sides).
  let runs = 0;
  for (let i = 0; i < ring.length; i++) if (ok[i] && !ok[(i + ring.length - 1) % ring.length]) runs++;
  if (runs === 0) return ok.every(Boolean);
  return runs === 1;
}

// Works out the pedestal and the stair index for a layout.
function finishLayout(L) {
  rebuildStairIndex(L);
  L.pedestal = undefined;
  L.floors.forEach((G, f) => {
    let su = 0, sv = 0, n = 0;
    for (let v = 1; v <= VMAX; v++) for (let u = 0; u < W; u++) if (G.get(u, v) === "P") { su += u + 0.5; sv += v + 0.5; n++; }
    if (n) L.pedestal = { U: su / n, V: sv / n, f };
  });
  L.rows = L.floors[0].g.map((r) => r.join(""));
  L.get = L.floors[0].get;
  return L;
}

function validLayout(L) {
  const saved = LAYOUT;
  LAYOUT = L;
  try {
    if (!L.pedestal) { genWhy("no pedestal"); return false; }
    if (!allConnected(L)) { genWhy("not connected"); return false; }
    const { dist } = bfs(L, okArray(L, walkAll, "walk", true), [nodeOf(0, 35, 1)]);
    const P = L.pedestal;
    let grab = false;
    for (let v = Math.floor(P.V) - 3; v <= Math.floor(P.V) + 3 && !grab; v++) {
      for (let u = Math.floor(P.U) - 3; u <= Math.floor(P.U) + 3; u++) {
        if (dist[nodeOf(P.f, u, v)] >= 0 && Math.hypot(u + 0.5 - P.U, v + 0.5 - P.V) < GRAB_RANGE - 0.2) { grab = true; break; }
      }
    }
    if (!grab) { genWhy("can't grab"); return false; }
    const spots = computeSpots(L);
    if (!(spots.spots.length >= 40)) genWhy("few spots " + spots.spots.length);
    if (!(spots.vault.length >= 6)) genWhy("few vault spots " + spots.vault.length);
    if (!(Math.hypot(P.U - 36, P.V) > 28)) genWhy("treasure too close");
    return spots.spots.length >= 40 && spots.vault.length >= 6 && Math.hypot(P.U - 36, P.V) > 28;
  } finally {
    LAYOUT = saved;
  }
}

// ---------- The manor in play right now ----------
let LAYOUT = finishLayout(makeClassic());
let SPOTS = [], VAULT_SPOTS = [], PEDESTAL = { U: 36, V: 51, f: 0 };
const cellAt = (u, v, f = 0) => (LAYOUT.floors[f] ? LAYOUT.floors[f].get(u, v) : " ");

function setLayout(seed) {
  if (LAYOUT.seed === (seed || 0) && SPOTS.length) return;
  LAYOUT = seed ? generateLayout(seed) : finishLayout(makeClassic());
  const sp = computeSpots(LAYOUT);
  SPOTS = sp.spots;
  VAULT_SPOTS = sp.vault;
  PEDESTAL = LAYOUT.pedestal;
}
// What the different columns are like.
// Upstairs: 's' steps, 'u' the top step, 'o' the hole over the stairs, 'n' railing, 'Z' solid under the top step.
const FLOORS = new Set([".", ",", "y", "H", "d", "a", "_", "~", "=", "g", "f", "j", "s", "u"]);
const OPAQUE = new Set(["#", "W", "h", "B", "T", "J", "S", "p", "C", "l", "Z"]); // blocks eyes
const LOW = new Set(["c", "k", "x", "b", "r", "q", "P", "n"]);                   // you can hide behind these by crouching
const INDOOR = new Set(["_", "~", "=", "d", "j"]);
const playerWalk = (u, v) => FLOORS.has(cellAt(u, v));
// Guards stay inside the walls, a little back from the gate.
const guardWalk = (u, v, f = 0) => v >= 3 && v <= 70 && u >= 1 && u <= 70 && FLOORS.has(cellAt(u, v, f)) && cellAt(u, v, f) !== "j";
const guardOk = (f, u, v) => guardWalk(u, v, f);
const inBuilding = (u, v) => LAYOUT.buildings.some((b) => u >= b.u0 && u <= b.u1 && v >= b.v0 && v <= b.v1);
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

// Spots the guards walk between: spread over the whole place (both floors), plus a tighter set around the treasure.
function nearestWalk(u, v, r, f = 0) {
  for (let d = 0; d <= r; d++) {
    for (let du = -d; du <= d; du++) {
      for (let dv = -d; dv <= d; dv++) {
        if (Math.max(Math.abs(du), Math.abs(dv)) !== d) continue;
        if (guardWalk(u + du, v + dv, f) && !stairInfo(u + du, v + dv)) return { u: u + du, v: v + dv, f };
      }
    }
  }
  return undefined;
}
function computeSpots(L) {
  const saved = LAYOUT;
  LAYOUT = L;
  try {
    rebuildStairIndex(L);
    const okG = okArray(L, guardOk, "guard");
    const guardReach = bfs(L, okG, [nodeOf(0, 35, 3), nodeOf(0, 36, 3)]).dist;
    const reached = (s) => s && guardReach[nodeOf(s.f, s.u, s.v)] >= 0;
    const spots = [];
    for (let f = 0; f < L.floors.length; f++) {
      const step = f ? 5 : 7;
      for (let v = 5; v <= 68; v += step) {
        for (let u = 4; u <= 67; u += step) {
          const s = nearestWalk(u, v, 2, f);
          if (reached(s) && !spots.some((o) => o.u === s.u && o.v === s.v && o.f === s.f)) spots.push(s);
        }
      }
    }
    // Around the treasure: walkable spots 2-14 steps from it, at least 3 apart.
    const vault = [];
    const P = L.pedestal;
    if (P) {
      const starts = [];
      for (let du = -2; du <= 2; du++) for (let dv = -2; dv <= 2; dv++) starts.push({ f: P.f, u: Math.floor(P.U - 0.5) + du, v: Math.floor(P.V - 0.5) + dv });
      const near = bfs(L, okG, starts.filter((st) => okG[nodeOf(st.f, st.u, st.v)]).map((st) => nodeOf(st.f, st.u, st.v))).dist;
      const keys = [];
      for (let n = 0; n < near.length; n++) if (near[n] >= 1 && near[n] <= 14) keys.push(n);
      for (let i = keys.length - 1; i > 0; i--) {
        const j = (i * 7919 + 13) % (i + 1);
        [keys[i], keys[j]] = [keys[j], keys[i]];
      }
      for (const n of keys) {
        const f = nodeF(n), u = nodeU(n), v = nodeV(n);
        if (guardReach[n] < 0 || stairInfo(u, v)) continue;
        if (vault.some((o) => o.f === f && Math.hypot(o.u - u, o.v - v) < 3)) continue;
        vault.push({ u, v, f });
        if (vault.length >= 12) break;
      }
    }
    return { spots, vault };
  } finally {
    LAYOUT = saved;
  }
}
{
  const sp = computeSpots(LAYOUT);
  SPOTS = sp.spots;
  VAULT_SPOTS = sp.vault;
  PEDESTAL = LAYOUT.pedestal;
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
  let a;
  try {
    const raw = world.getDynamicProperty(ARENA_PROP);
    a = raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
  if (a) setLayout(a.seed);   // the manor that's standing there (the same seed always makes the same manor)
  return a;
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
function bar(player, text) {
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
  if (player?.typeId !== "minecraft:player") return;
  if (itemStack?.typeId === BLASTER_ID) {
    shootRainbow(player);
    return;
  }
  if (itemStack?.typeId !== MAP_ID) return;
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
    const pick = await choose(player, `Sneaky Heist ${VERSION}`,
      "Build the Ender Manor here? It's big: about 72 blocks wide and 84 deep, built in front of you. Stand at the edge of a big flat open space.",
      ["Build it!", "Not now"]);
    if (pick === 0) buildArena(player);
    return;
  }
  if (!nearArena(a, player, 24)) {
    const pick = await choose(player, `Sneaky Heist ${VERSION}`,
      `The Ender Manor is at ${a.stand.x}, ${a.stand.z}. There can only be one at a time.`,
      ["OK", "Take it away"]);
    if (pick === 1 && await sure(player)) removeArena(player);
    return;
  }
  const buttons = LEVELS.map((l) => `Play ${l.name}`);
  if (game) buttons.push("Stop the game");
  else buttons.push("Make a new manor");
  buttons.push("Take the Ender Manor away");
  const pick = await choose(player, `Sneaky Heist ${VERSION}`, "Sneak in, grab the treasure in the vault, and bring it back to the gold square to keep it!", buttons);
  if (pick < 0) return;
  if (pick < LEVELS.length) {
    startGame(LEVELS[pick], player);
  } else if (buttons[pick] === "Stop the game") {
    endGame("stopped");
  } else if (buttons[pick] === "Make a new manor") {
    if (!game && !building) startRebuild(getArena(), newSeed());
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
  const a = { dim: player.dimension.id, base, f, r, built: false, seed: 0 };
  a.stand = toWorld(a, STAND.u, STAND.v, 0);
  setLayout(0);
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

const CLEAR_TO = 12;   // air is cleared this high (a two-floor manor's roof is at 11, its little wall at 12)

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
  else if (ch === "d") floor = inBuilding(u, v) ? "planks" : "path";
  else if ("#aJ".includes(ch)) floor = ch === "J" ? "jail" : "wall";
  else if ("WGp".includes(ch)) floor = "manor";
  else if ("BcCk~sZn".includes(ch)) floor = inBuilding(u, v) || ch !== "c" ? "planks" : "grass";
  else if (ch === "y" || ch === "S" || ch === "l") floor = "yard";
  else if (ch === "H") floor = "gold";
  else if (ch === ",") floor = "path";
  else if (ch === "w" || ch === "r" || ch === "q") floor = "prismarine";
  else if (ch === "P") floor = "vault";
  else floor = "grass";
  setBlock(dim, at(-1), B(floor));
  for (let y = 0; y <= CLEAR_TO; y++) {
    if (blockId(dim, at(y)) !== "minecraft:air") setBlock(dim, at(y), B("air"));
  }
}

// Stair block climbing toward (du, dv) in the arena.
function stairBlock(a, du, dv) {
  const x = a.r.x * du + a.f.x * dv, z = a.r.z * du + a.f.z * dv;
  const dir = x > 0 ? "east" : x < 0 ? "west" : z > 0 ? "south" : "north";
  const weirdo = { east: 0, west: 1, south: 2, north: 3 }[dir];
  return tryPerm([["minecraft:oak_stairs", { weirdo_direction: weirdo, upside_down_bit: false }],
    ["minecraft:oak_stairs", { "minecraft:cardinal_direction": dir, upside_down_bit: false }], ["minecraft:oak_planks"]], `stairs:${dir}`);
}

// One column of the manor: the ground floor, and the upstairs if there is one.
function buildColumn(dim, a, u, v) {
  const at = (y) => toWorld(a, u, v, y);
  placeCell(dim, a, u, v, cellAt(u, v), (y, perm) => setBlock(dim, at(y), perm), 0);
  if (LAYOUT.floors.length < 2) return;
  const up = cellAt(u, v, 1);
  if (up === " ") return;
  // The upstairs floor (y 5), except over the stairs, then whatever is up there.
  if (up === "o") {
    setBlock(dim, at(5), B("air"));
  } else if (up !== "u") {
    setBlock(dim, at(5), "WGp".includes(up) ? B("manor") : up === "=" ? B("vault") : B("planks"));
  }
  placeCell(dim, a, u, v, up, (y, perm) => setBlock(dim, at(y + 6), perm), 1);
}

function placeCell(dim, a, u, v, ch, put, f) {
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
      if (inBuilding(u, v)) { put(3, B("manor")); put(4, B("manor")); }
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
      break;                       // water goes in last (see extras), so it can't spill while the rows go up
    case "q":
      put(0, B("prismarine")); put(1, B("prismarine")); put(2, B("seaLantern"));
      break;
    case "B":
      for (let y = 0; y <= 2; y++) put(y, B("bookshelf"));
      break;
    case "c": {
      // Gold in a vault (next to its floor or the pedestal), barrels everywhere else.
      let gold = false;
      for (let du = -2; du <= 2 && !gold; du++) {
        for (let dv = -2; dv <= 2; dv++) {
          const n = cellAt(u + du, v + dv, f);
          if ((Math.abs(du) <= 1 && Math.abs(dv) <= 1 && n === "=") || n === "P") { gold = true; break; }
        }
      }
      put(0, gold ? B("gold") : B("barrel"));
      break;
    }
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
    case "s":
    case "u": {
      // A stair step: planks under it, the stair block on top.
      const info = stairInfo(u, v);
      if (!info) break;
      const base = f === 1 ? -6 : 0;   // put() adds 6 upstairs; steps are measured from the ground
      for (let y = 0; y < info.i; y++) put(base + y, B("planks"));
      put(base + info.i, stairBlock(a, info.st.du, info.st.dv));
      break;
    }
    case "Z":
      for (let y = 0; y <= 4; y++) put(y, B("planks"));
      break;
    case "n":
      put(0, B("fence"));
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

// Roofs, water, hidden lights, and (the first time) the buttons and the jail.
function* extras(dim, a, yard = true, vFrom = VMIN) {
  const put = (u, v, y, perm) => setBlock(dim, toWorld(a, u, v, y), perm);
  // Each building's roof, with a little wall around the edge.
  for (const b of LAYOUT.buildings) {
    const top = b.floors === 2 ? 11 : 5;
    for (let v = b.v0; v <= b.v1; v++) {
      for (let u = b.u0; u <= b.u1; u++) {
        put(u, v, top, B("purpur"));
        if ((u === b.u0 || u === b.u1 || v === b.v0 || v === b.v1) && (u + v) % 2 === 0) put(u, v, top + 1, B("manor"));
      }
      yield;
    }
  }
  // Water.
  for (let v = Math.max(vFrom, 0); v <= VMAX; v++) {
    for (let u = 0; u < W; u++) if (cellAt(u, v) === "w") put(u, v, 0, B("water"));
    if (v % 8 === 0) yield;
  }
  // Hidden lights everywhere so no monsters spawn inside, even at night.
  for (let v = vFrom; v <= VMAX; v++) {
    for (let u = 0; u < W; u++) {
      for (let f = 0; f < LAYOUT.floors.length; f++) {
        const ch = cellAt(u, v, f);
        if (!FLOORS.has(ch) || ch === "d" || ch === "a" || ch === "s" || ch === "u") continue;
        const inside = INDOOR.has(ch) && ch !== "j";
        if (!(inside ? u % 5 === 2 && v % 5 === 2 : u % 6 === 3 && v % 6 === 3)) continue;
        const loc = toWorld(a, u, v, (inside ? 4 : 3) + FLOOR_Y[f]);
        if (blockId(dim, loc) === "minecraft:air") setBlock(dim, loc, B("light"));
      }
    }
    if (v % 6 === 0) yield;
  }
  if (!yard) return;
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

// ---------- A new manor ----------
// After every win (or from the map), the manor rebuilds itself from a new seed: the yard and the jail stay, and
// everything inside the outer wall is cleared and built again. Everyone inside is moved out to the gold square first.
// The arena remembers it's rebuilding, so if the world closes halfway the rebuild picks up again.
function newSeed() {
  return 1 + Math.floor(Math.random() * 2000000000);
}

function startRebuild(a, seed) {
  if (!a?.built || building) return;
  const old = LAYOUT;
  a.seed = seed;
  a.rebuilding = true;
  saveArena(a);
  setLayout(seed);
  building = true;
  system.runJob(rebuildJob(a, old));
}

function moveOutOfManor(a) {
  for (const p of world.getAllPlayers()) {
    if (!nearArena(a, p)) continue;
    const l = toLocal(a, p.location);
    if (l.V < 0) continue;
    const [u, v] = START_SPOTS[rand(START_SPOTS.length)];
    try {
      p.teleport(toWorldPos(a, u + 0.5, v + 0.5, 0), { rotation: { x: 0, y: yawOf(a, 0, 1) } });
    } catch {}
  }
}

function* rebuildJob(a, old) {
  const dim = dimOf(a);
  try {
    tickingArea(a, true);
    yield* waitLoaded(a);
    moveOutOfManor(a);
    for (const e of crownsNear(a)) e.remove();
    crown = undefined;
    const near = () => world.getAllPlayers().filter((p) => nearArena(a, p, 48));
    let told;
    for (const p of near()) {
      try {
        told = p.getDynamicProperty("heist:rebuild_tip");
      } catch {}
      if (!told) {
        say(p, "§6The Ender Manor is changing! §fEvery time someone wins, it turns into a brand-new manor, and the treasure is somewhere new.");
        try {
          p.setDynamicProperty("heist:rebuild_tip", true);
        } catch {}
      }
    }
    // Drain the old ponds first so the water can't spill while the rows are cleared.
    if (old) {
      for (let v = 0; v <= VMAX; v++) {
        for (let u = 0; u < W; u++) if (old.floors[0].get(u, v) === "w") setBlock(dim, toWorld(a, u, v, 0), B("air"));
      }
      yield;
    }
    const rows = VMAX + 1;
    for (let v = 0; v <= VMAX; v++) {
      for (let u = 0; u < W; u++) groundColumn(dim, a, u, v);
      if (v % 6 === 0) {
        moveOutOfManor(a);
        for (const p of near()) bar(p, `§eThe manor is changing... ${Math.round((v / rows) * 50)}%`);
      }
      yield;
    }
    for (let v = 0; v <= VMAX; v++) {
      for (let u = 0; u < W; u++) buildColumn(dim, a, u, v);
      if (v % 6 === 0) {
        moveOutOfManor(a);
        for (const p of near()) bar(p, `§eThe manor is changing... ${50 + Math.round((v / rows) * 50)}%`);
        playSound("dig.stone", toWorldPos(a, 35.5, -4.5, 1), 0.8 + (v / rows) * 0.6, 0.5);
      }
      yield;
    }
    yield* extras(dim, a, false, 0);
    a.rebuilding = false;
    saveArena(a);
    tickingArea(a, false);
    ensureCrown(a);
    showPrize(a);
    for (const p of near()) {
      bar(p, "§6A new manor is ready!");
      try {
        p.playSound("random.levelup", { pitch: 1.2, volume: 1 });
      } catch {}
    }
  } catch (e) {
    console.warn(`[Heist] Rebuilding went wrong: ${e}`);
  } finally {
    building = false;
  }
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
          for (let y = 0; y <= CLEAR_TO; y++) setBlock(dim, toWorld(a, u, v, y), B("air"));
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
  return toWorldPos(a, PEDESTAL.U, PEDESTAL.V, FLOOR_Y[PEDESTAL.f || 0] + 1.05);
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
  if (!a?.built) return;
  if (building || a.rebuilding) {
    if (presser) bar(presser, "§eHang on, the manor is changing!");
    return;
  }
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
  giveLocatorMap(player);
  giveBlaster(player);
}

// A free Empty Locator Map (Minecraft's own map), once per player: use it near the manor and it draws the
// grounds from above, with an arrow for you. Hold it in your other hand to keep it handy.
function giveLocatorMap(player) {
  let got;
  try {
    got = player.getDynamicProperty("heist:got_locator");
  } catch {}
  if (got) return;
  let given = false;
  try {
    player.runCommand("give @s empty_map 1 2");   // data 2 = Empty Locator Map
    given = true;
  } catch {}
  if (!given) {
    try {
      giveItem(player, new ItemStack("minecraft:empty_map", 1));
      given = true;
    } catch {}
  }
  if (!given) return;
  try {
    player.setDynamicProperty("heist:got_locator", true);
  } catch {}
  say(player, "§6You got a map! §fUse it in the front garden and it draws the manor's grounds, with an arrow for you. " +
    "Put it in your other hand to keep it handy.");
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

// How many guards: the level's number, plus one more for each step up the treasure ladder (up to 4 more).
function guardCount(g) {
  return g.level.guards + Math.min(4, g.prize || 0);
}

function spawnGuards() {
  const g = game, a = g.a, dim = dimOf(a);
  const taken = [];
  const n = guardCount(g);
  for (let i = 0; i < n; i++) {
    const vault = g.level.vaultGuard && i === 0;
    const far = (s) => !taken.some((t) => t.f === s.f && Math.hypot(t.u - s.u, t.v - s.v) < 9);
    let pool = (vault ? VAULT_SPOTS : SPOTS).filter((s) => s.v >= 22 && far(s));
    if (!pool.length) pool = SPOTS.filter((s) => s.v >= 16 && far(s));
    if (!pool.length) pool = SPOTS;
    const s = pool[rand(pool.length)];
    taken.push(s);
    const gd = {
      U: s.u + 0.5, V: s.v + 0.5, f: s.f || 0, yaw: rand(360), vault, state: "idle", path: [], spot: s, recent: [s],
      until: g.start + COUNTDOWN + 20 + rand(60), susp: 0, target: undefined, lastSeen: undefined, lastSeenAt: 0, variant: -1,
      lookBase: rand(360), repath: 0, nextBlink: g.start + COUNTDOWN + blinkGap(g.level),
    };
    gd.y = heightAt(gd.f, gd.U, gd.V);
    try {
      gd.e = dim.spawnEntity(GUARD, toWorldPos(a, gd.U, gd.V, gd.y));
    } catch (e) {
      console.warn(`[Heist] Couldn't spawn a guard: ${e}`);
      continue;
    }
    portalPuff(a, gd.U, gd.V, gd.y);
    setVariant(gd, 3);
    g.guards.push(gd);
  }
}

function portalPuff(a, U, V, y) {
  const dim = dimOf(a);
  for (let k = 0; k < 10; k++) particle(dim, "minecraft:mob_portal", toWorldPos(a, U + Math.random() - 0.5, V + Math.random() - 0.5, y + Math.random() * 2.6));
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

// ---------- Teleporting, like real Endermen ----------
// Now and then a guard standing at a spot blinks somewhere else in the manor (portal sparkles and a whoosh at both
// ends). Fair play: never within 8 blocks of a player, and never where a player could see it arrive. On Hard, a guard
// that loses track of you may blink to where it last saw you (still not within 5 blocks of anyone).
function blinkGap(level) {
  return level.blink + rand(level.blink);
}

function anyoneNear(U, V, f, dist) {
  for (const rec of game.players.values()) {
    if (rec.jailed >= 0 || !rec.pos) continue;
    if ((rec.pos.f ?? 0) === f && Math.hypot(rec.pos.U - U, rec.pos.V - V) < dist) return true;
  }
  return false;
}

function anyoneCanSee(U, V, f) {
  for (const rec of game.players.values()) {
    if (rec.jailed >= 0 || !rec.pos || (rec.pos.f ?? 0) !== f) continue;
    if (Math.hypot(rec.pos.U - U, rec.pos.V - V) < 24 && lineClear(f, rec.pos.U, rec.pos.V, U, V)) return true;
  }
  return false;
}

function blinkTo(gd, s, now) {
  const a = game.a;
  portalPuff(a, gd.U, gd.V, gd.y);
  playSound("mob.endermen.portal", toWorldPos(a, gd.U, gd.V, gd.y + 1), 1, 0.9);
  gd.U = s.u + 0.5; gd.V = s.v + 0.5; gd.f = s.f || 0;
  gd.y = heightAt(gd.f, gd.U, gd.V);
  gd.path = [];
  gd.spot = s;
  portalPuff(a, gd.U, gd.V, gd.y);
  playSound("mob.endermen.portal", toWorldPos(a, gd.U, gd.V, gd.y + 1), 1.2, 0.9);
  gd.nextBlink = now + blinkGap(game.level);
}

function tryBlink(gd, now) {
  const pool = gd.vault ? VAULT_SPOTS : SPOTS;
  const others = game.guards.filter((o) => o !== gd);
  const options = pool.filter((s) => {
    const f = s.f || 0;
    return Math.hypot(s.u - gd.U, s.v - gd.V) > 10
      && !anyoneNear(s.u + 0.5, s.v + 0.5, f, 8) && !anyoneCanSee(s.u + 0.5, s.v + 0.5, f)
      && !others.some((o) => o.f === f && Math.hypot(o.U - s.u, o.V - s.v) < 6);
  });
  // Don't vanish right in front of someone, either.
  if (!options.length || anyoneNear(gd.U, gd.V, gd.f, 6)) {
    gd.nextBlink = now + 100;
    return false;
  }
  blinkTo(gd, options[rand(options.length)], now);
  return true;
}

// ---------- Getting around ----------
// Path finding on the map grid, on both floors: 8 directions, no cutting corners, stairs straight up and down.
function findPath(from, to) {
  const ff = from.f || 0, tf = to.f || 0;
  if (!guardWalk(to.u, to.v, tf) || !guardWalk(from.u, from.v, ff)) return undefined;
  const target = nodeOf(tf, to.u, to.v);
  const { dist, prev } = bfs(LAYOUT, okArray(LAYOUT, guardOk, "guard"), [nodeOf(ff, from.u, from.v)], target);
  if (dist[target] < 0) return undefined;
  const out = [];
  for (let n = target; prev[n] >= 0; n = prev[n]) out.push({ u: nodeU(n), v: nodeV(n), f: nodeF(n) });
  return out.reverse();
}

// Can a guard walk straight from a to b on the same floor? (Its body is about 0.6 wide; stairs are walked step by step.)
function clearWalk(a, b) {
  const f = a.f || 0;
  if ((b.f || 0) !== f) return false;
  const dist = Math.hypot(b.U - a.U, b.V - a.V);
  const steps = Math.max(1, Math.ceil(dist / 0.2));
  for (let i = 1; i <= steps; i++) {
    const U = a.U + ((b.U - a.U) * i) / steps, V = a.V + ((b.V - a.V) * i) / steps;
    if (stairInfo(Math.floor(U), Math.floor(V))) return false;
    for (const [ou, ov] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
      if (!guardWalk(Math.floor(U + ou), Math.floor(V + ov), f)) return false;
    }
  }
  return true;
}

// Nothing tall in the way between two spots on one floor?
function lineClear(f, U0, V0, U1, V1) {
  const du = U1 - U0, dv = V1 - V0, d = Math.hypot(du, dv);
  const steps = Math.ceil(d / 0.25);
  for (let i = 1; i < steps; i++) {
    const cu = Math.floor(U0 + (du * i) / steps), cv = Math.floor(V0 + (dv * i) / steps);
    if (cu === Math.floor(U0) && cv === Math.floor(V0)) continue;
    if (cu === Math.floor(U1) && cv === Math.floor(V1)) continue;
    if (OPAQUE.has(cellAt(cu, cv, f))) return false;
  }
  return true;
}

// Which floor someone is on: the stairs belong to the ground floor except the top step.
function floorAt(U, V, y) {
  const info = stairInfo(Math.floor(U), Math.floor(V));
  if (info && LAYOUT.floors.length > 1) return info.i <= 4 ? 0 : 1;
  return y >= 3 && LAYOUT.floors.length > 1 ? 1 : 0;
}

// Can the guard see the player? The guard's eyes, the player, and everything in between, on the map grid.
function canSee(gd, p, level, chasing) {
  const du = p.U - gd.U, dv = p.V - gd.V;
  const d = Math.hypot(du, dv);
  const gf = gd.f || 0, gy = gd.y ?? heightAt(gf, gd.U, gd.V);
  if (p.y < gy - 2.5 || p.y > gy + 3) return false;
  const pf = p.f ?? gf;
  const here = cellAt(Math.floor(p.U), Math.floor(p.V), pf);
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
    const ch = cellAt(cu, cv, gf);
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
  return { u: Math.floor(o.U), v: Math.floor(o.V), f: o.f || 0 };
}

function goTo(gd, cell) {
  const path = findPath(cellOf(gd), cell);
  if (!path) return false;
  gd.path = path.map((c) => ({ U: c.u + 0.5, V: c.v + 0.5, f: c.f }));
  return true;
}

function step(gd, speed) {
  let left = speed;
  while (left > 0 && gd.path.length) {
    while (gd.path.length > 1 && clearWalk(gd, gd.path[0]) && clearWalk(gd, gd.path[1])) gd.path.shift();
    const t = gd.path[0];
    const du = t.U - gd.U, dv = t.V - gd.V, d = Math.hypot(du, dv);
    faceToward(gd, du, dv, speed > 0.1 ? 1.5 : 0.6);
    if (d <= left) {
      gd.U = t.U; gd.V = t.V;
      if (t.f !== undefined) gd.f = t.f;
      gd.path.shift();
      left -= d;
    } else {
      gd.U += (du / d) * left; gd.V += (dv / d) * left;
      left = 0;
    }
  }
  gd.y = heightAt(gd.f || 0, gd.U, gd.V);
  return gd.path.length === 0;
}

function pickSpot(gd) {
  const g = game;
  const pool = gd.vault ? VAULT_SPOTS : SPOTS;
  const busySpots = g.guards.filter((o) => o !== gd).map((o) => o.spot);
  const far = (s) => Math.hypot(s.u - gd.U, s.v - gd.V) + ((s.f || 0) !== (gd.f || 0) ? 10 : 0);
  let options = pool.filter((s) => {
    const d = far(s);
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
  if (gd.y === undefined) gd.y = heightAt(gd.f || 0, gd.U, gd.V);

  // Frozen by a rainbow: stands still, sees nothing, catches nobody, and forgets who it was after.
  if (gd.frozenUntil) {
    if (now < gd.frozenUntil) {
      setVariant(gd, 1);
      if (now % 3 === 0) rainbowSparkle(dimOf(a), toWorldPos(a, gd.U + (Math.random() - 0.5) * 0.8, gd.V + (Math.random() - 0.5) * 0.8, gd.y + 0.3 + Math.random() * 2.4));
      return;
    }
    gd.frozenUntil = 0;
    gd.state = "idle";
    gd.susp = 0;
    gd.target = undefined;
    gd.lastSeen = undefined;
    gd.path = [];
    gd.lookBase = gd.yaw;
    gd.until = now + 20;
  }

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
        gd.lastSeen = { U: tracked.pos.U, V: tracked.pos.V, f: tracked.pos.f || 0 };
        gd.lastSeenAt = now;
      }
    } else if (best) {
      gd.susp += bestD < 3 ? 6 : 2;
      if (gd.state !== "suspicious") {
        gd.resume = gd.state;
        gd.state = "suspicious";
        particle(dimOf(a), "heist:question", toWorldPos(a, gd.U, gd.V, gd.y + 3.1));
        playSound("note.bell", toWorldPos(a, gd.U, gd.V, gd.y + 2), 1.4, 0.8);
      }
      gd.suspect = best.player.id;
      gd.lastSeen = { U: best.pos.U, V: best.pos.V, f: best.pos.f || 0 };
      if (gd.susp >= lvl.notice) {
        gd.state = "chase";
        gd.target = best.player.id;
        gd.lastSeenAt = now;
        gd.path = [];
        gd.repath = 0;
        particle(dimOf(a), "heist:alert", toWorldPos(a, gd.U, gd.V, gd.y + 3.1));
        const loc = toWorldPos(a, gd.U, gd.V, gd.y + 2);
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
      if (g.phase === "play" && now >= gd.nextBlink && now >= gd.until - 20 && tryBlink(gd, now)) {
        gd.lookBase = gd.yaw;
        gd.until = now + 40 + rand(60);
        break;
      }
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
        const c = nearestWalk(Math.floor(gd.lastSeen.U), Math.floor(gd.lastSeen.V), 2, gd.lastSeen.f || 0);
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
        // Lost them: look around where they were last seen. On Hard, sometimes blink there.
        gd.state = "search";
        gd.susp = Math.floor(lvl.notice / 2);
        gd.path = [];
        if (!rec || rec.jailed >= 0 || now < rec.grace) gd.lastSeen = undefined;
        if (gd.lastSeen && lvl.chaseBlink && Math.random() < lvl.chaseBlink) {
          const c = nearestWalk(Math.floor(gd.lastSeen.U), Math.floor(gd.lastSeen.V), 3, gd.lastSeen.f || 0);
          if (c && !anyoneNear(c.u + 0.5, c.v + 0.5, c.f, 5) && Math.hypot(c.u - gd.U, c.v - gd.V) > 6) {
            blinkTo(gd, c, now);
            gd.lastSeen = undefined;
          }
        }
        break;
      }
      const goal = gd.lastSeen;
      const direct = clearWalk(gd, goal);
      if (direct) {
        gd.path = [goal];
      } else if (now >= gd.repath || !gd.path.length) {
        gd.repath = now + 8;
        const c = nearestWalk(Math.floor(goal.U), Math.floor(goal.V), 2, goal.f || 0);
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
      if (Math.abs(rec.pos.y - gd.y) > 1.6) continue;
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
    gd.e.teleport(toWorldPos(a, gd.U, gd.V, gd.y), { rotation: { x: 0, y: worldYaw(a, gd.yaw) } });
  } catch {}
}

// Arena yaw (0 = facing +v) -> world yaw.
function worldYaw(a, yaw) {
  const t = (yaw * Math.PI) / 180;
  return yawOf(a, -Math.sin(t), Math.cos(t));
}


// ---------- The Rainbow Blaster ----------
// Everyone gets one at their first game. Tap "use" and a rainbow shot flies out like an arrow: fast at first, falling
// under gravity (aim a little high for far-off guards), trailing a six-colour ribbon. If it hits an Ender Guard, the
// guard freezes for 3 seconds, sparkling, and then forgets who it was chasing. Walls, hedges, bookshelves and crates stop it.
// 3 shots; each comes back after a while (Easy 15 s, Medium 20 s, Hard 30 s; 5 s when there's no game). Not in jail.
const BLASTER_ID = "heist:rainbow_blaster";
const FREEZE_TICKS = 60;
const MAX_CHARGES = 3;
const RAINBOW = [
  { red: 1, green: 0.22, blue: 0.22 }, { red: 1, green: 0.6, blue: 0.12 }, { red: 1, green: 0.95, blue: 0.2 },
  { red: 0.3, green: 0.9, blue: 0.3 }, { red: 0.3, green: 0.55, blue: 1 }, { red: 0.7, green: 0.35, blue: 1 },
];
const blasters = new Map();   // player id -> { charges, next }

function blasterOf(player) {
  let b = blasters.get(player.id);
  if (!b) {
    b = { charges: MAX_CHARGES, next: 0 };
    blasters.set(player.id, b);
  }
  return b;
}
const rechargeTicks = () => (game ? game.level.recharge : 100);

function chargeDots(n) {
  const cols = ["§c", "§e", "§b"];
  let out = "";
  for (let i = 0; i < MAX_CHARGES; i++) out += i < n ? `${cols[i]}● ` : "§7○ ";
  return out.trim();
}

function rainbowSparkle(dim, loc, color) {
  try {
    const vars = new MolangVariableMap();
    vars.setColorRGB("variable.color", color || RAINBOW[rand(RAINBOW.length)]);
    dim.spawnParticle("heist:rainbow", loc, vars);
  } catch {}
}

function giveBlaster(player) {
  let got;
  try {
    got = player.getDynamicProperty("heist:got_blaster");
  } catch {}
  if (got) return;
  try {
    giveItem(player, new ItemStack(BLASTER_ID, 1));
    player.setDynamicProperty("heist:got_blaster", true);
    say(player, "§dYou got a Rainbow Blaster! §fUse it on an Ender Guard to freeze it for 3 seconds. " +
      "It has 3 shots, and each one comes back after a little while.");
  } catch {}
}


function shootRainbow(player) {
  const now = system.currentTick;
  const b = blasterOf(player);
  const rec = game?.players.get(player.id);
  if (rec && rec.jailed >= 0) {
    try {
      player.playSound("note.bass", { pitch: 0.6, volume: 1 });
    } catch {}
    return;
  }
  if (b.charges <= 0) {
    try {
      player.playSound("note.bass", { pitch: 0.8, volume: 1 });
    } catch {}
    bar(player, chargeDots(0));
    return;
  }
  if (b.charges === MAX_CHARGES) b.next = now + rechargeTicks();
  b.charges--;
  bar(player, chargeDots(b.charges));

  const dim = player.dimension;
  const origin = player.getHeadLocation();
  const v = player.getViewDirection();
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  try {
    player.playSound("note.chime", { pitch: 1.8, volume: 1 });
  } catch {}
  // The shot: a real flying rainbow, like an arrow. It starts fast, gravity pulls it down, and it trails a ribbon of
  // six colours. Each tick it moves on in small steps, stopping at walls, the ground, or a guard.
  const shot = {
    pos: { x: origin.x + (v.x / len) * 0.6, y: origin.y - 0.15 + (v.y / len) * 0.6, z: origin.z + (v.z / len) * 0.6 },
    vel: { x: (v.x / len) * SHOT_SPEED, y: (v.y / len) * SHOT_SPEED, z: (v.z / len) * SHOT_SPEED },
    age: 0, dim, owner: player.id,
  };
  const id = system.runInterval(() => {
    let done = false;
    try {
      done = flyShot(shot);
    } catch {
      done = true;
    }
    if (done) system.clearRun(id);
  }, 1);
}

const SHOT_SPEED = 1.6;      // blocks a tick when it leaves the blaster (an arrow at full draw is about 3)
const SHOT_GRAVITY = 0.04;   // pulls it down a little more every tick
const SHOT_LIFE = 60;

// Is this spot blocked for the rainbow? In the manor, walls and the like from the map (and the floors and ceilings);
// anywhere else, real blocks.
function shotBlocked(dim, p) {
  const a = game?.a;
  if (a && dim.id === a.dim) {
    const l = toLocal(a, p);
    if (l.U >= 0 && l.U < W && l.V >= VMIN && l.V < VMAX + 1 && l.y > -1 && l.y < 12) {
      const f = l.y >= 5.5 && LAYOUT.floors.length > 1 && cellAt(Math.floor(l.U), Math.floor(l.V), 1) !== " " ? 1 : 0;
      const ch = cellAt(Math.floor(l.U), Math.floor(l.V), f);
      const yIn = l.y - FLOOR_Y[f];
      if (yIn < 0) return { stop: true };
      if (OPAQUE.has(ch) && yIn < (ch === "h" ? 3 : 5)) return { stop: true };
      if (LOW.has(ch) && yIn < 1) return { stop: true };
      // The roof, and the upstairs floor (except the opening over the stairs).
      const u = Math.floor(l.U), v = Math.floor(l.V);
      const bld = LAYOUT.buildings.find((o) => u >= o.u0 && u <= o.u1 && v >= o.v0 && v <= o.v1);
      if (bld) {
        if (l.y > (bld.floors === 2 ? 11 : 5)) return { stop: true };
        if (bld.floors === 2 && l.y > 5 && l.y < 6 && cellAt(u, v, 1) !== "o") return { stop: true };
      }
      const gd = game.guards.find((o) => !o.frozenUntil && o.e?.isValid() && Math.hypot(o.U - l.U, o.V - l.V) < 0.7 && l.y > o.y - 0.2 && l.y < o.y + 2.9);
      return gd ? { stop: true, hit: gd } : { stop: false };
    }
  }
  let id = "minecraft:air";
  try {
    id = dim.getBlock(p)?.typeId ?? "minecraft:air";
  } catch {
    return { stop: true };
  }
  return { stop: !/air|light_block|grass$|tall_grass|tallgrass|fern|flower|poppy|dandelion|tulip|daisy|allium|cornflower|snow_layer|torch|water/.test(id) };
}

function flyShot(shot) {
  shot.age++;
  const { pos, vel, dim } = shot;
  const speed = Math.hypot(vel.x, vel.y, vel.z) || 1;
  const steps = Math.max(1, Math.ceil(speed / 0.25));
  // The ribbon: six colours stacked across the direction it's flying.
  const hor = Math.hypot(vel.x, vel.z) || 1;
  const side = { x: -vel.z / hor, y: 0, z: vel.x / hor };
  const up = { x: side.y * vel.z - side.z * vel.y, y: side.z * vel.x - side.x * vel.z, z: side.x * vel.y - side.y * vel.x };
  const ul = Math.hypot(up.x, up.y, up.z) || 1;
  for (let i = 1; i <= steps; i++) {
    const p = { x: pos.x + (vel.x * i) / steps, y: pos.y + (vel.y * i) / steps, z: pos.z + (vel.z * i) / steps };
    const r = shotBlocked(dim, p);
    if (r.stop) {
      shotEnd(dim, p, r.hit);
      return true;
    }
    if (i % 2 === 0 || i === steps) {
      RAINBOW.forEach((color, k) => {
        const off = (2.5 - k) * 0.09;
        rainbowSparkle(dim, { x: p.x + (up.x / ul) * off, y: p.y + (up.y / ul) * off, z: p.z + (up.z / ul) * off }, color);
      });
    }
  }
  pos.x += vel.x; pos.y += vel.y; pos.z += vel.z;
  vel.y -= SHOT_GRAVITY;
  vel.x *= 0.99; vel.y *= 0.99; vel.z *= 0.99;
  if (shot.age >= SHOT_LIFE) {
    shotEnd(dim, pos, undefined);
    return true;
  }
  return false;
}

function shotEnd(dim, p, hit) {
  for (let k = 0; k < 10; k++) rainbowSparkle(dim, { x: p.x + (Math.random() - 0.5), y: p.y + (Math.random() - 0.5), z: p.z + (Math.random() - 0.5) });
  playSound(hit ? "random.orb" : "random.pop", p, hit ? 0.7 : 1.4, 1);
  if (hit && game && game.guards.includes(hit)) freezeGuard(hit);
}

function freezeGuard(gd) {
  const now = system.currentTick;
  gd.frozenUntil = now + FREEZE_TICKS;
  gd.path = [];
  const a = game.a;
  playSound("note.chime", toWorldPos(a, gd.U, gd.V, gd.y + 2), 0.8, 1);
  playSound("mob.endermen.idle", toWorldPos(a, gd.U, gd.V, gd.y + 2), 1.6, 0.6);
  for (let k = 0; k < 18; k++) rainbowSparkle(dimOf(a), toWorldPos(a, gd.U + (Math.random() - 0.5), gd.V + (Math.random() - 0.5), gd.y + Math.random() * 2.8));
}

// Shots come back one at a time.
system.runInterval(() => {
  const now = system.currentTick;
  for (const p of world.getAllPlayers()) {
    const b = blasters.get(p.id);
    if (!b || b.charges >= MAX_CHARGES || now < b.next) continue;
    b.charges++;
    b.next = now + rechargeTicks();
    let holding = false;
    try {
      holding = p.getComponent("minecraft:equippable")?.getEquipment("Mainhand")?.typeId === BLASTER_ID;
    } catch {}
    if (holding) {
      bar(p, chargeDots(b.charges));
      try {
        p.playSound("random.orb", { pitch: 1.6, volume: 0.4 });
      } catch {}
    }
  }
}, 10);

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
    if (now % 10 === 0) particle(dim, "heist:sparkle", toWorldPos(a, PEDESTAL.U + Math.random() - 0.5, PEDESTAL.V + Math.random() - 0.5, FLOOR_Y[PEDESTAL.f || 0] + 1.2 + Math.random() * 0.6));
    if (g.phase !== "play") return;
    for (const rec of g.players.values()) {
      if (rec.jailed >= 0 || !rec.pos) continue;
      if (Math.abs(rec.pos.y - FLOOR_Y[PEDESTAL.f || 0]) < 2 && Math.hypot(rec.pos.U - PEDESTAL.U, rec.pos.V - PEDESTAL.V) < GRAB_RANGE) {
        g.carrier = rec.player.id;
        try {
          crown.triggerEvent("heist:carried");
        } catch {}
        // Everyone climbs their own treasure ladder: in your hands it turns into your next prize.
        const mine = prizeStep(rec.player);
        g.carried = mine;
        if (crown.heistPrize !== mine) {
          crown.heistPrize = mine;
          try {
            crown.triggerEvent(`heist:prize_${LADDER[mine].model}`);
          } catch {}
          for (let k = 0; k < 8; k++) particle(dim, "heist:sparkle", rec.player.location);
        }
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
  // Only the winner gets the treasure (their own next step up the ladder) and a best time; everyone hears about it.
  const winner = rec.player;
  const prop = `heist:best_${g.level.name}`;
  let best;
  try {
    best = winner.getDynamicProperty(prop);
  } catch {}
  const got = givePrize(winner);
  let msg = `§6${winner.name} brought the ${got.name} home in ${formatTime(seconds)}! §f(${g.level.name})`;
  if (typeof best !== "number" || seconds < best) {
    try {
      winner.setDynamicProperty(prop, seconds);
    } catch {}
    if (typeof best === "number") msg += " §aNew best time!";
  } else {
    msg += ` §7Best: ${formatTime(best)}`;
  }
  for (const other of g.players.values()) {
    const p = other.player;
    say(p, msg);
    bar(p, p.id === winner.id ? `§6You got the ${got.name}!` : `§6${winner.name} got the ${got.name}!`);
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
  { name: "Royal Cape", item: "heist:royal_cape", slot: "Chest", model: 7,
    busy: "§6It's a pretty shirt with a cape! §fIt goes where a chestplate goes: take the chestplate off to wear it." },
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
        return true;
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
    const wearing = giveItem(player, item, prize.slot);
    if (!wearing && prize.busy) say(player, prize.busy);
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
      if (a?.rebuilding && a.built && !building && world.getAllPlayers().some((p) => nearArena(a, p, 48))) {
        building = true;
        system.runJob(rebuildJob(a, undefined));
      } else if (a?.built && !building && world.getAllPlayers().some((p) => nearArena(a, p, 48))) {
        ensureCrown(a);
        showPrize(a);
        if (crown?.isValid()) particle(dimOf(a), "heist:sparkle", toWorldPos(a, PEDESTAL.U + Math.random() - 0.5, PEDESTAL.V + Math.random() - 0.5, FLOOR_Y[PEDESTAL.f || 0] + 1.4));
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
      rec.pos = { U: l.U, V: l.V, y: l.y, f: floorAt(l.U, l.V, l.y), sneaking: !!rec.player.isSneaking };
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
    // A brand-new manor for the next round.
    system.runTimeout(() => {
      const a2 = getArena();
      if (a2?.built && !game && !building) startRebuild(a2, newSeed());
    }, 40);
    return;
  }

  if (g.phase !== "won") for (const gd of g.guards) guardTick(gd, now);
  crownTick(now);
  jailTick(now);
  if (now % 100 === 0) clearMonsters(a);
}, 1);

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
    layout: () => LAYOUT, spots: () => SPOTS, vaultSpots: () => VAULT_SPOTS, pedestal: () => PEDESTAL, setLayout, generateLayout,
    heightAt, floorAt, stairInfo, shootRainbow, blasterOf, freezeGuard, allConnected, guardCount, isBuilding: () => building, startRebuild, FLOOR_Y,
    LADDER, getGame: () => game, toLocal, toWorld, toWorldPos, getArena, LEVELS,
  };
}
