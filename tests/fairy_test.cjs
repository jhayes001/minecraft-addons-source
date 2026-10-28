// Runs the Fairy Friends script against a small fake Minecraft world and checks the story:
// join -> egg + house -> set egg down -> it hatches -> fairy follows (even to the Nether) and
// sprinkles dust -> at night it flies to its house and sleeps (house lights up) -> wakes in the morning.
// Usage: node tests/fairy_test.cjs addons/FairyFriends_BP/scripts/main.js
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8").replace(/^import .*$/gm, "") +
  "\nglobalThis.__fairy = { hatch, COLORS };";

let tick = 0, time = 1000, day = 3;
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
class MolangVariableMap { setColorRGB(k, c) { this.color = c; } }
const answers = []; const forms = [];
class ActionFormData {
  constructor() { this.buttons = []; }
  title(t) { this.t = t; return this; }
  body(b) { this.b = b; return this; }
  button(l) { this.buttons.push(l); return this; }
  show() { forms.push(this); const a = answers.shift(); return Promise.resolve(a === undefined ? { canceled: true } : { canceled: false, selection: a }); }
}
class BlockPermutation {
  constructor(id, states) { this.type = { id }; this.states = states || {}; }
  static resolve(id, states) { if (!id.includes(":")) throw new Error("bad"); return new BlockPermutation(id, states); }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

const particles = [];
const sounds = [];
function makeDim(id) {
  const blocks = new Map();
  const K = (l) => `${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)}`;
  const dim = {
    id: `minecraft:${id}`, blocks, entities: [],
    getBlock(l) {
      const k = K(l);
      const b = blocks.get(k);
      const typeId = b ? b.id : l.y < 64 ? "minecraft:grass_block" : "minecraft:air";
      const states = b ? b.states : {};
      const perm = { type: { id: typeId }, states, withState: (s, v) => ({ type: { id: typeId }, states: { ...states, [s]: v } }) };
      return {
        typeId, permutation: perm, dimension: dim, location: { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) },
        setPermutation: (p) => blocks.set(k, { id: p.type.id, states: p.states || {} }),
      };
    },
    spawnEntity(type, loc) {
      if (!type.includes(":")) throw new Error("bad");
      const props = new Map(), effects = new Map();
      const e = {
        typeId: type, id: String(nextId++), location: { ...loc }, dimension: dim, rot: { x: 0, y: 0 }, events: [], nameTag: "", valid: true,
        isValid() { return this.valid; },
        getDynamicProperty: (k) => props.get(k),
        setDynamicProperty: (k, v) => (v === undefined ? props.delete(k) : props.set(k, v)),
        triggerEvent(ev) { this.events.push(ev); },
        getRotation() { return this.rot; },
        teleport(p, opts = {}) {
          this.location = { ...p };
          if (opts.rotation) this.rot = opts.rotation;
          if (opts.dimension && opts.dimension !== this.dimension) {
            this.dimension.entities.splice(this.dimension.entities.indexOf(this), 1);
            opts.dimension.entities.push(this);
            this.dimension = opts.dimension;
          }
        },
        remove() { this.valid = false; this.dimension.entities.splice(this.dimension.entities.indexOf(this), 1); },
        addEffect(id, dur) { effects.set(id, dur); },
        applyKnockback(dx, dz, h, v) { this.knocked = (this.knocked || 0) + 1; this.location = { x: this.location.x + dx * h, y: this.location.y, z: this.location.z + dz * h }; },
        removeEffect(id) { effects.delete(id); },
        effects,
      };
      dim.entities.push(e);
      return e;
    },
    getEntities(q = {}) {
      return dim.entities.filter((e) => (!q.type || e.typeId === q.type) &&
        (!q.families || q.families.some((fam) => (e.families || []).includes(fam))) &&
        (!q.location || Math.hypot(e.location.x - q.location.x, e.location.y - q.location.y, e.location.z - q.location.z) <= q.maxDistance));
    },
    spawnParticle(id, loc, vars) { particles.push({ id, loc, color: vars?.color }); },
    spawnItem() {},
    playSound(id) { sounds.push(id); },
  };
  return dim;
}
const dims = { overworld: makeDim("overworld"), nether: makeDim("nether"), the_end: makeDim("the_end") };

