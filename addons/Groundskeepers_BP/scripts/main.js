// Groundskeeper Elves: two little elves live in the Elf Shed. Every morning they come out and tidy the yard
// around it: they mow short and tall grass, shovel snow, and rake up fallen leaves (leaf litter), carry the
// clippings to a composter (and build one next to the shed if there isn't one), and leave snowballs and bone
// meal in a chest by the shed. Flowers and anything built are never touched. Tap the shed for a menu.
// Testing (cheats on): /scriptevent grounds:shift   sends the nearest shed's elves out right away.
import { world, system, ItemStack, MolangVariableMap, BlockPermutation } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const SHED = "grounds:elf_shed";
const ELF = "grounds:elf";
const NAMES = ["Twig", "Nutmeg", "Pinecone", "Sprout", "Bilberry", "Tinker", "Bumble", "Juniper", "Thistle", "Sorrel",
  "Fennel", "Sage", "Hollyhock", "Pebblenose"];
const LOOKS = ["green", "red", "blue", "purple"];          // entity variants 0-3 (outfits in the resource pack)
const YARD = 16;                     // blocks all around the shed that the elves look after
const YARD_UP = 4, YARD_DOWN = 4;    // blocks above/below the shed that count as the yard
const SHIFT_START = 1000;            // elves come out after this time of day (early morning)...
const LAST_START = 11000;            // ...but not later than this
const GO_HOME = 12300;               // sunset: everyone heads home
const NIGHT_END = 23200;            // elves sleep from GO_HOME until this time
const NEAR = 40;                     // someone has to be this close for the elves to come out (so the whole yard is loaded)
const MAX_SHIFT = 20 * 720;          // 12 minutes at most; whatever's left waits for tomorrow
const SPEED = 0.12;                  // blocks per tick
const STUCK_TICKS = 50;              // can't get closer for this long: magic hop
const CARRY_MAX = 16;                // clippings before a trip to the composter
const SCAN_PER_TICK = 48;            // yard columns looked at per tick
const WORK = { grass: 36, tall: 48, snow: 24, leaves: 18, deposit: 24, build: 50, look: 30 };
const COMPOST = { grass: 0.3, tall: 0.5, leaves: 0.3 }; // chance each clipping raises the composter (same as vanilla)
const JOB = { grass: "mow", tall: "mow", snow: "snow", leaves: "leaves" };
const TOOL = { grass: 1, tall: 1, snow: 2, leaves: 3, deposit: 4, build: 2, look: 0 };
const DIMS = ["overworld", "nether", "the_end"];
const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

