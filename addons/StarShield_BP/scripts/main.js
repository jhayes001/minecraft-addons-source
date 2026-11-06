// Star Shield: Sora, Dalia and Yuna are a pop group who secretly protect the world from Grumbles (goofy shadow
// demons that show up at night) with their songs.
// - The Lightstick (given on first join) calls them. The first time, all three arrive to meet you.
// - Give each girl her favorite gift and she becomes your friend and follows you: Sora loves apples, Dalia loves
//   cookies (or cake or pie), Yuna loves flowers. Friends fight Grumbles and monsters near you and can't get hurt.
// - Tap a girl to say hi. Crouch and tap for her menu (follow me / wait here).
// - Tap the Concert Stage: your friends hop on and put on a show, and a glowing Star Shield covers the area until
//   morning. No Grumbles or monsters get in.
// - Episode 1, "The Missing Stars" (Adventure Ticket): a 15-20 minute story with clues to read, puzzles and the
//   Grumble King. See the EPISODE 1 section at the bottom.
// Testing (cheats on): /scriptevent starshield:grumbles   brings 3 Grumbles near you.
//                      /scriptevent starshield:skip       jumps Episode 1 to the next part.
import { world, system, ItemStack, BlockPermutation } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const IDOL = "starshield:idol";
const GRUMBLE = "starshield:grumble";
const STAGE = "starshield:concert_stage";
const LIGHTSTICK = "starshield:lightstick";
const SHARD = "starshield:star_shard";
const FLOWER_RE = /dandelion|poppy|orchid|allium|bluet|tulip|daisy|cornflower|lily_of_the_valley|sunflower|lilac|rose_bush|peony|torchflower|pink_petals|wildflowers/;

// Index = entity variant. Keep in sync with GIRLS in tools/make_starshield.py.
const IDOLS = [
  {
    name: "Sora", color: "§b", likes: "apples", gift: (id) => /(^|:)(apple|golden_apple|enchanted_golden_apple)$/.test(id),
    hello: ["Hi! Ready for an adventure?", "Star Shield, let's go!", "I'll keep you safe. Promise!", "Did you see that last dance move? Perfect!"],
    thanks: "An apple! My favorite! Let's be friends!",
    wrong: "Sora smiles politely. She'd love an apple!",
    hit: "minecraft:note_particle",
  },
  {
    name: "Dalia", color: "§6", likes: "cookies", gift: (id) => /(^|:)(cookie|cake|pumpkin_pie)$/.test(id),
    hello: ["Knock knock! ...I forgot the rest.", "Is that a snack? Please say it's a snack.", "Boom! Ba-dum tss!", "Wanna see me dance? Whoa, whoops!"],
    thanks: "COOKIES! You're my best friend now. Officially!",
    wrong: "Dalia sniffs it. Hmm... got any cookies?",
    hit: "minecraft:critical_hit_emitter",
  },
  {
    name: "Yuna", color: "§9", likes: "flowers", gift: (id) => FLOWER_RE.test(id),
    hello: ["Oh! Um... hi.", "The stars are pretty tonight.", "Have you met any foxes? I love foxes.", "I'm glad you're here."],
    thanks: "A flower... for me? Thank you. I'll be your friend.",
    wrong: "Yuna looks shy. She really loves flowers.",
    hit: "minecraft:knockback_roar_particle",
  },
];

const NIGHT_START = 13000, NIGHT_END = 23000;
const SHIELD_RADIUS = 24;
const GRUMBLE_CAP = 3;               // Grumbles near one player at once
const GRUMBLE_CHANCE = 0.35;         // chance per check (every 10 s) to bring one more while under the cap
const CALL_DISTANCE = 12;            // the Lightstick calls friends who are farther than this
const FAR = 40;                      // friends this far away (or in another dimension) blink back to you
const SHOW_TICKS = 200;              // a concert lasts 10 seconds
const DIMS = ["overworld", "nether", "the_end"];

// ---------- Little helpers ----------
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const alive = (e) => {
  try {
    return typeof e.isValid === "function" ? e.isValid() : e.isValid !== false;
  } catch {
    return false;
  }
};
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
function getJSON(holder, k, fallback) {
  try {
    const raw = holder.getDynamicProperty(k);
    if (typeof raw === "string") return JSON.parse(raw);
  } catch {}
  return fallback;
}
function setJSON(holder, k, v) {
  try {
    holder.setDynamicProperty(k, v === undefined ? undefined : JSON.stringify(v));
  } catch {}
}
function fire(e, ev) {
  try {
    e.triggerEvent(ev);
  } catch {}
}
function particle(dim, id, loc) {
  try {
    dim.spawnParticle(id, loc);
  } catch {}
}
function burst(dim, id, loc, n, spread) {
  for (let i = 0; i < n; i++) {
    particle(dim, id, { x: loc.x + rand(-spread, spread), y: loc.y + rand(0, spread * 1.5), z: loc.z + rand(-spread, spread) });
  }
}
function sound(dim, id, loc, pitch = 1, volume = 1) {
  try {
    dim.playSound(id, loc, { pitch, volume });
  } catch {}
}
function note(player, msg) {
  try {
    player.onScreenDisplay.setActionBar(msg);
  } catch {}
}
function findPlayer(name) {
  return world.getAllPlayers().find((p) => p.name === name);
}
function timeOfDay() {
  try {
    return world.getTimeOfDay();
  } catch {
    return 6000;
  }
}
function absTime() {
  try {
    return world.getAbsoluteTime();
  } catch {
    try {
      return world.getDay() * 24000 + world.getTimeOfDay();
    } catch {
      return system.currentTick;
    }
  }
}
const isNight = () => {
  const t = timeOfDay();
  return t >= NIGHT_START && t < NIGHT_END;
};

// ---------- Who's who ----------
const girlOf = (e) => Number(prop(e, "starshield:girl")) || 0;
const ownerOf = (e) => String(prop(e, "starshield:owner") ?? "");
const isFriend = (e) => prop(e, "starshield:friend") === true;
const modeOf = (e) => String(prop(e, "starshield:mode") ?? "follow");     // follow / stay

function allIdols() {
  const out = [];
  for (const d of DIMS) {
    try {
      out.push(...world.getDimension(d).getEntities({ type: IDOL }));
    } catch {}
  }
  return out;
}
const idolsOf = (name) => allIdols().filter((e) => ownerOf(e) === name);
// Which girls this player has made friends with (saved on the player, so it survives a girl being unloaded).
const friendsOf = (player) => getJSON(player, "starshield:friends", [false, false, false]);
function saveFriend(player, girl) {
  const f = friendsOf(player);
  f[girl] = true;
  setJSON(player, "starshield:friends", f);
}

// Puts the girl in the right behavior group for what she's doing.
function settle(e) {
  if (!isFriend(e)) fire(e, "starshield:visit");
  else if (modeOf(e) === "stay") fire(e, "starshield:stay");
  else fire(e, "starshield:befriend");
}

// ---------- Starter kit ----------
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      if (player.getDynamicProperty("starshield:got_kit")) return;
      const inv = player.getComponent("minecraft:inventory").container;
      for (const id of [LIGHTSTICK, STAGE]) {
        try {
          const left = inv.addItem(new ItemStack(id, 1));
          if (left) player.dimension.spawnItem(left, player.location);
        } catch {}
      }
      player.setDynamicProperty("starshield:got_kit", true);
      player.sendMessage("§dYou got a Star Shield Lightstick and a Concert Stage! §fHold up the Lightstick (use button) to call Star Shield.");
    } catch {}
  }, 130);
});

// ---------- The Lightstick ----------
const lastUse = new Map();
world.afterEvents.itemUse.subscribe(({ source: player, itemStack }) => {
  if (itemStack?.typeId !== LIGHTSTICK || player?.typeId !== "minecraft:player") return;
  const now = system.currentTick;
  if ((lastUse.get(player.name) ?? -99) > now - 20) return;
  lastUse.set(player.name, now);
  useLightstick(player);
});

function useLightstick(player) {
  const dim = player.dimension;
  if (girlsMissing(player)) {
    note(player, "§fStar Shield is missing! Read your clue to find them.");
    return;
  }
  burst(dim, "minecraft:totem_particle", { x: player.location.x, y: player.location.y + 1.6, z: player.location.z }, 10, 0.5);
  sound(dim, "random.orb", player.location, 1.6);
  const mine = idolsOf(player.name);
  const here = new Set(mine.map(girlOf));
  const missing = [0, 1, 2].filter((g) => !here.has(g));
  const firstTime = !player.getDynamicProperty("starshield:met");

  // Girls who aren't loaded anywhere (or have never come) arrive now.
  if (missing.length) {
    const friends = friendsOf(player);
    const spots = arrivalSpots(player, missing.length);
    missing.forEach((g, i) => arrive(player, g, spots[i], friends[g]));
    if (firstTime) {
      player.setDynamicProperty("starshield:met", true);
      note(player, "§dStar Shield is here!");
      player.sendMessage("§dMeet §bSora§d, §6Dalia§d and §9Yuna§d! §fGive each one her favorite to make friends: " +
        "§bSora§f loves apples, §6Dalia§f loves cookies, §9Yuna§f loves flowers.");
      for (const e of idolsOf(player.name)) wave(e, 60);
    }
  }
  // Friends who are far away come running (or blink over).
  for (const e of mine) {
    if (!isFriend(e)) continue;
    if (modeOf(e) === "stay") {
      setProp(e, "starshield:mode", "follow");
      settle(e);
    }
    if (e.dimension.id !== dim.id || dist(e.location, player.location) > CALL_DISTANCE) blinkTo(e, player);
  }
}

// Spots in a little arc in front of the player.
function arrivalSpots(player, n) {
  let v = { x: 0, z: 1 };
  try {
    const d = player.getViewDirection();
    const len = Math.hypot(d.x, d.z) || 1;
    v = { x: d.x / len, z: d.z / len };
  } catch {}
  const out = [];
  for (let i = 0; i < n; i++) {
    const side = (i - (n - 1) / 2) * 1.6;
    out.push({ x: player.location.x + v.x * 3.5 - v.z * side, y: player.location.y, z: player.location.z + v.z * 3.5 + v.x * side });
  }
  return out;
}

function arrive(player, girl, spot, friend) {
  let e;
  try {
    e = player.dimension.spawnEntity(IDOL, spot);
  } catch {
    return undefined;
  }
  fire(e, `starshield:girl_${girl}`);
  setProp(e, "starshield:girl", girl);
  setProp(e, "starshield:owner", player.name);
  setProp(e, "starshield:friend", !!friend);
  setProp(e, "starshield:mode", "follow");
  setProp(e, "starshield:born", absTime());
  try {
    e.nameTag = IDOLS[girl].name;
  } catch {}
  if (friend) bond(e, player);
  settle(e);
  burst(player.dimension, "minecraft:totem_particle", { x: spot.x, y: spot.y + 0.5, z: spot.z }, 14, 0.6);
  sound(player.dimension, "random.levelup", spot, 1.5, 0.7);
  return e;
}

function bond(e, player) {
  try {
    const t = e.getComponent("minecraft:tameable");
    if (t && !t.isTamed) t.tame(player);
  } catch {}
}

function blinkTo(e, player) {
  const [spot] = arrivalSpots(player, 1);
  burst(e.dimension, "minecraft:totem_particle", { x: e.location.x, y: e.location.y + 0.5, z: e.location.z }, 6, 0.4);
  try {
    e.teleport({ x: spot.x + rand(-1, 1), y: spot.y, z: spot.z + rand(-1, 1) }, { dimension: player.dimension });
  } catch {}
  burst(player.dimension, "minecraft:totem_particle", { x: spot.x, y: spot.y + 0.5, z: spot.z }, 8, 0.5);
}

function wave(e, ticks) {
  fire(e, "starshield:wave_start");
  system.runTimeout(() => {
    if (alive(e)) fire(e, "starshield:wave_end");
  }, ticks);
}

// ---------- Tapping a girl: gifts, hello, menu ----------
world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  const { player, target } = ev;
  if (target?.typeId !== IDOL) return;
  ev.cancel = true;
  const item = ev.itemStack?.typeId;
  const sneaking = player.isSneaking;
  system.run(() => tap(player, target, item, sneaking));
});

const lastTap = new Map();
function tooSoon(key, ticks) {
  const now = system.currentTick;
  if ((lastTap.get(key) ?? -999) > now - ticks) return true;
  lastTap.set(key, now);
  return false;
}

