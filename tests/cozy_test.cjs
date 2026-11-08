// Runs the Cozy Home script against a small fake Minecraft world and taps every piece of furniture.
// Usage: node tests/cozy_test.cjs addons/CozyHome_BP/scripts/main.js
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8").replace(/^import .*$/gm, "");

let tick = 0, day = 1;
const dyn = new Map();
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

// Block states the block files declare (so withState rejects typos like the real game).
const STATES = {};
for (const f of fs.readdirSync("addons/CozyHome_BP/blocks")) {
  const j = JSON.parse(fs.readFileSync(`addons/CozyHome_BP/blocks/${f}`, "utf8"))["minecraft:block"];
  STATES[j.description.identifier] = { ...(j.description.states || {}), "minecraft:cardinal_direction": ["north", "south", "east", "west"] };
}
class Perm {
  constructor(id, states) { this.type = { id }; this.states = states; }
  getState(s) { return this.states[s]; }
  withState(s, v) {
    if (!STATES[this.type.id]?.[s]?.includes(v)) throw new Error(`bad state ${s}=${v} on ${this.type.id}`);
    return new Perm(this.type.id, { ...this.states, [s]: v });
  }
}
const blocks = new Map();
const K = (l) => `${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)}`;
const dropped = [], sounds = [], particles = [];
const dim = {
  id: "minecraft:overworld",
  getBlock(l) {
    const k = K(l);
    const perm = blocks.get(k) || new Perm("minecraft:air", {});
    return {
      typeId: perm.type.id, permutation: perm, location: { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) }, dimension: dim,
      setPermutation: (p) => blocks.set(k, p),
    };
  },
  spawnItem(item, loc) { dropped.push({ ...item, loc }); },
  spawnParticle(id) { particles.push(id); },
  playSound(id) { sounds.push(id); },
};
function place(id, x, dir = "north") {
  const states = { "minecraft:cardinal_direction": dir };
  for (const [s, vals] of Object.entries(STATES[id])) if (!(s in states)) states[s] = vals[0];
  blocks.set(K({ x, y: 64, z: 0 }), new Perm(id, states));
  handlers.place?.({ player: players[0], block: dim.getBlock({ x, y: 64, z: 0 }) });
  return { x, y: 64, z: 0 };
}
const state = (l, s) => blocks.get(K(l)).states[s];

function makePlayer(name) {
  const slots = Array(36).fill(undefined);
  const props = new Map();
  const p = {
    name, typeId: "minecraft:player", location: { x: 0.5, y: 64, z: -2 }, dimension: dim, messages: [], bar: [], slots,
    selectedSlotIndex: 0, isSneaking: false, effects: [], removed: [],
    sendMessage(m) { this.messages.push(m); }, playSound() {},
    onScreenDisplay: { setTitle() { throw new Error("no big titles"); }, setActionBar(m) { p.bar.push(m); } },
    getDynamicProperty: (k) => props.get(k), setDynamicProperty: (k, v) => props.set(k, v),
    addEffect(e, t, o) { this.effects.push([e, t, o.amplifier]); }, removeEffect(e) { this.removed.push(e); },
    getComponent: () => ({
      container: {
        getItem: (i) => slots[i] && new ItemStack(slots[i].typeId, slots[i].amount),
        setItem: (i, it) => { slots[i] = it; },
        addItem: (it) => { const i = slots.findIndex((s, j) => j > 8 && !s); slots[i] = it; },
      },
    }),
  };
  return p;
}
const players = [makePlayer("Havana"), makePlayer("Jeff")];
const world = {
  getDynamicProperty: (k) => dyn.get(k), setDynamicProperty: (k, v) => (v === undefined ? dyn.delete(k) : dyn.set(k, v)),
  getDay: () => day, getAllPlayers: () => players, getDimension: () => dim, playSound() {},
  afterEvents: { playerSpawn: sub("spawn"), playerPlaceBlock: sub("place"), playerBreakBlock: sub("break"), itemCompleteUse: sub("eat") },
  beforeEvents: { playerInteractWithBlock: sub("interact") },
};
new Function("world", "system", "ItemStack", src)(world, system, ItemStack);

function advance(n) {
  for (let i = 0; i < n; i++) {
    tick++;
    for (const t of [...timers]) {
      if (t.at <= tick && timers.includes(t)) {
        if (t.once) timers.splice(timers.indexOf(t), 1); else t.at = tick + t.every;
        t.fn();
      }
    }
  }
}
function tap(player, l, opts = {}) {
  const held = player.slots[player.selectedSlotIndex];
  const ev = { block: dim.getBlock(l), player, itemStack: held && new ItemStack(held.typeId, held.amount), cancel: false, isFirstEvent: true, ...opts };
  handlers.interact(ev);
  advance(8);
  return ev;
}
let failures = 0;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failures++; };
const H = players[0], J = players[1];

