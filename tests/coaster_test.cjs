// Runs the Coaster Wand script in a fake world. Builds lots of random rides of every size
// (flat ground, a hill, a dip) and checks each one is a single connected minecart loop:
// every rail joins the next one (curves and slopes included), rails sit on solid blocks,
// there's headroom, uphill rails are powered, and it gets back to the station. Then checks
// the station sends off a cart with a rider and stops arriving ones, that it won't build over
// a chest, and that removing a ride puts the land back exactly.
// Usage: node tests/coaster_test.cjs addons/CoasterWand_BP/scripts/main.js
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8").replace(/^import .*$/gm, "");

const SIZES = { Little: 7, Medium: 12, Big: 18 };
const DIR = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const OPP = { north: "south", south: "north", east: "west", west: "east" };
const ENDS = {
  0: [["north", 0], ["south", 0]], 1: [["east", 0], ["west", 0]],
  2: [["east", 1], ["west", 0]], 3: [["west", 1], ["east", 0]],
  4: [["north", 1], ["south", 0]], 5: [["south", 1], ["north", 0]],
  6: [["south", 0], ["east", 0]], 7: [["south", 0], ["west", 0]],
  8: [["north", 0], ["west", 0]], 9: [["north", 0], ["east", 0]],
};

function makeWorld(terrain = {}) {
  let tick = 0;
  const timers = [], jobs = [];
  let nextId = 1;
  const system = {
    get currentTick() { return tick; },
    runInterval: (fn, n) => { const id = nextId++; timers.push({ id, fn, every: n || 1, at: tick + (n || 1) }); return id; },
    runTimeout: (fn, n) => { const id = nextId++; timers.push({ id, fn, once: true, at: tick + (n || 1) }); return id; },
    clearRun: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    runJob: (gen) => jobs.push(gen),
  };
  class BlockPermutation {
    constructor(id, s) { this.type = { id }; this.states = s || {}; }
    getState(n) { return this.states[n]; }
    static resolve(id, s) {
      if (!/^minecraft:[a-z_]+$/.test(id) || /^minecraft:(planks|log|fence)$/.test(id)) throw new Error("unknown block " + id);
      return new BlockPermutation(id, s);
    }
  }
  class ItemStack { constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; } }
  const answers = [];
  class ActionFormData {
    title() { return this; } body() { return this; } button() { return this; }
    async show() { const a = answers.shift(); return a === undefined ? { canceled: true } : { canceled: false, selection: a }; }
  }
  const blocks = new Map(), structures = new Map();
  const K = (x, y, z) => `${x},${y},${z}`;
  const top = (x, z) => {
    if (terrain.hill && x > 4) return 66;
    if (terrain.dip && z > 12) return 55;
    return 63;
  };
  const natural = (x, y, z) => (y <= top(x, z) ? (y === top(x, z) ? "minecraft:grass_block" : "minecraft:dirt") : "minecraft:air");
  const idAt = (x, y, z) => { const b = blocks.get(K(x, y, z)); return b ? b.type.id : natural(x, y, z); };
  const dim = {
    id: "minecraft:overworld",
    heightRange: { min: -64, max: 320 },
    getBlock(l) {
      const x = Math.floor(l.x), y = Math.floor(l.y), z = Math.floor(l.z);
      if (Math.abs(x) > 80 || Math.abs(z) > 80) return undefined; // not loaded
      return {
        typeId: idAt(x, y, z), location: { x, y, z }, permutation: blocks.get(K(x, y, z)),
        setPermutation: (p) => blocks.set(K(x, y, z), p),
      };
    },
    spawnParticle() {},
    spawnEntity(type, loc) { const c = makeCart(loc); carts.push(c); return c; },
    getEntities(q) {
      return carts.filter((c) => c.alive && (!q.type || q.type === c.typeId) && (
        q.maxDistance !== undefined ? Math.hypot(c.location.x - q.location.x, c.location.y - q.location.y, c.location.z - q.location.z) <= q.maxDistance
          : q.volume ? c.location.x >= q.location.x && c.location.x <= q.location.x + q.volume.x && c.location.z >= q.location.z && c.location.z <= q.location.z + q.volume.z
            : true));
    },
  };
  const carts = [];
  let cartId = 1;
  function makeCart(loc) {
    const c = {
      id: `cart${cartId++}`, typeId: "minecraft:minecart", location: { ...loc }, alive: true, v: { x: 0, y: 0, z: 0 }, riders: [], impulses: [], cleared: 0,
      isValid() { return this.alive; }, remove() { this.alive = false; },
      getVelocity() { return { ...this.v }; }, clearVelocity() { this.v = { x: 0, y: 0, z: 0 }; this.cleared++; },
      applyImpulse(i) { this.impulses.push(i); this.v = { x: this.v.x + i.x, y: 0, z: this.v.z + i.z }; },
      getComponent(n) { return n === "minecraft:rideable" ? { getRiders: () => this.riders } : undefined; },
    };
    return c;
  }
  const structureManager = {
    createFromWorld(id, d, a, b) {
      const snap = new Map();
      for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) for (let z = a.z; z <= b.z; z++) snap.set(K(x - a.x, y - a.y, z - a.z), blocks.get(K(x, y, z)));
      structures.set(id, { snap, size: [b.x - a.x + 1, b.y - a.y + 1, b.z - a.z + 1] });
    },
    place(id, d, at) {
      for (const [rel, v] of structures.get(id).snap) {
        const [x, y, z] = rel.split(",").map(Number);
        const k = K(at.x + x, at.y + y, at.z + z);
        if (v === undefined) blocks.delete(k); else blocks.set(k, v);
      }
    },
    delete(id) { structures.delete(id); },
  };
  const props = new Map(), dyn = new Map();
  const player = {
    name: "Havana", id: "Havana", typeId: "minecraft:player", location: { x: 0.5, y: 64, z: 0.5 }, dimension: dim, messages: [],
    getViewDirection: () => ({ x: 0, y: 0, z: 1 }),
    sendMessage(m) { this.messages.push(m); },
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
  const use = async (...picks) => { answers.push(...picks); handlers.use({ source: player, itemStack: new ItemStack("coaster:coaster_wand") }); await run(1500); };
  const rides = () => JSON.parse(dyn.get("coaster:rides") || "[]");
  return { blocks, idAt, player, carts, use, run, rides, structures, K, natural };
}

