// House Blueprint: use it and a brand-new house builds itself in front of you.
// Random style, random floor plan, 1 to 4 floors, rooms with furniture,
// lights, a front door, and staircases between floors.
import { world, system, ItemStack, BlockPermutation } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const ITEM_ID = "house:blueprint";
const GAP = 3; // blocks between the player and the front wall

// =====================================================================
// Styles. Each block slot lists choices; the first one that exists in
// this version of Minecraft is used.
// =====================================================================
const STYLES = [
  {
    name: "Cozy Cottage",
    bedColors: ["red", "white", "green"],
    wall: ["minecraft:oak_planks"],
    corner: ["minecraft:oak_log"],
    iwall: ["minecraft:spruce_planks"],
    floor: ["minecraft:spruce_planks"],
    ceiling: ["minecraft:oak_planks"],
    foundation: ["minecraft:cobblestone"],
    roofType: "gable",
    roof: ["minecraft:dark_oak_planks"],
    roofSlab: ["minecraft:dark_oak_slab"],
    gable: ["minecraft:oak_planks"],
    window: ["minecraft:glass_pane"],
    door: ["minecraft:spruce_door"],
    carpets: ["red", "white"],
    tallWindows: false,
    windowEvery: 2,
  },
  {
    name: "Stone Cottage",
    bedColors: ["green", "brown", "light_gray"],
    stairs: ["minecraft:oak_stairs"],
    wall: ["minecraft:cobblestone"],
    corner: ["minecraft:stripped_spruce_log", "minecraft:spruce_log"],
    iwall: ["minecraft:spruce_planks"],
    floor: ["minecraft:oak_planks"],
    ceiling: ["minecraft:spruce_planks"],
    foundation: ["minecraft:stone_bricks", "minecraft:cobblestone"],
    roofType: "gable",
    roof: ["minecraft:spruce_planks"],
    roofSlab: ["minecraft:spruce_slab"],
    gable: ["minecraft:spruce_planks"],
    window: ["minecraft:glass_pane"],
    door: ["minecraft:oak_door", "minecraft:wooden_door"],
    carpets: ["green", "brown"],
    tallWindows: false,
    windowEvery: 3,
  },
  {
    name: "Modern House",
    bedColors: ["white", "light_gray", "gray", "black"],
    wall: ["minecraft:white_concrete"],
    corner: ["minecraft:light_gray_concrete"],
    iwall: ["minecraft:white_concrete"],
    floor: ["minecraft:birch_planks"],
    ceiling: ["minecraft:white_concrete"],
    foundation: ["minecraft:smooth_stone", "minecraft:stone"],
    roofType: "flat",
    roof: ["minecraft:light_gray_concrete"],
    parapet: ["minecraft:white_concrete"],
    window: ["minecraft:glass"],
    door: ["minecraft:birch_door"],
    carpets: ["light_gray", "light_blue"],
    tallWindows: true,
    windowEvery: 1,
  },
  {
    name: "Cherry Blossom House",
    bedColors: ["pink", "magenta", "white"],
    wall: ["minecraft:birch_planks"],
    corner: ["minecraft:stripped_cherry_log", "minecraft:cherry_log", "minecraft:birch_log"],
    iwall: ["minecraft:cherry_planks", "minecraft:birch_planks"],
    floor: ["minecraft:bamboo_planks", "minecraft:birch_planks"],
    ceiling: ["minecraft:cherry_planks", "minecraft:birch_planks"],
    foundation: ["minecraft:stone_bricks", "minecraft:cobblestone"],
    roofType: "gable",
    roof: ["minecraft:cherry_planks", "minecraft:pink_concrete"],
    roofSlab: ["minecraft:cherry_slab"],
    gable: ["minecraft:cherry_planks", "minecraft:birch_planks"],
    window: ["minecraft:pink_stained_glass_pane", "minecraft:glass_pane"],
    door: ["minecraft:cherry_door", "minecraft:birch_door"],
    carpets: ["pink", "magenta"],
    tallWindows: false,
    windowEvery: 2,
  },
  {
    name: "Candy House",
    bedColors: ["pink", "lime", "light_blue", "yellow"],
    stairs: ["minecraft:quartz_stairs"],
    wall: ["minecraft:white_concrete"],
    corner: ["minecraft:pink_concrete"],
    iwall: ["minecraft:light_blue_concrete"],
    floor: ["minecraft:pink_wool"],
    ceiling: ["minecraft:white_concrete"],
    foundation: ["minecraft:magenta_concrete"],
    roofType: "gable",
    roof: ["minecraft:red_concrete"],
    roofStripes: [["minecraft:red_concrete"], ["minecraft:white_concrete"]],
    gable: ["minecraft:pink_concrete"],
    window: ["minecraft:light_blue_stained_glass_pane", "minecraft:glass_pane"],
    door: ["minecraft:cherry_door", "minecraft:birch_door"],
    carpets: ["lime", "yellow", "light_blue", "orange"],
    tallWindows: false,
    windowEvery: 2,
  },
  {
    name: "Desert House",
    bedColors: ["orange", "yellow", "brown"],
    stairs: ["minecraft:smooth_sandstone_stairs", "minecraft:sandstone_stairs"],
    wall: ["minecraft:smooth_sandstone", "minecraft:sandstone"],
    corner: ["minecraft:cut_sandstone", "minecraft:sandstone"],
    iwall: ["minecraft:sandstone"],
    floor: ["minecraft:orange_terracotta"],
    ceiling: ["minecraft:sandstone"],
    foundation: ["minecraft:sandstone"],
    roofType: "flat",
    roof: ["minecraft:smooth_sandstone", "minecraft:sandstone"],
    parapet: ["minecraft:cut_sandstone", "minecraft:sandstone"],
    window: ["minecraft:glass_pane"],
    door: ["minecraft:acacia_door", "minecraft:wooden_door"],
    carpets: ["orange", "yellow"],
    tallWindows: false,
    windowEvery: 2,
  },
  {
    // Fire colors in the style of PrestonPlayz's builds: a flame-colored roof
    // (red at the edges, orange, then yellow at the top), glowing magma corners,
    // and lava cauldrons inside.
    name: "Preston-Style Fire House",
    bedColors: ["red", "orange", "black"],
    stairs: ["minecraft:polished_blackstone_stairs", "minecraft:blackstone_stairs", "minecraft:nether_brick_stairs"],
    wall: ["minecraft:red_nether_brick", "minecraft:red_concrete"],
    corner: ["minecraft:magma", "minecraft:orange_concrete"],
    iwall: ["minecraft:nether_brick", "minecraft:red_concrete"],
    floor: ["minecraft:polished_blackstone", "minecraft:black_concrete"],
    ceiling: ["minecraft:nether_brick", "minecraft:red_concrete"],
    foundation: ["minecraft:blackstone", "minecraft:cobblestone"],
    roofType: "gable",
    roof: ["minecraft:red_concrete"],
    roofLayers: [["minecraft:red_concrete"], ["minecraft:orange_concrete"], ["minecraft:yellow_concrete"]],
    gable: ["minecraft:red_nether_brick", "minecraft:red_concrete"],
    window: ["minecraft:orange_stained_glass_pane", "minecraft:glass_pane"],
    door: ["minecraft:crimson_door", "minecraft:dark_oak_door"],
    carpets: ["red", "orange", "black"],
    extras: ["lava_cauldron", "lava_cauldron"],
    tallWindows: false,
    windowEvery: 2,
  },
  {
    name: "Ice Palace",
    bedColors: ["white", "light_blue", "cyan"],
    stairs: ["minecraft:quartz_stairs", "minecraft:birch_stairs"],
    wall: ["minecraft:packed_ice"],
    corner: ["minecraft:blue_ice", "minecraft:packed_ice"],
    iwall: ["minecraft:packed_ice"],
    floor: ["minecraft:snow", "minecraft:white_concrete"],
    ceiling: ["minecraft:packed_ice"],
    foundation: ["minecraft:packed_ice"],
    roofType: "gable",
    roof: ["minecraft:snow", "minecraft:white_concrete"],
    roofStripes: [["minecraft:snow", "minecraft:white_concrete"], ["minecraft:blue_ice", "minecraft:packed_ice"]],
    gable: ["minecraft:packed_ice"],
    window: ["minecraft:light_blue_stained_glass_pane", "minecraft:glass_pane"],
    door: ["minecraft:birch_door"],
    lantern: ["minecraft:soul_lantern", "minecraft:lantern"],
    carpets: ["white", "light_blue"],
    tallWindows: true,
    windowEvery: 2,
  },
  {
    name: "Ocean House",
    bedColors: ["cyan", "light_blue", "blue"],
    stairs: ["minecraft:prismarine_bricks_stairs", "minecraft:prismarine_stairs"],
    wall: ["minecraft:prismarine_bricks", "minecraft:prismarine"],
    corner: ["minecraft:dark_prismarine", "minecraft:prismarine"],
    iwall: ["minecraft:prismarine"],
    floor: ["minecraft:prismarine_bricks", "minecraft:prismarine"],
    ceiling: ["minecraft:prismarine"],
    foundation: ["minecraft:prismarine", "minecraft:cobblestone"],
    roofType: "gable",
    roof: ["minecraft:dark_prismarine", "minecraft:prismarine"],
    roofStripes: [["minecraft:dark_prismarine", "minecraft:prismarine"], ["minecraft:prismarine_bricks", "minecraft:prismarine"]],
    gable: ["minecraft:prismarine_bricks", "minecraft:prismarine"],
    window: ["minecraft:cyan_stained_glass_pane", "minecraft:glass_pane"],
    door: ["minecraft:warped_door", "minecraft:birch_door"],
    lantern: ["minecraft:soul_lantern", "minecraft:lantern"],
    carpets: ["cyan", "light_blue"],
    tallWindows: true,
    windowEvery: 2,
  },
  {
    name: "Mushroom House",
    bedColors: ["red", "white", "brown"],
    stairs: ["minecraft:oak_stairs"],
    wall: ["minecraft:mushroom_stem", "minecraft:white_concrete"],
    corner: ["minecraft:brown_mushroom_block", "minecraft:brown_concrete"],
    iwall: ["minecraft:oak_planks"],
    floor: ["minecraft:moss_block", "minecraft:grass_block"],
    ceiling: ["minecraft:brown_mushroom_block", "minecraft:brown_concrete"],
    foundation: ["minecraft:mossy_cobblestone", "minecraft:cobblestone"],
    roofType: "gable",
    roof: ["minecraft:red_mushroom_block", "minecraft:red_concrete"],
    roofSpots: { chance: 0.15, block: ["minecraft:white_concrete"] },
    gable: ["minecraft:mushroom_stem", "minecraft:white_concrete"],
    window: ["minecraft:glass_pane"],
    door: ["minecraft:oak_door", "minecraft:wooden_door"],
    carpets: ["red", "white", "lime"],
    tallWindows: false,
    windowEvery: 3,
  },
  {
    // Horizontal logs, a campfire "fireplace", never taller than 2 floors.
    name: "Log Cabin",
    bedColors: ["red", "brown", "green"],
    wall: ["minecraft:spruce_log"],
    logWalls: true,
    corner: ["minecraft:stripped_spruce_log", "minecraft:spruce_log"],
    iwall: ["minecraft:spruce_planks"],
    floor: ["minecraft:spruce_planks"],
    ceiling: ["minecraft:spruce_planks"],
    foundation: ["minecraft:cobblestone"],
    roofType: "gable",
    roof: ["minecraft:dark_oak_planks"],
    roofSlab: ["minecraft:dark_oak_slab"],
    gable: ["minecraft:spruce_log"],
    window: ["minecraft:glass_pane"],
    door: ["minecraft:spruce_door"],
    carpets: ["brown", "green", "red"],
    extras: ["campfire"],
    maxStories: 2,
    tallWindows: false,
    windowEvery: 3,
  },
  {
    // Earthy wood with a stone base along the bottom of the walls and a slate roof.
    name: "Craftsman",
    bedColors: ["green", "brown", "orange"],
    wall: ["minecraft:spruce_planks"],
    baseCourse: ["minecraft:stone_bricks", "minecraft:cobblestone"],
    corner: ["minecraft:stripped_dark_oak_log", "minecraft:dark_oak_log"],
    iwall: ["minecraft:oak_planks"],
    floor: ["minecraft:dark_oak_planks"],
    ceiling: ["minecraft:oak_planks"],
    foundation: ["minecraft:stone_bricks", "minecraft:cobblestone"],
    roofType: "gable",
    roof: ["minecraft:deepslate_tiles", "minecraft:stone_bricks"],
    roofSlab: ["minecraft:deepslate_tile_slab", "minecraft:stone_brick_slab"],
    gable: ["minecraft:oak_planks"],
    window: ["minecraft:glass_pane"],
    door: ["minecraft:dark_oak_door"],
    carpets: ["green", "brown"],
    maxStories: 2,
    tallWindows: false,
    windowEvery: 2,
  },
  {
    // Tall and colorful with white trim, tall windows, and a steep slate roof.
    name: "Victorian",
    bedColors: ["purple", "magenta", "red"],
    wall: ["minecraft:purple_terracotta"],
    corner: ["minecraft:white_concrete"],
    iwall: ["minecraft:dark_oak_planks"],
    floor: ["minecraft:dark_oak_planks"],
    ceiling: ["minecraft:white_concrete"],
    foundation: ["minecraft:stone_bricks", "minecraft:cobblestone"],
    roofType: "gable",
    roof: ["minecraft:deepslate_tiles", "minecraft:gray_concrete"],
    gable: ["minecraft:pink_terracotta"],
    window: ["minecraft:glass_pane"],
    door: ["minecraft:dark_oak_door"],
    carpets: ["red", "purple"],
    minStories: 2,
    tallWindows: true,
    windowEvery: 2,
  },
  {
    // Every row of the walls is a different color, and the roof goes red to purple.
    name: "Havana's Rainbow House",
    bedColors: ["red", "orange", "yellow", "lime", "light_blue", "blue", "purple", "pink"],
    wall: ["minecraft:white_concrete"],
    wallBands: [
      ["minecraft:red_concrete"], ["minecraft:orange_concrete"], ["minecraft:yellow_concrete"],
      ["minecraft:lime_concrete"], ["minecraft:light_blue_concrete"], ["minecraft:blue_concrete"],
      ["minecraft:purple_concrete"],
    ],
    corner: ["minecraft:white_concrete"],
    iwall: ["minecraft:white_concrete"],
    floor: ["minecraft:white_wool"],
    ceiling: ["minecraft:white_concrete"],
    foundation: ["minecraft:white_concrete"],
    roofType: "gable",
    roof: ["minecraft:red_concrete"],
    roofLayers: [
      ["minecraft:red_concrete"], ["minecraft:orange_concrete"], ["minecraft:yellow_concrete"],
      ["minecraft:lime_concrete"], ["minecraft:light_blue_concrete"], ["minecraft:blue_concrete"],
      ["minecraft:purple_concrete"],
    ],
    gable: ["minecraft:white_concrete"],
    stairs: ["minecraft:quartz_stairs", "minecraft:birch_stairs"],
    window: ["minecraft:glass_pane"],
    door: ["minecraft:cherry_door", "minecraft:birch_door"],
    carpets: ["red", "orange", "yellow", "lime", "light_blue", "purple"],
    tallWindows: false,
    windowEvery: 2,
  },
  {
    // Pink and purple with a sparkly amethyst roof.
    name: "Brianna-Style Sparkle House",
    bedColors: ["pink", "magenta", "purple"],
    wall: ["minecraft:pink_concrete"],
    corner: ["minecraft:purple_concrete"],
    iwall: ["minecraft:white_concrete"],
    floor: ["minecraft:purpur_block", "minecraft:white_concrete"],
    ceiling: ["minecraft:white_concrete"],
    foundation: ["minecraft:purpur_block", "minecraft:stone_bricks"],
    roofType: "gable",
    roof: ["minecraft:amethyst_block", "minecraft:purple_concrete"],
    roofSpots: { chance: 0.2, block: ["minecraft:magenta_concrete"] },
    gable: ["minecraft:magenta_concrete"],
    stairs: ["minecraft:purpur_stairs", "minecraft:cherry_stairs"],
    window: ["minecraft:magenta_stained_glass_pane", "minecraft:glass_pane"],
    door: ["minecraft:cherry_door", "minecraft:birch_door"],
    carpets: ["pink", "magenta", "purple"],
    extras: ["amethyst_cluster", "amethyst_cluster"],
    tallWindows: true,
    windowEvery: 2,
  },
  {
    // A shell roof (brown rim, green shell, lime spots) on a sandy beach house.
    name: "Turtle House",
    bedColors: ["lime", "green", "cyan"],
    wall: ["minecraft:green_terracotta"],
    corner: ["minecraft:lime_terracotta", "minecraft:lime_concrete"],
    iwall: ["minecraft:birch_planks"],
    floor: ["minecraft:smooth_sandstone", "minecraft:sandstone"],
    ceiling: ["minecraft:birch_planks"],
    foundation: ["minecraft:sandstone"],
    roofType: "gable",
    roof: ["minecraft:green_concrete"],
    roofLayers: [["minecraft:brown_concrete"], ["minecraft:green_concrete"], ["minecraft:green_concrete"]],
    roofSpots: { chance: 0.25, block: ["minecraft:lime_concrete"] },
    gable: ["minecraft:green_terracotta"],
    stairs: ["minecraft:smooth_sandstone_stairs", "minecraft:sandstone_stairs"],
    window: ["minecraft:cyan_stained_glass_pane", "minecraft:glass_pane"],
    door: ["minecraft:jungle_door", "minecraft:birch_door"],
    carpets: ["lime", "green", "cyan"],
    gifts: [["minecraft:turtle_helmet", 1]],
    tallWindows: false,
    windowEvery: 2,
  },
  {
    name: "Golden Mansion",
    bedColors: ["yellow", "red", "white"],
    stairs: ["minecraft:smooth_quartz_stairs", "minecraft:quartz_stairs"],
    wall: ["minecraft:quartz_block"],
    corner: ["minecraft:gold_block"],
    iwall: ["minecraft:quartz_block"],
    floor: ["minecraft:smooth_quartz", "minecraft:quartz_block"],
    ceiling: ["minecraft:quartz_block"],
    foundation: ["minecraft:quartz_block", "minecraft:stone_bricks"],
    roofType: "gable",
    roof: ["minecraft:gold_block"],
    gable: ["minecraft:quartz_block"],
    window: ["minecraft:yellow_stained_glass_pane", "minecraft:glass_pane"],
    door: ["minecraft:dark_oak_door"],
    carpets: ["red", "yellow"],
    tallWindows: true,
    windowEvery: 2,
  },

  // ---- Town buildings (in the "Town buildings" menu). Keep them at the end: builds in progress
  // remember their style by its place in this list. ----
  // town: true      not a house: no bedroom needed, no gift chest, "Town buildings" menu
  // sign            the name on the sign over the front door
  // rooms           what the rooms are for: the room behind the front door, then the rest downstairs, then upstairs
  // width / depth   footprint ranges (houses are 11-15 by 10-13); wingChance; noDeck (no rooftop deck)
  // garage          a 4-wide opening in the front wall (fire station)
  {
    // Red brick with white trim, tall windows, rows of bookshelves and reading tables.
    name: "Library",
    town: true,
    sign: "Library",
    rooms: { front: "reading", ground: ["stacks", "kids", "stacks"], upper: ["stacks", "reading", "stacks"] },
    width: [15, 18], depth: [12, 14], wingChance: 0.3, noDeck: true, maxStories: 2,
    bedColors: ["red"],
    stairs: ["minecraft:dark_oak_stairs"],
    wall: ["minecraft:bricks"],
    corner: ["minecraft:quartz_pillar", "minecraft:quartz_block"],
    iwall: ["minecraft:dark_oak_planks"],
    floor: ["minecraft:dark_oak_planks"],
    ceiling: ["minecraft:spruce_planks"],
    foundation: ["minecraft:stone_bricks", "minecraft:cobblestone"],
    roofType: "gable",
    roof: ["minecraft:deepslate_tiles", "minecraft:stone_bricks"],
    roofSlab: ["minecraft:deepslate_tile_slab", "minecraft:stone_brick_slab"],
    gable: ["minecraft:bricks"],
    window: ["minecraft:glass_pane"],
    door: ["minecraft:dark_oak_door"],
    carpets: ["red", "green"],
    tallWindows: true,
    windowEvery: 2,
  },
  {
    // Bright and white with a green stripe along the bottom, big shop windows, and aisles of food.
    name: "Grocery Store",
    town: true,
    sign: "Grocery Store",
    rooms: { front: "store", ground: ["storeroom", "store", "storeroom"], upper: ["storeroom"] },
    width: [16, 19], depth: [12, 15], wingChance: 0.25, noDeck: true, maxStories: 1,
    bedColors: ["lime"],
    wall: ["minecraft:white_concrete"],
    baseCourse: ["minecraft:lime_concrete"],
    corner: ["minecraft:green_concrete"],
    iwall: ["minecraft:white_concrete"],
    floor: ["minecraft:smooth_stone", "minecraft:stone"],
    ceiling: ["minecraft:white_concrete"],
    foundation: ["minecraft:stone_bricks", "minecraft:cobblestone"],
    roofType: "flat",
    roof: ["minecraft:light_gray_concrete"],
    parapet: ["minecraft:green_concrete"],
    window: ["minecraft:glass"],
    door: ["minecraft:birch_door"],
    carpets: ["lime", "white"],
    tallWindows: true,
    windowEvery: 1,
  },
  {
    // Stone and quartz with columns, a big meeting hall with rows of seats facing a lectern, and offices.
    name: "Town Hall",
    town: true,
    sign: "Town Hall",
    rooms: { front: "hall", ground: ["office", "hall", "office"], upper: ["office", "hall", "office"] },
    width: [17, 20], depth: [12, 15], wingChance: 0.3, noDeck: true, maxStories: 2,
    bedColors: ["blue"],
    stairs: ["minecraft:dark_oak_stairs"],
    wall: ["minecraft:stone_bricks"],
    corner: ["minecraft:quartz_pillar", "minecraft:quartz_block"],
    iwall: ["minecraft:quartz_block"],
    floor: ["minecraft:polished_andesite", "minecraft:stone"],
    ceiling: ["minecraft:quartz_block"],
    foundation: ["minecraft:stone_bricks", "minecraft:cobblestone"],
    roofType: "gable",
    roof: ["minecraft:deepslate_tiles", "minecraft:gray_concrete"],
    roofSlab: ["minecraft:deepslate_tile_slab", "minecraft:stone_brick_slab"],
    gable: ["minecraft:quartz_block"],
    window: ["minecraft:glass_pane"],
    door: ["minecraft:dark_oak_door"],
    carpets: ["red", "blue"],
    tallWindows: true,
    windowEvery: 2,
  },
  {
    // White with a blue stripe, a front desk, offices, and a jail cell with iron bars.
    name: "Police Station",
    town: true,
    sign: "Police Station",
    rooms: { front: "lobby", ground: ["jail", "jail", "office"], upper: ["office", "kitchen", "office"] },
    width: [15, 18], depth: [12, 14], wingChance: 0.3, noDeck: true, maxStories: 2,
    bedColors: ["blue", "light_gray"],
    stairs: ["minecraft:stone_brick_stairs", "minecraft:oak_stairs"],
    wall: ["minecraft:white_concrete"],
    baseCourse: ["minecraft:blue_concrete"],
    corner: ["minecraft:blue_concrete"],
    iwall: ["minecraft:light_gray_concrete"],
    floor: ["minecraft:polished_diorite", "minecraft:white_concrete"],
    ceiling: ["minecraft:white_concrete"],
    foundation: ["minecraft:stone_bricks", "minecraft:cobblestone"],
    roofType: "flat",
    roof: ["minecraft:gray_concrete"],
    parapet: ["minecraft:blue_concrete"],
    window: ["minecraft:glass_pane"],
    door: ["minecraft:spruce_door"],
    carpets: ["blue", "light_gray"],
    tallWindows: false,
    windowEvery: 2,
  },
  {
    // Red brick with a big garage door and a fire truck inside, firefighters' bunks and kitchen upstairs.
    name: "Fire Station",
    town: true,
    sign: "Fire Station",
    garage: true,
    rooms: { front: "garage", ground: ["kitchen", "office"], upper: ["bunks", "kitchen", "bunks"] },
    width: [17, 19], depth: [12, 14], wingChance: 0, noDeck: true, minStories: 2, maxStories: 2,
    bedColors: ["red"],
    stairs: ["minecraft:brick_stairs", "minecraft:oak_stairs"],
    wall: ["minecraft:bricks"],
    corner: ["minecraft:red_concrete"],
    iwall: ["minecraft:white_concrete"],
    floor: ["minecraft:polished_andesite", "minecraft:stone"],
    ceiling: ["minecraft:white_concrete"],
    foundation: ["minecraft:stone_bricks", "minecraft:cobblestone"],
    roofType: "flat",
    roof: ["minecraft:gray_concrete"],
    parapet: ["minecraft:red_concrete"],
    window: ["minecraft:glass_pane"],
    door: ["minecraft:crimson_door", "minecraft:dark_oak_door"],
    carpets: ["red", "black"],
    tallWindows: false,
    windowEvery: 2,
  },
  {
    // White and light blue, with a front desk, wards of beds, exam rooms, and a pharmacy.
    name: "Hospital",
    town: true,
    sign: "Hospital",
    rooms: { front: "reception", ground: ["exam", "ward", "pharmacy"], upper: ["ward", "exam", "ward"] },
    width: [16, 19], depth: [12, 15], wingChance: 0.35, noDeck: true, minStories: 2, maxStories: 3,
    bedColors: ["white", "light_blue"],
    stairs: ["minecraft:quartz_stairs", "minecraft:birch_stairs"],
    wall: ["minecraft:white_concrete"],
    corner: ["minecraft:light_blue_concrete"],
    iwall: ["minecraft:white_concrete"],
    floor: ["minecraft:smooth_quartz", "minecraft:quartz_block"],
    ceiling: ["minecraft:white_concrete"],
    foundation: ["minecraft:stone_bricks", "minecraft:cobblestone"],
    roofType: "flat",
    roof: ["minecraft:light_gray_concrete"],
    parapet: ["minecraft:light_blue_concrete"],
    window: ["minecraft:light_blue_stained_glass_pane", "minecraft:glass_pane"],
    door: ["minecraft:birch_door"],
    carpets: ["light_blue", "white"],
    tallWindows: true,
    windowEvery: 2,
  },
];

