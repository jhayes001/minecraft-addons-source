// Kingdom Quest: the story of the Princess Kingdom world. Find Graham, the princess's lost dog!
//
// Quest 1, "Gold Eggs": the princess sits crying on her throne. Tap her and she tells you (in pages you turn
// yourself) that Graham is lost, and asks you to find 5 gold eggs hidden round her castle. Every player finds
// their own 5 eggs (the eggs stay for everyone) and brings them to her. When everyone playing has helped, the
// gate in the magic fence round the Ice Palace opens, she cheers up, and Graham's glowing paw prints lead the way.
// Each castle after the first has a magic fence; its gate opens when the quest before it is done.
//
// Grown-ups: /scriptevent kq:reset starts the story again; /scriptevent kq:unlock opens the road now.
import { world, system, ItemStack, MolangVariableMap } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { KINGDOM } from "./kingdom_data.js";

const EGGS_NEEDED = 5;
const LAST_QUEST = 1;              // quests written so far: gates for castles past this open with the last one
const NEAR = 56;                   // only spawn things when a player is this close (the ground there is loaded)
const G = {                        // little pictures from the resource pack's glyph sheet
  egg: "", noEgg: "", graham: "", sad: "", happy: "", heart: "",
  paw: "", ice: "",
};
const ICON = {
  next: "textures/kq_ui/next", back: "textures/kq_ui/back", yes: "textures/kq_ui/yes",
  egg: "textures/kq_ui/egg", help: "textures/kq_ui/help", paw: "textures/kq_ui/paw",
};
const EGG_PLACE = {               // where each egg is, in easy words, for the help page
  garden: "the flower garden", stable: "the unicorn stable", maze: "the hedge maze",
  "dining room": "the room with the cakes", library: "the room with the books",
};

// ---------------------------------------------------------------- saved state
function stage() { return world.getDynamicProperty("kq:stage") ?? 0; }              // 0 eggs quest, 1 road open
function setStage(s) { world.setDynamicProperty("kq:stage", s); }
function foundEggs(p) {
  try { return JSON.parse(p.getDynamicProperty("kq:eggs") ?? "[]"); } catch { return []; }
}
function setFoundEggs(p, list) { p.setDynamicProperty("kq:eggs", JSON.stringify(list)); }
function met(p) { return p.getDynamicProperty("kq:met") === true; }
function helped(p) { return p.getDynamicProperty("kq:helped") === true; }

