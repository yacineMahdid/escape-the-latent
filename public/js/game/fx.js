// Screen transitions (paper page wipe) and paper confetti.
const root = () => document.getElementById('ui-root');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function pageWipe(midway) {
  const el = document.createElement('div');
  el.className = 'page-wipe';
  root().appendChild(el);
  await wait(20);
  el.classList.add('in');
  await wait(520);
  try { await midway?.(); } finally {
    el.classList.add('out');
    await wait(560);
    el.remove();
  }
}

export function confetti(count = 90) {
  const layer = document.createElement('div');
  layer.className = 'etl-passive confetti';
  const colors = ['#ff7ab8', '#ffd35a', '#3ec7b5', '#8fd3ff', '#b39cff', '#ff8a3d'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 0.6}s`;
    p.style.animationDuration = `${1.8 + Math.random() * 1.6}s`;
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    layer.appendChild(p);
  }
  root().appendChild(layer);
  setTimeout(() => layer.remove(), 4200);
}
