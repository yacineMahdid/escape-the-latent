// Boot + scene state machine: title -> character -> lab <-> map <-> regions -> ending.
import { createEngine } from './engine/core.js';
import { api } from './api.js';
import { getSave, updateSave, resetSave } from './game/save.js';
import { mountHud, hideHud } from './game/hud.js';
import { pageWipe } from './game/fx.js';
import { say, ask, toast, dismissDialogue } from './game/dialogue.js';
import { openModal, closeModal, dismissAllModals, isModalOpen } from './ui/modal.js';
import { input } from './engine/input.js';
import { createBackdropScene } from './game/scenes/backdrop.js';
import { createTitleScene, buildLogo } from './game/scenes/title.js';

const engine = createEngine(document.getElementById('game'));
engine.start();
const ui = document.getElementById('ui-root');
let status = { ai: false };
let current = null;
let currentName = 'title';

const ctx = { engine, goto, openBook, pauseMenu, get status() { return status; } };

async function goto(name, param) {
  let next;
  // no game keys until the new scene starts; nothing from the old scene stays on screen
  input.setEnabled(false);
  dismissDialogue(); dismissAllModals();
  document.querySelectorAll('.title-card, .title-status, .ending-card').forEach((el) => el.remove());
  await pageWipe(async () => {
    if (name === 'region') next = await (await import('./game/scenes/region.js')).createRegionScene(ctx, param);
    else if (name === 'lab') next = await (await import('./game/scenes/lab.js')).createLabScene(ctx);
    else if (name === 'ending') next = await createEnding();
    mountHud({ onBook: () => clickAction('book'), onMap: () => clickAction('map'), onMenu: () => clickAction('menu') });
    if (name === 'ending') hideHud();
    current = next; currentName = name;
    dismissDialogue(); dismissAllModals(); // anything the old scene opened during the wipe
    engine.setScene(next);
    await next.onEnter?.();
  });
  updateSave((s) => { s.lastScene = name === 'region' ? `region:${param}` : name; });
  input.setEnabled(name !== 'ending');
  next.start?.();
}

// HUD buttons dispatch the same actions as the keys.
function clickAction(action) {
  if (isModalOpen() || !input.enabled) return; // a dialogue or menu is up: the HUD buttons wait their turn
  window.dispatchEvent(new KeyboardEvent('keydown', { code: action === 'book' ? 'KeyB' : action === 'map' ? 'KeyM' : 'Escape' }));
  setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: action === 'book' ? 'KeyB' : action === 'map' ? 'KeyM' : 'Escape' })), 30);
}

async function openBook(paper, regionId) {
  try {
    const book = await import('./ui/book.js');
    await book.open({ paper, regionId });
  } catch (e) {
    console.error(e);
    toast('📖 ✕', 1500);
  }
}

async function pauseMenu() {
  const wrap = document.createElement('div');
  wrap.className = 'pause-overlay';
  wrap.innerHTML = `<div class="pause-card etl-panel"><div class="pause-title">Paused</div>
    <div class="pause-help"><span><kbd>←↑↓→</kbd> move</span><span><kbd>E</kbd> talk / use</span><span><kbd>B</kbd> book</span><span><kbd>M</kbd> ${currentName === 'region' ? 'leave' : 'map'}</span></div>
    <div class="pause-ai"></div>
    <div class="pause-btns"><button class="etl-btn primary" data-a="resume">Resume</button><button class="etl-btn" data-a="title">Title screen</button><button class="etl-btn" data-a="reset">Erase save</button></div></div>`;
  const ai = wrap.querySelector('.pause-ai'); ai.textContent = status.ai ? 'Book: online' : 'Book: offline (no API key)';
  ui.appendChild(wrap);
  const choice = await new Promise((resolve) => {
    openModal(wrap, { onEscape: () => resolve('resume') });
    wrap.querySelectorAll('button').forEach((b) => { b.onclick = () => resolve(b.dataset.a); });
  });
  closeModal(wrap); wrap.remove();
  if (choice === 'title') return showTitle();
  if (choice === 'reset') {
    const sure = await ask('Erase your save?', ['Erase', 'Cancel'], { neutral: true });
    if (sure === 0) { resetSave(); location.reload(); }
  }
}