const BED_COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
  "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"];

const FLOWERS = [
  "dandelion", "poppy", "blue_orchid", "allium", "azure_bluet", "red_tulip",
  "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy", "cornflower",
  "lily_of_the_valley",
].map((f) => `minecraft:${f}`);

// =====================================================================
// PLANNER: works out the whole house as a list of building steps.
// It doesn't touch the world, so it can be tested on its own.
// Coordinates: u = across (left to right as you face the house),
// v = away from you (v = 0 is the front wall), y = height
// (y = 0 is the level your feet are on).
// =====================================================================
const OUT = 0, FLOOR = 1, WALL = 2, IWALL = 3, DOORWAY = 4, FRONTDOOR = 5;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const STORY_H = 4;
const floorY = (s) => -1 + STORY_H * s;

// The planner's dice. Normally Math.random, but the Builder's Blueprint swaps in seeded dice
// so the same house can be planned again after the world is closed and opened mid-build.
let rand = Math.random;
function seededDice(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function withSeed(seed, fn) {
  const old = rand;
  rand = seededDice(seed);
  try {
    return fn();
  } finally {
    rand = old;
  }
}

const rint = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
const key = (u, v) => `${u},${v}`;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
function weighted(pairs) {
  let roll = rand() * pairs.reduce((s, p) => s + p[1], 0);
  for (const [value, w] of pairs) if ((roll -= w) < 0) return value;
  return pairs[0][0];
}

function planHouse(style) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const plan = tryPlan(style);
    if (plan) return plan;
  }
  return null;
}

function tryPlan(style) {
  const stories = Math.min(style.maxStories || 4,
    Math.max(style.minStories || 1, weighted([[1, 3], [2, 4], [3, 3], [4, 1]])));

  // ---- Footprint: a main box, sometimes with a wing (L or T shape) ----
  const W = rint(...(style.width || [11, 15])), D = rint(...(style.depth || [10, 13]));
  const rects = [{ u0: 0, v0: 0, u1: W - 1, v1: D - 1 }];
  let wingSide = null;
  if (rand() < (style.wingChance ?? 0.5)) {
    wingSide = pick(["left", "right", "back"]);
    if (wingSide === "back") {
      const ww = Math.min(rint(8, 10), W - 2), wd = rint(8, 10);
      const u0 = rand() < 0.5 ? 0 : W - ww;
      rects.push({ u0, u1: u0 + ww - 1, v0: D - 1, v1: D - 1 + wd - 1 });
    } else {
      const ww = rint(8, 10), wd = rint(8, Math.min(11, D - 2));
      const v0 = rand() < 0.5 ? 0 : D - wd;
      const u0 = wingSide === "right" ? W - 1 : -(ww - 1);
      rects.push({ u0, u1: u0 + ww - 1, v0, v1: v0 + wd - 1 });
    }
  }
  const minU = Math.min(...rects.map((r) => r.u0));
  for (const r of rects) { r.u0 -= minU; r.u1 -= minU; }
  const BW = Math.max(...rects.map((r) => r.u1)) + 1;
  const BD = Math.max(...rects.map((r) => r.v1)) + 1;
  const main = rects[0], wing = rects[1] || null;
  const inRect = (r, u, v) => u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1;

  const paint = (rs) => {
    const g = Array.from({ length: BD }, () => new Array(BW).fill(OUT));
    for (const r of rs) {
      for (let v = r.v0; v <= r.v1; v++) {
        for (let u = r.u0; u <= r.u1; u++) {
          const edge = u === r.u0 || u === r.u1 || v === r.v0 || v === r.v1;
          if (!edge) g[v][u] = FLOOR;
          else if (g[v][u] !== FLOOR) g[v][u] = WALL;
        }
      }
    }
    const at = (u, v) => (g[v] && g[v][u]) ?? OUT;
    for (let v = 0; v < BD; v++) {
      for (let u = 0; u < BW; u++) {
        if (g[v][u] !== WALL) continue;
        if ((at(u - 1, v) === FLOOR && at(u + 1, v) === FLOOR) ||
            (at(u, v - 1) === FLOOR && at(u, v + 1) === FLOOR)) g[v][u] = IWALL;
      }
    }
    return g;
  };
  const cornersOf = (rs) => {
    const c = new Set();
    for (const r of rs) for (const [u, v] of [[r.u0, r.v0], [r.u1, r.v0], [r.u0, r.v1], [r.u1, r.v1]]) c.add(key(u, v));
    return c;
  };

  // Some houses get a rooftop deck with stairs up to it (more often for flat roofs).
  const roofDeck = !style.noDeck && rand() < (style.roofType === "flat" ? 0.6 : 0.25);
  const levels = stories + (roofDeck ? 1 : 0);

  const grids = [], rooms = [], stairs = [], corners = [];
  const blocked = range(0, stories).map(() => new Set()); // no furniture / stairs here
  const keep = range(0, stories).map(() => new Set());    // must stay open floor
  const holes = range(0, stories).map(() => new Set());   // gaps in this story's floor
  const fences = range(0, stories).map(() => []);
  let door = null, bay = null;

  for (let s = 0; s < levels; s++) {
    const isRoof = s === stories; // the rooftop deck
    const rs = s === 0 ? rects : [main];
    const g = paint(rs);
    grids.push(g);
    corners.push(cornersOf(rs));

    if (s === 0) {
      // Doorway between the main house and the wing.
      if (wing) {
        const shared = [];
        for (let v = 0; v < BD; v++) for (let u = 0; u < BW; u++) if (g[v][u] === IWALL) shared.push([u, v]);
        if (!shared.length) return null;
        const [du, dv] = pick(shared);
        g[dv][du] = DOORWAY;
      }
      // Front door on the main front wall.
      const opts = range(main.u0 + 2, main.u1 - 2).filter((u) =>
        g[main.v0][u] === WALL && g[main.v0 + 1][u] === FLOOR);
      if (!opts.length) return null;
      door = { u: pick(opts), v: main.v0 };
      g[door.v][door.u] = FRONTDOOR;
      blocked[0].add(key(door.u, door.v + 1));
    }

    // Split the space into rooms.
    const storyRooms = [];
    for (const r of isRoof ? [] : rs) {
      bsp(g, { u0: r.u0 + 1, v0: r.v0 + 1, u1: r.u1 - 1, v1: r.v1 - 1 }, keep[s], storyRooms);
    }
    for (const r of storyRooms) rooms.push({ ...r, story: s, inWing: !!wing && s === 0 && inRect(wing, r.u0, r.v0) && !inRect(main, r.u0, r.v0) });

    // A fire station's garage bay: a big 4-wide opening in the front wall of the front room, beside the door.
    if (s === 0 && style.garage) {
      const fr = storyRooms.find((r) => door.u >= r.u0 && door.u <= r.u1 && r.v0 === main.v0 + 1);
      if (!fr) return null;
      const opts = range(fr.u0, fr.u1 - 3).filter((u0) => range(u0, u0 + 3).every((u) =>
        Math.abs(u - door.u) >= 3 && g[main.v0][u] === WALL && g[main.v0 + 1][u] === FLOOR
        && !corners[0].has(key(u, main.v0))));
      if (!opts.length || fr.v1 - fr.v0 + 1 < 7) return null;
      const u0 = pick(opts);
      bay = { u0, u1: u0 + 3, v: main.v0 };
      for (let u = u0; u <= u0 + 3; u++) for (let v = main.v0 + 1; v <= main.v0 + 5; v++) blocked[0].add(key(u, v));
    }

    // Fences around the stair hole coming up from the story below.
    if (s > 0) {
      const st = stairs[s - 1];
      for (const [hu, hv] of st.t.slice(1, 4)) {
        for (const [du, dv] of DIRS) {
          const nu = hu + du, nv = hv + dv, nk = key(nu, nv);
          if (holes[s].has(nk) || (nu === st.t[4][0] && nv === st.t[4][1])) continue;
          if (g[nv] && g[nv][nu] === FLOOR && !fences[s].some(([a, b]) => a === nu && b === nv)) {
            fences[s].push([nu, nv]);
            blocked[s].add(nk);
          }
        }
      }
    }

    // Staircase up to the next story, placed so it doesn't cut off any part of the floor.
    const closed = new Set([...holes[s], ...fences[s].map(([u, v]) => key(u, v))]);
    if (s < levels - 1) {
      const st = findStair(g, main, blocked[s]).find((opt) =>
        isConnected(g, new Set([...closed, ...[...opt.t.slice(1, 5), ...opt.rail].map(([u, v]) => key(u, v))])));
      if (!st) return null;
      stairs.push(st);
      for (const [u, v] of [...st.t.slice(0, 5), ...st.rail]) blocked[s].add(key(u, v));
      for (const [u, v] of st.t.slice(1, 6)) { keep[s + 1].add(key(u, v)); blocked[s + 1].add(key(u, v)); }
      blocked[s + 1].add(key(...st.t[0]));
      for (const [u, v] of st.t.slice(1, 4)) holes[s + 1].add(key(u, v));
    } else if (!isConnected(g, closed)) {
      return null;
    }
  }

  return { style, stories, roofDeck, BW, BD, main, wing, wingSide, grids, rooms, stairs, corners, blocked, holes, fences, door, bay };
}

