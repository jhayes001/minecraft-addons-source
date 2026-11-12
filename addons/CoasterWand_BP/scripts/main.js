// Coaster Wand: use it in an open space, pick a size, and a random roller coaster
// builds itself in front of you: lift hill, drops, hills, sometimes a tunnel dive,
// a station and two minecarts. Sit in a cart and it starts by itself. Stay in for
// another lap, or hop out at the station.
// Use the wand next to a ride to remove it; the land goes back how it was.
import { world, system, ItemStack, BlockPermutation } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const WAND_ID = "coaster:coaster_wand";
const GAP = 4;            // blocks between the player and the station track
const STATION_WAIT = 60;  // ticks a rider sits at the station before the cart goes
const LAUNCH_GRACE = 50;  // ticks after a launch before the station can stop that cart
const MAX_PILLAR = 48;

const SIZES = [
  { name: "Little", n: 3, m: 3, cell: 5, H: 7, fill: [0.6, 0.9], tunnel: false },
  { name: "Medium", n: 5, m: 4, cell: 5, H: 12, fill: [0.5, 0.75], tunnel: true },
  { name: "Big", n: 6, m: 6, cell: 6, H: 18, fill: [0.45, 0.7], tunnel: true },
];

const RAINBOW_WOOL = [
  "minecraft:red_wool", "minecraft:orange_wool", "minecraft:yellow_wool",
  "minecraft:lime_wool", "minecraft:light_blue_wool", "minecraft:blue_wool",
  "minecraft:purple_wool",
];

// Each theme: deck (under the rails), support pillars, tunnel lining, lights, station.
const THEMES = [
  {
    name: "Wooden",
    deck: () => ["minecraft:spruce_planks", "minecraft:planks"],
    support: () => ["minecraft:spruce_fence", "minecraft:oak_fence", "minecraft:fence"],
    lining: () => "minecraft:stone_bricks",
    light: ["minecraft:glowstone"],
    platform: () => ["minecraft:oak_planks", "minecraft:planks"],
    post: ["minecraft:oak_fence", "minecraft:fence"],
  },
  {
    name: "Rainbow",
    deck: (i) => RAINBOW_WOOL[Math.floor(i / 3) % RAINBOW_WOOL.length],
    support: (i, y) => RAINBOW_WOOL[((y % 7) + 7) % 7],
    lining: () => "minecraft:white_concrete",
    light: ["minecraft:pearlescent_froglight", "minecraft:glowstone"],
    platform: (k) => RAINBOW_WOOL[((k % 7) + 7) % 7],
    post: ["minecraft:white_concrete"],
  },
  {
    name: "Candy",
    deck: (i) => (i % 2 ? "minecraft:pink_concrete" : "minecraft:white_concrete"),
    support: (i, y) => (((y % 2) + 2) % 2 ? "minecraft:red_concrete" : "minecraft:white_concrete"),
    lining: () => "minecraft:pink_terracotta",
    light: ["minecraft:pearlescent_froglight", "minecraft:glowstone"],
    platform: (k) => (((k % 2) + 2) % 2 ? "minecraft:pink_wool" : "minecraft:white_wool"),
    post: ["minecraft:red_concrete"],
  },
  {
    name: "Ice",
    deck: () => "minecraft:packed_ice",
    support: () => "minecraft:packed_ice",
    lining: () => "minecraft:packed_ice",
    light: ["minecraft:sea_lantern"],
    platform: () => "minecraft:snow",
    post: ["minecraft:spruce_fence", "minecraft:oak_fence", "minecraft:fence"],
  },
  {
    name: "Jungle",
    deck: () => ["minecraft:jungle_planks", "minecraft:planks"],
    support: () => ["minecraft:jungle_log", "minecraft:log"],
    lining: () => (Math.random() < 0.4 ? "minecraft:mossy_cobblestone" : "minecraft:mossy_stone_bricks"),
    light: ["minecraft:ochre_froglight", "minecraft:glowstone"],
    platform: () => ["minecraft:jungle_planks", "minecraft:planks"],
    post: ["minecraft:jungle_fence", "minecraft:oak_fence", "minecraft:fence"],
  },
];

