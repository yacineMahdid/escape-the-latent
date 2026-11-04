// Boot + scene state machine: title -> character -> lab <-> map <-> regions -> ending.
import { createEngine } from './engine/core.js';
import { api } from './api.js';
import { getSave, updateSave, resetSave } from './game/save.js';
import { mountHud, hideHud } from './game/hud.js';
import { pageWipe } from './game/fx.js';
import { say, ask, toast } from './game/dialogue.js';
import { openModal, closeModal } from './ui/modal.js';
import { createBackdropScene } from './game/scenes/backdrop.js';

const engine = createEngine(document.getElementById('game'));
engine.start();
const ui = document.getElementById('ui-root');
let status = { ai: false };
let current = null;

const ctx = { engine, goto, openBook, pauseMenu, get status() { return status; } };

async function goto(name, param) {
  let next;
  document.querySelectorAll('.title-card, .ending-card').forEach((el) => el.remove());
  await pageWipe(async () => {
    if (name === 'region') next = await (await import('./game/scenes/region.js')).createRegionScene(ctx, param);
    else if (name === 'lab') next = await (await import('./game/scenes/lab.js')).createLabScene(ctx);
    else if (name === 'ending') next = await createEnding();
    mountHud({ onBook: () => clickAction('book'), onMap: () => clickAction('map'), onMenu: () => clickAction('menu') });
    if (name === 'ending') hideHud();
    current = next;
    engine.setScene(next);
    await next.onEnter?.();
  });
  updateSave((s) => { s.lastScene = name === 'region' ? `region:${param}` : name; });
  next.start?.();
}

// HUD buttons dispatch the same actions as the keys.
function clickAction(action) {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: action === 'book' ? 'KeyB' : action === 'map' ? 'KeyM' : 'Escape' }));
  setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: action === 'book' ? 'KeyB' : action === 'map' ? 'KeyM' : 'Escape' })), 30);
}

async function openBook(paper, regionId) {
  try {
    const book = await import('./ui/book.js');
    await book.open({ paper, regionId });
  } catch (e) {
    console.error(e);
    toast('The book refuses to open. (book module missing)');
  }
}

async function pauseMenu() {
  const wrap = document.createElement('div');
  wrap.className = 'pause-overlay';
  wrap.innerHTML = `<div class="pause-card etl-panel"><div class="pause-title">Paused</div>
    <div class="pause-help"><b>Move</b> arrows / WASD &nbsp; <b>Talk / use</b> E or Space &nbsp; <b>Book</b> B &nbsp; <b>Map / leave</b> M</div>
    <div class="pause-ai"></div>
    <div class="pause-btns"><button class="etl-btn primary" data-a="resume">Resume</button><button class="etl-btn" data-a="title">Back to title</button><button class="etl-btn" data-a="reset">Erase save</button></div></div>`;
  wrap.querySelector('.pause-ai').textContent = status.ai ? 'The Umbral Book is awake (Claude connected).' : 'No API key on the server: the book only mutters, and explanations are graded by keywords.';
  ui.appendChild(wrap);
  const choice = await new Promise((resolve) => {
    openModal(wrap, { onEscape: () => resolve('resume') });
    wrap.querySelectorAll('button').forEach((b) => { b.onclick = () => resolve(b.dataset.a); });
  });
  closeModal(wrap); wrap.remove();
  if (choice === 'title') return showTitle();
  if (choice === 'reset') {
    const sure = await ask('Erase your save and start over? Grumm will forget you (he would love that).', ['Erase it', 'Keep it']);
    if (sure === 0) { resetSave(); location.reload(); }
  }
}

async function createEnding() {
  const scene = createBackdropScene('meadow', { cast: [['bear', 'lane-mid'], ['bunny', 'terrace-3'], ['frog', 'bridge'], ['cat', 'lane-right'], ['duck', 'terrace-2'], ['snake', 'path-to-gate']] });
  const card = document.createElement('div');
  card.className = 'ending-card etl-panel';
  card.innerHTML = `<div class="ending-title">You escaped the Latent</div>
    <div class="ending-sub">Three famous papers, understood for real. Grumm will never say it twice.</div>
    <ol class="ending-list"></ol>
    <div class="ending-btns"><button class="etl-btn primary" data-a="lab">Back to the lab</button><button class="etl-btn" data-a="new">New game</button></div>`;
  const list = card.querySelector('.ending-list');
  for (const id of ['attention', 'clip', 'mamba']) {
    const rg = await api.region(id).catch(() => null);
    const li = document.createElement('li');
    li.textContent = rg ? `${rg.region.name}: ${rg.paper.title} (${rg.paper.year}) · ${rg.artefact?.name || ''}` : id;
    list.appendChild(li);
  }
  return {
    ...scene,
    onEnter() { ui.appendChild(card); },
    start() {
      card.querySelectorAll('button').forEach((b) => { b.onclick = () => { card.remove(); if (b.dataset.a === 'new') { resetSave(); location.reload(); } else goto('lab'); }; });
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
    toast('Character creator unavailable; using a default look.');
    return initial || {};
  }
}

async function showTitle() {
  hideHud();
  const bg = createBackdropScene('meadow', { cast: [['bunny', 'lane-mid'], ['frog', 'bridge'], ['cat', 'terrace-3']] });
  current = bg;
  engine.setScene(bg);
  const save = getSave();
  const card = document.createElement('div');
  card.className = 'title-card';
  card.innerHTML = `<div class="title-logo">Escape <span>the</span> Latent</div>
    <div class="title-sub">a tiny human · a grumpy giant · famous machine learning papers</div>
    <div class="title-btns"></div>
    <div class="title-status"></div>
    <div class="title-foot">Papers chosen by alphaXiv votes · read them for real, the game won't help</div>`;
  ui.appendChild(card);
  const btns = card.querySelector('.title-btns');
  const mk = (label, primary, fn) => { const b = document.createElement('button'); b.className = 'etl-btn' + (primary ? ' primary' : ''); b.textContent = label; b.onclick = fn; btns.appendChild(b); return b; };
  const hasSave = !!save.character;
  const go = async (fresh) => {
    card.remove();
    if (fresh) resetSave();
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
    if (hasSave) { const sure = await ask('Start over? Your current save will be erased.', ['Start over', 'Cancel']); if (sure !== 0) return; }
    go(true);
  });
  status = await api.status().catch(() => ({ ai: false }));
  card.querySelector('.title-status').textContent = status.ai
    ? '● The Umbral Book is awake (Claude connected)'
    : '○ No API key: the book will only mutter. Set ANTHROPIC_API_KEY and restart the server for the full game.';
}

showTitle();
window.__etl = { goto, ctx };
