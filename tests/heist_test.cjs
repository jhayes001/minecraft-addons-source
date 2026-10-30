// Runs the Sneaky Heist script against a fake Minecraft world and checks the story: the Heist Map is
// given on first join; it refuses to build over something someone built; it builds the Ender Manor
// (walls, gate, hedges, tall grass, the manor, the vault with the crown, the start buttons with signs,
// the jail with its buttons, lamps and bars); what guards can and can't see (walls, the cone in front,
// sneaking, tall grass, crouching behind a barrel); pressing a start button starts a game (adventure
// mode, countdown, guards); a guard notices a robber, chases and catches her; jail (code on the wall,
// wrong and right buttons, door opens and closes again, the lamps going out one by one); grabbing the
// crown, getting caught with it, and bringing it home to win; a long Hard game with wandering robots
// (guards never step where they can't walk); stopping from the map; reloading mid-game; taking the
// arena away (the land comes back); and building facing another way.
// Usage: node tests/heist_test.cjs addons/SneakyHeist_BP/scripts/main.js
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8").replace(/^import .*$/gm, "");

let tick = 0;
const dyn = new Map();
let handlers = {};
let timers = [];
let jobs = [];
let jobSteps = 400;   // how much of each background job runs per tick
let nextId = 1;
const system = {
  get currentTick() { return tick; },
  runInterval: (fn, n) => { const id = nextId++; timers.push({ id, fn, every: n || 1, at: tick + (n || 1) }); return id; },
  runTimeout: (fn, n) => { const id = nextId++; timers.push({ id, fn, once: true, at: tick + (n || 1) }); return id; },
  run: (fn) => system.runTimeout(fn, 1),
  runJob: (gen) => { jobs.push(gen); return nextId++; },
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
}
const BlockPermutation = { resolve: (id, states) => new Perm(id, states || {}) };
const forms = [], formAnswers = [];
class ActionFormData {
  constructor() { this.buttons = []; }
  title(t) { this.t = t; return this; }
  body(b) { this.b = b; return this; }
  button(b) { this.buttons.push(b); return this; }
  show() { forms.push(this); return Promise.resolve(formAnswers.shift() ?? { canceled: true }); }
}

// ---------- The world: flat grass at y 63 (stand at 64) ----------
let blocks = new Map();
const K = (x, y, z) => `${x},${y},${z}`;
function permAt(x, y, z) {
  const k = K(x, y, z);
  if (blocks.has(k)) return blocks.get(k);
  return new Perm(y <= 63 ? (y === 63 ? "minecraft:grass_block" : "minecraft:dirt") : "minecraft:air");
}
const typeAt = (x, y, z) => permAt(x, y, z).typeId;
const put = (x, y, z, id, states = {}) => blocks.set(K(x, y, z), new Perm(id, states));
// Some natural stuff to put back later: a few trees' worth of leaves and flowers.
for (let i = 0; i < 40; i++) put(-30 + i * 1.5 | 0, 64, 20 + (i * 7) % 50, i % 2 ? "minecraft:poppy" : "minecraft:short_grass");

const signs = new Map();
let entities = [];
const particles = [], sounds = [], commands = [], dropped = [];
const structures = new Map();
const dim = {
  id: "minecraft:overworld",
  getBlock(l) {
    const x = Math.floor(l.x), y = Math.floor(l.y), z = Math.floor(l.z);
    if (y > 320 || y < -64) return undefined;
    const perm = permAt(x, y, z);
    return {
      typeId: perm.typeId, location: { x, y, z }, permutation: perm, dimension: dim,
      setPermutation(p) { blocks.set(K(x, y, z), p); },
      getComponent(n) {
        if (n === "minecraft:sign" && /sign/.test(perm.typeId)) return { setText: (t) => signs.set(K(x, y, z), t) };
        return undefined;
      },
    };
  },
  spawnEntity(type, loc) {
    const e = {
      typeId: type, id: "e" + nextId++, location: { ...loc }, valid: true, events: [], dimension: dim, rot: 0,
      teleport(p, o) { this.location = { ...p }; if (o?.rotation) this.rot = o.rotation.y; },
      triggerEvent(ev) { this.events.push(ev); },
      isValid() { return this.valid; },
      remove() { this.valid = false; const i = entities.indexOf(this); if (i >= 0) entities.splice(i, 1); },
      families: type === "minecraft:zombie" ? ["monster"] : [],
    };
    entities.push(e);
    return e;
  },
  getEntities({ type, families, location, maxDistance } = {}) {
    return entities.filter((e) => (!type || e.typeId === type) && (!families || families.every((f) => e.families.includes(f)))
      && (!location || Math.hypot(e.location.x - location.x, e.location.y - location.y, e.location.z - location.z) <= maxDistance));
  },
  spawnParticle(id, loc, v) { particles.push({ id, loc, tick, color: v?.color }); },
  spawnItem(item, loc) { dropped.push({ item, loc }); },
  runCommand(c) { commands.push({ c, tick }); return { successCount: 1 }; },
};
function makePlayer(name, x, z, mode) {
  const items = [];
  const props = new Map();
  const p = {
    name, id: name, typeId: "minecraft:player", location: { x, y: 64, z }, dimension: dim, messages: [], bars: [], heard: [],
    mode, isSneaking: false, view: { x: 0, y: 0, z: 1 }, valid: true,
    sendMessage(m) { this.messages.push(m); },
    playSound(id) { this.heard.push(id); },
    onScreenDisplay: null,
    held: {},
    getComponent: (n) => n === "minecraft:equippable" ? { getEquipment: (slot) => p.held[slot], setEquipment: (slot, it) => { p.held[slot] = it; } }
      : ({ container: { addItem(it) { items.push(it); } } }), items,
    getRotation() { return { x: 0, y: 0 }; },
    commands: [],
    runCommand(c) { this.commands.push(c); if (c === "give @s empty_map 1 2") items.push({ typeId: "minecraft:empty_map", data: 2 }); return { successCount: 1 }; },
    getDynamicProperty: (k) => props.get(k), setDynamicProperty: (k, v) => (v === undefined ? props.delete(k) : props.set(k, v)), props,
    getGameMode() { return this.mode; }, setGameMode(m) { this.mode = m; },
    getViewDirection() { return this.view; },
    getHeadLocation() { return { x: this.location.x, y: this.location.y + 1.62, z: this.location.z }; },
    teleport(l) { this.location = { ...l }; },
    isValid() { return this.valid; },
  };
  p.onScreenDisplay = { setActionBar: (t) => p.bars.push(t), setTitle() { throw new Error("no big titles!"); } };
  return p;
}
const havana = makePlayer("Havana", 0.5, 0.5, "survival");
const jeff = makePlayer("Jeff", 3.5, -2.5, "creative");
const players = [havana, jeff];
const world = {
  getDynamicProperty: (k) => dyn.get(k), setDynamicProperty: (k, v) => (v === undefined ? dyn.delete(k) : dyn.set(k, v)),
  getAllPlayers: () => players.filter((p) => p.valid), getDimension: () => dim,
  playSound(id, loc, o) { sounds.push({ id, loc, tick, pitch: o?.pitch }); },
  structureManager: {
    createFromWorld(id, d, min, max) {
      const saved = new Map();
      for (let x = min.x; x <= max.x; x++) for (let y = min.y; y <= max.y; y++) for (let z = min.z; z <= max.z; z++) saved.set(K(x, y, z), permAt(x, y, z));
      structures.set(id, { min, max, saved });
    },
    place(id) { const s = structures.get(id); if (!s) throw new Error("no structure"); for (const [k, p] of s.saved) blocks.set(k, p); },
    delete(id) { structures.delete(id); },
  },
  afterEvents: {
    playerSpawn: { subscribe: (fn) => (handlers.spawn = fn) },
    itemUse: { subscribe: (fn) => (handlers.use = fn) },
    playerInteractWithBlock: { subscribe: (fn) => (handlers.interact = fn) },
    buttonPush: { subscribe: (fn) => (handlers.push = fn) },
  },
};
globalThis.__heistTest = {};
const load = () => {
  handlers = {}; timers = []; jobs = [];
  new Function("world", "system", "ItemStack", "BlockPermutation", "ActionFormData", "MolangVariableMap", src)(world, system, ItemStack, BlockPermutation, ActionFormData, MolangVariableMap);
  return globalThis.__heistTest.api;
};
let api = load();

