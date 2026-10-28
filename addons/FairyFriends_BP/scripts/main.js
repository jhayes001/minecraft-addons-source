// Fairy Friends: put a Fairy Egg on the ground and wait for it to hatch. Your fairy can be
// any color (sometimes rainbow!) and a girl or a boy. It flies after you sprinkling fairy dust.
// At night it flies home to its Fairy House to sleep (the windows light up), and in the
// morning it comes back to find you.
import { world, system, ItemStack, MolangVariableMap, BlockPermutation } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const EGG_ITEM = "fairy:fairy_egg";
const EGG = "fairy:egg";
const FAIRY = "fairy:fairy";
const HOUSE = "fairy:fairy_house";
const HATCH_TICKS = 200;          // 10 seconds from egg to fairy
const NIGHT_START = 13000;        // bedtime (time of day, 0 to 24000)
const NIGHT_END = 23000;          // wake up at dawn
const HOME_RANGE = 64;            // a fairy only flies home if its house is this close
const DIMS = ["overworld", "nether", "the_end"];

// Same order as the textures in the resource pack (variant number = index).
const COLORS = [
  { name: "pink", code: "§d", rgb: { red: 1, green: 0.55, blue: 0.82 } },
  { name: "red", code: "§c", rgb: { red: 1, green: 0.3, blue: 0.32 } },
  { name: "orange", code: "§6", rgb: { red: 1, green: 0.66, blue: 0.22 } },
  { name: "yellow", code: "§e", rgb: { red: 1, green: 0.93, blue: 0.32 } },
  { name: "green", code: "§a", rgb: { red: 0.42, green: 1, blue: 0.48 } },
  { name: "aqua", code: "§b", rgb: { red: 0.38, green: 1, blue: 0.96 } },
  { name: "blue", code: "§9", rgb: { red: 0.45, green: 0.62, blue: 1 } },
  { name: "purple", code: "§5", rgb: { red: 0.76, green: 0.48, blue: 1 } },
  { name: "rainbow", code: "§d", rgb: null },
];
const RAINBOW = COLORS.length - 1;
const GIRL_NAMES = ["Luna", "Rosie", "Willow", "Poppy", "Clover", "Daisy", "Hazel", "Ivy", "Pearl", "Sunny",
  "Juniper", "Skye", "Mira", "Fern", "Lily", "Coral", "Bluebell", "Twinkle", "Dewdrop", "Marigold"];
const BOY_NAMES = ["Bramble", "Jasper", "Acorn", "Finn", "Rowan", "Pebble", "Moss", "Cedar", "Basil", "Robin",
  "Twig", "Sparky", "Thistle", "Puddle", "Flint", "Sage", "Comet", "Buttons", "Nutmeg", "Breeze"];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const alive = (e) => {
  try {
    return typeof e.isValid === "function" ? e.isValid() : !!e.isValid;
  } catch {
    return false;
  }
};

// ---------- Saved data ----------
function getJSON(holder, key, fallback) {
  try {
    const raw = holder.getDynamicProperty(key);
    if (typeof raw === "string") return JSON.parse(raw);
  } catch {}
  return fallback;
}
function setJSON(holder, key, value) {
  try {
    holder.setDynamicProperty(key, value === undefined ? undefined : JSON.stringify(value));
  } catch {}
}
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

// ---------- Words ----------
function rainbowText(text) {
  const codes = ["§c", "§6", "§e", "§a", "§b", "§9", "§d"];
  return [...text].map((ch, i) => codes[i % codes.length] + ch).join("") + "§r";
}
function colorWord(i) {
  const c = COLORS[i] ?? COLORS[0];
  return i === RAINBOW ? rainbowText("rainbow") : `${c.code}${c.name}§r`;
}
const fairyName = (f) => f.nameTag || prop(f, "fairy:name") || "Your fairy";
const her = (f) => (prop(f, "fairy:gender") === "boy" ? "his" : "her");
const she = (f) => (prop(f, "fairy:gender") === "boy" ? "he" : "she");
const findPlayer = (name) => world.getAllPlayers().find((p) => p.name === name);
function tell(name, msg) {
  try {
    findPlayer(name)?.sendMessage(msg);
  } catch {}
}

// ---------- Starter kit (no cheats needed) ----------
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      if (player.getDynamicProperty("fairy:got_starter")) return;
      const inv = player.getComponent("minecraft:inventory").container;
      for (const id of [EGG_ITEM, HOUSE]) {
        try {
          const leftover = inv.addItem(new ItemStack(id, 1));
          if (leftover) player.dimension.spawnItem(leftover, player.location);
        } catch {}
      }
      player.setDynamicProperty("fairy:got_starter", true);
      player.sendMessage("§dYou found a Fairy Egg and a Fairy House! §fLook at the ground and hold the use button with the egg to set it down. Then wait for it to hatch!");
      player.playSound("random.levelup", { pitch: 1.4 });
    } catch {}
  }, 100);
});

