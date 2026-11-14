// Kingdom Quest: the story of the Princess Kingdom world. Find Graham, the princess's lost dog!
//
// Quest 1, "The Hen Pen": the princess sits crying on her throne. Tap her and she tells you (in pages you turn
// yourself) that Graham chased her hens all over and then ran away. Build a pen round the hen house by the road
// (fences and seeds are in the chest there), lead at least 3 hens in (they follow seeds), and once the pen is done
// the hens in it lay eggs. She needs 5 eggs for each player (10 for two), and it doesn't matter who brings them;
// when she has them all, the gate in the magic fence round the Ice Palace opens, she cheers up, and Graham's paw prints lead the way.
// Quest 2, "The Bridge": Princess Snowdrop in the Ice Palace is sad: a big block of ice melted into a river that
// cut the road out of the Ice Palace, and her snow golem egg is on the other side. Make planks, build a bridge over
// the river (a deep icy chasm; a ladder climbs out if you fall in), take the egg from the chest on the far side and
// bring it to her: it hatches into a snow golem, and the gate to Blaze Castle opens.
// Quest 3 (Blaze Castle, Prince Ember): Graham chased a bat into the old mine, now dark. Make a wooden then a stone
// pickaxe, mine coal, make torches, light the way down and bring back Graham's collar from the bottom ("If found,
// take me to the Knight's Fortress").
// Quest 4 (Knight's Fortress, King Roland): before the spooky Haunted Mountain, be ready: mine stone for a furnace,
// smelt iron from the quarry, make an iron helmet and a shield, and show the King.
// Quest 5 (Haunted Mountain, Lady Wisp, a friendly ghost): her six lamp posts went dark. Make shears, carve pumpkins,
// make jack o'lanterns and light all six; she tells you the little dog went up to the Sky Castle.
// Quest 6 (Sky Castle, Princess Celeste): Graham is on a little cloud, too scared to jump down. Build stairs up to
// him; he follows you home along the new road to Princess Buttercup. The end.
// Each castle after the first has a magic fence; its gate opens when the quest before it is done.
//
// Grown-ups: /scriptevent kq:reset starts the story again; /scriptevent kq:unlock finishes the quest you're on.

import { world, system, ItemStack } from "@minecraft/server";
import { KINGDOM } from "./kingdom_data.js";

const EGGS_EACH = 5;               // eggs she needs for each player playing (anyone can bring them)
const HENS_NEEDED = 3;             // hens in the pen before it counts
const PEN_REACH = 14;              // a pen can reach this far from the hen house (any further and it isn't closed)
const LAY_EVERY = 12;              // seconds between eggs from the pen (much quicker than wild hens)
const LAST_QUEST = 5;              // quests written so far: gates for castles past this open with the last one
const NEAR = 56;                   // only spawn things when a player is this close (the ground there is loaded)
const G = {                        // little pictures from the resource pack's glyph sheet (\uE100 is the first)
  egg: "\uE100", noEgg: "\uE101", graham: "\uE102", sad: "\uE103", happy: "\uE104", heart: "\uE105",
  paw: "\uE106", ice: "\uE107", bed: "\uE108", moon: "\uE109", inn: "\uE10A", hen: "\uE10B", fence: "\uE10C",
  seeds: "\uE10D", log: "\uE10E", planks: "\uE10F", table: "\uE110", stick: "\uE111", gate: "\uE112",
  axe: "\uE113", book: "\uE114", next: "\uE115", back: "\uE116", snowEgg: "\uE117", iceSad: "\uE118",
  iceHappy: "\uE119", bridge: "\uE11A", river: "\uE11B", emberSad: "\uE11C", emberHappy: "\uE11D",
  kingSad: "\uE11E", kingHappy: "\uE11F", wispSad: "\uE120", wispHappy: "\uE121", celesteSad: "\uE122",
  celesteHappy: "\uE123", collar: "\uE124", pickaxe: "\uE125", coal: "\uE126", torch: "\uE127",
  furnace: "\uE128", iron: "\uE129", helmet: "\uE12A", shield: "\uE12B", shears: "\uE12C", pumpkin: "\uE12D",
  lantern: "\uE12E", stairs: "\uE12F", cloud: "\uE130", star: "\uE131",
};
// ---------------------------------------------------------------- saved state
function stage() { return world.getDynamicProperty("kq:stage") ?? 0; }              // 0 hen quest, 1 Ice Palace open
function setStage(s) { world.setDynamicProperty("kq:stage", s); }
function penDone() { return world.getDynamicProperty("kq:pen") === true; }
function met(p) { return p.getDynamicProperty("kq:met") === true; }
const eggsGiven = () => world.getDynamicProperty("kq:eggs_given") ?? 0;
const eggsNeeded = () => EGGS_EACH * Math.min(4, Math.max(1, players().length));   // (the talking pages go up to 4 players)

