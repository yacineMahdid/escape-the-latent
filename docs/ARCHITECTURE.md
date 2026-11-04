# Escape the Latent: architecture and contracts

This file is the single source of truth for how the pieces fit. Every module
author (human or agent) builds against these contracts. If you need to change a
contract, change this file in the same commit.

## The game in one paragraph

You are a **Speck**: a human about the height of a coffee mug. **Professor
Grumm** is a normal-sized, grumpy human scientist; he only looks giant because
you are tiny. The hub is his desk. He sends you on "impossible" errands into
**the Latent**: small paper worlds folded from famous machine learning papers.
Each paper is a **region** on a paper map, rendered as a layered paper diorama
(Paper Mario world layout, Animal Crossing characters, everything at your
scale). Each region has a small, child-like story whose problem *is* the
paper's core idea. You solve it by actually reading the paper (inside the game,
in your **dark book**), then passing hands-on world puzzles, a Python coding
challenge and an "explain it" conversation graded by Claude. You win an **artefact**, bring it back, and
Grumm is (grudgingly) astonished. The game does not hold your hand.

### Scale (keep it consistent)

- Grumm is **normal-sized**. Narration, UI and docs never call him a giant.
  Latent villagers may call him "your giant": that is their point of view.
- The Speck and everything in the Latent share one small scale (the player and
  villagers are about 1.9 units tall).
- Lab: the desk top is the walkable world at `y = 0`; the room floor is at
  `y = -9.5`; Grumm is `buildScientist()` scaled by 2.42 (~23 units tall,
  about 12x the Speck), standing on the floor behind the desk.