// ---------- Setting an egg down ----------
const SOFT = ["air", "short_grass", "tall_grass", "tallgrass", "fern", "snow_layer", "dandelion", "poppy",
  "tulip", "daisy", "orchid", "allium", "bluet", "cornflower", "lily_of_the_valley", "deadbush", "dead_bush"];
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
  setProp(egg, "fairy:owner", player.name);
  setProp(egg, "fairy:age", 0);
  takeOne(player);
  player.sendMessage("§dThe Fairy Egg is wiggling! §fStay close and watch it hatch...");
  sparkle(player.dimension, { x: spot.x, y: spot.y + 0.4, z: spot.z }, 6);
  playSound(player.dimension, "random.orb", spot, 1.6);
});

function takeOne(player) {
  try {
    if (String(player.getGameMode()).toLowerCase() === "creative") return;
  } catch {}
  try {
    const inv = player.getComponent("minecraft:inventory").container;
    const slot = player.selectedSlotIndex;
    const item = inv.getItem(slot);
    if (item?.typeId !== EGG_ITEM) return;
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
      const age = (Number(prop(egg, "fairy:age")) || 0) + 5;
      setProp(egg, "fairy:age", age);
      const loc = egg.location;
      if (age % 10 === 0) sparkle(egg.dimension, { x: loc.x, y: loc.y + 0.5, z: loc.z }, 1);
      if (age === 120 || age === 160 || age === 185) {
        playSound(egg.dimension, "block.turtle_egg.crack", loc, 1.3);
        playSound(egg.dimension, "random.pop", loc, 0.8 + age / 200);
      }
      if (age >= HATCH_TICKS) hatch(egg);
    }
  }
}, 5);

function hatch(egg) {
  const dim = egg.dimension;
  const loc = { ...egg.location };
  const owner = String(prop(egg, "fairy:owner") ?? "");
  try {
    egg.remove();
  } catch {}
  let fairy;
  try {
    fairy = dim.spawnEntity(FAIRY, { x: loc.x, y: loc.y + 0.3, z: loc.z });
  } catch {
    return;
  }
  const color = Math.floor(Math.random() * COLORS.length); // rainbow is one of the choices
  const gender = Math.random() < 0.5 ? "girl" : "boy";
  const name = pick(gender === "girl" ? GIRL_NAMES : BOY_NAMES);
  try {
    fairy.triggerEvent(`fairy:color_${color}`);
    fairy.triggerEvent(`fairy:${gender}`);
  } catch {}
  setProp(fairy, "fairy:owner", owner);
  setProp(fairy, "fairy:name", name);
  setProp(fairy, "fairy:color", color);
  setProp(fairy, "fairy:gender", gender);
  setProp(fairy, "fairy:state", "awake");
  try {
    fairy.nameTag = name;
  } catch {}

  sparkle(dim, { x: loc.x, y: loc.y + 0.6, z: loc.z }, 14, color);
  playSound(dim, "random.levelup", loc, 1.5);
  playSound(dim, "note.chime", loc, 1.8);
  const player = findPlayer(owner);
  if (!player) return;
  const subtitle = `Meet ${name}, a ${colorWord(color)}§f ${gender} fairy!`;
  try {
    player.onScreenDisplay.setTitle("§dYour egg hatched!", { subtitle, fadeInDuration: 5, stayDuration: 70, fadeOutDuration: 20 });
  } catch {}
  player.sendMessage(`§dYour egg hatched! §f${subtitle}`);
  if (color === RAINBOW) player.sendMessage(`§fWOW! A ${rainbowText("RAINBOW")}§f fairy! Rainbow fairies are extra special!`);
  player.sendMessage(`§f${name} will follow you everywhere. Put down a §dFairy House§f so ${gender === "boy" ? "he" : "she"} has a cozy place to sleep at night.`);
}

// ---------- Fairy houses ----------
const houses = () => getJSON(world, "fairy:houses", []);
const sameSpot = (h, dimId, l) => h.dim === dimId && h.x === l.x && h.y === l.y && h.z === l.z;

world.afterEvents.playerPlaceBlock.subscribe(({ player, block }) => {
  if (block.typeId !== HOUSE) return;
  const list = houses().filter((h) => !sameSpot(h, block.dimension.id, block.location));
  list.push({ owner: player.name, dim: block.dimension.id, x: block.location.x, y: block.location.y, z: block.location.z });
  setJSON(world, "fairy:houses", list.slice(-40));
  const mine = myFairies(player.name);
  if (mine.length) {
    const names = mine.map(fairyName).join(" and ");
    player.sendMessage(`§dYou built a Fairy House! §f${names} will fly home here to sleep when it gets dark.`);
  } else {
    player.sendMessage("§dYou built a Fairy House! §fHatch a Fairy Egg to get a fairy to live in it.");
  }
  sparkle(block.dimension, { x: block.location.x + 0.5, y: block.location.y + 1, z: block.location.z + 0.5 }, 6);
});

world.afterEvents.playerBreakBlock.subscribe(({ player, block, brokenBlockPermutation }) => {
  if (brokenBlockPermutation?.type?.id !== HOUSE) return;
  const dimId = block.dimension.id, l = block.location;
  setJSON(world, "fairy:houses", houses().filter((h) => !sameSpot(h, dimId, l)));
  // Breaking your house while your fairies sleep inside asks whether to say goodbye.
  refreshFairies();
  const inside = myFairies(player.name).filter((f) => prop(f, "fairy:state") === "asleep" &&
    (() => { const h = getJSON(f, "fairy:home", null); return h && sameSpot(h, dimId, l); })());
  if (!inside.length) return;
  for (const f of inside) {
    setProp(f, "fairy:state", "waiting");
    waiting.add(f.id);
  }
  system.run(() => askAtBrokenHouse(player, inside));
});

