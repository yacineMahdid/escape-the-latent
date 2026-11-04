// Grumm's paper map of the Latent: pick where to go. Resolves to a region id or null.
import { openModal, closeModal } from '../../ui/modal.js';
import { api } from '../../api.js';
import { getSave, regionState } from '../save.js';
import { REGION_ORDER } from './lab.js';

const ISLANDS = {
  attention: { x: 250, y: 300, rx: 120, ry: 78, fill: '#7bcd5d', edge: '#5aa84a', icon: '🏡' },
  clip: { x: 560, y: 190, rx: 110, ry: 70, fill: '#22cfd8', edge: '#1aa7b0', icon: '🌴' },
  mamba: { x: 720, y: 410, rx: 135, ry: 74, fill: '#f3cf88', edge: '#d9a660', icon: '🐍' },
};
const TEASERS = [
  { id: '2305.18290', name: 'Direct Preference Optimization', x: 120, y: 520 },
  { id: '2104.09864', name: 'RoFormer (RoPE)', x: 440, y: 520 },
  { id: '2010.11929', name: 'Vision Transformer', x: 900, y: 220 },
  { id: '2106.09685', name: 'LoRA', x: 860, y: 560 },
  { id: '2006.11239', name: 'Denoising Diffusion', x: 110, y: 130 },
];
const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent?.appendChild(e); return e; };

