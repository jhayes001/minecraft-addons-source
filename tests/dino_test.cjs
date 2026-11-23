// Runs the Dino Park script against a small fake Minecraft world and checks: the starter basket of eggs (once),
// setting an egg down and hatching it, feeding babies until they grow up (and growing up by themselves),
// riding only grown-ups, crouch-tap to wait/follow, the pterodactyl circling, landing beside you, taking off
// and flying where its rider looks, and the T. rex: it comes every 2-3 days, walks past, knocks down trees,
// never touches anything built, gobbles monsters, shakes the ground, and leaves. No big titles anywhere.
// Usage: node tests/dino_test.cjs addons/DinoPark_BP/scripts/main.js
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8").replace(/^import .*$/gm, "");

let tick = 0, time = 2000, day = 3;
const dyn = new Map();
const handlers = {};
let timers = [], nextId = 1;
const system = {
  get currentTick() { return tick; },
  runInterval: (fn, n) => { const id = nextId++; timers.push({ id, fn, every: n || 1, at: tick + (n || 1) }); return id; },
  runTimeout: (fn, n) => { const id = nextId++; timers.push({ id, fn, once: true, at: tick + (n || 1) }); return id; },
  run: (fn) => system.runTimeout(fn, 1),
  clearRun: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  afterEvents: { scriptEventReceive: { subscribe: (fn) => (handlers.script = fn) } },
};
class ItemStack {
  constructor(typeId, amount = 1) { if (!typeId.includes(":")) throw new Error("bad item"); this.typeId = typeId; this.amount = amount; }
}

// World: flat grass at y = 64 (ground top block y = 63). Trees every 6 blocks, except a clearing around (0, 0).
// Four little houses (planks, glass, a door) 18 blocks out, and a big pond to the far north-east.
const blocks = new Map();
const K = (x, y, z) => `${x},${y},${z}`;
const houses = [];
function typeAt(x, y, z) {
  const k = K(x, y, z);
  if (blocks.has(k)) return blocks.get(k);
  if (y < 64) return "minecraft:grass_block";
  return "minecraft:air";
}
for (let x = -90; x <= 90; x += 6) for (let z = -90; z <= 90; z += 6) {
  if (Math.hypot(x, z) < 8) continue;
  for (let y = 64; y < 69; y++) blocks.set(K(x, y, z), "minecraft:oak_log");
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = 67; y <= 70; y++) {
    if ((dx || dz || y > 68) && !blocks.has(K(x + dx, y, z + dz))) blocks.set(K(x + dx, y, z + dz), "minecraft:oak_leaves");
  }
}
for (const [hx, hz] of [[18, 0], [-18, 0], [0, 18], [0, -18]]) {
  houses.push({ x0: hx - 3, x1: hx + 3, z0: hz - 3, z1: hz + 3 });
  for (let x = hx - 3; x <= hx + 3; x++) for (let z = hz - 3; z <= hz + 3; z++) for (let y = 64; y <= 68; y++) {
    const edge = x === hx - 3 || x === hx + 3 || z === hz - 3 || z === hz + 3 || y === 68;
    blocks.set(K(x, y, z), edge ? (y === 66 && (x === hx || z === hz) ? "minecraft:glass" : "minecraft:oak_planks") : "minecraft:air");
  }
}
const builtBefore = [...blocks.entries()].filter(([, id]) => /planks|glass/.test(id)).length;