const waiting = new Set(); // fairies whose owner is deciding; anything left "waiting" after a reload wakes up

async function askAtBrokenHouse(player, list) {
  const names = list.map(fairyName);
  const who = names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names.at(-1);
  let yes = false;
  try {
    const res = await new ActionFormData()
      .title("Fairy House")
      .body(`§d${who}§f ${list.length === 1 ? "was" : "were"} sleeping in this house!\n\nDo you want to say goodbye? ${list.length === 1 ? (prop(list[0], "fairy:gender") === "boy" ? "He" : "She") : "They"} will fly away home to Fairy Land and won't come back.`)
      .button(`§cYes, say goodbye to ${list.length === 1 ? who : "them"}`)
      .button("§2No! Come back to me!")
      .show(player);
    yes = !res.canceled && res.selection === 0;
  } catch {}
  list.forEach((f, i) => {
    waiting.delete(f.id);
    if (!alive(f)) return;
    hide(f, false);
    if (yes) {
      setProp(f, "fairy:state", "leaving");
      setProp(f, "fairy:leaveAge", -i * 6);
    } else {
      setProp(f, "fairy:state", "awake");
      sparkle(f.dimension, f.location, 6, Number(prop(f, "fairy:color")));
    }
  });
  try {
    player.sendMessage(yes
      ? `§d${who}§f ${list.length === 1 ? "waves" : "wave"} goodbye and ${list.length === 1 ? "flies" : "fly"} away home to Fairy Land. Bye-bye!`
      : `§d${who}§f woke up and ${list.length === 1 ? "is" : "are"} flying back to you. Build a new Fairy House for bedtime!`);
  } catch {}
}

function houseBlock(h) {
  try {
    return world.getDimension(h.dim).getBlock({ x: h.x, y: h.y, z: h.z });
  } catch {
    return undefined;
  }
}

// The closest house that belongs to the fairy's owner (or any nearby house, if the owner has none).
function findHome(fairy) {
  const owner = prop(fairy, "fairy:owner");
  const here = fairy.location, dimId = fairy.dimension.id;
  const list = houses();
  let changed = false;
  const usable = [];
  for (const h of list) {
    if (h.dim !== dimId) continue;
    const d = dist(here, { x: h.x + 0.5, y: h.y, z: h.z + 0.5 });
    if (d > HOME_RANGE) continue;
    const b = houseBlock(h);
    if (!b) continue; // too far away to see right now
    if (b.typeId !== HOUSE) {
      h.gone = true;
      changed = true;
      continue;
    }
    usable.push({ h, d, mine: h.owner === owner });
  }
  if (changed) setJSON(world, "fairy:houses", list.filter((h) => !h.gone));
  const pool = usable.some((u) => u.mine) ? usable.filter((u) => u.mine) : usable.filter((u) => u.d < 32);
  pool.sort((a, b) => a.d - b.d);
  return pool[0]?.h;
}

function setLit(h, lit) {
  const b = houseBlock(h);
  if (!b || b.typeId !== HOUSE) return;
  try {
    b.setPermutation(b.permutation.withState("fairy:lit", lit));
  } catch {}
}

// ---------- Fairies: follow, sprinkle dust, go to bed ----------
let fairies = [];
function refreshFairies() {
  const found = [];
  for (const d of DIMS) {
    try {
      found.push(...world.getDimension(d).getEntities({ type: FAIRY }));
    } catch {}
  }
  fairies = found;
}
const myFairies = (owner) => fairies.filter((f) => alive(f) && prop(f, "fairy:owner") === owner);

const isNight = () => {
  const t = world.getTimeOfDay();
  return t >= NIGHT_START && t < NIGHT_END;
};

let tick = 0;
system.runInterval(() => {
  tick++;
  if (tick % 20 === 1) refreshFairies();
  const night = isNight();
  const players = new Map(world.getAllPlayers().map((p) => [p.name, p]));
  const slots = new Map(); // how many fairies each owner has, to spread them around

  for (const f of fairies) {
    if (!alive(f)) continue;
    const owner = String(prop(f, "fairy:owner") ?? "");
    const state = prop(f, "fairy:state") ?? "awake";
    const slot = slots.get(owner) ?? 0;
    slots.set(owner, slot + 1);
    const player = players.get(owner);
    if (tick % 4 === slot % 4) {
      updateLight(f, state === "awake" && !!player && player.dimension.id === f.dimension.id && slot < LIGHTS_PER_PLAYER && isDarkFor(player));
    }

    if (state === "waiting") {
      if (!waiting.has(f.id)) {
        hide(f, false);
        setProp(f, "fairy:state", "awake");
      }
      continue;
    }
    if (state === "leaving") {
      leaveTick(f);
      continue;
    }
    if (state === "asleep") {
      sleepTick(f, night);
      continue;
    }
    if (night && tick % 20 === 2 && state !== "flyingHome") {
      const home = findHome(f);
      if (home) {
        setJSON(f, "fairy:home", home);
        setProp(f, "fairy:state", "flyingHome");
        tell(owner, `§d${fairyName(f)}§f is sleepy and is flying home to ${her(f)} Fairy House. Goodnight!`);
      } else if (player && prop(f, "fairy:askedNight") !== world.getDay()) {
        setProp(f, "fairy:askedNight", world.getDay());
        tell(owner, `§d${fairyName(f)}§f is sleepy! Put down a Fairy House near here so ${she(f)} has a cozy place to sleep.`);
      }
    }
    if (prop(f, "fairy:state") === "flyingHome") {
      flyHome(f, night);
      continue;
    }
    if (player) follow(f, player, slot);
    dust(f, slot);
  }
}, 1);

