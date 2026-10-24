// Pip's Quests: ring the Quest Bell to call Pip, a friendly villager who
// gives simple "bring me..." jobs. Finish one to win a prize and a badge.
// Team quests let nearby players work together and share the reward.
import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const BELL_ID = "quest:quest_bell";
const PIP_TAG = "quest_keeper";
const PIP_NAME = "§ePip the Quest Keeper";
const TEAM_RANGE = 48; // how close another player must be to join a team quest

const FLOWERS = [
  "dandelion", "poppy", "blue_orchid", "allium", "azure_bluet", "red_tulip",
  "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy", "cornflower",
  "lily_of_the_valley", "sunflower", "lilac", "rose_bush", "peony",
  "torchflower", "pink_petals", "wither_rose",
].map((f) => `minecraft:${f}`);

// Things Pip can ask for.
const T = {
  logs: { thing: "wood logs", match: (id) => id.endsWith("_log") || id.endsWith("_stem") },
  flowers: { thing: "flowers", match: (id) => FLOWERS.includes(id) },
  wool: { thing: "wool", match: (id) => id.endsWith("_wool") },
  cobble: { thing: "cobblestone", match: (id) => id === "minecraft:cobblestone" },
  eggs: { thing: "eggs", match: (id) => id === "minecraft:egg" },
  wheat: { thing: "wheat", match: (id) => id === "minecraft:wheat" },
  carrots: { thing: "carrots", match: (id) => id === "minecraft:carrot" },
  sand: { thing: "sand", match: (id) => id === "minecraft:sand" || id === "minecraft:red_sand" },
  pumpkins: { thing: "pumpkins", match: (id) => id === "minecraft:pumpkin" || id === "minecraft:carved_pumpkin" },
  apples: { thing: "apples", match: (id) => id === "minecraft:apple" },
  coal: { thing: "coal", match: (id) => id === "minecraft:coal" || id === "minecraft:charcoal" },
  fish: { thing: "fish", match: (id) => id === "minecraft:cod" || id === "minecraft:salmon" },
  bread: { thing: "bread", match: (id) => id === "minecraft:bread" },
  torches: { thing: "torches", match: (id) => id === "minecraft:torch" },
  sugarcane: { thing: "sugar cane", match: (id) => id === "minecraft:sugar_cane" },
  iron: { thing: "iron ingots", match: (id) => id === "minecraft:iron_ingot" },
};
const need = (kind, count) => ({ ...T[kind], count });

// Solo quests (ids kept the same so saved progress carries over).
const QUESTS = [
  { id: "logs", badge: "Lumberjack", needs: [need("logs", 10)],
    story: "My fence fell down! Can you bring me 10 wood logs to fix it?" },
  { id: "flowers", badge: "Flower Friend", needs: [need("flowers", 5)],
    story: "It's my mom's birthday! Can you find me 5 flowers? Any kind!" },
  { id: "wool", badge: "Fluffy Collector", needs: [need("wool", 3)],
    story: "Brr, I'm cold! Can you bring me 3 wool to make a blanket? Sheep have wool!" },
  { id: "cobble", badge: "Rock Star", needs: [need("cobble", 16)],
    story: "I want to build a little stone hut. Can you bring me 16 cobblestone?" },
  { id: "eggs", badge: "Egg Hunter", needs: [need("eggs", 4)],
    story: "I'm baking a cake! Can you find 4 eggs? Chickens leave them around!" },
  { id: "wheat", badge: "Farmer", needs: [need("wheat", 5)],
    story: "My cows are hungry. Can you bring me 5 wheat? You can grow it from seeds!" },
  { id: "carrots", badge: "Bunny Buddy", needs: [need("carrots", 3)],
    story: "A bunny keeps visiting my house! Can you bring 3 carrots for it?" },
  { id: "sand", badge: "Beach Explorer", needs: [need("sand", 10)],
    story: "I want to build a sandcastle! Can you bring me 10 sand from a beach or desert?" },
  { id: "pumpkin", badge: "Pumpkin Picker", needs: [need("pumpkins", 1)],
    story: "I want to carve a spooky face! Can you find me a pumpkin?" },
  { id: "apples", badge: "Apple Finder", needs: [need("apples", 2)],
    story: "I'm so hungry! Can you find 2 apples? Sometimes they fall from oak trees!" },
  { id: "coal", badge: "Miner", needs: [need("coal", 5)],
    story: "My furnace went out! Can you bring me 5 coal? Look for black spots in stone!" },
  { id: "fish", badge: "Fisher", needs: [need("fish", 2)],
    story: "My cat wants a snack! Can you catch 2 fish?" },
  { id: "bread", badge: "Baker", needs: [need("bread", 3)],
    story: "I'm having a picnic! Can you bring me 3 bread? You make it from wheat!" },
  { id: "torches", badge: "Light Bringer", needs: [need("torches", 8)],
    story: "It's so dark at night! Can you bring me 8 torches?" },
  { id: "sugarcane", badge: "Sweet Tooth", needs: [need("sugarcane", 5)],
    story: "I love sweets! Can you bring 5 sugar cane? It grows next to water!" },
  { id: "iron", badge: "Blacksmith", needs: [need("iron", 3)],
    story: "I want to make a shiny bucket. Can you bring me 3 iron ingots? Big job!" },
];

