// Runs the Kingdom Quest script against a small fake Minecraft world and checks quest 1 ("Gold Eggs") with two
// players: welcome page -> sparkles to the princess -> she appears crying on her throne -> story pages turned
// with Next / Back -> eggs appear near players, each player takes each egg once -> magic barrier nudges ->
// hand in 5 eggs -> waits for the friend -> friend hands in -> road opens (eggs gone, princess happy, barriers
// cleared as their ground loads, paw prints) -> reset puts it all back -> a friend leaving can finish the quest.
// Usage: node tests/kingdom_quest_test.cjs addons/KingdomQuest_BP/scripts/main.js addons/KingdomQuest_BP/scripts/kingdom_data.js
const fs = require("fs");
const data = fs.readFileSync(process.argv[3], "utf8").replace(/^export /m, "");
const src = data + "\n" + fs.readFileSync(process.argv[2], "utf8").replace(/^import .*$/gm, "") +
  "\nglobalThis.__kq = { stage, foundEggs, KINGDOM, busy };";

let failures = 0, checks = 0;
function check(ok, msg) { checks++; if (!ok) { failures++; console.log("FAIL: " + msg); } }

let tick = 0;
const subs = {};
const sub = (name) => ({ subscribe: (fn) => { (subs[name] ||= []).push(fn); } });
const emit = (name, ev) => (subs[name] || []).forEach((f) => f(ev));
let timers = [], nextId = 1;
const system = {
  get currentTick() { return tick; },
  runInterval: (fn, n) => { const id = nextId++; timers.push({ id, fn, every: n || 1, at: tick + (n || 1) }); return id; },
  runTimeout: (fn, n) => { const id = nextId++; timers.push({ id, fn, once: true, at: tick + (n || 1) }); return id; },
  run: (fn) => system.runTimeout(fn, 1),
  clearRun: (id) => { timers = timers.filter((t) => t.id !== id); },
  afterEvents: { scriptEventReceive: sub("scriptEvent") },
};
class ItemStack { constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; } }

// forms: each shown form waits in `open` until the test answers it
const open = [];
class ActionFormData {
  constructor() { this.buttons = []; this.icons = []; }
  title(t) { this.t = t; return this; }
  body(b) { this.b = b; return this; }
  button(l, icon) { this.buttons.push(l); this.icons.push(icon); return this; }
  show(player) { return new Promise((resolve) => open.push({ form: this, player, resolve })); }
}
const flush = () => new Promise((r) => setTimeout(r, 0));
async function answer(player, pick, tries = 0) {
  await flush();
  const i = open.findIndex((o) => o.player === player);
  if (i < 0) { if (tries < 5) { await run(5); return answer(player, pick, tries + 1); } throw new Error("no page open for " + player.name); }
  const o = open.splice(i, 1)[0];
  const sel = typeof pick === "function" ? pick(o.form) : pick;
  o.resolve(sel === "x" ? { canceled: true, cancelationReason: "UserClosed" } : sel === "busy" ? { canceled: true, cancelationReason: "UserBusy" }
    : { canceled: false, selection: sel });
  await flush(); await flush();
  return o.form;
}
const btn = (word) => (f) => { const i = f.buttons.findIndex((b) => b.includes(word)); if (i < 0) throw new Error(`no "${word}" button in ${f.buttons}`); return i; };