function tap(player, e, item, sneaking) {
  if (!alive(e) || tooSoon(`${player.name}:${e.id}`, 8)) return;
  const g = girlOf(e), girl = IDOLS[g];
  if (ownerOf(e) !== player.name) {
    note(player, `${girl.color}${girl.name}§f waves hi! She's ${ownerOf(e) || "someone"}'s friend.`);
    wave(e, 40);
    return;
  }
  if (prop(e, "starshield:mode") === "show") return;
  if (prop(e, "starshield:caged") === true) {
    note(player, `${girl.color}${girl.name}: §fHelp! Beat the Grumbles and solve the puzzle!`);
    wave(e, 40);
    return;
  }
  if (item && girl.gift(item)) return giveGift(player, e, item);
  if (item && !isFriend(e) && /apple|cookie|cake|pie|bread|carrot|melon|berries|flower|tulip|poppy|dandelion/.test(item)) {
    note(player, girl.wrong);
    return;
  }
  if (sneaking && isFriend(e)) return openMenu(player, e);
  wave(e, 40);
  sound(e.dimension, "random.pop", e.location, 1.4);
  if (isFriend(e)) note(player, `${girl.color}${girl.name}: §f${pick(girl.hello)}`);
  else note(player, `${girl.color}${girl.name}§f would love some ${girl.likes}!`);
}

function giveGift(player, e, item) {
  const g = girlOf(e), girl = IDOLS[g];
  takeOne(player, item);
  burst(e.dimension, "minecraft:heart_particle", { x: e.location.x, y: e.location.y + 1.4, z: e.location.z }, 5, 0.5);
  sound(e.dimension, "random.burp", e.location, 1.6, 0.5);
  if (isFriend(e)) return;                                      // a treat for a friend: just hearts
  setProp(e, "starshield:friend", true);
  setProp(e, "starshield:mode", "follow");
  saveFriend(player, g);
  bond(e, player);
  settle(e);
  wave(e, 60);
  sound(e.dimension, "random.levelup", e.location, 1.6);
  burst(e.dimension, "minecraft:totem_particle", { x: e.location.x, y: e.location.y + 1, z: e.location.z }, 16, 0.7);
  note(player, `${girl.color}${girl.name}: §f${girl.thanks}`);
  const f = friendsOf(player);
  if (f.every(Boolean) && !player.getDynamicProperty("starshield:all_friends")) {
    player.setDynamicProperty("starshield:all_friends", true);
    player.sendMessage("§dAll of Star Shield are your friends now! §fThey'll fight Grumbles with you at night. " +
      "Tap your Concert Stage and they'll put on a show that keeps your home safe until morning. Crouch and tap a girl for her menu.");
  }
}

function takeOne(player, typeId) {
  try {
    if (String(player.getGameMode()).toLowerCase() === "creative") return;
  } catch {}
  try {
    const inv = player.getComponent("minecraft:inventory").container;
    const slot = player.selectedSlotIndex;
    const it = inv.getItem(slot);
    if (it?.typeId !== typeId) return;
    if (it.amount > 1) {
      it.amount -= 1;
      inv.setItem(slot, it);
    } else inv.setItem(slot, undefined);
  } catch {}
}

function openMenu(player, e) {
  const girl = IDOLS[girlOf(e)];
  const staying = modeOf(e) === "stay";
  const form = new ActionFormData().title(girl.name).button(staying ? "Come with me!" : "Wait here").button("Dance for me!");
  form.show(player).then((r) => {
    if (r.canceled || !alive(e)) return;
    if (r.selection === 0) {
      setProp(e, "starshield:mode", staying ? "follow" : "stay");
      settle(e);
      wave(e, 30);
    } else if (r.selection === 1) {
      dance([e], 100);
    }
  }).catch(() => {});
}

// ---------- Fighting ----------
// Each girl's hits get her own sparkle, and Grumbles go flying.
world.afterEvents.entityHurt.subscribe(({ hurtEntity, damageSource }) => {
  const hitter = damageSource?.damagingEntity;
  if (hitter?.typeId !== IDOL || !alive(hurtEntity)) return;
  const girl = IDOLS[girlOf(hitter)];
  const loc = hurtEntity.location;
  burst(hurtEntity.dimension, girl.hit, { x: loc.x, y: loc.y + 0.5, z: loc.z }, 4, 0.4);
  sound(hurtEntity.dimension, "note.bell", loc, rand(1.2, 1.8), 0.6);
  try {
    const dx = loc.x - hitter.location.x, dz = loc.z - hitter.location.z, len = Math.hypot(dx, dz) || 1;
    knock(hurtEntity, dx / len, dz / len, 1.2, 0.35);
  } catch {}
});

// The Lightstick is a weapon too: it hits mobs with a burst of star sparkles, but never breaks blocks.
const heldId = (player) => {
  try {
    return player.getComponent("minecraft:inventory").container.getItem(player.selectedSlotIndex)?.typeId;
  } catch {
    return undefined;
  }
};
world.afterEvents.entityHurt.subscribe(({ hurtEntity, damageSource }) => {
  const p = damageSource?.damagingEntity;
  if (p?.typeId !== "minecraft:player" || heldId(p) !== LIGHTSTICK || !alive(hurtEntity)) return;
  const loc = hurtEntity.location;
  burst(hurtEntity.dimension, "minecraft:totem_particle", { x: loc.x, y: loc.y + 0.6, z: loc.z }, 6, 0.4);
  sound(hurtEntity.dimension, "note.chime", loc, rand(1.4, 2.0), 0.7);
});
world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  if (ev.itemStack?.typeId === LIGHTSTICK || heldId(ev.player) === LIGHTSTICK) ev.cancel = true;
});

function knock(e, dx, dz, h, v) {
  try {
    e.applyKnockback(dx, dz, h, v);
  } catch {
    try {
      e.applyKnockback({ x: dx * h, z: dz * h }, v);
    } catch {}
  }
}

world.afterEvents.entityDie.subscribe(({ deadEntity }) => {
  let id, dim, loc;
  try {
    id = deadEntity.typeId; dim = deadEntity.dimension; loc = { ...deadEntity.location };
  } catch {
    return;
  }
  if (id !== GRUMBLE) return;
  poof(dim, loc);
  if (kingDied(deadEntity, dim, loc)) return;
  if (Math.random() < 0.35) {
    try {
      dim.spawnItem(new ItemStack(SHARD, 1), loc);
    } catch {}
  }
});

// A beaten Grumble bursts into a cloud of confetti (the starshield:confetti particle in the resource pack).
function poof(dim, loc) {
  particle(dim, "starshield:confetti", { x: loc.x, y: loc.y + 0.3, z: loc.z });
  burst(dim, "minecraft:villager_happy", { x: loc.x, y: loc.y + 0.3, z: loc.z }, 4, 0.4);
  sound(dim, "random.pop", loc, 0.8);
  sound(dim, "firework.twinkle", loc, 1.4, 0.5);
  sound(dim, "note.chime", loc, rand(1.2, 2.0), 0.8);
}

// ---------- Grumbles come out at night ----------
system.runInterval(() => {
  if (!isNight()) return;
  for (const player of world.getAllPlayers()) {
    try {
      if (player.dimension.id !== "minecraft:overworld" || !player.getDynamicProperty("starshield:met")) continue;
      if (shieldAt(player.dimension.id, player.location) || nearAdventure(player)) continue;
      const near = player.dimension.getEntities({ type: GRUMBLE, location: player.location, maxDistance: 32 });
      if (near.length >= GRUMBLE_CAP || Math.random() > GRUMBLE_CHANCE) continue;
      bringGrumble(player);
    } catch {}
  }
}, 200);

// A spot 12-18 blocks away on the ground (at about the player's height), not inside a Star Shield.
function bringGrumble(player, min = 12, max = 18) {
  const dim = player.dimension;
  for (let tries = 0; tries < 8; tries++) {
    const a = rand(0, Math.PI * 2), r = rand(min, max);
    const x = Math.floor(player.location.x + Math.cos(a) * r), z = Math.floor(player.location.z + Math.sin(a) * r);
    const y = groundNear(dim, x, Math.floor(player.location.y), z);
    if (y === undefined) continue;
    const spot = { x: x + 0.5, y, z: z + 0.5 };
    if (shieldAt(dim.id, spot)) continue;
    try {
      const g = dim.spawnEntity(GRUMBLE, spot);
      burst(dim, "minecraft:large_smoke", { x: spot.x, y: spot.y + 0.3, z: spot.z }, 6, 0.4);
      return g;
    } catch {}
  }
  return undefined;
}

const PASSABLE = /(^|:)air$|short_grass|tall_grass|tallgrass|fern|flower|tulip|poppy|dandelion|orchid|allium|bluet|daisy|cornflower|snow_layer|light_block|petals|leaf_litter|wildflowers/;
function groundNear(dim, x, y0, z) {
  for (let dy = 0; dy <= 6; dy++) {
    for (const y of dy === 0 ? [y0] : [y0 + dy, y0 - dy]) {
      try {
        const below = dim.getBlock({ x, y: y - 1, z })?.typeId ?? "";
        const at = dim.getBlock({ x, y, z })?.typeId ?? "";
        const above = dim.getBlock({ x, y: y + 1, z })?.typeId ?? "";
        if (!PASSABLE.test(below) && !/water|lava/.test(below) && PASSABLE.test(at) && PASSABLE.test(above)) return y;
      } catch {}
    }
  }
  return undefined;
}

// Morning: any Grumbles left over pop into sparkles.
system.runInterval(() => {
  if (isNight()) return;
  for (const d of DIMS) {
    let list = [];
    try {
      list = world.getDimension(d).getEntities({ type: GRUMBLE });
    } catch {}
    for (const g of list) {
      try {
        if (prop(g, "starshield:story")) continue;
        const loc = { ...g.location };
        g.remove();
        poof(g.dimension, loc);
      } catch {}
    }
  }
}, 40);

// ---------- Concert Stage and the Star Shield ----------
// World property starshield:shields = [{dim, x, y, z, until}] (until = absolute time the shield fades: the end of
// the night it was made for).
const shields = () => getJSON(world, "starshield:shields", []);
const saveShields = (list) => setJSON(world, "starshield:shields", list.slice(-12));
function shieldAt(dimId, loc) {
  const now = absTime();
  return shields().some((s) => s.dim === dimId && s.until > now && Math.hypot(loc.x - s.x, loc.z - s.z) <= SHIELD_RADIUS && Math.abs(loc.y - s.y) <= SHIELD_RADIUS);
}
// The end of tonight (or, during the day, of the coming night).
function endOfNight() {
  const now = absTime();
  const day = Math.floor(now / 24000), t = now - day * 24000;
  return t < NIGHT_END ? day * 24000 + NIGHT_END : (day + 1) * 24000 + NIGHT_END;
}

world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  if (ev.block?.typeId !== STAGE) return;
  if (ev.itemStack?.typeId === STAGE) return;              // placing another stage next to it
  ev.cancel = true;
  const { player, block } = ev;
  const loc = { ...block.location };
  let facing = "north";
  try {
    facing = block.permutation.getState("minecraft:cardinal_direction") ?? "north";
  } catch {}
  system.run(() => {
    if (tooSoon(`stage:${player.name}`, 20)) return;
    startConcert(player, block.dimension, loc, facing);
  });
});

const shows = new Map();      // stage key -> end tick
function startConcert(player, dim, loc, facing) {
  const key = `${dim.id}|${loc.x},${loc.y},${loc.z}`;
  if ((shows.get(key) ?? 0) > system.currentTick) return;
  const band = idolsOf(player.name).filter((e) => isFriend(e) && e.dimension.id === dim.id && dist(e.location, loc) <= 48);
  if (!band.length) {
    const f = friendsOf(player);
    if (!player.getDynamicProperty("starshield:met")) note(player, "§fHold up your Lightstick to call Star Shield first!");
    else if (!f.some(Boolean)) note(player, "§fMake friends with Star Shield first: give them their favorite gifts!");
    else note(player, "§fYour Star Shield friends need to be nearby. Hold up your Lightstick to call them!");
    return;
  }
  shows.set(key, system.currentTick + SHOW_TICKS);
  // Line them up on and around the stage, facing out the front (the side the stage was placed facing).
  const [fx, fz] = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[facing] ?? [0, -1];
  const cx = loc.x + 0.5, cz = loc.z + 0.5;
  const order = band.sort((a, b) => girlOf(a) - girlOf(b));
  order.forEach((e, i) => {
    const side = (i - (order.length - 1) / 2) * 1.3;
    const spot = { x: cx - fz * side, y: loc.y + 0.25, z: cz + fx * side };
    try {
      e.teleport(spot, { dimension: dim, facingLocation: { x: spot.x + fx * 4, y: spot.y + 1, z: spot.z + fz * 4 } });
    } catch {}
    burst(dim, "minecraft:totem_particle", { x: spot.x, y: spot.y + 0.5, z: spot.z }, 8, 0.4);
  });
  dance(order, SHOW_TICKS, { dim, x: cx, y: loc.y + 1, z: cz });
  system.runTimeout(() => raiseShield(player, dim, { x: cx, y: loc.y, z: cz }), SHOW_TICKS);
}

