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
const PAUSE_TICKS = 100;      // how long she stops to say hi (and throw glitter everywhere)
const STUCK_TICKS = 80;       // boxed in this long: she sparkles away
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

// Things she won't step onto, even though they're solid: she goes around them.
const BLOCKING = /fence|wall|pane|iron_bars|door|gate|bed$|cactus|campfire|magma|sweet_berry/;

// Where she'd stand at (x, z) coming from height fromY, or undefined if she can't go there:
// at most 1 block up or 3 down, not onto a fence or wall, and 3 blocks of room for the unicorn and princess.
// ctx = { dim, cache }; the cache lasts one visit.
function standAt(ctx, x, z, fromY) {
  const bx = Math.floor(x), bz = Math.floor(z), fy = Math.floor(fromY + 0.5);
  const key = `${bx},${bz},${fy}`;
  if (ctx.cache.has(key)) return ctx.cache.get(key);
  let res;
  const gy = groundY(ctx.dim, x, z, fromY, 4);
  if (gy !== undefined && gy - fromY <= 1.1 && fromY - gy <= 3.1) {
    const under = blockAt(ctx.dim, bx, gy - 1, bz);
    let ok = under !== undefined && !BLOCKING.test(under);
    for (let dy = 0; ok && dy < 3; dy++) {
      const id = blockAt(ctx.dim, bx, gy + dy, bz);
      ok = id === undefined || isClear(id);
    }
    if (ok) res = gy;
  }
  ctx.cache.set(key, res);
  return res;
}

// Can she ride a few blocks this way? Checks the middle of her path and both sides of her body.
function wayClear(v, heading) {
  const cx = Math.cos(heading), cz = Math.sin(heading);
  let y = v.pos.y;
  for (const d of [0.7, 1.4, 2.1, 2.8]) {
    const s = standAt(v, v.pos.x + cx * d, v.pos.z + cz * d, y);
    if (s === undefined) return false;
    if (d === 1.4) {
      for (const side of [-0.6, 0.6]) {
        if (standAt(v, v.pos.x + cx * d - cz * side, v.pos.z + cz * d + cx * side, y) === undefined) return false;
      }
    }
    y = s;
  }
  return true;
}

// The open direction closest to where she wants to go (sticking to one side when going around something), or null.
function chooseHeading(v, desired) {
  const s = v.avoidSide;
  for (const off of [0, 25, -25, 50, -50, 75, -75, 100, -100, 125, -125, 150, -150, 180]) {
    const h = desired + ((off * s) * Math.PI) / 180;
    if (wayClear(v, h)) {
      if (off !== 0 && off !== 180) v.avoidSide = Math.sign(off * s);
      return h;
    }
  }
  return null;
}

const angleDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

// ---------- The visit ----------
function startVisit(target) {
  const dim = target.dimension, p = target.location;
  let start;
  const cache = new Map();
  for (let i = 0; i < 16 && !start; i++) {
    const a = Math.random() * Math.PI * 2;
    const x = p.x + Math.cos(a) * START_DIST, z = p.z + Math.sin(a) * START_DIST;
    const y = groundY(dim, x, z, p.y, 12);
    if (y !== undefined && standAt({ dim, cache }, x, z, y) === y) start = { x, y, z }; // open ground with room above
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
    entity, dim, princess, uni, targetId: target.id, pos: { ...start }, cache,
    heading: Math.atan2(dir.z, dir.x), perp: { x: -dir.z * side, z: dir.x * side }, avoidSide: side, stuck: 0,
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
    glitterParty(v);
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
    ringOfGlitter(v.dim, { x: v.pos.x, y: v.pos.y + 1.4, z: v.pos.z }, 1.8, 28);
    if (friend.id === v.targetId && v.phase === "approach") startLeaving(v); // said hi: ride on afterwards
    return;
  }

  // Steering: ride toward a spot beside the player, then carry on past, going around houses, trees and walls.
  let desired = v.leaveHeading ?? v.heading;
  if (v.phase === "approach") {
    const target = players.find((p) => p.id === v.targetId);
    if (!target || v.tick > APPROACH_TICKS) {
      startLeaving(v);
      desired = v.leaveHeading;
    } else {
      const goal = { x: target.location.x + v.perp.x * PASS_SIDE, z: target.location.z + v.perp.z * PASS_SIDE };
      const gx = goal.x - v.pos.x, gz = goal.z - v.pos.z;
      const ahead = gx * Math.cos(v.heading) + gz * Math.sin(v.heading);
      if (Math.hypot(gx, gz) < 1.5 || (ahead < 0 && Math.hypot(gx, gz) < 6)) {
        startLeaving(v);
        desired = v.leaveHeading;
      } else {
        desired = Math.atan2(gz, gx);
      }
    }
  }
  if (v.tick % 4 === 0 || v.steer === undefined) v.steer = chooseHeading(v, desired);
  if (v.steer !== null) {
    const avoiding = Math.abs(angleDiff(v.steer, desired)) > 0.01;
    const max = ((avoiding ? 9 : TURN) * Math.PI) / 180;
    v.heading += Math.max(-max, Math.min(max, angleDiff(v.steer, v.heading)));
  }
  const waiting = players.some((p) => !v.gifted.has(p.id) && flat(p.location, v.pos) < 8);
  const speed = waiting ? SLOW_SPEED : SPEED;
  const nx = v.pos.x + Math.cos(v.heading) * speed, nz = v.pos.z + Math.sin(v.heading) * speed;
  const gy = standAt(v, nx, nz, v.pos.y);
  if (gy === undefined) {
    // Something's in the way right in front of her: turn on the spot and look for a way around.
    v.steer = undefined;
    turnTo(v, v.heading);
    if (++v.stuck > STUCK_TICKS) return endVisit(true);
    return;
  }
  v.stuck = 0;
  v.pos = { x: nx, y: v.pos.y + Math.max(-0.25, Math.min(0.25, gy - v.pos.y)), z: nz };
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

function startLeaving(v) {
  v.phase = "leave";
  v.leaveHeading = v.heading;
}

function fountain(dim, loc, colorIndex) {
  try {
    const c = RAINBOW[colorIndex % RAINBOW.length];
    const vars = new MolangVariableMap();
    vars.setColorRGB("variable.color", { red: c[0], green: c[1], blue: c[2] });
    dim.spawnParticle("unicorn:glitter_fountain", loc, vars);
  } catch {}
}

function ringOfGlitter(dim, c, r, n) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    glitter(dim, { x: c.x + Math.cos(a) * r, y: c.y, z: c.z + Math.sin(a) * r }, Math.floor((i / n) * RAINBOW.length));
  }
}