let onTick = null;
function advance(n) {
  for (let i = 0; i < n; i++) {
    tick++;
    for (const t of [...timers]) {
      if (t.at <= tick && timers.includes(t)) {
        if (t.once) timers.splice(timers.indexOf(t), 1); else t.at = tick + t.every;
        t.fn();
      }
    }
    for (const j of [...jobs]) {
      for (let s = 0; s < jobSteps; s++) {
        const r = j.next();
        if (r.done) { jobs.splice(jobs.indexOf(j), 1); break; }
      }
    }
    if (onTick) onTick();
  }
}
const settle = () => new Promise((r) => setImmediate(r));
async function flush(n = 3) { for (let i = 0; i < n; i++) { await settle(); advance(1); } }
let failures = 0;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failures++; };
const allMsgs = (p) => p.messages.join("\n");
const guards = () => entities.filter((e) => e.typeId === "heist:guard");
const crowns = () => entities.filter((e) => e.typeId === "heist:crown");
const arena = () => JSON.parse(dyn.get("heist:arena") || "null");
const at = (u, v, y) => api.toWorld(arena(), u, v, y);
const blockAt = (u, v, y) => { const w = at(u, v, y); return permAt(w.x, w.y, w.z); };
const place = (p, U, V, y = 0) => { p.location = api.toWorldPos(arena(), U, V, y); };
const local = (p) => api.toLocal(arena(), p.location);
const game = () => api.getGame();
const rec = (p) => game()?.players.get(p.id);
async function useMap(p, ...answers) {
  for (const a of answers) formAnswers.push({ canceled: false, selection: a });
  handlers.use({ source: p, itemStack: { typeId: "heist:heist_map" } });
  await flush(answers.length + 3);
}
function press(p, u, v, y = 1) {
  const w = at(u, v, y);
  const block = dim.getBlock(w);
  handlers.interact({ player: p, block });
  handlers.push({ block, source: p, dimension: dim });   // the same press seen twice: counted once
}
async function buildUntilDone(maxTicks = 3000) {
  for (let i = 0; i < maxTicks && jobs.length; i++) advance(1);
  await flush(2);
}