// A happy little tune (note block pitches), played while they dance.
// ---------- Star Shield's song ----------
// An original K-pop-style track played with note block sounds, one step per eighth note (5 ticks = 120 beats a
// minute). Pitches are note-block numbers (0 = F#, 12 = the next F#), so 3 = A, 6 = C, 10 = E, 11 = F, 13 = G.
// Chords: A minor, F, C, G (one bar each). The full song (concert): 2 bars of intro, a 1-bar snare build-up,
// a 4-bar "drop" with the hook, and a final hit. Shows on the Concert Stage just loop the drop.
const EIGHTH = 5;
const CHORDS = [[3, 6, 10], [11, 15, 18], [6, 10, 13], [13, 17, 20]];      // Am, F, C, G
const ROOTS = [3, 11, 6, 13];
// The hook (two bars, then two more), -1 = rest.
const HOOK = [
  15, -1, 15, 17, 18, -1, 17, 15, 13, -1, 15, -1, 11, 13, 15, -1,
  18, -1, 18, 20, 22, -1, 20, 18, 17, -1, 18, 17, 15, -1, 13, -1,
];
const pitchOf = (n) => Math.pow(2, (n - 12) / 12);
const INTRO_BARS = 2, BUILD_BARS = 1, DROP_BARS = 4, OUTRO_BARS = 1;
const SONG_EIGHTHS = (INTRO_BARS + BUILD_BARS + DROP_BARS + OUTRO_BARS) * 8;

// The drop: four-on-the-floor kick, claps on 2 and 4, offbeat hi-hats, a bouncy bass and the synth hook.
function dropSounds(i) {
  const out = [], b = i % 8, bar = Math.floor(i / 8) % 4;
  if (b % 2 === 0) out.push(["note.bd", 0.8, 1.2]);
  if (b === 2 || b === 6) out.push(["note.snare", 1.0, 1], ["note.hat", 1.4, 0.7]);
  if (b % 2 === 1) out.push(["note.hat", 1.6, 0.6]);
  if (b !== 3 && b !== 7) out.push(["note.bass", pitchOf(ROOTS[bar] + (b === 5 ? 12 : 0)), 1]);
  const h = HOOK[i % HOOK.length];
  if (h >= 0) out.push(["note.bit", pitchOf(h), 0.9], ["note.pling", pitchOf(h), 0.5]);
  return out;
}

// One eighth of the full concert song.
function songSounds(i) {
  const bar = Math.floor(i / 8), b = i % 8;
  if (bar < INTRO_BARS) {                                       // soft synth arpeggios and hi-hats
    const ch = CHORDS[bar * 2 + (b >= 4 ? 1 : 0)];
    const out = [["note.pling", pitchOf(ch[b % 3] + (b % 4 === 3 ? 12 : 0)), 0.6]];
    if (b % 2 === 1) out.push(["note.hat", 1.6, 0.4]);
    if (b === 0) out.push(["note.bass", pitchOf(ROOTS[bar * 2]), 0.8]);
    return out;
  }
  if (bar < INTRO_BARS + BUILD_BARS) {                          // build-up: faster and higher snares, then a pause
    if (b === 7) return [];
    return [["note.snare", 0.7 + b * 0.12, 0.8 + b * 0.05], ["note.pling", pitchOf(3 + b * 2), 0.4]];
  }
  if (bar < INTRO_BARS + BUILD_BARS + DROP_BARS) return dropSounds(i - (INTRO_BARS + BUILD_BARS) * 8);
  if (b === 0) return [["note.bd", 0.8, 1.3], ["note.snare", 1, 1], ["note.chime", pitchOf(15), 1], ...CHORDS[0].map((n) => ["note.pling", pitchOf(n + 12), 0.8])];
  return [];
}
const isDropStart = (i) => i === (INTRO_BARS + BUILD_BARS) * 8;

function playSounds(dim, loc, list, vol = 1) {
  for (const [id, pitch, v] of list) sound(dim, id, loc, Math.max(0.5, Math.min(2, pitch)), v * vol);
}
function dance(list, ticks, center) {
  for (const e of list) {
    setProp(e, "starshield:mode_before", modeOf(e));
    setProp(e, "starshield:mode", "show");
    fire(e, "starshield:perform");
  }
  let step = 0;
  const run = system.runInterval(() => {
    const live = list.filter(alive);
    if (!live.length) return;
    const at = center ?? live[0].location;
    const dim = center?.dim ?? live[0].dimension;
    if (step % EIGHTH === 0) {
      playSounds(dim, at, dropSounds(step / EIGHTH));
      if (step % (EIGHTH * 2) === 0) for (const e of live) particle(e.dimension, "minecraft:note_particle", { x: e.location.x, y: e.location.y + 1.8, z: e.location.z });
    }
    if (step % 4 === 0) {
      for (const e of live) {
        const g = girlOf(e);
        const id = ["minecraft:villager_happy", "minecraft:totem_particle", "minecraft:endrod"][g];
        particle(e.dimension, id, { x: e.location.x + rand(-0.6, 0.6), y: e.location.y + rand(0.3, 1.8), z: e.location.z + rand(-0.6, 0.6) });
      }
    }
    step++;
  }, 1);
  system.runTimeout(() => {
    system.clearRun(run);
    for (const e of list) {
      if (!alive(e)) continue;
      setProp(e, "starshield:mode", String(prop(e, "starshield:mode_before") ?? "follow"));
      settle(e);
    }
  }, ticks);
}

function raiseShield(player, dim, c) {
  const list = shields().filter((s) => !(s.dim === dim.id && Math.hypot(s.x - c.x, s.z - c.z) < 4) && s.until > absTime());
  list.push({ dim: dim.id, x: c.x, y: c.y, z: c.z, until: endOfNight() });
  saveShields(list);
  sound(dim, "beacon.activate", c, 1.2);
  sound(dim, "random.levelup", c, 1.0);
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    particle(dim, "minecraft:totem_particle", { x: c.x + Math.cos(a) * 3, y: c.y + 1 + (i % 3), z: c.z + Math.sin(a) * 3 });
  }
  try {
    note(player, "§dA Star Shield is glowing over your home!");
    if (!player.getDynamicProperty("starshield:shield_tip")) {
      player.setDynamicProperty("starshield:shield_tip", true);
      player.sendMessage(`§fThe Star Shield keeps Grumbles and monsters out until morning (${SHIELD_RADIUS} blocks all around the stage). Put on a show any night!`);
    }
  } catch {}
}

// Shields at work: shimmer at the edge, Grumbles inside pop, monsters inside get bounced out.
system.runInterval(() => {
  const now = absTime();
  const list = shields();
  const live = list.filter((s) => s.until > now);
  if (live.length !== list.length) saveShields(live);
  for (const s of live) {
    let dim;
    try {
      dim = world.getDimension(s.dim);
    } catch {
      continue;
    }
    const anyone = world.getAllPlayers().some((p) => p.dimension.id === s.dim && Math.hypot(p.location.x - s.x, p.location.z - s.z) < 80);
    if (!anyone) continue;
    for (let i = 0; i < 10; i++) {                                     // a shimmering dome
      const a = rand(0, Math.PI * 2), up = rand(0, Math.PI / 2);
      particle(dim, "minecraft:endrod", {
        x: s.x + Math.cos(a) * Math.cos(up) * SHIELD_RADIUS, y: s.y + Math.sin(up) * SHIELD_RADIUS * 0.6, z: s.z + Math.sin(a) * Math.cos(up) * SHIELD_RADIUS,
      });
    }
    let inside = [];
    try {
      inside = dim.getEntities({ location: { x: s.x, y: s.y, z: s.z }, maxDistance: SHIELD_RADIUS, families: ["monster"] });
    } catch {}
    for (const m of inside) {
      try {
        if (m.typeId === GRUMBLE && prop(m, "starshield:story")) continue;
        if (m.typeId === GRUMBLE) {
          const loc = { ...m.location };
          m.remove();
          poof(dim, loc);
          continue;
        }
        if (/ender_dragon|wither|warden/.test(m.typeId)) continue;
        const dx = m.location.x - s.x, dz = m.location.z - s.z, len = Math.hypot(dx, dz) || 1;
        knock(m, dx / len, dz / len, 2.4, 0.4);
        burst(dim, "minecraft:totem_particle", { x: m.location.x, y: m.location.y + 1, z: m.location.z }, 3, 0.3);
      } catch {}
    }
  }
}, 20);

// Breaking a stage takes its shield away.
world.afterEvents.playerBreakBlock.subscribe(({ block, brokenBlockPermutation }) => {
  if (brokenBlockPermutation?.type?.id !== STAGE) return;
  const l = block.location, dimId = block.dimension.id;
  saveShields(shields().filter((s) => !(s.dim === dimId && Math.hypot(s.x - (l.x + 0.5), s.z - (l.z + 0.5)) < 1 && Math.abs(s.y - l.y) < 1)));
});

// ---------- Looking after the girls ----------
// Every 5 s: friends are tamed to their owner (so they follow), duplicates are tidied up (a girl called again
// while her old self was far away and unloaded), and friends who got left far behind blink back.
system.runInterval(() => {
  const byKey = new Map();
  for (const e of allIdols()) {
    if (!alive(e)) continue;
    const key = `${ownerOf(e)}|${girlOf(e)}`;
    const other = byKey.get(key);
    if (other) {
      const keep = (Number(prop(e, "starshield:born")) || 0) > (Number(prop(other, "starshield:born")) || 0) ? e : other;
      const drop = keep === e ? other : e;
      try {
        drop.remove();
      } catch {}
      byKey.set(key, keep);
    } else byKey.set(key, e);
  }
  for (const e of byKey.values()) {
    const owner = findPlayer(ownerOf(e));
    if (!owner || prop(e, "starshield:caged") === true || modeOf(e) === "show") continue;
    if (!isFriend(e) && friendsOf(owner)[girlOf(e)]) {             // she was a friend before she was called again
      setProp(e, "starshield:friend", true);
      settle(e);
    }
    if (!isFriend(e)) continue;
    bond(e, owner);
    if (modeOf(e) !== "follow") continue;
    let far = false;
    try {
      far = e.dimension.id !== owner.dimension.id || dist(e.location, owner.location) > FAR;
    } catch {}
    if (far) blinkTo(e, owner);
  }
}, 100);

// ---------- Testing ----------
system.afterEvents.scriptEventReceive.subscribe(({ id, sourceEntity }) => {
  if (sourceEntity?.typeId !== "minecraft:player") return;
  if (id === "starshield:skip") return skipStep();
  if (id !== "starshield:grumbles") return;
  for (let i = 0; i < 3; i++) bringGrumble(sourceEntity, 6, 10);
});

