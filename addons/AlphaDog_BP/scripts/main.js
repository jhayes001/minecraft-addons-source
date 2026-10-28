// Alpha Dog: set an Alpha Dog Egg on the ground and a little black puppy hatches out (Havana's
// idea, modeled after her dog Graham). The puppy is yours from the start. Feed it bones and meat
// and it grows: Puppy -> Small Dog -> Big Dog -> giant Alpha Dog you can ride like a horse.
// At every size it chases off monsters near you. It mostly hangs around you, but it's a little
// independent: sometimes it trots off to sniff around, then comes back (sometimes with a present).
import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const EGG_ITEM = "alphadog:dog_egg";
const EGG = "alphadog:egg";
const DOG = "alphadog:dog";
const HATCH_TICKS = 200;              // 10 seconds from egg to puppy
const STAGES = ["Puppy", "Small Dog", "Big Dog", "Alpha Dog"];
const ALPHA = STAGES.length - 1;
const GROW_AT = [5, 15, 30];          // total treat points to reach Small, Big, Alpha
const BARK_PITCH = [1.6, 1.3, 1.0, 0.72];
const COME_BACK_DIST = 36;            // farther than this, the dog comes running back to you
const EXPLORE_MAX = 26;               // an exploring dog heads back once it's this far from you
const DANGER_RANGE = 10;              // monsters this close to you call an exploring dog back
const DIMS = ["overworld", "nether", "the_end"];

// Treat points. Cooked meat counts double.
const TREATS = {
  "minecraft:bone": 1, "minecraft:rotten_flesh": 1,
  "minecraft:chicken": 1, "minecraft:cooked_chicken": 2,
  "minecraft:beef": 1, "minecraft:cooked_beef": 2,
  "minecraft:porkchop": 1, "minecraft:cooked_porkchop": 2,
  "minecraft:mutton": 1, "minecraft:cooked_mutton": 2,
  "minecraft:rabbit": 1, "minecraft:cooked_rabbit": 2,
};
const NAMES = ["Shadow", "Midnight", "Bear", "Onyx", "Bruno", "Diesel", "Duke", "Moose", "Tank", "Ziggy",
  "Bandit", "Pepper", "Licorice", "Raven", "Coco", "Rocky", "Boomer", "Ace", "Luna", "Nova",
  "Jet", "Inky", "Brownie", "Biscuit", "Pickles", "Waffles", "Nugget", "Buster", "Ollie", "Mochi"];
