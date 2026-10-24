// Maze Wand: hold "use" to pick a level and a style, and a random maze
// rises out of the ground in front of you. Walk through to the treasure!
// Inside a maze, using the wand again shows a hint.
import { world, system, ItemStack, BlockPermutation } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const WAND_ID = "maze:maze_wand";
const GAP = 2;          // blocks between the player and the maze entrance
const WALL_HEIGHT = 3;
const CLEAR_HEIGHT = 5; // air cleared above the floor so hills don't block paths
const HINT_STEPS = 14;  // how many blocks of the right path a hint reveals

const LEVELS = [
  {
    name: "Easy",
    button: "Easy\n§2Follow the glowing path!",
    cells: 5,
    trail: "full",
    hints: Infinity,
    intro: "Follow the glowing path!",
  },
  {
    name: "Medium",
    button: "Medium\n§2Glowing clues to follow",
    cells: 7,
    trail: "breadcrumbs",
    hints: Infinity,
    intro: "Look for the glowing clues!",
  },
  {
    name: "Hard",
    button: "Hard\n§63 hints",
    cells: 11,
    trail: "none",
    hints: 3,
    intro: "You get 3 hints. Good luck!",
  },
  {
    name: "Expert",
    button: "Expert\n§c1 hint, huge maze",
    cells: 15,
    trail: "none",
    hints: 1,
    intro: "Only 1 hint. Can you do it?",
  },
];

const RAINBOW_WOOL = [
  "minecraft:red_wool", "minecraft:orange_wool", "minecraft:yellow_wool",
  "minecraft:lime_wool", "minecraft:light_blue_wool", "minecraft:blue_wool",
  "minecraft:purple_wool",
];

let hedgeLeaves;
function hedge() {
  if (hedgeLeaves === undefined) {
    try {
      // Persistent so the hedges don't decay like natural leaves.
      hedgeLeaves = BlockPermutation.resolve("minecraft:oak_leaves", { persistent_bit: true });
    } catch {
      hedgeLeaves = "minecraft:moss_block";
    }
  }
  return hedgeLeaves;
}

const THEMES = [
  {
    name: "Hedge Maze",
    wall: () => hedge(),
    floor: () => "minecraft:grass_block",
  },
  {
    name: "Stone Dungeon",
    wall: () => (Math.random() < 0.3 ? "minecraft:mossy_stone_bricks" : "minecraft:stone_bricks"),
    floor: () => (Math.random() < 0.25 ? "minecraft:mossy_cobblestone" : "minecraft:cobblestone"),
  },
  {
    name: "Glass Maze",
    wall: () => "minecraft:light_blue_stained_glass",
    floor: () => "minecraft:quartz_block",
  },
  {
    name: "Rainbow Maze",
    wall: (u, v) => RAINBOW_WOOL[Math.floor((u + v) / 3) % RAINBOW_WOOL.length],
    floor: () => "minecraft:white_concrete",
  },
];

const TRAIL_BLOCK = "minecraft:glowstone";

// Blocks that probably belong to something she built. If any are in the way,
// the wand refuses rather than bulldozing her house.
const PROTECTED = [
  "chest", "barrel", "bed", "door", "crafting_table", "furnace", "planks",
  "glass", "wool", "bricks", "concrete", "carpet", "sign", "shulker",
  "torch", "lantern", "bookshelf", "fence", "stairs", "slab", "quartz",
  "glowstone", "gold_block",
];

const PRIZES = [
  ["minecraft:diamond", 3],
  ["minecraft:emerald", 6],
  ["minecraft:cake", 1],
  ["minecraft:golden_apple", 2],
  ["minecraft:cookie", 16],
  ["minecraft:firework_rocket", 8],
  ["minecraft:name_tag", 1],
  ["rainbow:rainbow_sword", 1], // only works if the Rainbow Sword add-on is on
];

const busy = new Set();
const mazesByChest = new Map();  // "x,y,z" of chest -> maze
const mazesByPlayer = new Map(); // player id -> their latest maze