async function createEnding() {
  const scene = createBackdropScene('meadow', { cast: [['bear', 'lane-mid'], ['bunny', 'terrace-3'], ['frog', 'bridge'], ['cat', 'lane-right'], ['duck', 'terrace-2'], ['snake', 'path-to-gate']] });
  const card = document.createElement('div');
  card.className = 'ending-card etl-panel';
  card.innerHTML = `<div class="ending-title">You escaped the Latent</div>
    <ol class="ending-list"></ol>
    <div class="ending-btns"><button class="etl-btn primary" data-a="lab">Back to the lab</button><button class="etl-btn" data-a="new">New game</button></div>`;
  const list = card.querySelector('.ending-list');
  for (const id of ['attention', 'clip', 'mamba']) {
    const rg = await api.region(id).catch(() => null);
    const li = document.createElement('li');
    li.textContent = rg ? `✦ ${rg.artefact?.name || rg.region.name}` : id;
    if (rg) li.title = `${rg.paper.title} (${rg.paper.year})`;
    list.appendChild(li);
  }
  return {
    ...scene,
    onEnter() { ui.appendChild(card); },
    start() {
      card.querySelectorAll('button').forEach((b) => {
        b.onclick = async () => {
          if (b.dataset.a !== 'new') { card.remove(); goto('lab'); return; }
          card.inert = true;
          const sure = await ask('Erase your save and start over?', ['Start over', 'Cancel'], { neutral: true });
          card.inert = false;
          if (sure === 0) { card.remove(); resetSave(); location.reload(); }
        };
      });
    },
    dispose() { card.remove(); scene.dispose(); },
  };
}

async function characterCreation(initial) {
  try {
    const creator = await import('./ui/creator.js');
    return await creator.open({ initial });
  } catch (e) {
    console.error(e);
    toast('🙂', 1200);
    return initial || {};
  }
}

async function showTitle() {
  hideHud();
  input.setEnabled(false); // title buttons work with Tab + Enter/Space
  dismissDialogue(); dismissAllModals();
  currentName = 'title';
  document.querySelectorAll('.title-card, .title-status').forEach((el) => el.remove());
  const bg = await createTitleScene();
  current = bg;
  engine.setScene(bg);
  const save = getSave();
  try { await Promise.race([document.fonts.load('700 132px Fredoka'), new Promise((r) => setTimeout(r, 1500))]); } catch { /* fallback font */ }
  const card = document.createElement('div');
  card.className = 'title-card';
  card.appendChild(buildLogo());
  const btnRow = document.createElement('div'); btnRow.className = 'title-btns'; card.appendChild(btnRow);
  const statusTag = document.createElement('div'); statusTag.className = 'title-status';
  ui.appendChild(card);
  ui.appendChild(statusTag);
  const btns = btnRow;
  const mk = (label, primary, fn) => { const b = document.createElement('button'); b.className = 'etl-btn' + (primary ? ' primary' : ''); b.textContent = label; b.onclick = fn; btns.appendChild(b); return b; };
  const hasSave = !!save.character;
  const go = async (fresh) => {
    card.remove(); statusTag.remove();
    if (fresh) { resetSave(); import('./ui/book.js').then((b) => b.clearBookData?.()).catch(() => {}); }
    const s = getSave();
    if (!s.character) {
      const params = await characterCreation(null);
      updateSave((x) => { x.character = params; });
    }
    const last = getSave().lastScene || 'lab';
    if (last.startsWith('region:')) goto('region', last.slice(7)); else goto('lab');
  };
  if (hasSave) mk('Continue', true, () => go(false));
  mk(hasSave ? 'New game' : 'Start', !hasSave, async () => {
    if (hasSave) {
      card.inert = true; // the title buttons wait for the answer
      const sure = await ask('Erase your save and start over?', ['Start over', 'Cancel'], { neutral: true });
      card.inert = false;
      if (sure !== 0) return;
    }
    go(true);
  });
  status = await api.status().catch(() => ({ ai: false }));
  const st = statusTag;
  st.textContent = status.ai ? '● Book online' : '○ Book offline (no API key)';
  st.title = status.ai ? 'Claude answers the book, makes your character and grades explanations' : 'Set ANTHROPIC_API_KEY and restart the server for the full game';
}

showTitle();
window.__etl = { goto, ctx };
