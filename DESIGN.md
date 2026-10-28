# Design rules

How the add-ons should look and feel for the player. Follow these when adding or changing anything.

## No big on-screen titles

Don't use the big title and subtitle across the middle of the screen (`player.onScreenDisplay.setTitle`).
It covers the exact thing the player wants to look at, like the puppy that just hatched or the dog that just
grew, and it can't be dismissed, so it feels frustrating.

Instead:

- **Small note above the hotbar** for the moment itself: `player.onScreenDisplay.setActionBar("§6Meet Duke, your new puppy!")`.
  Keep it to one short line.
- **Chat message** (`player.sendMessage`) for anything longer or worth reading again, like instructions or tips.
  The chat stays put after the note fades.

Example from Alpha Dog: hatching shows "Meet Duke, your new puppy!" above the hotbar, and the chat says how to
feed, pet, and rename him.

Some older add-ons still use big titles (Fairy Friends, House Blueprint, Maze Wand, Pip's Quests, Santa's Visit,
Unicorn Princess). Switch them to small notes the next time they're changed.