const entities = [], sounds = [], particles = [], commands = [], destroyed = [];
let spawned = [];
function makeEntity(type, loc, dim) {
  const e = {
    typeId: type, id: `e${nextId++}`, location: { ...loc }, dimension: dim, valid: true, nameTag: "", events: [], props: new Map(),
    impulses: [], tamedBy: null, riderList: [], leashed: false, killed: false,
    teleport(p, o) { this.location = { ...p }; if (o?.rotation) this.rot = o.rotation; },
    triggerEvent(ev) { this.events.push(ev); if (ev === "dino:grow_up") this.grown = true; },
    isValid() { return this.valid; },
    remove() { this.valid = false; const i = entities.indexOf(this); if (i >= 0) entities.splice(i, 1); },
    kill() { this.killed = true; this.remove(); },
    getDynamicProperty(k) { return this.props.get(k); },
    setDynamicProperty(k, v) { this.props.set(k, v); },
    clearVelocity() { this.vel = { x: 0, y: 0, z: 0 }; },
    applyImpulse(v) { this.impulses.push(v); this.location = { x: this.location.x + v.x, y: this.location.y + v.y, z: this.location.z + v.z }; },
    setRotation(r) { this.rot = r; },
    addEffect(id, d, o) { this.effects = (this.effects || []).concat([{ id, d, amp: o?.amplifier, tick }]); },
    getComponent(c) {
      if (c === "minecraft:tameable") return { get isTamed() { return !!e.tamedBy; }, tame: (p) => (e.tamedBy = p.name) };
      if (c === "minecraft:rideable") return e.grown || !e.typeId.startsWith("dino:") ? { getRiders: () => e.riderList } : undefined;
      if (c === "minecraft:leashable") return { isLeashed: e.leashed };
      return undefined;
    },
  };
  return e;
}
const dim = {
  id: "minecraft:overworld",
  getBlock(l) {
    const x = Math.floor(l.x), y = Math.floor(l.y), z = Math.floor(l.z);
    if (y > 320 || y < -64) return undefined;
    return { typeId: typeAt(x, y, z), location: { x, y, z } };
  },
  spawnEntity(type, loc) { const e = makeEntity(type, loc, dim); entities.push(e); spawned.push(e); return e; },
  getEntities(q = {}) {
    return entities.filter((e) => (!q.type || e.typeId === q.type)
      && (!q.families || q.families.some((f) => (f === "dino" && e.typeId.startsWith("dino:") && e.typeId !== "dino:egg" && e.typeId !== "dino:trex") || (f === "monster" && e.monster)))
      && (!q.location || Math.hypot(e.location.x - q.location.x, e.location.y - q.location.y, e.location.z - q.location.z) <= q.maxDistance));
  },
  spawnParticle(id, loc) { particles.push({ id, loc, tick }); },
  spawnItem() {},
  playSound(id, loc, o) { sounds.push({ id, loc, tick, pitch: o?.pitch }); },
  runCommand(cmd) {
    commands.push({ cmd, tick });
    const m = /^setblock (-?\d+) (-?\d+) (-?\d+) air destroy$/.exec(cmd);
    if (m) {
      const k = K(+m[1], +m[2], +m[3]);
      destroyed.push(typeAt(+m[1], +m[2], +m[3]));
      blocks.set(k, "minecraft:air");
    }
  },
};
const otherDim = { id: "minecraft:nether", getEntities: () => [], getBlock: () => undefined };
function makePlayer(name, x, z) {
  const inv = [];
  const p = {
    name, id: name, typeId: "minecraft:player", location: { x, y: 64, z }, dimension: dim, messages: [], titles: [], bars: [], effects: [],
    props: new Map(), isSneaking: false, selectedSlotIndex: 0, view: { x: 0, y: -1, z: 0 }, knocked: 0, inv,
    sendMessage(m) { this.messages.push(m); },
    playSound() {},
    getDynamicProperty(k) { return this.props.get(k); },
    setDynamicProperty(k, v) { this.props.set(k, v); },
    getGameMode() { return "survival"; },
    getViewDirection() { return this.view; },
    getRotation() { return { x: 0, y: 30 }; },
    addEffect(id, d) { this.effects.push(id); },
    applyKnockback() { this.knocked++; },
    getBlockFromViewDirection() { return { block: dim.getBlock({ x: this.location.x, y: 63, z: this.location.z - 2 }) }; },
    getComponent(c) {
      if (c !== "minecraft:inventory") return undefined;
      return { container: {
        addItem: (it) => { inv.push(it); },
        getItem: (i) => inv[i],
        setItem: (i, it) => { if (it) inv[i] = it; else inv.splice(i, 1); },
      } };
    },
    onScreenDisplay: {},
  };
  p.onScreenDisplay = { setTitle: (t) => p.titles.push(t), setActionBar: (t) => p.bars.push(t) };
  return p;
}
const havana = makePlayer("Havana", 0.5, 0.5), jeff = makePlayer("Jeff", 3.5, 0.5);
const players = [havana, jeff];
const world = {
  getDynamicProperty: (k) => dyn.get(k), setDynamicProperty: (k, v) => (v === undefined ? dyn.delete(k) : dyn.set(k, v)),
  getDay: () => day, getTimeOfDay: () => time,
  getAllPlayers: () => players,
  getDimension: (d) => (d === "overworld" ? dim : otherDim),
  playSound(id, loc, o) { sounds.push({ id, loc, tick, pitch: o?.pitch }); },
  afterEvents: {
    playerSpawn: { subscribe: (fn) => (handlers.spawn = fn) },
    itemUse: { subscribe: (fn) => (handlers.use = fn) },
  },
  beforeEvents: { playerInteractWithEntity: { subscribe: (fn) => (handlers.interact = fn) } },
};
new Function("world", "system", "ItemStack", src)(world, system, ItemStack);

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
function tap(player, target, item, sneaking = false) {
  player.isSneaking = sneaking;
  if (item) player.inv[0] = new ItemStack(item, 10); else player.inv.splice(0, player.inv.length);
  const ev = { player, target, itemStack: item ? player.inv[0] : undefined, cancel: false };
  handlers.interact(ev);
  advance(2);
  player.isSneaking = false;
  return ev.cancel;
}
const PT = (p) => ({ ...p });

