// Simulates the House Blueprint planner in a voxel world and walks a player through it.
// Usage: node tests/house_test.cjs addons/HouseBlueprint_BP/scripts/main.js [count] [howManyToPrint]
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8");
const start = src.indexOf("const GAP");
const end = src.indexOf("// =====================================================================\n// MINECRAFT SIDE");
const pure = src.slice(start, end);
const mod = new Function(pure + "\nreturn { STYLES, planHouse, buildSteps, floorY, GAP, OUT, FLOOR, WALL, IWALL, DOORWAY, FRONTDOOR };")();
const { STYLES, planHouse, buildSteps, floorY } = mod;

const N = Number(process.argv[3] || 400);
const SHOW = Number(process.argv[4] || 0);

const PASSABLE = (b) => b === undefined || b === "door_lower" || b === "door_upper" ||
  b.startsWith("carpet:") || b === "plate" || b === "flowerRandom" ||
  b === "painting" || b.startsWith("frame:") || b.startsWith("banner:"); // wall decor has no collision
const STANDABLE = (b) => b !== undefined && !PASSABLE(b) && b !== "fence";

let fails = 0;
const stats = { stories: {}, rooms: 0, beds: 0, houses: 0, styles: {} };

for (let n = 0; n < N; n++) {
  const style = STYLES[n % STYLES.length];
  const plan = planHouse(style);
  if (!plan) { console.log("PLAN FAILED"); fails++; continue; }
  const steps = buildSteps(plan);
  const world = new Map();
  const K = (u, v, y) => `${u},${v},${y}`;
  const get = (u, v, y) => (world.has(K(u, v, y)) ? world.get(K(u, v, y)) : y <= -1 ? "ground" : undefined);
  for (const s of steps) {
    if (s.pause || s.path || s.flower || s.foundation || s.decor || s.lamp || s.frontPath) continue;
    if (s.clear) {
      const c = s.clear;
      for (let v = c.v0; v <= c.v1; v++) for (let u = c.u0; u <= c.u1; u++) for (let y = c.y0; y <= c.y1; y++) world.delete(K(u, v, y));
      continue;
    }
    if (s.b === "door_lower" || s.b === "door_upper" || s.b.startsWith("carpet:") || s.b === "plate") world.set(K(s.u, s.v, s.y), s.b);
    else world.set(K(s.u, s.v, s.y), s.b);
  }
  // nothing placed above the computed top
  for (const s of steps) if (s.y !== undefined && s.y > plan.topY) { console.log("ABOVE TOP", s); fails++; break; }

  // BFS walking
  const clear = (u, v, y) => PASSABLE(get(u, v, y));
  const okFeet = (u, v, y) => clear(u, v, y) && clear(u, v, y + 1) && STANDABLE(get(u, v, y - 1));
  const seen = new Set();
  const q = [[plan.door.u, -1, 0]];
  seen.add(K(...q[0]));
  while (q.length) {
    const [u, v, y] = q.shift();
    for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nu = u + du, nv = v + dv;
      if (nu < -2 || nv < -4 || nu > plan.BW + 1 || nv > plan.BD + 1) continue;
      const cands = [];
      if (okFeet(nu, nv, y)) cands.push(y);
      if (okFeet(nu, nv, y + 1) && clear(u, v, y + 2)) cands.push(y + 1);
      for (let k = 1; k <= 3; k++) {
        if (!clear(nu, nv, y - k + 1) || !clear(nu, nv, y + 1)) break;
        if (okFeet(nu, nv, y - k)) { cands.push(y - k); break; }
      }
      for (const ny of cands) {
        const kk = K(nu, nv, ny);
        if (!seen.has(kk)) { seen.add(kk); q.push([nu, nv, ny]); }
      }
    }
  }
  // every open floor tile on every story reachable
  let bad = [];
  const levels = plan.stories + (plan.roofDeck ? 1 : 0);
  for (let s = 0; s < levels; s++) {
    const g = plan.grids[s], fy = floorY(s);
    for (let v = 0; v < plan.BD; v++) for (let u = 0; u < plan.BW; u++) {
      if (g[v][u] !== mod.FLOOR) continue;
      const b = get(u, v, fy + 1);
      if (!PASSABLE(b)) continue; // furniture or step
      if (plan.holes[s].has(`${u},${v}`)) continue;
      if (!seen.has(K(u, v, fy + 1))) bad.push(`s${s}(${u},${v})`);
    }
  }
  // house should be sealed: no way to walk outside -> inside except the door; check rooms have a roof over them
  for (let s = 0; s < plan.stories; s++) {
    const g = plan.grids[s], fy = floorY(s);
    for (let v = 0; v < plan.BD; v++) for (let u = 0; u < plan.BW; u++) {
      if (g[v][u] === mod.OUT) continue;
      if (plan.holes[s + 1] && plan.holes[s + 1].has(`${u},${v}`) && s === plan.stories - 1) continue; // stair opening to the deck
      let covered = false;
      for (let y = fy + 4; y <= plan.topY; y++) if (get(u, v, y) !== undefined) { covered = true; break; }
      if (!covered) bad.push(`uncovered s${s}(${u},${v})`);
    }
  }
  if (bad.length) { fails++; if (fails < 4) { console.log("UNREACHABLE", style.name, plan.stories, bad.slice(0, 8)); show(plan, get); } }

  stats.houses++;
  stats.decks = (stats.decks || 0) + (plan.roofDeck ? 1 : 0);
  stats.stairBlocks = (stats.stairBlocks || 0) + steps.filter((x) => x.b === "stair").length;
  stats.furniture = (stats.furniture || 0) + steps.filter((x) => x.b && /chest|bookshelf|furnace|crafting|barrel|jukebox|noteblock|bed_head|cauldron|campfire|amethyst/.test(x.b)).length;
  // the front door must sit in the front wall with lamp posts outside
  if (!steps.some((x) => x.b === "door_lower") || steps.filter((x) => x.lamp).length !== 2) { fails++; console.log("door/lamps missing"); }
  // New rules: clear zones, no entry-room table, banisters, room sizes.
  const problems = [];
  const FURN = /chest|bookshelf|furnace|smoker|crafting|barrel|jukebox|noteblock|bed_|cauldron|campfire|amethyst|shelf/;
  for (let s = 0; s < plan.stories; s++) {
    const g = plan.grids[s], fy = floorY(s);
    const zone = new Set();
    for (let v = 0; v < plan.BD; v++) for (let u = 0; u < plan.BW; u++) {
      if (g[v][u] !== mod.DOORWAY && g[v][u] !== mod.FRONTDOOR) continue;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) zone.add(`${u + a},${v + b}`);
    }
    const st = plan.stairs[s];
    if (st) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) zone.add(`${st.t[0][0] + a},${st.t[0][1] + b}`);
    const below = plan.stairs[s - 1];
    if (below) for (const [tu, tv] of [below.t[4], below.t[5]]) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) zone.add(`${tu + a},${tv + b}`);
    for (const z of zone) {
      const [u, v] = z.split(",").map(Number);
      const b = get(u, v, fy + 1);
      if (b && FURN.test(b)) problems.push(`s${s} ${b} at ${z} next to a door/doorway/stairs`);
    }
  }
  const living = plan.rooms.find((r) => r.type === "living");
  if (living) {
    for (let v = living.v0; v <= living.v1; v++) for (let u = living.u0; u <= living.u1; u++) {
      if (get(u, v, 0) === "fence" && get(u, v, 1) === "plate") problems.push("table in the entry room");
      if (get(u, v, 1) === "cake") problems.push("cake table in the entry room");
    }
  }
  plan.stairs.forEach((st, s) => {
    if (!st.rail || st.rail.length !== 3 || st.rail.some(([u, v]) => get(u, v, floorY(s) + 1) !== "fence")) problems.push(`stairs on floor ${s + 1} missing banister`);
  });
  for (const r of plan.rooms) if (Math.min(r.u1 - r.u0 + 1, r.v1 - r.v0 + 1) < 5) problems.push(`small room ${r.u1 - r.u0 + 1}x${r.v1 - r.v0 + 1}`);
  if (problems.length) { fails++; if (fails < 5) console.log("RULES", style.name, problems.slice(0, 5)); }
  stats.decor = (stats.decor || 0) + steps.filter((x) => x.b && /painting|frame:|banner:/.test(x.b)).length;
  stats.roomArea = (stats.roomArea || 0) + plan.rooms.reduce((a, r) => a + (r.u1 - r.u0 + 1) * (r.v1 - r.v0 + 1), 0) / plan.rooms.length;
  stats.stories[plan.stories] = (stats.stories[plan.stories] || 0) + 1;
  stats.rooms += plan.rooms.length;
  stats.beds += steps.filter((s) => s.b && s.b.startsWith("bed_head")).length;
  if (n < SHOW) show(plan, get);
}

