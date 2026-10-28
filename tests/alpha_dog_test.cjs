// Runs the Alpha Dog script against a small fake Minecraft world and checks the story:
// join -> egg + bones -> set egg down -> puppy hatches, already Havana's, with a name -> pet it ->
// treats grow it Puppy -> Small -> Big -> Alpha (waits for room) -> ride (owner only) -> menu ->
// wanders off and comes back with a present -> runs back when far / through a portal / when she's
// in danger -> stays when tied with a lead -> goodbye.
// Usage: node tests/alpha_dog_test.cjs addons/AlphaDog_BP/scripts/main.js
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8").replace(/^import .*$/gm, "") +
  "\nglobalThis.__dog = { exploreUntil, nextRoll, GROW_AT, nextChew, nextBow };";

// Repeatable "random" numbers.
let seed = 12345;
Math.random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

let tick = 0, clockSkip = 0, timeOfDay = 1000;
const handlers = {};
const subs = {};
const sub = (name) => ({ subscribe: (fn) => { (subs[name] ||= []).push(fn); handlers[name] = (ev) => subs[name].forEach((f) => f(ev)); } });
const timers = [];
let nextId = 1;
const system = {
  get currentTick() { return tick; },
  runInterval: (fn, n) => { const id = nextId++; timers.push({ id, fn, every: n || 1, at: tick + (n || 1) }); return id; },
  runTimeout: (fn, n) => { const id = nextId++; timers.push({ id, fn, once: true, at: tick + (n || 1) }); return id; },
  run: (fn) => system.runTimeout(fn, 1),
  clearRun: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
};
class BlockPermutation {
  constructor(id, states) { this.type = { id }; this.states = states || {}; }
  static resolve(id, states) { if (!id.includes(":")) throw new Error("bad"); return new BlockPermutation(id, states); }
}
class ItemStack { constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; } }
const answers = []; const forms = [];
class ActionFormData {
  constructor() { this.buttons = []; }
  title(t) { this.t = t; return this; }
  body(b) { this.b = b; return this; }
  button(l) { this.buttons.push(l); return this; }
  show() { forms.push(this); const a = answers.shift(); return Promise.resolve(a === undefined ? { canceled: true } : { canceled: false, selection: a }); }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

const particles = [], sounds = [], dropped = [];
function makeDim(id) {
  const blocks = new Map();
  const K = (l) => `${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)}`;
  const dim = {
    id: `minecraft:${id}`, blocks, entities: [],
    setBlock(l, typeId, states = {}) { blocks.set(K(l), { id: typeId, states }); },
    getBlock(l) {
      const b = blocks.get(K(l));
      const typeId = b?.id ?? (l.y < 64 ? "minecraft:grass_block" : "minecraft:air");
      const states = b?.states ?? {};
      return {
        typeId, dimension: dim, location: { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) },
        permutation: { getAllStates: () => ({ ...states }) },
        setPermutation: (p) => blocks.set(K(l), { id: p.type.id, states: p.states }),
      };
    },
    spawnEntity(type, loc) {
      if (!type.includes(":")) throw new Error("bad");
      const props = new Map();
      const e = {
        typeId: type, id: String(nextId++), location: { ...loc }, dimension: dim, events: [], nameTag: "", valid: true,
        families: type === "minecraft:zombie" ? ["monster", "zombie"] : [],
        tamedTo: null, riders: [], leashed: false, vel: { x: 0, y: 0, z: 0 }, isOnGround: true,
        getVelocity() { return { ...this.vel }; },
        applyImpulse(v) { this.vel.x += v.x; this.vel.y += v.y; this.vel.z += v.z; },
        setRotation(r) { this.rot = r; },
        isValid() { return this.valid; },
        getDynamicProperty: (k) => props.get(k),
        setDynamicProperty: (k, v) => (v === undefined ? props.delete(k) : props.set(k, v)),
        fx: [],   // look-only events (head tilt, greeting wiggle), kept apart from the behavior events
        triggerEvent(ev) { (/tilt_|greet_/.test(ev) ? this.fx : this.events).push(ev); },
        getComponent(name) {
          if (name === "minecraft:tameable") return { get isTamed() { return !!e.tamedTo; }, tame: (p) => { e.tamedTo = p.name; return true; } };
          if (name === "minecraft:rideable") return { getRiders: () => e.riders };
          if (name === "minecraft:leashable") return { get isLeashed() { return e.leashed; } };
          return undefined;
        },
        teleport(p, opts = {}) {
          this.location = { ...p };
          if (opts.dimension && opts.dimension !== this.dimension) {
            this.dimension.entities.splice(this.dimension.entities.indexOf(this), 1);
            opts.dimension.entities.push(this);
            this.dimension = opts.dimension;
          }
        },
        remove() { this.valid = false; this.dimension.entities.splice(this.dimension.entities.indexOf(this), 1); },
      };
      dim.entities.push(e);
      return e;
    },
    getEntities(q = {}) {
      return dim.entities.filter((e) => (!q.type || e.typeId === q.type) &&
        (!q.families || q.families.some((fam) => (e.families || []).includes(fam))) &&
        (!q.location || Math.hypot(e.location.x - q.location.x, e.location.y - q.location.y, e.location.z - q.location.z) <= q.maxDistance));
    },
    spawnParticle(id, loc) { particles.push({ id, loc }); },
    spawnItem(item, loc) { dropped.push({ id: item.typeId, loc }); },
    playSound(id) { sounds.push(id); },
  };
  return dim;
}
const dims = { overworld: makeDim("overworld"), nether: makeDim("nether"), the_end: makeDim("the_end") };

