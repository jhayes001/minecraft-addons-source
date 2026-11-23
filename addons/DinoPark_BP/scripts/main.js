// Dino Park: set a dinosaur egg on the ground and a baby dino hatches out. It's yours from the start and follows
// you around. Feed it (plants for plant-eaters, meat for meat-eaters, fish for the pterodactyl) and it grows up
// (it also grows up by itself after a while). Grown-up big dinos can be ridden like horses; the Triceratops,
// Stegosaurus, Brachiosaurus and Ankylosaurus have room for two. The pterodactyl flies circles around you, lands
// next to you when you stop, and when it's grown up you can ride it: look where you want to fly.
// Crouch and tap a dino to make it wait, and again to make it follow.
// Every 2 or 3 Minecraft days, the ground shakes and a T. rex stomps through, knocking down trees in its path.
// It goes around anything anyone built, never hurts anyone, and gobbles up monsters it walks past.
// Testing (cheats on): /scriptevent dino:trex   brings the T. rex right away.
//                      /scriptevent dino:grow   grows up every baby dino near you.
import { world, system, ItemStack } from "@minecraft/server";

// Keep in the same order as SPECIES in tools/make_dinos.py (the egg's color is picked by this order).
const PLANTS = ["minecraft:wheat", "minecraft:wheat_seeds", "minecraft:apple", "minecraft:carrot", "minecraft:melon_slice",
  "minecraft:sweet_berries", "minecraft:beetroot", "minecraft:potato", "minecraft:sugar_cane", "minecraft:kelp",
  "minecraft:oak_leaves", "minecraft:birch_leaves", "minecraft:spruce_leaves", "minecraft:jungle_leaves",
  "minecraft:acacia_leaves", "minecraft:dark_oak_leaves", "minecraft:cherry_leaves", "minecraft:hay_block"];
const MEAT = ["minecraft:beef", "minecraft:cooked_beef", "minecraft:chicken", "minecraft:cooked_chicken", "minecraft:porkchop",
  "minecraft:cooked_porkchop", "minecraft:mutton", "minecraft:cooked_mutton", "minecraft:rabbit", "minecraft:cooked_rabbit",
  "minecraft:cod", "minecraft:salmon", "minecraft:cooked_cod", "minecraft:cooked_salmon", "minecraft:rotten_flesh"];
const FISH = ["minecraft:cod", "minecraft:salmon", "minecraft:cooked_cod", "minecraft:cooked_salmon", "minecraft:tropical_fish",
  "minecraft:beef", "minecraft:chicken", "minecraft:cooked_beef", "minecraft:cooked_chicken"];
const SPECIES = [
  { key: "triceratops", name: "Triceratops", food: PLANTS, ride: true, sound: ["mob.sniffer.idle", 0.7] },
  { key: "stegosaurus", name: "Stegosaurus", food: PLANTS, ride: true, sound: ["mob.sniffer.idle", 0.6] },
  { key: "brachiosaurus", name: "Brachiosaurus", food: PLANTS, ride: true, sound: ["mob.sniffer.happy", 0.5] },
  { key: "ankylosaurus", name: "Ankylosaurus", food: PLANTS, ride: true, sound: ["mob.sniffer.idle", 0.9] },
  { key: "allosaurus", name: "Allosaurus", food: MEAT, ride: true, sound: ["mob.ravager.ambient", 1.1] },
  { key: "parasaurolophus", name: "Parasaurolophus", food: PLANTS, ride: true, sound: ["note.didgeridoo", 0.75] },
  { key: "velociraptor", name: "Velociraptor", food: MEAT, ride: false, sound: ["mob.fox.ambient", 1.3] },
  { key: "pterodactyl", name: "Pterodactyl", food: FISH, ride: true, fly: true, sound: ["mob.parrot.idle", 0.6] },
];
const BY_ID = new Map(SPECIES.map((s, i) => [`dino:${s.key}`, { ...s, kind: i }]));
const EGG = "dino:egg";
const TREX = "dino:trex";
const PTERO = "dino:pterodactyl";
const DIMS = ["overworld", "nether", "the_end"];

const HATCH_TICKS = 200;           // 10 seconds from egg to baby
const GROW_AT = 5;                 // treats to grow up
const AUTO_GROW_TICKS = 3600;      // ...or one point every 3 minutes by itself (about 15 minutes to grow up)
const COME_BACK_DIST = 40;         // farther than this from its owner, a following dino catches up
// How far back each dino keeps from you (same as the follow stop distance in tools/make_dinos.py).
const FOLLOW_GAP = { triceratops: 7, stegosaurus: 7, brachiosaurus: 9, ankylosaurus: 6, allosaurus: 7,
  parasaurolophus: 7, velociraptor: 4, pterodactyl: 7 };
const NAMES = ["Spike", "Stompy", "Pebbles", "Rocky", "Fern", "Mossy", "Clover", "Biscuit", "Waffles", "Sprout",
  "Nugget", "Pickle", "Boulder", "Thunder", "Twig", "Sunny", "Maple", "Comet", "Ziggy", "Bubbles", "Dash", "Pip",
  "Coco", "Taco", "Noodle", "Scout", "Jelly", "Peanut", "Gizmo", "Ruby"];

// ---------- Little helpers ----------
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const yawOf = (dx, dz) => (Math.atan2(-dx, dz) * 180) / Math.PI;