// ---------- Give the wand on first join (no cheats needed) ----------
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      if (player.getDynamicProperty("maze:got_wand")) return;
      const inv = player.getComponent("minecraft:inventory").container;
      const leftover = inv.addItem(new ItemStack(WAND_ID, 1));
      if (leftover) player.dimension.spawnItem(leftover, player.location);
      player.setDynamicProperty("maze:got_wand", true);
      player.sendMessage("§aYou found a Maze Wand! §fHold the use button in an open field to make a maze.");
    } catch {}
  }, 60);
});

// ---------- Using the wand ----------
world.afterEvents.itemUse.subscribe(({ source: player, itemStack }) => {
  if (itemStack?.typeId !== WAND_ID) return;
  if (player?.typeId !== "minecraft:player") return;
  if (busy.has(player.id)) {
    player.sendMessage("§eHang on, your maze is still being built!");
    return;
  }

  // Inside one of your mazes? Then the wand gives a hint instead.
  const maze = mazesByPlayer.get(player.id);
  if (maze && !maze.finished && isInside(maze, player)) {
    giveHint(player, maze);
    return;
  }

  askAndBuild(player);
});

async function askAndBuild(player) {
  busy.add(player.id);
  try {
    const levelForm = new ActionFormData()
      .title("Maze Wand")
      .body("Pick a level!");
    LEVELS.forEach((l) => levelForm.button(l.button));
    const levelPick = await levelForm.show(player);
    if (levelPick.canceled || levelPick.selection === undefined) return;

    const themeForm = new ActionFormData()
      .title("Maze Wand")
      .body("Pick a style!");
    THEMES.forEach((t) => themeForm.button(t.name));
    const themePick = await themeForm.show(player);
    if (themePick.canceled || themePick.selection === undefined) return;

    await buildMaze(player, LEVELS[levelPick.selection], THEMES[themePick.selection]);
  } catch {
    // Menu closed or something went wrong; just let them try again.
  } finally {
    busy.delete(player.id);
  }
}

// ---------- Maze generation ----------
function generateMaze(cells) {
  const W = cells * 2 + 1;
  const grid = Array.from({ length: W }, () => new Array(W).fill(true)); // true = wall
  const startCell = { cx: Math.floor(cells / 2), cy: 0 };

  // Recursive backtracker, done with a stack. Every spot is reachable,
  // and there's exactly one route between any two spots.
  const visited = Array.from({ length: cells }, () => new Array(cells).fill(false));
  const stack = [startCell];
  visited[startCell.cy][startCell.cx] = true;
  grid[1][startCell.cx * 2 + 1] = false;

  while (stack.length) {
    const { cx, cy } = stack[stack.length - 1];
    const options = [
      [0, -1], [0, 1], [-1, 0], [1, 0],
    ].filter(([dx, dy]) => {
      const nx = cx + dx, ny = cy + dy;
      return nx >= 0 && ny >= 0 && nx < cells && ny < cells && !visited[ny][nx];
    });
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [dx, dy] = options[Math.floor(Math.random() * options.length)];
    const nx = cx + dx, ny = cy + dy;
    visited[ny][nx] = true;
    grid[cy * 2 + 1 + dy][cx * 2 + 1 + dx] = false; // knock down the wall between
    grid[ny * 2 + 1][nx * 2 + 1] = false;
    stack.push({ cx: nx, cy: ny });
  }

  // Entrance in the middle of the side facing the player.
  const entrance = { u: startCell.cx * 2 + 1, v: 0 };
  grid[entrance.v][entrance.u] = false;

  // Exit on the far side, at whichever spot makes the longest walk.
  const dist = distancesFrom(grid, W, entrance);
  let exitU = 1;
  for (let u = 1; u < W; u += 2) {
    if (dist[W - 2][u] > dist[W - 2][exitU]) exitU = u;
  }
  const exit = { u: exitU, v: W - 1 };
  grid[exit.v][exit.u] = false;

  const solution = pathBetween(grid, W, entrance, exit);
  return { W, grid, entrance, exit, solution };
}