// Team quests: bigger jobs that need two (or more) helpers.
const TEAM_QUESTS = [
  { id: "team_treehouse", badge: "Treehouse Team", needs: [need("logs", 20), need("wool", 3)],
    story: "I want to build a treehouse! Can your team bring me 20 wood logs and 3 wool for a comfy bed?" },
  { id: "team_party", badge: "Party Planners", needs: [need("flowers", 8), need("bread", 4)],
    story: "Let's have a garden party! Can your team bring 8 flowers and 4 bread?" },
  { id: "team_farm", badge: "Farm Team", needs: [need("wheat", 10), need("carrots", 6)],
    story: "My farm animals are SO hungry! Can your team bring 10 wheat and 6 carrots?" },
  { id: "team_beach", badge: "Beach Buddies", needs: [need("sand", 20), need("fish", 3)],
    story: "Beach day! Can your team bring 20 sand for a sandcastle and 3 fish for lunch?" },
  { id: "team_lights", badge: "Light Crew", needs: [need("torches", 16), need("coal", 8)],
    story: "Monsters keep sneaking around at night! Can your team bring 16 torches and 8 coal?" },
  { id: "team_bake", badge: "Bake-Off Champs", needs: [need("eggs", 6), need("wheat", 6), need("sugarcane", 3)],
    story: "Let's bake the biggest cake ever! Can your team bring 6 eggs, 6 wheat, and 3 sugar cane?" },
  { id: "team_pumpkins", badge: "Jack-o'-Lantern Crew", needs: [need("pumpkins", 4), need("torches", 4)],
    story: "Let's make glowing pumpkins for Halloween! Can your team bring 4 pumpkins and 4 torches?" },
  { id: "team_castle", badge: "Castle Builders", needs: [need("cobble", 48), need("torches", 8)],
    story: "I'm building a castle! Can your team bring 48 cobblestone and 8 torches?" },
];

const ALL_QUESTS = [...QUESTS, ...TEAM_QUESTS];
const findQuest = (id) => ALL_QUESTS.find((q) => q.id === id);