const players = [];
function makePlayer(name, x) {
  const inv = [];
  const props = new Map();
  const p = {
    name, typeId: "minecraft:player", location: { x, y: 64, z: 0 }, dimension: dims.overworld, messages: [], titles: [], actionbar: [], inv,
    mode: "survival", selectedSlotIndex: 0, isSneaking: false, lookAt: null,
    sendMessage(m) { this.messages.push(m); },
    playSound() {},
    getGameMode() { return this.mode; },
    getDynamicProperty: (k) => props.get(k), setDynamicProperty: (k, v) => props.set(k, v),
    getComponent: () => ({
      container: {
        addItem: (it) => { inv.push(it); },
        getItem: (i) => inv[i],
        setItem: (i, it) => { if (it) inv[i] = it; else inv.splice(i, 1); },
      },
    }),
    view: { x: 0, y: 0.98, z: 0.2 }, valid: true,
    isValid() { return this.valid; },
    getViewDirection() { return { ...this.view }; },
    getBlockFromViewDirection() { return this.lookAt ? { block: this.dimension.getBlock(this.lookAt) } : undefined; },
  };
  p.onScreenDisplay = { setTitle: (t, o) => p.titles.push(t + " / " + (o?.subtitle ?? "")), setActionBar: (m) => p.actionbar.push(m) };
  players.push(p);
  return p;
}
const havana = makePlayer("Havana", 0), jeff = makePlayer("Jeff", 3);
const world = {
  getTimeOfDay: () => timeOfDay, getAbsoluteTime: () => tick + clockSkip, getAllPlayers: () => players, getDimension: (d) => dims[d.replace("minecraft:", "")],
  afterEvents: { playerSpawn: sub("spawn"), itemUse: sub("use"), entityHurt: sub("hurt") },
  beforeEvents: { playerInteractWithEntity: sub("interact") },
};
new Function("world", "system", "ItemStack", "ActionFormData", "BlockPermutation", src)(world, system, ItemStack, ActionFormData, BlockPermutation);

function advance(n) {
  for (let i = 0; i < n; i++) {
    tick++;
    // Simple physics: velocity moves things, ground friction slows them down.
    for (const d of Object.values(dims)) for (const e of d.entities) {
      if (!e.vel || (!e.vel.x && !e.vel.z && !e.vel.y)) continue;
      e.location = { x: e.location.x + e.vel.x, y: e.location.y, z: e.location.z + e.vel.z };
      e.hops = (e.hops || 0) + (e.vel.y > 0 ? 1 : 0);
      e.vel = { x: e.vel.x * 0.546, y: 0, z: e.vel.z * 0.546 };
      if (Math.abs(e.vel.x) < 1e-4 && Math.abs(e.vel.z) < 1e-4) e.vel = { x: 0, y: 0, z: 0 };
    }
    for (const t of [...timers]) {
      if (t.at <= tick) {
        if (t.once) timers.splice(timers.indexOf(t), 1); else t.at = tick + t.every;
        t.fn();
      }
    }
  }
}
// The fake world has no mob AI, so this stands in for follow_owner: a dog that's just hanging around
// and has drifted off (say, at the end of its zoomies) walks back next to its owner.
const walkBack = (d, owner, spot) => {
  if ((d.getDynamicProperty("alphadog:mode") ?? "follow") !== "follow" || d.getDynamicProperty("alphadog:sitting")) return;
  const to = spot ?? { x: owner.location.x + 1.5, y: owner.location.y, z: owner.location.z };
  if (Math.hypot(d.location.x - to.x, d.location.z - to.z) > (spot ? 0.3 : 3)) { d.location = { ...to }; d.vel = { x: 0, y: 0, z: 0 }; }
};
let failures = 0;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failures++; };
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const tap = (player, target, item, sneaking = false) => {
  player.isSneaking = sneaking;
  const ev = { player, target, itemStack: item ? new ItemStack(item) : undefined, cancel: false };
  handlers.interact(ev);
  advance(2);
  player.isSneaking = false;
  return ev;
};
// Holding a stack in the selected slot (slot 0).
const hold = (player, id, n) => { player.inv.unshift(new ItemStack(id, n)); };
const count = (player, id) => player.inv.filter((i) => i.typeId === id).reduce((s, i) => s + i.amount, 0);

