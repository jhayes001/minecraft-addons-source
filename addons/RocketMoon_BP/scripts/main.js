// Rocket to the Moon: put the Rocket down outside and climb in. After a 3-beep countdown it
// blasts off with flames and smoke, the screen fades to black, and you come down on the Moon:
// a floating gray world high in the night sky with craters, moon rocks, a flag and a little
// Earth hanging nearby. On the Moon you jump high and float down slowly. Climb back in the
// rocket to fly home; it lands right where you took off.
//
// The Moon is built once per world, the first time anyone flies there, 2000 blocks east of
// that first launch and high above the ground. Falling off the edge brings you back to the
// launch pad. While anyone is on the Moon it stays night; the time goes back when everyone
// is home.
//
// Version 1.1: the trip is a real flight through space. After the fade you're flying past
// asteroids toward the Moon, the rocket swings round and stands up to land on the pad. Going
// home, it lifts off the Moon and flies away into space before the fade. In space it's always
// a new-moon night, so the game's own moon is hidden.
import { world, system, ItemStack, BlockPermutation, MolangVariableMap } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const SHIP = "rocket:ship";
const ITEM = "rocket:rocket";
const ROCK = "rocket:moon_rock";
const OVERWORLD = "minecraft:overworld";

const MOON_R = 26;        // radius of the Moon's top
const MOON_Y = 285;       // height of the launch pad on the Moon
const MOON_DIST = 2000;   // how far east of the first launch the Moon is
const ZONE = MOON_R + 40; // how close (sideways) counts as "on the Moon"
const COUNTDOWN = 60;     // ticks of beeping before lift-off
const UP_T = 110;         // ticks of climbing before the fade
const UP_EARTH = 90;      // blocks climbed leaving Earth
const CRUISE_IN = 500;    // ticks flying through space to the Moon
const CRUISE_OUT = 440;   // ticks flying away from the Moon before the fade
const PIVOT = 46 / 16;    // the rocket leans about this height (the cockpit)
const FADE_AT = 22;       // the screen starts fading this many ticks before the swap
const DOWN_T = 130;       // ticks of coming down
const DOWN_MOON = 40;     // blocks above the pad the rocket appears
const DOWN_EARTH = 55;
const ASTEROIDS = 12;
const SLOTS = [[-2, -2], [2, -2], [-2, 2], [2, 2]]; // landing spots on the Moon pad

const valid = (e) => {
  try {
    return !!e && (typeof e.isValid === "function" ? e.isValid() : e.isValid);
  } catch {
    return false;
  }
};

// ---------- Little helpers ----------
const permCache = new Map();
function perm(ids) {
  const list = Array.isArray(ids) ? ids : [ids];
  const k = list.join("|");
  if (permCache.has(k)) return permCache.get(k);
  let p;
  for (const id of list) {
    try {
      p = BlockPermutation.resolve(id);
      break;
    } catch {}
  }
  permCache.set(k, p);
  return p;
}

function sound(dim, id, loc, volume = 1, pitch = 1) {
  try {
    dim.playSound(id, loc, { volume, pitch });
  } catch {}
}

function particle(dim, id, loc) {
  try {
    dim.spawnParticle(id, loc);
  } catch {}
}

function bar(player, text) {
  try {
    player.onScreenDisplay.setActionBar(text);
  } catch {}
}

function getJSON(holder, key) {
  try {
    const s = holder.getDynamicProperty(key);
    return typeof s === "string" ? JSON.parse(s) : undefined;
  } catch {
    return undefined;
  }
}

function setJSON(holder, key, v) {
  try {
    holder.setDynamicProperty(key, v === undefined ? undefined : JSON.stringify(v));
  } catch {}
}

const riders = (ship) => {
  try {
    return (ship.getComponent("minecraft:rideable")?.getRiders() ?? []).filter((e) => e.typeId === "minecraft:player");
  } catch {
    return [];
  }
};

const vehicleOf = (p) => {
  try {
    return p.getComponent("minecraft:riding")?.entityRidingOn;
  } catch {
    return undefined;
  }
};

function effect(p, id, ticks, amplifier = 0) {
  try {
    p.addEffect(id, ticks, { amplifier, showParticles: false });
  } catch {}
}

function fade(p, fadeInTime = 1, holdTime = 2, fadeOutTime = 1.2) {
  try {
    p.camera.fade({ fadeTime: { fadeInTime, holdTime, fadeOutTime }, fadeColor: { red: 0, green: 0, blue: 0 } });
    return;
  } catch {}
  try {
    p.runCommand(`camera @s fade time ${fadeInTime} ${holdTime} ${fadeOutTime} color 0 0 0`);
  } catch {}
}

// ---------- The Moon's record ----------
const getMoon = () => getJSON(world, "rocket:moon");
const saveMoon = (m) => setJSON(world, "rocket:moon", m);

function ensureMoon(from) {
  let m = getMoon();
  if (!m) {
    const x = Math.floor(from.x), z = Math.floor(from.z);
    m = {
      x: x + MOON_DIST, y: MOON_Y, z,
      seed: Math.floor(Math.random() * 1e9),
      origin: { x: x + 0.5, y: Math.floor(from.y), z: z + 0.5 },
      built: false,
    };
    saveMoon(m);
  }
  return m;
}

const sideways = (m, loc) => Math.hypot(loc.x - (m.x + 0.5), loc.z - (m.z + 0.5));
const onMoon = (m, loc, dimId) => !!m && dimId === OVERWORLD && sideways(m, loc) < ZONE && loc.y > m.y - 45;