// Splits a rectangle into rooms with interior walls, each with a doorway.
const ROOM_MIN = 5; // smallest room, inside the walls (old houses had rooms as narrow as 3)
function bsp(g, r, keepSet, rooms) {
  const w = r.u1 - r.u0 + 1, d = r.v1 - r.v0 + 1;
  const splitAt = ROOM_MIN * 2 + 1;
  if ((w < splitAt && d < splitAt) || (w <= 12 && d <= 12 && rand() < 0.35)) {
    rooms.push(r);
    return;
  }
  const axes = w >= d ? ["u", "v"] : ["v", "u"];
  for (const ax of axes) {
    if ((ax === "u" ? w : d) < splitAt) continue;
    const opts = [];
    const [lo, hi] = ax === "u" ? [r.u0, r.u1] : [r.v0, r.v1];
    for (let p = lo + ROOM_MIN; p <= hi - ROOM_MIN; p++) {
      const line = ax === "u" ? range(r.v0, r.v1).map((v) => [p, v]) : range(r.u0, r.u1).map((u) => [u, p]);
      if (line.every(([u, v]) => !keepSet.has(key(u, v)) && !nearDoor(g, u, v))) opts.push({ p, line });
    }
    if (!opts.length) continue;
    const { p, line } = pick(opts);
    for (const [u, v] of line) g[v][u] = IWALL;
    const [du, dv] = pick(line);
    g[dv][du] = DOORWAY;
    if (ax === "u") {
      bsp(g, { ...r, u1: p - 1 }, keepSet, rooms);
      bsp(g, { ...r, u0: p + 1 }, keepSet, rooms);
    } else {
      bsp(g, { ...r, v1: p - 1 }, keepSet, rooms);
      bsp(g, { ...r, v0: p + 1 }, keepSet, rooms);
    }
    return;
  }
  rooms.push(r);
}

// True if every open tile on this floor can still be walked to from every other
// (closed = tiles that are blocked by steps, railings, holes, or furniture).
function isConnected(g, closed) {
  const open = (u, v) => {
    const t = g[v] && g[v][u];
    return (t === FLOOR || t === DOORWAY || t === FRONTDOOR) && !closed.has(key(u, v));
  };
  let total = 0, first = null;
  for (let v = 0; v < g.length; v++) {
    for (let u = 0; u < g[v].length; u++) {
      if (open(u, v)) { total++; if (!first) first = [u, v]; }
    }
  }
  if (!first) return true;
  const seen = new Set([key(...first)]);
  const queue = [first];
  for (let i = 0; i < queue.length; i++) {
    const [u, v] = queue[i];
    for (const [du, dv] of DIRS) {
      const nu = u + du, nv = v + dv, nk = key(nu, nv);
      if (!seen.has(nk) && open(nu, nv)) { seen.add(nk); queue.push([nu, nv]); }
    }
  }
  return seen.size === total;
}

function nearDoor(g, u, v) {
  return DIRS.some(([du, dv]) => {
    const t = g[v + dv] && g[v + dv][u + du];
    return t === DOORWAY || t === FRONTDOOR;
  });
}

// A straight run of 4 steps along a wall: t[0] = bottom approach,
// t[1..4] = steps, t[5] = landing on the floor above. rail = the tiles beside
// steps 1-3 on the open side, where the banister goes.
function findStair(g, m, blockedSet) {
  const inside = (u, v) => u > m.u0 && u < m.u1 && v > m.v0 && v < m.v1;
  const opts = [];
  for (let v = m.v0 + 1; v < m.v1; v++) {
    for (let u = m.u0 + 1; u < m.u1; u++) {
      for (const [du, dv] of DIRS) {
        const t = range(0, 5).map((i) => [u + du * i, v + dv * i]);
        if (!t.every(([a, b]) => inside(a, b))) continue;
        if (!t.slice(0, 5).every(([a, b]) => g[b][a] === FLOOR && !blockedSet.has(key(a, b)) && !nearDoor(g, a, b))) continue;
        for (const side of [1, -1]) {
          const pu = -dv * side, pv = du * side;
          const against = t.slice(1, 5).every(([a, b]) => {
            const x = g[b + pv] && g[b + pv][a + pu];
            return x === WALL || x === IWALL;
          });
          const rail = t.slice(1, 4).map(([a, b]) => [a - pu, b - pv]);
          const railOk = rail.every(([a, b]) => g[b] && g[b][a] === FLOOR && !blockedSet.has(key(a, b)) && !nearDoor(g, a, b));
          if (against && railOk) opts.push({ t, dir: [du, dv], rail });
        }
      }
    }
  }
  return shuffle(opts);
}

// ---------------------------------------------------------------------
// Turns a plan into an ordered list of building steps.
// Each step: { u, v, y, b } (b = what to place), plus { pause: true }
// markers so the build appears layer by layer.
// ---------------------------------------------------------------------
// With frame: true (the Builder's Blueprint) it's just the house itself: foundation, floors, walls,
// windows, ceilings, roof, stairs with railings, the front door, ceiling lights and the path.
// No furniture, wall decor, lamp posts or garden: that's left for the player to do.
function buildSteps(plan, opts = {}) {
  const frame = !!opts.frame;
  const { style, stories, BW, BD, main, wing, grids, rooms, stairs, corners, blocked, holes, fences, door } = plan;
  const steps = [];
  const put = (u, v, y, b, d) => steps.push(d ? { u, v, y, b, d } : { u, v, y, b });
  const pause = () => steps.push({ pause: true });
  const inMain = (u, v) => u >= main.u0 && u <= main.u1 && v >= main.v0 && v <= main.v1;
  const top = stories - 1;
  const R = floorY(top) + STORY_H; // ring level above the top story
  const flat = style.roofType === "flat";
  const mainFlat = flat || plan.roofDeck;

  // Roof shapes (worked out first so we know how tall the house gets).
  const roofs = [];
  const mainRidgeU = (main.u1 - main.u0) >= (main.v1 - main.v0);
  roofs.push({ r: main, base: R, ridgeU: mainRidgeU, clip: () => false });
  if (wing) {
    roofs.push({ r: wing, base: floorY(0) + STORY_H, ridgeU: plan.wingSide !== "back", clip: inMain });
  }
  let topY = R + 3;
  for (const rf of roofs) {
    const span = (rf.ridgeU ? rf.r.v1 - rf.r.v0 : rf.r.u1 - rf.r.u0) + 3;
    topY = Math.max(topY, rf.base + 2 + Math.ceil(span / 2));
  }
  plan.topY = topY;

  // 1. Clear the area (and the path to the door).
  steps.push({ clear: { u0: -1, u1: BW, v0: -1, v1: BD, y0: 0, y1: topY } });
  for (let v = -GAP + 1; v < -1; v++) steps.push({ clear: { u0: door.u, u1: door.u, v0: v, v1: v, y0: 0, y1: 2 } });
  pause();

  // 2. Foundation under everything.
  for (let v = 0; v < BD; v++) for (let u = 0; u < BW; u++) if (grids[0][v][u] !== OUT) steps.push({ foundation: true, u, v });
  pause();

  // 3. Each story, from the floor up.
  const wallBand = (y) => (style.wallBands ? `wallBand${((y + 1) % style.wallBands.length + style.wallBands.length) % style.wallBands.length}` : "wall");
  for (let s = 0; s < stories; s++) {
    const g = grids[s], fy = floorY(s);
    const windowAt = (u, v) => isWindow(plan, s, u, v);
    // Which way a wall runs (for horizontal log walls).
    const along = (u, v) => {
      if (!style.logWalls) return undefined;
      const w = (a, b) => { const t = g[b] && g[b][a]; return t === WALL || t === FRONTDOOR || t === IWALL; };
      return w(u - 1, v) || w(u + 1, v) ? "+u" : "+v";
    };
    const wallKey = (u, v, dy) => (corners[s].has(key(u, v)) ? "corner"
      : style.baseCourse && s === 0 && dy <= 1 ? "base" : wallBand(fy + dy));
    for (let v = 0; v < BD; v++) {
      for (let u = 0; u < BW; u++) {
        const t = g[v][u];
        if (t === OUT || holes[s].has(key(u, v))) continue;
        if (t === WALL) put(u, v, fy, wallKey(u, v, 0), along(u, v));
        else if (t === IWALL) put(u, v, fy, "iwall");
        else put(u, v, fy, "floor");
      }
    }
    pause();
    for (let dy = 1; dy <= 3; dy++) {
      for (let v = 0; v < BD; v++) {
        for (let u = 0; u < BW; u++) {
          const t = g[v][u];
          if (t === WALL && s === 0 && inBay(plan, u, v)) continue; // the fire station's garage opening
          if (t === WALL) {
            const win = windowAt(u, v) && (dy === 2 || (dy === 1 && style.tallWindows));
            if (win) put(u, v, fy + dy, "window");
            else put(u, v, fy + dy, wallKey(u, v, dy), along(u, v));
          } else if (t === IWALL) put(u, v, fy + dy, "iwall");
          else if ((t === DOORWAY) && dy === 3) put(u, v, fy + dy, "iwall");
          else if (t === FRONTDOOR && dy === 3) put(u, v, fy + dy, wallBand(fy + dy));
        }
      }
      pause();
    }
  }

  // 4. The ceiling ring on top of the top story (and on the wing).
  // With a rooftop deck, the main ring is the deck floor (with the stair opening left open).
  const ring = (g, cornerSet, y, only, isFlat, skip) => {
    for (let v = 0; v < BD; v++) {
      for (let u = 0; u < BW; u++) {
        if (!only(u, v) || (skip && skip.has(key(u, v)))) continue;
        const t = g[v][u];
        if (t === OUT) continue;
        if (t === WALL) put(u, v, y, cornerSet.has(key(u, v)) ? "corner" : wallBand(y));
        else put(u, v, y, isFlat ? "roof" : "ceiling");
      }
    }
  };
  ring(grids[top], corners[top], R, inMain, mainFlat, holes[stories]);
  if (wing) ring(grids[0], corners[0], floorY(0) + STORY_H, (u, v) => !inMain(u, v), flat);
  pause();

  // 5. Roofs.
  roofs.forEach((rf, i) => {
    if (i === 0 && plan.roofDeck) deckRailing(rf, put, frame);
    else if (i === 0 ? mainFlat : flat) flatRoof(rf, put);
    else gableRoof(rf, style, put);
    pause();
  });

  // 6. Front door (closed), lamp posts, stairs, railings, lights, furniture.
  put(door.u, door.v, 0, "door_lower", "+v");
  put(door.u, door.v, 1, "door_upper", "+v");
  // Town buildings have a sign with their name over the door.
  if (style.sign) put(door.u, door.v - 1, 2, "sign", "-v");
  // Lamp posts beside the door (built down to the ground in the world, see "lamp").
  if (!frame) for (const du of [-1, 1]) steps.push({ lamp: true, u: door.u + du, v: -1 });

  stairs.forEach((st, s) => {
    const fy = floorY(s);
    const d = st.dir[0] === 1 ? "+u" : st.dir[0] === -1 ? "-u" : st.dir[1] === 1 ? "+v" : "-v";
    for (let i = 1; i <= 4; i++) {
      const [u, v] = st.t[i];
      for (let dy = 1; dy < i; dy++) put(u, v, fy + dy, "step");
      put(u, v, fy + i, "stair", d); // a real stair block on top of each step
    }
    // Banister: fences beside steps 1-3 on the open side, a bit taller than each step.
    st.rail.forEach(([u, v], i) => {
      for (let dy = 1; dy <= Math.min(i + 2, 3); dy++) put(u, v, fy + dy, "fence");
    });
  });
  fences.forEach((list, s) => list.forEach(([u, v]) => put(u, v, floorY(s) + 1, "fence")));
  pause();

  if (frame) ceilingLights(plan, put);
  else furnish(plan, put);
  pause();

  // 7. Outside: a path (with steps if the ground dips) to the door, then a garden around the house.
  steps.push({ frontPath: true, u: door.u });
  if (frame) return steps;
  const g0 = grids[0];
  const at0 = (u, v) => (g0[v] && g0[v][u]) ?? OUT;
  for (let v = -1; v <= BD; v++) {
    for (let u = -1; u <= BW; u++) {
      if (at0(u, v) !== OUT) continue;
      if (v === -1 && Math.abs(u - door.u) <= 1) continue; // path and lamp posts
      if (v === -1 && inBay(plan, u, 0)) continue;           // in front of the garage
      // Only right next to the house walls.
      const wallNext = DIRS.find(([du, dv]) => at0(u + du, v + dv) === WALL);
      if (!wallNext) continue;
      const nearWindow = isWindow(plan, 0, u + wallNext[0], v + wallNext[1]);
      const roll = rand();
      if (roll < 0.3 && !nearWindow) steps.push({ decor: "bush", u, v });
      else if (roll < 0.62) steps.push({ decor: "flower", u, v });
      else if (roll < 0.75) steps.push({ decor: "plant", u, v });
    }
  }
  return steps;
}

// A rooftop deck: a low wall around the edge with a railing on top
// (too tall to climb over), and lanterns on the corners.
function deckRailing(rf, put, frame) {
  const { r, base } = rf;
  for (let v = r.v0; v <= r.v1; v++) {
    for (let u = r.u0; u <= r.u1; u++) {
      if (!(u === r.u0 || u === r.u1 || v === r.v0 || v === r.v1)) continue;
      put(u, v, base + 1, "parapet");
      put(u, v, base + 2, "fence");
    }
  }
  if (frame) return;
  for (const [u, v] of [[r.u0, r.v0], [r.u1, r.v0], [r.u0, r.v1], [r.u1, r.v1]]) put(u, v, base + 3, "lantern");
}

const inBay = (plan, u, v) => !!plan.bay && v === plan.bay.v && u >= plan.bay.u0 && u <= plan.bay.u1;

function isWindow(plan, s, u, v) {
  const { grids, corners, style, stairs, door } = plan;
  const g = grids[s];
  if (g[v][u] !== WALL || corners[s].has(key(u, v))) return false;
  if ((u + v) % style.windowEvery !== 0) return false;
  const at = (a, b) => (g[b] && g[b][a]) ?? OUT;
  // Needs open floor inside and open air outside.
  let inside = null, outside = false;
  for (const [du, dv] of DIRS) {
    const t = at(u + du, v + dv);
    if (t === FLOOR) inside = [u + du, v + dv];
    if (t === OUT) outside = true;
    if (t === IWALL || t === DOORWAY || t === FRONTDOOR) return false;
  }
  if (!inside || !outside) return false;
  if (s === 0 && Math.abs(u - door.u) + Math.abs(v - door.v) <= 1) return false;
  if (s === 0 && (inBay(plan, u, v) || inBay(plan, u - 1, v) || inBay(plan, u + 1, v))) return false;
  const st = stairs[s];
  if (st && st.t.slice(1, 5).some(([a, b]) => a === inside[0] && b === inside[1])) return false;
  return true;
}