// Things a dog might bring back from a walk (weights: bigger = more often).
const GIFTS = [
  ["minecraft:stick", "a stick", 6], ["minecraft:bone", "a bone", 4], ["minecraft:feather", "a feather", 2],
  ["minecraft:poppy", "a flower", 2], ["minecraft:dandelion", "a flower", 2], ["minecraft:apple", "an apple", 2],
  ["minecraft:slime_ball", "a slimeball (eww!)", 1], ["minecraft:emerald", "an emerald!", 1], ["minecraft:diamond", "a DIAMOND!!", 0.3],
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// ---------- Saved data ----------
const prop = (e, k) => {
  try {
    return e.getDynamicProperty(k);
  } catch {
    return undefined;
  }
};
const setProp = (e, k, v) => {
  try {
    e.setDynamicProperty(k, v);
  } catch {}
};
// On each dog: alphadog:owner, alphadog:name, alphadog:stage (0-3), alphadog:food (treat points),
// alphadog:roam ("free" / "close"), alphadog:mode ("follow" / "explore"), alphadog:gift (bringing one back).
const dogName = (dog) => dog.nameTag || prop(dog, "alphadog:name") || "Your dog";
const stageOf = (dog) => Math.min(ALPHA, Math.max(0, Number(prop(dog, "alphadog:stage")) || 0));
const ownerOf = (dog) => String(prop(dog, "alphadog:owner") ?? "");
const findPlayer = (name) => world.getAllPlayers().find((p) => p.name === name);

function allDogs() {
  const out = [];
  for (const d of DIMS) {
    try {
      out.push(...world.getDimension(d).getEntities({ type: DOG }));
    } catch {}
  }
  return out;
}
const dogsOf = (name) => allDogs().filter((d) => ownerOf(d) === name);

// ---------- Effects ----------
function playSound(dim, id, loc, pitch = 1, volume = 1) {
  try {
    dim.playSound(id, loc, { pitch, volume });
  } catch {}
}
function particles(dim, id, loc, n, spread = 0.5) {
  for (let i = 0; i < n; i++) {
    try {
      dim.spawnParticle(id, { x: loc.x + rand(-spread, spread), y: loc.y + rand(0, spread * 2), z: loc.z + rand(-spread, spread) });
    } catch {}
  }
}
function height(dog) {
  return [0.45, 0.7, 1.0, 2.2][stageOf(dog)];
}
function bark(dog, times = 1) {
  const pitch = BARK_PITCH[stageOf(dog)];
  for (let i = 0; i < times; i++) system.runTimeout(() => playSound(dog.dimension, "mob.wolf.bark", dog.location, pitch + rand(-0.05, 0.05)), 1 + i * 6);
}
function hearts(dog, n = 4) {
  const h = height(dog);
  particles(dog.dimension, "minecraft:heart_particle", { x: dog.location.x, y: dog.location.y + h, z: dog.location.z }, n, 0.3 + h * 0.2);
}
function actionbar(player, msg) {
  try {
    player.onScreenDisplay.setActionBar(msg);
  } catch {}
}
function title(player, t, subtitle) {
  try {
    player.onScreenDisplay.setTitle(t, { subtitle, fadeInDuration: 5, stayDuration: 70, fadeOutDuration: 20 });
  } catch {}
}

// "Growing: ||||||||......" bar toward the next size.
function progress(dog) {
  const stage = stageOf(dog);
  if (stage === ALPHA) return `§6${dogName(dog)}§f is a full-grown §6ALPHA DOG§f!`;
  const food = Number(prop(dog, "alphadog:food")) || 0;
  const from = stage === 0 ? 0 : GROW_AT[stage - 1], to = GROW_AT[stage];
  const filled = Math.round(Math.max(0, Math.min(1, (food - from) / (to - from))) * 20);
  return `§6${dogName(dog)}§f  §a${"|".repeat(filled)}§8${"|".repeat(20 - filled)}§f  to ${STAGES[stage + 1]}`;
}

// ---------- Owner ----------
function bond(dog, player) {
  try {
    const t = dog.getComponent("minecraft:tameable");
    if (t && !t.isTamed) t.tame(player);
  } catch {}
}
function isRidden(dog) {
  try {
    return (dog.getComponent("minecraft:rideable")?.getRiders?.() ?? []).length > 0;
  } catch {
    return false;
  }
}

function isLeashed(dog) {
  try {
    return !!dog.getComponent("minecraft:leashable")?.isLeashed;
  } catch {
    return false;
  }
}

// ---------- Starter kit (no cheats needed) ----------
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      if (player.getDynamicProperty("alphadog:got_egg")) return;
      const inv = player.getComponent("minecraft:inventory").container;
      for (const [id, n] of [[EGG_ITEM, 1], ["minecraft:bone", 6]]) {
        try {
          const leftover = inv.addItem(new ItemStack(id, n));
          if (leftover) player.dimension.spawnItem(leftover, player.location);
        } catch {}
      }
      player.setDynamicProperty("alphadog:got_egg", true);
      player.sendMessage("§6You found an Alpha Dog Egg and some bones! §fLook at the ground and hold the use button with the egg to set it down. A puppy will hatch!");
      player.playSound("random.levelup", { pitch: 1.2 });
    } catch {}
  }, 110);
});

// ---------- Setting an egg down ----------
const SOFT = ["air", "short_grass", "tall_grass", "tallgrass", "fern", "snow_layer", "dandelion", "poppy",
  "tulip", "daisy", "orchid", "allium", "bluet", "cornflower", "lily_of_the_valley", "deadbush", "dead_bush", "light_block"];