// ---------- Giving the rocket ----------
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      // Logged back in high in the air (a flight was cut short)? Float down gently.
      const l = player.location;
      let air = 0;
      for (let dy = 1; dy <= 4; dy++) {
        const b = player.dimension.getBlock({ x: l.x, y: l.y - dy, z: l.z });
        if (b && b.typeId === "minecraft:air") air++;
      }
      if (air === 4 && !vehicleOf(player)) effect(player, "slow_falling", 400);
    } catch {}
    try {
      if (player.getDynamicProperty("rocket:got_rocket")) return;
      const inv = player.getComponent("minecraft:inventory").container;
      const leftover = inv.addItem(new ItemStack(ITEM, 1));
      if (leftover) player.dimension.spawnItem(leftover, player.location);
      player.setDynamicProperty("rocket:got_rocket", true);
      player.sendMessage("§bPut your Rocket down outside and climb in to fly to the Moon!");
      player.playSound("random.pop", { volume: 0.8, pitch: 1.2 });
    } catch (e) {
      console.warn(`Rocket to the Moon: couldn't give the rocket: ${e}`);
    }
  }, 40);
});

// ---------- Putting the rocket down ----------
const SOFT = ["air", "short_grass", "tall_grass", "tallgrass", "fern", "snow_layer", "dandelion", "poppy",
  "tulip", "daisy", "orchid", "allium", "bluet", "cornflower", "lily_of_the_valley", "deadbush", "dead_bush", "light_block"];
const isSoft = (id) => SOFT.some((w) => id.includes(w));
const lastUse = new Map();

world.afterEvents.itemUse.subscribe(({ source: player, itemStack }) => {
  if (itemStack?.typeId !== ITEM || player?.typeId !== "minecraft:player") return;
  const now = system.currentTick;
  if ((lastUse.get(player.name) ?? -99) > now - 10) return;
  lastUse.set(player.name, now);

  let hit;
  try {
    hit = player.getBlockFromViewDirection({ maxDistance: 7 });
  } catch {}
  if (!hit) {
    player.sendMessage("§eLook at the ground where you want the rocket, then try again!");
    return;
  }
  const b = hit.block.location;
  const y = isSoft(hit.block.typeId) ? b.y : b.y + 1;
  const dim = player.dimension;
  for (let dy = 0; dy < 5; dy++) {
    let above;
    try {
      above = dim.getBlock({ x: b.x, y: y + dy, z: b.z });
    } catch {}
    if (above && !isSoft(above.typeId)) {
      player.sendMessage("§eThere's no room for the rocket there. Try an open spot outside!");
      return;
    }
  }
  const spot = { x: b.x + 0.5, y, z: b.z + 0.5 };
  let ship;
  try {
    ship = dim.spawnEntity(SHIP, spot);
  } catch {
    player.sendMessage("§cThe rocket couldn't go there. Try somewhere else!");
    return;
  }
  const m = getMoon();
  if (onMoon(m, spot, dim.id)) setJSON(ship, "rocket:home", m.origin);
  takeOne(player);
  particle(dim, "rocket:smoke", { x: spot.x, y: spot.y + 0.3, z: spot.z });
  sound(dim, "random.anvil_land", spot, 0.4, 1.4);
});

function takeOne(player) {
  try {
    if (String(player.getGameMode()).toLowerCase() === "creative") return;
  } catch {}
  try {
    const inv = player.getComponent("minecraft:inventory").container;
    const slot = player.selectedSlotIndex;
    const item = inv.getItem(slot);
    if (item?.typeId !== ITEM) return;
    if (item.amount > 1) {
      item.amount -= 1;
      inv.setItem(slot, item);
    } else {
      inv.setItem(slot, undefined);
    }
  } catch {}
}

// ---------- Packing the rocket up (crouch + tap) ----------
world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  if (ev.target?.typeId !== SHIP) return;
  if (!ev.player.isSneaking) return;
  ev.cancel = true;
  const { player, target: ship } = ev;
  system.run(() => packMenu(player, ship));
});

async function packMenu(player, ship) {
  if (!valid(ship) || busyShip(ship)) return;
  if (onMoon(getMoon(), ship.location, ship.dimension.id)) {
    bar(player, "§eYour rocket has to stay here to fly you home!");
    return;
  }
  let res;
  try {
    res = await new ActionFormData()
      .title("Rocket")
      .button("Pack up the rocket")
      .button("Leave it here")
      .show(player);
  } catch {
    return;
  }
  if (res.canceled || res.selection !== 0 || !valid(ship) || busyShip(ship) || riders(ship).length) return;
  try {
    const inv = player.getComponent("minecraft:inventory").container;
    const leftover = inv.addItem(new ItemStack(ITEM, 1));
    if (leftover) player.dimension.spawnItem(leftover, player.location);
    sound(ship.dimension, "random.pop", ship.location, 0.8, 1);
    ship.remove();
  } catch {}
}

// ---------- Flights ----------
// phase: count -> up -> hold (screen is black, waiting for the far side to load) -> down -> out
const flights = new Map(); // flight id -> flight (the rocket itself changes halfway)
let flightSeq = 1;
const busyShip = (ship) => [...flights.values()].some((f) => f.ship && f.ship.id === ship.id);

function canLaunch(ship, player) {
  const dim = ship.dimension;
  if (dim.id !== OVERWORLD) {
    bar(player, "§eRockets can only fly from the Overworld!");
    return false;
  }
  const l = ship.location;
  const x = Math.floor(l.x), z = Math.floor(l.z);
  const top = Math.min(dim.heightRange?.max ?? 320, Math.floor(l.y) + 64);
  for (let y = Math.floor(l.y) + 3; y < top; y++) {
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let b;
      try {
        b = dim.getBlock({ x: x + dx, y, z: z + dz });
      } catch {}
      if (b && !isSoft(b.typeId) && !b.typeId.includes("air")) {
        bar(player, "§eThe rocket needs open sky above it!");
        return false;
      }
    }
  }
  return true;
}