function distancesFrom(grid, W, from) {
  const dist = Array.from({ length: W }, () => new Array(W).fill(-1));
  const queue = [[from.u, from.v]];
  dist[from.v][from.u] = 0;
  for (let i = 0; i < queue.length; i++) {
    const [u, v] = queue[i];
    for (const [du, dv] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nu = u + du, nv = v + dv;
      if (nu < 0 || nv < 0 || nu >= W || nv >= W) continue;
      if (grid[nv][nu] || dist[nv][nu] !== -1) continue;
      dist[nv][nu] = dist[v][u] + 1;
      queue.push([nu, nv]);
    }
  }
  return dist;
}

// Walks backwards from `to` using distances from `from`. Returns tiles from `from` to `to`.
function pathBetween(grid, W, from, to) {
  const dist = distancesFrom(grid, W, from);
  if (dist[to.v][to.u] < 0) return [];
  const path = [{ u: to.u, v: to.v }];
  let cur = { u: to.u, v: to.v };
  while (dist[cur.v][cur.u] > 0) {
    for (const [du, dv] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nu = cur.u + du, nv = cur.v + dv;
      if (nu < 0 || nv < 0 || nu >= W || nv >= W) continue;
      if (dist[nv][nu] === dist[cur.v][cur.u] - 1) {
        cur = { u: nu, v: nv };
        path.push(cur);
        break;
      }
    }
  }
  return path.reverse();
}

// ---------- Building it in the world ----------
function buildMaze(player, level, theme) {
  return new Promise((resolve) => {
    const dim = player.dimension;
    const view = player.getViewDirection();
    const f = Math.abs(view.x) > Math.abs(view.z)
      ? { x: Math.sign(view.x), z: 0 }
      : { x: 0, z: Math.sign(view.z) || 1 };
    const r = { x: -f.z, z: f.x };
    const base = {
      x: Math.floor(player.location.x),
      y: Math.floor(player.location.y),
      z: Math.floor(player.location.z),
    };

    const { W, grid, entrance, exit, solution } = generateMaze(level.cells);
    const half = Math.floor(level.cells / 2) * 2 + 1; // entrance lines up with the player
    const maze = {
      dimId: dim.id, base, f, r, half, W, grid, entrance, exit,
      hintsLeft: level.hints, levelName: level.name, finished: false,
    };
    const at = (u, v, dy) => toWorld(maze, u, v, dy);

    const place = (loc, block) => {
      try {
        const b = dim.getBlock(loc);
        if (!b) return;
        if (typeof block === "string") b.setType(block);
        else b.setPermutation(block);
      } catch {}
    };

    // The treasure platform sits just outside the exit: 3 wide, 2 deep.
    const chestTile = { u: exit.u + 1, v: W };
    const platform = [];
    for (let du = -1; du <= 1; du++) {
      for (let dv = 0; dv <= 1; dv++) platform.push({ u: exit.u + du, v: W + dv });
    }

    function* job() {
      // 1. Safety check: don't wreck anything she built.
      const footprint = [];
      for (let v = 0; v < W; v++) for (let u = 0; u < W; u++) footprint.push({ u, v });
      footprint.push(...platform);
      for (let i = 0; i < footprint.length; i++) {
        const { u, v } = footprint[i];
        for (let dy = -1; dy < CLEAR_HEIGHT; dy++) {
          let id;
          try {
            id = dim.getBlock(at(u, v, dy))?.typeId ?? "unloaded";
          } catch {
            id = "unloaded";
          }
          if (id === "unloaded") {
            player.sendMessage("§cThat area is too far away to build in. Try an easier level or move closer.");
            resolve();
            return;
          }
          if (PROTECTED.some((word) => id.includes(word))) {
            player.sendMessage("§cWhoa! The maze would knock down something you built. Try an open space.");
            resolve();
            return;
          }
        }
        if (i % W === 0) yield;
      }

      player.sendMessage(`§aBuilding a ${level.name} ${theme.name}...`);
      playSound("block.bell.hit", at(entrance.u, 0, 1), 1);

      // 2. Clear the space and lay the floor, row by row away from the player.
      for (let v = 0; v < W; v++) {
        for (let u = 0; u < W; u++) {
          place(at(u, v, -1), theme.floor(u, v));
          for (let dy = 0; dy < CLEAR_HEIGHT; dy++) place(at(u, v, dy), "minecraft:air");
        }
        yield;
      }
      for (const t of platform) {
        place(at(t.u, t.v, -1), theme.floor(t.u, t.v));
        for (let dy = 0; dy < CLEAR_HEIGHT; dy++) place(at(t.u, t.v, dy), "minecraft:air");
      }

      // 3. Raise the walls one layer at a time.
      for (let dy = 0; dy < WALL_HEIGHT; dy++) {
        for (let v = 0; v < W; v++) {
          for (let u = 0; u < W; u++) {
            if (grid[v][u]) place(at(u, v, dy), theme.wall(u, v));
          }
          yield;
        }
        playSound("dig.stone", at(entrance.u, 0, 1), 0.8 + dy * 0.2);
      }

      // 4. Glowing trail for the easier levels.
      if (level.trail !== "none") {
        solution.forEach((t, i) => {
          if (level.trail === "full" || i % 3 === 0 || i === solution.length - 1) {
            place(at(t.u, t.v, -1), TRAIL_BLOCK);
          }
        });
        yield;
      }

      // 5. Lanterns on some wall corners so it's not pitch black at night.
      for (let v = 0; v < W; v += 2) {
        for (let u = 0; u < W; u += 2) {
          if (grid[v][u] && Math.random() < 0.45) place(at(u, v, WALL_HEIGHT), "minecraft:lantern");
        }
        yield;
      }

      // 6. The treasure, waiting just outside the exit.
      const chestLoc = at(chestTile.u, chestTile.v, 0);
      place(at(chestTile.u, chestTile.v, -1), "minecraft:gold_block");
      place(chestLoc, "minecraft:chest");
      fillChest(dim, chestLoc);
      place(at(exit.u - 1, W, 0), "minecraft:lantern");

      maze.start = system.currentTick;
      maze.chestKey = key(chestLoc);
      mazesByChest.set(maze.chestKey, maze);
      mazesByPlayer.set(player.id, maze);

      showTitle(player, "§6GO!", level.intro);
      const hintText = level.hints === Infinity ? "Lost? Use the wand inside the maze for a hint!"
        : level.hints > 0 ? `Lost? Use the wand inside the maze for a hint (${level.hints} left).`
        : "";
      player.sendMessage(`§6GO! §f${level.intro} The treasure waits at the exit. ${hintText}`);
      playSound("random.levelup", at(entrance.u, 0, 1), 1);
      resolve();
    }

    system.runJob(job());
  });
}