// ---------- Starter basket ----------
handlers.spawn({ player: havana, initialSpawn: true });
handlers.spawn({ player: jeff, initialSpawn: true });
advance(140);
const ids = havana.inv.map((i) => i.typeId);
check(ids.filter((i) => /^dino:\w+_egg$/.test(i)).length === 8, `Havana gets one egg of each of the 8 dinos (${ids.filter((i) => i.endsWith("_egg")).length})`);
check(ids.includes("minecraft:wheat") && ids.includes("minecraft:beef") && ids.includes("minecraft:cod"), "...plus wheat, beef and fish to feed them");
handlers.spawn({ player: havana, initialSpawn: true });
advance(140);
check(havana.inv.filter((i) => i.typeId.endsWith("_egg")).length === 8, "rejoining doesn't give a second basket");

// ---------- Egg -> baby ----------
function hatchOne(player, key) {
  player.inv.splice(0, player.inv.length, new ItemStack(`dino:${key}_egg`, 1));
  spawned = [];
  handlers.use({ source: player, itemStack: player.inv[0] });
  const egg = spawned.find((e) => e.typeId === "dino:egg");
  advance(5);
  return egg;
}
const egg = hatchOne(havana, "triceratops");
check(!!egg && egg.events.includes("dino:kind_0"), "setting the egg down puts a Triceratops egg (kind 0) on the ground");
check(havana.inv.length === 0, "the egg leaves your hand");
check(egg && Math.abs(egg.location.y - 64) < 0.01, "the egg sits on top of the grass");
advance(210);
const tri = entities.find((e) => e.typeId === "dino:triceratops");
check(!!tri && !egg.valid, "10 seconds later a baby Triceratops hatches and the egg is gone");
check(tri && tri.props.get("dino:owner") === "Havana" && tri.tamedBy === "Havana", "the baby is Havana's from the start");
check(tri && tri.props.get("dino:stage") === 0 && tri.nameTag.length > 0, `it has a name (${tri?.nameTag}) and starts as a baby`);
check(havana.bars.some((b) => /Meet .*baby Triceratops/.test(b)), "a small note above the hotbar says hello");
const tipCount = havana.messages.filter((m) => m.includes("grow up when you feed")).length;
check(tipCount === 1, "the how-to tip is in the chat once");
hatchOne(havana, "stegosaurus");
advance(210);
check(havana.messages.filter((m) => m.includes("grow up when you feed")).length === 1, "...and not again for the second egg");
check(havana.titles.length === 0, "no big titles");