function prop(e, k) {
  try {
    return e.getDynamicProperty(k);
  } catch {
    return undefined;
  }
}
function setProp(e, k, v) {
  try {
    e.setDynamicProperty(k, v);
  } catch {}
}
function alive(e) {
  try {
    return typeof e.isValid === "function" ? e.isValid() : e.isValid !== false;
  } catch {
    return false;
  }
}
function playAt(dim, id, loc, pitch = 1, volume = 1) {
  try {
    dim.playSound(id, loc, { pitch, volume });
  } catch {
    try {
      world.playSound(id, loc, { pitch, volume });
    } catch {}
  }
}
function particles(dim, id, loc, n = 1, spread = 0.5) {
  for (let i = 0; i < n; i++) {
    try {
      dim.spawnParticle(id, { x: loc.x + (Math.random() - 0.5) * spread * 2, y: loc.y + Math.random() * spread, z: loc.z + (Math.random() - 0.5) * spread * 2 });
    } catch {}
  }
}
function actionbar(player, text) {
  try {
    player.onScreenDisplay.setActionBar(text);
  } catch {}
}
function findPlayer(name) {
  return world.getAllPlayers().find((p) => p.name === name);
}
function speciesOf(e) {
  return BY_ID.get(e?.typeId);
}
const isAdult = (d) => prop(d, "dino:stage") === 1;
// Its name tag if it has one (renamed with a name tag from an anvil), otherwise the name it hatched with.
function dinoName(d) {
  let tag = "";
  try {
    tag = d.nameTag || "";
  } catch {}
  return tag || String(prop(d, "dino:name") ?? speciesOf(d)?.name ?? "Your dino");
}
function riders(e) {
  try {
    return e.getComponent("minecraft:rideable")?.getRiders?.() ?? [];
  } catch {
    return [];
  }
}
function isLeashed(e) {
  try {
    return !!e.getComponent("minecraft:leashable")?.isLeashed;
  } catch {
    return false;
  }
}
function allDinos() {
  const out = [];
  for (const d of DIMS) {
    let list = [];
    try {
      list = world.getDimension(d).getEntities({ families: ["dino"] });
    } catch {}
    for (const e of list) if (BY_ID.has(e.typeId)) out.push(e);
  }
  return out;
}
function onceFor(player, key) {
  if (player.getDynamicProperty?.(key)) return false;
  try {
    player.setDynamicProperty(key, true);
  } catch {}
  return true;
}

// ---------- Starter kit (no cheats needed): one egg of each kind and some food ----------
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      if (player.getDynamicProperty("dino:got_eggs")) return;
      const inv = player.getComponent("minecraft:inventory").container;
      const items = SPECIES.map((s) => [`dino:${s.key}_egg`, 1]).concat([["minecraft:wheat", 16], ["minecraft:beef", 8], ["minecraft:cod", 4]]);
      for (const [id, n] of items) {
        try {
          const leftover = inv.addItem(new ItemStack(id, n));
          if (leftover) player.dimension.spawnItem(leftover, player.location);
        } catch {}
      }
      player.setDynamicProperty("dino:got_eggs", true);
      player.sendMessage("§6You found a basket of dinosaur eggs! §fLook at the ground and hold the use button with an egg to set it down. A baby dino will hatch!");
      player.playSound("random.levelup", { pitch: 1.1 });
    } catch {}
  }, 130);
});

// ---------- Setting an egg down ----------
const SOFT = ["air", "short_grass", "tall_grass", "tallgrass", "fern", "snow_layer", "dandelion", "poppy",
  "tulip", "daisy", "orchid", "allium", "bluet", "cornflower", "lily_of_the_valley", "deadbush", "dead_bush", "light_block"];
const isSoft = (id) => SOFT.some((w) => id.includes(w));
const lastUse = new Map();

world.afterEvents.itemUse.subscribe(({ source: player, itemStack }) => {
  const m = /^dino:(\w+)_egg$/.exec(itemStack?.typeId ?? "");
  if (!m || player?.typeId !== "minecraft:player") return;
  const sp = BY_ID.get(`dino:${m[1]}`);
  if (!sp) return;
  const now = system.currentTick;
  if ((lastUse.get(player.name) ?? -99) > now - 10) return;
  lastUse.set(player.name, now);

  let hit;
  try {
    hit = player.getBlockFromViewDirection({ maxDistance: 7 });
  } catch {}
  if (!hit) {
    player.sendMessage("§eLook at the ground where you want to put the egg, then try again!");
    return;
  }
  const b = hit.block.location;
  const y = isSoft(hit.block.typeId) ? b.y : b.y + 1;
  const spot = { x: b.x + 0.5, y, z: b.z + 0.5 };
  try {
    const above = player.dimension.getBlock({ x: b.x, y, z: b.z });
    if (above && !isSoft(above.typeId) && !above.typeId.includes("water")) {
      player.sendMessage("§eThere's no room for the egg there. Try an open spot on the ground!");
      return;
    }
  } catch {}
  let egg;
  try {
    egg = player.dimension.spawnEntity(EGG, spot);
  } catch {
    player.sendMessage("§cThe egg couldn't be put there. Try somewhere else!");
    return;
  }
  try {
    egg.triggerEvent(`dino:kind_${sp.kind}`);
  } catch {}
  setProp(egg, "dino:kind", sp.kind);
  setProp(egg, "dino:owner", player.name);
  setProp(egg, "dino:age", 0);
  takeOne(player, itemStack.typeId);
  particles(player.dimension, "minecraft:villager_happy", { x: spot.x, y: spot.y + 0.3, z: spot.z }, 6, 0.4);
  playAt(player.dimension, "random.orb", spot, 1.4);
});

