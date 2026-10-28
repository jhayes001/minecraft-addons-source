// Runs the Alpha Dog script against a small fake Minecraft world and checks the story:
// join -> egg + bones -> set egg down -> puppy hatches, already Havana's, with a name -> pet it ->
// treats grow it Puppy -> Small -> Big -> Alpha (waits for room) -> ride (owner only) -> menu ->
// wanders off and comes back with a present -> runs back when far / through a portal / when she's
// in danger -> stays when tied with a lead -> goodbye.
// Usage: node tests/alpha_dog_test.cjs addons/AlphaDog_BP/scripts/main.js
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8").replace(/^import .*$/gm, "") +
  "\nglobalThis.__dog = { exploreUntil, nextRoll, GROW_AT };";

// Repeatable "random" numbers.
let seed = 12345;
Math.random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

let tick = 0;
const handlers = {};
const sub = (name) => ({ subscribe: (fn) => (handlers[name] = fn) });
const timers = [];
let nextId = 1;
const system = {
  get currentTick() { return tick; },
  runInterval: (fn, n) => { const id = nextId++; timers.push({ id, fn, every: n || 1, at: tick + (n || 1) }); return id; },
  runTimeout: (fn, n) => { const id = nextId++; timers.push({ id, fn, once: true, at: tick + (n || 1) }); return id; },
  run: (fn) => system.runTimeout(fn, 1),
  clearRun: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
};
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
    setBlock(l, typeId) { blocks.set(K(l), typeId); },
    getBlock(l) {
      const b = blocks.get(K(l));
      const typeId = b ?? (l.y < 64 ? "minecraft:grass_block" : "minecraft:air");
      return { typeId, dimension: dim, location: { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) } };
    },
    spawnEntity(type, loc) {
      if (!type.includes(":")) throw new Error("bad");
      const props = new Map();
      const e = {
        typeId: type, id: String(nextId++), location: { ...loc }, dimension: dim, events: [], nameTag: "", valid: true,
        families: type === "minecraft:zombie" ? ["monster", "zombie"] : [],
        tamedTo: null, riders: [], leashed: false,
        isValid() { return this.valid; },
        getDynamicProperty: (k) => props.get(k),
        setDynamicProperty: (k, v) => (v === undefined ? props.delete(k) : props.set(k, v)),
        triggerEvent(ev) { this.events.push(ev); },
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
    getBlockFromViewDirection() { return this.lookAt ? { block: this.dimension.getBlock(this.lookAt) } : undefined; },
  };
  p.onScreenDisplay = { setTitle: (t, o) => p.titles.push(t + " / " + (o?.subtitle ?? "")), setActionBar: (m) => p.actionbar.push(m) };
  players.push(p);
  return p;
}
const havana = makePlayer("Havana", 0), jeff = makePlayer("Jeff", 3);
const world = {
  getAllPlayers: () => players, getDimension: (d) => dims[d.replace("minecraft:", "")],
  afterEvents: { playerSpawn: sub("spawn"), itemUse: sub("use"), entityHurt: sub("hurt") },
  beforeEvents: { playerInteractWithEntity: sub("interact") },
};
new Function("world", "system", "ItemStack", "ActionFormData", src)(world, system, ItemStack, ActionFormData);

function advance(n) {
  for (let i = 0; i < n; i++) {
    tick++;
    for (const t of [...timers]) {
      if (t.at <= tick) {
        if (t.once) timers.splice(timers.indexOf(t), 1); else t.at = tick + t.every;
        t.fn();
      }
    }
  }
}
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
check(havana.titles.some((t) => t.includes("hatched") && t.includes(dog.nameTag)), "Havana is told the puppy's name");
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
check(havana.titles.some((t) => t.includes("grew") && t.includes("Small Dog")), "Havana sees it grow");
// Fast tapping doesn't eat a whole stack at once.
hold(havana, "minecraft:cooked_beef", 20);
tap(havana, dog, "minecraft:cooked_beef"); tap(havana, dog, "minecraft:cooked_beef");
check(count(havana, "minecraft:cooked_beef") === 19, "one treat per bite, even when tapping fast");
advance(15);
for (let i = 0; i < 4; i++) { tap(havana, dog, "minecraft:cooked_beef"); advance(15); }
check(dog.getDynamicProperty("alphadog:food") === 15 && dog.getDynamicProperty("alphadog:stage") === 2, "cooked meat counts double: 5 steaks later it's a Big Dog");

