# Escape the Latent

A cozy paper-diorama game where you, a tiny human, are sent by **Professor Grumm**,
an enormous and permanently irritated scientist, to bring back knowledge from
famous machine learning papers. Each paper is a little world (Paper Mario-style
layered dioramas, Animal Crossing-style villagers) whose story *is* the paper's
idea. You get through it by actually reading the paper.

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

* **The Umbral Book** answers your questions about the paper, tersely, and refuses
  anything that would solve a challenge for you.
* **Your character** is generated from a photo you give it (sent once, never stored).
* **Explanations** you give to villagers are graded against a rubric.

Without a key the game still works end to end: a manual character creator, a book
that only mutters cryptic hints, and keyword-based grading.

## How to play

* Move with the arrow keys or WASD. Up and down walk deeper or closer: paths,
  stairs and bridges lead to other layers of the diorama.
* **E** or **Space** talks to villagers and uses things.
* **B** opens the Umbral Book: the real arXiv PDF, highlights and notes, an Ask tab,
  and the **Learned** pages where the book records basic concepts you have shown
  you understand (it never asks you about those again).
* **M** opens Grumm's map in the lab, or leaves a region.

Each region has world puzzles, a Python coding challenge (runs in your browser
with Pyodide and numpy) and an explain-it conversation. Win the artefact, bring
it back to Grumm, enjoy his face.

## Project layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the contracts between the
server, the UI modules and the region content files in `content/regions/`.

```bash
npm test        # server tests (offline, with a stubbed Claude client)
```