## Run it

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start     # http://localhost:3000
```

Without a key the game still runs: manual character creator, the book only
mutters pre-written cryptic hints, and explanations are graded offline with
keyword rubrics.

## Repo layout and ownership

```
server/                 Node server (no framework)            owner: server
  index.js              static files + routing
  ai.js                 Claude calls (book, avatar, grade)
  papers.js             arXiv PDF + alphaXiv text/metadata proxy with disk cache
  regions.js            loads content/regions/*.json (server-side copy)
  solutions/*.py        reference solutions for code challenges (never served)
content/regions/*.json  region content (served at /content/regions/<id>.json)
public/
  index.html            entry; import map; #game canvas host; #ui-root
  css/game.css          base theme variables + shared UI (dialogue, HUD)
  css/book.css          dark book                                 owner: book
  css/creator.css       character creator                         owner: creator
  css/terminal.css      python terminal + explain UI              owner: terminal
  css/puzzles.css       world puzzle overlays                     owner: puzzles
  js/main.js            boot + scene state machine                owner: core
  js/api.js             fetch wrappers for /api/*                 owner: core
  js/engine/            three.js world builder, biomes, villagers owner: core
  js/engine/humans.js   human player + scientist models           owner: creator
  js/game/              save, dialogue, scenes (title/lab/map/region/ending) owner: core
  js/ui/modal.js        modal stack (pauses game input)           owner: core
  js/ui/book.js         dark book: PDF reader, notes, ask         owner: book
  js/ui/creator.js      character creator (photo + manual)        owner: creator
  js/ui/terminal.js     Python challenge terminal                 owner: terminal
  js/ui/explain.js      explain-it conversation UI                owner: terminal
  js/workers/pyodide-worker.js  runs player code + tests          owner: terminal
  js/puzzles/<name>.js  one module per world puzzle               owner: puzzles
```

No build step. Plain ES modules in the browser. `three` comes from the import
map in `index.html`:

```html
<script type="importmap">{ "imports": { "three": "/vendor/three/three.module.js" } }</script>
```

## Server routes (server/index.js)

Static:

| Path | Serves |
|---|---|
| `/` and `/*` | `public/` |
| `/vendor/three/*` | `node_modules/three/build/*` |
| `/vendor/pdfjs/*` | `node_modules/pdfjs-dist/build/*` |
| `/vendor/pdfjs-web/*` | `node_modules/pdfjs-dist/web/*` |
| `/content/*` | `content/*` |

API (all JSON unless noted; errors are `{ "error": "message" }` with a 4xx/5xx):

| Method + path | Body / params | Response |
|---|---|---|
| `GET /api/status` | | `{ ai: boolean, model: string }` |
| `GET /api/paper/:arxivId/pdf` | | the arXiv PDF (`application/pdf`), cached in `.cache/papers/` |
| `GET /api/paper/:arxivId/text` | | `{ text }`: full paper text as markdown from `https://www.alphaxiv.org/abs/<id>.md`, cached |
| `GET /api/paper/:arxivId/meta` | | `{ title, votes, visits }` parsed from the alphaXiv abs page, cached 24h; `votes`/`visits` may be null |
| `POST /api/book` | `{ regionId, question, selection?, history?: [{q,a}] }` | `{ answer, refused: boolean, offline: boolean }` |
| `POST /api/avatar` | `{ image: "data:image/...;base64,..." }` | `{ params }` (see Character params) or 503 `{ error, offline: true }` without a key |
| `POST /api/grade` | `{ regionId, challengeId, answer }` | `{ pass: boolean, score: 0..1, feedback: string, offline: boolean }` |

arXiv ids are validated with `/^\d{4}\.\d{4,5}(v\d+)?$/`.

### Claude usage (server/ai.js)

* Official SDK `@anthropic-ai/sdk` (v1.x), model `claude-opus-5-5`.
* Every call goes through `client.beta.messages.create` with
  `betas: ["server-side-fallback-2026-07-01"]` and `fallbacks: "default"`, and
  checks `stop_reason === "refusal"` before reading `content`. Read the answer
  from the `text` blocks (thinking blocks come back empty).
* Book: `output_config: { effort: "low" }`, `max_tokens: 1200`. System prompt =
  the book's persona + the region's `book.guard` list (stable) + the full paper
  text as a separate system block with `cache_control: { type: "ephemeral", ttl: "1h" }`.
  The question (and the optional selected passage and short history) go in
  `messages`. The book is terse (1-3 short sentences), slightly ominous, never
  gives away answers to the region's challenges, and refuses anything matching
  `book.guard` with an in-character refusal (`refused: true`).
* Avatar: base64 image block + instructions, `output_config: { effort: "low",
  format: { type: "json_schema", schema: CHARACTER_SCHEMA } }`, then
  `JSON.parse` the text and clamp every field to the allowed values.
* Grade: `output_config: { effort: "medium", format: { type: "json_schema",
  schema: GRADE_SCHEMA } }`. The rubric comes from the region JSON on the
  server, never from the client.
* Offline (no key): book answers with `book.offlineHints` (pick the hint whose
  `keywords` best match the question, else a generic cryptic line); grading uses
  the challenge's `offline` keyword groups (pass if every group has at least one
  keyword in the answer, case-insensitive).

## Character params (avatar + creator + player model)

```json
{
  "skin": "#e8b796",
  "hairStyle": "short | buzz | long | bob | ponytail | curly | bun | spiky | afro | braids | bald",
  "hairColor": "#3b2a20",
  "eyeColor": "#3b2a20",
  "glasses": "none | round | square",
  "facialHair": "none | mustache | beard | stubble",
  "freckles": false,
  "topStyle": "tee | hoodie | sweater | shirt | dress",
  "topColor": "#4f86d8",
  "bottomColor": "#3a3a5a",
  "shoeColor": "#6a4a3a",
  "accessory": "none | cap | beanie | headband | bow | earrings"
}
```

Colors are `#rrggbb`. `humans.js` must accept any object and fill missing or
invalid fields with defaults.

### humans.js API

```js
import { buildHuman, buildScientist, DEFAULT_CHARACTER, normalizeCharacter } from './engine/humans.js';
const player = buildHuman(params);      // THREE.Group, feet at y=0, ~1.9 units tall, faces +z
player.userData.animate(dt, { moving: bool, speed: 0..1, facing: -1|1 });
const grumm = buildScientist();        // THREE.Group, a human ~5x the player's height, lab coat
grumm.userData.setExpression('grumpy' | 'neutral' | 'surprised' | 'talking');
grumm.userData.animate(dt, { talking: bool });
```

Style: Animal Crossing humans. Big round head (about 45% of the height), dot
eyes with a white highlight, tiny nose, simple mouth, rosy cheeks, chunky small
body, stubby arms, round shoes. Use `MeshStandardMaterial` (roughness ~0.8)
so it matches the villagers. Every mesh `castShadow = true`.

## Region content (content/regions/<id>.json)

```jsonc
{
  "id": "attention",                       // file name and route id
  "paper": { "arxivId": "1706.03762", "title": "...", "authors": "Vaswani et al.", "year": 2017 },
  "region": {
    "name": "Attendale",                   // shown on the arrival scroll and the map
    "biome": "meadow | snow | desert | dusk | tropic",
    "tagline": "one line for the map pin"
  },
  "scientist": {
    "taskTitle": "Bring me ...",           // the impossible task, short
    "briefing": ["Grumm line", "..."],     // when he sends you off (grumpy, dismissive)
    "reminder": ["..."],                   // if you talk to him before finishing
    "return": ["..."]                      // when you bring the artefact (shocked, grudging)
  },
  "story": {
    "arrival": ["narration lines shown when you arrive"],
    "resolution": ["narration lines after the last challenge"]
  },
  "inhabitants": [
    {
      "id": "pip",
      "name": "Pip",
      "species": "bear | bunny | cat | frog | dog | mouse | pig | duck | snake",
      "colors": { "fur": "#e0ad7c", "shirt": "#3ec7b5" },
      "anchor": "lane-mid",                // see Anchors
      "role": "short description for designers",
      "lines": {
        "default": ["what they say before the relevant challenge"],
        "afterSolved": ["what they say once their challenge is done"]
      }
    }
  ],
  "stations": [                              // interactive objects that are not people
    { "id": "loom", "kind": "terminal | board | mailbox | sign | machine", "anchor": "terrace-2",
      "label": "The Word Loom", "look": "short visual description for the 3D artist" }
  ],
  "challenges": [
    {
      "id": "c1",
      "type": "puzzle",                      // a hands-on world puzzle
      "title": "...",
      "giver": "pip",                        // inhabitant or station id that starts it
      "requires": [],                        // challenge ids that must be solved first
      "puzzle": "attention-routing",         // module name: public/js/puzzles/<puzzle>.js
      "spec": { /* everything the puzzle module needs: data, rules, win condition */ },
      "design": "plain-language description of the mechanic, controls and win condition",
      "paperLink": "which section/equation/table of the paper this tests",
      "worldEffect": "what visibly changes in the diorama when solved",
      "intro": ["giver lines that pose the puzzle"],
      "success": ["lines after solving"]
    },
    {
      "id": "c2",
      "type": "code",
      "title": "...",
      "giver": "loom",
      "requires": ["c1"],
      "prompt": "markdown task statement in the story's voice, precise about inputs/outputs/shapes",
      "starterCode": "python, numpy allowed",
      "tests": "python: plain asserts or functions named test_*; may use numpy; must not print secrets",
      "solutionFile": "server/solutions/attention_c2.py",
      "paperLink": "...",
      "intro": ["..."],
      "success": ["..."]
    },
    {
      "id": "c3",
      "type": "explain",
      "title": "...",
      "giver": "elder",
      "requires": ["c1", "c2"],
      "question": "what the inhabitant asks you to explain, in their voice",
      "rubric": ["criterion 1 the answer must meet", "criterion 2", "..."],
      "passBar": "how many criteria / how strict",
      "offline": [["keyword", "synonym"], ["another", "group"]],
      "paperLink": "...",
      "intro": ["..."],
      "success": ["..."],
      "retry": ["what they say when the explanation is not good enough"]
    }
  ],
  "artefact": {
    "id": "...", "name": "...", "description": "what it is and why it fits the paper",
    "look": "visual description for a small procedural three.js model"
  },
  "book": {
    "guard": ["question patterns / facts the book must refuse because they answer a challenge"],
    "offlineHints": [{ "keywords": ["softmax", "scale"], "text": "terse cryptic line" }]
  }
}
```

### Anchors (where inhabitants and stations stand)

Every region uses the same layered layout (see the mockups): a front bank by
the river (layer 0), the main path (layer 1, split by a stream with a bridge),
a raised back terrace with three houses on the left (layer 2), a hilltop on the
far left (layer 3), a lower step on the far right, and a gate in a hedge at the
back right that leads "deeper" (the region's exit after completion).

| Anchor | Where |
|---|---|
| `arrival` | far left of the main path (player spawns here) |
| `lane-left` | main path, left |
| `lane-mid` | main path, centre-left, near the stairs to the terrace |
| `bridge` | on the bridge over the stream |
| `lane-right` | main path, right of the stream |
| `path-to-gate` | on the winding path toward the back gate |
| `gate` | in front of the back gate |
| `terrace-1`, `terrace-2`, `terrace-3` | back terrace, in front of houses 1-3 |
| `hilltop` | the hilltop, far left back |
| `rightstep` | the lower step, far right |
| `bank-left`, `bank-right` | the front bank by the river (reached by the pier steps) |

### Puzzle modules (public/js/puzzles/<name>.js)

```js
export default {
  // container: an empty full-screen element inside #ui-root (already in the modal stack)
  // spec: challenge.spec from the region JSON
  // api: { onSolved(), onClose(), sfx(name) }  call onSolved exactly once on success
  mount(container, spec, api) { ... return { destroy() {} }; }
};
```

Puzzles are paper-craft boards drawn with DOM/SVG/canvas over the 3D scene
(cut-paper cards, string, pins, stamps). They must be fully playable with the
mouse, explain their controls in one line, and never reveal the answer.

## Shared front-end modules (owner: core)

```js
// js/ui/modal.js
openModal(element, { onEscape }) ; closeModal(element) ; isModalOpen()
// js/api.js
api.status(); api.book({ regionId, question, selection, history });
api.avatar(dataUrl); api.grade({ regionId, challengeId, answer });
api.paperPdfUrl(arxivId); api.paperText(arxivId); api.paperMeta(arxivId);
api.region(id)  // fetches /content/regions/<id>.json
// js/game/save.js
getSave(); updateSave(mutatorFn); resetSave();
```

UI modules export `open(opts) -> Promise<result>` and remove their own DOM on
close. They append to `document.getElementById('ui-root')`, call `openModal`
on open and `closeModal` on close.

```js
// js/ui/book.js
open({ paper: { arxivId, title }, regionId })        // regionId may be null in the lab
// js/ui/creator.js
open({ initial }) -> Promise<characterParams>
// js/ui/terminal.js
open({ challenge, regionId }) -> Promise<{ solved: boolean, code: string }>
// js/ui/explain.js
open({ challenge, regionId, speaker: { name } }) -> Promise<{ pass: boolean, feedback: string }>
```

Annotations (highlights + notes) live in `localStorage` under
`etl-notes-<arxivId>`, owned by book.js.

## Look and feel

Cozy paper craft. Cream paper panels `#fffdf6`, ink `#2b2233`, 4px ink borders,
16-18px rounded corners, a hard drop shadow `6px 6px 0 rgba(43,34,51,.35)`,
pink name tags `#ff7ab8`, font stack `"Trebuchet MS", Verdana, sans-serif`
(UI) and `ui-monospace, Menlo, Consolas, monospace` (code). The dark book is
the exception: near-black pages, violet glow `#9b6bff`, faint drifting
particles, a slightly unsettling serif (`Georgia, "Times New Roman", serif`).
These live as CSS variables in `public/css/game.css`.