function takeOne(player, typeId) {
  try {
    if (String(player.getGameMode()).toLowerCase() === "creative") return;
  } catch {}
  try {
    const inv = player.getComponent("minecraft:inventory").container;
    const slot = player.selectedSlotIndex;
    const item = inv.getItem(slot);
    if (item?.typeId !== typeId) return;
    if (item.amount > 1) {
      item.amount -= 1;
      inv.setItem(slot, item);
    } else {
      inv.setItem(slot, undefined);
    }
  } catch {}
}

// ---------- Eggs wiggle, crack, and hatch ----------
system.runInterval(() => {
  for (const d of DIMS) {
    let eggs = [];
    try {
      eggs = world.getDimension(d).getEntities({ type: EGG });
    } catch {}
    for (const egg of eggs) {
      const age = (Number(prop(egg, "dino:age")) || 0) + 5;
      setProp(egg, "dino:age", age);
      if (age === 120 || age === 160 || age === 185) playAt(egg.dimension, "block.turtle_egg.crack", egg.location, 0.9);
      if (age >= HATCH_TICKS) hatch(egg);
    }
  }
}, 5);

function hatch(egg) {
  const dim = egg.dimension;
  const loc = { ...egg.location };
  const owner = String(prop(egg, "dino:owner") ?? "");
  const sp = SPECIES[Number(prop(egg, "dino:kind")) || 0] ?? SPECIES[0];
  try {
    egg.remove();
  } catch {}
  let dino;
  try {
    dino = dim.spawnEntity(`dino:${sp.key}`, { x: loc.x, y: loc.y + 0.1, z: loc.z });
  } catch {
    return;
  }
  const name = pick(NAMES);
  setProp(dino, "dino:owner", owner);
  setProp(dino, "dino:name", name);
  setProp(dino, "dino:stage", 0);
  setProp(dino, "dino:food", 0);
  setProp(dino, "dino:mode", "follow");
  try {
    dino.nameTag = name;
  } catch {}
  playAt(dim, "block.turtle_egg.break", loc, 1);
  playAt(dim, sp.sound[0], loc, sp.sound[1] * 1.6);
  particles(dim, "minecraft:villager_happy", { x: loc.x, y: loc.y + 0.2, z: loc.z }, 12, 0.6);
  const player = findPlayer(owner);
  if (!player) return;
  bond(dino, player);
  actionbar(player, `§6Meet ${name}, your baby ${sp.name}!`);
  if (onceFor(player, "dino:tip_hatch")) {
    player.sendMessage("§7Baby dinos grow up when you feed them (plant-eaters like wheat, apples and leaves; meat-eaters like meat; the pterodactyl likes fish), or after a while all by themselves. Crouch and tap a dino to make it wait or follow you. Grown-up big dinos can be ridden!");
  }
}

function bond(dino, player) {
  try {
    const t = dino.getComponent("minecraft:tameable");
    if (t && !t.isTamed) t.tame(player);
  } catch {}
}

// ---------- Growing up ----------
function growUp(dino) {
  if (isAdult(dino)) return;
  const sp = speciesOf(dino);
  setProp(dino, "dino:stage", 1);
  try {
    dino.triggerEvent("dino:grow_up");
  } catch {}
  const loc = dino.location;
  particles(dino.dimension, "minecraft:villager_happy", { x: loc.x, y: loc.y + 0.5, z: loc.z }, 16, 1.2);
  playAt(dino.dimension, "random.levelup", loc, 0.8);
  playAt(dino.dimension, sp.sound[0], loc, sp.sound[1]);
  const player = findPlayer(String(prop(dino, "dino:owner") ?? ""));
  if (!player) return;
  const name = dinoName(dino);
  actionbar(player, `§6${name} is all grown up!`);
  if (sp.fly) {
    if (onceFor(player, "dino:tip_fly")) {
      player.sendMessage(`§7When ${name} lands next to you, tap with an empty hand to ride. Look where you want to fly! Look up to take off and down to land. Crouch to hop off.`);
    }
  } else if (sp.ride && onceFor(player, "dino:tip_ride")) {
    player.sendMessage(`§7Tap ${name} with an empty hand to ride! Steer like a horse, and hold jump to leap. Crouch to hop off.`);
  }
}

function addFood(dino, points) {
  const food = (Number(prop(dino, "dino:food")) || 0) + points;
  setProp(dino, "dino:food", food);
  if (food >= GROW_AT) growUp(dino);
  return food;
}

// ---------- Tapping a dino: food, pets, wait/follow, riding ----------
const lastTap = new Map();
function tooSoon(dino, kind, ticks) {
  const now = system.currentTick;
  const key = `${dino.id}:${kind}`;
  if ((lastTap.get(key) ?? -999) > now - ticks) return true;
  lastTap.set(key, now);
  return false;
}

world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  const { player, target: dino } = ev;
  const sp = speciesOf(dino);
  if (!sp) return;
  const item = ev.itemStack?.typeId;
  if (item && sp.food.includes(item)) {
    ev.cancel = true;
    system.run(() => feed(player, dino, item));
    return;
  }
  if (player.isSneaking) {
    ev.cancel = true;
    system.run(() => toggleStay(player, dino));
    return;
  }
  if (item) return;                          // name tag, lead, and so on: Minecraft handles those
  if (sp.ride && isAdult(dino)) return;      // empty hand on a grown-up: hop on and ride!
  ev.cancel = true;
  system.run(() => pet(player, dino));
});

