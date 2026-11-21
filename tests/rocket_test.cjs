// Runs the Rocket to the Moon script in a fake world and flies there and back:
// first join gives a rocket -> put it down -> climb in -> countdown -> lift-off (sliding out
// mid-flight puts you back) -> fade -> the Moon gets built -> land on the pad -> low gravity
// and night on the Moon -> falling off the edge brings you back -> fly home and land where you
// took off -> effects and time go back. Also: two riders at once, a roof in the way, packing up,
// and a fresh rocket turning up for someone stuck on the Moon.
// Usage: node tests/rocket_test.cjs addons/RocketMoon_BP/scripts/main.js
// NO_IMPULSE=1 (rockets ignore pushes, so the script has to teleport them) and TP_DISMOUNTS=1
// (teleporting a rocket throws its riders off) check the backup way of flying. LOAD_R=48 loads
// less of the world around the player, so the little Earth can't be built on the first trip.
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8").replace(/^import .*$/gm, "");

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures++;
};

// ---------- Fake engine ----------
let tick = 0, abs = 5 * 24000 + 6000; // day 5, morning
const timers = [], jobs = [];
let nextId = 1;
const system = {
  get currentTick() { return tick; },
  runInterval: (fn, n) => { const id = nextId++; timers.push({ id, fn, every: n || 1, at: tick + (n || 1) }); return id; },
  runTimeout: (fn, n) => { const id = nextId++; timers.push({ id, fn, once: true, at: tick + (n || 1) }); return id; },
  run: (fn) => system.runTimeout(fn, 1),
  clearRun: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  runJob: (gen) => jobs.push(gen),
};
class BlockPermutation {
  constructor(id) { this.type = { id }; }
  static resolve(id) {
    if (!/^[a-z]+:[a-z_]+$/.test(id) || id === "minecraft:fence" || id === "minecraft:stone") throw new Error("unknown block " + id);
    return new BlockPermutation(id);
  }
}
class MolangVariableMap { constructor() { this.v = {}; } setFloat(k, x) { this.v[k] = x; } }
class ItemStack { constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; } }
const formAnswers = [];
class ActionFormData {
  title() { return this; } body() { return this; } button() { return this; }
  async show() { const a = formAnswers.shift(); return a === undefined ? { canceled: true } : { canceled: false, selection: a }; }
}

const blocks = new Map();
const K = (x, y, z) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
const natural = (y) => (y < 63 ? "minecraft:dirt" : y === 63 ? "minecraft:grass_block" : "minecraft:air");
const idAt = (x, y, z) => blocks.get(K(x, y, z)) ?? natural(Math.floor(y));
const solid = (x, y, z) => !idAt(x, y, z).includes("air");
const players = [];
// A spot is loaded only while a player is within 96 blocks, and only from the tick after they arrive.
const LOAD_R = Number(process.env.LOAD_R || 96);
const loaded = (x, z) => players.some((p) => p.arrivedAt < tick && Math.hypot(p.location.x - x, p.location.z - z) < LOAD_R);

const entities = [];
const dynWorld = new Map();
const handlers = {};
const sub = (name) => ({ subscribe: (fn) => (handlers[name] = fn) });
const sounds = [], particles = [];
const dim = {
  id: "minecraft:overworld",
  heightRange: { min: -64, max: 320 },
  getBlock(l) {
    if (!loaded(l.x, l.z)) return undefined;
    const x = Math.floor(l.x), y = Math.floor(l.y), z = Math.floor(l.z);
    return { typeId: idAt(x, y, z), location: { x, y, z }, setPermutation: (p) => blocks.set(K(x, y, z), p.type.id) };
  },
  spawnEntity(type, loc) {
    if (!loaded(loc.x, loc.z)) throw new Error("unloaded");
    const e = makeShip(loc);
    entities.push(e);
    return e;
  },
  getEntities({ type, location, maxDistance }) {
    return entities.filter((e) => e.alive && e.typeId === type
      && (!location || Math.hypot(e.location.x - location.x, e.location.y - location.y, e.location.z - location.z) <= maxDistance));
  },
  spawnParticle(id, loc, vars) { particles.push({ id, loc, tick, vars: vars?.v }); },
  playSound(id, loc) { sounds.push({ id, tick }); },
  spawnItem(item) { dropped.push(item); },
};
const dropped = [];