// Blocks that probably belong to something she built. If any are in the way,
// the wand refuses rather than bulldozing it.
const PROTECTED = [
  "chest", "barrel", "bed", "door", "crafting_table", "furnace", "planks",
  "glass", "wool", "bricks", "concrete", "carpet", "sign", "shulker",
  "torch", "lantern", "bookshelf", "fence", "stairs", "slab", "quartz",
  "glowstone", "gold_block", "rail", "redstone", "button", "lever", "froglight",
  "packed_ice", "terracotta", "frame", "banner", "flower_pot", "rainbow",
];
const FALLING = ["sand", "gravel", "concrete_powder"];
const LIQUID = ["water", "lava"];

const DIRS = { "0,-1": "north", "0,1": "south", "1,0": "east", "-1,0": "west" };
const ASCENDING = { east: 2, west: 3, north: 4, south: 5 };
const CURVES = { "east,south": 6, "south,west": 7, "north,west": 8, "east,north": 9 };

const busy = new Set();

// ---------- Blocks ----------
const permCache = new Map();
function perm(ids, states) {
  const list = Array.isArray(ids) ? ids : [ids];
  const k = list.join("|") + (states ? JSON.stringify(states) : "");
  let p = permCache.get(k);
  if (p) return p;
  for (const id of list) {
    try {
      p = BlockPermutation.resolve(id, states);
      break;
    } catch {}
  }
  if (!p) p = BlockPermutation.resolve("minecraft:stone");
  permCache.set(k, p);
  return p;
}

// ---------- Give the wand on first join ----------
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      if (player.getDynamicProperty("coaster:got_wand")) return;
      const inv = player.getComponent("minecraft:inventory").container;
      const leftover = inv.addItem(new ItemStack(WAND_ID, 1));
      if (leftover) player.dimension.spawnItem(leftover, player.location);
      player.setDynamicProperty("coaster:got_wand", true);
      player.sendMessage("§bYou found a Coaster Wand! §fUse it in a big open space to build a roller coaster.");
    } catch {}
  }, 80);
});

// ---------- Using the wand ----------
world.afterEvents.itemUse.subscribe(({ source: player, itemStack }) => {
  if (itemStack?.typeId !== WAND_ID) return;
  if (player?.typeId !== "minecraft:player") return;
  if (busy.has(player.id)) return;
  menu(player);
});

async function menu(player) {
  busy.add(player.id);
  try {
    const near = rideNear(player);
    if (near) {
      const sure = await new ActionFormData()
        .title("Coaster Wand")
        .body("Remove this ride?")
        .button("§cYes, remove it")
        .button("No, keep it")
        .show(player);
      if (!sure.canceled && sure.selection === 0) await removeRide(player, near);
      return;
    }
    const form = new ActionFormData().title("Coaster Wand").body("How big?");
    SIZES.forEach((s) => form.button(s.name));
    form.button("Surprise me!");
    const pick = await form.show(player);
    if (pick.canceled || pick.selection === undefined) return;
    const size = SIZES[pick.selection] ?? SIZES[Math.floor(Math.random() * SIZES.length)];
    await buildRide(player, size);
  } catch (e) {
    console.warn(`[Coaster] ${e}`);
  } finally {
    busy.delete(player.id);
  }
}

// ---------- The track's shape ----------
// The loop is the outline of a random blob of grid cells, so it never crosses itself.
function traceLoop(cells) {
  const has = (x, y) => cells.has(`${x},${y}`);
  const adj = new Map();
  let edges = 0;
  const addEdge = (a, b) => {
    const ka = `${a[0]},${a[1]}`, kb = `${b[0]},${b[1]}`;
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push(kb);
    adj.get(kb).push(ka);
    edges++;
  };
  for (const c of cells) {
    const [x, y] = c.split(",").map(Number);
    if (!has(x, y - 1)) addEdge([x, y], [x + 1, y]);
    if (!has(x, y + 1)) addEdge([x, y + 1], [x + 1, y + 1]);
    if (!has(x - 1, y)) addEdge([x, y], [x, y + 1]);
    if (!has(x + 1, y)) addEdge([x + 1, y], [x + 1, y + 1]);
  }
  for (const list of adj.values()) if (list.length !== 2) return null; // pinched corner
  const start = adj.keys().next().value;
  const loop = [start];
  let prev = null, cur = start;
  for (;;) {
    const [a, b] = adj.get(cur);
    const next = a !== prev ? a : b;
    if (next === start) break;
    loop.push(next);
    prev = cur;
    cur = next;
    if (loop.length > edges) return null;
  }
  if (loop.length !== edges) return null; // a hole or two separate loops
  return loop.map((k) => k.split(",").map(Number));
}

