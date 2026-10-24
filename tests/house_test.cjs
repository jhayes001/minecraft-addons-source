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
  b.startsWith("carpet:") || b === "plate";
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
    if (s.pause || s.path || s.flower || s.foundation) continue;
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
  for (let s = 0; s < plan.stories; s++) {
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
      let covered = false;
      for (let y = fy + 4; y <= plan.topY; y++) if (get(u, v, y) !== undefined) { covered = true; break; }
      if (!covered) bad.push(`uncovered s${s}(${u},${v})`);
    }
  }
  if (bad.length) { fails++; if (fails < 4) { console.log("UNREACHABLE", style.name, plan.stories, bad.slice(0, 8)); show(plan, get); } }

  stats.houses++;
  stats.stories[plan.stories] = (stats.stories[plan.stories] || 0) + 1;
  stats.rooms += plan.rooms.length;
  stats.beds += steps.filter((s) => s.b === "bed_head").length;
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
  for (let s = 0; s < plan.stories; s++) {
    const fy = floorY(s);
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

console.log(`\n${stats.houses} houses, ${fails} with problems. Floors: ${JSON.stringify(stats.stories)}. Avg rooms ${(stats.rooms / stats.houses).toFixed(1)}. Beds: ${stats.beds}`);
