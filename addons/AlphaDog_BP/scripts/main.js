// Alpha Dog: set an Alpha Dog Egg on the ground and a little black puppy hatches out (Havana's
// idea, modeled after her dog Graham). The puppy is yours from the start. Feed it bones and meat
// and it grows: Puppy -> Small Dog -> Big Dog -> giant Alpha Dog you can ride like a horse.
// At every size it chases off monsters near you. It mostly hangs around you, but it's a little
// independent: sometimes it trots off to sniff around, then comes back (sometimes with a present).
// And a little mischievous: it gets the zoomies, and puppies especially like to chew on trees.
import { world, system, ItemStack, BlockPermutation } from "@minecraft/server";
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
const EXPLORE_MAX = 16;               // an exploring dog heads back once it's this far from you
const DANGER_RANGE = 10;              // monsters this close to you call an exploring dog back
const DOG_DANGER_RANGE = 8;           // monsters this close to an exploring dog send it back to you
const EXPLORE_CHANCE = 0.25;          // chance, every 1-2.5 minutes, that it trots off for a short walk
const DIMS = ["overworld", "nether", "the_end"];
const ALPHA_GONE_AFTER = 72000;
// Mischief. Chances are per check (every 5 seconds).
// Zoomies by size [Puppy, Small Dog, Big Dog, Alpha Dog]: puppies are bundles of energy, the Alpha has calmed down.
const ZOOMIES_IDLE_CHANCE = [0.04, 0.02, 0.01, 0.004];   // out of nowhere: about every 3 / 6 / 11 / 25 minutes
const ZOOMIES_AFTER_TREAT = [0.3, 0.18, 0.12, 0.06];
const ZOOMIES_COMEBACK = [0.6, 0.45, 0.35, 0.2];          // when it comes running back to you
const ZOOMIES_COOLDOWN = [1200, 2400, 3600, 7200];        // at least 1 / 2 / 3 / 6 minutes between zoomies
const CHEW_CHANCE = [0.5, 0.3, 0.15, 0.05];   // puppies chew the most; the Alpha is mostly too dignified
const CHEW_COOLDOWN = [1200, 2400];   // 1-2 minutes between chewing sessions
const NATURAL_LOG = /^minecraft:(?:(?:oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log|(?:crimson|warped)_stem)$/;
// Anything like this near a tree means it's somebody's build (or right next to one): hands off.
const BUILT = ["planks", "torch", "lantern", "door", "glass", "bed", "chest", "barrel", "crafting_table", "furnace",
  "fence", "_wall", "slab", "stairs", "wool", "carpet", "concrete", "brick", "bookshelf", "sign", "ladder", "rail",
  "bell", "campfire", "terracotta", "quartz", "smooth_", "polished_", "cobblestone", "banner", "flower_pot", "lectern",
  "anvil", "stripped_", "trapdoor", "pressure_plate", "button", "lever", "scaffolding", "hay_block", "composter", "beehive"];       // an Alpha nobody has seen for 3 in-game days of play counts as gone

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
const alive = (e) => {
  try {
    return typeof e.isValid === "function" ? e.isValid() : !!e.isValid;
  } catch {
    return false;
  }
};

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
  if (stage === ALPHA - 1 && food >= GROW_AT[stage]) {
    const alpha = otherAlpha(findPlayer(ownerOf(dog)) ?? { name: ownerOf(dog), getDynamicProperty: () => undefined }, dog);
    if (alpha) return `§6${dogName(dog)}§f is all grown up! §6${alpha.name}§f is the Alpha of your pack.`;
  }
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

// ---------- One Alpha per player ----------
// On each player: alphadog:alpha = {"id": dog id, "name": its name, "seen": world time it was last seen}.
function gameTime() {
  try {
    return world.getAbsoluteTime();
  } catch {
    try {
      return world.getDay() * 24000 + world.getTimeOfDay();
    } catch {
      return 0;
    }
  }
}
function alphaRecord(player) {
  try {
    const raw = player.getDynamicProperty("alphadog:alpha");
    return typeof raw === "string" ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}
function setAlphaRecord(player, dog) {
  try {
    player.setDynamicProperty("alphadog:alpha", dog ? JSON.stringify({ id: dog.id, name: dogName(dog), seen: gameTime() }) : undefined);
  } catch {}
}
// The player's current Alpha (other than this dog), if there is one: {name, here: loaded right now}.
function otherAlpha(player, dog) {
  const here = dogsOf(player.name).find((d) => d.id !== dog.id && stageOf(d) === ALPHA);
  if (here) return { name: dogName(here), here: true };
  const rec = alphaRecord(player);
  if (!rec || rec.id === dog.id) return undefined;
  if (gameTime() - (Number(rec.seen) || 0) > ALPHA_GONE_AFTER) return undefined;   // long gone
  return { name: rec.name || "another dog", here: false };
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
    const alpha = stage + 1 === ALPHA ? otherAlpha(player, dog) : undefined;
    if (alpha) {
      actionbar(player, `§6${name}§f is all grown up! But §6${alpha.name}§f is already your Alpha. There's only one Alpha in a pack!`);
      return;
    }
    if (stage + 1 === ALPHA && !roomForAlpha(dog)) {
      player.sendMessage(`§6${name}§f is ready to become an §6ALPHA DOG§f, but Alpha Dogs are HUGE! Take ${name} somewhere outside with lots of room, then give one more treat.`);
      bark(dog, 2);
      return;
    }
    grow(dog, player);
  } else {
    actionbar(player, progress(dog));
    maybeZoomies(dog, player, ZOOMIES_AFTER_TREAT[stage], true);
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
    if (isSitting(dog)) dog.triggerEvent("alphadog:sit");
  } catch {}
  const name = dogName(dog);
  const l = dog.location;
  particles(dog.dimension, "minecraft:villager_happy", { x: l.x, y: l.y + 0.2, z: l.z }, 16, 0.4 + height(dog) * 0.5);
  playSound(dog.dimension, "random.levelup", l, 1.0);
  bark(dog, stage === ALPHA ? 3 : 2);
  if (stage === ALPHA) {
    setAlphaRecord(player, dog);
    title(player, `§6${name} is an ALPHA DOG!`, "Tap with an empty hand to ride!");
    player.sendMessage(`§6WOW! ${name} grew into a giant ALPHA DOG! §fTap ${name} with an empty hand to climb on and ride. Crouch to hop off. Crouch and tap for ${name}'s menu.`);
  } else {
    title(player, `§6${name} grew!`, `Now a ${STAGES[stage]}!`);
    system.runTimeout(() => {
      try {
        maybeZoomies(dog, player, 0.6, true);
      } catch {}
    }, 50);
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
    isSitting(dog)
      ? { label: "Come on, let's go!", run: () => stand(player, dog) }
      : { label: "Sit and stay", run: () => sit(player, dog) },
    roam === "free"
      ? { label: "Stay close to me", run: () => setRoam(player, dog, "close") }
      : { label: "You can go explore", run: () => setRoam(player, dog, "free") },
    mischiefOn(dog)
      ? { label: "No more mischief", run: () => setMischief(player, dog, false) }
      : { label: "Mischief is OK", run: () => setMischief(player, dog, true) },
    { label: `§cSay goodbye to ${name}`, run: () => goodbye(player, dog) },
  ];
  let res;
  try {
    const form = new ActionFormData()
      .title(name)
      .body(`§6${name}§f is your §e${STAGES[stage]}§f.${isSitting(dog) ? ` ${name} is sitting and staying put.` : ""}\n\n${progress(dog)}\n\n${roam === "free"
        ? `${name} likes to explore a little but always comes back.`
        : `${name} is staying close to you.`} ${mischiefOn(dog)
        ? `${name} gets the zoomies and likes to chew on trees.`
        : `${name} is being extra good: no chewing on trees.`}\n\nTreats: bones and meat. Cooked meat counts double!`);
    for (const o of options) form.button(o.label);
    res = await form.show(player);
  } catch {
    return;
  }
  if (!res || res.canceled) return;
  lastTap.delete(`${dog.id}:pet`);
  options[res.selection]?.run();
}

function setRoam(player, dog, roam) {
  setProp(dog, "alphadog:roam", roam);
  const mode = prop(dog, "alphadog:mode");
  if (mode === "explore") exploreUntil.set(dog.id, 0); // ends on the next check
  else if (mode === "zoomies" || mode === "chewing") busyUntil.set(dog.id, 0);
  else if (!isSitting(dog)) applyRoam(dog);
  const name = dogName(dog);
  player.sendMessage(roam === "close"
    ? `§6${name}§f will stay close to you.`
    : `§6${name}§f might wander off to sniff around sometimes, but always comes back.`);
  bark(dog);
}
// ---------- Sit and stay ----------
const isSitting = (dog) => prop(dog, "alphadog:sitting") === true;
function sit(player, dog, quiet = false) {
  const mode = prop(dog, "alphadog:mode");
  if (mode === "explore") endExplore(dog, false);
  else if (mode === "zoomies" || mode === "chewing") endBusy(dog, player, true);
  setProp(dog, "alphadog:sitting", true);
  try {
    dog.triggerEvent("alphadog:sit");
  } catch {}
  if (quiet) return;
  player.sendMessage(`§6${dogName(dog)}§f sits and stays right here. Crouch and tap to call ${dogName(dog)} to come along again.`);
  hearts(dog, 2);
}
function stand(player, dog, quiet = false) {
  setProp(dog, "alphadog:sitting", false);
  applyRoam(dog);
  try {
    dog.triggerEvent(`alphadog:stage_${stageOf(dog)}`);   // puts the walking speed back
  } catch {}
  if (quiet) return;
  player.sendMessage(`§6${dogName(dog)}§f jumps up, ready to go!`);
  bark(dog, 2);
}

const mischiefOn = (dog) => prop(dog, "alphadog:mischief") !== "off";
function setMischief(player, dog, on) {
  setProp(dog, "alphadog:mischief", on ? "on" : "off");
  if (!on && prop(dog, "alphadog:mode") === "chewing") endBusy(dog, player, true);
  const name = dogName(dog);
  player.sendMessage(on
    ? `§6${name}§f wags happily. Trees, watch out!`
    : `§6${name}§f promises to be extra good. No more chewing on trees!`);
  bark(dog);
}

function applyRoam(dog) {
  if (isSitting(dog)) return;
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
      if (stageOf(dog) === ALPHA && alphaRecord(player)?.id === dog.id) setAlphaRecord(player, undefined);
      dog.remove();
    } catch {}
  }, 30);
}

