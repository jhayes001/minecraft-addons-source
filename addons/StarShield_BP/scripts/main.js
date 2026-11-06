// Star Shield: Sora, Dalia and Yuna are a pop group who secretly protect the world from Grumbles (goofy shadow
// demons that show up at night) with their songs.
// - The Lightstick (given on first join) calls them. The first time, all three arrive to meet you.
// - Give each girl her favorite gift and she becomes your friend and follows you: Sora loves apples, Dalia loves
//   cookies (or cake or pie), Yuna loves flowers. Friends fight Grumbles and monsters near you and can't get hurt.
// - Tap a girl to say hi. Crouch and tap for her menu (follow me / wait here).
// - Tap the Concert Stage: your friends hop on and put on a show, and a glowing Star Shield covers the area until
//   morning. No Grumbles or monsters get in.
// Testing (cheats on): /scriptevent starshield:grumbles   brings 3 Grumbles near you.
import { world, system, ItemStack } from "@minecraft/server";
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
  if (Math.random() < 0.35) {
    try {
      dim.spawnItem(new ItemStack(SHARD, 1), loc);
    } catch {}
  }
});

function poof(dim, loc) {
  burst(dim, "minecraft:totem_particle", { x: loc.x, y: loc.y + 0.3, z: loc.z }, 12, 0.5);
  burst(dim, "minecraft:villager_happy", { x: loc.x, y: loc.y + 0.3, z: loc.z }, 4, 0.4);
  sound(dim, "random.pop", loc, 0.8);
  sound(dim, "note.chime", loc, rand(1.2, 2.0), 0.8);
}

// ---------- Grumbles come out at night ----------
system.runInterval(() => {
  if (!isNight()) return;
  for (const player of world.getAllPlayers()) {
    try {
      if (player.dimension.id !== "minecraft:overworld" || !player.getDynamicProperty("starshield:met")) continue;
      if (shieldAt(player.dimension.id, player.location)) continue;
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
const TUNE = [0, 2, 4, 7, 4, 7, 9, 7, 4, 2, 4, 0, 2, 4, 7, 12];
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
    if (step % 5 === 0) {
      const n = TUNE[(step / 5) % TUNE.length];
      const pitch = Math.pow(2, (n - 12) / 12) * 1.0;
      sound(dim, "note.harp", at, pitch);
      if (step % 10 === 0) sound(dim, "note.bass", at, pitch * 0.5, 0.6);
      if (step % 20 === 0) sound(dim, "note.chime", at, pitch * 2, 0.5);
      for (const e of live) particle(e.dimension, "minecraft:note_particle", { x: e.location.x, y: e.location.y + 1.8, z: e.location.z });
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
    if (!owner) continue;
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
  if (id !== "starshield:grumbles" || sourceEntity?.typeId !== "minecraft:player") return;
  for (let i = 0; i < 3; i++) bringGrumble(sourceEntity, 6, 10);
});