(async () => {
  // ---------- Getting the map ----------
  handlers.spawn({ player: havana, initialSpawn: true });
  handlers.spawn({ player: jeff, initialSpawn: true });
  advance(70);
  check(havana.items.some((i) => i.typeId === "heist:heist_map") && jeff.items.some((i) => i.typeId === "heist:heist_map"), "both players get a Heist Map on first join");
  handlers.spawn({ player: havana, initialSpawn: true });
  advance(70);
  check(havana.items.filter((i) => i.typeId === "heist:heist_map").length === 1, "only once");

  // ---------- Layout sanity ----------
  const rows = api.LAYOUT.rows;
  check(rows.length === 84 && rows.every((r) => r.length === 72), "the map is 72 x 84");
  let walk = 0, unreached = 0;
  {
    const seen = new Set(["35,5"]); const q = [[35, 5]];
    while (q.length) {
      const [u, v] = q.pop();
      for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${u + du},${v + dv}`;
        if (!seen.has(k) && api.guardWalk(u + du, v + dv)) { seen.add(k); q.push([u + du, v + dv]); }
      }
    }
    for (let v = -12; v <= 71; v++) for (let u = 0; u < 72; u++) if (api.guardWalk(u, v)) { walk++; if (!seen.has(`${u},${v}`)) unreached++; }
  }
  check(walk > 3000 && unreached === 0, `guards can reach every walkable spot (${walk} spots)`);
  check(api.SPOTS.length > 60 && api.SPOTS.every((s) => api.guardWalk(s.u, s.v)) && api.VAULT_SPOTS.length >= 8, `${api.SPOTS.length} patrol spots + ${api.VAULT_SPOTS.length} around the vault`);
  {
    // A robber can walk from the gold square to the crown (counting the pedestal's edge).
    const seen = new Set(["35,-4"]); const q = [[35, -4]]; let found = false;
    while (q.length) {
      const [u, v] = q.shift();
      if (Math.hypot(u + 0.5 - 36, v + 0.5 - 51) < 2) { found = true; break; }
      for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${u + du},${v + dv}`;
        if (!seen.has(k) && api.playerWalk(u + du, v + dv) && rows[v + dv + 12][u + du] !== "j") { seen.add(k); q.push([u + du, v + dv]); }
      }
    }
    check(found, "a robber can walk from the gold square to the crown");
  }
  // ---------- Random manors ----------
  {
    const t0 = Date.now();
    const seeds = []; for (let i = 1; i <= 150; i++) seeds.push(i * 7907);
    const layouts = seeds.map((sd) => api.generateLayout(sd));
    const ms = (Date.now() - t0) / seeds.length;
    check(layouts.every((L) => L.seed !== 0 && L.buildings.length === 1), `150 random manors, none needed the classic fallback (${ms.toFixed(0)} ms each)`);
    const again = api.generateLayout(seeds[17]);
    check(JSON.stringify(again.floors.map((G) => G.g)) === JSON.stringify(layouts[17].floors.map((G) => G.g)), "the same seed always makes the same manor");
    const yard = rows.slice(0, 12).join("\n");
    check(layouts.every((L) => L.floors[0].g.slice(0, 12).map((r) => r.join("")).join("\n") === yard), "the yard and jail never change");
    check(layouts.every((L) => L.floors[0].g[12].join("") === rows[12] && L.floors[0].g.every((r, i) => i < 12 || (r[0] === "#" || r[0] === "a") && (r[71] === "#"))), "the outer wall and the gate never change");
    const two = layouts.filter((L) => L.floors.length === 2).length;
    const up = layouts.filter((L) => L.pedestal.f === 1).length;
    const garden = layouts.filter((L) => !L.buildings.some((B) => L.pedestal.U > B.u0 && L.pedestal.U < B.u1 && L.pedestal.V > B.v0 && L.pedestal.V < B.v1)).length;
    const spotsAt = new Set(layouts.map((L) => `${Math.round(L.pedestal.U)},${Math.round(L.pedestal.V)},${L.pedestal.f}`)).size;
    check(two > 40 && up > 20 && garden > 15 && spotsAt > 130, `lots of variety: ${two} two-story, ${up} with the vault upstairs, ${garden} with the treasure in a hedge garden, ${spotsAt} treasure spots`);
    let allOk = true, stairsOk = true, why = "";
    for (const L of layouts) {
      if (!api.allConnected(L)) { allOk = false; why = `seed ${L.seed} not connected`; }
      for (const st of L.stairs) {
        const c = (i) => [st.u + st.du * i, st.v + st.dv * i];
        const g0 = (i) => L.floors[0].get(...c(i)), g1 = (i) => L.floors[1].get(...c(i));
        if (![0, 1, 2, 3, 4].every((i) => g0(i) === "s") || g0(5) !== "Z" || g1(5) !== "u" || g1(2) !== "o" || g1(3) !== "o" || g1(4) !== "o"
          || !"_~=".includes(g1(6)) || !"_~".includes(g0(-1))) { stairsOk = false; why = `seed ${L.seed} stairs`; }
      }
    }
    check(allOk, `in every manor, everything you can walk on is reachable from the gate ${why}`);
    check(stairsOk, `every staircase: 5 steps, the top step level with upstairs, an opening above, and room at both ends ${why}`);
  }
  api.setLayout(0);

  const pathLen = api.findPath({ u: 35, v: 5 }, { u: 30, v: 49 })?.length;
  check(pathLen > 40, `guards find a path from the garden into the vault (${pathLen} steps)`);

  // ---------- Building ----------
  // Something built in the way: the map refuses.
  const would = { base: { x: 0, y: 64, z: 0 }, f: { x: 0, z: 1 }, r: { x: -1, z: 0 } };
  const shedSpot = api.toWorld(would, 50, 60, 0);
  put(shedSpot.x, shedSpot.y, shedSpot.z, "minecraft:oak_planks");
  await useMap(havana, 0);
  check(forms.at(-1).buttons[0] === "Build it!" && /Sneaky Heist 1\.7\.0/.test(forms.at(-1).t), "the map asks before building");
  await buildUntilDone();
  check(/knock down something already built/.test(allMsgs(havana)) && !arena(), "refuses to build over planks");
  check(!commands.some((c) => /tickingarea add/.test(c.c)) || commands.at(-1).c === "tickingarea remove heist_arena", "ticking area removed after refusing");
  blocks.delete(K(shedSpot.x, shedSpot.y, shedSpot.z));
  const before = new Map(blocks);

  await useMap(havana, 0);
  await buildUntilDone();
  const A = arena();
  check(A && A.built, "builds the Ender Manor");
  check(/Ender Manor is ready/.test(allMsgs(havana)), "says it's ready and how to play");
  check(A.tiles.length >= 4 && A.tiles.every((t) => structures.has(t.id)), `land saved in ${A.tiles.length} pieces`);
  check(commands.some((c) => /^tickingarea add/.test(c.c)) && commands.at(-1).c === "tickingarea remove heist_arena", "ticking area while building, removed after");
  check(blockAt(35, -4, -1).typeId === "minecraft:gold_block", "gold square");
  check(blockAt(0, 10, 2).typeId.includes("stone_bricks") && blockAt(35, 0, 1).typeId === "minecraft:air" && blockAt(35, 0, 3).typeId.includes("stone_bricks"), "outer wall with an open gate");
  check(blockAt(5, 4, 1).typeId === "minecraft:oak_leaves" && blockAt(5, 4, 1).states.persistent_bit === true, "hedges (leaves that don't decay)");
  check(blockAt(5, 6, 0).typeId === "minecraft:tall_grass" && blockAt(5, 6, 1).states.upper_block_bit === true, "tall grass to hide in");
  check(blockAt(35, 50, 0).typeId === "minecraft:quartz_block" && blockAt(36, 51, -1).typeId === "minecraft:polished_blackstone", "pedestal in the vault");
  check(blockAt(13, 30, 2).typeId === "minecraft:air" && blockAt(12, 30, 2).typeId === "minecraft:glass_pane" && blockAt(30, 30, 5).typeId === "minecraft:purpur_block", "manor: windows and a roof");
  const btn = blockAt(34, -11, 1);
  check(btn.typeId === "minecraft:stone_button" && btn.states.facing_direction === 3 && blockAt(34, -12, 1).typeId === "minecraft:lime_wool"
    && blockAt(38, -12, 1).typeId === "minecraft:red_wool", "start buttons on green / yellow / red, facing the arena");
  check([...signs.values()].join(",") === "Easy,Medium,Hard,Capture\nthe Flag", "signs over the start buttons");
  const jb = blockAt(16, -11, 1);
  check(jb.typeId === "minecraft:stone_button" && jb.states.facing_direction === 4 && blockAt(15, -11, 1).typeId === "minecraft:red_wool"
    && blockAt(15, -7, 1).typeId === "minecraft:blue_wool" && blockAt(15, -9, 1).typeId.includes("cobblestone"), "jail buttons: red, yellow, (wall), green, blue");
  check(blockAt(21, -9, 0).typeId === "minecraft:iron_bars" && blockAt(21, -3, 1).typeId === "minecraft:iron_bars" && blockAt(21, -11, 3).typeId === "minecraft:ochre_froglight", "jail bars and lamps");
  let lights = 0; for (const p of blocks.values()) if (p.typeId === "minecraft:light_block_15") lights++;
  check(lights > 100, `${lights} hidden lights so monsters don't spawn`);
  advance(80);
  check(crowns().length === 1 && Math.hypot(crowns()[0].location.x - api.toWorldPos(A, 36, 51, 0).x, crowns()[0].location.z - api.toWorldPos(A, 36, 51, 0).z) < 0.01, "the Golden Crown sits on the pedestal");

  // ---------- What guards can see ----------
  const L = api.LEVELS;
  const G = (U, V, yaw) => ({ U, V, yaw });
  const P = (U, V, sneaking = false) => ({ U, V, y: 0, sneaking });
  check(api.canSee(G(35.5, 29.5, 0), P(35.5, 33.5), L[0], false), "sees a robber in front of it");
  check(!api.canSee(G(35.5, 30.5, 0), P(35.5, 27.5), L[0], false), "doesn't see behind it");
  check(api.canSee(G(35.5, 30.5, 0), P(35.5, 28.5), L[0], false) && !api.canSee(G(35.5, 30.5, 0), P(35.5, 28.5, true), L[0], false), "hears footsteps right behind it, but not sneaking ones");
  check(!api.canSee(G(20.5, 32.5, -90), P(29.5, 32.5), L[2], false), "can't see through walls");
  check(api.canSee(G(25.5, 29.5, -90), P(31.5, 29.5), L[0], false), "sees through an open doorway");
  check(api.canSee(G(35.5, 26.5, 0), P(35.5, 32.9), L[0], false) && !api.canSee(G(35.5, 26.5, 0), P(35.5, 32.9, true), L[0], false)
    && api.canSee(G(35.5, 26.5, 0), P(35.5, 29.5, true), L[0], false), "sneaking: guards have to be much closer to spot you");
  check(!api.canSee(G(10.5, 7.5, 180), P(5.5, 6.5, true), L[2], false) && api.canSee(G(5.5, 9.0, 180), P(5.5, 6.5), L[2], false), "hidden in tall grass while crouching");
  check(!api.canSee(G(20.5, 38.5, -90), P(25.5, 38.5, true), L[2], false) && api.canSee(G(20.5, 38.5, -90), P(25.5, 38.5), L[2], false)
    && api.canSee(G(20.5, 38.5, -90), P(25.5, 37.5, true), L[2], false), "crouching behind a barrel hides you");
  check(!api.canSee(G(35.5, 30.5, 0), P(35.5, 41.5), L[2], true) && api.canSee(G(35.5, 30.5, 180), P(35.5, 34.5), L[2], true), "while chasing it sees all around, but not through walls");

  // ---------- Starting a game ----------
  place(havana, 35.5, -9.5); place(jeff, 40.5, -8.5);
  havana.messages.length = 0;
  press(havana, 34, -11);
  advance(2);
  check(game() && game().level.name === "Easy", "pressing the green button starts an Easy game (once, even though the press is seen twice)");
  check(havana.mode === "adventure" && jeff.mode === "adventure" && havana.props.get("heist:prevMode") === "survival" && jeff.props.get("heist:prevMode") === "creative",
    "everyone switches to adventure mode (old modes remembered)");
  check(Math.abs(local(havana).V + 4.5) < 1.1 && Math.abs(local(havana).U - 35.5) < 1.1, "players start on the gold square");
  check(/Sneaky Heist!/.test(allMsgs(havana)), "the rules, once");
  check(havana.items.filter((i) => i.typeId === "minecraft:empty_map" && i.data === 2).length === 1 && jeff.items.some((i) => i.typeId === "minecraft:empty_map"),
    "everyone gets an Empty Locator Map (Minecraft's own map) at their first game");
  check(/You got a map!/.test(allMsgs(havana)), "with a line about how to use it");
  check(havana.items.some((i) => i.typeId === "heist:rainbow_blaster") && /You got a Rainbow Blaster!/.test(allMsgs(havana)), "and a Rainbow Blaster, with a line about what it does");
  check(guards().length === 4, "4 guards on Easy");
  check(guards().every((g) => { const l = api.toLocal(A, g.location); return l.V >= 22 && api.guardWalk(Math.floor(l.U), Math.floor(l.V)); }), "guards start far from the gate");
  advance(60);
  check(["§e3", "§e2", "§e1"].every((t) => havana.bars.includes(t)) && havana.bars.some((t) => /^§aGo!/.test(t)) && game().phase === "play", "3, 2, 1, Go!");
  press(havana, 36, -11); advance(1);
  check(game().level.name === "Easy" && /already going/.test(havana.bars.at(-1)), "another start button during a game just says so");

  // Watch every guard every tick: never anywhere it can't walk.
  // Watch every guard every tick: never anywhere it can't walk (on its own floor, or on the stairs), standing at the
  // right height, and note teleports (more than 2 blocks in one tick) and changes of floor.
  const watch = { bad: [], ticks: 0, blinks: [], floorChanges: 0, upstairs: 0, last: new Map() };
  onTick = () => {
    const g = game();
    if (!g || watch.paused) return;
    for (const gd of g.guards) {
      if (!gd.e?.isValid()) continue;
      watch.ticks++;
      const Arena = g.a;
      const l = api.toLocal(Arena, gd.e.location);
      const cu = Math.floor(l.U), cv = Math.floor(l.V), f = gd.f || 0;
      const onStair = api.stairInfo(cu, cv);
      if (!api.guardWalk(cu, cv, f) && !onStair) watch.bad.push(`${l.U.toFixed(2)},${l.V.toFixed(2)} f${f} ${api.cellAt(cu, cv, f)}`);
      const want = api.heightAt(f, l.U, l.V);
      if (Math.abs(l.y - want) > 0.01) watch.bad.push(`height ${l.y.toFixed(2)} != ${want.toFixed(2)} at ${l.U.toFixed(1)},${l.V.toFixed(1)} f${f}`);
      if (f === 1) watch.upstairs++;
      const prev = watch.last.get(gd);
      if (prev) {
        if (prev.f !== f) watch.floorChanges++;
        if (Math.hypot(prev.U - l.U, prev.V - l.V) > 2) {
          let nearest = Infinity;
          for (const r of g.players.values()) {
            if (r.jailed >= 0 || !r.pos || (r.pos.f || 0) !== f) continue;
            nearest = Math.min(nearest, Math.hypot(r.pos.U - l.U, r.pos.V - l.V));
          }
          watch.blinks.push({ nearest, chase: prev.state === "chase" || gd.state === "search" });
        }
      }
      watch.last.set(gd, { U: l.U, V: l.V, f, state: gd.state });
    }
  };

  // ---------- Getting spotted, chased, and caught ----------
  function standInFront(p, d = 4.5) {
    for (const gd of game().guards) {
      if (gd.vault) continue;
      for (const turn of [0, 30, -30, 60, -60]) {
        const t = ((gd.yaw + turn) * Math.PI) / 180;
        const U = gd.U - Math.sin(t) * d, V = gd.V + Math.cos(t) * d;
        if (!api.playerWalk(Math.floor(U), Math.floor(V)) || api.cellAt(Math.floor(U), Math.floor(V)) === "g") continue;
        const pp = P(U, V);
        if (api.canSee(gd, pp, game().level, false)) { place(p, U, V); return gd; }
      }
    }
    return undefined;
  }
  async function getCaught(p, max = 1500) {
    for (let i = 0; i < max; i++) {
      if (rec(p)?.jailed >= 0) return true;
      if (i % 120 === 0) standInFront(p, 3);
      advance(1);
    }
    return rec(p)?.jailed >= 0;
  }
  // Stand still in front of a guard. (It can turn away before it notices; then try again.)
  let spotted, caughtAt = -1, tries = 0;
  const before0 = particles.length;
  while (caughtAt < 0 && tries < 6) {
    tries++;
    spotted = undefined;
    for (let i = 0; i < 400 && !spotted; i++) { advance(1); spotted = standInFront(havana); }
    for (let i = 0; i < 250; i++) {
      advance(1);
      if (rec(havana).jailed >= 0) { caughtAt = i; break; }
    }
  }
  check(!!spotted, `found a spot right in front of a guard (${tries} tries)`);
  const newParticles = particles.slice(before0).map((p) => p.id);
  check(newParticles.includes("heist:question") && newParticles.includes("heist:alert"), "the guard goes ? then ! (spotted)");
  check(sounds.some((s) => s.id === "note.flute"), "police whistle");
  check(caughtAt >= 0, `the guard runs over and catches her (${caughtAt} ticks)`);
  const hl = local(havana);
  check(rec(havana).jailed === 0 && hl.U >= 16 && hl.U < 21 && hl.V >= -11 && hl.V < -6, "caught: into jail cell 1");
  check(blockAt(21, -9, 0).typeId === "minecraft:iron_bars", "the door is shut");
  const j0 = game().jails[0];
  check(j0.code.length === 3 && [16, 17, 18].every((u) => true) && [-10, -9, -8].every((v) => /wool/.test(blockAt(15, v, 3).typeId))
    && !/wool/.test(blockAt(15, -11, 3).typeId), "the 3-color code shows up high on the wall");
  check(/Caught!/.test(allMsgs(havana)), "first time in jail: how to get out");
  check(watch.bad.length === 0, `guards stayed on walkable ground so far (${watch.ticks} guard-ticks)`);

  // Wrong button, then the right ones.
  const slotV = (c) => -11 + c.slot;
  const wrong = [{ slot: 0 }, { slot: 1 }, { slot: 3 }, { slot: 4 }].find((c) => c.slot !== j0.code[0].slot);
  advance(5); press(havana, 16, slotV(wrong)); advance(1);
  check(j0.progress === 0 && sounds.slice(-6).some((s) => s.id === "note.bass"), "a wrong button: low buzz, start over");
  for (const c of [...j0.code]) { advance(5); press(havana, 16, slotV(c)); }
  advance(1);
  check(rec(havana).jailed === -1 && blockAt(21, -9, 0).typeId === "minecraft:air", "the right buttons in order: the door opens!");
  check(sounds.some((s) => s.id === "random.levelup"), "with a happy sound");
  const lampsAt = (c) => [0, 1, 2, 3, 4].filter((i) => blockAt(21, c.v0 + i, 3).typeId === "minecraft:ochre_froglight").length;
  check(lampsAt(api.CELLS[0]) === 0, "the lamps go dark when the door opens");
  // What happened to Jeff in 1.0.0: dawdling in the cell and in the doorway, the bars shut him back in for good.
  advance(400);
  check(blockAt(21, -9, 0).typeId === "minecraft:air", "door stays open as long as she's still in the cell (20 s)");
  place(havana, 21.5, -8.5);
  advance(300);
  check(blockAt(21, -9, 0).typeId === "minecraft:air" && blockAt(21, -9, 1).typeId === "minecraft:air", "and while she stands in the doorway");
  place(havana, 22.6, -8.5);
  advance(300);
  check(blockAt(21, -9, 0).typeId === "minecraft:air", "and right outside it");
  place(havana, 26.5, -8.5);
  advance(15);
  check(blockAt(21, -9, 0).typeId === "minecraft:iron_bars" && lampsAt(api.CELLS[0]) === 5, "shuts (lamps back on) once she walks away");
  // If a free player ever ends up in a shut cell anyway, the door opens for her.
  place(havana, 18.5, -9.5);
  advance(15);
  check(blockAt(21, -9, 0).typeId === "minecraft:air" && rec(havana).jailed === -1, "a free player inside a shut cell: the door opens for her");
  place(havana, 26.5, -8.5);
  advance(220);
  check(blockAt(21, -9, 0).typeId === "minecraft:iron_bars", "and shuts again after she leaves");

  // Jeff waits it out.
  const jeffCaught = await getCaught(jeff);
  check(jeffCaught, "Jeff gets caught too");
  const jc = rec(jeff).jailed, cell = api.CELLS[jc];
  const lampsLit = () => [0, 1, 2, 3, 4].filter((i) => blockAt(21, cell.v0 + i, 3).typeId === "minecraft:ochre_froglight").length;
  const counts = [lampsLit()];
  for (let s = 0; s < 5; s++) { advance(240); counts.push(lampsLit()); }
  check(counts.join(",") === "5,4,3,2,1,0", `the lamps go out one by one (${counts.join(",")})`);
  advance(2);
  check(rec(jeff).jailed === -1 && blockAt(21, cell.door, 0).typeId === "minecraft:air", "after a minute the door opens by itself");
  place(jeff, 30.5, -5.5);
  advance(220);
  check(blockAt(21, cell.door, 1).typeId === "minecraft:iron_bars", "door shut again");

  // ---------- The crown ----------
  rec(havana).grace = tick + 100000;
  place(havana, 37.6, 51.5);
  advance(2);
  check(game().carrier === "Havana" && crowns()[0].events.includes("heist:carried"), "walking up to the pedestal grabs the crown");
  check(/Bring it back to the gold square to keep it/.test(havana.bars.join("\n")), "Bring it back to keep it!");
  place(havana, 30.5, 36.5); advance(2);
  check(Math.abs(crowns()[0].location.y - (havana.location.y + 2.15)) < 0.01 && Math.abs(crowns()[0].location.x - havana.location.x) < 0.01, "the crown floats over her head");
  // Caught with the crown: it goes back.
  rec(havana).grace = 0;
  const back = await getCaught(havana);
  check(back && !game().carrier, "caught while carrying it: the crown goes back to the pedestal");
  const ch = api.toLocal(A, crowns()[0].location);
  check(Math.abs(ch.U - 36) < 0.01 && Math.abs(ch.V - 51) < 0.01 && crowns()[0].events.at(-1) === "heist:on_pedestal", "crown back on its cushion");
  // Break out and win this time.
  const j = game().jails[rec(havana).jailed];
  const cellV0 = api.CELLS[rec(havana).jailed].v0;
  for (const c of [...j.code]) { advance(5); press(havana, 16, cellV0 + c.slot); }
  advance(2);
  rec(havana).grace = tick + 100000;
  place(havana, 34.4, 50.5); advance(2);
  check(game().carrier === "Havana", "grabbed it again");
  havana.messages.length = 0; jeff.messages.length = 0;
  place(havana, 35.5, 10.5); advance(2);
  place(havana, 35.5, -4.5); advance(2);
  check(game().phase === "won", "home with the crown: she wins!");
  check(/Havana brought the Golden Crown home in \d+:\d\d! §f\(Easy\)/.test(allMsgs(havana)) && /Havana brought the Golden Crown home/.test(allMsgs(jeff)), "everyone hears who won and the time");
  check(typeof havana.props.get("heist:best_Easy") === "number", "best time saved");
  check(havana.held.Head?.typeId === "heist:golden_crown", "she keeps the crown: it goes right on her head");
  check(!jeff.held.Head && !jeff.props.get("heist:prizes") && !jeff.items.some((i) => i.typeId === "heist:golden_crown"), "only the winner gets it: nothing for Jeff");
  check(havana.bars.includes("§6You got the Golden Crown!") && jeff.bars.includes("§6Havana got the Golden Crown!"), "You got the Golden Crown! / Havana got the Golden Crown!");
  check(typeof jeff.props.get("heist:best_Easy") !== "number", "and only the winner's best time is saved");
  check(havana.props.get("heist:prizes") === 1, "Havana is one step up her treasure ladder");
  check(crowns()[0].heistPrize === 0, "Jeff is still at the crown, so the crown is back on the pedestal");
  advance(60);
  check(entities.some((e) => e.typeId === "minecraft:fireworks_rocket"), "fireworks");
  advance(60);
  check(!game() && guards().length === 0, "after the party the guards vanish");
  check(havana.mode === "survival" && jeff.mode === "creative" && !havana.props.has("heist:prevMode"), "everyone's game mode goes back");
  const ch2 = api.toLocal(A, crowns()[0].location);
  check(crowns().length === 1 && Math.abs(ch2.U - 36) < 0.01 && Math.abs(ch2.V - 51) < 0.01, "the next treasure waits on the pedestal");
  check(commands.at(-1).c === "tickingarea remove heist_arena", "ticking area removed");

  // ---------- A new manor after the win ----------
  {
    const P0 = api.pedestal();
    jobSteps = 3;                                     // build slowly, like on a real iPad
    havana.messages.length = 0; havana.bars.length = 0;
    advance(20);
    place(jeff, 30.5, 30.5);                          // Jeff is wandering around inside
    advance(45);
    check(api.isBuilding() && arena().rebuilding && arena().seed > 0, "after the win, the manor starts turning into a new one");
    const jl = local(jeff);
    check(jl.V < 0, "anyone inside is moved out to the gold square first");
    check(/The Ender Manor is changing!/.test(allMsgs(havana)), "the first time: a chat line saying it changes after every win");
    press(havana, 34, -11); advance(1);
    check(!game() && havana.bars.some((b) => /manor is changing/.test(b)), "buttons wait until it's done (with a note)");
    jobSteps = 400;
    await buildUntilDone();
    const L = api.layout();
    check(!arena().rebuilding && L.seed === arena().seed && L.seed !== 0, "a new manor is ready");
    check(havana.bars.some((b) => /\d+%/.test(b)) && havana.bars.includes("§6A new manor is ready!"), "with progress notes while it changes");
    // The blocks in the world match the new map.
    let match = 0, wrong = [];
    for (let v = 0; v <= 71; v += 3) for (let u = 0; u < 72; u += 3) {
      const ch = api.cellAt(u, v, 0);
      const b0 = blockAt(u, v, 0).typeId, bf = blockAt(u, v, -1).typeId;
      const ok = ch === "W" || ch === "p" ? /end_stone|purpur/.test(b0) : ch === "h" ? /leaves/.test(b0) : ch === "_" || ch === "=" ? /planks|blackstone/.test(bf) && (b0 === "minecraft:air" || /light/.test(b0))
        : ch === "P" ? b0 === "minecraft:quartz_block" : ch === "w" ? b0 === "minecraft:water" : true;
      if (ok) match++; else wrong.push(`${u},${v} ${ch} ${bf}/${b0}`);
    }
    check(wrong.length === 0, `the world matches the new map (${match} spots${wrong.length ? "; e.g. " + wrong.slice(0, 4).join(" ") : ""})`);
    const P = api.pedestal();
    check(`${P.U},${P.V}` !== `${P0.U},${P0.V}`, `the treasure moved (${P0.U},${P0.V} -> ${P.U},${P.V}${P.f ? " upstairs" : ""})`);
    const c = api.toLocal(arena(), crowns()[0].location);
    check(crowns().length === 1 && Math.abs(c.U - P.U) < 0.01 && Math.abs(c.V - P.V) < 0.01 && Math.abs(c.y - api.FLOOR_Y[P.f] - 1.05) < 0.01, "the treasure sits on the new pedestal");
    check(blockAt(35, -4, -1).typeId === "minecraft:gold_block" && blockAt(16, -11, 1).typeId === "minecraft:stone_button" && blockAt(34, -11, 1).typeId === "minecraft:stone_button", "the yard, the jail and the buttons stay the same");
  }

  // ---------- Climbing the treasure ladder ----------
  async function winRound(who = havana) {
    const other = who === havana ? jeff : havana;
    await buildUntilDone();
    place(who, 35.5, -8.5); place(other, 36.5, -4.5);
    press(who, 34, -11);
    advance(62);
    const shown = game().prize;
    const P = api.pedestal();
    rec(havana).grace = rec(jeff).grace = tick + 100000;
    place(who, P.U + 1.2, P.V, api.FLOOR_Y[P.f]); advance(2);
    const grabbed = game().carrier === who.id;
    const prize = game().carried;
    const looks = crowns()[0].heistPrize;
    place(who, 35.5, 10.5); advance(2);
    place(who, 35.5, -4.5); advance(2);
    const won = grabbed && game()?.phase === "won";
    advance(180);
    await buildUntilDone();
    return { won, prize, shown, looks, seed: arena().seed, ped: `${P.U},${P.V},${P.f}` };
  }
  jeff.held.Feet = { typeId: "minecraft:leather_boots" };     // Jeff already has boots on
  const ladder = [];
  for (let i = 0; i < 6; i++) ladder.push(await winRound());
  check(ladder.every((r) => r.won), "six more wins (grabbing the treasure wherever it is, upstairs or down)");
  check(new Set(ladder.map((r) => r.seed)).size === 6 && new Set(ladder.map((r) => r.ped)).size >= 5, "a new manor every round, with the treasure somewhere new");
  check(ladder.map((r) => r.prize).join(",") === "1,2,3,4,5,6" && ladder.every((r) => r.looks === r.prize),
    "in Havana's hands the treasure turns into her next prize: boots, pants, chestplate, sword, apple, Royal Cape");
  check(ladder.every((r) => r.shown === 0), "(while Jeff is still at the crown, the pedestal shows the crown)");
  check(havana.held.Feet?.typeId === "minecraft:golden_boots" && havana.held.Legs?.typeId === "minecraft:golden_leggings"
    && havana.held.Chest?.typeId === "minecraft:golden_chestplate" && havana.held.Head?.typeId === "heist:golden_crown", "Havana is dressed in gold from head to toe");
  check(havana.held.Legs.nameTag === "Golden Pants", "they're called Golden Pants");
  check(havana.items.some((i) => i.typeId === "minecraft:golden_sword") && havana.items.some((i) => i.typeId === "minecraft:enchanted_golden_apple"), "the sword and the apple go in her inventory");
  check(jeff.items.every((i) => !/golden/.test(i.typeId)) && !jeff.props.get("heist:prizes"), "Jeff, who didn't win any of them, got none of them");
  check(havana.items.some((i) => i.typeId === "heist:royal_cape") && havana.held.Chest.typeId === "minecraft:golden_chestplate"
    && /pretty shirt with a cape/.test(allMsgs(havana)), "the Royal Cape: she's wearing the chestplate, so it goes in her inventory, with a note on how to wear it");
  const before7 = havana.items.length;
  const r7 = await winRound();
  check(r7.prize === 7 && havana.items.length - before7 === 3 && new Set(havana.items.slice(-3).map((i) => i.typeId)).size === 3, "after the ladder: a treasure chest of 3 different surprises");
  const r8 = await winRound();
  check(r8.prize === 7 && havana.items.length - before7 === 6, "every time after that");
  // Jeff wins one: he gets his own next prize, and Havana gets nothing this time.
  {
    jeff.props.set("heist:prizes", 1);
    const hBefore = havana.items.length, hFeet = havana.held.Feet;
    havana.bars.length = 0;
    const r = await winRound(jeff);
    check(r.won && r.prize === 1, "Jeff wins a round: in his hands it's his next prize (the boots)");
    check(jeff.held.Feet.typeId === "minecraft:leather_boots" && jeff.items.some((i) => i.typeId === "minecraft:golden_boots"), "his own boots stay on; the golden boots go in his inventory");
    check(havana.items.length === hBefore && havana.held.Feet === hFeet && havana.bars.includes("§6Jeff got the Golden Boots!"), "Havana gets nothing this time, just the news");
  }
  // Someone new joins: the pedestal shows the first step for them.
  jeff.props.set("heist:prizes", 0);
  place(havana, 35.5, -8.5); place(jeff, 36.5, -4.5);
  press(havana, 34, -11); advance(2);
  check(game().prize === 0 && crowns()[0].events.at(-1) === "heist:prize_0", "a player who's further behind: the pedestal goes back to the crown, so nobody skips a step");
  await useMap(havana, 3);
  jeff.props.set("heist:prizes", 8);

  // ---------- A two-story manor ----------
  let twoSeed = 0;
  for (let k = 1; k < 200 && !twoSeed; k++) {
    const L = api.generateLayout(k * 4111);
    if (L.floors.length === 2 && L.pedestal.f === 1) twoSeed = k * 4111;
  }
  await useMap(havana, 3);                            // "Make a new manor" (random), then...
  await buildUntilDone();
  check(api.layout().seed === arena().seed && arena().seed > 0, "Make a new manor from the map");
  api.startRebuild(arena(), twoSeed);
  await buildUntilDone();
  const L2 = api.layout();
  check(L2.floors.length === 2 && L2.pedestal.f === 1 && L2.stairs.length === 1, `a two-story manor with the vault upstairs (seed ${twoSeed})`);
  {
    const st = L2.stairs[0], Ar = arena();
    const stepIds = [0, 1, 2, 3, 4, 5].map((i) => blockAt(st.u + st.du * i, st.v + st.dv * i, i));
    const dirWorld = Ar.r.x * st.du + Ar.f.x * st.dv > 0 ? 0 : Ar.r.x * st.du + Ar.f.x * st.dv < 0 ? 1 : Ar.r.z * st.du + Ar.f.z * st.dv > 0 ? 2 : 3;
    check(stepIds.every((b) => b.typeId === "minecraft:oak_stairs" && b.states.weirdo_direction === dirWorld), "six real stair steps, climbing the right way");
    check([1, 2, 3, 4, 5].every((i) => blockAt(st.u + st.du * i, st.v + st.dv * i, i - 1).typeId === "minecraft:oak_planks"), "with planks under them");
    check([2, 3, 4].every((i) => blockAt(st.u + st.du * i, st.v + st.dv * i, 5).typeId === "minecraft:air"), "and an opening in the floor above");
    // Walk a player-sized box (0.6 wide, 1.8 tall) up the middle of the stairs, a little at a time: it must never bump
    // into anything solid. Its feet are on the highest step under it.
    const solid = (id) => !/air|light_block/.test(id);
    const topOf = (k) => (k < 0 ? 0 : k <= 5 ? k + 1 : 6);
    let bump = "";
    for (let x = -0.7; x <= 7.0 && !bump; x += 0.05) {
      const cols = [Math.floor(x - 0.3), Math.floor(x + 0.3)];
      const feet = Math.max(...cols.map(topOf));
      for (const k of cols) {
        for (let y = Math.floor(feet); y < feet + 1.8; y++) {
          const id = blockAt(st.u + st.du * k, st.v + st.dv * k, y).typeId;
          if (solid(id)) { bump = `at ${x.toFixed(2)} along the stairs, ${id} at height ${y} over step ${k}`; break; }
        }
      }
    }
    check(!bump, `a player fits all the way up the stairs ${bump}`);
    const B = L2.buildings[0];
    check(blockAt(B.u0 + 3, B.v0 + 3, 11).typeId === "minecraft:purpur_block" && /planks|blackstone|end_stone|purpur/.test(blockAt(B.u0 + 2, B.v0 + 2, 5).typeId), "an upstairs floor and the roof on top");
    // Players upstairs: which floor, and the little map.
    const top = { U: st.u + st.du * 6 + 0.5, V: st.v + st.dv * 6 + 0.5 };
    check(api.floorAt(top.U, top.V, 6) === 1 && api.floorAt(st.u + 0.5, st.v + 0.5, 0.5) === 0, "standing upstairs counts as upstairs; on the stairs, downstairs");
  }
  // A guard can find its way from the garden up the stairs into the vault.
  {
    const P = L2.pedestal;
    const path = api.findPath({ u: 35, v: 5, f: 0 }, api.vaultSpots().find((s) => s.f === 1) || { u: Math.floor(P.U) + 2, v: Math.floor(P.V), f: 1 });
    check(path && path.some((n) => n.f === 1) && path[0].f === 0, `guards find a path from the garden up to the vault (${path?.length} steps)`);
    let legal = true;
    for (let i = 1; i < (path || []).length; i++) {
      const a = path[i - 1], b = path[i];
      if (a.f !== b.f) {
        const sa = api.stairInfo(a.u, a.v), sb = api.stairInfo(b.u, b.v);
        if (!sa || !sb || Math.abs(sa.i - sb.i) !== 1) legal = false;
      } else if (Math.max(Math.abs(a.u - b.u), Math.abs(a.v - b.v)) !== 1) legal = false;
    }
    check(legal, "every step of it is one block, and it changes floors only on the stairs");
  }

  // ---------- A long Hard game with wandering robots ----------
  const zombie = dim.spawnEntity("minecraft:zombie", api.toWorldPos(A, 10, 30, 0));
  place(havana, 35.5, -8.5); place(jeff, 36.5, -8.5);
  havana.isSneaking = true;
  press(jeff, 38, -11);
  advance(2);
  check(game().level.name === "Hard" && guards().length === api.guardCount(game()) && guards().length === 7 + Math.min(4, game().prize),
    `Hard: 7 guards, plus one for each treasure step (${guards().length})`);
  check(!zombie.isValid(), "monsters inside are cleared away");
  // ---------- The Rainbow Blaster ----------
  {
    advance(62);                                         // past the countdown
    const g = game();
    rec(havana).grace = rec(jeff).grace = tick + 100000;  // the guards leave us alone while we test
    const hold = (gd, U, V) => { gd.U = U; gd.V = V; gd.f = 0; gd.y = 0; gd.state = "idle"; gd.until = tick + 100000; gd.nextBlink = tick + 100000; gd.path = []; gd.frozenUntil = 0; };
    check(havana.items.some((i) => i.typeId === "heist:rainbow_blaster") && jeff.items.some((i) => i.typeId === "heist:rainbow_blaster"), "everyone got a Rainbow Blaster at their first game");
    watch.paused = true;                                 // (we move guards around by hand here)
    // A straight run of open ground, 22 blocks long, that guards can stand on.
    let run;
    for (let v = 5; v < 68 && !run; v++) for (let u = 3; u + 21 < 69; u++) {
      let ok = true;
      for (let k = 0; k <= 21 && ok; k++) {
        const ch = api.cellAt(u + k, v);
        if (!api.guardWalk(u + k, v) || "cCkbxPsg".includes(ch) || api.cellAt(u + k, v + 1) === "T" || api.cellAt(u + k, v - 1) === "T") ok = false;
      }
      if (ok) { run = { u, v }; break; }
    }
    const Ar = arena(), r = Ar.r, f = Ar.f;
    const aim = (p, du, dv, up = 0) => { const x = r.x * du + f.x * dv, z = r.z * du + f.z * dv, l = Math.hypot(x, up, z); p.view = { x: x / l, y: up / l, z: z / l }; };
    const shoot = (p) => { api.shootRainbow(p); };
    // A guard 10 blocks away along the open ground just inside the gate wall (v 1.5).
    const gd = g.guards[1];
    hold(gd, run.u + 10.5, run.v + 0.5);
    place(havana, run.u + 0.5, run.v + 0.5); aim(havana, 1, 0);
    api.blasterOf(havana).charges = 3;
    const before = particles.length;
    shoot(havana);
    check(havana.bars.at(-1) === "§c\u25cf §e\u25cf §7\u25cb", "a shot: the dots above the hotbar show 2 shots left");
    advance(12);
    const colors = new Set(particles.slice(before).filter((pt) => pt.id === "heist:rainbow").map((pt) => JSON.stringify(pt.color)));
    check(colors.size >= 6, `it trails a rainbow (${colors.size} colours)`);
    check(gd.frozenUntil > tick, "a hit: the guard is frozen");
    const at = { U: gd.U, V: gd.V };
    place(jeff, gd.U + 0.4, gd.V); rec(jeff).grace = 0;
    advance(30);
    check(gd.U === at.U && gd.V === at.V && rec(jeff).jailed < 0, "frozen: it doesn't move, and it can't catch anyone standing right next to it");
    rec(jeff).grace = tick + 100000; place(jeff, 36.5, -4.5);
    advance(25);
    check(!gd.frozenUntil && gd.state === "idle" && gd.target === undefined, "after 3 seconds it wakes up, and has forgotten who it was chasing");
    // Gravity: a guard 20 blocks away is too far for a straight shot (it drops to the ground first), but aiming a
    // little higher gets there.
    hold(gd, run.u + 20.5, run.v + 0.5);
    place(havana, run.u + 0.5, run.v + 0.5); aim(havana, 1, 0);
    api.blasterOf(havana).charges = 3;
    shoot(havana); advance(40);
    check(!gd.frozenUntil, "like an arrow: aimed straight at a guard 20 blocks away, the shot falls short");
    aim(havana, 1, 0, 0.13);
    shoot(havana); advance(40);
    check(gd.frozenUntil > 0, "aiming a little higher, it gets there");
    // Walls stop it.
    let wall;
    for (let v = 5; v < 70 && !wall; v++) for (let u = 4; u < 68; u++) {
      if (api.cellAt(u, v) === "W" && [-3, -2, -1].every((k) => api.playerWalk(u + k, v) && !"cCkbxPs".includes(api.cellAt(u + k, v)))
        && [1, 2, 3].every((k) => api.playerWalk(u + k, v) && !"cCkbxPs".includes(api.cellAt(u + k, v)))) { wall = { u, v }; break; }
    }
    hold(gd, wall.u + 2.5, wall.v + 0.5);
    place(havana, wall.u - 2.5, wall.v + 0.5); aim(havana, 1, 0);
    api.blasterOf(havana).charges = 3;
    shoot(havana); advance(20);
    check(!gd.frozenUntil, "a wall in the way stops the rainbow");
    // Three shots, then it has to recharge.
    api.blasterOf(havana).charges = 3;
    place(havana, run.u + 0.5, run.v + 0.5); aim(havana, -1, 0);
    shoot(havana); shoot(havana); shoot(havana);
    advance(70);                                         // let those three land
    const n0 = particles.length;
    shoot(havana); advance(5);
    check(api.blasterOf(havana).charges === 0 && particles.slice(n0).filter((pt) => pt.id === "heist:rainbow").length === 0, "after 3 shots it's empty: a fourth does nothing");
    advance(game().level.recharge - 70 + 15);
    check(api.blasterOf(havana).charges === 1, `one shot comes back after ${game().level.recharge / 20} seconds on Hard`);
    // Not from jail.
    rec(havana).jailed = 0;
    const n1 = particles.length;
    shoot(havana); advance(5);
    check(api.blasterOf(havana).charges === 1 && particles.slice(n1).filter((pt) => pt.id === "heist:rainbow").length === 0, "no blasting from jail");
    rec(havana).jailed = -1;
    rec(havana).grace = rec(jeff).grace = 0;
    g.guards.forEach((o) => { o.until = tick; o.nextBlink = tick + 200; });
    advance(1);
    watch.last.clear();
    watch.paused = false;
  }
  // Robots: walk to random spots along the grid (through jail doors only when they're open).
  const doorCells = new Set(api.CELLS.map((c) => `21,${c.door}`));
  const robotWalk = (u, v) => (api.playerWalk(u, v) && !"jsu".includes(api.cellAt(u, v))) || (doorCells.has(`${u},${v}`) && blockAt(u, v, 0).typeId === "minecraft:air")
    || (api.cellAt(u, v) === "j" && api.CELLS.some((c) => u >= 16 && u <= 20 && v >= c.v0 && v <= c.v1));
  function route(from, to) {
    const key = (u, v) => `${u},${v}`;
    const prev = new Map([[key(from.u, from.v), null]]); const q = [from];
    for (let i = 0; i < q.length; i++) {
      const c = q[i];
      if (c.u === to.u && c.v === to.v) { const out = []; let k = key(c.u, c.v); while (k) { const [u, v] = k.split(",").map(Number); out.push({ u, v }); k = prev.get(k); } return out.reverse(); }
      for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nu = c.u + du, nv = c.v + dv;
        if (prev.has(key(nu, nv)) || !robotWalk(nu, nv)) continue;
        prev.set(key(nu, nv), key(c.u, c.v)); q.push({ u: nu, v: nv });
      }
    }
    return null;
  }
  const robots = [havana, jeff].map((p) => ({ p, path: [] }));
  const visits = new Map();
  let catches = 0, wasJailed = new Map();
  const movedFrom = new Map(game().guards.map((g) => [g, { U: g.U, V: g.V, dist: 0 }]));
  const prevOnTick = onTick;
  onTick = () => {
    prevOnTick();
    const g = game();
    if (!g) return;
    for (const r of robots) {
      const R = g.players.get(r.p.id);
      if (!R) continue;
      const jailedNow = R.jailed >= 0;
      if (jailedNow && !wasJailed.get(r.p.id)) { catches++; r.path = []; }
      wasJailed.set(r.p.id, jailedNow);
      const me = local(r.p), cu = Math.floor(me.U), cv = Math.floor(me.V);
      if (!r.path.length) {
        const targets = jailedNow ? [] : api.spots().filter((s) => !s.f).concat([{ u: 36, v: -4 }]);
        if (!targets.length) {
          if (blockAt(21, api.CELLS[R.jailed]?.door ?? 0, 0).typeId === "minecraft:air") r.path = route({ u: cu, v: cv }, { u: 26, v: -6 }) || [];
          continue;
        }
        const t = targets[Math.floor(Math.random() * targets.length)];
        r.path = (route({ u: cu, v: cv }, t) || []).slice(1);
      }
      const n = r.path[0];
      if (!n) continue;
      const du = n.u + 0.5 - me.U, dv = n.v + 0.5 - me.V, d = Math.hypot(du, dv);
      const sp = r.p.isSneaking ? 0.065 : 0.216;
      if (d <= sp) { place(r.p, n.u + 0.5, n.v + 0.5); r.path.shift(); }
      else place(r.p, me.U + (du / d) * sp, me.V + (dv / d) * sp);
    }
    for (const gd of g.guards) {
      const m = movedFrom.get(gd);
      if (m) { m.dist += Math.hypot(gd.U - m.U, gd.V - m.V); m.U = gd.U; m.V = gd.V; }
      if (gd.state === "idle" && gd.spot) visits.set(gd, (visits.get(gd) || new Set()).add(`${gd.spot.u},${gd.spot.v}`));
    }
  };
  let threw = null;
  try { advance(9000); } catch (e) { threw = e; }
  check(!threw, `7.5 minutes of Hard with two robots and no errors${threw ? ": " + threw.stack : ""}`);
  check(watch.bad.length === 0, `guards never stepped where they can't walk (${watch.ticks} guard-ticks${watch.bad.length ? ", e.g. " + watch.bad.slice(0, 3).join(" ") : ""})`);
  const dists = [...movedFrom.values()].map((m) => Math.round(m.dist));
  check(dists.every((d) => d > 60), `every guard patrols (walked ${dists.join(", ")} blocks)`);
  const visited = [...visits.values()].map((s) => s.size);
  check(visited.length >= 5 && visited.every((n) => n >= 3), `guards visit lots of different spots (${visited.join(", ")})`);
  check(catches >= 1, `robbers got caught ${catches} times`);
  const vaultGuard = game().guards.find((g) => g.vault);
  const PV = api.pedestal();
  check(vaultGuard && Math.hypot(vaultGuard.U - PV.U, vaultGuard.V - PV.V) < 22, "the vault guard stays near the vault");
  check(watch.upstairs > 0 && watch.floorChanges >= 2, `guards patrol upstairs too, and use the stairs (${watch.floorChanges} trips)`);
  const blinks = watch.blinks;
  check(blinks.length >= 3, `guards teleport now and then (${blinks.length} times)`);
  check(blinks.every((b) => b.nearest >= 5) && blinks.filter((b) => !b.chase).every((b) => b.nearest >= 8),
    `never right next to a robber (closest ${Math.min(...blinks.map((b) => b.nearest)).toFixed(1)} blocks)`);
  onTick = prevOnTick;

  // ---------- Stopping from the map ----------
  // A freed player still hanging around in an open cell when the game is stopped gets moved out.
  {
    const c = api.CELLS[1];
    place(jeff, 18.5, c.v0 + 2.5);
    game().jails[1].open = true; game().jails[1].openAt = tick;
    blocks.set(K(...Object.values(at(21, c.door, 0))), new Perm("minecraft:air"));
    advance(5);
  }

  havana.isSneaking = false;
  place(havana, 30.5, -8.5);
  await useMap(havana, 3);
  check(forms.at(-1).buttons.join("|") === "Play Easy|Play Medium|Play Hard|Stop the game|Take the Ender Manor away", "map menu near the manor during a game");
  check(!game() && guards().length === 0 && havana.mode === "survival", "Stop the game: guards gone, game modes back");
  {
    const jl = local(jeff);
    check(!(jl.U >= 15.5 && jl.U < 23 && jl.V >= -11 && jl.V < 0), "a free player left in a cell when the game stops is moved out");
    // No game: someone stuck in the doorway (where the bars go) is moved out within 5 seconds.
    place(jeff, 21.5, api.CELLS[0].door + 0.5);
    advance(110);
    const jl2 = local(jeff);
    check(jl2.U > 30 && jl2.V > -7 && jl2.V < -2, "no game: anyone in a cell or its doorway is moved out to the gold square");
  }

  // ---------- Reloading while the manor is changing ----------
  {
    const seedBefore = arena().seed;
    api.startRebuild(arena(), 123457);
    { const j = jobs[0]; for (let k = 0; k < 40; k++) j?.next(); }
    check(arena().rebuilding && arena().seed === 123457, "the world closes while the manor is changing");
    api = load();
    jobs.length = 0;
    advance(60);
    await buildUntilDone();
    check(!arena().rebuilding && api.layout().seed === 123457 && seedBefore !== 123457, "after reloading, it picks up and finishes the new manor");
    const P = api.pedestal();
    check(blockAt(Math.floor(P.U), Math.floor(P.V), api.FLOOR_Y[P.f]).typeId === "minecraft:quartz_block", "(the new pedestal is there)");
  }

  // ---------- Reloading mid-game ----------
  await useMap(havana, 1);
  advance(80);
  check(game()?.level.name === "Medium" && guards().length === api.guardCount(game()), "Medium from the map: 5 guards (+ treasure steps)");
  // Put Havana in jail, then the world closes.
  const jailedNow = await getCaught(havana);
  check(jailedNow, "Havana in jail when the world closes");
  api = load();
  advance(30);
  check(guards().length === 0, "after reloading: leftover guards are cleared");
  check(havana.mode === "survival" && jeff.mode === "creative", "game modes restored after reloading");
  const hl2 = local(havana);
  check(!(hl2.U >= 16 && hl2.U < 21 && hl2.V >= -11 && hl2.V < 0), "nobody is left stuck in jail");
  advance(100);
  check(crowns().length === 1, "one crown after reloading");
  press(havana, 36, -11); advance(80);
  check(game()?.level.name === "Medium", "a new game starts fine after reloading");
  await useMap(havana, 3);

  // ---------- Far away ----------
  havana.location = { x: 400, y: 64, z: 400 };
  await useMap(havana, 0);
  check(/The Ender Manor is at/.test(forms.at(-1).b) && arena(), "far away: says where the manor is (only one at a time)");

  // ---------- Taking it away ----------
  place(havana, 40.5, 30.5);
  await useMap(havana, 5, 0);
  await buildUntilDone();
  check(!arena() && /land is back/.test(allMsgs(havana)), "Take it away: gone");
  check(A.tiles.every((t) => !structures.has(t.id)), "saved land pieces deleted");
  let same = 0, diff = 0;
  for (let u = 0; u < 72; u += 3) for (let v = -12; v <= 71; v += 3) for (let y = -2; y <= 6; y++) {
    const w = api.toWorld(A, u, v, y);
    const was = before.get(K(w.x, w.y, w.z))?.typeId ?? (w.y <= 63 ? (w.y === 63 ? "minecraft:grass_block" : "minecraft:dirt") : "minecraft:air");
    if (typeAt(w.x, w.y, w.z) === was) same++; else diff++;
  }
  check(diff === 0, `the land is back exactly how it was (${same} spots checked)`);
  check(crowns().length === 0, "crown gone");
  check(Math.hypot(havana.location.x - A.stand.x - 0.5, havana.location.z - A.stand.z - 0.5) < 1, "players inside are moved out first");

  // ---------- Facing east ----------
  havana.location = { x: 200.5, y: 64, z: 0.5 }; havana.view = { x: 1, y: 0, z: 0 };
  await useMap(havana, 0);
  await buildUntilDone();
  const E = arena();
  check(E && E.f.x === 1 && blockAt(34, -11, 1).states.facing_direction === 5, "facing east: start buttons face east, into the arena");
  const pw = api.toWorld(E, 35, 50, 0);
  check(pw.x === 200 + 64 && typeAt(pw.x, pw.y, pw.z) === "minecraft:quartz_block", "and the pedestal is 64 blocks ahead");
  advance(80);
  place(havana, 35.5, -8.5);
  press(havana, 34, -11); advance(80);
  check(game() && guards().length === api.guardCount(game()), "a game starts on the east-facing manor");
  const g0 = game().guards[1];
  const wl = api.toLocal(E, guards()[1].location);
  check(Math.abs(wl.U - g0.U) < 0.01 && Math.abs(wl.V - g0.V) < 0.01, "guard positions line up with the map");


  // ---------- Capture the Flag ----------
  {
    await useMap(havana, 3);                           // stop the Easy game
    check(!game(), "(game stopped)");
    const Ar = arena();
    // Random arenas: fair (mirror image), bases reachable, guards can't go in.
    {
      const Ls = []; for (let i = 1; i <= 80; i++) Ls.push(api.generateCTF(i * 104729));
      check(Ls.every((L) => L.ctf && L.bases.length === 2), "80 random Capture the Flag arenas");
      let mirrorOk = true, conn = true, safe = true;
      for (const L of Ls) {
        const G = L.floors[0];
        for (let v = 1; v <= 70; v++) for (let u = 1; u <= 35; u++) if (G.get(u, v) !== G.get(71 - u, v)) mirrorOk = false;
        if (!api.allConnected(L)) conn = false;
        api.setLayout(L.seed, true);
        for (const b of L.bases) for (let v = b.home.v0; v <= b.home.v1; v++) for (let u = b.home.u0; u <= b.home.u1; u++) if (api.guardWalk(u, v)) safe = false;
      }
      check(mirrorOk, "both halves are mirror images, so it's fair");
      check(conn, "everything is reachable from the gate");
      check(safe, "guards can't walk into the bases");
      check(new Set(Ls.map((L) => L.bases[0].ped.V)).size > 15 && Ls.filter((L) => L.buildings.length).length > 40, "the bases move around, and most arenas have a house in the middle");
      api.setLayout(Ar.seed, !!Ar.ctf);
    }
    // One player alone can't start it.
    place(havana, 35.5, -8.5); place(jeff, 36.5, -8.5);
    jeff.valid = false;
    havana.bars.length = 0;
    press(havana, 40, -11); advance(2);
    check(!game() && havana.bars.includes("§eCapture the Flag needs 2 players!"), "the purple button with only one player: needs 2 players");
    jeff.valid = true;
    check(blockAt(40, -12, 1).typeId === "minecraft:purple_wool" && blockAt(40, -11, 1).typeId === "minecraft:stone_button"
      && [...signs.values()].includes("Capture\nthe Flag"), "a purple Capture the Flag button on the little wall");
    // Two players: the manor turns into an arena, then the game starts.
    advance(10);
    jobSteps = 3;
    press(havana, 40, -11); advance(2);
    check(arena().ctf && arena().rebuilding && !game(), "pressing it turns the manor into a Capture the Flag arena");
    jobSteps = 400;
    await buildUntilDone();
    advance(30);
    check(game()?.ctf && api.layout().ctf, "and then the game starts");
    const L = api.layout(), B0 = L.bases[0], B1 = L.bases[1];
    const hr = rec(havana), jr = rec(jeff);
    check(hr.team === 0 && jr.team === 1, "Havana (who pressed it) is Red, Jeff is Blue");
    check(Math.hypot(local(havana).U - B0.start.U, local(havana).V - B0.start.V) < 1.6 && Math.hypot(local(jeff).U - B1.start.U, local(jeff).V - B1.start.V) < 1.6,
      "each starts on their own gold square, at opposite ends");
    check(/You're on the Red team!/.test(allMsgs(havana)) && /Capture the Flag!/.test(allMsgs(havana)), "the rules, and which team you're on");
    const fl = api.getFlags();
    check(crowns().length === 2 && fl.length === 2 && fl.every((f) => f.e.isValid()), "two treasures, one in each base");
    const fh = (t) => api.toLocal(arena(), fl[t].e.location);
    check(Math.abs(fh(0).U - B0.ped.U) < 0.01 && Math.abs(fh(1).U - B1.ped.U) < 0.01, "on each base's pedestal");
    check(blockAt(5, B0.ped.V + 2, -1).typeId === "minecraft:red_concrete" && blockAt(66, B1.ped.V + 2, -1).typeId === "minecraft:blue_concrete"
      && blockAt(2, B0.ped.V - 5, 0).typeId === "minecraft:red_wool" && blockAt(4, B0.ped.V, -1).typeId === "minecraft:gold_block", "red and blue bases, each with a gold square");
    check(guards().length === 4, "4 Ender Guards");
    advance(65);
    check(game().phase === "play", "3, 2, 1, go!");
    {
      const bad0 = watch.bad.length;
      hr.grace = jr.grace = 0;
      advance(2400);
      check(hr.jailed < 0 && jr.jailed < 0 && watch.bad.length === bad0 && game().guards.every((g) => api.guardWalk(Math.floor(g.U), Math.floor(g.V))),
        "2 minutes standing in your bases: guards patrol but never come in, and nobody gets caught");
    }
    // Havana sneaks over and grabs the Blue treasure.
    hr.grace = jr.grace = tick + 100000;
    place(havana, B1.ped.U - 1.3, B1.ped.V); advance(2);
    check(fl[1].carrier === "Havana" && fl[1].e.events.includes("heist:carried"), "Havana grabs the Blue treasure");
    place(jeff, B1.ped.U - 1.3, B0.ped.V); place(havana, B1.ped.U - 1.3, B1.ped.V); advance(2);
    check(fl[0].carrier === undefined, "(Jeff can't take his own team's treasure)");
    // Jeff blasts her: she's sent home and the treasure goes back.
    const r = arena().r, f = arena().f;
    place(havana, 61.5, B1.ped.V + 0.5);
    place(jeff, 55.5, B1.ped.V + 0.5);
    jeff.view = { x: r.x, y: 0, z: r.z };
    api.blasterOf(jeff).charges = 3;
    api.shootRainbow(jeff); advance(12);
    check(Math.hypot(local(havana).U - B0.start.U, local(havana).V - B0.start.V) < 0.6 && havana.bars.includes("§dBlasted! Back to your base!"), "Jeff's rainbow hits her: back to her base");
    check(fl[1].carrier === undefined && Math.abs(fh(1).U - B1.ped.U) < 0.01, "and the Blue treasure goes back on its pedestal");
    // Havana's shots go right past her own teammates... (only one per team here), and hit Jeff.
    place(jeff, 20.5, B0.ped.V + 0.5);
    place(havana, 14.5, B0.ped.V + 0.5);
    havana.view = { x: -r.x, y: 0, z: -r.z };
    havana.view = { x: r.x, y: 0, z: r.z };
    api.blasterOf(havana).charges = 3;
    api.shootRainbow(havana); advance(12);
    check(Math.hypot(local(jeff).U - B1.start.U, local(jeff).V - B1.start.V) < 0.6, "she can blast Jeff too");
    // Caught by a guard while carrying it: the treasure goes home, she goes to jail (like a heist).
    place(havana, B1.ped.U - 1.3, B1.ped.V); advance(2);
    check(fl[1].carrier === "Havana", "she grabs it again");
    hr.grace = 0;
    const gd = game().guards[0];
    gd.U = 50.5; gd.V = B1.ped.V + 0.5; gd.f = 0; gd.y = 0; gd.frozenUntil = 0;
    place(havana, 50.9, B1.ped.V + 0.5); advance(3);
    check(hr.jailed >= 0 && fl[1].carrier === undefined, "caught by a guard: off to jail, and the treasure goes home");
    // Out of jail, grab it, and run it home: Red wins.
    hr.jailed = -1; for (const j of game().jails) j.inside.clear();
    hr.grace = tick + 100000;
    const prizesBefore = havana.props.get("heist:prizes") || 0, jeffBefore = jeff.props.get("heist:prizes") || 0;
    havana.messages.length = 0; jeff.messages.length = 0;
    place(havana, B1.ped.U - 1.3, B1.ped.V); advance(2);
    place(havana, 30.5, B0.ped.V + 0.5); advance(2);
    check(fl[1].carrier === "Havana", "(on her way home with it)");
    place(havana, B0.start.U, B0.start.V); advance(2);
    check(game().phase === "won", "on her own gold square with the Blue treasure: Red wins! (first capture wins)");
    check(havana.bars.some((b) => /^§6You won! You got the /.test(b)) && (jeff.props.get("heist:prizes") || 0) === jeffBefore
      && havana.props.get("heist:prizes") >= Math.min(prizesBefore, 7) + 1, "the winner gets her next prize (Jeff doesn't)");
    check(/Havana captured the Blue treasure! Red wins!/.test(allMsgs(jeff)), "everyone hears who won");
    const seed1 = arena().seed;
    advance(110);
    check(!game() && guards().length === 0 && havana.mode === "survival", "the game ends");
    advance(45);
    await buildUntilDone();
    check(arena().ctf && arena().seed !== seed1 && api.layout().ctf && crowns().length === 2, "and a brand-new Capture the Flag arena is made");
    // The green button turns it back into a manor and starts an Easy heist.
    place(havana, 35.5, -8.5); place(jeff, 36.5, -8.5);
    jobSteps = 3;
    press(havana, 34, -11); advance(2);
    check(!game() && arena().rebuilding && !arena().ctf, "pressing Easy turns it back into a manor first");
    jobSteps = 400;
    await buildUntilDone();
    advance(30);
    check(game() && !game().ctf && game().level.name === "Easy" && !api.layout().ctf, "then the heist starts");
    advance(20);
    check(crowns().length === 1 && api.getFlags().filter(Boolean).length === 0, "one treasure again (the team treasures are gone)");
    await useMap(havana, 3);
  }

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