function hearts(dino, n) {
  const l = dino.location;
  particles(dino.dimension, "minecraft:heart_particle", { x: l.x, y: l.y + (isAdult(dino) ? 2 : 0.8), z: l.z }, n, 0.6);
}

function pet(player, dino) {
  if (tooSoon(dino, "pet", 8)) return;
  const sp = speciesOf(dino);
  hearts(dino, 4);
  playAt(dino.dimension, sp.sound[0], dino.location, sp.sound[1] * (isAdult(dino) ? 1 : 1.6));
  if (!isAdult(dino)) actionbar(player, growBar(dino));
}

function growBar(dino) {
  const food = Math.min(GROW_AT, Number(prop(dino, "dino:food")) || 0);
  return `§a${dinoName(dino)}: ${"■".repeat(food)}§7${"■".repeat(GROW_AT - food)}`;
}

function feed(player, dino, item) {
  if (tooSoon(dino, "feed", 10)) return;
  takeOne(player, item);
  hearts(dino, 6);
  playAt(dino.dimension, "random.eat", dino.location, isAdult(dino) ? 0.7 : 1.2);
  if (isAdult(dino)) return;
  addFood(dino, item === "minecraft:hay_block" ? 3 : 1);
  if (!isAdult(dino)) actionbar(player, growBar(dino));
}

function toggleStay(player, dino) {
  if (tooSoon(dino, "stay", 10)) return;
  const stay = prop(dino, "dino:mode") !== "stay";
  setProp(dino, "dino:mode", stay ? "stay" : "follow");
  try {
    dino.triggerEvent(stay ? "dino:stay" : "dino:follow");
  } catch {}
  if (!stay) {
    setProp(dino, "dino:owner", player.name);   // "follow" means follow whoever asked
    bond(dino, player);
  }
  const sp = speciesOf(dino);
  playAt(dino.dimension, sp.sound[0], dino.location, sp.sound[1] * (stay ? 0.9 : 1.2));
  particles(dino.dimension, stay ? "minecraft:villager_happy" : "minecraft:heart_particle",
    { x: dino.location.x, y: dino.location.y + 1, z: dino.location.z }, 4, 0.5);
  actionbar(player, stay ? `§7${dinoName(dino)} will wait here` : `§7${dinoName(dino)} will follow you`);
}

// ---------- Every 2 seconds: growing by itself, catching up with you, little noises ----------
system.runInterval(() => {
  for (const dino of allDinos()) {
    const sp = speciesOf(dino);
    if (!isAdult(dino)) {
      const t = (Number(prop(dino, "dino:growTicks")) || 0) + 40;
      if (t >= AUTO_GROW_TICKS) {
        setProp(dino, "dino:growTicks", 0);
        addFood(dino, 1);
      } else setProp(dino, "dino:growTicks", t);
    }
    if (Math.random() < 0.03) playAt(dino.dimension, sp.sound[0], dino.location, sp.sound[1] * (isAdult(dino) ? 1 : 1.6), 0.8);
    if (sp.fly || prop(dino, "dino:mode") === "stay" || riders(dino).length || isLeashed(dino)) continue;
    const owner = findPlayer(String(prop(dino, "dino:owner") ?? ""));
    if (!owner || owner.dimension.id !== dino.dimension.id) continue;
    if (dist3(owner.location, dino.location) > COME_BACK_DIST) {
      // Catch up, but land a comfortable distance away (on the side it was coming from), not on top of you.
      const a = Math.atan2(dino.location.z - owner.location.z, dino.location.x - owner.location.x);
      const gap = (FOLLOW_GAP[sp.key] ?? 6) * (isAdult(dino) ? 1 : 0.5);
      try {
        dino.teleport({ x: owner.location.x + Math.cos(a) * gap, y: owner.location.y, z: owner.location.z + Math.sin(a) * gap });
      } catch {}
    }
  }
}, 40);

// ---------- A bit faster with a rider on board (walking and following speeds stay the same) ----------
const RIDE_BOOST = 1;              // Speed effect level: 0 = +20%, 1 = +40%, 2 = +60%
system.runInterval(() => {
  for (const dino of allDinos()) {
    if (speciesOf(dino).fly || !riders(dino).length) continue;
    try {
      dino.addEffect("speed", 30, { amplifier: RIDE_BOOST, showParticles: false });
    } catch {}
  }
}, 10);

// ---------- Ground (shared by the pterodactyl and the T. rex) ----------
function blockAt(dim, x, y, z) {
  try {
    return dim.getBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) })?.typeId;
  } catch {
    return undefined;
  }
}
// Things you can fly or stomp through: air, water, little plants, snow.
const CLEAR = /(^|:)air$|water|short_grass|tall_grass|^minecraft:grass$|fern|flower|tulip|poppy|dandelion|orchid|allium|bluet|daisy|cornflower|lily_of_the_valley|snow_layer|sapling|light_block|petals|structure_void|wildflowers|leaf_litter|dead_bush|deadbush/;
const isClear = (id) => id === undefined || CLEAR.test(id);

// ---------- The pterodactyl: flies circles around you, lands when you stop, and you can ride it ----------
const ptero = new Map();          // id -> flight state
let pteros = [];

system.runInterval(() => {
  if (system.currentTick % 10 === 0) {
    pteros = [];
    for (const d of DIMS) {
      try {
        pteros.push(...world.getDimension(d).getEntities({ type: PTERO }));
      } catch {}
    }
  }
  for (const e of pteros) {
    if (!alive(e)) continue;
    try {
      flyStep(e);
    } catch {}
  }
}, 1);