const isSoft = (id) => SOFT.some((w) => id.includes(w));
const lastUse = new Map();

world.afterEvents.itemUse.subscribe(({ source: player, itemStack }) => {
  if (itemStack?.typeId !== EGG_ITEM || player?.typeId !== "minecraft:player") return;
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
  setProp(egg, "alphadog:owner", player.name);
  setProp(egg, "alphadog:age", 0);
  takeOne(player, EGG_ITEM);
  player.sendMessage("§6The egg is wiggling! §fSomething inside is going §7*yip yip*§f...");
  particles(player.dimension, "minecraft:villager_happy", { x: spot.x, y: spot.y + 0.3, z: spot.z }, 6, 0.4);
  playSound(player.dimension, "random.orb", spot, 1.4);
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
      const age = (Number(prop(egg, "alphadog:age")) || 0) + 5;
      setProp(egg, "alphadog:age", age);
      const loc = egg.location;
      if (age === 120 || age === 160 || age === 185) {
        playSound(egg.dimension, "block.turtle_egg.crack", loc, 1.2);
        playSound(egg.dimension, "mob.wolf.whine", loc, 1.8, 0.6);
      }
      if (age >= HATCH_TICKS) hatch(egg);
    }
  }
}, 5);

function hatch(egg) {
  const dim = egg.dimension;
  const loc = { ...egg.location };
  const owner = String(prop(egg, "alphadog:owner") ?? "");
  try {
    egg.remove();
  } catch {}
  let dog;
  try {
    dog = dim.spawnEntity(DOG, { x: loc.x, y: loc.y + 0.1, z: loc.z });
  } catch {
    return;
  }
  const name = pick(NAMES);
  try {
    dog.triggerEvent("alphadog:stage_0");
    dog.triggerEvent("alphadog:mode_free");
  } catch {}
  setProp(dog, "alphadog:owner", owner);
  setProp(dog, "alphadog:name", name);
  setProp(dog, "alphadog:stage", 0);
  setProp(dog, "alphadog:food", 0);
  setProp(dog, "alphadog:roam", "free");
  setProp(dog, "alphadog:mode", "follow");
  try {
    dog.nameTag = name;
  } catch {}
  nextRoll.set(dog.id, system.currentTick + Math.floor(rand(1200, 2400)));

  particles(dim, "minecraft:villager_happy", { x: loc.x, y: loc.y + 0.2, z: loc.z }, 12, 0.6);
  playSound(dim, "random.levelup", loc, 1.4);
  bark(dog, 2);
  hearts(dog, 5);
  const player = findPlayer(owner);
  if (!player) return;
  bond(dog, player);
  title(player, "§6Your egg hatched!", `Meet ${name}, your new puppy!`);
  player.sendMessage(`§6Your egg hatched! §fMeet §6${name}§f, your new puppy! ${name} is all yours and will follow you around and protect you from monsters.`);
  player.sendMessage(`§7Feed ${name} bones and meat to help them grow (cooked meat counts double). Tap ${name} to pet. Crouch and tap for ${name}'s menu. Rename with a name tag from an anvil!`);
}

// ---------- Tapping the dog: treats, pets, riding, and the menu ----------
world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  const { player, target: dog } = ev;
  if (dog?.typeId !== DOG) return;
  const item = ev.itemStack?.typeId;
  const mine = ownerOf(dog) === player.name;
  if (!mine) {
    ev.cancel = true;
    system.run(() => notYours(player, dog, item));
    return;
  }
  if (item && TREATS[item] !== undefined) {
    ev.cancel = true;
    system.run(() => feed(player, dog, item));
    return;
  }
  if (player.isSneaking) {
    ev.cancel = true;
    system.run(() => openMenu(player, dog));
    return;
  }
  if (item) return;                         // name tag, lead, and so on: Minecraft handles those
  if (stageOf(dog) === ALPHA) return;       // empty hand on an Alpha Dog: hop on and ride!
  ev.cancel = true;
  system.run(() => pet(player, dog));
});