function makeLoop(size) {
  const { n, m, fill } = size;
  const want = Math.round(n * m * (fill[0] + Math.random() * (fill[1] - fill[0])));
  const c0 = Math.max(0, Math.floor(n / 2) - 1);
  const cells = new Set([`${c0},0`, `${c0 + 1},0`]);
  for (let tries = 0; cells.size < want && tries < 600; tries++) {
    const list = [...cells];
    const [x, y] = list[Math.floor(Math.random() * list.length)].split(",").map(Number);
    const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)];
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= n || ny >= m || cells.has(`${nx},${ny}`)) continue;
    cells.add(`${nx},${ny}`);
    if (!traceLoop(cells)) cells.delete(`${nx},${ny}`);
  }
  return traceLoop(cells);
}

// Turns the corner points into a list of track blocks (u across, v away from the player),
// starting at the station stop.
function blockPath(verts, cell) {
  if (Math.random() < 0.5) verts = verts.slice().reverse();
  const V = verts.length;
  // The station goes on the near side (v = 0), on the longest straight there.
  let best = -1, bestLen = 0;
  for (let j = 0; j < V; j++) {
    const a = verts[j], prev = verts[(j - 1 + V) % V];
    if (a[1] !== 0 || prev[1] === 0) continue;
    let len = 0;
    while (verts[(j + len + 1) % V][1] === 0 && len < V) len++;
    if (len > bestLen) { best = j; bestLen = len; }
  }
  if (best < 0 || bestLen * cell < 10) return null;
  verts = [...verts.slice(best), ...verts.slice(0, best)];
  const path = [];
  for (let j = 0; j < V; j++) {
    const a = verts[j], b = verts[(j + 1) % V], before = verts[(j - 1 + V) % V];
    const dirIn = [Math.sign(a[0] - before[0]), Math.sign(a[1] - before[1])];
    const dirOut = [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
    const corner = dirIn[0] !== dirOut[0] || dirIn[1] !== dirOut[1];
    for (let s = 0; s < cell; s++) {
      path.push({ u: a[0] * cell + dirOut[0] * s, v: a[1] * cell + dirOut[1] * s, corner: s === 0 && corner });
    }
  }
  // Start at the stop, 4 blocks along the station straight.
  return [...path.slice(4), ...path.slice(0, 4)];
}

// Heights along the track: up the lift hill, a big drop, smaller hills, back to the station.
// Minecart rules: at most 1 up or down per block, corners are flat, and no 1-block dips.
function heightProfile(path, size) {
  const N = path.length;
  const corner = path.map((p) => p.corner);
  const last = N - 4;            // the last 4 blocks are the flat station approach
  const hi = new Array(N).fill(0), lo = new Array(N).fill(0);
  for (let i = last - 1; i >= 0; i--) {
    hi[i] = corner[i + 1] ? hi[i + 1] : hi[i + 1] + 1; // can't drop into a corner
    lo[i] = corner[i] ? lo[i + 1] : lo[i + 1] - 1;     // can't climb right after a corner
  }
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const plan = [[size.H, rnd(1, 3)]];
  plan.push([size.tunnel && Math.random() < 0.5 ? -4 : rnd(0, 1), rnd(1, 3)]);
  let top = size.H;
  while (plan.length < 10) {
    top = Math.max(2, Math.round(top * (0.5 + Math.random() * 0.3)));
    plan.push([top, rnd(0, 2)]);
    plan.push([rnd(0, 1), rnd(1, 2)]);
  }
  plan.push([0, 9999]);

  const h = new Array(N).fill(0);
  let p = 0, reached = -1;
  for (let i = 1; i < N; i++) {
    let want = 0;
    if (i > 4 && i < last) {
      if (h[i - 1] === plan[p][0]) {
        if (reached < 0) reached = i;
        if (i - reached >= plan[p][1] && p < plan.length - 1) { p++; reached = -1; }
      }
      want = plan[p][0];
    }
    let a = h[i - 1] - 1, b = h[i - 1] + 1;
    if (corner[i - 1]) b = Math.min(b, h[i - 1]);
    if (corner[i]) a = Math.max(a, h[i - 1]);
    if (i >= 2 && h[i - 1] < h[i - 2]) b = Math.min(b, h[i - 1]);
    if (i <= last) { b = Math.min(b, hi[i]); a = Math.max(a, lo[i]); } else { a = Math.max(a, 0); b = Math.min(b, 0); }
    if (i <= 4) { a = Math.max(a, 0); b = Math.min(b, 0); }
    a = Math.max(a, -4);
    if (a > b) return null;
    h[i] = Math.max(a, Math.min(b, want));
  }
  if (!validHeights(h, corner)) return null;
  if (Math.max(...h) < Math.ceil(size.H * 0.7)) return null;
  return h;
}

function validHeights(h, corner) {
  const N = h.length;
  for (let i = 0; i < N; i++) {
    const a = h[(i - 1 + N) % N], c = h[i], b = h[(i + 1) % N];
    if (Math.abs(b - c) > 1) return false;
    if (a > c && b > c) return false;
    if (corner[i] && (a > c || b > c)) return false;
  }
  for (let i = -4; i <= 4; i++) if (h[(i + N) % N] !== 0) return false;
  return true;
}

function designTrack(size) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const verts = makeLoop(size);
    if (!verts) continue;
    const path = blockPath(verts, size.cell);
    if (!path) continue;
    const h = heightProfile(path, size);
    if (!h) continue;
    path.forEach((t, i) => (t.h = h[i]));
    return path;
  }
  return null;
}