(async () => {
// Join: an egg and some bones, only once.
for (const p of players) handlers.spawn({ player: p, initialSpawn: true });
advance(130);
check(count(havana, "alphadog:dog_egg") === 1 && count(havana, "minecraft:bone") === 6, "Havana gets an Alpha Dog Egg and 6 bones on first join");
handlers.spawn({ player: havana, initialSpawn: true }); advance(130);
check(havana.inv.length === 2, "starter kit only given once");

// Looking at the sky: nothing. Looking at the ground: egg goes down.
handlers.use({ source: havana, itemStack: new ItemStack("alphadog:dog_egg") });
check(!dims.overworld.getEntities({ type: "alphadog:egg" }).length && havana.messages.at(-1).includes("Look at the ground"), "no egg without aiming at the ground");
havana.lookAt = { x: 3, y: 63, z: 2 };
havana.selectedSlotIndex = havana.inv.findIndex((i) => i.typeId === "alphadog:dog_egg");
advance(20);
handlers.use({ source: havana, itemStack: new ItemStack("alphadog:dog_egg") });
havana.selectedSlotIndex = 0;
const eggs = dims.overworld.getEntities({ type: "alphadog:egg" });
check(eggs.length === 1 && eggs[0].location.y === 64 && eggs[0].location.x === 3.5, "egg sits on top of the grass");
check(count(havana, "alphadog:dog_egg") === 0, "egg used up in survival");
advance(150);
check(dims.overworld.getEntities({ type: "alphadog:egg" }).length === 1, "egg still wiggling after 7 seconds");
check(sounds.includes("block.turtle_egg.crack"), "egg makes cracking sounds");
advance(60);
const [dog] = dims.overworld.getEntities({ type: "alphadog:dog" });
check(!dims.overworld.getEntities({ type: "alphadog:egg" }).length && !!dog, "egg hatched into a puppy after about 10 seconds");
check(dog.events.includes("alphadog:stage_0") && dog.getDynamicProperty("alphadog:stage") === 0, "it starts as a puppy");
check(dog.tamedTo === "Havana" && dog.getDynamicProperty("alphadog:owner") === "Havana", "puppy is tamed and bonded to Havana right away");
check(dog.nameTag.length > 0, `puppy has a random name: ${dog.nameTag}`);
check(havana.actionbar.some((m) => m.includes("Meet") && m.includes(dog.nameTag)) && havana.messages.some((m) => m.includes(dog.nameTag)), "Havana is told the puppy's name");
check(!havana.titles.some((t) => t.includes("hatched")), "no big title covering the screen when the puppy hatches");
const name = dog.nameTag;

// Petting.
let ev = tap(havana, dog);
check(ev.cancel && particles.some((p) => p.id === "minecraft:heart_particle") && havana.actionbar.at(-1).includes("to Small Dog"), "petting shows hearts and how close it is to growing");

// Someone else's dog: polite, no treats, no riding.
ev = tap(jeff, dog);
check(ev.cancel && jeff.messages.at(-1).includes("Havana's dog"), "Jeff tapping it is told it's Havana's dog");
hold(jeff, "minecraft:bone", 3);
const jeffBones = count(jeff, "minecraft:bone");
advance(15);
ev = tap(jeff, dog, "minecraft:bone");
check(ev.cancel && (dog.getDynamicProperty("alphadog:food") || 0) === 0 && count(jeff, "minecraft:bone") === jeffBones &&
  jeff.messages.at(-1).includes("only takes treats from Havana"), "it won't take treats from Jeff");

// Treats: 5 bones -> Small Dog.
for (let i = 0; i < 5; i++) {
  havana.selectedSlotIndex = havana.inv.findIndex((it) => it.typeId === "minecraft:bone");
  ev = tap(havana, dog, "minecraft:bone");
  advance(15);
}
havana.selectedSlotIndex = 0;
check(ev.cancel && count(havana, "minecraft:bone") === 1, "bones are eaten one at a time");
check(dog.events.includes("alphadog:stage_1") && dog.getDynamicProperty("alphadog:stage") === 1, "5 bones: grows into a Small Dog");
check(havana.actionbar.some((m) => m.includes("grew") && m.includes("Small Dog")) && havana.messages.some((m) => m.includes("Small Dog")), "Havana sees it grow");
// Fast tapping doesn't eat a whole stack at once.
hold(havana, "minecraft:cooked_beef", 20);
tap(havana, dog, "minecraft:cooked_beef"); tap(havana, dog, "minecraft:cooked_beef");
check(count(havana, "minecraft:cooked_beef") === 19, "one treat per bite, even when tapping fast");
advance(15);
for (let i = 0; i < 4; i++) { tap(havana, dog, "minecraft:cooked_beef"); advance(15); }
check(dog.getDynamicProperty("alphadog:food") === 15 && dog.getDynamicProperty("alphadog:stage") === 2, "cooked meat counts double: 5 steaks later it's a Big Dog");

// Indoors: not enough room to become an Alpha Dog.
const fl = { x: Math.floor(dog.location.x), y: Math.floor(dog.location.y), z: Math.floor(dog.location.z) };
for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) dims.overworld.setBlock({ x: fl.x + dx, y: fl.y + 2, z: fl.z + dz }, "minecraft:oak_planks");
for (let i = 0; i < 8; i++) { tap(havana, dog, "minecraft:cooked_beef"); advance(15); }
check(dog.getDynamicProperty("alphadog:stage") === 2 && havana.messages.some((m) => m.includes("somewhere outside")), "with a ceiling overhead it waits to grow into an Alpha Dog");
dims.overworld.blocks.clear();
tap(havana, dog, "minecraft:chicken"); advance(15);
check(dog.events.includes("alphadog:stage_3") && dog.getDynamicProperty("alphadog:stage") === 3, "outside, one more treat: ALPHA DOG");
check(havana.actionbar.some((m) => m.includes("ALPHA DOG") && m.includes("ride")) && havana.messages.some((m) => m.includes("ride")), "Havana is told she can ride it");
check(havana.titles.length === 0, "no big titles over the screen when hatching or growing");

// Riding: Havana's empty-hand tap is left for Minecraft (rides); Jeff's is blocked.
ev = tap(havana, dog);
check(!ev.cancel, "Havana's empty-hand tap on the Alpha Dog lets her ride");
ev = tap(jeff, dog);
check(ev.cancel && jeff.messages.at(-1).includes("Only Havana can ride"), "Jeff can't ride Havana's Alpha Dog");
ev = tap(havana, dog, "minecraft:name_tag");
check(!ev.cancel, "name tags are left to Minecraft (rename at an anvil, then tap)");
dog.nameTag = "Graham";
ev = tap(havana, dog, "minecraft:bone");
check(havana.actionbar.at(-1).includes("Graham") && havana.actionbar.at(-1).includes("biggest"), "after renaming, messages use the new name");
advance(15);

// The menu: crouch + tap.
answers.push(2);
tap(havana, dog, undefined, true); await flush(); advance(2);
const menu = forms.at(-1);
check(menu.buttons.length === 5 && menu.buttons[1] === "Sit and stay" && menu.buttons[2] === "Stay close to me" && menu.buttons[3] === "No more mischief" && menu.b.includes("Alpha Dog"), "crouch+tap opens the menu");
advance(140);   // (if it had the zoomies, it switches when they end)
const lastMode = () => dog.events.filter((e) => e.startsWith("alphadog:mode_")).at(-1);
check(dog.getDynamicProperty("alphadog:roam") === "close" && lastMode() === "alphadog:mode_close", "\"Stay close to me\" keeps it near");
advance(15);
answers.push(2);
tap(havana, dog, undefined, true); await flush(); advance(2);
advance(140);
check(forms.at(-1).buttons[2] === "You can go explore" && lastMode() === "alphadog:mode_free", "and \"You can go explore\" lets it roam again");

// A bit aloof: it wanders off now and then, comes back, and sometimes brings a present.
havana.location = { x: dog.location.x + 1.5, y: 64, z: dog.location.z };   // sitting with the dog
havana.selectedSlotIndex = 99;   // empty hand: no treat out
let explores = 0, gifts = 0, wasExploring = false;
for (let i = 0; i < 72000; i += 10) {
  advance(10);
  walkBack(dog, havana);
  const now = dog.getDynamicProperty("alphadog:mode") === "explore";
  if (now && !wasExploring) explores++;
  wasExploring = now;
}
gifts = dropped.length;
check(explores >= 2 && explores <= 20, `over an hour it wandered off on its own ${explores} times (now and then, not constantly)`);
check(dog.getDynamicProperty("alphadog:mode") !== "explore" || wasExploring, "and came back from each walk");
check(gifts >= 1 && havana.messages.some((m) => m.includes("brought you")), `it brought back ${gifts} present(s): ${dropped.map((d) => d.id.replace("minecraft:", "")).join(", ")}`);
check(dog.events.filter((e) => e === "alphadog:go_explore").length === explores, "exploring uses the explore behavior");

// Monster near Havana while it's exploring: it stops exploring.
const until = (dog.getDynamicProperty("alphadog:mode") === "explore");
if (!until) { dog.setDynamicProperty("alphadog:mode", "explore"); globalThis.__dog.exploreUntil.set(dog.id, tick + 5000); }
const zombie = dims.overworld.spawnEntity("minecraft:zombie", { x: havana.location.x + 5, y: 64, z: havana.location.z });
advance(12);
check(dog.getDynamicProperty("alphadog:mode") === "follow", "a monster near Havana calls it back from exploring");
zombie.remove();

// Monster near the dog (not near Havana) while it's exploring: it comes back instead of fighting in a cave.
dog.setDynamicProperty("alphadog:mode", "explore"); globalThis.__dog.exploreUntil.set(dog.id, tick + 5000);
const caveSkel = dims.overworld.spawnEntity("minecraft:zombie", { x: dog.location.x + 4, y: 64, z: dog.location.z });
caveSkel.location = { x: dog.location.x + 4, y: 64, z: dog.location.z };
havana.location = { x: dog.location.x - 13, y: 64, z: dog.location.z };
advance(12);
check(dog.getDynamicProperty("alphadog:mode") === "follow", "monsters near an exploring dog send it back to Havana");
caveSkel.remove();

// Food motivated: holding a treat calls it back from exploring, and it never wanders off while you hold one.
havana.location = { x: dog.location.x + 1.5, y: 64, z: dog.location.z };
dog.setDynamicProperty("alphadog:mode", "explore"); globalThis.__dog.exploreUntil.set(dog.id, tick + 5000);
hold(havana, "minecraft:cooked_chicken", 3); havana.selectedSlotIndex = 0;
advance(12);
check(dog.getDynamicProperty("alphadog:mode") === "follow", "holding a treat calls it back from exploring");
check(havana.actionbar.some((m) => m.includes("smells the treat")), "and it perks up: \"smells the treat!\"");
const goesBefore = dog.events.filter((e) => e === "alphadog:go_explore").length;
advance(20000);
check(dog.events.filter((e) => e === "alphadog:go_explore").length === goesBefore, "it never wanders off while Havana holds a treat");
havana.inv.shift();

// Too far away: comes running.
havana.location = { x: 60, y: 64, z: 0 };
advance(12);
check(d2(dog.location, havana.location) < 3 && havana.actionbar.some((m) => m.includes("came running back")), "when she's far away it comes running back");

// Through a portal.
havana.dimension = dims.nether; havana.location = { x: 8, y: 40, z: 8 };
advance(12);
check(dog.dimension === dims.nether && d2(dog.location, havana.location) < 3, "it follows her to the Nether");
havana.dimension = dims.overworld; havana.location = { x: 0, y: 64, z: 0 };
advance(12);
check(dog.dimension === dims.overworld, "and back home");

// Tied to a fence with a lead: it waits.
dog.leashed = true;
havana.location = { x: 80, y: 64, z: 0 };
advance(30);
check(d2(dog.location, havana.location) > 60, "on a lead tied to a fence, it waits instead of teleporting");
dog.leashed = false;
// Being ridden: it goes where she steers.
dog.riders = [havana];
havana.location = { x: 200, y: 64, z: 0 };
advance(30);
check(d2(dog.location, havana.location) > 60, "while ridden, it isn't teleported around");
dog.riders = [];
advance(12);

// Havana gets hurt while it's off exploring far away: it comes to help.
dog.setDynamicProperty("alphadog:mode", "explore"); globalThis.__dog.exploreUntil.set(dog.id, tick + 5000);
dog.location = { x: havana.location.x + 20, y: 64, z: 0 };
const skel = dims.overworld.spawnEntity("minecraft:skeleton", { x: havana.location.x + 30, y: 64, z: 0 });
handlers.hurt({ hurtEntity: havana, damageSource: { damagingEntity: skel } });
check(dog.getDynamicProperty("alphadog:mode") === "follow" && d2(dog.location, havana.location) < 3, "when Havana gets hurt, it comes running to help");

// Jeff's egg in creative isn't used up, and his puppy is his.
jeff.mode = "creative"; jeff.lookAt = { x: 6, y: 63, z: 4 }; jeff.inv.length = 0; jeff.inv.push(new ItemStack("alphadog:dog_egg"));
handlers.use({ source: jeff, itemStack: new ItemStack("alphadog:dog_egg") });
advance(220);
const jdog = dims.overworld.getEntities({ type: "alphadog:dog" }).find((d) => d !== dog);
check(count(jeff, "alphadog:dog_egg") === 1 && jdog?.tamedTo === "Jeff", "creative egg not used up; Jeff's puppy is bonded to Jeff");

// ---------- Mischief ----------
// Jeff and his puppy go play somewhere else for this part.
jeff.location = { x: -200, y: 64, z: 0 };
for (const d of dims.overworld.getEntities({ type: "alphadog:dog" })) if (d !== dog) { d.location = { x: -199, y: 64, z: 1 }; d.vel = { x: 0, y: 0, z: 0 }; }
havana.location = { x: 0, y: 64, z: 0 };
dog.location = { x: 1.5, y: 64, z: 0.5 };
dog.setDynamicProperty("alphadog:mode", "follow");
havana.selectedSlotIndex = 99;
const ow = dims.overworld;
const tree = (x, z) => {
  for (let y = 64; y <= 68; y++) ow.setBlock({ x, y, z }, "minecraft:oak_log", { pillar_axis: "y" });
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = 67; y <= 69; y++)
    if (dx || dz) ow.setBlock({ x: x + dx, y, z: z + dz }, "minecraft:oak_leaves");
};
const logAt = (x, y, z) => ow.getBlock({ x, y, z }).typeId;
const chewed = () => [64, 65].some((y) => logAt(3, y, 0) === "minecraft:stripped_oak_log");
const runUntil = (cond, max) => { for (let i = 0; i < max && !cond(); i += 10) { advance(10); walkBack(dog, havana, { x: 1.5, y: 64, z: 0.5 }); } };
tree(3, 0);
const sticksBefore = dropped.filter((d) => d.id === "minecraft:stick").length;
runUntil(chewed, 30000);
check(chewed() && dog.events.includes("alphadog:chew"), "the dog chews on a tree it's standing next to");
const strippedY = [64, 65].find((y) => logAt(3, y, 0) === "minecraft:stripped_oak_log");
check(ow.getBlock({ x: 3, y: strippedY, z: 0 }).permutation.getAllStates().pillar_axis === "y", "the chewed log keeps its direction (tree still standing)");
check(sounds.includes("dig.wood") && particles.some((p) => p.id === "alphadog:wood_chip"), "gnawing sounds and wood chips while chewing");
advance(10);
check(dropped.filter((d) => d.id === "minecraft:stick").length > sticksBefore, "chewing drops sticks");
check([64, 65, 66, 67, 68].filter((y) => logAt(3, y, 0) === "minecraft:stripped_oak_log").length === 1, "only one bite per tree");
check(dog.getDynamicProperty("alphadog:mode") === "follow", "and then it goes back to normal");