function gableRoof(rf, style, put) {
  const { r, base, ridgeU, clip } = rf;
  const y0 = base + 1;
  // across = the direction the roof slopes; along = the ridge direction.
  const [a0, a1] = ridgeU ? [r.v0, r.v1] : [r.u0, r.u1];
  const [l0, l1] = ridgeU ? [r.u0, r.u1] : [r.v0, r.v1];
  const S = a1 - a0 + 3; // with one block of overhang on each side
  const stepped = !style.roofSlab;
  const maxK = Math.floor((S - 1) / 2);
  const roofKeyAt = (l, k) => {
    if (style.roofLayers) {
      return `roofLayer${Math.min(style.roofLayers.length - 1, Math.floor((k / (maxK + 1)) * style.roofLayers.length))}`;
    }
    if (style.roofSpots && rand() < style.roofSpots.chance) return "roofSpot";
    if (style.roofStripes) return `roofStripe${((l % style.roofStripes.length) + style.roofStripes.length) % style.roofStripes.length}`;
    return "roof";
  };
  for (let i = 0; i < S; i++) {
    const a = a0 - 1 + i;
    const k = Math.min(i, S - 1 - i);
    for (let l = l0 - 1; l <= l1 + 1; l++) {
      const [u, v] = ridgeU ? [l, a] : [a, l];
      if (clip(u, v)) continue;
      const roofKey = roofKeyAt(l, k);
      let topFull;
      if (stepped) {
        topFull = y0 + k;
        put(u, v, topFull, roofKey);
      } else {
        const half = k + 1;
        topFull = y0 + Math.floor(half / 2) - 1;
        if (half >= 2) put(u, v, topFull, roofKey);
        if (half % 2 === 1) put(u, v, y0 + Math.floor(half / 2), "roofSlab");
      }
      // Fill the triangle at each end wall.
      if ((l === l0 || l === l1) && a >= a0 && a <= a1) {
        for (let y = y0; y < topFull; y++) put(u, v, y, "gable", style.logWalls ? (ridgeU ? "+v" : "+u") : undefined);
      }
    }
  }
}

function flatRoof(rf, put) {
  const { r, base, clip } = rf;
  for (let v = r.v0; v <= r.v1; v++) {
    for (let u = r.u0; u <= r.u1; u++) {
      if (clip(u, v)) continue;
      if (u === r.u0 || u === r.u1 || v === r.v0 || v === r.v1) put(u, v, base + 1, "parapet");
    }
  }
}

// ---------------------------------------------------------------------
// Furniture: every room gets a job and some things to match.
// ---------------------------------------------------------------------
// Things that can hang in item frames.
const FRAME_ITEMS = ["clock", "compass", "diamond", "emerald", "poppy", "golden_apple", "music_disc_cat",
  "cookie", "spyglass", "nautilus_shell"];

function furnish(plan, put) {
  const { grids, rooms, blocked, holes, stories, door, style, stairs } = plan;
  const levels = stories + (plan.roofDeck ? 1 : 0);
  const used = range(0, stories).map(() => new Set());
  const solid = range(0, stories).map(() => new Set()); // furniture you bump into
  const wallDecor = new Set();                           // "u,v,y" spots on walls already decorated
  // Tiles you can't walk through on each floor; furniture is only placed
  // where it keeps every part of the floor reachable.
  const walkClosed = range(0, stories).map((s) => new Set([...holes[s], ...plan.fences[s].map(([u, v]) => key(u, v))]));
  stairs.forEach((st, s) => [...st.t.slice(1, 5), ...st.rail].forEach(([u, v]) => walkClosed[s].add(key(u, v))));

  // Keep-clear zones: nothing within a block of a door or doorway (and two blocks straight
  // in front of it), or around the bottom and top of the stairs.
  const noFurn = range(0, stories).map(() => new Set());
  const around = (set, u, v) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) set.add(key(u + a, v + b)); };
  for (let s = 0; s < levels; s++) {
    const g = grids[s];
    for (let v = 0; v < g.length; v++) {
      for (let u = 0; u < g[v].length; u++) {
        if (g[v][u] !== DOORWAY && g[v][u] !== FRONTDOOR) continue;
        around(noFurn[s], u, v);
        for (const [du, dv] of DIRS) if (g[v + dv] && g[v + dv][u + du] === FLOOR) noFurn[s].add(key(u + 2 * du, v + 2 * dv));
      }
    }
  }
  stairs.forEach((st, s) => {
    const [du, dv] = st.dir;
    around(noFurn[s], ...st.t[0]);
    noFurn[s].add(key(st.t[0][0] - du, st.t[0][1] - dv));
    around(noFurn[s + 1], ...st.t[5]);
    around(noFurn[s + 1], ...st.t[4]);
    noFurn[s + 1].add(key(st.t[5][0] + du, st.t[5][1] + dv));
  });
  const dirName = ([du, dv]) => (du === 1 ? "+u" : du === -1 ? "-u" : dv === 1 ? "+v" : "-v");

  // Decide what each room is.
  const front = rooms.find((r) => r.story === 0 && door.u >= r.u0 && door.u <= r.u1 && r.v0 === 1);
  const groundOrder = ["kitchen", "playroom", "bedroom", "library"];
  const upperOrder = ["bedroom", "bedroom", "playroom", "library", "bedroom", "playroom"];
  let gi = 0, ui = 0;
  if (style.rooms) {
    // A town building: its own list of rooms.
    const R = style.rooms;
    for (const r of rooms) {
      if (r === front || (!front && r === rooms[0])) r.type = R.front;
      else if (r.story === 0) r.type = R.ground[gi++ % R.ground.length];
      else r.type = R.upper[ui++ % R.upper.length];
    }
  } else {
    for (const r of rooms) {
      if (rooms.length === 1) r.type = "studio";
      else if (r === front) r.type = "living";
      else if (r.story === 0) r.type = groundOrder[gi++ % groundOrder.length];
      else r.type = upperOrder[ui++ % upperOrder.length];
    }
    if (!rooms.some((r) => r.type === "bedroom" || r.type === "studio")) {
      const r = rooms.find((x) => x.type !== "living") || front || rooms[0];
      r.type = r.type === "living" ? "living+bed" : "bedroom";
    }
  }
  // The gift chest goes in a room you reach after the entry room (houses only).
  const giftRoom = style.town ? null
    : rooms.find((r) => r.type !== "living" && r.story === 0) || rooms.find((r) => r.type !== "living") || rooms[0];

  // Banner curtains on both sides of some windows (hung up high, so they never get in the way).
  const BANNERS = (style.carpets || ["white"]);
  if ((style.windowEvery || 2) >= 2) {
    for (let s = 0; s < stories; s++) {
      const g = grids[s], fy = floorY(s);
      let pairs = 0; // at most two curtained windows per floor
      for (const [u, v] of shuffle(range(0, g.length * g[0].length - 1).map((i) => [i % g[0].length, Math.floor(i / g[0].length)]))) {
        {
          if (pairs >= 2 || !isWindow(plan, s, u, v) || rand() > 0.5) continue;
          const n = DIRS.find(([du, dv]) => g[v + dv] && g[v + dv][u + du] === FLOOR);
          if (!n) continue;
          const along = n[0] === 0 ? [1, 0] : [0, 1];
          const spots = [1, -1].map((k) => [u + along[0] * k, v + along[1] * k]).map(([wu, wv]) => ({
            wu, wv, iu: wu + n[0], iv: wv + n[1],
          }));
          const ok = spots.every(({ wu, wv, iu, iv }) => g[wv] && g[wv][wu] === WALL && !isWindow(plan, s, wu, wv)
            && g[iv] && g[iv][iu] === FLOOR && !holes[s + 1]?.has(key(iu, iv)) && !blocked[s].has(key(iu, iv))
            && !wallDecor.has(`${iu},${iv},${fy + 3}`));
          if (!ok) continue;
          const color = pick(BANNERS);
          pairs++;
          for (const { iu, iv } of spots) {
            put(iu, iv, fy + 3, `banner:${color}`, dirName(n));
            wallDecor.add(`${iu},${iv},${fy + 3}`);
            wallDecor.add(`${iu},${iv},${fy + 2}`);
          }
        }
      }
    }
  }

  for (const r of rooms) {
    const s = r.story, g = grids[s], fy = floorY(s);
    const at = (u, v) => (g[v] && g[v][u]) ?? OUT;
    const free = (u, v) => at(u, v) === FLOOR && !blocked[s].has(key(u, v)) && !used[s].has(key(u, v))
      && !noFurn[s].has(key(u, v)) && !nearDoor(g, u, v);
    // Leave a gap between pieces of furniture so rooms don't feel crowded.
    const roomy = (u, v) => !DIRS.some(([du, dv]) => solid[s].has(key(u + du, v + dv)));
    const take = (u, v, isSolid = true) => {
      used[s].add(key(u, v));
      if (isSolid) solid[s].add(key(u, v));
    };
    const canOccupy = (...spots) => {
      const c = walkClosed[s];
      const added = spots.map(([u, v]) => key(u, v)).filter((k) => !c.has(k));
      added.forEach((k) => c.add(k));
      if (isConnected(g, c)) return true;
      added.forEach((k) => c.delete(k));
      return false;
    };
    const wallSide = (u, v) => DIRS.find(([du, dv]) => {
      const t = at(u + du, v + dv);
      return t === WALL || t === IWALL;
    });
    const tiles = [];
    for (let v = r.v0; v <= r.v1; v++) for (let u = r.u0; u <= r.u1; u++) tiles.push([u, v]);
    const high = new Set(); // tiles with something two blocks tall (no pictures above those)
    const edgeTiles = () => shuffle(tiles.filter(([u, v]) => free(u, v) && roomy(u, v) && wallSide(u, v)));
    const area = tiles.length;
    const cu = Math.floor((r.u0 + r.u1) / 2), cv = Math.floor((r.v0 + r.v1) / 2);

    // Lanterns hanging from the ceiling (clear of the curtains).
    roomLanterns(plan, r, put, (u, v) => wallDecor.has(`${u},${v},${fy + 3}`));

    // Furniture against the walls. Facing pieces (shelves) face into the room.
    const placeEdge = (b, tallTop) => {
      const spot = edgeTiles().find((t) => canOccupy(t));
      if (!spot) return null;
      take(...spot);
      const [du, dv] = wallSide(...spot);
      // Shelves and lecterns face into the room; a seat has its back to the wall.
      const d = b === "shelf" || b === "lectern" ? dirName([-du, -dv]) : b === "seat" ? dirName([du, dv]) : undefined;
      put(spot[0], spot[1], fy + 1, b, d);
      if (tallTop) { put(spot[0], spot[1], fy + 2, tallTop); high.add(key(...spot)); }
      return spot;
    };
    // Rows across the middle of the room (shop aisles, bookshelf stacks): a row, then two rows to walk
    // in, with room to walk around both ends. tallTop = a second block on top.
    const placeRows = (b, tallTop, max = 99) => {
      const alongU = r.u1 - r.u0 >= r.v1 - r.v0;
      const lines = alongU ? range(r.v0 + 2, r.v1 - 2) : range(r.u0 + 2, r.u1 - 2);
      const span = alongU ? range(r.u0 + 2, r.u1 - 2) : range(r.v0 + 2, r.v1 - 2);
      let n = 0;
      for (let i = 0; i < lines.length; i += 3) {
        for (const k of span) {
          const [u, v] = alongU ? [k, lines[i]] : [lines[i], k];
          if (n >= max || !free(u, v) || !canOccupy([u, v])) continue;
          take(u, v);
          n++;
          put(u, v, fy + 1, b);
          if (tallTop) { put(u, v, fy + 2, tallTop); high.add(key(u, v)); }
        }
      }
      return n;
    };
    // A desk against the wall with a chair in front of it, facing the desk.
    const placeDesk = (b = "desk") => {
      for (const [u, v] of edgeTiles()) {
        const [du, dv] = wallSide(u, v);
        const cu2 = u - du, cv2 = v - dv;
        if (!free(cu2, cv2) || !canOccupy([u, v], [cu2, cv2])) continue;
        take(u, v); take(cu2, cv2);
        put(u, v, fy + 1, b);
        put(cu2, cv2, fy + 1, "seat", dirName([-du, -dv]));
        return true;
      }
      return false;
    };
    // A table in the room with chairs on two sides.
    const placeTableWithSeats = () => {
      const t = placeTable(false);
      if (!t) return;
      let n = 0;
      for (const [du, dv] of shuffle(DIRS.slice())) {
        const su = t[0] + du, sv = t[1] + dv;
        if (n >= 2 || !free(su, sv) || !canOccupy([su, sv])) continue;
        take(su, sv);
        put(su, sv, fy + 1, "seat", dirName([du, dv]));
        n++;
      }
    };
    // A jail cell across one end of the room: a wall of iron bars with a door, and a bed inside.
    // Tries each end of the room (one without a doorway into the cell).
    const placeCell = () => {
      const okTile = ([u, v]) => at(u, v) === FLOOR && !blocked[s].has(key(u, v)) && !used[s].has(key(u, v))
        && !noFurn[s].has(key(u, v)) && !nearDoor(g, u, v);
      // (a, b) = (across the bars, into the cell) in room coordinates; side = which end of the room.
      for (const side of shuffle(["+v", "-v", "+u", "-u"])) {
        const alongU = side === "+v" || side === "-v";
        const [lo, hi] = alongU ? [r.u0, r.u1] : [r.v0, r.v1];       // the bars run from lo to hi
        const depth = alongU ? r.v1 - r.v0 + 1 : r.u1 - r.u0 + 1;
        if (depth < 5 || hi - lo < 4) continue;
        const end = side === "+v" ? r.v1 : side === "-v" ? r.v0 : side === "+u" ? r.u1 : r.u0;
        const step = side[0] === "+" ? 1 : -1;                        // from the bars toward the end wall
        const tile = (a, b) => (alongU ? [a, b] : [b, a]);
        const barB = end - 2 * step;
        const bars = range(lo, hi).map((a) => tile(a, barB));
        const cell = range(lo, hi).flatMap((a) => [tile(a, barB + step), tile(a, end)]);
        if (!bars.every(okTile) || !cell.every(okTile)) continue;
        const doorA = lo + 1 + Math.floor((hi - lo - 1) / 2);
        const wallBars = bars.filter((t) => t !== bars[doorA - lo]);
        if (!canOccupy(...wallBars)) continue;
        for (const [u, v] of wallBars) {
          take(u, v);
          put(u, v, fy + 1, "minecraft:iron_bars");
          put(u, v, fy + 2, "minecraft:iron_bars");
          high.add(key(u, v));
        }
        const [du0, dv0] = tile(doorA, barB);
        take(du0, dv0, false);
        put(du0, dv0, fy + 1, "door_lower", alongU ? "+v" : "+u");
        put(du0, dv0, fy + 2, "door_upper", alongU ? "+v" : "+u");
        for (const [u, v] of cell) used[s].add(key(u, v));
        const head = tile(lo, end), foot = tile(lo, end - step);
        if (canOccupy(head, foot)) {
          const color = pick(style.bedColors || BED_COLORS);
          const toWall = side;
          put(head[0], head[1], fy + 1, `bed_head:${color}`, toWall);
          put(foot[0], foot[1], fy + 1, `bed_foot:${color}`, toWall);
        }
        return true;
      }
      return false;
    };
    // A blocky fire truck parked behind the garage door, facing out: black wheels, a red body,
    // a windshield, and shiny equipment boxes on the back.
    const placeTruck = () => {
      const bay = plan.bay;
      if (!bay || s !== 0) return false;
      const us = [bay.u0 + 1, bay.u0 + 2], vs = [2, 3, 4, 5];
      const spots = vs.flatMap((v) => us.map((u) => [u, v]));
      if (!spots.every(([u, v]) => at(u, v) === FLOOR && !used[s].has(key(u, v)) && !walkClosed[s].has(key(u, v)))) return false;
      if (!canOccupy(...spots)) return false;
      for (const [u, v] of spots) {
        take(u, v);
        put(u, v, fy + 1, v === 2 || v === 5 ? "minecraft:black_concrete" : "minecraft:red_concrete");
        put(u, v, fy + 2, v === 2 ? "truck_glass" : v === 3 ? "minecraft:red_concrete" : "minecraft:iron_block");
        high.add(key(u, v));
      }
      return true;
    };
    const maybe = (chance, b) => (rand() < chance ? placeEdge(b) : null);
    const many = (n, b, tallTop) => { for (let i = 0; i < n; i++) placeEdge(b, tallTop); };
    const placeBed = () => {
      for (const [u, v] of edgeTiles()) {
        const [du, dv] = wallSide(u, v);
        const fu = u - du, fv = v - dv; // foot is one step away from the wall
        if (!free(fu, fv) || !roomy(fu, fv) || !canOccupy([u, v], [fu, fv])) continue;
        take(u, v); take(fu, fv);
        const color = pick(style.bedColors || BED_COLORS);
        put(u, v, fy + 1, `bed_head:${color}`, dirName([du, dv]));
        put(fu, fv, fy + 1, `bed_foot:${color}`, dirName([du, dv]));
        return true;
      }
      return false;
    };
    const placeTable = (withCake) => {
      const opts = shuffle(tiles.filter(([u, v]) => free(u, v) && roomy(u, v) && !wallSide(u, v)));
      const spot = opts.sort((a, b) =>
        (Math.abs(a[0] - cu) + Math.abs(a[1] - cv)) - (Math.abs(b[0] - cu) + Math.abs(b[1] - cv)))
        .find((t) => canOccupy(t));
      if (!spot) return null;
      take(...spot);
      if (withCake) {
        put(spot[0], spot[1], fy + 1, "barrel");
        put(spot[0], spot[1], fy + 2, "cake");
      } else {
        put(spot[0], spot[1], fy + 1, "fence");
        put(spot[0], spot[1], fy + 2, "plate");
      }
      return spot;
    };
    const rug = (center, colors, size) => {
      if (!center) return;
      for (const [u, v] of tiles) {
        if (!free(u, v) || Math.abs(u - center[0]) > size || Math.abs(v - center[1]) > size) continue;
        take(u, v, false);
        put(u, v, fy + 1, `carpet:${pick(colors)}`);
      }
    };

    if (r === giftRoom) placeEdge("gift_chest");
    switch (r.type) {
      case "living":
      case "living+bed":
        // The entry room stays open: a rug, the style's special pieces, maybe one more thing.
        for (const extra of style.extras || []) placeEdge(extra);
        if (r.type === "living+bed") placeBed();
        rug([cu, cv], [style.carpets[0]], 1);
        maybe(0.35, pick(["jukebox", "shelf"]));
        break;
      case "kitchen":
        placeEdge("furnace");
        placeEdge("crafting_table");
        maybe(0.5, pick(["smoker", "barrel"]));
        if (area >= 30) placeTable(true);
        break;
      case "bedroom":
        placeBed();
        maybe(0.5, pick(["chest", "shelf"]));
        rug([cu, cv], [pick(style.carpets)], 0);
        break;
      case "playroom":
        rug([cu, cv], ["red", "orange", "yellow", "lime", "light_blue", "purple"], 1);
        maybe(0.5, "noteblock");
        maybe(0.3, "jukebox");
        break;
      case "library":
        for (let i = 0; i < 3; i++) placeEdge(i === 2 ? "shelf" : "bookshelf");
        if (area >= 30) placeTable(false);
        break;
      case "studio":
        placeBed();
        placeEdge("crafting_table");
        maybe(0.6, "furnace");
        rug([cu, cv], [style.carpets[0]], 1);
        break;

      // ---- Town buildings ----
      case "stacks": // library shelves: rows of tall bookshelves, more along the walls
        placeRows("bookshelf", "bookshelf");
        many(4, "bookshelf", "bookshelf");
        maybe(0.6, "lectern");
        break;
      case "reading":
        for (let i = 0; i < 1 + (area >= 50 ? 1 : 0); i++) placeTableWithSeats();
        many(3, "bookshelf", "bookshelf");
        placeEdge("lectern");
        rug([cu, cv], [style.carpets[0]], 1);
        break;
      case "kids": // the children's corner
        rug([cu, cv], ["red", "orange", "yellow", "lime", "light_blue", "purple"], 1);
        many(2, "bookshelf");
        placeEdge("seat");
        maybe(0.6, "noteblock");
        break;
      case "store": // grocery aisles of barrels full of food, fresh produce and a freezer along the walls
        placeRows("food_barrel");
        placeDesk("counter");
        for (const b of ["minecraft:hay_block", "minecraft:melon_block", "minecraft:pumpkin", "minecraft:packed_ice"]) placeEdge(b);
        break;
      case "storeroom":
        many(4, "food_barrel");
        placeEdge("food_chest");
        maybe(0.5, "crafting_table");
        break;
      case "hall": { // meeting hall: a lectern at the back, rows of seats facing it, a red carpet down the aisle
        let podium = null;
        for (const [u, v] of shuffle(tiles.filter(([u, v]) => v === r.v1 && free(u, v)))
          .sort((a, b) => Math.abs(a[0] - cu) - Math.abs(b[0] - cu))) {
          if (canOccupy([u, v])) { podium = [u, v]; break; }
        }
        if (podium) {
          take(...podium);
          put(podium[0], podium[1], fy + 1, "lectern", "-v");
          let n = 0;
          for (let v = podium[1] - 3; v >= r.v0 + 1; v -= 2) {
            for (let u = r.u0 + 1; u <= r.u1 - 1; u++) {
              if (u === podium[0] || n >= 24 || !free(u, v) || !canOccupy([u, v])) continue;
              take(u, v);
              put(u, v, fy + 1, "seat", "-v"); // backs away from the lectern
              n++;
            }
          }
          for (let v = r.v0; v < podium[1] - 1; v++) {
            if (free(podium[0], v)) { take(podium[0], v, false); put(podium[0], v, fy + 1, "carpet:red"); }
          }
        }
        placeEdge("bell");
        break;
      }
      case "office":
        placeDesk();
        if (area >= 40) placeDesk();
        many(2, "bookshelf");
        maybe(0.5, "shelf");
        rug([cu, cv], [pick(style.carpets)], 0);
        break;
      case "lobby":
      case "reception": // a front desk and a few chairs to wait in
        placeDesk("counter");
        many(3, "seat");
        maybe(0.5, "shelf");
        rug([cu, cv], [style.carpets[0]], 1);
        break;
      case "jail":
        if (!placeCell()) placeDesk();
        placeDesk();
        break;
      case "garage":
        placeTruck();
        placeEdge("water_cauldron");
        placeEdge("bell");
        many(2, "chest");
        break;
      case "bunks":
        for (let i = 0; i < 4; i++) placeBed();
        placeEdge("chest");
        break;
      case "ward": // hospital beds
        for (let i = 0; i < 4; i++) placeBed();
        maybe(0.6, "brewing_stand");
        break;
      case "exam":
        placeBed();
        placeEdge("brewing_stand");
        placeEdge("water_cauldron");
        placeEdge("shelf");
        break;
      case "pharmacy":
        placeDesk("counter");
        many(3, "shelf");
        many(2, "brewing_stand");
        break;
    }

    // Wall decor at eye level: paintings and item frames (they don't get in anyone's way).
    const decorSpots = shuffle(tiles.filter(([u, v]) => {
      const side = wallSide(u, v);
      if (!side || at(u, v) !== FLOOR || blocked[s].has(key(u, v)) || high.has(key(u, v)) || wallDecor.has(`${u},${v},${fy + 2}`)) return false;
      const [wu, wv] = [u + side[0], v + side[1]];
      if (isWindow(plan, s, wu, wv) || at(wu, wv) === DOORWAY || at(wu, wv) === FRONTDOOR) return false;
      return !DIRS.some(([du, dv]) => wallDecor.has(`${u + du},${v + dv},${fy + 2}`));
    }));
    const howMany = 1 + (area >= 60 ? 1 : 0);
    for (const [u, v] of decorSpots.slice(0, howMany)) {
      const [du, dv] = wallSide(u, v);
      const faces = dirName([-du, -dv]);
      put(u, v, fy + 2, rand() < 0.45 ? "painting" : `frame:${pick(FRAME_ITEMS)}`, faces);
      wallDecor.add(`${u},${v},${fy + 2}`);
    }
  }

  // Planters with flowers around the edge of a rooftop deck.
  if (plan.roofDeck) {
    const s = stories, m = plan.main, g = grids[s];
    const tiles = [];
    for (let v = m.v0 + 1; v < m.v1; v++) for (let u = m.u0 + 1; u < m.u1; u++) tiles.push([u, v]);
    const deckUsed = new Set();
    const closed = new Set([...holes[s], ...plan.fences[s].map(([u, v]) => key(u, v))]);
    const isEdge = (u, v) => DIRS.some(([du, dv]) => (g[v + dv] && g[v + dv][u + du]) === WALL);
    let count = 0;
    for (const [u, v] of shuffle(tiles.filter(([u, v]) => g[v][u] === FLOOR && isEdge(u, v)
      && !blocked[s].has(key(u, v)) && !noFurn[s].has(key(u, v))))) {
      if (count >= 4) break;
      if (DIRS.some(([du, dv]) => deckUsed.has(key(u + du, v + dv)))) continue;
      closed.add(key(u, v));
      if (!isConnected(g, closed)) { closed.delete(key(u, v)); continue; }
      deckUsed.add(key(u, v));
      put(u, v, floorY(s) + 1, "planter");
      put(u, v, floorY(s) + 2, "flowerRandom");
      count++;
    }
  }
}