function makePlayer(name, x) {
  const inv = [];
  const props = new Map();
  return {
    name, typeId: "minecraft:player", location: { x, y: 64, z: 0 }, dimension: dims.overworld, messages: [], titles: [], inv,
    mode: "survival", rot: { x: 0, y: 0 }, selectedSlotIndex: 0,
    sendMessage(m) { this.messages.push(m); },
    playSound() {},
    getGameMode() { return this.mode; },
    getRotation() { return this.rot; },
    actionbar: [],
    onScreenDisplay: { setTitle: (t, o) => {}, setActionBar(m) { players.find((p) => p.onScreenDisplay === this)?.actionbar.push(m); } },
    getDynamicProperty: (k) => props.get(k), setDynamicProperty: (k, v) => props.set(k, v),
    getComponent: () => ({
      container: {
        addItem: (it) => { inv.push(it); },
        getItem: (i) => inv[i],
        setItem: (i, it) => { if (it) inv[i] = it; else inv.splice(i, 1); },
      },
    }),
    lookAt: null,
    getBlockFromViewDirection() { return this.lookAt ? { block: this.dimension.getBlock(this.lookAt) } : undefined; },
  };
}
const havana = makePlayer("Havana", 0), jeff = makePlayer("Jeff", 3);
const players = [havana, jeff];
const wdyn = new Map();
const world = {
  getDynamicProperty: (k) => wdyn.get(k), setDynamicProperty: (k, v) => (v === undefined ? wdyn.delete(k) : wdyn.set(k, v)),
  getDay: () => day, getTimeOfDay: () => time,
  getAllPlayers: () => players, getDimension: (d) => dims[d.replace("minecraft:", "")], playSound() {},
  afterEvents: { playerSpawn: sub("spawn"), itemUse: sub("use"), playerPlaceBlock: sub("place"), playerBreakBlock: sub("break") },
  beforeEvents: { playerInteractWithEntity: sub("interact") },
};
new Function("world", "system", "ItemStack", "MolangVariableMap", "ActionFormData", "BlockPermutation", src)(world, system, ItemStack, MolangVariableMap, ActionFormData, BlockPermutation);