function stateOf(e) {
  let st = ptero.get(e.id);
  if (!st) {
    st = { phase: "circle", angle: Math.random() * Math.PI * 2, circled: 0, still: 0, anchor: null, stillSince: 0, flying: null, rider: null };
    ptero.set(e.id, st);
  }
  return st;
}

function setFlying(e, st, on) {
  if (st.flying === on) return;
  st.flying = on;
  try {
    e.triggerEvent(on ? "dino:fly" : "dino:perch");
  } catch {}
}

// Top of the ground under (x, z), searching down from y + up.
function groundBelow(dim, x, z, y, up = 6, down = 24) {
  let above = blockAt(dim, x, y + up + 1, z);
  for (let yy = Math.floor(y) + up; yy >= Math.floor(y) - down; yy--) {
    const id = blockAt(dim, x, yy, z);
    if (id === undefined) return undefined;
    if (isClear(above) && !isClear(id)) return id.includes("lava") ? undefined : yy + 1;
    above = id;
  }
  return undefined;
}

function moveToward(e, from, to, maxStep) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  const k = len > maxStep ? maxStep / len : 1;
  const next = { x: from.x + dx * k, y: from.y + dy * k, z: from.z + dz * k };
  const yaw = Math.hypot(dx, dz) > 0.05 ? yawOf(dx, dz) : undefined;
  try {
    e.teleport(next, yaw === undefined ? {} : { rotation: { x: 0, y: yaw } });
  } catch {}
  return len;
}

function flyStep(e) {
  const st = stateOf(e);
  const adult = isAdult(e);
  const here = e.location;
  const dim = e.dimension;

  // Being ridden: it flies where the rider looks. Look up to take off, down (near the ground) to land.
  const r = riders(e)[0];
  if (r) {
    st.rider = r;
    rideStep(e, st, r);
    return;
  }
  if (st.rider) {         // just hopped off: float gently down instead of falling
    try {
      st.rider.addEffect("slow_falling", 120, { showParticles: false });
    } catch {}
    st.rider = null;
    st.phase = "circle";
    st.circled = 0;
  }

  const owner = findPlayer(String(prop(e, "dino:owner") ?? ""));
  const stay = prop(e, "dino:mode") === "stay";
  if (stay || !owner || owner.dimension.id !== dim.id) {
    landHere(e, st, here);
    return;
  }
  const o = owner.location;
  // Is the owner standing still? (hasn't gone more than half a block from where they stopped)
  if (!st.anchor || flat(st.anchor, o) > 0.6 || Math.abs(st.anchor.y - o.y) > 0.6) {
    st.anchor = { ...o };
    st.stillSince = system.currentTick;
  }
  st.still = system.currentTick - st.stillSince;

  if (dist3(o, here) > 48) {
    try {
      e.teleport({ x: o.x, y: o.y + 6, z: o.z });
    } catch {}
    st.phase = "circle";
    return;
  }
  const R = adult ? 6 : 3.5, H = adult ? 5 : 3.5, speed = adult ? 0.32 : 0.24;

  if (st.phase === "perched") {
    setFlying(e, st, false);
    if (flat(o, here) > 8 || (st.still === 0 && flat(o, here) > 5)) {
      st.phase = "circle";
      st.circled = 0;
    }
    return;
  }
  if (st.phase === "land") {
    setFlying(e, st, true);
    if (st.still === 0 && flat(o, st.spot) > 5) {          // you walked off: never mind, keep flying
      st.phase = "circle";
      return;
    }
    if (moveToward(e, here, st.spot, speed) < 0.3) {
      st.phase = "perched";
      setFlying(e, st, false);
      try {
        e.teleport(st.spot, { rotation: { x: 0, y: yawOf(o.x - st.spot.x, o.z - st.spot.z) } });
      } catch {}
    }
    return;
  }
  // Circling around you, a little above your head (higher over trees and hills).
  setFlying(e, st, true);
  st.circled++;
  st.angle += speed / R;
  const tx = o.x + Math.cos(st.angle) * R, tz = o.z + Math.sin(st.angle) * R;
  const g = groundBelow(dim, tx, tz, o.y + 12, 0, 20);
  const ty = Math.max(o.y + H + Math.sin(st.angle * 2) * 0.8, g === undefined ? -999 : g + 2.5);
  moveToward(e, here, { x: tx, y: ty, z: tz }, speed * 1.5);
  if (st.still > 60 && st.circled > 200) {                // you stopped: come down and land next to you
    const side = Math.atan2(here.z - o.z, here.x - o.x);
    const land = adult ? 4 : 2.5;              // a grown-up's wings are big: it lands a little farther off
    const sx = o.x + Math.cos(side) * land, sz = o.z + Math.sin(side) * land;
    const gy = groundBelow(dim, sx, sz, o.y, 3, 6);
    st.spot = { x: sx, y: gy ?? o.y, z: sz };
    st.phase = "land";
  }
}

function landHere(e, st, here) {
  if (st.phase === "perched") {
    setFlying(e, st, false);
    return;
  }
  const gy = groundBelow(e.dimension, here.x, here.z, here.y, 1, 64);
  if (gy === undefined) {
    setFlying(e, st, true);           // nowhere to land (over the void): just hover
    return;
  }
  st.spot = { x: here.x, y: gy, z: here.z };
  setFlying(e, st, true);
  if (moveToward(e, here, st.spot, 0.25) < 0.3) {
    st.phase = "perched";
    setFlying(e, st, false);
  }
}

const RIDE_SPEED = 0.55;    // blocks per tick (11 blocks a second)