// ---------- Saved data ----------
function getJSON(holder, k, fallback) {
  try {
    const raw = holder.getDynamicProperty(k);
    if (typeof raw === "string") return JSON.parse(raw);
  } catch {}
  return fallback;
}
function setJSON(holder, k, value) {
  try {
    holder.setDynamicProperty(k, value === undefined ? undefined : JSON.stringify(value));
  } catch {}
}
const sheds = () => getJSON(world, "grounds:sheds", []);
const saveSheds = (list) => setJSON(world, "grounds:sheds", list.slice(-16));
const keyOf = (s) => `${s.dim}|${s.x},${s.y},${s.z}`;
function updateShed(k, fn) {
  const list = sheds();
  const s = list.find((r) => keyOf(r) === k);
  if (!s) return undefined;
  fn(s);
  saveSheds(list);
  return s;
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const alive = (e) => {
  try {
    return typeof e.isValid === "function" ? e.isValid() : e.isValid !== false;
  } catch {
    return false;
  }
};
const both = (names) => (names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names.at(-1));
const elfNames = (s) => both(s.elves.map((e) => e.name));

function playersNear(dimId, loc, range) {
  return world.getAllPlayers().filter((p) => {
    try {
      return p.dimension.id === dimId && flat(p.location, loc) <= range && Math.abs(p.location.y - loc.y) <= range;
    } catch {
      return false;
    }
  });
}
function tellNear(dimId, loc, msg) {
  for (const p of playersNear(dimId, loc, NEAR)) {
    try { p.sendMessage(msg); } catch {}
  }
}

// ---------- Blocks ----------
function blockAt(dim, x, y, z) {
  try {
    return dim.getBlock({ x, y, z });
  } catch {
    return undefined;
  }
}
const typeAt = (dim, x, y, z) => blockAt(dim, x, y, z)?.typeId;
function state(block, name) {
  try {
    return block.permutation.getState(name);
  } catch {
    return undefined;
  }
}
let airPerm;
function setAir(block) {
  try {
    airPerm ??= BlockPermutation.resolve("minecraft:air");
    block.setPermutation(airPerm);
    return true;
  } catch {
    return false;
  }
}

// What the elves tidy up. Tall grass is found by its bottom half.
function kindOf(block) {
  const id = block?.typeId;
  if (!id) return undefined;
  if (id === "minecraft:short_grass") return "grass";
  if (id === "minecraft:tallgrass") return state(block, "tall_grass_type") === "fern" ? undefined : "grass"; // older versions
  if (id === "minecraft:tall_grass") return state(block, "upper_block_bit") ? undefined : "tall";
  if (id === "minecraft:double_plant") {                                                               // older versions
    return state(block, "double_plant_type") === "grass" && !state(block, "upper_block_bit") ? "tall" : undefined;
  }
  if (id === "minecraft:snow_layer") return "snow";
  if (id === "minecraft:leaf_litter") return "leaves";
  return undefined;
}

// Only tidy things lying on natural ground or paths: not snow on a roof, a wall, or a tree.
const GROUND = /(grass_block|dirt|dirt_with_roots|podzol|mycelium|moss_block|mud|sand|gravel|clay|grass_path|dirt_path|farmland|^minecraft:grass|^minecraft:stone|cobblestone|andesite|diorite|granite|tuff|calcite|^minecraft:snow|ice)$/;

// Things an elf walks right through: air, plants, flowers, snow, fallen leaves, torches, carpets.
const CLEAR = /(^|:)air$|short_grass|tall_grass|tallgrass|double_plant|fern|flower|tulip|poppy|dandelion|orchid|allium|bluet|daisy|cornflower|lily_of_the_valley|bush|snow_layer|vine|sapling|torch|sugar_cane|light_block|petals|structure_void|wildflowers|leaf_litter|carpet|rail|pressure_plate|button|redstone_wire|lever|sweet_berry|seagrass|cactus_flower|firefly/;
const isClear = (id) => CLEAR.test(id);
// Things they won't stand on: they go around (or hop over by magic).
const BLOCKING = /fence|wall|pane|iron_bars|door|gate|bed$|cactus$|campfire|magma|water|lava|fire$|powder_snow|composter|grounds:|chest|barrel|leaves$/;

// The standing height (top of the ground) closest to nearY, or undefined.
function groundY(dim, x, z, nearY, range) {
  const bx = Math.floor(x), bz = Math.floor(z), y0 = Math.floor(nearY);
  let above = typeAt(dim, bx, y0 + range + 1, bz);
  let best;
  for (let y = y0 + range; y >= y0 - range; y--) {
    const id = typeAt(dim, bx, y, bz);
    if (id === undefined) return best;
    if (above !== undefined && isClear(above) && !isClear(id)) {
      if (best === undefined || Math.abs(y + 1 - nearY) < Math.abs(best - nearY)) best = y + 1;
    }
    above = id;
  }
  return best;
}

// Where an elf would stand at (x, z) coming from height fromY: at most 1 block up or 3 down, not onto a fence,
// water, or a chest. ctx = { dim, cache }; the cache lasts one shift.
function standAt(ctx, x, z, fromY) {
  const bx = Math.floor(x), bz = Math.floor(z), fy = Math.floor(fromY + 0.5);
  const k = `${bx},${bz},${fy}`;
  if (ctx.cache.has(k)) return ctx.cache.get(k);
  let res;
  const gy = groundY(ctx.dim, x, z, fromY, 4);
  if (gy !== undefined && gy - fromY <= 1.1 && fromY - gy <= 3.1) {
    const under = typeAt(ctx.dim, bx, gy - 1, bz);
    if (under !== undefined && !BLOCKING.test(under)) res = gy;
  }
  ctx.cache.set(k, res);
  return res;
}
// Can an elf stand right here (feet in this block)?
function standable(dim, x, y, z) {
  const feet = typeAt(dim, x, y, z), under = typeAt(dim, x, y - 1, z);
  return feet !== undefined && under !== undefined && isClear(feet) && !isClear(under) && !BLOCKING.test(under);
}

// ---------- Particles and sounds ----------
const COLORS = {
  grass: [[0.36, 0.7, 0.25], [0.46, 0.8, 0.3], [0.28, 0.58, 0.2]],
  tall: [[0.36, 0.7, 0.25], [0.46, 0.8, 0.3], [0.28, 0.58, 0.2]],
  snow: [[0.95, 0.97, 1], [0.88, 0.93, 1]],
  leaves: [[0.86, 0.46, 0.16], [0.74, 0.3, 0.12], [0.92, 0.72, 0.2], [0.56, 0.36, 0.16]],
  sparkle: [[1, 0.86, 0.36], [0.6, 0.95, 0.5], [1, 1, 1]],
  build: [[0.6, 0.42, 0.24], [0.5, 0.34, 0.2]],
  deposit: [[0.36, 0.7, 0.25], [0.6, 0.42, 0.24]],
};
function particle(dim, id, loc, kind) {
  try {
    const c = pick(COLORS[kind] ?? COLORS.sparkle);
    const vars = new MolangVariableMap();
    vars.setColorRGB("variable.color", { red: c[0], green: c[1], blue: c[2] });
    dim.spawnParticle(id, loc, vars);
  } catch {}
}
const bits = (dim, loc, kind) => particle(dim, "grounds:bits", loc, kind);
function sparkle(dim, loc, n) {
  for (let i = 0; i < n; i++) {
    particle(dim, "grounds:sparkle", { x: loc.x + (Math.random() - 0.5) * 1.2, y: loc.y + Math.random() * 1.2, z: loc.z + (Math.random() - 0.5) * 1.2 }, "sparkle");
  }
}
function sound(id, loc, pitch = 1, volume = 1) {
  try {
    world.playSound(id, loc, { pitch, volume });
  } catch {}
}
const WORK_SOUND = { grass: "mob.sheep.shear", tall: "mob.sheep.shear", snow: "dig.snow", leaves: "dig.grass", build: "dig.wood", deposit: "dig.grass" };

// ---------- Starter kit (no cheats needed) ----------
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      if (player.getDynamicProperty("grounds:got_shed")) return;
      const inv = player.getComponent("minecraft:inventory").container;
      const leftover = inv.addItem(new ItemStack(SHED, 1));
      if (leftover) player.dimension.spawnItem(leftover, player.location);
      player.setDynamicProperty("grounds:got_shed", true);
      player.sendMessage("§2You got an Elf Shed! §fPut it down in your yard and two little groundskeeper elves will move in. Every morning they come out to mow the grass, shovel snow, and rake leaves.");
    } catch {}
  }, 120);
});

// ---------- Putting up and taking down a shed ----------
const welcome = new Map(); // shed key -> tick when the new elves come out for the first time (memory only)

