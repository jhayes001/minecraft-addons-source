// Santa's Visit: use the Christmas Tree item to grow a decorated tree. Every night,
// Santa flies over in his sleigh (Jingle Bells and all) and leaves a present with
// each player's name under the tree. Tap your present to unwrap it.
// Sleep through the night? Santa still comes, and the presents are there in the morning.
import { world, system, ItemStack, BlockPermutation } from "@minecraft/server";

const TREE_ITEM = "santa:christmas_tree";
const SANTA = "santa:sleigh";
const PRESENT_TYPES = ["santa:present_red", "santa:present_green", "santa:present_blue"];
const SANTA_TIME = 14500;      // a little after dark (night is about 13000 to 23000)
const MAX_PRESENTS = 12;       // most presents waiting under the tree at once
const MAX_PLAYERS = 8;

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
const locKey = (dimId, l) => `${dimId}|${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)}`;

// ---------- Gifts ----------
// Higher weight = more common. "pet" and "disc" and "bundle" pick one at random.
const GIFTS = [
  { id: "minecraft:cookie", count: [6, 12], weight: 5 },
  { id: "minecraft:emerald", count: [3, 6], weight: 4 },
  { id: "minecraft:gold_ingot", count: [2, 5], weight: 4 },
  { id: "minecraft:snowball", count: [12, 16], weight: 3 },
  { id: "minecraft:diamond", count: [1, 3], weight: 3 },
  { id: "pet", count: [1, 1], weight: 3 },
  { id: "bundle", count: [1, 1], weight: 3 },
  { id: "minecraft:firework_rocket", count: [3, 6], weight: 3 },
  { id: "minecraft:cake", count: [1, 1], weight: 2 },
  { id: "minecraft:golden_apple", count: [1, 2], weight: 2 },
  { id: "minecraft:name_tag", count: [1, 1], weight: 2 },
  { id: "disc", count: [1, 1], weight: 2 },
  { id: "minecraft:saddle", count: [1, 1], weight: 1 },
  { id: "minecraft:spyglass", count: [1, 1], weight: 1 },
  { id: "minecraft:elytra", count: [1, 1], weight: 0.4 },
  { id: "minecraft:enchanted_golden_apple", count: [1, 1], weight: 0.5 },
  { id: "minecraft:totem_of_undying", count: [1, 1], weight: 0.5 },
];
const PETS = ["minecraft:wolf_spawn_egg", "minecraft:cat_spawn_egg", "minecraft:parrot_spawn_egg",
  "minecraft:fox_spawn_egg", "minecraft:panda_spawn_egg", "minecraft:rabbit_spawn_egg", "minecraft:axolotl_bucket"];
const DISCS = ["cat", "blocks", "chirp", "mall", "mellohi", "far", "strad", "wait"].map((d) => `minecraft:music_disc_${d}`);
const BUNDLES = ["red", "green", "blue", "yellow", "pink", "purple", "orange", "lime", "light_blue"]
  .map((c) => `minecraft:${c}_bundle`);
const JACKPOTS = ["minecraft:elytra", "minecraft:enchanted_golden_apple", "minecraft:totem_of_undying"];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function drawGifts() {
  const bag = [...GIFTS];
  const out = [];
  const howMany = rint(2, 3);
  while (out.length < howMany && bag.length) {
    let roll = Math.random() * bag.reduce((s, g) => s + g.weight, 0);
    let i = bag.findIndex((g) => (roll -= g.weight) < 0);
    if (i < 0) i = 0;
    const g = bag.splice(i, 1)[0];
    const id = g.id === "pet" ? pick(PETS) : g.id === "disc" ? pick(DISCS) : g.id === "bundle" ? pick(BUNDLES) : g.id;
    out.push([id, rint(g.count[0], g.count[1])]);
  }
  return out;
}

function giftName([id, n]) {
  let name = id.split(":")[1].replace("_spawn_egg", " egg").replace("music_disc_", "music disc: ").replace(/_/g, " ");
  if (id === "minecraft:axolotl_bucket") name = "axolotl in a bucket";
  return n > 1 ? `${n} ${name}` : `a ${name}`;
}

// ---------- Getting the tree item (no cheats needed) and remembering who plays ----------
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  const names = getJSON("santa:players", []);
  if (!names.includes(player.name)) {
    names.push(player.name);
    setJSON("santa:players", names.slice(-MAX_PLAYERS));
  }
  system.runTimeout(() => {
    try {
      if (player.getDynamicProperty("santa:got_tree")) return;
      const inv = player.getComponent("minecraft:inventory").container;
      const leftover = inv.addItem(new ItemStack(TREE_ITEM, 1));
      if (leftover) player.dimension.spawnItem(leftover, player.location);
      player.setDynamicProperty("santa:got_tree", true);
      player.sendMessage("§aYou found a Christmas Tree! §fLook at the ground and hold the use button to plant it. Santa visits every night!");
    } catch {}
  }, 140);
});

