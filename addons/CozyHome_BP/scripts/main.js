// Cozy Home: Toca-style furniture where everything does something when you tap it.
//   Fridge   - opens (and closes by itself); pops out a snack, with a rare treat now and then
//   Stove    - drop in two things you're holding and it cooks something (sometimes something silly)
//   Bathtub  - tap to fill or drain; sit in a full tub for a bubbly, sparkly clean
//   Toilet   - flush! Once in a while a fish comes back up
//   TV       - flips through channels; once in a while the secret Graham channel comes on
//   Lamp     - on and off
//   Mailbox  - the flag goes up every morning; tap it for today's mail (one letter per player per day)
// Crouch to build against furniture like a normal block.
import { world, system, ItemStack } from "@minecraft/server";

const FRIDGE = "cozy:fridge", STOVE = "cozy:stove", TUB = "cozy:bathtub", TOILET = "cozy:toilet";
const TV = "cozy:tv", LAMP = "cozy:lamp", MAILBOX = "cozy:mailbox";
const FURNITURE = [FRIDGE, STOVE, TUB, TOILET, TV, LAMP, MAILBOX];
const DISHES = ["fruit_salad", "carrot_cake", "pizza", "rainbow_soup", "mud_pie"].map((d) => `cozy:${d}`);
const FRIDGE_RESTOCK = 200;   // ticks before the same fridge has another snack
const FRIDGE_AUTOCLOSE = 120; // the door swings shut by itself
const COOK_TIME = 60;
const TV_CHANNELS = 4;        // 1..4 are normal channels, 5 is the secret one
const SECRET_CHANCE = 0.06;

// ---------- Helpers ----------
const mc = (id) => `minecraft:${id}`;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
function weighted(list) {
  let r = Math.random() * list.reduce((s, g) => s + g.w, 0);
  for (const g of list) if ((r -= g.w) < 0) return g;
  return list[list.length - 1];
}
function getJSON(k, fallback) {
  try {
    const raw = world.getDynamicProperty(k);
    if (typeof raw === "string") return JSON.parse(raw);
  } catch {}
  return fallback;
}
function setJSON(k, value) {
  try { world.setDynamicProperty(k, JSON.stringify(value)); } catch {}
}
const keyOf = (dimId, l) => `${dimId}|${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)}`;
function fromKey(k) {
  const [dimId, xyz] = k.split("|");
  const [x, y, z] = xyz.split(",").map(Number);
  return { dimId, loc: { x, y, z } };
}
function blockAt(dimId, loc) {
  try { return world.getDimension(dimId).getBlock(loc); } catch { return undefined; }
}
const getState = (b, s) => { try { return b.permutation.getState(s); } catch { return undefined; } };
function setState(b, s, v) {
  try { b.setPermutation(b.permutation.withState(s, v)); return true; } catch { return false; }
}
function sound(dim, id, loc, opts = {}) {
  try { dim.playSound(id, loc, opts); } catch { try { world.playSound(id, loc, opts); } catch {} }
}
function particle(dim, id, loc) {
  try { dim.spawnParticle(id, loc); } catch {}
}
const FRONT = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
function frontOf(b, out = 0.8, dy = 0.5) {
  const [fx, fz] = FRONT[getState(b, "minecraft:cardinal_direction")] || FRONT.north;
  return { x: b.location.x + 0.5 + fx * out, y: b.location.y + dy, z: b.location.z + 0.5 + fz * out };
}
const top = (b, dy = 1) => ({ x: b.location.x + 0.5, y: b.location.y + dy, z: b.location.z + 0.5 });
function popItem(b, id, n = 1, dy = 0.6) {
  try { b.dimension.spawnItem(new ItemStack(id, n), frontOf(b, 0.9, dy)); } catch {}
}
function give(player, id, n) {
  try {
    const left = player.getComponent("minecraft:inventory").container.addItem(new ItemStack(id, n));
    if (left) player.dimension.spawnItem(left, player.location);
  } catch {}
}

// ---------- Starter kit ----------
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      if (player.getDynamicProperty("cozy:got_starter")) return;
      for (const id of FURNITURE) give(player, id, 1);
      player.setDynamicProperty("cozy:got_starter", true);
      player.sendMessage("§dYou got Cozy Home furniture! §fPut it in your house and tap everything to see what it does. Try putting two foods in the stove's pot!");
      player.playSound("random.levelup", { pitch: 1.4 });
    } catch {}
  }, 120);
});

