// Runs the Groundskeeper Elves script against a small fake Minecraft world and checks the story:
// the shed is given on first join; putting it up moves in two named elves; every morning (once a day) they
// come out of the shed, mow short and tall grass, shovel snow and rake leaf litter in the yard (and nothing
// else: flowers, roof snow, grass outside the yard stay), never walk into walls, fences or water, build a
// composter next to the shed and fill it, leave snowballs and bone meal in a chest by the shed, go back
// inside and say what they did. Plus the shed menu (job switches, call out / send home, asleep at night),
// tapping and walking up to an elf, breaking the shed mid-shift, reloading mid-shift, and /scriptevent.
// Usage: node tests/groundskeeper_test.cjs addons/Groundskeepers_BP/scripts/main.js
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8").replace(/^import .*$/gm, "");

let tick = 0, time = 500, day = 1;
const dyn = new Map();
const handlers = {};
let timers = [];
let nextId = 1;
const system = {
  get currentTick() { return tick; },
  runInterval: (fn, n) => { const id = nextId++; timers.push({ id, fn, every: n || 1, at: tick + (n || 1) }); return id; },
  runTimeout: (fn, n) => { const id = nextId++; timers.push({ id, fn, once: true, at: tick + (n || 1) }); return id; },
  run: (fn) => system.runTimeout(fn, 1),
  clearRun: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  afterEvents: { scriptEventReceive: { subscribe: (fn) => (handlers.script = fn) } },
};
class ItemStack {
  constructor(typeId, amount = 1) {
    if (!typeId.includes(":")) throw new Error("bad item");
    this.typeId = typeId; this.amount = amount;
  }
}
class MolangVariableMap { setColorRGB(k, c) { this.color = c; } }
class Perm {
  constructor(id, states = {}) { this.typeId = id; this.states = states; }
  get type() { return { id: this.typeId }; }
  getState(n) { return this.states[n]; }
  withState(n, v) { return new Perm(this.typeId, { ...this.states, [n]: v }); }
}
const BlockPermutation = { resolve: (id, states) => new Perm(id, states) };
const forms = [], formAnswers = [];
class ActionFormData {
  constructor() { this.buttons = []; }
  title(t) { this.t = t; return this; }
  body(b) { this.b = b; return this; }
  button(b) { this.buttons.push(b); return this; }
  show() { forms.push(this); return Promise.resolve(formAnswers.shift() ?? { canceled: true }); }
}

// ---------- The world ----------
// Flat grass at y 63 (stand at 64). A pond, a fence, a little house with snow on its roof, and plenty of mess.
const blocks = new Map();
const chests = new Map();
const K = (x, y, z) => `${x},${y},${z}`;
const SHED_AT = { x: 0, y: 64, z: 0 };
const inPond = (x, z) => x >= -9 && x <= -6 && z >= -9 && z <= -6;
function permAt(x, y, z) {
  const k = K(x, y, z);
  if (blocks.has(k)) return blocks.get(k);
  if (y === 63 && inPond(x, z)) return new Perm("minecraft:water");
  if (y <= 63) return new Perm("minecraft:grass_block");
  return new Perm("minecraft:air");
}
const typeAt = (x, y, z) => permAt(x, y, z).typeId;
const put = (x, y, z, id, states = {}) => blocks.set(K(x, y, z), new Perm(id, states));
const r2 = (x, z) => x * x + z * z;
const YARD = 12;
const inYard = (x, z) => r2(x, z) <= YARD * YARD + 1;

