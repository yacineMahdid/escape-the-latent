// The Name Racks (CLIP island, c2). Each rack's sign reads "A photo of a <label>[tag]."
// The Lens files every photo onto the rack whose sign text is closest (cosine).
// Stamp category tags onto the signs so every photo lands on its own rack, the
// twin "crane" racks stop tying, and no sign lies. Paper: CLIP §3.1.2, §3.1.4.
import { createBoard, createDnd, h, injectCss } from './kit.js';

const CSS = `
.nr { display: flex; gap: 16px; align-items: stretch; }
.nr-lens { width: 86px; flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; }
.nr-eye { width: 70px; height: 70px; border-radius: 50%; background: radial-gradient(circle at 50% 50%, #2b2233 0 14px, #6fd3e8 15px 26px, #d9a441 27px); border: 4px solid var(--ink); box-shadow: 0 3px 0 rgba(43, 34, 51, .3); transition: filter .4s; }
.nr-win .nr-eye { filter: drop-shadow(0 0 12px #ffd35a) saturate(1.4); }
.nr-racks { flex: 1; display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 12px; }
.nr-rack {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 6px 6px 10px;
  border-radius: 14px; background: repeating-linear-gradient(90deg, rgba(196, 160, 90, .18) 0 18px, rgba(196, 160, 90, .28) 18px 20px);
  border: 3px solid rgba(43, 34, 51, .2); min-height: 300px;
}
.nr-post { font-size: 22px; height: 28px; }
.nr-sign {
  width: 100%; padding: 8px 8px; text-align: center; font-size: 14px; font-weight: 600; line-height: 1.5;
  background: #c99a5b; color: #2b2233; border: 3px solid var(--ink); border-radius: 10px; box-shadow: 0 3px 0 rgba(43, 34, 51, .3);
}
.nr-slot { display: inline-flex; align-items: center; min-width: 54px; min-height: 26px; margin: 0 2px; padding: 0 4px; vertical-align: middle; border: 2px dashed rgba(43, 34, 51, .6); border-radius: 8px; background: rgba(255, 253, 246, .45); }
.nr-stamped { font-size: 12px; font-weight: 700; padding: 1px 6px; border-radius: 6px; background: #fff3c4; border: 2px solid var(--ink); cursor: pointer; white-space: nowrap; }
.nr-flag { position: absolute; top: 4px; right: 6px; font-size: 18px; }
.nr-photos { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.nr-photo {
  position: relative; width: 62px; padding: 5px 5px 14px; background: #fffdf6; border: 2px solid var(--ink); border-radius: 4px;
  box-shadow: 0 3px 0 rgba(43, 34, 51, .2); text-align: center; font-size: 30px; line-height: 1.1; transition: transform .4s;
}
.nr-photo::before { content: ''; position: absolute; left: 50%; top: -9px; height: 9px; border-left: 2px solid #7a5a3a; }
.nr-photo.nr-tie { animation: nr-wobble .9s ease-in-out infinite; }
.nr-mark { position: absolute; right: -8px; top: -8px; font-size: 13px; font-weight: 700; background: #fff; border: 2px solid var(--ink); border-radius: 999px; padding: 0 4px; line-height: 1.3; }
.nr-mark.bad { color: #fff; background: #e8566a; }
.nr-tray { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: 12px; padding: 8px; border-radius: 12px; background: rgba(43, 34, 51, .08); }
.nr-tag { font-weight: 700; font-size: 14px; padding: 6px 10px; background: #fff3c4; transform: rotate(-1.5deg); }
@keyframes nr-wobble { 0%, 100% { transform: rotate(-6deg) translateX(-4px); } 50% { transform: rotate(6deg) translateX(4px); } }
@media (max-width: 760px) { .nr { flex-direction: column; } .nr-lens { flex-direction: row; width: auto; } .nr-racks { grid-template-columns: repeat(2, 1fr); } }
`;

const dot = (a, b) => a.reduce((t, v, i) => t + v * (b[i] || 0), 0);
const norm = (a) => Math.sqrt(dot(a, a)) || 1;
const cosine = (a, b) => dot(a, b) / (norm(a) * norm(b));
const PHRASES = { tie: "can't choose", lie: "a sign doesn't fit its photos", misfiled: 'on the wrong rack' };

