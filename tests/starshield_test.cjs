// Runs the Star Shield script against a small fake Minecraft world and checks the story:
// join -> Lightstick + Concert Stage -> Lightstick brings Sora, Dalia and Yuna -> wrong gift / right gifts make
// friends (tamed, following) -> hello and menu -> night brings Grumbles (never more than the cap) -> a girl's hit
// knocks one back, a defeated one poofs -> Concert Stage show (perform, then back to following) raises a Star
// Shield -> Grumbles inside pop, no new ones inside -> morning clears Grumbles and the shield fades ->
// a missing girl comes back still a friend, duplicates are tidied, far-away friends blink back.
// Usage: node tests/starshield_test.cjs addons/StarShield_BP/scripts/main.js
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8").replace(/^import .*$/gm, "") +
  "\nglobalThis.__ss = { shields, SHOW_TICKS, GRUMBLE_CAP };";

let seed = 4242;
Math.random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

let tick = 0, abs = 1000;
const subs = {};
const sub = (name) => ({ subscribe: (fn) => { (subs[name] ||= []).push(fn); } });
const emit = (name, ev) => (subs[name] || []).forEach((f) => f(ev));
const timers = [];
let nextId = 1;
const system = {
  get currentTick() { return tick; },
  runInterval: (fn, n) => { const id = nextId++; timers.push({ id, fn, every: n || 1, at: tick + (n || 1) }); return id; },
  runTimeout: (fn, n) => { const id = nextId++; timers.push({ id, fn, once: true, at: tick + (n || 1) }); return id; },
  run: (fn) => system.runTimeout(fn, 1),
  clearRun: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  afterEvents: { scriptEventReceive: sub("scriptEvent") },
};
class ItemStack { constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; } }
const answers = [];
class ActionFormData {
  constructor() { this.buttons = []; }
  title() { return this; }
  button(l) { this.buttons.push(l); return this; }
  show() { const a = answers.shift(); return Promise.resolve(a === undefined ? { canceled: true } : { canceled: false, selection: a }); }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

const sounds = [], dropped = [];
function makeDim(id) {
  const blocks = new Map();
  const K = (l) => `${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)}`;
  const dim = {
    id: `minecraft:${id}`, entities: [],
    setBlock(l, typeId, states = {}) { blocks.set(K(l), { id: typeId, states }); },
    getBlock(l) {
      const b = blocks.get(K(l));
      const typeId = b?.id ?? (l.y < 64 ? "minecraft:grass_block" : "minecraft:air");
      return { typeId, dimension: dim, location: { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) },
        permutation: { type: { id: typeId }, getState: (k) => b?.states?.[k] } };
    },
    spawnEntity(type, loc) {
      const props = new Map();
      const e = {
        typeId: type, id: String(nextId++), location: { ...loc }, dimension: dim, events: [], nameTag: "", valid: true,
        families: type === "starshield:grumble" ? ["grumble", "monster"] : type === "minecraft:zombie" ? ["monster"] : [],
        tamedTo: null, knocks: 0,
        isValid() { return this.valid; },
        getDynamicProperty: (k) => props.get(k),
        setDynamicProperty: (k, v) => (v === undefined ? props.delete(k) : props.set(k, v)),
        triggerEvent(ev) { this.events.push(ev); },
        lastMode() { return [...this.events].reverse().find((x) => /visit|befriend|stay|perform$/.test(x)); },
        getComponent(name) {
          if (name === "minecraft:tameable") return { get isTamed() { return !!e.tamedTo; }, tame: (p) => { e.tamedTo = p.name; return true; } };
          return undefined;
        },
        applyKnockback() { this.knocks++; },
        teleport(p, opts = {}) {
          this.location = { ...p };
          if (opts.dimension && opts.dimension !== this.dimension) {
            this.dimension.entities.splice(this.dimension.entities.indexOf(this), 1);
            opts.dimension.entities.push(this);
            this.dimension = opts.dimension;
          }
        },
        remove() { this.valid = false; const i = this.dimension.entities.indexOf(this); if (i >= 0) this.dimension.entities.splice(i, 1); },
      };
      dim.entities.push(e);
      return e;
    },
    getEntities(q = {}) {
      return dim.entities.filter((e) => (!q.type || e.typeId === q.type) &&
        (!q.families || q.families.some((f) => e.families.includes(f))) &&
        (!q.location || Math.hypot(e.location.x - q.location.x, e.location.y - q.location.y, e.location.z - q.location.z) <= q.maxDistance));
    },
    spawnParticle() {},
    spawnItem(item, loc) { dropped.push({ id: item.typeId, loc }); },
    playSound(id) { sounds.push(id); },
  };
  return dim;
}
const dims = { overworld: makeDim("overworld"), nether: makeDim("nether"), the_end: makeDim("the_end") };
const ow = dims.overworld;