// ---------- Planting the tree ----------
const SOFT = ["air", "short_grass", "tall_grass", "tallgrass", "fern", "snow_layer", "dandelion", "poppy",
  "tulip", "daisy", "orchid", "allium", "bluet", "cornflower", "lily_of_the_valley", "deadbush", "dead_bush"];
const isSoft = (id) => SOFT.some((w) => id.includes(w));

const ORNAMENTS = ["minecraft:red_concrete", "minecraft:shroomlight", "minecraft:gold_block",
  "minecraft:sea_lantern", "minecraft:pearlescent_froglight", "minecraft:light_blue_concrete"];

// Layers of branches: [height above the ground, radius]. Tiers make it look like a real tree.
const LAYERS = [[2, 3.2], [3, 2.3], [4, 2.7], [5, 1.8], [6, 2.1], [7, 1.2], [8, 0.6]];

function treeShape() {
  const blocks = [];
  for (let dy = 0; dy <= 7; dy++) blocks.push({ dx: 0, dy, dz: 0, b: "log" });
  for (const [dy, r] of LAYERS) {
    const R = Math.ceil(r);
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        if (dx * dx + dz * dz > r * r || (dx === 0 && dz === 0 && dy <= 7)) continue;
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, c]) => (dx + a) ** 2 + (dz + c) ** 2 > r * r);
        blocks.push({ dx, dy, dz, b: edge && Math.random() < 0.2 ? "ornament" : "leaves" });
      }
    }
  }
  blocks.push({ dx: 0, dy: 9, dz: 0, b: "star" });
  return blocks;
}

world.afterEvents.itemUse.subscribe(({ source: player, itemStack }) => {
  if (itemStack?.typeId !== TREE_ITEM || player?.typeId !== "minecraft:player") return;
  let hit;
  try {
    hit = player.getBlockFromViewDirection({ maxDistance: 8 });
  } catch {}
  if (!hit) {
    player.sendMessage("§eLook at the ground where you want the tree, then try again!");
    return;
  }
  const g = hit.block.location;
  const base = { x: g.x, y: g.y + 1, z: g.z };
  if (plantTree(player.dimension, base)) {
    setJSON("santa:tree", { dim: player.dimension.id, x: base.x, y: base.y, z: base.z });
    world.setDynamicProperty("santa:lastNight", world.getDay() - 1);
    player.sendMessage("§aYour Christmas tree is ready! §fSanta will fly by tonight after it gets dark. Look up at the sky!");
    playSound("random.levelup", player.location, 1.2);
  } else {
    player.sendMessage("§cNot enough room here! The tree needs an open space about 7 blocks wide and 10 blocks tall.");
  }
});

function plantTree(dim, base) {
  const shape = treeShape();
  // Check the space first.
  for (const s of shape) {
    try {
      const id = dim.getBlock({ x: base.x + s.dx, y: base.y + s.dy, z: base.z + s.dz })?.typeId ?? "unloaded";
      if (!isSoft(id)) return false;
    } catch {
      return false;
    }
  }
  const perms = {
    log: tryPerm(["minecraft:spruce_log"]),
    leaves: tryPerm(["minecraft:spruce_leaves"], [{ persistent_bit: true }]) || tryPerm(["minecraft:spruce_leaves"]),
    star: tryPerm(["minecraft:glowstone"]),
  };
  const ornamentPerms = ORNAMENTS.map((id) => tryPerm([id])).filter(Boolean);
  for (const s of shape) {
    const perm = s.b === "ornament" ? pick(ornamentPerms) : perms[s.b];
    setBlock(dim, { x: base.x + s.dx, y: base.y + s.dy, z: base.z + s.dz }, perm);
  }
  // Snow around the tree (outside where the presents go).
  const snow = tryPerm(["minecraft:snow_layer"]);
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      const d2 = dx * dx + dz * dz;
      if (d2 < 9 || d2 > 20 || Math.random() < 0.3) continue;
      const loc = { x: base.x + dx, y: base.y, z: base.z + dz };
      try {
        const here = dim.getBlock(loc), below = dim.getBlock({ ...loc, y: loc.y - 1 });
        if (here?.typeId === "minecraft:air" && solidGround(below)) setBlock(dim, loc, snow);
      } catch {}
    }
  }
  for (let i = 0; i < 20; i++) {
    try {
      dim.spawnParticle("minecraft:totem_particle", {
        x: base.x + 0.5 + (Math.random() - 0.5) * 5, y: base.y + Math.random() * 9, z: base.z + 0.5 + (Math.random() - 0.5) * 5,
      });
    } catch {}
  }
  return true;
}