// Rail shape and type for each block, from its neighbors.
function railFor(track, i) {
  const N = track.length;
  const a = track[(i - 1 + N) % N], t = track[i], b = track[(i + 1) % N];
  const toPrev = DIRS[`${a.x - t.x},${a.z - t.z}`];
  const toNext = DIRS[`${b.x - t.x},${b.z - t.z}`];
  if (t.corner) {
    const shape = CURVES[[toPrev, toNext].sort().join(",")];
    return { id: "minecraft:rail", dir: shape, golden: false };
  }
  // Powered going uphill and on the flat (so carts never stall); free-wheeling downhill.
  // The station stretch is plain rail so a stopped cart stays put.
  const station = i === 0 || i >= N - 4;
  if (b.h > t.h) return { id: "minecraft:golden_rail", dir: ASCENDING[toNext], golden: true };
  if (a.h > t.h) return { id: "minecraft:rail", dir: ASCENDING[toPrev], golden: false };
  const dir = toNext === "north" || toNext === "south" ? 0 : 1;
  return { id: station ? "minecraft:rail" : "minecraft:golden_rail", dir, golden: !station };
}

// ---------- Building ----------
function soft(id) {
  if (id === "minecraft:air" || id === "minecraft:grass_block") return id === "minecraft:air";
  return LIQUID.some((w) => id.includes(w)) || id.includes("grass") || id.includes("fern")
    || id.includes("flower") || id.includes("tulip") || id.includes("dandelion") || id.includes("poppy")
    || id.includes("orchid") || id.includes("allium") || id.includes("bluet") || id.includes("daisy")
    || id.includes("lily") || id.includes("snow_layer") || id.includes("vine") || id.includes("bush")
    || id.includes("sapling") || id.includes("kelp") || id.includes("leaf_litter") || id.includes("petals");
}