function show(plan, get) {
  console.log(`\n=== ${plan.style.name}: ${plan.stories} floor(s), ${plan.BW}x${plan.BD}, wing=${plan.wingSide}, rooms=${plan.rooms.map(r => r.type).join(",")} ===`);
  const sym = (b) => {
    if (b === undefined) return " ";
    if (b === "wall" || b === "corner") return "#";
    if (b === "iwall") return "+";
    if (b === "window") return "o";
    if (b.startsWith("door")) return "D";
    if (b === "step") return "S";
    if (b === "fence") return "f";
    if (b.startsWith("bed")) return "B";
    if (b.startsWith("carpet")) return ".";
    return "*";
  };
  for (let s = 0; s < plan.stories + (plan.roofDeck ? 1 : 0); s++) {
    const fy = floorY(s);
    console.log(s === plan.stories ? "-- ROOF DECK --" : "");
    console.log(`-- floor ${s + 1} (feet level; # wall, + inside wall, o window, D door, S steps, f railing, B bed, * furniture) --`);
    for (let v = plan.BD; v >= -1; v--) {
      let line = "";
      for (let u = -1; u <= plan.BW; u++) {
        const b = get(u, v, fy + 1);
        const below = get(u, v, fy);
        line += b === undefined && below === undefined && s > 0 && u >= 0 && v >= 0 && plan.grids[s][v] && plan.grids[s][v][u] === 1 ? "_" : sym(b);
      }
      console.log(line);
    }
  }
  // side view through the middle column
  const u = Math.floor((plan.main.u0 + plan.main.u1) / 2);
  console.log(`-- side view (cut through the middle) --`);
  for (let y = plan.topY; y >= -1; y--) {
    let line = "";
    for (let v = -1; v <= plan.BD; v++) { const b = get(u, v, y); line += b === undefined ? " " : b === "roofSlab" ? "_" : b.startsWith("roof") ? "^" : b === "gable" ? "g" : sym(b); }
    console.log(line);
  }
}

console.log(`avg room ${(stats.roomArea / stats.houses).toFixed(0)} tiles, wall decor per house ${(stats.decor / stats.houses).toFixed(1)}`);
console.log(`decks ${stats.decks}, stair blocks ${stats.stairBlocks}, furniture per house ${(stats.furniture / stats.houses).toFixed(1)}`);
console.log(`\n${stats.houses} houses, ${fails} with problems. Floors: ${JSON.stringify(stats.stories)}. Avg rooms ${(stats.rooms / stats.houses).toFixed(1)}. Beds: ${stats.beds}`);