// Stops one long press from eating a whole stack. Each kind of tap has its own timer, so you
// can pet and then feed right away.
const lastTap = new Map();
function tooSoon(dog, kind, ticks) {
  const now = system.currentTick;
  const key = `${dog.id}:${kind}`;
  if ((lastTap.get(key) ?? -999) > now - ticks) return true;
  lastTap.set(key, now);
  return false;
}

function notYours(player, dog, item) {
  if (tooSoon(dog, `other:${player.name}`, 10)) return;
  const owner = ownerOf(dog) || "someone";
  const name = dogName(dog);
  if (item && TREATS[item] !== undefined) player.sendMessage(`§6${name}§f sniffs the treat politely, but only takes treats from ${owner}.`);
  else if (stageOf(dog) === ALPHA) player.sendMessage(`§6${name}§f is ${owner}'s Alpha Dog. Only ${owner} can ride ${name}!`);
  else player.sendMessage(`§fThis is ${owner}'s dog, §6${name}§f! ${name} wags hello.`);
  bark(dog);
}

function pet(player, dog) {
  if (tooSoon(dog, "pet", 8)) return;
  hearts(dog, 5);
  if (Math.random() < 0.5) bark(dog);
  else playSound(dog.dimension, "mob.wolf.panting", dog.location, BARK_PITCH[stageOf(dog)]);
  actionbar(player, progress(dog));
}

function feed(player, dog, item) {
  if (tooSoon(dog, "feed", 10)) return;
  takeOne(player, item);
  const stage = stageOf(dog);
  const food = (Number(prop(dog, "alphadog:food")) || 0) + TREATS[item];
  setProp(dog, "alphadog:food", food);
  playSound(dog.dimension, "random.eat", dog.location, BARK_PITCH[stage]);
  hearts(dog, 3);
  const name = dogName(dog);
  if (stage === ALPHA) {
    actionbar(player, `§6${name}§f loved that! ${name} is already the biggest Alpha Dog there is.`);
    return;
  }
  if (food >= GROW_AT[stage]) {
    if (stage + 1 === ALPHA && !roomForAlpha(dog)) {
      player.sendMessage(`§6${name}§f is ready to become an §6ALPHA DOG§f, but Alpha Dogs are HUGE! Take ${name} somewhere outside with lots of room, then give one more treat.`);
      bark(dog, 2);
      return;
    }
    grow(dog, player);
  } else {
    actionbar(player, progress(dog));
  }
}

// Alpha Dogs are about 3 blocks wide and tall, so make sure there's room before growing.
function roomForAlpha(dog) {
  const l = dog.location;
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = 0; dy <= 2; dy++) {
        try {
          const b = dog.dimension.getBlock({ x: Math.floor(l.x) + dx, y: Math.floor(l.y) + dy, z: Math.floor(l.z) + dz });
          if (b && !isSoft(b.typeId) && !b.typeId.includes("water")) return false;
        } catch {}
      }
  return true;
}

function grow(dog, player) {
  const stage = stageOf(dog) + 1;
  setProp(dog, "alphadog:stage", stage);
  try {
    dog.triggerEvent(`alphadog:stage_${stage}`);
  } catch {}
  const name = dogName(dog);
  const l = dog.location;
  particles(dog.dimension, "minecraft:villager_happy", { x: l.x, y: l.y + 0.2, z: l.z }, 16, 0.4 + height(dog) * 0.5);
  playSound(dog.dimension, "random.levelup", l, 1.0);
  bark(dog, stage === ALPHA ? 3 : 2);
  if (stage === ALPHA) {
    title(player, `§6${name} is an ALPHA DOG!`, "Tap with an empty hand to ride!");
    player.sendMessage(`§6WOW! ${name} grew into a giant ALPHA DOG! §fTap ${name} with an empty hand to climb on and ride. Crouch to hop off. Crouch and tap for ${name}'s menu.`);
  } else {
    title(player, `§6${name} grew!`, `Now a ${STAGES[stage]}!`);
    player.sendMessage(`§6${name} grew into a ${STAGES[stage]}! §fKeep the treats coming. ${progress(dog)}`);
  }
}