const players = [];
function makePlayer(name, x) {
  const inv = [];
  const props = new Map();
  const p = {
    name, typeId: "minecraft:player", location: { x, y: 64, z: 0 }, dimension: ow, messages: [], notes: [], inv,
    mode: "survival", selectedSlotIndex: 0, isSneaking: false,
    sendMessage(m) { this.messages.push(m); },
    getGameMode() { return this.mode; },
    getDynamicProperty: (k) => props.get(k), setDynamicProperty: (k, v) => props.set(k, v),
    getViewDirection: () => ({ x: 0, y: 0, z: 1 }),
    getComponent: () => ({ container: {
      addItem: (it) => { inv.push(it); },
      getItem: (i) => inv[i],
      setItem: (i, it) => { if (it) inv[i] = it; else inv.splice(i, 1); },
    } }),
  };
  p.onScreenDisplay = { setActionBar: (m) => p.notes.push(m), setTitle: () => { throw new Error("no big titles (DESIGN.md)"); } };
  players.push(p);
  return p;
}

const world = {
  afterEvents: { playerSpawn: sub("spawn"), itemUse: sub("itemUse"), entityHurt: sub("hurt"), entityDie: sub("die"), playerBreakBlock: sub("break") },
  beforeEvents: { playerInteractWithEntity: sub("tapEntity"), playerInteractWithBlock: sub("tapBlock") },
  getAllPlayers: () => players,
  getDimension: (d) => dims[d.replace("minecraft:", "")],
  getTimeOfDay: () => abs % 24000,
  getAbsoluteTime: () => abs,
  getDay: () => Math.floor(abs / 24000),
  _props: new Map(),
  getDynamicProperty(k) { return this._props.get(k); },
  setDynamicProperty(k, v) { if (v === undefined) this._props.delete(k); else this._props.set(k, v); },
};

new Function("world", "system", "ItemStack", "ActionFormData", src)(world, system, ItemStack, ActionFormData);
const SS = globalThis.__ss;

function run(n) {
  for (let i = 0; i < n; i++) {
    tick++; abs++;
    for (const t of [...timers]) {
      if (t.at > tick || !timers.includes(t)) continue;
      t.fn();
      if (t.once) timers.splice(timers.indexOf(t), 1); else t.at = tick + t.every;
    }
  }
}
let fails = 0;
function check(cond, msg) { console.log((cond ? "  ok   " : "  FAIL ") + msg); if (!cond) fails++; }
const idols = () => ow.entities.filter((e) => e.typeId === "starshield:idol");
const girl = (g) => idols().find((e) => e.getDynamicProperty("starshield:girl") === g);
const grumbles = (d = ow) => d.entities.filter((e) => e.typeId === "starshield:grumble");
function tapEntity(p, target, item) {
  const ev = { player: p, target, itemStack: item ? new ItemStack(item) : undefined, cancel: false };
  emit("tapEntity", ev);
  run(2);
  return ev;
}
function hold(p, id) { p.inv.splice(0, p.inv.length, new ItemStack(id, 5)); p.selectedSlotIndex = 0; }

