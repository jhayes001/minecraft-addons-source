// Runs the Unicorn Princess script against a small fake Minecraft world and checks the story:
// 1-2 visits every day (daytime), trumpet fanfare and a title, the unicorn rides in from far away along
// the ground past the player, rainbow glitter, treasures only when you walk within 3 blocks (once per
// visit), she rides off and disappears, players under a roof are skipped until late in the day,
// reloading the world doesn't add extra visits, and /scriptevent unicorn:visit works.
// Usage: node tests/unicorn_test.cjs addons/UnicornPrincess_BP/scripts/main.js
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8").replace(/^import .*$/gm, "");

let tick = 0, time = 0, day = 5;
const dyn = new Map();
const handlers = {};
let timers = [];
let nextId = 1;
const system = {
  get currentTick() { return tick; },
  runInterval: (fn, n) => { const id = nextId++; timers.push({ id, fn, every: n || 1, at: tick + (n || 1) }); return id; },
  runTimeout: (fn, n) => { const id = nextId++; timers.push({ id, fn, once: true, at: tick + (n || 1) }); return id; },
  run: (fn) => system.runTimeout(fn, 1),
  clearRun: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  afterEvents: { scriptEventReceive: { subscribe: (fn) => (handlers.script = fn) } },
};
class ItemStack {
  constructor(typeId, amount = 1) {
    if (!typeId.includes(":")) throw new Error("bad item");
    this.typeId = typeId; this.amount = amount;
  }
  setLore(l) { this.lore = l; }
}
class MolangVariableMap { setColorRGB(k, c) { this.color = c; } }

// Flat grassy world at y = 64, with a hill east of x = 60 (steps up 65, 66, then 67; a 3-block drop at x = 120),
// a stone roof over x in [195, 215], and a village of 8 houses in a ring around (-300, 0).
const blocks = new Map();
const K = (x, y, z) => `${x},${y},${z}`;
const groundTop = (x) => (x === 60 ? 65 : x === 61 ? 66 : x >= 62 && x < 120 ? 67 : 64);
function typeAt(x, y, z) {
  const k = K(x, y, z);
  if (blocks.has(k)) return blocks.get(k);
  if (y < groundTop(x)) return "minecraft:grass_block";
  if (y === groundTop(x)) return (x + z) % 3 ? "minecraft:air" : "minecraft:short_grass";
  return "minecraft:air";
}
for (let x = 195; x <= 215; x++) for (let z = -5; z <= 5; z++) blocks.set(K(x, 70, z), "minecraft:stone");
const VILLAGE = { x: -300, z: 0 };
const houses = [];
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2, hx = Math.round(VILLAGE.x + Math.cos(a) * 14) - 3, hz = Math.round(VILLAGE.z + Math.sin(a) * 14) - 3;
  houses.push({ x0: hx, z0: hz, x1: hx + 6, z1: hz + 6 });
  for (let x = hx; x <= hx + 6; x++) for (let z = hz; z <= hz + 6; z++) {
    const edge = x === hx || x === hx + 6 || z === hz || z === hz + 6;
    for (let y = 64; y <= 67; y++) if (edge) blocks.set(K(x, y, z), y < 66 && x === hx + 3 && z === hz ? "minecraft:air" : "minecraft:oak_planks"); // walls with a doorway
    blocks.set(K(x, 68, z), "minecraft:oak_planks"); // roof
  }
  blocks.set(K(hx - 1, 64, hz + 3), "minecraft:oak_fence"); // a fence post outside
}