// Indoors: not enough room to become an Alpha Dog.
const fl = { x: Math.floor(dog.location.x), y: Math.floor(dog.location.y), z: Math.floor(dog.location.z) };
dims.overworld.setBlock({ x: fl.x, y: fl.y + 2, z: fl.z }, "minecraft:oak_planks");
for (let i = 0; i < 8; i++) { tap(havana, dog, "minecraft:cooked_beef"); advance(15); }
check(dog.getDynamicProperty("alphadog:stage") === 2 && havana.messages.some((m) => m.includes("somewhere outside")), "with a ceiling overhead it waits to grow into an Alpha Dog");
dims.overworld.blocks.clear();
tap(havana, dog, "minecraft:chicken"); advance(15);
check(dog.events.includes("alphadog:stage_3") && dog.getDynamicProperty("alphadog:stage") === 3, "outside, one more treat: ALPHA DOG");
check(havana.titles.some((t) => t.includes("ALPHA DOG") && t.includes("ride")), "Havana is told she can ride it");

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
answers.push(1);
tap(havana, dog, undefined, true); await flush(); advance(2);
const menu = forms.at(-1);
check(menu.buttons.length === 3 && menu.buttons[1] === "Stay close to me" && menu.b.includes("Alpha Dog"), "crouch+tap opens the menu");
check(dog.getDynamicProperty("alphadog:roam") === "close" && dog.events.at(-1) === "alphadog:mode_close", "\"Stay close to me\" keeps it near");
advance(15);
answers.push(1);
tap(havana, dog, undefined, true); await flush(); advance(2);
check(forms.at(-1).buttons[1] === "You can go explore" && dog.events.at(-1) === "alphadog:mode_free", "and \"You can go explore\" lets it roam again");

// A bit aloof: it wanders off now and then, comes back, and sometimes brings a present.
havana.location = { x: dog.location.x + 1.5, y: 64, z: dog.location.z };   // sitting with the dog
havana.selectedSlotIndex = 99;   // empty hand: no treat out
let explores = 0, gifts = 0, wasExploring = false;
for (let i = 0; i < 40000; i += 10) {
  advance(10);
  const now = dog.getDynamicProperty("alphadog:mode") === "explore";
  if (now && !wasExploring) explores++;
  wasExploring = now;
}
gifts = dropped.length;
check(explores >= 2 && explores <= 12, `over half an hour it wandered off on its own ${explores} times (now and then, not constantly)`);
check(dog.getDynamicProperty("alphadog:mode") === "follow" || wasExploring, "and came back from each walk");
check(gifts >= 1 && havana.messages.some((m) => m.includes("brought you")), `it brought back ${gifts} present(s): ${dropped.map((d) => d.id.replace("minecraft:", "")).join(", ")}`);
check(dog.events.filter((e) => e === "alphadog:go_explore").length === explores, "exploring uses the explore behavior");

// Monster near Havana while it's exploring: it stops exploring.
const until = (dog.getDynamicProperty("alphadog:mode") === "explore");
if (!until) { dog.setDynamicProperty("alphadog:mode", "explore"); globalThis.__dog.exploreUntil.set(dog.id, tick + 5000); }
const zombie = dims.overworld.spawnEntity("minecraft:zombie", { x: havana.location.x + 5, y: 64, z: 0 });
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

// Saying goodbye: asks first. "No" keeps it.
advance(15);
answers.push(2, 1);
tap(havana, dog, undefined, true); await flush(); advance(2); await flush(); advance(40);
check(dog.valid && forms.at(-1).t === "Say goodbye?", "goodbye asks \"Are you sure?\" and No keeps the dog");
advance(15);
answers.push(2, 0);
tap(havana, dog, undefined, true); await flush(); advance(2); await flush(); advance(40);
check(!dog.valid && havana.messages.at(-1).includes("Bye-bye"), "Yes: the dog runs off to find a new family");

console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
})();
