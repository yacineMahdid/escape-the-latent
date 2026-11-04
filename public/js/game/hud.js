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
      <div class="hud-left"><div class="hud-task etl-panel"></div></div>
      <div class="hud-right">
        <div class="hud-artefacts etl-panel" title="Artefacts brought back"></div>
        <button class="etl-btn hud-book" title="The Cursed Book of Dimensionality: read the paper, take notes, ask it things">📖 Book <kbd>B</kbd></button>
        <button class="etl-btn hud-map"><span class="hud-map-label">🗺️ Map</span> <kbd>M</kbd></button>
        <button class="etl-btn hud-icon hud-menu" title="Menu (Esc)">☰</button>
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
  if (task !== undefined) {
    const el = bar.querySelector('.hud-task');
    el.textContent = task ? `📜 ${task}` : ''; el.title = place || ''; el.style.display = task ? '' : 'none';
  }
  if (artefacts !== undefined) { const el = bar.querySelector('.hud-artefacts'); el.textContent = `✦ ${artefacts.length}/3`; }
  if (mapLabel !== undefined) bar.querySelector('.hud-map-label').textContent = mapLabel === 'Leave' ? '🚪 Leave' : '🗺️ Map';
}

export function hideHud() { if (bar) bar.style.display = 'none'; hidePrompt(); }

// Draw the eye to a HUD button instead of explaining it in words.
export function pulseHud(which) {
  const el = bar?.querySelector(`.hud-${which}`);
  if (!el) return;
  el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
  setTimeout(() => el.classList.remove('pulse'), 4200);
}

const v = new THREE.Vector3();
export function showPrompt(label, worldPos, camera, renderer) {
  if (!prompt) {
    prompt = document.createElement('div'); prompt.className = 'etl-passive talk-prompt';
    const k = document.createElement('kbd'); k.textContent = 'E'; const i = document.createElement('span'); prompt.append(k, i);
    root().appendChild(prompt);
  }
  prompt.lastChild.textContent = label;
  v.copy(worldPos).project(camera);
  const r = renderer.domElement.getBoundingClientRect();
  prompt.style.left = `${r.left + (v.x * 0.5 + 0.5) * r.width}px`;
  prompt.style.top = `${r.top + (-v.y * 0.5 + 0.5) * r.height}px`;
  prompt.style.display = v.z < 1 ? '' : 'none';
}

export function hidePrompt() { if (prompt) prompt.style.display = 'none'; }
