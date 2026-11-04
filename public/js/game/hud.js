// HUD: top bar (place + task + buttons) and the floating "E · Talk" prompt.
import * as THREE from 'three';

const root = () => document.getElementById('ui-root');
let bar = null, prompt = null, handlers = {};

export function mountHud({ onBook, onMap, onMenu } = {}) {
  handlers = { onBook, onMap, onMenu };
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'hud';
    bar.innerHTML = `
      <div class="hud-left"><div class="hud-place etl-panel"></div><div class="hud-task etl-panel"></div></div>
      <div class="hud-right">
        <div class="hud-artefacts etl-panel" title="Artefacts"></div>
        <button class="etl-btn hud-book" title="The Umbral Book (B)">📖 Book <kbd>B</kbd></button>
        <button class="etl-btn hud-map" title="Map (M)">🗺️ <span class="hud-map-label">Map</span> <kbd>M</kbd></button>
        <button class="etl-btn hud-menu" title="Menu (Esc)">☰</button>
      </div>`;
    root().appendChild(bar);
    bar.querySelector('.hud-book').onclick = () => handlers.onBook?.();
    bar.querySelector('.hud-map').onclick = () => handlers.onMap?.();
    bar.querySelector('.hud-menu').onclick = () => handlers.onMenu?.();
  }
  bar.style.display = '';
  return bar;
}

export function setHud({ place, task, artefacts, mapLabel } = {}) {
  if (!bar) return;
  if (place !== undefined) { const el = bar.querySelector('.hud-place'); el.textContent = place || ''; el.style.display = place ? '' : 'none'; }
  if (task !== undefined) { const el = bar.querySelector('.hud-task'); el.textContent = task || ''; el.style.display = task ? '' : 'none'; }
  if (artefacts !== undefined) { const el = bar.querySelector('.hud-artefacts'); el.textContent = `✦ ${artefacts.length} / 3`; }
  if (mapLabel !== undefined) bar.querySelector('.hud-map-label').textContent = mapLabel;
}

export function hideHud() { if (bar) bar.style.display = 'none'; hidePrompt(); }

const v = new THREE.Vector3();
export function showPrompt(text, worldPos, camera, renderer) {
  if (!prompt) { prompt = document.createElement('div'); prompt.className = 'etl-passive talk-prompt'; root().appendChild(prompt); }
  prompt.textContent = text;
  v.copy(worldPos).project(camera);
  const r = renderer.domElement.getBoundingClientRect();
  prompt.style.left = `${r.left + (v.x * 0.5 + 0.5) * r.width}px`;
  prompt.style.top = `${r.top + (-v.y * 0.5 + 0.5) * r.height}px`;
  prompt.style.display = v.z < 1 ? '' : 'none';
}

export function hidePrompt() { if (prompt) prompt.style.display = 'none'; }