// =====================================================================================================================
// EPISODE 1: "The Missing Stars"
// The Adventure Ticket builds four little places in front of you: a concert stage, a big tree, a cave and a lake (the
// land is saved first and goes back exactly how it was when you take the adventure away). Walk up to the stage and
// Star Shield puts on a show... until the Grumble King storms in and the girls vanish. Clues (short, easy-to-read
// notes) lead to each girl. At each place: beat the Grumbles guarding her cage and solve a puzzle to open it.
// Then everyone goes back to the stage for the Grumble King. A sparkle trail always points the way.
// Saved in the world property starshield:ep1 (see newEpisode for what's in it).
// =====================================================================================================================
const TICKET = "starshield:ticket";
const CLUE = "starshield:clue";
const MEDAL = "starshield:medal_1";
const EP = "starshield:ep1";
const EP_NAME = "The Missing Stars";
// Where each place goes: [right, forward] blocks from where you stood when you used the ticket.
const PLACES = { stage: [0, 14], tree: [-22, 34], cave: [22, 36], lake: [0, 58] };
// Each place's ground pad: right (du) and forward (dv) ranges, how deep (low) and high (high) it reaches.
// The first few rows at the front (dv[0] and up) are a ramp of steps whenever a place has to sit on a raised base
// (see `raise`: in a flat world the cave and lake would otherwise dig below the bottom of the world).
const PADS = {
  stage: { du: [-9, 9], dv: [-11, 8], low: -3, high: 10 },
  tree: { du: [-7, 7], dv: [-14, 6], low: -3, high: 20 },
  cave: { du: [-8, 8], dv: [-16, 8], low: -6, high: 7 },
  lake: { du: [-9, 9], dv: [-14, 8], low: -4, high: 4 },
};
const RESCUE = { tree: 0, cave: 1, lake: 2 };      // which girl is where
const ORDER = ["ready", "concert", "storm", "tree", "cave", "lake", "finale", "done"];
const GUARDS = { tree: 3, cave: 3, lake: 4 };
const CONCERT_TICKS = SONG_EIGHTHS * EIGHTH;   // the whole song (8 bars, 16 seconds)
const EP_RANGE = 110;                               // players this close to the stage are "in the adventure"

// Clues, written to be read by a beginning reader: short sentences, simple words.
const CLUES = {
  tree: ["Sora", "Oh no! The Grumble King took us!\n\nI see a big, big tree.\nI am at the tree.\n\nCome and help me!"],
  cave: ["Sora", "Thank you! You are brave!\n\nDalia is in a cave.\nIt is dark in the cave.\n\nTake a torch with you!"],
  lake: ["Dalia", "Yay! You found me!\n\nNow find Yuna.\nYuna is by the water.\n\nLook for the boat!"],
  finale: ["Yuna", "We are all here now!\n\nGo back to the stage.\nWe can sing.\nWe can stop the Grumble King!"],
  done: ["Star Shield", "You did it!\nYou saved us!\n\nThank you, friend.\nWe love you!"],
};
// Puzzle words, also for a beginning reader.
const PUZZLE_TIP = {
  tree: "§eLook at the lights by the tree. What color comes next?",
  cave: "§eTap the lamps. 1 candle, then 2, then 3!",
  lake: "§eTap the riddle stone!",
  finale: "§eWatch the girls. Then tap the colors!",
};
const PATTERNS = [
  [["red", "yellow", "red", "yellow", "red"], "yellow"],
  [["blue", "blue", "lime", "blue", "blue"], "lime"],
  [["red", "yellow", "blue", "red", "yellow"], "blue"],
  [["lime", "red", "lime", "red", "lime"], "red"],
  [["yellow", "yellow", "blue", "yellow", "yellow"], "blue"],
];
const COLORS = ["red", "yellow", "blue", "lime"];
const RIDDLES = [
  ["I am on the water.\nYou can sit in me.\nWhat am I?", "boat", ["bed", "bus"]],
  ["I can swim.\nI live in the water.\nWhat am I?", "fish", ["cat", "bird"]],
  ["I am up in the sky.\nI am hot.\nWhat am I?", "sun", ["moon", "tree"]],
  ["I am green.\nI can hop.\nI say ribbit!\nWhat am I?", "frog", ["dog", "pig"]],
  ["I have a big tail.\nI like nuts.\nI run up trees.\nWhat am I?", "squirrel", ["fox", "duck"]],
];
const SIMON_PADS = ["lime", "orange", "light_blue"];   // Sora, Dalia, Yuna
const SIMON_ROUNDS = [3, 4];

// ---------- Blocks ----------
const BLOCKS = {
  air: [["minecraft:air"]], grass: [["minecraft:grass_block"]], dirt: [["minecraft:dirt"]], stone: [["minecraft:stone"]],
  cobble: [["minecraft:cobblestone"]], mossy: [["minecraft:mossy_cobblestone"]], sand: [["minecraft:sand"]],
  water: [["minecraft:water"]], planks: [["minecraft:oak_planks"], ["minecraft:planks"]],
  log: [["minecraft:oak_log"], ["minecraft:log"]],
  leaves: [["minecraft:oak_leaves", { persistent_bit: true }], ["minecraft:leaves", { old_leaf_type: "oak", persistent_bit: true }]],
  black: [["minecraft:black_concrete"], ["minecraft:concrete", { color: "black" }]],
  purple: [["minecraft:purple_concrete"], ["minecraft:concrete", { color: "purple" }]],
  sea_lantern: [["minecraft:sea_lantern"]], glowstone: [["minecraft:glowstone"]], gold: [["minecraft:gold_block"]],
  noteblock: [["minecraft:noteblock"]], fence: [["minecraft:oak_fence"], ["minecraft:fence"]], lantern: [["minecraft:lantern"]],
  cage: [["minecraft:tinted_glass"], ["minecraft:black_stained_glass"], ["minecraft:stained_glass", { color: "black" }]],
  beam: [["minecraft:purple_stained_glass"], ["minecraft:stained_glass", { color: "purple" }]],
  glass: [["minecraft:glass"]], lamp: [["minecraft:redstone_lamp"]], riddle: [["minecraft:chiseled_stone_bricks"], ["minecraft:stonebrick", { stone_brick_type: "chiseled" }]],
  lily: [["minecraft:waterlily"], ["minecraft:lily_pad"]],
};
for (const c of [...COLORS, "orange", "light_blue"]) {
  BLOCKS[`wool_${c}`] = [[`minecraft:${c}_wool`], ["minecraft:wool", { color: c }]];
  BLOCKS[`glass_${c}`] = [[`minecraft:${c}_stained_glass`], ["minecraft:stained_glass", { color: c }]];
}
const permCache = new Map();
function perm(name, extra) {
  const key = extra ? `${name}:${JSON.stringify(extra)}` : name;
  if (permCache.has(key)) return permCache.get(key);
  let found;
  for (const [id, states] of BLOCKS[name] ?? [[name]]) {
    try {
      found = BlockPermutation.resolve(id, { ...(states || {}), ...(extra || {}) });
      break;
    } catch {}
  }
  permCache.set(key, found);
  return found;
}
function candlePerm(n) {
  for (const [id, st] of [["minecraft:candle", { candles: n - 1, lit: true }], ["minecraft:white_candle", { candles: n - 1, lit: true }]]) {
    try {
      return BlockPermutation.resolve(id, st);
    } catch {}
  }
  return perm("glowstone");
}
function setAt(dim, loc, p) {
  if (!p) return;
  try {
    dim.getBlock(loc)?.setPermutation(p);
  } catch {}
}
const idAt = (dim, loc) => {
  try {
    return dim.getBlock(loc)?.typeId ?? "unloaded";
  } catch {
    return "unloaded";
  }
};

// Blocks that probably belong to something someone built. If any are in the way, the ticket refuses.
const PROTECTED = ["chest", "barrel", "bed", "door", "crafting_table", "furnace", "planks", "glass", "wool", "bricks",
  "concrete", "carpet", "sign", "shulker", "torch", "lantern", "bookshelf", "fence", "stairs", "slab", "quartz",
  "glowstone", "gold_block", "purpur", "froglight", "bars", "elf_shed", "fairy_house", "dog_house", "concert_stage"];

// ---------- The episode record ----------
const episode = () => getJSON(world, EP, undefined);
const saveEpisode = (e) => setJSON(world, EP, e);
// A spot in a place: du blocks to the right, dy up, dv forward (from the ticket-user's point of view).
function at(e, place, du, dy, dv) {
  const s = e.sites[place];
  return { x: s.x + e.r[0] * du + e.f[0] * dv, y: s.y + dy, z: s.z + e.r[1] * du + e.f[1] * dv };
}
const center = (p) => ({ x: p.x + 0.5, y: p.y, z: p.z + 0.5 });
const same = (a, b) => a && b && a.x === b.x && a.y === b.y && a.z === b.z;
const epDim = (e) => world.getDimension(e.dim);
const stepIs = (e, ...names) => !!e && names.includes(e.step);
function playersIn(e) {
  if (!e) return [];
  const stage = at(e, "stage", 0, 0, 0);
  return world.getAllPlayers().filter((p) => {
    try {
      return p.dimension.id === e.dim && Math.hypot(p.location.x - stage.x, p.location.z - stage.z) < EP_RANGE;
    } catch {
      return false;
    }
  });
}
function nearAdventure(player) {
  const e = episode();
  return !!e && e.step !== "done" && playersIn(e).includes(player);
}
function girlsMissing(player) {
  const e = episode();
  return stepIs(e, "concert", "storm", "tree", "cave", "lake") && e.owner === player.name;
}
const storyGirls = () => allIdols().filter((g) => prop(g, "starshield:story") === true);
const storyGrumbles = (e, tag) => {
  try {
    return epDim(e).getEntities({ type: GRUMBLE }).filter((g) => prop(g, "starshield:story") === (tag ?? prop(g, "starshield:story")) && prop(g, "starshield:story"));
  } catch {
    return [];
  }
};
const tellAll = (e, msg) => playersIn(e).forEach((p) => note(p, msg));

function newEpisode(player) {
  let v = { x: 0, z: 1 };
  try {
    v = player.getViewDirection();
  } catch {}
  const f = Math.abs(v.x) > Math.abs(v.z) ? [Math.sign(v.x), 0] : [0, Math.sign(v.z) || 1];
  const r = [-f[1], f[0]];
  const p = { x: Math.floor(player.location.x), y: Math.floor(player.location.y), z: Math.floor(player.location.z) };
  const sites = {};
  for (const [name, [du, dv]] of Object.entries(PLACES)) sites[name] = { x: p.x + r[0] * du + f[0] * dv, y: p.y, z: p.z + r[1] * du + f[1] * dv };
  return {
    owner: player.name, dim: player.dimension.id, f, r, start: p, sites, tiles: [], step: "building", run: newRun(),
    guards: {}, beaten: {}, solved: {}, kingId: undefined, shielded: true,
    pattern: pick(PATTERNS), choices: [], candles: [1, 2, 3].sort(() => Math.random() - 0.5), lit: 0,
    riddles: [0, 1, 2, 3, 4].sort(() => Math.random() - 0.5).slice(0, 2), riddle: 0,
  };
}

// ---------- The ticket ----------
const ticketUse = new Map();
world.afterEvents.itemUse.subscribe(({ source: player, itemStack }) => {
  if (player?.typeId !== "minecraft:player") return;
  const id = itemStack?.typeId;
  if (id !== TICKET && id !== CLUE) return;
  if ((ticketUse.get(player.name) ?? -99) > system.currentTick - 15) return;
  ticketUse.set(player.name, system.currentTick);
  if (id === CLUE) return readClue(player);
  const e = episode();
  if (!e) return buildEpisode(player);
  ticketMenu(player, e);
});

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      if (player.getDynamicProperty("starshield:got_ticket")) return;
      const left = player.getComponent("minecraft:inventory").container.addItem(new ItemStack(TICKET, 1));
      if (left) player.dimension.spawnItem(left, player.location);
      player.setDynamicProperty("starshield:got_ticket", true);
      player.sendMessage("§dYou got an Adventure Ticket! §fStand in a big open space and use it to start Episode 1: The Missing Stars.");
    } catch {}
  }, 170);
});

function ticketMenu(player, e) {
  if (e.step === "building" || e.step === "removing") {
    note(player, e.step === "building" ? "§fStill building! Try again in a moment." : "§fPacking the adventure away...");
    return;
  }
  const buttons = [];
  if (CLUES[e.step]) buttons.push(["Read my clue", () => readClue(player)]);
  buttons.push(["Play again", () => restartEpisode(player)]);
  buttons.push(["Take the adventure away", () => confirmTakeAway(player)]);
  const form = new ActionFormData().title(`Episode 1: ${EP_NAME}`);
  for (const [label] of buttons) form.button(label);
  form.show(player).then((r) => {
    if (!r.canceled) buttons[r.selection]?.[1]();
  }).catch(() => {});
}

function confirmTakeAway(player) {
  new ActionFormData().title("Take it away?").body("The stage, tree, cave and lake go away. The land goes back how it was.")
    .button("Yes, take it away").button("No, keep it").show(player).then((r) => {
      if (!r.canceled && r.selection === 0) takeAway(player);
    }).catch(() => {});
}