// Fairies hang around nearby in their own way: they flutter to a spot a few blocks from you,
// hover there for a while, then pick a new spot. They only hurry when you get far away.
const NEAR_MIN = 1.6, NEAR_MAX = 3.8;   // where a fairy likes to hang out (blocks from you)
const WANDER_AFTER = 6;                 // farther than this and it comes looking for you
const BLINK_AFTER = 20;                 // farther than this and it pops over by magic
const plans = new Map();                // fairy id -> { target, waitUntil, hurry }

function openSpot(dim, spot) {
  try {
    const id = dim.getBlock(spot)?.typeId ?? "";
    return id === "" || id === "minecraft:air" || id.includes("light_block");
  } catch {
    return true;
  }
}

// A new hangout spot, usually on the same side of you as the fairy already is,
// so it drifts around you instead of zipping across your face.
function spotNear(player, slot, from) {
  const p = player.location;
  const base = from ? Math.atan2(from.z - p.z, from.x - p.x) : Math.random() * Math.PI * 2 + slot;
  for (let i = 0; i < 6; i++) {
    const angle = from ? base + (Math.random() - 0.5) * 1.6 : base + i;
    const r = NEAR_MIN + Math.random() * (NEAR_MAX - NEAR_MIN);
    const spot = { x: p.x + Math.cos(angle) * r, y: p.y + 0.9 + Math.random() * 1.3, z: p.z + Math.sin(angle) * r };
    if (openSpot(player.dimension, spot)) return spot;
  }
  return { x: p.x, y: p.y + 2, z: p.z };
}

function follow(f, player, slot) {
  const p = player.location;
  const cur = f.location;
  const flat = Math.hypot(cur.x - p.x, cur.z - p.z);
  const sameDim = f.dimension.id === player.dimension.id;
  const color = Number(prop(f, "fairy:color"));
  let plan = plans.get(f.id);

  if (!sameDim || dist(cur, p) > BLINK_AFTER) {
    const spot = spotNear(player, slot);
    if (sameDim) sparkle(f.dimension, cur, 4, color);
    try {
      f.teleport(spot, { dimension: player.dimension });
    } catch {}
    sparkle(player.dimension, spot, 4, color);
    plans.set(f.id, { target: spot, waitUntil: tick + 40, hurry: false });
    return;
  }

  const tooFar = flat > WANDER_AFTER || Math.abs(cur.y - p.y) > 4;
  const targetStale = plan && (Math.hypot(plan.target.x - p.x, plan.target.z - p.z) > NEAR_MAX + 1.5 || Math.abs(plan.target.y - p.y) > 3);
  if (!plan || (tooFar && !plan.hurry) || targetStale) {
    plan = { target: spotNear(player, slot, cur), waitUntil: 0, hurry: tooFar };
    plans.set(f.id, plan);
  }

  const arrived = dist(cur, plan.target) < 0.25;
  if (arrived && !plan.waitUntil) {
    // Hover here for a bit: 2 to 6 seconds.
    plan.waitUntil = tick + 40 + Math.floor(Math.random() * 80);
    plan.hurry = false;
  }
  if (plan.waitUntil && tick >= plan.waitUntil) {
    plans.set(f.id, { target: spotNear(player, slot, cur), waitUntil: 0, hurry: false });
    return;
  }
  if (plan.waitUntil) {
    // Hovering: a gentle bob in place, sometimes turning to look at you.
    const bob = { x: plan.target.x, y: plan.target.y + Math.sin((tick + slot * 17) * 0.09) * 0.06, z: plan.target.z };
    const look = (Math.atan2(-(p.x - cur.x), p.z - cur.z) * 180) / Math.PI;
    moveToward(f, bob, 0.1, 0.05, look);
    return;
  }
  // Flutter over: slow and floaty, quicker if catching up.
  moveToward(f, plan.target, plan.hurry ? 0.07 : 0.045, plan.hurry ? 0.55 : 0.2, 0);
}

// Glide part of the way to the target each tick, turning to face where it's going.
function moveToward(f, target, ease, maxStep, restYaw) {
  const cur = f.location;
  let dx = (target.x - cur.x) * ease, dy = (target.y - cur.y) * ease, dz = (target.z - cur.z) * ease;
  const step = Math.hypot(dx, dy, dz);
  if (step > maxStep) {
    dx *= maxStep / step;
    dy *= maxStep / step;
    dz *= maxStep / step;
  }
  const moving = Math.hypot(dx, dz) > 0.04;
  const wantYaw = moving ? (Math.atan2(-dx, dz) * 180) / Math.PI : restYaw;
  let yaw = wantYaw;
  try {
    const now = f.getRotation().y;
    let diff = ((wantYaw - now + 540) % 360) - 180;
    yaw = now + diff * 0.25;
  } catch {}
  try {
    f.teleport({ x: cur.x + dx, y: cur.y + dy, z: cur.z + dz }, { rotation: { x: 0, y: yaw } });
  } catch {}
}