function rideStep(e, st, rider) {
  let v;
  try {
    v = rider.getViewDirection();
  } catch {
    return;
  }
  let yaw;
  try {
    yaw = rider.getRotation().y;
  } catch {}
  const here = e.location;
  const below = blockAt(e.dimension, here.x, here.y - 0.6, here.z);
  const onGround = !isClear(below);
  if (onGround && v.y < 0.15) {        // sitting on the ground looking ahead or down: wait here
    setFlying(e, st, false);
    try {
      e.clearVelocity();
    } catch {}
    if (yaw !== undefined) try { e.setRotation({ x: 0, y: yaw }); } catch {}
    return;
  }
  setFlying(e, st, true);
  try {
    e.clearVelocity();
    e.applyImpulse({ x: v.x * RIDE_SPEED, y: v.y * RIDE_SPEED, z: v.z * RIDE_SPEED });
  } catch {}
  if (yaw !== undefined) try { e.setRotation({ x: 0, y: yaw }); } catch {}
  if (Math.random() < 0.04) playAt(e.dimension, "mob.phantom.flap", here, 0.8, 0.6);
}

// ---------- T. rex ----------
const TREX_SPEED = 0.12;          // blocks per tick (a slow, heavy stomp)
const TREX_START = 40;            // it appears this far away...
const TREX_PASS = 7;              // ...and walks past this far to one side of you
const TREX_GONE = 46;             // once it has walked past and is this far from everyone, it's gone
const TREX_MAX_TICKS = 20 * 160;
const TREX_DAYS = [2, 3];         // once every 2 or 3 Minecraft days
const DAY_START = 1000, DAY_END = 11000;
const ROAR_TICKS = 50;

