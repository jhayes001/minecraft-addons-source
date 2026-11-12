// Checks the Builder's Blueprint: frame-only houses, the builder's task list, and where he stands.
// Usage: node tests/builder_test.cjs addons/HouseBlueprint_BP/scripts/main.js [count]
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8");
const start = src.indexOf("const GAP");
const end = src.indexOf("// =====================================================================\n// MINECRAFT SIDE");
const mod = new Function(src.slice(start, end) +
  "\nreturn { STYLES, framePlan, standSpot, canReach, floorY, BUILDER_SPEEDS, OUT, FLOOR, DOORWAY, FRONTDOOR };")();
const { STYLES, framePlan, standSpot, canReach, BUILDER_SPEEDS } = mod;

const N = Number(process.argv[3] || 300);
const DECOR = /chest|bookshelf|furnace|smoker|crafting|barrel|jukebox|noteblock|bed_|cauldron|campfire|amethyst|shelf|carpet|painting|frame:|banner:|cake|plate|(?<!hanging_)lantern|planter|flower/;
let fails = 0;
const times = [], counts = [], lanternStats = [];
const fail = (msg) => { fails++; if (fails < 8) console.log(msg); };

for (let n = 0; n < N; n++) {
  const seed = (n * 2654435761) >>> 0;
  const si = n % STYLES.length;
  const a = framePlan(seed, si);
  if (!a) { fail(`PLAN FAILED ${STYLES[si].name}`); continue; }
  const b = framePlan(seed, si);
  // Same seed, same house, same order (so a build can carry on after the world reloads).
  if (JSON.stringify(a.tasks) !== JSON.stringify(b.tasks) || a.plan.BW !== b.plan.BW) fail(`NOT REPEATABLE ${STYLES[si].name}`);
  const { plan, steps, tasks, prep } = a;

  // No furniture or decorations, but all the bones of the house.
  const decor = steps.filter((s) => s.b && DECOR.test(s.b) || s.lamp || s.decor || s.flower);
  if (decor.length) fail(`DECOR in frame: ${decor.slice(0, 4).map((s) => s.b || "garden").join(", ")}`);
  for (const need of ["floor", "window", "door_lower", "door_upper"]) if (!steps.some((s) => s.b === need)) fail(`missing ${need}`);
  if (plan.stories > 1 && !steps.some((s) => s.b === "stair")) fail("no stairs");
  // Lanterns: hanging under a solid ceiling, never over the stairs, at least one per room, more in big rooms.
  const placed = new Map();
  for (const s of steps) if (s.b) placed.set(`${s.u},${s.v},${s.y}`, s.b);
  const lanterns = steps.filter((s) => s.b === "hanging_lantern");
  for (const l of lanterns) {
    const above = placed.get(`${l.u},${l.v},${l.y + 1}`);
    if (!above || above === "hanging_lantern") fail(`lantern with nothing above it at ${l.u},${l.v},${l.y}`);
    const s = Math.floor((l.y + 1) / 4), st = plan.stairs[s];
    if (st && [...st.t.slice(0, 5), ...st.rail].some(([u, v]) => u === l.u && v === l.v)) fail("lantern over the stairs");
    if (placed.get(`${l.u},${l.v},${l.y - 1}`) || placed.get(`${l.u},${l.v},${l.y - 2}`) === "step") fail(`lantern too low at ${l.u},${l.v}`);
  }
  for (const r of plan.rooms) {
    const fy = -1 + 4 * r.story;
    const n = lanterns.filter((l) => l.y === fy + 3 && l.u >= r.u0 && l.u <= r.u1 && l.v >= r.v0 && l.v <= r.v1).length;
    if (!n) fail(`room without a lantern (${r.u1 - r.u0 + 1}x${r.v1 - r.v0 + 1})`);
    lanternStats.push([(r.u1 - r.u0 + 1) * (r.v1 - r.v0 + 1), n]);
  }
  if (steps.some((s) => s.b === "light")) fail("old ceiling light");
  if (!tasks.some((t) => t.door) || !tasks.some((t) => t.frontPath)) fail("no door/path task");
  if (tasks[tasks.length - 1].frontPath !== true) fail("path should be last");
  if (!prep.some((s) => s.clear) || !prep.some((s) => s.foundation)) fail("prep missing");
  // Every block step turned into exactly one task (door halves count once).
  const blocks = steps.filter((s) => s.b && s.b !== "door_upper").length;
  if (tasks.filter((t) => !t.frontPath).length !== blocks) fail(`task count ${tasks.length} vs ${blocks}`);
  // Stand spots: always within reach. Time it at each speed.
  const mins = BUILDER_SPEEDS.map(({ walk, every }) => {
    let cur = { u: plan.door.u, v: -3, y: 0 }, ticks = 0;
    for (const t of tasks) {
      const sp = standSpot(plan, t, cur);
      if (sp !== cur) { ticks += Math.ceil(Math.hypot(sp.u - cur.u, sp.v - cur.v, sp.y - cur.y) / walk); cur = sp; }
      ticks += every;
    }
    return ticks / 1200;
  });
  let cur = { u: plan.door.u, v: -3, y: 0 }, moves = 0;
  for (const t of tasks) {
    const sp = standSpot(plan, t, cur);
    if (!t.frontPath && !canReach(sp, t)) { fail(`can't reach ${JSON.stringify(t)} from ${JSON.stringify(sp)}`); break; }
    if (sp !== cur) { moves++; cur = sp; }
  }
  times.push(mins);
  counts.push(tasks.length);
  if (n < 3) console.log(`${plan.style.name}, ${plan.stories} floor(s): ${tasks.length} blocks, ${moves} moves, ${mins.map((m) => m.toFixed(1)).join(" / ")} min`);
}

const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
for (const [lo, hi] of [[0, 40], [40, 80], [80, 999]]) {
  const rs = lanternStats.filter(([a]) => a >= lo && a < hi);
  if (rs.length) console.log(`rooms ${lo}-${hi} tiles: ${(rs.reduce((t, [, n]) => t + n, 0) / rs.length).toFixed(1)} lanterns each (${rs.length} rooms)`);
}
console.log(`blocks per house: avg ${avg(counts).toFixed(0)}, max ${Math.max(...counts)}`);
BUILDER_SPEEDS.forEach((sp, i) => {
  const t = times.map((m) => m[i]).sort((x, y) => x - y);
  console.log(`${sp.name}: avg ${avg(t).toFixed(1)} min, shortest ${t[0].toFixed(1)}, longest ${t[t.length - 1].toFixed(1)}`);
});
console.log(`\n${N} frame houses, ${fails} problems.`);
process.exit(fails ? 1 : 0);