function makeShip(loc) {
  const s = {
    id: `ship${nextId++}`, typeId: "rocket:ship", location: { ...loc }, alive: true, dimension: dim,
    v: { x: 0, y: 0, z: 0 }, group: "parked", riders: [], props: new Map(),
    isValid() { return this.alive; },
    remove() { this.alive = false; for (const r of [...this.riders]) dismount(r); },
    teleport(l, o) { this.location = { ...l }; if (o?.rotation) this.rot = o.rotation; if (process.env.TP_DISMOUNTS) for (const r of [...this.riders]) dismount(r); },
    setRotation(r) { this.rot = r; },
    setProperty(k, v) { this.props.set("prop:" + k, v); },
    clearVelocity() { this.v = { x: 0, y: 0, z: 0 }; },
    applyImpulse(i) { if (process.env.NO_IMPULSE) return; this.v.x += i.x; this.v.y += i.y; this.v.z += i.z; },
    triggerEvent(ev) { if (ev === "rocket:fly") this.group = "flying"; if (ev === "rocket:park") this.group = "parked"; },
    getDynamicProperty(k) { return this.props.get(k); },
    setDynamicProperty(k, v) { if (v === undefined) this.props.delete(k); else this.props.set(k, v); },
    getComponent(c) {
      if (c !== "minecraft:rideable") return undefined;
      return {
        getRiders: () => [...s.riders],
        addRider: (p) => mount(p, s),
        ejectRiders: () => { for (const r of [...s.riders]) dismount(r); },
      };
    },
  };
  return s;
}
function mount(p, s) {
  if (!s.alive || s.riders.length >= 2 || p.vehicle) return false;
  if (Math.hypot(p.location.x - s.location.x, p.location.y - s.location.y, p.location.z - s.location.z) > 8) return false;
  s.riders.push(p);
  p.vehicle = s;
  p.location = { x: s.location.x, y: s.location.y + 2.35, z: s.location.z };
  return true;
}
function dismount(p) {
  const s = p.vehicle;
  if (!s) return;
  s.riders.splice(s.riders.indexOf(p), 1);
  p.vehicle = undefined;
  p.location = { x: s.location.x + 1.2, y: s.location.y, z: s.location.z };
}

function makePlayer(name, x, z) {
  const inv = [], props = new Map(), effects = new Map();
  const p = {
    name, id: name, typeId: "minecraft:player", location: { x, y: 64, z }, dimension: dim, arrivedAt: -1,
    messages: [], bars: [], fades: 0, inv, effects, isSneaking: false, selectedSlotIndex: 0, vehicle: undefined, lookAt: undefined,
    isValid() { return true; },
    sendMessage(m) { this.messages.push(m); },
    playSound() {},
    onScreenDisplay: { setActionBar(t) { p.bars.push(t); } },
    camera: { fade() { p.fades++; } },
    getGameMode() { return "survival"; },
    getDynamicProperty: (k) => props.get(k),
    setDynamicProperty: (k, v) => (v === undefined ? props.delete(k) : props.set(k, v)),
    addEffect(id, ticks, o) { effects.set(id, { until: tick + ticks, amp: o?.amplifier ?? 0 }); },
    removeEffect(id) { effects.delete(id); },
    has(id) { const e = effects.get(id); return !!e && e.until > tick; },
    teleport(l) {
      dismount(this);
      if (Math.hypot(l.x - this.location.x, l.z - this.location.z) > 200) this.arrivedAt = tick;
      this.location = { ...l };
    },
    getBlockFromViewDirection() { return this.lookAt ? { block: dim.getBlock(this.lookAt) } : undefined; },
    getComponent(c) {
      if (c === "minecraft:riding") return this.vehicle ? { entityRidingOn: this.vehicle } : undefined;
      if (c === "minecraft:inventory") return {
        container: {
          addItem: (it) => { inv.push(it); },
          getItem: (i) => inv[i],
          setItem: (i, it) => { if (it) inv[i] = it; else inv.splice(i, 1); },
        },
      };
    },
  };
  players.push(p);
  return p;
}