function buildRide(player, size) {
  return new Promise((resolve) => {
    const dim = player.dimension;
    const view = player.getViewDirection();
    const f = Math.abs(view.x) > Math.abs(view.z)
      ? { x: Math.sign(view.x), z: 0 }
      : { x: 0, z: Math.sign(view.z) || 1 };
    const r = { x: -f.z, z: f.x };
    const base = { x: Math.floor(player.location.x), y: Math.floor(player.location.y), z: Math.floor(player.location.z) };
    const theme = THEMES[Math.floor(Math.random() * THEMES.length)];

    const design = designTrack(size);
    if (!design) {
      resolve();
      return;
    }
    const uOff = Math.floor((size.n * size.cell) / 2);
    const track = design.map((t) => ({
      x: base.x + r.x * (t.u - uOff) + f.x * (t.v + GAP),
      z: base.z + r.z * (t.u - uOff) + f.z * (t.v + GAP),
      y: base.y + t.h, h: t.h, corner: t.corner,
    }));
    const N = track.length;
    const onTrack = new Set(track.map((t) => `${t.x},${t.z}`));
    const S = track[0];
    const back = { x: -f.x, z: -f.z };

    const getId = (loc) => {
      try {
        return dim.getBlock(loc)?.typeId ?? "unloaded";
      } catch {
        return "unloaded";
      }
    };

    function* job() {
      // 1. Plan every block change, one group per track block so it builds along the track.
      const steps = [];
      const checks = []; // spots that must not be built-on, liquid, or out of reach
      const air = perm("minecraft:air");
      const redstone = perm("minecraft:redstone_block");
      const lightP = perm(theme.light);

      // Power: every run of powered rails gets a redstone block under every 5th rail.
      const rails = track.map((_, i) => railFor(track, i));
      const source = new Array(N).fill(false);
      for (let i = 0; i < N; i++) {
        if (!rails[i].golden || rails[(i - 1 + N) % N].golden) continue;
        for (let k = 0; rails[(i + k) % N].golden && k < N; k++) if (k % 5 === 0) source[(i + k) % N] = true;
      }

      for (let i = 0; i < N; i++) {
        const t = track[i], ops = [];
        const at = (dx, dy, dz) => ({ x: t.x + dx, y: t.y + dy, z: t.z + dz });
        const out = track[(i + 1) % N];
        const fwd = { x: out.x - t.x, z: out.z - t.z };
        const left = { x: fwd.z, z: -fwd.x };

        // Headroom (and a cap on falling sand overhead).
        ops.push([at(0, 1, 0), air], [at(0, 2, 0), air]);
        if (FALLING.some((w) => getId(at(0, 3, 0)).includes(w))) ops.push([at(0, 3, 0), perm(theme.lining(i))]);

        // Supports down to the ground, wherever the track is up in the air.
        if ((t.corner || i % 3 === 0) && soft(getId(at(0, -2, 0)))) {
          for (let dy = -2; dy >= -MAX_PILLAR; dy--) {
            const id = getId(at(0, dy, 0));
            if (id === "unloaded" || !soft(id)) break;
            ops.push([at(0, dy, 0), perm(theme.support(i, t.y + dy))]);
          }
        }

        // Tunnel or trench: line the dirt walls (and the ceiling if it's deep enough).
        // Over a dip there's nothing to line, so it's just low track on supports.
        if (t.h < 0) {
          const ground = S.y - 1;
          for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
              if ((dx || dz) && !onTrack.has(`${t.x + dx},${t.z + dz}`)) {
                for (let y = t.y - 1; y <= ground; y++) {
                  if (soft(getId({ x: t.x + dx, y, z: t.z + dz }))) continue;
                  const glow = i % 4 === 0 && dx === left.x && dz === left.z && y === t.y + 1;
                  ops.push([{ x: t.x + dx, y, z: t.z + dz }, glow ? lightP : perm(theme.lining(i))]);
                }
              }
            }
          }
          if (t.y + 3 <= ground && !soft(getId(at(0, 3, 0)))) ops.push([at(0, 3, 0), perm(theme.lining(i))]);
        }

        // The deck under the rail, then the rail itself.
        ops.push([at(0, -1, 0), source[i] ? redstone : perm(theme.deck(i))]);
        const rail = rails[i];
        rail.loc = at(0, 0, 0);
        rail.perm = rail.golden
          ? perm("minecraft:golden_rail", { rail_direction: rail.dir, rail_data_bit: true })
          : perm("minecraft:rail", { rail_direction: rail.dir });
        ops.push([rail.loc, rail.perm]);

        // A light beside the track now and then.
        if (t.h >= 0 && !t.corner && i % 6 === 3 && i > 4 && i < N - 5) {
          const side = { x: t.x + left.x, z: t.z + left.z };
          if (!onTrack.has(`${side.x},${side.z}`)) ops.push([{ x: side.x, y: t.y - 1, z: side.z }, lightP]);
        }

        steps.push(ops);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            for (let dy = -1; dy <= 3; dy++) checks.push({ loc: at(dx, dy, dz), wet: true });
          }
        }
      }

      // The station platform on the near side, with lamp posts at the ends.
      const station = [];
      for (let k = -4; k <= 1; k++) {
        const t = track[(k + N) % N];
        for (let o = 1; o <= 2; o++) {
          const x = t.x + back.x * o, z = t.z + back.z * o;
          station.push([{ x, y: t.y - 1, z }, perm(theme.platform(k + o))]);
          for (let dy = 0; dy <= 2; dy++) station.push([{ x, y: t.y + dy, z }, air]);
        }
      }
      for (const k of [-4, 1]) {
        const t = track[(k + N) % N];
        const x = t.x + back.x * 2, z = t.z + back.z * 2;
        station.push([{ x, y: t.y, z }, perm(theme.post)], [{ x, y: t.y + 1, z }, perm(["minecraft:lantern"])]);
      }
      steps.push(station);
      for (const [loc] of station) checks.push({ loc, wet: false });

      // 2. Safety check: in reach, nothing she built, and dry land around the rails.
      let n = 0;
      for (const { loc, wet } of checks) {
        const id = getId(loc);
        if (id === "unloaded") return fail("§cThat area is too far away to build in. Move closer or try a smaller ride.");
        if (PROTECTED.some((w) => id.includes(w))) return fail("§cWhoa! The ride would knock down something already built. Try an open space.");
        if (wet && LIQUID.some((w) => id.includes(w))) return fail("§cThe ride needs dry land. Try somewhere away from water.");
        if (++n % 300 === 0) yield;
      }
      for (const ops of steps) {
        for (const [loc] of ops) {
          if (getId(loc) === "unloaded") return fail("§cThat area is too far away to build in. Move closer or try a smaller ride.");
        }
      }

      // 3. Save the land first so the ride can be removed later.
      const all = steps.flat().map(([loc]) => loc);
      const lim = heightLimits(dim);
      const min = {
        x: Math.min(...all.map((l) => l.x)) - 1, y: Math.max(Math.min(...all.map((l) => l.y)), lim.lo),
        z: Math.min(...all.map((l) => l.z)) - 1,
      };
      const max = {
        x: Math.max(...all.map((l) => l.x)) + 1, y: Math.min(Math.max(...all.map((l) => l.y)), lim.hi),
        z: Math.max(...all.map((l) => l.z)) + 1,
      };
      const id = `coaster:land_${Date.now().toString(36)}${Math.floor(Math.random() * 10000)}`;
      let saved = false;
      try {
        world.structureManager.createFromWorld(id, dim, min, max,
          { saveMode: "World", includeEntities: false, includeBlocks: true });
        saved = true;
      } catch (e) {
        console.warn(`[Coaster] Couldn't save a snapshot of the land: ${e}`);
      }

      // 4. Build it, along the track.
      playSound("block.bell.hit", S, 1);
      const set = ([loc, p]) => {
        try { dim.getBlock(loc)?.setPermutation(p); } catch {}
      };
      for (let i = 0; i < steps.length; i++) {
        steps[i].forEach(set);
        if (i % 3 === 0 && i < N) playSound("random.click", track[i], 0.7 + Math.max(0, track[i].h) / size.H);
        yield;
      }

      // Rails can bend toward a neighbor that's placed after them; set any that moved back.
      const straighten = () => {
        for (const rail of rails) {
          try {
            const b = dim.getBlock(rail.loc);
            if (b && (b.typeId !== rail.id || b.permutation?.getState?.("rail_direction") !== rail.dir)) b.setPermutation(rail.perm);
          } catch {}
        }
      };
      straighten();
      system.runTimeout(straighten, 40);

      const ride = {
        id, dim: dim.id, min, max, saved, theme: theme.name, size: size.name,
        S: { x: S.x, y: S.y, z: S.z }, f: { x: track[1].x - S.x, z: track[1].z - S.z }, // travel direction at the station
        stand: { x: S.x + back.x * 3, y: S.y, z: S.z + back.z * 3 },
        changed: saved ? undefined : all.filter((l) => l.y >= S.y - 1).map((l) => [l.x, l.y, l.z]),
      };
      const list = getRides();
      list.push(ride);
      saveRides(list);
      spawnCarts(ride);
      playSound("random.levelup", S, 1);

      if (!player.getDynamicProperty("coaster:tip")) {
        player.sendMessage("§bSit in a minecart at the station! §fIt starts by itself. Stay in for another lap, or hop out at the station.");
        try { player.setDynamicProperty("coaster:tip", true); } catch {}
      }
      resolve();
    }

    function fail(msg) {
      player.sendMessage(msg);
      resolve();
    }

    system.runJob(job());
  });
}