// ---------- Hanging around, wandering off, and coming back ----------
const nextRoll = new Map();      // when each dog next thinks about exploring (memory only)
const exploreUntil = new Map();  // when an exploring dog heads back (memory only: after a reload it heads back)

// Like the real Graham: very food motivated. Holding a treat gets its full attention.
function holdingTreat(player) {
  try {
    const item = player.getComponent("minecraft:inventory").container.getItem(player.selectedSlotIndex);
    return !!item && TREATS[item.typeId] !== undefined;
  } catch {
    return false;
  }
}
function monstersNearDog(dog) {
  try {
    return dog.dimension.getEntities({ location: dog.location, maxDistance: DOG_DANGER_RANGE, families: ["monster"] }).length > 0;
  } catch {
    return false;
  }
}
const noticed = new Set();   // dogs that already perked up at the treat you're holding

function dangerNear(player) {
  try {
    return player.dimension.getEntities({ location: player.location, maxDistance: DANGER_RANGE, families: ["monster"] }).length > 0;
  } catch {
    return false;
  }
}

function startExplore(dog, player) {
  setProp(dog, "alphadog:mode", "explore");
  exploreUntil.set(dog.id, system.currentTick + Math.floor(rand(240, 500)));
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
  else if (busyUntil.has(dog.id)) endBusy(dog, player, true);
  try {
    dog.teleport(nearSpot(player), { dimension: player.dimension });
  } catch {
    return;
  }
  bark(dog, 2);
  actionbar(player, `§6${dogName(dog)}§f ${how}`);
  if (how.includes("running back")) system.runTimeout(() => {
      try {
        maybeZoomies(dog, player, ZOOMIES_COMEBACK[stageOf(dog)], true);
      } catch {}
    }, 20);
}