(async () => {
  console.log("Joining");
  const hav = makePlayer("Havana", 0);
  emit("spawn", { player: hav, initialSpawn: true });
  run(140);
  check(hav.inv.some((i) => i.typeId === "starshield:lightstick") && hav.inv.some((i) => i.typeId === "starshield:concert_stage"), "gets a Lightstick and a Concert Stage");
  emit("spawn", { player: hav, initialSpawn: true });
  run(140);
  check(hav.inv.filter((i) => i.typeId === "starshield:lightstick").length === 1, "only once");

  console.log("Night before meeting anyone: no Grumbles");
  abs = 14000; run(400);
  check(grumbles().length === 0, "Grumbles only come once you've met Star Shield");
  abs = 25000;

  console.log("The Lightstick brings Star Shield");
  emit("itemUse", { source: hav, itemStack: new ItemStack("starshield:lightstick") });
  run(2);
  check(idols().length === 3, "three girls arrive");
  check([0, 1, 2].every((g) => girl(g)?.events.includes(`starshield:girl_${g}`)), "each is a different girl (variant event)");
  check(["Sora", "Dalia", "Yuna"].every((n, g) => girl(g).nameTag === n), "named Sora, Dalia and Yuna");
  check(idols().every((e) => e.lastMode() === "starshield:visit" && !e.tamedTo), "visiting, not following yet");
  check(hav.messages.some((m) => /apples/.test(m) && /cookies/.test(m) && /flowers/.test(m)), "told each girl's favorite gift");
  check(idols().every((e) => Math.hypot(e.location.x - hav.location.x, e.location.z - hav.location.z) < 6), "arrive close by");
  emit("itemUse", { source: hav, itemStack: new ItemStack("starshield:lightstick") });
  run(30);
  emit("itemUse", { source: hav, itemStack: new ItemStack("starshield:lightstick") });
  run(2);
  check(idols().length === 3, "using it again doesn't bring more");

  console.log("Gifts");
  hold(hav, "minecraft:cookie");
  let ev = tapEntity(hav, girl(0), "minecraft:cookie");
  check(ev.cancel && girl(0).getDynamicProperty("starshield:friend") !== true, "Sora isn't won over by a cookie");
  check(/apple/.test(hav.notes.at(-1)), "...and says what she'd like");
  check(hav.inv[0].amount === 5, "the cookie isn't used up");
  hold(hav, "minecraft:apple");
  run(10);
  tapEntity(hav, girl(0), "minecraft:apple");
  check(girl(0).getDynamicProperty("starshield:friend") === true && girl(0).tamedTo === "Havana", "an apple makes Sora a friend (tamed)");
  check(girl(0).lastMode() === "starshield:befriend", "Sora follows now");
  check(hav.inv[0].amount === 4, "the apple is used up");
  hold(hav, "minecraft:cookie"); run(10);
  tapEntity(hav, girl(1), "minecraft:cookie");
  hold(hav, "minecraft:cornflower"); run(10);
  tapEntity(hav, girl(2), "minecraft:cornflower");
  check(idols().every((e) => e.getDynamicProperty("starshield:friend") === true), "Dalia (cookie) and Yuna (flower) too");
  check(hav.messages.some((m) => /All of Star Shield/.test(m)), "a message when all three are friends");
  const before = hav.messages.length;
  hold(hav, "minecraft:apple"); run(10);
  tapEntity(hav, girl(0), "minecraft:apple");
  check(hav.messages.length === before, "another treat: just hearts, no messages");

  console.log("Hello and menu");
  run(10);
  tapEntity(hav, girl(1));
  check(/Dalia:/.test(hav.notes.at(-1)), "tap: she says hi (small note)");
  check(girl(1).events.includes("starshield:wave_start"), "...and waves");
  const sam = makePlayer("Sam", 3);
  tapEntity(sam, girl(2));
  check(/Havana's friend/.test(sam.notes.at(-1)), "someone else's tap: a polite hello");
  hav.isSneaking = true; answers.push(0);
  run(10);
  tapEntity(hav, girl(2));
  await flush(); run(2);
  check(girl(2).getDynamicProperty("starshield:mode") === "stay" && girl(2).lastMode() === "starshield:stay", "menu: wait here");
  answers.push(0); run(10);
  tapEntity(hav, girl(2));
  await flush(); run(2);
  check(girl(2).lastMode() === "starshield:befriend", "menu: come with me");
  hav.isSneaking = false;
  players.splice(players.indexOf(sam), 1);

  console.log("Night: Grumbles");
  abs = 24000 + 14000;
  run(2400);
  const g = grumbles();
  check(g.length > 0 && g.length <= SS.GRUMBLE_CAP, `Grumbles come out (${g.length}, cap ${SS.GRUMBLE_CAP})`);
  check(g.every((x) => { const d = Math.hypot(x.location.x - hav.location.x, x.location.z - hav.location.z); return d >= 11.5 && d <= 18.5; }), "12-18 blocks away");
  emit("hurt", { hurtEntity: g[0], damageSource: { damagingEntity: girl(0) } });
  check(g[0].knocks === 1, "a girl's hit knocks a Grumble back");
  const drops = dropped.length;
  for (let i = 0; i < 6; i++) emit("die", { deadEntity: { typeId: "starshield:grumble", dimension: ow, location: { x: 5, y: 64, z: 5 } } });
  check(dropped.length > drops && dropped.slice(drops).every((d) => d.id === "starshield:star_shard"), "defeated Grumbles sometimes drop Star Shards");

  console.log("Concert");
  ow.setBlock({ x: 2, y: 64, z: -2 }, "starshield:concert_stage", { "minecraft:cardinal_direction": "south" });
  const stage = ow.getBlock({ x: 2, y: 64, z: -2 });
  ev = { player: hav, block: stage, cancel: false };
  emit("tapBlock", ev);
  run(2);
  check(ev.cancel, "tapping the stage starts a show");
  check(idols().every((e) => e.lastMode() === "starshield:perform"), "all three perform");
  check(idols().every((e) => Math.hypot(e.location.x - 2.5, e.location.z + 1.5) < 2), "standing on the stage");
  check(sounds.includes("note.harp"), "music plays");
  emit("tapBlock", { player: hav, block: stage, cancel: false });
  run(30);
  emit("tapBlock", { player: hav, block: stage, cancel: false });
  run(SS.SHOW_TICKS);
  check(idols().every((e) => e.lastMode() === "starshield:befriend"), "after the show they follow again");
  check(SS.shields().length === 1, "a Star Shield goes up");
  const zombie = ow.spawnEntity("minecraft:zombie", { x: 8, y: 64, z: 4 });
  const inside = ow.spawnEntity("starshield:grumble", { x: 6, y: 64, z: 6 });
  run(25);
  check(!inside.valid, "a Grumble inside the shield pops");
  check(zombie.knocks > 0, "monsters inside get bounced out");
  for (const x of grumbles()) x.remove();
  run(2400);
  check(grumbles().every((x) => Math.hypot(x.location.x - 2.5, x.location.z + 1.5) > 24), "no new Grumbles inside the shield");

  console.log("Morning");
  abs = 48000 + 1000;
  run(60);
  check(grumbles().length === 0, "Grumbles poof at sunrise");
  check(SS.shields().length === 0, "the shield fades in the morning");
  abs = 48000 + 14000;
  emit("tapBlock", { player: hav, block: stage, cancel: false });
  run(SS.SHOW_TICKS + 5);
  check(SS.shields()[0]?.until === 48000 + 23000, "a new show covers tonight");
  emit("break", { block: stage, brokenBlockPermutation: { type: { id: "starshield:concert_stage" } } });
  check(SS.shields().length === 0, "breaking the stage takes its shield away");

  console.log("Calling them back");
  girl(1).remove();
  emit("itemUse", { source: hav, itemStack: new ItemStack("starshield:lightstick") });
  run(2);
  check(girl(1) && girl(1).getDynamicProperty("starshield:friend") === true && girl(1).tamedTo === "Havana", "Dalia comes back, still a friend");
  // Her old self turns up again (was just unloaded): the newer one stays.
  const old = ow.spawnEntity("starshield:idol", { x: 50, y: 64, z: 50 });
  old.setDynamicProperty("starshield:girl", 1); old.setDynamicProperty("starshield:owner", "Havana");
  old.setDynamicProperty("starshield:friend", true); old.setDynamicProperty("starshield:born", 10);
  run(110);
  check(idols().length === 3 && !old.valid, "duplicates are tidied up");
  girl(0).location = { x: 200, y: 64, z: 0 };
  run(110);
  check(Math.hypot(girl(0).location.x - hav.location.x, girl(0).location.z) < 8, "a friend left far behind blinks back");

  console.log(fails ? `\n${fails} FAILED` : "\nAll good!");
  process.exit(fails ? 1 : 0);
})();