// ---------- Tapping furniture ----------
const lastTap = new Map();
world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const { block, player } = ev;
  if (!FURNITURE.includes(block.typeId)) return;
  if (player.isSneaking) return; // crouch to build against it like a normal block
  ev.cancel = true;
  if (ev.isFirstEvent === false) return;
  const dimId = block.dimension.id, loc = { ...block.location }, typeId = block.typeId;
  const k = keyOf(dimId, loc);
  const now = system.currentTick;
  if (now - (lastTap.get(k) ?? -99) < 6) return;
  lastTap.set(k, now);
  const held = ev.itemStack?.typeId;
  system.run(() => {
    const b = blockAt(dimId, loc);
    if (!b || b.typeId !== typeId) return;
    try { TAP[typeId](player, b, held, k); } catch {}
  });
});

const TAP = {
  [FRIDGE]: tapFridge, [STOVE]: tapStove, [TUB]: tapTub, [TOILET]: tapToilet,
  [TV]: tapTV, [LAMP]: tapLamp, [MAILBOX]: tapMailbox,
};

// ---------- Fridge ----------
const SNACKS = [
  { id: mc("apple"), n: [1, 2], w: 4 }, { id: mc("cookie"), n: [2, 3], w: 4 }, { id: mc("bread"), n: [1, 1], w: 3 },
  { id: mc("carrot"), n: [1, 2], w: 3 }, { id: mc("melon_slice"), n: [2, 3], w: 3 }, { id: mc("sweet_berries"), n: [2, 4], w: 3 },
  { id: mc("glow_berries"), n: [2, 3], w: 2 }, { id: mc("pumpkin_pie"), n: [1, 1], w: 2 }, { id: mc("baked_potato"), n: [1, 2], w: 2 },
  { id: mc("egg"), n: [1, 2], w: 1.5 }, { id: mc("milk_bucket"), n: [1, 1], w: 1 }, { id: "dish", n: [1, 1], w: 1.5 },
  { id: mc("cake"), n: [1, 1], w: 0.6 }, { id: mc("golden_apple"), n: [1, 1], w: 0.3 },
];
const snackAt = new Map();
const closeTimers = new Map();

function tapFridge(player, b, held, k) {
  if (getState(b, "cozy:open")) return closeFridge(b, k);
  if (!setState(b, "cozy:open", true)) return;
  const dim = b.dimension;
  sound(dim, "random.chestopen", top(b, 0.5), { pitch: 1.3, volume: 0.7 });
  for (let i = 0; i < 3; i++) particle(dim, "minecraft:snowflake_particle", frontOf(b, 0.6, 0.4 + i * 0.3));
  const now = system.currentTick;
  if (now - (snackAt.get(k) ?? -1e9) >= FRIDGE_RESTOCK) {
    snackAt.set(k, now);
    const g = weighted(SNACKS);
    popItem(b, g.id === "dish" ? pick(DISHES) : g.id, rint(...g.n));
  }
  if (closeTimers.has(k)) system.clearRun(closeTimers.get(k));
  const { dimId, loc } = fromKey(k);
  closeTimers.set(k, system.runTimeout(() => {
    closeTimers.delete(k);
    const bb = blockAt(dimId, loc);
    if (bb?.typeId === FRIDGE && getState(bb, "cozy:open")) closeFridge(bb, k);
  }, FRIDGE_AUTOCLOSE));
}

function closeFridge(b, k) {
  if (closeTimers.has(k)) { system.clearRun(closeTimers.get(k)); closeTimers.delete(k); }
  if (setState(b, "cozy:open", false)) sound(b.dimension, "random.chestclosed", top(b, 0.5), { pitch: 1.3, volume: 0.7 });
}

// ---------- Stove and cooking pot ----------
const FLOWERS = /dandelion|poppy|orchid|allium|bluet|tulip|daisy|cornflower|lily_of_the_valley|torchflower|pink_petals|sunflower|lilac|peony|rose_bush|wither_rose/;
const isColorful = (id) => FLOWERS.test(id) || /_dye$/.test(id);
const MUD = ["dirt", "coarse_dirt", "mud", "sand", "red_sand", "clay_ball", "gravel"].map(mc);
const FRUIT = ["apple", "golden_apple", "enchanted_golden_apple", "melon_slice", "sweet_berries", "glow_berries", "chorus_fruit"].map(mc);
const CARROT = ["carrot", "golden_carrot"].map(mc);
const SWEET = ["sugar", "wheat", "egg", "cookie", "bread", "honey_bottle", "cake", "milk_bucket", "cocoa_beans", "pumpkin_pie"].map(mc);
const DOUGH = ["wheat", "bread"].map(mc);
const RAW = { beef: "cooked_beef", porkchop: "cooked_porkchop", chicken: "cooked_chicken", mutton: "cooked_mutton",
  rabbit: "cooked_rabbit", cod: "cooked_cod", salmon: "cooked_salmon", potato: "baked_potato", kelp: "dried_kelp" };