world.afterEvents.playerPlaceBlock.subscribe(({ player, block }) => {
  if (block.typeId !== SHED) return;
  const l = block.location, dim = block.dimension.id;
  const dir = state(block, "minecraft:cardinal_direction") ?? "south";
  const looks = [0, 1, 2, 3].sort(() => Math.random() - 0.5).slice(0, 2);
  const names = [...NAMES].sort(() => Math.random() - 0.5).slice(0, 2);
  const s = {
    dim, x: l.x, y: l.y, z: l.z, dir, owner: player.name, elves: names.map((name, i) => ({ name, look: looks[i] })),
    jobs: { mow: true, snow: true, leaves: true, compost: true }, lastDay: -1, built: false,
  };
  const list = sheds().filter((r) => keyOf(r) !== keyOf(s));
  list.push(s);
  saveSheds(list);
  const t = world.getTimeOfDay();
  const daytime = t >= SHIFT_START && t <= LAST_START;
  if (daytime) welcome.set(keyOf(s), system.currentTick + 100);
  player.sendMessage(`§2You put up an Elf Shed! §f${elfNames(s)} moved in. ` + (daytime
    ? "They're unpacking their tools and will come out in a moment!"
    : "They'll come out to tidy the yard in the morning.") + " §7(Tap the shed to choose what they do.)");
  sparkle(block.dimension, { x: l.x + 0.5, y: l.y + 0.8, z: l.z + 0.5 }, 10);
  sound("note.bell", l, 2, 0.6);
});

world.afterEvents.playerBreakBlock.subscribe(({ player, block, brokenBlockPermutation }) => {
  if (brokenBlockPermutation?.type?.id !== SHED) return;
  const k = keyOf({ dim: block.dimension.id, ...block.location });
  const s = sheds().find((r) => keyOf(r) === k);
  saveSheds(sheds().filter((r) => keyOf(r) !== k));
  welcome.delete(k);
  const sh = shifts.get(k);
  if (sh) endShift(sh, "gone");
  if (s) {
    try { player.sendMessage(`§2${elfNames(s)}§f packed up their tools and waved goodbye. Put the shed back up and new elves will move in.`); } catch {}
  }
});

function shedBlock(s) {
  return blockAt(world.getDimension(s.dim), s.x, s.y, s.z);
}
function setOpen(s, open) {
  const b = shedBlock(s);
  if (!b || b.typeId !== SHED) return;
  try {
    if (state(b, "grounds:open") !== open) b.setPermutation(b.permutation.withState("grounds:open", open));
  } catch {}
}

// ---------- When the elves come out ----------
const shifts = new Map(); // shed key -> shift (memory only)

system.runInterval(() => {
  const list = sheds();
  let changed = false;
  for (const s of list) {
    const k = keyOf(s);
    if (shifts.has(k)) continue;
    const b = shedBlock(s);
    if (!b) continue; // too far away to see right now
    if (b.typeId !== SHED) {
      s.gone = true; // broken some other way (explosion, command)
      changed = true;
      continue;
    }
    if (state(b, "grounds:open")) setOpen(s, false); // left open when the world closed mid-shift
    const t = world.getTimeOfDay(), day = world.getDay();
    if (t < SHIFT_START || t > LAST_START) continue;
    const first = welcome.get(k);
    if (first !== undefined ? system.currentTick < first : s.lastDay === day) continue;
    if (!playersNear(s.dim, s, NEAR).length) continue;
    welcome.delete(k);
    startShift(s);
  }
  if (changed) saveSheds(list.filter((s) => !s.gone));
}, 20);

const isNight = () => {
  const t = world.getTimeOfDay();
  return t >= GO_HOME && t < NIGHT_END;
};

// The spot right outside the door (or any open spot next to the shed).
function doorSpot(s) {
  const dim = world.getDimension(s.dim);
  const [fx, fz] = DIRS[s.dir] ?? DIRS.south;
  const tries = [[fx, fz], [fz, fx], [-fz, -fx], [fx + fz, fz + fx], [fx - fz, fz - fx], [-fx, -fz], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  for (const [dx, dz] of tries) {
    for (const dy of [0, 1, -1]) {
      if (standable(dim, s.x + dx, s.y + dy, s.z + dz)) return { x: s.x + dx + 0.5, y: s.y + dy, z: s.z + dz + 0.5 };
    }
  }
  return undefined;
}

function startShift(s, by) {
  const k = keyOf(s);
  if (shifts.has(k)) return false;
  const dim = world.getDimension(s.dim);
  const door = doorSpot(s);
  if (!door) {
    if (by) try { by.sendMessage("§eThe elves can't get out! Clear some room in front of the shed door."); } catch {}
    return false;
  }
  const cols = [];
  for (let dx = -YARD; dx <= YARD; dx++) {
    for (let dz = -YARD; dz <= YARD; dz++) if (dx * dx + dz * dz <= YARD * YARD + 1) cols.push([dx, dz]);
  }
  cols.sort((a, b) => a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1]);
  const sh = {
    k, s, dim, door, cache: new Map(), tick: 0, cols, scanAt: 0, scans: 0, scanEnd: 0,
    targets: new Map(), composters: [], building: null, elves: [], ending: false,
    totals: { grass: 0, snow: 0, leaves: 0, compost: 0, boneMeal: 0, snowballs: 0 }, ready: false, expected: s.elves.length,
  };
  sh.ctx = { dim, cache: sh.cache };
  shifts.set(k, sh);
  updateShed(k, (r) => { r.lastDay = world.getDay(); });
  setOpen(s, true);
  sound("random.door_open", door, 1.3);
  [0, 3, 6].forEach((d, i) => system.runTimeout(() => sound("note.bell", door, 1.6 + i * 0.2, 0.5), d + 1));
  tellNear(s.dim, s, `§2*jingle jingle* §f${elfNames(s)} came out of the Elf Shed to tidy the yard!`);
  s.elves.forEach((info, i) => system.runTimeout(() => spawnElf(sh, info), 1 + i * 24));
  sh.run = system.runInterval(() => stepShift(sh), 1);
  return true;
}