// Lanterns hanging from the ceiling of a room: one in a small room, more spread out in a big one
// (about one for every 6 blocks each way). They hang in the top block of the room, so the floor
// upstairs stays solid, and never over the stairs (you'd bump your head going up) or a stair opening.
const LANTERN_SPACING = 6;
function roomLanterns(plan, r, put, avoid = () => false) {
  const s = r.story, fy = floorY(s);
  const no = new Set();
  const st = plan.stairs[s];
  if (st) for (const [u, v] of [...st.t.slice(0, 5), ...st.rail]) no.add(key(u, v));
  if (plan.holes[s + 1]) for (const k of plan.holes[s + 1]) no.add(k);
  for (const [u, v] of plan.fences[s] || []) no.add(key(u, v));
  const ok = (u, v) => !no.has(key(u, v)) && !avoid(u, v);
  const w = r.u1 - r.u0 + 1, d = r.v1 - r.v0 + 1;
  const nu = Math.max(1, Math.round(w / LANTERN_SPACING)), nv = Math.max(1, Math.round(d / LANTERN_SPACING));
  const placed = [];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const want = [r.u0 + Math.floor(((i + 0.5) * w) / nu), r.v0 + Math.floor(((j + 0.5) * d) / nv)];
      // The nearest free spot to where it should go (but not right next to another lantern).
      let best = null, bestD = Infinity;
      for (let v = r.v0; v <= r.v1; v++) {
        for (let u = r.u0; u <= r.u1; u++) {
          if (!ok(u, v) || placed.some(([a, b]) => Math.abs(a - u) <= 1 && Math.abs(b - v) <= 1)) continue;
          const dd = (u - want[0]) ** 2 + (v - want[1]) ** 2;
          if (dd < bestD && dd <= 4) { bestD = dd; best = [u, v]; }
        }
      }
      if (!best) continue;
      placed.push(best);
      put(best[0], best[1], fy + 3, "hanging_lantern");
    }
  }
  if (placed.length) return;
  // Every good spot was taken (stairs in the middle of a small room): anywhere free, nearest the middle.
  const cu = (r.u0 + r.u1) / 2, cv = (r.v0 + r.v1) / 2;
  let best = null, bestD = Infinity;
  for (let v = r.v0; v <= r.v1; v++) {
    for (let u = r.u0; u <= r.u1; u++) {
      const dd = (u - cu) ** 2 + (v - cv) ** 2;
      if (ok(u, v) && dd < bestD) { bestD = dd; best = [u, v]; }
    }
  }
  if (best) put(best[0], best[1], fy + 3, "hanging_lantern");
}

// Just the lanterns from furnish(), so a bare house isn't dark inside
// (and monsters don't move in before the decorating's done).
function ceilingLights(plan, put) {
  for (const r of plan.rooms) roomLanterns(plan, r, put);
}

// ---------------------------------------------------------------------
// The construction worker (Builder's Blueprint).
// ---------------------------------------------------------------------
const BUILDER_REACH = 3; // how far the builder can reach from where he stands
// Tap the builder to pick a speed: walk = blocks per tick, every = ticks between blocks.
const BUILDER_SPEEDS = [
  { name: "Slow and steady", walk: 0.15, every: 5 },
  { name: "Normal", walk: 0.28, every: 2 },
  { name: "Super fast!", walk: 0.5, every: 1 },
];

// Plans a frame-only house from a seed, so it comes out exactly the same every time
// (the build can carry on after the world is closed and opened again).
function framePlan(seed, styleIndex) {
  return withSeed(seed, () => {
    const plan = planHouse(STYLES[styleIndex]);
    if (!plan) return null;
    const steps = buildSteps(plan, { frame: true });
    return { plan, steps, ...builderTasks(plan, steps) };
  });
}

// Splits the steps into the quick groundwork (clearing the land and the foundation) and the
// builder's jobs: one block at a time (a whole door at once, and the path last), layer by layer,
// each layer in walking order (always the nearest block next, preferring the same height).
function builderTasks(plan, steps) {
  const prep = [], layers = [[]];
  for (const st of steps) {
    if (st.pause) {
      if (layers[layers.length - 1].length) layers.push([]);
      continue;
    }
    if (st.clear || st.foundation) { prep.push(st); continue; }
    const cur = layers[layers.length - 1];
    if (st.b === "door_upper") continue;
    if (st.b === "door_lower") cur.push({ door: true, u: st.u, v: st.v, y: st.y, d: st.d });
    else if (st.frontPath) cur.push({ frontPath: true, u: st.u, v: -1, y: -1 });
    else cur.push(st);
  }
  const tasks = [];
  let here = { u: plan.door.u, v: -1, y: 0 };
  const cost = (a, b) => Math.abs(a.u - b.u) + Math.abs(a.v - b.v) + 3 * Math.abs(a.y - b.y);
  for (const layer of layers) {
    const left = layer.slice();
    while (left.length) {
      let best = 0, bestCost = Infinity;
      for (let i = 0; i < left.length; i++) {
        const c = cost(here, left[i]);
        if (c < bestCost) { bestCost = c; best = i; }
      }
      here = left[best];
      tasks.push(here);
      left[best] = left[left.length - 1];
      left.pop();
    }
  }
  return { prep, tasks };
}

function canReach(feet, t) {
  return Math.hypot(feet.u - t.u, feet.v - t.v) <= BUILDER_REACH && Math.abs(t.y - feet.y) <= 3;
}

// Where the builder stands (feet, in house coordinates) to put task t in place. Walls, floors and
// stairs are built from inside, standing on the floor; roofs and anything outside the walls are built
// standing on top. He stays where he is (cur) while he can still reach.
function standSpot(plan, t, cur) {
  if (t.frontPath) return { u: t.u, v: -2, y: 0 };
  if (cur && canReach(cur, t)) return cur;
  const R = floorY(plan.stories - 1) + STORY_H;
  if (t.y < R) {
    const s = Math.max(0, Math.min(plan.stories - 1, Math.floor((t.y + 1) / STORY_H)));
    const g = plan.grids[s];
    if (g[t.v] && g[t.v][t.u] !== undefined && g[t.v][t.u] !== OUT) {
      let best = null, bestD = Infinity;
      for (let v = 0; v < g.length; v++) {
        for (let u = 0; u < g[v].length; u++) {
          if ((g[v][u] !== FLOOR && g[v][u] !== DOORWAY) || plan.holes[s].has(key(u, v))) continue;
          const d = (u - t.u) ** 2 + (v - t.v) ** 2;
          if (d < bestD) { bestD = d; best = { u, v, y: floorY(s) + 1 }; }
        }
      }
      if (best) return best;
    }
  }
  return { u: t.u, v: t.v, y: t.y + 1 };
}

// =====================================================================
// MINECRAFT SIDE: turning the steps into real blocks.
// =====================================================================

// Blocks that probably belong to something someone built.
const PROTECTED = [
  "chest", "barrel", "bed", "door", "crafting_table", "furnace", "planks",
  "glass", "wool", "bricks", "concrete", "carpet", "sign", "shulker",
  "torch", "lantern", "bookshelf", "fence", "stairs", "slab", "quartz",
  "glowstone", "terracotta", "froglight", "sea_lantern",
];
const SOFT_GROUND = ["air", "water", "lava", "short_grass", "tall_grass", "tallgrass", "fern", "snow_layer", "leaves",
  "vine", "dandelion", "poppy", "tulip", "daisy", "orchid", "allium", "bluet", "cornflower",
  "lily", "bush", "seagrass", "kelp", "deadbush", "sweet_berry"];