// House (planks) at x 6..10, z 6..10 with a snowy roof.
for (let x = 6; x <= 10; x++) for (let z = 6; z <= 10; z++) {
  for (let y = 64; y <= 66; y++) if (x === 6 || x === 10 || z === 6 || z === 10) put(x, y, z, "minecraft:oak_planks");
  put(x, 67, z, "minecraft:oak_planks");
  put(x, 68, z, "minecraft:snow_layer", { height: 1 });
}
for (let z = -11; z <= -3; z++) put(-3, 64, z, "minecraft:oak_fence");         // a fence line
let seed = 7;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const mess = { grass: [], tall: [], snow: [], leaves: [], flowers: [], outside: [] };
for (let x = -15; x <= 15; x++) for (let z = -15; z <= 15; z++) {
  if (blocks.has(K(x, 64, z)) || inPond(x, z) || (x === 0 && z === 0) || (x >= 6 && x <= 10 && z >= 6 && z <= 10)) continue;
  if (Math.abs(x) <= 1 && z >= 0 && z <= 2) continue; // keep the doorway clear
  const r = rnd();
  if (!inYard(x, z)) {
    if (r < 0.4 && r2(x, z) <= 15 * 15) { put(x, 64, z, "minecraft:short_grass"); mess.outside.push([x, z]); }
    continue;
  }
  if (x <= -4 && z >= 3) {                                                        // snowy corner
    if (r < 0.75) { put(x, 64, z, "minecraft:snow_layer", { height: Math.floor(rnd() * 3) }); mess.snow.push([x, z]); }
  } else if (x >= 3 && z <= -3) {                                                 // leafy corner
    if (r < 0.6) { put(x, 64, z, "minecraft:leaf_litter"); mess.leaves.push([x, z]); }
  } else if (r < 0.3) { put(x, 64, z, "minecraft:short_grass"); mess.grass.push([x, z]); }
  else if (r < 0.38) {
    put(x, 64, z, "minecraft:tall_grass", { upper_block_bit: false }); put(x, 65, z, "minecraft:tall_grass", { upper_block_bit: true });
    mess.tall.push([x, z]);
  } else if (r < 0.44) { put(x, 64, z, "minecraft:poppy"); mess.flowers.push([x, z]); }
}

const entities = [], dropped = [], particles = [], sounds = [], spawned = [];
function makeBlock(x, y, z) {
  const perm = permAt(x, y, z);
  return {
    typeId: perm.typeId, location: { x, y, z }, permutation: perm, dimension: dim,
    setPermutation(p) { blocks.set(K(x, y, z), p); changes.push({ x, y, z, id: p.typeId, tick }); },
    getComponent(n) {
      if (n !== "minecraft:inventory" || !/chest|barrel/.test(perm.typeId)) return undefined;
      if (!chests.has(K(x, y, z))) chests.set(K(x, y, z), { items: [], addItem(it) { this.items.push(it); } });
      return { container: chests.get(K(x, y, z)) };
    },
  };
}
const changes = [];
const dim = {
  id: "minecraft:overworld",
  getBlock(l) {
    const x = Math.floor(l.x), y = Math.floor(l.y), z = Math.floor(l.z);
    if (y > 320 || y < -64) return undefined;
    return makeBlock(x, y, z);
  },
  spawnEntity(type, loc) {
    const e = {
      typeId: type, id: "e" + nextId++, location: { ...loc }, spawnTick: tick, spawnTime: time, valid: true, nameTag: "", events: [], path: [{ ...loc }],
      teleport(p) { this.location = { ...p }; this.path.push({ ...p, tick }); },
      triggerEvent(ev) { this.events.push(ev); },
      isValid() { return this.valid; },
      remove() { this.valid = false; const i = entities.indexOf(this); if (i >= 0) entities.splice(i, 1); },
    };
    entities.push(e); spawned.push(e);
    return e;
  },
  getEntities({ type }) { return entities.filter((e) => e.typeId === type); },
  spawnParticle(id, loc, vars) { particles.push({ id, loc, color: vars?.color, tick }); },
  spawnItem(item, loc) { dropped.push({ item, loc, tick }); },
};
function makePlayer(name, x, z) {
  const inv = { items: [], addItem(it) { this.items.push(it); } };
  const props = new Map();
  return {
    name, id: name, typeId: "minecraft:player", location: { x, y: 64, z }, dimension: dim, messages: [], bars: [],
    sendMessage(m) { this.messages.push(m); },
    playSound() {},
    onScreenDisplay: { setActionBar(t) { bars.push(t); }, setTitle() {} },
    getComponent: () => ({ container: inv }), inv,
    getDynamicProperty: (k) => props.get(k), setDynamicProperty: (k, v) => props.set(k, v),
  };
}
const bars = [];
const players = [makePlayer("Havana", 0, 20), makePlayer("Jeff", 3, 30)];
for (const p of players) p.onScreenDisplay = { setActionBar: (t) => p.bars.push(t), setTitle() {} };
const world = {
  getDynamicProperty: (k) => dyn.get(k), setDynamicProperty: (k, v) => (v === undefined ? dyn.delete(k) : dyn.set(k, v)),
  getDay: () => day, getTimeOfDay: () => time,
  getAllPlayers: () => players, getDimension: () => dim,
  playSound(id, loc) { sounds.push({ id, loc, tick }); },
  afterEvents: {
    playerSpawn: { subscribe: (fn) => (handlers.spawn = fn) },
    playerPlaceBlock: { subscribe: (fn) => (handlers.place = fn) },
    playerBreakBlock: { subscribe: (fn) => (handlers.break = fn) },
  },
  beforeEvents: {
    playerInteractWithEntity: { subscribe: (fn) => (handlers.tapEntity = fn) },
    playerInteractWithBlock: { subscribe: (fn) => (handlers.tapBlock = fn) },
  },
};
const load = () => new Function("world", "system", "ItemStack", "MolangVariableMap", "BlockPermutation", "ActionFormData", src)(
  world, system, ItemStack, MolangVariableMap, BlockPermutation, ActionFormData);