// Follows the rails from the station all the way round. Returns problems found.
function checkLoop(w, ride, H) {
  const problems = [];
  const rail = (x, y, z) => { const p = w.blocks.get(w.K(x, y, z)); return p && /rail/.test(p.type.id) ? p : null; };
  const railCount = [...w.blocks.values()].filter((p) => /rail/.test(p.type.id)).length;
  let cur = { ...ride.S }, heading = Object.keys(DIR).find((d) => DIR[d][0] === ride.f.x && DIR[d][1] === ride.f.z);
  const seen = new Set(), walk = [];
  for (let steps = 0; steps < 2000; steps++) {
    const p = rail(cur.x, cur.y, cur.z);
    if (!p) { problems.push(`no rail at ${cur.x},${cur.y},${cur.z}`); break; }
    const k = w.K(cur.x, cur.y, cur.z);
    if (seen.has(k)) break;
    seen.add(k);
    walk.push({ ...cur, p });
    const ends = ENDS[p.states.rail_direction];
    if (!ends) { problems.push(`bad rail shape ${p.states.rail_direction}`); break; }
    if (p.type.id === "minecraft:golden_rail" && p.states.rail_direction > 5) problems.push("curved powered rail");
    const below = w.idAt(cur.x, cur.y - 1, cur.z);
    if (below === "minecraft:air") problems.push(`rail floating at ${k}`);
    for (const dy of [1, 2]) if (w.idAt(cur.x, cur.y + dy, cur.z) !== "minecraft:air") problems.push(`no headroom at ${k}`);
    const out = ends.find(([d]) => d !== OPP[heading]) ?? ends[0];
    if (!ends.some(([d]) => d === OPP[heading]) && steps > 0) problems.push(`rail at ${k} doesn't join the one before`);
    const [d, dy] = out;
    const nx = cur.x + DIR[d][0], nz = cur.z + DIR[d][1];
    let next = null;
    const candidates = dy === 1 ? [[cur.y + 1, 0]] : [[cur.y, 0], [cur.y - 1, 1]];
    for (const [ny, backDy] of candidates) {
      const q = rail(nx, ny, nz);
      if (q && ENDS[q.states.rail_direction].some(([bd, bdy]) => bd === OPP[d] && bdy === backDy)) next = { x: nx, y: ny, z: nz };
    }
    if (!next) { problems.push(`track breaks after ${k} going ${d}`); break; }
    heading = d;
    cur = next;
  }
  if (!(cur.x === ride.S.x && cur.y === ride.S.y && cur.z === ride.S.z)) problems.push("loop doesn't come back to the station");
  if (seen.size !== railCount) problems.push(`walked ${seen.size} rails but ${railCount} were placed`);
  // Powered rails: each one within 8 rails (along its run) of a redstone block underneath.
  const N = walk.length;
  for (let i = 0; i < N; i++) {
    if (walk[i].p.type.id !== "minecraft:golden_rail") continue;
    if (!walk[i].p.states.rail_data_bit) problems.push("unpowered powered rail");
    let ok = false;
    for (const dir of [1, -1]) {
      for (let k = 0; k <= 8; k++) {
        const s = walk[(i + dir * k + N * 4) % N];
        if (s.p.type.id !== "minecraft:golden_rail") break;
        if (w.idAt(s.x, s.y - 1, s.z) === "minecraft:redstone_block") { ok = true; break; }
      }
    }
    if (!ok) problems.push(`powered rail with no power source near ${walk[i].x},${walk[i].y},${walk[i].z}`);
  }
  // Every uphill rail is powered.
  for (let i = 0; i < N; i++) {
    const a = walk[i], b = walk[(i + 1) % N];
    if (b.y > a.y && a.p.type.id !== "minecraft:golden_rail") problems.push("uphill rail not powered");
  }
  const maxH = Math.max(...walk.map((s) => s.y)) - ride.S.y;
  if (maxH < Math.ceil(H * 0.7)) problems.push(`lift hill only ${maxH} high`);
  const size = [ride.max.x - ride.min.x + 1, ride.max.z - ride.min.z + 1];
  if (size.some((s) => s > 64)) problems.push(`too big to save (${size})`);
  // The station stretch is flat and plain.
  for (let k = -4; k <= 0; k++) {
    const s = walk[(k + N) % N];
    if (s.y !== ride.S.y) problems.push("station isn't flat");
  }
  return { problems, length: N, maxH, minH: Math.min(...walk.map((s) => s.y)) - ride.S.y };
}

