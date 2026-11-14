// Kingdom Quest: the story of the Princess Kingdom world. Find Graham, the princess's lost dog!
//
// Quest 1, "The Hen Pen": the princess sits crying on her throne. Tap her and she tells you (in pages you turn
// yourself) that Graham chased her hens all over and then ran away. Build a pen round the hen house by the road
// (fences and seeds are in the chest there), lead at least 3 hens in (they follow seeds), and once the pen is done
// the hens in it lay eggs. She needs 5 eggs for each player (10 for two), and it doesn't matter who brings them;
// when she has them all, the gate in the magic fence round the Ice Palace opens, she cheers up, and Graham's paw prints lead the way.
// Each castle after the first has a magic fence; its gate opens when the quest before it is done.
//
// Grown-ups: /scriptevent kq:reset starts the story again; /scriptevent kq:unlock opens the gate now.
import { world, system, ItemStack, MolangVariableMap } from "@minecraft/server";
import { KINGDOM } from "./kingdom_data.js";

const EGGS_EACH = 5;               // eggs she needs for each player playing (anyone can bring them)
const HENS_NEEDED = 3;             // hens in the pen before it counts
const PEN_REACH = 14;              // a pen can reach this far from the hen house (any further and it isn't closed)
const LAY_EVERY = 12;              // seconds between eggs from the pen (much quicker than wild hens)
const LAST_QUEST = 1;              // quests written so far: gates for castles past this open with the last one
const NEAR = 56;                   // only spawn things when a player is this close (the ground there is loaded)
const G = {                        // little pictures from the resource pack's glyph sheet (\uE100 is the first)
  egg: "\uE100", noEgg: "\uE101", graham: "\uE102", sad: "\uE103", happy: "\uE104", heart: "\uE105",
  paw: "\uE106", ice: "\uE107", bed: "\uE108", moon: "\uE109", inn: "\uE10A", hen: "\uE10B", fence: "\uE10C",
  seeds: "\uE10D", log: "\uE10E", planks: "\uE10F", table: "\uE110", stick: "\uE111", gate: "\uE112",
  axe: "\uE113", book: "\uE114",
};
// ---------------------------------------------------------------- saved state
function stage() { return world.getDynamicProperty("kq:stage") ?? 0; }              // 0 hen quest, 1 Ice Palace open
function setStage(s) { world.setDynamicProperty("kq:stage", s); }
function penDone() { return world.getDynamicProperty("kq:pen") === true; }
function met(p) { return p.getDynamicProperty("kq:met") === true; }
const eggsGiven = () => world.getDynamicProperty("kq:eggs_given") ?? 0;
const eggsNeeded = () => EGGS_EACH * Math.min(4, Math.max(1, players().length));   // (the talking pages go up to 4 players)