// Shows the current clue. Tries again for a bit if another screen is open.
function readClue(player, tries = 0) {
  const e = episode();
  const c = e && CLUES[e.step];
  if (!c) {
    note(player, "§fNo clue right now.");
    return;
  }
  new ActionFormData().title(`A clue from ${c[0]}!`).body(`§l${c[1]}\n\n- ${c[0]}`).button("I will help!").show(player).then((r) => {
    if (r.canceled && r.cancelationReason === "UserBusy" && tries < 6) system.runTimeout(() => readClue(player, tries + 1), 30);
  }).catch(() => {});
}

function giveClue(e) {
  for (const p of playersIn(e)) {
    try {
      const inv = p.getComponent("minecraft:inventory").container;
      let has = false;
      for (let i = 0; i < (inv.size ?? 0); i++) if (inv.getItem(i)?.typeId === CLUE) has = true;
      if (!has) {
        const left = inv.addItem(new ItemStack(CLUE, 1));
        if (left) p.dimension.spawnItem(left, p.location);
      }
    } catch {}
    sound(p.dimension, "random.orb", p.location, 1.2);
    system.runTimeout(() => readClue(p), 40);
  }
}

function giveItems(e, items) {
  for (const p of playersIn(e)) {
    try {
      const inv = p.getComponent("minecraft:inventory").container;
      for (const [id, n] of items) {
        const left = inv.addItem(new ItemStack(id, n));
        if (left) p.dimension.spawnItem(left, p.location);
      }
    } catch {}
  }
}

// ---------- Building ----------
function buildEpisode(player) {
  if (player.dimension.id !== "minecraft:overworld") {
    note(player, "§fThe adventure needs to be in the Overworld!");
    return;
  }
  const e = newEpisode(player);
  const dim = player.dimension;
  const box = episodeBox(e);
  try {
    dim.runCommand("tickingarea remove starshield_ep1");
  } catch {}
  try {
    dim.runCommand(`tickingarea add ${box.min.x} ${box.min.y} ${box.min.z} ${box.max.x} ${box.max.y} ${box.max.z} starshield_ep1 true`);
  } catch {}
  note(player, "§dGetting the adventure ready...");
  let waited = 0;
  const tryStart = () => {
    const loaded = Object.keys(PLACES).every((k) => idAt(dim, e.sites[k]) !== "unloaded");
    if (!loaded && waited < 200) {
      waited += 20;
      system.runTimeout(tryStart, 20);
      return;
    }
    if (!loaded) {
      note(player, "§cThat's too far away to build. Try again in a big open space!");
      return;
    }
    system.runJob(buildJob(player, e, true));
  };
  system.runTimeout(tryStart, 20);
}

function episodeBox(e) {
  const xs = [], zs = [];
  for (const [name, pad] of Object.entries(PADS)) {
    for (const du of pad.du) for (const dv of pad.dv) {
      const p = at(e, name, du, 0, dv);
      xs.push(p.x); zs.push(p.z);
    }
  }
  return { min: { x: Math.min(...xs), y: e.start.y - 24, z: Math.min(...zs) }, max: { x: Math.max(...xs), y: e.start.y + 32, z: Math.max(...zs) } };
}

const SOFT_GROUND = /(^|:)air$|leaves|log|wood|grass$|short_grass|tall_grass|tallgrass|fern|flower|tulip|poppy|dandelion|orchid|allium|bluet|daisy|cornflower|bush|snow_layer|vine|sapling|mushroom|petals|leaf_litter|wildflowers|sugar_cane|light_block/;
// The lowest y blocks can go at (the bottom of the world; bedrock is there).
function minY(dim) {
  try {
    const m = dim.heightRange?.min;
    if (typeof m === "number") return m;
  } catch {}
  return -64;
}
// How far down the top of the ground is at row dv of a place: -1 normally; on the ramp at the front of a raised
// place, lower (one step per row) down to the land around it.
function surfaceDy(e, name, dv) {
  const raise = e.sites[name].raise || 0;
  return -1 - Math.max(0, raise - (dv - PADS[name].dv[0]));
}

function groundY(dim, x, z, y0) {
  for (let y = y0 + 14; y >= Math.max(y0 - 18, minY(dim) + 1); y--) {
    const id = idAt(dim, { x, y, z });
    if (id === "unloaded") return undefined;
    if (!SOFT_GROUND.test(id) || id === "minecraft:grass_block") return y + 1;
  }
  return y0;
}

function* buildJob(player, e, fresh) {
  const dim = epDim(e);
  if (fresh) {
    // Each place sits on the ground where it is.
    for (const name of Object.keys(PLACES)) {
      const y = groundY(dim, e.sites[name].x, e.sites[name].z, e.start.y);
      if (y === undefined) {
        note(player, "§cThat's too far away to build. Try again in a big open space!");
        return;
      }
      // Everything a place digs must stay above the bottom of the world (bedrock is left alone).
      const raise = Math.max(0, minY(dim) + 1 - (y + PADS[name].low));
      e.sites[name].y = y + raise;
      e.sites[name].raise = raise;
    }
    // Don't knock down anything someone built.
    for (const [name, pad] of Object.entries(PADS)) {
      for (let du = pad.du[0]; du <= pad.du[1]; du++) {
        for (let dv = pad.dv[0]; dv <= pad.dv[1]; dv++) {
          for (let dy = -1; dy <= pad.high; dy++) {
            const id = idAt(dim, at(e, name, du, dy, dv));
            if (PROTECTED.some((w) => id.includes(w)) || id.startsWith("starshield:")) {
              note(player, "§cWhoa! That would knock down something already built. Try a big open space!");
              try {
                dim.runCommand("tickingarea remove starshield_ep1");
              } catch {}
              return;
            }
          }
        }
        yield;
      }
    }
    // Save the land so it can go back exactly how it was.
    const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    for (const [name, pad] of Object.entries(PADS)) {
      const a = at(e, name, pad.du[0], pad.low, pad.dv[0]), b = at(e, name, pad.du[1], pad.high, pad.dv[1]);
      const min = { x: Math.min(a.x, b.x), y: a.y, z: Math.min(a.z, b.z) }, max = { x: Math.max(a.x, b.x), y: b.y, z: Math.max(a.z, b.z) };
      const id = `starshield:ep1_${stamp}_${name}`;
      try {
        world.structureManager.createFromWorld(id, dim, min, max, { saveMode: "World", includeEntities: false, includeBlocks: true });
        e.tiles.push({ id, min });
      } catch (err) {
        console.warn(`[Star Shield] Couldn't save the land: ${err}`);
      }
      yield;
    }
    saveEpisode(e);
  }
  sound(dim, "block.bell.hit", player.location, 1);
  for (const name of Object.keys(PADS)) {
    if (!isCurrent(e.run)) return;
    yield* flatten(dim, e, name);
    yield* BUILDERS[name](dim, e);
  }
  if (!isCurrent(e.run)) return;
  e.step = "ready";
  saveEpisode(e);
  note(player, "§dGo to the stage! The show is about to start!");
  sound(dim, "random.levelup", player.location, 1.2);
}

// Clears the place and lays a flat grass top at dy -1 (with dirt under it, down to the land if the place is raised,
// and a ramp of steps at the front).
function* flatten(dim, e, name) {
  const pad = PADS[name];
  const raise = e.sites[name].raise || 0;
  const from = Math.max(pad.low, Math.min(-3, -1 - raise));
  for (let du = pad.du[0]; du <= pad.du[1]; du++) {
    for (let dv = pad.dv[0]; dv <= pad.dv[1]; dv++) {
      const top = surfaceDy(e, name, dv);
      for (let dy = from; dy <= pad.high; dy++) {
        setAt(dim, at(e, name, du, dy, dv), perm(dy === top ? "grass" : dy < top ? "dirt" : "air"));
      }
    }
    yield;
  }
}

const put = (dim, e, name, du, dy, dv, block, extra) => setAt(dim, at(e, name, du, dy, dv), typeof block === "string" ? perm(block, extra) : block);

// A 3x3 shadow cage around (du, dy, dv), 2 blocks of room inside. Its blocks are saved so it can be broken open.
function cage(dim, e, name, du0, dy0, dv0) {
  const cells = [];
  for (let du = -1; du <= 1; du++) for (let dv = -1; dv <= 1; dv++) for (let dy = 0; dy <= 3; dy++) {
    const inside = du === 0 && dv === 0 && (dy === 1 || dy === 2);
    const p = at(e, name, du0 + du, dy0 + dy, dv0 + dv);
    if (inside) setAt(dim, p, perm("air"));
    else {
      setAt(dim, p, perm("cage"));
      cells.push(p);
    }
  }
  e.cages = { ...(e.cages || {}), [name]: { cells, girl: center(at(e, name, du0, dy0 + 1, dv0)) } };
}

const BUILDERS = {
  *stage(dim, e) {
    for (let du = -5; du <= 5; du++) for (let dv = 0; dv <= 4; dv++) put(dim, e, "stage", du, 0, dv, dv === 0 && du % 2 === 0 ? "sea_lantern" : "black");
    for (let du = -5; du <= 5; du++) for (let dy = 1; dy <= 6; dy++) put(dim, e, "stage", du, dy, 5, "purple");
    for (const [du, dy] of [[0, 6], [-1, 5], [0, 5], [1, 5], [-2, 4], [-1, 4], [0, 4], [1, 4], [2, 4], [-1, 3], [1, 3], [0, 3]]) put(dim, e, "stage", du, dy, 5, dy === 4 && du === 0 ? "glowstone" : "gold");
    for (const s of [-1, 1]) {
      for (let dy = 0; dy <= 3; dy++) for (const du of [6 * s, 7 * s]) for (const dv of [1, 2]) put(dim, e, "stage", du, dy, dv, dy % 2 === 1 && dv === 1 ? "noteblock" : "black");
      for (let dy = 1; dy <= 6; dy++) put(dim, e, "stage", 6 * s, dy, 4, dy === 6 ? "sea_lantern" : "black");
      put(dim, e, "stage", 8 * s, 0, -6, "fence"); put(dim, e, "stage", 8 * s, 1, -6, "fence"); put(dim, e, "stage", 8 * s, 2, -6, "lantern");
    }
    for (let du = -6; du <= 6; du++) put(dim, e, "stage", du, 7, 5, "beam");
    // Song pads for the Grumble King, in the girls' colors.
    e.pads = SIMON_PADS.map((c, i) => {
      const p = at(e, "stage", (i - 1) * 3, -1, -3);
      setAt(dim, p, perm(`wool_${c}`));
      return p;
    });
    yield;
  },
  *tree(dim, e) {
    const T = "tree";
    for (let dy = 0; dy <= 12; dy++) for (let du = -1; du <= 1; du++) for (let dv = -1; dv <= 1; dv++) put(dim, e, T, du, dy, dv, "log");
    for (const [du, dv] of [[2, 0], [-2, 0], [0, 2]]) put(dim, e, T, du, 0, dv, "log");
    for (const [du, dv] of [[2, 0], [3, 0], [-2, 0], [-3, 0], [0, 2], [0, 3], [0, -2]]) put(dim, e, T, du, 9, dv, "log");
    for (let dy = 7; dy <= 19; dy++) {
      for (let du = -6; du <= 6; du++) for (let dv = -6; dv <= 6; dv++) {
        const d = Math.hypot(du, (dy - 13) * 1.2, dv);
        if (d > 6.2 || (Math.abs(du) <= 1 && Math.abs(dv) <= 1 && dy <= 12)) continue;
        if (d > 5.4 && Math.random() < 0.4) continue;
        put(dim, e, T, du, dy, dv, "leaves");
      }
      yield;
    }
    cage(dim, e, T, 0, 0, -4);
    // Pattern puzzle: five colored lights on fence posts, an empty one, and three wool squares to pick from.
    const [seq, answer] = e.pattern;
    for (let i = 0; i < 6; i++) {
      put(dim, e, T, i - 3, 0, -8, "fence");
      put(dim, e, T, i - 3, 1, -8, i < 5 ? `glass_${seq[i]}` : "glass");
    }
    e.slot = at(e, T, 2, 1, -8);
    const others = COLORS.filter((c) => c !== answer).sort(() => Math.random() - 0.5).slice(0, 2);
    const picks = [answer, ...others].sort(() => Math.random() - 0.5);
    e.choices = picks.map((c, i) => {
      const p = at(e, T, (i - 1) * 2, -1, -10);
      setAt(dim, p, perm(`wool_${c}`));
      return { ...p, color: c };
    });
  },
  *cave(dim, e) {
    const C = "cave";
    const floorAt = (dv) => (dv <= -7 ? 0 : dv >= -3 ? -4 : -(dv + 7));      // the tunnel steps down one block at a time
    const isAir = (du, dy, dv) => {
      if (dv >= -3 && dv <= 4 && Math.abs(du) <= 3) return dy >= -4 && dy <= -2;                     // the room
      if (dv >= -9 && dv < -3 && Math.abs(du) <= 1) return dy >= floorAt(dv) && dy <= floorAt(dv) + 2; // the tunnel
      return false;
    };
    for (let du = -8; du <= 8; du++) {
      for (let dv = -10; dv <= 8; dv++) {
        for (let dy = -6; dy <= 6; dy++) {
          const rad = 7.2 - Math.max(0, dy) * 1.2;
          const inMound = Math.hypot(du, dv * 0.9) <= rad;
          let b;
          if (isAir(du, dy, dv)) b = "air";
          else if (!inMound && dy > surfaceDy(e, C, dv)) continue;              // the ramp in front stays open
          else if (dy < -1) b = "stone";
          else if (dy === -1) b = inMound ? "stone" : "grass";
          else if (inMound) b = Math.hypot(du, dv * 0.9) > rad - 1 && dy >= 1 ? (Math.random() < 0.5 ? "mossy" : "cobble") : "stone";
          else continue;
          put(dim, e, C, du, dy, dv, b);
        }
      }
      yield;
    }
    cage(dim, e, C, 0, -5, 1);
    // Candle puzzle: three lamps at the back, with 1, 2 and 3 candles in a mixed-up order.
    e.lamps = e.candles.map((n, i) => {
      const p = at(e, C, (i - 1) * 2, -4, 4);
      setAt(dim, p, perm("lamp"));
      setAt(dim, { ...p, y: p.y + 1 }, candlePerm(n));
      return { ...p, n };
    });
    e.lit = 0;
    e.caveDoor = center(at(e, C, 0, 0, -9));
  },
  *lake(dim, e) {
    const L = "lake";
    for (let du = -9; du <= 9; du++) {
      for (let dv = -8; dv <= 8; dv++) {
        const d = Math.hypot(du / 7.5, dv / 6.5);
        const island = Math.hypot(du, dv) <= 2.3;
        if (island) {
          put(dim, e, L, du, -1, dv, "grass"); put(dim, e, L, du, -2, dv, "dirt"); put(dim, e, L, du, -3, dv, "dirt");
        } else if (d <= 1) {
          put(dim, e, L, du, -1, dv, "water"); put(dim, e, L, du, -2, dv, "water"); put(dim, e, L, du, -3, dv, "sand");
          if (d > 0.4 && Math.random() < 0.05) put(dim, e, L, du, 0, dv, "lily");
        } else if (d <= 1.18) put(dim, e, L, du, -1, dv, "sand");
      }
      yield;
    }
    for (let dv = -8; dv <= -3; dv++) put(dim, e, L, 0, -1, dv, "planks");      // a little dock out to the island
    cage(dim, e, L, 0, 0, 0);
    e.riddleStone = at(e, L, 3, 0, -9);
    setAt(dim, e.riddleStone, perm("riddle"));
    setAt(dim, { ...e.riddleStone, y: e.riddleStone.y + 1 }, perm("lantern"));
    e.boatAt = center(at(e, L, 2, 0, -5));
  },
};