const world = {
  getPlayers: () => players,
  getDimension: () => dim,
  getDynamicProperty: (k) => dynWorld.get(k),
  setDynamicProperty: (k, v) => (v === undefined ? dynWorld.delete(k) : dynWorld.set(k, v)),
  getAbsoluteTime: () => abs,
  setAbsoluteTime: (t) => { abs = t; },
  afterEvents: { playerSpawn: sub("spawn"), itemUse: sub("itemUse") },
  beforeEvents: { playerInteractWithEntity: sub("interact") },
};

function physics() {
  for (const s of entities) {
    if (!s.alive) continue;
    if (s.group === "parked") {
      s.v.y -= 0.08;
      s.v.x = 0; s.v.z = 0;
    }
    let ny = s.location.y + s.v.y;
    // collide with the ground below or a roof above
    if (s.v.y < 0 && solid(s.location.x, ny, s.location.z)) { ny = Math.floor(ny) + 1; s.v.y = 0; }
    if (s.v.y > 0 && solid(s.location.x, ny + 3, s.location.z)) { ny = s.location.y; s.v.y = 0; }
    s.location = { x: s.location.x + s.v.x, y: ny, z: s.location.z + s.v.z };
    s.v.x *= 0.98; s.v.y *= 0.98; s.v.z *= 0.98;
    s.riders.forEach((r, i) => { r.location = { x: s.location.x + (s.riders.length > 1 ? (i ? 0.3 : -0.3) : 0), y: s.location.y + 2.35, z: s.location.z }; });
  }
  for (const p of players) {
    if (p.vehicle) continue;
    // people fall (slowly with slow falling) until they land on something
    const fall = p.has("slow_falling") ? 0.3 : 1;
    if (!solid(p.location.x, p.location.y - 0.01, p.location.z) && loaded(p.location.x, p.location.z)) {
      let ny = p.location.y - fall;
      if (solid(p.location.x, ny, p.location.z)) ny = Math.floor(ny) + 1;
      p.location = { ...p.location, y: ny };
    }
  }
}

function advance(n) {
  for (let i = 0; i < n; i++) {
    tick++;
    abs++;
    physics();
    for (const t of [...timers]) {
      if (t.at > tick) continue;
      t.fn();
      if (t.once) timers.splice(timers.indexOf(t), 1);
      else t.at += t.every;
    }
    for (const g of [...jobs]) {
      for (let k = 0; k < 4000; k++) {
        const r = g.next();
        if (r.done) { jobs.splice(jobs.indexOf(g), 1); break; }
        if (k > 50 && Math.random() < 0.002) break; // the job gets paused between ticks now and then
      }
    }
  }
}
function until(cond, max, label) {
  for (let i = 0; i < max; i++) {
    if (cond()) return true;
    advance(1);
  }
  check(false, `${label} (timed out)`);
  return false;
}

new Function("world", "system", "ItemStack", "BlockPermutation", "ActionFormData", "MolangVariableMap", "console", src)(
  world, system, ItemStack, BlockPermutation, ActionFormData, MolangVariableMap, { warn: (m) => console.log("  warn:", m), log() {} });