const COOKED = Object.fromEntries(Object.entries(RAW).map(([a, b]) => [mc(a), mc(b)]));
const TOPPINGS = [...Object.keys(COOKED), ...Object.values(COOKED),
  ...["carrot", "beetroot", "pumpkin", "brown_mushroom", "red_mushroom", "milk_bucket", "tropical_fish", "pufferfish"].map(mc)];
const OTHER_FOOD = ["beetroot", "pumpkin", "melon_block", "brown_mushroom", "red_mushroom", "mushroom_stew", "rabbit_stew",
  "beetroot_soup", "tropical_fish", "pufferfish", "rotten_flesh", "spider_eye", "poisonous_potato", "snowball", "slime_ball",
  "honeycomb", "cooked_beef"].map(mc);
const SURPRISE = ["pumpkin_pie", "cookie", "mushroom_stew", "rabbit_stew", "beetroot_soup", "bread", "baked_potato"].map(mc);

function isIngredient(id) {
  if (!id) return false;
  return isColorful(id) || DISHES.includes(id) || [...MUD, ...FRUIT, ...CARROT, ...SWEET, ...TOPPINGS, ...OTHER_FOOD].includes(id);
}

// What two things make. The order you put them in doesn't matter.
function cook(a, b) {
  const either = (f) => f(a) || f(b);
  const inList = (list) => (id) => list.includes(id);
  if (either(inList(MUD))) return "cozy:mud_pie";
  if (either(isColorful)) return "cozy:rainbow_soup";
  if (either(inList(CARROT)) && either(inList(SWEET))) return "cozy:carrot_cake";
  if (FRUIT.includes(a) && FRUIT.includes(b)) return "cozy:fruit_salad";
  if (either(inList(DOUGH)) && either(inList(TOPPINGS))) return "cozy:pizza";
  if (a === b && COOKED[a]) return COOKED[a];
  if (Math.random() < 0.08) return mc("cake");
  return pick(SURPRISE);
}

const cooking = new Set();

function takeOne(player, id) {
  try {
    const inv = player.getComponent("minecraft:inventory").container;
    const slot = player.selectedSlotIndex;
    const item = inv.getItem(slot);
    if (!item || item.typeId !== id) return false;
    if (id === mc("milk_bucket")) inv.setItem(slot, new ItemStack(mc("bucket"), 1));
    else if (id === mc("honey_bottle")) inv.setItem(slot, new ItemStack(mc("glass_bottle"), 1));
    else if (item.amount > 1) { item.amount -= 1; inv.setItem(slot, item); }
    else inv.setItem(slot, undefined);
    return true;
  } catch { return false; }
}

function bubbles(b) {
  const dim = b.dimension;
  for (let i = 0; i < 3; i++) {
    particle(dim, "minecraft:water_splash_particle_manual",
      { x: b.location.x + 0.3 + Math.random() * 0.4, y: b.location.y + 1.05, z: b.location.z + 0.3 + Math.random() * 0.4 });
  }
}

function tapStove(player, b, held, k) {
  const state = getState(b, "cozy:pot") ?? 0;
  if (state === 2) {
    if (!cooking.has(k)) finishCooking(k); // the world was closed mid-cook: it's ready now
    return;
  }
  if (!isIngredient(held) || !takeOne(player, held)) {
    bubbles(b); // just a stir
    sound(b.dimension, "random.splash", top(b), { pitch: 1.6, volume: 0.25 });
    return;
  }
  const pots = getJSON("cozy:pots", {});
  const inPot = [...(pots[k] || []), held];
  pots[k] = inPot;
  setJSON("cozy:pots", pots);
  bubbles(b);
  sound(b.dimension, "random.splash", top(b), { pitch: 1.4, volume: 0.4 });
  if (inPot.length >= 2) {
    setState(b, "cozy:pot", 2);
    startCooking(k);
  } else {
    setState(b, "cozy:pot", 1);
  }
}

