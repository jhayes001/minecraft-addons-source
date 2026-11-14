// Runs the Kingdom Quest script against a small fake Minecraft world and checks quest 1 ("The Hen Pen") with two
// players: welcome page -> sparkles to the princess -> she appears crying on her throne -> story pages turned
// with Next / Back -> hens scattered round the meadows -> a pen of fences round the hen house (an open gate or a gap
// doesn't count) -> 3 hens led in -> the pen lays eggs -> 10 eggs for two players, from anyone -> the gate opens
// (princess happy, paw prints) -> inns and their keepers -> reset -> a friend leaving can finish the quest.
// Usage: node tests/kingdom_quest_test.cjs addons/KingdomQuest_BP/scripts/main.js addons/KingdomQuest_BP/scripts/kingdom_data.js
const fs = require("fs");
const data = fs.readFileSync(process.argv[3], "utf8").replace(/^export /m, "");
const src = data + "\n" + fs.readFileSync(process.argv[2], "utf8").replace(/^import .*$/gm, "") +
  "\nglobalThis.__kq = { stage, KINGDOM, penCheck };";

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
class MolangVariableMap { setFloat(k, v) { this[k] = v; } }
class ItemStack { constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; } }

// talking windows (NPC dialogue): the scenes come from the pack's dialogue file; each opened window waits in `open`
// until the test presses a button, which runs the button's commands (turn a page, or /scriptevent kq:act ...)
const path = require("path");
const SCENES = {};
for (const sc of JSON.parse(fs.readFileSync(path.join(path.dirname(process.argv[2]), "..", "dialogue", "kingdom.diag.json"), "utf8"))
  ["minecraft:npc_dialogue"].scenes) SCENES[sc.scene_tag] = sc;
