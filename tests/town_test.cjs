// Checks the town buildings: each plans reliably, has its sign, its rooms, and its special pieces.
// Usage: node tests/town_test.cjs addons/HouseBlueprint_BP/scripts/main.js [perBuilding] [showMaps]
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8");
const pure = src.slice(src.indexOf("const GAP"), src.indexOf("// =====================================================================\n// MINECRAFT SIDE"));
const { STYLES, planHouse, buildSteps, floorY, framePlan } = new Function(pure + "\nreturn { STYLES, planHouse, buildSteps, floorY, framePlan };")();

const N = Number(process.argv[3] || 200);
const SHOW = process.argv[4] === "show";
// What each building must have (in most of its plans): [label, test on the steps, how often at least]
const count = (steps, re) => steps.filter((s) => s.b && re.test(s.b)).length;
const NEEDS = {
  "Library": [["bookshelves", (st) => count(st, /^bookshelf$/) >= 20, 0.95], ["reading table", (st) => st.some((s) => s.b === "plate"), 0.8]],
  "Grocery Store": [["food barrels", (st) => count(st, /^food_barrel$/) >= 8, 0.95], ["checkout", (st) => count(st, /^counter$/) >= 1, 0.9],
    ["produce", (st) => count(st, /melon_block|pumpkin|hay_block/) >= 2, 0.9]],
  "Town Hall": [["lectern", (st) => count(st, /^lectern$/) >= 1, 0.9], ["seats", (st) => count(st, /^seat$/) >= 8, 0.85]],
  "Police Station": [["jail cell", (st) => count(st, /iron_bars/) >= 4, 0.85], ["desks", (st) => count(st, /^desk$/) >= 1, 0.95]],
  "Fire Station": [["garage door", (st, p) => !!p.bay, 1], ["fire truck", (st) => count(st, /black_concrete/) === 4, 0.9],
    ["bunks", (st) => count(st, /^bed_head/) >= 2, 0.9]],
  "Hospital": [["beds", (st) => count(st, /^bed_head/) >= 4, 0.9], ["medicine", (st) => count(st, /brewing_stand/) >= 1, 0.9]],
};

let fails = 0;
const town = STYLES.filter((s) => s.town);
if (town.length !== 6) { console.log(`expected 6 town buildings, found ${town.length}`); fails++; }
for (const style of town) {
  const hits = {}, sizes = [];
  let planFails = 0, ok = 0;
  for (let n = 0; n < N; n++) {
    const plan = planHouse(style);
    if (!plan) { planFails++; continue; }
    const steps = buildSteps(plan);
    ok++;
    sizes.push(`${plan.BW}x${plan.BD}x${plan.stories}`);
    const signs = steps.filter((s) => s.b === "sign");
    if (signs.length !== 1 || signs[0].v !== -1 || signs[0].u !== plan.door.u || signs[0].y !== 2) { fails++; console.log(`${style.name}: sign missing or misplaced`); }
    if (steps.some((s) => s.b === "gift_chest")) { fails++; console.log(`${style.name}: has a gift chest`); }
    if (steps.some((s) => s.b && s.b.startsWith("minecraft:") && !/^minecraft:[a-z_]+$/.test(s.b))) { fails++; console.log("bad block id"); }
    // Garage: the 4-wide, 3-tall opening really is open.
    if (plan.bay) {
      const walls = steps.filter((s) => s.b && s.v === 0 && s.u >= plan.bay.u0 && s.u <= plan.bay.u1 && s.y >= 0 && s.y <= 2);
      if (walls.length) { fails++; console.log(`${style.name}: garage opening has blocks in it`); }
    }
    for (const [label, test, min] of NEEDS[style.name] || []) if (test(steps, plan)) hits[label] = (hits[label] || 0) + 1;
    // The frame-only version (Builder's Blueprint) keeps the sign and the garage opening, but no furniture.
    if (n < 20) {
      const fp = framePlan(1000 + n, STYLES.indexOf(style));
      if (!fp) { fails++; console.log(`${style.name}: frame plan failed`); }
      else if (!fp.steps.some((s) => s.b === "sign") || fp.steps.some((s) => s.b && /barrel|bookshelf|seat|bed_|iron_bars|concrete$/.test(s.b) && !/wall|corner|base|parapet/.test(s.b))) {
        const odd = fp.steps.filter((s) => s.b && /barrel|bookshelf|seat|bed_|iron_bars/.test(s.b)).map((s) => s.b);
        if (odd.length || !fp.steps.some((s) => s.b === "sign")) { fails++; console.log(`${style.name}: frame has ${odd.slice(0, 3).join(", ") || "no sign"}`); }
      }
    }
    if (SHOW && n === 0) show(plan, steps);
  }
  const rate = (planFails / N);
  if (rate > 0.02) { fails++; console.log(`${style.name}: ${planFails}/${N} plans failed`); }
  const parts = (NEEDS[style.name] || []).map(([label, , min]) => {
    const r = (hits[label] || 0) / ok;
    if (r < min) { fails++; return `${label} ${(r * 100).toFixed(0)}% (WANT ${(min * 100).toFixed(0)}%)`; }
    return `${label} ${(r * 100).toFixed(0)}%`;
  });
  console.log(`${style.name.padEnd(15)} ${parts.join(", ")}  e.g. ${sizes.slice(0, 3).join(" ")}`);
}

function show(plan, steps) {
  const world = new Map();
  for (const s of steps) if (s.b) world.set(`${s.u},${s.v},${s.y}`, s.b);
  const sym = (b) => {
    if (!b) return " ";
    if (/^(wall|corner|base|wallBand)/.test(b)) return "#";
    if (b === "iwall") return "+";
    if (b === "window") return "o";
    if (b.startsWith("door")) return "D";
    if (b === "seat") return "h";
    if (b === "bookshelf") return "B";
    if (b === "food_barrel") return "b";
    if (b === "lectern") return "L";
    if (b === "desk" || b === "counter") return "=";
    if (b.includes("iron_bars")) return "|";
    if (b.startsWith("bed")) return "Z";
    if (b.includes("concrete")) return "T";
    if (b.startsWith("carpet")) return ".";
    if (b === "step" || b === "stair") return "S";
    if (b === "fence") return "f";
    return "*";
  };
  console.log(`\n=== ${plan.style.name}: ${plan.stories} floor(s), ${plan.BW}x${plan.BD}; rooms ${plan.rooms.map((r) => r.type).join(", ")} ===`);
  for (let s = 0; s < plan.stories; s++) {
    console.log(`-- floor ${s + 1} --  (# wall, o window, D door, B bookshelves, b food barrels, h seats, L lectern, = desk/counter, | bars, Z bed, T truck)`);
    for (let v = plan.BD - 1; v >= -1; v--) {
      let line = "";
      for (let u = -1; u <= plan.BW; u++) line += sym(world.get(`${u},${v},${floorY(s) + 1}`));
      console.log(line);
    }
  }
}

console.log(`\n${fails} problems.`);
process.exit(fails ? 1 : 0);