const overworld = () => world.getDimension("overworld");
const center = (a) => ({ x: a[0] + 0.5, y: a[1], z: a[2] + 0.5 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const players = () => world.getAllPlayers();
const nearAnyPlayer = (loc, r = NEAR) => players().some((p) => p.dimension.id === "minecraft:overworld" && flat(p.location, loc) <= r);

function safe(fn) { try { return fn(); } catch { return undefined; } }

// ---------------------------------------------------------------- book pages
// A story is a list of pages; she turns them with big Next / Back buttons. The last page can end with choices.
const busy = new Set();
function showPages(player, pages, done, i = 0, tries = 0) {
  const page = pages[i];
  const f = new ActionFormData().title(page.title ?? "").body(page.body);
  const buttons = [];
  const last = i === pages.length - 1;
  if (!last) buttons.push(["§l§2Next", ICON.next, () => showPages(player, pages, done, i + 1)]);
  else for (const [label, icon, fn] of page.choices ?? [["§lOK", ICON.yes, () => {}]]) buttons.push([label, icon, fn]);
  if (i > 0) buttons.push(["§l§1Back", ICON.back, () => showPages(player, pages, done, i - 1)]);
  for (const [label, icon] of buttons) f.button(label, icon);
  busy.add(player.id);
  f.show(player).then((r) => {
    busy.delete(player.id);
    if (r.canceled) {
      if (r.cancelationReason === "UserBusy" && tries < 20) system.runTimeout(() => showPages(player, pages, done, i, tries + 1), 10);
      else done?.(false);
      return;
    }
    const b = buttons[r.selection];
    if (!b) return;
    const ret = b[2]();
    if (last && b[1] !== ICON.back) done?.(true, ret);
  }).catch(() => busy.delete(player.id));
}

const eggRow = (n) => (G.egg + " ").repeat(Math.min(n, EGGS_NEEDED)) + (G.noEgg + " ").repeat(Math.max(0, EGGS_NEEDED - n));
const T = (s) => "§l" + s;                       // bold reads more easily
const PRINCESS = () => (stage() >= 1 ? G.happy : G.sad) + " Princess";

const INTRO = [
  { body: `${G.sad}\n\n${T("Boo hoo!")}\n\n${T("I am so sad.")}` },
  { body: `${G.graham}\n\n${T("My dog Graham is lost!")}` },
  { body: `${G.graham}\n\n${T("Graham ran after the hens.")}\n\n${T("Then he ran far away.")}` },
  { body: `${G.egg}\n\n${T("The hens left gold eggs")}\n${T("in my castle.")}` },
  { body: `${G.egg} ${G.egg} ${G.egg} ${G.egg} ${G.egg}\n\n${T("Can you find 5 gold eggs")}\n${T("and bring them to me?")}` },
];

// ---------------------------------------------------------------- talking to the princess
function talkToPrincess(p) {
  if (stage() >= 1) return showPages(p, happyPages(p));
  if (!met(p)) {
    const pages = INTRO.map((pg) => ({ ...pg, title: PRINCESS() }));
    pages[pages.length - 1].choices = [["§l§dYes! I will help!", ICON.yes, () => {
      p.setDynamicProperty("kq:met", true);
      safe(() => p.playSound("random.orb", { pitch: 1.2 }));
    }]];
    return showPages(p, pages, (ok) => {
      if (ok) system.runTimeout(() => showPages(p, [{ title: PRINCESS(), body:
        `${G.heart}\n\n${T("Thank you!")}\n\n${T("Look all over my castle.")}\n${T("Tap a gold egg to take it.")}` }]), 4);
    });
  }
  if (helped(p)) return showPages(p, waitingPages(p));
  const n = foundEggs(p).length;
  if (n >= EGGS_NEEDED) return handIn(p);
  showPages(p, [{ title: PRINCESS(), body: `${eggRow(n)}\n\n${T(`You have ${n} gold egg${n === 1 ? "" : "s"}.`)}\n\n${T(`Find ${EGGS_NEEDED - n} more!`)}`,
    choices: [["§lOK", ICON.yes, () => {}], ["§l§9Help me!", ICON.help, () => system.runTimeout(() => hintPage(p), 4)]] }]);
}

function hintPage(p) {
  const have = new Set(foundEggs(p));
  const left = KINGDOM.eggs.map((e, i) => (have.has(i) ? null : EGG_PLACE[e.name] ?? e.name)).filter(Boolean);
  showPages(p, [{ title: PRINCESS(), body: `${G.egg}\n\n${T("Look in:")}\n\n${left.map((s) => "§l§6" + s).join("\n")}` }]);
}

function handIn(p) {
  showPages(p, [
    { title: PRINCESS(), body: `${eggRow(EGGS_NEEDED)}\n\n${T("You found 5 gold eggs!")}` },
    { title: PRINCESS(), body: `${G.heart}\n\n${T("Thank you so much!")}`, choices: [["§l§dHere you go!", ICON.egg, () => {}]] },
  ], (ok) => {
    if (!ok || helped(p)) return;
    takeEggs(p);
    p.setDynamicProperty("kq:helped", true);
    safe(() => p.playSound("random.levelup"));
    safe(() => overworld().spawnParticle("kq:sparkle", { ...center(KINGDOM.princess), y: KINGDOM.princess[1] + 1.2 }));
    if (everyoneHelped()) unlock(p);
    else system.runTimeout(() => showPages(p, waitingPages(p)), 4);
  });
}

function waitingPages(p) {
  const others = players().filter((q) => q.id !== p.id && !helped(q));
  if (!others.length) return [{ title: PRINCESS(), body: `${G.heart}\n\n${T("Thank you!")}` }];
  return [{ title: PRINCESS(), body: `${G.heart}\n\n${T("Thank you!")}\n\n${T("Now help your friends")}\n${T("find their eggs:")}\n\n` +
    others.map((q) => `§l§6${q.name}  §r${eggRow(foundEggs(q).length)}`).join("\n") }];
}

function happyPages(p) {
  return [
    { title: PRINCESS(), body: `${G.happy}\n\n${T("Hooray!")}\n\n${T("The magic gate is open!")}` },
    { title: PRINCESS(), body: `${G.paw} ${G.paw} ${G.paw}\n\n${T("Look! Paw prints!")}\n\n${T("Graham went this way.")}` },
    { title: PRINCESS(), body: `${G.ice}\n\n${T("Follow the paw prints")}\n${T("to the Ice Palace!")}`,
      choices: [["§l§dLet's go!", ICON.paw, () => {}]] },
  ];
}

function everyoneHelped() {
  const all = players();
  return all.length > 0 && all.every(helped);
}

// ---------------------------------------------------------------- the inns
// One inn on each road. The inn keeper says where to sleep, and gives a clue about Graham.
const INN_TALK = [
  { inn: "Blossom Inn", clue: [`${G.graham}\n\n${T("I saw a black dog!")}\n\n${T("He ran by so fast!")}`,
    `${G.ice}\n\n${T("He ran to the Ice Palace.")}`] },
  { inn: "Snowflake Inn", clue: [`${G.graham}\n\n${T("A little dog came in.")}\n\n${T("He was so cold!")}`,
    `${G.heart}\n\n${T("I gave him a warm hat.")}\n\n${T("Then he ran to Blaze Castle.")}`] },
  { inn: "Sunny Inn", clue: [`${G.graham}\n\n${T("A dog ate all my cookies!")}`,
    `${G.paw}\n\n${T("Then he ran to the knights.")}`] },
  { inn: "Acorn Inn", clue: [`${G.moon}\n\n${T("Last night I heard a dog.")}\n\n${T("Woof! Woof!")}`,
    `${G.paw}\n\n${T("It came from the")}\n${T("Haunted Mountain.")}`] },
  { inn: "Cloud Inn", clue: [`${G.graham}\n\n${T("Look up!")}\n\n${T("I saw a dog in the sky!")}`,
    `${G.paw}\n\n${T("He went up the")}\n${T("big beanstalk!")}`] },
];

function talkToClerk(p, clerk) {
  const i = clerk.getDynamicProperty("kq:inn");
  const inn = KINGDOM.inns[i], talk = INN_TALK[i];
  if (!inn || !talk) return;
  const title = `${G.inn} ${talk.inn}`;
  const pages = [
    { title, body: `${G.inn}\n\n${T(`Hi! I am ${inn.clerk}.`)}\n\n${T(`This is the ${talk.inn}.`)}` },
    { title, body: `${G.moon} ${G.bed}\n\n${T("Is it dark?")}\n\n${T("Sleep in a bed here.")}\n${T("Then it will be day!")}` },
    ...talk.clue.map((body) => ({ title, body })),
  ];
  pages[pages.length - 1].choices = [["§l§dThank you!", ICON.yes, () => {}]];
  showPages(p, pages);
}

// ---------------------------------------------------------------- golden eggs
function tapEgg(p, egg) {
  const i = egg.getDynamicProperty("kq:egg");
  if (typeof i !== "number" || stage() >= 1) return;
  const found = foundEggs(p);
  if (helped(p)) return safe(() => p.onScreenDisplay.setActionBar("§l" + G.heart + " You already helped!"));
  if (found.includes(i)) return safe(() => p.onScreenDisplay.setActionBar("§l" + G.egg + " You have this egg!"));
  found.push(i);
  setFoundEggs(p, found);
  safe(() => p.getComponent("minecraft:inventory").container.addItem(new ItemStack("kq:golden_egg", 1)));
  safe(() => p.playSound("random.orb", { pitch: 1 + found.length * 0.1 }));
  safe(() => overworld().spawnParticle("kq:sparkle", { x: egg.location.x, y: egg.location.y + 0.5, z: egg.location.z }));
  const n = found.length;
  const body = n >= EGGS_NEEDED
    ? `${eggRow(n)}\n\n${T("You found all 5 eggs!")}\n\n${T("Take them to the princess.")}`
    : `${eggRow(n)}\n\n${T("You found a gold egg!")}\n\n${T(`${n} egg${n === 1 ? "" : "s"}. Find ${EGGS_NEEDED - n} more!`)}`;
  showPages(p, [{ title: G.egg + " Gold Egg", body }]);
}

function takeEggs(p) {
  const inv = safe(() => p.getComponent("minecraft:inventory").container);
  if (!inv) return;
  for (let s = 0; s < inv.size; s++) {
    const it = inv.getItem(s);
    if (it?.typeId === "kq:golden_egg") inv.setItem(s, undefined);
  }
}

// ---------------------------------------------------------------- opening the road
function unlock(by) {
  if (stage() >= 1) return;
  setStage(1);
  const dim = overworld();
  for (const e of safe(() => dim.getEntities({ type: "kq:golden_egg" })) ?? []) safe(() => e.remove());
  const at = center(KINGDOM.princess);
  for (let k = 0; k < 8; k++) safe(() => dim.spawnParticle("minecraft:heart_particle",
    { x: at.x + Math.sin(k) * 1.2, y: at.y + 1 + (k % 3) * 0.4, z: at.z + Math.cos(k) * 1.2 }));
  for (const p of players()) {
    safe(() => p.playSound("random.levelup"));
    safe(() => p.playSound("firework.launch"));
    system.runTimeout(() => showPages(p, happyPages(p)), p.id === by?.id ? 6 : 2);
  }
  clearBarriers();
}

// the gates in the magic fences
const ringOpen = (r) => stage() >= Math.min(r.opens, LAST_QUEST);

// open gates come down when their ground is loaded (upkeep keeps trying until each one is gone)
function clearBarriers() {
  const dim = overworld();
  let done;
  try { done = JSON.parse(world.getDynamicProperty("kq:barriers_gone") ?? "[]"); } catch { done = []; }
  let left = 0;
  for (const ring of KINGDOM.rings) {
    if (!ringOpen(ring) || done.includes(ring.name)) continue;
    let all = true;
    for (const c of ring.gate) {
      const b = safe(() => dim.getBlock({ x: c[0], y: c[1], z: c[2] }));
      if (!b) { all = false; continue; }
      if (b.typeId === "kq:magic_barrier") {
        safe(() => b.setType("minecraft:air"));
        if (Math.random() < 0.15) safe(() => dim.spawnParticle("kq:sparkle", center(c)));
        if (safe(() => dim.getBlock({ x: c[0], y: c[1], z: c[2] }).typeId) === "kq:magic_barrier") all = false;
      }
    }
    if (all) done.push(ring.name); else left++;
  }
  world.setDynamicProperty("kq:barriers_gone", JSON.stringify(done));
  world.setDynamicProperty("kq:barriers_left", left);
  return left;
}

function restoreBarriers() {
  const dim = overworld();
  for (const ring of KINGDOM.rings) {
    if (ringOpen(ring)) continue;
    for (const c of ring.gate) {
      const b = safe(() => dim.getBlock({ x: c[0], y: c[1], z: c[2] }));
      if (b && b.typeId === "minecraft:air") safe(() => b.setType("kq:magic_barrier"));
    }
  }
}

// ---------------------------------------------------------------- keeping the story in place
function upkeep(t) {
  const dim = overworld();
  const seat = center(KINGDOM.princess);
  const s = stage();
  // the princess, on her throne
  if (nearAnyPlayer(seat)) {
    let ps = safe(() => dim.getEntities({ type: "kq:princess", location: seat, maxDistance: 40 })) ?? [];
    for (const extra of ps.slice(1)) safe(() => extra.remove());
    let princess = ps[0];
    if (!princess) princess = safe(() => dim.spawnEntity("kq:princess", seat));
    if (princess) {
      if (dist(princess.location, seat) > 0.3) safe(() => princess.teleport(seat, { rotation: { x: 0, y: KINGDOM.princessFacing } }));
      safe(() => princess.setRotation({ x: 0, y: KINGDOM.princessFacing }));
      if (safe(() => princess.getProperty("kq:happy")) !== (s >= 1)) safe(() => princess.setProperty("kq:happy", s >= 1));
      if (s < 1 && t % 2 === 0) safe(() => dim.spawnParticle("kq:tear", { x: seat.x + (t % 4 ? 0.15 : -0.15), y: seat.y + 1.15, z: seat.z + 0.25 }));
      if (s >= 1 && t % 3 === 0) safe(() => dim.spawnParticle("minecraft:heart_particle", { x: seat.x, y: seat.y + 1.9, z: seat.z }));
    }
  }
  // the inn keepers, behind their desks
  KINGDOM.inns.forEach((inn, i) => {
    const at = center(inn.pos);
    if (!nearAnyPlayer(at)) return;
    const here = safe(() => dim.getEntities({ type: "kq:clerk", location: at, maxDistance: 6 })) ?? [];
    for (const extra of here.slice(1)) safe(() => extra.remove());
    let c = here[0];
    if (!c) {
      c = safe(() => dim.spawnEntity("kq:clerk", at));
      if (c) { safe(() => c.setDynamicProperty("kq:inn", i)); safe(() => c.setProperty("kq:look", i)); }
    }
    if (c) {
      if (dist(c.location, at) > 0.3) safe(() => c.teleport(at));
      safe(() => c.setRotation({ x: 0, y: inn.facing }));
      if (c.getDynamicProperty("kq:inn") !== i) { safe(() => c.setDynamicProperty("kq:inn", i)); safe(() => c.setProperty("kq:look", i)); }
    }
  });
  // the eggs, while the quest is on
  if (s < 1) {
    KINGDOM.eggs.forEach((e, i) => {
      const at = center(e.pos);
      if (!nearAnyPlayer(at)) return;
      const here = safe(() => dim.getEntities({ type: "kq:golden_egg", location: at, maxDistance: 1.5 })) ?? [];
      for (const extra of here.slice(1)) safe(() => extra.remove());
      if (!here.length) {
        const egg = safe(() => dim.spawnEntity("kq:golden_egg", at));
        if (egg) safe(() => egg.setDynamicProperty("kq:egg", i));
      } else if (here[0].getDynamicProperty("kq:egg") !== i) safe(() => here[0].setDynamicProperty("kq:egg", i));
      if (t % 3 === i % 3) safe(() => dim.spawnParticle("kq:sparkle", { x: at.x, y: at.y + 0.6, z: at.z }));
    });
    if (t % 15 === 0) restoreBarriers();                       // (after a reset, as their ground loads)
  } else if ((world.getDynamicProperty("kq:barriers_left") ?? 1) > 0 || t % 15 === 0) {
    clearBarriers();
  }
  // signs for each player
  for (const p of players()) {
    if (p.dimension.id !== "minecraft:overworld") continue;
    if (!met(p) && s < 1) trailNear(p, KINGDOM.toPrincess, t, "kq:sparkle", 24);
    if (s >= 1) trailNear(p, KINGDOM.trail, t, "kq:pawprint", 28);
    if (t % 2 === 0) barrierNudge(p);
  }
}

// a moving line of sparkles / paw prints along a path, near the player, pointing the way
function trailNear(p, path, t, particle, r) {
  const dim = overworld();
  for (let i = 0; i < path.length; i++) {
    if ((i + 4 - (t % 4)) % 4 !== 0) continue;
    const c = path[i];
    if (Math.abs(c[0] + 0.5 - p.location.x) > r || Math.abs(c[2] + 0.5 - p.location.z) > r) continue;
    if (flat(p.location, center(c)) > r) continue;
    let vars;
    if (c.length > 3) { vars = new MolangVariableMap(); safe(() => vars.setFloat("variable.dir", c[3])); }   // which way the paw points
    safe(() => dim.spawnParticle(particle, { x: c[0] + 0.5, y: c[1] + 0.05, z: c[2] + 0.5 }, vars));
  }
}

const nudged = new Map();
function barrierNudge(p) {
  if ((nudged.get(p.id) ?? -999) > system.currentTick - 200) return;
  for (const ring of KINGDOM.rings) {
    if (ringOpen(ring)) continue;
    const d = Math.hypot(p.location.x - ring.center[0] - 0.5, p.location.z - ring.center[1] - 0.5);
    if (Math.abs(d - ring.r) < 3) {
      nudged.set(p.id, system.currentTick);
      safe(() => p.playSound("note.chime"));
      safe(() => p.onScreenDisplay.setActionBar("§l§d" + G.sad + " Magic! Help the princess first."));
      return;
    }
  }
}

// ---------------------------------------------------------------- taps
const lastTap = new Map();
function onTap(player, target) {
  if (!player || !target || player.typeId !== "minecraft:player") return;
  if (busy.has(player.id)) return;
  const now = system.currentTick;
  if ((lastTap.get(player.id) ?? -99) > now - 12) return;
  lastTap.set(player.id, now);
  if (target.typeId === "kq:princess") talkToPrincess(player);
  else if (target.typeId === "kq:golden_egg") tapEgg(player, target);
  else if (target.typeId === "kq:clerk") talkToClerk(player, target);
}

world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  if (!ev.target.typeId.startsWith("kq:")) return;
  ev.cancel = true;
  const player = ev.player, target = ev.target;
  system.run(() => onTap(player, target));
});
world.afterEvents.entityHitEntity.subscribe((ev) => {
  if (ev.hitEntity?.typeId?.startsWith("kq:")) onTap(ev.damagingEntity, ev.hitEntity);
});

// a welcome page the first time you arrive
world.afterEvents.playerSpawn.subscribe((ev) => {
  const p = ev.player;
  if (!ev.initialSpawn || met(p) || stage() >= 1) return;
  system.runTimeout(() => showPages(p, [{ title: G.sad + " Princess Kingdom", body:
    `${G.sad}\n\n${T("The princess is sad.")}\n\n${T("Go to her castle")}\n${T("and find her!")}` }]), 60);
});

// someone leaving can finish the quest (everyone left has helped)
world.afterEvents.playerLeave.subscribe(() => system.runTimeout(() => {
  if (stage() < 1 && everyoneHelped()) unlock();
}, 5));

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id === "kq:reset") {
    setStage(0);
    world.setDynamicProperty("kq:barriers_left", 1);
    world.setDynamicProperty("kq:barriers_gone", "[]");
    for (const p of players()) { setFoundEggs(p, []); p.setDynamicProperty("kq:met", false); p.setDynamicProperty("kq:helped", false); takeEggs(p); }
    restoreBarriers();
  } else if (ev.id === "kq:unlock") {
    unlock();
  }
});

let t = 0;
system.runInterval(() => { t++; safe(() => upkeep(t)); }, 20);