// Prize bag. Higher weight = more common.
const PRIZES = [
  { id: "minecraft:emerald", count: [3, 6], weight: 5 },
  { id: "minecraft:gold_ingot", count: [2, 5], weight: 5 },
  { id: "flower", count: [3, 6], weight: 5 },
  { id: "minecraft:cookie", count: [4, 8], weight: 4 },
  { id: "minecraft:name_tag", count: [1, 1], weight: 3 },
  { id: "minecraft:diamond", count: [1, 3], weight: 3 },
  { id: "minecraft:wolf_spawn_egg", count: [1, 1], weight: 2 },
  { id: "minecraft:cake", count: [1, 1], weight: 2 },
  { id: "minecraft:golden_apple", count: [1, 2], weight: 2 },
  { id: "minecraft:firework_rocket", count: [3, 6], weight: 2 },
  { id: "pet", count: [1, 1], weight: 3 },
  { id: "disc", count: [1, 1], weight: 2 },
  { id: "minecraft:saddle", count: [1, 1], weight: 2 },
  { id: "minecraft:lead", count: [2, 2], weight: 2 },
  { id: "minecraft:spyglass", count: [1, 1], weight: 1 },
  // Super-rare jackpots!
  { id: "minecraft:elytra", count: [1, 1], weight: 0.4 },
  { id: "minecraft:enchanted_golden_apple", count: [1, 1], weight: 0.5 },
  { id: "minecraft:totem_of_undying", count: [1, 1], weight: 0.5 },
];

const PETS = [
  "minecraft:cat_spawn_egg", "minecraft:parrot_spawn_egg", "minecraft:fox_spawn_egg",
  "minecraft:panda_spawn_egg", "minecraft:rabbit_spawn_egg", "minecraft:axolotl_bucket",
];
const DISCS = ["cat", "blocks", "chirp", "mall", "mellohi", "far", "strad", "wait"]
  .map((d) => `minecraft:music_disc_${d}`);
const JACKPOTS = ["minecraft:elytra", "minecraft:enchanted_golden_apple", "minecraft:totem_of_undying"];
const pickFrom = (list) => list[Math.floor(Math.random() * list.length)];

const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

// Picks `howMany` different prizes from the bag.
function drawPrizes(howMany) {
  const bag = [...PRIZES];
  const picked = [];
  while (picked.length < howMany && bag.length) {
    const total = bag.reduce((sum, p) => sum + p.weight, 0);
    let roll = Math.random() * total;
    const i = bag.findIndex((p) => (roll -= p.weight) < 0);
    const prize = bag.splice(i < 0 ? 0 : i, 1)[0];
    const id = prize.id === "flower" ? pickFrom(FLOWERS.slice(0, 12))
      : prize.id === "pet" ? pickFrom(PETS)
      : prize.id === "disc" ? pickFrom(DISCS)
      : prize.id;
    picked.push([id, randInt(prize.count[0], prize.count[1])]);
  }
  return picked;
}

const lastShown = new Map(); // player id -> last progress text shown

// ---------- Saved progress ----------
function getData(player) {
  try {
    const raw = player.getDynamicProperty("quest:data");
    if (typeof raw === "string") return JSON.parse(raw);
  } catch {}
  return { active: null, badges: [], done: 0 };
}

function saveData(player, data) {
  try {
    player.setDynamicProperty("quest:data", JSON.stringify(data));
  } catch {}
}

// One team quest at a time, shared by its members. Saved on the world.
function getTeam() {
  try {
    const raw = world.getDynamicProperty("quest:team");
    if (typeof raw === "string") return JSON.parse(raw);
  } catch {}
  return null;
}

function saveTeam(team) {
  try {
    world.setDynamicProperty("quest:team", team ? JSON.stringify(team) : undefined);
  } catch {}
}

function teamFor(player) {
  const team = getTeam();
  return team && team.members.includes(player.id) ? team : null;
}

const onlineMembers = (team) => world.getAllPlayers().filter((p) => team.members.includes(p.id));

function nearbyPlayers(player) {
  return world.getAllPlayers().filter((p) => {
    if (p.id === player.id || p.dimension.id !== player.dimension.id) return false;
    const a = p.location, b = player.location;
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= TEAM_RANGE;
  });
}

// ---------- Give the bell on first join (no cheats needed) ----------
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      if (player.getDynamicProperty("quest:got_bell")) return;
      const inv = player.getComponent("minecraft:inventory").container;
      const leftover = inv.addItem(new ItemStack(BELL_ID, 1));
      if (leftover) player.dimension.spawnItem(leftover, player.location);
      player.setDynamicProperty("quest:got_bell", true);
      player.sendMessage("§eYou found a Quest Bell! §fRing it (hold the use button) to call Pip!");
    } catch {}
  }, 80);
});