function startCooking(k) {
  cooking.add(k);
  const { dimId, loc } = fromKey(k);
  for (let t = 10; t < COOK_TIME; t += 10) {
    system.runTimeout(() => {
      const b = blockAt(dimId, loc);
      if (b?.typeId !== STOVE) return;
      bubbles(b);
      particle(b.dimension, "minecraft:basic_smoke_particle", top(b, 1.2));
      sound(b.dimension, "bubble.pop", top(b), { pitch: 0.8 + Math.random() * 0.6, volume: 0.5 });
    }, t);
  }
  system.runTimeout(() => finishCooking(k), COOK_TIME);
}

function finishCooking(k) {
  cooking.delete(k);
  const pots = getJSON("cozy:pots", {});
  const inPot = pots[k];
  const { dimId, loc } = fromKey(k);
  const b = blockAt(dimId, loc);
  if (b?.typeId !== STOVE || !inPot) return;
  delete pots[k];
  setJSON("cozy:pots", pots);
  setState(b, "cozy:pot", 0);
  const dish = cook(inPot[0], inPot[1] ?? inPot[0]);
  sound(b.dimension, "note.bell", top(b), { pitch: 1.6 });
  system.runTimeout(() => sound(b.dimension, "note.bell", top(b), { pitch: 2 }), 4);
  particle(b.dimension, "minecraft:villager_happy", top(b, 1.3));
  popItem(b, dish, 1, 1.1);
}

// ---------- Bathtub ----------
function tapTub(player, b) {
  const full = !getState(b, "cozy:full");
  if (!setState(b, "cozy:full", full)) return;
  sound(b.dimension, full ? "bucket.empty_water" : "bucket.fill_water", top(b, 0.5));
  if (full) for (let i = 0; i < 4; i++) particle(b.dimension, "minecraft:water_splash_particle_manual", top(b, 0.6));
}

const soaking = new Map(); // player name -> ticks in a full tub (-1 = already sparkly this soak)
system.runInterval(() => {
  for (const p of world.getAllPlayers()) {
    try {
      const b = p.dimension.getBlock({ x: Math.floor(p.location.x), y: Math.floor(p.location.y), z: Math.floor(p.location.z) });
      if (b?.typeId !== TUB || !getState(b, "cozy:full")) { soaking.delete(p.name); continue; }
      bubbles({ dimension: b.dimension, location: { ...b.location, y: b.location.y - 0.4 } });
      const t = soaking.get(p.name) ?? 0;
      if (t < 0) continue;
      if (t + 10 >= 40) {
        soaking.set(p.name, -1);
        for (const e of ["poison", "hunger", "slowness", "weakness", "nausea", "blindness", "mining_fatigue", "darkness"]) {
          try { p.removeEffect(e); } catch {}
        }
        for (let i = 0; i < 6; i++) {
          particle(p.dimension, "minecraft:villager_happy",
            { x: p.location.x - 0.5 + Math.random(), y: p.location.y + 0.3 + Math.random() * 1.5, z: p.location.z - 0.5 + Math.random() });
        }
        sound(p.dimension, "random.orb", p.location, { pitch: 1.6 });
      } else soaking.set(p.name, t + 10);
    } catch {}
  }
}, 10);

// ---------- Toilet ----------
const flushedAt = new Map();
function tapToilet(player, b, held, k) {
  const now = system.currentTick;
  if (now - (flushedAt.get(k) ?? -1e9) < 40) return;
  flushedAt.set(k, now);
  const dim = b.dimension, { dimId, loc } = fromKey(k);
  sound(dim, "bucket.fill_water", top(b, 0.6), { pitch: 0.7 });
  system.runTimeout(() => sound(dim, "random.splash", top(b, 0.6), { pitch: 0.8, volume: 0.6 }), 6);
  for (let i = 0; i < 12; i++) { // a little swirl over the bowl
    system.runTimeout(() => {
      const bb = blockAt(dimId, loc);
      if (bb?.typeId !== TOILET) return;
      const a = i * 0.9, c = frontOf(bb, 0.1, 0.65);
      particle(dim, "minecraft:water_splash_particle_manual", { x: c.x + Math.cos(a) * 0.2, y: c.y, z: c.z + Math.sin(a) * 0.2 });
    }, i * 2);
  }
  if (Math.random() < 0.04) { // a secret: something swims back up
    system.runTimeout(() => {
      const bb = blockAt(dimId, loc);
      if (bb?.typeId === TOILET) {
        popItem(bb, mc("tropical_fish_bucket"), 1, 0.8);
        sound(dim, "random.pop", top(bb, 0.6), { pitch: 1.4 });
      }
    }, 30);
  }
}