function flyHome(f, night) {
  const home = getJSON(f, "fairy:home", null);
  const b = home && houseBlock(home);
  if (!night || !home || (b && b.typeId !== HOUSE)) {
    setProp(f, "fairy:state", "awake");
    return;
  }
  const door = { x: home.x + 0.5, y: home.y + 0.1, z: home.z + 0.5 };
  if (dist(f.location, door) < 0.5) {
    setProp(f, "fairy:state", "asleep");
    hide(f, true);
    setLit(home, true);
    playSound(f.dimension, "random.door_close", door, 1.6);
    sparkle(f.dimension, { x: door.x, y: door.y + 0.5, z: door.z }, 5, Number(prop(f, "fairy:color")));
    return;
  }
  // Fly up and over things, then drop down to the door.
  const flat = Math.hypot(door.x - f.location.x, door.z - f.location.z);
  const target = flat > 1.5 ? { x: door.x, y: Math.max(door.y + 1.5, f.location.y), z: door.z } : door;
  moveToward(f, target, 0.08, 0.35, 0);
  dust(f, 0);
}

function sleepTick(f, night) {
  const home = getJSON(f, "fairy:home", null);
  if (tick % 20 !== 3) return;
  const b = home && houseBlock(home);
  const houseGone = !home || (b && b.typeId !== HOUSE);
  if (night && !houseGone) {
    hide(f, true); // keep the invisibility topped up
    try {
      f.teleport({ x: home.x + 0.5, y: home.y + 0.1, z: home.z + 0.5 });
    } catch {}
    if (tick % 60 === 3 && b) {
      // A little glow drifting up from the roof while the fairy sleeps.
      dustAt(f.dimension, { x: home.x + 0.5, y: home.y + 1.1, z: home.z + 0.5 }, Number(prop(f, "fairy:color")));
    }
    return;
  }
  // Morning (or the house was broken): wake up and go find the owner.
  hide(f, false);
  setProp(f, "fairy:state", "awake");
  if (home && b && b.typeId === HOUSE) {
    const stillSleeping = fairies.some((o) => o !== f && alive(o) && prop(o, "fairy:state") === "asleep" &&
      JSON.stringify(getJSON(o, "fairy:home", null)) === JSON.stringify(home));
    if (!stillSleeping) setLit(home, false);
    playSound(f.dimension, "random.door_open", f.location, 1.6);
  }
  sparkle(f.dimension, { x: f.location.x, y: f.location.y + 0.4, z: f.location.z }, 6, Number(prop(f, "fairy:color")));
  const owner = String(prop(f, "fairy:owner") ?? "");
  tell(owner, houseGone && night
    ? `§d${fairyName(f)}§f's Fairy House is gone! ${she(f)[0].toUpperCase() + she(f).slice(1)} is coming back to you.`
    : `§eGood morning! §d${fairyName(f)}§f woke up and is flying over to find you.`);
}

function hide(f, on) {
  try {
    if (on) f.addEffect("invisibility", 20 * 60 * 15, { amplifier: 0, showParticles: false });
    else f.removeEffect("invisibility");
  } catch {}
}

// Tap a fairy: your own opens a little menu (twirl, or say goodbye); someone else's waves hello.
const menuOpen = new Set();
try {
  world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    const { target, player } = event;
    if (target?.typeId !== FAIRY) return;
    let holding;
    try {
      holding = player.getComponent("minecraft:inventory").container.getItem(player.selectedSlotIndex)?.typeId;
    } catch {}
    if (holding === "minecraft:name_tag") return; // let name tags rename the fairy
    event.cancel = true;
    system.run(() => {
      if (prop(target, "fairy:owner") === player.name) fairyMenu(player, target);
      else sayHi(player, target);
    });
  });
} catch {}

function describe(f) {
  return `${colorWord(Number(prop(f, "fairy:color")))}§r ${prop(f, "fairy:gender") ?? ""} fairy`;
}

async function fairyMenu(player, f) {
  if (!alive(f) || menuOpen.has(player.name)) return;
  menuOpen.add(player.name);
  try {
    refreshFairies();
    const mine = myFairies(player.name).filter((o) => prop(o, "fairy:state") !== "leaving");
    const name = fairyName(f);
    const options = [
      { label: `Twirl, ${name}!`, run: () => sayHi(player, f) },
      { label: `Say goodbye to ${name}`, run: () => goodbye(player, [f]) },
    ];
    if (mine.length > 1) options.push({ label: `Say goodbye to all ${mine.length} of my fairies`, run: () => goodbye(player, mine) });
    options.push({ label: "Never mind", run: () => {} });
    const form = new ActionFormData().title(name).body(`§fThis is §d${name}§r, your ${describe(f)}.\n\nYou have ${mine.length} ${mine.length === 1 ? "fairy" : "fairies"}.`);
    options.forEach((o) => form.button(o.label));
    const res = await form.show(player);
    if (res.canceled || res.selection === undefined) return;
    await options[res.selection].run();
  } catch {
  } finally {
    menuOpen.delete(player.name);
  }
}

