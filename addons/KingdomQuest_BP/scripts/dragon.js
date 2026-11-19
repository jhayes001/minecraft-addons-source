// Chapter 2 of the Princess Kingdom story: The Dragon's Wing.
//
// The day after Graham comes home, a storm rolls in, there's a roar, and a huge black dragon flies over the kingdom
// trailing smoke and crashes past the end of the princess road. It's the Ender Dragon: hurt and frightened, not
// fierce. One wing is broken.
//
// Quest 1, A Bed for the Dragon (wheat and hay): the ground is hard and the dragon is cold. Pick wheat in the old
// field by the crater, make hay bales (9 wheat each, at a crafting table) and put 4 down by the dragon.
// Quest 2, The Broken Track (iron, smelting, rails, minecarts): the dragon needs three things from deep in the mines,
// and the mine train is the way down, but a rockslide knocked 12 rails off the track. Down the stairs on the crater
// rim, Pebble the miner runs the station. Mine iron from the walls, smelt it, make rails (6 iron and a stick), fill
// the gap, get a minecart from Pebble, press the button and ride to the Crystal Caverns stop.
// Quest 3, The Crystal Caverns (torches, mining amethyst): arriving opens the magic door at the stop. It's dark in
// there: make torches (coal on a stick) and put 6 up in the caverns; cross the chasm on the narrow bridge; mine 12
// amethyst shards in the geode (Graham sniffs out crystals: sparkles from his nose, and a bark); ride back and give
// them to the dragon: the first bandage goes on its wing (kq:wing 1).
// Quest 4, The Glow Garden (shears, shearing): the dragon needs something soft: wool. Some sheep got lost in the
// Glow Garden, a lush cave lit by glow berries at the end of Pebble's second line (its door in the station's west
// wall opens now). Make shears (2 iron), ride there, shear the sheep for 6 wool (Graham herds them to you: he nudges
// the ones near him your way, with a bark) and take it to the dragon: the second bandage (kq:wing 2).
// Quest 5, The Deep Forge (iron pickaxe, redstone, iron doors, smelting gold): the last thing is gold, to hold
// the wing straight. Pebble's third line (its door in the station's south wall opens now) runs deep into the
// deepslate, to a cavern with lava falls behind glass and the old Deep Forge, shut with an iron door. Graham dashes
// up to the door and gets shut in (whimpering inside). Make an iron pickaxe, mine redstone, make a redstone torch and
// put it next to the door: redstone opens iron doors, and Graham is free. Mine the gold inside, smelt 4 gold bars,
// and take them to the dragon: the third bandage (kq:wing 3).
// Quest 6, Mended (making a bed, sleeping through the night): the wing needs one night to mend. Make a bed (3 wool,
// 3 planks), put it by the dragon and sleep. In the morning, when you come to the dragon: the bandages are gone, it
// stands up, stretches its wings and roars: "Climb on my back! Let's fly!" The flight is a cutscene: everyone near
// rides on its back (Graham too), the camera following behind, up over the spawn and round all six castles (the
// Princess Castle, the Ice Palace, the Sky Castle, the Haunted Mountain, the Knight's Fortress, Blaze Castle) and back
// down into the crater, with fireworks. The end of Chapter 2: tap the dragon any time to fly again.
//
// Progress is the world property kq:ch2: 0 not started, 1 the crash has happened, 2 making the nest, 3 the track,
// 4 the Crystal Caverns, 5 the Glow Garden (crystals delivered), 6 the Deep Forge (wool delivered), 7 mending
// overnight (gold delivered; kq:mend_day is the day it was), 8 mended (fly!), 9 flown: the end (rides any time). Each player remembers meeting the dragon (kq:dmet1) and
// Pebble (kq:dmet2), and getting a minecart (kq:got_cart).
// main.js hands over taps, buttons, the How-To Book, the hints and the arrow once Chapter 1 is over (kq:stage 7).
// Grown-ups: /scriptevent kq:ch2 starts it now; kq:unlock finishes the step you're on; kq:ch2reset starts it again.

import { world, system, ItemStack, BlockPermutation } from "@minecraft/server";
import { DRAGON } from "./dragon_data.js";

