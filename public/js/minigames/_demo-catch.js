// Dev-only demo for the mini-game kit: catch 8 falling stars with the basket, dodge the bombs.
import { runMinigame, draw } from './kit.js';

const GAME = {
  goal: 'Catch 8 stars. Three bombs and you lose.',
  controls: [['← →', 'move'], ['mouse', 'drag']],
  duration: 25,
  setup(S) { S.x = S.W / 2; S.items = []; S.caught = 0; S.bombs = 0; S.spawn = 0; S.seed = 7; },
  update(S, dt, input) {
    const rnd = () => { S.seed = (S.seed * 16807) % 2147483647; return S.seed / 2147483647; };
    const v = 520;
    if (input.left) S.x -= v * dt;
    if (input.right) S.x += v * dt;
    if (input.pointer.down) S.x += (input.pointer.x - S.x) * Math.min(1, dt * 12);
    S.x = Math.max(60, Math.min(S.W - 60, S.x));
    S.spawn -= dt;
    if (S.spawn <= 0) { S.spawn = 0.55; S.items.push({ x: 60 + rnd() * (S.W - 120), y: -30, bomb: rnd() < 0.3, vy: 180 + rnd() * 140 }); }
    for (const it of S.items) it.y += it.vy * dt;
    for (const it of S.items) {
      if (!it.done && it.y > S.H - 90 && it.y < S.H - 40 && Math.abs(it.x - S.x) < 62) { it.done = true; if (it.bomb) S.bombs++; else S.caught++; }
    }
    S.items = S.items.filter((it) => !it.done && it.y < S.H + 40);
  },
  draw(g, S) {
    g.fillStyle = '#cfeaf2'; g.fillRect(0, 0, S.W, S.H);
    g.fillStyle = '#7bcd5d'; g.fillRect(0, S.H - 40, S.W, 40);
    for (const it of S.items) draw.paper(g, () => { g.beginPath(); g.arc(it.x, it.y, 18, 0, 7); }, it.bomb ? '#2b2233' : '#ffd35a');
    draw.paper(g, () => draw.roundRect(g, S.x - 60, S.H - 80, 120, 44, 14), '#e8566a');
  },
  result(S) { return S.caught >= 8 ? 'win' : S.bombs >= 3 ? 'lose' : null; },
  hud(S) { return `★ ${S.caught}/8  💣 ${S.bombs}/3`; },
};

export default { mount(container, spec, api) { return runMinigame(container, spec, api, GAME); } };