async function goodbye(player, list) {
  const names = list.length === 1 ? fairyName(list[0]) : `all ${list.length} fairies`;
  const res = await new ActionFormData()
    .title("Say goodbye?")
    .body(`§fAre you sure? ${list.length === 1 ? `§d${names}§f` : `Your ${names}`} will fly away home to Fairy Land and won't come back.\n\nYou can always hatch a new Fairy Egg.`)
    .button(`§cYes, say goodbye`)
    .button("§2No, stay with me!")
    .show(player);
  if (res.canceled || res.selection !== 0) {
    player.sendMessage(`§d${list.map(fairyName).join(", ")}§f ${list.length === 1 ? "is" : "are"} so happy to stay with you!`);
    return;
  }
  list.forEach((f, i) => {
    if (!alive(f)) return;
    hide(f, false);
    setProp(f, "fairy:state", "leaving");
    setProp(f, "fairy:leaveAge", -i * 6); // leave one after another
  });
  player.sendMessage(list.length === 1
    ? `§d${names}§f waves goodbye and flies away home to Fairy Land. Bye-bye, ${names}!`
    : `§fYour fairies wave goodbye and fly away home to Fairy Land. Bye-bye!`);
  playSound(player.dimension, "random.levelup", player.location, 1.8);
}

// Fly up in a spiral of sparkles, then pop away.
function leaveTick(f) {
  const age = (Number(prop(f, "fairy:leaveAge")) || 0) + 1;
  setProp(f, "fairy:leaveAge", age);
  if (age < 0) return;
  const l = f.location;
  const a = age * 0.35;
  try {
    f.teleport({ x: l.x + Math.cos(a) * 0.12, y: l.y + 0.09, z: l.z + Math.sin(a) * 0.12 }, { rotation: { x: 0, y: age * 25 } });
  } catch {}
  dustAt(f.dimension, { x: l.x, y: l.y + 0.2, z: l.z }, Number(prop(f, "fairy:color")), age * 0.05);
  if (age >= 50) {
    sparkle(f.dimension, l, 16, Number(prop(f, "fairy:color")));
    playSound(f.dimension, "random.pop", l, 1.6);
    try {
      f.remove();
    } catch {}
  }
}

function sayHi(player, f) {
  if (!alive(f)) return;
  const owner = prop(f, "fairy:owner");
  const color = Number(prop(f, "fairy:color"));
  const what = describe(f);
  if (owner === player.name) {
    player.sendMessage(`§d${fairyName(f)}§f, your ${what}§f, does a happy twirl!`);
    try {
      f.dimension.spawnParticle("minecraft:heart_particle", { x: f.location.x, y: f.location.y + 0.9, z: f.location.z });
    } catch {}
  } else {
    player.sendMessage(`§fThis is §d${fairyName(f)}§f, ${owner}'s ${what}§f. ${she(f)[0].toUpperCase() + she(f).slice(1)} waves hello!`);
  }
  sparkle(f.dimension, { x: f.location.x, y: f.location.y + 0.4, z: f.location.z }, 8, color);
  playSound(f.dimension, "note.chime", f.location, 1.6 + Math.random() * 0.4);
}

// ---------- Fairy dust ----------
function rgbFor(color, seed) {
  if (color !== RAINBOW && COLORS[color]?.rgb) return COLORS[color].rgb;
  const h = ((tick * 0.015 + seed) % 1 + 1) % 1;
  const k = (n) => (n + h * 6) % 6;
  const f = (n) => 1 - Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return { red: 0.35 + f(5) * 0.65, green: 0.35 + f(3) * 0.65, blue: 0.35 + f(1) * 0.65 };
}

function dust(f, slot) {
  if (tick % 3 !== slot % 3) return;
  const l = f.location;
  dustAt(f.dimension, { x: l.x, y: l.y + 0.25, z: l.z }, Number(prop(f, "fairy:color")), slot * 0.13);
}

function dustAt(dim, loc, color, seed = 0) {
  try {
    const vars = new MolangVariableMap();
    vars.setColorRGB("variable.color", rgbFor(color, seed + Math.random() * 0.1));
    dim.spawnParticle("fairy:dust", loc, vars);
  } catch {}
}

function sparkle(dim, loc, count, color = RAINBOW) {
  for (let i = 0; i < count; i++) {
    dustAt(dim, {
      x: loc.x + (Math.random() - 0.5) * 0.8, y: loc.y + Math.random() * 0.6, z: loc.z + (Math.random() - 0.5) * 0.8,
    }, Number.isFinite(color) ? color : RAINBOW, Math.random());
  }
}

function playSound(dim, id, location, pitch) {
  try {
    dim.playSound(id, location, { pitch, volume: 1 });
  } catch {
    try {
      world.playSound(id, location, { pitch, volume: 1 });
    } catch {}
  }
}

// =====================================================================
// Fairy light: in dark places (night, caves, unlit houses, thick forest)
// the fairy carries an invisible light block with it so the area glows.
// =====================================================================
const LIGHTS_PER_PLAYER = 2;   // the first two fairies of each player glow
const LIGHT_LEVEL = 14;
const lights = new Map();      // fairy id -> { dim, x, y, z }
const darkness = new Map();    // player name -> { dark, streak, at }