function spawnElf(sh, info) {
  if (shifts.get(sh.k) !== sh) return;
  let e;
  try {
    e = sh.dim.spawnEntity(ELF, sh.door);
  } catch (err) {
    console.warn(`[Groundskeeper Elves] Could not bring out ${info.name}: ${err}`);
    sh.expected--;
    return;
  }
  try { e.triggerEvent(`grounds:look_${info.look}`); } catch {}
  try { e.nameTag = info.name; } catch {}
  const [fx, fz] = DIRS[sh.s.dir] ?? DIRS.south;
  const el = {
    e, name: info.name, pos: { ...sh.door }, heading: Math.atan2(fz, fx), phase: "out", tool: -1, act: "",
    goal: { x: sh.door.x + fx * 1.2, y: sh.door.y, z: sh.door.z + fz * 1.2 }, task: null, carry: [], waits: 0,
    greeted: new Set(), pause: 0, strolls: 2, lastLine: -999,
  };
  const gy = standAt(sh.ctx, el.goal.x, el.goal.z, sh.door.y);
  if (gy === undefined) el.goal = { ...sh.door };
  else el.goal.y = gy;
  setLook(el, 0, "walk");
  sh.elves.push(el);
  sparkle(sh.dim, sh.door, 6);
  sound("random.pop", sh.door, 1.6, 0.6);
}

function setLook(el, tool, act) {
  if (tool !== el.tool) {
    el.tool = tool;
    try { el.e.triggerEvent(`grounds:tool_${tool}`); } catch {}
  }
  if (act !== el.act) {
    el.act = act;
    try { el.e.triggerEvent(`grounds:${act}`); } catch {}
  }
}

function face(el, toward) {
  const dx = toward ? toward.x - el.pos.x : Math.cos(el.heading), dz = toward ? toward.z - el.pos.z : Math.sin(el.heading);
  try {
    el.e.teleport(el.pos, { rotation: { x: 0, y: (Math.atan2(-dx, dz) * 180) / Math.PI } });
  } catch {}
}

// ---------- Looking over the yard ----------
// A few columns per tick, nearest first. Finds things to tidy and any composters.
function scanSome(sh) {
  const s = sh.s;
  const end = Math.min(sh.cols.length, sh.scanAt + SCAN_PER_TICK);
  for (; sh.scanAt < end; sh.scanAt++) {
    const [dx, dz] = sh.cols[sh.scanAt];
    const x = s.x + dx, z = s.z + dz;
    // Walk down the column; each block is checked along with the one under it.
    let cur = blockAt(sh.dim, x, s.y + YARD_UP, z);
    for (let y = s.y + YARD_UP; y >= s.y - YARD_DOWN && cur; y--) {
      const under = blockAt(sh.dim, x, y - 1, z);
      if (cur.typeId === "minecraft:composter") sh.composters.push({ x, y, z });
      const kind = kindOf(cur);
      if (kind && under && GROUND.test(under.typeId)) {
        const k = `${x},${y},${z}`;
        const old = sh.targets.get(k);
        if (!old || old.done) sh.targets.set(k, { x, y, z, kind, k, done: false, by: null });
      }
      cur = under;
    }
  }
  if (sh.scanAt >= sh.cols.length && !sh.ready) {
    sh.ready = true;
    sh.scans++;
    sh.scanEnd = sh.tick;
    if (sh.scans === 1) sh.found = sh.targets.size;
  }
}

function rescan(sh) {
  sh.scanAt = 0;
  sh.ready = false;
  sh.composters = [];
}

// ---------- The shift ----------
function stepShift(sh) {
  sh.tick++;
  if (!sh.ready) scanSome(sh);
  if (!playersNear(sh.s.dim, sh.s, NEAR + 16).length) return endShift(sh, "away");
  const b = shedBlock(sh.s);
  if (b && b.typeId !== SHED) return endShift(sh, "gone");
  if (!sh.ending && (sh.tick > MAX_SHIFT || (world.getTimeOfDay() >= GO_HOME && world.getTimeOfDay() < NIGHT_END))) {
    sh.ending = true;
  }
  for (const el of sh.elves) {
    if (el.home) continue;
    if (!alive(el.e)) {
      el.home = true;
      if (el.task?.target) el.task.target.by = null;
      continue;
    }
    stepElf(sh, el);
  }
  if (sh.elves.length >= sh.expected && sh.elves.every((el) => el.home)) finishShift(sh);
  else if (sh.tick > MAX_SHIFT + 20 * 60) endShift(sh, "late"); // something went wrong: don't run forever
}

const enabled = (sh, kind) => sh.s.jobs?.[JOB[kind]] !== false;

function nextTarget(sh, el) {
  let best, bestCost = Infinity;
  for (const t of sh.targets.values()) {
    if (t.done || t.by || !enabled(sh, t.kind)) continue;
    const cost = flat(el.pos, { x: t.x + 0.5, z: t.z + 0.5 }) + Math.abs(t.y - el.pos.y) * 2 + (JOB[t.kind] !== el.lastJob ? 3 : 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = t;
    }
  }
  return best;
}

function liveComposter(sh) {
  for (const c of [sh.composter, ...sh.composters]) {
    if (c && typeAt(sh.dim, c.x, c.y, c.z) === "minecraft:composter") return (sh.composter = c);
  }
  return undefined;
}

// A spot next to the shed (not in front of the door) with solid ground under it, for a new composter.
function buildSpot(sh) {
  const s = sh.s, [fx, fz] = DIRS[s.dir] ?? DIRS.south;
  const order = [[fz, fx], [-fz, -fx], [-fx, -fz], [fz - fx, fx - fz], [-fz - fx, -fx - fz], [2 * fz, 2 * fx], [-2 * fz, -2 * fx]];
  for (const [dx, dz] of order) {
    const x = s.x + dx, z = s.z + dz;
    for (const dy of [0, -1, 1]) {
      const y = s.y + dy;
      const here = typeAt(sh.dim, x, y, z), under = typeAt(sh.dim, x, y - 1, z), over = typeAt(sh.dim, x, y + 1, z);
      if (here && under && over && isClear(here) && !isClear(under) && !BLOCKING.test(under) && isClear(over) && !/flower|tulip|poppy|dandelion|orchid|allium|bluet|daisy|cornflower|lily|sapling|petals/.test(here)) {
        return { x, y, z };
      }
    }
  }
  return undefined;
}