// ---------------------------------------------------------------- the fake world
const props = new Map();
const players = [];
const blocks = new Map();
const particles = [], sounds = [];
const K = (l) => `${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)}`;
let nextEnt = 1;
const dim = {
  id: "minecraft:overworld", entities: [],
  loaded(l) { return players.some((p) => Math.hypot(p.location.x - l.x, p.location.z - l.z) <= 64); },
  getBlock(l) {
    if (!dim.loaded(l)) return undefined;
    const typeId = blocks.get(K(l)) ?? "minecraft:air";
    return { typeId, setType: (t) => { if (!t.includes(":")) throw new Error("bad block"); blocks.set(K(l), t); } };
  },
  spawnEntity(type, loc) {
    if (!dim.loaded(loc)) throw new Error("LocationInUnloadedChunk");
    const ep = new Map(), dp = new Map();
    const e = { id: "e" + nextEnt++, typeId: type, location: { ...loc }, rotation: { x: 0, y: 0 }, removed: false,
      getProperty: (k) => ep.get(k) ?? false, setProperty: (k, v) => ep.set(k, v),
      getDynamicProperty: (k) => dp.get(k), setDynamicProperty: (k, v) => dp.set(k, v),
      teleport(l, o) { e.location = { ...l }; if (o?.rotation) e.rotation = o.rotation; },
      setRotation(r) { e.rotation = r; }, remove() { e.removed = true; dim.entities = dim.entities.filter((x) => x !== e); } };
    dim.entities.push(e);
    return e;
  },
  getEntities(q = {}) {
    return dim.entities.filter((e) => (!q.type || e.typeId === q.type) &&
      (!q.location || Math.hypot(e.location.x - q.location.x, e.location.y - q.location.y, e.location.z - q.location.z) <= q.maxDistance));
  },
  spawnParticle(id, loc) { if (!dim.loaded(loc)) throw new Error("unloaded"); particles.push({ id, ...loc, tick }); },
};
function makePlayer(name, loc) {
  const dp = new Map();
  const slots = new Array(36).fill(undefined);
  const p = { id: "p-" + name, name, typeId: "minecraft:player", dimension: dim, location: { ...loc }, actionbar: [],
    getDynamicProperty: (k) => dp.get(k), setDynamicProperty: (k, v) => dp.set(k, v),
    playSound: (s) => sounds.push({ who: name, s, tick }),
    onScreenDisplay: { setActionBar: (t) => p.actionbar.push(t) },
    getComponent: (c) => c === "minecraft:inventory" ? { container: {
      size: 36, getItem: (i) => slots[i], setItem: (i, it) => { slots[i] = it; },
      addItem: (it) => { const i = slots.findIndex((s) => !s); slots[i] = it; } } } : undefined,
    eggItems: () => slots.filter((s) => s?.typeId === "kq:golden_egg").length,
  };
  players.push(p);
  emit("playerSpawn", { player: p, initialSpawn: true });
  return p;
}
const world = {
  getDynamicProperty: (k) => props.get(k), setDynamicProperty: (k, v) => props.set(k, v),
  getAllPlayers: () => players.slice(), getDimension: () => dim,
  beforeEvents: { playerInteractWithEntity: sub("interact") },
  afterEvents: { entityHitEntity: sub("hit"), playerSpawn: sub("playerSpawn"), playerLeave: sub("playerLeave") },
};

async function run(n) {
  for (let k = 0; k < n; k++) {
    tick++;
    for (const t of timers.filter((t) => t.at <= tick)) {
      if (t.once) timers = timers.filter((x) => x !== t); else t.at += t.every;
      t.fn();
    }
    if (k % 5 === 0) await flush();
  }
  await flush();
}
function tap(p, e) {
  const ev = { player: p, target: e, cancel: false };
  emit("interact", ev);
  check(ev.cancel, "tapping " + e.typeId + " is answered by the script");
}

// ---------------------------------------------------------------- go
new Function("world", "system", "ItemStack", "ActionFormData", src)(world, system, ItemStack, ActionFormData);
const { KINGDOM, stage, foundEggs, busy } = globalThis.__kq;
for (const c of Object.values(KINGDOM.barriers).flat()) blocks.set(K({ x: c[0], y: c[1], z: c[2] }), "kq:magic_barrier");
const at = (a, dy = 0) => ({ x: a[0] + 0.5, y: a[1] + dy, z: a[2] + 0.5 });