// ---------- TV ----------
function tapTV(player, b) {
  const ch = getState(b, "cozy:channel") ?? 0;
  let next = ch < TV_CHANNELS ? ch + 1 : 0; // after the last channel (or the secret one) it turns off
  if (next !== 0 && Math.random() < SECRET_CHANCE) next = TV_CHANNELS + 1;
  if (!setState(b, "cozy:channel", next)) return;
  const dim = b.dimension;
  sound(dim, "random.click", top(b, 0.5), { pitch: next ? 1.4 : 0.8, volume: 0.6 });
  if (next === TV_CHANNELS + 1) {
    sound(dim, "mob.wolf.bark", top(b, 0.5), { pitch: 1.3, volume: 0.6 });
    particle(dim, "minecraft:heart_particle", frontOf(b, 0.5, 1.1));
  } else if (next) {
    sound(dim, "note.bit", top(b, 0.5), { pitch: [1, 1.2, 1.5, 1.8][next - 1] ?? 1, volume: 0.5 });
  }
}

// ---------- Lamp ----------
function tapLamp(player, b) {
  const lit = !getState(b, "cozy:lit");
  if (setState(b, "cozy:lit", lit)) sound(b.dimension, "random.click", top(b, 0.5), { pitch: lit ? 1.3 : 0.9, volume: 0.6 });
}

// ---------- Mailbox ----------
const FLOWER_IDS = ["dandelion", "poppy", "blue_orchid", "allium", "azure_bluet", "red_tulip", "orange_tulip", "white_tulip",
  "pink_tulip", "oxeye_daisy", "cornflower", "lily_of_the_valley"].map(mc);
const COLORS = ["pink", "magenta", "light_blue", "lime", "yellow", "purple", "orange", "white"];
const PETS = ["cat_spawn_egg", "parrot_spawn_egg", "rabbit_spawn_egg", "fox_spawn_egg", "axolotl_bucket"].map(mc);
const DISCS = ["cat", "blocks", "chirp", "mall", "mellohi", "far"].map((d) => mc(`music_disc_${d}`));
const MAIL = [
  { id: "flower", n: [3, 6], w: 4 }, { id: mc("cookie"), n: [4, 8], w: 3 }, { id: "candle", n: [2, 4], w: 3 },
  { id: "carpet", n: [6, 10], w: 3 }, { id: "wool", n: [6, 10], w: 2 }, { id: mc("painting"), n: [1, 1], w: 2 },
  { id: mc("frame"), n: [2, 3], w: 1.5 }, { id: mc("glow_frame"), n: [1, 2], w: 1 }, { id: mc("lantern"), n: [2, 3], w: 2 },
  { id: mc("flower_pot"), n: [2, 3], w: 2 }, { id: mc("cake"), n: [1, 1], w: 1.5 }, { id: "furniture", n: [1, 1], w: 3 },
  { id: "dish", n: [1, 2], w: 2 }, { id: mc("firework_rocket"), n: [3, 5], w: 2 }, { id: mc("emerald"), n: [2, 4], w: 2 },
  { id: mc("golden_apple"), n: [1, 1], w: 1 }, { id: mc("name_tag"), n: [1, 1], w: 1 }, { id: "pet", n: [1, 1], w: 1 },
  { id: "disc", n: [1, 1], w: 0.6 }, { id: mc("diamond"), n: [1, 2], w: 0.6 },
];
function drawMail() {
  const g = weighted(MAIL);
  const n = rint(...g.n);
  const color = pick(COLORS);
  const id = {
    flower: pick(FLOWER_IDS), candle: mc(`${color}_candle`), carpet: mc(`${color}_carpet`), wool: mc(`${color}_wool`),
    furniture: pick(FURNITURE), dish: pick(DISHES), pet: pick(PETS), disc: pick(DISCS),
  }[g.id] ?? g.id;
  return [id, n];
}