const entities = [], dropped = [], particles = [], sounds = [], events = [];
const dim = {
  id: "minecraft:overworld",
  getBlock(l) {
    const x = Math.floor(l.x), y = Math.floor(l.y), z = Math.floor(l.z);
    if (y > 320 || y < -64) return undefined;
    return { typeId: typeAt(x, y, z), location: { x, y, z } };
  },
  spawnEntity(type, loc) {
    const e = {
      typeId: type, location: { ...loc }, spawnedAt: { ...loc }, spawnTick: tick, spawnTime: time, valid: true, nameTag: "", events: [], path: [],
      teleport(p, o) { this.location = { ...p }; this.rot = o?.rotation; this.path.push({ ...p }); },
      triggerEvent(ev) { this.events.push(ev); events.push(ev); },
      isValid() { return this.valid; },
      remove() { this.valid = false; const i = entities.indexOf(this); if (i >= 0) entities.splice(i, 1); },
    };
    entities.push(e); spawned.push(e);
    return e;
  },
  getEntities({ type }) { return entities.filter((e) => e.typeId === type); },
  spawnParticle(id, loc, vars) { particles.push({ id, loc, color: vars?.color, tick }); },
  spawnItem(item, loc) { dropped.push({ item, loc, tick, toHavana: flat(loc, players[0].location) }); },
};
const spawned = [];
function makePlayer(name, x, z) {
  return {
    name, id: name, typeId: "minecraft:player", location: { x, y: 64, z }, dimension: dim, messages: [], titles: [], bars: [], heard: [],
    sendMessage(m) { this.messages.push(m); },
    playSound(id, o) { this.heard.push({ id, tick, pitch: o?.pitch }); },
    onScreenDisplay: {},
  };
}
const players = [makePlayer("Havana", 0, 0), makePlayer("Jeff", 0, 60)];
for (const p of players) {
  p.onScreenDisplay = { setTitle: (t, o) => p.titles.push(t + " / " + (o?.subtitle || "")), setActionBar: (t) => p.bars.push(t) };
}
const world = {
  getDynamicProperty: (k) => dyn.get(k), setDynamicProperty: (k, v) => (v === undefined ? dyn.delete(k) : dyn.set(k, v)),
  getDay: () => day, getTimeOfDay: () => time,
  getAllPlayers: () => players, getDimension: () => dim,
  playSound(id, loc) { sounds.push({ id, loc, tick }); },
};
const load = () => new Function("world", "system", "ItemStack", "MolangVariableMap", src)(world, system, ItemStack, MolangVariableMap);
load();

let onTick = null;
function advance(n) {
  for (let i = 0; i < n; i++) {
    tick++;
    time += 1;
    if (time >= 24000) { time -= 24000; day++; }
    if (onTick) onTick();
    for (const t of [...timers]) {
      if (t.at <= tick && timers.includes(t)) {
        if (t.once) timers.splice(timers.indexOf(t), 1); else t.at = tick + t.every;
        t.fn();
      }
    }
  }
}
let failures = 0;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failures++; };
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ---------- Five days with everyone standing still outside ----------
const minDist = new Map();
onTick = () => {
  for (const e of entities) minDist.set(e, Math.min(minDist.get(e) ?? 999, ...players.map((p) => flat(e.location, p.location))));
};
advance(24000 * 5);
const days = {};
for (const e of spawned) {
  const dd = 5 + Math.floor(e.spawnTick / 24000);
  days[dd] = (days[dd] || 0) + 1;
}
const counts = Object.values(days);
check(Object.keys(days).length === 5 && counts.every((c) => c >= 1 && c <= 2), `1-2 visits every day: ${JSON.stringify(days)}`);
check(spawned.every((e) => e.spawnTime >= 1000 && e.spawnTime <= 11100), `visits in the daytime (times ${spawned.map((e) => e.spawnTime).join(", ")})`);
check(spawned.every((e) => players.some((p) => Math.abs(flat(e.spawnedAt, p.location) - 26) < 1)), "she appears about 26 blocks from a player");
check(spawned.every((e) => e.spawnedAt.y === 64 || e.spawnedAt.y === 67), "she starts on the ground");
check(!entities.length && spawned.every((e) => !e.valid), "she leaves (and disappears) after every visit");
const first = spawned[0];
check(first.events.includes("unicorn:walk") && first.events.some((ev) => /unicorn:princess_[0-3]/.test(ev)), `princess picked and walking: ${first.events.slice(0, 2).join(", ")}`);
check(/Princess (Rosalie|Violet|Marina|Sunny)\n.*and \w+/.test(first.nameTag), `name above her: ${JSON.stringify(first.nameTag)}`);
check(first.path.length > 300, `she rides along a path (${first.path.length} steps)`);
check(first.path.every((p, i) => i === 0 || flat(p, first.path[i - 1]) < 0.11), "she moves smoothly (no jumps)");
check([...minDist.values()].every((m) => m > 3 && m < 7), `rides past close by but not into you (closest: ${[...minDist.values()].map((m) => m.toFixed(1)).join(", ")})`);
check(!dropped.length, "no treasure when nobody walks up to her");
const fan = players[0].heard.filter((h) => h.id === "note.bit");
check(fan.length === 10 * spawned.length, `trumpet fanfare plays (${fan.length} notes heard)`);
check(players[0].titles.some((t) => t.includes("A Princess is Coming")), "title announces her");
check(players[0].messages.some((m) => m.includes("Trumpets")), "chat announces her");
const glit = particles.filter((p) => p.id === "unicorn:glitter");
const cols = new Set(glit.map((p) => JSON.stringify(p.color)));
check(glit.length > 300 && cols.size >= 6, `rainbow glitter trail (${glit.length} sparkles in ${cols.size} colors)`);
check(players[0].bars.some((b) => b.includes("Walk up to Princess")), "reminder to walk up to her");
check(players[0].messages.some((m) => m.includes("Next time, walk right up")), "goodbye message says how to get treasure");