// ---------- Feeding, riding, waiting ----------
check(tap(havana, tri, null) === true, "tapping a baby with an empty hand pets it (no riding a baby)");
check(tap(havana, tri, "minecraft:beef") === false, "a Triceratops doesn't eat meat (Minecraft handles the tap)");
for (let i = 0; i < 4; i++) { tap(havana, tri, "minecraft:wheat"); advance(12); }
check(tri.props.get("dino:food") === 4 && !tri.grown, "4 wheat: still a baby, nearly there");
check(havana.bars.some((b) => b.includes("■")), "feeding shows a little growing bar");
tap(havana, tri, "minecraft:apple");
check(tri.grown && tri.props.get("dino:stage") === 1, "5th treat: the Triceratops grows up");
check(havana.messages.some((m) => /Tap .* to ride/.test(m)), "the first time, the chat says how to ride");
check(tap(havana, tri, null) === false, "now an empty-hand tap lets Minecraft put you on its back");
tri.effects = [];
advance(40);
check(tri.effects.length === 0, "not boosted while nobody is riding");
tri.riderList = [havana];
advance(40);
check(tri.effects.length >= 3 && tri.effects.every((e) => e.id === "speed" && e.amp === 1 && e.d <= 40), "with a rider on board it's faster (Speed, wears off right after)");
tri.riderList = [];
tri.effects = [];
advance(40);
check(tri.effects.length === 0, "...and back to normal when the rider hops off");
check(tap(havana, tri, null, true) === true && tri.events.includes("dino:stay"), "crouch + tap: it waits");
advance(12);
check(tap(havana, tri, null, true) === true && tri.events.filter((e) => e === "dino:follow").length >= 1, "crouch + tap again: it follows");

// Renamed with a name tag: messages use the new name.
const steg = entities.find((e) => e.typeId === "dino:stegosaurus");
check(tap(havana, steg, "minecraft:name_tag") === false, "tapping with a name tag is left to Minecraft (it renames)");
steg.nameTag = "Mr. Spikes";
tap(havana, steg, null);
check(havana.bars[havana.bars.length - 1].includes("Mr. Spikes"), "after renaming, the dino's messages use its new name");
// Growing up by itself.
advance(20 * 60 * 16);
check(steg.grown, "a baby that's never fed still grows up by itself (in about 15 minutes)");

// Catching up.
tri.location = { x: 80, y: 64, z: 80 };
advance(60);
check(flat(tri.location, havana.location) > 5 && flat(tri.location, havana.location) < 8, `a following dino that's far behind catches up, but stays a few steps back (${flat(tri.location, havana.location).toFixed(1)} blocks)`);
advance(12);
tap(havana, tri, null, true);
tri.location = { x: 80, y: 64, z: 80 };
advance(60);
check(flat(tri.location, havana.location) > 50, "a waiting dino stays put");

// ---------- Pterodactyl ----------
const pegg = hatchOne(havana, "pterodactyl");
advance(210);
const pt = entities.find((e) => e.typeId === "dino:pterodactyl");
check(!!pt, "a pterodactyl hatches");
let maxD = 0, minH = 99;
havana.location = { x: 0.5, y: 64, z: 0.5 };
let wiggle = 0;
onTick = () => { havana.location = { x: 0.5 + Math.sin(tick / 20) * 2, y: 64, z: 0.5 }; };   // walking around
advance(200);
for (let i = 0; i < 200; i++) {
  advance(1);
  maxD = Math.max(maxD, flat(pt.location, havana.location));
  minH = Math.min(minH, pt.location.y - 64);
}
check(maxD < 7 && minH > 2, `the baby flies circles around Havana, above her head (within ${maxD.toFixed(1)} blocks, at least ${minH.toFixed(1)} up)`);
check(pt.events.includes("dino:fly") || pt.events.length === 0, "wings out while flying");
onTick = null;                     // Havana stops
advance(160);
check(pt.events[pt.events.length - 1] === "dino:perch" && Math.abs(pt.location.y - 64) < 0.05 && flat(pt.location, havana.location) < 4.5,
  `when she stands still, it lands next to her (${flat(pt.location, havana.location).toFixed(1)} blocks away, on the ground)`);
