// Runs the Kingdom Quest script against a small fake Minecraft world and checks Chapter 2 (The Dragon's Wing), part 1,
// with two players: the crash (only the day after Chapter 1 ends, in the daytime; not if the map lacks Dragon Land) ->
// the dragon flying in and the boom -> the resting dragon in its crater -> its story pages -> the nest of 4 hay bales
// (hints and the book at each step; hay elsewhere doesn't count, hay taken away doesn't count) -> the field growing
// back -> Pebble at the station -> the lesson (pickaxe, iron, smelting, rails) -> filling the 12-rail gap -> a
// minecart from Pebble -> the ride (a nudge if the cart doesn't start) -> the Crystal Caverns stop -> the magic door
// -> grown-ups' reset and unlock -> the arrow and its trail.
// Usage: node tests/dragon_quest_test.cjs addons/KingdomQuest_BP/scripts/main.js addons/KingdomQuest_BP/scripts/kingdom_data.js
const fs = require("fs");
const data = fs.readFileSync(process.argv[3], "utf8").replace(/^export /m, "");
const fixesSrc = fs.readFileSync(require("path").join(require("path").dirname(process.argv[2]), "world_fixes.js"), "utf8").replace(/^export /m, "");
const here = require("path").dirname(process.argv[2]);
const strip = (f) => fs.readFileSync(require("path").join(here, f), "utf8").replace(/^import .*$/gm, "").replace(/^export /gm, "");
const src = data + "\n" + fixesSrc + "\n" + strip("dragon_data.js") + "\n" + strip("dragon.js") + "\n" +
  fs.readFileSync(process.argv[2], "utf8").replace(/^import .*$/gm, "") +
  "\nglobalThis.__kq = { stage, KINGDOM, DRAGON, CH2 };";

let failures = 0, checks = 0;
function check(ok, msg) { checks++; if (!ok) { failures++; console.log("FAIL: " + msg); } }