export default {
  mount(container, spec = {}, api = {}) {
    injectCss('pz-name-racks', CSS);
    const board = createBoard(container, spec, api, { theme: 'sea' });
    const racks = spec.racks || [];
    const tagDefs = spec.tags || [];
    const tagById = Object.fromEntries(tagDefs.map((t) => [t.id, t]));
    const photos = spec.photos || [];
    const emb = spec.embedding || { photos: {}, signs: {} };
    const category = spec.category || {};
    const signs = { ...(spec.initialSigns || {}) };
    racks.forEach((r) => { if (!(r.id in signs)) signs[r.id] = null; });
    const frame = spec.signFrame || 'A photo of a {label}{tag}.';
    let solved = false;
    let winTimer = 0;

    // ---------- racks, signs, photos ----------
    const dnd = createDnd(board.root, {
      sfx: board.sfx,
      onDrop(tag, target) { if (target.rack && signs[target.rack] !== tag.id) { signs[target.rack] = tag.id; board.sfx('stamp'); changed(); } },
    });
    const rackEls = {};
    const rackGrid = h('div', { class: 'nr-racks' });
    racks.forEach((r) => {
      const slot = dnd.target(h('span', { class: 'nr-slot', 'data-rack': r.id, title: 'Tag slot' }), { rack: r.id });
      const [before, after] = frame.replace('{label}', r.label).split('{tag}');
      const sign = h('div', { class: 'nr-sign' }, [before, slot, after ?? '']);
      const flag = h('div', { class: 'nr-flag' });
      const list = h('div', { class: 'nr-photos' });
      const el = h('div', { class: 'nr-rack', 'data-rack': r.id }, [h('div', { class: 'nr-post', text: r.post || '' }), sign, list, flag]);
      rackEls[r.id] = { el, slot, list, flag };
      rackGrid.append(el);
    });
    const photoEls = {};
    photos.forEach((p) => {
      const mark = h('span', { class: 'nr-mark' });
      photoEls[p.id] = { el: h('div', { class: 'nr-photo', 'data-photo': p.id }, [p.icon || '🖼️', mark]), mark };
    });
    const tray = h('div', { class: 'nr-tray', title: 'Tags' });
    tagDefs.forEach((t) => tray.append(dnd.item(h('div', { class: 'pz-card nr-tag', 'data-tag': t.id, text: t.text.replace(/^,\s*/, '') }), { id: t.id })));
    const lens = h('div', { class: 'nr-lens' }, [h('div', { class: 'nr-eye', title: 'The Lens' }), h('div', { class: 'pz-label', text: 'the Lens' })]);
    const wrap = h('div', { class: 'nr' }, [lens, rackGrid]);
    board.body.append(wrap, tray);

    // ---------- the Lens files every photo ----------
    const signVec = (r) => emb.signs?.[`${r.label}|${signs[r.id] || 'none'}`];
    const rackName = (r) => r.post || r.label;
    function file() {
      const vecs = racks.map(signVec);
      return photos.map((p) => {
        const pv = emb.photos?.[p.id] || [];
        const scores = vecs.map((v) => (v ? cosine(pv, v) : -Infinity));
        const best = Math.max(...scores);
        const top = racks.filter((_, i) => scores[i] >= best - 1e-9).map((r) => r.id);
        return { p, scores, top };
      });
    }
    function feedbackText(key, count) {
      const v = spec.feedback?.[key];
      const icon = { tie: '⚖️', lie: '🤨', misfiled: '✗' }[key];
      const text = v && /[a-z]{3}/i.test(v) ? v : `${v || icon} ${PHRASES[key]}`;
      return count > 1 && key !== 'lie' ? `${text} ×${count}` : text;
    }
    function changed() {
      if (solved) return;
      clearTimeout(winTimer);
      // signs
      racks.forEach((r) => {
        const { slot, flag } = rackEls[r.id];
        const t = signs[r.id];
        slot.replaceChildren();
        if (t) {
          const st = h('span', { class: 'nr-stamped', title: 'Click to clear', text: tagById[t]?.text.replace(/^,\s*/, '') || t });
          st.addEventListener('click', (e) => { e.stopPropagation(); signs[r.id] = null; board.sfx('paper'); changed(); });
          slot.append(st);
        }
        const lies = t && category[r.id] && t !== category[r.id];
        flag.textContent = lies ? (spec.feedback?.lie && spec.feedback.lie.length <= 3 ? spec.feedback.lie : '🤨') : '';
        flag.title = lies ? PHRASES.lie : '';
      });
      // photos
      const filed = file();
      let ties = 0; let misfiled = 0;
      filed.forEach(({ p, scores, top }) => {
        const { el, mark } = photoEls[p.id];
        const home = rackEls[top[0]] || rackEls[racks[0].id];
        if (el.parentElement !== home.list) home.list.append(el);
        const tie = top.length > 1;
        el.classList.toggle('nr-tie', tie);
        el.title = `${p.art || p.id}\n${racks.map((r, i) => `${rackName(r)} ${Number.isFinite(scores[i]) ? scores[i].toFixed(2) : '–'}`).join(' · ')}`;
        if (tie) { ties++; mark.textContent = '⚖️'; mark.className = 'nr-mark'; mark.style.display = ''; }
        else if (top[0] !== p.truth) { misfiled++; mark.textContent = '✗'; mark.className = 'nr-mark bad'; mark.style.display = ''; }
        else { mark.style.display = 'none'; }
      });
      const lies = racks.filter((r) => signs[r.id] && category[r.id] && signs[r.id] !== category[r.id]).length;
      const parts = [];
      if (ties) parts.push(feedbackText('tie', ties));
      if (misfiled) parts.push(feedbackText('misfiled', misfiled));
      if (lies) parts.push(feedbackText('lie', lies));
      if (parts.length) board.note(parts.join('   ·   '), 'bad'); else board.note('', 'info');
      if (!ties && !misfiled && !lies) {
        winTimer = setTimeout(() => { solved = true; wrap.classList.add('nr-win'); board.sfx('ding'); board.solve(); }, 600);
      }
    }
    changed();

    container.__state = () => ({ signs: { ...signs } });
    return { destroy() { clearTimeout(winTimer); dnd.destroy(); board.destroy(); } };
  },
};