// While she's stopped: a rainbow spiral of glitter swirling around the unicorn and princess,
// and glitter fountains bursting out of the unicorn's horn.
function glitterParty(v) {
  const t = PAUSE_TICKS - v.pause;
  for (const k of [0, 1, 2]) {
    const a = (t * 24 + k * 120) * Math.PI / 180;
    const h = ((t * 0.09 + k * 0.33) % 1) * 3.4;
    glitter(v.dim, { x: v.pos.x + Math.cos(a) * 1.7, y: v.pos.y + h, z: v.pos.z + Math.sin(a) * 1.7 }, v.color + k * 2);
  }
  v.color++;
  if (t % 4 === 0) {
    const fx = Math.cos(v.heading), fz = Math.sin(v.heading);
    fountain(v.dim, { x: v.pos.x + fx * 1.3, y: v.pos.y + 2.4, z: v.pos.z + fz * 1.3 }, t / 4);
  }
  if (t % 10 === 0) ringOfGlitter(v.dim, { x: v.pos.x, y: v.pos.y + 0.1, z: v.pos.z }, 1.2 + (t % 30) / 15, 21);
}

// A rainbow bridge of glitter from the princess to you: seven colored bands along an arc.
function rainbowBridge(dim, from, to) {
  const N = 18;
  for (let i = 0; i <= N; i++) {
    const f = i / N, lift = Math.sin(f * Math.PI) * 2.2;
    for (let band = 0; band < RAINBOW.length; band++) {
      glitter(dim, {
        x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f + lift + (RAINBOW.length - 1 - band) * 0.16,
        z: from.z + (to.z - from.z) * f,
      }, band);
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
  // Glitter. Lots of it.
  sparkleBurst(v.dim, loc, 40);
  const hands = { x: v.pos.x, y: v.pos.y + 2.5, z: v.pos.z };
  for (let i = 0; i < RAINBOW.length; i++) fountain(v.dim, hands, i);
  const dim = v.dim;
  for (const d of [0, 5, 10, 15]) {
    system.runTimeout(() => {
      let p = at;
      try { p = friend.location; } catch {}
      rainbowBridge(dim, hands, { x: p.x, y: p.y + 0.6, z: p.z });
      ringOfGlitter(dim, { x: p.x, y: p.y + 0.2, z: p.z }, 1.3, 21);
      for (let i = 0; i < 3; i++) fountain(dim, { x: p.x + (Math.random() - 0.5) * 2, y: p.y, z: p.z + (Math.random() - 0.5) * 2 }, d + i * 2);
      try { dim.spawnParticle("minecraft:totem_particle", { x: p.x, y: p.y + 1, z: p.z }); } catch {}
    }, d + 1);
  }
  for (let d = 0; d < 60; d += 2) { // glitter rain falling all around you
    system.runTimeout(() => {
      let p = at;
      try { p = friend.location; } catch {}
      for (let i = 0; i < 8; i++) {
        glitter(dim, { x: p.x + (Math.random() - 0.5) * 4, y: p.y + 3 + Math.random(), z: p.z + (Math.random() - 0.5) * 4 }, d + i);
      }
    }, d + 1);
  }
  playAt(v.dim, "random.levelup", at, 1.3);
  [3, 9, 16].forEach((d) => system.runTimeout(() => playAt(dim, "firework.twinkle", at, 1), d));
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