// Somebody's build: a tree with a torch nearby is off limits.
ow.blocks.clear(); tree(3, 0);
ow.setBlock({ x: 5, y: 64, z: 2 }, "minecraft:torch");
globalThis.__dog.nextChew?.clear?.();
runUntil(chewed, 30000);
check(!chewed(), "it leaves trees alone when there's a torch (or anything built) nearby");
const logsHouse = () => ow.getBlock({ x: 3, y: 64, z: 0 }).typeId;
ow.blocks.clear();
for (let y = 64; y <= 66; y++) { ow.setBlock({ x: 3, y, z: 0 }, "minecraft:oak_log", { pillar_axis: "y" }); ow.setBlock({ x: 3, y, z: 1 }, "minecraft:oak_planks"); }
runUntil(() => logsHouse() !== "minecraft:oak_log", 20000);
check(logsHouse() === "minecraft:oak_log", "it never chews logs in a house (no leaves, planks next to it)");

// Mischief off: no chewing.
ow.blocks.clear(); tree(3, 0);
answers.push(3);
tap(havana, dog, undefined, true); await flush(); advance(2);
check(dog.getDynamicProperty("alphadog:mischief") === "off" && havana.messages.at(-1).includes("extra good"), "\"No more mischief\" in the menu");
runUntil(chewed, 30000);
check(!chewed(), "with mischief off it doesn't chew trees");
const zBefore = dog.events.filter((e) => e === "alphadog:zoomies").length;
advance(15);
answers.push(3);
tap(havana, dog, undefined, true); await flush(); advance(2);
check(dog.getDynamicProperty("alphadog:mischief") === "on" && forms.at(-1).buttons[3] === "Mischief is OK", "\"Mischief is OK\" turns it back on");
ow.blocks.clear();