export function initChapter2(api) {
  const { say, nameNpc, bookFor, bookSays, carrying, has, G, safe, players, overworld, center, dist, flat, stage, giveGuide, grahams } = api;
  const D = DRAGON;
  const HAY_NEEDED = 4, TORCHES = 6, SHARDS = 12, WOOL = 6, GOLD = 4;
  const SHEEP_TAG = "kq_garden";
  const TORCH_IDS = ["minecraft:torch", "minecraft:soul_torch", "minecraft:lantern", "minecraft:soul_lantern", "minecraft:redstone_torch"];
  const NEAR = 56;
  const RAILS = ["minecraft:rail", "minecraft:golden_rail", "minecraft:detector_rail", "minecraft:activator_rail"];
  const PIC = {
    dragonSad: "", dragonHappy: "", wheat: "", hay: "", rail: "", minecart: "",
    pebble: "", crystal: "", button: "", boom: "", sheep: "\uE145", wool: "\uE146", redstone: "\uE147", gold: "\uE148", door: "\uE149",
  };

  const ch2 = () => world.getDynamicProperty("kq:ch2") ?? 0;
  const setCh2 = (n) => world.setDynamicProperty("kq:ch2", n);
  const dmet = (p, n) => p.getDynamicProperty("kq:dmet" + n) === true;
  const nearAny = (loc, r = NEAR) => players().some((p) => p.dimension.id === "minecraft:overworld" && flat(p.location, loc) <= r);
  const dragonAt = () => center(D.dragon);
  const pebbleAt = () => center(D.pebble);
  const n = (p, id) => carrying(p).ids[id] ?? 0;

  // ---------------------------------------------------------------- the crash: a cutscene (about 20 seconds)
  // Starts the day after Chapter 1 ends (or soon after this update, if that was before), in the daytime, with
  // someone near the castle or the spawn. Rain, not thunder: lightning could set the castles alight.
  //
  // Everyone near the leader watches (no words on screen): the hotbar goes, they can't move, and the camera takes
  // over. (1) It rises behind them looking north as the rain starts. (2) The dragon roars and comes over the trees,
  // smoking, beating its bad wing, and passes right overhead; the camera turns to follow it. (3) Fade to black, and
  // the camera is on the crater's rim (the watchers are put just behind it, so the land there is loaded): the dragon
  // comes down out of the north, hits the ground (BOOM, dust, the screen shakes), skids along the trench into the
  // crater, lifts its head once, groans, and lies still. (4) Fade to black, and everyone is back where they were,
  // free to move; the How-To Book says go and see. A ticking area keeps the crater loaded during the scene.
  // Anyone who leaves partway is put back (camera, hotbar, moving) when they come back.
  let scene;                                                     // the cutscene while it runs
  const arrived = new Map();                                     // player id -> the tick they came into the world
  const SCENE_LEN = 420;
  const TAG = "kq_crash";
  const cmd = (who, c) => safe(() => (who.runCommand ?? who.runCommandAsync).call(who, c));
  const v = (a, dx = 0, dy = 0, dz = 0) => ({ x: a.x + dx, y: a.y + dy, z: a.z + dz });
  const xyz = (a) => `${a.x.toFixed(2)} ${a.y.toFixed(2)} ${a.z.toFixed(2)}`;
  const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });
  function regionMissing() {
    const [x, y, z, id] = D.marker;
    const b = safe(() => overworld().getBlock({ x, y, z }));
    return b !== undefined && b.typeId !== id;                    // (not loaded: can't tell, so carry on)
  }
  function readyToStart() {
    if (stage() < 7 || ch2() !== 0 || scene) return undefined;
    const end = world.getDynamicProperty("kq:end_day");
    const day = safe(() => world.getDay()) ?? 0;
    if (typeof end === "number" && day <= end) return undefined;
    const time = safe(() => world.getTimeOfDay()) ?? 6000;
    if (time < 1000 || time > 11000) return undefined;
    // half a minute after someone has actually come into the world (not counting the loading screen, which can be
    // long on an iPad: the script starts ticking before the player can see anything)
    return players().find((p) => p.dimension.id === "minecraft:overworld" && flat(p.location, { x: 0, z: 60 }) < 170 &&
      arrived.has(p.id) && system.currentTick - arrived.get(p.id) >= 600);
  }
  function crash(leader) {
    if (ch2() !== 0 || scene) return;
    if (regionMissing()) { world.setDynamicProperty("kq:ch2_missing", true); return; }
    setCh2(1);
    const dim = overworld();
    cmd(dim, "weather rain 60");
    const l = leader?.location ?? { x: 0, y: D.dragon[1] + 3, z: 100 };
    const watchers = players().filter((q) => q.dimension.id === "minecraft:overworld" && flat(q.location, l) < 48);
    const crater = center(D.dragon);
    const ground = crater.y + 2;                                 // the meadow round the crater (game y 35 + 1)
    scene = {
      t: 0, leader: l, watchers, dragon: undefined, crater,
      // the fly-over: from the north, over the leader's head, away south toward the crater
      over: [v(l, -12, 30, -58), v(l, 0, 13, 0), v(l, 10, 9, 60)],     // (close enough to be loaded)
      cam1: {},
      // the crash: from the north down onto the skid mark, along it into the crater
      approach: v(crater, -6, 26, -60), impact: v(crater, 0, 1.5, -42),   // (inside the ticking area)
      cam2: v(crater, -26, 8, -24), stand: { x: crater.x - 31, y: ground, z: crater.z - 27 },
    };
    for (const q of watchers) {
      const r = safe(() => q.getRotation()) ?? { x: 0, y: 180 };
      safe(() => q.setDynamicProperty("kq:scene_home", JSON.stringify({ ...q.location, rx: r.x, ry: r.y })));
      cmd(q, "inputpermission set @s movement disabled");
      cmd(q, "inputpermission set @s camera disabled");
      cmd(q, "hud @s hide");
      cmd(q, "camera @s fade time 0.4 0.2 1.2 color 10 10 20");
      scene.cam1[q.id] = v(q.location, 2, 4, 7);                // just behind and above them
    }
    cmd(dim, "tickingarea remove kq_crash");
    cmd(dim, `tickingarea add circle ${Math.floor(crater.x)} ${Math.floor(crater.y)} ${Math.floor(crater.z)} 4 kq_crash`);
  }
  // The crater: the world has plain meadow there until the dragon comes down; then it's dug out like a meteor
  // strike, from the blocks in DRAGON.craterBlocks (sorted north to south): a blast where it hits, the trench torn
  // open in front of it as it skids, and the bowl blown out where it stops. kq:crater_made once it's all done.
  const craterPerm = [];
  const craterMade = () => world.getDynamicProperty("kq:crater_made") === true;
  const craterAt = () => world.getDynamicProperty("kq:crater_at") ?? 0;           // how far the digging has got
  function craterBlock(i) {                                      // false if that bit of land isn't loaded
    const [x, y, z, k] = D.craterBlocks[i];
    const b = safe(() => overworld().getBlock({ x, y, z }));
    if (!b) return false;
    if (craterPerm[k] === undefined) { const [name, states] = D.craterPalette[k]; craterPerm[k] = safe(() => BlockPermutation.resolve(name, states)) ?? null; }
    if (craterPerm[k]) safe(() => b.setPermutation(craterPerm[k]));
    return true;
  }
  function digCrater(zLimit, budget = 400) {
    if (!D.craterBlocks || craterMade()) return;
    let i = craterAt(), n = 0;
    while (i < D.craterBlocks.length && D.craterBlocks[i][2] <= zLimit && n < budget) {
      if (!craterBlock(i)) break;
      i++; n++;
    }
    world.setDynamicProperty("kq:crater_at", i);
    if (i >= D.craterBlocks.length) world.setDynamicProperty("kq:crater_made", true);
  }
  function craterCheck() {                                       // finish the digging; an older map has the crater already
    if (!D.craterCheck || craterMade()) return;
    if (craterAt() === 0) {
      const [x, y, z, id] = D.craterCheck;
      const b = safe(() => overworld().getBlock({ x, y, z }));
      if (!b) return;
      if (b.typeId !== id) return world.setDynamicProperty("kq:crater_made", true);
    }
    digCrater(Infinity, 2000);
  }
  function sceneDragon(at, face) {
    const sc = scene;
    let e = sc.dragon;
    const ok = e && safe(() => (typeof e.isValid === "function" ? e.isValid() : e.isValid !== false));
    if (!ok) {
      e = safe(() => overworld().spawnEntity("kq:dragon", at));
      if (!e) return undefined;
      sc.dragon = e;
      safe(() => e.setDynamicProperty("kq:flying", true));
      safe(() => e.addTag(TAG));
      safe(() => e.setProperty("kq:pose", 2));
      safe(() => e.setProperty("kq:wing", 0));
    }
    safe(() => e.teleport(at, { facingLocation: { x: face.x, y: at.y, z: face.z } }));
    return e;
  }
  const watching = () => scene.watchers.filter((q) => safe(() => q.isValid?.() ?? true) !== false && players().includes(q));
  const track = (q, pos, ease) => cmd(q, `camera @s set minecraft:free ease ${ease} linear pos ${xyz(pos)} facing @e[tag=${TAG},c=1]`);
  function sceneTick() {
    const sc = scene;
    if (!sc) return;
    const t = ++sc.t, dim = overworld();
    if (t > SCENE_LEN) return finishScene();
    const sound = (s, at, volume = 1, pitch = 1) => { for (const q of players()) safe(() => q.playSound(s, { location: at, volume, pitch })); };
    // (1) the camera rises behind them, looking north at the sky
    if (t === 2) for (const q of watching()) {
      const away = v(sc.leader, 0, 16, -50);
      cmd(q, `camera @s set minecraft:free ease 2 in_out_sine pos ${xyz(sc.cam1[q.id] ?? v(q.location, 2, 4, 7))} facing ${xyz(away)}`);
    }
    // (2) the fly-over: ticks 30-150
    if (t >= 30 && t <= 150) {
      const k = (t - 30) / 120;
      const [a, b, c] = sc.over;
      const pos = k < 0.55 ? lerp(a, b, k / 0.55) : lerp(b, c, (k - 0.55) / 0.45);
      const wob = Math.sin(t * 0.3) * 1.6;
      const at = { x: pos.x + wob, y: pos.y + Math.sin(t * 0.45) * 0.7, z: pos.z };
      const e = sceneDragon(at, k < 0.55 ? b : c);
      if (t % 2 === 0) safe(() => dim.spawnParticle("minecraft:basic_smoke_particle", v(at, 3, 2, 2)));
      if (t % 10 === 0) sound("mob.enderdragon.flap", at, 3);
      if (t === 40) sound("mob.enderdragon.growl", at, 4, 0.9);
      if (t === 95) sound("mob.enderdragon.growl", at, 4, 0.7);
      if (e && t >= 44 && t % 4 === 0) for (const q of watching()) track(q, sc.cam1[q.id] ?? v(sc.leader, 2, 4, 7), 0.25);
    }
    // (3) fade to black, and over to the crater
    if (t === 140) for (const q of watching()) cmd(q, "camera @s fade time 0.5 0.6 0.6 color 0 0 0");
    if (t === 152) {
      for (const q of watching()) {
        safe(() => q.teleport(sc.stand, { facingLocation: sc.crater }));
        cmd(q, `camera @s set minecraft:free pos ${xyz(sc.cam2)} facing ${xyz(v(sc.crater, 0, 2, -30))}`);
      }
      sceneDragon(sc.approach, sc.impact);
    }
    // the dive: ticks 165-255, wobbling down out of the north onto the skid mark
    if (t >= 165 && t <= 255) {
      const k = (t - 165) / 90;
      const pos = lerp(sc.approach, sc.impact, k);
      pos.y = sc.approach.y + (sc.impact.y - sc.approach.y) * (k * k);
      pos.x += Math.sin(t * 0.35) * 1.8 * (1 - k);
      const e = sceneDragon(pos, sc.impact);
      if (t % 2 === 0) safe(() => dim.spawnParticle("minecraft:basic_smoke_particle", v(pos, -3, 2, 1)));
      if (t % 8 === 0) sound("mob.enderdragon.flap", pos, 3, 0.8);
      if (t === 200) sound("mob.enderdragon.growl", pos, 4, 0.8);
      if (e && t % 4 === 0) for (const q of watching()) track(q, sc.cam2, 0.25);
    }
    // BOOM: it hits the ground and skids into the crater (ticks 256-320)
    if (t === 256) {
      sound("random.explode", sc.impact, 3, 0.6);
      sound("mob.enderdragon.hit", sc.impact, 3, 0.7);
      for (let i = 0; i < 5; i++) safe(() => dim.spawnParticle("minecraft:huge_explosion_emitter", v(sc.impact, (i - 2) * 2, 0, i % 2)));
      for (const q of players()) cmd(q, "camerashake add @s 0.7 1.5 positional");
      safe(() => sc.dragon?.setProperty("kq:pose", 0));
      digCrater(sc.impact.z + 4, 1500);                          // the blast where it hits
      for (let i = 0; i < 8; i++) safe(() => dim.spawnParticle("minecraft:large_explosion", v(sc.impact, Math.sin(i) * 4, 1 + (i % 3), Math.cos(i) * 4)));
    }
    if (t >= 256 && t <= 320) {
      const k = (t - 256) / 64, ease = 1 - (1 - k) * (1 - k);
      const end = sc.crater;
      const pos = lerp(sc.impact, end, ease);
      pos.y = sc.impact.y + (end.y - sc.impact.y) * ease;
      sceneDragon(pos, v(end, 0, 0, 20));
      digCrater(pos.z + 5, 300);                                 // the trench torn open as it skids
      if (t % 3 === 0) safe(() => dim.spawnParticle("minecraft:large_explosion", v(pos, (t % 2 ? 2 : -2), 0.5, -4)));
      if (t % 2 === 0) safe(() => dim.spawnParticle("minecraft:huge_explosion_emitter", v(pos, (t % 4 ? 3 : -3), 0, 4)));
      if (t % 6 === 0) sound("dig.gravel", pos, 2, 0.6);
      if (t % 4 === 0) for (const q of watching()) track(q, sc.cam2, 0.25);
    }
    if (t === 322) {                                             // where it stops, the bowl is blown out
      for (const q of players()) cmd(q, "camerashake add @s 0.5 0.8 positional");
      sound("random.explode", sc.crater, 3, 0.5);
      for (let i = 0; i < 10; i++) safe(() => dim.spawnParticle("minecraft:huge_explosion_emitter", v(sc.crater, Math.sin(i * 0.63) * 12, 1, Math.cos(i * 0.63) * 12)));
    }
    if (t >= 322 && t < 330) digCrater(Infinity, 1200);
    // it lifts its head once, groans, and lies still
    if (t === 340) { safe(() => sc.dragon?.setProperty("kq:pose", 1)); sound("mob.enderdragon.growl", sc.crater, 2, 0.5); }
    if (t === 368) safe(() => sc.dragon?.setProperty("kq:pose", 0));
    // (4) fade to black, and everyone is back where they were
    if (t === 384) for (const q of watching()) cmd(q, "camera @s fade time 0.6 0.8 1 color 0 0 0");
    if (t === 398) finishScene();
  }
  function restore(q) {
    let home;
    try { home = JSON.parse(q.getDynamicProperty("kq:scene_home") ?? "null"); } catch { home = null; }
    if (home) safe(() => q.teleport({ x: home.x, y: home.y, z: home.z }, { rotation: { x: home.rx ?? 0, y: home.ry ?? 0 } }));
    safe(() => q.setDynamicProperty("kq:scene_home", undefined));
    cmd(q, "camera @s clear");
    cmd(q, "hud @s reset");
    cmd(q, "inputpermission set @s movement enabled");
    cmd(q, "inputpermission set @s camera enabled");
  }
  function finishScene() {
    const sc = scene;
    if (!sc) return;
    scene = undefined;
    digCrater(Infinity, 100000);                                 // (whatever's left)
    // the dragon stays: now it's the one lying in the crater (turned to face the way you come in)
    const e = sc.dragon;
    if (e) {
      safe(() => e.teleport(sc.crater, { rotation: { x: 0, y: D.dragonFacing } }));
      safe(() => e.setDynamicProperty("kq:flying", undefined));
      safe(() => e.removeTag(TAG));
      safe(() => e.setProperty("kq:pose", 0));
    }
    for (const q of sc.watchers) if (players().includes(q)) restore(q);
    cmd(overworld(), "tickingarea remove kq_crash");
    system.runTimeout(() => { for (const q of players()) bookSays(q, "kq_d_crash_1"); }, 30);
    system.runTimeout(() => cmd(overworld(), "weather clear"), 20 * 40);
  }
  world.afterEvents.playerSpawn.subscribe((ev) => {               // left in the middle of the scene: put things back
    const q = ev.player;
    if (ev.initialSpawn) arrived.set(q.id, system.currentTick);
    if (q.getDynamicProperty("kq:scene_home") !== undefined && !(scene && scene.watchers.includes(q))) system.runTimeout(() => restore(q), 20);
  });

  // ---------------------------------------------------------------- the dragon in its crater
  function dragonUpkeep(t) {
    const at = dragonAt();
    if (!nearAny(at)) return;
    const dim = overworld();
    let es = (safe(() => dim.getEntities({ type: "kq:dragon", location: at, maxDistance: 12 })) ?? [])
      .filter((e) => !e.getDynamicProperty("kq:flying"));
    for (const extra of es.slice(1)) safe(() => extra.remove());
    let e = es[0] ?? safe(() => dim.spawnEntity("kq:dragon", at));
    if (!e) return;
    nameNpc(e, "kq_name_dragon", "Ender Dragon");
    if (dist(e.location, at) > 0.4) safe(() => e.teleport(at, { rotation: { x: 0, y: D.dragonFacing } }));
    safe(() => e.setRotation({ x: 0, y: D.dragonFacing }));
    const pose = ch2() >= 8 ? 3 : ch2() >= 3 ? 1 : 0;
    if (safe(() => e.getProperty("kq:pose")) !== pose) safe(() => e.setProperty("kq:pose", pose));
    const wing = world.getDynamicProperty("kq:wing") ?? 0;
    if (safe(() => e.getProperty("kq:wing")) !== wing) safe(() => e.setProperty("kq:wing", wing));
    // hurt: smoke still rising from the crater, and now and then a sad rumble; happy: hearts
    if (pose === 0 && t % 2 === 0) for (let k = 0; k < 3; k++)
      safe(() => dim.spawnParticle("minecraft:basic_smoke_particle", { x: at.x - 5 + k * 1.5, y: at.y + 1.5, z: at.z + 2 - k }));
    if (pose === 0 && t % 9 === 0) for (const q of players()) if (flat(q.location, at) < 40) safe(() => q.playSound("mob.enderdragon.growl", { location: at, volume: 0.6, pitch: 0.6 }));
    if (pose === 1 && t % 4 === 0) safe(() => dim.spawnParticle("minecraft:heart_particle", { x: at.x, y: at.y + 4, z: at.z - 4 }));
    // the first time you walk right up to it, it speaks to you (no need to find the right spot to tap)
    if (ch2() <= 2) for (const q of players()) {
      if (dmet(q, 1) || q.getDynamicProperty("kq:dgreeted") === true) continue;
      if (flat(q.location, at) < 9 && Math.abs(q.location.y - at.y) < 7) {
        q.setDynamicProperty("kq:dgreeted", true);
        say(e, q, "kq_d_intro_1");
      }
    }
    // Graham: nervous of the big dragon at first (whimpers by you), its friend once it's comfy
    for (const g of grahams()) {
      if (flat(g.location, at) > 16) continue;
      if (pose === 0 && t % 4 === 0) for (const q of players()) if (flat(q.location, g.location) < 20) safe(() => q.playSound("mob.wolf.whine", { location: g.location }));
      if (pose === 1 && t % 5 === 0) safe(() => dim.spawnParticle("minecraft:heart_particle", { x: g.location.x, y: g.location.y + 1.2, z: g.location.z }));
    }
  }

  // ---------------------------------------------------------------- quest 1: the nest
  function hayList() { return safe(() => JSON.parse(world.getDynamicProperty("kq:hay") ?? "[]")) ?? []; }
  function hayCount() {                                          // hay bales still there (unloaded ones count)
    const spots = hayList();
    const keep = spots.filter(([x, y, z]) => { const b = safe(() => overworld().getBlock({ x, y, z })); return !b || b.typeId === "minecraft:hay_block"; });
    if (keep.length !== spots.length) world.setDynamicProperty("kq:hay", JSON.stringify(keep));
    return Math.min(HAY_NEEDED, keep.length);
  }
  function byDragon(l) { const at = dragonAt(); return flat(l, at) <= D.nestR && Math.abs(l.y - at.y) < 6; }
  function onPlace(ev) {
    const b = ev.block, p = ev.player;
    if (!b || !p) return;
    if (ch2() === 2 && b.typeId === "minecraft:hay_block" && byDragon(b.location)) {
      const { x, y, z } = b.location, spots = hayList();
      if (spots.some((s) => s[0] === x && s[1] === y && s[2] === z)) return;
      spots.push([x, y, z]);
      world.setDynamicProperty("kq:hay", JSON.stringify(spots));
      const c = hayCount();
      safe(() => overworld().spawnParticle("kq:sparkle", { x: x + 0.5, y: y + 1, z: z + 0.5 }));
      for (const q of players()) if (flat(q.location, b.location) < 40) {
        safe(() => q.playSound("random.orb", { pitch: 0.8 + c * 0.1 }));
        safe(() => q.onScreenDisplay.setActionBar(`${PIC.hay} ${c} of ${HAY_NEEDED} hay bales!`));
      }
      if (c >= HAY_NEEDED) nestDone(p);
    } else if (ch2() === 4 && TORCH_IDS.includes(b.typeId) && inCaverns(b.location)) {
      const { x, y, z } = b.location, spots = torchList();
      if (spots.some((s) => s[0] === x && s[1] === y && s[2] === z)) return;
      spots.push([x, y, z]);
      world.setDynamicProperty("kq:torches", JSON.stringify(spots));
      const c = torchCount();
      for (const q of players()) if (flat(q.location, b.location) < 40) {
        safe(() => q.playSound("random.orb", { pitch: 0.7 + c * 0.1 }));
        safe(() => q.onScreenDisplay.setActionBar(c >= TORCHES ? `${PIC.crystal} The caverns are lit! Find the crystals!` : `${G.torch} ${c} of ${TORCHES} torches!`));
      }
    } else if (ch2() === 3 && RAILS.includes(b.typeId) && onGap(b.location)) {
      const c = gapCount();
      for (const q of players()) if (flat(q.location, b.location) < 40) {
        safe(() => q.playSound("random.orb", { pitch: 0.6 + c * 0.06 }));
        safe(() => q.onScreenDisplay.setActionBar(c >= D.gap.length ? `${PIC.pebble} The track is fixed! Tap Pebble!` : `${PIC.rail} ${c} of ${D.gap.length} rails!`));
      }
      if (c >= D.gap.length) trackFixed(true);
    }
  }
  function nestDone(p) {
    if (ch2() !== 2) return;
    setCh2(3);
    const at = dragonAt(), dim = overworld();
    for (let k = 0; k < 10; k++) safe(() => dim.spawnParticle("minecraft:heart_particle", { x: at.x + Math.sin(k) * 3, y: at.y + 2 + (k % 3), z: at.z + Math.cos(k) * 3 }));
    const e = (safe(() => dim.getEntities({ type: "kq:dragon", location: at, maxDistance: 12 })) ?? [])[0];
    if (e) { safe(() => e.setProperty("kq:pose", 1)); safe(() => e.setProperty("kq:roar", true)); system.runTimeout(() => safe(() => e.setProperty("kq:roar", false)), 30); }
    for (const q of players()) {
      safe(() => q.playSound("random.levelup"));
      if (q.id === p?.id && e && flat(q.location, at) < 30) system.runTimeout(() => say(e, q, "kq_d_nest_1"), 10);
      else bookSays(q, "kq_d_b_nestdone", 10);
    }
  }
  function nestStep(p) {
    if (hayCount() >= HAY_NEEDED) return 5;
    if (n(p, "minecraft:hay_block")) return 3;
    if (n(p, "minecraft:wheat") >= 9) return 2;
    const f = center(D.field);
    if (n(p, "minecraft:wheat") > 0 || flat(p.location, f) < 14) return 1;
    return hayCount() > 0 ? 4 : 0;
  }
  // the field grows back while the nest is being made (in case it all got picked, or trampled)
  function fieldUpkeep() {
    const [x0, z0, x1, z1] = D.fieldBox, y = D.field[1];
    if (!nearAny({ x: (x0 + x1) / 2, z: (z0 + z1) / 2 }, 40)) return;
    let grown = 0;
    for (let tries = 0; tries < 30 && grown < 6; tries++) {
      const x = x0 + Math.floor(Math.random() * (x1 - x0 + 1)), z = z0 + Math.floor(Math.random() * (z1 - z0 + 1));
      if (players().some((q) => flat(q.location, { x, z }) < 6)) continue;
      const crop = safe(() => overworld().getBlock({ x, y, z })), soil = safe(() => overworld().getBlock({ x, y: y - 1, z }));
      if (!crop || !soil || soil.typeId === "minecraft:water") continue;
      const ripe = crop.typeId === "minecraft:wheat" && safe(() => crop.permutation.getState("growth")) === 7;
      if (ripe || !(crop.isAir || crop.typeId === "minecraft:wheat")) continue;
      if (!["minecraft:farmland", "minecraft:dirt", "minecraft:grass_block"].includes(soil.typeId)) continue;
      safe(() => soil.setPermutation(BlockPermutation.resolve("minecraft:farmland", { moisturized_amount: 7 })));
      safe(() => crop.setPermutation(BlockPermutation.resolve("minecraft:wheat", { growth: 7 })));
      grown++;
    }
  }

  // ---------------------------------------------------------------- quest 2: the track
  const onGap = (l) => D.gap.some(([x, y, z]) => x === Math.floor(l.x) && y === Math.floor(l.y) && z === Math.floor(l.z));
  function gapCount() {
    let c = 0;
    for (const [x, y, z] of D.gap) {
      const b = safe(() => overworld().getBlock({ x, y, z }));
      if (b === undefined) return world.getDynamicProperty("kq:track_fixed") === true ? D.gap.length : 0;
      if (RAILS.includes(b.typeId)) c++;
    }
    return c;
  }
  const isFixed = () => world.getDynamicProperty("kq:track_fixed") === true;
  function trackFixed(cheer) {
    if (isFixed()) return;
    world.setDynamicProperty("kq:track_fixed", true);
    if (cheer) for (const q of players()) safe(() => q.playSound("random.levelup"));
  }
  const ridingCart = (p) => safe(() => p.getComponent("minecraft:riding")?.entityRidingOn?.typeId) === "minecraft:minecart";
  function trackStep(p) {
    if (isFixed()) {
      if (ridingCart(p)) return 7;
      if (n(p, "minecraft:minecart")) return 6;
      return p.getDynamicProperty("kq:got_cart") === true ? 6 : 5;
    }
    const iron = n(p, "minecraft:iron_ingot"), raw = n(p, "minecraft:raw_iron") + n(p, "minecraft:iron_ore");
    if (n(p, "minecraft:rail") || gapCount() > 0) return 4;
    if (iron >= 6) return 3;
    if (iron + raw >= 6) return 2;
    const pick = Object.keys(carrying(p).ids).some((id) => id.endsWith("_pickaxe"));
    return pick ? 1 : 0;
  }
  function stationUpkeep(t) {
    const at = pebbleAt();
    if (!nearAny(at, 64)) return;
    const dim = overworld();
    let es = (safe(() => dim.getEntities({ type: "kq:clerk", location: at, maxDistance: 8 })) ?? []);
    for (const extra of es.slice(1)) safe(() => extra.remove());
    let e = es[0];
    if (!e) {
      e = safe(() => dim.spawnEntity("kq:clerk", at));
      if (e) { safe(() => e.setDynamicProperty("kq:key", "pebble")); safe(() => e.setProperty("kq:look", 6)); }
    }
    if (!e) return;
    if (e.getDynamicProperty("kq:key") !== "pebble") { safe(() => e.setDynamicProperty("kq:key", "pebble")); safe(() => e.setProperty("kq:look", 6)); }
    nameNpc(e, "kq_name_pebble", "Pebble");
    if (dist(e.location, at) > 0.3) safe(() => e.teleport(at));
    safe(() => e.setRotation({ x: 0, y: D.pebbleFacing }));
    if (ch2() === 3 && !isFixed() && t % 2 === 0 && gapCount() >= D.gap.length) trackFixed(true);
    if (ch2() === 3 && t % 30 === 0) stationStock();
  }
  // the station chest: a pickaxe and coal again if nobody has any
  function stationStock() {
    const [x, y, z] = D.stationChest;
    const inv = safe(() => overworld().getBlock({ x, y, z })?.getComponent("minecraft:inventory")?.container);
    if (!inv) return;
    const inChest = (test) => { for (let i = 0; i < inv.size; i++) { const it = inv.getItem(i); if (it && test(it.typeId)) return true; } return false; };
    const carried = (test) => players().some((p) => Object.keys(carrying(p).ids).some(test));
    const pick = (id) => id.endsWith("_pickaxe"), coal = (id) => id === "minecraft:coal" || id === "minecraft:charcoal";
    if (!carried(pick) && !inChest(pick)) safe(() => inv.addItem(new ItemStack("minecraft:stone_pickaxe", 1)));
    if (!carried(coal) && !inChest(coal)) safe(() => inv.addItem(new ItemStack("minecraft:coal", 4)));
    if (!inChest((id) => id === "minecraft:stick") && !carried((id) => id === "minecraft:stick")) safe(() => inv.addItem(new ItemStack("minecraft:stick", 2)));
  }
  // the ride: a player in a minecart at the far end has made it; one sitting still at the start gets a nudge
  const still = new Map();
  function rideCheck() {
    if (ch2() !== 3 || !isFixed()) return;
    const stop = center(D.stop), start = center(D.start);
    for (const p of players()) {
      if (!ridingCart(p)) { still.delete(p.id); continue; }
      if (dist(p.location, stop) < 7) return arrive(p);
      if (dist(p.location, start) < 2.5) {
        const k = (still.get(p.id) ?? 0) + 1;
        still.set(p.id, k);
        if (k === 3) safe(() => p.onScreenDisplay.setActionBar(`${PIC.button} Push the button! Off you go!`));
        if (k === 8) {                                             // (if the button didn't do it, off you go anyway)
          const cart = safe(() => p.getComponent("minecraft:riding").entityRidingOn);
          safe(() => cart.applyImpulse({ x: 0.6, y: 0, z: 0 }));
          still.set(p.id, 0);
        }
      } else still.delete(p.id);
    }
  }
  function arrive(p) {
    if (ch2() !== 3) return;
    setCh2(4);
    system.runTimeout(() => safe(openDoor), 30);
    const at = center(D.crystalStop), dim = overworld();
    for (let k = 0; k < 12; k++) safe(() => dim.spawnParticle("kq:sparkle", { x: at.x + Math.sin(k) * 2, y: at.y + 1 + (k % 3) * 0.5, z: at.z + Math.cos(k) * 2 }));
    for (const q of players()) {
      safe(() => q.playSound("random.levelup")); safe(() => q.playSound("random.orb", { pitch: 1.4 }));
      bookSays(q, "kq_d_arrive_1", 20);
    }
  }
  // the magic door into the caverns (part 2): a chime and a word when you walk up to it
  const doorNudged = new Map();
  function doorNudge(p) {
    if (ch2() >= 4 || (doorNudged.get(p.id) ?? -999) > system.currentTick - 200) return;
    const d = D.crystalDoor[4];
    if (Math.hypot(p.location.x - d[0] - 0.5, p.location.y - d[1], p.location.z - d[2] - 0.5) < 3) {
      doorNudged.set(p.id, system.currentTick);
      safe(() => p.playSound("note.chime"));
      safe(() => p.onScreenDisplay.setActionBar(`${PIC.crystal} The Crystal Caverns! The magic door opens soon.`));
    }
  }

  // ---------------------------------------------------------------- quest 3: the Crystal Caverns
  const inCaverns = (l) => { const [x0, y0, z0, x1, y1, z1] = D.caverns; return l.x >= x0 && l.x <= x1 + 1 && l.y >= y0 && l.y <= y1 + 1 && l.z >= z0 && l.z <= z1 + 1; };
  function torchList() { return safe(() => JSON.parse(world.getDynamicProperty("kq:torches") ?? "[]")) ?? []; }
  function torchCount() {
    const spots = torchList();
    const keep = spots.filter(([x, y, z]) => { const b = safe(() => overworld().getBlock({ x, y, z })); return !b || TORCH_IDS.includes(b.typeId); });
    if (keep.length !== spots.length) world.setDynamicProperty("kq:torches", JSON.stringify(keep));
    return Math.min(TORCHES, keep.length);
  }
  function openDoor() {
    const dim = overworld();
    let opened = false;
    for (const [x, y, z] of D.crystalDoor) {
      const b = safe(() => dim.getBlock({ x, y, z }));
      if (b?.typeId === "kq:magic_barrier") { safe(() => b.setType("minecraft:air")); opened = true; }
    }
    if (!opened) return;
    const [x, y, z] = D.crystalDoor[4];
    for (let k = 0; k < 14; k++) safe(() => dim.spawnParticle("kq:sparkle", { x: x + 0.5, y: y + (k % 4) * 0.6, z: z - 1 + (k % 3) }));
    for (const q of players()) if (flat(q.location, { x, z }) < 40) { safe(() => q.playSound("note.chime")); safe(() => q.playSound("random.orb", { pitch: 0.6 })); }
  }
  function caveStep(p) {
    if (n(p, "minecraft:amethyst_shard") >= SHARDS) return 3;
    if (torchCount() >= TORCHES) return 2;
    return n(p, "minecraft:torch") ? 1 : 0;
  }
  // Graham sniffs out crystals: sparkles from his nose toward the nearest one, and now and then a bark
  function grahamSniff(t) {
    for (const g of grahams()) {
      if (!inCaverns(g.location)) continue;
      let best, bd = 20;
      for (const [x, y, z] of D.clusters) {
        const d = Math.hypot(x + 0.5 - g.location.x, y - g.location.y, z + 0.5 - g.location.z);
        if (d >= bd) continue;
        const b = safe(() => overworld().getBlock({ x, y, z }));
        if (b?.typeId === "minecraft:amethyst_cluster") { best = { x: x + 0.5, y: y + 0.5, z: z + 0.5 }; bd = d; }
      }
      if (!best) continue;
      for (let k = 1; k <= 4; k++) {
        const f = k / 5;
        safe(() => overworld().spawnParticle("kq:sparkle", { x: g.location.x + (best.x - g.location.x) * f, y: g.location.y + 0.6 + (best.y - g.location.y) * f, z: g.location.z + (best.z - g.location.z) * f }));
      }
      if (t % 6 === 0) for (const q of players()) if (flat(q.location, g.location) < 24) safe(() => q.playSound("mob.wolf.bark", { location: g.location }));
    }
  }
  function takeShards(p) {
    const inv = safe(() => p.getComponent("minecraft:inventory").container);
    if (!inv) return false;
    let left = SHARDS;
    for (let i = 0; i < inv.size && left > 0; i++) {
      const it = inv.getItem(i);
      if (it?.typeId !== "minecraft:amethyst_shard") continue;
      const k = Math.min(left, it.amount);
      left -= k;
      if (it.amount - k <= 0) inv.setItem(i, undefined);
      else { it.amount -= k; inv.setItem(i, it); }
    }
    return left === 0;
  }
  function crystalsDelivered(p, e) {
    if (ch2() !== 4) return;
    world.setDynamicProperty("kq:wing", 1);
    setCh2(5);
    if (e) {
      safe(() => e.setProperty("kq:wing", 1));
      safe(() => e.setProperty("kq:roar", true));
      system.runTimeout(() => safe(() => e.setProperty("kq:roar", false)), 30);
      const at = e.location;
      for (let k = 0; k < 16; k++) safe(() => overworld().spawnParticle("kq:sparkle", { x: at.x - 3 - (k % 4), y: at.y + 1 + (k % 3) * 0.4, z: at.z - 1 + (k % 5) * 0.5 }));
    }
    for (const q of players()) safe(() => q.playSound("random.levelup"));
  }

  // ---------------------------------------------------------------- quest 4: the Glow Garden
  const inGarden = (l) => { const [x0, y0, z0, x1, y1, z1] = D.garden; return l.x >= x0 && l.x <= x1 + 1 && l.y >= y0 && l.y <= y1 + 1 && l.z >= z0 && l.z <= z1 + 1; };
  const isWool = (id) => id.endsWith("_wool");
  const woolCount = (p) => Object.entries(carrying(p).ids).reduce((a, [id, k]) => a + (isWool(id) ? k : 0), 0);
  const restingDragon = () => (safe(() => overworld().getEntities({ type: "kq:dragon" })) ?? []).find((e) => !e.getDynamicProperty("kq:flying"));
  function openMagic(spots) {
    let opened = false;
    for (const [x, y, z] of spots) {
      const b = safe(() => overworld().getBlock({ x, y, z }));
      if (b?.typeId === "kq:magic_barrier") { safe(() => b.setType("minecraft:air")); opened = true; }
    }
    if (!opened) return;
    const [x, y, z] = spots[Math.floor(spots.length / 2)];
    for (let k = 0; k < 12; k++) safe(() => overworld().spawnParticle("kq:sparkle", { x: x + 0.5, y: y + (k % 4) * 0.6, z: z - 1 + (k % 3) }));
    for (const q of players()) if (flat(q.location, { x, z }) < 40) safe(() => q.playSound("note.chime"));
  }
  function woolStep(p) {
    if (woolCount(p) >= WOOL) return 3;
    if (n(p, "minecraft:shears")) return 2;
    return n(p, "minecraft:iron_ingot") >= 2 ? 1 : 0;
  }
  // the lost sheep: up to 6 in the garden (more come if some are gone, while nobody is near where they appear)
  function sheepUpkeep() {
    const mid = center(D.gardenMiddle);
    if (!nearAny(mid, 56)) return;
    const dim = overworld();
    const flock = (safe(() => dim.getEntities({ type: "minecraft:sheep", tags: [SHEEP_TAG] })) ?? []).filter((e) => inGarden(e.location));
    if (flock.length >= 4) return;
    let need = 6 - flock.length;
    for (const sp of D.sheep) {
      if (need <= 0) break;
      const at = center(sp);
      if (players().some((q) => dist(q.location, at) < 10)) continue;
      const e = safe(() => dim.spawnEntity("minecraft:sheep", at));
      if (e) { safe(() => e.addTag(SHEEP_TAG)); need--; }
    }
  }
  // Graham herds them: a sheep near him that's away from you gets nudged your way
  function grahamHerd(t) {
    for (const g of grahams()) {
      if (!inGarden(g.location)) continue;
      const near = players().filter((q) => inGarden(q.location));
      if (!near.length) continue;
      let barked = false;
      for (const sh of safe(() => overworld().getEntities({ type: "minecraft:sheep", location: g.location, maxDistance: 9 })) ?? []) {
        const q = near.reduce((a, b) => (dist(a.location, sh.location) < dist(b.location, sh.location) ? a : b));
        const d = dist(q.location, sh.location);
        if (d < 4) continue;
        const k = 0.35 / d;
        safe(() => sh.applyImpulse({ x: (q.location.x - sh.location.x) * k, y: 0.12, z: (q.location.z - sh.location.z) * k }));
        barked = true;
      }
      if (barked && t % 4 === 0) for (const q of near) safe(() => q.playSound("mob.wolf.bark", { location: g.location }));
    }
  }
  function takeItems(p, test, count) {
    const inv = safe(() => p.getComponent("minecraft:inventory").container);
    if (!inv) return false;
    let left = count;
    for (let i = 0; i < inv.size && left > 0; i++) {
      const it = inv.getItem(i);
      if (!it || !test(it.typeId)) continue;
      const k = Math.min(left, it.amount);
      left -= k;
      if (it.amount - k <= 0) inv.setItem(i, undefined);
      else { it.amount -= k; inv.setItem(i, it); }
    }
    return left === 0;
  }
  function woolDelivered(p, e) {
    if (ch2() !== 5) return;
    world.setDynamicProperty("kq:wing", 2);
    setCh2(6);
    if (e) {
      safe(() => e.setProperty("kq:wing", 2));
      safe(() => e.setProperty("kq:roar", true));
      system.runTimeout(() => safe(() => e.setProperty("kq:roar", false)), 30);
      const at = e.location;
      for (let k = 0; k < 12; k++) safe(() => overworld().spawnParticle("minecraft:heart_particle", { x: at.x - 3 - (k % 4), y: at.y + 1.5 + (k % 3) * 0.4, z: at.z - 1 + (k % 5) * 0.5 }));
    }
    for (const q of players()) safe(() => q.playSound("random.levelup"));
  }
  // back to the dragon with what it needs: the train (from wherever the line ends), the stairs, the crater
  function backToDragon(p, stop) {
    const deep = p.location.y < D.dragon[1] - 8, atStation = flat(p.location, pebbleAt()) < 40;
    if (!deep) return { pts: D.trails.crash, seat: D.dragon, name: "Ender Dragon" };
    if (atStation) return { pts: [...D.trails.station].reverse(), seat: D.dragon, name: "Ender Dragon" };
    return { seat: stop, name: "Train" };
  }

  // ---------------------------------------------------------------- quest 5: the Deep Forge
  const inBox = (box, l) => { const [x0, y0, z0, x1, y1, z1] = box; return l.x >= x0 && l.x <= x1 + 1 && l.y >= y0 && l.y <= y1 + 1 && l.z >= z0 && l.z <= z1 + 1; };
  const inDeep = (l) => inBox(D.deep, l);
  const forgeOpen = () => world.getDynamicProperty("kq:forge_open") === true;
  const PICKS = ["minecraft:iron_pickaxe", "minecraft:diamond_pickaxe", "minecraft:netherite_pickaxe"];
  function forgeStep(p) {
    const ingots = n(p, "minecraft:gold_ingot");
    if (ingots >= GOLD) return 7;
    const strong = PICKS.some((id) => n(p, id));
    if (forgeOpen()) {
      if (ingots + n(p, "minecraft:raw_gold") + n(p, "minecraft:deepslate_gold_ore") + n(p, "minecraft:gold_ore") >= GOLD) return 6;
      return strong ? 5 : 1;
    }
    if (n(p, "minecraft:redstone_torch") || n(p, "minecraft:lever") || n(p, "minecraft:redstone_block")) return 4;
    if (n(p, "minecraft:redstone")) return 3;
    if (strong) return 2;
    return inDeep(p.location) ? 1 : 0;
  }
  function doorIsOpen() {
    const [x, y, z] = D.forgeDoor;
    const b = safe(() => overworld().getBlock({ x, y, z }));
    if (!b) return undefined;
    if (b.typeId !== "minecraft:iron_door") return true;                     // (broken or gone: it's open)
    return safe(() => b.permutation.getState("open_bit")) === true;
  }
  // Graham runs up to the forge and gets shut in; redstone at the door lets him out
  function forgeUpkeep(t) {
    const door = center(D.forgeDoor), inside = center(D.forgeInside);
    const here = players().filter((q) => inDeep(q.location));
    if (!here.length) return;
    const open = doorIsOpen();
    if (open === true && !forgeOpen()) {
      world.setDynamicProperty("kq:forge_open", true);
      for (let k = 0; k < 14; k++) safe(() => overworld().spawnParticle("kq:sparkle", { x: door.x + Math.sin(k), y: door.y + (k % 4) * 0.5, z: door.z - 0.5 + Math.cos(k) * 0.5 }));
      const shutIn = world.getDynamicProperty("kq:graham_shut_in") === true;
      world.setDynamicProperty("kq:graham_shut_in", false);
      for (const q of players()) {
        safe(() => q.playSound("random.levelup"));
        if (inDeep(q.location)) bookSays(q, shutIn ? "kq_d_b_forgeopen" : "kq_d_b_gold_5", 10);
      }
      if (shutIn) for (const g of grahams()) {
        for (let k = 0; k < 6; k++) safe(() => overworld().spawnParticle("minecraft:heart_particle", { x: g.location.x, y: g.location.y + 1 + k * 0.2, z: g.location.z }));
        for (const q of here) safe(() => q.playSound("mob.wolf.bark", { location: g.location }));
      }
      return;
    }
    if (forgeOpen()) return;
    // Graham dashes ahead to the door the first time you're near it together, and is shut in
    if (world.getDynamicProperty("kq:graham_shut_in") !== true && world.getDynamicProperty("kq:graham_ran") !== true) {
      const q = here.find((q) => dist(q.location, door) < 26);
      const g = q && grahams().find((g) => dist(g.location, q.location) < 20);
      if (g) {
        world.setDynamicProperty("kq:graham_ran", true);
        world.setDynamicProperty("kq:graham_shut_in", true);
        safe(() => g.teleport(inside));
        for (const p of here) {
          safe(() => p.playSound("mob.wolf.bark", { location: door }));
          safe(() => p.playSound("random.door_close", { location: door }));
          safe(() => p.onScreenDisplay.setActionBar(`${G.graham} Oh no! Graham ran into the forge and the door shut!`));
        }
      }
    }
    // shut in: whimpering behind the door (and kept inside, if he wandered off to you somehow)
    if (world.getDynamicProperty("kq:graham_shut_in") === true) {
      for (const g of grahams()) {
        if (!inBox(D.forge, g.location) && dist(g.location, inside) < 40) safe(() => g.teleport(inside));
        if (t % 3 === 0) for (const p of here) safe(() => p.playSound("mob.wolf.whine", { location: door }));
      }
    }
  }
  function goldDelivered(p, e) {
    if (ch2() !== 6) return;
    world.setDynamicProperty("kq:wing", 3);
    world.setDynamicProperty("kq:mend_day", safe(() => world.getDay()) ?? 0);
    setCh2(7);
    if (e) {
      safe(() => e.setProperty("kq:wing", 3));
      safe(() => e.setProperty("kq:roar", true));
      system.runTimeout(() => safe(() => e.setProperty("kq:roar", false)), 30);
      const at = e.location;
      for (let k = 0; k < 16; k++) safe(() => overworld().spawnParticle("kq:sparkle", { x: at.x - 3 - (k % 4), y: at.y + 1.5 + (k % 3) * 0.4, z: at.z - 1 + (k % 5) * 0.5 }));
    }
    for (const q of players()) safe(() => q.playSound("random.levelup"));
  }

  // ---------------------------------------------------------------- quest 6: mended, and the flight
  const hasBed = (p) => Object.keys(carrying(p).ids).some((id) => id.endsWith("_bed") || id === "minecraft:bed");
  // the morning after the gold (sleeping makes the night pass), when someone comes to the dragon
  function mendCheck() {
    const day = safe(() => world.getDay()) ?? 0, when = world.getDynamicProperty("kq:mend_day");
    const time = safe(() => world.getTimeOfDay()) ?? 6000;
    if (typeof when === "number" && day <= when) return;
    if (time > 12000) return;
    const p = players().find((q) => q.dimension.id === "minecraft:overworld" && flat(q.location, dragonAt()) < 24 && Math.abs(q.location.y - dragonAt().y) < 12);
    if (p) mended(p, false);
  }
  function mended(p, quick) {
    if (ch2() !== 7) return;
    setCh2(8);
    world.setDynamicProperty("kq:wing", 4);
    const e = restingDragon(), at = dragonAt(), dim = overworld();
    if (e) {
      safe(() => e.setProperty("kq:wing", 4));
      safe(() => e.setProperty("kq:pose", 3));
      safe(() => e.setProperty("kq:roar", true));
      system.runTimeout(() => safe(() => e.setProperty("kq:roar", false)), 40);
    }
    for (let k = 0; k < 24; k++) safe(() => dim.spawnParticle("kq:sparkle", { x: at.x - 4 + Math.sin(k) * 3, y: at.y + 2 + (k % 4) * 0.5, z: at.z + Math.cos(k) * 3 }));
    for (const q of players()) {
      safe(() => q.playSound("mob.enderdragon.growl", { location: at, volume: 2, pitch: 1.2 }));
      safe(() => q.playSound("random.levelup"));
    }
    if (p && e && flat(p.location, at) < 30) system.runTimeout(() => say(e, p, "kq_d_mended_1"), quick ? 1 : 30);
    for (const q of players()) if (q !== p) bookSays(q, "kq_d_b_fly", 30);
  }

  // The flight: a cutscene like the crash. Riders sit on its back (put there every tick), the camera follows
  // behind. Round all six castles, high up, and back down into the crater.
  let ride;
  const RIDE_SPEED = 1.5;                                        // blocks a tick
  function routePoints() {
    const K = api.KINGDOM, at = dragonAt(), H = 160;
    const ring = (name) => (K.rings ?? []).find((r) => r.name === name)?.center;
    const pts = [{ x: at.x, y: at.y, z: at.z }, { x: at.x, y: at.y + 25, z: at.z - 12 }, { x: 0, y: H - 30, z: K.spawn[2] }];
    const stops = [[K.princess[0], K.princess[2]], ring("ice"), ring("sky"), ring("spooky"), ring("knight"), ring("blaze"),
                   [K.princess[0] + 20, K.princess[2] + 20]];
    for (const c of stops) if (c) pts.push({ x: c[0], y: H, z: c[1] });
    pts.push({ x: 0, y: H - 50, z: at.z - 70 }, { x: at.x, y: at.y + 18, z: at.z - 20 }, { x: at.x, y: at.y, z: at.z });
    // even steps along the way, cornering smoothly (each point is the average of a few along the straight lines)
    const raw = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), n = Math.max(1, Math.ceil(len / RIDE_SPEED));
      for (let k = 0; k < n; k++) raw.push(lerp(a, b, k / n));
    }
    raw.push(pts[pts.length - 1]);
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const wdt = Math.min(12, i, raw.length - 1 - i);              // (narrower near the ends, so it starts and stops where it should)
      let sx = 0, sy = 0, sz = 0, c = 0;
      for (let j = i - wdt; j <= i + wdt; j++) { sx += raw[j].x; sy += raw[j].y; sz += raw[j].z; c++; }
      out.push({ x: sx / c, y: sy / c, z: sz / c });
    }
    return out;
  }
  function startRide(p) {
    const e = restingDragon() ?? safe(() => overworld().spawnEntity("kq:dragon", dragonAt()));
    if (!e || ride || scene) return;
    const at = dragonAt();
    const riders = players().filter((q) => q.dimension.id === "minecraft:overworld" && flat(q.location, at) < 24);
    if (!riders.includes(p)) riders.push(p);
    const dog = grahams().find((g) => riders.some((q) => dist(g.location, q.location) < 24));
    ride = { e, t: 0, path: routePoints(), riders, dog };
    safe(() => e.setDynamicProperty("kq:flying", true));
    safe(() => e.addTag(TAG));
    safe(() => e.setProperty("kq:pose", 2));
    for (const q of riders) {
      const r = safe(() => q.getRotation()) ?? { x: 0, y: 180 };
      safe(() => q.setDynamicProperty("kq:scene_home", JSON.stringify({ ...dragonAt(), x: at.x - 6, z: at.z - 4, rx: r.x, ry: r.y })));
      cmd(q, "inputpermission set @s movement disabled");
      cmd(q, "inputpermission set @s camera disabled");
      cmd(q, "hud @s hide");
      cmd(q, "camera @s fade time 0.3 0.4 0.8 color 0 0 0");
    }
    for (const q of players()) safe(() => q.playSound("mob.enderdragon.growl", { location: at, volume: 2, pitch: 1.1 }));
  }
  function rideTick() {
    const r = ride;
    if (!r) return;
    const t = ++r.t, i = Math.min(r.path.length - 1, t), pos = r.path[i];
    const ahead = r.path[Math.min(r.path.length - 1, i + 8)];
    const e = r.e;
    const ok = safe(() => (typeof e.isValid === "function" ? e.isValid() : e.isValid !== false));
    if (!ok) return endRide(true);
    safe(() => e.teleport(pos, { facingLocation: { x: ahead.x, y: pos.y, z: ahead.z } }));
    // on its back: riders side by side, Graham behind them
    const dx = ahead.x - pos.x, dz = ahead.z - pos.z, len = Math.hypot(dx, dz) || 1, fx = dx / len, fz = dz / len;
    r.riders.forEach((q, k) => {
      const side = (k - (r.riders.length - 1) / 2) * 0.9;
      safe(() => q.teleport({ x: pos.x - fx * 0.5 - fz * side, y: pos.y + 2.4, z: pos.z - fz * 0.5 + fx * side }, { facingLocation: { x: ahead.x, y: pos.y + 2.4, z: ahead.z } }));
    });
    if (r.dog) safe(() => r.dog.teleport({ x: pos.x - fx * 2.2, y: pos.y + 2.2, z: pos.z - fz * 2.2 }, { facingLocation: ahead }));
    // the camera: behind and above, following
    if (t % 3 === 0) {
      const cam = { x: pos.x - fx * 14, y: pos.y + 6, z: pos.z - fz * 14 };
      for (const q of r.riders) cmd(q, `camera @s set minecraft:free ease 0.2 linear pos ${xyz(cam)} facing @e[tag=${TAG},c=1]`);
    }
    if (t % 12 === 0) for (const q of r.riders) safe(() => q.playSound("mob.enderdragon.flap", { location: pos, volume: 1.5 }));
    if (t === 40 || t === Math.floor(r.path.length / 2)) for (const q of r.riders) safe(() => q.playSound("mob.enderdragon.growl", { volume: 1, pitch: 1.2 }));
    if (t % 6 === 0) safe(() => overworld().spawnParticle("kq:sparkle", { x: pos.x - fx * 4, y: pos.y + 1, z: pos.z - fz * 4 }));
    if (t === r.path.length - 30) for (const q of r.riders) cmd(q, "camera @s fade time 0.6 0.8 1 color 0 0 0");
    if (t >= r.path.length - 14) endRide(false);
  }
  function endRide(quiet) {
    const r = ride;
    if (!r) return;
    ride = undefined;
    const at = dragonAt(), dim = overworld();
    safe(() => r.e.teleport(at, { rotation: { x: 0, y: D.dragonFacing } }));
    safe(() => r.e.setDynamicProperty("kq:flying", undefined));
    safe(() => r.e.removeTag(TAG));
    safe(() => r.e.setProperty("kq:pose", 3));
    for (const q of r.riders) if (players().includes(q)) restore(q);
    if (r.dog) safe(() => r.dog.teleport({ x: at.x - 6, y: at.y + 3, z: at.z - 6 }));
    if (quiet) return;
    const first = ch2() === 8;
    if (first) setCh2(9);
    // fireworks over the crater
    for (let k = 0; k < 7; k++) system.runTimeout(() => safe(() => dim.spawnEntity("minecraft:fireworks_rocket",
      { x: at.x + (k - 3) * 4 + 0.5, y: at.y + 3, z: at.z - 12 + (k % 2) * 3 })), 20 + k * 8);
    for (const q of players()) {
      safe(() => q.playSound("random.levelup")); safe(() => q.playSound("firework.twinkle"));
      if (first) bookSays(q, "kq_d_end_1", 50);
    }
  }
  system.runInterval(() => { try { rideTick(); } catch (e) { console.warn?.("[Kingdom Quest] " + e); endRide(true); } }, 1);

  // ---------------------------------------------------------------- talking
  function lookingAt(p, at) {
    const d = safe(() => p.getViewDirection());
    if (!d) return false;
    const h = p.getHeadLocation?.() ?? { x: p.location.x, y: p.location.y + 1.6, z: p.location.z };
    const v = { x: at.x - h.x, y: at.y + 1 - h.y, z: at.z - h.z }, len = Math.hypot(v.x, v.y, v.z) || 1;
    return (d.x * v.x + d.y * v.y + d.z * v.z) / len > 0.75;
  }
  function tapDragon(p, e) {
    const s = ch2();
    p.setDynamicProperty("kq:dgreeted", true);
    if (s === 0) return;
    if (s <= 2) {
      if (!dmet(p, 1)) return say(e, p, "kq_d_intro_1");
      if (giveGuide(p)) return say(e, p, "kq_p_newbook");
      return say(e, p, "kq_d_wait_" + hayCount());
    }
    if (s === 3) return say(e, p, "kq_d_happy");
    if (s === 4) {
      if (n(p, "minecraft:amethyst_shard") >= SHARDS && takeShards(p)) { crystalsDelivered(p, e); return say(e, p, "kq_d_crystal_1"); }
      return say(e, p, "kq_d_needcrystals");
    }
    if (s === 5) {
      if (woolCount(p) >= WOOL && takeItems(p, isWool, WOOL)) { woolDelivered(p, e); return say(e, p, "kq_d_wool_1"); }
      return say(e, p, "kq_d_needwool");
    }
    if (s === 6) {
      if (n(p, "minecraft:gold_ingot") >= GOLD && takeItems(p, (id) => id === "minecraft:gold_ingot", GOLD)) { goldDelivered(p, e); return say(e, p, "kq_d_gold_1"); }
      return say(e, p, "kq_d_needgold");
    }
    if (s === 7) return say(e, p, "kq_d_mending");
    if (s === 8) return say(e, p, "kq_d_mended_3");
    return say(e, p, "kq_d_again");
  }
  function tapPebble(p, e) {
    const s = ch2();
    if (s < 3) return say(e, p, "kq_pb_hello");
    if (s >= 6) return say(e, p, "kq_pb_forge");
    if (s >= 5) return say(e, p, "kq_pb_garden");
    if (s >= 4) return say(e, p, "kq_pb_done");
    if (!dmet(p, 2)) return say(e, p, "kq_pb_intro_1");
    if (giveGuide(p)) return say(e, p, "kq_p_newbook");
    if (isFixed()) return say(e, p, p.getDynamicProperty("kq:got_cart") === true ? "kq_pb_ride" : "kq_pb_fixed_1");
    return say(e, p, "kq_pb_wait_" + Math.min(D.gap.length - 1, gapCount()));
  }
  function tap(p, e) {
    if (e.typeId === "kq:dragon") { tapDragon(p, e); return true; }
    if (e.typeId === "kq:clerk" && e.getDynamicProperty("kq:key") === "pebble") { tapPebble(p, e); return true; }
    return false;
  }
  function act(p, what) {
    if (what === "d_yes") {
      p.setDynamicProperty("kq:dmet1", true);
      if (ch2() === 1) setCh2(2);
      giveGuide(p);
      safe(() => p.playSound("random.orb", { pitch: 1.2 }));
      say(api.nearest(p, "kq:dragon", 16), p, "kq_d_thanks_1");
    } else if (what === "d_fly") {
      if (ch2() >= 8 && !ride && !scene) startRide(p);
    } else if (what === "pb_yes") {
      p.setDynamicProperty("kq:dmet2", true);
      giveGuide(p);
      safe(() => p.playSound("random.orb", { pitch: 1.2 }));
      say(api.nearest(p, "kq:clerk", 12), p, "kq_pb_thanks_1");
    } else if (what === "pb_cart") {
      if (!isFixed() || ch2() !== 3) return true;
      if (p.getDynamicProperty("kq:got_cart") !== true || !n(p, "minecraft:minecart")) {
        safe(() => p.getComponent("minecraft:inventory").container.addItem(new ItemStack("minecraft:minecart", 1)));
        p.setDynamicProperty("kq:got_cart", true);
        safe(() => p.playSound("random.pop"));
      }
      say(api.nearest(p, "kq:clerk", 12), p, "kq_pb_ride");
    } else return false;
    return true;
  }

  // ---------------------------------------------------------------- the How-To Book, hints and the arrow
  const NEST_HINTS = [[PIC.wheat, "Go to the wheat field by the dragon!"], [PIC.wheat, "Pick the wheat! Tap it."],
    [PIC.hay, "Make a hay bale: 9 wheat at a crafting table!"], [PIC.hay, "Put the hay bale down by the dragon!"],
    [PIC.hay, "Make more hay bales!"], [PIC.dragonHappy, "Tap the dragon!"]];
  const TRACK_HINTS = [[G.pickaxe, "Get a pickaxe and coal from the chest!"], [G.iron, "Mine iron in the walls: orange spots!"],
    [G.furnace, "Iron in the top of the furnace, coal in the bottom!"], [PIC.rail, "Make rails: 6 iron and 1 stick!"],
    [PIC.rail, "Put rails on the broken track!"], [PIC.pebble, "Tap Pebble!"],
    [PIC.minecart, "Put the minecart on the track. Get in!"], [PIC.button, "Push the button! Off you go!"]];
  const CAVE_HINTS = [[G.torch, "Make torches: coal on top of a stick!"], [G.torch, "Put torches on the walls in the caverns!"],
    [PIC.crystal, "Mine the purple crystals with a pickaxe!"], [PIC.dragonHappy, "Take the crystals to the dragon!"]];
  const WOOL_HINTS = [[G.iron, "Get 2 iron: mine it and smelt it!"], [G.shears, "Make shears: 2 iron, corner to corner!"],
    [PIC.sheep, "Ride to the Glow Garden. Shear the sheep!"], [PIC.dragonHappy, "Take the wool to the dragon!"]];
  const GOLD_HINTS = [[PIC.minecart, "Ride the forge train! Its door is by the south wall."],
    [G.pickaxe, "Make an iron pickaxe: 3 iron, 2 sticks!"], [PIC.redstone, "Mine redstone: rock with red spots!"],
    [PIC.redstone, "Make a redstone torch: redstone on a stick!"], [PIC.door, "Put the redstone torch right next to the door!"],
    [PIC.gold, "Mine the gold in the forge walls!"], [PIC.gold, "Melt the gold in the furnace!"],
    [PIC.dragonHappy, "Take the gold to the dragon!"]];
  function openGuide(p) {
    const s = ch2();
    if (s === 0) return false;
    // right by the dragon (it's huge, and a tap can miss it and land on the book instead): it talks to you
    // (once you've met it, only when you're looking at it, so the book's own pages are there too)
    const e = !ride && !scene && restingDragon();
    if (e && flat(p.location, dragonAt()) < 10 && Math.abs(p.location.y - dragonAt().y) < 7 && (!dmet(p, 1) || lookingAt(p, dragonAt()))) {
      tapDragon(p, e);
      return true;
    }
    if (s <= 2) return bookSays(p, !dmet(p, 1) ? "kq_d_find" : "kq_d_b_nest_" + nestStep(p)), true;
    if (s === 3) return bookSays(p, !dmet(p, 2) ? "kq_d_b_pebble" : "kq_d_b_track_" + trackStep(p)), true;
    if (s === 4) return bookSays(p, "kq_d_b_cave_" + caveStep(p)), true;
    if (s === 5) return bookSays(p, "kq_d_b_wool_" + woolStep(p)), true;
    if (s === 6) return bookSays(p, "kq_d_b_gold_" + forgeStep(p)), true;
    if (s === 7) return bookSays(p, "kq_d_b_mend_" + (hasBed(p) ? 1 : 0)), true;
    if (s === 8) return bookSays(p, "kq_d_b_fly"), true;
    bookSays(p, "kq_d_end_1");
    return true;
  }
  function hint(p) {
    const s = ch2();
    if (s === 0 || s >= 9) return undefined;
    if (s === 7) return hasBed(p) ? { key: "m1", text: `${G.bed} Put the bed by the dragon. Sleep when it gets dark!`, near: false }
      : { key: "m0", text: `${G.bed} Make a bed: 3 wool and 3 planks!`, near: false };
    if (s === 8) return { key: "fly", text: `${PIC.dragonHappy} Tap the dragon! Let's fly!`, near: false };
    if (s === 6) {
      const st = forgeStep(p), h = GOLD_HINTS[st];
      let text = `${h[0]} ${h[1]}`;
      if (st === 6 || st === 5) text = `${PIC.gold} Gold bars: ${n(p, "minecraft:gold_ingot")} of ${GOLD}! ${h[1]}`;
      return { key: "g" + st + (st >= 5 ? n(p, "minecraft:gold_ingot") : ""), text, near: inDeep(p.location) || st === 7 };
    }
    if (s === 5) {
      const st = woolStep(p), h = WOOL_HINTS[st];
      const text = st === 2 ? `${PIC.wool} Wool: ${woolCount(p)} of ${WOOL}! Shear the sheep in the Glow Garden.` : `${h[0]} ${h[1]}`;
      return { key: "w" + st + (st === 2 ? woolCount(p) : ""), text, near: inGarden(p.location) || st === 3 };
    }
    if (s === 4) {
      const st = caveStep(p), h = CAVE_HINTS[st];
      let text = `${h[0]} ${h[1]}`;
      if (st === 1) text = `${G.torch} Torches on the walls: ${torchCount()} of ${TORCHES}!`;
      if (st === 2) text = `${PIC.crystal} Crystals: ${n(p, "minecraft:amethyst_shard")} of ${SHARDS}! Mine them with a pickaxe.`;
      return { key: "c" + st + (st === 1 ? torchCount() : st === 2 ? n(p, "minecraft:amethyst_shard") : ""), text, near: inCaverns(p.location) || st === 3 };
    }
    if (s <= 2 && !dmet(p, 1)) return { key: "dfind", text: `${PIC.dragonSad} Something fell from the sky! Go and see!`, near: false };
    if (s === 2) {
      const st = nestStep(p), h = NEST_HINTS[st];
      const text = st === 4 ? `${PIC.hay} ${hayCount()} of ${HAY_NEEDED} hay bales. Make more!` : `${h[0]} ${h[1]}`;
      return { key: "n" + st + (st === 4 ? hayCount() : ""), text, near: flat(p.location, dragonAt()) < 80 };
    }
    if (s === 3) {
      if (!dmet(p, 2)) return { key: "dpebble", text: `${PIC.pebble} Go down the stairs by the dragon. Find Pebble!`, near: false };
      const st = trackStep(p), h = TRACK_HINTS[st];
      return { key: "t" + st, text: `${h[0]} ${h[1]}`, near: flat(p.location, pebbleAt()) < 60 };
    }
    return undefined;
  }
  function guideFor(p) {
    const s = ch2();
    if (s === 7 || s === 8) {
      if (p.location.y < D.dragon[1] - 8) return flat(p.location, pebbleAt()) < 40 ? { pts: [...D.trails.station].reverse(), seat: D.dragon, name: "Ender Dragon" } : undefined;
      return { pts: D.trails.crash, seat: D.dragon, name: "Ender Dragon" };
    }
    if (s === 1 || (s === 2 && !dmet(p, 1))) return { pts: D.trails.crash, seat: D.dragon, name: "Ender Dragon" };
    if (s === 2) {
      if (n(p, "minecraft:hay_block")) return { pts: D.trails.crash, seat: D.dragon, name: "Ender Dragon" };
      if (n(p, "minecraft:wheat") < 9 && hayCount() < HAY_NEEDED) return { pts: D.trails.field, seat: D.field, name: "Wheat field" };
      return undefined;
    }
    if (s === 3 && (!dmet(p, 2) || (isFixed() && p.getDynamicProperty("kq:got_cart") !== true)))
      return { pts: D.trails.station, seat: D.pebble, name: "Pebble" };
    if (s === 6) {
      const deep = p.location.y < D.dragon[1] - 8, atStation = flat(p.location, pebbleAt()) < 40;
      if (n(p, "minecraft:gold_ingot") >= GOLD) return backToDragon(p, D.stop3);
      if (inDeep(p.location)) return forgeOpen() ? { seat: D.forgeInside, name: "Gold" } : { seat: D.forgeDoor, name: "Forge door" };
      if (!deep) return { pts: D.trails.station, seat: D.start3, name: "Forge train" };
      if (atStation) return { seat: D.start3, name: "Forge train" };
      return { seat: D.deepStop, name: "Deep Forge" };
    }
    if (s === 5) {
      const deep = p.location.y < D.dragon[1] - 8, atStation = flat(p.location, pebbleAt()) < 40;
      if (woolCount(p) >= WOOL) return backToDragon(p, D.stop2);
      if (inGarden(p.location)) return { seat: D.gardenMiddle, name: "Sheep" };
      if (!deep) return { pts: D.trails.station, seat: D.start2, name: "Garden train" };
      if (atStation) return { seat: D.start2, name: "Garden train" };
      return { seat: D.gardenStop, name: "Glow Garden" };
    }
    if (s === 4) {
      const deep = p.location.y < D.dragon[1] - 8, atStation = flat(p.location, pebbleAt()) < 40;
      if (n(p, "minecraft:amethyst_shard") >= SHARDS) return backToDragon(p, D.stop);
      if (inCaverns(p.location)) return torchCount() >= TORCHES ? { seat: D.geode, name: "Crystals" } : undefined;
      if (!deep) return { pts: D.trails.station, seat: D.start, name: "Train" };
      if (atStation) return { seat: D.start, name: "Train" };
      return { seat: D.crystalStop, name: "Crystal Caverns" };
    }
    return undefined;
  }

  // ---------------------------------------------------------------- every second
  function upkeep(t) {
    if (stage() < 7) return;
    if (ch2() === 0) {
      const leader = readyToStart();
      if (leader) crash(leader);
      return;
    }
    if (!scene && !ride) safe(() => dragonUpkeep(t));
    if (!scene && ch2() >= 1 && !craterMade() && nearAny(dragonAt(), 48)) safe(craterCheck);
    if (ch2() >= 2) safe(() => stationUpkeep(t));
    if (ch2() === 2 && t % 20 === 0) safe(fieldUpkeep);
    for (const p of players()) if (ch2() >= 3 && p.dimension.id === "minecraft:overworld") doorNudge(p);
    if (ch2() >= 4 && t % 3 === 0 && nearAny(center(D.crystalStop), 40)) safe(openDoor);   // (if it was shut when she arrived)
    if (ch2() === 4 && t % 2 === 0) safe(() => grahamSniff(t));
    if (ch2() >= 5 && t % 3 === 1 && nearAny(pebbleAt(), 40)) safe(() => openMagic(D.l2door));
    if (ch2() >= 5 && t % 5 === 0) safe(sheepUpkeep);
    if (ch2() === 5 && t % 2 === 0) safe(() => grahamHerd(t));
    if (ch2() >= 6 && t % 3 === 2 && nearAny(pebbleAt(), 40)) safe(() => openMagic(D.l3door));
    if (ch2() === 6) safe(() => forgeUpkeep(t));
    if (ch2() === 7 && !ride) safe(mendCheck);
  }
  system.runInterval(() => { try { sceneTick(); } catch (e) { console.warn?.("[Kingdom Quest] " + e); if (scene && scene.t > SCENE_LEN) finishScene(); } }, 1);
  system.runInterval(() => safe(rideCheck), 10);
  world.afterEvents.playerPlaceBlock?.subscribe((ev) => { try { onPlace(ev); } catch (e) { console.warn?.("[Kingdom Quest] " + e); } });

  // ---------------------------------------------------------------- a world that starts at Chapter 2
  // (make_princess_world.py --start-chapter2 puts a lodestone under the spawn.) On the first visit: Chapter 1 is
  // over, the gates are open, Graham is the first player's dog, everyone has a How-To Book, and the dragon comes
  // in about half a minute later.
  function startHere(p) {
    if (!p || world.getDynamicProperty("kq:stage") !== undefined || !D.startMarker) return false;
    const [x, y, z, id] = D.startMarker;
    const b = safe(() => overworld().getBlock({ x, y, z }));
    if (!b || b.typeId !== id) return false;
    api.setStage(7);
    world.setDynamicProperty("kq:end_day", -1);
    safe(api.clearBarriers);
    const g = api.newGraham({ x: p.location.x + 2, y: p.location.y, z: p.location.z + 1 }, "kq:follow");
    if (g) {
      safe(() => g.getComponent("minecraft:tameable").tame(p));
      world.setDynamicProperty("kq:graham_pet", true);
    }
    for (const q of players()) giveGuide(q);
    return true;
  }

  // ---------------------------------------------------------------- grown-ups
  function unlock() {
    const s = ch2(), p = players()[0];
    if (s === 0) crash(p);
    else if (s === 1) setCh2(2);
    else if (s === 2) nestDone(p);
    else if (s === 3 && !isFixed()) {
      for (const [x, y, z] of D.gap) safe(() => overworld().getBlock({ x, y, z })?.setPermutation(BlockPermutation.resolve("minecraft:rail", { rail_direction: 1 })));
      trackFixed(true);
    } else if (s === 3 && p) arrive(p);
    else if (s === 4) { safe(openDoor); crystalsDelivered(p, restingDragon()); }
    else if (s === 5) woolDelivered(p, restingDragon());
    else if (s === 6) { world.setDynamicProperty("kq:forge_open", true); goldDelivered(p, restingDragon()); }
    else if (s === 7) mended(p, true);
    else if (s === 8 && p) { if (scene) finishScene(); startRide(p); }
  }
  function reset() {
    setCh2(0);
    world.setDynamicProperty("kq:hay", "[]");
    world.setDynamicProperty("kq:torches", "[]");
    world.setDynamicProperty("kq:forge_open", false);
    world.setDynamicProperty("kq:graham_shut_in", false);
    world.setDynamicProperty("kq:graham_ran", false);
    world.setDynamicProperty("kq:track_fixed", false);
    world.setDynamicProperty("kq:wing", 0);
    world.setDynamicProperty("kq:end_day", undefined);
    if (scene) finishScene();
    if (ride) endRide(true);
    world.setDynamicProperty("kq:mend_day", undefined);
    // (the crater stays dug: kq:crater_made stays as it is)
    for (const e of safe(() => overworld().getEntities({ type: "kq:dragon" })) ?? []) safe(() => e.remove());
    for (const [x, y, z] of D.gap) { const b = safe(() => overworld().getBlock({ x, y, z })); if (b && RAILS.includes(b.typeId)) safe(() => b.setType("minecraft:air")); }
    for (const p of players()) for (const k of ["kq:dmet1", "kq:dmet2", "kq:got_cart", "kq:dgreeted"]) p.setDynamicProperty(k, undefined);
  }

  return {
    active: () => stage() >= 7 && ch2() > 0, ch2, startHere, tap, act, openGuide, hint, guideFor, upkeep, unlock, reset,
    start: () => { if (ch2() === 0) crash(players()[0]); },
    test: { hayCount, gapCount, nestStep, trackStep, isFixed, torchCount, caveStep, woolStep, woolCount, forgeStep, forgeOpen,
      rideActive: () => !!ride, route: () => routePoints(), craterMade, sceneActive: () => !!scene },
  };
}