// stages: 0 hen pen, 1 bridge, 2 dark mine, 3 iron, 4 lamp posts, 5 Graham's cloud, 6 taking Graham home, 7 the end
const CHARACTERS = [               // who sits where, which quest is theirs, and when they cheer up
  { key: "buttercup", type: "kq:princess", who: 0, name: "Princess Buttercup", seat: () => KINGDOM.princess, facing: () => 0, quest: 0, happyAt: 1 },
  { key: "snowdrop", type: "kq:princess", who: 1, name: "Princess Snowdrop", seat: () => KINGDOM.icePrincess, facing: () => 0, quest: 1, happyAt: 2 },
  { key: "ember", type: "kq:royal", look: 0, name: "Prince Ember", seat: () => KINGDOM.seats.ember.pos, facing: () => KINGDOM.seats.ember.facing, quest: 2, happyAt: 3 },
  { key: "king", type: "kq:royal", look: 2, name: "King Roland", seat: () => KINGDOM.seats.king.pos, facing: () => KINGDOM.seats.king.facing, quest: 3, happyAt: 4 },
  { key: "wisp", type: "kq:ghost", name: "Lady Wisp", seat: () => KINGDOM.seats.wisp.pos, facing: () => KINGDOM.seats.wisp.facing, quest: 4, happyAt: 5 },
  { key: "celeste", type: "kq:princess", who: 2, name: "Princess Celeste", seat: () => KINGDOM.seats.celeste.pos, facing: () => KINGDOM.seats.celeste.facing, quest: 5, happyAt: 6 },
];
const HELP_FIRST = ["Princess Buttercup", "Princess Snowdrop", "Prince Ember", "King Roland", "Lady Wisp"];
const metQ = (p, q) => p.getDynamicProperty(q === 0 ? "kq:met" : "kq:met" + (q + 1)) === true;   // kq:met, kq:met2 ... kq:met6
const setMetQ = (p, q) => p.setDynamicProperty(q === 0 ? "kq:met" : "kq:met" + (q + 1), true);

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
// the name over a character's head: NPCs show the name from their dialogue (otherwise just "NPC"), so each one is
// pointed at a scene carrying their name, once
function nameNpc(e, scene, name) {
  if (e.nameTag !== name) safe(() => { e.nameTag = name; });
  if (e.getDynamicProperty("kq:named") === scene) return;
  const cmd = `dialogue change @s ${scene}`;
  if (safe(() => { if (e.runCommand) e.runCommand(cmd); else e.runCommandAsync(cmd); return true; })) safe(() => e.setDynamicProperty("kq:named", scene));
}

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
    if (b) { safe(() => b.setDynamicProperty("kq:owner", p.id)); nameNpc(b, "kq_name_book", "How-To Book"); }
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
  const c = { axe: 0, logs: 0, planks: 0, table: 0, sticks: 0, fences: 0, gates: 0, guide: 0, snowEgg: 0, blocks: 0, ids: {} };
  const items = [];
  const inv = safe(() => p.getComponent("minecraft:inventory").container);
  if (inv) for (let s = 0; s < inv.size; s++) items.push(inv.getItem(s));
  const eq = safe(() => p.getComponent("minecraft:equippable"));
  if (eq) for (const slot of ["Head", "Chest", "Legs", "Feet", "Offhand"]) items.push(safe(() => eq.getEquipment(slot)));
  for (const it of items) {
    if (!it) continue;
    const id = it.typeId, n = it.amount;
    c.ids[id] = (c.ids[id] ?? 0) + n;
    if (/_(planks|log|wood)$|^minecraft:(dirt|cobblestone|stone|grass_block|sand|oak_planks)$/.test(id)) c.blocks += n;
    if (id.endsWith("_axe")) c.axe += n;
    else if (/_(log|wood|stem)$/.test(id)) c.logs += n;
    else if (id.endsWith("_planks")) c.planks += n;
    else if (id === "minecraft:crafting_table") c.table += n;
    else if (id === "minecraft:stick") c.sticks += n;
    else if (id.includes("fence_gate")) c.gates += n;
    else if (id.includes("fence")) c.fences += n;
    else if (id === "kq:guide") c.guide += n;
    else if (id === "kq:snow_golem_egg") c.snowEgg += n;
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
  const st = stage();
  if (st >= 7) return bookSays(p, "kq_b_end_1");
  if (st === 6) return bookSays(p, "kq_b_home");
  if (st >= 2) {
    const L = LESSONS[st];
    if (!metQ(p, st)) return bookSays(p, L.find);
    return bookSays(p, L.pages + "_" + L.step(p));
  }
  if (st === 1) {
    if (!met2(p)) return bookSays(p, "kq_b_ice");
    const s = bridgeStep(p);
    return bookSays(p, s < 0 ? "kq_b_fell" : "kq_b_bridge_" + s);
  }
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
  if (stage() === 6) {                                           // taking Graham home
    const last = lastHint.get(p.id);
    if (last && last.key === "home" && last.tick > system.currentTick - 600) return;
    lastHint.set(p.id, { key: "home", tick: system.currentTick });
    return safe(() => p.onScreenDisplay.setActionBar("§l" + G.graham + " Take Graham home to Princess Buttercup!"));
  }
  if (!met(p) || stage() >= 7) return;
  let near = flat(p.location, center(KINGDOM.farm.coop)) < 80;
  let key, text;
  if (stage() >= 2 && stage() <= 5) {
    const L = LESSONS[stage()];
    if (!metQ(p, stage())) { key = "find" + stage(); text = L.go; near = false; }
    else { const s = L.step(p); key = "q" + stage() + "_" + s; text = `${L.hints[s][0]} ${L.hints[s][1]}`; near = L.near(p); }
  } else if (stage() === 1) {
    if (!met2(p)) { key = "ice"; text = `${G.ice} Go to the Ice Palace!`; near = false; }
    else { const s = bridgeStep(p); const st = s < 0 ? FELL : BRIDGE[s]; key = "b" + s; text = `${st.pic} ${st.hint}`;
      near = flat(p.location, chasmAt()) < 60; }
  } else if (!penDone()) {
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

// ---------------------------------------------------------------- quest 2: the bridge
const BRIDGE = [                   // hints (pages are kq_b_bridge_0 ... 6)
  { pic: G.river, hint: "Go down the road. Turn left. Find the river!" },
  { pic: G.log, hint: "Chop the trees by the river!" },
  { pic: G.planks, hint: "Open your bag. Make planks!" },
  { pic: G.planks, hint: "Go to the edge of the river. Crouch down!" },
  { pic: G.bridge, hint: "Put planks over the water, one at a time!" },
  { pic: G.snowEgg, hint: "Find the chest. Take the egg!" },
  { pic: G.snowEgg, hint: "Take the egg to Princess Snowdrop!" },
];
const FELL = { pic: G.river, hint: "Swim to the ladder and climb out!" };
const met2 = (p) => p.getDynamicProperty("kq:met2") === true;
const chasmAt = () => ({ x: KINGDOM.chasm.at[0], y: 0, z: KINGDOM.chasm.at[1] });
// where you are compared with the chasm: how far along the road past its middle (+ is the far side), and across
function chasmPos(loc) {
  const c = KINGDOM.chasm, dx = loc.x - c.at[0], dz = loc.z - c.at[1];
  return { along: dx * c.along[0] + dz * c.along[1], across: -dx * c.along[1] + dz * c.along[0] };
}
const hasSnowEgg = (p) => carrying(p).snowEgg > 0;
const has = (p, id) => (carrying(p).ids[id] ?? 0) > 0;
function bridgeStep(p) {
  if (hasSnowEgg(p)) return 6;
  const c = carrying(p), pos = chasmPos(p.location), half = KINGDOM.chasm.half;
  const nearChasm = Math.abs(pos.across) < 30 && Math.abs(pos.along) < 30;
  if (nearChasm && Math.abs(pos.along) < half + 0.5 && p.location.y < KINGDOM.chasm.far[1] - 2) return -1;   // in the river
  if (nearChasm && pos.along > half + 0.5) return 5;
  if (nearChasm) {
    if (c.planks >= 3) return pos.along > -half - 3 ? 4 : 3;
    return c.logs > 0 ? 2 : 1;
  }
  if (c.planks >= 8) return 0;
  return c.logs > 0 ? 2 : 0;
}

// someone reaches the far side: a cheer (once)
function crossingCheck(p) {
  if (stage() !== 1 || world.getDynamicProperty("kq:crossed") === true) return;
  const pos = chasmPos(p.location);
  if (pos.along > KINGDOM.chasm.half + 1 && pos.along < 25 && Math.abs(pos.across) < 30 && p.location.y >= KINGDOM.chasm.far[1] - 1) {
    world.setDynamicProperty("kq:crossed", true);
    safe(() => p.playSound("random.levelup"));
    safe(() => p.onScreenDisplay.setActionBar("§l" + G.bridge + " You made it across!"));
  }
}

// a quest's chest: if its special thing is lost (nobody has it and it isn't in the chest), it turns up there again
function chestGuard(pos, id) {
  if (players().some((p) => carrying(p).ids[id] > 0)) return;
  const [x, y, z] = pos;
  const inv = safe(() => overworld().getBlock({ x, y, z })?.getComponent("minecraft:inventory")?.container);
  if (!inv) return;
  for (let i = 0; i < inv.size; i++) if (inv.getItem(i)?.typeId === id) return;
  safe(() => inv.addItem(new ItemStack(id, 1)));
}

function talkToSnowdrop(p, princess) {
  if (stage() < 1) return say(princess, p, "kq_s_hello");
  if (stage() >= 2) return say(princess, p, "kq_s_happy_1");
  if (!met2(p)) return say(princess, p, "kq_s_intro_1");
  if (hasSnowEgg(p)) return say(princess, p, "kq_s_handin");
  say(princess, p, "kq_s_wait");
}

function giveSnowEgg(p, princess) {
  if (stage() !== 1 || !hasSnowEgg(p)) return;
  const inv = safe(() => p.getComponent("minecraft:inventory").container);
  if (inv) for (let i = 0; i < inv.size; i++) if (inv.getItem(i)?.typeId === "kq:snow_golem_egg") { inv.setItem(i, undefined); break; }
  setStage(2);
  const seat = center(KINGDOM.icePrincess);
  safe(() => overworld().spawnEntity("minecraft:snow_golem", { x: seat.x + 2, y: seat.y - 1, z: seat.z + 3 }));
  for (let k = 0; k < 6; k++) safe(() => overworld().spawnParticle("kq:sparkle", { x: seat.x + 2, y: seat.y + k * 0.3, z: seat.z + 3 }));
  for (const q of players()) {
    safe(() => q.playSound("random.levelup")); safe(() => q.playSound("firework.launch"));
    if (q.id === p.id) system.runTimeout(() => say(princess, q, "kq_s_happy_1"), 6);
    else bookSays(q, "kq_b_ember", 4);
  }
  clearBarriers();
}

// an inn keeper's gift: bread and seeds, once a day at each inn
function innGift(p) {
  const clerk = nearest(p, "kq:clerk");
  const i = clerk?.getDynamicProperty("kq:inn");
  if (typeof i !== "number") return;
  const day = safe(() => world.getDay()) ?? Math.floor(system.currentTick / 24000);
  if (p.getDynamicProperty("kq:gift" + i) === day) return;
  p.setDynamicProperty("kq:gift" + i, day);
  const inv = safe(() => p.getComponent("minecraft:inventory").container);
  for (const [id, n] of [["minecraft:bread", 4], ["minecraft:wheat_seeds", 8]]) safe(() => inv.addItem(new ItemStack(id, n)));
  safe(() => p.playSound("random.pop"));
  say(clerk, p, `kq_i${i}_gift`);
}

// ---------------------------------------------------------------- quests 3 to 6: the lessons
const near3 = (p, at, r) => flat(p.location, center(at)) < r;
const LESSONS = {
  2: { find: "kq_b_ember", pages: "kq_b_mine", go: `${G.emberSad} Go to Blaze Castle! Find Prince Ember!`,
       near: (p) => near3(p, KINGDOM.mine.entrance, 40), step: mineStep, hints: [
         [G.pickaxe, "Make a wooden pickaxe!"], [G.pickaxe, "Go to the mine by Blaze Castle!"],
         [G.pickaxe, "Mine stone. Make a stone pickaxe!"], [G.coal, "Look for coal. Mine it!"],
         [G.torch, "Make torches: coal and a stick!"], [G.torch, "Go down the mine. Put torches on the walls!"],
         [G.collar, "Open the chest at the bottom!"], [G.collar, "Take Graham's collar to Prince Ember!"]] },
  3: { find: "kq_b_king", pages: "kq_b_iron", go: `${G.kingSad} Go to the Knight's Fortress! Find King Roland!`,
       near: (p) => near3(p, KINGDOM.quarry, 40), step: ironStep, hints: [
         [G.pickaxe, "Go to the quarry by the fortress!"], [G.furnace, "Mine 8 stones. Make a furnace!"],
         [G.furnace, "Put your furnace down!"], [G.iron, "Mine iron (orange spots) and coal!"],
         [G.furnace, "Iron in the top, coal in the bottom. Wait!"], [G.helmet, "Make an iron helmet: 5 iron!"],
         [G.shield, "Make a shield: 6 planks and 1 iron!"], [G.shield, "Show King Roland your helmet and shield!"]] },
  4: { find: "kq_b_wisp", pages: "kq_b_lamp", go: `${G.wispSad} Go to the Haunted Mountain! Find Lady Wisp!`,
       near: (p) => near3(p, KINGDOM.lamps.patch, 40), step: lampStep, hints: [
         [G.shears, "Open Lady Wisp's chest. Make shears!"], [G.pumpkin, "Go to the pumpkin patch!"],
         [G.shears, "Hold the shears. Tap a pumpkin!"], [G.lantern, "Carved pumpkin and torch: a jack o'lantern!"],
         [G.lantern, "Put jack o'lanterns on the lamp posts!"], [G.wispHappy, "Go back to Lady Wisp!"]] },
  5: { find: "kq_b_celeste", pages: "kq_b_up", go: `${G.celesteSad} Go to the Sky Castle! Find Princess Celeste!`,
       near: (p) => p.location.y > KINGDOM.cloud.y - 14, step: upStep, hints: [
         [G.cloud, "Look up! Graham is on the little cloud!"], [G.stairs, "Get blocks from the chest!"],
         [G.stairs, "Put a block down. Step up. Put the next one higher!"], [G.stairs, "Build stairs all the way up!"],
         [G.graham, "Tap Graham!"]] },
};
function mineStep(p) {
  const c = carrying(p), n = (id) => c.ids[id] ?? 0;
  if (n("kq:collar")) return 7;
  const m = KINGDOM.mine, inMine = near3(p, m.entrance, 34) && p.location.y < m.entrance[1] - 2;
  const torches = n("minecraft:torch"), coal = n("minecraft:coal") + n("minecraft:charcoal");
  if (inMine && torches) return p.location.y <= m.bottom[1] + 2 ? 6 : 5;
  if (torches) return 5;
  if (coal) return 4;
  if (n("minecraft:stone_pickaxe") || n("minecraft:iron_pickaxe")) return 3;
  if (n("minecraft:wooden_pickaxe")) return near3(p, m.entrance, 40) ? 2 : 1;
  return 0;
}
function ironStep(p) {
  const c = carrying(p), n = (id) => c.ids[id] ?? 0;
  if (n("minecraft:furnace")) p.setDynamicProperty("kq:had_furnace", true);
  const hadFurnace = p.getDynamicProperty("kq:had_furnace") === true;
  if (n("minecraft:iron_helmet") && n("minecraft:shield")) return 7;
  if (n("minecraft:iron_helmet")) return 6;
  if (n("minecraft:iron_ingot") >= 5) return 5;
  if (n("minecraft:raw_iron") || n("minecraft:iron_ore") || n("minecraft:iron_ingot")) return n("minecraft:furnace") ? 2 : hadFurnace ? 4 : 1;
  if (n("minecraft:furnace")) return 2;
  if (hadFurnace) return 3;
  if (n("minecraft:cobblestone") >= 8) return 1;
  return near3(p, KINGDOM.quarry, 30) ? 1 : 0;
}
function litLamps() { try { return JSON.parse(world.getDynamicProperty("kq:lamps") ?? "[]"); } catch { return []; } }
function lampCheck() {
  const lit = litLamps();
  let changed = false;
  KINGDOM.lamps.posts.forEach(([x, y, z], i) => {
    if (lit.includes(i)) return;
    const b = safe(() => overworld().getBlock({ x, y, z }));
    if (b?.typeId === "minecraft:lit_pumpkin") {
      lit.push(i); changed = true;
      for (const p of players()) if (flat(p.location, { x, z }) < 30) {
        safe(() => p.playSound("random.orb", { pitch: 0.8 + lit.length * 0.1 }));
        safe(() => p.onScreenDisplay.setActionBar(`§l${G.lantern} ${lit.length} of 6 lamp posts lit!`));
      }
      safe(() => overworld().spawnParticle("kq:sparkle", { x: x + 0.5, y: y + 0.8, z: z + 0.5 }));
    }
  });
  if (changed) world.setDynamicProperty("kq:lamps", JSON.stringify(lit));
}
function lampStep(p) {
  const c = carrying(p), n = (id) => c.ids[id] ?? 0;
  if (litLamps().length >= 6) return 5;
  if (n("minecraft:lit_pumpkin")) return 4;
  if (n("minecraft:carved_pumpkin")) return 3;
  if (n("minecraft:shears")) return near3(p, KINGDOM.lamps.patch, 14) ? 2 : 1;
  return 0;
}
function upStep(p) {
  const g = KINGDOM.cloud.graham;
  if (Math.hypot(p.location.x - g[0] - 0.5, p.location.y - g[1], p.location.z - g[2] - 0.5) < 6) return 4;
  if (!(p.location.y > KINGDOM.cloud.y - 14 && near3(p, g, 45))) return 0;
  if (carrying(p).blocks < 6) return 1;
  return p.location.y < KINGDOM.cloud.y - 4 ? 2 : 3;
}

// talking to them: before their quest, during it, and after
function talkQuest(p, e, ch) {
  const st = stage(), pre = { ember: "kq_e", king: "kq_k", wisp: "kq_w", celeste: "kq_c" }[ch.key];
  if (st < ch.quest) return say(e, p, pre + "_hello");
  if (st > ch.quest) return say(e, p, pre + "_happy_1");
  if (!metQ(p, ch.quest)) return say(e, p, pre + "_intro_1");
  if (giveGuide(p)) return say(e, p, "kq_p_newbook");
  if (ch.key === "ember") return say(e, p, has(p, "kq:collar") ? "kq_e_handin" : "kq_e_wait");
  if (ch.key === "king") return say(e, p, has(p, "minecraft:iron_helmet") && has(p, "minecraft:shield") ? "kq_k_handin" : "kq_k_wait");
  if (ch.key === "wisp") {
    safe(lampCheck);
    const lit = litLamps().length;
    if (lit >= 6) { advance(5, p, e, "kq_w_happy_1", "kq_b_celeste"); return; }
    return say(e, p, "kq_w_wait_" + lit);
  }
  if (ch.key === "celeste") return say(e, p, "kq_c_wait");
}

// a quest is done: everyone cheers, the next gate opens; the helper sees the happy pages, the others their book
function advance(to, p, e, happyScene, bookScene) {
  if (stage() >= to) return;
  setStage(to);
  for (const q of players()) {
    safe(() => q.playSound("random.levelup")); safe(() => q.playSound("firework.launch"));
    if (q.id === p.id) system.runTimeout(() => say(e, q, happyScene), 6);
    else if (bookScene) bookSays(q, bookScene, 4);
  }
  clearBarriers();
}

// ---------------------------------------------------------------- Graham
// On his cloud above the Sky Castle until you reach him; then he trots after you all the way home; at the end he
// sits by Princess Buttercup's throne.
const grahams = () => safe(() => overworld().getEntities({ type: "kq:graham" })) ?? [];
function grahamUpkeep(t) {
  const st = stage();
  if (st === 6) return;                                         // following: see grahamFollow
  const spot = st === 5 ? KINGDOM.cloud.graham : KINGDOM.grahamHome;
  const at = center(spot);
  if (!nearAnyPlayer(at, 48)) return;
  let gs = grahams().filter((g) => flat(g.location, at) < 64);
  for (const extra of gs.slice(1)) safe(() => extra.remove());
  let g = gs[0] ?? safe(() => overworld().spawnEntity("kq:graham", at));
  if (!g) return;
  nameNpc(g, "kq_name_graham", "Graham");
  if (dist(g.location, at) > 0.3) safe(() => g.teleport(at, { rotation: { x: 0, y: st === 5 ? 0 : 180 } }));
  if (safe(() => g.getProperty("kq:walk"))) safe(() => g.setProperty("kq:walk", false));
  if (t % 4 === 0) safe(() => overworld().spawnParticle("minecraft:heart_particle", { x: at.x, y: at.y + 1.2, z: at.z }));
}
function grahamLeader() {
  const all = players();
  return all.find((p) => p.id === world.getDynamicProperty("kq:leader")) ?? all[0];
}
function grahamFollow() {
  if (stage() !== 6) return;
  const p = grahamLeader();
  if (!p || p.dimension.id !== "minecraft:overworld") return;
  let gs = grahams();
  let g = gs.find((e) => flat(e.location, p.location) < 40);
  for (const e of gs) if (e !== g) safe(() => e.remove());
  const yaw = (safe(() => p.getRotation().y) ?? 0) * Math.PI / 180;
  const riding = !!safe(() => p.getComponent("minecraft:riding")?.entityRidingOn);
  const target = { x: p.location.x + Math.sin(yaw) * 2.2 + Math.cos(yaw) * 1.2, y: p.location.y - (riding ? 0.9 : 0),
                   z: p.location.z - Math.cos(yaw) * 2.2 + Math.sin(yaw) * 1.2 };
  if (!g) {
    g = safe(() => p.dimension.spawnEntity("kq:graham", target));
    if (g) nameNpc(g, "kq_name_graham", "Graham");
    return;
  }
  const d = dist(g.location, target);
  let walking = false;
  if (d > 14) safe(() => g.teleport(target, { facingLocation: p.location }));
  else if (d > 0.6) {
    const k = Math.min(1, Math.max(0.35, 2.6 / d));
    const next = { x: g.location.x + (target.x - g.location.x) * k, y: g.location.y + (target.y - g.location.y) * k,
                   z: g.location.z + (target.z - g.location.z) * k };
    safe(() => g.teleport(next, { facingLocation: { x: p.location.x, y: next.y, z: p.location.z } }));
    walking = true;
  }
  if (safe(() => g.getProperty("kq:walk")) !== walking) safe(() => g.setProperty("kq:walk", walking));
  // home!
  const home = center(KINGDOM.princess);
  if (dist(g.location, home) < 8) finale(p);
}
function talkToGraham(p, g) {
  const st = stage();
  if (st === 5) return say(g, p, "kq_g_found_1");
  say(g, p, "kq_g_hi");
}
function grahamFound(p) {
  if (stage() !== 5) return;
  world.setDynamicProperty("kq:leader", p.id);
  setStage(6);
  for (const q of players()) {
    safe(() => q.playSound("random.levelup"));
    if (q.id === p.id) system.runTimeout(() => say(nearest(q, "kq:princess", 40) ?? bookFor(q), q, "kq_c_happy_1"), 6);
    else bookSays(q, "kq_b_home", 4);
  }
  clearBarriers();
}
function finale(p) {
  if (stage() !== 6) return;
  setStage(7);
  const dim = overworld(), home = center(KINGDOM.princess);
  for (const g of grahams()) safe(() => g.teleport(center(KINGDOM.grahamHome), { rotation: { x: 0, y: 180 } }));
  for (let k = 0; k < 12; k++) safe(() => dim.spawnParticle("minecraft:heart_particle",
    { x: home.x + Math.sin(k) * 2, y: home.y + 1 + (k % 4) * 0.4, z: home.z + Math.cos(k) * 2 }));
  for (let k = 0; k < 5; k++) system.runTimeout(() => safe(() => dim.spawnEntity("minecraft:fireworks_rocket",
    { x: (k - 2) * 6 + 0.5, y: KINGDOM.spawn[1] + 1, z: 30.5 })), 10 + k * 8);
  const princess = (safe(() => dim.getEntities({ type: "kq:princess", location: home, maxDistance: 4 })) ?? [])[0];
  for (const q of players()) {
    safe(() => q.playSound("random.levelup")); safe(() => q.playSound("firework.twinkle"));
    if (princess && flat(q.location, home) < 40) system.runTimeout(() => say(princess, q, "kq_p_end_1"), 10);
    else bookSays(q, "kq_b_end_1", 10);
  }
}
system.runInterval(() => safe(grahamFollow), 4);

// ---------------------------------------------------------------- talking to the princess
function talkToPrincess(p, princess) {
  if (stage() >= 7) return say(princess, p, "kq_p_home");
  if (stage() === 6) return say(princess, p, "kq_p_where");
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
  else if (what === "ice_yes") {
    p.setDynamicProperty("kq:met2", true);
    giveGuide(p);
    safe(() => p.playSound("random.orb", { pitch: 1.2 }));
    say(princess, p, "kq_s_thanks_1");
  } else if (what === "ice_give") giveSnowEgg(p, princess);
  else if (what === "inngift") innGift(p);
  else if (["e_yes", "k_yes", "w_yes", "c_yes"].includes(what)) {
    const q = { e_yes: 2, k_yes: 3, w_yes: 4, c_yes: 5 }[what], pre = what[0];
    const e = nearest(p, { e: "kq:royal", k: "kq:royal", w: "kq:ghost", c: "kq:princess" }[pre], 16);
    setMetQ(p, q);
    giveGuide(p);
    safe(() => p.playSound("random.orb", { pitch: 1.2 }));
    say(e, p, "kq_" + pre + "_thanks_1");
  } else if (what === "e_give") {
    const e = nearest(p, "kq:royal", 16);
    if (stage() !== 2 || !has(p, "kq:collar")) return;
    const inv = safe(() => p.getComponent("minecraft:inventory").container);
    if (inv) for (let i = 0; i < inv.size; i++) if (inv.getItem(i)?.typeId === "kq:collar") { inv.setItem(i, undefined); break; }
    advance(3, p, e, "kq_e_happy_1", "kq_b_king");
  } else if (what === "k_show") {
    if (stage() !== 3 || !has(p, "minecraft:iron_helmet") || !has(p, "minecraft:shield")) return;
    advance(4, p, nearest(p, "kq:royal", 16), "kq_k_happy_1", "kq_b_wisp");
  } else if (what === "g_follow") grahamFound(p);
  else if (what === "talk") {                                    // from a character's own page (if a tap opened it)
    const who = ["kq:princess", "kq:clerk", "kq:royal", "kq:ghost", "kq:graham"].map((ty) => nearest(p, ty, 8)).filter(Boolean)
      .sort((a, b) => dist(a.location, p.location) - dist(b.location, p.location))[0];
    if (who) onTap(p, who, true);
  }
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
    else bookSays(p, "kq_b_ice", 4);
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
  const s = stage();
  // the princesses, prince, king and ghost, on their thrones: sad until their quest is done
  for (const ch of CHARACTERS) {
    const seat = center(ch.seat());
    if (!nearAnyPlayer(seat)) continue;
    let es = (safe(() => dim.getEntities({ type: ch.type, location: seat, maxDistance: 8 })) ?? []);
    for (const extra of es.slice(1)) safe(() => extra.remove());
    let e = es[0];
    if (!e) e = safe(() => dim.spawnEntity(ch.type, seat));
    if (!e) continue;
    if (e.getDynamicProperty("kq:key") !== ch.key) safe(() => e.setDynamicProperty("kq:key", ch.key));
    if (ch.who !== undefined && safe(() => e.getProperty("kq:who")) !== ch.who) safe(() => e.setProperty("kq:who", ch.who));
    nameNpc(e, ch.who !== undefined && ch.who < 2 ? "kq_name_" + ch.who : "kq_name_" + ch.key, ch.name);
    if (dist(e.location, seat) > 0.3) safe(() => e.teleport(seat, { rotation: { x: 0, y: ch.facing() } }));
    safe(() => e.setRotation({ x: 0, y: ch.facing() }));
    const happy = s >= ch.happyAt;
    if (ch.look !== undefined) { if (safe(() => e.getProperty("kq:look")) !== ch.look + (happy ? 1 : 0)) safe(() => e.setProperty("kq:look", ch.look + (happy ? 1 : 0))); }
    else if (safe(() => e.getProperty("kq:happy")) !== happy) safe(() => e.setProperty("kq:happy", happy));
    if (!happy && s >= ch.quest && t % 2 === 0) safe(() => dim.spawnParticle("kq:tear", { x: seat.x + (t % 4 ? 0.15 : -0.15), y: seat.y + 1.15, z: seat.z + 0.25 }));
    if (happy && t % 3 === 0) safe(() => dim.spawnParticle("minecraft:heart_particle", { x: seat.x, y: seat.y + 1.9, z: seat.z }));
  }
  if (s >= 5) safe(() => grahamUpkeep(t));
  if (s === 2 && t % 30 === 0) safe(() => chestGuard(KINGDOM.mine.chest, "kq:collar"));
  if (s === 4 && t % 3 === 0) safe(lampCheck);
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
      nameNpc(c, "kq_name_i" + i, inn.clerk);
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
    if (t % 15 === 0) restoreBarriers();                       // gates still closed (later quests)
  }
  if (s === 1 && t % 30 === 0) safe(() => chestGuard(KINGDOM.chasm.chest, "kq:snow_golem_egg"));
  // signs for each player
  for (const p of players()) {
    if (p.dimension.id !== "minecraft:overworld") continue;
    if (!met(p) && s < 1) trailNear(p, KINGDOM.toPrincess, t, "kq:sparkle", 24);
    if (s === 1) crossingCheck(p);
    if (t % 2 === 0) barrierNudge(p);
    if (t % 2 === 1) lessonHint(p);
  }
}

// a moving line of sparkles along a path, near the player, pointing the way
function trailNear(p, path, t, particle, r) {
  const dim = overworld();
  for (let i = 0; i < path.length; i++) {
    if ((i + 4 - (t % 4)) % 4 !== 0) continue;
    const c = path[i];
    if (Math.abs(c[0] + 0.5 - p.location.x) > r || Math.abs(c[2] + 0.5 - p.location.z) > r) continue;
    if (flat(p.location, center(c)) > r) continue;
    safe(() => dim.spawnParticle(particle, { x: c[0] + 0.5, y: c[1] + 0.05, z: c[2] + 0.5 }));
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
      safe(() => p.onScreenDisplay.setActionBar("§l§d" + G.sad + " Magic! Help " + HELP_FIRST[Math.min(stage(), 4)] + " first."));
      return;
    }
  }
}