// Someone climbed in: start the countdown (or say why it can't go).
system.runInterval(() => {
  for (const p of world.getPlayers()) {
    const ship = vehicleOf(p);
    if (!ship || ship.typeId !== SHIP || busyShip(ship)) continue;
    const m = getMoon();
    const fromMoon = onMoon(m, ship.location, ship.dimension.id);
    if (!fromMoon && !canLaunch(ship, p)) {
      try {
        ship.getComponent("minecraft:rideable").ejectRiders();
      } catch {}
      continue;
    }
    const id = flightSeq++;
    flights.set(id, { id, ship, phase: "count", t: 0, toMoon: !fromMoon, start: { ...ship.location } });
  }
}, 5);

system.runInterval(() => {
  for (const [id, f] of flights) {
    try {
      step(f);
    } catch (e) {
      console.warn(`Rocket to the Moon: flight problem: ${e}`);
      rescue(f);
    }
    if (f.done) flights.delete(id);
  }
}, 1);

function moveTo(f, target) {
  const s = f.ship;
  const l = s.location;
  const rotation = { x: 0, y: f.yaw ?? 0 };
  if (f.tp) {
    s.teleport(target, { rotation });
    return;
  }
  // If pushing the rocket doesn't move it, switch to teleporting it.
  if (f.last) {
    const wanted = Math.hypot(f.last.to.x - f.last.from.x, f.last.to.y - f.last.from.y, f.last.to.z - f.last.from.z);
    const moved = Math.hypot(l.x - f.last.from.x, l.y - f.last.from.y, l.z - f.last.from.z);
    f.miss = wanted > 0.15 && moved < wanted * 0.1 ? (f.miss ?? 0) + 1 : 0;
    if (f.miss >= 3) {
      f.tp = true;
      s.teleport(target, { rotation });
      return;
    }
  }
  f.last = { from: { ...l }, to: { ...target } };
  try {
    s.clearVelocity();
    s.applyImpulse({ x: target.x - l.x, y: target.y - l.y, z: target.z - l.z });
    if (f.yaw !== undefined) s.setRotation(rotation);
  } catch {
    f.tp = true;
    s.teleport(target, { rotation });
  }
}

// Anyone who slipped out mid-flight gets put back in their seat.
function keepSeated(f) {
  const rideable = f.ship?.getComponent("minecraft:rideable");
  for (const p of f.riders) {
    if (!valid(p)) continue;
    if (vehicleOf(p)?.id === f.ship?.id) continue;
    try {
      if (f.tp) p.teleport({ x: f.ship.location.x, y: f.ship.location.y + 2.4, z: f.ship.location.z });
      rideable.addRider(p);
    } catch {}
    if (vehicleOf(p)?.id !== f.ship?.id) effect(p, "slow_falling", 400);
  }
}

// ----- Which way the rocket points -----
// "tilt" leans the rocket's nose forward (0 = straight up, 90 = flat out); the model turns about
// the cockpit so the riders stay inside. "yaw" is the way it faces.
function setTilt(f, target, rate = 0.12) {
  f.tilt = (f.tilt ?? 0) + (target - (f.tilt ?? 0)) * rate;
  if (Math.abs(f.tilt - (f.shownTilt ?? -99)) > 0.4) {
    try {
      f.ship.setProperty("rocket:tilt", Math.max(0, Math.min(120, f.tilt)));
      f.shownTilt = f.tilt;
    } catch {}
  }
}

function aim(f, vel, rate = 0.2) {
  if (Math.hypot(vel.x, vel.z) < 0.03) return;
  const want = (Math.atan2(-vel.x, vel.z) * 180) / Math.PI;
  if (f.yaw === undefined) f.yaw = want;
  const d = ((((want - f.yaw) % 360) + 540) % 360) - 180;
  f.yaw += d * rate;
}

// The rocket's nose direction (unit vector).
function axis(f) {
  const th = ((f.tilt ?? 0) * Math.PI) / 180, yw = ((f.yaw ?? 0) * Math.PI) / 180;
  return { x: Math.sin(th) * -Math.sin(yw), y: Math.cos(th), z: Math.sin(th) * Math.cos(yw) };
}

function flame(f) {
  const s = f.ship, l = s.location, a = axis(f);
  const tail = { x: l.x - a.x * PIVOT, y: l.y + PIVOT - a.y * PIVOT, z: l.z - a.z * PIVOT };
  try {
    const vars = new MolangVariableMap();
    vars.setFloat("variable.dx", -a.x);
    vars.setFloat("variable.dy", -a.y);
    vars.setFloat("variable.dz", -a.z);
    s.dimension.spawnParticle("rocket:exhaust", tail, vars);
  } catch {}
}

// Specks of stardust ahead, so you can feel how fast you're going.
function stardust(f, vel) {
  const sp = Math.hypot(vel.x, vel.y, vel.z);
  if (sp < 0.05) return;
  const l = f.ship.location;
  for (let i = 0; i < 3; i++) {
    const r = 5 + Math.random() * 12, a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI;
    particle(f.ship.dimension, "rocket:stardust", {
      x: l.x + (vel.x / sp) * 26 + r * Math.cos(a) * Math.cos(b),
      y: l.y + 2 + (vel.y / sp) * 26 + r * Math.sin(b),
      z: l.z + (vel.z / sp) * 26 + r * Math.sin(a) * Math.cos(b),
    });
  }
}

// ----- The space trip near the Moon -----
const center = (m) => ({ x: m.x + 0.5, y: m.y + 1, z: m.z + 0.5 });
const rel = (c, dx, dy, dz) => ({ x: c.x + dx, y: c.y + dy, z: c.z + dz });
// Coming in: from far out in space, swing round and end up high over the pad.
const pathTo = (m) => { const c = center(m); return [rel(c, 210, 35, 0), rel(c, 120, 35, 45), rel(c, 45, 48, 40), rel(c, 0, DOWN_MOON, 0)]; };
// Going home: straight up off the pad, then out into space the other way round.
const pathFrom = (m, s) => { const c = center(m); return [{ ...s }, rel(s, 0, 45, 0), rel(c, 90, 48, -40), rel(c, 230, 38, 0)]; };
function bezier(P, s) {
  const u = 1 - s, k = [u * u * u, 3 * u * u * s, 3 * u * s * s, s * s * s];
  const out = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 4; i++) for (const c of ["x", "y", "z"]) out[c] += P[i][c] * k[i];
  return out;
}

