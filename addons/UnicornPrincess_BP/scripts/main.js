// Unicorn Princess: once or twice every Minecraft day, trumpets play and a princess rides by on her
// white unicorn (rainbow mane, rainbow tail, rainbow horn), leaving a trail of rainbow glitter.
// Walk up within 3 blocks of her and she stops, waves, and drops treasures for you.
// Testing (cheats on): /scriptevent unicorn:visit   brings her right away.
import { world, system, ItemStack, MolangVariableMap } from "@minecraft/server";

const UNICORN = "unicorn:princess";
const PRINCESSES = ["Rosalie", "Violet", "Marina", "Sunny"]; // entity variants 0-3 (gown colors in the resource pack)
const UNICORN_NAMES = ["Moonbeam", "Stardust", "Sparkle", "Twinkle", "Snowflake", "Glimmer", "Bluebell", "Cupcake"];

const GIFT_RANGE = 3;         // blocks: this close and the princess shares her treasures
const START_DIST = 26;        // she appears this far from the player...
const PASS_SIDE = 4;          // ...and rides past this far to one side, so you get to walk up to her
const LEAVE_DIST = 28;        // after passing, she rides on this far and vanishes in a sparkle
const SPEED = 0.1;            // blocks per tick (2 blocks a second)
const SLOW_SPEED = 0.05;      // near someone who hasn't had a treasure yet
const TURN = 3;               // degrees per tick
const APPROACH_TICKS = 20 * 45;
const MAX_TICKS = 20 * 120;
const PAUSE_TICKS = 70;       // how long she stops to say hi
const HEAR_RANGE = 96;        // who hears the trumpets
const DAY_START = 1000, DAY_END = 11000, MIN_GAP = 3000; // visit times (morning to late afternoon)

