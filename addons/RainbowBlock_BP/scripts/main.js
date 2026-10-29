// Rainbow Block: hands every player a stack of Rainbow Blocks the first time they join.
// The block itself is plain data (blocks/rainbow_block.json); this script is only the gift.
import { world, system, ItemStack } from "@minecraft/server";

const BLOCK_ID = "rainbow:rainbow_block";

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    try {
      if (player.getDynamicProperty("rainbowblock:got_blocks")) return;
      const inv = player.getComponent("minecraft:inventory").container;
      const leftover = inv.addItem(new ItemStack(BLOCK_ID, 64));
      if (leftover) player.dimension.spawnItem(leftover, player.location);
      player.setDynamicProperty("rainbowblock:got_blocks", true);
      player.playSound("random.pop", { volume: 0.8, pitch: 1.2 });
    } catch (e) {
      console.warn(`Rainbow Block: couldn't give blocks: ${e}`);
    }
  }, 40);
});