const LIGHT_SOURCES = ["torch", "lantern", "glowstone", "sea_lantern", "shroomlight", "froglight", "lit_redstone_lamp",
  "campfire", "fire", "lava", "lit_pumpkin", "jack_o_lantern", "end_rod", "beacon", "lit_furnace", "lit_smoker",
  "lit_blast_furnace", "candle", "glow_lichen", "crying_obsidian", "magma", "conduit", "respawn_anchor", "redstone_lamp"];
const isLightSource = (id) => !id.includes("light_block") && LIGHT_SOURCES.some((w) => id.includes(w)) &&
  (id !== "minecraft:redstone_lamp"); // an unlit lamp gives no light
const SEE_THROUGH = ["air", "glass", "light_block", "short_grass", "tall_grass", "flower", "vine", "torch", "rail", "button", "carpet"];

function lightPerm() {
  for (const [id, states] of [
    [`minecraft:light_block_${LIGHT_LEVEL}`, undefined],
    ["minecraft:light_block", { block_light_level: LIGHT_LEVEL }],
  ]) {
    try {
      return BlockPermutation.resolve(id, states);
    } catch {}
  }
  return undefined;
}
let LIGHT;
const AIR = () => {
  try {
    return BlockPermutation.resolve("minecraft:air");
  } catch {
    return undefined;
  }
};

// Is there a roof (blocks, leaves, a cave ceiling) over this spot?
function covered(dim, x, y, z) {
  for (let dy = 2; dy <= 24; dy++) {
    try {
      const b = dim.getBlock({ x, y: y + dy, z });
      if (!b) return false;
      const id = b.typeId;
      if (!SEE_THROUGH.some((w) => id.includes(w))) return true;
    } catch {
      return false;
    }
  }
  return false;
}

// Blocks light shines through (for checking whether a lamp can actually reach you).
const LIGHT_PASSES = [...SEE_THROUGH, "leaves", "door", "pane", "fence", "sign", "ladder", "chain", "lantern", "candle",
  "sapling", "fern", "tulip", "poppy", "dandelion", "banner", "flower_pot", "water", "snow_layer", "bed", "scaffolding"];
const passes = (id) => LIGHT_PASSES.some((w) => id.includes(w));

function isLitSource(block) {
  const id = block.typeId;
  if (!isLightSource(id) || id.includes("torchflower") || id.includes("coral") || id.includes("unlit")) return false;
  try {
    if (block.permutation.getState("lit") === false) return false; // an unlit candle or campfire
  } catch {}
  return true;
}

// Can light from this block reach your head, or is there a wall in the way?
function canReach(dim, from, to) {
  const d = dist(from, to);
  const steps = Math.ceil(d * 3);
  for (let i = 1; i < steps; i++) {
    const k = i / steps;
    const at = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: from.z + (to.z - from.z) * k };
    if (Math.floor(at.x) === Math.floor(to.x) && Math.floor(at.y) === Math.floor(to.y) && Math.floor(at.z) === Math.floor(to.z)) return true;
    try {
      const id = dim.getBlock(at)?.typeId;
      if (id && !passes(id)) return false;
    } catch {}
  }
  return true;
}