function step(f) {
  if (f.phase !== "hold" && !valid(f.ship)) return rescue(f);
  const t = f.t++;
  const dim = f.ship?.dimension;

  if (f.phase === "count") {
    const rs = riders(f.ship);
    if (!rs.length) {
      f.done = true;
      return;
    }
    const l = f.ship.location;
    if (t % 20 === 0 && t < COUNTDOWN) sound(dim, "note.pling", l, 1, [1, 1.2, 1.5][t / 20]);
    if (t % 4 === 0 && t > 20) particle(dim, "rocket:smoke", { x: l.x, y: l.y + 0.2, z: l.z });
    if (t >= COUNTDOWN) {
      Object.assign(f, { riders: rs, t: 0, y0: l.y, start: { ...l }, tilt: 0, prev: { ...l } });
      try {
        f.ship.triggerEvent("rocket:fly");
      } catch {}
      f.ship.setDynamicProperty("rocket:flying", true);
      if (f.toMoon) {
        f.phase = "up";
        f.moon = ensureMoon(l);
        f.home = { x: l.x, y: l.y, z: l.z };
      } else {
        f.moon = getMoon();
        f.home = getJSON(f.ship, "rocket:home") ?? f.moon?.origin;
        Object.assign(f, { phase: "cruise", path: pathFrom(f.moon, l), T: CRUISE_OUT, ease: "in", space: true });
      }
      sound(dim, "firework.large_blast", l, 2, 0.6);
      sound(dim, "mob.blaze.shoot", l, 1.5, 0.5);
    }
    return;
  }

  if (f.phase === "up") {
    const a = (2 * UP_EARTH) / (UP_T * UP_T);
    moveTo(f, { x: f.start.x, y: f.y0 + 0.5 * a * t * t, z: f.start.z });
    keepSeated(f);
    const l = f.ship.location;
    flame(f);
    if (t < 50 && t % 3 === 0) particle(dim, "rocket:smoke", { x: f.start.x, y: f.y0 + 0.3, z: f.start.z });
    if (t % 6 === 0) sound(dim, "fire.fire", l, 3, 0.5);
    if (t % 18 === 0) sound(dim, "firework.launch", l, 1.5, 0.7);
    if (t === UP_T - FADE_AT) for (const p of f.riders) if (valid(p)) fade(p);
    if (t >= UP_T) transfer(f);
    return;
  }

  if (f.phase === "cruise") {
    const u = Math.min(1, t / f.T);
    const s = f.ease === "in" ? u * u : 1 - (1 - u) ** 2;
    const pos = bezier(f.path, s);
    const vel = { x: pos.x - f.prev.x, y: pos.y - f.prev.y, z: pos.z - f.prev.z };
    f.prev = pos;
    aim(f, vel);
    let tilt = f.tilt;
    if (Math.hypot(vel.x, vel.y, vel.z) > 0.02) tilt = (Math.atan2(Math.hypot(vel.x, vel.z), vel.y) * 180) / Math.PI;
    if (f.toMoon && u > 0.7) tilt *= Math.max(0, (1 - u) / 0.3); // stands up again to land
    setTilt(f, tilt);
    moveTo(f, pos);
    keepSeated(f);
    flame(f);
    stardust(f, vel);
    const l = f.ship.location;
    if (t < 40 && !f.toMoon && t % 3 === 0) particle(dim, "rocket:smoke", { x: f.start.x, y: f.y0 + 0.3, z: f.start.z });
    if (t % 8 === 0) sound(dim, "fire.fire", l, 2.5, 0.5);
    if (t % 60 === 30) sound(dim, "elytra.loop", l, 0.6, 0.8);
    if (!f.toMoon && t === f.T - FADE_AT) for (const p of f.riders) if (valid(p)) fade(p);
    if (t >= f.T) {
      if (!f.toMoon) return transfer(f);
      const slot = freeSlot(f.moon);
      Object.assign(f, {
        phase: "down", t: 0, dt: 0, stuck: 0, y0: pos.y, from: { ...pos },
        land: { x: slot.x, y: f.moon.y + 1, z: slot.z },
      });
    }
    return;
  }

  if (f.phase === "hold") return hold(f, t);

  if (f.phase === "down") {
    const D = f.y0 - f.land.y;
    const s = Math.min(1, f.dt / DOWN_T);
    let ty = f.land.y + D * (1 - s) ** 2;
    let waiting = false;
    if (f.toMoon && !moonReady() && ty < f.land.y + 8 && (f.wait = (f.wait ?? 0) + 1) < 400) {
      waiting = true;
      ty = f.land.y + 8;
      if (!building) startBuild(); // the last try missed some blocks: go again
    } else f.dt++;
    const k = Math.min(1, s * 1.6);
    moveTo(f, { x: f.from.x + (f.land.x - f.from.x) * k, y: ty, z: f.from.z + (f.land.z - f.from.z) * k });
    setTilt(f, 0);
    keepSeated(f);
    const l = f.ship.location;
    if (f.dt < DOWN_T - 10 || t % 2 === 0) flame(f);
    if (t % 6 === 0) sound(dim, "fire.fire", l, 2, 0.6);
    // Something under the rocket (like a new build at home)? Land on it.
    f.stuck = !waiting && l.y > ty + 1.5 ? (f.stuck ?? 0) + 1 : 0;
    if ((f.dt >= DOWN_T && l.y - f.land.y < 0.4) || f.dt >= DOWN_T + 40 || f.stuck > 8) land(f);
    return;
  }

  if (f.phase === "out") {
    if (t >= 15) {
      try {
        f.ship.getComponent("minecraft:rideable").ejectRiders();
      } catch {}
      if (f.toMoon) {
        for (const p of f.riders) {
          if (!valid(p) || p.getDynamicProperty("rocket:been_to_moon")) continue;
          p.setDynamicProperty("rocket:been_to_moon", true);
          p.sendMessage("§bYou're on the Moon! §fJump around, and climb back in the rocket when you want to go home.");
        }
      }
      f.done = true;
    }
  }
}