// Things the T. rex knocks down as it stomps through.
const SMASH = /(^|:)(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_(log|wood)$|leaves|short_grass|tall_grass|fern|flower|tulip|poppy|dandelion|orchid|allium|bluet|daisy|cornflower|lily_of_the_valley|bush|sapling|vine|mushroom|cactus|sugar_cane|bamboo|snow_layer|^minecraft:pumpkin$|melon_block|^minecraft:melon$|azalea|dripleaf|moss_carpet|cocoa|glow_lichen|hanging_roots|pale_moss|leaf_litter|petals|wildflowers|dead_bush|deadbush|mangrove_roots|web/;
const isSmash = (id) => !!id && SMASH.test(id) && !/potted|stripped/.test(id);
// Anything like this means somebody built here: the T. rex goes around.
const BUILT = /planks|torch|lantern|door|glass|bed$|chest|barrel|crafting_table|furnace|fence|_wall|slab|stairs|wool|carpet|concrete|brick|bookshelf|sign|ladder|rail|bell|campfire|terracotta|quartz|smooth_|polished_|cobblestone|banner|flower_pot|lectern|anvil|stripped_|trapdoor|pressure_plate|button|lever|scaffolding|hay_block|composter|beehive|bee_nest|farmland|path|frame|bricks|_block$|candle|cake|crop|wheat|carrots|potatoes|beetroot|pane|shulker|portal|tnt|lamp|rod/;
const isBuilt = (id) => !!id && BUILT.test(id) && !/^minecraft:(grass_block|snow_block|moss_block|mud|melon_block|packed_mud|dirt_path)$/.test(id) && !isSmash(id);

let trex = null;
let trexRetry = 0;               // after a failed try (nowhere to come from), wait a minute

system.runInterval(() => {
  if (trex || system.currentTick < trexRetry) return;
  const day = world.getDay(), t = world.getTimeOfDay();
  let next = world.getDynamicProperty("dino:trexDay");
  if (typeof next !== "number") {
    next = day + 1;                       // a new world: give everyone a day to hatch their eggs first
    world.setDynamicProperty("dino:trexDay", next);
  }
  if (day < next || t < DAY_START || t > DAY_END + 2000) return;
  let at = world.getDynamicProperty("dino:trexAt");
  if (typeof at !== "number" || Math.floor(at / 24000) !== day) {
    at = day * 24000 + rint(Math.max(DAY_START, t + 200), Math.max(DAY_END, t + 400));
    world.setDynamicProperty("dino:trexAt", at);
  }
  if (day * 24000 + t < at) return;
  const target = choosePlayer(t > DAY_END);
  if (!target) return;
  if (startTrex(target)) world.setDynamicProperty("dino:trexDay", day + rint(TREX_DAYS[0], TREX_DAYS[1]));
  else trexRetry = system.currentTick + 1200;
}, 40);

function openSky(p) {
  const x = p.location.x, z = p.location.z, y0 = Math.floor(p.location.y) + 2;
  for (let y = y0; y < y0 + 20; y++) {
    const id = blockAt(p.dimension, x, y, z);
    if (id === undefined) return true;
    if (!isClear(id) && !isSmash(id)) return false;
  }
  return true;
}

function choosePlayer(anywhere) {
  const ok = world.getAllPlayers().filter((p) => {
    try {
      return p.dimension.id === "minecraft:overworld" && (anywhere || openSky(p));
    } catch {
      return false;
    }
  });
  return ok.length ? pick(ok) : undefined;
}

// Where the T. rex's feet would be at (x, z) coming from fromY: the ground (trees and plants don't count, it walks
// through those), at most 2 blocks up or 3 down, not into water deeper than 2, and nothing built from its feet
// up to its head. undefined if it can't go there. Results are kept for the visit.
function trexStand(v, x, z, fromY) {
  const bx = Math.floor(x), bz = Math.floor(z), fy = Math.round(fromY);
  const key = `${bx},${bz},${fy}`;
  if (v.cache.has(key)) return v.cache.get(key);
  let res, gy;
  const passable = (id) => id === undefined || isClear(id) || isSmash(id);
  let prev = passable(blockAt(v.dim, bx, fy + 5, bz));
  for (let y = fy + 4; y >= fy - 5; y--) {
    const id = blockAt(v.dim, bx, y, bz);
    if (id === undefined) break;
    const here = passable(id);
    if (prev && !here) {
      gy = y + 1;
      break;
    }
    prev = here;
  }
  if (gy !== undefined && gy - fromY <= 2.1 && fromY - gy <= 3.1) {
    let ok = !isBuilt(blockAt(v.dim, bx, gy - 1, bz));
    let water = 0;
    for (let dy = 0; ok && dy < 6; dy++) {
      const id = blockAt(v.dim, bx, gy + dy, bz);
      if (id === undefined) continue;
      if (id.includes("water")) water++;
      ok = (isClear(id) || isSmash(id)) && !id.includes("lava");
    }
    if (ok && water <= 2) res = gy;
  }
  v.cache.set(key, res);
  return res;
}

// Can it walk the next few blocks this way? Checks a path as wide as the T. rex, and looks out for builds.
function trexWayClear(v, heading) {
  const cx = Math.cos(heading), cz = Math.sin(heading);
  let y = v.pos.y;
  for (const d of [1.5, 3, 4.5, 6, 7.5]) {
    const s = trexStand(v, v.pos.x + cx * d, v.pos.z + cz * d, y);
    if (s === undefined) return false;
    for (const side of [-2.6, -1.3, 1.3, 2.6]) {
      if (trexStand(v, v.pos.x + cx * d - cz * side, v.pos.z + cz * d + cx * side, s) === undefined) return false;
    }
    y = s;
  }
  return true;
}

function trexHeading(v, desired) {
  const s = v.avoidSide;
  for (const off of [0, 20, -20, 40, -40, 60, -60, 85, -85, 110, -110, 140, -140, 180]) {
    const h = desired + ((off * s) * Math.PI) / 180;
    if (trexWayClear(v, h)) {
      if (off !== 0 && off !== 180) v.avoidSide = Math.sign(off * s);
      return h;
    }
  }
  return null;
}

function startTrex(target) {
  const dim = target.dimension, p = target.location;
  const cache = new Map();
  let start;
  for (let i = 0; i < 20 && !start; i++) {
    const a = Math.random() * Math.PI * 2;
    const x = p.x + Math.cos(a) * TREX_START, z = p.z + Math.sin(a) * TREX_START;
    const g = groundBelow(dim, x, z, p.y + 12, 0, 30);
    if (g === undefined) continue;
    const v = { dim, cache, pos: { x, y: g, z }, avoidSide: 1 };
    if (trexStand(v, x, z, g) === g) start = { x, y: g, z };
  }
  if (!start) return false;               // nowhere for it to come from (caves, ocean): try again later
  let entity;
  try {
    entity = dim.spawnEntity(TREX, start);
  } catch (e) {
    console.warn(`[Dino Park] Could not bring the T. rex: ${e}`);
    return false;
  }
  try {
    entity.triggerEvent("dino:walk");
  } catch {}
  // Aim to pass a few blocks to one side of the player, then keep going the same way.
  const side = Math.random() < 0.5 ? 1 : -1;
  const len = Math.max(0.01, flat(start, p));
  const dir = { x: (p.x - start.x) / len, z: (p.z - start.z) / len };
  const aim = { x: p.x - dir.z * side * TREX_PASS, z: p.z + dir.x * side * TREX_PASS };
  const heading = Math.atan2(aim.z - start.z, aim.x - start.x);
  trex = {
    entity, dim, cache, pos: { ...start }, heading, desired: heading, avoidSide: side, tick: 0, walked: 0,
    roar: 0, roared: 0, stuck: 0, targetId: target.id,
  };
  turn(trex);
  const hearers = world.getAllPlayers().filter((pl) => pl.dimension.id === dim.id && flat(pl.location, p) < 96);
  for (const pl of hearers) {
    actionbar(pl, "§cStomp... stomp... a T. rex is coming!");
    try {
      pl.playSound("mob.ravager.roar", { pitch: 0.5, volume: 0.6 });
    } catch {}
  }
  trex.run = system.runInterval(trexStep, 1);
  return true;
}

function turn(v) {
  try {
    v.entity.teleport(v.pos, { rotation: { x: 0, y: yawOf(Math.cos(v.heading), Math.sin(v.heading)) } });
  } catch {}
}

function endTrex() {
  if (!trex) return;
  try {
    system.clearRun(trex.run);
  } catch {}
  try {
    if (alive(trex.entity)) trex.entity.remove();
  } catch {}
  trex = null;
}

function shake(v, player, strength) {
  try {
    v.dim.runCommand(`camerashake add @a[name="${player.name}"] ${strength.toFixed(2)} 0.3 positional`);
  } catch {}
}

function roar(v) {
  v.roar = ROAR_TICKS;
  v.roared++;
  try {
    v.entity.triggerEvent("dino:roar");
  } catch {}
  playAt(v.dim, "mob.ravager.roar", v.pos, 0.55, 4);
  playAt(v.dim, "mob.enderdragon.growl", v.pos, 0.75, 1.5);
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== v.dim.id) continue;
    const d = flat(p.location, v.pos);
    if (d < 40) shake(v, p, Math.max(0.1, 0.5 - d / 100));
  }
}