let tick = 0, day = 0, timeOfDay = 6000;
const commands = [];
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
  let m = /^\/?dialogue change @s (\S+)$/.exec(cmd);
  if (m) { if (!SCENES[m[1]]) badPages.push("missing scene " + m[1]); npc.dialogue = m[1]; return; }
  m = /^\/?dialogue open @s (?:@initiator|@a\[name="(.+)"\]) (\S+)$/.exec(cmd);
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
      getComponent: (c) => (c === "minecraft:inventory" && v.inv ? { container: v.inv } : undefined),
      setType: (t) => { if (!t.includes(":")) throw new Error("bad block"); blocks.set(K(l), t); },
      setPermutation: (perm) => { blocks.set(K(l), { id: perm.id, states: perm.states }); } };
  },
  spawnItem(stack, loc) {
    if (!dim.loaded(loc)) throw new Error("unloaded");
    const e = dim.spawnEntity("minecraft:item", loc);
    e.extra = (c) => (c === "minecraft:item" ? { itemStack: stack } : undefined);
    return e;
  },
  playSound(s, loc) { sounds.push({ who: "world", s, tick }); },
  runCommand(cmd) { commands.push(cmd); return { successCount: 1 }; },
  spawnEntity(type, loc) {
    if (!dim.loaded(loc)) throw new Error("LocationInUnloadedChunk");
    const ep = new Map(), dp = new Map();
    const e = { id: "e" + nextEnt++, typeId: type, location: { ...loc }, rotation: { x: 0, y: 0 }, removed: false,
      getProperty: (k) => ep.get(k) ?? false, setProperty: (k, v) => ep.set(k, v),
      getDynamicProperty: (k) => dp.get(k), setDynamicProperty: (k, v) => dp.set(k, v),
      teleport(l, o) { e.location = { ...l }; if (o?.rotation) e.rotation = o.rotation; },
      setRotation(r) { e.rotation = r; }, remove() { e.removed = true; dim.entities = dim.entities.filter((x) => x !== e); },
      runCommand(cmd) { if (e.removed) throw new Error("removed"); runCommand(e, cmd); return { successCount: 1 }; },
      events: [], triggerEvent(id) { e.events.push(id); },
      tameable: { tamedTo: undefined },
      getComponent(c) {
        if (c === "minecraft:tameable" && e.typeId === "kq:graham") return { get isTamed() { return !!e.tameable.tamedTo; },
          get tamedToPlayer() { return e.tameable.tamedTo; }, tame(p) { e.tameable.tamedTo = p; return true; } };
        return e.extra?.(c);
      } };
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
    getComponent: (c) => c === "minecraft:riding" ? (p.riding ? { entityRidingOn: p.riding } : undefined) : c === "minecraft:equippable" ? { getEquipment: (slot) => p.equip[slot] } : c === "minecraft:inventory" ? { container: {
      size: 36, getItem: (i) => slots[i], setItem: (i, it) => { slots[i] = it; },
      addItem: (it) => { const i = slots.findIndex((s) => s?.typeId === it.typeId && s.amount + it.amount <= 16);
        if (i >= 0) slots[i].amount += it.amount; else slots[slots.findIndex((s) => !s)] = it; } } } : undefined,
    equip: {},
    getRotation: () => p.rot ?? { x: 0, y: 0 },
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
  getDay: () => day, getTimeOfDay: () => timeOfDay,
  beforeEvents: { playerInteractWithEntity: sub("interact") },
  afterEvents: { entityHitEntity: sub("hit"), playerSpawn: sub("playerSpawn"), playerLeave: sub("playerLeave"), itemUse: sub("itemUse"), dataDrivenEntityTrigger: sub("dataDrivenEntityTrigger"),
    playerPlaceBlock: sub("placeBlock") },
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
const BlockPermutation = { resolve: (id, states) => ({ id, states }) };
props.set("kq:stage", 7);                                         // Chapter 1 is over (Graham came home on day 0)
props.set("kq:end_day", 0);
new Function("world", "system", "ItemStack", "MolangVariableMap", "BlockPermutation", src)(world, system, ItemStack, MolangVariableMap, BlockPermutation);
const { KINGDOM, DRAGON: D, CH2 } = globalThis.__kq;
const at = (a, dy = 0) => ({ x: a[0] + 0.5, y: a[1] + dy, z: a[2] + 0.5 });
const setItems = (p, items) => { const inv = p.inv(); inv.fill(undefined); p.equip = {}; let i = 0;
  for (const [id, n] of Object.entries(items)) inv[i++] = new ItemStack(id, n); };
const lastBar = (p) => p.actionbar[p.actionbar.length - 1] ?? "";
const dragons = () => dim.entities.filter((e) => e.typeId === "kq:dragon");
const place = (p, l, id) => { blocks.set(K({ x: l[0], y: l[1], z: l[2] }), id); emit("placeBlock", { player: p, block: { typeId: id, location: { x: l[0], y: l[1], z: l[2] } } }); };
async function readAll(p, last) {                               // turn every page with Next, then press `last`
  for (let i = 0; i < 12; i++) {
    const f = await answer(p, (f) => f.buttons.findIndex((b) => b.includes("Next")) >= 0 ? f.buttons.findIndex((b) => b.includes("Next")) : btn(last)(f));
    if (!f.buttons.some((b) => b.includes("Next"))) return f;
  }
}
const ch2 = () => props.get("kq:ch2") ?? 0;

const tapNow = (p, e) => { tick += 15; tap(p, e); };      // (a second tap within 12 ticks is ignored)
(async () => {
  // the pages: every Chapter 2 page exists and its buttons work (the general page check is in kingdom_quest_test)
  for (const tag of ["kq_d_crash_1", "kq_d_find", "kq_d_intro_1", "kq_d_thanks_1", "kq_d_wait_0", "kq_d_wait_3", "kq_d_nest_1",
                     "kq_d_happy", "kq_d_part2", "kq_d_b_nestdone", "kq_d_b_nest_0", "kq_d_b_nest_5", "kq_pb_hello", "kq_pb_intro_1",
                     "kq_pb_thanks_1", "kq_pb_wait_0", "kq_pb_wait_11", "kq_pb_fixed_1", "kq_pb_ride", "kq_pb_done", "kq_d_b_pebble",
                     "kq_d_b_track_0", "kq_d_b_track_7", "kq_d_arrive_1", "kq_name_dragon", "kq_name_pebble"])
    check(!!SCENES[tag], "page " + tag);
  check(D.gap.length === 12 && D.track.length > 100, "the track and its 12-rail gap");
  blocks.set(K({ x: D.marker[0], y: D.marker[1], z: D.marker[2] }), D.marker[3]);

  const ava = makePlayer("Ava", at(KINGDOM.spawn));
  const ben = makePlayer("Ben", at(KINGDOM.spawn, 0));
  ben.location.x += 3;

  // ---- not on the day Chapter 1 ended, and not at night
  await run(800);
  check(ch2() === 0 && dragons().length === 0, "no crash on the day Graham came home");
  day = 1; timeOfDay = 15000;
  await run(100);
  check(ch2() === 0, "no crash at night");

  // ---- the crash
  timeOfDay = 3000;
  await run(25);
  check(ch2() === 1, "the next morning, the dragon crashes (" + ch2() + ")");
  check(commands.some((c) => c.startsWith("weather rain")) && !commands.some((c) => c.includes("thunder")), "a storm rolls in (rain, no lightning)");
  const flyer = dragons()[0];
  check(flyer && flyer.getDynamicProperty("kq:flying") && flyer.getProperty("kq:pose") === 2, "the dragon flies in");
  const start = flyer && { ...flyer.location };
  await run(60);
  check(flyer && Math.hypot(flyer.location.x - start.x, flyer.location.z - start.z) > 20 && flyer.location.z > start.z, "it flies toward the crater");
  check(sounds.some((s) => s.s === "mob.enderdragon.growl"), "a roar");
  await run(400);
  check(!CH2.test.flightActive() && dragons().length === 0, "it flies out of sight (and is put away)");
  check(sounds.some((s) => s.s === "random.explode"), "BOOM");
  const crashPage = open.find((o) => o.player === ava);
  check(crashPage?.scene === "kq_d_crash_1", "the How-To Book tells everyone (" + crashPage?.scene + ")");
  await readAll(ava, "OK"); await readAll(ben, "OK");
  await run(30);
  check(/Ender Dragon/.test(ava.actionbar.join("|")), "the arrow points the way to the dragon");
  check(/Something fell from the sky/.test(ava.actionbar.join("|")), "a hint: go and see");
  // the trail: from the spawn to the crater
  check(D.trails.crash[0][2] <= KINGDOM.spawn[2] + 2 && Math.hypot(D.trails.crash.at(-1)[0] - D.dragon[0], D.trails.crash.at(-1)[2] - D.dragon[2]) < 12, "the trail runs from the spawn to the dragon");

  // ---- at the crater
  ava.location = at(D.dragon); ava.location.z -= 8;
  ben.location = { ...ava.location, x: ava.location.x + 2 };
  await run(25);
  const dragon = dragons()[0];
  check(dragon && !dragon.getDynamicProperty("kq:flying") && Math.hypot(dragon.location.x - D.dragon[0] - 0.5, dragon.location.z - D.dragon[2] - 0.5) < 0.5, "the dragon lies in its crater");
  check(dragon?.getProperty("kq:pose") === 0 && dragon?.nameTag === "Ender Dragon" && dragon?.rotation.y === 180, "hurt, named, facing north");
  check(particles.some((q) => q.id === "minecraft:basic_smoke_particle" && Math.abs(q.z - D.dragon[2]) < 6), "smoke rising from the crater");
  // Graham, if he came along, is nervous
  const g = dim.spawnEntity("kq:graham", { ...ava.location, x: ava.location.x - 2 });
  await run(80);
  check(sounds.some((s) => s.s === "mob.wolf.whine"), "Graham whimpers by the big dragon");

  // ---- meeting the dragon
  tapNow(ava, dragon);
  let f = await answer(ava, btn("Next"));
  check(f.scene === "kq_d_intro_1" && /Grrr/.test(f.b), "the dragon: Grrr... Ow!");
  for (let i = 0; i < 4; i++) f = await answer(ava, btn("Next"));
  f = await answer(ava, btn("Yes"));
  check(f.scene === "kq_d_intro_6" && /soft bed/.test(f.b), "can you make me a soft bed?");
  check(ch2() === 2 && ava.getDynamicProperty("kq:dmet1") === true, "Ava said yes: the nest quest is on");
  check(ava.inv().some((s) => s?.typeId === "kq:guide"), "she has her How-To Book");
  f = await readAll(ava, "OK");
  check(/wheat/.test(f.b), "there is wheat in the field by me");
  // Ben hasn't met it: tapping gives him the start of the story
  tapNow(ben, dragon);
  f = await answer(ben, "x");
  check(f.scene === "kq_d_intro_1", "Ben hears it from the start");

  // ---- the nest: the lesson follows what she's carrying
  const stepOf = (p) => CH2.test.nestStep(p);
  setItems(ava, { "kq:guide": 1 });
  check(stepOf(ava) === 0, "step 0: go to the wheat field");
  ava.location = at(D.field);
  check(stepOf(ava) === 1, "step 1: pick the wheat");
  setItems(ava, { "kq:guide": 1, "minecraft:wheat": 9 });
  check(stepOf(ava) === 2, "step 2: make a hay bale");
  emit("itemUse", { source: ava, itemStack: new ItemStack("kq:guide") }); await run(5);
  f = await answer(ava, "x");
  check(f.scene === "kq_d_b_nest_2" && /9 wheat/.test(f.b), "the book opens at: make a hay bale (" + f.scene + ")");
  setItems(ava, { "kq:guide": 1, "minecraft:hay_block": 4 });
  check(stepOf(ava) === 3, "step 3: put it down by the dragon");
  await run(45);
  check(/hay bale down by the dragon/.test(ava.actionbar.join("|")), "the hint says so too");
  // hay far away doesn't count; hay by the dragon does (once per spot)
  const d0 = D.dragon;
  ava.location = at(d0); ava.location.z -= 8;
  place(ava, [d0[0] + 30, d0[1], d0[2]], "minecraft:hay_block");
  check(CH2.test.hayCount() === 0, "hay far from the dragon doesn't count");
  place(ava, [d0[0] + 4, d0[1], d0[2] + 2], "minecraft:hay_block");
  place(ava, [d0[0] + 4, d0[1], d0[2] + 2], "minecraft:hay_block");
  check(CH2.test.hayCount() === 1 && /1 of 4 hay bales/.test(lastBar(ava)), "1 of 4 hay bales!");
  place(ava, [d0[0] - 4, d0[1], d0[2] + 2], "minecraft:hay_block");
  blocks.set(K({ x: d0[0] - 4, y: d0[1], z: d0[2] + 2 }), "minecraft:air");      // Ben picks one back up
  check(CH2.test.hayCount() === 1, "a hay bale taken away doesn't count");
  tapNow(ava, dragon);
  f = await answer(ava, "x");
  check(f.scene === "kq_d_wait_1" && /3 more/.test(f.b), "the dragon: 1 of 4, I need 3 more");
  // the field grows back while the nest is being made
  const [fx0, fz0, fx1, fz1] = D.fieldBox, fy = D.field[1];
  let cleared = 0;
  for (let x = fx0; x <= fx1; x++) for (let z = fz0; z <= fz1; z++) if (z !== D.field[2]) { blocks.set(K({ x, y: fy, z }), "minecraft:air"); blocks.set(K({ x, y: fy - 1, z }), "minecraft:farmland"); cleared++; }
  ben.location = at([D.field[0], D.field[1], D.field[2] - 20]);
  await run(20 * 45);
  let regrown = 0;
  for (let x = fx0; x <= fx1; x++) for (let z = fz0; z <= fz1; z++) { const v = blocks.get(K({ x, y: fy, z })); if (v?.id === "minecraft:wheat" && v.states.growth === 7) regrown++; }
  check(regrown >= 6, "the wheat grows back (" + regrown + " of " + cleared + ")");
  // three more: the bed is done
  for (const [dx, dz] of [[-4, 2], [0, 6], [-5, -2]]) place(ava, [d0[0] + dx, d0[1], d0[2] + dz], "minecraft:hay_block");
  check(ch2() === 3, "4 hay bales: the nest is done");
  await run(15);
  check(dragon.getProperty("kq:pose") === 1, "the dragon is comfy (happy pose)");
  f = await answer(ava, btn("Next"));
  check(f.scene === "kq_d_nest_1" && /So soft/.test(f.b), "Ahh! So soft! Thank you!");
  f = await readAll(ava, "OK");
  check(/Pebble/.test(f.b), "go down the stairs, find Pebble");
  f = await answer(ben, "x");
  check(f.scene === "kq_d_b_nestdone", "Ben's book: the dragon has a bed");
  await run(60);
  check(particles.some((q) => q.id === "minecraft:heart_particle" && Math.hypot(q.x - g.location.x, q.z - g.location.z) < 1), "Graham and the dragon are friends now");
  tapNow(ava, dragon); f = await answer(ava, "x");
  check(f.scene === "kq_d_happy", "the dragon: find Pebble at the train");

  // ---- the arrow down to the station, and Pebble
  ava.location = at(D.dragon); ava.location.z -= 8;
  await run(30);
  check(/Pebble/.test(ava.actionbar.slice(-6).join("|")), "the arrow points to Pebble");
  check(D.trails.station.at(-1)[1] < D.dragon[1] - 20, "the trail goes down the stairs");
  ava.location = at(D.pebble); ava.location.z += 3;
  ben.location = { ...ava.location, x: ava.location.x + 2 };
  await run(25);
  const pebble = dim.entities.find((e) => e.typeId === "kq:clerk" && e.getDynamicProperty("kq:key") === "pebble");
  check(pebble && pebble.getProperty("kq:look") === 6 && pebble.nameTag === "Pebble", "Pebble the miner is at his counter");
  tapNow(ava, pebble);
  f = await answer(ava, btn("Next"));
  check(f.scene === "kq_pb_intro_1" && /Pebble/.test(f.b), "Hello! I am Pebble.");
  f = await answer(ava, btn("Next"));
  f = await answer(ava, btn("Yes"));
  check(/new rails/.test(f.b) && ava.getDynamicProperty("kq:dmet2") === true, "can you make new rails? Yes!");
  f = await readAll(ava, "OK");
  check(/orange spots/.test(f.b), "Look! Iron in the walls!");
  // the lesson
  const tstep = (p) => CH2.test.trackStep(p);
  setItems(ava, { "kq:guide": 1 });
  check(tstep(ava) === 0, "step 0: get a pickaxe");
  setItems(ava, { "kq:guide": 1, "minecraft:stone_pickaxe": 1 });
  check(tstep(ava) === 1, "step 1: mine iron");
  setItems(ava, { "kq:guide": 1, "minecraft:stone_pickaxe": 1, "minecraft:raw_iron": 6 });
  check(tstep(ava) === 2, "step 2: smelt it");
  setItems(ava, { "kq:guide": 1, "minecraft:iron_ingot": 6, "minecraft:stick": 1 });
  check(tstep(ava) === 3, "step 3: make rails");
  setItems(ava, { "kq:guide": 1, "minecraft:rail": 16 });
  check(tstep(ava) === 4, "step 4: lay them");
  emit("itemUse", { source: ava, itemStack: new ItemStack("kq:guide") }); await run(5);
  f = await answer(ava, "x");
  check(f.scene === "kq_d_b_track_4", "the book: put the rails on the broken track (" + f.scene + ")");
  // the station chest restocks a pickaxe and coal when nobody has any
  const sc = D.stationChest, chestSlots = [];
  blocks.set(K({ x: sc[0], y: sc[1], z: sc[2] }), { id: "minecraft:chest", inv: { size: 27, getItem: (i) => chestSlots[i], setItem: (i, it) => { chestSlots[i] = it; },
    addItem: (it) => chestSlots.push(it) } });
  await run(20 * 31);
  check(chestSlots.some((s) => s?.typeId === "minecraft:stone_pickaxe") && chestSlots.some((s) => s?.typeId === "minecraft:coal"), "the chest has a pickaxe and coal again");
  // Pebble before it's fixed
  tapNow(ava, pebble); f = await answer(ava, "x");
  check(f.scene === "kq_pb_wait_0", "Pebble: fill the gap");
  // the gap, one rail at a time
  D.gap.slice(0, 11).forEach((p) => place(ava, p, "minecraft:rail"));
  check(CH2.test.gapCount() === 11 && /11 of 12 rails/.test(lastBar(ava)) && !CH2.test.isFixed(), "11 of 12 rails!");
  place(ava, [D.gap[0][0], D.gap[0][1] + 3, D.gap[0][2]], "minecraft:rail");
  check(!CH2.test.isFixed(), "a rail somewhere else doesn't count");
  place(ava, D.gap[11], "minecraft:rail");
  check(CH2.test.isFixed() && /track is fixed/.test(lastBar(ava)), "the track is fixed! Tap Pebble!");
  check(tstep(ava) === 5, "step 5: tap Pebble");
  tapNow(ava, pebble);
  f = await answer(ava, btn("Next"));
  check(f.scene === "kq_pb_fixed_1", "You fixed my track!");
  f = await answer(ava, btn("Thank you"));
  check(ava.inv().some((s) => s?.typeId === "minecraft:minecart") && ava.getDynamicProperty("kq:got_cart") === true, "a minecart from Pebble");
  f = await answer(ava, "x");
  check(f.scene === "kq_pb_ride" && /button/.test(f.b), "put it on the track, get in, push the button");
  check(tstep(ava) === 6, "step 6: get in");
  tapNow(ben, pebble); f = await answer(ben, "x");
  check(f.scene === "kq_pb_intro_1", "Ben meets Pebble from the start");

  // ---- the ride
  const impulses = [];
  const cart = { typeId: "minecraft:minecart", applyImpulse: (v) => impulses.push(v) };
  ava.riding = cart;
  ava.location = at(D.start, 0.3);
  check(tstep(ava) === 7, "step 7: push the button");
  await run(40);
  check(/Push the button/.test(ava.actionbar.join("|")), "a reminder: push the button");
  await run(60);
  check(impulses.length >= 1 && impulses[0].x > 0, "if the cart won't start, off it goes anyway (east)");
  ava.location = at(D.track[60]);
  await run(15);
  check(ch2() === 3, "not there yet halfway");
  ava.location = at(D.stop, 0.3);
  await run(15);
  check(ch2() === 4, "the Crystal Caverns stop: part 1 done");
  ava.riding = undefined;
  f = await answer(ava, btn("Next"));
  check(f.scene === "kq_d_arrive_1" && /made it/.test(f.b), "You made it! The Crystal Caverns!");
  await answer(ava, "x");
  ava.location = at(D.crystalDoor[4]); ava.location.x -= 1.5;
  await run(25);
  check(/magic door/.test(ava.actionbar.join("|")), "the magic door chimes");
  tapNow(ava, pebble); f = await answer(ava, "x");
  check(f.scene === "kq_pb_done", "Pebble: more soon");

  // ---- grown-ups: reset, then unlock through it all
  emit("scriptEvent", { id: "kq:ch2reset" });
  check(ch2() === 0 && ava.getDynamicProperty("kq:dmet1") === undefined && dragons().length === 0, "kq:ch2reset starts Chapter 2 again");
  check(D.gap.every((p) => (blocks.get(K({ x: p[0], y: p[1], z: p[2] })) ?? "minecraft:air") === "minecraft:air"), "the gap is open again (ava is near it)");
  ava.location = at(KINGDOM.spawn);
  for (const want of [1, 2, 3]) { emit("scriptEvent", { id: "kq:unlock" }); await run(2); check(ch2() === want, "kq:unlock -> " + want); }
  ava.location = at(D.pebble); await run(2);
  emit("scriptEvent", { id: "kq:unlock" });
  check(CH2.test.isFixed() && D.gap.every((p) => blocks.get(K({ x: p[0], y: p[1], z: p[2] }))?.id === "minecraft:rail"), "kq:unlock lays the rails");
  emit("scriptEvent", { id: "kq:unlock" });
  check(ch2() === 4, "kq:unlock -> arrived");

  // ---- a world without Dragon Land (packs updated, map not): no crash
  emit("scriptEvent", { id: "kq:ch2reset" });
  ava.location = at(KINGDOM.spawn); ben.location = at(KINGDOM.spawn);
  blocks.set(K({ x: D.marker[0], y: D.marker[1], z: D.marker[2] }), "minecraft:dirt");
  await run(60);
  check(ch2() === 0 && props.get("kq:ch2_missing") === true && dragons().length === 0, "no Dragon Land in the map: the story waits");
  blocks.set(K({ x: D.marker[0], y: D.marker[1], z: D.marker[2] }), D.marker[3]);
  props.set("kq:ch2_missing", false);
  emit("scriptEvent", { id: "kq:ch2" });
  check(ch2() === 1, "kq:ch2 starts it now");

  check(!badPages.length, "every page opened exists: " + badPages.slice(0, 3).join(", "));
  console.log(failures ? `${failures} FAILED (of ${checks} checks)` : `OK (${checks} checks)`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log("CRASH", e); process.exit(1); });