function giveGift(dog, player) {
  setProp(dog, "alphadog:gift", undefined);
  if (prop(dog, "alphadog:giftItem") === "stick") {
    setProp(dog, "alphadog:giftItem", undefined);
    try {
      dog.dimension.spawnItem(new ItemStack("minecraft:stick", 1), { x: dog.location.x, y: dog.location.y + 0.3, z: dog.location.z });
    } catch {
      return;
    }
    bark(dog);
    player.sendMessage(`§6${dogName(dog)}§f brought you a slobbery, chewed-up stick. Thanks?`);
    return;
  }
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

// ---------- Mischief: zoomies and chewing on trees ----------
const busyUntil = new Map();    // when zoomies or chewing ends (memory only: after a reload it just stops)
const nextZoomies = new Map();
const nextChew = new Map();
const chewTarget = new Map();   // dog id -> log location being chewed

function canBeSilly(dog, player) {
  return !isSitting(dog) && !isRidden(dog) && !isLeashed(dog) && (prop(dog, "alphadog:mode") ?? "follow") === "follow" &&
    dog.dimension.id === player.dimension.id && dist(dog.location, player.location) < 12 &&
    !dangerNear(player) && !monstersNearDog(dog);
}

// Racing around in mad little loops, kicking up dirt, then flopping down panting.
function maybeZoomies(dog, player, chance, ignoreCooldown = false) {
  const now = system.currentTick;
  if (!ignoreCooldown && now < (nextZoomies.get(dog.id) ?? 0)) return false;
  if (!canBeSilly(dog, player) || Math.random() >= chance) return false;
  setProp(dog, "alphadog:mode", "zoomies");
  busyUntil.set(dog.id, now + Math.floor(rand(80, 130)));
  nextZoomies.set(dog.id, now + ZOOMIES_COOLDOWN[stageOf(dog)]);
  try {
    dog.triggerEvent("alphadog:zoomies");
  } catch {}
  const a = Math.atan2(dog.location.z - player.location.z, dog.location.x - player.location.x);
  zoomers.set(dog.id, { dog, player, angle: a, dir: Math.random() < 0.5 ? 1 : -1, flipAt: now + Math.floor(rand(30, 60)) });
  bark(dog, 3);
  actionbar(player, `§6${dogName(dog)}§f has the ZOOMIES!`);
  return true;
}

// The running itself is done here, every tick, so it never depends on the mob AI deciding to move:
// fast loops around you, sometimes switching direction, hopping over 1-block bumps.
const zoomers = new Map();   // dog id -> { dog, player, angle, dir, flipAt }
const ZOOM_RADIUS = [2.2, 2.8, 3.4, 5.5];
const ZOOM_SPEED = [0.42, 0.48, 0.55, 0.7];   // blocks per tick (a sprinting player is about 0.28)
function solidAt(dim, l) {
  try {
    const id = dim.getBlock(l)?.typeId ?? "minecraft:air";
    return !isSoft(id) && !id.includes("water") && !id.includes("lava");
  } catch {
    return false;
  }
}
system.runInterval(() => {
  const now = system.currentTick;
  for (const [id, z] of zoomers) {
    const { dog, player } = z;
    let ok = false;
    try {
      ok = alive(dog) && prop(dog, "alphadog:mode") === "zoomies" && dog.dimension.id === player.dimension.id;
    } catch {}
    if (!ok) {
      zoomers.delete(id);
      continue;
    }
    const stage = stageOf(dog);
    const r = ZOOM_RADIUS[stage], speed = ZOOM_SPEED[stage];
    if (now >= z.flipAt) {
      z.dir = -z.dir;
      z.flipAt = now + Math.floor(rand(30, 70));
    }
    z.angle += z.dir * (speed / r);
    const c = player.location, l = dog.location;
    const wobble = 1 + Math.sin(now * 0.21) * 0.25;   // loops, not a perfect circle
    const target = { x: c.x + Math.cos(z.angle) * r * wobble, z: c.z + Math.sin(z.angle) * r * wobble };
    let dx = target.x - l.x, dz = target.z - l.z;
    const len = Math.hypot(dx, dz) || 1;
    const k = Math.min(speed, len) / len;
    dx *= k; dz *= k;
    let v = { x: 0, y: 0, z: 0 };
    try {
      v = dog.getVelocity();
    } catch {}
    let up = 0;
    const ahead = { x: l.x + dx * 3, y: l.y + 0.1, z: l.z + dz * 3 };
    let onGround = true;
    try {
      onGround = dog.isOnGround;
    } catch {}
    if (onGround && solidAt(dog.dimension, ahead) && !solidAt(dog.dimension, { x: ahead.x, y: ahead.y + 1, z: ahead.z })) up = 0.45;
    try {
      dog.applyImpulse({ x: dx - v.x, y: up, z: dz - v.z });
    } catch {}
    const yaw = (Math.atan2(-dx, dz) * 180) / Math.PI;
    try {
      dog.setRotation({ x: 0, y: yaw });
    } catch {}
    if (now % 3 === 0) {
      try {
        dog.dimension.spawnParticle("alphadog:dirt_kick", { x: l.x, y: l.y + 0.1, z: l.z });
      } catch {}
    }
  }
}, 1);
function zoomiesTick(dog) {
  if (Math.random() < 0.3) bark(dog);
}

function isBuilt(id) {
  return !id.startsWith("minecraft:") || BUILT.some((w) => id.includes(w));
}
// A real tree: leaves (or nether wart blocks) up top, and nothing built anywhere around it.
function isNaturalTree(dim, l) {
  let leaves = 0;
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++)
      for (let dy = 1; dy <= 9; dy++) {
        try {
          const id = dim.getBlock({ x: l.x + dx, y: l.y + dy, z: l.z + dz })?.typeId ?? "";
          if (id.includes("leaves") || id.includes("wart_block")) leaves++;
        } catch {}
      }
  if (leaves < 3) return false;
  for (let dx = -4; dx <= 4; dx++)
    for (let dz = -4; dz <= 4; dz++)
      for (let dy = -1; dy <= 5; dy++) {
        try {
          const id = dim.getBlock({ x: l.x + dx, y: l.y + dy, z: l.z + dz })?.typeId ?? "minecraft:air";
          if (isBuilt(id)) return false;
        } catch {}
      }
  return true;
}
// A natural log right next to the dog (it chews whatever tree it happens to be standing by).
function findLog(dog) {
  const reach = stageOf(dog) === ALPHA ? 3 : 2;
  const fx = Math.floor(dog.location.x), fy = Math.floor(dog.location.y), fz = Math.floor(dog.location.z);
  const found = [];
  for (let dx = -reach; dx <= reach; dx++)
    for (let dz = -reach; dz <= reach; dz++)
      for (let dy = 0; dy <= 1; dy++) {
        const l = { x: fx + dx, y: fy + dy, z: fz + dz };
        try {
          if (NATURAL_LOG.test(dog.dimension.getBlock(l)?.typeId ?? "")) found.push(l);
        } catch {}
      }
  found.sort((a, b) => Math.hypot(a.x + 0.5 - dog.location.x, a.z + 0.5 - dog.location.z) - Math.hypot(b.x + 0.5 - dog.location.x, b.z + 0.5 - dog.location.z));
  return found.find((l) => isNaturalTree(dog.dimension, l));
}