function measureDark(player) {
  const dim = player.dimension;
  const p = { x: Math.floor(player.location.x), y: Math.floor(player.location.y), z: Math.floor(player.location.z) };
  const head = { x: player.location.x, y: player.location.y + 1.5, z: player.location.z };
  // A torch, lantern, lava... close by that can actually shine on you means it's not dark here.
  // Lights behind a wall (in the next room) don't count.
  for (let dx = -5; dx <= 5; dx++) {
    for (let dz = -5; dz <= 5; dz++) {
      for (let dy = -3; dy <= 4; dy++) {
        try {
          const b = dim.getBlock({ x: p.x + dx, y: p.y + dy, z: p.z + dz });
          if (b && isLitSource(b) && canReach(dim, head, { x: p.x + dx + 0.5, y: p.y + dy + 0.5, z: p.z + dz + 0.5 })) return false;
        } catch {}
      }
    }
  }
  const t = world.getTimeOfDay();
  const nightSky = t >= 12800 && t < 23200;
  if (dim.id !== "minecraft:overworld") return true; // the Nether and the End are gloomy everywhere
  if (nightSky) return true;
  // Daytime: dark only if there's a roof over us and around us (a cave, a house, a thick forest).
  let roofs = 0;
  for (const [dx, dz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) if (covered(dim, p.x + dx, p.y, p.z + dz)) roofs++;
  return roofs >= 4;
}

function isDarkFor(player) {
  let d = darkness.get(player.name);
  if (!d || tick - d.at >= 10) {
    const now = measureDark(player);
    if (!d) d = { dark: now, streak: 0, at: tick };
    // Lights up right away when it gets dark; waits for two bright readings in a row before
    // turning off, so walking past one tree or a window doesn't make it flicker.
    if (now !== d.dark) {
      d.streak++;
      if (now || d.streak >= 2) {
        d.dark = now;
        d.streak = 0;
        if (now) {
          const glowing = myFairies(player.name).filter((f) => prop(f, "fairy:state") === "awake").slice(0, LIGHTS_PER_PLAYER);
          if (glowing.length) {
            try {
              player.onScreenDisplay.setActionBar(`§d${glowing.map(fairyName).join(" and ")}§f ${glowing.length === 1 ? "glows" : "glow"} to light the way!`);
            } catch {}
          }
        }
      }
    } else d.streak = 0;
    d.at = tick;
    darkness.set(player.name, d);
  }
  return d.dark;
}

function updateLight(f, wanted) {
  const old = lights.get(f.id);
  if (!wanted) {
    if (old) removeLight(f.id);
    return;
  }
  const l = f.location;
  const fx = Math.floor(l.x), fy = Math.floor(l.y + 0.3), fz = Math.floor(l.z);
  if (old && old.dim === f.dimension.id && old.x === fx && Math.abs(old.y - fy) <= 1 && old.z === fz) return;
  LIGHT ??= lightPerm();
  if (!LIGHT) return;
  // The fairy's own spot, or just above or below it: only empty air (never replace blocks or water).
  let b, spot;
  for (const dy of [0, 1, -1]) {
    try {
      const c = f.dimension.getBlock({ x: fx, y: fy + dy, z: fz });
      if (c && c.typeId === "minecraft:air") {
        b = c;
        spot = { x: fx, y: fy + dy, z: fz };
        break;
      }
    } catch {}
  }
  if (!b) return;
  if (old) removeLight(f.id);
  try {
    b.setPermutation(LIGHT);
    lights.set(f.id, { dim: f.dimension.id, ...spot });
    saveLights();
  } catch {}
}

function removeLight(id) {
  const old = lights.get(id);
  lights.delete(id);
  if (!old) return;
  clearLightAt(old);
  saveLights();
}

function clearLightAt(at) {
  try {
    const b = world.getDimension(at.dim).getBlock({ x: at.x, y: at.y, z: at.z });
    if (b && b.typeId.includes("light_block")) b.setPermutation(AIR());
  } catch {}
}

// Remember where lights are, so any left behind (game closed, fairy gone) get cleaned up next time.
const saveLights = () => setJSON(world, "fairy:lights", [...lights.values()]);
let leftovers = getJSON(world, "fairy:lights", []);
system.runInterval(() => {
  if (leftovers.length) {
    leftovers = leftovers.filter((at) => {
      try {
        const b = world.getDimension(at.dim).getBlock({ x: at.x, y: at.y, z: at.z });
        if (!b) return true; // not loaded yet; try again later
        if (b.typeId.includes("light_block")) b.setPermutation(AIR());
      } catch {}
      return false;
    });
    if (!leftovers.length) saveLights();
  }
  for (const [id] of lights) {
    if (!fairies.some((f) => f.id === id && alive(f))) removeLight(id);
  }
}, 40);

// =====================================================================
// Monster shoo: hostile mobs that come close get zapped with sparkles
// and bounced away. No damage, just "go away!"
// =====================================================================
const SHOO_RANGE = 6;
const lastShoo = new Map(); // mob id -> tick
const NO_SHOO = ["minecraft:ender_dragon", "minecraft:wither"];
const mobName = (e) => e.typeId.split(":")[1].replace(/_v2$/, "").replace(/_/g, " ");

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const helpers = myFairies(player.name).filter((f) => prop(f, "fairy:state") === "awake" &&
      f.dimension.id === player.dimension.id && dist(f.location, player.location) < 10);
    if (!helpers.length) continue;
    let mobs = [];
    try {
      mobs = player.dimension.getEntities({ location: player.location, maxDistance: SHOO_RANGE, families: ["monster"] });
    } catch {}
    let n = 0;
    for (const mob of mobs) {
      if (NO_SHOO.includes(mob.typeId) || (lastShoo.get(mob.id) ?? -999) > tick - 30) continue;
      lastShoo.set(mob.id, tick);
      shoo(helpers[n++ % helpers.length], mob, player);
    }
  }
  if (lastShoo.size > 200) lastShoo.clear();
}, 10);

function shoo(f, mob, player) {
  const color = Number(prop(f, "fairy:color"));
  const from = { x: f.location.x, y: f.location.y + 0.2, z: f.location.z };
  const to = { x: mob.location.x, y: mob.location.y + 1, z: mob.location.z };
  // A sparkly zap from the fairy to the monster.
  const steps = Math.max(3, Math.ceil(dist(from, to) * 3));
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    dustAt(f.dimension, { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: from.z + (to.z - from.z) * k }, color, k);
  }
  sparkle(f.dimension, to, 8, color);
  playSound(f.dimension, "note.chime", to, 2);
  playSound(f.dimension, "random.orb", to, 0.6);
  // Bounce the monster away from the player.
  let dx = mob.location.x - player.location.x, dz = mob.location.z - player.location.z;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  try {
    mob.applyKnockback(dx, dz, 2.6, 0.45);
  } catch {
    try {
      mob.applyKnockback({ x: dx * 2.6, z: dz * 2.6 }, 0.45);
    } catch {}
  }
  // The fairy darts toward the monster for a moment, then goes back to hanging around.
  plans.set(f.id, { target: { x: (from.x + to.x) / 2, y: from.y, z: (from.z + to.z) / 2 }, waitUntil: 0, hurry: true });
  try {
    player.onScreenDisplay.setActionBar(`§d${fairyName(f)}§f shooed away a ${mobName(mob)}!`);
  } catch {}
}