// ---------- Ringing the bell calls Pip ----------
world.afterEvents.itemUse.subscribe(({ source: player, itemStack }) => {
  if (itemStack?.typeId !== BELL_ID) return;
  if (player?.typeId !== "minecraft:player") return;
  callPip(player);
});

function callPip(player) {
  const dim = player.dimension;
  const view = player.getViewDirection();
  const flat = Math.hypot(view.x, view.z) || 1;
  const spot = {
    x: player.location.x + (view.x / flat) * 2,
    y: player.location.y,
    z: player.location.z + (view.z / flat) * 2,
  };

  playSound("block.bell.hit", player.location, 1.2);

  let pip;
  try {
    pip = dim.getEntities({ tags: [PIP_TAG], location: player.location, maxDistance: 96 })[0];
  } catch {}

  try {
    if (pip) {
      pip.teleport(spot, { facingLocation: player.location });
    } else {
      pip = dim.spawnEntity("minecraft:villager_v2", spot);
      pip.addTag(PIP_TAG);
      pip.nameTag = PIP_NAME;
    }
    keepPipSafe(pip);
    sparkle(dim, spot);
    player.sendMessage("§ePip: §fYou rang? Tap me to talk!");
  } catch {
    player.sendMessage("§cPip couldn't get here. Try ringing in an open space!");
  }
}

// Pip stays put and can't get hurt (no zombie or lava accidents).
function keepPipSafe(pip) {
  try {
    pip.addEffect("slowness", 20000000, { amplifier: 255, showParticles: false });
    pip.addEffect("resistance", 20000000, { amplifier: 4, showParticles: false });
    pip.addEffect("fire_resistance", 20000000, { amplifier: 0, showParticles: false });
    pip.addEffect("water_breathing", 20000000, { amplifier: 0, showParticles: false });
  } catch {}
}

system.runInterval(() => {
  for (const dimId of ["overworld", "nether", "the_end"]) {
    try {
      for (const pip of world.getDimension(dimId).getEntities({ tags: [PIP_TAG] })) keepPipSafe(pip);
    } catch {}
  }
}, 1200);

// ---------- Talking to Pip ----------
let usingBeforeEvent = false;
try {
  world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    if (!event.target.hasTag(PIP_TAG)) return;
    event.cancel = true; // no trading screen
    const { player } = event;
    system.run(() => talkToPip(player));
  });
  usingBeforeEvent = true;
} catch {}

if (!usingBeforeEvent) {
  try {
    world.afterEvents.playerInteractWithEntity.subscribe(({ player, target }) => {
      if (target.hasTag(PIP_TAG)) talkToPip(player);
    });
  } catch {}
}

const talking = new Set();

async function talkToPip(player) {
  if (talking.has(player.id)) return;
  talking.add(player.id);
  try {
    await mainMenu(player);
  } catch {
  } finally {
    talking.delete(player.id);
  }
}

async function mainMenu(player) {
  const data = getData(player);
  const solo = data.active ? findQuest(data.active) : null;
  if (data.active && !solo) {
    data.active = null;
    saveData(player, data);
  }
  let team = teamFor(player);
  const teamQuest = team ? findQuest(team.questId) : null;
  if (team && !teamQuest) {
    saveTeam(null);
    team = null;
  }

  const lines = ["Hi friend! What should we do?"];
  const options = [];

  if (teamQuest) {
    const counts = countNeeds(onlineMembers(team), teamQuest.needs);
    const ready = isReady(counts, teamQuest.needs);
    lines.push(`\n§bTeam quest: §f${progressText(counts, teamQuest.needs)}`);
    options.push(ready
      ? { label: "§2Turn in our team quest!", run: () => turnInTeam(player, team, teamQuest) }
      : { label: "How's our team quest?", run: () => teamStatus(player, team, teamQuest) });
  }
  if (solo) {
    const counts = countNeeds([player], solo.needs);
    const ready = isReady(counts, solo.needs);
    lines.push(`\n§eMy quest: §f${progressText(counts, solo.needs)}`);
    options.push(ready
      ? { label: "§2Turn in my quest!", run: () => turnInSolo(player, data, solo) }
      : { label: "How's my quest?", run: () => soloStatus(player, solo) });
  } else {
    options.push({ label: "Give me a quest!", run: () => offerSolo(player, data) });
  }

  const friends = nearbyPlayers(player);
  if (!getTeam() && friends.length) {
    const names = friends.map((p) => p.name).join(" & ");
    options.push({ label: `§bTeam quest with ${names}!`, run: () => offerTeam(player, data, friends) });
  }
  if (solo) options.push({ label: "Can I do a different quest?", run: () => swapSolo(player, data) });
  if (teamQuest) options.push({ label: "Different team quest, please!", run: () => swapTeam(player, team, data) });
  options.push({ label: "Show me my badges", run: () => showBadges(player, data) });
  options.push({ label: "Bye, Pip!", run: () => {} });

  const form = new ActionFormData().title("Pip the Quest Keeper").body(lines.join("\n"));
  options.forEach((o) => form.button(o.label));
  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  await options[res.selection].run();
}