// Zoomies: puppies get them a lot, the Alpha now and then. A puppy and the Alpha hang out with Havana for two hours.
havana.inv.unshift(new ItemStack("alphadog:dog_egg")); havana.selectedSlotIndex = 0; havana.lookAt = { x: -3, y: 63, z: 2 };
handlers.use({ source: havana, itemStack: new ItemStack("alphadog:dog_egg") });
havana.selectedSlotIndex = 99;
advance(220);
const zpup = dims.overworld.getEntities({ type: "alphadog:dog" }).find((d) => d !== dog && d.tamedTo === "Havana");
const zCount = { pup: [], alpha: [] }, wasZ = { pup: false, alpha: false };
const run = { pup: { dist: 0, far: 0, ticks: 0, front: 0 }, alpha: { dist: 0, far: 0, ticks: 0, front: 0 } }, lastPos = {};
for (let i = 0; i < 144000; i++) {   // two hours
  if (i % 6000 === 0) {   // Havana turns to look a new way every 5 minutes
    const a = (i / 6000) * 1.9;
    havana.view = { x: Math.sin(a) * 0.2, y: 0.98, z: Math.cos(a) * 0.2 };
  }
  advance(1);
  if (i % 10 === 0) { walkBack(zpup, havana); walkBack(dog, havana); }
  for (const [k, d] of [["pup", zpup], ["alpha", dog]]) {
    const z = d.getDynamicProperty("alphadog:mode") === "zoomies";
    if (z && !wasZ[k]) { zCount[k].push(tick); lastPos[k] = { ...d.location }; }
    if (z) {
      run[k].dist += d2(d.location, lastPos[k]);
      run[k].far = Math.max(run[k].far, d2(d.location, havana.location));
      lastPos[k] = { ...d.location };
      const dx = d.location.x - havana.location.x, dz = d.location.z - havana.location.z;
      run[k].ticks++;
      // In front: within about 50 degrees of where she's looking.
      const hv = Math.hypot(havana.view.x, havana.view.z);
      if ((dx * havana.view.x + dz * havana.view.z) / hv > Math.hypot(dx, dz) * 0.64) run[k].front++;
    }
    wasZ[k] = z;
  }
}
const gapsOf = (list) => list.slice(1).map((t2, i) => t2 - list[i]);
check(zCount.pup.length >= 20, `the puppy got the zoomies ${zCount.pup.length} times in two hours`);
check(zCount.alpha.length >= 1 && zCount.alpha.length <= 12, `the Alpha got the zoomies ${zCount.alpha.length} times in those two hours`);
check(zCount.pup.length >= zCount.alpha.length * 3, "puppies get the zoomies way more than the Alpha");
check(gapsOf(zCount.pup).every((g) => g >= 1200) && gapsOf(zCount.alpha).every((g) => g >= 7200), "at least 1 minute apart for puppies, 6 minutes for the Alpha");
check(particles.some((p) => p.id === "alphadog:dirt_kick") && havana.actionbar.some((m) => m.includes("ZOOMIES")), "zoomies kick up dirt and Havana sees \"ZOOMIES!\"");
const perRun = (k) => run[k].dist / zCount[k].length;
check(perRun("pup") > 20 && perRun("alpha") > 30, `they really run: about ${perRun("pup").toFixed(0)} blocks per zoomies for the puppy, ${perRun("alpha").toFixed(0)} for the Alpha`);
check(run.pup.far < 8 && run.alpha.far < 15, `never too far from Havana (${run.pup.far.toFixed(1)} / ${run.alpha.far.toFixed(1)} blocks at most)`);
const frontPct = (k) => (100 * run[k].front) / run[k].ticks;
check(frontPct("pup") > 85 && frontPct("alpha") > 85, `the zoomies happen in front of Havana where she can watch (${frontPct("pup").toFixed(0)}% / ${frontPct("alpha").toFixed(0)}% of the time; the rest is running around to get there)`);
check(d2(zpup.location, havana.location) < 12 && zpup.vel.x === 0 && zpup.vel.z === 0, "and stop when the zoomies are over");
check(dog.getDynamicProperty("alphadog:mode") !== "zoomies" || wasZ.alpha, "zoomies end on their own");
{
  const path = require("path");
  const ent = JSON.parse(fs.readFileSync(path.join(path.dirname(process.argv[2]), "..", "entities", "alpha_dog.json"), "utf8"))["minecraft:entity"];
  const groups = ent.component_groups;
  check(!ent.components["minecraft:behavior.tempt"] && !groups["alphadog:zoomies"]["minecraft:behavior.tempt"] &&
    !groups["alphadog:chewing"]["minecraft:behavior.tempt"] && !groups["alphadog:sitting"]["minecraft:behavior.tempt"] &&
    ["alphadog:roam_free", "alphadog:roam_close", "alphadog:explore"].every((g) => groups[g]["minecraft:behavior.tempt"]),
    "holding food doesn't freeze the zoomies (treat-following is only on while hanging around or exploring)");
}
zpup.remove();
// Never while she's riding.
dog.riders = [havana];
const zRide = dog.events.filter((e) => e === "alphadog:zoomies").length;
advance(30000);
check(dog.events.filter((e) => e === "alphadog:zoomies").length === zRide, "no zoomies while she's riding");
dog.riders = [];
advance(12);