// ---------- Menu (crouch + tap) ----------
async function openMenu(player, dog) {
  if (tooSoon(dog, "menu", 10)) return;
  const name = dogName(dog);
  const stage = stageOf(dog);
  const roam = prop(dog, "alphadog:roam") === "close" ? "close" : "free";
  const options = [
    { label: `Pet ${name}`, run: () => pet(player, dog) },
    roam === "free"
      ? { label: "Stay close to me", run: () => setRoam(player, dog, "close") }
      : { label: "You can go explore", run: () => setRoam(player, dog, "free") },
    { label: `§cSay goodbye to ${name}`, run: () => goodbye(player, dog) },
  ];
  let res;
  try {
    res = await new ActionFormData()
      .title(name)
      .body(`§6${name}§f is your §e${STAGES[stage]}§f.\n\n${progress(dog)}\n\n${roam === "free"
        ? `${name} likes to explore a little but always comes back.`
        : `${name} is staying close to you.`}\n\nTreats: bones and meat. Cooked meat counts double!`)
      .button(options[0].label).button(options[1].label).button(options[2].label)
      .show(player);
  } catch {
    return;
  }
  if (!res || res.canceled) return;
  lastTap.delete(`${dog.id}:pet`);
  options[res.selection]?.run();
}

function setRoam(player, dog, roam) {
  setProp(dog, "alphadog:roam", roam);
  if (prop(dog, "alphadog:mode") === "explore") exploreUntil.set(dog.id, 0); // ends on the next check
  else applyRoam(dog);
  const name = dogName(dog);
  player.sendMessage(roam === "close"
    ? `§6${name}§f will stay close to you.`
    : `§6${name}§f might wander off to sniff around sometimes, but always comes back.`);
  bark(dog);
}
function applyRoam(dog) {
  try {
    dog.triggerEvent(prop(dog, "alphadog:roam") === "close" ? "alphadog:mode_close" : "alphadog:mode_free");
  } catch {}
}

async function goodbye(player, dog) {
  const name = dogName(dog);
  let res;
  try {
    res = await new ActionFormData()
      .title("Say goodbye?")
      .body(`Are you sure? §6${name}§f will run off to find a new family and won't come back.`)
      .button(`§cYes, say goodbye to ${name}`)
      .button(`§2No! ${name} stays with me!`)
      .show(player);
  } catch {
    return;
  }
  if (!res || res.canceled || res.selection !== 0) {
    hearts(dog, 6);
    bark(dog, 2);
    return;
  }
  bark(dog, 2);
  hearts(dog, 8);
  player.sendMessage(`§6${name}§f gives you one last big lick and runs off to find a new family. Bye-bye, ${name}!`);
  system.runTimeout(() => {
    try {
      particles(dog.dimension, "minecraft:villager_happy", dog.location, 12, 0.6);
      dog.remove();
    } catch {}
  }, 30);
}

// ---------- Hanging around, wandering off, and coming back ----------
const nextRoll = new Map();      // when each dog next thinks about exploring (memory only)
const exploreUntil = new Map();  // when an exploring dog heads back (memory only: after a reload it heads back)

function dangerNear(player) {
  try {
    return player.dimension.getEntities({ location: player.location, maxDistance: DANGER_RANGE, families: ["monster"] }).length > 0;
  } catch {
    return false;
  }
}

function startExplore(dog, player) {
  setProp(dog, "alphadog:mode", "explore");
  exploreUntil.set(dog.id, system.currentTick + Math.floor(rand(400, 900)));
  try {
    dog.triggerEvent("alphadog:go_explore");
  } catch {}
  if (Math.random() < 0.6) actionbar(player, `§6${dogName(dog)}§f trotted off to sniff around...`);
}