function spawnCarts(ride) {
  try {
    const dim = world.getDimension(ride.dim);
    for (const k of [0, -2]) {
      dim.spawnEntity("minecraft:minecart", {
        x: ride.S.x + ride.f.x * k + 0.5, y: ride.S.y + 0.1, z: ride.S.z + ride.f.z * k + 0.5,
      });
    }
  } catch {}
}

// ---------- The station: stop arriving carts, send them off when someone's sitting in one ----------
const launchedAt = new Map(); // cart id -> tick
const waitingSince = new Map(); // ride id -> tick
let rides;

const valid = (e) => {
  try { return typeof e.isValid === "function" ? e.isValid() : e.isValid !== false; } catch { return false; }
};
// Only players count: a mob that wanders into a cart doesn't get a ride.
const riders = (cart) => {
  try {
    return (cart.getComponent("minecraft:rideable")?.getRiders() ?? []).filter((e) => e.typeId === "minecraft:player").length;
  } catch {
    return 0;
  }
};

system.runInterval(() => {
  if (!rides) rides = getRides();
  if (!rides.length) return;
  const now = system.currentTick;
  const players = world.getAllPlayers();
  for (const ride of rides) {
    const S = ride.S, f = ride.f;
    const near = players.some((p) => p.dimension.id === ride.dim
      && Math.abs(p.location.x - S.x) < 96 && Math.abs(p.location.z - S.z) < 96);
    if (!near) continue;
    let dim, carts;
    try {
      dim = world.getDimension(ride.dim);
      carts = dim.getEntities({ type: "minecraft:minecart", location: { x: S.x + 0.5 - f.x, y: S.y, z: S.z + 0.5 - f.z }, maxDistance: 4 });
    } catch {
      continue;
    }
    const ready = [];
    for (const cart of carts) {
      if (!valid(cart)) continue;
      const l = cart.location;
      const dx = l.x - (S.x + 0.5), dz = l.z - (S.z + 0.5);
      const along = dx * f.x + dz * f.z, across = dx * f.z - dz * f.x;
      if (Math.abs(across) > 0.8 || along < -3.5 || along > 1.5 || Math.abs(l.y - S.y) > 1.5) continue;
      const t = launchedAt.get(cart.id);
      if (t !== undefined && now - t < LAUNCH_GRACE) continue;
      let v = { x: 0, z: 0 };
      try { v = cart.getVelocity(); } catch {}
      if (Math.hypot(v.x, v.z) > 0.03) {
        try {
          cart.clearVelocity();
        } catch {
          try { cart.applyImpulse({ x: -v.x, y: 0, z: -v.z }); } catch {}
        }
        continue;
      }
      if (riders(cart) > 0) ready.push(cart);
    }
    if (!ready.length) {
      waitingSince.delete(ride.id);
      continue;
    }
    if (!waitingSince.has(ride.id)) waitingSince.set(ride.id, now);
    if (now - waitingSince.get(ride.id) < STATION_WAIT) continue;
    waitingSince.delete(ride.id);
    for (const cart of ready) {
      try {
        cart.applyImpulse({ x: f.x * 0.7, y: 0, z: f.z * 0.7 });
        launchedAt.set(cart.id, now);
      } catch {}
    }
    playSound("note.bell", S, 1.5);
  }
  if (now % 1200 === 0) for (const [k, t] of launchedAt) if (now - t > 1200) launchedAt.delete(k);
}, 1);

