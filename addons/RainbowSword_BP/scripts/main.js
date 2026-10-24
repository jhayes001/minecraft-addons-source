// Rainbow Sword: tap/hold "use" to fire an arcing rainbow beam.
// Mobs it hits take a little damage and float up into the air.
import { world, system, MolangVariableMap, ItemStack } from "@minecraft/server";

const SWORD_ID = "rainbow:rainbow_sword";
const RANGE = 24;          // how far the rainbow reaches (blocks)
const STEP = 0.5;          // spacing between sparkles along the beam
const COOLDOWN_TICKS = 10; // 20 ticks = 1 second
const ARC_HEIGHT = 1.4;    // how tall the rainbow's arch is

const COLORS = [
  { red: 1.0, green: 0.23, blue: 0.23 }, // red
  { red: 1.0, green: 0.6, blue: 0.18 },  // orange
  { red: 1.0, green: 0.94, blue: 0.29 }, // yellow
  { red: 0.3, green: 1.0, blue: 0.37 },  // green
  { red: 0.25, green: 0.66, blue: 1.0 }, // blue
  { red: 0.42, green: 0.33, blue: 1.0 }, // indigo
  { red: 0.83, green: 0.36, blue: 1.0 }, // violet
];

const nextShot = new Map();

// Hand every player a Rainbow Sword the first time they join the world.
// No cheats needed. Each player only gets one free sword, ever.
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      if (player.getDynamicProperty("rainbow:got_sword")) return;
      const inv = player.getComponent("minecraft:inventory").container;
      const leftover = inv.addItem(new ItemStack(SWORD_ID, 1));
      if (leftover) player.dimension.spawnItem(leftover, player.location);
      player.setDynamicProperty("rainbow:got_sword", true);
      player.sendMessage("§dYou found a Rainbow Sword! §fHold the use button to fire a rainbow.");
      playSound(player, "random.levelup", player.location, 1.2);
    } catch {}
  }, 40);
});

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (v, s) => ({ x: v.x * s, y: v.y * s, z: v.z * s });
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm = (v) => {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return scale(v, 1 / len);
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

world.afterEvents.itemUse.subscribe((event) => {
  const player = event.source;
  if (event.itemStack?.typeId !== SWORD_ID) return;
  if (player?.typeId !== "minecraft:player") return;

  const now = system.currentTick;
  if ((nextShot.get(player.id) ?? 0) > now) return;
  nextShot.set(player.id, now + COOLDOWN_TICKS);

  shootRainbow(player);
});

function shootRainbow(player) {
  const dim = player.dimension;
  const origin = player.getHeadLocation();
  const dir = norm(player.getViewDirection());

  // Work out where the rainbow stops: first mob, first block, or max range.
  let length = RANGE;
  let target;

  try {
    const block = player.getBlockFromViewDirection({ maxDistance: RANGE });
    if (block) {
      const hitPoint = add(block.block.location, block.faceLocation);
      length = Math.min(length, dist(origin, hitPoint));
    }
  } catch {}

  try {
    const hits = player.getEntitiesFromViewDirection({ maxDistance: RANGE });
    for (const hit of hits) {
      const e = hit.entity;
      if (e.id === player.id) continue;
      if (e.typeId === "minecraft:player" || e.typeId === "minecraft:item") continue;
      if (hit.distance <= length) {
        target = e;
        length = hit.distance;
      }
      break;
    }
  } catch {}

  // Two directions perpendicular to the aim, so the colour bands sit side by side.
  let right = cross(dir, { x: 0, y: 1, z: 0 });
  if (Math.hypot(right.x, right.y, right.z) < 0.01) right = { x: 1, y: 0, z: 0 };
  right = norm(right);
  const up = norm(cross(right, dir));

  playSound(player, "note.chime", origin, 1.8);

  // Draw the rainbow over a few ticks so it looks like it's flying outward.
  const SEGMENTS = 6;
  const perSegment = length / SEGMENTS;
  for (let s = 0; s < SEGMENTS; s++) {
    system.runTimeout(() => {
      const start = Math.max(1, s * perSegment);
      const end = (s + 1) * perSegment;
      for (let d = start; d <= end; d += STEP) {
        const arc = Math.sin(Math.PI * (d / length)) * ARC_HEIGHT;
        const center = add(add(origin, scale(dir, d)), scale(up, arc));
        COLORS.forEach((color, i) => {
          const offset = scale(up, (3 - i) * 0.13);
          spark(dim, add(center, offset), color);
        });
      }
    }, s);
  }

  // Finale at the end of the rainbow.
  system.runTimeout(() => {
    const endPoint = add(origin, scale(dir, length));
    try {
      dim.spawnParticle("rainbow:burst", endPoint);
    } catch {}
    playSound(player, "random.orb", endPoint, 1.4);

    if (target) {
      try {
        target.applyDamage(3, { cause: "magic", damagingEntity: player });
      } catch {}
      try {
        target.addEffect("levitation", 50, { amplifier: 1, showParticles: true });
      } catch {}
    }
  }, SEGMENTS);
}

function spark(dim, location, color) {
  try {
    const vars = new MolangVariableMap();
    vars.setColorRGB("variable.color", color);
    dim.spawnParticle("rainbow:spark", location, vars);
  } catch {
    // Spots in unloaded chunks just get skipped.
  }
}

function playSound(player, id, location, pitch) {
  try {
    world.playSound(id, location, { pitch, volume: 1 });
  } catch {
    try {
      player.playSound(id, { pitch, volume: 1 });
    } catch {}
  }
}