// ---------- Santa's schedule ----------
let flying = false;

system.runInterval(() => {
  const tree = getJSON("santa:tree", null);
  if (!tree || flying) return;
  const t = world.getTimeOfDay(), day = world.getDay();
  let last = world.getDynamicProperty("santa:lastNight");
  if (typeof last !== "number") last = day - 1;

  if (t >= SANTA_TIME && t < 23000 && last < day) {
    santaVisit(tree, day, true);
  } else if (t < 12000 && last < day - 1) {
    // Everyone slept through the night (or nobody was nearby): presents are waiting in the morning.
    santaVisit(tree, day - 1, false);
  }
}, 40);

function santaVisit(tree, nightDay, atNight) {
  let dim;
  try {
    dim = world.getDimension(tree.dim);
  } catch {
    return;
  }
  const base = { x: tree.x, y: tree.y, z: tree.z };
  let trunk;
  try {
    trunk = dim.getBlock(base);
  } catch {}
  if (!trunk) return; // too far away to reach right now; try again later
  if (!trunk.typeId.includes("log")) {
    setJSON("santa:tree", undefined); // the tree is gone
    return;
  }
  world.setDynamicProperty("santa:lastNight", nightDay);

  const watchers = world.getAllPlayers().filter((p) => p.dimension.id === tree.dim && dist(p.location, base) < 128);
  if (atNight && watchers.length) {
    flySanta(dim, base, watchers, () => leavePresents(dim, base, false));
  } else {
    leavePresents(dim, base, true);
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// Jingle Bells (public domain): E E E- E E E- E G C D E--
const JINGLE = [[4, 6], [4, 6], [4, 12], [4, 6], [4, 6], [4, 12], [4, 6], [7, 6], [0, 9], [2, 3], [4, 24]];

function playJingle(players) {
  let at = 0;
  for (const [semi, len] of JINGLE) {
    const pitch = Math.pow(2, (semi - 4) / 12);
    system.runTimeout(() => {
      for (const p of players) {
        try {
          p.playSound("note.bell", { pitch, volume: 0.9 });
        } catch {}
      }
    }, at);
    at += len;
  }
}

function flySanta(dim, tree, watchers, onDrop) {
  flying = true;
  const angle = Math.random() * Math.PI * 2;
  const R = 36, H = 18;
  const cx = tree.x + 0.5, cz = tree.z + 0.5, cy = tree.y + H;
  const start = { x: cx - Math.cos(angle) * R, y: cy, z: cz - Math.sin(angle) * R };
  const end = { x: cx + Math.cos(angle) * R, y: cy, z: cz + Math.sin(angle) * R };
  const dx = end.x - start.x, dz = end.z - start.z;
  const yaw = (Math.atan2(-dx, dz) * 180) / Math.PI;

  let santa;
  try {
    santa = dim.spawnEntity(SANTA, start);
    santa.nameTag = "§cSanta Claus";
  } catch {
    flying = false;
    onDrop();
    return;
  }
  for (const p of watchers) {
    try {
      p.onScreenDisplay.setTitle("§cSanta is coming!", { subtitle: "Look up at the sky!", fadeInDuration: 10, stayDuration: 60, fadeOutDuration: 20 });
    } catch {}
  }
  playJingle(watchers);
  system.runTimeout(() => playJingle(watchers), 100);

  const TICKS = 240;
  let tick = 0, dropped = false;
  const run = system.runInterval(() => {
    tick++;
    const f = tick / TICKS;
    const pos = { x: start.x + dx * f, y: cy + Math.sin(f * Math.PI) * 2, z: start.z + dz * f };
    try {
      santa.teleport(pos, { rotation: { x: 0, y: yaw } });
    } catch {}
    if (tick % 2 === 0) {
      const trail = { x: pos.x - (dx / R) * 1.5, y: pos.y + 0.5, z: pos.z - (dz / R) * 1.5 };
      try { dim.spawnParticle("minecraft:snowflake_particle", trail); } catch {}
      try { dim.spawnParticle("minecraft:endrod", trail); } catch {}
    }
    if (!dropped && f >= 0.5) {
      dropped = true;
      for (const p of watchers) {
        try { p.sendMessage("§cSanta: §fHo ho ho! Merry Christmas!"); } catch {}
      }
      onDrop();
    }
    if (tick >= TICKS) {
      system.clearRun(run);
      try { santa.remove(); } catch {}
      flying = false;
    }
  }, 1);
}

// Clean up a sleigh left in the sky if the world was closed mid-flight.
system.runInterval(() => {
  if (flying) return;
  for (const d of ["overworld", "nether", "the_end"]) {
    try {
      for (const e of world.getDimension(d).getEntities({ type: SANTA })) e.remove();
    } catch {}
  }
}, 200);

// ---------- Presents ----------
function leavePresents(dim, base, morning) {
  const names = getJSON("santa:players", []).slice(-MAX_PLAYERS);
  for (const p of world.getAllPlayers()) if (!names.includes(p.name)) names.push(p.name);
  const presents = getJSON("santa:presents", {});
  const waiting = Object.keys(presents).filter((k) => k.startsWith(dim.id + "|")).length;

  // Spots under the branches, around the trunk.
  const spots = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue;
      spots.push({ x: base.x + dx, y: base.y, z: base.z + dz });
    }
  }
  const free = spots.filter((l) => {
    try {
      const here = dim.getBlock(l), above = dim.getBlock({ ...l, y: l.y + 1 }), below = dim.getBlock({ ...l, y: l.y - 1 });
      return here && above && below && isSoft(here.typeId) && isSoft(above.typeId) && solidGround(below);
    } catch {
      return false;
    }
  });
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }

  let placed = 0;
  const air = tryPerm(["minecraft:air"]);
  for (const name of names) {
    if (waiting + placed >= MAX_PRESENTS || !free.length) break;
    const loc = free.pop();
    const signLoc = { ...loc, y: loc.y + 1 };
    setBlock(dim, signLoc, air); // clear any grass or flowers first
    setBlock(dim, loc, air);
    const gifts = drawGifts();
    const perm = tryPerm([pick(PRESENT_TYPES)], [undefined]) || tryPerm(PRESENT_TYPES);
    if (perm) {
      setBlock(dim, loc, perm);
      presents[locKey(dim.id, loc)] = { owner: name, gifts };
    } else {
      // Backup plan: a chest with the gifts already inside.
      console.warn("[Santa] Present block not available; using a chest instead.");
      setBlock(dim, loc, tryPerm(["minecraft:chest"]));
      try {
        const box = dim.getBlock(loc)?.getComponent("minecraft:inventory")?.container;
        for (const [id, n] of gifts) {
          try { box.addItem(new ItemStack(id, n)); } catch {}
        }
      } catch {}
    }
    const typeNow = dim.getBlock(loc)?.typeId ?? "";
    if (!typeNow.startsWith("santa:present") && typeNow !== "minecraft:chest") {
      console.warn(`[Santa] Could not place a present at ${loc.x},${loc.y},${loc.z} (found ${typeNow}).`);
      continue;
    }
    nameSign(dim, signLoc, name);
    try {
      dim.spawnParticle("minecraft:totem_particle", { x: loc.x + 0.5, y: loc.y + 1, z: loc.z + 0.5 });
    } catch {}
    placed++;
  }
  setJSON("santa:presents", presents);
  if (!placed) {
    console.warn(`[Santa] No presents placed: ${free.length} free spots, ${waiting} already waiting, ${names.length} players.`);
  }

  const msg = !placed
    ? (waiting >= MAX_PRESENTS
      ? "§eSanta flew by, but there are already lots of presents waiting under the tree. Open them!"
      : "§eSanta flew by, but couldn't find room under the tree! Clear some space around it.")
    : morning
    ? "§cSanta came while you were sleeping! §fThere are presents under the Christmas tree!"
    : "§fSanta left presents under the Christmas tree! Find the one with your name and tap it to open it!";
  for (const p of world.getAllPlayers()) {
    try {
      p.sendMessage(msg);
      if (placed) p.playSound("random.orb", { pitch: 1.4 });
    } catch {}
  }
}