(async () => {
  check(KINGDOM.eggs.length === 5, "five egg spots");
  check(KINGDOM.barriers.road.length > 30 && KINGDOM.barriers["ice gate"].length > 30, "barriers on the road and in the gate");
  const ava = makePlayer("Ava", at(KINGDOM.spawn));
  const ben = makePlayer("Ben", at(KINGDOM.spawn));
  await run(70);
  let f = await answer(ava, 0);
  check(/princess is sad/.test(f.b) && f.buttons.length === 1, "welcome page sends you to the princess");
  await answer(ben, "x");
  particles.length = 0;
  await run(40);
  check(particles.some((q) => q.id === "kq:sparkle"), "sparkles lead from the spawn to the princess");
  check(!dim.getEntities({ type: "kq:princess" }).length, "princess not spawned while nobody is near");

  // Ava walks to the throne
  ava.location = at(KINGDOM.princess, 0); ava.location.z += 4;
  particles.length = 0;
  await run(60);
  const princess = dim.getEntities({ type: "kq:princess" })[0];
  check(princess && Math.hypot(princess.location.x - KINGDOM.princess[0] - 0.5, princess.location.z - KINGDOM.princess[2] - 0.5) < 0.01,
    "princess sits on her throne");
  check(princess && princess.rotation.y === KINGDOM.princessFacing, "princess faces the hall");
  check(princess && princess.getProperty("kq:happy") === false, "princess is crying");
  check(particles.some((q) => q.id === "kq:tear"), "tears");
  await run(60);
  check(dim.getEntities({ type: "kq:princess" }).length === 1, "only one princess");

  // the story, in pages: Next, Next, Back, Next, Next, Next, then Yes
  tap(ava, princess);
  await run(2);
  const seen = [];
  for (const pick of ["Next", "Next", "Back", "Next", "Next", "Next"]) seen.push(await answer(ava, btn(pick)));
  check(/Boo hoo/.test(seen[0].b) && !seen[0].buttons.some((b) => b.includes("Back")), "page 1: no Back button");
  check(/Graham is lost/.test(seen[1].b), "page 2: Graham is lost");
  check(/Graham is lost/.test(seen[3].b), "Back turns to the page before");
  check(seen.every((s) => s.icons.every(Boolean)), "every button has a picture");
  f = await answer(ava, btn("help"));
  check(/5 gold eggs/.test(f.b), "last page asks for 5 gold eggs");
  check(ava.getDynamicProperty("kq:met") === true, "Ava has met the princess");
  await run(10);
  f = await answer(ava, 0);
  check(/Look all over my castle/.test(f.b), "thank-you page says where to look");
  // tapping again without eggs: how many, and a help page
  tap(ava, princess); await run(2);
  f = await answer(ava, btn("Help"));
  check(/0 gold eggs/.test(f.b), "page shows 0 eggs");
  await run(10);
  f = await answer(ava, 0);
  check(/hedge maze/.test(f.b) && /unicorn stable/.test(f.b), "help page lists where to look");

  // eggs: they appear when someone comes near; Ava finds all five
  for (let i = 0; i < 5; i++) {
    ava.location = at(KINGDOM.eggs[i].pos); ava.location.x += 2;
    await run(25);
    const egg = dim.getEntities({ type: "kq:golden_egg", location: at(KINGDOM.eggs[i].pos), maxDistance: 1.5 });
    check(egg.length === 1 && egg[0].getDynamicProperty("kq:egg") === i, "egg " + i + " is there");
    if (!egg.length) continue;
    tap(ava, egg[0]); await run(15);
    f = await answer(ava, 0);
    check(new RegExp(i === 4 ? "all 5 eggs" : "found a gold egg").test(f.b), "egg page " + i);
    tap(ava, egg[0]); await run(15);
    check(/have this egg/.test(ava.actionbar.at(-1) ?? ""), "the same egg can't be taken twice");
  }
  check(foundEggs(ava).length === 5 && ava.eggItems() === 5, "Ava has 5 eggs");
  check(dim.getEntities({ type: "kq:golden_egg" }).length === 5, "eggs stay for the friend");

  // Ben pokes the magic barrier
  const rb = KINGDOM.barriers.road[0];
  ben.location = at(rb); ben.location.x += 1.5;
  await run(45);
  check(ben.actionbar.some((t) => /Help the princess first/.test(t)), "barrier tells you to help the princess");

  // Ava hands in (hitting the princess works too)
  ava.location = at(KINGDOM.princess); ava.location.z += 3;
  await run(5);
  emit("hit", { damagingEntity: ava, hitEntity: princess });
  await run(2);
  f = await answer(ava, btn("Next"));
  check(/found 5 gold eggs/.test(f.b), "hand-in page");
  await answer(ava, btn("Here you go"));
  await run(10);
  check(ava.getDynamicProperty("kq:helped") === true && ava.eggItems() === 0, "eggs given to the princess");
  check(stage() === 0, "road still closed: Ben hasn't helped yet");
  f = await answer(ava, 0);
  check(/Ben/.test(f.b) && /help your friends/.test(f.b), "Ava is told Ben still needs eggs");

  // Ben meets her, closes a page by mistake (X), comes back, and does it all
  ben.location = { ...ava.location };
  await run(5);
  tap(ben, princess); await run(2);
  await answer(ben, "busy");                   // the game was busy: the page comes back
  await run(15);
  await answer(ben, btn("Next"));
  await answer(ben, "x");                      // closed: try again later
  check(ben.getDynamicProperty("kq:met") !== true, "closing the story doesn't count as meeting her");
  await run(15);
  tap(ben, princess); await run(2);
  for (let k = 0; k < 4; k++) await answer(ben, btn("Next"));
  await answer(ben, btn("help"));
  await run(10); await answer(ben, 0);
  for (let i = 0; i < 5; i++) {
    ben.location = at(KINGDOM.eggs[i].pos); ben.location.x += 2;
    await run(25);
    const egg = dim.getEntities({ type: "kq:golden_egg", location: at(KINGDOM.eggs[i].pos), maxDistance: 1.5 })[0];
    tap(ben, egg); await run(15); await answer(ben, 0);
  }
  check(foundEggs(ben).length === 5, "Ben has 5 eggs");
  ben.location = { ...ava.location };
  await run(5);
  tap(ben, princess); await run(2);
  await answer(ben, btn("Next")); await answer(ben, btn("Here you go"));
  await run(20);
  check(stage() === 1, "everyone helped: the road is open");
  check(dim.getEntities({ type: "kq:golden_egg" }).length === 0, "eggs are gone");
  check(sounds.some((s) => s.s === "random.levelup" && s.who === "Ava"), "everyone hears the celebration");
  f = await answer(ava, btn("Next"));
  check(/magic wall is gone/.test(f.b), "Ava sees the happy pages");
  await answer(ava, "x");
  f = await answer(ben, btn("Next"));
  await answer(ben, btn("Next"));
  f = await answer(ben, btn("go"));
  check(/Ice Palace/.test(f.b), "happy pages point to the Ice Palace");
  await run(30);
  check(princess.getProperty("kq:happy") === true, "princess is happy");
  const roadLeft = () => KINGDOM.barriers.road.filter((c) => blocks.get(K({ x: c[0], y: c[1], z: c[2] })) === "kq:magic_barrier").length;
  const gateLeft = () => KINGDOM.barriers["ice gate"].filter((c) => blocks.get(K({ x: c[0], y: c[1], z: c[2] })) === "kq:magic_barrier").length;
  check(gateLeft() > 0, "far-away gate barrier waits until its ground loads");
  // Ben rides along the road and sees paw prints
  particles.length = 0;
  ben.location = at(rb); ben.location.x -= 20;
  await run(40);
  check(roadLeft() === 0, "road barrier gone");
  check(particles.filter((q) => q.id === "kq:pawprint").length > 10, "paw prints along the road");
  ben.location = at(KINGDOM.iceGate);
  await run(40);
  check(gateLeft() === 0, "ice gate barrier gone when Ben gets there");
  check(props.get("kq:barriers_left") === 0, "all barriers counted gone");
  tap(ava, princess); await run(2);
  f = await answer(ava, btn("Next"));
  check(/magic wall is gone/.test(f.b), "after: the princess talks about the paw prints");
  await answer(ava, "x");

  // reset puts it back (barriers as their ground loads)
  emit("scriptEvent", { id: "kq:reset" });
  await run(5);
  check(stage() === 0 && foundEggs(ava).length === 0 && ava.getDynamicProperty("kq:helped") === false, "reset");
  await run(320);
  check(gateLeft() === KINGDOM.barriers["ice gate"].length, "reset brings the gate barrier back");
  ava.location = at(rb); ava.location.x += 1.5;
  await run(320);
  check(roadLeft() === KINGDOM.barriers.road.length, "reset brings the road barrier back");

  // a friend leaving can finish it: Ava helps, Ben leaves
  ava.setDynamicProperty("kq:helped", true);
  players.splice(players.indexOf(ben), 1);
  emit("playerLeave", { playerId: ben.id });
  await run(10);
  check(stage() === 1, "the last helper left: road opens");
  check(busy.size <= 2, "no stuck pages");

  console.log(failures ? `${failures} of ${checks} checks failed` : `OK (${checks} checks)`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log("ERROR", e); process.exit(1); });