// ---------- Hints ----------
function giveHint(player, maze) {
  if (maze.hintsLeft <= 0) {
    player.sendMessage("§cNo hints left on this level. You can do it!");
    playSound("note.bass", player.location, 0.8);
    return;
  }
  const here = toMaze(maze, player.location);
  const path = pathBetween(maze.grid, maze.W, here, maze.exit);
  if (path.length < 2) {
    player.sendMessage("§eYou're right at the exit! The treasure is just outside.");
    return;
  }
  if (maze.hintsLeft !== Infinity) maze.hintsLeft--;

  const dim = world.getDimension(maze.dimId);
  const steps = path.slice(1, HINT_STEPS + 1);
  steps.forEach((t, i) => {
    system.runTimeout(() => {
      const loc = toWorld(maze, t.u, t.v, 0);
      const center = { x: loc.x + 0.5, y: loc.y + 0.3, z: loc.z + 0.5 };
      for (let k = 0; k < 4; k++) {
        try {
          dim.spawnParticle("minecraft:villager_happy", {
            x: center.x + (Math.random() - 0.5) * 0.5,
            y: center.y + Math.random() * 0.8,
            z: center.z + (Math.random() - 0.5) * 0.5,
          });
        } catch {}
      }
    }, i * 2);
  });
  playSound("note.chime", player.location, 1.5);

  const left = maze.hintsLeft === Infinity ? "" : ` §7(${maze.hintsLeft} hint${maze.hintsLeft === 1 ? "" : "s"} left)`;
  player.sendMessage(`§aFollow the green sparkles!${left}`);
}