// ---------- Walking up to her ----------
const before = spawned.length;
dyn.set("unicorn:plan", JSON.stringify({ day, times: [], done: 0 })); // no scheduled visit gets in the way
let walker = null;
onTick = () => {
  const e = entities[0];
  if (!e) return;
  // Havana runs to the unicorn as soon as it appears; Jeff stays put.
  const p = players[0];
  const dx = e.location.x - p.location.x, dz = e.location.z - p.location.z, dd = Math.hypot(dx, dz);
  if (dd > 2) { p.location = { x: p.location.x + (dx / dd) * 0.25, y: 64, z: p.location.z + (dz / dd) * 0.25 }; }
  walker = e;
};
handlers.script({ id: "unicorn:visit", sourceEntity: players[0] });
check(spawned.length === before + 1, "/scriptevent unicorn:visit brings her right away");
advance(200);
check(walker.events.includes("unicorn:stop"), "she stops when you come within 3 blocks");
check(players[0].messages.some((m) => m.startsWith("§dPrincess ") && m.includes("Havana")), "the princess says hi to you by name");
const mine = dropped.filter((d) => d.tick > 0);
check(mine.length === 3, `she drops 3 treasures: ${mine.map((d) => d.item.amount + " " + d.item.typeId + (d.item.lore ? " (" + d.item.nameTag + ")" : "")).join(", ")}`);
check(mine.every((d) => d.toHavana < 3), `treasures land next to you (${mine.map((d) => d.toHavana.toFixed(1)).join(", ")} blocks away)`);
check(players[0].messages.some((m) => m.startsWith("§aThe princess dropped:")), `treasure list: ${players[0].messages.find((m) => m.startsWith("§aThe princess dropped:"))}`);
check(sounds.some((s) => s.id === "random.levelup") && particles.some((p) => p.id === "minecraft:heart_particle"), "hearts and a happy sound");
const stopTick = mine[0].tick - 20;
const party = particles.filter((p) => p.tick >= stopTick && p.tick < stopTick + 160);
check(party.filter((p) => p.id === "unicorn:glitter").length > 800 && party.filter((p) => p.id === "unicorn:glitter_fountain").length >= 20,
  `glitter goes completely overboard (${party.filter((p) => p.id === "unicorn:glitter").length} sparkles, ${party.filter((p) => p.id === "unicorn:glitter_fountain").length} fountains)`);
advance(400);
check(dropped.length === 3, "only one treasure per visit, even if you stay close");
check(walker.events.filter((e) => e === "unicorn:walk").length >= 2, "she starts walking again after saying hi");
advance(2400);
check(!entities.length, "she rides away afterwards");
check(players[0].messages.some((m) => m.includes("waved goodbye")), "goodbye message");

// ---------- Riding over a hill (ground at 67 east of x = 60) ----------
onTick = null;
players[0].location = { x: 56, y: 64, z: 0 };
let hillRide = null;
for (let tries = 0; tries < 20 && !hillRide; tries++) {
  handlers.script({ id: "unicorn:visit", sourceEntity: players[0] });
  const e = spawned[spawned.length - 1];
  advance(900);
  if (e.path.some((p) => p.x > 63) && e.path.some((p) => p.x < 57)) hillRide = e;
  else advance(2000);
}
const steps = hillRide.path.map((p, i) => (i ? Math.abs(p.y - hillRide.path[i - 1].y) : 0));
check(hillRide.path.filter((p) => p.x > 63).every((p) => Math.abs(p.y - 67) < 0.01) && hillRide.path.filter((p) => p.x < 58.5).every((p) => Math.abs(p.y - 64) < 0.01),
  "she walks up onto the hill and back down");
check(Math.max(...steps) <= 0.25, "climbs smoothly (no popping up)");
advance(2600);
players[0].location = { x: 0, y: 64, z: 0 };