load();

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
const settle = () => new Promise((r) => setImmediate(r));
async function flush(n = 3) {
  for (let i = 0; i < n; i++) { await settle(); advance(1); }
}
let failures = 0;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failures++; };
const elves = () => entities.filter((e) => e.typeId === "grounds:elf");
const shedRecord = () => JSON.parse(dyn.get("grounds:sheds") || "[]")[0];
const allMsgs = (p) => p.messages.join("\n");
const isClearId = (id) => /air|grass$|tall_grass|snow_layer|leaf_litter|poppy/.test(id) && id !== "minecraft:grass_block";

// Watches every elf every tick: no walking into walls, fences, the shed or water.
const watch = { bad: [], elfTicks: 0 };
function watchElves() {
  for (const e of elves()) {
    watch.elfTicks++;
    const l = e.location, x = Math.floor(l.x), y = Math.floor(l.y + 0.01), z = Math.floor(l.z);
    const feet = typeAt(x, y, z), under = typeAt(x, y - 1, z);
    if (/planks|fence|grounds:|composter|chest|water/.test(feet) || /water|fence/.test(under)) watch.bad.push(`${e.nameTag}@${l.x.toFixed(1)},${l.y.toFixed(1)},${l.z.toFixed(1)} in ${feet} on ${under}`);
  }
}