const open = [];
let pagesShown = 0;
const badPages = [];
function openScene(player, npc, scene) {
  pagesShown++;
  if (!SCENES[scene]) { badPages.push("missing scene " + scene); return; }
  for (let i = open.length - 1; i >= 0; i--) if (open[i].player === player) open.splice(i, 1);   // one window at a time
  open.push({ player, npc, scene });
}
function runCommand(npc, cmd, initiator) {
  let m = /^\/?dialogue open @s (?:@initiator|@a\[name="(.+)"\]) (\S+)$/.exec(cmd);
  if (m) {
    const player = m[1] === undefined ? initiator : players.find((p) => p.name === m[1]);
    if (!player) { badPages.push("no player for " + cmd); return; }
    if (!npc.typeId.startsWith("kq:")) badPages.push("not an NPC: " + npc.typeId);
    return openScene(player, npc, m[2]);
  }
  m = /^\/execute as @initiator run scriptevent (\S+) (.*)$/.exec(cmd);
  if (m) return emit("scriptEvent", { id: m[1], message: m[2], sourceEntity: initiator });
  badPages.push("unknown command " + cmd);
}
const flush = () => new Promise((r) => setTimeout(r, 0));
async function answer(player, pick, tries = 0) {
  await flush();
  const i = open.findIndex((o) => o.player === player);
  if (i < 0) { if (tries < 5) { await run(5); return answer(player, pick, tries + 1); } throw new Error("no page open for " + player.name); }
  const o = open.splice(i, 1)[0];
  const sc = SCENES[o.scene];
  const form = { t: sc.npc_name, b: sc.text, buttons: sc.buttons.map((b) => b.name), scene: o.scene, npc: o.npc };
  const sel = typeof pick === "function" ? pick(form) : pick;
  if (sel !== "x") {
    if (!sc.buttons[sel]) throw new Error("no button " + sel + " on " + o.scene);
    for (const c of sc.buttons[sel].commands) runCommand(o.npc, c, player);
  }
  await flush(); await run(3);
  return form;
}
const btn = (word) => (f) => { const i = f.buttons.findIndex((b) => b.includes(word)); if (i < 0) throw new Error(`no "${word}" button in ${f.buttons} (${f.scene})`); return i; };

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
    const v = blocks.get(K(l)) ?? "minecraft:air";
    const typeId = typeof v === "string" ? v : v.id;
    return { typeId, isAir: typeId === "minecraft:air", isLiquid: typeId === "minecraft:water",
      permutation: { getState: (k) => (typeof v === "string" ? undefined : v.states?.[k]) },
      setType: (t) => { if (!t.includes(":")) throw new Error("bad block"); blocks.set(K(l), t); } };
  },
  spawnItem(stack, loc) {
    if (!dim.loaded(loc)) throw new Error("unloaded");
    const e = dim.spawnEntity("minecraft:item", loc);
    e.getComponent = (c) => (c === "minecraft:item" ? { itemStack: stack } : undefined);
    return e;
  },
  playSound(s, loc) { sounds.push({ who: "world", s, tick }); },
  spawnEntity(type, loc) {
    if (!dim.loaded(loc)) throw new Error("LocationInUnloadedChunk");
    const ep = new Map(), dp = new Map();
    const e = { id: "e" + nextEnt++, typeId: type, location: { ...loc }, rotation: { x: 0, y: 0 }, removed: false,
      getProperty: (k) => ep.get(k) ?? false, setProperty: (k, v) => ep.set(k, v),
      getDynamicProperty: (k) => dp.get(k), setDynamicProperty: (k, v) => dp.set(k, v),
      teleport(l, o) { e.location = { ...l }; if (o?.rotation) e.rotation = o.rotation; },
      setRotation(r) { e.rotation = r; }, remove() { e.removed = true; dim.entities = dim.entities.filter((x) => x !== e); },
      runCommand(cmd) { if (e.removed) throw new Error("removed"); runCommand(e, cmd); return { successCount: 1 }; } };
    dim.entities.push(e);
    return e;
  },
  getEntities(q = {}) {
    const d = (e) => (q.location ? Math.hypot(e.location.x - q.location.x, e.location.y - q.location.y, e.location.z - q.location.z) : 0);
    const found = dim.entities.filter((e) => (!q.type || e.typeId === q.type) && (!q.location || d(e) <= q.maxDistance));
    if (q.closest) found.sort((a, b) => d(a) - d(b));
    return q.closest ? found.slice(0, q.closest) : found;
  },
  spawnParticle(id, loc, vars) { if (!dim.loaded(loc)) throw new Error("unloaded"); particles.push({ id, ...loc, tick, dir: vars?.["variable.dir"] }); },
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
      addItem: (it) => { const i = slots.findIndex((s) => s?.typeId === it.typeId && s.amount + it.amount <= 16);
        if (i >= 0) slots[i].amount += it.amount; else slots[slots.findIndex((s) => !s)] = it; } } } : undefined,
    eggItems: () => slots.filter((s) => s?.typeId === "minecraft:egg").reduce((n, s) => n + s.amount, 0),
    inv: () => slots,
  };
  players.push(p);
  emit("playerSpawn", { player: p, initialSpawn: true });
  return p;
}
const world = {
  getDynamicProperty: (k) => props.get(k), setDynamicProperty: (k, v) => props.set(k, v),
  getAllPlayers: () => players.slice(), getDimension: () => dim,
  beforeEvents: { playerInteractWithEntity: sub("interact") },
  afterEvents: { entityHitEntity: sub("hit"), playerSpawn: sub("playerSpawn"), playerLeave: sub("playerLeave"), itemUse: sub("itemUse") },
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
new Function("world", "system", "ItemStack", "MolangVariableMap", src)(world, system, ItemStack, MolangVariableMap);
const { KINGDOM, stage, penCheck } = globalThis.__kq;
for (const c of KINGDOM.rings.flatMap((r) => r.gate)) blocks.set(K({ x: c[0], y: c[1], z: c[2] }), "kq:magic_barrier");
const setItems = (p, items) => { const inv = p.inv(); inv.fill(undefined); let i = 0;
  for (const [id, n] of Object.entries(items)) inv[i++] = new ItemStack(id, n); };
const at = (a, dy = 0) => ({ x: a[0] + 0.5, y: a[1] + dy, z: a[2] + 0.5 });

(async () => {
  // the talking pages themselves: words, buttons that work, pages that exist
  const allScenes = Object.values(SCENES);
  check(allScenes.length > 150, "talking pages written (" + allScenes.length + ")");
  for (const sc of allScenes) {
    const bad = /undefined|None|NaN|\[object/.test(sc.text + sc.npc_name + JSON.stringify(sc.buttons));
    const buttonsOk = sc.buttons.length >= 1 && sc.buttons.length <= 6 && sc.buttons.every((b) => b.commands.length &&
      b.commands.every((c) => { const m = /^\/dialogue open @s @initiator (\S+)$/.exec(c); return m ? !!SCENES[m[1]] : /^\/execute as @initiator run scriptevent kq:act \w+$/.test(c); }));
    if (bad || !buttonsOk) check(false, "page " + sc.scene_tag + " is fine");
  }

  check(KINGDOM.farm.hens.length >= 12, "hens to scatter round the farm");
  check(KINGDOM.rings.length === 5 && KINGDOM.rings.every((r) => r.gate.length > 30), "a magic gate for each castle after the first");
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

  // the story, in pages: Next, Next, Back, then Next to the end, then Yes
  tap(ava, princess);
  await run(2);
  const seen = [];
  for (const pick of ["Next", "Next", "Back", "Next", "Next", "Next", "Next"]) seen.push(await answer(ava, btn(pick)));
  check(/Boo hoo/.test(seen[0].b) && !seen[0].buttons.some((b) => b.includes("Back")), "page 1: no Back button");
  check(/Graham is lost/.test(seen[1].b), "page 2: Graham is lost");
  check(/Graham is lost/.test(seen[3].b), "Back turns to the page before");
  check(/ran after my hens/.test(seen[4].b), "Graham scattered the hens");
  check(seen.every((s) => s.t.includes("Princess") && s.npc.typeId === "kq:princess"), "the princess's pages come from her (her picture is in the window)");
  f = await answer(ava, btn("help"));
  check(/bring me 10 eggs/.test(f.b), "last page asks for 10 eggs (5 for each of the 2 players)");
  check(ava.getDynamicProperty("kq:met") === true, "Ava has met the princess");
  await run(10);
  const how = [];
  for (let k = 0; k < 2; k++) how.push(await answer(ava, btn("Next")));
  how.push(await answer(ava, 0));
  check(/Thank you/.test(how[0].b) && /How-To Book/.test(how[1].b) && /hen house/.test(how[2].b), "thank-you pages: the How-To Book, go to the hen house");
  check(ava.inv().some((i) => i?.typeId === "kq:guide"), "the princess gives Ava a How-To Book");
  tap(ava, princess); await run(2);
  f = await answer(ava, btn("Help"));
  check(/Make a pen/.test(f.b), "no pen yet");
  await run(10);
  f = await answer(ava, "x");
  check(/Get an axe/.test(f.b) && f.t.includes("How-To Book"), "Help me opens the How-To Book at the first step");
  // lost the book? she gives another
  setItems(ava, {});
  tap(ava, princess); await run(2);
  f = await answer(ava, 0);
  check(/new How-To Book/.test(f.b) && ava.inv().some((i) => i?.typeId === "kq:guide"), "a new How-To Book if you lost yours");

  // the lesson: the hint at the bottom of the screen follows what Ava is carrying
  ava.location = at(KINGDOM.farm.coop); ava.location.x -= 6;
  const lesson = [
    [{}, /Get an axe/], [{ "minecraft:iron_axe": 1 }, /Chop the trees/], [{ "minecraft:iron_axe": 1, "minecraft:oak_log": 3 }, /Make planks/],
    [{ "minecraft:oak_log": 1, "minecraft:oak_planks": 8 }, /crafting table!/], [{ "minecraft:crafting_table": 1, "minecraft:oak_planks": 8 }, /Put your crafting table down/],
    [{ "minecraft:oak_planks": 8 }, /Make some sticks/], [{ "minecraft:oak_planks": 4, "minecraft:stick": 4 }, /Make fences/],
    [{ "minecraft:oak_fence": 15, "minecraft:stick": 2 }, /Make a gate/], [{ "minecraft:oak_fence": 15, "minecraft:fence_gate": 1 }, /Build a fence all round/],
    [{ "minecraft:oak_planks": 1 }, /A gap\? Chop more wood/],
  ];
  for (const [items, want] of lesson) {
    setItems(ava, items);
    await run(45);
    check(want.test(ava.actionbar.at(-1) ?? ""), "lesson hint " + want + " (got " + ava.actionbar.at(-1) + ")");
  }
  emit("itemUse", { source: ava, itemStack: new ItemStack("kq:guide", 1) });
  await run(2);
  f = await answer(ava, btn("Next"));
  check(/Is there a gap/.test(f.b), "the How-To Book opens at the step you're on");
  f = await answer(ava, "x");
  check(/3 hens in/.test(f.b), "and you can turn on to the next page");
  setItems(ava, { "kq:guide": 1 });

  // the hens: scattered round the meadows near the farm, once each
  const coop = KINGDOM.farm.coop, cx = coop[0], cy = coop[1], cz = coop[2];
  ava.location = at(coop); ava.location.x -= 6;
  await run(40);
  const hens = () => dim.getEntities({ type: "minecraft:chicken" });
  const reachable = KINGDOM.farm.hens.filter((h) => Math.hypot(h[0] - cx, h[2] - cz) <= 42).length;
  check(hens().length >= reachable && hens().length >= 8, "hens scattered round the farm (" + hens().length + ")");
  await run(40);
  check(hens().length <= KINGDOM.farm.hens.length, "each spot gets its hen once");
  ava.actionbar.length = 0;
  await run(5);

  // build a pen: a square of fences 3 out from the hen house, with a gate on the south side
  const fence = (x, z) => blocks.set(K({ x, y: cy, z }), "minecraft:oak_fence");
  for (let d = -3; d <= 3; d++) { fence(cx + d, cz - 3); fence(cx - 3, cz + d); fence(cx + 3, cz + d); if (d !== 0) fence(cx + d, cz + 3); }
  const gate = (open) => blocks.set(K({ x: cx, y: cy, z: cz + 3 }), { id: "minecraft:fence_gate", states: { open_bit: open } });
  gate(true);
  // the hen house's corner posts are logs, two high
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { blocks.set(K({ x: cx + a, y: cy, z: cz + b }), "minecraft:oak_log"); blocks.set(K({ x: cx + a, y: cy + 1, z: cz + b }), "minecraft:oak_log"); }
  const inPen = (h, k) => { h.location = { x: cx + 0.5 + (k % 3) - 1, y: cy, z: cz + 2.5 }; };
  hens().slice(0, 3).forEach(inPen);
  await run(10);
  check(!penCheck(true).closed && props.get("kq:pen") !== true, "an open gate: not a pen yet");
  gate(false);
  blocks.delete(K({ x: cx + 3, y: cy, z: cz + 1 }));                      // a gap in the fence
  await run(10);
  check(!penCheck(true).closed, "a gap in the fence: not a pen");
  fence(cx + 3, cz + 1);
  hens().slice(0, 3).forEach((h) => { h.location = { x: cx + 9.5, y: cy, z: cz + 9.5 }; });
  await run(10);
  check(penCheck(true).closed && penCheck(true).hens.length === 0 && props.get("kq:pen") !== true, "closed pen, but no hens in it yet");
  ava.location = at(KINGDOM.princess); ava.location.z += 3;
  await run(5);
  tap(ava, princess); await run(2);
  f = await answer(ava, 0);
  check(/Good pen/.test(f.b) && /3 more hens/.test(f.b), "the princess knows about the pen even from far away");
  ava.location = at(coop); ava.location.x -= 6;
  hens().slice(0, 2).forEach(inPen);
  await run(70);
  check(props.get("kq:pen") !== true && penCheck(true).hens.length === 2, "two hens in: not yet");
  hens().slice(0, 3).forEach(inPen);
  await run(70);
  check(props.get("kq:pen") === true, "three hens in: the pen is done");
  f = await answer(ava, 0);
  check(/hens are/.test(f.b) && /lay eggs/.test(f.b), "Hooray page: the hens will lay eggs");

  // eggs: the hens in the pen lay them; Ava picks them up
  const pickUp = (p) => {
    for (const e of dim.getEntities({ type: "minecraft:item" })) {
      if (Math.hypot(e.location.x - p.location.x, e.location.z - p.location.z) < 12) {
        p.getComponent("minecraft:inventory").container.addItem(new ItemStack("minecraft:egg", 1)); e.remove();
      }
    }
  };
  await run(20 * 30);
  const laid = dim.getEntities({ type: "minecraft:item" });
  check(laid.length >= 2 && laid.length <= 8 && laid.every((e) => e.getComponent("minecraft:item").itemStack.typeId === "minecraft:egg"),
    "the pen lays eggs (" + laid.length + " in 30 s)");
  check(laid.every((e) => Math.abs(e.location.x - cx - 0.5) < 3 && Math.abs(e.location.z - cz - 0.5) < 3), "eggs are laid in the pen");
  pickUp(ava);
  await run(20 * 60);
  check(dim.getEntities({ type: "minecraft:item" }).length <= 8, "no more than 8 eggs lying about");
  pickUp(ava);
  check(ava.eggItems() >= 6, "Ava has eggs (" + ava.eggItems() + ")");
  const before = ava.eggItems();

  // Ben pokes the magic fence
  const iceRing = KINGDOM.rings.find((r) => r.name === "ice");
  const rb = iceRing.gate[0];
  ben.location = { x: iceRing.center[0] + 0.5 + iceRing.r + 1.5, y: 36, z: iceRing.center[1] + 0.5 };
  await run(45);
  check(ben.actionbar.some((t) => /Help the princess first/.test(t)), "the magic fence tells you to help the princess");

  // two players: she needs 10 eggs, from anyone. Ava brings 7 (hitting the princess works too)
  const setEggs = (p, n) => { const inv = p.getComponent("minecraft:inventory").container;
    for (let i = 0; i < inv.size; i++) if (inv.getItem(i)?.typeId === "minecraft:egg") inv.setItem(i, undefined);
    for (let k = 0; k < n; k++) inv.addItem(new ItemStack("minecraft:egg", 1)); };
  setEggs(ava, 7);
  ava.location = at(KINGDOM.princess); ava.location.z += 3;
  await run(5);
  emit("hit", { damagingEntity: ava, hitEntity: princess });
  await run(2);
  f = await answer(ava, btn("Here you go"));
  check(/You have eggs/.test(f.b) && (f.b.match(/\uE101/g) || []).length === 10, "hand-in page: she has 0 of 10");
  await run(10);
  check(props.get("kq:eggs_given") === 7 && ava.eggItems() === 0, "she takes all 7");
  check(stage() === 0, "gate still closed: 3 more to go");
  f = await answer(ava, 0);
  check(/3 more eggs/.test(f.b) && (f.b.match(/\uE100/g) || []).length === 7, "Thank you page: 7 of 10, 3 more");
  tap(ava, princess); await run(2);
  f = await answer(ava, 0);
  check(/3 more eggs/.test(f.b), "talking again: bring 3 more");

  // Ben meets her, closes a page by mistake (X), comes back, and does it all
  ben.location = { ...ava.location };
  await run(5);
  tap(ben, princess); await run(2);
  await answer(ben, btn("Next"));
  await answer(ben, "x");                      // closed: try again later
  check(ben.getDynamicProperty("kq:met") !== true, "closing the story doesn't count as meeting her");
  await run(15);
  tap(ben, princess); await run(2);
  for (let k = 0; k < 5; k++) await answer(ben, btn("Next"));
  await answer(ben, btn("help"));
  await run(10);
  for (let k = 0; k < 2; k++) await answer(ben, btn("Next"));
  await answer(ben, 0);
  tap(ben, princess); await run(2);
  f = await answer(ben, 0);
  check(/hens are in the pen/.test(f.b) && /3 more eggs/.test(f.b), "Ben: the pen is already done, 3 more eggs");
  ben.location = at(coop); ben.location.x -= 2;
  await run(20 * 70);
  pickUp(ben);
  check(ben.eggItems() >= 5, "Ben gets eggs from the pen too (" + ben.eggItems() + ")");
  const benHad = ben.eggItems();
  ben.location = { ...ava.location };
  await run(5);
  tap(ben, princess); await run(2);
  await answer(ben, btn("Here you go"));
  await run(20);
  check(props.get("kq:eggs_given") === 10 && ben.eggItems() === benHad - 3, "Ben gives just the 3 she still needs, keeps the rest");
  check(stage() === 1, "10 eggs: the Ice Palace's gate opens");
  check(sounds.some((s) => s.s === "random.levelup" && s.who === "Ava"), "everyone hears the celebration");
  f = await answer(ava, 0);
  check(/paw prints/.test(f.b) && f.npc.typeId === "kq:book", "Ava's How-To Book tells her to follow the paw prints");
  f = await answer(ben, btn("Next"));
  await answer(ben, btn("Next"));
  f = await answer(ben, btn("go"));
  check(/Ice Palace/.test(f.b), "happy pages point to the Ice Palace");
  await run(30);
  check(princess.getProperty("kq:happy") === true, "princess is happy");
  const left = (name) => KINGDOM.rings.find((r) => r.name === name).gate.filter((c) => blocks.get(K({ x: c[0], y: c[1], z: c[2] })) === "kq:magic_barrier").length;
  const gateLeft = () => left("ice");
  check(gateLeft() > 0, "far-away gate waits until its ground loads");
  // Ben rides along the road and sees paw prints
  particles.length = 0;
  ben.location = at(KINGDOM.trail[60]);
  await run(40);
  const prints = particles.filter((q) => q.id === "kq:pawprint");
  check(prints.length > 10, "paw prints along the road");
  check(prints.every((q) => Number.isInteger(q.dir) && q.dir >= 0 && q.dir < 8), "each paw print points along the road");
  ben.location = at(KINGDOM.iceGate);
  await run(40);
  check(gateLeft() === 0, "the Ice Palace's magic gate opens when Ben gets there");
  for (const r of KINGDOM.rings.filter((r) => r.name !== "ice")) {
    ben.location = at(r.gate[0]); ben.location.x += 3;
    await run(40);
    check(left(r.name) === 0, r.name + " gate opens too (its quest isn't written yet)");
  }
  check(props.get("kq:barriers_left") === 0, "all gates counted open");
  tap(ava, princess); await run(2);
  f = await answer(ava, btn("Next"));
  check(/magic gate is open/.test(f.b), "after: the princess talks about the paw prints");
  await answer(ava, "x");

  // the inns: an inn keeper at each, telling where to sleep and a clue about Graham
  const where = ["Ice Palace", "Blaze Castle", "knights", "Haunted", "beanstalk"];
  for (let i = 0; i < KINGDOM.inns.length; i++) {
    const inn = KINGDOM.inns[i];
    ava.location = at(inn.pos); ava.location.z += 2;
    await run(25);
    const ks = dim.getEntities({ type: "kq:clerk", location: at(inn.pos), maxDistance: 1 });
    check(ks.length === 1 && ks[0].getProperty("kq:look") === i && ks[0].rotation.y === inn.facing, "inn keeper " + inn.clerk + " at the desk");
    if (!ks.length) continue;
    await run(25);
    check(dim.getEntities({ type: "kq:clerk" }).filter((e) => Math.hypot(e.location.x - ks[0].location.x, e.location.z - ks[0].location.z) < 6).length === 1, "only one keeper at the " + inn.name);
    tap(ava, ks[0]); await run(2);
    const pg = [];
    for (let k = 0; k < 3; k++) pg.push(await answer(ava, btn("Next")));
    pg.push(await answer(ava, btn("Thank you")));
    check(new RegExp("I am " + inn.clerk).test(pg[0].b), inn.name + ": the keeper says hello");
    check(/Sleep in a bed/.test(pg[1].b), inn.name + ": where to sleep");
    check(new RegExp(where[i]).test(pg[3].b), inn.name + ": a clue about where Graham went");
  }
  check(KINGDOM.inns.length === 5, "an inn on each road");

  // reset puts it back (barriers as their ground loads)
  emit("scriptEvent", { id: "kq:reset" });
  await run(5);
  check(stage() === 0 && props.get("kq:pen") === false && props.get("kq:eggs_given") === 0, "reset");
  ben.location = at(rb); ben.location.x += 3;
  await run(320);
  check(gateLeft() === iceRing.gate.length, "reset closes the Ice Palace's gate again");

  // one player can bring all 10
  props.set("kq:pen", true);
  ava.location = at(KINGDOM.princess); ava.location.z += 3;
  setEggs(ava, 12);
  ava.setDynamicProperty("kq:met", true);
  await run(5);
  tap(ava, princess); await run(2);
  await answer(ava, btn("Here you go"));
  await run(10);
  check(stage() === 1 && ava.eggItems() === 2, "Ava brings all 10 (keeps 2): the gate opens");
  await answer(ava, "x");

  // a friend leaving can finish it: 5 given with two playing, then Ben leaves
  emit("scriptEvent", { id: "kq:reset" });
  await run(5);
  props.set("kq:pen", true);
  props.set("kq:eggs_given", 5);
  await run(10);
  check(stage() === 0, "5 of 10: still closed");
  players.splice(players.indexOf(ben), 1);
  emit("playerLeave", { playerId: ben.id });
  await run(10);
  check(stage() === 1, "Ben leaves: 5 is enough for Ava alone, the gate opens");

  ava.location = at(KINGDOM.spawn); ava.location.x += 30;
  await run(20 * 12);
  check(dim.getEntities({ type: "kq:book" }).length <= 1, "the How-To Book's page holders are tidied away");
  check(![ava, ben].some((p) => p.actionbar.some((t) => /undefined|NaN/.test(t))), "no hint shows 'undefined'");
  check(pagesShown > 50 && !badPages.length, "no page shows 'undefined' (" + badPages.slice(0, 2).join(" | ") + ")");
  console.log(failures ? `${failures} of ${checks} checks failed` : `OK (${checks} checks)`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log("ERROR", e); process.exit(1); });