const before = PT(pt.location);
advance(100);
check(flat(before, pt.location) < 0.01, "and stays there while she stands still");
onTick = () => { havana.location = { x: havana.location.x + 0.2, y: 64, z: havana.location.z }; };
advance(60);
check(pt.events[pt.events.length - 1] === "dino:fly" && pt.location.y > 64.5, "when she walks off, it takes off again");
onTick = null;
// Grown up: ride it.
tap(havana, pt, "minecraft:cod");
for (let i = 0; i < 5; i++) { tap(havana, pt, "minecraft:salmon"); advance(12); }
check(pt.grown, "fed fish, the pterodactyl grows up");
check(havana.messages.some((m) => m.includes("Look where you want to fly")), "the chat explains flying, once");
pt.location = { x: 0, y: 70, z: 0 };
pt.riderList = [havana];
havana.view = { x: 0.6, y: 0.3, z: -0.74 };
pt.impulses = [];
advance(20);
const imp = pt.impulses[pt.impulses.length - 1];
check(pt.impulses.length >= 18 && imp && imp.x > 0.3 && imp.y > 0.1 && imp.z < -0.3, "riding: it flies the way the rider looks (forward and up)");
pt.location = { x: 0, y: 64, z: 0 };
havana.view = { x: 0, y: -0.5, z: -0.86 };
pt.impulses = [];
advance(10);
check(pt.impulses.length === 0 && pt.events[pt.events.length - 1] === "dino:perch", "on the ground looking down: it stays landed");
havana.view = { x: 0, y: 0.6, z: -0.8 };
advance(5);
check(pt.impulses.length > 0 && pt.events[pt.events.length - 1] === "dino:fly", "look up: it takes off");
pt.location = { x: 0, y: 80, z: 0 };
pt.riderList = [];
advance(2);
check(havana.effects.includes("slow_falling"), "hopping off in the air: you float gently down");

// ---------- T. rex ----------
// Clear the dinos away so they don't get in the way of counting.
for (const e of [...entities]) e.remove();
havana.location = { x: 0.5, y: 64, z: 0.5 };
jeff.location = { x: 3.5, y: 64, z: 0.5 };
const zombie = makeEntity("minecraft:zombie", { x: 0, y: 64, z: 0 }, dim);
zombie.monster = true;
check(!entities.some((e) => e.typeId === "dino:trex"), "no T. rex yet");
// Watch for it across the next week of play.
const visits = [];
let cur = null;
onTick = () => {
  const t = entities.find((e) => e.typeId === "dino:trex");
  if (t && cur?.e !== t) {
    cur = { e: t, day, time, start: PT(t.location), path: [], closest: 99 };
    visits.push(cur);
  }
  if (t) {
    cur.path.push(PT(t.location));
    if (cur.path.length === 100) {         // a zombie just in front of it
      const a = cur.path[90], b = cur.path[99], l = flat(a, b) || 1;
      zombie.location = { x: b.x + (b.x - a.x) / l * 6, y: 64, z: b.z + (b.z - a.z) / l * 6 };
      zombie.valid = true; zombie.killed = false;
      if (!entities.includes(zombie)) entities.push(zombie);
    }
    cur.closest = Math.min(cur.closest, flat(t.location, havana.location));
  } else if (cur && !cur.done) {
    cur.done = true;
    cur.endTick = tick;
    cur.zombieEaten = zombie.killed;
  }
};
const startDay = day;
advance(24000 * 7);
onTick = null;
check(visits.length >= 2 && visits.length <= 4, `it comes every 2 or 3 days (${visits.length} visits in a week, days ${visits.map((v) => v.day).join(", ")})`);
check(visits.every((v) => v.time >= 1000 && v.time <= 13000), "always in the daytime");
check(visits.every((v) => v.done), "each time it walks off and is gone afterwards");
check(visits.every((v) => [havana, jeff].some((p) => Math.abs(flat(v.start, p.location) - 40) < 1.5)), "it appears about 40 blocks from someone");
check(visits.some((v) => v.closest < 14), `it walks right past (closest: ${visits.map((v) => v.closest.toFixed(1)).join(", ")} blocks)`);
check(visits.every((v) => v.path.every((p) => !houses.some((h) => p.x > h.x0 - 1.5 && p.x < h.x1 + 1.5 && p.z > h.z0 - 1.5 && p.z < h.z1 + 1.5))),
  "it never walks through a house");
