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
// (Part 2, still to come: the Crystal Caverns, the Glow Garden, the Deep Forge, and the flight over the kingdom.)
//
// Progress is the world property kq:ch2: 0 not started, 1 the crash has happened, 2 making the nest, 3 the track,
// 4 arrived at the Crystal Caverns (the end of part 1). Each player remembers meeting the dragon (kq:dmet1) and
// Pebble (kq:dmet2), and getting a minecart (kq:got_cart).
// main.js hands over taps, buttons, the How-To Book, the hints and the arrow once Chapter 1 is over (kq:stage 7).
// Grown-ups: /scriptevent kq:ch2 starts it now; kq:unlock finishes the step you're on; kq:ch2reset starts it again.

import { world, system, ItemStack, BlockPermutation } from "@minecraft/server";
import { DRAGON } from "./dragon_data.js";

export function initChapter2(api) {
  const { say, nameNpc, bookFor, bookSays, carrying, has, G, safe, players, overworld, center, dist, flat, stage, giveGuide, grahams } = api;
  const D = DRAGON;
  const HAY_NEEDED = 4;
  const NEAR = 56;
  const RAILS = ["minecraft:rail", "minecraft:golden_rail", "minecraft:detector_rail", "minecraft:activator_rail"];
  const PIC = {
    dragonSad: "", dragonHappy: "", wheat: "", hay: "", rail: "", minecart: "",
    pebble: "", crystal: "", button: "", boom: "",
  };

  const ch2 = () => world.getDynamicProperty("kq:ch2") ?? 0;
  const setCh2 = (n) => world.setDynamicProperty("kq:ch2", n);
  const dmet = (p, n) => p.getDynamicProperty("kq:dmet" + n) === true;
  const nearAny = (loc, r = NEAR) => players().some((p) => p.dimension.id === "minecraft:overworld" && flat(p.location, loc) <= r);
  const dragonAt = () => center(D.dragon);
  const pebbleAt = () => center(D.pebble);
  const n = (p, id) => carrying(p).ids[id] ?? 0;

  // ---------------------------------------------------------------- the crash
  // Starts the day after Chapter 1 ends (or soon after this update, if that was before), in the daytime, with
  // someone near the castle or the spawn. Rain, not thunder: lightning could set the castles alight.
  let flight;                                                     // the dragon flying in, while it is in the air
  function regionMissing() {
    const [x, y, z, id] = D.marker;
    const b = safe(() => overworld().getBlock({ x, y, z }));
    return b !== undefined && b.typeId !== id;                    // (not loaded: can't tell, so carry on)
  }
  function readyToStart() {
    if (stage() < 7 || ch2() !== 0 || flight) return undefined;
    const end = world.getDynamicProperty("kq:end_day");
    const day = safe(() => world.getDay()) ?? 0;
    if (typeof end === "number" && day <= end) return undefined;
    const time = safe(() => world.getTimeOfDay()) ?? 6000;
    if (time < 1000 || time > 11000) return undefined;
    if (system.currentTick < 600) return undefined;
    return players().find((p) => p.dimension.id === "minecraft:overworld" && flat(p.location, { x: 0, z: 60 }) < 170);
  }
  function crash(leader) {
    if (ch2() !== 0) return;
    if (regionMissing()) { world.setDynamicProperty("kq:ch2_missing", true); return; }
    setCh2(1);
    const dim = overworld();
    safe(() => (dim.runCommand ?? dim.runCommandAsync).call(dim, "weather rain 60"));                // dark and rainy (no lightning: no fires)
    for (const q of players()) {
      safe(() => q.playSound("mob.enderdragon.growl", { volume: 1, pitch: 0.8 }));
      safe(() => q.runCommand?.("camerashake add @s 0.25 2 positional"));
    }
    // fly in from the north, over the leader's head, toward the crater, wobbling and trailing smoke
    const to = { x: D.crater[0] + 0.5, y: D.crater[1] + 2, z: D.crater[2] + 0.5 };
    const l = leader?.location ?? { x: 0, y: D.dragon[1], z: 60 };
    const from = { x: l.x - 12, y: l.y + 30, z: l.z - 50 };
    const e = safe(() => dim.spawnEntity("kq:dragon", from));
    if (e) {
      safe(() => e.setDynamicProperty("kq:flying", true));
      safe(() => e.setProperty("kq:pose", 2));
      safe(() => e.setProperty("kq:wing", 0));
    }
    flight = { e, from, to, t: 0, len: Math.max(40, flat(from, to)), boomed: false };
    system.runTimeout(() => {
      for (const q of players()) bookSays(q, "kq_d_crash_1", 2);
    }, 20 * 14);
    system.runTimeout(() => safe(() => { const d = overworld(); (d.runCommand ?? d.runCommandAsync).call(d, "weather clear"); }), 20 * 50);
  }
  function flightTick() {
    const f = flight;
    if (!f) return;
    f.t += 1;
    const speed = 0.9, k = Math.min(1, (f.t * speed) / f.len);
    const wob = Math.sin(f.t * 0.25) * 2.5;
    const dx = f.to.x - f.from.x, dz = f.to.z - f.from.z, len = Math.hypot(dx, dz) || 1;
    const side = { x: -dz / len, z: dx / len };
    const pos = {
      x: f.from.x + dx * k + side.x * wob, z: f.from.z + dz * k + side.z * wob,
      y: f.from.y + (f.to.y - f.from.y) * Math.pow(k, 1.6) + Math.sin(f.t * 0.4) * 0.6,
    };
    const e = f.e;
    const loaded = e && safe(() => (typeof e.isValid === "function" ? e.isValid() : e.isValid !== false));
    if (loaded) {
      safe(() => e.teleport(pos, { facingLocation: { x: f.to.x, y: pos.y, z: f.to.z } }));
      if (f.t % 2 === 0) safe(() => overworld().spawnParticle("minecraft:basic_smoke_particle", { x: pos.x - side.x * 3, y: pos.y + 2, z: pos.z - side.z * 3 }));
      if (f.t % 12 === 0) for (const q of players()) if (flat(q.location, pos) < 90) safe(() => q.playSound("mob.enderdragon.flap", { location: pos, volume: 2 }));
      if (f.t === 60) for (const q of players()) safe(() => q.playSound("mob.enderdragon.growl", { location: pos, volume: 3 }));
    }
    const gone = !loaded || !nearAny(pos, 80);
    if (k >= 1 || (gone && f.t > 40)) {
      // down it goes: a boom you hear (and feel) from anywhere, and the flying dragon is put away; the resting
      // one is waiting in the crater when someone gets there
      const wait = gone && k < 1 ? Math.round((1 - k) * f.len / speed / 2) : 0;
      if (loaded) safe(() => e.remove());
      flight = undefined;
      system.runTimeout(() => {
        const dim = overworld();
        for (let i = 0; i < 6; i++) safe(() => dim.spawnParticle("minecraft:huge_explosion_emitter",
          { x: f.to.x + Math.sin(i) * 4, y: f.to.y, z: f.to.z + Math.cos(i) * 4 }));
        for (const q of players()) {
          safe(() => q.playSound("random.explode", { volume: 1, pitch: 0.5 }));
          safe(() => q.runCommand?.("camerashake add @s 0.6 1.2 positional"));
        }
      }, Math.max(1, Math.min(wait, 200)));
    }
  }

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
    const pose = ch2() >= 3 ? 1 : 0;
    if (safe(() => e.getProperty("kq:pose")) !== pose) safe(() => e.setProperty("kq:pose", pose));
    const wing = world.getDynamicProperty("kq:wing") ?? 0;
    if (safe(() => e.getProperty("kq:wing")) !== wing) safe(() => e.setProperty("kq:wing", wing));
    // hurt: smoke still rising from the crater, and now and then a sad rumble; happy: hearts
    if (pose === 0 && t % 2 === 0) for (let k = 0; k < 3; k++)
      safe(() => dim.spawnParticle("minecraft:basic_smoke_particle", { x: at.x - 5 + k * 1.5, y: at.y + 1.5, z: at.z + 2 - k }));
    if (pose === 0 && t % 9 === 0) for (const q of players()) if (flat(q.location, at) < 40) safe(() => q.playSound("mob.enderdragon.growl", { location: at, volume: 0.6, pitch: 0.6 }));
    if (pose === 1 && t % 4 === 0) safe(() => dim.spawnParticle("minecraft:heart_particle", { x: at.x, y: at.y + 4, z: at.z - 4 }));
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
    if ((doorNudged.get(p.id) ?? -999) > system.currentTick - 200) return;
    const d = D.crystalDoor[4];
    if (Math.hypot(p.location.x - d[0] - 0.5, p.location.y - d[1], p.location.z - d[2] - 0.5) < 3) {
      doorNudged.set(p.id, system.currentTick);
      safe(() => p.playSound("note.chime"));
      safe(() => p.onScreenDisplay.setActionBar(`${PIC.crystal} The Crystal Caverns! The magic door opens soon.`));
    }
  }

  // ---------------------------------------------------------------- talking
  function tapDragon(p, e) {
    const s = ch2();
    if (s === 0) return;
    if (s <= 2) {
      if (!dmet(p, 1)) return say(e, p, "kq_d_intro_1");
      if (giveGuide(p)) return say(e, p, "kq_p_newbook");
      return say(e, p, "kq_d_wait_" + hayCount());
    }
    if (s === 3) return say(e, p, "kq_d_happy");
    return say(e, p, "kq_d_part2");
  }
  function tapPebble(p, e) {
    const s = ch2();
    if (s < 3) return say(e, p, "kq_pb_hello");
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
  function openGuide(p) {
    const s = ch2();
    if (s === 0) return false;
    if (s <= 2) return bookSays(p, !dmet(p, 1) ? "kq_d_find" : "kq_d_b_nest_" + nestStep(p)), true;
    if (s === 3) return bookSays(p, !dmet(p, 2) ? "kq_d_b_pebble" : "kq_d_b_track_" + trackStep(p)), true;
    bookSays(p, "kq_d_arrive_1");
    return true;
  }
  function hint(p) {
    const s = ch2();
    if (s === 0 || s >= 4) return undefined;
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
    if (s === 1 || (s === 2 && !dmet(p, 1))) return { pts: D.trails.crash, seat: D.dragon, name: "Ender Dragon" };
    if (s === 2) {
      if (n(p, "minecraft:hay_block")) return { pts: D.trails.crash, seat: D.dragon, name: "Ender Dragon" };
      if (n(p, "minecraft:wheat") < 9 && hayCount() < HAY_NEEDED) return { pts: D.trails.field, seat: D.field, name: "Wheat field" };
      return undefined;
    }
    if (s === 3 && (!dmet(p, 2) || (isFixed() && p.getDynamicProperty("kq:got_cart") !== true)))
      return { pts: D.trails.station, seat: D.pebble, name: "Pebble" };
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
    safe(() => dragonUpkeep(t));
    if (ch2() >= 2) safe(() => stationUpkeep(t));
    if (ch2() === 2 && t % 20 === 0) safe(fieldUpkeep);
    for (const p of players()) if (ch2() >= 3 && p.dimension.id === "minecraft:overworld") doorNudge(p);
  }
  system.runInterval(() => safe(flightTick), 1);
  system.runInterval(() => safe(rideCheck), 10);
  world.afterEvents.playerPlaceBlock?.subscribe((ev) => { try { onPlace(ev); } catch (e) { console.warn?.("[Kingdom Quest] " + e); } });

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
  }
  function reset() {
    setCh2(0);
    world.setDynamicProperty("kq:hay", "[]");
    world.setDynamicProperty("kq:track_fixed", false);
    world.setDynamicProperty("kq:wing", 0);
    world.setDynamicProperty("kq:end_day", undefined);
    flight = undefined;
    for (const e of safe(() => overworld().getEntities({ type: "kq:dragon" })) ?? []) safe(() => e.remove());
    for (const [x, y, z] of D.gap) { const b = safe(() => overworld().getBlock({ x, y, z })); if (b && RAILS.includes(b.typeId)) safe(() => b.setType("minecraft:air")); }
    for (const p of players()) for (const k of ["kq:dmet1", "kq:dmet2", "kq:got_cart"]) p.setDynamicProperty(k, undefined);
  }

  return {
    active: () => stage() >= 7 && ch2() > 0, ch2, tap, act, openGuide, hint, guideFor, upkeep, unlock, reset,
    start: () => { if (ch2() === 0) crash(players()[0]); },
    test: { hayCount, gapCount, nestStep, trackStep, isFixed, flightActive: () => !!flight },
  };
}