function nameSign(dim, loc, name) {
  try {
    const block = dim.getBlock(loc);
    if (!block) return;
    const perm = tryPerm(["minecraft:standing_sign", "minecraft:oak_standing_sign"], [{ ground_sign_direction: rint(0, 15) }, undefined]);
    if (!perm) return;
    block.setPermutation(perm);
    const sign = dim.getBlock(loc)?.getComponent("minecraft:sign"); // look again now that it's a sign
    if (!sign) return;
    const text = `§4For\n§0${name}`;
    try { sign.setText(text, "Front"); } catch { try { sign.setText(text); } catch {} }
    try { sign.setText(text, "Back"); } catch {}
    try { sign.setWaxed(true); } catch {}
  } catch {}
}

// Tapping a present unwraps it.
const opening = new Set();
try {
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (!PRESENT_TYPES.includes(event.block.typeId)) return;
    event.cancel = true;
    const { player } = event;
    const dimId = event.block.dimension.id, loc = { ...event.block.location };
    system.run(() => unwrap(player, dimId, loc));
  });
} catch {}

function unwrap(player, dimId, loc) {
  const k = locKey(dimId, loc);
  if (opening.has(k)) return;
  const presents = getJSON("santa:presents", {});
  const record = presents[k];
  if (record && record.owner !== player.name) {
    player.sendMessage(`§eThis present is for §f${record.owner}§e! Look for the one with your name.`);
    return;
  }
  opening.add(k);
  try {
    const dim = world.getDimension(dimId);
    removeSign(dim, loc);
    setBlock(dim, loc, tryPerm(["minecraft:air"]));
    const gifts = record ? record.gifts : drawGifts();
    giveGifts(player, gifts);
    delete presents[k];
    setJSON("santa:presents", presents);
    celebrate(dim, loc, player);
  } finally {
    system.runTimeout(() => opening.delete(k), 20);
  }
}