const overworld = () => world.getDimension("overworld");
const center = (a) => ({ x: a[0] + 0.5, y: a[1], z: a[2] + 0.5 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const players = () => world.getAllPlayers();
const nearAnyPlayer = (loc, r = NEAR) => players().some((p) => p.dimension.id === "minecraft:overworld" && flat(p.location, loc) <= r);

function safe(fn) { try { return fn(); } catch { return undefined; } }

// ---------------------------------------------------------------- talking
// Characters talk in Minecraft's own talking window (NPC dialogue), with their picture beside the words. The pages
// are scenes in dialogue/kingdom.diag.json (written by tools/make_kingdom_quest.py); Next / Back buttons turn the
// pages by themselves, and buttons that do something come back here as /scriptevent kq:act <what>.
function say(npc, p, scene) {
  if (!npc || !p) return false;
  const who = `@a[name="${p.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
  const cmd = `dialogue open @s ${who} ${scene}`;
  return safe(() => { if (npc.runCommand) npc.runCommand(cmd); else npc.runCommandAsync(cmd); return true; }) ?? false;
}
const nearest = (p, type, r = 16) => (safe(() => p.dimension.getEntities({ type, location: p.location, maxDistance: r, closest: 1 })) ?? [])[0];

// The How-To Book talks too: a little book (out of sight, under your feet) holds its pages while you read.
function bookFor(p) {
  let b = (safe(() => p.dimension.getEntities({ type: "kq:book", location: p.location, maxDistance: 10 })) ?? [])
    .find((e) => e.getDynamicProperty("kq:owner") === p.id);
  if (!b) {
    b = safe(() => p.dimension.spawnEntity("kq:book", { x: p.location.x, y: p.location.y - 2, z: p.location.z }));
    if (b) safe(() => b.setDynamicProperty("kq:owner", p.id));
  }
  if (b) safe(() => b.setDynamicProperty("kq:used", system.currentTick));
  return b;
}
function bookSays(p, scene, delay = 2) {
  const b = bookFor(p);
  if (b) system.runTimeout(() => say(b, p, scene), delay);
}
function tidyBooks() {
  for (const b of safe(() => overworld().getEntities({ type: "kq:book" })) ?? []) {
    const owner = players().find((p) => p.id === b.getDynamicProperty("kq:owner"));
    const used = b.getDynamicProperty("kq:used") ?? 0;
    if (!owner || flat(owner.location, b.location) > 12 || used < system.currentTick - 20 * 600) safe(() => b.remove());
  }
}

// ---------------------------------------------------------------- the How-To Book: a step-by-step lesson
// The steps for making a pen from scratch. Each is a page in the book; the book opens at the step you're on, and
// a short hint shows when you reach a new one (worked out from what you're carrying).
const STEPS = [                    // the hint for each step (the pages are scenes kq_b_step_0 ... 9)
  { pic: G.axe, hint: "Get an axe from the chest!" },
  { pic: G.log, hint: "Chop the trees by the hen house!" },
  { pic: G.planks, hint: "Open your bag. Make planks!" },
  { pic: G.table, hint: "Make a crafting table!" },
  { pic: G.table, hint: "Put your crafting table down!" },
  { pic: G.stick, hint: "Make some sticks!" },
  { pic: G.fence, hint: "Make fences at the crafting table!" },
  { pic: G.gate, hint: "Make a gate too!" },
  { pic: G.fence, hint: "Build a fence all round the hen house!" },
  { pic: G.hen, hint: "Lead 3 hens into your pen!" },
];
const MORE_WOOD = { pic: G.axe, hint: "A gap? Chop more wood. Make more fences!" };
const BUILD = 8;

function carrying(p) {
  const c = { axe: 0, logs: 0, planks: 0, table: 0, sticks: 0, fences: 0, gates: 0, guide: 0 };
  const inv = safe(() => p.getComponent("minecraft:inventory").container);
  if (!inv) return c;
  for (let s = 0; s < inv.size; s++) {
    const it = inv.getItem(s);
    if (!it) continue;
    const id = it.typeId, n = it.amount;
    if (id.endsWith("_axe")) c.axe += n;
    else if (/_(log|wood|stem)$/.test(id)) c.logs += n;
    else if (id.endsWith("_planks")) c.planks += n;
    else if (id === "minecraft:crafting_table") c.table += n;
    else if (id === "minecraft:stick") c.sticks += n;
    else if (id.includes("fence_gate")) c.gates += n;
    else if (id.includes("fence")) c.fences += n;
    else if (id === "kq:guide") c.guide += n;
  }
  return c;
}

// which step you're on (index into STEPS, or -1 for "a gap? more wood")
function currentStep(p) {
  const c = carrying(p);
  if (c.table > 0) p.setDynamicProperty("kq:had_table", true);
  const furthest = p.getDynamicProperty("kq:step") ?? 0;
  let s;
  if (penCheck().closed) s = 9;
  else if (c.fences > 0 && c.gates > 0) s = BUILD;
  else if (c.fences > 0) s = c.fences >= 12 || furthest >= BUILD ? 7 : 6;
  else if (c.gates > 0 || c.sticks > 0) s = 6;
  else if (c.table > 0) s = 4;
  else if (p.getDynamicProperty("kq:had_table") === true && furthest >= 4) s = c.planks >= 2 ? 5 : 1;
  else if (c.planks >= 4) s = 3;
  else if (c.logs > 0) s = 2;
  else if (c.axe > 0) s = 1;
  else s = furthest >= 1 ? 1 : 0;
  if (furthest >= BUILD && s < BUILD && c.fences === 0 && c.gates === 0) s = -1;
  if (s > furthest) p.setDynamicProperty("kq:step", s);
  return s;
}

function openGuide(p) {
  if (stage() >= 1) return bookSays(p, "kq_b_paws");
  if (!met(p)) return bookSays(p, "kq_b_find");
  if (!penDone()) { const s = currentStep(p); return bookSays(p, s < 0 ? "kq_b_more" : "kq_b_step_" + s); }
  bookSays(p, "kq_b_eggs_1");
}

function giveGuide(p) {
  if (carrying(p).guide > 0) return false;
  safe(() => p.getComponent("minecraft:inventory").container.addItem(new ItemStack("kq:guide", 1)));
  return true;
}

// a short reminder at the bottom of the screen when you reach a new step (and now and then near the hen house)
const lastHint = new Map();
function lessonHint(p) {
  if (!met(p) || stage() >= 1) return;
  const near = flat(p.location, center(KINGDOM.farm.coop)) < 80;
  let key, text;
  if (!penDone()) {
    const s = currentStep(p);
    const st = s < 0 ? MORE_WOOD : STEPS[s];
    key = "s" + s; text = `${st.pic} ${st.hint}`;
  } else if (eggCount(p) > 0) {
    key = "eggs"; text = `${G.egg} Take the eggs to the princess!`;
  } else {
    key = "pick"; text = `${G.egg} Pick up the eggs in the pen!`;
  }
  const last = lastHint.get(p.id);
  const changed = !last || last.key !== key;
  if (!changed && (!near || last.tick > system.currentTick - 400)) return;
  lastHint.set(p.id, { key, tick: system.currentTick });
  safe(() => p.onScreenDisplay.setActionBar("§l" + text));
  if (changed && last) safe(() => p.playSound("random.orb", { pitch: 1.5 }));
}

// ---------------------------------------------------------------- talking to the princess
function talkToPrincess(p, princess) {
  if (stage() >= 1) return say(princess, p, "kq_p_happy_1");
  if (!met(p)) return say(princess, p, "kq_p_intro_1");
  if (giveGuide(p)) return say(princess, p, "kq_p_newbook");
  if (!penDone()) {
    const pen = penCheck(true);
    if (finishPen(pen)) return;
    return say(princess, p, pen.closed ? "kq_p_pen_h" + Math.min(2, pen.hens.length) : "kq_p_pen_none");
  }
  if (eggsGiven() >= eggsNeeded()) return unlock(p);            // (someone left, so she needs fewer)
  say(princess, p, `kq_p_${eggCount(p) > 0 ? "handin" : "eggs"}_${eggsGiven()}_${eggsNeeded()}`);
}

// buttons that do something
function act(p, what) {
  const princess = nearest(p, "kq:princess");
  if (what === "intro6") say(princess, p, "kq_p_intro_6_" + eggsNeeded());
  else if (what === "yes") {
    p.setDynamicProperty("kq:met", true);
    giveGuide(p);
    safe(() => p.playSound("random.orb", { pitch: 1.2 }));
    say(princess, p, "kq_p_thanks_1");
  } else if (what === "guide") openGuide(p);
  else if (what === "give") handIn(p, princess);
}

// anyone can bring eggs, as many as they have: she keeps count until she has enough for everyone
function handIn(p, princess) {
  const have = eggCount(p), left = eggsNeeded() - eggsGiven();
  if (stage() >= 1 || have < 1 || !penDone()) return;
  const give = Math.min(have, Math.max(0, left));
  takeEggs(p, give);
  world.setDynamicProperty("kq:eggs_given", eggsGiven() + give);
  safe(() => p.playSound("random.orb", { pitch: 1.3 }));
  safe(() => overworld().spawnParticle("kq:sparkle", { ...center(KINGDOM.princess), y: KINGDOM.princess[1] + 1.2 }));
  if (eggsGiven() >= eggsNeeded()) return unlock(p);
  say(princess, p, `kq_p_more_${eggsGiven()}_${eggsNeeded()}`);
}

function enoughEggs() { return players().length > 0 && eggsGiven() >= eggsNeeded(); }

// ---------------------------------------------------------------- the inns
// One inn on each road. The inn keeper says where to sleep, and gives a clue about Graham.
function talkToClerk(p, clerk) {
  const i = clerk.getDynamicProperty("kq:inn");
  if (KINGDOM.inns[i]) say(clerk, p, `kq_i${i}_1`);
}

// ---------------------------------------------------------------- eggs
function eggCount(p) {
  const inv = safe(() => p.getComponent("minecraft:inventory").container);
  let n = 0;
  if (inv) for (let s = 0; s < inv.size; s++) { const it = inv.getItem(s); if (it?.typeId === "minecraft:egg") n += it.amount; }
  return n;
}

function takeEggs(p, n) {
  const inv = safe(() => p.getComponent("minecraft:inventory").container);
  if (!inv) return;
  for (let s = 0; s < inv.size && n > 0; s++) {
    const it = inv.getItem(s);
    if (it?.typeId !== "minecraft:egg") continue;
    if (it.amount <= n) { n -= it.amount; inv.setItem(s, undefined); }
    else { it.amount -= n; inv.setItem(s, it); n = 0; }
  }
}

// ---------------------------------------------------------------- the hen pen
// The pen is closed when you can't walk (as a hen) from the hen house out past PEN_REACH: fences, walls, glass
// panes, shut gates and anything two blocks high stop a hen. Built by players, any shape, round the hen house.
const SOFT = /^minecraft:(short_grass|tall_grass|grass|fern|large_fern|.*flower.*|.*tulip|oxeye_daisy|poppy|dandelion|allium|azure_bluet|cornflower|lily_of_the_valley|pink_petals|.*carpet|torch|.*sapling|deadbush|snow_layer|wheat|.*button|.*pressure_plate|rail|.*sign|vine|lever|peony|lilac|rose_bush|sunflower)$/;
function solid(b) { return b && !b.isAir && !b.isLiquid && !SOFT.test(b.typeId); }
function stopsHens(dim, x, y, z) {
  const b = dim.getBlock({ x, y, z });
  if (!b) return undefined;                                       // not loaded
  const id = b.typeId;
  if (id.includes("fence_gate")) return safe(() => b.permutation.getState("open_bit")) !== true;
  if (id.includes("fence") || id.includes("_wall") || id.includes("glass_pane") || id.includes("iron_bars")) return true;
  return solid(b) && solid(dim.getBlock({ x, y: y + 1, z }));
}

let penCache = { at: -999, closed: false, cells: new Set(), hens: [] };
function penCheck(force) {
  if (!force && penCache.at > system.currentTick - 40) return penCache;
  const dim = overworld();
  const [cx, y, cz] = KINGDOM.farm.coop;
  const cells = new Set([`${cx},${cz}`]);
  const todo = [[cx, cz]];
  let closed = true, loaded = true;
  while (todo.length) {
    const [x, z] = todo.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, k = `${nx},${nz}`;
      if (cells.has(k)) continue;
      const stop = safe(() => stopsHens(dim, nx, y, nz));
      if (stop === undefined) { closed = false; loaded = false; break; }
      if (stop) continue;
      if (Math.max(Math.abs(nx - cx), Math.abs(nz - cz)) > PEN_REACH || cells.size > 900) { closed = false; break; }
      cells.add(k); todo.push([nx, nz]);
    }
    if (!closed) break;
  }
  let hens = [];
  if (closed) {
    hens = (safe(() => dim.getEntities({ type: "minecraft:chicken", location: { x: cx + 0.5, y, z: cz + 0.5 }, maxDistance: PEN_REACH + 4 })) ?? [])
      .filter((h) => cells.has(`${Math.floor(h.location.x)},${Math.floor(h.location.z)}`) && Math.abs(h.location.y - y) < 2.5);
  }
  if (!loaded) {                                   // too far away to see: what it was like last time someone was there
    let seen;
    try { seen = JSON.parse(world.getDynamicProperty("kq:pen_seen") ?? "{}"); } catch { seen = {}; }
    return { at: system.currentTick, closed: !!seen.closed, cells, hens: new Array(seen.hens ?? 0).fill(null), far: true };
  }
  penCache = { at: system.currentTick, closed, cells, hens };
  world.setDynamicProperty("kq:pen_seen", JSON.stringify({ closed, hens: hens.length }));
  return penCache;
}

function penUpkeep(t) {
  const dim = overworld();
  const coop = center(KINGDOM.farm.coop);
  // hens: Graham scattered them round the meadows (each spot gets one, once); more if too many wander off
  let spawned;
  try { spawned = JSON.parse(world.getDynamicProperty("kq:hens") ?? "[]"); } catch { spawned = []; }
  let changed = false;
  KINGDOM.farm.hens.forEach((h, i) => {
    if (spawned.includes(i) || !nearAnyPlayer(center(h), 48)) return;
    if (safe(() => dim.spawnEntity("minecraft:chicken", center(h)))) { spawned.push(i); changed = true; }
  });
  if (changed) world.setDynamicProperty("kq:hens", JSON.stringify(spawned));
  if (!nearAnyPlayer(coop, 64)) return;
  if (!penDone() && t % 30 === 0 && spawned.length >= KINGDOM.farm.hens.length) {
    const around = (safe(() => dim.getEntities({ type: "minecraft:chicken", location: coop, maxDistance: 90 })) ?? []).length;
    if (around < 6) {
      const spots = KINGDOM.farm.hens.filter((h) => nearAnyPlayer(center(h), 48));
      if (spots.length) safe(() => dim.spawnEntity("minecraft:chicken", center(spots[t % spots.length])));
    }
  }
  if (t % 3 !== 0) return;
  const pen = penCheck(true);
  finishPen(pen);
  // hens in a finished pen lay eggs quickly
  if (penDone() && pen.closed && pen.hens.length && stage() < 1 && t % LAY_EVERY < 3) {
    const loose = (safe(() => dim.getEntities({ type: "minecraft:item", location: coop, maxDistance: PEN_REACH + 2 })) ?? [])
      .filter((e) => safe(() => e.getComponent("minecraft:item").itemStack.typeId) === "minecraft:egg").length;
    if (loose < 8) {
      const h = pen.hens[Math.floor(Math.random() * pen.hens.length)];
      safe(() => dim.spawnItem(new ItemStack("minecraft:egg", 1), { x: h.location.x, y: h.location.y + 0.3, z: h.location.z }));
      safe(() => dim.playSound("mob.chicken.plop", h.location));
    }
  }
}

// three hens in a closed pen: it's done (for good), and everyone hears about it
function finishPen(pen) {
  if (penDone() || pen.far || !pen.closed || pen.hens.length < HENS_NEEDED) return false;
  world.setDynamicProperty("kq:pen", true);
  const coop = center(KINGDOM.farm.coop);
  for (const p of players()) {
    safe(() => p.playSound("random.levelup"));
    if (flat(p.location, coop) < 40 || met(p)) bookSays(p, "kq_b_pen_done", 10);
  }
  for (const h of pen.hens) safe(() => overworld().spawnParticle("minecraft:heart_particle", { x: h.location.x, y: h.location.y + 0.8, z: h.location.z }));
  return true;
}


// ---------------------------------------------------------------- opening the road
function unlock(by) {
  if (stage() >= 1) return;
  setStage(1);
  const dim = overworld();
  const at = center(KINGDOM.princess);
  for (let k = 0; k < 8; k++) safe(() => dim.spawnParticle("minecraft:heart_particle",
    { x: at.x + Math.sin(k) * 1.2, y: at.y + 1 + (k % 3) * 0.4, z: at.z + Math.cos(k) * 1.2 }));
  for (const p of players()) {
    safe(() => p.playSound("random.levelup"));
    safe(() => p.playSound("firework.launch"));
    if (p.id === by?.id) system.runTimeout(() => say(nearest(p, "kq:princess"), p, "kq_p_happy_1"), 6);
    else bookSays(p, "kq_b_paws", 4);
  }
  clearBarriers();
}

// the gates in the magic fences
const ringOpen = (r) => stage() >= Math.min(r.opens, LAST_QUEST);

// open gates come down when their ground is loaded (upkeep keeps trying until each one is gone)
function clearBarriers() {
  const dim = overworld();
  let done;
  try { done = JSON.parse(world.getDynamicProperty("kq:barriers_gone") ?? "[]"); } catch { done = []; }
  let left = 0;
  for (const ring of KINGDOM.rings) {
    if (!ringOpen(ring) || done.includes(ring.name)) continue;
    let all = true;
    for (const c of ring.gate) {
      const b = safe(() => dim.getBlock({ x: c[0], y: c[1], z: c[2] }));
      if (!b) { all = false; continue; }
      if (b.typeId === "kq:magic_barrier") {
        safe(() => b.setType("minecraft:air"));
        if (Math.random() < 0.15) safe(() => dim.spawnParticle("kq:sparkle", center(c)));
        if (safe(() => dim.getBlock({ x: c[0], y: c[1], z: c[2] }).typeId) === "kq:magic_barrier") all = false;
      }
    }
    if (all) done.push(ring.name); else left++;
  }
  world.setDynamicProperty("kq:barriers_gone", JSON.stringify(done));
  world.setDynamicProperty("kq:barriers_left", left);
  return left;
}

function restoreBarriers() {
  const dim = overworld();
  for (const ring of KINGDOM.rings) {
    if (ringOpen(ring)) continue;
    for (const c of ring.gate) {
      const b = safe(() => dim.getBlock({ x: c[0], y: c[1], z: c[2] }));
      if (b && b.typeId === "minecraft:air") safe(() => b.setType("kq:magic_barrier"));
    }
  }
}

// ---------------------------------------------------------------- keeping the story in place
function upkeep(t) {
  const dim = overworld();
  const seat = center(KINGDOM.princess);
  const s = stage();
  // the princess, on her throne
  if (nearAnyPlayer(seat)) {
    let ps = safe(() => dim.getEntities({ type: "kq:princess", location: seat, maxDistance: 40 })) ?? [];
    for (const extra of ps.slice(1)) safe(() => extra.remove());
    let princess = ps[0];
    if (!princess) princess = safe(() => dim.spawnEntity("kq:princess", seat));
    if (princess) {
      if (dist(princess.location, seat) > 0.3) safe(() => princess.teleport(seat, { rotation: { x: 0, y: KINGDOM.princessFacing } }));
      safe(() => princess.setRotation({ x: 0, y: KINGDOM.princessFacing }));
      if (safe(() => princess.getProperty("kq:happy")) !== (s >= 1)) safe(() => princess.setProperty("kq:happy", s >= 1));
      if (s < 1 && t % 2 === 0) safe(() => dim.spawnParticle("kq:tear", { x: seat.x + (t % 4 ? 0.15 : -0.15), y: seat.y + 1.15, z: seat.z + 0.25 }));
      if (s >= 1 && t % 3 === 0) safe(() => dim.spawnParticle("minecraft:heart_particle", { x: seat.x, y: seat.y + 1.9, z: seat.z }));
    }
  }
  // the inn keepers, behind their desks
  KINGDOM.inns.forEach((inn, i) => {
    const at = center(inn.pos);
    if (!nearAnyPlayer(at)) return;
    const here = safe(() => dim.getEntities({ type: "kq:clerk", location: at, maxDistance: 6 })) ?? [];
    for (const extra of here.slice(1)) safe(() => extra.remove());
    let c = here[0];
    if (!c) {
      c = safe(() => dim.spawnEntity("kq:clerk", at));
      if (c) { safe(() => c.setDynamicProperty("kq:inn", i)); safe(() => c.setProperty("kq:look", i)); }
    }
    if (c) {
      if (dist(c.location, at) > 0.3) safe(() => c.teleport(at));
      safe(() => c.setRotation({ x: 0, y: inn.facing }));
      if (c.getDynamicProperty("kq:inn") !== i) { safe(() => c.setDynamicProperty("kq:inn", i)); safe(() => c.setProperty("kq:look", i)); }
    }
  });
  // the hen pen, while the quest is on
  if (s < 1) {
    safe(() => penUpkeep(t));
    if (t % 15 === 0) restoreBarriers();                       // (after a reset, as their ground loads)
  } else if ((world.getDynamicProperty("kq:barriers_left") ?? 1) > 0 || t % 15 === 0) {
    clearBarriers();
  }
  // signs for each player
  for (const p of players()) {
    if (p.dimension.id !== "minecraft:overworld") continue;
    if (!met(p) && s < 1) trailNear(p, KINGDOM.toPrincess, t, "kq:sparkle", 24);
    if (s >= 1) trailNear(p, KINGDOM.trail, t, "kq:pawprint", 28);
    if (t % 2 === 0) barrierNudge(p);
    if (t % 2 === 1) lessonHint(p);
  }
}

// a moving line of sparkles / paw prints along a path, near the player, pointing the way
function trailNear(p, path, t, particle, r) {
  const dim = overworld();
  for (let i = 0; i < path.length; i++) {
    if ((i + 4 - (t % 4)) % 4 !== 0) continue;
    const c = path[i];
    if (Math.abs(c[0] + 0.5 - p.location.x) > r || Math.abs(c[2] + 0.5 - p.location.z) > r) continue;
    if (flat(p.location, center(c)) > r) continue;
    let vars;
    if (c.length > 3) { vars = new MolangVariableMap(); safe(() => vars.setFloat("variable.dir", c[3])); }   // which way the paw points
    safe(() => dim.spawnParticle(particle, { x: c[0] + 0.5, y: c[1] + 0.05, z: c[2] + 0.5 }, vars));
  }
}

const nudged = new Map();
function barrierNudge(p) {
  if ((nudged.get(p.id) ?? -999) > system.currentTick - 200) return;
  for (const ring of KINGDOM.rings) {
    if (ringOpen(ring)) continue;
    const d = Math.hypot(p.location.x - ring.center[0] - 0.5, p.location.z - ring.center[1] - 0.5);
    if (Math.abs(d - ring.r) < 3) {
      nudged.set(p.id, system.currentTick);
      safe(() => p.playSound("note.chime"));
      safe(() => p.onScreenDisplay.setActionBar("§l§d" + G.sad + " Magic! Help the princess first."));
      return;
    }
  }
}

// ---------------------------------------------------------------- taps
const lastTap = new Map();
function onTap(player, target) {
  if (!player || !target || player.typeId !== "minecraft:player") return;
  const now = system.currentTick;
  if ((lastTap.get(player.id) ?? -99) > now - 12) return;
  lastTap.set(player.id, now);
  if (target.typeId === "kq:princess") talkToPrincess(player, target);
  else if (target.typeId === "kq:clerk") talkToClerk(player, target);
}

world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  if (!ev.target.typeId.startsWith("kq:")) return;
  ev.cancel = true;
  const player = ev.player, target = ev.target;
  system.run(() => onTap(player, target));
});
world.afterEvents.entityHitEntity.subscribe((ev) => {
  if (ev.hitEntity?.typeId?.startsWith("kq:")) onTap(ev.damagingEntity, ev.hitEntity);
});

// the How-To Book
world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
  if (itemStack?.typeId !== "kq:guide" || source?.typeId !== "minecraft:player") return;
  openGuide(source);
});

// a welcome page the first time you arrive
world.afterEvents.playerSpawn.subscribe((ev) => {
  const p = ev.player;
  if (!ev.initialSpawn || met(p) || stage() >= 1) return;
  system.runTimeout(() => bookSays(p, "kq_b_welcome"), 60);
});

// someone leaving can finish the quest (she needs fewer eggs now)
world.afterEvents.playerLeave.subscribe(() => system.runTimeout(() => {
  if (stage() < 1 && penDone() && enoughEggs()) unlock();
}, 5));

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id === "kq:act") {                                      // a button in a talking window
    if (ev.sourceEntity?.typeId === "minecraft:player") act(ev.sourceEntity, (ev.message ?? "").trim());
  } else if (ev.id === "kq:reset") {
    setStage(0);
    world.setDynamicProperty("kq:barriers_left", 1);
    world.setDynamicProperty("kq:barriers_gone", "[]");
    world.setDynamicProperty("kq:pen", false);
    world.setDynamicProperty("kq:eggs_given", 0);
    for (const p of players()) for (const k of ["kq:met", "kq:step", "kq:had_table"]) p.setDynamicProperty(k, undefined);
    restoreBarriers();
  } else if (ev.id === "kq:unlock") {
    unlock();
  }
});

let t = 0;
system.runInterval(() => { t++; safe(() => upkeep(t)); if (t % 10 === 0) safe(tidyBooks); }, 20);