// --- Solo ---
async function offerSolo(player, data) {
  const quest = pickQuest(QUESTS, data);
  const ok = await confirm(player, quest.story, "§2Yes! I'll do it!");
  if (!ok) return;
  data.active = quest.id;
  saveData(player, data);
  lastShown.delete(player.id);
  player.sendMessage(`§eNew quest! §fBring Pip ${needsText(quest.needs)}.`);
  showTitle(player, "§eNew Quest!", `Bring Pip ${needsText(quest.needs)}`);
  playSound("random.orb", player.location, 1.3);
}

async function swapSolo(player, data) {
  data.active = null;
  saveData(player, data);
  await offerSolo(player, data);
}

async function soloStatus(player, quest) {
  const counts = countNeeds([player], quest.needs);
  await say(player, `Did you find them? You have:\n\n§6${progressText(counts, quest.needs)}§r\n\nKeep looking!`);
}

function turnInSolo(player, data, quest) {
  if (!takeNeeds([player], quest.needs)) {
    player.sendMessage("§cHmm, I couldn't find them all. Check your bag and try again!");
    return;
  }
  data.active = null;
  saveData(player, data);
  lastShown.delete(player.id);
  rewardPlayer(player, quest, false);
}

// --- Team ---
async function offerTeam(player, data, friends) {
  const quest = pickQuest(TEAM_QUESTS, data);
  const names = friends.map((p) => p.name).join(" & ");
  const ok = await confirm(player, `${quest.story}\n\n§bYou'll do this one with ${names}!`, "§2Yes! Let's team up!");
  if (!ok) return;
  if (getTeam()) {
    player.sendMessage("§eSomeone just started a team quest! Talk to Pip to see it.");
    return;
  }
  const members = [player, ...friends];
  saveTeam({ questId: quest.id, members: members.map((p) => p.id), names: members.map((p) => p.name) });
  for (const p of members) {
    lastShown.delete(p.id);
    p.sendMessage(`§bTeam quest! §f${player.name} started a team quest. Bring Pip ${needsText(quest.needs)}. Everything your team carries counts!`);
    showTitle(p, "§bTeam Quest!", `Bring Pip ${needsText(quest.needs)}`);
    playSound("random.orb", p.location, 1.3);
  }
}

async function swapTeam(player, team, data) {
  const quest = pickQuest(TEAM_QUESTS, data, team.questId);
  const ok = await confirm(player, quest.story, "§2Yes! Let's do this one!");
  if (!ok) return;
  team.questId = quest.id;
  saveTeam(team);
  for (const p of onlineMembers(team)) {
    lastShown.delete(p.id);
    p.sendMessage(`§bNew team quest! §fBring Pip ${needsText(quest.needs)}.`);
  }
}

async function teamStatus(player, team, quest) {
  const members = onlineMembers(team);
  const counts = countNeeds(members, quest.needs);
  const who = team.names.join(", ");
  await say(player, `Team: §b${who}§r\n\nTogether you have:\n\n§6${progressText(counts, quest.needs)}§r\n\nKeep going, team!`);
}