// Breaking a present (instead of tapping it) still gives the gifts.
world.afterEvents.playerBreakBlock.subscribe(({ player, block, brokenBlockPermutation }) => {
  if (!PRESENT_TYPES.includes(brokenBlockPermutation.type.id)) return;
  const k = locKey(block.dimension.id, block.location);
  const presents = getJSON("santa:presents", {});
  const record = presents[k];
  const gifts = record ? record.gifts : drawGifts();
  delete presents[k];
  setJSON("santa:presents", presents);
  removeSign(block.dimension, block.location);
  for (const [id, n] of gifts) {
    try {
      block.dimension.spawnItem(new ItemStack(id, n), { x: block.location.x + 0.5, y: block.location.y + 0.5, z: block.location.z + 0.5 });
    } catch {}
  }
  if (record && record.owner !== player.name) player.sendMessage(`§eOops! That one was for §f${record.owner}§e. Their gifts fell out, so pass them along!`);
  celebrate(block.dimension, block.location, player);
});

function removeSign(dim, loc) {
  try {
    const above = dim.getBlock({ x: loc.x, y: loc.y + 1, z: loc.z });
    if (above && above.typeId.includes("sign")) above.setPermutation(tryPerm(["minecraft:air"]));
  } catch {}
}

function giveGifts(player, gifts) {
  const got = [];
  for (const [id, n] of gifts) {
    try {
      const item = new ItemStack(id, n);
      const leftover = player.getComponent("minecraft:inventory").container.addItem(item);
      if (leftover) player.dimension.spawnItem(leftover, player.location);
      got.push(giftName([id, n]));
    } catch {}
  }
  if (gifts.some(([id]) => JACKPOTS.includes(id))) {
    player.sendMessage("§d§lWOW! §r§dSanta brought you something SUPER rare!");
  }
  player.sendMessage(`§aYou unwrapped: §f${got.join(", ") || "a surprise"}!`);
  try {
    player.onScreenDisplay.setTitle("§cMerry Christmas!", { subtitle: got.join(", "), fadeInDuration: 5, stayDuration: 50, fadeOutDuration: 15 });
  } catch {}
}

function celebrate(dim, loc, player) {
  playSound("random.levelup", player.location, 1.3);
  for (let i = 0; i < 4; i++) {
    system.runTimeout(() => {
      try {
        dim.spawnParticle("minecraft:totem_particle", {
          x: loc.x + 0.5 + (Math.random() - 0.5), y: loc.y + 0.5 + Math.random(), z: loc.z + 0.5 + (Math.random() - 0.5),
        });
      } catch {}
    }, i * 4);
  }
}

// ---------- Helpers ----------
// Something you could stand on (not air, water, lava, or a plant).
function solidGround(block) {
  if (!block) return false;
  const id = block.typeId;
  return id !== "minecraft:air" && !isSoft(id) && !id.includes("water") && !id.includes("lava") && !id.includes("leaves");
}

function tryPerm(ids, stateOptions = [undefined]) {
  for (const id of ids) {
    for (const states of stateOptions) {
      try {
        return BlockPermutation.resolve(id, states);
      } catch {}
    }
  }
  return undefined;
}

function setBlock(dim, loc, perm) {
  if (!perm) return;
  try {
    dim.getBlock(loc)?.setPermutation(perm);
  } catch {}
}

function playSound(id, location, pitch) {
  try {
    world.playSound(id, location, { pitch, volume: 1 });
  } catch {}
}