// The screen is black: swap the riders to the far side.
function transfer(f) {
  const players = f.riders.filter(valid);
  try {
    f.ship.getComponent("minecraft:rideable").ejectRiders();
  } catch {}
  try {
    f.ship.remove();
  } catch {}
  let dest, stage;
  if (f.toMoon) {
    // The very first trip waits over the pad while the Moon gets built.
    stage = moonReady() ? "go" : "prep";
    dest = stage === "go" ? pathTo(f.moon)[0] : rel(center(f.moon), 0, DOWN_MOON, 0);
    f.space = true;
  } else {
    const h = f.home ?? { x: f.start.x - MOON_DIST, y: 80, z: f.start.z };
    f.land = { x: h.x, y: h.y, z: h.z };
    dest = { x: h.x, y: h.y + DOWN_EARTH, z: h.z };
    stage = "go";
    f.space = false;
  }
  Object.assign(f, { phase: "hold", stage, t: 0, riders: players, dest, ship: undefined });
  for (const p of players) moveRider(p, dest);
  if (!players.length) f.done = true;
}

function moveRider(p, dest) {
  try {
    p.teleport(dest, { dimension: world.getDimension(OVERWORLD) });
  } catch {}
  effect(p, "slow_falling", 200);
}

function hold(f, t) {
  const ow = world.getDimension(OVERWORLD);
  for (const p of f.riders) {
    if (!valid(p)) continue;
    const l = p.location;
    if (Math.abs(l.x - f.dest.x) + Math.abs(l.y - f.dest.y) + Math.abs(l.z - f.dest.z) > 0.5) moveRider(p, f.dest);
  }
  if (t > 600 || !f.riders.some(valid)) {
    f.done = true; // gave up: everyone keeps slow falling
    return;
  }
  const loadedAt = (l) => {
    try {
      return !!ow.getBlock(l);
    } catch {
      return false;
    }
  };

  if (f.stage === "prep") {
    if (loadedAt({ x: f.dest.x, y: f.moon.y, z: f.dest.z })) startBuild();
    if (t % 30 === 0) for (const p of f.riders) if (valid(p)) fade(p, 0, 2, 1); // keep the screen black
    if ((moonReady() && !building) || t > 500) {
      f.stage = "go";
      f.dest = pathTo(f.moon)[0];
      f.t = 0;
      for (const p of f.riders) if (valid(p)) moveRider(p, f.dest);
    }
    return;
  }

  const check = f.toMoon ? f.dest : { x: f.land.x, y: f.land.y - 1, z: f.land.z };
  if (!loadedAt(check) || t < 8) return;
  let ship;
  try {
    ship = ow.spawnEntity(SHIP, f.dest);
  } catch {
    return; // try again next tick
  }
  try {
    ship.triggerEvent("rocket:fly");
  } catch {}
  ship.setDynamicProperty("rocket:flying", true);
  if (f.toMoon) setJSON(ship, "rocket:home", f.home);
  Object.assign(f, { ship, t: 0, shownTilt: undefined, prev: { ...f.dest }, last: undefined, miss: 0 });
  if (f.toMoon) {
    const P = pathTo(f.moon);
    f.yaw = undefined;
    aim(f, { x: P[1].x - P[0].x, y: 0, z: P[1].z - P[0].z }, 1);
    f.tilt = 85;
    setTilt(f, 85, 1);
    try {
      ship.setRotation({ x: 0, y: f.yaw });
    } catch {}
    Object.assign(f, { phase: "cruise", path: P, T: CRUISE_IN, ease: "out" });
  } else {
    f.tilt = 0;
    Object.assign(f, { phase: "down", dt: 0, stuck: 0, y0: f.dest.y, from: { ...f.dest } });
  }
  const rideable = ship.getComponent("minecraft:rideable");
  for (const p of f.riders) {
    if (!valid(p)) continue;
    try {
      p.teleport({ x: f.dest.x, y: f.dest.y + 2.4, z: f.dest.z }, { dimension: ow });
      rideable.addRider(p);
    } catch {}
    fade(p, 0, 0.4, 1.5); // and the picture fades back in
  }
}

function land(f) {
  const s = f.ship;
  try {
    s.clearVelocity();
  } catch {}
  try {
    s.triggerEvent("rocket:park");
    s.setProperty("rocket:tilt", 0);
  } catch {}
  s.setDynamicProperty("rocket:flying", false);
  const l = s.location;
  sound(s.dimension, "random.anvil_land", l, 0.5, 0.6);
  particle(s.dimension, "rocket:smoke", { x: l.x, y: l.y + 0.2, z: l.z });
  Object.assign(f, { phase: "out", t: 0 });
}

// Something went wrong mid-flight: make sure nobody gets hurt.
function rescue(f) {
  for (const p of f.riders ?? []) if (valid(p)) effect(p, "slow_falling", 600);
  if (valid(f.ship)) {
    try {
      f.ship.triggerEvent("rocket:park");
      f.ship.setProperty("rocket:tilt", 0);
      f.ship.setDynamicProperty("rocket:flying", false);
    } catch {}
  }
  f.done = true;
}