// Starter kit.
for (const p of players) handlers.spawn({ player: p, initialSpawn: true });
advance(150);
const kit = H.slots.filter(Boolean).map((s) => s.typeId);
check(["fridge", "stove", "bathtub", "toilet", "tv", "lamp", "mailbox"].every((f) => kit.includes(`cozy:${f}`)), "everyone gets all 7 pieces of furniture on first join");
check(H.messages.length === 1, "one short how-to message, once");

// Fridge: opens with a snack, closes by itself, no second snack right away.
const fridge = place("cozy:fridge", 0, "south");
dropped.length = 0;
const ev = tap(H, fridge);
check(ev.cancel && state(fridge, "cozy:open") === true, "tapping the fridge opens it");
check(dropped.length === 1, `a snack pops out: ${dropped[0]?.amount} ${dropped[0]?.typeId}`);
check(dropped[0] && dropped[0].loc.z > 1, "the snack pops out the front (the fridge faces south)");
advance(130);
check(state(fridge, "cozy:open") === false, "the door closes by itself");
tap(H, fridge); tap(H, fridge);
check(dropped.length === 1 && state(fridge, "cozy:open") === false, "tap again closes it; no new snack until it restocks");
advance(220); tap(H, fridge);
check(dropped.length === 2, "restocked a little later");
const sneakEv = { block: dim.getBlock(fridge), player: { ...H, isSneaking: true }, cancel: false, isFirstEvent: true };
handlers.interact(sneakEv);
check(!sneakEv.cancel, "crouching lets you build against furniture");
const holdEv = { block: dim.getBlock(fridge), player: H, cancel: false, isFirstEvent: false };
handlers.interact(holdEv); advance(8);
check(holdEv.cancel && dropped.length === 2, "holding the button down doesn't repeat");

// Cooking.
const stove = place("cozy:stove", 3);
H.slots[0] = new ItemStack("minecraft:carrot", 3);
dropped.length = 0;
tap(H, stove);
check(state(stove, "cozy:pot") === 1 && H.slots[0].amount === 2, "a carrot goes into the pot");
H.slots[0] = new ItemStack("minecraft:sugar", 1);
tap(H, stove);
check(state(stove, "cozy:pot") === 2 && !H.slots[0], "sugar goes in and it starts cooking");
advance(70);
check(state(stove, "cozy:pot") === 0 && dropped.some((d) => d.typeId === "cozy:carrot_cake"), "carrot + sugar = Carrot Cake");
const recipes = [
  ["minecraft:apple", "minecraft:sweet_berries", "cozy:fruit_salad"], ["minecraft:poppy", "minecraft:bread", "cozy:rainbow_soup"],
  ["minecraft:dirt", "minecraft:cookie", "cozy:mud_pie"], ["minecraft:wheat", "minecraft:cooked_beef", "cozy:pizza"],
  ["minecraft:beef", "minecraft:beef", "minecraft:cooked_beef"], ["minecraft:red_dye", "minecraft:apple", "cozy:rainbow_soup"],
];
for (const [a, b, want] of recipes) {
  dropped.length = 0;
  H.slots[0] = new ItemStack(a, 1); tap(H, stove);
  H.slots[0] = new ItemStack(b, 1); tap(H, stove);
  advance(70);
  check(dropped[0]?.typeId === want, `${a.split(":")[1]} + ${b.split(":")[1]} = ${dropped[0]?.typeId}`);
}
dropped.length = 0;
H.slots[0] = new ItemStack("minecraft:diamond_sword", 1); tap(H, stove);
check(state(stove, "cozy:pot") === 0 && H.slots[0]?.typeId === "minecraft:diamond_sword", "a sword doesn't go in the pot");
H.slots[0] = new ItemStack("minecraft:milk_bucket", 1); tap(H, stove);
check(H.slots[0]?.typeId === "minecraft:bucket", "milk goes in, you keep the bucket");
handlers.break({ block: dim.getBlock(stove), brokenBlockPermutation: blocks.get(K(stove)) });
check(dropped.some((d) => d.typeId === "minecraft:milk_bucket"), "breaking the stove gives back what was in the pot");

// Bathtub.
const tub = place("cozy:bathtub", 6);
tap(H, tub);
check(state(tub, "cozy:full") === true, "tap fills the tub");
H.location = { x: 6.5, y: 64.2, z: 0.5 };
H.effects.length = 0;
advance(60);
check(H.removed.includes("poison") && sounds.includes("random.orb"), "sitting in the bath makes you sparkly clean");
tap(H, tub);
check(state(tub, "cozy:full") === false, "tap again drains it");
H.location = { x: 0.5, y: 64, z: -2 };