(async () => {
// ---------- The trip ----------
const havana = makePlayer("Havana", 10.5, 10.5);
handlers.spawn({ player: havana, initialSpawn: true });
advance(45);
check(havana.inv.some((i) => i.typeId === "rocket:rocket"), "first join gives a Rocket");
check(havana.messages.length === 1, "one chat line about the rocket");

havana.lookAt = { x: 14, y: 63, z: 10 };
handlers.itemUse({ source: havana, itemStack: havana.inv[0] });
const ship1 = entities.find((e) => e.alive);
check(!!ship1 && ship1.location.y === 64 && ship1.location.x === 14.5, "the rocket goes on the ground where she looks");
check(!havana.inv.some((i) => i.typeId === "rocket:rocket"), "the item is used up");

mount(havana, ship1);
advance(10);
check(sounds.some((s) => s.id === "note.pling"), "countdown beeps");
until(() => ship1.group === "flying", 80, "countdown ends");
advance(12);
check(ship1.location.y > 64.05 && ship1.group === "flying", "lift-off after the countdown");
dismount(havana);
advance(2);
check(havana.vehicle === ship1, "sliding out mid-flight puts her back in her seat");
advance(60);
check(ship1.location.y > 90, `the rocket climbs high (y=${ship1.location.y.toFixed(1)})`);
check(particles.some((p) => p.id === "rocket:exhaust") && particles.some((p) => p.id === "rocket:smoke"), "flames and smoke");
until(() => havana.fades > 0, 100, "the screen fades on the way up");
until(() => !ship1.alive, 60, "the Earth rocket is gone once the screen is black");

const moon = JSON.parse(dynWorld.get("rocket:moon"));
check(moon.x === 14 + 2000 && moon.z === 10 && moon.y === 285, "the Moon is 2000 blocks east, high in the sky");
until(() => havana.vehicle && havana.vehicle !== ship1, 700, "after the fade she's in a rocket out in space");
const ship2 = havana.vehicle;
check(JSON.parse(dynWorld.get("rocket:moon")).ground, "the Moon was built while the screen was black (first trip)");
check(ship2.location.x - moon.x > 190 && ship2.location.y > moon.y + 25, `the space flight starts far out from the Moon (${(ship2.location.x - moon.x).toFixed(0)} blocks)`);
const fadesAtStart = havana.fades;
advance(20);
check(havana.fades === fadesAtStart, "no more fading once the picture's back");
const nightDay = Math.floor(abs / 24000);
check(nightDay % 8 === 4 && abs % 24000 > 13000 && abs % 24000 < 23000, `night with a new moon in space (day ${nightDay}, ${abs % 24000})`);
check(nightDay <= 5, "the new-moon day is found by going back, not forward");
let maxTilt = 0, minX = Infinity, cruiseTicks = 0, rot;
const startCruise = tick;
while (havana.vehicle === ship2 && Math.hypot(ship2.location.x - moon.x, ship2.location.z - moon.z) > 3 && tick - startCruise < 700) {
  advance(1);
  maxTilt = Math.max(maxTilt, ship2.props.get("prop:rocket:tilt") ?? 0);
  if (tick - startCruise === 100) rot = ship2.rot?.y;
  cruiseTicks++;
}
check(cruiseTicks > 400, `a long flight (${(cruiseTicks / 20).toFixed(0)} seconds in space)`);
check(maxTilt > 70, `the rocket flies leaning forward (${maxTilt.toFixed(0)} degrees)`);
check(rot !== undefined && rot > 20 && rot < 160, `facing the way it's going (west-ish, yaw ${rot?.toFixed(0)})`);
const ex = particles.filter((p) => p.id === "rocket:exhaust" && p.tick > startCruise + 50 && p.tick < startCruise + 150);
check(ex.length && ex.every((p) => p.vars && p.vars["variable.dx"] > 0.3), "flames come out the back (east, behind it)");
check(particles.some((p) => p.id === "rocket:stardust"), "stardust streams past");
until(() => !havana.vehicle, 400, "the rocket lands and she hops out");
check((ship2.props.get("prop:rocket:tilt") ?? 0) < 1, "it stood back up to land");
const moonNow = JSON.parse(dynWorld.get("rocket:moon"));
check(moonNow.ground && (moonNow.built || LOAD_R < 60), "the Moon finished building");
check(Math.abs(ship2.location.y - (moon.y + 1)) < 0.5, `the rocket sits on the pad (y=${ship2.location.y.toFixed(2)})`);
check(havana.messages.some((m) => m.includes("on the Moon")), "a one-time line about the Moon and getting home");

// What got built
const at = (dx, y, dz) => idAt(moon.x + dx, y, moon.z + dz);
check(at(0, moon.y, 0) === "minecraft:smooth_stone", "launch pad in the middle");
check(at(4, moon.y, 4) === "minecraft:sea_lantern" && at(4, moon.y, 0) === "minecraft:yellow_concrete", "pad has a yellow edge and lights in the corners");
check(at(6, moon.y + 1, 0) === "minecraft:oak_fence" && at(6, moon.y + 4, 2) === "minecraft:red_wool", "a flag by the pad");
let rocks = 0, craterFloor = 0, surface = 0, holes = 0;
for (let dx = -26; dx <= 26; dx++) for (let dz = -26; dz <= 26; dz++) {
  if (Math.hypot(dx, dz) > 26) continue;
  for (let y = moon.y - 30; y <= moon.y + 4; y++) {
    const id = at(dx, y, dz);
    if (id === "rocket:moon_rock") rocks++;
    if (id === "minecraft:gray_concrete" && y >= moon.y - 4) craterFloor++;
  }
  // solid from top to bottom: nothing to fall through and nowhere for mobs to spawn inside
  if (dx === 6 && dz >= 0 && dz <= 4) continue; // the flag
  let top = moon.y + 3;
  while (top > moon.y - 40 && !solid(moon.x + dx, top, moon.z + dz)) top--;
  if (top > moon.y - 40) surface++;
  let y = top;
  while (solid(moon.x + dx, y - 1, moon.z + dz)) y--;
  for (let yy = y - 1; yy > moon.y - 40; yy--) if (solid(moon.x + dx, yy, moon.z + dz)) holes++;
}
check(rocks === 14, `14 moon rocks to collect (${rocks})`);
check(craterFloor > 20, `craters (${craterFloor} crater-floor blocks)`);
check(surface > 2000 && holes === 0, `a solid round Moon (${surface} columns, no hollow pockets)`);
if (LOAD_R >= 60) check(idAt(moon.x - 44, moon.y + 14, moon.z + 10) === "minecraft:blue_concrete", "a little Earth hangs nearby");

// Life on the Moon
advance(20);
check(havana.has("jump_boost") && havana.has("slow_falling") && havana.has("night_vision"), "big floaty jumps and night vision on the Moon");
check(abs % 24000 >= 13500 && Math.floor(dynWorld.get("rocket:saved_abs") / 24000) === 5, "it's night on the Moon");
havana.location = { x: moon.x + 32, y: moon.y - 12, z: moon.z };
advance(20);
check(Math.hypot(havana.location.x - moon.x - 0.5, havana.location.z - moon.z - 0.5) < 1 && havana.location.y >= moon.y + 1,
  "falling off the edge brings her back to the pad");
havana.isSneaking = true;
handlers.interact({ player: havana, target: ship2, set cancel(v) { this.c = v; } });
advance(2);
check(ship2.alive && havana.bars.some((b) => b.includes("stay here")), "can't pack up the only way home");
havana.isSneaking = false;

// A friend rides along? Dad flies up in his own rocket.
const dad = makePlayer("Dad", 30.5, 10.5);
const ship3 = dim.spawnEntity("rocket:ship", { x: 30.5, y: 64, z: 10.5 });
mount(dad, ship3);
until(() => dad.vehicle && dad.vehicle !== ship3, 400, "Dad flies to the Moon too");
until(() => !dad.vehicle, 900, "Dad lands");
const ship4 = entities.find((e) => e.alive && e !== ship2 && Math.hypot(e.location.x - moon.x, e.location.z - moon.z) < 10);
check(ship4 && Math.hypot(ship4.location.x - ship2.location.x, ship4.location.z - ship2.location.z) > 2, "Dad's rocket lands in its own spot on the pad");
check(JSON.parse(dynWorld.get("rocket:moon")).x === moon.x, "same Moon for everyone");

// Both fly home in Havana's rocket
dad.location = { ...ship2.location };
havana.location = { ...ship2.location };
mount(havana, ship2);
mount(dad, ship2);
let farX = 0;
until(() => { if (ship2.alive) farX = Math.max(farX, ship2.location.x - moon.x); return !ship2.alive; }, 700, "the Moon rocket takes off for home");
check(farX > 180, `it flies away into space before the fade (${farX.toFixed(0)} blocks out)`);
until(() => havana.vehicle, 100, "back in a rocket over home");
const ship5 = havana.vehicle;
check(dad.vehicle === ship5, "Dad came too");
check(Math.abs(ship5.location.x - 14.5) < 0.01 && Math.abs(ship5.location.z - 10.5) < 0.01, "it comes down over the launch spot");
until(() => !havana.vehicle, 300, "lands at home and they hop out");
check(Math.abs(ship5.location.y - 64) < 0.5, `the rocket's back on the ground where she took off (y=${ship5.location.y.toFixed(2)})`);
advance(20);
check(!havana.has("jump_boost") && !havana.has("night_vision"), "Moon jumping stops at home");
check(dynWorld.get("rocket:saved_abs") === undefined && abs < 6 * 24000, `the time and day go back (${abs})`);
check(havana.messages.filter((m) => m.includes("on the Moon")).length === 1, "the Moon line only comes once");

// Asteroids got built beside the flight paths (never in the way)
const mm = JSON.parse(dynWorld.get("rocket:moon"));
const built = [...Array(12).keys()].filter((i) => (mm.ast ?? 0) & (1 << i)).length;
const rocky = [...blocks.values()].filter((id) => id === "minecraft:tuff" || id === "minecraft:cobbled_deepslate").length;
check(built >= 4 && rocky > 50, `asteroids out in space (${built} built so far, ${rocky} rock blocks)`);

// Dad's rocket is still on the Moon; nobody's there, so no new one appears
const onMoonShips = () => entities.filter((e) => e.alive && Math.hypot(e.location.x - moon.x, e.location.z - moon.z) < 70).length;
check(onMoonShips() === 1, "Dad's rocket waits on the Moon");

// A roof in the way
blocks.set(K(14, 80, 10), "minecraft:oak_planks");
mount(havana, ship5);
advance(10);
check(!havana.vehicle && havana.bars.some((b) => b.includes("open sky")), "a roof over the rocket: says it needs open sky and lets her out");
blocks.delete(K(14, 80, 10));

// Packing up
havana.isSneaking = true;
formAnswers.push(0);
let ev = { player: havana, target: ship5 };
handlers.interact(ev);
check(ev.cancel === true, "crouch + tap opens the rocket menu instead of climbing in");
advance(3);
await new Promise((r) => setImmediate(r));
check(!ship5.alive && havana.inv.some((i) => i.typeId === "rocket:rocket"), "pack up the rocket puts it back in her inventory");
havana.isSneaking = false;

// Stuck on the Moon with no rocket: a fresh one turns up
for (const e of entities) if (Math.hypot(e.location.x - moon.x, e.location.z - moon.z) < 70) e.alive = false;
havana.teleport({ x: moon.x + 0.5, y: moon.y + 1, z: moon.z + 0.5 });
advance(140);
const rescueShip = entities.find((e) => e.alive && Math.hypot(e.location.x - moon.x, e.location.z - moon.z) < 10);
check(!!rescueShip, "a new rocket lands for someone stuck on the Moon");
check(rescueShip && JSON.parse(rescueShip.props.get("rocket:home")).x === 14.5, "and it knows the way home");

// A second trip finishes any part that wasn't loaded before, without bringing back picked-up rocks
const rockSpots = [...blocks].filter(([, id]) => id === "rocket:moon_rock").map(([k]) => k);
blocks.delete(rockSpots[0]);
havana.location = { ...rescueShip.location };
mount(havana, rescueShip);
until(() => !rescueShip.alive, 700, "back home again");
until(() => !havana.vehicle && havana.location.y < 100, 400, "home");
const ship6 = entities.find((e) => e.alive && Math.hypot(e.location.x - 14.5, e.location.z - 10.5) < 1);
mount(havana, ship6);
until(() => havana.vehicle && havana.vehicle !== ship6, 400, "up to the Moon a third time");
if (LOAD_R < 60) havana.location = { x: moon.x - 20, y: moon.y + 41, z: moon.z }; // looking toward Earth
until(() => !havana.vehicle, 900, "and down");
advance(100);
check(!blocks.has(rockSpots[0]) || blocks.get(rockSpots[0]) !== "rocket:moon_rock", "a moon rock she took stays taken");
check(JSON.parse(dynWorld.get("rocket:moon")).ground, "ground still done");

// Nothing more spawned while she waits
advance(200);
check(entities.filter((e) => e.alive && Math.hypot(e.location.x - moon.x, e.location.z - moon.z) < 70).length === 1, "only one rescue rocket");

console.log(failures ? `\n${failures} FAILED` : "\nAll good");
process.exit(failures ? 1 : 0);
})();