const busy = new Set();

// Plants, snow, and air: things you stand in or on top of, not real ground.
const NOT_GROUND = ["air", "short_grass", "tall_grass", "tallgrass", "fern", "snow_layer", "dandelion", "poppy",
  "tulip", "daisy", "orchid", "allium", "bluet", "cornflower", "lily", "deadbush", "dead_bush", "water", "leaves",
  "flower", "petals", "bush", "sapling", "vine", "carpet"];
const isGround = (id) => !!id && id !== "unloaded" && !NOT_GROUND.some((w) => id.includes(w));

// The level your feet are at. Rounding (instead of rounding down) handles standing on
// path blocks, farmland, soul sand, or snow; if you're mid-jump it finds the ground below.
function groundLevel(dim, loc) {
  let y = Math.round(loc.y);
  for (let i = 0; i < 4; i++) {
    let below;
    try { below = dim.getBlock({ x: Math.floor(loc.x), y: y - 1, z: Math.floor(loc.z) })?.typeId; } catch {}
    if (!below || isGround(below)) break;
    y--;
  }
  return y;
}

// Give the blueprints on first join (no cheats needed).
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    for (const [prop, id, msg] of [
      ["house:got_blueprint", ITEM_ID, "§bYou found a House Blueprint! §fUse it in a big open space to build a house!"],
      ["house:got_builder", BUILDER_ITEM, "§eYou found a Builder's Blueprint! §fA construction worker builds the walls and roof, and you get to decorate!"],
    ]) {
      try {
        if (player.getDynamicProperty(prop)) continue;
        const inv = player.getComponent("minecraft:inventory").container;
        const leftover = inv.addItem(new ItemStack(id, 1));
        if (leftover) player.dimension.spawnItem(leftover, player.location);
        player.setDynamicProperty(prop, true);
        player.sendMessage(msg);
      } catch {}
    }
  }, 100);
});

world.afterEvents.itemUse.subscribe(({ source: player, itemStack }) => {
  const id = itemStack?.typeId;
  if (id !== ITEM_ID && id !== BUILDER_ITEM) return;
  if (player?.typeId !== "minecraft:player") return;
  if (busy.has(player.id)) {
    player.sendMessage("§eHang on, your house is still being built!");
    return;
  }
  chooseAndBuild(player, id === BUILDER_ITEM);
});

async function chooseAndBuild(player, withBuilder) {
  busy.add(player.id);
  try {
    const title = withBuilder ? "Builder's Blueprint" : "House Blueprint";
    const near = houseNear(player);
    if (near) {
      const first = await new ActionFormData()
        .title(title)
        .body(`You're next to your ${near.style}. What would you like to do?`)
        .button("Build a new house")
        .button("§cRemove this house")
        .show(player);
      if (first.canceled || first.selection === undefined) return;
      if (first.selection === 1) {
        const sure = await new ActionFormData()
          .title("Remove this house?")
          .body("The whole house will disappear, and the land will go back to how it was before.\n\n"
            + "Anything in its chests and barrels will pop out in front for you to pick up.\n\n"
            + "§cAnything you built onto the house will disappear too!")
          .button("§cYes, remove it")
          .button("No, keep it")
          .show(player);
        if (!sure.canceled && sure.selection === 0) await removeHouse(player, near);
        return;
      }
    }
    if (withBuilder) {
      const mine = [...sites.values()].find((s) => s.b.owner === player.id);
      if (mine) {
        player.sendMessage(`§e${mine.b.name} is still building your house! §fTap ${mine.b.name} to change the speed.`);
        return;
      }
    }
    // A house, or a town building? Then which one.
    const kind = await new ActionFormData().title(title).body(withBuilder ? "What should the builder make?" : "What should we build?")
      .button("A house")
      .button("A town building")
      .show(player);
    if (kind.canceled || kind.selection === undefined) return;
    const town = kind.selection === 1;
    const choices = STYLES.map((st, i) => [st, i]).filter(([st]) => !!st.town === town);
    const form = new ActionFormData().title(title).body(town ? "Which building?" : "What kind of house?");
    form.button("§dSurprise me!");
    choices.forEach(([st]) => form.button(st.name));
    const res = await form.show(player);
    if (res.canceled || res.selection === undefined) return;
    const styleIndex = res.selection === 0 ? pick(choices)[1] : choices[res.selection - 1][1];
    if (withBuilder) {
      await startBuilder(player, styleIndex);
      return;
    }
    const plan = planHouse(STYLES[styleIndex]);
    if (!plan) {
      player.sendMessage("§cThe blueprint got crumpled! Try again.");
      return;
    }
    await buildHouse(player, plan);
  } catch {
  } finally {
    busy.delete(player.id);
  }
}

// ---------- Putting a planned house into the world ----------

// Which way the house faces and where it goes, from where the player stands and looks.
function orient(player) {
  const view = player.getViewDirection();
  const f = Math.abs(view.x) > Math.abs(view.z)
    ? { x: Math.sign(view.x), z: 0 }
    : { x: 0, z: Math.sign(view.z) || 1 };
  return {
    f,
    r: { x: -f.z, z: f.x },
    base: { x: Math.floor(player.location.x), y: groundLevel(player.dimension, player.location), z: Math.floor(player.location.z) },
  };
}

// Turns house coordinates into world blocks.
function worldCtx(dim, o, plan) {
  const { f, r, base } = o;
  const at = (u, v, y) => ({
    x: base.x + r.x * (u - plan.door.u) + f.x * (v + GAP),
    y: base.y + y,
    z: base.z + r.z * (u - plan.door.u) + f.z * (v + GAP),
  });
  const worldDir = (d) => {
    const vec = d === "+u" ? r : d === "-u" ? { x: -r.x, z: -r.z } : d === "+v" ? f : { x: -f.x, z: -f.z };
    return vec.x === 1 ? "east" : vec.x === -1 ? "west" : vec.z === 1 ? "south" : "north";
  };
  const getId = (loc) => {
    try {
      return dim.getBlock(loc)?.typeId ?? "unloaded";
    } catch {
      return "unloaded";
    }
  };
  const set = (loc, perm) => {
    if (!perm) return;
    try {
      dim.getBlock(loc)?.setPermutation(perm);
    } catch {}
  };
  // Highest real ground block in this column (relative to the floor), or 6 below if none.
  const groundAt = (u, v) => {
    for (let y = 3; y >= -8; y--) if (isGround(getId(at(u, v, y)))) return y;
    return -6;
  };
  return {
    dim, plan, at, worldDir, getId, set, groundAt,
    air: BlockPermutation.resolve("minecraft:air"),
    blocks: makeBlockResolver(plan.style, worldDir),
  };
}

// Safety check first: don't flatten anything someone built. A job: use with yield*; returns true if it's OK to build.
function* siteIsClear(ctx, player) {
  const { plan, at, getId } = ctx;
  for (let v = -GAP; v <= plan.BD; v++) {
    for (let u = -1; u <= plan.BW; u++) {
      if (v < -1 && u !== plan.door.u) continue;
      for (let y = -1; y <= plan.topY; y++) {
        const id = getId(at(u, v, y));
        if (id === "unloaded") {
          player.sendMessage("§cThat spot is too far away to build in. Move a little closer!");
          return false;
        }
        if (PROTECTED.some((w) => id.includes(w))) {
          player.sendMessage("§cWhoa! The house would knock down something already built. Try an open space.");
          return false;
        }
      }
    }
    yield;
  }
  return true;
}

// Saves a snapshot of the land first, so the house can be removed later, and remembers the house.
function recordHouse(ctx, extra) {
  const { plan, at, dim } = ctx;
  const c1 = at(-1, -GAP, -10), c2 = at(plan.BW, plan.BD, plan.topY);
  // Kept inside the world: in a flat world the ground is only a few blocks above the bottom.
  const lim = heightLimits(dim);
  const min = { x: Math.min(c1.x, c2.x), y: Math.max(c1.y, lim.lo), z: Math.min(c1.z, c2.z) };
  const max = { x: Math.max(c1.x, c2.x), y: Math.min(c2.y, lim.hi), z: Math.max(c1.z, c2.z) };
  const landId = `house:land_${Date.now().toString(36)}${Math.floor(Math.random() * 10000)}`;
  let saved = false;
  try {
    world.structureManager.createFromWorld(landId, dim, min, max,
      { saveMode: "World", includeEntities: false, includeBlocks: true });
    saved = true;
  } catch (e) {
    console.warn(`[House] Couldn't save a snapshot of the land: ${e}`);
  }
  const house = { id: landId, dim: dim.id, min, max, saved, style: plan.style.name, stand: at(plan.door.u, -GAP - 2, 0), ...extra };
  const houses = getHouses();
  houses.push(house);
  saveHouses(houses);
  return house;
}

// Clears a box of the land (one row per tick).
function* clearArea(ctx, c) {
  for (let v = c.v0; v <= c.v1; v++) {
    for (let u = c.u0; u <= c.u1; u++) {
      for (let y = c.y0; y <= c.y1; y++) {
        const loc = ctx.at(u, v, y);
        if (ctx.getId(loc) !== "minecraft:air") ctx.set(loc, ctx.air);
      }
    }
    yield;
  }
}

// Fills soft ground (water, plants, air in a dip) under the floor with foundation blocks.
function fillFoundation(ctx, u, v) {
  for (let y = -2; y >= -10; y--) {
    const loc = ctx.at(u, v, y);
    if (!SOFT_GROUND.some((w) => ctx.getId(loc).includes(w))) break;
    ctx.set(loc, ctx.blocks.get("foundation"));
  }
}

// Walk out from the door. Where the ground is lower, add a step; where it's higher, cut a path.
// h = the block you stand on (relative to the house floor).
function buildFrontPath(ctx, u) {
  const { at, getId, set, blocks, air } = ctx;
  const pathAt = (pu, pv, y) => {
    const id = getId(at(pu, pv, y));
    if (id === "minecraft:grass_block" || id === "minecraft:dirt") set(at(pu, pv, y), blocks.get("path"));
    else if (!isGround(id)) set(at(pu, pv, y), blocks.get("foundation"));
  };
  let h = -1;
  for (let v = -1; v >= -GAP; v--) {
    const g = ctx.groundAt(u, v);
    if (g >= h) {
      h = g;
      for (let y = h + 1; y <= h + 2; y++) set(at(u, v, y), air);
      pathAt(u, v, h);
    } else {
      for (let y = g + 1; y < h; y++) set(at(u, v, y), blocks.get("foundation"));
      set(at(u, v, h), blocks.get("stair", "+v")); // a step up toward the door
      for (let y = h + 1; y <= h + 2; y++) set(at(u, v, y), air);
      h--;
    }
  }
}

function buildHouse(player, plan) {
  return new Promise((resolve) => {
    const dim = player.dimension;
    const ctx = worldCtx(dim, orient(player), plan);
    const { at, worldDir, blocks, getId, set, air } = ctx;
    const steps = buildSteps(plan);

    function* job() {
      if (!(yield* siteIsClear(ctx, player))) {
        resolve();
        return;
      }
      recordHouse(ctx, {});

      const floors = plan.stories === 1 ? "1 floor" : `${plan.stories} floors`;
      player.sendMessage(`§bBuilding a ${plan.style.name} with ${floors}...`);
      playSound("block.bell.hit", player.location, 1);

      const structureBeds = new Set();
      const paintings = [];
      const ROTATE = { east: "None", south: "Rotate90", west: "Rotate180", north: "Rotate270" };
      const FACING = { east: 5, west: 4, south: 3, north: 2 };
      // Item frames (with something in them) and banners are pre-made pieces, turned to face into the room.
      const placeDecor = (step) => {
        const [kind, what] = step.b.split(":");
        const dirName = worldDir(step.d);
        const loc = at(step.u, step.v, step.y);
        try {
          world.structureManager.place(`house:${kind}_${what}`, dim, loc, { rotation: ROTATE[dirName] });
          return true;
        } catch {}
        if (kind === "frame") {
          // Backup: an empty frame.
          const frame = blocks.tryResolve(["minecraft:frame"], [{ facing_direction: FACING[dirName] }]);
          if (frame) set(loc, frame);
        }
        return false;
      };
      let count = 0;
      for (const step of steps) {
        if (step.pause) {
          playSound("dig.wood", at(plan.door.u, 0, 1), 0.9 + Math.random() * 0.3);
          yield;
          continue;
        }
        if (step.clear) {
          yield* clearArea(ctx, step.clear);
          continue;
        }
        if (step.foundation) {
          fillFoundation(ctx, step.u, step.v);
        } else if (step.b && step.b.startsWith("bed_head")) {
          // Bed color can't be set by scripts, so place a pre-made colored bed and turn it to fit.
          const color = step.b.split(":")[1] || "red";
          const head = at(step.u, step.v, step.y);
          const dirName = worldDir(step.d);
          const [dx, dz] = { east: [1, 0], west: [-1, 0], south: [0, 1], north: [0, -1] }[dirName];
          const foot = { x: head.x - dx, y: head.y, z: head.z - dz };
          let placed = false;
          try {
            world.structureManager.place(`house:bed_${color}`, dim,
              { x: Math.min(head.x, foot.x), y: head.y, z: Math.min(head.z, foot.z) }, { rotation: ROTATE[dirName] });
            placed = true;
          } catch {}
          if (placed) structureBeds.add(`${foot.x},${foot.y},${foot.z}`);
          else set(head, blocks.get(step.b, step.d));
        } else if (step.b && step.b.startsWith("bed_foot")) {
          const loc = at(step.u, step.v, step.y);
          if (!structureBeds.has(`${loc.x},${loc.y},${loc.z}`)) set(loc, blocks.get(step.b, step.d));
        } else if (step.lamp) {
          // A lantern on a fence post, built from the ground up.
          const g = ctx.groundAt(step.u, step.v);
          for (let y = g + 1; y <= 0; y++) set(at(step.u, step.v, y), blocks.get("fence"));
          set(at(step.u, step.v, Math.max(1, g + 2)), blocks.get("lantern"));
        } else if (step.frontPath) {
          buildFrontPath(ctx, step.u);
        } else if (step.b === "painting") {
          paintings.push(step);
        } else if (step.b && (step.b.startsWith("frame:") || step.b.startsWith("banner:"))) {
          placeDecor(step);
        } else if (step.decor) {
          const ground = getId(at(step.u, step.v, -1));
          const spot = at(step.u, step.v, 0);
          if (getId(spot) === "minecraft:air") {
            if (["minecraft:grass_block", "minecraft:dirt", "minecraft:podzol", "minecraft:moss_block"].includes(ground)) {
              set(spot, blocks.decor(step.decor));
            } else if (ground.includes("sand") && step.decor !== "bush" && Math.random() < 0.5) {
              set(spot, blocks.get("deadbush"));
            }
          }
        } else {
          set(at(step.u, step.v, step.y), blocks.get(step.b, step.d));
          if (step.b === "sign") writeSign(dim, at(step.u, step.v, step.y), plan.style.sign);
        }
        if (++count % 250 === 0) yield;
      }

      fillGiftChests(dim, steps, at, plan.style);
      hangPaintings(dim, paintings, at, worldDir, placeDecor);
      try {
        player.onScreenDisplay.setActionBar(plan.style.town ? `§bWelcome to the ${plan.style.name}!` : `§bWelcome home! §f${plan.style.name}, ${floors}`);
      } catch {}
      player.sendMessage(`§bYour ${plan.style.name} is ready! §fGo explore every room!`);
      playSound("random.levelup", player.location, 1);
      resolve();
    }

    system.runJob(job());
  });
}

// =====================================================================
// THE CONSTRUCTION WORKER: the Builder's Blueprint calls a builder who
// puts the house up one block at a time. Each build is remembered with
// its house (seed, style, where it is, how far along), so it carries on
// after the world is closed and opened again.
// =====================================================================
const BUILDER_ITEM = "house:builder_blueprint";
const BUILDER = "house:builder";
// One list of names per look (keep the looks in sync with LOOKS in tools/make_builder.py).
const BUILDER_LOOKS = [
  ["Benny", "Hank", "Gus", "Walt"],
  ["Rosie", "Maria", "Tess", "Lena"],
  ["Marcus", "Theo", "Andre", "Sam"],
  ["Ruby", "Penny", "Ivy", "Kate"],
];
const ACTS = ["stand", "walk", "hammer", "wave", "cheer"];
const BUILDER_DIMS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
const sites = new Map(); // house id -> the build going on there
let sitesLoaded = false;
const siteTag = (id) => `house_site_${id.replace(/[^A-Za-z0-9_]/g, "_")}`;