function tryChew(dog, player) {
  const log = findLog(dog);
  if (!log) return false;
  const now = system.currentTick;
  setProp(dog, "alphadog:mode", "chewing");
  chewTarget.set(dog.id, log);
  busyUntil.set(dog.id, now + Math.floor(rand(70, 110)));
  nextChew.set(dog.id, now + Math.floor(rand(CHEW_COOLDOWN[0], CHEW_COOLDOWN[1])));
  try {
    dog.triggerEvent("alphadog:chew");
  } catch {}
  try {
    dog.teleport(dog.location, { facingLocation: { x: log.x + 0.5, y: log.y + 0.5, z: log.z + 0.5 } });
  } catch {}
  if (Math.random() < 0.7) actionbar(player, `§6${dogName(dog)}§f is chewing on a tree! *gnaw gnaw*`);
  return true;
}
function chewTick(dog) {
  const log = chewTarget.get(dog.id);
  if (!log) return;
  const at = { x: log.x + 0.5, y: log.y + 0.5, z: log.z + 0.5 };
  try {
    dog.dimension.spawnParticle("alphadog:wood_chip", at);
  } catch {}
  playSound(dog.dimension, "dig.wood", at, 1.2 + rand(0, 0.3), 0.8);
}
// The log keeps its tree spot but the bark is chewed off, and out drop a stick or two.
function finishChew(dog) {
  const log = chewTarget.get(dog.id);
  chewTarget.delete(dog.id);
  if (!log) return;
  let block;
  try {
    block = dog.dimension.getBlock(log);
  } catch {}
  if (!block || !NATURAL_LOG.test(block.typeId)) return;
  let states = {};
  try {
    states = block.permutation.getAllStates();
  } catch {}
  try {
    block.setPermutation(BlockPermutation.resolve(block.typeId.replace("minecraft:", "minecraft:stripped_"), states));
  } catch {
    return;
  }
  const at = { x: log.x + 0.5, y: log.y + 0.3, z: log.z + 0.5 };
  playSound(dog.dimension, "hit.wood", at, 0.9);
  try {
    dog.dimension.spawnItem(new ItemStack("minecraft:stick", Math.random() < 0.5 ? 1 : 2), at);
  } catch {}
  if (Math.random() < 0.3) {
    setProp(dog, "alphadog:gift", true);
    setProp(dog, "alphadog:giftItem", "stick");
  }
}