// ---------- Winning ----------
world.afterEvents.playerInteractWithBlock.subscribe(({ player, block }) => {
  const k = key(block.location);
  const maze = mazesByChest.get(k);
  if (!maze || maze.finished) return;
  maze.finished = true;
  mazesByChest.delete(k);

  const seconds = Math.max(1, Math.round((system.currentTick - maze.start) / 20));
  const prop = `maze:best_${maze.levelName}`;
  let best;
  try {
    best = player.getDynamicProperty(prop);
  } catch {}

  let msg = `§6You beat the ${maze.levelName} maze in ${formatTime(seconds)}!`;
  let subtitle = `Time: ${formatTime(seconds)}`;
  if (typeof best !== "number" || seconds < best) {
    try {
      player.setDynamicProperty(prop, seconds);
    } catch {}
    if (typeof best === "number") {
      msg += " §aNEW BEST TIME!";
      subtitle += "  NEW BEST!";
    }
  } else {
    msg += ` §7(Best: ${formatTime(best)})`;
  }
  player.sendMessage(msg);
  showTitle(player, "§6You did it!", subtitle);
  celebrate(block.dimension, block.location);
});

function celebrate(dim, loc) {
  const center = { x: loc.x + 0.5, y: loc.y + 1.5, z: loc.z + 0.5 };
  playSound("random.levelup", center, 1.2);
  for (let i = 0; i < 5; i++) {
    system.runTimeout(() => {
      try {
        dim.spawnParticle("minecraft:totem_particle", {
          x: center.x + (Math.random() - 0.5) * 2,
          y: center.y + Math.random() * 1.5,
          z: center.z + (Math.random() - 0.5) * 2,
        });
      } catch {}
      try {
        dim.spawnEntity("minecraft:fireworks_rocket", {
          x: center.x + (Math.random() - 0.5) * 3,
          y: center.y,
          z: center.z + (Math.random() - 0.5) * 3,
        });
      } catch {}
      playSound("firework.twinkle", center, 1);
    }, i * 6);
  }
}

// ---------- Helpers ----------
// Maze grid (u across, v away from where the player stood) <-> world blocks.
function toWorld(maze, u, v, dy) {
  const { base, r, f, half } = maze;
  return {
    x: base.x + r.x * (u - half) + f.x * (v + GAP),
    y: base.y + dy,
    z: base.z + r.z * (u - half) + f.z * (v + GAP),
  };
}

function toMaze(maze, loc) {
  const { base, r, f, half } = maze;
  const dx = Math.floor(loc.x) - base.x;
  const dz = Math.floor(loc.z) - base.z;
  return { u: dx * r.x + dz * r.z + half, v: dx * f.x + dz * f.z - GAP };
}

function isInside(maze, player) {
  if (player.dimension.id !== maze.dimId) return false;
  const { u, v } = toMaze(maze, player.location);
  const dy = Math.floor(player.location.y) - maze.base.y;
  if (u < 0 || v < 0 || u >= maze.W || v >= maze.W) return false;
  if (dy < -1 || dy > WALL_HEIGHT) return false;
  return !maze.grid[v][u];
}

function fillChest(dim, loc) {
  try {
    const container = dim.getBlock(loc)?.getComponent("minecraft:inventory")?.container;
    if (!container) return;
    const pool = [...PRIZES].sort(() => Math.random() - 0.5);
    let added = 0;
    for (const [id, count] of pool) {
      if (added >= 3) break;
      try {
        container.addItem(new ItemStack(id, count));
        added++;
      } catch {
        // Item doesn't exist in this world (e.g. Rainbow Sword add-on is off).
      }
    }
  } catch {}
}

function showTitle(player, title, subtitle) {
  try {
    player.onScreenDisplay.setTitle(title, {
      subtitle, fadeInDuration: 5, stayDuration: 50, fadeOutDuration: 15,
    });
  } catch {}
}

function key(loc) {
  return `${Math.floor(loc.x)},${Math.floor(loc.y)},${Math.floor(loc.z)}`;
}

function formatTime(total) {
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function playSound(id, location, pitch) {
  try {
    world.playSound(id, location, { pitch, volume: 1 });
  } catch {}
}