(async () => {
  let fails = 0;
  const check = (ok, msg) => { console.log((ok ? "  PASS " : "  FAIL ") + msg); if (!ok) fails++; };

  // Lots of random rides.
  for (const [terrain, label] of [[{}, "flat ground"], [{ hill: true }, "a hill"], [{ dip: true }, "a dip"]]) {
    for (const [sizeIdx, name] of [[0, "Little"], [1, "Medium"], [2, "Big"]]) {
      const runs = terrain.hill || terrain.dip ? 8 : 25;
      let bad = 0, built = 0, tunnels = 0, themes = new Set(), lengths = [], heights = [];
      const firstProblems = [];
      for (let r = 0; r < runs; r++) {
        const w = makeWorld(terrain);
        await w.use(sizeIdx);
        const ride = w.rides()[0];
        if (!ride) { bad++; firstProblems.push(w.player.messages.join(" | ") || "nothing built"); continue; }
        built++;
        themes.add(ride.theme);
        const res = checkLoop(w, ride, SIZES[name]);
        lengths.push(res.length); heights.push(res.maxH);
        if (res.minH < 0) tunnels++;
        if (res.problems.length) { bad++; firstProblems.push(res.problems.slice(0, 3).join("; ")); }
        if (terrain.dip) {
          // Supports reach the ground: nothing hangs under a support.
          for (const [k, p] of w.blocks) {
            if (!/fence|log|wool|concrete|packed_ice/.test(p.type.id)) continue;
            const [x, y, z] = k.split(",").map(Number);
            if (w.idAt(x, y - 1, z) === "minecraft:air" && w.blocks.get(w.K(x, y + 1, z)) && !/rail/.test(w.idAt(x, y + 1, z)) && y < 60) {
              bad++; firstProblems.push(`support hanging at ${k}`); break;
            }
          }
        }
      }
      check(bad === 0, `${name} on ${label}: ${built}/${runs} built, all good loops (lengths ${Math.min(...lengths)}-${Math.max(...lengths)}, tallest ${Math.max(...heights)}, ${tunnels} with tunnels, themes: ${[...themes].join(", ")})${firstProblems.length ? "\n      " + firstProblems.slice(0, 3).join("\n      ") : ""}`);
    }
  }

  // The station.
  {
    const w = makeWorld();
    await w.use(1);
    const ride = w.rides()[0];
    const carts = w.carts.filter((c) => c.alive);
    check(carts.length === 2, `two carts wait at the station (${carts.length})`);
    const tip = w.player.messages.filter((m) => m.includes("Sit in a minecart")).length;
    check(tip === 1, "one tip about how to ride");
    const cart = carts[0];
    await w.run(100);
    check(cart.impulses.length === 0, "empty carts stay put");
    cart.riders.push(w.player);
    await w.run(30);
    check(cart.impulses.length === 0, "waits a moment after she sits down");
    await w.run(40);
    const imp = cart.impulses[0];
    check(imp && Math.sign(imp.x) === ride.f.x && Math.sign(imp.z) === ride.f.z && carts[1].impulses.length === 0, "then sends her cart off forwards (not the empty one)");
    // Coming back round: the station stops it.
    await w.run(60); // round the loop
    cart.location = { x: ride.S.x + 0.5 - ride.f.x * 3, y: ride.S.y, z: ride.S.z + 0.5 - ride.f.z * 3 };
    cart.v = { x: ride.f.x * 0.4, y: 0, z: ride.f.z * 0.4 };
    const before = cart.cleared;
    await w.run(2);
    check(cart.cleared > before && cart.v.x === 0 && cart.v.z === 0, "stops the cart when it comes back");
    await w.run(70);
    check(cart.impulses.length === 2, "and goes again if she stays in");
    cart.riders.length = 0;
    cart.v = { x: 0, y: 0, z: 0 };
    await w.run(100);
    check(cart.impulses.length === 2, "doesn't go after she hops out");
    // Lost carts come back.
    w.carts.forEach((c) => c.remove());
    await w.run(250);
    check(w.carts.filter((c) => c.alive).length === 2, "new carts turn up if they're all gone");
  }

  // Won't build over her stuff.
  {
    const w = makeWorld();
    w.blocks.set("1,64,4", { type: { id: "minecraft:chest" }, states: {} });
    await w.use(0);
    check(w.rides().length === 0 && w.blocks.size === 1, "refuses to build over a chest, changes nothing");
    check(w.player.messages.some((m) => m.includes("something already built")), "says why");
  }

  // Removing a ride.
  {
    const w = makeWorld({ hill: true });
    for (let y = 67; y <= 70; y++) w.blocks.set(`6,${y},14`, { type: { id: "minecraft:oak_log" }, states: {} });
    const before = new Map(w.blocks);
    await w.use(2);
    const ride = w.rides()[0];
    check(!!ride && ride.saved, "big ride built and the land saved");
    w.carts[0].riders.push(w.player);
    w.player.location = { x: (ride.min.x + ride.max.x) / 2, y: ride.S.y + 8, z: (ride.min.z + ride.max.z) / 2 };
    await w.use(0); // "Yes, remove it"
    let diff = 0;
    for (let x = ride.min.x; x <= ride.max.x; x++) for (let y = ride.min.y; y <= ride.max.y; y++) for (let z = ride.min.z; z <= ride.max.z; z++) {
      const k = `${x},${y},${z}`;
      if (w.blocks.get(k) !== before.get(k)) diff++;
    }
    check(diff === 0, `land restored exactly, tree included (${diff} blocks different)`);
    check(w.rides().length === 0 && w.structures.size === 0, "ride forgotten and snapshot cleaned up");
    check(w.carts.every((c) => !c.alive), "carts gone");
    check(w.player.location.x === ride.stand.x + 0.5 && w.player.location.y === ride.stand.y, "she was moved to the ground by the station first");
  }

  console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
  process.exit(fails ? 1 : 0);
})();