// ---------- Sit and stay ----------
havana.location = { x: 0, y: 64, z: 0 }; havana.dimension = dims.overworld;
dog.location = { x: 2, y: 64, z: 0 };
advance(140);   // let any zoomies finish
answers.push(1);
tap(havana, dog, undefined, true); await flush(); advance(2);
check(dog.getDynamicProperty("alphadog:sitting") === true && dog.events.at(-1) === "alphadog:sit" && havana.messages.at(-1).includes("sits and stays"), "\"Sit and stay\" sits the dog down");
const sitSpot = { ...dog.location };
havana.location = { x: 70, y: 64, z: 0 };
advance(60);
check(d2(dog.location, sitSpot) < 0.01, "a sitting dog stays put when Havana walks far away");
havana.dimension = dims.nether; advance(30);
check(dog.dimension === dims.overworld, "and when she goes through a portal");
havana.dimension = dims.overworld; havana.location = { x: 3, y: 64, z: 0 };
const evCount = dog.events.length;
advance(40000);
check(!dog.events.slice(evCount).some((e) => ["alphadog:zoomies", "alphadog:go_explore", "alphadog:chew", "alphadog:mode_free", "alphadog:mode_close"].includes(e)),
  "no wandering, zoomies, or chewing while sitting");
hold(havana, "minecraft:cooked_beef", 5); havana.selectedSlotIndex = 0;
for (let i = 0; i < 4; i++) { tap(havana, dog, "minecraft:cooked_beef"); advance(12); }
havana.inv.shift(); havana.selectedSlotIndex = 99;
check(dog.getDynamicProperty("alphadog:sitting") === true && !dog.events.slice(evCount).includes("alphadog:zoomies"), "treats don't break the sit");
answers.push(1);
tap(havana, dog, undefined, true); await flush(); advance(2);
check(forms.at(-1).buttons[1] === "Come on, let's go!" && dog.getDynamicProperty("alphadog:sitting") === false, "\"Come on, let's go!\" gets the dog up");
check(dog.events.slice(-3).includes("alphadog:mode_free") && dog.events.at(-1) === "alphadog:stage_3", "and it can walk again");
// Climbing onto a sitting Alpha: it stands up so you can ride.
answers.push(1);
advance(15); tap(havana, dog, undefined, true); await flush(); advance(2);
dog.riders = [havana]; advance(12);
check(dog.getDynamicProperty("alphadog:sitting") === false, "riding a sitting Alpha makes it stand up");
dog.riders = []; advance(12);

const hatchFor = (player, at) => {
  player.inv.unshift(new ItemStack("alphadog:dog_egg")); player.selectedSlotIndex = 0; player.lookAt = at;
  const before = new Set(dims.overworld.getEntities({ type: "alphadog:dog" }));
  handlers.use({ source: player, itemStack: new ItemStack("alphadog:dog_egg") });
  advance(220);
  return dims.overworld.getEntities({ type: "alphadog:dog" }).find((d) => !before.has(d));
};
// ---------- Head tilt ----------
// (Havana stares at the dog a lot in this part; no play bows here, those get their own checks below.)
globalThis.__dog.nextBow.set(dog.id, Infinity);
const faceDog = (p, d) => {   // turn to look at the dog
  const dx = d.location.x - p.location.x, dy = d.location.y + 1.6 - (p.location.y + 1.6), dz = d.location.z - p.location.z;
  const l = Math.hypot(dx, dy, dz); p.view = { x: dx / l, y: dy / l, z: dz / l };
};
const crouch = (p) => { p.isSneaking = true; advance(4); p.isSneaking = false; advance(2); };
havana.location = { x: 0, y: 64, z: 0 }; dog.location = { x: 4, y: 64, z: 0 };
advance(200);   // let anything going on finish
walkBack(dog, havana, { x: 4, y: 64, z: 0 });
faceDog(havana, dog);
const tilts = () => dog.fx.filter((e) => e === "alphadog:tilt_left" || e === "alphadog:tilt_right");
const t0 = tilts().length;
crouch(havana);
check(tilts().length === t0 + 1, `crouching while looking at the dog makes it tilt its head (${tilts().at(-1)})`);
advance(40);
check(dog.fx.at(-1) === "alphadog:tilt_end", "and it straightens up again after a moment");
crouch(havana);
check(tilts().length === t0 + 2 && tilts().at(-1) !== tilts().at(-2), "crouch again: it tilts the other way");
advance(40);
havana.view = { x: -1, y: 0, z: 0 };   // looking away
crouch(havana);
check(tilts().length === t0 + 2, "no tilt when she isn't looking at the dog");
havana.isSneaking = true; advance(60);
check(tilts().length === t0 + 2, "staying crouched doesn't keep re-tilting (only the moment you crouch)");
havana.isSneaking = false; advance(2);
dog.location = { x: 30, y: 64, z: 0 }; faceDog(havana, dog);
crouch(havana);
check(tilts().length === t0 + 2, "no tilt from far away");
dog.location = { x: 4, y: 64, z: 0 }; faceDog(jeff, dog);
jeff.location = { x: 0, y: 64, z: 3 }; jeff.dimension = dims.overworld; faceDog(jeff, dog);
crouch(jeff);
check(tilts().length === t0 + 3, "it tilts its head for anybody, not just Havana");
jeff.location = { x: -200, y: 64, z: 0 };
advance(40);