function turnInTeam(player, team, quest) {
  // The player turning it in gives first, then teammates fill in the rest.
  const members = [player, ...onlineMembers(team).filter((p) => p.id !== player.id)];
  if (!takeNeeds(members, quest.needs)) {
    player.sendMessage("§cHmm, the team doesn't have everything yet. Keep looking!");
    return;
  }
  saveTeam(null);
  for (const p of members) {
    lastShown.delete(p.id);
    rewardPlayer(p, quest, true);
  }
}

// --- Rewards ---
function rewardPlayer(player, quest, isTeam) {
  const data = getData(player);
  const newBadge = !data.badges.includes(quest.id);
  if (newBadge) data.badges.push(quest.id);
  data.done += 1;
  saveData(player, data);

  const prizes = drawPrizes(isTeam ? 3 : 2); // team quests are bigger, so a bigger bag
  if (data.done % 5 === 0) {
    prizes.push(["minecraft:diamond", 3]);
    if (data.done === 10) prizes.push(["rainbow:rainbow_sword", 1]); // if that add-on is on
  }
  try {
    const inv = player.getComponent("minecraft:inventory").container;
    for (const [id, count] of prizes) {
      try {
        const leftover = inv.addItem(new ItemStack(id, count));
        if (leftover) player.dimension.spawnItem(leftover, player.location);
      } catch {}
    }
  } catch {}

  const jackpot = prizes.find(([id]) => JACKPOTS.includes(id));
  if (jackpot) {
    player.sendMessage("§d§lJACKPOT! §r§dPip found something SUPER rare for you!");
    playSound("random.totem", player.location, 1);
  }
  const badgeText = newBadge ? `You earned the §6${quest.badge} Badge§r!` : "Thank you so much!";
  player.sendMessage(`§ePip: §f${isTeam ? "Great teamwork! " : "Yay! "}${badgeText} Here are your prizes!`);
  if (data.done % 5 === 0) player.sendMessage(`§dWOW! You've done ${data.done} quests! Here's a SUPER PRIZE!`);
  showTitle(player, newBadge ? `§6${quest.badge} Badge!` : "§6Quest Complete!", `Quests done: ${data.done}`);
  celebrate(player);
}

async function showBadges(player, data) {
  const line = (q) => (data.badges.includes(q.id) ? `§6[*] ${q.badge}` : `§8[ ] ???`);
  const soloCount = QUESTS.filter((q) => data.badges.includes(q.id)).length;
  const teamCount = TEAM_QUESTS.filter((q) => data.badges.includes(q.id)).length;
  const form = new ActionFormData()
    .title("My Badges")
    .body(
      `Quests done: ${data.done}\n\n` +
      `§eQuest badges: ${soloCount} of ${QUESTS.length}\n${QUESTS.map(line).join("\n")}\n\n` +
      `§bTeam badges: ${teamCount} of ${TEAM_QUESTS.length}\n${TEAM_QUESTS.map(line).join("\n")}`
    )
    .button("Back");
  await form.show(player);
}