(async () => {
  // ---------- First join: a shed in your pocket ----------
  handlers.spawn({ player: players[0], initialSpawn: true });
  advance(130);
  check(players[0].inv.items.some((i) => i.typeId === "grounds:elf_shed"), "first join gives an Elf Shed");
  check(allMsgs(players[0]).includes("You got an Elf Shed"), "and says what it's for");
  handlers.spawn({ player: players[0], initialSpawn: true });
  advance(130);
  check(players[0].inv.items.filter((i) => i.typeId === "grounds:elf_shed").length === 1, "only once");

  // ---------- Putting up the shed (before sunrise) ----------
  time = 500;
  put(0, 64, 0, "grounds:elf_shed", { "minecraft:cardinal_direction": "south", "grounds:open": false });
  handlers.place({ player: players[0], block: dim.getBlock(SHED_AT) });
  const rec = shedRecord();
  check(rec && rec.elves.length === 2 && rec.elves[0].name !== rec.elves[1].name && rec.elves[0].look !== rec.elves[1].look,
    `two elves move in: ${rec.elves.map((e) => e.name + " (" + ["green", "red", "blue", "purple"][e.look] + ")").join(" and ")}`);
  check(allMsgs(players[0]).includes("moved in") && allMsgs(players[0]).includes("in the morning"), "early in the morning: they'll come out when it's time");
  advance(400);
  check(!elves().length, "nobody comes out before the start time");

  // ---------- The first morning ----------
  const before = { grass: mess.grass.length, tall: mess.tall.length, snow: mess.snow.length, leaves: mess.leaves.length };
  advance(1000 - time + 60);
  check(elves().length === 2 && spawned[0].spawnTime >= 1000 && spawned[0].spawnTime < 1030, `an elf comes out at the start of the day (time ${spawned[0]?.spawnTime})`);
  check(spawned[1].spawnTick - spawned[0].spawnTick >= 20, "then the second one");
  check(spawned.every((e) => Math.abs(e.path[0].z - 1.5) < 0.01 && Math.abs(e.path[0].x - 0.5) < 0.01), "they come out the shed door (in front of it)");
  check(permAt(0, 64, 0).getState("grounds:open") === true, "the shed door opens");
  check(allMsgs(players[0]).includes("came out of the Elf Shed"), "chat says they came out");
  check(spawned.every((e) => e.nameTag && e.events.some((v) => /grounds:look_[0-3]/.test(v))), "each elf has its name and outfit");
  onTick = watchElves;
  let guard = 0;
  while (elves().length && guard++ < 80) advance(100);
  onTick = null;
  const left = (list, id) => list.filter(([x, z]) => typeAt(x, 64, z) === id);
  check(!left(mess.grass, "minecraft:short_grass").length, `all the short grass in the yard is mowed (${before.grass})`);
  check(!left(mess.tall, "minecraft:tall_grass").length && mess.tall.every(([x, z]) => typeAt(x, 65, z) === "minecraft:air"), `tall grass mowed, both halves (${before.tall})`);
  check(!left(mess.snow, "minecraft:snow_layer").length, `snow shoveled (${before.snow})`);
  check(!left(mess.leaves, "minecraft:leaf_litter").length, `leaves raked (${before.leaves})`);
  check(left(mess.flowers, "minecraft:poppy").length === mess.flowers.length, `flowers left alone (${mess.flowers.length})`);
  check(left(mess.outside, "minecraft:short_grass").length === mess.outside.length, `grass outside the yard left alone (${mess.outside.length})`);
  let roof = 0;
  for (let x = 6; x <= 10; x++) for (let z = 6; z <= 10; z++) roof += typeAt(x, 68, z) === "minecraft:snow_layer";
  check(roof === 25, "snow on the house roof left alone");
  check(!watch.bad.length, `never walks into a wall, fence, the shed or water (${watch.bad.length} bad spots${watch.bad.length ? ": " + watch.bad.slice(0, 3).join("; ") : ""})`);
  // Small smooth steps; the only big moves are magic hops when an elf is stuck (should be rare).
  let steps = 0, odd = 0, hops = 0;
  for (const e of spawned) {
    for (let i = 1; i < e.path.length; i++) {
      const a = e.path[i - 1], b = e.path[i], d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d > 0) steps++;
      if (d > 0.13 && d < 0.6) odd++;
      if (d >= 0.6) hops++;
    }
  }
  check(steps > 500 && odd === 0, `walks in small steps (${steps} steps, ${odd} lurches)`);
  check(hops <= 6, `hardly ever needs a magic hop (${hops})`);
  check(time < 12300, `done before sunset (time ${time})`);
  check(!elves().length && spawned.every((e) => !e.valid), "both elves go back inside");
  check(permAt(0, 64, 0).getState("grounds:open") === false, "the shed door closes");
  const comp = permAt(1, 64, 0);
  check(comp.typeId === "minecraft:composter", `they built a composter next to the shed (${typeAt(1, 64, 0)} at the east side)`);
  check(allMsgs(players[0]).includes("built a composter"), "and said so");
  check(comp.getState("composter_fill_level") >= 1, `clippings went in the composter (level ${comp.getState("composter_fill_level")})`);
  check(shedRecord().built === true, "the shed remembers it built a composter");
  const sum = players[0].messages.find((m) => m.includes("done for today"));
  check(sum && /mowed \d+ grass/.test(sum) && /shoveled \d+ snow/.test(sum) && /raked \d+ leaves/.test(sum), `summary: ${sum}`);
  const mowed = Number(/mowed (\d+)/.exec(sum)[1]);
  check(mowed === before.grass + before.tall, `the count is right (${mowed} = ${before.grass} short + ${before.tall} tall)`);
  check(sounds.some((s) => s.id === "mob.sheep.shear") && sounds.some((s) => s.id === "dig.snow") && sounds.some((s) => /composter/.test(s.id)), "snipping, shoveling and composter sounds");
  const colors = new Set(particles.filter((p) => p.id === "grounds:bits").map((p) => JSON.stringify(p.color)));
  check(colors.size >= 6, `clippings, snow and leaf bits fly (${colors.size} colors)`);
  const ev = spawned[0].events;
  check(["grounds:tool_1", "grounds:tool_2", "grounds:tool_3", "grounds:work", "grounds:walk"].every((v) => ev.includes(v) || spawned[1].events.includes(v)),
    "they switch tools (sickle, shovel, rake) and walk/work");
  check(spawned.some((e) => e.events.includes("grounds:tool_4")), "they carry a sack of clippings to the composter");
  console.log(`   (elf-ticks: ${watch.elfTicks}, finished at time ${time})`);

  // ---------- Only once a day ----------
  const n0 = spawned.length;
  advance(11000 - time + 100);
  check(spawned.length === n0, "they don't come out again the same day");

  // ---------- Next morning: a chest by the shed, fresh snow, a full composter ----------
  put(-1, 64, 0, "minecraft:chest");
  for (const [x, z] of mess.snow) put(x, 64, z, "minecraft:snow_layer", { height: 3 });
  blocks.set(K(1, 64, 0), new Perm("minecraft:composter", { composter_fill_level: 8 }));
  for (const [x, z] of mess.grass.slice(0, 20)) put(x, 64, z, "minecraft:short_grass");
  players[0].messages.length = 0;
  advance(24000 - time + 1100);
  check(spawned.length === n0 + 2, "they come out again the next morning");
  guard = 0;
  while (elves().length && guard++ < 80) advance(100);
  const chest = chests.get(K(-1, 64, 0));
  const balls = chest ? chest.items.filter((i) => i.typeId === "minecraft:snowball").reduce((a, i) => a + i.amount, 0) : 0;
  const meal = chest ? chest.items.filter((i) => i.typeId === "minecraft:bone_meal").reduce((a, i) => a + i.amount, 0) : 0;
  check(balls > 0 && chest.items.every((i) => i.typeId !== "minecraft:snowball" || i.amount <= 16), `snowballs in the chest (${balls}, in stacks of 16)`);
  check(meal >= 1, `bone meal from the full composter in the chest (${meal})`);
  check(allMsgs(players[0]).includes("in the chest by the shed"), `summary mentions the chest: ${players[0].messages.find((m) => m.includes("chest"))}`);
  check(!left(mess.snow, "minecraft:snow_layer").length, "fresh snow shoveled again");

  // ---------- The shed menu ----------
  advance(3000);
  formAnswers.push({ selection: 1 }, { selection: 6 });
  const tapEv = { block: dim.getBlock(SHED_AT), player: players[0], cancel: false, isFirstEvent: true };
  handlers.tapBlock(tapEv);
  check(tapEv.cancel, "tapping the shed is caught (doesn't place a block on it)");
  await flush(4);
  check(forms.length >= 2 && forms[0].t === "Elf Shed" && forms[0].b.includes(rec.elves[0].name) && forms[0].b.includes("already tidied up today"), "menu shows who lives there and that today's chores are done");
  check(forms[0].buttons.some((b) => b.startsWith("Mow grass: §2ON")) && forms[1].buttons.some((b) => b.startsWith("Mow grass: §cOFF")), "mowing switched off");
  check(shedRecord().jobs.mow === false, "and remembered");
  // Grass grows back; the next day they leave it.
  for (const [x, z] of mess.grass) put(x, 64, z, "minecraft:short_grass");
  players[0].messages.length = 0;
  advance(24000 - time + 1100);
  guard = 0;
  while (elves().length && guard++ < 80) advance(100);
  check(left(mess.grass, "minecraft:short_grass").length === mess.grass.length, "with mowing off, the grass stays");
  check(allMsgs(players[0]).includes("everything's tidy"), `nothing else to do: "${players[0].messages.find((m) => m.includes("everything's tidy"))}"`);
  formAnswers.push({ selection: 1 }, { selection: 5 }, { selection: 5 }, { selection: 5 }, { selection: 6 });
  handlers.tapBlock({ block: dim.getBlock(SHED_AT), player: players[0], cancel: false, isFirstEvent: true });
  await flush(8);
  check(shedRecord().jobs.mow === true && shedRecord().yard === 1, "mowing back on; yard size goes Large, Small, back to Medium");
  check(forms.some((f) => f.buttons.some((b) => b.includes("Large (16 blocks)"))) && forms.some((f) => f.buttons.some((b) => b.includes("Small (8 blocks)"))), "yard size button shows the size");

  // ---------- Calling them out now, and sending them home ----------
  formAnswers.push({ selection: 0 });
  handlers.tapBlock({ block: dim.getBlock(SHED_AT), player: players[0], cancel: false, isFirstEvent: true });
  await flush(3);
  advance(40);
  check(elves().length === 2, "'Call the elves out now' brings them out even after today's chores");
  // ---------- Walking up to an elf ----------
  const e0 = elves()[0];
  players[0].location = { x: e0.location.x + 1, y: 64, z: e0.location.z + 1 };
  advance(12);
  check(players[0].bars.some((b) => b.includes(e0.nameTag + ":") && b.includes("Hi Havana")), `walk up and the elf says hi: "${players[0].bars.find((b) => b.includes("Hi Havana"))}"`);
  check(e0.events.includes("grounds:wave"), "and waves");
  // ---------- Tapping an elf ----------
  const tapE = { target: elves()[1], player: players[1], cancel: false };
  handlers.tapEntity(tapE);
  advance(2);
  check(tapE.cancel && players[1].messages.some((m) => m.startsWith(`§2${elves()[1].nameTag}: `)), `tap an elf and it talks: "${players[1].messages.at(-1)}"`);
  players[0].location = { x: 0, y: 64, z: 20 };
  formAnswers.push({ selection: 0 });
  handlers.tapBlock({ block: dim.getBlock(SHED_AT), player: players[0], cancel: false, isFirstEvent: true });
  await flush(3);
  check(allMsgs(players[0]).includes("heading home"), "'Send the elves home' sends them home");
  guard = 0;
  while (elves().length && guard++ < 30) advance(100);
  check(!elves().length, "and they go in");

  // ---------- At night they're asleep ----------
  advance(24000 - time + 15000);
  const nightN = spawned.length;
  formAnswers.push({ selection: 0 });
  handlers.tapBlock({ block: dim.getBlock(SHED_AT), player: players[0], cancel: false, isFirstEvent: true });
  await flush(3);
  advance(60);
  check(spawned.length === nightN && allMsgs(players[0]).includes("asleep"), "at night the elves are asleep and stay in");

  // ---------- /scriptevent grounds:shift ----------
  advance(24000 - time + 500); // early morning, before they'd come out on their own
  handlers.script({ id: "grounds:shift", sourceEntity: players[0] });
  advance(40);
  check(elves().length === 2, "/scriptevent grounds:shift sends them out right away");

  // ---------- Breaking the shed in the middle of a shift ----------
  put(0, 64, 0, "minecraft:air");
  handlers.break({ player: players[0], block: dim.getBlock(SHED_AT), brokenBlockPermutation: new Perm("grounds:elf_shed") });
  advance(5);
  check(!elves().length, "breaking the shed: the elves pop away");
  check(!shedRecord(), "and the shed is forgotten");
  check(allMsgs(players[0]).includes("packed up their tools"), "they wave goodbye");

  // ---------- Reloading in the middle of a shift ----------
  advance(2000 - time);
  put(0, 64, 0, "grounds:elf_shed", { "minecraft:cardinal_direction": "south", "grounds:open": false });
  handlers.place({ player: players[0], block: dim.getBlock(SHED_AT) });
  check(allMsgs(players[0]).includes("come out in a moment"), "putting a shed up in the daytime: new elves come out right away");
  advance(150);
  check(elves().length === 2, "and they do");
  const newNames = shedRecord().elves.map((e) => e.name);
  timers = [];        // world closes...
  load();             // ...and opens again (the elves are still standing there)
  advance(220);
  check(!elves().length, "leftover elves tidied away after a reload");
  check(permAt(0, 64, 0).getState("grounds:open") === false, "shed door closed again after a reload");
  check(shedRecord().elves.map((e) => e.name).join() === newNames.join(), "same elves still live there");

  // ---------- Walking away: the shift stops ----------
  advance(24000 - time + 1100);
  check(elves().length === 2, "next morning they come out");
  for (const p of players) p.location = { x: 500, y: 64, z: 500 };
  advance(30);
  check(!elves().length, "everyone walks far away: the elves go home");
  check(permAt(0, 64, 0).getState("grounds:open") === false, "door closed");

  console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})();