// Somewhere an elf can stand next to a block (to use the composter, or to build one).
function besideSpot(sh, el, c) {
  let best, bd = Infinity;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    for (const dy of [0, -1, 1]) {
      const x = c.x + dx, y = c.y + dy, z = c.z + dz;
      if (!standable(sh.dim, x, y, z)) continue;
      const d = flat(el.pos, { x: x + 0.5, z: z + 0.5 }) + Math.abs(dy);
      if (d < bd) {
        bd = d;
        best = { x: x + 0.5, y, z: z + 0.5 };
      }
    }
  }
  return best;
}

function chooseTask(sh, el) {
  el.task = null;
  el.best = Infinity;
  el.sinceBest = 0;
  // Clippings to drop off first?
  const nothingLeft = sh.ready && !nextTarget(sh, el);
  if (el.carry.length && (el.carry.length >= CARRY_MAX || nothingLeft || sh.ending)) {
    const spot = !sh.s.built && !sh.building && sh.s.jobs?.compost !== false && !liveComposter(sh) ? buildSpot(sh) : undefined;
    if (sh.s.jobs?.compost === false) {
      el.carry = [];
    } else if (liveComposter(sh)) {
      const at = besideSpot(sh, el, sh.composter) ?? { ...el.pos };
      return go(el, { kind: "deposit", at, look: { x: sh.composter.x + 0.5, z: sh.composter.z + 0.5 } });
    } else if (sh.building) {
      if (nothingLeft || sh.ending) return idle(el, 20); // a friend is building the composter: wait for it
      // otherwise keep working; the clippings wait in the sack
    } else if (spot) {
      sh.building = el;
      const at = besideSpot(sh, el, spot) ?? { ...sh.door };
      return go(el, { kind: "build", spot, at, look: { x: spot.x + 0.5, z: spot.z + 0.5 } });
    } else {
      el.carry = []; // no composter and no room for one: the clippings go on the pile behind the shed
    }
  }
  if (sh.ending) return go(el, { kind: "home", at: { ...sh.door } });
  if (!sh.ready) return idle(el, 10);
  const t = nextTarget(sh, el);
  if (t) {
    t.by = el;
    el.lastJob = JOB[t.kind];
    return go(el, { kind: t.kind, target: t, at: { x: t.x + 0.5, y: t.y, z: t.z + 0.5 }, look: { x: t.x + 0.5, z: t.z + 0.5 }, near: 0.55 });
  }
  if (sh.elves.some((o) => o !== el && !o.home && o.task?.target)) return idle(el, 20); // a friend is still busy: look around
  if (sh.scans < 2 && sh.found > 0 && sh.tick - sh.scanEnd > 60) {
    rescan(sh); // one more look for anything missed (or snow that just fell)
    return idle(el, 20);
  }
  if (!sh.found && el.strolls > 0) {
    // Nothing to do at all today: have a little look around the yard, then go home.
    el.strolls--;
    const spot = randomYardSpot(sh, el);
    if (spot) return go(el, { kind: "look", at: spot });
  }
  return go(el, { kind: "home", at: { ...sh.door } });
}

function go(el, task) {
  el.task = task;
  el.phase = "go";
  el.best = Infinity;
  el.sinceBest = 0;
  el.stuck = 0;
  setLook(el, task.kind === "home" ? 0 : el.carry.length && (task.kind === "deposit" || task.kind === "build") ? 4 : TOOL[task.kind] ?? 0, "walk");
}

function idle(el, ticks) {
  el.phase = "idle";
  el.waits = ticks;
  setLook(el, 0, "work");
}

function randomYardSpot(sh, el) {
  const r = YARD * 0.6;
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2, d = 2 + Math.random() * r;
    const x = Math.floor(sh.s.x + Math.cos(a) * d), z = Math.floor(sh.s.z + Math.sin(a) * d);
    for (const dy of [0, 1, -1, 2, -2]) {
      if (standable(sh.dim, x, sh.s.y + dy, z)) return { x: x + 0.5, y: sh.s.y + dy, z: z + 0.5 };
    }
  }
  return undefined;
}

const LINES = {
  grass: ["Snip snip! I'm mowing the grass.", "This grass is getting so long!", "Snip, snip, snip!"],
  tall: ["This tall grass is taller than me!", "Snip snip! Mowing the tall grass."],
  snow: ["Brrr! I'm shoveling the snow.", "Scoop, scoop! Clearing the snow.", "So much snow today!"],
  leaves: ["I'm raking up the leaves!", "Crunchy leaves! Into the compost they go."],
  deposit: ["These clippings go in the composter!", "Compost makes bone meal for your flowers!"],
  build: ["I'm building a composter!", "Tap, tap, tap... a new composter!"],
  look: ["Just checking the yard. All tidy!", "Everything looks lovely today!"],
  home: ["Time to go home! See you tomorrow!", "All done! Back to the shed."],
  out: ["Good morning!", "Time to tidy the yard!"],
  idle: ["Hmm, what's next?", "Looking around for things to tidy!"],
};
const lineFor = (el) => pick(LINES[el.task?.kind] ?? LINES[el.phase] ?? LINES.idle);