function advance(n) {
  for (let i = 0; i < n; i++) {
    tick++;
    time += 1;
    if (time >= 24000) { time -= 24000; day++; }
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
const fairiesOf = (name) => Object.values(dims).flatMap((d) => d.entities).filter((e) => e.typeId === "fairy:fairy" && e.getDynamicProperty("fairy:owner") === name);
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

(async () => {
// Join: egg and house.
for (const p of players) handlers.spawn({ player: p, initialSpawn: true });
advance(120);
check(havana.inv.some((i) => i.typeId === "fairy:fairy_egg") && havana.inv.some((i) => i.typeId === "fairy:fairy_house"), "player gets a Fairy Egg and a Fairy House on first join");
handlers.spawn({ player: havana, initialSpawn: true }); advance(120);
check(havana.inv.length === 2, "starter kit only given once");

// Looking at the sky: nothing happens.
handlers.use({ source: havana, itemStack: new ItemStack("fairy:fairy_egg") });
check(!dims.overworld.getEntities({ type: "fairy:egg" }).length && havana.messages.at(-1).includes("Look at the ground"), "no egg without aiming at the ground");

// Set the egg on the grass in front of her.
havana.lookAt = { x: 3, y: 63, z: 2 };
advance(20);
handlers.use({ source: havana, itemStack: new ItemStack("fairy:fairy_egg") });
const eggs = dims.overworld.getEntities({ type: "fairy:egg" });
check(eggs.length === 1 && eggs[0].location.y === 64 && eggs[0].location.x === 3.5, "egg is set down on top of the ground");
check(!havana.inv.some((i) => i.typeId === "fairy:fairy_egg"), "egg used up in survival");
advance(150);
check(dims.overworld.getEntities({ type: "fairy:egg" }).length === 1 && !fairiesOf("Havana").length, "egg still wiggling after 7 seconds");
check(sounds.includes("block.turtle_egg.crack"), "egg makes cracking sounds");
advance(60);
const [fairy] = fairiesOf("Havana");
check(!dims.overworld.getEntities({ type: "fairy:egg" }).length && !!fairy, "egg hatched into a fairy after about 10 seconds");
const color = fairy.getDynamicProperty("fairy:color"), gender = fairy.getDynamicProperty("fairy:gender");
check(fairy.events.includes(`fairy:color_${color}`) && fairy.events.includes(`fairy:${gender}`) && fairy.nameTag.length > 0,
  `fairy is ${globalThis.__fairy.COLORS[color].name}, a ${gender}, named ${fairy.nameTag}`);
check(havana.messages.some((m) => m.includes("Your egg hatched") && m.includes(fairy.nameTag)), "Havana is told her fairy's name");

// Creative: egg not used up.
jeff.mode = "creative"; jeff.lookAt = { x: 6, y: 63, z: 4 }; jeff.inv.unshift(new ItemStack("fairy:fairy_egg"));
handlers.use({ source: jeff, itemStack: new ItemStack("fairy:fairy_egg") });
check(jeff.inv.filter((i) => i.typeId === "fairy:fairy_egg").length === 2, "egg not used up in creative");
advance(220);
check(fairiesOf("Jeff").length === 1, "Jeff's egg hatched too");

// Follows Havana as she walks, but loosely: never far behind, never glued to her.
let maxGap = 0;
for (let i = 0; i < 200; i++) { havana.location.x += 0.15; advance(1); maxGap = Math.max(maxGap, d2(fairy.location, havana.location)); }
check(maxGap < 9, `fairy keeps up while she walks 30 blocks (never more than ${maxGap.toFixed(1)} blocks behind)`);
// Then she stands still: the fairy settles nearby and hangs around without hugging her.
let still = 0, last = { ...fairy.location }, minGap = 99, maxRest = 0;
for (let i = 0; i < 400; i++) {
  advance(1);
  const l = fairy.location;
  if (Math.hypot(l.x - last.x, l.z - last.z) < 0.01) still++;
  last = { ...l };
  if (i > 150) { minGap = Math.min(minGap, d2(l, havana.location)); maxRest = Math.max(maxRest, d2(l, havana.location)); }
}
const spot = fairy.location;
check(minGap > 1.2 && maxRest < 4.5 && spot.y > 64.8 && spot.y < 66.5,
  `fairy hangs around ${minGap.toFixed(1)}-${maxRest.toFixed(1)} blocks away, ${(spot.y - 64).toFixed(2)} up`);
check(still > 120, `fairy hovers in place part of the time (${still} of 400 ticks)`);
const jf = fairiesOf("Jeff")[0];
check(d2(jf.location, jeff.location) < 5, "Jeff's fairy stays near Jeff, not Havana");
const dustBefore = particles.filter((p) => p.id === "fairy:dust").length;
advance(60);
check(particles.filter((p) => p.id === "fairy:dust").length - dustBefore >= 30, "fairy sprinkles fairy dust as it flies");
const dc = particles.filter((p) => p.id === "fairy:dust").at(-1).color;
check(dc && dc.red >= 0 && dc.green >= 0 && dc.blue >= 0, "dust is tinted");

// Off to the Nether and back.
havana.dimension = dims.nether; havana.location = { x: 100, y: 40, z: 100 };
advance(25);
check(fairy.dimension === dims.nether && d2(fairy.location, havana.location) < 3, "fairy follows her to the Nether");
havana.dimension = dims.overworld; havana.location = { x: 10, y: 64, z: 0 };
advance(25);
check(fairy.dimension === dims.overworld && d2(fairy.location, havana.location) < 4.5, "and back home");

// Tapping the fairy.
const ev = { target: fairy, player: jeff, cancel: false };
handlers.interact(ev); advance(2);
check(ev.cancel && jeff.messages.at(-1).includes("Havana's"), "tapping someone else's fairy says whose it is");
havana.inv.length = 0;
answers.push(0);
handlers.interact({ target: fairy, player: havana, cancel: false }); advance(2); await flush();
check(forms.at(-1).buttons.some((b) => b.includes("goodbye")), "tapping your own fairy opens a menu with goodbye");
check(havana.messages.at(-1).includes("twirl"), "choosing Twirl makes it twirl");

// Night with no house yet.
time = 12990; advance(40);
check(havana.messages.some((m) => m.includes("is sleepy! Put down a Fairy House")), "asks for a Fairy House at bedtime");
const asked = havana.messages.length;
advance(400);
check(havana.messages.length === asked || !havana.messages.slice(asked).some((m) => m.includes("Put down")), "asks only once a night");
check(fairy.getDynamicProperty("fairy:state") === "awake", "without a house the fairy stays with Havana");

// She builds a house 12 blocks away.
const H = { x: 22, y: 64, z: 6 };
dims.overworld.getBlock(H).setPermutation({ type: { id: "fairy:fairy_house" }, states: { "fairy:lit": false } });
handlers.place({ player: havana, block: dims.overworld.getBlock(H) });
check(havana.messages.at(-1).includes("will fly home here"), "placing the house mentions her fairy");
advance(25);
check(fairy.getDynamicProperty("fairy:state") === "flyingHome", "fairy heads home");
check(havana.messages.some((m) => m.includes("flying home")), "Havana is told goodnight");
advance(300);
check(fairy.getDynamicProperty("fairy:state") === "asleep" && fairy.effects.has("invisibility"), "fairy goes inside to sleep");
check(dims.overworld.getBlock(H).permutation.states["fairy:lit"] === true, "house windows light up");
check(d2(fairy.location, { x: H.x + 0.5, z: H.z + 0.5 }) < 0.6, "fairy stays at the house");
havana.location.x = 40; advance(100);
check(d2(fairy.location, { x: H.x + 0.5, z: H.z + 0.5 }) < 0.6, "fairy keeps sleeping when Havana walks away");
check(fairiesOf("Jeff")[0].getDynamicProperty("fairy:state") === "asleep", "Jeff has no house, so his fairy sleeps over in Havana's nearby one");

// Morning.
time = 22990; advance(40);
check(fairy.getDynamicProperty("fairy:state") === "awake" && !fairy.effects.has("invisibility"), "fairy wakes up at dawn");
check(dims.overworld.getBlock(H).permutation.states["fairy:lit"] === false, "house lights go out");
check(havana.messages.some((m) => m.includes("Good morning")), "good morning message");
advance(200);
check(d2(fairy.location, havana.location) < 5, "fairy flies back to Havana");

// Sleeping in a bed: time jumps straight to morning.
havana.location = { x: 20, y: 64, z: 0 };
day++; time = 13500; advance(400);
check(fairy.getDynamicProperty("fairy:state") === "asleep", "asleep again the next night");
time = 0; day++; advance(25);
check(fairy.getDynamicProperty("fairy:state") === "awake", "wakes when everyone sleeps through the night");

// House broken while asleep.
time = 13500; advance(400);
dims.overworld.getBlock(H).setPermutation({ type: { id: "minecraft:air" } });
handlers.break({ player: havana, block: dims.overworld.getBlock(H), brokenBlockPermutation: { type: { id: "fairy:fairy_house" } } });
advance(5); await flush(); advance(25); // she closes the question without answering
check(fairy.getDynamicProperty("fairy:state") === "awake" && !fairy.effects.has("invisibility"), "fairy wakes up if the house is broken");
check(!JSON.parse(wdyn.get("fairy:houses")).length, "broken house is forgotten");

// Lots of hatches: every color (including rainbow) and both girls and boys show up.
const seen = new Set(), genders = new Set();
for (let i = 0; i < 400; i++) {
  const e = dims.overworld.spawnEntity("fairy:egg", { x: 50, y: 64, z: 50 });
  e.setDynamicProperty("fairy:owner", "Jeff");
  globalThis.__fairy.hatch(e);
}
for (const f of fairiesOf("Jeff")) { seen.add(f.getDynamicProperty("fairy:color")); genders.add(f.getDynamicProperty("fairy:gender")); }
check(seen.size === 9 && genders.size === 2, `all 9 colors and both genders appear (${[...seen].sort().join(",")})`);
check(jeff.messages.some((m) => m.includes("RAINBOW") || m.includes("§cR§6A")), "rainbow fairies get a special message");
advance(60);
check(true, `${fairiesOf("Jeff").length} fairies flying around Jeff without errors`);

// Saying goodbye: Havana hatches a few more, then says goodbye to one, changes her mind once, then all.
for (let i = 0; i < 3; i++) {
  const e = dims.overworld.spawnEntity("fairy:egg", { x: 21, y: 64, z: 1 });
  e.setDynamicProperty("fairy:owner", "Havana");
  globalThis.__fairy.hatch(e);
}
advance(25);
check(fairiesOf("Havana").length === 4, "Havana has 4 fairies");
const one = fairiesOf("Havana")[1];
answers.push(1, 1); // "Say goodbye to X", then "No, stay with me!"
handlers.interact({ target: one, player: havana, cancel: false }); advance(2); await flush(); await flush();
check(fairiesOf("Havana").length === 4 && havana.messages.at(-1).includes("happy to stay"), "saying No keeps the fairy");
answers.push(1, 0); // goodbye to this one, yes
handlers.interact({ target: one, player: havana, cancel: false }); advance(2); await flush(); await flush();
check(one.getDynamicProperty("fairy:state") === "leaving", "the fairy starts flying away");
const y0 = one.location.y; advance(30);
check(one.location.y > y0 + 1.5, "it spirals up into the sky");
advance(30);
check(!one.isValid() && fairiesOf("Havana").length === 3, "then it's gone, and the others stay");
const rest = fairiesOf("Havana");
answers.push(2, 0); // goodbye to all 3, yes
handlers.interact({ target: rest[0], player: havana, cancel: false }); advance(2); await flush(); await flush();
check(forms.at(-2).buttons[2].includes("all 3"), "menu offers goodbye to all 3");
advance(120);
check(fairiesOf("Havana").length === 0, "all of Havana's fairies said goodbye");
check(fairiesOf("Jeff").length > 0, "Jeff's fairies are still there");
answers.push(3); // Never mind
handlers.interact({ target: fairiesOf("Jeff")[0], player: jeff, cancel: false }); advance(2); await flush();
check(fairiesOf("Jeff").length > 0, "Never mind does nothing");

// Breaking the house while fairies sleep inside: asked whether to say goodbye.
const H2 = { x: 30, y: 64, z: 0 };
havana.location = { x: 28, y: 64, z: 0 };
for (let i = 0; i < 2; i++) {
  const e = dims.overworld.spawnEntity("fairy:egg", { x: 29, y: 64, z: 1 });
  e.setDynamicProperty("fairy:owner", "Havana");
  globalThis.__fairy.hatch(e);
}
dims.overworld.getBlock(H2).setPermutation({ type: { id: "fairy:fairy_house" }, states: {} });
handlers.place({ player: havana, block: dims.overworld.getBlock(H2) });
day++; time = 13500; advance(400);
check(fairiesOf("Havana").every((f) => f.getDynamicProperty("fairy:state") === "asleep"), "both new fairies asleep in the new house");
const breakHouse = () => {
  dims.overworld.getBlock(H2).setPermutation({ type: { id: "minecraft:air" } });
  handlers.break({ player: havana, block: dims.overworld.getBlock(H2), brokenBlockPermutation: { type: { id: "fairy:fairy_house" } } });
};
answers.push(1); // No!
breakHouse(); advance(5); await flush(); advance(25);
check(forms.at(-1).b.includes("sleeping in this house") && fairiesOf("Havana").every((f) => f.getDynamicProperty("fairy:state") === "awake" && !f.effects.has("invisibility")),
  "breaking the house asks first; No wakes them up");
check(!havana.messages.some((m) => m.includes("Fairy House is gone")), "no confusing extra message while she decides");
dims.overworld.getBlock(H2).setPermutation({ type: { id: "fairy:fairy_house" }, states: {} });
handlers.place({ player: havana, block: dims.overworld.getBlock(H2) });
advance(300);
answers.push(0); // Yes, goodbye
breakHouse(); advance(5); await flush(); advance(120);
check(fairiesOf("Havana").length === 0, "Yes: they fly away to Fairy Land");
// Breaking a house with nobody inside asks nothing.
const before2 = forms.length;
dims.overworld.getBlock(H2).setPermutation({ type: { id: "fairy:fairy_house" }, states: {} });
handlers.place({ player: havana, block: dims.overworld.getBlock(H2) });
breakHouse(); advance(5); await flush();
check(forms.length === before2, "empty house breaks without a question");

// ---------- Fairy light ----------
const lightsNow = () => [...dims.overworld.blocks.entries()].filter(([k, b]) => b.id.includes("light_block") && Math.abs(Number(k.split(",")[0]) - havana.location.x) < 12);
havana.location = { x: 100, y: 64, z: 100 };
{
  const e = dims.overworld.spawnEntity("fairy:egg", { x: 101, y: 64, z: 101 });
  e.setDynamicProperty("fairy:owner", "Havana");
  globalThis.__fairy.hatch(e);
}
day++; time = 3000; advance(80);
const glow = fairiesOf("Havana")[0];
check(lightsNow().length === 0, "no fairy light outside in the daytime");
// A cave: stone ceiling over a big area.
for (let x = 85; x <= 115; x++) for (let z = 85; z <= 115; z++) dims.overworld.blocks.set(`${x},70,${z}`, { id: "minecraft:stone", states: {} });
advance(80);
check(lightsNow().length === 1, `fairy light turns on in a cave (${lightsNow().length} light)`);
const lk = lightsNow()[0]?.[0].split(",").map(Number);
check(lk && Math.hypot(lk[0] + 0.5 - glow.location.x, lk[2] + 0.5 - glow.location.z) < 1.5, "the light is where the fairy is");
check(havana.actionbar.some((m) => m.includes("glows to light the way")), "Havana is told her fairy is glowing");
let maxLights = 0;
for (let i = 0; i < 300; i++) { advance(1); maxLights = Math.max(maxLights, lightsNow().length); }
check(maxLights === 1, "the light moves with the fairy (never leaves extra lights behind)");
// A torch nearby: no need for fairy light.
dims.overworld.blocks.set("102,64,102", { id: "minecraft:torch", states: {} });
advance(80);
check(lightsNow().length === 0, "light turns off near a torch");
dims.overworld.blocks.delete("102,64,102");
advance(80);
check(lightsNow().length === 1, "and back on when the torch is gone");
// A torch in the next room, behind a stone wall: it doesn't light this room, so the fairy keeps glowing.
for (let y = 64; y <= 69; y++) for (let z = 85; z <= 115; z++) dims.overworld.blocks.set(`103,${y},${z}`, { id: "minecraft:stone", states: {} });
dims.overworld.blocks.set("104,64,100", { id: "minecraft:torch", states: {} });
advance(80);
check(lightsNow().length === 1, "a torch behind a wall doesn't turn the fairy light off");
// Walk into the lit room (through a doorway) and back.
havana.location = { x: 105, y: 64, z: 100 }; advance(60);
check(lightsNow().length === 0, "in the lit room the fairy light turns off");
havana.location = { x: 100, y: 64, z: 100 };
let onAfter = -1;
for (let i = 1; i <= 60; i++) { advance(1); if (onAfter < 0 && lightsNow().length === 1) onAfter = i; }
check(onAfter > 0 && onAfter <= 20, `back in the dark room it lights up again in ${(onAfter / 20).toFixed(1)} s`);
for (let y = 64; y <= 69; y++) for (let z = 85; z <= 115; z++) dims.overworld.blocks.delete(`103,${y},${z}`);
dims.overworld.blocks.delete("104,64,100");
advance(40);
// Leave the cave in daytime.
for (let x = 85; x <= 115; x++) for (let z = 85; z <= 115; z++) dims.overworld.blocks.delete(`${x},70,${z}`);
advance(80);
check(lightsNow().length === 0, "light off again outside in the sun");
// Night outside (no house nearby): the fairy stays up and glows.
time = 13200; advance(100);
check(glow.getDynamicProperty("fairy:state") === "awake" && lightsNow().length === 1, "glows at night when there's no house to sleep in");
// Several fairies: only two glow.
for (let i = 0; i < 3; i++) {
  const e = dims.overworld.spawnEntity("fairy:egg", { x: 99, y: 64, z: 101 });
  e.setDynamicProperty("fairy:owner", "Havana");
  globalThis.__fairy.hatch(e);
}
advance(100);
check(lightsNow().length === 2, `with 4 fairies only 2 lights (${lightsNow().length})`);
// Saying goodbye removes the lights.
answers.push(2, 0);
handlers.interact({ target: glow, player: havana, cancel: false }); advance(2); await flush(); await flush();
advance(150);
check(lightsNow().length === 0 && fairiesOf("Havana").length === 0, "lights go away with the fairies");

// ---------- Monster shoo ----------
{
  const e = dims.overworld.spawnEntity("fairy:egg", { x: 101, y: 64, z: 101 });
  e.setDynamicProperty("fairy:owner", "Havana");
  globalThis.__fairy.hatch(e);
}
time = 3000; advance(100);
const zombie = dims.overworld.spawnEntity("minecraft:zombie", { x: 103, y: 64, z: 100 }); zombie.families = ["monster", "zombie"];
const creeper = dims.overworld.spawnEntity("minecraft:creeper", { x: 100, y: 64, z: 97 }); creeper.families = ["monster", "creeper"];
const villager = dims.overworld.spawnEntity("minecraft:villager_v2", { x: 98, y: 64, z: 100 }); villager.families = ["villager", "mob"];
const far = dims.overworld.spawnEntity("minecraft:skeleton", { x: 120, y: 64, z: 100 }); far.families = ["monster"];
advance(20);
check(zombie.knocked && creeper.knocked, "zombie and creeper near Havana get shooed");
check(Math.hypot(zombie.location.x - 100, zombie.location.z - 100) > 5 && Math.hypot(creeper.location.x - 100, creeper.location.z - 100) > 5, "they get bounced away from her");
check(!villager.knocked && !far.knocked, "villagers and faraway monsters are left alone");
check(havana.actionbar.some((m) => m.includes("shooed away a zombie")), "Havana sees who got shooed");
const k = zombie.knocked; advance(10);
check(zombie.knocked === k, "a monster that's already far away isn't shooed again");
zombie.location = { x: 101, y: 64, z: 100 }; advance(40);
check(zombie.knocked > k, "but it gets shooed again if it comes back");


console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
})();