// ---------- Timers that belong to one run of the story ----------
// Every play-through has its own run id (e.run). Timed parts of the story (the concert, the storm, the clue after a
// rescue, the ending) only go ahead if that run is still the current one, and "take it away" / "play again" cancel
// any that are still waiting. (Before 1.3.1, taking the adventure away during the concert let the storm carry on:
// it saved the adventure again, brought the Grumble King and moved on to the tree.)
const storyTimers = new Set();
const isCurrent = (run) => {
  const cur = episode();
  return !!cur && cur.run === run;
};
function later(run, fn, ticks) {
  const id = system.runTimeout(() => {
    storyTimers.delete(id);
    if (isCurrent(run)) fn(episode());
  }, ticks);
  storyTimers.add(id);
  return id;
}
function every(run, fn, ticks) {
  const id = system.runInterval(() => {
    if (isCurrent(run)) fn(episode());
    else {
      system.clearRun(id);
      storyTimers.delete(id);
    }
  }, ticks);
  storyTimers.add(id);
  return id;
}
function stopTimers() {
  for (const id of storyTimers) system.clearRun(id);
  storyTimers.clear();
}
const newRun = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;

// ---------- The story, step by step ----------
let busy = false;           // the concert or storm is playing (memory only: a reload goes back to "ready")
let loadedOnce = false;

system.runInterval(() => {
  const e = episode();
  if (!e) return;
  if (!loadedOnce) {
    loadedOnce = true;
    if (stepIs(e, "concert", "storm")) {
      for (const g of storyGirls()) g.remove();
      e.step = "ready";
      saveEpisode(e);
    }
  }
  if (busy || e.step === "building" || e.step === "removing" || e.step === "done") return;
  const players = playersIn(e);
  if (!players.length) return;
  const dim = epDim(e);
  const near = (loc, r) => players.some((p) => dist(p.location, loc) <= r);

  if (e.step === "ready") {
    if (near(center(at(e, "stage", 0, 0, -4)), 9)) startShow(e);
    return;
  }
  const place = e.step;
  if (RESCUE[place] !== undefined) {
    const c = e.cages?.[place];
    if (!c) return;
    // The girl waits in her cage.
    if (!storyGirls().some((g) => girlOf(g) === RESCUE[place] && prop(g, "starshield:caged"))) spawnCaged(e, place);
    // Grumbles guard her, once someone comes close.
    if (!e.guards[place] && near(c.girl, 18)) {
      e.guards[place] = true;
      saveEpisode(e);
      for (let i = 0; i < GUARDS[place]; i++) spawnGuard(e, place, i);
      tellAll(e, "§5Grumbles! §fBeat them all!");
    }
    if (e.guards[place] && !e.beaten[place]) herdGuards(e, place, players);
    if (e.guards[place] && !e.beaten[place] && !storyGrumbles(e, place).length) {
      e.beaten[place] = true;
      saveEpisode(e);
      tellAll(e, e.solved[place] ? "§aYou beat the Grumbles!" : `§aYou beat the Grumbles! ${PUZZLE_TIP[place]}`);
    }
    if (e.beaten[place] && e.solved[place]) openCage(e, place);
    else if (e.guards[place] && !e.solved[place] && system.currentTick % 200 === 0) {
      for (const p of players) if (dist(p.location, c.girl) < 14) note(p, PUZZLE_TIP[place]);
    }
    if (place === "lake" && !e.boat) {
      try {
        dim.spawnEntity("minecraft:boat", e.boatAt);
        e.boat = true;
        saveEpisode(e);
      } catch {}
    }
  }
  if (e.step === "finale") finaleTick(e, players, near);
}, 10);

function startShow(e) {
  busy = true;
  e.step = "concert";
  saveEpisode(e);
  const dim = epDim(e);
  // The owner's own girls are the ones on stage.
  for (const g of allIdols()) if (ownerOf(g) === e.owner) g.remove();
  const band = [0, 1, 2].map((g) => {
    const spot = center(at(e, "stage", (g - 1) * 2, 1, 2));
    let girl;
    try {
      girl = dim.spawnEntity(IDOL, spot);
    } catch {
      return undefined;
    }
    fire(girl, `starshield:girl_${g}`);
    for (const [k, v] of [["girl", g], ["owner", e.owner], ["friend", false], ["story", true], ["mode", "show"], ["born", absTime()]]) setProp(girl, `starshield:${k}`, v);
    try {
      girl.nameTag = IDOLS[g].name;
      girl.teleport(spot, { facingLocation: center(at(e, "stage", 0, 1, -8)) });
    } catch {}
    fire(girl, "starshield:perform");
    return girl;
  }).filter(Boolean);
  tellAll(e, "§dStar Shield is on stage!");
  const mid = center(at(e, "stage", 0, 2, 2));
  let step = 0;
  const run = every(e.run, () => {
    if (step % EIGHTH === 0) {
      const i = step / EIGHTH;
      playSounds(dim, mid, songSounds(i), 1.5);
      if (i % 2 === 0) for (const g of band) if (alive(g)) particle(dim, "minecraft:note_particle", { x: g.location.x, y: g.location.y + 1.8, z: g.location.z });
      if (isDropStart(i)) {                                        // the drop: a burst of sparkles over the stage
        for (let k = 0; k < 40; k++) particle(dim, "minecraft:totem_particle", { x: mid.x + rand(-5, 5), y: mid.y + rand(0, 4), z: mid.z + rand(-2, 2) });
      }
    }
    if (step % 3 === 0) {                                          // light show from the poles
      for (const s of [-1, 1]) particle(dim, "minecraft:endrod", center(at(e, "stage", 6 * s, 7, 4)));
      particle(dim, pick(["minecraft:totem_particle", "minecraft:villager_happy"]), { x: mid.x + rand(-5, 5), y: mid.y + rand(0, 5), z: mid.z + rand(-2, 2) });
    }
    step++;
  }, 1);
  later(e.run, (cur) => {
    system.clearRun(run);
    storyTimers.delete(run);
    storm(cur, band);
  }, CONCERT_TICKS);
}

function storm(e, band) {
  e.step = "storm";
  saveEpisode(e);
  const dim = epDim(e);
  const back = center(at(e, "stage", 0, 1, 3));
  try {
    world.setTimeOfDay(18000);                                     // the sky goes dark
  } catch {}
  sound(dim, "ambient.weather.thunder", back, 1, 2);
  burst(dim, "minecraft:large_smoke", back, 30, 3);
  let king;
  try {
    king = dim.spawnEntity(GRUMBLE, back);
    fire(king, "starshield:make_king");
    fire(king, "starshield:king_shield");
    setProp(king, "starshield:story", "storm");
  } catch {}
  tellAll(e, "§5Oh no! It is the Grumble King!");
  sound(dim, "mob.ravager.roar", back, 1.3, 2);
  for (const g of band) {
    fire(g, "starshield:visit");
    setProp(g, "starshield:mode", "show");
  }
  // The girls float up into the shadows...
  let t = 0;
  const run = every(e.run, () => {
    t++;
    for (const g of band) {
      if (!alive(g)) continue;
      try {
        g.teleport({ x: g.location.x, y: g.location.y + 0.08, z: g.location.z });
      } catch {}
      burst(dim, "minecraft:large_smoke", g.location, 2, 0.5);
    }
  }, 1);
  later(e.run, () => {
    system.clearRun(run);
    storyTimers.delete(run);
    for (const g of band) {
      try {
        burst(dim, "minecraft:large_smoke", g.location, 12, 0.8);
        g.remove();
      } catch {}
    }
    tellAll(e, "§fStar Shield is gone!");
    sound(dim, "ambient.weather.thunder", back, 1.4, 2);
  }, 70);
  // ...and the King vanishes with them.
  later(e.run, (cur) => {
    try {
      burst(dim, "minecraft:large_smoke", king.location, 30, 2);
      king.remove();
    } catch {}
    if (cur.step !== "storm") {
      busy = false;
      return;
    }
    cur.step = "tree";
    saveEpisode(cur);
    busy = false;
    tellAll(cur, "§eYou found Sora's star clip. It has a clue in it!");
    giveClue(cur);
    giveItems(cur, [["minecraft:stone_sword", 1]]);
  }, 110);
}

function spawnCaged(e, place) {
  const c = e.cages[place];
  const g = RESCUE[place];
  let girl;
  try {
    girl = epDim(e).spawnEntity(IDOL, c.girl);
  } catch {
    return;
  }
  fire(girl, `starshield:girl_${g}`);
  for (const [k, v] of [["girl", g], ["owner", e.owner], ["friend", false], ["story", true], ["caged", true], ["mode", "stay"], ["born", absTime()]]) setProp(girl, `starshield:${k}`, v);
  try {
    girl.nameTag = IDOLS[g].name;
  } catch {}
  fire(girl, "starshield:stay");
}

// Open spots in each place where guards start (and get put back if they wander off or get stuck).
const GUARD_SPOTS = {
  tree: [[-4, 0, -6], [4, 0, -6], [0, 0, -11], [-5, 0, -2], [5, 0, -2]],
  cave: [[-2, -4, -2], [2, -4, -2], [0, -4, 3]],
  lake: [[-6, 0, -6], [6, 0, -6], [-2, 0, -9], [8, 0, -2]],
};
const guardSpot = (e, place, i) => {
  const s = GUARD_SPOTS[place][i % GUARD_SPOTS[place].length];
  return center(at(e, place, s[0], s[1], s[2]));
};