function endExplore(dog, natural) {
  setProp(dog, "alphadog:mode", "follow");
  exploreUntil.delete(dog.id);
  applyRoam(dog);
  if (natural && Math.random() < 0.45) setProp(dog, "alphadog:gift", true);
}

function nearSpot(player) {
  const a = rand(0, Math.PI * 2);
  const l = player.location;
  return { x: l.x + Math.cos(a) * 2, y: l.y, z: l.z + Math.sin(a) * 2 };
}

function comeBack(dog, player, how) {
  if (prop(dog, "alphadog:mode") === "explore") endExplore(dog, false);
  try {
    dog.teleport(nearSpot(player), { dimension: player.dimension });
  } catch {
    return;
  }
  bark(dog, 2);
  actionbar(player, `§6${dogName(dog)}§f ${how}`);
}

function giveGift(dog, player) {
  setProp(dog, "alphadog:gift", undefined);
  const total = GIFTS.reduce((s, g) => s + g[2], 0);
  let r = Math.random() * total;
  const gift = GIFTS.find((g) => (r -= g[2]) < 0) ?? GIFTS[0];
  try {
    dog.dimension.spawnItem(new ItemStack(gift[0], 1), { x: dog.location.x, y: dog.location.y + 0.3, z: dog.location.z });
  } catch {
    return;
  }
  bark(dog);
  player.sendMessage(`§6${dogName(dog)}§f came back from exploring and brought you ${gift[1]}`);
}

let checks = 0;
system.runInterval(() => {
  const now = system.currentTick;
  checks++;
  for (const dog of allDogs()) {
    const player = findPlayer(ownerOf(dog));
    if (!player) continue;
    if (checks % 10 === 1) bond(dog, player);
    if (isRidden(dog) || isLeashed(dog)) continue;   // tied to a fence post: it waits for you
    const sameDim = dog.dimension.id === player.dimension.id;
    const d = sameDim ? dist(dog.location, player.location) : Infinity;

    if (!sameDim) {
      comeBack(dog, player, "followed you through the portal!");
      continue;
    }
    if (d > COME_BACK_DIST) {
      comeBack(dog, player, "came running back to you!");
      continue;
    }

    if (prop(dog, "alphadog:mode") === "explore") {
      const timeUp = now >= (exploreUntil.get(dog.id) ?? 0);
      if (timeUp || d > EXPLORE_MAX || dangerNear(player)) endExplore(dog, timeUp && d <= EXPLORE_MAX);
    } else {
      if (!nextRoll.has(dog.id)) nextRoll.set(dog.id, now + Math.floor(rand(600, 1800)));
      if (now >= nextRoll.get(dog.id)) {
        nextRoll.set(dog.id, now + Math.floor(rand(900, 2400)));
        // A little aloof: sometimes wanders off on its own (not when you've asked it to stay close).
        if (prop(dog, "alphadog:roam") !== "close" && d < 12 && !dangerNear(player) && Math.random() < 0.4) startExplore(dog, player);
      }
      if (prop(dog, "alphadog:gift") && d < 4) giveGift(dog, player);
    }
  }
}, 10);

// If you get hurt while your dog is off exploring, it comes running.
world.afterEvents.entityHurt.subscribe(({ hurtEntity, damageSource }) => {
  if (hurtEntity?.typeId !== "minecraft:player") return;
  const attacker = damageSource?.damagingEntity;
  if (!attacker || attacker.typeId === "minecraft:player" || attacker.typeId === DOG) return;
  for (const dog of dogsOf(hurtEntity.name)) {
    if (prop(dog, "alphadog:mode") !== "explore") continue;
    endExplore(dog, false);
    if (dog.dimension.id !== hurtEntity.dimension.id || dist(dog.location, hurtEntity.location) > 14) {
      comeBack(dog, hurtEntity, "heard you and came running to help!");
    }
  }
});