// ---------------------------------------------------------------- taps
const lastTap = new Map();
function onTap(player, target, again) {
  if (!player || !target || player.typeId !== "minecraft:player") return;
  const now = system.currentTick;
  if (!again && (lastTap.get(player.id) ?? -99) > now - 12) return;
  lastTap.set(player.id, now);
  const key = target.getDynamicProperty?.("kq:key");
  const ch = CHARACTERS.find((c) => c.key === key);
  if (target.typeId === "kq:graham") talkToGraham(player, target);
  else if (ch && ch.quest >= 2) talkQuest(player, target, ch);
  else if (target.typeId === "kq:princess") {
    if (safe(() => target.getProperty("kq:who")) === 1) talkToSnowdrop(player, target);
    else talkToPrincess(player, target);
  }
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
    world.setDynamicProperty("kq:crossed", false);
    world.setDynamicProperty("kq:lamps", "[]");
    world.setDynamicProperty("kq:leader", undefined);
    for (const g of grahams()) safe(() => g.remove());
    for (const p of players()) for (const k of ["kq:met", "kq:met2", "kq:met3", "kq:met4", "kq:met5", "kq:met6", "kq:step", "kq:had_table", "kq:had_furnace"]) p.setDynamicProperty(k, undefined);
    restoreBarriers();
  } else if (ev.id === "kq:unlock") {                            // skip the quest you're on
    const st = stage(), p = players()[0];
    if (st === 0) unlock();
    else if (st >= 1 && st <= 4) { setStage(st + 1); clearBarriers(); }
    else if (st === 5 && p) grahamFound(p);
    else if (st === 6 && p) finale(p);
  }
});

let t = 0;
system.runInterval(() => { t++; safe(() => upkeep(t)); if (t % 10 === 0) safe(tidyBooks); }, 20);