// Toilet.
const toilet = place("cozy:toilet", 9);
const before = sounds.length;
tap(H, toilet);
check(sounds.slice(before).includes("bucket.fill_water"), "flush!");
let fish = 0;
for (let i = 0; i < 300; i++) { dropped.length = 0; tap(H, toilet); advance(40); if (dropped.some((d) => d.typeId === "minecraft:tropical_fish_bucket")) fish++; }
check(fish > 2 && fish < 40, `now and then a fish comes back up (${fish} of 300 flushes)`);

// TV.
const tv = place("cozy:tv", 12);
const seen = new Set();
for (let i = 0; i < 400; i++) { tap(H, tv); seen.add(state(tv, "cozy:channel")); }
check([0, 1, 2, 3, 4, 5].every((c) => seen.has(c)), `TV goes through every channel, including the secret one (${[...seen].sort()})`);

// Lamp.
const lamp = place("cozy:lamp", 15);
tap(H, lamp);
check(state(lamp, "cozy:lit") === true, "lamp turns on");
tap(H, lamp);
check(state(lamp, "cozy:lit") === false, "and off");

// Mailbox.
const box = place("cozy:mailbox", 18);
advance(2);
check(state(box, "cozy:flag") === true, "a new mailbox has its flag up");
dropped.length = 0;
tap(H, box);
check(dropped.length === 1, `Havana gets her mail: ${dropped[0]?.amount} ${dropped[0]?.typeId}`);
check(state(box, "cozy:flag") === true, "flag stays up: Jeff hasn't had his");
tap(H, box);
check(dropped.length === 1 && H.bar.some((m) => m.includes("tomorrow")), "only one letter a day each");
tap(J, box);
advance(50);
check(dropped.length === 2 && state(box, "cozy:flag") === false, "Jeff gets his, and the flag goes down");
day = 2; advance(50);
check(state(box, "cozy:flag") === true, "next morning the flag is back up");
tap(H, box);
check(dropped.length === 3, "and there's new mail");
const box2 = place("cozy:mailbox", 21);
dropped.length = 0;
tap(H, box2);
check(dropped.length === 0, "a second mailbox doesn't give extra mail");
const gifts = new Set();
for (let i = 0; i < 400; i++) { day = 100 + i; dropped.length = 0; tap(H, box); if (dropped[0]) gifts.add(dropped[0].typeId); }
check(gifts.size > 25, `lots of different mail (${gifts.size} kinds)`);
check([...gifts].every((g) => g.startsWith("minecraft:") || g.startsWith("cozy:")), "mail is all real items");
blocks.delete(K(box2));
handlers.break({ block: dim.getBlock(box2), brokenBlockPermutation: new Perm("cozy:mailbox", {}) });
check(!JSON.parse(dyn.get("cozy:mailboxes")).includes("minecraft:overworld|21,64,0"), "broken mailbox forgotten");

// Dishes.
handlers.eat({ source: H, itemStack: new ItemStack("cozy:mud_pie") });
check(H.effects.some(([e]) => e === "jump_boost"), "mud pie makes you bouncy");
handlers.eat({ source: H, itemStack: new ItemStack("cozy:carrot_cake") });
check(H.effects.some(([e]) => e === "night_vision"), "carrot cake helps you see in the dark");

// Every model and texture the blocks name exists.
const geos = new Set(fs.readdirSync("addons/CozyHome_RP/models/blocks").flatMap((f) =>
  JSON.parse(fs.readFileSync(`addons/CozyHome_RP/models/blocks/${f}`, "utf8"))["minecraft:geometry"].map((g) => g.description.identifier)));
const tex = Object.keys(JSON.parse(fs.readFileSync("addons/CozyHome_RP/textures/terrain_texture.json", "utf8")).texture_data);
const blockText = fs.readdirSync("addons/CozyHome_BP/blocks").map((f) => fs.readFileSync(`addons/CozyHome_BP/blocks/${f}`, "utf8")).join("");
const missingGeo = [...blockText.matchAll(/"(geometry\.[a-z_0-9]+)"/g)].map((m) => m[1]).filter((g) => !geos.has(g));
const missingTex = [...blockText.matchAll(/"texture": "([a-z_0-9]+)"/g)].map((m) => m[1]).filter((t) => !tex.includes(t));
check(!missingGeo.length && !missingTex.length, `blocks only use models and textures that exist ${missingGeo} ${missingTex}`);
const lang = fs.readFileSync("addons/CozyHome_RP/texts/en_US.lang", "utf8");
const items = fs.readdirSync("addons/CozyHome_BP/items").map((f) => f.replace(".json", ""));
check(items.every((i) => lang.includes(`item.cozy:${i}.name=`)), "every dish has a name");

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
