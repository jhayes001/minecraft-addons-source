// Runs the Star Shield script against a small fake Minecraft world and checks the story:
// join -> Lightstick + Concert Stage -> Lightstick brings Sora, Dalia and Yuna -> wrong gift / right gifts make
// friends (tamed, following) -> hello and menu -> night brings Grumbles (never more than the cap) -> a girl's hit
// knocks one back, a defeated one poofs -> Concert Stage show (perform, then back to following) raises a Star
// Shield -> Grumbles inside pop, no new ones inside -> morning clears Grumbles and the shield fades ->
// a missing girl comes back still a friend, duplicates are tidied, far-away friends blink back.
// Usage: node tests/starshield_test.cjs addons/StarShield_BP/scripts/main.js
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8").replace(/^import .*$/gm, "") +
  "\nglobalThis.__ss = { shields, SHOW_TICKS, GRUMBLE_CAP, episode, at, CONCERT_TICKS, getSimon: () => simon, RIDDLES };";

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
  runJob: (gen) => { for (const _ of gen); },
  runTimeout: (fn, n) => { const id = nextId++; timers.push({ id, fn, once: true, at: tick + (n || 1) }); return id; },
  run: (fn) => system.runTimeout(fn, 1),
  clearRun: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  afterEvents: { scriptEventReceive: sub("scriptEvent") },
};
class BlockPermutation {
  constructor(id, states) { this.type = { id }; this.states = states || {}; }
  static resolve(id, states) { if (!id.includes(":")) throw new Error("bad"); return new BlockPermutation(id, states); }
}
class ItemStack { constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; } }
const answers = [], forms = [];
class ActionFormData {
  constructor() { this.buttons = []; }
  title() { return this; }
  button(l) { this.buttons.push(l); return this; }
  body(b) { this.b = b; return this; }
  show() {
    forms.push(this);
    let a = answers.shift();
    if (typeof a === "function") a = a(this);
    return Promise.resolve(a === undefined ? { canceled: true } : { canceled: false, selection: a });
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

const sounds = [], dropped = [], particlesSeen = [], bolts = [];
function makeDim(id) {
  const blocks = new Map();
  const K = (l) => `${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)}`;
  const dim = {
    id: `minecraft:${id}`, entities: [],
    setBlock(l, typeId, states = {}) { blocks.set(K(l), { id: typeId, states }); },
    ground: 64, heightRange: { min: -64, max: 320 },
    getBlock(l) {
      if (l.y < dim.heightRange.min) return undefined;            // below the bottom of the world
      const b = blocks.get(K(l));
      const typeId = b?.id ?? (l.y < dim.ground ? "minecraft:grass_block" : "minecraft:air");
      return { typeId, dimension: dim, location: { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) },
        permutation: { type: { id: typeId }, getState: (k) => b?.states?.[k] },
        setPermutation: (p) => blocks.set(K(l), { id: p.type.id, states: p.states }) };
    },
    spawnEntity(type, loc) {
      if (type === "minecraft:lightning_bolt") {           // like the game: it can light a fire where it strikes
        bolts.push({ ...loc, near: dim.entities.filter((x) => Math.hypot(x.location.x - loc.x, x.location.z - loc.z) < 6).length });
        dim.setBlock({ x: loc.x, y: loc.y, z: loc.z }, "minecraft:fire");
      }
      const props = new Map();
      const e = {
        typeId: type, id: String(nextId++), location: { ...loc }, dimension: dim, events: [], nameTag: "", valid: true,
        families: type === "starshield:grumble" ? ["grumble", "monster"] : type === "minecraft:zombie" ? ["monster"] : [],
        tamedTo: null, knocks: 0,
        isValid() { return this.valid; },
        getDynamicProperty: (k) => props.get(k),
        setDynamicProperty: (k, v) => (v === undefined ? props.delete(k) : props.set(k, v)),
        triggerEvent(ev) { this.events.push(ev); if (ev === "starshield:make_king") this.hp = 240; if (ev === "starshield:make_mini_king" || ev === "starshield:make_big") this.hp = 30; },
        lastMode() { return [...this.events].reverse().find((x) => /visit|befriend|stay|perform$/.test(x)); },
        getComponent(name) {
          if (name === "minecraft:tameable") return { get isTamed() { return !!e.tamedTo; }, tame: (p) => { e.tamedTo = p.name; return true; } };
          if (name === "minecraft:health") return { get currentValue() { return e.hp; }, setCurrentValue: (v) => { e.hp = v; return true; } };
          return undefined;
        },
        applyKnockback() { this.knocks++; },
        hp: type === "starshield:grumble" ? 8 : 20, damage: [],
        applyDamage(n, o) { this.damage.push(n); this.hp -= n; return true; },
        applyImpulse(v) { this.impulse = v; },
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
    spawnParticle(id) { particlesSeen.push(id); },
    spawnItem(item, loc) { dropped.push({ id: item.typeId, loc }); },
    playSound(id) { sounds.push(id); },
    commands: [], weather: [],
    setWeather(w) { this.weather.push(w); },
    runCommand(c) { this.commands.push(c); },
    blocks,
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
    getViewDirection() { return this.view || { x: 0, y: 0, z: 1 }; },
    getHeadLocation() { return { x: this.location.x, y: this.location.y + 1.6, z: this.location.z }; },
    isOnGround: true, damage: [], effects: [],
    applyDamage(n) { this.damage.push(n); return true; },
    addEffect(id) { this.effects.push(id); },
    applyKnockback() {},
    playSound() {},
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
  afterEvents: { playerSpawn: sub("spawn"), itemUse: sub("itemUse"), entityHurt: sub("hurt"), entityDie: sub("die"), playerBreakBlock: sub("break"), entityHitBlock: sub("hitBlock") },
  beforeEvents: { playerInteractWithEntity: sub("tapEntity"), playerInteractWithBlock: sub("tapBlock"), playerBreakBlock: sub("breakBefore") },
  getAllPlayers: () => players,
  getDimension: (d) => dims[d.replace("minecraft:", "")],
  getTimeOfDay: () => abs % 24000,
  getAbsoluteTime: () => abs,
  getDay: () => Math.floor(abs / 24000),
  setTimeOfDay: (t) => { abs = Math.floor(abs / 24000) * 24000 + t; },
  structureManager: {
    saved: new Map(), placed: [],
    // Keeps a real copy of the blocks, like the game, so putting the land back really restores it.
    createFromWorld(id, dim, min, max) {
      const copy = [];
      for (let x = min.x; x <= max.x; x++) for (let y = min.y; y <= max.y; y++) for (let z = min.z; z <= max.z; z++) {
        copy.push([`${x},${y},${z}`, dim.blocks.get(`${x},${y},${z}`)]);
      }
      this.saved.set(id, { min, max, copy });
    },
    place(id, dim) {
      const t = this.saved.get(id);
      if (!t) throw new Error("no structure");
      for (const [k, b] of t.copy) { if (b) dim.blocks.set(k, b); else dim.blocks.delete(k); }
      this.placed.push(id);
    },
    delete(id) { this.saved.delete(id); },
  },
  _props: new Map(),
  getDynamicProperty(k) { return this._props.get(k); },
  setDynamicProperty(k, v) { if (v === undefined) this._props.delete(k); else this._props.set(k, v); },
};

new Function("world", "system", "ItemStack", "ActionFormData", "BlockPermutation", src)(world, system, ItemStack, ActionFormData, BlockPermutation);
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
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const center2 = (p) => ({ x: p.x + 0.5, y: p.y, z: p.z + 0.5 });
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
  check(particlesSeen.includes("starshield:confetti"), "a beaten Grumble bursts into confetti");

  console.log("Concert");
  ow.setBlock({ x: 2, y: 64, z: -2 }, "starshield:concert_stage", { "minecraft:cardinal_direction": "south" });
  const stage = ow.getBlock({ x: 2, y: 64, z: -2 });
  ev = { player: hav, block: stage, cancel: false };
  emit("tapBlock", ev);
  run(2);
  check(ev.cancel, "tapping the stage starts a show");
  check(idols().every((e) => e.lastMode() === "starshield:perform"), "all three perform");
  check(idols().every((e) => Math.hypot(e.location.x - 2.5, e.location.z + 1.5) < 2), "standing on the stage");
  check(["note.bd", "note.bit"].every((x) => sounds.includes(x)), "music plays (the drop: kick and synth lead)");
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


  console.log("\nEpisode 1: The Missing Stars");
  for (const x of grumbles()) x.remove();
  abs = 72000 + 2000;
  hav.location = { x: 0, y: 64, z: 0 };
  emit("spawn", { player: hav, initialSpawn: true });
  run(180);
  check(hav.getDynamicProperty("starshield:got_ticket") === true, "gets an Adventure Ticket (once)");
  hav.messages.length = 0;
  emit("itemUse", { source: hav, itemStack: new ItemStack("starshield:ticket") });
  run(30);
  let E = SS.episode();
  check(E && E.step === "ready", "the ticket builds the adventure");
  check(world.structureManager.saved.size === 4, "the land under all 4 places is saved first");
  check(ow.commands.some((c) => /tickingarea add/.test(c)), "the area stays loaded");
  const B = (pl, du, dy, dv) => ow.getBlock(SS.at(E, pl, du, dy, dv)).typeId;
  if (process.env.DUMP_MAP) fs.writeFileSync(process.env.DUMP_MAP, JSON.stringify({ f: E.f, r: E.r, start: E.start, sites: E.sites, blocks: [...ow.blocks].map(([k, b]) => [k, b.id]) }));
  check(/black_concrete/.test(B("stage", 0, 0, 2)) && /purple_concrete/.test(B("stage", 0, 1, 5)), "the stage is built");
  check(/log/.test(B("tree", 0, 20, 0)) && /leaves/.test(B("tree", 0, 28, 0)), "a giant tree (trunk 24 high, leafy top)");
  const stairs = [[0, -3], [1, -3], [2, -3], [3, -3], [3, -2], [3, -1], [3, 0], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [0, 3], [-1, 3], [-2, 3], [-3, 3]];
  check(stairs.every(([du, dv], k) => /planks/.test(B("tree", du, k, dv)) && B("tree", du, k + 1, dv) === "minecraft:air"), "a staircase of 16 steps winds up around the trunk");
  check(/planks/.test(B("tree", -4, 16, 3)) && /fence/.test(B("tree", 0, 17, 6)), "...to a treehouse deck with a fence");
  check(/tinted_glass/.test(B("tree", 1, 17, -5)) && B("tree", 0, 17, -5) === "minecraft:air", "Sora's cage is up on the deck");
  check(B("cave", 2, -4, -6) === "minecraft:air" && B("cave", 3, -4, 6) === "minecraft:air" && /stone/.test(B("cave", 0, 3, 0)), "the cave has two rooms inside a big stone hill");
  check(/iron_bars/.test(B("cave", 0, -4, -2)) && /stained_glass/.test(B("cave", 0, 0, -15)), "...a barred door between them and a dark crystal door in the tunnel");
  check(/water/.test(B("lake", 6, -1, -4)) && /grass/.test(B("lake", 0, -1, 5)) && /planks/.test(B("lake", 0, -1, -10)), "a big lake with an island and a dock");
  check(E.stars.length === 8 && E.stars.every((p) => /hidden_star/.test(ow.getBlock(p).typeId)), "8 hidden stars");
  const tickets = hav.inv.length;
  emit("itemUse", { source: hav, itemStack: new ItemStack("starshield:ticket") });
  run(30);
  check(forms.at(-1).buttons.includes("Play again") && world.structureManager.saved.size === 4, "using it again opens the menu (no second adventure)");

  console.log("Taking it away in the middle of the show");
  const kings = () => ow.entities.filter((g) => g.typeId === "starshield:grumble" && g.events.includes("starshield:make_king"));
  const takeAwayNow = async () => {
    answers.push((f) => f.buttons.indexOf("Take the adventure away"), 0);
    emit("itemUse", { source: hav, itemStack: new ItemStack("starshield:ticket") });
    run(20); await flush(); run(5); await flush(); run(5);
  };
  const buildAt = () => { hav.location = { x: 0, y: 64, z: 0 }; hav.view = undefined; emit("itemUse", { source: hav, itemStack: new ItemStack("starshield:ticket") }); run(30); };
  for (const when of [60, SS.CONCERT_TICKS + 30]) {
    const clues = hav.inv.filter((i) => i.typeId === "starshield:clue").length;
    E = SS.episode();
    hav.location = { ...SS.at(E, "stage", 0, 0, -4) };
    run(12);
    run(when);
    await takeAwayNow();
    run(SS.CONCERT_TICKS + 400);
    const what = when < SS.CONCERT_TICKS ? "during the concert" : "during the storm";
    check(!SS.episode(), `taken away ${what}: the adventure stays gone`);
    // (Ordinary night Grumbles can still come out: the storm made it night.)
    check(kings().length === 0 && grumbles().every((g) => !g.getDynamicProperty("starshield:story")), `...no Grumble King and no guard Grumbles`);
    check(hav.inv.filter((i) => i.typeId === "starshield:clue").length === clues, `...and no clue`);
    buildAt();
  }
  E = SS.episode();
  check(E && E.step === "ready", "it can be built again afterward");

  console.log("The concert");
  const walk = (loc) => { hav.location = { x: loc.x + 0.5, y: loc.y, z: loc.z + 0.5 }; };
  walk(SS.at(E, "stage", 0, 0, -4));
  run(12);
  check(SS.episode().step === "concert", "walking up to the stage starts the show");
  const story = () => idols().filter((g) => g.getDynamicProperty("starshield:story"));
  check(story().length === 3 && story().every((g) => g.events.includes("starshield:perform")), "the three girls perform on stage");
  const s1 = sounds.length;
  run(SS.CONCERT_TICKS - 20);
  const song = sounds.slice(s1);
  check(["note.snare", "note.hat", "note.bass"].every((x) => song.includes(x)), "claps, hi-hats and bass in the drop");
  check(song.includes("note.pling") && song.includes("note.bd") && song.includes("note.bit") && song.includes("note.chime"), "the concert song: intro, build-up, drop with kick and synth hook, final hit");
  run(-(SS.CONCERT_TICKS - 20) + (SS.CONCERT_TICKS - 20));
  check(idols().length === 3, "her own girls are the ones on stage (no extras)");
  run(25);
  check(SS.episode().step === "storm" && (abs % 24000) >= 13000, "the storm: the sky goes dark");
  check(ow.entities.some((g) => g.typeId === "starshield:grumble" && g.events.includes("starshield:make_king")), "the Grumble King appears");
  run(90);
  check(bolts.length >= 3 && ow.weather.includes("Thunder"), `lightning strikes around the stage (${bolts.length} bolts) in a thunderstorm`);
  check(bolts.every((b) => b.near === 0), "...never close to anyone");
  check([...ow.blocks.values()].every((b) => b.id !== "minecraft:fire"), "...and any fire it starts is put out");
  run(30);
  E = SS.episode();
  const free = () => idols().filter((g) => !g.getDynamicProperty("starshield:caged"));
  check(E.step === "tree" && free().length === 0, "the girls are gone");
  check(hav.inv.some((i) => i.typeId === "starshield:clue"), "Havana gets a clue");
  run(45);
  check(forms.some((f) => /big, big tree/.test(f.b || "")), "the clue opens by itself: 'I see a big, big tree.'");
  emit("itemUse", { source: hav, itemStack: new ItemStack("starshield:lightstick") });
  run(2);
  check(/missing/.test(hav.notes.at(-1)) && free().length === 0, "the Lightstick can't call them while they're missing");

  console.log("Sora at the big tree");
  run(12);
  const sora = idols().find((g) => g.getDynamicProperty("starshield:girl") === 0);
  check(sora && sora.getDynamicProperty("starshield:caged") === true, "Sora waits in her cage up in the tree");
  tapEntity(hav, sora);
  check(/Help/.test(hav.notes.at(-1)), "tapping her: 'Help!'");
  walk(SS.at(E, "tree", 0, 0, -12));
  run(12);
  const guards = () => grumbles().filter((g) => g.getDynamicProperty("starshield:story"));
  check(guards().length === 5, "5 Grumbles guard her (one up on the deck)");
  E = SS.episode();
  const [g1, g2] = guards();
  g1.location = { ...SS.at(E, "tree", 0, 4, 0) };
  g2.location = { x: g2.location.x + 80, y: 64, z: g2.location.z };
  run(12);
  const nearCage = (g) => dist2(g.location, E.cages.tree.girl) < 30;
  check(!/log/.test(ow.getBlock({ x: Math.floor(g1.location.x), y: Math.floor(g1.location.y), z: Math.floor(g1.location.z) }).typeId) && nearCage(g2),
    "stuck or far-off Grumbles are put back");
  guards()[0].remove();
  run(12);
  check(/Grumbles left: .*4/.test(hav.notes.join("|")), "'Grumbles left: 4' after beating one");
  const tapB = (loc) => { const ev = { player: hav, block: ow.getBlock(loc), cancel: false }; emit("tapBlock", ev); run(8); return ev; };
  const brk = { block: ow.getBlock(E.choices[0]), player: hav, cancel: false };
  emit("breakBefore", brk);
  check(brk.cancel, "puzzle blocks can't be broken");
  const wrong = E.choices.find((c) => c.color !== E.pattern[1]);
  check(tapB(wrong).cancel && /Look again/.test(hav.notes.at(-1)), "pattern puzzle: a wrong color says look again");
  for (const g of guards()) g.remove();
  hav.location = { ...SS.at(E, "tree", 0, 0, -13) };
  answers.push((f) => f.buttons.findIndex((b) => b.includes({ red: "Red", yellow: "Yellow", blue: "Blue", lime: "Green" }[E.pattern[1]])));
  run(25); await flush(); run(2);
  check(forms.some((f) => /What color is next/.test(f.b || "")), "after the Grumbles, the pattern pops up in words");
  check(SS.episode().solved.tree, "picking the right color solves it");
  hav.notes.length = 0;
  run(40);
  E = SS.episode();
  check(E.step === "cave" && sora.getDynamicProperty("starshield:friend") === true && sora.tamedTo === "Havana", "Sora is free and follows Havana");
  check(hav.notes.some((n) => /Sora: .*Havana! You found me/.test(n)), "Sora thanks her by name");
  run(80);
  check(JSON.parse(hav.getDynamicProperty("starshield:powers") || "[]").includes("notes") && hav.messages.some((m) => /Note Blast/.test(m)), "...and gives her a power: Note Blast");
  run(60);
  check(hav.inv.some((i) => i.typeId === "minecraft:torch"), "torches for the dark cave");
  check(forms.some((f) => /dark door/.test(f.b || "") && /Havana/.test(f.b || "")), "new clue (with her name): 'A dark door is in the way.'");

  console.log("Dalia in the cave");
  walk(SS.at(E, "cave", 0, 0, -20));
  run(12);
  check(guards().length === 6, "6 Grumbles: 2 outside, 4 in the back room");
  for (const g of guards().filter((g) => g.location.y > SS.at(E, "cave", 0, -2, 0).y)) g.remove();
  // Zap the crystal door with Note Blast.
  hav.location = { ...center2(SS.at(E, "cave", 0, 0, -19)) };
  hav.view = { x: E.f[0], y: 0, z: E.f[1] };
  hav.inv.splice(0, hav.inv.length, new ItemStack("starshield:lightstick"));
  const brkC = { block: ow.getBlock(E.crystals[0]), player: hav, cancel: false };
  emit("breakBefore", brkC);
  check(brkC.cancel, "the crystal door can't be broken by hand");
  emit("itemUse", { source: hav, itemStack: new ItemStack("starshield:lightstick") });
  run(4);
  E = SS.episode();
  check(E.crystalsBroken && E.crystals.every((c) => ow.getBlock(c).typeId === "minecraft:air"), "Note Blast breaks the dark crystal door");
  walk(SS.at(E, "cave", 0, -5, -6));
  const lamp = (n) => E.lamps.find((l) => l.n === n);
  tapB(lamp(1)); tapB(lamp(3));
  check(SS.episode().lit === 0 && /Start with 1/.test(hav.notes.at(-1)), "candle puzzle: wrong order starts over");
  tapB(lamp(1));
  emit("hitBlock", { damagingEntity: hav, hitBlock: ow.getBlock(lamp(2)) }); run(8);
  tapB({ ...lamp(3), y: lamp(3).y + 1 });
  E = SS.episode();
  check(E.solved.cave && E.door.every((d) => ow.getBlock(d).typeId === "minecraft:air"), "1, 2, 3 candles: the barred door opens");
  check(E.step === "cave", "Dalia stays caged until the back-room Grumbles are beaten");
  for (const g of guards()) g.remove();
  run(40);
  E = SS.episode();
  check(E.step === "lake" && idols().filter((g) => g.getDynamicProperty("starshield:friend")).length === 2, "Dalia is free");
  run(150);
  check(JSON.parse(hav.getDynamicProperty("starshield:powers")).includes("stomp"), "Dalia's power: Drum Boom");
  check(forms.some((f) => /island in the lake/.test(f.b || "")), "new clue: 'She is on an island in the lake.'");

  console.log("Yuna at the lake");
  walk(SS.at(E, "lake", 0, 0, -16));
  run(12);
  check(guards().length === 6 && guards().some((g) => g.events.includes("starshield:make_big")), "6 Grumbles by the lake, one is the Big Grumble");
  check(ow.entities.some((x) => x.typeId === "minecraft:boat"), "a boat on the water");
  // Drum Boom: crouch + Lightstick hits everything close.
  const near3 = guards().slice(0, 3);
  near3.forEach((g, k) => { g.location = { x: hav.location.x + 1 + k, y: hav.location.y, z: hav.location.z }; });
  hav.isSneaking = true;
  emit("itemUse", { source: hav, itemStack: new ItemStack("starshield:lightstick") });
  run(2);
  hav.isSneaking = false;
  check(near3.every((g) => g.damage.includes(4)), "Drum Boom hits every Grumble close by");
  const ans = (good) => (f) => {
    const r = SS.RIDDLES.find((q) => (f.b || "").includes(q[0]));
    return f.buttons.findIndex((b) => (b === r[1]) === good);
  };
  for (const g of guards()) g.remove();
  answers.push(ans(false), ans(true), ans(true));
  hav.location = { ...center2(SS.episode().riddleStone) };
  run(25); await flush(); run(35); await flush(); run(35); await flush(); run(25); await flush();
  check(SS.episode().solved.lake, "the riddle stone opens by itself: two riddles (a wrong answer asks again)");
  run(40);
  E = SS.episode();
  check(E.step === "finale" && idols().filter((g) => g.getDynamicProperty("starshield:friend")).length === 3, "Yuna is free: all three are back");
  run(150);
  check(JSON.parse(hav.getDynamicProperty("starshield:powers")).includes("fan"), "Yuna's power: Fan Jump");
  hav.inv.splice(0, hav.inv.length, new ItemStack("starshield:lightstick"));
  hav.effects.length = 0;
  run(12);
  check(hav.effects.includes("jump_boost") && hav.effects.includes("slow_falling"), "holding the Lightstick: jump high and float");
  check(forms.some((f) => /jump up high/.test(f.b || "")), "new clue: 'When he stomps, jump up high!'");

  console.log("Hidden stars");
  for (const st of E.stars.slice(0, 7)) { hav.location = { x: st.x + 0.5, y: st.y, z: st.z + 0.5 }; run(6); }
  check(SS.episode().starsFound === 7 && /7 of 8/.test(hav.notes.join("|")), "walking up to a star collects it ('7 of 8')");
  const last = SS.episode().stars[7];
  const bs = { block: ow.getBlock(last), player: hav, cancel: false };
  emit("breakBefore", bs); run(3);
  check(SS.episode().starsFound === 8 && /all 8 hidden stars/.test(hav.notes.join("|")) && hav.inv.filter((i) => i.typeId === "starshield:star_shard").length > 0, "...or breaking it: all 8 found, Superstar bonus");

  console.log("The Grumble King");
  walk(SS.at(E, "stage", 0, 0, -4));
  run(12);
  E = SS.episode();
  let king = ow.entities.find((g) => g.id === E.kingId);
  check(king && king.events.includes("starshield:king_shield"), "the King is back, with a shadow shield");
  run(200);
  const playSong = (mistake) => {
    const seq = [...SS.getSimon().seq];
    if (mistake) { tapB(E.pads[(seq[0] + 1) % 3]); return; }
    for (const g of seq) tapB(E.pads[g]);
  };
  check(SS.getSimon().seq.length === 3 && !SS.getSimon().showing, "round 1: a song of 3 colors");
  playSong(true);
  check(/Watch again/.test(hav.notes.join("|")), "a wrong color: watch again");
  run(150); playSong(false); run(150);
  check(SS.getSimon().seq.length === 4, "round 2: 4 colors");
  playSong(false);
  E = SS.episode();
  check(!E.shielded && E.phase === "fight" && king.events.includes("starshield:king_unshield"), "the song breaks his shield: the fight starts");
  // Stomp: stand on the ground near him and get hit by the shockwave; then jump over the next one.
  hav.location = { x: king.location.x + 4, y: king.location.y, z: king.location.z };
  hav.damage.length = 0;
  run(200);
  check(hav.notes.some((n) => /STOMP/.test(n)) && hav.damage.includes(2), "STOMP! The shockwave hits her if she's on the ground");
  run(140);
  check(sounds.includes("mob.blaze.shoot"), "he throws shadow orbs");
  check(/Star Note|Drum Boom|Fan Wind/.test(hav.notes.join("|")) && king.damage.some((d) => d >= 10), "the girls do special attacks on him");
  check(/■/.test(king.nameTag), "his name tag is a health bar");
  // Half health: he splits into three Mini Kings.
  king.hp = 110;
  emit("hurt", { hurtEntity: king, damageSource: { damagingEntity: hav } });
  E = SS.episode();
  const minis = () => grumbles().filter((g) => g.getDynamicProperty("starshield:story") === "miniking");
  check(E.phase === "split" && !king.valid && minis().length === 3, "at half health he pops into 3 Mini Kings");
  for (const m of minis()) m.remove();
  run(12);
  E = SS.episode();
  king = ow.entities.find((g) => g.id === E.kingId);
  check(E.phase === "angry" && king && king.hp === 100, "beat them all: he comes back together, angry");
  const medals = () => hav.inv.filter((i) => i.typeId === "starshield:medal_1").length;
  king.remove();
  emit("die", { deadEntity: king });
  check(SS.episode().step === "done", "beating him ends the story");
  check(ow.entities.some((g) => g.events.includes("starshield:make_tiny")), "he shrinks into a tiny Grumble");
  run(SS.SHOW_TICKS + 120);
  check(medals() === 1 && hav.messages.some((m) => /The End!/.test(m)), "The End: the Episode 1 Medal");
  check(ow.weather.at(-1) === "Clear", "the storm clears at the end");
  check(idols().every((g) => g.getDynamicProperty("starshield:friend") && g.getDynamicProperty("starshield:mode") === "follow"), "the girls are her friends and follow her");
  check(!hav.titles, "no big titles anywhere (DESIGN.md)");
  // The girls chat and cheer along the way.
  check(hav.notes.some((n) => /^§.(Sora|Dalia|Yuna): /.test(n)), "the girls talk to her");

  console.log("Lightstick");
  hav.inv.splice(0, hav.inv.length, new ItemStack("starshield:lightstick"));
  const brk2 = { block: ow.getBlock({ x: 0, y: 63, z: 0 }), player: hav, itemStack: hav.inv[0], cancel: false };
  emit("breakBefore", brk2);
  check(brk2.cancel, "the Lightstick doesn't break blocks");
  const z = ow.spawnEntity("minecraft:zombie", { x: 2, y: 64, z: 0 });
  const before2 = sounds.length;
  emit("hurt", { hurtEntity: z, damageSource: { damagingEntity: hav } });
  check(sounds.slice(before2).includes("note.chime"), "hitting a mob with it: star sparkles");
  z.remove();

  console.log("See you later");
  const yuna = idols().find((g) => g.getDynamicProperty("starshield:girl") === 2);
  hav.isSneaking = true; answers.push(2);
  run(10); tapEntity(hav, yuna); await flush(); run(50);
  hav.isSneaking = false;
  check(!yuna.valid && /Bye bye/.test(hav.notes.join("|")), "'See you later!': Yuna waves and sparkles away");
  run(25);
  emit("itemUse", { source: hav, itemStack: new ItemStack("starshield:lightstick") });
  run(3);
  check(idols().some((g) => g.getDynamicProperty("starshield:girl") === 2 && g.getDynamicProperty("starshield:friend")), "the Lightstick brings her back, still a friend");

  console.log("Play again / take it away");
  answers.push((f) => f.buttons.indexOf("Play again"));
  emit("itemUse", { source: hav, itemStack: new ItemStack("starshield:ticket") });
  run(20); await flush(); run(5);
  E = SS.episode();
  check(["ready", "concert"].includes(E.step) && !E.solved.tree && /tinted_glass/.test(B("tree", 1, 17, -5)), "play again: cages and puzzles reset (she's at the stage, so the show starts again)");
  answers.push((f) => f.buttons.indexOf("Take the adventure away"), 0);
  emit("itemUse", { source: hav, itemStack: new ItemStack("starshield:ticket") });
  run(20); await flush(); run(5); await flush(); run(5);
  check(!SS.episode() && world.structureManager.placed.length >= 4, "take it away: the land goes back (4 saved pieces)");
  check(!ow.blocks.size || [...ow.blocks.values()].every((b) => !/concrete|tinted|leaves|log|stained/.test(b.id)), "...exactly how it was: nothing left over");
  check(ow.commands.some((c) => /tickingarea remove/.test(c)), "the loaded area is let go");
  console.log("A flat world (the ground is only 4 blocks above the bottom of the world)");
  ow.blocks.clear(); ow.ground = -60;
  for (const x of ow.entities.filter((x) => x.typeId !== "minecraft:player")) x.remove();
  hav.location = { x: 0, y: -60, z: 0 };
  emit("itemUse", { source: hav, itemStack: new ItemStack("starshield:ticket") });
  run(30);
  E = SS.episode();
  check(E && E.step === "ready", "the adventure builds in a flat world");
  check(E.sites.cave.raise === 5 && E.sites.lake.raise === 1 && !E.sites.stage.raise && !E.sites.tree.raise, "the cave (and lake) sit on a raised base instead of digging into the void");
  const Bf = (pl, du, dy, dv) => ow.getBlock(SS.at(E, pl, du, dy, dv))?.typeId;
  check(/stone/.test(Bf("cave", 2, -6, -6)) && SS.at(E, "cave", 0, -8, 0).y >= -63, "the cave rooms have a floor above the bottom of the world");
  check(/sand/.test(Bf("lake", 4, -3, 0)) && SS.at(E, "lake", 0, -4, 0).y >= -64, "the lake has a bottom");
  // Walk in along the middle: from the land, up the ramp, into the tunnel and down to the room, one block at a time.
  const standY = (du, dv) => {
    for (let dy = 8; dy >= -8; dy--) {
      const here = Bf("cave", du, dy, dv), above = Bf("cave", du, dy + 1, dv), above2 = Bf("cave", du, dy + 2, dv);
      if (here && !/air/.test(here) && /air/.test(above) && /air/.test(above2)) return SS.at(E, "cave", 0, dy + 1, 0).y;
    }
    return undefined;
  };
  const open = (id) => /air|stained_glass/.test(id || "");          // (the crystal door gets zapped open; walk beside the lamps)
  const path = [];
  for (let dv = -31; dv <= -3; dv++) {
    let y;
    for (let dy = -7; dy <= 6; dy++) {
      if (open(Bf("cave", 1, dy, dv)) && open(Bf("cave", 1, dy + 1, dv)) && !open(Bf("cave", 1, dy - 1, dv))) { y = SS.at(E, "cave", 0, dy, 0).y; break; }
    }
    path.push(y);
  }
  check(path.every((y) => y !== undefined) && path.every((y, i) => i === 0 || Math.abs(y - path[i - 1]) <= 1), `walkable all the way in, no step over 1 block (${path.join(", ")})`);
  answers.push((f) => f.buttons.indexOf("Take the adventure away"), 0);
  emit("itemUse", { source: hav, itemStack: new ItemStack("starshield:ticket") });
  run(20); await flush(); run(5); await flush(); run(5);
  check(!SS.episode() && [...ow.blocks.values()].every((b) => !/stone|concrete|tinted|leaves|log|stained|water|sand/.test(b.id)), "taken away: the flat world is flat again");

  console.log(fails ? `\n${fails} FAILED` : "\nAll good!");
  process.exit(fails ? 1 : 0);
})();