// If a ride's carts are gone (broken or lost), two new ones turn up at the station.
system.runInterval(() => {
  if (!rides) rides = getRides();
  const players = world.getAllPlayers();
  for (const ride of rides) {
    const near = players.some((p) => p.dimension.id === ride.dim
      && Math.abs(p.location.x - ride.S.x) < 32 && Math.abs(p.location.z - ride.S.z) < 32);
    if (!near) continue;
    try {
      const dim = world.getDimension(ride.dim);
      const { min, max } = ride;
      const carts = dim.getEntities({
        type: "minecraft:minecart", location: min,
        volume: { x: max.x - min.x + 1, y: max.y - min.y + 1, z: max.z - min.z + 1 },
      });
      if (!carts.length) spawnCarts(ride);
    } catch {}
  }
}, 200);

// ---------- Removing a ride ----------
const inside = (ride, l, pad = 0) => l.x >= ride.min.x - pad && l.x <= ride.max.x + 1 + pad
  && l.z >= ride.min.z - pad && l.z <= ride.max.z + 1 + pad && l.y >= ride.min.y - 2 && l.y <= ride.max.y + 3;

function rideNear(player) {
  return getRides().find((r) => r.dim === player.dimension.id && inside(r, player.location, 3));
}

function removeRide(player, ride) {
  return new Promise((resolve) => {
    let dim;
    try {
      dim = world.getDimension(ride.dim);
    } catch {
      resolve();
      return;
    }
    const { min, max, stand } = ride;
    function* job() {
      for (const c of [min, max, { x: min.x, y: min.y, z: max.z }, { x: max.x, y: min.y, z: min.z }]) {
        let ok = false;
        try { ok = !!dim.getBlock(c); } catch {}
        if (!ok) {
          player.sendMessage("§cPart of the ride is too far away. Stand by the station and try again.");
          resolve();
          return;
        }
      }
      // The carts go first (riders hop off), then everyone on the ride moves to the station.
      try {
        for (const cart of dim.getEntities({ type: "minecraft:minecart" })) {
          if (inside(ride, cart.location)) cart.remove();
        }
      } catch {}
      yield;
      for (const p of world.getAllPlayers()) {
        if (p.dimension.id === ride.dim && inside(ride, p.location)) {
          try { p.teleport({ x: stand.x + 0.5, y: stand.y, z: stand.z + 0.5 }); } catch {}
        }
      }
      for (let i = 0; i < 10; i++) {
        try {
          dim.spawnParticle("minecraft:huge_explosion_emitter", {
            x: min.x + Math.random() * (max.x - min.x), y: stand.y + 2 + Math.random() * 8, z: min.z + Math.random() * (max.z - min.z),
          });
        } catch {}
      }
      playSound("random.pop", player.location, 0.6);

      let restored = false;
      if (ride.saved) {
        try {
          world.structureManager.place(ride.id, dim, min, { animationMode: "Layers", animationSeconds: 2 });
          restored = true;
        } catch {
          try {
            world.structureManager.place(ride.id, dim, min);
            restored = true;
          } catch (e) {
            console.warn(`[Coaster] Couldn't put the land back: ${e}`);
          }
        }
      }
      if (!restored) {
        // No snapshot: take the ride away and patch the ground with grass.
        const airP = perm("minecraft:air"), grass = perm("minecraft:grass_block"), dirt = perm("minecraft:dirt");
        const spots = (ride.changed ?? []).slice().sort((a, b) => b[1] - a[1]);
        for (let i = 0; i < spots.length; i++) {
          const [x, y, z] = spots[i];
          const p = y >= stand.y ? airP : y === stand.y - 1 ? grass : dirt;
          try { dim.getBlock({ x, y, z })?.setPermutation(p); } catch {}
          if (i % 200 === 0) yield;
        }
      }
      saveRides(getRides().filter((r) => r.id !== ride.id));
      system.runTimeout(() => {
        if (restored) {
          try { world.structureManager.delete(ride.id); } catch {}
        }
        resolve();
      }, restored ? 60 : 5);
    }
    system.runJob(job());
  });
}

// ---------- Helpers ----------
function getRides() {
  try {
    const raw = world.getDynamicProperty("coaster:rides");
    if (typeof raw === "string") return JSON.parse(raw);
  } catch {}
  return [];
}

function saveRides(list) {
  list = list.slice(-30);
  try {
    world.setDynamicProperty("coaster:rides", JSON.stringify(list));
  } catch {
    // Too big (rides without snapshots keep a list of changed blocks): drop those lists.
    list.forEach((r) => delete r.changed);
    try { world.setDynamicProperty("coaster:rides", JSON.stringify(list)); } catch {}
  }
  rides = list;
}

function heightLimits(dim) {
  let lo, hi;
  try {
    lo = dim.heightRange?.min;
    hi = dim.heightRange?.max;
  } catch {}
  if (typeof lo !== "number" || typeof hi !== "number") {
    [lo, hi] = dim.id === "minecraft:overworld" ? [-64, 320] : dim.id === "minecraft:nether" ? [0, 128] : [0, 256];
  }
  return { lo, hi: hi - 1 };
}

function playSound(id, location, pitch) {
  try {
    world.playSound(id, location, { pitch, volume: 1 });
  } catch {}
}
