// Runs the real House Blueprint script against a tiny fake Minecraft and has a builder put up whole houses:
// once straight through, and once with the world "closed and reopened" halfway (the script is loaded fresh
// and must pick the build back up). Both must end with the same blocks, and the builder gone home.
// Usage: node tests/builder_sim.cjs addons/HouseBlueprint_BP/scripts/main.js [houses]
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8")
  .replace(/^import .*@minecraft\/server";$/m, "const { world, system, ItemStack, BlockPermutation } = __mc;")
  .replace(/^import .*@minecraft\/server-ui";$/m, "const { ActionFormData } = __ui;");

function makeGame(saved, ground = 63) {
  const blocks = new Map(saved ? saved.blocks : []);
  const props = new Map(saved ? saved.props : []);
  const ents = [];
  let tick = saved ? saved.tick : 0, nextId = 1;
  const K = (l) => `${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)}`;
  const natural = (y) => (y < ground ? "minecraft:dirt" : y === ground ? "minecraft:grass_block" : "minecraft:air");
  const perm = (id, states) => ({ type: { id }, states });
  const dim = {
    id: "minecraft:overworld",
    heightRange: { min: -64, max: 320 },
    getBlock(l) {
      if (Math.abs(l.x) > 4000 || Math.abs(l.z) > 4000) return undefined;
      if (l.y < -64 || l.y >= 320) throw new Error("LocationOutOfWorldBoundariesError");
      const k = K(l);
      return {
        get typeId() { return blocks.has(k) ? blocks.get(k) : natural(Math.floor(l.y)); },
        setPermutation(p) { blocks.set(k, p.type.id); },
        getComponent() { return undefined; },
      };
    },
    spawnEntity(type, l) {
      const tags = new Set();
      const e = {
        id: `e${nextId++}`, typeId: type, location: { ...l }, nameTag: "", valid: true, events: [],
        isValid() { return this.valid; }, remove() { this.valid = false; ents.splice(ents.indexOf(this), 1); },
        teleport(to) { this.location = { ...to }; }, triggerEvent(ev) { this.events.push(ev); },
        addTag(t) { tags.add(t); }, getTags() { return [...tags]; }, hasTag(t) { return tags.has(t); },
      };
      ents.push(e);
      return e;
    },
    getEntities({ type, tags } = {}) {
      return ents.filter((e) => (!type || e.typeId === type) && (!tags || tags.every((t) => e.hasTag(t))));
    },
    spawnParticle() {}, spawnItem() {},
  };
  if (saved) for (const s of saved.ents) { const e = dim.spawnEntity(s.typeId, s.location); s.tags.forEach((t) => e.addTag(t)); e.nameTag = s.nameTag; }
  const msgs = [];
  const player = {
    id: "p1", name: "Havana", typeId: "minecraft:player", dimension: dim, location: { x: 0.5, y: ground + 1, z: 0.5 },
    getViewDirection: () => ({ x: 0, y: 0, z: 1 }), sendMessage: (m) => msgs.push(m),
    onScreenDisplay: { setActionBar: (m) => msgs.push(`[bar] ${m}`), setTitle() { throw new Error("no big titles!"); } },
    getDynamicProperty: () => true, setDynamicProperty() {}, getComponent: () => ({ container: { addItem() {} } }),
  };
  const subs = {};
  const ev = (name) => ({ subscribe: (fn) => { subs[name] = fn; return fn; } });
  const timers = [], jobs = [];
  const world = {
    afterEvents: { playerSpawn: ev("spawn"), itemUse: ev("itemUse") },
    beforeEvents: { playerInteractWithEntity: ev("interact") },
    getDynamicProperty: (k) => props.get(k), setDynamicProperty: (k, v) => props.set(k, v),
    getAllPlayers: () => [player], getDimension: () => dim, playSound() {},
    structureManager: { createFromWorld() {}, place() { throw new Error("no structures here"); }, delete() {} },
  };
  const system = {
    get currentTick() { return tick; },
    runInterval(fn, n = 1) { timers.push({ fn, n, at: tick + n, repeat: true }); },
    runTimeout(fn, n = 1) { timers.push({ fn, n, at: tick + n }); },
    run(fn) { timers.push({ fn, n: 1, at: tick + 1 }); },
    runJob(gen) { jobs.push(gen); },
  };
  const formAnswers = [];
  class ActionFormData {
    title() { return this; } body() { return this; } button() { return this; }
    show() { return Promise.resolve({ selection: formAnswers.shift(), canceled: false }); }
  }
  const warn = console.warn;
  new Function("__mc", "__ui", src)(
    { world, system, ItemStack: class { constructor(id, n) { this.typeId = id; this.amount = n; } }, BlockPermutation: { resolve: perm } },
    { ActionFormData });
  async function step() {
    tick++;
    for (let i = 0; i < jobs.length; i++) {
      for (let k = 0; k < 50; k++) if (jobs[i].next().done) { jobs.splice(i--, 1); break; }
    }
    for (const t of timers.slice()) {
      if (t.at > tick) continue;
      t.fn();
      if (t.repeat) t.at = tick + t.n; else timers.splice(timers.indexOf(t), 1);
    }
    await new Promise((r) => setImmediate(r));
  }
  const save = () => ({
    blocks: [...blocks], props: [...props], tick,
    ents: ents.map((e) => ({ typeId: e.typeId, location: e.location, tags: e.getTags(), nameTag: e.nameTag })),
  });
  return { blocks, props, ents, msgs, player, subs, formAnswers, step, save, warn };
}

const houses = () => JSON.parse(lastGame.props.get("house:houses") || "[]");
let lastGame;

async function run(styleSel, reloadAt) {
  let g = makeGame();
  lastGame = g;
  g.formAnswers.push(0, styleSel); // "A house", then the style
  g.subs.itemUse({ source: g.player, itemStack: { typeId: "house:builder_blueprint" } });
  let ticks = 0, reloaded = false, builderSeen = false;
  const placedBy = [];
  while (ticks < 60000) {
    await g.step();
    ticks++;
    if (g.ents.length) builderSeen = true;
    if (reloadAt && !reloaded && ticks === reloadAt) {
      // Close and reopen the world: same blocks, saved properties and entities; the script starts over.
      g = makeGame(g.save());
      lastGame = g;
      reloaded = true;
    }
    const h = houses();
    if (ticks > 100 && h.length && !h[0].build && !g.ents.length) break;
  }
  const h = houses();
  return { g, ticks, builderSeen, house: h[0], msgs: g.msgs };
}

(async () => {
  const N = Number(process.argv[3] || 3);
  let fails = 0;
  for (let n = 0; n < N; n++) {
    const sel = 1 + (n * 5) % 17; // a few different styles
    // Same style, same seed? The seed is random, so compare a straight build with a reloaded one by
    // fixing Math.random for the run.
    let r = 12345 + n;
    const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
    Math.random = rnd;
    const a = await run(sel, 0);
    r = 12345 + n;
    const b = await run(sel, Math.floor(a.ticks * 0.45));
    const diff = [];
    const keys = new Set([...a.g.blocks.keys(), ...b.g.blocks.keys()]);
    for (const k of keys) if (a.g.blocks.get(k) !== b.g.blocks.get(k)) diff.push(`${k}: ${a.g.blocks.get(k)} vs ${b.g.blocks.get(k)}`);
    const problems = [];
    if (!a.builderSeen) problems.push("no builder showed up");
    if (a.ticks >= 60000) problems.push("never finished");
    if (!a.house || a.house.build) problems.push("build not wrapped up");
    if (a.g.ents.length || b.g.ents.length) problems.push("builder still around");
    if (diff.length) problems.push(`reloaded build differs in ${diff.length} blocks, e.g. ${diff.slice(0, 3).join("; ")}`);
    const placed = [...a.g.blocks.values()].filter((id) => id !== "minecraft:air").length;
    if (![...a.g.blocks.values()].includes("minecraft:lantern") && ![...a.g.blocks.values()].includes("minecraft:soul_lantern")) problems.push("no lanterns");
    if (placed < 300) problems.push(`only ${placed} blocks placed`);
    if (/chest|bed|carpet|bookshelf|furnace/.test([...a.g.blocks.values()].join(" "))) problems.push("furniture got built");
    console.log(`${a.house?.style}: ${placed} blocks in ${(a.ticks / 1200).toFixed(1)} min${problems.length ? "  PROBLEMS: " + problems.join(" | ") : "  ok"}`);
    if (n === 0) console.log("  messages:", a.msgs.join("\n            "));
    if (problems.length) fails++;
  }
  // A town building from the Builder's Blueprint: the Fire Station (super fast), with its sign and garage door.
  {
    const g = makeGame();
    lastGame = g;
    g.formAnswers.push(1, 5); // "A town building", Fire Station
    g.subs.itemUse({ source: g.player, itemStack: { typeId: "house:builder_blueprint" } });
    for (let i = 0; i < 200; i++) await g.step();
    const problems = [];
    if (houses()[0]?.style !== "Fire Station") problems.push(`built ${houses()[0]?.style}`);
    if (g.ents.length) { g.formAnswers.push(2); g.subs.interact({ target: g.ents[0], player: g.player, cancel: false }); }
    for (let i = 0; i < 30000 && (houses()[0]?.build || g.ents.length); i++) await g.step();
    const ids = [...g.blocks.values()];
    if (!ids.some((id) => /wall_sign/.test(id))) problems.push("no sign");
    if (ids.some((id) => /barrel|bed|iron_bars|black_concrete/.test(id))) problems.push("furniture in the frame");
    if (houses()[0]?.build) problems.push("not finished");
    console.log(`builder + Fire Station: ${ids.filter((id) => id !== "minecraft:air").length} blocks${problems.length ? "  PROBLEMS: " + problems.join(" | ") : "  ok"}`);
    if (problems.length) fails++;
  }

  // Tapping the builder: go super fast, then stop; then take the half-built house away with the blueprint.
  {
    const g = makeGame();
    lastGame = g;
    g.formAnswers.push(0, 3);
    g.subs.itemUse({ source: g.player, itemStack: { typeId: "house:builder_blueprint" } });
    for (let i = 0; i < 1500; i++) await g.step();
    const problems = [];
    const tap = async (...answers) => {
      g.formAnswers.push(...answers);
      const ev = { target: g.ents[0], player: g.player, cancel: false };
      g.subs.interact(ev);
      if (!ev.cancel) problems.push("tap not cancelled");
      for (let i = 0; i < 5; i++) await g.step();
    };
    if (!g.ents.length) problems.push("no builder to tap");
    await tap(2);
    if (houses()[0]?.build?.speed !== 2) problems.push("speed not saved");
    const before = houses()[0].build.idx;
    for (let i = 0; i < 400; i++) await g.step();
    const fastRate = (houses()[0].build.idx - before) / 400;
    await tap(3, 0);
    if (g.ents.length) problems.push("builder didn't go home");
    if (houses()[0]?.build) problems.push("build still remembered after stopping");
    // Use the blueprint again from inside the half-built house: remove it.
    g.player.location = { ...g.player.location, z: g.player.location.z + 6 };
    g.formAnswers.push(1, 0);
    g.subs.itemUse({ source: g.player, itemStack: { typeId: "house:builder_blueprint" } });
    for (let i = 0; i < 300; i++) await g.step();
    if (houses().length) problems.push("house not removed");
    const left = [...g.blocks.entries()].filter(([k, id]) => Number(k.split(",")[1]) >= 64 && id !== "minecraft:air").length;
    if (left) problems.push(`${left} blocks left standing`);
    console.log(`tap menu + stop + remove: super fast placed ${fastRate.toFixed(2)} blocks/tick${problems.length ? "  PROBLEMS: " + problems.join(" | ") : "  ok"}`);
    if (problems.length) fails++;
  }
  // A flat world (ground 3 blocks above the bottom of the world): build, then remove. Also a house remembered
  // the old way (its saved area reaching below the bottom of the world) must still come down.
  for (const oldRecord of [false, true]) {
    const g = makeGame(null, -61);
    lastGame = g;
    g.formAnswers.push(0, 1);
    g.subs.itemUse({ source: g.player, itemStack: { typeId: "house:builder_blueprint" } });
    for (let i = 0; i < 200; i++) await g.step();
    const problems = [];
    const h0 = houses()[0];
    if (!h0) problems.push("no house");
    else if (h0.min.y < -64) problems.push(`saved area reaches y ${h0.min.y}, below the world`);
    const hs = houses();
    hs[0].build.speed = 2;
    if (oldRecord) hs[0].min.y = -70;
    g.props.set("house:houses", JSON.stringify(hs));
    // (the running build keeps its own copy of the speed; set it there too by tapping)
    g.formAnswers.push(2);
    g.subs.interact({ target: g.ents[0], player: g.player, cancel: false });
    for (let i = 0; i < 20000 && (houses()[0]?.build || g.ents.length); i++) await g.step();
    if (houses()[0]?.build) problems.push("build never finished");
    g.formAnswers.push(1, 0);
    g.subs.itemUse({ source: g.player, itemStack: { typeId: "house:builder_blueprint" } });
    for (let i = 0; i < 300; i++) await g.step();
    if (g.msgs.some((m) => /too far/.test(m))) problems.push(`said: ${g.msgs.find((m) => /too far/.test(m))}`);
    if (houses().length) problems.push("house not removed");
    const left = [...g.blocks.entries()].filter(([k, id]) => Number(k.split(",")[1]) >= -60 && id !== "minecraft:air").length;
    if (left) problems.push(`${left} blocks left standing`);
    console.log(`flat world${oldRecord ? " (house saved by 1.6.1)" : ""}: build + remove${problems.length ? "  PROBLEMS: " + problems.join(" | ") : "  ok"}`);
    if (problems.length) fails++;
  }
  console.log(`\n${N} simulated builds, ${fails} with problems.`);
  process.exit(fails ? 1 : 0);
})();