// ---------- Saved data ----------
function getJSON(k, fallback) {
  try {
    const raw = world.getDynamicProperty(k);
    if (typeof raw === "string") return JSON.parse(raw);
  } catch {}
  return fallback;
}
function setJSON(k, value) {
  try {
    world.setDynamicProperty(k, value === undefined ? undefined : JSON.stringify(value));
  } catch {}
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ---------- Treasures ----------
// One shiny thing every time, plus two surprises. Higher weight = more common.
const SHINY = [
  { id: "minecraft:gold_ingot", count: [3, 6], weight: 3 },
  { id: "minecraft:emerald", count: [3, 6], weight: 3 },
  { id: "minecraft:diamond", count: [1, 3], weight: 3 },
  { id: "minecraft:golden_apple", count: [1, 2], weight: 2 },
  { id: "minecraft:amethyst_shard", count: [4, 8], weight: 2 },
];
const EXTRAS = [
  { id: "minecraft:diamond", count: [1, 2], weight: 3 },
  { id: "minecraft:emerald", count: [2, 4], weight: 3 },
  { id: "minecraft:gold_ingot", count: [2, 4], weight: 3 },
  { id: "flowers", count: [3, 6], weight: 3 },
  { id: "minecraft:golden_apple", count: [1, 1], weight: 2 },
  { id: "minecraft:golden_carrot", count: [2, 4], weight: 2 },
  { id: "minecraft:cake", count: [1, 1], weight: 2 },
  { id: "minecraft:cookie", count: [6, 10], weight: 2 },
  { id: "minecraft:firework_rocket", count: [3, 6], weight: 2 },
  { id: "minecraft:name_tag", count: [1, 1], weight: 2 },
  { id: "pet", count: [1, 1], weight: 2 },
  { id: "minecraft:glow_berries", count: [4, 8], weight: 1 },
  { id: "minecraft:honey_bottle", count: [2, 3], weight: 1 },
  { id: "disc", count: [1, 1], weight: 1 },
  { id: "minecraft:golden_horse_armor", count: [1, 1], weight: 1 },
  { id: "crown", count: [1, 1], weight: 1 },
  { id: "minecraft:diamond_horse_armor", count: [1, 1], weight: 0.4 },
  { id: "minecraft:enchanted_golden_apple", count: [1, 1], weight: 0.4 },
  { id: "minecraft:totem_of_undying", count: [1, 1], weight: 0.4 },
];
const FLOWERS = ["minecraft:pink_tulip", "minecraft:allium", "minecraft:cornflower", "minecraft:lily_of_the_valley",
  "minecraft:oxeye_daisy", "minecraft:pink_petals", "minecraft:blue_orchid"];
const PETS = ["minecraft:cat_spawn_egg", "minecraft:parrot_spawn_egg", "minecraft:rabbit_spawn_egg",
  "minecraft:fox_spawn_egg", "minecraft:axolotl_bucket", "minecraft:wolf_spawn_egg"];
const DISCS = ["cat", "blocks", "chirp", "mall", "mellohi", "far", "strad", "wait"].map((d) => `minecraft:music_disc_${d}`);
const JACKPOTS = ["crown", "minecraft:diamond_horse_armor", "minecraft:enchanted_golden_apple", "minecraft:totem_of_undying"];

function weighted(bag) {
  let roll = Math.random() * bag.reduce((s, g) => s + g.weight, 0);
  const i = bag.findIndex((g) => (roll -= g.weight) < 0);
  return bag[i < 0 ? 0 : i];
}

// Returns [[id, count], ...]: one shiny thing and two different surprises.
function drawTreasure() {
  const first = weighted(SHINY);
  const out = [[first.id, rint(first.count[0], first.count[1])]];
  const bag = EXTRAS.filter((g) => g.id !== first.id);
  while (out.length < 3 && bag.length) {
    const g = weighted(bag);
    bag.splice(bag.indexOf(g), 1);
    const id = g.id === "flowers" ? pick(FLOWERS) : g.id === "pet" ? pick(PETS) : g.id === "disc" ? pick(DISCS) : g.id;
    out.push([id, rint(g.count[0], g.count[1])]);
  }
  return out;
}

function treasureName([id, n]) {
  if (id === "crown") return "a Princess Crown";
  if (id === "minecraft:axolotl_bucket") return "an axolotl in a bucket";
  const name = id.split(":")[1].replace("_spawn_egg", " egg").replace("music_disc_", "music disc: ").replace(/_/g, " ");
  if (n === 1) return `${/^[aeiou]/.test(name) ? "an" : "a"} ${name}`;
  if (name.endsWith("s")) return `${n} ${name}`;                      // glow berries, pink petals
  if (name === "lily of the valley") return `${n} lilies of the valley`;
  if (name.endsWith("y")) return `${n} ${name.slice(0, -1)}ies`;      // daisies
  return `${n} ${name}s`;
}

function makeItem([id, n], princess) {
  try {
    if (id === "crown") {
      const crown = new ItemStack("minecraft:golden_helmet", 1);
      try { crown.nameTag = "§6Princess Crown"; } catch {}
      try { crown.setLore([`§dA gift from Princess ${princess}`]); } catch {}
      return crown;
    }
    return new ItemStack(id, n);
  } catch {
    return new ItemStack("minecraft:gold_ingot", 3); // an item this version doesn't know: gold instead
  }
}

// ---------- When she visits ----------
// A plan for each Minecraft day: 1 or 2 visit times. Saved, so reloading the world doesn't add extra visits.
function planDay(day, now) {
  const earliest = Math.max(DAY_START, now + 600);
  if (earliest > DAY_END - 400) return { day, times: [Math.min(now + 400, 23500)], done: 0 }; // late in the day: one visit soon
  const times = [];
  if (Math.random() < 0.5 && earliest <= DAY_END - MIN_GAP) {
    const a = rint(earliest, DAY_END - MIN_GAP);
    times.push(a, rint(a + MIN_GAP, DAY_END));
  } else {
    times.push(rint(earliest, DAY_END));
  }
  return { day, times, done: 0 };
}

let visit = null;

system.runInterval(() => {
  if (visit) return;
  const day = world.getDay(), t = world.getTimeOfDay();
  let plan = getJSON("unicorn:plan", null);
  if (!plan || plan.day !== day) {
    plan = planDay(day, t);
    setJSON("unicorn:plan", plan);
  }
  if (plan.done >= plan.times.length || t < plan.times[plan.done]) return;
  // Late in the day with no visit yet: she'll find you even if you're indoors or underground.
  const target = choosePlayer(plan.done === 0 && t >= DAY_END + 500);
  if (target && startVisit(target)) {
    plan.done++;
    setJSON("unicorn:plan", plan);
  }
}, 40);

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

// Outside (nothing solid over your head), so the unicorn can ride up to you.
function openSky(p) {
  const x = Math.floor(p.location.x), z = Math.floor(p.location.z), y0 = Math.floor(p.location.y) + 2;
  for (let y = y0; y < y0 + 24; y++) {
    const id = blockAt(p.dimension, x, y, z);
    if (id === undefined) return true; // above the world or not loaded: open
    if (!isClear(id)) return false;
  }
  return true;
}

// ---------- Ground ----------
// Things a unicorn walks right through: air, plants, flowers, snow, leaves, torches.
const CLEAR = /(^|:)air$|short_grass|tall_grass|^minecraft:grass$|fern|flower|tulip|poppy|dandelion|orchid|allium|bluet|daisy|cornflower|lily_of_the_valley|bush|snow_layer|leaves|vine|sapling|torch|sugar_cane|light_block|petals|structure_void|wildflowers|leaf_litter/;
const isClear = (id) => CLEAR.test(id);

function blockAt(dim, x, y, z) {
  try {
    return dim.getBlock({ x, y, z })?.typeId;
  } catch {
    return undefined;
  }
}

// The standing height (top of the ground; water and lava count, she's magic) closest to nearY, or undefined.
function groundY(dim, x, z, nearY, range) {
  const bx = Math.floor(x), bz = Math.floor(z), y0 = Math.floor(nearY);
  let above = blockAt(dim, bx, y0 + range + 1, bz);
  let best;
  for (let y = y0 + range; y >= y0 - range; y--) {
    const id = blockAt(dim, bx, y, bz);
    if (id === undefined) return best;
    if (above !== undefined && isClear(above) && !isClear(id)) {
      if (best === undefined || Math.abs(y + 1 - nearY) < Math.abs(best - nearY)) best = y + 1;
    }
    above = id;
  }
  return best;
}

// ---------- The visit ----------
function startVisit(target) {
  const dim = target.dimension, p = target.location;
  let start;
  for (let i = 0; i < 12 && !start; i++) {
    const a = Math.random() * Math.PI * 2;
    const x = p.x + Math.cos(a) * START_DIST, z = p.z + Math.sin(a) * START_DIST;
    const y = groundY(dim, x, z, p.y, 12);
    if (y !== undefined) start = { x, y, z };
  }
  if (!start) {
    const a = Math.random() * Math.PI * 2; // nowhere to ride in from (caves, deep water): appear nearby with a sparkle
    start = { x: p.x + Math.cos(a) * 12, y: p.y, z: p.z + Math.sin(a) * 12 };
  }
  let entity;
  try {
    entity = dim.spawnEntity(UNICORN, start);
  } catch (e) {
    console.warn(`[Unicorn Princess] Could not bring the unicorn: ${e}`);
    return false;
  }
  const variant = rint(0, PRINCESSES.length - 1);
  const princess = PRINCESSES[variant], uni = pick(UNICORN_NAMES);
  try { entity.triggerEvent(`unicorn:princess_${variant}`); } catch {}
  try { entity.triggerEvent("unicorn:walk"); } catch {}
  try { entity.nameTag = `§dPrincess ${princess}\n§fand ${uni}`; } catch {}

  const len = Math.max(0.01, flat(start, p));
  const dir = { x: (p.x - start.x) / len, z: (p.z - start.z) / len };
  const side = Math.random() < 0.5 ? 1 : -1;
  visit = {
    entity, dim, princess, uni, targetId: target.id, pos: { ...start },
    heading: Math.atan2(dir.z, dir.x), perp: { x: -dir.z * side, z: dir.x * side },
    phase: "approach", tick: 0, leaveLeft: LEAVE_DIST, gifted: new Set(), pause: 0, giftTo: null, color: 0,
  };
  turnTo(visit, visit.heading);

  const hearers = world.getAllPlayers().filter((pl) => pl.dimension.id === dim.id && flat(pl.location, p) < HEAR_RANGE);
  for (const pl of hearers) {
    try {
      pl.onScreenDisplay.setTitle("§dA Princess is Coming!", {
        subtitle: `§fPrincess ${princess} and her unicorn ${uni}`, fadeInDuration: 10, stayDuration: 70, fadeOutDuration: 20,
      });
      pl.sendMessage(`§6*Trumpets play* §dPrincess ${princess} is riding by on her unicorn ${uni}! §fWalk up close to say hi!`);
    } catch {}
  }
  playFanfare(hearers);
  sparkleBurst(dim, start, 24);
  playAt(dim, "mob.horse.idle", start, 1.3);
  visit.run = system.runInterval(step, 1);
  return true;
}

// Royal fanfare (made up for this add-on): short-short-short-LONG, then up the chord.
// [semitones from F#4, ticks]; null = rest.
const FANFARE = [[-2, 3], [-2, 3], [-2, 3], [3, 10], [null, 4], [-2, 4], [3, 4], [7, 12], [3, 4], [7, 4], [10, 24]];

function playFanfare(players) {
  let at = 0;
  for (const [semi, len] of FANFARE) {
    if (semi !== null) {
      const pitch = Math.pow(2, semi / 12), long = len >= 10;
      system.runTimeout(() => {
        for (const p of players) {
          try {
            p.playSound("note.bit", { pitch, volume: 0.55 });   // brassy
            p.playSound("note.flute", { pitch, volume: 0.8 });  // warm
            p.playSound("note.harp", { pitch, volume: 0.5 });   // crisp start
            if (long) p.playSound("note.bass", { pitch: Math.pow(2, 3 / 12), volume: 0.9 }); // A underneath
          } catch {}
        }
      }, at + 1);
    }
    at += len;
  }
}

const RAINBOW = [[0.94, 0.27, 0.34], [1, 0.59, 0.24], [1, 0.87, 0.28], [0.41, 0.82, 0.43], [0.31, 0.63, 1], [0.59, 0.4, 0.91], [0.98, 0.51, 0.78]];

function glitter(dim, loc, colorIndex) {
  try {
    const c = RAINBOW[colorIndex % RAINBOW.length];
    const vars = new MolangVariableMap();
    vars.setColorRGB("variable.color", { red: c[0], green: c[1], blue: c[2] });
    dim.spawnParticle("unicorn:glitter", loc, vars);
  } catch {}
}

function sparkleBurst(dim, loc, n) {
  for (let i = 0; i < n; i++) {
    glitter(dim, { x: loc.x + (Math.random() - 0.5) * 2, y: loc.y + Math.random() * 2.6, z: loc.z + (Math.random() - 0.5) * 2 }, i);
  }
  try { dim.spawnParticle("minecraft:totem_particle", { x: loc.x, y: loc.y + 1.5, z: loc.z }); } catch {}
}

function playAt(dim, id, loc, pitch) {
  try {
    world.playSound(id, loc, { pitch, volume: 1 });
  } catch {}
}

function turnTo(v, heading, toward) {
  v.heading = heading;
  const dx = Math.cos(toward ?? heading), dz = Math.sin(toward ?? heading);
  try {
    v.entity.teleport(v.pos, { rotation: { x: 0, y: (Math.atan2(-dx, dz) * 180) / Math.PI } });
  } catch {}
}

function alive(e) {
  try {
    return typeof e.isValid === "function" ? e.isValid() : e.isValid !== false;
  } catch {
    return false;
  }
}

function step() {
  const v = visit;
  if (!v) return;
  v.tick++;
  if (!alive(v.entity)) return endVisit(false);
  const players = world.getAllPlayers().filter((p) => {
    try { return p.dimension.id === v.dim.id; } catch { return false; }
  });
  if (v.tick > MAX_TICKS || !players.some((p) => flat(p.location, v.pos) < HEAR_RANGE)) return endVisit(true);

  // Stopped to say hi and share treasures.
  if (v.pause > 0) {
    v.pause--;
    const friend = v.giftTo;
    if (friend) {
      try { turnTo(v, v.heading, Math.atan2(friend.location.z - v.pos.z, friend.location.x - v.pos.x)); } catch {}
    }
    if (v.pause === PAUSE_TICKS - 20) dropTreasure(v, friend);
    if (v.tick % 6 === 0) glitter(v.dim, { x: v.pos.x, y: v.pos.y + 0.3, z: v.pos.z }, v.color++);
    if (v.pause === 0) {
      v.giftTo = null;
      try { v.entity.triggerEvent("unicorn:walk"); } catch {}
    }
    return;
  }

  // Someone came close: stop and wave.
  const friend = players.find((p) => !v.gifted.has(p.id) && flat(p.location, v.pos) <= GIFT_RANGE && Math.abs(p.location.y - v.pos.y) <= 3);
  if (friend) {
    v.gifted.add(friend.id);
    v.giftTo = friend;
    v.pause = PAUSE_TICKS;
    try { v.entity.triggerEvent("unicorn:stop"); } catch {}
    const lines = [
      `Hello, ${friend.name}! I brought treasures just for you!`,
      `Hi ${friend.name}! ${v.uni} wanted to say hello! These sparkly things are for you!`,
      `Oh, hello ${friend.name}! A princess always shares her treasures!`,
      `${friend.name}! What a lovely day for a ride! Here's a present!`,
    ];
    try { friend.sendMessage(`§dPrincess ${v.princess}: §f${pick(lines)}`); } catch {}
    playAt(v.dim, "mob.horse.idle", v.pos, 1.4);
    for (let i = 0; i < 4; i++) {
      try {
        v.dim.spawnParticle("minecraft:heart_particle", { x: v.pos.x + (Math.random() - 0.5), y: v.pos.y + 2.9 + Math.random() * 0.4, z: v.pos.z + (Math.random() - 0.5) });
      } catch {}
    }
    if (friend.id === v.targetId && v.phase === "approach") v.phase = "leave"; // said hi: ride on afterwards
    return;
  }

  // Steering: ride toward a spot beside the player, then carry on past.
  if (v.phase === "approach") {
    const target = players.find((p) => p.id === v.targetId);
    if (!target || v.tick > APPROACH_TICKS) {
      v.phase = "leave";
    } else {
      const goal = { x: target.location.x + v.perp.x * PASS_SIDE, z: target.location.z + v.perp.z * PASS_SIDE };
      const gx = goal.x - v.pos.x, gz = goal.z - v.pos.z;
      const ahead = gx * Math.cos(v.heading) + gz * Math.sin(v.heading);
      if (Math.hypot(gx, gz) < 1.5 || (ahead < 0 && Math.hypot(gx, gz) < 6)) {
        v.phase = "leave";
      } else {
        let diff = Math.atan2(gz, gx) - v.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const max = (TURN * Math.PI) / 180;
        v.heading += Math.max(-max, Math.min(max, diff));
      }
    }
  }
  const waiting = players.some((p) => !v.gifted.has(p.id) && flat(p.location, v.pos) < 8);
  const speed = waiting ? SLOW_SPEED : SPEED;
  const nx = v.pos.x + Math.cos(v.heading) * speed, nz = v.pos.z + Math.sin(v.heading) * speed;
  const gy = groundY(v.dim, nx, nz, v.pos.y, 4);
  v.pos = { x: nx, y: gy === undefined ? v.pos.y : v.pos.y + Math.max(-0.25, Math.min(0.25, gy - v.pos.y)), z: nz };
  turnTo(v, v.heading);
  if (v.phase === "leave" && (v.leaveLeft -= speed) <= 0) return endVisit(true);

  // Rainbow glitter from her hooves and tail.
  if (v.tick % 2 === 0) {
    const bx = -Math.cos(v.heading), bz = -Math.sin(v.heading);
    glitter(v.dim, { x: v.pos.x + (Math.random() - 0.5) * 0.9, y: v.pos.y + 0.15, z: v.pos.z + (Math.random() - 0.5) * 0.9 }, v.color);
    glitter(v.dim, { x: v.pos.x + bx * 1.0, y: v.pos.y + 0.9, z: v.pos.z + bz * 1.0 }, v.color + 3);
    v.color++;
  }
  if (v.tick % 10 === 0) {
    const fx = Math.cos(v.heading), fz = Math.sin(v.heading);
    glitter(v.dim, { x: v.pos.x + fx * 1.3, y: v.pos.y + 2.3, z: v.pos.z + fz * 1.3 }, v.color + 5); // horn
  }
  // Remind anyone nearby who hasn't said hi yet.
  if (v.tick % 40 === 0) {
    for (const p of players) {
      if (v.gifted.has(p.id) || flat(p.location, v.pos) > 20) continue;
      try { p.onScreenDisplay.setActionBar(`§dWalk up to Princess ${v.princess} to say hi!`); } catch {}
    }
  }
}

function dropTreasure(v, friend) {
  if (!friend) return;
  const treasure = drawTreasure();
  let at;
  try {
    at = friend.location;
  } catch {
    return;
  }
  // Tossed from the princess's hands toward you.
  const loc = { x: v.pos.x + (at.x - v.pos.x) * 0.5, y: v.pos.y + 2.2, z: v.pos.z + (at.z - v.pos.z) * 0.5 };
  for (const t of treasure) {
    try { v.dim.spawnItem(makeItem(t, v.princess), loc); } catch {}
  }
  sparkleBurst(v.dim, loc, 16);
  playAt(v.dim, "random.levelup", at, 1.3);
  [0, 4, 8, 12].forEach((d, i) => system.runTimeout(() => {
    try { friend.playSound("note.chime", { pitch: Math.pow(2, [0, 4, 7, 12][i] / 12), volume: 0.8 }); } catch {}
  }, d + 1));
  const names = treasure.map(treasureName);
  try {
    if (treasure.some(([id]) => JACKPOTS.includes(id))) friend.sendMessage("§d§lWOW! §r§dThe princess gave you something SUPER rare!");
    friend.sendMessage(`§aThe princess dropped: §f${names.join(", ")}!`);
    friend.onScreenDisplay.setTitle("§6Treasure!", { subtitle: names.join(", "), fadeInDuration: 5, stayDuration: 50, fadeOutDuration: 15 });
  } catch {}
}

function endVisit(sparkle) {
  const v = visit;
  if (!v) return;
  system.clearRun(v.run);
  visit = null;
  if (sparkle) {
    sparkleBurst(v.dim, v.pos, 20);
    playAt(v.dim, "random.orb", v.pos, 1.6);
  }
  try { v.entity.remove(); } catch {}
  for (const p of world.getAllPlayers()) {
    try {
      if (p.dimension.id !== v.dim.id || flat(p.location, v.pos) > 48) continue;
      p.sendMessage(v.gifted.has(p.id)
        ? `§dPrincess ${v.princess} waved goodbye and rode away on ${v.uni}!`
        : `§dPrincess ${v.princess} rode away. §fNext time, walk right up to her for a treasure!`);
    } catch {}
  }
}

// Tidy up a unicorn left behind if the world was closed in the middle of a visit.
system.runInterval(() => {
  if (visit) return;
  for (const d of ["overworld", "nether", "the_end"]) {
    try {
      for (const e of world.getDimension(d).getEntities({ type: UNICORN })) e.remove();
    } catch {}
  }
}, 200);

// /scriptevent unicorn:visit  (cheats on) brings her right away, without using up a visit for the day.
try {
  system.afterEvents.scriptEventReceive.subscribe(({ id, sourceEntity }) => {
    if (id !== "unicorn:visit") return;
    const player = sourceEntity?.typeId === "minecraft:player" ? sourceEntity : world.getAllPlayers()[0];
    if (!player) return;
    if (visit) {
      player.sendMessage(`§ePrincess ${visit.princess} is already riding by!`);
      return;
    }
    if (!startVisit(player)) player.sendMessage("§cThe unicorn couldn't come. Check the Content Log for why.");
  });
} catch {}