function freeSlot(m) {
  const ow = world.getDimension(OVERWORLD);
  let ships = [];
  try {
    ships = ow.getEntities({ type: SHIP, location: { x: m.x + 0.5, y: m.y + 1, z: m.z + 0.5 }, maxDistance: 10 });
  } catch {}
  const taken = (x, z) => ships.some((s) => Math.hypot(s.location.x - x, s.location.z - z) < 1.5)
    || [...flights.values()].some((o) => o.land && o.phase !== "hold" && Math.hypot(o.land.x - x, o.land.z - z) < 1.5);
  for (const [dx, dz] of SLOTS) {
    const x = m.x + dx + 0.5, z = m.z + dz + 0.5;
    if (!taken(x, z)) return { x, z };
  }
  return { x: m.x + 0.5, z: m.z + 0.5 };
}

// ---------- Building the Moon ----------
let building = false;
const moonReady = () => !!getMoon()?.ground; // the ground is done (the flag and Earth may still be coming)

function startBuild() {
  const m = getMoon();
  if (!m || m.built || building) return;
  building = true;
  system.runJob(buildMoon(m));
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const B = {
  surface: "minecraft:light_gray_concrete",
  white: "minecraft:white_concrete",
  speck: ["minecraft:calcite", "minecraft:white_concrete"],
  crater: "minecraft:gray_concrete",
  under: "minecraft:gray_concrete",
  pad: ["minecraft:smooth_stone", "minecraft:stone"],
  padEdge: "minecraft:yellow_concrete",
  lamp: ["minecraft:sea_lantern", "minecraft:glowstone"],
  pole: ["minecraft:oak_fence", "minecraft:fence"],
  flag: ["minecraft:red_wool", "minecraft:yellow_wool", "minecraft:light_blue_wool"],
  ocean: "minecraft:blue_concrete",
  shallow: "minecraft:light_blue_concrete",
  land: "minecraft:lime_concrete",
  forest: "minecraft:green_concrete",
  ice: "minecraft:white_concrete",
};

// Moon layout (shared with the tests): craters, the top height of each column, and the bottom.
function moonPlan(m) {
  const rnd = rng(m.seed);
  const craters = [];
  for (let tries = 0; craters.length < 7 && tries < 300; tries++) {
    const ang = rnd() * Math.PI * 2;
    const dist = 12 + rnd() * (MOON_R - 17);
    const r = 2.5 + rnd() * 2.5;
    const c = { x: Math.cos(ang) * dist, z: Math.sin(ang) * dist, r, depth: r > 4 ? 2 : 1 };
    if (Math.hypot(c.x - 6, c.z) < c.r + 3) continue; // keep clear of the flag
    if (craters.every((o) => Math.hypot(o.x - c.x, o.z - c.z) > o.r + c.r + 2)) craters.push(c);
  }
  const column = (dx, dz) => {
    const d = Math.hypot(dx, dz);
    if (d > MOON_R + 0.5) return undefined;
    const pad = Math.abs(dx) <= 4 && Math.abs(dz) <= 4;
    let h = m.y, inCrater = false;
    if (!pad) {
      const e = d - (MOON_R - 5);
      if (e > 0) h -= Math.round((e * e) / 5);
      const n = Math.sin(dx * 0.37) + Math.cos(dz * 0.29) + Math.sin((dx + dz) * 0.21);
      if (Math.max(Math.abs(dx), Math.abs(dz)) > 6) h += Math.round(n * 0.45);
      for (const c of craters) {
        const cd = Math.hypot(dx - c.x, dz - c.z);
        if (cd < c.r) {
          h -= Math.round(c.depth * (1 - (cd / c.r) ** 2) + 0.3);
          inCrater = true;
        } else if (cd < c.r + 1.2) h += 1;
      }
    }
    const bottom = Math.min(h - 2, m.y - 1 - Math.round(Math.sqrt(Math.max(0, MOON_R * MOON_R - d * d)) * 0.8));
    return { h, bottom, pad, inCrater };
  };
  return { craters, column };
}

// Waits a little for a spot that isn't loaded yet. After one long wait, it stops waiting
// (that part is skipped and the next trip finishes it).
function* blockAt(dim, loc, patience) {
  const t0 = system.currentTick;
  for (;;) {
    let b;
    try {
      b = dim.getBlock(loc);
    } catch {}
    if (b) return b;
    if (patience.gaveUp || system.currentTick - t0 > 100) {
      patience.gaveUp = true;
      return undefined;
    }
    yield;
  }
}

// Built in three parts (ground, flag + rocks, little Earth). Each part is remembered once it's
// done, so if some of it wasn't loaded yet, the next trip finishes just that part and moon
// rocks she already picked up don't come back.
function* buildMoon(m) {
  const dim = world.getDimension(OVERWORLD);
  const { column } = moonPlan(m);
  let missed = 0, patience = {};
  function* put(x, y, z, ids) {
    const p = perm(ids);
    if (!p) return;
    const b = yield* blockAt(dim, { x, y, z }, patience);
    if (!b) {
      missed++;
      return;
    }
    try {
      b.setPermutation(p);
    } catch {
      missed++;
    }
  }
  const finish = (part) => {
    if (missed === 0) {
      const g = getMoon() ?? m;
      g[part] = true;
      g.built = !!(g.ground && g.features && g.earth);
      saveMoon(g);
    }
    missed = 0;
    patience = {};
  };
  try {
    const tops = new Map();
    for (let dx = -MOON_R; dx <= MOON_R; dx++) {
      for (let dz = -MOON_R; dz <= MOON_R; dz++) {
        const c = column(dx, dz);
        if (c) tops.set(`${dx},${dz}`, c.h);
      }
    }

    if (!m.ground) {
      const rnd = rng(m.seed + 7);
      for (let dx = -MOON_R; dx <= MOON_R; dx++) {
        for (let dz = -MOON_R; dz <= MOON_R; dz++) {
          const c = column(dx, dz);
          if (!c) continue;
          const x = m.x + dx, z = m.z + dz;
          for (let y = c.bottom; y < c.h; y++) {
            yield* put(x, y, z, y <= c.bottom + 1 ? (rnd() < 0.3 ? B.surface : B.under) : B.surface);
          }
          let topId;
          const ring = Math.max(Math.abs(dx), Math.abs(dz));
          if (c.pad) topId = ring === 4 ? (Math.abs(dx) === 4 && Math.abs(dz) === 4 ? B.lamp : B.padEdge) : B.pad;
          else if (c.inCrater) topId = rnd() < 0.8 ? B.crater : B.surface;
          else {
            const r = rnd();
            topId = r < 0.12 ? B.white : r < 0.2 ? B.speck : B.surface;
          }
          yield* put(x, c.h, z, topId);
          yield;
        }
      }
      finish("ground");
    }

    if (!m.features) {
      const rnd = rng(m.seed + 11);
      // A flag next to the pad
      const fh = tops.get("6,0") ?? m.y;
      for (let y = fh + 1; y <= fh + 4; y++) yield* put(m.x + 6, y, m.z, B.pole);
      for (let row = 0; row < 3; row++) {
        for (let dz = 1; dz <= 4; dz++) yield* put(m.x + 6, fh + 4 - row, m.z + dz, B.flag[row]);
      }
      // Moon rocks to collect
      let rocks = 0;
      const used = new Set();
      for (let tries = 0; rocks < 14 && tries < 200; tries++) {
        const ang = rnd() * Math.PI * 2, dist = 7 + rnd() * (MOON_R - 11);
        const dx = Math.round(Math.cos(ang) * dist), dz = Math.round(Math.sin(ang) * dist);
        if (Math.abs(dx - 6) <= 1 && dz >= -1 && dz <= 5) continue;
        const h = tops.get(`${dx},${dz}`);
        if (h === undefined || used.has(`${dx},${dz}`)) continue;
        used.add(`${dx},${dz}`);
        yield* put(m.x + dx, h + 1, m.z + dz, ROCK);
        rocks++;
      }
      finish("features");
    }

    if (!m.earth) {
      const rnd = rng(m.seed + 13);
      // A little Earth hanging in the sky
      const ex = m.x - 44, ey = m.y + 14, ez = m.z + 10, er = 7;
      for (let dx = -er; dx <= er; dx++) {
        for (let dy = -er; dy <= er; dy++) {
          for (let dz = -er; dz <= er; dz++) {
            const d = Math.hypot(dx, dy, dz);
            if (d > er + 0.3) continue;
            let id = B.ocean;
            if (d > er - 1.3) {
              const n = Math.sin(dx * 0.8 + dy * 0.3) + Math.cos(dz * 0.7 - dy * 0.5) + Math.sin((dx - dz) * 0.45);
              if (Math.abs(dy) >= er - 1) id = B.ice;
              else if (rnd() < 0.06) id = B.ice; // clouds
              else if (n > 0.9) id = B.forest;
              else if (n > 0.35) id = B.land;
              else if (n > 0.1) id = B.shallow;
            }
            yield* put(ex + dx, ey + dy, ez + dz, id);
          }
          yield;
        }
      }
      finish("earth");
    }
  } finally {
    building = false;
  }
}

// ---------- Night with a new moon ----------
// The moon's phase goes by the day number (day % 8; 4 is the new moon, which you can't see).
function newMoonNight(abs) {
  const day = Math.floor(abs / 24000);
  let d = day - ((((day - 4) % 8) + 8) % 8); // the most recent new-moon day (going back, not forward)
  if (d < 0) d = 4;
  return d * 24000 + 18000;
}

function setAbs(v) {
  try {
    world.setAbsoluteTime(v);
    return;
  } catch {}
  try {
    world.getDimension(OVERWORLD).runCommand(`time set ${v}`);
  } catch {}
}

// ---------- Asteroids along the way ----------
// A dozen lumpy space rocks beside the flight paths. Each one is built when it's loaded but
// nobody's close by (so it doesn't pop up in front of you), and remembered once it's there.
let astPlan, astBusy = false;
function asteroidPlan(m) {
  if (astPlan?.seed === m.seed) return astPlan.list;
  const rnd = rng(m.seed + 21);
  const to = pathTo(m), from = pathFrom(m, center(m));
  const samples = [];
  for (let i = 0; i <= 80; i++) samples.push(bezier(to, i / 80), bezier(from, i / 80));
  const list = [];
  for (let tries = 0; list.length < ASTEROIDS && tries < 400; tries++) {
    const q = bezier(rnd() < 0.6 ? to : from, 0.08 + rnd() * 0.75);
    const r = 2 + rnd() * 1.8;
    const c = { x: Math.round(q.x + (rnd() - 0.5) * 44), y: Math.round(q.y + (rnd() - 0.5) * 26), z: Math.round(q.z + (rnd() - 0.5) * 44), r };
    if (samples.some((p) => Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) < r + 7)) continue;
    if (Math.hypot(c.x - (m.x + 0.5), c.z - (m.z + 0.5)) < MOON_R + 8) continue;
    if (list.some((o) => Math.hypot(o.x - c.x, o.y - c.y, o.z - c.z) < o.r + r + 4)) continue;
    list.push(c);
  }
  astPlan = { seed: m.seed, list };
  return list;
}

