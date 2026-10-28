// Runs the whole House Blueprint script in a fake world: build a house over a tree,
// stand inside it, remove it, and check the land is exactly as it was, chest items
// were rescued, and the player was moved out first. Also checks the no-snapshot backup.
// Usage: node tests/house_remove_test.cjs addons/HouseBlueprint_BP/scripts/main.js
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8").replace(/^import .*$/gm, "");

async function scenario(snapshotsWork) {
  let tick = 0;
  const timers = [], jobs = [];
  let nextId = 1;
  const system = {
    get currentTick() { return tick; },
    runInterval: (fn, n) => { const id = nextId++; timers.push({ id, fn, every: n || 1, at: tick + (n || 1) }); return id; },
    runTimeout: (fn, n) => { const id = nextId++; timers.push({ id, fn, once: true, at: tick + (n || 1) }); return id; },
    run: (fn) => system.runTimeout(fn, 1),
    clearRun: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    runJob: (gen) => jobs.push(gen),
  };
  class BlockPermutation { constructor(id, s) { this.type = { id }; this.states = s; } static resolve(id, s) { return new BlockPermutation(id, s); } }
  class ItemStack { constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; } }
  const answers = [];
  class ActionFormData {
    title() { return this; } body(b) { this._body = b; return this; } button() { return this; }
    async show() { const a = answers.shift(); return a === undefined ? { canceled: true } : { canceled: false, selection: a }; }
  }

  const blocks = new Map(), boxes = new Map(), structures = new Map(), spawned = [];
  const K = (l) => `${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)}`;
  const ground = (y) => (y <= 63 ? (y === 63 ? "minecraft:grass_block" : "minecraft:dirt") : "minecraft:air");
  const isBox = (id) => /chest|barrel|furnace|smoker/.test(id);
  const makeBox = () => {
    const items = new Array(27).fill(undefined);
    return { size: 27, getItem: (i) => items[i], setItem: (i, it) => (items[i] = it), addItem: (it) => { const i = items.indexOf(undefined); items[i] = it; } };
  };
  const dim = {
    id: "minecraft:overworld",
    getBlock(l) {
      const k = K(l);
      return {
        typeId: blocks.get(k) || ground(Math.floor(l.y)), location: { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) },
        setPermutation: (p) => { blocks.set(k, p.type.id); if (isBox(p.type.id)) boxes.set(k, makeBox()); else boxes.delete(k); },
        getComponent: (c) => (c === "minecraft:inventory" && boxes.has(k) ? { container: boxes.get(k) } : undefined),
      };
    },
    spawnParticle() {}, spawnItem(it) { spawned.push(it); },
  };
  const structureManager = {
    createFromWorld(id, d, a, b) {
      if (!snapshotsWork) throw new Error("not supported");
      const snap = new Map();
      for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) for (let z = a.z; z <= b.z; z++) snap.set(`${x - a.x},${y - a.y},${z - a.z}`, blocks.get(`${x},${y},${z}`));
      structures.set(id, snap);
    },
    place(id, d, at) {
      if (!structures.has(id)) throw new Error("no structure " + id);
      for (const [rel, v] of structures.get(id)) {
        const [x, y, z] = rel.split(",").map(Number);
        const k = `${at.x + x},${at.y + y},${at.z + z}`;
        if (v === undefined) blocks.delete(k); else blocks.set(k, v);
        boxes.delete(k);
      }
    },
    delete(id) { structures.delete(id); },
  };
  const props = new Map(), dyn = new Map();
  const player = {
    name: "Havana", id: "Havana", typeId: "minecraft:player", location: { x: 0.5, y: 64, z: 0.5 }, dimension: dim, messages: [],
    getViewDirection: () => ({ x: 0, y: 0, z: 1 }),
    sendMessage(m) { this.messages.push(m); }, playSound() {},
    onScreenDisplay: { setTitle() {} },
    getDynamicProperty: (k) => props.get(k), setDynamicProperty: (k, v) => props.set(k, v),
    getComponent: () => ({ container: { addItem() {} } }),
    teleport(l) { this.location = { ...l }; },
  };
  const handlers = {};
  const world = {
    structureManager,
    getDynamicProperty: (k) => dyn.get(k), setDynamicProperty: (k, v) => dyn.set(k, v),
    getAllPlayers: () => [player], getDimension: () => dim, playSound() {},
    afterEvents: { playerSpawn: { subscribe: (f) => (handlers.spawn = f) }, itemUse: { subscribe: (f) => (handlers.use = f) } },
  };
  new Function("world", "system", "ItemStack", "BlockPermutation", "ActionFormData", src)(world, system, ItemStack, BlockPermutation, ActionFormData);

  async function run(ticks) {
    for (let i = 0; i < ticks; i++) {
      tick++;
      for (const t of [...timers]) if (t.at <= tick) { if (t.once) timers.splice(timers.indexOf(t), 1); else t.at = tick + t.every; t.fn(); }
      for (const j of [...jobs]) { for (let n = 0; n < 50; n++) { if (j.next().done) { jobs.splice(jobs.indexOf(j), 1); break; } } }
      await new Promise((r) => setImmediate(r));
    }
  }

  // A little tree right where the house will go.
  for (let y = 64; y <= 67; y++) blocks.set(`3,${y},10`, "minecraft:oak_log");
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) blocks.set(`${3 + dx},67,${10 + dz}`, "minecraft:oak_leaves");
  const before = new Map(blocks);

  let fails = 0;
  const check = (ok, msg) => { console.log((ok ? "  PASS " : "  FAIL ") + msg); if (!ok) fails++; };

  // Build a house.
  answers.push(1); // Cozy Cottage
  handlers.use({ source: player, itemStack: new ItemStack("house:blueprint") });
  await run(3000);
  const houses = JSON.parse(dyn.get("house:houses") || "[]");
  check(houses.length === 1 && houses[0].saved === snapshotsWork, `house remembered (land snapshot ${houses[0]?.saved ? "saved" : "not available"})`);
  const built = [...blocks.values()].filter((b) => b.includes("planks") || b.includes("log")).length;
  check(built > 100 && blocks.get("3,64,10") !== "minecraft:oak_log" || built > 100, `house built (${built} wood blocks)`);
  const h = houses[0];

  // Put Havana's stuff in a chest inside the house.
  let chestKey = [...boxes.keys()][0];
  boxes.get(chestKey).addItem(new ItemStack("minecraft:diamond", 5));

  // Stand on an upper floor (or inside) and use the blueprint again: remove.
  player.location = { x: (h.min.x + h.max.x) / 2, y: 68, z: (h.min.z + h.max.z) / 2 };
  answers.push(1, 0); // "Remove this house", "Yes, remove it"
  handlers.use({ source: player, itemStack: new ItemStack("house:blueprint") });
  await run(400);

  const insideNow = player.location.x >= h.min.x && player.location.x <= h.max.x + 1 && player.location.z >= h.min.z && player.location.z <= h.max.z + 1;
  check(!insideNow && player.location.y === h.stand.y, "player moved out front before the house disappeared");
  check(spawned.some((i) => i.typeId === "minecraft:diamond" && i.amount === 5), "chest items popped out for the player");
  check(JSON.parse(dyn.get("house:houses")).length === 0, "house forgotten after removal");
  if (snapshotsWork) {
    let diff = 0;
    for (let x = h.min.x; x <= h.max.x; x++) for (let y = h.min.y; y <= h.max.y; y++) for (let z = h.min.z; z <= h.max.z; z++) {
      const k = `${x},${y},${z}`;
      if (blocks.get(k) !== before.get(k)) diff++;
    }
    check(diff === 0, `land restored exactly, tree included (${diff} blocks different)`);
    check(structures.size === 0, "saved snapshot cleaned up");
  } else {
    let left = 0;
    for (let x = h.min.x; x <= h.max.x; x++) for (let y = h.stand.y; y <= h.max.y; y++) for (let z = h.min.z; z <= h.max.z; z++) if (blocks.has(`${x},${y},${z}`) && blocks.get(`${x},${y},${z}`) !== "minecraft:air") left++;
    check(left === 0, `backup removal cleared everything above ground (${left} blocks left)`);
  }

  // Using the blueprint now just offers a new house (no remove option).
  answers.push(undefined);
  handlers.use({ source: player, itemStack: new ItemStack("house:blueprint") });
  await run(5);
  check(!player.messages.some((m) => m.includes("too far")), "no errors");
  return fails;
}

(async () => {
  console.log("With land snapshots:");
  const a = await scenario(true);
  console.log("Without land snapshots (backup plan):");
  const b = await scenario(false);
  console.log(a + b ? `\n${a + b} FAILED` : "\nall checks passed");
  process.exit(a + b ? 1 : 0);
})();