// ---------- Happy greeting ----------
const greets = () => dog.fx.filter((e) => e === "alphadog:greet_start").length;
answers.push(1);
advance(15); tap(havana, dog, undefined, true); await flush(); advance(2);
check(dog.getDynamicProperty("alphadog:sitting") === true, "(dog sits and stays)");
const g0 = greets();
havana.location = { x: 60, y: 64, z: 0 }; advance(600);   // 30 seconds away
havana.location = { x: 2, y: 64, z: 0 }; advance(20);
check(greets() === g0, "back after just 30 seconds: no big hello");
havana.location = { x: 60, y: 64, z: 0 }; advance(1800);  // a minute and a half away
havana.location = { x: 2, y: 64, z: 0 }; advance(20);
check(greets() === g0 + 1 && havana.actionbar.at(-1).includes("SO happy"), "back after a while apart: the dog is SO happy to see her");
check(dog.getDynamicProperty("alphadog:sitting") === true, "a sitting dog wiggles hello but stays sitting");
advance(80);
check(dog.fx.at(-1) === "alphadog:greet_end", "the wiggly hello lasts a few seconds");
answers.push(1);
advance(15); tap(havana, dog, undefined, true); await flush(); advance(2);   // come on, let's go
// Logging back in.
dog.hops = 0;
handlers.spawn({ player: havana, initialSpawn: true });
advance(80);
check(greets() === g0 + 2, "when Havana logs in, her dog greets her");
check(dog.hops > 0, "and bounces up and down (when it isn't sitting)");
advance(80);
// Brand-new puppies don't do a "welcome back" right after hatching.
const freshPup = hatchFor(havana, { x: -3, y: 63, z: -3 });
advance(100);
check(freshPup.fx.filter((e) => e === "alphadog:greet_start").length === 0, "a brand-new puppy doesn't do a welcome-back hello");
freshPup.remove();
havana.view = { x: 0, y: 0.98, z: 0.2 };   // back to looking at the sky

// ---------- Walking never gets switched off ----------
{
  const path = require("path");
  const ent = JSON.parse(fs.readFileSync(path.join(path.dirname(process.argv[2]), "..", "entities", "alpha_dog.json"), "utf8"))["minecraft:entity"];
  const g = ent.component_groups;
  const sizes = new Set(["puppy", "small", "big", "alpha"].flatMap((n) => Object.keys(g[`alphadog:${n}`])));
  const modeGroups = ["roam_free", "roam_close", "explore", "zoomies", "chewing", "sitting", "bowing", "lying"].map((n) => `alphadog:${n}`);
  const clashes = modeGroups.flatMap((m) => Object.keys(g[m]).filter((c) => sizes.has(c) || ent.components[c]).map((c) => `${m}: ${c}`));
  check(clashes.length === 0, `mode groups never hold walking speed or other size/base components (removing them would strip it)${clashes.length ? ": " + clashes.join(", ") : ""}`);
}
const modeChanges = dog.events.map((e, i) => [e, dog.events[i + 1]]).filter(([e]) => e === "alphadog:mode_free" || e === "alphadog:mode_close");
check(modeChanges.length > 0 && modeChanges.every(([, next]) => next?.startsWith("alphadog:stage_")), "every switch back to normal re-applies the size (walking speed) too");

// ---------- Play bow ----------
globalThis.__dog.nextBow.delete(dog.id);
dog.location = { x: 0, y: 64, z: 4 }; havana.location = { x: 0, y: 64, z: 0 };
advance(200); walkBack(dog, havana, { x: 0, y: 64, z: 4 });
const bows = () => dog.events.filter((e) => e === "alphadog:bow").length;
const b0 = bows();
faceDog(havana, dog); advance(20); havana.view = { x: 0, y: 0.98, z: 0.2 }; advance(10);
check(bows() === b0, "a quick glance doesn't make it bow");
faceDog(havana, dog); advance(50);
check(bows() === b0 + 1 && dog.getDynamicProperty("alphadog:mode") === "bowing", "looking right at the dog for 2 seconds: PLAY BOW");
check(havana.actionbar.at(-1).includes("wants to play"), "\"Duke wants to play!\"");
advance(40);
check(dog.getDynamicProperty("alphadog:mode") !== "bowing", "the bow lasts about 2 seconds");
advance(200);
check(bows() === b0 + 1, "not again right away (30 seconds between bows)");
// Over a few minutes of staring, it bows again and again, and usually bursts into zoomies.
let bowZooms = 0, bowTries = 0;
for (let i = 0; i < 6; i++) {
  havana.view = { x: 0, y: 0.98, z: 0.2 };   // look away while the 30 seconds pass
  advance(640); walkBack(dog, havana, { x: 0, y: 64, z: 4 }); faceDog(havana, dog);
  const before = bows();
  advance(50);
  if (bows() > before) {
    bowTries++;
    let zoomed = false;
    for (let j = 0; j < 8 && !zoomed; j++) { advance(10); zoomed = dog.getDynamicProperty("alphadog:mode") === "zoomies"; }
    if (zoomed) bowZooms++;
  }
  havana.view = { x: 0, y: 0.98, z: 0.2 };
  advance(200);
}
check(bowTries === 6, `it play-bows each time she looks at it a while (${bowTries} of 6 times)`);
check(bowZooms >= 1, `keep looking and it bursts into zoomies (${bowZooms} of those times)`);
havana.view = { x: 0, y: 0.98, z: 0.2 };
advance(200);