function startBuilder(player, styleIndex) {
  return new Promise((resolve) => {
    const seed = Math.floor(Math.random() * 2147483647);
    const fp = framePlan(seed, styleIndex);
    if (!fp) {
      player.sendMessage("§cThe blueprint got crumpled! Try again.");
      resolve();
      return;
    }
    const o = orient(player);
    const ctx = worldCtx(player.dimension, o, fp.plan);
    system.runJob((function* () {
      try {
        if (!(yield* siteIsClear(ctx, player))) return;
        const look = Math.floor(Math.random() * BUILDER_LOOKS.length);
        const name = pick(BUILDER_LOOKS[look]);
        const house = recordHouse(ctx, {
          build: { seed, style: styleIndex, o, owner: player.id, name, look, speed: 1, idx: 0, prep: false },
        });
        openSite(house, fp, player);
      } finally {
        resolve();
      }
    })());
  });
}

// Starts (or picks back up) the build at a house.
function openSite(house, fp, greet) {
  const b = house.build;
  let dim;
  try { dim = world.getDimension(house.dim); } catch { return; }
  if (!fp && STYLES[b.style]) {
    try { fp = framePlan(b.seed, b.style); } catch {}
  }
  if (!fp) {
    // Can't work out the plan any more (the add-on changed): the half-built house just stays.
    updateBuild(house.id, () => null);
    return;
  }
  const ctx = worldCtx(dim, b.o, fp.plan);
  const center = ctx.at(Math.floor(fp.plan.BW / 2), Math.floor(fp.plan.BD / 2), 0);
  sites.set(house.id, {
    id: house.id, b, ctx, fp, center, tag: siteTag(house.id), e: null, pos: null, stand: null,
    phase: b.prep ? "work" : "arrive", timer: 0, prepGen: null, unsaved: 0, nudgeAt: 0, near: false, nearCheck: 0,
    act: "", greet,
  });
}

// Changes the remembered build for a house (fn returns the new build, or null when it's over).
function updateBuild(id, fn) {
  const houses = getHouses();
  const h = houses.find((x) => x.id === id);
  if (!h || !h.build) return;
  const next = fn(h.build);
  if (next) h.build = next;
  else delete h.build;
  saveHouses(houses);
}

function saveProgress(site) {
  site.unsaved = 0;
  updateBuild(site.id, () => site.b);
}

const tileCenter = (ctx, s) => {
  const p = ctx.at(s.u, s.v, s.y);
  return { x: p.x + 0.5, y: p.y, z: p.z + 0.5 };
};

function setAct(site, act) {
  if (site.act === act) return;
  site.act = act;
  try { site.e.triggerEvent(`builder:${act}`); } catch {}
}

function moveBuilder(site, to, face) {
  site.pos = to;
  const dx = face.x - to.x, dz = face.z - to.z;
  const yaw = dx || dz ? Math.round((Math.atan2(-dx, dz) * 180) / Math.PI) : undefined;
  const k = `${to.x.toFixed(3)},${to.y.toFixed(3)},${to.z.toFixed(3)},${yaw}`;
  if (k === site.lastMove) return; // already there, already facing that way
  site.lastMove = k;
  try { site.e.teleport(to, yaw === undefined ? undefined : { rotation: { x: 0, y: yaw } }); } catch {}
}

// Walks toward a spot. Returns true once there.
function walkTo(site, to) {
  const p = site.pos;
  const dx = to.x - p.x, dy = to.y - p.y, dz = to.z - p.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.02) return true;
  const step = Math.min(dist, BUILDER_SPEEDS[site.b.speed]?.walk ?? 0.28);
  setAct(site, "walk");
  moveBuilder(site, { x: p.x + (dx / dist) * step, y: p.y + (dy / dist) * step, z: p.z + (dz / dist) * step },
    { x: to.x + dx, z: to.z + dz });
  return false;
}

function faceToward(site, loc) {
  moveBuilder(site, site.pos, { x: loc.x + 0.5, z: loc.z + 0.5 });
}

function puff(dim, loc, n = 8) {
  for (let i = 0; i < n; i++) {
    try {
      dim.spawnParticle("minecraft:basic_smoke_particle", {
        x: loc.x + (Math.random() - 0.5) * 1.2, y: loc.y + 0.3 + Math.random() * 1.6, z: loc.z + (Math.random() - 0.5) * 1.2,
      });
    } catch {}
  }
}

// Finds this site's builder (it may have been saved with the world), or brings one in.
function ensureBuilder(site, spawnAt) {
  try {
    if (site.e && site.e.isValid()) return true;
  } catch {}
  site.e = null;
  const { dim } = site.ctx;
  let found = [];
  try { found = dim.getEntities({ type: BUILDER, tags: [site.tag] }); } catch {}
  if (found.length) {
    site.e = found[0];
    for (const extra of found.slice(1)) try { extra.remove(); } catch {}
    const l = site.e.location;
    site.pos = { x: l.x, y: l.y, z: l.z };
    site.act = "";
    site.lastMove = "";
    return true;
  }
  const where = spawnAt || (site.stand ? tileCenter(site.ctx, site.stand) : tileCenter(site.ctx, { u: site.fp.plan.door.u + 2, v: -GAP, y: 0 }));
  try {
    if (!dim.getBlock(where)) return false;
    const e = dim.spawnEntity(BUILDER, where);
    e.addTag(site.tag);
    try { e.triggerEvent(`builder:look_${site.b.look}`); } catch {}
    try { e.nameTag = site.b.name; } catch {}
    site.e = e;
    site.pos = { ...where };
    site.act = "";
    site.lastMove = "";
    puff(dim, where);
    playSound("random.pop", where, 1);
    return true;
  } catch {
    return false;
  }
}

const dimOf = (p) => { try { return p.dimension.id; } catch { return ""; } };

function someoneNear(site) {
  const c = site.center;
  return world.getAllPlayers().some((p) => dimOf(p) === site.ctx.dim.id
    && Math.hypot(p.location.x - c.x, p.location.z - c.z) < 96);
}

// A player standing right where a block needs to go.
function playerIn(site, loc) {
  return world.getAllPlayers().find((p) => dimOf(p) === site.ctx.dim.id
    && Math.abs(p.location.x - (loc.x + 0.5)) < 0.8 && Math.abs(p.location.z - (loc.z + 0.5)) < 0.8
    && p.location.y < loc.y + 1 && p.location.y + 1.8 > loc.y);
}

// Every block the style uses, so the builder knows which blocks are his own work.
function styleBlocks(style) {
  const ids = new Set(["minecraft:oak_fence", "minecraft:fence", "minecraft:oak_stairs"]);
  const add = (x) => {
    if (typeof x === "string" && x.startsWith("minecraft:")) ids.add(x);
    else if (Array.isArray(x)) x.forEach(add);
    else if (x && typeof x === "object") Object.values(x).forEach(add);
  };
  add(style);
  return ids;
}

function placeSound(id) {
  if (/plank|log|wood|door|fence|stairs|shelf|stem|bamboo|cherry|crimson|warped/.test(id) && !/stone|brick|quartz|sandstone|purpur|prismarine/.test(id)) return "dig.wood";
  if (/wool/.test(id)) return "dig.cloth";
  if (/snow/.test(id)) return "dig.snow";
  if (/sand(?!stone)|gravel/.test(id)) return "dig.sand";
  if (/moss|grass|mushroom/.test(id)) return "dig.grass";
  return "dig.stone";
}

// Puts one task in place. Returns false if it has to wait (someone's standing there).
function placeTask(site, t) {
  const { ctx } = site;
  if (t.frontPath) {
    buildFrontPath(ctx, t.u);
    playSound("dig.gravel", ctx.at(t.u, -2, 0), 1);
    return true;
  }
  const loc = ctx.at(t.u, t.v, t.y);
  if (playerIn(site, loc) || (t.door && playerIn(site, ctx.at(t.u, t.v, t.y + 1)))) {
    const now = system.currentTick;
    if (now > site.nudgeAt) {
      site.nudgeAt = now + 100;
      const p = playerIn(site, loc) || playerIn(site, ctx.at(t.u, t.v, t.y + 1));
      try { p.onScreenDisplay.setActionBar(`§e${site.b.name} needs to put a block where you're standing!`); } catch {}
    }
    return false;
  }
  const pieces = t.door
    ? [[loc, ctx.blocks.get("door_lower", t.d)], [ctx.at(t.u, t.v, t.y + 1), ctx.blocks.get("door_upper", t.d)]]
    : [[loc, ctx.blocks.get(t.b, t.d)]];
  site.ours = site.ours || styleBlocks(site.fp.plan.style);
  for (const [l, perm] of pieces) {
    if (!perm) continue;
    const id = ctx.getId(l);
    // Leave anything someone else put here in the meantime.
    if (id !== "minecraft:air" && !site.ours.has(id) && PROTECTED.some((w) => id.includes(w))) continue;
    ctx.set(l, perm);
  }
  if (t.b === "sign") writeSign(ctx.dim, loc, site.fp.plan.style.sign);
  const placed = pieces[0][1];
  if (placed) {
    try {
      world.playSound(placeSound(placed.type.id), loc, { volume: 0.6, pitch: 0.9 + Math.random() * 0.2 });
    } catch {}
  }
  return true;
}

// One tick of work at a build site.
function stepSite(site) {
  if (--site.nearCheck <= 0) {
    site.nearCheck = 20;
    site.near = someoneNear(site);
  }
  if (!site.near) return; // nobody around: the land isn't loaded, so the builder waits
  const { ctx, fp, b } = site;
  const plan = fp.plan;
  const speed = BUILDER_SPEEDS[b.speed] || BUILDER_SPEEDS[1];

  if (site.phase === "arrive") {
    let spawnAt;
    if (site.greet) {
      try {
        const l = site.greet.location;
        const side = ctx.at(plan.door.u + 2, -GAP, 0);
        spawnAt = { x: side.x + 0.5, y: Math.floor(l.y), z: side.z + 0.5 };
      } catch {}
    }
    if (!ensureBuilder(site, spawnAt)) return;
    if (site.timer === 0) {
      setAct(site, "wave");
      let look = ctx.at(plan.door.u, -GAP, 0);
      try { if (site.greet) look = site.greet.location; } catch {}
      faceToward(site, look);
      if (site.greet) {
        try {
          site.greet.onScreenDisplay.setActionBar(`§eMeet ${b.name} the builder!`);
          site.greet.sendMessage(`§e${b.name} §fwill build the walls, floors and roof. Then it's your turn to decorate! `
            + `Tap ${b.name} to make the building go faster or slower.`);
        } catch {}
      }
    }
    if (++site.timer < 50) return;
    site.timer = 0;
    site.phase = "prep";
    return;
  }
  if (!ensureBuilder(site)) return;

  if (site.phase === "prep") {
    // Clearing the land and laying the foundation: quick, while the builder hammers away out front.
    if (!site.prepGen) {
      site.prepGen = (function* () {
        for (const st of fp.prep) {
          if (st.clear) yield* clearArea(ctx, st.clear);
          else fillFoundation(ctx, st.u, st.v);
        }
      })();
      setAct(site, "hammer");
      faceToward(site, ctx.at(plan.door.u, Math.floor(plan.BD / 2), 0));
    }
    if (++site.timer % 4 === 0) {
      const spot = ctx.at(Math.floor(Math.random() * plan.BW), Math.floor(Math.random() * plan.BD), 0);
      playSound("dig.grass", spot, 0.8 + Math.random() * 0.4);
      puff(ctx.dim, spot, 3);
    }
    for (let i = 0; i < 3; i++) {
      if (site.prepGen.next().done) {
        site.prepGen = null;
        site.timer = 0;
        b.prep = true;
        saveProgress(site);
        site.phase = "work";
        return;
      }
    }
    return;
  }

  if (site.phase === "work") {
    const t = fp.tasks[b.idx];
    if (!t) {
      site.phase = "finish";
      site.timer = 0;
      saveProgress(site);
      return;
    }
    const stand = standSpot(plan, t, site.stand);
    const cur = site.stand;
    if (!cur || stand.u !== cur.u || stand.v !== cur.v || stand.y !== cur.y) {
      if (!walkTo(site, tileCenter(ctx, stand))) return;
      site.stand = stand;
      site.timer = 0;
    }
    const loc = ctx.at(t.u, t.v, t.y);
    if (ctx.getId(loc) === "unloaded") return;
    setAct(site, "hammer");
    faceToward(site, loc);
    if (++site.timer < speed.every) return;
    if (!placeTask(site, t)) return;
    site.timer = 0;
    b.idx++;
    if (++site.unsaved >= 20) saveProgress(site);
    return;
  }

  if (site.phase === "finish") {
    // Out front to admire the house, a cheer, a wave, and off home.
    const spot = tileCenter(ctx, { u: plan.door.u + 1, v: -2, y: ctx.groundAt(plan.door.u + 1, -2) + 1 });
    if (site.timer === 0 && !walkTo(site, spot)) return;
    site.timer++;
    if (site.timer === 1) {
      setAct(site, "cheer");
      faceToward(site, ctx.at(plan.door.u, 2, 2));
      playSound("random.levelup", spot, 1);
      const owner = world.getAllPlayers().find((p) => p.id === b.owner);
      for (const p of world.getAllPlayers()) {
        if (dimOf(p) !== ctx.dim.id || Math.hypot(p.location.x - site.center.x, p.location.z - site.center.z) > 64) continue;
        try { p.onScreenDisplay.setActionBar("§eAll done! Time to decorate!"); } catch {}
      }
      if (owner) try { owner.sendMessage(`§e${b.name} §ffinished your ${plan.style.name}. Now make it yours!`); } catch {}
    }
    if (site.timer === 60) {
      setAct(site, "wave");
      const owner = world.getAllPlayers().find((p) => p.id === b.owner);
      if (owner && dimOf(owner) === ctx.dim.id) faceToward(site, owner.location);
    }
    if (site.timer >= 100) endSite(site);
  }
}

// The builder packs up and goes home (whether or not the house is finished).
function endSite(site) {
  sites.delete(site.id);
  updateBuild(site.id, () => null);
  try {
    if (site.e && site.e.isValid()) {
      puff(site.ctx.dim, site.e.location, 12);
      playSound("random.pop", site.e.location, 0.8);
      site.e.remove();
    }
  } catch {}
}

system.runInterval(() => {
  if (!sitesLoaded) {
    sitesLoaded = true;
    for (const h of getHouses()) if (h.build && !sites.has(h.id)) openSite(h);
  }
  for (const site of sites.values()) {
    try {
      stepSite(site);
    } catch (e) {
      console.warn(`[House] Builder trouble: ${e}`);
    }
  }
}, 1);

// Tidy up any builder whose house is gone.
system.runInterval(() => {
  if (!sitesLoaded) return;
  const tags = new Set([...sites.values()].map((s) => s.tag));
  for (const d of BUILDER_DIMS) {
    try {
      for (const e of world.getDimension(d).getEntities({ type: BUILDER })) {
        if (!e.getTags().some((t) => tags.has(t))) e.remove();
      }
    } catch {}
  }
}, 200);

// ---------- Tapping the builder: how fast, or stop ----------
const builderMenuOpen = new Set();
try {
  world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    if (event.target?.typeId !== BUILDER) return;
    event.cancel = true;
    const { target, player } = event;
    system.run(() => builderMenu(player, target));
  });
} catch {}

async function builderMenu(player, target) {
  if (builderMenuOpen.has(player.id)) return;
  const site = [...sites.values()].find((s) => s.e && s.e.id === target.id);
  if (!site) return;
  builderMenuOpen.add(player.id);
  try {
    const form = new ActionFormData().title(site.b.name).body("How fast should I build?");
    BUILDER_SPEEDS.forEach((s, i) => form.button(i === site.b.speed ? `§2> ${s.name} <` : s.name));
    form.button("§cStop building");
    const res = await form.show(player);
    if (res.canceled || res.selection === undefined || !sites.has(site.id)) return;
    if (res.selection < BUILDER_SPEEDS.length) {
      site.b.speed = res.selection;
      saveProgress(site);
      return;
    }
    const sure = await new ActionFormData()
      .title("Stop building?")
      .body(`${site.b.name} will go home and the house will stay half-built.\n\n`
        + "You can take it away with the blueprint, then build a new one.")
      .button("§cYes, stop")
      .button("Keep building")
      .show(player);
    if (!sure.canceled && sure.selection === 0 && sites.has(site.id)) endSite(site);
  } catch {
  } finally {
    builderMenuOpen.delete(player.id);
  }
}

// ---------- Remembering houses, and removing them ----------
function getHouses() {
  try {
    const raw = world.getDynamicProperty("house:houses");
    if (typeof raw === "string") return JSON.parse(raw);
  } catch {}
  return [];
}

