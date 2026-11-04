# Status (end of day, 2026-11-04)

## Playable now (main)

The whole game, start to finish, in offline mode or with a key (`npm start`, `npm run start:claude`):
character creator, Becancourt's lab (true scale: desk, ruler, floor, little door), three worlds
(Attendale, CLIP, Mamba) behind the little door, each with basic-concept questions, two board puzzles,
a Python challenge, an explain-it chat, a Mario Party-style mini-game, a walk-around world puzzle and a
quiz; artefacts on bottle caps, the finale and the ending.

Recent changes: Animal Crossing-style facing; villagers that stroll, look around, hop and turn to wave
when you come close; no special name for the player; known concepts are never asked again; the book
builds on the player's Learned pages.

## Tests

- `npm test`: 175 server tests pass.
- `BASE=… npm run test:puzzles`: all six board puzzles pass.
- `BASE=… npm run test:play`: every board puzzle and artefact pickup passes in all three worlds.
- `BASE=… npm run test:extras`: Attendale, CLIP and Mamba pass end to end (mini-game, world puzzle,
  quiz, artefact).

## Next

- A fresh first-time play-through of the Mamba mini-game, world puzzle and quiz (their polish pass
  is done and passes its in-game run; the independent review did not run yet).
- Small leftovers from the movement review (in the review notes, not yet done): the player's walk is
  still a glide in two world puzzles (ear-jobs stepAside, parcel-day watch spot), and internal
  identifiers in raft-rush.js / parcel-day.js still say "speck" (never shown to the player).
- Whatever comes out of play-testing.