## Fundamentals and the book's Learned pages (added)

Besides the paper challenges, every region weaves **basic deep learning
concepts** (dot products, softmax, cosine similarity, cross-entropy, hidden
state, ...) into its story. They are small checks posed by inhabitants, always
relevant to the region's paper and plot. When the player passes one, the
Umbral Book **records** the concept on its Learned pages, and the game never
asks about that concept again: later regions that list the same concept treat
it as already satisfied (the inhabitant just acknowledges it).

Global concept ids live in `content/concepts.json`:
`[{ "id": "softmax", "title": "Softmax", "summary": "one-line canonical definition" }]`.

Region JSON gains:

```jsonc
"fundamentals": [
  {
    "id": "f1",                    // unique within the region (shares the id space with challenges)
    "concept": "softmax",          // global concept id from content/concepts.json
    "title": "Softmax",
    "giver": "pip",                // an inhabitant id
    "requires": [],                // ids of challenges/fundamentals that must come first
    "intro": ["story lines that pose it, in the inhabitant's voice"],
    "check": {
      "kind": "choice | number | explain",
      "question": "the question, in story terms but precise",
      "options": ["...", "...", "...", "..."], "answer": 2,          // choice: index of the right option
      // number:  "answer": 0.5, "tolerance": 0.01
      // explain: "rubric": ["..."], "passBar": "...", "offline": [["kw", "syn"]]
    },
    "wrong": ["lines when the answer is wrong (never reveal it)"],
    "success": ["lines when right"],
    "known": ["lines when the book already recorded this concept (the check is skipped)"],
    "record": "1-2 sentences the book writes on its Learned pages, in the book's voice"
  }
]
```

Main challenges may list fundamental ids in `requires`. A fundamental counts as
satisfied if it was passed in this region **or** its concept is already
learned. `/api/grade` accepts a fundamental id as `challengeId` (explain kind,
using `check.question/rubric/passBar/offline`).

Save (`etl-save-v1`) gains `learned: { [conceptId]: { title, record, region, at } }`.
The book shows these on a **Learned** tab (grouped by region, newest first),
read via `getSave().learned` from `js/game/save.js`.

## Concise text (rule from the player)

Remove text that is **superfluous or redundant**; keep every word the player
needs to understand what is going on. This is not "icons only".

* Keep: the current task, what a button does (short label, icon optional),
  who you are talking to, questions and their options, puzzle goal and controls
  (one or two short lines), results and errors that change what you do next,
  key hints for controls.
* Cut: subtitles and taglines nobody needs, "how to use this panel" paragraphs,
  repeated information (the same fact in a banner, a toast and the HUD),
  filler status sentences, decorative words.
* Short beats long: labels of 1-3 words, hints under ~60 characters, dialogue
  lines under ~90 characters and at most 3 lines per block.
* Nice-to-have details go in tooltips (`title`).