const ROCKY = [
  [0.55, "minecraft:tuff"], [0.8, "minecraft:cobbled_deepslate"], [0.9, ["minecraft:andesite", "minecraft:cobblestone"]],
  [0.95, "minecraft:amethyst_block"], [1, "minecraft:magma"],
];

function* buildAsteroid(m, i, c) {
  try {
    const dim = world.getDimension(OVERWORLD);
    const rnd = rng(m.seed + 100 + i);
    const R = Math.ceil(c.r + 1);
    let missed = 0;
    for (let dx = -R; dx <= R; dx++) {
      for (let dy = -R; dy <= R; dy++) {
        for (let dz = -R; dz <= R; dz++) {
          const lump = Math.sin(dx * 1.3 + i) + Math.cos(dy * 1.1 - i) + Math.sin(dz * 1.7 + dx * 0.5);
          if (Math.hypot(dx, dy * 1.2, dz) > c.r + lump * 0.45) continue;
          const r = rnd();
          const p = perm(ROCKY.find(([k]) => r < k)[1]);
          let b;
          try {
            b = dim.getBlock({ x: c.x + dx, y: c.y + dy, z: c.z + dz });
            if (b && p) b.setPermutation(p);
            else missed++;
          } catch {
            missed++;
          }
        }
        yield;
      }
    }
    if (!missed) {
      const g = getMoon();
      if (g) {
        g.ast = (g.ast ?? 0) | (1 << i);
        saveMoon(g);
      }
    }
  } finally {
    astBusy = false;
  }
}

