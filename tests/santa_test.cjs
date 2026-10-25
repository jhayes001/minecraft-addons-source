// Runs the Santa's Visit script against a small fake Minecraft world and checks the story:
// plant tree -> night -> Santa flies -> presents with names -> owners unwrap theirs,
// others can't -> sleeping through the night still gets presents in the morning.
// Usage: node tests/santa_test.cjs addons/SantaVisit_BP/scripts/main.js
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8").replace(/^import .*$/gm, "");

let tick = 0, time = 6000, day = 10;
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
class BlockPermutation {
  constructor(id, states) { this.type = { id }; this.states = states || {}; }
  static resolve(id, states) {
    if (!id.includes(":") || (global.NO_PRESENT_BLOCKS && id.startsWith("santa:present"))) throw new Error("bad");
    return new BlockPermutation(id, states);
  }
}
class ItemStack { constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; } }

const blocks = new Map();
const K = (l) => `${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)}`;
const entities = [];
const dropped = [];
const dim = {
  id: "minecraft:overworld",
  getBlock(l) {
    const k = K(l);
    const typeId = blocks.get(k) || (l.y <= 63 ? "minecraft:grass_block" : l.y === 64 ? "minecraft:short_grass" : "minecraft:air");
    const block = {
      typeId, location: { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) }, dimension: dim,
      setPermutation: (p) => blocks.set(k, p.type.id),
      getComponent: (c) => c === "minecraft:sign" && typeId.includes("sign") ? { setText: (t) => signs.set(k, t), setWaxed() {} } : undefined,
    };
    return block;
  },
  spawnEntity(type, loc) { const e = { typeId: type, location: loc, spawnedAt: { ...loc }, teleport(p) { this.location = p; }, remove() { entities.splice(entities.indexOf(this), 1); } }; entities.push(e); return e; },
  getEntities({ type }) { return entities.filter((e) => e.typeId === type); },
  spawnParticle() {},
  spawnItem(item, loc) { dropped.push(item); },
};
const signs = new Map();
function makePlayer(name, x) {
  const inv = [];
  const props = new Map();
  return {
    name, typeId: "minecraft:player", id: name, location: { x, y: 64, z: 0 }, dimension: dim, messages: [], inv,
    sendMessage(m) { this.messages.push(m); },
    playSound() {},
    onScreenDisplay: { setTitle() {}, setActionBar() {} },
    getDynamicProperty: (k) => props.get(k), setDynamicProperty: (k, v) => props.set(k, v),
    getComponent: () => ({ container: { addItem: (it) => { inv.push(it); } } }),
    getBlockFromViewDirection() { return { block: dim.getBlock({ x: this.location.x + 4, y: 63, z: 0 }) }; },
  };
}
const players = [makePlayer("Havana", 0), makePlayer("Jeff", 2)];
const world = {
  getDynamicProperty: (k) => dyn.get(k), setDynamicProperty: (k, v) => (v === undefined ? dyn.delete(k) : dyn.set(k, v)),
  getDay: () => day, getTimeOfDay: () => time,
  getAllPlayers: () => players, getDimension: () => dim, playSound() {},
  afterEvents: { playerSpawn: sub("spawn"), itemUse: sub("use"), playerBreakBlock: sub("break") },
  beforeEvents: { playerInteractWithBlock: sub("interact") },
};
new Function("world", "system", "ItemStack", "BlockPermutation", src)(world, system, ItemStack, BlockPermutation);

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

// Both players join and get a tree.
for (const p of players) handlers.spawn({ player: p, initialSpawn: true });
advance(200);
check(players.every((p) => p.inv.some((i) => i.typeId === "santa:christmas_tree")), "each player gets a Christmas Tree on first join");

// Havana plants it.
handlers.use({ source: players[0], itemStack: new ItemStack("santa:christmas_tree") });
const tree = JSON.parse(dyn.get("santa:tree"));
check(blocks.get(K(tree)) === "minecraft:spruce_log" && blocks.get(K({ ...tree, y: tree.y + 9 })) === "minecraft:glowstone", "tree planted with trunk and star");
const leaves = [...blocks.values()].filter((b) => b.includes("leaves")).length;
const orn = [...blocks.values()].filter((b) => /concrete|shroomlight|gold_block|sea_lantern|froglight/.test(b)).length;
check(leaves > 40 && orn > 3, `tree has ${leaves} leaves and ${orn} ornaments`);

