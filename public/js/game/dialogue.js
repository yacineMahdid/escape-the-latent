// Dialogue box, choices, banners and toasts. All text is inserted with textContent (never HTML).
import { openModal, closeModal } from '../ui/modal.js';

const root = () => document.getElementById('ui-root');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const STYLES = {
  scientist: { tag: '#6a5acd', box: 'scientist' },
  npc: { tag: '#ff7ab8', box: 'npc' },
  narration: { tag: null, box: 'narration' },
  book: { tag: '#9b6bff', box: 'book' },
  player: { tag: '#3ec7b5', box: 'npc' },
};

function waitAdvance(box) {
  return new Promise((resolve) => {
    const onKey = (e) => { if (['Space', 'Enter', 'KeyE', 'Escape'].includes(e.code)) { e.preventDefault(); e.stopPropagation(); done(); } };
    const onClick = () => done();
    function done() { window.removeEventListener('keydown', onKey, true); box.removeEventListener('pointerdown', onClick); resolve(); }
    window.addEventListener('keydown', onKey, true);
    box.addEventListener('pointerdown', onClick);
  });
}

// Typewriter that can be skipped (first press completes the line, second advances).
async function typeLine(textEl, line, box, shaky) {
  textEl.textContent = '';
  let skip = false;
  const onKey = (e) => { if (['Space', 'Enter', 'KeyE', 'Escape'].includes(e.code)) { e.preventDefault(); e.stopPropagation(); skip = true; } };
  const onClick = () => { skip = true; };
  window.addEventListener('keydown', onKey, true);
  box.addEventListener('pointerdown', onClick);
  const words = line.split(/(\s+)/);
  for (const w of words) {
    const span = document.createElement('span');
    if (shaky && /^[A-Z!?]{3,}[!?.,]*$/.test(w.replace(/[^A-Za-z!?.,]/g, ''))) span.className = 'shake';
    textEl.appendChild(span);
    for (const ch of w) {
      span.textContent += ch;
      if (!skip) await wait(ch === ',' ? 70 : /[.!?]/.test(ch) ? 110 : 16);
    }
  }
  window.removeEventListener('keydown', onKey, true);
  box.removeEventListener('pointerdown', onClick);
  await wait(60);
}

let active = null;

export async function say(lines, { speaker = null, style = 'npc', onLine } = {}) {
  if (!lines || !lines.length) return;
  if (typeof lines === 'string') lines = [lines];
  while (active) await active; // never stack two dialogues
  let release;
  active = new Promise((r) => { release = r; });
  const st = STYLES[style] || STYLES.npc;
  const box = document.createElement('div');
  box.className = `dlg dlg-${st.box}`;
  if (speaker && st.tag !== null) {
    const tag = document.createElement('div');
    tag.className = 'dlg-tag';
    tag.textContent = speaker.name || speaker;
    tag.style.background = speaker.color || st.tag;
    box.appendChild(tag);
  }
  const text = document.createElement('div'); text.className = 'dlg-text'; box.appendChild(text);
  const arrow = document.createElement('div'); arrow.className = 'dlg-arrow'; arrow.textContent = '▼'; box.appendChild(arrow);
  root().appendChild(box);
  openModal(box, {});
  try {
    for (let i = 0; i < lines.length; i++) {
      onLine?.(i, true);
      arrow.style.visibility = 'hidden';
      await typeLine(text, String(lines[i]), box, style === 'scientist');
      onLine?.(i, false);
      arrow.style.visibility = 'visible';
      await waitAdvance(box);
    }
  } finally {
    closeModal(box); box.remove();
    active = null; release();
  }
}