function trexStep() {
  const v = trex;
  if (!v) return;
  if (!alive(v.entity)) {
    endTrex();
    return;
  }
  v.tick++;
  const players = world.getAllPlayers().filter((p) => p.dimension.id === v.dim.id);
  const nearest = players.reduce((m, p) => Math.min(m, flat(p.location, v.pos)), Infinity);

  // All done: it has walked on past everyone, or it's been too long.
  if (v.tick > TREX_MAX_TICKS || (v.walked > TREX_START && nearest > TREX_GONE) || players.length === 0) {
    endTrex();
    return;
  }
  // Roaring: standing still with its head up.
  if (v.roar > 0) {
    if (--v.roar === 0) {
      try {
        v.entity.triggerEvent("dino:walk");
      } catch {}
    }
    return;
  }
  // A big ROAR the first time it gets close to someone, and maybe once more on the way.
  if ((v.roared === 0 && nearest < 18) || (v.roared === 1 && v.walked > 30 && Math.random() < 0.004)) {
    roar(v);
    return;
  }

  // Which way? Straight on if the way is clear, otherwise around whatever is in the way (builds, cliffs, deep water).
  if (v.tick % 8 === 1) {
    const h = trexHeading(v, v.desired);
    if (h === null) {
      if (++v.stuck >= 3) {                   // boxed in: turn around and head back out
        v.desired += Math.PI;
        v.stuck = 0;
        v.cache.clear();
      }
      return;
    }
    v.stuck = 0;
    v.heading = h;
  }
  const cx = Math.cos(v.heading), cz = Math.sin(v.heading);
  const nx = v.pos.x + cx * TREX_SPEED, nz = v.pos.z + cz * TREX_SPEED;
  const gy = trexStand(v, nx, nz, v.pos.y);
  if (gy === undefined) {
    v.tick += 8 - (v.tick % 8);           // look for a new way next tick
    return;
  }
  v.pos = { x: nx, y: v.pos.y + Math.max(-0.25, Math.min(0.25, gy - v.pos.y)), z: nz };
  v.walked += TREX_SPEED;
  turn(v);

  if (v.tick % 4 === 0) smashAhead(v, cx, cz, gy);
  if (v.tick % 14 === 0) stomp(v, players);
  if (v.tick % 10 === 0) gobbleAndNudge(v, cx, cz, players);
}

// Knock down trees and plants in front of it (its head is about 5 blocks in front of its middle).
function smashAhead(v, cx, cz, gy) {
  let n = 0;
  for (const f of [4.5, 5.5]) {
    for (const s of [-2, -1, 0, 1, 2]) {
      const x = Math.floor(v.pos.x + cx * f - cz * s), z = Math.floor(v.pos.z + cz * f + cx * s);
      for (let y = gy; y <= gy + 8; y++) {
        const id = blockAt(v.dim, x, y, z);
        if (!isSmash(id)) continue;
        try {
          v.dim.runCommand(`setblock ${x} ${y} ${z} air destroy`);
          n++;
        } catch {}
        if (n > 40) return;
      }
    }
  }
  if (n > 6) playAt(v.dim, "random.break", v.pos, 0.6, 1.5);
}

function stomp(v, players) {
  playAt(v.dim, "mob.ravager.step", v.pos, 0.45, 3);
  for (const p of players) {
    const d = flat(p.location, v.pos);
    if (d < 24) shake(v, p, Math.max(0.05, 0.25 - d / 120));
  }
}

// Monsters it walks past get gobbled up; players and pets right in its way get a gentle nudge to the side.
function gobbleAndNudge(v, cx, cz, players) {
  const head = { x: v.pos.x + cx * 5, y: v.pos.y + 1, z: v.pos.z + cz * 5 };
  let monsters = [];
  try {
    monsters = v.dim.getEntities({ location: head, maxDistance: 4, families: ["monster"] });
  } catch {}
  for (const m of monsters) {
    try {
      if (m.typeId === "minecraft:warden" || m.typeId === "minecraft:ender_dragon" || m.typeId === "minecraft:wither") continue;
      particles(v.dim, "minecraft:large_explosion", m.location, 1, 0);
      m.kill();
      playAt(v.dim, "random.burp", head, 0.5, 2);
    } catch {}
  }
  for (const p of players) {
    const dx = p.location.x - v.pos.x, dz = p.location.z - v.pos.z;
    const ahead = dx * cx + dz * cz, side = -dx * cz + dz * cx;
    if (ahead > -4 && ahead < 6.5 && Math.abs(side) < 2.5 && Math.abs(p.location.y - v.pos.y) < 5) {
      const sx = -cz * Math.sign(side || 1), sz = cx * Math.sign(side || 1);
      try {
        p.applyKnockback(sx, sz, 1.2, 0.35);
      } catch {
        try {
          p.applyKnockback({ x: sx * 1.2, z: sz * 1.2 }, 0.35);
        } catch {}
      }
    }
  }
}

// ---------- Testing ----------
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  const who = ev.sourceEntity?.typeId === "minecraft:player" ? ev.sourceEntity : world.getAllPlayers()[0];
  if (ev.id === "dino:trex") {
    if (trex) endTrex();
    if (who && !startTrex(who)) who.sendMessage("§eThe T. rex couldn't find a way here. Try somewhere more open!");
  } else if (ev.id === "dino:grow") {
    for (const d of allDinos()) if (!who || dist3(d.location, who.location) < 32) growUp(d);
  }
});