// Daytime: nothing happens.
advance(2000);
check(!entities.length && !dyn.get("santa:presents"), "no Santa during the day");

// Night: Santa flies over.
advance(14500 - time + 50);
check(entities.length === 1, "Santa's sleigh appears after dark");
const startPos = entities[0].spawnedAt;
advance(130);
const presents = JSON.parse(dyn.get("santa:presents") || "{}");
const owners = Object.values(presents).map((p) => p.owner).sort();
check(owners.join(",") === "Havana,Jeff", `presents for everyone: ${owners.join(", ")}`);
check([...signs.values()].some((t) => t.includes("Havana")) && [...signs.values()].some((t) => t.includes("Jeff")), "each present has a name sign");
advance(150);
check(!entities.length, "sleigh is gone after the flight");
check(Math.hypot(startPos.x - tree.x, startPos.z - tree.z) > 30, "sleigh started far from the tree");

// Jeff tries Havana's present: refused. Havana opens hers.
const hk = Object.keys(presents).find((k) => presents[k].owner === "Havana");
const [hx, hy, hz] = hk.split("|")[1].split(",").map(Number);
const hblock = dim.getBlock({ x: hx, y: hy, z: hz });
const ev1 = { block: hblock, player: players[1], cancel: false };
handlers.interact(ev1); advance(2);
check(ev1.cancel && blocks.get(K({ x: hx, y: hy, z: hz })).startsWith("santa:present"), "someone else can't open your present");
const before = players[0].inv.length;
handlers.interact({ block: dim.getBlock({ x: hx, y: hy, z: hz }), player: players[0], cancel: false }); advance(2);
check(players[0].inv.length >= before + 2, `Havana unwrapped ${players[0].inv.length - before} gifts: ${players[0].inv.slice(before).map((i) => i.amount + " " + i.typeId).join(", ")}`);
check(blocks.get(K({ x: hx, y: hy, z: hz })) === "minecraft:air" && blocks.get(K({ x: hx, y: hy + 1, z: hz })) === "minecraft:air", "present and sign removed after opening");

// Same night: no second visit.
advance(3000);
check(Object.keys(JSON.parse(dyn.get("santa:presents"))).length === 1, "only one visit per night");

// Next night, everyone sleeps: time jumps to morning. Presents should still arrive.
day = 11; time = 12900; advance(10); // next evening
time = 0; day = 12; advance(100); // slept straight through to morning
const after = JSON.parse(dyn.get("santa:presents"));
check(Object.keys(after).length === 3 && players[0].messages.some((m) => m.includes("while you were sleeping")), "sleeping through the night still brings presents in the morning");

// Breaking a present drops the gifts.
const jk = Object.keys(after).find((k) => after[k].owner === "Jeff");
const [jx, jy, jz] = jk.split("|")[1].split(",").map(Number);
handlers.break({ player: players[1], block: dim.getBlock({ x: jx, y: jy, z: jz }), brokenBlockPermutation: new BlockPermutation("santa:present_red") });
check(dropped.length >= 2, "breaking a present drops its gifts");

// Tree removed -> Santa stops coming.
blocks.set(K(tree), "minecraft:air");
time = 14000; advance(2000);
check(!dyn.get("santa:tree") && !entities.length, "no tree, no Santa");

// A world where the custom present block didn't load: chests with gifts instead.
global.NO_PRESENT_BLOCKS = true;
players[0].location.x = 40; // plant somewhere new
handlers.use({ source: players[0], itemStack: new ItemStack("santa:christmas_tree") });
const tree2 = JSON.parse(dyn.get("santa:tree"));
dyn.set("santa:presents", "{}");
day = 20; time = 14400; dyn.set("santa:lastNight", 19); advance(400);
const chests = [...blocks.entries()].filter(([k, b]) => b === "minecraft:chest" && Math.abs(Number(k.split(",")[1]) - tree2.y) < 1);
check(chests.length === 2, `backup chests placed when present blocks are missing (${chests.length})`);
check(!players[0].messages.slice(-3).some((m) => m.includes("couldn't find room")), "no false 'no room' message");

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
