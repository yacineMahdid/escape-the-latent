# Escape the Latent

A cozy paper-diorama game. You are tiny: small enough to stand on
the desk of **Jean-Lafontaine de Becancourt**, a normal-sized, permanently
irritated old scientist with long black hair, a black beard and big eyebrows
(he only looks giant because you are tiny). He sends you off his desk (slide
down the ruler) and through a little door in the wall into small, real worlds,
to bring back knowledge. In each world (Paper Mario-style layered dioramas,
Animal Crossing-style villagers) the villagers' trouble *is* the idea of a
famous machine learning paper. You get through it by actually reading the
paper, in the Cursed Book of Dimensionality.

The first three papers were picked by their **alphaXiv votes**:

| Region | Paper | alphaXiv votes* |
|---|---|---|
| Attendale (meadow) | *Attention Is All You Need* (Vaswani et al., 2017) | 1,182 |
| CLIP island (tropic) | *Learning Transferable Visual Models From Natural Language Supervision* (Radford et al., 2021) | 584 |
| Mamba desert | *Mamba: Linear-Time Sequence Modeling with Selective State Spaces* (Gu & Dao, 2023) | 550 |

\*public votes when the game was made; the map shows live numbers.

## Run it

Needs Node 18.17+.

```bash
npm install
```

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Then open http://localhost:3000.

The key powers three things, all on the server (the key never reaches the browser):

* **The Cursed Book of Dimensionality** answers your questions about the paper, tersely, and refuses
  anything that would solve a challenge for you.
* **Your character** is generated from a photo you give it (sent once, never stored).
* **Explanations** you give to villagers are graded against a rubric.

Without a key the game still works end to end: a manual character creator, a book
that only mutters cryptic hints, and keyword-based grading.

## How to play

* Move with the arrow keys or WASD. Up and down walk deeper or closer: paths,
  stairs and bridges lead to other layers of the diorama.
* **E** or **Space** talks to villagers and uses things.
* **B** opens the Cursed Book of Dimensionality: the real arXiv PDF, highlights and notes, an Ask tab,
  and the **Learned** pages where the book records basic concepts you have shown
  you understand (it never asks you about those again, in any world). B also works
  on top of a puzzle board.
* **M** opens Becancourt's map in the lab, or leaves a region. To travel, walk down
  the ruler to the little door in the wall.
* **Esc** pauses.

Each world asks a lot of you: basic-concept questions from the villagers, two
hands-on board puzzles, a Python coding challenge (runs in your browser with
Pyodide and numpy), an explain-it conversation, a Mario Party-style mini-game,
a puzzle you solve by walking around the world itself, and a villager's quiz.
Each world's landmark machine (the Listening Bell, the Twin Lens, the Belly
Scanner) wakes up as you go. Win the artefact, carry it back through the little
door, put it in Becancourt's hands, enjoy his face.

## Project layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the contracts between the
server, the UI modules and the region content files in `content/regions/`.

```bash
npm test        # server tests (offline, with a stubbed Claude client)
```

With the server running, the browser tests drive the real game headless (they need
Playwright and set `BASE`, e.g. `BASE=http://localhost:3000`):

```bash
BASE=http://localhost:3000 npm run test:puzzles
```

```bash
BASE=http://localhost:3000 npm run test:play
```

```bash
BASE=http://localhost:3000 npm run test:extras
```

`test:puzzles` solves every board puzzle on its own page; `test:play` walks to
each puzzle's villager inside the worlds, solves it and picks up the artefact;
`test:extras` plays each world's mini-game, world puzzle and quiz in the game
(solvers in `test/play/extras/`).

Dev pages: `/dev/puzzle.html?region=attention&challenge=c1` (one board puzzle),
`/dev/minigame.html?region=clip&challenge=m1` (one mini-game), `/dev/kit.html`
(the board kit), `/dev/landmarks.html?m=bell` (the landmark and artefact models),
`/dev/scientist.html` (Becancourt).