system.runInterval(() => {
  const m = getMoon();
  if (!m?.ground || astBusy) return;
  const list = asteroidPlan(m);
  const ps = world.getPlayers().filter((p) => p.dimension.id === OVERWORLD);
  const dist = (p, c) => Math.hypot(p.location.x - c.x, p.location.y - c.y, p.location.z - c.z);
  const dim = world.getDimension(OVERWORLD);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if ((m.ast ?? 0) & (1 << i)) continue;
    if (!ps.some((p) => dist(p, c) < 140) || ps.some((p) => dist(p, c) < 36)) continue;
    let loaded = true;
    for (const [dx, dz] of [[0, 0], [-5, -5], [5, 5], [-5, 5], [5, -5]]) {
      try {
        if (!dim.getBlock({ x: c.x + dx, y: c.y, z: c.z + dz })) loaded = false;
      } catch {
        loaded = false;
      }
    }
    if (!loaded) continue;
    astBusy = true;
    system.runJob(buildAsteroid(m, i, c));
    return;
  }
}, 20);

// ---------- Being on the Moon ----------
let stranded = 0;
system.runInterval(() => {
  const m = getMoon();
  if (!m) return;
  const inFlight = new Set(), inSpace = new Set();
  for (const f of flights.values()) {
    for (const p of f.riders ?? []) {
      if (!valid(p)) continue;
      inFlight.add(p.id);
      if (f.space) inSpace.add(p.id);
    }
  }
  let anyone = false, onFoot = false;
  for (const p of world.getPlayers()) {
    const here = onMoon(m, p.location, p.dimension.id) || inSpace.has(p.id);
    if (here) {
      anyone = true;
      effect(p, "jump_boost", 40, 2);
      effect(p, "slow_falling", 40);
      effect(p, "night_vision", 400);
      p.setDynamicProperty("rocket:on_moon", true);
      if (!vehicleOf(p) && !inFlight.has(p.id)) {
        onFoot = true;
        // Fell off the edge? Back to the launch pad.
        if (p.location.y < m.y - 8 && sideways(m, p.location) < MOON_R + 30) {
          try {
            p.teleport({ x: m.x + 0.5, y: m.y + 1, z: m.z + 0.5 });
          } catch {}
          sound(p.dimension, "random.orb", p.location, 1, 0.8);
        }
      }
    } else if (p.getDynamicProperty("rocket:on_moon") && !inFlight.has(p.id)) {
      p.setDynamicProperty("rocket:on_moon", false);
      for (const id of ["jump_boost", "slow_falling", "night_vision"]) {
        try {
          p.removeEffect(id);
        } catch {}
      }
    }
  }

  // It's always night in space, with a new moon (the game's own moon doesn't show) so the only
  // Moon in the sky is the one you're on. The time goes back once everyone's home.
  try {
    const saved = world.getDynamicProperty("rocket:saved_abs");
    if (anyone) {
      const abs = world.getAbsoluteTime();
      if (saved === undefined) world.setDynamicProperty("rocket:saved_abs", abs);
      const day = Math.floor(abs / 24000), tod = abs % 24000;
      if (day % 8 !== 4 || tod < 13500 || tod > 22000) setAbs(newMoonNight(saved ?? abs));
    } else if (saved !== undefined) {
      setAbs(saved);
      world.setDynamicProperty("rocket:saved_abs", undefined);
    }
  } catch {}

  // Someone on the Moon with no rocket to get home? A new one lands on the pad.
  if (onFoot && m.ground) {
    let ships = [];
    try {
      ships = world.getDimension(OVERWORLD).getEntities({ type: SHIP, location: { x: m.x + 0.5, y: m.y, z: m.z + 0.5 }, maxDistance: ZONE });
    } catch {}
    const coming = [...flights.values()].some((f) => f.toMoon && f.phase !== "count" || f.ship && sideways(m, f.ship.location) < ZONE);
    if (ships.length || coming) stranded = 0;
    else if ((stranded += 10) >= 100) {
      stranded = 0;
      const slot = freeSlot(m);
      try {
        const ship = world.getDimension(OVERWORLD).spawnEntity(SHIP, { x: slot.x, y: m.y + 1, z: slot.z });
        setJSON(ship, "rocket:home", m.origin);
      } catch {}
    }
  } else stranded = 0;
}, 10);

// A rocket left hovering (the world closed mid-flight) settles back down.
system.runInterval(() => {
  for (const p of world.getPlayers()) {
    let ships = [];
    try {
      ships = p.dimension.getEntities({ type: SHIP, location: p.location, maxDistance: 64 });
    } catch {}
    for (const s of ships) {
      if (busyShip(s) || !s.getDynamicProperty("rocket:flying")) continue;
      try {
        s.triggerEvent("rocket:park");
        s.setDynamicProperty("rocket:flying", false);
      } catch {}
    }
  }
}, 40);