// ---------- Lying down at night ----------
walkBack(dog, havana, { x: 1.5, y: 64, z: 1 });
havana.selectedSlotIndex = 99;   // empty hand (a treat in hand keeps it awake)
timeOfDay = 15000;
advance(140);
check(dog.getDynamicProperty("alphadog:mode") === "lying" && dog.events.at(-1) === "alphadog:lie_down", "at night, when Havana stands still, the dog lies down next to her");
check(havana.actionbar.some((m) => m.includes("Goodnight")), "\"Duke lies down next to you. Goodnight!\"");
advance(400);
check(particles.some((p) => p.id === "alphadog:zzz"), "Zzz while it snoozes");
check(dog.getDynamicProperty("alphadog:mode") === "lying", "and it stays lying down while she stays put");
havana.location = { x: 6, y: 64, z: 0 }; advance(12);
check(dog.getDynamicProperty("alphadog:mode") === "follow" && dog.events.at(-1).startsWith("alphadog:stage_"), "when she walks off, it gets up and comes along");
advance(200);
check(dog.getDynamicProperty("alphadog:mode") === "lying", "she stops again: it lies down again");
hold(havana, "minecraft:bone", 1); havana.selectedSlotIndex = 0; advance(12);
check(dog.getDynamicProperty("alphadog:mode") === "follow", "pulling out a treat wakes it right up");
havana.inv.shift(); havana.selectedSlotIndex = 99; advance(200);
const zz = dims.overworld.spawnEntity("minecraft:zombie", { x: havana.location.x + 4, y: 64, z: havana.location.z });
advance(12);
check(dog.getDynamicProperty("alphadog:mode") === "follow", "a monster coming wakes it up (to guard her)");
zz.remove(); advance(200);
havana.isSleeping = true; havana.location = { x: 20, y: 64, z: 0 }; walkBack(dog, havana); advance(200);
check(dog.getDynamicProperty("alphadog:mode") === "lying", "when she sleeps in a bed, it lies down too");
timeOfDay = 1000; advance(12);
check(dog.getDynamicProperty("alphadog:mode") === "follow", "morning: up and ready to go");
havana.isSleeping = false;
const lieDuringDay = dog.events.filter((e) => e === "alphadog:lie_down").length;
advance(2000);
check(dog.events.filter((e) => e === "alphadog:lie_down").length === lieDuringDay, "no lying down during the day");

// One Alpha per player: a second dog stops at Big Dog while the first Alpha is around.
const feedTo = (player, d, points) => {
  player.inv.unshift(new ItemStack("minecraft:cooked_beef", 64)); player.selectedSlotIndex = 0;
  while ((d.getDynamicProperty("alphadog:food") || 0) < points) { tap(player, d, "minecraft:cooked_beef"); advance(12); }
  player.inv.shift(); player.selectedSlotIndex = 99;
};
havana.location = { x: 0, y: 64, z: 0 };
dog.location = { x: 2, y: 64, z: 0 };
advance(110);   // the Alpha is seen and remembered
const pup2 = hatchFor(havana, { x: 4, y: 63, z: 4 });
check(!!pup2 && pup2.tamedTo === "Havana", "Havana hatches a second puppy");
feedTo(havana, pup2, 32);
check(pup2.getDynamicProperty("alphadog:stage") === 2 && !pup2.events.includes("alphadog:stage_3"), "with an Alpha already in her pack, the second dog stays a Big Dog");
check(havana.actionbar.at(-1).includes("only one Alpha") && havana.actionbar.at(-1).includes("Graham"), "and she's told Graham is already her Alpha");
// Parked far away (not loaded right now): still counts.
dims.overworld.entities.splice(dims.overworld.entities.indexOf(dog), 1);
advance(15); tap(havana, pup2, "minecraft:bone"); advance(12);
check(pup2.getDynamicProperty("alphadog:stage") === 2, "an Alpha parked far away (not loaded) still counts");
dims.overworld.entities.push(dog);
// Jeff's pack is separate.
const jpup = dims.overworld.getEntities({ type: "alphadog:dog" }).find((d) => d.tamedTo === "Jeff");
jeff.mode = "survival";
feedTo(jeff, jpup, 30);
check(jpup.getDynamicProperty("stage") === undefined && jpup.getDynamicProperty("alphadog:stage") === 3, "Jeff can still have his own Alpha");

// Saying goodbye: asks first. "No" keeps it.
advance(15);
answers.push(4, 1);
tap(havana, dog, undefined, true); await flush(); advance(2); await flush(); advance(40);
check(dog.valid && forms.at(-1).t === "Say goodbye?", "goodbye asks \"Are you sure?\" and No keeps the dog");
advance(15);
answers.push(4, 0);
tap(havana, dog, undefined, true); await flush(); advance(2); await flush(); advance(40);
check(!dog.valid && havana.messages.at(-1).includes("Bye-bye"), "Yes: the dog runs off to find a new family");
check(havana.getDynamicProperty("alphadog:alpha") === undefined, "saying goodbye to the Alpha frees the spot");
advance(15); tap(havana, pup2, "minecraft:bone"); advance(12);
check(pup2.getDynamicProperty("alphadog:stage") === 3, "and the next treat makes the second dog the new Alpha");

// An Alpha that vanished without a goodbye (pack switched off, a command) stops counting after 3 in-game days.
const pup3 = hatchFor(havana, { x: -4, y: 63, z: 4 });
pup2.remove();
feedTo(havana, pup3, 30);
check(pup3.getDynamicProperty("alphadog:stage") === 2, "right after the Alpha disappears, it still counts (it might just be parked)");
clockSkip += 80000;
advance(15); tap(havana, pup3, "minecraft:bone"); advance(12);
check(pup3.getDynamicProperty("alphadog:stage") === 3, "after 3 in-game days unseen, another dog can become the Alpha");

console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
})();