// A question with buttons; resolves to the chosen index (Escape = last option).
export async function ask(question, options, { speaker = null, style = 'npc', neutral = false } = {}) {
  while (active) await active;
  let release; active = new Promise((r) => { release = r; });
  const st = STYLES[style] || STYLES.npc;
  const box = document.createElement('div');
  box.className = `dlg dlg-${st.box} dlg-ask`;
  if (speaker && st.tag !== null) { const tag = document.createElement('div'); tag.className = 'dlg-tag'; tag.textContent = speaker.name || speaker; tag.style.background = speaker.color || st.tag; box.appendChild(tag); }
  const text = document.createElement('div'); text.className = 'dlg-text'; text.textContent = question; box.appendChild(text);
  const row = document.createElement('div'); row.className = 'dlg-choices' + (options.some((o) => String(o).length > 28) ? ' dlg-choices-long' : ''); box.appendChild(row);
  root().appendChild(box);
  try {
    return await new Promise((resolve) => {
      const finish = (i) => { window.removeEventListener('keydown', onKey, true); resolve(i); };
      openModal(box, { onEscape: () => finish(options.length - 1) });
      const btns = options.map((o, i) => { const b = document.createElement('button'); b.className = 'etl-btn' + (i === 0 && !neutral ? ' primary' : ''); b.textContent = o; b.onclick = () => finish(i); row.appendChild(b); return b; });
      // quiz questions start with nothing selected so no option looks "recommended"
      let sel = neutral ? -1 : 0; if (sel >= 0) btns[0].focus();
      const openedAt = performance.now();
      const onKey = (e) => {
        if (performance.now() - openedAt < 400) { if (['Space', 'Enter', 'KeyE'].includes(e.code)) { e.preventDefault(); e.stopPropagation(); } return; }
        if (e.code === 'ArrowRight' || e.code === 'ArrowDown') { sel = (sel + 1) % btns.length; btns[sel].focus(); e.preventDefault(); }
        if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') { sel = (sel + btns.length - 1 + (sel < 0 ? 1 : 0)) % btns.length; btns[sel].focus(); e.preventDefault(); }
        if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') { e.preventDefault(); e.stopPropagation(); if (sel >= 0) finish(sel); }
      };
      window.addEventListener('keydown', onKey, true);
    });
  } finally {
    closeModal(box); box.remove(); active = null; release();
  }
}

// Paper Mario-style wooden scroll with the area name.
export async function banner(title, subtitle = '') {
  const el = document.createElement('div');
  el.className = 'etl-passive area-banner';
  const t = document.createElement('div'); t.className = 'area-banner-title'; t.textContent = title; el.appendChild(t);
  if (subtitle) { const s = document.createElement('div'); s.className = 'area-banner-sub'; s.textContent = subtitle; el.appendChild(s); }
  root().appendChild(el);
  await wait(2600);
  el.classList.add('out');
  await wait(500);
  el.remove();
}

export function toast(message, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'etl-passive toast';
  el.textContent = message;
  root().appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms);
}

// "You got the X!" item fanfare.
export async function itemGet(name, description) {
  const el = document.createElement('div');
  el.className = 'item-get etl-panel';
  const star = document.createElement('div'); star.className = 'item-get-star'; star.textContent = '✦';
  const t = document.createElement('div'); t.className = 'item-get-title'; const b = document.createElement('b'); b.textContent = name; t.append(b);
  const d = document.createElement('div'); d.className = 'item-get-desc'; d.textContent = description || '';
  el.append(star, t, d);
  root().appendChild(el);
  openModal(el, {});
  await wait(400);
  await waitAdvance(el);
  closeModal(el); el.remove();
}

// Ask for a number (or short text). Resolves to the trimmed string, or null if cancelled.
export async function askValue(question, { speaker = null, style = 'npc', placeholder = 'Your answer' } = {}) {
  while (active) await active;
  let release; active = new Promise((r) => { release = r; });
  const st = STYLES[style] || STYLES.npc;
  const box = document.createElement('div');
  box.className = `dlg dlg-${st.box} dlg-ask`;
  if (speaker && st.tag !== null) { const tag = document.createElement('div'); tag.className = 'dlg-tag'; tag.textContent = speaker.name || speaker; tag.style.background = speaker.color || st.tag; box.appendChild(tag); }
  const text = document.createElement('div'); text.className = 'dlg-text'; text.textContent = question; box.appendChild(text);
  const row = document.createElement('form'); row.className = 'dlg-choices';
  const inp = document.createElement('input'); inp.className = 'dlg-input'; inp.placeholder = placeholder; inp.autocomplete = 'off';
  const ok = document.createElement('button'); ok.type = 'submit'; ok.className = 'etl-btn primary'; ok.textContent = 'Answer';
  const no = document.createElement('button'); no.type = 'button'; no.className = 'etl-btn'; no.textContent = 'Later';
  row.append(inp, ok, no); box.appendChild(row);
  root().appendChild(box);
  try {
    return await new Promise((resolve) => {
      openModal(box, { onEscape: () => resolve(null) });
      row.onsubmit = (e) => { e.preventDefault(); const v = inp.value.trim(); if (v) resolve(v); };
      no.onclick = () => resolve(null);
      setTimeout(() => inp.focus(), 30);
    });
  } finally {
    closeModal(box); box.remove(); active = null; release();
  }
}