function spawnGuard(e, place, i) {
  const dim = epDim(e);
  const spot = guardSpot(e, place, i);
  try {
    const g = dim.spawnEntity(GRUMBLE, spot);
    setProp(g, "starshield:story", place);
    burst(dim, "minecraft:large_smoke", spot, 6, 0.4);
  } catch {}
}

// Guards that wandered far off or got stuck inside something are put back near the cage, and the number left is
// shown each time one is beaten.
const guardsLeft = new Map();
const OK_TO_STAND = new RegExp(`${PASSABLE.source}|water|lily|carpet|torch|candle`);
function herdGuards(e, place, players) {
  const dim = epDim(e);
  const c = e.cages[place];
  const list = storyGrumbles(e, place);
  list.forEach((g, i) => {
    let stuck = false;
    try {
      stuck = !OK_TO_STAND.test(dim.getBlock({ x: Math.floor(g.location.x), y: Math.floor(g.location.y + 0.3), z: Math.floor(g.location.z) })?.typeId ?? "");
    } catch {}
    if (stuck || dist(g.location, c.girl) > 22) {
      const spot = guardSpot(e, place, i);
      try {
        g.teleport(spot);
      } catch {}
      burst(dim, "minecraft:large_smoke", spot, 6, 0.4);
    }
  });
  const before = guardsLeft.get(place);
  if (before !== undefined && list.length < before && list.length > 0) {
    for (const p of players) note(p, `§fGrumbles left: §e${list.length}`);
  }
  guardsLeft.set(place, list.length);
}

function openCage(e, place) {
  const dim = epDim(e);
  const c = e.cages[place];
  for (const p of c.cells) {
    setAt(dim, p, perm("air"));
    if (Math.random() < 0.3) particle(dim, "minecraft:totem_particle", center(p));
  }
  sound(dim, "random.glass", c.girl, 1);
  sound(dim, "random.levelup", c.girl, 1.4);
  const g = RESCUE[place];
  const girl = storyGirls().find((x) => girlOf(x) === g && prop(x, "starshield:caged"));
  const owner = findPlayer(e.owner);
  if (girl) {
    setProp(girl, "starshield:caged", false);
    setProp(girl, "starshield:friend", true);
    setProp(girl, "starshield:mode", "follow");
    if (owner) bond(girl, owner);
    settle(girl);
    wave(girl, 60);
    burst(dim, "minecraft:totem_particle", girl.location, 16, 0.7);
  }
  if (owner) saveFriend(owner, g);
  e.step = ORDER[ORDER.indexOf(place) + 1];
  saveEpisode(e);
  tellAll(e, `§aYou found ${IDOLS[g].color}${IDOLS[g].name}§a!`);
  later(e.run, (cur) => {
    tellAll(cur, "§eYou got a new clue!");
    giveClue(cur);
    if (cur.step === "cave") giveItems(cur, [["minecraft:torch", 16]]);
  }, 50);
}

// ---------- Puzzles ----------
world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const e = episode();
  if (!e || !RESCUE_OR_FINALE.has(e.step) || !ev.block) return;
  const loc = ev.block.location;
  const hit = puzzleAt(e, loc);
  if (!hit) return;
  ev.cancel = true;
  const player = ev.player;
  system.run(() => {
    if (tooSoon(`puzzle:${player.name}`, 6)) return;
    hit(player);
  });
});
const RESCUE_OR_FINALE = new Set(["tree", "cave", "lake", "finale"]);

// Punching a puzzle block works too (a quick tap on an iPad doesn't always count as "using" a plain block).
world.afterEvents.entityHitBlock.subscribe(({ damagingEntity: player, hitBlock }) => {
  if (player?.typeId !== "minecraft:player" || !hitBlock) return;
  const e = episode();
  if (!e || !RESCUE_OR_FINALE.has(e.step)) return;
  const hit = puzzleAt(e, hitBlock.location);
  if (hit && !tooSoon(`puzzle:${player.name}`, 6)) hit(player);
});

// And so does stepping onto a floor square (the color squares at the tree and the song pads).
const standingOn = new Map();
system.runInterval(() => {
  const e = episode();
  if (!e || !stepIs(e, "tree", "finale")) return;
  for (const p of playersIn(e)) {
    const below = { x: Math.floor(p.location.x), y: Math.floor(p.location.y - 0.5), z: Math.floor(p.location.z) };
    const key = `${below.x},${below.y},${below.z}`;
    if (standingOn.get(p.name) === key) continue;
    standingOn.set(p.name, key);
    const hit = puzzleAt(e, below);
    if (hit && !tooSoon(`puzzle:${p.name}`, 6)) hit(p);
  }
}, 4);

// Puzzle blocks and cages can't be broken during the adventure.
world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  const e = episode();
  if (!e || !ev.block || e.step === "done") return;
  const l = ev.block.location;
  const cageCell = Object.values(e.cages || {}).some((c) => c.cells.some((p) => same(p, l)));
  const puzzle = (e.choices || []).some((p) => same(p, l)) || (e.pads || []).some((p) => same(p, l)) ||
    (e.lamps || []).some((p) => same(p, l) || same({ ...p, y: p.y + 1 }, l)) || same(e.riddleStone, l) || same(e.slot, l);
  if (cageCell || puzzle) ev.cancel = true;
});

function puzzleAt(e, loc) {
  if (e.step === "tree" && !e.solved.tree) {
    const c = e.choices.find((p) => same(p, loc));
    if (c) return (player) => pickColor(player, c.color);
    for (let i = 0; i < 6; i++) {
      const post = at(e, "tree", i - 3, 0, -8);
      if (same(post, loc) || same({ ...post, y: post.y + 1 }, loc)) return (player) => patternForm(player);
    }
  }
  if (e.step === "cave" && !e.solved.cave) {
    const l = e.lamps.find((p) => same(p, loc) || same({ ...p, y: p.y + 1 }, loc));
    if (l) return (player) => tapLamp(player, l);
  }
  if (e.step === "lake" && !e.solved.lake) {
    if (same(e.riddleStone, loc) || same({ ...e.riddleStone, y: e.riddleStone.y + 1 }, loc)) return (player) => askRiddle(player);
  }
  if (e.step === "finale" && e.shielded) {
    const i = e.pads.findIndex((p) => same(p, loc));
    if (i >= 0) return (player) => tapPad(player, i);
  }
  return undefined;
}

function solved(e, place, player) {
  e.solved[place] = true;
  saveEpisode(e);
  const dim = epDim(e);
  sound(dim, "random.levelup", player.location, 1.6);
  burst(dim, "minecraft:totem_particle", player.location, 14, 1);
  tellAll(e, e.beaten[place] ? "§aYou did it! The cage is open!" : "§aYou did it! §fNow beat the Grumbles!");
}

const COLOR_WORD = { red: "§cRed", yellow: "§eYellow", blue: "§9Blue", lime: "§aGreen" };
function patternForm(player) {
  const e = episode();
  if (!e || e.step !== "tree" || e.solved.tree) return;
  const [seq] = e.pattern;
  const picks = e.choices.map((c) => c.color);
  const form = new ActionFormData().title("What comes next?")
    .body(`§lLook at the lights!\n\n${seq.map((c) => COLOR_WORD[c]).join("§f, ")}§f, ?\n\nWhat color is next?`);
  for (const c of picks) form.button(COLOR_WORD[c]);
  form.show(player).then((r) => {
    if (!r.canceled) pickColor(player, picks[r.selection]);
  }).catch(() => {});
}

function lampHelp(player) {
  new ActionFormData().title("The lamps").body("§lLook at the lamps.\nCount the candles.\n\nTap 1 candle.\nThen 2.\nThen 3.")
    .button("OK!").show(player).catch(() => {});
}

// Once the Grumbles are beaten, walking up to a puzzle explains it (at most every 30 seconds).
const helped = new Map();
system.runInterval(() => {
  const e = episode();
  if (!e || !stepIs(e, "tree", "cave", "lake") || !e.beaten[e.step] || e.solved[e.step]) return;
  const spot = { tree: () => center(at(e, "tree", 0, 0, -9)), cave: () => center(e.lamps[1]), lake: () => center(e.riddleStone) }[e.step]();
  for (const p of playersIn(e)) {
    if (dist(p.location, spot) > 5) continue;
    const key = `${p.name}:${e.step}`;
    if ((helped.get(key) ?? -9999) > system.currentTick - 600) continue;
    helped.set(key, system.currentTick);
    if (e.step === "tree") patternForm(p);
    else if (e.step === "cave") lampHelp(p);
    else askRiddle(p);
  }
}, 20);

function pickColor(player, color) {
  const e = episode();
  const dim = epDim(e);
  if (color === e.pattern[1]) {
    setAt(dim, e.slot, perm(`glass_${color}`));
    solved(e, "tree", player);
  } else {
    sound(dim, "note.bass", player.location, 0.6);
    note(player, "§fNot that one. Look again!");
  }
}

function tapLamp(player, lamp) {
  const e = episode();
  const dim = epDim(e);
  if (lamp.n === e.lit + 1) {
    setAt(dim, lamp, perm("glowstone"));
    sound(dim, "note.chime", lamp, [1, 1.26, 1.5][e.lit]);
    e.lit++;
    saveEpisode(e);
    if (e.lit === 3) solved(e, "cave", player);
    else note(player, `§a${e.lit}! §fNow ${e.lit + 1} candles.`);
  } else if (lamp.n > e.lit) {
    for (const l of e.lamps) setAt(dim, l, perm("lamp"));
    e.lit = 0;
    saveEpisode(e);
    sound(dim, "note.bass", player.location, 0.6);
    note(player, "§fOops! Start with 1 candle.");
  }
}

function askRiddle(player) {
  const e = episode();
  const [q, answer, wrong] = RIDDLES[e.riddles[e.riddle]];
  const options = [answer, ...wrong].sort(() => Math.random() - 0.5);
  const form = new ActionFormData().title(`Riddle ${e.riddle + 1} of ${e.riddles.length}`).body(`§l${q}`);
  for (const o of options) form.button(o);
  form.show(player).then((r) => {
    if (r.canceled) return;
    const cur = episode();
    if (!cur || cur.step !== "lake" || cur.solved.lake) return;
    if (options[r.selection] === answer) {
      cur.riddle++;
      saveEpisode(cur);
      if (cur.riddle >= cur.riddles.length) solved(cur, "lake", player);
      else {
        sound(epDim(cur), "note.chime", player.location, 1.5);
        note(player, "§aYes! §fOne more riddle!");
        system.runTimeout(() => askRiddle(player), 20);
      }
    } else {
      sound(epDim(cur), "note.bass", player.location, 0.6);
      note(player, "§fNot that one. Try again!");
      system.runTimeout(() => askRiddle(player), 30);
    }
  }).catch(() => {});
}

// ---------- The finale: the Grumble King ----------
// He arrives behind a shadow shield. The girls sing a little song of colors; play it back on the pads (round 1:
// 3 colors, round 2: 4) and the shield breaks. Then everyone fights him. He shrinks into a tiny Grumble and runs off.
let simon;                     // { round, seq, at, showing, nextShow } (memory only)