// ---------- Riding through a village: around the houses, never through a wall ----------
players[0].location = { x: VILLAGE.x, y: 64, z: VILLAGE.z };
const inWall = [];
let reached = 0, rides = 0;
for (let n = 0; n < 10; n++) {
  handlers.script({ id: "unicorn:visit", sourceEntity: players[0] });
  const e = spawned[spawned.length - 1];
  let closest = 99;
  onTick = () => { if (e.valid) closest = Math.min(closest, flat(e.location, players[0].location)); };
  advance(2600);
  onTick = null;
  rides++;
  if (closest < 7) reached++;
  for (const p of e.path) {
    for (const dy of [0, 1, 2]) {
      const id = typeAt(Math.floor(p.x), Math.floor(p.y + 0.01) + dy, Math.floor(p.z));
      if (/planks|fence/.test(id)) inWall.push(`${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`);
    }
  }
  check(!e.valid, `village ride ${n + 1} ended`);
  dropped.length = 0;
}
check(!inWall.length, `never walks into a wall, roof, or fence (${inWall.length} bad spots${inWall.length ? ": " + inWall.slice(0, 3).join(" ") : ""})`);
check(reached >= 8, `still finds her way to you through the village (${reached}/${rides} rides)`);
players[0].location = { x: 0, y: 64, z: 0 };

// ---------- Lots of treasure draws ----------
const ids = new Map();
const draw = new Function("world", "system", "ItemStack", "MolangVariableMap", src + "\nreturn [drawTreasure, treasureName, makeItem];")(world, { ...system, runInterval: () => 0, afterEvents: system.afterEvents }, ItemStack, MolangVariableMap);
let shinyFirst = true;
for (let i = 0; i < 3000; i++) {
  const t = draw[0]();
  if (t.length !== 3 || new Set(t.map((x) => x[0])).size !== 3) shinyFirst = false;
  if (!/gold_ingot|emerald|diamond|golden_apple|amethyst_shard/.test(t[0][0])) shinyFirst = false;
  for (const [id] of t) ids.set(id, (ids.get(id) || 0) + 1);
}
check(shinyFirst, "every treasure has something shiny plus 2 different surprises");
check(ids.has("crown") && ids.has("minecraft:totem_of_undying") && ids.get("crown") < 300 && ids.get("minecraft:totem_of_undying") < 140, `special prizes happen but not often (crown ${ids.get("crown")}/3000)`);
const crown = draw[2](["crown", 1], "Rosalie");
check(crown.typeId === "minecraft:golden_helmet" && crown.nameTag.includes("Princess Crown") && crown.lore[0].includes("Rosalie"), "Princess Crown is a named golden helmet");
check(draw[1](["minecraft:gold_ingot", 4]) === "4 gold ingots" && draw[1](["minecraft:oxeye_daisy", 3]) === "3 oxeye daisies" && draw[1](["minecraft:amethyst_shard", 1]) === "an amethyst shard", "treasure names read nicely");

// ---------- Under a roof: skipped until late in the day ----------
for (const p of players) p.location = { x: 205, y: 64, z: 0 };
const n0 = spawned.length;
dyn.set("unicorn:plan", JSON.stringify({ day, times: [], done: 0 })); // today is used up
onTick = null;
advance(24000 - time + 10); // start of a new day
const plan = JSON.parse(dyn.get("unicorn:plan"));
advance(11400 - time);
check(spawned.length === n0, `no visit while everyone is under a roof (plan ${plan.times.join(", ")})`);
advance(1200);
check(spawned.length === n0 + 1, "late in the day she comes anyway (at least once a day)");
advance(3000);
check(!entities.length, "and leaves again");

// ---------- Reloading the world doesn't add visits ----------
for (const p of players) p.location = { x: 0, y: 64, z: p === players[0] ? 0 : 3 };
advance(24000 - time + 10);
const n1 = spawned.length;
advance(11500);
const done = JSON.parse(dyn.get("unicorn:plan")).done;
timers = []; // world closes...
for (const e of entities) e.remove();
load();      // ...and opens again
advance(1000);
check(spawned.length - n1 === done && done >= 1 && done <= 2, `reload keeps the day's count (${spawned.length - n1} visits)`);

// ---------- A unicorn left over from a closed world gets tidied up ----------
timers = [];
const stray = dim.spawnEntity("unicorn:princess", { x: 5, y: 64, z: 5 });
load();
advance(220);
check(!stray.valid, "leftover unicorn removed after a reload");

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