export async function openMapOverlay() {
  const save = getSave();
  const regions = {};
  await Promise.all(REGION_ORDER.map(async (id) => { regions[id] = await api.region(id).catch(() => null); }));

  const wrap = document.createElement('div');
  wrap.className = 'map-overlay';
  wrap.innerHTML = `
    <div class="map-card etl-panel">
      <div class="map-head"><div><div class="map-title">The Latent</div><div class="map-sub">as sketched (badly) by Prof. Grumm</div></div>
      <button class="etl-btn map-close">Close <kbd>Esc</kbd></button></div>
      <div class="map-body"><svg class="map-svg" viewBox="0 0 1000 640"></svg>
      <div class="map-info"><div class="map-info-empty">Pick a place on the map.</div></div></div>
    </div>`;
  document.getElementById('ui-root').appendChild(wrap);
  const svg = wrap.querySelector('svg');
  const info = wrap.querySelector('.map-info');

  // sea, dotted travel route, islands
  el('rect', { x: 0, y: 0, width: 1000, height: 640, fill: '#cfeaf2', rx: 24 }, svg);
  for (let i = 0; i < 40; i++) el('path', { d: `M${(i * 97) % 1000} ${(i * 53) % 640} q 10 -6 20 0 t 20 0`, stroke: '#a8d8e6', fill: 'none', 'stroke-width': 3, 'stroke-linecap': 'round' }, svg);
  const route = REGION_ORDER.map((id) => ISLANDS[id]);
  el('path', { d: `M ${route.map((p) => `${p.x} ${p.y}`).join(' L ')}`, stroke: '#8a5a36', 'stroke-width': 4, 'stroke-dasharray': '10 10', fill: 'none', opacity: 0.7 }, svg);
  for (const t of TEASERS) {
    const g = el('g', { class: 'map-teaser', transform: `translate(${t.x} ${t.y})` }, svg);
    el('ellipse', { rx: 70, ry: 42, fill: '#e9e2cf', stroke: '#b9ae94', 'stroke-width': 3, 'stroke-dasharray': '8 6' }, g);
    const tx = el('text', { y: 6, 'text-anchor': 'middle', class: 'map-teaser-q' }, g); tx.textContent = '?';
    g.addEventListener('click', () => showTeaser(t));
  }
  const pins = {};
  REGION_ORDER.forEach((id, i) => {
    const isl = ISLANDS[id]; const rg = regions[id];
    const g = el('g', { class: 'map-island', transform: `translate(${isl.x} ${isl.y})`, tabindex: 0 }, svg);
    el('ellipse', { rx: isl.rx + 8, ry: isl.ry + 8, fill: '#f6efdc', opacity: 0.9 }, g);
    el('ellipse', { rx: isl.rx, ry: isl.ry, fill: isl.fill, stroke: isl.edge, 'stroke-width': 5 }, g);
    const ic = el('text', { y: -6, 'text-anchor': 'middle', class: 'map-icon' }, g); ic.textContent = isl.icon;
    const nm = el('text', { y: 34, 'text-anchor': 'middle', class: 'map-name' }, g); nm.textContent = rg?.region?.name || id;
    const rs = regionState(id);
    const status = rs.returned ? 'done' : save.currentTask === id ? 'current' : 'locked';
    const flag = el('g', { transform: `translate(${isl.rx * 0.55} ${-isl.ry * 0.75})` }, g);
    el('line', { x1: 0, y1: 0, x2: 0, y2: 46, stroke: '#2b2233', 'stroke-width': 4 }, flag);
    el('path', { d: 'M0 0 L34 10 L0 22 Z', fill: status === 'done' ? '#3ec7b5' : status === 'current' ? '#ff7ab8' : '#b9ae94', stroke: '#2b2233', 'stroke-width': 3 }, flag);
    if (status === 'done') { const ck = el('text', { x: 8, y: 17, class: 'map-check' }, flag); ck.textContent = '✓'; }
    pins[id] = g;
    g.addEventListener('click', () => showRegion(id));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter') showRegion(id); });
    if (i === 0 && !save.currentTask) showRegion(id);
  });
  if (save.currentTask) showRegion(save.currentTask);

  let resolveFn;
  const result = new Promise((r) => { resolveFn = r; });
  function close(v) { closeModal(wrap); wrap.remove(); resolveFn(v); }
  openModal(wrap, { onEscape: () => close(null) });
  wrap.querySelector('.map-close').onclick = () => close(null);

  function row(label, value) { const d = document.createElement('div'); d.className = 'map-row'; const a = document.createElement('span'); a.textContent = label; const b = document.createElement('b'); b.textContent = value; d.append(a, b); return d; }

  function showRegion(id) {
    Object.values(pins).forEach((p) => p.classList.remove('sel')); pins[id]?.classList.add('sel');
    const rg = regions[id]; const rs = regionState(id);
    info.innerHTML = '';
    const h = document.createElement('div'); h.className = 'map-info-title'; h.textContent = rg?.region?.name || id; info.appendChild(h);
    const tg = document.createElement('div'); tg.className = 'map-info-tag'; tg.textContent = rg?.region?.tagline || ''; info.appendChild(tg);
    if (rg?.paper) {
      info.appendChild(row('Paper', rg.paper.title));
      info.appendChild(row('Authors', `${rg.paper.authors}, ${rg.paper.year}`));
      info.appendChild(row('arXiv', rg.paper.arxivId));
      const votes = row('alphaXiv votes', '…'); info.appendChild(votes);
      api.paperMeta(rg.paper.arxivId).then((m) => { votes.querySelector('b').textContent = m?.votes != null ? m.votes.toLocaleString() : 'n/a'; }).catch(() => { votes.querySelector('b').textContent = 'n/a'; });
    }
    const status = rs.returned ? 'Done. Grumm has the artefact.' : save.currentTask === id ? (rs.artefact ? 'Artefact found. Bring it to Grumm!' : 'Grumm sent you here.') : 'Grumm has not sent you here yet.';
    const st = document.createElement('div'); st.className = 'map-info-status'; st.textContent = status; info.appendChild(st);
    const canGo = rs.returned || save.currentTask === id;
    const go = document.createElement('button'); go.className = 'etl-btn primary'; go.textContent = canGo ? `Travel to ${rg?.region?.name || id}` : 'Locked'; go.disabled = !canGo || !rg;
    go.onclick = () => close(id);
    info.appendChild(go);
  }

  function showTeaser(t) {
    Object.values(pins).forEach((p) => p.classList.remove('sel'));
    info.innerHTML = '';
    const h = document.createElement('div'); h.className = 'map-info-title'; h.textContent = 'Uncharted'; info.appendChild(h);
    info.appendChild(row('Rumoured paper', t.name));
    info.appendChild(row('arXiv', t.id));
    const votes = row('alphaXiv votes', '…'); info.appendChild(votes);
    api.paperMeta(t.id).then((m) => { votes.querySelector('b').textContent = m?.votes != null ? m.votes.toLocaleString() : 'n/a'; }).catch(() => { votes.querySelector('b').textContent = 'n/a'; });
    const st = document.createElement('div'); st.className = 'map-info-status'; st.textContent = 'Fog. Grumm mutters that this one is "next season".'; info.appendChild(st);
  }

  return result;
}