function stepElf(sh, el) {
  // Saying hi to someone who walked up.
  if (el.pause > 0) {
    el.pause--;
    if (el.friend) {
      try { face(el, el.friend.location); } catch {}
    }
    if (el.pause === 0) {
      el.friend = null;
      setLook(el, el.resumeTool ?? 0, el.resumeAct ?? "walk");
    }
    return;
  }
  if (sh.tick % 10 === 0) {
    const friend = playersNear(sh.s.dim, el.pos, 3).find((p) => !el.greeted.has(p.id));
    if (friend) return sayHi(el, friend);
  }

  if (el.phase === "out") {
    if (moveTo(sh, el, el.goal, 0.2) !== "moving") {
      el.phase = "idle";
      el.waits = 10;
      setLook(el, 0, "wave");
    }
    return;
  }
  if (el.phase === "idle") {
    if (--el.waits <= 0) chooseTask(sh, el);
    return;
  }
  if (el.phase === "go") {
    const t = el.task;
    if (t.target && (t.target.done || !enabled(sh, t.kind))) { // someone else got it, or the job was switched off
      t.target.by = null;
      return chooseTask(sh, el);
    }
    if (t.kind === "home" && !sh.ending && sh.tick % 40 === 0 && sh.ready && nextTarget(sh, el)) return chooseTask(sh, el);
    const res = moveTo(sh, el, t.at, t.near ?? 0.2);
    if (res === "moving") return;
    if (t.kind === "home") return goInside(sh, el);
    el.phase = "work";
    el.left = WORK[t.kind] ?? 20;
    setLook(el, t.kind === "deposit" ? 4 : TOOL[t.kind] ?? 0, "work");
    face(el, t.look);
    return;
  }
  if (el.phase === "work") {
    const t = el.task;
    el.left--;
    const at = t.target ? { x: t.target.x + 0.5, y: t.target.y + 0.15, z: t.target.z + 0.5 } : t.spot ? { x: t.spot.x + 0.5, y: t.spot.y + 0.2, z: t.spot.z + 0.5 } : t.look ? { x: t.look.x, y: el.pos.y + 0.6, z: t.look.z } : el.pos;
    if (el.left % 4 === 0 && t.kind !== "look") bits(sh.dim, at, t.kind);
    if (el.left % 8 === 0 && WORK_SOUND[t.kind]) sound(WORK_SOUND[t.kind], at, 1.3 + Math.random() * 0.4, 0.55);
    if (el.left > 0) return;
    finishTask(sh, el, t);
    chooseTask(sh, el);
  }
}

function sayHi(el, player) {
  el.greeted.add(player.id);
  el.friend = player;
  el.pause = 40;
  el.resumeTool = el.tool;
  el.resumeAct = el.act;
  setLook(el, el.tool, "wave");
  try { player.onScreenDisplay.setActionBar(`§2${el.name}: §fHi ${player.name}! ${lineFor(el)}`); } catch {}
  sound("mob.villager.yes", el.pos, 1.9, 0.6);
}

// ---------- Walking ----------
const angleDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

function wayClear(sh, el, heading, reach) {
  let y = el.pos.y;
  for (const d of [0.45, 0.9]) {
    if (d > reach + 0.3) break;
    const s = standAt(sh.ctx, el.pos.x + Math.cos(heading) * d, el.pos.z + Math.sin(heading) * d, y);
    if (s === undefined) return false;
    y = s;
  }
  return true;
}

function chooseHeading(sh, el, desired, reach) {
  const side = el.side ?? 1;
  for (const off of [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180]) {
    const h = desired + ((off * side) * Math.PI) / 180;
    if (wayClear(sh, el, h, reach)) {
      if (off !== 0 && off !== 180) el.side = Math.sign(off * side);
      return h;
    }
  }
  return null;
}

// One step toward goal. Returns "moving", "arrived", or "hopped" (stuck: popped over by elf magic).
function moveTo(sh, el, goal, near) {
  const dx = goal.x - el.pos.x, dz = goal.z - el.pos.z, d = Math.hypot(dx, dz);
  if (d <= near && Math.abs(goal.y - el.pos.y) < 1.2) {
    if (Math.abs(goal.y - el.pos.y) > 0.01 && d < 0.3) el.pos = { ...el.pos, y: goal.y };
    return "arrived";
  }
  if (d < el.best - 0.4) {
    el.best = d;
    el.sinceBest = 0;
  } else if (++el.sinceBest > STUCK_TICKS * 2) {
    return hop(sh, el, goal);
  }
  const desired = Math.atan2(dz, dx);
  if (sh.tick % 4 === 0 || el.steer === undefined) el.steer = chooseHeading(sh, el, desired, d);
  if (el.steer !== null) {
    const max = (24 * Math.PI) / 180;
    el.heading += Math.max(-max, Math.min(max, angleDiff(el.steer, el.heading)));
  }
  const step = Math.min(SPEED, d);
  const nx = el.pos.x + Math.cos(el.heading) * step, nz = el.pos.z + Math.sin(el.heading) * step;
  const gy = standAt(sh.ctx, nx, nz, el.pos.y);
  if (gy === undefined) {
    el.steer = undefined;
    face(el);
    if (++el.stuck > STUCK_TICKS) return hop(sh, el, goal);
    return "moving";
  }
  el.stuck = 0;
  el.pos = { x: nx, y: el.pos.y + Math.max(-0.34, Math.min(0.34, gy - el.pos.y)), z: nz };
  face(el);
  return "moving";
}

function hop(sh, el, goal) {
  sparkle(sh.dim, el.pos, 6);
  el.pos = { x: goal.x, y: goal.y, z: goal.z };
  el.hops = (el.hops ?? 0) + 1;
  face(el);
  sparkle(sh.dim, el.pos, 6);
  sound("random.pop", el.pos, 1.8, 0.7);
  return "hopped";
}

// ---------- Doing the work ----------
function finishTask(sh, el, t) {
  if (t.kind === "look") return;
  if (t.kind === "deposit") return deposit(sh, el);
  if (t.kind === "build") return build(sh, el, t);
  const target = t.target;
  target.by = null;
  const group = JOB[target.kind];
  // Mowing is one block at a time (both halves of tall grass).
  if (group === "mow") return tidy(sh, el, target);
  // Snow and leaves: a sweep of the spot itself plus the same kind of mess right around it.
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        const o = sh.targets.get(`${target.x + dx},${target.y + dy},${target.z + dz}`);
        if (!o || o.done || (o.by && o.by !== el) || JOB[o.kind] !== group) continue;
        tidy(sh, el, o);
      }
    }
  }
}