function saveHouses(list) {
  try {
    world.setDynamicProperty("house:houses", JSON.stringify(list.slice(-60)));
  } catch {}
}

const inside = (h, l, pad = 0) => l.x >= h.min.x - pad && l.x <= h.max.x + 1 + pad && l.z >= h.min.z - pad
  && l.z <= h.max.z + 1 + pad && l.y >= h.min.y - 2 && l.y <= h.max.y + 2;

// The house you're standing in or right next to (built with this blueprint).
function houseNear(player) {
  const p = player.location, dimId = player.dimension.id;
  const center = (h) => ({ x: (h.min.x + h.max.x) / 2, z: (h.min.z + h.max.z) / 2 });
  return getHouses()
    .filter((h) => h.dim === dimId && inside(h, p, 3))
    .sort((a, b) => Math.hypot(center(a).x - p.x, center(a).z - p.z) - Math.hypot(center(b).x - p.x, center(b).z - p.z))[0];
}

const CONTAINERS = ["chest", "barrel", "shulker_box", "furnace", "smoker", "hopper", "dispenser", "dropper"];

function removeHouse(player, house) {
  return new Promise((resolve) => {
    let dim;
    try {
      dim = world.getDimension(house.dim);
    } catch {
      resolve();
      return;
    }
    const { min, stand } = house;
    // Houses saved by 1.6.1 and older could reach below the bottom of a flat world (that part was never
    // there to reach, so it made the house look "too far away"). Only look inside the world.
    const lim = heightLimits(dim);
    const lo = Math.max(min.y, lim.lo);
    const max = { ...house.max, y: Math.min(house.max.y, lim.hi) };
    const building = sites.get(house.id);
    if (building) endSite(building);

    function* job() {
      // The whole house has to be close enough to reach.
      for (const c of [{ ...min, y: lo }, max, { x: min.x, y: lo, z: max.z }, { x: max.x, y: lo, z: min.z }]) {
        let ok = false;
        try { ok = !!dim.getBlock(c); } catch {}
        if (!ok) {
          player.sendMessage("§cPart of the house is too far away. Stand right next to it and try again.");
          resolve();
          return;
        }
      }

      // Move everyone out front so nobody falls when the floors disappear.
      for (const p of world.getAllPlayers()) {
        if (p.dimension.id === house.dim && inside(house, p.location)) {
          try { p.teleport({ x: stand.x + 0.5, y: stand.y, z: stand.z + 0.5 }); } catch {}
        }
      }

      // Rescue everything in chests, barrels, and furnaces.
      const rescued = [];
      for (let x = min.x; x <= max.x; x++) {
        for (let y = lo; y <= max.y; y++) {
          for (let z = min.z; z <= max.z; z++) {
            let block;
            try { block = dim.getBlock({ x, y, z }); } catch {}
            if (!block || block.typeId.includes("ender") || !CONTAINERS.some((c) => block.typeId.includes(c))) continue;
            try {
              const box = block.getComponent("minecraft:inventory")?.container;
              if (!box) continue;
              for (let i = 0; i < box.size; i++) {
                const item = box.getItem(i);
                if (item) { rescued.push(item); box.setItem(i, undefined); }
              }
            } catch {}
          }
        }
        yield;
      }

      // Poof! Put the land back the way it was.
      for (let i = 0; i < 12; i++) {
        try {
          dim.spawnParticle("minecraft:huge_explosion_emitter", {
            x: min.x + Math.random() * (max.x - min.x), y: stand.y + 2 + Math.random() * 8, z: min.z + Math.random() * (max.z - min.z),
          });
        } catch {}
      }
      playSound("random.pop", player.location, 0.6);
      let restored = false;
      if (house.saved) {
        try {
          world.structureManager.place(house.id, dim, min, { animationMode: "Layers", animationSeconds: 2 });
          restored = true;
        } catch {
          try {
            world.structureManager.place(house.id, dim, min);
            restored = true;
          } catch (e) {
            console.warn(`[House] Couldn't put the land back: ${e}`);
          }
        }
      }
      if (!restored) {
        // No snapshot: clear everything above the ground and cover the ground with grass.
        const air = BlockPermutation.resolve("minecraft:air");
        const grass = BlockPermutation.resolve("minecraft:grass_block");
        for (let x = min.x; x <= max.x; x++) {
          for (let z = min.z; z <= max.z; z++) {
            for (let y = stand.y; y <= max.y; y++) {
              try { dim.getBlock({ x, y, z })?.setPermutation(air); } catch {}
            }
            try { dim.getBlock({ x, y: stand.y - 1, z })?.setPermutation(grass); } catch {}
          }
          yield;
        }
      }

      saveHouses(getHouses().filter((h) => h.id !== house.id));
      system.runTimeout(() => {
        if (restored) {
          try { world.structureManager.delete(house.id); } catch {}
        }
        for (const item of rescued) {
          try { dim.spawnItem(item, { x: stand.x + 0.5, y: stand.y + 0.5, z: stand.z + 0.5 }); } catch {}
        }
        player.sendMessage(rescued.length
          ? "§bThe house is gone! §fEverything from its chests is right here in front of you."
          : "§bThe house is gone, and the land is back to how it was!");
        resolve();
      }, restored ? 60 : 5);
    }

    system.runJob(job());
  });
}

// The lowest and highest block you can build at in a dimension.
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

// Finds the right block for each name, with backups for older versions.
function makeBlockResolver(style, worldDir) {
  const cache = new Map();
  const tryResolve = (ids, stateOptions = [undefined]) => {
    for (const id of ids) {
      // Mushroom blocks need the "cap on every side" setting to look right.
      const options = id.includes("mushroom_block") && stateOptions.length === 1 && stateOptions[0] === undefined
        ? [{ huge_mushroom_bits: 14 }, undefined] : stateOptions;
      for (const states of options) {
        try {
          return BlockPermutation.resolve(id, states);
        } catch {}
      }
    }
    return undefined;
  };
  const fixed = {
    furnace: ["minecraft:furnace"], smoker: ["minecraft:smoker", "minecraft:furnace"],
    crafting_table: ["minecraft:crafting_table"], cauldron: ["minecraft:cauldron"],
    barrel: ["minecraft:barrel", "minecraft:chest"], chest: ["minecraft:chest"], gift_chest: ["minecraft:chest"],
    bookshelf: ["minecraft:bookshelf"], jukebox: ["minecraft:jukebox"],
    noteblock: ["minecraft:noteblock", "minecraft:note_block"], cake: ["minecraft:cake"],
    fence: ["minecraft:oak_fence", "minecraft:fence"],
    plate: ["minecraft:wooden_pressure_plate", "minecraft:oak_pressure_plate"],
    path: ["minecraft:grass_path", "minecraft:dirt_path"],
    lantern: ["minecraft:lantern", "minecraft:torch"],
    planter: ["minecraft:grass_block"],
    amethyst_cluster: ["minecraft:amethyst_cluster", "minecraft:amethyst_block"],
    deadbush: ["minecraft:deadbush", "minecraft:dead_bush"],
    food_barrel: ["minecraft:barrel", "minecraft:chest"], food_chest: ["minecraft:chest"],
    desk: ["minecraft:cartography_table", "minecraft:crafting_table"],
    counter: ["minecraft:polished_andesite", "minecraft:stone"],
    brewing_stand: ["minecraft:brewing_stand"],
    truck_glass: ["minecraft:light_blue_stained_glass", "minecraft:glass"],
  };
  const legacyDoor = { east: 0, south: 1, west: 2, north: 3 };
  const legacyBed = { south: 0, west: 1, north: 2, east: 3 };
  const weirdo = { east: 0, west: 1, south: 2, north: 3 };

  return {
    get(name, d) {
      if (name === "flowerRandom") return this.flower();
      const cacheKey = `${name}|${d || ""}`;
      if (cache.has(cacheKey)) return cache.get(cacheKey);
      let perm;
      if (name === "door_lower" || name === "door_upper") {
        // Turned a quarter turn from the wall's facing so the closed door sits flat in the doorway.
        const side = worldDir(d === "+v" ? "+u" : d === "-v" ? "-u" : d === "+u" ? "+v" : "-v");
        const up = name === "door_upper";
        perm = tryResolve(style.door, [
          { "minecraft:cardinal_direction": side, upper_block_bit: up, open_bit: false },
          { "minecraft:cardinal_direction": side, upper_block_bit: up },
          { direction: legacyDoor[side], upper_block_bit: up, open_bit: false },
          { direction: legacyDoor[side], upper_block_bit: up },
          { upper_block_bit: up },
        ]);
      } else if (name.startsWith("bed_head") || name.startsWith("bed_foot")) {
        const dir = worldDir(d), head = name.startsWith("bed_head");
        perm = tryResolve(["minecraft:bed"], [
          { direction: legacyBed[dir], head_piece_bit: head },
          { "minecraft:cardinal_direction": dir, head_piece_bit: head },
        ]);
      } else if (name.startsWith("carpet:")) {
        perm = tryResolve([`minecraft:${name.slice(7)}_carpet`, "minecraft:white_carpet"]);
      } else if (name.startsWith("roofStripe")) {
        perm = tryResolve(style.roofStripes[Number(name.slice(10))] || style.roof);
      } else if (name.startsWith("roofLayer")) {
        perm = tryResolve(style.roofLayers[Number(name.slice(9))] || style.roof);
      } else if (name === "roofSpot") {
        perm = tryResolve(style.roofSpots.block) || tryResolve(style.roof);
      } else if ((name === "wall" || name === "gable") && d && style.logWalls) {
        const dir = worldDir(d);
        const axis = dir === "east" || dir === "west" ? "x" : "z";
        perm = tryResolve(style[name], [{ pillar_axis: axis }, undefined]);
      } else if (name === "base") {
        perm = tryResolve(style.baseCourse);
      } else if (name === "campfire") {
        perm = tryResolve(["minecraft:campfire", "minecraft:magma"]);
      } else if (name === "lava_cauldron") {
        perm = tryResolve(["minecraft:cauldron"], [{ cauldron_liquid: "lava", fill_level: 6 }])
          || tryResolve(["minecraft:lava_cauldron"])
          || tryResolve(["minecraft:magma"]);
      } else if (name === "hanging_lantern") {
        perm = tryResolve(style.lantern || ["minecraft:lantern"], [{ hanging: true }, undefined])
          || tryResolve(["minecraft:torch"]);
      } else if (name.startsWith("minecraft:")) {
        perm = tryResolve([name]);
      } else if (name === "seat") {
        perm = this.get("stair", d);
      } else if (name === "lectern") {
        const dir = worldDir(d);
        perm = tryResolve(["minecraft:lectern"], [{ "minecraft:cardinal_direction": dir }, { direction: legacyBed[dir] }, undefined]);
      } else if (name === "bell") {
        perm = tryResolve(["minecraft:bell"], [{ attachment: "standing", direction: 0 }, { attachment: "standing" }, undefined]);
      } else if (name === "water_cauldron") {
        perm = tryResolve(["minecraft:cauldron"], [{ cauldron_liquid: "water", fill_level: 6 }, undefined]);
      } else if (name === "sign") {
        const facing = { east: 5, west: 4, south: 3, north: 2 }[worldDir(d)];
        perm = tryResolve(["minecraft:spruce_wall_sign", "minecraft:wall_sign"], [{ facing_direction: facing }, undefined]);
      } else if (name === "step") {
        perm = tryResolve(style.floor);
      } else if (name === "shelf") {
        const woods = [...style.floor, ...style.iwall].filter((id) => id.endsWith("_planks")).map((id) => id.replace("_planks", "_shelf"));
        perm = tryResolve([...woods, "minecraft:oak_shelf"], [{ "minecraft:cardinal_direction": worldDir(d) }, undefined])
          || tryResolve(["minecraft:bookshelf"]);
      } else if (name === "stair") {
        const dir = worldDir(d);
        const ids = [
          ...(style.stairs || []),
          ...style.floor.filter((id) => id.endsWith("_planks")).map((id) => id.replace("_planks", "_stairs")),
          "minecraft:oak_stairs",
        ];
        perm = tryResolve(ids, [
          { weirdo_direction: weirdo[dir], upside_down_bit: false },
          { "minecraft:cardinal_direction": dir, upside_down_bit: false },
        ]) || tryResolve(style.floor);
      } else if (name.startsWith("wallBand")) {
        perm = tryResolve(style.wallBands[Number(name.slice(8))] || style.wall);
      } else if (name === "roofSlab") {
        perm = tryResolve(style.roofSlab || [], [undefined]) || tryResolve(style.roof);
      } else if (name === "parapet") {
        perm = tryResolve(style.parapet || style.wall);
      } else if (style[name]) {
        perm = tryResolve(style[name]);
      } else if (fixed[name]) {
        perm = tryResolve(fixed[name]);
      }
      cache.set(cacheKey, perm);
      return perm;
    },
    flower() {
      return tryResolve([pick(FLOWERS), "minecraft:poppy"]);
    },
    tryResolve,
    decor(kind) {
      if (kind === "flower") return this.flower();
      if (kind === "bush") {
        const leaf = pick(["minecraft:oak_leaves", "minecraft:azalea_leaves", "minecraft:azalea_leaves_flowered"]);
        // Persistent leaves, so the bushes don't fall apart like tree leaves.
        return tryResolve([leaf, "minecraft:oak_leaves"], [{ persistent_bit: true }]) || tryResolve(["minecraft:moss_block"]);
      }
      return tryResolve([pick(["minecraft:flowering_azalea", "minecraft:azalea", "minecraft:fern", "minecraft:short_grass"]),
        "minecraft:fern", "minecraft:tallgrass"]);
    },
  };
}

function hangPaintings(dim, list, at, worldDir, placeDecor) {
  const hung = [];
  for (const step of list) {
    const loc = at(step.u, step.v, step.y);
    const center = { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 };
    let painting;
    try {
      painting = dim.spawnEntity("minecraft:painting", center);
    } catch {}
    if (painting) hung.push({ painting, center, step });
    else placeDecor({ ...step, b: `frame:${pick(FRAME_ITEMS)}` });
  }
  if (!hung.length) return;
  system.runTimeout(() => {
    for (const { painting, center, step } of hung) {
      let ok = false;
      try { ok = painting.isValid(); } catch {}
      if (ok) continue;
      // It fell off: pick up the loose painting and put a frame there instead.
      try {
        for (const e of dim.getEntities({ type: "minecraft:item", location: center, maxDistance: 2 })) {
          if (e.getComponent("minecraft:item")?.itemStack?.typeId === "minecraft:painting") e.remove();
        }
      } catch {}
      placeDecor({ ...step, b: `frame:${pick(FRAME_ITEMS)}` });
    }
  }, 10);
}

// Food for the grocery store's barrels and storeroom chests.
const GROCERIES = [
  ["minecraft:apple", 6], ["minecraft:bread", 4], ["minecraft:carrot", 8], ["minecraft:baked_potato", 6],
  ["minecraft:cookie", 8], ["minecraft:melon_slice", 8], ["minecraft:pumpkin_pie", 3], ["minecraft:sweet_berries", 8],
  ["minecraft:cooked_chicken", 3], ["minecraft:cooked_salmon", 3], ["minecraft:honey_bottle", 2], ["minecraft:beetroot", 6],
  ["minecraft:egg", 6], ["minecraft:sugar", 6], ["minecraft:golden_carrot", 2], ["minecraft:cake", 1],
];

// Writes a building's name on its sign (again a moment later, in case the sign wasn't ready yet).
function writeSign(dim, loc, text) {
  const write = () => {
    try {
      const sign = dim.getBlock(loc)?.getComponent("minecraft:sign");
      if (!sign) return;
      sign.setText(text);
      try { sign.setWaxed(true); } catch {} // so nobody edits it by accident
    } catch {}
  };
  write();
  system.runTimeout(write, 2);
}

function fillGiftChests(dim, steps, at, style) {
  for (const step of steps) {
    const food = step.b === "food_barrel" || step.b === "food_chest";
    if (step.b !== "gift_chest" && !food) continue;
    try {
      const container = dim.getBlock(at(step.u, step.v, step.y))?.getComponent("minecraft:inventory")?.container;
      if (!container) continue;
      const gifts = food ? shuffle(GROCERIES.slice()).slice(0, step.b === "food_chest" ? 5 : 2)
        : [["minecraft:cookie", 8], ["minecraft:torch", 16], [pick(FLOWERS), 3], ["minecraft:cake", 1], ...(style.gifts || [])];
      for (const [id, n] of gifts) {
        try {
          container.addItem(new ItemStack(id, n));
        } catch {}
      }
    } catch {}
  }
}

function playSound(id, location, pitch) {
  try {
    world.playSound(id, location, { pitch, volume: 1 });
  } catch {}
}