function endBusy(dog, player, interrupted = false) {
  const mode = prop(dog, "alphadog:mode");
  busyUntil.delete(dog.id);
  zoomers.delete(dog.id);
  setProp(dog, "alphadog:mode", "follow");
  applyRoam(dog);
  if (mode === "zoomies") {
    playSound(dog.dimension, "mob.wolf.panting", dog.location, BARK_PITCH[stageOf(dog)]);
    hearts(dog, 2);
  } else if (mode === "chewing") {
    if (interrupted) chewTarget.delete(dog.id);
    else finishChew(dog);
  }
}

let checks = 0;
system.runInterval(() => {
  const now = system.currentTick;
  checks++;
  for (const dog of allDogs()) {
    const player = findPlayer(ownerOf(dog));
    if (!player) continue;
    if (checks % 10 === 1) {
      bond(dog, player);
      if (stageOf(dog) === ALPHA) {
        const rec = alphaRecord(player);
        if (!rec || rec.id === dog.id || gameTime() - (Number(rec.seen) || 0) > ALPHA_GONE_AFTER) setAlphaRecord(player, dog);
      }
    }
    const mode = prop(dog, "alphadog:mode");
    if (isSitting(dog)) {
      if (isRidden(dog)) stand(player, dog, true);
      else {
        if (prop(dog, "alphadog:gift") && dog.dimension.id === player.dimension.id && dist(dog.location, player.location) < 4) giveGift(dog, player);
        continue;
      }
    }
    if (isRidden(dog) || isLeashed(dog)) {             // tied to a fence post: it waits for you
      if (mode === "zoomies" || mode === "chewing") endBusy(dog, player, true);
      continue;
    }
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

    const treat = holdingTreat(player);
    if (treat && d < 20 && !noticed.has(dog.id)) {
      noticed.add(dog.id);
      actionbar(player, `§6${dogName(dog)}§f smells the treat! *sniff sniff*`);
      bark(dog);
    } else if (!treat) noticed.delete(dog.id);

    if (mode === "zoomies" || mode === "chewing") {
      const timeUp = now >= (busyUntil.get(dog.id) ?? 0);
      // Danger stops the fun. Holding a treat interrupts chewing (food wins), but not zoomies that a treat started.
      if (timeUp || dangerNear(player) || monstersNearDog(dog) || (mode === "chewing" && (treat || !mischiefOn(dog)))) {
        endBusy(dog, player, !timeUp);
      } else if (mode === "zoomies") zoomiesTick(dog);
      else chewTick(dog);
      continue;
    }
    if (mode === "explore") {
      const timeUp = now >= (exploreUntil.get(dog.id) ?? 0);
      if (timeUp || treat || d > EXPLORE_MAX || dangerNear(player) || monstersNearDog(dog)) endExplore(dog, timeUp && d <= EXPLORE_MAX);
    } else {
      if (!nextRoll.has(dog.id)) nextRoll.set(dog.id, now + Math.floor(rand(1200, 3000)));
      if (now >= nextRoll.get(dog.id)) {
        nextRoll.set(dog.id, now + Math.floor(rand(1200, 3000)));
        // A little aloof: sometimes wanders off on its own (not when you've asked it to stay close).
        if (prop(dog, "alphadog:roam") !== "close" && d < 8 && !treat && !dangerNear(player) && !monstersNearDog(dog) &&
          Math.random() < EXPLORE_CHANCE) startExplore(dog, player);
      }
      if (prop(dog, "alphadog:gift") && d < 4) giveGift(dog, player);
      else if (checks % 10 === 6 && !treat && canBeSilly(dog, player)) {
        if (!maybeZoomies(dog, player, ZOOMIES_IDLE_CHANCE[stageOf(dog)]) && mischiefOn(dog) && now >= (nextChew.get(dog.id) ?? 0) &&
          Math.random() < CHEW_CHANCE[stageOf(dog)]) tryChew(dog, player);
      }
    }
  }
}, 10);

// If you get hurt while your dog is off exploring, it comes running.
world.afterEvents.entityHurt.subscribe(({ hurtEntity, damageSource }) => {
  if (hurtEntity?.typeId !== "minecraft:player") return;
  const attacker = damageSource?.damagingEntity;
  if (!attacker || attacker.typeId === "minecraft:player" || attacker.typeId === DOG) return;
  for (const dog of dogsOf(hurtEntity.name)) {
    if (prop(dog, "alphadog:mode") !== "explore" || isSitting(dog)) continue;
    endExplore(dog, false);
    if (dog.dimension.id !== hurtEntity.dimension.id || dist(dog.location, hurtEntity.location) > 14) {
      comeBack(dog, hurtEntity, "heard you and came running to help!");
    }
  }
});