function tidy(sh, el, t) {
  t.done = true;
  t.by = null;
  const b = blockAt(sh.dim, t.x, t.y, t.z);
  if (!b || kindOf(b) !== t.kind) return; // changed since we looked
  const at = { x: t.x + 0.5, y: t.y + 0.3, z: t.z + 0.5 };
  if (t.kind === "tall") {
    const top = blockAt(sh.dim, t.x, t.y + 1, t.z);
    if (top && top.typeId === b.typeId) setAir(top); // top half first, so nothing pops off
  }
  let layers = 1;
  if (t.kind === "snow") layers = Math.max(1, Math.min(8, (Number(state(b, "height")) || 0) + 1));
  if (!setAir(b)) return;
  bits(sh.dim, at, t.kind);
  bits(sh.dim, at, t.kind);
  if (t.kind === "snow") {
    sh.totals.snow++;
    sh.totals.snowballs += layers;
  } else {
    sh.totals[t.kind === "tall" ? "grass" : t.kind]++;
    el.carry.push(COMPOST[t.kind]);
  }
}

// Clippings into the composter. A full composter (bone meal ready) gets emptied into the chest by the shed, if there is one.
function deposit(sh, el) {
  const c = liveComposter(sh);
  const items = el.carry;
  el.carry = [];
  if (!c || !items.length) return;
  const b = blockAt(sh.dim, c.x, c.y, c.z);
  if (!b) return;
  const at = { x: c.x + 0.5, y: c.y + 1, z: c.z + 0.5 };
  let level = Number(state(b, "composter_fill_level")) || 0;
  const chest = findChest(sh);
  let added = 0;
  for (const chance of items) {
    if (level >= 8) {
      if (!chest) break;
      sh.totals.boneMeal++;
      level = 0;
      sound("block.composter.empty", at);
    }
    if (Math.random() < chance) {
      level++;
      added++;
      if (level === 7) {
        level = 8;
        sound("block.composter.ready", at);
      }
    }
  }
  sh.totals.compost += added;
  try {
    b.setPermutation(b.permutation.withState("composter_fill_level", level));
  } catch {}
  sound(added ? "block.composter.fill_success" : "block.composter.fill", at);
  for (let i = 0; i < 4; i++) bits(sh.dim, at, "deposit");
}

function build(sh, el, t) {
  sh.building = null;
  const { spot } = t;
  const here = typeAt(sh.dim, spot.x, spot.y, spot.z);
  if (!here || !isClear(here)) return;
  try {
    blockAt(sh.dim, spot.x, spot.y, spot.z).setPermutation(BlockPermutation.resolve("minecraft:composter"));
  } catch {
    return;
  }
  sh.composter = { ...spot };
  sh.cache.clear();
  updateShed(sh.k, (r) => { r.built = true; });
  sh.s.built = true;
  sh.builtBy = el.name;
  sparkle(sh.dim, { x: spot.x + 0.5, y: spot.y + 0.3, z: spot.z + 0.5 }, 12);
  sound("random.levelup", spot, 1.6, 0.6);
  tellNear(sh.s.dim, sh.s, `§2${el.name}§f built a composter next to the shed!`);
  const t0 = sh.targets.get(`${spot.x},${spot.y},${spot.z}`);
  if (t0) t0.done = true;
}

function findChest(sh) {
  const s = sh.s;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        const b = blockAt(sh.dim, s.x + dx, s.y + dy, s.z + dz);
        if (!b || !/(^minecraft:chest|trapped_chest|barrel)$/.test(b.typeId)) continue;
        try {
          const c = b.getComponent("minecraft:inventory")?.container;
          if (c) return { block: b, container: c };
        } catch {}
      }
    }
  }
  return undefined;
}

function goInside(sh, el) {
  el.home = true;
  if (el.task?.target) el.task.target.by = null;
  sparkle(sh.dim, el.pos, 4);
  sound("random.door_close", el.pos, 1.4, 0.6);
  try { el.e.remove(); } catch {}
}

// ---------- End of the day ----------
function putInChest(sh) {
  const t = sh.totals;
  const snowballs = Math.min(64, t.snowballs);
  const gifts = [];
  if (snowballs) gifts.push(["minecraft:snowball", snowballs, 16]);
  if (t.boneMeal) gifts.push(["minecraft:bone_meal", t.boneMeal, 64]);
  if (!gifts.length) return "";
  const chest = findChest(sh);
  if (!chest) return "";
  for (const [id, n, stack] of gifts) {
    for (let left = n; left > 0; left -= stack) {
      try {
        const extra = chest.container.addItem(new ItemStack(id, Math.min(stack, left)));
        if (extra) sh.dim.spawnItem(extra, { x: chest.block.location.x + 0.5, y: chest.block.location.y + 1.2, z: chest.block.location.z + 0.5 });
      } catch {}
    }
  }
  const words = [];
  if (snowballs) words.push(`${snowballs} snowball${snowballs === 1 ? "" : "s"}`);
  if (t.boneMeal) words.push(`${t.boneMeal} bone meal`);
  return ` They left ${both(words)} in the chest by the shed.`;
}

function summary(sh) {
  const t = sh.totals, names = elfNames(sh.s);
  const did = [];
  if (t.grass) did.push(`mowed ${t.grass} grass`);
  if (t.snow) did.push(`shoveled ${t.snow} snow`);
  if (t.leaves) did.push(`raked ${t.leaves} leaves`);
  if (!did.length) return `§2${names}§f looked all over the yard: everything's tidy today!`;
  let msg = `§2The groundskeepers are done for today! §f${names} ${both(did)}.`;
  if (t.compost) msg += ` The composter got ${t.compost} level${t.compost === 1 ? "" : "s"} fuller.`;
  return msg;
}