function pickQuest(list, data, notId) {
  const fresh = list.filter((q) => !data.badges.includes(q.id) && q.id !== notId);
  // Start with the easier quests, then mix in harder ones.
  const pool = fresh.length
    ? fresh.slice(0, Math.max(4, Math.ceil(fresh.length / 2)))
    : list.filter((q) => q.id !== notId);
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------- Counting and taking items ----------
function countItems(players, match) {
  let total = 0;
  for (const player of players) {
    try {
      const inv = player.getComponent("minecraft:inventory").container;
      for (let i = 0; i < inv.size; i++) {
        const item = inv.getItem(i);
        if (item && match(item.typeId)) total += item.amount;
      }
    } catch {}
  }
  return total;
}

const countNeeds = (players, needs) => needs.map((n) => countItems(players, n.match));
const isReady = (counts, needs) => needs.every((n, i) => counts[i] >= n.count);

function takeNeeds(players, needs) {
  if (!isReady(countNeeds(players, needs), needs)) return false;
  for (const n of needs) {
    let left = n.count;
    for (const player of players) {
      if (left <= 0) break;
      try {
        const inv = player.getComponent("minecraft:inventory").container;
        for (let i = 0; i < inv.size && left > 0; i++) {
          const item = inv.getItem(i);
          if (!item || !n.match(item.typeId)) continue;
          if (item.amount <= left) {
            left -= item.amount;
            inv.setItem(i, undefined);
          } else {
            item.amount -= left;
            inv.setItem(i, item);
            left = 0;
          }
        }
      } catch {}
    }
    if (left > 0) return false;
  }
  return true;
}

const needsText = (needs) => {
  const parts = needs.map((n) => `${n.count} ${n.thing}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
};

const progressText = (counts, needs) =>
  needs.map((n, i) => `${Math.min(counts[i], n.count)}/${n.count} ${n.thing}`).join(", ");

// ---------- Progress on screen while collecting ----------
system.runInterval(() => {
  const team = getTeam();
  const teamQuest = team ? findQuest(team.questId) : null;
  const teamCounts = teamQuest ? countNeeds(onlineMembers(team), teamQuest.needs) : null;

  for (const player of world.getAllPlayers()) {
    try {
      const parts = [];
      let allDone = true;

      if (teamQuest && team.members.includes(player.id)) {
        const ready = isReady(teamCounts, teamQuest.needs);
        allDone &&= ready;
        parts.push(ready ? "§bTeam: ready! Go see Pip!" : `§bTeam: ${progressText(teamCounts, teamQuest.needs)}`);
      }
      const data = getData(player);
      const solo = data.active ? findQuest(data.active) : null;
      if (solo) {
        const counts = countNeeds([player], solo.needs);
        const ready = isReady(counts, solo.needs);
        allDone &&= ready;
        parts.push(ready ? "§eMy quest: ready! Go see Pip!" : `§eQuest: ${progressText(counts, solo.needs)}`);
      }
      if (!parts.length) continue;

      const text = parts.join("  §7|  ");
      const previous = lastShown.get(player.id);
      if (previous === text) continue;
      lastShown.set(player.id, text);
      player.onScreenDisplay.setActionBar(text);
      if (previous !== undefined && text.includes("ready")) playSound("random.orb", player.location, 1.6);
    } catch {}
  }
}, 20);

// ---------- Little helpers ----------
async function confirm(player, body, yesLabel) {
  const res = await new ActionFormData()
    .title("Pip the Quest Keeper")
    .body(`§e${body}`)
    .button(yesLabel)
    .button("Maybe later")
    .show(player);
  return !res.canceled && res.selection === 0;
}

async function say(player, body) {
  await new ActionFormData().title("Pip the Quest Keeper").body(body).button("OK!").show(player);
}

function celebrate(player) {
  const dim = player.dimension;
  const at = player.location;
  playSound("random.levelup", at, 1.2);
  for (let i = 0; i < 4; i++) {
    system.runTimeout(() => {
      try {
        dim.spawnParticle("minecraft:totem_particle", {
          x: at.x + (Math.random() - 0.5) * 2, y: at.y + 1 + Math.random(), z: at.z + (Math.random() - 0.5) * 2,
        });
      } catch {}
      playSound("firework.twinkle", at, 1);
    }, i * 5);
  }
}

function sparkle(dim, at) {
  for (let i = 0; i < 12; i++) {
    try {
      dim.spawnParticle("minecraft:villager_happy", {
        x: at.x + (Math.random() - 0.5) * 1.2, y: at.y + Math.random() * 2, z: at.z + (Math.random() - 0.5) * 1.2,
      });
    } catch {}
  }
}

function showTitle(player, title, subtitle) {
  try {
    player.onScreenDisplay.setTitle(title, {
      subtitle, fadeInDuration: 5, stayDuration: 50, fadeOutDuration: 15,
    });
  } catch {}
}

function playSound(id, location, pitch) {
  try {
    world.playSound(id, location, { pitch, volume: 1 });
  } catch {}
}