function finaleTick(e, players, near) {
  const dim = epDim(e);
  let king = e.kingId ? dim.getEntities({ type: GRUMBLE }).find((g) => g.id === e.kingId) : undefined;
  if (!king) {
    if (!near(center(at(e, "stage", 0, 0, -3)), 14)) return;
    try {
      king = dim.spawnEntity(GRUMBLE, center(at(e, "stage", 0, 1, 3)));
    } catch {
      return;
    }
    fire(king, "starshield:make_king");
    e.shielded = e.shielded !== false;
    if (e.shielded) fire(king, "starshield:king_shield");
    setProp(king, "starshield:story", "king");
    try {
      king.nameTag = "Grumble King";
    } catch {}
    e.kingId = king.id;
    saveEpisode(e);
    sound(dim, "mob.ravager.roar", king.location, 1.3, 2);
    burst(dim, "minecraft:large_smoke", king.location, 30, 2);
    tellAll(e, "§5The Grumble King is back! §fHe has a shadow shield.");
    for (const p of players) p.sendMessage("§fThe girls will show you a song. Watch the colors. Then tap the same colors on the floor!");
    simon = undefined;
  }
  if (e.shielded) {
    burst(dim, "minecraft:portal", { x: king.location.x, y: king.location.y + 1, z: king.location.z }, 4, 1.5);
    // He stays on the stage while his shield is up.
    const post = center(at(e, "stage", 0, 1, 3));
    if (dist(king.location, post) > 1.5) {
      try {
        king.teleport(post);
      } catch {}
    }
    simonTick(e);
  }
  // Little Grumbles keep coming while he's around.
  if (system.currentTick % 240 === 0 && storyGrumbles(e, "minion").length < 2) {
    const a = rand(0, Math.PI * 2), c = center(at(e, "stage", 0, 0, -2));
    const spot = { x: c.x + Math.cos(a) * 6, y: c.y, z: c.z + Math.sin(a) * 6 };
    try {
      const g = dim.spawnEntity(GRUMBLE, spot);
      setProp(g, "starshield:story", "minion");
      burst(dim, "minecraft:large_smoke", spot, 6, 0.4);
    } catch {}
  }
}

function simonTick(e) {
  const now = system.currentTick;
  if (!simon) simon = { round: 0, seq: newSeq(SIMON_ROUNDS[0]), at: 0, showing: false, nextShow: now + 60 };
  if (!simon.showing && now >= simon.nextShow) showSong(e);
}
const newSeq = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 3));

function showSong(e) {
  simon.showing = true;
  simon.at = 0;
  tellAll(e, "§eWatch the song!");
  const dim = epDim(e);
  simon.seq.forEach((g, i) => {
    system.runTimeout(() => flashPad(e, dim, g), 20 + i * 18);
  });
  system.runTimeout(() => {
    if (!simon) return;
    simon.showing = false;
    simon.nextShow = system.currentTick + 400;                     // no taps for 20 s: show it again
    tellAll(e, "§eYour turn! Tap the colors.");
  }, 20 + simon.seq.length * 18 + 6);
}

const PAD_PITCH = [1.0, 1.26, 1.5];
function flashPad(e, dim, g) {
  const pad = e.pads[g];
  setAt(dim, pad, perm("sea_lantern"));
  sound(dim, "note.pling", pad, PAD_PITCH[g], 1.2);
  burst(dim, "minecraft:note_particle", { x: pad.x + 0.5, y: pad.y + 1.2, z: pad.z + 0.5 }, 3, 0.3);
  const girl = allIdols().find((x) => ownerOf(x) === e.owner && girlOf(x) === g);
  if (girl) {
    wave(girl, 14);
    particle(dim, "minecraft:note_particle", { x: girl.location.x, y: girl.location.y + 1.9, z: girl.location.z });
  }
  system.runTimeout(() => setAt(dim, pad, perm(`wool_${SIMON_PADS[g]}`)), 12);
}

function tapPad(player, g) {
  const e = episode();
  if (!simon || simon.showing) return;
  const dim = epDim(e);
  flashPad(e, dim, g);
  simon.nextShow = system.currentTick + 400;
  if (simon.seq[simon.at] !== g) {
    sound(dim, "note.bass", player.location, 0.6);
    tellAll(e, "§fOops! Watch again.");
    simon.at = 0;
    simon.nextShow = system.currentTick + 40;
    return;
  }
  simon.at++;
  if (simon.at < simon.seq.length) return;
  simon.round++;
  if (simon.round < SIMON_ROUNDS.length) {
    tellAll(e, "§aYes! §fNow a longer song!");
    simon.seq = newSeq(SIMON_ROUNDS[simon.round]);
    simon.nextShow = system.currentTick + 50;
    return;
  }
  // The song breaks the shadow shield.
  e.shielded = false;
  saveEpisode(e);
  simon = undefined;
  const king = epDim(e).getEntities({ type: GRUMBLE }).find((x) => x.id === e.kingId);
  if (king) {
    fire(king, "starshield:king_unshield");
    burst(dim, "minecraft:totem_particle", king.location, 30, 2);
  }
  sound(dim, "random.levelup", player.location, 1.2);
  sound(dim, "beacon.activate", player.location, 1.4);
  tellAll(e, "§aThe shield broke! §fNow beat the Grumble King!");
}

// Called from the entityDie handler for every Grumble. True if it was the King.
function kingDied(dead, dim, loc) {
  const e = episode();
  if (!e || e.step !== "finale" || dead.id !== e.kingId) return false;
  e.step = "done";
  e.kingId = undefined;
  saveEpisode(e);
  // He shrinks into a tiny Grumble that squeaks and runs off.
  let tiny;
  try {
    tiny = dim.spawnEntity(GRUMBLE, loc);
    fire(tiny, "starshield:make_tiny");
    setProp(tiny, "starshield:story", "tiny");
  } catch {}
  sound(dim, "mob.bat.idle", loc, 1.8, 1.5);
  tellAll(e, "§fThe Grumble King is just a tiny Grumble now!");
  later(e.run, () => {
    try {
      const l = { ...tiny.location };
      tiny.remove();
      poof(dim, l);
    } catch {}
    for (const g of storyGrumbles(e)) {
      try {
        const l = { ...g.location };
        g.remove();
        poof(dim, l);
      } catch {}
    }
  }, 50);
  // Then Star Shield takes the stage one more time.
  later(e.run, () => {
    const band = allIdols().filter((x) => ownerOf(x) === e.owner && isFriend(x)).sort((a, b) => girlOf(a) - girlOf(b));
    const facing = center(at(e, "stage", 0, 1, -8));
    band.forEach((g) => {
      const spot = center(at(e, "stage", (girlOf(g) - 1) * 2, 1, 2));
      try {
        g.teleport(spot, { dimension: dim, facingLocation: facing });
      } catch {}
    });
    tellAll(e, "§dStar Shield sings for you!");
    dance(band, SHOW_TICKS, { dim, ...center(at(e, "stage", 0, 2, 2)) });
    const owner = findPlayer(e.owner);
    later(e.run, () => {
      if (owner) raiseShield(owner, dim, center(at(e, "stage", 0, 0, 2)));
      try {
        world.setTimeOfDay(23500);                                 // and the sun comes up
      } catch {}
      for (let i = 0; i < 40; i++) {
        particle(dim, pick(["minecraft:totem_particle", "minecraft:villager_happy", "minecraft:endrod"]),
          { x: loc.x + rand(-8, 8), y: loc.y + rand(1, 10), z: loc.z + rand(-8, 8) });
      }
      giveItems(e, [[MEDAL, 1], [SHARD, 5]]);
      for (const p of playersIn(e)) {
        p.setDynamicProperty("starshield:met", true);
        p.sendMessage("§d§lThe End! §r§fYou saved Star Shield! Episode 1 is done. You got the Episode 1 Medal!");
        system.runTimeout(() => readClue(p), 40);
      }
      if (owner) {
        for (const g of [0, 1, 2]) saveFriend(owner, g);
        owner.sendMessage("§fSora, Dalia and Yuna are your friends now. Use the Adventure Ticket to play again or take the adventure away.");
      }
    }, SHOW_TICKS + 10);
  }, 70);
  return true;
}

// ---------- The sparkle trail: always points to where to go next ----------
// While Grumbles are left, the trail points at the closest one.
function guardGoal(e, place, p) {
  if (!e.guards[place] || e.beaten[place]) return undefined;
  let best, bd = Infinity;
  for (const g of storyGrumbles(e, place)) {
    const d = dist(g.location, p.location);
    if (d < bd) {
      bd = d;
      best = g.location;
    }
  }
  return best;
}
function goalFor(e, p) {
  switch (e.step) {
    case "ready": return center(at(e, "stage", 0, 0, -4));
    case "tree": return guardGoal(e, "tree", p) ?? (e.beaten.tree && !e.solved.tree ? center(at(e, "tree", 0, 0, -10)) : e.cages.tree.girl);
    case "cave": {
      const door = e.caveDoor;
      const inside = Math.abs(p.location.y - e.cages.cave.girl.y) < 3 && dist(p.location, e.cages.cave.girl) < 9;
      if (inside) return guardGoal(e, "cave", p) ?? (e.beaten.cave && !e.solved.cave ? center(e.lamps[1]) : e.cages.cave.girl);
      return door;
    }
    case "lake": return guardGoal(e, "lake", p) ?? (e.beaten.lake && !e.solved.lake ? center(e.riddleStone) : e.cages.lake.girl);
    case "finale": return center(at(e, "stage", 0, 0, -3));
    default: return undefined;
  }
}
system.runInterval(() => {
  const e = episode();
  if (!e || !stepIs(e, "ready", "tree", "cave", "lake", "finale") || busy) return;
  const dim = epDim(e);
  for (const p of playersIn(e)) {
    const goal = goalFor(e, p);
    if (!goal) continue;
    const dx = goal.x - p.location.x, dz = goal.z - p.location.z, d = Math.hypot(dx, dz);
    if (d < 7) continue;
    for (let k = 2; k <= 7; k++) {
      particle(dim, "minecraft:villager_happy", { x: p.location.x + (dx / d) * k, y: p.location.y + 0.4, z: p.location.z + (dz / d) * k });
    }
  }
}, 40);

// ---------- Play again / take it away ----------
function clearStory(e) {
  stopTimers();
  for (const g of storyGirls()) if (prop(g, "starshield:caged") || modeOf(g) === "show") g.remove();
  for (const g of storyGrumbles(e)) g.remove();
  try {
    for (const b of epDim(e).getEntities({ type: "minecraft:boat" })) if (e.boatAt && dist(b.location, e.boatAt) < 16) b.remove();
  } catch {}
  simon = undefined;
  busy = false;
}

function restartEpisode(player) {
  const e = episode();
  if (!e || busy) return;
  clearStory(e);
  const fresh = newEpisode(player);
  Object.assign(e, { step: "building", run: newRun(), guards: {}, beaten: {}, solved: {}, kingId: undefined, shielded: true, boat: false,
    pattern: fresh.pattern, candles: fresh.candles, lit: 0, riddles: fresh.riddles, riddle: 0 });
  saveEpisode(e);
  note(player, "§dGetting the adventure ready again...");
  system.runJob(buildJob(player, e, false));
}

function takeAway(player) {
  const e = episode();
  if (!e) return;
  if (e.step === "building") {
    note(player, "§fStill building! Try again in a moment.");
    return;
  }
  clearStory(e);
  saveEpisode({ ...e, step: "removing", run: newRun() });   // anything still running for the old run stops here
  system.runJob(removeJob(player, e));
}

function* removeJob(player, e) {
  const dim = epDim(e);
  let restored = 0;
  for (const t of e.tiles || []) {
    try {
      world.structureManager.place(t.id, dim, t.min);
      restored++;
    } catch (err) {
      console.warn(`[Star Shield] Couldn't put the land back: ${err}`);
    }
    yield;
  }
  if (restored < Object.keys(PADS).length) {
    // No saved land: clear what was built and leave grass.
    for (const [name, pad] of Object.entries(PADS)) {
      for (let du = pad.du[0]; du <= pad.du[1]; du++) {
        for (let dv = pad.dv[0]; dv <= pad.dv[1]; dv++) {
          for (let dy = pad.low; dy <= pad.high; dy++) setAt(dim, at(e, name, du, dy, dv), perm(dy === -1 ? "grass" : dy < -1 ? "dirt" : "air"));
        }
        yield;
      }
    }
  }
  for (const t of e.tiles || []) {
    try {
      world.structureManager.delete(t.id);
    } catch {}
  }
  try {
    dim.runCommand("tickingarea remove starshield_ep1");
  } catch {}
  saveEpisode(undefined);
  sound(dim, "random.pop", player.location, 0.8);
  note(player, "§fThe adventure is all packed away.");
}

// Testing: jump to the next part of the story.
function skipStep() {
  const e = episode();
  if (!e) return;
  if (RESCUE[e.step] !== undefined) {
    for (const g of storyGrumbles(e, e.step)) g.remove();
    e.guards[e.step] = true;
    e.beaten[e.step] = true;
    e.solved[e.step] = true;
    saveEpisode(e);
  } else if (e.step === "finale" && e.kingId) {
    e.shielded = false;
    saveEpisode(e);
    const king = epDim(e).getEntities({ type: GRUMBLE }).find((x) => x.id === e.kingId);
    if (king) fire(king, "starshield:king_unshield");
  }
}