function mailToday() {
  const day = world.getDay();
  const rec = getJSON("cozy:mail", null);
  return rec && rec.day === day ? rec : { day, got: [] };
}
function registerMailbox(k) {
  const boxes = getJSON("cozy:mailboxes", []);
  if (!boxes.includes(k)) { boxes.push(k); setJSON("cozy:mailboxes", boxes); }
}
// The flag is up while someone who's playing hasn't had today's mail yet.
function refreshFlag(b, rec = mailToday()) {
  const want = world.getAllPlayers().some((p) => !rec.got.includes(p.name));
  if (getState(b, "cozy:flag") === want) return;
  if (setState(b, "cozy:flag", want) && want) sound(b.dimension, "note.chime", top(b), { pitch: 1.5, volume: 0.6 });
}

function tapMailbox(player, b, held, k) {
  registerMailbox(k);
  const rec = mailToday();
  if (rec.got.includes(player.name)) {
    sound(b.dimension, "random.click", top(b), { pitch: 0.7, volume: 0.5 });
    try { player.onScreenDisplay.setActionBar("§7No more mail today. Come back tomorrow!"); } catch {}
    return;
  }
  rec.got.push(player.name);
  setJSON("cozy:mail", rec);
  const [id, n] = drawMail();
  sound(b.dimension, "random.chestopen", top(b), { pitch: 1.5, volume: 0.6 });
  system.runTimeout(() => sound(b.dimension, "note.chime", top(b), { pitch: 1.2 }), 4);
  particle(b.dimension, "minecraft:heart_particle", frontOf(b, 0.6, 1.1));
  popItem(b, id, n, 0.9);
  refreshFlag(b, rec);
}

world.afterEvents.playerPlaceBlock.subscribe(({ block }) => {
  if (block.typeId !== MAILBOX) return;
  const k = keyOf(block.dimension.id, block.location);
  registerMailbox(k);
  const { dimId, loc } = fromKey(k);
  system.run(() => {
    const b = blockAt(dimId, loc);
    if (b?.typeId === MAILBOX) refreshFlag(b);
  });
});

system.runInterval(() => {
  const boxes = getJSON("cozy:mailboxes", []);
  if (!boxes.length) return;
  const rec = mailToday();
  const keep = boxes.filter((k) => {
    const { dimId, loc } = fromKey(k);
    const b = blockAt(dimId, loc);
    if (!b) return true; // not loaded right now
    if (b.typeId !== MAILBOX) return false;
    refreshFlag(b, rec);
    return true;
  });
  if (keep.length !== boxes.length) setJSON("cozy:mailboxes", keep);
}, 40);

// ---------- Breaking furniture ----------
world.afterEvents.playerBreakBlock.subscribe(({ block, brokenBlockPermutation }) => {
  const id = brokenBlockPermutation?.type?.id;
  const k = keyOf(block.dimension.id, block.location);
  if (id === STOVE) { // whatever was in the pot comes back out
    const pots = getJSON("cozy:pots", {});
    for (const item of pots[k] || []) {
      try { block.dimension.spawnItem(new ItemStack(item, 1), top(block, 0.5)); } catch {}
    }
    delete pots[k];
    setJSON("cozy:pots", pots);
    cooking.delete(k);
  } else if (id === MAILBOX) {
    setJSON("cozy:mailboxes", getJSON("cozy:mailboxes", []).filter((m) => m !== k));
  } else if (id === FRIDGE && closeTimers.has(k)) {
    system.clearRun(closeTimers.get(k));
    closeTimers.delete(k);
  }
});

// ---------- Eating the dishes ----------
const DISH_EFFECTS = {
  "cozy:fruit_salad": [["speed", 400, 0]],
  "cozy:carrot_cake": [["night_vision", 1200, 0]],
  "cozy:rainbow_soup": [["regeneration", 120, 1], ["jump_boost", 400, 0]],
  "cozy:mud_pie": [["jump_boost", 600, 1]],
};
world.afterEvents.itemCompleteUse.subscribe(({ source, itemStack }) => {
  const fx = DISH_EFFECTS[itemStack?.typeId];
  if (!fx || source?.typeId !== "minecraft:player") return;
  for (const [effect, ticks, amplifier] of fx) {
    try { source.addEffect(effect, ticks, { amplifier, showParticles: false }); } catch {}
  }
  if (itemStack.typeId === "cozy:rainbow_soup") {
    for (let i = 0; i < 8; i++) particle(source.dimension, "minecraft:totem_particle", { ...source.location, y: source.location.y + 1 });
  }
});