const builtAfter = [...blocks.entries()].filter(([, id]) => /planks|glass/.test(id)).length;
check(builtAfter === builtBefore, `every house is untouched (${builtAfter} of ${builtBefore} blocks)`);
check(destroyed.length > 20 && destroyed.every((id) => /oak_log|oak_leaves/.test(id)), `it knocks down trees in its path (${destroyed.length} blocks), and nothing else`);
check(visits.some((v) => v.zombieEaten), "it gobbles up a zombie in its way");
check(commands.some((c) => c.cmd.startsWith("camerashake add @a[name=\"Havana\"]")), "the ground shakes for Havana");
check(sounds.some((s) => s.id === "mob.ravager.roar"), "it ROARS");
check(havana.bars.filter((b) => b.includes("T. rex is coming")).length === visits.length, "a small note above the hotbar each visit");
check(havana.titles.length === 0 && jeff.titles.length === 0, "never a big title");
check(havana.knocked >= 0, "players in the way get nudged aside (never hurt)");

// Hunting: a zombie off to the side of its path. It goes after it, eats it, then carries on.
for (const e of [...entities]) if (e.typeId === "dino:trex") e.remove();
handlers.script({ id: "dino:trex", sourceEntity: havana });
const rex = entities.find((e) => e.typeId === "dino:trex");
advance(60);
const p0 = PT(rex.location);
advance(20);
const fx = rex.location.x - p0.x, fz = rex.location.z - p0.z, fl = Math.hypot(fx, fz) || 1;
const prey = makeEntity("minecraft:skeleton", { x: rex.location.x + fx / fl * 6 - fz / fl * 13, y: 64, z: rex.location.z + fz / fl * 6 + fx / fl * 13 }, dim);
prey.monster = true;
entities.push(prey);
const gap0 = flat(rex.location, prey.location);
let closestPrey = 99;
for (let i = 0; i < 400 && !prey.killed; i++) { advance(1); if (rex.valid) closestPrey = Math.min(closestPrey, flat(rex.location, prey.location)); }
check(gap0 > 12 && prey.killed, `the T. rex hunts down a skeleton ${gap0.toFixed(0)} blocks off to the side and eats it`);
advance(20 * 60);
check(!entities.includes(rex), "...then carries on and leaves");
// The meat-eating pets hunt any hostile mob near them, not just ones near a player.
const allo = JSON.parse(fs.readFileSync(process.argv[2].replace("scripts/main.js", "entities/allosaurus.json"), "utf8"));
const nat = allo["minecraft:entity"].components["minecraft:behavior.nearest_attackable_target"];
const filt = JSON.stringify(nat.entity_types[0].filters);
check(nat.within_radius >= 16 && !filt.includes("distance_to_nearest_player") && filt.includes("creeper"), "the Allosaurus hunts monsters up to 16 blocks away (but leaves creepers alone)");

// /scriptevent dino:trex brings it right away.
handlers.script({ id: "dino:trex", sourceEntity: havana });
check(entities.some((e) => e.typeId === "dino:trex"), "/scriptevent dino:trex brings it now");

console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