function finishShift(sh) {
  if (shifts.get(sh.k) !== sh) return;
  system.clearRun(sh.run);
  shifts.delete(sh.k);
  setOpen(sh.s, false);
  const chestNote = putInChest(sh);
  let readyNote = "";
  const c = liveComposter(sh);
  if (c && !findChest(sh)) {
    const b = blockAt(sh.dim, c.x, c.y, c.z);
    if (Number(state(b, "composter_fill_level")) >= 8) readyNote = " The composter is full of bone meal for you!";
  }
  tellNear(sh.s.dim, sh.s, summary(sh) + chestNote + readyNote);
  sound("random.door_close", sh.door, 1.3, 0.8);
}

// The shift stops early: the shed was broken, or everyone walked away. Elves pop home by magic.
function endShift(sh, why) {
  if (shifts.get(sh.k) !== sh) return;
  system.clearRun(sh.run);
  shifts.delete(sh.k);
  for (const el of sh.elves) {
    if (el.home) continue;
    el.home = true;
    if (alive(el.e)) sparkle(sh.dim, el.pos, 8);
    try { el.e.remove(); } catch {}
  }
  if (why !== "gone") {
    putInChest(sh);
    setOpen(sh.s, false);
  }
}

// Tidy up elves left behind if the world was closed in the middle of a shift.
system.runInterval(() => {
  const ids = new Set();
  for (const sh of shifts.values()) for (const el of sh.elves) ids.add(el.e.id);
  for (const d of DIMS) {
    try {
      for (const e of world.getDimension(d).getEntities({ type: ELF })) if (!ids.has(e.id)) e.remove();
    } catch {}
  }
}, 200);

// ---------- Tapping an elf ----------
try {
  world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    if (event.target?.typeId !== ELF) return;
    event.cancel = true;
    const { target, player } = event;
    system.run(() => {
      for (const sh of shifts.values()) {
        const el = sh.elves.find((x) => x.e === target || x.e.id === target.id);
        if (el && !el.home) {
          el.greeted.delete(player.id);
          sayHi(el, player);
          try { player.sendMessage(`§2${el.name}: §f${lineFor(el)}`); } catch {}
          return;
        }
      }
    });
  });
} catch {}

// ---------- Tapping the shed: the menu ----------
const menuOpen = new Set();
try {
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (event.block?.typeId !== SHED) return;
    event.cancel = true;
    if (event.isFirstEvent === false) return;
    const { player } = event;
    const k = keyOf({ dim: event.block.dimension.id, ...event.block.location });
    system.run(() => shedMenu(player, k));
  });
} catch {}

const onOff = (v) => (v !== false ? "§2ON" : "§cOFF");

async function shedMenu(player, k) {
  if (menuOpen.has(player.name)) return;
  menuOpen.add(player.name);
  try {
    for (let guard = 0; guard < 20; guard++) {
      const s = sheds().find((r) => keyOf(r) === k);
      if (!s) {
        player.sendMessage("§eThis shed is empty. Break it and put it back up so new elves can move in.");
        return;
      }
      const out = shifts.has(k);
      const t = world.getTimeOfDay();
      const status = out ? "They're out in the yard working right now!"
        : isNight() ? "They're asleep. Zzz... They'll come out in the morning."
        : s.lastDay === world.getDay() ? "They already tidied up today. See you tomorrow morning!"
        : t < SHIFT_START ? "They'll come out soon, when the sun is up."
        : "They'll come out when someone's nearby.";
      const res = await new ActionFormData()
        .title("Elf Shed")
        .body(`§2${elfNames(s)}§f live here. Every morning they come out and tidy the yard, ${YARD} blocks all around the shed.\n\n${status}\n\n§7Put a chest next to the shed and they'll leave snowballs and bone meal in it.`)
        .button(out ? "Send the elves home" : "Call the elves out now")
        .button(`Mow grass: ${onOff(s.jobs.mow)}`)
        .button(`Shovel snow: ${onOff(s.jobs.snow)}`)
        .button(`Rake leaves: ${onOff(s.jobs.leaves)}`)
        .button(`Compost clippings: ${onOff(s.jobs.compost)}`)
        .button("Done")
        .show(player);
      if (res.canceled || res.selection === undefined || res.selection === 5) return;
      const sel = res.selection;
      if (sel === 0) {
        if (out) {
          const sh = shifts.get(k);
          sh.ending = true;
          player.sendMessage(`§2${elfNames(s)}§f are heading home.`);
        } else if (isNight()) {
          player.sendMessage(`§eShh! ${elfNames(s)} are asleep. They'll come out in the morning.`);
        } else if (startShift(s, player)) {
          player.sendMessage(`§2${elfNames(s)}§f grabbed their tools!`);
        }
        return;
      }
      const job = ["", "mow", "snow", "leaves", "compost"][sel];
      if (!job) return;
      updateShed(k, (r) => { r.jobs[job] = r.jobs[job] === false; });
      const sh = shifts.get(k);
      const fresh = sheds().find((r) => keyOf(r) === k);
      if (sh && fresh) {
        sh.s.jobs = fresh.jobs; // a running shift picks up the change right away
      }
    }
  } catch {
  } finally {
    menuOpen.delete(player.name);
  }
}

// /scriptevent grounds:shift  (cheats on) sends the nearest shed's elves out right away.
try {
  system.afterEvents.scriptEventReceive.subscribe(({ id, sourceEntity }) => {
    if (id !== "grounds:shift") return;
    const player = sourceEntity?.typeId === "minecraft:player" ? sourceEntity : world.getAllPlayers()[0];
    if (!player) return;
    const mine = sheds().filter((s) => s.dim === player.dimension.id && flat(s, player.location) < 64)
      .sort((a, b) => flat(a, player.location) - flat(b, player.location));
    if (!mine.length) {
      player.sendMessage("§eThere's no Elf Shed near you.");
      return;
    }
    if (shifts.has(keyOf(mine[0]))) {
      player.sendMessage("§eThe elves are already out working!");
      return;
    }
    if (!startShift(mine[0], player)) player.sendMessage("§cThe elves couldn't come out. Check the Content Log for why.");
  });
} catch {}
